// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The collection's life around the interface: automatic backups while a
//! profile is open, restoring a backup, and quitting so that nothing is lost.
//!
//! Quitting goes through the interface first, so it can sync on close as Anki
//! does. The interface acknowledges the request at once and calls
//! `lifecycle_quit` when it is done; if it never acknowledges, or the person
//! asks to quit a second time, the shell closes the collection and exits on
//! its own.

use std::fs;
use std::panic::catch_unwind;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU8;
use std::sync::atomic::Ordering;
use std::time::Duration;

use anki::error::AnkiError;
use anki::services::BackendCollectionService;
use anki::services::BackendSyncService;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use crate::core::Core;
use crate::profiles;
use crate::profiles::OnClose;
use crate::profiles::Session;

/// Anki checks every five minutes whether a backup is due.
const BACKUP_CHECK: Duration = Duration::from_secs(5 * 60);
/// How long the interface has to acknowledge a close request.
const ACK_TIMEOUT: Duration = Duration::from_secs(3);

pub const CLOSE_REQUESTED: &str = "lifecycle://close-requested";
pub const BACKUP_FAILED: &str = "lifecycle://backup-failed";

/// One automatic or manual backup in a profile's backup folder.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Local date and time from the file name, as `YYYY-MM-DDTHH:MM:SS`.
    pub stamp: String,
}

/// The date in a backup's name (the core writes
/// `backup-%Y-%m-%d-%H.%M.%S.colpkg`), as `YYYY-MM-DDTHH:MM:SS`.
fn backup_stamp(name: &str) -> Option<String> {
    let body = name.strip_prefix("backup-")?.strip_suffix(".colpkg")?;
    let bytes = body.as_bytes();
    let shape = "dddd-dd-dd-dd.dd.dd";
    if bytes.len() != shape.len() {
        return None;
    }
    for (b, s) in bytes.iter().zip(shape.bytes()) {
        let ok = if s == b'd' { b.is_ascii_digit() } else { *b == s };
        if !ok {
            return None;
        }
    }
    Some(format!(
        "{}T{}:{}:{}",
        &body[..10],
        &body[11..13],
        &body[14..16],
        &body[17..19]
    ))
}

/// The backups in `folder`, newest first. A missing folder has none.
pub fn list_backups(folder: &Path) -> Vec<BackupEntry> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut backups: Vec<BackupEntry> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stamp = backup_stamp(&name)?;
            let meta = entry.metadata().ok().filter(|m| m.is_file())?;
            Some(BackupEntry {
                path: entry.path().to_string_lossy().into_owned(),
                size: meta.len(),
                name,
                stamp,
            })
        })
        .collect();
    // The stamp is zero-padded, so text order is date order.
    backups.sort_by(|a, b| b.stamp.cmp(&a.stamp));
    backups
}

#[tauri::command]
pub fn backups_list(session: State<'_, Session>) -> Result<Vec<BackupEntry>, String> {
    let profile = session.current().ok_or("no-profile")?;
    Ok(list_backups(&profile.backup_folder))
}

/// Replaces the open collection with a backup, after backing up the current
/// one. The chosen file is copied first, because that backup can thin the
/// backup folder. As Anki's `restoring_backup`, automatic backups and syncs
/// stay off from the start of the restore, whatever its outcome, until the
/// profile is unloaded.
pub fn restore_backup(core: &Core, session: &Session, path: &str) -> Result<(), String> {
    let held = session.hold();
    let profile = held.current().ok_or("no-profile")?;
    held.mark_restored();
    let copy = profile.folder.join("restoring.colpkg");
    fs::copy(path, &copy).map_err(|err| err.to_string())?;
    let result = profiles::replace_collection(core, &held, copy.to_string_lossy().into_owned());
    let _ = fs::remove_file(&copy);
    result
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restore_backup(&app.state::<Core>(), &app.state::<Session>(), &path))
        .await
        .map_err(|err| err.to_string())?
}

/// Whether a backup was restored into the open profile since it was loaded.
#[tauri::command]
pub fn backup_restored(session: State<'_, Session>) -> bool {
    session.restored()
}

/// A periodic backup, as Anki's timer makes: only when the collection changed
/// and the minimum interval in the preferences has passed. The session is
/// held throughout, so the backup is of the profile whose folder it goes to.
fn periodic_backup(core: &Core, session: &Session) -> Result<(), AnkiError> {
    let held = session.hold();
    let Some(profile) = held.current() else {
        return Ok(());
    };
    if session.restored() {
        return Ok(());
    }
    match core.backend().create_backup(profiles::backup_request(&profile, false)) {
        Ok(_) | Err(AnkiError::CollectionNotOpen) => Ok(()),
        Err(err) => Err(err),
    }
}

/// A failed or panicking backup is reported and the timer keeps running, so
/// one bad backup does not end automatic backups until the app restarts.
fn checked_backup(core: &Core, session: &Session) -> Result<(), String> {
    match catch_unwind(AssertUnwindSafe(|| periodic_backup(core, session))) {
        Ok(result) => result.map_err(|err| err.to_string()),
        Err(payload) => Err(crate::core::panic_message(&*payload)),
    }
}

pub fn start_backup_timer(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(BACKUP_CHECK);
        if let Err(err) = checked_backup(&app.state::<Core>(), &app.state::<Session>()) {
            eprintln!("periodic backup failed: {err}");
            let _ = app.emit(BACKUP_FAILED, err);
        }
    });
}

const RUNNING: u8 = 0;
const CLOSING: u8 = 1;
const QUITTING: u8 = 2;

/// Where quitting stands: running, waiting for the interface to sync and
/// close, or closing the collection to exit.
#[derive(Default)]
pub struct Lifecycle {
    state: AtomicU8,
    acked: AtomicBool,
}

/// Abandons a sync still running, then closes the collection with Anki's
/// backup on close, after a restore, import or backup still running. Safe to
/// call with no profile open, and more than once.
pub fn shutdown(core: &Core, session: &Session) {
    let backend = core.backend();
    let _ = backend.abort_sync();
    let _ = backend.abort_media_sync();
    profiles::close_current(core, session, OnClose::Unload);
}

/// Closes the collection and exits. Runs once, off the event loop.
fn quit(app: &AppHandle) {
    let lifecycle = app.state::<Lifecycle>();
    if lifecycle.state.swap(QUITTING, Ordering::SeqCst) == QUITTING {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        shutdown(&app.state::<Core>(), &app.state::<Session>());
        app.exit(0);
    });
}

/// The person asked to close the window or quit. Returns whether the shell
/// keeps the window open for now (it closes once the collection is closed).
pub fn request_close(app: &AppHandle) -> bool {
    let lifecycle = app.state::<Lifecycle>();
    match lifecycle
        .state
        .compare_exchange(RUNNING, CLOSING, Ordering::SeqCst, Ordering::SeqCst)
    {
        Ok(_) => {
            lifecycle.acked.store(false, Ordering::SeqCst);
            if app.emit(CLOSE_REQUESTED, ()).is_err() {
                quit(app);
                return true;
            }
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(ACK_TIMEOUT);
                if !app.state::<Lifecycle>().acked.load(Ordering::SeqCst) {
                    quit(&app);
                }
            });
        }
        // Asked again while the interface syncs: quit now.
        Err(CLOSING) => quit(app),
        Err(_) => {}
    }
    true
}

/// Whether the interface answered the last request to close.
pub fn interface_answered(app: &AppHandle) -> bool {
    app.state::<Lifecycle>().acked.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn lifecycle_close_ack(lifecycle: State<'_, Lifecycle>) {
    lifecycle.acked.store(true, Ordering::SeqCst);
}

/// The interface is done with closing (synced, or chose not to): quit.
#[tauri::command]
pub fn lifecycle_quit(app: AppHandle) {
    quit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hayaki-lifecycle-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_date_from_a_backup_name() {
        assert_eq!(
            backup_stamp("backup-2026-11-21-20.23.14.colpkg").as_deref(),
            Some("2026-11-21T20:23:14")
        );
        assert_eq!(backup_stamp("backup-2026-11-21.colpkg"), None);
        assert_eq!(backup_stamp("collection.colpkg"), None);
        assert_eq!(backup_stamp("backup-2026-11-21-20.23.14.apkg"), None);
        assert_eq!(backup_stamp("backup-2026-1x-21-20.23.14.colpkg"), None);
    }

    #[test]
    fn lists_backups_newest_first_with_their_sizes() {
        let dir = temp_dir("list");
        fs::write(dir.join("backup-2025-01-02-09.00.00.colpkg"), b"aa").unwrap();
        fs::write(dir.join("backup-2026-11-21-20.23.14.colpkg"), b"abcd").unwrap();
        fs::write(dir.join("backup-2026-11-21-08.05.59.colpkg"), b"a").unwrap();
        // Not backups the core wrote.
        fs::write(dir.join("my-export.colpkg"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        fs::create_dir(dir.join("backup-2027-01-01-00.00.00.colpkg")).unwrap();

        let backups = list_backups(&dir);
        let names: Vec<&str> = backups.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "backup-2026-11-21-20.23.14.colpkg",
                "backup-2026-11-21-08.05.59.colpkg",
                "backup-2025-01-02-09.00.00.colpkg",
            ]
        );
        assert_eq!(backups[0].size, 4);
        assert_eq!(backups[0].stamp, "2026-11-21T20:23:14");
        assert!(backups[0].path.ends_with("backup-2026-11-21-20.23.14.colpkg"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_backup_folder_has_no_backups() {
        assert!(list_backups(Path::new("/nonexistent/hayaki/backups")).is_empty());
    }

    #[test]
    fn shutting_down_without_an_open_profile_does_nothing() {
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        shutdown(&core, &session);
        shutdown(&core, &session);
        assert!(session.current().is_none());
    }

    fn profile_in(dir: &Path, id: &str) -> profiles::OpenProfile {
        let folder = dir.join(id);
        profiles::OpenProfile {
            id: id.into(),
            name: id.into(),
            collection_path: folder.join("collection.anki2"),
            media_folder: folder.join("collection.media"),
            backup_folder: folder.join("backups"),
            folder,
        }
    }

    fn backups(profile: &profiles::OpenProfile) -> usize {
        list_backups(&profile.backup_folder).len()
    }

    #[test]
    fn a_periodic_backup_goes_to_the_profile_open_when_it_runs() {
        let dir = temp_dir("periodic");
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let a = profile_in(&dir, "a");
        let b = profile_in(&dir, "b");
        profiles::open_profile(&core, &session, a.clone()).unwrap();

        std::thread::scope(|scope| {
            // A profile switch is under way when the timer fires.
            let held = session.hold();
            let timer = scope.spawn(|| periodic_backup(&core, &session));
            std::thread::sleep(Duration::from_millis(200));
            assert!(!timer.is_finished(), "the backup waits for the switch");
            held.close(&core, OnClose::Unload);
            held.open(&core, b.clone()).unwrap();
            drop(held);
            timer.join().unwrap().unwrap();
        });

        assert_eq!(backups(&a), 1, "only the backup on close");
        assert_eq!(backups(&b), 1, "the periodic backup is of the profile now open");
        shutdown(&core, &session);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn quitting_waits_for_a_restore_to_finish() {
        let dir = temp_dir("restore");
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = profile_in(&dir, "a");
        profiles::open_profile(&core, &session, profile.clone()).unwrap();
        let _ = core.backend().create_backup(profiles::backup_request(&profile, true)).unwrap();
        let backup = list_backups(&profile.backup_folder).remove(0).path;

        let mut restored_backups = 0;
        std::thread::scope(|scope| {
            // A restore is running.
            let held = session.hold();
            let quit = scope.spawn(|| shutdown(&core, &session));
            std::thread::sleep(Duration::from_millis(200));
            assert!(!quit.is_finished(), "quitting waits");
            assert!(session.current().is_some());
            held.mark_restored();
            profiles::replace_collection(&core, &held, backup.clone()).unwrap();
            restored_backups = backups(&profile);
            drop(held);
            quit.join().unwrap();
        });

        assert!(session.current().is_none());
        assert!(!session.restored());
        assert_eq!(backups(&profile), restored_backups, "no backup on close after a restore");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_restore_turns_automatic_backups_off_until_the_profile_closes() {
        let dir = temp_dir("restored");
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = profile_in(&dir, "a");
        profiles::open_profile(&core, &session, profile.clone()).unwrap();
        let _ = core.backend().create_backup(profiles::backup_request(&profile, true)).unwrap();
        let backup = list_backups(&profile.backup_folder).remove(0).path;

        restore_backup(&core, &session, &backup).unwrap();
        assert!(session.restored());
        assert!(!profile.folder.join("restoring.colpkg").exists());
        let before = backups(&profile);
        periodic_backup(&core, &session).unwrap();
        shutdown(&core, &session);
        assert_eq!(backups(&profile), before, "no backup after a restore");
        let _ = fs::remove_dir_all(dir);
    }
}

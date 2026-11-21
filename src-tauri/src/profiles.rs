// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Profiles: separate collections, each in its own folder under the app's
//! data directory. A profile folder holds `collection.anki2`, the media folder
//! `collection.media`, its database `collection.media.db2` and `backups`.

use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::RwLock;

use anki::services::BackendCollectionService;
use anki_proto::collection::CloseCollectionRequest;
use anki_proto::collection::CreateBackupRequest;
use anki_proto::collection::OpenCollectionRequest;
use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;

use crate::core::Core;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    pub created: i64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
struct ProfilesFile {
    profiles: Vec<ProfileMeta>,
    last_opened: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenProfile {
    pub id: String,
    pub name: String,
    pub folder: PathBuf,
    pub collection_path: PathBuf,
    pub media_folder: PathBuf,
    pub backup_folder: PathBuf,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesState {
    profiles: Vec<ProfileMeta>,
    last_opened: Option<String>,
    current: Option<OpenProfile>,
}

/// The open profile. `current` is only ever locked for a moment, so the main
/// thread can read it at any time. Anything that opens, closes, replaces or
/// backs up the collection holds `collection` for its whole length instead
/// (see [`Held`]), so the profile cannot change under it and quitting waits
/// for it. Lock order: `collection`, then the core's own locks; `current` is
/// never held while taking another lock.
#[derive(Default)]
pub struct Session {
    current: RwLock<Option<OpenProfile>>,
    /// A backup was restored into the open profile. As Anki's
    /// `restoring_backup`, automatic backups and syncs stay off until the
    /// profile is unloaded, from the moment the restore starts.
    restored: AtomicBool,
    collection: Mutex<()>,
}

impl Session {
    pub fn media_folder(&self) -> Option<PathBuf> {
        self.current
            .read()
            .unwrap()
            .as_ref()
            .map(|profile| profile.media_folder.clone())
    }

    pub fn current(&self) -> Option<OpenProfile> {
        self.current.read().unwrap().clone()
    }

    pub fn restored(&self) -> bool {
        self.restored.load(Ordering::SeqCst)
    }

    /// Waits until no other collection operation runs, and keeps others out
    /// until the guard drops.
    pub fn hold(&self) -> Held<'_> {
        Held {
            session: self,
            // The mutex guards no data, so a panic while it was held leaves
            // nothing inconsistent behind it.
            _guard: self.collection.lock().unwrap_or_else(|poison| poison.into_inner()),
        }
    }
}

/// Proof that this thread holds the session's collection lock.
pub struct Held<'a> {
    session: &'a Session,
    _guard: MutexGuard<'a, ()>,
}

impl Held<'_> {
    pub fn current(&self) -> Option<OpenProfile> {
        self.session.current()
    }

    fn set(&self, profile: Option<OpenProfile>) {
        *self.session.current.write().unwrap() = profile;
    }

    /// Marks the open profile as restored from a backup.
    pub fn mark_restored(&self) {
        self.session.restored.store(true, Ordering::SeqCst);
    }

    /// Closes the open collection, if any. Safe to call more than once.
    pub fn close(&self, core: &Core, on_close: OnClose) {
        let Some(profile) = self.current() else {
            return;
        };
        let backend = core.backend();
        if on_close == OnClose::Unload && !self.session.restored.swap(false, Ordering::SeqCst) {
            if let Err(err) = backend.create_backup(backup_request(&profile, false)) {
                eprintln!("backup on close failed: {err}");
            }
        }
        if let Err(err) = backend.close_collection(CloseCollectionRequest {
            downgrade_to_schema11: false,
        }) {
            eprintln!("closing the collection failed: {err}");
        }
        // The core does not wait for a backup still being written.
        if let Err(err) = backend.await_backup_completion() {
            eprintln!("backup failed: {err}");
        }
        // Only now, so the profile cannot be deleted while it closes.
        self.set(None);
    }

    /// Opens `profile`'s collection; nothing may be open.
    pub(crate) fn open(&self, core: &Core, profile: OpenProfile) -> Result<OpenProfile, String> {
        fs::create_dir_all(&profile.media_folder).map_err(|err| err.to_string())?;
        fs::create_dir_all(&profile.backup_folder).map_err(|err| err.to_string())?;
        core.backend()
            .open_collection(open_request(&profile))
            .map_err(|err| err.to_string())?;
        self.set(Some(profile.clone()));
        Ok(profile)
    }
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("profiles")).map_err(|err| err.to_string())?;
    Ok(root)
}

fn read_file(root: &Path) -> ProfilesFile {
    fs::read(root.join("profiles.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Writes `value` as JSON to `path` through a temporary file, so a crash
/// leaves either the old file or the new one, never a torn one.
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, json).map_err(|err| err.to_string())?;
    fs::rename(&tmp, path).map_err(|err| err.to_string())
}

fn write_file(root: &Path, file: &ProfilesFile) -> Result<(), String> {
    write_json(&root.join("profiles.json"), file)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// A folder name derived from the profile name: letters and digits kept
/// (including CJK), everything else replaced, made unique.
fn folder_id(name: &str, existing: &[ProfileMeta], root: &Path) -> String {
    let mut base: String = name
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(40)
        .collect();
    if base.is_empty() {
        base = "profile".into();
    }
    let mut candidate = base.clone();
    let mut n = 2;
    while existing.iter().any(|p| p.id == candidate)
        || root.join("profiles").join(&candidate).exists()
    {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

fn validate_name(name: &str, existing: &[ProfileMeta], except: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty-name".into());
    }
    if existing
        .iter()
        .any(|p| Some(p.id.as_str()) != except && p.name.eq_ignore_ascii_case(name))
    {
        return Err("name-exists".into());
    }
    Ok(name.to_string())
}

fn state(app: &AppHandle, session: &Session) -> Result<ProfilesState, String> {
    let root = data_root(app)?;
    let file = read_file(&root);
    Ok(ProfilesState {
        profiles: file.profiles,
        last_opened: file.last_opened,
        current: session.current(),
    })
}

#[tauri::command]
pub fn profiles_list(app: AppHandle, session: State<'_, Session>) -> Result<ProfilesState, String> {
    state(&app, &session)
}

#[tauri::command]
pub fn profile_create(app: AppHandle, name: String) -> Result<ProfileMeta, String> {
    let root = data_root(&app)?;
    let mut file = read_file(&root);
    let name = validate_name(&name, &file.profiles, None)?;
    let id = folder_id(&name, &file.profiles, &root);
    fs::create_dir_all(root.join("profiles").join(&id)).map_err(|err| err.to_string())?;
    let meta = ProfileMeta {
        id,
        name,
        created: now_secs(),
    };
    file.profiles.push(meta.clone());
    write_file(&root, &file)?;
    Ok(meta)
}

#[tauri::command]
pub fn profile_rename(app: AppHandle, session: State<'_, Session>, id: String, name: String) -> Result<ProfilesState, String> {
    let root = data_root(&app)?;
    let mut file = read_file(&root);
    let name = validate_name(&name, &file.profiles, Some(&id))?;
    let profile = file
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("not-found")?;
    profile.name = name.clone();
    write_file(&root, &file)?;
    if let Some(current) = session.current.write().unwrap().as_mut() {
        if current.id == id {
            current.name = name;
        }
    }
    state(&app, &session)
}

/// Held against the collection operations, so the profile cannot be opened
/// while its folder is removed.
#[tauri::command]
pub async fn profile_delete(app: AppHandle, id: String) -> Result<ProfilesState, String> {
    let handle = app.clone();
    blocking(handle, move |_, session| {
        let held = session.hold();
        if held.current().is_some_and(|p| p.id == id) {
            return Err("profile-open".into());
        }
        delete_profile(&app, &id)?;
        state(&app, session)
    })
    .await
}

fn delete_profile(app: &AppHandle, id: &str) -> Result<(), String> {
    let root = data_root(app)?;
    let mut file = read_file(&root);
    file.profiles.retain(|p| p.id != id);
    if file.last_opened.as_deref() == Some(id) {
        file.last_opened = None;
    }
    write_file(&root, &file)?;
    let folder = root.join("profiles").join(id);
    if folder.exists() {
        fs::remove_dir_all(folder).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Why the collection closes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OnClose {
    /// The profile is unloaded, as when Anki closes a profile: a backup if
    /// the collection changed and the minimum interval has passed (none after
    /// a restore), and a restored profile counts as fresh again.
    Unload,
    /// The same profile opens again at once (a language change): no backup,
    /// and a restore still keeps backups and syncs off.
    Reopen,
}

/// Closes the open collection, if any, after any collection operation still
/// running. Safe to call more than once.
pub fn close_current(core: &Core, session: &Session, on_close: OnClose) {
    session.hold().close(core, on_close);
}

/// A backup into the profile's backup folder, waiting until it is written.
pub fn backup_request(profile: &OpenProfile, force: bool) -> CreateBackupRequest {
    CreateBackupRequest {
        backup_folder: profile.backup_folder.to_string_lossy().into_owned(),
        force,
        wait_for_completion: true,
    }
}

fn profile_paths(root: &Path, meta: &ProfileMeta) -> OpenProfile {
    let folder = root.join("profiles").join(&meta.id);
    OpenProfile {
        id: meta.id.clone(),
        name: meta.name.clone(),
        collection_path: folder.join("collection.anki2"),
        media_folder: folder.join("collection.media"),
        backup_folder: folder.join("backups"),
        folder,
    }
}

/// Opens `profile`, unloading the open one first. The profile already open
/// stays as it is (the window reloading after a language change opens it
/// again), so a restore into it keeps backups and syncs off.
pub fn open_profile(core: &Core, session: &Session, profile: OpenProfile) -> Result<OpenProfile, String> {
    let held = session.hold();
    if let Some(current) = held.current().filter(|current| current.id == profile.id) {
        return Ok(current);
    }
    held.close(core, OnClose::Unload);
    held.open(core, profile)
}

/// Restarts the core in other interface languages, reopening the open
/// collection afterwards, in the old core if the new one fails to start.
pub fn change_langs(core: &Core, session: &Session, langs: Vec<String>) -> Result<(), String> {
    use anki::services::BackendSyncService;
    // A sync still running would hold the collection open.
    let backend = core.backend();
    let _ = backend.abort_sync();
    let _ = backend.abort_media_sync();
    let held = session.hold();
    let reopen = held.current();
    held.close(core, OnClose::Reopen);
    let previous = core.langs();
    let replaced = core.replace(langs).map_err(|err| err.to_string());
    if replaced.is_err() {
        // Never leave the app with no collection: go back to the old language.
        let _ = core.replace(previous);
    }
    if let Some(profile) = reopen {
        held.open(core, profile)?;
    }
    replaced
}

/// Runs `work` with the core and the session off the async runtime: the
/// collection operations wait for each other and can take minutes.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&Core, &Session) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Core>(), &app.state::<Session>()))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn profile_open(app: AppHandle, id: String) -> Result<OpenProfile, String> {
    let root = data_root(&app)?;
    let mut file = read_file(&root);
    let meta = file
        .profiles
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("not-found")?;
    let profile = profile_paths(&root, &meta);
    let open = blocking(app, move |core, session| open_profile(core, session, profile)).await?;
    file.last_opened = Some(meta.id);
    write_file(&root, &file)?;
    Ok(open)
}

#[tauri::command]
pub async fn profile_close(app: AppHandle) -> Result<(), String> {
    blocking(app, |core, session| {
        close_current(core, session, OnClose::Unload);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_core_langs(app: AppHandle, langs: Vec<String>) -> Result<(), String> {
    blocking(app, move |core, session| change_langs(core, session, langs)).await
}

fn open_request(profile: &OpenProfile) -> OpenCollectionRequest {
    OpenCollectionRequest {
        collection_path: profile.collection_path.to_string_lossy().into_owned(),
        media_folder_path: profile.media_folder.to_string_lossy().into_owned(),
        media_db_path: profile
            .folder
            .join("collection.media.db2")
            .to_string_lossy()
            .into_owned(),
    }
}

/// Writes the whole collection to a `.colpkg`. The core closes the collection
/// to do this, so it is opened again afterwards whatever the outcome.
#[tauri::command]
pub async fn collection_export_colpkg(
    app: AppHandle,
    out_path: String,
    include_media: bool,
    legacy: bool,
) -> Result<(), String> {
    use anki::services::BackendImportExportService;
    blocking(app, move |core, session| {
        let held = session.hold();
        let profile = held.current().ok_or("no-profile")?;
        let backend = core.backend();
        let result = backend.export_collection_package(anki_proto::import_export::ExportCollectionPackageRequest {
            out_path,
            include_media,
            legacy,
        });
        let reopened = backend.open_collection(open_request(&profile));
        result.map_err(|err| err.to_string())?;
        reopened.map_err(|err| err.to_string())
    })
    .await
}

/// Replaces the open profile's collection with a `.colpkg`. A backup of the
/// current collection is made first, and the collection is opened again
/// afterwards whatever the outcome. Holding the session for the whole of it
/// keeps a profile switch or quitting from closing the collection halfway.
pub fn replace_collection(core: &Core, held: &Held, path: String) -> Result<(), String> {
    use anki::services::BackendImportExportService;
    let profile = held.current().ok_or("no-profile")?;
    let backend = core.backend();
    // The result says whether a backup was written; a refusal is an error.
    let _ = backend
        .create_backup(backup_request(&profile, true))
        .map_err(|err| err.to_string())?;
    backend
        .close_collection(CloseCollectionRequest {
            downgrade_to_schema11: false,
        })
        .map_err(|err| err.to_string())?;
    let request = open_request(&profile);
    let result = backend.import_collection_package(anki_proto::import_export::ImportCollectionPackageRequest {
        col_path: request.collection_path.clone(),
        backup_path: path,
        media_folder: request.media_folder_path.clone(),
        media_db: request.media_db_path.clone(),
    });
    let reopened = backend.open_collection(request);
    result.map_err(|err| err.to_string())?;
    reopened.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn collection_import_colpkg(app: AppHandle, path: String) -> Result<(), String> {
    blocking(app, move |core, session| replace_collection(core, &session.hold(), path)).await
}

/// Makes a backup of the open collection now, into the profile's backup folder.
#[tauri::command]
pub async fn collection_backup(app: AppHandle) -> Result<bool, String> {
    blocking(app, |core, session| {
        let held = session.hold();
        let profile = held.current().ok_or("no-profile")?;
        core.backend()
            .create_backup(backup_request(&profile, true))
            .map(|created| created.val)
            .map_err(|err| err.to_string())
    })
    .await
}

/// The sync account of the open profile: the key the server issued at sign-in
/// (never the password), the user name for display and the server address.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccount {
    pub hkey: String,
    pub username: String,
    /// Empty for AnkiWeb; otherwise a self-hosted server's address.
    pub endpoint: Option<String>,
    /// The address AnkiWeb last redirected this account to.
    pub current_endpoint: Option<String>,
}

fn sync_file(session: &Session) -> Result<PathBuf, String> {
    session
        .current()
        .map(|p| p.folder.join("sync.json"))
        .ok_or_else(|| "no-profile".to_string())
}

#[tauri::command]
pub fn sync_account_get(session: State<'_, Session>) -> Result<Option<SyncAccount>, String> {
    let path = sync_file(&session)?;
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

#[tauri::command]
pub fn sync_account_set(session: State<'_, Session>, account: Option<SyncAccount>) -> Result<(), String> {
    let path = sync_file(&session)?;
    match account {
        Some(account) => write_json(&path, &account),
        None => {
            if path.exists() {
                fs::remove_file(path).map_err(|err| err.to_string())?;
            }
            Ok(())
        }
    }
}

/// Syncing preferences of a profile, as Anki keeps them in its profile.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncPrefs {
    /// Sync when the profile opens and closes (Anki's `autoSync`).
    pub auto_sync: bool,
    /// Sync media too (Anki's `syncMedia`).
    pub sync_media: bool,
}

impl Default for SyncPrefs {
    fn default() -> Self {
        SyncPrefs {
            auto_sync: true,
            sync_media: true,
        }
    }
}

fn sync_prefs_file(session: &Session) -> Result<PathBuf, String> {
    session
        .current()
        .map(|p| p.folder.join("sync-prefs.json"))
        .ok_or_else(|| "no-profile".to_string())
}

/// The preferences in `path`; Anki's defaults when there are none yet.
fn read_sync_prefs(path: &Path) -> SyncPrefs {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn sync_prefs_get(session: State<'_, Session>) -> Result<SyncPrefs, String> {
    Ok(read_sync_prefs(&sync_prefs_file(&session)?))
}

/// Written whole or not at all: a torn file would read as the defaults and
/// turn syncing on open and close back on.
#[tauri::command]
pub fn sync_prefs_set(session: State<'_, Session>, prefs: SyncPrefs) -> Result<(), String> {
    write_json(&sync_prefs_file(&session)?, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in(dir: &Path, core: &Core, session: &Session) -> OpenProfile {
        let _ = fs::remove_dir_all(dir);
        let folder = dir.to_path_buf();
        let profile = OpenProfile {
            id: "test".into(),
            name: "Test".into(),
            collection_path: folder.join("collection.anki2"),
            media_folder: folder.join("collection.media"),
            backup_folder: folder.join("backups"),
            folder,
        };
        fs::create_dir_all(&profile.media_folder).unwrap();
        fs::create_dir_all(&profile.backup_folder).unwrap();
        core.backend().open_collection(open_request(&profile)).unwrap();
        *session.current.write().unwrap() = Some(profile.clone());
        profile
    }

    fn backups_in(profile: &OpenProfile) -> usize {
        fs::read_dir(&profile.backup_folder).unwrap().count()
    }

    #[test]
    fn closing_a_profile_backs_it_up_and_closes_the_collection() {
        let dir = std::env::temp_dir().join(format!("hayaki-close-test-{}", std::process::id()));
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = open_in(&dir, &core, &session);

        close_current(&core, &session, OnClose::Unload);
        assert!(session.current().is_none());
        assert_eq!(backups_in(&profile), 1, "a new collection is backed up on close");
        // The collection is closed: it opens again.
        core.backend().open_collection(open_request(&profile)).unwrap();
        core.backend()
            .close_collection(CloseCollectionRequest { downgrade_to_schema11: false })
            .unwrap();
        // Closing again with nothing open is harmless.
        close_current(&core, &session, OnClose::Unload);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_restored_profile_closes_without_a_backup() {
        let dir = std::env::temp_dir().join(format!("hayaki-restored-test-{}", std::process::id()));
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = open_in(&dir, &core, &session);

        session.hold().mark_restored();
        close_current(&core, &session, OnClose::Unload);
        assert_eq!(backups_in(&profile), 0);
        assert!(!session.restored(), "the next profile opened backs up again");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_language_change_keeps_a_restore_in_force() {
        let dir = std::env::temp_dir().join(format!("hayaki-langs-test-{}", std::process::id()));
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = open_in(&dir, &core, &session);

        session.hold().mark_restored();
        change_langs(&core, &session, vec!["ja".into()]).unwrap();
        assert_eq!(core.langs(), ["ja"]);
        assert!(session.restored(), "backups and syncs stay off after the reopen");
        assert_eq!(session.current().map(|p| p.id), Some(profile.id.clone()));
        // The window reloads and opens the same profile: nothing changes.
        open_profile(&core, &session, profile.clone()).unwrap();
        assert!(session.restored());
        assert_eq!(backups_in(&profile), 0);
        // The collection is really open again in the new core.
        let created = core.backend().create_backup(backup_request(&profile, true)).unwrap();
        assert!(created.val);

        // Unloading the profile ends the restore.
        close_current(&core, &session, OnClose::Unload);
        assert!(!session.restored());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn opening_another_profile_unloads_the_open_one() {
        let dir = std::env::temp_dir().join(format!("hayaki-switch-test-{}", std::process::id()));
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let first = open_in(&dir.join("a"), &core, &session);
        session.hold().mark_restored();

        let mut second = first.clone();
        second.id = "other".into();
        second.folder = dir.join("b");
        second.collection_path = second.folder.join("collection.anki2");
        second.media_folder = second.folder.join("collection.media");
        second.backup_folder = second.folder.join("backups");
        open_profile(&core, &session, second.clone()).unwrap();

        assert_eq!(session.current().map(|p| p.id), Some("other".into()));
        assert!(!session.restored(), "the next profile backs up and syncs again");
        assert_eq!(backups_in(&first), 0, "a restored profile closes without a backup");
        assert!(second.collection_path.exists());
        close_current(&core, &session, OnClose::Unload);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sync_prefs_are_written_whole_and_read_back() {
        let dir = std::env::temp_dir().join(format!("hayaki-prefs-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sync-prefs.json");

        assert_eq!(read_sync_prefs(&path), SyncPrefs::default(), "no file yet");
        let off = SyncPrefs {
            auto_sync: false,
            sync_media: true,
        };
        write_json(&path, &off).unwrap();
        assert_eq!(read_sync_prefs(&path), off);
        let media_off = SyncPrefs {
            auto_sync: false,
            sync_media: false,
        };
        write_json(&path, &media_off).unwrap();
        assert_eq!(read_sync_prefs(&path), media_off);
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, ["sync-prefs.json"], "no temporary file is left behind");
        let _ = fs::remove_dir_all(dir);
    }
}

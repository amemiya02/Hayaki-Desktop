// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Profiles: separate collections, each in its own folder under the app's
//! data directory. A profile folder holds `collection.anki2`, the media folder
//! `collection.media`, its database `collection.media.db2` and `backups`.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
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

    /// The restored profile is no longer loaded: backups and syncs come back.
    fn end_restore(&self) {
        self.session.restored.store(false, Ordering::SeqCst);
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

    /// Opens the open profile's collection again after the core closed it. If
    /// that fails, no profile is open any more.
    fn reopen(&self, core: &Core, profile: &OpenProfile) -> Result<(), String> {
        let reopened = core.backend().open_collection(open_request(profile));
        if reopened.is_err() {
            self.set(None);
        }
        reopened.map_err(|err| err.to_string())
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

/// Writes `value` as JSON to `path` through a temporary file of its own,
/// flushed to disk before it is renamed into place, so a crash or power loss
/// leaves either the old file or the new one, and writers at the same time
/// never share a temporary file.
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let json = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let tmp = PathBuf::from(tmp);
    let written = fs::File::create(&tmp)
        .and_then(|mut file| {
            file.write_all(&json)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&tmp, path));
    if let Err(err) = written {
        let _ = fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    // The rename itself is durable once the folder is flushed. Folders cannot
    // be opened as files on Windows, so this is best effort.
    if let Some(dir) = path.parent() {
        let _ = fs::File::open(dir).and_then(|dir| dir.sync_all());
    }
    Ok(())
}

/// Reads `profiles.json`, applies `change` and writes it back, all under one
/// lock, so two changes at once (the window opening a profile twice, or
/// creating one while another opens) cannot undo each other.
fn update_file<T>(root: &Path, change: impl FnOnce(&mut ProfilesFile) -> Result<T, String>) -> Result<T, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
    let mut file = read_file(root);
    let value = change(&mut file)?;
    write_json(&root.join("profiles.json"), &file)?;
    Ok(value)
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
    create_profile(&data_root(&app)?, &name)
}

fn create_profile(root: &Path, name: &str) -> Result<ProfileMeta, String> {
    update_file(root, |file| {
        let name = validate_name(name, &file.profiles, None)?;
        let id = folder_id(&name, &file.profiles, root);
        fs::create_dir_all(root.join("profiles").join(&id)).map_err(|err| err.to_string())?;
        let meta = ProfileMeta {
            id,
            name,
            created: now_secs(),
        };
        file.profiles.push(meta.clone());
        Ok(meta)
    })
}

#[tauri::command]
pub fn profile_rename(app: AppHandle, session: State<'_, Session>, id: String, name: String) -> Result<ProfilesState, String> {
    let root = data_root(&app)?;
    let name = update_file(&root, |file| {
        let name = validate_name(&name, &file.profiles, Some(&id))?;
        let profile = file
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or("not-found")?;
        profile.name = name.clone();
        Ok(name)
    })?;
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
    update_file(&root, |file| {
        file.profiles.retain(|p| p.id != id);
        if file.last_opened.as_deref() == Some(id) {
            file.last_opened = None;
        }
        Ok(())
    })?;
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
/// again), so a restore into it keeps backups and syncs off. `current` is
/// only ever a profile whose collection is open, so a profile whose reopen
/// failed opens here for real.
pub fn open_profile(core: &Core, session: &Session, profile: OpenProfile) -> Result<OpenProfile, String> {
    let held = session.hold();
    if let Some(current) = held.current().filter(|current| current.id == profile.id) {
        return Ok(current);
    }
    held.close(core, OnClose::Unload);
    // The close above ends a restore only when a collection was open.
    held.end_restore();
    held.open(core, profile)
}

/// Restarts the core in other interface languages, reopening the open
/// collection afterwards. The core keeps its old languages if the new ones
/// fail to start.
pub fn change_langs(core: &Core, session: &Session, langs: Vec<String>) -> Result<(), String> {
    use anki::services::BackendSyncService;
    // A sync still running would hold the collection open.
    let backend = core.backend();
    let _ = backend.abort_sync();
    let _ = backend.abort_media_sync();
    let held = session.hold();
    let reopen = held.current();
    held.close(core, OnClose::Reopen);
    let replaced = core.replace(langs).map_err(|err| err.to_string());
    if let Some(profile) = reopen {
        if let Err(err) = held.open(core, profile) {
            // Nothing is loaded now, so the next profile opened is fresh.
            held.end_restore();
            return Err(err);
        }
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
    let meta = read_file(&root)
        .profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("not-found")?;
    let profile = profile_paths(&root, &meta);
    let open = blocking(app, move |core, session| open_profile(core, session, profile)).await?;
    set_last_opened(&root, &meta.id)?;
    Ok(open)
}

fn set_last_opened(root: &Path, id: &str) -> Result<(), String> {
    update_file(root, |file| {
        if file.profiles.iter().any(|p| p.id == id) {
            file.last_opened = Some(id.to_string());
        }
        Ok(())
    })
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
    blocking(app, move |core, session| {
        export_collection(core, &session.hold(), out_path, include_media, legacy)
    })
    .await
}

fn export_collection(core: &Core, held: &Held, out_path: String, include_media: bool, legacy: bool) -> Result<(), String> {
    use anki::services::BackendImportExportService;
    let profile = held.current().ok_or("no-profile")?;
    let result = core
        .backend()
        .export_collection_package(anki_proto::import_export::ExportCollectionPackageRequest {
            out_path,
            include_media,
            legacy,
        });
    let reopened = held.reopen(core, &profile);
    result.map_err(|err| err.to_string())?;
    reopened
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
    // The core fails to close only a collection that is not open.
    let request = open_request(&profile);
    let result = backend
        .close_collection(CloseCollectionRequest {
            downgrade_to_schema11: false,
        })
        .and_then(|()| {
            backend.import_collection_package(anki_proto::import_export::ImportCollectionPackageRequest {
                col_path: request.collection_path.clone(),
                backup_path: path,
                media_folder: request.media_folder_path.clone(),
                media_db: request.media_db_path.clone(),
            })
        });
    let reopened = held.reopen(core, &profile);
    result.map_err(|err| err.to_string())?;
    reopened
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

/// `name` in the folder of `profile`, which must be the open profile: the
/// interface names the profile it loaded, so a write that lands during a
/// profile switch is refused instead of reaching the next profile. Never
/// waits for the collection lock, so it answers while a backup runs.
fn profile_file(session: &Session, profile: &str, name: &str) -> Result<PathBuf, String> {
    match session.current() {
        Some(open) if open.id == profile => Ok(open.folder.join(name)),
        Some(_) => Err("profile-changed".into()),
        None => Err("no-profile".into()),
    }
}

#[tauri::command]
pub fn sync_account_get(session: State<'_, Session>, profile: String) -> Result<Option<SyncAccount>, String> {
    let path = profile_file(&session, &profile, "sync.json")?;
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

#[tauri::command]
pub fn sync_account_set(session: State<'_, Session>, profile: String, account: Option<SyncAccount>) -> Result<(), String> {
    write_sync_account(&session, &profile, account)
}

fn write_sync_account(session: &Session, profile: &str, account: Option<SyncAccount>) -> Result<(), String> {
    let path = profile_file(session, profile, "sync.json")?;
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

/// The preferences in `path`; Anki's defaults when there are none yet.
fn read_sync_prefs(path: &Path) -> SyncPrefs {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn sync_prefs_get(session: State<'_, Session>, profile: String) -> Result<SyncPrefs, String> {
    Ok(read_sync_prefs(&profile_file(&session, &profile, "sync-prefs.json")?))
}

/// Written whole or not at all: a torn file would read as the defaults and
/// turn syncing on open and close back on.
#[tauri::command]
pub fn sync_prefs_set(session: State<'_, Session>, profile: String, prefs: SyncPrefs) -> Result<(), String> {
    write_json(&profile_file(&session, &profile, "sync-prefs.json")?, &prefs)
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

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hayaki-{name}-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn profile_at(folder: PathBuf, id: &str) -> OpenProfile {
        OpenProfile {
            id: id.into(),
            name: id.into(),
            collection_path: folder.join("collection.anki2"),
            media_folder: folder.join("collection.media"),
            backup_folder: folder.join("backups"),
            folder,
        }
    }

    /// Puts a folder where the collection file was, so opening it fails, and
    /// returns a function that puts the file back.
    fn break_collection(profile: &OpenProfile) -> impl FnOnce() + '_ {
        let aside = profile.folder.join("aside.anki2");
        fs::rename(&profile.collection_path, &aside).unwrap();
        fs::create_dir(&profile.collection_path).unwrap();
        move || {
            fs::remove_dir(&profile.collection_path).unwrap();
            fs::rename(aside, &profile.collection_path).unwrap();
        }
    }

    #[test]
    fn writes_to_one_file_at_the_same_time_all_succeed() {
        let root = temp_root("write-json");
        let path = root.join("sync-prefs.json");
        let errors: Vec<String> = std::thread::scope(|scope| {
            let writers: Vec<_> = (0..8)
                .map(|_| scope.spawn(|| (0..100).find_map(|_| write_json(&path, &SyncPrefs::default()).err())))
                .collect();
            writers.into_iter().filter_map(|handle| handle.join().unwrap()).collect()
        });
        assert_eq!(errors, Vec::<String>::new());
        assert_eq!(read_sync_prefs(&path), SyncPrefs::default());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn profile_changes_at_the_same_time_all_land() {
        let root = temp_root("concurrent");
        let first = create_profile(&root, "First").unwrap();
        let root = root.as_path();
        let errors: Vec<String> = std::thread::scope(|scope| {
            let creating: Vec<_> = (0..8)
                .map(|n| scope.spawn(move || create_profile(root, &format!("Profile {n}")).err()))
                .collect();
            // The window opening the first profile twice, over and over.
            let opening: Vec<_> = (0..8)
                .map(|_| scope.spawn(|| (0..50).find_map(|_| set_last_opened(root, &first.id).err())))
                .collect();
            creating
                .into_iter()
                .chain(opening)
                .filter_map(|handle| handle.join().unwrap())
                .collect()
        });
        assert_eq!(errors, Vec::<String>::new());

        let file = read_file(root);
        let mut names: Vec<_> = file.profiles.iter().map(|p| p.name.clone()).collect();
        names.sort();
        let mut expected: Vec<_> = (0..8).map(|n| format!("Profile {n}")).collect();
        expected.push("First".into());
        expected.sort();
        assert_eq!(names, expected, "no profile is lost");
        assert_eq!(file.last_opened, Some(first.id));
        let leftovers: Vec<_> = fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name != "profiles" && name != "profiles.json")
            .collect();
        assert_eq!(leftovers, Vec::<String>::new(), "no temporary file is left behind");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_reopen_after_a_restore_does_not_carry_over_to_the_next_profile() {
        let root = temp_root("failed-reopen");
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let a = profile_at(root.join("a"), "a");
        let b = profile_at(root.join("b"), "b");
        open_profile(&core, &session, a.clone()).unwrap();
        session.hold().mark_restored();

        let repair = break_collection(&a);
        assert!(change_langs(&core, &session, vec!["ja".into()]).is_err());
        repair();
        assert!(session.current().is_none(), "the collection is not open");

        open_profile(&core, &session, b.clone()).unwrap();
        assert!(!session.restored());
        close_current(&core, &session, OnClose::Unload);
        assert_eq!(backups_in(&b), 1, "the next profile backs up on close");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_profile_whose_reopen_failed_opens_again_for_real() {
        let root = temp_root("reopen");
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let a = profile_at(root.join("a"), "a");
        open_profile(&core, &session, a.clone()).unwrap();

        let repair = break_collection(&a);
        let out = root.join("export.colpkg").to_string_lossy().into_owned();
        assert!(export_collection(&core, &session.hold(), out, false, false).is_err());
        repair();
        assert!(session.current().is_none(), "the collection is not open");

        open_profile(&core, &session, a.clone()).unwrap();
        let created = core.backend().create_backup(backup_request(&a, true));
        assert!(created.is_ok(), "the collection is open: {created:?}");
        close_current(&core, &session, OnClose::Unload);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_sync_account_for_another_profile_is_refused() {
        let root = temp_root("sync-account");
        let session = Session::default();
        let b = profile_at(root.join("b"), "b");
        fs::create_dir_all(&b.folder).unwrap();
        let account = SyncAccount {
            hkey: "key-of-a".into(),
            ..Default::default()
        };

        assert!(write_sync_account(&session, "a", Some(account.clone())).is_err(), "nothing open");
        *session.current.write().unwrap() = Some(b.clone());
        // A's sign-in finishes after the switch to B.
        assert_eq!(
            write_sync_account(&session, "a", Some(account.clone())),
            Err("profile-changed".into())
        );
        assert!(!b.folder.join("sync.json").exists(), "B keeps no account of A's");

        write_sync_account(&session, "b", Some(account)).unwrap();
        assert!(b.folder.join("sync.json").exists());
        let _ = fs::remove_dir_all(root);
    }
}

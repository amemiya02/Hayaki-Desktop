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
use std::sync::RwLock;

use anki::services::BackendCollectionService;
use anki::backend::Backend;
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

#[derive(Default)]
pub struct Session {
    current: RwLock<Option<OpenProfile>>,
    /// A backup was restored into the open profile. As in Anki, automatic
    /// backups (and syncs) stay off until the profile closes.
    restored: AtomicBool,
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

fn write_file(root: &Path, file: &ProfilesFile) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(file).map_err(|err| err.to_string())?;
    let tmp = root.join("profiles.json.tmp");
    fs::write(&tmp, json).map_err(|err| err.to_string())?;
    fs::rename(&tmp, root.join("profiles.json")).map_err(|err| err.to_string())
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

#[tauri::command]
pub fn profile_delete(app: AppHandle, session: State<'_, Session>, id: String) -> Result<ProfilesState, String> {
    if session.current().is_some_and(|p| p.id == id) {
        return Err("profile-open".into());
    }
    let root = data_root(&app)?;
    let mut file = read_file(&root);
    file.profiles.retain(|p| p.id != id);
    if file.last_opened.as_deref() == Some(id.as_str()) {
        file.last_opened = None;
    }
    write_file(&root, &file)?;
    let folder = root.join("profiles").join(&id);
    if folder.exists() {
        fs::remove_dir_all(folder).map_err(|err| err.to_string())?;
    }
    state(&app, &session)
}

/// Whether closing the collection makes a backup first.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OnClose {
    /// As Anki does when a profile closes: a backup if the collection changed
    /// and the minimum interval has passed since the last one.
    Backup,
    /// The collection is reopened at once (a language change).
    NoBackup,
}

/// Closes the open collection, if any. Safe to call more than once.
pub fn close_current(core: &Core, session: &Session, on_close: OnClose) {
    let mut current = session.current.write().unwrap();
    let Some(profile) = current.take() else {
        return;
    };
    let restored = session.restored.swap(false, Ordering::SeqCst);
    let backend = core.backend();
    if on_close == OnClose::Backup && !restored {
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
}

/// A backup into the profile's backup folder, waiting until it is written.
pub fn backup_request(profile: &OpenProfile, force: bool) -> CreateBackupRequest {
    CreateBackupRequest {
        backup_folder: profile.backup_folder.to_string_lossy().into_owned(),
        force,
        wait_for_completion: true,
    }
}

#[tauri::command]
pub async fn profile_open(
    app: AppHandle,
    core: State<'_, Core>,
    session: State<'_, Session>,
    id: String,
) -> Result<OpenProfile, String> {
    let root = data_root(&app)?;
    let mut file = read_file(&root);
    let meta = file
        .profiles
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("not-found")?;
    close_current(&core, &session, OnClose::Backup);

    let folder = root.join("profiles").join(&meta.id);
    let media_folder = folder.join("collection.media");
    let backup_folder = folder.join("backups");
    fs::create_dir_all(&media_folder).map_err(|err| err.to_string())?;
    fs::create_dir_all(&backup_folder).map_err(|err| err.to_string())?;
    let collection_path = folder.join("collection.anki2");
    let request = OpenCollectionRequest {
        collection_path: collection_path.to_string_lossy().into_owned(),
        media_folder_path: media_folder.to_string_lossy().into_owned(),
        media_db_path: folder.join("collection.media.db2").to_string_lossy().into_owned(),
    };
    let backend = core.backend();
    tauri::async_runtime::spawn_blocking(move || backend.open_collection(request))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;

    let open = OpenProfile {
        id: meta.id.clone(),
        name: meta.name.clone(),
        folder,
        collection_path,
        media_folder,
        backup_folder,
    };
    *session.current.write().unwrap() = Some(open.clone());
    file.last_opened = Some(meta.id);
    write_file(&root, &file)?;
    Ok(open)
}

#[tauri::command]
pub async fn profile_close(core: State<'_, Core>, session: State<'_, Session>) -> Result<(), String> {
    close_current(&core, &session, OnClose::Backup);
    Ok(())
}

/// Restarts the core in another interface language, reopening the current
/// collection afterwards.
#[tauri::command]
pub async fn set_core_langs(
    app: AppHandle,
    core: State<'_, Core>,
    session: State<'_, Session>,
    langs: Vec<String>,
) -> Result<(), String> {
    let reopen = session.current().map(|p| p.id);
    close_current(&core, &session, OnClose::NoBackup);
    core.replace(langs).map_err(|err| err.to_string())?;
    if let Some(id) = reopen {
        profile_open(app, core, session, id).await?;
    }
    Ok(())
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
    core: State<'_, Core>,
    session: State<'_, Session>,
    out_path: String,
    include_media: bool,
    legacy: bool,
) -> Result<(), String> {
    use anki::services::BackendImportExportService;
    let profile = session.current().ok_or("no-profile")?;
    let backend = core.backend();
    tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|err| err.to_string())?
}

/// Replaces the profile's collection with a `.colpkg`. A backup of the current
/// collection is made first, and the collection is opened again afterwards
/// whatever the outcome.
pub fn replace_collection(backend: &Backend, profile: &OpenProfile, path: String) -> Result<(), String> {
    use anki::services::BackendImportExportService;
    // The result says whether a backup was written; a refusal is an error.
    let _ = backend
        .create_backup(backup_request(profile, true))
        .map_err(|err| err.to_string())?;
    backend
        .close_collection(CloseCollectionRequest {
            downgrade_to_schema11: false,
        })
        .map_err(|err| err.to_string())?;
    let request = open_request(profile);
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
pub async fn collection_import_colpkg(
    core: State<'_, Core>,
    session: State<'_, Session>,
    path: String,
) -> Result<(), String> {
    let profile = session.current().ok_or("no-profile")?;
    let backend = core.backend();
    tauri::async_runtime::spawn_blocking(move || replace_collection(&backend, &profile, path))
        .await
        .map_err(|err| err.to_string())?
}

/// Marks the open profile as restored from a backup.
pub fn mark_restored(session: &Session) {
    session.restored.store(true, Ordering::SeqCst);
}

/// Makes a backup of the open collection now, into the profile's backup folder.
#[tauri::command]
pub async fn collection_backup(core: State<'_, Core>, session: State<'_, Session>) -> Result<bool, String> {
    let profile = session.current().ok_or("no-profile")?;
    let backend = core.backend();
    tauri::async_runtime::spawn_blocking(move || {
        backend
            .create_backup(backup_request(&profile, true))
            .map(|created| created.val)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
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
        Some(account) => {
            let json = serde_json::to_vec_pretty(&account).map_err(|err| err.to_string())?;
            fs::write(path, json).map_err(|err| err.to_string())
        }
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

#[tauri::command]
pub fn sync_prefs_get(session: State<'_, Session>) -> Result<SyncPrefs, String> {
    let path = sync_prefs_file(&session)?;
    Ok(fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn sync_prefs_set(session: State<'_, Session>, prefs: SyncPrefs) -> Result<(), String> {
    let path = sync_prefs_file(&session)?;
    let json = serde_json::to_vec_pretty(&prefs).map_err(|err| err.to_string())?;
    fs::write(path, json).map_err(|err| err.to_string())
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

        close_current(&core, &session, OnClose::Backup);
        assert!(session.current().is_none());
        assert_eq!(backups_in(&profile), 1, "a new collection is backed up on close");
        // The collection is closed: it opens again.
        core.backend().open_collection(open_request(&profile)).unwrap();
        core.backend()
            .close_collection(CloseCollectionRequest { downgrade_to_schema11: false })
            .unwrap();
        // Closing again with nothing open is harmless.
        close_current(&core, &session, OnClose::Backup);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_restored_profile_closes_without_a_backup() {
        let dir = std::env::temp_dir().join(format!("hayaki-restored-test-{}", std::process::id()));
        let core = Core::new(vec!["en".into()]).unwrap();
        let session = Session::default();
        let profile = open_in(&dir, &core, &session);

        mark_restored(&session);
        close_current(&core, &session, OnClose::Backup);
        assert_eq!(backups_in(&profile), 0);
        assert!(!session.restored(), "the next profile opened backs up again");
        let _ = fs::remove_dir_all(dir);
    }
}

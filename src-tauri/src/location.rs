// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Where Hayaki keeps its data: the app's data directory, or a folder the
//! person chose. The choice is a pointer file in the app's data directory
//! (which also holds the WebView's own data, never moved). It is read once per
//! launch, so a change takes effect when the app restarts.

use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::core::Core;
use crate::profiles::OnClose;
use crate::profiles::Session;

const POINTER: &str = "data-location.json";

/// What Hayaki keeps in its data folder, and so what a move copies. The
/// plugins' staging folder and run marker belong to one launch only.
const ENTRIES: &[&str] = &[
    "profiles",
    "profiles.json",
    "ankiconnect.json",
    "plugins",
    "plugin-state.json",
    "plugin-data",
];
const SKIPPED: &[&str] = &[".staging"];

#[derive(Serialize, Deserialize, Default)]
struct Pointer {
    path: Option<PathBuf>,
}

fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|err| err.to_string())
}

fn chosen(app: &AppHandle) -> Option<PathBuf> {
    let pointer: Pointer = fs::read(default_root(app).ok()?.join(POINTER))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())?;
    pointer.path.filter(|path| path.is_absolute())
}

/// The data folder of this launch.
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    if let Some(root) = ROOT.get() {
        return Ok(root.clone());
    }
    let root = match chosen(app) {
        Some(path) => path,
        None => default_root(app)?,
    };
    Ok(ROOT.get_or_init(|| root).clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFolder {
    path: String,
    default_path: String,
    is_default: bool,
}

#[tauri::command]
pub fn data_folder_get(app: AppHandle) -> Result<DataFolder, String> {
    let path = root(&app)?;
    let default_path = default_root(&app)?;
    Ok(DataFolder {
        is_default: same(&path, &default_path),
        path: path.to_string_lossy().into_owned(),
        default_path: default_path.to_string_lossy().into_owned(),
    })
}

/// `path` made absolute and free of links through its nearest existing
/// ancestor, so a folder not made yet compares like one that exists.
fn canonical(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut base = path;
    loop {
        if let Ok(found) = fs::canonicalize(base) {
            return rest.iter().rev().fold(found, |acc, part| acc.join(part));
        }
        match (base.parent(), base.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                base = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

fn same(a: &Path, b: &Path) -> bool {
    canonical(a) == canonical(b)
}

/// What a folder offered as the new data folder holds.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FolderKind {
    /// The data folder already.
    Current,
    /// Inside the data folder, or the data folder inside it.
    Nested,
    /// Hayaki data from before: it is used as it is.
    Existing,
    /// Empty or missing: the data is copied there.
    Empty,
    /// Holds other files: refused, so nothing of the person's is mixed in.
    Occupied,
}

fn classify(current: &Path, target: &Path) -> FolderKind {
    if same(current, target) {
        return FolderKind::Current;
    }
    let (current, target) = (canonical(current), canonical(target));
    if target.starts_with(&current) || current.starts_with(&target) {
        return FolderKind::Nested;
    }
    if target.join("profiles.json").is_file() {
        return FolderKind::Existing;
    }
    match fs::read_dir(&target).map(|mut entries| entries.next().is_none()) {
        Err(_) | Ok(true) => FolderKind::Empty,
        Ok(false) => FolderKind::Occupied,
    }
}

fn target_path(app: &AppHandle, path: Option<String>) -> Result<PathBuf, String> {
    match path {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("not-absolute".into());
            }
            Ok(path)
        }
        None => default_root(app),
    }
}

/// `path` is the folder offered; none is the default one.
#[tauri::command]
pub fn data_folder_check(app: AppHandle, path: Option<String>) -> Result<FolderKind, String> {
    Ok(classify(&root(&app)?, &target_path(&app, path)?))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        if SKIPPED.iter().any(|name| entry.file_name() == *name) {
            continue;
        }
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Copies Hayaki's data from `from` into the empty `to`. On failure, what was
/// copied is removed again; `from` is never touched.
fn copy_data(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|err| err.to_string())?;
    let copied = ENTRIES.iter().try_for_each(|name| {
        let source = from.join(name);
        if source.is_dir() {
            copy_dir(&source, &to.join(name))
        } else if source.is_file() {
            fs::copy(&source, to.join(name)).map(|_| ())
        } else {
            Ok(())
        }
    });
    if let Err(err) = copied {
        for name in ENTRIES {
            let path = to.join(name);
            let _ = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
        }
        return Err(err.to_string());
    }
    Ok(())
}

fn write_pointer(app: &AppHandle, target: &Path) -> Result<(), String> {
    let default = default_root(app)?;
    fs::create_dir_all(&default).map_err(|err| err.to_string())?;
    let pointer = Pointer {
        path: (!same(target, &default)).then(|| target.to_path_buf()),
    };
    let json = serde_json::to_vec_pretty(&pointer).map_err(|err| err.to_string())?;
    fs::write(default.join(POINTER), json).map_err(|err| err.to_string())
}

/// Makes `path` (none: the default folder) the data folder and restarts the
/// app. An empty folder gets a copy of the current data, which stays where it
/// was; a folder with Hayaki data from before is used as it is. The open
/// profile is closed first, and opened again if anything fails.
#[tauri::command]
pub async fn data_folder_set(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let target = target_path(&app, path)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let current = root(&handle)?;
        let kind = classify(&current, &target);
        match kind {
            FolderKind::Existing | FolderKind::Empty => {}
            FolderKind::Current => return Ok(()),
            other => return Err(format!("{other:?}").to_lowercase()),
        }
        let core = handle.state::<Core>();
        let session = handle.state::<Session>();
        {
            use anki::services::BackendSyncService;
            let _ = core.backend().abort_sync();
            let _ = core.backend().abort_media_sync();
        }
        let held = session.hold();
        let open = held.current();
        held.close(&core, OnClose::Unload);
        let moved = match kind {
            FolderKind::Empty => copy_data(&current, &target),
            _ => Ok(()),
        }
        .and_then(|()| write_pointer(&handle, &target));
        if let Err(err) = moved {
            if let Some(profile) = open {
                let _ = held.open(&core, profile);
            }
            return Err(err);
        }
        drop(held);
        handle.request_restart();
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hayaki-location-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn classifies_the_folders_offered() {
        let root = temp("classify");
        let current = root.join("current");
        fs::create_dir_all(&current).unwrap();
        assert_eq!(classify(&current, &current), FolderKind::Current);
        assert_eq!(classify(&current, &current.join("inner")), FolderKind::Nested);
        assert_eq!(classify(&current, &root), FolderKind::Nested);
        assert_eq!(classify(&current, &root.join("missing")), FolderKind::Empty);
        let other = root.join("other");
        fs::create_dir_all(&other).unwrap();
        assert_eq!(classify(&current, &other), FolderKind::Empty);
        fs::write(other.join("notes.txt"), "mine").unwrap();
        assert_eq!(classify(&current, &other), FolderKind::Occupied);
        fs::write(other.join("profiles.json"), "{}").unwrap();
        assert_eq!(classify(&current, &other), FolderKind::Existing);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copies_only_hayakis_data() {
        let root = temp("copy");
        let from = root.join("from");
        fs::create_dir_all(from.join("profiles/a/collection.media")).unwrap();
        fs::write(from.join("profiles/a/collection.anki2"), "db").unwrap();
        fs::write(from.join("profiles.json"), "{}").unwrap();
        fs::create_dir_all(from.join("plugins/.staging/x")).unwrap();
        fs::create_dir_all(from.join("EBWebView")).unwrap();
        fs::write(from.join("plugin-run.json"), "{}").unwrap();

        let to = root.join("to");
        copy_data(&from, &to).unwrap();
        assert!(to.join("profiles/a/collection.anki2").is_file());
        assert!(to.join("profiles/a/collection.media").is_dir());
        assert!(to.join("profiles.json").is_file());
        assert!(to.join("plugins").is_dir());
        assert!(!to.join("plugins/.staging").exists());
        assert!(!to.join("EBWebView").exists());
        assert!(!to.join("plugin-run.json").exists());
        assert!(from.join("profiles/a/collection.anki2").is_file(), "the source stays");
        let _ = fs::remove_dir_all(root);
    }
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Checking for a newer Hayaki, downloading it and installing it. The release
//! workflow signs the installers and publishes `latest.json` with each GitHub
//! release; the updater only installs what that key signed. Installing closes
//! the collection first, as quitting does, and the app restarts on the new
//! version.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;
use tauri_plugin_updater::Update;
use tauri_plugin_updater::UpdaterExt;

use crate::core::Core;
use crate::profiles::OnClose;
use crate::profiles::Session;

/// The update found by the last check, and its installer once downloaded.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Option<Vec<u8>>)>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    /// The release notes, in Markdown.
    notes: Option<String>,
    /// Seconds since 1970.
    date: Option<i64>,
}

/// The newer version, if there is one.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|err| err.to_string())?
        .check()
        .await
        .map_err(|err| err.to_string())?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        date: update.date.map(|date| date.unix_timestamp()),
    });
    *pending.0.lock().unwrap() = update.map(|update| (update, None));
    Ok(info)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// Downloads the update the last check found, reporting progress.
#[tauri::command]
pub async fn update_download(
    pending: State<'_, Pending>,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let update = match pending.0.lock().unwrap().as_ref() {
        Some((update, _)) => update.clone(),
        None => return Err("no-update".into()),
    };
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;
    let mut pending = pending.0.lock().unwrap();
    match pending.as_mut() {
        Some((found, slot)) if found.version == update.version => *slot = Some(bytes),
        _ => return Err("no-update".into()),
    }
    Ok(())
}

/// Closes the collection, installs the downloaded update and restarts. On
/// Windows the installer takes over and the process ends here. If installing
/// fails, the profile that was open opens again.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let (update, bytes) = match app.state::<Pending>().0.lock().unwrap().take() {
        Some((update, Some(bytes))) => (update, bytes),
        other => {
            *app.state::<Pending>().0.lock().unwrap() = other;
            return Err("not-downloaded".into());
        }
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
        // The Windows installer ends the process without the usual exit.
        crate::plugins::finish_session(&handle, true);
        if let Err(err) = update.install(&bytes) {
            if let Some(profile) = open {
                let _ = held.open(&core, profile);
            }
            *handle.state::<Pending>().0.lock().unwrap() = Some((update, Some(bytes)));
            return Err(err.to_string());
        }
        drop(held);
        handle.request_restart();
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

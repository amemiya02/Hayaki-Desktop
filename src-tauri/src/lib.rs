// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

mod core;
mod media;
mod profiles;

use serde::Serialize;
use tauri::Manager;

use crate::core::Core;
use crate::profiles::Session;

const ANKI_VERSION: &str = include_str!("../../vendor/anki/.version");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    anki_version: String,
    data_dir: String,
    langs: Vec<String>,
    platform: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, core: tauri::State<'_, Core>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        anki_version: ANKI_VERSION.trim().to_string(),
        data_dir: app
            .path()
            .app_data_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        langs: core.langs(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// The system's preferred languages, as BCP 47 tags, most preferred first.
fn system_langs() -> Vec<String> {
    let mut langs: Vec<String> = sys_locale::get_locales().collect();
    if langs.is_empty() {
        langs.push("en-US".into());
    }
    langs
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The core names its client in every sync request; identify Hayaki.
    if std::env::var_os("PLATFORM").is_none() {
        std::env::set_var(
            "PLATFORM",
            format!(
                "hayaki:{}:desktop:{}",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            ),
        );
    }

    let core = Core::new(system_langs()).expect("the Anki core failed to start");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(core)
        .manage(Session::default())
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let folder = ctx.app_handle().state::<Session>().media_folder();
            std::thread::spawn(move || responder.respond(media::serve(folder, &request)));
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            core::core_call,
            profiles::profiles_list,
            profiles::profile_create,
            profiles::profile_rename,
            profiles::profile_delete,
            profiles::profile_open,
            profiles::profile_close,
            profiles::set_core_langs,
            profiles::sync_account_get,
            profiles::sync_account_set,
            media::read_chosen_file,
            profiles::collection_export_colpkg,
            profiles::collection_import_colpkg,
            profiles::collection_backup,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Hayaki");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            profiles::shutdown(&handle.state::<Core>(), &handle.state::<Session>());
        }
    });
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! A built-in AnkiConnect server, so Yomitan, browser extensions and scripts
//! that speak AnkiConnect's protocol (version 6) work with Hayaki as they do
//! with Anki and the AnkiConnect add-on. Off until the person turns it on in
//! Settings; it listens on 127.0.0.1 only.
//!
//! The interface learns what happened through events: `ankiconnect:changed`
//! (refresh as after its own edits), `ankiconnect:browse`,
//! `ankiconnect:add-cards`, `ankiconnect:sync`, `ankiconnect:permission` (ask
//! the person, answer with `ankiconnect_permission_reply`),
//! `ankiconnect:permission-closed` (the prompt timed out) and
//! `ankiconnect:status`.

mod access;
mod actions;
mod calls;
mod config;
mod media;
mod prompts;
mod protocol;
mod server;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use self::calls::Col;
pub use self::config::Config;
use self::prompts::Prompts;
use self::protocol::Event;
use self::protocol::Host;
use crate::core::Core;
use crate::profiles::Session;

/// How long a permission prompt waits for an answer before it counts as no.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    Off,
    Listening { port: u16 },
    #[serde(rename_all = "camelCase")]
    Failed { port: u16, in_use: bool, message: String },
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    config: Config,
    status: Status,
}

struct Shared {
    app: AppHandle,
    path: PathBuf,
    /// Writers hold the write lock from reading the old settings to storing
    /// the new ones, so a granted origin and a change in Settings never undo
    /// each other.
    config: RwLock<Config>,
    prompts: Prompts,
}

pub struct AnkiConnect {
    shared: Arc<Shared>,
    running: Mutex<Option<server::Running>>,
    status: Mutex<Status>,
}

impl AnkiConnect {
    /// Loads the settings and starts the server if it is turned on.
    pub fn init(app: &AppHandle) {
        let path = app.path().app_data_dir().unwrap_or_default().join("ankiconnect.json");
        let config = Config::load(&path);
        let state = AnkiConnect {
            shared: Arc::new(Shared { app: app.clone(), path, config: RwLock::new(config), prompts: Prompts::default() }),
            running: Mutex::new(None),
            status: Mutex::new(Status::Off),
        };
        state.apply();
        app.manage(state);
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot { config: self.shared.config(), status: self.status.lock().unwrap().clone() }
    }

    /// Starts, stops or moves the server to match the settings. Origins and
    /// the key are read on every request, so changing them needs no restart.
    fn apply(&self) {
        let config = self.shared.config();
        let mut running = self.running.lock().unwrap();
        let status = if !config.enabled {
            *running = None;
            Status::Off
        } else if running.as_ref().is_some_and(|r| r.port == config.port) {
            Status::Listening { port: config.port }
        } else {
            let restarting = running.take().is_some();
            // A server just stopped may hold the port for a moment.
            let mut attempt = 0;
            loop {
                match server::start(self.shared.clone(), config.port) {
                    Ok(started) => {
                        *running = Some(started);
                        break Status::Listening { port: config.port };
                    }
                    Err(err) if err.in_use && restarting && attempt < 20 => {
                        attempt += 1;
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(err) => break Status::Failed { port: config.port, in_use: err.in_use, message: err.message },
                }
            }
        };
        *self.status.lock().unwrap() = status;
        let _ = self.shared.app.emit("ankiconnect:status", self.snapshot());
    }
}

impl Shared {
    fn update_config(&self, change: impl FnOnce(&mut Config)) -> Result<(), String> {
        let mut config = self.config.write().unwrap();
        let mut next = config.clone();
        change(&mut next);
        let next = next.normalized();
        next.save(&self.path)?;
        *config = next;
        Ok(())
    }
}

fn op_changes_json(c: &anki_proto::collection::OpChanges) -> serde_json::Value {
    json!({
        "card": c.card, "note": c.note, "deck": c.deck, "tag": c.tag, "notetype": c.notetype,
        "config": c.config, "deckConfig": c.deck_config, "mtime": c.mtime, "browserTable": c.browser_table,
        "browserSidebar": c.browser_sidebar, "noteText": c.note_text, "studyQueues": c.study_queues,
    })
}

impl Host for Shared {
    /// Holds the session's collection lock for as long as the action runs,
    /// so the profile (and with it the media folder) cannot change under it.
    fn collection(&self) -> Option<Col<'_>> {
        let held = self.app.state::<Session>().inner().hold();
        let profile = held.current()?;
        Some(Col { backend: self.app.state::<Core>().backend(), profile: profile.name, media_folder: profile.media_folder, _held: Some(held) })
    }

    fn config(&self) -> Config {
        self.config.read().unwrap().clone()
    }

    fn notify(&self, event: Event) {
        let _ = match event {
            Event::Changed(changes) => self.app.emit("ankiconnect:changed", op_changes_json(&changes)),
            Event::Browse(query) => self.app.emit("ankiconnect:browse", json!({ "query": query })),
            // Ids go as strings: the interface reads them as bigints.
            Event::AddCards(prefill) => self.app.emit(
                "ankiconnect:add-cards",
                json!({
                    "notetypeId": prefill.notetype_id.to_string(),
                    "deckId": prefill.deck_id.to_string(),
                    "fields": prefill.fields,
                    "tags": prefill.tags,
                }),
            ),
            Event::Sync => self.app.emit("ankiconnect:sync", ()),
        };
    }

    fn ask_permission(&self, origin: &str) -> bool {
        let allowed = self.prompts.ask(
            origin,
            PROMPT_TIMEOUT,
            |id| {
                let _ = self.app.emit("ankiconnect:permission", json!({ "id": id, "origin": origin }));
            },
            |id| {
                let _ = self.app.emit("ankiconnect:permission-closed", json!({ "id": id }));
            },
        );
        if !allowed || self.update_config(|config| config.origins.push(origin.to_string())).is_err() {
            return false;
        }
        let _ = self.app.emit("ankiconnect:status", self.app.state::<AnkiConnect>().snapshot());
        true
    }
}

#[tauri::command]
pub fn ankiconnect_get(state: State<'_, AnkiConnect>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub async fn ankiconnect_set(app: AppHandle, config: Config) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AnkiConnect>();
        state.shared.update_config(|current| *current = config)?;
        state.apply();
        Ok(state.snapshot())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn ankiconnect_permission_reply(state: State<'_, AnkiConnect>, id: u64, allow: bool) {
    state.shared.prompts.reply(id, allow);
}

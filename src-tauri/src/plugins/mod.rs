// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Installed plugins (ADR 0004). Plugins live in `<app data>/plugins/<id>/`,
//! shared by every profile. Next to that folder, never inside a plugin's own
//! files, sit `plugin-state.json` (enabled, failed and the install, per
//! plugin), `plugin-data/<id>.json` (each plugin's storage) and
//! `plugin-run.json` (the freeze guard's marker, see `guard`).
//!
//! Installing takes two calls: `plugin_install_stage` copies the package into
//! a staging folder and returns its manifest, so the interface can show the
//! permissions; `plugin_install_commit` moves that staged copy into place
//! once the person confirms.

pub mod guard;
mod manifest;
mod package;
pub mod scheme;
mod storage;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use std::time::SystemTime;

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tauri::Manager;

use guard::Guard;
use manifest::valid_id;
use manifest::Manifest;
use scheme::FrameTickets;

const STAGING: &str = ".staging";

/// Serialises every read-modify-write of the state and storage files.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
struct PluginState {
    enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failed: Option<String>,
    /// Which install this is, new with every install or update.
    #[serde(default)]
    install: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StateFile {
    #[serde(default)]
    plugins: BTreeMap<String, PluginState>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    /// The plugin's folder name, which is its id when the manifest is valid.
    id: String,
    manifest: Option<Manifest>,
    /// Why the installed copy cannot run (for example its manifest is invalid).
    error: Option<String>,
    enabled: bool,
    /// Why the plugin stopped; cleared when it is enabled again.
    failed: Option<String>,
    /// Changes with every install, so the interface reloads an updated plugin.
    install: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
    plugins: Vec<InstalledPlugin>,
    /// The person started Hayaki without plugins this time.
    paused: bool,
    /// Plugins the freeze guard turned off at this launch.
    stopped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPlugin {
    token: String,
    manifest: Manifest,
    /// The installed manifest, when this install replaces it.
    replaces: Option<Manifest>,
}

/// This launch's plugin state in the shell.
pub struct PluginSession {
    paused: bool,
    stopped: Vec<String>,
    guard: Guard,
    pub tickets: FrameTickets,
}

impl PluginSession {
    pub fn plugins_active(&self) -> bool {
        self.guard.active()
    }
}

pub struct Paths {
    data: PathBuf,
}

impl Paths {
    pub fn new(data: PathBuf) -> Self {
        Self { data }
    }

    pub fn plugins(&self) -> PathBuf {
        self.data.join("plugins")
    }

    fn staging(&self) -> PathBuf {
        self.plugins().join(STAGING)
    }

    fn state(&self) -> PathBuf {
        self.data.join("plugin-state.json")
    }

    fn storage(&self, id: &str) -> PathBuf {
        self.data.join("plugin-data").join(format!("{id}.json"))
    }

    fn run_marker(&self) -> PathBuf {
        self.data.join("plugin-run.json")
    }
}

fn paths(app: &AppHandle) -> Result<Paths, String> {
    crate::location::root(app).map(Paths::new)
}

pub fn plugins_root(app: &AppHandle) -> Option<PathBuf> {
    paths(app).ok().map(|p| p.plugins())
}

fn read_state(paths: &Paths) -> StateFile {
    fs::read(paths.state())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_state(paths: &Paths, state: &StateFile) -> Result<(), String> {
    fs::create_dir_all(&paths.data).map_err(|err| err.to_string())?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    let temp = paths.state().with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|err| err.to_string())?;
    fs::rename(&temp, paths.state()).map_err(|err| err.to_string())
}

fn update_state(paths: &Paths, id: &str, change: impl FnOnce(&mut PluginState)) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read_state(paths);
    change(state.plugins.entry(id.to_string()).or_default());
    write_state(paths, &state)
}

fn checked_id(id: &str) -> Result<(), String> {
    valid_id(id).then_some(()).ok_or_else(|| "invalid plugin id".to_string())
}

fn installed_dir(paths: &Paths, id: &str) -> Result<PathBuf, String> {
    checked_id(id)?;
    let dir = paths.plugins().join(id);
    dir.is_dir().then_some(dir).ok_or_else(|| "the plugin is not installed".to_string())
}

pub fn list(paths: &Paths) -> Vec<InstalledPlugin> {
    let state = read_state(paths);
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(paths.plugins()) else {
        return out;
    };
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        let parsed = if valid_id(&id) {
            package::read_installed(&entry.path()).and_then(|m| {
                if m.id == id {
                    Ok(m)
                } else {
                    Err(format!("the folder is named {id}, but the manifest's id is {}", m.id))
                }
            })
        } else {
            Err("the folder name is not a valid plugin id".into())
        };
        let s = state.plugins.get(&id).cloned().unwrap_or_default();
        let (manifest, error) = match parsed {
            Ok(m) => (Some(m), None),
            Err(e) => (None, Some(e)),
        };
        out.push(InstalledPlugin { id, manifest, error, enabled: s.enabled, failed: s.failed, install: s.install });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn new_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{nanos:x}-{:x}-{:x}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 64 && token.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// Removes staged installs nobody confirmed within an hour.
fn sweep_staging(paths: &Paths) {
    let Ok(entries) = fs::read_dir(paths.staging()) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > Duration::from_secs(3600));
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn stage(paths: &Paths, source: &Path) -> Result<StagedPlugin, String> {
    sweep_staging(paths);
    let token = new_token();
    let staging = paths.staging().join(&token);
    fs::create_dir_all(&staging).map_err(|err| err.to_string())?;
    match package::stage(source, &staging, package::LIMITS) {
        Ok(manifest) => {
            let replaces = package::read_installed(&paths.plugins().join(&manifest.id)).ok();
            Ok(StagedPlugin { token, manifest, replaces })
        }
        Err(err) => {
            let _ = fs::remove_dir_all(&staging);
            Err(err)
        }
    }
}

/// Moves a staged copy into place, replacing any installed version. A new
/// plugin starts on; an update keeps whether the person had it on or off,
/// and its stored data.
pub fn commit(paths: &Paths, token: &str) -> Result<Manifest, String> {
    if !valid_token(token) {
        return Err("invalid install token".into());
    }
    let staged = paths.staging().join(token);
    // Read again from the staged files: what was confirmed is what runs.
    let manifest = package::read_installed(&staged)?;
    let target = paths.plugins().join(&manifest.id);
    let old = paths.staging().join(format!("{token}-old"));
    if target.exists() {
        fs::rename(&target, &old).map_err(|err| err.to_string())?;
    }
    if let Err(err) = fs::rename(&staged, &target) {
        if old.exists() {
            let _ = fs::rename(&old, &target);
        }
        return Err(err.to_string());
    }
    let _ = fs::remove_dir_all(&old);
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read_state(paths);
    let entry = state.plugins.entry(manifest.id.clone()).or_insert_with(|| PluginState { enabled: true, ..Default::default() });
    entry.failed = None;
    entry.install = token.to_string();
    write_state(paths, &state)?;
    Ok(manifest)
}

pub fn cancel(paths: &Paths, token: &str) -> Result<(), String> {
    if !valid_token(token) {
        return Err("invalid install token".into());
    }
    let staged = paths.staging().join(token);
    if staged.exists() {
        fs::remove_dir_all(staged).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn uninstall(paths: &Paths, id: &str) -> Result<(), String> {
    let dir = installed_dir(paths, id)?;
    fs::remove_dir_all(dir).map_err(|err| err.to_string())?;
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read_state(paths);
    state.plugins.remove(id);
    write_state(paths, &state)?;
    let _ = fs::remove_file(paths.storage(id));
    Ok(())
}

/// Turns off what froze the app last time and decides whether plugins run at
/// all this launch. Called once, before the interface loads.
pub fn start_session(app: &AppHandle) -> PluginSession {
    let tickets = FrameTickets::default();
    let Ok(paths) = paths(app) else {
        // With no data folder there are no plugins to run.
        let guard = Guard::new(std::env::temp_dir().join("hayaki-plugin-run.json"));
        return PluginSession { paused: true, stopped: Vec::new(), guard, tickets };
    };
    let guard = Guard::new(paths.run_marker());
    let mut stopped = Vec::new();
    if let Some(marker) = guard.take_previous() {
        let installed = list(&paths);
        for id in guard::blame(&marker) {
            let on = installed.iter().any(|p| p.id == id && p.enabled);
            if on && update_state(&paths, &id, |s| s.failed = Some(guard::FROZE.into())).is_ok() {
                stopped.push(id);
            }
        }
    }
    PluginSession { paused: guard::start_without_plugins(), stopped, guard, tickets }
}

/// Watches the interface's beats from a thread of its own.
pub fn start_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        app.state::<PluginSession>().guard.check();
    });
}

/// At exit: see `Guard::finish`.
pub fn finish_session(app: &AppHandle, interface_answered: bool) {
    if let Some(session) = app.try_state::<PluginSession>() {
        session.guard.finish(interface_answered);
    }
}

#[tauri::command]
pub async fn plugins_list(app: AppHandle) -> Result<PluginList, String> {
    let paths = paths(&app)?;
    let plugins = tauri::async_runtime::spawn_blocking(move || list(&paths)).await.map_err(|err| err.to_string())?;
    let session = app.state::<PluginSession>();
    Ok(PluginList { plugins, paused: session.paused, stopped: session.stopped.clone() })
}

/// The interface's report of the plugins running and loading: sent, and
/// awaited, before any plugin frame loads, then every 2 seconds.
#[tauri::command]
pub async fn plugins_heartbeat(
    app: AppHandle,
    page: String,
    seq: u64,
    running: Vec<String>,
    loading: Vec<String>,
) -> Result<(), String> {
    if page.len() > 64 || running.len() > 256 || loading.len() > 256 || !running.iter().chain(&loading).all(|id| valid_id(id)) {
        return Err("invalid plugin ids".into());
    }
    tauri::async_runtime::spawn_blocking(move || app.state::<PluginSession>().guard.beat(&page, seq, running, loading))
        .await
        .map_err(|err| err.to_string())?
}

/// A one-use ticket for a plugin page (see `scheme`), taken just before a
/// frame loads it.
#[tauri::command]
pub fn plugin_frame_ticket(session: tauri::State<'_, PluginSession>, path: String) -> Result<String, String> {
    session.tickets.issue(&path)
}

#[tauri::command]
pub async fn plugin_install_stage(app: AppHandle, path: String) -> Result<StagedPlugin, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || stage(&paths, Path::new(&path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn plugin_install_commit(app: AppHandle, token: String) -> Result<Manifest, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || commit(&paths, &token))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn plugin_install_cancel(app: AppHandle, token: String) -> Result<(), String> {
    cancel(&paths(&app)?, &token)
}

#[tauri::command]
pub fn plugin_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    uninstall(&paths(&app)?, &id)
}

#[tauri::command]
pub fn plugin_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let paths = paths(&app)?;
    installed_dir(&paths, &id)?;
    update_state(&paths, &id, |s| {
        s.enabled = enabled;
        s.failed = None;
    })
}

/// Records that a plugin failed while loading, so it is not loaded again
/// until the person turns it back on.
#[tauri::command]
pub fn plugin_set_failed(app: AppHandle, id: String, error: String) -> Result<(), String> {
    let paths = paths(&app)?;
    installed_dir(&paths, &id)?;
    let error: String = error.chars().take(500).collect();
    update_state(&paths, &id, |s| s.failed = Some(error))
}

// Plugins call these as often as they like, so they run off the main thread.
#[tauri::command]
pub async fn plugin_storage_get(app: AppHandle, id: String, key: String) -> Result<Option<Value>, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        installed_dir(&paths, &id)?;
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        storage::get(&paths.storage(&id), &key)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn plugin_storage_set(app: AppHandle, id: String, key: String, value: Option<Value>) -> Result<(), String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        installed_dir(&paths, &id)?;
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        storage::set(&paths.storage(&id), &key, value, storage::MAX_BYTES)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Card injection HTML, cleaned to plain markup: no scripts, no event
/// handlers, no inline styles, and no URL that leaves the media folder, so a
/// plugin cannot reach the network through the card page.
#[tauri::command]
pub async fn plugin_sanitize_html(html: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || sanitize_html(&html)).await.map_err(|err| err.to_string())
}

pub fn sanitize_html(html: &str) -> String {
    use std::borrow::Cow;
    use std::collections::HashSet;

    struct MediaOnly;
    impl ammonia::UrlRelativeEvaluate<'static> for MediaOnly {
        fn evaluate<'a>(&self, url: &'a str) -> Option<Cow<'a, str>> {
            let safe = !url.is_empty() && !url.starts_with("//") && !url.contains(['\\', ':']);
            safe.then_some(Cow::Borrowed(url))
        }
    }

    let tags: HashSet<&str> = [
        "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd",
        "li", "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td",
        "tfoot", "th", "thead", "tr", "u", "ul", "details", "summary", "section", "aside", "header", "footer",
    ]
    .into_iter()
    .collect();
    let generic: HashSet<&str> = ["class", "id", "title", "lang", "dir", "hidden", "role"].into_iter().collect();
    let mut tag_attributes = std::collections::HashMap::new();
    tag_attributes.insert("img", ["src", "alt", "width", "height"].into_iter().collect::<HashSet<_>>());
    tag_attributes.insert("td", ["colspan", "rowspan"].into_iter().collect());
    tag_attributes.insert("th", ["colspan", "rowspan"].into_iter().collect());
    tag_attributes.insert("details", ["open"].into_iter().collect());
    ammonia::Builder::empty()
        .tags(tags)
        .generic_attributes(generic)
        .generic_attribute_prefixes(["data-", "aria-"].into_iter().collect())
        .tag_attributes(tag_attributes)
        .url_schemes(HashSet::new())
        .url_relative(ammonia::UrlRelative::Custom(Box::new(MediaOnly)))
        .id_prefix(Some("plugin-"))
        .link_rel(None)
        .clean(html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{"id":"com.example.streak","name":"Streak","version":"1.0.0","entry":"main.js"}"#;

    fn source(dir: &Path, version: &str) -> PathBuf {
        let source = dir.join(format!("src-{version}"));
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("hayaki-plugin.json"), MANIFEST.replace("1.0.0", version)).unwrap();
        fs::write(source.join("main.js"), version).unwrap();
        source
    }

    #[test]
    fn installs_in_two_steps_and_keeps_data_on_update() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("data"));

        let staged = stage(&paths, &source(dir.path(), "1.0.0")).unwrap();
        assert_eq!(staged.replaces, None);
        assert!(list(&paths).is_empty(), "nothing is installed before the commit");
        commit(&paths, &staged.token).unwrap();
        let listed = list(&paths);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].enabled);
        assert_eq!(listed[0].manifest.as_ref().unwrap().version, "1.0.0");

        storage::set(&paths.storage("com.example.streak"), "n", Some(serde_json::json!(3)), storage::MAX_BYTES).unwrap();
        let first_install = list(&paths)[0].install.clone();
        let staged = stage(&paths, &source(dir.path(), "1.1.0")).unwrap();
        assert_eq!(staged.replaces.as_ref().map(|m| m.version.as_str()), Some("1.0.0"));
        commit(&paths, &staged.token).unwrap();
        assert_eq!(list(&paths)[0].manifest.as_ref().unwrap().version, "1.1.0");
        assert_ne!(list(&paths)[0].install, first_install, "an update is a new install");
        assert_eq!(storage::get(&paths.storage("com.example.streak"), "n").unwrap(), Some(serde_json::json!(3)));

        uninstall(&paths, "com.example.streak").unwrap();
        assert!(list(&paths).is_empty());
        assert!(!paths.storage("com.example.streak").exists());
    }

    #[test]
    fn a_cancelled_or_failed_stage_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("data"));
        let staged = stage(&paths, &source(dir.path(), "1.0.0")).unwrap();
        cancel(&paths, &staged.token).unwrap();
        assert!(commit(&paths, &staged.token).is_err());
        assert!(commit(&paths, "../../x").is_err());

        let bad = dir.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("hayaki-plugin.json"), "{}").unwrap();
        assert!(stage(&paths, &bad).is_err());
        assert_eq!(fs::read_dir(paths.staging()).unwrap().count(), 0);
    }

    #[test]
    fn reinstalling_keeps_a_plugin_off_and_changes_its_install() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("data"));
        commit(&paths, &stage(&paths, &source(dir.path(), "1.0.0")).unwrap().token).unwrap();
        update_state(&paths, "com.example.streak", |s| s.enabled = false).unwrap();
        let before = list(&paths)[0].install.clone();
        // The same version again still counts as a new install.
        commit(&paths, &stage(&paths, &source(dir.path(), "1.0.0")).unwrap().token).unwrap();
        let after = &list(&paths)[0];
        assert!(!after.enabled, "an update keeps the plugin off");
        assert_ne!(after.install, before);

        uninstall(&paths, "com.example.streak").unwrap();
        commit(&paths, &stage(&paths, &source(dir.path(), "1.0.0")).unwrap().token).unwrap();
        assert!(list(&paths)[0].enabled, "a fresh install starts on");
    }

    #[test]
    fn records_failure_until_enabled_again() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().join("data"));
        commit(&paths, &stage(&paths, &source(dir.path(), "1.0.0")).unwrap().token).unwrap();
        update_state(&paths, "com.example.streak", |s| s.failed = Some("boom".into())).unwrap();
        assert_eq!(list(&paths)[0].failed.as_deref(), Some("boom"));
        update_state(&paths, "com.example.streak", |s| {
            s.enabled = true;
            s.failed = None;
        })
        .unwrap();
        assert_eq!(list(&paths)[0].failed, None);
        assert!(installed_dir(&paths, "../data").is_err());
    }

    #[test]
    fn injected_html_keeps_markup_but_not_reach() {
        let clean = sanitize_html(
            r#"<div class="streak" id="typeans" onclick="x()" style="background:url(https://e.example/a)">Hi<script>alert(1)</script>
               <img src="https://e.example/p.png"><img src="//e.example/p.png"><img src="flame.png" onerror="x()">
               <a href="https://e.example">link</a><iframe src="https://e.example"></iframe><style>*{}</style>
               <svg><image href="https://e.example"/></svg><meta http-equiv="refresh" content="0;url=https://e.example"></div>"#,
        );
        assert!(clean.contains(r#"class="streak""#));
        assert!(clean.contains(r#"id="plugin-typeans""#), "{clean}");
        assert!(clean.contains(r#"<img src="flame.png">"#), "{clean}");
        for gone in ["script", "onclick", "onerror", "style", "e.example", "iframe", "svg", "meta", "href"] {
            assert!(!clean.contains(gone), "{gone} survived: {clean}");
        }
    }
}

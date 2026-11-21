// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Turns off, at the next launch, a plugin that froze the app (ADR 0004).
//!
//! On macOS a plugin's frames share the interface's thread, so a plugin stuck
//! in a loop stops the interface and every timer in it. The interface reports
//! which plugins run and which are still loading, before it starts loading one
//! and every 2 seconds after. This side keeps that report in a marker file and
//! watches the beats from its own thread:
//!
//! - beats stop while plugins run: the marker records `stalled`;
//! - the app exits normally: the marker is removed, unless the interface never
//!   answered the request to close and had stopped beating;
//! - the next launch finds a marker: the plugins that were loading, or, if
//!   the beats had stalled, every plugin that was running, are turned off.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use std::time::Instant;

use serde::Deserialize;
use serde::Serialize;

/// The `failed` reason for a plugin turned off by the guard; the interface
/// shows its own words for it.
pub const FROZE: &str = "froze";
/// Beats are 2 seconds apart; this many seconds without one is a freeze.
pub const STALL: Duration = Duration::from_secs(10);
/// At exit, a shorter silence counts when the interface did not answer.
const STALL_AT_EXIT: Duration = Duration::from_secs(4);

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunMarker {
    pub running: Vec<String>,
    pub loading: Vec<String>,
    #[serde(default)]
    pub stalled: bool,
}

/// The plugins to turn off, given the marker the last session left behind.
/// Only a session that ended without removing its marker leaves one.
pub fn blame(marker: &RunMarker) -> Vec<String> {
    if !marker.loading.is_empty() {
        marker.loading.clone()
    } else if marker.stalled {
        marker.running.clone()
    } else {
        Vec::new()
    }
}

struct Inner {
    marker: RunMarker,
    /// The interface page that sent the last report, and its number.
    page: String,
    seq: u64,
    last_beat: Instant,
}

pub struct Guard {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl Guard {
    pub fn new(path: PathBuf) -> Self {
        Self { path, inner: Mutex::new(Inner { marker: RunMarker::default(), page: String::new(), seq: 0, last_beat: Instant::now() }) }
    }

    /// Takes the marker the last session left, if any.
    pub fn take_previous(&self) -> Option<RunMarker> {
        let marker = fs::read(&self.path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let _ = fs::remove_file(&self.path);
        marker
    }

    fn save(&self, marker: &RunMarker) -> Result<(), String> {
        if marker.running.is_empty() && marker.loading.is_empty() {
            return match fs::remove_file(&self.path) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.to_string()),
                _ => Ok(()),
            };
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, serde_json::to_vec(marker).map_err(|err| err.to_string())?).map_err(|err| err.to_string())?;
        fs::rename(&temp, &self.path).map_err(|err| err.to_string())
    }

    /// The interface's report. Reports can arrive out of order, so one older
    /// than the last applied is ignored. Numbers start again when the
    /// interface reloads, which sends a new `page`.
    pub fn beat(&self, page: &str, seq: u64, running: Vec<String>, loading: Vec<String>) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if page == inner.page && seq <= inner.seq {
            return Ok(());
        }
        inner.page = page.to_string();
        inner.seq = seq;
        inner.last_beat = Instant::now();
        let next = RunMarker { running, loading, stalled: false };
        if next != inner.marker {
            self.save(&next)?;
            inner.marker = next;
        }
        Ok(())
    }

    /// Whether any plugin frame is loading or running. The interface reports
    /// before it mounts the first frame, so this is never late.
    pub fn active(&self) -> bool {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        !inner.marker.running.is_empty() || !inner.marker.loading.is_empty()
    }

    /// Run about once a second from a thread of its own.
    pub fn check(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let quiet = inner.last_beat.elapsed() > STALL;
        if quiet && !inner.marker.stalled && !inner.marker.running.is_empty() {
            let mut next = inner.marker.clone();
            next.stalled = true;
            if self.save(&next).is_ok() {
                inner.marker = next;
            }
        }
    }

    /// At exit. `answered` is whether the interface answered the request to
    /// close, which a frozen interface cannot.
    pub fn finish(&self, answered: bool) {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let frozen = !answered && (inner.marker.stalled || inner.last_beat.elapsed() > STALL_AT_EXIT);
        let mut last = inner.marker.clone();
        if frozen && !last.running.is_empty() {
            last.stalled = true;
            let _ = self.save(&last);
        } else {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Whether the person asked to start without plugins: Shift held at launch,
/// or `HAYAKI_NO_PLUGINS` set.
pub fn start_without_plugins() -> bool {
    std::env::var_os("HAYAKI_NO_PLUGINS").is_some_and(|v| !v.is_empty()) || shift_held()
}

#[cfg(target_os = "macos")]
fn shift_held() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state: i32) -> u64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const SHIFT: u64 = 0x0002_0000;
    // SAFETY: reads the current modifier flags; no pointers are involved.
    unsafe { CGEventSourceFlagsState(COMBINED_SESSION_STATE) & SHIFT != 0 }
}

#[cfg(target_os = "windows")]
fn shift_held() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    const VK_SHIFT: i32 = 0x10;
    // SAFETY: reads the state of one key; no pointers are involved.
    unsafe { (GetAsyncKeyState(VK_SHIFT) as u16) & 0x8000 != 0 }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn shift_held() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn blames_what_was_loading_or_everything_after_a_stall() {
        let loading = RunMarker { running: ids(&["a", "b"]), loading: ids(&["b"]), stalled: false };
        assert_eq!(blame(&loading), ids(&["b"]));
        let stalled = RunMarker { running: ids(&["a", "b"]), loading: vec![], stalled: true };
        assert_eq!(blame(&stalled), ids(&["a", "b"]));
        // Ended some other way with every plugin loaded and beating: no one to blame.
        let quiet = RunMarker { running: ids(&["a"]), loading: vec![], stalled: false };
        assert!(blame(&quiet).is_empty());
    }

    fn guard() -> (tempfile::TempDir, Guard) {
        let dir = tempfile::tempdir().unwrap();
        let guard = Guard::new(dir.path().join("plugin-run.json"));
        (dir, guard)
    }

    #[test]
    fn a_crash_while_starting_leaves_the_loading_plugin_to_blame() {
        let (_dir, session) = guard();
        session.beat("p", 1, ids(&["a"]), ids(&["a"])).unwrap();
        // The process dies here: no finish. The next launch reads the marker.
        let next = Guard::new(session.path.clone());
        assert_eq!(blame(&next.take_previous().unwrap()), ids(&["a"]));
        assert!(next.take_previous().is_none(), "the marker is read once");
    }

    #[test]
    fn a_clean_exit_leaves_nothing() {
        let (_dir, session) = guard();
        session.beat("p", 1, ids(&["a"]), ids(&["a"])).unwrap();
        session.beat("p", 2, ids(&["a"]), vec![]).unwrap();
        session.finish(true);
        assert!(Guard::new(session.path.clone()).take_previous().is_none());
    }

    #[test]
    fn a_stall_is_recorded_and_cleared_by_the_next_beat() {
        let (_dir, session) = guard();
        session.beat("p", 1, ids(&["a"]), vec![]).unwrap();
        session.inner.lock().unwrap().last_beat = Instant::now() - STALL - Duration::from_secs(1);
        session.check();
        let peek = |g: &Guard| serde_json::from_slice::<RunMarker>(&fs::read(&g.path).unwrap()).unwrap();
        assert!(peek(&session).stalled);
        session.beat("p", 2, ids(&["a"]), vec![]).unwrap();
        assert!(!peek(&session).stalled);
    }

    #[test]
    fn an_exit_the_interface_never_answered_keeps_the_blame() {
        let (_dir, session) = guard();
        session.beat("p", 1, ids(&["a", "b"]), vec![]).unwrap();
        session.inner.lock().unwrap().last_beat = Instant::now() - STALL_AT_EXIT - Duration::from_secs(1);
        session.finish(false);
        let next = Guard::new(session.path.clone());
        assert_eq!(blame(&next.take_previous().unwrap()), ids(&["a", "b"]));
    }

    #[test]
    fn a_reloaded_interface_starts_its_numbers_again() {
        let (_dir, session) = guard();
        session.beat("p", 50, ids(&["a"]), vec![]).unwrap();
        session.beat("q", 1, ids(&["a"]), ids(&["a"])).unwrap();
        assert_eq!(session.inner.lock().unwrap().marker.loading, ids(&["a"]));
    }

    #[test]
    fn ignores_reports_older_than_the_last() {
        let (_dir, session) = guard();
        session.beat("p", 2, ids(&["a"]), vec![]).unwrap();
        session.beat("p", 1, ids(&["a"]), ids(&["a"])).unwrap();
        assert!(session.inner.lock().unwrap().marker.loading.is_empty());
        session.beat("p", 3, vec![], vec![]).unwrap();
        assert!(!session.path.exists(), "nothing running leaves no marker");
    }
}

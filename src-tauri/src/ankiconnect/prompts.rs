// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The permission prompt. At most one is open at a time: while it is, every
//! other `requestPermission` is refused at once, so pages cannot stack
//! dialogs, swap the origin under the person's click, or park threads.

use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Default)]
pub struct Prompts {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    next: u64,
    open: Option<(u64, mpsc::Sender<bool>)>,
    /// Origins the person turned away; asked again after a restart.
    denied: HashSet<String>,
}

impl Prompts {
    /// Shows the prompt for `origin` with `show(id)` and waits up to
    /// `timeout` for [`Prompts::reply`]. When the wait runs out, `hide(id)`
    /// closes the dialog and the answer is no.
    pub fn ask(&self, origin: &str, timeout: Duration, show: impl FnOnce(u64), hide: impl FnOnce(u64)) -> bool {
        let (id, answer) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.open.is_some() || inner.denied.contains(origin) {
                return false;
            }
            inner.next += 1;
            let (send, answer) = mpsc::channel();
            inner.open = Some((inner.next, send));
            (inner.next, answer)
        };
        show(id);
        let answer = answer.recv_timeout(timeout);
        {
            let mut inner = self.inner.lock().unwrap();
            inner.open = None;
            if answer == Ok(false) {
                inner.denied.insert(origin.to_string());
            }
        }
        if answer.is_err() {
            hide(id);
        }
        answer == Ok(true)
    }

    /// The person's answer to prompt `id`; ignored once it has closed.
    pub fn reply(&self, id: u64, allow: bool) {
        if let Some((open, send)) = &self.inner.lock().unwrap().open {
            if *open == id {
                let _ = send.send(allow);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::channel;
    use std::sync::Arc;

    use super::*;

    const LONG: Duration = Duration::from_secs(30);

    /// Opens a prompt on another thread; returns its id and the eventual answer.
    fn open(prompts: &Arc<Prompts>, origin: &'static str) -> (u64, std::thread::JoinHandle<bool>) {
        let (shown, id) = channel();
        let prompts = prompts.clone();
        let answer = std::thread::spawn(move || prompts.ask(origin, LONG, |id| shown.send(id).unwrap(), |_| {}));
        (id.recv().unwrap(), answer)
    }

    #[test]
    fn a_second_prompt_is_refused_while_one_is_open() {
        let prompts = Arc::new(Prompts::default());
        let (id, first) = open(&prompts, "https://a.example");
        let mut shown = false;
        assert!(!prompts.ask("https://b.example", LONG, |_| shown = true, |_| {}));
        assert!(!shown, "the refused prompt never reaches the person");
        assert!(!prompts.ask("https://a.example", LONG, |_| {}, |_| {}));
        prompts.reply(id, true);
        assert!(first.join().unwrap());

        // Once it has closed, the next origin can be asked about.
        let (id, second) = open(&prompts, "https://b.example");
        prompts.reply(id, false);
        assert!(!second.join().unwrap());
        // A turned-away origin is not asked again.
        assert!(!prompts.ask("https://b.example", LONG, |_| panic!("asked again"), |_| {}));
    }

    #[test]
    fn an_unanswered_prompt_closes_its_dialog() {
        let prompts = Prompts::default();
        let mut hidden = None;
        let allowed = prompts.ask("https://a.example", Duration::from_millis(10), |_| {}, |id| hidden = Some(id));
        assert!(!allowed);
        assert_eq!(hidden, Some(1));
        // A late answer to the closed prompt changes nothing, and it may be asked again.
        prompts.reply(1, true);
        let mut shown = false;
        prompts.ask("https://a.example", Duration::from_millis(10), |_| shown = true, |_| {});
        assert!(shown);
    }
}

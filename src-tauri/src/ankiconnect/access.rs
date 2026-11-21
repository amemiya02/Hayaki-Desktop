// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Who may talk to the server. Mirrors AnkiConnect's `allowOrigin`: a request
//! without an Origin header comes from a local program and is allowed; a
//! browser request is allowed when its origin is listed, when the list holds
//! `*`, or, while `http://localhost` is listed, when it comes from 127.0.0.1
//! or a browser extension (how Yomitan and other extensions reach AnkiConnect
//! without extra setup).

use super::config::LOCALHOST;

#[derive(Debug, PartialEq, Eq)]
pub struct Cors {
    pub allowed: bool,
    /// The value of `Access-Control-Allow-Origin` on the reply.
    pub allow_origin: String,
}

pub fn decide(origins: &[String], origin: Option<&str>) -> Cors {
    let listed = |o: &str| origins.iter().any(|entry| entry == o);
    if listed("*") {
        return Cors { allowed: true, allow_origin: "*".into() };
    }
    let Some(origin) = origin else {
        return Cors { allowed: true, allow_origin: LOCALHOST.into() };
    };
    let local_or_extension = origin == "http://127.0.0.1"
        || origin == "https://127.0.0.1"
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("https://127.0.0.1:")
        || origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin.starts_with("safari-web-extension://");
    if listed(origin) || (listed(LOCALHOST) && local_or_extension) {
        Cors { allowed: true, allow_origin: origin.into() }
    } else {
        Cors { allowed: false, allow_origin: LOCALHOST.into() }
    }
}

/// Whether the person may be asked to let `origin` connect: a web page over
/// http or https, or a browser extension. `null` (sandboxed frames, `file:`
/// and `data:` pages) and other schemes are never asked about or granted.
pub fn promptable(origin: &str) -> bool {
    let Some((scheme, rest)) = origin.split_once("://") else { return false };
    matches!(scheme, "http" | "https" | "chrome-extension" | "moz-extension" | "safari-web-extension")
        && !rest.is_empty()
        && !rest.contains(['/', '?', '#', ' '])
}

/// Guards against DNS rebinding: a page whose name was pointed at 127.0.0.1
/// sends its own name as the Host. Only loopback names are accepted.
pub fn host_allowed(host: Option<&str>) -> bool {
    let Some(host) = host else { return true };
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.rsplit_once(':').map_or(host, |(name, _)| name)
    };
    matches!(name.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1")
}

/// AnkiConnect skips the key for `requestPermission` only. With no key set,
/// any key (or none) is accepted.
pub fn key_ok(expected: Option<&str>, given: Option<&str>, action: &str) -> bool {
    match expected {
        None => true,
        Some(_) if action == "requestPermission" => true,
        Some(key) => given == Some(key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn local_programs_without_an_origin_are_allowed() {
        assert_eq!(decide(&list(&[]), None), Cors { allowed: true, allow_origin: LOCALHOST.into() });
    }

    #[test]
    fn extensions_are_allowed_while_localhost_is_listed() {
        let default = list(&[LOCALHOST]);
        for origin in ["chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn", "moz-extension://1234", "safari-web-extension://x", "http://127.0.0.1:5173", "http://127.0.0.1"] {
            assert_eq!(decide(&default, Some(origin)), Cors { allowed: true, allow_origin: origin.into() }, "{origin}");
        }
        assert!(decide(&default, Some(LOCALHOST)).allowed);
        // Without localhost in the list, an extension must be listed itself.
        let only = list(&["moz-extension://1234"]);
        assert!(decide(&only, Some("moz-extension://1234")).allowed);
        assert!(!decide(&only, Some("chrome-extension://other")).allowed);
    }

    #[test]
    fn web_pages_are_rejected_unless_listed() {
        let default = list(&[LOCALHOST]);
        assert_eq!(decide(&default, Some("https://evil.example")), Cors { allowed: false, allow_origin: LOCALHOST.into() });
        // A prefix trick does not pass for 127.0.0.1.
        assert!(!decide(&default, Some("http://127.0.0.1.evil.example")).allowed);
        assert!(!decide(&default, Some("http://localhost:3000")).allowed);
        assert!(decide(&list(&["https://site.example"]), Some("https://site.example")).allowed);
        assert_eq!(decide(&list(&["*"]), Some("https://any.example")), Cors { allowed: true, allow_origin: "*".into() });
    }

    #[test]
    fn only_loopback_host_names_pass() {
        for host in ["127.0.0.1:8765", "localhost:8765", "LOCALHOST", "[::1]:8765", "127.0.0.1"] {
            assert!(host_allowed(Some(host)), "{host}");
        }
        for host in ["evil.example:8765", "evil.example", "127.0.0.1.evil.example:8765", "[::2]:8765"] {
            assert!(!host_allowed(Some(host)), "{host}");
        }
        assert!(host_allowed(None));
    }

    #[test]
    fn only_web_pages_and_extensions_can_be_asked_about() {
        for origin in ["https://site.example", "http://localhost:3000", "chrome-extension://abc", "moz-extension://1234", "safari-web-extension://x"] {
            assert!(promptable(origin), "{origin}");
        }
        for origin in ["null", "", "file://", "data:text/html,x", "ftp://site.example", "https://", "javascript:alert(1)", "https://a.example/path"] {
            assert!(!promptable(origin), "{origin}");
        }
    }

    #[test]
    fn keys() {
        assert!(key_ok(None, None, "deckNames"));
        assert!(key_ok(None, Some("anything"), "deckNames"));
        assert!(!key_ok(Some("s3cret"), None, "deckNames"));
        assert!(!key_ok(Some("s3cret"), Some("wrong"), "deckNames"));
        assert!(key_ok(Some("s3cret"), Some("s3cret"), "deckNames"));
        assert!(key_ok(Some("s3cret"), None, "requestPermission"));
    }
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! `hayaki-plugin.json`, parsed and checked before anything else reads it.
//! Every string that later reaches a path, a URL or a CSP header is checked
//! here, so the rest of the module can trust a `Manifest`.

use serde::Deserialize;
use serde::Serialize;

use crate::media::plain_name;

pub const MANIFEST_FILE: &str = "hayaki-plugin.json";
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_PANELS: usize = 8;
const MAX_ORIGINS: usize = 16;
const MAX_PATH_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "collection:read")]
    CollectionRead,
    #[serde(rename = "collection:write")]
    CollectionWrite,
    #[serde(rename = "reviewer")]
    Reviewer,
    #[serde(rename = "ui")]
    Ui,
    #[serde(rename = "network")]
    Network,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Panel {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub entry: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub entry: String,
    #[serde(default)]
    pub panels: Vec<Panel>,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    /// Origins the plugin may connect to; requires the `network` permission.
    #[serde(default)]
    pub network: Vec<String>,
}

impl Manifest {
    pub fn has(&self, permission: Permission) -> bool {
        self.permissions.contains(&permission)
    }
}

/// `[a-z0-9]` runs joined by single dots or hyphens, as in reverse DNS.
pub fn valid_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id
            .split(['.', '-'])
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// One segment of a path inside a plugin: media's plain-name rule, plus a
/// narrow character set so a name never needs escaping in a URL, an HTML
/// attribute or a header, and no hidden files.
pub fn valid_segment(segment: &str) -> bool {
    plain_name(segment)
        && segment.len() <= 128
        && !segment.starts_with('.')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

/// A relative path made only of valid segments, separated by `/`.
pub fn valid_relative_path(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    !segments.is_empty() && segments.len() <= MAX_PATH_DEPTH && segments.iter().all(|s| valid_segment(s))
}

fn plain_text(field: &str, value: &str, min: usize, max: usize) -> Result<(), String> {
    let len = value.chars().count();
    if len < min || len > max {
        return Err(format!("`{field}` must be {min} to {max} characters"));
    }
    if value.chars().any(|c| c.is_control() && c != '\n') {
        return Err(format!("`{field}` contains control characters"));
    }
    Ok(())
}

/// A host on this computer or the local network: a single label such as
/// `localhost` or `router`, a local-only name, or an address that is not
/// public. Browsers read a host whose last label is a number, or starts with
/// `0x`, as an IPv4 address in any of several spellings, so such a host is
/// accepted only as a public address in plain dotted form.
fn private_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    let last = labels.last().copied().unwrap_or_default();
    if last.bytes().all(|b| b.is_ascii_digit()) || last.starts_with("0x") {
        let Ok(ip) = host.parse::<std::net::Ipv4Addr>() else { return true };
        let [a, b, ..] = ip.octets();
        let shared = a == 100 && (64..128).contains(&b);
        return ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()
            || ip.is_unspecified()
            || ip.is_broadcast()
            || ip.is_documentation()
            || shared
            || a == 0
            || a >= 224;
    }
    const LOCAL_SUFFIXES: [&str; 5] = ["localhost", "local", "internal", "lan", "home.arpa"];
    labels.len() < 2 || LOCAL_SUFFIXES.iter().any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// `https://host` or `https://host:port`, for a public host only, so a plugin
/// cannot reach servers on this computer (such as the built-in AnkiConnect)
/// or the local network.
fn valid_origin(origin: &str) -> bool {
    let (scheme, rest) = match origin.split_once("://") {
        Some(parts) => parts,
        None => return false,
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && host
            .split('.')
            .all(|label| !label.is_empty() && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
    let port_ok = port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()));
    scheme == "https" && host_ok && port_ok && !private_host(host)
}

pub fn parse(bytes: &[u8]) -> Result<Manifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(format!("{MANIFEST_FILE} is larger than 64 KB"));
    }
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|err| format!("{MANIFEST_FILE} is not valid: {err}"))?;
    validate(&manifest)?;
    Ok(manifest)
}

fn validate(m: &Manifest) -> Result<(), String> {
    if !valid_id(&m.id) {
        return Err("`id` must be 3 to 64 characters of a-z, 0-9, dots and hyphens, like com.example.my-plugin".into());
    }
    plain_text("name", &m.name, 1, 60)?;
    plain_text("description", &m.description, 0, 300)?;
    plain_text("author", &m.author, 0, 80)?;
    if m.version.is_empty()
        || m.version.len() > 32
        || !m.version.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
    {
        return Err("`version` must be up to 32 characters of letters, digits, dots, hyphens and plus signs".into());
    }
    if !valid_relative_path(&m.entry) || !m.entry.ends_with(".js") {
        return Err("`entry` must be a relative path to a .js file inside the plugin".into());
    }
    if m.panels.len() > MAX_PANELS {
        return Err(format!("a plugin has at most {MAX_PANELS} panels"));
    }
    for (index, panel) in m.panels.iter().enumerate() {
        let id_ok = (1..=32).contains(&panel.id.len())
            && panel.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !id_ok || m.panels[..index].iter().any(|p| p.id == panel.id) {
            return Err("each panel needs a unique `id` of a-z, 0-9 and hyphens".into());
        }
        plain_text("panels.title", &panel.title, 1, 40)?;
        if let Some(icon) = &panel.icon {
            if icon.len() > 40 || !icon.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
                return Err("`panels.icon` must be a lucide icon name such as `flame`".into());
            }
        }
        if !valid_relative_path(&panel.entry) || !(panel.entry.ends_with(".html") || panel.entry.ends_with(".htm")) {
            return Err("`panels.entry` must be a relative path to an .html file inside the plugin".into());
        }
    }
    let mut permissions = m.permissions.clone();
    permissions.sort();
    permissions.dedup();
    if permissions.len() != m.permissions.len() {
        return Err("`permissions` lists a permission twice".into());
    }
    if m.network.len() > MAX_ORIGINS {
        return Err(format!("`network` lists at most {MAX_ORIGINS} origins"));
    }
    if let Some(bad) = m.network.iter().find(|o| !valid_origin(o)) {
        return Err(format!(
            "`network` origin `{bad}` must be https://host or https://host:port, for a public host (not this computer or the local network)"
        ));
    }
    if m.has(Permission::Network) != !m.network.is_empty() {
        return Err("the `network` permission and the `network` origins go together".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(extra: &str) -> String {
        format!(r#"{{"id":"com.example.streak","name":"Streak","version":"1.0.0","entry":"main.js"{extra}}}"#)
    }

    #[test]
    fn accepts_a_complete_manifest() {
        let m = parse(
            manifest(
                r#","description":"d","author":"a","panels":[{"id":"today","title":"Today","icon":"flame","entry":"panel/today.html"}],
                "permissions":["collection:read","ui","network"],"network":["https://api.example.com","https://8.8.8.8:8443"]"#,
            )
            .as_bytes(),
        )
        .unwrap();
        assert_eq!(m.id, "com.example.streak");
        assert!(m.has(Permission::Ui));
        assert!(!m.has(Permission::CollectionWrite));
        assert_eq!(m.panels[0].entry, "panel/today.html");
    }

    #[test]
    fn refuses_origins_on_this_computer_or_the_local_network() {
        for good in ["https://api.example.com", "https://a-b.example.co.uk:8443", "https://8.8.8.8", "https://1.1.1.1:443"] {
            assert!(valid_origin(good), "{good}");
        }
        for bad in [
            "http://localhost:8765",
            "http://127.0.0.1:8765",
            "https://localhost:8765",
            "https://127.0.0.1:8765",
            "https://127.1",
            "https://2130706433",
            "https://0x7f.1",
            "https://0x7f000001",
            "https://0177.0.0.1",
            "https://0.0.0.0",
            "https://10.0.0.1",
            "https://172.16.0.1",
            "https://192.168.1.1",
            "https://169.254.169.254",
            "https://100.64.0.1",
            "https://224.0.0.1",
            "https://router",
            "https://anki.localhost",
            "https://nas.local",
            "https://db.internal",
            "https://printer.home.arpa",
            "http://api.example.com",
            "https://[::1]",
        ] {
            assert!(!valid_origin(bad), "{bad}");
        }
    }

    #[test]
    fn checks_ids() {
        for good in ["com.example.x", "abc", "a1-b2.c3"] {
            assert!(valid_id(good), "{good}");
        }
        for bad in ["ab", "Com.example", "a..b", ".abc", "abc.", "a_b", "a/b", "../x", "_sdk", "a b"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn rejects_paths_that_could_leave_the_plugin() {
        for bad in ["../x.js", "/abs.js", "a/../../x.js", "C:/x.js", "a\\b.js", ".hidden.js", "a//b.js", "", "a/./b.js", "%2e%2e/x.js"] {
            assert!(!valid_relative_path(bad), "{bad}");
        }
        assert!(valid_relative_path("src/main.js"));
        let err = parse(manifest("").replace("main.js", "../main.js").as_bytes()).unwrap_err();
        assert!(err.contains("entry"), "{err}");
    }

    #[test]
    fn rejects_bad_fields() {
        let cases = [
            manifest(r#","unknown":1"#),
            manifest(r#","permissions":["collection:delete"]"#),
            manifest(r#","permissions":["ui","ui"]"#),
            manifest(r#","permissions":["network"]"#),
            manifest(r#","network":["https://a.example"]"#),
            manifest(r#","permissions":["network"],"network":["http://example.com"]"#),
            manifest(r#","permissions":["network"],"network":["https://a.example; script-src *"]"#),
            manifest(r#","permissions":["network"],"network":["https://a.example/path"]"#),
            manifest(r#","panels":[{"id":"a","title":"A","entry":"a.js"}]"#),
            manifest(r#","panels":[{"id":"a","title":"A","entry":"a.html"},{"id":"a","title":"B","entry":"b.html"}]"#),
            manifest("").replace(r#""Streak""#, r#""""#),
            manifest("").replace("1.0.0", "1 0"),
        ];
        for case in cases {
            assert!(parse(case.as_bytes()).is_err(), "{case}");
        }
    }
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The `plugin` URI scheme (`plugin://localhost/…`, or
//! `http://plugin.localhost/…` on Windows). It serves, read-only:
//!
//! - `/_sdk/hayaki-plugin.js` and `/_sdk/tokens.css`, the SDK and the
//!   interface's design tokens;
//! - `/_entry/<id>`, the generated page that runs a plugin's entry script;
//! - `/<id>/<path>`, files inside that plugin's folder and nowhere else.
//!
//! Every plugin page carries a Content Security Policy that lets it load only
//! the SDK and its own files, and connect nowhere unless its manifest lists
//! origins under `network`.
//!
//! A page (the entry page or a plugin's `.html` file) is served only with a
//! frame ticket, `?t=<ticket>`, that the interface took for that exact path
//! just before it set the frame's address. A ticket works once, so a plugin
//! frame cannot load another plugin's page, or a page of its own, in place of
//! the one the interface gave it.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use std::time::Instant;

use percent_encoding::percent_decode_str;
use tauri::http::header;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::StatusCode;

use super::manifest::valid_id;
use super::manifest::valid_segment;
use super::manifest::Manifest;
use super::manifest::Permission;
use super::package::read_installed;

const SDK_JS: &str = include_str!("../../plugin-sdk/hayaki-plugin.js");
const APP_CSS: &str = include_str!("../../../src/styles/app.css");

#[derive(Debug, PartialEq)]
enum Target {
    Sdk(&'static str),
    Entry(String),
    File { id: String, path: String },
}

/// Parses a request path, refusing any segment that could leave the plugin.
fn route(path: &str) -> Option<Target> {
    let segments: Vec<String> = path
        .trim_start_matches('/')
        .split('/')
        .map(|s| percent_decode_str(s).decode_utf8().ok().map(|s| s.into_owned()))
        .collect::<Option<_>>()?;
    match segments.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["_sdk", "hayaki-plugin.js"] => Some(Target::Sdk("hayaki-plugin.js")),
        ["_sdk", "tokens.css"] => Some(Target::Sdk("tokens.css")),
        ["_entry", id] if valid_id(id) => Some(Target::Entry(id.to_string())),
        [id, rest @ ..] if valid_id(id) && !rest.is_empty() && rest.len() <= 16 && rest.iter().all(|s| valid_segment(s)) => {
            Some(Target::File { id: id.to_string(), path: rest.join("/") })
        }
        _ => None,
    }
}

fn is_html(path: &str) -> bool {
    path.ends_with(".html") || path.ends_with(".htm")
}

/// Whether a request path is a plugin page: a document a frame may show.
pub fn is_page(path: &str) -> bool {
    match route(path) {
        Some(Target::Entry(_)) => true,
        Some(Target::File { path, .. }) => is_html(&path),
        _ => false,
    }
}

const TICKET_LIFETIME: Duration = Duration::from_secs(60);
const MAX_TICKETS: usize = 256;

/// One-use tickets for plugin pages, by ticket, with the path each is for.
#[derive(Default)]
pub struct FrameTickets(Mutex<HashMap<String, (String, Instant)>>);

impl FrameTickets {
    /// A ticket for `path`, which must be a plugin page.
    pub fn issue(&self, path: &str) -> Result<String, String> {
        if !is_page(path) {
            return Err("not a plugin page".into());
        }
        let ticket = format!("{:032x}", rand::random::<u128>());
        let mut tickets = self.0.lock().unwrap_or_else(|e| e.into_inner());
        tickets.retain(|_, (_, issued)| issued.elapsed() < TICKET_LIFETIME);
        if tickets.len() >= MAX_TICKETS {
            return Err("too many plugin frames are loading".into());
        }
        tickets.insert(ticket.clone(), (path.to_string(), Instant::now()));
        Ok(ticket)
    }

    /// Spends the ticket in `query` if it was issued for `path`.
    pub fn take(&self, path: &str, query: Option<&str>) -> bool {
        let Some(ticket) = query.and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("t="))) else {
            return false;
        };
        let mut tickets = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match tickets.get(ticket) {
            Some((issued_for, issued)) if issued_for == path && issued.elapsed() < TICKET_LIFETIME => {
                tickets.remove(ticket);
                true
            }
            _ => false,
        }
    }
}

/// The policy for one plugin's pages. `base` is the scheme's own origin as
/// the request named it, so sources can be limited to this plugin's folder.
pub fn csp(base: &str, manifest: &Manifest) -> String {
    let own = format!("{base}/{}/", manifest.id);
    let sdk = format!("{base}/_sdk/");
    let connect = if manifest.has(Permission::Network) && !manifest.network.is_empty() {
        manifest.network.join(" ")
    } else {
        "'none'".into()
    };
    [
        "default-src 'none'".to_string(),
        format!("script-src {sdk} {own}"),
        format!("style-src {sdk} {own} 'unsafe-inline'"),
        format!("img-src {own} data: blob:"),
        format!("font-src {sdk} {own} data:"),
        format!("media-src {own} data: blob:"),
        format!("connect-src {connect}"),
        "frame-src 'none'".into(),
        "worker-src 'none'".into(),
        "object-src 'none'".into(),
        "base-uri 'none'".into(),
        "form-action 'none'".into(),
    ]
    .join("; ")
}

/// The page a plugin's entry script runs in. Paths are checked by the
/// manifest, so they need no escaping. Classic scripts load without CORS,
/// which custom schemes do not reliably support from an opaque origin.
fn entry_page(manifest: &Manifest) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{id}</title>\
         <script src=\"/_sdk/hayaki-plugin.js\"></script>\
         <script src=\"/{id}/{entry}\"></script></head><body></body></html>",
        id = manifest.id,
        entry = manifest.entry,
    )
}

/// The design tokens from the interface's stylesheet: every `:root` block
/// (light, dark, black, Themes, languages) and the type scale, so a panel
/// that sets the same classes and data attributes on its root matches the app.
pub fn tokens_css(app_css: &str) -> String {
    let css = strip_comments(app_css);
    let mut out = String::from("/* Generated from Hayaki's src/styles/app.css. */\n");
    let mut type_scale = String::new();
    let bytes = css.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b';' => start = i + 1,
            b'{' => {
                let selector = css[start..i].trim();
                let end = matching_brace(bytes, i).unwrap_or(bytes.len() - 1);
                let body = &css[i + 1..end];
                if selector.starts_with(":root") && !selector.contains("data-material") {
                    out.push_str(&format!("{selector} {{{body}}}\n"));
                } else if selector == "@theme" {
                    for decl in body.split(';') {
                        let decl = decl.trim();
                        if decl.starts_with("--text-") {
                            type_scale.push_str(&format!("  {decl};\n"));
                        }
                    }
                }
                i = end;
                start = end + 1;
            }
            _ => {}
        }
        i += 1;
    }
    out.push_str(&format!(":root {{\n{type_scale}}}\n"));
    out.push_str(
        "html { font-family: var(--font-ui); font-size: 14px; line-height: 1.45; color: var(--ink); \
         background: var(--bg); -webkit-font-smoothing: antialiased; }\n\
         body { margin: 0; }\n",
    );
    out
}

fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(open) = rest.find("/*") {
        out.push_str(&rest[..open]);
        rest = rest[open + 2..].find("*/").map_or("", |close| &rest[open + 2 + close + 2..]);
    }
    out.push_str(rest);
    out
}

fn matching_brace(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0;
    for (offset, b) in bytes[open..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn tokens() -> &'static str {
    static TOKENS: OnceLock<String> = OnceLock::new();
    TOKENS.get_or_init(|| tokens_css(APP_CSS))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}

pub fn unavailable() -> Response<Vec<u8>> {
    status(StatusCode::SERVICE_UNAVAILABLE)
}

fn respond(mime: &str, body: Vec<u8>, csp: Option<String>) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer");
    if let Some(csp) = csp {
        builder = builder.header("Content-Security-Policy", csp);
    }
    builder.body(body).unwrap()
}

/// A file inside the plugin's folder. Canonical paths are compared as well,
/// so a link created inside the folder after install cannot lead out of it.
fn plugin_file(root: &Path, id: &str, path: &str) -> Option<PathBuf> {
    let folder = root.join(id).canonicalize().ok()?;
    let file = folder.join(path).canonicalize().ok()?;
    (file.starts_with(&folder) && file.is_file()).then_some(file)
}

pub fn serve(plugins_root: Option<PathBuf>, tickets: &FrameTickets, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let base = format!(
        "{}://{}",
        uri.scheme_str().unwrap_or("plugin"),
        uri.authority().map_or("localhost", |a| a.as_str())
    );
    let Some(target) = route(uri.path()) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(root) = plugins_root else {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };
    if is_page(uri.path()) && !tickets.take(uri.path(), uri.query()) {
        return status(StatusCode::FORBIDDEN);
    }
    match target {
        Target::Sdk("hayaki-plugin.js") => respond("text/javascript", SDK_JS.as_bytes().to_vec(), None),
        Target::Sdk(_) => respond("text/css", tokens().as_bytes().to_vec(), None),
        Target::Entry(id) => match read_installed(&root.join(&id)) {
            Ok(manifest) if manifest.id == id => {
                respond("text/html", entry_page(&manifest).into_bytes(), Some(csp(&base, &manifest)))
            }
            _ => status(StatusCode::NOT_FOUND),
        },
        Target::File { id, path } => {
            let manifest = match read_installed(&root.join(&id)) {
                Ok(manifest) if manifest.id == id => manifest,
                _ => return status(StatusCode::NOT_FOUND),
            };
            let Some(file) = plugin_file(&root, &id, &path) else {
                return status(StatusCode::NOT_FOUND);
            };
            let Ok(body) = fs::read(&file) else {
                return status(StatusCode::INTERNAL_SERVER_ERROR);
            };
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            respond(mime.essence_str(), body, Some(csp(&base, &manifest)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(network: &[&str]) -> Manifest {
        let mut permissions = vec![Permission::Ui];
        if !network.is_empty() {
            permissions.push(Permission::Network);
        }
        Manifest {
            id: "com.example.streak".into(),
            name: "Streak".into(),
            version: "1".into(),
            description: String::new(),
            author: String::new(),
            entry: "main.js".into(),
            panels: vec![],
            permissions,
            network: network.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn routes_only_paths_inside_a_plugin() {
        assert_eq!(route("/_sdk/hayaki-plugin.js"), Some(Target::Sdk("hayaki-plugin.js")));
        assert_eq!(route("/_entry/com.example.streak"), Some(Target::Entry("com.example.streak".into())));
        assert_eq!(
            route("/com.example.streak/panel/today.html"),
            Some(Target::File { id: "com.example.streak".into(), path: "panel/today.html".into() })
        );
        for bad in [
            "/com.example.streak/../other/x.js",
            "/com.example.streak/%2e%2e/x.js",
            "/com.example.streak/a%2Fb.js",
            "/com.example.streak/..%5Cx.js",
            "/com.example.streak/C:x.js",
            "/com.example.streak/.hidden",
            "/com.example.streak/",
            "/com.example.streak",
            "/../etc/passwd",
            "/_sdk/other.js",
            "/_entry/../x",
            "/Bad.Id/x.js",
        ] {
            assert_eq!(route(bad), None, "{bad}");
        }
    }

    #[test]
    fn knows_which_paths_are_pages() {
        assert!(is_page("/_entry/com.example.streak"));
        assert!(is_page("/com.example.streak/panel/today.html"));
        assert!(is_page("/com.example.streak/today.htm"));
        assert!(!is_page("/com.example.streak/main.js"));
        assert!(!is_page("/_sdk/hayaki-plugin.js"));
        assert!(!is_page("/com.example.streak/../x.html"));
    }

    #[test]
    fn a_page_needs_a_ticket_for_its_own_path_used_once() {
        let tickets = FrameTickets::default();
        let entry = "/_entry/com.example.streak";
        assert!(tickets.issue("/com.example.streak/main.js").is_err());
        let t = tickets.issue(entry).unwrap();
        assert!(!tickets.take(entry, None));
        assert!(!tickets.take(entry, Some("t=nope")));
        assert!(!tickets.take("/_entry/com.example.other", Some(&format!("t={t}"))));
        assert!(tickets.take(entry, Some(&format!("x=1&t={t}"))));
        assert!(!tickets.take(entry, Some(&format!("t={t}"))), "a ticket works once");
    }

    #[test]
    fn serves_pages_only_with_a_ticket() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("com.example.streak");
        fs::create_dir_all(&folder).unwrap();
        fs::write(
            folder.join("hayaki-plugin.json"),
            r#"{"id":"com.example.streak","name":"Streak","version":"1","entry":"main.js"}"#,
        )
        .unwrap();
        fs::write(folder.join("main.js"), "1").unwrap();
        fs::write(folder.join("page.html"), "<p>").unwrap();
        // A copy under another folder name must not be served as that id.
        fs::create_dir_all(dir.path().join("com.example.other")).unwrap();
        fs::copy(folder.join("hayaki-plugin.json"), dir.path().join("com.example.other/hayaki-plugin.json")).unwrap();
        fs::write(dir.path().join("com.example.other/main.js"), "1").unwrap();

        let tickets = FrameTickets::default();
        let get = |path: &str| {
            let request = Request::builder().uri(format!("plugin://localhost{path}")).body(Vec::new()).unwrap();
            serve(Some(dir.path().to_path_buf()), &tickets, &request).status()
        };
        assert_eq!(get("/com.example.streak/main.js"), StatusCode::OK);
        assert_eq!(get("/com.example.other/main.js"), StatusCode::NOT_FOUND);
        assert_eq!(get("/_entry/com.example.streak"), StatusCode::FORBIDDEN);
        assert_eq!(get("/com.example.streak/page.html"), StatusCode::FORBIDDEN);
        let t = tickets.issue("/com.example.streak/page.html").unwrap();
        assert_eq!(get(&format!("/com.example.streak/page.html?t={t}")), StatusCode::OK);
        assert_eq!(get(&format!("/com.example.streak/page.html?t={t}")), StatusCode::FORBIDDEN);
        let t = tickets.issue("/_entry/com.example.streak").unwrap();
        assert_eq!(get(&format!("/_entry/com.example.streak?t={t}")), StatusCode::OK);
    }

    #[test]
    fn policy_limits_sources_to_the_plugin() {
        let policy = csp("plugin://localhost", &manifest(&[]));
        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("script-src plugin://localhost/_sdk/ plugin://localhost/com.example.streak/;"));
        assert!(policy.contains("connect-src 'none'"));
        assert!(!policy.contains("unsafe-eval"));
        assert!(!policy.contains("script-src 'unsafe-inline'"));

        let policy = csp("http://plugin.localhost", &manifest(&["https://api.example.com"]));
        assert!(policy.contains("connect-src https://api.example.com;"));
        assert!(policy.contains("img-src http://plugin.localhost/com.example.streak/ "));
    }

    #[test]
    fn serves_files_inside_the_folder_only() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("com.example.streak");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("main.js"), "1").unwrap();
        fs::write(dir.path().join("secret.txt"), "s").unwrap();
        assert!(plugin_file(dir.path(), "com.example.streak", "main.js").is_some());
        assert!(plugin_file(dir.path(), "com.example.streak", "missing.js").is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("secret.txt"), folder.join("link.txt")).unwrap();
            assert!(plugin_file(dir.path(), "com.example.streak", "link.txt").is_none());
        }
    }

    #[test]
    fn tokens_carry_the_root_blocks_and_type_scale() {
        let css = tokens();
        assert!(css.contains(":root {"));
        assert!(css.contains("--accent-light"));
        assert!(css.contains(":root.dark {"));
        assert!(css.contains(":root[data-theme=\"sakura\"]"));
        assert!(css.contains("--text-body: 14px"));
        assert!(!css.contains("data-material"));
        assert!(!css.contains("@import"));
    }
}

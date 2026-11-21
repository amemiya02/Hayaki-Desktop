// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Which pages the webview may load, in the window or in any frame (ADR 0004).
//! The interface, the card page and plugin pages are allowed; everything else
//! is refused, so a sandboxed frame cannot move itself to a page that escapes
//! its policy. WebKit asks for subframes as well (macOS and Linux); WebView2
//! asks only for the window, where the interface's `frame-src` still applies.
//! The callback sees only a URL, so it cannot tell a Card's web iframe
//! (YouTube, Forvo) from a plugin frame moving itself. Web pages are therefore
//! allowed while no plugin runs, as before plugins existed, and refused while
//! one does.

use tauri::plugin::Builder;
use tauri::plugin::TauriPlugin;
use tauri::Manager;
use tauri::Runtime;
use tauri::Url;

use crate::plugins::scheme;

/// `scheme://localhost` on macOS and Linux, `http(s)://scheme.localhost` on Windows.
fn is_scheme(url: &Url, scheme: &str) -> bool {
    let host = url.host_str().unwrap_or_default();
    (url.scheme() == scheme && host == "localhost")
        || (matches!(url.scheme(), "http" | "https") && host.strip_suffix(".localhost") == Some(scheme))
}

pub fn allowed(url: &Url, dev_url: Option<&Url>, plugins_active: bool) -> bool {
    if url.scheme() == "about" {
        return matches!(url.path(), "blank" | "srcdoc");
    }
    if is_scheme(url, "tauri") {
        return true;
    }
    if let Some(dev) = dev_url {
        if url.origin() == dev.origin() {
            return true;
        }
    }
    if is_scheme(url, "media") {
        return url.path() == "/_hayaki/card.html";
    }
    if is_scheme(url, "plugin") {
        return scheme::is_page(url.path());
    }
    !plugins_active && is_web(url)
}

/// A page on the web, not one of the app's own origins or this computer.
fn is_web(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    matches!(url.scheme(), "http" | "https")
        && host != "localhost"
        && !host.ends_with(".localhost")
        && !host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback())
        && host != "[::1]"
}

pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let dev = tauri::is_dev().then(|| webview.config().build.dev_url.clone()).flatten();
            let active = webview.try_state::<crate::plugins::PluginSession>().is_some_and(|s| s.plugins_active());
            allowed(url, dev.as_ref(), active)
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(url: &str) -> bool {
        allowed(&Url::parse(url).unwrap(), None, true)
    }

    #[test]
    fn allows_web_pages_in_cards_only_while_no_plugin_runs() {
        let web = Url::parse("https://www.youtube.com/embed/x").unwrap();
        assert!(allowed(&web, None, false));
        assert!(!allowed(&web, None, true));
        for local in ["http://localhost:8765/", "http://127.0.0.1/", "http://evil.localhost/", "http://[::1]/"] {
            assert!(!allowed(&Url::parse(local).unwrap(), None, false), "{local}");
        }
    }

    #[test]
    fn allows_the_interface_the_card_page_and_plugin_pages() {
        for url in [
            "tauri://localhost/",
            "tauri://localhost/index.html#x",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "media://localhost/_hayaki/card.html",
            "http://media.localhost/_hayaki/card.html",
            "plugin://localhost/_entry/com.example.streak?t=1",
            "plugin://localhost/com.example.streak/panel/today.html?t=1",
            "http://plugin.localhost/com.example.streak/today.htm",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(ok(url), "{url}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for url in [
            "media://localhost/x.html",
            "media://localhost/_hayaki/mathjax/tex-chtml.js",
            "http://media.localhost/x.html",
            "plugin://localhost/com.example.streak/main.js",
            "plugin://localhost/com.example.streak/../x.html",
            "plugin://localhost/_sdk/hayaki-plugin.js",
            "plugin://evil/_entry/com.example.streak",
            "https://example.com/",
            "http://localhost:1420/",
            "http://evil.localhost/",
            "data:text/html,<script>1</script>",
            "blob:null/1234",
            "javascript:alert(1)",
            "about:config",
            "file:///etc/passwd",
        ] {
            assert!(!ok(url), "{url}");
        }
    }

    #[test]
    fn allows_the_dev_server_only_when_given() {
        let dev = Url::parse("http://localhost:1420").unwrap();
        assert!(allowed(&Url::parse("http://localhost:1420/src/main.tsx").unwrap(), Some(&dev), true));
        assert!(!allowed(&Url::parse("http://localhost:1421/").unwrap(), Some(&dev), true));
    }
}

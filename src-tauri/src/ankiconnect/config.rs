// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The server's settings, kept in `ankiconnect.json` in the app's data folder
//! so the server can start before the interface loads.

use std::path::Path;

use serde::Deserialize;
use serde::Serialize;

pub const DEFAULT_PORT: u16 = 8765;
pub const LOCALHOST: &str = "http://localhost";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub enabled: bool,
    pub port: u16,
    /// AnkiConnect's `webCorsOriginList`.
    pub origins: Vec<String>,
    /// Empty means no key is required.
    pub api_key: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            enabled: false,
            port: DEFAULT_PORT,
            origins: vec![LOCALHOST.into()],
            api_key: String::new(),
        }
    }
}

impl Config {
    /// Trims entries, drops empty and repeated origins and a port of 0.
    pub fn normalized(mut self) -> Self {
        let mut origins: Vec<String> = Vec::new();
        for origin in self.origins.iter().map(|o| o.trim().trim_end_matches('/').to_string()) {
            if !origin.is_empty() && !origins.contains(&origin) {
                origins.push(origin);
            }
        }
        self.origins = origins;
        self.api_key = self.api_key.trim().to_string();
        if self.port == 0 {
            self.port = DEFAULT_PORT;
        }
        self
    }

    pub fn api_key(&self) -> Option<&str> {
        (!self.api_key.is_empty()).then_some(self.api_key.as_str())
    }

    pub fn load(path: &Path) -> Config {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Config>(&bytes).ok())
            .unwrap_or_default()
            .normalized()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(|err| err.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|err| err.to_string())?;
        std::fs::rename(&tmp, path).map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_file_gives_the_defaults() {
        let dir = std::env::temp_dir().join(format!("hayaki-ac-config-{}", std::process::id()));
        let path = dir.join("ankiconnect.json");
        assert_eq!(Config::load(&path), Config::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(Config::load(&path), Config::default());

        let config = Config { enabled: true, port: 9000, origins: vec!["moz-extension://abc".into()], api_key: "k".into() };
        config.save(&path).unwrap();
        assert_eq!(Config::load(&path), config);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn normalizing_cleans_the_origin_list() {
        let config = Config {
            origins: vec![" http://localhost/ ".into(), "".into(), "http://localhost".into(), "chrome-extension://x".into()],
            port: 0,
            api_key: "  ".into(),
            ..Config::default()
        }
        .normalized();
        assert_eq!(config.origins, vec!["http://localhost", "chrome-extension://x"]);
        assert_eq!(config.port, DEFAULT_PORT);
        assert_eq!(config.api_key(), None);
    }
}

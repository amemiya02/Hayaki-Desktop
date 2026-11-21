// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Each plugin's own key-value data: one JSON object per plugin, kept outside
//! the plugin's folder and capped in size.

use std::fs;
use std::path::Path;

use serde_json::Map;
use serde_json::Value;

pub const MAX_BYTES: usize = 1024 * 1024;

fn read(file: &Path) -> Map<String, Value> {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn valid_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.chars().count() > 128 {
        return Err("invalid-params: a storage key is 1 to 128 characters".into());
    }
    Ok(())
}

pub fn get(file: &Path, key: &str) -> Result<Option<Value>, String> {
    valid_key(key)?;
    Ok(read(file).remove(key))
}

/// Sets `key`, or removes it when `value` is None. Refuses a write that
/// would take the plugin's data past `limit` bytes.
pub fn set(file: &Path, key: &str, value: Option<Value>, limit: usize) -> Result<(), String> {
    valid_key(key)?;
    let mut data = read(file);
    match value {
        Some(value) => data.insert(key.to_string(), value),
        None => data.remove(key),
    };
    let bytes = serde_json::to_vec(&data).map_err(|err| err.to_string())?;
    if bytes.len() > limit {
        return Err(format!("storage-full: a plugin keeps at most {} KB", limit / 1024));
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|err| err.to_string())?;
    fs::rename(&temp, file).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn stores_and_removes_values() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data/com.example.x.json");
        assert_eq!(get(&file, "count").unwrap(), None);
        set(&file, "count", Some(json!({"day": "2026-11-21", "n": 3})), MAX_BYTES).unwrap();
        assert_eq!(get(&file, "count").unwrap(), Some(json!({"day": "2026-11-21", "n": 3})));
        set(&file, "count", None, MAX_BYTES).unwrap();
        assert_eq!(get(&file, "count").unwrap(), None);
        assert!(get(&file, "").is_err());
    }

    #[test]
    fn caps_each_plugins_data() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.json");
        set(&file, "a", Some(json!("x".repeat(600))), 1024).unwrap();
        let err = set(&file, "b", Some(json!("y".repeat(600))), 1024).unwrap_err();
        assert!(err.starts_with("storage-full"), "{err}");
        // The refused write left the earlier data alone, and shrinking still works.
        assert_eq!(get(&file, "a").unwrap(), Some(json!("x".repeat(600))));
        set(&file, "a", Some(json!("small")), 1024).unwrap();
    }
}

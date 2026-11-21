// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Copies a plugin package (a folder or a `.zip`) into a fresh staging folder,
//! refusing anything that could write outside it: absolute paths, `..`,
//! symbolic links, and archives that unpack to more than the limits allow.
//! Hidden files (`.git`, `.DS_Store`) and macOS's `__MACOSX` folder are left
//! out. The staged copy is what gets installed, so the source can change
//! after the person confirms without changing what runs.

use std::fs;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

use super::manifest;
use super::manifest::Manifest;
use super::manifest::MANIFEST_FILE;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_files: usize,
    pub max_total: u64,
    pub max_file: u64,
}

pub const LIMITS: Limits = Limits {
    max_files: 1000,
    max_total: 32 * 1024 * 1024,
    max_file: 16 * 1024 * 1024,
};

struct Budget {
    limits: Limits,
    files: usize,
    total: u64,
}

impl Budget {
    fn new(limits: Limits) -> Self {
        Self { limits, files: 0, total: 0 }
    }

    fn add_file(&mut self) -> Result<(), String> {
        self.files += 1;
        if self.files > self.limits.max_files {
            return Err(format!("the plugin has more than {} files", self.limits.max_files));
        }
        Ok(())
    }

    /// Copies at most the remaining budget; one byte more fails.
    fn copy(&mut self, reader: &mut dyn Read, dest: &Path) -> Result<(), String> {
        let allowed = self.limits.max_file.min(self.limits.max_total - self.total);
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest)
            .map_err(|err| err.to_string())?;
        let mut limited = reader.take(allowed + 1);
        let mut buffer = [0u8; 64 * 1024];
        let mut written: u64 = 0;
        loop {
            let n = limited.read(&mut buffer).map_err(|err| err.to_string())?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > allowed {
                return Err(if written > self.limits.max_file {
                    format!("a file in the plugin is larger than {} MB", self.limits.max_file / 1024 / 1024)
                } else {
                    format!("the plugin is larger than {} MB", self.limits.max_total / 1024 / 1024)
                });
            }
            out.write_all(&buffer[..n]).map_err(|err| err.to_string())?;
        }
        self.total += written;
        Ok(())
    }
}

/// Whether an entry is left out of the package rather than refused.
fn skipped(segment: &str) -> bool {
    segment.starts_with('.') || segment == "__MACOSX"
}

fn write_target(staging: &Path, relative: &str) -> Result<PathBuf, String> {
    if !manifest::valid_relative_path(relative) {
        return Err(format!("the plugin contains a file with an unsafe or unsupported name: {relative}"));
    }
    let target = staging.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(target)
}

fn copy_folder(source: &Path, relative: &str, staging: &Path, budget: &mut Budget, depth: usize) -> Result<(), String> {
    if depth > 16 {
        return Err("the plugin's folders are nested too deeply".into());
    }
    let dir = if relative.is_empty() { source.to_path_buf() } else { source.join(relative) };
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if skipped(&name) {
            continue;
        }
        let child = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
        // symlink_metadata never follows a link, so a link is seen as one.
        let kind = fs::symlink_metadata(entry.path()).map_err(|err| err.to_string())?.file_type();
        if kind.is_symlink() {
            return Err(format!("the plugin contains a symbolic link: {child}"));
        } else if kind.is_dir() {
            copy_folder(source, &child, staging, budget, depth + 1)?;
        } else if kind.is_file() {
            budget.add_file()?;
            let target = write_target(staging, &child)?;
            let mut file = File::open(entry.path()).map_err(|err| err.to_string())?;
            budget.copy(&mut file, &target)?;
        } else {
            return Err(format!("the plugin contains something that is not a file: {child}"));
        }
    }
    Ok(())
}

/// The folder inside the archive that holds the manifest: the root, or a
/// single top-level folder (what zipping a folder produces).
fn archive_prefix(names: &[String]) -> Result<String, String> {
    if names.iter().any(|n| n == MANIFEST_FILE) {
        return Ok(String::new());
    }
    let first = names.first().and_then(|n| n.split_once('/')).map(|(top, _)| top.to_string());
    if let Some(top) = first {
        let prefix = format!("{top}/");
        if names.iter().all(|n| n.starts_with(&prefix)) && names.iter().any(|n| *n == format!("{prefix}{MANIFEST_FILE}")) {
            return Ok(prefix);
        }
    }
    Err(format!("the archive has no {MANIFEST_FILE} at its root"))
}

fn unpack_zip(source: &Path, staging: &Path, budget: &mut Budget) -> Result<(), String> {
    let file = File::open(source).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| format!("the file is not a valid .zip: {err}"))?;
    if archive.len() > budget.limits.max_files * 2 {
        return Err(format!("the plugin has more than {} files", budget.limits.max_files));
    }
    let mut kept = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|err| err.to_string())?;
        let name = entry.name().to_string();
        // Checked on the raw name before anything else reads it: zip-slip
        // names (`../`, `/abs`, `C:\`) and links never reach the disk.
        let unsafe_name = entry.enclosed_name().is_none()
            || name.starts_with('/')
            || name.contains('\\')
            || name.split('/').any(|s| s == "..");
        if unsafe_name {
            return Err(format!("the archive contains an unsafe path: {name}"));
        }
        if name.split('/').any(skipped) {
            continue;
        }
        if entry.is_symlink() {
            return Err(format!("the archive contains a symbolic link: {name}"));
        }
        if !entry.is_dir() {
            kept.push((index, name));
        }
    }
    let names: Vec<String> = kept.iter().map(|(_, name)| name.clone()).collect();
    let prefix = archive_prefix(&names)?;
    for (index, name) in kept {
        budget.add_file()?;
        let target = write_target(staging, &name[prefix.len()..])?;
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        budget.copy(&mut entry, &target)?;
    }
    Ok(())
}

/// Stages `source` into the empty folder `staging` and returns its manifest.
pub fn stage(source: &Path, staging: &Path, limits: Limits) -> Result<Manifest, String> {
    let mut budget = Budget::new(limits);
    let kind = fs::symlink_metadata(source).map_err(|err| err.to_string())?.file_type();
    if kind.is_dir() {
        copy_folder(source, "", staging, &mut budget, 0)?;
    } else if kind.is_file() {
        unpack_zip(source, staging, &mut budget)?;
    } else {
        return Err("choose a plugin folder or a .zip file".into());
    }
    read_installed(staging)
}

/// Reads and checks the manifest of an unpacked plugin, including that its
/// entry and panels exist.
pub fn read_installed(dir: &Path) -> Result<Manifest, String> {
    let bytes = fs::read(dir.join(MANIFEST_FILE)).map_err(|_| format!("the plugin has no {MANIFEST_FILE}"))?;
    let manifest = manifest::parse(&bytes)?;
    let files = std::iter::once(&manifest.entry).chain(manifest.panels.iter().map(|p| &p.entry));
    for file in files {
        let path = dir.join(file);
        let is_file = fs::symlink_metadata(&path).map(|m| m.is_file()).unwrap_or(false);
        if !is_file {
            return Err(format!("the plugin's manifest names {file}, which is not in the plugin"));
        }
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use zip::write::SimpleFileOptions;

    use super::*;

    const MANIFEST: &str = r#"{"id":"com.example.streak","name":"Streak","version":"1.0.0","entry":"main.js"}"#;

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            writer.start_file(*name, SimpleFileOptions::default()).unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn stage_zip(bytes: &[u8], limits: Limits) -> (tempfile::TempDir, Result<Manifest, String>) {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("plugin.zip");
        fs::write(&archive, bytes).unwrap();
        let staging = dir.path().join("staging");
        fs::create_dir(&staging).unwrap();
        let result = stage(&archive, &staging, limits);
        (dir, result)
    }

    #[test]
    fn unpacks_a_zip_and_its_wrapping_folder() {
        let (dir, result) = stage_zip(&zip_with(&[("hayaki-plugin.json", MANIFEST.as_bytes()), ("main.js", b"1")]), LIMITS);
        assert_eq!(result.unwrap().id, "com.example.streak");
        assert!(dir.path().join("staging/main.js").is_file());

        let (dir, result) = stage_zip(
            &zip_with(&[
                ("streak/hayaki-plugin.json", MANIFEST.as_bytes()),
                ("streak/main.js", b"1"),
                ("__MACOSX/streak/._main.js", b"x"),
                ("streak/.DS_Store", b"x"),
            ]),
            LIMITS,
        );
        assert!(result.is_ok(), "{result:?}");
        assert!(dir.path().join("staging/main.js").is_file());
        assert!(!dir.path().join("staging/.DS_Store").exists());
    }

    #[test]
    fn refuses_zip_slip() {
        for name in ["../evil.js", "/tmp/evil.js", "a/../../evil.js", "..\\evil.js", "C:\\evil.js"] {
            let bytes = zip_with(&[("hayaki-plugin.json", MANIFEST.as_bytes()), ("main.js", b"1"), (name, b"x")]);
            let (dir, result) = stage_zip(&bytes, LIMITS);
            assert!(result.is_err(), "{name} was accepted");
            assert!(!dir.path().join("evil.js").exists());
        }
    }

    #[test]
    fn refuses_zip_symlinks() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("hayaki-plugin.json", SimpleFileOptions::default()).unwrap();
        writer.write_all(MANIFEST.as_bytes()).unwrap();
        writer.add_symlink("main.js", "/etc/passwd", SimpleFileOptions::default()).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let (_dir, result) = stage_zip(&bytes, LIMITS);
        assert!(result.unwrap_err().contains("symbolic link"));
    }

    #[test]
    fn enforces_size_limits() {
        let big = vec![0u8; 2048];
        let bytes = zip_with(&[("hayaki-plugin.json", MANIFEST.as_bytes()), ("main.js", &big)]);
        let small = Limits { max_files: 10, max_total: 100_000, max_file: 1024 };
        let (_dir, result) = stage_zip(&bytes, small);
        assert!(result.unwrap_err().contains("larger than"));

        let many: Vec<(String, Vec<u8>)> = (0..12).map(|i| (format!("f{i}.js"), vec![1])).collect();
        let mut entries: Vec<(&str, &[u8])> = vec![("hayaki-plugin.json", MANIFEST.as_bytes()), ("main.js", b"1")];
        entries.extend(many.iter().map(|(n, b)| (n.as_str(), b.as_slice())));
        let (_dir, result) = stage_zip(&zip_with(&entries), small);
        assert!(result.unwrap_err().contains("more than"));
    }

    #[test]
    fn requires_the_manifest_files() {
        let (_dir, result) = stage_zip(&zip_with(&[("hayaki-plugin.json", MANIFEST.as_bytes())]), LIMITS);
        assert!(result.unwrap_err().contains("main.js"));
        let (_dir, result) = stage_zip(&zip_with(&[("main.js", b"1")]), LIMITS);
        assert!(result.unwrap_err().contains("hayaki-plugin.json"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_folder_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("plugin");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("hayaki-plugin.json"), MANIFEST).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", source.join("main.js")).unwrap();
        let staging = dir.path().join("staging");
        fs::create_dir(&staging).unwrap();
        assert!(stage(&source, &staging, LIMITS).unwrap_err().contains("symbolic link"));
    }

    #[test]
    fn copies_a_folder_without_hidden_files() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("plugin");
        fs::create_dir_all(source.join(".git")).unwrap();
        fs::create_dir_all(source.join("panel")).unwrap();
        fs::write(source.join("hayaki-plugin.json"), MANIFEST).unwrap();
        fs::write(source.join("main.js"), "1").unwrap();
        fs::write(source.join("panel/today.html"), "<p>").unwrap();
        fs::write(source.join(".git/config"), "x").unwrap();
        let staging = dir.path().join("staging");
        fs::create_dir(&staging).unwrap();
        stage(&source, &staging, LIMITS).unwrap();
        assert!(staging.join("panel/today.html").is_file());
        assert!(!staging.join(".git").exists());
    }
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Serves the open profile's media folder to card content over the `media`
//! scheme (`http://media.localhost/<file>` on Windows, `media://localhost/<file>`
//! elsewhere). Only plain file names inside the media folder are served, and
//! byte ranges are supported so audio and video can seek.
//!
//! A media file opened as a page runs nothing: every file carries a sandbox
//! policy with no script or network sources, and `nosniff`, so an `.html` file added to the
//! media folder cannot become a page with scripts (ADR 0004). Images, sounds,
//! scripts and styles that the card page loads are unaffected, since a
//! policy applies only to the document it arrives with.

use std::fs::File;
use std::io::Read;
use std::io::Seek;
use std::io::SeekFrom;
use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::http::header;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::StatusCode;

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap()
}

/// Maps a request path to a file in the media folder, refusing anything that
/// could leave it.
fn resolve(media_folder: &PathBuf, path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(path.trim_start_matches('/'))
        .decode_utf8()
        .ok()?
        .into_owned();
    plain_name(&decoded).then(|| media_folder.join(decoded))
}

/// A single file name that cannot leave the folder it is joined to: no
/// separators, no drive prefix, and not `.` or `..`. The plugin scheme applies
/// the same rule to every segment of a plugin's paths.
pub(crate) fn plain_name(name: &str) -> bool {
    !(name.is_empty() || name.contains(['/', '\\', ':', '\0']) || name == "." || name == "..")
}

fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    let (start, end) = if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        (len.saturating_sub(suffix), len.checked_sub(1)?)
    } else {
        let start: u64 = start.parse().ok()?;
        let end = if end.is_empty() {
            len.checked_sub(1)?
        } else {
            end.parse::<u64>().ok()?.min(len.checked_sub(1)?)
        };
        (start, end)
    };
    (start <= end && end < len).then_some((start, end))
}

/// The card page and MathJax, embedded at build time from `src-tauri/card`.
static CARD_ASSETS: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/card");

fn serve_card_asset(path: &str) -> Response<Vec<u8>> {
    let Some(file) = CARD_ASSETS.get_file(path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.essence_str())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "max-age=3600")
        .body(file.contents().to_vec())
        .unwrap()
}

/// No scripts and no network. Styles, images and fonts stay, because an SVG
/// shown as an image also gets this policy and often styles itself inline.
const MEDIA_FILE_CSP: &str =
    "sandbox; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";

pub fn serve(media_folder: Option<PathBuf>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if let Some(asset) = request.uri().path().strip_prefix("/_hayaki/") {
        return serve_card_asset(asset);
    }
    let Some(media_folder) = media_folder else {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    };
    let Some(path) = resolve(&media_folder, request.uri().path()) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Ok(mut file) = File::open(&path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or_default();
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime.essence_str())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONTENT_SECURITY_POLICY, MEDIA_FILE_CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_range(value, len));
    match range {
        Some(Some((start, end))) => {
            let mut body = vec![0; (end - start + 1) as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err() {
                return status(StatusCode::INTERNAL_SERVER_ERROR);
            }
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .body(body)
                .unwrap()
        }
        Some(None) => Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Vec::new())
            .unwrap(),
        None => {
            let mut body = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut body).is_err() {
                return status(StatusCode::INTERNAL_SERVER_ERROR);
            }
            builder.status(StatusCode::OK).body(body).unwrap()
        }
    }
}

/// Reads a file the person chose (through the open dialog or a drop), so the
/// interface can add it to the media folder with the core's AddMediaFile.
#[tauri::command]
pub async fn read_chosen_file(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || std::fs::read(path).map_err(|err| err.to_string()))
        .await
        .map_err(|err| err.to_string())?
        .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_paths_outside_the_folder() {
        let folder = PathBuf::from("media");
        assert!(resolve(&folder, "/..").is_none());
        assert!(resolve(&folder, "/a%2Fb.png").is_none());
        assert!(resolve(&folder, "/..%5Csecret").is_none());
        assert!(resolve(&folder, "/C:x").is_none());
        assert_eq!(
            resolve(&folder, "/%E7%8C%AB.jpg"),
            Some(folder.join("猫.jpg"))
        );
    }

    fn get(folder: &std::path::Path, path: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut request = Request::builder().uri(format!("media://localhost{path}"));
        if let Some(range) = range {
            request = request.header(header::RANGE, range);
        }
        serve(Some(folder.to_path_buf()), &request.body(Vec::new()).unwrap())
    }

    #[test]
    fn media_files_run_nothing_when_opened_as_a_page() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("x.html"), "<script>1</script>").unwrap();
        for response in [get(dir.path(), "/x.html", None), get(dir.path(), "/x.html", Some("bytes=0-3"))] {
            assert!(response.status().is_success());
            let policy = response.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
            assert!(policy.starts_with("sandbox; default-src 'none';"), "{policy}");
            assert!(!policy.contains("script-src") && !policy.contains("connect-src"), "{policy}");
            assert_eq!(response.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        }
        // The card page is the interface's own and keeps its scripts.
        let card = get(dir.path(), "/_hayaki/card.html", None);
        assert!(card.status().is_success());
        assert!(card.headers().get(header::CONTENT_SECURITY_POLICY).is_none());
    }

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-9", 100), Some((0, 9)));
        assert_eq!(parse_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=50-500", 100), Some((50, 99)));
        assert_eq!(parse_range("bytes=200-300", 100), None);
    }
}

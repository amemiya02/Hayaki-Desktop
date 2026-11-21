// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Media actions: AnkiConnect's storeMediaFile, retrieveMediaFile,
//! getMediaFilesNames and deleteMediaFile, and the media lists inside a note.

use std::net::IpAddr;
use std::net::Ipv4Addr;
use std::net::SocketAddr;
use std::path::Component;
use std::path::Path;
use std::time::Duration;

use anki_proto::media::AddMediaFileRequest;
use anki_proto::media::TrashMediaFilesRequest;
use data_encoding::BASE64;
use data_encoding::BASE64_NOPAD;
use data_encoding::HEXLOWER;
use sha1::Digest;
use sha1::Sha1;
use unicode_normalization::UnicodeNormalization;

use super::calls;
use super::calls::Col;

/// Downloads larger than this are refused.
const MAX_DOWNLOAD: usize = 256 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// Redirects a download from a web page may take, each checked like the first URL.
const MAX_REDIRECTS: usize = 10;

/// Who asked for a file. A local program (a request without an Origin
/// header) may read any file and fetch any address, as with AnkiConnect. A
/// web page or extension may not read files on this computer or reach
/// loopback and private network addresses through the server.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Requester {
    Local,
    Browser,
}

/// Where a file's bytes come from; the first present one wins, as in AnkiConnect.
pub struct Source<'a> {
    pub data: Option<&'a str>,
    pub path: Option<&'a str>,
    pub url: Option<&'a str>,
}

impl Source<'_> {
    pub fn read(&self, requester: Requester) -> Result<Vec<u8>, String> {
        let present = |v: Option<&str>| v.filter(|s| !s.is_empty()).map(str::to_string);
        if let Some(data) = present(self.data) {
            decode_base64(&data)
        } else if let Some(path) = present(self.path) {
            if requester == Requester::Browser {
                return Err(format!(r#"{path}: "path" can only be used by a program on this computer, not by a web page or extension"#));
            }
            std::fs::read(&path).map_err(|err| format!("{path}: {err}"))
        } else if let Some(url) = present(self.url) {
            download(&url, requester)
        } else {
            Err(r#"You must provide a "data", "path", or "url" field."#.into())
        }
    }
}

pub fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = data.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    BASE64
        .decode(cleaned.as_bytes())
        .or_else(|_| BASE64_NOPAD.decode(cleaned.trim_end_matches('=').as_bytes()))
        .map_err(|err| format!("invalid base64 data: {err}"))
}

pub fn encode_base64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// Whether a web page may reach `ip` through the server: not loopback,
/// private, link-local, unique-local, shared, multicast or unspecified.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || a == 0
                || (a == 100 && b & 0xc0 == 64))
        }
        IpAddr::V6(v6) => {
            let segments = v6.segments();
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(v4.into());
            }
            // A NAT64 address stands for the IPv4 address in its last 32 bits.
            if segments[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
                let [.., a, b, c, d] = v6.octets();
                return is_public(Ipv4Addr::new(a, b, c, d).into());
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || segments[0] & 0xfe00 == 0xfc00
                || segments[0] & 0xffc0 == 0xfe80)
        }
    }
}

/// Fetches an http or https URL with the HTTP client the core already uses.
/// For a web page every hop is resolved first and refused unless all its
/// addresses are public; the connection then goes to the checked addresses,
/// so a name that resolves differently a moment later gains nothing.
fn download(url: &str, requester: Requester) -> Result<Vec<u8>, String> {
    let original = url.to_string();
    let fetch = async move {
        let url = original.as_str();
        let mut target = reqwest::Url::parse(url).map_err(|err| format!("{url}: {err}"))?;
        let mut hops = 0;
        let mut response = loop {
            if !matches!(target.scheme(), "http" | "https") {
                return Err(format!("{url}: only http and https URLs can be downloaded"));
            }
            let mut client = reqwest::Client::builder().timeout(DOWNLOAD_TIMEOUT);
            if requester == Requester::Browser {
                let addrs = resolve(&target).await.map_err(|err| format!("{url}: {err}"))?;
                if let Some(addr) = addrs.iter().find(|addr| !is_public(addr.ip())) {
                    return Err(format!("{url}: a web page cannot download from {} through Hayaki", addr.ip()));
                }
                client = client.no_proxy().redirect(reqwest::redirect::Policy::none());
                if let Some(domain) = target.domain() {
                    client = client.resolve_to_addrs(domain, &addrs);
                }
            }
            let client = client.build().map_err(|err| err.to_string())?;
            let response = client.get(target.clone()).send().await.map_err(|err| format!("{url}: {err}"))?;
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok());
            match location {
                Some(location) if response.status().is_redirection() && requester == Requester::Browser => {
                    hops += 1;
                    if hops > MAX_REDIRECTS {
                        return Err(format!("{url}: too many redirects"));
                    }
                    target = target.join(location).map_err(|err| format!("{url}: {err}"))?;
                }
                _ => break response,
            }
        };
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("{url} download failed with return code {}", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|err| format!("{url}: {err}"))? {
            if bytes.len() + chunk.len() > MAX_DOWNLOAD {
                return Err(format!("{url}: the file is too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    };
    // Actions run on a blocking thread, so waiting here does not hold up the runtime.
    tauri::async_runtime::handle().block_on(fetch)
}

async fn resolve(url: &reqwest::Url) -> Result<Vec<SocketAddr>, String> {
    let port = url.port_or_known_default().unwrap_or(80);
    let host = url.host_str().unwrap_or("");
    let literal = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>();
    let addrs: Vec<SocketAddr> = match literal {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::net::lookup_host((host, port)).await.map_err(|err| err.to_string())?.collect(),
    };
    if addrs.is_empty() {
        return Err("the address could not be found".into());
    }
    Ok(addrs)
}

/// Writes a file into the media folder; returns the name the core gave it,
/// or None when `skip_hash` matches the file's MD5.
///
/// The core cleans the name (case, characters, length) and, when a different
/// file already has it, stores this one as `name-<sha1>.ext`. With
/// `delete_existing` that clash means "replace": the file under the cleaned
/// name and the renamed copy go to the trash and the file is stored again
/// under the cleaned name.
pub fn store(col: &Col, filename: &str, bytes: Vec<u8>, skip_hash: Option<&str>, delete_existing: bool) -> Result<Option<String>, String> {
    if skip_hash.is_some_and(|hash| hash.eq_ignore_ascii_case(&md5_hex(&bytes))) {
        return Ok(None);
    }
    let add = |name: &str, data: Vec<u8>| col.call(calls::ADD_MEDIA_FILE, AddMediaFileRequest { desired_name: name.into(), data }).map(|n| n.val);
    let suffix = format!("-{}", HEXLOWER.encode(&Sha1::digest(&bytes)));
    let stored = add(filename, bytes.clone())?;
    let Some(at) = stored.rfind(&suffix).filter(|_| delete_existing) else { return Ok(Some(stored)) };
    let clashing = format!("{}{}", &stored[..at], &stored[at + suffix.len()..]);
    col.call(calls::TRASH_MEDIA_FILES, TrashMediaFilesRequest { fnames: vec![clashing.clone(), stored] })?;
    Ok(Some(add(&clashing, bytes)?))
}

/// Moves a file to the media trash, as Anki's own delete does.
pub fn delete(col: &Col, filename: &str) -> Result<(), String> {
    let Some(name) = safe_name(filename) else { return Ok(()) };
    if !col.media_folder.join(&name).is_file() {
        return Ok(());
    }
    col.call(calls::TRASH_MEDIA_FILES, TrashMediaFilesRequest { fnames: vec![name] })?;
    Ok(())
}

/// The base name of `filename` in NFC, or None for a name that would leave
/// the media folder: `..`, a Windows drive or device prefix (`C:x`), or a
/// colon (an NTFS alternate stream).
pub fn safe_name(filename: &str) -> Option<String> {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = base.nfc().collect();
    let mut components = Path::new(&name).components();
    let single = matches!((components.next(), components.next()), (Some(Component::Normal(_)), None));
    (single && !name.contains([':', '\0'])).then_some(name)
}

pub fn retrieve(folder: &Path, filename: &str) -> Option<String> {
    let name = safe_name(filename)?;
    std::fs::read(folder.join(name)).ok().map(|bytes| encode_base64(&bytes))
}

pub fn names(folder: &Path, pattern: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| fnmatch(name, pattern))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Shell-style matching as Python's fnmatch: `*`, `?`, `[seq]` and `[!seq]`.
pub fn fnmatch(name: &str, pattern: &str) -> bool {
    fn class(pattern: &[char], c: char) -> Option<(bool, usize)> {
        // Returns whether `c` matches and the length of the class, or None
        // when the bracket is not closed (then it is a literal `[`).
        let mut i = 1;
        let negate = matches!(pattern.get(1), Some('!'));
        if negate {
            i += 1;
        }
        let start = i;
        let mut matched = false;
        while i < pattern.len() {
            if pattern[i] == ']' && i > start {
                return Some((matched != negate, i + 1));
            }
            if pattern.get(i + 1) == Some(&'-') && pattern.get(i + 2).is_some_and(|&end| end != ']') {
                matched |= pattern[i] <= c && c <= pattern[i + 2];
                i += 3;
            } else {
                matched |= pattern[i] == c;
                i += 1;
            }
        }
        None
    }
    fn go(name: &[char], pattern: &[char]) -> bool {
        match pattern.first() {
            None => name.is_empty(),
            Some('*') => (0..=name.len()).any(|skip| go(&name[skip..], &pattern[1..])),
            Some('?') => !name.is_empty() && go(&name[1..], &pattern[1..]),
            Some('[') => match class(pattern, name.first().copied().unwrap_or('\0')) {
                Some((matched, len)) => !name.is_empty() && matched && go(&name[1..], &pattern[len..]),
                None => name.first() == Some(&'[') && go(&name[1..], &pattern[1..]),
            },
            Some(&p) => name.first() == Some(&p) && go(&name[1..], &pattern[1..]),
        }
    }
    let name: Vec<char> = name.chars().collect();
    let mut pattern: Vec<char> = pattern.chars().collect();
    // Repeated stars match the same as one and would only slow the search.
    pattern.dedup_by(|a, b| *a == '*' && *b == '*');
    go(&name, &pattern)
}

/// MD5, for AnkiConnect's `skipHash` (written out because nothing in the
/// dependency tree provides it).
pub fn md5_hex(data: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16,
        23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64).map(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32).collect();
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    let mut message = data.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_le_bytes());
    for block in message.chunks(64) {
        let m: Vec<u32> = block.chunks(4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect();
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a.wrapping_add(f).wrapping_add(k[i]).wrapping_add(m[g]).rotate_left(S[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d]) {
            *slot = slot.wrapping_add(value);
        }
    }
    state.iter().flat_map(|word| word.to_le_bytes()).map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_known_digests() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex(b"The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
        let long = vec![b'a'; 1000];
        assert_eq!(md5_hex(&long), "cabe45dcc9ae5b66ba86600cca6b8ba8");
    }

    #[test]
    fn fnmatch_follows_python() {
        assert!(fnmatch("a.mp3", "*"));
        assert!(fnmatch("a.mp3", "*.mp3"));
        assert!(!fnmatch("a.mp3", "*.jpg"));
        assert!(fnmatch("_hayaki.css", "_*"));
        assert!(fnmatch("img1.png", "img?.png"));
        assert!(fnmatch("img1.png", "img[0-9].png"));
        assert!(!fnmatch("imgx.png", "img[0-9].png"));
        assert!(fnmatch("imgx.png", "img[!0-9].png"));
        assert!(fnmatch("[a", "[a"));
        assert!(fnmatch("日本語.mp3", "日*.mp3"));
    }

    #[test]
    fn names_cannot_leave_the_media_folder() {
        assert_eq!(safe_name("../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(safe_name("..\\secret.txt").as_deref(), Some("secret.txt"));
        assert_eq!(safe_name(".."), None);
        assert_eq!(safe_name("dir/"), None);
        assert_eq!(safe_name("."), None);
        // Drive-relative and stream names on Windows.
        assert_eq!(safe_name("C:secret.txt"), None);
        assert_eq!(safe_name("C:"), None);
        assert_eq!(safe_name("note.txt:stream"), None);
        assert_eq!(safe_name("\\\\?\\C:"), None);
        // NFD input becomes NFC, as AnkiConnect normalises it.
        assert_eq!(safe_name("e\u{301}.mp3").as_deref(), Some("\u{e9}.mp3"));
    }

    #[test]
    fn web_pages_reach_only_public_addresses() {
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "255.255.255.255", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "64:ff9b::a00:1"] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn web_pages_cannot_read_local_files() {
        let path = std::env::temp_dir().join(format!("hayaki-ac-local-{}.txt", std::process::id()));
        std::fs::write(&path, b"private").unwrap();
        let source = Source { data: None, path: path.to_str(), url: None };
        assert!(source.read(Requester::Browser).is_err());
        assert_eq!(source.read(Requester::Local).unwrap(), b"private");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn base64_accepts_padding_and_line_breaks() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVs\nbG8").unwrap(), b"hello");
        assert!(decode_base64("***").is_err());
    }
}

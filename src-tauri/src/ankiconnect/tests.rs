// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! The protocol and actions against a throwaway collection in the real core,
//! and the server over a real socket.

use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

use anki::services::BackendCollectionService;
use anki_proto::collection::CloseCollectionRequest;
use anki_proto::collection::OpenCollectionRequest;
use serde_json::json;
use serde_json::Value;

use super::calls::Col;
use super::config::Config;
use super::actions::ACTIONS;
use super::protocol::respond;
use super::protocol::AddPrefill;
use super::protocol::Event;
use super::protocol::Host;
use super::protocol::HttpRequest;
use super::server;
use crate::core::Core;

struct TestHost {
    col: Option<(anki::backend::Backend, PathBuf)>,
    config: Mutex<Config>,
    events: Mutex<Vec<Event>>,
    grant: bool,
    asked: Mutex<Vec<String>>,
}

impl Host for TestHost {
    fn collection(&self) -> Option<Col<'_>> {
        self.col.as_ref().map(|(backend, media)| Col { backend: backend.clone(), profile: "Test".into(), media_folder: media.clone(), _held: None })
    }
    fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }
    fn notify(&self, event: Event) {
        self.events.lock().unwrap().push(event);
    }
    fn ask_permission(&self, origin: &str) -> bool {
        self.asked.lock().unwrap().push(origin.into());
        if self.grant {
            self.config.lock().unwrap().origins.push(origin.into());
        }
        self.grant
    }
}

/// A host with a new collection in its own folder, closed and removed on drop.
struct Fixture {
    host: Arc<TestHost>,
    dir: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some((backend, _)) = &self.host.col {
            let _ = backend.close_collection(CloseCollectionRequest { downgrade_to_schema11: false });
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn fixture(name: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("hayaki-ankiconnect-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let media = dir.join("collection.media");
    std::fs::create_dir_all(&media).unwrap();
    let backend = Core::new(vec!["en".into()]).unwrap().backend();
    backend
        .open_collection(OpenCollectionRequest {
            collection_path: dir.join("collection.anki2").to_string_lossy().into(),
            media_folder_path: media.to_string_lossy().into(),
            media_db_path: dir.join("collection.media.db2").to_string_lossy().into(),
        })
        .unwrap();
    let host = TestHost { col: Some((backend, media)), config: Mutex::new(Config::default()), events: Mutex::default(), grant: false, asked: Mutex::default() };
    Fixture { host: Arc::new(host), dir }
}

fn post(host: &dyn Host, origin: Option<&str>, body: Value) -> (u16, Value) {
    let body = body.to_string();
    let reply = respond(host, &HttpRequest { method: "POST", origin, host: Some("127.0.0.1:8765"), private_network: false, body: body.as_bytes() });
    (reply.status, serde_json::from_slice(&reply.body).unwrap_or(Value::Null))
}

fn call(host: &dyn Host, action: &str, params: Value) -> Value {
    let (_, reply) = post(host, None, json!({ "action": action, "version": 6, "params": params }));
    assert!(reply["error"].is_null(), "{action}: {}", reply["error"]);
    reply["result"].clone()
}

fn error(host: &dyn Host, action: &str, params: Value) -> String {
    let (_, reply) = post(host, None, json!({ "action": action, "version": 6, "params": params }));
    reply["error"].as_str().unwrap_or_else(|| panic!("{action} should fail")).to_string()
}

fn basic(front: &str, back: &str) -> Value {
    json!({ "deckName": "Default", "modelName": "Basic", "fields": { "Front": front, "Back": back }, "tags": ["yomitan"] })
}

#[test]
fn envelopes_versions_and_unknown_actions() {
    let f = fixture("envelope");
    let host = &*f.host;
    // Version 4 (the default) answers with the bare result.
    assert_eq!(post(host, None, json!({ "action": "version" })).1, json!(6));
    assert_eq!(post(host, None, json!({ "action": "version", "version": 6 })).1, json!({ "result": 6, "error": null }));
    assert_eq!(post(host, None, json!({ "action": "nope", "version": 6 })).1, json!({ "result": null, "error": "unsupported action" }));
    assert_eq!(post(host, None, json!({ "action": "nope" })).1, json!({ "result": null, "error": "unsupported action" }));

    let raw = |body: &[u8], method: &str| respond(host, &HttpRequest { method, origin: None, host: Some("localhost:8765"), private_network: false, body });
    assert_eq!(raw(b"", "GET").body, b"AnkiConnect v.6");
    assert_eq!(raw(b"{broken", "POST").body, b"null");

    // A missing argument reads as Python's.
    assert_eq!(error(host, "modelFieldNames", json!({})), "modelFieldNames() missing 1 required positional argument: 'modelName'");
    assert_eq!(error(host, "modelFieldNames", json!({ "modelName": "Nope" })), "model was not found: Nope");
}

#[test]
fn multi_runs_each_action_with_its_own_version() {
    let f = fixture("multi");
    let result = call(
        &*f.host,
        "multi",
        json!({ "actions": [
            { "action": "deckNames" },
            { "action": "deckNames", "version": 6 },
            { "action": "invalidAction", "params": { "useless": "param" } },
            { "action": "invalidAction", "params": { "useless": "param" }, "version": 6 }
        ] }),
    );
    assert_eq!(
        result,
        json!([
            ["Default"],
            { "result": ["Default"], "error": null },
            { "result": null, "error": "unsupported action" },
            { "result": null, "error": "unsupported action" }
        ])
    );
}

#[test]
fn api_key_is_required_once_set() {
    let f = fixture("key");
    f.host.config.lock().unwrap().api_key = "s3cret".into();
    let host = &*f.host;
    let denied = json!({ "result": null, "error": "valid api key must be provided" });
    assert_eq!(post(host, None, json!({ "action": "deckNames", "version": 6 })).1, denied);
    assert_eq!(post(host, None, json!({ "action": "deckNames", "version": 6, "key": "wrong" })).1, denied);
    assert_eq!(post(host, None, json!({ "action": "deckNames", "version": 6, "key": "s3cret" })).1["result"], json!(["Default"]));
    // Inner actions of an authorised multi carry its key.
    let multi = json!({ "action": "multi", "version": 6, "key": "s3cret", "params": { "actions": [{ "action": "version", "version": 6 }] } });
    assert_eq!(post(host, None, multi).1["result"], json!([{ "result": 6, "error": null }]));
    // requestPermission answers without a key and says one is needed.
    let permission = post(host, None, json!({ "action": "requestPermission", "version": 6 })).1;
    assert_eq!(permission["result"], json!({ "permission": "granted", "requireApikey": true, "version": 6 }));
}

#[test]
fn origins_are_checked_and_preflights_answered() {
    let f = fixture("origin");
    let host = &*f.host;
    let (status, body) = post(host, Some("https://evil.example"), json!({ "action": "deckNames", "version": 6 }));
    assert_eq!((status, body), (403, json!({ "result": null, "error": "Origin not allowed" })));

    let extension = "chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn";
    let (status, body) = post(host, Some(extension), json!({ "action": "deckNames", "version": 6 }));
    assert_eq!((status, body["result"].clone()), (200, json!(["Default"])));

    let preflight = respond(host, &HttpRequest { method: "OPTIONS", origin: Some(extension), host: Some("127.0.0.1:8765"), private_network: true, body: b"" });
    assert_eq!(preflight.status, 200);
    let header = |name: &str| preflight.headers.iter().find(|(n, _)| *n == name).map(|(_, v)| v.clone());
    assert_eq!(header("Access-Control-Allow-Origin").as_deref(), Some(extension));
    assert_eq!(header("Access-Control-Allow-Headers").as_deref(), Some("*"));
    assert_eq!(header("Access-Control-Allow-Private-Network").as_deref(), Some("true"));

    // A rebound DNS name is refused whatever the origin.
    let rebound = respond(host, &HttpRequest { method: "POST", origin: None, host: Some("evil.example:8765"), private_network: false, body: br#"{"action":"version"}"# });
    assert_eq!(rebound.status, 403);

    // A page that is not listed may ask; denied here, and it can read the answer.
    let (status, body) = post(host, Some("https://site.example"), json!({ "action": "requestPermission", "version": 6 }));
    assert_eq!((status, body["result"].clone()), (200, json!({ "permission": "denied" })));
}

#[test]
fn granted_permission_lists_the_origin() {
    let mut f = fixture("grant");
    Arc::get_mut(&mut f.host).unwrap().grant = true;
    let host = &*f.host;
    let (_, body) = post(host, Some("https://site.example"), json!({ "action": "requestPermission", "version": 6 }));
    assert_eq!(body["result"]["permission"], "granted");
    let (status, _) = post(host, Some("https://site.example"), json!({ "action": "deckNames", "version": 6 }));
    assert_eq!(status, 200);
}

#[test]
fn without_a_profile_actions_say_the_collection_is_not_available() {
    let host = TestHost { col: None, config: Mutex::new(Config::default()), events: Mutex::default(), grant: false, asked: Mutex::default() };
    assert_eq!(error(&host, "deckNames", json!({})), "collection is not available");
    assert_eq!(call(&host, "version", json!({})), json!(6));
}

#[test]
fn reads_decks_models_and_fields() {
    let f = fixture("reads");
    let host = &*f.host;
    assert_eq!(call(host, "deckNames", json!({})), json!(["Default"]));
    assert_eq!(call(host, "deckNamesAndIds", json!({})), json!({ "Default": 1 }));
    let models = call(host, "modelNames", json!({}));
    assert!(models.as_array().unwrap().contains(&json!("Basic")), "{models}");
    assert!(call(host, "modelNamesAndIds", json!({}))["Basic"].is_i64());
    assert_eq!(call(host, "modelFieldNames", json!({ "modelName": "Basic" })), json!(["Front", "Back"]));
    assert_eq!(call(host, "modelFieldsOnTemplates", json!({ "modelName": "Basic" })), json!({ "Card 1": [["Front"], ["Back"]] }));
}

#[test]
fn adds_finds_and_updates_notes() {
    let f = fixture("notes");
    let host = &*f.host;
    let id = call(host, "addNote", json!({ "note": basic("食べる", "to eat") }));
    assert!(id.as_i64().unwrap() > 0);
    assert!(f.host.events.lock().unwrap().iter().any(|e| matches!(e, Event::Changed(c) if c.note)), "an add refreshes the interface");

    assert_eq!(call(host, "findNotes", json!({ "query": "deck:Default" })), json!([id]));
    assert_eq!(call(host, "findNotes", json!({ "query": "Front:食べる" })), json!([id]));
    assert_eq!(call(host, "findNotes", json!({ "query": "nothing-matches-this" })), json!([]));
    let cards = call(host, "findCards", json!({ "query": format!("nid:{id}") }));
    assert_eq!(cards.as_array().unwrap().len(), 1);

    let info = &call(host, "notesInfo", json!({ "notes": [id, 1] }));
    assert_eq!(info[0]["modelName"], "Basic");
    assert_eq!(info[0]["fields"]["Front"], json!({ "value": "食べる", "order": 0 }));
    assert_eq!(info[0]["tags"], json!(["yomitan"]));
    assert_eq!(info[0]["cards"], cards);
    assert_eq!(info[0]["profile"], "Test");
    assert_eq!(info[1], json!({}), "a missing note gives an empty object");

    let card = &call(host, "cardsInfo", json!({ "cards": cards }))[0];
    assert_eq!(card["deckName"], "Default");
    assert_eq!(card["note"], id);
    assert!(card["question"].as_str().unwrap().starts_with("<style>"));
    assert!(card["question"].as_str().unwrap().contains("食べる"));
    assert!(card["answer"].as_str().unwrap().contains("to eat"));

    call(host, "updateNoteFields", json!({ "note": { "id": id, "fields": { "Back": "to eat (v1)" } } }));
    assert_eq!(call(host, "notesInfo", json!({ "notes": [id] }))[0]["fields"]["Back"]["value"], "to eat (v1)");

    call(host, "addTags", json!({ "notes": [id], "tags": "jlpt::n5 verb" }));
    let mut tags: Vec<String> = serde_json::from_value(call(host, "getTags", json!({}))).unwrap();
    tags.sort();
    assert_eq!(tags, vec!["jlpt::n5", "verb", "yomitan"]);
    call(host, "removeTags", json!({ "notes": [id], "tags": "verb" }));
    assert_eq!(call(host, "notesInfo", json!({ "query": format!("nid:{id}") }))[0]["tags"], json!(["jlpt::n5", "yomitan"]));

    assert_eq!(error(host, "updateNoteFields", json!({ "note": { "id": 42, "fields": {} } })), "note was not found: 42");
}

#[test]
fn duplicate_checks_follow_ankiconnect() {
    let f = fixture("dupes");
    let host = &*f.host;
    call(host, "addNote", json!({ "note": basic("犬", "dog") }));
    let other_deck = |options: Value| {
        let mut note = basic("犬", "dog");
        note["deckName"] = json!("Other");
        note["options"] = options;
        note
    };
    // A second Deck to compare Deck scopes against (DecksService.AddDeck).
    f.host.col.as_ref().unwrap().0.run_service_method(7, 1, &prost::Message::encode_to_vec(&anki_proto::decks::Deck {
        name: "Other".into(),
        kind: Some(anki_proto::decks::deck::Kind::Normal(Default::default())),
        ..Default::default()
    }))
    .unwrap();

    let can = call(
        host,
        "canAddNotes",
        json!({ "notes": [
            basic("犬", "dog"),
            basic("猫", "cat"),
            basic("", "empty"),
            other_deck(json!({ "duplicateScope": "deck" })),
            other_deck(json!({ "duplicateScope": "deck", "duplicateScopeOptions": { "deckName": "Default" } })),
            other_deck(json!({ "allowDuplicate": true })),
        ] }),
    );
    assert_eq!(can, json!([false, true, false, true, false, true]));

    let detail = call(host, "canAddNotesWithErrorDetail", json!({ "notes": [basic("犬", "dog"), basic("猫", "cat")] }));
    assert_eq!(detail, json!([{ "canAdd": false, "error": "cannot create note because it is a duplicate" }, { "canAdd": true }]));
    assert_eq!(error(host, "addNote", json!({ "note": basic("", "x") })), "cannot create note because it is empty");
    assert_eq!(
        error(host, "addNote", json!({ "note": other_deck(json!({ "allowDuplicate": "yes" })) })),
        r#"option parameter "allowDuplicate" must be boolean"#
    );
    let mut missing = basic("鳥", "bird");
    missing["deckName"] = json!("Nowhere");
    assert_eq!(error(host, "addNote", json!({ "note": missing })), "deck was not found: Nowhere");

    // addNotes adds what it can; a note that cannot be added is null.
    let ids = call(host, "addNotes", json!({ "notes": [basic("鳥", "bird"), basic("犬", "dog"), basic("", "empty"), basic("魚", "fish")] }));
    let ids = ids.as_array().unwrap();
    assert_eq!(ids.len(), 4);
    assert!(ids[1].is_null() && ids[2].is_null(), "{ids:?}");
    assert_eq!(call(host, "findNotes", json!({ "query": "Front:鳥" })), json!([ids[0]]));
    assert_eq!(call(host, "findNotes", json!({ "query": "Front:魚" })), json!([ids[3]]));
}

#[test]
fn stores_and_reads_media() {
    let f = fixture("media");
    let host = &*f.host;
    let name = call(host, "storeMediaFile", json!({ "filename": "_hello.txt", "data": "aGVsbG8=" }));
    assert_eq!(name, "_hello.txt");
    assert_eq!(call(host, "retrieveMediaFile", json!({ "filename": "_hello.txt" })), "aGVsbG8=");
    assert_eq!(call(host, "retrieveMediaFile", json!({ "filename": "missing.txt" })), json!(false));
    assert_eq!(call(host, "retrieveMediaFile", json!({ "filename": "../collection.anki2" })), json!(false));
    assert_eq!(call(host, "getMediaFilesNames", json!({ "pattern": "_hel*" })), json!(["_hello.txt"]));
    // A matching skipHash stores nothing.
    let skipped = call(host, "storeMediaFile", json!({ "filename": "x.txt", "data": "aGVsbG8=", "skipHash": "5d41402abc4b2a76b9719d911017c592" }));
    assert_eq!(skipped, Value::Null);
    // Replacing keeps the name.
    assert_eq!(call(host, "storeMediaFile", json!({ "filename": "_hello.txt", "data": "Ynll" })), "_hello.txt");
    assert_eq!(call(host, "retrieveMediaFile", json!({ "filename": "_hello.txt" })), "Ynll");
    assert_eq!(error(host, "storeMediaFile", json!({ "filename": "a.txt" })), r#"You must provide a "data", "path", or "url" field."#);

    // Media lists inside a note are stored and referenced in the fields.
    let mut note = basic("音", "sound");
    note["audio"] = json!([{ "data": "aGVsbG8=", "filename": "voice.mp3", "fields": ["Back"] }]);
    note["picture"] = json!({ "data": "aGVsbG8=", "filename": "pic.jpg", "fields": ["Front"] });
    let id = call(host, "addNote", json!({ "note": note }));
    let fields = call(host, "notesInfo", json!({ "notes": [id] }))[0]["fields"].clone();
    assert_eq!(fields["Back"]["value"], "sound[sound:voice.mp3]");
    assert_eq!(fields["Front"]["value"], r#"音<img src="pic.jpg">"#);
}

#[test]
fn gui_actions_notify_the_interface() {
    let f = fixture("gui");
    let host = &*f.host;
    assert_eq!(call(host, "guiBrowse", json!({ "query": "deck:Default" })), json!([]));
    let mut note = basic("a", "b");
    note["fields"] = json!({ "Back": "b", "Front": "a", "Nope": "x" });
    call(host, "guiAddCards", json!({ "note": note }));
    call(host, "sync", json!({}));
    let id = call(host, "addNote", json!({ "note": basic("edit me", "") }));
    call(host, "guiEditNote", json!({ "note": id }));
    assert_eq!(error(host, "guiEditNote", json!({ "note": 42 })), "note was not found: 42");
    let basic_id = call(host, "modelNamesAndIds", json!({}))["Basic"].as_i64().unwrap();
    let events = f.host.events.lock().unwrap();
    assert!(events.contains(&Event::Browse("deck:Default".into())));
    // Add opens with the fields in the note type's order.
    assert!(events.contains(&Event::AddCards(AddPrefill { notetype_id: basic_id, deck_id: 1, fields: vec!["a".into(), "b".into()], tags: vec!["yomitan".into()] })));
    assert!(events.contains(&Event::Sync));
    assert!(events.contains(&Event::Browse(format!("nid:{id}"))));
}

/// One raw HTTP/1.1 exchange, as a browser extension or script would make it.
fn exchange(port: u16, request: &str) -> String {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut out = String::new();
    stream.read_to_string(&mut out).unwrap();
    out
}

#[test]
fn serves_over_a_real_socket_and_downloads_urls() {
    let f = fixture("socket");
    let running = server::start(f.host.clone(), 0).unwrap();
    let port = running.port;
    let body = r#"{"action":"deckNames","version":6}"#;
    let reply = exchange(
        port,
        &format!("POST / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: moz-extension://abc\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()),
    );
    assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
    assert!(reply.to_ascii_lowercase().contains("access-control-allow-origin: moz-extension://abc"), "{reply}");
    assert!(reply.ends_with(r#"{"error":null,"result":["Default"]}"#), "{reply}");

    let preflight = exchange(port, &format!("OPTIONS / HTTP/1.1\r\nHost: localhost:{port}\r\nOrigin: https://evil.example\r\nAccess-Control-Request-Method: POST\r\nConnection: close\r\n\r\n"));
    assert!(preflight.to_ascii_lowercase().contains("access-control-allow-origin: http://localhost"), "{preflight}");

    // A one-shot file server for storeMediaFile's url.
    let files = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let files_port = files.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let (mut stream, _) = files.accept().unwrap();
        let mut buffer = [0u8; 1024];
        let _ = stream.read(&mut buffer);
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello");
    });
    let body = json!({ "action": "storeMediaFile", "version": 6, "params": { "filename": "from-url.txt", "url": format!("http://127.0.0.1:{files_port}/a.txt") } }).to_string();
    let reply = exchange(port, &format!("POST / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()));
    assert!(reply.ends_with(r#"{"error":null,"result":"from-url.txt"}"#), "{reply}");
    assert_eq!(std::fs::read(f.dir.join("collection.media/from-url.txt")).unwrap(), b"hello");

    drop(running);
}

#[test]
fn only_web_and_extension_origins_are_asked_about() {
    let mut f = fixture("prompt-origins");
    Arc::get_mut(&mut f.host).unwrap().grant = true;
    let host = &*f.host;
    for origin in ["null", "file://", "data:text/html,hi", "ftp://site.example"] {
        let (_, body) = post(host, Some(origin), json!({ "action": "requestPermission", "version": 6 }));
        assert_eq!(body["result"], json!({ "permission": "denied" }), "{origin}");
    }
    assert!(f.host.asked.lock().unwrap().is_empty(), "the person was never asked");
    assert_eq!(f.host.config().origins, Config::default().origins, "nothing was granted");
    let (_, body) = post(host, Some("moz-extension://abc"), json!({ "action": "requestPermission", "version": 6 }));
    assert_eq!(body["result"]["permission"], "granted");
}

#[test]
fn web_pages_cannot_read_local_files_or_reach_the_local_network() {
    let f = fixture("browser-media");
    let host = &*f.host;
    let extension = Some("chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn");
    let secret = f.dir.join("secret.txt");
    std::fs::write(&secret, b"secret").unwrap();
    let store = |source: Value| {
        let mut params = json!({ "filename": "x.txt" });
        params.as_object_mut().unwrap().extend(source.as_object().unwrap().clone());
        post(host, extension, json!({ "action": "storeMediaFile", "version": 6, "params": params })).1
    };
    let reply = store(json!({ "path": secret }));
    assert!(reply["error"].as_str().unwrap().contains("program on this computer"), "{reply}");
    for url in ["http://127.0.0.1:1/a", "http://localhost:1/a", "http://[::1]:1/a", "http://192.168.0.1/a", "http://169.254.169.254/latest/meta-data"] {
        let reply = store(json!({ "url": url }));
        assert!(reply["error"].as_str().unwrap().contains("cannot download from"), "{url}: {reply}");
    }
    // The same lists inside a note carry the refusal into the field.
    let mut note = basic("path", "x");
    note["audio"] = json!([{ "path": secret, "filename": "s.mp3", "fields": ["Back"] }]);
    let (_, reply) = post(host, extension, json!({ "action": "addNote", "version": 6, "params": { "note": note } }));
    let id = reply["result"].clone();
    let back = call(host, "notesInfo", json!({ "notes": [id] }))[0]["fields"]["Back"]["value"].clone();
    assert!(!back.as_str().unwrap().contains("[sound:"), "{back}");
    assert!(std::fs::read_dir(f.dir.join("collection.media")).unwrap().next().is_none(), "nothing was stored");
    // A local program keeps both.
    assert_eq!(call(host, "storeMediaFile", json!({ "filename": "local.txt", "path": secret })), "local.txt");
}

#[test]
fn replacing_a_file_replaces_the_name_the_core_stored() {
    let f = fixture("replace");
    let host = &*f.host;
    let media = f.dir.join("collection.media");
    // The core stores the name in lower case.
    assert_eq!(call(host, "storeMediaFile", json!({ "filename": "Word.MP3", "data": "aGVsbG8=" })), "word.mp3");
    assert_eq!(call(host, "storeMediaFile", json!({ "filename": "Word.MP3", "data": "Ynll" })), "word.mp3");
    assert_eq!(std::fs::read(media.join("word.mp3")).unwrap(), b"bye");
    let names: Vec<String> = serde_json::from_value(call(host, "getMediaFilesNames", json!({}))).unwrap();
    assert_eq!(names, vec!["word.mp3"]);
    // Without deleteExisting the new file gets its own name.
    let kept = call(host, "storeMediaFile", json!({ "filename": "Word.MP3", "data": "aGVsbG8=", "deleteExisting": false }));
    assert_ne!(kept, "word.mp3");
    assert_eq!(std::fs::read(media.join("word.mp3")).unwrap(), b"bye");
}

#[test]
fn api_reflect_lists_the_supported_actions() {
    let f = fixture("reflect");
    let host = &*f.host;
    let reflect = call(host, "apiReflect", json!({ "scopes": ["actions"], "actions": ["addNote", "guiEditNote", "suspend", "exportPackage", 3] }));
    assert_eq!(reflect, json!({ "scopes": ["actions"], "actions": ["addNote", "guiEditNote", "suspend"] }));
    let all = call(host, "apiReflect", json!({ "scopes": ["actions"] }));
    assert_eq!(all["actions"].as_array().unwrap().len(), ACTIONS.len());
    assert_eq!(call(host, "apiReflect", json!({ "scopes": [] })), json!({ "scopes": [] }));
    assert_eq!(error(host, "apiReflect", json!({})), "scopes has invalid value");
    assert_eq!(error(host, "apiReflect", json!({ "scopes": ["actions"], "actions": "addNote" })), "actions has invalid value");
    // Every listed action is one the server answers.
    for action in ACTIONS {
        let (_, reply) = post(host, None, json!({ "action": action, "version": 6, "params": {} }));
        assert_ne!(reply["error"], "unsupported action", "{action}");
    }
}

#[test]
fn suspends_and_unsuspends_cards() {
    let f = fixture("suspend");
    let host = &*f.host;
    call(host, "addNote", json!({ "note": basic("一", "one") }));
    call(host, "addNote", json!({ "note": basic("二", "two") }));
    let cards: Vec<i64> = serde_json::from_value(call(host, "findCards", json!({ "query": "deck:Default" }))).unwrap();
    let (a, b) = (cards[0], cards[1]);
    assert_eq!(call(host, "areSuspended", json!({ "cards": [a, b, 42] })), json!([false, false, null]));
    assert_eq!(call(host, "suspend", json!({ "cards": [a] })), json!(true));
    assert_eq!(call(host, "areSuspended", json!({ "cards": [a, b] })), json!([true, false]));
    assert_eq!(call(host, "findCards", json!({ "query": "is:suspended" })), json!([a]));
    assert_eq!(call(host, "suspend", json!({ "cards": [a] })), json!(false), "already suspended");
    assert_eq!(call(host, "unsuspend", json!({ "cards": [a, b] })), json!(true));
    assert_eq!(call(host, "areSuspended", json!({ "cards": [a, b] })), json!([false, false]));
    assert_eq!(call(host, "unsuspend", json!({ "cards": [a] })), json!(false));
    assert_eq!(error(host, "suspend", json!({ "cards": [42] })), "Card was not found: 42");
    assert!(f.host.events.lock().unwrap().iter().any(|e| matches!(e, Event::Changed(c) if c.card)));
}

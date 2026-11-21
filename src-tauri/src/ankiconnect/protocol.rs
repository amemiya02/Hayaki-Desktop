// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! AnkiConnect's wire protocol, independent of the socket: one HTTP request in,
//! one reply out. A request body is `{action, version, params, key}`; the reply
//! is `{result, error}` from version 5 on, and the bare result before that.

use serde_json::json;
use serde_json::Map;
use serde_json::Value;

use super::access;
use super::actions;
use super::calls::Col;
use super::config::Config;
use super::config::LOCALHOST;
use super::media::Requester;

pub const API_VERSION: i64 = 6;

/// Something the interface should do or know after an action.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The collection changed; the interface refreshes as after its own edits.
    Changed(anki_proto::collection::OpChanges),
    Browse(String),
    /// Open Add with this Note filled in.
    AddCards(AddPrefill),
    Sync,
}

/// What guiAddCards fills in: the fields in the note type's order.
#[derive(Debug, Clone, PartialEq)]
pub struct AddPrefill {
    pub notetype_id: i64,
    pub deck_id: i64,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

/// What the protocol needs from the app.
pub trait Host: Send + Sync {
    /// The open collection, or None when no profile is open.
    fn collection(&self) -> Option<Col<'_>>;
    fn config(&self) -> Config;
    fn notify(&self, event: Event);
    /// Asks the person whether `origin` may connect. On yes the origin is
    /// added to the allowed list. Blocks until they answer.
    fn ask_permission(&self, origin: &str) -> bool;
}

/// Where a request came from, for `requestPermission` and the media sources.
#[derive(Clone, Copy)]
pub struct Caller<'a> {
    pub origin: Option<&'a str>,
    pub allowed: bool,
}

impl Caller<'_> {
    /// Browsers always send an Origin header on these requests; a program
    /// on this computer does not.
    pub fn requester(&self) -> Requester {
        if self.origin.is_some() { Requester::Browser } else { Requester::Local }
    }
}

pub struct HttpRequest<'a> {
    pub method: &'a str,
    pub origin: Option<&'a str>,
    pub host: Option<&'a str>,
    /// `Access-Control-Request-Private-Network: true` on a preflight.
    pub private_network: bool,
    pub body: &'a [u8],
}

#[derive(Debug)]
pub struct HttpReply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

fn reply(status: u16, allow_origin: String, body: Vec<u8>) -> HttpReply {
    HttpReply {
        status,
        headers: vec![
            ("Content-Type", "application/json".into()),
            ("Access-Control-Allow-Origin", allow_origin),
            ("Access-Control-Allow-Headers", "*".into()),
            ("Access-Control-Allow-Methods", "POST, GET, OPTIONS".into()),
            ("Vary", "Origin".into()),
        ],
        body,
    }
}

fn error_body(message: &str) -> Vec<u8> {
    json!({ "result": null, "error": message }).to_string().into_bytes()
}

pub fn respond(host: &dyn Host, request: &HttpRequest) -> HttpReply {
    if !access::host_allowed(request.host) {
        return reply(403, LOCALHOST.into(), error_body("Host not allowed"));
    }
    let config = host.config();
    let cors = access::decide(&config.origins, request.origin);

    if request.method.eq_ignore_ascii_case("OPTIONS") {
        let mut out = reply(200, cors.allow_origin, Vec::new());
        if request.private_network {
            // Lets a listed public origin pass the browser's private network check.
            out.headers.push(("Access-Control-Allow-Private-Network", "true".into()));
        }
        return out;
    }

    if request.body.iter().all(u8::is_ascii_whitespace) {
        return reply(200, cors.allow_origin, format!("AnkiConnect v.{API_VERSION}").into_bytes());
    }
    let Ok(value) = serde_json::from_slice::<Value>(request.body) else {
        return reply(200, cors.allow_origin, b"null".to_vec());
    };

    let asks_permission = value.get("action").and_then(Value::as_str) == Some("requestPermission");
    if !cors.allowed && !asks_permission {
        return reply(403, cors.allow_origin, error_body("Origin not allowed"));
    }
    // A page asking for permission must be able to read the answer.
    let allow_origin = match (cors.allowed, request.origin) {
        (false, Some(origin)) => origin.to_string(),
        _ => cors.allow_origin,
    };
    let caller = Caller { origin: request.origin, allowed: cors.allowed };
    let result = handle(host, &config, &value, caller);
    reply(200, allow_origin, result.to_string().into_bytes())
}

/// One request envelope, as AnkiConnect's `handler`.
pub fn handle(host: &dyn Host, config: &Config, request: &Value, caller: Caller) -> Value {
    let empty = Map::new();
    let action = request.get("action").and_then(Value::as_str).unwrap_or("");
    let version = request.get("version").and_then(Value::as_i64).unwrap_or(4);
    let params = request.get("params").and_then(Value::as_object).unwrap_or(&empty);
    let key = request.get("key").and_then(Value::as_str);

    let result = if !access::key_ok(config.api_key(), key, action) {
        Err("valid api key must be provided".to_string())
    } else if action == "multi" {
        multi(host, config, params, key, caller)
    } else {
        actions::run(host, config, action, params, caller)
    };

    match result {
        Ok(value) if version <= 4 => value,
        Ok(value) => json!({ "result": value, "error": null }),
        Err(error) => json!({ "result": null, "error": error }),
    }
}

/// Runs each inner request in turn. An inner request without a key carries
/// the outer one, which has already been checked.
fn multi(host: &dyn Host, config: &Config, params: &Map<String, Value>, key: Option<&str>, caller: Caller) -> Result<Value, String> {
    let actions = params
        .get("actions")
        .ok_or("multi() missing 1 required positional argument: 'actions'")?
        .as_array()
        .ok_or("multi(): 'actions' must be a list")?;
    Ok(Value::Array(
        actions
            .iter()
            .map(|inner| {
                let mut inner = inner.clone();
                if let (Some(object), Some(key)) = (inner.as_object_mut(), key) {
                    object.entry("key").or_insert_with(|| key.into());
                }
                handle(host, config, &inner, caller)
            })
            .collect(),
    ))
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! AnkiConnect's actions, with its names, parameters, results and error
//! strings, run against the open collection through the core.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;

use anki::text::strip_html_preserving_media_filenames;
use anki_proto::card_rendering::rendered_template_node;
use anki_proto::card_rendering::ExtractAvTagsRequest;
use anki_proto::card_rendering::RenderExistingCardRequest;
use anki_proto::card_rendering::RenderedTemplateNode;
use anki_proto::cards::CardId;
use anki_proto::cards::CardIds;
use anki_proto::collection::OpChanges;
use anki_proto::decks::DeckId;
use anki_proto::decks::GetDeckNamesRequest;
use anki_proto::generic;
use anki_proto::notes;
use anki_proto::notes::note_fields_check_response::State as FieldsState;
use anki_proto::notetypes::Notetype;
use anki_proto::notetypes::NotetypeId;
use anki_proto::scheduler::bury_or_suspend_cards_request::Mode as BuryOrSuspendMode;
use anki_proto::scheduler::BuryOrSuspendCardsRequest;
use anki_proto::search::sort_order;
use anki_proto::search::SearchRequest;
use anki_proto::search::SortOrder;
use anki_proto::tags::NoteIdsAndTagsRequest;
use serde::de::DeserializeOwned;
use serde_json::json;
use serde_json::Map;
use serde_json::Value;
use sha1::Digest;
use sha1::Sha1;

use super::access;
use super::calls;
use super::calls::Col;
use super::config::Config;
use super::media;
use super::media::Requester;
use super::protocol::AddPrefill;
use super::protocol::Caller;
use super::protocol::Event;
use super::protocol::Host;
use super::protocol::API_VERSION;

type Res = Result<Value, String>;

/// An action's parameters, with Python's messages for a missing argument.
struct Params<'a> {
    action: &'a str,
    map: &'a Map<String, Value>,
}

impl Params<'_> {
    fn get<T: DeserializeOwned>(&self, name: &str) -> Result<T, String> {
        match self.map.get(name) {
            None => Err(format!("{}() missing 1 required positional argument: '{name}'", self.action)),
            Some(value) => serde_json::from_value(value.clone()).map_err(|err| format!("{}(): invalid '{name}': {err}", self.action)),
        }
    }

    fn opt<T: DeserializeOwned>(&self, name: &str) -> Result<Option<T>, String> {
        match self.map.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(_) => self.get(name).map(Some),
        }
    }
}

fn col(host: &dyn Host) -> Result<Col<'_>, String> {
    host.collection().ok_or_else(|| "collection is not available".to_string())
}

/// Every action [`run`] (and `multi` in the protocol) answers, as apiReflect lists them.
pub const ACTIONS: &[&str] = &[
    "addNote", "addNotes", "addTags", "apiReflect", "areSuspended", "canAddNotes", "canAddNotesWithErrorDetail", "cardsInfo",
    "deckNames", "deckNamesAndIds", "deleteMediaFile", "findCards", "findNotes", "getMediaDirPath", "getMediaFilesNames",
    "getTags", "guiAddCards", "guiBrowse", "guiEditNote", "modelFieldNames", "modelFieldsOnTemplates", "modelNames",
    "modelNamesAndIds", "multi", "notesInfo", "removeTags", "requestPermission", "retrieveMediaFile", "storeMediaFile",
    "suspend", "sync", "unsuspend", "updateNote", "updateNoteFields", "updateNoteTags", "version",
];

/// Media in a request is read before the collection is taken, so a slow
/// download never holds up a profile switch or quitting.
pub fn run(host: &dyn Host, config: &Config, action: &str, params: &Map<String, Value>, caller: Caller) -> Res {
    let p = Params { action, map: params };
    let requester = caller.requester();
    match action {
        "version" => Ok(json!(API_VERSION)),
        "apiReflect" => api_reflect(params),
        "requestPermission" => Ok(request_permission(host, config, caller)),
        "deckNames" => Ok(json!(deck_names(&col(host)?)?.into_iter().map(|(name, _)| name).collect::<Vec<_>>())),
        "deckNamesAndIds" => Ok(json!(deck_names(&col(host)?)?.into_iter().collect::<BTreeMap<_, _>>())),
        "modelNames" => Ok(json!(model_names(&col(host)?)?.into_iter().map(|(name, _)| name).collect::<Vec<_>>())),
        "modelNamesAndIds" => Ok(json!(model_names(&col(host)?)?.into_iter().collect::<BTreeMap<_, _>>())),
        "modelFieldNames" => {
            let notetype = model(&col(host)?, &p.get::<String>("modelName")?)?;
            Ok(json!(notetype.fields.iter().map(|f| &f.name).collect::<Vec<_>>()))
        }
        "modelFieldsOnTemplates" => Ok(fields_on_templates(&model(&col(host)?, &p.get::<String>("modelName")?)?)),
        "findNotes" => find(&col(host)?, calls::SEARCH_NOTES, p.opt("query")?),
        "findCards" => find(&col(host)?, calls::SEARCH_CARDS, p.opt("query")?),
        "notesInfo" => notes_info(&col(host)?, p.opt("notes")?, p.opt("query")?),
        "cardsInfo" => cards_info(&col(host)?, p.get("cards")?),
        "canAddNotes" => {
            let col = col(host)?;
            let notes: Vec<Value> = p.get("notes")?;
            Ok(json!(notes.iter().map(|n| create_note(&col, n).is_ok()).collect::<Vec<_>>()))
        }
        "canAddNotesWithErrorDetail" => {
            let col = col(host)?;
            let notes: Vec<Value> = p.get("notes")?;
            Ok(Value::Array(
                notes
                    .iter()
                    .map(|n| match create_note(&col, n) {
                        Ok(_) => json!({ "canAdd": true }),
                        Err(error) => json!({ "canAdd": false, "error": error }),
                    })
                    .collect(),
            ))
        }
        "addNote" => {
            let note: Value = p.get("note")?;
            let media = note_media(&note, requester);
            add_note(host, &col(host)?, &note, media).map(|id| json!(id))
        }
        // As upstream's master: each note is added on its own, and one that
        // cannot be added is null in the result (Yomitan reads (number|null)[]).
        "addNotes" => {
            let notes: Vec<Value> = p.get("notes")?;
            let media: Vec<_> = notes.iter().map(|note| note_media(note, requester)).collect();
            let col = col(host)?;
            Ok(json!(notes.iter().zip(media).map(|(note, media)| add_note(host, &col, note, media).ok()).collect::<Vec<_>>()))
        }
        "updateNoteFields" | "updateNote" => {
            let note: Value = p.get("note")?;
            let media = note_media(&note, requester);
            update_note(host, &col(host)?, &note, media, action == "updateNoteFields", false)
        }
        "updateNoteTags" => {
            let note = json!({ "id": p.get::<i64>("note")?, "tags": p.get::<Value>("tags")? });
            update_note(host, &col(host)?, &note, Vec::new(), false, true)
        }
        "suspend" | "unsuspend" => suspend(host, &col(host)?, p.get("cards")?, action == "suspend"),
        "areSuspended" => {
            let col = col(host)?;
            let cards: Vec<i64> = p.get("cards")?;
            Ok(json!(cards.into_iter().map(|id| suspended(&col, id).ok()).collect::<Vec<_>>()))
        }
        "addTags" | "removeTags" => {
            let col = col(host)?;
            let request = NoteIdsAndTagsRequest { note_ids: p.get("notes")?, tags: p.get("tags")? };
            let method = if action == "addTags" { calls::ADD_NOTE_TAGS } else { calls::REMOVE_NOTE_TAGS };
            let out = col.call(method, request)?;
            changed(host, out.changes);
            Ok(Value::Null)
        }
        "getTags" => Ok(json!(col(host)?.call(calls::ALL_TAGS, generic::Empty {})?.vals)),
        "storeMediaFile" => {
            let filename: String = p.get("filename")?;
            let (data, path, url) = (p.opt::<String>("data")?, p.opt::<String>("path")?, p.opt::<String>("url")?);
            let bytes = media::Source { data: data.as_deref(), path: path.as_deref(), url: url.as_deref() }.read(requester)?;
            let skip_hash = p.opt::<String>("skipHash")?;
            let delete_existing = p.opt::<bool>("deleteExisting")?.unwrap_or(true);
            Ok(json!(media::store(&col(host)?, &filename, bytes, skip_hash.as_deref(), delete_existing)?))
        }
        "retrieveMediaFile" => {
            let col = col(host)?;
            Ok(media::retrieve(&col.media_folder, &p.get::<String>("filename")?).map_or(json!(false), Value::String))
        }
        "getMediaFilesNames" => {
            let col = col(host)?;
            let pattern = p.opt::<String>("pattern")?.unwrap_or_else(|| "*".into());
            Ok(json!(media::names(&col.media_folder, &pattern)))
        }
        "deleteMediaFile" => {
            media::delete(&col(host)?, &p.get::<String>("filename")?)?;
            Ok(Value::Null)
        }
        "getMediaDirPath" => Ok(json!(col(host)?.media_folder.to_string_lossy())),
        "guiBrowse" => {
            let col = col(host)?;
            let query: Option<String> = p.opt("query")?;
            host.notify(Event::Browse(query.clone().unwrap_or_default()));
            match query {
                Some(query) => find(&col, calls::SEARCH_CARDS, Some(query)),
                None => Ok(json!([])),
            }
        }
        // Browse with the Note found stands in for Anki's Edit window.
        "guiEditNote" => {
            let col = col(host)?;
            let id: i64 = p.get("note")?;
            let _ = col.call(calls::GET_NOTE, notes::NoteId { nid: id }).map_err(|_| format!("note was not found: {id}"))?;
            host.notify(Event::Browse(format!("nid:{id}")));
            Ok(Value::Null)
        }
        "guiAddCards" => {
            let col = col(host)?;
            let note: Value = p.get("note")?;
            let notetype = model(&col, &key_str(&note, "modelName")?)?;
            let deck_id = deck_id(&col, &key_str(&note, "deckName")?)?;
            let given = note.get("fields").and_then(Value::as_object);
            let fields = notetype.fields.iter().map(|f| given.and_then(|g| g.get(&f.name)).map(text).unwrap_or_default()).collect();
            let tags = note.get("tags").and_then(Value::as_array).map(|t| t.iter().map(text).collect()).unwrap_or_default();
            host.notify(Event::AddCards(AddPrefill { notetype_id: notetype.id, deck_id, fields, tags }));
            Ok(Value::Null)
        }
        "sync" => {
            col(host)?;
            host.notify(Event::Sync);
            Ok(Value::Null)
        }
        _ => Err("unsupported action".into()),
    }
}

fn request_permission(host: &dyn Host, config: &Config, caller: Caller) -> Value {
    let granted = || json!({ "permission": "granted", "requireApikey": config.api_key().is_some(), "version": API_VERSION });
    match caller.origin {
        _ if caller.allowed => granted(),
        Some(origin) if access::promptable(origin) && host.ask_permission(origin) => granted(),
        _ => json!({ "permission": "denied" }),
    }
}

/// apiReflect: with the `actions` scope, which of `actions` (all when null)
/// this server supports.
fn api_reflect(params: &Map<String, Value>) -> Res {
    let Some(Value::Array(scopes)) = params.get("scopes") else { return Err("scopes has invalid value".into()) };
    let asked = match params.get("actions") {
        None | Some(Value::Null) => None,
        Some(Value::Array(list)) => Some(list),
        Some(_) => return Err("actions has invalid value".into()),
    };
    if !scopes.iter().any(|scope| scope == "actions") {
        return Ok(json!({ "scopes": [] }));
    }
    let actions: Vec<&str> = match asked {
        None => ACTIONS.to_vec(),
        Some(list) => list.iter().filter_map(Value::as_str).filter(|name| ACTIONS.contains(name)).collect(),
    };
    Ok(json!({ "scopes": ["actions"], "actions": actions }))
}

fn suspended(col: &Col, id: i64) -> Result<bool, String> {
    let card = col.call(calls::GET_CARD, CardId { cid: id }).map_err(|_| format!("Card was not found: {id}"))?;
    // Queue -1 is suspended, as in the core's CardQueue.
    Ok(card.queue == -1)
}

/// suspend and unsuspend: false when every card is already in that state.
fn suspend(host: &dyn Host, col: &Col, cards: Vec<i64>, suspend: bool) -> Res {
    let mut todo = Vec::new();
    for id in cards {
        if suspended(col, id)? != suspend {
            todo.push(id);
        }
    }
    if todo.is_empty() {
        return Ok(json!(false));
    }
    let changes = if suspend {
        let request = BuryOrSuspendCardsRequest { card_ids: todo, note_ids: Vec::new(), mode: BuryOrSuspendMode::Suspend as i32 };
        col.call(calls::BURY_OR_SUSPEND_CARDS, request)?.changes
    } else {
        Some(col.call(calls::RESTORE_BURIED_AND_SUSPENDED_CARDS, CardIds { cids: todo })?)
    };
    changed(host, changes);
    Ok(json!(true))
}

fn changed(host: &dyn Host, changes: Option<OpChanges>) {
    if let Some(changes) = changes {
        host.notify(Event::Changed(changes));
    }
}

/// Python's KeyError message for a missing key in the note object.
fn key_str(note: &Value, key: &str) -> Result<String, String> {
    match note.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(other) => Ok(other.to_string()),
        None => Err(format!("'{key}'")),
    }
}

fn deck_names(col: &Col) -> Result<Vec<(String, i64)>, String> {
    let names = col.call(calls::GET_DECK_NAMES, GetDeckNamesRequest { skip_empty_default: false, include_filtered: true })?;
    Ok(names.entries.into_iter().map(|e| (e.name, e.id)).collect())
}

fn model_names(col: &Col) -> Result<Vec<(String, i64)>, String> {
    let names = col.call(calls::GET_NOTETYPE_NAMES, generic::Empty {})?;
    Ok(names.entries.into_iter().map(|e| (e.name, e.id)).collect())
}

fn find_deck(col: &Col, name: &str) -> Option<i64> {
    col.call(calls::GET_DECK_ID_BY_NAME, generic::String { val: name.into() }).ok().map(|d| d.did).filter(|&id| id != 0)
}

fn deck_id(col: &Col, name: &str) -> Result<i64, String> {
    find_deck(col, name).ok_or_else(|| format!("deck was not found: {name}"))
}

fn model(col: &Col, name: &str) -> Result<Notetype, String> {
    let id = col
        .call(calls::GET_NOTETYPE_ID_BY_NAME, generic::String { val: name.into() })
        .ok()
        .map(|n| n.ntid)
        .filter(|&id| id != 0)
        .ok_or_else(|| format!("model was not found: {name}"))?;
    col.call(calls::GET_NOTETYPE, NotetypeId { ntid: id })
}

fn find(col: &Col, method: calls::Method<SearchRequest, anki_proto::search::SearchResponse>, query: Option<String>) -> Res {
    let Some(query) = query else { return Ok(json!([])) };
    let order = SortOrder { value: Some(sort_order::Value::None(generic::Empty {})) };
    Ok(json!(col.call(method, SearchRequest { search: query, order: Some(order) })?.ids))
}

/// `{{Field}}` references on each side of each template, as AnkiConnect's
/// modelFieldsOnTemplates (after aqt's `_fieldsOnTemplate`).
fn fields_on_templates(notetype: &Notetype) -> Value {
    let mut out = Map::new();
    for template in &notetype.templates {
        let config = template.config.clone().unwrap_or_default();
        let front = references(&config.q_format).into_iter().filter(|f| f != "FrontSide").collect::<Vec<_>>();
        let back = references(&config.a_format)
            .into_iter()
            .filter(|f| f != "FrontSide" && !front.contains(f))
            .collect::<Vec<_>>();
        out.insert(template.name.clone(), json!([front, back]));
    }
    Value::Object(out)
}

/// Matches of `{{[^#/}]+?}}`, braces removed, last `:` part kept.
fn references(template: &str) -> Vec<String> {
    let chars: Vec<char> = template.chars().collect();
    let mut found = Vec::new();
    let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] == '{' && chars[i + 1] == '{' {
            let mut j = i + 2;
            while j < chars.len() && !matches!(chars[j], '#' | '/' | '}') {
                j += 1;
            }
            if j > i + 2 && chars.get(j) == Some(&'}') && chars.get(j + 1) == Some(&'}') {
                let inner: String = chars[i + 2..j].iter().filter(|&&c| c != '{' && c != '}').collect();
                found.push(inner.rsplit(':').next().unwrap_or("").to_string());
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    found
}

struct Cache<'a> {
    col: &'a Col<'a>,
    notetypes: HashMap<i64, Notetype>,
    decks: HashMap<i64, String>,
}

impl<'a> Cache<'a> {
    fn new(col: &'a Col<'a>) -> Self {
        Cache { col, notetypes: HashMap::new(), decks: HashMap::new() }
    }

    fn notetype(&mut self, id: i64) -> Result<&Notetype, String> {
        if !self.notetypes.contains_key(&id) {
            let notetype = self.col.call(calls::GET_NOTETYPE, NotetypeId { ntid: id })?;
            self.notetypes.insert(id, notetype);
        }
        Ok(&self.notetypes[&id])
    }

    fn deck_name(&mut self, id: i64) -> String {
        if !self.decks.contains_key(&id) {
            let name = self.col.call(calls::GET_DECK, DeckId { did: id }).map(|d| d.name).unwrap_or_default();
            self.decks.insert(id, name);
        }
        self.decks[&id].clone()
    }
}

fn field_map(notetype: &Notetype, values: &[String]) -> Value {
    let mut fields = Map::new();
    for (order, field) in notetype.fields.iter().enumerate() {
        let value = values.get(order).cloned().unwrap_or_default();
        fields.insert(field.name.clone(), json!({ "value": value, "order": order }));
    }
    Value::Object(fields)
}

fn notes_info(col: &Col, notes: Option<Vec<i64>>, query: Option<String>) -> Res {
    let ids: Vec<i64> = match (notes, query) {
        (_, Some(query)) => serde_json::from_value(find(col, calls::SEARCH_NOTES, Some(query))?).unwrap_or_default(),
        (Some(notes), None) => notes,
        (None, None) => return Err(r#"Must provide either "notes" or a "query""#.into()),
    };
    let mut cache = Cache::new(col);
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(note_info(&mut cache, id).unwrap_or_else(|_| json!({})));
    }
    Ok(Value::Array(out))
}

fn note_info(cache: &mut Cache, id: i64) -> Res {
    let col = cache.col;
    let note = col.call(calls::GET_NOTE, notes::NoteId { nid: id })?;
    let cards = col.call(calls::CARDS_OF_NOTE, notes::NoteId { nid: id })?.cids;
    let notetype = cache.notetype(note.notetype_id)?;
    Ok(json!({
        "noteId": note.id,
        "profile": col.profile,
        "modelName": notetype.name,
        "tags": note.tags,
        "fields": field_map(notetype, &note.fields),
        "mod": note.mtime_secs,
        "cards": cards,
    }))
}

fn cards_info(col: &Col, ids: Vec<i64>) -> Res {
    let mut cache = Cache::new(col);
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(card_info(&mut cache, id).unwrap_or_else(|_| json!({})));
    }
    Ok(Value::Array(out))
}

fn rendered(nodes: &[RenderedTemplateNode]) -> String {
    nodes
        .iter()
        .filter_map(|node| match &node.value {
            Some(rendered_template_node::Value::Text(text)) => Some(text.as_str()),
            Some(rendered_template_node::Value::Replacement(r)) => Some(r.current_text.as_str()),
            None => None,
        })
        .collect()
}

fn card_info(cache: &mut Cache, id: i64) -> Res {
    let col = cache.col;
    let card = col.call(calls::GET_CARD, CardId { cid: id })?;
    let note = col.call(calls::GET_NOTE, notes::NoteId { nid: card.note_id })?;
    let render = col.call(calls::RENDER_EXISTING_CARD, RenderExistingCardRequest { card_id: id, browser: false, partial_render: false })?;
    // As Card.question() and Card.answer(): sounds become play tags, the style leads.
    let side = |nodes: &[RenderedTemplateNode], question_side: bool| -> Result<String, String> {
        let text = col.call(calls::EXTRACT_AV_TAGS, ExtractAvTagsRequest { text: rendered(nodes), question_side })?.text;
        Ok(format!("<style>{}</style>{text}", render.css))
    };
    let question = side(&render.question_nodes, true)?;
    let answer = side(&render.answer_nodes, false)?;
    let next_reviews = col
        .call(calls::GET_SCHEDULING_STATES, CardId { cid: id })
        .and_then(|states| col.call(calls::DESCRIBE_NEXT_STATES, states))
        .map(|list| list.vals)
        .unwrap_or_default();
    let deck_name = cache.deck_name(card.deck_id);
    let notetype = cache.notetype(note.notetype_id)?;
    Ok(json!({
        "cardId": card.id,
        "fields": field_map(notetype, &note.fields),
        "fieldOrder": card.template_idx,
        "question": question,
        "answer": answer,
        "modelName": notetype.name,
        "ord": card.template_idx,
        "deckName": deck_name,
        "css": notetype.config.as_ref().map(|c| c.css.as_str()).unwrap_or_default(),
        "factor": card.ease_factor,
        "interval": card.interval,
        "note": card.note_id,
        "type": card.ctype,
        "queue": card.queue,
        "due": card.due,
        "reps": card.reps,
        "lapses": card.lapses,
        "left": card.remaining_steps,
        "mod": card.mtime_secs,
        "nextReviews": next_reviews,
        "flags": card.flags,
    }))
}

/// A note ready to add, as AnkiConnect's createNote: fields matched to the
/// note type by name ignoring case, then the empty and duplicate checks.
struct NewNote {
    note: notes::Note,
    notetype: Notetype,
    deck_id: i64,
}

#[derive(Default)]
struct DuplicateOptions {
    allow: bool,
    scope_deck: bool,
    deck_name: Option<String>,
    check_children: bool,
    check_all_models: bool,
}

fn bool_option(object: &Value, key: &str, label: &str) -> Result<Option<bool>, String> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(format!(r#"option parameter "{label}" must be boolean"#)),
    }
}

fn duplicate_options(note: &Value) -> Result<DuplicateOptions, String> {
    let mut out = DuplicateOptions::default();
    let Some(options) = note.get("options") else { return Ok(out) };
    out.allow = bool_option(options, "allowDuplicate", "allowDuplicate")?.unwrap_or(false);
    out.scope_deck = options.get("duplicateScope").and_then(Value::as_str) == Some("deck");
    if let Some(scope) = options.get("duplicateScopeOptions") {
        out.deck_name = scope.get("deckName").and_then(Value::as_str).map(str::to_string);
        out.check_children = bool_option(scope, "checkChildren", "duplicateScopeOptions.checkChildren")?.unwrap_or(false);
        out.check_all_models = bool_option(scope, "checkAllModels", "duplicateScopeOptions.checkAllModels")?.unwrap_or(false);
    }
    Ok(out)
}

fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn create_note(col: &Col, input: &Value) -> Result<NewNote, String> {
    let notetype = model(col, &key_str(input, "modelName")?)?;
    let deck_id = deck_id(col, &key_str(input, "deckName")?)?;
    let mut note = col.call(calls::NEW_NOTE, NotetypeId { ntid: notetype.id })?;
    if let Some(tags) = input.get("tags").and_then(Value::as_array) {
        note.tags = tags.iter().map(text).collect();
    }
    if let Some(fields) = input.get("fields").and_then(Value::as_object) {
        for (name, value) in fields {
            if let Some(index) = notetype.fields.iter().position(|f| f.name.to_lowercase() == name.to_lowercase()) {
                note.fields[index] = text(value);
            }
        }
    }
    let options = duplicate_options(input)?;
    match duplicate_or_empty(col, &note, deck_id, &options)? {
        0 => {}
        1 => return Err("cannot create note because it is empty".into()),
        2 if options.allow => {}
        2 => return Err("cannot create note because it is a duplicate".into()),
        _ => return Err("cannot create note for unknown reason".into()),
    }
    Ok(NewNote { note, notetype, deck_id })
}

/// 1 when the first field is empty, 2 when it is a duplicate within the
/// scope, otherwise 0 (or the core's other field-check states).
fn duplicate_or_empty(col: &Col, note: &notes::Note, deck_id: i64, options: &DuplicateOptions) -> Result<i32, String> {
    if !options.scope_deck && !options.check_all_models {
        return Ok(col.call(calls::NOTE_FIELDS_CHECK, note.clone())?.state);
    }
    let first = note.fields.first().map(String::as_str).unwrap_or("");
    if first.trim().is_empty() {
        return Ok(FieldsState::Empty as i32);
    }
    let digest = Sha1::digest(strip_html_preserving_media_filenames(first).as_bytes());
    let checksum = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);

    let decks: Option<HashSet<i64>> = if options.scope_deck {
        let did = match &options.deck_name {
            Some(name) => match find_deck(col, name) {
                Some(id) => id,
                // A deck that does not exist holds no duplicates.
                None => return Ok(FieldsState::Normal as i32),
            },
            None => deck_id,
        };
        let mut ids = HashSet::from([did]);
        if options.check_children {
            ids.extend(col.call(calls::GET_DECK_AND_CHILD_NAMES, DeckId { did })?.entries.into_iter().map(|e| e.id));
        }
        Some(ids)
    } else {
        None
    };

    let mut sql = "select id from notes where csum=?".to_string();
    let mut args = vec![json!(checksum)];
    if note.id != 0 {
        sql.push_str(" and id!=?");
        args.push(json!(note.id));
    }
    if !options.check_all_models {
        sql.push_str(" and mid=?");
        args.push(json!(note.notetype_id));
    }
    for row in col.query(&sql, args)? {
        let Some(nid) = row.first().and_then(Value::as_i64) else { continue };
        let Some(decks) = &decks else { return Ok(FieldsState::Duplicate as i32) };
        for card in col.query("select did from cards where nid=?", vec![json!(nid)])? {
            if card.first().and_then(Value::as_i64).is_some_and(|did| decks.contains(&did)) {
                return Ok(FieldsState::Duplicate as i32);
            }
        }
    }
    Ok(FieldsState::Normal as i32)
}

/// One entry of a note's `audio`, `video` or `picture` list, its bytes read.
struct NoteMedia {
    fields: Vec<String>,
    picture: bool,
    filename: Option<String>,
    skip_hash: Option<String>,
    delete_existing: bool,
    bytes: Result<Vec<u8>, String>,
}

/// Reads the `audio`, `video` and `picture` lists of a note.
fn note_media(input: &Value, requester: Requester) -> Vec<NoteMedia> {
    let mut out = Vec::new();
    for (key, picture) in [("audio", false), ("video", false), ("picture", true)] {
        let entries = match input.get(key) {
            None | Some(Value::Null) => continue,
            Some(Value::Array(list)) => list.clone(),
            Some(single) => vec![single.clone()],
        };
        for entry in entries.iter().filter(|e| e.is_object()) {
            let fields: Vec<String> = match entry.get("fields") {
                Some(Value::Array(list)) => list.iter().map(text).collect(),
                Some(Value::String(one)) => vec![one.clone()],
                _ => continue,
            };
            if fields.is_empty() {
                continue;
            }
            let get = |k: &str| entry.get(k).and_then(Value::as_str);
            out.push(NoteMedia {
                fields,
                picture,
                filename: get("filename").map(str::to_string),
                skip_hash: get("skipHash").map(str::to_string),
                delete_existing: entry.get("deleteExisting").and_then(Value::as_bool).unwrap_or(false),
                bytes: media::Source { data: get("data"), path: get("path"), url: get("url") }.read(requester),
            });
        }
    }
    out
}

/// Stores each file and references it at the end of its fields. A file that
/// fails leaves its error in those fields instead, as AnkiConnect does.
fn attach_media(col: &Col, note: &mut notes::Note, notetype: &Notetype, media: Vec<NoteMedia>) {
    for item in media {
        let stored = item.bytes.and_then(|bytes| {
            let filename = item.filename.as_deref().ok_or("'filename'")?;
            media::store(col, filename, bytes, item.skip_hash.as_deref(), item.delete_existing)
        });
        let addition = match stored {
            Ok(None) => continue,
            Ok(Some(name)) if item.picture => format!(r#"<img src="{name}">"#),
            Ok(Some(name)) => format!("[sound:{name}]"),
            Err(error) => error.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"),
        };
        for field in &item.fields {
            if let Some(index) = notetype.fields.iter().position(|f| &f.name == field) {
                note.fields[index].push_str(&addition);
            }
        }
    }
}

fn add_note(host: &dyn Host, col: &Col, input: &Value, media: Vec<NoteMedia>) -> Result<i64, String> {
    let NewNote { mut note, notetype, deck_id } = create_note(col, input)?;
    attach_media(col, &mut note, &notetype, media);
    let out = col.call(calls::ADD_NOTE, notes::AddNoteRequest { note: Some(note), deck_id })?;
    let added = out.changes.as_ref().map_or(0, |c| c.count);
    changed(host, out.changes.and_then(|c| c.changes));
    if added < 1 {
        return Err("The field values you have provided would make an empty question on all cards.".into());
    }
    Ok(out.note_id)
}

/// updateNoteFields (fields only), updateNoteTags (tags only) and updateNote
/// (either or both), saved as one undoable change.
fn update_note(host: &dyn Host, col: &Col, input: &Value, media: Vec<NoteMedia>, fields_required: bool, tags_required: bool) -> Res {
    let id = input.get("id").and_then(Value::as_i64).ok_or("'id'")?;
    let mut note = col.call(calls::GET_NOTE, notes::NoteId { nid: id }).map_err(|_| format!("note was not found: {id}"))?;
    let fields = input.get("fields").and_then(Value::as_object);
    let tags = input.get("tags");
    if fields_required && fields.is_none() {
        return Err("'fields'".into());
    }
    if tags_required && tags.is_none() {
        return Err("'tags'".into());
    }
    if fields.is_none() && tags.is_none() {
        return Err(r#"Must provide a "fields" or "tags" property."#.into());
    }
    if let Some(fields) = fields {
        let notetype = col.call(calls::GET_NOTETYPE, NotetypeId { ntid: note.notetype_id })?;
        for (name, value) in fields {
            if let Some(index) = notetype.fields.iter().position(|f| &f.name == name) {
                note.fields[index] = text(value);
            }
        }
        attach_media(col, &mut note, &notetype, media);
    }
    match tags {
        Some(Value::Array(list)) => note.tags = list.iter().map(text).collect(),
        Some(Value::String(one)) => note.tags = vec![one.clone()],
        _ => {}
    }
    let out = col.call(calls::UPDATE_NOTES, notes::UpdateNotesRequest { notes: vec![note], skip_undo_entry: false })?;
    changed(host, Some(out));
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_references_follow_ankiconnect() {
        assert_eq!(references("{{Front}} {{#Tags}}{{Tags}}{{/Tags}} {{furigana:Reading}} {{{Raw}}}"), vec!["Front", "Tags", "Reading", "Raw"]);
        assert_eq!(references("{{FrontSide}}<hr id=answer>{{Back}}"), vec!["FrontSide", "Back"]);
        assert!(references("{{}} {{#x}}").is_empty());
    }
}

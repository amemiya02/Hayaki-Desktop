// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! Typed calls into the open collection.
//!
//! The core's typed service methods are private to the `anki` crate; only the
//! numbered dispatch (`run_service_method`) is public, and the interface uses
//! the same one. Each method here pairs its service and method numbers with
//! its request and response types. A test checks every entry against the
//! core's descriptor set, so an upstream renumbering fails the build's tests
//! instead of calling the wrong method.

use std::marker::PhantomData;
use std::panic::catch_unwind;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;

use anki::backend::Backend;
use anki_proto::backend::BackendError;
use anki_proto::cards;
use anki_proto::card_rendering;
use anki_proto::collection::OpChanges;
use anki_proto::decks;
use anki_proto::generic;
use anki_proto::media;
use anki_proto::notes;
use anki_proto::notetypes;
use anki_proto::scheduler;
use anki_proto::search;
use anki_proto::tags;
use prost::Message;

use crate::profiles::Held;

pub struct Method<I, O> {
    pub service: u32,
    pub method: u32,
    _types: PhantomData<fn(I) -> O>,
}

impl<I, O> Clone for Method<I, O> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<I, O> Copy for Method<I, O> {}

macro_rules! methods {
    ($($konst:ident = $name:literal ($service:literal, $method:literal): $input:ty => $output:ty, $in_name:literal => $out_name:literal;)*) => {
        $(pub const $konst: Method<$input, $output> = Method { service: $service, method: $method, _types: PhantomData };)*
        /// Name, numbers, request type and response type of every method, for the test.
        #[cfg(test)]
        pub const TABLE: &[(&str, u32, u32, &str, &str)] = &[$(($name, $service, $method, $in_name, $out_name),)*];
    };
}

methods! {
    GET_CARD = "GetCard" (5, 0): cards::CardId => cards::Card, "anki.cards.CardId" => "anki.cards.Card";
    GET_DECK_ID_BY_NAME = "GetDeckIdByName" (7, 7): generic::String => decks::DeckId, "anki.generic.String" => "anki.decks.DeckId";
    GET_DECK = "GetDeck" (7, 8): decks::DeckId => decks::Deck, "anki.decks.DeckId" => "anki.decks.Deck";
    GET_DECK_NAMES = "GetDeckNames" (7, 13): decks::GetDeckNamesRequest => decks::DeckNames, "anki.decks.GetDeckNamesRequest" => "anki.decks.DeckNames";
    GET_DECK_AND_CHILD_NAMES = "GetDeckAndChildNames" (7, 14): decks::DeckId => decks::DeckNames, "anki.decks.DeckId" => "anki.decks.DeckNames";
    GET_SCHEDULING_STATES = "GetSchedulingStates" (13, 23): cards::CardId => scheduler::SchedulingStates, "anki.cards.CardId" => "anki.scheduler.SchedulingStates";
    RESTORE_BURIED_AND_SUSPENDED_CARDS = "RestoreBuriedAndSuspendedCards" (13, 12): cards::CardIds => OpChanges, "anki.cards.CardIds" => "anki.collection.OpChanges";
    BURY_OR_SUSPEND_CARDS = "BuryOrSuspendCards" (13, 14): scheduler::BuryOrSuspendCardsRequest => anki_proto::collection::OpChangesWithCount, "anki.scheduler.BuryOrSuspendCardsRequest" => "anki.collection.OpChangesWithCount";
    DESCRIBE_NEXT_STATES = "DescribeNextStates" (13, 24): scheduler::SchedulingStates => generic::StringList, "anki.scheduler.SchedulingStates" => "anki.generic.StringList";
    GET_NOTETYPE = "GetNotetype" (23, 6): notetypes::NotetypeId => notetypes::Notetype, "anki.notetypes.NotetypeId" => "anki.notetypes.Notetype";
    GET_NOTETYPE_NAMES = "GetNotetypeNames" (23, 8): generic::Empty => notetypes::NotetypeNames, "anki.generic.Empty" => "anki.notetypes.NotetypeNames";
    GET_NOTETYPE_ID_BY_NAME = "GetNotetypeIdByName" (23, 10): generic::String => notetypes::NotetypeId, "anki.generic.String" => "anki.notetypes.NotetypeId";
    NEW_NOTE = "NewNote" (25, 0): notetypes::NotetypeId => notes::Note, "anki.notetypes.NotetypeId" => "anki.notes.Note";
    ADD_NOTE = "AddNote" (25, 1): notes::AddNoteRequest => notes::AddNoteResponse, "anki.notes.AddNoteRequest" => "anki.notes.AddNoteResponse";
    UPDATE_NOTES = "UpdateNotes" (25, 5): notes::UpdateNotesRequest => OpChanges, "anki.notes.UpdateNotesRequest" => "anki.collection.OpChanges";
    GET_NOTE = "GetNote" (25, 6): notes::NoteId => notes::Note, "anki.notes.NoteId" => "anki.notes.Note";
    NOTE_FIELDS_CHECK = "NoteFieldsCheck" (25, 11): notes::Note => notes::NoteFieldsCheckResponse, "anki.notes.Note" => "anki.notes.NoteFieldsCheckResponse";
    CARDS_OF_NOTE = "CardsOfNote" (25, 12): notes::NoteId => cards::CardIds, "anki.notes.NoteId" => "anki.cards.CardIds";
    EXTRACT_AV_TAGS = "ExtractAvTags" (27, 3): card_rendering::ExtractAvTagsRequest => card_rendering::ExtractAvTagsResponse, "anki.card_rendering.ExtractAvTagsRequest" => "anki.card_rendering.ExtractAvTagsResponse";
    RENDER_EXISTING_CARD = "RenderExistingCard" (27, 6): card_rendering::RenderExistingCardRequest => card_rendering::RenderCardResponse, "anki.card_rendering.RenderExistingCardRequest" => "anki.card_rendering.RenderCardResponse";
    SEARCH_CARDS = "SearchCards" (29, 1): search::SearchRequest => search::SearchResponse, "anki.search.SearchRequest" => "anki.search.SearchResponse";
    SEARCH_NOTES = "SearchNotes" (29, 2): search::SearchRequest => search::SearchResponse, "anki.search.SearchRequest" => "anki.search.SearchResponse";
    ADD_MEDIA_FILE = "AddMediaFile" (41, 2): media::AddMediaFileRequest => generic::String, "anki.media.AddMediaFileRequest" => "anki.generic.String";
    TRASH_MEDIA_FILES = "TrashMediaFiles" (41, 4): media::TrashMediaFilesRequest => generic::Empty, "anki.media.TrashMediaFilesRequest" => "anki.generic.Empty";
    ALL_TAGS = "AllTags" (45, 1): generic::Empty => generic::StringList, "anki.generic.Empty" => "anki.generic.StringList";
    ADD_NOTE_TAGS = "AddNoteTags" (45, 7): tags::NoteIdsAndTagsRequest => anki_proto::collection::OpChangesWithCount, "anki.tags.NoteIdsAndTagsRequest" => "anki.collection.OpChangesWithCount";
    REMOVE_NOTE_TAGS = "RemoveNoteTags" (45, 8): tags::NoteIdsAndTagsRequest => anki_proto::collection::OpChangesWithCount, "anki.tags.NoteIdsAndTagsRequest" => "anki.collection.OpChangesWithCount";
}

/// The collection of the open profile, as the actions see it. In the app it
/// holds the session's collection lock, so the profile stays open and its
/// media folder stays the collection's until the action is done.
pub struct Col<'a> {
    pub backend: Backend,
    pub profile: String,
    pub media_folder: PathBuf,
    pub _held: Option<Held<'a>>,
}

impl Col<'_> {
    /// Runs one core method. The core's error message comes back as the error,
    /// and a panic inside the core becomes an error instead of unwinding into
    /// the server.
    pub fn call<I: Message, O: Message + Default>(&self, method: Method<I, O>, input: I) -> Result<O, String> {
        let bytes = input.encode_to_vec();
        let result = catch_unwind(AssertUnwindSafe(|| {
            self.backend.run_service_method(method.service, method.method, &bytes)
        }));
        match result {
            Ok(Ok(output)) => O::decode(output.as_slice()).map_err(|err| err.to_string()),
            Ok(Err(error)) => Err(BackendError::decode(error.as_slice())
                .map(|e| e.message)
                .unwrap_or_else(|err| err.to_string())),
            Err(_) => Err("The Anki core panicked".into()),
        }
    }

    /// Runs one read-only SQL query through the core's database bridge.
    pub fn query(&self, sql: &str, args: Vec<serde_json::Value>) -> Result<Vec<Vec<serde_json::Value>>, String> {
        let request = serde_json::json!({ "kind": "query", "sql": sql, "args": args, "first_row_only": false });
        let input = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
        let result = catch_unwind(AssertUnwindSafe(|| self.backend.run_db_command_bytes(&input)));
        match result {
            Ok(Ok(output)) => {
                let value: serde_json::Value = serde_json::from_slice(&output).map_err(|err| err.to_string())?;
                Ok(serde_json::from_value(value).unwrap_or_default())
            }
            Ok(Err(error)) => Err(BackendError::decode(error.as_slice())
                .map(|e| e.message)
                .unwrap_or_else(|err| err.to_string())),
            Err(_) => Err("The Anki core panicked".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use anki_proto_gen::get_services;
    use prost_reflect::DescriptorPool;

    use super::TABLE;

    fn descriptors() -> Vec<u8> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut candidates = vec![];
        if let Ok(path) = std::env::var("DESCRIPTORS_BIN") {
            candidates.push(path.into());
        }
        candidates.push(root.join("../build/core/descriptors.bin"));
        // The core's own build always leaves a copy in its build folder.
        if let Ok(entries) = std::fs::read_dir(root.join("target/debug/build")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("anki_proto-") {
                    candidates.push(entry.path().join("out/descriptors.tmp"));
                }
            }
        }
        candidates
            .iter()
            .find_map(|path: &std::path::PathBuf| std::fs::read(path).ok())
            .expect("the core's descriptor set; build the core first")
    }

    #[test]
    fn every_method_matches_the_core_descriptor_set() {
        let pool = DescriptorPool::decode(descriptors().as_slice()).unwrap();
        let (_, services) = get_services(&pool);
        for &(name, service, method, input, output) in TABLE {
            let found = services
                .iter()
                .flat_map(|s| s.all_methods().map(move |m| (s, m)))
                .find(|(_, m)| m.proto.name() == name)
                .unwrap_or_else(|| panic!("{name} is not a core method"));
            assert_eq!((found.0.index as u32, found.1.index as u32), (service, method), "{name} numbers");
            assert_eq!(found.1.proto.input().full_name(), input, "{name} input");
            assert_eq!(found.1.proto.output().full_name(), output, "{name} output");
        }
    }
}

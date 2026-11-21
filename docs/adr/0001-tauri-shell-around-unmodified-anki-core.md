---
status: accepted
---

# A Tauri shell around Anki's unmodified Rust core

Hayaki for desktop links upstream Anki's Rust library (`vendor/anki/rslib`, pinned to a release tag) directly into its Tauri 2 application, the same way Hayaki for iOS embeds it behind a C bridge. Anki Desktop's Python and Qt layers are not used.

The interface reaches the core through one Tauri command, `core_call`, which takes a protobuf-encoded request plus the service and method numbers the core dispatches on, and returns one status byte followed by the encoded response or `BackendError`. Typed TypeScript calls for every method are generated from the core's own descriptor set by `src-tauri/codegen`, using upstream's `anki_proto_gen::get_services` so the numbers can never drift. Responses that carry `OpChanges` notify the interface's query cache, which is how screens refresh after any change.

## Consequences

- Scheduling, search, storage, import and export and sync are upstream's code, so behaviour and file compatibility match Anki exactly. Upgrading Anki means moving the submodule tag, rebuilding and regenerating.
- A few operations need the collection closed (collection packages, backups before a restore). Those are small Rust commands in `profiles.rs`, not interface code.
- Python add-ons cannot run. This is accepted (PRODUCT.md).
- `Cargo.lock` was seeded from upstream's lock file. Tauri's dependency tree was then updated on top of it.

---
status: accepted
---

# Plugins are sandboxed JavaScript with declared permissions

Anki's Python add-ons patch `aqt` and PyQt at runtime. Hayaki runs neither (ADR 0001), so those add-ons cannot load, and embedding Python would bring a large runtime, a second backend on the same collection file, and still no `aqt`. Hayaki instead offers its own plugin system, built on the same isolation as Card Content (ADR 0003). AnkiConnect, the most used add-on, is built in as a native server instead (off by default) because it needs a TCP listener, which a sandboxed page cannot open.

## Shape

- **Package.** A folder or `.zip` whose root holds `hayaki-plugin.json`: `id` (reverse-DNS, `[a-z0-9.-]`), `name`, `version`, `description`, `author`, `entry` (a script), optional `panels` (`{ id, title, icon, entry }`, an HTML page each), and `permissions`. Installed plugins live in the app data folder under `plugins/<id>/`, shared by all profiles like Anki's add-ons folder. Enabled state, and each plugin's stored data, sit next to them, outside the plugin's own files.
- **Isolation.** A plugin's entry script runs in a hidden iframe and each panel in a visible one. Both have `sandbox="allow-scripts"` and no `allow-same-origin`, so the origin is opaque: no Tauri IPC, no cookies, no storage, and no access to the interface's DOM. Files are served read-only by a `plugin` URI scheme that resolves only names inside that plugin's folder. Every plugin document gets a CSP whose `connect-src` is `'none'`, unless the manifest asks for `network` and lists origins.
- **Bridge.** The plugin talks only through `postMessage` JSON-RPC: `{ type: "call", id, method, params }` gets `{ type: "result", id, result }` or `{ type: "result", id, error }`, and the host sends `{ type: "event", name, payload }`. A small SDK (`hayaki-plugin.js`, served at `plugin://_sdk/`) wraps this and also serves the design tokens as CSS, so panels can match the app.
- **Permissions.** These are declared in the manifest, shown before install, and enforced by the host for every call:
  - `collection:read`: the core's read methods.
  - `collection:write`: every core method except a fixed denylist covering open/close, sync, full upload/download, collection packages and login.
  - `reviewer`: events and card injection.
  - `ui`: commands, panels and toasts.
  - `network`: only the listed origins.
  - `storage` is always granted, capped per plugin.

  The read/write split is a table in the host with tests. A call outside the plugin's grants fails with `permission-denied`.
- **Extension points.**
  - **Commands.** A plugin registers commands, which show up in the command palette with an optional shortcut.
  - **Panels.** Panels appear as pages in the sidebar.
  - **Reviewer events.** The reviewer sends `reviewer.questionShown`, `reviewer.answerShown` and `reviewer.answered`, each carrying card and note ids.
  - **Card injection.** A plugin may inject CSS or HTML into the card page, which is already sandboxed (ADR 0003).
  - **Navigation.** A plugin may navigate to Browse with a search, to Add, or to a deck.

## Consequences

- No AnkiWeb add-on runs unchanged. The common needs (stats views, review helpers, note tools) can be ported against a narrower and safer API than `aqt`.
- Core calls cross the same protobuf bridge as the interface, so plugins get every core method with no extra API to maintain. Upgrading Anki can add methods, which the permission table classifies before they are allowed. Unknown methods are denied.
- A plugin cannot hang or crash the interface's thread. A misbehaving plugin can be disabled from the plugin manager, and a plugin that throws while loading is marked failed rather than retried in a loop.
- Install from a URL and an online catalogue are not offered yet (owner decision, 2026-11-21).

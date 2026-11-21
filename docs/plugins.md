# Writing Hayaki plugins

Hayaki cannot run Anki's Python add-ons (ADR 0001), so it has its own plugins: sandboxed JavaScript with declared permissions (ADR 0004). A plugin runs in a frame with an opaque origin. It has no Tauri access, no cookies or web storage, and no view of the interface. It talks to Hayaki only through the bridge described here, and the bridge allows only what the person granted at install.

A complete example lives in `examples/plugins/review-streak/`. It counts today's answers, shows the count on each Card and in a panel, and registers a command.

## Package

A plugin is a folder, or a `.zip` of one, with `hayaki-plugin.json` at its root. A `.zip` whose only top-level entry is a folder holding the manifest also works. Hidden files and `__MACOSX` are left out of the install.

```json
{
  "id": "io.github.you.review-streak",
  "name": "Review Streak",
  "version": "1.0.0",
  "description": "Counts the Cards you answer today.",
  "author": "You",
  "entry": "main.js",
  "panels": [{ "id": "today", "title": "Today's Answers", "icon": "flame", "entry": "panel.html" }],
  "permissions": ["reviewer", "ui"],
  "network": []
}
```

| Field | Rules |
| --- | --- |
| `id` | 3 to 64 characters, `[a-z0-9]` runs joined by `.` or `-`, reverse-DNS style. It names the install folder. |
| `name` | 1 to 60 characters. |
| `version` | Up to 32 characters of letters, digits, `.`, `-`, `+`. |
| `description`, `author` | Optional, up to 300 and 80 characters. |
| `entry` | Relative path to a `.js` file. It runs in a hidden frame for as long as the plugin is on. |
| `panels` | Optional, up to 8. `id` is `[a-z0-9-]`, `title` up to 40 characters, `entry` a relative `.html` path, `icon` one of `bar-chart`, `book-open`, `brain`, `calendar`, `clock`, `flame`, `graduation-cap`, `layers`, `list-checks`, `puzzle`, `sparkles`, `star`, `tags`, `target`, `timer`, `trophy`. |
| `permissions` | Any of the permissions below, each once. |
| `network` | Origins such as `https://api.example.com` or `https://api.example.com:8443`. Needs the `network` permission, and that permission needs at least one origin. Only `https` origins on public hosts are accepted. Hosts on this computer or the local network are refused: `localhost`, single-label names, `.local`, `.internal`, `.lan` and `.home.arpa` names, and private, loopback or link-local addresses. A plugin therefore cannot reach the built-in AnkiConnect server. |

Paths use only `A-Z a-z 0-9 . - _` per segment, with `/` between segments, and no segment may start with a dot. Unknown fields are rejected. A package is limited to 1000 files, 32 MB in total and 16 MB per file, and may not contain symbolic links.

Installed plugins live in `<app data>/plugins/<id>/`, shared by every profile. Installing a plugin with the same `id` updates it and keeps its stored data. Uninstalling removes its folder and its data.

## Permissions

The person sees these in plain words before installing, and the host checks them on every call. A call outside the grants fails with `permission-denied`.

| Permission | Allows |
| --- | --- |
| `collection:read` | Core methods that only read. |
| `collection:write` | Every core method except the denylist, reads included. |
| `reviewer` | The `reviewer.*` events and card injection. |
| `ui` | Commands, panels, toasts and navigation. |
| `network` | `fetch`, `XMLHttpRequest` and `WebSocket` to the listed origins only. |
| storage | Always granted, up to 1 MB per plugin. |

`src/lib/plugins/permissions.ts` classifies every core method as `read`, `write` or `deny`, and a test fails when an Anki upgrade adds one that is not classified. Names not in the table are denied. The denylist covers opening and closing the collection, sync and full upload or download, logins (AnkiWeb, AnkiHub), anything else that reaches the network, every method that reads or writes a path on disk (collection and deck packages, CSV and JSON files, backups, media from a path or a URL, TTS files, dataset export, image occlusion from a path), raw SQL, `setWantsAbort`, and the frontend service that only the interface implements.

`collection:write` is powerful. Besides changing or deleting anything in the collection, a plugin with it can change Notes and Card Templates. Templates can run scripts in the card page, and those scripts can reach the internet, as in any shared Deck. The changes also sync to the person's other devices. Grant it only to plugins you trust.

## Files, pages and the SDK

Hayaki serves plugin files read-only over the `plugin` scheme: `plugin://localhost/` on macOS and Linux, `http://plugin.localhost/` on Windows. Pages refer to them with root-relative or relative URLs:

- `/_sdk/hayaki-plugin.js` is the SDK. The entry page loads it for you. A panel page must load it itself, before its own scripts.
- `/_sdk/tokens.css` holds the interface's design tokens (`--bg`, `--surface`, `--surface-2`, `--raised`, `--line`, `--line-strong`, `--ink`, `--ink-2`, `--ink-3`, `--accent`, `--accent-soft`, `--accent-ink`, `--danger`, `--text-caption` to `--text-display`, `--font-ui`, `--ring` and the rest of `src/styles/app.css`). The SDK adds it to the page and keeps the page's `dark` class, `data-theme`, `data-appearance`, `lang` and `dir` in step with the app, so the tokens follow the person's Theme and Appearance.
- `/<id>/<path>` is a file of your plugin. Only your own folder is served to you.

Every plugin page gets this Content Security Policy:

```
default-src 'none'; script-src <base>/_sdk/ <base>/<id>/; style-src <base>/_sdk/ <base>/<id>/ 'unsafe-inline';
img-src <base>/<id>/ data: blob:; font-src <base>/_sdk/ <base>/<id>/ data:; media-src <base>/<id>/ data: blob:;
connect-src 'none' (or the network origins); frame-src 'none'; worker-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'
```

So scripts come from files only (no inline scripts, no `eval`), inline styles are fine, and nothing connects anywhere unless the manifest lists it. Scripts are classic scripts, not modules. Put an entry plugin in one file, and load a panel's scripts in order with `<script src>`.

A frame shows only the page Hayaki opened in it. Hayaki serves a page (the entry page or any `.html` file) only with a one-use ticket that it adds to the address when it opens the frame, so a page cannot be loaded a second time, and a frame cannot load another plugin's page or another page of its own. A frame that navigates away from its page loses the bridge and stops with an error. Build each panel as one page, and change its content with scripts.

A panel page looks like this:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="/_sdk/hayaki-plugin.js"></script>
    <link rel="stylesheet" href="panel.css" />
    <script src="panel.js" defer></script>
  </head>
  <body>…</body>
</html>
```

## Lifecycle

The entry script runs when the app starts or the plugin is turned on. Plugins start one at a time, in id order. When the page's `load` event fires without an error, the plugin is running. An error while loading, or no `load` within 15 seconds, marks the plugin failed: it stops, the manager shows the error, and it stays off until the person turns it off and on again. Errors after loading are only logged. Panels load the same way each time they are opened, and a panel that fails shows its error in place of the page without stopping the plugin. Installing a plugin again, at any version, reloads its frames. An update keeps the plugin on or off as the person left it.

On macOS a plugin's frames run on the interface's thread, so a plugin that never returns, such as one stuck in `while (true) {}`, freezes the whole app until it quits. Hayaki turns such a plugin off at the next launch. The interface reports to the shell every 2 seconds which plugins are running and which are loading. When the app ends while a plugin was loading, or after the reports stopped for 10 seconds, the next launch marks that plugin failed with "Stopped: it froze Hayaki last time". If reports stopped after every plugin had loaded, every plugin that was running is marked failed, because the shell cannot tell which one froze. To start once with every plugin off, hold Shift while Hayaki starts, or set the `HAYAKI_NO_PLUGINS` environment variable. Holding Shift works on macOS and Windows.

## The SDK

`docs/hayaki-plugin.d.ts` types it. Every method returns a promise that rejects with a `HayakiError` carrying a `code`.

```js
// Core methods, by camelCase name, with protobuf JSON in and out.
const card = await hayaki.core.getCard({ cid: "1700000000123" });
const ids = await hayaki.core.searchCards({ search: "deck:Japanese is:due", order: { none: {} } });

hayaki.on("reviewer.answered", ({ cardId, noteId, ease }) => {});
hayaki.ui.registerCommand({ id: "hello", title: "Say hello", shortcut: "Ctrl+Alt+J" }, () => hayaki.ui.toast("Hello"));
hayaki.ui.navigate({ to: "browse", search: "rated:1" });
await hayaki.storage.set("count", { n: 3 });
const saved = await hayaki.storage.get("count");
await hayaki.reviewer.injectCss(".hayaki-plugins .badge { color: var(--accent); }");
await hayaki.reviewer.injectHtml('<div class="badge">3 today</div>');
```

## Protocol

The SDK wraps `postMessage` JSON-RPC between the plugin's frame and the interface. The host accepts messages only from frames it created, and treats each frame as the plugin it was created for. A frame may have up to 32 calls waiting for an answer at once. Further calls fail with `busy` until some are answered.

- Call: `{ type: "call", id, method, params }`, where `id` is a number or a string of up to 64 characters.
- Answer: `{ type: "result", id, result }` or `{ type: "result", id, error: { code, message, kind? } }`.
- Event: `{ type: "event", name, payload }`.

### Methods

| Method | Permission | Params → result |
| --- | --- | --- |
| `core.<method>` | `collection:read` or `collection:write`, per the table | The request message as protobuf JSON → the response message as protobuf JSON, with default values included. int64 values (ids, timestamps) are strings and enums are names. |
| `ui.registerCommand` | `ui` | `{ id, title, shortcut? }` → `null`. The command appears in the command palette (Ctrl+K) as "Plugin name: title". Registering an id again replaces it. At most 20 per plugin. |
| `ui.unregisterCommand` | `ui` | `{ id }` → `null` |
| `ui.toast` | `ui` | `{ message, kind? }` → `null`. `kind` is `info`, `success` or `error`; up to 300 characters. |
| `ui.navigate` | `ui` | `{ to: "browse", search? }`, `{ to: "add" }` or `{ to: "deck", deckId }` → `null` |
| `storage.get` | none | `{ key }` → the stored JSON or `null` |
| `storage.set` | none | `{ key, value }` → `null`. `null` removes the key. Fails with `storage-full` past 1 MB. Keys are 1 to 128 characters. |
| `reviewer.injectCss` | `reviewer` | `{ css }` → `null`. Replaces this plugin's CSS on the card page. CSS may not load anything, so `url()`, `src()`, `image()`, `image-set()`, `cross-fade()`, `element()` and `@import` are refused, also when spelled with backslash escapes. Other escapes, such as `content: "\201C"`, are fine. Up to 64 KB. |
| `reviewer.injectHtml` | `reviewer` | `{ html }` → `null`. Replaces this plugin's HTML, added after the Card's content inside `<div class="hayaki-plugins">`. It is cleaned to plain markup: no scripts, event handlers, inline styles, links or outside URLs, and ids get a `plugin-` prefix. Images may name files in the media folder. |

Shortcuts are Ctrl+Alt (optionally with Shift) and a letter or digit. Ctrl is Cmd on macOS, so Ctrl+Alt+K is Cmd+Option+K there. Shortcuts that Hayaki, Anki or another plugin already uses are refused, and so are the Cmd+Option chords that macOS keeps: Ctrl+Alt+H, Ctrl+Alt+M, Ctrl+Alt+W, Ctrl+Alt+I and Ctrl+Alt+D, on every platform.

### Events

| Event | To | Payload |
| --- | --- | --- |
| `reviewer.questionShown` | plugins with `reviewer` | `{ cardId, noteId }` |
| `reviewer.answerShown` | plugins with `reviewer` | `{ cardId, noteId }` |
| `reviewer.answered` | plugins with `reviewer` | `{ cardId, noteId, ease }`, ease 1 (Again) to 4 (Easy) |
| `command.invoked` | the frame that registered the command | `{ id }` |
| `app.theme` | every frame | `{ dark, theme, appearance, lang, dir }`; the SDK applies it for you |

Events go to the plugin's entry frame and to any of its panels that are open.

### Errors

| Code | Meaning |
| --- | --- |
| `permission-denied` | The method needs a permission the plugin lacks, or is never available to plugins. |
| `unknown-method` | No such method. |
| `invalid-params` | The params do not parse, for example an unknown field in a core request. |
| `core-error` | The core refused the call. `kind` is the core's error kind, such as `NOT_FOUND_ERROR`. |
| `storage-full` | The write would pass the storage limit. |
| `busy` | The frame already has 32 calls waiting for an answer. |
| `failed` | Anything else. |
| `timeout` | Raised by the SDK when no answer arrives within 60 seconds. |

## Not supported yet

Installing from a URL and an online catalogue are not offered. AnkiWeb add-ons do not run, but the common needs (stats views, review helpers, note tools) can be ported to this API. AnkiConnect is built in as a server in Settings, not a plugin, because it needs a TCP listener.

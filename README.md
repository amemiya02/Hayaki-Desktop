<p align="center"><img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Hayaki's smiling folded-card icon"></p>

<h1 align="center">Hayaki for desktop</h1>

<p align="center"><b>Hayaki = Hayaku + Anki</b></p>

<p align="center">An offline flashcard app for your Anki collection, on Windows, macOS and Linux.</p>

<p align="center"><a href="https://github.com/amemiya02/Hayaki">Hayaki for Android</a> · <a href="https://github.com/amemiya02/Hayaki-iOS">Hayaki for iPhone and iPad</a></p>

Hayaki for desktop rebuilds Anki Desktop's interface from scratch as one calm, coherent desktop app, on top of Anki's own unmodified engine. Your collection, scheduling, review history and sync work exactly as in Anki, so you can move between Anki, AnkiDroid and the other Hayaki editions at any time.

## What works

- **Decks.** Today's work at a glance, the Deck tree with new, learning and due counts, create, rename and delete Decks, and a Deck overview.
- **Study.** Anki's v3 scheduler with FSRS or SM-2, exactly as upstream. Card Templates render untouched, with MathJax, audio, text-to-speech, type-in answers, flags, marks, bury, suspend, delete and undo. Anki's study shortcuts work: Space, 1 to 4, R, `*`, Ctrl+1 to 7, `-`, `=`, `@`, `!`, Ctrl+Z and Esc. Starting a session folds the sidebar away so the Card has the window.
- **Move your collection.** Import Deck packages (`.apkg`, merged) and collection packages (`.colpkg`, replaced after confirmation and a backup). Export either one.
- **Sync** with AnkiWeb or a self-hosted Anki sync server, including the full-sync choice and media sync.
- **Tools.** Check Database, Check Media, Empty Cards and Create Backup, all from the command palette (Ctrl+K).
- **Make it yours.** System, Light, Dark or Black appearance with any of the ten Hayaki Themes. Separate profiles keep separate collections.
- English, Simplified Chinese and Japanese are first-class. Anki's own strings come from the engine in every language it translates.

- **Browse.** Cards and Notes modes, a virtualized table with sortable, resizable and selectable columns, Anki's sidebar filters and search syntax, and the selected Note's editor beside it. It also covers Change Deck, suspend, bury, flags, marks, tags, Set Due Date, Reset, Reposition, Find and Replace, Delete and Preview, with Anki's shortcuts.
- **Add and Edit.** Rich-text fields with Anki's formatting and cloze shortcuts, MathJax insertion, pasted and dropped media, sticky fields, a tag editor with autocomplete, duplicate checks and a live Card preview.
- **Statistics,** rebuilt natively from the engine's numbers: Today, Future Due, Calendar, Reviews, Card Counts, Intervals, Ease or FSRS Stability, Difficulty and Retrievability, Hourly Breakdown, Answer Buttons, Added and True Retention.
- **Deck Options,** rebuilt natively: presets, daily limits with per-Deck and today-only overrides, every scheduling, display, burying, audio, timer, auto-advance and easy-days option, and FSRS with Optimize and Evaluate.

- **Collection management.** Manage Note Types with fields and options, Card Templates and Styling in a CodeMirror editor with a live preview of a real Note, Change Note Type with field and template mapping, and Card Info with the review log and FSRS forgetting curve.
- **Filtered Decks and Custom Study**, with Anki's options and live search validation.
- **Image Occlusion.** A mask editor with rectangles, ellipses, polygons and text, grouping, alignment and undo. The masks round-trip with Anki, and occlusion Cards render during study and preview.
- **More ways in and out.** CSV and text import with field mapping, import options for Deck packages with a full import log, and export of Notes or Cards as plain text.
- **Everything else.** Audio recording in the editor, the FSRS simulator and workload helper, Anki's own preferences (scheduling, review, editing, browsing, backups), a profile chooser, a collapsible and resizable sidebar, a keyboard shortcuts sheet (?) and the Ctrl+K command palette.
- **Native feel.** Windows 11 Mica and macOS vibrancy behind the sidebar, an opaque fallback elsewhere, and short motion that respects reduced-motion settings.

## Build

You need [rustup](https://rustup.rs) (the pinned Rust 1.97.1 installs itself), Node.js 22 or later, the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform, and `protoc` 3.15 or later. On Windows you can unpack a [protobuf release](https://github.com/protocolbuffers/protobuf/releases) into `.tools/protoc/`.

```sh
git clone --recurse-submodules https://github.com/amemiya02/Hayaki-Desktop.git
cd Hayaki-Desktop
git -C vendor/anki submodule update --init --depth 1 ftl/core-repo ftl/qt-repo
npm install

# Name Hayaki's build in the sync requests the core sends (upstream reads out/buildhash)
mkdir -p vendor/anki/out && printf 'hayaki-%s' "$(git -C vendor/anki rev-parse --short=8 HEAD)" > vendor/anki/out/buildhash

# Point the core's build at protoc and a stable descriptor path
export PROTOC=/path/to/protoc
export DESCRIPTORS_BIN="$PWD/build/core/descriptors.bin"

(cd src-tauri && cargo build)   # first build compiles Anki's core; it takes a while
npm run core:gen                # generates the typed TypeScript calls from the core
npm run app                     # starts Hayaki in development mode
```

`npm run app:build` produces installers in `src-tauri/target/release/bundle/`.

Tests: `cargo test --lib` in `src-tauri` (it drives the real core against a throwaway collection), `npm test`, and `npm run typecheck`.

## How it is built

- `vendor/anki` is upstream Anki at the tag `26.09.4`, unmodified, linked into the Tauri app as Rust path dependencies.
- `src-tauri/src/core.rs` is the whole bridge: one binary command that runs a core method by its service and method numbers and returns the encoded reply. Panics come back as errors.
- `src-tauri/codegen` reads the core's descriptor set and writes `src/lib/anki/generated/core.ts`, a typed function for every core method. The numbers come from upstream's own helper, so they always match the built library.
- Card Content renders in a page served from a separate origin (`http://media.localhost`), so scripts in Card Templates can never reach the core or the interface.
- The interface is React 19, TypeScript, Tailwind CSS 4 and Radix, with TanStack Query and Virtual.

Decisions are recorded in [`docs/adr/`](docs/adr/), product rules in [PRODUCT.md](PRODUCT.md).

## License

Hayaki for desktop is licensed under AGPL-3.0-or-later. It embeds Anki (© Ankitects Pty Ltd and contributors, AGPL-3.0-or-later) and MathJax (Apache-2.0). Hayaki is an independent project and is not affiliated with Ankitects.

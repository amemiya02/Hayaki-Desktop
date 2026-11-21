# Product

<!-- impeccable:product-schema 1 -->

Terms in capitals (Deck, Card, Note, Note Type, Card Template, Card Content, Engine) follow Anki's vocabulary and [Hayaki's glossary](https://github.com/amemiya02/Hayaki/blob/main/GLOSSARY.md).

## Platform

web

The interface is a web view inside a Tauri 2 desktop shell on Windows, macOS and Linux. It follows desktop conventions (window, sidebar, keyboard, pointer, menus), not mobile ones.

## Stack

- **Shell:** Tauri 2. The Rust side links upstream Anki's Rust core (`vendor/anki`, pinned at 26.09.4) through path dependencies, unmodified, and exposes it through one binary call command. Service and method numbers and the TypeScript calls are generated from the core's own descriptor set (`src-tauri/codegen`). Message types come from `protoc-gen-es` v2.
- **Interface:** React 19, TypeScript, Vite, Tailwind CSS 4 and Radix primitives, with TanStack Query and Virtual, Motion and lucide icons. Chosen by the owner on 2026-11-21.
- **Card Content** renders in an iframe served from the media origin (`http://media.localhost`), never the app origin, so template scripts cannot reach the core.

## Users

Two primary jobs, weighted equally (owner decision, 2026-11-21):

- **The Daily Reviewer at a desk.** The owner, and people like them, studying Anki Decks most days in Simplified Chinese, Japanese and English, often in long sessions, with a keyboard. Open, see what is due, study, finish.
- **The collection keeper.** The same people building and maintaining a collection: adding and editing Notes, browsing and bulk-editing large collections, managing Note Types and Card Templates, tuning Deck options and FSRS, importing and exporting. Desktop Anki is where most people do this work.

## Product Purpose

Hayaki for desktop is the third Hayaki edition, after [Android](https://github.com/amemiya02/Hayaki) and [iOS](https://github.com/amemiya02/Hayaki-iOS). It rewrites Anki Desktop's interface from scratch on Upstream's own Engine: one calm, coherent, fast interface that replaces Qt widgets, Python dialogs and embedded web pages.

Success means:

- the owner chooses Hayaki over Anki Desktop for daily study and for collection work;
- every surface reads as one product, shared with the phone editions;
- nothing Anki Desktop offers is lost, apart from Python add-ons;
- the collection always returns to Anki, AnkiDroid and the other Hayaki editions intact.

## Positioning

- **Anki Desktop's full capability with a coherent interface.** Anki Desktop mixes Qt dialogs from several eras with web pages. Hayaki rebuilds each of them natively in one design system, including the pages upstream ships as web views (Deck options, Statistics, Card info, the CSV importer, Change Note Type and image occlusion).
- **Same Engine, same data.** Scheduling, search, storage and sync are Upstream's unmodified Rust code, so results match Anki exactly.
- **One product across devices.** Same name, icon, ten Themes and Appearance choices as Hayaki on Android and iOS.

## Operating Context

- **Keyboard first, pointer welcome.** Every study action has a key (Anki's defaults: Space or Enter to reveal and answer Good, 1 to 4 to answer, E edit, R replay, `*` mark, Ctrl+1 to 7 flags, `-` bury, `@` suspend, Ctrl+Z undo). Every screen is reachable from the keyboard.
- **Windows of all sizes**, from a half-screen beside a dictionary to a full 4K display. Minimum window 880×600.
- **Day and night.** Appearance is System, Light, Dark or Black, independent of the Theme.
- **Mixed-language content**, with long Chinese and Japanese Deck names that must not push counts out of view.
- **Large collections.** The browser stays smooth at 100,000+ Cards.
- **Profiles.** Separate collections in separate profiles, each with one sync destination.
- **Data movement:** `.apkg` merges, `.colpkg` replaces after confirmation and a backup, CSV and text import, AnkiWeb or a self-hosted sync server.

## Capabilities and Constraints

**Baseline (owner decision, 2026-11-21):** everything Anki Desktop 26.09.4 offers except Python add-ons. That includes the deck list, overview and finished screens, the reviewer with timers, audio, TTS and type-in answers, filtered Decks and custom study, the browser (Cards and Notes modes, sidebar, columns, sorting, find and replace, reposition, set due date, forget, change Deck, change Note Type), Add and Edit with the rich-text editor, cloze, MathJax and media, Note Type, field and Card Template management with preview, Deck options and presets with FSRS tools, Statistics, Card info, import and export, sync, profiles, preferences, backups, Check Database, Check Media, Empty Cards and image occlusion.

**Hard limits:**

- **The Engine is never modified.** Collection format, scheduling and sync stay identical to Upstream.
- **Anki's words are used verbatim** (Note, Card, Deck, Note Type, Card Template) in every language. Interface strings come from the Engine's own translations wherever upstream has them.
- **Card Content is rendered exactly as its Card Template styles it.** The interface never restyles it.
- **No crash reports or usage statistics** are sent anywhere.

**Languages:** English, Simplified Chinese and Japanese are first-class. Other locales use the Engine's translations where they exist and English otherwise.

**Undecided:** distribution (signing, stores, auto-update), and whether add-on-like extension points ever exist.

## Brand Commitments

- **Name:** "Hayaki" (Hayaku + Anki), the same in every language. Never "Anki" alone, and never mistaken for a product of Anki's makers.
- **Icon:** the smiling folded-card icon owned by Hayaki-iOS (`docs/assets/app-icon/master.png`).
- **Themes:** the ten shared Themes (Hayaki, Sakura, Matcha, Ocean, Indigo, Wisteria, Amber, Sumi, Paper, Midnight) and Appearance System, Light, Dark or Black, as defined by Hayaki-iOS `HayakiAppearance/Theme.swift`.
- **Provenance:** credits Anki (Ankitects Pty Ltd and contributors) and states the licence, AGPL-3.0-or-later.
- **Voice:** short plain sentences in the second person. Say what will happen, above all when data can be replaced. No exclamation marks, no cheerleading.
- **No gamification:** no streak pressure, confetti or badges.

## Evidence on Hand

- Android product record, design system and walkthrough: `../Hayaki/PRODUCT.md`, `../Hayaki/DESIGN.md`, `../Hayaki/docs/redesign/`.
- iOS specs, screenshots and Theme palette: `../Hayaki-iOS/docs/specs/`, `../Hayaki-iOS/docs/assets/`.
- Upstream reference: `vendor/anki` (desktop interface in `qt/aqt`, web pages in `ts/routes`).
- Absent, and not to be invented: users beyond the owner, testimonials, store listings, download counts.

## Product Principles

1. **Study and collection work are both first-class.** The reviewer gets the most care in motion and focus; the browser and editor get the most care in density and speed.
2. **Card Content leads; the frame recedes.**
3. **Keyboard parity.** Nothing needs the mouse, and shortcuts match Anki's so desktop users bring their muscle memory.
4. **Nothing relied on is lost.** Engine parity, every Anki Desktop feature and the way back to Anki stay intact.
5. **Speak Anki's language plainly,** and say what an action will do before it does it.

## Accessibility & Inclusion

- WCAG AA text contrast in every Theme × Appearance.
- Full keyboard operation with visible focus; screen-reader labels on every control.
- Respects reduced motion and the OS text scale; holds up in English, Simplified Chinese and Japanese, and mirrors for right-to-left languages.

# Brief for agents working on Hayaki Desktop

Hayaki Desktop rewrites Anki Desktop's interface from scratch: Tauri 2 + React 19 + TypeScript 7 + Tailwind CSS 4 + Radix (the unified `radix-ui` package), TanStack Query and Virtual, Motion, cmdk, sonner, lucide-react, Vite 8. It runs on Anki 26.09.4's unmodified Rust engine. Windows dev machine; PowerShell, with Git Bash also available.

## Hard rules

- The app runs in dev mode in another process. Do NOT start `tauri dev`, do NOT run `scripts/drive.mjs`, do NOT kill the `hayaki` process, do NOT commit. The lead verifies visually.
- Edit only the files your task names. Need a change elsewhere? Describe it in your report.
- Done means: `npx tsc --noEmit -p .` passes (repo root) and `npx vitest run <your folder>` passes. Put pure logic in testable modules with vitest tests.
- Anki's words, verbatim. Use `tr("ftl-key", args)` from `src/lib/i18n.ts` for every string upstream has. Every key must exist in `vendor/anki/ftl/core/*.ftl` or `vendor/anki/ftl/qt/*.ftl` (grep to verify). Upstream Svelte/TS `tr.someThing()` maps to the key `some-thing`; Python `tr.some_thing()` likewise. Hayaki-only strings go in your own `src/lib/strings/<area>.ts` via `makeStrings({ en, zh, ja })`, in English, Simplified Chinese and Japanese. Voice: short plain second-person sentences that say what will happen; no exclamation marks.
- No hex colours in components; use the tokens in `src/styles/app.css` (Tailwind classes such as `bg-surface`, `bg-surface-2`, `bg-raised`, `border-line`, `text-ink`, `text-ink-2`, `text-ink-3`, `bg-accent`, `text-on-accent`, `bg-accent-soft`, `text-accent-ink`, `text-new`, `text-learn`, `text-due`, `text-danger`). No emoji. Icons from lucide-react only. Card Content (template HTML/CSS) is never restyled.
- Read `DESIGN.md` (the built design system), `PRODUCT.md`, and `.impeccable/surfaces/src-app-tsx.md` (direction "Native Desktop, Tinted") before writing UI. Reuse `src/components/ui.tsx` (Button, IconButton, Kbd, Tooltip, TextField, Menu*, SubMenu, Dialog, Segmented, Spinner, cn), `src/components/confirm.tsx` (`await confirm({...})`), and toasts from `sonner`. Match the look of `src/screens/Settings.tsx` (grouped rows), `src/screens/deck-options/` (settings-style screen with a save bar, `controls.tsx`) and `src/screens/browse/` (dense tools).
- Engine calls: `import * as core from "@/lib/anki/generated/core"` gives a typed function for every core method. Message types are in `src/lib/anki/proto/anki/*_pb.ts` (protobuf-es v2: plain objects, `create(Schema, init)`, enums as TS enums). Errors throw `CoreError` (`src/lib/anki/transport.ts`). Responses with OpChanges refresh TanStack Query caches automatically (see `src/lib/queries.ts`). Long operations: poll `core.latestProgress()` and cancel with `core.setWantsAbort()`, as in `src/screens/deck-options/progress.ts`.
- Navigation: `useNav().go(route)` / `back()` from `src/lib/nav.ts` (routes are listed there). `setLeaveGuard` protects unsaved work (see deck-options). Card rendering: `src/components/CardFrame.tsx` plus `src/lib/study/render.ts`. Media URLs: `mediaUrl()` in `src/lib/study/audio.ts`. Adding media: `src/lib/media.ts`. File dialogs: `@tauri-apps/plugin-dialog` (`open`, `save`).
- Upstream reference for behaviour: `vendor/anki/qt/aqt/` (Python/Qt desktop), `vendor/anki/ts/routes/` (Svelte pages), `vendor/anki/proto/anki/*.proto`, and `vendor/anki/rslib/src/`. Match upstream's behaviour and option set. The look follows Hayaki's design system.
- Quality bar: the best native desktop apps (macOS System Settings, Linear, Things). Precise alignment, a real type scale, visible keyboard focus, every control labelled, handled empty, loading and error states, no layout jank, full keyboard operation with Anki's shortcuts, and smooth at large collections.

## Report back

List the files created or changed, what works, and what is not done or uncertain. Be honest. Also list any shared-file change you need.

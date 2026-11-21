---
status: accepted
---

# Anki's web pages are rebuilt natively

Anki Desktop shows Deck Options, Statistics, Card Info, the CSV importer, Change Note Type and image occlusion as Svelte pages. Hayaki for Android embeds those pages with Hayaki's colours. Hayaki for desktop rebuilds them natively in its own interface instead (owner decision, 2026-11-21), as Hayaki for iOS does.

## Consequences

- Every surface uses one design system, and there is no dependency on Anki's JavaScript build.
- Values must match upstream. Each rebuilt page takes its numbers from the same core calls upstream's page uses, and where upstream computes in TypeScript (graph buckets, deck options request assembly), that logic is ported with tests.
- Until a page is rebuilt, its destination says so plainly instead of showing a partial copy.

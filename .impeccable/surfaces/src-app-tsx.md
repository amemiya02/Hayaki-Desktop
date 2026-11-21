---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/screens"]
---

## Scope

The whole Hayaki Desktop app shell and its screens (Decks, Study, Browse, Add/Edit, Statistics, Settings and the rebuilt Anki pages). Mode: Operate.

Audience and job: daily reviewers at a desk and collection keepers, weighted equally (PRODUCT.md). Constraints: unmodified Anki engine, Anki's words, Card Content untouched, ten shared Themes × System/Light/Dark/Black, keyboard parity with Anki.

## Direction contract

THESIS: Hayaki is a first-class desktop citizen, finished to the level of the best native apps on the platform (Apple Notes, Finder, Windows 11 Settings), not a phone app on a big screen and not Anki's Qt-plus-web patchwork. It refuses the category default of a grey SaaS sidebar with one blue button.

OWN-WORLD: a tinted source-list sidebar (the Theme accent mixed at about 6% into a cool neutral, translucent where the OS allows) beside a white or near-black work area. The Theme accent carries selection, the one primary action per screen, focus rings and progress. Grouped inset lists with 10px corners, one-step elevation only for popovers and dialogs, system UI fonts (Segoe UI Variable, SF Pro, system CJK), tabular figures. Anki's blue, red and green are kept only for new, learning and due counts and the four answers.

STORY: you open the app and know at once what is due today and where each Deck stands. You start studying with one key. The interface steps back so the Card leads. You move to Browse or Add without losing your place, and every action has a shortcut you already know from Anki.

FIRST VIEWPORT: left, a 248px sidebar: Library (Decks, Browse, Statistics), a collapsible Deck tree with due counts and filtered Decks, and a footer with the profile and its Sync and Settings buttons. Top, a 52px toolbar: screen title, the search field (which opens Browse), Import and Add. Main: today's summary as one sentence (Cards due today, what was studied) over one queue bar (new, learning, due; 520px maximum width), with Create Deck and the screen's single filled Study button beside it, naming the Deck it will study; then the grouped Deck table with New, Learn and Due columns and a per-row Study action. Saved Searches live in Browse's filter column, where they run. The four summary tiles first sketched were dropped because the craft floor refuses the hero-metric template.

FORM: Native Desktop, Tinted, list position 1 (IMPECCABLE’S PICK, chosen by the owner). seed:c623c911079c8e02. Signature move: the Focus transition. Starting study collapses the sidebar and toolbar into one quiet strip in a single 200ms move while the Card takes the window on the Theme canvas. A 2px accent progress line under the strip drains the session. Escape restores the shell. Carried disciplines: the next Card is pre-rendered so an answer lands in under 120ms; today's queue (new, learning, due) is always drawn in one order and colours, at most 520px wide, and the Card lifecycle (new, learning, relearning, young, mature) in Statistics in one order and colours; hierarchy comes from size and weight alone.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

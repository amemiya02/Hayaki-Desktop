// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The keyboard shortcuts sheet's contents: Anki's own keys per screen
 * (`aqt/main.py`, `overview.py`, `reviewer.py`, `forms/browser.ui`), plus the
 * few Hayaki adds. Labels are functions so they read the loaded language.
 */
import { t, tr, trLabel } from "@/lib/i18n";
import { ts } from "@/lib/strings/shell";
import { SHORTCUTS, type ActionId } from "@/screens/browse/keys";

export interface ShortcutItem {
  label: () => string;
  /** Alternative chords, such as `["Space", "Enter"]`. */
  keys: string[];
}

export interface ShortcutSection {
  id: "everywhere" | "decks" | "overview" | "study" | "browse" | "editor";
  title: () => string;
  items: ShortcutItem[];
}

/** The keys of one chord, such as `Ctrl+Shift+D` → `Ctrl`, `Shift`, `D` (a lone `+` survives). */
export function splitChord(chord: string): string[] {
  if (chord === "+") return ["+"];
  const parts = chord.split("+");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "" && i === parts.length - 1) out.push("+");
    else if (parts[i] !== "") out.push(parts[i]);
  }
  return out;
}

/**
 * The app-wide chords, shared by the shortcuts sheet and the command palette
 * so both always show the same keys.
 */
export const GLOBAL_KEYS = {
  decks: ["D"],
  add: ["A"],
  browse: ["B"],
  stats: ["T"],
  study: ["S"],
  sync: ["Y"],
  search: ["Ctrl+F"],
  studyDeck: ["/"],
  palette: ["Ctrl+K"],
  sidebar: ["Ctrl+\\"],
  import: ["Ctrl+Shift+I"],
  export: ["Ctrl+E"],
  notetypes: ["Ctrl+Shift+N"],
  switchProfile: ["Ctrl+Shift+P"],
  preferences: ["Ctrl+P", "Ctrl+,"],
  shortcuts: ["?", "F1"],
  undo: ["Ctrl+Z"],
  redo: ["Ctrl+Shift+Z", "Ctrl+Y"],
  fullscreen: ["F11"],
  zoomIn: ["Ctrl+="],
  zoomOut: ["Ctrl+-"],
  zoomReset: ["Ctrl+0"],
  createFiltered: ["F"],
  cardInfoStudy: ["I"],
} as const satisfies Record<string, readonly string[]>;

const browseLabels: Partial<Record<ActionId, () => string>> = {
  focusSearch: () => tr("actions-search"),
  preview: () => tr("actions-preview"),
  cardInfo: () => tr("actions-card-info"),
  changeDeck: () => tr("browsing-change-deck"),
  changeNotetype: () => trLabel("browsing-change-note-type2"),
  setDue: () => tr("actions-set-due-date"),
  forget: () => trLabel("qt-accel-forget"),
  reposition: () => tr("actions-reposition"),
  toggleSuspend: () => tr("browsing-toggle-suspend"),
  toggleBury: () => tr("browsing-toggle-bury"),
  toggleMark: () => tr("browsing-toggle-mark"),
  addTags: () => trLabel("browsing-add-tags2"),
  removeTags: () => trLabel("browsing-remove-tags"),
  findReplace: () => tr("browsing-find-and-replace"),
  createFiltered: () => trLabel("qt-misc-create-filtered-deck"),
  exportNotes: () => trLabel("qt-accel-export-notes"),
  delete: () => tr("browsing-delete-notes"),
  toggleMode: () => tr("browsing-toggle-showing-cards-notes"),
  selectAll: () => trLabel("qt-accel-select-all"),
  invert: () => trLabel("qt-accel-invert-selection"),
  next: () => trLabel("qt-accel-next-card"),
  prev: () => trLabel("qt-accel-previous-card"),
  toggleFilters: () => trLabel("qt-accel-filter"),
  focusTable: () => tr("browsing-card-list"),
  focusEditor: () => trLabel("qt-accel-note"),
  undo: () => tr("undo-undo"),
  redo: () => tr("undo-redo"),
  gradeNow: () => trLabel("actions-grade-now"),
  createCopy: () => tr("actions-create-copy"),
  firstCard: () => tr("browsing-first-card"),
  lastCard: () => tr("browsing-last-card"),
  zoomIn: () => trLabel("qt-accel-zoom-in"),
  zoomOut: () => trLabel("qt-accel-zoom-out"),
  zoomReset: () => trLabel("qt-accel-reset-zoom"),
};

const browseOrder: ActionId[] = [
  "focusSearch",
  "toggleFilters",
  "toggleMode",
  "focusTable",
  "focusEditor",
  "next",
  "prev",
  "selectAll",
  "invert",
  "preview",
  "cardInfo",
  "changeDeck",
  "changeNotetype",
  "setDue",
  "forget",
  "reposition",
  "toggleSuspend",
  "toggleBury",
  "toggleMark",
  "addTags",
  "removeTags",
  "findReplace",
  "createFiltered",
  "exportNotes",
  "delete",
  "gradeNow",
  "createCopy",
  "firstCard",
  "lastCard",
  "zoomIn",
  "zoomOut",
  "zoomReset",
  "undo",
  "redo",
];

export const SECTIONS: ShortcutSection[] = [
  {
    id: "everywhere",
    title: () => ts("everywhere"),
    items: [
      { label: () => t("nav.decks"), keys: [...GLOBAL_KEYS.decks] },
      { label: () => tr("actions-add"), keys: [...GLOBAL_KEYS.add] },
      { label: () => t("nav.browse"), keys: [...GLOBAL_KEYS.browse] },
      { label: () => t("nav.stats"), keys: [...GLOBAL_KEYS.stats] },
      { label: () => tr("studying-study-now"), keys: [...GLOBAL_KEYS.study] },
      { label: () => tr("qt-misc-sync"), keys: [...GLOBAL_KEYS.sync] },
      { label: () => ts("focusSearch"), keys: [...GLOBAL_KEYS.search] },
      { label: () => trLabel("qt-misc-study-deck"), keys: [...GLOBAL_KEYS.studyDeck] },
      { label: () => ts("openPalette"), keys: [...GLOBAL_KEYS.palette] },
      { label: () => ts("hideSidebar"), keys: [...GLOBAL_KEYS.sidebar] },
      { label: () => trLabel("qt-accel-import"), keys: [...GLOBAL_KEYS.import] },
      { label: () => trLabel("qt-accel-export"), keys: [...GLOBAL_KEYS.export] },
      { label: () => tr("qt-misc-manage-note-types"), keys: [...GLOBAL_KEYS.notetypes] },
      { label: () => trLabel("qt-accel-switch-profile"), keys: [...GLOBAL_KEYS.switchProfile] },
      { label: () => trLabel("qt-accel-preferences"), keys: [...GLOBAL_KEYS.preferences] },
      { label: () => ts("showShortcuts"), keys: [...GLOBAL_KEYS.shortcuts] },
      { label: () => trLabel("qt-accel-full-screen"), keys: [...GLOBAL_KEYS.fullscreen, "Ctrl+Cmd+F"] },
      { label: () => trLabel("qt-accel-zoom-in"), keys: [...GLOBAL_KEYS.zoomIn] },
      { label: () => trLabel("qt-accel-zoom-out"), keys: [...GLOBAL_KEYS.zoomOut] },
      { label: () => trLabel("qt-accel-reset-zoom"), keys: [...GLOBAL_KEYS.zoomReset] },
    ],
  },
  {
    id: "decks",
    title: () => t("nav.decks"),
    items: [
      { label: () => tr("studying-study-now"), keys: ["Enter"] },
      { label: () => trLabel("qt-misc-create-filtered-deck"), keys: [...GLOBAL_KEYS.createFiltered] },
      { label: () => tr("undo-undo"), keys: [...GLOBAL_KEYS.undo] },
      { label: () => tr("undo-redo"), keys: [...GLOBAL_KEYS.redo] },
    ],
  },
  {
    id: "overview",
    title: () => ts("deckOverview"),
    items: [
      { label: () => tr("studying-study-now"), keys: ["S"] },
      { label: () => tr("actions-options"), keys: ["O"] },
      { label: () => tr("actions-custom-study"), keys: ["C"] },
      { label: () => tr("actions-rebuild"), keys: ["R"] },
      { label: () => tr("studying-empty"), keys: ["E"] },
      { label: () => ts("browseDeck"), keys: ["B"] },
    ],
  },
  {
    id: "study",
    title: () => t("settings.study"),
    items: [
      { label: () => tr("studying-show-answer"), keys: ["Space", "Enter"] },
      { label: () => tr("studying-again"), keys: ["1"] },
      { label: () => tr("studying-hard"), keys: ["2"] },
      { label: () => tr("studying-good"), keys: ["3", "Space"] },
      { label: () => tr("studying-easy"), keys: ["4"] },
      { label: () => tr("undo-undo"), keys: ["Ctrl+Z"] },
      { label: () => tr("undo-redo"), keys: [...GLOBAL_KEYS.redo] },
      { label: () => tr("studying-edit"), keys: ["E"] },
      { label: () => tr("actions-card-info"), keys: ["I"] },
      { label: () => tr("actions-replay-audio"), keys: ["R", "F5"] },
      { label: () => tr("studying-mark-note"), keys: ["*"] },
      { label: () => tr("studying-flag-card"), keys: ["Ctrl+1"] },
      { label: () => tr("studying-bury-card"), keys: ["-"] },
      { label: () => tr("studying-bury-note"), keys: ["="] },
      { label: () => tr("actions-suspend-card"), keys: ["@"] },
      { label: () => tr("studying-suspend-note"), keys: ["!"] },
      { label: () => tr("studying-delete-note"), keys: ["Ctrl+Delete"] },
      { label: () => ts("leaveStudy"), keys: ["Esc"] },
    ],
  },
  {
    id: "browse",
    title: () => t("nav.browse"),
    items: browseOrder
      .filter((id) => SHORTCUTS[id] && browseLabels[id])
      .map((id) => ({ label: browseLabels[id]!, keys: [SHORTCUTS[id]!] })),
  },
  {
    id: "editor",
    title: () => ts("editor"),
    items: [
      { label: () => ts("addNote"), keys: ["Ctrl+Enter"] },
      { label: () => ts("chooseNotetype"), keys: ["Ctrl+N"] },
      { label: () => ts("chooseDeck"), keys: ["Ctrl+D"] },
      { label: () => ts("tagsField"), keys: ["Ctrl+Shift+T"] },
      { label: () => ts("nextField"), keys: ["Tab"] },
      { label: () => tr("editing-bold-text"), keys: ["Ctrl+B"] },
      { label: () => tr("editing-italic-text"), keys: ["Ctrl+I"] },
      { label: () => tr("editing-underline-text"), keys: ["Ctrl+U"] },
      { label: () => tr("editing-cloze-deletion"), keys: ["Ctrl+Shift+C"] },
      { label: () => tr("editing-attach-picturesaudiovideo"), keys: ["F3"] },
    ],
  },
];

export interface ResolvedSection {
  id: ShortcutSection["id"];
  title: string;
  items: { label: string; keys: string[] }[];
}

/** Resolves the labels and keeps the items (and sections) that match the query. */
export function filterSections(sections: ResolvedSection[], query: string): ResolvedSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.label.toLowerCase().includes(q) || item.keys.some((k) => k.toLowerCase() === q),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export function resolveSections(sections: ShortcutSection[] = SECTIONS): ResolvedSection[] {
  return sections.map((s) => ({ id: s.id, title: s.title(), items: s.items.map((i) => ({ label: i.label(), keys: i.keys })) }));
}

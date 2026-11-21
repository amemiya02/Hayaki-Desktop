// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The browser's shortcuts, as in Anki's `aqt/forms/browser.ui`. */

export type ActionId =
  | "changeDeck"
  | "setDue"
  | "forget"
  | "reposition"
  | "toggleSuspend"
  | "toggleBury"
  | "addTags"
  | "removeTags"
  | "toggleMark"
  | "findReplace"
  | "delete"
  | "preview"
  | "toggleMode"
  | "selectAll"
  | "invert"
  | "undo"
  | "redo"
  | "toggleFilters"
  | "focusSearch"
  | "focusTable"
  | "focusEditor"
  | "next"
  | "prev"
  | "addNotes"
  | "cardInfo"
  | "changeNotetype"
  | "createFiltered"
  | "exportNotes"
  | `flag${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

export const SHORTCUTS: Partial<Record<ActionId, string>> = {
  changeDeck: "Ctrl+D",
  setDue: "Ctrl+Shift+D",
  forget: "Ctrl+Alt+N",
  reposition: "Ctrl+Shift+S",
  toggleSuspend: "Ctrl+J",
  toggleBury: "Ctrl+Shift+J",
  addTags: "Ctrl+Shift+A",
  removeTags: "Ctrl+Alt+Shift+A",
  toggleMark: "Ctrl+K",
  findReplace: "Ctrl+Alt+F",
  delete: "Ctrl+Del",
  preview: "Ctrl+Shift+P",
  toggleMode: "Ctrl+Alt+T",
  selectAll: "Ctrl+Alt+A",
  invert: "Ctrl+Alt+S",
  undo: "Ctrl+Z",
  redo: "Ctrl+Shift+Z",
  toggleFilters: "Ctrl+Shift+R",
  focusSearch: "Ctrl+F",
  focusTable: "Ctrl+Shift+L",
  focusEditor: "Ctrl+Shift+N",
  next: "Ctrl+N",
  prev: "Ctrl+P",
  addNotes: "Ctrl+E",
  cardInfo: "Ctrl+Shift+I",
  changeNotetype: "Ctrl+Shift+M",
  createFiltered: "Ctrl+G",
  exportNotes: "Ctrl+Shift+E",
  flag1: "Ctrl+1",
  flag2: "Ctrl+2",
  flag3: "Ctrl+3",
  flag4: "Ctrl+4",
  flag5: "Ctrl+5",
  flag6: "Ctrl+6",
  flag7: "Ctrl+7",
};

const BY_CHORD = new Map(Object.entries(SHORTCUTS).map(([id, chord]) => [chord, id as ActionId]));

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The chord a key event spells, such as `Ctrl+Shift+D`, read from the physical key. */
export function chordOf(e: KeyLike): string {
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^(Digit|Numpad)\d$/.test(e.code)) key = e.code.slice(-1);
  else if (e.key === "Delete") key = "Del";
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function actionForKey(e: KeyLike): ActionId | null {
  return BY_CHORD.get(chordOf(e)) ?? null;
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's main-window chords that do not belong to one screen: full screen,
 * zoom, undo and redo, and the Study Deck chooser (`aqt/main.py`,
 * `forms/main.ui`). Matching is pure so it can be tested; `WindowHost` runs
 * the action.
 */
export type ChordAction = "fullscreen" | "zoomIn" | "zoomOut" | "zoomReset" | "undo" | "redo" | "studyDeck";

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export function chordAction(e: KeyLike): ChordAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // F11 on Windows and Linux; Ctrl+Cmd+F on macOS.
  if (e.key === "F11" && !mod && !e.altKey) return "fullscreen";
  if (e.ctrlKey && e.metaKey && !e.altKey && key === "f") return "fullscreen";
  if (mod && !e.altKey) {
    if (key === "=" || key === "+") return "zoomIn";
    if (key === "-" || key === "_") return "zoomOut";
    if (key === "0") return "zoomReset";
    if (key === "z") return e.shiftKey ? "redo" : "undo";
    if (key === "y" && !e.shiftKey) return "redo";
    return null;
  }
  if (e.key === "/" && !mod && !e.altKey) return "studyDeck";
  return null;
}

/**
 * The screens where the window's own Undo and Redo apply. Every other screen
 * either handles the keys itself (Study, Browse, Add, Image Occlusion) or holds
 * unsaved local state that a collection undo would pull out from under it.
 */
export const UNDO_ROUTES: readonly string[] = ["decks", "deck", "stats"];
export const REDO_ROUTES: readonly string[] = [...UNDO_ROUTES, "study"];

export function chordAppliesOnRoute(action: "undo" | "redo", route: string): boolean {
  return (action === "undo" ? UNDO_ROUTES : REDO_ROUTES).includes(route);
}

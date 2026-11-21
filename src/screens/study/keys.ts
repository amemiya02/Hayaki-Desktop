// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The reviewer's keys, as Anki binds them in `Reviewer._shortcutKeys`, turned
 * into one command each. Letter chords with Alt match the physical key, since
 * Option changes the character on macOS.
 */
import type { Phase } from "@/lib/study/session";

export type StudyCommand =
  | { id: "leave" }
  | { id: "menu" }
  | { id: "reveal" }
  | { id: "answer"; ease: 1 | 2 | 3 | 4 }
  | { id: "undo" }
  | { id: "flag"; flag: number }
  | { id: "deleteNote" }
  | { id: "replay" }
  | { id: "mark" }
  | { id: "bury"; scope: "card" | "note" }
  | { id: "suspend"; scope: "card" | "note" }
  | { id: "edit" }
  | { id: "cardInfo" }
  | { id: "previousCardInfo" }
  | { id: "options" }
  | { id: "setDue" }
  | { id: "forget" }
  | { id: "createCopy" }
  | { id: "pauseAudio" }
  | { id: "seek"; secs: number }
  | { id: "recordVoice" }
  | { id: "replayVoice" }
  | { id: "toggleAutoAdvance" };

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Anki seeks five seconds with 6 and 7. */
export const SEEK_SECS = 5;

/** The chord each command shows in menus and the shortcuts sheet. */
export const STUDY_KEYS = {
  edit: "E",
  menu: "M",
  cardInfo: "I",
  previousCardInfo: "Ctrl+Alt+I",
  options: "O",
  setDue: "Ctrl+Shift+D",
  forget: "Ctrl+Alt+N",
  createCopy: "Ctrl+Alt+E",
  pauseAudio: "5",
  seekBack: "6",
  seekForward: "7",
  recordVoice: "Shift+V",
  replayVoice: "V",
  toggleAutoAdvance: "Shift+A",
  undo: "U",
} as const;

const plain: Record<string, StudyCommand> = {
  r: { id: "replay" },
  F5: { id: "replay" },
  "*": { id: "mark" },
  "-": { id: "bury", scope: "card" },
  "=": { id: "bury", scope: "note" },
  "@": { id: "suspend", scope: "card" },
  "!": { id: "suspend", scope: "note" },
  e: { id: "edit" },
  i: { id: "cardInfo" },
  o: { id: "options" },
  m: { id: "menu" },
  u: { id: "undo" },
  v: { id: "replayVoice" },
  "5": { id: "pauseAudio" },
  "6": { id: "seek", secs: -SEEK_SECS },
  "7": { id: "seek", secs: SEEK_SECS },
};

const modAlt: Record<string, StudyCommand> = {
  KeyN: { id: "forget" },
  KeyE: { id: "createCopy" },
  KeyI: { id: "previousCardInfo" },
};

export function commandFor(e: KeyLike, phase: Phase): StudyCommand | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") return { id: "leave" };
  if (mod && e.altKey) return modAlt[e.code] ?? null;
  if (mod && e.shiftKey && e.code === "KeyD") return { id: "setDue" };
  if (mod && !e.shiftKey && e.code === "KeyZ") return { id: "undo" };
  if (mod && /^Digit[0-7]$/.test(e.code)) return { id: "flag", flag: Number(e.code.slice(5)) };
  if (mod && (e.key === "Delete" || e.key === "Backspace")) return { id: "deleteNote" };
  if (mod || e.altKey) return null;

  if (e.key === " " || e.key === "Enter") {
    if (phase === "question") return { id: "reveal" };
    if (phase === "answer") return { id: "answer", ease: 3 };
    return null;
  }
  if (/^[1-4]$/.test(e.key)) return phase === "answer" ? { id: "answer", ease: Number(e.key) as 1 | 2 | 3 | 4 } : null;
  if (e.shiftKey && e.code === "KeyA") return { id: "toggleAutoAdvance" };
  if (e.shiftKey && e.code === "KeyV") return { id: "recordVoice" };
  return plain[e.key] ?? null;
}

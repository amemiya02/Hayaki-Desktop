// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Commands plugins register for the command palette. A command may carry a
 * shortcut, limited to Ctrl+Alt (optionally with Shift) and a letter or
 * digit, and never one Hayaki, Anki or macOS already uses. As everywhere in
 * Hayaki, Ctrl is Cmd on macOS (`chordOf` reads either), so Ctrl+Alt+H is
 * Cmd+Option+H there.
 */
import { SHORTCUTS, chordOf, type KeyLike } from "@/screens/browse/keys";
import { STUDY_KEYS } from "@/screens/study/keys";
import { GLOBAL_KEYS } from "@/shell/shortcuts";

const SHORTCUT = /^Ctrl\+Alt\+(Shift\+)?[A-Z0-9]$/;

/** Cmd+Option chords macOS keeps: Hide Others, Minimize All, Close All, Web Inspector, Dock. */
const MACOS_KEYS = ["Ctrl+Alt+H", "Ctrl+Alt+M", "Ctrl+Alt+W", "Ctrl+Alt+I", "Ctrl+Alt+D"];

// Reserved on every platform, so a plugin's shortcut works the same everywhere.
const reserved = new Set<string>(
  [...Object.values(GLOBAL_KEYS).flat(), ...Object.values(SHORTCUTS), ...Object.values(STUDY_KEYS), ...MACOS_KEYS].map(String),
);

/** The shortcut in Hayaki's chord spelling, or null when a plugin may not use it. */
export function pluginShortcut(chord: string): string | null {
  const parts = chord.split("+").map((p) => p.trim());
  const key = parts.pop()?.toUpperCase() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const ctrl = mods.delete("ctrl") || mods.delete("cmd") || mods.delete("cmdorctrl");
  const alt = mods.delete("alt");
  const shift = mods.delete("shift");
  if (mods.size > 0 || !ctrl || !alt) return null;
  const normal = ["Ctrl", "Alt", ...(shift ? ["Shift"] : []), key].join("+");
  return SHORTCUT.test(normal) && !reserved.has(normal) ? normal : null;
}

export function matchesShortcut(shortcut: string, e: KeyLike): boolean {
  return chordOf(e) === shortcut;
}

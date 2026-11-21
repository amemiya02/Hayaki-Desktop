// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Keyboard chords as the user reads them: `Ctrl` is the primary modifier, shown as Command on macOS. */
import { platformOf } from "@/lib/useAppearance";

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

const MAC_GLYPH: Record<string, string> = { Ctrl: "\u2318", Cmd: "\u2318", Shift: "\u21E7", Alt: "\u2325", Control: "\u2303" };
/** Apple's modifier order: Control, Option, Shift, Command. */
const MAC_MOD_ORDER = ["Control", "Alt", "Shift", "Cmd"];

/**
 * The keys of a chord as this platform writes them. Chords are written with
 * `Ctrl` meaning the primary modifier, so macOS shows it as Command. A chord
 * that also names `Cmd` uses `Ctrl` for the real Control key.
 */
export function displayKeys(chord: string, mac: boolean = isMacPlatform()): string[] {
  const keys = splitChord(chord);
  if (!mac) return keys;
  const hasCmd = keys.includes("Cmd");
  const norm = keys.map((k) => (k === "Ctrl" ? (hasCmd ? "Control" : "Cmd") : k));
  const mods = MAC_MOD_ORDER.filter((m) => norm.includes(m));
  const rest = norm.filter((k) => !MAC_MOD_ORDER.includes(k));
  return [...mods.map((m) => MAC_GLYPH[m]), ...rest];
}

/** A chord as this platform writes it: `Ctrl+Shift+I` is `\u21E7\u2318I` on macOS. */
export function displayChord(chord: string, mac: boolean = isMacPlatform()): string {
  return mac ? displayKeys(chord, true).join("") : chord;
}

/** A label with its chord in parentheses, such as `Bold (Ctrl+B)`. */
export function withChord(label: string, chord: string | undefined, mac: boolean = isMacPlatform()): string {
  return chord ? `${label} (${displayChord(chord, mac)})` : label;
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && platformOf(navigator.userAgent) === "mac";
}

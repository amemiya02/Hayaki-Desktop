// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The Study Deck chooser's rules, from upstream `aqt/studydeck.py`. */

/** Every space-separated word of the filter must appear in the name, in any order. */
export function matchesDeck(name: string, filter: string): boolean {
  const lower = name.toLowerCase();
  return filter
    .toLowerCase()
    .split(" ")
    .every((word) => lower.includes(word));
}

/** The row to select after the list changes: the focused name when it is listed, else the first. */
export function initialRow(names: readonly string[], focus: string | null): number {
  const index = focus === null ? -1 : names.indexOf(focus);
  return index >= 0 ? index : 0;
}

/** Up and Down wrap around the list, as in upstream. */
export function moveRow(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** Ctrl+1 to Ctrl+9 jump to a row, when the list has it. */
export function rowForDigit(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const row = Number(key) - 1;
  return row < count ? row : null;
}

/** The name the Add button starts from: the selected Deck's (to nest under it), else the filter text. */
export function newDeckDefault(names: readonly string[], row: number, filter: string): string {
  return row >= 0 && row < names.length ? names[row] : filter;
}

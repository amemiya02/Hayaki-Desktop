// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Table selection, kept as ids so it survives re-sorting and re-searching.
 * `current` is the row with keyboard focus (Anki's current card), `anchor`
 * the row a Shift range starts from.
 */
export interface Selection {
  selected: ReadonlySet<bigint>;
  current: bigint | null;
  anchor: bigint | null;
}

export const emptySelection: Selection = { selected: new Set(), current: null, anchor: null };

export interface ClickModifiers {
  shift: boolean;
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  toggle: boolean;
}

function range(ids: readonly bigint[], from: number, to: number): Set<bigint> {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return new Set(ids.slice(a, b + 1));
}

/** The selection after a click on the row at `index`. */
export function clickRow(sel: Selection, ids: readonly bigint[], index: number, mods: ClickModifiers): Selection {
  const id = ids[index];
  if (id === undefined) return sel;
  if (mods.shift) {
    const anchorIndex = sel.anchor !== null ? ids.indexOf(sel.anchor) : -1;
    const from = anchorIndex >= 0 ? anchorIndex : index;
    const span = range(ids, from, index);
    if (mods.toggle) {
      const selected = new Set(sel.selected);
      for (const each of span) selected.add(each);
      return { selected, current: id, anchor: ids[from] };
    }
    return { selected: span, current: id, anchor: ids[from] };
  }
  if (mods.toggle) {
    const selected = new Set(sel.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { selected, current: id, anchor: id };
  }
  return { selected: new Set([id]), current: id, anchor: id };
}

/** A right click keeps a selection it lands in, and otherwise selects the row. */
export function contextRow(sel: Selection, ids: readonly bigint[], index: number): Selection {
  const id = ids[index];
  if (id === undefined) return sel;
  if (sel.selected.has(id)) return { ...sel, current: id };
  return { selected: new Set([id]), current: id, anchor: id };
}

/** Moves the current row by `delta` rows (clamped); Shift extends from the anchor. */
export function moveCursor(sel: Selection, ids: readonly bigint[], delta: number, extend: boolean): Selection {
  if (ids.length === 0) return emptySelection;
  const currentIndex = sel.current !== null ? ids.indexOf(sel.current) : -1;
  const start = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : ids.length;
  const next = Math.max(0, Math.min(ids.length - 1, start + delta));
  const id = ids[next];
  if (extend) {
    const anchorIndex = sel.anchor !== null ? ids.indexOf(sel.anchor) : -1;
    const from = anchorIndex >= 0 ? anchorIndex : next;
    return { selected: range(ids, from, next), current: id, anchor: ids[from] };
  }
  return { selected: new Set([id]), current: id, anchor: id };
}

export function selectAll(sel: Selection, ids: readonly bigint[]): Selection {
  if (ids.length === 0) return emptySelection;
  return { selected: new Set(ids), current: sel.current ?? ids[0], anchor: sel.anchor ?? ids[0] };
}

export function invertSelection(sel: Selection, ids: readonly bigint[]): Selection {
  const selected = new Set(ids.filter((id) => !sel.selected.has(id)));
  const current = sel.current !== null && selected.has(sel.current) ? sel.current : (selected.values().next().value ?? null);
  return { selected, current, anchor: current };
}

/** Keeps only the ids still present after a new search. */
export function intersect(sel: Selection, ids: readonly bigint[]): Selection {
  if (sel.selected.size === 0) return sel;
  const present = new Set(ids);
  const selected = new Set([...sel.selected].filter((id) => present.has(id)));
  const current = sel.current !== null && present.has(sel.current) ? sel.current : (selected.values().next().value ?? null);
  const anchor = sel.anchor !== null && present.has(sel.anchor) ? sel.anchor : current;
  return { selected, current, anchor };
}

/** Selected ids in table order. */
export function orderedSelection(sel: Selection, ids: readonly bigint[]): bigint[] {
  if (sel.selected.size === 0) return [];
  if (sel.selected.size === ids.length) return [...ids];
  return ids.filter((id) => sel.selected.has(id));
}

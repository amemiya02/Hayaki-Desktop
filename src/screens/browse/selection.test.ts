// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import {
  clickRow,
  contextRow,
  emptySelection,
  intersect,
  invertSelection,
  moveCursor,
  orderedSelection,
  selectAll,
  type Selection,
} from "./selection";

const ids = [10n, 20n, 30n, 40n, 50n];
const plain = { shift: false, toggle: false };
const sorted = (s: Selection) => [...s.selected].sort((a, b) => (a < b ? -1 : 1));

describe("clickRow", () => {
  it("selects one row on a plain click", () => {
    const s = clickRow(emptySelection, ids, 2, plain);
    expect(sorted(s)).toEqual([30n]);
    expect(s.current).toBe(30n);
    expect(s.anchor).toBe(30n);
  });

  it("selects a range from the anchor with Shift", () => {
    const a = clickRow(emptySelection, ids, 1, plain);
    const b = clickRow(a, ids, 3, { shift: true, toggle: false });
    expect(sorted(b)).toEqual([20n, 30n, 40n]);
    expect(b.anchor).toBe(20n);
    // Shift-clicking above the anchor flips the range and keeps the anchor.
    const c = clickRow(b, ids, 0, { shift: true, toggle: false });
    expect(sorted(c)).toEqual([10n, 20n]);
    expect(c.anchor).toBe(20n);
  });

  it("toggles one row with Ctrl", () => {
    const a = clickRow(emptySelection, ids, 0, plain);
    const b = clickRow(a, ids, 2, { shift: false, toggle: true });
    expect(sorted(b)).toEqual([10n, 30n]);
    const c = clickRow(b, ids, 0, { shift: false, toggle: true });
    expect(sorted(c)).toEqual([30n]);
  });

  it("adds a range with Ctrl+Shift", () => {
    let s = clickRow(emptySelection, ids, 0, plain);
    s = clickRow(s, ids, 3, { shift: false, toggle: true });
    s = clickRow(s, ids, 4, { shift: true, toggle: true });
    expect(sorted(s)).toEqual([10n, 40n, 50n]);
  });
});

describe("contextRow", () => {
  it("keeps a selection the click lands in", () => {
    const s = selectAll(emptySelection, ids);
    const c = contextRow(s, ids, 3);
    expect(c.selected.size).toBe(5);
    expect(c.current).toBe(40n);
  });

  it("selects an unselected row", () => {
    const s = clickRow(emptySelection, ids, 0, plain);
    expect(sorted(contextRow(s, ids, 4))).toEqual([50n]);
  });
});

describe("moveCursor", () => {
  it("moves and clamps", () => {
    let s = moveCursor(emptySelection, ids, 1, false);
    expect(s.current).toBe(10n);
    s = moveCursor(s, ids, 10, false);
    expect(s.current).toBe(50n);
    s = moveCursor(s, ids, -100, false);
    expect(s.current).toBe(10n);
  });

  it("extends from the anchor with Shift", () => {
    let s = clickRow(emptySelection, ids, 2, plain);
    s = moveCursor(s, ids, 1, true);
    s = moveCursor(s, ids, 1, true);
    expect(sorted(s)).toEqual([30n, 40n, 50n]);
    s = moveCursor(s, ids, -3, true);
    expect(sorted(s)).toEqual([20n, 30n]);
  });

  it("starts from the end when moving up with nothing current", () => {
    expect(moveCursor(emptySelection, ids, -1, false).current).toBe(50n);
  });

  it("returns an empty selection for an empty list", () => {
    expect(moveCursor(emptySelection, [], 1, false)).toBe(emptySelection);
  });
});

describe("whole selections", () => {
  it("inverts", () => {
    const s = clickRow(emptySelection, ids, 1, plain);
    const inv = invertSelection(s, ids);
    expect(sorted(inv)).toEqual([10n, 30n, 40n, 50n]);
    expect(inv.current).toBe(10n);
  });

  it("intersects with a new result", () => {
    let s = clickRow(emptySelection, ids, 1, plain);
    s = clickRow(s, ids, 3, { shift: false, toggle: true });
    const kept = intersect(s, [40n, 60n]);
    expect(sorted(kept)).toEqual([40n]);
    expect(kept.current).toBe(40n);
  });

  it("orders the selection like the table", () => {
    let s = clickRow(emptySelection, ids, 4, plain);
    s = clickRow(s, ids, 0, { shift: false, toggle: true });
    expect(orderedSelection(s, ids)).toEqual([10n, 50n]);
  });
});

import { describe, expect, it } from "vitest";

import { initialRow, matchesDeck, moveRow, newDeckDefault, rowForDigit } from "./study-deck";

describe("Study Deck chooser", () => {
  it("matches every word of the filter in any order, ignoring case", () => {
    expect(matchesDeck("Japanese::Vocabulary", "vocab jap")).toBe(true);
    expect(matchesDeck("Japanese::Vocabulary", "vocab french")).toBe(false);
    expect(matchesDeck("Japanese", "")).toBe(true);
  });

  it("starts on the current Deck when listed, else the first row", () => {
    expect(initialRow(["A", "B", "C"], "B")).toBe(1);
    expect(initialRow(["A", "B"], "Z")).toBe(0);
    expect(initialRow(["A"], null)).toBe(0);
  });

  it("wraps Up and Down, and has no row in an empty list", () => {
    expect(moveRow(0, -1, 3)).toBe(2);
    expect(moveRow(2, 1, 3)).toBe(0);
    expect(moveRow(0, 1, 0)).toBe(-1);
  });

  it("jumps with Ctrl+digit only to rows that exist", () => {
    expect(rowForDigit("1", 3)).toBe(0);
    expect(rowForDigit("3", 3)).toBe(2);
    expect(rowForDigit("4", 3)).toBeNull();
    expect(rowForDigit("0", 3)).toBeNull();
    expect(rowForDigit("a", 3)).toBeNull();
  });

  it("starts a new Deck's name from the selection, else the filter", () => {
    expect(newDeckDefault(["A", "B"], 1, "x")).toBe("B");
    expect(newDeckDefault([], -1, "French")).toBe("French");
  });
});

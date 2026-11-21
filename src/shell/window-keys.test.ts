import { describe, expect, it } from "vitest";

import { chordAction, chordAppliesOnRoute, type KeyLike } from "./window-keys";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("window chords", () => {
  it("toggles full screen with F11 and Ctrl+Cmd+F, leaving Ctrl+F to search", () => {
    expect(chordAction(key("F11"))).toBe("fullscreen");
    expect(chordAction(key("f", { ctrlKey: true, metaKey: true }))).toBe("fullscreen");
    expect(chordAction(key("f", { ctrlKey: true }))).toBeNull();
  });

  it("zooms with Ctrl or Cmd and = + - 0", () => {
    expect(chordAction(key("=", { ctrlKey: true }))).toBe("zoomIn");
    expect(chordAction(key("+", { metaKey: true, shiftKey: true }))).toBe("zoomIn");
    expect(chordAction(key("-", { ctrlKey: true }))).toBe("zoomOut");
    expect(chordAction(key("0", { metaKey: true }))).toBe("zoomReset");
    expect(chordAction(key("-"))).toBeNull();
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y", () => {
    expect(chordAction(key("z", { ctrlKey: true }))).toBe("undo");
    expect(chordAction(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(chordAction(key("y", { metaKey: true }))).toBe("redo");
    expect(chordAction(key("y"))).toBeNull();
  });

  it("opens Study Deck on a bare slash only", () => {
    expect(chordAction(key("/"))).toBe("studyDeck");
    expect(chordAction(key("/", { ctrlKey: true }))).toBeNull();
    expect(chordAction(key("?", { shiftKey: true }))).toBeNull();
  });
});

describe("undo and redo routes", () => {
  it("apply on decks, deck overview and stats only", () => {
    for (const route of ["decks", "deck", "stats"]) {
      expect(chordAppliesOnRoute("undo", route)).toBe(true);
      expect(chordAppliesOnRoute("redo", route)).toBe(true);
    }
    for (const route of ["image-occlusion", "deck-options", "notetype", "notetypes", "change-notetype", "import-csv", "settings", "browse", "add"]) {
      expect(chordAppliesOnRoute("undo", route)).toBe(false);
      expect(chordAppliesOnRoute("redo", route)).toBe(false);
    }
  });

  it("leaves Study's undo to Study but redoes there", () => {
    expect(chordAppliesOnRoute("undo", "study")).toBe(false);
    expect(chordAppliesOnRoute("redo", "study")).toBe(true);
  });
});

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { commandFor, type KeyLike } from "./keys";

function key(k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe("reviewer keys", () => {
  it("reveals with Space or Enter, then answers Good with them", () => {
    expect(commandFor(key(" ", "Space"), "question")).toEqual({ id: "reveal" });
    expect(commandFor(key("Enter", "Enter"), "question")).toEqual({ id: "reveal" });
    expect(commandFor(key(" ", "Space"), "answer")).toEqual({ id: "answer", ease: 3 });
  });

  it("answers with 1 to 4 only on the answer side", () => {
    expect(commandFor(key("1", "Digit1"), "answer")).toEqual({ id: "answer", ease: 1 });
    expect(commandFor(key("4", "Digit4"), "answer")).toEqual({ id: "answer", ease: 4 });
    expect(commandFor(key("1", "Digit1"), "question")).toBeNull();
  });

  it("binds Anki's chords", () => {
    expect(commandFor(key("D", "KeyD", { ctrlKey: true, shiftKey: true }), "question")).toEqual({ id: "setDue" });
    expect(commandFor(key("n", "KeyN", { ctrlKey: true, altKey: true }), "answer")).toEqual({ id: "forget" });
    expect(commandFor(key("e", "KeyE", { ctrlKey: true, altKey: true }), "answer")).toEqual({ id: "createCopy" });
    expect(commandFor(key("i", "KeyI", { ctrlKey: true, altKey: true }), "answer")).toEqual({ id: "previousCardInfo" });
    expect(commandFor(key("3", "Digit3", { ctrlKey: true }), "question")).toEqual({ id: "flag", flag: 3 });
    expect(commandFor(key("z", "KeyZ", { metaKey: true }), "question")).toEqual({ id: "undo" });
  });

  it("matches Option chords on macOS by the physical key", () => {
    // Cmd+Option+N types "˜" on a US layout.
    expect(commandFor(key("˜", "KeyN", { metaKey: true, altKey: true }), "answer")).toEqual({ id: "forget" });
  });

  it("binds the single keys", () => {
    expect(commandFor(key("o", "KeyO"), "question")).toEqual({ id: "options" });
    expect(commandFor(key("u", "KeyU"), "question")).toEqual({ id: "undo" });
    expect(commandFor(key("5", "Digit5"), "answer")).toEqual({ id: "pauseAudio" });
    expect(commandFor(key("6", "Digit6"), "answer")).toEqual({ id: "seek", secs: -5 });
    expect(commandFor(key("7", "Digit7"), "answer")).toEqual({ id: "seek", secs: 5 });
    expect(commandFor(key("v", "KeyV"), "answer")).toEqual({ id: "replayVoice" });
    expect(commandFor(key("V", "KeyV", { shiftKey: true }), "answer")).toEqual({ id: "recordVoice" });
    expect(commandFor(key("A", "KeyA", { shiftKey: true }), "answer")).toEqual({ id: "toggleAutoAdvance" });
    expect(commandFor(key("e", "KeyE"), "answer")).toEqual({ id: "edit" });
    expect(commandFor(key("m", "KeyM"), "answer")).toEqual({ id: "menu" });
  });

  it("leaves other chords to the app", () => {
    expect(commandFor(key("o", "KeyO", { ctrlKey: true }), "question")).toBeNull();
    expect(commandFor(key("a", "KeyA"), "question")).toBeNull();
  });
});

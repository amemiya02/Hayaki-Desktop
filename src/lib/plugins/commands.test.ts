// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { matchesShortcut, pluginShortcut } from "./commands";

describe("plugin shortcuts", () => {
  it("accepts Ctrl+Alt chords that nothing else uses", () => {
    expect(pluginShortcut("Ctrl+Alt+K")).toBe("Ctrl+Alt+K");
    // The sample plugin's shortcut.
    expect(pluginShortcut("Ctrl+Alt+R")).toBe("Ctrl+Alt+R");
    expect(pluginShortcut("alt+cmd+shift+k")).toBe("Ctrl+Alt+Shift+K");
  });

  it("refuses single keys, other modifiers and Anki's own chords", () => {
    for (const chord of ["K", "Ctrl+K", "Alt+K", "Ctrl+Shift+K", "Ctrl+Alt+F", "Ctrl+Alt+N", "Ctrl+Alt+I", "Ctrl+Alt+Meta+K", "Ctrl+Alt+F5", "Cmd+Alt+H", "Ctrl+Alt+M", "Ctrl+Alt+W"]) {
      expect(pluginShortcut(chord), chord).toBeNull();
    }
  });

  it("matches the physical key", () => {
    const e = { key: "˚", code: "KeyK", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false };
    expect(matchesShortcut("Ctrl+Alt+K", e)).toBe(true);
    expect(matchesShortcut("Ctrl+Alt+Shift+K", e)).toBe(false);
  });
});

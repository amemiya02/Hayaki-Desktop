import { describe, expect, it } from "vitest";

import { actionForKey } from "./keys";

const press = (key: string, code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  actionForKey({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("browser shortcuts", () => {
  it("maps Anki's Grade Now, Create Copy and Go keys", () => {
    expect(press("G", "KeyG", { ctrlKey: true, shiftKey: true })).toBe("gradeNow");
    expect(press("e", "KeyE", { ctrlKey: true, altKey: true })).toBe("createCopy");
    expect(press("Home", "Home")).toBe("firstCard");
    expect(press("End", "End")).toBe("lastCard");
  });

  it("zooms with Ctrl and equals, minus, zero, and with Ctrl+Plus", () => {
    expect(press("=", "Equal", { ctrlKey: true })).toBe("zoomIn");
    expect(press("+", "Equal", { ctrlKey: true, shiftKey: true })).toBe("zoomIn");
    expect(press("-", "Minus", { ctrlKey: true })).toBe("zoomOut");
    expect(press("0", "Digit0", { ctrlKey: true })).toBe("zoomReset");
  });

  it("keeps Add Notes and Create Copy apart", () => {
    expect(press("e", "KeyE", { ctrlKey: true })).toBe("addNotes");
  });
});

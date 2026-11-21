// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { isClipboardBitmap, stripsFormatting } from "./paste";

describe("paste", () => {
  it("lets Shift invert the saved preference", () => {
    expect(stripsFormatting(false, false)).toBe(false);
    expect(stripsFormatting(true, false)).toBe(true);
    expect(stripsFormatting(false, true)).toBe(true);
    expect(stripsFormatting(true, true)).toBe(false);
  });

  it("re-encodes only bitmaps with a generic clipboard name", () => {
    expect(isClipboardBitmap(new File([], "image.png", { type: "image/png" }))).toBe(true);
    expect(isClipboardBitmap(new File([], "", { type: "image/png" }))).toBe(true);
    expect(isClipboardBitmap(new File([], "cat.png", { type: "image/png" }))).toBe(false);
    expect(isClipboardBitmap(new File([], "anim.gif", { type: "image/gif" }))).toBe(false);
  });
});

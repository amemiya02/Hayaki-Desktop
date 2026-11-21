// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { resizedWidth } from "./image-resize";

describe("resizedWidth", () => {
  const natural = { width: 400, height: 200 };
  it("follows a wider drag", () => {
    expect(resizedWidth(natural, { width: 300, height: 100 })).toBe(300);
  });
  it("follows a taller drag and keeps the aspect ratio", () => {
    expect(resizedWidth(natural, { width: 100, height: 150 })).toBe(300);
  });
  it("never shrinks below a few pixels", () => {
    expect(resizedWidth(natural, { width: 0, height: 0 })).toBe(10);
    expect(resizedWidth({ width: 100, height: 400 }, { width: 0, height: 0 })).toBe(5);
  });
});

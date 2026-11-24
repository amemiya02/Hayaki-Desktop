// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { downloadShare } from "./updates";

describe("downloadShare", () => {
  it("is unknown until the size is", () => {
    expect(downloadShare(100, null)).toBeNull();
    expect(downloadShare(100, 0)).toBeNull();
  });
  it("stays between 0 and 1", () => {
    expect(downloadShare(25, 100)).toBe(0.25);
    expect(downloadShare(150, 100)).toBe(1);
  });
});

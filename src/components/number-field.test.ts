// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { clampTo, parseNumber, placesOf, stepFrom } from "./number-field";

describe("NumberField arithmetic", () => {
  const range = { min: 0, max: 100, step: 1 };

  it("clamps to the range", () => {
    expect(clampTo(-4, range)).toBe(0);
    expect(clampTo(140, range)).toBe(100);
    expect(clampTo(42, range)).toBe(42);
  });

  it("steps by one, or ten with Shift, and stops at the ends", () => {
    expect(stepFrom(5, 1, range)).toBe(6);
    expect(stepFrom(5, -1, range, true)).toBe(0);
    expect(stepFrom(95, 1, range, true)).toBe(100);
  });

  it("keeps decimal steps exact", () => {
    const retention = { min: 0.7, max: 0.99, step: 0.01 };
    expect(placesOf(0.01)).toBe(2);
    expect(stepFrom(0.9, 1, retention)).toBe(0.91);
    expect(stepFrom(0.9, 1, retention, true)).toBe(0.99);
    expect(stepFrom(0.71, -1, retention, true)).toBe(0.7);
  });

  it("parses typed text, with a decimal comma", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" 0,9 ")).toBe(0.9);
    expect(parseNumber("")).toBeNaN();
    expect(parseNumber("12abc")).toBeNaN();
  });
});

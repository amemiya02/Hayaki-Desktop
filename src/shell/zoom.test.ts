import { describe, expect, it } from "vitest";

import { nextZoom, parseZoom, ZOOM_MAX, ZOOM_MIN } from "./zoom";

describe("zoom", () => {
  it("steps by a tenth without drifting", () => {
    let factor = 1;
    for (let i = 0; i < 3; i++) factor = nextZoom(factor, "in");
    expect(factor).toBe(1.3);
    for (let i = 0; i < 6; i++) factor = nextZoom(factor, "out");
    expect(factor).toBe(0.7);
  });

  it("stays in range and resets to 100%", () => {
    expect(nextZoom(ZOOM_MAX, "in")).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MIN, "out")).toBe(ZOOM_MIN);
    expect(nextZoom(2.4, "reset")).toBe(1);
    expect(nextZoom(Number.NaN, "in")).toBe(1.1);
  });

  it("ignores a stored value that is missing or out of range", () => {
    expect(parseZoom("1.3")).toBe(1.3);
    expect(parseZoom(null)).toBe(1);
    expect(parseZoom("abc")).toBe(1);
    expect(parseZoom("9")).toBe(1);
    expect(parseZoom("0.1")).toBe(1);
  });
});

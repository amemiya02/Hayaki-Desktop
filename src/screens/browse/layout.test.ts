import { describe, expect, it } from "vitest";

import { clampZoom, editorBelow, stepZoom, ZOOM_MAX, ZOOM_MIN } from "./layout";

describe("editorBelow", () => {
  it("follows the window shape in auto", () => {
    expect(editorBelow("auto", 900, 1200)).toBe(true);
    expect(editorBelow("auto", 1400, 900)).toBe(false);
    expect(editorBelow("auto", 0, 0)).toBe(false);
  });
  it("ignores the window shape when chosen", () => {
    expect(editorBelow("vertical", 1400, 900)).toBe(true);
    expect(editorBelow("horizontal", 900, 1200)).toBe(false);
  });
});

describe("zoom", () => {
  it("steps by a tenth without drifting", () => {
    let zoom = 1;
    for (let i = 0; i < 3; i++) zoom = stepZoom(zoom, 1);
    expect(zoom).toBe(1.3);
    expect(stepZoom(zoom, -1)).toBe(1.2);
  });
  it("stays within limits and resets", () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(stepZoom(1.7, 0)).toBe(1);
  });
  it("repairs a bad stored value", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
  });
});

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { bin, extent, nice, quantileSorted, range, tickIncrement, ticks } from "./scale";

// Expected values are d3-array 3.2.4 / d3-scale 4.0.2 outputs.
describe("ticks", () => {
  it("matches d3 for common domains", () => {
    expect(ticks(0, 10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ticks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks(-30, 1, 30)).toEqual(range(-30, 2, 1));
    expect(ticks(0, 365, 70)).toEqual(range(0, 370, 5));
    expect(ticks(-364, 1, 70)).toEqual(range(-360, 5, 5));
    expect(ticks(0, 31, 31)).toEqual(range(0, 32, 1));
    expect(ticks(0, 90, 70)).toEqual(range(0, 91, 1));
  });

  it("handles degenerate input", () => {
    expect(ticks(0, 10, 0)).toEqual([]);
    expect(ticks(5, 5, 10)).toEqual([5]);
    expect(ticks(10, 0, 5)).toEqual([10, 8, 6, 4, 2, 0]);
  });

  it("increments", () => {
    expect(tickIncrement(0, 10, 10)).toBe(1);
    expect(tickIncrement(0, 1, 10)).toBe(-10);
    expect(tickIncrement(120, 320, 10)).toBe(20);
  });
});

describe("nice", () => {
  it("rounds domains like scaleLinear().nice()", () => {
    expect(nice([0, 0.96])).toEqual([0, 1]);
    expect(nice([130, 301])).toEqual([120, 320]);
    expect(nice([0, 41])).toEqual([0, 45]);
    expect(nice([0, 101])).toEqual([0, 110]);
    expect(nice([3, 3])).toEqual([3, 3]);
  });
});

describe("bin", () => {
  it("drops thresholds outside the domain and keeps the last bin inclusive", () => {
    const bins = bin([0, 1, 2, 3, 4, 5], (x) => x, [0, 5], [0, 2, 4, 6]);
    expect(bins.map((b) => [b.x0, b.x1, b.items.length])).toEqual([
      [0, 2, 2],
      [2, 4, 2],
      [4, 5, 2],
    ]);
  });

  it("ignores values outside the domain", () => {
    const bins = bin([-1, 0, 10], (x) => x, [0, 5], [1, 2]);
    expect(bins.map((b) => b.items)).toEqual([[0], [], []]);
  });
});

describe("helpers", () => {
  it("quantile", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8);
    expect(quantileSorted([], 0.5)).toBeUndefined();
  });
  it("extent and range", () => {
    expect(extent([3, -1, 7])).toEqual([-1, 7]);
    expect(extent([])).toBeUndefined();
    expect(range(130, 135, 1)).toEqual([130, 131, 132, 133, 134]);
  });
});

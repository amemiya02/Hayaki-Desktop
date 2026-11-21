// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { movingAverage, pointAt, reviewPoints, runSummary, simulationSeries, smoothPoints, workloadPoints, workloadSeries, yDomain } from "./simulation";

describe("simulator data", () => {
  it("averages over a trailing window", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
    expect(movingAverage([1, 2], 1)).toEqual([1, 2]);
  });

  it("counts new cards as reviews", () => {
    const points = reviewPoints(
      { accumulatedKnowledgeAcquisition: [1, 2], dailyReviewCount: [3, 4], dailyNewCount: [1, 1], dailyTimeCost: [60, 90] },
      1,
    );
    expect(points).toEqual([
      { x: 0, timeCost: 60, count: 4, memorized: 1, label: 1 },
      { x: 1, timeCost: 90, count: 5, memorized: 2, label: 1 },
    ]);
  });

  it("smooths each run on its own", () => {
    const a = reviewPoints({ accumulatedKnowledgeAcquisition: [0, 0], dailyReviewCount: [2, 4], dailyNewCount: [0, 0], dailyTimeCost: [0, 0] }, 1);
    const b = reviewPoints({ accumulatedKnowledgeAcquisition: [0, 0], dailyReviewCount: [10, 20], dailyNewCount: [0, 0], dailyTimeCost: [0, 0] }, 2);
    const smoothed = smoothPoints([...a, ...b], 2);
    expect(smoothed.map((p) => p.count)).toEqual([2, 3, 10, 15]);
  });

  it("summarises a run like the legend", () => {
    const points = reviewPoints(
      { accumulatedKnowledgeAcquisition: [10, 15, 30], dailyReviewCount: [1, 2, 3], dailyNewCount: [0, 0, 0], dailyTimeCost: [1, 1, 1] },
      1,
    );
    const [count] = simulationSeries(points, "count");
    expect(runSummary(count, "count")).toEqual({ total: 6, average: 2 });
    const [memorized] = simulationSeries(points, "memorized");
    expect(runSummary(memorized, "memorized")).toEqual({ total: 20, average: 20 / 3 });
  });

  it("plots workload efficiency per hour", () => {
    const points = workloadPoints({ cost: { 70: 3600, 80: 7200 }, memorized: { 70: 110, 80: 150 }, reviewCount: { 70: 365, 80: 730 }, reviewlessEndMemorized: 10 }, 1, 365);
    const [ratio] = workloadSeries(points, "ratio");
    expect(ratio.points).toEqual([
      { x: 70, y: 100 },
      { x: 80, y: 70 },
    ]);
    const [count] = workloadSeries(points, "count");
    expect(count.points.map((p) => p.y)).toEqual([1, 2]);
  });

  it("finds the y range and the nearest point", () => {
    const series = [{ label: 1, points: [{ x: 0, y: 3 }, { x: 1, y: 97 }] }];
    expect(yDomain(series)).toEqual([0, 100]);
    expect(yDomain(series, 0)[0]).toBe(0);
    expect(yDomain([])).toEqual([0, 1]);
    expect(pointAt(series[0], 0.5)).toEqual({ x: 1, y: 97 });
  });
});

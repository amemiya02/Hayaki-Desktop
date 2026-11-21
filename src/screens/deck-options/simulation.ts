// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Data for the FSRS simulator, ported from upstream's SimulatorModal.svelte
 * and graphs/simulator.ts: the points each run adds, smoothing, and what
 * each graph plots.
 */
import { nice, ticks } from "@/screens/stats/scale";

export interface Point {
  x: number;
  timeCost: number;
  count: number;
  memorized: number;
  /** The run it belongs to, from 1. */
  label: number;
}

export interface WorkloadPoint extends Point {
  learnSpan: number;
  reviewlessEndMemorized: number;
}

/** What the simulator graph shows (upstream `SimulateSubgraph`). */
export type SimulateSubgraph = "count" | "time" | "memorized";
/** What the desired-retention graph shows (upstream `SimulateWorkloadSubgraph`). */
export type WorkloadSubgraph = "ratio" | "count" | "time" | "memorized";

export interface ReviewResult {
  accumulatedKnowledgeAcquisition: number[];
  dailyReviewCount: number[];
  dailyNewCount: number[];
  dailyTimeCost: number[];
}

export interface WorkloadResult {
  cost: { [dr: number]: number };
  memorized: { [dr: number]: number };
  reviewCount: { [dr: number]: number };
  reviewlessEndMemorized: number;
}

export function movingAverage(y: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < y.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
      sum += y[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
}

/** One point per simulated day: reviews include new cards. */
export function reviewPoints(resp: ReviewResult, label: number): Point[] {
  return resp.dailyTimeCost.map((timeCost, i) => ({
    x: i,
    timeCost,
    count: (resp.dailyReviewCount[i] ?? 0) + (resp.dailyNewCount[i] ?? 0),
    memorized: resp.accumulatedKnowledgeAcquisition[i] ?? 0,
    label,
  }));
}

/** One point per desired retention (70-99). */
export function workloadPoints(resp: WorkloadResult, label: number, learnSpan: number): WorkloadPoint[] {
  return Object.entries(resp.memorized).map(([dr, memorized]) => ({
    x: parseInt(dr),
    timeCost: resp.cost[Number(dr)] ?? 0,
    memorized,
    reviewlessEndMemorized: resp.reviewlessEndMemorized,
    count: resp.reviewCount[Number(dr)] ?? 0,
    label,
    learnSpan,
  }));
}

/** Smooths each run separately, as the modal does when "Smooth graph" is on. */
export function smoothPoints<T extends Point>(points: T[], windowSize: number): T[] {
  const groups = new Map<number, T[]>();
  for (const p of points) {
    const list = groups.get(p.label) ?? [];
    list.push(p);
    groups.set(p.label, list);
  }
  return [...groups.values()].flatMap((group) => {
    const timeCost = movingAverage(group.map((p) => p.timeCost), windowSize);
    const count = movingAverage(group.map((p) => p.count), windowSize);
    const memorized = movingAverage(group.map((p) => p.memorized), windowSize);
    return group.map((p, i) => ({ ...p, timeCost: timeCost[i], count: count[i], memorized: memorized[i] }));
  });
}

export interface Series {
  label: number;
  points: { x: number; y: number }[];
}

function bySeries<T extends Point>(points: T[], y: (p: T) => number): Series[] {
  const groups = new Map<number, { x: number; y: number }[]>();
  for (const p of points) {
    const list = groups.get(p.label) ?? [];
    list.push({ x: p.x, y: y(p) });
    groups.set(p.label, list);
  }
  return [...groups.entries()].map(([label, pts]) => ({ label, points: pts }));
}

export function simulationSeries(points: Point[], subgraph: SimulateSubgraph): Series[] {
  return bySeries(points, (p) => (subgraph === "count" ? p.count : subgraph === "time" ? p.timeCost : p.memorized));
}

export function workloadSeries(points: WorkloadPoint[], subgraph: WorkloadSubgraph): Series[] {
  return bySeries(points, (d) => {
    switch (subgraph) {
      case "ratio":
        return (60 * 60 * (d.memorized - d.reviewlessEndMemorized)) / d.timeCost;
      case "time":
        return d.timeCost / d.learnSpan;
      case "count":
        return d.count / d.learnSpan;
      case "memorized":
        return d.memorized;
    }
  });
}

/**
 * The y range: data minimum to maximum, made nice. The workload graph
 * includes zero (or the memorised-without-reviews line) as upstream's `y_min`.
 */
export function yDomain(series: Series[], floor = Infinity): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.y)) continue;
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  }
  lo = Math.min(lo, floor);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return nice([lo - 1, hi + 1], 5);
  return nice([lo, hi], 5);
}

export function yTicks(domain: [number, number], height: number): number[] {
  return ticks(domain[0], domain[1], height / 50);
}

/** Upstream's legend summary for a run: total and average per day. */
export function runSummary(series: Series, subgraph: SimulateSubgraph): { total: number; average: number } {
  const pts = series.points;
  const total = subgraph === "memorized" ? (pts.length ? pts[pts.length - 1].y - pts[0].y : 0) : pts.reduce((a, p) => a + p.y, 0);
  return { total, average: total / (pts.length || 1) };
}

/** The point of a series nearest to `x` (bisect left, as upstream). */
export function pointAt(series: Series, x: number): { x: number; y: number } | undefined {
  const pts = series.points;
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pts[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  return pts[lo];
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Bucketing for each Statistics graph, computed exactly as upstream's
 * `ts/routes/graphs/*.ts` does from the core's GraphsResponse. Everything here
 * is numbers and search strings; wording lives in the components.
 */
import type {
  GraphsResponse,
  GraphsResponse_ReviewCountsAndTimes_Reviews,
  GraphsResponse_TrueRetentionStats_TrueRetention,
} from "@/lib/anki/proto/anki/stats_pb";

import { bin, extent, nice, numericMap, quantileSorted, range as d3range, sum, ticks, type Bin } from "./scale";

/** Period a graph covers (upstream `GraphRange`). */
export type GraphRange = "month" | "threeMonths" | "year" | "all";

/** Amount of review history fetched (upstream `RevlogRange`). */
export type RevlogRange = "year" | "all";

export function daysToRevlogRange(days: number): RevlogRange {
  return days > 365 || days === 0 ? "all" : "year";
}

/** A histogram bin with its summed value. */
export interface HBin {
  x0: number;
  x1: number;
  /** Summed count (Cards, reviews) in the bin. */
  value: number;
  /** Number of source entries (days, Cards) that fell into the bin. */
  entries: number;
}

export interface Histogram {
  domain: [number, number];
  bins: HBin[];
  total: number;
  /** Draw the running-total line. */
  showArea: boolean;
}

type Entry = [number, number];

function mapBins(bins: Bin<Entry>[]): HBin[] {
  return bins.map((b) => ({ x0: b.x0, x1: b.x1, value: sum(b.items.map((e) => e[1])), entries: b.items.length }));
}

/** Running totals at each bin's end. */
export function cumulative(bins: HBin[]): number[] {
  let running = 0;
  return bins.map((b) => (running += b.value));
}

/* ------------------------------ Future due ------------------------------ */

export interface FutureDueData {
  dueCounts: Map<number, number>;
  haveBacklog: boolean;
  dailyLoad: number;
}

export function gatherFutureDue(data: GraphsResponse): FutureDueData {
  const msg = data.futureDue;
  return {
    dueCounts: numericMap(msg?.futureDue ?? {}),
    haveBacklog: msg?.haveBacklog ?? false,
    dailyLoad: msg?.dailyLoad ?? 0,
  };
}

export interface FutureDueResult {
  histogram: Histogram;
  /** The last bin's end is inclusive. */
  xMax: number;
  total: number;
  averagePerDay: number;
  dueTomorrow: number;
  dailyLoad: number;
}

export function buildFutureDue(source: FutureDueData, range: GraphRange, includeBacklog: boolean): FutureDueResult | null {
  const data = includeBacklog
    ? source.dueCounts
    : new Map([...source.dueCounts].filter(([day]) => day >= 0));
  const ext = extent(data.keys());
  if (!ext) return null;
  const xMin = includeBacklog ? ext[0] : 0;
  let xMax = ext[1];
  switch (range) {
    case "month":
      xMax = 31;
      break;
    case "threeMonths":
      xMax = 90;
      break;
    case "year":
      xMax = 365;
      break;
    case "all":
      break;
  }
  const desiredBars = Math.min(70, xMax - xMin);
  const bins = bin<Entry>(data.entries(), (e) => e[0], [xMin, xMax], ticks(xMin, xMax, desiredBars));
  if (!sum(bins.map((b) => b.items.length))) return null;
  const hbins = mapBins(bins);
  const total = sum(hbins.map((b) => b.value));
  const periodDays = xMax - xMin;
  return {
    histogram: { domain: [xMin, xMax], bins: hbins, total, showArea: true },
    xMax,
    total,
    averagePerDay: periodDays ? Math.round(total / periodDays) : 0,
    dueTomorrow: source.dueCounts.get(1) ?? 0,
    dailyLoad: source.dailyLoad,
  };
}

export function futureDueQuery(b: HBin, xMax: number): string {
  const start = b.x0;
  // x1 in the last bin is inclusive
  const end = b.x1 === xMax ? b.x1 : b.x1 - 1;
  return start === end ? `"prop:due=${start}"` : `"prop:due>=${start}" AND "prop:due<=${end}"`;
}

/** Day span for a future-due tooltip, as upstream passes it to `dayLabel`. */
export function futureDueDays(b: HBin, xMax: number): [number, number] {
  return [b.x0, b.x1 === xMax ? b.x1 + 1 : b.x1];
}

/* ------------------------------ Added ------------------------------ */

export function buildAdded(added: { [key: number]: number }, range: GraphRange): { histogram: Histogram; total: number; perDay: number } | null {
  const daysAdded = numericMap(added);
  if (!daysAdded.size) return null;
  let xMin: number;
  switch (range) {
    case "month":
      xMin = -31;
      break;
    case "threeMonths":
      xMin = -90;
      break;
    case "year":
      xMin = -365;
      break;
    case "all":
      xMin = Math.min(...daysAdded.keys());
      break;
  }
  const xMax = 1;
  const desiredBars = Math.min(70, Math.abs(xMin));
  const bins = mapBins(bin<Entry>(daysAdded.entries(), (e) => e[0], [xMin, xMax], ticks(xMin, xMax, desiredBars)));
  const total = sum(bins.map((b) => b.value));
  if (!total) return null;
  const periodDays = Math.abs(xMin);
  return {
    histogram: { domain: [xMin, xMax], bins, total, showArea: true },
    total,
    perDay: periodDays ? Math.round(total / periodDays) : 0,
  };
}

export function addedQuery(b: HBin): string {
  const start = Math.abs(b.x0) + 1;
  const end = Math.abs(b.x1) + 1;
  const include = `"added:${start}"`;
  return start === 1 ? include : `${include} AND -"added:${end}"`;
}

/* ------------------------------ Intervals and stability ------------------------------ */

export type IntervalRange = "month" | "p50" | "p95" | "all";

/** Every Card's interval (or stability) in days, sorted. */
export function gatherIntervals(intervals: { [key: number]: number } | undefined): number[] {
  const map = numericMap(intervals ?? {});
  const all: number[] = [];
  for (const [days, cards] of map) {
    for (let i = 0; i < cards; i++) all.push(days);
  }
  return all.sort((a, b) => a - b);
}

export interface IntervalResult {
  histogram: Histogram;
  median: number;
}

export function buildIntervals(all: number[], range: IntervalRange, fsrs: boolean): IntervalResult | null {
  if (!all.length) return null;
  const xMin = 0;
  let xMax = all[all.length - 1];
  let niceNecessary = false;
  switch (range) {
    case "month":
      xMax = Math.min(xMax, 30);
      break;
    case "p50":
      xMax = quantileSorted(all, 0.5)!;
      niceNecessary = true;
      break;
    case "p95":
      xMax = quantileSorted(all, 0.95)!;
      niceNecessary = true;
      break;
    case "all":
      niceNecessary = true;
      break;
  }
  xMax = xMax + 1;
  // do not show the zero interval for intervals
  const increment = fsrs ? (x: number) => x : (x: number) => x + 1;
  const desiredBars = Math.min(70, xMax - xMin);
  const pre: [number, number] = niceNecessary ? nice([xMin, xMax]) : [xMin, xMax];
  const domain: [number, number] = [increment(pre[0]), increment(pre[1])];
  const base = ticks(domain[0], domain[1], desiredBars);
  const thresholds = base.flatMap((x, idx) =>
    idx === base.length - 1 ? [x - (base[0] - 1), x + 1] : [x - (base[0] - 1)],
  );
  const bins = bin<number>(all, (x) => x, domain, thresholds).map((b) => ({
    x0: b.x0,
    x1: b.x1,
    value: b.items.length,
    entries: b.items.length,
  }));
  const total = sum(bins.map((b) => b.value));
  if (!total) return null;
  return {
    histogram: { domain, bins, total, showArea: true },
    median: Math.round(quantileSorted(all, 0.5) ?? 0),
  };
}

export function intervalQuery(b: HBin, fsrs: boolean): string {
  let start = b.x0;
  const end = b.x1 - 1;
  if (fsrs) {
    if (start === 0) start = 0.5;
    return `"prop:s>=${start - 0.5}" "prop:s<${end + 0.5}"`;
  }
  return start === end ? `"prop:ivl=${start}"` : `"prop:ivl>=${start}" "prop:ivl<=${end}"`;
}

/* ------------------------------ Ease, difficulty, retrievability ------------------------------ */

function adjustedScaleAndTicks(min: number, max: number, desiredBars: number, minBinSize: boolean): [[number, number], number[]] {
  const predomain = nice([min, max]);
  let tks = ticks(predomain[0], predomain[1], desiredBars);
  const minOffset = min - predomain[0];
  let tickSize = tks[1] - tks[0];
  if (minBinSize && tickSize < 1) {
    tks = d3range(min, max, 1);
    tickSize = 1;
  }
  if (minOffset === 0 || (minOffset % tickSize !== 0 && tickSize % minOffset !== 0)) {
    return [predomain, tks];
  }
  const add = (n: number) => n + minOffset;
  return [[add(predomain[0]), add(predomain[1])], tks.map(add)];
}

export function buildEase(eases: { [key: number]: number } | undefined): Histogram | null {
  const all = numericMap(eases ?? {});
  if (!all.size) return null;
  const xMin = 130;
  const xMax = Math.max(...all.keys()) + 1;
  const [domain, tks] = adjustedScaleAndTicks(xMin, xMax, 20, false);
  const bins = mapBins(bin<Entry>(all.entries(), (e) => e[0], domain, tks));
  return { domain, bins, total: sum(bins.map((b) => b.value)), showArea: false };
}

export function easeQuery(b: HBin): string {
  const start = b.x0;
  const end = b.x1 - 1;
  if (start === end) return `"prop:ease=${start / 100}"`;
  return `"prop:ease>=${start / 100}" AND "prop:ease<${(end + 1) / 100}"`;
}

/** The ease range shown in a tooltip, such as `250%` or `130%-200%`. */
export function easePercentLabel(b: HBin): string {
  return Math.floor(b.x1) - Math.floor(b.x0) <= 10 ? `${b.x0}%` : `${b.x0}%-${b.x1}%`;
}

export type PercentageRange = "p50" | "p95" | "p100" | "all";

export function percentageRangeQuantile(range: PercentageRange): number | undefined {
  // halved because the quantiles are in both directions
  switch (range) {
    case "p100":
      return 1;
    case "p95":
      return 0.975;
    case "p50":
      return 0.75;
    case "all":
      return undefined;
  }
}

export function easeQuantile(data: Map<number, number>, quantile: number): number | undefined {
  let count = sum(data.values()) * quantile;
  for (const [key, value] of data.entries()) {
    count -= value;
    if (count <= 0) return key;
  }
  return undefined;
}

export function percentageRangeMinMax(data: Map<number, number>, q: number | undefined): [number, number] {
  const xMin = q ? (easeQuantile(data, 1 - q) ?? 0) : 0;
  const xMax = q ? (easeQuantile(data, q) ?? 0) : 100;
  return [xMin, xMax];
}

/** Difficulty and retrievability: percentages bucketed the same way. */
export function buildPercentage(values: { [key: number]: number } | undefined, range: PercentageRange): Histogram | null {
  const all = numericMap(values ?? {});
  if (!all.size) return null;
  const [xMin, xMax] = percentageRangeMinMax(all, percentageRangeQuantile(range));
  const [domain, tks] = adjustedScaleAndTicks(xMin, xMax, 20, true);
  const bins = mapBins(bin<Entry>(all.entries(), (e) => e[0], domain, tks));
  return { domain, bins, total: sum(bins.map((b) => b.value)), showArea: false };
}

export function percentQuery(prop: "d" | "r", b: HBin): string {
  const start = b.x0;
  const end = b.x1 - 1;
  let till = `"prop:${prop}<${(end + 1) / 100}"`;
  if (end === 99) till = till.replace("<", "<=");
  return `"prop:${prop}>=${start / 100}" AND ${till}`;
}

/* ------------------------------ Reviews ------------------------------ */

type Reviews = Pick<GraphsResponse_ReviewCountsAndTimes_Reviews, "learn" | "relearn" | "young" | "mature" | "filtered">;

export interface ReviewsData {
  reviewCount: Map<number, Reviews>;
  reviewTime: Map<number, Reviews>;
}

export function gatherReviews(data: GraphsResponse): ReviewsData {
  return { reviewCount: numericMap(data.reviews?.count ?? {}), reviewTime: numericMap(data.reviews?.time ?? {}) };
}

/** Per-bin totals by review kind. */
export interface ReviewTotals {
  learn: number;
  relearn: number;
  young: number;
  mature: number;
  filtered: number;
}

export interface ReviewBin {
  x0: number;
  x1: number;
  totals: ReviewTotals;
  value: number;
  /** Days with reviews in the bin. */
  entries: number;
}

export interface ReviewsResult {
  domain: [number, number];
  bins: ReviewBin[];
  /** Upstream's unextended start, used for the first bin's label and the period length. */
  originalXMin: number;
  periodDays: number;
  studiedDays: number;
  /** Percent of the period with reviews. */
  studiedPercent: number;
  total: number;
  periodAverage: number;
  studiedAverage: number;
  /** Time mode only: total review count over the shown domain. */
  totalReviews: number;
}

function totalsFor(items: [number, Reviews][]): ReviewTotals {
  const t = { learn: 0, relearn: 0, young: 0, mature: 0, filtered: 0 };
  for (const [, r] of items) {
    t.learn += r.learn;
    t.relearn += r.relearn;
    t.young += r.young;
    t.mature += r.mature;
    t.filtered += r.filtered;
  }
  return t;
}

export function totalOf(t: ReviewTotals): number {
  return t.learn + t.relearn + t.young + t.mature + t.filtered;
}

export function buildReviews(source: ReviewsData, range: GraphRange, showTime: boolean): ReviewsResult | null {
  const xMax = 1;
  let xMin: number;
  switch (range) {
    case "month":
      xMin = -30;
      break;
    case "threeMonths":
      xMin = -89;
      break;
    case "year":
      xMin = -364;
      break;
    case "all":
      if (!source.reviewCount.size) return null;
      xMin = Math.min(...source.reviewCount.keys());
      break;
  }
  const desiredBars = Math.min(70, Math.abs(xMin));
  const unbound = range === "all";
  const originalXMin = xMin;

  let thresholds = ticks(xMin, xMax, desiredBars);
  // For unbound ranges, extend xMin backward so the oldest bin is as wide as the others.
  if (unbound && thresholds.length >= 2) {
    const spacing = thresholds[1] - thresholds[0];
    const partial = thresholds[0] - xMin;
    if (spacing > 0 && partial > 0 && partial < spacing) {
      xMin = thresholds[0] - spacing;
      thresholds = ticks(xMin, xMax, desiredBars);
    }
  }
  // For a year and all time, shift thresholds forward by one day so the first bin is 0-4 rather than 0-5.
  if (range === "year" || range === "all") {
    thresholds = [...new Set(thresholds.map((t) => Math.min(t + 1, 1)))].sort((a, b) => a - b);
  }
  const domain: [number, number] = [xMin, xMax];
  const sourceMap = showTime ? source.reviewTime : source.reviewCount;
  const raw = bin<[number, Reviews]>(sourceMap.entries(), (m) => m[0], domain, thresholds);
  const studiedDays = sum(raw.map((b) => b.items.length));
  if (!studiedDays) return null;
  const bins: ReviewBin[] = raw.map((b) => {
    const totals = totalsFor(b.items);
    return { x0: b.x0, x1: b.x1, totals, value: totalOf(totals), entries: b.items.length };
  });

  const periodDays = -originalXMin + 1;
  const total = sum(bins.map((b) => b.value));
  let totalReviews = 0;
  if (showTime) {
    for (const [day, r] of source.reviewCount) {
      if (domain[0] <= day && day <= domain[1]) totalReviews += totalOf(r);
    }
  }
  return {
    domain,
    bins,
    originalXMin,
    periodDays,
    studiedDays,
    studiedPercent: (studiedDays / periodDays) * 100,
    total,
    periodAverage: total / periodDays,
    studiedAverage: total / studiedDays,
    totalReviews,
  };
}

/** Day span for a reviews tooltip, as upstream passes it to `dayLabel`. */
export function reviewDays(result: ReviewsResult, b: ReviewBin): [number, number] {
  const isFirst = result.bins.length > 0 && b.x0 === result.bins[0].x0;
  const start = isFirst ? result.originalXMin : Math.floor(b.x0);
  const end = b.x1 === 0 ? 1 : b.x1;
  return [start, end];
}

/** Upstream's precision for the "days studied" percentage. */
export function studiedPercentPrecision(percent: number): number | "100" {
  if (percent < 99.5) return 0;
  if (percent < 99.95) return 1;
  if (percent < 100) return 2;
  return "100";
}

/* ------------------------------ Card counts ------------------------------ */

export type CardState = "new" | "learn" | "relearn" | "young" | "mature" | "suspended" | "buried";

export interface CardCount {
  state: CardState;
  count: number;
  show: boolean;
  query: string;
}

export function buildCardCounts(data: GraphsResponse, separateInactive: boolean): { counts: CardCount[]; total: number; xMax: number } {
  const c = separateInactive ? data.cardCounts?.excludingInactive : data.cardCounts?.includingInactive;
  const extra = separateInactive ? 'AND -("is:buried" OR "is:suspended")' : "";
  const counts: CardCount[] = [
    { state: "new", count: c?.newCards ?? 0, show: true, query: `"is:new"${extra}` },
    { state: "learn", count: c?.learn ?? 0, show: true, query: `(-"is:review" AND "is:learn")${extra}` },
    { state: "relearn", count: c?.relearn ?? 0, show: true, query: `("is:review" AND "is:learn")${extra}` },
    { state: "young", count: c?.young ?? 0, show: true, query: `("is:review" AND -"is:learn") AND "prop:ivl<21"${extra}` },
    { state: "mature", count: c?.mature ?? 0, show: true, query: `("is:review" -"is:learn") AND "prop:ivl>=21"${extra}` },
    { state: "suspended", count: c?.suspended ?? 0, show: separateInactive, query: '"is:suspended"' },
    { state: "buried", count: c?.buried ?? 0, show: separateInactive, query: '"is:buried"' },
  ];
  const total = sum(counts.map((x) => x.count));
  // a non-zero range keeps percentages sane in an empty collection
  return { counts, total, xMax: Math.max(1, total) };
}

/* ------------------------------ Hours ------------------------------ */

export interface HourDatum {
  hour: number;
  total: number;
  correct: number;
}

export function buildHours(data: GraphsResponse, range: GraphRange): { hours: HourDatum[]; yMax: number } | null {
  const h = data.hours;
  const list =
    range === "month" ? h?.oneMonth : range === "threeMonths" ? h?.threeMonths : range === "year" ? h?.oneYear : h?.allTime;
  const hours = (list ?? []).map((e, idx) => ({ hour: idx, total: e.total, correct: e.correct }));
  const yMax = Math.max(0, ...hours.map((d) => d.total));
  return yMax ? { hours, yMax } : null;
}

/* ------------------------------ Answer buttons ------------------------------ */

export type ButtonGroup = "learning" | "young" | "mature";

export interface ButtonDatum {
  group: ButtonGroup;
  button: number;
  count: number;
}

export interface GroupCorrect {
  total: number;
  correct: number;
  /** correct / total × 100, or 0. */
  percent: number;
}

export function buildButtons(
  data: GraphsResponse,
  range: GraphRange,
): { data: ButtonDatum[]; yMax: number; groups: Record<ButtonGroup, GroupCorrect> } | null {
  const b = data.buttons;
  const counts = range === "month" ? b?.oneMonth : range === "threeMonths" ? b?.threeMonths : range === "year" ? b?.oneYear : b?.allTime;
  const groups: ButtonGroup[] = ["learning", "young", "mature"];
  const out: ButtonDatum[] = groups.flatMap((group) => (counts?.[group] ?? []).map((count, idx) => ({ group, button: idx + 1, count })));
  const yMax = Math.max(0, ...out.map((d) => d.count));
  if (!yMax) return null;
  const totals = {} as Record<ButtonGroup, GroupCorrect>;
  for (const group of groups) {
    const g = out.filter((d) => d.group === group);
    const total = sum(g.map((d) => d.count));
    const correct = sum(g.filter((d) => d.button > 1).map((d) => d.count));
    totals[group] = { total, correct, percent: total ? (correct / total) * 100 : 0 };
  }
  return { data: out, yMax, groups: totals };
}

/* ------------------------------ Today ------------------------------ */

export interface TodaySummary {
  answerCount: number;
  answerSecs: number;
  againCount: number;
  againPercent: number;
  learnCount: number;
  reviewCount: number;
  relearnCount: number;
  filteredCount: number;
  matureCorrect: number;
  matureCount: number;
  maturePercent: number;
}

export function buildToday(data: GraphsResponse): TodaySummary | null {
  const t = data.today;
  if (!t?.answerCount) return null;
  const againCount = t.answerCount - t.correctCount;
  return {
    answerCount: t.answerCount,
    answerSecs: t.answerMillis / 1000,
    againCount,
    againPercent: (againCount / t.answerCount) * 100,
    learnCount: t.learnCount,
    reviewCount: t.reviewCount,
    relearnCount: t.relearnCount,
    filteredCount: t.earlyReviewCount,
    matureCorrect: t.matureCorrect,
    matureCount: t.matureCount,
    maturePercent: t.matureCount ? (t.matureCorrect / t.matureCount) * 100 : 0,
  };
}

/* ------------------------------ True retention ------------------------------ */

export type RetentionPeriod = "today" | "yesterday" | "week" | "month" | "year" | "allTime";

export interface RetentionRow {
  period: RetentionPeriod;
  youngPassed: number;
  youngFailed: number;
  maturePassed: number;
  matureFailed: number;
}

export function buildTrueRetention(data: GraphsResponse, revlogRange: RevlogRange): RetentionRow[] | null {
  const stats = data.trueRetention;
  if (!stats) return null;
  const periods: RetentionPeriod[] = ["today", "yesterday", "week", "month", "year"];
  if (revlogRange === "all") periods.push("allTime");
  return periods.map((period) => {
    const r: Partial<GraphsResponse_TrueRetentionStats_TrueRetention> = stats[period] ?? {};
    return {
      period,
      youngPassed: r.youngPassed ?? 0,
      youngFailed: r.youngFailed ?? 0,
      maturePassed: r.maturePassed ?? 0,
      matureFailed: r.matureFailed ?? 0,
    };
  });
}

/** passed / (passed + failed), or null when nothing was reviewed. */
export function retentionRatio(passed: number, failed: number): number | null {
  const total = passed + failed;
  return total === 0 ? null : passed / total;
}

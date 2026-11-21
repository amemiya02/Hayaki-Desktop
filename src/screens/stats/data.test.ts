// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import type { GraphsResponse } from "@/lib/anki/proto/anki/stats_pb";

import {
  addedQuery,
  buildAdded,
  buildButtons,
  buildCardCounts,
  buildEase,
  buildFutureDue,
  buildHours,
  buildIntervals,
  buildPercentage,
  buildReviews,
  buildToday,
  buildTrueRetention,
  cumulative,
  daysToRevlogRange,
  easePercentLabel,
  easeQuantile,
  easeQuery,
  futureDueDays,
  futureDueQuery,
  gatherIntervals,
  intervalQuery,
  percentQuery,
  percentageRangeMinMax,
  reviewDays,
  retentionRatio,
  studiedPercentPrecision,
} from "./data";

const response = (fields: Record<string, unknown>) => fields as unknown as GraphsResponse;
const rev = (r: Partial<{ learn: number; relearn: number; young: number; mature: number; filtered: number }>) => ({
  learn: 0,
  relearn: 0,
  young: 0,
  mature: 0,
  filtered: 0,
  ...r,
});

describe("revlog range", () => {
  it("follows upstream", () => {
    expect(daysToRevlogRange(365)).toBe("year");
    expect(daysToRevlogRange(0)).toBe("all");
    expect(daysToRevlogRange(400)).toBe("all");
  });
});

describe("future due", () => {
  const source = {
    dueCounts: new Map([
      [-3, 4],
      [0, 10],
      [1, 5],
      [2, 3],
      [40, 7],
    ]),
    haveBacklog: true,
    dailyLoad: 6,
  };

  it("buckets one day per bar over a month, without backlog", () => {
    const r = buildFutureDue(source, "month", false)!;
    expect(r.histogram.domain).toEqual([0, 31]);
    // 31 single-day bins plus d3's zero-width bin at the inclusive end
    expect(r.histogram.bins).toHaveLength(32);
    expect(r.histogram.bins[31]).toMatchObject({ x0: 31, x1: 31 });
    expect(r.histogram.bins[0]).toMatchObject({ x0: 0, x1: 1, value: 10 });
    expect(r.histogram.bins[30]).toMatchObject({ x0: 30, x1: 31, value: 0 });
    expect(r.total).toBe(18);
    expect(r.averagePerDay).toBe(Math.round(18 / 31));
    expect(r.dueTomorrow).toBe(5);
    expect(r.dailyLoad).toBe(6);
  });

  it("includes the backlog when asked", () => {
    const r = buildFutureDue(source, "month", true)!;
    expect(r.histogram.domain).toEqual([-3, 31]);
    expect(r.total).toBe(22);
  });

  it("covers everything for all time", () => {
    const r = buildFutureDue(source, "all", false)!;
    expect(r.histogram.domain).toEqual([0, 40]);
    expect(r.total).toBe(25);
    const last = r.histogram.bins[r.histogram.bins.length - 1];
    expect(last.x1).toBe(40);
    expect(last.value).toBe(7);
  });

  it("builds searches and labels like upstream", () => {
    expect(futureDueQuery({ x0: 3, x1: 4, value: 0, entries: 0 }, 31)).toBe('"prop:due=3"');
    expect(futureDueQuery({ x0: 30, x1: 31, value: 0, entries: 0 }, 31)).toBe('"prop:due>=30" AND "prop:due<=31"');
    expect(futureDueQuery({ x0: 5, x1: 10, value: 0, entries: 0 }, 90)).toBe('"prop:due>=5" AND "prop:due<=9"');
    expect(futureDueDays({ x0: 30, x1: 31, value: 0, entries: 0 }, 31)).toEqual([30, 32]);
  });

  it("returns null without data", () => {
    expect(buildFutureDue({ dueCounts: new Map(), haveBacklog: false, dailyLoad: 0 }, "month", false)).toBeNull();
  });

  it("accumulates running totals", () => {
    expect(cumulative([{ x0: 0, x1: 1, value: 2, entries: 1 }, { x0: 1, x1: 2, value: 3, entries: 1 }])).toEqual([2, 5]);
  });
});

describe("added", () => {
  it("covers the last month", () => {
    const r = buildAdded({ 0: 3, [-1]: 2, [-40]: 9 }, "month")!;
    expect(r.histogram.domain).toEqual([-31, 1]);
    expect(r.total).toBe(5);
    expect(r.perDay).toBe(Math.round(5 / 31));
  });
  it("builds searches", () => {
    expect(addedQuery({ x0: 0, x1: 1, value: 0, entries: 0 })).toBe('"added:1"');
    expect(addedQuery({ x0: -5, x1: -4, value: 0, entries: 0 })).toBe('"added:6" AND -"added:5"');
  });
});

describe("intervals", () => {
  const all = gatherIntervals({ 1: 2, 3: 1, 10: 4, 100: 1 });

  it("expands and sorts", () => {
    expect(all).toEqual([1, 1, 3, 10, 10, 10, 10, 100]);
  });

  it("matches upstream's bins for a month (SM-2)", () => {
    const r = buildIntervals(all, "month", false)!;
    // xMax = min(100, 30) + 1 = 31; domain shifted by one: [1, 32]
    expect(r.histogram.domain).toEqual([1, 32]);
    expect(r.histogram.bins[0]).toMatchObject({ x0: 1, x1: 2, value: 2 });
    expect(r.histogram.total).toBe(7);
    expect(r.median).toBe(10);
  });

  it("nices the percentile range", () => {
    const r = buildIntervals(all, "all", false)!;
    // xMax = 101 → nice [0, 110] → shifted [1, 111]
    expect(r.histogram.domain).toEqual([1, 111]);
    expect(r.histogram.total).toBe(8);
  });

  it("keeps zero for FSRS stability", () => {
    const r = buildIntervals(gatherIntervals({ 0: 1, 2: 1 }), "all", true)!;
    expect(r.histogram.domain[0]).toBe(0);
    expect(r.histogram.total).toBe(2);
  });

  it("builds searches", () => {
    expect(intervalQuery({ x0: 5, x1: 6, value: 0, entries: 0 }, false)).toBe('"prop:ivl=5"');
    expect(intervalQuery({ x0: 5, x1: 10, value: 0, entries: 0 }, false)).toBe('"prop:ivl>=5" "prop:ivl<=9"');
    expect(intervalQuery({ x0: 0, x1: 2, value: 0, entries: 0 }, true)).toBe('"prop:s>=0" "prop:s<1.5"');
  });

  it("returns null without Cards", () => {
    expect(buildIntervals([], "p95", false)).toBeNull();
  });
});

describe("ease", () => {
  it("bins from 130%", () => {
    const h = buildEase({ 250: 10, 130: 1, 300: 2 })!;
    // nice([130, 301]) = [120, 320]; ticks every 10 → offset 10 divides 10 → shifted to [130, 330]
    expect(h.domain).toEqual([130, 330]);
    expect(h.bins[0]).toMatchObject({ x0: 130, x1: 140, value: 1 });
    expect(h.total).toBe(13);
  });
  it("labels and searches", () => {
    expect(easePercentLabel({ x0: 250, x1: 260, value: 0, entries: 0 })).toBe("250%");
    expect(easePercentLabel({ x0: 130, x1: 200, value: 0, entries: 0 })).toBe("130%-200%");
    expect(easeQuery({ x0: 250, x1: 260, value: 0, entries: 0 })).toBe('"prop:ease>=2.5" AND "prop:ease<2.6"');
  });
});

describe("difficulty and retrievability", () => {
  const data = new Map([
    [10, 1],
    [50, 8],
    [90, 1],
  ]);
  it("finds quantiles in key order", () => {
    expect(easeQuantile(data, 0.5)).toBe(50);
    expect(percentageRangeMinMax(data, undefined)).toEqual([0, 100]);
    expect(percentageRangeMinMax(data, 0.975)).toEqual([10, 90]);
  });
  it("bins 0-100 in 5% steps for all", () => {
    const h = buildPercentage({ 10: 1, 50: 8, 90: 1 }, "all")!;
    expect(h.domain).toEqual([0, 100]);
    expect(h.bins).toHaveLength(21);
    expect(h.bins[2]).toMatchObject({ x0: 10, x1: 15, value: 1 });
    expect(h.total).toBe(10);
  });
  it("uses one-percent bins when the range is narrow", () => {
    const h = buildPercentage({ 50: 8, 52: 1, 53: 1 }, "p50")!;
    expect(h.bins.every((b) => b.x1 - b.x0 <= 1)).toBe(true);
  });
  it("builds searches", () => {
    expect(percentQuery("d", { x0: 95, x1: 100, value: 0, entries: 0 })).toBe('"prop:d>=0.95" AND "prop:d<=1"');
    expect(percentQuery("r", { x0: 10, x1: 15, value: 0, entries: 0 })).toBe('"prop:r>=0.1" AND "prop:r<0.15"');
  });
});

describe("reviews", () => {
  const source = {
    reviewCount: new Map([
      [0, rev({ young: 3, mature: 2 })],
      [-1, rev({ learn: 4 })],
      [-100, rev({ relearn: 1 })],
    ]),
    reviewTime: new Map([
      [0, rev({ young: 30000, mature: 20000 })],
      [-1, rev({ learn: 60000 })],
      [-100, rev({ relearn: 5000 })],
    ]),
  };

  it("covers the last month by day", () => {
    const r = buildReviews(source, "month", false)!;
    expect(r.domain).toEqual([-30, 1]);
    expect(r.periodDays).toBe(31);
    expect(r.studiedDays).toBe(2);
    expect(r.total).toBe(9);
    const today = r.bins.find((b) => b.x0 === 0)!;
    expect(today.totals).toMatchObject({ young: 3, mature: 2 });
    expect(r.periodAverage).toBeCloseTo(9 / 31);
    expect(r.studiedAverage).toBe(4.5);
    expect(reviewDays(r, r.bins[0])).toEqual([-30, -29]);
    expect(reviewDays(r, today)).toEqual([0, 1]);
  });

  it("shifts year thresholds by one day", () => {
    const r = buildReviews(source, "year", false)!;
    // thresholds -359, -354, …, -4, 1 → the newest bin is [-4, 1), then d3's zero-width end bin
    expect(r.bins[r.bins.length - 1]).toMatchObject({ x0: 1, x1: 1 });
    expect(r.bins[r.bins.length - 2]).toMatchObject({ x0: -4, x1: 1 });
    expect(r.total).toBe(10);
  });

  it("extends all time so the oldest bin is full width", () => {
    const r = buildReviews(source, "all", false)!;
    expect(r.originalXMin).toBe(-100);
    expect(r.periodDays).toBe(101);
    expect(r.total).toBe(10);
  });

  it("counts reviews behind the time totals", () => {
    const r = buildReviews(source, "month", true)!;
    expect(r.total).toBe(110000);
    expect(r.totalReviews).toBe(9);
  });

  it("formats the studied percentage like upstream", () => {
    expect(studiedPercentPrecision(50)).toBe(0);
    expect(studiedPercentPrecision(99.6)).toBe(1);
    expect(studiedPercentPrecision(99.97)).toBe(2);
    expect(studiedPercentPrecision(100)).toBe("100");
  });

  it("returns null without reviews", () => {
    expect(buildReviews({ reviewCount: new Map(), reviewTime: new Map() }, "all", false)).toBeNull();
    expect(buildReviews({ reviewCount: new Map(), reviewTime: new Map() }, "month", false)).toBeNull();
  });
});

describe("card counts", () => {
  const data = response({
    cardCounts: {
      includingInactive: { newCards: 5, learn: 1, relearn: 0, young: 3, mature: 1, suspended: 0, buried: 0 },
      excludingInactive: { newCards: 4, learn: 1, relearn: 0, young: 2, mature: 1, suspended: 1, buried: 1 },
    },
  });
  it("orders by lifecycle and hides inactive unless separated", () => {
    const r = buildCardCounts(data, false);
    expect(r.counts.map((c) => c.state)).toEqual(["new", "learn", "relearn", "young", "mature", "suspended", "buried"]);
    expect(r.counts.filter((c) => c.show)).toHaveLength(5);
    expect(r.total).toBe(10);
  });
  it("separates suspended and buried", () => {
    const r = buildCardCounts(data, true);
    expect(r.counts.filter((c) => c.show)).toHaveLength(7);
    expect(r.counts[0].query).toBe('"is:new"AND -("is:buried" OR "is:suspended")');
    expect(r.total).toBe(10);
  });
});

describe("hours and buttons", () => {
  const hour = (total: number, correct: number) => ({ total, correct });
  it("picks the range's hours", () => {
    const hours = Array.from({ length: 24 }, (_, i) => hour(i === 9 ? 10 : 0, i === 9 ? 8 : 0));
    const r = buildHours(response({ hours: { oneMonth: hours, threeMonths: [], oneYear: [], allTime: [] } }), "month")!;
    expect(r.yMax).toBe(10);
    expect(r.hours[9]).toEqual({ hour: 9, total: 10, correct: 8 });
    expect(buildHours(response({ hours: { oneMonth: hours, threeMonths: [], oneYear: [], allTime: [] } }), "year")).toBeNull();
  });
  it("totals correct answers per group", () => {
    const counts = { learning: [1, 2, 3, 0], young: [2, 0, 8, 0], mature: [0, 0, 0, 0] };
    const r = buildButtons(response({ buttons: { oneYear: counts } }), "year")!;
    expect(r.yMax).toBe(8);
    expect(r.groups.learning).toEqual({ total: 6, correct: 5, percent: (5 / 6) * 100 });
    expect(r.groups.young.percent).toBe(80);
    expect(r.groups.mature.percent).toBe(0);
    expect(r.data).toHaveLength(12);
  });
});

describe("today and retention", () => {
  it("summarises today", () => {
    const t = buildToday(
      response({
        today: {
          answerCount: 20,
          answerMillis: 60000,
          correctCount: 15,
          matureCorrect: 4,
          matureCount: 5,
          learnCount: 5,
          reviewCount: 12,
          relearnCount: 3,
          earlyReviewCount: 0,
        },
      }),
    )!;
    expect(t.againCount).toBe(5);
    expect(t.againPercent).toBe(25);
    expect(t.maturePercent).toBe(80);
    expect(t.answerSecs).toBe(60);
    expect(buildToday(response({ today: { answerCount: 0 } }))).toBeNull();
  });

  it("lists periods, with all time only for full history", () => {
    const tr = { youngPassed: 1, youngFailed: 1, maturePassed: 3, matureFailed: 0 };
    const data = response({ trueRetention: { today: tr, yesterday: tr, week: tr, month: tr, year: tr, allTime: tr } });
    expect(buildTrueRetention(data, "year")!.map((r) => r.period)).toEqual(["today", "yesterday", "week", "month", "year"]);
    expect(buildTrueRetention(data, "all")!).toHaveLength(6);
    expect(retentionRatio(3, 1)).toBe(0.75);
    expect(retentionRatio(0, 0)).toBeNull();
  });
});

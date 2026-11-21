// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import { CardStatsResponse_StatsRevlogEntrySchema, RevlogEntry_ReviewKind as ReviewKind } from "@/lib/anki/proto/anki/stats_pb";

import { availableRanges, calculateMaxDays, filterRevlog, forgettingCurve, prepareData, thin, TimeRange } from "./curve";

const DAY = 86400;
const entry = (time: number, stability: number | null, reviewKind = ReviewKind.REVIEW, ease = 2500, interval = 0) =>
  create(CardStatsResponse_StatsRevlogEntrySchema, {
    time: BigInt(time),
    reviewKind,
    ease,
    interval,
    memoryState: stability === null ? undefined : { stability, difficulty: 5 },
  });

test("retrievability is 90% after one stability", () => {
  expect(forgettingCurve(10, 10, 0.5)).toBeCloseTo(0.9, 6);
  expect(forgettingCurve(10, 10, 0.1542)).toBeCloseTo(0.9, 6);
  expect(forgettingCurve(10, 0, 0.5)).toBe(1);
});

test("the curve starts after the last reset or entry without memory state", () => {
  const revlog = [entry(3 * DAY, 5), entry(2 * DAY, 2), entry(1 * DAY, 0, ReviewKind.MANUAL, 0), entry(0, 1)];
  expect(filterRevlog(revlog)).toHaveLength(2);
  expect(filterRevlog([entry(2 * DAY, 3), entry(DAY, null)])).toHaveLength(1);
});

test("the data runs from the first review to past today and never rises between reviews", () => {
  const now = 20 * DAY;
  const revlog = [entry(10 * DAY, 8, ReviewKind.REVIEW, 2500, 8 * DAY), entry(0, 2, ReviewKind.LEARNING, 2500, DAY)];
  const max = calculateMaxDays(revlog, TimeRange.AllTime, now);
  expect(max).toBeGreaterThan(20);
  const data = prepareData(revlog, max, 0.5, now);
  expect(data[0].retrievability).toBe(100);
  expect(data.some((d) => d.time === now)).toBe(true);
  for (let i = 1; i < data.length; i++) {
    if (data[i].retrievability !== 100) expect(data[i].retrievability).toBeLessThanOrEqual(data[i - 1].retrievability + 1e-9);
  }
  expect(thin(data, 100).length).toBeLessThan(data.length);
});

test("time ranges are offered as upstream", () => {
  expect(availableRanges(5).ranges).toEqual([]);
  expect(availableRanges(20)).toEqual({ ranges: [TimeRange.Week, TimeRange.Month], initial: TimeRange.Month });
  expect(availableRanges(400).initial).toBe(TimeRange.AllTime);
});

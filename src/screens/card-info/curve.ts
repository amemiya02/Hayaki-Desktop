// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The FSRS forgetting curve's data, ported from Anki's
 * ts/routes/card-info/forgetting-curve.ts without d3. `now` is passed in so
 * the maths can be tested.
 */
import {
  RevlogEntry_ReviewKind as ReviewKind,
  type CardStatsResponse_StatsRevlogEntry as RevlogEntry,
} from "@/lib/anki/proto/anki/stats_pb";

import { countsAsReview } from "./model";

const MIN_POINTS = 1000;

export enum TimeRange {
  Week,
  Month,
  Year,
  AllTime,
}

export const MAX_DAYS: Record<TimeRange, number> = {
  [TimeRange.Week]: 7,
  [TimeRange.Month]: 30,
  [TimeRange.Year]: 365,
  [TimeRange.AllTime]: Infinity,
};

export interface CurvePoint {
  /** Seconds since the epoch. */
  time: number;
  daysSinceFirstLearn: number;
  elapsedDaysSinceLastReview: number;
  /** 0 to 100. */
  retrievability: number;
  stability: number;
}

export function forgettingCurve(stability: number, daysElapsed: number, decay: number): number {
  const factor = Math.pow(0.9, 1 / -decay) - 1;
  return Math.pow((daysElapsed / stability) * factor + 1.0, -decay);
}

/** Entries since the last reset that carry a memory state, newest first. */
export function filterRevlog(revlog: RevlogEntry[]): RevlogEntry[] {
  const result: RevlogEntry[] = [];
  for (const entry of revlog) {
    if ((entry.reviewKind === ReviewKind.MANUAL && entry.ease === 0) || entry.memoryState === undefined) break;
    result.push(entry);
  }
  return result.filter(countsAsReview);
}

export function calculateMaxDays(filtered: RevlogEntry[], range: TimeRange, now: number): number {
  if (filtered.length === 0) return 0;
  const daysSinceFirstLearn = (now - Number(filtered[filtered.length - 1].time)) / 86400;
  const daysSinceLastReview = (now - Number(filtered[0].time)) / 86400;
  const lastScheduledDays = filtered[0].interval / 86400;
  const previewDays = Math.max(lastScheduledDays * 1.5 - daysSinceLastReview, lastScheduledDays * 0.5);
  return Math.min(daysSinceFirstLearn + previewDays, MAX_DAYS[range]);
}

/** The ranges upstream offers for this much history, and the one it starts on. */
export function availableRanges(maxDays: number): { ranges: TimeRange[]; initial: TimeRange } {
  if (maxDays <= 7) return { ranges: [], initial: TimeRange.Week };
  const ranges = [TimeRange.Week, TimeRange.Month];
  if (maxDays > 30) ranges.push(TimeRange.Year);
  if (maxDays > 365) ranges.push(TimeRange.AllTime);
  const initial = maxDays > 365 ? TimeRange.AllTime : maxDays > 30 ? TimeRange.Year : TimeRange.Month;
  return { ranges, initial };
}

export function prepareData(filtered: RevlogEntry[], maxDays: number, decay: number, now: number): CurvePoint[] {
  const data: CurvePoint[] = [];
  let lastReviewTime = 0;
  let lastStability = 0;
  const step = Math.min(maxDays / MIN_POINTS, 1);
  if (!(step > 0)) return [];
  let daysSinceFirstLearn = 0;
  const last = () => data[data.length - 1];

  filtered
    .slice()
    .reverse()
    .forEach((entry, index) => {
      const reviewTime = Number(entry.time);
      if (index === 0) {
        lastReviewTime = reviewTime;
        lastStability = entry.memoryState?.stability || 0;
        data.push({ time: reviewTime, daysSinceFirstLearn: 0, elapsedDaysSinceLastReview: 0, retrievability: 100, stability: lastStability });
        return;
      }
      const totalDaysElapsed = (reviewTime - lastReviewTime) / 86400;
      let elapsedDays = 0;
      while (elapsedDays < totalDaysElapsed - step) {
        elapsedDays += step;
        data.push({
          time: lastReviewTime + elapsedDays * 86400,
          daysSinceFirstLearn: last().daysSinceFirstLearn + step,
          elapsedDaysSinceLastReview: elapsedDays,
          retrievability: forgettingCurve(lastStability, elapsedDays, decay) * 100,
          stability: lastStability,
        });
      }
      daysSinceFirstLearn += totalDaysElapsed;
      data.push({
        time: lastReviewTime + totalDaysElapsed * 86400,
        daysSinceFirstLearn,
        elapsedDaysSinceLastReview: 0,
        retrievability: 100,
        stability: lastStability,
      });
      lastReviewTime = reviewTime;
      lastStability = entry.memoryState?.stability || 0;
    });

  if (data.length === 0) return [];

  const totalDaysSinceLastReview = (now - lastReviewTime) / 86400;
  let elapsedDays = 0;
  while (elapsedDays < totalDaysSinceLastReview - step) {
    elapsedDays += step;
    data.push({
      time: lastReviewTime + elapsedDays * 86400,
      daysSinceFirstLearn: last().daysSinceFirstLearn + step,
      elapsedDaysSinceLastReview: elapsedDays,
      retrievability: forgettingCurve(lastStability, elapsedDays, decay) * 100,
      stability: lastStability,
    });
  }
  daysSinceFirstLearn += totalDaysSinceLastReview;
  data.push({
    time: now,
    daysSinceFirstLearn,
    elapsedDaysSinceLastReview: totalDaysSinceLastReview,
    retrievability: forgettingCurve(lastStability, totalDaysSinceLastReview, decay) * 100,
    stability: lastStability,
  });

  const previewDays = maxDays - totalDaysSinceLastReview;
  let previewElapsed = 0;
  while (previewElapsed < previewDays) {
    previewElapsed += step;
    data.push({
      time: now + previewElapsed * 86400,
      daysSinceFirstLearn: last().daysSinceFirstLearn + step,
      elapsedDaysSinceLastReview: totalDaysSinceLastReview + previewElapsed,
      retrievability: forgettingCurve(lastStability, elapsedDays + previewElapsed, decay) * 100,
      stability: lastStability,
    });
  }

  return data.filter((point) => point.daysSinceFirstLearn <= maxDays);
}

/** Thins the points to about one per pixel, keeping review points (R = 100). */
export function thin(points: CurvePoint[], target: number): CurvePoint[] {
  if (points.length <= target || target <= 0) return points;
  const every = points.length / target;
  const out: CurvePoint[] = [];
  let next = 0;
  points.forEach((point, i) => {
    if (i >= next || point.retrievability === 100 || i === points.length - 1) {
      out.push(point);
      if (i >= next) next += every;
    }
  });
  return out;
}

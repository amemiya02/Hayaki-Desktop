// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The review calendar's day grid, placed exactly as upstream's calendar.ts
 * does with d3's local-time intervals (timeDay, timeYear, timeSunday…).
 */
import type { RevlogRange } from "./data";

const DAY_MS = 864e5;
const WEEK_MS = 6048e5;
const MINUTE_MS = 6e4;

function tzDiff(start: Date, end: Date): number {
  return (end.getTimezoneOffset() - start.getTimezoneOffset()) * MINUTE_MS;
}

export function floorDay(date: Date): Date {
  const d = new Date(+date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function offsetDay(date: Date, days: number): Date {
  const d = new Date(+date);
  d.setDate(d.getDate() + days);
  return d;
}

export function floorYear(date: Date): Date {
  const d = new Date(+date);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Start of the week containing `date`, with weeks starting on `weekday` (0 = Sunday). */
export function floorWeek(date: Date, weekday: number): Date {
  const d = new Date(+date);
  d.setDate(d.getDate() - ((d.getDay() + 7 - weekday) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** d3 `timeDay.count(start, end)`. */
export function countDays(start: Date, end: Date): number {
  const s = floorDay(start);
  const e = floorDay(end);
  return Math.floor((+e - +s - tzDiff(s, e)) / DAY_MS);
}

/** d3 `timeSunday.count` and friends. */
export function countWeeks(start: Date, end: Date, weekday: number): number {
  const s = floorWeek(start, weekday);
  const e = floorWeek(end, weekday);
  return Math.floor((+e - +s - tzDiff(s, e)) / WEEK_MS);
}

export interface CalendarDay {
  /** Anki day relative to today (0 = today); for filled-in blanks, the day of the year. */
  day: number;
  count: number;
  /** 0–53 */
  weekNumber: number;
  /** 0–6, counted from the first day of the week. */
  weekDay: number;
  date: Date;
}

export interface CalendarData {
  days: CalendarDay[];
  maxCount: number;
}

/**
 * Lays out one calendar year. `reviewCount` maps Anki days (relative to today)
 * to review totals; `rolloverHour` shifts Anki days onto calendar days.
 */
export function buildCalendar(
  reviewCount: Map<number, number>,
  rolloverHour: number,
  firstDayOfWeek: number,
  targetYear: number,
  revlogRange: RevlogRange,
  now: Date = new Date(),
): CalendarData | null {
  const weekday = [0, 1, 5, 6].includes(firstDayOfWeek) ? firstDayOfWeek : 0;
  const dayMap = new Map<number, CalendarDay>();
  let maxCount = 0;
  for (const [day, count] of reviewCount) {
    let date = offsetDay(now, day);
    // an Anki day does not necessarily roll over at midnight
    date = new Date(+date - rolloverHour * 36e5);
    if (count > maxCount) maxCount = count;
    if (date.getFullYear() !== targetYear) continue;
    const weekNumber = countWeeks(floorYear(date), date, weekday);
    const weekDay = countDays(floorWeek(date, weekday), date);
    const yearDay = countDays(floorYear(date), date);
    dayMap.set(yearDay, { day, count, weekNumber, weekDay, date });
  }
  if (!maxCount) return null;

  // fill in any blanks, including the current calendar day even if the Anki day has not rolled over
  const nowForYear = new Date(+now);
  nowForYear.setFullYear(targetYear);
  const startDate = floorYear(nowForYear);
  const oneYearAgo = new Date(+now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  for (let i = 0; i < 365; i++) {
    const date = offsetDay(startDate, i);
    if (date > now) continue;
    if (revlogRange === "year" && date < oneYearAgo) continue;
    const yearDay = countDays(floorYear(date), date);
    if (!dayMap.has(yearDay)) {
      dayMap.set(yearDay, {
        day: yearDay,
        count: 0,
        weekNumber: countWeeks(floorYear(date), date, weekday),
        weekDay: countDays(floorWeek(date, weekday), date),
        date,
      });
    }
  }
  return { days: Array.from(dayMap.values()), maxCount };
}

/** Review totals per Anki day, all kinds together. */
export function dailyTotals(count: { [key: number]: { learn: number; relearn: number; young: number; mature: number; filtered: number } }): Map<number, number> {
  return new Map(
    Object.entries(count).map(([k, v]) => [Number(k), v.learn + v.relearn + v.mature + v.filtered + v.young]),
  );
}

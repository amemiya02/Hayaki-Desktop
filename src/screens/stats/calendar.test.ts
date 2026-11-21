// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { buildCalendar, countDays, countWeeks, dailyTotals, floorWeek } from "./calendar";

describe("calendar intervals", () => {
  it("floors weeks to the chosen first day", () => {
    // Wednesday 2026-11-18
    const wed = new Date(2026, 10, 18, 15);
    expect(floorWeek(wed, 0)).toEqual(new Date(2026, 10, 15));
    expect(floorWeek(wed, 1)).toEqual(new Date(2026, 10, 16));
    expect(floorWeek(wed, 5)).toEqual(new Date(2026, 10, 13));
    expect(floorWeek(wed, 6)).toEqual(new Date(2026, 10, 14));
  });

  it("counts days and weeks like d3", () => {
    expect(countDays(new Date(2026, 0, 1), new Date(2026, 0, 1, 23))).toBe(0);
    expect(countDays(new Date(2026, 0, 1), new Date(2026, 11, 31))).toBe(364);
    // 2026-01-01 is a Thursday; its Sunday week starts 2025-12-28
    expect(countWeeks(new Date(2026, 0, 1), new Date(2026, 0, 4), 0)).toBe(1);
    expect(countWeeks(new Date(2026, 0, 1), new Date(2026, 0, 3), 0)).toBe(0);
  });
});

describe("buildCalendar", () => {
  const now = new Date(2026, 10, 21, 12);

  it("places reviews on calendar days and fills the past", () => {
    const r = buildCalendar(new Map([[0, 5], [-1, 2]]), 4, 0, 2026, "all", now)!;
    expect(r.maxCount).toBe(5);
    const today = r.days.find((d) => d.count === 5)!;
    expect(today.date.getDate()).toBe(21);
    // Saturday in a Sunday-first week
    expect(today.weekDay).toBe(6);
    // every past day of the year is present, none after today
    expect(r.days.length).toBe(countDays(new Date(2026, 0, 1), now) + 1);
  });

  it("returns null without reviews", () => {
    expect(buildCalendar(new Map(), 4, 0, 2026, "year", now)).toBeNull();
  });

  it("sums review kinds per day", () => {
    const totals = dailyTotals({ 0: { learn: 1, relearn: 2, young: 3, mature: 4, filtered: 5 } });
    expect(totals.get(0)).toBe(15);
  });
});

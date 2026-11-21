// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Upstream's wording helpers for the Statistics page (`@tslib/time`, `@tslib/i18n`). */
import { FluentNumber, type FluentVariable } from "@fluent/bundle";

import { firstLanguage, languages, tr } from "@/lib/i18n";

/**
 * Anki's strings with numbers formatted as upstream's generated `tr.*`
 * functions do: at most two fraction digits.
 */
export function trs(key: string, args?: Record<string, string | number>): string {
  if (!args) return tr(key);
  const out: Record<string, FluentVariable> = {};
  for (const [name, value] of Object.entries(args)) {
    out[name] = typeof value === "number" ? new FluentNumber(value, { maximumFractionDigits: 2 }) : value;
  }
  return tr(key, out);
}

/** Upstream's `localizedNumber`: rounded to `precision` places, then localized. */
export function num(n: number, precision = 2): string {
  const round = Math.pow(10, precision);
  return (Math.round(n * round) / round).toLocaleString(languages());
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(languages()) + text.slice(1) : text;
}

export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const YEAR = 365 * DAY;
export const MONTH = YEAR / 12;

enum Unit {
  Seconds,
  Minutes,
  Hours,
  Days,
  Months,
  Years,
}

const unitNames = ["seconds", "minutes", "hours", "days", "months", "years"];
const unitSeconds = [SECOND, MINUTE, HOUR, DAY, MONTH, YEAR];
const longKeys = ["seconds", "minutes", "hours", "days", "months", "years"].map((u) => `scheduling-time-span-${u}`);
const shortKeys = ["seconds", "minutes", "hours", "days", "months", "years"].map((u) => `statistics-elapsed-time-${u}`);

function naturalUnit(secs: number): Unit {
  secs = Math.abs(secs);
  if (secs < MINUTE) return Unit.Seconds;
  if (secs < HOUR) return Unit.Minutes;
  if (secs < DAY) return Unit.Hours;
  if (secs < MONTH) return Unit.Days;
  if (secs < YEAR) return Unit.Months;
  return Unit.Years;
}

export const HOURS_UNIT = Unit.Hours;

/** Describes seconds in the largest fitting unit (upstream `timeSpan`). */
export function timeSpan(seconds: number, short = false, precise = true, maxUnit: Unit = Unit.Years): string {
  const unit = Math.min(naturalUnit(seconds), maxUnit) as Unit;
  let amount = seconds / unitSeconds[unit];
  if (!precise && unit < Unit.Months) amount = Math.round(amount);
  return trs((short ? shortKeys : longKeys)[unit], { amount });
}

export function studiedToday(cards: number, secs: number): string {
  const unit = Math.min(naturalUnit(secs), Unit.Minutes) as Unit;
  const amount = secs / unitSeconds[unit];
  return trs("statistics-studied-today", {
    unit: unitNames[unit],
    "secs-per-card": cards > 0 ? secs / cards : 0,
    cards,
    amount,
  });
}

/** "Today", "In 3-5 days", "2 days ago"… (upstream `dayLabel`). */
export function dayLabel(daysStart: number, daysEnd: number): string {
  const larger = Math.max(Math.abs(daysStart), Math.abs(daysEnd));
  const smaller = Math.min(Math.abs(daysStart), Math.abs(daysEnd));
  if (larger - smaller <= 1) {
    return daysStart >= 0
      ? trs("statistics-in-days-single", { days: daysStart })
      : trs("statistics-days-ago-single", { days: -daysStart });
  }
  return daysStart >= 0
    ? trs("statistics-in-days-range", { daysStart, daysEnd: daysEnd - 1 })
    : trs("statistics-days-ago-range", { daysStart: Math.abs(daysEnd - 1), daysEnd: -daysStart });
}

export function intervalLabel(daysStart: number, daysEnd: number, cards: number, fsrs: boolean): string {
  if (daysEnd - daysStart <= 1) {
    return trs(fsrs ? "statistics-stability-day-single" : "statistics-intervals-day-single", { day: daysStart, cards });
  }
  return trs(fsrs ? "statistics-stability-day-range" : "statistics-intervals-day-range", {
    daysStart,
    daysEnd: daysEnd - 1,
    cards,
  });
}

/** One-letter weekday name, 0 = Sunday. */
export function weekdayLabel(n: number, style: "narrow" | "long" = "narrow"): string {
  // 2026-11-15 is a Sunday
  return new Date(2026, 10, 15 + n).toLocaleDateString(firstLanguage(), { weekday: style });
}

export function percentFormat(ratio: number): string {
  return new Intl.NumberFormat(languages(), { minimumFractionDigits: 1, maximumFractionDigits: 1, style: "percent" }).format(ratio);
}

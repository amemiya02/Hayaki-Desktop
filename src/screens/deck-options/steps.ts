// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Learning and relearning steps as text ("1m 10m 1d"), matching Anki's
 * deck options (ts/routes/deck-options/steps.ts). Steps are stored in minutes.
 */

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const MONTH = YEAR / 12;

enum Unit {
  Seconds,
  Minutes,
  Hours,
  Days,
  Months,
  Years,
}

const unitSeconds: Record<Unit, number> = {
  [Unit.Seconds]: SECOND,
  [Unit.Minutes]: MINUTE,
  [Unit.Hours]: HOUR,
  [Unit.Days]: DAY,
  [Unit.Months]: MONTH,
  [Unit.Years]: YEAR,
};

function naturalUnit(secs: number): Unit {
  secs = Math.abs(secs);
  if (secs < MINUTE) return Unit.Seconds;
  if (secs < HOUR) return Unit.Minutes;
  if (secs < DAY) return Unit.Hours;
  if (secs < MONTH) return Unit.Days;
  if (secs < YEAR) return Unit.Months;
  return Unit.Years;
}

/** Largest unit the seconds divide into without a remainder. */
function naturalWholeUnit(secs: number): Unit {
  let unit = naturalUnit(secs);
  while (unit !== Unit.Seconds) {
    const amount = Math.round(secs / unitSeconds[unit]);
    if (Math.abs(secs - amount * unitSeconds[unit]) < Number.EPSILON) return unit;
    unit -= 1;
  }
  return unit;
}

const suffixes: Partial<Record<Unit, string>> = {
  [Unit.Seconds]: "s",
  [Unit.Minutes]: "m",
  [Unit.Hours]: "h",
  [Unit.Days]: "d",
};

function suffixToUnit(suffix: string): Unit {
  switch (suffix) {
    case "s":
      return Unit.Seconds;
    case "h":
      return Unit.Hours;
    case "d":
      return Unit.Days;
    default:
      return Unit.Minutes;
  }
}

function minutesToString(step: number): string {
  const secs = step * 60;
  let unit = naturalWholeUnit(secs);
  if (unit === Unit.Months || unit === Unit.Years) unit = Unit.Days;
  const amount = Math.round(secs / unitSeconds[unit]);
  return `${amount}${suffixes[unit] ?? ""}`;
}

function stringToMinutes(text: string): number {
  const match = text.match(/(\d+)(.*)/);
  if (!match) return 0;
  const [, num, suffix] = match;
  const seconds = unitSeconds[suffixToUnit(suffix)] * parseInt(num, 10);
  // Must stay representable as negative i32 seconds in a review log.
  return Math.min(seconds, 2 ** 31) / 60;
}

export function stepsToString(steps: number[]): string {
  return steps.map(minutesToString).join(" ");
}

/** Parses steps the way Anki does: unknown text is ignored, zero steps are dropped. */
export function stringToSteps(text: string): number[] {
  return text
    .split(" ")
    .map(stringToMinutes)
    .filter((step) => step);
}

/** Minutes in the last step, in days (0 without steps). */
export function lastStepDays(steps: number[]): number {
  return steps.length ? steps[steps.length - 1] / 60 / 24 : 0;
}

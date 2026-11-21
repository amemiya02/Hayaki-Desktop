// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The arithmetic behind `NumberField`: clamping, stepping and parsing typed text. */

export interface NumberRange {
  min: number;
  max: number;
  step: number;
}

/** Decimal places a step implies (0.01 → 2), so stepping never drifts into float noise. */
export function placesOf(step: number): number {
  return Number.isInteger(step) ? 0 : (step.toString().split(".")[1]?.length ?? 0);
}

/** Clamps to the range and rounds to the step's precision. NaN stays NaN. */
export function clampTo(value: number, { min, max, step }: NumberRange): number {
  if (Number.isNaN(value)) return value;
  return Number(Math.min(max, Math.max(min, value)).toFixed(placesOf(step)));
}

/** One step up or down; Shift (`big`) moves ten steps, as in Anki's spin boxes. */
export function stepFrom(value: number, direction: 1 | -1, range: NumberRange, big = false): number {
  return clampTo(value + direction * range.step * (big ? 10 : 1), range);
}

/** Reads typed text, accepting a decimal comma ("0,9"). Returns NaN for anything else. */
export function parseNumber(text: string): number {
  const trimmed = text.trim().replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number.NaN;
  return parseFloat(trimmed);
}

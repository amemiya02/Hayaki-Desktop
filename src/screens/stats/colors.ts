// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One colour per Card state, used by every graph in the same order:
 * new, learning, relearning, young, mature, then suspended and buried.
 * Anki's blue, red and green keep their new, learning and review meanings.
 */
import type { CardState } from "./data";

export const STATE_ORDER: CardState[] = ["new", "learn", "relearn", "young", "mature", "suspended", "buried"];

export const stateColor: Record<CardState, string> = {
  new: "var(--count-new)",
  learn: "var(--count-learn)",
  relearn: "var(--stat-relearn)",
  young: "var(--count-due)",
  mature: "var(--mature)",
  suspended: "color-mix(in oklab, var(--ink) 42%, var(--surface))",
  buried: "color-mix(in oklab, var(--ink) 20%, var(--surface))",
};

/** Reviews in filtered Decks, which are not a Card state. */
export const filteredColor = "var(--stat-filtered)";

export const answerColor = ["var(--answer-again)", "var(--answer-hard)", "var(--answer-good)", "var(--answer-easy)"];

/** A measure that is not a Card state (ease, difficulty, hours…). */
export const measureColor = "color-mix(in oklab, var(--accent) 78%, var(--surface))";

export const lineColor = "var(--ink-2)";

/** Calendar shade for `t` in 0–1 (0 = fewest reviews). */
export function heatColor(t: number): string {
  if (t <= 0) return "var(--surface-3)";
  const p = Math.round((22 + 78 * t) / 6) * 6;
  return `color-mix(in oklab, var(--accent) ${Math.min(100, p)}%, var(--surface-3))`;
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The inline warnings Anki's deck options show, as Fluent keys with their
 * arguments, so they can be checked without the translations loaded.
 */
import { DeckConfig_Config_NewCardInsertOrder, type DeckConfig_Config } from "@/lib/anki/proto/anki/deck_config_pb";

import { lastStepDays } from "./steps";

export type WarningLevel = "danger" | "warning" | "info";

export interface Warning {
  key: string;
  args?: Record<string, string | number>;
  level: WarningLevel;
  /** Already-formatted text, for messages that are not a single key. */
  text?: string;
}

const warn = (key: string, args?: Warning["args"]): Warning => ({ key, args, level: "warning" });

export function reviewsTooLow(newLimit: number, reviewLimit: number): Warning | null {
  const expected = Math.min(9999, newLimit * 10);
  return expected > reviewLimit ? warn("deck-config-reviews-too-low", { cards: newLimit, expected }) : null;
}

export function learningStepsTooLargeForFsrs(config: DeckConfig_Config, fsrs: boolean): Warning | null {
  return fsrs && lastStepDays(config.learnSteps) >= 1 ? warn("deck-config-steps-too-large-for-fsrs") : null;
}

export function stepsExceedGraduatingInterval(config: DeckConfig_Config): Warning | null {
  return lastStepDays(config.learnSteps) > config.graduatingIntervalGood
    ? warn("deck-config-learning-step-above-graduating-interval")
    : null;
}

export function goodExceedsEasy(config: DeckConfig_Config): Warning | null {
  return config.graduatingIntervalGood > config.graduatingIntervalEasy ? warn("deck-config-good-above-easy") : null;
}

export function insertionOrderRandom(config: DeckConfig_Config): Warning | null {
  return config.newCardInsertOrder === DeckConfig_Config_NewCardInsertOrder.RANDOM
    ? warn("deck-config-new-insertion-order-random-with-v3")
    : null;
}

export function relearningStepsTooLargeForFsrs(config: DeckConfig_Config, fsrs: boolean): Warning | null {
  return fsrs && lastStepDays(config.relearnSteps) >= 1 ? warn("deck-config-steps-too-large-for-fsrs") : null;
}

export function relearningStepsExceedMinimumInterval(config: DeckConfig_Config, fsrs: boolean): Warning | null {
  return !fsrs && lastStepDays(config.relearnSteps) > config.minimumLapseInterval
    ? warn("deck-config-relearning-steps-above-minimum-interval")
    : null;
}

export function maximumAnswerSecondsAboveRecommended(config: DeckConfig_Config): Warning | null {
  return config.capAnswerTimeToSecs > 600 ? warn("deck-config-maximum-answer-secs-above-recommended") : null;
}

export function maximumIntervalTooShort(config: DeckConfig_Config): Warning | null {
  if (config.maximumReviewInterval >= 180) return null;
  return { key: "deck-config-too-short-maximum-interval", level: config.maximumReviewInterval < 50 ? "danger" : "warning" };
}

export function desiredRetentionWarning(retention: number): Warning | null {
  const rounded = Number(retention.toFixed(2));
  const level: WarningLevel = rounded < 0.7 || rounded > 0.97 ? "danger" : "warning";
  if (rounded < 0.8) return { key: "deck-config-desired-retention-too-low", level };
  if (rounded > 0.95) return { key: "deck-config-desired-retention-too-high", level };
  return null;
}

export function noNormalEasyDay(percentages: number[]): Warning | null {
  return percentages.some((p) => p === 1) ? null : warn("deck-config-easy-days-no-normal-days");
}

export function easyDaysNeedReschedule(original: number[], current: number[], fsrs: boolean, reschedule: boolean): Warning | null {
  const changed = current.some((value, i) => value !== original[i]);
  return changed && !(fsrs && reschedule) ? warn("deck-config-easy-days-change") : null;
}

export function timeToOptimize(daysSinceLastOptimization: number): Warning | null {
  return daysSinceLastOptimization > 30 ? warn("deck-config-time-to-optimize") : null;
}

export function ignoredBeforeInfo(included: bigint, total: bigint): Warning {
  const level: WarningLevel =
    Number(included) / Number(total) < 0.1 ? "danger" : included !== total ? "warning" : "info";
  return {
    key: "deck-config-ignore-before-info",
    args: { included: included.toString(), totalCards: total.toString() },
    level,
  };
}

const validParamCounts = [0, 17, 19, 21];

/** Parses FSRS parameters typed as a comma-separated list; null when the count is not one FSRS accepts. */
export function parseParams(text: string): number[] | null {
  const values = text
    .replace(/ /g, "")
    .split(",")
    .filter((v) => v)
    .map((v) => Number(v));
  if (values.some((v) => Number.isNaN(v))) return null;
  return validParamCounts.includes(values.length) ? values : null;
}

export function formatParams(params: number[]): string {
  return params.map((v) => v.toFixed(4)).join(", ");
}

/** Relearning steps that fit within one day, which FSRS optimisation is told about. */
export function relearningStepsInDay(steps: number[]): number {
  let count = 0;
  let accumulated = 0;
  for (const step of steps) {
    accumulated += step;
    if (accumulated >= 1440) break;
    count++;
  }
  return count;
}

/** Whether the optimiser's parameters equal the current ones to four places (or it found none). */
export function paramsAlreadyOptimal(current: number[], computed: number[]): boolean {
  return (current.length > 0 && current.every((n, i) => n.toFixed(4) === computed[i]?.toFixed(4))) || computed.length === 0;
}

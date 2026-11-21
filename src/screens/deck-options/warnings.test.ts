// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";

import { DeckConfig_ConfigSchema } from "@/lib/anki/proto/anki/deck_config_pb";

import {
  desiredRetentionWarning,
  easyDaysNeedReschedule,
  formatParams,
  goodExceedsEasy,
  ignoredBeforeInfo,
  learningStepsTooLargeForFsrs,
  maximumIntervalTooShort,
  noNormalEasyDay,
  paramsAlreadyOptimal,
  parseParams,
  relearningStepsExceedMinimumInterval,
  relearningStepsInDay,
  reviewsTooLow,
  stepsExceedGraduatingInterval,
} from "./warnings";

test("review limit should be ten times the new limit", () => {
  expect(reviewsTooLow(20, 200)).toBeNull();
  expect(reviewsTooLow(20, 199)).toEqual({ key: "deck-config-reviews-too-low", args: { cards: 20, expected: 200 }, level: "warning" });
  expect(reviewsTooLow(2000, 9999)).toBeNull();
});

test("steps against intervals", () => {
  const twoDays = create(DeckConfig_ConfigSchema, { learnSteps: [1, 2880], graduatingIntervalGood: 1, graduatingIntervalEasy: 4 });
  expect(stepsExceedGraduatingInterval(twoDays)?.key).toBe("deck-config-learning-step-above-graduating-interval");
  expect(learningStepsTooLargeForFsrs(twoDays, true)?.key).toBe("deck-config-steps-too-large-for-fsrs");
  expect(learningStepsTooLargeForFsrs(twoDays, false)).toBeNull();
  expect(goodExceedsEasy(create(DeckConfig_ConfigSchema, { graduatingIntervalGood: 5, graduatingIntervalEasy: 4 }))).not.toBeNull();
  const relearn = create(DeckConfig_ConfigSchema, { relearnSteps: [2880], minimumLapseInterval: 1 });
  expect(relearningStepsExceedMinimumInterval(relearn, false)).not.toBeNull();
  expect(relearningStepsExceedMinimumInterval(relearn, true)).toBeNull();
});

test("maximum interval levels", () => {
  expect(maximumIntervalTooShort(create(DeckConfig_ConfigSchema, { maximumReviewInterval: 36500 }))).toBeNull();
  expect(maximumIntervalTooShort(create(DeckConfig_ConfigSchema, { maximumReviewInterval: 100 }))?.level).toBe("warning");
  expect(maximumIntervalTooShort(create(DeckConfig_ConfigSchema, { maximumReviewInterval: 30 }))?.level).toBe("danger");
});

test("desired retention", () => {
  expect(desiredRetentionWarning(0.9)).toBeNull();
  expect(desiredRetentionWarning(0.75)).toEqual({ key: "deck-config-desired-retention-too-low", level: "warning" });
  expect(desiredRetentionWarning(0.98)).toEqual({ key: "deck-config-desired-retention-too-high", level: "danger" });
});

test("easy days", () => {
  expect(noNormalEasyDay([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0])).not.toBeNull();
  expect(noNormalEasyDay([1, 0.5, 0.5, 0.5, 0.5, 0.5, 0])).toBeNull();
  const before = [1, 1, 1, 1, 1, 1, 1];
  const after = [1, 1, 1, 1, 1, 1, 0];
  expect(easyDaysNeedReschedule(before, after, false, false)).not.toBeNull();
  expect(easyDaysNeedReschedule(before, after, true, true)).toBeNull();
  expect(easyDaysNeedReschedule(before, before, false, false)).toBeNull();
});

test("ignore-before levels", () => {
  expect(ignoredBeforeInfo(5n, 100n).level).toBe("danger");
  expect(ignoredBeforeInfo(50n, 100n).level).toBe("warning");
  expect(ignoredBeforeInfo(100n, 100n).level).toBe("info");
});

test("parameters", () => {
  const params = Array.from({ length: 21 }, (_, i) => i / 10);
  expect(parseParams(formatParams(params))).toEqual(params);
  expect(parseParams("")).toEqual([]);
  expect(parseParams("1, 2, 3")).toBeNull();
  expect(parseParams(Array(17).fill("x").join(","))).toBeNull();
  expect(paramsAlreadyOptimal([0.1, 0.2], [0.10001, 0.19999])).toBe(true);
  expect(paramsAlreadyOptimal([0.1, 0.2], [0.2, 0.2])).toBe(false);
  expect(paramsAlreadyOptimal([], [0.2])).toBe(false);
  expect(paramsAlreadyOptimal([0.1], [])).toBe(true);
});

test("relearning steps within a day", () => {
  expect(relearningStepsInDay([10])).toBe(1);
  expect(relearningStepsInDay([10, 1440])).toBe(1);
  expect(relearningStepsInDay([])).toBe(0);
});

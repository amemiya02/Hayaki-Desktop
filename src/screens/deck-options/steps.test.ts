// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "vitest";

import { lastStepDays, stepsToString, stringToSteps } from "./steps";

test("whole steps", () => {
  const steps = [1, 10, 60, 120, 1440];
  const text = "1m 10m 1h 2h 1d";
  expect(stepsToString(steps)).toBe(text);
  expect(stringToSteps(text)).toStrictEqual(steps);
});

test("fractional steps", () => {
  const steps = [1 / 60, 5 / 60, 1.5, 400];
  const text = "1s 5s 90s 400m";
  expect(stepsToString(steps)).toBe(text);
  expect(stringToSteps(text)).toStrictEqual(steps);
});

test("rounding of f32 values", () => {
  expect(stepsToString([0.1666666716337204])).toBe("10s");
});

test("long steps are shown in days", () => {
  expect(stepsToString([60 * 24 * 60])).toBe("60d");
});

test("parsing", () => {
  expect(stringToSteps("")).toStrictEqual([]);
  expect(stringToSteps("    ")).toStrictEqual([]);
  expect(stringToSteps("1 hello 2")).toStrictEqual([1, 2]);
  expect(stringToSteps("0m 5")).toStrictEqual([5]);
  expect(stringToSteps("99999999d")).toStrictEqual([2 ** 31 / 60]);
});

test("last step in days", () => {
  expect(lastStepDays([])).toBe(0);
  expect(lastStepDays([1, 1440 * 2])).toBe(2);
});

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { DeckConfig_Config_AnswerAction, DeckConfig_Config_QuestionAction, DeckConfig_ConfigSchema } from "../anki/proto/anki/deck_config_pb";
import { create } from "@bufbuild/protobuf";

import { AnswerAction, DEFAULT_REVIEW_CONFIG, QuestionAction, reviewConfigOf, reviewPrefsOf } from "./review-config";
import { autoAdvanceStep, readTimer, timeboxReached } from "./review-flow";
import { renderAnswer, type RenderedCard } from "./render";

describe("answer timer", () => {
  it("counts whole seconds as m:ss", () => {
    expect(readTimer(0, 60_000)).toEqual({ text: "0:00", capped: false });
    expect(readTimer(9_999, 60_000)).toEqual({ text: "0:09", capped: false });
    expect(readTimer(75_400, 120_000)).toEqual({ text: "1:15", capped: false });
  });

  it("stops at the answer time limit and reports it", () => {
    expect(readTimer(59_999, 60_000)).toEqual({ text: "0:59", capped: false });
    expect(readTimer(60_000, 60_000)).toEqual({ text: "1:00", capped: true });
    expect(readTimer(600_000, 60_000)).toEqual({ text: "1:00", capped: true });
  });
});

describe("deck preset", () => {
  it("reads the reviewer options from a preset", () => {
    const config = reviewConfigOf(
      create(DeckConfig_ConfigSchema, {
        showTimer: true,
        stopTimerOnAnswer: true,
        capAnswerTimeToSecs: 30,
        disableAutoplay: true,
        skipQuestionWhenReplayingAnswer: true,
        waitForAudio: false,
        secondsToShowQuestion: 2.5,
        secondsToShowAnswer: 4,
        questionAction: DeckConfig_Config_QuestionAction.SHOW_REMINDER,
        answerAction: DeckConfig_Config_AnswerAction.ANSWER_HARD,
      }),
    );
    expect(config).toEqual({
      showTimer: true,
      stopTimerOnAnswer: true,
      capMs: 30_000,
      autoplay: false,
      replayQuestion: false,
      waitForAudio: false,
      secondsToShowQuestion: 2.5,
      secondsToShowAnswer: 4,
      questionAction: QuestionAction.SHOW_REMINDER,
      answerAction: AnswerAction.ANSWER_HARD,
    });
  });

  it("falls back to Anki's 60 second limit when the preset has none", () => {
    expect(reviewConfigOf(create(DeckConfig_ConfigSchema, {})).capMs).toBe(60_000);
    expect(reviewConfigOf(undefined)).toBe(DEFAULT_REVIEW_CONFIG);
  });

  it("uses Anki's review preferences when none are stored", () => {
    expect(reviewPrefsOf(undefined)).toEqual({
      showIntervals: true,
      showRemaining: true,
      hidePlayButtons: false,
      interruptAudio: true,
      timeLimitSecs: 0,
    });
  });
});

describe("auto advance", () => {
  const config = { ...DEFAULT_REVIEW_CONFIG, secondsToShowQuestion: 3, secondsToShowAnswer: 1.5 };

  it("shows the answer after the question time", () => {
    expect(autoAdvanceStep("question", config)).toEqual({ delayMs: 3000, action: { kind: "showAnswer" } });
  });

  it("only reminds when the preset asks for a reminder", () => {
    expect(autoAdvanceStep("question", { ...config, questionAction: QuestionAction.SHOW_REMINDER })).toEqual({
      delayMs: 3000,
      action: { kind: "remind", side: "question" },
    });
    expect(autoAdvanceStep("answer", { ...config, answerAction: AnswerAction.SHOW_REMINDER })?.action).toEqual({ kind: "remind", side: "answer" });
  });

  it("runs the preset's answer action after the answer time", () => {
    expect(autoAdvanceStep("answer", config)).toEqual({ delayMs: 1500, action: { kind: "bury" } });
    expect(autoAdvanceStep("answer", { ...config, answerAction: AnswerAction.ANSWER_AGAIN })?.action).toEqual({ kind: "answer", rating: "again" });
    expect(autoAdvanceStep("answer", { ...config, answerAction: AnswerAction.ANSWER_HARD })?.action).toEqual({ kind: "answer", rating: "hard" });
    expect(autoAdvanceStep("answer", { ...config, answerAction: AnswerAction.ANSWER_GOOD })?.action).toEqual({ kind: "answer", rating: "good" });
  });

  it("does nothing on a side whose time is zero", () => {
    expect(autoAdvanceStep("question", DEFAULT_REVIEW_CONFIG)).toBeNull();
    expect(autoAdvanceStep("answer", DEFAULT_REVIEW_CONFIG)).toBeNull();
  });
});

describe("timebox", () => {
  const start = { startedAt: 1_000_000, startReps: 4 };

  it("is off when the limit is zero", () => {
    expect(timeboxReached(start, 0, start.startedAt + 10 * 3600_000, 99)).toBeNull();
  });

  it("is reached once the limit has passed, counting Cards since it began", () => {
    expect(timeboxReached(start, 600, start.startedAt + 600_000, 20)).toBeNull();
    expect(timeboxReached(start, 600, start.startedAt + 600_001, 20)).toEqual({ cards: 16, minutes: 10 });
  });
});

describe("play buttons", () => {
  const rendered = (hidePlayButtons: boolean): RenderedCard => ({
    cardId: 1n,
    question: "",
    answerTemplate: "Back [anki:play:a:0]",
    css: "",
    bodyClass: "card",
    questionAv: [],
    answerAv: [],
    typeAnswer: null,
    hasMath: false,
    hidePlayButtons,
  });

  it("draws a play button for each sound", async () => {
    const html = await renderAnswer(rendered(false), null);
    expect(html).toContain('data-play="a:0"');
  });

  it("removes the sound references when play buttons are hidden", async () => {
    expect(await renderAnswer(rendered(true), null)).toBe("Back ");
  });
});

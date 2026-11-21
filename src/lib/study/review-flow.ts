// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The reviewer's timing rules, kept apart from React and the core so they can
 * be tested: the on-screen answer timer (`reviewer-bottom.ts`), auto advance
 * (`Reviewer._auto_advance_to_*_if_enabled`) and the timebox
 * (`Collection.timeboxReached`).
 */
import { AnswerAction, QuestionAction, type ReviewConfig } from "./review-config";

/* ------------------------------ Answer timer ------------------------------ */

export interface TimerReading {
  /** `m:ss`, as Anki shows it. */
  text: string;
  /** The limit was reached; Anki shows the time in red and stops counting. */
  capped: boolean;
}

/** Whole seconds counted from the question, held at the answer time limit. */
export function readTimer(elapsedMs: number, capMs: number): TimerReading {
  const max = Math.floor(capMs / 1000);
  const secs = Math.min(max, Math.max(0, Math.floor(elapsedMs / 1000)));
  const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return { text, capped: secs === max };
}

/* ------------------------------ Auto advance ------------------------------ */

export type AutoAdvanceAction =
  | { kind: "showAnswer" }
  | { kind: "answer"; rating: "again" | "hard" | "good" }
  | { kind: "bury" }
  | { kind: "remind"; side: "question" | "answer" };

export interface AutoAdvanceStep {
  delayMs: number;
  action: AutoAdvanceAction;
}

/** What auto advance does on this side, and when; null when the preset sets no time for it. */
export function autoAdvanceStep(side: "question" | "answer", config: ReviewConfig): AutoAdvanceStep | null {
  if (side === "question") {
    if (!config.secondsToShowQuestion) return null;
    const action: AutoAdvanceAction =
      config.questionAction === QuestionAction.SHOW_REMINDER ? { kind: "remind", side } : { kind: "showAnswer" };
    return { delayMs: Math.round(config.secondsToShowQuestion * 1000), action };
  }
  if (!config.secondsToShowAnswer) return null;
  return { delayMs: Math.round(config.secondsToShowAnswer * 1000), action: answerAction(config.answerAction) };
}

function answerAction(action: AnswerAction): AutoAdvanceAction {
  switch (action) {
    case AnswerAction.ANSWER_AGAIN:
      return { kind: "answer", rating: "again" };
    case AnswerAction.ANSWER_HARD:
      return { kind: "answer", rating: "hard" };
    case AnswerAction.ANSWER_GOOD:
      return { kind: "answer", rating: "good" };
    case AnswerAction.SHOW_REMINDER:
      return { kind: "remind", side: "answer" };
    default:
      // Anki buries the Card for Bury Card and for any value it does not know.
      return { kind: "bury" };
  }
}

/* ------------------------------ Timebox ------------------------------ */

export interface Timebox {
  startedAt: number;
  /** Cards answered in the session when this timebox began. */
  startReps: number;
}

export interface TimeboxReached {
  cards: number;
  minutes: number;
}

/** Anki's `timeboxReached`: the limit has passed since the timebox began. */
export function timeboxReached(timebox: Timebox, limitSecs: number, nowMs: number, reps: number): TimeboxReached | null {
  if (!limitSecs) return null;
  if ((nowMs - timebox.startedAt) / 1000 <= limitSecs) return null;
  return { cards: reps - timebox.startReps, minutes: Math.round(limitSecs / 60) };
}

/** Whether an undo reverted an answer, the only undo that gives back a rep (Anki never lowers reps otherwise). */
export function undoRevertedAnswer(operation: string, answerOperation: string): boolean {
  return operation === answerOperation;
}

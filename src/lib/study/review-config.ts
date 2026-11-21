// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The parts of a Deck's preset the reviewer reads for the Card on screen
 * (Anki's `Card.should_show_timer`, `time_limit`, `autoplay`,
 * `replay_question_audio_on_answer_side` and the auto advance settings), and
 * the collection preferences that change how a review looks and sounds.
 */
import {
  DeckConfig_Config_AnswerAction as AnswerAction,
  DeckConfig_Config_QuestionAction as QuestionAction,
  type DeckConfig_Config,
} from "../anki/proto/anki/deck_config_pb";
import type { Preferences_Reviewing } from "../anki/proto/anki/config_pb";

export { AnswerAction, QuestionAction };

export interface ReviewConfig {
  showTimer: boolean;
  stopTimerOnAnswer: boolean;
  /** The answer time limit; the on-screen timer and the recorded time stop here. */
  capMs: number;
  autoplay: boolean;
  /** Replaying on the answer side plays the question's sounds first. */
  replayQuestion: boolean;
  waitForAudio: boolean;
  secondsToShowQuestion: number;
  secondsToShowAnswer: number;
  questionAction: QuestionAction;
  answerAction: AnswerAction;
}

/** Anki's defaults, used for a Deck without a preset of its own. */
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  showTimer: false,
  stopTimerOnAnswer: false,
  capMs: 60_000,
  autoplay: true,
  replayQuestion: true,
  waitForAudio: true,
  secondsToShowQuestion: 0,
  secondsToShowAnswer: 0,
  questionAction: QuestionAction.SHOW_ANSWER,
  answerAction: AnswerAction.BURY_CARD,
};

export function reviewConfigOf(config: DeckConfig_Config | undefined): ReviewConfig {
  if (!config) return DEFAULT_REVIEW_CONFIG;
  return {
    showTimer: config.showTimer,
    stopTimerOnAnswer: config.stopTimerOnAnswer,
    capMs: (config.capAnswerTimeToSecs || 60) * 1000,
    autoplay: !config.disableAutoplay,
    replayQuestion: !config.skipQuestionWhenReplayingAnswer,
    waitForAudio: config.waitForAudio,
    secondsToShowQuestion: Math.max(0, config.secondsToShowQuestion),
    secondsToShowAnswer: Math.max(0, config.secondsToShowAnswer),
    questionAction: config.questionAction,
    answerAction: config.answerAction,
  };
}

export interface ReviewPrefs {
  showIntervals: boolean;
  showRemaining: boolean;
  hidePlayButtons: boolean;
  /** A new side's sounds stop what is playing, instead of following it. */
  interruptAudio: boolean;
  /** Preferences > Timebox time limit, in seconds; 0 turns it off. */
  timeLimitSecs: number;
}

export function reviewPrefsOf(reviewing: Preferences_Reviewing | undefined): ReviewPrefs {
  return {
    showIntervals: reviewing?.showIntervalsOnButtons ?? true,
    showRemaining: reviewing?.showRemainingDueCounts ?? true,
    hidePlayButtons: reviewing?.hideAudioPlayButtons ?? false,
    interruptAudio: reviewing?.interruptAudioWhenAnswering ?? true,
    timeLimitSecs: reviewing?.timeLimitSecs ?? 0,
  };
}

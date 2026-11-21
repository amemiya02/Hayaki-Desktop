// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Choices for each enum option, in Anki's order and words (ts/routes/deck-options/choices.ts). */
import {
  DeckConfig_Config_AnswerAction as AnswerAction,
  DeckConfig_Config_LeechAction as LeechAction,
  DeckConfig_Config_NewCardGatherPriority as GatherOrder,
  DeckConfig_Config_NewCardInsertOrder as InsertOrder,
  DeckConfig_Config_NewCardSortOrder as SortOrder,
  DeckConfig_Config_QuestionAction as QuestionAction,
  DeckConfig_Config_ReviewCardOrder as ReviewOrder,
  DeckConfig_Config_ReviewMix as ReviewMix,
} from "@/lib/anki/proto/anki/deck_config_pb";
import { tr } from "@/lib/i18n";

import type { Choice } from "./controls";

export function gatherChoices(): Choice<GatherOrder>[] {
  return [
    { label: tr("deck-config-new-gather-priority-deck"), value: GatherOrder.DECK },
    { label: tr("deck-config-new-gather-priority-deck-then-random-notes"), value: GatherOrder.DECK_THEN_RANDOM_NOTES },
    { label: tr("deck-config-new-gather-priority-position-lowest-first"), value: GatherOrder.LOWEST_POSITION },
    { label: tr("deck-config-new-gather-priority-position-highest-first"), value: GatherOrder.HIGHEST_POSITION },
    { label: tr("deck-config-new-gather-priority-random-notes"), value: GatherOrder.RANDOM_NOTES },
    { label: tr("deck-config-new-gather-priority-random-cards"), value: GatherOrder.RANDOM_CARDS },
  ];
}

export function sortChoices(disabled: SortOrder[]): Choice<SortOrder>[] {
  return [
    { label: tr("deck-config-sort-order-template-then-gather"), value: SortOrder.TEMPLATE },
    { label: tr("deck-config-sort-order-gather"), value: SortOrder.NO_SORT },
    { label: tr("deck-config-sort-order-card-template-then-random"), value: SortOrder.TEMPLATE_THEN_RANDOM },
    { label: tr("deck-config-sort-order-random-note-then-template"), value: SortOrder.RANDOM_NOTE_THEN_TEMPLATE },
    { label: tr("deck-config-sort-order-random"), value: SortOrder.RANDOM_CARD },
  ].map((c) => ({ ...c, disabled: disabled.includes(c.value) }));
}

export function reviewOrderChoices(fsrs: boolean): Choice<ReviewOrder>[] {
  const difficulty: Choice<ReviewOrder>[] = [
    {
      label: fsrs ? tr("deck-config-sort-order-descending-difficulty") : tr("deck-config-sort-order-ascending-ease"),
      value: ReviewOrder.EASE_ASCENDING,
    },
    {
      label: fsrs ? tr("deck-config-sort-order-ascending-difficulty") : tr("deck-config-sort-order-descending-ease"),
      value: ReviewOrder.EASE_DESCENDING,
    },
  ];
  if (fsrs) difficulty.reverse();
  const retrievability: Choice<ReviewOrder>[] = fsrs
    ? [
        { label: tr("deck-config-sort-order-retrievability-ascending"), value: ReviewOrder.RETRIEVABILITY_ASCENDING },
        { label: tr("deck-config-sort-order-retrievability-descending"), value: ReviewOrder.RETRIEVABILITY_DESCENDING },
      ]
    : [];
  return [
    { label: tr("deck-config-sort-order-due-date-then-random"), value: ReviewOrder.DAY },
    { label: tr("deck-config-sort-order-due-date-then-deck"), value: ReviewOrder.DAY_THEN_DECK },
    { label: tr("deck-config-sort-order-deck-then-due-date"), value: ReviewOrder.DECK_THEN_DAY },
    { label: tr("deck-config-sort-order-ascending-intervals"), value: ReviewOrder.INTERVALS_ASCENDING },
    { label: tr("deck-config-sort-order-descending-intervals"), value: ReviewOrder.INTERVALS_DESCENDING },
    ...difficulty,
    ...retrievability,
    { label: tr("decks-relative-overdueness"), value: ReviewOrder.RELATIVE_OVERDUENESS },
    { label: tr("deck-config-sort-order-random"), value: ReviewOrder.RANDOM },
    { label: tr("decks-order-added"), value: ReviewOrder.ADDED },
    { label: tr("decks-latest-added-first"), value: ReviewOrder.REVERSE_ADDED },
  ];
}

export function reviewMixChoices(): Choice<ReviewMix>[] {
  return [
    { label: tr("deck-config-review-mix-mix-with-reviews"), value: ReviewMix.MIX_WITH_REVIEWS },
    { label: tr("deck-config-review-mix-show-after-reviews"), value: ReviewMix.AFTER_REVIEWS },
    { label: tr("deck-config-review-mix-show-before-reviews"), value: ReviewMix.BEFORE_REVIEWS },
  ];
}

export function leechChoices(): Choice<LeechAction>[] {
  return [
    { label: tr("actions-suspend-card"), value: LeechAction.SUSPEND },
    { label: tr("scheduling-tag-only"), value: LeechAction.TAG_ONLY },
  ];
}

export function insertOrderChoices(): Choice<InsertOrder>[] {
  return [
    { label: tr("deck-config-new-insertion-order-sequential"), value: InsertOrder.DUE },
    { label: tr("deck-config-new-insertion-order-random"), value: InsertOrder.RANDOM },
  ];
}

export function answerActionChoices(): Choice<AnswerAction>[] {
  return [
    { label: tr("studying-bury-card"), value: AnswerAction.BURY_CARD },
    { label: tr("deck-config-answer-again"), value: AnswerAction.ANSWER_AGAIN },
    { label: tr("deck-config-answer-good"), value: AnswerAction.ANSWER_GOOD },
    { label: tr("deck-config-answer-hard"), value: AnswerAction.ANSWER_HARD },
    { label: tr("deck-config-show-reminder"), value: AnswerAction.SHOW_REMINDER },
  ];
}

export function questionActionChoices(): Choice<QuestionAction>[] {
  return [
    { label: tr("deck-config-question-action-show-answer"), value: QuestionAction.SHOW_ANSWER },
    { label: tr("deck-config-question-action-show-reminder"), value: QuestionAction.SHOW_REMINDER },
  ];
}

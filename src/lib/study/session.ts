// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One study session against the core's v3 queue, as Anki's `Reviewer` runs
 * it. The current Card is shown from a render made while the previous Card
 * was on screen whenever the queue agrees, so an answer reaches the next
 * question without waiting on the core.
 *
 * The phase is the session's one state machine: loading → question → answer
 * → loading, with `timebox` holding the next Card back while the timebox
 * notice is open, and `finished` once the queue is empty.
 */
import { create } from "zustand";

import * as core from "../anki/generated/core";
import { CardAnswer_Rating } from "../anki/proto/anki/scheduler_pb";
import type { QueuedCards_QueuedCard, SchedulingState } from "../anki/proto/anki/scheduler_pb";
import { BuryOrSuspendCardsRequest_Mode, ScheduleCardsAsNewRequest_Context } from "../anki/proto/anki/scheduler_pb";
import { ConfigKey_String } from "../anki/proto/anki/config_pb";
import { renderAnswer, renderCard, type RenderedCard } from "./render";
import { DEFAULT_REVIEW_CONFIG, reviewConfigOf, reviewPrefsOf, type ReviewConfig, type ReviewPrefs } from "./review-config";
import { timeboxReached, type Timebox, type TimeboxReached } from "./review-flow";

export type Phase = "loading" | "question" | "answer" | "timebox" | "finished";

export interface Counts {
  newCount: number;
  learningCount: number;
  reviewCount: number;
}

/** What the reviewer tells the person after an answer (Anki's leech tooltip). */
export interface AnswerOutcome {
  leech: boolean;
  suspended: boolean;
}

interface SessionState {
  phase: Phase;
  deckId: bigint | null;
  queued: QueuedCards_QueuedCard | null;
  rendered: RenderedCard | null;
  answerHtml: string | null;
  /** What was typed into a type-in answer, kept so a redraw compares it again. */
  typed: string | null;
  counts: Counts;
  /** Next intervals for Again, Hard, Good and Easy, as the core describes them. */
  intervals: string[];
  /** Cards answered in this session, for the progress line and the timebox. */
  answered: number;
  /** When the question appeared (`performance.now()`); the answer timer starts here. */
  shownAt: number;
  /** When the answer appeared, or null on the question side. */
  revealedAt: number | null;
  /** The current Card's preset, as the reviewer reads it. */
  config: ReviewConfig;
  prefs: ReviewPrefs;
  marked: boolean;
  flag: number;
  error: string | null;
  canUndo: boolean;
  /** The Card shown before this one, for Previous Card Info. */
  previousCardId: bigint | null;
  /** Shift+A; off whenever a session starts, as in Anki. */
  autoAdvance: boolean;
  timebox: Timebox;
  /** Set while the phase is `timebox`. */
  timeboxNotice: TimeboxReached | null;
}

interface SessionActions {
  start(deckId: bigint | null, nightMode: boolean): Promise<void>;
  reveal(typed: string | null): Promise<void>;
  answer(rating: CardAnswer_Rating): Promise<AnswerOutcome | null>;
  undo(): Promise<void>;
  reload(): Promise<void>;
  /** Renders the current Card again after its Note changed, on the side it was on. */
  redraw(): Promise<void>;
  setFlag(flag: number): Promise<void>;
  toggleMark(): Promise<void>;
  bury(scope: "card" | "note"): Promise<void>;
  suspend(scope: "card" | "note"): Promise<void>;
  forget(restorePosition: boolean, resetCounts: boolean): Promise<void>;
  setDueDate(days: string): Promise<void>;
  deleteNote(): Promise<void>;
  setNightMode(nightMode: boolean): void;
  /** Returns whether auto advance is now on. */
  toggleAutoAdvance(): boolean;
  setAutoAdvance(on: boolean): void;
  /** Starts a new timebox and shows the next Card. */
  continueAfterTimebox(): Promise<void>;
}

let nightMode = false;
let prerendered: RenderedCard | null = null;
const configCache = new Map<bigint, ReviewConfig>();

/** The preset of the Deck a Card belongs to (its home Deck when in a filtered Deck). */
async function reviewConfig(deckId: bigint): Promise<ReviewConfig> {
  const cached = configCache.get(deckId);
  if (cached) return cached;
  let config = DEFAULT_REVIEW_CONFIG;
  try {
    const deck = await core.getDeck({ did: deckId });
    if (deck.kind.case === "normal") {
      config = reviewConfigOf((await core.getDeckConfig({ dcid: deck.kind.value.configId })).config);
    }
  } catch {
    // Anki's defaults apply when the preset cannot be read.
  }
  configCache.set(deckId, config);
  return config;
}

const emptyCounts: Counts = { newCount: 0, learningCount: 0, reviewCount: 0 };
const ORIGIN = { origin: "study" };

export const useSession = create<SessionState & SessionActions>((set, get) => {
  function renderOptions() {
    return { hidePlayButtons: get().prefs.hidePlayButtons };
  }

  async function load(): Promise<void> {
    try {
      const queue = await core.getQueuedCards({ fetchLimit: 2, intradayLearningOnly: false });
      const counts = {
        newCount: queue.newCount,
        learningCount: queue.learningCount,
        reviewCount: queue.reviewCount,
      };
      const undoStatus = await core.getUndoStatus();
      const canUndo = !!undoStatus.undo;
      const [first, second] = queue.cards;
      const shownId = get().queued?.card?.id ?? null;
      if (!first?.card) {
        prerendered = null;
        set({
          phase: "finished",
          queued: null,
          rendered: null,
          answerHtml: null,
          counts,
          canUndo,
          previousCardId: shownId ?? get().previousCardId,
        });
        return;
      }
      const card = first.card;
      const rendered =
        prerendered && prerendered.cardId === card.id ? prerendered : await renderCard(card, nightMode, renderOptions());
      const intervals = first.states ? (await core.describeNextStates(first.states)).vals : [];
      const config = await reviewConfig(card.originalDeckId || card.deckId);
      set({
        phase: "question",
        queued: first,
        rendered,
        answerHtml: null,
        typed: null,
        counts,
        intervals,
        config,
        shownAt: performance.now(),
        revealedAt: null,
        marked: false,
        flag: card.flags & 0b111,
        error: null,
        canUndo,
        previousCardId: shownId !== null && shownId !== card.id ? shownId : get().previousCardId,
      });
      void markedState(card.noteId).then((marked) => {
        if (get().queued?.card?.id === card.id) set({ marked });
      });
      // Render the following Card now, so answering this one feels instant.
      prerendered = null;
      if (second?.card) {
        renderCard(second.card, nightMode, renderOptions())
          .then((r) => {
            prerendered = r;
          })
          .catch(() => undefined);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), phase: "finished" });
    }
  }

  async function markedState(noteId: bigint): Promise<boolean> {
    const note = await core.getNote({ nid: noteId });
    return note.tags.some((tag) => tag.toLowerCase() === "marked");
  }

  function currentIds(): { cardId: bigint; noteId: bigint } | null {
    const card = get().queued?.card;
    return card ? { cardId: card.id, noteId: card.noteId } : null;
  }

  /** Runs an operation that changes the queue, then shows whatever comes next. */
  async function changeQueue(op: (ids: { cardId: bigint; noteId: bigint }) => Promise<unknown>): Promise<void> {
    const ids = currentIds();
    if (!ids) return;
    await op(ids);
    prerendered = null;
    await load();
  }

  async function buryOrSuspend(scope: "card" | "note", mode: BuryOrSuspendCardsRequest_Mode): Promise<void> {
    await changeQueue((ids) =>
      core.buryOrSuspendCards(
        { cardIds: scope === "card" ? [ids.cardId] : [], noteIds: scope === "note" ? [ids.noteId] : [], mode },
        ORIGIN,
      ),
    );
  }

  return {
    phase: "loading",
    deckId: null,
    queued: null,
    rendered: null,
    answerHtml: null,
    typed: null,
    counts: emptyCounts,
    intervals: [],
    answered: 0,
    shownAt: 0,
    revealedAt: null,
    config: DEFAULT_REVIEW_CONFIG,
    prefs: reviewPrefsOf(undefined),
    marked: false,
    flag: 0,
    error: null,
    canUndo: false,
    previousCardId: null,
    autoAdvance: false,
    timebox: { startedAt: Date.now(), startReps: 0 },
    timeboxNotice: null,

    async start(deckId, night) {
      nightMode = night;
      prerendered = null;
      // Presets may have changed since the last session (Options opens from here).
      configCache.clear();
      set({
        phase: "loading",
        deckId,
        queued: null,
        answered: 0,
        error: null,
        previousCardId: null,
        autoAdvance: false,
        timebox: { startedAt: Date.now(), startReps: 0 },
        timeboxNotice: null,
      });
      try {
        set({ prefs: reviewPrefsOf((await core.getPreferences()).reviewing) });
      } catch {
        // Anki's defaults apply.
      }
      if (deckId !== null) await core.setCurrentDeck({ did: deckId }, ORIGIN);
      await load();
    },

    async reload() {
      prerendered = null;
      await load();
    },

    async redraw() {
      const { queued, phase, typed } = get();
      if (!queued?.card || (phase !== "question" && phase !== "answer")) return;
      try {
        const card = await core.getCard({ cid: queued.card.id });
        const rendered = await renderCard(card, nightMode, renderOptions());
        const answerHtml = phase === "answer" ? await renderAnswer(rendered, typed) : null;
        const marked = await markedState(card.noteId);
        if (get().queued?.card?.id !== card.id || get().phase !== phase) return;
        prerendered = null;
        set({ rendered, answerHtml, marked, flag: card.flags & 0b111 });
      } catch {
        // The Card or its Note is gone: show what the queue offers now.
        prerendered = null;
        await load();
      }
    },

    setNightMode(night) {
      if (night !== nightMode) {
        nightMode = night;
        prerendered = null;
      }
    },

    async reveal(typed) {
      const { rendered, phase } = get();
      if (!rendered || phase !== "question") return;
      const answerHtml = await renderAnswer(rendered, typed);
      if (get().rendered !== rendered || get().phase !== "question") return;
      set({ phase: "answer", answerHtml, typed, revealedAt: performance.now() });
    },

    async answer(rating) {
      const { queued, phase, shownAt, config, answered } = get();
      if (!queued?.card || !queued.states || phase !== "answer") return null;
      const card = queued.card;
      const states = queued.states;
      const newState = [states.again, states.hard, states.good, states.easy][rating];
      set({ phase: "loading" });
      try {
        await core.answerCard(
          {
            cardId: card.id,
            currentState: states.current,
            newState,
            rating,
            answeredAtMillis: BigInt(Date.now()),
            millisecondsTaken: Math.min(Math.round(performance.now() - shownAt), config.capMs),
          },
          ORIGIN,
        );
      } catch (error) {
        set({ phase: "answer" });
        throw error;
      }
      const reps = answered + 1;
      set({ answered: reps });
      const outcome = await leechOutcome(card.id, newState);
      const reached = timeboxReached(get().timebox, get().prefs.timeLimitSecs, Date.now(), reps);
      if (reached) {
        set({ phase: "timebox", timeboxNotice: reached });
      } else {
        await load();
      }
      return outcome;
    },

    async continueAfterTimebox() {
      if (get().phase !== "timebox") return;
      set({ phase: "loading", timeboxNotice: null, timebox: { startedAt: Date.now(), startReps: get().answered } });
      await load();
    },

    async undo() {
      try {
        await core.undo(ORIGIN);
      } catch {
        return;
      }
      prerendered = null;
      set({ answered: Math.max(0, get().answered - 1), timeboxNotice: null });
      await load();
    },

    async setFlag(flag) {
      const ids = currentIds();
      if (!ids) return;
      const next = get().flag === flag ? 0 : flag;
      await core.setFlag({ cardIds: [ids.cardId], flag: next }, ORIGIN);
      set({ flag: next });
    },

    async toggleMark() {
      const ids = currentIds();
      if (!ids) return;
      const marked = get().marked;
      const request = { noteIds: [ids.noteId], tags: "marked" };
      if (marked) await core.removeNoteTags(request, ORIGIN);
      else await core.addNoteTags(request, ORIGIN);
      set({ marked: !marked });
    },

    bury: (scope) => buryOrSuspend(scope, BuryOrSuspendCardsRequest_Mode.BURY_USER),
    suspend: (scope) => buryOrSuspend(scope, BuryOrSuspendCardsRequest_Mode.SUSPEND),

    forget: (restorePosition, resetCounts) =>
      changeQueue((ids) =>
        core.scheduleCardsAsNew(
          {
            cardIds: [ids.cardId],
            log: true,
            restorePosition,
            resetCounts,
            context: ScheduleCardsAsNewRequest_Context.REVIEWER,
          },
          ORIGIN,
        ),
      ),

    setDueDate: (days) =>
      changeQueue((ids) =>
        core.setDueDate({ cardIds: [ids.cardId], days, configKey: { key: ConfigKey_String.SET_DUE_REVIEWER } }, ORIGIN),
      ),

    deleteNote: () => changeQueue((ids) => core.removeNotes({ noteIds: [ids.noteId], cardIds: [] }, ORIGIN)),

    toggleAutoAdvance() {
      const on = !get().autoAdvance;
      set({ autoAdvance: on });
      return on;
    },

    setAutoAdvance(on) {
      set({ autoAdvance: on });
    },
  };
});

/** Anki's `state_is_leech`, and whether the leech action suspended the Card. */
async function leechOutcome(cardId: bigint, newState: SchedulingState | undefined): Promise<AnswerOutcome> {
  try {
    if (!newState || !(await core.stateIsLeech(newState)).val) return { leech: false, suspended: false };
    const card = await core.getCard({ cid: cardId });
    return { leech: true, suspended: card.queue < 0 };
  } catch {
    return { leech: false, suspended: false };
  }
}

export { CardAnswer_Rating as Rating };

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One study session against the core's v3 queue. The current Card is shown
 * from a render made while the previous Card was on screen whenever the queue
 * agrees, so an answer reaches the next question without waiting on the core.
 */
import { create } from "zustand";

import * as core from "../anki/generated/core";
import { CardAnswer_Rating } from "../anki/proto/anki/scheduler_pb";
import type { QueuedCards_QueuedCard } from "../anki/proto/anki/scheduler_pb";
import { BuryOrSuspendCardsRequest_Mode } from "../anki/proto/anki/scheduler_pb";
import { renderAnswer, renderCard, type RenderedCard } from "./render";

export type Phase = "loading" | "question" | "answer" | "finished";

export interface Counts {
  newCount: number;
  learningCount: number;
  reviewCount: number;
}

interface SessionState {
  phase: Phase;
  deckId: bigint | null;
  queued: QueuedCards_QueuedCard | null;
  rendered: RenderedCard | null;
  answerHtml: string | null;
  counts: Counts;
  /** Next intervals for Again, Hard, Good and Easy, as the core describes them. */
  intervals: string[];
  /** Cards answered in this session, for the progress line. */
  answered: number;
  shownAt: number;
  capMs: number;
  marked: boolean;
  flag: number;
  error: string | null;
  canUndo: boolean;
}

interface SessionActions {
  start(deckId: bigint | null, nightMode: boolean): Promise<void>;
  reveal(typed: string | null): Promise<void>;
  answer(rating: CardAnswer_Rating): Promise<void>;
  undo(): Promise<void>;
  reload(): Promise<void>;
  setFlag(flag: number): Promise<void>;
  toggleMark(): Promise<void>;
  bury(scope: "card" | "note"): Promise<void>;
  suspend(scope: "card" | "note"): Promise<void>;
  deleteNote(): Promise<void>;
  setNightMode(nightMode: boolean): void;
}

let nightMode = false;
let prerendered: RenderedCard | null = null;
const capCache = new Map<bigint, number>();

async function answerCap(deckId: bigint): Promise<number> {
  const cached = capCache.get(deckId);
  if (cached !== undefined) return cached;
  let cap = 60_000;
  try {
    const deck = await core.getDeck({ did: deckId });
    if (deck.kind.case === "normal") {
      const config = await core.getDeckConfig({ dcid: deck.kind.value.configId });
      cap = (config.config?.capAnswerTimeToSecs || 60) * 1000;
    }
  } catch {
    // A filtered Deck has no preset of its own; Anki's default cap applies.
  }
  capCache.set(deckId, cap);
  return cap;
}

const emptyCounts: Counts = { newCount: 0, learningCount: 0, reviewCount: 0 };

export const useSession = create<SessionState & SessionActions>((set, get) => {
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
      if (!first?.card) {
        prerendered = null;
        set({ phase: "finished", queued: null, rendered: null, answerHtml: null, counts, canUndo });
        return;
      }
      const card = first.card;
      const rendered =
        prerendered && prerendered.cardId === card.id ? prerendered : await renderCard(card, nightMode);
      const intervals = first.states ? (await core.describeNextStates(first.states)).vals : [];
      const capMs = await answerCap(card.originalDeckId || card.deckId);
      set({
        phase: "question",
        queued: first,
        rendered,
        answerHtml: null,
        counts,
        intervals,
        capMs,
        shownAt: performance.now(),
        marked: false,
        flag: card.flags & 0b111,
        error: null,
        canUndo,
      });
      void markedState(card.noteId).then((marked) => {
        if (get().queued?.card?.id === card.id) set({ marked });
      });
      // Render the following Card now, so answering this one feels instant.
      prerendered = null;
      if (second?.card) {
        const next = second.card;
        renderCard(next, nightMode)
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

  return {
    phase: "loading",
    deckId: null,
    queued: null,
    rendered: null,
    answerHtml: null,
    counts: emptyCounts,
    intervals: [],
    answered: 0,
    shownAt: 0,
    capMs: 60_000,
    marked: false,
    flag: 0,
    error: null,
    canUndo: false,

    async start(deckId, night) {
      nightMode = night;
      prerendered = null;
      set({ phase: "loading", deckId, answered: 0, error: null });
      if (deckId !== null) await core.setCurrentDeck({ did: deckId }, { origin: "study" });
      await load();
    },

    async reload() {
      prerendered = null;
      await load();
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
      set({ phase: "answer", answerHtml });
    },

    async answer(rating) {
      const { queued, phase, shownAt, capMs, answered } = get();
      if (!queued?.card || !queued.states || phase !== "answer") return;
      const states = queued.states;
      const newState = [states.again, states.hard, states.good, states.easy][rating];
      set({ phase: "loading" });
      await core.answerCard(
        {
          cardId: queued.card.id,
          currentState: states.current,
          newState,
          rating,
          answeredAtMillis: BigInt(Date.now()),
          millisecondsTaken: Math.min(Math.round(performance.now() - shownAt), capMs),
        },
        { origin: "study" },
      );
      set({ answered: answered + 1 });
      await load();
    },

    async undo() {
      try {
        await core.undo({ origin: "study" });
      } catch {
        return;
      }
      prerendered = null;
      set({ answered: Math.max(0, get().answered - 1) });
      await load();
    },

    async setFlag(flag) {
      const ids = currentIds();
      if (!ids) return;
      const next = get().flag === flag ? 0 : flag;
      await core.setFlag({ cardIds: [ids.cardId], flag: next }, { origin: "study" });
      set({ flag: next });
    },

    async toggleMark() {
      const ids = currentIds();
      if (!ids) return;
      const marked = get().marked;
      const request = { noteIds: [ids.noteId], tags: "marked" };
      if (marked) await core.removeNoteTags(request, { origin: "study" });
      else await core.addNoteTags(request, { origin: "study" });
      set({ marked: !marked });
    },

    async bury(scope) {
      const ids = currentIds();
      if (!ids) return;
      await core.buryOrSuspendCards(
        {
          cardIds: scope === "card" ? [ids.cardId] : [],
          noteIds: scope === "note" ? [ids.noteId] : [],
          mode: BuryOrSuspendCardsRequest_Mode.BURY_USER,
        },
        { origin: "study" },
      );
      prerendered = null;
      await load();
    },

    async suspend(scope) {
      const ids = currentIds();
      if (!ids) return;
      await core.buryOrSuspendCards(
        {
          cardIds: scope === "card" ? [ids.cardId] : [],
          noteIds: scope === "note" ? [ids.noteId] : [],
          mode: BuryOrSuspendCardsRequest_Mode.SUSPEND,
        },
        { origin: "study" },
      );
      prerendered = null;
      await load();
    },

    async deleteNote() {
      const ids = currentIds();
      if (!ids) return;
      await core.removeNotes({ noteIds: [ids.noteId], cardIds: [] }, { origin: "study" });
      prerendered = null;
      await load();
    },
  };
});

export { CardAnswer_Rating as Rating };

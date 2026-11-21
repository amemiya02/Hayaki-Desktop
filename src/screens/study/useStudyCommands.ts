// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Runs the reviewer's commands, whether they come from a key, the More menu
 * or auto advance, with Anki's tooltips after each one.
 */
import { useCallback } from "react";
import { toast } from "sonner";

import { isImageOcclusion } from "@/components/editor/markup";
import * as core from "@/lib/anki/generated/core";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { playTags, seekRelative, stopAudio, togglePause } from "@/lib/study/audio";
import type { AutoAdvanceAction } from "@/lib/study/review-flow";
import { Rating, useSession } from "@/lib/study/session";
import { openAddCopy } from "@/screens/add/prefill";
import { openCardInfo } from "@/screens/card-info";

import type { StudyCommand } from "./keys";
import { reminderText } from "./useAutoAdvance";
import { replayOwnVoice } from "./VoiceRecorder";

export type StudyDialog =
  | { kind: "setDue" }
  | { kind: "forget" }
  | { kind: "edit"; noteId: bigint }
  | { kind: "record" };

interface Hooks {
  reveal(): Promise<void>;
  openDialog(dialog: StudyDialog): void;
  openMenu(): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs a change, then says what happened with an Undo button. */
async function withToast(action: () => Promise<void>, message?: string): Promise<void> {
  try {
    await action();
    if (message) toast(message, { action: { label: tr("undo-undo"), onClick: () => void useSession.getState().undo() } });
  } catch (error) {
    toast.error(errorText(error));
  }
}

const ratings = [Rating.AGAIN, Rating.HARD, Rating.GOOD, Rating.EASY];

/** Answers the Card and shows Anki's leech tooltip when the answer made it one. */
export async function answerCard(rating: Rating): Promise<void> {
  try {
    const outcome = await useSession.getState().answer(rating);
    if (outcome?.leech) {
      const text = tr("studying-card-was-a-leech");
      toast(outcome.suspended ? `${text} ${tr("studying-it-has-been-suspended")}` : text);
    }
  } catch (error) {
    toast.error(errorText(error));
  }
}

/** R: the side's sounds; on the answer side the question's first, unless the preset skips them. */
export function replayAudio(): void {
  const { rendered: r, phase, config, prefs } = useSession.getState();
  if (!r) return;
  const tags = phase === "answer" ? (config.replayQuestion ? [...r.questionAv, ...r.answerAv] : r.answerAv) : r.questionAv;
  void playTags(tags, { interrupt: prefs.interruptAudio });
}

/** E: Image Occlusion Notes open on their image; others in the Edit Current dialog. */
async function editNote(noteId: bigint, openDialog: (dialog: StudyDialog) => void): Promise<void> {
  try {
    const note = await core.getNote({ nid: noteId });
    const notetype = await core.getNotetype({ ntid: note.notetypeId });
    if (isImageOcclusion(notetype)) {
      useNav.getState().go({ name: "image-occlusion", mode: { kind: "edit", noteId } });
      return;
    }
  } catch {
    // The dialog shows its own error if the Note is gone.
  }
  openDialog({ kind: "edit", noteId });
}

export function useStudyCommands({ reveal, openDialog, openMenu }: Hooks) {
  const run = useCallback(
    (command: StudyCommand): void => {
      const st = useSession.getState();
      const card = st.queued?.card;
      switch (command.id) {
        case "leave":
          useNav.getState().back();
          return;
        case "menu":
          openMenu();
          return;
        case "reveal":
          void reveal();
          return;
        case "answer":
          void answerCard(ratings[command.ease - 1]);
          return;
        case "undo":
          void st.undo();
          return;
        case "pauseAudio":
          togglePause();
          return;
        case "seek":
          seekRelative(command.secs);
          return;
        case "replay":
          replayAudio();
          return;
        case "replayVoice":
          replayOwnVoice();
          return;
        case "recordVoice":
          stopAudio();
          openDialog({ kind: "record" });
          return;
        case "toggleAutoAdvance":
          toast(st.toggleAutoAdvance() ? tr("actions-auto-advance-activated") : tr("actions-auto-advance-deactivated"));
          return;
        case "previousCardInfo":
          if (st.previousCardId !== null) openCardInfo(st.previousCardId);
          return;
      }
      if (!card) return;
      switch (command.id) {
        case "flag":
          void withToast(() => st.setFlag(command.flag));
          return;
        case "mark":
          void withToast(() => st.toggleMark());
          return;
        case "deleteNote":
          void withToast(() => st.deleteNote(), tr("browsing-cards-deleted", { count: 1 }));
          return;
        case "bury":
          void withToast(() => st.bury(command.scope), tr("studying-cards-buried", { count: 1 }));
          return;
        case "suspend":
          void withToast(
            () => st.suspend(command.scope),
            command.scope === "card" ? tr("studying-card-suspended") : tr("studying-note-suspended"),
          );
          return;
        case "edit":
          void editNote(card.noteId, openDialog);
          return;
        case "cardInfo":
          openCardInfo(card.id);
          return;
        case "options":
          useNav.getState().go({ name: "deck-options", deckId: card.originalDeckId || card.deckId });
          return;
        case "setDue":
          openDialog({ kind: "setDue" });
          return;
        case "forget":
          openDialog({ kind: "forget" });
          return;
        case "createCopy":
          void openAddCopy(card.noteId, card.originalDeckId || card.deckId);
          return;
      }
    },
    [reveal, openDialog, openMenu],
  );

  /** What auto advance does when a side's time runs out. */
  const autoAdvance = useCallback(
    (action: AutoAdvanceAction): void => {
      switch (action.kind) {
        case "showAnswer":
          run({ id: "reveal" });
          return;
        case "answer":
          run({ id: "answer", ease: action.rating === "again" ? 1 : action.rating === "hard" ? 2 : 3 });
          return;
        case "bury":
          run({ id: "bury", scope: "card" });
          return;
        case "remind":
          toast(reminderText(action.side));
          return;
      }
    },
    [run],
  );

  return { run, autoAdvance };
}

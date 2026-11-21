// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Auto advance (Shift+A), as Anki's reviewer runs it: each side starts a timer
 * from the preset; when it runs out the reviewer waits for audio to finish if
 * the preset says so, and turns auto advance off instead of acting if the
 * person has moved elsewhere (another window or a dialog).
 */
import { useEffect } from "react";

import { tr } from "@/lib/i18n";
import { isPlaying, onAudioIdle } from "@/lib/study/audio";
import { autoAdvanceStep, type AutoAdvanceAction } from "@/lib/study/review-flow";
import { useSession } from "@/lib/study/session";

/** Anki waits a moment after audio ends for its queue to settle. */
const AFTER_AUDIO_MS = 100;

function awayFromReview(): boolean {
  return !document.hasFocus() || !!document.querySelector("[role=dialog], [role=menu]");
}

export function useAutoAdvance(perform: (action: AutoAdvanceAction) => void): void {
  const enabled = useSession((s) => s.autoAdvance);
  const phase = useSession((s) => s.phase);
  const cardId = useSession((s) => s.rendered?.cardId);
  const shownAt = useSession((s) => s.shownAt);
  const config = useSession((s) => s.config);

  useEffect(() => {
    if (!enabled || (phase !== "question" && phase !== "answer")) return;
    const step = autoAdvanceStep(phase, config);
    if (!step) return;
    let cancelled = false;
    let stopWaiting: (() => void) | undefined;
    let retry: number | undefined;

    const fire = () => {
      if (cancelled) return;
      if (config.waitForAudio && isPlaying()) {
        stopWaiting?.();
        stopWaiting = onAudioIdle(() => {
          stopWaiting?.();
          retry = window.setTimeout(fire, AFTER_AUDIO_MS);
        });
        return;
      }
      if (awayFromReview()) {
        useSession.getState().setAutoAdvance(false);
        return;
      }
      perform(step.action);
    };
    const timer = window.setTimeout(fire, step.delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      stopWaiting?.();
    };
    // `perform` is read when the timer fires; a new Card or side restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, phase, cardId, shownAt, config]);
}

export function reminderText(side: "question" | "answer"): string {
  return side === "question" ? tr("studying-question-time-elapsed") : tr("studying-answer-time-elapsed");
}

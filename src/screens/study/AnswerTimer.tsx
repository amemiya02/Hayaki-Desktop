// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The answer timer from Anki's bottom bar, shown when the preset's Show answer
 * timer is on. It counts whole seconds from the question, stops on the answer
 * side when Stop on answer is on, and holds in the danger colour at the
 * answer time limit.
 */
import { useEffect, useState } from "react";

import { cn } from "@/components/ui";
import { tstudy } from "@/lib/strings/study";
import { readTimer } from "@/lib/study/review-flow";
import { useSession } from "@/lib/study/session";

export function AnswerTimer() {
  const shownAt = useSession((s) => s.shownAt);
  const revealedAt = useSession((s) => s.revealedAt);
  const config = useSession((s) => s.config);
  const phase = useSession((s) => s.phase);
  const [now, setNow] = useState(() => performance.now());

  const stopped = revealedAt !== null && config.stopTimerOnAnswer;
  const active = config.showTimer && (phase === "question" || phase === "answer");

  useEffect(() => {
    setNow(performance.now());
    if (!active || stopped) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [active, stopped, shownAt]);

  if (!active) return null;
  const end = stopped ? revealedAt : now;
  const reading = readTimer(end - shownAt, config.capMs);
  return (
    <span
      role="timer"
      aria-label={tstudy("timer")}
      className={cn("tabular me-1.5 text-control", reading.capped ? "font-semibold text-danger" : "text-ink-3")}
    >
      {reading.text}
    </span>
  );
}

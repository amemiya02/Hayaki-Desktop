// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, GraduationCap, Undo2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { UnburyDeckRequest_Mode } from "@/lib/anki/proto/anki/scheduler_pb";
import { t, tr } from "@/lib/i18n";
import { useCurrentDeck, useStudiedToday } from "@/lib/queries";
import { useSession } from "@/lib/study/session";
import { openCustomStudy } from "@/screens/filtered";

/** The finished screen: says why there is nothing left and when to come back. */
export function Finished({ onBack, error }: { onBack: () => void; error: string | null }) {
  const { data: info } = useQuery({ queryKey: ["congrats", "session"], queryFn: () => core.congratsInfo(), staleTime: 0 });
  const { data: studied } = useStudiedToday();
  const { data: deck } = useCurrentDeck();

  const unbury = async () => {
    if (!deck) return;
    await core.unburyDeck({ deckId: deck.id, mode: UnburyDeckRequest_Mode.ALL }, { origin: "finished" });
    await useSession.getState().reload();
  };

  // C opens Custom Study for the Deck just finished, as on Anki's overview.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key !== "c" || e.ctrlKey || e.metaKey || e.altKey || !deck || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      openCustomStudy(deck.id);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [deck]);

  const lines: string[] = [];
  if (info) {
    if (info.learnRemaining > 0) {
      lines.push(tr("scheduling-learn-remaining", { remaining: info.learnRemaining }));
    }
    if (info.reviewRemaining) lines.push(tr("scheduling-today-review-limit-reached"));
    if (info.newRemaining) lines.push(tr("scheduling-today-new-limit-reached"));
    if (info.haveSchedBuried || info.haveUserBuried) lines.push(tr("scheduling-buried-cards-found", { unburyThem: tr("scheduling-unbury-them") }));
  }

  return (
    <div className="grid h-full place-items-center bg-canvas px-8">
      <div className="flex w-full max-w-[460px] flex-col items-center text-center animate-rise-in">
        <span className="mb-5 grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Check className="size-7" strokeWidth={2.25} />
        </span>
        <h1 className="text-headline font-semibold text-ink text-balance">
          {error ? t("error.title") : tr("scheduling-congratulations-finished")}
        </h1>
        {error && <p className="selectable mt-3 text-control text-danger">{error}</p>}
        {lines.map((line) => (
          <p key={line} className="mt-3 text-body leading-relaxed text-ink-2 text-pretty">
            {line}
          </p>
        ))}
        {studied && <p className="mt-4 text-caption text-ink-3">{studied}</p>}
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {info && (info.haveSchedBuried || info.haveUserBuried) && (
            <Button size="lg" onClick={() => void unbury()}>
              <Undo2 />
              {tr("studying-unbury")}
            </Button>
          )}
          {deck && (
            <Button size="lg" onClick={() => openCustomStudy(deck.id)} title={`${tr("actions-custom-study")} (C)`}>
              <GraduationCap />
              {tr("actions-custom-study")}
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={onBack} autoFocus>
            <ArrowLeft />
            {t("study.back")}
          </Button>
        </div>
      </div>
    </div>
  );
}

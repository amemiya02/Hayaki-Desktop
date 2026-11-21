// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Anki's card previewer: the Card as its template draws it, question then answer. */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CardFrame, type CardFrameContent } from "@/components/CardFrame";
import { Button, Dialog, IconButton, Kbd, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { direction, firstLanguage, tr } from "@/lib/i18n";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { playTags, stopAudio } from "@/lib/study/audio";
import { renderAnswer, renderCard, type RenderedCard } from "@/lib/study/render";
import { useResolvedAppearance } from "@/lib/useAppearance";
import { tb } from "@/lib/strings/browse";

export function PreviewDialog({ cardIds, startIndex, onClose }: { cardIds: bigint[]; startIndex: number; onClose: () => void }) {
  const theme = usePrefs((s) => s.theme);
  const resolved = useResolvedAppearance();
  const night = resolved !== "light";
  const [index, setIndex] = useState(Math.max(0, Math.min(cardIds.length - 1, startIndex)));
  const [side, setSide] = useState<"question" | "answer">("question");
  const [rendered, setRendered] = useState<RenderedCard | null>(null);
  const [answerHtml, setAnswerHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flag, setFlag] = useState(0);

  const cardId = cardIds[index];

  useEffect(() => {
    let cancelled = false;
    setRendered(null);
    setAnswerHtml(null);
    setError(null);
    setSide("question");
    void (async () => {
      try {
        const card = await core.getCard({ cid: cardId });
        const r = await renderCard(card, night);
        const answer = await renderAnswer(r, null);
        if (cancelled) return;
        setFlag(card.flags & 7);
        setRendered(r);
        setAnswerHtml(answer);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      stopAudio();
    };
  }, [cardId, night]);

  const content = useMemo<CardFrameContent | null>(() => {
    if (!rendered) return null;
    return {
      html: side === "answer" && answerHtml !== null ? answerHtml : rendered.question,
      css: rendered.css,
      bodyClass: rendered.bodyClass,
      side,
      frame: { dark: night, vars: cardFrameVars(theme, resolved), dir: direction(), lang: firstLanguage() },
      flag,
    };
  }, [rendered, side, answerHtml, night, theme, resolved, flag]);

  const step = useCallback(
    (delta: number) => {
      if (side === "question" && delta > 0) return setSide("answer");
      if (side === "answer" && delta < 0) return setSide("question");
      const next = index + delta;
      if (next >= 0 && next < cardIds.length) setIndex(next);
    },
    [side, index, cardIds.length],
  );

  const onKey = useCallback(
    (key: string) => {
      if (key === "ArrowRight" || key === " " || key === "Enter") step(1);
      else if (key === "ArrowLeft") step(-1);
    },
    [step],
  );

  const play = (ref: string) => {
    if (!rendered) return;
    const [which, n] = ref.split(":");
    const tags = which === "q" ? rendered.questionAv : rendered.answerAv;
    const tag = tags[Number(n)];
    if (tag) void playTags([tag]);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={tr("actions-preview")} width={720}>
      <div
        // Holds the initial focus, so Space and the arrows work straight away.
        tabIndex={-1}
        data-autofocus
        className="flex h-[min(62vh,560px)] flex-col outline-none"
        onKeyDown={(e) => {
          if (["ArrowRight", "ArrowLeft", " ", "Enter"].includes(e.key) && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
            onKey(e.key);
          }
        }}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-canvas">
          {error ? (
            <p className="selectable grid h-full place-items-center px-6 text-center text-control text-danger">{error}</p>
          ) : (
            <>
              <CardFrame
                content={content}
                // A block frame: inline, its line box overflows the clipped area by a few pixels.
                className="block size-full border-0"
                title={tr("actions-preview")}
                onKey={(k) => onKey(k.key)}
                onCommand={(cmd) => {
                  if (cmd === "ans") setSide("answer");
                  else if (cmd.startsWith("play:")) play(cmd.slice(5));
                }}
              />
              {!rendered && (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner className="size-5" />
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 pb-3 pt-3">
          <IconButton label={tb("previewPrev")} disabled={index === 0 && side === "question"} onClick={() => step(-1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton
            label={tb("previewNext")}
            disabled={index === cardIds.length - 1 && side === "answer"}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </IconButton>
          <span className="tabular text-caption text-ink-3">
            {index + 1} / {cardIds.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant={side === "question" ? "primary" : "secondary"}
              onClick={() => setSide(side === "question" ? "answer" : "question")}
            >
              {side === "question" ? tr("studying-show-answer") : tr("browsing-question")}
              <Kbd className={side === "question" ? "border-transparent bg-transparent text-on-accent" : ""}>Space</Kbd>
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

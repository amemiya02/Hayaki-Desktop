// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The live preview beside the Card Template editor. */
import { AlertTriangle, Info, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CardFrame, type CardFrameContent } from "@/components/CardFrame";
import { cn, IconButton, Menu, MenuCheckItem, MenuContent, MenuTrigger, Segmented, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { AVTag } from "@/lib/anki/proto/anki/card_rendering_pb";
import type { Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { direction, firstLanguage, tr } from "@/lib/i18n";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { tn } from "@/lib/strings/notetypes";
import { playTags, stopAudio } from "@/lib/study/audio";
import { useResolvedAppearance } from "@/lib/useAppearance";
import { SelectField } from "@/screens/deck-options/controls";

import type { Loaded } from "./Editor";
import { addedFields, isCloze } from "./model";
import { bodyClass, clozeNumbers, flattenNodes, playButtons, templateForPreview, typeAnswerPreview } from "./preview";

type Side = "question" | "answer";

interface Rendered {
  html: string;
  css: string;
  bodyClass: string;
  av: AVTag[];
}

export function TemplatePreview({ working, loaded, index, initialSide }: { working: Notetype; loaded: Loaded; index: number; initialSide: Side }) {
  const theme = usePrefs((s) => s.theme);
  const resolved = useResolvedAppearance();
  const [side, setSide] = useState<Side>(initialSide);
  const [fillEmpty, setFillEmpty] = useState(!loaded.realNote);
  const [night, setNight] = useState(resolved !== "light");
  const cloze = isCloze(working);
  const numbers = useMemo(() => clozeNumbers(loaded.note.fields), [loaded.note]);
  const [clozeNumber, setClozeNumber] = useState(numbers[0]);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSide(initialSide), [initialSide]);

  const template = working.templates[index];
  const css = working.config?.css ?? "";
  const cardOrd = cloze ? clozeNumber - 1 : index;
  // Only what the preview depends on, so unrelated edits do not re-render it.
  const templateKey = `${template?.config?.qFormat}\u0000${template?.config?.aFormat}\u0000${template?.ord?.val}\u0000${working.fields.map((f) => `${f.ord?.val}:${f.name}`).join("|")}`;

  useEffect(() => {
    let cancelled = false;
    // Wait for typing to pause, as clayout does.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const request = templateForPreview(loaded.original, working, index);
          const output = await core.renderUncommittedCard({
            note: loaded.note,
            cardOrd,
            template: request,
            fillEmpty,
            partialRender: false,
          });
          const text = flattenNodes(side === "question" ? output.questionNodes : output.answerNodes);
          const extracted = await core.extractAvTags({ text, questionSide: side === "question" });
          let html = extracted.text;
          if (html.includes("[[type:")) {
            const compared = side === "answer" ? (await core.compareAnswer({ expected: "example", provided: "sample", combining: true })).val : "";
            html = typeAnswerPreview(html, side, compared, tr("card-templates-type-boxes-warning"));
          }
          if (cancelled) return;
          setRendered({ html: playButtons(html, tr("actions-replay-audio")), css, bodyClass: bodyClass(cardOrd, night), av: extracted.avTags });
          setError(null);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `working` is read through templateKey and css to avoid needless renders.
  }, [templateKey, css, side, fillEmpty, night, cardOrd, index, loaded]);

  useEffect(() => () => stopAudio(), []);

  const frameAppearance = night ? (resolved === "light" ? "dark" : resolved) : "light";
  const content = useMemo<CardFrameContent | null>(
    () =>
      rendered && {
        html: rendered.html,
        css: rendered.css,
        bodyClass: rendered.bodyClass,
        side,
        frame: { dark: night, vars: cardFrameVars(theme, frameAppearance), dir: direction(), lang: firstLanguage() },
      },
    [rendered, side, night, theme, frameAppearance],
  );

  const added = addedFields(working);
  const notice = added.length ? tn("previewNewFields") : !loaded.realNote ? tn("previewExample") : null;

  return (
    <section aria-label={tr("card-templates-preview-box")} className="flex min-h-0 flex-col gap-2 px-5 pb-4 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={tn("previewSide")}
          value={side}
          options={[
            { value: "question", label: tr("card-templates-front-preview") },
            { value: "answer", label: tr("card-templates-back-preview") },
          ]}
          onChange={setSide}
        />
        {cloze && numbers.length > 1 && (
          <div className="w-[140px] [&_button]:w-full">
            <SelectField
              label={tn("clozeCard")}
              value={clozeNumber}
              choices={numbers.map((n) => ({ value: n, label: tr("card-templates-card", { val: n }) }))}
              onChange={setClozeNumber}
            />
          </div>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={tr("card-templates-preview-settings")} className="ml-auto">
              <SlidersHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuCheckItem checked={fillEmpty} onSelect={() => setFillEmpty(!fillEmpty)}>
              {tr("card-templates-fill-empty")}
            </MenuCheckItem>
            <MenuCheckItem checked={night} onSelect={() => setNight(!night)}>
              {tr("card-templates-night-mode")}
            </MenuCheckItem>
          </MenuContent>
        </Menu>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-canvas">
        <CardFrame
          content={content}
          className="size-full border-0"
          title={tr("card-templates-preview-box")}
          onCommand={(cmd) => {
            if (cmd === "ans") setSide("answer");
            else if (cmd.startsWith("play:") && rendered) {
              const tag = rendered.av[Number(cmd.split(":")[2])];
              if (tag) void playTags([tag]);
            }
          }}
        />
        {!rendered && !error && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner className="size-5" />
          </div>
        )}
        {error && (
          <div
            role="alert"
            className={cn(
              "absolute inset-x-2 bottom-2 flex items-start gap-2 rounded-[10px] border border-line bg-raised px-3 py-2 text-[12.5px] text-danger shadow-pop",
            )}
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span className="selectable min-w-0 break-words">
              <span className="font-medium">{tn("previewFailed")}</span> {error}
            </span>
          </div>
        )}
      </div>
      {notice && (
        <p className="flex items-start gap-1.5 text-[12px] text-ink-3">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}
    </section>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * A live preview of the Card the fields would make, rendered by the core from
 * the uncommitted Note and shown in the isolated card page.
 */
import { useEffect, useMemo, useState } from "react";

import { CardFrame, type CardFrameContent } from "@/components/CardFrame";
import { cn, fieldClass, Segmented } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { AVTag, RenderedTemplateNode } from "@/lib/anki/proto/anki/card_rendering_pb";
import { Notetype_Config_Kind, type Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { direction, firstLanguage, tr } from "@/lib/i18n";
import { cardFrameVars, usePrefs } from "@/lib/prefs";
import { te } from "@/lib/strings/editor";
import { playTags } from "@/lib/study/audio";
import { useResolvedAppearance } from "@/lib/useAppearance";

import { clozeNumbersIn } from "./markup";
import { escapeAttr } from "./media-src";

const AV_REF = /\[anki:play:([qa]):(\d+)\]/g;
const TYPE_ANSWER = /\[\[type:.+?\]\]/g;

function flatten(nodes: RenderedTemplateNode[]): string {
  return nodes
    .map((node) =>
      node.value.case === "text" ? node.value.value : node.value.case === "replacement" ? node.value.value.currentText : "",
    )
    .join("");
}

function playButtons(text: string): string {
  return text.replace(
    AV_REF,
    (_, side: string, index: string) =>
      `<a class="replay-button soundLink" href="#" data-play="${side}:${index}" draggable="false" aria-label="${escapeAttr(tr("actions-replay-audio"))}">` +
      `<svg class="playImage" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/>` +
      `<path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z"/></svg></a>`,
  );
}

interface Rendered {
  question: string;
  answer: string;
  css: string;
  empty: boolean;
  av: { q: AVTag[]; a: AVTag[] };
}

export type PreviewSide = "question" | "answer";

/**
 * `side` makes the side controlled: the host draws the side switch in its own
 * pane header, and the preview shows only the Card and its template chooser.
 */
export function CardPreview({
  notetype,
  fields,
  tags,
  side: controlledSide,
}: {
  notetype: Notetype;
  fields: string[];
  tags: string[];
  side?: PreviewSide;
}) {
  const theme = usePrefs((s) => s.theme);
  const resolved = useResolvedAppearance();
  const night = resolved !== "light";
  const isCloze = notetype.config?.kind === Notetype_Config_Kind.CLOZE;
  const [ownSide, setSide] = useState<PreviewSide>("question");
  const side = controlledSide ?? ownSide;
  const [ord, setOrd] = useState(0);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [failed, setFailed] = useState(false);

  /** One choice per Card Template, or per cloze number on a cloze Note Type. */
  const cards = useMemo(() => {
    if (isCloze) {
      const numbers = clozeNumbersIn(fields);
      return (numbers.length ? numbers : [1]).map((n) => ({ ord: n - 1, label: tr("card-templates-card", { val: n }) }));
    }
    return notetype.templates.map((template, i) => ({ ord: i, label: template.name }));
  }, [isCloze, fields, notetype]);

  const current = cards.find((c) => c.ord === ord) ?? cards[0];

  useEffect(() => {
    if (!current) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const template = notetype.templates[isCloze ? 0 : current.ord];
        const output = await core.renderUncommittedCard({
          note: { notetypeId: notetype.id, fields, tags },
          cardOrd: current.ord,
          template,
          fillEmpty: false,
          partialRender: false,
        });
        const [q, a] = await Promise.all([
          core.extractAvTags({ text: flatten(output.questionNodes), questionSide: true }),
          core.extractAvTags({ text: flatten(output.answerNodes), questionSide: false }),
        ]);
        if (!live) return;
        setRendered({
          question: playButtons(q.text.replace(TYPE_ANSWER, "")),
          answer: playButtons(a.text.replace(TYPE_ANSWER, "")),
          css: output.css,
          empty: output.isEmpty,
          av: { q: q.avTags, a: a.avTags },
        });
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [notetype, isCloze, current, fields, tags]);

  const content = useMemo<CardFrameContent | null>(() => {
    if (!rendered || !current) return null;
    return {
      html: side === "question" ? rendered.question : rendered.answer,
      css: rendered.css,
      bodyClass: ["card", `card${current.ord + 1}`, night ? "nightMode night_mode" : ""].filter(Boolean).join(" "),
      side,
      frame: { dark: night, vars: cardFrameVars(theme, resolved), dir: direction(), lang: firstLanguage() },
    };
  }, [rendered, side, current, night, theme, resolved]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {controlledSide === undefined ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
          <Segmented
            label={tr("actions-preview")}
            value={side}
            onChange={setSide}
            options={[
              { value: "question", label: te("question") },
              { value: "answer", label: te("answer") },
            ]}
          />
          {cards.length > 1 && (
          <select
            aria-label={tr("card-stats-card-template")}
            value={current?.ord ?? 0}
            onChange={(e) => setOrd(Number(e.target.value))}
            className={cn(fieldClass, "h-7 w-auto min-w-0 max-w-[200px] pe-7 text-caption")}
          >
            {cards.map((card) => (
              <option key={card.ord} value={card.ord}>
                {card.label}
              </option>
            ))}
          </select>
        )}
        </div>
      ) : (
        cards.length > 1 && <div className="flex shrink-0 items-center px-4 pb-2.5">{cards.length > 1 && (
          <select
            aria-label={tr("card-stats-card-template")}
            value={current?.ord ?? 0}
            onChange={(e) => setOrd(Number(e.target.value))}
            className={cn(fieldClass, "h-7 w-auto min-w-0 max-w-[200px] pe-7 text-caption")}
          >
            {cards.map((card) => (
              <option key={card.ord} value={card.ord}>
                {card.label}
              </option>
            ))}
          </select>
        )}</div>
      )}
      <div className="relative mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-canvas">
        <CardFrame
          content={content}
          title={tr("actions-preview")}
          className="absolute inset-0 h-full w-full border-0 bg-transparent"
          onCommand={(cmd) => {
            const match = /^play:([qa]):(\d+)$/.exec(cmd);
            if (!match || !rendered) return;
            const tag = (match[1] === "q" ? rendered.av.q : rendered.av.a)[Number(match[2])];
            if (tag) void playTags([tag]);
          }}
        />
        {(failed || rendered?.empty) && side === "question" && (
          // One app-styled message covers the core's own empty-card notice.
          <div className="absolute inset-0 grid place-items-center bg-canvas px-6">
            <p className="max-w-[260px] text-center text-control leading-relaxed text-ink-2">
              {failed ? te("previewFailed") : te("previewEmpty")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

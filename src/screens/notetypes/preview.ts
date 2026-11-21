// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The live Card Template preview, as clayout.py draws it: the core renders
 * the uncommitted template against a real Note of this Note Type (or an empty
 * one with Fill Empty), typing boxes show an example, and the working
 * styling replaces the saved one.
 */
import { clone } from "@bufbuild/protobuf";

import type { RenderedTemplateNode } from "@/lib/anki/proto/anki/card_rendering_pb";
import { Notetype_TemplateSchema, type Notetype, type Notetype_Template } from "@/lib/anki/proto/anki/notetypes_pb";

import { mapFieldsInTemplate, renamedFields } from "./model";

export function flattenNodes(nodes: RenderedTemplateNode[]): string {
  return nodes
    .map((node) =>
      node.value.case === "text" ? node.value.value : node.value.case === "replacement" ? node.value.value.currentText : "",
    )
    .join("");
}

/**
 * The template to render. The core reads field names from the saved Note
 * Type, so names changed since the last save are mapped back to the saved
 * ones; the Note's fields are still in their saved order.
 */
export function templateForPreview(original: Notetype, edited: Notetype, index: number): Notetype_Template {
  const template = clone(Notetype_TemplateSchema, edited.templates[index]);
  const back = renamedFields(original, edited);
  if (template.config && back.size) {
    template.config.qFormat = mapFieldsInTemplate(template.config.qFormat, back);
    template.config.aFormat = mapFieldsInTemplate(template.config.aFormat, back);
  }
  return template;
}

const TYPE_FILTER = /\[\[type:.+?\]\]/;
const TYPE_FILTER_ALL = /\[\[type:.+?\]\]/g;

/** Clayout's `maybeTextInput`: one example typing box, a warning for any more. */
export function typeAnswerPreview(html: string, side: "question" | "answer", compared: string, warning: string): string {
  if (!html.includes("[[type:")) return html;
  const withoutHr = html.replace("<hr id=answer>", "");
  const hadHr = withoutHr.length !== html.length;
  const replacement =
    side === "question"
      ? "<center><input id='typeans' type=text value='example' readonly='readonly'></center>"
      : `${hadHr ? "<hr id=answer>" : ""}${compared}`;
  const once = withoutHr.replace(TYPE_FILTER, () => replacement);
  return once.replace(TYPE_FILTER_ALL, () => `<center><b>${warning}</b></center>`);
}

/** Cloze numbers used in the Note's fields, ascending; at least [1]. */
export function clozeNumbers(fields: string[]): number[] {
  const numbers = new Set<number>();
  for (const field of fields) {
    for (const match of field.matchAll(/\{\{c(\d+)::/g)) {
      const n = Number(match[1]);
      if (n > 0) numbers.add(n);
    }
  }
  const out = [...numbers].sort((a, b) => a - b);
  return out.length ? out : [1];
}

const AV_REF = /\[anki:(play:[qa]:\d+)\]/g;

/** Turns `[anki:play:q:0]` into the replay button the card page knows. */
export function playButtons(text: string, label: string): string {
  const safe = label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return text.replace(
    AV_REF,
    (_, ref: string) =>
      `<a class="replay-button soundLink" href="#" data-play="${ref.slice(5)}" draggable="false" aria-label="${safe}">` +
      `<svg class="playImage" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/>` +
      `<path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z"/></svg></a>`,
  );
}

export function bodyClass(cardOrd: number, night: boolean): string {
  return [`card`, `card${cardOrd + 1}`, night ? "nightMode night_mode" : ""].filter(Boolean).join(" ");
}

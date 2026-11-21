// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Turns a Card into the HTML the card page shows, the way Anki's desktop
 * reviewer does: the core renders both sides, sound and TTS tags become play
 * buttons, and a `[[type:Field]]` becomes an input on the question side and
 * the compared answer on the answer side.
 */
import type { AVTag } from "../anki/proto/anki/card_rendering_pb";
import type { RenderedTemplateNode } from "../anki/proto/anki/card_rendering_pb";
import {
  compareAnswer,
  extractAvTags,
  extractClozeForTyping,
  getNote,
  getNotetype,
  renderExistingCard,
} from "../anki/generated/core";
import type { Card } from "../anki/proto/anki/cards_pb";
import { tr } from "../i18n";

export interface TypeAnswer {
  expected: string;
  combining: boolean;
  font: string;
  size: number;
}

export interface RenderedCard {
  cardId: bigint;
  /** Question HTML with play buttons and any type-answer input. */
  question: string;
  /** Answer HTML before the typed answer is compared. */
  answerTemplate: string;
  css: string;
  bodyClass: string;
  questionAv: AVTag[];
  answerAv: AVTag[];
  typeAnswer: TypeAnswer | null;
  /** Whether either side needs MathJax, so it can load before it is shown. */
  hasMath: boolean;
  /** Preferences > Review > Show play buttons is off: sound references are removed. */
  hidePlayButtons: boolean;
}

export interface RenderOptions {
  hidePlayButtons?: boolean;
}

const TYPE_ANSWER = /\[\[type:(.+?)\]\]/;
const AV_REF = /\[anki:(play:[qa]:\d+)\]/g;
const MATH = /\\\[(.*?)\\\]|\\\((.*?)\\\)/su;

function flatten(nodes: RenderedTemplateNode[]): string {
  return nodes
    .map((node) =>
      node.value.case === "text"
        ? node.value.value
        : node.value.case === "replacement"
          ? node.value.value.currentText
          : "",
    )
    .join("");
}

function playButtons(text: string, hide = false): string {
  // Anki's `strip_av_refs` when the play buttons are hidden.
  if (hide) return text.replace(AV_REF, "");
  return text.replace(
    AV_REF,
    (_, ref: string) =>
      `<a class="replay-button soundLink" href="#" data-play="${ref.slice(5)}" draggable="false" aria-label="${escapeAttr(tr("actions-replay-audio"))}">` +
      `<svg class="playImage" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/>` +
      `<path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z"/></svg></a>`,
  );
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeCss(text: string): string {
  return text.replace(/['\\]/g, "");
}

async function resolveTypeAnswer(card: Card, html: string): Promise<{ html: string; typeAnswer: TypeAnswer | null }> {
  const match = TYPE_ANSWER.exec(html);
  if (!match) return { html, typeAnswer: null };
  let field = match[1];
  let clozeOrd: number | null = null;
  let combining = true;
  if (field.startsWith("cloze:")) {
    clozeOrd = card.templateIdx + 1;
    field = field.split(":")[1];
  }
  if (field.startsWith("nc:")) {
    combining = false;
    field = field.split(":")[1];
  }
  const note = await getNote({ nid: card.noteId });
  const notetype = await getNotetype({ ntid: note.notetypeId });
  const index = notetype.fields.findIndex((f) => f.name === field);
  if (index < 0) {
    const warning = clozeOrd
      ? tr("studying-please-run-toolsempty-cards")
      : tr("studying-type-answer-unknown-field", { val: field });
    return { html: html.replace(TYPE_ANSWER, warning), typeAnswer: null };
  }
  let expected = note.fields[index] ?? "";
  if (clozeOrd) {
    expected = (await extractClozeForTyping({ text: expected, ordinal: clozeOrd })).val;
  }
  if (!expected) return { html: html.replace(TYPE_ANSWER, ""), typeAnswer: null };
  const config = notetype.fields[index].config;
  const font = escapeCss(config?.fontName || "Arial");
  const size = config?.fontSize || 20;
  const input =
    `<center><input type="text" id="typeans" autocomplete="off" autocorrect="off" spellcheck="false" ` +
    `style="font-family: '${font}'; font-size: ${size}px;"></center>`;
  return { html: html.replace(TYPE_ANSWER, input), typeAnswer: { expected, combining, font, size } };
}

export async function renderCard(card: Card, nightMode: boolean, { hidePlayButtons = false }: RenderOptions = {}): Promise<RenderedCard> {
  const output = await renderExistingCard({ cardId: card.id, browser: false, partialRender: false });
  const [q, a] = await Promise.all([
    extractAvTags({ text: flatten(output.questionNodes), questionSide: true }),
    extractAvTags({ text: flatten(output.answerNodes), questionSide: false }),
  ]);
  const { html: question, typeAnswer } = await resolveTypeAnswer(card, q.text);
  const bodyClass = [`card`, `card${card.templateIdx + 1}`, nightMode ? "nightMode night_mode" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    cardId: card.id,
    question: playButtons(question, hidePlayButtons),
    answerTemplate: a.text,
    css: output.css,
    bodyClass,
    questionAv: q.avTags,
    answerAv: a.avTags,
    typeAnswer,
    hasMath: MATH.test(q.text) || MATH.test(a.text),
    hidePlayButtons,
  };
}

/** The answer side, with the typed answer compared like Anki does. */
export async function renderAnswer(rendered: RenderedCard, typed: string | null): Promise<string> {
  let html = rendered.answerTemplate;
  const type = rendered.typeAnswer;
  const hide = rendered.hidePlayButtons;
  if (!type) return playButtons(html.replace(TYPE_ANSWER, ""), hide);
  const original = html;
  const withoutHr = html.replace("<hr id=answer>", "");
  const hadHr = withoutHr.length !== html.length;
  html = withoutHr;
  if (hadHr && !TYPE_ANSWER.test(html)) return playButtons(original, hide);
  const compared = await compareAnswer({ expected: type.expected, provided: typed ?? "", combining: type.combining });
  let block = `<div style="font-family: '${type.font}'; font-size: ${type.size}px">${compared.val}</div>`;
  if (hadHr) block = `<hr id=answer>${block}`;
  return playButtons(html.replace(TYPE_ANSWER, () => block), hide);
}

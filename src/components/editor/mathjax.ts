// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * MathJax in a field. The collection stores `\(x\)` and `\[x\]`; the editor
 * shows each expression as one atomic chip you click to edit, as Anki's
 * editor does with its `<anki-mathjax>` element. The two rewrites here are
 * inverses, so a chip never reaches the collection.
 */
import { decodeEntities, escapeAttr } from "./media-src";

const MATH = /\\\((.*?)\\\)|\\\[(.*?)\\\]/gs;
const CHIP = /<span\b[^>]*\bdata-anki="mathjax"[^>]*>[\s\S]*?<\/span>/g;
const TAG = /(<[^>]*>)/;

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The text of an expression as the person edits it: entities in the stored form are unescaped. */
export function mathSource(stored: string): string {
  return decodeEntities(stored);
}

/** The stored form of edited text: only `&`, `<` and `>` are escaped, as Anki's editor does. */
export function mathStored(source: string): string {
  return escapeHtmlText(source);
}

/** One expression as the editor shows it. `stored` is the text as it sits in the field. */
export function mathChip(stored: string, block: boolean, autofocus = false): string {
  return (
    `<span data-anki="mathjax" data-block="${block}"${autofocus ? ' data-autofocus=""' : ""} contenteditable="false" ` +
    `data-mathjax="${escapeAttr(stored)}">${escapeHtmlText(mathSource(stored))}</span>`
  );
}

/** Stored field HTML with each `\(..\)` and `\[..\]` in its text turned into a chip. */
export function mathToDisplay(html: string): string {
  if (!html || !html.includes("\\")) return html;
  return html
    .split(TAG)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(MATH, (_, inline?: string, block?: string) => mathChip(inline ?? block ?? "", inline === undefined)),
    )
    .join("");
}

/** Editor HTML back to stored HTML. */
export function displayToMath(html: string): string {
  if (!html || !html.includes('data-anki="mathjax"')) return html;
  return html.replace(CHIP, (chip) => {
    const stored = decodeEntities(/\bdata-mathjax="([^"]*)"/.exec(chip)?.[1] ?? "");
    return /\bdata-block="true"/.test(chip) ? `\\[${stored}\\]` : `\\(${stored}\\)`;
  });
}

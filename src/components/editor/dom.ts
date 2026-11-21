// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Editing commands on a field's rich-text element or HTML textarea. Changes
 * go through `execCommand`, so they join the field's own undo history and
 * fire the input events the fields already listen to.
 */
import type { Surround } from "./markup";
import { surroundText } from "./markup";

/** The last selection inside each editable, kept while a popover or dialog has focus. */
const savedRanges = new WeakMap<HTMLElement, Range>();

export function rememberSelection(element: HTMLElement): void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (element.contains(range.commonAncestorContainer)) savedRanges.set(element, range.cloneRange());
}

/** Focuses the element and puts back its last selection (or the caret at the end). */
export function restoreSelection(element: HTMLElement): void {
  if (element instanceof HTMLTextAreaElement) {
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    return;
  }
  const selection = document.getSelection();
  const inside =
    selection && selection.rangeCount > 0 && element.contains(selection.getRangeAt(0).commonAncestorContainer);
  if (document.activeElement !== element) element.focus({ preventScroll: true });
  if (inside && document.activeElement === element) return;
  const saved = savedRanges.get(element);
  const range = saved && element.contains(saved.commonAncestorContainer) ? saved : caretAtEnd(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretAtEnd(element: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  return range;
}

export function focusAtEnd(element: HTMLElement): void {
  element.focus({ preventScroll: false });
  if (element instanceof HTMLTextAreaElement) {
    element.setSelectionRange(element.value.length, element.value.length);
    return;
  }
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caretAtEnd(element));
}

/** Runs a formatting command in a rich-text element. */
export function exec(element: HTMLElement, command: string, value?: string): void {
  restoreSelection(element);
  // Colours become `<span style>`; bold, italic and the rest stay `<b>`, `<i>`, `<u>` as Anki writes them.
  const css = command === "foreColor" || command === "hiliteColor";
  document.execCommand("styleWithCSS", false, String(css));
  document.execCommand(command, false, value);
}

export function isCommandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function selectedHtml(element: HTMLElement): string {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return "";
  const holder = document.createElement("div");
  holder.append(range.cloneContents());
  return holder.innerHTML;
}

/** Inserts HTML at the selection in a rich-text element. */
export function insertHtml(element: HTMLElement, html: string): void {
  restoreSelection(element);
  document.execCommand("insertHTML", false, html);
}

/** Inserts text at the selection in a textarea, keeping its undo history. */
export function insertText(element: HTMLTextAreaElement, text: string): void {
  restoreSelection(element);
  if (!document.execCommand("insertText", false, text)) {
    element.setRangeText(text, element.selectionStart, element.selectionEnd, "end");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Wraps the selection, or puts the caret between prefix and suffix when nothing is selected. */
export function surround(element: HTMLElement, wrap: Surround): void {
  if (element instanceof HTMLTextAreaElement) {
    restoreSelection(element);
    const { selectionStart: start, selectionEnd: end, value } = element;
    const next = surroundText(value, start, end, wrap);
    insertText(element, wrap.prefix + value.slice(start, end) + wrap.suffix);
    element.setSelectionRange(next.selectionStart, next.selectionEnd);
    return;
  }
  restoreSelection(element);
  const inner = selectedHtml(element);
  document.execCommand("insertHTML", false, wrap.prefix + inner + wrap.suffix);
  if (!inner) {
    const selection = document.getSelection();
    for (let i = 0; i < wrap.suffix.length; i++) selection?.modify("move", "backward", "character");
  }
}

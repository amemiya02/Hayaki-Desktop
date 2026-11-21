// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { StockNotetype_OriginalStockKind, type Notetype } from "@/lib/anki/proto/anki/notetypes_pb";

/** Image Occlusion Notes are edited on their image, in the Image Occlusion screen. */
export function isImageOcclusion(notetype: Notetype | null | undefined): boolean {
  return notetype?.config?.originalStockKind === StockNotetype_OriginalStockKind.IMAGE_OCCLUSION;
}

/** Text the editor wraps around a selection: cloze deletions and MathJax. */

export interface Surround {
  prefix: string;
  suffix: string;
}

const CLOZE = /\{\{c(\d+)::/g;

/** Cloze numbers used in the fields, read the way Anki's editor reads them. */
export function clozeNumbersIn(fields: string[]): number[] {
  const numbers = new Set<number>();
  for (const field of fields) {
    CLOZE.lastIndex = 0;
    for (let m = CLOZE.exec(field); m; m = CLOZE.exec(field)) numbers.add(Number(m[1]));
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * The cloze number for a new deletion: one past the highest in use (a new
 * Card), or the highest itself (the same Card). Never below 1.
 */
export function nextClozeNumber(numbers: readonly number[], increment: boolean): number {
  const highest = numbers.reduce((max, n) => Math.max(max, n), 0);
  return Math.max(1, increment ? highest + 1 : highest);
}

export function clozeSurround(n: number): Surround {
  return { prefix: `{{c${n}::`, suffix: "}}" };
}

export type MathKind = "inline" | "block" | "chemistry";

export function mathSurround(kind: MathKind): Surround {
  switch (kind) {
    case "inline":
      return { prefix: "\\(", suffix: "\\)" };
    case "block":
      return { prefix: "\\[", suffix: "\\]" };
    case "chemistry":
      return { prefix: "\\(\\ce{", suffix: "}\\)" };
  }
}

/** Wraps `[start, end)` of plain text; returns the new text and where the selection goes. */
export function surroundText(
  text: string,
  start: number,
  end: number,
  { prefix, suffix }: Surround,
): { text: string; selectionStart: number; selectionEnd: number } {
  const selected = text.slice(start, end);
  return {
    text: text.slice(0, start) + prefix + selected + suffix + text.slice(end),
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selected.length,
  };
}

/**
 * Field contents when the Note Type changes in Add, as Anki does: fields with
 * the same name keep their content; the rest carry over by position when the
 * old field at that position has no namesake in the new Note Type.
 */
export function carryFields(
  oldNames: readonly string[],
  oldValues: readonly string[],
  newNames: readonly string[],
  newValues: readonly string[],
): string[] {
  const result = [...newValues];
  newNames.forEach((name, n) => {
    const same = oldNames.indexOf(name);
    if (same >= 0) {
      result[n] = oldValues[same] ?? "";
    } else if (n < oldNames.length && !newNames.includes(oldNames[n])) {
      result[n] = oldValues[n] ?? "";
    }
  });
  return result;
}

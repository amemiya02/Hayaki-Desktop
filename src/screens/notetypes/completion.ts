// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** What to offer inside `{{ }}` while editing a Card Template. */

/** Anki's special fields (rslib template.rs). */
export const SPECIAL_FIELDS = ["FrontSide", "Tags", "Type", "Deck", "Subdeck", "Card", "CardFlag", "CardID"];

/** Filters a replacement can start with. */
export const FILTERS = ["cloze:", "type:", "hint:", "text:", "furigana:", "kana:", "kanji:", "cloze-only:", "type:cloze:", "type:nc:"];

export interface FieldContext {
  /** Offset where the typed name starts. */
  from: number;
  /** The part of the name typed so far. */
  typed: string;
  /** Whether `}}` already follows the cursor. */
  closed: boolean;
}

/**
 * Finds an open `{{` before the cursor, skipping a leading `#`, `^` or `/`
 * and any filters, so the name being typed can be completed.
 */
export function fieldContext(before: string, after: string): FieldContext | null {
  const open = before.lastIndexOf("{{");
  if (open < 0) return null;
  const inside = before.slice(open + 2);
  if (inside.includes("}") || inside.includes("\n")) return null;
  let start = open + 2;
  let rest = inside;
  if (/^[#^/]/.test(rest)) {
    start += 1;
    rest = rest.slice(1);
  }
  const colon = rest.lastIndexOf(":");
  if (colon >= 0) {
    start += colon + 1;
    rest = rest.slice(colon + 1);
  }
  return { from: start, typed: rest, closed: after.startsWith("}}") };
}

export interface FieldOption {
  label: string;
  kind: "field" | "special" | "filter";
}

export function fieldOptions(fields: string[], typed: string, withFilters: boolean): FieldOption[] {
  const lower = typed.toLocaleLowerCase();
  const match = (name: string) => name.toLocaleLowerCase().startsWith(lower);
  const out: FieldOption[] = fields.filter(match).map((label) => ({ label, kind: "field" as const }));
  for (const label of SPECIAL_FIELDS) if (match(label) && !fields.includes(label)) out.push({ label, kind: "special" });
  if (withFilters) for (const label of FILTERS) if (match(label)) out.push({ label, kind: "filter" });
  return out;
}

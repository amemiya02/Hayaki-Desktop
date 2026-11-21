// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Tag text rules, matching Anki: no spaces, `::` separates levels, case-insensitive uniqueness. */

/** Cleans one typed tag; returns "" when nothing usable is left. */
export function normalizeTag(input: string): string {
  return input
    .replace(/[\s　]+/g, "")
    .replace(/:{3,}/g, "::")
    .replace(/^:+|:+$/g, "");
}

/** Splits pasted or typed text into tags. */
export function splitTags(input: string): string[] {
  return input
    .split(/[\s　]+/)
    .map(normalizeTag)
    .filter(Boolean);
}

/** Adds tags, skipping any already present in another case. */
export function addTags(tags: readonly string[], added: readonly string[]): string[] {
  const result = [...tags];
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  for (const tag of added) {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** The levels of a hierarchical tag: `lang::ja::verbs` → ["lang", "ja", "verbs"]. */
export function tagLevels(tag: string): string[] {
  return tag.split("::").filter((part) => part !== "");
}

/** Whether two tag lists hold the same tags in the same order. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

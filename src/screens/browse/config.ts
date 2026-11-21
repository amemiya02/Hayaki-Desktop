// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The browser's collection settings, under the same keys Anki uses
 * (`pylib/anki/browser.py`), so columns, sorting and mode carry over between
 * Hayaki and Anki. Writes are quiet: they change no Cards or Notes.
 */
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_Bool } from "@/lib/anki/proto/anki/config_pb";
import { tr } from "@/lib/i18n";

export type Mode = "cards" | "notes";

export const DEFAULT_COLUMNS: Record<Mode, string[]> = {
  cards: ["noteFld", "template", "cardDue", "deck"],
  notes: ["noteFld", "note", "template", "noteTags"],
};

const KEYS = {
  columns: { cards: "activeCols", notes: "activeNoteCols" },
  sortColumn: { cards: "sortType", notes: "noteSortType" },
  sortBackwards: { cards: "sortBackwards", notes: "browserNoteSortBackwards" },
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const out = await core.getConfigJson({ val: key });
    return JSON.parse(decoder.decode(out.json)) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await core.setConfigJson({ key, valueJson: encoder.encode(JSON.stringify(value)), undoable: false }, { quiet: true });
}

export async function readNotesMode(): Promise<boolean> {
  return (await core.getConfigBool({ key: ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE })).val;
}

export async function writeNotesMode(notes: boolean): Promise<void> {
  await core.setConfigBool({ key: ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE, value: notes, undoable: false }, { quiet: true });
}

export async function readColumns(mode: Mode): Promise<string[]> {
  const columns = await readJson<unknown>(KEYS.columns[mode], DEFAULT_COLUMNS[mode]);
  return Array.isArray(columns) && columns.length > 0 && columns.every((c) => typeof c === "string")
    ? (columns as string[])
    : DEFAULT_COLUMNS[mode];
}

/** Saves the columns and makes them the core's active ones, as Anki does. */
export async function writeColumns(mode: Mode, columns: string[]): Promise<void> {
  await writeJson(KEYS.columns[mode], columns);
  await core.setActiveBrowserColumns({ vals: columns });
}

export interface Sort {
  column: string;
  reverse: boolean;
}

export async function readSort(mode: Mode): Promise<Sort> {
  const [column, reverse] = await Promise.all([
    readJson<unknown>(KEYS.sortColumn[mode], "noteFld"),
    readJson<unknown>(KEYS.sortBackwards[mode], false),
  ]);
  return { column: typeof column === "string" ? column : "noteFld", reverse: reverse === true };
}

export async function writeSort(mode: Mode, sort: Sort): Promise<void> {
  await Promise.all([writeJson(KEYS.sortColumn[mode], sort.column), writeJson(KEYS.sortBackwards[mode], sort.reverse)]);
}

/** Anki's flag names, with any the user renamed in Anki. Index 1 to 7. */
export const FLAG_KEYS = [
  "actions-flag-red",
  "actions-flag-orange",
  "actions-flag-green",
  "actions-flag-blue",
  "actions-flag-pink",
  "actions-flag-turquoise",
  "actions-flag-purple",
] as const;

export async function readFlagLabels(): Promise<string[]> {
  const custom = await readJson<Record<string, string>>("flagLabels", {});
  return FLAG_KEYS.map((key, i) => {
    const label = custom && typeof custom === "object" ? custom[String(i + 1)] : undefined;
    return typeof label === "string" && label.trim() ? label : tr(key);
  });
}

export async function readSavedSearches(): Promise<Record<string, string>> {
  const saved = await readJson<unknown>("savedFilters", {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, string>) : {};
}

export async function writeSavedSearches(saved: Record<string, string>): Promise<void> {
  await writeJson("savedFilters", saved);
}

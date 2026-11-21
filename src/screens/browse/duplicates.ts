// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Find Duplicates, as `Collection.find_dupes` in Anki's `pylib`: Notes whose
 * chosen field has the same text (HTML stripped, media names kept, trimmed) form a
 * group. An empty field never counts.
 */
import * as core from "@/lib/anki/generated/core";
import { StripHtmlRequest_Mode } from "@/lib/anki/proto/anki/card_rendering_pb";

import { group, parsable, type NodeInit } from "./search";

export interface DuplicateGroup {
  value: string;
  noteIds: bigint[];
}

export interface FieldValue {
  noteId: bigint;
  /** The field's text with HTML removed; empty when the Note lacks the field. */
  value: string;
}

/** Groups in the order each first repeats, as Anki lists them. */
export function groupDuplicates(values: FieldValue[]): DuplicateGroup[] {
  const seen = new Map<string, bigint[]>();
  const groups: DuplicateGroup[] = [];
  for (const { noteId, value: raw } of values) {
    // Anki strips the HTML, then trims: a field of only spaces is empty.
    const value = raw.trim();
    if (!value) continue;
    const ids = seen.get(value);
    if (!ids) {
      seen.set(value, [noteId]);
      continue;
    }
    ids.push(noteId);
    if (ids.length === 2) groups.push({ value, noteIds: ids });
  }
  return groups;
}

/** Every distinct field name across Note Types, sorted without regard to case. */
export async function allFieldNames(): Promise<string[]> {
  const types = await core.getNotetypeNames();
  const lists = await Promise.all(types.entries.map((nt) => core.getFieldNames({ ntid: nt.id })));
  const names = new Set<string>();
  for (const list of lists) for (const name of list.vals) names.add(name);
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

const CHUNK = 100;

/**
 * Reads the field in every Note that has it and matches the optional filter.
 * `onProgress` reports how many Notes are read; `isCancelled` stops early.
 */
export async function findDuplicates(
  field: string,
  filter: string,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<DuplicateGroup[]> {
  const nodes: NodeInit[] = [{ filter: { case: "fieldName", value: field } }];
  if (filter.trim()) nodes.unshift(parsable(filter));
  const search = (await core.buildSearchString(group(nodes))).val;
  const ids = (await core.searchNotes({ search })).ids;

  const ordinals = new Map<bigint, number | null>();
  const ordinalFor = async (notetypeId: bigint): Promise<number | null> => {
    if (!ordinals.has(notetypeId)) {
      const names = (await core.getFieldNames({ ntid: notetypeId })).vals;
      const index = names.findIndex((name) => name.toLowerCase() === field.toLowerCase());
      ordinals.set(notetypeId, index < 0 ? null : index);
    }
    return ordinals.get(notetypeId) ?? null;
  };

  const values: FieldValue[] = [];
  onProgress(0, ids.length);
  for (let start = 0; start < ids.length; start += CHUNK) {
    if (isCancelled()) return [];
    const part = await Promise.all(
      ids.slice(start, start + CHUNK).map(async (noteId): Promise<FieldValue> => {
        const note = await core.getNote({ nid: noteId });
        const ord = await ordinalFor(note.notetypeId);
        const raw = ord === null ? "" : (note.fields[ord] ?? "");
        const value = raw ? (await core.stripHtml({ text: raw, mode: StripHtmlRequest_Mode.PRESERVE_MEDIA_FILENAMES })).val : "";
        return { noteId, value };
      }),
    );
    values.push(...part);
    onProgress(Math.min(start + CHUNK, ids.length), ids.length);
  }
  return groupDuplicates(values);
}

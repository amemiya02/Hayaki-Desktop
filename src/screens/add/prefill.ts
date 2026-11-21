// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import * as core from "@/lib/anki/generated/core";
import { useNav } from "@/lib/nav";

/** A Note for the Add screen to open with, as Create Copy sends it. */
export interface AddPrefill {
  notetypeId: bigint;
  deckId: bigint;
  fields: string[];
  tags: string[];
}

let pending: AddPrefill | null = null;

export function setAddPrefill(prefill: AddPrefill): void {
  pending = prefill;
}

/** Hands the prefill over once; later calls get nothing. */
export function takeAddPrefill(): AddPrefill | null {
  const taken = pending;
  pending = null;
  return taken;
}

/** Anki's Create Copy: opens Add with the Note's type, fields and tags, in the given Deck. */
export async function openAddCopy(noteId: bigint, deckId: bigint): Promise<void> {
  const note = await core.getNote({ nid: noteId });
  setAddPrefill({ notetypeId: note.notetypeId, deckId, fields: [...note.fields], tags: [...note.tags] });
  useNav.getState().go({ name: "add" });
}

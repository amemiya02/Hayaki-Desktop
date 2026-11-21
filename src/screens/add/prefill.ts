// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** A Note for the Add screen to open with, as the browser's Create Copy sends it. */
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

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "zustand";

import * as core from "@/lib/anki/generated/core";

import { CustomStudyDialog } from "./CustomStudyDialog";
import { FilteredDeckDialog } from "./FilteredDeckDialog";

type Request =
  | { kind: "filtered"; deckId?: bigint; search?: string; search2?: string; serial: number }
  | { kind: "custom"; deckId: bigint; serial: number };

const useFiltered = create<{ request: Request | null }>(() => ({ request: null }));
let serial = 0;

/** Create or edit a filtered Deck. With no deckId a new one is created. */
export function openFilteredDeck(options?: { deckId?: bigint; search?: string; search2?: string }): void {
  useFiltered.setState({ request: { kind: "filtered", ...options, serial: ++serial } });
}

/** Custom Study for a Deck. */
export function openCustomStudy(deckId: bigint): void {
  useFiltered.setState({ request: { kind: "custom", deckId, serial: ++serial } });
}

/** Rebuilds a filtered Deck; resolves to the number of Cards it now holds. */
export async function rebuildFilteredDeck(deckId: bigint): Promise<number> {
  return (await core.rebuildFilteredDeck({ did: deckId })).count;
}

/** Returns a filtered Deck's Cards to their home Decks. */
export async function emptyFilteredDeck(deckId: bigint): Promise<void> {
  await core.emptyFilteredDeck({ did: deckId });
}

/** Mounted once in the app shell. */
export function FilteredHost() {
  const request = useFiltered((s) => s.request);
  const close = () => useFiltered.setState({ request: null });
  if (!request) return null;
  if (request.kind === "custom") return <CustomStudyDialog key={request.serial} deckId={request.deckId} onClose={close} />;
  return <FilteredDeckDialog key={request.serial} deckId={request.deckId} search={request.search} search2={request.search2} onClose={close} />;
}

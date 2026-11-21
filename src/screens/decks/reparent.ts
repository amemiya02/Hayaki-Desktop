// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { toast } from "sonner";

import * as core from "@/lib/anki/generated/core";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { tr } from "@/lib/i18n";
import { findDeck, leafName } from "@/lib/queries";
import { td } from "@/lib/strings/decks";

import { dropState, TOP_LEVEL } from "./model";

/**
 * Moves a Deck (with its subdecks) under `target`, or to the top level, through
 * the core's undoable op. Resolves true when something moved.
 */
export async function reparentDeck(root: DeckTreeNode | undefined, source: bigint, target: bigint): Promise<boolean> {
  if (!root || dropState(root, source, target) !== "ok") return false;
  const deck = leafName(findDeck(root, source)?.name ?? "");
  try {
    await core.reparentDecks({ deckIds: [source], newParent: target }, { origin: "decks" });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : td("moveFailed"));
    return false;
  }
  const parent = target === TOP_LEVEL ? "" : leafName(findDeck(root, target)?.name ?? "");
  toast(target === TOP_LEVEL ? td("movedTop", { deck }) : td("moved", { deck, parent }), {
    action: { label: tr("undo-undo"), onClick: () => void core.undo() },
  });
  return true;
}

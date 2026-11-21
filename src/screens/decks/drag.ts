// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pointer-driven Deck dragging for the Deck list, the sidebar tree and the
 * Browse sidebar (see `@/lib/pointer-drag`).
 *
 * A row opts in with `deckDragHandlers(...)` and marks itself as a target with
 * `data-deck-drop="<id>"`. The top level is `data-deck-drop="0"`.
 */
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { createPointerDrag } from "@/lib/pointer-drag";
import { findDeck, leafName } from "@/lib/queries";
import { td } from "@/lib/strings/decks";

import { dropState, TOP_LEVEL } from "./model";
import { reparentDeck } from "./reparent";

/** The Deck being dragged. `getRoot` supplies the current tree at drop time, so a refresh during the drag cannot leave a stale answer. */
interface DeckSource {
  node: DeckTreeNode;
  getRoot: () => DeckTreeNode | undefined;
}

const drag = createPointerDrag<DeckSource>({
  attribute: "data-deck-drop",
  label: ({ node }) => leafName(node.name),
  accepts: ({ node, getRoot }, target) => {
    const root = getRoot();
    return !!root && dropState(root, node.deckId, BigInt(target)) === "ok";
  },
  hint: ({ getRoot }, target, valid) => {
    if (!valid) return td("dragInvalid");
    const id = BigInt(target);
    return id === TOP_LEVEL ? td("dragTop") : td("dragInto", { deck: leafName(findDeck(getRoot(), id)?.name ?? "") });
  },
  drop: ({ node, getRoot }, target) => void reparentDeck(getRoot(), node.deckId, BigInt(target)),
});

export const useDeckDrag = drag.useDrag;

export function deckDragHandlers(node: DeckTreeNode, getRoot: () => DeckTreeNode | undefined) {
  return drag.handlers({ node, getRoot }, String(node.deckId));
}

export function useDropTarget(id: bigint) {
  return drag.useTarget(String(id));
}

/** A drop target (and, with `getRoot`, drag source) binding for hosts that build their own rows. */
export function deckDnd(id: bigint, source?: { node: DeckTreeNode; getRoot: () => DeckTreeNode | undefined }) {
  return {
    attribute: "data-deck-drop",
    key: String(id),
    state: drag.useTarget,
    handlers: source ? drag.handlers(source, String(id)) : undefined,
  };
}

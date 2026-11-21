// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Pure rules for moving a Deck inside the Deck tree. `0n` is the top level. */
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";

export const TOP_LEVEL = 0n;

export type DropState = "ok" | "missing" | "self" | "inside-itself" | "already-there" | "filtered-target";

function find(root: DeckTreeNode, id: bigint): DeckTreeNode | undefined {
  if (root.deckId === id) return root;
  for (const child of root.children) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

/** The Deck that holds `id`, or `TOP_LEVEL`. Undefined when the Deck is not in the tree. */
export function parentIdOf(root: DeckTreeNode, id: bigint): bigint | undefined {
  for (const child of root.children) {
    if (child.deckId === id) return root.deckId;
    const found = parentIdOf(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Whether `source` can go under `target` (`TOP_LEVEL` for the top). Mirrors what the core accepts. */
export function dropState(root: DeckTreeNode, source: bigint, target: bigint): DropState {
  const node = find(root, source);
  if (!node || parentIdOf(root, source) === undefined) return "missing";
  if (target === source) return "self";
  if (target !== TOP_LEVEL) {
    const targetNode = find(root, target);
    if (!targetNode) return "missing";
    if (find(node, target)) return "inside-itself";
    if (targetNode.filtered) return "filtered-target";
  }
  return parentIdOf(root, source) === target ? "already-there" : "ok";
}

export interface MoveTarget {
  id: bigint;
  /** Full name, or empty for the top level. */
  name: string;
  depth: number;
}

/** Every place `source` may go, in tree order, narrowed by a case-insensitive text query. */
export function moveTargets(root: DeckTreeNode, source: bigint, query = ""): MoveTarget[] {
  const needle = query.trim().toLowerCase();
  const out: MoveTarget[] = [];
  if (dropState(root, source, TOP_LEVEL) === "ok" && !needle) out.push({ id: TOP_LEVEL, name: "", depth: 0 });
  const walk = (nodes: DeckTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (dropState(root, source, node.deckId) === "ok" && (!needle || node.name.toLowerCase().includes(needle))) {
        out.push({ id: node.deckId, name: node.name, depth });
      }
      walk(node.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return out;
}

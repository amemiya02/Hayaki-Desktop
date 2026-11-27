// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Shared reads from the core, refreshed whenever the collection changes. */
import { QueryClient, useQuery } from "@tanstack/react-query";

import * as core from "./anki/generated/core";
import type { DeckTreeNode } from "./anki/proto/anki/decks_pb";
import { readDueDeckTree } from "./rwkv";
import { onCollectionChange } from "./anki/transport";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

// Any change to the collection makes the cached reads stale. Reads are cheap
// next to a round trip to the user, so everything refreshes on the next look.
onCollectionChange(() => {
  void queryClient.invalidateQueries();
});

export const keys = {
  deckTree: ["deckTree"] as const,
  studiedToday: ["studiedToday"] as const,
  congrats: ["congrats"] as const,
  currentDeck: ["currentDeck"] as const,
};

export function useDeckTree() {
  return useQuery({
    queryKey: keys.deckTree,
    queryFn: ({ signal }) => readDueDeckTree(signal),
  });
}

/** The cached Deck tree, for handlers that must read the latest one (a drag that ends after a refresh). */
export function getDeckTree(): DeckTreeNode | undefined {
  return queryClient.getQueryData<DeckTreeNode>(keys.deckTree);
}

export function useStudiedToday() {
  return useQuery({
    queryKey: keys.studiedToday,
    queryFn: async () => (await core.studiedToday()).val,
  });
}

export function useCongrats(enabled: boolean) {
  return useQuery({ queryKey: keys.congrats, queryFn: () => core.congratsInfo(), enabled });
}

export function useCurrentDeck() {
  return useQuery({ queryKey: keys.currentDeck, queryFn: () => core.getCurrentDeck() });
}

/** Totals across the top-level Decks, which already include their children. */
export function totals(root: DeckTreeNode | undefined) {
  let newCount = 0;
  let learnCount = 0;
  let reviewCount = 0;
  for (const child of root?.children ?? []) {
    newCount += child.newCount;
    learnCount += child.learnCount;
    reviewCount += child.reviewCount;
  }
  return { newCount, learnCount, reviewCount, total: newCount + learnCount + reviewCount };
}

/** The last path component of a Deck name (`A::B::C` becomes `C`). */
export function leafName(name: string): string {
  const parts = name.split("::");
  return parts[parts.length - 1];
}

export function findDeck(root: DeckTreeNode | undefined, id: bigint): DeckTreeNode | undefined {
  if (!root) return undefined;
  if (root.deckId === id) return root;
  for (const child of root.children) {
    const found = findDeck(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Re-runs every query after a collection is opened or replaced. */
export function resetQueries(): void {
  queryClient.clear();
}

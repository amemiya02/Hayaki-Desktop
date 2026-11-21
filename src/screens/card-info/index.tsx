// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { lazy, Suspense } from "react";
import { create } from "zustand";

const CardInfoDialog = lazy(() => import("./CardInfoDialog").then((m) => ({ default: m.CardInfoDialog })));

const useCardInfo = create<{ cardId: bigint | null }>(() => ({ cardId: null }));

/**
 * Card Info, opened from Study, Browse or the palette. Calling it again while
 * it is open switches to the other Card.
 */
export function openCardInfo(cardId: bigint): void {
  useCardInfo.setState({ cardId });
}

export function closeCardInfo(): void {
  useCardInfo.setState({ cardId: null });
}

/** Mounted once in the app shell. */
export function CardInfoHost() {
  const cardId = useCardInfo((s) => s.cardId);
  if (cardId === null) return null;
  return (
    <Suspense fallback={null}>
      <CardInfoDialog cardId={cardId} onClose={closeCardInfo} />
    </Suspense>
  );
}

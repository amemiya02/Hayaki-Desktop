// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Table rows, fetched one id at a time as they scroll into view (like Anki's
 * table model) and cached by TanStack Query, so a collection change refreshes
 * only the rows on screen. A small queue keeps fast scrolling from flooding
 * the core; rows that scroll away before their turn are skipped.
 */
import { useQuery } from "@tanstack/react-query";

import * as core from "@/lib/anki/generated/core";
import type { BrowserRow } from "@/lib/anki/proto/anki/search_pb";

const CONCURRENCY = 6;
let running = 0;
const waiting: (() => void)[] = [];

class Skipped extends Error {}

function next() {
  while (running < CONCURRENCY && waiting.length > 0) {
    // Newest first: the rows the user is looking at now.
    waiting.pop()!();
  }
}

async function fetchRow(id: bigint, signal: AbortSignal): Promise<BrowserRow> {
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
    next();
  });
  running++;
  try {
    if (signal.aborted) throw new Skipped();
    return await core.browserRowForId({ val: id });
  } finally {
    running--;
    next();
  }
}

export function rowKey(generation: number, id: bigint) {
  return ["browse", "row", generation, String(id)] as const;
}

/** `generation` changes whenever the mode or the active columns change. */
export function useRow(generation: number, id: bigint, enabled: boolean) {
  return useQuery({
    queryKey: rowKey(generation, id),
    queryFn: ({ signal }) => fetchRow(id, signal),
    enabled,
    gcTime: 10 * 60 * 1000,
  });
}

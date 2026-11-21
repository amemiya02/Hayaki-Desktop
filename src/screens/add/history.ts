// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The Notes added from the Add screen, newest first. Anki keeps the last 15
 * for the session; Hayaki keeps the last 30 across sessions, per profile, on
 * this computer.
 */
import { create } from "zustand";

import * as core from "@/lib/anki/generated/core";
import { useApp } from "@/lib/session-store";

export const HISTORY_LIMIT = 30;

export interface HistoryEntry {
  id: bigint;
  text: string;
  notetype: string;
  deck: string;
}

const keyFor = (profileId: string) => `hayaki.add.history.${profileId}`;

export function serializeHistory(entries: readonly HistoryEntry[]): string {
  return JSON.stringify(entries.slice(0, HISTORY_LIMIT).map((e) => ({ ...e, id: String(e.id) })));
}

/** Reads what `serializeHistory` wrote; anything unreadable is an empty history. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  try {
    const list = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(list)) return [];
    const entries: HistoryEntry[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (typeof item?.id !== "string" || !/^\d+$/.test(item.id)) continue;
      entries.push({
        id: BigInt(item.id),
        text: typeof item.text === "string" ? item.text : "",
        notetype: typeof item.notetype === "string" ? item.notetype : "",
        deck: typeof item.deck === "string" ? item.deck : "",
      });
    }
    return entries.slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function pushEntry(entries: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries.filter((e) => e.id !== entry.id)].slice(0, HISTORY_LIMIT);
}

interface HistoryState {
  entries: HistoryEntry[];
  profileId: string | null;
  push(entry: HistoryEntry): void;
  remove(id: bigint): void;
  /** Loads the open profile's history, once per profile. */
  load(): void;
  /** Drops entries whose Note has since been deleted. */
  prune(): Promise<void>;
}

function persist(profileId: string | null, entries: readonly HistoryEntry[]) {
  if (!profileId) return;
  try {
    localStorage.setItem(keyFor(profileId), serializeHistory(entries));
  } catch {
    // The history is a convenience; the Notes are already saved.
  }
}

export const useAddHistory = create<HistoryState>((set, get) => ({
  entries: [],
  profileId: null,
  push: (entry) => {
    get().load();
    const entries = pushEntry(get().entries, entry);
    set({ entries });
    persist(get().profileId, entries);
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries });
    persist(get().profileId, entries);
  },
  load: () => {
    const profileId = useApp.getState().profile?.id ?? null;
    if (profileId === get().profileId) return;
    let raw: string | null = null;
    try {
      raw = profileId ? localStorage.getItem(keyFor(profileId)) : null;
    } catch {
      // Starts empty.
    }
    set({ profileId, entries: parseHistory(raw) });
  },
  prune: async () => {
    const { entries, profileId } = get();
    if (!entries.length) return;
    try {
      const alive = new Set((await core.searchNotes({ search: `nid:${entries.map((e) => e.id).join(",")}` })).ids);
      const kept = get().entries.filter((e) => alive.has(e.id));
      if (get().profileId !== profileId || kept.length === get().entries.length) return;
      set({ entries: kept });
      persist(profileId, kept);
    } catch {
      // Keep the entries; a search that fails says nothing about the Notes.
    }
  },
}));

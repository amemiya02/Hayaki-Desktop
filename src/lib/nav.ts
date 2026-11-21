// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { create } from "zustand";

export type Route =
  | { name: "decks" }
  | { name: "deck"; deckId: bigint }
  | { name: "deck-options"; deckId: bigint }
  | { name: "study"; deckId: bigint | null }
  | { name: "browse"; search?: string }
  | { name: "stats"; deckId?: bigint }
  | { name: "add" }
  | { name: "settings" }
  | { name: "notetypes" }
  | { name: "notetype"; notetypeId: bigint; tab?: "fields" | "templates" | "styling" }
  | { name: "change-notetype"; noteIds: bigint[] }
  | { name: "import-csv"; path: string }
  | { name: "plugins" }
  | { name: "plugin"; pluginId: string; panelId: string }
  | { name: "image-occlusion"; mode: { kind: "add"; imagePath?: string; notetypeId?: bigint } | { kind: "edit"; noteId: bigint } };

/**
 * A screen with unsaved work registers a guard. Before any navigation the guard
 * is asked: it returns true to let navigation happen now, or false after
 * taking over (for example showing a discard dialog) and calling `proceed`
 * once the person chooses to leave.
 */
export type LeaveGuard = (proceed: () => void) => boolean;

let leaveGuard: LeaveGuard | null = null;

/** Registers the guard; returns a function that removes it. */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = null;
  };
}

function guarded(navigate: () => void): void {
  const guard = leaveGuard;
  if (!guard || guard(() => {
    if (leaveGuard === guard) leaveGuard = null;
    navigate();
  })) {
    navigate();
  }
}

interface Nav {
  route: Route;
  history: Route[];
  go(route: Route): void;
  back(): void;
}

export const useNav = create<Nav>((set, get) => ({
  route: { name: "decks" },
  history: [],
  go(route) {
    const current = get().route;
    if (JSON.stringify(current, replacer) === JSON.stringify(route, replacer)) return;
    guarded(() => set({ route, history: [...get().history.slice(-20), get().route] }));
  },
  back() {
    guarded(() => {
      const history = get().history;
      const previous = history[history.length - 1] ?? { name: "decks" };
      set({ route: previous, history: history.slice(0, -1) });
    });
  },
}));

function replacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Layout of the Browse screen, kept on this computer like Anki's window geometry. */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Mode } from "./config";

interface BrowseLayout {
  filtersOpen: boolean;
  /** Width of the editor pane as a fraction of the screen. */
  editorFraction: number;
  /** Column widths in pixels, per mode and column key. */
  widths: Record<Mode, Record<string, number>>;
  setFiltersOpen(open: boolean): void;
  setEditorFraction(fraction: number): void;
  setWidth(mode: Mode, key: string, width: number): void;
}

export const useBrowseLayout = create<BrowseLayout>()(
  persist(
    (set) => ({
      filtersOpen: true,
      editorFraction: 0.4,
      widths: { cards: {}, notes: {} },
      setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
      setEditorFraction: (editorFraction) => set({ editorFraction: Math.min(0.7, Math.max(0.2, editorFraction)) }),
      setWidth: (mode, key, width) =>
        set((s) => ({ widths: { ...s.widths, [mode]: { ...s.widths[mode], [key]: Math.round(width) } } })),
    }),
    {
      name: "hayaki.browse",
      version: 2,
      // Version 2 narrowed the default sort-field and Deck columns; widths still at the old defaults follow.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<BrowseLayout>;
        if (version < 2 && state.widths) {
          const old: Record<string, number> = { noteFld: 240, question: 240, answer: 240, deck: 170, noteTags: 170 };
          for (const mode of ["cards", "notes"] as const) {
            const widths: Record<string, number> = { ...(state.widths[mode] ?? {}) };
            for (const [key, value] of Object.entries(old)) if (widths[key] === value) delete widths[key];
            state.widths = { ...state.widths, [mode]: widths };
          }
        }
        return state as BrowseLayout;
      },
    },
  ),
);

const WIDE = new Set(["noteFld", "question", "answer"]);
const NARROW = new Set(["cardEase", "cardReps", "cardLapses", "cardIvl", "originalPosition", "difficulty", "stability", "retrievability"]);

export function defaultWidth(key: string): number {
  if (WIDE.has(key)) return 180;
  if (NARROW.has(key)) return 92;
  if (key === "deck" || key === "noteTags") return 160;
  if (key === "template" || key === "note") return 104;
  return 100;
}

export const MIN_WIDTH = 56;

/**
 * Column tracks. Only the sort-field column (Anki's `noteFld`, or the
 * question when it is hidden) takes the spare width, so Deck, due and the
 * other fixed columns keep their size at every window width.
 */
export function gridTemplate(columns: string[], widths: number[]): string {
  let flex = columns.indexOf("noteFld");
  if (flex < 0) flex = columns.indexOf("question");
  if (flex < 0) flex = columns.length - 1;
  return widths.map((w, i) => (i === flex ? `minmax(${w}px,1fr)` : `${w}px`)).join(" ");
}

/** The editor pane never narrows below this. */
export const EDITOR_MIN = 260;

/**
 * The editor pane's width in pixels. It keeps the chosen fraction while the
 * table still fits its columns beside it; in a narrower window it yields
 * down to its minimum, so the table's fixed columns (Deck, due) stay whole.
 */
export function editorWidth(bodyWidth: number, fraction: number, tableNeed: number): number {
  const preferred = Math.round(bodyWidth * fraction);
  const room = bodyWidth - tableNeed;
  return Math.max(EDITOR_MIN, Math.min(preferred, room));
}

/** The current row's Card, for actions outside the screen (the command palette's Card Info). */
export const useBrowseCurrent = create<{ cardId: bigint | null }>(() => ({ cardId: null }));

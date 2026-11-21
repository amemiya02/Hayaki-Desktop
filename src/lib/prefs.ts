// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Interface preferences kept on this computer (not synced with the collection). */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { themeColors, type Appearance, type ResolvedAppearance, type ThemeId } from "./themes";

/** The sidebar's width range in pixels, and its default. */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 380;
export const SIDEBAR_DEFAULT = 248;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

interface Prefs {
  theme: ThemeId;
  appearance: Appearance;
  /** Width of the sidebar in pixels while it is shown. */
  sidebarWidth: number;
  /** The sidebar is hidden (Ctrl+\); its width is kept for when it returns. */
  sidebarCollapsed: boolean;
  setTheme(theme: ThemeId): void;
  setAppearance(appearance: Appearance): void;
  setSidebarWidth(width: number): void;
  toggleSidebar(): void;
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: "hayaki",
      appearance: "system",
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      setAppearance: (appearance) => set({ appearance }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      set: (key, value) => set({ [key]: value } as Partial<Prefs>),
    }),
    {
      name: "hayaki.prefs",
      version: 2,
      // Version 1 stored 0 for a collapsed sidebar.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<Prefs>;
        if (version < 2) {
          const width = state.sidebarWidth ?? SIDEBAR_DEFAULT;
          return { ...state, sidebarCollapsed: width === 0, sidebarWidth: width === 0 ? SIDEBAR_DEFAULT : clampSidebarWidth(width) } as Prefs;
        }
        return state as Prefs;
      },
    },
  ),
);

// Lazy, so this module also loads outside a browser (tests).
let query: MediaQueryList | null = null;
function darkQuery(): MediaQueryList | null {
  if (!query && typeof window !== "undefined" && window.matchMedia) query = window.matchMedia("(prefers-color-scheme: dark)");
  return query;
}

export function resolveAppearance(appearance: Appearance): ResolvedAppearance {
  if (appearance === "system") return darkQuery()?.matches ? "dark" : "light";
  return appearance;
}

/** The colours handed to the card page for its frame (never its content). */
export function cardFrameVars(theme: ThemeId, resolved: ResolvedAppearance): Record<string, string> {
  const colors = themeColors(theme, resolved);
  return { "--canvas": colors.canvas, "--fg": colors.ink, "--accent": colors.accent };
}

/** Applies Theme and Appearance to the document and the window frame. */
export function applyAppearance(theme: ThemeId, appearance: Appearance): ResolvedAppearance {
  const resolved = resolveAppearance(appearance);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.appearance = resolved;
  root.classList.toggle("dark", resolved !== "light");
  void getCurrentWindow()
    .setTheme(appearance === "system" ? null : resolved === "light" ? "light" : "dark")
    .catch(() => undefined);
  return resolved;
}

export function watchSystemAppearance(onChange: () => void): () => void {
  const q = darkQuery();
  q?.addEventListener("change", onChange);
  return () => q?.removeEventListener("change", onChange);
}

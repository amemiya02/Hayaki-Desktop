// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Zoom for the whole window, as in Anki's View menu: Ctrl+= and Ctrl+- step
 * by 10%, Ctrl+0 resets. It is the web view's own page zoom (`setZoom`), not
 * CSS `zoom` or a root font scale, for three reasons. The page lays out at the
 * smaller or larger viewport as a browser does, so the design system's px
 * tokens, borders and icons stay crisp rather than being scaled bitmaps or
 * drifting off the pixel grid. Card Content, which lives in an iframe, scales
 * with the rest, matching upstream where the main web view's zoom factor also
 * zooms the review card. And vh units, pointer coordinates and scrolling stay
 * correct, which CSS zoom on the root does not guarantee in every engine.
 * The factor is kept on this computer and applied at start-up.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1;

export type ZoomAction = "in" | "out" | "reset";

/** The factor after one action, kept in range and free of float drift (0.1 steps). */
export function nextZoom(current: number, action: ZoomAction): number {
  if (action === "reset") return ZOOM_DEFAULT;
  const base = Number.isFinite(current) ? current : ZOOM_DEFAULT;
  const next = Math.round((base + (action === "in" ? ZOOM_STEP : -ZOOM_STEP)) * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/** A stored factor, or the default when it is missing or out of range. */
export function parseZoom(raw: string | null): number {
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < ZOOM_MIN || value > ZOOM_MAX) return ZOOM_DEFAULT;
  return Math.round(value * 100) / 100;
}

const KEY = "hayaki.zoom";

function load(): number {
  try {
    return parseZoom(localStorage.getItem(KEY));
  } catch {
    return ZOOM_DEFAULT;
  }
}

export const useZoom = create<{ factor: number }>(() => ({ factor: load() }));

async function apply(factor: number): Promise<void> {
  try {
    await getCurrentWebview().setZoom(factor);
  } catch {
    // Outside the desktop shell (tests, a browser) there is no web view to zoom.
  }
}

/** Applies the stored factor; call once at start-up. */
export function applyStoredZoom(): Promise<void> {
  return apply(useZoom.getState().factor);
}

export function zoom(action: ZoomAction): void {
  const factor = nextZoom(useZoom.getState().factor, action);
  useZoom.setState({ factor });
  try {
    if (factor === ZOOM_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(factor));
  } catch {
    // The factor then lasts until the window closes.
  }
  void apply(factor);
}

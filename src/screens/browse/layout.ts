// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Where the editor sits and how large the table is drawn, as in Anki's View menu. */

export type LayoutMode = "auto" | "vertical" | "horizontal";

/** Anki's Auto layout puts the editor below the table in a window taller than it is wide. */
export function editorBelow(mode: LayoutMode, width: number, height: number): boolean {
  if (mode === "vertical") return true;
  if (mode === "horizontal") return false;
  return height > 0 && width / height < 1;
}

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/** One step in or out; `0` goes back to the normal size. */
export function stepZoom(zoom: number, direction: 1 | -1 | 0): number {
  return direction === 0 ? 1 : clampZoom(zoom + direction * ZOOM_STEP);
}

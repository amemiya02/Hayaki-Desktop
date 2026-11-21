// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pointer-driven dragging for trees and lists. The window takes file drops
 * itself (`dragDropEnabled`), so HTML5 drag and drop does not fire; this
 * follows the pointer instead and hit-tests with `elementFromPoint`.
 *
 * `createPointerDrag` makes one kind of drag. A row opts in with
 * `handlers(source, key)` and a drop target marks itself with the attribute
 * the kind names, `<el data-x-drop="<target key>">`. Scroll containers carry
 * `data-drag-scroll` and scroll while the pointer is near their edge; a
 * control inside a draggable row carries `data-no-drag`.
 *
 * For a reorderable list set `edges`: each row is a target and the drop lands
 * before or after it, by which half of the row the pointer is in. `useTarget`
 * then reports that `edge`, for drawing the insertion line.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";

const THRESHOLD = 5;
const EDGE = 44;

export type Edge = "before" | "after";

export interface PointerDragConfig<S> {
  /** The drop target attribute, such as `data-deck-drop`. Its value is the target key. */
  attribute: string;
  /** The ghost's title. */
  label: (source: S) => string;
  /** Targets are list rows: the drop lands before or after the one under the pointer. */
  edges?: boolean;
  /** Whether `source` may be dropped on the target. `edge` is null unless `edges` is set. */
  accepts: (source: S, target: string, edge: Edge | null) => boolean;
  /** The words under the ghost while the pointer is over a target. */
  hint: (source: S, target: string, valid: boolean, edge: Edge | null) => string;
  /** Runs on a valid drop. */
  drop: (source: S, target: string, edge: Edge | null) => void;
}

interface DragState {
  /** The key of what is being dragged, once the pointer has moved past the threshold. */
  source: string | null;
  /** The target key under the pointer, valid or not. */
  over: string | null;
  edge: Edge | null;
  valid: boolean;
}

export interface TargetState {
  dragging: boolean;
  over: boolean;
  valid: boolean;
  isSource: boolean;
  /** Which side of the target the drop would land on, when the kind has `edges`. */
  edge: Edge | null;
}

const IDLE: DragState = { source: null, over: null, edge: null, valid: false };

let ghost: HTMLDivElement | null = null;

function showGhost(label: string): HTMLDivElement {
  ghost ??= document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.className =
    "pointer-events-none fixed left-0 top-0 z-[60] flex max-w-[280px] flex-col gap-0.5 rounded-[9px] border border-line bg-raised px-3 py-1.5 text-control shadow-pop";
  ghost.replaceChildren();
  const name = document.createElement("span");
  name.className = "truncate font-medium text-ink";
  name.textContent = label;
  const hint = document.createElement("span");
  hint.className = "truncate text-caption text-ink-3";
  hint.dataset.role = "hint";
  ghost.append(name, hint);
  document.body.append(ghost);
  return ghost;
}

function hideGhost(): void {
  ghost?.remove();
}

/** After a drag the pointer-up would click the row under it; swallow that one click. */
function swallowNextClick(): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
}

export function createPointerDrag<S>(config: PointerDragConfig<S>) {
  const useDrag = create<DragState>(() => IDLE);

  const targetAt = (x: number, y: number): { key: string; edge: Edge | null } | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${config.attribute}]`);
    const key = el?.getAttribute(config.attribute);
    if (!el || key == null) return null;
    if (!config.edges) return { key, edge: null };
    const rect = el.getBoundingClientRect();
    return { key, edge: y < rect.top + rect.height / 2 ? "before" : "after" };
  };

  function begin(down: PointerEvent, source: S, key: string): void {
    const { clientX: startX, clientY: startY } = down;
    let active = false;
    let raf = 0;
    let lastX = startX;
    let lastY = startY;
    let el: HTMLDivElement | null = null;
    // Escape ends the drag at once, but the button may still be held; the
    // listeners stay until it is released so that release's click is swallowed.
    let cancelled = false;

    const update = (x: number, y: number) => {
      const hit = targetAt(x, y);
      const over = hit?.key ?? null;
      const edge = hit?.edge ?? null;
      const valid = over !== null && config.accepts(source, over, edge);
      useDrag.setState({ over, edge, valid });
      if (!el) return;
      el.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
      const hint = el.querySelector<HTMLElement>("[data-role=hint]");
      if (hint) {
        hint.textContent = over === null ? "" : config.hint(source, over, valid, edge);
        hint.className = `truncate text-caption ${over !== null && !valid ? "text-danger" : "text-ink-3"}`;
      }
    };

    // Scrolls whichever list the pointer is over when it nears the top or bottom edge.
    const autoscroll = () => {
      raf = 0;
      if (!active) return;
      for (const box of document.querySelectorAll<HTMLElement>("[data-drag-scroll]")) {
        const rect = box.getBoundingClientRect();
        if (lastX < rect.left || lastX > rect.right || lastY < rect.top || lastY > rect.bottom) continue;
        if (lastY - rect.top < EDGE) box.scrollTop -= 10;
        else if (rect.bottom - lastY < EDGE) box.scrollTop += 10;
        update(lastX, lastY);
      }
      raf = requestAnimationFrame(autoscroll);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId || cancelled) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        active = true;
        el = showGhost(config.label(source));
        useDrag.setState({ source: key, over: null, edge: null, valid: false });
        document.documentElement.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        raf = requestAnimationFrame(autoscroll);
      }
      update(e.clientX, e.clientY);
    };

    const stopVisuals = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      hideGhost();
      document.documentElement.style.cursor = "";
      document.body.style.userSelect = "";
      const { over, edge, valid } = useDrag.getState();
      useDrag.setState(IDLE);
      return { over, edge, valid };
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey, true);
      if (!active) {
        if (raf) cancelAnimationFrame(raf);
        return;
      }
      swallowNextClick();
      if (cancelled) return;
      const { over, edge, valid } = stopVisuals();
      if (commit && valid && over !== null) config.drop(source, over, edge);
    };
    const up = (e: PointerEvent) => e.pointerId === down.pointerId && finish(true);
    const cancel = (e: PointerEvent) => e.pointerId === down.pointerId && finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!active) return finish(false);
      if (cancelled) return;
      cancelled = true;
      stopVisuals();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey, true);
  }

  /** Props for a row that can be dragged. `key` names it for `useTarget(key).isSource`. */
  function handlers(source: S, key: string) {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        begin(event.nativeEvent, source, key);
      },
    };
  }

  /** How a drop target should look: `over` while the pointer is on it, `valid` when the drop would work. */
  function useTarget(key: string): TargetState {
    const source = useDrag((s) => s.source);
    const over = useDrag((s) => s.over === key);
    const valid = useDrag((s) => s.valid);
    const edge = useDrag((s) => (s.over === key ? s.edge : null));
    return { dragging: source !== null, over, valid: over && valid, isSource: source === key, edge };
  }

  return { useDrag, handlers, useTarget };
}

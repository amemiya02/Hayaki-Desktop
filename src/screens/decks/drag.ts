// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pointer-driven Deck dragging for the Deck list and the sidebar tree. The
 * window takes file drops itself (`dragDropEnabled`), so HTML5 drag and drop
 * is not available; this follows the pointer instead.
 *
 * A row opts in with `deckDragHandlers(...)` and marks itself as a target with
 * `data-deck-drop="<id>"`. The top level is `data-deck-drop="0"`.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";

import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { findDeck, leafName } from "@/lib/queries";
import { td } from "@/lib/strings/decks";

import { dropState, TOP_LEVEL } from "./model";
import { reparentDeck } from "./reparent";

const THRESHOLD = 5;
const EDGE = 44;

interface DragState {
  /** The Deck being dragged, once the pointer has moved past the threshold. */
  source: bigint | null;
  /** The target under the pointer, valid or not. */
  over: bigint | null;
  valid: boolean;
}

export const useDeckDrag = create<DragState>(() => ({ source: null, over: null, valid: false }));

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

function targetAt(x: number, y: number): bigint | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-deck-drop]");
  return el?.dataset.deckDrop === undefined ? null : BigInt(el.dataset.deckDrop);
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

/**
 * Props for a row that can be dragged. `getRoot` supplies the current tree when
 * the drag ends, so a refresh during the drag cannot leave a stale answer.
 */
export function deckDragHandlers(node: DeckTreeNode, getRoot: () => DeckTreeNode | undefined) {
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || !event.isPrimary) return;
      if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
      begin(event.nativeEvent, node, getRoot);
    },
  };
}

function begin(down: PointerEvent, node: DeckTreeNode, getRoot: () => DeckTreeNode | undefined): void {
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
    const root = getRoot();
    const over = targetAt(x, y);
    const valid = !!root && over !== null && dropState(root, node.deckId, over) === "ok";
    useDeckDrag.setState({ over, valid });
    if (el) {
      el.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
      const hint = el.querySelector<HTMLElement>("[data-role=hint]");
      if (hint) {
        const target = over !== null && over !== TOP_LEVEL ? leafName(findDeck(root, over)?.name ?? "") : "";
        hint.textContent =
          over === null ? "" : !valid ? td("dragInvalid") : over === TOP_LEVEL ? td("dragTop") : td("dragInto", { deck: target });
        hint.className = `truncate text-caption ${over !== null && !valid ? "text-danger" : "text-ink-3"}`;
      }
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
      el = showGhost(leafName(node.name));
      useDeckDrag.setState({ source: node.deckId, over: null, valid: false });
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
    const { over, valid } = useDeckDrag.getState();
    useDeckDrag.setState({ source: null, over: null, valid: false });
    return { over, valid };
  };

  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!active) {
      if (raf) cancelAnimationFrame(raf);
      return;
    }
    swallowNextClick();
    if (cancelled) return;
    const { over, valid } = stopVisuals();
    if (commit && valid && over !== null) void reparentDeck(getRoot(), node.deckId, over);
  };
  const up = (e: PointerEvent) => e.pointerId === down.pointerId && finish(true);
  const cancel = (e: PointerEvent) => e.pointerId === down.pointerId && finish(false);
  const key = (e: KeyboardEvent) => {
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
  window.addEventListener("keydown", key, true);
}

/** How a drop target should look: `over` while the pointer is on it, `valid` when the drop would work. */
export function useDropTarget(id: bigint): { dragging: boolean; over: boolean; valid: boolean; isSource: boolean } {
  const source = useDeckDrag((s) => s.source);
  const over = useDeckDrag((s) => s.over === id);
  const valid = useDeckDrag((s) => s.valid);
  return { dragging: source !== null, over, valid: over && valid, isSource: source === id };
}

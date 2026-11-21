// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The frame that appears around a clicked image in a field, like Anki's
 * image handle. An image shows shrunk by default (it never outgrows the field);
 * Toggle actual size lets it keep its own size, and then its corners resize it
 * in place, keeping the aspect ratio. The size is the `width` attribute and the
 * choice is `data-editor-shrink`, as upstream stores them in the field.
 */
import { Maximize2, Minimize2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Tooltip } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { te } from "@/lib/strings/editor";

import { resizedWidth } from "./image-resize";

/** The tallest an image grows while shrunk; the field's CSS uses the same number. */
const SHRUNK_MAX_HEIGHT = 320;

interface Measure {
  left: number;
  top: number;
  width: number;
  height: number;
  shrunk: boolean;
  shrinkable: boolean;
  resized: boolean;
  /** The intended size: the width attribute when set, else the image's own. */
  intended: { width: number; height: number };
}

function measure(image: HTMLImageElement): Measure {
  const rect = image.getBoundingClientRect();
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const aspect = natural.width && natural.height ? natural.width / natural.height : 1;
  const width = Number(image.getAttribute("width")) || natural.width;
  const height = Number(image.getAttribute("height")) || Math.trunc(width / aspect);
  const room = image.parentElement?.clientWidth ?? Infinity;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    shrunk: image.dataset.editorShrink !== "false",
    shrinkable: width > room || height > SHRUNK_MAX_HEIGHT,
    resized: image.hasAttribute("width"),
    intended: { width, height },
  };
}

const same = (a: Measure | null, b: Measure) => a !== null && (Object.keys(b) as (keyof Measure)[]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: { corner: Corner; className: string }[] = [
  { corner: "nw", className: "-start-1.5 -top-1.5 cursor-nwse-resize" },
  { corner: "ne", className: "-end-1.5 -top-1.5 cursor-nesw-resize" },
  { corner: "sw", className: "-bottom-1.5 -start-1.5 cursor-nesw-resize" },
  { corner: "se", className: "-bottom-1.5 -end-1.5 cursor-nwse-resize" },
];

export interface ImageHandleProps {
  image: HTMLImageElement;
  /** Called after the image's attributes change, so the field saves them. */
  onChange: () => void;
  onClose: () => void;
}

export function ImageHandle({ image, onChange, onClose }: ImageHandleProps) {
  const [m, setM] = useState<Measure | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<((x: number, y: number) => void) | null>(null);
  const handlers = useRef({ onChange, onClose });
  handlers.current = { onChange, onClose };

  // The image moves with the field's scroll, layout and edits; follow it.
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      const next = measure(image);
      setM((prev) => (same(prev, next) ? prev : next));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [image]);

  const toggle = useCallback(() => {
    image.dataset.editorShrink = image.dataset.editorShrink === "false" ? "true" : "false";
    handlers.current.onChange();
  }, [image]);

  useEffect(() => {
    const onDoubleClick = () => {
      if (measure(image).shrinkable || image.dataset.editorShrink === "false") toggle();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (target !== image && !overlay.current?.contains(target)) handlers.current.onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlers.current.onClose();
    };
    image.addEventListener("dblclick", onDoubleClick);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      image.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [image, toggle]);

  if (!m) return null;

  const resizable = !m.shrunk;
  const startResize = (corner: Corner, e: React.PointerEvent<HTMLElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = image.getBoundingClientRect();
    const west = corner.endsWith("w");
    const north = corner.startsWith("n");
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    if (!natural.width || !natural.height) return;
    drag.current = (x, y) => {
      const width = resizedWidth(natural, {
        width: west ? rect.right - x : x - rect.left,
        height: north ? rect.bottom - y : y - rect.top,
      });
      // Older add-ons resized with style; clear it so the attribute shows.
      image.style.removeProperty("width");
      image.style.removeProperty("height");
      image.removeAttribute("height");
      image.width = width;
    };
  };
  const size = (s: { width: number; height: number }) => `${s.width}×${s.height}`;
  const toolbarBelow = m.top < 44;

  return createPortal(
    <div ref={overlay} className="pointer-events-none fixed inset-0 z-30">
      <div
        className="absolute rounded-[3px] border-2 border-accent"
        style={{ left: m.left, top: m.top, width: m.width, height: m.height }}
      >
        {resizable &&
          CORNERS.map(({ corner, className }) => (
            <span
              key={corner}
              role="presentation"
              onPointerDown={(e) => startResize(corner, e)}
              onPointerMove={(e) => drag.current && e.currentTarget.hasPointerCapture(e.pointerId) && drag.current(e.clientX, e.clientY)}
              onPointerUp={() => {
                drag.current = null;
                handlers.current.onChange();
              }}
              className={`pointer-events-auto absolute size-3 rounded-[3px] border border-raised bg-accent ${className}`}
            />
          ))}
        <span className="absolute start-1 bottom-1 max-w-[calc(100%-8px)] truncate rounded-[5px] bg-raised/90 px-1.5 py-0.5 text-micro text-ink-2 shadow-thumb">
          {m.shrunk && m.shrinkable
            ? `(${tr("editing-double-click-to-expand")})`
            : `${size(m.intended)}${m.resized ? ` (${te("originalSize", { size: size({ width: image.naturalWidth, height: image.naturalHeight }) })})` : ""}`}
        </span>
      </div>
      <div
        role="toolbar"
        aria-label={te("imageSize")}
        className="pointer-events-auto absolute flex gap-0.5 rounded-[9px] border border-line bg-raised p-0.5 shadow-pop"
        style={{ left: Math.max(8, m.left), top: toolbarBelow ? m.top + m.height + 8 : m.top - 38 }}
      >
        <Tooltip content={`${tr("editing-actual-size")} (${tr("editing-double-click-image")})`}>
          <button
            type="button"
            aria-label={tr("editing-actual-size")}
            aria-pressed={!m.shrunk}
            disabled={m.shrunk && !m.shrinkable}
            onClick={toggle}
            className="grid size-7 place-items-center rounded-[7px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-45 aria-pressed:bg-accent-soft aria-pressed:text-accent-ink [&_svg]:size-4"
          >
            {m.shrunk ? <Maximize2 /> : <Minimize2 />}
          </button>
        </Tooltip>
        <Tooltip content={tr("editing-restore-original-size")}>
          <button
            type="button"
            aria-label={tr("editing-restore-original-size")}
            disabled={!m.resized}
            onClick={() => {
              image.removeAttribute("width");
              onChange();
            }}
            className="grid size-7 place-items-center rounded-[7px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-45 [&_svg]:size-4"
          >
            <Undo2 />
          </button>
        </Tooltip>
      </div>
    </div>,
    document.body,
  );
}

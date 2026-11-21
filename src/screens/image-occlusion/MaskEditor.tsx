// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The mask editor: a tool rail, a command bar and an SVG canvas over the
 * image. It works in the image's own pixels and reports every finished change
 * to its host, which keeps the undo history. Shortcuts match upstream's
 * (tools/shortcuts.ts) and only apply while focus is not in a text field.
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Blend,
  ChevronDown,
  Circle,
  Copy,
  Group,
  Maximize2,
  MousePointer2,
  PaintBucket,
  Pentagon,
  Pipette,
  Redo2,
  Square,
  SquareDashedMousePointer,
  Trash,
  Type,
  Undo2,
  Ungroup,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";

import { Popover } from "radix-ui";

import { cn, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip } from "@/components/ui";
import { tr } from "@/lib/i18n";
import { maskCount, tio } from "@/lib/strings/image-occlusion";

import { duplicateOcclusions, fillOcclusions, fillShape, groupOcclusions, removeOcclusions, ungroupOcclusions } from "./editing";
import {
  alignOcclusions,
  boxScale,
  boxesIntersect,
  clampDelta,
  CORNER_HANDLES,
  dragAngle,
  EDGE_HANDLES,
  handlePoint,
  hitOcclusion,
  occlusionBounds,
  resizeShape,
  rotatePoint,
  rotateShape,
  scaleShape,
  shapeAngle,
  shapeContains,
  shapeCorners,
  translateOcclusion,
  unionBoxes,
  type Alignment,
  type Box,
  type Handle,
} from "./geometry";
import {
  BORDER_COLOR,
  newId,
  SHAPE_MASK_COLOR,
  TEXT_BACKGROUND_COLOR,
  TEXT_COLOR,
  TEXT_FONT_FAMILY,
  TEXT_FONT_SIZE,
  type Occlusion,
  type Point,
  type Shape,
  type Size,
  type TextShape,
} from "./shapes";
import { measureText, textLayout } from "./text-measure";

export type Tool = "select" | "rect" | "ellipse" | "polygon" | "text" | "fill";

/**
 * Fill colours offered by the fill tool, with their names. They are written
 * into the Note, so they are literal values; the first is Anki's own mask colour.
 */
const FILL_COLOURS = [
  { value: SHAPE_MASK_COLOR, name: "colourYellow" },
  { value: "#ff8e8e", name: "colourRed" },
  { value: "#a0e2ff", name: "colourBlue" },
  { value: "#b8f2b0", name: "colourGreen" },
  { value: "#d9c2ff", name: "colourPurple" },
  { value: "#ffffff", name: "colourWhite" },
  { value: "#9e9e9e", name: "colourGrey" },
  { value: "#212121", name: "colourBlack" },
] as const;

function colourName(colour: string): string {
  const known = FILL_COLOURS.find((c) => c.value === colour.toLowerCase());
  return known ? tio(known.name) : `${tio("customColour")} ${colour}`;
}

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: "select", label: "editing-image-occlusion-select-tool", key: "S", icon: <MousePointer2 /> },
  { id: "rect", label: "editing-image-occlusion-rectangle-tool", key: "R", icon: <Square /> },
  { id: "ellipse", label: "editing-image-occlusion-ellipse-tool", key: "E", icon: <Circle /> },
  { id: "polygon", label: "editing-image-occlusion-polygon-tool", key: "P", icon: <Pentagon /> },
  { id: "text", label: "editing-image-occlusion-text-tool", key: "T", icon: <Type /> },
  { id: "fill", label: "editing-image-occlusion-fill-tool", key: "C", icon: <PaintBucket /> },
];

const ALIGNMENTS: { id: Alignment; label: string; key: string; icon: ReactNode }[] = [
  { id: "left", label: "editing-image-occlusion-align-left", key: "Shift+L", icon: <AlignStartVertical /> },
  { id: "h-center", label: "editing-image-occlusion-align-h-center", key: "Shift+H", icon: <AlignCenterVertical /> },
  { id: "right", label: "editing-image-occlusion-align-right", key: "Shift+R", icon: <AlignEndVertical /> },
  { id: "top", label: "editing-image-occlusion-align-top", key: "Shift+T", icon: <AlignStartHorizontal /> },
  { id: "v-center", label: "editing-image-occlusion-align-v-center", key: "Shift+V", icon: <AlignCenterHorizontal /> },
  { id: "bottom", label: "editing-image-occlusion-align-bottom", key: "Shift+B", icon: <AlignEndHorizontal /> },
];

const ALIGN_KEYS: Record<string, Alignment> = { KeyL: "left", KeyH: "h-center", KeyR: "right", KeyT: "top", KeyV: "v-center", KeyB: "bottom" };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;
const PADDING = 24;
const HANDLE = 4.5;
const ROTATE_OFFSET = 22;

interface View {
  zoom: number;
  x: number;
  y: number;
  /** Not yet moved by the person, so it follows the viewport. */
  auto: boolean;
}

type Drag =
  | { type: "draw"; kind: "rect" | "ellipse"; start: Point; current: Point; shift: boolean }
  | { type: "move"; start: Point; base: Occlusion[]; box: Box; ids: Set<string> }
  | { type: "resize"; handle: Handle; base: Occlusion[]; shapeId: string }
  | { type: "scale"; handle: Handle; base: Occlusion[]; box: Box; ids: Set<string> }
  | { type: "rotate"; base: Occlusion[]; shapeId: string; center: Point }
  | { type: "vertex"; base: Occlusion[]; shapeId: string; index: number }
  | { type: "marquee"; start: Point; current: Point; before: Set<string> }
  | { type: "pan"; x: number; y: number; view: View };

type Target =
  | { type: "handle"; handle: Handle; mode: "resize" | "scale" }
  | { type: "rotate" }
  | { type: "vertex"; index: number };

interface TextEdit {
  shapeId: string;
  draft: string;
  selectAll: boolean;
}

export interface MaskEditorProps {
  imageUrl: string;
  size: Size;
  value: Occlusion[];
  onChange: (next: Occlusion[]) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Shortcuts apply only while true. */
  active: boolean;
  /** Pixels of the image per pixel of the editor at fit size, for upstream's minimum sizes. */
  onFit?: (fit: number) => void;
  /** Controls placed at the end of the command bar. */
  toolbarEnd?: ReactNode;
  className?: string;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function findShape(occlusions: Occlusion[], shapeId: string): { occlusion: Occlusion; shape: Shape } | null {
  for (const occlusion of occlusions) {
    const shape = occlusion.shapes.find((s) => s.id === shapeId);
    if (shape) return { occlusion, shape };
  }
  return null;
}

function replaceShape(occlusions: Occlusion[], shape: Shape): Occlusion[] {
  return occlusions.map((o) => (o.shapes.some((s) => s.id === shape.id) ? { ...o, shapes: o.shapes.map((s) => (s.id === shape.id ? shape : s)) } : o));
}

/* ------------------------------ Shapes ------------------------------ */

function ShapeView({ shape, translucent, hidden }: { shape: Shape; translucent: boolean; hidden?: boolean }) {
  const opacity = hidden ? 0 : translucent ? 0.4 : 1;
  const angle = shapeAngle(shape);
  switch (shape.kind) {
    case "rect":
      return (
        <rect
          x={shape.left}
          y={shape.top}
          width={Math.max(0, shape.width)}
          height={Math.max(0, shape.height)}
          transform={angle ? `rotate(${angle} ${shape.left} ${shape.top})` : undefined}
          fill={shape.fill}
          stroke={BORDER_COLOR}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={opacity}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={shape.left + shape.rx}
          cy={shape.top + shape.ry}
          rx={Math.max(0, shape.rx)}
          ry={Math.max(0, shape.ry)}
          transform={angle ? `rotate(${angle} ${shape.left} ${shape.top})` : undefined}
          fill={shape.fill}
          stroke={BORDER_COLOR}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={opacity}
        />
      );
    case "polygon":
      return (
        <polygon
          points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={shape.fill}
          stroke={BORDER_COLOR}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          opacity={opacity}
        />
      );
    case "text": {
      const layout = textLayout(shape);
      return (
        <g
          transform={`${angle ? `rotate(${angle} ${shape.left} ${shape.top}) ` : ""}translate(${shape.left} ${shape.top}) scale(${shape.scale})`}
          opacity={opacity}
        >
          <rect width={layout.width} height={layout.height} fill={TEXT_BACKGROUND_COLOR} />
          <text
            fontFamily={TEXT_FONT_FAMILY}
            fontSize={shape.fontSize}
            fill={shape.fill}
            dominantBaseline="text-before-edge"
            style={{ whiteSpace: "pre" }}
          >
            {layout.lines.map((line, i) => (
              <tspan key={i} x={0} y={i * layout.lineHeight}>
                {line || " "}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
  }
}

/* ------------------------------ Bar buttons ------------------------------ */

function BarButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
  side = "bottom",
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  side?: "bottom" | "right";
}) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label} side={side}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[8px] text-ink-2 transition-colors duration-[var(--dur-fast)] [&_svg]:size-[17px]",
          "hover:bg-sidebar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40",
          "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]",
          pressed && "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function BarDivider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />;
}

/* ------------------------------ Editor ------------------------------ */

export function MaskEditor({ imageUrl, size, value, onChange, canUndo, canRedo, onUndo, onRedo, active, onFit, toolbarEnd, className }: MaskEditorProps) {
  const [tool, setToolState] = useState<Tool>("rect");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Occlusion[] | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [polygon, setPolygon] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [translucent, setTranslucent] = useState(false);
  // As upstream, the fill colour starts at the mask colour new masks are drawn in.
  const [fillColour, setFillColour] = useState<string>(SHAPE_MASK_COLOR);
  const [space, setSpace] = useState(false);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, auto: true });

  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const shown = preview ?? value;
  const fit = viewport.width && size.width ? Math.max(0.01, Math.min((viewport.width - PADDING * 2) / size.width, (viewport.height - PADDING * 2) / size.height)) : 1;
  const scale = fit * view.zoom;

  useEffect(() => {
    onFit?.(fit);
  }, [fit, onFit]);

  // Selection that no longer exists (after undo) is dropped.
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(value.map((o) => o.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [value]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The image starts centred at fit size and stays centred until moved.
  const centred = useCallback(
    (zoom: number): View => {
      const s = fit * zoom;
      return { zoom, x: (viewport.width - size.width * s) / 2, y: (viewport.height - size.height * s) / 2, auto: zoom === 1 };
    },
    [fit, viewport.width, viewport.height, size.width, size.height],
  );
  useLayoutEffect(() => {
    setView((v) => (v.auto ? centred(1) : v));
  }, [centred]);

  const toScreen = (p: Point): Point => ({ x: p.x * scale + view.x, y: p.y * scale + view.y });
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / scale, y: (clientY - rect.top - view.y) / scale };
  };

  const zoomAt = (factor: number, screen?: Point) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const at = screen ?? { x: viewport.width / 2, y: viewport.height / 2 };
      const s0 = fit * v.zoom;
      const s1 = fit * zoom;
      const wx = (at.x - v.x) / s0;
      const wy = (at.y - v.y) / s0;
      return { zoom, x: at.x - wx * s1, y: at.y - wy * s1, auto: false };
    });
  };
  const zoomReset = () => setView(centred(1));

  /* ---------- Commands ---------- */

  const selectedIds = selected;
  const selection = value.filter((o) => selectedIds.has(o.id));
  const single = selection.length === 1 && selection[0].shapes.length === 1 ? selection[0].shapes[0] : null;
  const canGroup = selection.length > 1;
  const canUngroup = selection.some((o) => o.shapes.length > 1);

  const setTool = (next: Tool) => {
    setPolygon(null);
    setToolState(next);
  };

  const finishPolygon = (points: Point[] | null = polygon) => {
    setPolygon(null);
    if (!points || points.length < 3) return;
    const shape: Shape = { kind: "polygon", id: newId("polygon"), angle: 0, fill: SHAPE_MASK_COLOR, points };
    const occlusion: Occlusion = { id: newId("o"), shapes: [shape] };
    onChange([...value, occlusion]);
    setSelected(new Set([occlusion.id]));
  };

  const removeSelected = () => {
    if (!selection.length) return;
    onChange(removeOcclusions(value, selectedIds));
    setSelected(new Set());
  };
  const duplicate = () => {
    if (!selection.length) return;
    const out = duplicateOcclusions(value, selectedIds, 10 / fit);
    onChange(out.occlusions);
    setSelected(new Set(out.ids));
  };
  const group = () => {
    const out = groupOcclusions(value, selectedIds);
    if (!out.id) return;
    onChange(out.occlusions);
    setSelected(new Set([out.id]));
  };
  const ungroup = () => {
    const out = ungroupOcclusions(value, selectedIds);
    if (!out.ids.length) return;
    onChange(out.occlusions);
    setSelected(new Set(out.ids));
  };
  const selectAll = () => {
    setTool("select");
    setSelected(new Set(value.map((o) => o.id)));
  };
  const align = (alignment: Alignment) => {
    if (!selection.length) return;
    onChange(alignOcclusions(value, selectedIds, alignment, size, measureText));
  };
  const nudge = (dx: number, dy: number) => {
    if (!selection.length) return;
    onChange(value.map((o) => (selectedIds.has(o.id) ? translateOcclusion(o, dx, dy) : o)));
  };

  const startTextEdit = (shapeId: string, selectAll: boolean) => {
    const found = findShape(value, shapeId);
    if (!found || found.shape.kind !== "text") return;
    setTextEdit({ shapeId, draft: found.shape.text, selectAll });
  };

  // Committing blurs the text area, which commits again; the ref makes the second call a no-op.
  const textEditRef = useRef<TextEdit | null>(null);
  textEditRef.current = textEdit;
  const commitText = () => {
    const edit = textEditRef.current;
    if (!edit) return;
    textEditRef.current = null;
    setTextEdit(null);
    const found = findShape(value, edit.shapeId);
    if (!found || found.shape.kind !== "text") return;
    if (!edit.draft.trim()) {
      const rest = found.occlusion.shapes.filter((s) => s.id !== edit.shapeId);
      onChange(
        rest.length ? value.map((o) => (o.id === found.occlusion.id ? { ...o, shapes: rest } : o)) : value.filter((o) => o.id !== found.occlusion.id),
      );
      return;
    }
    if (edit.draft !== found.shape.text) onChange(replaceShape(value, { ...found.shape, text: edit.draft }));
    box.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!textEdit) return;
    const el = textArea.current;
    if (!el || document.activeElement === el) return;
    el.focus({ preventScroll: true });
    if (textEdit.selectAll) el.select();
  }, [textEdit]);

  /* ---------- Keyboard ---------- */

  const keys = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keys.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const code = e.code;
    if (mod && !e.altKey) {
      if (code === "KeyZ" && !e.shiftKey) return void onUndo(), true;
      if (code === "KeyY" || (code === "KeyZ" && e.shiftKey)) return void onRedo(), true;
      if (code === "KeyA" && !e.shiftKey) return selectAll(), true;
      return false;
    }
    if (e.altKey) return false;
    if (e.shiftKey && ALIGN_KEYS[code]) return align(ALIGN_KEYS[code]), true;
    if (polygon) {
      if (e.key === "Enter") return finishPolygon(), true;
      if (e.key === "Escape") return setPolygon(null), true;
      if (e.key === "Backspace") return setPolygon(polygon.length > 1 ? polygon.slice(0, -1) : null), true;
    }
    const step = (e.shiftKey ? 10 : 1) / scale;
    switch (e.key) {
      case "ArrowLeft":
        return selection.length ? (nudge(-step, 0), true) : false;
      case "ArrowRight":
        return selection.length ? (nudge(step, 0), true) : false;
      case "ArrowUp":
        return selection.length ? (nudge(0, -step), true) : false;
      case "ArrowDown":
        return selection.length ? (nudge(0, step), true) : false;
      case "Delete":
      case "Backspace":
        return selection.length ? (removeSelected(), true) : false;
      case "Escape":
        if (selection.length) return setSelected(new Set()), true;
        return false;
      case "Enter":
        if (single?.kind === "text") return startTextEdit(single.id, false), true;
        return false;
      case "[":
        return zoomAt(1 / 1.25), true;
      case "]":
        return zoomAt(1.25), true;
    }
    if (e.shiftKey) return false;
    switch (code) {
      case "KeyS":
        return setTool("select"), true;
      case "KeyR":
        return setTool("rect"), true;
      case "KeyE":
        return setTool("ellipse"), true;
      case "KeyP":
        return setTool("polygon"), true;
      case "KeyT":
        return setTool("text"), true;
      case "KeyC":
        return setTool("fill"), true;
      case "KeyF":
        return zoomReset(), true;
      case "KeyL":
        return setTranslucent((t) => !t), true;
      case "KeyD":
        return duplicate(), true;
      case "KeyG":
        return group(), true;
      case "KeyU":
        return ungroup(), true;
      case "KeyA":
        return selectAll(), true;
    }
    return false;
  };

  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      // Inside the canvas surround, buttons keep Space and Enter.
      const onButton = (e.target as HTMLElement | null)?.closest?.("button,[role=menuitem]");
      if (e.code === "Space" && !onButton) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) setSpace(true);
        return;
      }
      if (onButton && (e.key === "Enter" || e.key === " ")) return;
      if (keys.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [active]);

  // Wheel: Ctrl zooms around the pointer, otherwise it scrolls the view.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    e.preventDefault();
    const rect = svg.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.pow(1.0015, -e.deltaY), { x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy, auto: false }));
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  /* ---------- Pointer ---------- */

  const handleTargets = (): { target: Target; at: Point }[] => {
    if (tool !== "select" || selection.length === 0 || textEdit) return [];
    const out: { target: Target; at: Point }[] = [];
    if (single && single.kind !== "polygon") {
      const handles = single.kind === "text" ? CORNER_HANDLES : EDGE_HANDLES;
      for (const handle of handles) out.push({ target: { type: "handle", handle, mode: "resize" }, at: toScreen(handlePoint(single, handle, measureText)) });
      const top = toScreen(handlePoint(single, { hx: 0.5, hy: 0 }, measureText));
      const up = rotatePoint({ x: 0, y: -ROTATE_OFFSET }, { x: 0, y: 0 }, shapeAngle(single));
      out.push({ target: { type: "rotate" }, at: { x: top.x + up.x, y: top.y + up.y } });
      return out;
    }
    if (single?.kind === "polygon") {
      single.points.forEach((p, index) => out.push({ target: { type: "vertex", index }, at: toScreen(p) }));
    }
    const bounds = unionBoxes(selection.map((o) => occlusionBounds(o, measureText)));
    if (bounds) {
      for (const handle of EDGE_HANDLES) {
        out.push({
          target: { type: "handle", handle, mode: "scale" },
          at: toScreen({ x: bounds.x + bounds.width * handle.hx, y: bounds.y + bounds.height * handle.hy }),
        });
      }
    }
    return out;
  };

  const targetAt = (clientX: number, clientY: number): Target | null => {
    const rect = svg.current!.getBoundingClientRect();
    const p = { x: clientX - rect.left, y: clientY - rect.top };
    for (const { target, at } of handleTargets()) {
      if (Math.hypot(at.x - p.x, at.y - p.y) <= HANDLE + 3) return target;
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (textEdit) {
      commitText();
      return;
    }
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      svg.current!.setPointerCapture(e.pointerId);
      setDrag({ type: "pan", x: e.clientX, y: e.clientY, view });
      return;
    }
    if (e.button !== 0) return;
    box.current?.focus({ preventScroll: true });
    const p = toWorld(e.clientX, e.clientY);
    const slop = 3 / scale;

    if (tool === "polygon") {
      const points = polygon ?? [];
      const first = points[0];
      if (first && points.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) * scale <= 8) return finishPolygon(points);
      const last = points[points.length - 1];
      // a double click lands its second click on the last point
      if (last && Math.hypot(last.x - p.x, last.y - p.y) * scale <= 3) return finishPolygon(points);
      setPolygon([...points, p]);
      return;
    }
    if (tool === "fill") {
      for (let i = value.length - 1; i >= 0; i--) {
        const shape = [...value[i].shapes].reverse().find((s) => shapeContains(s, p, measureText, slop));
        if (shape) {
          const next = fillShape(value, shape.id, fillColour);
          if (next !== value) onChange(next);
          return;
        }
      }
      return;
    }
    if (tool === "text") {
      const hit = hitOcclusion(value, p, measureText, slop);
      const text = hit?.shapes.find((s) => s.kind === "text" && shapeContains(s, p, measureText, slop));
      if (text) {
        setSelected(new Set([hit!.id]));
        startTextEdit(text.id, false);
        return;
      }
      const shape: TextShape = {
        kind: "text",
        id: newId("text"),
        angle: 0,
        fill: TEXT_COLOR,
        left: p.x,
        top: p.y,
        text: "text",
        scale: 1,
        fontSize: TEXT_FONT_SIZE / fit,
      };
      const occlusion: Occlusion = { id: newId("o"), shapes: [shape] };
      onChange([...value, occlusion]);
      setSelected(new Set([occlusion.id]));
      setTextEdit({ shapeId: shape.id, draft: shape.text, selectAll: true });
      return;
    }

    svg.current!.setPointerCapture(e.pointerId);
    if (tool === "rect" || tool === "ellipse") {
      setDrag({ type: "draw", kind: tool, start: p, current: p, shift: e.shiftKey });
      return;
    }

    // select tool
    const target = targetAt(e.clientX, e.clientY);
    if (target) {
      if (target.type === "rotate" && single) {
        const corners = shapeCorners(single, measureText);
        setDrag({ type: "rotate", base: value, shapeId: single.id, center: { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 } });
      } else if (target.type === "vertex" && single) {
        setDrag({ type: "vertex", base: value, shapeId: single.id, index: target.index });
      } else if (target.type === "handle" && target.mode === "resize" && single) {
        setDrag({ type: "resize", handle: target.handle, base: value, shapeId: single.id });
      } else if (target.type === "handle") {
        const bounds = unionBoxes(selection.map((o) => occlusionBounds(o, measureText)))!;
        setDrag({ type: "scale", handle: target.handle, base: value, box: bounds, ids: selectedIds });
      }
      return;
    }
    const hit = hitOcclusion(value, p, measureText, slop);
    if (hit) {
      let next = selectedIds;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        next = new Set(selectedIds);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        setSelected(next);
        if (!next.has(hit.id)) return;
      } else if (!selectedIds.has(hit.id)) {
        next = new Set([hit.id]);
        setSelected(next);
      }
      const moving = value.filter((o) => next.has(o.id));
      setDrag({ type: "move", start: p, base: value, box: unionBoxes(moving.map((o) => occlusionBounds(o, measureText)))!, ids: next });
      return;
    }
    const before = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(selectedIds) : new Set<string>();
    setSelected(before);
    setDrag({ type: "marquee", start: p, current: p, before });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) {
      if (tool === "polygon" && polygon) setHover(toWorld(e.clientX, e.clientY));
      return;
    }
    if (d.type === "pan") {
      setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y, auto: false });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    switch (d.type) {
      case "draw": {
        const next = { ...d, current: p, shift: e.shiftKey };
        setDrag(next);
        return;
      }
      case "marquee": {
        setDrag({ ...d, current: p });
        const area: Box = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), width: Math.abs(p.x - d.start.x), height: Math.abs(p.y - d.start.y) };
        const inside = value.filter((o) => boxesIntersect(area, occlusionBounds(o, measureText))).map((o) => o.id);
        setSelected(new Set([...d.before, ...inside]));
        return;
      }
      case "move": {
        if (!preview && Math.hypot(p.x - d.start.x, p.y - d.start.y) * scale < 2) return;
        const delta = clampDelta(d.box, p.x - d.start.x, p.y - d.start.y, size);
        setPreview(d.base.map((o) => (d.ids.has(o.id) ? translateOcclusion(o, delta.x, delta.y) : o)));
        return;
      }
      case "resize": {
        const found = findShape(d.base, d.shapeId);
        if (!found) return;
        setPreview(replaceShape(d.base, resizeShape(found.shape, d.handle, p, measureText)));
        return;
      }
      case "scale": {
        const { anchor, sx, sy } = boxScale(d.box, d.handle, p, 4 / scale);
        const uniform = e.shiftKey ? Math.max(sx, sy) : null;
        setPreview(
          d.base.map((o) =>
            d.ids.has(o.id) ? { ...o, shapes: o.shapes.map((s) => scaleShape(s, anchor, uniform ?? sx, uniform ?? sy)) } : o,
          ),
        );
        return;
      }
      case "rotate": {
        const found = findShape(d.base, d.shapeId);
        if (!found) return;
        setPreview(replaceShape(d.base, rotateShape(found.shape, dragAngle(d.center, p, e.shiftKey), measureText)));
        return;
      }
      case "vertex": {
        const found = findShape(d.base, d.shapeId);
        if (!found || found.shape.kind !== "polygon") return;
        const points = found.shape.points.map((q, i) => (i === d.index ? p : q));
        setPreview(replaceShape(d.base, { ...found.shape, points }));
        return;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    setDrag(null);
    if (d.type === "draw") {
      const shape = drawnShape(d);
      const w = shape.kind === "rect" ? shape.width : shape.kind === "ellipse" ? shape.rx * 2 : 0;
      const h = shape.kind === "rect" ? shape.height : shape.kind === "ellipse" ? shape.ry * 2 : 0;
      if (w * scale >= 4 && h * scale >= 4) {
        const occlusion: Occlusion = { id: newId("o"), shapes: [shape] };
        onChange([...value, occlusion]);
        setSelected(new Set([occlusion.id]));
      }
      return;
    }
    if (preview) {
      onChange(preview);
      setPreview(null);
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (tool !== "select") return;
    const p = toWorld(e.clientX, e.clientY);
    const hit = hitOcclusion(value, p, measureText, 3 / scale);
    const text = hit?.shapes.find((s) => s.kind === "text" && shapeContains(s, p, measureText, 3 / scale));
    if (text) startTextEdit(text.id, false);
  };

  const drawnShape = (d: Extract<Drag, { type: "draw" }>): Shape => {
    let w = d.current.x - d.start.x;
    let h = d.current.y - d.start.y;
    if (d.shift) {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * side;
      h = Math.sign(h || 1) * side;
    }
    const left = Math.min(d.start.x, d.start.x + w);
    const top = Math.min(d.start.y, d.start.y + h);
    if (d.kind === "rect") {
      return { kind: "rect", id: newId("rect"), angle: 0, fill: SHAPE_MASK_COLOR, left, top, width: Math.abs(w), height: Math.abs(h) };
    }
    return { kind: "ellipse", id: newId("ellipse"), angle: 0, fill: SHAPE_MASK_COLOR, left, top, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 };
  };

  /* ---------- Rendering ---------- */

  const drawing = drag?.type === "draw" ? drawnShape(drag) : null;
  const shownSelection = shown.filter((o) => selectedIds.has(o.id));
  const shownSingle = shownSelection.length === 1 && shownSelection[0].shapes.length === 1 ? shownSelection[0].shapes[0] : null;
  const editing = textEdit ? findShape(shown, textEdit.shapeId) : null;
  const editingShape = editing?.shape.kind === "text" ? editing.shape : null;

  const outlines: string[] = [];
  for (const o of shownSelection) {
    for (const s of o.shapes) {
      const pts = s.kind === "polygon" ? s.points : shapeCorners(s, measureText);
      outlines.push(pts.map((p, i) => `${i ? "L" : "M"}${p.x * scale + view.x},${p.y * scale + view.y}`).join("") + "Z");
    }
  }

  const groupBox =
    shownSelection.length > 1 || (shownSelection.length === 1 && shownSelection[0].shapes.length > 1)
      ? unionBoxes(shownSelection.map((o) => occlusionBounds(o, measureText)))
      : null;

  const handles = drag && drag.type !== "pan" ? [] : handleTargets();
  const marquee = drag?.type === "marquee" ? drag : null;

  const cursor =
    drag?.type === "pan"
      ? "grabbing"
      : space
        ? "grab"
        : tool === "select"
          ? "default"
          : tool === "text"
            ? "text"
            : tool === "fill"
              ? "pointer"
              : "crosshair";

  const hint = polygon ? tio("polygonHint") : textEdit ? tio("textHint") : tio("panHint");

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1", className)}>
      {/* Tool rail */}
      <div
        role="toolbar"
        aria-label={tio("tools")}
        aria-orientation="vertical"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-e border-line bg-surface py-2"
      >
        {TOOLS.map((t) => (
          <BarButton key={t.id} label={tr(t.label)} shortcut={t.key} pressed={tool === t.id} onClick={() => setTool(t.id)} side="right">
            {t.icon}
          </BarButton>
        ))}
        <FillSwatches
          colour={fillColour}
          fillActive={tool === "fill"}
          onColour={(c) => {
            setFillColour(c);
            // Selected masks take the colour at once; otherwise the fill tool
            // is armed, and clicking a mask paints it (upstream fillMask).
            if (selected.size > 0) {
              const next = fillOcclusions(value, selected, c);
              if (next !== value) onChange(next);
            } else setTool("fill");
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Command bar */}
        <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2">
          <BarButton label={tr("undo-undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo}>
            <Undo2 />
          </BarButton>
          <BarButton label={tr("undo-redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={onRedo}>
            <Redo2 />
          </BarButton>
          <BarDivider />
          <BarButton label={tr("editing-image-occlusion-zoom-out")} shortcut="[" onClick={() => zoomAt(1 / 1.25)}>
            <ZoomOut />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-zoom-in")} shortcut="]" onClick={() => zoomAt(1.25)}>
            <ZoomIn />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-zoom-reset")} shortcut="F" onClick={zoomReset}>
            <Maximize2 />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-toggle-translucent")} shortcut="L" pressed={translucent} onClick={() => setTranslucent((t) => !t)}>
            <Blend />
          </BarButton>
          <BarDivider />
          <BarButton label={tr("editing-image-occlusion-delete")} shortcut="Delete" disabled={!selection.length} onClick={removeSelected}>
            <Trash />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-duplicate")} shortcut="D" disabled={!selection.length} onClick={duplicate}>
            <Copy />
          </BarButton>
          <BarDivider />
          <BarButton label={tr("editing-image-occlusion-group")} shortcut="G" disabled={!canGroup} onClick={group}>
            <Group />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-ungroup")} shortcut="U" disabled={!canUngroup} onClick={ungroup}>
            <Ungroup />
          </BarButton>
          <BarButton label={tr("editing-image-occlusion-select-all")} shortcut="A" disabled={!value.length} onClick={selectAll}>
            <SquareDashedMousePointer />
          </BarButton>
          <Menu>
            <Tooltip content={tr("editing-image-occlusion-alignment")}>
              <MenuTrigger asChild disabled={!selection.length}>
                <button
                  type="button"
                  aria-label={tr("editing-image-occlusion-alignment")}
                  className="flex h-8 shrink-0 items-center gap-0.5 rounded-[8px] px-1.5 text-ink-2 hover:bg-sidebar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-accent-soft data-[state=open]:text-accent-ink focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] [&_svg]:size-[17px]"
                >
                  <AlignStartVertical />
                  <ChevronDown className="!size-3" />
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent align="start">
              {ALIGNMENTS.map((a) => (
                <MenuItem key={a.id} shortcut={a.key} onSelect={() => align(a.id)}>
                  {a.icon}
                  {tr(a.label)}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          {toolbarEnd && <div className="ms-auto flex shrink-0 items-center gap-2 ps-3">{toolbarEnd}</div>}
        </div>

        {/* Canvas */}
        <div
          ref={box}
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-hidden bg-surface-3 outline-none"
          aria-label={tio("maskEditor")}
        >
          <svg
            ref={svg}
            role="application"
            aria-label={tio("maskEditor")}
            aria-describedby="io-editor-hint"
            className="absolute inset-0 size-full touch-none select-none"
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${scale})`}>
              <rect
                x={0}
                y={0}
                width={size.width}
                height={size.height}
                style={{ fill: "var(--surface)", filter: "drop-shadow(0 1px 3px rgb(0 0 0 / 0.18))" }}
              />
              <image href={imageUrl} x={0} y={0} width={size.width} height={size.height} preserveAspectRatio="none" />
              {shown.map((o) =>
                o.shapes.map((s) => <ShapeView key={s.id} shape={s} translucent={translucent} hidden={editingShape?.id === s.id} />),
              )}
              {drawing && <ShapeView shape={drawing} translucent={translucent} />}
            </g>

            {/* Selection, in screen pixels */}
            <g pointerEvents="none">
              {outlines.map((d, i) => (
                <path key={i} d={d} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.5} />
              ))}
              {groupBox && (
                <rect
                  x={groupBox.x * scale + view.x - 4}
                  y={groupBox.y * scale + view.y - 4}
                  width={groupBox.width * scale + 8}
                  height={groupBox.height * scale + 8}
                  fill="none"
                  style={{ stroke: "var(--accent)" }}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              )}
              {shownSingle && shownSingle.kind !== "polygon" && handles.some((h) => h.target.type === "rotate") && (
                <line
                  x1={toScreen(handlePoint(shownSingle, { hx: 0.5, hy: 0 }, measureText)).x}
                  y1={toScreen(handlePoint(shownSingle, { hx: 0.5, hy: 0 }, measureText)).y}
                  x2={handles.find((h) => h.target.type === "rotate")!.at.x}
                  y2={handles.find((h) => h.target.type === "rotate")!.at.y}
                  style={{ stroke: "var(--accent)" }}
                  strokeWidth={1}
                />
              )}
              {handles.map(({ target, at }, i) =>
                target.type === "handle" ? (
                  <rect
                    key={i}
                    x={at.x - HANDLE}
                    y={at.y - HANDLE}
                    width={HANDLE * 2}
                    height={HANDLE * 2}
                    rx={2}
                    style={{ fill: "var(--raised)", stroke: "var(--accent)" }}
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle
                    key={i}
                    cx={at.x}
                    cy={at.y}
                    r={target.type === "rotate" ? HANDLE + 0.5 : HANDLE - 0.5}
                    style={{ fill: target.type === "rotate" ? "var(--accent)" : "var(--raised)", stroke: "var(--accent)" }}
                    strokeWidth={1.5}
                  />
                ),
              )}
              {marquee && (
                <rect
                  x={Math.min(marquee.start.x, marquee.current.x) * scale + view.x}
                  y={Math.min(marquee.start.y, marquee.current.y) * scale + view.y}
                  width={Math.abs(marquee.current.x - marquee.start.x) * scale}
                  height={Math.abs(marquee.current.y - marquee.start.y) * scale}
                  style={{ fill: "var(--accent-softer)", stroke: "var(--accent)" }}
                  strokeWidth={1}
                />
              )}
              {polygon && (
                <>
                  <polyline
                    points={[...polygon, ...(hover ? [hover] : [])].map((p) => `${p.x * scale + view.x},${p.y * scale + view.y}`).join(" ")}
                    style={{ fill: "var(--accent-softer)", stroke: "var(--accent)" }}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  {polygon.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x * scale + view.x}
                      cy={p.y * scale + view.y}
                      r={i === 0 && polygon.length >= 3 ? HANDLE + 1.5 : HANDLE - 1}
                      style={{ fill: i === 0 ? "var(--accent)" : "var(--raised)", stroke: "var(--accent)" }}
                      strokeWidth={1.5}
                    />
                  ))}
                </>
              )}
            </g>
          </svg>

          {editingShape && textEdit && (
            <TextEditor
              ref={textArea}
              shape={{ ...editingShape, text: textEdit.draft }}
              scale={scale}
              view={view}
              onChange={(draft) => setTextEdit({ ...textEdit, draft, selectAll: false })}
              onDone={commitText}
            />
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 pb-2.5">
            <p id="io-editor-hint" className="truncate rounded-[6px] bg-raised/90 px-2 py-0.5 text-[12px] text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
              {hint}
            </p>
            <p className="tabular shrink-0 rounded-[6px] bg-raised/90 px-2 py-0.5 text-[12px] text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/0.08)]" aria-live="polite">
              {maskCount(value.filter((o) => !(o.shapes.length === 1 && o.shapes[0].kind === "text")).length)} · {tio("zoom", { percent: Math.round(view.zoom * 100) })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Text editing ------------------------------ */

function TextEditor({
  ref,
  shape,
  scale,
  view,
  onChange,
  onDone,
}: {
  ref: Ref<HTMLTextAreaElement>;
  shape: TextShape;
  scale: number;
  view: View;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const layout = textLayout(shape);
  const s = scale * shape.scale;
  return (
    <textarea
      ref={ref}
      aria-label={tr("editing-image-occlusion-text-tool")}
      value={shape.text}
      spellCheck={false}
      wrap="off"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      className="absolute m-0 resize-none overflow-hidden border-0 p-0 outline-none"
      style={{
        left: shape.left * scale + view.x,
        top: shape.top * scale + view.y,
        width: Math.max(layout.width, shape.fontSize) * s + 2,
        height: layout.height * s,
        transform: shape.angle ? `rotate(${shape.angle}deg)` : undefined,
        transformOrigin: "0 0",
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: shape.fontSize * s,
        lineHeight: `${layout.lineHeight * s}px`,
        color: shape.fill,
        background: TEXT_BACKGROUND_COLOR,
        boxShadow: "0 0 0 2px var(--accent)",
        whiteSpace: "pre",
      }}
    />
  );
}

/* ------------------------------ Fill colours ------------------------------ */

function FillSwatches({ colour, fillActive, onColour }: { colour: string; fillActive: boolean; onColour: (colour: string) => void }) {
  const custom = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const label = tio("maskColour");
  const name = colourName(colour);
  const choose = (next: string) => {
    onColour(next);
    setOpen(false);
  };
  return (
    <div className="mt-1 flex flex-col items-center border-t border-line pt-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip
          side="right"
          content={
            <span className="block max-w-[220px]">
              <span className="font-semibold">
                {label}: {name}
              </span>
              <br />
              {tio("maskColourHint")}
            </span>
          }
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${name}`}
              className={cn(
                "grid size-8 place-items-center rounded-[8px] transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover",
                "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]",
                (open || fillActive) && "bg-accent-soft hover:bg-accent-soft",
              )}
            >
              <span aria-hidden className="size-5 rounded-full border border-line-strong shadow-thumb" style={{ background: colour }} />
            </button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            aria-label={label}
            className="z-50 w-[206px] rounded-[10px] border border-line bg-raised p-3 shadow-pop outline-none data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
          >
            <p className="text-[12px] font-semibold text-ink-2">{label}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{tio("maskColourHint")}</p>
            <div role="group" aria-label={label} className="mt-2.5 grid grid-cols-4 gap-1">
              {FILL_COLOURS.map((swatch) => {
                const on = swatch.value === colour.toLowerCase();
                return (
                  <Tooltip key={swatch.value} content={tio(swatch.name)} side="bottom">
                    <button
                      type="button"
                      aria-label={tio(swatch.name)}
                      aria-pressed={on}
                      onClick={() => choose(swatch.value)}
                      className={cn(
                        "size-[42px] rounded-[8px] p-[7px] transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover",
                        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]",
                        on && "shadow-[inset_0_0_0_2px_var(--accent)] hover:bg-transparent",
                      )}
                    >
                      <span aria-hidden className="block size-full rounded-full border border-line-strong" style={{ background: swatch.value }} />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => custom.current?.click()}
              className="relative mt-2 flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-[12.5px] text-ink transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
            >
              <Pipette aria-hidden className="size-3.5 text-ink-2" />
              {tio("customColour")}
              <input
                ref={custom}
                type="color"
                tabIndex={-1}
                aria-hidden
                value={colour}
                onChange={(e) => onColour(e.target.value)}
                className="pointer-events-none absolute inset-0 size-full opacity-0"
              />
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

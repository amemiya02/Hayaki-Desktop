// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Geometry for the mask editor: bounds, hit tests, moving, resizing, rotating
 * and aligning shapes. A shape rotates about its top-left corner, as fabric
 * stores it and as the review draws it.
 */
import { polygonTopLeft, TEXT_FONT_FAMILY, TEXT_PADDING, type Occlusion, type Point, type Shape, type Size, type TextShape } from "./shapes";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Unscaled size of a text shape's box, padding included. */
export type MeasureText = (shape: TextShape) => Size;

/* ------------------------------ Text ------------------------------ */

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
}

interface TextContext {
  font: string;
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number };
}

/** Lays out text exactly as the review's canvas draws it (review.ts `drawShape`). */
export function layoutText(ctx: TextContext, shape: Pick<TextShape, "text" | "fontSize">): TextLayout {
  ctx.font = `${shape.fontSize}px ${TEXT_FONT_FAMILY}`;
  const lines = shape.text.split("\n");
  const base = ctx.measureText("M");
  const fontHeight = base.actualBoundingBoxAscent + base.actualBoundingBoxDescent;
  const lineHeight = 1.5 * fontHeight;
  let maxWidth = 0;
  for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  return { lines, lineHeight, width: maxWidth + TEXT_PADDING, height: lines.length * lineHeight + TEXT_PADDING };
}

/* ------------------------------ Frames ------------------------------ */

export function rotatePoint(p: Point, origin: Point, degrees: number): Point {
  if (!degrees) return p;
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

/** The point a shape rotates about and positions from. */
export function shapeOrigin(shape: Shape): Point {
  return shape.kind === "polygon" ? polygonTopLeft(shape.points) : { x: shape.left, y: shape.top };
}

/** Polygons are drawn unrotated, as the review does. */
export function shapeAngle(shape: Shape): number {
  return shape.kind === "polygon" ? 0 : shape.angle;
}

/** Width and height of the shape before rotation. */
export function localSize(shape: Shape, measure: MeasureText): Size {
  switch (shape.kind) {
    case "rect":
      return { width: shape.width, height: shape.height };
    case "ellipse":
      return { width: shape.rx * 2, height: shape.ry * 2 };
    case "text": {
      const box = measure(shape);
      return { width: box.width * shape.scale, height: box.height * shape.scale };
    }
    case "polygon": {
      const b = pointsBox(shape.points);
      return { width: b.width, height: b.height };
    }
  }
}

export function pointsBox(points: Point[]): Box {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The four corners of the shape's box, rotated: top-left, top-right, bottom-right, bottom-left. */
export function shapeCorners(shape: Shape, measure: MeasureText): Point[] {
  const o = shapeOrigin(shape);
  const { width, height } = localSize(shape, measure);
  const angle = shapeAngle(shape);
  return [
    { x: o.x, y: o.y },
    { x: o.x + width, y: o.y },
    { x: o.x + width, y: o.y + height },
    { x: o.x, y: o.y + height },
  ].map((p) => rotatePoint(p, o, angle));
}

export function shapeBounds(shape: Shape, measure: MeasureText): Box {
  return pointsBox(shapeCorners(shape, measure));
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  return pointsBox(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]));
}

export function occlusionBounds(occlusion: Occlusion, measure: MeasureText): Box {
  return unionBoxes(occlusion.shapes.map((s) => shapeBounds(s, measure)))!;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/* ------------------------------ Hit testing ------------------------------ */

function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether `p` falls on the shape, with `slop` pixels of tolerance. */
export function shapeContains(shape: Shape, p: Point, measure: MeasureText, slop = 0): boolean {
  if (shape.kind === "polygon") {
    if (pointInPolygon(p, shape.points)) return true;
    if (slop <= 0) return false;
    // near an edge
    return shape.points.some((a, i) => distanceToSegment(p, a, shape.points[(i + 1) % shape.points.length]) <= slop);
  }
  const o = shapeOrigin(shape);
  const q = rotatePoint(p, o, -shapeAngle(shape));
  const { width, height } = localSize(shape, measure);
  const x = q.x - o.x;
  const y = q.y - o.y;
  if (shape.kind === "ellipse") {
    const rx = width / 2 + slop;
    const ry = height / 2 + slop;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (x - width / 2) / rx;
    const ny = (y - height / 2) / ry;
    return nx * nx + ny * ny <= 1;
  }
  return x >= -slop && x <= width + slop && y >= -slop && y <= height + slop;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The topmost occlusion under `p`, searching from the end of the list. */
export function hitOcclusion(occlusions: Occlusion[], p: Point, measure: MeasureText, slop = 0): Occlusion | null {
  for (let i = occlusions.length - 1; i >= 0; i--) {
    if (occlusions[i].shapes.some((s) => shapeContains(s, p, measure, slop))) return occlusions[i];
  }
  return null;
}

/* ------------------------------ Changing shapes ------------------------------ */

export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  if (shape.kind === "polygon") {
    return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { ...shape, left: shape.left + dx, top: shape.top + dy };
}

export function translateOcclusion(occlusion: Occlusion, dx: number, dy: number): Occlusion {
  return { ...occlusion, shapes: occlusion.shapes.map((s) => translateShape(s, dx, dy)) };
}

/** Limits a move so `box` stays inside the image, unless it is larger than the image. */
export function clampDelta(box: Box, dx: number, dy: number, size: Size): Point {
  let x = dx;
  let y = dy;
  if (box.width <= size.width) x = Math.min(Math.max(box.x + dx, 0), size.width - box.width) - box.x;
  if (box.height <= size.height) y = Math.min(Math.max(box.y + dy, 0), size.height - box.height) - box.y;
  return { x, y };
}

/** Handle position in the shape's box: 0, 0.5 or 1 on each axis. */
export interface Handle {
  hx: 0 | 0.5 | 1;
  hy: 0 | 0.5 | 1;
}

export const EDGE_HANDLES: Handle[] = [
  { hx: 0, hy: 0 },
  { hx: 0.5, hy: 0 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 0.5 },
  { hx: 1, hy: 1 },
  { hx: 0.5, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: 0, hy: 0.5 },
];

export const CORNER_HANDLES: Handle[] = EDGE_HANDLES.filter((h) => h.hx !== 0.5 && h.hy !== 0.5);

/** Where a handle sits on a shape's rotated box. */
export function handlePoint(shape: Shape, handle: Handle, measure: MeasureText): Point {
  const o = shapeOrigin(shape);
  const { width, height } = localSize(shape, measure);
  return rotatePoint({ x: o.x + width * handle.hx, y: o.y + height * handle.hy }, o, shapeAngle(shape));
}

const MIN_SIDE = 2;

/**
 * Resizes one rectangle, ellipse or text shape by dragging `handle` to `p`, in
 * the shape's own rotated frame. Text scales uniformly from the opposite corner.
 */
export function resizeShape(start: Shape, handle: Handle, p: Point, measure: MeasureText): Shape {
  if (start.kind === "polygon") return start;
  const o = shapeOrigin(start);
  const angle = shapeAngle(start);
  const { width: w, height: h } = localSize(start, measure);
  const q = rotatePoint(p, o, -angle);
  const lx = q.x - o.x;
  const ly = q.y - o.y;

  let x0 = 0;
  let y0 = 0;
  let x1 = w;
  let y1 = h;
  if (start.kind === "text") {
    const opp = { x: handle.hx === 0 ? w : 0, y: handle.hy === 0 ? h : 0 };
    const corner = { x: handle.hx * w, y: handle.hy * h };
    const d = { x: corner.x - opp.x, y: corner.y - opp.y };
    const length = d.x * d.x + d.y * d.y;
    const f = Math.max(0.05 / start.scale, length ? ((lx - opp.x) * d.x + (ly - opp.y) * d.y) / length : 1);
    x0 = Math.min(opp.x, opp.x + d.x * f);
    y0 = Math.min(opp.y, opp.y + d.y * f);
    const origin = rotatePoint({ x: o.x + x0, y: o.y + y0 }, o, angle);
    return { ...start, left: origin.x, top: origin.y, scale: start.scale * f };
  }
  if (handle.hx === 0) x0 = Math.min(lx, w - MIN_SIDE);
  if (handle.hx === 1) x1 = Math.max(lx, MIN_SIDE);
  if (handle.hy === 0) y0 = Math.min(ly, h - MIN_SIDE);
  if (handle.hy === 1) y1 = Math.max(ly, MIN_SIDE);
  const origin = rotatePoint({ x: o.x + x0, y: o.y + y0 }, o, angle);
  const width = x1 - x0;
  const height = y1 - y0;
  if (start.kind === "rect") return { ...start, left: origin.x, top: origin.y, width, height };
  return { ...start, left: origin.x, top: origin.y, rx: width / 2, ry: height / 2 };
}

/** Scales a shape about `anchor`; used for groups, several shapes and polygons. */
export function scaleShape(shape: Shape, anchor: Point, sx: number, sy: number): Shape {
  const map = (p: Point): Point => ({ x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy });
  switch (shape.kind) {
    case "polygon":
      return { ...shape, points: shape.points.map(map) };
    case "rect": {
      const o = map({ x: shape.left, y: shape.top });
      return { ...shape, left: o.x, top: o.y, width: shape.width * sx, height: shape.height * sy };
    }
    case "ellipse": {
      const o = map({ x: shape.left, y: shape.top });
      return { ...shape, left: o.x, top: o.y, rx: shape.rx * sx, ry: shape.ry * sy };
    }
    case "text": {
      const o = map({ x: shape.left, y: shape.top });
      return { ...shape, left: o.x, top: o.y, scale: shape.scale * Math.min(sx, sy) };
    }
  }
}

/** New box when an axis-aligned `box` has `handle` dragged to `p`; returns scale and anchor. */
export function boxScale(box: Box, handle: Handle, p: Point, minSide = MIN_SIDE): { anchor: Point; sx: number; sy: number } {
  const anchor = { x: box.x + box.width * (1 - handle.hx), y: box.y + box.height * (1 - handle.hy) };
  let sx = 1;
  let sy = 1;
  if (handle.hx !== 0.5 && box.width > 0) {
    const width = handle.hx === 1 ? p.x - box.x : box.x + box.width - p.x;
    sx = Math.max(minSide, width) / box.width;
  }
  if (handle.hy !== 0.5 && box.height > 0) {
    const height = handle.hy === 1 ? p.y - box.y : box.y + box.height - p.y;
    sy = Math.max(minSide, height) / box.height;
  }
  return { anchor, sx, sy };
}

/** Rotates a shape about its centre to `angle` degrees (fabric's centred rotation). */
export function rotateShape(shape: Shape, angle: number, measure: MeasureText): Shape {
  if (shape.kind === "polygon") return shape;
  const corners = shapeCorners(shape, measure);
  const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  const { width, height } = localSize(shape, measure);
  const origin = rotatePoint({ x: center.x - width / 2, y: center.y - height / 2 }, center, angle);
  return { ...shape, angle: normalizeAngle(angle), left: origin.x, top: origin.y };
}

export function normalizeAngle(angle: number): number {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
}

/** Angle for a rotate handle dragged to `p` around `center`; snaps to 0 within 3 degrees (upstream), or to 15 with `step`. */
export function dragAngle(center: Point, p: Point, step = false): number {
  let angle = normalizeAngle((Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90);
  if (step) angle = normalizeAngle(Math.round(angle / 15) * 15);
  else if (angle < 3 || angle > 357) angle = 0;
  return angle;
}

/* ------------------------------ Aligning ------------------------------ */

export type Alignment = "left" | "h-center" | "right" | "top" | "v-center" | "bottom";

/**
 * Aligns the selected occlusions: one is aligned to the image, several to the
 * box around them all (tool-aligns.ts).
 */
export function alignOcclusions(occlusions: Occlusion[], ids: Set<string>, alignment: Alignment, size: Size, measure: MeasureText): Occlusion[] {
  const chosen = occlusions.filter((o) => ids.has(o.id));
  if (chosen.length === 0) return occlusions;
  const boxes = new Map(chosen.map((o) => [o.id, occlusionBounds(o, measure)]));
  const target: Box = chosen.length === 1 ? { x: 0, y: 0, width: size.width, height: size.height } : unionBoxes([...boxes.values()])!;
  return occlusions.map((o) => {
    const b = boxes.get(o.id);
    if (!b) return o;
    let dx = 0;
    let dy = 0;
    switch (alignment) {
      case "left":
        dx = target.x - b.x;
        break;
      case "h-center":
        dx = target.x + target.width / 2 - (b.x + b.width / 2);
        break;
      case "right":
        dx = target.x + target.width - (b.x + b.width);
        break;
      case "top":
        dy = target.y - b.y;
        break;
      case "v-center":
        dy = target.y + target.height / 2 - (b.y + b.height / 2);
        break;
      case "bottom":
        dy = target.y + target.height - (b.y + b.height);
        break;
    }
    return dx || dy ? translateOcclusion(o, dx, dy) : o;
  });
}

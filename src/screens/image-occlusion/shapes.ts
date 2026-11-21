// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Image Occlusion masks and their cloze text, ported from upstream's
 * ts/routes/image-occlusion/shapes (base, lib, to-cloze, from-cloze) without
 * fabric. The editor keeps shapes in the image's own pixels; the cloze text
 * stores them normalised to 0-1, exactly as Anki writes it, so Notes round-trip.
 */

/* ------------------------------ Constants (tools/lib.ts) ------------------------------ */

/** These are Card Content values written into Notes, so they are literal colours. */
export const SHAPE_MASK_COLOR = "#ffeba2";
export const BORDER_COLOR = "#212121";
export const TEXT_BACKGROUND_COLOR = "#ffffff";
export const TEXT_FONT_FAMILY = "Arial";
export const TEXT_PADDING = 5;
/** Upstream's default text size in canvas pixels. */
export const TEXT_FONT_SIZE = 40;
export const TEXT_COLOR = "#000000";

/* ------------------------------ Model ------------------------------ */

export interface Point {
  x: number;
  y: number;
}

interface ShapeBase {
  id: string;
  /** Degrees, clockwise, about the shape's top-left corner (fabric's origin). */
  angle: number;
  fill: string;
}

export interface RectShape extends ShapeBase {
  kind: "rect";
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  left: number;
  top: number;
  rx: number;
  ry: number;
}

/** Points are where the polygon is drawn; its left and top are their minimum. */
export interface PolygonShape extends ShapeBase {
  kind: "polygon";
  points: Point[];
}

export interface TextShape extends ShapeBase {
  kind: "text";
  left: number;
  top: number;
  text: string;
  scale: number;
  /** Unscaled font size. */
  fontSize: number;
}

export type Shape = RectShape | EllipseShape | PolygonShape | TextShape;
export type ShapeKind = Shape["kind"];

/**
 * One entry on the canvas: a single shape, or a group of shapes that share a
 * cloze number. `ordinal` is kept from the Note being edited; new entries get
 * one when the Note is saved.
 */
export interface Occlusion {
  id: string;
  shapes: Shape[];
  ordinal?: number;
}

export interface Size {
  width: number;
  height: number;
}

let counter = 0;
export function newId(prefix = "s"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function isGroup(occlusion: Occlusion): boolean {
  return occlusion.shapes.length > 1;
}

/** A single text shape: it has no cloze number of its own (c0). */
export function isLoneText(occlusion: Occlusion): boolean {
  return occlusion.shapes.length === 1 && occlusion.shapes[0].kind === "text";
}

/* ------------------------------ Number formats (shapes/lib.ts) ------------------------------ */

/**
 * Up to 4 fraction digits, which when rounded reproduces identical pixels for
 * widths and heights up to 10k pixels.
 */
export function floatToDisplay(number: number): string {
  if (Number.isNaN(number) || number == 0) {
    return ".0000";
  }
  return number.toFixed(4).replace(/^0+|0+$/g, "");
}

const ANGLE_STEPS = 10000;

export function angleToStored(angle: unknown): number | null {
  const angleDeg = Number(angle) % 360;
  return Number.isNaN(angleDeg) ? null : Math.round((angleDeg / 360) * ANGLE_STEPS);
}

export function storedToAngle(x: unknown): number | null {
  const angleSteps = Number(x) % ANGLE_STEPS;
  return Number.isNaN(angleSteps) ? null : (angleSteps / ANGLE_STEPS) * 360;
}

/* ------------------------------ Geometry helpers ------------------------------ */

export function polygonTopLeft(points: Point[]): Point {
  let left = points[0]?.x ?? 0;
  let top = points[0]?.y ?? 0;
  for (const p of points) {
    if (p.x < left) left = p.x;
    if (p.y < top) top = p.y;
  }
  return { x: left, y: top };
}

/* ------------------------------ To cloze (shapes/to-cloze.ts) ------------------------------ */

type ClozeData = [string, string][];

function baseData(left: number, top: number, angle: number, size: Size): ClozeData {
  const stored = angleToStored(angle);
  const data: ClozeData = [
    ["left", floatToDisplay(left / size.width)],
    ["top", floatToDisplay(top / size.height)],
  ];
  if (stored) data.push(["angle", stored.toString()]);
  return data;
}

function shapeData(shape: Shape, size: Size): { type: string; data: ClozeData } {
  switch (shape.kind) {
    case "rect": {
      const data = baseData(shape.left, shape.top, shape.angle, size);
      data.push(["width", floatToDisplay(shape.width / size.width)], ["height", floatToDisplay(shape.height / size.height)]);
      if (shape.fill !== SHAPE_MASK_COLOR) data.push(["fill", shape.fill]);
      return { type: "rect", data };
    }
    case "ellipse": {
      const data = baseData(shape.left, shape.top, shape.angle, size);
      data.push(["rx", floatToDisplay(shape.rx / size.width)], ["ry", floatToDisplay(shape.ry / size.height)]);
      if (shape.fill !== SHAPE_MASK_COLOR) data.push(["fill", shape.fill]);
      return { type: "ellipse", data };
    }
    case "polygon": {
      const topLeft = polygonTopLeft(shape.points);
      const data = baseData(topLeft.x, topLeft.y, shape.angle, size);
      data.push([
        "points",
        shape.points.map(({ x, y }) => `${floatToDisplay(x / size.width)},${floatToDisplay(y / size.height)}`).join(" "),
      ]);
      if (shape.fill !== SHAPE_MASK_COLOR) data.push(["fill", shape.fill]);
      return { type: "polygon", data };
    }
    case "text": {
      const data = baseData(shape.left, shape.top, shape.angle, size);
      data.push(
        ["text", shape.text],
        // scaleX and scaleY are always equal: text keeps its aspect ratio
        ["scale", floatToDisplay(shape.scale)],
        ["fs", floatToDisplay(shape.fontSize / size.height)],
      );
      if (shape.fill !== TEXT_COLOR) data.push(["fill", shape.fill]);
      return { type: "text", data };
    }
  }
}

/** `{{c1::image-occlusion:rect:left=.1:top=.23:width=.4:height=.5}}<br>` */
export function shapeToCloze(shape: Shape, ordinal: number, occludeInactive: boolean, size: Size): string {
  let text = "";
  const addKeyValue = (key: string, value: string) => {
    value = value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    text += `:${key}=${value}`;
  };
  const { type, data } = shapeData(shape, size);
  for (const [key, value] of data) addKeyValue(key, value);
  if (occludeInactive) addKeyValue("oi", "1");
  return `{{c${ordinal}::image-occlusion:${type}${text}}}<br>`;
}

export interface ClozeExport {
  clozes: string;
  /** Cards the Note will have: every entry but lone text. */
  noteCount: number;
  /** The cloze number each entry was given, in order. */
  ordinals: number[];
}

/**
 * Upstream's `exportShapesToClozeDeletions`: keeps existing cloze numbers,
 * fills gaps first, then numbers new entries after the highest; lone text gets c0.
 * Entries whose shapes are all smaller than `minSize` pixels are left out.
 */
export function exportOcclusions(
  occlusions: Occlusion[],
  size: Size,
  occludeInactive: boolean,
  minSize = 0,
  measure?: (shape: TextShape) => Size,
): ClozeExport {
  const valid = occlusions
    .map((o) => ({ ...o, shapes: o.shapes.filter((s) => shapeIsValid(s, minSize, measure)) }))
    .filter((o) => o.shapes.length > 0);

  const ordinalList = valid.map((o) => o.ordinal);
  const defined = ordinalList.flatMap((v) => (typeof v === "number" ? [v] : []));
  const maxOrdinal = Math.max(...defined, 0);
  const missing: number[] = [];
  for (let i = 1; i <= maxOrdinal; i++) {
    if (!ordinalList.includes(i)) missing.push(i);
  }
  let nextOrdinal = maxOrdinal + 1;

  let clozes = "";
  let noteCount = 0;
  const ordinals: number[] = [];
  for (const occlusion of valid) {
    let ordinal = occlusion.ordinal;
    if (ordinal === undefined) {
      if (isLoneText(occlusion)) ordinal = 0;
      else if (missing.length > 0) ordinal = missing.shift()!;
      else ordinal = nextOrdinal++;
    }
    ordinals.push(ordinal);
    for (const shape of occlusion.shapes) clozes += shapeToCloze(shape, ordinal, occludeInactive, size);
    if (!isLoneText(occlusion)) noteCount++;
  }
  return { clozes, noteCount, ordinals };
}

/** Upstream skips shapes narrower or shorter than 5 canvas pixels. */
function shapeIsValid(shape: Shape, minSize: number, measure?: (shape: TextShape) => Size): boolean {
  if (minSize <= 0) return true;
  switch (shape.kind) {
    case "rect":
      return shape.width >= minSize && shape.height >= minSize;
    case "ellipse":
      return shape.rx * 2 >= minSize && shape.ry * 2 >= minSize;
    case "polygon": {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      return Math.max(...xs) - Math.min(...xs) >= minSize && Math.max(...ys) - Math.min(...ys) >= minSize;
    }
    case "text": {
      if (!shape.text.trim()) return false;
      if (!measure) return true;
      const box = measure(shape);
      return box.width >= minSize && box.height >= minSize;
    }
  }
}

/* ------------------------------ From cloze (shapes/from-cloze.ts) ------------------------------ */

/** The shape of `GetImageOcclusionNoteResponse.ImageOcclusion`. */
export interface StoredOcclusion {
  ordinal: number;
  shapes: { shape: string; properties: { name: string; value: string }[] }[];
}

const SHAPE_TYPES = ["rect", "ellipse", "polygon", "text"] as const;
type StoredType = (typeof SHAPE_TYPES)[number];

function isValidType(type: string): type is StoredType {
  return (SHAPE_TYPES as readonly string[]).includes(type);
}

function num(value: string | undefined, fallback = 0): number {
  const n = parseFloat(value ?? "");
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Builds a shape from stored (normalised) properties, in pixels of `size`.
 * `defaultFontSize` is used when a text shape has no stored size.
 */
export function buildShape(type: StoredType, props: Record<string, string | undefined>, size: Size, defaultFontSize: number): Shape {
  const left = (Number.isNaN(Number(props.left)) ? 0 : num(props.left)) * size.width;
  const top = (Number.isNaN(Number(props.top)) ? 0 : num(props.top)) * size.height;
  const angle = storedToAngle(props.angle) ?? 0;
  const id = newId(type);
  switch (type) {
    case "rect":
      return {
        kind: "rect",
        id,
        angle,
        fill: props.fill ?? SHAPE_MASK_COLOR,
        left,
        top,
        width: num(props.width) * size.width,
        height: num(props.height) * size.height,
      };
    case "ellipse":
      return {
        kind: "ellipse",
        id,
        angle,
        fill: props.fill ?? SHAPE_MASK_COLOR,
        left,
        top,
        rx: num(props.rx) * size.width,
        ry: num(props.ry) * size.height,
      };
    case "polygon": {
      const raw = props.points
        ? props.points.split(" ").map((point) => {
            const [x, y] = point.split(",");
            return { x: num(x) * size.width, y: num(y) * size.height };
          })
        : [{ x: 0, y: 0 }];
      // The review draws the points offset so their top-left sits at left/top.
      const topLeft = polygonTopLeft(raw);
      const dx = left - topLeft.x;
      const dy = top - topLeft.y;
      return {
        kind: "polygon",
        id,
        angle,
        fill: props.fill ?? SHAPE_MASK_COLOR,
        points: raw.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    }
    case "text": {
      const fs = num(props.fs);
      return {
        kind: "text",
        id,
        angle,
        fill: props.fill ?? TEXT_COLOR,
        left,
        top,
        text: props.text ?? "",
        scale: num(props.scale, 1) || 1,
        fontSize: fs ? fs * size.height : defaultFontSize,
      };
    }
  }
}

/** Upstream's `extractShapesFromClozedField`: lone shapes for c0, groups for shared numbers. */
export function occlusionsFromStored(stored: StoredOcclusion[], size: Size, defaultFontSize: number): Occlusion[] {
  const output: Occlusion[] = [];
  for (const occlusion of stored) {
    const group: Shape[] = [];
    for (const shape of occlusion.shapes) {
      if (!isValidType(shape.shape)) continue;
      const props = Object.fromEntries(shape.properties.map((p) => [p.name, p.value]));
      group.push(buildShape(shape.shape, props, size, defaultFontSize));
    }
    if (group.length === 0) continue;
    if (occlusion.ordinal === 0) {
      for (const s of group) output.push({ id: newId("o"), shapes: [s], ordinal: 0 });
    } else {
      output.push({ id: newId("o"), shapes: group, ordinal: occlusion.ordinal });
    }
  }
  return output;
}

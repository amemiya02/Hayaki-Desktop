// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { describe, expect, it } from "vitest";

import { alignOcclusions, boxScale, dragAngle, layoutText, resizeShape, rotateShape, shapeBounds, shapeContains, shapeCorners } from "./geometry";
import { commit, duplicateOcclusions, fillOcclusions, fillShape, groupOcclusions, initHistory, redo, undo, ungroupOcclusions } from "./editing";
import {
  angleToStored,
  exportOcclusions,
  floatToDisplay,
  occlusionsFromStored,
  SHAPE_MASK_COLOR,
  storedToAngle,
  type Occlusion,
  type Shape,
  type StoredOcclusion,
  type TextShape,
} from "./shapes";

const size = { width: 1000, height: 500 };
const measure = (s: TextShape) => ({ width: s.text.length * 10, height: 20 });

function rect(left: number, top: number, width: number, height: number, extra: Partial<Shape> = {}): Shape {
  return { kind: "rect", id: `r${left}${top}`, angle: 0, fill: SHAPE_MASK_COLOR, left, top, width, height, ...extra } as Shape;
}

function single(shape: Shape, ordinal?: number): Occlusion {
  return { id: `o-${shape.id}`, shapes: [shape], ordinal };
}

/**
 * Parses cloze text the way the engine does (rslib image_occlusion), giving
 * what `getImageOcclusionNote` returns.
 */
function parseClozes(text: string): StoredOcclusion[] {
  const byOrdinal = new Map<number, StoredOcclusion>();
  for (const match of text.matchAll(/\{\{c(\d+)::image-occlusion:((?:[^}\\]|\\.)*)\}\}/g)) {
    const ordinal = Number(match[1]);
    const parts: string[] = [];
    let current = "";
    const body = match[2];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "\\") {
        current += body[++i];
      } else if (body[i] === ":") {
        parts.push(current);
        current = "";
      } else current += body[i];
    }
    parts.push(current);
    const [shape, ...props] = parts;
    const properties = props.map((p) => {
      const at = p.indexOf("=");
      return { name: p.slice(0, at), value: p.slice(at + 1) };
    });
    const entry = byOrdinal.get(ordinal) ?? { ordinal, shapes: [] };
    entry.shapes.push({ shape, properties });
    byOrdinal.set(ordinal, entry);
  }
  return [...byOrdinal.values()];
}

describe("number formats", () => {
  it("formats floats as upstream", () => {
    expect(floatToDisplay(0)).toBe(".0000");
    expect(floatToDisplay(NaN)).toBe(".0000");
    expect(floatToDisplay(0.1)).toBe(".1");
    expect(floatToDisplay(0.12345)).toBe(".1235");
    expect(floatToDisplay(1)).toBe("1.");
    expect(floatToDisplay(0.5)).toBe(".5");
  });

  it("stores angles in ten-thousandths of a turn", () => {
    expect(angleToStored(90)).toBe(2500);
    expect(angleToStored(450)).toBe(2500);
    expect(angleToStored("x")).toBeNull();
    expect(storedToAngle("2500")).toBe(90);
    expect(storedToAngle(undefined)).toBeNull();
  });
});

describe("to cloze", () => {
  it("writes a rectangle", () => {
    const out = exportOcclusions([single(rect(100, 50, 200, 100))], size, true);
    expect(out.clozes).toBe("{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:oi=1}}<br>");
    expect(out.noteCount).toBe(1);
  });

  it("writes every shape kind with angle and fill", () => {
    const shapes: Shape[] = [
      rect(0, 0, 500, 250, { angle: 90, fill: "#ff0000" }),
      { kind: "ellipse", id: "e", angle: 0, fill: SHAPE_MASK_COLOR, left: 100, top: 100, rx: 50, ry: 25 },
      { kind: "polygon", id: "p", angle: 0, fill: SHAPE_MASK_COLOR, points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }] },
      { kind: "text", id: "t", angle: 0, fill: "#000000", left: 10, top: 20, text: "a:b\\c", scale: 1.5, fontSize: 40 },
    ];
    const out = exportOcclusions(shapes.map((s) => single(s)), size, false);
    expect(out.clozes).toBe(
      "{{c1::image-occlusion:rect:left=.0000:top=.0000:angle=2500:width=.5:height=.5:fill=#ff0000}}<br>" +
        "{{c2::image-occlusion:ellipse:left=.1:top=.2:rx=.05:ry=.05}}<br>" +
        "{{c3::image-occlusion:polygon:left=.1:top=.2:points=.1,.2 .2,.2 .15,.4}}<br>" +
        "{{c0::image-occlusion:text:left=.01:top=.04:text=a\\:b\\\\c:scale=1.5:fs=.08}}<br>",
    );
    expect(out.noteCount).toBe(3);
    expect(out.ordinals).toEqual([1, 2, 3, 0]);
  });

  it("keeps existing numbers, fills gaps, then continues", () => {
    const out = exportOcclusions(
      [single(rect(0, 0, 10, 10), 3), single(rect(20, 0, 10, 10)), single(rect(40, 0, 10, 10)), single(rect(60, 0, 10, 10)), single(rect(80, 0, 10, 10))],
      size,
      false,
    );
    expect(out.ordinals).toEqual([3, 1, 2, 4, 5]);
  });

  it("writes a group with one number", () => {
    const group: Occlusion = { id: "g", shapes: [rect(0, 0, 100, 100), rect(200, 0, 100, 100)] };
    const out = exportOcclusions([group], size, false);
    expect(out.clozes.match(/\{\{c1::/g)?.length).toBe(2);
    expect(out.noteCount).toBe(1);
  });

  it("leaves out shapes smaller than the minimum", () => {
    const out = exportOcclusions([single(rect(0, 0, 3, 100)), single(rect(0, 0, 50, 50))], size, false, 5);
    expect(out.noteCount).toBe(1);
  });
});

describe("from cloze", () => {
  it("round-trips through the stored form", () => {
    const original: Occlusion[] = [
      single(rect(100, 50, 200, 100, { angle: 30 })),
      { id: "g", shapes: [rect(300, 300, 50, 50), { kind: "ellipse", id: "e", angle: 0, fill: "#00ff00", left: 600, top: 200, rx: 40, ry: 20 }] },
      single({ kind: "polygon", id: "p", angle: 0, fill: SHAPE_MASK_COLOR, points: [{ x: 500, y: 100 }, { x: 700, y: 120 }, { x: 650, y: 300 }] }),
      single({ kind: "text", id: "t", angle: 0, fill: "#000000", left: 10, top: 20, text: "hello:world", scale: 2, fontSize: 30 }),
    ];
    const first = exportOcclusions(original, size, true);
    const loaded = occlusionsFromStored(parseClozes(first.clozes), size, 40);
    // same numbers kept on reload
    const second = exportOcclusions(loaded, size, true);
    const sorted = (s: string) => s.split("<br>").sort().join("<br>");
    expect(sorted(second.clozes)).toBe(sorted(first.clozes));
    const group = loaded.find((o) => o.shapes.length === 2)!;
    expect(group.ordinal).toBe(2);
    const text = loaded.find((o) => o.shapes[0].kind === "text")!;
    expect(text.ordinal).toBe(0);
    expect(text.shapes[0]).toMatchObject({ text: "hello:world", scale: 2 });
    expect((text.shapes[0] as TextShape).fontSize).toBeCloseTo(30);
  });

  it("offsets polygon points to their stored left and top", () => {
    const stored: StoredOcclusion[] = [
      {
        ordinal: 1,
        shapes: [{ shape: "polygon", properties: [{ name: "left", value: ".5" }, { name: "top", value: ".5" }, { name: "points", value: ".1,.1 .2,.1 .2,.2" }] }],
      },
    ];
    const [o] = occlusionsFromStored(stored, size, 40);
    const shape = o.shapes[0];
    expect(shape.kind).toBe("polygon");
    if (shape.kind === "polygon") expect(shape.points[0]).toEqual({ x: 500, y: 250 });
  });

  it("skips unknown shapes and defaults missing values", () => {
    const stored: StoredOcclusion[] = [
      { ordinal: 1, shapes: [{ shape: "star", properties: [] }] },
      { ordinal: 2, shapes: [{ shape: "text", properties: [{ name: "left", value: "abc" }, { name: "text", value: "x" }] }] },
    ];
    const loaded = occlusionsFromStored(stored, size, 40);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].shapes[0]).toMatchObject({ left: 0, fontSize: 40, scale: 1 });
  });
});

describe("geometry", () => {
  it("rotates about the top-left corner", () => {
    const corners = shapeCorners(rect(0, 0, 10, 20, { angle: 90 }), measure);
    expect(corners[1].x).toBeCloseTo(0);
    expect(corners[1].y).toBeCloseTo(10);
    const b = shapeBounds(rect(0, 0, 10, 20, { angle: 90 }), measure);
    expect(b.x).toBeCloseTo(-20);
    expect(b.width).toBeCloseTo(20);
  });

  it("hit tests rotated shapes and ellipses", () => {
    const r = rect(0, 0, 10, 20, { angle: 90 });
    expect(shapeContains(r, { x: -5, y: 5 }, measure)).toBe(true);
    expect(shapeContains(r, { x: 5, y: 5 }, measure)).toBe(false);
    const e: Shape = { kind: "ellipse", id: "e", angle: 0, fill: "", left: 0, top: 0, rx: 10, ry: 5 };
    expect(shapeContains(e, { x: 10, y: 5 }, measure)).toBe(true);
    expect(shapeContains(e, { x: 1, y: 1 }, measure)).toBe(false);
  });

  it("resizes in the shape's frame", () => {
    const r = resizeShape(rect(10, 10, 100, 50), { hx: 1, hy: 1 }, { x: 210, y: 110 }, measure);
    expect(r).toMatchObject({ left: 10, top: 10, width: 200, height: 100 });
    const l = resizeShape(rect(10, 10, 100, 50), { hx: 0, hy: 0.5 }, { x: 60, y: 999 }, measure);
    expect(l).toMatchObject({ left: 60, top: 10, width: 50, height: 50 });
  });

  it("scales text uniformly", () => {
    const t: Shape = { kind: "text", id: "t", angle: 0, fill: "", left: 0, top: 0, text: "abcd", scale: 1, fontSize: 40 };
    const r = resizeShape(t, { hx: 1, hy: 1 }, { x: 80, y: 40 }, measure);
    expect(r).toMatchObject({ left: 0, top: 0, scale: 2 });
  });

  it("rotates about the centre", () => {
    const r = rotateShape(rect(0, 0, 10, 10), 180, measure);
    expect(r).toMatchObject({ angle: 180 });
    if (r.kind === "rect") {
      expect(r.left).toBeCloseTo(10);
      expect(r.top).toBeCloseTo(10);
    }
    expect(dragAngle({ x: 0, y: 0 }, { x: 0.05, y: -10 })).toBe(0);
    expect(dragAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
  });

  it("scales a box from the opposite handle", () => {
    const s = boxScale({ x: 0, y: 0, width: 100, height: 100 }, { hx: 0, hy: 0 }, { x: 50, y: 50 });
    expect(s).toEqual({ anchor: { x: 100, y: 100 }, sx: 0.5, sy: 0.5 });
  });

  it("aligns one shape to the image and several to each other", () => {
    const list = [single(rect(100, 100, 50, 50)), single(rect(300, 200, 50, 50))];
    const one = alignOcclusions(list, new Set([list[0].id]), "right", size, measure);
    expect(one[0].shapes[0]).toMatchObject({ left: 950 });
    const both = alignOcclusions(list, new Set(list.map((o) => o.id)), "top", size, measure);
    expect(both[1].shapes[0]).toMatchObject({ top: 100 });
  });

  it("lays out text like the review", () => {
    const ctx = {
      font: "",
      measureText: (text: string) => ({ width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    };
    const layout = layoutText(ctx, { text: "ab\nabcd", fontSize: 20 });
    expect(layout).toEqual({ lines: ["ab", "abcd"], lineHeight: 15, width: 45, height: 35 });
    expect(ctx.font).toBe("20px Arial");
  });
});

describe("editing", () => {
  const a = single(rect(0, 0, 10, 10), 2);
  const b = single(rect(20, 0, 10, 10), 1);
  const c = single(rect(40, 0, 10, 10));

  it("groups with the lowest number", () => {
    const { occlusions, id } = groupOcclusions([a, b, c], new Set([a.id, b.id]));
    expect(occlusions).toHaveLength(2);
    const group = occlusions.find((o) => o.id === id)!;
    expect(group.ordinal).toBe(1);
    expect(group.shapes).toHaveLength(2);
    expect(groupOcclusions([a, c], new Set([a.id, c.id])).occlusions.find((o) => o.shapes.length === 2)!.ordinal).toBeUndefined();
  });

  it("ungroups into unnumbered shapes", () => {
    const { occlusions, id } = groupOcclusions([a, b], new Set([a.id, b.id]));
    const out = ungroupOcclusions(occlusions, new Set([id!]));
    expect(out.occlusions).toHaveLength(2);
    expect(out.occlusions.every((o) => o.ordinal === undefined)).toBe(true);
  });

  it("duplicates with an offset", () => {
    const out = duplicateOcclusions([a], new Set([a.id]), 10);
    expect(out.occlusions).toHaveLength(2);
    expect(out.occlusions[1].shapes[0]).toMatchObject({ left: 10, top: 10 });
    expect(out.occlusions[1].ordinal).toBeUndefined();
  });

  it("fills one shape", () => {
    const out = fillShape([a], a.shapes[0].id, "#123456");
    expect(out[0].shapes[0].fill).toBe("#123456");
    expect(fillShape(out, a.shapes[0].id, "#123456")).toBe(out);
  });

  it("fills the selected masks and leaves the rest", () => {
    const out = fillOcclusions([a], new Set([a.id]), "#a0e2ff");
    expect(out[0].shapes.every((s) => s.kind === "text" || s.fill === "#a0e2ff")).toBe(true);
    expect(fillOcclusions(out, new Set([a.id]), "#a0e2ff")).toBe(out);
    expect(fillOcclusions([a], new Set(), "#a0e2ff")[0]).toBe(a);
  });

  it("undoes and redoes", () => {
    let h = initHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    h = commit(h, 9);
    expect(h.future).toEqual([]);
    expect(h.past).toEqual([1]);
  });
});

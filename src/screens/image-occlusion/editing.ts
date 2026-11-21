// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** List operations behind the mask editor's tools (upstream tools/lib.ts), and its undo history. */
import { translateShape } from "./geometry";
import { newId, type Occlusion, type Shape } from "./shapes";

/** Joins the selected occlusions into one group sharing the lowest cloze number (`groupShapes`). */
export function groupOcclusions(occlusions: Occlusion[], ids: Set<string>): { occlusions: Occlusion[]; id: string | null } {
  const chosen = occlusions.filter((o) => ids.has(o.id));
  if (chosen.length < 2) return { occlusions, id: null };
  // As upstream: Math.min over the ordinals, so one unnumbered entry leaves the group unnumbered.
  const min = Math.min(...chosen.map((o) => o.ordinal ?? NaN));
  const group: Occlusion = {
    id: newId("o"),
    shapes: chosen.flatMap((o) => o.shapes),
    ordinal: Number.isNaN(min) ? undefined : min,
  };
  const lastIndex = occlusions.findLastIndex((o) => ids.has(o.id));
  const next: Occlusion[] = [];
  occlusions.forEach((o, i) => {
    if (!ids.has(o.id)) next.push(o);
    if (i === lastIndex) next.push(group);
  });
  return { occlusions: next, id: group.id };
}

/** Splits selected groups back into single shapes, each to be numbered anew (`unGroupShapes`). */
export function ungroupOcclusions(occlusions: Occlusion[], ids: Set<string>): { occlusions: Occlusion[]; ids: string[] } {
  const created: string[] = [];
  const next = occlusions.flatMap((o) => {
    if (!ids.has(o.id) || o.shapes.length < 2) return [o];
    return o.shapes.map((shape) => {
      const single: Occlusion = { id: newId("o"), shapes: [shape], ordinal: undefined };
      created.push(single.id);
      return single;
    });
  });
  return { occlusions: next, ids: created };
}

function copyShape(shape: Shape, offset: number): Shape {
  return { ...translateShape(shape, offset, offset), id: newId(shape.kind) };
}

/** Copies the selection, offset down and right; copies get new cloze numbers (`duplicateItem`). */
export function duplicateOcclusions(occlusions: Occlusion[], ids: Set<string>, offset: number): { occlusions: Occlusion[]; ids: string[] } {
  const copies = occlusions
    .filter((o) => ids.has(o.id))
    .map((o) => ({ id: newId("o"), shapes: o.shapes.map((s) => copyShape(s, offset)), ordinal: undefined }));
  return { occlusions: [...occlusions, ...copies], ids: copies.map((c) => c.id) };
}

export function removeOcclusions(occlusions: Occlusion[], ids: Set<string>): Occlusion[] {
  return occlusions.filter((o) => !ids.has(o.id));
}

/** Sets one shape's fill (`fillMask`); returns the list unchanged when nothing changes. */
export function fillShape(occlusions: Occlusion[], shapeId: string, colour: string): Occlusion[] {
  let changed = false;
  const next = occlusions.map((o) => {
    if (!o.shapes.some((s) => s.id === shapeId)) return o;
    return {
      ...o,
      shapes: o.shapes.map((s) => {
        if (s.id !== shapeId || s.fill === colour) return s;
        changed = true;
        return { ...s, fill: colour };
      }),
    };
  });
  return changed ? next : occlusions;
}

/**
 * Paints every mask in the given occlusions one colour; text keeps its own.
 * Returns the list unchanged when nothing changes.
 */
export function fillOcclusions(occlusions: Occlusion[], ids: Set<string>, colour: string): Occlusion[] {
  let changed = false;
  const next = occlusions.map((o) => {
    if (!ids.has(o.id)) return o;
    return {
      ...o,
      shapes: o.shapes.map((s) => {
        if (s.kind === "text" || s.fill === colour) return s;
        changed = true;
        return { ...s, fill: colour };
      }),
    };
  });
  return changed ? next : occlusions;
}

/* ------------------------------ Undo ------------------------------ */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;

export function initHistory<T>(value: T): History<T> {
  return { past: [], present: value, future: [] };
}

export function commit<T>(history: History<T>, value: T): History<T> {
  if (value === history.present) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present: value, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pointer dragging of Fields in the Fields tab (see `@/lib/pointer-drag`).
 * A row is `data-field-drop="<index>"`; the drop lands before or after it.
 */
import { createPointerDrag, type Edge } from "@/lib/pointer-drag";
import { tn } from "@/lib/strings/notetypes";

interface FieldSource {
  index: number;
  name: string;
  move: (from: number, to: number) => void;
}

/** The index the dragged field ends up at when dropped before or after row `target`, or null when that leaves it where it is. */
export function reorderTarget(from: number, target: number, edge: Edge): number | null {
  const slot = edge === "before" ? target : target + 1;
  if (slot === from || slot === from + 1) return null;
  return slot > from ? slot - 1 : slot;
}

const resolve = ({ index }: FieldSource, target: string, edge: Edge | null) => reorderTarget(index, Number(target), edge ?? "before");

export const fieldDrag = createPointerDrag<FieldSource>({
  attribute: "data-field-drop",
  edges: true,
  label: ({ name }) => name,
  accepts: (source, target, edge) => resolve(source, target, edge) !== null,
  hint: (source, target, valid, edge) => {
    const to = resolve(source, target, edge);
    return valid && to !== null ? tn("dragTo", { n: to + 1 }) : tn("dragInvalid");
  },
  drop: (source, target, edge) => {
    const to = resolve(source, target, edge);
    if (to !== null) source.move(source.index, to);
  },
});

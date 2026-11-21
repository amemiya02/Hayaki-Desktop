// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Measures text shapes with a canvas, as the review draws them. */
import { layoutText, type TextLayout } from "./geometry";
import type { Size, TextShape } from "./shapes";

let context: CanvasRenderingContext2D | null = null;
const cache = new Map<string, TextLayout>();

export function textLayout(shape: Pick<TextShape, "text" | "fontSize">): TextLayout {
  const key = `${shape.fontSize}\u0001${shape.text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  context ??= document.createElement("canvas").getContext("2d");
  const layout = context
    ? layoutText(context, shape)
    : { lines: shape.text.split("\n"), lineHeight: shape.fontSize, width: shape.fontSize, height: shape.fontSize };
  if (cache.size > 500) cache.clear();
  cache.set(key, layout);
  return layout;
}

export function measureText(shape: TextShape): Size {
  const layout = textLayout(shape);
  return { width: layout.width, height: layout.height };
}

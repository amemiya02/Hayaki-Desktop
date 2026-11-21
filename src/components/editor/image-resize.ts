// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Dragging an image corner: the new width, keeping the image's aspect ratio. */
export function resizedWidth(natural: { width: number; height: number }, drag: { width: number; height: number }): number {
  const aspect = natural.width / natural.height;
  const [minWidth, minHeight] = aspect > 1 ? [5 * aspect, 5] : [5, 5 / aspect];
  // Follow whichever axis the pointer has stretched further.
  if (drag.width / natural.width > drag.height / natural.height) return Math.max(Math.trunc(drag.width), minWidth);
  const height = Math.max(Math.trunc(drag.height), minHeight);
  return Math.trunc(natural.width * (height / natural.height));
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Pointer dragging of tags in the Browse sidebar (see `@/lib/pointer-drag`).
 * A tag row is `data-tag-drop="<full name>"`; the Tags header is `data-tag-drop=""`,
 * the top level.
 */
import { createPointerDrag } from "@/lib/pointer-drag";
import { tb } from "@/lib/strings/browse";
import { td } from "@/lib/strings/decks";

import * as ops from "./sidebar-ops";

export const tagDrag = createPointerDrag<string>({
  attribute: "data-tag-drop",
  label: ops.leafOf,
  accepts: ops.canReparent,
  hint: (_source, target, valid) => (!valid ? td("dragInvalid") : target ? tb("dragIntoTag", { tag: target }) : td("dragTop")),
  drop: (full, target) => void ops.change(() => ops.reparentTags([full], target)),
});

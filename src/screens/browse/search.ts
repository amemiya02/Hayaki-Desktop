// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Builds searches the way Anki's browser sidebar does: a plain click
 * replaces the search, Ctrl ANDs with it, Shift ORs with it, Ctrl+Shift
 * replaces terms of the same kind, and Alt negates the clicked term. The
 * core does the joining and quoting, so results match Anki exactly.
 */
import type { MessageInitShape } from "@bufbuild/protobuf";

import * as core from "@/lib/anki/generated/core";
import { cleanLabel } from "@/lib/i18n";
import {
  SearchNode_CardState,
  SearchNode_Flag,
  SearchNode_Group_Joiner,
  SearchNode_Rating,
  type SearchNodeSchema,
} from "@/lib/anki/proto/anki/search_pb";

export type NodeInit = MessageInitShape<typeof SearchNodeSchema>;

export type Combine = "set" | "and" | "or" | "replace";

export interface Modifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function combineFor(mods: Modifiers): { combine: Combine; negate: boolean } {
  const ctrl = mods.ctrlKey || mods.metaKey;
  const combine: Combine = ctrl && mods.shiftKey ? "replace" : ctrl ? "and" : mods.shiftKey ? "or" : "set";
  return { combine, negate: mods.altKey };
}

/** Wraps a node so the core negates it. */
export function negated(node: NodeInit): NodeInit {
  return { filter: { case: "negated", value: node } };
}

export function parsable(text: string): NodeInit {
  return { filter: { case: "parsableText", value: text } };
}

export function group(nodes: NodeInit[], joiner: "and" | "or" = "and"): NodeInit {
  return {
    filter: {
      case: "group",
      value: { nodes, joiner: joiner === "and" ? SearchNode_Group_Joiner.AND : SearchNode_Group_Joiner.OR },
    },
  };
}

/** The sidebar's search terms, as in `aqt/browser/sidebar/tree.py`. */
export const nodes = {
  dueToday: (): NodeInit => ({ filter: { case: "dueOnDay", value: 0 } }),
  addedToday: (): NodeInit => ({ filter: { case: "addedInDays", value: 1 } }),
  editedToday: (): NodeInit => ({ filter: { case: "editedInDays", value: 1 } }),
  studiedToday: (): NodeInit => ({ filter: { case: "rated", value: { days: 1, rating: SearchNode_Rating.ANY } } }),
  firstReview: (): NodeInit => ({ filter: { case: "introducedInDays", value: 1 } }),
  rescheduled: (): NodeInit => ({
    filter: { case: "rated", value: { days: 1, rating: SearchNode_Rating.BY_RESCHEDULE } },
  }),
  againToday: (): NodeInit => ({ filter: { case: "rated", value: { days: 1, rating: SearchNode_Rating.AGAIN } } }),
  overdue: (): NodeInit =>
    group([
      { filter: { case: "cardState", value: SearchNode_CardState.DUE } },
      negated({ filter: { case: "dueOnDay", value: 0 } }),
    ]),
  cardState: (state: SearchNode_CardState): NodeInit => ({ filter: { case: "cardState", value: state } }),
  /** 0 is no flag, 1 to 7 are the flags. */
  flag: (index: number): NodeInit => ({
    filter: { case: "flag", value: index === 0 ? SearchNode_Flag.NONE : ((SearchNode_Flag.RED + index - 1) as SearchNode_Flag) },
  }),
  deck: (fullName: string): NodeInit => ({ filter: { case: "deck", value: fullName } }),
  notetype: (name: string): NodeInit => ({ filter: { case: "note", value: name } }),
  tag: (fullName: string): NodeInit => ({ filter: { case: "tag", value: fullName } }),
};

/** Asks the core for the new search text; throws a CoreError for an invalid current search. */
export async function combineSearch(current: string, node: NodeInit, mods: Modifiers): Promise<string> {
  const { combine, negate } = combineFor(mods);
  const term = negate ? negated(node) : node;
  const existing = parsable(current.trim() || "deck:*");
  switch (combine) {
    case "set":
      return (await core.buildSearchString(term)).val;
    case "and":
      return (await core.joinSearchNodes({ joiner: SearchNode_Group_Joiner.AND, existingNode: existing, additionalNode: term })).val;
    case "or":
      return (await core.joinSearchNodes({ joiner: SearchNode_Group_Joiner.OR, existingNode: existing, additionalNode: term })).val;
    case "replace":
      return (await core.replaceSearchNode({ existingNode: existing, replacementNode: term })).val;
  }
}

/** A search matching the given ids (`cid:1,2,3` or `nid:1,2,3`). */
export function idSearch(kind: "cid" | "nid", ids: readonly bigint[]): string {
  return `${kind}:${ids.join(",")}`;
}

/** Strips Qt accelerators, HTML and trailing ellipses or colons from an Anki label. */
export function plainLabel(text: string): string {
  return cleanLabel(text.replace(/<[^>]+>/g, ""))
    .replace(/\s*[:：]\s*$/u, "")
    .trim();
}

/** Full names of every Deck or tag in a tree, joined with `::`. */
export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}::${name}` : name;
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * What the sidebar changes in the collection (`aqt/browser/sidebar/tree.py`):
 * renaming, deleting and moving Decks and tags, naming flags and keeping
 * saved searches. Each returns the words Anki shows afterwards.
 */
import { toast } from "sonner";

import * as core from "@/lib/anki/generated/core";
import type { TagTreeNode } from "@/lib/anki/proto/anki/tags_pb";
import { tr } from "@/lib/i18n";

import { readJson, writeJson } from "./config";

/** Anki's tree separator for Decks and tags. */
const SEP = "::";

/** What a person typed as a name: Anki drops double quotes. */
export function cleanName(text: string): string {
  return text.replaceAll('"', "").trim();
}

function parts(name: string): string[] {
  return name.toLowerCase().split(SEP);
}

/** The path above a full name, or "" for a top-level entry. */
export function parentOf(fullName: string): string {
  const at = fullName.lastIndexOf(SEP);
  return at < 0 ? "" : fullName.slice(0, at);
}

/** The last part of a full name. */
export function leafOf(fullName: string): string {
  const at = fullName.lastIndexOf(SEP);
  return at < 0 ? fullName : fullName.slice(at + SEP.length);
}

/**
 * Whether dragging `source` onto `target` ("" being the top level) changes
 * anything the core accepts: not onto itself, its own parent, or its own
 * descendants.
 */
export function canReparent(source: string, target: string): boolean {
  if (!source) return false;
  const from = parts(source);
  const to = target ? parts(target) : [];
  if (to.length >= from.length && from.every((p, i) => to[i] === p)) return false;
  return parentOf(source).toLowerCase() !== target.toLowerCase();
}

/** The name `source` gets when moved under `target` ("" being the top level): `<target>::<leaf>`. */
export function reparentedName(source: string, target: string): string {
  const leaf = leafOf(source);
  return target ? `${target}${SEP}${leaf}` : leaf;
}

export interface TagMoveTarget {
  /** Full name, or "" for the top level. */
  name: string;
  depth: number;
}

/** Every place the tag `source` may go, in tree order, narrowed by a case-insensitive text query. */
export function tagMoveTargets(root: TagTreeNode[], source: string, query = ""): TagMoveTarget[] {
  const needle = query.trim().toLowerCase();
  const out: TagMoveTarget[] = [];
  if (!needle && canReparent(source, "")) out.push({ name: "", depth: 0 });
  const walk = (nodes: TagTreeNode[], parent: string, depth: number) => {
    for (const node of nodes) {
      const name = parent ? `${parent}${SEP}${node.name}` : node.name;
      if (canReparent(source, name) && (!needle || name.toLowerCase().includes(needle))) out.push({ name, depth });
      walk(node.children, name, depth + 1);
    }
  };
  walk(root, "", 0);
  return out;
}

/** Runs a change, shows Anki's words with Undo, and reports a failure. */
export async function change(action: () => Promise<string | void>): Promise<void> {
  try {
    const message = await action();
    if (message) {
      toast(message, {
        action: {
          label: tr("undo-undo"),
          onClick: () =>
            void core
              .undo()
              .then((out) => toast(tr("undo-action-undone", { action: out.operation })))
              .catch(() => undefined),
        },
      });
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

/* ------------------------------ Decks ------------------------------ */

export async function renameDeck(deckId: bigint, newFullName: string): Promise<void> {
  await core.renameDeck({ deckId, newName: newFullName });
}

/** Deletes Decks; returns Anki's notice and how many Cards went. */
export async function removeDecks(deckIds: bigint[], deckName: string): Promise<string> {
  const out = await core.removeDecks({ dids: deckIds });
  return tr("browsing-cards-deleted-with-deckname", { count: out.count, deck_name: deckName });
}

/* ------------------------------ Tags ------------------------------ */

/** Renames a tag and its children; a tag without Notes cannot be renamed. */
export async function renameTag(currentName: string, newName: string): Promise<string> {
  const out = await core.renameTags({ currentPrefix: currentName, newPrefix: newName });
  if (out.count === 0) throw new Error(tr("browsing-tag-rename-warning-empty"));
  return tr("browsing-notes-updated", { count: out.count });
}

export async function removeTag(fullName: string): Promise<string> {
  const out = await core.removeTags({ val: fullName });
  return tr("browsing-notes-updated", { count: out.count });
}

export async function reparentTags(tags: string[], newParent: string): Promise<string> {
  const out = await core.reparentTags({ tags, newParent });
  return tr("browsing-notes-updated", { count: out.count });
}

export async function clearUnusedTags(): Promise<string> {
  const out = await core.clearUnusedTags();
  return tr("browsing-notes-updated", { count: out.count });
}

/* ------------------------------ Flags ------------------------------ */

/** Names a flag, or with an empty name goes back to its default, as Anki does. */
export async function setFlagName(flag: number, name: string): Promise<void> {
  const labels = await readJson<Record<string, string>>("flagLabels", {});
  const next = { ...(labels && typeof labels === "object" ? labels : {}) };
  const clean = cleanName(name);
  if (clean) next[String(flag)] = clean;
  else delete next[String(flag)];
  await writeJson("flagLabels", next);
}

/* ------------------------------ Saved searches ------------------------------ */

export interface SavedChange {
  saved: Record<string, string>;
  /** The name that would be overwritten, so the caller can ask first. */
  overwrites: string | null;
}

/** Renames a saved search; the entry under the new name is replaced. */
export function renameSaved(saved: Record<string, string>, from: string, to: string): SavedChange {
  const text = saved[from];
  if (text === undefined || from === to) return { saved, overwrites: null };
  const next = { ...saved };
  delete next[from];
  next[to] = text;
  return { saved: next, overwrites: saved[to] !== undefined ? to : null };
}

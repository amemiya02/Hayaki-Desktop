// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The browser's actions on the selection, as in `aqt/browser/browser.py`.
 * Toggles read the current row's Card (Anki's "current card") to decide which
 * way to go. Each action announces its result with Anki's own words.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import * as core from "@/lib/anki/generated/core";
import type { Card } from "@/lib/anki/proto/anki/cards_pb";
import { ConfigKey_String } from "@/lib/anki/proto/anki/config_pb";
import { BuryOrSuspendCardsRequest_Mode, ScheduleCardsAsNewRequest_Context } from "@/lib/anki/proto/anki/scheduler_pb";
import { SortOrderSchema } from "@/lib/anki/proto/anki/search_pb";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { tb } from "@/lib/strings/browse";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { Mode } from "./config";
import {
  ChangeDeckDialog,
  FindReplaceDialog,
  ForgetDialog,
  RepositionDialog,
  SetDueDialog,
  TagsDialog,
} from "./dialogs";
import type { ActionId } from "./keys";
import { PreviewDialog } from "./Preview";
import { idSearch } from "./search";

const QUEUE_SUSPENDED = -1;
const QUEUE_SIBLING_BURIED = -2;
const QUEUE_MANUALLY_BURIED = -3;
const MARKED = "marked";

export interface ActionContext {
  mode: Mode;
  /** Selected row ids in table order (Card ids or Note ids by mode). */
  selected: () => bigint[];
  current: bigint | null;
  /** Re-runs the search, keeping the selection where it can. */
  refresh: () => Promise<void>;
  /** After rows are deleted: re-search and select the row after them. */
  afterRemove: () => Promise<void>;
  run: (id: ActionId) => void;
}

export interface CurrentState {
  card: Card | null;
  noteId: bigint | null;
  marked: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cardIdsFor(mode: Mode, ids: bigint[]): Promise<bigint[]> {
  if (mode === "cards" || ids.length === 0) return ids;
  return (await core.searchCards({ search: idSearch("nid", ids) })).ids;
}

export async function noteIdsFor(mode: Mode, ids: bigint[]): Promise<bigint[]> {
  if (mode === "notes" || ids.length === 0) return ids;
  return (await core.searchNotes({ search: idSearch("cid", ids) })).ids;
}

async function loadCurrent(mode: Mode, id: bigint): Promise<CurrentState> {
  let cardId: bigint | undefined = id;
  if (mode === "notes") cardId = (await core.cardsOfNote({ nid: id })).cids[0];
  if (cardId === undefined) return { card: null, noteId: id, marked: false };
  const card = await core.getCard({ cid: cardId });
  const note = await core.getNote({ nid: card.noteId });
  return { card, noteId: card.noteId, marked: note.tags.some((t) => t.toLowerCase() === MARKED) };
}

/** The current row's Card and Note state, refreshed after every change. */
export function useCurrentState(mode: Mode, current: bigint | null) {
  return useQuery({
    queryKey: ["browse", "current", mode, current === null ? "" : String(current)],
    queryFn: () => loadCurrent(mode, current!),
    enabled: current !== null,
  });
}

export function isSuspended(card: Card | null | undefined): boolean {
  return card?.queue === QUEUE_SUSPENDED;
}

export function isBuried(card: Card | null | undefined): boolean {
  return card?.queue === QUEUE_SIBLING_BURIED || card?.queue === QUEUE_MANUALLY_BURIED;
}

/** Positions of the first and last new Card, for the reposition dialog. */
async function queueBounds(): Promise<{ top: number; bottom: number } | null> {
  const order: MessageInitShape<typeof SortOrderSchema> = { value: { case: "builtin", value: { column: "cardDue", reverse: false } } };
  const ids = (await core.searchCards({ search: "is:new -deck:filtered", order })).ids;
  if (ids.length === 0) return { top: 0, bottom: 0 };
  const [first, last] = await Promise.all([core.getCard({ cid: ids[0] }), core.getCard({ cid: ids[ids.length - 1] })]);
  return { top: Math.max(0, Math.min(first.due, last.due)), bottom: Math.max(first.due, last.due) };
}

type DialogState =
  | { kind: "deck"; cardIds: bigint[] }
  | { kind: "tags"; remove: boolean; noteIds: bigint[] }
  | { kind: "due"; cardIds: bigint[] }
  | { kind: "forget"; cardIds: bigint[] }
  | { kind: "reposition"; cardIds: bigint[]; queue: { top: number; bottom: number } | null }
  | { kind: "find"; noteIds: bigint[] }
  | { kind: "preview"; cardIds: bigint[]; start: number };

export function useBrowseActions(ctx: Omit<ActionContext, "run">, current: CurrentState | undefined) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const go = useNav((s) => s.go);
  const ref = useRef({ ctx, current });
  ref.current = { ctx, current };

  const close = () => setDialog(null);

  async function run(id: ActionId): Promise<void> {
    const { ctx, current } = ref.current;
    const { mode } = ctx;
    const rows = ctx.selected();
    const needsSelection: ActionId[] = [
      "changeDeck",
      "setDue",
      "forget",
      "reposition",
      "toggleSuspend",
      "toggleBury",
      "addTags",
      "removeTags",
      "toggleMark",
      "delete",
      "preview",
      "flag1",
      "flag2",
      "flag3",
      "flag4",
      "flag5",
      "flag6",
      "flag7",
    ];
    if (needsSelection.includes(id) && rows.length === 0) {
      toast(tr("browsing-no-selection"));
      return;
    }
    try {
      switch (id) {
        case "changeDeck":
          setDialog({ kind: "deck", cardIds: await cardIdsFor(mode, rows) });
          break;
        case "setDue":
          setDialog({ kind: "due", cardIds: await cardIdsFor(mode, rows) });
          break;
        case "forget":
          setDialog({ kind: "forget", cardIds: await cardIdsFor(mode, rows) });
          break;
        case "reposition": {
          const cardIds = await cardIdsFor(mode, rows);
          const fresh = (await core.searchCards({ search: `(${idSearch("cid", cardIds)}) is:new` })).ids;
          if (fresh.length === 0) {
            toast(tb("onlyNew"));
            break;
          }
          setDialog({ kind: "reposition", cardIds: fresh, queue: await queueBounds().catch(() => null) });
          break;
        }
        case "addTags":
        case "removeTags":
          setDialog({ kind: "tags", remove: id === "removeTags", noteIds: await noteIdsFor(mode, rows) });
          break;
        case "findReplace":
          setDialog({ kind: "find", noteIds: await noteIdsFor(mode, rows) });
          break;
        case "preview": {
          const cardIds = await cardIdsFor(mode, rows.length > 1 ? rows : ctx.current !== null ? [ctx.current] : rows);
          const start = current?.card ? Math.max(0, cardIds.indexOf(current.card.id)) : 0;
          setDialog({ kind: "preview", cardIds, start });
          break;
        }
        case "toggleSuspend": {
          const cardIds = await cardIdsFor(mode, rows);
          if (isSuspended(current?.card)) {
            await core.restoreBuriedAndSuspendedCards({ cids: cardIds });
          } else {
            await core.buryOrSuspendCards({ cardIds, noteIds: [], mode: BuryOrSuspendCardsRequest_Mode.SUSPEND });
          }
          toast(tr("browsing-cards-updated", { count: cardIds.length }));
          break;
        }
        case "toggleBury": {
          const cardIds = await cardIdsFor(mode, rows);
          if (isBuried(current?.card)) {
            await core.restoreBuriedAndSuspendedCards({ cids: cardIds });
            toast(tr("browsing-cards-updated", { count: cardIds.length }));
          } else {
            const out = await core.buryOrSuspendCards({ cardIds, noteIds: [], mode: BuryOrSuspendCardsRequest_Mode.BURY_USER });
            toast(tr("studying-cards-buried", { count: out.count }));
          }
          break;
        }
        case "toggleMark": {
          const noteIds = await noteIdsFor(mode, rows);
          const out = current?.marked
            ? await core.removeNoteTags({ noteIds, tags: MARKED })
            : await core.addNoteTags({ noteIds, tags: MARKED });
          toast(tr("browsing-notes-updated", { count: out.count }));
          break;
        }
        case "flag1":
        case "flag2":
        case "flag3":
        case "flag4":
        case "flag5":
        case "flag6":
        case "flag7": {
          let flag = Number(id.slice(4));
          // The current Card's flag toggles off, as in Anki.
          if (current?.card && (current.card.flags & 7) === flag) flag = 0;
          const cardIds = await cardIdsFor(mode, rows);
          const out = await core.setFlag({ cardIds, flag });
          toast(tr("browsing-cards-updated", { count: out.count }));
          break;
        }
        case "delete": {
          const out =
            mode === "cards"
              ? await core.removeNotes({ noteIds: [], cardIds: rows })
              : await core.removeNotes({ noteIds: rows, cardIds: [] });
          await ctx.afterRemove();
          toast(tr("browsing-cards-deleted", { count: out.count }), {
            action: { label: tr("undo-undo"), onClick: () => void undo() },
          });
          break;
        }
        case "undo":
          await undo();
          break;
        case "redo": {
          const out = await core.redo();
          await ctx.refresh();
          toast(tr("undo-action-redone", { action: out.operation }));
          break;
        }
        case "addNotes":
          go({ name: "add" });
          break;
        default:
          break;
      }
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function undo(): Promise<void> {
    try {
      const out = await core.undo();
      await ref.current.ctx.refresh();
      toast(tr("undo-action-undone", { action: out.operation }));
    } catch (error) {
      toast(errorText(error) || tr("actions-nothing-to-undo"));
    }
  }

  let element: ReactNode = null;
  if (dialog) {
    switch (dialog.kind) {
      case "deck":
        element = (
          <ChangeDeckDialog
            onClose={close}
            onSubmit={async (deckId) => {
              const out = await core.setDeck({ cardIds: dialog.cardIds, deckId });
              toast(tr("browsing-cards-updated", { count: out.count }));
            }}
          />
        );
        break;
      case "tags":
        element = (
          <TagsDialog
            remove={dialog.remove}
            onClose={close}
            onSubmit={async (tags) => {
              const out = dialog.remove
                ? await core.removeNoteTags({ noteIds: dialog.noteIds, tags })
                : await core.addNoteTags({ noteIds: dialog.noteIds, tags });
              toast(tr("browsing-notes-updated", { count: out.count }));
            }}
          />
        );
        break;
      case "due":
        element = (
          <SetDueDialog
            count={dialog.cardIds.length}
            onClose={close}
            onSubmit={async (days) => {
              await core.setDueDate({ cardIds: dialog.cardIds, days, configKey: { key: ConfigKey_String.SET_DUE_BROWSER } });
              toast(tr("scheduling-set-due-date-done", { cards: dialog.cardIds.length }));
            }}
          />
        );
        break;
      case "forget":
        element = (
          <ForgetDialog
            onClose={close}
            onSubmit={async (restorePosition, resetCounts) => {
              await core.scheduleCardsAsNew({
                cardIds: dialog.cardIds,
                log: true,
                restorePosition,
                resetCounts,
                context: ScheduleCardsAsNewRequest_Context.BROWSER,
              });
              toast(tr("scheduling-forgot-cards", { cards: dialog.cardIds.length }));
            }}
          />
        );
        break;
      case "reposition":
        element = (
          <RepositionDialog
            queue={dialog.queue}
            onClose={close}
            onSubmit={async (v) => {
              const out = await core.sortCards({
                cardIds: dialog.cardIds,
                startingFrom: v.start,
                stepSize: v.step,
                randomize: v.randomize,
                shiftExisting: v.shift,
              });
              toast(tr("browsing-changed-new-position", { count: out.count }));
            }}
          />
        );
        break;
      case "find":
        element = (
          <FindReplaceDialog
            noteIds={dialog.noteIds}
            onClose={close}
            onSubmit={async (v) => {
              const noteIds = v.selectedOnly ? dialog.noteIds : [];
              const out =
                v.field === ""
                  ? await core.findAndReplaceTag({ noteIds, search: v.find, replacement: v.replace, regex: v.regex, matchCase: v.matchCase })
                  : await core.findAndReplace({
                      nids: noteIds,
                      search: v.find,
                      replacement: v.replace,
                      regex: v.regex,
                      matchCase: v.matchCase,
                      fieldName: v.field ?? "",
                    });
              toast(
                noteIds.length > 0
                  ? tr("findreplace-notes-updated", { changed: out.count, total: noteIds.length })
                  : tr("browsing-notes-updated", { count: out.count }),
              );
            }}
          />
        );
        break;
      case "preview":
        element = <PreviewDialog cardIds={dialog.cardIds} startIndex={dialog.start} onClose={close} />;
        break;
    }
  }

  // Stable across renders: `run` reads the latest context from `ref`.
  const runRef = useRef(run);
  runRef.current = run;
  const stableRun = useCallback((id: ActionId) => void runRef.current(id), []);
  return { run: stableRun, dialogs: element, dialogOpen: dialog !== null };
}

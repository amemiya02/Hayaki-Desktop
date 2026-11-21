// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Undo and Redo for the whole collection, with the action's name as Anki's Edit menu shows it. */
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import * as core from "@/lib/anki/generated/core";
import type { UndoStatus } from "@/lib/anki/proto/anki/collection_pb";
import { tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/study/session";

/** "Undo Answer Card", or "Undo" when there is nothing to name. */
export function undoLabel(status: UndoStatus | undefined): string {
  return status?.undo ? tr("undo-undo-action", { val: status.undo }) : tr("undo-undo");
}

/** "Redo Answer Card", or "Redo". */
export function redoLabel(status: UndoStatus | undefined): string {
  return status?.redo ? tr("undo-redo-action", { action: status.redo }) : tr("undo-redo");
}

/** The current undo and redo names, read afresh each time `enabled` turns on. */
export function useUndoStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["undoStatus"],
    queryFn: () => core.getUndoStatus(),
    enabled,
    gcTime: 0,
    staleTime: 0,
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runUndo(): Promise<void> {
  try {
    const out = await core.undo();
    // The review queue was built before the step came back.
    if (useNav.getState().route.name === "study") await useSession.getState().reload();
    toast(tr("undo-action-undone", { action: out.operation }));
  } catch {
    toast(tr("actions-nothing-to-undo"));
  }
}

export async function runRedo(): Promise<void> {
  try {
    const out = await core.redo();
    // The review queue was built before the step came back.
    if (useNav.getState().route.name === "study") await useSession.getState().reload();
    toast(tr("undo-action-redone", { action: out.operation }));
  } catch (error) {
    toast(message(error) || tr("actions-nothing-to-undo"));
  }
}

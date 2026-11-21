// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Carries out what the AnkiConnect server asks of the interface: refresh
 * after its edits, open Browse or a filled-in Add, sync, and ask the person
 * before a new origin may connect.
 */
import { create } from "@bufbuild/protobuf";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

import { confirm } from "@/components/confirm";
import { events, queryKey, replyToPermission, type AnkiConnectSnapshot } from "@/lib/ankiconnect";
import { announceChanges } from "@/lib/anki/transport";
import { OpChangesSchema } from "@/lib/anki/proto/anki/collection_pb";
import { useNav } from "@/lib/nav";
import { queryClient } from "@/lib/queries";
import { tac } from "@/lib/strings/ankiconnect";
import { setAddPrefill } from "@/screens/add/prefill";

/** guiAddCards' Note; ids come as strings so they keep every digit. */
interface AddCardsPayload {
  notetypeId: string;
  deckId: string;
  fields: string[];
  tags: string[];
}

function bringToFront(): void {
  const window = getCurrentWindow();
  void window.show().then(() => window.setFocus());
}

export function AnkiConnectHost({ onSync }: { onSync: () => void }) {
  const sync = useRef(onSync);
  sync.current = onSync;

  useEffect(() => {
    // Open permission prompts by id, so the server can close one that timed out.
    const prompts = new Map<number, AbortController>();
    const pending: Promise<UnlistenFn>[] = [
      listen<AnkiConnectSnapshot>(events.status, (e) => queryClient.setQueryData(queryKey, e.payload)),
      listen<Record<string, boolean>>(events.changed, (e) => announceChanges(create(OpChangesSchema, e.payload), "ankiconnect")),
      listen<{ query: string }>(events.browse, (e) => {
        useNav.getState().go({ name: "browse", search: e.payload.query });
        bringToFront();
      }),
      listen<AddCardsPayload>(events.addCards, (e) => {
        const { notetypeId, deckId, fields, tags } = e.payload;
        setAddPrefill({ notetypeId: BigInt(notetypeId), deckId: BigInt(deckId), fields, tags });
        useNav.getState().go({ name: "add" });
        bringToFront();
      }),
      listen(events.sync, () => sync.current()),
      listen<{ id: number; origin: string }>(events.permission, async (e) => {
        const closed = new AbortController();
        prompts.set(e.payload.id, closed);
        bringToFront();
        const allow = await confirm({
          title: tac("permissionTitle"),
          message: tac("permissionMessage", { origin: e.payload.origin }),
          confirm: tac("allow"),
          signal: closed.signal,
        });
        prompts.delete(e.payload.id);
        if (!closed.signal.aborted) await replyToPermission(e.payload.id, allow);
      }),
      listen<{ id: number }>(events.permissionClosed, (e) => prompts.get(e.payload.id)?.abort()),
    ];
    return () => {
      for (const unlisten of pending) void unlisten.then((stop) => stop());
    };
  }, []);

  return null;
}

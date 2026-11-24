// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * What can be done to a Deck, wherever it is listed: the Decks screen's rows
 * and the sidebar's tree, from their ⋯ menu or a right click. The dialogs
 * these open are shown once, by `DeckDialogsHost`.
 */
import { FileText, FolderInput, Pencil, Play, Settings2, Trash2, Upload } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button, Dialog, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr, trLabel } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { useDeckTree } from "@/lib/queries";
import { td } from "@/lib/strings/decks";
import { DeckDescriptionDialog } from "@/screens/decks/DeckDescriptionDialog";
import { MoveDeckDialog } from "@/screens/decks/MoveDeckDialog";
import { useExport } from "@/shell/ExportDialog";

interface DeckDialogs {
  renaming: DeckTreeNode | null;
  moving: DeckTreeNode | null;
  describing: bigint | null;
  rename(node: DeckTreeNode | null): void;
  move(node: DeckTreeNode | null): void;
  describe(deckId: bigint | null): void;
}

export const useDeckDialogs = create<DeckDialogs>((set) => ({
  renaming: null,
  moving: null,
  describing: null,
  rename: (renaming) => set({ renaming }),
  move: (moving) => set({ moving }),
  describe: (describing) => set({ describing }),
}));

/** Deletes the Deck, its subdecks and their cards, with Undo in the notice, as Anki does. */
export async function removeDeck(node: DeckTreeNode, origin: string): Promise<void> {
  try {
    const result = await core.removeDecks({ dids: [node.deckId] }, { origin });
    toast(tr("browsing-cards-deleted", { count: result.count }), {
      action: { label: tr("undo-undo"), onClick: () => void core.undo() },
    });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

type ItemProps = { children: ReactNode; shortcut?: string; onSelect?: () => void; danger?: boolean; disabled?: boolean };

/**
 * The Deck's menu, drawn with the item and separator of whichever menu holds
 * it (a dropdown or a right-click menu).
 */
export function DeckMenuItems({
  node,
  origin,
  Item,
  Separator,
  study,
}: {
  node: DeckTreeNode;
  origin: string;
  Item: ComponentType<ItemProps>;
  Separator: ComponentType;
  /** Offer Study first, for lists without their own Study button. */
  study?: boolean;
}) {
  const go = useNav((s) => s.go);
  const dialogs = useDeckDialogs();
  const due = node.newCount + node.learnCount + node.reviewCount;
  return (
    <>
      {study && (
        <>
          <Item disabled={due === 0} onSelect={() => go({ name: "study", deckId: node.deckId })}>
            <Play />
            {tr("decks-study")}
          </Item>
          <Separator />
        </>
      )}
      <Item onSelect={() => go({ name: "deck-options", deckId: node.deckId })}>
        <Settings2 />
        {tr("actions-options")}
      </Item>
      <Item onSelect={() => useExport.getState().show(node.deckId)}>
        <Upload />
        {trLabel("qt-accel-export")}
      </Item>
      <Item onSelect={() => dialogs.rename(node)}>
        <Pencil />
        {tr("actions-rename")}
      </Item>
      <Item shortcut="M" onSelect={() => dialogs.move(node)}>
        <FolderInput />
        {td("moveTo")}
      </Item>
      {!node.filtered && (
        <Item onSelect={() => dialogs.describe(node.deckId)}>
          <FileText />
          {tr("scheduling-description")}
        </Item>
      )}
      <Separator />
      <Item danger shortcut="Del" onSelect={() => void removeDeck(node, origin)}>
        <Trash2 />
        {tr("actions-delete")}
      </Item>
    </>
  );
}

export function NameDialog({
  open,
  title,
  initial,
  confirm,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  confirm: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!value.trim() || busy} onClick={submit}>
            {confirm}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        onFocus={(e) => e.target.select()}
        aria-label={tr("decks-new-deck-name")}
      />
      <p className="mt-2 text-caption text-ink-3">{t("decks.nameHint")}</p>
    </Dialog>
  );
}

/** The rename, move and description dialogs the Deck menus open. Mounted once. */
export function DeckDialogsHost() {
  const { renaming, moving, describing, rename, move, describe } = useDeckDialogs();
  const { data: tree } = useDeckTree();
  return (
    <>
      <MoveDeckDialog key={moving ? String(moving.deckId) : "none"} deck={moving} root={tree} onClose={() => move(null)} />
      <DeckDescriptionDialog deckId={describing} onClose={() => describe(null)} />
      <NameDialog
        key={renaming ? String(renaming.deckId) : "none"}
        open={!!renaming}
        title={tr("actions-rename-deck")}
        initial={renaming?.name ?? ""}
        confirm={tr("actions-rename")}
        onClose={() => rename(null)}
        onSubmit={(name) => core.renameDeck({ deckId: renaming!.deckId, newName: name }, { origin: "decks" }).then(() => undefined)}
      />
    </>
  );
}

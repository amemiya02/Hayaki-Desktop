// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ChevronRight, Download, Filter, FolderPlus, MoreHorizontal, Pencil, Play, Settings2, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Count } from "@/components/Count";
import { LifecycleBar } from "@/components/LifecycleBar";
import { Button, cn, Dialog, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr, trLabel } from "@/lib/i18n";
import { importPackage } from "@/lib/import";
import { useNav } from "@/lib/nav";
import { findDeck, leafName, totals, useCurrentDeck, useDeckTree, useStudiedToday } from "@/lib/queries";
import { openFilteredDeck } from "@/screens/filtered";
import { useExport } from "@/shell/ExportDialog";
import { Expand } from "@/shell/Sidebar";

const COLS = "grid grid-cols-[minmax(0,1fr)_72px_72px_72px_76px] items-center";

function DeckRow({
  node,
  depth,
  currentId,
  onRename,
  onDelete,
}: {
  node: DeckTreeNode;
  depth: number;
  currentId: bigint | undefined;
  onRename: (node: DeckTreeNode) => void;
  onDelete: (node: DeckTreeNode) => void;
}) {
  const go = useNav((s) => s.go);
  const hasChildren = node.children.length > 0;
  const due = node.newCount + node.learnCount + node.reviewCount;
  const isCurrent = currentId === node.deckId;

  const toggle = () =>
    void core.setDeckCollapsed(
      { deckId: node.deckId, collapsed: !node.collapsed, scope: SetDeckCollapsedRequest_Scope.REVIEWER },
      { origin: "decks" },
    );

  return (
    <>
      <div
        role="row"
        tabIndex={0}
        onDoubleClick={() => go({ name: "study", deckId: node.deckId })}
        onKeyDown={(e) => {
          if (e.key === "Enter") go({ name: "study", deckId: node.deckId });
          if (e.key === "ArrowRight" && hasChildren && node.collapsed) toggle();
          if (e.key === "ArrowLeft" && hasChildren && !node.collapsed) toggle();
        }}
        className={cn(
          COLS,
          "group relative px-3 outline-none transition-colors duration-[var(--dur-fast)]",
          depth === 0 ? "h-11" : "h-10",
          "hover:bg-surface-2 focus-visible:bg-accent-softer focus-visible:outline-none",
        )}
      >
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 22 }}>
          {hasChildren ? (
            <button
              aria-label={node.collapsed ? "Expand" : "Collapse"}
              aria-expanded={!node.collapsed}
              onClick={toggle}
              className="grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-3 hover:bg-surface-3 hover:text-ink"
            >
              <ChevronRight
                className={cn("size-4 transition-transform duration-[var(--dur)] ease-out", !node.collapsed && "rotate-90")}
              />
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <button
            onClick={() => go({ name: "deck", deckId: node.deckId })}
            className={cn(
              "min-w-0 truncate rounded-[5px] px-1 text-left text-body hover:underline hover:underline-offset-4 hover:decoration-line-strong",
              depth === 0 ? "font-medium text-ink" : "text-ink",
              node.filtered && "text-accent-ink",
            )}
            title={node.name}
          >
            {leafName(node.name)}
          </button>
          {isCurrent && <span aria-label="Current Deck" className="ml-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
        </div>
        <Count value={node.newCount} kind="new" />
        <Count value={node.learnCount} kind="learn" />
        <Count value={node.reviewCount} kind="due" />
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton label={tr("decks-study")} size="sm" disabled={due === 0} onClick={() => go({ name: "study", deckId: node.deckId })}>
            <Play />
          </IconButton>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={t("study.more")} size="sm">
                <MoreHorizontal />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => go({ name: "deck-options", deckId: node.deckId })}>
                <Settings2 />
                {tr("actions-options")}
              </MenuItem>
              <MenuItem onSelect={() => useExport.getState().show(node.deckId)}>
                <Upload />
                {trLabel("qt-accel-export")}
              </MenuItem>
              <MenuItem onSelect={() => onRename(node)}>
                <Pencil />
                {tr("actions-rename")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => onDelete(node)}>
                <Trash2 />
                {tr("actions-delete")}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      {hasChildren && (
        <Expand open={!node.collapsed} className="divide-y divide-line-soft">
          {node.children.map((child) => (
            <DeckRow
              key={String(child.deckId)}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </Expand>
      )}
    </>
  );
}

function NameDialog({
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
      <p className="mt-2 text-caption text-ink-3">
        {t("decks.nameHint")}
      </p>
    </Dialog>
  );
}

export function DecksScreen() {
  const { data: tree, isPending } = useDeckTree();
  const { data: studied } = useStudiedToday();
  const { data: current } = useCurrentDeck();
  const go = useNav((s) => s.go);
  const [renaming, setRenaming] = useState<DeckTreeNode | null>(null);
  const [creating, setCreating] = useState(false);

  // F creates a filtered Deck, as in Anki's main window.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key !== "f" || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      openFilteredDeck();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const sum = totals(tree);
  // Study the current Deck when it has work; otherwise the first Deck that does.
  const currentNode = current ? findDeck(tree, current.id) : undefined;
  const hasWork = (n?: DeckTreeNode) => !!n && n.newCount + n.learnCount + n.reviewCount > 0;
  const studyTarget = hasWork(currentNode) ? currentNode : (tree?.children ?? []).find(hasWork);
  const decks = tree?.children ?? [];
  const isEmpty =
    !isPending && decks.reduce((n, d) => n + d.totalIncludingChildren, 0) === 0 && decks.length <= 1;

  const remove = async (node: DeckTreeNode) => {
    const result = await core.removeDecks({ dids: [node.deckId] }, { origin: "decks" });
    toast(tr("browsing-cards-deleted", { count: result.count }), {
      action: { label: tr("undo-undo"), onClick: () => void core.undo() },
    });
  };

  const createDeck = async (name: string) => {
    const deck = await core.newDeck();
    deck.name = name;
    await core.addDeck(deck, { origin: "decks" });
  };

  if (isEmpty) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="flex max-w-[420px] flex-col items-center text-center animate-rise-in">
          <img src="/hayaki-mark.svg" alt="" className="mb-5 size-16" />
          <h2 className="text-heading font-semibold text-ink">{t("decks.empty.title")}</h2>
          <p className="mt-2 text-body leading-relaxed text-ink-2 text-balance">{t("decks.empty.lead")}</p>
          <div className="mt-6 flex gap-2">
            <Button variant="primary" size="lg" onClick={() => void importPackage()}>
              <Download />
              {t("decks.import")}
            </Button>
            <Button size="lg" onClick={() => setCreating(true)}>
              <FolderPlus />
              {t("decks.create")}
            </Button>
          </div>
        </div>
        <NameDialog
          open={creating}
          title={t("decks.create")}
          initial=""
          confirm={t("decks.create")}
          onClose={() => setCreating(false)}
          onSubmit={createDeck}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-8 pb-12 pt-7">
        <section aria-labelledby="today" className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-[280px] flex-1">
            <h2 id="today" className="text-headline font-semibold text-ink">
              {sum.total > 0 ? t("decks.dueToday", { count: sum.total }) : t("decks.nothingDue")}
            </h2>
            <p className="mt-1 text-control text-ink-2">{studied}</p>
            {sum.total > 0 && (
              <LifecycleBar className="mt-4 max-w-[520px]" newCount={sum.newCount} learnCount={sum.learnCount} reviewCount={sum.reviewCount} />
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <IconButton label={`${trLabel("qt-misc-create-filtered-deck")} (F)`} variant="secondary" onClick={() => openFilteredDeck()}>
              <Filter />
            </IconButton>
            <Button onClick={() => setCreating(true)}>
              <FolderPlus />
              {t("decks.create")}
            </Button>
            {studyTarget && (
              <Button
                variant="primary"
                onClick={() => go({ name: "study", deckId: studyTarget.deckId })}
                title={`${t("decks.study", { deck: studyTarget.name })} (S)`}
              >
                <Play />
                <span className="max-w-[240px] truncate">{t("decks.study", { deck: leafName(studyTarget.name) })}</span>
              </Button>
            )}
          </div>
        </section>

        <section role="table" aria-label={t("nav.decks")} className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div role="row" className={cn(COLS, "h-9 border-b border-line bg-surface-2 px-3 text-caption font-medium text-ink-3")}>
            <span className="pl-7">{tr("decks-deck")}</span>
            <span className="text-center">{tr("actions-new")}</span>
            <span className="text-center">{tr("scheduling-learning")}</span>
            <span className="text-center">{tr("statistics-due-count")}</span>
            <span />
          </div>
          <div className="divide-y divide-line-soft">
            {decks.map((node) => (
              <DeckRow
                key={String(node.deckId)}
                node={node}
                depth={0}
                currentId={current?.id}
                onRename={setRenaming}
                onDelete={(n) => void remove(n)}
              />
            ))}
          </div>
        </section>
      </div>

      <NameDialog
        key={renaming ? String(renaming.deckId) : "none"}
        open={!!renaming}
        title={tr("actions-rename-deck")}
        initial={renaming?.name ?? ""}
        confirm={tr("actions-rename")}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => core.renameDeck({ deckId: renaming!.deckId, newName: name }, { origin: "decks" }).then(() => undefined)}
      />
      <NameDialog
        open={creating}
        title={t("decks.create")}
        initial=""
        confirm={t("decks.create")}
        onClose={() => setCreating(false)}
        onSubmit={createDeck}
      />
    </div>
  );
}

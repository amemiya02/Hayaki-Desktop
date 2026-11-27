// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { ChevronRight, Download, Filter, FolderPlus, MoreHorizontal, Play } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Count } from "@/components/Count";
import { LifecycleBar } from "@/components/LifecycleBar";
import { Button, cn, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr, trLabel } from "@/lib/i18n";
import { importPackage } from "@/lib/import";
import { useNav } from "@/lib/nav";
import { findDeck, getDeckTree, leafName, totals, useCurrentDeck, useDeckTree, useStudiedToday } from "@/lib/queries";
import { td } from "@/lib/strings/decks";
import { CtxContent, CtxItem, CtxRoot, CtxSeparator, CtxTrigger } from "@/screens/browse/menus";
import { DeckMenuItems, NameDialog, removeDeck, useDeckDialogs } from "@/screens/decks/actions";
import { deckDragHandlers, useDeckDrag, useDropTarget } from "@/screens/decks/drag";
import { TOP_LEVEL } from "@/screens/decks/model";
import { openFilteredDeck } from "@/screens/filtered";
import { Expand } from "@/shell/Sidebar";

const COLS = "grid grid-cols-[minmax(0,1fr)_72px_72px_72px_76px] items-center";

function DeckRow({ node, depth, currentId }: { node: DeckTreeNode; depth: number; currentId: bigint | undefined }) {
  const drop = useDropTarget(node.deckId);
  const go = useNav((s) => s.go);
  const hasChildren = node.children.length > 0;
  const due = node.newCount + node.learnCount + node.reviewCount;
  const isCurrent = currentId === node.deckId;

  const toggle = () =>
    void core.setDeckCollapsed(
      { deckId: node.deckId, collapsed: !node.collapsed, scope: SetDeckCollapsedRequest_Scope.REVIEWER },
      { origin: "decks" },
    );

  const onMove = useDeckDialogs((s) => s.move);

  return (
    <>
      <CtxRoot>
        <CtxTrigger asChild>
          <div
            role="row"
            tabIndex={0}
            data-deck-drop={String(node.deckId)}
            {...deckDragHandlers(node, getDeckTree)}
            onDoubleClick={() => go({ name: "study", deckId: node.deckId })}
            onKeyDown={(e) => {
              if (e.key === "Enter") go({ name: "study", deckId: node.deckId });
              if (e.key === "ArrowRight" && hasChildren && node.collapsed) toggle();
              if (e.key === "ArrowLeft" && hasChildren && !node.collapsed) toggle();
              if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey && !e.altKey && e.target === e.currentTarget) onMove(node);
              if (e.key === "Delete" && e.target === e.currentTarget) void removeDeck(node, "decks");
            }}
            className={cn(
              COLS,
              "group relative px-3 outline-none transition-colors duration-[var(--dur-fast)]",
              depth === 0 ? "h-11" : "h-10",
              "hover:bg-surface-2 focus-visible:bg-accent-softer focus-visible:outline-none",
              drop.isSource && "opacity-45",
              drop.dragging && !drop.over && "hover:bg-transparent",
              drop.valid && "bg-accent-soft shadow-ring-inset hover:bg-accent-soft",
              drop.over && !drop.valid && "cursor-not-allowed",
            )}
          >
            <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 22 }}>
              {hasChildren ? (
                <button
                  data-no-drag
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
            <div data-no-drag className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 group-focus-within:opacity-100">
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
                  <DeckMenuItems node={node} origin="decks" Item={MenuItem} Separator={MenuSeparator} />
                </MenuContent>
              </Menu>
            </div>
          </div>
        </CtxTrigger>
        <CtxContent>
          <DeckMenuItems node={node} origin="decks" Item={CtxItem} Separator={CtxSeparator} study />
        </CtxContent>
      </CtxRoot>
      {hasChildren && (
        <Expand open={!node.collapsed} className="divide-y divide-line-soft">
          {node.children.map((child) => (
            <DeckRow
              key={String(child.deckId)}
              node={child}
              depth={depth + 1}
              currentId={currentId}
            />
          ))}
        </Expand>
      )}
    </>
  );
}

/** The column header doubles as the drop target for "make this a top-level Deck". */
function TopLevelRow({ className, children }: { className: string; children: ReactNode }) {
  const drop = useDropTarget(TOP_LEVEL);
  return (
    <div role="row" data-deck-drop="0" className={cn(className, drop.valid && "bg-accent-soft text-accent-ink shadow-ring-inset")}>
      {children}
    </div>
  );
}

/** A strip at the end of the list, shown only while a Deck below the top level is being dragged. */
function TopLevelDropZone() {
  const dragging = useDeckDrag((s) => s.source !== null);
  const drop = useDropTarget(TOP_LEVEL);
  if (!dragging) return null;
  return (
    <div
      data-deck-drop="0"
      className={cn(
        "grid h-12 place-items-center border-t border-dashed border-line-strong text-control text-ink-3",
        drop.valid && "bg-accent-soft text-accent-ink shadow-ring-inset",
      )}
    >
      {td("dropTop")}
    </div>
  );
}

export function DecksScreen() {
  const { data: tree, isPending, error, refetch } = useDeckTree();
  const { data: studied } = useStudiedToday();
  const { data: current } = useCurrentDeck();
  const go = useNav((s) => s.go);
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
  const isEmpty = decks.reduce((n, d) => n + d.totalIncludingChildren, 0) === 0 && decks.length <= 1;

  const createDeck = async (name: string) => {
    const deck = await core.newDeck();
    deck.name = name;
    await core.addDeck(deck, { origin: "decks" });
  };

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 p-8">
        {error.message}
        <Button onClick={() => void refetch()}>{t("common.retry")}</Button>
      </div>
    );
  }
  if (isPending) return <p role="status" className="p-8">{t("common.loading")}</p>;

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
    <div data-drag-scroll className="h-full overflow-y-auto">
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
          <TopLevelRow className={cn(COLS, "h-9 border-b border-line bg-surface-2 px-3 text-caption font-medium text-ink-3")}>
            <span className="pl-7">{tr("decks-deck")}</span>
            <span className="text-center">{tr("actions-new")}</span>
            <span className="text-center">{tr("scheduling-learning")}</span>
            <span className="text-center">{tr("statistics-due-count")}</span>
            <span />
          </TopLevelRow>
          <div className="divide-y divide-line-soft">
            {decks.map((node) => (
              <DeckRow
                key={String(node.deckId)}
                node={node}
                depth={0}
                currentId={current?.id}
              />
            ))}
          </div>
          <TopLevelDropZone />
        </section>
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

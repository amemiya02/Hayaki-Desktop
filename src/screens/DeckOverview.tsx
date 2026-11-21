// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eraser, GraduationCap, Pencil, Play, RefreshCw, Search, Settings2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { LifecycleBar } from "@/components/LifecycleBar";
import { Button, Kbd, onAccentKbd, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { findDeck, useDeckTree } from "@/lib/queries";
import { DeckDescription } from "@/screens/decks/DeckDescription";
import { DeckDescriptionDialog } from "@/screens/decks/DeckDescriptionDialog";
import { hasBuried, useUnbury } from "@/screens/decks/unbury";
import { emptyFilteredDeck, openCustomStudy, openFilteredDeck, rebuildFilteredDeck } from "@/screens/filtered";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One Deck before studying it: what is due, its description, and where to go next (Anki's overview). */
export function DeckOverview({ deckId }: { deckId: bigint }) {
  const go = useNav((s) => s.go);
  const { data: tree } = useDeckTree();
  const node = findDeck(tree, deckId);
  const { data: deck } = useQuery({ queryKey: ["deck", String(deckId)], queryFn: () => core.getDeck({ did: deckId }) });
  const [busy, setBusy] = useState<"rebuild" | "empty" | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);

  // The core's buried-Card check looks at the current Deck, so make this one current first, as Anki does.
  const [isCurrent, setIsCurrent] = useState(false);
  useEffect(() => {
    let live = true;
    setIsCurrent(false);
    void core.setCurrentDeck({ did: deckId }).then(() => live && setIsCurrent(true), () => {});
    return () => {
      live = false;
    };
  }, [deckId]);
  const { data: congrats } = useQuery({
    queryKey: ["congrats", "overview", String(deckId)],
    queryFn: () => core.congratsInfo(),
    enabled: isCurrent,
  });
  const buried = hasBuried(congrats);
  const unbury = useUnbury(deckId, congrats);

  const due = node ? node.newCount + node.learnCount + node.reviewCount : 0;
  const filtered = !!node?.filtered;

  const rebuild = useCallback(async () => {
    setBusy("rebuild");
    try {
      await rebuildFilteredDeck(deckId);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  }, [deckId]);

  const empty = useCallback(async () => {
    setBusy("empty");
    try {
      await emptyFilteredDeck(deckId);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  }, [deckId]);

  const options = useCallback(() => {
    if (filtered) openFilteredDeck({ deckId });
    else go({ name: "deck-options", deckId });
  }, [filtered, deckId, go]);

  // Anki's overview keys: S study, O options, C custom study, R rebuild, E empty, B browse.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[role=dialog], [role=menu]")) return;
      let handled = true;
      switch (e.key) {
        case "s":
          if (due > 0) go({ name: "study", deckId });
          break;
        case "b":
          go({ name: "browse", search: `deck:"${node?.name ?? ""}"` });
          break;
        case "o":
          options();
          break;
        case "c":
          if (!filtered) openCustomStudy(deckId);
          break;
        case "r":
          if (filtered) void rebuild();
          break;
        case "e":
          if (filtered) void empty();
          break;
        case "u":
          if (buried) unbury.request();
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [due, deckId, go, node?.name, filtered, options, rebuild, empty, buried, unbury]);

  if (!node) return null;
  const parts = node.name.split("::");
  const normal = deck?.kind.case === "normal" ? deck.kind.value : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pb-12 pt-10">
        {parts.length > 1 && <p className="mb-1 text-control text-ink-3">{parts.slice(0, -1).join(" › ")}</p>}
        <h1 className="text-display font-semibold text-ink text-balance">{parts[parts.length - 1]}</h1>
        {filtered ? (
          <p className="mt-3 max-w-[62ch] text-body leading-relaxed text-ink-2">
            {[
              tr("studying-this-is-a-special-deck-for"),
              tr("studying-cards-will-be-automatically-returned-to"),
              tr("studying-deleting-this-deck-from-the-deck"),
            ].join(" ")}
          </p>
        ) : (
          normal && <DeckDescription className="mt-3" text={normal.description} markdown={normal.markdownDescription} />
        )}

        <div className="mt-8 rounded-[12px] border border-line bg-surface p-5">
          {due > 0 ? (
            <>
              <h2 className="text-title font-semibold text-ink">{t("decks.dueToday", { count: due })}</h2>
              <LifecycleBar className="mt-4 max-w-[520px]" newCount={node.newCount} learnCount={node.learnCount} reviewCount={node.reviewCount} />
            </>
          ) : (
            <>
              <h2 className="text-title font-semibold text-ink">{t("decks.nothingDue")}</h2>
              <p className="tabular mt-1 text-control text-ink-2">
                {tr("browsing-cards", { count: node.totalIncludingChildren }).trim() || `${node.totalIncludingChildren}`}
              </p>
            </>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" disabled={due === 0} onClick={() => go({ name: "study", deckId })}>
              <Play />
              {tr("studying-study-now")}
              <Kbd className={onAccentKbd}>S</Kbd>
            </Button>
            {filtered ? (
              <>
                <Button size="lg" disabled={busy !== null} onClick={() => void rebuild()} title={`${tr("actions-rebuild")} (R)`}>
                  {busy === "rebuild" ? <Spinner /> : <RefreshCw />}
                  {tr("actions-rebuild")}
                </Button>
                <Button size="lg" disabled={busy !== null} onClick={() => void empty()} title={`${tr("studying-empty")} (E)`}>
                  {busy === "empty" ? <Spinner /> : <Eraser />}
                  {tr("studying-empty")}
                </Button>
              </>
            ) : (
              <Button size="lg" onClick={() => openCustomStudy(deckId)} title={`${tr("actions-custom-study")} (C)`}>
                <GraduationCap />
                {tr("actions-custom-study")}
              </Button>
            )}
            {buried && (
              <Button size="lg" onClick={unbury.request} title={`${tr("studying-unbury")} (U)`}>
                <Undo2 />
                {tr("studying-unbury")}
              </Button>
            )}
            <Button size="lg" onClick={options} title={`${tr("actions-options")} (O)`}>
              <Settings2 />
              {filtered ? tr("actions-options") : tr("deck-config-title")}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-1 border-t border-line-soft pt-3">
            <Button variant="ghost" size="sm" onClick={() => go({ name: "browse", search: `deck:"${node.name}"` })} title={`${t("nav.browse")} (B)`}>
              <Search />
              {t("nav.browse")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => go({ name: "stats", deckId })}>
              <BarChart3 />
              {t("nav.stats")}
            </Button>
            {!filtered && (
              <Button variant="ghost" size="sm" onClick={() => setEditingDescription(true)}>
                <Pencil />
                {tr("scheduling-description")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <DeckDescriptionDialog deckId={editingDescription ? deckId : null} onClose={() => setEditingDescription(false)} />
      {unbury.dialog}
    </div>
  );
}

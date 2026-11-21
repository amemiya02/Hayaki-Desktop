// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Study Deck (`/`): type to filter every Deck, Enter opens its overview.
 * Add makes a new Deck from the filter or the selected name and opens that.
 * Upstream: `aqt/studydeck.py`, `main.py` `onStudyDeck`.
 */
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button, cn, Dialog, Kbd, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { t, tr, trLabel } from "@/lib/i18n";
import { displayChord } from "./shortcuts";
import { useNav } from "@/lib/nav";
import { ts } from "@/lib/strings/shell";

import { initialRow, matchesDeck, moveRow, newDeckDefault, rowForDigit } from "./study-deck";

const useStudyDeck = create<{ open: boolean }>(() => ({ open: false }));

export function openStudyDeck(): void {
  useStudyDeck.setState({ open: true });
}

interface Entry {
  id: bigint;
  name: string;
}

export function StudyDeckHost() {
  const open = useStudyDeck((s) => s.open);
  return open ? <StudyDeckDialog onClose={() => useStudyDeck.setState({ open: false })} /> : null;
}

function StudyDeckDialog({ onClose }: { onClose: () => void }) {
  const go = useNav((s) => s.go);
  const [filter, setFilter] = useState("");
  const [row, setRow] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  // Filtered Decks are included, and an empty Default Deck is not, as upstream.
  const decks = useQuery({
    queryKey: ["studyDeckNames"],
    queryFn: async (): Promise<{ entries: Entry[]; current: string | null }> => {
      const [names, current] = await Promise.all([core.getDeckNames({ skipEmptyDefault: true, includeFiltered: true }), core.getCurrentDeck()]);
      return { entries: names.entries.map((e) => ({ id: e.id, name: e.name })), current: current.name };
    },
    gcTime: 0,
  });

  const entries = decks.data?.entries;
  const shown = useMemo(() => (entries ?? []).filter((e) => matchesDeck(e.name, filter)), [entries, filter]);
  const names = useMemo(() => shown.map((e) => e.name), [shown]);

  // The current Deck is selected on opening; typing selects the first match.
  const focus = filter === "" ? (decks.data?.current ?? null) : null;
  useEffect(() => setRow(initialRow(names, focus)), [names, focus]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [row, names]);

  const study = async (entry: Entry | undefined) => {
    if (!entry) {
      toast(tr("decks-please-select-something"));
      return;
    }
    setBusy(true);
    try {
      await core.setCurrentDeck({ did: entry.id });
      onClose();
      go({ name: "deck", deckId: entry.id });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async () => {
    const name = adding?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const deck = await core.newDeck();
      deck.name = name;
      const out = await core.addDeck(deck, { origin: "decks" });
      await core.setCurrentDeck({ did: out.id });
      onClose();
      go({ name: "deck", deckId: out.id });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const startAdding = () => setAdding(newDeckDefault(names, row, filter));

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter that confirms an IME candidate must not act on the field.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (adding !== null) {
      if (e.key === "Enter") {
        e.preventDefault();
        void create();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setRow((r) => moveRow(r, e.key === "ArrowDown" ? 1 : -1, shown.length));
    } else if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      startAdding();
    } else if (mod && rowForDigit(e.key, shown.length) !== null) {
      e.preventDefault();
      setRow(rowForDigit(e.key, shown.length)!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void study(shown[row]);
    }
  };

  const title = trLabel("qt-misc-study-deck");

  if (adding !== null) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={tr("decks-create-deck")}
        description={t("decks.nameHint")}
        footer={
          <>
            <Button onClick={() => setAdding(null)} disabled={busy}>
              {tr("actions-cancel")}
            </Button>
            <Button variant="primary" onClick={() => void create()} disabled={busy || !adding.trim()}>
              {tr("decks-create-deck")}
            </Button>
          </>
        }
      >
        <div onKeyDown={onKeyDown}>
          <label className="mb-1.5 block text-control text-ink-2" htmlFor="study-deck-new">
            {tr("decks-new-deck-name").replace(/:\s*$/, "")}
          </label>
          <TextField id="study-deck-new" autoFocus value={adding} onChange={(e) => setAdding(e.target.value)} />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width={460}
      footer={
        <>
          <Button onClick={startAdding} className="me-auto" disabled={busy || decks.isPending} title={tr("decks-add-new-deck-ctrlandn")}>
            <Plus />
            {tr("actions-add")}
            <Kbd>{displayChord("Ctrl+N")}</Kbd>
          </Button>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" onClick={() => void study(shown[row])} disabled={busy || shown.length === 0}>
            {tr("decks-study")}
          </Button>
        </>
      }
    >
      <div onKeyDown={onKeyDown} className="flex flex-col gap-2.5">
        <TextField
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={ts("studyDeckFilter")}
          aria-label={ts("studyDeckFilter")}
          role="combobox"
          aria-expanded
          aria-controls="study-deck-list"
          aria-activedescendant={shown[row] ? `study-deck-${shown[row].id}` : undefined}
        />
        {decks.isPending ? (
          <div className="grid h-[220px] place-items-center">
            <Spinner />
          </div>
        ) : decks.isError ? (
          <div className="grid h-[220px] place-items-center gap-2 text-center text-control text-ink-2">
            <p>{decks.error instanceof Error ? decks.error.message : String(decks.error)}</p>
            <Button size="sm" onClick={() => void decks.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <p className="grid h-[220px] place-items-center text-control text-ink-3">{ts("studyDeckNone")}</p>
        ) : (
          <ul ref={list} id="study-deck-list" role="listbox" aria-label={title} className="h-[220px] overflow-y-auto rounded-[8px] border border-line bg-surface p-1">
            {shown.map((entry, i) => (
              <li
                key={String(entry.id)}
                id={`study-deck-${entry.id}`}
                role="option"
                aria-selected={i === row}
                onClick={() => setRow(i)}
                onDoubleClick={() => void study(entry)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-[6px] px-2.5 text-control text-ink",
                  i === row ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{entry.name.replaceAll("::", " › ")}</span>
                {i < 9 && <span className="shrink-0 text-caption text-ink-3">{i + 1}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

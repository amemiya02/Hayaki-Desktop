// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { CornerLeftUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, cn, Dialog, TextField } from "@/components/ui";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { t } from "@/lib/i18n";
import { leafName } from "@/lib/queries";
import { td } from "@/lib/strings/decks";

import { moveTargets, TOP_LEVEL } from "./model";
import { reparentDeck } from "./reparent";

/** The keyboard route to dragging: pick the Deck that will hold this one. */
export function MoveDeckDialog({ deck, root, onClose }: { deck: DeckTreeNode | null; root: DeckTreeNode | undefined; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const targets = useMemo(() => (deck && root ? moveTargets(root, deck.deckId, query) : []), [deck, root, query]);
  const active = Math.min(index, Math.max(targets.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [active, targets]);

  const submit = async (id = targets[active]?.id) => {
    if (!deck || id === undefined || busy) return;
    setBusy(true);
    const moved = await reparentDeck(root, deck.deckId, id);
    setBusy(false);
    if (moved) onClose();
  };

  return (
    <Dialog
      open={!!deck}
      onOpenChange={(open) => !open && onClose()}
      title={td("moveTitle", { deck: leafName(deck?.name ?? "") })}
      description={td("moveHint")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={targets.length === 0 || busy} onClick={() => void submit()}>
            {td("moveConfirm")}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        value={query}
        placeholder={td("moveSearch")}
        aria-label={td("moveSearch")}
        role="combobox"
        aria-expanded
        aria-controls="move-deck-list"
        aria-activedescendant={targets[active] ? `move-deck-${targets[active].id}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setIndex(Math.min(active + 1, targets.length - 1));
          else if (e.key === "ArrowUp") setIndex(Math.max(active - 1, 0));
          else if (e.key === "Enter") void submit();
          else return;
          e.preventDefault();
        }}
      />
      <ul
        id="move-deck-list"
        ref={listRef}
        role="listbox"
        aria-label={td("moveTo")}
        className="mt-3 max-h-[300px] overflow-y-auto rounded-[9px] border border-line bg-surface p-1"
      >
        {targets.length === 0 && <li className="px-3 py-6 text-center text-control text-ink-3">{td("moveNone")}</li>}
        {targets.map((target, i) => (
          <li
            key={String(target.id)}
            id={`move-deck-${target.id}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setIndex(i)}
            onClick={() => void submit(target.id)}
            style={{ paddingInlineStart: 10 + (query ? 0 : target.depth * 16) }}
            className={cn(
              "flex h-8 cursor-default items-center gap-2 rounded-[6px] pe-2.5 text-control text-ink",
              i === active && "bg-accent-soft text-accent-ink",
            )}
          >
            {target.id === TOP_LEVEL ? (
              <>
                <CornerLeftUp className="size-3.5 shrink-0" />
                <span className="truncate">{td("topLevel")}</span>
              </>
            ) : (
              <span className="truncate" title={target.name}>
                {query ? target.name.replaceAll("::", " › ") : leafName(target.name)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

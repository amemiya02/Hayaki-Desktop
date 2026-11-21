// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { CornerLeftUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, cn, Dialog, TextField } from "@/components/ui";
import type { TagTreeNode } from "@/lib/anki/proto/anki/tags_pb";
import { tr } from "@/lib/i18n";
import { tb } from "@/lib/strings/browse";
import { td } from "@/lib/strings/decks";

import { change, leafOf, reparentTags, tagMoveTargets } from "./sidebar-ops";

/** The keyboard route to dragging a tag: pick the tag that will hold this one. */
export function MoveTagDialog({ tag, tree, onClose }: { tag: string | null; tree: TagTreeNode[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const targets = useMemo(() => (tag ? tagMoveTargets(tree, tag, query) : []), [tag, tree, query]);
  const active = Math.min(index, Math.max(targets.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [active, targets]);

  const submit = async (name = targets[active]?.name) => {
    if (!tag || name === undefined || busy) return;
    setBusy(true);
    await change(() => reparentTags([tag], name));
    setBusy(false);
    onClose();
  };

  return (
    <Dialog
      open={!!tag}
      onOpenChange={(open) => !open && onClose()}
      title={tb("moveTagTitle", { tag: leafOf(tag ?? "") })}
      description={tb("moveTagHint")}
      footer={
        <>
          <Button onClick={onClose}>{tr("actions-cancel")}</Button>
          <Button variant="primary" disabled={targets.length === 0 || busy} onClick={() => void submit()}>
            {td("moveConfirm")}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        value={query}
        placeholder={tb("moveTagSearch")}
        aria-label={tb("moveTagSearch")}
        role="combobox"
        aria-expanded
        aria-controls="move-tag-list"
        aria-activedescendant={targets[active] ? `move-tag-${active}` : undefined}
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
        id="move-tag-list"
        ref={listRef}
        role="listbox"
        aria-label={td("moveTo")}
        className="mt-3 max-h-[300px] overflow-y-auto rounded-[9px] border border-line bg-surface p-1"
      >
        {targets.length === 0 && <li className="px-3 py-6 text-center text-control text-ink-3">{tb("moveTagNone")}</li>}
        {targets.map((target, i) => (
          <li
            key={target.name}
            id={`move-tag-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setIndex(i)}
            onClick={() => void submit(target.name)}
            style={{ paddingInlineStart: 10 + (query ? 0 : target.depth * 16) }}
            className={cn(
              "flex h-8 cursor-default items-center gap-2 rounded-[6px] pe-2.5 text-control text-ink",
              i === active && "bg-accent-soft text-accent-ink",
            )}
          >
            {target.name === "" ? (
              <>
                <CornerLeftUp className="size-3.5 shrink-0" />
                <span className="truncate">{td("topLevel")}</span>
              </>
            ) : (
              <span className="truncate" title={target.name}>
                {query ? target.name.replaceAll("::", " › ") : leafOf(target.name)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The browser's sidebar (`aqt/browser/sidebar/tree.py`): Saved Searches,
 * Today, Flags, Card State, Decks, Note Types and Tags. A click searches;
 * Ctrl ANDs, Shift ORs, Ctrl+Shift replaces and Alt negates, as in Anki.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, ChevronRight, Circle, Clock, Flag, FlagOff, Layers, Plus, Shapes, Tag, X } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { cn, IconButton } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_Bool } from "@/lib/anki/proto/anki/config_pb";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@/lib/anki/proto/anki/decks_pb";
import { SearchNode_CardState } from "@/lib/anki/proto/anki/search_pb";
import type { TagTreeNode } from "@/lib/anki/proto/anki/tags_pb";
import { localeCompare, tr } from "@/lib/i18n";
import { leafName } from "@/lib/queries";

import { readFlagLabels, readSavedSearches, writeSavedSearches } from "./config";
import { SaveSearchDialog } from "./dialogs";
import { combineSearch, joinPath, nodes, parsable, type NodeInit } from "./search";

interface Props {
  search: string;
  onSearch: (text: string) => void;
}

function useCollapsed(key: ConfigKey_Bool) {
  const client = useQueryClient();
  const queryKey = ["browse", "collapsed", key];
  const { data } = useQuery({ queryKey, queryFn: async () => (await core.getConfigBool({ key })).val });
  const toggle = () => {
    const next = !data;
    client.setQueryData(queryKey, next);
    void core.setConfigBool({ key, value: next, undoable: false }, { quiet: true });
  };
  return [data ?? false, toggle] as const;
}

function Section({ label, icon, collapseKey, children, action }: { label: string; icon: ReactNode; collapseKey: ConfigKey_Bool; children: ReactNode; action?: ReactNode }) {
  const [collapsed, toggle] = useCollapsed(collapseKey);
  return (
    <section className="mt-1">
      <div className="group flex h-7 items-center pr-1">
        <button
          data-sidebar-item
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-1.5 text-left text-caption font-semibold text-ink-3 hover:text-ink-2 [&>svg]:size-3.5 [&>svg]:shrink-0"
        >
          <ChevronRight className={cn("transition-transform duration-[var(--dur)] ease-out", !collapsed && "rotate-90")} />
          {icon}
          <span className="truncate">{label}</span>
        </button>
        {action}
      </div>
      {!collapsed && <ul role="group">{children}</ul>}
    </section>
  );
}

function Item({
  label,
  icon,
  depth = 0,
  active,
  title,
  onClick,
  expanded,
  onToggle,
  trailing,
}: {
  label: string;
  icon?: ReactNode;
  depth?: number;
  active: boolean;
  title?: string;
  onClick: (e: MouseEvent) => void;
  expanded?: boolean;
  onToggle?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <li>
      <div
        className={cn(
          "group flex h-[28px] items-center rounded-[7px] pr-1 text-control transition-colors duration-[var(--dur-fast)]",
          active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sidebar-hover",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {onToggle ? (
          <button
            tabIndex={-1}
            aria-label={expanded ? tr("browsing-sidebar-collapse") : tr("browsing-sidebar-expand")}
            onClick={onToggle}
            className="grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:text-ink"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-[var(--dur)] ease-out", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          data-sidebar-item
          aria-current={active ? "true" : undefined}
          aria-expanded={onToggle ? expanded : undefined}
          onClick={onClick}
          onKeyDown={(e) => {
            if (!onToggle) return;
            if ((e.key === "ArrowRight" && !expanded) || (e.key === "ArrowLeft" && expanded)) {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }
          }}
          title={title ?? label}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[6px] pl-0.5 text-left outline-none focus-visible:shadow-ring-inset [&>svg]:size-3.5 [&>svg]:shrink-0"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
        {trailing}
      </div>
    </li>
  );
}

/** Up and Down move between sidebar entries. */
function onTreeKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-sidebar-item]")];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

export function FilterSidebar({ search, onSearch }: Props) {
  const client = useQueryClient();
  const [last, setLast] = useState<{ key: string; search: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: saved } = useQuery({ queryKey: ["browse", "saved"], queryFn: readSavedSearches });
  const { data: flagLabels } = useQuery({ queryKey: ["browse", "flagLabels"], queryFn: readFlagLabels });
  const { data: deckTree } = useQuery({ queryKey: ["browse", "deckTree"], queryFn: () => core.deckTree({ now: 0n }) });
  const { data: notetypes } = useQuery({ queryKey: ["browse", "notetypes"], queryFn: () => core.getNotetypeNames() });
  const { data: tagTree } = useQuery({ queryKey: ["browse", "tagTree"], queryFn: () => core.tagTree() });

  const activate = (key: string, node: NodeInit) => async (e: MouseEvent) => {
    try {
      const text = await combineSearch(search, node, e);
      const plain = !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey);
      setLast(plain ? { key, search: text } : null);
      onSearch(text);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const isActive = (key: string) => last?.key === key && last.search === search;

  const toggleDeck = (node: DeckTreeNode) => {
    void core
      .setDeckCollapsed({ deckId: node.deckId, collapsed: !node.collapsed, scope: SetDeckCollapsedRequest_Scope.BROWSER }, { quiet: true })
      .then(() => client.invalidateQueries({ queryKey: ["browse", "deckTree"] }));
  };
  const toggleTag = (fullName: string, node: TagTreeNode) => {
    void core
      .setTagCollapsed({ name: fullName, collapsed: !node.collapsed }, { quiet: true })
      .then(() => client.invalidateQueries({ queryKey: ["browse", "tagTree"] }));
  };

  const removeSaved = async (name: string) => {
    const next = { ...(saved ?? {}) };
    delete next[name];
    await writeSavedSearches(next);
    await client.invalidateQueries({ queryKey: ["browse", "saved"] });
  };

  const renderDecks = (list: DeckTreeNode[], parent: string, depth: number): ReactNode =>
    list.map((node) => {
      const full = joinPath(parent, leafName(node.name));
      const key = `deck:${full}`;
      const hasChildren = node.children.length > 0;
      return (
        <DeckEntry key={String(node.deckId)}>
          <Item
            label={leafName(node.name)}
            title={full}
            icon={<Layers className="text-ink-3" />}
            depth={depth}
            active={isActive(key)}
            onClick={activate(key, nodes.deck(full))}
            expanded={!node.collapsed}
            onToggle={hasChildren ? () => toggleDeck(node) : undefined}
          />
          {hasChildren && !node.collapsed && renderDecks(node.children, full, depth + 1)}
        </DeckEntry>
      );
    });

  const renderTags = (list: TagTreeNode[], parent: string, depth: number): ReactNode =>
    list.map((node) => {
      const full = joinPath(parent, node.name);
      const key = `tag:${full}`;
      const hasChildren = node.children.length > 0;
      return (
        <DeckEntry key={full}>
          <Item
            label={node.name}
            title={full}
            icon={<Tag className="text-ink-3" />}
            depth={depth}
            active={isActive(key)}
            onClick={activate(key, nodes.tag(full))}
            expanded={!node.collapsed}
            onToggle={hasChildren ? () => toggleTag(full, node) : undefined}
          />
          {hasChildren && !node.collapsed && renderTags(node.children, full, depth + 1)}
        </DeckEntry>
      );
    });

  const savedEntries = Object.entries(saved ?? {}).sort(([a], [b]) => localeCompare(a, b));

  const today: [string, string, () => NodeInit][] = [
    ["today:due", tr("browsing-sidebar-due-today"), nodes.dueToday],
    ["today:added", tr("browsing-added-today"), nodes.addedToday],
    ["today:edited", tr("browsing-edited-today"), nodes.editedToday],
    ["today:studied", tr("browsing-studied-today"), nodes.studiedToday],
    ["today:first", tr("browsing-sidebar-first-review"), nodes.firstReview],
    ["today:rescheduled", tr("browsing-sidebar-rescheduled"), nodes.rescheduled],
    ["today:again", tr("browsing-again-today"), nodes.againToday],
    ["today:overdue", tr("browsing-sidebar-overdue"), nodes.overdue],
  ];

  const states: [string, string, SearchNode_CardState, string][] = [
    ["state:new", tr("actions-new"), SearchNode_CardState.NEW, "text-new"],
    ["state:learn", tr("scheduling-learning"), SearchNode_CardState.LEARN, "text-learn"],
    ["state:review", tr("browsing-sidebar-card-state-review"), SearchNode_CardState.REVIEW, "text-due"],
    ["state:suspended", tr("browsing-suspended"), SearchNode_CardState.SUSPENDED, "text-suspended"],
    ["state:buried", tr("browsing-buried"), SearchNode_CardState.BURIED, "text-buried"],
  ];

  return (
    <nav aria-label={tr("browsing-sidebar")} className="h-full overflow-y-auto px-2 pb-4 pt-2" onKeyDown={onTreeKey}>
      <Section
        label={tr("browsing-sidebar-saved-searches")}
        icon={<Bookmark />}
        collapseKey={ConfigKey_Bool.COLLAPSE_SAVED_SEARCHES}
        action={
          <IconButton label={tr("browsing-sidebar-save-current-search")} size="sm" className="size-6" onClick={() => setSaving(true)}>
            <Plus />
          </IconButton>
        }
      >
        {savedEntries.map(([name, text]) => (
          <Item
            key={name}
            label={name}
            title={text}
            icon={<Bookmark className="text-ink-3" />}
            active={isActive(`saved:${name}`)}
            onClick={activate(`saved:${name}`, parsable(text))}
            trailing={
              <button
                tabIndex={-1}
                aria-label={tr("actions-delete")}
                title={tr("actions-delete")}
                onClick={() => void removeSaved(name)}
                className="grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100 [&>svg]:size-3.5"
              >
                <X />
              </button>
            }
          />
        ))}
      </Section>

      <Section label={tr("browsing-today")} icon={<Clock />} collapseKey={ConfigKey_Bool.COLLAPSE_TODAY}>
        {today.map(([key, label, node]) => (
          <Item key={key} label={label} icon={<Clock className="text-ink-3" />} active={isActive(key)} onClick={activate(key, node())} />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-flags")} icon={<Flag />} collapseKey={ConfigKey_Bool.COLLAPSE_FLAGS}>
        <Item label={tr("browsing-no-flag")} icon={<FlagOff className="text-ink-3" />} active={isActive("flag:0")} onClick={activate("flag:0", nodes.flag(0))} />
        {(flagLabels ?? []).map((label, i) => (
          <Item
            key={i}
            label={label}
            icon={<Flag style={{ color: `var(--flag-${i + 1})`, fill: `var(--flag-${i + 1})` }} />}
            active={isActive(`flag:${i + 1}`)}
            onClick={activate(`flag:${i + 1}`, nodes.flag(i + 1))}
          />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-card-state")} icon={<Circle />} collapseKey={ConfigKey_Bool.COLLAPSE_CARD_STATE}>
        {states.map(([key, label, state, colour]) => (
          <Item
            key={key}
            label={label}
            icon={<Circle className={cn(colour, "fill-current")} />}
            active={isActive(key)}
            onClick={activate(key, nodes.cardState(state))}
          />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-decks")} icon={<Layers />} collapseKey={ConfigKey_Bool.COLLAPSE_DECKS}>
        {renderDecks(deckTree?.children ?? [], "", 0)}
      </Section>

      <Section label={tr("browsing-sidebar-notetypes")} icon={<Shapes />} collapseKey={ConfigKey_Bool.COLLAPSE_NOTETYPES}>
        {(notetypes?.entries ?? []).map((nt) => (
          <Item
            key={String(nt.id)}
            label={nt.name}
            icon={<Shapes className="text-ink-3" />}
            active={isActive(`note:${nt.name}`)}
            onClick={activate(`note:${nt.name}`, nodes.notetype(nt.name))}
          />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-tags")} icon={<Tag />} collapseKey={ConfigKey_Bool.COLLAPSE_TAGS}>
        {renderTags(tagTree?.children ?? [], "", 0)}
      </Section>

      {saving && (
        <SaveSearchDialog
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const current = await readSavedSearches();
            if (current[name] !== undefined && current[name] !== search) {
              if (!window.confirm(tr("browsing-confirm-saved-search-overwrite", { name }))) return;
            }
            await writeSavedSearches({ ...current, [name]: search });
            await client.invalidateQueries({ queryKey: ["browse", "saved"] });
          }}
        />
      )}
    </nav>
  );
}

/** Groups a tree entry with its children so React keys stay stable. */
function DeckEntry({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

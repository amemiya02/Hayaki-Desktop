// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The browser's sidebar (`aqt/browser/sidebar/tree.py`): Saved Searches,
 * Today, Flags, Card State, Decks, Note Types and Tags. A click searches;
 * Ctrl ANDs, Shift ORs, Ctrl+Shift replaces and Alt negates, as in Anki.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Circle, Clock, Flag, FlagOff, Layers, Plus, Shapes, Tag, X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { cn, IconButton } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_Bool } from "@/lib/anki/proto/anki/config_pb";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@/lib/anki/proto/anki/decks_pb";
import { SearchNode_CardState } from "@/lib/anki/proto/anki/search_pb";
import type { TagTreeNode } from "@/lib/anki/proto/anki/tags_pb";
import { cleanLabel, localeCompare, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { leafName } from "@/lib/queries";
import { tb } from "@/lib/strings/browse";
import { td } from "@/lib/strings/decks";
import { deckDnd } from "@/screens/decks/drag";
import { MoveDeckDialog } from "@/screens/decks/MoveDeckDialog";

import { FLAG_KEYS, readFlagLabels, readSavedSearches, writeSavedSearches } from "./config";
import { RenameDialog, SaveSearchDialog } from "./dialogs";
import { CtxItem, CtxSeparator } from "./menus";
import { combineSearch, joinPath, nodes, parsable, type NodeInit } from "./search";
import * as ops from "./sidebar-ops";
import { MoveTagDialog } from "./MoveTagDialog";
import { Item, onTreeKey, Section, type Dnd } from "./SidebarParts";
import { tagDrag } from "./tag-drag";

interface Props {
  search: string;
  onSearch: (text: string) => void;
  /** Adds or removes a tag on the selected Notes. */
  onTagNotes: (tag: string, remove: boolean) => void;
}

/** A Deck or tag whose name is being edited with its parents. */
type Dragged = { kind: "deck"; full: string; id: bigint } | { kind: "tag"; full: string };

/** One tree entry's collapse state, for the Expand and Collapse menu items. */
interface Branch {
  collapsed: boolean;
  children: { collapsed: boolean; hasChildren: boolean; set: (collapsed: boolean) => Promise<void> }[];
  set: (collapsed: boolean) => Promise<void>;
}

export function FilterSidebar({ search, onSearch, onTagNotes }: Props) {
  const client = useQueryClient();
  const go = useNav((s) => s.go);
  const [last, setLast] = useState<{ key: string; search: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** The entry being renamed in place, by key. */
  const [editing, setEditing] = useState<string | null>(null);
  const [withParents, setWithParents] = useState<Dragged | null>(null);
  const [movingTag, setMovingTag] = useState<string | null>(null);
  const [movingDeck, setMovingDeck] = useState<DeckTreeNode | null>(null);

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

  const refresh = (...keys: string[]) => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: ["browse", key] })));

  const change = ops.change;

  const setDeckCollapsed = async (deckId: bigint, collapsed: boolean) => {
    await core.setDeckCollapsed({ deckId, collapsed, scope: SetDeckCollapsedRequest_Scope.BROWSER }, { quiet: true });
    await refresh("deckTree");
  };
  const setTagCollapsed = async (name: string, collapsed: boolean) => {
    await core.setTagCollapsed({ name, collapsed }, { quiet: true });
    await refresh("tagTree");
  };
  const toggleDeck = (node: DeckTreeNode) => void setDeckCollapsed(node.deckId, !node.collapsed);
  const toggleTag = (fullName: string, node: TagTreeNode) => void setTagCollapsed(fullName, !node.collapsed);

  const deckBranch = (node: DeckTreeNode): Branch => ({
    collapsed: node.collapsed,
    set: (c) => setDeckCollapsed(node.deckId, c),
    children: node.children.map((child) => ({
      collapsed: child.collapsed,
      hasChildren: child.children.length > 0,
      set: (c) => setDeckCollapsed(child.deckId, c),
    })),
  });
  const tagBranch = (full: string, node: TagTreeNode): Branch => ({
    collapsed: node.collapsed,
    set: (c) => setTagCollapsed(full, c),
    children: node.children.map((child) => ({
      collapsed: child.collapsed,
      hasChildren: child.children.length > 0,
      set: (c) => setTagCollapsed(joinPath(full, child.name), c),
    })),
  });

  /** Anki's Expand, Collapse, Expand Children and Collapse Children. */
  const branchMenu = (branch: Branch): ReactNode => {
    const parents = branch.children.filter((c) => c.hasChildren);
    const items: [string, () => void][] = [];
    if (branch.collapsed) items.push([tr("browsing-sidebar-expand"), () => void branch.set(false)]);
    else items.push([tr("browsing-sidebar-collapse"), () => void branch.set(true)]);
    if (parents.some((c) => c.collapsed)) {
      items.push([tr("browsing-sidebar-expand-children"), () => void Promise.all([branch.set(false), ...parents.map((c) => c.set(false))])]);
    }
    if (parents.some((c) => !c.collapsed)) {
      items.push([tr("browsing-sidebar-collapse-children"), () => void Promise.all(parents.map((c) => c.set(true)))]);
    }
    return items.map(([label, run]) => (
      <CtxItem key={label} onSelect={run}>
        {label}
      </CtxItem>
    ));
  };

  /* ------------------------------ Drag and drop ------------------------------ */

  const getDeckRoot = () => client.getQueryData<DeckTreeNode>(["browse", "deckTree"]);
  const tagDnd = (full: string, draggable: boolean): Dnd => ({
    attribute: "data-tag-drop",
    key: full,
    state: tagDrag.useTarget,
    handlers: draggable ? tagDrag.handlers(full, full) : undefined,
  });

  /* ------------------------------ Saved searches ------------------------------ */

  const removeSaved = async (name: string) => {
    const next = { ...(saved ?? {}) };
    delete next[name];
    await writeSavedSearches(next);
    await refresh("saved");
  };

  const confirmOverwrite = (name: string, action: string) =>
    confirm({ title: tr("browsing-sidebar-saved-searches"), message: tr("browsing-confirm-saved-search-overwrite", { name }), confirm: action });

  const renameSaved = async (name: string, to: string) => {
    const newName = ops.cleanName(to);
    setEditing(null);
    if (!newName || newName === name) return;
    const current = await readSavedSearches();
    const result = ops.renameSaved(current, name, newName);
    if (result.overwrites && !(await confirmOverwrite(newName, tr("actions-rename")))) return;
    await writeSavedSearches(result.saved);
    await refresh("saved");
  };

  const updateSaved = async (name: string) => {
    try {
      const text = (await core.buildSearchString(parsable(search))).val;
      await writeSavedSearches({ ...(await readSavedSearches()), [name]: text });
      await refresh("saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  /* ------------------------------ Decks and tags ------------------------------ */

  const renameDeck = (node: DeckTreeNode, parent: string, to: string) => {
    const name = ops.cleanName(to);
    setEditing(null);
    if (!name || name === leafName(node.name)) return;
    void change(() => ops.renameDeck(node.deckId, joinPath(parent, name)));
  };
  const renameTag = (full: string, parent: string, to: string) => {
    const name = ops.cleanName(to);
    setEditing(null);
    if (!name || name === full.slice(parent ? parent.length + 2 : 0)) return;
    void change(() => ops.renameTag(full, joinPath(parent, name)));
  };

  const renderDecks = (list: DeckTreeNode[], parent: string, depth: number): ReactNode =>
    list.map((node) => {
      const leaf = leafName(node.name);
      const full = joinPath(parent, leaf);
      const key = `deck:${full}`;
      const hasChildren = node.children.length > 0;
      const target: Dragged = { kind: "deck", full, id: node.deckId };
      const remove = () => void change(() => ops.removeDecks([node.deckId], leaf));
      return (
        <DeckEntry key={String(node.deckId)}>
          <Item
            label={leaf}
            title={full}
            icon={<Layers className="text-ink-3" />}
            depth={depth}
            active={isActive(key)}
            onClick={activate(key, nodes.deck(full))}
            expanded={!node.collapsed}
            onToggle={hasChildren ? () => toggleDeck(node) : undefined}
            rename={{ editing: editing === key, value: leaf, onStart: () => setEditing(key), onCommit: (v) => renameDeck(node, parent, v), onCancel: () => setEditing(null) }}
            onDelete={remove}
            dnd={deckDnd(node.deckId, { node, getRoot: getDeckRoot })}
            menu={
              <>
                <CtxItem onSelect={remove} danger>
                  {tr("actions-delete")}
                </CtxItem>
                <CtxItem onSelect={() => setEditing(key)}>{tr("actions-rename")}</CtxItem>
                {parent && <CtxItem onSelect={() => setWithParents(target)}>{tr("actions-rename-with-parents")}</CtxItem>}
                <CtxItem onSelect={() => setMovingDeck(node)}>{td("moveTo")}</CtxItem>
                {hasChildren && (
                  <>
                    <CtxSeparator />
                    {branchMenu(deckBranch(node))}
                  </>
                )}
              </>
            }
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
      const target: Dragged = { kind: "tag", full };
      const remove = () => void change(() => ops.removeTag(full));
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
            rename={{ editing: editing === key, value: node.name, onStart: () => setEditing(key), onCommit: (v) => renameTag(full, parent, v), onCancel: () => setEditing(null) }}
            onDelete={remove}
            dnd={tagDnd(full, true)}
            menu={
              <>
                <CtxItem onSelect={() => onTagNotes(full, false)}>{tr("browsing-add-to-selected-notes")}</CtxItem>
                <CtxItem onSelect={() => onTagNotes(full, true)}>{tr("browsing-remove-from-selected-notes")}</CtxItem>
                <CtxSeparator />
                <CtxItem onSelect={remove} danger>
                  {tr("actions-delete")}
                </CtxItem>
                <CtxItem onSelect={() => setEditing(key)}>{tr("actions-rename")}</CtxItem>
                {parent && <CtxItem onSelect={() => setWithParents(target)}>{tr("actions-rename-with-parents")}</CtxItem>}
                <CtxItem onSelect={() => setMovingTag(full)}>{td("moveTo")}</CtxItem>
                {hasChildren && (
                  <>
                    <CtxSeparator />
                    {branchMenu(tagBranch(full, node))}
                  </>
                )}
              </>
            }
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

  const renameFlag = async (flag: number, to: string) => {
    setEditing(null);
    try {
      await ops.setFlagName(flag, to);
      await refresh("flagLabels");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <nav data-drag-scroll aria-label={tr("browsing-sidebar")} className="h-full overflow-y-auto px-2 pb-4 pt-2" onKeyDown={onTreeKey}>
      <Section
        label={tr("browsing-sidebar-saved-searches")}
        icon={<Bookmark />}
        collapseKey={ConfigKey_Bool.COLLAPSE_SAVED_SEARCHES}
        menu={<CtxItem onSelect={() => setSaving(true)}>{tr("browsing-sidebar-save-current-search")}</CtxItem>}
        action={
          <IconButton label={tr("browsing-sidebar-save-current-search")} size="sm" className="size-6" onClick={() => setSaving(true)}>
            <Plus />
          </IconButton>
        }
      >
        {savedEntries.map(([name, text]) => {
          const key = `saved:${name}`;
          const remove = () => void removeSaved(name);
          return (
            <Item
              key={name}
              label={name}
              title={text}
              icon={<Bookmark className="text-ink-3" />}
              active={isActive(key)}
              onClick={activate(key, parsable(text))}
              rename={{ editing: editing === key, value: name, onStart: () => setEditing(key), onCommit: (v) => void renameSaved(name, v), onCancel: () => setEditing(null) }}
              onDelete={remove}
              menu={
                <>
                  <CtxItem onSelect={() => void updateSaved(name)}>{tr("browsing-update-saved-search")}</CtxItem>
                  <CtxSeparator />
                  <CtxItem onSelect={remove} danger>
                    {tr("actions-delete")}
                  </CtxItem>
                  <CtxItem onSelect={() => setEditing(key)}>{tr("actions-rename")}</CtxItem>
                </>
              }
              trailing={
                <button
                  tabIndex={-1}
                  aria-label={tr("actions-delete")}
                  title={tr("actions-delete")}
                  onClick={remove}
                  className="grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100 [&>svg]:size-3.5"
                >
                  <X />
                </button>
              }
            />
          );
        })}
      </Section>

      <Section label={tr("browsing-today")} icon={<Clock />} collapseKey={ConfigKey_Bool.COLLAPSE_TODAY}>
        {today.map(([key, label, node]) => (
          <Item key={key} label={label} icon={<Clock className="text-ink-3" />} active={isActive(key)} onClick={activate(key, node())} />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-flags")} icon={<Flag />} collapseKey={ConfigKey_Bool.COLLAPSE_FLAGS}>
        <Item label={tr("browsing-no-flag")} icon={<FlagOff className="text-ink-3" />} active={isActive("flag:0")} onClick={activate("flag:0", nodes.flag(0))} />
        {(flagLabels ?? []).map((label, i) => {
          const key = `flag:${i + 1}`;
          const renamed = label !== tr(FLAG_KEYS[i]);
          return (
            <Item
              key={i}
              label={label}
              icon={<Flag style={{ color: `var(--flag-${i + 1})`, fill: `var(--flag-${i + 1})` }} />}
              active={isActive(key)}
              onClick={activate(key, nodes.flag(i + 1))}
              rename={{ editing: editing === key, value: label, onStart: () => setEditing(key), onCommit: (v) => void renameFlag(i + 1, v), onCancel: () => setEditing(null) }}
              menu={
                <>
                  <CtxItem onSelect={() => setEditing(key)}>{tr("actions-rename")}</CtxItem>
                  {renamed && <CtxItem onSelect={() => void renameFlag(i + 1, "")}>{tb("resetName")}</CtxItem>}
                </>
              }
            />
          );
        })}
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

      <Section
        label={tr("browsing-sidebar-decks")}
        icon={<Layers />}
        collapseKey={ConfigKey_Bool.COLLAPSE_DECKS}
        dnd={deckDnd(0n)}
      >
        {renderDecks(deckTree?.children ?? [], "", 0)}
      </Section>

      <Section
        label={tr("browsing-sidebar-notetypes")}
        icon={<Shapes />}
        collapseKey={ConfigKey_Bool.COLLAPSE_NOTETYPES}
        menu={<CtxItem onSelect={() => go({ name: "notetypes" })}>{cleanLabel(tr("browsing-manage-note-types"))}</CtxItem>}
      >
        {(notetypes?.entries ?? []).map((nt) => (
          <Item
            key={String(nt.id)}
            label={nt.name}
            icon={<Shapes className="text-ink-3" />}
            active={isActive(`note:${nt.name}`)}
            onClick={activate(`note:${nt.name}`, nodes.notetype(nt.name))}
            menu={
              <>
                <CtxItem onSelect={() => go({ name: "notetype", notetypeId: nt.id })}>{tb("editNotetype")}</CtxItem>
                <CtxItem onSelect={() => go({ name: "notetype", notetypeId: nt.id, tab: "fields" })}>{tr("notetypes-fields")}</CtxItem>
                <CtxItem onSelect={() => go({ name: "notetype", notetypeId: nt.id, tab: "templates" })}>{tr("notetypes-cards")}</CtxItem>
                <CtxSeparator />
                <CtxItem onSelect={() => go({ name: "notetypes" })}>{cleanLabel(tr("browsing-manage-note-types"))}</CtxItem>
              </>
            }
          />
        ))}
      </Section>

      <Section label={tr("browsing-sidebar-tags")} icon={<Tag />} collapseKey={ConfigKey_Bool.COLLAPSE_TAGS} dnd={tagDnd("", false)}>
        {renderTags(tagTree?.children ?? [], "", 0)}
      </Section>

      {saving && (
        <SaveSearchDialog
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            const current = await readSavedSearches();
            if (current[name] !== undefined && current[name] !== search) {
              if (!(await confirmOverwrite(name, tr("actions-save")))) return;
            }
            await writeSavedSearches({ ...current, [name]: search });
            await refresh("saved");
          }}
        />
      )}

      <MoveTagDialog tag={movingTag} tree={tagTree?.children ?? []} onClose={() => setMovingTag(null)} />
      <MoveDeckDialog deck={movingDeck} root={deckTree} onClose={() => setMovingDeck(null)} />

      {withParents && (
        <RenameDialog
          title={tr(withParents.kind === "deck" ? "actions-rename-deck" : "actions-rename-tag")}
          value={withParents.full}
          onClose={() => setWithParents(null)}
          onSubmit={async (name) => {
            const clean = ops.cleanName(name);
            if (!clean || clean === withParents.full) return;
            await change(() => (withParents.kind === "deck" ? ops.renameDeck(withParents.id, clean).then(() => undefined) : ops.renameTag(withParents.full, clean)));
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

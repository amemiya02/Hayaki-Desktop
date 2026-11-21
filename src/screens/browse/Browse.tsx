// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's card browser: a sidebar of filters, the search field, the Card or
 * Note table and the selected Note's editor, with Anki's actions and
 * shortcuts (`aqt/browser/browser.py`).
 */
import type { MessageInitShape } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CalendarClock,
  CirclePause,
  Columns3,
  CopyPlus,
  Eraser,
  Eye,
  FileCog,
  Files,
  GraduationCap,
  Filter as FilterIcon,
  Info,
  Upload,
  EyeOff,
  Flag,
  FlagOff,
  FolderInput,
  ListOrdered,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  Replace,
  RotateCcw,
  Search,
  Star,
  Tag,
  Tags,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { NoteEditor } from "@/components/editor/NoteEditor";
import {
  Button,
  cn,
  IconButton,
  Menu,
  MenuCheckItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Segmented,
  Spinner,
  SubMenu,
  TextField,
} from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_String } from "@/lib/anki/proto/anki/config_pb";
import { BrowserColumns_Sorting, type SortOrderSchema } from "@/lib/anki/proto/anki/search_pb";
import { t, tr, trLabel } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { tb } from "@/lib/strings/browse";

import { openCardInfo } from "@/screens/card-info";
import { openFilteredDeck } from "@/screens/filtered";
import { useExport } from "@/shell/ExportDialog";

import { isBuried, isSuspended, noteIdsFor, useBrowseActions, useCurrentState } from "./actions";
import {
  readColumns,
  readFlagLabels,
  readNotesMode,
  readSort,
  writeColumns,
  writeNotesMode,
  writeSort,
  type Mode,
  type Sort,
} from "./config";
import { FilterSidebar } from "./FilterSidebar";
import { actionForKey, SHORTCUTS, type ActionId } from "./keys";
import { CtxCheck, CtxItem, CtxSeparator, CtxSub } from "./menus";
import { editorBelow, stepZoom } from "./layout";
import { idSearch, parsable, plainLabel } from "./search";
import { emptySelection, intersect, invertSelection, moveCursor, orderedSelection, selectAll, type Selection } from "./selection";
import { defaultWidth, EDITOR_MIN, editorWidth, useBrowseCurrent, useBrowseLayout } from "./store";
import { Table, type TableHandle } from "./Table";

type Order = MessageInitShape<typeof SortOrderSchema>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultSearch(): Promise<string> {
  try {
    const text = (await core.getConfigString({ key: ConfigKey_String.DEFAULT_SEARCH_TEXT })).val;
    if (text.trim()) return text;
  } catch {
    // Fall through to Anki's default.
  }
  return (await core.buildSearchString({ filter: { case: "deck", value: "current" } })).val;
}

/** Shortcut text shown beside menu items. */
function keyLabel(id: ActionId): string | undefined {
  return SHORTCUTS[id];
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Shortcuts that still work while typing in the search field or the editor. */
const WHILE_TYPING = new Set<ActionId>([
  "focusSearch",
  "focusTable",
  "focusEditor",
  "toggleFilters",
  "toggleMode",
  "next",
  "prev",
  "preview",
  "cardInfo",
  "zoomIn",
  "zoomOut",
  "zoomReset",
]);

export function BrowseScreen({ search }: { search?: string }) {
  const filtersOpen = useBrowseLayout((s) => s.filtersOpen);
  const setFiltersOpen = useBrowseLayout((s) => s.setFiltersOpen);

  // In a narrow window the filter column gives way to the table; it can still be opened.
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1099px)");
    const apply = () => narrow.matches && setFiltersOpen(false);
    apply();
    narrow.addEventListener("change", apply);
    return () => narrow.removeEventListener("change", apply);
  }, [setFiltersOpen]);
  const editorFraction = useBrowseLayout((s) => s.editorFraction);
  const setEditorFraction = useBrowseLayout((s) => s.setEditorFraction);
  const editorFractionBelow = useBrowseLayout((s) => s.editorFractionBelow);
  const setEditorFractionBelow = useBrowseLayout((s) => s.setEditorFractionBelow);
  const layout = useBrowseLayout((s) => s.layout);
  const setLayout = useBrowseLayout((s) => s.setLayout);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const below = editorBelow(layout, windowSize.width, windowSize.height);

  const [mode, setMode] = useState<Mode | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [generation, setGeneration] = useState(0);
  const [sort, setSort] = useState<Sort>({ column: "noteFld", reverse: false });
  const [text, setText] = useState(search ?? "");
  const [active, setActive] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [ids, setIds] = useState<bigint[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<Selection>(emptySelection);

  const table = useRef<TableHandle>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const editorPane = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const bodyWidth = bodySize.width;
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBodySize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const searchToken = useRef(0);
  const generationCounter = useRef(0);

  const { data: allColumns } = useQuery({ queryKey: ["browse", "allColumns"], queryFn: async () => (await core.allBrowserColumns()).columns });
  const { data: flagLabels } = useQuery({ queryKey: ["browse", "flagLabels"], queryFn: readFlagLabels });
  const byKey = useMemo(() => new Map((allColumns ?? []).map((c) => [c.key, c])), [allColumns]);

  // Latest values for callbacks that outlive a render.
  const state = useRef({ mode, sort, active, ids, selection, columns });
  state.current = { mode, sort, active, ids, selection, columns };

  const orderFor = useCallback(
    (m: Mode, s: Sort): Order => {
      const column = byKey.get(s.column);
      const sorting = column ? (m === "notes" ? column.sortingNotes : column.sortingCards) : BrowserColumns_Sorting.ASCENDING;
      if (sorting === BrowserColumns_Sorting.NONE) return { value: { case: "none", value: {} } };
      return { value: { case: "builtin", value: { column: s.column, reverse: s.reverse } } };
    },
    [byKey],
  );

  /** Runs a search; an invalid one leaves the results as they were, as in Anki. */
  const runSearch = useCallback(
    async (query: string, opts?: { mode?: Mode; sort?: Sort; selection?: Selection }) => {
      const m = opts?.mode ?? state.current.mode;
      if (!m) return;
      const s = opts?.sort ?? state.current.sort;
      const token = ++searchToken.current;
      setSearching(true);
      try {
        // Anki shows the search the way the core normalizes it.
        const normalized = query.trim() ? (await core.buildSearchString(parsable(query))).val : "";
        const request = { search: normalized, order: orderFor(m, s) };
        const found = (m === "cards" ? await core.searchCards(request) : await core.searchNotes(request)).ids;
        if (token !== searchToken.current) return;
        setIds(found);
        setActive(normalized);
        setText(normalized);
        setSearchError(null);
        const kept = intersect(opts?.selection ?? state.current.selection, found);
        setSelection(
          kept.selected.size > 0 || found.length === 0 ? kept : { selected: new Set([found[0]]), current: found[0], anchor: found[0] },
        );
      } catch (error) {
        if (token !== searchToken.current) return;
        setSearchError(errorText(error));
        setIds((previous) => previous ?? []);
      } finally {
        if (token === searchToken.current) setSearching(false);
      }
    },
    [orderFor],
  );

  /** Makes a mode's columns the core's active ones before any row is fetched. */
  const activate = useCallback(async (m: Mode): Promise<string[]> => {
    const cols = await readColumns(m);
    await core.setActiveBrowserColumns({ vals: cols });
    setColumns(cols);
    setGeneration(++generationCounter.current);
    return cols;
  }, []);

  // Start: mode, columns and sort from the collection, then the first search.
  const started = useRef(false);
  useEffect(() => {
    if (!allColumns || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const m: Mode = (await readNotesMode()) ? "notes" : "cards";
        await activate(m);
        const s = await readSort(m);
        setSort(s);
        setMode(m);
        const query = search ?? (await defaultSearch());
        setText(search ?? "");
        state.current.mode = m;
        state.current.sort = s;
        await runSearch(query, { mode: m, sort: s });
        table.current?.focus();
      } catch (error) {
        setSearchError(errorText(error));
        setIds([]);
      }
    })();
  }, [allColumns, activate, runSearch, search]);

  // A search sent from the app toolbar or another screen.
  const lastProp = useRef(search);
  useEffect(() => {
    if (search === lastProp.current) return;
    lastProp.current = search;
    if (search === undefined || !state.current.mode) return;
    setText(search);
    void runSearch(search);
  }, [search, runSearch]);

  const submitSearch = (query: string) => {
    setText(query);
    void runSearch(query);
  };

  const switchMode = useCallback(
    async (next: Mode) => {
      const { mode: m, selection: sel, ids: list, active: query } = state.current;
      if (!m || next === m) return;
      try {
        const chosen = orderedSelection(sel, list ?? []);
        // No rows are fetched while the core switches modes.
        setIds(null);
        await writeNotesMode(next === "notes");
        await activate(next);
        const s = await readSort(next);
        let converted: bigint[] = [];
        if (chosen.length > 0) {
          converted =
            next === "notes"
              ? (await core.searchNotes({ search: idSearch("cid", chosen) })).ids
              : (await core.searchCards({ search: idSearch("nid", chosen) })).ids;
        }
        setMode(next);
        setSort(s);
        state.current.mode = next;
        state.current.sort = s;
        const first = converted[0] ?? null;
        await runSearch(query ?? "", { mode: next, sort: s, selection: { selected: new Set(converted), current: first, anchor: first } });
      } catch (error) {
        toast.error(errorText(error));
        setIds((previous) => previous ?? []);
      }
    },
    [activate, runSearch],
  );

  const onSort = useCallback(
    (key: string) => {
      const { mode: m, sort: s, active: query } = state.current;
      if (!m) return;
      const column = byKey.get(key);
      const sorting = column ? (m === "notes" ? column.sortingNotes : column.sortingCards) : BrowserColumns_Sorting.NONE;
      if (sorting === BrowserColumns_Sorting.NONE) {
        toast(tr("browsing-sorting-on-this-column-is-not"));
        return;
      }
      const next: Sort = s.column !== key ? { column: key, reverse: sorting === BrowserColumns_Sorting.DESCENDING } : { column: key, reverse: !s.reverse };
      setSort(next);
      void writeSort(m, next).catch(() => undefined);
      void runSearch(query ?? "", { sort: next });
    },
    [byKey, runSearch],
  );

  const onToggleColumn = useCallback(async (key: string) => {
    const { mode: m, columns: cols } = state.current;
    if (!m) return;
    let next: string[];
    if (cols.includes(key)) {
      if (cols.length === 1) {
        toast(tr("browsing-you-must-have-at-least-one"));
        return;
      }
      next = cols.filter((c) => c !== key);
    } else {
      next = [...cols, key];
    }
    try {
      await writeColumns(m, next);
      setColumns(next);
      setGeneration(++generationCounter.current);
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  /* ------------------------------ Actions ------------------------------ */

  const { data: current } = useCurrentState(mode ?? "cards", mode ? selection.current : null);

  const actionContext = {
    mode: mode ?? "cards",
    current: selection.current,
    selected: () => orderedSelection(state.current.selection, state.current.ids ?? []),
    refresh: () => runSearch(state.current.active ?? ""),
    search: (text: string) => submitSearch(text),
    afterRemove: async () => {
      const { ids: list, selection: sel } = state.current;
      const chosen = orderedSelection(sel, list ?? []);
      const firstIndex = list && chosen.length ? list.indexOf(chosen[0]) : 0;
      const remaining = (list ?? []).filter((id) => !sel.selected.has(id));
      const nextId = remaining[Math.min(firstIndex, remaining.length - 1)];
      await runSearch(state.current.active ?? "", {
        selection: nextId !== undefined ? { selected: new Set([nextId]), current: nextId, anchor: nextId } : emptySelection,
      });
    },
  };
  const actions = useBrowseActions(actionContext, current);
  const runCore = actions.run;
  const currentRef = useRef(current);
  currentRef.current = current;

  // The palette's Card Info reads the current row from here.
  const currentCardId = mode === "cards" ? selection.current : (current?.card?.id ?? null);
  useEffect(() => {
    useBrowseCurrent.setState({ cardId: currentCardId });
    return () => useBrowseCurrent.setState({ cardId: null });
  }, [currentCardId]);

  /** Anki changes the Note Type only when every selected Note shares one. */
  const changeNotetype = async () => {
    const { mode: m, selection: sel, ids: list } = state.current;
    if (!m) return;
    const noteIds = await noteIdsFor(m, orderedSelection(sel, list ?? []));
    if (noteIds.length === 0) return;
    try {
      await core.getSingleNotetypeOfNotes({ noteIds });
    } catch {
      toast(tr("errors-multiple-notetypes-selected"));
      return;
    }
    useNav.getState().go({ name: "change-notetype", noteIds });
  };

  const exportNotes = async () => {
    const { mode: m, selection: sel, ids: list } = state.current;
    if (!m) return;
    const noteIds = await noteIdsFor(m, orderedSelection(sel, list ?? []));
    if (noteIds.length > 0) useExport.getState().show({ noteIds });
  };

  /** The sidebar's Add to or Remove from Selected Notes. */
  const tagSelected = async (tag: string, remove: boolean) => {
    const { mode: m, selection: sel, ids: list } = state.current;
    const rows = m ? orderedSelection(sel, list ?? []) : [];
    if (rows.length === 0) {
      toast(tr("browsing-no-selection"));
      return;
    }
    try {
      const noteIds = await noteIdsFor(m!, rows);
      const out = remove ? await core.removeNoteTags({ noteIds, tags: tag }) : await core.addNoteTags({ noteIds, tags: tag });
      toast(tr("browsing-notes-updated", { count: out.count }));
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const focusEditor = () => {
    const target = editorPane.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea, input:not([type="checkbox"])');
    target?.focus();
  };

  const runAction = useCallback(
    (id: ActionId) => {
      const { ids: list, selection: sel } = state.current;
      switch (id) {
        case "focusSearch":
          searchField.current?.focus();
          searchField.current?.select();
          return;
        case "focusTable":
          table.current?.focus();
          return;
        case "focusEditor":
          focusEditor();
          return;
        case "toggleFilters":
          setFiltersOpen(!useBrowseLayout.getState().filtersOpen);
          return;
        case "toggleMode":
          void switchMode(state.current.mode === "cards" ? "notes" : "cards");
          return;
        case "selectAll":
          setSelection(selectAll(sel, list ?? []));
          return;
        case "invert":
          setSelection(invertSelection(sel, list ?? []));
          return;
        case "cardInfo": {
          const cardId = state.current.mode === "cards" ? sel.current : (currentRef.current?.card?.id ?? null);
          if (cardId !== null) openCardInfo(cardId);
          return;
        }
        case "changeNotetype":
          void changeNotetype();
          return;
        case "createFiltered":
          openFilteredDeck({ search: state.current.active ?? "" });
          return;
        case "exportNotes":
          void exportNotes();
          return;
        case "firstCard":
        case "lastCard": {
          const next = moveCursor(sel, list ?? [], id === "firstCard" ? -(list?.length ?? 0) : (list?.length ?? 0), false);
          setSelection(next);
          if (next.current !== null) table.current?.scrollToId(next.current);
          return;
        }
        case "zoomIn":
        case "zoomOut":
        case "zoomReset": {
          const { zoom, setZoom } = useBrowseLayout.getState();
          setZoom(stepZoom(zoom, id === "zoomIn" ? 1 : id === "zoomOut" ? -1 : 0));
          return;
        }
        case "next":
        case "prev": {
          const next = moveCursor(sel, list ?? [], id === "next" ? 1 : -1, false);
          setSelection(next);
          if (next.current !== null) table.current?.scrollToId(next.current);
          return;
        }
        default:
          runCore(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runCore, setFiltersOpen, switchMode],
  );

  // Anki's browser shortcuts, while this screen is shown.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      const id = actionForKey(e);
      if (!id) return;
      const typing = isEditable(e.target);
      if (typing && !WHILE_TYPING.has(id)) return;
      if (id === "delete" && !(e.target as HTMLElement | null)?.closest?.("[role=grid]")) return;
      e.preventDefault();
      e.stopPropagation();
      runAction(id);
    };
    // Capture, so Ctrl+F reaches this screen's search before the app toolbar's.
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [runAction]);

  /* ------------------------------ Menus ------------------------------ */

  const card = current?.card ?? null;
  const flag = card ? card.flags & 7 : 0;
  const hasSelection = selection.selected.size > 0;

  const actionLabel = (id: ActionId): string => {
    switch (id) {
      case "preview":
        return tr("actions-preview");
      case "changeDeck":
        return tr("browsing-change-deck");
      case "setDue":
        return tr("actions-set-due-date");
      case "forget":
        return trLabel("qt-accel-forget");
      case "reposition":
        return tr("actions-reposition");
      case "toggleSuspend":
        return tr("browsing-toggle-suspend");
      case "toggleBury":
        return tr("browsing-toggle-bury");
      case "addTags":
        return plainLabel(tr("browsing-add-tags2"));
      case "removeTags":
        return plainLabel(tr("browsing-remove-tags"));
      case "toggleMark":
        return tr("browsing-toggle-mark");
      case "findReplace":
        return tr("browsing-find-and-replace");
      case "delete":
        return tr("browsing-delete-notes");
      case "cardInfo":
        return tr("actions-card-info");
      case "changeNotetype":
        return plainLabel(tr("browsing-change-note-type2"));
      case "createFiltered":
        return plainLabel(tr("qt-misc-create-filtered-deck"));
      case "exportNotes":
        return trLabel("qt-accel-export-notes");
      case "gradeNow":
        return tr("actions-grade-now");
      case "createCopy":
        return tr("actions-create-copy");
      case "findDuplicates":
        return tr("browsing-find-duplicates");
      case "clearUnusedTags":
        return tr("browsing-clear-unused-tags");
      case "firstCard":
        return tr("browsing-first-card");
      case "lastCard":
        return tr("browsing-last-card");
      case "zoomIn":
        return trLabel("qt-accel-zoom-in");
      case "zoomOut":
        return trLabel("qt-accel-zoom-out");
      case "zoomReset":
        return trLabel("qt-accel-reset-zoom");
      default:
        return id;
    }
  };

  const icons: Partial<Record<ActionId, ReactNode>> = {
    preview: <Eye />,
    cardInfo: <Info />,
    changeNotetype: <FileCog />,
    createFiltered: <FilterIcon />,
    exportNotes: <Upload />,
    gradeNow: <GraduationCap />,
    createCopy: <CopyPlus />,
    findDuplicates: <Files />,
    clearUnusedTags: <Eraser />,
    firstCard: <ArrowUpToLine />,
    lastCard: <ArrowDownToLine />,
    zoomIn: <ZoomIn />,
    zoomOut: <ZoomOut />,
    changeDeck: <FolderInput />,
    setDue: <CalendarClock />,
    forget: <RotateCcw />,
    reposition: <ListOrdered />,
    toggleSuspend: <CirclePause />,
    toggleBury: <EyeOff />,
    addTags: <Tag />,
    removeTags: <Tags />,
    toggleMark: <Star />,
    findReplace: <Replace />,
    delete: <Trash2 />,
  };

  const checks: Partial<Record<ActionId, boolean>> = {
    toggleSuspend: isSuspended(card),
    toggleBury: isBuried(card),
    toggleMark: !!current?.marked,
  };

  const groups: ActionId[][] = [
    ["preview", "cardInfo"],
    ["changeDeck", "changeNotetype", "createCopy", "setDue", "forget", "gradeNow", "reposition"],
    ["toggleSuspend", "toggleBury"],
    ["addTags", "removeTags", "toggleMark", "findReplace"],
    ["exportNotes", "delete"],
  ];

  const flagIcon = (n: number) => <Flag style={{ color: `var(--flag-${n})`, fill: `var(--flag-${n})` }} />;
  const flagIds = [1, 2, 3, 4, 5, 6, 7] as const;

  const rowMenu = (
    <>
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <CtxSeparator />}
          {group.map((id) =>
            id in checks ? (
              <CtxCheck key={id} checked={!!checks[id]} onSelect={() => runAction(id)} shortcut={keyLabel(id)}>
                {actionLabel(id)}
              </CtxCheck>
            ) : (
              <CtxItem key={id} onSelect={() => runAction(id)} shortcut={keyLabel(id)} danger={id === "delete"}>
                {icons[id]}
                {actionLabel(id)}
              </CtxItem>
            ),
          )}
          {gi === 2 && (
            <CtxSub label={tr("browsing-flag")} icon={<Flag />}>
              {flagIds.map((n) => (
                <CtxCheck key={n} checked={flag === n} onSelect={() => runAction(`flag${n}`)} shortcut={keyLabel(`flag${n}`)}>
                  {flagLabels?.[n - 1] ?? tr("actions-flag-number", { number: n })}
                </CtxCheck>
              ))}
            </CtxSub>
          )}
        </div>
      ))}
    </>
  );

  const moreMenu = (
    <MenuContent>
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <MenuSeparator />}
          {group.map((id) =>
            id in checks ? (
              <MenuCheckItem key={id} checked={!!checks[id]} onSelect={() => runAction(id)}>
                {actionLabel(id)}
              </MenuCheckItem>
            ) : (
              <MenuItem key={id} onSelect={() => runAction(id)} shortcut={keyLabel(id)} danger={id === "delete"} disabled={!hasSelection}>
                {icons[id]}
                {actionLabel(id)}
              </MenuItem>
            ),
          )}
        </div>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={() => runAction("createFiltered")} shortcut={keyLabel("createFiltered")}>
        <FilterIcon />
        {actionLabel("createFiltered")}
      </MenuItem>
      <MenuItem onSelect={() => runAction("findDuplicates")}>
        {icons.findDuplicates}
        {actionLabel("findDuplicates")}
      </MenuItem>
      <MenuItem onSelect={() => runAction("clearUnusedTags")}>
        {icons.clearUnusedTags}
        {actionLabel("clearUnusedTags")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => runAction("firstCard")} shortcut={keyLabel("firstCard")} disabled={!ids?.length}>
        {icons.firstCard}
        {actionLabel("firstCard")}
      </MenuItem>
      <MenuItem onSelect={() => runAction("lastCard")} shortcut={keyLabel("lastCard")} disabled={!ids?.length}>
        {icons.lastCard}
        {actionLabel("lastCard")}
      </MenuItem>
      <MenuSeparator />
      <SubMenu label={trLabel("qt-accel-layout")} icon={<PanelBottom />}>
        {(["auto", "vertical", "horizontal"] as const).map((value) => (
          <MenuCheckItem key={value} checked={layout === value} onSelect={() => setLayout(value)}>
            {trLabel(`qt-accel-layout-${value}`)}
          </MenuCheckItem>
        ))}
      </SubMenu>
      {(["zoomIn", "zoomOut", "zoomReset"] as const).map((id) => (
        <MenuItem key={id} onSelect={() => runAction(id)} shortcut={keyLabel(id)}>
          {icons[id]}
          {actionLabel(id)}
        </MenuItem>
      ))}
      <SubMenu label={tb("columns")} icon={<Columns3 />}>
        <div className="max-h-[60vh] overflow-y-auto">
          {[...(allColumns ?? [])]
            .map((c) => ({ key: c.key, label: mode === "notes" ? c.notesModeLabel : c.cardsModeLabel }))
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((c) => (
              <MenuCheckItem key={c.key} checked={columns.includes(c.key)} onSelect={() => void onToggleColumn(c.key)}>
                {c.label}
              </MenuCheckItem>
            ))}
        </div>
      </SubMenu>
    </MenuContent>
  );

  /* ------------------------------ Layout ------------------------------ */

  const startEditorResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const box = body.current?.getBoundingClientRect();
    if (!box) return;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      below ? setEditorFractionBelow((box.bottom - ev.clientY) / box.height) : setEditorFraction((box.right - ev.clientX) / box.width);
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const storedWidths = useBrowseLayout((s) => (mode ? s.widths[mode] : undefined));
  const tableNeed = columns.reduce((sum, key) => sum + (storedWidths?.[key] ?? defaultWidth(key)), 0);
  const editorPx = editorWidth(bodyWidth, editorFraction, tableNeed);
  const editorStyle = below
    ? { height: bodySize.height > 0 ? Math.round(bodySize.height * editorFractionBelow) : `${editorFractionBelow * 100}%`, minHeight: 160 }
    : { width: bodyWidth > 0 ? editorPx : `${editorFraction * 100}%`, minWidth: EDITOR_MIN };

  const single = selection.selected.size === 1 ? [...selection.selected][0] : null;
  const editorNoteId = mode === "notes" ? single : single !== null && current?.card?.id === single ? current.noteId : null;
  const total = ids?.length ?? 0;
  const countText = mode === "notes" ? tr("browsing-note-count", { count: total }) : tr("card-templates-card-count", { count: total });
  const collectionEmpty = (active ?? "").trim() === "" || active === "deck:*";

  const empty = (
    <div className="max-w-[420px] text-center">
      <p className="text-body font-medium text-ink">
        {tr(collectionEmpty ? "browsing-empty-collection-title" : "browsing-empty-no-match-title", { "notes-mode": mode === "notes" ? "yes" : "no" })}
      </p>
      {!collectionEmpty && (
        <>
          <p className="selectable mt-2 break-words font-mono text-caption text-ink-3">{active}</p>
          <Button size="sm" className="mt-4" onClick={() => submitSearch("")}>
            {tr("browsing-empty-clear-search")}
          </Button>
        </>
      )}
    </div>
  );

  const shortcutTitle = (id: ActionId) => `${actionLabel(id)} (${keyLabel(id)})`;

  return (
    <div className="flex h-full min-h-0">
      {filtersOpen && (
        <aside className="w-[220px] shrink-0 border-r border-line bg-sidebar-pane">
          <FilterSidebar search={active ?? ""} onSearch={submitSearch} onTagNotes={(tag, remove) => void tagSelected(tag, remove)} />
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
          <IconButton
            label={`${filtersOpen ? tb("hideFilters") : tb("showFilters")} (${keyLabel("toggleFilters")})`}
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <PanelLeft />
          </IconButton>
          <form
            role="search"
            className="relative min-w-[160px] max-w-[560px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(text);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <TextField
              ref={searchField}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  table.current?.focus();
                }
              }}
              placeholder={tr("browsing-search-bar-hint")}
              aria-label={tr("actions-search")}
              aria-invalid={!!searchError}
              aria-describedby={searchError ? "browse-search-error" : undefined}
              spellCheck={false}
              className="ps-8 pe-8"
            />
            {searching && <Spinner className="absolute right-2.5 top-1/2 -translate-y-1/2" />}
          </form>
          <Segmented
            label={tr("browsing-toggle-showing-cards-notes")}
            value={mode ?? "cards"}
            onChange={(m) => void switchMode(m)}
            options={[
              { value: "cards", label: tr("browsing-cards") },
              { value: "notes", label: tr("browsing-notes") },
            ]}
          />
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton label={shortcutTitle("preview")} disabled={!hasSelection} onClick={() => runAction("preview")}>
              <Eye />
            </IconButton>
            <IconButton label={shortcutTitle("cardInfo")} disabled={!hasSelection} onClick={() => runAction("cardInfo")}>
              <Info />
            </IconButton>
            <IconButton label={shortcutTitle("changeDeck")} disabled={!hasSelection} onClick={() => runAction("changeDeck")}>
              <FolderInput />
            </IconButton>
            <Menu>
              <MenuTrigger asChild disabled={!hasSelection}>
                <IconButton label={tr("browsing-flag")} disabled={!hasSelection}>
                  {flag ? flagIcon(flag) : <Flag />}
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{tr("browsing-flag")}</MenuLabel>
                {flagIds.map((n) => (
                  <MenuItem key={n} onSelect={() => runAction(`flag${n}`)} shortcut={keyLabel(`flag${n}`)}>
                    {flagIcon(n)}
                    {flagLabels?.[n - 1] ?? tr("actions-flag-number", { number: n })}
                  </MenuItem>
                ))}
                {flag > 0 && (
                  <>
                    <MenuSeparator />
                    <MenuItem onSelect={() => runAction(`flag${flag}` as ActionId)}>
                      <FlagOff />
                      {tb("flagNone")}
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
            <IconButton
              label={shortcutTitle("toggleSuspend")}
              aria-pressed={isSuspended(card)}
              disabled={!hasSelection}
              onClick={() => runAction("toggleSuspend")}
              className={cn(isSuspended(card) && "bg-accent-soft text-accent-ink")}
            >
              <CirclePause />
            </IconButton>
            <IconButton
              label={shortcutTitle("toggleMark")}
              aria-pressed={!!current?.marked}
              disabled={!hasSelection}
              onClick={() => runAction("toggleMark")}
              className={cn(current?.marked && "bg-accent-soft text-accent-ink")}
            >
              <Star />
            </IconButton>
            <IconButton label={shortcutTitle("delete")} disabled={!hasSelection} onClick={() => runAction("delete")}>
              <Trash2 />
            </IconButton>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={t("study.more")}>
                  <MoreHorizontal />
                </IconButton>
              </MenuTrigger>
              {moreMenu}
            </Menu>
          </div>
        </div>

        {searchError && (
          <p id="browse-search-error" role="alert" className="selectable shrink-0 border-b border-line bg-[color-mix(in_oklab,var(--danger)_7%,transparent)] px-4 py-1.5 text-caption text-danger">
            {searchError}
          </p>
        )}

        <div ref={body} className={cn("flex min-h-0 flex-1", below && "flex-col")}>
          <section className="min-h-0 min-w-0 flex-1" aria-label={mode === "notes" ? tr("browsing-notes") : tr("browsing-cards")}>
            {mode && allColumns ? (
              <Table
                ref={table}
                mode={mode}
                columns={columns}
                allColumns={allColumns}
                ids={ids}
                generation={generation}
                ready={generation > 0}
                selection={selection}
                onSelection={setSelection}
                sort={sort}
                onSort={onSort}
                onToggleColumn={(key) => void onToggleColumn(key)}
                rowMenu={rowMenu}
                onEnter={focusEditor}
                empty={empty}
              />
            ) : (
              <div className="grid h-full place-items-center">
                <Spinner className="size-5" />
              </div>
            )}
          </section>

          <div
            role="separator"
            aria-orientation={below ? "horizontal" : "vertical"}
            aria-label={tb("resizePane")}
            onPointerDown={startEditorResize}
            onDoubleClick={() => (below ? setEditorFractionBelow(0.5) : setEditorFraction(0.4))}
            className={cn("group relative shrink-0 bg-line", below ? "h-px cursor-row-resize" : "w-px cursor-col-resize")}
          >
            <span
              className={cn(
                "absolute transition-colors duration-[var(--dur-fast)] group-hover:bg-accent-soft",
                below ? "inset-x-0 -bottom-1 -top-1" : "inset-y-0 -left-1 -right-1",
              )}
            />
          </div>

          <aside
            ref={editorPane}
            className="shrink-0 overflow-hidden bg-bg"
            style={editorStyle}
          >
            {editorNoteId !== null ? (
              <NoteEditor key={String(editorNoteId)} noteId={editorNoteId} />
            ) : (
              <div className="grid h-full place-items-center px-8 text-center">
                <div>
                  <p className="tabular text-body font-medium text-ink">
                    {selection.selected.size > 1 ? tb("selected", { count: selection.selected.size }) : tb("nothingSelected")}
                  </p>
                  {selection.selected.size > 1 && <p className="mt-1.5 text-caption leading-relaxed text-ink-3">{tb("selectedLead")}</p>}
                </div>
              </div>
            )}
          </aside>
        </div>

        <footer className="tabular flex h-7 shrink-0 items-center gap-3 border-t border-line px-4 text-caption text-ink-3">
          <span>{ids ? countText : ""}</span>
          {selection.selected.size > 0 && <span>{tb("selected", { count: selection.selected.size })}</span>}
        </footer>
      </div>

      {actions.dialogs}
    </div>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The card and note table: virtualized 32px rows with a sticky header,
 * sortable and resizable columns, a column picker on the header's context
 * menu, and Finder-style multi-selection from the pointer and the keyboard.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "@/components/ui";
import {
  BrowserColumns_Alignment,
  BrowserColumns_Sorting,
  BrowserRow_Color,
  type BrowserColumns_Column,
} from "@/lib/anki/proto/anki/search_pb";
import { tr } from "@/lib/i18n";
import { tb } from "@/lib/strings/browse";

import type { Mode, Sort } from "./config";
import { CtxCheck, CtxContent, CtxLabel, CtxRoot, CtxTrigger } from "./menus";
import { useRow } from "./rows";
import { clickRow, contextRow, moveCursor, selectAll, type Selection } from "./selection";
import { defaultWidth, MIN_WIDTH, useBrowseLayout, gridTemplate } from "./store";

export const ROW_HEIGHT = 32;

/** Row height at a zoom factor; the header and rows scale with it, as in Anki's table. */
export function rowHeightAt(zoom: number): number {
  return Math.round(ROW_HEIGHT * zoom);
}

const FLAG_TINTS: Partial<Record<BrowserRow_Color, number>> = {
  [BrowserRow_Color.FLAG_RED]: 1,
  [BrowserRow_Color.FLAG_ORANGE]: 2,
  [BrowserRow_Color.FLAG_GREEN]: 3,
  [BrowserRow_Color.FLAG_BLUE]: 4,
  [BrowserRow_Color.FLAG_PINK]: 5,
  [BrowserRow_Color.FLAG_TURQUOISE]: 6,
  [BrowserRow_Color.FLAG_PURPLE]: 7,
};

/** A subtle background for Anki's row colours, from the theme's tokens. */
function rowTint(color: BrowserRow_Color | undefined): { background?: string; stripe?: string } {
  if (color === undefined || color === BrowserRow_Color.DEFAULT) return {};
  const flag = FLAG_TINTS[color];
  if (flag) {
    return { background: `color-mix(in oklab, var(--flag-${flag}) var(--tint-row), transparent)`, stripe: `var(--flag-${flag})` };
  }
  switch (color) {
    case BrowserRow_Color.MARKED:
      return { background: "color-mix(in oklab, var(--marked) var(--tint-row), transparent)" };
    case BrowserRow_Color.SUSPENDED:
      return { background: "color-mix(in oklab, var(--suspended) var(--tint-row), transparent)" };
    case BrowserRow_Color.BURIED:
      return { background: "color-mix(in oklab, var(--buried) var(--tint-row), transparent)" };
    default:
      return {};
  }
}

export interface TableHandle {
  focus(): void;
  scrollToId(id: bigint): void;
}

interface Props {
  mode: Mode;
  /** Active column keys, in order. */
  columns: string[];
  allColumns: BrowserColumns_Column[];
  ids: bigint[] | null;
  generation: number;
  /** Rows are fetched only once the core has this mode's columns. */
  ready: boolean;
  selection: Selection;
  onSelection: (selection: Selection) => void;
  sort: Sort;
  onSort: (column: string) => void;
  onToggleColumn: (column: string) => void;
  rowMenu: ReactNode;
  onEnter: () => void;
  empty: ReactNode;
}

export const Table = forwardRef<TableHandle, Props>(function Table(
  { mode, columns, allColumns, ids, generation, ready, selection, onSelection, sort, onSort, onToggleColumn, rowMenu, onEnter, empty },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const storedWidths = useBrowseLayout((s) => s.widths[mode]);
  const setWidth = useBrowseLayout((s) => s.setWidth);
  const zoom = useBrowseLayout((s) => s.zoom);
  const rowHeight = rowHeightAt(zoom);
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null);

  const byKey = useMemo(() => new Map(allColumns.map((c) => [c.key, c])), [allColumns]);
  const widths = columns.map((key) => (drag?.key === key ? drag.width : (storedWidths[key] ?? defaultWidth(key))));
  const total = widths.reduce((a, b) => a + b, 0);
  const template = gridTemplate(columns, widths);

  const list = ids ?? [];
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    // The sticky header sits above the first row.
    paddingStart: rowHeight,
    scrollPaddingStart: rowHeight,
    getItemKey: (index) => String(list[index]),
  });

  // A new zoom changes every row's size.
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  const scrollToIndex = useCallback((index: number) => virtualizer.scrollToIndex(index, { align: "auto" }), [virtualizer]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => scroller.current?.focus(),
      scrollToId: (id) => {
        const index = list.indexOf(id);
        if (index >= 0) scrollToIndex(index);
      },
    }),
    [list, scrollToIndex],
  );

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const onRowPointer = useCallback(
    (index: number, e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      scroller.current?.focus({ preventScroll: true });
      onSelection(clickRow(selectionRef.current, list, index, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }));
    },
    [list, onSelection],
  );

  const onRowContext = useCallback(
    (index: number) => {
      scroller.current?.focus({ preventScroll: true });
      onSelection(contextRow(selectionRef.current, list, index));
    },
    [list, onSelection],
  );

  const pageRows = () => Math.max(1, Math.floor((scroller.current?.clientHeight ?? 320) / rowHeight) - 2);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || list.length === 0) return;
    const mod = e.ctrlKey || e.metaKey;
    let delta: number | null = null;
    switch (e.key) {
      case "ArrowDown":
        delta = 1;
        break;
      case "ArrowUp":
        delta = -1;
        break;
      case "PageDown":
        delta = pageRows();
        break;
      case "PageUp":
        delta = -pageRows();
        break;
      case "Home":
        delta = -list.length;
        break;
      case "End":
        delta = list.length;
        break;
      case "a":
      case "A":
        if (mod && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          onSelection(selectAll(selection, list));
        }
        return;
      case "Enter":
        e.preventDefault();
        onEnter();
        return;
      default:
        return;
    }
    if (mod) return;
    e.preventDefault();
    const next = moveCursor(selection, list, delta, e.shiftKey);
    onSelection(next);
    if (next.current !== null) scrollToIndex(list.indexOf(next.current));
  };

  // Keep the current row visible when the list changes under it (a new sort).
  useEffect(() => {
    if (selection.current === null || !ids) return;
    const index = ids.indexOf(selection.current);
    if (index >= 0) scrollToIndex(index);
    // Only when the list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const startResize = (key: string, startWidth: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      width = Math.max(MIN_WIDTH, startWidth + ev.clientX - startX);
      setDrag({ key, width });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setWidth(mode, key, width);
      setDrag(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const label = (c: BrowserColumns_Column | undefined, key: string) =>
    c ? (mode === "notes" ? c.notesModeLabel : c.cardsModeLabel) : key;
  const tooltip = (c: BrowserColumns_Column | undefined) => (c ? (mode === "notes" ? c.notesModeTooltip : c.cardsModeTooltip) : "");
  const sortingOf = (c: BrowserColumns_Column | undefined) =>
    c ? (mode === "notes" ? c.sortingNotes : c.sortingCards) : BrowserColumns_Sorting.NONE;

  const pickerColumns = useMemo(
    () => [...allColumns].sort((a, b) => label(a, a.key).localeCompare(label(b, b.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allColumns, mode],
  );

  const header = (
    <CtxRoot>
      <CtxTrigger asChild>
        <div
          role="row"
          className="sticky top-0 z-10 grid h-[var(--row-h)] border-b border-line bg-surface text-[length:var(--head-font)] font-medium leading-[1.45] text-ink-2"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((key, i) => {
            const c = byKey.get(key);
            const sorted = sort.column === key;
            const sortable = sortingOf(c) !== BrowserColumns_Sorting.NONE;
            const center = c?.alignment === BrowserColumns_Alignment.CENTER;
            return (
              <div
                key={key}
                role="columnheader"
                aria-sort={sorted ? (sort.reverse ? "descending" : "ascending") : undefined}
                className="relative min-w-0"
              >
                <button
                  tabIndex={-1}
                  onClick={() => onSort(key)}
                  title={tooltip(c) || label(c, key)}
                  className={cn(
                    "flex h-full w-full min-w-0 items-center gap-1 px-3 outline-none transition-colors duration-[var(--dur-fast)]",
                    center ? "justify-center" : "justify-start",
                    sortable ? "hover:bg-surface-2 hover:text-ink" : "cursor-default",
                    sorted && "text-ink",
                  )}
                >
                  <span className="truncate">{label(c, key)}</span>
                  {sorted &&
                    (sort.reverse ? (
                      <ChevronDown aria-label={tb("sortDescending")} className="size-3.5 shrink-0 text-accent" />
                    ) : (
                      <ChevronUp aria-label={tb("sortAscending")} className="size-3.5 shrink-0 text-accent" />
                    ))}
                </button>
                {i < columns.length - 1 && <span aria-hidden className="pointer-events-none absolute right-0 top-2 h-4 w-px bg-line" />}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={tb("resizeColumn")}
                  onPointerDown={startResize(key, widths[i])}
                  onDoubleClick={() => setWidth(mode, key, defaultWidth(key))}
                  className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                />
              </div>
            );
          })}
        </div>
      </CtxTrigger>
      <CtxContent>
        <CtxLabel>{tb("columns")}</CtxLabel>
        <div className="max-h-[60vh] overflow-y-auto">
          {pickerColumns.map((c) => (
            <CtxCheck key={c.key} checked={columns.includes(c.key)} onSelect={() => onToggleColumn(c.key)}>
              {label(c, c.key)}
            </CtxCheck>
          ))}
        </div>
      </CtxContent>
    </CtxRoot>
  );

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scroller}
      role="grid"
      tabIndex={0}
      aria-multiselectable
      aria-rowcount={list.length + 1}
      aria-activedescendant={selection.current !== null && ids ? `browse-row-${selection.current}` : undefined}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && setFocused(true)}
      onBlur={(e) => e.target === e.currentTarget && setFocused(false)}
      className="tabular relative h-full overflow-auto outline-none [contain:strict]"
      style={{ "--row-h": `${rowHeight}px`, "--cell-font": `${13 * zoom}px`, "--head-font": `${12 * zoom}px` } as CSSProperties}
    >
      <div style={{ minWidth: total, height: ids && list.length > 0 ? virtualizer.getTotalSize() : "100%" }} className="relative">
        {header}
        {ids === null ? (
          <Skeleton template={template} count={columns.length} />
        ) : list.length === 0 ? (
          <div className="absolute inset-x-0 bottom-0 top-[var(--row-h)] grid place-items-center px-6">{empty}</div>
        ) : (
          <CtxRoot>
            <CtxTrigger asChild>
              <div role="rowgroup" className="absolute inset-x-0 top-0" style={{ height: virtualizer.getTotalSize() }}>
                {items.map((item) => {
                  const id = list[item.index];
                  return (
                    <Row
                      key={item.key}
                      id={id}
                      index={item.index}
                      start={item.start}
                      template={template}
                      columns={columns}
                      byKey={byKey}
                      generation={generation}
                      ready={ready}
                      selected={selection.selected.has(id)}
                      current={selection.current === id}
                      focused={focused}
                      onPointer={onRowPointer}
                      onContext={onRowContext}
                    />
                  );
                })}
              </div>
            </CtxTrigger>
            <CtxContent>{rowMenu}</CtxContent>
          </CtxRoot>
        )}
      </div>
    </div>
  );
});

const Row = memo(function Row({
  id,
  index,
  start,
  template,
  columns,
  byKey,
  generation,
  ready,
  selected,
  current,
  focused,
  onPointer,
  onContext,
}: {
  id: bigint;
  index: number;
  start: number;
  template: string;
  columns: string[];
  byKey: Map<string, BrowserColumns_Column>;
  generation: number;
  ready: boolean;
  selected: boolean;
  current: boolean;
  focused: boolean;
  onPointer: (index: number, e: ReactMouseEvent) => void;
  onContext: (index: number) => void;
}) {
  const { data, isError, isPending } = useRow(generation, id, ready);
  const tint = rowTint(data?.color);
  const font = data?.fontName || undefined;

  return (
    <div
      id={`browse-row-${id}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      onMouseDown={(e) => onPointer(index, e)}
      onContextMenu={() => onContext(index)}
      className={cn(
        "group absolute inset-x-0 top-0 grid h-[var(--row-h)] items-center text-[length:var(--cell-font)] leading-[1.45] text-ink",
        "border-b border-line-soft",
        selected ? (focused ? "bg-[var(--selection)]" : "bg-accent-soft") : "hover:bg-surface-2",
        current && focused && "shadow-ring-inset",
      )}
      style={{
        gridTemplateColumns: template,
        transform: `translateY(${start}px)`,
        backgroundColor: !selected && tint.background ? tint.background : undefined,
      }}
    >
      {tint.stripe && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tint.stripe }} />}
      {isError ? (
        <div role="gridcell" className="col-span-full truncate px-3 text-ink-3">
          {tr("browsing-row-deleted")}
        </div>
      ) : isPending || !data ? (
        columns.map((key) => (
          <div key={key} role="gridcell" className="px-3">
            <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-surface-3" />
          </div>
        ))
      ) : (
        columns.map((key, i) => {
          const cell = data.cells[i];
          const c = byKey.get(key);
          const text = cell?.text ?? "";
          return (
            <div
              key={key}
              role="gridcell"
              title={text || undefined}
              dir={cell?.isRtl ? "rtl" : undefined}
              className={cn("min-w-0 truncate px-3", c?.alignment === BrowserColumns_Alignment.CENTER && "text-center")}
              style={c?.usesCellFont && font ? { fontFamily: font } : undefined}
            >
              {text}
            </div>
          );
        })
      )}
    </div>
  );
});

function Skeleton({ template, count }: { template: string; count: number }) {
  return (
    <div aria-busy className="absolute inset-x-0 top-[var(--row-h)]">
      {Array.from({ length: 14 }, (_, r) => (
        <div key={r} className="grid h-[var(--row-h)] items-center border-b border-line-soft" style={{ gridTemplateColumns: template }}>
          {Array.from({ length: count }, (_, c) => (
            <div key={c} className="px-3">
              <span
                className="block h-2.5 animate-pulse rounded-full bg-surface-3"
                style={{ width: `${40 + ((r * 7 + c * 13) % 45)}%`, animationDelay: `${r * 40}ms` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

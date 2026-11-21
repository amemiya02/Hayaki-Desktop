// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The sidebar's building blocks: a collapsible section and a row that can rename, drag and take drops. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { ConfigKey_Bool } from "@/lib/anki/proto/anki/config_pb";
import { tr } from "@/lib/i18n";
import type { TargetState } from "@/lib/pointer-drag";

import { CtxContent, CtxRoot, CtxTrigger } from "./menus";

/**
 * How a row takes part in a pointer drag (`@/lib/pointer-drag`): it is a drop
 * target under `key`, and a drag source when it has `handlers`.
 */
export interface Dnd {
  /** The drop target attribute of this kind of drag. */
  attribute: string;
  key: string;
  /** The kind's `useTarget`; read as `state` so it is not mistaken for a hook call site. */
  state: (key: string) => TargetState;
  handlers?: { onPointerDown: (e: PointerEvent<HTMLElement>) => void };
}

const IDLE: TargetState = { dragging: false, over: false, valid: false, isSource: false };

export interface RenameProps {
  editing: boolean;
  value: string;
  onStart: () => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

const dropClass = "bg-accent-soft shadow-ring-inset";

function dndAttrs(dnd: Dnd | undefined) {
  return dnd ? { [dnd.attribute]: dnd.key } : undefined;
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

export function Section({
  label,
  icon,
  collapseKey,
  children,
  action,
  menu,
  dnd,
}: {
  label: string;
  icon: ReactNode;
  collapseKey: ConfigKey_Bool;
  children: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  dnd?: Dnd;
}) {
  const drop = dnd ? dnd.state(dnd.key) : IDLE;
  const [collapsed, toggle] = useCollapsed(collapseKey);
  const header = (
    <div
      {...dndAttrs(dnd)}
      className={cn("group flex h-7 items-center rounded-[6px] pr-1 transition-colors duration-[var(--dur-fast)]", drop.valid && dropClass)}
    >
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
  );
  return (
    <section className="mt-1">
      {menu ? (
        <CtxRoot>
          <CtxTrigger asChild>{header}</CtxTrigger>
          <CtxContent>{menu}</CtxContent>
        </CtxRoot>
      ) : (
        header
      )}
      {!collapsed && <ul role="group">{children}</ul>}
    </section>
  );
}

/** An in-place name editor: Enter or leaving the field saves, Escape cancels. */
function RenameField({ value, label, onCommit, onCancel }: { value: string; label: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const mountedAt = useRef(performance.now());
  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    focus();
    // A context menu hands focus back to its row as it closes; take it again.
    const retry = window.setTimeout(() => {
      if (!done.current && document.activeElement !== input.current) focus();
    }, 120);
    return () => window.clearTimeout(retry);
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(input.current?.value ?? value);
    else onCancel();
  };
  return (
    <input
      ref={input}
      defaultValue={value}
      aria-label={label}
      spellCheck={false}
      onBlur={() => performance.now() - mountedAt.current > 150 && finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      className="h-6 min-w-0 flex-1 rounded-[5px] border border-accent bg-surface px-1.5 text-control text-ink outline-none shadow-ring"
    />
  );
}

export function Item({
  label,
  icon,
  depth = 0,
  active,
  title,
  onClick,
  expanded,
  onToggle,
  trailing,
  menu,
  rename,
  onDelete,
  dnd,
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
  menu?: ReactNode;
  rename?: RenameProps;
  onDelete?: () => void;
  dnd?: Dnd;
}) {
  const drop = dnd ? dnd.state(dnd.key) : IDLE;
  const row = (
    <div
      {...dndAttrs(dnd)}
      {...(rename?.editing ? undefined : dnd?.handlers)}
      className={cn(
        "group flex h-[28px] items-center rounded-[7px] pr-1 text-control transition-colors duration-[var(--dur-fast)]",
        active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sidebar-hover",
        drop.valid && dropClass,
        drop.over && !drop.valid && "cursor-not-allowed",
        drop.isSource && "opacity-45",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {onToggle ? (
        <button
          data-no-drag
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
      {rename?.editing ? (
        <>
          <span className="mr-2 pl-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0">{icon}</span>
          <RenameField value={rename.value} label={tr("actions-rename")} onCommit={rename.onCommit} onCancel={rename.onCancel} />
        </>
      ) : (
        <button
          data-sidebar-item
          aria-current={active ? "true" : undefined}
          aria-expanded={onToggle ? expanded : undefined}
          onClick={onClick}
          onKeyDown={(e: KeyboardEvent) => {
            if (onToggle && ((e.key === "ArrowRight" && !expanded) || (e.key === "ArrowLeft" && expanded))) {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            } else if (e.key === "F2" && rename) {
              e.preventDefault();
              rename.onStart();
            } else if (e.key === "Delete" && onDelete) {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }
          }}
          title={title ?? label}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[6px] pl-0.5 text-left outline-none focus-visible:shadow-ring-inset [&>svg]:size-3.5 [&>svg]:shrink-0"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      )}
      {!rename?.editing && trailing}
    </div>
  );
  return (
    <li>
      {menu ? (
        <CtxRoot>
          <CtxTrigger asChild>{row}</CtxTrigger>
          <CtxContent>{menu}</CtxContent>
        </CtxRoot>
      ) : (
        row
      )}
    </li>
  );
}

/** Up and Down move between sidebar entries. */
export function onTreeKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-sidebar-item]")];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

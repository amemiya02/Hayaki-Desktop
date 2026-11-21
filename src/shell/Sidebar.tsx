// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { BarChart3, ChevronRight, ChevronsUpDown, Filter, Layers, RefreshCw, Search, Settings, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cn, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, motionTokens } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";
import { SetDeckCollapsedRequest_Scope } from "@/lib/anki/proto/anki/decks_pb";
import { t, tr, trLabel } from "@/lib/i18n";
import { useNav, type Route } from "@/lib/nav";
import { leafName, useDeckTree } from "@/lib/queries";
import { useApp } from "@/lib/session-store";

function NavItem({
  icon,
  label,
  active,
  onClick,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={shortcut ? `${label} (${shortcut})` : undefined}
      className={cn(
        "group flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-start text-control font-medium",
        "transition-colors duration-[var(--dur-fast)] [&>svg]:size-4 [&>svg]:shrink-0",
        active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sidebar-hover [&>svg]:text-ink-2",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-4 text-caption font-semibold text-ink-2">{children}</div>;
}

/** A Deck tree's children open and close by height; reduced motion makes it instant. */
export function Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const m = motionTokens();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="children"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: m.base, ease: m.easeOut }, opacity: { duration: m.quick, ease: m.easeOut } }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DeckBranch({ node, depth, route }: { node: DeckTreeNode; depth: number; route: Route }) {
  const go = useNav((s) => s.go);
  const due = node.newCount + node.learnCount + node.reviewCount;
  const active = route.name === "deck" && route.deckId === node.deckId;
  const hasChildren = node.children.length > 0;

  const toggle = () =>
    void core.setDeckCollapsed(
      { deckId: node.deckId, collapsed: !node.collapsed, scope: SetDeckCollapsedRequest_Scope.REVIEWER },
      { origin: "sidebar" },
    );

  return (
    <li>
      <div
        className={cn(
          "group flex h-[30px] items-center rounded-[7px] pe-2 text-control transition-colors duration-[var(--dur-fast)]",
          active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-sidebar-hover",
        )}
        style={{ paddingInlineStart: 4 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            aria-label={node.collapsed ? "Expand" : "Collapse"}
            aria-expanded={!node.collapsed}
            onClick={toggle}
            className="grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:text-ink"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform duration-[var(--dur)] ease-out rtl:rotate-180", !node.collapsed && "rotate-90 rtl:rotate-90")}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          onClick={() => go({ name: "deck", deckId: node.deckId })}
          className="flex h-full min-w-0 flex-1 items-center gap-2 ps-1 text-start"
          title={node.name}
        >
          <span className={cn("min-w-0 flex-1 truncate", depth === 0 && "font-medium", node.filtered && "text-accent-ink")}>
            {leafName(node.name)}
          </span>
          {due > 0 && <span className={cn("tabular text-caption", active ? "text-accent-ink" : "text-ink-2")}>{due}</span>}
        </button>
      </div>
      {hasChildren && (
        <Expand open={!node.collapsed}>
          <ul>
            {node.children.map((child) => (
              <DeckBranch key={String(child.deckId)} node={child} depth={depth + 1} route={route} />
            ))}
          </ul>
        </Expand>
      )}
    </li>
  );
}

export function Sidebar({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const { data: tree } = useDeckTree();
  const profile = useApp((s) => s.profile);
  const switchProfile = useApp((s) => s.switchProfile);
  const decks = tree?.children ?? [];
  const regular = decks.filter((d) => !d.filtered);
  const filtered = decks.filter((d) => d.filtered);
  const name = profile?.name ?? "";

  return (
    <nav aria-label="Hayaki" className="flex h-full flex-col bg-sidebar-surface">
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-3">
        <NavItem icon={<Layers />} label={t("nav.decks")} shortcut="D" active={route.name === "decks"} onClick={() => go({ name: "decks" })} />
        <NavItem icon={<Search />} label={t("nav.browse")} shortcut="B" active={route.name === "browse"} onClick={() => go({ name: "browse" })} />
        <NavItem icon={<BarChart3 />} label={t("nav.stats")} shortcut="T" active={route.name === "stats"} onClick={() => go({ name: "stats" })} />

        {regular.length > 0 && (
          <>
            <GroupLabel>{t("nav.decks")}</GroupLabel>
            <ul>
              {regular.map((node) => (
                <DeckBranch key={String(node.deckId)} node={node} depth={0} route={route} />
              ))}
            </ul>
          </>
        )}
        {filtered.length > 0 && (
          <>
            <GroupLabel>
              <span className="inline-flex items-center gap-1.5">
                <Filter className="size-3" />
                {t("nav.filtered")}
              </span>
            </GroupLabel>
            <ul>
              {filtered.map((node) => (
                <DeckBranch key={String(node.deckId)} node={node} depth={0} route={route} />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-2.5 py-2">
        <Menu>
          <MenuTrigger asChild>
            <button
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1.5 text-start transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover"
              aria-label={`${tr("profiles-profiles")}: ${name}`}
            >
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-micro font-semibold text-on-accent">
                {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 flex-1 truncate text-control font-medium text-ink">{name}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" side="top">
            <MenuItem shortcut="Ctrl+Shift+P" onSelect={() => void switchProfile()}>
              <Users />
              {trLabel("qt-accel-switch-profile")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem shortcut="Ctrl+P" onSelect={() => go({ name: "settings" })}>
              <Settings />
              {t("nav.settings")}
            </MenuItem>
          </MenuContent>
        </Menu>
        <IconButton label={`${t("nav.sync")} (Y)`} size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw className={cn(syncing && "animate-spin")} />
        </IconButton>
        <IconButton
          label={`${t("nav.settings")} (Ctrl+P)`}
          size="sm"
          onClick={() => go({ name: "settings" })}
          className={cn(route.name === "settings" && "bg-accent-soft text-accent-ink")}
        >
          <Settings />
        </IconButton>
      </div>
    </nav>
  );
}

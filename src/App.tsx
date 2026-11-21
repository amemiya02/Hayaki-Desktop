// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Download, PanelLeft, Plus, Search } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppToaster, Button, cn, IconButton, Kbd, motionTokens, Spinner, TextField, TooltipProvider } from "@/components/ui";
import { t, tr } from "@/lib/i18n";
import { importPackage } from "@/lib/import";
import { useNav, type Route } from "@/lib/nav";
import { useCurrentDeck } from "@/lib/queries";
import { useApp } from "@/lib/session-store";
import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, usePrefs } from "@/lib/prefs";
import { ts } from "@/lib/strings/shell";
import { useAppearanceSync, useWindowMaterial } from "@/lib/useAppearance";
import { DeckOverview } from "@/screens/DeckOverview";
import { DecksScreen } from "@/screens/Decks";

import { StudyScreen } from "@/screens/Study";
import { displayChord } from "@/shell/shortcuts";
import { applyStoredZoom } from "@/shell/zoom";
import { Sidebar } from "@/shell/Sidebar";
import { SyncIndicator } from "@/shell/SyncIndicator";
import { useSyncAction } from "@/shell/Sync";
import { CommandPalette } from "@/shell/CommandPalette";
import { ExportDialog, useExport } from "@/shell/ExportDialog";
import { ProfileChooser } from "@/shell/ProfileChooser";
import { isWebViewAccelerator } from "@/shell/accelerators";
import { ShortcutsSheet } from "@/shell/ShortcutsSheet";
import { LifecycleHost } from "@/shell/Lifecycle";
import { ToolsHost } from "@/shell/Tools";
import { WindowHost } from "@/shell/WindowHost";
import { AnkiConnectHost } from "@/shell/AnkiConnectHost";
import { ConfirmHost } from "@/components/confirm";
import { CardInfoHost } from "@/screens/card-info";
import { FilteredHost } from "@/screens/filtered";

// The larger screens load on first use, so the app starts with only what Decks and Study need.
const AddScreen = lazy(() => import("@/screens/add/AddScreen").then((m) => ({ default: m.AddScreen })));
const BrowseScreen = lazy(() => import("@/screens/browse/Browse").then((m) => ({ default: m.BrowseScreen })));
const DeckOptionsScreen = lazy(() => import("@/screens/deck-options/DeckOptions").then((m) => ({ default: m.DeckOptionsScreen })));
const NotetypesScreen = lazy(() => import("@/screens/notetypes").then((m) => ({ default: m.NotetypesScreen })));
const NotetypeEditorScreen = lazy(() => import("@/screens/notetypes").then((m) => ({ default: m.NotetypeEditorScreen })));
const ChangeNotetypeScreen = lazy(() => import("@/screens/change-notetype").then((m) => ({ default: m.ChangeNotetypeScreen })));
const ImportCsvScreen = lazy(() => import("@/screens/import-csv").then((m) => ({ default: m.ImportCsvScreen })));
const ImageOcclusionScreen = lazy(() => import("@/screens/image-occlusion").then((m) => ({ default: m.ImageOcclusionScreen })));
const SettingsScreen = lazy(() => import("@/screens/Settings").then((m) => ({ default: m.SettingsScreen })));
const PackageImportHost = lazy(() => import("@/screens/import-csv/PackageImport").then((m) => ({ default: m.PackageImportHost })));
const StatsScreen = lazy(() => import("@/screens/stats/Stats").then((m) => ({ default: m.StatsScreen })));

function routeTitle(route: Route): string {
  switch (route.name) {
    case "decks":
    case "deck":
      return t("nav.decks");
    case "deck-options":
      return tr("deck-config-title");
    case "browse":
      return t("nav.browse");
    case "stats":
      return t("nav.stats");
    case "add":
      return t("nav.add");
    case "settings":
      return t("nav.settings");
    case "notetypes":
    case "notetype":
      return tr("notetypes-notetype");
    case "change-notetype":
      return tr("browsing-change-notetype");
    case "import-csv":
      return t("decks.import");
    case "image-occlusion":
      return tr("notetypes-image-occlusion-name");
    case "study":
      return "";
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function Toolbar() {
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const toggleSidebar = usePrefs((s) => s.toggleSidebar);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // `/` is Anki's Study Deck (see WindowHost); search keeps Ctrl+F.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !(e.ctrlKey && e.metaKey) && e.key.toLowerCase() === "f" && !isTyping(e.target)) {
        if (document.querySelector("[role=dialog]")) return;
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line ps-3 pe-5">
      <IconButton label={`${collapsed ? ts("showSidebar") : ts("hideSidebar")} (${displayChord("Ctrl+\\")})`} aria-pressed={!collapsed} onClick={toggleSidebar}>
        <PanelLeft />
      </IconButton>
      <h1 className="me-auto min-w-0 truncate text-title font-semibold text-ink">{routeTitle(route)}</h1>
      <SyncIndicator closedClassName="-ms-3" />
      <form
        role="search"
        hidden={route.name === "browse"}
        className="relative w-[260px] shrink"
        onSubmit={(e) => {
          e.preventDefault();
          go({ name: "browse", search: query });
          search.current?.blur();
        }}
      >
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <TextField
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQuery(""))}
          placeholder={tr("actions-search")}
          aria-label={tr("actions-search")}
          className="border-transparent bg-surface-2 ps-8 pe-8 hover:border-line"
        />
        <Kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2">{displayChord("Ctrl+F")}</Kbd>
      </form>
      <Button onClick={() => void importPackage()} title={`${t("decks.import")} (${displayChord("Ctrl+Shift+I")})`}>
        <Download />
        {t("decks.import")}
      </Button>
      <Button onClick={() => go({ name: "add" })} title={`${tr("actions-add")} (A)`}>
        <Plus />
        {tr("actions-add")}
      </Button>
    </header>
  );
}

/** Routes that share a key keep their screen mounted (Browse takes new searches in place). */
function routeKey(route: Route): string {
  switch (route.name) {
    case "deck":
    case "deck-options":
      return `${route.name}:${route.deckId}`;
    case "notetype":
      return `notetype:${route.notetypeId}`;
    case "import-csv":
      return `import-csv:${route.path}`;
    default:
      return route.name;
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "decks":
      return <DecksScreen />;
    case "deck":
      return <DeckOverview key={String(route.deckId)} deckId={route.deckId} />;
    case "study":
      return <StudyScreen deckId={route.deckId} />;
    case "settings":
      return <SettingsScreen />;
    case "deck-options":
      return <DeckOptionsScreen key={String(route.deckId)} deckId={route.deckId} />;
    case "browse":
      return <BrowseScreen search={route.search} />;
    case "stats":
      return <StatsScreen deckId={route.deckId} />;
    case "add":
      return <AddScreen />;
    case "notetypes":
      return <NotetypesScreen />;
    case "notetype":
      return <NotetypeEditorScreen key={String(route.notetypeId)} notetypeId={route.notetypeId} tab={route.tab} />;
    case "change-notetype":
      return <ChangeNotetypeScreen noteIds={route.noteIds} />;
    case "import-csv":
      return <ImportCsvScreen key={route.path} path={route.path} />;
    case "image-occlusion":
      return <ImageOcclusionScreen mode={route.mode} />;
  }
}

function useGlobalShortcuts() {
  const go = useNav((s) => s.go);
  const { data: current } = useCurrentDeck();
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const route = useNav.getState().route;
      const mod = e.ctrlKey || e.metaKey;
      // Chords, as in Anki's main window. Browse catches its own first (in the
      // capture phase), so these only see what that screen leaves alone.
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (e.code === "Backslash" && !e.shiftKey) {
          e.preventDefault();
          usePrefs.getState().toggleSidebar();
          return;
        }
        if (route.name === "study") return;
        let handled = true;
        if (!e.shiftKey && (e.key === "," || key === "p")) go({ name: "settings" });
        else if (e.shiftKey && key === "i") void importPackage();
        else if (e.shiftKey && key === "p") void useApp.getState().switchProfile();
        else if (e.shiftKey && key === "n") go({ name: "notetypes" });
        else if (!e.shiftKey && key === "e") useExport.getState().show();
        else handled = false;
        if (handled) e.preventDefault();
        return;
      }
      // Study and Browse own their single-key shortcuts.
      if (route.name === "study" || route.name === "browse") return;
      if (mod || e.altKey) return;
      switch (e.key) {
        case "d":
          go({ name: "decks" });
          break;
        case "a":
          go({ name: "add" });
          break;
        case "b":
          if (route.name !== "deck") go({ name: "browse" });
          break;
        case "t":
        case "T":
          go({ name: "stats" });
          break;
        case "s":
          if (route.name !== "deck" && current) go({ name: "study", deckId: current.id });
          break;
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [go, current]);
}

/** The draggable edge between the sidebar and the work area. */
function SidebarResizer({ width, onResizing }: { width: number; onResizing: (resizing: boolean) => void }) {
  const setWidth = usePrefs((s) => s.setSidebarWidth);

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    const startX = e.clientX;
    const rtl = document.documentElement.dir === "rtl";
    target.setPointerCapture(e.pointerId);
    onResizing(true);
    const move = (ev: PointerEvent) => setWidth(width + (rtl ? startX - ev.clientX : ev.clientX - startX));
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onResizing(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    const rtl = document.documentElement.dir === "rtl";
    if (e.key === "ArrowLeft") setWidth(width + (rtl ? step : -step));
    else if (e.key === "ArrowRight") setWidth(width + (rtl ? -step : step));
    else if (e.key === "Home") setWidth(SIDEBAR_MIN);
    else if (e.key === "End") setWidth(SIDEBAR_MAX);
    else if (e.key === "Enter") setWidth(SIDEBAR_DEFAULT);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ts("resizeSidebar")}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 z-20 -ms-[4px] w-[7px] cursor-col-resize outline-none focus-visible:outline-none"
      style={{ insetInlineStart: width }}
    >
      <span className="absolute inset-y-0 start-[3px] w-px transition-colors duration-[var(--dur-fast)] group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}

function Workspace() {
  const route = useNav((s) => s.route);
  const focus = route.name === "study";
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const width = clampSidebarWidth(usePrefs((s) => s.sidebarWidth));
  const [resizing, setResizing] = useState(false);
  const sync = useSyncAction();
  const m = motionTokens();
  useGlobalShortcuts();

  // Y syncs, as in Anki.
  const runSync = sync.run;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "y" && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        void runSync();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [runSync]);

  const hidden = focus || collapsed;

  return (
    <div
      className={cn("relative grid h-full", !resizing && "transition-[grid-template-columns] duration-[var(--dur)] ease-out")}
      style={{ gridTemplateColumns: `${hidden ? 0 : width}px minmax(0,1fr)`, gridTemplateRows: "minmax(0,1fr)" }}
    >
      <aside
        aria-hidden={hidden}
        inert={hidden}
        className={cn("min-w-0 overflow-hidden border-e border-line transition-opacity duration-[var(--dur)]", hidden && "opacity-0")}
      >
        <div className="h-full" style={{ width }}>
          <Sidebar syncing={sync.syncing} onSync={() => void sync.run()} />
        </div>
      </aside>
      {!hidden && <SidebarResizer width={width} onResizing={setResizing} />}
      <div className="flex min-h-0 min-w-0 flex-col bg-bg">
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-[var(--dur)] ease-out",
            focus ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
          )}
          inert={focus}
        >
          <div className="overflow-hidden">
            <Toolbar />
          </div>
        </div>
        <main className="min-h-0 flex-1">
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner className="size-5" /></div>}>
            {/* A quick settle between screens. Study has its own Focus move, and nothing moves between Cards. */}
            <motion.div
              key={routeKey(route)}
              className="h-full"
              initial={focus ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: m.quick, ease: m.easeOut }}
            >
              <ErrorBoundary resetKey={routeKey(route)}>
                <Screen route={route} />
              </ErrorBoundary>
            </motion.div>
          </Suspense>
        </main>
      </div>
      {sync.dialogs}
      <CommandPalette onSync={() => void sync.run()} />
      <ExportDialog />
      <ToolsHost />
      <AnkiConnectHost onSync={() => void sync.run()} />
      <Suspense fallback={null}>
        <PackageImportHost />
      </Suspense>
      <CardInfoHost />
      <FilteredHost />
    </div>
  );
}

function Boot() {
  const { status, error } = useApp();
  if (status === "choose-profile") return <ProfileChooser />;
  if (status === "error") {
    return (
      <div className="grid h-full place-items-center bg-bg px-8">
        <div className="max-w-[460px] text-center">
          <h1 className="text-heading font-semibold text-ink">{t("error.title")}</h1>
          <p className="selectable mt-2 text-control text-ink-2">{error}</p>
          <Button className="mt-5" onClick={() => void useApp.getState().boot()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center bg-bg">
      <Spinner className="size-5" />
    </div>
  );
}

function useWebViewAccelerators(): void {
  useEffect(() => {
    const dev = import.meta.env.DEV;
    const listener = (e: KeyboardEvent) => {
      if (isWebViewAccelerator(e, dev)) e.preventDefault();
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);
}

export function App() {
  useAppearanceSync();
  useWindowMaterial();
  useWebViewAccelerators();
  const status = useApp((s) => s.status);

  useEffect(() => {
    void useApp.getState().boot();
    // Passive effects run after the first paint, so the window shows in the right colours.
    // Not inside requestAnimationFrame: WKWebView on macOS never fires it for a hidden window.
    // The stored zoom lands first so the window never shows at 100%.
    void applyStoredZoom().finally(() => getCurrentWindow().show());
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <ErrorBoundary resetKey={status}>{status === "ready" ? <Workspace /> : <Boot />}</ErrorBoundary>
        <ConfirmHost />
        <LifecycleHost />
        <ShortcutsSheet />
        <WindowHost />
        <AppToaster />
      </TooltipProvider>
    </MotionConfig>
  );
}

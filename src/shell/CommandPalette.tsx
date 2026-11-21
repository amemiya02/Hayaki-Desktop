// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Ctrl+K: every destination, Deck and tool, reachable by typing. */
import { Command } from "cmdk";
import {
  Archive,
  BarChart3,
  Database,
  Download,
  Eraser,
  FileCog,
  FolderOpen,
  Filter,
  Image,
  ImagePlus,
  Info,
  Keyboard,
  Layers,
  PanelLeft,
  Moon,
  Palette,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Undo2,
  Upload,
  Users,
} from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Kbd } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { firstLanguage, t, tr, trLabel } from "@/lib/i18n";
import { importPackage } from "@/lib/import";
import { useNav } from "@/lib/nav";
import { usePrefs } from "@/lib/prefs";
import { useApp } from "@/lib/session-store";
import { ts } from "@/lib/strings/shell";
import { useSession } from "@/lib/study/session";
import { openCardInfo } from "@/screens/card-info";
import { openFilteredDeck } from "@/screens/filtered";
import { SHORTCUTS } from "@/screens/browse/keys";
import { useBrowseCurrent } from "@/screens/browse/store";
import { useDeckTree } from "@/lib/queries";
import { themeNames, themeOrder } from "@/lib/themes";
import type { DeckTreeNode } from "@/lib/anki/proto/anki/decks_pb";

import { useExport } from "./ExportDialog";
import { GLOBAL_KEYS, splitChord } from "./shortcuts";
import { useShortcutsSheet } from "./ShortcutsSheet";
import { checkDatabase, checkMedia, createBackup, emptyCards } from "./Tools";
import { openBackup } from "./Backups";
import { useSync } from "@/lib/sync";

function flatten(node: DeckTreeNode | undefined, out: DeckTreeNode[] = []): DeckTreeNode[] {
  for (const child of node?.children ?? []) {
    out.push(child);
    flatten(child, out);
  }
  return out;
}

function Item({ icon, label, keys, onSelect, value }: { icon: ReactNode; label: string; keys?: readonly string[]; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      value={value ?? label}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-3 rounded-[7px] px-2.5 text-body text-ink data-[selected=true]:bg-accent-soft [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-2"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {keys && keys.length > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-caption text-ink-3">
          {keys.map((chord, k) => (
            <Fragment key={chord}>
              {k > 0 && <span aria-hidden>/</span>}
              <Kbd>{splitChord(chord).join(" ")}</Kbd>
            </Fragment>
          ))}
        </span>
      )}
    </Command.Item>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3"
    >
      {children}
    </Command.Group>
  );
}

export function CommandPalette({ onSync }: { onSync: () => void }) {
  const [open, setOpen] = useState(false);
  const go = useNav((s) => s.go);
  const { data: tree } = useDeckTree();
  const prefs = usePrefs();
  const showExport = useExport((s) => s.show);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // Ctrl+K; Ctrl+Shift+P stays Anki's Switch Profile.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const run = (action: () => unknown) => () => {
    setOpen(false);
    void Promise.resolve(action()).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  };

  const lang = firstLanguage().toLowerCase();
  const themeLabel = (id: (typeof themeOrder)[number]) =>
    lang.startsWith("zh") ? themeNames[id].zh : lang.startsWith("ja") ? themeNames[id].ja : themeNames[id].en;
  const decks = flatten(tree);
  const route = useNav((s) => s.route.name);
  const browseCard = useBrowseCurrent((s) => s.cardId);
  const studyCard = useSession((s) => s.queued?.card?.id ?? null);
  const infoCard = route === "study" ? studyCard : route === "browse" ? browseCard : null;

  const startImageOcclusion = async () => {
    const module = (await import("@/screens/image-occlusion")) as Record<string, unknown>;
    if (typeof module.startImageOcclusion === "function") (module.startImageOcclusion as () => void)();
    else go({ name: "image-occlusion", mode: { kind: "add" } });
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--scrim)] data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          aria-label={t("palette.title")}
          className="fixed left-1/2 top-[14vh] z-50 w-[600px] max-w-[calc(100vw-48px)] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line bg-raised shadow-pop outline-none data-[state=open]:animate-dialog-in"
        >
          <RadixDialog.Title className="sr-only">{t("palette.title")}</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">{t("palette.placeholder")}</RadixDialog.Description>
          <Command loop label={t("palette.title")}>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 text-ink-3" />
              <Command.Input
                autoFocus
                placeholder={t("palette.placeholder")}
                className="h-12 flex-1 bg-transparent text-title text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-control text-ink-3">{t("palette.empty")}</Command.Empty>
              <Group heading={t("palette.go")}>
                <Item icon={<Layers />} label={t("nav.decks")} keys={GLOBAL_KEYS.decks} onSelect={run(() => go({ name: "decks" }))} />
                <Item icon={<Plus />} label={tr("actions-add")} keys={GLOBAL_KEYS.add} onSelect={run(() => go({ name: "add" }))} />
                <Item icon={<Search />} label={t("nav.browse")} keys={GLOBAL_KEYS.browse} onSelect={run(() => go({ name: "browse" }))} />
                <Item icon={<BarChart3 />} label={t("nav.stats")} keys={GLOBAL_KEYS.stats} onSelect={run(() => go({ name: "stats" }))} />
                <Item icon={<Settings />} label={t("nav.settings")} keys={GLOBAL_KEYS.preferences} onSelect={run(() => go({ name: "settings" }))} />
                <Item icon={<FileCog />} label={tr("qt-misc-manage-note-types")} keys={GLOBAL_KEYS.notetypes} onSelect={run(() => go({ name: "notetypes" }))} />
              </Group>
              <Group heading={t("palette.actions")}>
                <Item icon={<RefreshCw />} label={tr("qt-misc-sync")} keys={GLOBAL_KEYS.sync} onSelect={run(onSync)} />
                <Item icon={<Download />} label={t("decks.import")} keys={GLOBAL_KEYS.import} onSelect={run(() => importPackage())} />
                <Item icon={<Upload />} label={trLabel("exporting-export")} keys={GLOBAL_KEYS.export} onSelect={run(() => showExport())} />
                <Item icon={<Undo2 />} label={tr("undo-undo")} keys={GLOBAL_KEYS.undo} onSelect={run(() => core.undo())} />
                {infoCard !== null && (
                  <Item icon={<Info />} label={tr("actions-card-info")} keys={route === "study" ? GLOBAL_KEYS.cardInfoStudy : [SHORTCUTS.cardInfo!]} onSelect={run(() => openCardInfo(infoCard))} />
                )}
                <Item icon={<Filter />} label={trLabel("qt-misc-create-filtered-deck")} keys={GLOBAL_KEYS.createFiltered} onSelect={run(() => openFilteredDeck())} />
                <Item icon={<ImagePlus />} label={tr("notetypes-image-occlusion-name")} onSelect={run(startImageOcclusion)} />
                <Item icon={<Users />} label={trLabel("qt-accel-switch-profile")} keys={GLOBAL_KEYS.switchProfile} onSelect={run(() => useApp.getState().switchProfile())} />
                <Item icon={<PanelLeft />} label={usePrefs.getState().sidebarCollapsed ? ts("showSidebar") : ts("hideSidebar")} keys={GLOBAL_KEYS.sidebar} onSelect={run(() => usePrefs.getState().toggleSidebar())} />
                <Item icon={<Keyboard />} label={ts("shortcuts")} keys={GLOBAL_KEYS.shortcuts} onSelect={run(() => useShortcutsSheet.getState().show())} />
              </Group>
              {decks.length > 0 && (
                <Group heading={tr("decks-study")}>
                  {decks.map((deck) => (
                    <Item
                      key={String(deck.deckId)}
                      value={`study ${deck.name}`}
                      icon={<Play />}
                      label={deck.name.replaceAll("::", " › ")}
                      onSelect={run(() => go({ name: "study", deckId: deck.deckId }))}
                    />
                  ))}
                </Group>
              )}
              <Group heading={t("palette.tools")}>
                <Item icon={<Database />} label={tr("database-check-title")} onSelect={run(checkDatabase)} />
                <Item icon={<Image />} label={tr("media-check-window-title")} onSelect={run(checkMedia)} />
                <Item icon={<Eraser />} label={tr("empty-cards-window-title")} onSelect={run(emptyCards)} />
                <Item icon={<Archive />} label={t("tools.createBackup")} onSelect={run(createBackup)} />
                <Item icon={<FolderOpen />} label={trLabel("qt-accel-load-backup")} onSelect={run(openBackup)} />
                <Item icon={<ScrollText />} label={tr("sync-media-log-title")} onSelect={run(() => useSync.getState().showLog(true))} />
              </Group>
              <Group heading={t("settings.appearance")}>
                {(["system", "light", "dark", "black"] as const).map((a) => (
                  <Item key={a} icon={<Moon />} label={`${t("settings.appearance")}: ${t(`settings.${a}`)}`} onSelect={run(() => prefs.setAppearance(a))} />
                ))}
                {themeOrder.map((id) => (
                  <Item key={id} icon={<Palette />} label={`${t("settings.theme")}: ${themeLabel(id)}`} onSelect={run(() => prefs.setTheme(id))} />
                ))}
              </Group>
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

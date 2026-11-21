// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** `?` or F1: every shortcut, per screen, with a filter. */
import { BookOpen, Search, X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { Fragment, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { Button, IconButton, Kbd, scrimClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { ts } from "@/lib/strings/shell";

import { openManual } from "./help";
import { filterSections, resolveSections, splitChord, type ResolvedSection } from "./shortcuts";

export const useShortcutsSheet = create<{ open: boolean; toggle(): void; show(): void; hide(): void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Which section the current screen's shortcuts live in, so it leads the sheet. */
function leadSection(route: string): ResolvedSection["id"] {
  switch (route) {
    case "study":
      return "study";
    case "browse":
      return "browse";
    case "deck":
      return "overview";
    case "add":
      return "editor";
    default:
      return "decks";
  }
}

function Chord({ chord }: { chord: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {splitChord(chord).map((key, i) => (
        <Kbd key={i} className="h-5 min-w-5 px-1.5 text-caption">
          {key}
        </Kbd>
      ))}
    </span>
  );
}

export function ShortcutsSheet() {
  const open = useShortcutsSheet((s) => s.open);
  const route = useNav((s) => s.route.name);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "F1" || (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target))) {
        if (e.key === "?" && document.querySelector("[role=dialog]") && !useShortcutsSheet.getState().open) return;
        e.preventDefault();
        useShortcutsSheet.getState().toggle();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const sections = useMemo(() => {
    if (!open) return [];
    const all = resolveSections();
    const lead = leadSection(route);
    // Everywhere first, then the current screen, then the rest in their usual order.
    const ordered = [
      ...all.filter((s) => s.id === "everywhere"),
      ...all.filter((s) => s.id === lead),
      ...all.filter((s) => s.id !== "everywhere" && s.id !== lead),
    ];
    return filterSections(ordered, query);
  }, [open, route, query]);

  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => (o ? useShortcutsSheet.getState().show() : useShortcutsSheet.getState().hide())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={scrimClass} />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(680px,86vh)] w-[760px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-line bg-raised shadow-pop outline-none data-[state=open]:animate-dialog-in">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
            <RadixDialog.Title className="text-title font-semibold text-ink">{ts("shortcuts")}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{ts("shortcutsFilter")}</RadixDialog.Description>
            <div className="relative ms-auto w-[240px]">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ts("shortcutsFilter")}
                aria-label={ts("shortcutsFilter")}
                className="h-8 w-full rounded-[8px] border border-transparent bg-surface-2 ps-8 pe-2.5 text-control text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-ring"
              />
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={`${t("common.close")} (Esc)`} size="sm">
                <X />
              </IconButton>
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
            {sections.length === 0 ? (
              <p className="py-12 text-center text-control text-ink-3">{ts("shortcutsNone")}</p>
            ) : (
              <div className="columns-1 gap-8 sm:columns-2">
                {sections.map((section) => (
                  <section key={section.id} className="break-inside-avoid pt-4">
                    <h3 className="mb-1 px-1 text-caption font-semibold text-ink-2">{section.title}</h3>
                    <dl className="divide-y divide-line-soft">
                      {section.items.map((item, i) => (
                        <div key={i} className="flex min-h-9 items-center gap-4 px-1 py-1">
                          <dt className="min-w-0 flex-1 text-control text-ink">{item.label}</dt>
                          <dd className="flex shrink-0 items-center gap-1.5 text-caption text-ink-3">
                            {item.keys.map((chord, k) => (
                              <Fragment key={chord}>
                                {k > 0 && <span aria-hidden>/</span>}
                                <Chord chord={chord} />
                              </Fragment>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 justify-end border-t border-line px-5 py-2.5">
            <Button size="sm" variant="ghost" onClick={() => void openManual()}>
              <BookOpen />
              {ts("manual")}
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

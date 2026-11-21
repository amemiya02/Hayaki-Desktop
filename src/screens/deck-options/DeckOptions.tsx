// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Deck options, rebuilt natively from Anki's Svelte page
 * (ts/routes/deck-options): a preset switcher, every option grouped as Anki
 * groups them, and one save bar.
 */
import { Check, ChevronDown, Copy, FolderTree, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button, cn, Dialog, IconButton, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Spinner, TextField } from "@/components/ui";
import { displayChord, withChord } from "@/lib/chord";
import * as core from "@/lib/anki/generated/core";
import type { ComputeParamsProgress } from "@/lib/anki/proto/anki/collection_pb";
import { tr, t } from "@/lib/i18n";
import { setLeaveGuard, useNav } from "@/lib/nav";
import { td } from "@/lib/strings/deck-options";

import { FsrsSection } from "./FsrsSection";
import {
  addPreset,
  buildRequest,
  clonePreset,
  currentConfig,
  currentPreset,
  fromServer,
  isDefaultPresetSelected,
  presetList,
  removalForcesFullSync,
  removePreset,
  renamePreset,
  selectPreset,
  snapshot,
  UpdateDeckConfigsMode,
  type OptionsState,
} from "./model";
import { isInterrupted, progressText, withProgress } from "./progress";
import {
  AdvancedSection,
  AudioSection,
  AutoAdvanceSection,
  BurySection,
  DailyLimitsSection,
  DisplayOrderSection,
  EasyDaysSection,
  LapsesSection,
  NewCardsSection,
  sectionTitles,
  TimerSection,
} from "./sections";

interface Loaded {
  state: OptionsState;
  original: string;
  easyDays: number[];
}

type NamePrompt = { kind: "add" | "clone" | "rename"; value: string };

interface Confirm {
  title: string;
  description: ReactNode;
  action: string;
  cancel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function DeckOptionsScreen({ deckId }: { deckId: bigint }) {
  const back = useNav((s) => s.back);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<OptionsState | null>(null);
  const [state, setState] = useState<OptionsState | null>(null);
  const [saving, setSaving] = useState<"save" | "optimize-all" | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [allProgress, setAllProgress] = useState<ComputeParamsProgress | undefined>();

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await core.getDeckConfigsForUpdate({ did: deckId });
      const initial = fromServer(deckId, data);
      stateRef.current = initial;
      setState(initial);
      setLoaded({ state: initial, original: snapshot(initial), easyDays: currentConfig(initial).easyDaysPercentages.slice() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Applies a change at once, so a save straight after a blur sees it. */
  const update = useCallback((fn: (s: OptionsState) => OptionsState) => {
    if (!stateRef.current) return;
    stateRef.current = fn(stateRef.current);
    setState(stateRef.current);
  }, []);

  const dirty = useMemo(() => !!state && !!loaded && snapshot(state) !== loaded.original, [state, loaded]);

  // While there are unsaved changes, leaving by any route (sidebar, shortcuts) asks first.
  const removeGuard = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const remove = setLeaveGuard((proceed) => {
      setConfirm({
        title: tr("card-templates-discard-changes"),
        description: td("discardLead"),
        action: tr("actions-discard"),
        cancel: td("keepEditing"),
        danger: true,
        onConfirm: proceed,
      });
      return false;
    });
    removeGuard.current = remove;
    return () => {
      remove();
      if (removeGuard.current === remove) removeGuard.current = null;
    };
  }, [dirty]);

  /** Goes back without asking, for after a save or a confirmed discard. */
  const leaveNow = useCallback(() => {
    removeGuard.current?.();
    removeGuard.current = null;
    back();
  }, [back]);

  /** Lets the focused field commit its text before reading the state. */
  const commitEditing = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const save = async (mode: UpdateDeckConfigsMode) => {
    if (saving) return;
    await commitEditing();
    const current = stateRef.current;
    if (!current) return;
    setSaving(mode === UpdateDeckConfigsMode.COMPUTE_ALL_PARAMS ? "optimize-all" : "save");
    try {
      const request = buildRequest(current, mode);
      if (mode === UpdateDeckConfigsMode.COMPUTE_ALL_PARAMS) {
        setAllProgress(undefined);
        await withProgress(() => core.updateDeckConfigs(request), setAllProgress);
        toast.success(td("saved"));
        await load();
      } else {
        await core.updateDeckConfigs(request);
        toast.success(td("saved"));
        leaveNow();
      }
    } catch (e) {
      if (!isInterrupted(e)) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const leave = async () => {
    await commitEditing();
    const current = stateRef.current;
    if (current && loaded && snapshot(current) !== loaded.original) {
      setConfirm({
        title: tr("card-templates-discard-changes"),
        description: td("discardLead"),
        action: tr("actions-discard"),
        cancel: td("keepEditing"),
        danger: true,
        onConfirm: leaveNow,
      });
    } else {
      leaveNow();
    }
  };

  // Ctrl+Enter saves, as in Anki.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        void saveRef.current(UpdateDeckConfigsMode.NORMAL);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="max-w-[420px] text-center">
          <h2 className="text-[15px] font-semibold text-ink">{td("loadFailed")}</h2>
          <p className="selectable mt-1.5 text-[13px] text-ink-2">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={back}>{tr("actions-close")}</Button>
            <Button variant="primary" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!state || !loaded) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  const notify = (text: string) => setNotice(text);
  const sectionProps = { state, update };

  const askRemove = () => {
    const prefix = removalForcesFullSync(state) ? tr("deck-config-will-require-full-sync") + " " : "";
    setConfirm({
      title: tr("deck-config-remove-group"),
      description: (prefix + tr("deck-config-confirm-remove-name", { name: currentPreset(state).name })).replace(/\s+/g, " "),
      action: tr("deck-config-remove-group"),
      danger: true,
      onConfirm: () => update(removePreset),
    });
  };

  const submitName = () => {
    if (!namePrompt) return;
    const name = namePrompt.value.trim();
    if (namePrompt.kind === "rename") update((s) => renamePreset(s, namePrompt.value));
    else if (name) update((s) => (namePrompt.kind === "add" ? addPreset(s, name) : clonePreset(s, name)));
    setNamePrompt(null);
  };

  const optimizeAll = async () => {
    await commitEditing();
    setConfirm({
      title: tr("deck-config-save-and-optimize"),
      description: tr("deck-config-fsrs-confirm-save-and-optimize"),
      action: tr("deck-config-save-and-optimize"),
      onConfirm: () => void save(UpdateDeckConfigsMode.COMPUTE_ALL_PARAMS),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Header
        state={state}
        onSelect={(index) => update((s) => selectPreset(s, index))}
        onAdd={() => setNamePrompt({ kind: "add", value: "" })}
        onClone={() => setNamePrompt({ kind: "clone", value: currentPreset(state).name })}
        onRename={() => setNamePrompt({ kind: "rename", value: currentPreset(state).name })}
        onRemove={askRemove}
        onSaveToSubdecks={() => void save(UpdateDeckConfigsMode.APPLY_TO_CHILDREN)}
      />

      <Body>
        <DailyLimitsSection {...sectionProps} />
        <NewCardsSection {...sectionProps} />
        <LapsesSection {...sectionProps} />
        <DisplayOrderSection {...sectionProps} />
        <FsrsSection {...sectionProps} notify={notify} onOptimizeAll={() => void optimizeAll()} />
        <BurySection {...sectionProps} />
        <AudioSection {...sectionProps} />
        <TimerSection {...sectionProps} />
        <AutoAdvanceSection {...sectionProps} />
        <EasyDaysSection {...sectionProps} original={loaded.easyDays} />
        <AdvancedSection {...sectionProps} />
      </Body>

      <footer className="flex h-[56px] shrink-0 items-center gap-3 border-t border-line bg-bg px-5">
        <div className="mr-auto flex items-center gap-2 text-[12.5px] text-ink-2" aria-live="polite">
          {saving ? (
            <>
              <Spinner />
              {saving === "optimize-all" ? (
                <span className="tabular">
                  {td("optimizingAll")} {progressText(allProgress)}
                </span>
              ) : (
                td("saving")
              )}
            </>
          ) : (
            dirty && (
              <>
                <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                {td("unsaved")}
              </>
            )
          )}
        </div>
        {saving === "optimize-all" && <Button onClick={() => void core.setWantsAbort()}>{tr("actions-cancel")}</Button>}
        <Button onClick={() => void leave()} disabled={!!saving}>
          {dirty ? tr("actions-discard") : tr("actions-close")}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || !!saving}
          onClick={() => void save(UpdateDeckConfigsMode.NORMAL)}
          title={withChord(tr("deck-config-save-button"), "Ctrl+Enter")}
        >
          {tr("deck-config-save-button")}
          <Kbd className="border-transparent bg-[color-mix(in_oklab,var(--on-accent)_18%,transparent)] text-on-accent">{displayChord("Ctrl+Enter")}</Kbd>
        </Button>
      </footer>

      <Dialog
        open={namePrompt !== null}
        onOpenChange={(open) => !open && setNamePrompt(null)}
        title={
          namePrompt?.kind === "add"
            ? tr("deck-config-add-group")
            : namePrompt?.kind === "clone"
              ? tr("deck-config-clone-group")
              : tr("deck-config-rename-group")
        }
        description={tr("deck-config-name-prompt")}
        footer={
          <>
            <Button onClick={() => setNamePrompt(null)}>{tr("actions-cancel")}</Button>
            <Button variant="primary" disabled={!namePrompt?.value.trim()} onClick={submitName}>
              {tr("actions-save")}
            </Button>
          </>
        }
      >
        <TextField
          autoFocus
          aria-label={tr("deck-config-name-prompt")}
          value={namePrompt?.value ?? ""}
          onChange={(e) => namePrompt && setNamePrompt({ ...namePrompt, value: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && namePrompt?.value.trim() && submitName()}
        />
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{confirm?.cancel ?? tr("actions-cancel")}</Button>
            <Button
              variant={confirm?.danger ? "danger" : "primary"}
              onClick={() => {
                const action = confirm?.onConfirm;
                setConfirm(null);
                action?.();
              }}
            >
              {confirm?.action}
            </Button>
          </>
        }
      />

      <Dialog
        open={notice !== null}
        onOpenChange={(open) => !open && setNotice(null)}
        title={tr("deck-config-title")}
        description={<span className="selectable whitespace-pre-line">{notice}</span>}
        footer={
          <Button variant="primary" onClick={() => setNotice(null)}>
            {tr("actions-close")}
          </Button>
        }
      />
    </div>
  );
}

/* ------------------------------ Header ------------------------------ */

function Header({
  state,
  onSelect,
  onAdd,
  onClone,
  onRename,
  onRemove,
  onSaveToSubdecks,
}: {
  state: OptionsState;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onClone: () => void;
  onRename: () => void;
  onRemove: () => void;
  onSaveToSubdecks: () => void;
}) {
  const list = presetList(state);
  const current = list[state.selected];
  const parts = state.deckName.split("::");
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-3">
      <div className="min-w-0 flex-1">
        {parts.length > 1 && <p className="truncate text-[12px] text-ink-3">{parts.slice(0, -1).join(" › ")}</p>}
        <h2 className="truncate text-[15px] font-semibold text-ink" title={state.deckName}>
          {parts[parts.length - 1]}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-ink-3">{td("preset")}</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button className="max-w-[360px] justify-between" aria-label={`${td("preset")}: ${current.name}`}>
              <span className="truncate">{current.name}</span>
              <span className="tabular shrink-0 text-[12px] font-normal text-ink-3">
                {tr("deck-config-used-by-decks", { decks: current.useCount })}
              </span>
              <ChevronDown className="text-ink-3" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[280px] overflow-y-auto rounded-[10px] border border-line bg-raised p-1 shadow-pop data-[state=open]:animate-[pop-in_120ms_var(--ease-out)]"
            >
              <DropdownMenu.RadioGroup value={String(state.selected)} onValueChange={(v) => onSelect(Number(v))}>
                {list.map((entry) => (
                  <DropdownMenu.RadioItem
                    key={`${entry.index}-${entry.name}`}
                    value={String(entry.index)}
                    className="relative flex h-8 cursor-default select-none items-center gap-4 rounded-[6px] pl-8 pr-2.5 text-[13px] text-ink outline-none data-[highlighted]:bg-accent-soft"
                  >
                    <DropdownMenu.ItemIndicator className="absolute left-2.5 inline-flex">
                      <Check className="size-4 text-accent-ink" />
                    </DropdownMenu.ItemIndicator>
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="tabular shrink-0 text-[12px] text-ink-3">{tr("deck-config-used-by-decks", { decks: entry.useCount })}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={td("presetActions")} variant="secondary">
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={onAdd}>
              <Plus />
              {tr("deck-config-add-group")}
            </MenuItem>
            <MenuItem onSelect={onClone}>
              <Copy />
              {tr("deck-config-clone-group")}
            </MenuItem>
            <MenuItem onSelect={onRename}>
              <Pencil />
              {tr("deck-config-rename-group")}
            </MenuItem>
            <MenuItem onSelect={onRemove} danger disabled={isDefaultPresetSelected(state)}>
              <Trash2 />
              {tr("deck-config-remove-group")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={onSaveToSubdecks}>
              <FolderTree />
              {tr("deck-config-save-to-all-subdecks")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

/* ------------------------------ Body and contents ------------------------------ */

function Body({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sections = sectionTitles();
  const [active, setActive] = useState(sections[0].id);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // The active section is the last one whose top has reached the top of the scroller.
        const top = el.getBoundingClientRect().top + 24;
        let current = sections[0].id;
        for (const { id } of sections) {
          const section = el.querySelector<HTMLElement>(`#${id}`);
          if (section && section.getBoundingClientRect().top <= top) current = id;
        }
        // Scrolled right to the end, the last section is the one being read,
        // even when it is too short to reach the top.
        const scrollable = el.scrollHeight > el.clientHeight + 4;
        if (scrollable && el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
          current = sections[sections.length - 1].id;
        }
        setActive(current);
      });
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
    // The section list is static for the screen's life.
  }, []);

  const jump = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  };

  return (
    <div ref={scroller} className="@container min-h-0 flex-1 basis-0 overflow-y-auto">
      <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-10 px-8 pb-16 pt-8 @min-[960px]:grid-cols-[176px_minmax(0,1fr)]">
        <nav aria-label={td("onThisPage")} className="hidden @min-[960px]:block">
          <div className="sticky top-8">
            <p className="mb-2 px-2.5 text-[12px] font-medium text-ink-3">{td("onThisPage")}</p>
            <ul className="space-y-px">
              {sections.map(({ id, title }) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={active === id ? "location" : undefined}
                    onClick={() => jump(id)}
                    className={cn(
                      "w-full truncate rounded-[7px] px-2.5 py-1.5 text-left text-[13px] transition-colors duration-[var(--dur-fast)]",
                      active === id ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-2 hover:bg-sidebar-hover hover:text-ink",
                    )}
                  >
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="min-w-0 max-w-[720px] [&_h2]:outline-none">{children}</div>
      </div>
    </div>
  );
}

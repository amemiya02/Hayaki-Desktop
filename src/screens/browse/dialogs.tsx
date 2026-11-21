// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The browser's small dialogs, worded like Anki's (`aqt/forms/*.ui`). */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button, cn, Dialog, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_String } from "@/lib/anki/proto/anki/config_pb";
import { ScheduleCardsAsNewRequest_Context } from "@/lib/anki/proto/anki/scheduler_pb";
import { localeCompare, tr, trLabel } from "@/lib/i18n";
import { tb } from "@/lib/strings/browse";

import { plainLabel } from "./search";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs a dialog's submit, closing on success and reporting failures. */
function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Footer({ busy, label, disabled, onCancel, onConfirm }: { busy: boolean; label: string; disabled?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <>
      <Button onClick={onCancel}>{tr("actions-cancel")}</Button>
      <Button variant="primary" disabled={busy || disabled} onClick={onConfirm}>
        {busy && <Spinner className="text-on-accent" />}
        {label}
      </Button>
    </>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center gap-2.5 py-1 text-control text-ink", disabled && "opacity-45")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 accent-[var(--accent)]"
      />
      {children}
    </label>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-caption font-medium text-ink-2">
      {children}
    </label>
  );
}

const selectClass =
  "h-8 w-full rounded-[8px] border border-line bg-surface px-2 text-control text-ink outline-none " +
  "hover:border-line-strong focus:border-accent focus:shadow-ring";

/* ------------------------------ Change Deck ------------------------------ */

export function ChangeDeckDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (deckId: bigint) => Promise<void> }) {
  const { data } = useQuery({
    queryKey: ["browse", "deckNames"],
    queryFn: () => core.getDeckNames({ skipEmptyDefault: true, includeFiltered: false }),
  });
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const { busy, run } = useSubmit(onClose);

  const decks = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return [...(data?.entries ?? [])]
      .filter((d) => !needle || d.name.toLowerCase().includes(needle))
      .sort((a, b) => localeCompare(a.name, b.name));
  }, [data, filter]);

  useEffect(() => setActive(0), [filter]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const chosen = decks[active];
  const submit = () => chosen && run(() => onSubmit(chosen.id));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-change-deck")}
      width={460}
      footer={<Footer busy={busy} label={tr("browsing-move-cards")} disabled={!chosen} onCancel={onClose} onConfirm={submit} />}
    >
      <FieldLabel htmlFor="browse-deck-filter">{tr("browsing-move-cards-to-deck")}</FieldLabel>
      <TextField
        id="browse-deck-filter"
        autoFocus
        value={filter}
        placeholder={plainLabel(tr("decks-filter"))}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(decks.length - 1, i + 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
          if (e.key === "Enter") (e.preventDefault(), void submit());
        }}
        role="combobox"
        aria-expanded
        aria-controls="browse-deck-list"
        aria-activedescendant={chosen ? `browse-deck-${chosen.id}` : undefined}
      />
      <div
        ref={list}
        id="browse-deck-list"
        role="listbox"
        className="mt-2 h-[280px] overflow-auto rounded-[10px] border border-line bg-surface p-1"
      >
        {!data && (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        )}
        {decks.map((deck, i) => (
          <div
            key={String(deck.id)}
            id={`browse-deck-${deck.id}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => setActive(i)}
            onDoubleClick={() => void run(() => onSubmit(deck.id))}
            title={deck.name}
            className={cn(
              "flex h-8 items-center truncate rounded-[6px] px-2.5 text-control text-ink",
              i === active && "bg-accent-soft text-accent-ink",
            )}
          >
            <span className="truncate">{deck.name}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/* ------------------------------ Tags ------------------------------ */

export function TagsDialog({ remove, onClose, onSubmit }: { remove: boolean; onClose: () => void; onSubmit: (tags: string) => Promise<void> }) {
  const [tags, setTags] = useState("");
  const { busy, run } = useSubmit(onClose);
  const submit = () => tags.trim() && run(() => onSubmit(tags.trim()));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={plainLabel(tr(remove ? "browsing-remove-tags" : "browsing-add-tags2"))}
      footer={
        <Footer
          busy={busy}
          label={remove ? tr("actions-remove-tag") : tr("actions-add")}
          disabled={!tags.trim()}
          onCancel={onClose}
          onConfirm={submit}
        />
      }
    >
      <FieldLabel htmlFor="browse-tags">{tr(remove ? "browsing-enter-tags-to-delete" : "browsing-enter-tags-to-add")}</FieldLabel>
      <TextField
        id="browse-tags"
        autoFocus
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        spellCheck={false}
      />
    </Dialog>
  );
}

/* ------------------------------ Set Due Date ------------------------------ */

export function SetDueDialog({ count, onClose, onSubmit }: { count: number; onClose: () => void; onSubmit: (days: string) => Promise<void> }) {
  const [days, setDays] = useState<string | null>(null);
  const { busy, run } = useSubmit(onClose);
  useEffect(() => {
    void core
      .getConfigString({ key: ConfigKey_String.SET_DUE_BROWSER })
      .then((v) => setDays((d) => d ?? v.val))
      .catch(() => setDays((d) => d ?? ""));
  }, []);
  const value = days ?? "";
  const submit = () => value.trim() && run(() => onSubmit(value.trim()));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("actions-set-due-date")}
      footer={<Footer busy={busy} label={tr("actions-set-due-date")} disabled={!value.trim()} onCancel={onClose} onConfirm={submit} />}
    >
      <FieldLabel htmlFor="browse-due">{tr("scheduling-set-due-date-prompt", { cards: count })}</FieldLabel>
      <TextField
        id="browse-due"
        autoFocus
        value={value}
        onChange={(e) => setDays(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        className="tabular"
        spellCheck={false}
      />
      <p className="mt-2 whitespace-pre-line text-caption leading-relaxed text-ink-3">{tr("scheduling-set-due-date-prompt-hint")}</p>
    </Dialog>
  );
}

/* ------------------------------ Reset (Forget) ------------------------------ */

export function ForgetDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (restorePosition: boolean, resetCounts: boolean) => Promise<void> }) {
  const [restore, setRestore] = useState(true);
  const [reset, setReset] = useState(false);
  const { busy, run } = useSubmit(onClose);
  useEffect(() => {
    void core
      .scheduleCardsAsNewDefaults({ context: ScheduleCardsAsNewRequest_Context.BROWSER })
      .then((d) => {
        setRestore(d.restorePosition);
        setReset(d.resetCounts);
      })
      .catch(() => undefined);
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("actions-forget-card")}
      footer={<Footer busy={busy} label={tr("actions-forget-card")} onCancel={onClose} onConfirm={() => void run(() => onSubmit(restore, reset))} />}
    >
      <Checkbox checked={restore} onChange={setRestore}>
        {tr("scheduling-restore-position")}
      </Checkbox>
      <Checkbox checked={reset} onChange={setReset}>
        {tr("scheduling-reset-counts")}
      </Checkbox>
    </Dialog>
  );
}

/* ------------------------------ Reposition ------------------------------ */

export interface RepositionValues {
  start: number;
  step: number;
  randomize: boolean;
  shift: boolean;
}

export function RepositionDialog({
  queue,
  onClose,
  onSubmit,
}: {
  queue: { top: number; bottom: number } | null;
  onClose: () => void;
  onSubmit: (values: RepositionValues) => Promise<void>;
}) {
  const [start, setStart] = useState("0");
  const [step, setStep] = useState("1");
  const [randomize, setRandomize] = useState(false);
  const [shift, setShift] = useState(false);
  const { busy, run } = useSubmit(onClose);
  useEffect(() => {
    void core
      .repositionDefaults()
      .then((d) => {
        setRandomize(d.random);
        setShift(d.shift);
      })
      .catch(() => undefined);
  }, []);
  const startN = Number.parseInt(start, 10);
  const stepN = Number.parseInt(step, 10);
  const valid = Number.isFinite(startN) && startN >= 0 && Number.isFinite(stepN) && stepN >= 1;
  const submit = () => valid && run(() => onSubmit({ start: startN, step: stepN, randomize, shift }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-reposition-new-cards")}
      footer={<Footer busy={busy} label={tr("actions-reposition")} disabled={!valid} onCancel={onClose} onConfirm={submit} />}
    >
      {queue && (
        <p className="tabular mb-3 text-caption leading-relaxed text-ink-2">
          {tr("browsing-queue-top", { val: queue.top })}
          <br />
          {tr("browsing-queue-bottom", { val: queue.bottom })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="browse-start">{plainLabel(tr("browsing-start-position"))}</FieldLabel>
          <TextField
            id="browse-start"
            autoFocus
            inputMode="numeric"
            value={start}
            onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="tabular"
          />
        </div>
        <div>
          <FieldLabel htmlFor="browse-step">{plainLabel(tr("browsing-step"))}</FieldLabel>
          <TextField
            id="browse-step"
            inputMode="numeric"
            value={step}
            onChange={(e) => setStep(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="tabular"
          />
        </div>
      </div>
      <div className="mt-3">
        <Checkbox checked={randomize} onChange={setRandomize}>
          {tr("browsing-randomize-order")}
        </Checkbox>
        <Checkbox checked={shift} onChange={setShift}>
          {tr("browsing-shift-position-of-existing-cards")}
        </Checkbox>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Find and Replace ------------------------------ */

export interface FindReplaceValues {
  find: string;
  replace: string;
  /** null for all fields, "" for tags, otherwise a field name. */
  field: string | null;
  selectedOnly: boolean;
  matchCase: boolean;
  regex: boolean;
}

export function FindReplaceDialog({
  noteIds,
  onClose,
  onSubmit,
}: {
  noteIds: bigint[];
  onClose: () => void;
  onSubmit: (values: FindReplaceValues) => Promise<void>;
}) {
  const { data: fields } = useQuery({
    queryKey: ["browse", "fieldNames", noteIds.length, String(noteIds[0] ?? "")],
    queryFn: async () => (await core.fieldNamesForNotes({ nids: noteIds })).fields,
    enabled: noteIds.length > 0,
  });
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [field, setField] = useState("__all__");
  const [selectedOnly, setSelectedOnly] = useState(noteIds.length > 0);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [regex, setRegex] = useState(false);
  const { busy, run } = useSubmit(onClose);
  const submit = () =>
    run(() =>
      onSubmit({
        find,
        replace,
        field: field === "__all__" ? null : field === "__tags__" ? "" : field,
        selectedOnly,
        matchCase: !ignoreCase,
        regex,
      }),
    );
  const enter = (e: KeyboardEvent) => e.key === "Enter" && void submit();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-find-and-replace")}
      width={480}
      footer={<Footer busy={busy} label={trLabel("qt-accel-find-and-replace")} onCancel={onClose} onConfirm={() => void submit()} />}
    >
      <div className="grid gap-3">
        <div>
          <FieldLabel htmlFor="browse-find">{plainLabel(tr("browsing-find"))}</FieldLabel>
          <TextField id="browse-find" autoFocus value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={enter} spellCheck={false} />
        </div>
        <div>
          <FieldLabel htmlFor="browse-replace">{plainLabel(tr("browsing-replace-with"))}</FieldLabel>
          <TextField id="browse-replace" value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={enter} spellCheck={false} />
        </div>
        <div>
          <FieldLabel htmlFor="browse-in">{plainLabel(tr("browsing-in"))}</FieldLabel>
          <select id="browse-in" value={field} onChange={(e) => setField(e.target.value)} className={selectClass}>
            <option value="__all__">{tr("browsing-all-fields")}</option>
            <option value="__tags__">{tr("editing-tags")}</option>
            {(fields ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <Checkbox checked={selectedOnly} onChange={setSelectedOnly} disabled={noteIds.length === 0}>
          {tr("browsing-selected-notes-only")}
        </Checkbox>
        <Checkbox checked={ignoreCase} onChange={setIgnoreCase}>
          {tr("browsing-ignore-case")}
        </Checkbox>
        <Checkbox checked={regex} onChange={setRegex}>
          {tr("browsing-treat-input-as-regular-expression")}
        </Checkbox>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Saved search name ------------------------------ */

export function SaveSearchDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const { busy, run } = useSubmit(onClose);
  const submit = () => name.trim() && run(() => onSubmit(name.trim()));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("browsing-sidebar-save-current-search")}
      footer={<Footer busy={busy} label={tr("actions-save")} disabled={!name.trim()} onCancel={onClose} onConfirm={submit} />}
    >
      <FieldLabel htmlFor="browse-save-name">{tr("browsing-please-give-your-filter-a-name")}</FieldLabel>
      <TextField
        id="browse-save-name"
        autoFocus
        value={name}
        placeholder={tb("searchName")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
    </Dialog>
  );
}

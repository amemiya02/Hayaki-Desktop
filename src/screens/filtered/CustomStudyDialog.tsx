// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Custom Study for one Deck (upstream qt/aqt/customstudy.py and taglimit.py). */
import { Check as CheckIcon, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, cn, Dialog, NumberField, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { CustomStudyDefaultsResponse } from "@/lib/anki/proto/anki/scheduler_pb";
import { localeCompare, t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { tf } from "@/lib/strings/filtered";

import { errorText, InlineError } from "./FilteredDeckDialog";
import {
  clampToSpinner,
  countWithChildren,
  CRAM_KINDS,
  customStudyRequest,
  initialTags,
  spinnerFor,
  STUDY_MODES,
  toggleTag,
  type StudyMode,
} from "./model";

const MODE_LABELS: Record<StudyMode, string> = {
  new: "custom-study-increase-todays-new-card-limit",
  review: "custom-study-increase-todays-review-card-limit",
  forgot: "custom-study-review-forgotten-cards",
  ahead: "custom-study-review-ahead",
  preview: "custom-study-preview-new-cards",
  cram: "custom-study-study-by-card-state-or-tag",
};

const CRAM_LABELS = [
  "custom-study-new-cards-only",
  "custom-study-due-cards-only",
  "custom-study-all-review-cards-in-random-order",
  "custom-study-all-cards-in-random-order-dont",
];

/** A vertical radio list with arrow-key movement, like Qt's radio buttons. */
function RadioList({ label, options, value, onChange }: { label: string; options: string[]; value: number; onChange: (index: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === index}
          tabIndex={value === index ? 0 : -1}
          onClick={() => onChange(index)}
          onKeyDown={(e) => {
            const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
            if (!delta) return;
            e.preventDefault();
            const next = (index + delta + options.length) % options.length;
            onChange(next);
            (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          }}
          className="group flex min-h-8 items-center gap-2.5 rounded-[7px] px-1.5 text-left text-[13px] text-ink outline-none hover:bg-surface-2 focus-visible:shadow-[0_0_0_2px_var(--accent)]"
        >
          <span
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-[var(--dur-fast)]",
              value === index ? "border-accent bg-accent" : "border-line-strong bg-surface",
            )}
          >
            {value === index && <span className="size-1.5 rounded-full bg-[var(--on-accent)]" />}
          </span>
          {option}
        </button>
      ))}
    </div>
  );
}

function TagChips({
  title,
  tags,
  selected,
  onToggle,
  tone,
}: {
  title: string;
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  tone: "include" | "exclude";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12.5px] font-medium text-ink-2">{title}</p>
      <div role="group" aria-label={title} className="flex max-h-[120px] flex-wrap gap-1.5 overflow-y-auto">
        {tags.map((tag) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(tag)}
              className={cn(
                "inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors duration-[var(--dur-fast)]",
                "outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]",
                on
                  ? tone === "include"
                    ? "border-transparent bg-accent-soft text-accent-ink"
                    : "border-transparent bg-surface-3 text-danger line-through"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {on && (tone === "include" ? <CheckIcon className="size-3.5 shrink-0" /> : <Minus className="size-3.5 shrink-0" />)}
              <span className="truncate">{tag}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomStudyDialog({ deckId, onClose }: { deckId: bigint; onClose: () => void }) {
  const go = useNav((s) => s.go);
  const [defaults, setDefaults] = useState<CustomStudyDefaultsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [modeIndex, setModeIndex] = useState(0);
  const [value, setValue] = useState(0);
  const [cramIndex, setCramIndex] = useState(0);
  const [tags, setTags] = useState<{ include: string[]; exclude: string[] }>({ include: [], exclude: [] });
  const [tagFilter, setTagFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode = STUDY_MODES[modeIndex];

  useEffect(() => {
    let live = true;
    setLoadError(null);
    core
      .customStudyDefaults({ deckId })
      .then((out) => {
        if (!live) return;
        setDefaults(out);
        setValue(spinnerFor("new", out).initial);
        setTags(initialTags(out.tags));
      })
      .catch((e: unknown) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [deckId, attempt]);

  const allTags = useMemo(() => (defaults?.tags.map((t) => t.name) ?? []).sort(localeCompare), [defaults]);
  const shownTags = useMemo(() => {
    const needle = tagFilter.trim().toLowerCase();
    return needle ? allTags.filter((tag) => tag.toLowerCase().includes(needle)) : allTags;
  }, [allTags, tagFilter]);

  const chooseMode = (index: number) => {
    setModeIndex(index);
    setError(null);
    if (defaults) setValue(spinnerFor(STUDY_MODES[index], defaults).initial);
  };

  const spinner = defaults ? spinnerFor(mode, defaults) : null;
  const hint = !defaults
    ? ""
    : mode === "new"
      ? tr("custom-study-available-new-cards-2", {
          countString: countWithChildren(defaults.availableNew, defaults.availableNewInChildren, (count) => tr("custom-study-available-child-count", { count })),
        })
      : mode === "review"
        ? tr("custom-study-available-review-cards-2", {
            countString: countWithChildren(defaults.availableReview, defaults.availableReviewInChildren, (count) => tr("custom-study-available-child-count", { count })),
          })
        : "";

  const submit = async () => {
    if (!spinner || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amount = clampToSpinner(value, spinner);
      await core.customStudy(customStudyRequest(deckId, mode, amount, { kind: CRAM_KINDS[cramIndex], ...tags }));
      // Limit changes stay on this Deck; the other modes make the Custom Study Session current.
      const current = mode === "new" || mode === "review" ? deckId : (await core.getCurrentDeck()).id;
      onClose();
      go({ name: "deck", deckId: current });
    } catch (e) {
      // Kept open on failure: the cause is most likely an empty search the person can fix.
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("actions-custom-study")}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!defaults || busy} onClick={() => void submit()}>
            {busy && <Spinner className="text-on-accent" />}
            {tr("custom-study-ok")}
          </Button>
        </>
      }
    >
      {loadError ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <InlineError text={`${tf("customLoadError")}\n${loadError}`} />
          <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
            {tf("retry")}
          </Button>
        </div>
      ) : !defaults || !spinner ? (
        <div className="grid h-[260px] place-items-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div
          className="flex flex-col gap-4 pb-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || (e.target as HTMLElement).getAttribute("role") === "spinbutton")) {
              e.preventDefault();
              setTimeout(() => void submitRef.current(), 0);
            }
          }}
        >
          <RadioList label={tr("actions-custom-study")} options={STUDY_MODES.map((m) => tr(MODE_LABELS[m]))} value={modeIndex} onChange={chooseMode} />

          <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2 px-3.5 py-3">
            {hint && <p className="tabular text-[12.5px] text-ink-2">{hint}</p>}
            <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink">
              <label htmlFor="custom-study-amount">{tr(spinner.before)}</label>
              <NumberField
                key={mode}
                id="custom-study-amount"
                label={tr(spinner.before)}
                value={value}
                min={spinner.min}
                max={spinner.max}
                onChange={setValue}
              />
              <span>{tr(spinner.after, { count: value })}</span>
            </div>
          </div>

          {mode === "cram" && (
            <>
              <RadioList label={tf("cardState")} options={CRAM_LABELS.map((k) => tr(k))} value={cramIndex} onChange={setCramIndex} />
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <div className="flex items-center gap-3">
                  <h3 className="flex-1 text-[13px] font-semibold text-ink">{tr("custom-study-selective-study")}</h3>
                  {allTags.length > 12 && (
                    <TextField
                      aria-label={tf("filterTags")}
                      placeholder={tf("filterTags")}
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && tagFilter && (e.stopPropagation(), setTagFilter(""))}
                      className="h-7 w-[180px]"
                    />
                  )}
                </div>
                {allTags.length === 0 ? (
                  <p className="text-[12.5px] text-ink-3">{tf("noTags")}</p>
                ) : (
                  <>
                    <TagChips
                      title={tr("custom-study-require-one-or-more-of-these")}
                      tags={shownTags}
                      selected={tags.include}
                      tone="include"
                      onToggle={(tag) => setTags((l) => toggleTag(l, "include", tag))}
                    />
                    <TagChips
                      title={tr("custom-study-select-tags-to-exclude")}
                      tags={shownTags}
                      selected={tags.exclude}
                      tone="exclude"
                      onToggle={(tag) => setTags((l) => toggleTag(l, "exclude", tag))}
                    />
                    <p className="text-[12px] text-ink-3">{tf("tagsHint")}</p>
                  </>
                )}
              </div>
            </>
          )}

          <InlineError text={error} />
        </div>
      )}
    </Dialog>
  );
}

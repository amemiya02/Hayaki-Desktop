// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's preferences stored in the collection (upstream qt/aqt/preferences.py,
 * `Preferences` in config.proto), shown as Settings sections. Every change is
 * saved at once.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsNote, SettingsRow, SettingsSection } from "@/components/settings";
import { Button, NumberField, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { Preferences } from "@/lib/anki/proto/anki/config_pb";
import { tr } from "@/lib/i18n";
import { tp } from "@/lib/strings/preferences";
import { SelectField, Switch } from "@/screens/deck-options/controls";

import { minsToSecs, secsToMins, withPreference, type Fields, type Groups } from "./model";

const KEY = ["preferences"] as const;

/** A number with Anki's unit after it, such as "mins". */
function Amount({ id, label, unit, value, min, max, onChange }: { id: string; label: string; unit?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <NumberField id={id} label={label} value={value} min={min} max={max} onChange={onChange} />
      {unit && <span className="w-[120px] text-caption text-ink-3">{unit}</span>}
    </div>
  );
}

/** Commits on blur or Enter, so typing does not save on every key. */
function SearchText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };
  return (
    <TextField
      id="pref-default-search"
      className="w-[240px]"
      spellCheck={false}
      placeholder={tr("preferences-default-search-text-example")}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape" && draft !== null) (e.stopPropagation(), setDraft(null));
      }}
    />
  );
}

/** Anki's collection preferences (scheduling, review, editing, backups), as Settings sections. */
export function AnkiPreferencesSections() {
  const client = useQueryClient();
  const { data: prefs, isPending, isError, refetch } = useQuery({ queryKey: KEY, queryFn: () => core.getPreferences() });

  const set = <G extends keyof Groups, K extends keyof Fields<Groups[G]>>(group: G, key: K, value: Groups[G][K]) => {
    const current = client.getQueryData<Preferences>(KEY);
    if (!current) return;
    const next = withPreference(current, group, key, value);
    client.setQueryData(KEY, next);
    core.setPreferences(next).catch((error: unknown) => {
      toast.error(tp("saveError"), { description: error instanceof Error ? error.message : String(error) });
      void client.invalidateQueries({ queryKey: KEY });
    });
  };

  if (isPending) {
    return (
      <SettingsSection title={tr("preferences-scheduler")}>
        <div className="grid h-[104px] place-items-center">
          <Spinner />
        </div>
      </SettingsSection>
    );
  }
  if (isError || !prefs) {
    return (
      <SettingsSection title={tr("preferences-scheduler")}>
        <SettingsRow label={tp("loadError")}>
          <Button size="sm" onClick={() => void refetch()}>
            {tp("retry")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const scheduling = prefs.scheduling;
  const reviewing = prefs.reviewing;
  const editing = prefs.editing;
  const backups = prefs.backups;

  return (
    <>
      <SettingsSection title={tr("preferences-scheduler")}>
        <SettingsRow label={tr("preferences-next-day-starts-at")} htmlFor="pref-rollover">
          <Amount
            id="pref-rollover"
            label={tr("preferences-next-day-starts-at")}
            unit={tr("preferences-hours-past-midnight")}
            value={scheduling?.rollover ?? 4}
            min={0}
            max={23}
            onChange={(v) => set("scheduling", "rollover", v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-learn-ahead-limit")} htmlFor="pref-learn-ahead">
          <Amount
            id="pref-learn-ahead"
            label={tr("preferences-learn-ahead-limit")}
            unit={tr("preferences-mins")}
            value={secsToMins(scheduling?.learnAheadSecs ?? 1200)}
            min={0}
            max={999}
            onChange={(v) => set("scheduling", "learnAheadSecs", minsToSecs(v))}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-timebox-time-limit")} htmlFor="pref-timebox">
          <Amount
            id="pref-timebox"
            label={tr("preferences-timebox-time-limit")}
            unit={tr("preferences-mins")}
            value={secsToMins(reviewing?.timeLimitSecs ?? 0)}
            min={0}
            max={9999}
            onChange={(v) => set("reviewing", "timeLimitSecs", minsToSecs(v))}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tr("preferences-review")}>
        <SettingsRow label={tr("preferences-show-play-buttons-on-cards-with")}>
          <Switch
            label={tr("preferences-show-play-buttons-on-cards-with")}
            checked={!reviewing?.hideAudioPlayButtons}
            onChange={(v) => set("reviewing", "hideAudioPlayButtons", !v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-interrupt-current-audio-when-answering")}>
          <Switch
            label={tr("preferences-interrupt-current-audio-when-answering")}
            checked={!!reviewing?.interruptAudioWhenAnswering}
            onChange={(v) => set("reviewing", "interruptAudioWhenAnswering", v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-show-remaining-card-count")}>
          <Switch
            label={tr("preferences-show-remaining-card-count")}
            checked={!!reviewing?.showRemainingDueCounts}
            onChange={(v) => set("reviewing", "showRemainingDueCounts", v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-show-next-review-time-above-answer")}>
          <Switch
            label={tr("preferences-show-next-review-time-above-answer")}
            checked={!!reviewing?.showIntervalsOnButtons}
            onChange={(v) => set("reviewing", "showIntervalsOnButtons", v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-generate-latex-images-automatically")}>
          <Switch
            label={tr("preferences-generate-latex-images-automatically")}
            checked={!!editing?.renderLatex}
            onChange={(v) => set("editing", "renderLatex", v)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tr("preferences-editing")}>
        <SettingsRow label={tr("preferences-default-deck")} htmlFor="pref-default-deck">
          <SelectField
            id="pref-default-deck"
            label={tr("preferences-default-deck")}
            value={editing?.addingDefaultsToCurrentDeck ? 0 : 1}
            choices={[
              { value: 0, label: tr("preferences-when-adding-default-to-current-deck") },
              { value: 1, label: tr("preferences-change-deck-depending-on-note-type") },
            ]}
            onChange={(v) => set("editing", "addingDefaultsToCurrentDeck", v === 0)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-paste-clipboard-images-as-png")}>
          <Switch
            label={tr("preferences-paste-clipboard-images-as-png")}
            checked={!!editing?.pasteImagesAsPng}
            onChange={(v) => set("editing", "pasteImagesAsPng", v)}
          />
        </SettingsRow>
        <SettingsRow label={tr("preferences-paste-without-shift-key-strips-formatting")}>
          <Switch
            label={tr("preferences-paste-without-shift-key-strips-formatting")}
            checked={!!editing?.pasteStripsFormatting}
            onChange={(v) => set("editing", "pasteStripsFormatting", v)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tr("preferences-browsing")}>
        <SettingsRow label={tr("preferences-default-search-text")} htmlFor="pref-default-search">
          <SearchText value={editing?.defaultSearchText ?? ""} onChange={(v) => set("editing", "defaultSearchText", v)} />
        </SettingsRow>
        <SettingsRow label={tr("preferences-ignore-accents-in-search")}>
          <Switch
            label={tr("preferences-ignore-accents-in-search")}
            checked={!!editing?.ignoreAccentsInSearch}
            onChange={(v) => set("editing", "ignoreAccentsInSearch", v)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={tr("preferences-backups")}>
        <SettingsNote>{tr("preferences-backup-explanation").replace(/\s*\n\s*/g, " ")}</SettingsNote>
        <SettingsRow label={stripColon(tr("preferences-minutes-between-backups"))} htmlFor="pref-backup-mins">
          <NumberField
            id="pref-backup-mins"
            label={stripColon(tr("preferences-minutes-between-backups"))}
            value={backups?.minimumIntervalMins ?? 30}
            min={5}
            max={9999}
            onChange={(v) => set("backups", "minimumIntervalMins", v)}
          />
        </SettingsRow>
        <SettingsRow label={stripColon(tr("preferences-daily-backups"))} htmlFor="pref-backup-daily">
          <NumberField
            id="pref-backup-daily"
            label={stripColon(tr("preferences-daily-backups"))}
            value={backups?.daily ?? 12}
            min={0}
            max={9999}
            onChange={(v) => set("backups", "daily", v)}
          />
        </SettingsRow>
        <SettingsRow label={stripColon(tr("preferences-weekly-backups"))} htmlFor="pref-backup-weekly">
          <NumberField
            id="pref-backup-weekly"
            label={stripColon(tr("preferences-weekly-backups"))}
            value={backups?.weekly ?? 10}
            min={0}
            max={9999}
            onChange={(v) => set("backups", "weekly", v)}
          />
        </SettingsRow>
        <SettingsRow label={stripColon(tr("preferences-monthly-backups"))} htmlFor="pref-backup-monthly">
          <NumberField
            id="pref-backup-monthly"
            label={stripColon(tr("preferences-monthly-backups"))}
            value={backups?.monthly ?? 9}
            min={0}
            max={9999}
            onChange={(v) => set("backups", "monthly", v)}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/** Anki's backup labels end in a colon for a form layout; rows do not need it. */
function stripColon(text: string): string {
  return text.replace(/\s*[:：]\s*$/, "");
}

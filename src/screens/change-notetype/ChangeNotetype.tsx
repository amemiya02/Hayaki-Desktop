// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Change Note Type, rebuilt natively from Anki's Svelte page
 * (ts/routes/change-notetype): pick the new Note Type, then say where each
 * of its fields and Card Templates comes from.
 */
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, Kbd, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { NotetypeNameId } from "@/lib/anki/proto/anki/notetypes_pb";
import { t, tr } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { tcn } from "@/lib/strings/change-notetype";
import { SelectField } from "@/screens/deck-options/controls";
import { schemaModified } from "@/screens/notetypes/schema";

import { fromInfo, mapFor, MapContext, newNames, oldNames, setOld, toRequest, unchanged, unusedItems, type MappingState } from "./model";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ChangeNotetype({ noteIds }: { noteIds: bigint[] }) {
  const back = useNav((s) => s.back);
  const [notetypes, setNotetypes] = useState<NotetypeNameId[] | null>(null);
  const [state, setState] = useState<MappingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsFullSync, setNeedsFullSync] = useState(true);
  const request = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    if (noteIds.length === 0) {
      setError(tcn("noNotes"));
      return;
    }
    try {
      const [{ ntid }, names, modified] = await Promise.all([
        core.getSingleNotetypeOfNotes({ noteIds }),
        core.getNotetypeNames(),
        schemaModified().catch(() => false),
      ]);
      const info = await core.getChangeNotetypeInfo({ oldNotetypeId: ntid, newNotetypeId: ntid });
      setNotetypes(names.entries);
      setState(fromInfo(info));
      setNeedsFullSync(!modified);
    } catch (e) {
      setError(message(e));
    }
  }, [noteIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (index: number) => {
    if (!state || !notetypes) return;
    const target = notetypes[index];
    const oldId = state.info.input?.oldNotetypeId ?? 0n;
    const id = ++request.current;
    setSwitching(true);
    try {
      const info = await core.getChangeNotetypeInfo({ oldNotetypeId: oldId, newNotetypeId: target.id });
      if (id === request.current) setState(fromInfo(info));
    } catch (e) {
      toast.error(message(e));
    } finally {
      if (id === request.current) setSwitching(false);
    }
  };

  const save = async () => {
    if (!state || saving || switching) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (unchanged(state)) {
      toast(tcn("noChanges"));
      return;
    }
    const newName = notetypes?.find((n) => n.id === state.info.input?.newNotetypeId)?.name ?? "";
    const lead = tcn("confirmLead", { count: noteIds.length, old: state.info.oldNotetypeName, new: newName });
    const ok = await confirm({
      title: tr("browsing-change-notetype"),
      message: needsFullSync ? `${lead} ${tr("qt-misc-the-requested-change-will-require-a")}` : lead,
      confirm: tr("actions-save"),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await core.changeNotetype(toRequest(state, noteIds));
      toast.success(tr("browsing-notes-updated", { count: noteIds.length }));
      back();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="max-w-[420px] text-center">
          <h2 className="text-[15px] font-semibold text-ink">{tcn("loadFailed")}</h2>
          <p className="selectable mt-1.5 text-[13px] text-ink-2">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={back}>{tr("actions-close")}</Button>
            {noteIds.length > 0 && (
              <Button variant="primary" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!state || !notetypes) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  const targetIndex = Math.max(0, notetypes.findIndex((n) => n.id === state.info.input?.newNotetypeId));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="max-w-[260px] truncate rounded-[8px] border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-2" title={state.info.oldNotetypeName}>
            {state.info.oldNotetypeName}
          </span>
          <ArrowRight className="size-4 shrink-0 text-ink-3 rtl:rotate-180" aria-hidden="true" />
          <SelectField
            label={tcn("target")}
            value={targetIndex}
            choices={notetypes.map((n, i) => ({ value: i, label: n.name }))}
            onChange={(i) => void pick(i)}
          />
          {switching && <Spinner />}
        </div>
        <span className="tabular ml-auto text-[12.5px] text-ink-3">{tr("browsing-note-count", { count: noteIds.length })}</span>
      </div>

      <div className="min-h-0 flex-1 basis-0 overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-8 px-8 pb-16 pt-6" aria-busy={switching}>
          {needsFullSync && (
            <p className="flex items-start gap-2 rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-snug text-ink-2">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
              <span>{tr("deck-config-will-require-full-sync").replace(/\s+/g, " ")}</span>
            </p>
          )}
          <Mapper state={state} ctx={MapContext.Field} onChange={setState} />
          <Mapper state={state} ctx={MapContext.Template} onChange={setState} />
        </div>
      </div>

      <footer className="flex h-[56px] shrink-0 items-center justify-end gap-3 border-t border-line bg-bg px-5">
        {saving && (
          <span className="mr-auto flex items-center gap-2 text-[12.5px] text-ink-2" aria-live="polite">
            <Spinner />
            {tcn("applying")}
          </span>
        )}
        <Button onClick={back} disabled={saving}>
          {tr("actions-cancel")}
        </Button>
        <Button variant="primary" disabled={saving || switching} onClick={() => void save()} title={`${tr("actions-save")} (Ctrl+Enter)`}>
          {tr("actions-save")}
          <Kbd className="border-transparent bg-[color-mix(in_oklab,var(--on-accent)_18%,transparent)] text-on-accent">Ctrl+Enter</Kbd>
        </Button>
      </footer>
    </div>
  );
}

function Mapper({ state, ctx, onChange }: { state: MappingState; ctx: MapContext; onChange: (state: MappingState) => void }) {
  const title = ctx === MapContext.Field ? tr("change-notetype-fields") : tr("change-notetype-templates");
  const id = ctx === MapContext.Field ? "map-fields" : "map-templates";
  const unused = unusedItems(state, ctx);
  const olds = oldNames(state, ctx);
  const news = newNames(state, ctx);
  const list = mapFor(state, ctx);
  const nothing = olds.length;
  const choices = [...olds.map((name, i) => ({ value: i, label: name })), { value: nothing, label: tr("change-notetype-nothing") }];
  const showMapping = ctx === MapContext.Field || !!state.templates;

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">
        {title}
      </h2>
      {unused.length > 0 && <Unused names={unused} ctx={ctx} />}
      {showMapping ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-3 border-b border-line bg-surface-2 px-4 py-1.5 text-[12px] font-medium text-ink-2">
            <span>{tr("change-notetype-current")}</span>
            <span aria-hidden="true" />
            <span>{tr("change-notetype-new")}</span>
          </div>
          <ul className="divide-y divide-line/60">
            {list.map((old, newIndex) => (
              <li key={`${newIndex}-${news[newIndex]}`} className="grid min-h-[48px] grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-3 px-4 py-2">
                <div className="min-w-0 [&_button]:w-full">
                  <SelectField
                    label={tcnLabel(news[newIndex])}
                    value={old ?? nothing}
                    choices={choices}
                    onChange={(v) => onChange(setOld(state, ctx, newIndex, v === nothing ? null : v))}
                  />
                </div>
                <ArrowRight className="size-4 text-ink-3 rtl:rotate-180" aria-hidden="true" />
                <span className={old === null ? "truncate text-[13.5px] text-ink-3" : "truncate text-[13.5px] text-ink"}>{news[newIndex]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-start gap-2 whitespace-pre-line rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-2">
          <Info className="mt-1 size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          <span>{tr("change-notetype-to-from-cloze").replace(/([^\n])\n(?!\n)/g, "$1 ")}</span>
        </p>
      )}
    </section>
  );
}

function tcnLabel(name: string): string {
  return tcn("mapTo", { new: name });
}

function Unused({ names, ctx }: { names: string[]; ctx: MapContext }) {
  const [expanded, setExpanded] = useState(false);
  const max = 3;
  const lead = ctx === MapContext.Field ? tr("change-notetype-will-discard-content") : tr("change-notetype-will-discard-cards");
  return (
    <div role="status" className="mb-3 flex items-start gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-danger">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p>{lead}</p>
        <p className="mt-0.5 break-words text-ink">
          {expanded || names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} … (+${names.length - max})`}
        </p>
        {names.length > max && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mt-1 rounded-[5px] font-medium text-accent-ink hover:underline">
            {expanded ? tr("change-notetype-collapse") : tr("change-notetype-expand")}
          </button>
        )}
      </div>
    </div>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * One Note Type's Fields and Cards (qt/aqt/fields.py and clayout.py) in one
 * screen with one save bar. Everything is edited on a working copy and
 * written with a single `updateNotetype`.
 */
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { confirm } from "@/components/confirm";
import { Button, Kbd, Segmented, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { Note } from "@/lib/anki/proto/anki/notes_pb";
import type { Notetype } from "@/lib/anki/proto/anki/notetypes_pb";
import { t, tr } from "@/lib/i18n";
import { setLeaveGuard, useNav } from "@/lib/nav";
import { tn } from "@/lib/strings/notetypes";

import { CardsTab, type EditingPart } from "./CardsTab";
import { FieldsTab } from "./FieldsTab";
import { copyNotetype, requiresFullSync, snapshot } from "./model";
import { confirmSchemaChange } from "./schema";

export interface Loaded {
  original: Notetype;
  originalSnapshot: string;
  noteCount: number;
  /** A real Note of this Note Type for the preview, or an empty one. */
  note: Note;
  realNote: boolean;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function NotetypeEditor({ notetypeId, tab }: { notetypeId: bigint; tab?: "fields" | "templates" | "styling" }) {
  const back = useNav((s) => s.back);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<Notetype | null>(null);
  const workingRef = useRef<Notetype | null>(null);
  const [view, setView] = useState<"fields" | "cards">(tab === "fields" || tab === undefined ? "fields" : "cards");
  const [part, setPart] = useState<EditingPart>(tab === "styling" ? "styling" : "front");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const nt = await core.getNotetype({ ntid: notetypeId });
      const ids = await core.searchNotes({ search: `mid:${notetypeId}`, order: { value: { case: "none", value: {} } } });
      const realNote = ids.ids.length > 0;
      const note = realNote ? await core.getNote({ nid: ids.ids[0] }) : await core.newNote({ ntid: notetypeId });
      const copy = copyNotetype(nt);
      workingRef.current = copy;
      setWorking(copy);
      setLoaded({ original: nt, originalSnapshot: snapshot(nt), noteCount: ids.ids.length, note, realNote });
    } catch (e) {
      setError(message(e));
    }
  }, [notetypeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((fn: (nt: Notetype) => Notetype) => {
    if (!workingRef.current) return;
    workingRef.current = fn(workingRef.current);
    setWorking(workingRef.current);
  }, []);

  const dirty = useMemo(() => !!working && !!loaded && snapshot(working) !== loaded.originalSnapshot, [working, loaded]);
  const fullSync = useMemo(() => !!working && !!loaded && requiresFullSync(loaded.original, working), [working, loaded]);

  const askDiscard = useCallback(
    () =>
      confirm({
        title: tr("card-templates-discard-changes"),
        message: tn("discardLead"),
        confirm: tr("actions-discard"),
        danger: true,
      }),
    [],
  );

  const removeGuard = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const remove = setLeaveGuard((proceed) => {
      void askDiscard().then((ok) => ok && proceed());
      return false;
    });
    removeGuard.current = remove;
    return () => {
      remove();
      if (removeGuard.current === remove) removeGuard.current = null;
    };
  }, [dirty, askDiscard]);

  const leaveNow = useCallback(() => {
    removeGuard.current?.();
    removeGuard.current = null;
    back();
  }, [back]);

  const commitEditing = async () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.tagName === "INPUT") document.activeElement.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const save = async () => {
    if (saving || !loaded) return;
    await commitEditing();
    const current = workingRef.current;
    if (!current || snapshot(current) === loaded.originalSnapshot) return;
    if (requiresFullSync(loaded.original, current) && !(await confirmSchemaChange(tr("actions-save"), tr("actions-save")))) return;
    setSaving(true);
    try {
      await core.updateNotetype(current);
      toast.success(tr("card-templates-changes-saved"));
      leaveNow();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    await commitEditing();
    const current = workingRef.current;
    if (current && loaded && snapshot(current) !== loaded.originalSnapshot) {
      if (await askDiscard()) leaveNow();
    } else {
      leaveNow();
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
          <h2 className="text-[15px] font-semibold text-ink">{tn("loadFailed")}</h2>
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

  if (!loaded || !working) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <Spinner />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-ink" title={working.name}>
            {working.name}
          </h2>
          <p className="tabular truncate text-[12px] text-ink-3">{tr("card-templates-changes-will-affect-notes", { count: loaded.noteCount })}</p>
        </div>
        <Segmented
          label={tr("notetypes-notetype")}
          value={view}
          options={[
            { value: "fields", label: tr("notetypes-fields") },
            { value: "cards", label: tr("notetypes-cards") },
          ]}
          onChange={setView}
        />
      </div>

      <div className="min-h-0 flex-1 basis-0">
        {view === "fields" ? (
          <FieldsTab working={working} original={loaded.original} noteCount={loaded.noteCount} update={update} />
        ) : (
          <CardsTab working={working} loaded={loaded} update={update} part={part} onPart={setPart} />
        )}
      </div>

      <footer className="flex h-[56px] shrink-0 items-center gap-3 border-t border-line bg-bg px-5">
        <div className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2" aria-live="polite">
          {saving ? (
            <>
              <Spinner />
              {tn("saving")}
            </>
          ) : (
            dirty && (
              <>
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="truncate">{tn("unsaved")}</span>
                {fullSync && (
                  <span className="ml-2 flex min-w-0 items-center gap-1.5 text-ink-3">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{tn("fullSyncNotice")}</span>
                  </span>
                )}
              </>
            )
          )}
        </div>
        <Button onClick={() => void leave()} disabled={saving}>
          {dirty ? tr("actions-discard") : tr("actions-close")}
        </Button>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()} title={`${tr("actions-save")} (Ctrl+Enter)`}>
          {tr("actions-save")}
          <Kbd className="border-transparent bg-[color-mix(in_oklab,var(--on-accent)_18%,transparent)] text-on-accent">Ctrl+Enter</Kbd>
        </Button>
      </footer>
    </div>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Anki's Tools: Check Database, Check Media, Empty Cards and backups. */
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";

import { Button, Dialog, Spinner } from "@/components/ui";
import { confirm } from "@/components/confirm";
import * as core from "@/lib/anki/generated/core";
import type { CheckMediaResponse } from "@/lib/anki/proto/anki/media_pb";
import type { EmptyCardsReport } from "@/lib/anki/proto/anki/card_rendering_pb";
import { t, tr } from "@/lib/i18n";

type Report =
  | { kind: "database"; busy: boolean; problems: string[] | null }
  | { kind: "media"; busy: boolean; result: CheckMediaResponse | null }
  | { kind: "empty"; busy: boolean; result: EmptyCardsReport | null };

const useTools = create<{ report: Report | null }>(() => ({ report: null }));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function checkDatabase(): Promise<void> {
  useTools.setState({ report: { kind: "database", busy: true, problems: null } });
  try {
    const result = await core.checkDatabase();
    useTools.setState({ report: { kind: "database", busy: false, problems: result.problems } });
  } catch (error) {
    useTools.setState({ report: null });
    toast.error(tr("database-check-title"), { description: errorText(error) });
  }
}

export async function checkMedia(): Promise<void> {
  useTools.setState({ report: { kind: "media", busy: true, result: null } });
  try {
    const result = await core.checkMedia();
    useTools.setState({ report: { kind: "media", busy: false, result } });
  } catch (error) {
    useTools.setState({ report: null });
    toast.error(tr("media-check-window-title"), { description: errorText(error) });
  }
}

export async function emptyCards(): Promise<void> {
  useTools.setState({ report: { kind: "empty", busy: true, result: null } });
  try {
    const result = await core.getEmptyCards();
    useTools.setState({ report: { kind: "empty", busy: false, result } });
  } catch (error) {
    useTools.setState({ report: null });
    toast.error(tr("empty-cards-window-title"), { description: errorText(error) });
  }
}

export async function createBackup(): Promise<void> {
  const id = toast.loading(t("tools.backingUp"));
  try {
    await invoke<boolean>("collection_backup");
    toast.success(t("tools.backupCreated"), { id });
  } catch (error) {
    toast.error(t("tools.backupFailed"), { id, description: errorText(error) });
  }
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="selectable max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-surface-2 p-3 font-sans text-caption leading-relaxed text-ink-2">
      {text}
    </pre>
  );
}

export function ToolsHost() {
  const report = useTools((s) => s.report);
  const [keepNotes, setKeepNotes] = useState(true);
  const [working, setWorking] = useState(false);
  const close = () => useTools.setState({ report: null });
  /** Runs one of the Check Media actions; the dialog closes after it unless it keeps the report. */
  const run = async (action: () => Promise<void>, closeAfter = true) => {
    setWorking(true);
    try {
      await action();
      if (closeAfter) close();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  if (!report) return null;

  const busy = report.busy && (
    <div className="flex items-center gap-2 py-6 text-control text-ink-2">
      <Spinner />
      {tr("database-check-checking-integrity")}
    </div>
  );

  if (report.kind === "database") {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && close()}
        title={tr("database-check-title")}
        width={520}
        footer={<Button variant="primary" onClick={close}>{t("common.close")}</Button>}
      >
        {busy || <Pre text={report.problems?.length ? report.problems.join("\n") : tr("database-check-rebuilt")} />}
      </Dialog>
    );
  }

  if (report.kind === "media") {
    const result = report.result;
    const deleteUnused = async () => {
      if (!result) return;
      const ok = await confirm({
        title: tr("media-check-delete-unused"),
        message: tr("media-check-delete-unused-confirm"),
        confirm: tr("media-check-delete-unused"),
        danger: true,
      });
      if (!ok) return;
      await run(async () => {
        await core.trashMediaFiles({ fnames: result.unused });
        toast.success(tr("media-check-delete-unused-complete", { count: result.unused.length }));
      });
    };
    // Notes that reference a file the media folder lacks get the `missing-media` tag, as upstream.
    const tagMissing = () =>
      run(async () => {
        await core.addNoteTags({ noteIds: result?.missingMediaNotes ?? [], tags: tr("media-check-missing-media-tag") });
        toast.success(tr("media-check-add-tag"));
      }, false);
    const hasMissing = (result?.missing.length ?? 0) > 0;
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && close()}
        title={tr("media-check-window-title")}
        width={560}
        footer={
          <>
            {result && result.unused.length > 0 && (
              <Button variant="danger" disabled={working} onClick={() => void deleteUnused()}>
                {tr("media-check-delete-unused")}
              </Button>
            )}
            {hasMissing && (
              <Button disabled={working} onClick={() => void tagMissing()}>
                {tr("media-check-add-tag")}
              </Button>
            )}
            {result?.haveTrash && (
              <>
                <Button
                  disabled={working}
                  onClick={() =>
                    void run(async () => {
                      await core.emptyTrash();
                      toast.success(tr("media-check-trash-emptied"));
                    })
                  }
                >
                  {tr("media-check-empty-trash")}
                </Button>
                <Button
                  disabled={working}
                  onClick={() =>
                    void run(async () => {
                      await core.restoreTrash();
                      toast.success(tr("media-check-trash-restored"));
                    })
                  }
                >
                  {tr("media-check-restore-trash")}
                </Button>
              </>
            )}
            <Button variant="primary" onClick={close}>{t("common.close")}</Button>
          </>
        }
      >
        {busy || (result && <Pre text={result.report} />)}
      </Dialog>
    );
  }

  const result = report.result;
  const deleteEmpty = async () => {
    if (!result) return;
    const cardIds: bigint[] = [];
    for (const note of result.notes) {
      // Keeping a note means leaving its first card when every card is empty.
      cardIds.push(...(keepNotes && note.willDeleteNote ? note.cardIds.slice(1) : note.cardIds));
    }
    const out = await core.removeCards({ cardIds });
    toast.success(tr("empty-cards-deleted-count", { count: out.count }));
    close();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={tr("empty-cards-window-title")}
      width={560}
      footer={
        <>
          <Button onClick={close}>{t("common.close")}</Button>
          {result && result.notes.length > 0 && (
            <Button variant="danger" onClick={() => void deleteEmpty()}>
              {tr("empty-cards-delete-button")}
            </Button>
          )}
        </>
      }
    >
      {busy ||
        (result && (
          <div className="flex flex-col gap-3">
            {result.notes.length === 0 ? (
              <p className="text-control text-ink-2">{tr("empty-cards-not-found")}</p>
            ) : (
              <>
                <div className="selectable max-h-[40vh] overflow-auto rounded-[8px] border border-line bg-surface-2 p-3 text-caption text-ink-2" dangerouslySetInnerHTML={{ __html: sanitizeReport(result.report) }} />
                <label className="flex items-center gap-2 text-control text-ink">
                  <input type="checkbox" checked={keepNotes} onChange={(e) => setKeepNotes(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  {tr("empty-cards-preserve-notes-checkbox")}
                </label>
              </>
            )}
          </div>
        ))}
    </Dialog>
  );
}

/** The empty-cards report is HTML from the core; keep only its text structure. */
function sanitizeReport(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) if (attr.name.startsWith("on") || attr.name === "href" || attr.name === "src") el.removeAttribute(attr.name);
  });
  return doc.body.innerHTML;
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The reviewer's dialogs: Set Due Date and Reset Card with the reviewer's own
 * remembered defaults (Anki's `SET_DUE_REVIEWER` and the reviewer context),
 * the timebox notice, and Edit Current.
 */
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { NoteEditor } from "@/components/editor/NoteEditor";
import { Button, Dialog, Spinner, TextField } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { ConfigKey_String } from "@/lib/anki/proto/anki/config_pb";
import { ScheduleCardsAsNewRequest_Context } from "@/lib/anki/proto/anki/scheduler_pb";
import { tr } from "@/lib/i18n";
import type { TimeboxReached } from "@/lib/study/review-flow";
import { Checkbox } from "@/screens/browse/dialogs";

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Footer({ busy, label, disabled, onCancel, onConfirm }: { busy: boolean; label: string; disabled?: boolean; onCancel: () => void; onConfirm: () => void }): ReactNode {
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

export function SetDueDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (days: string) => Promise<void> }) {
  const [days, setDays] = useState<string | null>(null);
  const { busy, run } = useSubmit(onClose);
  useEffect(() => {
    void core
      .getConfigString({ key: ConfigKey_String.SET_DUE_REVIEWER })
      .then((v) => setDays((d) => d ?? v.val))
      .catch(() => setDays((d) => d ?? ""));
  }, []);
  const value = (days ?? "").trim();
  const submit = () => value && void run(() => onSubmit(value));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("actions-set-due-date")}
      footer={<Footer busy={busy} label={tr("actions-set-due-date")} disabled={!value} onCancel={onClose} onConfirm={submit} />}
    >
      <label htmlFor="study-due" className="mb-1.5 block text-caption font-medium text-ink-2">
        {tr("scheduling-set-due-date-prompt", { cards: 1 })}
      </label>
      <TextField
        id="study-due"
        autoFocus
        value={days ?? ""}
        disabled={days === null}
        onChange={(e) => setDays(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="tabular"
        spellCheck={false}
      />
      <p className="mt-2 whitespace-pre-line text-caption leading-relaxed text-ink-3">{tr("scheduling-set-due-date-prompt-hint")}</p>
    </Dialog>
  );
}

export function ForgetDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (restorePosition: boolean, resetCounts: boolean) => Promise<void> }) {
  const [restore, setRestore] = useState(true);
  const [reset, setReset] = useState(false);
  const { busy, run } = useSubmit(onClose);
  useEffect(() => {
    void core
      .scheduleCardsAsNewDefaults({ context: ScheduleCardsAsNewRequest_Context.REVIEWER })
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

/** Anki's timebox message box: Continue starts a new timebox, Finish leaves study. */
export function TimeboxDialog({ notice, onContinue, onFinish }: { notice: TimeboxReached; onContinue: () => void; onFinish: () => void }) {
  // Anki passes the minutes as text, and collapses the message's line breaks.
  const message = tr("studying-card-studied-in-minute", { cards: notice.cards, minutes: String(notice.minutes) })
    .replace(/\s+/g, " ")
    .trim();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onContinue()}
      title={message}
      footer={
        <>
          <Button onClick={onFinish}>{tr("studying-finish")}</Button>
          <Button variant="primary" autoFocus onClick={onContinue}>
            {tr("studying-continue")}
          </Button>
        </>
      }
    />
  );
}

/** Edit Current: the Note's fields in place; closing returns to the same Card. */
export function EditCurrentDialog({ noteId, onClose }: { noteId: bigint; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr("editing-edit-current")}
      width={760}
      footer={
        <Button variant="primary" onClick={onClose}>
          {tr("actions-close")}
        </Button>
      }
    >
      <div className="-mx-5 h-[min(62vh,620px)] border-y border-line">
        <NoteEditor noteId={noteId} autoFocus />
      </div>
    </Dialog>
  );
}

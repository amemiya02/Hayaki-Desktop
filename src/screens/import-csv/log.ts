// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The import log, grouped as upstream's ImportLogPage groups it
 * (ts/routes/import-page/lib.ts). Text is kept as ftl keys so it stays testable.
 */
import { CsvMetadata_DupeResolution, type ImportResponse_Log, type ImportResponse_Note } from "@/lib/anki/proto/anki/import_export_pb";

export interface LogQueue {
  reason: string;
  notes: ImportResponse_Note[];
}

export type SummaryKind = "added" | "skipped" | "updated" | "failed";

export interface Summary {
  kind: SummaryKind;
  queues: LogQueue[];
  /** Status shown in the details table. */
  action: string;
  /** Count template, called with `{ count }`. */
  summary: string;
  canBrowse: boolean;
}

function firstFieldQueue(log: ImportResponse_Log): { action: string; queue: LogQueue } {
  if (log.dupeResolution === CsvMetadata_DupeResolution.DUPLICATE) {
    return { action: "importing-added", queue: { reason: "importing-duplicate-note-added", notes: log.firstFieldMatch } };
  }
  if (log.dupeResolution === CsvMetadata_DupeResolution.PRESERVE) {
    return { action: "importing-skipped", queue: { reason: "importing-existing-note-skipped", notes: log.firstFieldMatch } };
  }
  return { action: "importing-updated", queue: { reason: "importing-note-updated-as-file-had-newer", notes: log.firstFieldMatch } };
}

export function summaries(log: ImportResponse_Log): Summary[] {
  const list: Summary[] = [
    {
      kind: "added",
      queues: [{ notes: log.new, reason: "importing-added-new-note" }],
      action: "adding-added",
      summary: "importing-notes-added",
      canBrowse: true,
    },
    {
      kind: "skipped",
      queues: [{ notes: log.duplicate, reason: "importing-existing-note-skipped" }],
      action: "importing-skipped",
      summary: "importing-existing-notes-skipped",
      canBrowse: true,
    },
    {
      kind: "updated",
      queues: [{ notes: log.updated, reason: "importing-note-updated-as-file-had-newer" }],
      action: "importing-updated",
      summary: "importing-notes-updated",
      canBrowse: true,
    },
    {
      kind: "failed",
      queues: [
        { notes: log.conflicting, reason: "importing-note-skipped-update-due-to-notetype2" },
        { notes: log.missingNotetype, reason: "importing-note-skipped-due-to-missing-notetype" },
        { notes: log.missingDeck, reason: "importing-note-skipped-due-to-missing-deck" },
        { notes: log.emptyFirstField, reason: "importing-note-skipped-due-to-empty-first-field" },
      ],
      action: "importing-skipped",
      summary: "importing-notes-failed",
      canBrowse: false,
    },
  ];
  // Upstream's action strings differ from its first summary ("adding-added" vs "importing-added"),
  // so first-field matches added as duplicates join the "added" group by kind.
  const first = firstFieldQueue(log);
  const target = first.action === "importing-added" ? list[0] : list.find((s) => s.action === first.action);
  target?.queues.push(first.queue);
  return list;
}

export function summaryCount(summary: Summary): number {
  return summary.queues.reduce((n, q) => n + q.notes.length, 0);
}

export interface LogRow {
  summary: Summary;
  queue: LogQueue;
  note: ImportResponse_Note;
}

export function logRows(list: Summary[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const summary of list) for (const queue of summary.queues) for (const note of queue.notes) rows.push({ summary, queue, note });
  return rows;
}

/** A Browse search for the given notes. */
export function notesSearch(notes: ImportResponse_Note[]): string {
  const ids = notes.map((n) => n.id?.nid).filter((id): id is bigint => id !== undefined);
  return `nid:${ids.join(",")}`;
}

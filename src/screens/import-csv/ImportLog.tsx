// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The result of an import: an overview and every note's outcome (upstream ImportLogPage). */
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, CirclePlus, RefreshCw, Search, XCircle } from "lucide-react";
import { useMemo, useRef } from "react";

import { Button, cn, IconButton } from "@/components/ui";
import type { ImportResponse, ImportResponse_Note } from "@/lib/anki/proto/anki/import_export_pb";
import { tr } from "@/lib/i18n";

import { logRows, summaries, summaryCount, type SummaryKind } from "./log";

const ICONS: Record<SummaryKind, typeof CirclePlus> = {
  added: CirclePlus,
  skipped: CheckCircle2,
  updated: RefreshCw,
  failed: XCircle,
};

const ICON_TONE: Record<SummaryKind, string> = {
  added: "text-new",
  skipped: "text-ink-3",
  updated: "text-due",
  failed: "text-danger",
};

const ROW = 34;

function plain(fields: string[]): string {
  return fields.map((f) => f.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()).join(", ");
}

export function ImportLog({ response, onBrowse, maxTableHeight = 420 }: { response: ImportResponse; onBrowse: (notes: ImportResponse_Note[]) => void; maxTableHeight?: number }) {
  const log = response.log;
  const list = useMemo(() => (log ? summaries(log) : []), [log]);
  const rows = useMemo(() => logRows(list), [list]);
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 12 });

  if (!log) return null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="import-overview">
        <h2 id="import-overview" className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">
          {tr("importing-overview")}
        </h2>
        <div className="rounded-[12px] border border-line bg-surface px-4 py-3">
          <p className="text-[13.5px] text-ink">{tr("importing-notes-found-in-file2", { notes: log.foundNotes })}</p>
          <ul className="mt-2 flex flex-col">
            {list.map((summary) => {
              const count = summaryCount(summary);
              if (!count) return null;
              const Icon = ICONS[summary.kind];
              return (
                <li key={summary.kind} className="flex min-h-8 items-center gap-2.5 text-[13px] text-ink">
                  <Icon className={cn("size-4 shrink-0", ICON_TONE[summary.kind])} aria-hidden="true" />
                  <span className="tabular flex-1">{tr(summary.summary, { count })}</span>
                  {summary.canBrowse && (
                    <Button size="sm" variant="ghost" onClick={() => onBrowse(summary.queues.flatMap((q) => q.notes))}>
                      {tr("importing-show")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {rows.length > 0 && (
        <section aria-labelledby="import-details">
          <h2 id="import-details" className="mb-2.5 px-1 text-[13px] font-semibold text-ink-2">
            {tr("importing-details")}
          </h2>
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div role="row" className="grid h-8 grid-cols-[56px_120px_1fr_44px] items-center border-b border-line bg-surface-2 px-2 text-[12px] font-medium text-ink-3">
              <span role="columnheader" className="px-2 text-right">
                #
              </span>
              <span role="columnheader" className="px-2">
                {tr("importing-status")}
              </span>
              <span role="columnheader" className="px-2">
                {tr("editing-fields")}
              </span>
              <span />
            </div>
            <div ref={scroller} role="table" aria-label={tr("importing-details")} className="overflow-y-auto" style={{ maxHeight: maxTableHeight }}>
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];
                  const text = plain(row.note.fields);
                  return (
                    <div
                      key={item.key}
                      role="row"
                      className="absolute inset-x-0 grid grid-cols-[56px_120px_1fr_44px] items-center border-b border-line px-2 text-[13px] last:border-b-0"
                      style={{ top: item.start, height: ROW }}
                    >
                      <span role="cell" className="tabular px-2 text-right text-ink-3">
                        {item.index + 1}
                      </span>
                      <span role="cell" title={tr(row.queue.reason)} className={cn("truncate px-2", row.summary.kind === "failed" ? "text-danger" : "text-ink-2")}>
                        {tr(row.summary.action)}
                      </span>
                      <span role="cell" title={text} className="selectable truncate px-2 text-ink">
                        {text}
                      </span>
                      <span role="cell" className="grid place-items-center">
                        {row.summary.canBrowse && (
                          <IconButton size="sm" label={tr("importing-show")} onClick={() => onBrowse([row.note])}>
                            <Search />
                          </IconButton>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

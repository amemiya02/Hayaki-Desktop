// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Card Info, rebuilt natively from Anki's Svelte page (ts/routes/card-info):
 * the Card's statistics, its review log and, with FSRS, its forgetting curve.
 */
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { Button, cn, Dialog, IconButton, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import type { CardStatsResponse } from "@/lib/anki/proto/anki/stats_pb";
import { t, tr } from "@/lib/i18n";
import { tci } from "@/lib/strings/card-info";

import { ForgettingCurve } from "./ForgettingCurve";
import { decayFromParams, revlogRows, rowsFromStats, type KindTone } from "./model";

export function CardInfoDialog({ cardId, onClose }: { cardId: bigint; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["cardInfo", String(cardId)],
    queryFn: () => core.cardStats({ cid: cardId }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={tr("actions-card-info")} width={780}>
      <div className="pb-4">
        {query.isError ? (
          <div className="grid min-h-[240px] place-items-center text-center">
            <div>
              <p className="text-[13px] font-medium text-ink">{tci("loadFailed")}</p>
              <p className="selectable mt-1 text-[12.5px] text-ink-2">{String((query.error as Error)?.message ?? query.error)}</p>
              <Button className="mt-4" onClick={() => void query.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
        ) : !query.data ? (
          <div className="grid min-h-[240px] place-items-center" aria-busy="true">
            <div className="flex items-center gap-2 text-[13px] text-ink-3">
              <Spinner />
              {t("common.loading")}
            </div>
          </div>
        ) : (
          <CardInfoBody key={String(query.data.cardId)} stats={query.data} />
        )}
      </div>
    </Dialog>
  );
}

function CardInfoBody({ stats }: { stats: CardStatsResponse }) {
  const rows = useMemo(() => rowsFromStats(stats), [stats]);
  const fsrs = stats.memoryState != null;
  return (
    <div className="space-y-6">
      <section aria-label={tr("actions-card-info")}>
        <dl className="grid grid-cols-1 overflow-hidden rounded-[12px] border border-line bg-surface sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex min-h-[38px] items-center gap-4 border-b border-line/60 px-4 py-2 sm:odd:border-r"
            >
              <dt className="w-[42%] shrink-0 text-[12.5px] text-ink-2">{row.label}</dt>
              <dd className="selectable tabular flex min-w-0 flex-1 items-center gap-1 text-[13px] text-ink">
                <span className="min-w-0 break-words">{row.value}</span>
                {row.copyable && (
                  <IconButton
                    label={`${tci("copyId")} ${row.label}`}
                    size="sm"
                    className="-my-1 ml-auto size-6 text-ink-3 [&_svg]:size-3.5"
                    onClick={() => {
                      void navigator.clipboard.writeText(row.value).then(() => toast.success(tci("copied")));
                    }}
                  >
                    <Copy />
                  </IconButton>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Revlog stats={stats} />

      {fsrs && stats.revlog.length > 0 && (
        <ForgettingCurve
          revlog={stats.revlog}
          desiredRetention={stats.desiredRetention ?? 0.9}
          decay={decayFromParams(stats.fsrsParams)}
        />
      )}
    </div>
  );
}

const toneClass: Record<KindTone, string> = {
  new: "text-new",
  due: "text-due",
  learn: "text-learn",
  plain: "text-ink-2",
};

const ratingClass = ["text-ink-3", "text-again", "text-hard", "text-good", "text-easy"];

function Revlog({ stats }: { stats: CardStatsResponse }) {
  const rows = useMemo(() => revlogRows(stats.revlog), [stats.revlog]);
  return (
    <section aria-labelledby="card-info-revlog">
      <h3 id="card-info-revlog" className="mb-2 px-1 text-[13px] font-semibold text-ink-2">
        {tci("reviewLog")}
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-[12px] border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">{tci("noReviews")}</p>
      ) : (
        <div className="max-h-[320px] overflow-auto rounded-[12px] border border-line bg-surface">
          <table className="tabular w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-left text-[12px] font-medium text-ink-2">
                <th scope="col" className="h-8 px-4 font-medium">{tr("card-stats-review-log-date")}</th>
                <th scope="col" className="h-8 px-3 font-medium">{tr("card-stats-review-log-type")}</th>
                <th scope="col" className="h-8 px-3 text-center font-medium">{tr("card-stats-review-log-rating")}</th>
                <th scope="col" className="h-8 px-3 text-right font-medium">{tr("card-stats-interval")}</th>
                <th scope="col" className="h-8 px-3 text-right font-medium">{tr("card-stats-ease")}</th>
                <th scope="col" className="h-8 px-3 text-right font-medium">{tr("card-stats-review-log-elapsed-time")}</th>
                <th scope="col" className="h-8 px-4 text-right font-medium">{tr("card-stats-review-log-time-taken")}</th>
              </tr>
            </thead>
            <tbody className="selectable">
              {rows.map((row) => (
                <tr key={row.key} className="h-8 border-t border-line/60">
                  <td className="whitespace-nowrap px-4">
                    <span className="font-medium text-ink">{row.date}</span>
                    <span className="ml-1.5 text-ink-3">{row.time}</span>
                  </td>
                  <td className={cn("whitespace-nowrap px-3", toneClass[row.kindTone])}>{row.kind}</td>
                  <td className={cn("px-3 text-center font-semibold", ratingClass[row.rating] ?? "text-ink-3")}>{row.rating}</td>
                  <td className="whitespace-nowrap px-3 text-right text-ink">{row.interval}</td>
                  <td className="whitespace-nowrap px-3 text-right text-ink-2">{row.ease}</td>
                  <td className="whitespace-nowrap px-3 text-right text-ink-2">{row.elapsed}</td>
                  <td className="whitespace-nowrap px-4 text-right text-ink-2">{row.taken}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

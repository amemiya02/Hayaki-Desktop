// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Each Statistics section, with upstream's titles, descriptions and figures. */
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, IconButton, Menu, MenuCheckItem, MenuContent, MenuLabel, MenuTrigger, Segmented } from "@/components/ui";
import type { GraphsResponse } from "@/lib/anki/proto/anki/stats_pb";
import { tr } from "@/lib/i18n";
import { ts } from "@/lib/strings/stats";

import { buildCalendar, dailyTotals } from "./calendar";
import { BarChart, ChartEmpty, Legend, type Bar, type Tip } from "./Chart";
import { answerColor, filteredColor, measureColor, stateColor } from "./colors";
import {
  addedQuery,
  buildAdded,
  buildButtons,
  buildCardCounts,
  buildEase,
  buildFutureDue,
  buildHours,
  buildIntervals,
  buildPercentage,
  buildReviews,
  buildToday,
  buildTrueRetention,
  cumulative,
  easePercentLabel,
  easeQuery,
  futureDueDays,
  futureDueQuery,
  gatherFutureDue,
  gatherIntervals,
  gatherReviews,
  intervalQuery,
  percentQuery,
  retentionRatio,
  reviewDays,
  studiedPercentPrecision,
  totalOf,
  type ButtonGroup,
  type CardState,
  type GraphRange,
  type Histogram,
  type IntervalRange,
  type PercentageRange,
  type RetentionPeriod,
  type RevlogRange,
} from "./data";
import { capitalize, dayLabel, HOURS_UNIT, intervalLabel, MONTH, num, percentFormat, studiedToday as studiedTodayText, timeSpan, trs, weekdayLabel } from "./format";
import { Heatmap } from "./Heatmap";
import { Figures, Panel, Toggle } from "./Panel";

export interface Prefs {
  calendarFirstDayOfWeek: number;
  cardCountsSeparateInactive: boolean;
  futureDueShowBacklog: boolean;
}

export interface SectionProps {
  data: GraphsResponse;
  range: GraphRange;
  revlogRange: RevlogRange;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  /** Opens Browse with the screen's search narrowed by `query`. */
  browse: (query: string) => void;
}

const noData = () => <ChartEmpty>{ts("noData")}</ChartEmpty>;

/** Bars for a one-colour histogram with an optional running total. */
function histogramBars(
  h: Histogram,
  color: (x0: number) => string,
  tip: (b: Histogram["bins"][number], running: number) => Tip,
  query?: (b: Histogram["bins"][number]) => string,
  browse?: (q: string) => void,
): { bars: Bar[]; line?: { points: [number, number][]; max: number; format: (n: number) => string } } {
  const running = cumulative(h.bins);
  const bars = h.bins.map((b, i) => ({
    x0: b.x0,
    x1: b.x1,
    segments: [{ value: b.value, color: color(b.x0) }],
    tip: tip(b, running[i]),
    onActivate: query && browse && b.entries > 0 ? () => browse(query(b)) : undefined,
  }));
  if (!h.showArea || !h.total) return { bars };
  const points: [number, number][] = [[h.bins[0]?.x0 ?? h.domain[0], 0], ...h.bins.map((b, i): [number, number] => [b.x1, running[i]])];
  return { bars, line: { points, max: h.total, format: (n) => num(n) } };
}

/* ------------------------------ Today ------------------------------ */

export function TodaySection({ data }: SectionProps) {
  const t = buildToday(data);
  return (
    <Panel title={tr("statistics-today-title")} description={ts("todayLead")} wide>
      {t ? (
        <div className="selectable space-y-1.5 text-body text-ink-2">
          <p className="text-title font-medium text-ink">{studiedLine(t.answerCount, t.answerSecs)}</p>
          <p className="tabular">
            {tr("statistics-today-again-count")} {t.againCount} ({num(t.againPercent)}%)
          </p>
          <p className="tabular">
            {trs("statistics-today-type-counts", {
              learnCount: t.learnCount,
              reviewCount: t.reviewCount,
              relearnCount: t.relearnCount,
              filteredCount: t.filteredCount,
            })}
          </p>
          <p className="tabular">
            {t.matureCount
              ? trs("statistics-today-correct-mature", { correct: t.matureCorrect, total: t.matureCount, percent: t.maturePercent })
              : tr("statistics-today-no-mature-cards")}
          </p>
        </div>
      ) : (
        <p className="text-body text-ink-2">{tr("statistics-today-no-cards")}</p>
      )}
    </Panel>
  );
}

function studiedLine(cards: number, secs: number): string {
  // Anki's sentence spans lines in its source; show it as one.
  return studiedTodayText(cards, secs).replace(/\s*\n\s*/g, " ");
}

/* ------------------------------ Future due ------------------------------ */

export function FutureDueSection({ data, range, prefs, setPref, browse }: SectionProps) {
  const source = useMemo(() => gatherFutureDue(data), [data]);
  const r = buildFutureDue(source, range, prefs.futureDueShowBacklog);
  const chart =
    r &&
    histogramBars(
      r.histogram,
      () => stateColor.young,
      (b, running) => {
        const [s, e] = futureDueDays(b, r.xMax);
        return {
          title: dayLabel(s, e),
          lines: [trs("statistics-cards-due", { cards: b.value }), `${tr("statistics-running-total")}: ${num(running)}`],
        };
      },
      (b) => futureDueQuery(b, r.xMax),
      browse,
    );
  return (
    <Panel
      title={tr("statistics-future-due-title")}
      description={tr("statistics-future-due-subtitle")}
      controls={
        source.haveBacklog && (
          <Toggle label={tr("statistics-backlog-checkbox")} checked={prefs.futureDueShowBacklog} onChange={(v) => setPref("futureDueShowBacklog", v)} />
        )
      }
    >
      {r && chart ? (
        <>
          <BarChart label={tr("statistics-future-due-title")} bars={chart.bars} domain={r.histogram.domain} line={chart.line} />
          <Figures
            items={[
              { label: tr("statistics-total"), value: trs("statistics-reviews", { reviews: r.total }) },
              { label: tr("statistics-average"), value: trs("statistics-reviews-per-day", { count: r.averagePerDay }) },
              { label: tr("statistics-due-tomorrow"), value: trs("statistics-reviews", { reviews: r.dueTomorrow }) },
              { label: tr("statistics-daily-load"), value: trs("statistics-reviews-per-day", { count: r.dailyLoad }) },
            ]}
          />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

/* ------------------------------ Calendar ------------------------------ */

const WEEK_STARTS = [0, 1, 5, 6];

export function CalendarSection({ data, revlogRange, prefs, setPref, browse }: SectionProps) {
  const maxYear = new Date().getFullYear();
  const totals = useMemo(() => dailyTotals(data.reviews?.count ?? {}), [data]);
  const minYear = useMemo(() => {
    if (revlogRange === "year") return maxYear - 1;
    const oldest = Math.min(0, ...totals.keys());
    return Math.min(maxYear, new Date(Date.now() + oldest * 864e5).getFullYear());
  }, [revlogRange, totals, maxYear]);
  const [year, setYear] = useState(maxYear);
  const target = Math.max(minYear, Math.min(maxYear, year));
  const cal = buildCalendar(totals, data.rolloverHour, prefs.calendarFirstDayOfWeek, target, revlogRange);

  return (
    <Panel
      title={tr("statistics-calendar-title")}
      description={ts("calendarLead")}
      wide
      controls={
        <>
          <div className="inline-flex items-center gap-0.5" dir="ltr">
            <IconButton label={ts("previousYear")} size="sm" disabled={target <= minYear} onClick={() => setYear(target - 1)}>
              <ChevronLeft />
            </IconButton>
            <span className="min-w-[44px] text-center text-control font-medium tabular text-ink">{target}</span>
            <IconButton label={ts("nextYear")} size="sm" disabled={target >= maxYear} onClick={() => setYear(target + 1)}>
              <ChevronRight />
            </IconButton>
          </div>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={ts("weekStart")}>
                <CalendarDays />
                {weekdayLabel(prefs.calendarFirstDayOfWeek, "long")}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{ts("weekStart")}</MenuLabel>
              {WEEK_STARTS.map((d) => (
                <MenuCheckItem key={d} checked={prefs.calendarFirstDayOfWeek === d} onSelect={() => setPref("calendarFirstDayOfWeek", d)}>
                  {weekdayLabel(d, "long")}
                </MenuCheckItem>
              ))}
            </MenuContent>
          </Menu>
        </>
      }
    >
      {cal ? (
        <Heatmap
          days={cal.days}
          maxCount={cal.maxCount}
          year={target}
          firstDayOfWeek={prefs.calendarFirstDayOfWeek}
          onActivate={(d) => browse(`"prop:rated=${d.day}"`)}
        />
      ) : (
        <ChartEmpty height={140}>{ts("noData")}</ChartEmpty>
      )}
    </Panel>
  );
}

/* ------------------------------ Reviews ------------------------------ */

const REVIEW_KINDS: { key: "learn" | "relearn" | "young" | "mature" | "filtered"; label: string; color: string }[] = [
  { key: "learn", label: "statistics-counts-learning-cards", color: stateColor.learn },
  { key: "relearn", label: "statistics-counts-relearning-cards", color: stateColor.relearn },
  { key: "young", label: "statistics-counts-young-cards", color: stateColor.young },
  { key: "mature", label: "statistics-counts-mature-cards", color: stateColor.mature },
  { key: "filtered", label: "statistics-counts-filtered-cards", color: filteredColor },
];

export function ReviewsSection({ data, range }: SectionProps) {
  const [showTime, setShowTime] = useState(false);
  const source = useMemo(() => gatherReviews(data), [data]);
  const r = buildReviews(source, range, showTime);

  const valueLabel = (n: number) => (showTime ? timeSpan(n / 1000, false, true, HOURS_UNIT) : trs("statistics-reviews", { reviews: n }));
  const yFormat = (n: number) => (showTime ? timeSpan(n / 1000, true, true, HOURS_UNIT) : Math.round(n) !== n ? "" : num(n));

  let content = noData();
  if (r) {
    const running = cumulative(r.bins);
    const bars: Bar[] = r.bins.map((b, i) => {
      const [s, e] = reviewDays(r, b);
      return {
        x0: b.x0,
        x1: b.x1,
        // bottom to top: the most settled Cards form the base
        segments: [...REVIEW_KINDS].reverse().map((k) => ({ value: b.totals[k.key], color: k.color })),
        tip: {
          title: `${dayLabel(s, e)} · ${valueLabel(totalOf(b.totals))}`,
          rows: [
            ...REVIEW_KINDS.map((k) => ({ label: tr(k.label), value: valueLabel(b.totals[k.key]), color: k.color })),
            { label: tr("statistics-running-total"), value: valueLabel(running[i]) },
          ],
        },
      };
    });
    const points: [number, number][] = [[r.bins[0].x0, 0], ...r.bins.map((b, i): [number, number] => [b.x1, running[i]])];
    const precision = studiedPercentPrecision(r.studiedPercent);
    const figures = [
      {
        label: tr("statistics-days-studied"),
        value: trs("statistics-amount-of-total-with-percentage", {
          amount: r.studiedDays,
          total: r.periodDays,
          percent: precision === "100" ? "100" : num(r.studiedPercent, precision),
        }),
      },
      { label: tr("statistics-total"), value: showTime ? timeSpan(r.total / 1000, false, true, HOURS_UNIT) : trs("statistics-reviews", { reviews: r.total }) },
      {
        label: tr("statistics-average-over-period"),
        value: showTime
          ? trs("statistics-minutes-per-day", { count: Math.round(r.periodAverage / 1000 / 60) })
          : trs("statistics-reviews-per-day", { count: Math.round(r.periodAverage) }),
      },
    ];
    if (r.studiedPercent < 100) {
      figures.push({
        label: tr("statistics-average-for-days-studied"),
        value: showTime
          ? trs("statistics-minutes-per-day", { count: Math.round(r.studiedAverage / 1000 / 60) })
          : trs("statistics-reviews-per-day", { count: Math.round(r.studiedAverage) }),
      });
    }
    if (showTime) {
      const totalSecs = r.total / 1000;
      figures.push({
        label: tr("statistics-average-answer-time-label"),
        value: trs("statistics-average-answer-time", {
          "average-seconds": totalSecs / r.totalReviews,
          "cards-per-minute": (r.totalReviews * 60) / totalSecs,
        }),
      });
    }
    content = (
      <>
        <BarChart
          label={tr("statistics-reviews-title")}
          bars={bars}
          domain={r.domain}
          yFormat={yFormat}
          line={{ points, max: r.total, format: yFormat }}
        />
        <div className="mt-3">
          <Legend items={REVIEW_KINDS.map((k) => ({ label: tr(k.label), color: k.color }))} />
        </div>
        <Figures items={figures} />
      </>
    );
  }

  return (
    <Panel
      title={tr("statistics-reviews-title")}
      description={tr(showTime ? "statistics-reviews-time-subtitle" : "statistics-reviews-count-subtitle")}
      controls={
        <Segmented
          label={tr("statistics-reviews-title")}
          value={showTime ? "time" : "count"}
          onChange={(v) => setShowTime(v === "time")}
          options={[
            { value: "count", label: tr("statistics-true-retention-count") },
            { value: "time", label: tr("statistics-reviews-time-checkbox") },
          ]}
        />
      }
    >
      {content}
    </Panel>
  );
}

/* ------------------------------ Card counts ------------------------------ */

const STATE_LABEL: Record<CardState, string> = {
  new: "statistics-counts-new-cards",
  learn: "statistics-counts-learning-cards",
  relearn: "statistics-counts-relearning-cards",
  young: "statistics-counts-young-cards",
  mature: "statistics-counts-mature-cards",
  suspended: "statistics-counts-suspended-cards",
  buried: "statistics-counts-buried-cards",
};

export function CardCountsSection({ data, prefs, setPref, browse }: SectionProps) {
  const { counts, total, xMax } = buildCardCounts(data, prefs.cardCountsSeparateInactive);
  const shown = counts.filter((c) => c.show);
  return (
    <Panel
      title={tr("statistics-counts-title")}
      description={ts("countsLead")}
      controls={
        <Toggle
          label={tr("statistics-counts-separate-suspended-buried-cards")}
          checked={prefs.cardCountsSeparateInactive}
          onChange={(v) => setPref("cardCountsSeparateInactive", v)}
        />
      }
    >
      <div className="flex h-3 gap-[3px] overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {shown
          .filter((c) => c.count > 0)
          .map((c) => (
            <span
              key={c.state}
              className="h-full min-w-[3px] rounded-full transition-[flex-grow] duration-[var(--dur-slow)] ease-out"
              style={{ flexGrow: c.count / xMax, background: stateColor[c.state] }}
            />
          ))}
      </div>
      <table className="mt-4 w-full border-collapse text-control">
        <tbody>
          {shown.map((c) => (
            <tr key={c.state} className="border-b border-line last:border-b-0">
              <td className="py-1.5">
                <button
                  type="button"
                  onClick={() => browse(c.query)}
                  className="inline-flex items-center gap-2 rounded-[5px] text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4"
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: stateColor[c.state] }} aria-hidden="true" />
                  {tr(STATE_LABEL[c.state])}
                </button>
              </td>
              <td className="py-1.5 text-right tabular font-medium text-ink">{num(c.count)}</td>
              <td className="w-[84px] py-1.5 text-right tabular text-ink-3">{num((c.count / xMax) * 100, 2)}%</td>
            </tr>
          ))}
          <tr className="border-t border-line-strong">
            <td className="pt-2 pl-[18px] font-medium text-ink">{tr("statistics-counts-total-cards")}</td>
            <td className="pt-2 text-right tabular font-semibold text-ink">{num(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

/* ------------------------------ Intervals and stability ------------------------------ */

function IntervalRangeControl({ value, onChange }: { value: IntervalRange; onChange: (v: IntervalRange) => void }) {
  return (
    <Segmented
      label={ts("period")}
      value={value}
      onChange={onChange}
      options={[
        { value: "month", label: capitalize(timeSpan(MONTH)) },
        { value: "p50", label: "50%" },
        { value: "p95", label: "95%" },
        { value: "all", label: capitalize(tr("statistics-range-all-time")) },
      ]}
    />
  );
}

function IntervalsLike({ data, browse, fsrs }: SectionProps & { fsrs: boolean }) {
  const [range, setRange] = useState<IntervalRange>("p95");
  const all = useMemo(() => gatherIntervals(fsrs ? data.stability?.intervals : data.intervals?.intervals), [data, fsrs]);
  const r = buildIntervals(all, range, fsrs);
  const title = tr(fsrs ? "statistics-card-stability-title" : "statistics-intervals-title");
  const chart =
    r &&
    histogramBars(
      r.histogram,
      (x0) => (fsrs ? measureColor : x0 >= 21 ? stateColor.mature : stateColor.young),
      (b, running) => ({
        title: intervalLabel(b.x0, b.x1, b.value, fsrs),
        lines: [`${tr("statistics-running-total")}: ‎${num((running / r.histogram.total) * 100, 1)}%`],
      }),
      (b) => intervalQuery(b, fsrs),
      browse,
    );
  return (
    <Panel
      title={title}
      description={tr(fsrs ? "statistics-card-stability-subtitle" : "statistics-intervals-subtitle")}
      controls={<IntervalRangeControl value={range} onChange={setRange} />}
    >
      {r && chart ? (
        <>
          <BarChart
            label={title}
            bars={chart.bars}
            domain={r.histogram.domain}
            line={chart.line && { ...chart.line, format: (n) => `${num((n / r.histogram.total) * 100, 0)}%` }}
          />
          <Figures
            items={[
              {
                label: tr(fsrs ? "statistics-median-stability" : "statistics-median-interval"),
                value: timeSpan(r.median * 86400, false),
              },
            ]}
          />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

export function IntervalsSection(props: SectionProps) {
  return <IntervalsLike {...props} fsrs={false} />;
}

export function StabilitySection(props: SectionProps) {
  return <IntervalsLike {...props} fsrs />;
}

/* ------------------------------ Ease, difficulty, retrievability ------------------------------ */

const pct = (n: number) => `${num(n, 0)}%`;

export function EaseSection({ data, browse }: SectionProps) {
  const h = buildEase(data.eases?.eases);
  const chart =
    h &&
    histogramBars(
      h,
      () => measureColor,
      (b) => ({ title: trs("statistics-card-ease-tooltip", { cards: b.value, percent: easePercentLabel(b) }) }),
      easeQuery,
      browse,
    );
  return (
    <Panel title={tr("statistics-card-ease-title")} description={tr("statistics-card-ease-subtitle")}>
      {h && chart ? (
        <>
          <BarChart label={tr("statistics-card-ease-title")} bars={chart.bars} domain={h.domain} xFormat={pct} />
          <Figures items={[{ label: tr("statistics-median-ease"), value: pct(data.eases?.average ?? 0) }]} />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

function PercentageRangeControl({ value, onChange }: { value: PercentageRange; onChange: (v: PercentageRange) => void }) {
  return (
    <Segmented
      label={ts("period")}
      value={value}
      onChange={onChange}
      options={[
        { value: "p50", label: "50%" },
        { value: "p95", label: "95%" },
        { value: "p100", label: "100%" },
        { value: "all", label: capitalize(tr("statistics-range-all-time")) },
      ]}
    />
  );
}

export function DifficultySection({ data, browse }: SectionProps) {
  const [range, setRange] = useState<PercentageRange>("all");
  const h = buildPercentage(data.difficulty?.eases, range);
  const chart =
    h &&
    histogramBars(
      h,
      () => measureColor,
      (b) => ({ title: trs("statistics-card-difficulty-tooltip", { cards: b.value, percent: `${b.x0}%-${b.x1}%` }) }),
      (b) => percentQuery("d", b),
      browse,
    );
  return (
    <Panel
      title={tr("statistics-card-difficulty-title")}
      description={tr("statistics-card-difficulty-subtitle2")}
      controls={<PercentageRangeControl value={range} onChange={setRange} />}
    >
      {h && chart ? (
        <>
          <BarChart label={tr("statistics-card-difficulty-title")} bars={chart.bars} domain={h.domain} xFormat={pct} />
          <Figures items={[{ label: tr("statistics-median-difficulty"), value: pct(data.difficulty?.average ?? 0) }]} />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

export function RetrievabilitySection({ data, browse }: SectionProps) {
  const [range, setRange] = useState<PercentageRange>("all");
  const h = buildPercentage(data.retrievability?.retrievability, range);
  const chart =
    h &&
    histogramBars(
      h,
      () => measureColor,
      (b) => ({ title: trs("statistics-retrievability-tooltip", { cards: b.value, percent: `${b.x0}%-${b.x1}%` }) }),
      (b) => percentQuery("r", b),
      browse,
    );
  const r = data.retrievability;
  return (
    <Panel
      title={tr("statistics-card-retrievability-title")}
      description={tr("statistics-retrievability-subtitle")}
      controls={<PercentageRangeControl value={range} onChange={setRange} />}
    >
      {h && chart ? (
        <>
          <BarChart label={tr("statistics-card-retrievability-title")} bars={chart.bars} domain={h.domain} xFormat={pct} />
          <Figures
            items={[
              { label: tr("statistics-average-retrievability"), value: pct(r?.average ?? 0) },
              {
                label: tr("statistics-estimated-total-knowledge"),
                value: `${trs("statistics-cards", { cards: +(r?.sumByCard ?? 0).toFixed(0) })} / ${trs("statistics-notes", {
                  notes: +(r?.sumByNote ?? 0).toFixed(0),
                })}`,
              },
            ]}
          />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

/* ------------------------------ True retention ------------------------------ */

const PERIOD_LABEL: Record<RetentionPeriod, string> = {
  today: "statistics-true-retention-today",
  yesterday: "statistics-true-retention-yesterday",
  week: "statistics-true-retention-week",
  month: "statistics-true-retention-month",
  year: "statistics-true-retention-year",
  allTime: "statistics-true-retention-all-time",
};

function retention(passed: number, failed: number): string {
  const ratio = retentionRatio(passed, failed);
  return ratio === null ? tr("statistics-true-retention-not-applicable") : percentFormat(ratio);
}

export function TrueRetentionSection({ data, revlogRange }: SectionProps) {
  const [mode, setMode] = useState<"young" | "mature" | "summary">("summary");
  const rows = buildTrueRetention(data, revlogRange);
  const th = "pb-2 text-right text-caption font-medium text-ink-3";
  const td = "py-1.5 text-right tabular";
  return (
    <Panel
      title={tr("statistics-true-retention-title")}
      description={tr("statistics-true-retention-subtitle")}
      controls={
        <Segmented
          label={tr("statistics-true-retention-title")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "young", label: tr("statistics-true-retention-young") },
            { value: "mature", label: tr("statistics-true-retention-mature") },
            { value: "summary", label: tr("statistics-true-retention-all") },
          ]}
        />
      }
    >
      {rows ? (
        <>
          <table className="w-full border-collapse text-control">
            <thead>
              <tr className="border-b border-line">
                <td />
                {mode === "summary" ? (
                  <>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-young")}
                    </th>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-mature")}
                    </th>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-total")}
                    </th>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-count")}
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-pass")}
                    </th>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-fail")}
                    </th>
                    <th scope="col" className={th}>
                      {tr("statistics-true-retention-retention")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const passed = mode === "young" ? row.youngPassed : row.maturePassed;
                const failed = mode === "young" ? row.youngFailed : row.matureFailed;
                const totalPassed = row.youngPassed + row.maturePassed;
                const totalFailed = row.youngFailed + row.matureFailed;
                return (
                  <tr key={row.period} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                      {tr(PERIOD_LABEL[row.period])}
                    </th>
                    {mode === "summary" ? (
                      <>
                        <td className={`${td} text-ink`}>{retention(row.youngPassed, row.youngFailed)}</td>
                        <td className={`${td} text-ink`}>{retention(row.maturePassed, row.matureFailed)}</td>
                        <td className={`${td} font-semibold text-ink`}>{retention(totalPassed, totalFailed)}</td>
                        <td className={`${td} text-ink-3`}>{num(totalPassed + totalFailed)}</td>
                      </>
                    ) : (
                      <>
                        <td className={`${td} text-ink`}>{num(passed)}</td>
                        <td className={`${td} text-ink`}>{num(failed)}</td>
                        <td className={`${td} font-semibold text-ink`}>{retention(passed, failed)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-caption leading-relaxed text-ink-3">{tr("statistics-true-retention-tooltip")}</p>
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

/* ------------------------------ Hours ------------------------------ */

export function HoursSection({ data, range }: SectionProps) {
  const r = buildHours(data, range);
  let content = noData();
  if (r) {
    const bars: Bar[] = r.hours.map((h) => ({
      x0: h.hour,
      x1: h.hour + 1,
      segments: [{ value: h.total, color: measureColor }],
      tip: {
        title: trs("statistics-hours-range", { hourStart: h.hour, hourEnd: h.hour + 1 }),
        lines: [
          trs("statistics-reviews", { reviews: h.total }),
          trs("statistics-hours-correct", {
            correct: h.correct,
            total: h.total,
            percent: h.total ? (h.correct / h.total) * 100 : 0,
          }),
        ],
      },
    }));
    const points = r.hours.map((h): [number, number] => [h.hour + 0.5, h.total ? h.correct / h.total : 0]);
    content = (
      <BarChart
        label={tr("statistics-hours-title")}
        bars={bars}
        domain={[0, 24]}
        gap={0.2}
        xTicks={r.hours.filter((h) => h.hour % 2 === 0).map((h) => ({ value: h.hour + 0.5, label: String(h.hour) }))}
        line={{
          points,
          max: 1,
          format: (n) => `${Math.round(n * 100)}%`,
          defined: (i) => r.hours[i].total > 0,
        }}
      />
    );
  }
  return (
    <Panel title={tr("statistics-hours-title")} description={tr("statistics-hours-subtitle")}>
      {content}
    </Panel>
  );
}

/* ------------------------------ Answer buttons ------------------------------ */

const GROUP_LABEL: Record<ButtonGroup, string> = {
  learning: "statistics-counts-learning-cards",
  young: "statistics-counts-young-cards",
  mature: "statistics-counts-mature-cards",
};
const BUTTON_LABEL = ["studying-again", "studying-hard", "studying-good", "studying-easy"];

export function ButtonsSection({ data, range }: SectionProps) {
  const r = buildButtons(data, range);
  let content = noData();
  if (r) {
    const groups: ButtonGroup[] = ["learning", "young", "mature"];
    // each group spans 6 slots: padding, four buttons, padding
    const bars: Bar[] = r.data.map((d) => {
      const g = groups.indexOf(d.group);
      const groupTotal = r.groups[d.group].total;
      const x0 = g * 6 + d.button;
      return {
        x0,
        x1: x0 + 1,
        segments: [{ value: d.count, color: answerColor[d.button - 1] }],
        tip: {
          title: `${tr("statistics-answer-buttons-button-number")}: ${d.button} (${tr(BUTTON_LABEL[d.button - 1])})`,
          lines: [
            `${tr("statistics-answer-buttons-button-pressed")}: ${num(d.count)} (${groupTotal ? num((d.count / groupTotal) * 100) : "0"}%)`,
            `${trs("statistics-hours-correct", {
              correct: r.groups[d.group].correct,
              total: groupTotal,
              percent: r.groups[d.group].total ? num(r.groups[d.group].percent) : "0",
            })} ${tr("statistics-hours-correct-info")}`,
          ],
        },
      };
    });
    content = (
      <>
        <BarChart
          label={tr("statistics-answer-buttons-title")}
          bars={bars}
          domain={[0, 18]}
          gap={0.16}
          xTicks={groups.map((g, i) => ({ value: i * 6 + 3, label: tr(GROUP_LABEL[g]) }))}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Legend items={BUTTON_LABEL.map((key, i) => ({ label: tr(key), color: answerColor[i] }))} />
        </div>
        <Figures
          items={groups.map((g) => ({
            label: tr(GROUP_LABEL[g]),
            value: trs("statistics-hours-correct", {
              correct: r.groups[g].correct,
              total: r.groups[g].total,
              percent: r.groups[g].total ? num(r.groups[g].percent) : "0",
            }),
          }))}
        />
      </>
    );
  }
  return (
    <Panel title={tr("statistics-answer-buttons-title")} description={tr("statistics-answer-buttons-subtitle")}>
      {content}
    </Panel>
  );
}

/* ------------------------------ Added ------------------------------ */

export function AddedSection({ data, range, browse }: SectionProps) {
  const r = buildAdded(data.added?.added ?? {}, range);
  const chart =
    r &&
    histogramBars(
      r.histogram,
      () => stateColor.new,
      (b, running) => ({
        title: dayLabel(b.x0, b.x1),
        lines: [
          trs("statistics-cards", { cards: b.value }),
          `${tr("statistics-running-total")}: ${trs("statistics-cards", { cards: running })}`,
        ],
      }),
      addedQuery,
      browse,
    );
  return (
    <Panel title={tr("statistics-added-title")} description={tr("statistics-added-subtitle")}>
      {r && chart ? (
        <>
          <BarChart label={tr("statistics-added-title")} bars={chart.bars} domain={r.histogram.domain} line={chart.line} />
          <Figures
            items={[
              { label: tr("statistics-total"), value: trs("statistics-cards", { cards: r.total }) },
              { label: tr("statistics-average"), value: trs("statistics-cards-per-day", { count: r.perDay }) },
            ]}
          />
        </>
      ) : (
        noData()
      )}
    </Panel>
  );
}

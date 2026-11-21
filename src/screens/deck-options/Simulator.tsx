// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Anki's FSRS simulator (SimulatorModal.svelte), in two forms: the review
 * simulator, which plots reviews, time and memorised cards per day, and the
 * desired retention helper ("Help Me Decide"), which plots each retention
 * from 70% to 99%. Each run adds a line; options can be saved to the preset.
 */
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { confirm } from "@/components/confirm";
import { Button, cn, Dialog, Segmented, Spinner } from "@/components/ui";
import * as core from "@/lib/anki/generated/core";
import { DeckConfig_Config_LeechAction as LeechAction, type DeckConfig_Config_ReviewCardOrder as ReviewOrder } from "@/lib/anki/proto/anki/deck_config_pb";
import { languages, localizedDate, tr } from "@/lib/i18n";
import { td } from "@/lib/strings/deck-options";
import { tipText, TipCard, useWidth, type Tip } from "@/screens/stats/Chart";
import { dayLabel, timeSpan, trs } from "@/screens/stats/format";
import { linear, ticks } from "@/screens/stats/scale";

import { reviewOrderChoices } from "./choices";
import { MiniSegmented, NumberField, SelectField, Switch } from "./controls";
import { currentConfig, defaultParamSearch, fsrsParams, setFlag, updateConfig, type OptionsState } from "./model";
import {
  pointAt,
  reviewPoints,
  runSummary,
  simulationSeries,
  smoothPoints,
  workloadPoints,
  workloadSeries,
  yDomain,
  yTicks,
  type Point,
  type Series,
  type SimulateSubgraph,
  type WorkloadPoint,
  type WorkloadSubgraph,
} from "./simulation";

/** One colour per run, from the app's tokens. */
const RUN_COLOURS = [
  "var(--accent)",
  "var(--count-new)",
  "var(--count-learn)",
  "var(--count-due)",
  "var(--answer-hard)",
  "var(--flag-5)",
  "var(--flag-7)",
  "var(--flag-6)",
  "var(--flag-2)",
  "var(--ink-2)",
];

function runColour(label: number): string {
  return RUN_COLOURS[(label - 1) % RUN_COLOURS.length];
}

const EASY_DAY_VALUES = [0, 0.5, 1];
function nearestEasyDay(value: number): number {
  let best = 0;
  EASY_DAY_VALUES.forEach((v, i) => {
    if (Math.abs(v - value) < Math.abs(EASY_DAY_VALUES[best] - value)) best = i;
  });
  return best;
}

interface Settings {
  days: number;
  deckSize: number;
  desiredRetention: number;
  newLimit: number;
  reviewLimit: number;
  maxInterval: number;
  reviewOrder: ReviewOrder;
  newCardsIgnoreReviewLimit: boolean;
  smooth: boolean;
  suspendLeeches: boolean;
  leechThreshold: number;
  easyDays: number[];
}

function settingsFrom(state: OptionsState, workload: boolean): Settings {
  const config = currentConfig(state);
  return {
    days: 365,
    deckSize: 0,
    desiredRetention: config.desiredRetention,
    newLimit: config.newPerDay,
    // "Help Me Decide" starts without a review limit.
    reviewLimit: workload ? 9999 : config.reviewsPerDay,
    maxInterval: config.maximumReviewInterval,
    reviewOrder: config.reviewOrder,
    newCardsIgnoreReviewLimit: state.newCardsIgnoreReviewLimit,
    smooth: true,
    suspendLeeches: config.leechAction === LeechAction.SUSPEND,
    leechThreshold: config.leechThreshold,
    easyDays: [...config.easyDaysPercentages],
  };
}

export interface SimulatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The desired retention helper instead of the review simulator. */
  workload?: boolean;
  state: OptionsState;
  update: (fn: (state: OptionsState) => OptionsState) => void;
}

export function SimulatorDialog({ open, onOpenChange, workload = false, state, update }: SimulatorProps) {
  const [settings, setSettings] = useState<Settings>(() => settingsFrom(state, workload));
  const [points, setPoints] = useState<(Point | WorkloadPoint)[]>([]);
  const [runs, setRuns] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [subgraph, setSubgraph] = useState<SimulateSubgraph>("count");
  const [workloadGraph, setWorkloadGraph] = useState<WorkloadSubgraph>("ratio");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  // Each opening starts from the preset's current options; earlier runs stay.
  useEffect(() => {
    if (open) setSettings(settingsFrom(stateRef.current, workload));
  }, [open, workload]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  const simulate = async () => {
    const s = stateRef.current;
    const config = currentConfig(s);
    const request = {
      params: fsrsParams(config),
      desiredRetention: settings.desiredRetention,
      deckSize: settings.deckSize,
      daysToSimulate: settings.days,
      newLimit: settings.newLimit,
      reviewLimit: settings.reviewLimit,
      maxInterval: settings.maxInterval,
      search: defaultParamSearch(s),
      newCardsIgnoreReviewLimit: settings.newCardsIgnoreReviewLimit,
      easyDaysPercentages: settings.easyDays,
      reviewOrder: settings.reviewOrder,
      suspendAfterLapseCount: settings.suspendLeeches ? settings.leechThreshold : undefined,
      historicalRetention: config.historicalRetention,
      learningStepCount: config.learnSteps.length,
      relearningStepCount: config.relearnSteps.length,
    };
    setRunning(true);
    setError("");
    try {
      const label = runs + 1;
      if (workload) {
        const resp = await core.simulateFsrsWorkload(request);
        setPoints((p) => [...p, ...workloadPoints(resp, label, settings.days)]);
      } else {
        const resp = await core.simulateFsrsReview(request);
        setPoints((p) => [...p, ...reviewPoints(resp, label)]);
      }
      setRuns(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const clearLast = () => {
    setPoints((p) => p.filter((point) => point.label !== runs));
    setRuns((n) => Math.max(0, n - 1));
  };

  const saveToPreset = async () => {
    const ok = await confirm({
      title: tr("deck-config-save-options-to-preset"),
      message: tr("deck-config-save-options-to-preset-confirm"),
      confirm: tr("deck-config-save-options-to-preset"),
    });
    if (!ok) return;
    update((s) => {
      const next = updateConfig(s, {
        newPerDay: settings.newLimit,
        reviewsPerDay: settings.reviewLimit,
        maximumReviewInterval: settings.maxInterval,
        ...(workload ? {} : { desiredRetention: settings.desiredRetention }),
        reviewOrder: settings.reviewOrder,
        leechAction: settings.suspendLeeches ? LeechAction.SUSPEND : LeechAction.TAG_ONLY,
        leechThreshold: settings.leechThreshold,
        easyDaysPercentages: [...settings.easyDays],
      });
      return setFlag(next, "newCardsIgnoreReviewLimit", settings.newCardsIgnoreReviewLimit);
    });
  };

  // What is drawn: smoothed per run when asked, with a window of a day per year simulated.
  const windowSize = Math.ceil(settings.days / 365);
  const drawn = settings.smooth ? smoothPoints(points, windowSize) : points;
  const series = workload ? workloadSeries(drawn as WorkloadPoint[], workloadGraph) : simulationSeries(drawn, subgraph);
  const reviewless = workload ? ((drawn[0] as WorkloadPoint | undefined)?.reviewlessEndMemorized ?? 0) : 0;

  const title = workload ? tr("deck-config-fsrs-simulate-desired-retention-experimental") : tr("deck-config-fsrs-simulator-experimental");
  const levels = [tr("deck-config-easy-days-minimum"), tr("deck-config-easy-days-reduced"), tr("deck-config-easy-days-normal")];
  const days = [
    tr("deck-config-easy-days-monday"),
    tr("deck-config-easy-days-tuesday"),
    tr("deck-config-easy-days-wednesday"),
    tr("deck-config-easy-days-thursday"),
    tr("deck-config-easy-days-friday"),
    tr("deck-config-easy-days-saturday"),
    tr("deck-config-easy-days-sunday"),
  ];

  const numberRow = (label: string, key: "days" | "deckSize" | "newLimit" | "reviewLimit" | "maxInterval" | "leechThreshold", min: number, max: number) => (
    <SimRow label={label}>
      <NumberField label={label} value={settings[key]} min={min} max={max} onChange={(v) => set(key, v)} />
    </SimRow>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={1080}
      footer={
        <>
          {running && (
            <span className="me-auto flex items-center gap-2 text-[12.5px] text-ink-2" aria-live="polite">
              <Spinner />
              {tr("actions-processing")}
            </span>
          )}
          <Button disabled={running || runs === 0} onClick={clearLast}>
            {tr("deck-config-clear-last-simulate")}
          </Button>
          <Button disabled={running} onClick={() => void saveToPreset()}>
            {tr("deck-config-save-options-to-preset")}
          </Button>
          <Button variant="primary" disabled={running} onClick={() => void simulate()}>
            {tr("deck-config-simulate")}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 pb-1 md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface">
            {numberRow(tr("deck-config-days-to-simulate"), "days", 1, 3650)}
            {numberRow(tr("deck-config-additional-new-cards-to-simulate"), "deckSize", 0, 100000)}
            {!workload && (
              <SimRow label={tr("deck-config-desired-retention")}>
                <NumberField
                  label={tr("deck-config-desired-retention")}
                  value={settings.desiredRetention}
                  min={0.7}
                  max={0.99}
                  step={0.01}
                  percentage
                  onChange={(v) => set("desiredRetention", v)}
                />
              </SimRow>
            )}
            {numberRow(tr("scheduling-new-cardsday"), "newLimit", 0, 9999)}
            {numberRow(tr("scheduling-maximum-reviewsday"), "reviewLimit", 0, 9999)}
          </div>

          <Disclosure title={tr("deck-config-easy-days-title")}>
            {days.map((day, index) => (
              <SimRow key={day} label={day}>
                <MiniSegmented
                  label={day}
                  value={nearestEasyDay(settings.easyDays[index] ?? 1)}
                  options={levels}
                  onChange={(level) => {
                    const next = settings.easyDays.slice();
                    next[index] = EASY_DAY_VALUES[level];
                    set("easyDays", next);
                  }}
                />
              </SimRow>
            ))}
          </Disclosure>

          <Disclosure title={tr("deck-config-advanced-settings")}>
            {numberRow(tr("scheduling-maximum-interval"), "maxInterval", 1, 36500)}
            <div className="space-y-1.5 px-3 py-2.5">
              <div className="text-[13px] text-ink">{tr("deck-config-review-sort-order")}</div>
              <SelectField<ReviewOrder>
                label={tr("deck-config-review-sort-order")}
                value={settings.reviewOrder}
                choices={reviewOrderChoices(state.fsrs)}
                onChange={(v) => set("reviewOrder", v)}
              />
            </div>
            <SimRow label={tr("deck-config-new-cards-ignore-review-limit")}>
              <Switch
                label={tr("deck-config-new-cards-ignore-review-limit")}
                checked={settings.newCardsIgnoreReviewLimit}
                onChange={(v) => set("newCardsIgnoreReviewLimit", v)}
              />
            </SimRow>
            <SimRow label={tr("deck-config-smooth-graph")}>
              <Switch label={tr("deck-config-smooth-graph")} checked={settings.smooth} onChange={(v) => set("smooth", v)} />
            </SimRow>
            <SimRow label={tr("deck-config-suspend-leeches")}>
              <Switch label={tr("deck-config-suspend-leeches")} checked={settings.suspendLeeches} onChange={(v) => set("suspendLeeches", v)} />
            </SimRow>
            {settings.suspendLeeches && numberRow(tr("scheduling-leech-threshold"), "leechThreshold", 1, 9999)}
          </Disclosure>
        </div>

        <div className="min-w-0 space-y-3">
          {workload ? (
            <Segmented<WorkloadSubgraph>
              label={td("simGraph")}
              value={workloadGraph}
              onChange={setWorkloadGraph}
              options={[
                { value: "ratio", label: tr("deck-config-fsrs-simulator-radio-efficiency") },
                { value: "count", label: tr("deck-config-fsrs-simulator-radio-count") },
                { value: "time", label: tr("statistics-reviews-time-checkbox") },
                { value: "memorized", label: tr("deck-config-fsrs-simulator-radio-memorized") },
              ]}
            />
          ) : (
            <Segmented<SimulateSubgraph>
              label={td("simGraph")}
              value={subgraph}
              onChange={setSubgraph}
              options={[
                { value: "count", label: tr("deck-config-fsrs-simulator-radio-count") },
                { value: "time", label: tr("statistics-reviews-time-checkbox") },
                { value: "memorized", label: tr("deck-config-fsrs-simulator-radio-memorized") },
              ]}
            />
          )}

          {error && (
            <p role="alert" className="selectable rounded-[8px] bg-surface-2 px-3 py-2 text-[12.5px] text-danger">
              {td("simFailed")} {error}
            </p>
          )}

          {series.length === 0 ? (
            <div className="grid h-[280px] place-items-center rounded-[10px] border border-dashed border-line px-6 text-center text-[13px] text-ink-3">
              {running ? <Spinner className="size-5" /> : td("simEmpty")}
            </div>
          ) : workload ? (
            <WorkloadChart series={series} hidden={hidden} subgraph={workloadGraph} reviewless={reviewless} />
          ) : (
            <SimulationChart series={series} hidden={hidden} subgraph={subgraph} />
          )}

          {series.length > 0 && (
            <RunList
              series={series}
              hidden={hidden}
              onToggle={(label) =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return next;
                })
              }
              summary={workload ? undefined : subgraph}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Layout pieces ------------------------------ */

function SimRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-3 py-1.5">
      <span className="min-w-0 text-[13px] leading-snug text-ink">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 px-3 text-start text-[13px] font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
      >
        <ChevronRight aria-hidden className={cn("size-4 text-ink-3 transition-transform duration-[var(--dur-fast)]", open && "rotate-90")} />
        {title}
      </button>
      {open && (
        <div id={id} className="divide-y divide-line border-t border-line">
          {children}
        </div>
      )}
    </div>
  );
}

function perDay(subgraph: SimulateSubgraph, value: number): string {
  if (subgraph === "count") return trs("statistics-reviews-per-day", { count: value });
  if (subgraph === "time") return timeSpan(value);
  return trs("statistics-cards-per-day", { count: value });
}

function simulationY(subgraph: SimulateSubgraph, value: number): string {
  if (subgraph === "time") return timeSpan(value);
  if (subgraph === "count") return trs("statistics-reviews", { reviews: Math.round(value) });
  return trs("statistics-memorized", { memorized: Math.round(value).toFixed(0) });
}

function workloadY(subgraph: WorkloadSubgraph, value: number): string {
  switch (subgraph) {
    case "ratio":
      return trs("deck-config-fsrs-simulator-ratio-tooltip2", { time: value.toFixed(2) });
    case "time":
      return trs("statistics-minutes-per-day", { count: parseFloat((value / 60).toPrecision(2)) });
    case "count":
      return trs("statistics-reviews-per-day", { count: Math.round(value) });
    case "memorized":
      return trs("statistics-memorized", { memorized: Math.round(value).toFixed(0) });
  }
}

function percent(n: number): string {
  return new Intl.NumberFormat(languages(), { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
}

function RunList({
  series,
  hidden,
  onToggle,
  summary,
}: {
  series: Series[];
  hidden: Set<number>;
  onToggle: (label: number) => void;
  summary?: SimulateSubgraph;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <table className="w-full border-collapse text-[12.5px]">
        {summary && (
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th scope="col" className="px-3 py-1.5 text-start font-medium">
                {td("simShown")}
              </th>
              <th scope="col" className="px-3 py-1.5 text-end font-medium">
                {tr("statistics-average")}
              </th>
              <th scope="col" className="px-3 py-1.5 text-end font-medium">
                {tr("statistics-total")}
              </th>
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-line">
          {series.map((s) => {
            const sum = summary ? runSummary(s, summary) : null;
            const off = hidden.has(s.label);
            return (
              <tr key={s.label} className={cn(off && "text-ink-3")}>
                <td className="px-3 py-1">
                  <button
                    type="button"
                    aria-pressed={!off}
                    aria-label={td("simToggleRun", { n: s.label })}
                    onClick={() => onToggle(s.label)}
                    className="inline-flex h-7 items-center gap-2 rounded-[6px] px-1.5 -ms-1.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-[3px] border"
                      style={{ background: off ? "transparent" : runColour(s.label), borderColor: runColour(s.label) }}
                    />
                    <span className={cn("font-medium", off ? "text-ink-3" : "text-ink")}>#{s.label}</span>
                  </button>
                </td>
                {sum && summary && (
                  <>
                    <td className="tabular px-3 py-1 text-end text-ink-2">{perDay(summary, sum.average)}</td>
                    <td className="tabular px-3 py-1 text-end text-ink">{simulationY(summary, sum.total)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Charts ------------------------------ */

const HEIGHT = 280;
const MARGIN = { top: 14, right: 18, bottom: 30, left: 64 };

function SimulationChart({ series, hidden, subgraph }: { series: Series[]; hidden: Set<number>; subgraph: SimulateSubgraph }) {
  const today = useRef(new Date()).current;
  const maxDay = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.x)));
  const dateOf = (day: number) => new Date(today.getTime() + day * 86400000);
  const long = maxDay > 330;
  return (
    <LineChart
      series={series}
      hidden={hidden}
      xDomain={[0, maxDay]}
      xTicks={ticks(0, maxDay, 7).map((d) => ({
        value: d,
        label: localizedDate(dateOf(d), long ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" }),
      }))}
      yTick={(n) => (subgraph === "time" ? timeSpan(n, true) : n.toLocaleString())}
      tip={(x, rows) => ({
        title: localizedDate(dateOf(x)),
        lines: [dayLabel(x, x + 1)],
        rows: rows.map((r) => ({ label: `#${r.label}`, value: simulationY(subgraph, r.y), color: runColour(r.label) })),
      })}
      step={1}
    />
  );
}

function WorkloadChart({ series, hidden, subgraph, reviewless }: { series: Series[]; hidden: Set<number>; subgraph: WorkloadSubgraph; reviewless: number }) {
  return (
    <LineChart
      series={series}
      hidden={hidden}
      xDomain={[70, 99]}
      xTicks={ticks(70, 99, 7).map((d) => ({ value: d, label: percent(d) }))}
      yTick={(n) => (subgraph === "time" ? timeSpan(n, true) : n.toLocaleString())}
      floor={subgraph === "memorized" ? reviewless : 0}
      guide={subgraph === "memorized" ? reviewless : undefined}
      tip={(x, rows) => ({
        title: `${tr("deck-config-desired-retention")}: ${percent(x)}`,
        rows: rows.map((r) => ({ label: `#${r.label}`, value: workloadY(subgraph, r.y), color: runColour(r.label) })),
      })}
      step={1}
    />
  );
}

function LineChart({
  series,
  hidden,
  xDomain,
  xTicks,
  yTick,
  floor,
  guide,
  tip,
  step,
}: {
  series: Series[];
  hidden: Set<number>;
  xDomain: [number, number];
  xTicks: { value: number; label: string }[];
  yTick: (n: number) => string;
  floor?: number;
  guide?: number;
  tip: (x: number, rows: { label: number; y: number }[]) => Tip;
  step: number;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();

  const domain = yDomain(series, floor);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = linear(xDomain, [MARGIN.left, Math.max(MARGIN.left + 1, width - MARGIN.right)]);
  const y = linear(domain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const yTickValues = yTicks(domain, plotHeight);
  const visible = series.filter((s) => !hidden.has(s.label));

  const rowsAt = (at: number) =>
    visible.flatMap((s) => {
      const p = pointAt(s, at);
      return p ? [{ label: s.label, y: p.y }] : [];
    });

  const fromPointer = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    const value = xDomain[0] + ((px - MARGIN.left) / Math.max(1, width - MARGIN.left - MARGIN.right)) * (xDomain[1] - xDomain[0]);
    return Math.min(xDomain[1], Math.max(xDomain[0], Math.round(value / step) * step));
  };

  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    if (e.key === "Home") return (e.preventDefault(), setHover(xDomain[0]));
    if (e.key === "End") return (e.preventDefault(), setHover(xDomain[1]));
    if (e.key === "Escape" && hover !== null) return (e.stopPropagation(), setHover(null));
    if (!delta) return;
    e.preventDefault();
    setHover((h) => Math.min(xDomain[1], Math.max(xDomain[0], (h ?? xDomain[0]) + delta * (e.shiftKey ? 10 : 1))));
  };

  const rows = hover === null ? [] : rowsAt(hover);
  const tipLeft = hover === null ? 0 : Math.max(0, Math.min(width - 220, x(hover) - 110));

  return (
    <div>
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={td("simGraph")}
      aria-describedby={descId}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      onPointerMove={(e) => setHover(fromPointer(e.clientX))}
      onPointerLeave={() => setHover(null)}
      className="relative w-full select-none rounded-[10px] border border-line bg-surface outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
      style={{ height: HEIGHT }}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} className="block overflow-visible text-ink-3">
          {yTickValues.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} style={{ stroke: "var(--line)" }} />
              <text x={MARGIN.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor" className="tabular">
                {yTick(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t.value} x={x(t.value)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular">
              {t.label}
            </text>
          ))}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} style={{ stroke: "var(--line-strong)" }} />
          {guide !== undefined && (
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(guide)}
              y2={y(guide)}
              style={{ stroke: "var(--ink-2)" }}
              strokeDasharray="5 5"
            />
          )}
          {visible.map((s) => (
            <path
              key={s.label}
              d={s.points
                .filter((p) => Number.isFinite(p.y))
                .map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`)
                .join("")}
              fill="none"
              style={{ stroke: runColour(s.label) }}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} style={{ stroke: "var(--ink-3)" }} />
              {rows.map((r) => (
                <circle key={r.label} cx={x(hover)} cy={y(r.y)} r={3.5} style={{ fill: runColour(r.label), stroke: "var(--surface)" }} strokeWidth={1.5} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && rows.length > 0 && (
        <div className="pointer-events-none absolute top-2 z-10 w-[220px]" style={{ left: tipLeft }}>
          <TipCard tip={tip(hover, rows)} />
        </div>
      )}
    </div>
      <p id={descId} className="sr-only" aria-live="polite">
        {hover !== null && rows.length > 0 ? tipText(tip(hover, rows)) : ""}
      </p>
    </div>
  );
}

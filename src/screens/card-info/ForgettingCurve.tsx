// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The FSRS forgetting curve, drawn as a plain SVG line chart. */
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Segmented } from "@/components/ui";
import type { CardStatsResponse_StatsRevlogEntry as RevlogEntry } from "@/lib/anki/proto/anki/stats_pb";
import { languages, tr } from "@/lib/i18n";
import { tci } from "@/lib/strings/card-info";
import { timeSpan } from "@/screens/stats/format";
import { linear, ticks } from "@/screens/stats/scale";

import { availableRanges, calculateMaxDays, filterRevlog, prepareData, thin, TimeRange, type CurvePoint } from "./curve";

const HEIGHT = 240;
const MARGIN = { top: 16, right: 16, bottom: 30, left: 44 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const rangeKeys: Record<TimeRange, string> = {
  [TimeRange.Week]: "card-stats-fsrs-forgetting-curve-first-week",
  [TimeRange.Month]: "card-stats-fsrs-forgetting-curve-first-month",
  [TimeRange.Year]: "card-stats-fsrs-forgetting-curve-first-year",
  [TimeRange.AllTime]: "card-stats-fsrs-forgetting-curve-all-time",
};

export function ForgettingCurve({ revlog, desiredRetention, decay }: { revlog: RevlogEntry[]; desiredRetention: number; decay: number }) {
  // Fixed for the dialog's life so the curve does not creep while it is open.
  const [now] = useState(() => Date.now() / 1000);
  const filtered = useMemo(() => filterRevlog(revlog), [revlog]);
  const allDays = useMemo(() => calculateMaxDays(filtered, TimeRange.AllTime, now), [filtered, now]);
  const { ranges, initial } = useMemo(() => availableRanges(allDays), [allDays]);
  const [range, setRange] = useState<TimeRange>(initial);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const data = useMemo(() => {
    const maxDays = calculateMaxDays(filtered, range, now);
    return thin(prepareData(filtered, maxDays, decay, now), Math.max(200, width));
  }, [filtered, range, decay, now, width]);

  if (filtered.length === 0) return null;

  const inner = Math.max(0, width - MARGIN.left - MARGIN.right);
  const t0 = data[0]?.time ?? now;
  const t1 = data[data.length - 1]?.time ?? now + 1;
  const minR = data.length ? Math.min(...data.map((d) => d.retrievability)) : 0;
  const yMin = Math.max(0, 100 - 1.2 * (100 - minR));
  const x = linear([t0, t1 === t0 ? t0 + 1 : t1], [MARGIN.left, MARGIN.left + inner]);
  const y = linear([yMin, 100], [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const path = (points: CurvePoint[]) =>
    points.map((d, i) => `${i ? "L" : "M"}${x(d.time).toFixed(1)},${y(d.retrievability).toFixed(1)}`).join("");
  const past = data.filter((d) => d.time <= now);
  const future = data.filter((d) => d.time >= now);
  const yTicks = ticks(yMin, 100, 5);
  const xTicks = ticks(t0, t1, Math.max(2, Math.min(6, Math.floor(inner / 110))));
  const spanDays = (t1 - t0) / 86400;
  const dateFormat = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString(languages(), spanDays > 365 ? { year: "numeric", month: "short" } : { month: "short", day: "numeric" });
  const desired = desiredRetention * 100;

  const point = hover !== null ? data[hover] : null;

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    data.forEach((d, i) => {
      const dist = Math.abs(x(d.time) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const stepSize = Math.max(1, Math.round(data.length / 50));
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(data.length - 1, (hover ?? -1) + stepSize);
    else if (e.key === "ArrowLeft") next = Math.max(0, (hover ?? data.length) - stepSize);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = data.length - 1;
    else if (e.key === "Escape" && hover !== null) {
      e.stopPropagation();
      setHover(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setHover(next);
    }
  };

  const tipLines = point
    ? [
        `${tr("card-stats-review-log-date")}: ${new Date(point.time * 1000).toLocaleString(languages(), spanDays >= 365 ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" })}`,
        `${tr("card-stats-review-log-elapsed-time")}: ${timeSpan(point.elapsedDaysSinceLastReview * 86400)}`,
        `${tr("card-stats-fsrs-retrievability")}: ${point.retrievability.toFixed(2)}%`,
        `${tr("card-stats-fsrs-stability")}: ${timeSpan(point.stability * 86400)}`,
      ]
    : [];

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-2 flex flex-wrap items-center gap-3 px-1">
        <h3 id={titleId} className="mr-auto text-[13px] font-semibold text-ink-2">
          {tr("card-stats-fsrs-forgetting-curve-title")}
        </h3>
        {ranges.length > 0 && (
          <Segmented
            label={tci("timeRange")}
            value={String(range)}
            options={ranges.map((r) => ({ value: String(r), label: tr(rangeKeys[r]) }))}
            onChange={(v) => {
              setHover(null);
              setRange(Number(v) as TimeRange);
            }}
          />
        )}
      </div>
      <div className="rounded-[12px] border border-line bg-surface px-3 pb-3 pt-3">
        <p className="mb-2 px-1 text-[12.5px] text-ink-3">{tci("curveLead")}</p>
        <div ref={ref} className="relative">
          {width > 0 && (
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              tabIndex={0}
              aria-labelledby={titleId}
              aria-describedby={`${titleId}-keys`}
              className="block rounded-[6px] outline-offset-2"
              onPointerMove={onPointer}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKey}
              onBlur={() => setHover(null)}
            >
              <g className="text-ink-3" fontSize={11}>
                {yTicks.map((v) => (
                  <g key={`y${v}`}>
                    <line x1={MARGIN.left} x2={MARGIN.left + inner} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                    <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fill="currentColor" className="tabular">
                      {v}%
                    </text>
                  </g>
                ))}
                {xTicks.map((v) => (
                  <text key={`x${v}`} x={x(v)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle" fill="currentColor" className="tabular">
                    {dateFormat(v)}
                  </text>
                ))}
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + inner}
                  y1={HEIGHT - MARGIN.bottom}
                  y2={HEIGHT - MARGIN.bottom}
                  stroke="var(--line-strong)"
                />
              </g>

              {desired > yMin && (
                <g>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + inner}
                    y1={y(desired)}
                    y2={y(desired)}
                    stroke="var(--ink-3)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                  <text x={MARGIN.left + inner} y={y(desired) - 5} textAnchor="end" fontSize={11} fill="var(--ink-3)" className="tabular">
                    {tr("card-stats-fsrs-forgetting-curve-desired-retention")} {desired.toFixed(0)}%
                  </text>
                </g>
              )}

              {now >= t0 && now <= t1 && (
                <line x1={x(now)} x2={x(now)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--line-strong)" />
              )}

              <path d={path(past)} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" />
              <path d={path(future)} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeDasharray="4 4" />

              {point && (
                <g pointerEvents="none">
                  <line x1={x(point.time)} x2={x(point.time)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--ink-3)" />
                  <circle cx={x(point.time)} cy={y(point.retrievability)} r={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
                </g>
              )}
            </svg>
          )}
          {point && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 rounded-[8px] border border-line bg-raised px-3 py-2 text-[12px] text-ink shadow-pop"
              style={x(point.time) > width / 2 ? { right: width - x(point.time) + 12 } : { left: x(point.time) + 12 }}
            >
              {tipLines.map((line) => (
                <p key={line} className="tabular whitespace-nowrap leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
        <p id={`${titleId}-keys`} className="sr-only">
          {tci("curveKeys")}
        </p>
      </div>
    </section>
  );
}

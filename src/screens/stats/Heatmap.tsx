// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** The review calendar: one square per day, shaded by reviews. */
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { cn } from "@/components/ui";
import { firstLanguage, localizedDate } from "@/lib/i18n";
import { ts } from "@/lib/strings/stats";

import type { CalendarDay } from "./calendar";
import { countWeeks, floorYear } from "./calendar";
import { TipCard, useShownOnce, useWidth, type Tip } from "./Chart";
import { heatColor } from "./colors";
import { trs, weekdayLabel } from "./format";

export interface HeatmapProps {
  days: CalendarDay[];
  maxCount: number;
  year: number;
  firstDayOfWeek: number;
  onActivate: (day: CalendarDay) => void;
}

export function Heatmap(props: HeatmapProps) {
  const [box, width] = useWidth<HTMLDivElement>();
  const shown = useShownOnce(box, width > 0);
  return <div ref={box}>{width > 0 && <HeatmapBody {...props} width={width} shown={shown} />}</div>;
}

/** The calendar drawn at a known width. */
export function HeatmapBody({
  days,
  maxCount,
  year,
  firstDayOfWeek,
  onActivate,
  width,
  shown,
}: HeatmapProps & { width: number; shown: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const descId = useId();

  const sorted = useMemo(() => [...days].sort((a, b) => +a.date - +b.date), [days]);

  const labelW = 22;
  const monthH = 16;
  const pitch = Math.max(7, Math.min(17, (width - labelW) / 54));
  const cell = Math.max(5, pitch - (pitch > 10 ? 3 : 2));
  const height = monthH + pitch * 7;
  const gridW = labelW + pitch * 54;

  const months = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const yearStart = floorYear(new Date(year, 0, 1));
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const week = countWeeks(yearStart, first, firstDayOfWeek);
      out.push({ x: week + 1, label: first.toLocaleDateString(firstLanguage(), { month: "short" }) });
    }
    return out;
  }, [year, firstDayOfWeek]);

  const weekdays = Array.from({ length: 7 }, (_, i) => (firstDayOfWeek + i) % 7);

  const tipFor = (d: CalendarDay): Tip => ({
    title: localizedDate(d.date, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    lines: [trs("statistics-reviews", { reviews: d.count })],
  });

  const move = (e: KeyboardEvent) => {
    if (!sorted.length) return;
    const pos = active ?? sorted.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = pos + 7;
    else if (e.key === "ArrowLeft") next = pos - 7;
    else if (e.key === "ArrowDown") next = pos + 1;
    else if (e.key === "ArrowUp") next = pos - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = sorted.length - 1;
    else if (e.key === "Enter" && active !== null && sorted[active].count > 0) {
      onActivate(sorted[active]);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setKeyboard(true);
      setActive(Math.max(0, Math.min(sorted.length - 1, next)));
    }
  };

  const activeDay = active !== null ? sorted[active] : null;
  const ax = activeDay ? labelW + (activeDay.weekNumber + 1) * pitch : 0;
  const ay = activeDay ? monthH + activeDay.weekDay * pitch : 0;

  return (
    <div>
      <div className="relative w-full select-none" style={{ height }}>
        {(
          <svg
            width={Math.min(width, gridW)}
            height={height}
            tabIndex={0}
            role="group"
            aria-label={`${trs("statistics-calendar-title")} ${year}`}
            aria-describedby={descId}
            className="block rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            onKeyDown={move}
            onFocus={(e) => {
              if (active === null && sorted.length && e.currentTarget.matches(":focus-visible")) {
                setKeyboard(true);
                setActive(sorted.length - 1);
              }
            }}
            onBlur={() => {
              setKeyboard(false);
              setActive(null);
            }}
            onPointerLeave={() => !keyboard && setActive(null)}
          >
            {months.map((m) => (
              <text key={m.label + m.x} x={labelW + m.x * pitch} y={11} fontSize={11} fill="var(--ink-3)">
                {m.label}
              </text>
            ))}
            {weekdays.map((d, i) =>
              i % 2 === 1 || pitch >= 12 ? (
                <text
                  key={d}
                  x={labelW - 6}
                  y={monthH + i * pitch + cell / 2}
                  dy="0.35em"
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--ink-3)"
                >
                  {weekdayLabel(d)}
                </text>
              ) : null,
            )}
            {sorted.map((d, i) => {
              const t = d.count > 0 ? Math.sqrt(d.count) / Math.sqrt(maxCount) : 0;
              return (
                <rect
                  key={i}
                  x={labelW + (d.weekNumber + 1) * pitch}
                  y={monthH + d.weekDay * pitch}
                  width={cell}
                  height={cell}
                  rx={Math.min(3, cell / 4)}
                  fill={shown ? heatColor(t) : "var(--surface-3)"}
                  stroke={active === i ? "var(--ink)" : "none"}
                  strokeWidth={active === i ? 1.5 : 0}
                  style={{
                    transition: `fill 300ms var(--ease-out) ${Math.min(240, d.weekNumber * 4)}ms`,
                    cursor: d.count > 0 ? "pointer" : "default",
                  }}
                  onPointerEnter={() => {
                    setKeyboard(false);
                    setActive(i);
                  }}
                  onClick={() => d.count > 0 && onActivate(d)}
                />
              );
            })}
          </svg>
        )}
        <p id={descId} className="sr-only">
          {ts("chartKeys")}
        </p>
        <p className="sr-only" aria-live="polite">
          {keyboard && activeDay ? `${tipFor(activeDay).title}. ${tipFor(activeDay).lines?.[0]}` : ""}
        </p>
        {activeDay && (
          <div
            className="pointer-events-none absolute z-10 animate-pop-in"
            style={{
              left: Math.max(0, Math.min(width - 200, ax + cell / 2 - 100)),
              top: ay,
              width: 200,
              transform: "translateY(calc(-100% - 8px))",
            }}
          >
            <div className="flex justify-center">
              <TipCard tip={tipFor(activeDay)} hint={activeDay.count > 0} />
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-micro text-ink-3" aria-hidden="true">
        {ts("less")}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className={cn("size-2.5 rounded-[3px]")} style={{ background: heatColor(t) }} />
        ))}
        {ts("more")}
      </div>
    </div>
  );
}

// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/** Hand-drawn SVG bar charts for the Statistics screen. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { cn } from "@/components/ui";
import { ts } from "@/lib/strings/stats";

import { lineColor } from "./colors";
import { num } from "./format";
import { linear, nice, ticks } from "./scale";

/* ------------------------------ Hooks ------------------------------ */

/** The element's content width, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** False until the element first scrolls into view, then true for good. */
export function useShownOnce(ref: RefObject<Element | null>, ready: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (shown || !ready || !el) return;
    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        // one frame at the start state so the transition runs
        frame = requestAnimationFrame(() => setShown(true));
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, ready, shown]);
  return shown;
}

/* ------------------------------ Tooltip ------------------------------ */

export interface Tip {
  title: string;
  lines?: string[];
  rows?: { label: string; value: string; color?: string }[];
}

export function tipText(tip: Tip): string {
  return [tip.title, ...(tip.lines ?? []), ...(tip.rows ?? []).map((r) => `${r.label} ${r.value}`)].join(". ");
}

export function TipCard({ tip, hint }: { tip: Tip; hint?: boolean }) {
  return (
    <div className="min-w-[140px] max-w-[280px] rounded-[8px] border border-line bg-raised px-3 py-2 text-caption leading-snug shadow-pop">
      <p className="font-semibold text-ink">{tip.title}</p>
      {tip.lines?.map((line, i) => (
        <p key={i} className="mt-0.5 tabular text-ink-2">
          {line}
        </p>
      ))}
      {tip.rows && tip.rows.length > 0 && (
        <table className="mt-1.5 w-full border-collapse">
          <tbody>
            {tip.rows.map((row, i) => (
              <tr key={i}>
                <td className="py-[1px] pr-3 text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: row.color ?? "transparent" }}
                      aria-hidden="true"
                    />
                    {row.label}
                  </span>
                </td>
                <td className="py-[1px] text-right tabular font-medium text-ink">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hint && <p className="mt-1.5 text-micro text-ink-3">{ts("browseHint")}</p>}
    </div>
  );
}

/** A tooltip anchored at (x, y) in the chart box, kept inside its width. */
function Floating({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(160);
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  });
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 animate-pop-in"
      style={{ left, top: y, transform: "translateY(calc(-100% - 8px))" }}
    >
      {children}
    </div>
  );
}

/* ------------------------------ Bars ------------------------------ */

export interface BarSegment {
  value: number;
  color: string;
}

export interface Bar {
  x0: number;
  x1: number;
  /** Stacked bottom to top. */
  segments: BarSegment[];
  tip: Tip;
  onActivate?: () => void;
}

export interface ChartLine {
  /** Points in domain units and line units. */
  points: [number, number][];
  max: number;
  format: (n: number) => string;
  /** Skip points where this is false (gaps in the line). */
  defined?: (index: number) => boolean;
}

const FONT = 11;
const CHAR = 6.4;

function labelWidth(labels: string[]): number {
  return Math.ceil(Math.max(0, ...labels.map((l) => l.length)) * CHAR);
}

function topRounded(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface BarChartProps {
  bars: Bar[];
  domain: [number, number];
  xTicks?: { value: number; label: string }[];
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
  line?: ChartLine;
  height?: number;
  /** Space between neighbouring bars, in pixels or as a fraction of the bar's slot (below 1). */
  gap?: number;
  label: string;
  className?: string;
}

/** A bar chart that fills its container's width. */
export function BarChart(props: BarChartProps) {
  const [box, width] = useWidth<HTMLDivElement>();
  const shown = useShownOnce(box, width > 0);
  return (
    <div ref={box} className={cn("relative w-full select-none", props.className)} style={{ height: props.height ?? 200 }}>
      {width > 0 && <BarChartBody {...props} width={width} shown={shown} />}
    </div>
  );
}

/** The chart drawn at a known width; `shown` grows the bars to full height. */
export function BarChartBody({
  bars,
  domain,
  xTicks,
  xFormat = (n) => num(n),
  yFormat = (n) => num(n),
  line,
  height = 200,
  gap = 1,
  label,
  width,
  shown,
}: BarChartProps & { width: number; shown: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const descId = useId();

  const yMax = Math.max(0, ...bars.map((b) => b.segments.reduce((s, seg) => s + seg.value, 0)));
  const yDomain = nice([0, yMax || 1], 4);
  const yTicks = ticks(yDomain[0], yDomain[1], 4);
  const yLabels = yTicks.map(yFormat);
  const lineDomain = line ? nice([0, line.max || 1], 4) : null;
  const lineTicks = lineDomain ? ticks(0, lineDomain[1], 4) : [];
  const lineLabels = line ? lineTicks.map(line.format) : [];

  const top = 12;
  const bottom = height - 22;
  const left = labelWidth(yLabels) + 10;
  const right = width - (line ? labelWidth(lineLabels) + 10 : 6);
  const x = linear(domain, [left, right]);
  const y = linear(yDomain, [bottom, top]);
  const yl = lineDomain ? linear(lineDomain, [bottom, top]) : null;

  const geometry = bars.map((b) => {
    const px0 = x(b.x0);
    const px1 = x(b.x1);
    const slot = px1 - px0;
    const g = gap < 1 ? slot * gap : gap;
    const w = Math.max(0, slot - g);
    return { px0, slot, bx: px0 + (slot - w) / 2, w };
  });
  const focusable = bars.map((_, i) => i).filter((i) => geometry[i].w > 0);

  const autoTicks =
    xTicks ??
    ticks(domain[0], domain[1], Math.max(2, Math.floor((right - left) / 72))).map((value) => ({ value, label: xFormat(value) }));

  const move = (e: KeyboardEvent) => {
    if (!focusable.length) return;
    const pos = active === null ? -1 : focusable.indexOf(active);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = focusable[Math.min(focusable.length - 1, pos + 1)];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = focusable[Math.max(0, pos - 1)];
    else if (e.key === "Home") next = focusable[0];
    else if (e.key === "End") next = focusable[focusable.length - 1];
    else if ((e.key === "Enter" || e.key === " ") && active !== null && bars[active].onActivate) {
      e.preventDefault();
      bars[active].onActivate?.();
      return;
    }
    if (next !== null && next !== undefined) {
      e.preventDefault();
      setKeyboard(true);
      setActive(next);
    }
  };

  const linePath =
    line && yl
      ? line.points
          .map(([px, v], i) => ({ px: x(px), py: yl(v), ok: line.defined ? line.defined(i) : true }))
          .reduce<{ d: string; pen: boolean }>(
            (acc, p) => {
              if (!p.ok) return { d: acc.d, pen: false };
              return { d: `${acc.d}${acc.pen ? "L" : "M"}${p.px.toFixed(1)},${p.py.toFixed(1)}`, pen: true };
            },
            { d: "", pen: false },
          ).d
      : "";

  const activeBar = active !== null ? bars[active] : null;
  const activeGeom = active !== null ? geometry[active] : null;
  const activeTop = activeBar ? y(activeBar.segments.reduce((s, seg) => s + seg.value, 0)) : 0;

  return (
    <>
        <svg
          width={width}
          height={height}
          tabIndex={0}
          role="group"
          aria-label={label}
          aria-describedby={descId}
          className="block overflow-visible rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          onKeyDown={move}
          onFocus={(e) => {
            // only for keyboard focus; a click shows the bar under the pointer
            if (active === null && focusable.length && e.currentTarget.matches(":focus-visible")) {
              setKeyboard(true);
              setActive(focusable[focusable.length - 1]);
            }
          }}
          onBlur={() => {
            setKeyboard(false);
            setActive(null);
          }}
          onPointerLeave={() => !keyboard && setActive(null)}
        >
          {/* grid */}
          {yTicks.map((t, i) => (
            <g key={`y${t}`}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} />
              <text
                x={left - 8}
                y={y(t)}
                dy="0.35em"
                textAnchor="end"
                fontSize={FONT}
                fill="var(--ink-3)"
                className="tabular"
              >
                {yLabels[i]}
              </text>
            </g>
          ))}
          {lineTicks.map((t, i) => (
            <text
              key={`l${t}`}
              x={right + 8}
              y={yl!(t)}
              dy="0.35em"
              fontSize={FONT}
              fill="var(--ink-3)"
              className="tabular"
            >
              {lineLabels[i]}
            </text>
          ))}
          {autoTicks.map((t) => (
            <text
              key={`x${t.value}`}
              x={x(t.value)}
              y={bottom + 15}
              textAnchor="middle"
              fontSize={FONT}
              fill="var(--ink-3)"
              className="tabular"
            >
              {t.label}
            </text>
          ))}

          {/* hover highlight */}
          {activeGeom && activeGeom.w > 0 && (
            <rect x={activeGeom.px0} y={top} width={activeGeom.slot} height={bottom - top} fill="var(--surface-3)" />
          )}

          {/* bars */}
          <g
            style={{
              transform: `scaleY(${shown ? 1 : 0})`,
              transformOrigin: `0px ${bottom}px`,
              transition: "transform 260ms var(--ease-out)",
            }}
          >
            {bars.map((b, i) => {
              const { bx, w } = geometry[i];
              if (w <= 0) return null;
              let base = 0;
              const visible = b.segments.filter((s) => s.value > 0);
              return (
                <g key={i}>
                  {visible.map((s, j) => {
                    const y0 = y(base);
                    base += s.value;
                    const y1 = y(base);
                    const h = Math.max(0, y0 - y1);
                    const isTop = j === visible.length - 1;
                    return isTop ? (
                      <path key={j} d={topRounded(bx, y1, w, h, w > 4 ? 2 : 0)} fill={s.color} />
                    ) : (
                      <rect key={j} x={bx} y={y1} width={w} height={h} fill={s.color} />
                    );
                  })}
                </g>
              );
            })}
          </g>

          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={shown ? 0.9 : 0}
              style={{ transition: "opacity 260ms var(--ease-out)" }}
            />
          )}

          {/* hit areas */}
          {bars.map((b, i) => {
            const { px0, slot, w } = geometry[i];
            if (w <= 0) return null;
            return (
              <rect
                key={`h${i}`}
                x={px0}
                y={top}
                width={slot}
                height={bottom - top}
                fill="transparent"
                style={{ cursor: b.onActivate ? "pointer" : "default" }}
                onPointerEnter={() => {
                  setKeyboard(false);
                  setActive(i);
                }}
                onClick={() => b.onActivate?.()}
              />
            );
          })}
        </svg>
      <p id={descId} className="sr-only">
        {ts("chartKeys")}
      </p>
      <p className="sr-only" aria-live="polite">
        {keyboard && activeBar ? tipText(activeBar.tip) : ""}
      </p>
      {activeBar && activeGeom && (
        <Floating x={activeGeom.px0 + activeGeom.slot / 2} y={Math.max(top, activeTop)} width={width}>
          <TipCard tip={activeBar.tip} hint={!!activeBar.onActivate} />
        </Floating>
      )}
    </>
  );
}

/** Where a chart would be, while there is nothing to draw. */
export function ChartEmpty({ height = 200, children }: { height?: number; children: ReactNode }) {
  return (
    <div
      className="grid place-items-center rounded-[8px] border border-dashed border-line text-control text-ink-3"
      style={{ height }}
    >
      {children}
    </div>
  );
}

/** A colour key: swatch and label per series. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

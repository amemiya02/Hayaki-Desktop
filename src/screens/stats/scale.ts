// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * The few d3 helpers Anki's graphs depend on, reproduced so Hayaki buckets
 * the data exactly as upstream does: `ticks`, `tickIncrement` and `bin` follow
 * d3-array 3.2.4, `nice` follows d3-scale 4.0.2's linear scale, and
 * `quantile` follows d3's R-7 definition on a sorted array.
 */

const e10 = Math.sqrt(50);
const e5 = Math.sqrt(10);
const e2 = Math.sqrt(2);

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / Math.pow(10, power);
  const factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  let i1: number;
  let i2: number;
  let inc: number;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

/** Round values between `start` and `stop`, about `count` of them (d3 `ticks`). */
export function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  const [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  const out: number[] = new Array(n);
  if (reverse) {
    if (inc < 0) for (let i = 0; i < n; ++i) out[i] = (i2 - i) / -inc;
    else for (let i = 0; i < n; ++i) out[i] = (i2 - i) * inc;
  } else {
    if (inc < 0) for (let i = 0; i < n; ++i) out[i] = (i1 + i) / -inc;
    else for (let i = 0; i < n; ++i) out[i] = (i1 + i) * inc;
  }
  return out;
}

export function tickIncrement(start: number, stop: number, count: number): number {
  return tickSpec(start, stop, count)[2];
}

/** Extends a domain to round values (d3 `scaleLinear().nice(count)`). */
export function nice(domain: [number, number], count = 10): [number, number] {
  const d: [number, number] = [domain[0], domain[1]];
  let i0 = 0;
  let i1 = 1;
  let start = d[i0];
  let stop = d[i1];
  let prestep: number | undefined;
  let step: number;
  let maxIter = 10;
  if (stop < start) {
    [start, stop] = [stop, start];
    [i0, i1] = [i1, i0];
  }
  while (maxIter-- > 0) {
    step = tickIncrement(start, stop, count);
    if (step === prestep) {
      d[i0] = start;
      d[i1] = stop;
      return d;
    } else if (step > 0) {
      start = Math.floor(start / step) * step;
      stop = Math.ceil(stop / step) * step;
    } else if (step < 0) {
      start = Math.ceil(start * step) / step;
      stop = Math.floor(stop * step) / step;
    } else {
      break;
    }
    prestep = step;
  }
  return domain;
}

/** d3 `range(start, stop, step)`. */
export function range(start: number, stop: number, step = 1): number[] {
  const n = Math.max(0, Math.ceil((stop - start) / step)) | 0;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; ++i) out[i] = start + i * step;
  return out;
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function extent(values: Iterable<number>): [number, number] | undefined {
  let lo: number | undefined;
  let hi: number | undefined;
  for (const v of values) {
    if (lo === undefined || v < lo) lo = v;
    if (hi === undefined || v > hi) hi = v;
  }
  return lo === undefined || hi === undefined ? undefined : [lo, hi];
}

/** d3 `quantile` on an already sorted array. */
export function quantileSorted(sorted: number[], p: number): number | undefined {
  const n = sorted.length;
  if (!n) return undefined;
  if (p <= 0 || n < 2) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  const i = (n - 1) * p;
  const i0 = Math.floor(i);
  const v0 = sorted[i0];
  const v1 = sorted[i0 + 1];
  return v0 + (v1 - v0) * (i - i0);
}

export interface Bin<T> {
  x0: number;
  x1: number;
  items: T[];
}

function bisectRight(a: number[], x: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Groups `data` into bins at explicit thresholds within `domain`
 * (d3 `bin().value(value).domain(domain).thresholds(thresholds)`).
 */
export function bin<T>(data: Iterable<T>, value: (d: T) => number, domain: [number, number], thresholds: number[]): Bin<T>[] {
  const items = Array.from(data);
  const [x0, x1] = domain;
  let tz = thresholds.slice();
  let m = tz.length;
  let a = 0;
  let b = m;
  while (a < m && tz[a] <= x0) ++a;
  while (b > 0 && tz[b - 1] > x1) --b;
  if (a || b < m) {
    tz = tz.slice(a, b);
    m = b - a;
  }
  const bins: Bin<T>[] = new Array(Math.max(0, m) + 1);
  for (let i = 0; i <= m; ++i) {
    bins[i] = { x0: i > 0 ? tz[i - 1] : x0, x1: i < m ? tz[i] : x1, items: [] };
  }
  for (const item of items) {
    const x = value(item);
    if (x != null && x0 <= x && x <= x1) {
      bins[bisectRight(tz, x, 0, m)].items.push(item);
    }
  }
  return bins;
}

/** A protobuf map (`{ [key: number]: V }`) as a Map with numeric keys, in upstream's order. */
export function numericMap<V>(obj: { [key: number]: V }): Map<number, V> {
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v as V]));
}

/** A linear mapping from `domain` onto `out`. */
export function linear(domain: [number, number], out: [number, number]): (n: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = out;
  const span = d1 - d0 || 1;
  return (n) => r0 + ((n - d0) / span) * (r1 - r0);
}

/**
 * Charts drawn from data: pure SVG on the theme tokens, a tooltip on hover,
 * and one sweep on first draw (never again, nothing loops). Colour carries
 * meaning only: --vo-a the primary series (blue), --vo-b the secondary
 * (teal), red bad, amber warn, green good, everything else ink and grey.
 *
 *   <LineChart labels={months} series={[{ key: 'arr', label: 'ARR', values }]} format={(v) => money(v, 'USD', { compact: true })} />
 *   <BarChart labels={quarters} series={[{ key: 'calls', label: 'Calls', values: [-120, -80] }, ...]} lines={[navSeries]} />
 *   <Sparkline values={arr} />   <Ring value={0.62} center="62%" />   <Meter value={8.5} max={24} marks={[{ value: 6 }]} />
 *   <Funnel stages={[{ label: 'Sourced', value: 140 }, ...]} />   <Tally options={[{ label: '5', count: 3 }]} />
 *   <PathGraph paths={...} />   <TileMap segments={...} />
 *
 * Every chart takes values as plain numbers (major units or counts); money
 * goes through `format` (lib/format.ts money(..., { compact: true })).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { compact, initials, num } from '../lib/format.ts';

export type ChartTone = 'a' | 'b' | 'ink' | 'muted' | 'good' | 'warn' | 'bad';

export const TONE: Record<ChartTone, string> = {
  a: 'var(--vo-a)',
  b: 'var(--vo-b)',
  ink: 'var(--vo-ink)',
  muted: 'var(--vo-line-2)',
  good: 'var(--vo-good)',
  warn: 'var(--vo-warn)',
  bad: 'var(--vo-bad)',
};

const DEFAULT_TONES: ChartTone[] = ['a', 'b', 'ink', 'warn', 'good'];

export interface Series {
  key: string;
  label: string;
  values: (number | null)[];
  tone?: ChartTone | undefined;
  dashed?: boolean | undefined;
  /** Values from this index on are a forecast (drawn dashed). */
  forecastFrom?: number | undefined;
}

/* --------------------------------------------------------------- helpers */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** False on the first paint, true right after: the one sweep. */
function useDrawn(): boolean {
  const [drawn, setDrawn] = useState(reducedMotion);
  useEffect(() => {
    if (drawn) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [drawn]);
  return drawn;
}

const SWEEP = 'transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1)';

/** A clip rect that sweeps left to right once. */
function SweepClip({ id, width, height, drawn }: { id: string; width: number; height: number; drawn: boolean }): React.JSX.Element {
  return (
    <clipPath id={id}>
      <rect x={-4} y={-4} width={width + 8} height={height + 8} style={{ transformOrigin: '0px 0px', transform: drawn ? 'scaleX(1)' : 'scaleX(0)', transition: SWEEP }} />
    </clipPath>
  );
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    if (min === 0) return [0, 1];
    return min > 0 ? [0, min] : [min, 0];
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

function sid(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** The chart tooltip box (positioned inside the chart's relative frame). */
function TipBox({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(160);
  useLayoutEffect(() => {
    if (ref.current !== null) setW(ref.current.offsetWidth);
  });
  const left = Math.min(Math.max(0, x + 12), Math.max(0, width - w));
  const flip = x + 12 + w > width && x - 12 - w >= 0;
  return (
    <div ref={ref} role="tooltip" style={{ left: flip ? x - 12 - w : left, top: Math.max(0, y) }} className="pointer-events-none absolute z-10 min-w-[120px] rounded-[4px] bg-[var(--vo-ink)] px-2.5 py-1.5 text-[12px] leading-[17px] text-[var(--vo-on-ink)] shadow-[var(--vo-shadow-lg)]">
      {children}
    </div>
  );
}

function TipRow({ tone, label, value, dashed }: { tone: ChartTone; label: string; value: string; dashed?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={cn('inline-block h-[3px] w-2.5 rounded-full', dashed === true && 'opacity-60')} style={{ background: TONE[tone] }} />
      <span className="min-w-0 flex-1 opacity-80">{label}</span>
      <span className="vo-mono vo-num">{value}</span>
    </div>
  );
}

/** A small legend: dots and 12px labels. */
export function Legend({ items, className }: { items: { label: string; tone: ChartTone; dashed?: boolean | undefined }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--vo-muted)]', className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block h-[3px] w-3 rounded-full', it.dashed === true && 'opacity-60')} style={{ background: TONE[it.tone] }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const AXIS = 'vo-mono fill-[var(--vo-muted)] text-[12px]';

interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function xLabelEvery(n: number, plotW: number): number {
  const fits = Math.max(2, Math.floor(plotW / 64));
  return Math.max(1, Math.ceil(n / fits));
}

/** Show an x label: every `every`-th, the last always, and none crowding the last. */
function showX(i: number, n: number, every: number): boolean {
  if (i === n - 1) return true;
  if (i % every !== 0) return false;
  const gap = n - 1 - i;
  return gap >= Math.max(1, Math.ceil(every * 0.6));
}

/* ------------------------------------------------------------- LineChart */

export interface LineChartProps {
  labels: string[];
  series: Series[];
  height?: number | undefined;
  /** Values in the tooltip. */
  format?: ((v: number) => string) | undefined;
  /** Axis ticks (default compact numbers). */
  yFormat?: ((v: number) => string) | undefined;
  /** Fill under the first series. */
  area?: boolean | undefined;
  /** Horizontal reference lines (a threshold, a target). */
  refLines?: { value: number; label: string; tone?: ChartTone | undefined }[] | undefined;
  /** Include zero in the value range (default true). */
  zero?: boolean | undefined;
  className?: string | undefined;
  label?: string | undefined;
}

/** Lines over time, several series, an optional dashed forecast and reference lines. */
export function LineChart({ labels, series, height = 200, format = (v) => num(v, 2), yFormat = (v) => compact(v), area, refLines, zero = true, className, label }: LineChartProps): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const drawn = useDrawn();
  const clip = sid(useId());
  const [hover, setHover] = useState<number | null>(null);
  const f: Frame = { left: 44, right: 8, top: 8, bottom: 22 };
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
  for (const r of refLines ?? []) vals.push(r.value);
  let lo = vals.length > 0 ? Math.min(...vals) : 0;
  let hi = vals.length > 0 ? Math.max(...vals) : 1;
  if (zero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const ticks = niceTicks(lo, hi, 3);
  const y0 = ticks[0] ?? lo;
  const y1 = ticks[ticks.length - 1] ?? hi;
  const pw = Math.max(10, width - f.left - f.right);
  const ph = Math.max(10, height - f.top - f.bottom);
  const n = labels.length;
  const X = (i: number): number => f.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const Y = (v: number): number => f.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const every = xLabelEvery(n, pw);
  const path = (s: Series, from: number, to: number): string => {
    let d = '';
    let pen = false;
    for (let i = from; i <= to && i < n; i++) {
      const v = s.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const first = series[0];
  const areaPath = (() => {
    if (area !== true || first === undefined) return '';
    const pts = first.values.map((v, i) => (v === null ? null : [X(i), Y(v)] as const)).filter((p): p is readonly [number, number] => p !== null);
    if (pts.length < 2) return '';
    const base = Y(Math.max(y0, Math.min(0, y1)));
    return `M${pts[0]?.[0]},${base}` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + `L${pts[pts.length - 1]?.[0]},${base}Z`;
  })();
  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (n === 0) return;
    const i = Math.round(((x - f.left) / pw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label ?? series.map((s) => s.label).join(', ')} onPointerMove={move} onPointerLeave={() => setHover(null)} className="block touch-pan-y overflow-visible">
          <defs>
            <SweepClip id={clip} width={width} height={height} drawn={drawn} />
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={f.left} x2={f.left + pw} y1={Y(t)} y2={Y(t)} style={{ stroke: t === 0 ? 'var(--vo-line)' : 'var(--vo-hair)' }} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={f.left - 8} y={Y(t)} dy="0.32em" textAnchor="end" className={AXIS}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            showX(i, n, every) ? (
              <text key={i} x={X(i)} y={height - 4} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className={AXIS}>
                {l}
              </text>
            ) : null,
          )}
          <g clipPath={`url(#${clip})`}>
            {areaPath !== '' && <path d={areaPath} style={{ fill: TONE[first?.tone ?? 'a'], opacity: 0.1 }} />}
            {(refLines ?? []).map((r) => (
              <g key={r.label}>
                <line x1={f.left} x2={f.left + pw} y1={Y(r.value)} y2={Y(r.value)} style={{ stroke: TONE[r.tone ?? 'warn'] }} strokeWidth={1} strokeDasharray="3 3" />
                <text x={f.left + pw} y={Y(r.value) - f.top < 14 ? Y(r.value) + 14 : Y(r.value) - 4} textAnchor="end" className="text-[12px]" style={{ fill: TONE[r.tone ?? 'warn'] }}>
                  {r.label}
                </text>
              </g>
            ))}
            {series.map((s, si) => {
              const tone = TONE[s.tone ?? DEFAULT_TONES[si % DEFAULT_TONES.length] ?? 'a'];
              const fc = s.forecastFrom;
              return (
                <g key={s.key}>
                  <path d={path(s, 0, fc !== undefined ? fc : n - 1)} fill="none" style={{ stroke: tone }} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed === true ? '4 4' : undefined} />
                  {fc !== undefined && <path d={path(s, Math.max(0, fc), n - 1)} fill="none" style={{ stroke: tone }} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.75} />}
                </g>
              );
            })}
          </g>
          {hover !== null && (
            <g>
              <line x1={X(hover)} x2={X(hover)} y1={f.top} y2={f.top + ph} style={{ stroke: 'var(--vo-line-2)' }} strokeWidth={1} />
              {series.map((s, si) => {
                const v = s.values[hover];
                if (v === null || v === undefined) return null;
                return <circle key={s.key} cx={X(hover)} cy={Y(v)} r={3.5} style={{ fill: 'var(--vo-raised)', stroke: TONE[s.tone ?? DEFAULT_TONES[si % DEFAULT_TONES.length] ?? 'a'] }} strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <TipBox x={X(hover)} y={f.top} width={width}>
          <div className="mb-0.5 font-medium">{labels[hover]}</div>
          {series.map((s, si) => {
            const v = s.values[hover];
            return <TipRow key={s.key} tone={s.tone ?? DEFAULT_TONES[si % DEFAULT_TONES.length] ?? 'a'} label={s.label} value={v === null || v === undefined ? 'Unknown' : format(v)} dashed={s.forecastFrom !== undefined && hover >= s.forecastFrom} />;
          })}
        </TipBox>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- BarChart */

export interface BarChartProps {
  labels: string[];
  series: Series[];
  /** Line series drawn over the bars on the same scale (NAV over calls and distributions). */
  lines?: Series[] | undefined;
  stacked?: boolean | undefined;
  height?: number | undefined;
  format?: ((v: number) => string) | undefined;
  yFormat?: ((v: number) => string) | undefined;
  /** One bar index drawn darker (this week). */
  highlight?: number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}

/** Bars: grouped or stacked; negative values below the axis (calls), positive above (distributions). */
export function BarChart({ labels, series, lines, stacked, height = 200, format = (v) => num(v, 2), yFormat = (v) => compact(v), highlight, className, label }: BarChartProps): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const drawn = useDrawn();
  const clip = sid(useId());
  const [hover, setHover] = useState<number | null>(null);
  const f: Frame = { left: 44, right: 8, top: 8, bottom: 22 };
  const n = labels.length;
  const ext = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      if (stacked === true) {
        let pos = 0;
        let neg = 0;
        for (const s of series) {
          const v = s.values[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      } else for (const s of series) {
        const v = s.values[i] ?? 0;
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
      for (const s of lines ?? []) {
        const v = s.values[i];
        if (v !== null && v !== undefined) {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
      }
    }
    return { lo, hi: hi === lo ? lo + 1 : hi };
  }, [series, lines, stacked, n]);
  const ticks = niceTicks(ext.lo, ext.hi, 3);
  const y0 = ticks[0] ?? ext.lo;
  const y1 = ticks[ticks.length - 1] ?? ext.hi;
  const pw = Math.max(10, width - f.left - f.right);
  const ph = Math.max(10, height - f.top - f.bottom);
  const band = n > 0 ? pw / n : pw;
  const Y = (v: number): number => f.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const zeroY = Y(0);
  const groups = stacked === true ? 1 : Math.max(1, series.length);
  const barW = Math.max(2, Math.min(28, (band * 0.68) / groups));
  const every = xLabelEvery(n, pw);
  const cx = (i: number): number => f.left + band * i + band / 2;
  const toneOf = (s: Series, si: number): ChartTone => s.tone ?? DEFAULT_TONES[si % DEFAULT_TONES.length] ?? 'a';
  const linePath = (s: Series): string => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label ?? series.map((s) => s.label).join(', ')}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - f.left) / band);
            setHover(i >= 0 && i < n ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
          className="block touch-pan-y overflow-visible"
        >
          <defs>
            <SweepClip id={clip} width={width} height={height} drawn={drawn} />
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={f.left} x2={f.left + pw} y1={Y(t)} y2={Y(t)} style={{ stroke: 'var(--vo-hair)' }} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={f.left - 8} y={Y(t)} dy="0.32em" textAnchor="end" className={AXIS}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {hover !== null && <rect x={f.left + band * hover} y={f.top} width={band} height={ph} style={{ fill: 'var(--vo-hover)' }} />}
          <g clipPath={`url(#${clip})`}>
            {labels.map((_, i) => {
              if (stacked === true) {
                let pos = 0;
                let neg = 0;
                return (
                  <g key={i}>
                    {series.map((s, si) => {
                      const v = s.values[i] ?? 0;
                      if (v === 0) return null;
                      const from = v >= 0 ? pos : neg;
                      const to = from + v;
                      if (v >= 0) pos = to;
                      else neg = to;
                      const top = Math.min(Y(from), Y(to));
                      return <rect key={s.key} x={cx(i) - barW / 2} y={top} width={barW} height={Math.max(1, Math.abs(Y(to) - Y(from)))} rx={1.5} style={{ fill: TONE[toneOf(s, si)], opacity: highlight !== undefined && highlight !== i ? 0.55 : 1 }} />;
                    })}
                  </g>
                );
              }
              return (
                <g key={i}>
                  {series.map((s, si) => {
                    const v = s.values[i];
                    if (v === null || v === undefined || v === 0) return null;
                    const x = cx(i) - (barW * groups) / 2 + si * barW;
                    const top = v >= 0 ? Y(v) : zeroY;
                    return <rect key={s.key} x={x + 0.5} y={top} width={Math.max(1, barW - 1)} height={Math.max(1, Math.abs(Y(v) - zeroY))} rx={1.5} style={{ fill: TONE[toneOf(s, si)], opacity: highlight !== undefined && highlight !== i ? 0.55 : 1 }} />;
                  })}
                </g>
              );
            })}
            {(lines ?? []).map((s, si) => (
              <path key={s.key} d={linePath(s)} fill="none" style={{ stroke: TONE[s.tone ?? 'ink'] }} strokeWidth={1.75} strokeLinejoin="round" strokeDasharray={s.dashed === true ? '4 4' : undefined} data-i={si} />
            ))}
          </g>
          <line x1={f.left} x2={f.left + pw} y1={zeroY} y2={zeroY} style={{ stroke: 'var(--vo-line-2)' }} strokeWidth={1} shapeRendering="crispEdges" />
          {labels.map((l, i) =>
            showX(i, n, every) ? (
              <text key={i} x={cx(i)} y={height - 4} textAnchor="middle" className={AXIS}>
                {l}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <TipBox x={cx(hover)} y={f.top} width={width}>
          <div className="mb-0.5 font-medium">{labels[hover]}</div>
          {series.map((s, si) => (
            <TipRow key={s.key} tone={toneOf(s, si)} label={s.label} value={format(s.values[hover] ?? 0)} />
          ))}
          {(lines ?? []).map((s) => (
            <TipRow key={s.key} tone={s.tone ?? 'ink'} label={s.label} value={s.values[hover] === null || s.values[hover] === undefined ? 'Unknown' : format(s.values[hover] ?? 0)} />
          ))}
        </TipBox>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Sparkline */

/** A tiny trend line for a row (ARR, revenue). The last point carries a dot. */
/** A point's state on a Sparkline: 'staged' (not verified yet) draws dashed; 'verified' or none draws solid. */
export type PointStatus = 'verified' | 'staged' | null | undefined;

/**
 * A tiny trend line for a row (ARR, revenue). The last point carries a dot.
 * `status` (one per value, optional) draws the segments into and out of a
 * staged point dashed and its dot hollow, as LineChart draws a forecast.
 */
export function Sparkline({ values, status, tone = 'a', width = 80, height = 24, area, format = (v) => compact(v), className, label }: { values: (number | null)[]; status?: PointStatus[] | undefined; tone?: ChartTone | undefined; width?: number | undefined; height?: number | undefined; area?: boolean | undefined; format?: ((v: number) => string) | undefined; className?: string | undefined; label?: string | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  const clip = sid(useId());
  const [hover, setHover] = useState<number | null>(null);
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return <span className={cn('inline-block', className)} style={{ width, height }} aria-hidden />;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const n = values.length;
  const X = (i: number): number => 2 + (i / Math.max(1, n - 1)) * (width - 4);
  const Y = (v: number): number => 2 + (height - 4) - ((v - lo) / (hi - lo || 1)) * (height - 4);
  const staged = (i: number): boolean => status?.[i] === 'staged';
  const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  // Solid and dashed runs: a segment touching a staged point is dashed.
  let solid = '';
  let dashed = '';
  for (let k = 1; k < pts.length; k++) {
    const p0 = pts[k - 1];
    const p1 = pts[k];
    if (p0 === undefined || p1 === undefined) continue;
    const seg = `M${X(p0.i).toFixed(1)},${Y(p0.v).toFixed(1)}L${X(p1.i).toFixed(1)},${Y(p1.v).toFixed(1)}`;
    if (staged(p0.i) || staged(p1.i)) dashed += seg;
    else solid += seg;
  }
  const last = pts[pts.length - 1];
  const hv = hover !== null ? pts.reduce((b, p) => (Math.abs(p.i - hover) < Math.abs(b.i - hover) ? p : b), pts[0] ?? { v: 0, i: 0 }) : null;
  return (
    <span className={cn('relative inline-block align-middle', className)} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label ?? `Trend, last ${last !== undefined ? format(last.v) : ''}`}
        className="block overflow-visible"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left - 2) / (width - 4)) * (n - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <SweepClip id={clip} width={width} height={height} drawn={drawn} />
        </defs>
        <g clipPath={`url(#${clip})`}>
          {area === true && <path d={`${d}L${X(last?.i ?? 0)},${height}L${X(pts[0]?.i ?? 0)},${height}Z`} style={{ fill: TONE[tone], opacity: 0.12 }} />}
          {solid !== '' && <path d={solid} fill="none" style={{ stroke: TONE[tone] }} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
          {dashed !== '' && <path d={dashed} fill="none" style={{ stroke: TONE[tone] }} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.75} />}
          {last !== undefined && (staged(last.i) ? <circle cx={X(last.i)} cy={Y(last.v)} r={2} style={{ fill: 'var(--vo-raised)', stroke: TONE[tone] }} strokeWidth={1.25} /> : <circle cx={X(last.i)} cy={Y(last.v)} r={2} style={{ fill: TONE[tone] }} />)}
        </g>
        {hv !== null && <circle cx={X(hv.i)} cy={Y(hv.v)} r={3} style={{ fill: 'var(--vo-raised)', stroke: TONE[tone] }} strokeWidth={1.5} />}
      </svg>
      {hv !== null && (
        <span role="tooltip" className="vo-mono vo-num pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[var(--vo-ink)] px-1.5 py-0.5 text-[12px] text-[var(--vo-on-ink)]">
          {format(hv.v)}
          {staged(hv.i) && <span className="ml-1.5 font-sans opacity-80">Staged</span>}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ Ring */

/** A donut with a centre figure: one value of a max, or several segments. */
export function Ring({ value = 0, max = 1, segments, size = 120, thickness = 10, center, tone = 'a', label, format = (v) => num(v, 1) }: { value?: number | undefined; max?: number | undefined; segments?: { label: string; value: number; tone?: ChartTone | undefined }[] | undefined; size?: number | undefined; thickness?: number | undefined; center?: ReactNode; tone?: ChartTone | undefined; label?: string | undefined; format?: ((v: number) => string) | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  const [hover, setHover] = useState<number | null>(null);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const segs = segments ?? [{ label: label ?? '', value: Math.max(0, Math.min(value, max)), tone }];
  const total = segments !== undefined ? Math.max(1e-9, segments.reduce((a, s) => a + s.value, 0)) : max || 1;
  let acc = 0;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label ?? segs.map((s) => `${s.label} ${format(s.value)}`).join(', ')} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--vo-sunk)' }} strokeWidth={thickness} />
        {segs.map((s, i) => {
          const len = (s.value / total) * c;
          const off = acc;
          acc += len;
          const gap = segs.length > 1 && len > 2 ? 1.5 : 0;
          return (
            <circle
              key={s.label + i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={hover === i ? thickness + 2 : thickness}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={drawn ? -off : -off + len}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              style={{ stroke: TONE[s.tone ?? DEFAULT_TONES[i % DEFAULT_TONES.length] ?? 'a'], transition: `stroke-dashoffset 700ms cubic-bezier(0.2,0.7,0.2,1), stroke-width 150ms ease`, opacity: drawn ? 1 : 0 }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {hover !== null && segs[hover] !== undefined ? (
          <>
            <span className="vo-mono vo-num text-[15px]">{format(segs[hover]?.value ?? 0)}</span>
            <span className="max-w-[80%] truncate text-[12px] text-[var(--vo-muted)]">{segs[hover]?.label}</span>
          </>
        ) : (
          <span className="vo-mono vo-num text-[15px]">{center}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Funnel */

/** Stage bars, left to right in reading order, with each stage's conversion from the one before. */
export function Funnel({ stages, format = (v) => num(v), className, tone = 'a', label }: { stages: { label: string; value: number }[]; format?: ((v: number) => string) | undefined; className?: string | undefined; tone?: ChartTone | undefined; label?: string | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div role="img" aria-label={label ?? stages.map((s) => `${s.label} ${format(s.value)}`).join(', ')} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]?.value ?? 0 : 0;
        const conv = i > 0 && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div key={s.label} title={conv !== null ? `${s.label}: ${format(s.value)}, ${conv}% of ${stages[i - 1]?.label ?? ''}` : `${s.label}: ${format(s.value)}`} className="group grid grid-cols-[minmax(72px,110px)_minmax(0,1fr)_40px] items-center gap-3">
            <span className="truncate text-[12px] text-[var(--vo-ink-2)]">{s.label}</span>
            <span className="relative flex h-5 items-center">
              <span className="block h-full rounded-[3px] transition-[width,filter] duration-700 ease-out group-hover:brightness-110" style={{ width: drawn ? `${Math.max(1.5, (s.value / max) * 100)}%` : '0%', background: TONE[tone], opacity: 0.25 + 0.75 * (1 - i / Math.max(1, stages.length)) }} />
              <span className="vo-mono vo-num ml-2 shrink-0 text-[12px] text-[var(--vo-ink)]">{format(s.value)}</span>
            </span>
            <span className="vo-mono vo-num text-right text-[12px] text-[var(--vo-muted)]">{conv !== null ? `${conv}%` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Meter */

/** A bar of a total with threshold marks: runway, paid, used. Shows the percent (or `format`) at the right. */
export function Meter({ value, max, tone = 'ink', marks, label, format, height = 6, className, showValue = true }: { value: number | null; max: number; tone?: ChartTone | undefined; marks?: { value: number; label?: string | undefined; tone?: ChartTone | undefined }[] | undefined; label?: string | undefined; format?: ((v: number) => string) | undefined; height?: number | undefined; className?: string | undefined; showValue?: boolean | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  const known = value !== null && Number.isFinite(value);
  const p = known && max > 0 ? Math.max(0, Math.min(1, (value ?? 0) / max)) : 0;
  const text = !known ? 'Unknown' : format !== undefined ? format(value ?? 0) : `${Math.round(p * 100)}%`;
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} title={label !== undefined ? `${label}: ${text}` : text}>
      {label !== undefined && <span className="shrink-0 text-[12px] text-[var(--vo-ink-2)]">{label}</span>}
      <span role="meter" aria-valuenow={known ? (value ?? 0) : undefined} aria-valuemin={0} aria-valuemax={max} aria-label={label ?? 'Progress'} className="relative min-w-[40px] flex-1 overflow-hidden rounded-full bg-[var(--vo-sunk)]" style={{ height }}>
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: drawn ? `${p * 100}%` : '0%', background: TONE[tone] }} />
        {(marks ?? []).map((m) => (
          <span key={m.value} aria-hidden title={m.label} className="absolute inset-y-0 w-px" style={{ left: `${Math.max(0, Math.min(100, (m.value / (max || 1)) * 100))}%`, background: TONE[m.tone ?? 'bad'] }} />
        ))}
      </span>
      {showValue && <span className={cn('vo-mono vo-num shrink-0 text-[12px]', known ? 'text-[var(--vo-ink)]' : 'font-sans text-[var(--vo-muted)]')}>{text}</span>}
    </div>
  );
}

/* ----------------------------------------------------------------- Tally */

/** A vote distribution: one column per option with its count (revealed votes only). */
export function Tally({ options, className, height = 64, label }: { options: { label: string; count: number; tone?: ChartTone | undefined }[]; className?: string | undefined; height?: number | undefined; label?: string | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  const max = Math.max(1, ...options.map((o) => o.count));
  return (
    <div role="img" aria-label={label ?? options.map((o) => `${o.label}: ${o.count}`).join(', ')} className={cn('flex items-end gap-3', className)}>
      {options.map((o) => (
        <div key={o.label} title={`${o.label}: ${o.count}`} className="group flex w-9 flex-col items-center gap-1">
          <span className="vo-mono vo-num text-[12px] text-[var(--vo-ink)]">{o.count}</span>
          <span className="flex w-full items-end rounded-[3px] bg-[var(--vo-sunk)]" style={{ height }}>
            <span className="block w-full rounded-[3px] transition-[height,filter] duration-700 ease-out group-hover:brightness-110" style={{ height: drawn ? `${(o.count / max) * 100}%` : '0%', minHeight: o.count > 0 ? 2 : 0, background: TONE[o.tone ?? 'ink'] }} />
          </span>
          <span className="vo-mono text-[12px] text-[var(--vo-muted)]">{o.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- PathGraph */

export interface PathNode {
  id: string;
  label: string;
  kind: 'member' | 'connector' | 'target';
}

export interface IntroPath {
  nodes: PathNode[];
  /** One per edge, 0 to 1 (drawn as width and darkness; shown as 0 to 100). */
  strengths: number[];
}

/**
 * Intro paths as a picture: members on the left, connectors in the middle,
 * the target on the right; each edge's width and darkness is its strength,
 * labelled 0 to 100. The first path is the best one (drawn in ink).
 */
export function PathGraph({ paths, height, onSelect, selected, className }: { paths: IntroPath[]; height?: number | undefined; onSelect?: ((index: number) => void) | undefined; selected?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const drawn = useDrawn();
  const clip = sid(useId());
  const [hover, setHover] = useState<number | null>(null);
  const cols = Math.max(2, ...paths.map((p) => p.nodes.length));
  const columns: PathNode[][] = Array.from({ length: cols }, () => []);
  const colOf = (p: IntroPath, i: number): number => (i === p.nodes.length - 1 ? cols - 1 : i);
  for (const p of paths) p.nodes.forEach((nd, i) => {
    const col = columns[colOf(p, i)];
    if (col !== undefined && !col.some((x) => x.id === nd.id)) col.push(nd);
  });
  const rows = Math.max(1, ...columns.map((c) => c.length));
  const h = height ?? Math.max(120, rows * 64 + 24);
  const padX = 56;
  const X = (c: number): number => padX + (c / Math.max(1, cols - 1)) * Math.max(10, width - padX * 2);
  const Ypos = (c: number, id: string): number => {
    const col = columns[c] ?? [];
    const k = col.findIndex((x) => x.id === id);
    return col.length === 1 ? h / 2 - 8 : 24 + (k / Math.max(1, col.length - 1)) * (h - 64);
  };
  const active = hover ?? selected ?? 0;
  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)} style={{ height: h }}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={`${paths.length} intro paths`} className="block overflow-visible">
          <defs>
            <SweepClip id={clip} width={width} height={h} drawn={drawn} />
          </defs>
          <g clipPath={`url(#${clip})`}>
            {paths.map((p, pi) =>
              p.nodes.slice(0, -1).map((nd, i) => {
                const next = p.nodes[i + 1];
                if (next === undefined) return null;
                const c1 = colOf(p, i);
                const c2 = colOf(p, i + 1);
                const x1 = X(c1);
                const y1 = Ypos(c1, nd.id);
                const x2 = X(c2);
                const y2 = Ypos(c2, next.id);
                const s = Math.max(0, Math.min(1, p.strengths[i] ?? 0));
                const on = pi === active;
                const mx = (x1 + x2) / 2;
                return (
                  <g key={`${pi}-${i}`} onPointerEnter={() => setHover(pi)} onPointerLeave={() => setHover(null)} onClick={onSelect !== undefined ? () => onSelect(pi) : undefined} className={onSelect !== undefined ? 'cursor-pointer' : undefined}>
                    <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" style={{ stroke: on ? 'var(--vo-ink)' : 'var(--vo-line-2)', opacity: on ? 0.45 + 0.55 * s : 0.5, transition: 'stroke 150ms ease, opacity 150ms ease' }} strokeWidth={1 + s * 3.5} strokeLinecap="round" />
                    <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="transparent" strokeWidth={14} />
                    <rect x={mx - 15} y={(y1 + y2) / 2 - 9} width={30} height={18} rx={4} style={{ fill: 'var(--vo-raised)', stroke: on ? 'var(--vo-ink-2)' : 'var(--vo-line)' }} />
                    <text x={mx} y={(y1 + y2) / 2} dy="0.34em" textAnchor="middle" className="vo-mono text-[12px]" style={{ fill: on ? 'var(--vo-ink)' : 'var(--vo-muted)' }}>
                      {Math.round(s * 100)}
                    </text>
                  </g>
                );
              }),
            )}
          </g>
          {columns.map((col, ci) =>
            col.map((nd) => {
              const x = X(ci);
              const y = Ypos(ci, nd.id);
              const target = nd.kind === 'target';
              return (
                <g key={`${ci}-${nd.id}`}>
                  {target ? <rect x={x - 15} y={y - 15} width={30} height={30} rx={7} style={{ fill: 'var(--vo-sunk)', stroke: 'var(--vo-ink-2)' }} /> : <circle cx={x} cy={y} r={15} style={{ fill: nd.kind === 'member' ? 'var(--vo-ink)' : 'var(--vo-raised)', stroke: nd.kind === 'member' ? 'var(--vo-ink)' : 'var(--vo-line-2)' }} />}
                  <text x={x} y={y} dy="0.35em" textAnchor="middle" className="vo-mono text-[12px] font-medium" style={{ fill: nd.kind === 'member' ? 'var(--vo-on-ink)' : 'var(--vo-ink-2)' }}>
                    {initials(nd.label)}
                  </text>
                  <text x={x} y={y + 30} textAnchor="middle" className="text-[12px]" style={{ fill: 'var(--vo-ink-2)' }}>
                    {nd.label.length > 18 ? nd.label.slice(0, 17) + '...' : nd.label}
                  </text>
                </g>
              );
            }),
          )}
        </svg>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- TileMap */

export type Relation = 'portfolio' | 'pipeline' | 'passed' | 'tracked' | 'competitor';

const REL: Record<Relation, { label: string; cls: string; dot: string }> = {
  portfolio: { label: 'Portfolio', cls: 'border-transparent bg-[var(--vo-a-soft)] text-[var(--vo-a)]', dot: 'var(--vo-a)' },
  pipeline: { label: 'Pipeline', cls: 'border-transparent bg-[var(--vo-b-soft)] text-[var(--vo-b)]', dot: 'var(--vo-b)' },
  passed: { label: 'Passed', cls: 'border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-muted)]', dot: 'var(--vo-line-2)' },
  tracked: { label: 'Tracked', cls: 'border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)]', dot: 'var(--vo-ink-2)' },
  competitor: { label: 'Competitor', cls: 'border-transparent bg-[var(--vo-warn-soft)] text-[var(--vo-warn)]', dot: 'var(--vo-warn)' },
};

export interface MapTile {
  id: string;
  label: string;
  relation: Relation;
  href?: string | undefined;
}

/** A market map: segments as columns of company tiles coloured by relation. */
export function TileMap({ segments, onTile, className, legend = true }: { segments: { key: string; label: string; tiles: MapTile[] }[]; onTile?: ((t: MapTile) => void) | undefined; className?: string | undefined; legend?: boolean | undefined }): React.JSX.Element {
  const used = new Set(segments.flatMap((s) => s.tiles.map((t) => t.relation)));
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--vo-muted)]">
          {(Object.keys(REL) as Relation[])
            .filter((r) => used.has(r))
            .map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: REL[r].dot }} />
                {REL[r].label}
              </span>
            ))}
        </div>
      )}
      <div className="vo-scroll grid min-w-0 auto-cols-[minmax(150px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
        {segments.map((s) => (
          <section key={s.key} aria-label={s.label} className="flex min-w-0 flex-col gap-1.5">
            <header className="flex h-7 items-center gap-2 border-b border-[var(--vo-hair)]">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--vo-ink-2)]">{s.label}</span>
              <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{s.tiles.length}</span>
            </header>
            {s.tiles.map((t) => {
              const cls = cn('vo-focus vo-tap vo-wrap flex min-h-8 items-center gap-2 rounded-[var(--vo-radius-sm)] border px-2 py-1 text-left text-[12px] font-medium transition-[filter] duration-150', REL[t.relation].cls, (onTile !== undefined || t.href !== undefined) && 'cursor-pointer hover:brightness-95 dark:hover:brightness-125');
              const body = <span className="min-w-0 flex-1">{t.label}</span>;
              if (t.href !== undefined)
                return (
                  <a key={t.id} href={t.href} title={REL[t.relation].label} className={cls}>
                    {body}
                  </a>
                );
              return (
                <button key={t.id} type="button" title={REL[t.relation].label} onClick={() => onTile?.(t)} disabled={onTile === undefined} className={cls}>
                  {body}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

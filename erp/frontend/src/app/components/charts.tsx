/**
 * Charts drawn to the space they get, in theme colors only:
 *  - Bars: one value per period (sales per day, profit per month), negative
 *    values below the line, hover shows the period, click opens it.
 *  - PairBars: two values per period side by side (money in and out,
 *    revenue and expenses).
 *  - AreaLine: a balance over time (cash), with an optional dashed forecast.
 *  - Sparkline: a tiny line for list rows.
 *  - RankBars: ranked rows with a bar under each.
 *  - SplitBar: one bar split into parts with a legend.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { compact } from '../lib/format.ts';

/** Width of a measured box. */
export function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (el.clientWidth > 0) setW(Math.max(120, Math.floor(el.clientWidth)));
    const ro = new ResizeObserver((entries) => setW(Math.max(120, Math.floor(entries[0]?.contentRect.width ?? fallback))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

export function niceTop(peak: number): number {
  if (peak <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(peak)));
  const f = peak / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

function Tip({ children, left }: { children: ReactNode; left: string | number }): React.JSX.Element {
  return (
    <div
      className="erp-on-ink pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[var(--erp-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--erp-shell)]"
      style={{ left }}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- bars */

export interface BarPoint {
  key: string;
  label: string;
  /** Short label under the axis (every few bars). */
  axis: string;
  value: number;
  /** Shown in the tooltip. */
  text: string;
  /** Drawn in the soft track color (a future day, an open month). */
  muted?: boolean | undefined;
  /** Drawn in the accent (today, this month). */
  current?: boolean | undefined;
}

/**
 * One bar per period. Positive bars rise from the zero line in ink (the
 * current one in the accent); negative bars hang below it in red.
 */
export function Bars({ points, height = 180, onPick, format = compact }: { points: BarPoint[]; height?: number | undefined; onPick?: ((key: string) => void) | undefined; format?: ((n: number) => string) | undefined }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const top = niceTop(max);
  const bottom = min < 0 ? -niceTop(-min) : 0;
  const span = top - bottom || 1;
  const zero = (top / span) * height;
  const h = hover !== null ? points[hover] : undefined;
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="relative select-none">
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {/* A top or bottom label only where it has room apart from the zero line (a tiny dip below zero would print over "0"). */}
        {[zero >= 18 ? top : null, bottom !== 0 && height - zero >= 18 ? bottom : null].map((v, i) =>
          v === null ? null : (
            <div key={i} className="absolute inset-x-0 flex items-center gap-3" style={{ top: i === 0 ? 0 : height - 1 }}>
              <div className="h-0 flex-1 border-t border-dashed border-[var(--erp-line)]" />
              <span className="num w-12 text-right text-[12px] text-[var(--erp-muted)]">{format(v)}</span>
            </div>
          ),
        )}
        <div className="absolute inset-x-0 flex items-center gap-3" style={{ top: zero }}>
          <div className="h-0 flex-1 border-t border-[var(--erp-line)]" />
          <span className="num w-12 text-right text-[12px] text-[var(--erp-muted)]">0</span>
        </div>
        <div className="absolute inset-y-0 left-0 right-[60px] flex items-stretch justify-between gap-[2px] @min-[480px]:gap-1">
          {points.map((p, i) => {
            const hgt = (Math.abs(p.value) / span) * height;
            const neg = p.value < 0;
            return (
              <button
                key={p.key}
                type="button"
                disabled={onPick === undefined}
                onClick={() => onPick?.(p.key)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={`${p.label}: ${p.text}`}
                className={cn('relative flex-1 rounded-[6px] disabled:cursor-default', hover === i && 'bg-[var(--erp-row)]')}
              >
                {p.value !== 0 && (
                  <span className="absolute inset-x-0 mx-auto flex justify-center" style={neg ? { top: zero, height: Math.max(2, hgt) } : { bottom: height - zero, height: Math.max(2, hgt) }}>
                    <span
                      className={cn(
                        'erp-grow block h-full w-full max-w-[22px]',
                        neg ? 'rounded-b-[5px] bg-[var(--erp-red)]' : 'rounded-t-[5px]',
                        !neg && (p.muted === true ? 'bg-[var(--erp-line)]' : p.current === true ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-ink)]'),
                      )}
                      style={{ animationDelay: `${Math.min(i * 12, 360)}ms`, transformOrigin: neg ? 'top' : 'bottom' }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {h !== undefined && hover !== null && (
          <Tip left={`clamp(70px, calc((100% - 60px) * ${(hover + 0.5) / points.length}), calc(100% - 70px))`}>
            {h.label}: <span className="num">{h.text}</span>
          </Tip>
        )}
      </div>
      <div className="mt-2 flex justify-between gap-[2px] pr-[60px] text-[12px] text-[var(--erp-muted)] @min-[480px]:gap-1">
        {points.map((p, i) => (
          <span key={p.key} className="w-0 flex-1 whitespace-nowrap text-center">
            {i % every === 0 || i === points.length - 1 ? p.axis : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pair bars */

export interface PairPoint {
  key: string;
  label: string;
  axis: string;
  a: number;
  b: number;
  aText: string;
  bText: string;
}

/** Two bars per period: `a` in the accent, `b` in ink. */
export function PairBars({ points, height = 180, aName, bName, onPick, format = compact }: { points: PairPoint[]; height?: number | undefined; aName: string; bName: string; onPick?: ((key: string) => void) | undefined; format?: ((n: number) => string) | undefined }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceTop(Math.max(1, ...points.map((p) => Math.max(p.a, p.b))));
  const h = hover !== null ? points[hover] : undefined;
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="relative select-none">
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 top-0 flex items-center gap-3">
          <div className="h-0 flex-1 border-t border-dashed border-[var(--erp-line)]" />
          <span className="num w-12 text-right text-[12px] text-[var(--erp-muted)]">{format(top)}</span>
        </div>
        <div className="absolute inset-x-0 flex items-center gap-3" style={{ top: height - 1 }}>
          <div className="h-0 flex-1 border-t border-[var(--erp-line)]" />
          <span className="num w-12 text-right text-[12px] text-[var(--erp-muted)]">0</span>
        </div>
        <div className="absolute inset-y-0 left-0 right-[60px] flex items-stretch justify-between gap-1 @min-[480px]:gap-2">
          {points.map((p, i) => (
            <button
              key={p.key}
              type="button"
              disabled={onPick === undefined}
              onClick={() => onPick?.(p.key)}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${p.label}: ${aName} ${p.aText}, ${bName} ${p.bText}`}
              className={cn('relative flex flex-1 items-end justify-center gap-[3px] rounded-[6px] disabled:cursor-default', hover === i && 'bg-[var(--erp-row)]')}
            >
              <span className="erp-grow block w-full max-w-[14px] rounded-t-[5px] bg-[var(--erp-accent)]" style={{ height: Math.max(p.a > 0 ? 2 : 0, (p.a / top) * height), animationDelay: `${Math.min(i * 14, 360)}ms` }} />
              <span className="erp-grow block w-full max-w-[14px] rounded-t-[5px] bg-[var(--erp-ink)]" style={{ height: Math.max(p.b > 0 ? 2 : 0, (p.b / top) * height), animationDelay: `${Math.min(i * 14 + 40, 400)}ms` }} />
            </button>
          ))}
        </div>
        {h !== undefined && hover !== null && (
          <Tip left={`clamp(90px, calc((100% - 60px) * ${(hover + 0.5) / points.length}), calc(100% - 90px))`}>
            {h.label}: {aName} <span className="num">{h.aText}</span>, {bName} <span className="num">{h.bText}</span>
          </Tip>
        )}
      </div>
      <div className="mt-2 flex justify-between gap-1 pr-[60px] text-[12px] text-[var(--erp-muted)] @min-[480px]:gap-2">
        {points.map((p, i) => (
          <span key={p.key} className="w-0 flex-1 whitespace-nowrap text-center">
            {i % every === 0 || i === points.length - 1 ? p.axis : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The two-dot legend for PairBars. */
export function PairLegend({ a, b }: { a: string; b: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-[12px] font-semibold text-[var(--erp-ink-2)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[var(--erp-accent)]" /> {a}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[var(--erp-ink)]" /> {b}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ area line */

export interface LinePoint {
  key: string;
  label: string;
  value: number;
  text: string;
  /** Part of a forecast (drawn dashed). */
  forecast?: boolean | undefined;
}

/** A balance over time: a soft area with a line on top. */
export function AreaLine({ points, height = 170, dark = false, format = compact }: { points: LinePoint[]; height?: number | undefined; dark?: boolean | undefined; format?: ((n: number) => string) | undefined }): React.JSX.Element {
  const [box, width] = useWidth<HTMLDivElement>(520);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const padR = 56;
  const w = Math.max(160, width - padR);
  const values = points.map((p) => p.value);
  const hi = niceTop(Math.max(1, ...values));
  const lo = Math.min(0, ...values) < 0 ? -niceTop(-Math.min(...values)) : 0;
  const span = hi - lo || 1;
  const x = (i: number): number => (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number): number => 6 + (1 - (v - lo) / span) * (height - 12);
  const actual = points.filter((p) => p.forecast !== true);
  const lineOf = (pts: LinePoint[], offset: number): string => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const line = lineOf(actual, 0);
  const firstForecast = points.findIndex((p) => p.forecast === true);
  const fc = firstForecast > 0 ? lineOf(points.slice(firstForecast - 1), firstForecast - 1) : '';
  const area = actual.length > 0 ? `${line} L${x(actual.length - 1)} ${y(lo)} L${x(0)} ${y(lo)} Z` : '';
  const ink = dark ? 'var(--erp-on-dark)' : 'var(--erp-ink)';
  const grid = dark ? 'var(--erp-dark-2)' : 'var(--erp-line)';
  const muted = dark ? 'var(--erp-on-dark-muted)' : 'var(--erp-muted)';
  const h = hover !== null ? points[hover] : undefined;
  return (
    <div ref={box} className="relative w-full select-none [contain:inline-size]">
      <svg
        width={w + padR}
        height={height}
        className="block overflow-visible"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / w) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={points.length > 0 ? `From ${points[0]?.text ?? ''} to ${points[points.length - 1]?.text ?? ''}` : 'No data'}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--erp-accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--erp-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[hi, (hi + lo) / 2, lo].map((v) => (
          <g key={v}>
            <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke={grid} strokeDasharray="3 4" />
            <text x={w + 8} y={y(v)} dominantBaseline="central" fontSize={12} fill={muted} className="num">
              {format(v)}
            </text>
          </g>
        ))}
        {area !== '' && <path d={area} fill={`url(#${gid})`} />}
        {line !== '' && <path d={line} fill="none" stroke={ink} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
        {fc !== '' && <path d={fc} fill="none" stroke={ink} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />}
        {h !== undefined && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke={muted} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.value)} r={5} fill={dark ? 'var(--erp-dark)' : 'var(--erp-card)'} stroke={ink} strokeWidth={2.5} />
          </g>
        )}
      </svg>
      {h !== undefined && hover !== null && (
        <Tip left={Math.max(80, Math.min(w - 40, x(hover)))}>
          {h.label}: <span className="num">{h.text}</span>
          {h.forecast === true ? ' (expected)' : ''}
        </Tip>
      )}
    </div>
  );
}

/** A tiny trend line for rows and tiles. */
export function Sparkline({ values, width = 80, height = 24, dark = false }: { values: number[]; width?: number | undefined; height?: number | undefined; dark?: boolean | undefined }): React.JSX.Element {
  if (values.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)} ${(2 + (1 - (v - lo) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke={dark ? 'var(--erp-on-dark)' : 'var(--erp-ink)'} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- ranked */

export interface RankRow {
  key: string;
  label: ReactNode;
  value: number;
  valueText: string;
  lead?: ReactNode | undefined;
  sub?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
}

/** Ranked rows with a bar under each, longest first. */
export function RankBars({ rows, dark = false }: { rows: RankRow[]; dark?: boolean | undefined }): React.JSX.Element {
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.key}>
          <button type="button" disabled={r.onClick === undefined} onClick={r.onClick} className="flex w-full items-center gap-3 text-left disabled:cursor-default">
            {r.lead}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">{r.label}</span>
                <span className="num shrink-0 text-[13px] font-bold">{r.valueText}</span>
              </span>
              {r.sub !== undefined && <span className={cn('block truncate text-[12px]', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{r.sub}</span>}
              <span className={cn('mt-1.5 block h-2 rounded-full', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-line)]')}>
                <span
                  className={cn('erp-grow-x block h-2 rounded-full', r.value < 0 ? 'bg-[var(--erp-red)]' : i === 0 ? 'bg-[var(--erp-accent)]' : dark ? 'bg-[var(--erp-on-dark)]' : 'bg-[var(--erp-ink)]')}
                  style={{ width: `${Math.max(4, (Math.abs(r.value) / peak) * 100)}%` }}
                />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- split */

export interface Part {
  key: string;
  label: string;
  value: number;
  valueText: string;
  fill: string;
  onClick?: (() => void) | undefined;
}

/** One bar split into parts, with a legend under it (or none). */
export function SplitBar({ parts, height = 14, legend = true, dark = false }: { parts: Part[]; height?: number | undefined; legend?: boolean | undefined; dark?: boolean | undefined }): React.JSX.Element {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div>
      <div className="flex w-full gap-1 overflow-hidden" style={{ height }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={p.onClick === undefined}
              onClick={p.onClick}
              title={`${p.label}: ${p.valueText}`}
              aria-label={`${p.label}: ${p.valueText}`}
              className="h-full rounded-full transition-transform hover:scale-y-110 disabled:cursor-default"
              style={{ width: `${total > 0 ? (p.value / total) * 100 : 0}%`, minWidth: 6, background: p.fill }}
            />
          ))}
        {total === 0 && <span className={cn('h-full w-full rounded-full', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-row)]')} />}
      </div>
      {legend && (
        <ul className="mt-4 flex flex-col gap-2">
          {parts.map((p) => (
            <li key={p.key}>
              <button type="button" disabled={p.onClick === undefined} onClick={p.onClick} className="flex w-full items-center gap-3 text-left disabled:cursor-default">
                <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: p.fill }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.label}</span>
                <span className="num text-[13px] font-bold">{p.valueText}</span>
                <span className={cn('num w-10 text-right text-[12px]', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{total > 0 ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

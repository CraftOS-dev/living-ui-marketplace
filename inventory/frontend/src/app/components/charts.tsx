/**
 * Charts: stock in and out per day (bars above and below a center line), an
 * item's stock level over time (an area with its reorder point), ranked
 * horizontal bars, and one bar split into parts.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { dayLabel, shortDay } from '../lib/dates.ts';
import { compact, qty } from '../lib/format.ts';

/** Width of a measured box (charts draw to the space they get). */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(120, Math.floor(entries[0]?.contentRect.width ?? fallback))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

function niceTop(peak: number): number {
  if (peak <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(peak)));
  const f = peak / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

/* -------------------------------------------------------------- flows */

export interface Flow {
  day: string;
  in: number;
  out: number;
}

/**
 * In above the line (accent), out below it (ink), one pair per day. Hover
 * shows the day; clicking a day opens it.
 */
export function FlowBars({ days, height = 200, onPick }: { days: Flow[]; height?: number; onPick?: (day: string) => void }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...days.map((d) => Math.max(d.in, d.out)));
  const top = niceTop(peak);
  const half = (height - 8) / 2;
  const h = hover !== null ? days[hover] : undefined;
  const todayIndex = days.length - 1;
  return (
    <div className="relative select-none">
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 flex items-center gap-3" style={{ top: 0 }}>
          <div className="h-0 flex-1 border-t border-dashed border-[var(--iv-line)]" />
          <span className="num w-10 text-right text-[12px] text-[var(--iv-muted)]">+{compact(top)}</span>
        </div>
        <div className="absolute inset-x-0 flex items-center gap-3" style={{ top: half + 4 }}>
          <div className="h-0 flex-1 border-t border-[var(--iv-line)]" />
          <span className="num w-10 text-right text-[12px] text-[var(--iv-muted)]">0</span>
        </div>
        <div className="absolute inset-x-0 flex items-center gap-3" style={{ top: height - 1 }}>
          <div className="h-0 flex-1 border-t border-dashed border-[var(--iv-line)]" />
          <span className="num w-10 text-right text-[12px] text-[var(--iv-muted)]">−{compact(top)}</span>
        </div>
        <div className="absolute inset-y-0 left-0 right-[52px] flex items-stretch justify-between gap-[2px] sm:gap-1">
          {days.map((d, i) => {
            const inH = (d.in / top) * half;
            const outH = (d.out / top) * half;
            return (
              <button
                key={d.day}
                type="button"
                disabled={onPick === undefined || (d.in === 0 && d.out === 0)}
                onClick={() => onPick?.(d.day)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={`${dayLabel(d.day)}: ${qty(d.in)} in, ${qty(d.out)} out`}
                className={cn('group relative flex-1 disabled:cursor-default', hover === i && 'bg-[var(--iv-row)]/60', 'rounded-[6px]')}
              >
                <span className="absolute inset-x-0 mx-auto flex justify-center" style={{ bottom: half + 4, height: Math.max(d.in > 0 ? 2 : 0, inH) }}>
                  {d.in > 0 && (
                    <span
                      className="iv-grow block w-full max-w-[14px] rounded-t-[5px] bg-[var(--iv-accent)]"
                      style={{ height: '100%', animationDelay: `${Math.min(i * 14, 420)}ms` }}
                    />
                  )}
                </span>
                <span className="absolute inset-x-0 mx-auto flex justify-center" style={{ top: half + 4, height: Math.max(d.out > 0 ? 2 : 0, outH) }}>
                  {d.out > 0 && (
                    <span
                      className={cn('block w-full max-w-[14px] rounded-b-[5px]', i === todayIndex ? 'bg-[var(--iv-ink-2)]' : 'bg-[var(--iv-ink)]')}
                      style={{ height: '100%' }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {h !== undefined && hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[var(--iv-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--iv-shell)]"
            style={{ left: `clamp(70px, calc((100% - 52px) * ${(hover + 0.5) / days.length}), calc(100% - 70px))` }}
          >
            {dayLabel(h.day)}: <span className="num">+{qty(h.in)}</span> in, <span className="num">−{qty(h.out)}</span> out
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between pr-[52px] text-[12px] text-[var(--iv-muted)]">
        <span>{days[0] !== undefined ? shortDay(days[0].day) : ''}</span>
        <span>{days.length > 14 && days[Math.floor(days.length / 2)] !== undefined ? shortDay(days[Math.floor(days.length / 2)]?.day ?? '') : ''}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- level */

/**
 * Stock on hand over time as a soft area with a line on top, the reorder
 * point as a dashed line. Hover shows the day and the level.
 */
export function LevelChart({
  series,
  min,
  unit,
  height = 180,
}: {
  series: { day: string; qty: number }[];
  min: number;
  unit: string;
  height?: number;
}): React.JSX.Element {
  const [box, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const padR = 48;
  const w = Math.max(160, width - padR);
  const peak = Math.max(1, min * 1.4, ...series.map((s) => s.qty));
  const top = niceTop(peak);
  const lowest = Math.min(0, ...series.map((s) => s.qty));
  const span = top - lowest || 1;
  const x = (i: number): number => (series.length <= 1 ? w / 2 : (i / (series.length - 1)) * w);
  const y = (v: number): number => 6 + (1 - (v - lowest) / span) * (height - 12);
  // A step line: stock holds its level until the next change.
  let line = '';
  series.forEach((s, i) => {
    const px = x(i);
    const py = y(s.qty);
    if (i === 0) line = `M${px} ${py}`;
    else line += ` H${px} V${py}`;
  });
  const area = `${line} V${y(lowest)} H${x(0)} Z`;
  const h = hover !== null ? series[hover] : undefined;
  const gid = useRef(`lv${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div ref={box} className="relative w-full select-none">
      <svg
        width={w + padR}
        height={height}
        className="block overflow-visible"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          const i = Math.round((px / w) * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Stock level over the last ${series.length} days`}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--iv-accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--iv-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[top, (top + lowest) / 2, lowest].map((v) => (
          <g key={v}>
            <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--iv-line)" strokeDasharray="3 4" />
            <text x={w + 8} y={y(v)} dominantBaseline="central" fontSize={12} fill="var(--iv-muted)" className="num">
              {compact(Math.round(v * 10) / 10)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--iv-ink)" strokeWidth={2.2} strokeLinejoin="round" />
        {min > 0 && (
          <g>
            <line x1={0} x2={w} y1={y(min)} y2={y(min)} stroke="var(--iv-red)" strokeWidth={1.6} strokeDasharray="6 5" />
            <text x={4} y={y(min) - 8} fontSize={12} fontWeight={700} fill="var(--iv-red-text)">
              Reorder at {qty(min)}
            </text>
          </g>
        )}
        {h !== undefined && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--iv-ink-2)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.qty)} r={5} fill="var(--iv-card)" stroke="var(--iv-ink)" strokeWidth={2.5} />
          </g>
        )}
      </svg>
      {h !== undefined && hover !== null && (
        <div
          className="pointer-events-none absolute -top-3 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[var(--iv-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--iv-shell)]"
          style={{ left: Math.max(70, Math.min(w - 40, x(hover))) }}
        >
          {dayLabel(h.day)}: <span className="num">{qty(h.qty)}</span> {unit}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- ranked */

export interface RankRow {
  key: string;
  label: ReactNode;
  value: number;
  valueText: string;
  lead?: ReactNode;
  onClick?: () => void;
}

/** Ranked rows with a bar under each, longest first. */
export function RankBars({ rows, dark = false }: { rows: RankRow[]; dark?: boolean }): React.JSX.Element {
  const peak = Math.max(1, ...rows.map((r) => r.value));
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
              <span className={cn('mt-1.5 block h-2 rounded-full', dark ? 'bg-[var(--iv-dark-2)]' : 'bg-[var(--iv-line)]')}>
                <span
                  className={cn('block h-2 rounded-full transition-[width] duration-700', i === 0 ? 'bg-[var(--iv-accent)]' : dark ? 'bg-[var(--iv-on-dark)]' : 'bg-[var(--iv-ink)]')}
                  style={{ width: `${Math.max(4, (r.value / peak) * 100)}%` }}
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
  onClick?: () => void;
}

/** One bar split into parts, with a legend under it. */
export function SplitBar({ parts, height = 14 }: { parts: Part[]; height?: number }): React.JSX.Element {
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
              className="h-full rounded-full transition-opacity hover:opacity-80 disabled:cursor-default"
              style={{ width: `${total > 0 ? (p.value / total) * 100 : 0}%`, minWidth: 6, background: p.fill }}
            />
          ))}
        {total === 0 && <span className="h-full w-full rounded-full bg-[var(--iv-row)]" />}
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {parts.map((p) => (
          <li key={p.key}>
            <button type="button" disabled={p.onClick === undefined} onClick={p.onClick} className="flex w-full items-center gap-3 text-left disabled:cursor-default">
              <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: p.fill }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.label}</span>
              <span className="num text-[13px] font-bold">{p.valueText}</span>
              <span className="num w-10 text-right text-[12px] text-[var(--iv-muted)]">{total > 0 ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

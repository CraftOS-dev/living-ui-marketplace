/**
 * Quiet charts drawn from data (home-reports): month bars with an optional
 * line, multi-series lines, horizontal bars, a funnel, grade range strips and
 * a sparkline. Hairline grids, mono tick labels, colour only for meaning
 * (blue the primary series, teal the secondary, ink the line). No entrance
 * animations: a hover lifts one column and shows its figures.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import { monthName } from '../../lib/format.ts';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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

/** "2026-03" as "Mar" (and "Mar 2026" in January or when asked), through the app's date format. */
export function monthLabel(key: string, withYear = false): string {
  const m = monthName(Number(key.slice(5, 7)), 'short');
  return withYear || key.slice(5, 7) === '01' ? `${m} ${key.slice(0, 4)}` : m;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return step * p;
}

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(140);
  useEffect(() => {
    if (ref.current !== null) setW(ref.current.offsetWidth);
  });
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div ref={ref} className="hr-mono pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-2 py-1 text-[12px] leading-[16px] text-[var(--hr-ink)] shadow-[var(--hr-shadow)]" style={{ left, top: Math.max(0, y - 8), transform: 'translateY(-100%)' }}>
      {children}
    </div>
  );
}

export interface BarSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * Bars per month (stacked when several series), an optional line on its own
 * right axis (headcount over cost). `format` prints a bar value, `lineFormat`
 * a line value.
 */
export function MonthChart({ months, bars, line, format, lineFormat, height = 180, label, empty }: { months: string[]; bars: BarSeries[]; line?: { label: string; values: (number | null)[]; dots?: boolean | undefined } | undefined; format: (v: number) => string; lineFormat?: ((v: number) => string) | undefined; height?: number | undefined; label: string; empty?: ReactNode }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 44;
  const padR = line !== undefined ? 34 : 8;
  const padB = 20;
  const top = 10;
  const ih = height - padB - top;
  const totals = months.map((_, i) => bars.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals) * 1.15);
  const lmaxRaw = line !== undefined ? Math.max(0, ...line.values.map((v) => v ?? 0)) : 0;
  const lmax = niceMax(lmaxRaw * 1.15);
  const n = months.length;
  const cw = n > 0 ? (w - padL - padR) / n : 0;
  const bx = (i: number): number => padL + i * cw;
  const y = (v: number): number => top + ih - (v / max) * ih;
  const yl = (v: number): number => top + ih - (v / lmax) * ih;
  const ticks = [0, max / 2, max].filter((v, i, a) => a.findIndex((x) => format(x) === format(v)) === i);
  const every = Math.max(1, Math.ceil((n * 40) / Math.max(1, w - padL - padR)));
  const none = totals.every((t) => t === 0) && (line === undefined || line.values.every((v) => (v ?? 0) === 0));
  const pts = line !== undefined ? line.values.map((v, i) => (v === null ? null : ([bx(i) + cw / 2, yl(v)] as const))).filter((p): p is readonly [number, number] => p !== null) : [];
  return (
    <div ref={ref} role="img" aria-label={label} className="relative w-full min-w-0" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--hr-hair)" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="hr-mono" fontSize={10.5} fill="var(--hr-muted)">
                {format(t)}
              </text>
            </g>
          ))}
          {line !== undefined && lineFormat !== undefined && (
            <>
              <text x={w - padR + 6} y={yl(lmax) + 3} className="hr-mono" fontSize={10.5} fill="var(--hr-ink-2)">
                {lineFormat(lmax)}
              </text>
              <text x={w - padR + 6} y={yl(0) + 3} className="hr-mono" fontSize={10.5} fill="var(--hr-ink-2)">
                {lineFormat(0)}
              </text>
            </>
          )}
          {months.map((m, i) => {
            let acc = 0;
            return (
              <g key={m} onMouseEnter={() => setHover(i)}>
                <rect x={bx(i)} y={top} width={cw} height={ih} fill="transparent" />
                {bars.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (v <= 0) return null;
                  const y0 = y(acc + v);
                  const h = y(acc) - y0;
                  acc += v;
                  return <rect key={s.key} x={bx(i) + cw * 0.22} y={y0} width={Math.max(2, cw * 0.56)} height={Math.max(1.5, h)} rx={1.5} fill={s.color} opacity={hover === null || hover === i ? 0.92 : 0.5} className="transition-opacity duration-150" />;
                })}
                {totals[i] === 0 && <rect x={bx(i) + cw * 0.22} y={top + ih - 1.5} width={Math.max(2, cw * 0.56)} height={1.5} fill="var(--hr-line)" />}
              </g>
            );
          })}
          {pts.length > 1 && line?.dots !== true && <polyline points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill="none" stroke="var(--hr-ink)" strokeWidth={1.4} strokeLinejoin="round" />}
          {pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={2.2} fill="var(--hr-panel)" stroke="var(--hr-ink)" strokeWidth={1.3} />
          ))}
          {months.map((m, i) =>
            (n - 1 - i) % every === 0 ? (
              <text key={m} x={bx(i) + cw / 2} y={height - 5} textAnchor="middle" className="hr-mono" fontSize={10.5} fill="var(--hr-muted)">
                {monthLabel(m)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={bx(hover) + cw / 2} x2={bx(hover) + cw / 2} y1={top} y2={top + ih} stroke="var(--hr-ink)" opacity={0.18} />}
        </svg>
      )}
      {none && empty !== undefined && <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-5 text-[12px] text-[var(--hr-muted)]">{empty}</div>}
      {hover !== null && w > 0 && months[hover] !== undefined && (
        <Tip x={bx(hover) + cw / 2} y={Math.min(y(totals[hover] ?? 0), line !== undefined ? yl(line.values[hover] ?? 0) : top + ih)} width={w}>
          <div className="text-[var(--hr-muted)]">{monthLabel(months[hover] ?? '', true)}</div>
          {bars.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: s.color }} />
              {s.label} {format(s.values[hover] ?? 0)}
            </div>
          ))}
          {line !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--hr-ink)]" />
              {line.label} {(lineFormat ?? String)(line.values[hover] ?? 0)}
            </div>
          )}
        </Tip>
      )}
    </div>
  );
}

/** One quiet line per series over months (headcount by group); the first series in blue, the second teal, the rest grey. */
export function Lines({ months, series, height = 180, label, format = (v: number) => String(Math.round(v)) }: { months: string[]; series: { key: string; label: string; values: number[] }[]; height?: number | undefined; label: string; format?: ((v: number) => string) | undefined }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 30;
  const padR = 8;
  const padB = 20;
  const top = 10;
  const ih = height - padB - top;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)) * 1.15);
  const n = months.length;
  const step = n > 1 ? (w - padL - padR) / (n - 1) : 0;
  const x = (i: number): number => padL + i * step;
  const y = (v: number): number => top + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil((n * 40) / Math.max(1, w - padL - padR)));
  return (
    <div ref={ref} role="img" aria-label={label} className="relative w-full min-w-0" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible">
          {[0, max / 2, max].filter((v, i, a) => a.findIndex((x) => format(x) === format(v)) === i).map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--hr-hair)" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="hr-mono" fontSize={10.5} fill="var(--hr-muted)">
                {format(t)}
              </text>
            </g>
          ))}
          {series.map((s, si) => (
            <polyline key={s.key} points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={seriesColor(si)} strokeWidth={si < 2 ? 1.6 : 1.2} strokeLinejoin="round" opacity={si < 2 ? 1 : 0.8} />
          ))}
          {months.map((m, i) => (
            <rect key={m} x={x(i) - step / 2} y={top} width={Math.max(step, 1)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {months.map((m, i) =>
            (n - 1 - i) % every === 0 ? (
              <text key={m} x={x(i)} y={height - 5} textAnchor="middle" className="hr-mono" fontSize={10.5} fill="var(--hr-muted)">
                {monthLabel(m)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + ih} stroke="var(--hr-ink)" opacity={0.18} />}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tip x={x(hover)} y={top + 14} width={w}>
          <div className="text-[var(--hr-muted)]">{monthLabel(months[hover] ?? '', true)}</div>
          {series.slice(0, 8).map((s, si) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: seriesColor(si) }} />
              {s.label} {format(s.values[hover] ?? 0)}
            </div>
          ))}
        </Tip>
      )}
    </div>
  );
}

export function seriesColor(i: number): string {
  return i === 0 ? 'var(--hr-rh)' : i === 1 ? 'var(--hr-lh)' : i === 2 ? 'var(--hr-ink-2)' : 'var(--hr-line-2)';
}

export function Legend({ items, className }: { items: { label: string; color: string; line?: boolean | undefined; dot?: boolean | undefined }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <span className={cn('hr-label flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.dot === true ? <span className="size-2 rounded-full border-[1.5px]" style={{ borderColor: it.color }} /> : it.line === true ? <span className="h-[1.5px] w-3" style={{ background: it.color }} /> : <span className="h-2.5 w-1.5 rounded-[1px]" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </span>
  );
}

/** Horizontal bars: one labelled row per value (bands, departments). */
export function HBars({ rows, format = (v: number) => String(v), color = 'var(--hr-rh)', label, max }: { rows: { key: string; label: string; value: number | null; sub?: string | undefined; tone?: string | undefined }[]; format?: ((v: number) => string) | undefined; color?: string | undefined; label: string; max?: number | undefined }): React.JSX.Element {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  const subs = rows.some((r) => r.value !== null && r.sub !== undefined);
  // One grid for every row (subgrid): the tracks share one length, the figures one right edge, and the words after
  // a figure ("3 people") get their own column in the text face, so the figures above and below still line up.
  return (
    <ul role="img" aria-label={label} className={cn('grid min-w-0 items-center gap-x-2.5 gap-y-1.5', subs ? 'grid-cols-[minmax(84px,34%)_minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(84px,34%)_minmax(0,1fr)_auto]')}>
      {rows.map((r) => (
        <li key={r.key} className={cn('grid min-w-0 grid-cols-subgrid items-center', subs ? 'col-span-4' : 'col-span-3')}>
          <span className="hr-wrap min-w-0 truncate text-[12px] text-[var(--hr-ink-2)]" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 min-w-0 rounded-[2px] bg-[var(--hr-sunk)]">
            {r.value !== null && r.value > 0 && <span className="block h-full rounded-[2px]" style={{ width: `${Math.max(1.5, Math.min(100, (r.value / top) * 100))}%`, background: r.tone ?? color }} />}
          </span>
          {r.value === null ? (
            <span className={cn('whitespace-nowrap text-right text-[12px] text-[var(--hr-muted)]', subs && 'col-span-2')}>{r.sub ?? ''}</span>
          ) : (
            <>
              <span className="hr-mono hr-num min-w-[2.5rem] whitespace-nowrap text-right text-[12px]">{format(r.value)}</span>
              {subs && <span className="hr-num whitespace-nowrap text-[12px] text-[var(--hr-muted)]">{r.sub ?? ''}</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A funnel: each step as a bar of the first step's width, with the conversion from the step before. */
export function Funnel({ steps, label }: { steps: { key: string; label: string; count: number; conversion: number }[]; label: string }): React.JSX.Element {
  const first = Math.max(1, steps[0]?.count ?? 1);
  return (
    <ol role="img" aria-label={label} className="flex min-w-0 flex-col gap-2">
      {steps.map((s, i) => (
        <li key={s.key} className="grid min-w-0 grid-cols-[minmax(72px,22%)_1fr_auto] items-center gap-2.5">
          <span className="truncate text-[12px] text-[var(--hr-ink-2)]">{s.label}</span>
          <span className="flex h-5 min-w-0 items-center rounded-[3px] bg-[var(--hr-sunk)]">
            <span className="block h-full rounded-[3px] bg-[var(--hr-rh)]" style={{ width: `${s.count === 0 ? 0 : Math.max(1.5, (s.count / first) * 100)}%`, opacity: 1 - i * 0.12 }} />
          </span>
          <span className="hr-mono hr-num w-[5.5rem] text-right text-[12px]">
            {s.count}
            {i > 0 && <span className="ml-1.5 text-[12px] text-[var(--hr-muted)]">{s.conversion}%</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A grade range as a track (minimum to maximum, midpoint tick) with a dot per person; dots outside the range sit past the ends in red. */
export function RangeStrip({ min, max, points, label }: { min: number; max: number; points: { key: string; value: number; title: string }[]; label: string }): React.JSX.Element {
  const lo = Math.min(min, ...points.map((p) => p.value));
  const hi = Math.max(max, ...points.map((p) => p.value));
  const pad = (hi - lo) * 0.08 || 1;
  const a = lo - pad;
  const b = hi + pad;
  const pos = (v: number): string => `${((v - a) / (b - a)) * 100}%`;
  return (
    <div role="img" aria-label={label} className="relative h-6 w-full min-w-0">
      <span className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-[var(--hr-hair)]" />
      <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px] bg-[var(--hr-rh-soft)]" style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})` }} />
      <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--hr-rh)]" style={{ left: pos((min + max) / 2) }} />
      {points.map((p) => (
        <span key={p.key} title={p.title} className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--hr-panel)]" style={{ left: pos(p.value), background: p.value < min || p.value > max ? 'var(--hr-bad)' : 'var(--hr-ink)' }} />
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 24, color = 'var(--hr-ink-2)', className }: { values: number[]; width?: number | undefined; height?: number | undefined; color?: string | undefined; className?: string | undefined }): React.JSX.Element {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number): number => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number): number => height - 3 - ((v - lo) / (hi - lo)) * (height - 6);
  return (
    <svg width={width} height={height} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <polyline points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1] ?? 0)} r={2.2} fill={color} />
    </svg>
  );
}

/** Two-part bar (share of a whole), e.g. voluntary against involuntary. */
export function SplitBar({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }): React.JSX.Element {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div role="img" aria-label={label} className="flex h-2.5 w-full min-w-0 overflow-hidden rounded-[2px] bg-[var(--hr-sunk)]">
      {total > 0 && parts.map((p) => (p.value > 0 ? <span key={p.key} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))}
    </div>
  );
}

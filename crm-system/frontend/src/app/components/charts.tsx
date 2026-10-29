/**
 * Charts drawn as SVG that fit their panel: an area line with a crosshair,
 * grouped bars with an optional line, a donut, a stacked bar, a one-line
 * meter, aligned horizontal bars, a waterfall and sparklines. Every chart
 * shows the exact figure on hover and grows in once when it mounts (the
 * cr-grow / cr-draw / cr-sweep classes in theme.css). Colors come from the
 * --cr-* tokens (series by meaning, categories from --cr-c1..8).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { compact, day, money, monthName } from '../lib/format.ts';

export const CAT = (i: number): string => `var(--cr-c${(i % 8) + 1})`;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** A number that counts to its value when it first shows and when it changes. */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }): React.JSX.Element {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const cur = useRef(shown);
  useEffect(() => {
    const from = cur.current;
    if (from === value || reducedMotion()) {
      cur.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const k = Math.min(1, (t - t0) / 700);
      const v = k >= 1 ? value : from + (value - from) * (1 - (1 - k) ** 3);
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(Math.round(shown))}</>;
}

/** The width of an element, kept current. */
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

/** Round axis ticks covering [lo, hi]. */
function ticks(lo: number, hi: number, n = 4): number[] {
  if (hi === lo) return [lo];
  const span = hi - lo;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // From the tick at or below the lowest value to the first at or above the highest.
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; out.length < 12; v += step) {
    out.push(Math.round(v));
    if (v >= hi) break;
  }
  return out;
}

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState(x);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    setLeft(Math.max(0, Math.min(width - w, x - w / 2)));
  }, [x, width]);
  return (
    <div ref={ref} style={{ left, top: Math.max(0, y - 8), transform: 'translateY(-100%)' }} className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[5px] bg-[var(--cr-tooltip)] px-2 py-1.5 text-[11.5px] leading-4 text-[var(--cr-on-tooltip)] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.5)]">
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- sparkline */

export function Sparkline({ values, width = 96, height = 26, color = 'var(--cr-ink-2)', fill = true, className }: { values: number[]; width?: number | undefined; height?: number | undefined; color?: string | undefined; fill?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  if (values.length < 2) return <span style={{ width, height }} className={cn('inline-block', className)} />;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number): number => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number): number => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0)},${height} L${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')} L${x(values.length - 1)},${height} Z`;
  return (
    <svg width={width} height={height} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      {fill && <path d={area} fill={color} opacity={0.12} className="cr-fade-in" />}
      <polyline points={line} pathLength={1} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="cr-draw" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1] ?? 0)} r={2} fill={color} className="cr-fade-in" />
    </svg>
  );
}

/* ------------------------------------------------------------- area chart */

export function AreaChart({ points, height = 220, currency, color = 'var(--cr-accent)', label = 'Balance' }: { points: { date: string; value: number }[]; height?: number | undefined; currency: string; color?: string | undefined; label?: string | undefined }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const w = Math.max(0, width - padL - padR);
  const h = height - padT - padB;
  const vals = points.map((p) => p.value);
  const lo0 = Math.min(0, ...vals);
  const hi0 = Math.max(...vals, 1);
  const tk = ticks(lo0, hi0 + (hi0 - lo0) * 0.02);
  const lo = tk[0] ?? lo0;
  const hi = tk[tk.length - 1] ?? hi0;
  const x = (i: number): number => padL + (points.length <= 1 ? 0 : (i / (points.length - 1)) * w);
  const y = (v: number): number => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' L');
  // Month labels at month starts.
  const months = points.map((p, i) => ({ i, d: p.date })).filter((p) => p.d.endsWith('-01'));
  const step = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(w / 70))));
  const gid = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), []);
  const hp = hover !== null ? points[hover] : undefined;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && points.length > 1 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left - padL;
            const i = Math.round((px / (w || 1)) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {tk.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke="var(--cr-hair)" />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--cr-muted)" className="num">
                {compact(t, currency)}
              </text>
            </g>
          ))}
          {months
            .filter((_, k) => k % step === 0)
            .map((m) => (
              <text key={m.d} x={x(m.i)} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--cr-muted)">
                {monthName(m.d.slice(0, 7)).slice(0, 3)}
              </text>
            ))}
          <path d={`M${x(0)},${y(lo)} L${line} L${x(points.length - 1)},${y(lo)} Z`} fill={`url(#${gid})`} className="cr-fade-in" />
          <path d={`M${line}`} pathLength={1} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" className="cr-draw" />
          {lo < 0 && <line x1={padL} x2={padL + w} y1={y(0)} y2={y(0)} stroke="var(--cr-line)" />}
          {hp !== undefined && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + h} stroke="var(--cr-line)" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(hp.value)} r={4} fill="var(--cr-card)" stroke={color} strokeWidth={2} />
            </g>
          )}
          {hp === undefined && points.length > 0 && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.value)} r={3.5} fill={color} className="cr-fade-in" />}
        </svg>
      )}
      {hp !== undefined && hover !== null && (
        <Tip x={x(hover)} y={y(hp.value)} width={width}>
          <span className="block text-[10.5px] opacity-75">{day(hp.date)}</span>
          <span className="num font-bold">{money(hp.value, currency)}</span>
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- bar chart */

export interface Series {
  key: string;
  label: string;
  color: string;
}

export function BarChart({ groups, series, line, height = 220, currency }: { groups: { label: string; title?: string | undefined; values: Record<string, number> }[]; series: Series[]; line?: Series | undefined; height?: number | undefined; currency: string }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const w = Math.max(0, width - padL - padR);
  const h = height - padT - padB;
  const all: number[] = [0];
  for (const g of groups) {
    for (const s of series) all.push(g.values[s.key] ?? 0);
    if (line) all.push(g.values[line.key] ?? 0);
  }
  if (all.every((v) => v === 0))
    return (
      <div ref={ref} className="flex items-center justify-center text-[12.5px] text-[var(--cr-muted)]" style={{ height }}>
        Nothing in this period yet.
      </div>
    );
  const tk = ticks(Math.min(...all), Math.max(...all) * 1.06 || 1);
  const lo = tk[0] ?? 0;
  const hi = tk[tk.length - 1] ?? 1;
  const y = (v: number): number => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const gw = groups.length > 0 ? w / groups.length : w;
  const bw = Math.max(3, Math.min(22, (gw * 0.7) / Math.max(1, series.length)));
  const cx = (i: number): number => padL + gw * i + gw / 2;
  const hg = hover !== null ? groups[hover] : undefined;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(' and ')} onMouseLeave={() => setHover(null)}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--cr-line)' : 'var(--cr-hair)'} />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--cr-muted)">
                {compact(t, currency)}
              </text>
            </g>
          ))}
          {groups.map((g, i) => (
            <g key={g.label + i} onMouseEnter={() => setHover(i)}>
              <rect x={padL + gw * i} y={padT} width={gw} height={h} fill={hover === i ? 'var(--cr-row)' : 'transparent'} />
              {series.map((s, k) => {
                const v = g.values[s.key] ?? 0;
                const x0 = cx(i) - (bw * series.length) / 2 + k * bw;
                const top = Math.min(y(v), y(0));
                return <rect key={s.key} x={x0 + 0.5} y={top} width={bw - 1} height={Math.max(v === 0 ? 0 : 1, Math.abs(y(v) - y(0)))} rx={1.5} fill={s.color} className={cn('cr-grow-y', v < 0 && 'cr-down')} style={{ animationDelay: `${i * 35}ms` }} />;
              })}
              <text x={cx(i)} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--cr-muted)">
                {g.label}
              </text>
            </g>
          ))}
          {line && groups.length > 1 && (
            <>
              <polyline points={groups.map((g, i) => `${cx(i)},${y(g.values[line.key] ?? 0)}`).join(' ')} pathLength={1} fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" pointerEvents="none" className="cr-draw" style={{ animationDelay: '250ms' }} />
              {groups.map((g, i) => (
                <circle key={i} cx={cx(i)} cy={y(g.values[line.key] ?? 0)} r={hover === i ? 4 : 2.5} fill="var(--cr-card)" stroke={line.color} strokeWidth={2} pointerEvents="none" className="cr-fade-in" style={{ animationDelay: `${300 + i * 40}ms` }} />
              ))}
            </>
          )}
        </svg>
      )}
      {hg !== undefined && hover !== null && (
        <Tip x={cx(hover)} y={padT + 10} width={width}>
          <span className="block text-[10.5px] opacity-75">{hg.title ?? hg.label}</span>
          {[...series, ...(line ? [line] : [])].map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label}
              <span className="num ml-auto pl-3 font-bold">{money(hg.values[s.key] ?? 0, currency)}</span>
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ donut */

export function Donut({ items, size = 168, thickness = 22, currency, center }: { items: { label: string; value: number; color: string }[]; size?: number | undefined; thickness?: number | undefined; currency: string; center?: { label: string; value: string } | undefined }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((t, x) => t + Math.max(0, x.value), 0);
  const r = size / 2 - 2;
  const ri = r - thickness;
  let a0 = -Math.PI / 2;
  const arcs = items.map((it) => {
    const frac = total > 0 ? Math.max(0, it.value) / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const seg = { start: a0, end: a1, frac };
    a0 = a1;
    return seg;
  });
  const c = size / 2;
  const pt = (rad: number, ang: number): string => `${(c + rad * Math.cos(ang)).toFixed(2)},${(c + rad * Math.sin(ang)).toFixed(2)}`;
  const path = (s: number, e: number, grow: number): string => {
    const big = e - s > Math.PI ? 1 : 0;
    const ro = r + grow;
    if (e - s >= Math.PI * 2 - 0.0001) return `M${pt(ro, s)} A${ro},${ro} 0 1 1 ${pt(ro, s + Math.PI)} A${ro},${ro} 0 1 1 ${pt(ro, s)} M${pt(ri, s)} A${ri},${ri} 0 1 0 ${pt(ri, s + Math.PI)} A${ri},${ri} 0 1 0 ${pt(ri, s)} Z`;
    return `M${pt(ro, s)} A${ro},${ro} 0 ${big} 1 ${pt(ro, e)} L${pt(ri, e)} A${ri},${ri} 0 ${big} 0 ${pt(ri, s)} Z`;
  };
  const h = hover !== null ? items[hover] : undefined;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label="Share by category" className="overflow-visible" onMouseLeave={() => setHover(null)}>
        {total === 0 && <circle cx={c} cy={c} r={r - thickness / 2} fill="none" stroke="var(--cr-row-hover)" strokeWidth={thickness} />}
        <g className="cr-sweep">
          {arcs.map((a, i) =>
            a.frac > 0 ? <path key={i} d={path(a.start, a.end, hover === i ? 3 : 0)} fill={items[i]!.color} opacity={hover === null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)} className="transition-opacity" fillRule="evenodd" /> : null,
          )}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="max-w-[70%] truncate text-[11px] text-[var(--cr-muted)]">{h !== undefined ? h.label : (center?.label ?? '')}</span>
        <span className="num text-[15px] font-bold leading-5">{h !== undefined ? money(h.value, currency) : (center?.value ?? '')}</span>
        {h !== undefined && total > 0 && <span className="num text-[11px] text-[var(--cr-muted)]">{((h.value / total) * 100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ stacked bar */

export function StackBar({ items, height = 10, currency, legend = true }: { items: { label: string; value: number; color: string }[]; height?: number | undefined; currency: string; legend?: boolean | undefined }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((t, x) => t + Math.max(0, x.value), 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="cr-grow-x flex w-full overflow-hidden rounded-[3px] bg-[var(--cr-row-hover)]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {items.map((it, i) =>
          it.value > 0 ? (
            <span
              key={it.label}
              title={it.label + ': ' + money(it.value, currency)}
              onMouseEnter={() => setHover(i)}
              className="h-full transition-opacity first:rounded-l-[3px] last:rounded-r-[3px]"
              style={{ width: `${(it.value / (total || 1)) * 100}%`, background: it.color, opacity: hover === null || hover === i ? 1 : 0.5, marginRight: 1 }}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
          {items.map((it, i) => (
            <span key={it.label} className={cn('inline-flex items-center gap-1.5', hover !== null && hover !== i && 'opacity-50')}>
              <span className="inline-block size-2 rounded-[2px]" style={{ background: it.color }} />
              <span className="text-[var(--cr-ink-2)]">{it.label}</span>
              <span className="num font-semibold">{compact(it.value, currency)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ meter */

/**
 * A share bar of fixed width with its legend beside it, on one line: for
 * toolbars, strips and list rows. `count` shows the values as counts
 * ("13 AI proposals"), otherwise as amounts ("1–30 days $4,401"); `wrap`
 * lets the legend drop under the bar when the row is narrow.
 */
export function Meter({ items, currency = '', count = false, width = 140, height = 6, keepZero = false, wrap = false, className }: { items: { label: string; value: number; color: string }[]; currency?: string | undefined; count?: boolean | undefined; width?: number | undefined; height?: number | undefined; keepZero?: boolean | undefined; wrap?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((t, x) => t + Math.max(0, x.value), 0);
  return (
    <div className={cn('flex min-w-0 items-center gap-x-3', wrap && 'flex-wrap gap-y-1.5', className)} onMouseLeave={() => setHover(null)}>
      <span className="cr-grow-x flex shrink-0 gap-px overflow-hidden rounded-full bg-[var(--cr-row-hover)]" style={{ width, height }}>
        {items.map((it, i) =>
          it.value > 0 ? (
            <span key={it.label} title={it.label + ': ' + (count ? String(it.value) : money(it.value, currency))} onMouseEnter={() => setHover(i)} className="h-full transition-opacity" style={{ width: `${(it.value / (total || 1)) * 100}%`, background: it.color, opacity: hover === null || hover === i ? 1 : 0.4 }} />
          ) : null,
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] leading-4">
        {items.map((it, i) =>
          it.value > 0 || keepZero ? (
            <span key={it.label} onMouseEnter={() => setHover(i)} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap transition-opacity', hover !== null && hover !== i && 'opacity-40')}>
              <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: it.value > 0 ? it.color : 'var(--cr-line)' }} />
              {count ? (
                <>
                  <b className="num">{it.value}</b>
                  <span className="text-[var(--cr-ink-2)]">{it.label}</span>
                </>
              ) : (
                <>
                  <span className="text-[var(--cr-ink-2)]">{it.label}</span>
                  <span className={cn('num', it.value > 0 ? 'font-semibold' : 'text-[var(--cr-muted)]')}>{it.value > 0 ? compact(it.value, currency) : '–'}</span>
                </>
              )}
            </span>
          ) : null,
        )}
      </span>
    </div>
  );
}

/* ---------------------------------------------------- horizontal bars */

/** Amounts as bars against the largest, label and amount in fixed columns so rows line up. */
export function HBars({ items, currency, labelWidth = 72, valueWidth = 92, className }: { items: { label: string; value: number; color: string }[]; currency: string; labelWidth?: number | undefined; valueWidth?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const max = Math.max(1, ...items.map((x) => Math.abs(x.value)));
  return (
    <ul className={cn('flex flex-col', className)}>
      {items.map((it, i) => (
        <li key={it.label} className="grid h-6 items-center gap-3 text-[12px]" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr) ${valueWidth}px` }}>
          <span className="truncate text-[var(--cr-ink-2)]" title={it.label}>
            {it.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-[var(--cr-row-hover)]">
            {it.value !== 0 && <span className="cr-grow-x block h-full rounded-full" style={{ width: `${Math.max(1.5, (Math.abs(it.value) / max) * 100)}%`, background: it.color, animationDelay: `${i * 50}ms` }} />}
          </span>
          <span className={cn('num truncate text-right', it.value !== 0 ? 'font-semibold' : 'text-[var(--cr-muted)]')}>{it.value !== 0 ? money(it.value, currency) : '–'}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- waterfall */

export function Waterfall({ steps, height = 200, currency }: { steps: { label: string; value: number; total?: boolean | undefined; color?: string | undefined }[]; height?: number | undefined; currency: string }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56;
  const padR = 8;
  const padT = 14;
  const padB = 24;
  const w = Math.max(0, width - padL - padR);
  const h = height - padT - padB;
  // Running level: totals stand from zero, deltas float from the level before.
  let level = 0;
  const bars = steps.map((s) => {
    if (s.total) {
      level = s.value;
      return { from: 0, to: s.value, s };
    }
    const from = level;
    level += s.value;
    return { from, to: level, s };
  });
  const all = bars.flatMap((b) => [b.from, b.to, 0]);
  const tk = ticks(Math.min(...all), Math.max(...all) * 1.06 || 1);
  const lo = tk[0] ?? 0;
  const hi = tk[tk.length - 1] ?? 1;
  const y = (v: number): number => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const gw = steps.length ? w / steps.length : w;
  const bw = Math.min(56, gw * 0.62);
  const hb = hover !== null ? bars[hover] : undefined;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Waterfall" onMouseLeave={() => setHover(null)}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--cr-line)' : 'var(--cr-hair)'} />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--cr-muted)">
                {compact(t, currency)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const x0 = padL + gw * i + (gw - bw) / 2;
            const color = b.s.color ?? (b.s.total ? 'var(--cr-ink-2)' : b.s.value >= 0 ? 'var(--cr-pos)' : 'var(--cr-neg)');
            const next = bars[i + 1];
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={padL + gw * i} y={padT} width={gw} height={h} fill={hover === i ? 'var(--cr-row)' : 'transparent'} />
                <rect x={x0} y={Math.min(y(b.from), y(b.to))} width={bw} height={Math.max(1, Math.abs(y(b.from) - y(b.to)))} rx={2} fill={color} opacity={b.s.total ? 0.85 : 0.9} className={cn('cr-grow-y', b.to < b.from && 'cr-down')} style={{ animationDelay: `${i * 70}ms` }} />
                {next !== undefined && !next.s.total && <line x1={x0 + bw} x2={x0 + gw} y1={y(b.to)} y2={y(b.to)} stroke="var(--cr-line)" strokeDasharray="2 2" />}
                <text x={x0 + bw / 2} y={height - 7} textAnchor="middle" fontSize="10.5" fill="var(--cr-muted)">
                  {b.s.label.length > 14 ? b.s.label.slice(0, 13) + '…' : b.s.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hb !== undefined && hover !== null && (
        <Tip x={padL + gw * hover + gw / 2} y={Math.min(y(hb.from), y(hb.to))} width={width}>
          <span className="block text-[10.5px] opacity-75">{hb.s.label}</span>
          <span className="num font-bold">{money(hb.s.value, currency, { sign: !hb.s.total })}</span>
        </Tip>
      )}
    </div>
  );
}

/** A legend row for series. */
export function Legend({ series }: { series: Series[] }): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--cr-ink-2)]">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------- stacked counts */

/** Columns of counts stacked by series (interactions per week by kind). */
export function StackedBars({ groups, series, height = 200, unit = '' }: { groups: { label: string; title?: string | undefined; values: Record<string, number> }[]; series: Series[]; height?: number | undefined; unit?: string | undefined }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 34;
  const padR = 6;
  const padT = 10;
  const padB = 22;
  const w = Math.max(0, width - padL - padR);
  const h = height - padT - padB;
  const totals = groups.map((g) => series.reduce((t, s) => t + (g.values[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const tk: number[] = [];
  for (let v = 0; v <= top; v += step) tk.push(v);
  const y = (v: number): number => padT + h - (v / top) * h;
  const gw = groups.length > 0 ? w / groups.length : w;
  const bw = Math.max(4, Math.min(26, gw * 0.62));
  const every = Math.max(1, Math.ceil(groups.length / Math.max(1, Math.floor(w / 46))));
  const hg = hover !== null ? groups[hover] : undefined;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} onMouseLeave={() => setHover(null)}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--cr-line)' : 'var(--cr-hair)'} />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--cr-muted)" className="num">
                {t}
              </text>
            </g>
          ))}
          {groups.map((g, i) => {
            let acc = 0;
            const x0 = padL + gw * i + (gw - bw) / 2;
            return (
              <g key={g.label + i} onMouseEnter={() => setHover(i)}>
                <rect x={padL + gw * i} y={padT} width={gw} height={h} fill={hover === i ? 'var(--cr-row)' : 'transparent'} />
                {series.map((s) => {
                  const v = g.values[s.key] ?? 0;
                  if (v <= 0) return null;
                  const yt = y(acc + v);
                  const hh = y(acc) - yt;
                  acc += v;
                  return <rect key={s.key} x={x0} y={yt} width={bw} height={Math.max(1, hh - 1)} rx={1.5} fill={s.color} className="cr-grow-y" style={{ animationDelay: `${i * 30}ms` }} />;
                })}
                {i % every === 0 && (
                  <text x={x0 + bw / 2} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--cr-muted)">
                    {g.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hg !== undefined && hover !== null && (
        <Tip x={padL + gw * hover + gw / 2} y={y(totals[hover] ?? 0)} width={width}>
          <span className="block text-[10.5px] opacity-75">{hg.title ?? hg.label}</span>
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label}
              <span className="num ml-auto pl-3 font-bold">{hg.values[s.key] ?? 0}</span>
            </span>
          ))}
          <span className="mt-0.5 block border-t border-white/20 pt-0.5 text-right font-bold">
            {totals[hover]} {unit}
          </span>
        </Tip>
      )}
    </div>
  );
}

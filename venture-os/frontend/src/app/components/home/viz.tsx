/**
 * Home's own chart pieces, beside the kernel's (components/charts.tsx):
 * a stacked area, a donut with any number of segments and a squarified
 * treemap. Pure SVG and HTML on the theme tokens, one sweep on first draw
 * (never again, nothing loops), a tooltip on hover.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import { compact } from '../../lib/format.ts';
import { niceTicks } from '../charts.tsx';

/* ---------------------------------------------------------------- hooks */

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

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** False on the first paint, true right after: the one sweep (true at once with reduced motion). */
export function useDrawn(): boolean {
  const [drawn, setDrawn] = useState(reducedMotion);
  useEffect(() => {
    if (drawn) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [drawn]);
  return drawn;
}

const SWEEP = 'transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1)';

/** The tooltip box, kept inside its chart's frame. */
export function TipBox({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(160);
  useLayoutEffect(() => {
    if (ref.current !== null) setW(ref.current.offsetWidth);
  });
  const flip = x + 12 + w > width && x - 12 - w >= 0;
  const left = flip ? x - 12 - w : Math.min(Math.max(0, x + 12), Math.max(0, width - w));
  return (
    <div ref={ref} role="tooltip" style={{ left, top: Math.max(0, y) }} className="pointer-events-none absolute z-10 min-w-[120px] rounded-[4px] bg-[var(--vo-ink)] px-2.5 py-1.5 text-[12px] leading-[17px] text-[var(--vo-on-ink)] shadow-[var(--vo-shadow-lg)]">
      {children}
    </div>
  );
}

export function TipRow({ color, label, value }: { color: string; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: color }} />
      <span className="min-w-0 flex-1 opacity-80">{label}</span>
      <span className="vo-mono vo-num">{value}</span>
    </div>
  );
}

/** A legend of coloured squares and short labels. */
export function Swatches({ items, className }: { items: { label: string; color: string }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-[var(--vo-muted)]', className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- StackedArea */

/** Monotone cubic through points (Fritsch and Carlson), as an SVG path continuing from the current point. */
function monotone(pts: [number, number][], move: boolean): string {
  const n = pts.length;
  if (n === 0) return '';
  const first = pts[0] as [number, number];
  if (n === 1) return `${move ? 'M' : 'L'}${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i] as [number, number];
    const b = pts[i + 1] as [number, number];
    dx.push(b[0] - a[0]);
    m.push((b[1] - a[1]) / (b[0] - a[0] || 1));
  }
  const t: number[] = [m[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const m0 = m[i - 1] ?? 0;
    const m1 = m[i] ?? 0;
    const h0 = dx[i - 1] ?? 0;
    const h1 = dx[i] ?? 0;
    t.push(m0 * m1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / m0 + (h1 + 2 * h0) / m1));
  }
  t.push(m[n - 2] ?? 0);
  let d = `${move ? 'M' : 'L'}${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i] as [number, number];
    const b = pts[i + 1] as [number, number];
    const h = dx[i] ?? 0;
    d += `C${(a[0] + h / 3).toFixed(1)},${(a[1] + ((t[i] ?? 0) * h) / 3).toFixed(1)} ${(b[0] - h / 3).toFixed(1)},${(b[1] - ((t[i + 1] ?? 0) * h) / 3).toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
  }
  return d;
}

export interface AreaSeries {
  key: string;
  label: string;
  values: number[];
  color: string;
}

/** Stacked areas over time (counts), the first series at the bottom; a hover line shows each layer and the total. */
export function StackedArea({ labels, tips, series, height = 200, format = (v) => compact(v), label }: { labels: string[]; tips?: string[] | undefined; series: AreaSeries[]; height?: number | undefined; format?: ((v: number) => string) | undefined; label: string }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const drawn = useDrawn();
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const f = { left: 32, right: 6, top: 8, bottom: 22 };
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals), 3);
  const y1 = ticks[ticks.length - 1] ?? 1;
  const pw = Math.max(10, width - f.left - f.right);
  const ph = Math.max(10, height - f.top - f.bottom);
  const X = (i: number): number => f.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const Y = (v: number): number => f.top + ph - (v / (y1 || 1)) * ph;
  const cum: number[][] = [];
  let base = labels.map(() => 0);
  for (const s of series) {
    const top = base.map((b, i) => b + (s.values[i] ?? 0));
    cum.push(top);
    base = top;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 46))));
  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block touch-pan-y overflow-visible"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left - f.left) / pw) * (n - 1));
            setHover(i >= 0 && i < n ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={clip}>
              <rect x={-4} y={-4} width={width + 8} height={height + 8} style={{ transformOrigin: '0px 0px', transform: drawn ? 'scaleX(1)' : 'scaleX(0)', transition: SWEEP }} />
            </clipPath>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={f.left} x2={f.left + pw} y1={Y(t)} y2={Y(t)} style={{ stroke: t === 0 ? 'var(--vo-line)' : 'var(--vo-hair)' }} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={f.left - 8} y={Y(t)} dy="0.32em" textAnchor="end" className="vo-mono fill-[var(--vo-muted)] text-[12px]">
                {compact(t)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clip})`}>
            {series.map((s, si) => {
              const top = cum[si] ?? [];
              const bottom = si === 0 ? labels.map(() => 0) : (cum[si - 1] ?? []);
              const up = top.map((v, i) => [X(i), Y(v)] as [number, number]);
              const down = bottom.map((v, i) => [X(i), Y(v)] as [number, number]).reverse();
              const d = monotone(up, true) + monotone(down, false) + 'Z';
              return (
                <g key={s.key}>
                  <path d={d} style={{ fill: s.color, opacity: hover === null ? 0.78 : 0.7 }} />
                  <path d={monotone(up, true)} fill="none" style={{ stroke: s.color }} strokeWidth={1.25} />
                </g>
              );
            })}
          </g>
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={f.top} y2={f.top + ph} style={{ stroke: 'var(--vo-ink)' }} strokeOpacity={0.5} strokeWidth={1} />}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              i !== n - 1 && n - 1 - i < every * 0.6 ? null : (
                <text key={i} x={X(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="vo-mono fill-[var(--vo-muted)] text-[12px]">
                  {l}
                </text>
              )
            ) : null,
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <TipBox x={X(hover)} y={f.top} width={width}>
          <div className="mb-0.5 flex items-baseline justify-between gap-3 font-medium">
            <span>{tips?.[hover] ?? labels[hover]}</span>
            <span className="vo-mono vo-num">{format(totals[hover] ?? 0)}</span>
          </div>
          {series
            .slice()
            .reverse()
            .map((s) => (
              <TipRow key={s.key} color={s.color} label={s.label} value={format(s.values[hover] ?? 0)} />
            ))}
        </TipBox>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Donut */

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** A donut of any number of segments; the centre shows the total, or the hovered segment. */
export function Donut({ segments, size = 136, thickness = 14, center, format, label, hover, onHover }: { segments: DonutSegment[]; size?: number | undefined; thickness?: number | undefined; center: ReactNode; format: (v: number) => string; label: string; hover: string | null; onHover: (key: string | null) => void }): React.JSX.Element {
  const drawn = useDrawn();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = Math.max(1e-9, segments.reduce((a, s) => a + s.value, 0));
  let acc = 0;
  const h = segments.find((s) => s.key === hover);
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--vo-sunk)' }} strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const off = acc;
          acc += len;
          const gap = segments.length > 1 && len > 3 ? 1.5 : 0;
          return (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={hover === s.key ? thickness + 3 : thickness}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={drawn ? -off : -off + len}
              onPointerEnter={() => onHover(s.key)}
              onPointerLeave={() => onHover(null)}
              style={{ stroke: s.color, transition: 'stroke-dashoffset 700ms cubic-bezier(0.2,0.7,0.2,1), stroke-width 150ms ease', opacity: drawn ? (hover !== null && hover !== s.key ? 0.55 : 1) : 0 }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
        {h !== undefined ? (
          <>
            <span className="vo-mono vo-num text-[15px] text-[var(--vo-ink)]">{format(h.value)}</span>
            <span className="max-w-full truncate text-[12px] text-[var(--vo-muted)]">{h.label}</span>
          </>
        ) : (
          center
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Treemap */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout (Bruls, Huizing, van Wijk): rectangles in `box`, areas proportional to `v`. */
export function squarify<T>(items: { v: number; t: T }[], box: Rect): (Rect & { t: T })[] {
  const list = items.filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const total = list.reduce((a, x) => a + x.v, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const areas = list.map((x) => ({ a: x.v * scale, t: x.t }));
  const out: (Rect & { t: T })[] = [];
  const r = { ...box };
  const worst = (row: { a: number }[], side: number): number => {
    if (row.length === 0) return Infinity;
    let s = 0;
    let mx = 0;
    let mn = Infinity;
    for (const x of row) {
      s += x.a;
      mx = Math.max(mx, x.a);
      mn = Math.min(mn, x.a);
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = (row: { a: number; t: T }[]): void => {
    const s = row.reduce((a, x) => a + x.a, 0);
    if (r.w >= r.h) {
      const cw = s / r.h;
      let y = r.y;
      for (const x of row) {
        const h = x.a / cw;
        out.push({ x: r.x, y, w: cw, h, t: x.t });
        y += h;
      }
      r.x += cw;
      r.w -= cw;
    } else {
      const rh = s / r.w;
      let x0 = r.x;
      for (const x of row) {
        const w = x.a / rh;
        out.push({ x: x0, y: r.y, w, h: rh, t: x.t });
        x0 += w;
      }
      r.y += rh;
      r.h -= rh;
    }
  };
  let row: { a: number; t: T }[] = [];
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(r.w, r.h);
    const next = areas[i];
    if (next === undefined) break;
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      i++;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length > 0) place(row);
  return out;
}

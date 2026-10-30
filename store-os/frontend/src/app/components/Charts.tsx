/**
 * Charts drawn in SVG with the theme's colors: the sales line (this period
 * solid, the previous period dashed, a dark tooltip and a crosshair on
 * hover), stacked bars by shop, and sparklines. No chart library.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';

export const SERIES_COLORS = ['var(--so-chart-1)', 'var(--so-chart-2)', 'var(--so-chart-3)', 'var(--so-chart-4)', 'var(--so-chart-5)', 'var(--so-chart-6)'];

function useSize(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h];
}

/** Room for the y-axis labels: about 6.5 px per character of the widest one. */
function axisRoom(labels: string[]): number {
  return Math.max(36, Math.min(96, 12 + Math.max(...labels.map((l) => l.length)) * 6.5));
}

/** A "nice" top for a y axis. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function smooth(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return 'M' + points[0]![0] + ',' + points[0]![1];
  let d = 'M' + points[0]![0] + ',' + points[0]![1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const cx = (x0 + x1) / 2;
    d += ' C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1;
  }
  return d;
}

export interface LinePoint {
  key: string;
  label: string;
  long: string;
  value: number;
  prev: number;
}

/**
 * The sales line. `format` writes values; `rows` are extra lines in the
 * tooltip for the hovered point.
 */
export function SalesChart({ points, format, height: fixed, valueName, prevName, rows }: { points: LinePoint[]; format: (v: number) => string; height?: number; valueName: string; prevName: string; rows?: (i: number) => ReactNode }): React.JSX.Element {
  const [ref, width, measured] = useSize();
  const [hover, setHover] = useState<number | null>(null);
  // Without a fixed height the chart fills its box (at least 220 px).
  const height = fixed ?? Math.max(220, measured);
  const padR = 12;
  const padT = 16;
  const padB = 30;
  const max = useMemo(() => niceMax(Math.max(1, ...points.map((p) => Math.max(p.value, p.prev)))), [points]);
  const min = useMemo(() => Math.min(0, ...points.map((p) => Math.min(p.value, p.prev))), [points]);
  const span = max - min || 1;
  const ticks0 = [0, 0.25, 0.5, 0.75, 1].map((k) => min + span * k);
  const padL = axisRoom(ticks0.map(format));
  const w = Math.max(width, 240);
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const x = (i: number): number => padL + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number): number => padT + innerH - ((v - min) / span) * innerH;
  const cur = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const prev = points.map((p, i) => [x(i), y(p.prev)] as [number, number]);
  const line = smooth(cur);
  const area = cur.length > 0 ? line + ' L' + x(points.length - 1) + ',' + (padT + innerH) + ' L' + x(0) + ',' + (padT + innerH) + ' Z' : '';
  const ticks = ticks0;
  // A date label every `every` points; none within a step of the last one, which sits flush right.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));
  const onMove = (e: React.PointerEvent<SVGRectElement>): void => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = points.length <= 1 ? 0 : Math.round((px / r.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover !== null ? points[hover] : undefined;
  const tipLeft = hover !== null ? x(hover) : 0;
  const flip = tipLeft > w - 200;
  return (
    <div ref={ref} className="relative h-full w-full select-none" style={fixed !== undefined ? { height: fixed } : { minHeight: 220 }}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={valueName + ' chart'} className="absolute inset-0">
          <defs>
            <linearGradient id="so-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--so-chart-1)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--so-chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--so-line)" strokeDasharray={i === 0 ? undefined : '3 4'} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="num" fontSize={11} fill="var(--so-faint)">
                {format(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i === points.length - 1 || (i % every === 0 && points.length - 1 - i >= every) ? (
              <g key={p.key}>
                {hover === i && <rect x={x(i) - 24} y={height - 24} width={48} height={20} rx={10} fill="var(--so-tile)" />}
                <text x={i === points.length - 1 && points.length > 1 ? w - padR : x(i)} y={height - 10} textAnchor={i === points.length - 1 && points.length > 1 ? 'end' : 'middle'} fontSize={11} fontWeight={hover === i ? 600 : 400} fill={hover === i ? 'var(--so-ink)' : 'var(--so-muted)'}>
                  {p.label}
                </text>
              </g>
            ) : null,
          )}
          <path d={smooth(prev)} fill="none" stroke="var(--so-chart-3)" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
          <path d={area} fill="url(#so-area)" />
          <path d={line} fill="none" stroke="var(--so-chart-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {hover !== null && h !== undefined && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--so-faint)" strokeDasharray="3 4" />
              <circle cx={x(hover)} cy={y(h.prev)} r={4} fill="var(--so-card)" stroke="var(--so-chart-3)" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(h.value)} r={5} fill="var(--so-card)" stroke="var(--so-chart-1)" strokeWidth={2.5} />
            </g>
          )}
          <rect x={padL} y={padT} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove} />
        </svg>
      )}
      {hover !== null && h !== undefined && (
        <div className="pointer-events-none absolute z-10 min-w-[170px] rounded-[14px] bg-[var(--so-tooltip)] px-3.5 py-3 text-[var(--so-on-tooltip)] shadow-[0_18px_40px_-16px_var(--so-shadow)]" style={{ left: flip ? tipLeft - 182 : tipLeft + 12, top: Math.max(0, y(h.value) - 70) }}>
          <p className="text-[12px] font-semibold">{h.long}</p>
          <div className="mt-2 space-y-1 text-[12px]">
            <p className="flex items-center gap-2">
              <span className="h-3 w-[3px] rounded-full bg-[var(--so-chart-1)]" />
              <span className="num font-semibold">{format(h.value)}</span>
              <span className="text-[var(--so-tooltip-muted)]">{valueName}</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="h-3 w-[3px] rounded-full bg-[var(--so-chart-3)]" />
              <span className="num font-semibold">{format(h.prev)}</span>
              <span className="text-[var(--so-tooltip-muted)]">{prevName}</span>
            </p>
            {rows?.(hover)}
          </div>
        </div>
      )}
    </div>
  );
}

export interface BarGroup {
  key: string;
  label: string;
  long: string;
  parts: { id: string; name: string; value: number }[];
}

/** Rounded stacked bars (one color per shop) with a tooltip. */
export function StackedBars({ groups, colors, format, height = 220 }: { groups: BarGroup[]; colors: Record<string, string>; format: (v: number) => string; height?: number }): React.JSX.Element {
  const [ref, width] = useSize();
  const [hover, setHover] = useState<number | null>(null);
  const padB = 26;
  const padT = 10;
  const max = niceMax(Math.max(1, ...groups.map((g) => g.parts.reduce((n, p) => n + Math.max(0, p.value), 0))));
  const padL = axisRoom([0, 0.25, 0.5, 0.75, 1].map((k) => format(max * k)));
  const w = Math.max(width, 200);
  const innerW = w - padL - 8;
  const innerH = height - padT - padB;
  const slot = groups.length > 0 ? innerW / groups.length : innerW;
  const bw = Math.max(4, Math.min(28, slot * 0.56));
  // A date label every `every` points; none within a step of the last one, which sits flush right.
  const every = Math.max(1, Math.ceil(groups.length / Math.max(2, Math.floor(innerW / 56))));
  const g = hover !== null ? groups[hover] : undefined;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label="Sales by shop">
          <defs>
            <pattern id="so-hatch-bar" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--so-chart-1)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--so-card)" strokeWidth="2.4" />
            </pattern>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((k) => (
            <g key={k}>
              <line x1={padL} x2={w - 8} y1={padT + innerH - innerH * k} y2={padT + innerH - innerH * k} stroke="var(--so-line)" strokeDasharray={k === 0 ? undefined : '3 4'} />
              <text x={padL - 8} y={padT + innerH - innerH * k + 4} textAnchor="end" fontSize={11} className="num" fill="var(--so-faint)">
                {format(max * k)}
              </text>
            </g>
          ))}
          {groups.map((gr, i) => {
            const cx = padL + slot * i + slot / 2;
            let yy = padT + innerH;
            const visible = gr.parts.filter((p) => p.value > 0);
            return (
              <g key={gr.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill={hover === i ? 'var(--so-row-hover)' : 'transparent'} rx={8} />
                {visible.map((p, j) => {
                  const hgt = (p.value / max) * innerH;
                  yy -= hgt;
                  const top = j === visible.length - 1;
                  const fill = colors[p.id] ?? 'var(--so-chart-3)';
                  return <rect key={p.id} x={cx - bw / 2} y={yy} width={bw} height={Math.max(1, hgt - (top ? 0 : 2))} rx={top ? Math.min(6, bw / 2) : 2} fill={fill} />;
                })}
                {(i === groups.length - 1 || (i % every === 0 && groups.length - 1 - i >= every)) && (
                  <text x={i === groups.length - 1 && groups.length > 1 ? Math.min(cx + slot / 2, w - 2) : cx} y={height - 8} textAnchor={i === groups.length - 1 && groups.length > 1 ? 'end' : 'middle'} fontSize={11} fill={hover === i ? 'var(--so-ink)' : 'var(--so-muted)'} fontWeight={hover === i ? 600 : 400}>
                    {gr.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {g !== undefined && hover !== null && (
        <div className="pointer-events-none absolute z-10 min-w-[160px] rounded-[14px] bg-[var(--so-tooltip)] px-3.5 py-3 text-[12px] text-[var(--so-on-tooltip)] shadow-[0_18px_40px_-16px_var(--so-shadow)]" style={{ left: Math.min(padL + slot * hover + slot / 2 + 10, w - 180), top: 8 }}>
          <p className="font-semibold">{g.long}</p>
          <div className="mt-2 space-y-1">
            {g.parts.filter((p) => p.value !== 0).length === 0 && <p className="text-[var(--so-tooltip-muted)]">No sales</p>}
            {g.parts
              .filter((p) => p.value !== 0)
              .map((p) => (
                <p key={p.id} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: colors[p.id] }} />
                  <span className="min-w-0 flex-1 truncate text-[var(--so-tooltip-muted)]">{p.name}</span>
                  <span className="num font-semibold">{format(p.value)}</span>
                </p>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 28, className, tone = 'accent' }: { values: number[]; width?: number; height?: number; className?: string; tone?: 'accent' | 'ink' | 'muted' }): React.JSX.Element {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length <= 1 ? width / 2 : (i * width) / (values.length - 1), height - 2 - ((v - min) / span) * (height - 4)] as [number, number]);
  const color = tone === 'accent' ? 'var(--so-chart-1)' : tone === 'ink' ? 'var(--so-ink)' : 'var(--so-faint)';
  return (
    <svg width={width} height={height} className={cn('shrink-0', className)} aria-hidden>
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/** A legend row of colored dots and names. */
export function Legend({ items, className }: { items: { color: string; label: string; dashed?: boolean }[]; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--so-muted)]', className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} /> : <span className="size-2.5 rounded-full" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

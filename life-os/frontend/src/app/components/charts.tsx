/**
 * Small charts drawn in the theme's colors: a year of days (heat), a line
 * over time, and bars with an optional goal line.
 */
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { addDays, between, MON, parseDay, WD1 } from '../lib/format.ts';

/* --------------------------------------------------- a habit's year (heat) */

export function Heatmap({ from, levels, weekStartsOn = 1, cell = 11, gap = 3, label }: { from: string; levels: (number | 's')[]; weekStartsOn?: number | undefined; cell?: number | undefined; gap?: number | undefined; label: string }): React.JSX.Element {
  const offset = (parseDay(from).getDay() - weekStartsOn + 7) % 7;
  const cols = Math.ceil((levels.length + offset) / 7);
  const W = cols * (cell + gap) + 24;
  const H = 7 * (cell + gap) + 18;
  const months: { x: number; label: string }[] = [];
  for (let c = 0; c < cols; c++) {
    const idx = c * 7 - offset;
    const d = addDays(from, Math.max(0, idx));
    if (parseDay(d).getDate() <= 7 && (months.length === 0 || months[months.length - 1]!.label !== MON[parseDay(d).getMonth()])) months.push({ x: 24 + c * (cell + gap), label: MON[parseDay(d).getMonth()] ?? '' });
  }
  // On a narrow screen the year scrolls; it opens on the latest weeks.
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (box.current !== null) box.current.scrollLeft = box.current.scrollWidth;
  }, [levels.length]);
  return (
    <div ref={box} className="max-w-full overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label={label}>
        {months.map((m) => (
          <text key={m.x} x={m.x} y={10} fontSize={12} fontWeight={700} fill="var(--lo-muted)">
            {m.label}
          </text>
        ))}
        {[1, 3, 5].map((r) => (
          <text key={r} x={0} y={18 + r * (cell + gap) + cell - 2} fontSize={12} fontWeight={700} fill="var(--lo-muted)">
            {WD1[(r + weekStartsOn) % 7]}
          </text>
        ))}
        {levels.map((lv, i) => {
          const k = i + offset;
          const c = Math.floor(k / 7);
          const r = k % 7;
          const x = 24 + c * (cell + gap);
          const y = 16 + r * (cell + gap);
          const date = addDays(from, i);
          if (lv === -1) return <rect key={i} x={x} y={y} width={cell} height={cell} rx={3} fill="var(--lo-sunk)" opacity={0.6}><title>{date}</title></rect>;
          if (lv === 's') return <rect key={i} x={x + 0.75} y={y + 0.75} width={cell - 1.5} height={cell - 1.5} rx={3} fill="none" stroke="var(--lo-line)" strokeWidth={1.5} strokeDasharray="2 2"><title>{date + ': skipped'}</title></rect>;
          return (
            <rect key={i} x={x} y={y} width={cell} height={cell} rx={3} fill={`var(--lo-heat-${lv})`}>
              <title>{date + (lv === 0 ? ': not done' : ': done')}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------- a progress line */

export function LineChart({ points, height = 120, target, baseline, label, format = (v: number) => String(v), color = 'var(--lo-moss)', soft = 'var(--lo-moss-soft)', empty = 'Nothing noted yet.' }: { points: { date: string; value: number | null }[]; height?: number | undefined; target?: number | undefined; baseline?: number | undefined; label: string; format?: ((v: number) => string) | undefined; color?: string | undefined; soft?: string | undefined; empty?: string | undefined }): React.JSX.Element {
  const W = 560;
  const H = height;
  const pts = points.filter((p) => p.value !== null) as { date: string; value: number }[];
  if (pts.length === 0) return <div className="flex items-center justify-center text-[13px] text-[var(--lo-muted)]" style={{ height }}>{empty}</div>;
  const vals = pts.map((p) => p.value).concat(target !== undefined ? [target] : [], baseline !== undefined ? [baseline] : []);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const d0 = pts[0]!.date;
  const span = Math.max(1, between(d0, pts[pts.length - 1]!.date));
  const x = (d: string) => 8 + ((W - 16) * between(d0, d)) / span;
  const y = (v: number) => 10 + (H - 28) * (1 - (v - lo) / (hi - lo));
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.date).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ');
  const area = path + ` L${x(pts[pts.length - 1]!.date)},${H - 18} L${x(d0)},${H - 18} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="w-full" style={{ height }}>
      {target !== undefined && <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke={color} strokeDasharray="4 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      <path d={area} fill={soft} />
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p) => (
        <circle key={p.date + p.value} cx={x(p.date)} cy={y(p.value)} r={3} fill="var(--lo-card)" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke">
          <title>{`${p.date}: ${format(p.value)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Bars for values over days (spending, focus, steps), with an optional goal line. */
export function Bars({ values, labels, height = 72, color = 'var(--lo-moss)', goal, format = (v: number) => String(v), highlight }: { values: number[]; labels: string[]; height?: number | undefined; color?: string | undefined; goal?: number | undefined; format?: ((v: number) => string) | undefined; highlight?: number | undefined }): React.JSX.Element {
  const max = Math.max(1, goal ?? 0, ...values);
  return (
    <div className="relative">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <span key={i} title={`${labels[i] ?? ''}: ${format(v)}`} className="min-w-0 flex-1 rounded-t-[3px] transition-[height] duration-500" style={{ height: v <= 0 ? 2 : `${Math.max(4, (v / max) * 100)}%`, background: v <= 0 ? 'var(--lo-track)' : color, opacity: highlight !== undefined && highlight !== i ? 0.55 : 1 }} />
        ))}
      </div>
      {goal !== undefined && goal > 0 && <span aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-[var(--lo-line)]" style={{ bottom: `${(goal / max) * height}px` }} />}
    </div>
  );
}

export function Legend({ items }: { items: { label: ReactNode; color: string }[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-semibold text-[var(--lo-ink-2)]">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

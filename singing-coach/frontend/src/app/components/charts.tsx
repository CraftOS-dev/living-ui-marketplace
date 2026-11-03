/**
 * Charts as hand-drawn SVG in the instrument style: hairlines, dots, small
 * mono numbers. Each grows in once when it mounts and shows exact values on
 * hover. Every chart keeps the same root element whether it has data or
 * not, so its measured width stays put.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { minutes as fmtMinutes, shortDay, weekday } from '../lib/format.ts';
import type { Preview } from '../lib/types.ts';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** A number that counts to its value when it shows and when it changes. */
export function CountUp({ value, format = (v) => String(Math.round(v)), ms = 700 }: { value: number; format?: (v: number) => string; ms?: number }): React.JSX.Element {
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
      const k = Math.min(1, (t - t0) / ms);
      const v = k >= 1 ? value : from + (value - from) * (1 - (1 - k) ** 3);
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{format(shown)}</>;
}

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

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState(x);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    setLeft(Math.max(0, Math.min(width - w, x - w / 2)));
  }, [x, width]);
  return (
    <div ref={ref} style={{ left, top: Math.max(0, y - 8), transform: 'translateY(-100%)' }} className="sc-mono pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] bg-[var(--sc-ink)] px-2 py-1 text-[11px] leading-4 text-[var(--sc-page)] shadow-[var(--sc-shadow-lg)]">
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- sparkline */

export function Sparkline({ values, width = 84, height = 24, color = 'var(--sc-ink-2)', className }: { values: number[]; width?: number; height?: number; color?: string; className?: string }): React.JSX.Element {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x = (i: number): number => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number): number => height - 3 - ((v - lo) / (hi - lo)) * (height - 6);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <polyline points={line} pathLength={1} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" className="sc-draw" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1] ?? 0)} r={2.2} fill={color} />
    </svg>
  );
}

/* ----------------------------------------------- minutes + accuracy (30 d) */

export function PracticeChart({ series, goal, height = 168 }: { series: { day: string; minutes: number; accuracy: number | null }[]; goal: number; height?: number }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 30;
  const padR = 34;
  const padB = 20;
  const top = 10;
  const ih = height - padB - top;
  const max = Math.max(goal * 1.25, ...series.map((s) => s.minutes), 10);
  const n = series.length;
  const cw = n > 0 ? (w - padL - padR) / n : 0;
  const bx = (i: number): number => padL + i * cw;
  const yM = (m: number): number => top + ih - (m / max) * ih;
  const yA = (a: number): number => top + ih - a * ih;
  const accPts = series.map((s, i) => (s.accuracy === null ? null : [bx(i) + cw / 2, yA(s.accuracy)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={yM(t)} y2={yM(t)} stroke="var(--sc-hair)" />
              <text x={padL - 6} y={yM(t) + 3} textAnchor="end" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                {t}
              </text>
            </g>
          ))}
          {[0.5, 1].map((a) => (
            <text key={a} x={w - padR + 6} y={yA(a) + 3} className="sc-mono" fontSize={9.5} fill="var(--sc-voice)">
              {Math.round(a * 100)}%
            </text>
          ))}
          <line x1={padL} x2={w - padR} y1={yM(goal)} y2={yM(goal)} stroke="var(--sc-ink)" strokeDasharray="2 4" opacity={0.45} />
          {series.map((s, i) => {
            const h = top + ih - yM(s.minutes);
            const met = s.minutes >= goal;
            return (
              <g key={s.day} onMouseEnter={() => setHover(i)}>
                <rect x={bx(i)} y={top} width={cw} height={ih} fill="transparent" />
                {s.minutes > 0 && <rect x={bx(i) + cw * 0.2} y={yM(s.minutes)} width={Math.max(2, cw * 0.6)} height={Math.max(1.5, h)} rx={1.5} fill={met ? 'var(--sc-ink)' : 'var(--sc-line-2)'} className="sc-grow" style={{ animationDelay: `${i * 14}ms` }} opacity={hover === null || hover === i ? 1 : 0.55} />}
              </g>
            );
          })}
          {accPts.length > 1 && <polyline points={accPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} pathLength={1} fill="none" stroke="var(--sc-voice)" strokeWidth={1.4} className="sc-draw" />}
          {accPts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={2.3} fill="var(--sc-raised)" stroke="var(--sc-voice)" strokeWidth={1.3} />
          ))}
          {series.map((s, i) =>
            i % 7 === (n - 1) % 7 ? (
              <text key={s.day} x={bx(i) + cw / 2} y={height - 5} textAnchor="middle" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                {shortDay(s.day)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={bx(hover) + cw / 2} x2={bx(hover) + cw / 2} y1={top} y2={top + ih} stroke="var(--sc-ink)" opacity={0.25} />}
        </svg>
      )}
      {hover !== null && series[hover] !== undefined && (
        <Tip x={bx(hover) + cw / 2} y={yM(series[hover]?.minutes ?? 0)} width={w}>
          {shortDay(series[hover]?.day ?? '')} · {fmtMinutes(series[hover]?.minutes ?? 0)}
          {series[hover]?.accuracy !== null && series[hover]?.accuracy !== undefined ? ` · ${Math.round((series[hover]?.accuracy ?? 0) * 100)}%` : ''}
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------ the week as an orbit */

/** Seven arcs around a dial: each day's minutes against the goal; today ticks. */
export function WeekDial({ week, goal, today, size = 188 }: { week: { day: string; minutes: number }[]; goal: number; today: number; size?: number }): React.JSX.Element {
  const c = size / 2;
  const R = size / 2 - 14;
  const gap = 0.07;
  const span = (Math.PI * 2) / 7;
  const arc = (r: number, a0: number, a1: number): string => {
    const p = (a: number): string => `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
    return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
  };
  const total = week.reduce((a, d) => a + d.minutes, 0);
  const frac = Math.min(1, today / Math.max(1, goal));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block overflow-visible">
      <circle cx={c} cy={c} r={R - 16} fill="none" stroke="var(--sc-hair)" strokeDasharray="1 5" />
      {week.map((d, i) => {
        const a0 = i * span + gap;
        const a1 = (i + 1) * span - gap;
        const k = Math.min(1, d.minutes / Math.max(1, goal));
        const isToday = i === week.length - 1;
        return (
          <g key={d.day}>
            <path d={arc(R, a0, a1)} stroke="var(--sc-line)" strokeWidth={7} fill="none" strokeLinecap="round" />
            {k > 0 && <path d={arc(R, a0, a0 + (a1 - a0) * k)} stroke={isToday ? 'var(--sc-voice)' : 'var(--sc-ink)'} strokeWidth={7} fill="none" strokeLinecap="round" pathLength={1} className="sc-draw" style={{ animationDelay: `${i * 60}ms` }} />}
            <text x={c + (R + 11) * Math.sin((a0 + a1) / 2)} y={c - (R + 11) * Math.cos((a0 + a1) / 2) + 3} textAnchor="middle" className="sc-mono" fontSize={9} fill={isToday ? 'var(--sc-ink)' : 'var(--sc-muted)'}>
              {weekday(d.day, 'narrow')}
            </text>
          </g>
        );
      })}
      {/* Today's needle */}
      <line x1={c} y1={c} x2={c + (R - 26) * Math.sin(frac * Math.PI * 2)} y2={c - (R - 26) * Math.cos(frac * Math.PI * 2)} stroke="var(--sc-ink)" strokeWidth={1.4} strokeLinecap="round" style={{ transition: 'all 600ms cubic-bezier(.2,.8,.2,1)' }} />
      <circle cx={c} cy={c} r={3} fill="var(--sc-ink)" />
      <text x={c} y={c + 24} textAnchor="middle" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
        {Math.round(total)} MIN · 7D
      </text>
    </svg>
  );
}

/* --------------------------------------------------- the calendar of dots */

export function HeatDots({ days, goal }: { days: { day: string; minutes: number }[]; goal: number }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const weeks: { day: string; minutes: number }[][] = [];
  // Columns are weeks, Monday on top; the first column may start mid-week.
  let col: { day: string; minutes: number }[] = [];
  days.forEach((d, i) => {
    const wd = (new Date(d.day + 'T12:00:00').getDay() + 6) % 7;
    if (i === 0) for (let k = 0; k < wd; k++) col.push({ day: '', minutes: -1 });
    col.push(d);
    if (wd === 6) {
      weeks.push(col);
      col = [];
    }
  });
  if (col.length > 0) weeks.push(col);
  const cell = 13;
  const W = weeks.length * cell;
  const H = 7 * cell;
  let idx = -1;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full overflow-visible">
        {weeks.map((wk, wi) =>
          wk.map((d, di) => {
            if (d.minutes < 0) return null;
            idx += 1;
            const me = idx;
            const k = Math.min(1, d.minutes / Math.max(1, goal));
            const r = d.minutes <= 0 ? 1.4 : 2 + k * 3.6;
            if (d.minutes <= 0) {
              // A day without singing: a hatch (rest is part of training).
              const cx = wi * cell + cell / 2;
              const cy = di * cell + cell / 2;
              return <line key={d.day} x1={cx - 2.6} y1={cy + 2.6} x2={cx + 2.6} y2={cy - 2.6} stroke="var(--sc-line-2)" strokeWidth={1.2} strokeLinecap="round" onMouseEnter={() => setHover(me)} />;
            }
            return (
              <circle
                key={d.day}
                cx={wi * cell + cell / 2}
                cy={di * cell + cell / 2}
                r={r}
                fill={d.minutes <= 0 ? 'var(--sc-line-2)' : k >= 1 ? 'var(--sc-ink)' : 'var(--sc-ink-2)'}
                opacity={d.minutes <= 0 ? 0.8 : 0.45 + k * 0.55}
                onMouseEnter={() => setHover(me)}
                className="sc-pop"
                style={{ animationDelay: `${Math.min(900, me * 5)}ms`, transformOrigin: `${wi * cell + cell / 2}px ${di * cell + cell / 2}px` }}
              />
            );
          }),
        )}
      </svg>
      {hover !== null && days[hover] !== undefined && (
        <div className="sc-mono pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-[4px] bg-[var(--sc-ink)] px-2 py-1 text-[11px] text-[var(--sc-page)]">
          {shortDay(days[hover]?.day ?? '')} · {fmtMinutes(days[hover]?.minutes ?? 0)}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- progress ring */

export function Ring({ value, size = 34, stroke = 3, color = 'var(--sc-ink)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }): React.JSX.Element {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sc-line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} opacity={v > 0 ? 1 : 0} style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(.2,.8,.2,1), opacity 200ms' }} />
      </svg>
      {children !== undefined && <span className="relative">{children}</span>}
    </span>
  );
}

/* ------------------------------------------------- the melody's contour */

/**
 * A song's melody as a hairline contour: each note a short level step at its
 * pitch, joined; with `band`, the singer's comfortable range behind it (the
 * melody moved by `shift`), so a tile shows at a glance whether it fits.
 */
export function Contour({ preview, height = 96, className, sweep, band, shift = 0 }: { preview: Preview | undefined; height?: number; className?: string; sweep?: boolean; band?: [number, number] | null | undefined; shift?: number }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const plo = (preview?.lo ?? 60) + shift;
  const phi = (preview?.hi ?? 72) + shift;
  const lo = Math.min(plo, band ? band[0] : plo) - 2;
  const hi = Math.max(phi, band ? band[1] : phi) + 2;
  const span = Math.max(12, hi - lo);
  const y = (m: number): number => height - 4 - ((m - lo) / span) * (height - 8);
  let d = '';
  if (preview !== undefined && w > 0) {
    preview.n.forEach((n, i) => {
      const x0 = n[0] * w;
      const x1 = Math.max(x0 + 1.5, (n[0] + n[1]) * w - 0.6);
      const yy = y(n[2] + shift);
      d += (i === 0 ? 'M' : 'L') + x0.toFixed(1) + ',' + yy.toFixed(1) + 'L' + x1.toFixed(1) + ',' + yy.toFixed(1);
    });
  }
  const over = band !== null && band !== undefined && (phi > band[1] || plo < band[0]);
  return (
    <div ref={ref} className={cn('relative w-full overflow-hidden', className)} style={{ height }}>
      {w > 0 && preview !== undefined && (
        <svg width={w} height={height} className="block">
          {band !== null && band !== undefined && <rect x={0} width={w} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--sc-voice)" opacity={0.07} />}
          {Array.from({ length: Math.floor(span / 12) + 1 }, (_, i) => {
            const c = Math.ceil(lo / 12) * 12 + i * 12;
            const yy = y(c);
            return yy > 0 && yy < height ? <line key={c} x1={0} x2={w} y1={yy} y2={yy} stroke="var(--sc-hair)" /> : null;
          })}
          <path d={d} fill="none" stroke={over ? 'var(--sc-warn)' : 'var(--sc-voice)'} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        </svg>
      )}
      {sweep === true && w > 0 && <span aria-hidden className="absolute bottom-0 top-0 w-px bg-[var(--sc-ink)]" style={{ animation: 'sc-sweep 1.6s ease-in-out both', ['--sc-sweep' as string]: `${w}px` }} />}
    </div>
  );
}

/* -------------------------------------------------------- range against voice */

const PCN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
function nm(m: number): string {
  const r = Math.round(m);
  return (PCN[((r % 12) + 12) % 12] ?? '') + String(Math.floor(r / 12) - 1);
}

/** A song's sung range (moved by its key) against the singer's comfortable range, on one line. */
export function RangeBar({ low, high, comf, className }: { low: number; high: number; comf: [number, number]; className?: string }): React.JSX.Element {
  const lo = Math.min(low, comf[0]) - 1;
  const hi = Math.max(high, comf[1]) + 1;
  const span = Math.max(1, hi - lo);
  const pc = (m: number): string => `${((m - lo) / span) * 100}%`;
  const over = high > comf[1] || low < comf[0];
  return (
    <div className={cn('relative h-3', className)} title={`Song ${nm(low)}–${nm(high)} · your comfortable range ${nm(comf[0])}–${nm(comf[1])}`}>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--sc-line)]" />
      <span className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[var(--sc-voice)] opacity-[0.16]" style={{ left: pc(comf[0]), width: `calc(${pc(comf[1])} - ${pc(comf[0])})` }} />
      <span className={cn('absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full', over ? 'bg-[var(--sc-warn)]' : 'bg-[var(--sc-ink)]')} style={{ left: pc(low), width: `calc(${pc(high)} - ${pc(low)})` }} />
      <span className={cn('absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full', over ? 'bg-[var(--sc-warn)]' : 'bg-[var(--sc-ink)]')} style={{ left: pc(low) }} />
      <span className={cn('absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full', over ? 'bg-[var(--sc-warn)]' : 'bg-[var(--sc-ink)]')} style={{ left: pc(high) }} />
    </div>
  );
}

/* ---------------------------------------------------------------- voice map */

/**
 * A phonetogram-lite: every voiced moment of the week as a faint dot at its
 * pitch (across) and loudness (up), over the comfortable range. The densest
 * cloud is where the voice lives (its tessitura).
 */
export function VoiceMap({ cells, comf, height = 150, passaggio }: { cells: number[][]; comf: [number, number] | null; height?: number; passaggio?: [number, number] | null | undefined }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const pitches = cells.map((c) => c[0] ?? 60);
  let lo = Math.min(comf ? comf[0] : 57, ...(pitches.length > 0 ? pitches : [57])) - 2;
  let hi = Math.max(comf ? comf[1] : 72, ...(pitches.length > 0 ? pitches : [72])) + 2;
  if (hi - lo < 14) {
    lo -= 3;
    hi += 3;
  }
  const max = Math.max(1, ...cells.map((c) => c[2] ?? 0));
  const padL = 4;
  const padB = 16;
  const x = (m: number): number => padL + ((m - lo) / (hi - lo)) * (w - padL - 4);
  const y = (b: number): number => height - padB - ((b + 0.5) / 10) * (height - padB - 6);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} className="block">
          {comf !== null && <rect x={x(comf[0] - 0.5)} y={4} width={Math.max(1, x(comf[1] + 0.5) - x(comf[0] - 0.5))} height={height - padB - 4} fill="var(--sc-voice)" opacity={0.06} />}
          {passaggio !== null && passaggio !== undefined && [passaggio[0], passaggio[1]].map((m) => <line key={m} x1={x(m)} x2={x(m)} y1={4} y2={height - padB} stroke="var(--sc-line-2)" strokeDasharray="2 3" />)}
          <line x1={padL} x2={w - 4} y1={height - padB + 0.5} y2={height - padB + 0.5} stroke="var(--sc-line)" />
          {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
            .filter((m) => m % 12 === 0)
            .map((m) => (
              <text key={m} x={x(m)} y={height - 3} textAnchor="middle" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                {nm(m)}
              </text>
            ))}
          {cells.map((c, i) => {
            const k = (c[2] ?? 0) / max;
            return <circle key={i} cx={x(c[0] ?? 60)} cy={y(c[1] ?? 5)} r={1.6 + k * 3.2} fill="var(--sc-voice)" opacity={0.12 + k * 0.6} />;
          })}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------- the tempo ladder */

/** Best clean tempo per day for each section, climbing toward 100%. */
export function Ladders({ ladders, height = 120 }: { ladders: { section: string; points: { day: string; best: number }[] }[]; height?: number }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const days = [...new Set(ladders.flatMap((l) => l.points.map((p) => p.day)))].sort();
  const padL = 30;
  const padR = 8;
  const top = 8;
  const bottom = 16;
  const ih = height - top - bottom;
  const x = (d: string): number => (days.length <= 1 ? padL + (w - padL - padR) / 2 : padL + (days.indexOf(d) / (days.length - 1)) * (w - padL - padR));
  const y = (v: number): number => top + ih - (Math.min(110, v) / 110) * ih;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible">
          {[50, 100].map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--sc-hair)" strokeDasharray={t === 100 ? '3 3' : undefined} />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                {t}%
              </text>
            </g>
          ))}
          {ladders.map((l, li) => {
            if (l.points.length === 0) return null;
            const pts = l.points.map((p) => [x(p.day), y(p.best)] as const);
            let dStep = `M ${pts[0]?.[0]} ${pts[0]?.[1]}`;
            for (let i = 1; i < pts.length; i++) dStep += ` H ${pts[i]?.[0]} V ${pts[i]?.[1]}`;
            const tone = `color-mix(in srgb, var(--sc-ink) ${100 - li * 12}%, var(--sc-line-2))`;
            return (
              <g key={l.section}>
                <path d={dStep} fill="none" stroke={tone} strokeWidth={1.4} pathLength={1} className="sc-draw" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={2.2} fill="var(--sc-raised)" stroke={tone} strokeWidth={1.2} />
                ))}
                {pts.length > 0 && (
                  <text x={(pts[pts.length - 1]?.[0] ?? 0) + 4} y={(pts[pts.length - 1]?.[1] ?? 0) - 4} className="sc-mono" fontSize={9} fill="var(--sc-muted)">
                    {l.section}
                  </text>
                )}
              </g>
            );
          })}
          {days.length > 0 && (
            <>
              <text x={padL} y={height - 3} className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                {shortDay(days[0] ?? '')}
              </text>
              {days.length > 1 && (
                <text x={w - padR} y={height - 3} textAnchor="end" className="sc-mono" fontSize={9.5} fill="var(--sc-muted)">
                  {shortDay(days[days.length - 1] ?? '')}
                </text>
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}

/** Errors per bar, as a row of small columns (the bars that need work stand out). */
export function BarErrors({ bars, height = 46 }: { bars: { bar: number; expected: number; errors: number }[]; height?: number }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = bars.length;
  const cw = n > 0 ? w / n : 0;
  const rate = (b: { expected: number; errors: number }): number => (b.expected > 0 ? Math.min(1, b.errors / b.expected) : 0);
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} className="block">
          {bars.map((b, i) => {
            const r = rate(b);
            const h = Math.max(2, r * (height - 14));
            return (
              <g key={b.bar} onMouseEnter={() => setHover(i)}>
                <rect x={i * cw} y={0} width={cw} height={height} fill="transparent" />
                <rect x={i * cw + cw * 0.15} y={height - 12 - h} width={Math.max(1.5, cw * 0.7)} height={h} rx={1} fill={r > 0.2 ? 'var(--sc-bad)' : r > 0.05 ? 'var(--sc-warn)' : 'var(--sc-line-2)'} className="sc-grow" />
                {(n <= 24 || i % Math.ceil(n / 16) === 0) && (
                  <text x={i * cw + cw / 2} y={height - 2} textAnchor="middle" className="sc-mono" fontSize={8.5} fill="var(--sc-muted)">
                    {b.bar}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && bars[hover] !== undefined && (
        <Tip x={hover * cw + cw / 2} y={10} width={w}>
          Bar {bars[hover]?.bar} · {bars[hover]?.errors} of {bars[hover]?.expected} notes off
        </Tip>
      )}
    </div>
  );
}

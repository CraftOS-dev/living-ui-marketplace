/**
 * Charts for the reports: the ring (a thick segmented ring with rounded
 * segment ends, labels written along the band and the total in the middle),
 * single-series columns with dashed guide lines and a right-hand axis, the
 * change against the period before as a small pill, and stat tiles. Text
 * wears ink tokens or a segment's own label color, never a bare bar color;
 * the same numbers are in the lists beside the charts.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { IconBadge } from './ui.tsx';

/* ------------------------------------------------------------------ ring */

export interface RingSlice {
  key: string;
  label: string;
  value: number;
  /** The value as money, written on the band and in the middle. */
  amount: string;
  /** Its share of the ring, in percent. */
  share: number;
  fill: string;
  text: string;
}

/** The ring's colors: the theme's five segment tones in order, then "Other". */
export function ringColor(index: number, other = false): { fill: string; text: string } {
  if (other) return { fill: 'var(--ps-seg-other)', text: 'var(--ps-seg-other-text)' };
  const n = ((index % 5) + 5) % 5;
  return { fill: `var(--ps-seg-${n})`, text: `var(--ps-seg-${n}-text)` };
}

const PAD = 2; // degrees between segments
const MIN_SWEEP = 4; // the smallest slice still shows as a piece of the ring

function pt(c: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.sin(a), c - r * Math.cos(a)];
}

function sector(c: number, a0: number, a1: number, ro: number, ri: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = pt(c, ro, a0);
  const [x1, y1] = pt(c, ro, a1);
  const [x2, y2] = pt(c, ri, a1);
  const [x3, y3] = pt(c, ri, a0);
  return `M${x0} ${y0} A${ro} ${ro} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${ri} ${ri} 0 ${large} 0 ${x3} ${y3} Z`;
}

/** An arc centered on `mid`, running so text on it reads upright there. */
function labelArc(c: number, r: number, mid: number, halfSpan: number): string {
  const norm = ((mid % 360) + 360) % 360;
  const reverse = norm > 90 && norm < 270;
  const a0 = mid - halfSpan;
  const a1 = mid + halfSpan;
  const [sx, sy] = pt(c, r, reverse ? a1 : a0);
  const [ex, ey] = pt(c, r, reverse ? a0 : a1);
  return `M${sx} ${sy} A${r} ${r} 0 0 ${reverse ? 0 : 1} ${ex} ${ey}`;
}

/** Rough rendered width of 12px bold text. */
function textWidth(s: string): number {
  return s.length * 7;
}

interface RingProps {
  slices: RingSlice[];
  centerValue: string;
  centerCaption: string;
  /** What the ring shows, for screen readers. */
  label: string;
  size?: number;
  /** The slice brought forward (from the legend beside the ring). */
  active?: string | null;
  onActive?: (key: string | null) => void;
}

/** The ring at most `size` wide, shrinking to fit narrow screens. */
export function Ring(props: RingProps): React.JSX.Element {
  const max = props.size ?? 300;
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(max);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? max;
      setWidth(Math.max(200, Math.min(max, Math.floor(w))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return (
    <div ref={box} className="w-full" style={{ maxWidth: max }}>
      <RingDrawing {...props} size={width} />
    </div>
  );
}

function RingDrawing({ slices, centerValue, centerCaption, label, size = 300, active = null, onActive }: RingProps): React.JSX.Element {
  const uid = useId().replace(/:/g, '');
  const [own, setOwn] = useState<string | null>(null);
  const hot = active ?? own;
  const setHot = (key: string | null): void => {
    setOwn(key);
    onActive?.(key);
  };
  const c = size / 2;
  const ro = c - 6;
  const band = Math.round(size * 0.135);
  const ri = ro - band;
  const rm = (ro + ri) / 2;
  const crMax = Math.min(10, band / 2 - 2);
  const toDeg = 180 / Math.PI;

  const total = slices.reduce((s, x) => s + x.value, 0);
  const n = slices.length;
  const avail = 360 - PAD * n;
  // Every slice gets at least a sliver; the rest share the ring by value.
  const raw = slices.map((s) => (total > 0 ? (s.value / total) * avail : 0));
  const small = raw.filter((r) => r < MIN_SWEEP).length;
  const bigTotal = raw.filter((r) => r >= MIN_SWEEP).reduce((a, b) => a + b, 0);
  const scale = bigTotal > 0 ? (avail - small * MIN_SWEEP) / bigTotal : 1;
  const sweeps = raw.map((r) => (r < MIN_SWEEP ? MIN_SWEEP : r * scale));

  let cursor = PAD / 2;
  const segs = slices.map((s, i) => {
    const a0 = cursor;
    const a1 = cursor + (sweeps[i] ?? 0);
    cursor = a1 + PAD;
    // Corner rounding shrinks with the segment so small ones stay ring pieces.
    const arcLen = rm * (((a1 - a0) * Math.PI) / 180);
    const cr = Math.max(2, Math.min(crMax, arcLen / 5));
    // Name and amount at the two ends of a long segment, one combined label
    // when it fits, the amount alone when only that fits, else none.
    const room = arcLen - cr * 2;
    const sweep = a1 - a0;
    const combined = `${s.label} · ${s.amount}`;
    const labels: { id: string; mid: number; text: string }[] = [];
    if (sweep >= 110 && textWidth(s.label) + textWidth(s.amount) + 48 < room) {
      labels.push({ id: `${uid}-${i}-n`, mid: a0 + sweep * 0.24, text: s.label });
      labels.push({ id: `${uid}-${i}-a`, mid: a0 + sweep * 0.76, text: s.amount });
    } else if (textWidth(combined) + 18 < room) {
      labels.push({ id: `${uid}-${i}`, mid: (a0 + a1) / 2, text: combined });
    } else if (textWidth(s.amount) + 14 < room) {
      labels.push({ id: `${uid}-${i}`, mid: (a0 + a1) / 2, text: s.amount });
    }
    return { s, a0, a1, cr, labels };
  });

  const shown = hot !== null ? slices.find((x) => x.key === hot) : undefined;

  return (
    <div className="relative mx-auto shrink-0 select-none" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="ps-draw overflow-visible" role="img" aria-label={label}>
        <defs>
          {segs.flatMap(({ labels }) => labels.map((l) => <path key={l.id} id={l.id} d={labelArc(c, rm, l.mid, Math.min(89, ((textWidth(l.text) + 24) / rm) * toDeg))} fill="none" />))}
        </defs>

        {n === 0 && <circle cx={c} cy={c} r={rm} fill="none" stroke="var(--ps-sand-2)" strokeWidth={band} />}

        {segs.map(({ s, a0, a1, cr, labels }) => {
          const inset = (cr / rm) * toDeg;
          return (
            <g
              key={s.key}
              style={{ transformOrigin: `${c}px ${c}px`, transform: hot === s.key ? 'scale(1.035)' : 'scale(1)', transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)' }}
              onMouseEnter={() => setHot(s.key)}
              onMouseLeave={() => setHot(null)}
            >
              <path d={sector(c, a0 + inset, a1 - inset, ro - cr, ri + cr)} fill={s.fill} stroke={s.fill} strokeWidth={cr * 2} strokeLinejoin="round">
                <title>{`${s.label}: ${s.amount} (${s.share}%)`}</title>
              </path>
              {labels.map((l) => (
                <text key={l.id} fill={s.text} fontSize={12} fontWeight={700} dominantBaseline="central" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                  <textPath href={`#${l.id}`} startOffset="50%">
                    {l.text}
                  </textPath>
                </text>
              ))}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[22%] text-center">
        <span className="num max-w-full truncate text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{shown !== undefined ? shown.amount : centerValue}</span>
        <span className="mt-1 max-w-full truncate text-[12px] font-semibold text-[var(--ps-ink-2)]">{shown !== undefined ? `${shown.label} · ${shown.share}%` : centerCaption}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- columns */

export interface Column {
  key: string;
  label: string;
  /** Shorter tick label; empty hides the tick. */
  tick: string;
  value: number;
  /** What the tooltip says about this column. */
  detail: string;
  /** The current hour, or today: drawn in the accent. */
  now?: boolean;
}

const AXIS = 52; // px kept on the right for the guide amounts

/** A round guide step at or above `raw`: 1, 2, 5 (and 25, 250...) times a power of ten. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && p >= 10 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * One series as round-ended columns. `unit` is how many of the values make
 * one whole of what `format` prints (100 for cents), so the guides land on
 * round amounts.
 */
export function ColumnChart({ columns, format, height = 190, label, unit = 1 }: { columns: Column[]; format: (v: number) => string; height?: number; label: string; unit?: number }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...columns.map((c) => c.value));
  const step = niceStep(peak / 3 / unit) * unit;
  const top = Math.max(step * 3, 1);
  const lines = [0, 1, 2, 3].map((k) => k * step);
  const active = hover !== null ? columns[hover] : undefined;
  const at = hover !== null ? (hover + 0.5) / Math.max(1, columns.length) : 0;
  return (
    <figure className="relative" aria-label={label}>
      <div className="relative" style={{ height }}>
        {lines.map((v) => (
          <div key={v} aria-hidden className="absolute inset-x-0 flex items-center gap-3" style={{ bottom: `${(v / top) * 100}%`, transform: 'translateY(50%)' }}>
            <div className="h-0 flex-1 border-t border-dashed border-[var(--ps-line)]" />
            <span className="num w-10 shrink-0 text-right text-[12px] leading-none text-[var(--ps-muted)]">{format(v)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 left-0 flex items-end justify-between gap-[3px] sm:gap-1.5" style={{ right: AXIS }}>
          {columns.map((c, i) => {
            const on = hover === i;
            return (
              <button
                key={c.key}
                type="button"
                aria-label={`${c.label}: ${c.detail}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((k) => (k === i ? null : k))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((k) => (k === i ? null : k))}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-full outline-none"
              >
                {c.value > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'ps-grow block w-full max-w-[16px] rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ink)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--ps-card)]',
                      c.now === true ? 'bg-[var(--ps-accent)]' : on ? 'bg-[var(--ps-ink-2)]' : 'bg-[var(--ps-ink)]',
                    )}
                    style={{ height: `${Math.max(2, (c.value / top) * 100)}%`, minHeight: 6, animationDelay: `${Math.min(i * 14, 420)}ms` }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {active !== undefined && (
          <div
            role="status"
            className="ps-on-ink pointer-events-none absolute -top-2 z-10 whitespace-nowrap rounded-[14px] bg-[var(--ps-ink)] px-3 py-2 text-center text-[var(--ps-shell)]"
            style={{ left: `calc((100% - ${AXIS}px) * ${at})`, transform: `translate(${-at * 100}%, -100%)` }}
          >
            <p className="text-[12px] font-semibold">{active.label}</p>
            <p className="num text-[13px] font-bold">{active.detail}</p>
          </div>
        )}
      </div>
      <div aria-hidden className="mt-2 flex justify-between gap-[3px] sm:gap-1.5" style={{ paddingRight: AXIS }}>
        {columns.map((c) => (
          <span key={c.key} className="flex h-4 min-w-0 flex-1 justify-center">
            <span className="num whitespace-nowrap text-[12px] leading-4 text-[var(--ps-muted)]">{c.tick}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------- change */

/** How a number moved against the period before, in words. */
function changeOf(now: number, before: number | null, upIsGood: boolean): { text: string; good: boolean | null; icon: LucideIcon | null } | null {
  if (before === null) return null;
  if (before === 0 && now === 0) return null;
  if (before === 0) return { text: 'None the period before', good: null, icon: null };
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const up = pct > 0;
  return {
    text: pct === 0 ? 'Same as before' : `${up ? '+' : ''}${pct}% on the period before`,
    good: pct === 0 ? null : up === upIsGood,
    icon: pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight,
  };
}

/**
 * The change against the period before as a small pill; nothing when there
 * is nothing to compare. `surface` is what it sits on: a white card, the
 * dark card, or a row inside the dark card.
 */
export function Change({ now, before, upIsGood = true, surface = 'card', className }: { now: number; before: number | null; upIsGood?: boolean; surface?: 'card' | 'dark' | 'dark-row'; className?: string }): React.JSX.Element | null {
  const ch = changeOf(now, before, upIsGood);
  if (ch === null) return null;
  const Icon = ch.icon;
  const dark = surface !== 'card';
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold',
        !dark && ch.good === null && 'bg-[var(--ps-row)] text-[var(--ps-ink-2)]',
        !dark && ch.good === true && 'bg-[var(--ps-green)]/14 text-[var(--ps-green-text)]',
        !dark && ch.good === false && 'bg-[var(--ps-red)]/14 text-[var(--ps-red-text)]',
        dark && ch.good === null && (surface === 'dark' ? 'bg-[var(--ps-dark-2)] text-[var(--ps-muted)]' : 'bg-[var(--ps-dark)] text-[var(--ps-muted)]'),
        dark && ch.good === true && 'bg-[var(--ps-green)]/22 text-[var(--ps-on-dark)]',
        dark && ch.good === false && 'bg-[var(--ps-red)]/22 text-[var(--ps-on-dark)]',
        className,
      )}
    >
      {Icon !== null && <Icon size={13} aria-hidden className="shrink-0" />}
      <span className="truncate">{ch.text}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ tile */

/** A stat tile: a white card with a label, the number, and how it moved against the period before. */
export function StatTile({
  label,
  value,
  now,
  before,
  upIsGood = true,
  hint,
  icon,
  className,
}: {
  label: string;
  value: string;
  now: number;
  before: number | null;
  upIsGood?: boolean;
  hint?: string | undefined;
  icon?: LucideIcon;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn('ps-rise ps-on-card flex min-w-0 items-start gap-4 rounded-[24px] bg-[var(--ps-card)] p-5 text-[var(--ps-ink)] md:p-6', className)}>
      {icon !== undefined && <IconBadge icon={icon} size={44} />}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <h2 className="max-w-full truncate text-[13px] font-semibold text-[var(--ps-ink-2)]">{label}</h2>
        <p className="num max-w-full truncate text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{value}</p>
        <Change now={now} before={before} upIsGood={upIsGood} className="mt-1" />
        {hint !== undefined && <p className="max-w-full text-[12px] leading-4 text-[var(--ps-muted)]">{hint}</p>}
      </div>
    </section>
  );
}

/**
 * Spending ring: a thick segmented ring with rounded segment ends, labels
 * written along the band (each turned to read upright where it sits), an
 * open gap at the top left holding round-cornered action chips turned along
 * the ring, and the total in the middle. Hovering a segment brings it
 * forward and puts its numbers in the middle; clicking opens its expenses.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  amount: string;
  share: number;
  fill: string;
  text: string;
}

export interface DonutChip {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

const GAP_START = 282; // the ring runs clockwise from 0 (12 o'clock) to here
const PAD = 2; // degrees between segments

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

/** The ring at most `size` wide, shrinking to fit narrow screens. */
export function Donut(props: DonutProps): React.JSX.Element {
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
      <Ring {...props} size={width} />
    </div>
  );
}

interface DonutProps {
  slices: DonutSlice[];
  centerValue: string;
  centerCaption: string;
  chips?: DonutChip[];
  size?: number;
  onPick?: (key: string) => void;
  trackColor?: string;
}

function Ring({
  slices,
  centerValue,
  centerCaption,
  chips = [],
  size = 300,
  onPick,
  trackColor = 'color-mix(in srgb, var(--iv-card) 55%, transparent)',
}: {
  slices: DonutSlice[];
  centerValue: string;
  centerCaption: string;
  chips?: DonutChip[];
  size?: number;
  onPick?: (key: string) => void;
  trackColor?: string;
}): React.JSX.Element {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const c = size / 2;
  const ro = c - 4;
  const band = Math.round(size * 0.135);
  const ri = ro - band;
  const rm = (ro + ri) / 2;
  const crMax = Math.min(10, band / 2 - 2);
  const toDeg = 180 / Math.PI;

  const total = slices.reduce((s, x) => s + x.value, 0);
  const n = slices.length;
  const avail = GAP_START - PAD * Math.max(0, n - 1);
  // Every slice gets at least a sliver; the rest share the ring by value.
  const minSweep = 4;
  const raw = slices.map((s) => (total > 0 ? (s.value / total) * avail : 0));
  const small = raw.filter((r) => r < minSweep).length;
  const bigTotal = raw.filter((r) => r >= minSweep).reduce((a, b) => a + b, 0);
  const scale = bigTotal > 0 ? (avail - small * minSweep) / bigTotal : 1;
  const sweeps = raw.map((r) => (r < minSweep ? minSweep : r * scale));

  let cursor = 0;
  const segs = slices.map((s, i) => {
    const a0 = cursor;
    const a1 = cursor + (sweeps[i] ?? 0);
    cursor = a1 + PAD;
    // Corner rounding shrinks with the segment so small ones stay ring pieces.
    const arcLen = rm * (((a1 - a0) * Math.PI) / 180);
    const cr = Math.max(2, Math.min(crMax, arcLen / 5));
    return { s, a0, a1, cr, arcLen };
  });

  // Labels: name and amount at the two ends of a long segment, one combined
  // label when it fits, the amount alone when only that fits, else none.
  const labels: { key: string; seg: string; mid: number; text: string; color: string }[] = [];
  for (const { s, a0, a1, cr, arcLen } of segs) {
    const room = arcLen - cr * 2;
    const sweep = a1 - a0;
    const combined = `${s.label} · ${s.amount}`;
    if (sweep >= 110 && textWidth(s.label) + textWidth(s.amount) + 48 < room) {
      labels.push({ key: `${s.key}-n`, seg: s.key, mid: a0 + sweep * 0.24, text: s.label, color: s.text });
      labels.push({ key: `${s.key}-a`, seg: s.key, mid: a0 + sweep * 0.76, text: s.amount, color: s.text });
    } else if (textWidth(combined) + 18 < room) {
      labels.push({ key: s.key, seg: s.key, mid: (a0 + a1) / 2, text: combined, color: s.text });
    } else if (textWidth(s.amount) + 14 < room) {
      labels.push({ key: s.key, seg: s.key, mid: (a0 + a1) / 2, text: s.amount, color: s.text });
    }
  }

  const hovered = hover !== null ? slices.find((x) => x.key === hover) : undefined;
  const trackCr = crMax;

  return (
    <div className="relative mx-auto shrink-0 select-none" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="iv-draw overflow-visible" role="img" aria-label={`${centerCaption}: ${centerValue}`}>
        <defs>
          {labels.map((l) => (
            <path key={l.key} id={`${uid}-${l.key}`} d={labelArc(c, rm, l.mid, Math.min(89, ((textWidth(l.text) + 24) / rm) * toDeg))} fill="none" />
          ))}
        </defs>

        {n === 0 && (
          <path
            d={sector(c, (trackCr / rm) * toDeg, GAP_START - (trackCr / rm) * toDeg, ro - trackCr, ri + trackCr)}
            fill={trackColor}
            stroke={trackColor}
            strokeWidth={trackCr * 2}
            strokeLinejoin="round"
          />
        )}

        {segs.map(({ s, a0, a1, cr }) => {
          const inset = (cr / rm) * toDeg;
          const d = sector(c, a0 + inset, a1 - inset, ro - cr, ri + cr);
          const dim = hover !== null && hover !== s.key;
          return (
            <path
              key={s.key}
              d={d}
              fill={s.fill}
              stroke={s.fill}
              strokeWidth={cr * 2}
              strokeLinejoin="round"
              className={cn('transition-opacity duration-200', onPick !== undefined && 'cursor-pointer')}
              style={{ opacity: dim ? 0.35 : 1 }}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(s.key)}
            >
              <title>{`${s.label}: ${s.amount} (${s.share}%)`}</title>
            </path>
          );
        })}

        {labels.map((l) => (
          <text
            key={l.key}
            fill={l.color}
            fontSize={12}
            fontWeight={700}
            dominantBaseline="central"
            textAnchor="middle"
            style={{ opacity: hover !== null && hover !== l.seg ? 0.35 : 1, pointerEvents: 'none', transition: 'opacity 200ms' }}
          >
            <textPath href={`#${uid}-${l.key}`} startOffset="50%">
              {l.text}
            </textPath>
          </text>
        ))}
      </svg>

      {chips.slice(0, 3).map((chip, i) => {
        const span = 360 - GAP_START;
        const deg = GAP_START + (span / (chips.length + 1)) * (i + 1);
        const [x, y] = pt(c, rm, deg);
        const Icon = chip.icon;
        return (
          <button
            key={chip.label}
            type="button"
            onClick={chip.onClick}
            aria-label={chip.label}
            title={chip.label}
            className="absolute flex size-9 items-center justify-center rounded-[12px] bg-[var(--iv-card)] text-[var(--iv-ink)] shadow-[0_6px_14px_-8px_rgba(29,28,26,0.5)] transition-transform hover:scale-110"
            style={{ left: x - 18, top: y - 18, transform: `rotate(${deg}deg)` }}
          >
            <Icon size={16} strokeWidth={2} />
          </button>
        );
      })}

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{hovered !== undefined ? hovered.amount : centerValue}</span>
        <span className="mt-1 max-w-[9rem] truncate text-[12px] font-semibold text-[var(--iv-ink-2)]">{hovered !== undefined ? `${hovered.label} · ${hovered.share}%` : centerCaption}</span>
      </div>
    </div>
  );
}

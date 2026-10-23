/**
 * Small drawings: the reading ring (unread, reading, read) and papers by
 * year. SVG, colors from --ro-*.
 */
import { useEffect, useRef, useState } from 'react';
import { num } from '../lib/format.ts';

export interface RingSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

/** A segmented ring with the total in the middle; hovering a slice shows its number. */
export function Ring({ slices, size = 148, stroke = 16, center, sub, onPick }: { slices: RingSlice[]; size?: number; stroke?: number; center: string; sub: string; onPick?: (key: string) => void }): React.JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const gap = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 0.04 : 0;
  let a = 0;
  const shown = slices.find((s) => s.key === hover);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ro-track)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((s) => {
            if (s.value <= 0) return null;
            const span = (s.value / total) * Math.PI * 2;
            const a0 = a + gap / 2;
            const a1 = a + span - gap / 2;
            a += span;
            const full = span >= Math.PI * 2 - 0.001;
            return full ? (
              <circle key={s.key} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={stroke} />
            ) : (
              <path
                key={s.key}
                d={arc(c, c, r, a0, Math.max(a0 + 0.01, a1))}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === s.key ? stroke + 4 : stroke}
                strokeLinecap="butt"
                className={onPick ? 'cursor-pointer transition-[stroke-width]' : 'transition-[stroke-width]'}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick?.(s.key)}
              />
            );
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[26px] font-bold leading-8">{shown ? num(shown.value) : center}</span>
        <span className="text-[12px] text-[var(--ro-muted)]">{shown ? shown.label : sub}</span>
      </div>
    </div>
  );
}

/** Papers by publication year, as thin bars (the last decades). */
export function YearBars({ years, height = 56 }: { years: { year: number; n: number }[]; height?: number }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(240);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(120, Math.floor(e[0]?.contentRect.width ?? 240))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const now = new Date().getFullYear();
  const min = years.length > 0 ? Math.max(Math.min(...years.map((y) => y.year)), now - 40) : now - 10;
  const span = Math.max(1, now - min + 1);
  const bins: { year: number; n: number }[] = [];
  for (let y = min; y <= now; y++) bins.push({ year: y, n: years.filter((x) => x.year === y).reduce((a, x) => a + x.n, 0) + (y === min ? years.filter((x) => x.year < min).reduce((a, x) => a + x.n, 0) : 0) });
  const max = Math.max(1, ...bins.map((b) => b.n));
  const bw = width / span;
  const [hover, setHover] = useState<number | null>(null);
  const h = bins.find((b) => b.year === hover);
  return (
    <div ref={box} className="relative w-full [contain:inline-size]">
      <svg width={width} height={height} aria-label="Papers by year">
        {bins.map((b, i) => {
          const bh = b.n === 0 ? 1 : Math.max(2, (b.n / max) * (height - 4));
          return <rect key={b.year} x={i * bw + 0.5} y={height - bh} width={Math.max(1, bw - 1.5)} height={bh} rx={1} fill={b.year === hover ? 'var(--ro-accent)' : b.n === 0 ? 'var(--ro-track)' : 'var(--ro-ink-2)'} onMouseEnter={() => setHover(b.year)} onMouseLeave={() => setHover(null)} />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[12px] text-[var(--ro-muted)]">
        <span>{h ? `${h.year}: ${num(h.n)}` : min}</span>
        <span>{now}</span>
      </div>
    </div>
  );
}

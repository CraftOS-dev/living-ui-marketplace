/**
 * The balance of a life as a spider chart: one spoke per part of life, the
 * filled shape reaching out as far as each part is going well (0 at the
 * middle, 1 at the rim). A part without enough to say yet sits as an open
 * dot at the middle. Each spoke ends in its drawing; tap it to go there.
 * On a narrow screen a spoke shows just the drawing and the score.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../kit/index.ts';
import { AREA_NAMES, AreaArt } from './art.tsx';
import type { AreaKind } from './art.tsx';
import { kindColor } from './bits.tsx';

export interface RadarPoint {
  kind: AreaKind;
  score: number | null;
}

export function Radar({ points, onPick }: { points: RadarPoint[]; onPick: (k: AreaKind) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(560);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const set = (): void => setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = Math.min(w, 560);
  const c = size / 2;
  const small = size < 380;
  const label = small ? 30 : 40;
  const R = c - label - (small ? 18 : 30);
  const n = Math.max(3, points.length);
  const at = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * R * r, c + Math.sin(a) * R * r];
  };
  const shape = points.map((p, i) => at(i, Math.max(0.04, p.score ?? 0)));
  const ring = (r: number): string => points.map((_, i) => at(i, r).join(',')).join(' ');
  return (
    <div ref={box} className="flex w-full justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0" role="img" aria-label="How each part of life is going">
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <polygon key={r} points={ring(r)} fill={r === 1 ? 'var(--lo-sunk)' : 'none'} stroke="var(--lo-line)" strokeWidth={1} strokeDasharray={r === 1 ? undefined : '3 5'} />
          ))}
          {points.map((p, i) => {
            const [x, y] = at(i, 1);
            return <line key={p.kind} x1={c} y1={c} x2={x} y2={y} stroke="var(--lo-line)" strokeWidth={1} />;
          })}
          <polygon points={shape.map((s) => s.join(',')).join(' ')} fill="var(--lo-moss-soft)" stroke="var(--lo-moss)" strokeWidth={2.5} strokeLinejoin="round" opacity={0.92} />
          {points.map((p, i) => {
            const [x, y] = shape[i] as [number, number];
            return p.score === null ? <circle key={p.kind} cx={x} cy={y} r={5} fill="var(--lo-card)" stroke="var(--lo-line)" strokeWidth={2} /> : <circle key={p.kind} cx={x} cy={y} r={6} fill={kindColor(p.kind)} stroke="var(--lo-card)" strokeWidth={2} />;
          })}
        </svg>
        {points.map((p, i) => {
          const [x, y] = at(i, 1);
          const dx = x - c;
          const dy = y - c;
          const d = Math.max(1, Math.hypot(dx, dy));
          const lx = x + (dx / d) * (label * 0.75 + 6);
          const ly = y + (dy / d) * (label * 0.75 + 6);
          return (
            <button key={p.kind} type="button" onClick={() => onPick(p.kind)} title={p.score === null ? `${AREA_NAMES[p.kind]}: not enough yet` : `${AREA_NAMES[p.kind]}: ${Math.round(p.score * 100)}%`} className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: lx, top: ly }}>
              <span className="transition-transform group-hover:scale-110">
                <AreaArt kind={p.kind} size={label} />
              </span>
              <span className={cn('w-max max-w-[124px] text-center leading-4 rounded-[var(--lo-r-xs)] px-1 text-[12px] font-bold', p.score === null ? 'text-[var(--lo-muted)]' : 'text-[var(--lo-ink)]')}>
                {!small && AREA_NAMES[p.kind]}
                {p.score !== null && <span className={cn('num text-[var(--lo-muted)]', !small && 'ml-1')}>{Math.round(p.score * 100)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

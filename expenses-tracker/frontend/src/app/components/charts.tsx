/**
 * Charts: column bars with dashed gridlines and a right-hand axis, the dark
 * spending calendar, the budget gauge and the month-pace bar.
 */
import { useState } from 'react';
import { cn } from '../../kit/index.ts';
import { today } from '../lib/dates.ts';
import { money } from '../lib/money.ts';

/* ------------------------------------------------------------------ bars */

export interface BarItem {
  key: string;
  label: string;
  /** Shorter label for phones (e.g. "O" for "Oct"). */
  short?: string;
  value: number;
  ghost?: number;
  tone: 'normal' | 'today' | 'over' | 'future' | 'selected';
  tip: string;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

export function Bars({
  items,
  currency,
  decimals,
  height = 200,
  onPick,
  maxBar = 16,
}: {
  items: BarItem[];
  currency: string;
  decimals: number;
  height?: number;
  onPick?: (key: string) => void;
  maxBar?: number;
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...items.map((i) => Math.max(i.value, i.ghost ?? 0)));
  const unit = 10 ** decimals;
  const step = niceStep(peak / 3 / unit) * unit;
  const top = Math.max(step * 3, 1);
  const lines = [0, 1, 2, 3].map((k) => k * step);
  const h = hover !== null ? items[hover] : undefined;

  return (
    <div className="relative">
      <div className="relative" style={{ height }}>
        {lines.map((v) => (
          <div key={v} className="absolute inset-x-0 flex items-center gap-3" style={{ bottom: `${(v / top) * 100}%`, transform: 'translateY(50%)' }}>
            <div className="h-0 flex-1 border-t border-dashed border-[var(--et-line)]" />
            <span className="num w-12 text-right text-[12px] text-[var(--et-muted)]">{money(v, currency, true)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 left-0 right-[60px] flex items-end justify-between gap-[3px] sm:gap-1.5" onMouseLeave={() => setHover(null)}>
          {items.map((it, i) => {
            const vPct = (it.value / top) * 100;
            const gPct = it.ghost !== undefined ? (it.ghost / top) * 100 : 0;
            return (
              <button
                key={it.key}
                type="button"
                disabled={it.tone === 'future' || onPick === undefined}
                onClick={() => onPick?.(it.key)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={it.tip}
                className="group relative flex h-full flex-1 items-end justify-center disabled:cursor-default"
              >
                <span className="relative flex h-full w-full items-end justify-center" style={{ maxWidth: maxBar }}>
                  {gPct > 0 && it.tone !== 'future' && (
                    <span className="absolute bottom-0 w-full rounded-t-[6px] bg-[var(--et-sand-2)]" style={{ height: `${gPct}%` }} />
                  )}
                  {it.value > 0 && (
                    <span
                      className={cn(
                        'et-grow relative w-full rounded-t-[6px] transition-colors',
                        it.tone === 'today' && 'bg-[var(--et-accent)]',
                        it.tone === 'over' && 'bg-[var(--et-ink)]',
                        it.tone === 'selected' && 'bg-[var(--et-accent)]',
                        it.tone === 'normal' && 'bg-[var(--et-ink)] group-hover:bg-[var(--et-ink-2)]',
                      )}
                      style={{ height: `${Math.max(2, vPct)}%`, animationDelay: `${Math.min(i * 14, 420)}ms` }}
                    >
                      <span className={cn('absolute inset-x-0 top-0 rounded-full', it.tone === 'over' ? 'h-1 bg-[var(--et-red)]' : 'h-[2px] bg-[var(--et-card)]/60')} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {h !== undefined && hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[var(--et-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--et-shell)]"
            style={{ left: `calc((100% - 60px) * ${(hover + 0.5) / items.length})` }}
          >
            {h.tip}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between gap-[3px] pr-[60px] sm:gap-1.5">
        {items.map((it) => (
          <span key={it.key} className="min-w-0 flex-1 text-center text-[12px] text-[var(--et-muted)]">
            {it.short !== undefined ? (
              <>
                <span className="sm:hidden">{it.short}</span>
                <span className="hidden sm:inline">{it.label}</span>
              </>
            ) : (
              it.label
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- calendar */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function SpendCalendar({
  month,
  days,
  currency,
  onPick,
}: {
  month: string;
  days: { date: string; total_minor: number }[];
  currency: string;
  onPick: (day: string) => void;
}): React.JSX.Element {
  const t = today();
  const first = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const ranked = days
    .filter((d) => d.total_minor > 0)
    .sort((a, b) => b.total_minor - a.total_minor)
    .slice(0, 3)
    .map((d) => d.date);
  const cells: ({ date: string; total_minor: number } | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  return (
    <div>
      <div className="grid grid-cols-7 gap-y-2 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-1 text-[12px] font-semibold text-[var(--et-on-dark-muted)]">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const n = Number(d.date.slice(8, 10));
          const future = d.date > t;
          const top3 = ranked.includes(d.date);
          const spent = d.total_minor > 0;
          return (
            <span key={d.date} className="flex justify-center">
              <button
                type="button"
                disabled={future}
                onClick={() => onPick(d.date)}
                title={spent ? `${d.date}: ${money(d.total_minor, currency)}` : `${d.date}: nothing spent`}
                className={cn(
                  'num flex size-8 items-center justify-center rounded-full text-[13px] font-semibold transition-transform hover:scale-110 disabled:hover:scale-100 sm:size-9',
                  top3 && 'bg-[var(--et-accent)] text-[var(--et-on-accent)]',
                  !top3 && spent && 'bg-[var(--et-dark-2)] text-[var(--et-on-dark)]',
                  !spent && !future && 'text-[var(--et-on-dark)]/85',
                  future && 'text-[var(--et-on-dark-muted)]/60',
                  d.date === t && 'ring-2 ring-[var(--et-on-dark)]/70 ring-offset-2 ring-offset-[var(--et-dark)]',
                )}
              >
                {n}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[var(--et-on-dark-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full ring-2 ring-[var(--et-on-dark)]/70" /> Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--et-dark-2)] ring-1 ring-[var(--et-on-dark-muted)]/40" /> Spent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--et-accent)]" /> Biggest days
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- gauge */

export function Gauge({ ratio, center, caption, bubble, size = 168 }: { ratio: number; center: string; caption: string; bubble?: string | undefined; size?: number }): React.JSX.Element {
  const c = size / 2;
  const r = c - 16;
  const startA = -125;
  const sweep = 250;
  const p = Math.max(0, Math.min(1, ratio));
  const endA = startA + sweep * p;
  const over = ratio > 1;
  const pt = (deg: number, rad: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [c + rad * Math.sin(a), c - rad * Math.cos(a)];
  };
  const arcD = (a0: number, a1: number): string => {
    const [x0, y0] = pt(a0, r);
    const [x1, y1] = pt(a1, r);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [bx, by] = pt(endA, r);
  const ticks = Array.from({ length: 26 }, (_, i) => startA + (sweep / 25) * i);
  return (
    <div className="relative" style={{ width: size, height: size * 0.86 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="overflow-visible">
        <defs>
          <linearGradient id="et-gauge" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="var(--et-accent-soft)" />
            <stop offset="100%" stopColor="var(--et-accent)" />
          </linearGradient>
        </defs>
        {ticks.map((a) => {
          const [x, y] = pt(a, r + 11);
          return <circle key={a} cx={x} cy={y} r={1.4} fill="var(--et-line)" />;
        })}
        <path d={arcD(startA, startA + sweep)} fill="none" stroke="var(--et-line)" strokeWidth={12} strokeLinecap="round" />
        {p > 0 && <path d={arcD(startA, Math.max(startA + 0.5, endA))} fill="none" stroke={over ? 'var(--et-red)' : 'url(#et-gauge)'} strokeWidth={12} strokeLinecap="round" />}
        {p > 0 && <circle cx={bx} cy={by} r={5} fill="var(--et-card)" stroke={over ? 'var(--et-red)' : 'var(--et-accent)'} strokeWidth={3} />}
      </svg>
      {bubble !== undefined && p > 0 && (
        <span
          className="num absolute -translate-x-1/2 -translate-y-[150%] whitespace-nowrap rounded-full bg-[var(--et-card)] px-2 py-0.5 text-[12px] font-bold shadow-[0_6px_16px_-8px_rgba(29,28,26,0.45)]"
          style={{ left: bx, top: by }}
        >
          {bubble}
        </span>
      )}
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: c - 22 }}>
        <span className="text-[12px] font-semibold text-[var(--et-muted)]">{caption}</span>
        <span className="num text-[15px] font-extrabold">{center}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- pace bar */

export function PaceBar({ ratio, bubble }: { ratio: number; bubble: string }): React.JSX.Element {
  const p = Math.max(0, Math.min(1, ratio));
  const over = ratio > 1;
  return (
    <div className="relative pt-9">
      <span
        className="num absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--et-ink)] px-2.5 py-1 text-[12px] font-bold text-[var(--et-shell)]"
        style={{ left: `clamp(28px, ${p * 100}%, calc(100% - 28px))` }}
      >
        {bubble}
      </span>
      <div className="relative flex h-3 items-center">
        <div className="absolute inset-0 flex items-center justify-between px-1">
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className="size-1 rounded-full bg-[var(--et-line)]" />
          ))}
        </div>
        <div
          className={cn('relative h-3 rounded-full transition-[width] duration-700', over ? 'bg-[var(--et-red)]' : 'bg-[var(--et-ink)]')}
          style={{ width: `${Math.max(p * 100, 4)}%` }}
        />
      </div>
    </div>
  );
}

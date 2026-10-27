/**
 * Charts in the Expenses tracker's style: the dotted-rim gauge, a thick
 * ring, bars on dashed guides, and segment rows. Library-free SVG and
 * divs, colored only by the --yc-* tokens. The gauge sweeps to the score
 * once when shown; the other charts glide when their values change.
 */
import { monthLabel } from '../lib/format.ts';
import { useTween } from '../lib/motion.tsx';
import type { Check, Odds } from '../lib/types.ts';
import { Segments, Tip } from './ui.tsx';

/** The odds as a gauge: a 250 degree arc with a dotted rim, filled to the score. */
export function Gauge({ odds, size = 200 }: { odds: Odds; size?: number }): React.JSX.Element {
  const c = size / 2;
  const r = c - 18;
  const startA = -125;
  const sweep = 250;
  const target = odds.ready ? Math.max(0, Math.min(1, odds.score / 100)) : 0;
  const p = useTween(target, 700);
  const endA = startA + sweep * p;
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
    <div className="relative mx-auto" style={{ width: size, height: size * 0.86 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="pointer-events-none overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="yc-gauge" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="var(--yc-accent-soft)" />
            <stop offset="100%" stopColor="var(--yc-accent)" />
          </linearGradient>
        </defs>
        {ticks.map((a) => {
          const [x, y] = pt(a, r + 12);
          return <circle key={a} cx={x} cy={y} r={a <= endA + 0.01 && p > 0 ? 1.8 : 1.4} fill={a <= endA + 0.01 && p > 0 ? 'var(--yc-accent)' : 'var(--yc-line)'} />;
        })}
        <path d={arcD(startA, startA + sweep)} fill="none" stroke="var(--yc-line)" strokeWidth={14} strokeLinecap="round" />
        {p > 0.001 && <path d={arcD(startA, Math.max(startA + 0.5, endA))} fill="none" stroke="url(#yc-gauge)" strokeWidth={14} strokeLinecap="round" />}
        {p > 0.001 && <circle cx={bx} cy={by} r={6} fill="var(--yc-card)" stroke="var(--yc-accent)" strokeWidth={3} />}
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: c - 26 }}>
        <span className="text-[12px] font-semibold text-[var(--yc-muted)]">{odds.ready ? 'chance' : 'not yet'}</span>
        <span className="num text-[26px] font-extrabold leading-[34px]">{odds.ready ? (odds.percent !== null ? odds.percent + '%' : 'n/a') : '?'}</span>
      </div>
    </div>
  );
}

const SLICES = ['var(--yc-ink)', 'var(--yc-slice-2)', 'var(--yc-slice-3)', 'var(--yc-muted)', 'var(--yc-green)'];

export function sliceColor(i: number): string {
  return SLICES[i % SLICES.length] ?? 'var(--yc-ink)';
}

/** A thick ring of slices with a label in the middle (equity split). */
export function Ring({ parts, size = 132, center, caption }: { parts: { label: string; value: number; color?: string }[]; size?: number; center: string; caption: string }): React.JSX.Element {
  const stroke = 18;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 6 : 0;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--yc-line)" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = (Math.max(0, p.value) / 100) * circ;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color ?? sliceColor(i)}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0.1, len - gap - stroke)} ${circ}`}
              strokeDashoffset={-(offset + stroke / 2)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: 'stroke-dasharray 400ms ease-out, stroke-dashoffset 400ms ease-out' }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[15px] font-extrabold">{center}</span>
        <span className="text-[12px] text-[var(--yc-muted)]">{caption}</span>
      </div>
    </div>
  );
}

/** A small progress ring with a number in the middle. */
export function MiniRing({ value, size = 40, done = false, children }: { value: number; size?: number; done?: boolean; children?: React.ReactNode }): React.JSX.Element {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--yc-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? 'var(--yc-green)' : 'var(--yc-ink)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={v < 0.001 ? 'invisible' : undefined}
          style={{ transition: 'stroke-dasharray 400ms ease-out' }}
        />
      </svg>
      <span className="num relative text-[12px] font-bold">{children}</span>
    </span>
  );
}

/** Revenue month by month: accent bars over dashed guides. */
export function MonthBars({ months, values }: { months: string[]; values: Record<string, number> }): React.JSX.Element {
  const max = Math.max(1, ...months.map((m) => values[m] ?? 0));
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[96px] flex-col justify-between">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="border-t border-dashed border-[var(--yc-line)]" />
        ))}
      </div>
      <div className="relative grid h-[120px] items-end gap-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map((m) => {
          const v = values[m] ?? 0;
          return (
            <Tip key={m} text={monthLabel(m) + ': $' + Math.round(v).toLocaleString('en-US')}>
              <div className="flex w-full flex-col items-center gap-1.5" tabIndex={0}>
                <div className="flex h-[96px] w-full items-end justify-center">
                  <span className="w-3 rounded-full transition-[height] duration-300" style={{ height: Math.max(6, (v / max) * 96), background: v > 0 ? 'var(--yc-ink)' : 'var(--yc-line)' }} />
                </div>
                <span className="text-[12px] text-[var(--yc-muted)]">{monthLabel(m).slice(0, 3)}</span>
              </div>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

/** The seven factors of the odds as segment rows. */
export function FactorRows({ odds }: { odds: Odds }): React.JSX.Element {
  return (
    <div className="grid gap-2">
      {odds.groups.map((g) => (
        <Tip key={g.key} text={g.items.map((i) => i.label + ': ' + i.got + ' of ' + i.max + (i.note !== '' ? ' (' + i.note + ')' : '')).join('. ')}>
          <div className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--yc-row)] px-4 py-2.5" tabIndex={0}>
            <span className="min-w-0 flex-1 text-[14px] font-semibold">{g.label}</span>
            <Segments value={g.got} max={g.max} count={12} tone="accent" />
            <span className="num w-12 text-right text-[13px] text-[var(--yc-muted)]">
              {g.got}/{g.max}
            </span>
          </div>
        </Tip>
      ))}
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = { before: 'Before you apply', team: 'Team', clarity: 'Writing', progress: 'Progress', idea: 'Idea', video: 'Video', form: 'Form' };

function barColor(c: Check): string {
  if (c.status === 'pass') return 'var(--yc-green)';
  if (c.status === 'wait') return 'var(--yc-line)';
  if (c.severity === 'blocker') return 'var(--yc-red)';
  if (c.severity === 'warning') return 'var(--yc-accent)';
  return 'var(--yc-muted)';
}

/** Every check as a small bar, one row per group: green done, red must fix, orange should fix. */
export function CheckBars({ checks, onPick }: { checks: Check[]; onPick: (c: Check) => void }): React.JSX.Element {
  const groups = ['before', 'team', 'clarity', 'progress', 'idea', 'video', 'form'];
  return (
    <div className="grid gap-3">
      {groups.map((g) => {
        const items = checks.filter((c) => c.group === g && c.status !== 'na');
        if (items.length === 0) return null;
        const done = items.filter((c) => c.status === 'pass').length;
        return (
          <div key={g} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 text-[13px] font-semibold">{GROUP_LABEL[g]}</span>
            <span className="flex flex-1 flex-wrap items-center gap-[4px]">
              {items.map((c) => (
                <Tip key={c.id} text={(c.status === 'pass' ? 'Done: ' : c.status === 'wait' ? 'Being read: ' : '') + c.title}>
                  <button type="button" aria-label={c.title} onClick={() => onPick(c)} className="hit h-4 w-2 rounded-full transition-colors duration-300" style={{ background: barColor(c) }} />
                </Tip>
              ))}
            </span>
            <span className="num text-[12px] text-[var(--yc-muted)]">
              {done}/{items.length}
            </span>
          </div>
        );
      })}
    </div>
  );
}

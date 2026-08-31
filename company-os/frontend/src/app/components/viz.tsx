/**
 * Home visuals, hand-built SVG in the app's sharp warm language.
 * Dataviz rules applied: single-series charts carry no legend (the title
 * names them), one hue per job (accent = the series, muted = projection,
 * status colors only for goal pass/fail), thin marks, recessive grid,
 * text always in ink tokens, and every plot has a hover layer.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { fmtMoney } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Shared lightweight tooltip                                          */
/* ------------------------------------------------------------------ */

interface TipState {
  x: number;
  y: number;
  body: ReactNode;
}

function Tip({ tip }: { tip: TipState | null }): React.JSX.Element | null {
  if (tip === null) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap border border-[var(--lui-border)] bg-[var(--lui-surface)] px-2 py-1 text-[11px] leading-tight text-[var(--lui-text)] shadow-md"
      style={{ left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }}
      role="tooltip"
    >
      {tip.body}
    </div>
  );
}

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compact(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/* ------------------------------------------------------------------ */
/* Cash flow chart: 90d balance history + dashed projection            */
/* ------------------------------------------------------------------ */

export interface CashPoint {
  date: string;
  balance: number;
}

export function CashFlowChart({
  history,
  projection,
  runOutDate,
  height = 190,
}: {
  /** Daily balance, oldest first, ending today. */
  history: CashPoint[];
  /** Projected daily balance after today (dashed), possibly empty. */
  projection: CashPoint[];
  /** ISO date where projected balance crosses zero, if it does. */
  runOutDate: string | null;
  height?: number | undefined;
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 22;

  const all = useMemo(() => [...history, ...projection], [history, projection]);
  const geometry = useMemo(() => {
    if (all.length < 2) return null;
    const min = Math.min(0, ...all.map((p) => p.balance));
    const max = Math.max(...all.map((p) => p.balance), 1);
    const span = max - min || 1;
    const x = (i: number): number => PAD_L + (i / (all.length - 1)) * (W - PAD_L - PAD_R);
    const y = (v: number): number => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
    const histPath = history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
    const lastHistIdx = history.length - 1;
    const projPath =
      projection.length > 0
        ? [
            `M${x(lastHistIdx).toFixed(1)},${y(history[lastHistIdx]?.balance ?? 0).toFixed(1)}`,
            ...projection.map((p, i) => `L${x(lastHistIdx + 1 + i).toFixed(1)},${y(p.balance).toFixed(1)}`),
          ].join(' ')
        : '';
    const areaPath =
      histPath !== ''
        ? `${histPath} L${x(lastHistIdx).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`
        : '';
    const gridVals = [min + span * 0.25, min + span * 0.6, min + span * 0.95];
    return { min, max, span, x, y, histPath, projPath, areaPath, gridVals, lastHistIdx };
  }, [all, history, projection, H]);

  if (geometry === null) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[var(--lui-muted)]">
        Record a few money entries and the cash curve appears here.
      </div>
    );
  }

  const { x, y, histPath, projPath, areaPath, gridVals, lastHistIdx } = geometry;

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const el = wrap.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(all.length - 1, Math.round(((relX - PAD_L) / (W - PAD_L - PAD_R)) * (all.length - 1))));
    const p = all[idx];
    if (p === undefined) return;
    setHoverX(x(idx));
    setTip({
      x: (x(idx) / W) * rect.width,
      y: (y(p.balance) / H) * rect.height,
      body: (
        <>
          <span className="font-medium tabular-nums">{fmtMoney(p.balance)}</span>
          <span className="text-[var(--lui-muted)]">
            {' '}
            · {fmtDay(p.date)}
            {idx > lastHistIdx ? ' (projected)' : ''}
          </span>
        </>
      ),
    });
  };

  // Month tick labels at first-of-month points.
  const ticks: Array<{ i: number; label: string }> = [];
  let lastMonth = '';
  all.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      if (i > 2 && i < all.length - 3) {
        ticks.push({ i, label: new Date(p.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' }) });
      }
    }
  });

  const runOutIdx = runOutDate !== null ? all.findIndex((p) => p.date === runOutDate) : -1;

  return (
    <div ref={wrap} className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null);
          setHoverX(null);
        }}
        role="img"
        aria-label="Cash balance over the last 90 days with projection"
      >
        {/* recessive grid */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--lui-border)" strokeWidth={1} opacity={0.6} />
            <text x={PAD_L + 2} y={y(v) - 3} textAnchor="start" fontSize={10} fill="var(--lui-muted)" opacity={0.9}>
              {compact(v)}
            </text>
          </g>
        ))}
        {/* zero line when balances can cross it */}
        {geometry.min < 0 && (
          <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="var(--lui-muted)" strokeWidth={1} opacity={0.5} />
        )}
        {/* area + history line */}
        <path d={areaPath} fill="var(--lui-accent)" opacity={0.08} />
        <path d={histPath} fill="none" stroke="var(--lui-accent)" strokeWidth={2} strokeLinejoin="round" />
        {/* today divider */}
        <line
          x1={x(lastHistIdx)}
          x2={x(lastHistIdx)}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="var(--lui-border)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* projection */}
        {projPath !== '' && (
          <path d={projPath} fill="none" stroke="var(--lui-muted)" strokeWidth={1.5} strokeDasharray="4 4" />
        )}
        {/* run-out marker */}
        {runOutIdx > 0 && (
          <g>
            <circle cx={x(runOutIdx)} cy={y(0)} r={3.5} fill="rgb(220 38 38)" />
            <text x={x(runOutIdx)} y={y(0) - 7} textAnchor="middle" fontSize={10} fill="rgb(220 38 38)">
              {fmtDay(all[runOutIdx]?.date ?? '')}
            </text>
          </g>
        )}
        {/* latest point */}
        <circle cx={x(lastHistIdx)} cy={y(history[lastHistIdx]?.balance ?? 0)} r={3.5} fill="var(--lui-accent)" />
        {/* month ticks */}
        {ticks.map((t) => (
          <text key={t.i} x={x(t.i)} y={H - 7} textAnchor="middle" fontSize={10} fill="var(--lui-muted)">
            {t.label}
          </text>
        ))}
        {/* crosshair */}
        {hoverX !== null && (
          <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={H - PAD_B} stroke="var(--lui-muted)" strokeWidth={1} opacity={0.5} />
        )}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month calendar, in the Command Center's design language:            */
/* oversized today header, month nav, dot legend, day grid where past  */
/* days are solid inverted blocks, today is filled accent, future days */
/* are bordered; up to 3 event dots per day; click a day for its list. */
/* Events derive from real records only.                               */
/* ------------------------------------------------------------------ */

export type CalKind = 'follow_up' | 'work' | 'invoice' | 'promo';

export interface CalEvent {
  key: string;
  date: string;
  title: string;
  kind: CalKind;
  page: string;
}

const CAL_COLOR: Record<CalKind, string> = {
  follow_up: 'var(--lui-accent)',
  work: '#0ea5e9',
  invoice: '#f59e0b',
  promo: '#8b5cf6',
};

const CAL_LABEL: Record<CalKind, string> = {
  follow_up: 'Follow-ups',
  work: 'Work due',
  invoice: 'Invoices',
  promo: 'Promos',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MonthCalendar({
  events,
  onOpen,
}: {
  events: CalEvent[];
  onOpen: (page: string) => void;
}): React.JSX.Element {
  const today = new Date();
  // Local key, never toISOString: UTC would mark the wrong "today" east of it.
  const todayKey = localKey(today);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(todayKey);

  const shiftMonth = (delta: number): void => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstCol = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const dateKey = (day: number): string =>
    `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const eventMap = useMemo(() => {
    const map = new Map<string, Set<CalKind>>();
    for (const ev of events) {
      const d = ev.date.slice(0, 10);
      const set = map.get(d);
      if (set !== undefined) set.add(ev.kind);
      else map.set(d, new Set([ev.kind]));
    }
    return map;
  }, [events]);

  const presentKinds = useMemo(() => {
    const kinds = new Set<CalKind>();
    for (const ev of events) kinds.add(ev.kind);
    return (['follow_up', 'work', 'invoice', 'promo'] as CalKind[]).filter((k) => kinds.has(k));
  }, [events]);

  const cells: Array<number | null> = [
    ...Array.from({ length: firstCol }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const selectedEvents = selected !== null ? events.filter((e) => e.date.slice(0, 10) === selected) : [];

  return (
    // items-stretch (flex default) so both zone dividers span the full height.
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Zone 1: oversized today header (Command Center signature) + nav + legend */}
      <div className="flex shrink-0 flex-col gap-3 md:w-52">
      <div>
        <p className="text-[56px] font-extrabold leading-none tracking-[-2px] tabular-nums">{today.getDate()}</p>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[1.5px]">{MONTHS[today.getMonth()]}</p>
            <p className="text-sm tracking-wide text-[var(--lui-muted)]">{today.getFullYear()}</p>
          </div>
          <p className="text-sm text-[var(--lui-muted)]">
            {today.toLocaleDateString(undefined, { weekday: 'short' })}
          </p>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          className="flex size-6 items-center justify-center border border-[var(--lui-border)] text-[var(--lui-muted)] transition-colors hover:text-[var(--lui-text)]"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          className="flex size-6 items-center justify-center border border-[var(--lui-border)] text-[var(--lui-muted)] transition-colors hover:text-[var(--lui-text)]"
        >
          ›
        </button>
        <span className="text-[11px] uppercase tracking-[0.8px] text-[var(--lui-muted)]">
          {MONTHS[viewMonth]} {viewYear}
        </span>
      </div>

      {/* Legend (only kinds that exist) */}
      {presentKinds.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {presentKinds.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-[var(--lui-muted)]">
              <span aria-hidden className="size-2 rounded-full" style={{ background: CAL_COLOR[k] }} />
              {CAL_LABEL[k]}
            </span>
          ))}
        </div>
      )}
      </div>

      {/* Zone 2: day grid */}
      <div className="grid shrink-0 grid-cols-7 content-start justify-items-center gap-1 border-t border-[var(--lui-border)] pt-3 md:w-[19.5rem] md:border-l md:border-t-0 md:pl-6 md:pt-0">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={`${d}${i}`} className="pb-0.5 text-[11px] tracking-wide text-[var(--lui-muted)]">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`pad-${i}`} />;
          const dk = dateKey(day);
          const isToday = dk === todayKey;
          const isSelected = dk === selected;
          const kinds = eventMap.get(dk);
          const isPast = dk < todayKey;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelected(isSelected ? null : dk)}
              title={`${MONTHS[viewMonth]} ${day}${kinds !== undefined ? ` · ${kinds.size} kind(s) of event` : ''}`}
              className={cn(
                'flex h-9 w-8 flex-col items-center justify-center gap-0.5 text-xs font-semibold tabular-nums transition-colors',
                isToday || isSelected
                  ? 'bg-[var(--lui-accent)] text-white'
                  : isPast
                    ? 'bg-[var(--lui-text)] text-[var(--lui-surface)]'
                    : 'border-[1.5px] border-[var(--lui-border)] text-[var(--lui-muted)] hover:border-[var(--lui-muted)]',
              )}
            >
              <span>{day}</span>
              {kinds !== undefined && (
                <span className="flex gap-0.5">
                  {[...kinds].slice(0, 3).map((k) => (
                    <span
                      key={k}
                      aria-hidden
                      className="size-1 rounded-full"
                      style={{
                        background: isToday || isSelected || isPast ? 'rgba(255,255,255,0.85)' : CAL_COLOR[k],
                      }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Zone 3: selected day's events */}
      <div className="min-w-0 flex-1 border-t border-[var(--lui-border)] pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
        {selected === null ? (
          <p className="text-xs text-[var(--lui-muted)]">Click a day to see what is scheduled.</p>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">
              {fmtDay(selected)}
            </p>
            {selectedEvents.length === 0 ? (
              <p className="text-xs text-[var(--lui-muted)]">Nothing scheduled.</p>
            ) : (
              <div className="flex flex-col">
                {selectedEvents.map((ev) => (
                  <button
                    key={ev.key}
                    type="button"
                    onClick={() => onOpen(ev.page)}
                    className="flex min-h-8 items-center gap-2 border-b border-[var(--lui-border)]/60 py-1 text-left last:border-0 hover:bg-[var(--lui-border)]/15"
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: CAL_COLOR[ev.kind] }} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{ev.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--lui-muted)]">{CAL_LABEL[ev.kind]}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* Metric momentum panel: line + dashed goal, latest value as status   */
/* ------------------------------------------------------------------ */

export function MetricPanel({
  name,
  unit,
  goal,
  direction,
  series,
}: {
  name: string;
  unit: string;
  goal: number;
  direction: 'up' | 'down';
  /** Weekly values, oldest first (nulls for missing weeks removed). */
  series: Array<{ week: string; value: number }>;
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const W = 260;
  const H = 56;
  const PAD = 6;

  const latest = series[series.length - 1];
  const hasGoal = goal > 0;
  const met =
    latest !== undefined && hasGoal
      ? direction === 'up'
        ? latest.value >= goal
        : latest.value <= goal
      : null;

  const vals = series.map((p) => p.value);
  const min = Math.min(...vals, hasGoal ? goal : Infinity);
  const max = Math.max(...vals, hasGoal ? goal : -Infinity, 1);
  const span = max - min || 1;
  const x = (i: number): number => PAD + (series.length > 1 ? (i / (series.length - 1)) * (W - PAD * 2) : (W - PAD * 2) / 2);
  const y = (v: number): number => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <div ref={wrap} className="relative border border-[var(--lui-border)] bg-[var(--lui-surface)] px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">{name}</p>
        {latest !== undefined && (
          <p
            className={cn(
              'shrink-0 text-base font-semibold leading-5 tabular-nums',
              met === true && 'text-emerald-700 dark:text-emerald-400',
              met === false && 'text-red-700 dark:text-red-400',
            )}
          >
            {fmtMoney(latest.value)}
            {unit !== '' && <span className="ml-0.5 text-[10px] font-normal text-[var(--lui-muted)]">{unit}</span>}
          </p>
        )}
      </div>
      {series.length > 1 ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-1 block h-auto w-full"
          role="img"
          aria-label={`${name} weekly trend`}
          onMouseMove={(e) => {
            const el = wrap.current;
            if (el === null) return;
            const rect = el.getBoundingClientRect();
            const svgRect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const relX = ((e.clientX - svgRect.left) / svgRect.width) * W;
            const idx = Math.max(0, Math.min(series.length - 1, Math.round(((relX - PAD) / (W - PAD * 2)) * (series.length - 1))));
            const p = series[idx];
            if (p === undefined) return;
            setTip({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              body: (
                <>
                  <span className="font-medium tabular-nums">{fmtMoney(p.value)}</span>
                  <span className="text-[var(--lui-muted)]"> · wk of {fmtDay(p.week)}</span>
                </>
              ),
            });
          }}
          onMouseLeave={() => setTip(null)}
        >
          {hasGoal && (
            <line x1={PAD} x2={W - PAD} y1={y(goal)} y2={y(goal)} stroke="var(--lui-muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          )}
          <path d={path} fill="none" stroke="var(--lui-accent)" strokeWidth={2} strokeLinejoin="round" />
          {latest !== undefined && <circle cx={x(series.length - 1)} cy={y(latest.value)} r={3} fill="var(--lui-accent)" />}
        </svg>
      ) : (
        <p className="mt-2 text-xs text-[var(--lui-muted)]">Fill this week's number in Goals to start the trend.</p>
      )}
      {hasGoal && (
        <p className="mt-0.5 text-[10px] text-[var(--lui-muted)]">
          goal {direction === 'down' ? '≤' : '≥'} {fmtMoney(goal)}
          {unit !== '' ? ` ${unit}` : ''} weekly
        </p>
      )}
      <Tip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity constellation: modules orbiting the company core           */
/* ------------------------------------------------------------------ */

export interface OrbitNode {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Records touched in the last 7 days; null = unknown (no badge). */
  weekCount: number | null;
  onClick: () => void;
}

export function Constellation({
  companyInitials,
  nodes,
}: {
  companyInitials: string;
  nodes: OrbitNode[];
}): React.JSX.Element {
  const SIZE = 240;
  const C = SIZE / 2;
  const R = 88;

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--lui-border)" strokeWidth={1} strokeDasharray="2 4" opacity={0.8} />
        {nodes.map((n, i) => {
          const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const nx = C + R * Math.cos(angle);
          const ny = C + R * Math.sin(angle);
          const active = n.weekCount !== null && n.weekCount > 0;
          return (
            <line
              key={n.key}
              x1={C}
              y1={C}
              x2={nx}
              y2={ny}
              stroke={active ? 'var(--lui-accent)' : 'var(--lui-border)'}
              strokeWidth={1}
              opacity={active ? 0.35 : 0.5}
            />
          );
        })}
      </svg>

      {/* center: the company core */}
      <span
        aria-hidden
        className="cos-pulse absolute flex size-12 items-center justify-center bg-[var(--lui-accent)] text-sm font-bold text-white"
        style={{ left: C - 24, top: C - 24 }}
      >
        {companyInitials}
      </span>

      {nodes.map((n, i) => {
        const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const nx = C + R * Math.cos(angle);
        const ny = C + R * Math.sin(angle);
        const Icon = n.icon;
        const active = n.weekCount !== null && n.weekCount > 0;
        return (
          <button
            key={n.key}
            type="button"
            onClick={n.onClick}
            title={n.weekCount !== null ? `${n.label} · ${n.weekCount} update${n.weekCount === 1 ? '' : 's'} this week` : n.label}
            aria-label={n.label}
            className={cn(
              'absolute flex size-9 items-center justify-center border bg-[var(--lui-surface)] transition-transform hover:scale-110',
              active
                ? 'border-[var(--lui-accent)]/50 text-[var(--lui-accent)]'
                : 'border-[var(--lui-border)] text-[var(--lui-muted)]',
            )}
            style={{ left: nx - 18, top: ny - 18 }}
          >
            <Icon size={15} aria-hidden />
            {active && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center bg-[var(--lui-accent)] px-0.5 text-[9px] font-semibold tabular-nums text-white">
                {n.weekCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

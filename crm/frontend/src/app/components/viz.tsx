/**
 * The CRM's diagrams, hand-built SVG in the Company OS language: thin marks,
 * a recessive grid, the orange accent for the series that matters, muted
 * dashes for what is projected, text in ink tokens, a hover layer on every
 * plot.
 *
 *   RevenueTrend    won by month, then the pipeline's expected months dashed
 *   Constellation   your strongest relationships orbiting the workspace,
 *                   the ones going cold on an outer dashed ring
 *   PipelineFlow    a year of deals flowing stage to stage; what drops out
 *                   pours to the floor
 *   MonthCalendar   the Command Center month: tasks due, deals closing,
 *                   people to get back to, birthdays, meetings held
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { compact, day, monthName, since, stageColor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import type { CalendarEvent, CalendarKind, Funnel, PersonBrief } from '../lib/types.ts';
import { useWidth } from './charts.tsx';
import { Avatar } from './controls.tsx';

/* ------------------------------------------------------------------ tooltip */

interface Tip {
  x: number;
  y: number;
  body: ReactNode;
}

function TipBox({ tip }: { tip: Tip | null }): React.JSX.Element | null {
  if (tip === null) return null;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-20 whitespace-nowrap border border-[var(--cr-line)] bg-[var(--cr-card)] px-2 py-1 text-[11.5px] leading-tight text-[var(--cr-ink)] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]" style={{ left: tip.x, top: tip.y - 10, transform: 'translate(-50%, -100%)' }}>
      {tip.body}
    </div>
  );
}

function niceTop(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* ------------------------------------------------------------ revenue trend */

export interface TrendMonth {
  month: string;
  /** Won in the month (home currency, minor units); history only. */
  won: number | null;
  /** Won plus the weighted pipeline expected to close; this month and after. */
  expected: number | null;
  /** Won plus every open deal expected to close (best case). */
  best: number | null;
}

/** Won by month (solid, filled) then what the pipeline should bring (dashed), with today marked. */
export function RevenueTrend({ months, currency, height = 210 }: { months: TrendMonth[]; currency: string; height?: number | undefined }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(width, 320);
  const H = height;
  const padL = 10;
  const padR = 14;
  const padT = 14;
  const padB = 24;
  const n = months.length;
  const values = months.flatMap((m) => [m.won ?? 0, m.expected ?? 0, m.best ?? 0]);
  const top = niceTop(Math.max(...values, 0) * 1.08);
  const x = (i: number): number => padL + (n > 1 ? (i / (n - 1)) * (W - padL - padR) : (W - padL - padR) / 2);
  const y = (v: number): number => padT + (1 - v / top) * (H - padT - padB);
  const hist = months.map((m, i) => ({ i, v: m.won })).filter((p): p is { i: number; v: number } => p.v !== null);
  const now = hist.length > 0 ? (hist[hist.length - 1]?.i ?? 0) : 0;
  const exp = months.map((m, i) => ({ i, v: m.expected })).filter((p): p is { i: number; v: number } => p.v !== null);
  const best = months.map((m, i) => ({ i, v: m.best })).filter((p): p is { i: number; v: number } => p.v !== null);
  const line = (pts: { i: number; v: number }[]): string => pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = hist.length > 1 ? `${line(hist)} L${x(now).toFixed(1)},${y(0)} L${x(hist[0]?.i ?? 0).toFixed(1)},${y(0)} Z` : '';
  const grid = [top / 3, (top * 2) / 3, top];
  const empty = values.every((v) => v === 0);
  const tipFor = (i: number): ReactNode => {
    const m = months[i];
    if (m === undefined) return null;
    return (
      <>
        <span className="font-semibold">{monthName(m.month)}</span>
        {m.won !== null && <span className="ml-1.5 text-[var(--cr-pos-text)]">won {compact(m.won, currency)}</span>}
        {m.expected !== null && <span className="ml-1.5">expected {compact(m.expected, currency)}</span>}
        {m.best !== null && m.best !== m.expected && <span className="ml-1.5 text-[var(--cr-muted)]">best {compact(m.best, currency)}</span>}
      </>
    );
  };
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && empty && <div className="flex h-full items-center justify-center text-[12.5px] text-[var(--cr-muted)]">Won deals and expected closes appear here as months go by.</div>}
      {width > 0 && !empty && (
        <svg
          width={W}
          height={H}
          className="block"
          role="img"
          aria-label="Won by month and the expected months ahead"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const rel = e.clientX - r.left;
            setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - padL) / (W - padL - padR)) * (n - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {grid.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--cr-hair)" />
              <text x={padL + 2} y={y(g) - 4} fontSize={10.5} fill="var(--cr-muted)">
                {compact(g, currency)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--cr-line)" />
          {area !== '' && <path d={area} fill="var(--cr-accent)" opacity={0.09} className="cr-fade-in" />}
          {best.length > 1 && <path d={line(best)} fill="none" stroke="var(--cr-muted)" strokeWidth={1} strokeDasharray="2 4" opacity={0.7} />}
          {exp.length > 0 && <path d={`M${x(now).toFixed(1)},${y(months[now]?.won ?? 0).toFixed(1)} ` + line(exp).replace(/^M/, 'L')} fill="none" stroke="var(--cr-ink-2)" strokeWidth={1.6} strokeDasharray="5 4" />}
          {hist.length > 1 && <path d={line(hist)} pathLength={1} fill="none" stroke="var(--cr-accent)" strokeWidth={2.2} strokeLinejoin="round" className="cr-draw" />}
          <line x1={x(now)} x2={x(now)} y1={padT} y2={H - padB} stroke="var(--cr-line)" strokeDasharray="2 3" />
          <text x={x(now) + 4} y={padT + 9} fontSize={10} fill="var(--cr-muted)">
            today
          </text>
          {hist.map((p) => (
            <circle key={'h' + p.i} cx={x(p.i)} cy={y(p.v)} r={p.i === now ? 4 : 2.2} fill={p.i === now ? 'var(--cr-accent)' : 'var(--cr-card)'} stroke="var(--cr-accent)" strokeWidth={1.5} />
          ))}
          {exp
            .filter((p) => p.i !== now)
            .map((p) => (
              <circle key={'e' + p.i} cx={x(p.i)} cy={y(p.v)} r={2.4} fill="var(--cr-card)" stroke="var(--cr-ink-2)" strokeWidth={1.3} />
            ))}
          {months.map((m, i) =>
            i % (W < 560 ? 3 : 2) === (n - 1 - now) % (W < 560 ? 3 : 2) || i === now ? (
              <text key={m.month} x={x(i)} y={H - 7} textAnchor="middle" fontSize={10.5} fill={i === now ? 'var(--cr-ink)' : 'var(--cr-muted)'} fontWeight={i === now ? 600 : 400}>
                {monthName(m.month).slice(0, 3)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--cr-muted)" opacity={0.5} />}
        </svg>
      )}
      <TipBox tip={hover === null ? null : { x: x(hover), y: y(Math.max(months[hover]?.won ?? 0, months[hover]?.expected ?? 0)), body: tipFor(hover) }} />
    </div>
  );
}

/* ------------------------------------------------------------ constellation */

/** The workspace at the core, the strongest relationships orbiting closer the stronger they are, the cold ones on a dashed outer ring. */
export function Constellation({ core, strong, cold }: { core: string; strong: PersonBrief[]; cold: PersonBrief[] }): React.JSX.Element {
  const SIZE = 268;
  const C = SIZE / 2;
  const R_OUT = 118;
  const nodes = useMemo(() => {
    const inner = strong.slice(0, 8).map((p, i, a) => {
      const angle = (i / Math.max(a.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = 50 + ((100 - Math.min(100, p.strength)) / 100) * 46;
      return { p, x: C + r * Math.cos(angle), y: C + r * Math.sin(angle), cold: false };
    });
    const outer = cold.slice(0, 6).map((p, i, a) => {
      const angle = (i / Math.max(a.length, 1)) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(a.length, 1);
      return { p, x: C + R_OUT * Math.cos(angle), y: C + R_OUT * Math.sin(angle), cold: true };
    });
    return [...inner, ...outer];
  }, [strong, cold, C]);
  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
        <circle cx={C} cy={C} r={R_OUT} fill="none" stroke="var(--cr-line)" strokeDasharray="2 4" />
        <circle cx={C} cy={C} r={73} fill="none" stroke="var(--cr-hair)" />
        {nodes.map((n) => (
          <line key={n.p.id + (n.cold ? 'c' : 's')} x1={C} y1={C} x2={n.x} y2={n.y} stroke={n.cold ? 'var(--cr-line)' : 'var(--cr-accent)'} strokeWidth={n.cold ? 1 : 1.4} strokeDasharray={n.cold ? '3 4' : undefined} opacity={n.cold ? 0.9 : 0.25 + (n.p.strength / 100) * 0.5} />
        ))}
      </svg>
      <span aria-hidden className="cr-core absolute flex size-12 items-center justify-center bg-[var(--cr-accent)] text-[13px] font-bold text-[var(--cr-on-accent)]" style={{ left: C - 24, top: C - 24 }}>
        {core}
      </span>
      {nodes.map((n, i) => {
        const size = n.cold ? 24 : 30;
        return (
          <button
            key={n.p.id + (n.cold ? 'c' : 's')}
            type="button"
            onClick={() => go('people', { id: n.p.id })}
            title={n.p.name + (n.p.company_name ? ' · ' + n.p.company_name : '') + ' · strength ' + n.p.strength + (n.p.last_interaction ? ' · last contact ' + since(n.p.last_interaction) : '')}
            aria-label={n.p.name}
            className={cn('cr-pop-in absolute rounded-full ring-2 ring-[var(--cr-card)] transition-transform hover:z-10 hover:scale-110', n.cold && 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0')}
            style={{ left: n.x - size / 2, top: n.y - size / 2, animationDelay: `${120 + i * 40}ms` }}
          >
            <Avatar name={n.p.name} size={size} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ pipeline flow */

/**
 * A year of deals flowing through a pipeline: each stage a column as tall as
 * the deals that reached it, the band to the next stage as wide as those
 * that moved on, and what dropped out pouring to the floor.
 */
export function PipelineFlow({ funnel, onStage }: { funnel: Funnel; onStage?: (() => void) | undefined }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const stages = funnel.stages;
  const W = Math.max(width, 320);
  const H = 232;
  const nodeW = 10;
  const padL = 4;
  const padR = 4;
  const topY = 52;
  const maxH = 112;
  const floorY = H - 16;
  const n = stages.length;
  const base = Math.max(funnel.deals, stages[0]?.reached ?? 0, 1);
  const colX = (i: number): number => padL + (n > 1 ? (i / (n - 1)) * (W - padL - padR - nodeW) : 0);
  const h = (r: number): number => (r <= 0 ? 0 : Math.max(2, (r / base) * maxH));
  const won = stages.find((s) => s.kind === 'won');
  const empty = funnel.deals === 0 || n === 0;
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }} onMouseLeave={() => setTip(null)}>
      {empty && <div className="flex h-full items-center justify-center text-center text-[12.5px] text-[var(--cr-muted)]">No deals created in this pipeline in the last 12 months yet.</div>}
      {width > 0 && !empty && (
        <svg width={W} height={H} className="block" role="img" aria-label={'How deals moved through ' + funnel.pipeline.name}>
          <defs>
            {stages.slice(0, -1).map((s, i) => (
              <linearGradient key={s.id} id={'cr-flow-' + i} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor={stageColor(s.color, s.kind)} stopOpacity={0.42} />
                <stop offset="100%" stopColor={stageColor(stages[i + 1]?.color, stages[i + 1]?.kind)} stopOpacity={0.42} />
              </linearGradient>
            ))}
          </defs>
          <line x1={padL} x2={W - padR} y1={floorY} y2={floorY} stroke="var(--cr-line)" strokeDasharray="2 4" />
          {stages.slice(0, -1).map((s, i) => {
            const next = stages[i + 1];
            if (next === undefined) return null;
            const x1 = colX(i) + nodeW;
            const x2 = colX(i + 1);
            const hm = h(next.reached);
            const a = topY + hm;
            const b = topY + h(s.reached);
            const dw = b - a;
            const xe = x1 + (x2 - x1) * 0.18;
            const lost = s.reached - next.reached;
            return (
              <g key={s.id}>
                {hm > 0 && (
                  <path
                    d={`M${x1},${topY} L${x2},${topY} L${x2},${topY + hm} L${x1},${topY + hm} Z`}
                    fill={`url(#cr-flow-${i})`}
                    className="cr-fade-in"
                    style={{ animationDelay: `${i * 90}ms` }}
                    onMouseMove={(e) => {
                      const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body: <span>{s.name + ' → ' + next.name + ': ' + next.reached + ' of ' + s.reached + ' moved on (' + next.from_prev + '%)'}</span> });
                    }}
                  />
                )}
                {dw > 0.5 && lost > 0 && (
                  <path
                    d={`M${x1},${a} C${x1 + (xe + dw - x1) * 0.7},${a} ${xe + dw},${a + (floorY - a) * 0.25} ${xe + dw},${floorY} L${xe},${floorY} C${xe},${b + (floorY - b) * 0.35} ${x1 + (xe - x1) * 0.5},${b} ${x1},${b} Z`}
                    fill="var(--cr-neg)"
                    opacity={0.14}
                    className="cr-fade-in"
                    style={{ animationDelay: `${i * 90 + 120}ms` }}
                    onMouseMove={(e) => {
                      const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body: <span>{lost + ' dropped out or lost after ' + s.name}</span> });
                    }}
                  />
                )}
              </g>
            );
          })}
          {stages.map((s, i) => {
            const x0 = colX(i);
            const hh = h(s.reached);
            const right = i === n - 1;
            const anchor = right ? 'end' : 'start';
            const tx = right ? x0 + nodeW : x0;
            return (
              <g key={s.id} className="cursor-pointer" onClick={onStage}>
                <rect x={x0} y={topY} width={nodeW} height={Math.max(hh, 1)} fill={stageColor(s.color, s.kind)} className="cr-grow-y" style={{ animationDelay: `${i * 70}ms` }} />
                <text x={tx} y={topY - 24} textAnchor={anchor} fontSize={11.5} fontWeight={600} fill="var(--cr-ink)">
                  {s.name.length > 16 ? s.name.slice(0, 15) + '…' : s.name}
                </text>
                <text x={tx} y={topY - 9} textAnchor={anchor} fontSize={11} fill="var(--cr-muted)">
                  <tspan fontWeight={600} fill="var(--cr-ink-2)">
                    {s.reached}
                  </tspan>
                  {' · ' + s.pct + '%'}
                </text>
              </g>
            );
          })}
          <text x={padL} y={H - 3} fontSize={10.5} fill="var(--cr-muted)">
            Dropped out or lost
          </text>
          {won !== undefined && (
            <text x={W - padR} y={H - 3} textAnchor="end" fontSize={10.5} fill="var(--cr-pos-text)" fontWeight={600}>
              {won.reached} won · {funnel.win_rate ?? 0}%
            </text>
          )}
        </svg>
      )}
      <TipBox tip={tip} />
    </div>
  );
}

/* ----------------------------------------------------------- month calendar */

const CAL_COLOR: Record<CalendarKind, string> = {
  close: 'var(--cr-accent)',
  task: 'var(--cr-c1)',
  touch: 'var(--cr-c4)',
  meeting: 'var(--cr-c2)',
  birthday: 'var(--cr-c3)',
};

const CAL_LABEL: Record<CalendarKind, string> = {
  close: 'Deals closing',
  task: 'Tasks due',
  touch: 'Get in touch',
  meeting: 'Meetings held',
  birthday: 'Birthdays',
};

/** One item's tag in the day list. */
const CAL_ONE: Record<CalendarKind, string> = {
  close: 'Closing',
  task: 'Task due',
  touch: 'Get in touch',
  meeting: 'Held',
  birthday: 'Birthday',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openEvent(e: CalendarEvent): void {
  if (e.type === 'people' && e.id !== '') go('people', { id: e.id });
  else if (e.type === 'deals' && e.id !== '') go('deals', { id: e.id });
  else if (e.type === 'tasks') go('today');
}

/**
 * The Command Center month: an oversized today, month navigation and a dot
 * legend; past days as solid ink blocks, today in orange, days ahead framed,
 * up to three event dots a day; the chosen day's list opens each record.
 */
export function MonthCalendar({ currency }: { currency: string }): React.JSX.Element {
  const today = new Date();
  const todayKey = localKey(today);
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<string | null>(todayKey);
  const month = `${view.y}-${String(view.m + 1).padStart(2, '0')}`;
  const live = useLive(() => api.calendar(month), ['tasks', 'deals', 'people', 'interactions'], [month], 400);
  const events = useMemo(() => live.data?.events ?? [], [live.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarKind[]>();
    for (const e of events) {
      const k = map.get(e.date) ?? [];
      if (!k.includes(e.kind)) k.push(e.kind);
      map.set(e.date, k);
    }
    return map;
  }, [events]);
  const kinds = (Object.keys(CAL_LABEL) as CalendarKind[]).filter((k) => events.some((e) => e.kind === k));
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const firstCol = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array.from({ length: firstCol }, () => null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const key = (d: number): string => `${month}-${String(d).padStart(2, '0')}`;
  const shift = (delta: number): void => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setSelected(null);
  };
  const list = selected === null ? [] : events.filter((e) => e.date === selected);
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex shrink-0 flex-col gap-3 md:w-52">
        <div>
          <p className="num text-[56px] font-extrabold leading-none tracking-[-2px]">{today.getDate()}</p>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[1.5px]">{MONTHS[today.getMonth()]}</p>
              <p className="text-[13px] tracking-wide text-[var(--cr-muted)]">{today.getFullYear()}</p>
            </div>
            <p className="text-[13px] text-[var(--cr-muted)]">{today.toLocaleDateString(undefined, { weekday: 'short' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="flex size-6 items-center justify-center border border-[var(--cr-line)] text-[var(--cr-muted)] transition-colors hover:text-[var(--cr-ink)]">
            <ChevronLeft size={13} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} className="flex size-6 items-center justify-center border border-[var(--cr-line)] text-[var(--cr-muted)] transition-colors hover:text-[var(--cr-ink)]">
            <ChevronRight size={13} />
          </button>
          <span className="text-[11px] uppercase tracking-[0.8px] text-[var(--cr-muted)]">
            {MONTHS[view.m]} {view.y}
          </span>
        </div>
        {kinds.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {kinds.map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-[var(--cr-muted)]">
                <span aria-hidden className="size-2 rounded-full" style={{ background: CAL_COLOR[k] }} />
                {CAL_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-7 content-start justify-items-center gap-1 border-t border-[var(--cr-line)] pt-3 md:w-[19.5rem] md:border-l md:border-t-0 md:pl-6 md:pt-0">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={d + i} className="pb-0.5 text-[11px] tracking-wide text-[var(--cr-muted)]">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={'pad' + i} />;
          const k = key(d);
          const isToday = k === todayKey;
          const isSel = k === selected;
          const past = k < todayKey;
          const dots = byDay.get(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(isSel ? null : k)}
              title={day(k) + (dots !== undefined ? ' · ' + dots.map((x) => CAL_LABEL[x].toLowerCase()).join(', ') : '')}
              className={cn('num flex h-9 w-8 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold transition-colors', isToday || isSel ? 'bg-[var(--cr-accent)] text-[var(--cr-on-accent)]' : past ? 'bg-[var(--cr-ink)] text-[var(--cr-card)] hover:opacity-85' : 'border-[1.5px] border-[var(--cr-line)] text-[var(--cr-muted)] hover:border-[var(--cr-muted)]')}
            >
              <span>{d}</span>
              {dots !== undefined && (
                <span className="flex gap-0.5">
                  {dots.slice(0, 3).map((x) => (
                    <span key={x} aria-hidden className="size-1 rounded-full" style={{ background: isToday || isSel || past ? 'rgba(255,255,255,0.85)' : CAL_COLOR[x] }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 border-t border-[var(--cr-line)] pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
        {selected === null ? (
          <div>
            <p className="cr-label mb-1.5">{MONTHS[view.m]}</p>
            <p className="text-[12.5px] text-[var(--cr-muted)]">{events.length === 0 ? 'Nothing dated this month.' : events.length + ' dated item' + (events.length === 1 ? '' : 's') + ' this month. Pick a day to see them.'}</p>
            {events.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {(Object.keys(CAL_LABEL) as CalendarKind[])
                  .filter((k) => events.some((e) => e.kind === k))
                  .map((k) => (
                    <p key={k} className="flex items-center gap-2 text-[12.5px]">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: CAL_COLOR[k] }} />
                      <span className="min-w-0 flex-1">{CAL_LABEL[k]}</span>
                      <span className="num font-semibold">{events.filter((e) => e.kind === k).length}</span>
                    </p>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="cr-label mb-1.5">{day(selected)}</p>
            {list.length === 0 ? (
              <p className="text-[12.5px] text-[var(--cr-muted)]">Nothing on this day.</p>
            ) : (
              <div className="flex flex-col">
                {list.map((e, i) => (
                  <button key={e.kind + e.id + i} type="button" onClick={() => openEvent(e)} className="flex min-h-9 items-center gap-2.5 border-b border-[var(--cr-hair)] py-1 text-left last:border-0 hover:bg-[var(--cr-row)]">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: CAL_COLOR[e.kind] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{e.title}</span>
                      {e.sub !== '' && <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">{e.sub}</span>}
                    </span>
                    {e.kind === 'close' && e.value !== null && e.value !== undefined && <span className="num text-[12px] font-semibold">{compact(e.value, currency)}</span>}
                    <span className="text-[10px] uppercase tracking-wider text-[var(--cr-muted)]">{CAL_ONE[e.kind]}</span>
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


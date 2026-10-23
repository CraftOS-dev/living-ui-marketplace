/**
 * What every experiment screen shares: the kinds, statuses and outcomes with
 * their words and colours, times as people read them, and saving.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Beaker, CircleCheck, CircleHelp, CircleX, Cpu, FlaskConical, Microscope, TreePine, TriangleAlert, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import type { Params } from '../../lib/api.ts';
import { changed } from '../../lib/live.ts';
import type { ExpKind, ExpOutcome, ExpStatus, ExpVariable, Experiment, RunStatus, RunValue } from '../../lib/types.ts';

export const KIND: Record<ExpKind, { label: string; icon: LucideIcon; hint: string }> = {
  lab: { label: 'Lab bench', icon: Microscope, hint: 'Biology, medicine, materials' },
  chemistry: { label: 'Chemistry', icon: FlaskConical, hint: 'Synthesis, reactions, assays' },
  computational: { label: 'Simulation', icon: Cpu, hint: 'Code, models, parameter sweeps' },
  study: { label: 'Study', icon: Users, hint: 'People: surveys, trials, interviews' },
  field: { label: 'Field work', icon: TreePine, hint: 'Observations out in the world' },
  other: { label: 'Other', icon: Beaker, hint: 'Anything else you test' },
};

export const STATUS: Record<ExpStatus, { label: string; dot: string; text: string }> = {
  planned: { label: 'Planned', dot: 'var(--ro-muted)', text: 'var(--ro-ink-2)' },
  running: { label: 'Running', dot: 'var(--ro-accent)', text: 'var(--ro-accent-text)' },
  paused: { label: 'Paused', dot: 'var(--ro-amber)', text: 'var(--ro-amber-text)' },
  done: { label: 'Done', dot: 'var(--ro-green)', text: 'var(--ro-green-text)' },
  cancelled: { label: 'Cancelled', dot: 'var(--ro-line)', text: 'var(--ro-muted)' },
};
export const STATUS_ORDER: ExpStatus[] = ['running', 'paused', 'planned', 'done', 'cancelled'];

export const OUTCOME: Record<ExpOutcome, { label: string; short: string; icon: LucideIcon; text: string }> = {
  supports: { label: 'Supports the hypothesis', short: 'Supports', icon: CircleCheck, text: 'var(--ro-green-text)' },
  refutes: { label: 'Refutes the hypothesis', short: 'Refutes', icon: CircleX, text: 'var(--ro-red-text)' },
  inconclusive: { label: 'Inconclusive', short: 'Inconclusive', icon: CircleHelp, text: 'var(--ro-amber-text)' },
  failed: { label: 'Failed, run it again', short: 'Failed', icon: TriangleAlert, text: 'var(--ro-red-text)' },
};

export const RUN_STATUS: Record<RunStatus, { label: string; dot: string }> = {
  planned: { label: 'Planned', dot: 'var(--ro-muted)' },
  done: { label: 'Done', dot: 'var(--ro-green)' },
  failed: { label: 'Failed', dot: 'var(--ro-red)' },
  excluded: { label: 'Excluded', dot: 'var(--ro-line)' },
};

/* ------------------------------------------------------------------ time */

/** "2026-10-22 05:03:01.123Z" as a Date. */
export const parseAt = (at: string): Date => new Date(at.replace(' ', 'T'));
const pad = (n: number): string => (n < 10 ? '0' : '') + n;
export const clock = (at: string): string => {
  const d = parseAt(at);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
/** "2 h 14 min", "3 d 4 h", "12 min". */
export function span(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 48) return h + ' h ' + (m % 60) + ' min';
  return Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
}
/** Time since the start: "T+1:12", "T+2d 3h", or "T-0:15" before it. */
export function tplus(start: string, at: string): string {
  if (start === '') return '';
  const ms = parseAt(at).getTime() - parseAt(start).getTime();
  const sign = ms < 0 ? '-' : '+';
  const m = Math.floor(Math.abs(ms) / 60000);
  const h = Math.floor(m / 60);
  if (h >= 48) return 'T' + sign + Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  return 'T' + sign + h + ':' + String(m % 60).padStart(2, '0');
}
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
export const dayLabel = (d: Date): string => DAY_FMT.format(d);
export const shortDate = (d: Date): string => DATE_FMT.format(d);
/** "2026-11-02" as a local Date at noon (no time-zone slip). */
export const dayDate = (day: string): Date => new Date(day + 'T12:00:00');

export function useNow(every: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setT(Date.now()), every);
    return () => window.clearInterval(h);
  }, [every]);
  return t;
}

/** When, in a few words: "Starts 2 Nov", "Running 2 h 14 min", "Ran 3 d, ended 20 Oct". */
export function whenText(e: Experiment, now: number): string {
  const started = e.started_at !== '' ? parseAt(e.started_at) : null;
  const ended = e.ended_at !== '' ? parseAt(e.ended_at) : null;
  if (e.status === 'planned') return e.planned_start !== '' ? 'Starts ' + shortDate(dayDate(e.planned_start)) : 'Not scheduled';
  if ((e.status === 'running' || e.status === 'paused') && started !== null) return (e.status === 'paused' ? 'Paused, ' : 'Running ') + span(now - started.getTime());
  if (started !== null && ended !== null) return 'Ran ' + span(ended.getTime() - started.getTime()) + ', ended ' + shortDate(ended);
  return '';
}

/* ---------------------------------------------------------------- values */

/** A number as people read it: no float noise, at most 4 or 5 significant digits. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(Math.abs(n) >= 1 ? 5 : 4)));
}

export function shownValue(v: ExpVariable, val: RunValue | undefined): string {
  if (val === undefined || val === null) return '';
  if (v.type === 'yesno') return val === true ? 'Yes' : 'No';
  if (typeof val === 'number') return fmt(val);
  return String(val);
}

/** A new item's id, in the form the server keeps (8 lowercase letters or digits). */
export const newId = (): string => Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36))).join('');

/* --------------------------------------------------------------- saving */

// Saves to one experiment go one at a time, in the order they were made: a save
// sends whole lists (variables, steps, materials), so an older one landing last
// would undo a newer one. While any are on their way, editors keep what was typed
// (see `saving`) instead of taking the server's copy from between two saves.
const queue = new Map<string, Promise<unknown>>();
const inFlight = new Map<string, number>();

export const saving = (id: string): boolean => (inFlight.get(id) ?? 0) > 0;

export function saveExp(id: string, patch: Params): Promise<Experiment | null> {
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  const run = (queue.get(id) ?? Promise.resolve()).then(async () => {
    let out: Experiment | null = null;
    try {
      out = (await op<{ experiment: Experiment }>('exp.update', { experiment: id, ...patch })).experiment;
    } catch {
      /* toasted */
    }
    inFlight.set(id, (inFlight.get(id) ?? 1) - 1);
    // Only a status change writes the journal and moves the project's counts.
    if (out !== null) changed('experiments', ...('status' in patch ? (['exp_log', 'projects'] as const) : []));
    return out;
  });
  queue.set(id, run);
  void run.then(() => {
    if (queue.get(id) === run) queue.delete(id);
  });
  return run;
}

/* -------------------------------------------------------------- pieces */

export function StatusChip({ status, className }: { status: ExpStatus; className?: string }): React.JSX.Element {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-2 text-[12px] font-semibold', className)} style={{ color: s.text }}>
      <span className={cn('size-2 rounded-full', status === 'running' && 'animate-pulse')} style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

export function OutcomeFlag({ outcome, short = false, className }: { outcome: ExpOutcome | ''; short?: boolean; className?: string }): React.JSX.Element | null {
  if (outcome === '') return null;
  const o = OUTCOME[outcome];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold', className)} style={{ color: o.text }} title={o.label}>
      <o.icon size={13} /> {short ? o.short : o.label}
    </span>
  );
}

export function KindLabel({ kind, className }: { kind: ExpKind; className?: string }): React.JSX.Element {
  const K = KIND[kind];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ro-ink-2)]', className)}>
      <K.icon size={13} className="shrink-0 text-[var(--ro-muted)]" /> <span className="truncate">{K.label}</span>
    </span>
  );
}

export function RunsBar({ e, className }: { e: Experiment; className?: string }): React.JSX.Element {
  const c = e.counts;
  if (c.runs === 0) return <span className={cn('text-[12px] text-[var(--ro-muted)]', className)}>No runs</span>;
  return (
    <span className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="num text-[12px] text-[var(--ro-ink-2)]">
        {c.done}/{c.runs} runs{c.failed > 0 && <span className="text-[var(--ro-red-text)]"> · {c.failed} failed</span>}
      </span>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-[var(--ro-row-hover)]">
        <span style={{ width: `${(100 * c.done) / c.runs}%`, background: 'var(--ro-green)' }} />
        <span style={{ width: `${(100 * c.failed) / c.runs}%`, background: 'var(--ro-red)' }} />
      </span>
    </span>
  );
}

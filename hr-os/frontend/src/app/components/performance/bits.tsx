/**
 * Small pieces the performance pages share: quiet progress bars, goal
 * status dots, the rating scale as a segmented control, the phase strip of
 * a cycle, the rating distribution as quiet bars, company value icons and
 * the people picker. Built from components/ui.tsx and the --hr-* tokens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Award, BookOpen, ChevronRight, Compass, Flag, Flame, Gem, Handshake, Heart, Leaf, Lightbulb, Mountain, Rocket, Scale, ShieldCheck, Smile, Star, Sun, Target, Users, Zap } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Picker, StatusDot, Tag } from '../ui.tsx';
import type { PickItem, Tone } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, relDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import type { Goal, GoalStatus, Phase, ReviewKind, Scale as RatingScale, Stage } from './types.ts';

export const GOAL_TONE: Record<GoalStatus, Tone> = { on_track: 'good', at_risk: 'warn', off_track: 'bad', done: 'neutral', dropped: 'faint' };
export const STAGE_TONE: Record<Stage, Tone> = { open: 'faint', submitted: 'rh', shared: 'lh', acknowledged: 'good', signoff: 'warn', signed: 'good', removed: 'faint' };

/** The one link style in a panel header: mono caps, no underline, ink on hover, a 40 px touch area. */
export function AsideLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
  return (
    <a href={href} className="hr-focus hr-label hit inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">
      {children}
      <ChevronRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

export function GoalStatusDot({ status, className }: { status: GoalStatus; className?: string | undefined }): React.JSX.Element {
  return <StatusDot tone={GOAL_TONE[status]} label={t(`perf.goal.status.${status}`)} className={className} />;
}

/** A quiet progress bar: hairline track, ink fill (status colour only when it means something). */
export function ProgressBar({ value, status, className, label }: { value: number; status?: GoalStatus | undefined; className?: string | undefined; label?: string | undefined }): React.JSX.Element {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const fill = status === 'off_track' ? 'bg-[var(--hr-bad)]' : status === 'at_risk' ? 'bg-[var(--hr-warn)]' : status === 'dropped' ? 'bg-[var(--hr-line-2)]' : 'bg-[var(--hr-ink-2)]';
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? t('perf.progress')} className="h-1.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-[var(--hr-sunk)] ring-1 ring-inset ring-[var(--hr-hair)]">
        <div className={cn('h-full rounded-full transition-[width] duration-300 ease-out', fill)} style={{ width: `${v}%` }} />
      </div>
      <span className="hr-mono hr-num w-9 shrink-0 text-right text-[12px] text-[var(--hr-ink-2)]">{v}%</span>
    </div>
  );
}

/** Why a goal needs an update, as short tags. */
export function Reasons({ goal, withStatus }: { goal: Goal; withStatus?: boolean | undefined }): React.JSX.Element | null {
  const list = goal.reasons.filter((r) => withStatus === true || (r !== 'at_risk' && r !== 'off_track'));
  if (list.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {list.map((r) => (
        <Tag key={r} tone={r === 'off_track' || r === 'overdue' ? 'bad' : r === 'at_risk' || r === 'due_soon' ? 'warn' : 'faint'}>
          {t(`perf.reason.${r}`)}
        </Tag>
      ))}
    </span>
  );
}

/** The rating scale as a segmented control: whole numbers with their labels. */
export function RatingScaleInput({ scale, value, onChange, disabled, label, compact }: { scale: RatingScale; value: number; onChange: (v: number) => void; disabled?: boolean | undefined; label: string; compact?: boolean | undefined }): React.JSX.Element {
  const points = Array.from({ length: scale.points }, (_, i) => i + 1);
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex w-full min-w-0 flex-wrap gap-1', disabled === true && 'opacity-70')}>
      {points.map((n) => {
        const on = value === n;
        const name = scale.labels[n - 1] ?? String(n);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${n} ${name}`}
            title={name}
            disabled={disabled}
            onClick={() => onChange(on ? 0 : n)}
            className={cn(
              'hr-focus hit flex min-w-0 flex-1 basis-[64px] flex-col items-start justify-center rounded-[var(--hr-radius-sm)] border px-2 text-left transition-colors disabled:cursor-default',
              compact === true ? 'h-8' : 'h-11',
              on ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink-2)] enabled:hover:border-[var(--hr-line-2)] enabled:hover:bg-[var(--hr-hover)]',
            )}
          >
            <span className="hr-mono hr-num text-[12px] leading-none">{n}</span>
            {compact !== true && <span className="mt-0.5 w-full truncate text-[12px] leading-tight">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The phases of a cycle as a strip of hairline segments, today marked. */
export function PhaseStrip({ phases, today, className }: { phases: Phase[]; today: string; className?: string | undefined }): React.JSX.Element | null {
  if (phases.length === 0) return null;
  const start = phases.reduce((m, p) => (p.start < m ? p.start : m), phases[0]?.start ?? today);
  const end = phases.reduce((m, p) => (p.end > m ? p.end : m), phases[0]?.end ?? today);
  const span = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const at = (d: string): number => Math.max(0, Math.min(100, (((Date.parse(d) - Date.parse(start)) / 86400000) / span) * 100));
  const todayPos = today >= start && today <= end ? at(today) : null;
  return (
    <div className={cn('min-w-0', className)}>
      <div className="relative flex flex-col gap-1">
        {phases.map((p) => (
          <div key={p.key} className="grid grid-cols-[110px_1fr] items-center gap-3 sm:grid-cols-[140px_1fr]">
            <span className={cn('truncate text-[12px]', p.state === 'open' ? 'font-medium text-[var(--hr-ink)]' : 'text-[var(--hr-muted)]')}>{t(`perf.phase.${p.key}`)}</span>
            <div className="relative h-5">
              <div className="absolute inset-y-[9px] left-0 right-0 bg-[var(--hr-hair)]" />
              <div
                title={`${fmtDay(p.start)} to ${fmtDay(p.end)}`}
                className={cn('absolute inset-y-[5px] rounded-[3px] border', p.state === 'open' ? 'border-[var(--hr-ink-2)] bg-[var(--hr-ink-2)]' : p.state === 'done' ? 'border-[var(--hr-line-2)] bg-[var(--hr-line)]' : 'border-[var(--hr-line-2)] bg-[var(--hr-raised)]')}
                style={{ left: `${at(p.start)}%`, width: `${Math.max(2, at(p.end) - at(p.start) + 100 / span)}%` }}
              />
            </div>
          </div>
        ))}
        {todayPos !== null && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 grid w-full grid-cols-[110px_1fr] gap-3 sm:grid-cols-[140px_1fr]">
            <span />
            <span className="relative">
              <span className="absolute inset-y-0 w-px bg-[var(--hr-rh)]" style={{ left: `${todayPos}%` }} />
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-[110px_1fr] gap-3 sm:grid-cols-[140px_1fr]">
        <span />
        <div className="hr-label flex justify-between">
          <span>{fmtDay(start)}</span>
          <span>{fmtDay(end)}</span>
        </div>
      </div>
    </div>
  );
}

/** The phase a person is in now, in words ("Self reviews, 6 days left"). */
export function phaseNow(phases: Phase[], today: string): string {
  const open = phases.filter((p) => p.state === 'open');
  if (open.length === 0) {
    const next = phases.find((p) => p.state === 'upcoming');
    return next !== undefined ? t('perf.phase.starts', { phase: t(`perf.phase.${next.key}`), when: relDay(next.start, today) }) : t('perf.phase.all_done');
  }
  return open.map((p) => t(`perf.phase.${p.key}`)).join(', ');
}

/** The distribution of ratings as quiet horizontal bars, one per rating value. */
export function DistributionBars({ counts, labels, total, className }: { counts: number[]; labels: string[]; total: number; className?: string | undefined }): React.JSX.Element {
  const max = Math.max(1, ...counts);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {counts.map((n, i) => (
        <div key={i} className="grid grid-cols-[minmax(80px,140px)_1fr_64px] items-center gap-2">
          <span className="truncate text-[12px] text-[var(--hr-ink-2)]" title={labels[i]}>
            <span className="hr-mono mr-1.5 text-[var(--hr-faint)]">{i + 1}</span>
            {labels[i] ?? ''}
          </span>
          <div className="h-3 overflow-hidden rounded-[2px] bg-[var(--hr-sunk)]">
            <div className="h-full rounded-[2px] bg-[var(--hr-rh)] transition-[width] duration-300 ease-out" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="hr-mono hr-num text-right text-[12px] text-[var(--hr-ink-2)]">
            {n}
            <span className="text-[var(--hr-faint)]"> {total > 0 ? `${Math.round((n / total) * 100)}%` : ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const VALUE_ICONS: Record<string, LucideIcon> = { Heart, Star, Rocket, Users, Lightbulb, ShieldCheck, Target, Handshake, Zap, Leaf, Compass, Award, Smile, Flag, Gem, Mountain, Sun, Flame, BookOpen, Scale };

export function valueIcon(name: string): LucideIcon {
  return VALUE_ICONS[name] ?? Star;
}

export function ValueTag({ name, icon }: { name: string; icon: string }): React.JSX.Element {
  const Icon = valueIcon(icon);
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-[4px] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-1.5 text-[12px] text-[var(--hr-ink-2)]">
      <Icon size={12} strokeWidth={1.9} aria-hidden />
      {name}
    </span>
  );
}

export function kindLabel(kind: ReviewKind): string {
  return t(`perf.kind.${kind}`);
}

interface DirRow {
  employee: string;
  number: string;
  name: string;
  title: string;
  department_name: string;
}

/** People the caller may see, for pickers (searches as you type). */
export function usePeopleItems(): { items: PickItem[]; onSearch: (q: string) => void } {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DirRow[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    const h = setTimeout(() => {
      op<{ people: DirRow[] }>('people.directory', { q: q === '' ? undefined : q, limit: 50 }, { quiet: true, signal: ctrl.signal })
        .then((r) => setRows(r.people))
        .catch(() => setRows([]));
    }, 150);
    return () => {
      clearTimeout(h);
      ctrl.abort();
    };
  }, [q]);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: PickItem[] = [];
    for (const r of rows) {
      if (seen.has(r.employee)) continue;
      seen.add(r.employee);
      out.push({ value: r.employee, label: r.name, sub: [r.title, r.department_name].filter((x) => x !== '').join(' · '), person: true });
    }
    return out;
  }, [rows]);
  return { items, onSearch: setQ };
}

/** A person picker over the directory. */
export function PersonPicker({ value, onChange, label, placeholder, className, exclude }: { value: string; onChange: (id: string, item: PickItem | null) => void; label: string; placeholder?: string | undefined; className?: string | undefined; exclude?: string[] | undefined }): React.JSX.Element {
  const { items, onSearch } = usePeopleItems();
  const [chosen, setChosen] = useState<PickItem | null>(null);
  const list = useMemo(() => {
    const base = items.filter((i) => exclude === undefined || !exclude.includes(i.value));
    if (chosen !== null && chosen.value === value && !base.some((i) => i.value === value)) return [chosen, ...base];
    return base;
  }, [items, exclude, chosen, value]);
  return (
    <Picker
      value={value}
      onChange={(v, item) => {
        setChosen(item);
        onChange(v, item);
      }}
      items={list}
      label={label}
      placeholder={placeholder}
      onSearch={onSearch}
      className={className}
    />
  );
}

/** "due in 3 days" / "3 days late". */
export function dueText(day: string, today: string): string {
  if (day === '') return '';
  return day < today ? t('perf.late', { when: relDay(day, today) }) : t('perf.due', { when: relDay(day, today) });
}

/** Scroll pagination: a sentinel that calls `onMore` when it comes into view (never a "Show more" button). */
export function MoreOnScroll({ onMore, hasMore, loading }: { onMore: () => void; hasMore: boolean; loading?: boolean | undefined }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && loading !== true) onMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, hasMore, loading]);
  if (!hasMore) return null;
  return <div ref={ref} aria-hidden className="h-6" />;
}

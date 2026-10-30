/**
 * Home, in the Company OS layout: blocks floating on the page that answer,
 * top to bottom, how the business is doing (the headline numbers against
 * the period before, won by month running into what the pipeline should
 * bring, your network as a constellation), how deals move (a year of deals
 * flowing stage to stage) and what needs you, the month ahead (the Command
 * Center calendar), then the pipeline by stage, won and lost, the round and
 * hiring, interactions, sources, what is coming up and what the AI agent
 * did. The money numbers are revenue only: fundraising and hiring have
 * their own blocks. Every block opens where the work is.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BellDot, Cake, CalendarClock, ChartColumn, ChartPie, CircleCheck, Clock, Handshake, Kanban, ListTodo, PiggyBank, Sparkles, Undo2, UserPlus, Users, Waypoints, Workflow } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago, compact, day, initials, money, monthName, relDay, stageColor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Dashboard } from '../lib/types.ts';
import { BarChart, CAT, CountUp, Donut, Legend, Sparkline, StackBar, StackedBars } from '../components/charts.tsx';
import { Avatar, Dot } from '../components/controls.tsx';
import { HeaderActions } from '../components/Shell.tsx';
import { Btn, Select, Spinner, useConfirm } from '../components/ui.tsx';
import { Constellation, MonthCalendar, PipelineFlow, RevenueTrend } from '../components/viz.tsx';
import type { TrendMonth } from '../components/viz.tsx';

type Range = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_12_months';

const RANGE_LABEL: Record<Range, string> = { this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', ytd: 'Year to date', last_12_months: '12 months' };
const PREV_LABEL: Record<Range, string> = { this_month: 'vs last month', last_month: 'vs the month before', this_quarter: 'vs last quarter', ytd: 'vs last year', last_12_months: 'vs the 12 months before' };

/* ------------------------------------------------------------------ pieces */

function Delta({ now, before, good = 'up', label, unit = 'pct' }: { now: number | null; before: number | null; good?: 'up' | 'down' | undefined; label: string; unit?: 'pct' | 'pts' | 'days' | undefined }): React.JSX.Element {
  if (now === null || before === null || (unit === 'pct' && before === 0)) return <span className="text-[11.5px] text-[var(--cr-muted)]">{label}</span>;
  const diff = unit === 'pct' ? ((now - before) / Math.abs(before)) * 100 : now - before;
  if (!isFinite(diff)) return <span className="text-[11.5px] text-[var(--cr-muted)]">{label}</span>;
  const up = diff >= 0;
  const positive = good === 'up' ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const shown = unit === 'pct' ? (Math.abs(diff) >= 1000 ? '999+' : Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)) + '%' : unit === 'pts' ? Math.abs(diff).toFixed(0) + ' pts' : Math.abs(Math.round(diff)) + ' d';
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
      <span className={cn('inline-flex items-center gap-0.5 px-1 font-semibold', Math.abs(diff) < 0.5 ? 'bg-[var(--cr-row)] text-[var(--cr-ink-2)]' : positive ? 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]' : 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]')}>
        <Icon size={11} strokeWidth={2.6} />
        <span className="num">{shown}</span>
      </span>
      <span className="truncate text-[var(--cr-muted)]">{label}</span>
    </span>
  );
}

/** A headline number in its own block (the Company OS stat tile), with a trend where there is one. */
function Tile({ label, value, sub, spark, onClick, title, delay }: { label: string; value: ReactNode; sub: ReactNode; spark?: number[] | undefined; onClick: () => void; title?: string | undefined; delay: number }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title} className="cr-block cr-rise group flex min-w-0 flex-col gap-1 px-4 py-3 text-left transition-colors hover:border-[var(--cr-muted)]" style={{ animationDelay: `${delay}ms` }}>
      <span className="flex items-center justify-between gap-2">
        <span className="cr-label truncate">{label}</span>
        <ArrowRight size={12} className="shrink-0 -translate-x-1 text-[var(--cr-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="num shrink-0 text-[22px] font-semibold leading-7 tracking-tight">{value}</span>
        {spark !== undefined && spark.some((v) => v !== 0) && <Sparkline values={spark} width={72} height={24} color="var(--cr-accent)" className="mb-1 hidden sm:block" />}
      </span>
      <span className="min-h-[18px]">{sub}</span>
    </button>
  );
}

/** A block with a header (the Company OS section). */
function Block({ icon: Icon, title, meta, action, children, className, flush = false, delay = 0 }: { icon: LucideIcon; title: string; meta?: ReactNode | undefined; action?: ReactNode | undefined; children: ReactNode; className?: string | undefined; flush?: boolean | undefined; delay?: number | undefined }): React.JSX.Element {
  return (
    <section className={cn('cr-block cr-rise flex min-w-0 flex-col', className)} style={{ animationDelay: `${delay}ms` }}>
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--cr-line)] px-4 py-2">
        <Icon size={14} className="shrink-0 text-[var(--cr-muted)]" />
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        {meta !== undefined && <span className="hidden truncate text-[12px] text-[var(--cr-muted)] sm:inline">{meta}</span>}
        <span className="flex-1" />
        {action}
      </header>
      <div className={cn('min-h-0 flex-1', !flush && 'p-4')}>{children}</div>
    </section>
  );
}

function Open({ onClick, label = 'Open' }: { onClick: () => void; label?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--cr-ink-2)] hover:text-[var(--cr-accent-text)]">
      {label} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Period" className="cr-block flex h-8 max-w-full items-center overflow-x-auto">
      {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
        <button key={r} type="button" role="radio" aria-checked={r === value} onClick={() => onChange(r)} className={cn('h-full shrink-0 whitespace-nowrap px-2.5 text-[12px] font-medium transition-colors', r === value ? 'bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]')}>
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ blocks */

function StageBars({ d }: { d: Dashboard }): React.JSX.Element {
  const p = d.pipeline;
  if (p === null)
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-[12.5px] text-[var(--cr-muted)]">No sales pipeline yet: the money numbers count sales and partnership pipelines.</p>
        <Btn size="xs" variant="ghost" icon={Kanban} onClick={() => go('setup', { tab: 'pipelines' })}>
          Add one in Setup
        </Btn>
      </div>
    );
  if (p.stages.length === 0) return <p className="py-8 text-center text-[12.5px] text-[var(--cr-muted)]">No open stages.</p>;
  const max = Math.max(1, ...p.stages.map((s) => s.value));
  return (
    <ul className="flex flex-col gap-1.5">
      {p.stages.map((s, i) => (
        <li key={s.id}>
          <button type="button" onClick={() => go('deals', { pipeline: p.pipeline.id })} className="grid w-full grid-cols-[110px_minmax(0,1fr)_104px] items-center gap-3 py-0.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Dot color={stageColor(s.color)} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="relative h-4 overflow-hidden bg-[var(--cr-row)]" title={money(s.value, d.currency) + ' · weighted ' + money(s.weighted, d.currency) + ' at ' + s.probability + '%'}>
              <span className="cr-grow-x absolute inset-y-0 left-0 opacity-30" style={{ width: `${(s.value / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60}ms` }} />
              <span className="cr-grow-x absolute inset-y-0 left-0" style={{ width: `${(s.weighted / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60 + 120}ms` }} />
              {s.rotting > 0 && (
                <span className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 text-[10.5px] font-bold text-[var(--cr-neg-text)]" title={s.rotting + ' rotting'}>
                  <Clock size={10} /> {s.rotting}
                </span>
              )}
            </span>
            <span className="num text-right">
              {s.count === 0 ? (
                <span className="text-[var(--cr-muted)]">–</span>
              ) : (
                <>
                  <span className="font-semibold">{compact(s.value, d.currency)}</span>
                  <span className="ml-1.5 text-[11.5px] text-[var(--cr-muted)]">{s.count}</span>
                </>
              )}
            </span>
          </button>
        </li>
      ))}
      <li className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--cr-hair)] pt-2 text-[12px] text-[var(--cr-ink-2)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 bg-[var(--cr-ink-2)] opacity-30" /> Value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 bg-[var(--cr-ink-2)]" /> Weighted
        </span>
        <span className="flex-1" />
        <span className="num font-semibold">
          {compact(p.total.value, d.currency)} · {compact(p.total.weighted, d.currency)} weighted
        </span>
      </li>
    </ul>
  );
}

function Attention({ d }: { d: Dashboard }): React.JSX.Element {
  const a = d.attention;
  const rows: { icon: LucideIcon; text: ReactNode; go: () => void; tone?: 'neg' | 'warn' | undefined; extra?: ReactNode }[] = [];
  if (a.overdue + a.today > 0)
    rows.push({
      icon: ListTodo,
      tone: a.overdue > 0 ? 'neg' : undefined,
      text: (
        <>
          {a.overdue > 0 && (
            <>
              <b className="num">{a.overdue}</b> task{a.overdue === 1 ? '' : 's'} overdue{a.today > 0 ? ', ' : ''}
            </>
          )}
          {a.today > 0 && (
            <>
              <b className="num">{a.today}</b> due today
            </>
          )}
        </>
      ),
      go: () => go('today'),
    });
  if (a.rotting_count > 0)
    rows.push({
      icon: Clock,
      tone: 'neg',
      text: (
        <>
          <b className="num">{a.rotting_count}</b> deal{a.rotting_count === 1 ? '' : 's'} going stale
        </>
      ),
      go: () => go('deals', { mode: 'table', preset: 'rotting' }),
      extra: (
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--cr-muted)]">
          {a.rotting
            .slice(0, 3)
            .map((x) => x.name + ' (' + x.idle_days + ' d)')
            .join(' · ')}
        </span>
      ),
    });
  if (a.no_next_step > 0)
    rows.push({
      icon: CalendarClock,
      tone: 'warn',
      text: (
        <>
          <b className="num">{a.no_next_step}</b> open deal{a.no_next_step === 1 ? '' : 's'} without a next step
        </>
      ),
      go: () => go('deals', { mode: 'table', preset: 'no_next_step' }),
    });
  if (a.keep_in_touch > 0)
    rows.push({
      icon: Users,
      text: (
        <>
          <b className="num">{a.keep_in_touch}</b> {a.keep_in_touch === 1 ? 'person' : 'people'} to get back in touch with
        </>
      ),
      go: () => go('people', { preset: 'keep_in_touch' }),
      extra: (
        <span className="mt-1 flex -space-x-1">
          {a.keep_list.slice(0, 7).map((p) => (
            <span key={p.id} title={p.name} className="rounded-full ring-2 ring-[var(--cr-card)]">
              <Avatar name={p.name} size={18} />
            </span>
          ))}
        </span>
      ),
    });
  if (a.birthdays.length > 0)
    rows.push({
      icon: Cake,
      text: (
        <>
          {a.birthdays
            .slice(0, 2)
            .map((b) => b.name + (b.in_days === 0 ? ' today' : ' in ' + b.in_days + ' d'))
            .join(', ')}
          {a.birthdays.length > 2 ? ' and ' + (a.birthdays.length - 2) + ' more' : ''}
        </>
      ),
      go: () => go('people', { preset: 'birthdays' }),
    });
  if (rows.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <CircleCheck size={22} className="text-[var(--cr-pos)]" />
        <p className="text-[13px] font-semibold">All caught up</p>
        <p className="text-[12px] text-[var(--cr-muted)]">No overdue tasks, stale deals or people waiting on you.</p>
      </div>
    );
  return (
    <ul>
      {rows.map((r, i) => {
        const Icon = r.icon;
        return (
          <li key={i}>
            <button type="button" onClick={r.go} className="group flex w-full items-start gap-3 border-b border-[var(--cr-hair)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--cr-row)]">
              <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center', r.tone === 'neg' ? 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]' : r.tone === 'warn' ? 'bg-[var(--cr-warn-soft)] text-[var(--cr-warn-text)]' : 'bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]')}>
                <Icon size={13} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-[18px]">
                {r.text}
                {r.extra}
              </span>
              <ArrowRight size={13} className="mt-1 shrink-0 -translate-x-1 text-[var(--cr-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AgentBlock({ d }: { d: Dashboard }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const run = d.agent.runs[0];
  return (
    <Block icon={Sparkles} title="Your AI agent" delay={360} action={<Open onClick={() => go('activity', { tab: 'runs' })} label="All runs" />}>
      {confirmEl}
      <div className="grid grid-cols-2 gap-px border border-[var(--cr-line)] bg-[var(--cr-line)]">
        {[
          { n: d.agent.proposals, l: 'changes to review', go: () => go('review') },
          { n: d.agent.working, l: 'jobs in hand', go: () => go('activity', { tab: 'runs' }) },
        ].map((x) => (
          <button key={x.l} type="button" onClick={x.go} className="flex flex-col items-start bg-[var(--cr-card)] px-3 py-2 text-left hover:bg-[var(--cr-row)]">
            <span className="num text-[20px] font-semibold leading-7 text-[var(--cr-accent-text)]">
              <CountUp value={x.n} format={(v) => String(v)} />
            </span>
            <span className="text-[11.5px] text-[var(--cr-muted)]">{x.l}</span>
          </button>
        ))}
      </div>
      {run !== undefined ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px]">
            <Sparkles size={12} className="text-[var(--cr-accent-text)]" />
            <span className="font-semibold">Last run {ago(run.last)}</span>
            <span className="text-[var(--cr-muted)]">· {run.changes} change{run.changes === 1 ? '' : 's'}</span>
            <span className="flex-1" />
            {run.undone < run.changes && (
              <Btn
                size="xs"
                variant="ghost"
                icon={Undo2}
                onClick={() =>
                  void confirm('Every change in this run is undone, newest first; changes made since to the same records are skipped.', 'Revert this AI run?', 'Revert').then((ok) => {
                    if (ok)
                      api
                        .revertRun(run.run)
                        .then((x) => toast.success('Reverted ' + x.reverted))
                        .catch((err: unknown) => toast.error(errMessage(err)));
                  })
                }
              >
                Revert
              </Btn>
            )}
          </div>
          <ul className="mt-1.5 flex flex-col">
            {run.summaries.slice(0, 5).map((s, i) => (
              <li key={i} className="truncate border-t border-[var(--cr-hair)] py-1.5 text-[12px] text-[var(--cr-ink-2)]">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] leading-[18px] text-[var(--cr-muted)]">When your AI agent researches people, reviews your meetings or drafts follow-ups, its work shows here. Everything it changes can be reverted.</p>
      )}
    </Block>
  );
}

/** A fundraising or hiring pipeline: committed against the round, or hires, and who is where. */
function OtherPipeline({ p, ccy, delay }: { p: Dashboard['others'][number]; ccy: string; delay: number }): React.JSX.Element {
  const fund = p.pipeline.kind === 'fundraising';
  const target = p.pipeline.target_home ?? 0;
  const scale = Math.max(1, target, p.won.value + p.total.weighted);
  const maxV = Math.max(1, ...p.stages.map((s) => (fund ? s.value : s.count)));
  const empty = p.total.count === 0 && p.won.count === 0;
  const board = (): void => go('deals', { pipeline: p.pipeline.id });
  return (
    <Block icon={fund ? PiggyBank : UserPlus} delay={delay} title={p.pipeline.name} meta={fund ? 'Your round' : 'Candidates by stage'} action={<Open onClick={board} label="Board" />}>
      {empty ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--cr-muted)]">{fund ? 'No investors in this pipeline yet.' : 'No candidates in this pipeline yet.'}</p>
      ) : (
        <>
          {fund ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="num text-[22px] font-semibold leading-7 tracking-tight">
                  <CountUp value={p.won.value} format={(v) => compact(v, ccy)} />
                </span>
                <span className="text-[12px] text-[var(--cr-muted)]">committed{target > 0 ? ' of ' + compact(target, ccy) : ''}</span>
                <span className="flex-1" />
                {target > 0 ? (
                  <span className="num text-[13px] font-semibold">{Math.round((p.won.value / target) * 100)}%</span>
                ) : (
                  <button type="button" onClick={() => go('setup', { tab: 'pipelines' })} className="text-[11.5px] font-medium text-[var(--cr-ink-2)] hover:text-[var(--cr-accent-text)]">
                    Set the round size
                  </button>
                )}
              </div>
              <div className="relative mt-2 h-2.5 overflow-hidden bg-[var(--cr-row)]" title={'Committed ' + money(p.won.value, ccy) + ' · weighted in talks ' + money(p.total.weighted, ccy) + (target > 0 ? ' · target ' + money(target, ccy) : '')}>
                <span className="cr-grow-x absolute inset-y-0 left-0 bg-[var(--cr-pos)]" style={{ width: `${(p.won.value / scale) * 100}%` }} />
                <span className="cr-grow-x absolute inset-y-0 bg-[var(--cr-accent)] opacity-40" style={{ left: `${(p.won.value / scale) * 100}%`, width: `${(p.total.weighted / scale) * 100}%`, animationDelay: '120ms' }} />
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--cr-ink-2)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 bg-[var(--cr-pos)]" /> {p.won.count} committed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 bg-[var(--cr-accent)] opacity-40" /> {compact(p.total.weighted, ccy)} weighted in talks
                </span>
                <span className="text-[var(--cr-muted)]">
                  {p.total.count} open conversation{p.total.count === 1 ? '' : 's'}
                </span>
              </p>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="num text-[22px] font-semibold leading-7">
                <CountUp value={p.won.count} format={(v) => String(v)} />
              </span>
              <span className="text-[12px] text-[var(--cr-muted)]">hired</span>
              <span className="mx-1 text-[var(--cr-line)]">|</span>
              <span className="num text-[15px] font-semibold">{p.total.count}</span>
              <span className="text-[12px] text-[var(--cr-muted)]">in process</span>
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {p.stages.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={board} className="grid w-full grid-cols-[112px_minmax(0,1fr)_72px] items-center gap-3 py-0.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Dot color={stageColor(s.color)} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="relative h-3.5 overflow-hidden bg-[var(--cr-row)]">
                    <span className="cr-grow-x absolute inset-y-0 left-0" style={{ width: `${((fund ? s.value : s.count) / maxV) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 50}ms` }} />
                  </span>
                  <span className="num text-right">
                    {s.count === 0 ? (
                      <span className="text-[var(--cr-muted)]">–</span>
                    ) : (
                      <>
                        {fund && <span className="font-semibold">{compact(s.value, ccy)}</span>}
                        <span className={cn(fund ? 'ml-1.5 text-[11.5px] text-[var(--cr-muted)]' : 'font-semibold')}>{s.count}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Block>
  );
}

const IX_SERIES = [
  { key: 'meeting', label: 'Meetings', color: 'var(--cr-c2)' },
  { key: 'call', label: 'Calls', color: 'var(--cr-c1)' },
  { key: 'email', label: 'Emails', color: 'var(--cr-c4)' },
  { key: 'message', label: 'Messages', color: 'var(--cr-c3)' },
];

/* -------------------------------------------------------------------- view */

export function HomeView(): React.JSX.Element {
  const app = useApp();
  const [range, setRange] = useState<Range>('this_month');
  const [pipeline, setPipeline] = useState('');
  const [briefing, setBriefing] = useState(false);
  const live = useLive(() => api.dashboard({ range, pipeline: pipeline || undefined }), ['deals', 'stage_events', 'interactions', 'tasks', 'people', 'proposals', 'activity', 'stages', 'fx_rates'], [range, pipeline], 700);
  useReportScreen('home', null, { range, pipeline });
  const d = live.data;
  const pipeRef = pipeline || d?.pipeline?.pipeline.id || '';
  const flow = useLive(() => (pipeRef === '' ? Promise.resolve(null) : api.funnel({ pipeline: pipeRef, range: 'last_12_months' })), ['deals', 'stage_events'], [pipeRef], 700);
  const trend: TrendMonth[] = useMemo(() => {
    if (d === null) return [];
    const f = d.forecast.months;
    const cur = f[0]?.month ?? '';
    const hist: TrendMonth[] = d.months.map((m) => (m.month === cur ? { month: m.month, won: m.won, expected: m.won + (f[0]?.weighted ?? 0), best: m.won + (f[0]?.best ?? 0) } : { month: m.month, won: m.won, expected: null, best: null }));
    return [...hist, ...f.slice(1).map((m) => ({ month: m.month, won: null, expected: m.won + m.weighted, best: m.won + m.best }))];
  }, [d]);
  const brief = (): void => {
    setBriefing(true);
    api
      .ask('Prepare my day: what matters today, who to follow up with, which deals are slipping, and drafts where a follow-up is due.', 'brief')
      .then((r) => toast.success(r.asked ? 'Asked your AI agent for a brief; it answers in Ask AI' : 'Queued for your AI agent: ' + r.reason))
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBriefing(false));
  };
  const header = (
    <HeaderActions>
      <RangeTabs value={range} onChange={setRange} />
      <button type="button" onClick={brief} disabled={briefing} className="cr-block inline-flex h-8 items-center gap-1.5 px-2.5 text-[12.5px] font-medium text-[var(--cr-ink)] transition-colors hover:border-[var(--cr-muted)] disabled:opacity-60">
        <Sparkles size={13} className="text-[var(--cr-accent-text)]" /> Brief me
      </button>
    </HeaderActions>
  );
  if (d === null)
    return (
      <div className="flex h-full items-center justify-center">
        {header}
        <Spinner size={18} />
      </div>
    );
  const k = d.kpi;
  const ccy = d.currency;
  const prev = PREV_LABEL[range];
  const mix = d.relationships.mix;
  const months6 = d.months.slice(-6);
  const firstWon = d.months.findIndex((m) => m.won !== 0 || m.lost !== 0);
  const wlMonths = firstWon < 0 ? d.months.slice(-6) : d.months.slice(Math.min(firstWon, d.months.length - 3));
  const expected6 = d.forecast.months.reduce((t, m) => t + m.weighted, 0);
  const best6 = d.forecast.months.reduce((t, m) => t + m.best, 0);
  const srcItems = d.sources.filter((s) => s.deals > 0).map((s, i) => ({ label: s.source, value: s.deals, color: s.source === 'Unknown' ? 'var(--cr-line)' : CAT(i) }));
  const others = d.others;
  const proposals = d.attention.proposals;
  return (
    <div className={cn('h-full overflow-y-auto', live.loading && 'opacity-90')}>
      {header}
      <div className="flex flex-col gap-2.5 pb-1">
        {proposals > 0 && (
          <div className="cr-rise flex flex-wrap items-center justify-between gap-3 border border-[color-mix(in_srgb,var(--cr-accent)_40%,transparent)] bg-[var(--cr-accent-soft)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center bg-[var(--cr-accent)] text-[var(--cr-on-accent)]">
                <Sparkles size={15} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">
                  {proposals} change{proposals === 1 ? '' : 's'} from your AI agent {proposals === 1 ? 'is' : 'are'} waiting for you
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--cr-ink-2)]">Each comes with the evidence behind it. Accept, edit or reject; nothing changes until you do.</p>
              </div>
            </div>
            <Btn variant="primary" size="sm" onClick={() => go('review')}>
              Review
            </Btn>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          <Tile delay={0} label="Open pipeline" value={<CountUp value={k.open_value} format={(v) => compact(v, ccy)} />} spark={d.trend.map((w) => w.deal_value)} sub={<span className="text-[11.5px] text-[var(--cr-muted)]">{k.open_count} open deal{k.open_count === 1 ? '' : 's'}{k.no_rate > 0 ? ' · ' + k.no_rate + ' without a rate' : ''}</span>} onClick={() => go('deals')} title="Sum of open deals' values in your home currency; the line is new pipeline per week" />
          <Tile delay={30} label="Weighted forecast" value={<CountUp value={k.weighted} format={(v) => compact(v, ccy)} />} sub={<span className="text-[11.5px] text-[var(--cr-muted)]">value x stage probability</span>} onClick={() => go('reports', { r: 'forecast' })} title="Sum over open deals of value x probability" />
          <Tile delay={60} label="Won" value={<CountUp value={k.won_value} format={(v) => compact(v, ccy)} />} spark={months6.map((m) => m.won)} sub={<Delta now={k.won_value} before={k.won_prev_value} label={k.won_count + ' deal' + (k.won_count === 1 ? '' : 's') + ' ' + prev} />} onClick={() => go('reports', { r: 'winloss' })} />
          <Tile delay={90} label="Win rate" value={k.win_rate === null ? '–' : <CountUp value={Math.round(k.win_rate)} format={(v) => v + '%'} />} spark={d.months.filter((m) => m.win_rate !== null).map((m) => m.win_rate as number).slice(-6)} sub={<Delta now={k.win_rate} before={k.win_rate_prev} unit="pts" label={prev} />} onClick={() => go('reports', { r: 'winloss' })} title="Won / (won + lost) among deals closed in the period" />
          <Tile delay={120} label="Average deal" value={k.avg_deal === null ? '–' : <CountUp value={k.avg_deal} format={(v) => compact(v, ccy)} />} sub={<Delta now={k.avg_deal} before={k.avg_deal_prev} label={prev} />} onClick={() => go('reports', { r: 'winloss' })} title="Won value / won deals in the period" />
          <Tile delay={150} label="Sales cycle" value={k.cycle_days === null ? '–' : <CountUp value={k.cycle_days} format={(v) => v + ' d'} />} sub={<Delta now={k.cycle_days} before={k.cycle_prev} good="down" unit="days" label={prev} />} onClick={() => go('reports', { r: 'stage_time' })} title="Average days from a won deal's creation to its close" />
        </div>

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
          <section className="cr-block cr-rise flex min-w-0 flex-col xl:col-span-2" style={{ animationDelay: '80ms' }}>
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3.5">
              <div>
                <p className="cr-label">Won · {RANGE_LABEL[range].toLowerCase()}</p>
                <p className="num mt-0.5 text-[26px] font-semibold leading-8 tracking-tight">
                  <CountUp value={k.won_value} format={(v) => compact(v, ccy)} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 pb-1 text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 bg-[var(--cr-accent)]" /> Won by month
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-[var(--cr-ink-2)]" /> Expected
                </span>
                <span className="flex items-center gap-1.5 text-[var(--cr-muted)]">
                  <span className="inline-block w-4 border-t border-dotted border-[var(--cr-muted)]" /> Best case
                </span>
                <Open onClick={() => go('reports', { r: 'forecast' })} label="Forecast" />
              </div>
            </div>
            <div className="px-2 pb-1 pt-2">
              <RevenueTrend months={trend} currency={ccy} height={262} />
            </div>
            <p className="mt-auto border-t border-[var(--cr-hair)] px-4 py-2 text-[12px] text-[var(--cr-muted)]">
              <b className="num font-semibold text-[var(--cr-ink-2)]">{compact(expected6, ccy)}</b> expected over the next 6 months from {k.open_count} open deal{k.open_count === 1 ? '' : 's'} weighted by stage probability, <b className="num font-semibold text-[var(--cr-ink-2)]">{compact(best6, ccy)}</b> if every one closes.
              {d.forecast.undated.count > 0 && ' ' + d.forecast.undated.count + ' without a close date are left out.'}
            </p>
          </section>
          <section className="cr-block cr-rise flex min-w-0 flex-col" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center justify-between px-4 pt-3.5">
              <p className="cr-label flex items-center gap-1.5">Your network</p>
              <Open onClick={() => go('network')} label="Map" />
            </div>
            <div className="flex flex-1 items-center justify-center py-2">
              <Constellation core={initials(app.settings?.workspace || 'CRM')} strong={d.relationships.strongest} cold={d.relationships.cold} />
            </div>
            <div className="border-t border-[var(--cr-hair)] px-4 py-2.5">
              <StackBar
                currency={ccy}
                height={6}
                legend={false}
                items={[
                  { label: 'Strong', value: mix.strong, color: 'var(--cr-pos)' },
                  { label: 'Good', value: mix.good, color: 'var(--cr-c1)' },
                  { label: 'Weak', value: mix.weak, color: 'var(--cr-warn)' },
                  { label: 'No contact', value: mix.none, color: 'var(--cr-line)' },
                ]}
              />
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--cr-ink-2)]">
                {(
                  [
                    ['Strong', mix.strong, 'var(--cr-pos)'],
                    ['Good', mix.good, 'var(--cr-c1)'],
                    ['Weak', mix.weak, 'var(--cr-warn)'],
                    ['No contact', mix.none, 'var(--cr-line)'],
                  ] as const
                ).map(([l, n, c]) => (
                  <span key={l} className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2" style={{ background: c }} />
                    {l} <b className="num">{n}</b>
                  </span>
                ))}
              </p>
              <p className="mt-1 text-[11px] text-[var(--cr-muted)]">Closer to the center is stronger; the dashed ring is going cold.</p>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
          <Block
            icon={Workflow}
            title="How deals move"
            meta={'Deals created in the last 12 months' + (flow.data ? ' · ' + flow.data.pipeline.name : '')}
            className="xl:col-span-2"
            delay={160}
            action={
              d.pipelines.length > 1 ? (
                <Select small label="Pipeline" value={pipeRef} onChange={setPipeline} className="w-36" options={d.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
              ) : (
                <Open onClick={() => go('reports', { r: 'funnel' })} label="Conversion" />
              )
            }
          >
            {flow.data === null ? (
              <div className="flex h-[232px] items-center justify-center">{pipeRef === '' ? <p className="text-[12.5px] text-[var(--cr-muted)]">Add a sales pipeline to see how deals move.</p> : <Spinner size={16} />}</div>
            ) : (
              <PipelineFlow funnel={flow.data} onStage={() => go('deals', { pipeline: pipeRef })} />
            )}
          </Block>
          <Block icon={BellDot} title="Needs your attention" delay={200} flush>
            <Attention d={d} />
          </Block>
        </div>

        <section className="cr-block cr-rise p-4" style={{ animationDelay: '220ms' }}>
          <MonthCalendar currency={ccy} />
        </section>

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          <Block icon={Kanban} title={d.pipeline ? d.pipeline.pipeline.name + ' pipeline' : 'Pipeline'} meta="Open deals by stage" delay={240} action={<Open onClick={() => go('deals', d.pipeline ? { pipeline: d.pipeline.pipeline.id } : {})} label="Board" />}>
            <StageBars d={d} />
          </Block>
          <Block icon={ChartColumn} title="Won and lost" meta="By month" delay={260} action={<Legend series={[{ key: 'won', label: 'Won', color: 'var(--cr-pos)' }, { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' }]} />}>
            <BarChart
              height={196}
              currency={ccy}
              groups={wlMonths.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month) + (m.win_rate !== null ? ' · win rate ' + m.win_rate + '%' : ''), values: { won: m.won, lost: m.lost } }))}
              series={[
                { key: 'won', label: 'Won', color: 'var(--cr-pos)' },
                { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' },
              ]}
            />
          </Block>
        </div>

        {others.length > 0 && (
          <div className={cn('grid grid-cols-1 gap-2.5', others.length === 2 ? 'xl:grid-cols-2' : others.length > 2 ? 'xl:grid-cols-3' : '')}>
            {others.map((o, i) => (
              <OtherPipeline key={o.pipeline.id} p={o} ccy={ccy} delay={280 + i * 30} />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
          <Block icon={Handshake} title="Interactions" meta="Per week" className="xl:col-span-2" delay={300} action={<Legend series={IX_SERIES} />}>
            <StackedBars height={190} unit="interactions" series={IX_SERIES} groups={d.activity.weeks.map((w) => ({ label: day(w.week, true), title: 'Week of ' + day(w.week), values: { meeting: w.meeting, call: w.call, email: w.email, message: w.message } }))} />
            <p className="mt-1 flex flex-wrap items-center gap-x-4 text-[12px] text-[var(--cr-ink-2)]">
              <span className="flex items-center gap-1.5">
                <b className="num">{k.touches}</b> {RANGE_LABEL[range].toLowerCase()} <Delta now={k.touches} before={k.touches_prev} label="" />
              </span>
              <span>
                <b className="num">{k.new_people}</b> new {k.new_people === 1 ? 'person' : 'people'}
              </span>
            </p>
          </Block>
          <Block icon={ChartPie} title="Where deals come from" meta={RANGE_LABEL[range]} delay={320} action={<Open onClick={() => go('reports', { r: 'sources' })} />}>
            {srcItems.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-[var(--cr-muted)]">No deals created in this period.</p>
            ) : (
              <div className="flex items-center gap-4">
                <Donut size={128} thickness={16} currency={ccy} items={srcItems} center={{ label: 'Deals', value: String(srcItems.reduce((t, x) => t + x.value, 0)) }} />
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {d.sources.slice(0, 6).map((s, i) => (
                    <li key={s.source} className="flex items-center gap-2 text-[12px]">
                      <span className="inline-block size-2 shrink-0" style={{ background: srcItems[i]?.color ?? 'var(--cr-line)' }} />
                      <span className="min-w-0 flex-1 truncate">{s.source}</span>
                      <span className="num text-[var(--cr-muted)]">{s.win_rate !== null ? s.win_rate + '%' : ''}</span>
                      <span className="num w-6 text-right font-semibold">{s.deals}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Block>
        </div>

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          <Block icon={CalendarClock} title="Coming up" delay={340} flush action={<Open onClick={() => go('today')} label="Today" />}>
            {d.attention.tasks.length === 0 && d.attention.closing.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-[var(--cr-muted)]">No tasks due and no deals closing in the next 30 days.</p>
            ) : (
              <ul className="flex flex-col">
                {d.attention.tasks.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 border-b border-[var(--cr-hair)] px-4 py-2 text-[12.5px]">
                    <span className="flex size-6 shrink-0 items-center justify-center bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]">
                      <ListTodo size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block truncate text-[11px] text-[var(--cr-muted)]">{t.person?.name ?? t.deal?.name ?? t.company?.name ?? 'No record'}</span>
                    </span>
                    <span className={cn('text-[11.5px]', t.state === 'overdue' ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-ink-2)]')}>{relDay(t.due)}</span>
                  </li>
                ))}
                {d.attention.closing.slice(0, 4).map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => go('deals', { id: x.id })} className="flex w-full items-center gap-2.5 border-b border-[var(--cr-hair)] px-4 py-2 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                      <span className="flex size-6 shrink-0 items-center justify-center" style={{ background: `color-mix(in oklab, ${stageColor(x.stage_color)} 18%, var(--cr-card))`, color: stageColor(x.stage_color) }}>
                        <Kanban size={12} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{x.name}</span>
                        <span className="block truncate text-[11px] text-[var(--cr-muted)]">
                          {x.stage_name} · closes {relDay(x.expected_close)}
                        </span>
                      </span>
                      <span className="num font-semibold">{x.home_value === null ? compact(x.value, x.currency) : compact(x.home_value, ccy)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <AgentBlock d={d} />
        </div>
        <p className="flex items-center justify-center gap-1.5 py-2 text-[11.5px] text-[var(--cr-muted)]">
          <Waypoints size={12} /> {d.relationships.total} people · {app.summary?.companies ?? 0} companies · {app.summary?.open_deals ?? 0} open deals
        </p>
      </div>
    </div>
  );
}

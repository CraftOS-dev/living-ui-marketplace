/**
 * Home: how the business is doing and what needs you today. Headline
 * numbers against the period before (open pipeline, weighted forecast, won,
 * win rate, average deal, sales cycle), the pipeline by stage, the forecast,
 * won and lost by month, interactions per week, relationships, sources,
 * what needs attention, what is coming up and what the AI agent did. Every
 * panel opens where the work is. The money numbers are revenue only:
 * fundraising (committed against the round) and hiring get their own panels.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BellDot, Cake, CalendarClock, ChartColumn, ChartPie, CircleCheck, Clock, Flame, Gauge, Handshake, Hourglass, Kanban, ListTodo, Percent, PiggyBank, Snowflake, Sparkles, Target, TrendingUp, Trophy, Undo2, UserPlus, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago, compact, day, money, monthName, relDay, since, stageColor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Dashboard } from '../lib/types.ts';
import { BarChart, CAT, CountUp, Donut, Legend, StackBar, StackedBars } from '../components/charts.tsx';
import { Avatar, Dot, StrengthBars } from '../components/controls.tsx';
import { Btn, Select, Seg, Spinner, useConfirm } from '../components/ui.tsx';

type Range = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_12_months';

const RANGE_LABEL: Record<Range, string> = { this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', ytd: 'Year to date', last_12_months: '12 months' };
const PREV_LABEL: Record<Range, string> = { this_month: 'vs last month', last_month: 'vs the month before', this_quarter: 'vs last quarter', ytd: 'vs last year', last_12_months: 'vs the 12 months before' };

function Delta({ now, before, good = 'up', label, unit = 'pct' }: { now: number | null; before: number | null; good?: 'up' | 'down' | undefined; label: string; unit?: 'pct' | 'pts' | 'days' | undefined }): React.JSX.Element {
  if (now === null || before === null || (unit === 'pct' && before === 0)) return <span className="text-[11.5px] text-[var(--cr-muted)]">{label}</span>;
  const diff = unit === 'pct' ? ((now - before) / Math.abs(before)) * 100 : now - before;
  if (!isFinite(diff)) return <span className="text-[11.5px] text-[var(--cr-muted)]">{label}</span>;
  const up = diff >= 0;
  const positive = good === 'up' ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const shown = unit === 'pct' ? (Math.abs(diff) >= 1000 ? '999+' : Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)) + '%' : unit === 'pts' ? Math.abs(diff).toFixed(0) + ' pts' : Math.abs(Math.round(diff)) + ' d';
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11.5px]">
      <span className={cn('inline-flex items-center gap-0.5 rounded-[4px] px-1 font-bold', Math.abs(diff) < 0.5 ? 'bg-[var(--cr-row)] text-[var(--cr-ink-2)]' : positive ? 'bg-[var(--cr-pos-soft)] text-[var(--cr-pos-text)]' : 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]')}>
        <Icon size={11} strokeWidth={2.6} />
        <span className="num">{shown}</span>
      </span>
      <span className="truncate text-[var(--cr-muted)]">{label}</span>
    </span>
  );
}

function MiniBars({ values, color }: { values: number[]; color: string }): React.JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-[26px] shrink-0 items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="cr-grow-y w-[5px] rounded-t-[1.5px]" style={{ height: `${Math.max(2, (v / max) * 26)}px`, background: color, opacity: i === values.length - 1 ? 1 : 0.45, animationDelay: `${i * 45}ms` }} />
      ))}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, sub, viz, onClick, title }: { icon: LucideIcon; label: string; value: ReactNode; sub: ReactNode; viz?: ReactNode | undefined; onClick?: (() => void) | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title} className="group flex min-w-0 flex-col gap-1.5 bg-[var(--cr-card)] px-4 py-3 text-left transition-colors hover:bg-[var(--cr-row)]">
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-[var(--cr-muted)]">
          <Icon size={13} strokeWidth={2.1} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ArrowRight size={12} className="shrink-0 -translate-x-1 text-[var(--cr-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="num shrink-0 text-[21px] font-bold leading-[26px] tracking-[-0.01em]">{value}</span>
        {viz !== undefined && <span className="hidden min-w-0 justify-end overflow-hidden sm:flex">{viz}</span>}
      </span>
      <span className="min-h-[18px]">{sub}</span>
    </button>
  );
}

function Panel({ icon: Icon, accent = false, title, sub, action, children, className, delay = 0 }: { icon: LucideIcon; accent?: boolean | undefined; title: string; sub?: ReactNode | undefined; action?: ReactNode | undefined; children: ReactNode; className?: string | undefined; delay?: number | undefined }): React.JSX.Element {
  return (
    <section className={cn('flex min-w-0 flex-col bg-[var(--cr-card)]', className)}>
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <Icon size={14} strokeWidth={2.1} className={cn('shrink-0', accent ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-ink-2)]')} />
        <h2 className="truncate text-[13px] font-bold">{title}</h2>
        {sub !== undefined && <span className="hidden truncate text-[12px] text-[var(--cr-muted)] sm:inline">{sub}</span>}
        <span className="flex-1" />
        {action}
      </header>
      <div className="cr-rise min-h-0 flex-1 px-4 pb-4" style={{ animationDelay: `${delay}ms` }}>
        {children}
      </div>
    </section>
  );
}

function Open({ onClick, label = 'Open' }: { onClick: () => void; label?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--cr-ink-2)] hover:text-[var(--cr-ink)]">
      {label} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function StageBars({ d }: { d: Dashboard }): React.JSX.Element {
  const p = d.pipeline;
  if (p === null)
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-[12.5px] text-[var(--cr-muted)]">No sales pipeline yet: the money numbers above count sales and partnership pipelines.</p>
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
          <button type="button" onClick={() => go('deals', { pipeline: p.pipeline.id })} className="group grid w-full grid-cols-[120px_minmax(0,1fr)_120px] items-center gap-3 rounded-[5px] py-1 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Dot color={stageColor(s.color)} />
              <span className="truncate font-semibold">{s.name}</span>
            </span>
            <span className="relative h-5 overflow-hidden rounded-[4px] bg-[var(--cr-row)]" title={money(s.value, d.currency) + ' · weighted ' + money(s.weighted, d.currency) + ' at ' + s.probability + '%'}>
              <span className="cr-grow-x absolute inset-y-0 left-0 rounded-[4px] opacity-30" style={{ width: `${(s.value / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60}ms` }} />
              <span className="cr-grow-x absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${(s.weighted / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60 + 120}ms` }} />
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
      <li className="mt-1 flex items-center gap-3 border-t border-[var(--cr-hair)] pt-2 text-[12px] text-[var(--cr-ink-2)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-[2px] bg-[var(--cr-ink-2)] opacity-30" /> Value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-[2px] bg-[var(--cr-ink-2)]" /> Weighted by probability
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
  const rows: { icon: LucideIcon; text: ReactNode; go: () => void; tone?: 'neg' | 'accent' | 'warn' | undefined; extra?: ReactNode }[] = [];
  if (a.proposals > 0)
    rows.push({
      icon: Sparkles,
      tone: 'accent',
      text: (
        <>
          <b className="num">{a.proposals}</b> change{a.proposals === 1 ? '' : 's'} from your AI agent to review
        </>
      ),
      go: () => go('review'),
    });
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
      <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
        <CircleCheck size={22} className="text-[var(--cr-pos)]" />
        <p className="text-[13px] font-semibold">All caught up</p>
        <p className="text-[12px] text-[var(--cr-muted)]">No overdue tasks, stale deals or people waiting on you.</p>
      </div>
    );
  return (
    <ul className="-mx-4">
      {rows.map((r, i) => {
        const Icon = r.icon;
        return (
          <li key={i}>
            <button type="button" onClick={r.go} className="group flex w-full items-start gap-3 border-t border-[var(--cr-hair)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--cr-row)]">
              <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center rounded-[5px]', r.tone === 'neg' ? 'bg-[var(--cr-neg-soft)] text-[var(--cr-neg-text)]' : r.tone === 'accent' ? 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)]' : r.tone === 'warn' ? 'bg-[var(--cr-warn-soft)] text-[var(--cr-warn-text)]' : 'bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]')}>
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

function AgentPanel({ d }: { d: Dashboard }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const run = d.agent.runs[0];
  return (
    <Panel icon={Sparkles} accent delay={360} title="Your AI agent" className="xl:col-span-4" action={<Open onClick={() => go('activity', { tab: 'runs' })} label="All runs" />}>
      {confirmEl}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-[var(--cr-line)] bg-[var(--cr-line)]">
        {[
          { n: d.agent.proposals, l: 'changes to review', go: () => go('review') },
          { n: d.agent.working, l: 'jobs in hand', go: () => go('activity', { tab: 'runs' }) },
        ].map((x) => (
          <button key={x.l} type="button" onClick={x.go} className="flex flex-col items-start bg-[var(--cr-card)] px-3 py-2 text-left hover:bg-[var(--cr-row)]">
            <span className="num text-[18px] font-bold leading-6 text-[var(--cr-accent-text)]">
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
    </Panel>
  );
}

/** A fundraising or hiring pipeline: committed against the round, or hires, and who is where. */
function OtherPipeline({ p, ccy, delay, className }: { p: Dashboard['others'][number]; ccy: string; delay: number; className: string }): React.JSX.Element {
  const fund = p.pipeline.kind === 'fundraising';
  const target = p.pipeline.target_home ?? 0;
  const scale = Math.max(1, target, p.won.value + p.total.weighted);
  const maxV = Math.max(1, ...p.stages.map((s) => (fund ? s.value : s.count)));
  const empty = p.total.count === 0 && p.won.count === 0;
  const board = (): void => go('deals', { pipeline: p.pipeline.id });
  return (
    <Panel icon={fund ? PiggyBank : UserPlus} delay={delay} title={p.pipeline.name} sub={fund ? 'Your round' : 'Candidates by stage'} className={className} action={<Open onClick={board} label="Board" />}>
      {empty ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--cr-muted)]">{fund ? 'No investors in this pipeline yet.' : 'No candidates in this pipeline yet.'}</p>
      ) : (
        <>
          {fund ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="num text-[21px] font-bold leading-[26px]">
                  <CountUp value={p.won.value} format={(v) => compact(v, ccy)} />
                </span>
                <span className="text-[12px] text-[var(--cr-muted)]">committed{target > 0 ? ' of ' + compact(target, ccy) : ''}</span>
                <span className="flex-1" />
                {target > 0 ? (
                  <span className="num text-[12.5px] font-bold">{Math.round((p.won.value / target) * 100)}%</span>
                ) : (
                  <button type="button" onClick={() => go('setup', { tab: 'pipelines' })} className="text-[11.5px] font-semibold text-[var(--cr-ink-2)] hover:text-[var(--cr-ink)]">
                    Set the round size
                  </button>
                )}
              </div>
              <div className="relative mt-2 h-2.5 overflow-hidden rounded-[4px] bg-[var(--cr-row)]" title={'Committed ' + money(p.won.value, ccy) + ' · weighted in talks ' + money(p.total.weighted, ccy) + (target > 0 ? ' · target ' + money(target, ccy) : '')}>
                <span className="cr-grow-x absolute inset-y-0 left-0 rounded-[4px] bg-[var(--cr-pos)]" style={{ width: `${(p.won.value / scale) * 100}%` }} />
                <span className="cr-grow-x absolute inset-y-0 rounded-r-[4px] bg-[var(--cr-c1)] opacity-45" style={{ left: `${(p.won.value / scale) * 100}%`, width: `${(p.total.weighted / scale) * 100}%`, animationDelay: '120ms' }} />
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--cr-ink-2)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-[2px] bg-[var(--cr-pos)]" /> {p.won.count} committed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-[2px] bg-[var(--cr-c1)] opacity-45" /> {compact(p.total.weighted, ccy)} weighted in talks
                </span>
                <span className="text-[var(--cr-muted)]">
                  {p.total.count} open conversation{p.total.count === 1 ? '' : 's'}
                </span>
              </p>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="num text-[21px] font-bold leading-[26px]">
                <CountUp value={p.won.count} format={(v) => String(v)} />
              </span>
              <span className="text-[12px] text-[var(--cr-muted)]">hired</span>
              <span className="mx-1 text-[var(--cr-line)]">|</span>
              <span className="num text-[15px] font-bold">{p.total.count}</span>
              <span className="text-[12px] text-[var(--cr-muted)]">in process</span>
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {p.stages.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={board} className="grid w-full grid-cols-[112px_minmax(0,1fr)_72px] items-center gap-3 rounded-[5px] py-0.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Dot color={stageColor(s.color)} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="relative h-4 overflow-hidden rounded-[4px] bg-[var(--cr-row)]">
                    <span className="cr-grow-x absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${((fund ? s.value : s.count) / maxV) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 50}ms` }} />
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
    </Panel>
  );
}

const IX_SERIES = [
  { key: 'meeting', label: 'Meetings', color: 'var(--cr-c1)' },
  { key: 'call', label: 'Calls', color: 'var(--cr-c2)' },
  { key: 'email', label: 'Emails', color: 'var(--cr-c4)' },
  { key: 'message', label: 'Messages', color: 'var(--cr-c3)' },
];

export function HomeView(): React.JSX.Element {
  const app = useApp();
  const [range, setRange] = useState<Range>('this_month');
  const [pipeline, setPipeline] = useState('');
  const live = useLive(() => api.dashboard({ range, pipeline: pipeline || undefined }), ['deals', 'stage_events', 'interactions', 'tasks', 'people', 'proposals', 'activity', 'stages', 'fx_rates'], [range, pipeline], 700);
  useReportScreen('home', null, { range, pipeline });
  const d = live.data;
  const months = useMemo(() => {
    if (d === null) return [];
    const first = d.months.findIndex((m) => m.won !== 0 || m.lost !== 0);
    return first < 0 ? d.months.slice(-6) : d.months.slice(Math.min(first, d.months.length - 3));
  }, [d]);
  if (d === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  const k = d.kpi;
  const ccy = d.currency;
  const r = d.range;
  const prev = PREV_LABEL[range];
  const last6 = d.months.slice(-6);
  const mix = d.relationships.mix;
  const srcItems = d.sources.filter((s) => s.deals > 0).map((s, i) => ({ label: s.source, value: s.deals, color: s.source === 'Unknown' ? 'var(--cr-line)' : CAT(i) }));
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-11 flex-wrap items-center gap-3 border-b border-[var(--cr-line)] px-4 py-1.5">
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-5">{app.settings?.workspace || 'Your CRM'}</p>
          <p className="text-[11.5px] text-[var(--cr-muted)]">
            {day(r.from)} – {day(r.to)}
          </p>
        </div>
        <span className="flex-1" />
        <Seg value={range} onChange={setRange} className="max-w-full overflow-x-auto" options={(Object.keys(RANGE_LABEL) as Range[]).map((x) => ({ value: x, label: RANGE_LABEL[x] }))} />
      </div>

      <div className={cn('grid grid-cols-2 gap-px border-b border-[var(--cr-line)] bg-[var(--cr-line)] md:grid-cols-3 xl:grid-cols-6', live.loading && 'opacity-80')}>
        <Kpi icon={Kanban} label="Open pipeline" value={<CountUp value={k.open_value} format={(v) => compact(v, ccy)} />} sub={<span className="text-[11.5px] text-[var(--cr-muted)]">{k.open_count} open deal{k.open_count === 1 ? '' : 's'}{k.no_rate > 0 ? ' · ' + k.no_rate + ' without a rate' : ''}</span>} onClick={() => go('deals')} title="Sum of open deals' values in your home currency" />
        <Kpi icon={Target} label="Weighted forecast" value={<CountUp value={k.weighted} format={(v) => compact(v, ccy)} />} sub={<span className="text-[11.5px] text-[var(--cr-muted)]">value x stage probability</span>} onClick={() => go('reports', { r: 'forecast' })} title="Sum over open deals of value x probability" />
        <Kpi icon={Trophy} label="Won" value={<CountUp value={k.won_value} format={(v) => compact(v, ccy)} />} viz={<MiniBars values={last6.map((m) => m.won)} color="var(--cr-pos)" />} sub={<Delta now={k.won_value} before={k.won_prev_value} label={k.won_count + ' deal' + (k.won_count === 1 ? '' : 's') + ' ' + prev} />} onClick={() => go('reports', { r: 'winloss' })} />
        <Kpi icon={Percent} label="Win rate" value={k.win_rate === null ? '–' : <CountUp value={Math.round(k.win_rate)} format={(v) => v + '%'} />} sub={<Delta now={k.win_rate} before={k.win_rate_prev} unit="pts" label={prev} />} onClick={() => go('reports', { r: 'winloss' })} title="Won / (won + lost) among deals closed in the period" />
        <Kpi icon={Gauge} label="Average deal" value={k.avg_deal === null ? '–' : <CountUp value={k.avg_deal} format={(v) => compact(v, ccy)} />} sub={<Delta now={k.avg_deal} before={k.avg_deal_prev} label={prev} />} onClick={() => go('reports', { r: 'winloss' })} title="Won value / won deals in the period" />
        <Kpi icon={Hourglass} label="Sales cycle" value={k.cycle_days === null ? '–' : <CountUp value={k.cycle_days} format={(v) => v + ' d'} />} sub={<Delta now={k.cycle_days} before={k.cycle_prev} good="down" unit="days" label={prev} />} onClick={() => go('reports', { r: 'stage_time' })} title="Average days from a won deal's creation to its close" />
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--cr-line)] xl:grid-cols-12">
        <Panel
          icon={Kanban}
          title={d.pipeline ? d.pipeline.pipeline.name + ' pipeline' : 'Pipeline'}
          sub="Open deals by stage"
          className="xl:col-span-7"
          action={
            d.pipelines.length > 1 ? (
              <Select small label="Pipeline" value={pipeline || (d.pipeline?.pipeline.id ?? '')} onChange={setPipeline} className="w-40" options={d.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
            ) : (
              <Open onClick={() => go('deals')} label="Board" />
            )
          }
        >
          <StageBars d={d} />
        </Panel>
        <Panel icon={BellDot} delay={40} title="Needs your attention" className="xl:col-span-5">
          <Attention d={d} />
        </Panel>

        <Panel icon={TrendingUp} delay={80} title="Forecast" sub="Next 6 months" className="xl:col-span-7" action={<Legend series={[{ key: 'won', label: 'Won', color: 'var(--cr-pos)' }, { key: 'weighted', label: 'Weighted', color: 'var(--cr-c1)' }, { key: 'best', label: 'Best case', color: 'var(--cr-ink)' }]} />}>
          <BarChart
            height={220}
            currency={ccy}
            groups={d.forecast.months.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month) + ' · ' + m.deals + ' deal' + (m.deals === 1 ? '' : 's') + ' expected', values: { won: m.won, weighted: m.weighted, best: m.best + m.won } }))}
            series={[
              { key: 'won', label: 'Won', color: 'var(--cr-pos)' },
              { key: 'weighted', label: 'Weighted', color: 'var(--cr-c1)' },
            ]}
            line={{ key: 'best', label: 'Best case', color: 'var(--cr-ink)' }}
          />
          {d.forecast.undated.count > 0 && (
            <p className="mt-1 text-[11.5px] text-[var(--cr-muted)]">
              {d.forecast.undated.count} open deal{d.forecast.undated.count === 1 ? '' : 's'} ({compact(d.forecast.undated.value, ccy)}) without an expected close date are not in the forecast.
            </p>
          )}
        </Panel>
        <Panel icon={ChartColumn} delay={120} title="Won and lost" sub="By month" className="xl:col-span-5" action={<Legend series={[{ key: 'won', label: 'Won', color: 'var(--cr-pos)' }, { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' }]} />}>
          <BarChart
            height={220}
            currency={ccy}
            groups={months.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month) + (m.win_rate !== null ? ' · win rate ' + m.win_rate + '%' : ''), values: { won: m.won, lost: m.lost } }))}
            series={[
              { key: 'won', label: 'Won', color: 'var(--cr-pos)' },
              { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' },
            ]}
          />
        </Panel>

        {d.others.map((o, i) => (
          <OtherPipeline key={o.pipeline.id} p={o} ccy={ccy} delay={140 + i * 40} className={d.others.length === 1 ? 'xl:col-span-12' : d.others.length === 2 ? 'xl:col-span-6' : 'xl:col-span-4'} />
        ))}

        <Panel icon={Handshake} delay={160} title="Interactions" sub="Per week" className="xl:col-span-7" action={<Legend series={IX_SERIES} />}>
          <StackedBars height={200} unit="interactions" series={IX_SERIES} groups={d.activity.weeks.map((w) => ({ label: day(w.week, true), title: 'Week of ' + day(w.week), values: { meeting: w.meeting, call: w.call, email: w.email, message: w.message } }))} />
          <p className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-[var(--cr-ink-2)]">
            <span>
              <b className="num">{k.touches}</b> {RANGE_LABEL[range].toLowerCase()} <Delta now={k.touches} before={k.touches_prev} label="" />
            </span>
            <span>
              <b className="num">{k.new_people}</b> new {k.new_people === 1 ? 'person' : 'people'}
            </span>
          </p>
        </Panel>
        <Panel icon={Users} delay={200} title="Relationships" sub={d.relationships.total + ' people'} className="xl:col-span-5" action={<Open onClick={() => go('reports', { r: 'relationships' })} />}>
          <StackBar
            currency={ccy}
            height={10}
            legend={false}
            items={[
              { label: 'Strong', value: mix.strong, color: 'var(--cr-pos)' },
              { label: 'Good', value: mix.good, color: 'var(--cr-c1)' },
              { label: 'Weak', value: mix.weak, color: 'var(--cr-warn)' },
              { label: 'No contact', value: mix.none, color: 'var(--cr-line)' },
            ]}
          />
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--cr-ink-2)]">
            {[
              ['Strong', mix.strong, 'var(--cr-pos)'],
              ['Good', mix.good, 'var(--cr-c1)'],
              ['Weak', mix.weak, 'var(--cr-warn)'],
              ['No contact', mix.none, 'var(--cr-line)'],
            ].map(([l, n, c]) => (
              <span key={String(l)} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: String(c) }} />
                {l} <b className="num">{n}</b>
              </span>
            ))}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">
                <Snowflake size={11} /> Going cold
              </p>
              {d.relationships.cold.length === 0 && <p className="text-[12px] text-[var(--cr-muted)]">Nobody slipping away.</p>}
              {d.relationships.cold.slice(0, 4).map((p) => (
                <button key={p.id} type="button" onClick={() => go('people', { id: p.id })} className="flex w-full items-center gap-2 rounded-[4px] py-1 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                  <Avatar name={p.name} size={20} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-[11px] text-[var(--cr-muted)]">{since(p.last_interaction)}</span>
                </button>
              ))}
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">
                <Flame size={11} /> Strongest
              </p>
              {d.relationships.strongest.length === 0 && <p className="text-[12px] text-[var(--cr-muted)]">Log interactions to see them here.</p>}
              {d.relationships.strongest.slice(0, 4).map((p) => (
                <button key={p.id} type="button" onClick={() => go('people', { id: p.id })} className="flex w-full items-center gap-2 rounded-[4px] py-1 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                  <Avatar name={p.name} size={20} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <StrengthBars value={p.strength} />
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel icon={ChartPie} delay={240} title="Where deals come from" sub={RANGE_LABEL[range]} className="xl:col-span-4" action={<Open onClick={() => go('reports', { r: 'sources' })} />}>
          {srcItems.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-[var(--cr-muted)]">No deals created in this period.</p>
          ) : (
            <div className="flex items-center gap-4">
              <Donut size={132} thickness={18} currency={ccy} items={srcItems} center={{ label: 'Deals', value: String(srcItems.reduce((t, x) => t + x.value, 0)) }} />
              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {d.sources.slice(0, 6).map((s, i) => (
                  <li key={s.source} className="flex items-center gap-2 text-[12px]">
                    <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: srcItems[i]?.color ?? 'var(--cr-line)' }} />
                    <span className="min-w-0 flex-1 truncate">{s.source}</span>
                    <span className="num text-[var(--cr-muted)]">{s.win_rate !== null ? s.win_rate + '%' : ''}</span>
                    <span className="num w-6 text-right font-semibold">{s.deals}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
        <Panel icon={CalendarClock} delay={300} title="Coming up" className="xl:col-span-4" action={<Open onClick={() => go('today')} label="Today" />}>
          {d.attention.tasks.length === 0 && d.attention.closing.length === 0 ? (
            <p className="py-6 text-[12.5px] text-[var(--cr-muted)]">No tasks due and no deals closing in the next 30 days.</p>
          ) : (
            <ul className="flex flex-col">
              {d.attention.tasks.slice(0, 4).map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 border-t border-[var(--cr-hair)] py-1.5 text-[12.5px] first:border-t-0">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]">
                    <ListTodo size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.title}</span>
                    <span className="block truncate text-[11px] text-[var(--cr-muted)]">{t.person?.name ?? t.deal?.name ?? t.company?.name ?? 'No record'}</span>
                  </span>
                  <span className={cn('text-[11.5px]', t.state === 'overdue' ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-ink-2)]')}>{relDay(t.due)}</span>
                </li>
              ))}
              {d.attention.closing.slice(0, 4).map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => go('deals', { id: x.id })} className="flex w-full items-center gap-2.5 border-t border-[var(--cr-hair)] py-1.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px]" style={{ background: `color-mix(in oklab, ${stageColor(x.stage_color)} 18%, var(--cr-card))`, color: stageColor(x.stage_color) }}>
                      <Kanban size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{x.name}</span>
                      <span className="block truncate text-[11px] text-[var(--cr-muted)]">
                        {x.stage_name} · closes {relDay(x.expected_close)}
                      </span>
                    </span>
                    <span className="num font-semibold">{x.home_value === null ? money(x.value, x.currency) : compact(x.home_value, ccy)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <AgentPanel d={d} />
      </div>
    </div>
  );
}

/**
 * Home building blocks (home-reports): what needs you, the readout strip,
 * the people and cost chart, your AI agent's work, the setup guide, the pay
 * runs, the team today, the clock card and the grid that places the
 * modules' Home widgets by their order and size.
 *
 * Every panel here draws from the page's one combined read (home.admin,
 * home.manager, home.me); the modules' Inbox sections in Needs you come from
 * the shell's counts (read once for the frame), and the modules' widgets
 * mount after the page's read answered, one at a time (see load.tsx).
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BadgeCheck, Banknote, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleCheck, Clock, Coffee, FileClock, FileSpreadsheet, ListTodo, LogIn, LogOut, OctagonAlert, Play, Sparkle, UserMinus, UserPlus, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Button, Empty, Money, Panel, PersonChip, RowCue, Skeleton, StatusDot } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { AskBox } from '../shell/AgentPanel.tsx';
import { useAgentQueue } from '../agent.tsx';
import { sections, useShellCounts } from '../shell/counts.ts';
import { askPin, op } from '../../lib/api.ts';
import { DecisionRow, OUTCOME_ICON, decide } from '../decision.tsx';
import type { OpName } from '../../lib/api.ts';
import { allowed, refreshMe, useMe } from '../../lib/auth.tsx';
import type { HomeWidget, InboxAction, InboxItem } from '../../lib/contract.ts';
import { ago, dayKey, fmtDay, minutes, relDay, stampDayKey } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { kindLabel } from '../../lib/kinds.ts';
import { act, drop, reshape } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { homeWidgets } from '../../routes.tsx';
import { Legend, MonthChart, Sparkline, monthLabel } from '../reports/charts.tsx';
import { useMoneyText } from './load.tsx';
import { FirstPeople } from '../../pages/people/Start.tsx';
import { punchNow } from '../../pages/time/Clock.tsx';
import type { PunchKind } from '../../pages/time/types.ts';
import { punchLabel, READS as CLOCK_READS } from '../../pages/time/util.ts';
import type { AttentionGroup, AttentionItem, BoardPerson, ClockToday, PayPanelData, SeriesPoint } from './types.ts';

/** Collections the Home reads (for live reloads). */
export const HOME_READS = ['approvals', 'proposals', 'audit', 'employments', 'employees', 'job_records', 'documents', 'identity_docs', 'payruns', 'payslips', 'pay_schedules', 'leave_requests', 'checklists', 'openings', 'fx_rates', 'settings', 'members', 'departments', 'checkins', 'attendance', 'shift_assignments', 'entities', 'locations'];

/* ------------------------------------------------------------ needs you */

const GROUP_ICON: Record<string, LucideIcon> = { approvals: CheckCheck, proposals: Sparkle, blockers: OctagonAlert, documents: FileClock, starting: UserPlus, leaving: UserMinus, probation: BadgeCheck };
const GROUP_TONE: Record<string, Tone> = { blockers: 'bad', documents: 'warn' };

export interface Group {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  count: number;
  link: string;
  rows: Row[];
}

export interface Row {
  id: string;
  title: string;
  sub?: string | undefined;
  person?: string | undefined;
  due?: string | undefined;
  link?: string | undefined;
  extra?: React.ReactNode;
  actions: InboxAction[];
}

function sectionRow(it: InboxItem): Row {
  return { id: it.id, title: it.title, sub: it.sub, person: it.person, due: it.due, link: it.link, actions: it.actions ?? [] };
}

/**
 * The modules' Inbox sections the viewer may see, as Needs you groups:
 * { groups, done }. Their items come from the shell's one read of every
 * section (ShellCountsProvider, the same answer as the sidebar's Inbox
 * badge), so Home sends no section read of its own.
 */
export function useModuleGroups(): { groups: Group[]; done: boolean } {
  const me = useMe();
  const { items } = useShellCounts();
  return useMemo(() => {
    const list = sections().filter((s) => allowed(me, s.perm));
    const groups: Group[] = [];
    let done = true;
    for (const s of list) {
      const got = items[s.key] ?? null;
      if (got === null) {
        done = false;
        continue;
      }
      if (got.length > 0) groups.push({ key: 's.' + s.key, label: s.label, icon: ListTodo, tone: 'neutral', count: got.length, link: '#/inbox', rows: got.map(sectionRow) });
    }
    return { groups, done };
  }, [me, items]);
}

const READS_ACT = ['approvals', 'proposals', 'checklists', 'tasks', 'employments'];

/** Approve from Needs you: the row shows "Approved" and folds away, then the decision goes (the PIN first, when needed). */
async function approve(a: AttentionItem): Promise<void> {
  let pin: string | undefined;
  if (a.needs_pin === true) {
    const got = await askPin({ title: t('home.approve'), text: a.title });
    if (got === null) return;
    pin = got;
  }
  decide(a.id, 'approved', () => act([drop(a.id)], () => op('approvals.decide', { approval: a.id, decision: 'approved', pin }), READS_ACT));
}

function runAction(a: AttentionItem): void {
  if (a.action === null || a.action === undefined) return;
  const act0 = a.action;
  void act([drop(a.id)], () => op(act0.op as OpName, act0.params), READS_ACT).then((r) => {
    if (r !== null) toast.success(t('home.action_done.' + act0.label, { name: a.title }), { label: t('home.open_lifecycle'), run: () => navigate('/lifecycle') });
  });
}

/** Home groups from the home.* answer. */
export function attentionGroups(groups: AttentionGroup[]): Group[] {
  return groups.map((g) => ({
    key: g.key,
    label: t('home.need.' + g.key),
    icon: GROUP_ICON[g.key] ?? Circle,
    tone: GROUP_TONE[g.key] ?? 'neutral',
    count: g.count,
    link: g.link,
    rows: g.items.map((it) => {
      const r: Row = { id: it.id, title: it.title, sub: it.sub, person: it.person, due: it.due, link: it.link, actions: [] };
      if (g.key === 'approvals') {
        r.sub = [kindLabel(it.kind ?? ''), it.sub ?? ''].filter((x) => x !== '').join(' · ');
        if (it.amount_minor !== undefined && it.amount_minor !== 0 && it.currency !== undefined && it.currency !== '') r.extra = <Money minor={it.amount_minor} currency={it.currency} className="text-[12px]" />;
        r.actions = [{ label: t('home.approve'), primary: true, run: () => void approve(it) }];
      } else if (g.key === 'blockers') {
        r.sub = [it.sub ?? '', tn('home.blockers_n', it.count ?? 0)].filter((x) => x !== '').join(' · ');
      } else if (g.key === 'documents') {
        r.sub = it.person;
        r.person = undefined;
      } else if (it.action !== null && it.action !== undefined) {
        r.actions = [{ label: t('home.action.' + it.action.label), primary: true, run: () => runAction(it) }];
      }
      if (g.key === 'starting') r.sub = [it.sub ?? '', t('home.no_onboarding')].filter((x) => x !== '').join(' · ');
      if (g.key === 'leaving') r.sub = [it.sub ?? '', t('home.no_offboarding')].filter((x) => x !== '').join(' · ');
      if (g.key === 'probation') r.sub = t('home.probation_ends');
      return r;
    }),
  }));
}

/** When a row is due: `when` is a day or a timestamp (its day in the entity's zone). */
function DueLabel({ when, kind }: { when: string; kind: string }): React.JSX.Element {
  const day = stampDayKey(when);
  const today = dayKey();
  const past = day < today;
  const word = kind === 'documents' ? (past ? t('home.expired') : t('home.expires')) : kind === 'starting' ? (past ? t('home.started') : t('home.starts')) : kind === 'leaving' ? t('home.last_day') : kind === 'blockers' ? t('home.pay_day') : '';
  return <span className={cn('hr-label shrink-0 whitespace-nowrap', past && kind !== 'starting' && '!text-[var(--hr-bad)]')}>{(word !== '' ? word + ' ' : '') + relDay(day)}</span>;
}

function GroupBlock({ g, first }: { g: Group; first: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(first);
  const Icon = g.icon;
  const shown = open ? g.rows.slice(0, 4) : [];
  return (
    <li className="border-b border-[var(--hr-hair)] last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="hr-focus group flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-[var(--hr-hover)]">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', g.tone === 'bad' ? 'border-[var(--hr-bad)] text-[var(--hr-bad)]' : g.tone === 'warn' ? 'border-[var(--hr-warn)] text-[var(--hr-warn)]' : g.key === 'proposals' ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line-2)] text-[var(--hr-ink-2)]')}>
          <Icon size={13} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{g.label}</span>
        <span className="hr-mono hr-num text-[13px]">{g.count}</span>
        <ChevronDown size={14} aria-hidden className={cn('shrink-0 text-[var(--hr-faint)] transition-transform duration-150 group-hover:text-[var(--hr-ink)]', open && 'rotate-180')} />
      </button>
      {open && (
        // One grid for the group (item, amount, due, actions; each row a subgrid), so the columns line up.
        <ul className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 pb-1.5 pl-[52px] pr-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          {shown.map((r) => {
            const due = r.due !== undefined && r.due !== '' ? <DueLabel when={r.due} kind={g.key} /> : null;
            return (
              <DecisionRow key={r.id} id={r.id} className="col-span-full grid grid-cols-subgrid items-center rounded-[var(--hr-radius-sm)] py-1.5">
                <a href={r.link ?? g.link} className="hr-focus min-w-0 rounded-[3px] py-1">
                  <span className="hr-wrap hr-link block text-[13px]">{r.title}</span>
                  {r.sub !== undefined && r.sub !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{r.sub}</span>}
                  {(r.extra !== undefined || due !== null) && (
                    <span className="flex flex-wrap items-center gap-x-3 sm:hidden">
                      {r.extra}
                      {due}
                    </span>
                  )}
                </a>
                <span className="hidden justify-self-end sm:block">{r.extra}</span>
                <span className="hidden sm:block">{due}</span>
                <span className="flex items-center justify-end gap-2">
                  {r.actions.map((a) => {
                    const out = a.outcome;
                    return (
                      <Button key={a.label} size="sm" className="hit" icon={out !== undefined ? OUTCOME_ICON[out] : a.primary === true ? Check : undefined} onClick={() => (out !== undefined ? decide(r.id, out, a.run) : void a.run())}>
                        {a.label}
                      </Button>
                    );
                  })}
                </span>
              </DecisionRow>
            );
          })}
          {g.count > shown.length && (
            <li className="col-span-full pt-0.5">
              <a href={g.link} className="hr-focus hr-label hit inline-flex items-center gap-1 rounded-[3px] py-1 hover:!text-[var(--hr-ink)]">
                {t('home.all_n', { n: g.count })} <ArrowRight size={12} aria-hidden />
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * "Needs you": grouped work, each group opening in place, gone when empty. The modules' groups follow when
 * they have answered. `scroll`: the body scrolls when the panel is held to a height (lg up, beside Pay runs).
 */
export function NeedsYou({ groups, loading, settled = true, index, className, emptyText, label, scroll }: { groups: Group[]; loading: boolean; settled?: boolean | undefined; index?: string | undefined; className?: string | undefined; emptyText?: string | undefined; label?: string | undefined; scroll?: boolean | undefined }): React.JSX.Element {
  const total = groups.reduce((a, g) => a + g.count, 0);
  return (
    <Panel index={index} label={label ?? t('home.needs_you')} aside={total > 0 ? <span className="hr-label">{tn('home.items_n', total)}</span> : undefined} flush className={cn('lg:min-h-[220px]', className)} bodyClass={cn('flex flex-col', scroll === true && 'hr-scroll lg:overflow-y-auto')}>
      {/* Nothing to show yet and the modules' sections still on their way: still loading, not all clear. */}
      {loading || (groups.length === 0 && !settled) ? (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-1 items-center gap-3 px-3.5 pb-4 pt-1">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--hr-good)] text-[var(--hr-good)]">
            <Check size={14} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{t('home.all_clear')}</span>
            <span className="block text-[12px] text-[var(--hr-muted)]">{emptyText ?? t('home.all_clear_text')}</span>
          </span>
        </div>
      ) : (
        <ul className="border-t border-[var(--hr-hair)]">
          {groups.map((g, i) => (
            <GroupBlock key={g.key} g={g} first={i === 0} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------- readouts */

export interface Tile {
  key: string;
  label: string;
  value: React.ReactNode;
  aside?: React.ReactNode;
  chart?: React.ReactNode;
  href?: string | undefined;
}

/** A row of instrument readouts (index 03.1 ...), each one big mono figure. */
export function Readouts({ tiles, index, className }: { tiles: Tile[]; index?: string | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>
      {tiles.map((k, i) => {
        const body = (
          <>
            <div className="min-w-0">
              <div className="hr-label truncate">
                {index !== undefined && (
                  <span className="mr-2 !text-[var(--hr-faint)]">
                    {index}.{i + 1}
                  </span>
                )}
                {k.label}
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="hr-mono hr-num text-[26px] font-light leading-none tracking-tight">{k.value}</span>
                {k.aside}
              </div>
            </div>
            {k.chart !== undefined && <span className="hidden shrink-0 sm:block">{k.chart}</span>}
          </>
        );
        return k.href !== undefined ? (
          <a key={k.key} href={k.href} className="hr-panel hr-in hr-focus flex min-w-0 items-end justify-between gap-2 px-3.5 py-3 transition-colors hover:bg-[var(--hr-hover)]">
            {body}
          </a>
        ) : (
          <div key={k.key} className="hr-panel hr-in flex min-w-0 items-end justify-between gap-2 px-3.5 py-3">
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Delta({ now, before, good = 'up' }: { now: number; before: number | null; good?: 'up' | 'down' | 'none' | undefined }): React.JSX.Element | null {
  if (before === null || now === before) return null;
  const d = now - before;
  const tone = good === 'none' ? 'text-[var(--hr-muted)]' : (d > 0) === (good === 'up') ? 'text-[var(--hr-good)]' : 'text-[var(--hr-bad)]';
  return <span className={cn('hr-mono text-[12px]', tone)}>{(d > 0 ? '+' : '') + d}</span>;
}

/** The mono caps link on a panel's label line (one style for every aside link). */
export function AsideLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} className="hr-focus hr-label hit inline-flex items-center gap-1 rounded-[3px] hover:!text-[var(--hr-ink)]">
      {children}
      <ChevronRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

/* ------------------------------------------------------- people and cost */

export function PeopleCostChart({ series, currency, pay, index, className, missing }: { series: SeriesPoint[]; currency: string; pay: boolean; index?: string | undefined; className?: string | undefined; missing?: string[] | undefined }): React.JSX.Element {
  const months = series.map((s) => s.month);
  const money = useMoneyText();
  const fmt = (v: number): string => money(Math.round(v), currency, { compact: true });
  return (
    <Panel index={index} label={pay ? t('home.chart.cost_title') : t('home.chart.people_title')} className={className} aside={<AsideLink href={pay ? '#/reports/cost' : '#/reports/headcount'}>{t('home.chart.open_report')}</AsideLink>}>
      <Legend
        className="mb-2 justify-end"
        items={
          pay
            ? [
                { label: t('home.chart.gross'), color: 'var(--hr-rh)' },
                { label: t('home.chart.employer'), color: 'var(--hr-lh)' },
                { label: t('home.chart.headcount'), color: 'var(--hr-ink)', line: true },
              ]
            : [
                { label: t('home.chart.joined'), color: 'var(--hr-rh)' },
                { label: t('home.chart.left'), color: 'var(--hr-lh)' },
                { label: t('home.chart.headcount'), color: 'var(--hr-ink)', line: true },
              ]
        }
      />
      {pay ? (
        <MonthChart
          months={months}
          bars={[
            { key: 'gross', label: t('home.chart.gross'), color: 'var(--hr-rh)', values: series.map((s) => s.gross_minor) },
            { key: 'employer', label: t('home.chart.employer'), color: 'var(--hr-lh)', values: series.map((s) => s.employer_minor) },
          ]}
          line={{ label: t('home.chart.headcount'), values: series.map((s) => s.headcount) }}
          format={fmt}
          lineFormat={(v) => String(Math.round(v))}
          label={t('home.chart.cost_title')}
          empty={t('home.chart.no_runs')}
          height={210}
        />
      ) : (
        <MonthChart
          months={months}
          bars={[
            { key: 'joined', label: t('home.chart.joined'), color: 'var(--hr-rh)', values: series.map((s) => s.joined) },
            { key: 'left', label: t('home.chart.left'), color: 'var(--hr-lh)', values: series.map((s) => s.left) },
          ]}
          line={{ label: t('home.chart.headcount'), values: series.map((s) => s.headcount) }}
          format={(v) => String(Math.round(v))}
          lineFormat={(v) => String(Math.round(v))}
          label={t('home.chart.people_title')}
          height={210}
        />
      )}
      <div className="hr-label mt-1">{months.length > 0 ? monthLabel(months[0] ?? '', true) + ' to ' + monthLabel(months[months.length - 1] ?? '', true) : ''}</div>
      {pay && missing !== undefined && missing.length > 0 && <div className="hr-label mt-1 !text-[var(--hr-warn)]">{t('home.chart.not_counted', { list: missing.join(', '), currency })}</div>}
    </Panel>
  );
}

/* ---------------------------------------------------------- your AI agent */

export function AgentWork({ agent, index, className }: { agent: { done_30: number; proposals_accepted_30: number; actions: { id: string; op: string; summary: string; at: string }[] } | null; index?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const queue = useAgentQueue();
  const items = useMemo(() => (agent === null ? [] : agent.actions.map((x) => ({ id: x.id, at: x.at, title: x.summary, note: '' })).slice(0, 4)), [agent]);
  return (
    <Panel index={index} label={t('agent.name')} className={className} aside={queue.waiting > 0 ? <AsideLink href="#/inbox?view=agent">{tn('home.agent.open_n', queue.waiting)}</AsideLink> : undefined} bodyClass="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <AgentMark size={28} working={queue.working > 0} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-medium">{agent === null ? '' : queue.working > 0 ? t('home.agent.working') : queue.waiting > 0 ? t('home.agent.waiting') : t('home.agent.idle')}</div>
          <div className="hr-label truncate">{agent === null ? '' : t('home.agent.month', { done: agent.done_30, accepted: agent.proposals_accepted_30 })}</div>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.id} className="border-t border-[var(--hr-hair)] py-2 first:border-t-0">
              <div className="flex items-center gap-2">
                <StatusDot tone="neutral" />
                <span className="hr-wrap min-w-0 flex-1 text-[12px] leading-[18px]">{it.title}</span>
                <span className="hr-label shrink-0">{ago(it.at)}</span>
              </div>
              {it.note !== '' && <p className="hr-wrap mt-1 line-clamp-2 border-l-2 border-[var(--hr-agent)] pl-2 text-[12px] leading-[17px] text-[var(--hr-ink-2)]">{it.note}</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto">
        <AskBox />
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- setup guide */

export interface SetupState {
  steps: { key: string; label: string; done: boolean; link: string }[];
  done: number;
  total: number;
}

/** What a new company needs first: its people, then the rest (the steps the kernel counts, in the order they help most). */
const STEP_ORDER = ['people', 'departments', 'team', 'pin', 'company'];
const STEP_LINK: Record<string, string> = { people: '#/people/new' };

/**
 * Shopify-style setup guide: the open steps with one action each, the next
 * one leading (while nobody is in: the kernel's "Add your first people" with
 * Hire and Import); gone once every step is done.
 */
export function SetupGuide({ setup, index }: { setup: SetupState; index?: string | undefined }): React.JSX.Element | null {
  if (setup.done >= setup.total) return null;
  const rank = (k: string): number => (STEP_ORDER.indexOf(k) < 0 ? 99 : STEP_ORDER.indexOf(k));
  const steps = [...setup.steps].sort((a, b) => Number(a.done) - Number(b.done) || rank(a.key) - rank(b.key));
  const next = steps.find((s) => !s.done) ?? null;
  return (
    <section className="hr-panel hr-in lg:col-span-12">
      <header className="flex h-9 items-center gap-2 px-3.5">
        {index !== undefined && <span className="hr-label !text-[var(--hr-faint)]">{index}</span>}
        <span className="hr-label min-w-0 flex-1 truncate">{t('home.setup.title')}</span>
        <span className="hr-label">{t('home.setup.progress', { done: setup.done, total: setup.total })}</span>
      </header>
      <div className="px-3.5 pb-1">
        <div className="flex h-1.5 gap-[3px]" aria-hidden>
          {steps.map((s) => (
            <span key={s.key} className={cn('flex-1 rounded-full', s.done ? 'bg-[var(--hr-ink)]' : 'bg-[var(--hr-line)]')} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-3.5 pb-3 pt-2">
        {next !== null &&
          (next.key === 'people' ? (
            <FirstPeople inline className="rounded-[var(--hr-radius-sm)] bg-[var(--hr-sunk)] px-3 py-2.5" />
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-[var(--hr-radius-sm)] bg-[var(--hr-sunk)] px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{t('home.setup.lead.' + next.key)}</span>
                <span className="block text-[12px] text-[var(--hr-muted)]">{t('home.setup.do.' + next.key)}</span>
              </span>
              <Button className="hit" variant="primary" icon={ArrowRight} onClick={() => (window.location.hash = STEP_LINK[next.key] ?? next.link)}>
                {t('home.setup.go.' + next.key)}
              </Button>
            </div>
          ))}
        <ol className="grid grid-cols-1 gap-x-4 sm:grid-cols-3 lg:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.key}>
              <a href={STEP_LINK[s.key] ?? s.link} className={cn('hr-focus group flex min-h-11 items-center gap-2.5 rounded-[var(--hr-radius-sm)] px-1 py-1.5 transition-colors hover:bg-[var(--hr-hover)]', s.done && 'opacity-60')}>
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px]', s.done ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : s.key === next?.key ? 'border-[var(--hr-ink)] text-[var(--hr-ink)]' : 'border-[var(--hr-line-2)] text-[var(--hr-muted)]')}>
                  {s.done ? <Check size={12} strokeWidth={2.5} aria-hidden /> : <span className="hr-mono">{i + 1}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{t('home.setup.step.' + s.key)}</span>
                  <span className="block truncate text-[12px] text-[var(--hr-muted)]">{s.done ? t('home.setup.done_one') : t('home.setup.do.' + s.key)}</span>
                </span>
                <RowCue />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- pay calendar */

const RUN_TONE: Record<string, Tone> = { draft: 'faint', calculating: 'warn', calculated: 'rh', approved: 'lh', locked: 'good', paid: 'good' };

/** The next pay run of every schedule: days to pay day and to the input cutoff, and the run's state (from the page's read). */
export function PayCalendar({ pay, index, className }: { pay: PayPanelData | null; index?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const me = useMe();
  const blockers = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of pay?.blockers ?? []) m[b.payrun] = b.blockers;
    return m;
  }, [pay]);
  const edit = allowed(me, 'payroll:edit');
  return (
    <Panel index={index} label={t('home.pay.title')} className={className} flush aside={<AsideLink href="#/payroll">{t('home.pay.calendar')}</AsideLink>}>
      {pay === null ? (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : pay.schedules.length === 0 ? (
        <Empty icon={Banknote} title={t('home.pay.none')} action={edit ? <Button className="hit" onClick={() => navigate('/payroll/schedules')}>{t('home.pay.add_schedule')}</Button> : undefined} className="py-6" />
      ) : (
        <ul className="border-t border-[var(--hr-hair)]">
          {pay.schedules.slice(0, 6).map((s) => {
            const b = s.run !== null ? (blockers[s.run.id] ?? 0) : 0;
            const href = s.run !== null ? '#/payroll/runs/' + s.run.id : '#/payroll';
            return (
              <li key={s.schedule}>
                <a href={href} className="hr-focus group flex min-w-0 items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hr-hover)]">
                  <span className="w-[64px] shrink-0">
                    <span className="hr-mono hr-num block text-[15px] leading-tight">{s.days_to_pay <= 0 ? t('home.pay.today') : s.days_to_pay}</span>
                    <span className="hr-label block">{s.days_to_pay <= 0 ? '' : tn('home.pay.days', s.days_to_pay)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {s.entity_name} · {s.name}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--hr-muted)]">
                      {t('home.pay.pay_day', { day: fmtDay(s.pay_date, { weekday: true }) })}
                      {s.cutoff_day !== '' && s.days_to_cutoff >= 0 ? ' · ' + t('home.pay.cutoff', { when: relDay(s.cutoff_day) }) : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {s.run !== null ? <StatusDot tone={b > 0 ? 'bad' : (RUN_TONE[s.run.status] ?? 'neutral')} label={b > 0 ? tn('home.blockers_n', b) : t('home.pay.status.' + s.run.status)} /> : <StatusDot tone="faint" label={t('home.pay.not_started')} />}
                    <span className="hr-label">{tn('home.people_n', s.people)}</span>
                  </span>
                  <RowCue />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- team today */

type Bucket = 'in' | 'out' | 'away' | 'off';
const STATE_GROUP: Record<string, Bucket> = { in: 'in', break: 'in', late: 'in', remote: 'in', on_duty: 'in', out: 'out', absent: 'out', expected: 'out', untracked: 'out', none: 'out', on_leave: 'away', off: 'off' };

/** Who in my team is in, not in yet, away or off today (the time module's board, from the page's read). */
export function TeamToday({ board, index, className, team }: { board: { people: BoardPerson[] } | null; index?: string | undefined; className?: string | undefined; team?: number | undefined }): React.JSX.Element {
  const me = useMe();
  const groups = useMemo(() => {
    const g: Record<Bucket, BoardPerson[]> = { in: [], out: [], away: [], off: [] };
    for (const r of board?.people ?? []) if (r.employee !== me.employee?.id) g[r.leave !== null ? 'away' : (STATE_GROUP[r.state] ?? 'out')].push(r);
    return g;
  }, [board, me.employee]);
  const ORDER: Bucket[] = ['in', 'out', 'away', 'off'];
  const ICON = { in: LogIn, out: LogOut, away: Users, off: Clock };
  const people = ORDER.reduce((a, k) => a + groups[k].length, 0);
  return (
    <Panel index={index} label={t('home.team.title')} className={className} aside={<AsideLink href="#/time">{t('home.team.board')}</AsideLink>}>
      {board === null ? (
        <Skeleton className="h-24 w-full" />
      ) : team === 0 ? (
        <p className="text-[12px] text-[var(--hr-muted)]">{t('home.team.no_reports')}</p>
      ) : people === 0 ? (
        <p className="text-[12px] text-[var(--hr-muted)]">{t('home.team.none')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            {ORDER.map((k) => {
              const Icon = ICON[k];
              return (
                <div key={k} className="min-w-0">
                  <div className="hr-label flex items-center gap-1 truncate">
                    <Icon size={11} aria-hidden /> {t('home.team.' + k)}
                  </div>
                  <div className="hr-mono hr-num mt-1 text-[15px] leading-tight">{groups[k].length}</div>
                </div>
              );
            })}
          </div>
          <ul className="flex flex-col">
            {ORDER.flatMap((k) =>
              groups[k].slice(0, 8).map((r) => (
                <li key={r.employment} className="flex min-w-0 items-center gap-2 border-t border-[var(--hr-hair)] py-1.5">
                  <PersonChip name={r.name} size={22} strong={false} className="min-w-0 flex-1" />
                  <span className="hr-wrap shrink-0 text-right text-[12px] text-[var(--hr-muted)]">
                    {k === 'in' ? (r.first_in_time !== '' ? t('home.team.since', { time: r.first_in_time }) : r.state === 'remote' ? t('home.team.remote') : t('home.team.in')) + (r.late_min > 0 ? ' · ' + t('home.team.late', { time: minutes(r.late_min) }) : '') : k === 'away' ? (r.leave?.name ?? t('home.team.away')) : k === 'off' ? (r.holiday !== '' ? r.holiday : t('home.team.off')) : r.last_out_time !== '' ? t('home.team.left_at', { time: r.last_out_time }) : r.shift_over ? t('home.team.shift_over') : r.state === 'absent' ? t('home.team.absent') : t('home.team.not_in')}
                  </span>
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- clock card */

/** The person's clock as a big card: state, since when, worked today, one button (the time module's punch). */
const PUNCH_ICON: Record<PunchKind, LucideIcon> = { in: LogIn, out: LogOut, break_start: Coffee, break_end: Play };
const AFTER: Record<PunchKind, ClockToday['state']> = { in: 'in', break_end: 'in', break_start: 'break', out: 'out' };
const NEXT: Record<ClockToday['state'], PunchKind[]> = { in: ['out', 'break_start'], break: ['break_end', 'out'], out: ['in'] };
/** The Home views that carry the clock (home.me, home.manager answers). */
const CLOCK_HOME_VIEWS = ['home.me', 'home.manager'];

/** "HH:MM" now in the person's zone, from the time the clock status was answered with and its moment. */
function zoneNow(s: ClockToday): string {
  const at = Date.parse(s.now);
  if (!Number.isFinite(at) || !/^\d\d:\d\d/.test(s.time)) return '';
  const local = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));
  const d0 = new Date(at);
  let off = local - (d0.getUTCHours() * 60 + d0.getUTCMinutes());
  if (off > 840) off -= 1440;
  if (off < -720) off += 1440;
  const n = new Date(Date.now() + off * 60000);
  return String(n.getUTCHours()).padStart(2, '0') + ':' + String(n.getUTCMinutes()).padStart(2, '0');
}

/**
 * Punch from Home: the card shows the new state the moment it is tapped (the
 * page's views are reshaped), the time module saves the punch and answers
 * with Undo, and the page's next read confirms it (a refused punch puts the
 * old state back).
 */
function punchHome(s: ClockToday, kind: PunchKind): Promise<boolean> {
  const state = AFTER[kind];
  const since = zoneNow(s);
  const shown = (d: unknown): unknown => {
    const v = d as { clock?: ClockToday | null } | null;
    if (v === null || typeof v !== 'object' || v.clock === null || v.clock === undefined || v.clock.employment?.id !== s.employment.id) return d;
    return { ...v, clock: { ...v.clock, state, since_time: state === 'out' ? v.clock.since_time : since, next: NEXT[state] } };
  };
  return act(
    CLOCK_HOME_VIEWS.map((view) => reshape(view, shown)),
    async () => {
      if (!(await punchNow(s, kind))) throw new Error('punch refused');
      return true;
    },
    CLOCK_READS.clock,
  ).then((r) => r === true);
}

/** Today's clock with the next punch (Clock in, Start break, End break, Clock out), from the page's read. */
export function ClockCard({ clock, compact, className, index }: { clock: ClockToday | null; compact?: boolean | undefined; className?: string | undefined; index?: string | undefined }): React.JSX.Element | null {
  const me = useMe();
  if (me.employee === null) return null;
  const s = clock;
  const stateLabel = s === null ? '' : s.state === 'in' ? t('home.clock.in') : s.state === 'break' ? t('home.clock.break') : t('home.clock.out');
  const kind: PunchKind = s?.next[0] ?? 'in';
  const action = s === null ? null : { label: punchLabel(kind), icon: PUNCH_ICON[kind] };
  const Icon = action?.icon ?? LogIn;
  const press = (): void => {
    if (s !== null) void punchHome(s, kind);
  };
  const plan = s?.plan ?? null;
  return (
    <section className={cn('hr-panel hr-in flex min-w-0 flex-col gap-3 p-3.5', className)}>
      <div className="flex items-center gap-2">
        {index !== undefined && <span className="hr-label !text-[var(--hr-faint)]">{index}</span>}
        <span className="hr-label flex-1">{t('home.clock.title')}</span>
        <AsideLink href="#/time/clock">{t('home.clock.details')}</AsideLink>
      </div>
      {s === null ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        // One row that never wraps: the figures shrink (truncate), the button keeps one width for every punch.
        <div className="flex min-w-0 items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot tone={s.state === 'in' ? 'good' : s.state === 'break' ? 'warn' : 'faint'} />
              <span className="shrink-0 text-[13px] font-medium">{stateLabel}</span>
              {s.state !== 'out' && s.since_time !== '' && <span className="hr-mono truncate text-[12px] text-[var(--hr-muted)]">{t('home.clock.since', { time: s.since_time })}</span>}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={cn('hr-mono hr-num font-light leading-none tracking-tight', compact === true ? 'text-[15px]' : 'text-[26px]')}>{Math.floor((s.worked_min ?? 0) / 60) + ':' + String((s.worked_min ?? 0) % 60).padStart(2, '0')}</span>
              <span className="hr-label">{t('home.clock.worked')}</span>
            </div>
            <div className="hr-label mt-1 truncate">{plan !== null && plan.kind === 'work' && plan.start !== '' ? (plan.shift_name !== '' ? plan.shift_name + ' · ' : '') + plan.start + ' to ' + plan.end : plan !== null && plan.holiday !== null ? plan.holiday.name : plan !== null && plan.leave !== null && plan.leave !== undefined ? plan.leave.name : t('home.clock.no_work')}</div>
          </div>
          {action !== null && (
            <Button variant="primary" size="lg" icon={Icon} onClick={press} className="w-[148px] shrink-0 justify-center whitespace-nowrap">
              {action.label}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- widget grid */

/** The modules' Home widgets for one kind of viewer between two orders (inclusive), by order. */
export function widgetsFor(kind: HomeWidget['for'], minOrder?: number | undefined, maxOrder?: number | undefined): HomeWidget[] {
  return homeWidgets(kind).filter((w) => (w.order ?? 100) >= (minOrder ?? -Infinity) && (w.order ?? 100) <= (maxOrder ?? Infinity));
}

export { Sparkline };

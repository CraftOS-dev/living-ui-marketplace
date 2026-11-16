/**
 * The even panels under "People and cost" on the admin Home (home-reports):
 * one size for all (two columns on desktop, one on phones), each with a
 * fixed body of six 40 px rows, its most useful content and one "See all".
 *
 *   agent     your AI agent: what it is doing, its latest work, the ask box
 *   team      your team today (an admin who also manages people)
 *   out       who is out today and later this week (leave.home)
 *   movers    starting and leaving in the next 30 days (lifecycle.home)
 *   roles     open roles with their candidates by stage (hiring.home)
 *   expenses  claims waiting, flagged and to pay (expenses.home)
 *   reports   the reports used most (only to keep the grid even)
 *
 * Each panel reads its module's home operation once the page's own read is
 * in (`ready`), so Home's first request stays first in line.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BriefcaseBusiness, CalendarDays, ChartColumn, Clock, Receipt, TrendingUp, UserPlus, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Button, Empty, LoadError, Money, Panel, PersonChip, Skeleton, StatusDot } from '../ui.tsx';
import { AskBox } from '../shell/AgentPanel.tsx';
import { useAgentQueue } from '../agent.tsx';
import { ProgressBar, TASK_READS } from '../lifecycle/bits.tsx';
import type { LifecycleHome, Mover } from '../lifecycle/types.ts';
import { allowed, can, useMe } from '../../lib/auth.tsx';
import { addDays, ago, fmtDay, fmtRange, minutes, relDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { READS as EXP_READS } from '../../pages/expenses/types.ts';
import type { Claim, Home as ExpensesHome } from '../../pages/expenses/types.ts';
import { READS as HIRING_READS } from '../../pages/hiring/types.ts';
import type { HiringHome } from '../../pages/hiring/types.ts';
import { READS as LEAVE_READS } from '../../pages/leave/data.ts';
import type { Home as LeaveHome, LeaveRequest } from '../../pages/leave/types.ts';
import { AsideLink } from './parts.tsx';
import type { AdminHome, BoardPerson } from './types.ts';

/** Rows in a panel body (40 px each): the body is always this tall. */
const ROWS = 6;

export type EvenKey = 'agent' | 'team' | 'out' | 'movers' | 'roles' | 'expenses' | 'reports';

/**
 * The even panels this viewer gets, in order: your AI agent always, the
 * modules' panels their rights allow once the company has people, and
 * Reports only when it makes the count even (two per row).
 */
export function evenPanels(me: ReturnType<typeof useMe>, team: boolean, people: boolean): EvenKey[] {
  const out: EvenKey[] = ['agent'];
  if (!people) return out;
  if (team) out.push('team');
  if (allowed(me, 'leave:view|people:view')) out.push('out');
  if (allowed(me, 'people:view')) out.push('movers');
  if (allowed(me, 'hiring:view')) out.push('roles');
  if (allowed(me, 'expenses:view')) out.push('expenses');
  if (out.length % 2 === 1 && allowed(me, 'reports:view')) out.push('reports');
  return out;
}

function EvenPanel({ index, label, href, children }: { index: string | undefined; label: string; href: string; children: ReactNode }): React.JSX.Element {
  return (
    <Panel index={index} label={label} aside={<AsideLink href={href}>{t('home.see_all')}</AsideLink>} flush className="h-full" bodyClass="flex h-[240px] flex-none flex-col overflow-hidden">
      {children}
    </Panel>
  );
}

const ROW = 'flex h-10 min-w-0 shrink-0 items-center gap-2.5 border-t border-[var(--hr-hair)] px-3.5';

function Line({ href, first, children, className }: { href?: string | undefined; first?: boolean | undefined; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  if (href !== undefined)
    return (
      <li>
        <a href={href} className={cn(ROW, 'hr-focus transition-colors hover:bg-[var(--hr-hover)]', first === true && 'border-t-0', className)}>
          {children}
        </a>
      </li>
    );
  return <li className={cn(ROW, first === true && 'border-t-0', className)}>{children}</li>;
}

function More({ n }: { n: number }): React.JSX.Element | null {
  if (n <= 0) return null;
  return <li className={cn(ROW, 'hr-label')}>{t('home.even.more', { n })}</li>;
}

function Loading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 px-3.5 pt-1" role="status" aria-label={t('ui.loading')}>
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-4/5" />
      <Skeleton className="h-7 w-3/5" />
    </div>
  );
}

function Quiet({ icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }): React.JSX.Element {
  return <Empty icon={icon} title={title} action={action} className="h-full py-4" />;
}

/* --------------------------------------------------------- your AI agent */

function AgentPanel({ index, agent }: { index: string | undefined; agent: AdminHome['agent'] | null }): React.JSX.Element {
  // What it did lately, newest first: as many rows as fit above the ask box.
  const queue = useAgentQueue();
  const items = agent === null ? [] : agent.actions.map((x) => ({ id: x.id, at: x.at, title: x.summary })).slice(0, ROWS - 3);
  return (
    <EvenPanel index={index} label={t('agent.name')} href="#/inbox?view=agent">
      {agent === null ? (
        <Loading />
      ) : (
        <>
          <div className="flex h-10 shrink-0 items-center gap-2.5 px-3.5">
            <AgentMark size={24} working={queue.working > 0} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{queue.working > 0 ? t('home.agent.working') : queue.waiting > 0 ? t('home.agent.waiting') : t('home.agent.idle')}</span>
            {queue.waiting > 0 && <span className="hr-label shrink-0">{tn('home.agent.open_n', queue.waiting)}</span>}
          </div>
          <ul className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {items.length === 0 ? (
              <Line className="hr-label">{t('home.agent.month', { done: agent.done_30, accepted: agent.proposals_accepted_30 })}</Line>
            ) : (
              items.map((it) => (
                <Line key={it.id}>
                  <StatusDot tone="neutral" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{it.title}</span>
                  <span className="hr-label shrink-0">{ago(it.at)}</span>
                </Line>
              ))
            )}
          </ul>
          <div className="shrink-0 px-3.5 pb-3.5 pt-2">
            <AskBox />
          </div>
        </>
      )}
    </EvenPanel>
  );
}

/* ------------------------------------------------------------ team today */

type Bucket = 'in' | 'out' | 'away' | 'off';
const STATE_GROUP: Record<string, Bucket> = { in: 'in', break: 'in', late: 'in', remote: 'in', on_duty: 'in', out: 'out', absent: 'out', expected: 'out', untracked: 'out', none: 'out', on_leave: 'away', off: 'off' };

function TeamPanel({ index, board }: { index: string | undefined; board: { people: BoardPerson[] } | null }): React.JSX.Element {
  const me = useMe();
  const rows = (board?.people ?? []).filter((r) => r.employee !== me.employee?.id);
  const bucket = (r: BoardPerson): Bucket => (r.leave !== null ? 'away' : (STATE_GROUP[r.state] ?? 'out'));
  const counts: Record<Bucket, number> = { in: 0, out: 0, away: 0, off: 0 };
  for (const r of rows) counts[bucket(r)]++;
  const order: Bucket[] = ['in', 'out', 'away', 'off'];
  const sorted = [...rows].sort((a, b) => order.indexOf(bucket(a)) - order.indexOf(bucket(b)));
  const shown = sorted.slice(0, sorted.length > ROWS - 1 ? ROWS - 2 : ROWS - 1);
  const say = (r: BoardPerson): string => {
    const k = bucket(r);
    if (k === 'in') return (r.first_in_time !== '' ? t('home.team.since', { time: r.first_in_time }) : r.state === 'remote' ? t('home.team.remote') : t('home.team.in')) + (r.late_min > 0 ? ' · ' + t('home.team.late', { time: minutes(r.late_min) }) : '');
    if (k === 'away') return r.leave?.name ?? t('home.team.away');
    if (k === 'off') return r.holiday !== '' ? r.holiday : t('home.team.off');
    return r.last_out_time !== '' ? t('home.team.left_at', { time: r.last_out_time }) : r.shift_over ? t('home.team.shift_over') : r.state === 'absent' ? t('home.team.absent') : t('home.team.not_in');
  };
  return (
    <EvenPanel index={index} label={t('home.team.title')} href="#/time">
      {board === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Quiet icon={Users} title={t('home.team.none')} />
      ) : (
        <ul className="flex flex-col">
          <Line first>
            {order.map((k) => (
              <span key={k} className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="hr-label truncate">{t('home.team.' + k)}</span>
                <span className="hr-mono hr-num text-[13px]">{counts[k]}</span>
              </span>
            ))}
          </Line>
          {shown.map((r) => (
            <Line key={r.employment}>
              <PersonChip name={r.name} size={22} strong={false} className="min-w-0 flex-1" />
              <span className="min-w-0 max-w-[62%] truncate text-right text-[12px] text-[var(--hr-muted)]">{say(r)}</span>
            </Line>
          ))}
          <More n={rows.length - shown.length} />
        </ul>
      )}
    </EvenPanel>
  );
}

/* ------------------------------------------------------------ who is out */

type OutItem = { kind: 'today' | 'later'; r: LeaveRequest } | { kind: 'none' } | { kind: 'sep' };

function OutPanel({ index, ready }: { index: string | undefined; ready: boolean }): React.JSX.Element {
  const live = useOp<LeaveHome>('leave.home', {}, LEAVE_READS, { name: 'leave.home.widget', skip: !ready });
  const d = live.data;
  const today = d?.out_today ?? [];
  const seen = new Set(today.map((r) => r.id));
  const later = (d?.out_week ?? []).filter((r) => !seen.has(r.id) && r.start > (d?.today ?? ''));
  const kind = (r: LeaveRequest): string => (r.away_only === true ? t('leave.away') : r.type_name);
  // Today first ("Nobody is out today" when so), then "Later this week"; the last row says how many more.
  const items: OutItem[] = [];
  if (today.length === 0) items.push({ kind: 'none' });
  for (const r of today) items.push({ kind: 'today', r });
  if (later.length > 0) items.push({ kind: 'sep' });
  for (const r of later) items.push({ kind: 'later', r });
  let shown = items.length > ROWS ? items.slice(0, ROWS - 1) : items;
  if (shown[shown.length - 1]?.kind === 'sep') shown = shown.slice(0, -1);
  const people = (list: OutItem[]): number => list.filter((x) => x.kind === 'today' || x.kind === 'later').length;
  return (
    <EvenPanel index={index} label={t('home.even.out')} href="#/leave/calendar">
      {d === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : today.length === 0 && later.length === 0 ? (
        <Quiet icon={Users} title={t('home.even.out_none')} />
      ) : (
        <ul className="flex flex-col">
          {shown.map((x, i) =>
            x.kind === 'none' ? (
              <Line key="none" first={i === 0} className="text-[12px] text-[var(--hr-muted)]">
                {t('home.even.out_none_today')}
              </Line>
            ) : x.kind === 'sep' ? (
              <Line key="sep" first={i === 0} className="hr-label">
                {t('home.even.later')}
              </Line>
            ) : (
              <Line key={x.r.id} first={i === 0}>
                <PersonChip name={x.r.name} size={22} strong={false} className="min-w-0 flex-1" />
                <span className="min-w-0 max-w-[62%] truncate text-right text-[12px] text-[var(--hr-muted)]">
                  {kind(x.r)} · {x.kind === 'today' ? t('leave.back_on', { day: fmtDay(addDays(x.r.end, 1), { entity: x.r.entity }) }) : fmtRange(x.r.start, x.r.end, { entity: x.r.entity })}
                </span>
              </Line>
            ),
          )}
          <More n={people(items) - people(shown)} />
        </ul>
      )}
    </EvenPanel>
  );
}

/* ---------------------------------------------------- starting and leaving */

function MoversPanel({ index, ready }: { index: string | undefined; ready: boolean }): React.JSX.Element {
  const me = useMe();
  const live = useOp<LifecycleHome>('lifecycle.home', {}, [...TASK_READS, 'employments', 'separations'], { name: 'lifecycle.home', skip: !ready });
  const h = live.data;
  const all: (Mover & { leaving: boolean })[] = h === null ? [] : [...h.starting.map((m) => ({ ...m, leaving: false })), ...h.leaving.map((m) => ({ ...m, leaving: true }))].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const shown = all.slice(0, all.length > ROWS ? ROWS - 1 : ROWS);
  return (
    <EvenPanel index={index} label={t('home.even.movers')} href="#/lifecycle">
      {h === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : all.length === 0 ? (
        <Quiet
          icon={UserPlus}
          title={t('home.even.movers_none', { n: h.days })}
          action={
            can(me, 'people', 'full') ? (
              <Button size="sm" icon={UserPlus} onClick={() => navigate('/people/new')}>
                {t('home.even.hire')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((m, i) => (
            <Line key={m.employment + (m.leaving ? ':l' : ':s')} first={i === 0} href={m.checklist !== null ? `#/lifecycle/checklists/${m.checklist.id}` : `#/people/${m.number}`}>
              <PersonChip name={m.name} size={22} strong={false} sub={m.title !== '' ? m.title : m.entity_name} className="min-w-0 flex-1" />
              <span className={cn('hr-label shrink-0 whitespace-nowrap', m.leaving && '!text-[var(--hr-warn)]')}>{(m.leaving ? t('home.even.leaves') : t('home.even.starts')) + ' ' + relDay(m.day)}</span>
              <span className="hidden w-[96px] shrink-0 justify-end sm:flex">{m.checklist !== null ? <ProgressBar progress={m.checklist.progress} className="w-full" /> : <span className="hr-label">{t('home.even.no_checklist')}</span>}</span>
            </Line>
          ))}
          <More n={all.length - shown.length} />
        </ul>
      )}
    </EvenPanel>
  );
}

/* ------------------------------------------------------------- open roles */

function Funnel({ stages }: { stages: { name: string; kind: string; count?: number | undefined }[] }): React.JSX.Element {
  const list = stages.filter((s) => s.kind !== 'hired').map((s) => ({ name: s.name, count: s.count ?? 0 }));
  const max = Math.max(1, ...list.map((s) => s.count));
  return (
    <span className="flex h-4 shrink-0 items-end gap-[3px]" title={list.map((s) => s.name + ' ' + s.count).join(' · ')} aria-label={list.map((s) => s.name + ' ' + s.count).join(', ')}>
      {list.map((s) => (
        <span key={s.name} className={cn('w-[5px] rounded-[1px]', s.count > 0 ? 'bg-[var(--hr-rh)]' : 'bg-[var(--hr-line)]')} style={{ height: `${Math.max(2, Math.round((16 * s.count) / max))}px` }} />
      ))}
    </span>
  );
}

function RolesPanel({ index, ready }: { index: string | undefined; ready: boolean }): React.JSX.Element {
  const live = useOp<HiringHome>('hiring.home', {}, HIRING_READS, { name: 'hiring.home', skip: !ready });
  const h = live.data;
  const list = h?.openings ?? [];
  const shown = list.slice(0, list.length > ROWS ? ROWS - 1 : ROWS);
  return (
    <EvenPanel index={index} label={t('home.even.roles')} href="#/hiring">
      {h === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : list.length === 0 ? (
        <Quiet
          icon={BriefcaseBusiness}
          title={t('home.even.roles_none')}
          action={
            h.can.edit ? (
              <Button size="sm" icon={BriefcaseBusiness} onClick={() => navigate('/hiring/openings')}>
                {t('home.even.open_role')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((o, i) => (
            <Line key={o.id} first={i === 0} href={`#/hiring/openings/${o.id}`}>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px]">{o.title}</span>
                <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[o.entity_name, tn('home.even.active', o.active)].join(' · ')}</span>
              </span>
              <Funnel stages={o.stages} />
              <span className="hr-mono hr-num w-[44px] shrink-0 text-right text-[12px] text-[var(--hr-ink-2)]" title={t('home.even.hired', { hired: o.hired, positions: o.positions })}>
                {o.hired}/{o.positions}
              </span>
            </Line>
          ))}
          <More n={list.length - shown.length} />
        </ul>
      )}
    </EvenPanel>
  );
}

/* --------------------------------------------------------------- expenses */

function ExpensesPanel({ index, ready }: { index: string | undefined; ready: boolean }): React.JSX.Element {
  const live = useOp<ExpensesHome>('expenses.home', {}, EXP_READS, { name: 'expenses.home.widget', skip: !ready });
  const h = live.data;
  const seen = new Set<string>();
  const claims: (Claim & { due: 'waiting' | 'to_pay' })[] = [];
  for (const c of h?.waiting.claims ?? []) if (!seen.has(c.id)) (seen.add(c.id), claims.push({ ...c, due: 'waiting' }));
  for (const c of h?.approved_unpaid.claims ?? []) if (!seen.has(c.id)) (seen.add(c.id), claims.push({ ...c, due: 'to_pay' }));
  const total = h === null ? 0 : h.waiting.total + h.approved_unpaid.total;
  const room = ROWS - 1;
  const shown = claims.slice(0, total > room ? room - 1 : room);
  const counts: { key: string; n: number; to: string; q: Record<string, string>; warn?: boolean }[] =
    h === null
      ? []
      : [
          { key: 'waiting', n: h.waiting.total, to: '/expenses/claims', q: { status: 'submitted' } },
          { key: 'flagged', n: h.flagged.total, to: '/expenses/claims', q: { status: 'submitted', flagged: 'true' }, warn: h.flagged.total > 0 },
          { key: 'to_pay', n: h.approved_unpaid.total, to: '/expenses/claims', q: { status: 'approved' } },
        ];
  return (
    <EvenPanel index={index} label={t('home.even.expenses')} href="#/expenses">
      {h === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : (
        <ul className="flex flex-col">
          <li className={cn(ROW, 'gap-1 border-t-0 px-2')}>
            {counts.map((c) => (
              <button key={c.key} type="button" onClick={() => navigate(c.to, c.q)} className="hr-focus hr-tap flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 rounded-[var(--hr-radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-[var(--hr-hover)]">
                <span className="hr-label hr-link truncate">{t('home.even.' + c.key)}</span>
                <span className={cn('hr-mono hr-num text-[13px]', c.warn === true && 'text-[var(--hr-warn)]')}>{c.n}</span>
              </button>
            ))}
          </li>
          {claims.length === 0 ? (
            <li className="flex min-h-0 flex-1 items-center justify-center gap-2 border-t border-[var(--hr-hair)] text-[13px] text-[var(--hr-muted)]">
              <Receipt size={14} aria-hidden />
              {t('home.even.exp_none')}
            </li>
          ) : (
            shown.map((c) => (
              <Line key={c.id} href={`#/expenses/claims/${c.number}`}>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px]">{c.employee_name}</span>
                  <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[c.number, c.label !== '' ? c.label : c.title].filter((x) => x !== '').join(' · ')}</span>
                </span>
                <Money minor={c.due === 'to_pay' ? c.payable_minor || c.approved_minor : c.total_minor} currency={c.currency} className="shrink-0 text-[12px]" />
                <span className={cn('hr-label w-[56px] shrink-0 text-right', c.due === 'to_pay' && '!text-[var(--hr-ink-2)]')}>{t('home.even.' + c.due)}</span>
              </Line>
            ))
          )}
          <More n={total - shown.length} />
        </ul>
      )}
    </EvenPanel>
  );
}

/* ---------------------------------------------------------------- reports */

const REPORTS: { key: string; title: string; icon: LucideIcon; to: string; perm: string }[] = [
  { key: 'headcount', title: 'rep.headcount.title', icon: Users, to: '#/reports/headcount', perm: 'reports:view' },
  { key: 'movement', title: 'rep.movement.title', icon: TrendingUp, to: '#/reports/movement', perm: 'reports:view' },
  { key: 'cost', title: 'rep.cost.title', icon: ChartColumn, to: '#/reports/cost', perm: 'payroll:view' },
  { key: 'absence', title: 'rep.absence.title', icon: Clock, to: '#/reports/absence', perm: 'reports:view' },
  { key: 'liability', title: 'rep.liability.title', icon: CalendarDays, to: '#/reports/leave-liability', perm: 'reports:view|leave:view' },
  { key: 'hiring', title: 'rep.hiring.title', icon: UserPlus, to: '#/reports/hiring', perm: 'reports:view|hiring:view' },
];

function ReportsPanel({ index }: { index: string | undefined }): React.JSX.Element {
  const me = useMe();
  const list = REPORTS.filter((r) => allowed(me, r.perm)).slice(0, ROWS);
  return (
    <EvenPanel index={index} label={t('home.even.reports')} href="#/reports">
      <ul className="flex flex-col">
        {list.map((r, i) => {
          const Icon = r.icon;
          return (
            <Line key={r.key} first={i === 0} href={r.to}>
              <Icon size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{t(r.title)}</span>
            </Line>
          );
        })}
      </ul>
    </EvenPanel>
  );
}

/** One even panel by key. */
export function EvenPlace({ k, index, ready, team, agent }: { k: EvenKey; index: string | undefined; ready: boolean; team: { people: BoardPerson[] } | null; agent: AdminHome['agent'] | null }): React.JSX.Element {
  if (k === 'agent') return <AgentPanel index={index} agent={agent} />;
  if (k === 'team') return <TeamPanel index={index} board={team} />;
  if (k === 'out') return <OutPanel index={index} ready={ready} />;
  if (k === 'movers') return <MoversPanel index={index} ready={ready} />;
  if (k === 'roles') return <RolesPanel index={index} ready={ready} />;
  if (k === 'expenses') return <ExpensesPanel index={index} ready={ready} />;
  return <ReportsPanel index={index} />;
}

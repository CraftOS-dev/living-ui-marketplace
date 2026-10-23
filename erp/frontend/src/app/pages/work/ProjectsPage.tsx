/**
 * Projects as cards: color, name, customer, manager, status, budget used,
 * hours logged, margin and task progress. Status chips with counts, "Mine",
 * search, and (for Projects viewers) the figures that need attention: hours
 * this month, time waiting for approval, time ready to bill, and the
 * projects most over budget. "New project" opens the form (?new=1 too).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, FolderKanban, FolderPlus, UserCheck } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Chips, ProgressBar, SearchBox, useDebounced } from '../../components/controls.tsx';
import { PersonAvatar } from '../../components/people/common.tsx';
import { BILLING_LABEL, PROJECT_STATE, ProjectForm, projectColor } from '../../components/work/common.tsx';
import { Card, CardHeader, Empty, Figure, LoadError, PageHeader, PillButton, Skeleton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { monthLabel } from '../../lib/dates.ts';
import { hours, money, pct, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Project, ProjectList, ProjectSummary } from '../../lib/types/work.ts';
import type { PageProps } from '../../routes.tsx';

type StatusFilter = 'open' | 'active' | 'on_hold' | 'done' | 'cancelled' | 'all';

function ProjectCard({ p, currency, delay }: { p: Project; currency: string; delay: number }): React.JSX.Element {
  const st = PROJECT_STATE[p.status];
  const used = p.budget > 0 ? p.budget_used / p.budget : null;
  const margin = p.revenue - p.spent - p.time_cost;
  return (
    <button
      type="button"
      onClick={() => navigate('project', { id: p.id })}
      className={cn('erp-rise relative flex w-full min-w-0 flex-col overflow-hidden rounded-[22px] bg-[var(--erp-card)] text-left transition-transform active:scale-[0.99]', `erp-d${Math.min(5, delay)}`)}
    >
      <span aria-hidden className="h-2 w-full" style={{ background: projectColor(p.color) }} />
      <span className="flex flex-col gap-3 p-4">
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold leading-[22px]">{p.name}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
              <span className="num">{p.code}</span>
              {p.customer !== null ? ` · ${p.customer.name}` : ' · Internal'}
            </span>
          </span>
          {p.status !== 'active' ? (
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
          ) : p.over_budget ? (
            <StatusPill tone="bad" size="sm">
              Over budget
            </StatusPill>
          ) : null}
        </span>
        <span className="block">
          <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="font-semibold text-[var(--erp-ink-2)]">{used !== null ? `${pct(Math.min(used, 9.99))} of budget` : 'No budget set'}</span>
            <span className="num text-[var(--erp-muted)]">{p.budget > 0 ? `${money(p.budget_used, currency, 'short')} of ${money(p.budget, currency, 'short')}` : money(p.budget_used, currency, 'short')}</span>
          </span>
          <ProgressBar value={used ?? 0} tone={used !== null && used > 1 ? 'red' : used !== null && used > 0.85 ? 'amber' : 'ink'} />
        </span>
        <span className="grid grid-cols-3 gap-2">
          <span className="rounded-[14px] bg-[var(--erp-row)] px-2.5 py-2">
            <span className="block text-[12px] text-[var(--erp-muted)]">Hours</span>
            <span className="num block truncate text-[14px] font-bold">{hours(p.hours)}</span>
          </span>
          <span className="rounded-[14px] bg-[var(--erp-row)] px-2.5 py-2">
            <span className="block text-[12px] text-[var(--erp-muted)]">Margin</span>
            <span className={cn('num block truncate text-[14px] font-bold', margin < 0 && p.revenue > 0 && 'text-[var(--erp-red-text)]')}>{p.revenue > 0 ? money(margin, currency, 'short') : p.billing === 'non_billable' ? 'Internal' : 'No sales yet'}</span>
          </span>
          <span className="rounded-[14px] bg-[var(--erp-row)] px-2.5 py-2">
            <span className="block text-[12px] text-[var(--erp-muted)]">Tasks</span>
            <span className="num block truncate text-[14px] font-bold">{p.progress.total > 0 ? `${p.progress.done}/${p.progress.total}` : 'None'}</span>
          </span>
        </span>
        <span className="flex items-center gap-2 text-[12px] text-[var(--erp-muted)]">
          {p.manager !== null ? (
            <>
              <PersonAvatar name={p.manager.name} size={22} />
              <span className="truncate font-semibold text-[var(--erp-ink-2)]">{p.manager.name}</span>
            </>
          ) : (
            <span>No manager</span>
          )}
          <span className="ml-auto shrink-0">{BILLING_LABEL[p.billing]}</span>
        </span>
      </span>
    </button>
  );
}

function Summary({ s }: { s: ProjectSummary }): React.JSX.Element {
  const cur = s.currency;
  return (
    <div className="mb-5 grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
      <Card tone="sand" className={s.over_budget.length > 0 ? '@min-[900px]:col-span-8' : '@min-[900px]:col-span-12'}>
        <div className="grid grid-cols-2 gap-4 @min-[640px]:grid-cols-4">
          <Figure label="Active projects" value={String(s.counts.active)} sub={s.counts.on_hold > 0 ? `${s.counts.on_hold} on hold` : 'none on hold'} />
          <Figure label={`Hours in ${monthLabel(s.month, true)}`} value={hours(s.hours_this_month)} sub={s.hours_this_month > 0 ? `${pct(s.billable_hours_this_month / s.hours_this_month)} billable` : 'nothing logged yet'} />
          <Figure label="Waiting for approval" value={hours(s.to_approve.hours)} sub={plural(s.to_approve.entries, 'entry', 'entries')} onClick={s.to_approve.entries > 0 ? () => navigate('timesheets', { tab: 'team' }) : undefined} />
          <Figure label="Ready to bill" value={money(s.to_bill.value, cur)} sub={`${hours(s.to_bill.hours)} approved`} />
        </div>
      </Card>
      {s.over_budget.length > 0 && (
        <Card className="@min-[900px]:col-span-4" delay={1}>
          <CardHeader title="Over budget" icon={AlertTriangle} />
          <ul className="flex flex-col gap-2">
            {s.over_budget.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => navigate('project', { id: o.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2 text-left hover:bg-[var(--erp-row-hover)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{o.name}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">{o.manager?.name ?? o.code}</span>
                  </span>
                  <span className="text-right">
                    <span className="num block text-[13px] font-bold text-[var(--erp-red-text)]">{o.budget_used_pct !== null ? `${Math.round(o.budget_used_pct)}%` : ''}</span>
                    <span className="num block text-[12px] text-[var(--erp-muted)]">+{money(o.over_by, cur, 'short')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function ProjectsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const viewer = can(me, 'projects');
  const status = (query.get('status') ?? 'open') as StatusFilter;
  const mine = query.get('mine') === '1' || !viewer;
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (query.get('new') !== null && can(me, 'projects', 'edit')) setAdding(true);
  }, [query, me]);
  const live = useLive(() => op<ProjectList>('projects.list', { status, mine: mine && viewer ? true : undefined, q: dq === '' ? undefined : dq, limit: 200 }, { quiet: true }), ['projects', 'project_tasks', 'timesheets', 'documents', 'journals'], [status, mine, dq, viewer]);
  const summary = useLive(() => (viewer ? op<ProjectSummary>('projects.summary', {}, { quiet: true }) : Promise.resolve(null)), ['projects', 'timesheets', 'documents', 'journals'], [viewer]);
  const d = live.data;
  const cur = d?.currency ?? baseCurrency(me);
  const setQuery = (patch: Record<string, string | undefined>): void => replaceQuery('projects', { status: status === 'open' ? undefined : status, mine: mine && viewer ? '1' : undefined, ...patch });
  const k = d?.counts;

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={viewer ? undefined : 'The projects you work on'}
        actions={
          <>
            <PillButton variant="light" icon={Clock} onClick={() => navigate('timesheets')}>
              Timesheets
            </PillButton>
            {d?.can.add === true && (
              <PillButton icon={FolderPlus} dot onClick={() => setAdding(true)}>
                New project
              </PillButton>
            )}
          </>
        }
      />
      {summary.data !== null && summary.data !== undefined && <Summary s={summary.data} />}
      <div className="mb-5 flex flex-col gap-3 @min-[900px]:flex-row @min-[900px]:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, code or customer" ariaLabel="Search projects" className="@min-[900px]:w-80" />
        {k !== undefined && (
          <Chips
            ariaLabel="Status"
            value={status}
            onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
            options={[
              { value: 'open', label: 'Open', count: k.active + k.on_hold },
              { value: 'active', label: 'Active', count: k.active },
              { value: 'on_hold', label: 'On hold', count: k.on_hold },
              { value: 'done', label: 'Done', count: k.done },
              { value: 'cancelled', label: 'Cancelled', count: k.cancelled },
              { value: 'all', label: 'All' },
            ]}
          />
        )}
        {viewer && (
          <button
            type="button"
            role="switch"
            aria-checked={mine}
            onClick={() => setQuery({ mine: mine ? undefined : '1' })}
            className={cn('inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-full px-4 text-[13px] font-semibold transition-colors @min-[900px]:self-auto', mine ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)] text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)]')}
          >
            <UserCheck size={14} aria-hidden /> Mine
          </button>
        )}
      </div>

      {live.error !== null && d === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : d === null ? (
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[232px]" rounded="rounded-[22px]" />
          ))}
        </div>
      ) : d.projects.length === 0 ? (
        <Card>
          <Empty
            icon={FolderKanban}
            title={dq !== '' ? 'No projects match' : mine ? 'No projects of yours here' : 'No projects here'}
            action={
              d.can.add && dq === '' ? (
                <PillButton icon={FolderPlus} dot onClick={() => setAdding(true)}>
                  New project
                </PillButton>
              ) : undefined
            }
          >
            {dq === '' ? 'Projects track tasks, time, costs and what they earn.' : undefined}
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-3">
          {d.projects.map((p, i) => (
            <ProjectCard key={p.id} p={p} currency={cur} delay={Math.floor(i / 3) + 1} />
          ))}
        </div>
      )}
      {adding && (
        <ProjectForm
          project={null}
          currency={cur}
          onClose={() => {
            setAdding(false);
            if (query.get('new') !== null) setQuery({ new: undefined });
          }}
          onSaved={(p) => navigate('project', { id: p.id })}
        />
      )}
    </div>
  );
}

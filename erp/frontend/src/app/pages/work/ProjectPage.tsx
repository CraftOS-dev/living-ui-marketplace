/**
 * One project: its board of tasks, the time logged on it (by person and
 * week), what it earns and costs, billing its approved time to a draft
 * invoice, its settings, and its history.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, FileText, LayoutGrid, PauseCircle, PlayCircle, Receipt, Settings2, Trash2, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { PairBars, PairLegend, RankBars, SplitBar } from '../../components/charts.tsx';
import { Menu, ProgressRing, Tabs } from '../../components/controls.tsx';
import { PersonAvatar } from '../../components/people/common.tsx';
import { DateField } from '../../components/pickers.tsx';
import { DataTable } from '../../components/table.tsx';
import { Board } from '../../components/work/Board.tsx';
import { BILLING_LABEL, PROJECT_STATE, ProjectForm, projectColor } from '../../components/work/common.tsx';
import { Card, CardHeader, Empty, Field, LoadError, Notice, PageHeader, PageSkeleton, PillButton, Skeleton, StatusPill, TextLink, Tile, useConfirm } from '../../components/ui.tsx';
import { errCode, op } from '../../lib/api.ts';
import { addDays, addMonths, dayLabel, monthLabel, shortDay, today } from '../../lib/dates.ts';
import { hours, money, plural, qty } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, replaceQuery, useSection } from '../../lib/router.ts';
import type { BillPreview, Profit, ProjectDetail, TimeList } from '../../lib/types/work.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'board' | 'time' | 'money' | 'bill' | 'settings' | 'activity';
const READS = ['projects', 'project_tasks', 'timesheets', 'documents', 'journals'] as const;

function mondayOf(day: string): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return addDays(day, -((d.getDay() + 6) % 7));
}

/* ----------------------------------------------------------------- time */

function TimeTab({ p, scope }: { p: ProjectDetail; scope: 'all' | 'mine' }): React.JSX.Element {
  const live = useLive(() => op<TimeList>('timesheets.list', { project: p.id, scope, limit: 1000 }, { quiet: true }), ['timesheets'], [p.id, scope]);
  const d = live.data;
  const weeks = useMemo(() => {
    const m = new Map<string, { week: string; hours: number; billable: number; people: Map<string, { name: string; hours: number; billable: number }> }>();
    for (const t of d?.entries ?? []) {
      if (t.status === 'rejected') continue;
      const w = mondayOf(t.date);
      let g = m.get(w);
      if (g === undefined) {
        g = { week: w, hours: 0, billable: 0, people: new Map() };
        m.set(w, g);
      }
      g.hours += t.hours;
      if (t.billable) g.billable += t.hours;
      const pp = g.people.get(t.employee.id) ?? { name: t.employee.name, hours: 0, billable: 0 };
      pp.hours += t.hours;
      if (t.billable) pp.billable += t.hours;
      g.people.set(t.employee.id, pp);
    }
    return [...m.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
  }, [d]);
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card className="@min-[900px]:col-span-4">
        <CardHeader title="By person" subtitle={`${hours(p.hours)} in all, ${hours(p.billable_hours)} billable`} />
        {p.people.length === 0 ? (
          <p className="text-[13px] text-[var(--erp-muted)]">No time logged yet.</p>
        ) : (
          <RankBars
            rows={p.people.map((x) => ({
              key: x.employee.id,
              label: x.employee.name,
              value: x.hours,
              valueText: hours(x.hours),
              sub: x.billable_hours < x.hours ? `${hours(x.billable_hours)} billable` : 'all billable',
              lead: <PersonAvatar name={x.employee.name} size={30} />,
              onClick: () => navigate('employee', { id: x.employee.id }),
            }))}
          />
        )}
      </Card>
      <Card className="@min-[900px]:col-span-8" delay={2}>
        <CardHeader title="By week" subtitle={scope === 'mine' ? 'Your time on this project' : undefined} />
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : d === null ? (
          <Skeleton className="h-24" />
        ) : weeks.length === 0 ? (
          <Empty icon={Clock} title="No time logged yet" compact />
        ) : (
          <ul className="flex flex-col gap-3">
            {weeks.map((w) => (
              <li key={w.week} className="rounded-[20px] bg-[var(--erp-row)] p-3 @min-[640px]:p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold">
                    Week of {shortDay(w.week)}
                    <span className="ml-2 text-[12px] font-semibold text-[var(--erp-muted)]">to {shortDay(addDays(w.week, 6))}</span>
                  </span>
                  <span className="num text-[14px] font-bold">
                    {hours(w.hours)}
                    <span className="ml-2 text-[12px] font-semibold text-[var(--erp-muted)]">{hours(w.billable)} billable</span>
                  </span>
                </div>
                <SplitBar
                  legend={false}
                  height={8}
                  parts={[
                    { key: 'b', label: 'Billable', value: w.billable, valueText: hours(w.billable), fill: 'var(--erp-ink)' },
                    { key: 'n', label: 'Not billable', value: w.hours - w.billable, valueText: hours(w.hours - w.billable), fill: 'var(--erp-line)' },
                  ]}
                />
                <ul className="mt-3 grid grid-cols-1 gap-1.5 @min-[480px]:grid-cols-2">
                  {[...w.people.entries()].map(([id, x]) => (
                    <li key={id} className="flex items-center gap-2 rounded-[14px] bg-[var(--erp-card)] px-2.5 py-1.5">
                      <PersonAvatar name={x.name} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{x.name}</span>
                      <span className="num text-[13px] font-bold">{qty(Math.round(x.hours * 100) / 100)} h</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- money */

function MoneyTab({ p }: { p: ProjectDetail }): React.JSX.Element {
  const f = p.profit;
  const cur = f.currency;
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => addMonths(today().slice(0, 7), i - 5)), []);
  const [series, setSeries] = useState<Profit[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(months.map((m) => op<Profit>('projects.profit', { project: p.id, from: `${m}-01`, to: addDays(`${addMonths(m, 1)}-01`, -1) }, { quiet: true })))
      .then((r) => {
        if (live) setSeries(r);
      })
      .catch(() => {
        if (live) setSeries([]);
      });
    return () => {
      live = false;
    };
  }, [p.id, months, p.updated, p.revenue, p.spent, p.time_cost]);
  const used = f.budget > 0 ? f.budget_used / f.budget : null;
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
        <Card tone="dark">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Margin after time</p>
              <p className={cn('num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]', f.margin_after_time < 0 && f.revenue > 0 && 'text-[var(--erp-red-text)]')}>{money(f.margin_after_time, cur)}</p>
              <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">{f.margin_after_time_pct !== null ? `${qty(f.margin_after_time_pct)}% of revenue` : 'No revenue yet'}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 @min-[480px]:grid-cols-4">
            <Tile dark label="Revenue" value={money(f.revenue, cur)} />
            <Tile dark label="Costs in the books" value={money(f.costs, cur)} />
            <Tile dark label="Time cost" value={money(f.time_cost, cur)} />
            <Tile dark label="Books margin" value={money(f.books_margin, cur)} />
          </div>
        </Card>
        <Card delay={2}>
          <CardHeader title="Month by month" subtitle="Revenue against costs and time" action={<PairLegend a="Revenue" b="Costs and time" />} />
          {series === null ? (
            <Skeleton className="h-44" />
          ) : series.every((x) => x.revenue === 0 && x.costs === 0 && x.time_cost === 0) ? (
            <Empty icon={Wallet} title="Nothing earned or spent in the last six months" compact>
              Posted invoices for the project, costs booked to it and time with an hourly cost show here.
            </Empty>
          ) : (
            <PairBars
              height={170}
              aName="Revenue"
              bName="Costs and time"
              format={(n) => money(n, cur, 'short')}
              points={series.map((s, i) => ({ key: months[i] ?? String(i), label: monthLabel(months[i] ?? ''), axis: monthLabel(months[i] ?? '', true).slice(0, 3), a: Math.max(0, s.revenue), b: Math.max(0, s.costs + s.time_cost), aText: money(s.revenue, cur), bText: money(s.costs + s.time_cost, cur) }))}
            />
          )}
          <p className="mt-3 text-[12px] text-[var(--erp-muted)]">{f.note}</p>
        </Card>
        {(f.documents.length > 0 || f.cost_accounts.length > 0) && (
          <Card delay={3}>
            <CardHeader title="Where it comes from" />
            <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2">
              <div>
                <p className="mb-2 text-[12px] font-bold text-[var(--erp-muted)]">Invoices and credit notes</p>
                {f.documents.length === 0 ? (
                  <p className="text-[13px] text-[var(--erp-muted)]">None posted yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {f.documents.map((x) => (
                      <li key={x.id}>
                        <button type="button" onClick={() => navigate('doc', { id: x.id })} className="flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--erp-row)]">
                          <FileText size={13} aria-hidden className="shrink-0 text-[var(--erp-muted)]" />
                          <span className="num min-w-0 flex-1 truncate font-semibold">{x.number}</span>
                          <span className="text-[12px] text-[var(--erp-muted)]">{shortDay(x.date)}</span>
                          <span className="num w-24 text-right font-semibold">{money(x.net, cur)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-[12px] font-bold text-[var(--erp-muted)]">Costs by account</p>
                {f.cost_accounts.length === 0 ? (
                  <p className="text-[13px] text-[var(--erp-muted)]">No costs booked to the project.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {f.cost_accounts.map((x) => (
                      <li key={x.account.id}>
                        <button type="button" onClick={() => navigate('account', { id: x.account.id })} className="flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--erp-row)]">
                          <span className="num text-[12px] text-[var(--erp-muted)]">{x.account.code}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{x.account.name}</span>
                          <span className="num w-24 text-right font-semibold">{money(x.amount, cur)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
      <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
        <CardHeader title="Budget" />
        {used === null ? (
          <p className="text-[13px] text-[var(--erp-ink-2)]">No budget set. Set one under Settings to see how much is used.</p>
        ) : (
          <div className="flex items-center gap-4">
            <ProgressRing value={Math.min(1, used)} size={96} tone={used > 1 ? 'red' : used > 0.85 ? 'amber' : 'accent'}>
              <span className="text-[15px] font-extrabold">{Math.round(used * 100)}%</span>
            </ProgressRing>
            <div className="min-w-0 text-[13px]">
              <p className="num text-[15px] font-bold">{money(f.budget_used, cur)}</p>
              <p className="text-[var(--erp-muted)]">used of {money(f.budget, cur)}</p>
              <p className={cn('num mt-1 font-semibold', (f.budget_left ?? 0) < 0 && 'text-[var(--erp-red-text)]')}>{(f.budget_left ?? 0) < 0 ? `${money(-(f.budget_left ?? 0), cur)} over` : `${money(f.budget_left ?? 0, cur)} left`}</p>
            </div>
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Tile label="Hours" value={hours(f.hours)} />
          <Tile label="Billable value" value={money(f.billable_value, cur)} />
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- bill */

function BillTab({ p }: { p: ProjectDetail }): React.JSX.Element {
  const [through, setThrough] = useState(today());
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setEmpty(false);
    setError(null);
    // Nothing approved to bill at all: no need to ask (the server answers that with a refusal).
    if (p.to_bill.entries === 0) {
      setEmpty(true);
      return;
    }
    op<BillPreview>('timesheets.bill', { project: p.id, through, preview: true }, { quiet: true })
      .then((r) => {
        if (live) setPreview(r);
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (errCode(e) === 'nothing_to_bill') setEmpty(true);
        else setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [p.id, through, p.to_bill.entries]);
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ id: string; number: string }>('timesheets.bill', { project: p.id, through });
      toast.success(`Draft invoice ${r.number !== '' ? r.number : ''} created`);
      navigate('doc', { id: r.id });
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card className="@min-[900px]:col-span-8">
        <CardHeader title="Bill approved time" subtitle={p.customer !== null ? `One draft invoice to ${p.customer.name}, a line per person` : undefined} />
        <div className="mb-4 max-w-xs">
          <Field label="Time up to">
            <DateField value={through} onChange={setThrough} ariaLabel="Bill time up to" max={today()} />
          </Field>
        </div>
        {error !== null ? (
          <Notice tone="bad">{error}</Notice>
        ) : empty ? (
          <Empty icon={Receipt} title="Nothing to bill" compact>
            Approved billable time up to {dayLabel(through).toLowerCase()} shows here.
          </Empty>
        ) : preview === null ? (
          <Skeleton className="h-28" />
        ) : (
          <>
            <DataTable
              ariaLabel="Lines to bill"
              rows={preview.lines}
              rowKey={(l) => `${l.employee.id}-${l.rate}`}
              columns={[
                {
                  key: 'p',
                  label: 'Person',
                  width: 'minmax(0, 2fr)',
                  render: (l) => (
                    <span className="flex min-w-0 items-center gap-2">
                      <PersonAvatar name={l.employee.name} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{l.employee.name}</span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                          {shortDay(l.from)} to {shortDay(l.to)}
                        </span>
                      </span>
                    </span>
                  ),
                },
                { key: 'h', label: 'Hours', width: '80px', align: 'right', render: (l) => qty(l.hours) },
                { key: 'r', label: 'Rate', width: '100px', align: 'right', hide: 'sm', render: (l) => l.rate_text },
                { key: 'a', label: 'Amount', width: '120px', align: 'right', render: (l) => <span className="font-bold">{money(l.amount, preview.currency)}</span> },
              ]}
              mobile={(l) => ({ title: l.employee.name, sub: `${qty(l.hours)} h at ${l.rate_text}`, right: money(l.amount, preview.currency) })}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--erp-line)] pt-4">
              <p className="text-[12px] text-[var(--erp-muted)]">{preview.note}</p>
              <div className="flex items-center gap-4">
                <span className="num text-[15px] font-extrabold">{money(preview.amount, preview.currency)}</span>
                <PillButton icon={Receipt} dot loading={busy} onClick={() => void create()}>
                  Create the draft invoice
                </PillButton>
              </div>
            </div>
          </>
        )}
      </Card>
      <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
        <CardHeader title="Billed before" />
        {p.documents.filter((x) => x.type === 'invoice').length === 0 ? (
          <p className="text-[13px] text-[var(--erp-ink-2)]">No invoices for this project yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {p.documents
              .filter((x) => x.type === 'invoice')
              .slice(0, 8)
              .map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => navigate('doc', { id: x.id })} className="flex w-full items-center gap-2 rounded-[14px] bg-[var(--erp-card)] px-3 py-2 text-left text-[13px]">
                    <span className="num min-w-0 flex-1 truncate font-bold">{x.number !== '' ? x.number : 'Draft'}</span>
                    <span className="text-[12px] text-[var(--erp-muted)]">{shortDay(x.date)}</span>
                    <span className="num font-semibold">{money(x.total, x.currency)}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- page */

export function ProjectPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = query.get('id') ?? '';
  const live = useLive(() => op<ProjectDetail>('projects.get', { project: id }, { quiet: true }), [...READS], [id]);
  const [confirmEl, confirm] = useConfirm();
  useSection('project', can(me, 'projects') ? 'projects' : 'timesheets');
  const p = live.data;
  if (p === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Project" back={() => back('projects')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }
  const billRights = can(me, 'projects', 'full') || can(me, 'sales', 'edit');
  const showBill = p.billing === 'time_materials' && billRights;
  const tabs: { value: Tab; label: string; icon: typeof Clock; count?: number | undefined }[] = [
    { value: 'board', label: 'Board', icon: LayoutGrid },
    { value: 'time', label: 'Time', icon: Clock },
    { value: 'money', label: 'Money', icon: Wallet },
    ...(showBill ? [{ value: 'bill' as Tab, label: 'Bill time', icon: Receipt, count: p.to_bill.entries > 0 ? p.to_bill.entries : undefined }] : []),
    ...(p.can.edit ? [{ value: 'settings' as Tab, label: 'Settings', icon: Settings2 }] : []),
    { value: 'activity', label: 'Activity', icon: FileText },
  ];
  const asked = query.get('tab') as Tab | null;
  const tab: Tab = asked !== null && tabs.some((t) => t.value === asked) ? asked : 'board';
  const setTab = (t: Tab): void => replaceQuery('project', { id, tab: t === 'board' ? undefined : t });
  const st = PROJECT_STATE[p.status];
  const isManager = me.employee !== null && p.manager?.id === me.employee.id;
  const timeScope: 'all' | 'mine' = can(me, 'projects') || isManager ? 'all' : 'mine';
  const used = p.budget > 0 ? p.budget_used / p.budget : null;

  const setStatus = async (status: 'active' | 'on_hold' | 'done'): Promise<void> => {
    try {
      live.set(await op<ProjectDetail>('projects.update', { project: p.id, status }));
      toast.success(status === 'done' ? 'Marked done' : status === 'on_hold' ? 'Put on hold' : 'Active again');
    } catch {
      /* shown */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      const pv = await op<{ tasks: number }>('projects.delete', { project: p.id, preview: true }, { quiet: true });
      if (!(await confirm(`${p.code} ${p.name}${pv.tasks > 0 ? ` and its ${plural(pv.tasks, 'task')}` : ''} are deleted.`, 'Delete this project?'))) return;
      await op('projects.delete', { project: p.id });
      toast.success('Deleted');
      navigate('projects');
    } catch (e) {
      await confirm(<span>{(e as Error).message}</span>, 'This project cannot be deleted', 'Mark it done', false).then((yes) => (yes ? setStatus('done') : undefined));
    }
  };

  return (
    <div>
      <PageHeader
        back={() => back('projects')}
        eyebrow={
          <>
            <span className="inline-block size-2.5 rounded-full" style={{ background: projectColor(p.color) }} />
            <span className="num">{p.code}</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
            <span>{BILLING_LABEL[p.billing]}</span>
          </>
        }
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.customer !== null ? (
              <TextLink tone="muted" onClick={() => navigate('party', { id: p.customer?.id ?? '', role: 'customer' })}>
                {p.customer.name} <ArrowUpRight size={12} aria-hidden />
              </TextLink>
            ) : (
              <span>Internal</span>
            )}
            {p.manager !== null && (
              <button type="button" onClick={() => navigate('employee', { id: p.manager?.id ?? '' })} className="inline-flex items-center gap-1.5 font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                <PersonAvatar name={p.manager.name} size={20} /> {p.manager.name}
              </button>
            )}
            {(p.start !== '' || p.end !== '') && (
              <span>
                {p.start !== '' ? shortDay(p.start) : ''}
                {p.end !== '' ? ` to ${shortDay(p.end)}` : ''}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {p.can.log_time && (
              <PillButton variant="light" icon={Clock} onClick={() => navigate('timesheets')}>
                Log time
              </PillButton>
            )}
            <Menu
              items={[
                { label: 'Put on hold', icon: PauseCircle, hidden: !p.can.edit || p.status !== 'active', onClick: () => void setStatus('on_hold') },
                { label: 'Mark done', icon: CheckCircle2, hidden: !p.can.edit || p.status === 'done', onClick: () => void setStatus('done') },
                { label: 'Make active', icon: PlayCircle, hidden: !p.can.edit || p.status === 'active', onClick: () => void setStatus('active') },
                { label: 'Delete project', icon: Trash2, danger: true, hidden: !p.can.delete, onClick: () => void remove() },
              ]}
            />
          </>
        }
      />

      <div className="erp-rise mb-5 grid grid-cols-2 gap-2 @min-[640px]:grid-cols-4">
        <div className="flex items-center gap-3 rounded-[20px] bg-[var(--erp-card)] p-3">
          <ProgressRing value={Math.min(1, used ?? 0)} size={48} tone={used !== null && used > 1 ? 'red' : used !== null && used > 0.85 ? 'amber' : 'accent'}>
            <span className="text-[12px]">{used !== null ? `${Math.round(used * 100)}%` : ''}</span>
          </ProgressRing>
          <span className="min-w-0">
            <span className="block text-[12px] text-[var(--erp-muted)]">Budget used</span>
            <span className="num block truncate text-[14px] font-bold">{p.budget > 0 ? `${money(p.budget_used, p.currency, 'short')} of ${money(p.budget, p.currency, 'short')}` : 'No budget'}</span>
          </span>
        </div>
        <Tile label="Hours logged" value={hours(p.hours)} className="bg-[var(--erp-card)]" />
        <Tile label="Tasks done" value={p.progress.total > 0 ? `${p.progress.done} of ${p.progress.total}` : 'No tasks'} className="bg-[var(--erp-card)]" />
        <Tile
          label={p.billing === 'time_materials' ? 'Ready to bill' : 'Waiting for approval'}
          value={p.billing === 'time_materials' ? money(p.to_bill.value, p.currency) : plural(p.to_approve, 'entry', 'entries')}
          className="bg-[var(--erp-card)]"
          onClick={p.billing === 'time_materials' && showBill && p.to_bill.entries > 0 ? () => setTab('bill') : undefined}
        />
      </div>

      <Tabs ariaLabel="Project sections" value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'board' && (
        <>
          {p.description !== '' && <p className="mb-4 max-w-3xl text-[14px] leading-[22px] text-[var(--erp-ink-2)]">{p.description}</p>}
          <Board projectId={p.id} tasks={p.tasks} editable={p.can.tasks} canDelete={p.can.edit} onChanged={live.reload} />
        </>
      )}
      {tab === 'time' && <TimeTab p={p} scope={timeScope} />}
      {tab === 'money' && <MoneyTab p={p} />}
      {tab === 'bill' && <BillTab p={p} />}
      {tab === 'settings' && (
        <Card className="max-w-3xl">
          <CardHeader title="Project settings" />
          <ProjectForm project={p} currency={p.currency} inline onClose={() => undefined} onSaved={live.set} />
        </Card>
      )}
      {tab === 'activity' && <RecordActivity entity="projects" refId={p.id} title="History, notes and files" className="max-w-3xl" />}
      {confirmEl}
    </div>
  );
}


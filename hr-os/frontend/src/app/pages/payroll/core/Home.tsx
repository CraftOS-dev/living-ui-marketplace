/**
 * Payroll home (payroll people): the next pay day of every schedule as a
 * countdown, runs in progress with their blockers, set-up gaps, this year's
 * totals and a quiet monthly bar chart. Employees reaching /payroll get
 * their own pay (MyPay). "Run payroll" (/payroll/run) shows the next period
 * and what its run will include; the run starts only on "Start pay run".
 * The runs list starts any kind of run.
 */
import { useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarClock, CircleAlert, Play, Plus } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Fact, Field, LoadError, Loading, Money, Notice, PageBody, PageHeader, Panel, Picker, RowCue, Segmented, StatTile, StatusDot, Tag, toast } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { op } from '../../../lib/api.ts';
import { allowed, can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, monthName } from '../../../lib/format.ts';
import { toMajor } from '../../../lib/money.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { navigate } from '../../../lib/router.ts';
import { useUi } from '../../../lib/store.tsx';
import { kindLabel, periodLabel, periodWords, RunStatus, runTitle } from '../../../components/payroll/bits.tsx';
import { MyPay } from './People.tsx';
import { payrollPages } from '../index.tsx';
import type { NextPeriod, RunSummary } from './types.ts';

const READS = ['payruns', 'payslips', 'pay_schedules', 'approvals', 'payroll_settings'];

interface HomeData {
  schedules: (NextPeriod & { people: number; frequency: string })[];
  in_progress: RunSummary[];
  blockers: { payrun: string; number: string; entity_name: string; blockers: number; link: string }[];
  totals: { entity: string; entity_name: string; currency: string; year: string; gross_minor: number; net_minor: number; employer_minor: number; deductions_minor: number; runs: number; months: { month: string; gross_minor: number; net_minor: number; employer_minor: number }[] }[];
  setup: { entity: string; entity_name: string; code: string; fields?: string[]; link: string }[];
  pending_approvals: number;
  next: NextPeriod | null;
}

/** /payroll: payroll people get the payroll home, everyone else their own pay. */
export function PayrollRoot(props: PageProps): React.JSX.Element {
  const me = useMe();
  return can(me, 'payroll', 'view') ? <PayrollHome {...props} /> : <MyPay {...props} />;
}

function countdown(days: number): string {
  if (days === 0) return t('payroll.today');
  if (days < 0) return tn('payroll.days_ago', -days);
  return tn('payroll.in_days', days);
}

/** A quiet monthly bar chart (net in the primary series, employer cost in the secondary). */
function MonthBars({ months, currency, year }: { months: HomeData['totals'][number]['months']; currency: string; year: string }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const all = Array.from({ length: 12 }, (_, i) => {
    const key = year + '-' + String(i + 1).padStart(2, '0');
    return months.find((m) => m.month === key) ?? { month: key, gross_minor: 0, net_minor: 0, employer_minor: 0 };
  });
  const max = Math.max(1, ...all.map((m) => toMajor(m.net_minor + m.employer_minor, currency)));
  const sel = hover !== null ? all[hover] : null;
  return (
    <div className="min-w-0">
      <div className="flex h-[96px] items-end gap-1.5" onMouseLeave={() => setHover(null)}>
        {all.map((m, i) => {
          const net = toMajor(m.net_minor, currency) / max;
          const er = toMajor(m.employer_minor, currency) / max;
          return (
            <div key={m.month} className="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end" onMouseEnter={() => setHover(i)} title={monthName(i + 1, 'short')}>
              <div className="w-full rounded-t-[2px] bg-[var(--hr-lh)] opacity-70 transition-opacity duration-150" style={{ height: er * 100 + '%' }} />
              <div className="w-full bg-[var(--hr-rh)] transition-opacity duration-150" style={{ height: net * 100 + '%', opacity: hover === null || hover === i ? 1 : 0.55 }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {all.map((m, i) => (
          <span key={m.month} className="hr-mono flex-1 text-center text-[10.5px] text-[var(--hr-faint)]">
            {monthName(i + 1, 'short').slice(0, 1)}
          </span>
        ))}
      </div>
      <div className="mt-1 flex h-4 flex-wrap items-baseline gap-x-1.5 text-[12px] text-[var(--hr-muted)]">
        {sel && (
          <>
            <span>{monthName(Number(sel.month.slice(5)), 'long') + ': ' + t('payroll.chart.net')}</span>
            <Money minor={sel.net_minor} currency={currency} />
            <span>{'· ' + t('payroll.chart.employer')}</span>
            <Money minor={sel.employer_minor} currency={currency} />
          </>
        )}
      </div>
    </div>
  );
}

export function PayrollHome(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const live = useOp<HomeData>('payroll.home', { entity: entity === '' ? undefined : entity }, READS, { name: 'payroll.home' });
  const d = live.data;
  const edit = can(me, 'payroll', 'edit');
  if (d === null)
    return (
      <>
        <PageHeader title={t('payroll.title')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const next = d.next;
  return (
    <>
      <PageHeader title={t('payroll.title')} meta={[tn('payroll.n_schedules', d.schedules.length), d.pending_approvals > 0 ? tn('payroll.n_approvals', d.pending_approvals) : ''].filter((x) => x !== '').join(' · ')}>
        {edit && next !== null && (
          <Button variant="primary" icon={Play} onClick={() => (next.run ? navigate('/payroll/runs/' + next.run.id) : navigate('/payroll/run', { schedule: next.schedule }))}>
            {t(next.run ? 'payroll.act.continue_period' : 'payroll.act.start_period', { period: periodWords(next.period_start, next.period_end) })}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {d.setup.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {d.setup.map((s, i) => (
              <Notice key={i} tone="warn" action={<Button size="sm" onClick={() => (window.location.hash = s.link)}>{t('payroll.fix')}</Button>}>
                {t('payroll.setup.' + s.code, { entity: s.entity_name, n: (s.fields ?? []).length })}
              </Notice>
            ))}
          </div>
        )}
        {d.schedules.length > 0 && d.schedules.every((s) => s.people === 0) && d.in_progress.length === 0 && (
          <Empty icon={Banknote} title={t('payroll.empty.nobody_yet')} className="hr-panel mb-3" action={can(me, 'people', 'full') ? <Button variant="primary" icon={Plus} onClick={() => navigate('/people/new')}>{t('payroll.act.hire_first')}</Button> : undefined}>
            {t('payroll.empty.nobody_yet_sub')}
          </Empty>
        )}
        {d.schedules.length === 0 ? (
          <Empty icon={CalendarClock} title={t('payroll.empty.no_schedules')} action={edit ? <Button variant="primary" icon={Plus} onClick={() => navigate('/payroll/schedules')}>{t('payroll.act.add_schedule')}</Button> : undefined} />
        ) : (
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.schedules.map((s, i) => (
              <button key={s.schedule} type="button" onClick={() => (s.run ? navigate('/payroll/runs/' + s.run.id) : navigate('/payroll/run', { schedule: s.schedule }))} className="hr-panel hr-in cursor-pointer px-4 py-3 text-left transition-colors duration-150 hover:bg-[var(--hr-hover)]">
                <div className="hr-label mb-1">{s.entity_name + ' · ' + s.name + ' · ' + periodWords(s.period_start, s.period_end)}</div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="hr-mono hr-num text-[26px] font-light leading-tight">{countdown(s.days_to_pay)}</span>
                  {s.run ? <RunStatus status={s.run.status} /> : <StatusDot tone="faint" label={t('payroll.not_started')} />}
                </div>
                <div className="mt-1 text-[12px] text-[var(--hr-muted)]">
                  {t('payroll.pay_day_on', { day: fmtDay(s.pay_date) })}
                  {s.pay_date_moved && <span>{' · ' + t('payroll.moved_from', { day: fmtDay(s.planned_pay_date) }) + (s.moved_because !== '' ? ' (' + s.moved_because + ')' : '')}</span>}
                  {' · ' + t('payroll.inputs_close', { day: fmtDay(s.cutoff_day) })}
                  {' · ' + tn('payroll.n_people', s.people)}
                </div>
              </button>
            ))}
          </div>
        )}
        <Panel index={String(1).padStart(2, '0')} label={t('payroll.pages')} className="mb-3">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
            {payrollPages.filter((x) => allowed(me, x.perm)).map((x) => (
              <a key={x.key} href={'#' + x.to} className="group flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-[var(--hr-radius-sm)] px-2 text-[13px] transition-colors duration-150 hover:bg-[var(--hr-hover)]">
                {x.label}
                <RowCue />
              </a>
            ))}
          </div>
        </Panel>
        {d.in_progress.length > 0 && (
          <Panel index="02" label={t('payroll.in_progress')} flush className="mb-3">
            <div className="divide-y divide-[var(--hr-hair)]">
              {d.in_progress.map((r) => (
                <a key={r.id} href={'#/payroll/runs/' + r.id} className="group grid min-h-10 cursor-pointer grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-[var(--hr-hover)] sm:grid-cols-[minmax(0,1fr)_104px_120px_130px_14px]">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{runTitle(r)}</span>
                    <span className="hr-mono block text-[10.5px] text-[var(--hr-faint)]">{[r.number, r.entity_name, fmtDay(r.pay_date)].join(' · ')}</span>
                  </span>
                  <span className="hidden sm:block">{r.blockers > 0 && <Tag tone="bad">{tn('payroll.n_blockers', r.blockers)}</Tag>}</span>
                  <span className="hidden sm:block"><RunStatus status={r.status} /></span>
                  <Money minor={r.net_minor} currency={r.currency} className="hr-mono hr-num text-right text-[13px]" />
                  <RowCue />
                </a>
              ))}
            </div>
          </Panel>
        )}
        {d.totals.filter((tot) => tot.runs > 0).map((tot, i) => (
          <Panel key={tot.entity} index={String(i + (d.in_progress.length > 0 ? 3 : 2)).padStart(2, '0')} label={tot.entity_name + ' · ' + tot.year} className="mb-3">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label={t('payroll.year_net')} value={<Money minor={tot.net_minor} currency={tot.currency} format={{ compact: true }} />} />
                <StatTile label={t('payroll.year_gross')} value={<Money minor={tot.gross_minor} currency={tot.currency} format={{ compact: true }} />} />
                <StatTile label={t('payroll.year_employer')} value={<Money minor={tot.employer_minor} currency={tot.currency} format={{ compact: true }} />} />
                <StatTile label={t('payroll.year_runs')} value={tot.runs} />
              </div>
              <MonthBars months={tot.months} currency={tot.currency} year={tot.year} />
            </div>
          </Panel>
        ))}
      </PageBody>
    </>
  );
}

/**
 * /payroll/run: the next period of a schedule (or the first due) and what its
 * run will include. Nothing is created by opening it: "Start pay run" makes
 * the run; a period that already has one offers "Continue".
 */
export function RunPayrollPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const schedule = query.get('schedule') ?? '';
  const live = useOp<{ next: (NextPeriod & { people?: number; open_inputs?: number })[]; first: NextPeriod | null }>('payruns.next', {}, READS, { name: 'payroll.next' });
  const [busy, setBusy] = useState(false);
  const d = live.data;
  if (d === null)
    return (
      <>
        <PageHeader title={t('payroll.act.run_payroll')} back="#/payroll" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const n = schedule !== '' ? (d.next.find((x) => x.schedule === schedule) ?? null) : (d.next[0] ?? null);
  if (n === null)
    return (
      <>
        <PageHeader title={t('payroll.act.run_payroll')} back="#/payroll" />
        <PageBody>
          <Empty icon={CalendarClock} title={t('payroll.empty.no_schedules')} action={can(me, 'payroll', 'edit') ? <Button variant="primary" icon={Plus} onClick={() => navigate('/payroll/schedules')}>{t('payroll.act.add_schedule')}</Button> : undefined} />
        </PageBody>
      </>
    );
  const period = periodWords(n.period_start, n.period_end);
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ payrun: RunSummary }>('payruns.create', { schedule: n.schedule });
      navigate('/payroll/runs/' + r.payrun.id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const people = n.people ?? 0;
  const others = d.next.filter((x) => x.schedule !== n.schedule);
  return (
    <>
      <PageHeader title={t('payroll.start.title', { period: period })} meta={n.entity_name + ' · ' + n.name} back="#/payroll">
        {can(me, 'payroll', 'edit') &&
          (n.run !== null ? (
            <Button variant="primary" icon={Play} onClick={() => navigate('/payroll/runs/' + (n.run?.id ?? ''))}>
              {t('payroll.act.continue_period', { period: period })}
            </Button>
          ) : (
            <Button variant="primary" icon={Play} busy={busy} disabled={people === 0} onClick={() => void start()}>
              {t('payroll.act.start_run')}
            </Button>
          ))}
      </PageHeader>
      <PageBody>
        <div className="hr-in mx-auto flex max-w-[760px] flex-col gap-3">
          <Panel index="01" label={t('payroll.start.includes')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label={t('payroll.col.period')}>{periodLabel(n.period_start, n.period_end)}</Fact>
              <Fact label={t('payroll.pay_day')}>{fmtDay(n.pay_date, { year: 'always' })}</Fact>
              <Fact label={t('payroll.start.cutoff')}>{fmtDay(n.cutoff_day, { year: 'always' })}</Fact>
              <Fact label={t('payroll.col.people')}>{people}</Fact>
            </div>
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-[13px] text-[var(--hr-ink-2)]">
              <li>{tn('payroll.start.pay_of', people)}</li>
              <li>{tn('payroll.start.inputs', n.open_inputs ?? 0)}</li>
              <li>{t('payroll.start.modules', { day: fmtDay(n.cutoff_day) })}</li>
              <li>{t('payroll.start.safe')}</li>
            </ul>
            {n.pay_date_moved && <Notice className="mt-3">{t('payroll.start.moved', { day: fmtDay(n.planned_pay_date), why: n.moved_because })}</Notice>}
            {n.run !== null && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--hr-muted)]">
                <RunStatus status={n.run.status} />
                <span>{t('payroll.start.has_run', { number: n.run.number })}</span>
              </div>
            )}
            {people === 0 && <Notice tone="warn" className="mt-3">{t('payroll.start.nobody')}</Notice>}
          </Panel>
          {others.length > 0 && (
            <Panel index="02" label={t('payroll.start.other_schedules')} flush>
              <div className="divide-y divide-[var(--hr-hair)]">
                {others.map((o) => (
                  <a key={o.schedule} href={'#/payroll/run?schedule=' + o.schedule} className="group grid min-h-10 cursor-pointer grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-[var(--hr-hover)] sm:grid-cols-[minmax(0,1fr)_120px_120px_14px]">
                    <span className="min-w-0 truncate text-[13px]">{o.entity_name + ' · ' + o.name + ' · ' + periodWords(o.period_start, o.period_end)}</span>
                    <span>{o.run ? <RunStatus status={o.run.status} /> : <StatusDot tone="faint" label={t('payroll.not_started')} />}</span>
                    <span className="hidden text-[12px] text-[var(--hr-muted)] sm:block">{t('payroll.pay_day_on', { day: fmtDay(o.pay_date) })}</span>
                    <RowCue />
                  </a>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </PageBody>
    </>
  );
}

const KINDS = ['off_cycle', 'bonus', 'termination', 'correction', 'reimbursement'] as const;
type NewKind = (typeof KINDS)[number];

/** /payroll/runs: every run, newest pay day first, and "New run" for the other kinds. */
export function RunsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const [status, setStatus] = useState<'open' | 'all'>('all');
  const live = useOp<{ payruns: RunSummary[]; total: number }>('payruns.list', { entity: entity === '' ? undefined : entity, status: status === 'open' ? 'open' : undefined, limit: 200 }, READS, { name: 'payroll.runs' });
  const correct = query.get('correct') ?? '';
  const [open, setOpen] = useState(correct !== '' || query.get('new') === '1');
  const cols: Column<RunSummary>[] = useMemo(
    () => [
      { key: 'label', label: t('payroll.col.run'), width: 'minmax(220px,2fr)', phone: 'title', sort: (r) => r.period_start + r.kind, render: (r) => (
          <span className="min-w-0">
            <span className="block truncate">{runTitle(r)}</span>
            <span className="hr-mono block text-[10.5px] text-[var(--hr-faint)]">{r.number + ' · ' + r.entity_name + (r.kind !== 'regular' ? ' · ' + kindLabel(r.kind) : '')}</span>
          </span>
        ) },
      { key: 'period', label: t('payroll.col.period'), width: 'minmax(160px,1.2fr)', hideBelow: 'lg', sort: (r) => r.period_start, render: (r) => periodLabel(r.period_start, r.period_end) },
      { key: 'pay', label: t('payroll.pay_day'), width: '120px', mono: true, sort: (r) => r.pay_date, render: (r) => fmtDay(r.pay_date, { year: 'always' }) },
      { key: 'people', label: t('payroll.col.people'), width: '80px', align: 'right', mono: true, hideBelow: 'lg', sort: (r) => r.employee_count, render: (r) => r.employee_count },
      { key: 'net', label: t('payroll.net'), width: '140px', align: 'right', mono: true, sort: (r) => r.net_minor, phone: 'end', render: (r) => <Money minor={r.net_minor} currency={r.currency} /> },
      { key: 'status', label: t('payroll.col.status'), width: '130px', sort: (r) => r.status, render: (r) => (<span className="flex items-center gap-2"><RunStatus status={r.status} />{r.blockers > 0 && <CircleAlert size={13} className="text-[var(--hr-bad)]" />}</span>) },
    ],
    [],
  );
  const rows = live.data?.payruns ?? null;
  return (
    <>
      <PageHeader title={t('payroll.runs')} meta={live.data ? tn('payroll.n_runs', live.data.total) : ''}>
        <Segmented value={status} onChange={setStatus} label={t('payroll.show')} size="sm" options={[{ value: 'all', label: t('payroll.show_all') }, { value: 'open', label: t('payroll.show_open') }]} />
        {can(me, 'payroll', 'edit') && (
          <>
            <Button variant="ghost" icon={Plus} onClick={() => setOpen(true)}>
              {t('payroll.act.new_run')}
            </Button>
            <Button variant="primary" icon={Play} onClick={() => navigate('/payroll/run')}>
              {t('payroll.act.run_payroll')}
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          {rows === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} rowHref={(r) => '#/payroll/runs/' + r.id} label={t('payroll.runs')} empty={<Empty icon={Banknote} title={t('payroll.empty.no_runs')} />} />
          )}
        </div>
      </PageBody>
      <NewRunDialog open={open} onClose={() => setOpen(false)} corrects={correct} />
    </>
  );
}

interface DirRow {
  employment: string;
  employee: string;
  number: string;
  name: string;
  entity: string;
  entity_name: string;
}

function NewRunDialog({ open, onClose, corrects }: { open: boolean; onClose: () => void; corrects: string }): React.JSX.Element {
  const me = useMe();
  const { entity: uiEntity } = useUi();
  const [kind, setKind] = useState<NewKind>(corrects !== '' ? 'correction' : 'off_cycle');
  const [entity, setEntity] = useState(uiEntity !== '' ? uiEntity : me.entities[0]?.id ?? '');
  const [people, setPeople] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [payDate, setPayDate] = useState(me.today);
  const [paid, setPaid] = useState(corrects);
  const [busy, setBusy] = useState(false);
  const dir = useOp<{ people: DirRow[] }>('people.directory', { entity: entity === '' ? undefined : entity, status: kind === 'termination' ? 'all' : 'current', limit: 500 }, ['employments', 'employees'], { skip: !open });
  const runs = useOp<{ payruns: RunSummary[] }>('payruns.list', { status: 'paid', entity: entity === '' ? undefined : entity, limit: 100 }, READS, { skip: !open || kind !== 'correction' });
  useEffect(() => {
    if (corrects !== '') setKind('correction');
  }, [corrects]);
  const items = (dir.data?.people ?? []).filter((r) => people.indexOf(r.employment) < 0).map((r) => ({ value: r.employment, label: r.name, sub: r.number }));
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const params: Record<string, unknown> = { kind, entity, pay_date: payDate };
      if (kind === 'termination') params['employment'] = people[0];
      else if (kind !== 'reimbursement') params['employments'] = people;
      if (kind === 'correction') params['corrects'] = paid;
      const r = await op<{ payrun: RunSummary }>('payruns.create', params);
      toast.success(t('payroll.toast.run_started', { number: r.payrun.number }));
      onClose();
      navigate('/payroll/runs/' + r.payrun.id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const ready = entity !== '' && (kind === 'reimbursement' || people.length > 0) && (kind !== 'correction' || paid !== '') && (kind !== 'termination' || people.length === 1);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('payroll.new_run.title')}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ready} onClick={() => void create()}>
            {t('payroll.act.start_run')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented value={kind} onChange={(v) => { setKind(v); setPeople([]); }} label={t('payroll.col.kind')} size="sm" options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
        <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.new_run.' + kind)}</div>
        {me.entities.length > 1 && (
          <Field label={t('payroll.entity')}>
            <Picker value={entity} onChange={(v) => { setEntity(v); setPeople([]); }} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country }))} label={t('payroll.entity')} />
          </Field>
        )}
        {kind === 'correction' && (
          <Field label={t('payroll.new_run.corrects')}>
            <Picker value={paid} onChange={setPaid} items={(runs.data?.payruns ?? []).map((r) => ({ value: r.id, label: runTitle(r), sub: r.number + ' · ' + fmtDay(r.pay_date, { year: 'always' }) }))} label={t('payroll.new_run.corrects')} />
          </Field>
        )}
        {kind !== 'reimbursement' && (
          <Field label={kind === 'termination' ? t('payroll.new_run.leaver') : t('payroll.new_run.people')}>
            <div className="flex flex-col gap-2">
              {(kind !== 'termination' || people.length === 0) && (
                <Picker
                  value={pick}
                  onChange={(v) => {
                    if (v !== '') setPeople((p) => (kind === 'termination' ? [v] : p.concat([v])));
                    setPick('');
                  }}
                  items={items}
                  label={t('payroll.new_run.people')}
                  placeholder={t('payroll.new_run.add_person')}
                />
              )}
              <div className="flex flex-wrap gap-1.5">
                {people.map((id) => {
                  const r = (dir.data?.people ?? []).find((x) => x.employment === id);
                  return (
                    <button key={id} type="button" className="inline-flex min-h-10 cursor-pointer items-center sm:min-h-0" onClick={() => setPeople((p) => p.filter((x) => x !== id))} title={t('ui.remove')}>
                      <Tag>{r ? r.name : id} ×</Tag>
                    </button>
                  );
                })}
              </div>
            </div>
          </Field>
        )}
        {kind !== 'termination' && (
          <Field label={t('payroll.pay_day')}>
            <DayPicker value={payDate} onChange={setPayDate} label={t('payroll.pay_day')} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

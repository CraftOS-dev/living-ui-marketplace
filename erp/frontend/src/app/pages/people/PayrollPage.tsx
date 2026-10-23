/**
 * Payroll. For payroll staff: pay runs by month with what each cost, the
 * cost trend, a new pay run, and the pay components (earnings, deductions,
 * employer contributions). For everyone: their own payslips.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Coins, FileText, Plus, Trash2, Users, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { Bars } from '../../components/charts.tsx';
import { Segmented, Tabs } from '../../components/controls.tsx';
import { RUN_STATE } from '../../components/people/common.tsx';
import { AccountPicker, DateField, EmployeePicker, MoneyInput, NumberInput } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { DataTable } from '../../components/table.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, LoadError, Modal, Notice, PageHeader, PillButton, Skeleton, StatusPill, ToggleRow, softArea, softInput, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { minorToText, money, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { ComponentKind, Components, MyPayslips, PayComponent, Run, RunList, RunDetail } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'runs' | 'components' | 'mine';
const KIND_LABEL: Record<ComponentKind, string> = { earning: 'Earnings', deduction: 'Deductions', employer: 'Paid by the company' };

/* ------------------------------------------------------------ new run */

function NewRunModal({ runs, onClose }: { runs: Run[]; onClose: () => void }): React.JSX.Element {
  const taken = new Set(runs.map((r) => r.month));
  const first = useMemo(() => {
    let m = today().slice(0, 7);
    for (let i = 0; i < 24 && taken.has(m); i++) m = addMonths(m, 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [month, setMonth] = useState(first);
  const [payDate, setPayDate] = useState('');
  const [who, setWho] = useState<'all' | 'some'>('all');
  const [people, setPeople] = useState<Option[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exists = taken.has(month);
  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<RunDetail>('payroll.run-create', { month, pay_date: payDate === '' ? undefined : payDate, employees: who === 'some' ? people.map((p) => p.id) : undefined, note: note.trim() === '' ? undefined : note.trim() }, { quiet: true });
      toast.success(`Drafted ${plural(r.count, 'payslip')}`);
      onClose();
      navigate('payrun', { id: r.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New pay run"
      description="Payslips are drafted from each person's basic pay and pay components. You can adjust them before approving."
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Coins} dot loading={busy} disabled={exists || (who === 'some' && people.length === 0)} onClick={() => void create()}>
            Draft the payslips
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Month" error={exists ? `There is already a pay run for ${monthLabel(month)}.` : null}>
          <div className="flex h-11 items-center justify-between rounded-full bg-[var(--erp-row)] p-1">
            <CircleButton icon={ChevronLeft} label="Previous month" variant="light" size={36} onClick={() => setMonth(addMonths(month, -1))} />
            <span className="text-[14px] font-bold">{monthLabel(month)}</span>
            <CircleButton icon={ChevronRight} label="Next month" variant="light" size={36} onClick={() => setMonth(addMonths(month, 1))} />
          </div>
        </Field>
        <Field label="Pay date" hint="The day salaries are paid and posted">
          <DateField value={payDate} onChange={setPayDate} ariaLabel="Pay date" optional placeholder="Last day of the month" />
        </Field>
        <Field label="Who">
          <Segmented
            ariaLabel="Who"
            value={who}
            onChange={setWho}
            options={[
              { value: 'all', label: 'Everyone with pay' },
              { value: 'some', label: 'Only some people' },
            ]}
          />
        </Field>
        {who === 'some' && (
          <div className="flex flex-col gap-2">
            <EmployeePicker value={null} onChange={(o) => o !== null && !people.some((p) => p.id === o.id) && setPeople([...people, o])} placeholder="Add a person" />
            {people.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <li key={p.id} className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--erp-card)] pl-3 pr-1 text-[13px] font-semibold">
                    {p.label}
                    <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setPeople(people.filter((x) => x.id !== p.id))} className="flex size-6 items-center justify-center rounded-full hover:bg-[var(--erp-row)]">
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Field label="Note" optional>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" className={cn(softArea, 'min-h-[56px]')} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- runs */

function RunsTab({ onNew }: { onNew: () => void }): React.JSX.Element {
  const me = useMe();
  const live = useLive(() => op<RunList>('payroll.runs', { limit: 120 }, { quiet: true }), ['payroll_runs', 'payslips'], []);
  const d = live.data;
  const cur = d?.currency ?? baseCurrency(me);
  const series = useMemo(() => [...(d?.runs ?? [])].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-12), [d]);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const change = last !== undefined && prev !== undefined && prev.cost > 0 ? (last.cost - prev.cost) / prev.cost : null;
  if (live.error !== null && d === null) return <LoadError message={live.error} onRetry={live.reload} />;
  return (
    <div className="flex flex-col gap-5">
      {d !== null && d.runs.length > 0 && (
        <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
          <Card tone="dark" className="@min-[900px]:col-span-4">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Payroll cost, {last !== undefined ? monthLabel(last.month, true) : ''}</p>
                <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(last?.cost ?? 0, cur)}</p>
                {change !== null && (
                  <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
                    {change >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(change * 1000) / 10)}% on {monthLabel(prev?.month ?? '', true)}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Net pay</p>
                  <p className="num truncate text-[15px] font-bold">{money(last?.net ?? 0, cur, 'short')}</p>
                </div>
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Gross pay</p>
                  <p className="num truncate text-[15px] font-bold">{money(last?.gross ?? 0, cur, 'short')}</p>
                </div>
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Employer on top</p>
                  <p className="num truncate text-[15px] font-bold">{money(last?.employer ?? 0, cur, 'short')}</p>
                </div>
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <p className="text-[12px] text-[var(--erp-on-dark-muted)]">People paid</p>
                  <p className="num text-[15px] font-bold">{last?.count ?? 0}</p>
                </div>
              </div>
            </div>
          </Card>
          <Card className="@min-[900px]:col-span-8" delay={1}>
            <CardHeader title="Cost per month" subtitle="Gross pay and employer contributions" />
            <CostBars runs={series} currency={cur} />
          </Card>
        </div>
      )}
      <Card delay={2}>
        <CardHeader title="Pay runs" subtitle={d !== null ? plural(d.total, 'run') : undefined} />
        <DataTable
          ariaLabel="Pay runs"
          rows={d?.runs ?? []}
          loading={d === null}
          rowKey={(r) => r.id}
          onOpen={(r) => navigate('payrun', { id: r.id })}
          empty={
            <Empty
              icon={CalendarClock}
              title="No pay runs yet"
              action={
                d?.can.create === true ? (
                  <PillButton icon={Plus} dot onClick={onNew}>
                    New pay run
                  </PillButton>
                ) : undefined
              }
            >
              A pay run drafts everyone's payslips for a month from their pay.
            </Empty>
          }
          columns={[
            { key: 'm', label: 'Month', width: 'minmax(0, 1.4fr)', render: (r) => <span className="font-semibold">{r.month_name}</span>, sort: (r) => r.month },
            { key: 'n', label: 'Run', width: '96px', hide: 'md', render: (r) => <span className="num text-[var(--erp-ink-2)]">{r.number}</span> },
            {
              key: 's',
              label: 'Status',
              width: '110px',
              render: (r) => (
                <StatusPill tone={RUN_STATE[r.status].tone} size="sm">
                  {RUN_STATE[r.status].label}
                </StatusPill>
              ),
            },
            { key: 'c', label: 'People', width: '80px', align: 'right', hide: 'md', render: (r) => r.count },
            { key: 'g', label: 'Gross', width: '130px', align: 'right', hide: 'lg', render: (r) => money(r.gross, cur) },
            { key: 'net', label: 'Net pay', width: '130px', align: 'right', render: (r) => <span className="font-bold">{money(r.net, cur)}</span> },
            { key: 'cost', label: 'Cost', width: '130px', align: 'right', hide: 'sm', render: (r) => money(r.cost, cur) },
          ]}
          mobile={(r) => ({ title: r.month_name, sub: `${RUN_STATE[r.status].label} · ${plural(r.count, 'person', 'people')}`, right: money(r.net, cur), rightSub: 'net pay' })}
        />
      </Card>
    </div>
  );
}

function CostBars({ runs, currency }: { runs: Run[]; currency: string }): React.JSX.Element {
  return (
    <div>
      <Bars
        height={150}
        format={(n) => money(n, currency, 'short')}
        onPick={(key) => navigate('payrun', { id: key })}
        points={runs.map((r, i) => ({ key: r.id, label: r.month_name, axis: monthLabel(r.month, true).slice(0, 3), value: r.cost, text: money(r.cost, currency), current: i === runs.length - 1 }))}
      />
    </div>
  );
}

/* ---------------------------------------------------------- components */

function ComponentModal({ c, kind: startKind, currency, onClose }: { c: PayComponent | null; kind: ComponentKind; currency: string; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(c?.name ?? '');
  const [kind, setKind] = useState<ComponentKind>(c?.kind ?? startKind);
  const [calc, setCalc] = useState<'fixed' | 'percent'>(c?.calc ?? 'fixed');
  const [amount, setAmount] = useState(c !== null && c.amount !== 0 ? minorToText(c.amount, currency) : '');
  const [percent, setPercent] = useState(c !== null && c.percent_bp !== 0 ? c.percent : '');
  const [account, setAccount] = useState<Option | null>(c !== null && c.account !== null ? { id: c.account.id, label: `${c.account.code} ${c.account.name}`, value: c.account.id } : null);
  const [liability, setLiability] = useState<Option | null>(c !== null && c.liability_account !== null ? { id: c.liability_account.id, label: `${c.liability_account.code} ${c.liability_account.name}`, value: c.liability_account.id } : null);
  const [applies, setApplies] = useState<'all' | 'selected'>(c?.applies ?? 'all');
  const [active, setActive] = useState(c?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const p = {
      name: name.trim(),
      kind,
      calc,
      amount: calc === 'fixed' ? (amount === '' ? '0' : amount) : undefined,
      percent: calc === 'percent' ? (percent === '' ? '0' : percent) : undefined,
      account: account?.id ?? undefined,
      liability_account: kind === 'employer' ? (liability?.id ?? undefined) : undefined,
      applies,
      active,
    };
    try {
      if (c === null) await op('payroll.component-add', p, { quiet: true });
      else await op('payroll.component-update', { component: c.id, ...p }, { quiet: true });
      toast.success('Saved');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (c === null) return;
    if (!(await confirm(`${c.name} is deleted. Pay runs already posted keep what they computed.`, 'Delete this component?'))) return;
    try {
      await op('payroll.component-delete', { component: c.id });
      toast.success('Deleted');
      onClose();
    } catch {
      /* shown */
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={c === null ? 'New pay component' : `Edit ${c.name}`}
      size="lg"
      footer={
        <>
          {c !== null && (
            <PillButton variant="ghost" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              Delete
            </PillButton>
          )}
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="e.g. Transport allowance" autoFocus={c === null} className={softInput} />
        </Field>
        <Field label="What it is">
          <Segmented
            ariaLabel="What it is"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'earning', label: 'Earning' },
              { value: 'deduction', label: 'Deduction' },
              { value: 'employer', label: 'Company pays' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
          <Field label="Amount">
            <Segmented
              ariaLabel="Amount"
              value={calc}
              onChange={setCalc}
              options={[
                { value: 'fixed', label: 'Fixed' },
                { value: 'percent', label: '% of basic' },
              ]}
            />
          </Field>
          {calc === 'fixed' ? (
            <Field label={`Each month (${currency})`}>
              <MoneyInput value={amount} onChange={setAmount} currency={currency} ariaLabel="Amount each month" />
            </Field>
          ) : (
            <Field label="Percent of basic pay">
              <NumberInput value={percent} onChange={setPercent} ariaLabel="Percent of basic pay" decimals={2} suffix="%" />
            </Field>
          )}
        </div>
        <Field label="For">
          <Segmented
            ariaLabel="For"
            value={applies}
            onChange={setApplies}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'selected', label: 'People it is given to' },
            ]}
          />
        </Field>
        <Field label="Posts to" optional hint={kind === 'earning' ? 'Default: salaries' : kind === 'deduction' ? 'Default: payroll deductions payable' : 'Default: employer contributions'}>
          <AccountPicker value={account} onChange={setAccount} clearable placeholder="The default account" />
        </Field>
        {kind === 'employer' && (
          <Field label="Owed to" optional hint="The liability it is owed to (default: payroll deductions payable)">
            <AccountPicker value={liability} onChange={setLiability} types={['liability']} clearable placeholder="The default account" />
          </Field>
        )}
        <ToggleRow title="In use" text="Off: left out of new pay runs" checked={active} onChange={setActive} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
      {confirmEl}
    </Modal>
  );
}

function ComponentsTab(): React.JSX.Element {
  const me = useMe();
  const live = useLive(() => op<Components>('payroll.components', {}, { quiet: true }), ['pay_components', 'employee_components'], []);
  const [editing, setEditing] = useState<PayComponent | ComponentKind | null>(null);
  const d = live.data;
  const cur = d?.currency ?? baseCurrency(me);
  if (live.error !== null && d === null) return <LoadError message={live.error} onRetry={live.reload} />;
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-3 @min-[900px]:items-start">
      {(['earning', 'deduction', 'employer'] as ComponentKind[]).map((k, i) => {
        const rows = (d?.components ?? []).filter((c) => c.kind === k);
        return (
          <Card key={k} delay={i + 1}>
            <CardHeader
              title={KIND_LABEL[k]}
              subtitle={k === 'employer' ? 'A cost on top of gross pay' : k === 'deduction' ? 'Taken from gross pay' : 'Added to basic pay'}
              action={d?.can.edit === true ? <CircleButton icon={Plus} label={`New ${KIND_LABEL[k].toLowerCase()} component`} variant="row" size={36} onClick={() => setEditing(k)} /> : undefined}
            />
            {d === null ? (
              <Skeleton className="h-14" />
            ) : rows.length === 0 ? (
              <p className="text-[13px] text-[var(--erp-muted)]">None.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={d.can.edit !== true}
                      onClick={() => setEditing(c)}
                      className={cn('flex w-full items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5 text-left disabled:cursor-default', d.can.edit && 'hover:bg-[var(--erp-row-hover)]', !c.active && 'text-[var(--erp-muted)]')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{c.name}</span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                          {c.applies === 'all' ? 'Everyone' : plural(c.assigned, 'person', 'people')}
                          {c.account !== null ? ` · ${c.account.code} ${c.account.name}` : ''}
                        </span>
                      </span>
                      <span className="num shrink-0 text-[14px] font-bold">{c.calc === 'percent' ? `${c.percent}%` : money(c.amount, cur)}</span>
                      {!c.active && (
                        <StatusPill tone="neutral" size="sm">
                          Off
                        </StatusPill>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {editing !== null && <ComponentModal c={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} currency={cur} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------- payslips */

function MyPayslipsTab(): React.JSX.Element {
  const live = useLive(() => op<MyPayslips>('payroll.my-payslips', { limit: 36 }, { quiet: true }), ['payroll_runs', 'payslips'], []);
  const d = live.data;
  if (live.error !== null && d === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (d === null) return <Skeleton className="h-48" rounded="rounded-[24px]" />;
  const cur = d.currency;
  const latest = d.payslips[0];
  const series = [...d.payslips].reverse().slice(-12);
  if (latest === undefined) {
    return (
      <Card>
        <Empty icon={Wallet} title="No payslips yet">
          Your payslip shows here once the month's pay run is posted.
        </Empty>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card tone="dark" className="@min-[900px]:col-span-5">
        <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Latest pay, {latest.run.month_name}</p>
        <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(latest.net, cur)}</p>
        <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">{latest.run.status === 'paid' ? `Paid ${dayLabel(latest.run.paid_on !== '' ? latest.run.paid_on : latest.run.pay_date)}` : `Paid on ${dayLabel(latest.run.pay_date)}`}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
            <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Gross</p>
            <p className="num truncate text-[15px] font-bold">{money(latest.gross, cur)}</p>
          </div>
          <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
            <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Deductions</p>
            <p className="num truncate text-[15px] font-bold">{money(latest.deductions, cur)}</p>
          </div>
        </div>
        <PillButton variant="accent" icon={FileText} className="mt-5" onClick={() => navigate('payslip', { id: latest.id })}>
          Open payslip
        </PillButton>
      </Card>
      <Card className="@min-[900px]:col-span-7" delay={2}>
        <CardHeader title="Your payslips" subtitle={plural(d.total, 'payslip')} />
        {series.length > 1 && (
          <div className="mb-5">
            <Bars height={120} format={(n) => money(n, cur, 'short')} onPick={(id) => navigate('payslip', { id })} points={series.map((s, i) => ({ key: s.id, label: s.run.month_name, axis: monthLabel(s.run.month, true).slice(0, 3), value: s.net, text: money(s.net, cur), current: i === series.length - 1 }))} />
          </div>
        )}
        <DataTable
          ariaLabel="Your payslips"
          rows={d.payslips}
          rowKey={(s) => s.id}
          onOpen={(s) => navigate('payslip', { id: s.id })}
          columns={[
            { key: 'm', label: 'Month', render: (s) => <span className="font-semibold">{s.run.month_name}</span> },
            { key: 'g', label: 'Gross', align: 'right', hide: 'sm', render: (s) => money(s.gross, cur) },
            { key: 'd', label: 'Deductions', align: 'right', hide: 'md', render: (s) => money(s.deductions, cur) },
            { key: 'n', label: 'Net pay', align: 'right', render: (s) => <span className="font-bold">{money(s.net, cur)}</span> },
          ]}
          mobile={(s) => ({ title: s.run.month_name, sub: RUN_STATE[s.run.status].label, right: money(s.net, cur), rightSub: 'net pay' })}
        />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export function PayrollPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const staff = can(me, 'payroll');
  const self = me.employee !== null;
  const runs = useLive(() => (staff ? op<RunList>('payroll.runs', { limit: 120 }, { quiet: true }) : Promise.resolve(null)), ['payroll_runs'], [staff]);
  const [creating, setCreating] = useState(false);
  const tabs: { value: Tab; label: string; icon: typeof Users }[] = [];
  if (staff) tabs.push({ value: 'runs', label: 'Pay runs', icon: CalendarClock }, { value: 'components', label: 'Pay components', icon: Coins });
  if (self) tabs.push({ value: 'mine', label: staff ? 'My payslips' : 'Payslips', icon: Wallet });
  const asked = query.get('tab') as Tab | null;
  const tab: Tab = asked !== null && tabs.some((t) => t.value === asked) ? asked : (tabs[0]?.value ?? 'mine');
  useEffect(() => {
    if (query.get('new') !== null && runs.data?.can.create === true) setCreating(true);
  }, [query, runs.data]);

  return (
    <div>
      <PageHeader
        title={staff ? 'Payroll' : 'Payslips'}
        actions={
          runs.data?.can.create === true ? (
            <PillButton icon={Plus} dot onClick={() => setCreating(true)}>
              New pay run
            </PillButton>
          ) : undefined
        }
      />
      {tabs.length > 1 && <Tabs ariaLabel="Payroll" value={tab} onChange={(t) => replaceQuery('payroll', { tab: t === tabs[0]?.value ? undefined : t })} tabs={tabs} />}
      {tab === 'runs' && <RunsTab onNew={() => setCreating(true)} />}
      {tab === 'components' && <ComponentsTab />}
      {tab === 'mine' && (self ? <MyPayslipsTab /> : <Card><Empty icon={Wallet} title="No payslips">Your account has no employee record.</Empty></Card>)}
      {creating && runs.data !== null && <NewRunModal runs={runs.data.runs} onClose={() => setCreating(false)} />}
    </div>
  );
}


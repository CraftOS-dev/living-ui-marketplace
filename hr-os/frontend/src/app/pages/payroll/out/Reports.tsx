/**
 * Payroll reports from locked runs: the register, cost by department, cost
 * centre or entity in the reporting currency, what is owed to each
 * authority, year to date per person, and headcount with average pay.
 * Dense tables with CSV export and one quiet chart where it helps.
 */
import { useMemo, useState } from 'react';
import { ChartColumn, Download } from 'lucide-react';
import { Button, DataTable, DateRange, Empty, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Segmented, Tabs, Money } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { Bars, EntityChooser, csvOf, majorText, rangeWithYear, useEntity } from '../../../components/payroll-out/parts.tsx';
import { saveText } from '../../../lib/api.ts';
import { useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, monthName } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { setQuery } from '../../../lib/router.ts';
import { useUi } from '../../../lib/store.tsx';

type Tab = 'register' | 'cost' | 'remittance' | 'ytd' | 'headcount';
const READS = ['payslips', 'payruns', 'payslip_lines', 'fx_rates'];

interface RegisterRow {
  payslip: string;
  run: string;
  pay_date: string;
  employee_number: string;
  name: string;
  entity_name: string;
  department: string;
  cost_center: string;
  currency: string;
  gross_minor: number;
  pre_minor: number;
  statutory_minor: number;
  post_minor: number;
  employer_minor: number;
  reimbursement_minor: number;
  net_minor: number;
}

function monthLabel(m: string): string {
  return monthName(Number(m.slice(5, 7)), 'short') + ' ' + m.slice(2, 4);
}

function Register({ from, to, entity }: { from: string; to: string; entity: string }): React.JSX.Element {
  const live = useOp<{ rows: RegisterRow[]; totals: (Omit<RegisterRow, 'payslip' | 'run' | 'pay_date' | 'employee_number' | 'name' | 'entity_name' | 'department' | 'cost_center'> & { people: number })[] }>('payreports.register', { from, to, entity: entity === '' ? undefined : entity, limit: 5000 }, READS, { name: 'payreports.register' });
  const d = live.data;
  const columns: Column<RegisterRow>[] = useMemo(
    () => [
      { key: 'person', label: t('po.col.person'), width: 'minmax(170px,1.6fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.employee_number} · {r.run}</span></span> },
      { key: 'date', label: t('po.col.pay_date'), width: '104px', mono: true, hideBelow: 'lg', sort: (r) => r.pay_date, render: (r) => fmtDay(r.pay_date) },
      { key: 'dept', label: t('po.col.department'), width: 'minmax(110px,1fr)', hideBelow: 'xl', sort: (r) => r.department, render: (r) => r.department },
      { key: 'gross', label: t('po.col.gross'), width: '148px', align: 'right', mono: true, phone: 'hide', sort: (r) => r.gross_minor, render: (r) => <Money minor={r.gross_minor} currency={r.currency} /> },
      { key: 'ded', label: t('po.col.deductions'), width: '148px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', sort: (r) => r.pre_minor + r.statutory_minor + r.post_minor, render: (r) => <Money minor={r.pre_minor + r.statutory_minor + r.post_minor} currency={r.currency} /> },
      { key: 'er', label: t('po.col.employer'), width: '148px', align: 'right', mono: true, hideBelow: 'xl', phone: 'hide', sort: (r) => r.employer_minor, render: (r) => <Money minor={r.employer_minor} currency={r.currency} /> },
      { key: 'net', label: t('po.col.net'), width: '148px', align: 'right', mono: true, phone: 'end', sort: (r) => r.net_minor, render: (r) => <Money minor={r.net_minor} currency={r.currency} /> },
    ],
    [],
  );
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const csv = (): void =>
    saveText(
      csvOf(([['run', 'pay_date', 'employee_number', 'name', 'entity', 'department', 'cost_center', 'currency', 'gross', 'pre_tax', 'statutory', 'post_tax', 'employer', 'reimbursements', 'net']] as (string | number)[][]).concat(d.rows.map((r) => [r.run, r.pay_date, r.employee_number, r.name, r.entity_name, r.department, r.cost_center, r.currency, majorText(r.gross_minor, r.currency), majorText(r.pre_minor, r.currency), majorText(r.statutory_minor, r.currency), majorText(r.post_minor, r.currency), majorText(r.employer_minor, r.currency), majorText(r.reimbursement_minor, r.currency), majorText(r.net_minor, r.currency)]))),
      'payroll-register-' + from + '-' + to + '.csv',
    );
  return (
    <Panel
      flush
      label={tn('po.reports.slips', d.rows.length)}
      aside={
        <Button size="sm" variant="ghost" icon={Download} disabled={d.rows.length === 0} onClick={csv}>
          {t('po.csv')}
        </Button>
      }
    >
      <DataTable
        label={t('po.reports.register')}
        columns={columns}
        rows={d.rows}
        rowKey={(r) => r.payslip}
        empty={<Empty icon={ChartColumn} title={t('po.reports.empty')}>{t('po.reports.empty_text')}</Empty>}
        foot={d.totals.length > 0 ? <span className="flex flex-col gap-0.5 px-3 text-[12px]">{d.totals.map((x) => <span key={x.currency} className="flex justify-between gap-4"><span>{tn('po.n_slips', x.people)}</span><span className="flex gap-6"><Money minor={x.gross_minor} currency={x.currency} /><Money minor={x.net_minor} currency={x.currency} /></span></span>)}</span> : undefined}
      />
    </Panel>
  );
}

interface CostGroup {
  key: string;
  label: string;
  people: number;
  gross_minor: number;
  employer_minor: number;
  reimbursement_minor: number;
  cost_minor: number;
}

function Cost({ from, to, entity }: { from: string; to: string; entity: string }): React.JSX.Element {
  const [group, setGroup] = useState<'department' | 'cost_center' | 'entity'>('department');
  const live = useOp<{ currency: string; groups: CostGroup[]; total_minor: number; months: { month: string; cost_minor: number }[]; missing_fx: string[] }>('payreports.cost', { from, to, group, entity: entity === '' ? undefined : entity }, READS, { name: 'payreports.cost' });
  const d = live.data;
  const columns: Column<CostGroup>[] = [
    { key: 'label', label: t('po.col.' + group), width: 'minmax(180px,2fr)', phone: 'title', sort: (r) => r.label, render: (r) => r.label },
    { key: 'people', label: t('po.col.people'), width: '90px', align: 'right', mono: true, sort: (r) => r.people, render: (r) => tn('po.n_people', r.people) },
    { key: 'gross', label: t('po.col.gross'), width: '148px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', sort: (r) => r.gross_minor, render: (r) => <Money minor={r.gross_minor} currency={d?.currency ?? ''} /> },
    { key: 'er', label: t('po.col.employer'), width: '148px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', sort: (r) => r.employer_minor, render: (r) => <Money minor={r.employer_minor} currency={d?.currency ?? ''} /> },
    { key: 'cost', label: t('po.col.cost'), width: '148px', align: 'right', mono: true, phone: 'end', sort: (r) => r.cost_minor, render: (r) => <Money minor={r.cost_minor} currency={d?.currency ?? ''} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        value={group}
        onChange={setGroup}
        label={t('po.reports.group')}
        size="sm"
        className="self-start"
        options={[
          { value: 'department', label: t('po.col.department') },
          { value: 'cost_center', label: t('po.col.cost_center') },
          { value: 'entity', label: t('po.col.entity') },
        ]}
      />
      {d === null ? (
        live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
      ) : (
        <>
          {d.missing_fx.length > 0 && <Notice tone="warn">{t('po.reports.missing_fx', { list: d.missing_fx.join(', ') })}</Notice>}
          {d.months.length > 1 && (
            <Panel label={t('po.reports.cost_by_month', { currency: d.currency })}>
              <Bars data={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.cost_minor }))} currency={d.currency} label={t('po.reports.cost_by_month', { currency: d.currency })} />
            </Panel>
          )}
          <Panel
            flush
            label={t('po.reports.total_cost')}
            aside={
              <Button size="sm" variant="ghost" icon={Download} disabled={d.groups.length === 0} onClick={() => saveText(csvOf(([[group, 'people', 'gross', 'employer', 'reimbursements', 'cost', 'currency']] as (string | number)[][]).concat(d.groups.map((g) => [g.label, g.people, majorText(g.gross_minor, d.currency), majorText(g.employer_minor, d.currency), majorText(g.reimbursement_minor, d.currency), majorText(g.cost_minor, d.currency), d.currency]))), 'payroll-cost-' + group + '.csv')}>
                {t('po.csv')}
              </Button>
            }
          >
            <DataTable label={t('po.reports.cost')} columns={columns} rows={d.groups} rowKey={(r) => r.key || r.label} empty={<Empty icon={ChartColumn} title={t('po.reports.empty')}>{t('po.reports.empty_text')}</Empty>} foot={d.groups.length > 0 ? <span className="flex justify-between px-3 text-[12px]"><span>{t('po.total')}</span><Money minor={d.total_minor} currency={d.currency} /></span> : undefined} />
          </Panel>
        </>
      )}
    </div>
  );
}

interface Payee {
  entity: string;
  entity_name: string;
  payee: string;
  currency: string;
  employee_minor: number;
  employer_minor: number;
  total_minor: number;
  filings: string[];
  codes: { code: string; name: string; kind: string; amount_minor: number }[];
  months: Record<string, number>;
}

function Remittance({ from, to, entity }: { from: string; to: string; entity: string }): React.JSX.Element {
  const live = useOp<{ months: string[]; payees: Payee[] }>('payreports.remittance', { from, to, entity: entity === '' ? undefined : entity }, READS, { name: 'payreports.remittance' });
  const d = live.data;
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const months = d.months.slice(-6);
  const columns: Column<Payee>[] = [
    { key: 'payee', label: t('po.col.payee'), width: 'minmax(180px,2fr)', phone: 'title', sort: (r) => r.payee, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="hr-wrap">{r.payee}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.entity_name}</span></span> },
    ...months.map((m, i): Column<Payee> => ({ key: m, label: monthLabel(m), width: '110px', align: 'right', mono: true, hideBelow: i < months.length - 2 ? 'xl' : undefined, phone: 'hide', render: (r) => (r.months[m] ? <Money minor={r.months[m] ?? 0} currency={r.currency} /> : '') })),
    { key: 'total', label: t('po.total'), width: '130px', align: 'right', mono: true, phone: 'end', sort: (r) => r.total_minor, render: (r) => <Money minor={r.total_minor} currency={r.currency} /> },
  ];
  return (
    <Panel
      flush
      label={t('po.reports.remittance')}
      aside={
        <Button size="sm" variant="ghost" icon={Download} disabled={d.payees.length === 0} onClick={() => saveText(csvOf(([['entity', 'payee', 'code', 'name', 'kind', 'amount', 'currency']] as (string | number)[][]).concat(d.payees.flatMap((p) => p.codes.map((c) => [p.entity_name, p.payee, c.code, c.name, c.kind, majorText(c.amount_minor, p.currency), p.currency])))), 'payroll-remittance.csv')}>
          {t('po.csv')}
        </Button>
      }
    >
      <DataTable label={t('po.reports.remittance')} columns={columns} rows={d.payees} rowKey={(r) => r.entity + r.payee + r.currency} empty={<Empty icon={ChartColumn} title={t('po.reports.empty')}>{t('po.reports.empty_text')}</Empty>} />
    </Panel>
  );
}

interface YtdRow {
  employment: string;
  employee_number: string;
  name: string;
  slips: number;
  gross_minor: number;
  pre_minor: number;
  statutory_minor: number;
  post_minor: number;
  employer_minor: number;
  net_minor: number;
  by_code: Record<string, number>;
}

function Ytd({ entity }: { entity: string }): React.JSX.Element {
  const ent = useEntity(entity);
  const [picked, setPicked] = useState('');
  const id = picked !== '' ? picked : ent?.id ?? '';
  const live = useOp<{ currency: string; label: string; codes: string[]; rows: YtdRow[] }>('payreports.ytd', { entity: id }, READS, { name: 'payreports.ytd', skip: id === '' });
  const d = live.data;
  const codes = d?.codes.slice(0, 4) ?? [];
  const columns: Column<YtdRow>[] = [
    { key: 'person', label: t('po.col.person'), width: 'minmax(170px,1.6fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.employee_number} · {tn('po.n_slips', r.slips)}</span></span> },
    { key: 'gross', label: t('po.col.gross'), width: '148px', align: 'right', mono: true, phone: 'hide', sort: (r) => r.gross_minor, render: (r) => <Money minor={r.gross_minor} currency={d?.currency ?? ''} /> },
    ...codes.map((c): Column<YtdRow> => ({ key: c, label: <span className="hr-mono">{c}</span>, width: '120px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', sort: (r) => r.by_code[c] ?? 0, render: (r) => <Money minor={r.by_code[c] ?? 0} currency={d?.currency ?? ''} /> })),
    { key: 'net', label: t('po.col.net'), width: '148px', align: 'right', mono: true, phone: 'end', sort: (r) => r.net_minor, render: (r) => <Money minor={r.net_minor} currency={d?.currency ?? ''} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <EntityChooser value={id} onChange={setPicked} />
      {d === null ? (
        live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
      ) : (
        <Panel
          flush
          label={t('po.reports.ytd_of', { year: d.label })}
          aside={
            <Button size="sm" variant="ghost" icon={Download} disabled={d.rows.length === 0} onClick={() => saveText(csvOf(([['employee_number', 'name', 'payslips', 'gross', 'pre_tax', 'statutory', 'post_tax', 'employer', 'net'].concat(d.codes)] as (string | number)[][]).concat(d.rows.map((r) => [r.employee_number, r.name, r.slips, majorText(r.gross_minor, d.currency), majorText(r.pre_minor, d.currency), majorText(r.statutory_minor, d.currency), majorText(r.post_minor, d.currency), majorText(r.employer_minor, d.currency), majorText(r.net_minor, d.currency)].concat(d.codes.map((c) => majorText(r.by_code[c] ?? 0, d.currency)))))), 'payroll-ytd-' + d.label + '.csv')}>
              {t('po.csv')}
            </Button>
          }
        >
          <DataTable label={t('po.reports.ytd')} columns={columns} rows={d.rows} rowKey={(r) => r.employment} empty={<Empty icon={ChartColumn} title={t('po.reports.empty')}>{t('po.reports.empty_text')}</Empty>} />
        </Panel>
      )}
    </div>
  );
}

function Headcount({ from, to, entity }: { from: string; to: string; entity: string }): React.JSX.Element {
  const live = useOp<{ currency: string; months: { month: string; people: number; gross_minor: number; net_minor: number; avg_gross_minor: number; avg_net_minor: number }[]; missing_fx: string[] }>('payreports.headcount', { from, to, entity: entity === '' ? undefined : entity }, READS, { name: 'payreports.headcount' });
  const d = live.data;
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  type M = (typeof d.months)[number];
  const columns: Column<M>[] = [
    { key: 'month', label: t('po.col.month'), width: 'minmax(120px,1fr)', phone: 'title', sort: (r) => r.month, render: (r) => monthLabel(r.month) },
    { key: 'people', label: t('po.col.people'), width: '90px', align: 'right', mono: true, render: (r) => tn('po.n_people', r.people) },
    { key: 'avg_gross', label: t('po.col.avg_gross'), width: '140px', align: 'right', mono: true, phone: 'end', render: (r) => <Money minor={r.avg_gross_minor} currency={d.currency} /> },
    { key: 'avg_net', label: t('po.col.avg_net'), width: '140px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', render: (r) => <Money minor={r.avg_net_minor} currency={d.currency} /> },
    { key: 'gross', label: t('po.col.gross'), width: '140px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', render: (r) => <Money minor={r.gross_minor} currency={d.currency} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      {d.missing_fx.length > 0 && <Notice tone="warn">{t('po.reports.missing_fx', { list: d.missing_fx.join(', ') })}</Notice>}
      {d.months.length > 1 && (
        <Panel label={t('po.reports.avg_gross_by_month', { currency: d.currency })}>
          <Bars data={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.avg_gross_minor }))} currency={d.currency} label={t('po.reports.avg_gross_by_month', { currency: d.currency })} />
        </Panel>
      )}
      <Panel flush label={t('po.reports.headcount')}>
        <DataTable label={t('po.reports.headcount')} columns={columns} rows={d.months} rowKey={(r) => r.month} empty={<Empty icon={ChartColumn} title={t('po.reports.empty')}>{t('po.reports.empty_text')}</Empty>} />
      </Panel>
    </div>
  );
}

export function ReportsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const tab = (query.get('tab') as Tab | null) ?? 'register';
  const yearStart = me.today.slice(0, 4) + '-01-01';
  const from = query.get('from') ?? yearStart;
  const to = query.get('to') ?? me.today;
  return (
    <>
      <PageHeader title={t('po.reports.title')} meta={rangeWithYear(from, to)}>
        {tab !== 'ytd' && <DateRange from={from} to={to} onChange={(f, tt) => setQuery({ from: f, to: tt })} label={t('po.reports.range')} />}
      </PageHeader>
      <PageBody>
        <Tabs
          className="mb-3"
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'register' ? undefined : v })}
          label={t('po.reports.title')}
          tabs={[
            { value: 'register', label: t('po.reports.register') },
            { value: 'cost', label: t('po.reports.cost') },
            { value: 'remittance', label: t('po.reports.remittance') },
            { value: 'ytd', label: t('po.reports.ytd') },
            { value: 'headcount', label: t('po.reports.headcount') },
          ]}
        />
        {tab === 'register' && <Register from={from} to={to} entity={entity} />}
        {tab === 'cost' && <Cost from={from} to={to} entity={entity} />}
        {tab === 'remittance' && <Remittance from={from} to={to} entity={entity} />}
        {tab === 'ytd' && <Ytd entity={entity} />}
        {tab === 'headcount' && <Headcount from={from} to={to} entity={entity} />}
      </PageBody>
    </>
  );
}

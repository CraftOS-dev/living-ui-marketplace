/**
 * The body of each report: a chart on top that answers the question at a
 * glance, then the statement (sections, subtotals, drill-down to accounts,
 * parties, documents and items). Each registers its rows as CSV for the
 * export when the server does not make one.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, shortDay } from '../../lib/dates.ts';
import { compact, decimalsOf, money, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import type { Collection } from '../../lib/live.ts';
import { segmentColor } from '../../lib/palette.ts';
import { navigate } from '../../lib/router.ts';
import type {
  AgingReport,
  BsAt,
  BsReport,
  BudgetReport,
  CashFlowReport,
  GlReport,
  PayRun,
  PnlReport,
  ProjectRow,
  SalesReport,
  StockReport,
  TaxReport,
  TbReport,
} from '../../lib/types/books.ts';
import { monthShort, rangeLabel } from '../books/period.ts';
import { Bars, PairBars, PairLegend, RankBars, SplitBar } from '../charts.tsx';
import { Segmented } from '../controls.tsx';
import { Donut } from '../Donut.tsx';
import { Pager } from '../table.tsx';
import { Card, CardHeader, Empty, Figure, LoadError, Skeleton } from '../ui.tsx';
import { Statement, statementCsv } from './Statement.tsx';
import type { SColumn, SRow } from './Statement.tsx';

export interface ReportParams {
  from: string;
  to: string;
  date: string;
  compare: string;
  by: string;
  side: 'receivable' | 'payable';
  year: number;
}

export interface KindProps {
  p: ReportParams;
  currency: string;
  printHead: ReactNode;
  onCsv: (fn: (() => string) | null) => void;
  setRange: (from: string, to: string) => void;
}

const BOOKS: Collection[] = [...READS.books, 'documents', 'payments'];

/** "Today" or "On Thu, Oct 15". */
export function asAt(day: string): string {
  const l = dayLabel(day);
  return l === 'Today' ? 'Today' : `On ${l}`;
}

function major(minor: number, cur: string): number {
  return minor / 10 ** decimalsOf(cur);
}

function monthEnd(m: string): string {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0);
  return `${m}-${String(d.getDate()).padStart(2, '0')}`;
}

function Loading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Skeleton className="h-64 @min-[900px]:col-span-8" rounded="rounded-[24px]" />
        <Skeleton className="h-64 @min-[900px]:col-span-4" rounded="rounded-[24px]" />
      </div>
      <Skeleton className="h-96" rounded="rounded-[24px]" />
    </div>
  );
}

function StatementCard({ title, subtitle, printHead, children, action }: { title: string; subtitle?: string | undefined; printHead: ReactNode; children: ReactNode; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <Card className="erp-print" delay={2}>
      {printHead}
      <div className="erp-no-print">
        <CardHeader title={title} subtitle={subtitle} action={action} />
      </div>
      {children}
    </Card>
  );
}

function useCsv(onCsv: KindProps['onCsv'], columns: SColumn[] | null, rows: SRow[] | null, currency: string): void {
  useEffect(() => {
    if (columns === null || rows === null) {
      onCsv(null);
      return;
    }
    onCsv(() => statementCsv(columns, rows, currency));
    return () => onCsv(null);
  }, [onCsv, columns, rows, currency]);
}

function pctChange(now: number, before: number): string | null {
  if (before === 0) return null;
  const v = ((now - before) / Math.abs(before)) * 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}%`;
}

/* ================================================================== P&L */

export function PnlBody({ p, currency, printHead, onCsv, setRange }: KindProps): React.JSX.Element {
  const data = useLive(() => op<PnlReport>('reports.pnl', { from: p.from, to: p.to, compare: p.compare, by: p.by }, { quiet: true }), BOOKS, [p.from, p.to, p.compare, p.by]);
  const chartFrom = useMemo(() => {
    const six = `${addMonths(p.to.slice(0, 7), -5)}-01`;
    return p.from < six ? `${p.from.slice(0, 7)}-01` : six;
  }, [p.from, p.to]);
  const chart = useLive(() => op<PnlReport>('reports.pnl', { from: chartFrom, to: p.to, by: 'month' }, { quiet: true }), BOOKS, [chartFrom, p.to]);
  const r = data.data;

  const built = useMemo(() => {
    if (r === null) return null;
    const months = p.by === 'month';
    const columns: SColumn[] = r.columns.map((c) => ({ label: months ? `${monthShort(c.key)} ${c.key.slice(2, 4)}` : c.key === 'current' ? rangeLabel(c.from, c.to) : c.key === 'previous' ? 'Previous period' : 'A year earlier' }));
    const compare = !months && r.columns.length > 1;
    if (compare) columns.push({ label: 'Change', text: true });
    if (months && r.columns.length > 1) columns.push({ label: 'Total' });
    const extend = (vals: number[]): (number | null)[] => (months && r.columns.length > 1 ? [...vals, vals.reduce((s, v) => s + v, 0)] : compare ? [...vals, null] : vals);
    const change = (vals: number[]): (string | null)[] | undefined => (compare ? [...vals.map(() => null), pctChange(vals[0] ?? 0, vals[1] ?? 0)] : undefined);
    const rows: SRow[] = [];
    const sec = (key: string): PnlReport['sections'][number] | undefined => r.sections.find((s) => s.key === key);
    const words: Record<string, string> = { revenue: 'Sales', cogs: 'Cost of what you sold', opex: 'Running costs', other_income: 'Other income', other_expense: 'Other costs' };
    const addSection = (key: string): void => {
      const s = sec(key);
      if (s === undefined || s.accounts.length === 0) return;
      rows.push({ kind: 'section', label: words[key] ?? s.label, sub: s.label !== words[key] ? s.label : undefined });
      for (const a of s.accounts) rows.push({ kind: 'line', label: a.name, code: a.code, values: extend(a.values), texts: change(a.values), onClick: () => navigate('account', { id: a.id, from: p.from, to: p.to }) });
      rows.push({ kind: 'subtotal', label: `Total ${(words[key] ?? s.label).toLowerCase()}`, values: extend(s.totals), texts: change(s.totals) });
    };
    addSection('revenue');
    addSection('cogs');
    rows.push({ kind: 'total', label: 'Gross profit', values: extend(r.gross), texts: change(r.gross), signTone: true });
    rows.push({ kind: 'gap', label: '' });
    addSection('opex');
    const hasOther = (sec('other_income')?.accounts.length ?? 0) + (sec('other_expense')?.accounts.length ?? 0) > 0;
    if (hasOther) {
      rows.push({ kind: 'total', label: 'Operating profit', values: extend(r.operating), texts: change(r.operating), signTone: true });
      rows.push({ kind: 'gap', label: '' });
      addSection('other_income');
      addSection('other_expense');
    }
    rows.push({ kind: 'gap', label: '' });
    rows.push({ kind: 'total', label: (r.net[0] ?? 0) >= 0 ? 'Net profit' : 'Net loss', values: extend(r.net), texts: change(r.net), signTone: true });
    return { columns, rows };
  }, [r, p.by, p.from, p.to]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;

  const revenue = r.sections.find((s) => s.key === 'revenue')?.totals ?? [];
  const sum = (v: number[]): number => (p.by === 'month' ? v.reduce((s, x) => s + x, 0) : (v[0] ?? 0));
  const sales = sum(revenue);
  const gross = sum(r.gross);
  const net = sum(r.net);
  const c = chart.data;
  const crev = c?.sections.find((s) => s.key === 'revenue')?.totals ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title="Sales and costs by month" subtitle={`From ${monthLabel(chartFrom.slice(0, 7))}`} action={<PairLegend a="Sales" b="Costs" />} />
          {c === null ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <PairBars
              height={180}
              aName="Sales"
              bName="Costs"
              onPick={(m) => setRange(`${m}-01`, monthEnd(m) > p.to && m === p.to.slice(0, 7) ? p.to : monthEnd(m))}
              points={c.columns.map((col, i) => {
                const sale = crev[i] ?? 0;
                const cost = sale - (c.net[i] ?? 0);
                return { key: col.key, label: monthLabel(col.key), axis: monthShort(col.key), a: major(sale, currency), b: major(Math.max(0, cost), currency), aText: money(sale, currency), bText: money(cost, currency) };
              })}
            />
          )}
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{net >= 0 ? 'Profit' : 'Loss'} for {rangeLabel(r.from, r.to)}</p>
          <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', net < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(net, currency)}</p>
          {p.compare !== 'none' && r.columns.length > 1 && p.by !== 'month' && (
            <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">
              {(r.columns[1]?.key === 'previous' ? 'Previous period ' : 'A year earlier ') + money(r.net[1] ?? 0, currency)}
            </p>
          )}
          <div className="mt-5 grid grid-cols-1 gap-2">
            <DarkTile label="Sales" value={money(sales, currency)} />
            <DarkTile label="Gross profit" value={`${money(gross, currency)}${sales !== 0 ? ` · ${Math.round((gross / sales) * 100)}%` : ''}`} />
          </div>
        </Card>
      </div>
      <StatementCard title="Profit and loss" subtitle={rangeLabel(r.from, r.to)} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} />
      </StatementCard>
    </div>
  );
}

function DarkTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3">
      <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className="num block truncate text-[15px] font-bold">{value}</span>
    </div>
  );
}

/* ======================================================== balance sheet */

const BS_WORDS: Record<string, { plain: string; term: string }> = {
  assets: { plain: 'What the business owns', term: 'Assets' },
  liabilities: { plain: 'What the business owes', term: 'Liabilities' },
  equity: { plain: "The owners' share", term: 'Equity' },
};

export function BalanceSheetBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<BsReport>('reports.balance-sheet', { date: p.date, compare: p.compare }, { quiet: true }), BOOKS, [p.date, p.compare]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const cols: BsAt[] = r.compare !== undefined ? [r.current, r.compare] : [r.current];
    const columns: SColumn[] = cols.map((c) => ({ label: dayLabel(c.date) }));
    const rows: SRow[] = [];
    const valueOf = (at: BsAt, sectionKey: string, id: string, name: string): number => {
      const s = at.sections.find((x) => x.key === sectionKey);
      const a = s?.accounts.find((x) => (id !== '' ? x.id === id : x.name === name));
      return a?.value ?? 0;
    };
    for (const side of ['assets', 'liabilities', 'equity'] as const) {
      rows.push({ kind: 'section', label: BS_WORDS[side]?.plain ?? side, sub: BS_WORDS[side]?.term });
      for (const s of r.current.sections.filter((x) => x.side === side)) {
        // Lines present in either date.
        const names = new Map<string, { id: string; code: string; name: string; computed: boolean }>();
        for (const at of cols) for (const a of at.sections.find((x) => x.key === s.key)?.accounts ?? []) names.set(a.id !== '' ? a.id : a.name, { id: a.id, code: a.code, name: a.name, computed: a.computed === true });
        if (names.size === 0) continue;
        if (side !== 'equity') rows.push({ kind: 'line', label: s.label, indent: 0, values: cols.map(() => null) });
        for (const a of names.values()) {
          rows.push({
            kind: 'line',
            label: a.name,
            code: a.code,
            indent: side === 'equity' ? 1 : 2,
            values: cols.map((at) => valueOf(at, s.key, a.id, a.name)),
            onClick: a.id !== '' ? () => navigate('account', { id: a.id }) : undefined,
          });
        }
        if (side !== 'equity') rows.push({ kind: 'subtotal', label: `Total ${s.label.toLowerCase()}`, values: cols.map((at) => at.sections.find((x) => x.key === s.key)?.total ?? 0) });
      }
      rows.push({ kind: 'total', label: `Total ${(BS_WORDS[side]?.term ?? side).toLowerCase()}`, values: cols.map((at) => (side === 'assets' ? at.assets : side === 'liabilities' ? at.liabilities : at.equity)) });
      rows.push({ kind: 'gap', label: '' });
    }
    rows.push({ kind: 'total', label: 'Owed plus owners’ share', values: cols.map((at) => at.liabilities + at.equity) });
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const c = r.current;
  const parts = (side: 'assets' | 'liabilities') =>
    c.sections
      .filter((s) => s.side === side)
      .flatMap((s) => s.accounts)
      .filter((a) => a.value > 0)
      .sort((x, y) => y.value - x.value)
      .slice(0, 6)
      .map((a, i) => ({ key: a.id !== '' ? a.id : a.name, label: a.name, value: a.value, valueText: money(a.value, currency), fill: segmentColor(i, false).fill, onClick: a.id !== '' ? () => navigate('account', { id: a.id }) : undefined }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title="What it owns and what it owes" subtitle={asAt(c.date)} />
          <div className="grid grid-cols-1 gap-6 @min-[640px]:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-semibold text-[var(--erp-ink-2)]">
                Owns <span className="num ml-1 text-[15px] font-extrabold text-[var(--erp-ink)]">{money(c.assets, currency)}</span>
              </p>
              <SplitBar parts={parts('assets')} />
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-[var(--erp-ink-2)]">
                Owes <span className="num ml-1 text-[15px] font-extrabold text-[var(--erp-ink)]">{money(c.liabilities, currency)}</span>
              </p>
              <SplitBar parts={parts('liabilities')} />
            </div>
          </div>
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Owners' share (net worth)</p>
          <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', c.equity < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(c.equity, currency)}</p>
          <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">What it owns minus what it owes</p>
          <div className="mt-5 grid grid-cols-1 gap-2">
            <DarkTile label="Profit this financial year so far" value={money(c.current_earnings, currency)} />
          </div>
          <p className={cn('mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold', c.balanced ? 'text-[var(--erp-on-dark)]' : 'text-[var(--erp-red-on-dark)]')}>
            {c.balanced ? <CheckCircle2 size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
            {c.balanced ? 'The two sides agree' : `Off by ${money(c.difference, currency)}`}
          </p>
        </Card>
      </div>
      <StatementCard title="Balance sheet" subtitle={asAt(c.date)} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} />
      </StatementCard>
    </div>
  );
}

/* ============================================================ cash flow */

export function CashFlowBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<CashFlowReport>('reports.cash-flow', { from: p.from, to: p.to }, { quiet: true }), BOOKS, [p.from, p.to]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: rangeLabel(r.from, r.to) }];
    const acc = (x: { id: string; code: string; name: string; value: number }): SRow => ({ kind: 'line', label: x.name, code: x.code, indent: 2, values: [x.value], onClick: () => navigate('account', { id: x.id, from: r.from, to: r.to }) });
    const rows: SRow[] = [
      { kind: 'section', label: 'From running the business', sub: 'Operating' },
      { kind: 'line', label: 'Profit for the period', values: [r.net_income], signTone: true },
      { kind: 'line', label: 'Depreciation added back (no cash moved)', values: [r.depreciation] },
      ...(r.working_capital.rows.length > 0 ? [{ kind: 'line' as const, label: 'Money tied up in, or freed from', values: [r.working_capital.total] }, ...r.working_capital.rows.map(acc)] : []),
      { kind: 'subtotal', label: 'Cash from running the business', values: [r.operating], signTone: true },
      { kind: 'section', label: 'From buying and selling equipment', sub: 'Investing' },
      ...r.investing.rows.map(acc),
      { kind: 'subtotal', label: 'Cash from investing', values: [r.investing.total], signTone: true },
      { kind: 'section', label: 'From loans and owners', sub: 'Financing' },
      ...r.financing.rows.map(acc),
      { kind: 'subtotal', label: 'Cash from financing', values: [r.financing.total], signTone: true },
      { kind: 'gap', label: '' },
      { kind: 'total', label: 'Change in cash', values: [r.net_change], signTone: true },
      { kind: 'gap', label: '' },
      { kind: 'line', label: 'Cash at the start', values: [r.opening_cash], indent: 0 },
      { kind: 'line', label: 'Cash at the end', values: [r.closing_cash], indent: 0 },
      ...(r.unexplained !== 0 ? [{ kind: 'line' as const, label: 'Not explained by the books above', values: [r.unexplained], indent: 0 }] : []),
    ];
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title="Where the cash came from and went" subtitle="Above the line came in, below went out" />
          <Bars
            height={180}
            format={(n) => (Math.abs(n) <= 1 ? '' : compact(n))}
            points={[
              { key: 'op', label: 'Running the business', axis: 'Running', value: major(r.operating, currency), text: money(r.operating, currency) },
              { key: 'inv', label: 'Investing', axis: 'Investing', value: major(r.investing.total, currency), text: money(r.investing.total, currency) },
              { key: 'fin', label: 'Financing', axis: 'Financing', value: major(r.financing.total, currency), text: money(r.financing.total, currency) },
              { key: 'net', label: 'Change in cash', axis: 'Change', value: major(r.net_change, currency), text: money(r.net_change, currency), current: true },
            ]}
          />
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Cash at the end</p>
          <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', r.closing_cash < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(r.closing_cash, currency)}</p>
          <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">{shortDay(r.to)}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <DarkTile label="At the start" value={money(r.opening_cash, currency)} />
            <DarkTile label="Change" value={`${r.net_change >= 0 ? '+' : ''}${money(r.net_change, currency)}`} />
          </div>
        </Card>
      </div>
      <StatementCard title="Cash flow" subtitle={rangeLabel(r.from, r.to)} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} />
      </StatementCard>
    </div>
  );
}

/* ======================================================== trial balance */

const TYPE_TITLE: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

export function TrialBalanceBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<TbReport>('reports.trial-balance', { from: p.from, to: p.to }, { quiet: true }), BOOKS, [p.from, p.to]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'At the start', hideOnPhone: true }, { label: 'Debits' }, { label: 'Credits' }, { label: 'At the end' }];
    const rows: SRow[] = [];
    for (const t of ['asset', 'liability', 'equity', 'income', 'expense']) {
      const list = r.accounts.filter((a) => a.type === t);
      if (list.length === 0) continue;
      rows.push({ kind: 'section', label: TYPE_TITLE[t] ?? t });
      for (const a of list) {
        const open = a.opening_debit - a.opening_credit;
        const close = a.closing_debit - a.closing_credit;
        rows.push({
          kind: 'line',
          label: a.name,
          code: a.code,
          values: [Math.abs(open), a.debit, a.credit, Math.abs(close)],
          texts: [open === 0 ? '' : `${money(Math.abs(open), currency)} ${open > 0 ? 'Dr' : 'Cr'}`, null, null, close === 0 ? '' : `${money(Math.abs(close), currency)} ${close > 0 ? 'Dr' : 'Cr'}`],
          onClick: () => navigate('account', { id: a.id, from: r.from, to: r.to }),
        });
      }
    }
    rows.push({ kind: 'gap', label: '' });
    rows.push({ kind: 'total', label: 'Total', values: [null, r.totals.debit, r.totals.credit, null] });
    return { columns, rows };
  }, [r, currency]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-3">
        <Card tone="dark" delay={1}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Do the books balance?</p>
          <p className="mt-1 inline-flex items-center gap-2 text-[26px] font-extrabold leading-8">
            {r.balanced ? <CheckCircle2 size={24} aria-hidden className="text-[var(--erp-accent)]" /> : <AlertTriangle size={24} aria-hidden className="text-[var(--erp-red-on-dark)]" />}
            {r.balanced ? 'Yes' : 'No'}
          </p>
          <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">{r.balanced ? 'Debits equal credits' : 'Debits and credits differ: ask your accountant'}</p>
        </Card>
        <Card delay={2}>
          <Figure label="Debits in the period" value={money(r.totals.debit, currency)} sub={`${r.accounts.length} accounts moved`} />
        </Card>
        <Card delay={3}>
          <Figure label="Credits in the period" value={money(r.totals.credit, currency)} sub={rangeLabel(r.from, r.to)} />
        </Card>
      </div>
      <StatementCard title="Trial balance" subtitle={rangeLabel(r.from, r.to)} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} />
      </StatementCard>
    </div>
  );
}

/* ======================================================= general ledger */

export function LedgerBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [p.from, p.to]);
  const data = useLive(() => op<GlReport>('reports.ledger', { from: p.from, to: p.to, limit: 200, offset }, { quiet: true }), BOOKS, [p.from, p.to, offset]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'Date', text: true }, { label: 'Entry', text: true, hideOnPhone: true }, { label: 'Debit' }, { label: 'Credit' }];
    const rows: SRow[] = [];
    let current = '';
    let dr = 0;
    let cr = 0;
    const close = (): void => {
      if (current !== '') rows.push({ kind: 'subtotal', label: 'Total', values: [null, null, dr, cr] });
    };
    for (const l of r.lines) {
      const k = `${l.code} ${l.account}`;
      if (k !== current) {
        close();
        current = k;
        dr = 0;
        cr = 0;
        rows.push({ kind: 'section', label: `${l.code} ${l.account}` });
      }
      dr += l.debit;
      cr += l.credit;
      rows.push({
        kind: 'line',
        label: l.label !== '' ? l.label : l.memo,
        sub: [l.party, l.label !== '' ? l.memo : ''].filter((x) => x !== '').join(' · '),
        values: [null, null, l.debit !== 0 ? l.debit : null, l.credit !== 0 ? l.credit : null],
        texts: [shortDay(l.date), l.journal, null, null],
        onClick: () => navigate('journal', { id: l.journal }),
      });
    }
    close();
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  return (
    <StatementCard title="General ledger" subtitle={`${rangeLabel(r.from, r.to)}, ${r.total} lines`} printHead={printHead}>
      {r.lines.length === 0 ? (
        <Empty icon={CheckCircle2} title="Nothing posted in this period" compact />
      ) : (
        <Statement columns={built.columns} rows={built.rows} currency={currency} minWidth={640} />
      )}
      <Pager offset={offset} limit={200} total={r.total} onChange={setOffset} />
    </StatementCard>
  );
}

/* ================================================================ aging */

const BUCKETS: { key: 'current' | 'd30' | 'd60' | 'd90' | 'over90'; label: string; short: string }[] = [
  { key: 'current', label: 'Not due yet', short: 'Not due' },
  { key: 'd30', label: '1 to 30 days late', short: '1-30' },
  { key: 'd60', label: '31 to 60 days late', short: '31-60' },
  { key: 'd90', label: '61 to 90 days late', short: '61-90' },
  { key: 'over90', label: 'Over 90 days late', short: '90+' },
];

export function AgingBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<AgingReport>('reports.aging', { side: p.side, date: p.date }, { quiet: true }), [...BOOKS, 'allocations'], [p.side, p.date]);
  const r = data.data;
  const receivable = p.side === 'receivable';
  // Each party's documents open under it; with many parties they start closed.
  const [opened, setOpened] = useState<Set<string> | null>(null);
  useEffect(() => setOpened(null), [p.side, p.date]);
  const many = (r?.parties.length ?? 0) > 12;
  const isOpen = (id: string): boolean => (opened === null ? !many : opened.has(id));
  const flip = (id: string): void => {
    const base = opened ?? new Set(many ? [] : (r?.parties ?? []).map((x) => x.id));
    const next = new Set(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpened(next);
  };
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [...BUCKETS.map((b) => ({ label: b.short })), { label: 'Credits', hideOnPhone: true }, { label: 'Total' }];
    const rows: SRow[] = [];
    for (const party of r.parties) {
      rows.push({
        kind: 'line',
        label: party.name,
        indent: 0,
        values: [party.current, party.d30, party.d60, party.d90, party.over90, party.credits, party.total].map((v) => (v === 0 ? null : v)),
        onClick: () => navigate('party', { id: party.id, role: receivable ? 'customer' : 'supplier' }),
        toggle: party.documents.length > 0 ? { open: isOpen(party.id), onToggle: () => flip(party.id), label: `${party.documents.length} ${party.documents.length === 1 ? 'document' : 'documents'}` } : undefined,
      });
      if (!isOpen(party.id)) continue;
      for (const d of party.documents) {
        const values: (number | null)[] = BUCKETS.map((b) => (b.key === d.bucket ? d.base : null));
        rows.push({ kind: 'line', label: d.number, sub: d.due_date !== '' ? `due ${shortDay(d.due_date)}${d.days > 0 ? `, ${d.days} days late` : ''}` : '', indent: 2, values: [...values, null, null], onClick: () => navigate('doc', { id: d.id }) });
      }
    }
    rows.push({ kind: 'gap', label: '' });
    const t = r.totals;
    rows.push({ kind: 'total', label: 'Total', values: [t.current, t.d30, t.d60, t.d90, t.over90, t.credits, t.total] });
    return { columns, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, receivable, opened]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const t = r.totals;
  const owed = t.current + t.d30 + t.d60 + t.d90 + t.over90;
  const late = t.d30 + t.d60 + t.d90 + t.over90;
  const fills = ['var(--erp-green)', 'var(--erp-amber)', 'var(--erp-seg-2)', 'var(--erp-seg-1)', 'var(--erp-red)'];
  const texts = ['var(--erp-on-green)', 'var(--erp-on-amber)', 'var(--erp-seg-2-text)', 'var(--erp-seg-1-text)', 'var(--erp-on-red)'];
  const slices = BUCKETS.map((b, i) => ({ key: b.key, label: b.short, value: Math.max(0, t[b.key]), amount: money(t[b.key], currency, 'short'), share: owed > 0 ? Math.round((t[b.key] / owed) * 100) : 0, fill: fills[i] ?? 'var(--erp-ink)', text: texts[i] ?? 'var(--erp-shell)' })).filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="sand" className="@min-[900px]:col-span-7" delay={1}>
          <CardHeader title={receivable ? 'How late customers are' : 'How late your bills are'} subtitle={asAt(r.date)} />
          <div className="flex flex-col-reverse items-center gap-6 @min-[640px]:flex-row @min-[640px]:justify-between">
            <ul className="flex w-full flex-col gap-2.5 @min-[640px]:max-w-[240px]">
              {BUCKETS.map((b, i) => (
                <li key={b.key} className="flex items-center gap-3">
                  <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: fills[i] }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{b.label}</span>
                  <span className="num text-[13px] font-bold">{money(t[b.key], currency)}</span>
                </li>
              ))}
            </ul>
            <Donut slices={slices} centerValue={money(owed, currency, 'short')} centerCaption={receivable ? 'owed to you' : 'you owe'} size={260} />
          </div>
        </Card>
        <Card className="@min-[900px]:col-span-5" delay={2}>
          <CardHeader title={receivable ? 'Who owes the most' : 'Who you owe the most'} subtitle={late > 0 ? `${money(late, currency)} is late` : 'Nothing is late'} />
          {r.parties.length === 0 ? (
            <Empty icon={CheckCircle2} title={receivable ? 'Nobody owes you anything' : 'You owe nothing'} compact />
          ) : (
            <RankBars
              rows={r.parties
                .filter((x) => x.total > 0)
                .slice(0, 6)
                .map((x) => ({
                  key: x.id,
                  label: x.name,
                  value: x.total,
                  valueText: money(x.total, currency),
                  sub: x.d30 + x.d60 + x.d90 + x.over90 > 0 ? `${money(x.d30 + x.d60 + x.d90 + x.over90, currency)} late` : 'Not due yet',
                  onClick: () => navigate('party', { id: x.id, role: receivable ? 'customer' : 'supplier' }),
                }))}
            />
          )}
        </Card>
      </div>
      <StatementCard title={receivable ? 'Who owes you' : 'What you owe'} subtitle={`${asAt(r.date)}, in ${currency}, by how many days past due`} printHead={printHead}>
        {r.parties.length === 0 ? <Empty icon={CheckCircle2} title="Nothing open" compact /> : <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader={receivable ? 'Customer' : 'Supplier'} />}
      </StatementCard>
    </div>
  );
}

/* ======================================================= sales, purchases */

export function SalesBody({ p, currency, printHead, onCsv, setRange, side }: KindProps & { side: 'sales' | 'purchases' }): React.JSX.Element {
  const by = p.by !== '' ? p.by : side === 'sales' ? 'customer' : 'supplier';
  const data = useLive(() => op<SalesReport>(side === 'sales' ? 'reports.sales' : 'reports.purchases', { from: p.from, to: p.to, by }, { quiet: true }), [...BOOKS, 'document_lines'], [side, p.from, p.to, by]);
  const r = data.data;
  const sales = side === 'sales';
  const open = (key: string): (() => void) | undefined => {
    if (by === 'customer' || by === 'supplier') return key !== '' ? () => navigate('party', { id: key, role: by }) : undefined;
    if (by === 'item') return key !== '_other' ? () => navigate('item', { id: key }) : undefined;
    if (by === 'month') return () => setRange(`${key}-01`, monthEnd(key) > p.to ? p.to : monthEnd(key));
    return undefined;
  };
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [];
    if (by === 'item') columns.push({ label: 'Quantity', text: true, hideOnPhone: true });
    columns.push({ label: sales ? 'Sales' : 'Bought' });
    if (sales) columns.push({ label: 'Cost', hideOnPhone: true }, { label: 'Margin' }, { label: 'Margin %', text: true, hideOnPhone: true });
    columns.push({ label: 'Documents', text: true, hideOnPhone: true });
    const rows: SRow[] = r.rows.map((g) => {
      const values: (number | null)[] = [];
      const texts: (string | null)[] = [];
      if (by === 'item') {
        values.push(null);
        texts.push(g.qty !== undefined ? qty(g.qty) : '');
      }
      values.push(g.revenue);
      texts.push(null);
      if (sales) {
        values.push(g.cost ?? 0, g.margin ?? 0, null);
        texts.push(null, null, g.margin_pct !== undefined ? `${g.margin_pct}%` : '');
      }
      values.push(null);
      texts.push(String(g.documents));
      return { kind: 'line', label: by === 'month' ? monthLabel(g.label) : g.label, indent: 0, values, texts, onClick: open(g.key) };
    });
    const tv: (number | null)[] = [];
    const tt: (string | null)[] = [];
    if (by === 'item') {
      tv.push(null);
      tt.push(null);
    }
    tv.push(r.total);
    tt.push(null);
    if (sales) {
      tv.push(r.cost ?? 0, r.margin ?? 0, null);
      tt.push(null, null, r.total !== 0 ? `${Math.round(((r.margin ?? 0) / r.total) * 1000) / 10}%` : '');
    }
    tv.push(null);
    tt.push(String(r.rows.reduce((s, g) => s + g.documents, 0)));
    rows.push({ kind: 'gap', label: '' }, { kind: 'total', label: 'Total', values: tv, texts: tt });
    return { columns, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, by, sales]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const byWord = by === 'customer' ? 'customer' : by === 'supplier' ? 'supplier' : by === 'item' ? 'item' : by === 'category' ? 'category' : 'month';

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title={by === 'month' ? (sales ? 'Sales by month' : 'Purchases by month') : `Top ${byWord === 'category' ? 'categories' : `${byWord}s`}`} subtitle={rangeLabel(r.from, r.to)} />
          {r.rows.length === 0 ? (
            <Empty icon={CheckCircle2} title={sales ? 'No sales in this period' : 'No purchases in this period'} compact />
          ) : by === 'month' ? (
            <Bars height={180} points={r.rows.map((g) => ({ key: g.key, label: monthLabel(g.key), axis: monthShort(g.key), value: major(g.revenue, currency), text: money(g.revenue, currency) }))} onPick={(k) => open(k)?.()} />
          ) : (
            <RankBars
              rows={r.rows.slice(0, 8).map((g) => ({
                key: g.key,
                label: g.label,
                value: g.revenue,
                valueText: money(g.revenue, currency),
                sub: sales && g.margin_pct !== undefined ? `${g.margin_pct}% margin` : `${g.documents} ${g.documents === 1 ? 'document' : 'documents'}`,
                onClick: open(g.key),
              }))}
            />
          )}
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{sales ? 'Sold, before tax' : 'Bought, before tax'}</p>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(r.total, currency)}</p>
          <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">{rangeLabel(r.from, r.to)}</p>
          {sales && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <DarkTile label="Cost of it" value={money(r.cost ?? 0, currency)} />
              <DarkTile label="Margin" value={r.total !== 0 ? `${Math.round(((r.margin ?? 0) / r.total) * 100)}%` : '-'} />
            </div>
          )}
          {r.cost_estimated && <p className="mt-3 text-[12px] text-[var(--erp-on-dark-muted)]">Some costs are estimated from the current average cost.</p>}
        </Card>
      </div>
      <StatementCard title={sales ? `Sales by ${byWord}` : `Purchases by ${byWord}`} subtitle={rangeLabel(r.from, r.to)} printHead={printHead}>
        {r.rows.length === 0 ? <Empty icon={CheckCircle2} title="Nothing in this period" compact /> : <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader={byWord[0]?.toUpperCase() + byWord.slice(1)} />}
      </StatementCard>
    </div>
  );
}

/* ================================================================ stock */

export function StockBody({ currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<StockReport>('reports.stock', {}, { quiet: true }), [...READS.stock, 'journals'], []);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'On hand', text: true }, { label: 'Average cost', text: true, hideOnPhone: true }, { label: 'Value' }];
    const rows: SRow[] = [];
    const cats = [...new Set(r.items.map((i) => i.category))].sort();
    for (const c of cats) {
      const list = r.items.filter((i) => i.category === c);
      rows.push({ kind: 'section', label: c !== '' ? c : 'No category' });
      for (const i of list) rows.push({ kind: 'line', label: i.name, code: i.sku, values: [null, null, i.value], texts: [`${qty(i.qty)} ${i.unit}`, i.avg_cost, null], onClick: () => navigate('item', { id: i.id }) });
      rows.push({ kind: 'subtotal', label: `Total ${c !== '' ? c.toLowerCase() : 'without a category'}`, values: [null, null, list.reduce((s, i) => s + i.value, 0)] });
    }
    rows.push({ kind: 'gap', label: '' }, { kind: 'total', label: 'Total stock value', values: [null, null, r.total] });
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const byCat = new Map<string, number>();
  for (const i of r.items) byCat.set(i.category !== '' ? i.category : 'No category', (byCat.get(i.category !== '' ? i.category : 'No category') ?? 0) + i.value);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title="Where the value sits" subtitle="The items worth the most" />
          <RankBars rows={[...r.items].sort((a, b) => b.value - a.value).slice(0, 6).map((i) => ({ key: i.id, label: i.name, value: i.value, valueText: money(i.value, currency), sub: `${qty(i.qty)} ${i.unit} at ${i.avg_cost}`, onClick: () => navigate('item', { id: i.id }) }))} />
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Stock worth, at average cost</p>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(r.total, currency)}</p>
          {r.difference !== null && (
            <p className={cn('mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold', r.difference === 0 ? 'text-[var(--erp-on-dark)]' : 'text-[var(--erp-red-on-dark)]')}>
              {r.difference === 0 ? <CheckCircle2 size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
              {r.difference === 0 ? 'Matches the books' : `The books differ by ${money(r.difference, currency)}`}
            </p>
          )}
          <div className="erp-on-card mt-5 rounded-[18px] bg-[var(--erp-card)] p-3 text-[var(--erp-ink)]">
            <SplitBar parts={[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v], i) => ({ key: k, label: k, value: v, valueText: money(v, currency, 'short'), fill: segmentColor(i, false).fill }))} />
          </div>
        </Card>
      </div>
      <StatementCard title="Stock value" subtitle={`${r.items.length} items with stock`} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader="Item" />
      </StatementCard>
    </div>
  );
}

/* ================================================================== tax */

export function TaxBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<TaxReport>('reports.tax', { from: p.from, to: p.to }, { quiet: true }), BOOKS, [p.from, p.to]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'Before tax' }, { label: 'Tax' }];
    const sales = r.taxes.filter((t) => t.sales_taxable !== 0 || t.sales_tax !== 0);
    const buys = r.taxes.filter((t) => t.purchase_taxable !== 0 || t.purchase_tax !== 0);
    const rows: SRow[] = [{ kind: 'section', label: 'Collected on sales' }];
    for (const t of sales) rows.push({ kind: 'line', label: t.name, code: t.code, values: [t.sales_taxable, t.sales_tax] });
    if (r.other_collected !== 0) rows.push({ kind: 'line', label: 'Booked outside invoices', values: [null, r.other_collected] });
    rows.push({ kind: 'subtotal', label: 'Total collected', values: [null, r.collected + r.other_collected] });
    rows.push({ kind: 'section', label: 'Paid on purchases' });
    for (const t of buys) rows.push({ kind: 'line', label: `${t.name}${t.recoverable ? '' : ' (not claimable)'}`, code: t.code, values: [t.purchase_taxable, t.purchase_tax] });
    if (r.other_claimable !== 0) rows.push({ kind: 'line', label: 'Booked outside bills', values: [null, r.other_claimable] });
    rows.push({ kind: 'subtotal', label: 'Total you can claim back', values: [null, r.claimable + r.other_claimable] });
    rows.push({ kind: 'gap', label: '' }, { kind: 'total', label: r.net >= 0 ? 'To pay' : 'To claim back', values: [null, Math.abs(r.net)] });
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const collected = r.collected + r.other_collected;
  const claim = r.claimable + r.other_claimable;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader title="Tax in and out" subtitle={rangeLabel(r.from, r.to)} />
          <div className="grid grid-cols-1 gap-5 @min-[480px]:grid-cols-2">
            <Figure label="Collected from customers" value={money(collected, currency)} />
            <Figure label="Paid to suppliers, to claim back" value={money(claim, currency)} />
          </div>
          <div className="mt-5">
            <SplitBar
              parts={[
                { key: 'c', label: 'Collected', value: Math.max(0, collected), valueText: money(collected, currency), fill: 'var(--erp-accent)' },
                { key: 'p', label: 'Claimable', value: Math.max(0, claim), valueText: money(claim, currency), fill: 'var(--erp-ink)' },
              ]}
            />
          </div>
        </Card>
        <Card tone="dark" className="@min-[900px]:col-span-4" delay={2}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{r.net >= 0 ? 'To pay the tax office' : 'To claim back'}</p>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(Math.abs(r.net), currency)}</p>
          <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">Collected minus what you can claim back</p>
        </Card>
      </div>
      <StatementCard title="Tax summary" subtitle={rangeLabel(r.from, r.to)} printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader="Tax" />
      </StatementCard>
    </div>
  );
}

/* =============================================================== budget */

export function BudgetBody({ p, currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const [side, setSide] = useState<'income' | 'expense'>('expense');
  const data = useLive(() => op<BudgetReport>('reports.budget', { year: p.year }, { quiet: true }), [...READS.books, 'budgets'], [p.year]);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'Plan' }, { label: 'Actual' }, { label: 'Better or worse' }, { label: 'Of plan', text: true, hideOnPhone: true }];
    const rows: SRow[] = [];
    for (const t of ['income', 'expense'] as const) {
      const list = r.accounts.filter((a) => a.type === t);
      if (list.length === 0) continue;
      rows.push({ kind: 'section', label: t === 'income' ? 'Money earned' : 'Money spent' });
      for (const a of list) rows.push({ kind: 'line', label: a.name, code: a.code, values: [a.total_budget, a.total_actual, a.variance, null], texts: [null, null, null, a.total_budget !== 0 ? `${Math.round((a.total_actual / a.total_budget) * 100)}%` : ''], signTone: true, onClick: () => navigate('account', { id: a.id, from: `${r.months[0] ?? ''}-01`, to: monthEnd(r.months[11] ?? '') }) });
      rows.push({ kind: 'subtotal', label: t === 'income' ? 'Total earned' : 'Total spent', values: [list.reduce((s, a) => s + a.total_budget, 0), list.reduce((s, a) => s + a.total_actual, 0), list.reduce((s, a) => s + a.variance, 0), null], signTone: true });
    }
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  const list = r.accounts.filter((a) => a.type === side);
  return (
    <div className="flex flex-col gap-5">
      <Card delay={1}>
        <CardHeader
          title={side === 'income' ? 'Earned against plan' : 'Spent against plan'}
          subtitle="Each month of the year"
          action={
            <Segmented
              ariaLabel="Income or spending"
              value={side}
              onChange={setSide}
              options={[
                { value: 'expense', label: 'Spending' },
                { value: 'income', label: 'Income' },
              ]}
            />
          }
        />
        <PairBars
          height={170}
          aName="Plan"
          bName="Actual"
          points={r.months.map((m, i) => {
            const plan = list.reduce((s, a) => s + (a.budget[i] ?? 0), 0);
            const act = list.reduce((s, a) => s + (a.actual[i] ?? 0), 0);
            return { key: m, label: monthLabel(m), axis: monthShort(m), a: major(plan, currency), b: major(Math.max(0, act), currency), aText: money(plan, currency), bText: money(act, currency) };
          })}
        />
        <div className="mt-3">
          <PairLegend a="Plan" b="Actual" />
        </div>
      </Card>
      <StatementCard title="Budget against actual" subtitle={`The year from ${monthLabel(r.months[0] ?? '')}`} printHead={printHead}>
        {r.accounts.length === 0 ? <Empty icon={CheckCircle2} title="No budget for this year" compact>Set one on the Budgets page.</Empty> : <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader="Account" />}
      </StatementCard>
    </div>
  );
}

/* ============================================================= projects */

export function ProjectsBody({ currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<{ projects: ProjectRow[] }>('projects.list', { status: 'all', limit: 200 }, { quiet: true }), ['projects', 'timesheets', 'documents', 'journal_lines'], []);
  const r = data.data;
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'Invoiced' }, { label: 'Costs', hideOnPhone: true }, { label: 'Time cost', hideOnPhone: true }, { label: 'Margin' }, { label: 'Budget used', text: true, hideOnPhone: true }];
    const rows: SRow[] = r.projects.map((x) => ({
      kind: 'line' as const,
      label: x.name,
      code: x.code,
      sub: x.customer?.name ?? '',
      indent: 0,
      values: [x.revenue, x.spent, x.time_cost, x.revenue - x.spent - x.time_cost, null],
      texts: [null, null, null, null, x.budget_used_pct !== null ? `${Math.round(x.budget_used_pct)}%` : ''],
      signTone: true,
      onClick: () => navigate('project', { id: x.id }),
    }));
    const sum = (f: (x: ProjectRow) => number): number => r.projects.reduce((s, x) => s + f(x), 0);
    rows.push({ kind: 'gap', label: '' }, { kind: 'total', label: 'All projects', values: [sum((x) => x.revenue), sum((x) => x.spent), sum((x) => x.time_cost), sum((x) => x.revenue - x.spent - x.time_cost), null], signTone: true });
    return { columns, rows };
  }, [r]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <Card delay={1}>
        <CardHeader title="Margin per project" subtitle="Invoiced, less costs in the books and the cost of time" />
        {r.projects.length === 0 ? (
          <Empty icon={CheckCircle2} title="No projects yet" compact />
        ) : (
          <RankBars rows={r.projects.slice(0, 8).map((x) => ({ key: x.id, label: x.name, value: x.revenue - x.spent - x.time_cost, valueText: money(x.revenue - x.spent - x.time_cost, currency), sub: `${qty(x.hours)} h logged${x.customer !== null ? ` · ${x.customer.name}` : ''}`, onClick: () => navigate('project', { id: x.id }) }))} />
        )}
      </Card>
      <StatementCard title="Project profitability" subtitle="Every project, from its start" printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader="Project" />
      </StatementCard>
    </div>
  );
}

/* ============================================================== payroll */

const RUN_STATUS: Record<string, string> = { draft: 'Draft', approved: 'Approved', posted: 'Posted', paid: 'Paid' };

export function PayrollBody({ currency, printHead, onCsv }: KindProps): React.JSX.Element {
  const data = useLive(() => op<{ runs: PayRun[] }>('payroll.runs', { limit: 24 }, { quiet: true }), ['payroll_runs', 'payslips'], []);
  const r = data.data;
  const runs = useMemo(() => [...(r?.runs ?? [])].sort((a, b) => (a.month < b.month ? -1 : 1)), [r]);
  const built = useMemo(() => {
    if (r === null) return null;
    const columns: SColumn[] = [{ label: 'People', text: true, hideOnPhone: true }, { label: 'Gross pay' }, { label: 'Deductions', hideOnPhone: true }, { label: 'Employer costs', hideOnPhone: true }, { label: 'Net pay' }, { label: 'Total cost' }];
    const rows: SRow[] = [...runs].reverse().map((x) => ({ kind: 'line' as const, label: x.month_name, sub: `${x.number} · ${RUN_STATUS[x.status] ?? x.status}`, indent: 0, values: [null, x.gross, x.deductions, x.employer, x.net, x.cost], texts: [String(x.count), null, null, null, null, null], onClick: () => navigate('payrun', { id: x.id }) }));
    const sum = (f: (x: PayRun) => number): number => runs.reduce((s, x) => s + f(x), 0);
    rows.push({ kind: 'gap', label: '' }, { kind: 'total', label: 'Total', values: [null, sum((x) => x.gross), sum((x) => x.deductions), sum((x) => x.employer), sum((x) => x.net), sum((x) => x.cost)] });
    return { columns, rows };
  }, [r, runs]);
  useCsv(onCsv, built?.columns ?? null, built?.rows ?? null, currency);

  if (data.error !== null && r === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (r === null || built === null) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <Card delay={1}>
        <CardHeader title="What people cost each month" subtitle="Gross pay plus employer contributions" />
        {runs.length === 0 ? (
          <Empty icon={CheckCircle2} title="No pay runs yet" compact />
        ) : (
          <Bars height={170} points={runs.map((x) => ({ key: x.id, label: x.month_name, axis: monthShort(x.month), value: major(x.cost, currency), text: money(x.cost, currency), muted: x.status === 'draft' }))} onPick={(id) => navigate('payrun', { id })} />
        )}
      </Card>
      <StatementCard title="Payroll summary" subtitle="Each pay run" printHead={printHead}>
        <Statement columns={built.columns} rows={built.rows} currency={currency} labelHeader="Month" />
      </StatementCard>
    </div>
  );
}


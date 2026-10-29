/**
 * Reports, all from the same ledger, in the home currency: profit and loss
 * (accrual or cash, by month or quarter, with a comparison), balance sheet,
 * cash flow, trial balance, aged receivables and payables, the tax / VAT
 * summary, budget against actual, spending and net worth. Every amount
 * opens the entries behind it; any report can be exported, printed, or
 * explained by the AI agent.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, ChartColumn, ChartLine, ChartPie, Download, HandCoins, Pencil, Percent, Printer, Receipt, Scale, Sparkles, Table2, Target, TrendingUp, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, downloadBlob, errMessage } from '../lib/api.ts';
import { acct, compact, day, money, monthName, toDecimal, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Aged, Balance, BudgetReport, CashFlow, NetWorth, PnL, Spending, TaxReport, Trial } from '../lib/types.ts';
import { DateInput, Heading, MoneyInput, ShareBar, Stat } from '../components/controls.tsx';
import { AGE_BUCKETS, BarChart, CAT, Donut, HBars, Legend, Waterfall } from '../components/charts.tsx';
import { Btn, Chip, Empty, IconBtn, Modal, Seg, Select, Spinner } from '../components/ui.tsx';

type ReportId = 'pnl' | 'balance' | 'cashflow' | 'trial' | 'ar' | 'ap' | 'tax' | 'budget' | 'spending' | 'networth';

const LIST: { id: ReportId; label: string; icon: LucideIcon; group: string; personal?: boolean | undefined; business?: boolean | undefined }[] = [
  { id: 'pnl', label: 'Profit and loss', icon: TrendingUp, group: 'Statements' },
  { id: 'balance', label: 'Balance sheet', icon: Scale, group: 'Statements' },
  { id: 'cashflow', label: 'Cash flow', icon: ArrowLeftRight, group: 'Statements' },
  { id: 'trial', label: 'Trial balance', icon: Table2, group: 'Statements' },
  { id: 'ar', label: 'Aged receivables', icon: HandCoins, group: 'Who owes what', business: true },
  { id: 'ap', label: 'Aged payables', icon: Receipt, group: 'Who owes what', business: true },
  { id: 'tax', label: 'Tax summary', icon: Percent, group: 'Tax' },
  { id: 'budget', label: 'Budget vs actual', icon: Target, group: 'Planning' },
  { id: 'spending', label: 'Spending', icon: ChartPie, group: 'Planning' },
  { id: 'networth', label: 'Net worth', icon: ChartLine, group: 'Planning' },
];

const RANGES = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'this_year', label: 'This fiscal year' },
  { value: 'last_year', label: 'Last fiscal year' },
  { value: 'last_12_months', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom dates' },
];

interface Drill {
  account: string;
  from?: string | undefined;
  to?: string | undefined;
  label: string;
}

function DrillPanel({ d, onClose }: { d: Drill; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.drill({ account: d.account, from: d.from, to: d.to }), ['postings'], [d.account, d.from, d.to]);
  const r = live.data;
  const a = app.account(d.account);
  const credit = a !== undefined && (a.type === 'liability' || a.type === 'income' || a.type === 'equity');
  return (
    <aside className="fixed inset-0 z-30 flex w-full flex-col bg-[var(--lf-card)] lf-no-print md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-[var(--lf-line)]">
      <div className="flex items-start gap-2 border-b border-[var(--lf-line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold">{d.label}</p>
          <p className="text-[12px] text-[var(--lf-muted)]">{d.from ? day(d.from) + ' – ' + day(d.to) : 'To ' + day(d.to)}</p>
        </div>
        <IconBtn icon={X} label="Close" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {r === null ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : r.rows.length === 0 ? (
          <Empty icon={ChartColumn} title="No entries" />
        ) : (
          <table className="lf-table">
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.posting} data-click="true" onClick={() => go('ledger', { txn: row.txn })}>
                  <td className="num w-[64px] text-[var(--lf-ink-2)]">{day(row.date, true)}</td>
                  <td className="max-w-0 truncate">{row.narration || row.contact_name || row.kind}</td>
                  <td className="r num">{money(credit ? -row.amount : row.amount, row.currency, { symbol: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {r !== null && (
        <div className="flex h-9 items-center justify-between border-t border-[var(--lf-line)] px-4 text-[12px]">
          <span className="text-[var(--lf-muted)]">{r.total} entries</span>
          <Btn size="xs" variant="ghost" onClick={() => go('ledger', { account: d.account })}>
            Open register
          </Btn>
        </div>
      )}
    </aside>
  );
}

/** A clickable amount cell. */
function Amt({ v, onClick, bold = false, code }: { v: number; onClick?: (() => void) | undefined; bold?: boolean | undefined; code?: string | undefined }): React.JSX.Element {
  const text = acct(v, code);
  if (onClick === undefined || v === 0) return <span className={cn('num', bold && 'font-bold')}>{text}</span>;
  return (
    <button type="button" onClick={onClick} className={cn('num rounded-[3px] px-0.5 hover:bg-[var(--lf-accent-soft)] hover:text-[var(--lf-accent-text)]', bold && 'font-bold')}>
      {text}
    </button>
  );
}

/** Rows of a report as CSV. */
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';
}

function dec(v: number): string {
  return toDecimal(v);
}

/* ---------------------------------------------------------------- P&L */

/** A chart above a report's table (not printed). */
function ChartBox({ title, aside, children }: { title: string; aside?: ReactNode | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <div className="border-b border-[var(--lf-line)] px-4 pb-3 pt-2.5 lf-no-print">
      <div className="mb-1.5 flex items-center gap-3">
        <span className="text-[12px] font-semibold text-[var(--lf-ink-2)]">{title}</span>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </div>
  );
}

function PnLChart({ r, personal }: { r: PnL; personal: boolean }): React.JSX.Element {
  const sec = (k: string): number[] => r.sections.find((s) => s.key === k)?.total ?? r.columns.map(() => 0);
  const inc = sec('income');
  const cogs = sec('cogs');
  const exp = sec('expense');
  const oi = sec('other_income');
  const oe = sec('other_expense');
  const cols = r.columns.map((c, i) => ({ c, i })).filter((x) => !x.c.compare);
  if (cols.length > 1) {
    return (
      <ChartBox
        title="Money in and out"
        aside={
          <Legend
            series={[
              { key: 'in', label: 'Income', color: 'var(--lf-pos)' },
              { key: 'out', label: 'Costs', color: 'var(--lf-neg)' },
              { key: 'net', label: personal ? 'Saved' : 'Net profit', color: 'var(--lf-ink)' },
            ]}
          />
        }
      >
        <BarChart
          height={210}
          currency={r.currency}
          groups={cols.map(({ c, i }) => ({ label: c.label.length === 7 ? monthName(c.label).slice(0, 3) : c.label.replace(' Q', ''), title: day(c.from) + ' – ' + day(c.to), values: { in: (inc[i] ?? 0) + (oi[i] ?? 0), out: (cogs[i] ?? 0) + (exp[i] ?? 0) + (oe[i] ?? 0), net: r.net[i] ?? 0 } }))}
          series={[
            { key: 'in', label: 'Income', color: 'var(--lf-pos)' },
            { key: 'out', label: 'Costs', color: 'var(--lf-neg)' },
          ]}
          line={{ key: 'net', label: personal ? 'Saved' : 'Net profit', color: 'var(--lf-ink)' }}
        />
      </ChartBox>
    );
  }
  const steps = [
    { label: 'Income', value: inc[0] ?? 0, total: true, color: 'var(--lf-pos)' },
    ...((cogs[0] ?? 0) !== 0 ? [{ label: 'Cost of sales', value: -(cogs[0] ?? 0) }] : []),
    { label: 'Expenses', value: -(exp[0] ?? 0) },
    ...((oi[0] ?? 0) - (oe[0] ?? 0) !== 0 ? [{ label: 'Other', value: (oi[0] ?? 0) - (oe[0] ?? 0) }] : []),
    { label: personal ? 'Saved' : 'Net profit', value: r.net[0] ?? 0, total: true, color: (r.net[0] ?? 0) >= 0 ? 'var(--lf-ink)' : 'var(--lf-neg)' },
  ];
  return (
    <ChartBox title="From income to profit">
      <Waterfall steps={steps} currency={r.currency} height={190} />
    </ChartBox>
  );
}

function PnLReport({ r, onDrill }: { r: PnL; onDrill: (d: Drill) => void }): React.JSX.Element {
  const app = useApp();
  const cols = r.columns;
  const personal = app.settings?.entity === 'personal';
  const line = (label: string, values: number[], cls: string): React.JSX.Element => (
    <tr className={cls}>
      <td>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="r">
          <Amt v={v} bold />
        </td>
      ))}
    </tr>
  );
  return (
    <>
    <PnLChart r={r} personal={personal} />
    <table className="lf-table lf-report">
      <thead>
        <tr>
          <th className="min-w-[220px]">Account</th>
          {cols.map((c, i) => (
            <th key={i} className="r min-w-[110px]" title={c.from + ' – ' + c.to}>
              {cols.length > 2 && c.label.length === 7 ? monthName(c.label).slice(0, 3) + ' ' + c.label.slice(2, 4) : c.compare ? c.label : cols.length === 1 ? 'Amount' : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {r.sections.map((s) => (
          <Fragment key={s.key}>
            {s.rows.length > 0 && <SectionRows label={s.label} rows={s.rows} total={s.total} cols={cols.map((c) => ({ from: c.from, to: c.to }))} onDrill={onDrill} />}
            {s.key === 'cogs' && s.rows.length > 0 && line('Gross profit', r.gross, 'lf-sum')}
          </Fragment>
        ))}
        {line(personal ? 'Net saved' : 'Net profit', r.net, 'lf-grand')}
      </tbody>
    </table>
    </>
  );
}

function SectionRows({ label, rows, total, cols, onDrill }: { label: string; rows: { account: string; code: string; name: string; values: number[]; computed?: boolean | undefined }[]; total: number[]; cols: { from?: string | undefined; to: string }[]; onDrill: (d: Drill) => void }): React.JSX.Element {
  return (
    <>
      <tr className="lf-sec">
        <td colSpan={cols.length + 1}>{label}</td>
      </tr>
      {rows.map((row) => (
        <tr key={row.account || row.name}>
          <td className="max-w-0 truncate pl-5">
            {row.code !== '' && <span className="num mr-2 text-[11px] text-[var(--lf-muted)]">{row.code}</span>}
            {row.name}
          </td>
          {row.values.map((v, i) => (
            <td key={i} className="r">
              <Amt v={v} onClick={row.account !== '' ? () => onDrill({ account: row.account, from: cols[i]?.from, to: cols[i]?.to ?? '', label: row.name }) : undefined} />
            </td>
          ))}
        </tr>
      ))}
      <tr className="lf-sum">
        <td>Total {label.toLowerCase()}</td>
        {total.map((v, i) => (
          <td key={i} className="r">
            <Amt v={v} bold />
          </td>
        ))}
      </tr>
    </>
  );
}

/* ---------------------------------------------------------- balance */

function BalanceReport({ r, onDrill }: { r: Balance; onDrill: (d: Drill) => void }): React.JSX.Element {
  const cols = r.columns.map((c) => ({ to: c.to }));
  const sides: { side: string; label: string; total: number[] }[] = [
    { side: 'assets', label: 'Assets', total: r.assets },
    { side: 'liabilities', label: 'Liabilities', total: r.liabilities },
    { side: 'equity', label: 'Equity', total: r.equity },
  ];
  return (
    <>
      {!r.balanced.every(Boolean) && <p className="mx-3 my-2 rounded-[5px] bg-[var(--lf-neg-soft)] px-2.5 py-2 text-[12.5px] text-[var(--lf-neg-text)]">Assets do not equal liabilities plus equity. Check for entries posted in other currencies without a rate.</p>}
      <ChartBox title="What you own, and who it belongs to">
        {(() => {
          const rowsOf = (side: string, color: string): { label: string; value: number; color: string }[] =>
            r.groups
              .filter((g) => g.side === side)
              .flatMap((g) => g.rows)
              .map((x) => ({ label: x.name, value: x.values[0] ?? 0, color }))
              .filter((x) => x.value > 0);
          const top = (list: { label: string; value: number; color: string }[], n: number, color: string): { label: string; value: number; color: string }[] => {
            const sorted = [...list].sort((a, b) => b.value - a.value);
            const rest = sorted.slice(n).reduce((t, x) => t + x.value, 0);
            return rest > 0 ? [...sorted.slice(0, n), { label: 'Everything else', value: rest, color }] : sorted.slice(0, n);
          };
          const assets = top(rowsOf('assets', 'var(--lf-c1)'), 5, 'var(--lf-c1)');
          const claims = top([...rowsOf('liabilities', 'var(--lf-neg)'), ...rowsOf('equity', 'var(--lf-ink-2)')], 5, 'var(--lf-line)');
          return (
            <div className="grid grid-cols-1 gap-x-10 gap-y-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 flex justify-between text-[11.5px] font-semibold text-[var(--lf-muted)]">
                  <span>Assets</span>
                  <span className="num text-[var(--lf-ink)]">{money(r.assets[0] ?? 0, r.currency)}</span>
                </p>
                <HBars items={assets} currency={r.currency} labelWidth={150} valueWidth={100} />
              </div>
              <div>
                <p className="mb-1 flex justify-between text-[11.5px] font-semibold text-[var(--lf-muted)]">
                  <span className="flex items-center gap-3">
                    Liabilities and equity
                    <Legend
                      series={[
                        { key: 'l', label: 'Owed', color: 'var(--lf-neg)' },
                        { key: 'e', label: 'Equity', color: 'var(--lf-ink-2)' },
                      ]}
                    />
                  </span>
                  <span className="num text-[var(--lf-ink)]">{money((r.liabilities[0] ?? 0) + (r.equity[0] ?? 0), r.currency)}</span>
                </p>
                <HBars items={claims} currency={r.currency} labelWidth={150} valueWidth={100} />
              </div>
            </div>
          );
        })()}
      </ChartBox>
      <table className="lf-table lf-report">
        <thead>
          <tr>
            <th className="min-w-[220px]">Account</th>
            {r.columns.map((c, i) => (
              <th key={i} className="r min-w-[120px]">
                {c.compare ? c.label : 'As of ' + day(c.to)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sides.map((s) => (
            <BalanceSide key={s.side} label={s.label} groups={r.groups.filter((g) => g.side === s.side)} total={s.total} cols={cols} onDrill={onDrill} />
          ))}
          <tr className="lf-grand">
            <td>Liabilities and equity</td>
            {r.columns.map((_, i) => (
              <td key={i} className="r">
                <Amt v={(r.liabilities[i] ?? 0) + (r.equity[i] ?? 0)} bold />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BalanceSide({ label, groups, total, cols, onDrill }: { label: string; groups: Balance['groups']; total: number[]; cols: { to: string }[]; onDrill: (d: Drill) => void }): React.JSX.Element {
  return (
    <>
      <tr className="lf-sec">
        <td colSpan={cols.length + 1} className="text-[13px]">
          {label}
        </td>
      </tr>
      {groups.filter((g) => g.rows.length > 0).length === 1
        ? groups
            .filter((g) => g.rows.length > 0)
            .flatMap((g) => g.rows)
            .map((row) => (
              <tr key={row.account || row.name}>
                <td className="max-w-0 truncate pl-5">
                  {row.code !== '' && <span className="num mr-2 text-[11px] text-[var(--lf-muted)]">{row.code}</span>}
                  {row.name}
                </td>
                {row.values.map((v, i) => (
                  <td key={i} className="r">
                    <Amt v={v} onClick={row.account !== '' ? () => onDrill({ account: row.account, to: cols[i]?.to ?? '', label: row.name }) : undefined} />
                  </td>
                ))}
              </tr>
            ))
        : groups.map((g) =>
            g.rows.length === 0 ? null : (
              <SectionRows key={g.key} label={g.label} rows={g.rows} total={g.total} cols={cols.map((c) => ({ to: c.to }))} onDrill={(d) => onDrill({ ...d, from: undefined })} />
            ),
          )}
      <tr className="lf-sum">
        <td>Total {label.toLowerCase()}</td>
        {total.map((v, i) => (
          <td key={i} className="r">
            <Amt v={v} bold />
          </td>
        ))}
      </tr>
    </>
  );
}

/* --------------------------------------------------------- cash flow */

function CashFlowReport({ r, onDrill }: { r: CashFlow; onDrill: (d: Drill) => void }): React.JSX.Element {
  return (
    <>
    <ChartBox title="How cash moved">
      <Waterfall
        height={190}
        currency={r.currency}
        steps={[
          { label: 'Start', value: r.opening, total: true },
          ...r.classes.filter((c) => c.key === 'operating' || c.total !== 0).map((c) => ({ label: c.label.replace(' activities', ''), value: c.total })),
          { label: 'End', value: r.closing, total: true },
        ]}
      />
    </ChartBox>
    <table className="lf-table lf-report">
      <thead>
        <tr>
          <th>Activity</th>
          <th className="r w-[140px]">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr className="lf-sum">
          <td>Cash at the start</td>
          <td className="r">
            <Amt v={r.opening} bold />
          </td>
        </tr>
        {r.classes.map((c) => (
          <SectionRows key={c.key} label={c.label} rows={c.rows.map((x) => ({ ...x, values: [x.value] }))} total={[c.total]} cols={[{ from: r.from, to: r.to }]} onDrill={onDrill} />
        ))}
        <tr className="lf-sum">
          <td>Net change in cash</td>
          <td className="r">
            <Amt v={r.net} bold />
          </td>
        </tr>
        <tr className="lf-grand">
          <td>Cash at the end</td>
          <td className="r">
            <Amt v={r.closing} bold />
          </td>
        </tr>
      </tbody>
    </table>
    </>
  );
}

/* ------------------------------------------------------------- trial */

function TrialReport({ r, onDrill }: { r: Trial; onDrill: (d: Drill) => void }): React.JSX.Element {
  return (
    <table className="lf-table lf-report">
      <thead>
        <tr>
          <th className="w-[70px]">Code</th>
          <th>Account</th>
          <th className="r w-[130px]">Debit</th>
          <th className="r w-[130px]">Credit</th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((x) => (
          <tr key={x.account || x.name}>
            <td className="num text-[var(--lf-muted)]">{x.code}</td>
            <td>{x.name}</td>
            <td className="r">{x.debit > 0 && <Amt v={x.debit} onClick={x.account ? () => onDrill({ account: x.account, to: r.to, label: x.name }) : undefined} />}</td>
            <td className="r">{x.credit > 0 && <Amt v={x.credit} onClick={x.account ? () => onDrill({ account: x.account, to: r.to, label: x.name }) : undefined} />}</td>
          </tr>
        ))}
        <tr className="lf-grand">
          <td />
          <td>Totals {r.balanced ? '' : '(not balanced)'}</td>
          <td className="r">
            <Amt v={r.debit} bold />
          </td>
          <td className="r">
            <Amt v={r.credit} bold />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------- aged */

const BUCKET_LABEL: Record<string, string> = { current: 'Current', '1_30': '1–30', '31_60': '31–60', '61_90': '61–90', '90_plus': '90+' };

function AgedReport({ r }: { r: Aged }): React.JSX.Element {
  const [open, setOpen] = useState<string>('');
  const side = r.side === 'receivables' ? 'sales' : 'purchases';
  const max = Math.max(1, ...r.buckets.map((b) => r.totals[b] ?? 0));
  const total = r.totals['total'] ?? 0;
  return (
    <>
    {total !== 0 && (
      <table className="w-full border-b border-[var(--lf-line)] lf-no-print" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col />
          {r.buckets.map((b) => (
            <col key={b} className="w-[110px]" />
          ))}
          <col className="w-[120px]" />
        </colgroup>
        <tbody>
          <tr>
            <td className="px-[10px] pb-2.5 pt-3 align-bottom">
              <p className="text-[12px] font-semibold text-[var(--lf-ink-2)]">{r.side === 'receivables' ? 'What customers owe, by age' : 'What you owe, by age'}</p>
              <p className="num text-[18px] font-bold leading-6">{money(total, r.currency)}</p>
            </td>
            {r.buckets.map((b, i) => {
              const v = r.totals[b] ?? 0;
              const color = AGE_BUCKETS.find((x) => x.key === b)?.color ?? 'var(--lf-line)';
              return (
                <td key={b} className="px-[10px] pb-2.5 pt-3 align-bottom">
                  <div className="flex h-[66px] flex-col items-end justify-end gap-1">
                    <span className={cn('num text-[11px]', v > 0 ? 'font-semibold' : 'text-[var(--lf-muted)]')}>{v > 0 ? Math.round((v / total) * 100) + '%' : '–'}</span>
                    <span className="lf-grow-y block w-full max-w-[56px] rounded-t-[3px]" style={{ height: v > 0 ? Math.max(3, (v / max) * 44) : 2, background: v > 0 ? color : 'var(--lf-line)', animationDelay: `${i * 60}ms` }} />
                  </div>
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
      </table>
    )}
    <table className="lf-table lf-report">
      <thead>
        <tr>
          <th>{r.side === 'receivables' ? 'Customer' : 'Supplier'}</th>
          {r.buckets.map((b) => (
            <th key={b} className="r w-[110px]">
              {BUCKET_LABEL[b]}
            </th>
          ))}
          <th className="r w-[120px]">Total</th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((x) => (
          <AgedRow key={x.contact} x={x} buckets={r.buckets} open={open === x.contact} onToggle={() => setOpen(open === x.contact ? '' : x.contact)} side={side} />
        ))}
        <tr className="lf-grand">
          <td>Total</td>
          {r.buckets.map((b) => (
            <td key={b} className="r">
              <Amt v={r.totals[b] ?? 0} bold />
            </td>
          ))}
          <td className="r">
            <Amt v={r.totals['total'] ?? 0} bold />
          </td>
        </tr>
      </tbody>
    </table>
    </>
  );
}

function AgedRow({ x, buckets, open, onToggle, side }: { x: Aged['rows'][number]; buckets: string[]; open: boolean; onToggle: () => void; side: 'sales' | 'purchases' }): React.JSX.Element {
  return (
    <>
      <tr data-click="true" onClick={onToggle}>
        <td className="font-semibold">{x.name}</td>
        {buckets.map((b) => (
          <td key={b} className={cn('r', b !== 'current' && (x as unknown as Record<string, number>)[b]! > 0 && 'text-[var(--lf-neg-text)]')}>
            <Amt v={(x as unknown as Record<string, number>)[b] ?? 0} />
          </td>
        ))}
        <td className="r">
          <Amt v={x.total} bold />
        </td>
      </tr>
      {open &&
        x.docs.map((d) => (
          <tr key={d.id} data-click="true" onClick={() => go(side, { doc: d.id })}>
            <td className="pl-6 text-[12px] text-[var(--lf-ink-2)]">
              {d.number} · due {day(d.due_date, true)}
              {d.days > 0 ? ' · ' + d.days + ' days late' : ''}
            </td>
            {buckets.map((b) => (
              <td key={b} className="r text-[12px]">
                {d.bucket === b ? acct(d.home) : ''}
              </td>
            ))}
            <td className="r text-[12px]">{acct(d.home)}</td>
          </tr>
        ))}
    </>
  );
}

/* --------------------------------------------------------------- tax */

function TaxReportView({ r }: { r: TaxReport }): React.JSX.Element {
  const app = useApp();
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-2 border-b border-[var(--lf-line)] sm:grid-cols-4">
        <Stat label="Tax on sales">{money(r.output_tax, app.home)}</Stat>
        <Stat label="Tax on purchases">{money(r.input_tax, app.home)}</Stat>
        <Stat label={r.net >= 0 ? 'To pay' : 'To reclaim'} tone={r.net > 0 ? 'neg' : 'pos'}>
          {money(Math.abs(r.net), app.home)}
        </Stat>
        <Stat label="Tax account balance">{money(r.control_balance, app.home)}</Stat>
      </div>
      {r.boxes !== undefined && (
        <div className="border-b border-[var(--lf-line)] px-3 py-3">
          <Heading>VAT return</Heading>
          <table className="lf-table lf-report">
            <tbody>
              {r.boxes.map((b) => (
                <tr key={b.box} className={b.box === 5 ? 'lf-sum' : ''}>
                  <td className="num w-[60px] font-bold">Box {b.box}</td>
                  <td>{b.label}</td>
                  <td className="r w-[140px]">
                    <Amt v={b.value} bold={b.box === 5} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-[var(--lf-muted)]">Figures on the invoice (accrual) basis. Check them before you file; Ledgerflow does not submit returns.</p>
        </div>
      )}
      <table className="lf-table lf-report">
        <thead>
          <tr>
            <th>Tax code</th>
            <th className="r">Rate</th>
            <th className="r">Sales net</th>
            <th className="r">Sales tax</th>
            <th className="r">Purchases net</th>
            <th className="r">Purchases tax</th>
          </tr>
        </thead>
        <tbody>
          {r.codes.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="font-semibold">{c.code}</span> <span className="text-[12px] text-[var(--lf-muted)]">{c.name}</span>
              </td>
              <td className="r num">{c.rate}%</td>
              <td className="r">
                <Amt v={c.sales_base} />
              </td>
              <td className="r">
                <Amt v={c.sales_tax} />
              </td>
              <td className="r">
                <Amt v={c.purchase_base} />
              </td>
              <td className="r">
                <Amt v={c.purchase_tax} />
              </td>
            </tr>
          ))}
          {r.codes.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-[var(--lf-muted)]">
                No taxed entries in this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ budget */

function BudgetView({ r }: { r: BudgetReport }): React.JSX.Element {
  const app = useApp();
  const [edit, setEdit] = useState<{ account: string; name: string } | null>(null);
  const [mode, setMode] = useState<'monthly' | 'annual'>('monthly');
  const [val, setVal] = useState('');
  const [addAccount, setAddAccount] = useState('');
  const rows = r.rows;
  const unbudgeted = app.accounts.filter((a) => (a.type === 'expense' || a.type === 'income') && !rows.some((x) => x.account === a.id && x.has_budget));
  return (
    <>
      <table className="lf-table lf-report">
        <thead>
          <tr>
            <th>Account</th>
            <th className="r w-[120px]">Budget</th>
            <th className="r w-[120px]">Actual</th>
            <th className="r w-[120px]">Left</th>
            <th className="w-[160px]">Used</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const used = x.budget_total > 0 ? x.actual_total / x.budget_total : 0;
            return (
              <tr key={x.account}>
                <td>
                  <span className="num mr-2 text-[11px] text-[var(--lf-muted)]">{x.code}</span>
                  {x.name}
                </td>
                <td className="r">{x.has_budget ? <Amt v={x.budget_total} /> : <span className="text-[var(--lf-muted)]">–</span>}</td>
                <td className="r">
                  <Amt v={x.actual_total} />
                </td>
                <td className={cn('r', x.has_budget && x.variance < 0 && 'text-[var(--lf-neg-text)]')}>{x.has_budget ? <Amt v={x.variance} /> : ''}</td>
                <td>{x.has_budget && <ShareBar value={used} tone={used > 1 ? (x.type === 'expense' ? 'neg' : 'pos') : 'ink'} />}</td>
                <td>
                  <IconBtn
                    icon={Pencil}
                    label="Set budget"
                    size={22}
                    onClick={() => {
                      setEdit({ account: x.account, name: x.name });
                      setMode('monthly');
                      setVal(x.has_budget ? toDecimal(Math.round(x.budget_total / 12)) : '');
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 px-3 py-3 lf-no-print">
        <Select small label="Add a budget" value={addAccount} onChange={setAddAccount} className="w-64" options={[{ value: '', label: 'Budget another account…' }, ...unbudgeted.map((a) => ({ value: a.id, label: a.code + ' ' + a.name }))]} />
        <Btn
          size="xs"
          disabled={addAccount === ''}
          onClick={() => {
            const a = app.account(addAccount);
            if (a !== undefined) {
              setEdit({ account: a.id, name: a.name });
              setVal('');
            }
          }}
        >
          Set
        </Btn>
      </div>
      {edit !== null && (
        <Modal
          open
          width="sm"
          title={'Budget for ' + edit.name}
          description={'Fiscal year starting ' + day(r.from)}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn onClick={() => setEdit(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  const e = edit;
                  setEdit(null);
                  api
                    .setBudget(e.account, r.year, mode === 'monthly' ? { monthly: val || '0' } : { annual: val || '0' })
                    .then(() => toast.success('Budget saved'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Save
              </Btn>
            </>
          }
        >
          <div className="flex items-end gap-3">
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: 'monthly', label: 'Per month' },
                { value: 'annual', label: 'Per year' },
              ]}
            />
            <MoneyInput value={val} onChange={setVal} autoFocus className="w-36" />
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--lf-muted)]">Zero removes the budget.</p>
        </Modal>
      )}
    </>
  );
}

/* ---------------------------------------------------------- spending */

function SpendingView({ r, onDrill }: { r: Spending; onDrill: (d: Drill) => void }): React.JSX.Element {
  const app = useApp();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px]">
      <div className="xl:border-r xl:border-[var(--lf-line)]">
        <div className="flex h-9 items-center justify-between border-b border-[var(--lf-hair)] px-3">
          <span className="text-[12px] font-semibold text-[var(--lf-muted)]">By category</span>
          <span className="num text-[13px] font-bold">{money(r.total, app.home)}</span>
        </div>
        {r.categories.length > 0 && (
          <div className="flex justify-center border-b border-[var(--lf-hair)] py-4 lf-no-print">
            <Donut size={190} thickness={26} currency={app.home} center={{ label: 'Spent', value: money(r.total, app.home) }} items={r.categories.slice(0, 8).map((c, i) => ({ label: c.name, value: c.value, color: CAT(i) }))} />
          </div>
        )}
        {r.categories.map((c) => (
          <button key={c.account} type="button" onClick={() => onDrill({ account: c.account, from: r.from, to: r.to, label: c.name })} className="grid w-full grid-cols-[1fr_120px_110px] items-center gap-3 border-b border-[var(--lf-hair)] px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--lf-row)]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: r.categories.indexOf(c) < 8 ? CAT(r.categories.indexOf(c)) : 'var(--lf-line)' }} />
              <span className="truncate">{c.name}</span>
            </span>
            <ShareBar value={c.share} />
            <span className="num text-right">{money(c.value, app.home)}</span>
          </button>
        ))}
        {r.categories.length === 0 && <Empty icon={ChartColumn} title="No spending in this period" />}
      </div>
      <div>
        <div className="flex h-9 items-center border-b border-[var(--lf-hair)] px-3 text-[12px] font-semibold text-[var(--lf-muted)]">Top payees</div>
        {r.payees.map((p) => (
          <div key={p.contact} className="flex h-8 items-center gap-2 border-b border-[var(--lf-hair)] px-3 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="text-[11.5px] text-[var(--lf-muted)]">{p.count}×</span>
            <span className="num w-[100px] text-right">{money(p.value, app.home)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- net worth */

function NetWorthView({ r }: { r: NetWorth }): React.JSX.Element {
  const app = useApp();
  const pts = r.points;
  const w = 720;
  const h = 200;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.assets, p.liabilities, Math.abs(p.net))));
  const min = Math.min(0, ...pts.map((p) => p.net));
  const y = (v: number): number => h - 16 - ((v - min) / (max - min || 1)) * (h - 32);
  const x = (i: number): number => 40 + (i / Math.max(1, pts.length - 1)) * (w - 60);
  const last = pts[pts.length - 1];
  const first = pts[0];
  return (
    <div>
      {last !== undefined && first !== undefined && (
        <div className="grid grid-cols-3 border-b border-[var(--lf-line)]">
          <Stat label="Assets">{money(last.assets, app.home)}</Stat>
          <Stat label="Liabilities">{money(last.liabilities, app.home)}</Stat>
          <Stat label={'Net worth (' + (last.net - first.net >= 0 ? '+' : '−') + compact(Math.abs(last.net - first.net), app.home) + ')'} tone={last.net >= 0 ? 'none' : 'neg'}>
            {money(last.net, app.home)}
          </Stat>
        </div>
      )}
      <div className="overflow-x-auto px-3 py-3">
        <svg viewBox={`0 0 ${w} ${h}`} className="block w-full max-w-[980px]" role="img" aria-label="Net worth by month">
          <line x1={40} x2={w - 20} y1={y(0)} y2={y(0)} stroke="var(--lf-line)" />
          {pts.map((p, i) => (
            <g key={p.date}>
              <rect x={x(i) - 7} y={y(p.assets)} width={6} height={Math.max(0, y(0) - y(p.assets))} fill="var(--lf-ink-2)" opacity={0.28} />
              <rect x={x(i) + 1} y={y(p.liabilities)} width={6} height={Math.max(0, y(0) - y(p.liabilities))} fill="var(--lf-neg)" opacity={0.55} />
              <text x={x(i)} y={h - 2} fontSize="10" textAnchor="middle" fill="var(--lf-muted)">
                {monthName(p.date.slice(0, 7)).slice(0, 3)}
              </text>
            </g>
          ))}
          <polyline points={pts.map((p, i) => `${x(i)},${y(p.net)}`).join(' ')} fill="none" stroke="var(--lf-accent)" strokeWidth={2} />
          {pts.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={y(p.net)} r={2.5} fill="var(--lf-accent)">
              <title>{day(p.date) + ': ' + money(p.net, app.home)}</title>
            </circle>
          ))}
        </svg>
        <p className="mt-1 flex items-center gap-3 text-[11.5px] text-[var(--lf-muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-[var(--lf-ink-2)] opacity-30" /> Assets
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-[var(--lf-neg)] opacity-60" /> Liabilities
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-[var(--lf-accent)]" /> Net worth
          </span>
        </p>
      </div>
      <table className="lf-table lf-report">
        <thead>
          <tr>
            <th>Month end</th>
            <th className="r">Assets</th>
            <th className="r">Liabilities</th>
            <th className="r">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {[...pts].reverse().map((p) => (
            <tr key={p.date}>
              <td className="num">{day(p.date)}</td>
              <td className="r">
                <Amt v={p.assets} />
              </td>
              <td className="r">
                <Amt v={p.liabilities} />
              </td>
              <td className="r">
                <Amt v={p.net} bold />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- view */

type Data = { kind: 'pnl'; r: PnL } | { kind: 'balance'; r: Balance } | { kind: 'cashflow'; r: CashFlow } | { kind: 'trial'; r: Trial } | { kind: 'aged'; r: Aged } | { kind: 'tax'; r: TaxReport } | { kind: 'budget'; r: BudgetReport } | { kind: 'spending'; r: Spending } | { kind: 'networth'; r: NetWorth };

export function ReportsView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const id = (LIST.some((x) => x.id === q['r']) ? q['r'] : 'pnl') as ReportId;
  const [range, setRange] = useState(id === 'tax' ? 'last_quarter' : 'this_month');
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const [by, setBy] = useState<'total' | 'month' | 'quarter'>('total');
  const [compare, setCompare] = useState('none');
  const [year, setYear] = useState(0);
  const [months, setMonths] = useState(12);
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => setDrill(null), [id]);
  useEffect(() => {
    if (id === 'tax') setRange('last_quarter');
  }, [id]);

  const params = useMemo<Record<string, unknown>>(() => {
    const span = range === 'custom' ? { from, to } : { range };
    if (id === 'pnl') return { ...span, basis, by, compare };
    if (id === 'balance') return { to: asOf, compare };
    if (id === 'trial') return { to: asOf };
    if (id === 'ar' || id === 'ap') return { side: id === 'ar' ? 'receivables' : 'payables', to: asOf };
    if (id === 'budget') return { year: year || undefined };
    if (id === 'networth') return { months };
    return span;
  }, [id, range, from, to, basis, by, compare, asOf, year, months]);

  const live = useLive<Data>(
    async () => {
      if (id === 'pnl') return { kind: 'pnl', r: await api.pnl(params) };
      if (id === 'balance') return { kind: 'balance', r: await api.balance(params) };
      if (id === 'cashflow') return { kind: 'cashflow', r: await api.cashflow(params) };
      if (id === 'trial') return { kind: 'trial', r: await api.trial(params) };
      if (id === 'ar' || id === 'ap') return { kind: 'aged', r: await api.aged(params) };
      if (id === 'tax') return { kind: 'tax', r: await api.taxReport(params) };
      if (id === 'budget') return { kind: 'budget', r: await api.budget(year || undefined) };
      if (id === 'spending') return { kind: 'spending', r: await api.spending(params) };
      return { kind: 'networth', r: await api.networth(months) };
    },
    ['postings', 'transactions', 'budgets', 'documents', 'allocations'],
    [id, JSON.stringify(params)],
    500,
  );
  useReportScreen('reports', { type: 'report', id }, params);

  const meta = LIST.find((x) => x.id === id)!;
  const d = live.data;
  const period = (): string => {
    if (d === null) return '';
    const r = d.r as { from?: string | undefined; to?: string | undefined };
    if (r.from && r.to) return day(r.from) + ' – ' + day(r.to);
    if (r.to) return 'As of ' + day(r.to);
    return '';
  };

  const exportCsv = (): void => {
    if (d === null) return;
    const rows: (string | number)[][] = [];
    if (d.kind === 'pnl') {
      rows.push(['Section', 'Code', 'Account', ...d.r.columns.map((c) => c.label)]);
      for (const s of d.r.sections) for (const x of s.rows) rows.push([s.label, x.code, x.name, ...x.values.map(dec)]);
      rows.push(['', '', 'Net', ...d.r.net.map(dec)]);
    } else if (d.kind === 'balance') {
      rows.push(['Group', 'Code', 'Account', ...d.r.columns.map((c) => c.label)]);
      for (const g of d.r.groups) for (const x of g.rows) rows.push([g.label, x.code, x.name, ...x.values.map(dec)]);
    } else if (d.kind === 'trial') {
      rows.push(['Code', 'Account', 'Debit', 'Credit']);
      for (const x of d.r.rows) rows.push([x.code, x.name, dec(x.debit), dec(x.credit)]);
    } else if (d.kind === 'cashflow') {
      rows.push(['Activity', 'Code', 'Account', 'Amount']);
      for (const c of d.r.classes) for (const x of c.rows) rows.push([c.label, x.code, x.name, dec(x.value)]);
    } else if (d.kind === 'aged') {
      rows.push(['Contact', ...d.r.buckets.map((b) => BUCKET_LABEL[b] ?? b), 'Total']);
      for (const x of d.r.rows) rows.push([x.name, ...d.r.buckets.map((b) => dec((x as unknown as Record<string, number>)[b] ?? 0)), dec(x.total)]);
    } else if (d.kind === 'tax') {
      rows.push(['Code', 'Rate', 'Sales net', 'Sales tax', 'Purchases net', 'Purchases tax']);
      for (const c of d.r.codes) rows.push([c.code, c.rate, dec(c.sales_base), dec(c.sales_tax), dec(c.purchase_base), dec(c.purchase_tax)]);
    } else if (d.kind === 'budget') {
      rows.push(['Code', 'Account', 'Budget', 'Actual', 'Left']);
      for (const x of d.r.rows) rows.push([x.code, x.name, dec(x.budget_total), dec(x.actual_total), dec(x.variance)]);
    } else if (d.kind === 'spending') {
      rows.push(['Code', 'Category', 'Amount', 'Share']);
      for (const c of d.r.categories) rows.push([c.code, c.name, dec(c.value), (c.share * 100).toFixed(1) + '%']);
    } else {
      rows.push(['Month end', 'Assets', 'Liabilities', 'Net worth']);
      for (const p of d.r.points) rows.push([p.date, dec(p.assets), dec(p.liabilities), dec(p.net)]);
    }
    downloadBlob(meta.label.toLowerCase().replace(/\s+/g, '-') + '-' + today() + '.csv', new Blob([toCsv(rows)], { type: 'text/csv' }));
  };

  const explain = (): void => {
    api
      .explain(id === 'ar' || id === 'ap' ? 'aged' : id, params)
      .then((r) => toast.success(r.asked ? 'Your AI agent is reading the report; the answer appears under Ask AI' : 'Queued for your AI agent'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };

  const ranged = id === 'pnl' || id === 'cashflow' || id === 'tax' || id === 'spending';
  const asof = id === 'balance' || id === 'trial' || id === 'ar' || id === 'ap';
  const groups = [...new Set(LIST.map((x) => x.group))];
  const entity = app.settings?.entity ?? 'both';
  const fyStartYear = (() => {
    const fy = app.settings?.fiscal_year_start ?? 1;
    const t = today();
    return Number(t.slice(5, 7)) < fy ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4));
  })();

  let body: ReactNode = null;
  if (d !== null) {
    if (d.kind === 'pnl') body = <PnLReport r={d.r} onDrill={setDrill} />;
    else if (d.kind === 'balance') body = <BalanceReport r={d.r} onDrill={setDrill} />;
    else if (d.kind === 'cashflow') body = <CashFlowReport r={d.r} onDrill={setDrill} />;
    else if (d.kind === 'trial') body = <TrialReport r={d.r} onDrill={setDrill} />;
    else if (d.kind === 'aged') body = <AgedReport r={d.r} />;
    else if (d.kind === 'tax') body = <TaxReportView r={d.r} />;
    else if (d.kind === 'budget') body = <BudgetView r={d.r} />;
    else if (d.kind === 'spending') body = <SpendingView r={d.r} onDrill={setDrill} />;
    else body = <NetWorthView r={d.r} />;
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-[var(--lf-line)] py-1 md:block">
        {groups.map((g) => (
          <div key={g} className="mb-1">
            <p className="px-3 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--lf-muted)]">{g}</p>
            {LIST.filter((x) => x.group === g && !(entity === 'personal' && x.business)).map((x) => (
              <button key={x.id} type="button" onClick={() => setQuery({ r: x.id }, false)} className={cn('relative flex h-7 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors', x.id === id ? 'bg-[var(--lf-row-hover)] font-semibold' : 'hover:bg-[var(--lf-row)]')}>
                {x.id === id && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
                <x.icon size={14} strokeWidth={2} className={cn('shrink-0', x.id === id ? 'text-[var(--lf-ink)]' : 'text-[var(--lf-muted)]')} />
                {x.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--lf-line)] px-3 py-1.5 lf-no-print">
          <Select small label="Report" value={id} onChange={(v) => setQuery({ r: v }, false)} className="w-40 md:hidden" options={LIST.map((x) => ({ value: x.id, label: x.label }))} />
          <p className="hidden text-[13.5px] font-bold md:block">{meta.label}</p>
          <span className="text-[12px] text-[var(--lf-muted)]">{period()}</span>
          <span className="flex-1" />
          {ranged && <Select small label="Period" value={range} onChange={setRange} options={RANGES} className="w-36" />}
          {ranged && range === 'custom' && (
            <>
              <DateInput value={from} onChange={setFrom} className="h-6 w-[130px] text-[12px]" />
              <DateInput value={to} onChange={setTo} className="h-6 w-[130px] text-[12px]" />
            </>
          )}
          {asof && <DateInput value={asOf} onChange={setAsOf} className="h-6 w-[130px] text-[12px]" label="As of" />}
          {id === 'pnl' && (
            <>
              <Seg
                size="xs"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: 'accrual', label: 'Accrual', title: 'Income when invoiced, costs when billed' },
                  { value: 'cash', label: 'Cash', title: 'Income when paid, costs when paid' },
                ]}
              />
              <Seg
                size="xs"
                value={by}
                onChange={setBy}
                options={[
                  { value: 'total', label: 'Total' },
                  { value: 'month', label: 'Months' },
                  { value: 'quarter', label: 'Quarters' },
                ]}
              />
            </>
          )}
          {(id === 'pnl' || id === 'balance') && (
            <Select
              small
              label="Compare"
              value={compare}
              onChange={setCompare}
              className="w-36"
              options={[
                { value: 'none', label: 'No comparison' },
                { value: 'previous_period', label: id === 'balance' ? 'A month earlier' : 'Previous period' },
                { value: 'previous_year', label: 'Previous year' },
              ]}
            />
          )}
          {id === 'budget' && <Select small label="Fiscal year" value={String(year || fyStartYear)} onChange={(v) => setYear(Number(v))} className="w-28" options={[fyStartYear + 1, fyStartYear, fyStartYear - 1, fyStartYear - 2].map((y) => ({ value: String(y), label: 'FY ' + y }))} />}
          {id === 'networth' && <Select small label="Months" value={String(months)} onChange={(v) => setMonths(Number(v))} className="w-28" options={[6, 12, 24, 36].map((m) => ({ value: String(m), label: m + ' months' }))} />}
          <span className="mx-0.5 h-5 w-px bg-[var(--lf-hair)]" />
          <IconBtn icon={Download} label="Export CSV" onClick={exportCsv} />
          <IconBtn icon={Printer} label="Print or save as PDF" onClick={() => window.print()} />
          <Btn size="xs" icon={Sparkles} className="bg-[var(--lf-accent-soft)] text-[var(--lf-accent-text)]" variant="soft" onClick={explain}>
            Explain
          </Btn>
        </div>
        <div className="lf-print min-h-0 flex-1 overflow-auto">
          <div className="lf-print-only mb-3">
            <p className="text-[16px] font-bold">{meta.label}</p>
            <p className="text-[12px]">
              {app.settings?.business_name} · {period()} · {app.home}
              {id === 'pnl' && basis === 'cash' ? ' · cash basis' : ''}
            </p>
          </div>
          {d === null ? (
            live.error !== null ? (
              <Empty icon={ChartColumn} title="Could not build the report">
                {live.error}
              </Empty>
            ) : (
              <div className="flex h-24 items-center justify-center">
                <Spinner />
              </div>
            )
          ) : (
            <div className={cn(live.loading && 'opacity-60 transition-opacity')}>{body}</div>
          )}
          {d !== null && d.kind === 'pnl' && d.r.basis === 'cash' && <p className="px-3 py-2 text-[11.5px] text-[var(--lf-muted)]">Cash basis: invoices and bills count when paid, in proportion to the payment.</p>}
          {d !== null && d.kind === 'cashflow' && !d.r.reconciles && <Chip tone="warn" className="m-3">Opening plus movements does not equal closing cash</Chip>}
        </div>
      </section>
      {drill !== null && <DrillPanel d={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

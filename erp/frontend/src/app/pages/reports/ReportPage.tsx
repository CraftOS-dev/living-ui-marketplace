/**
 * One report, any kind (?kind=pnl, balance-sheet, cash-flow, trial-balance,
 * ledger, aging, sales, purchases, stock, tax, budget, projects, payroll):
 * the period or day, a comparison or grouping where it has one, a chart,
 * then the statement with drill-down. Export as CSV, or print.
 */
import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { PeriodBar } from '../../components/books/PeriodBar.tsx';
import { rangeLabel, rangeOf } from '../../components/books/period.ts';
import type { Preset } from '../../components/books/period.ts';
import { Segmented } from '../../components/controls.tsx';
import { DateField } from '../../components/pickers.tsx';
import { reportDef } from '../../components/reports/catalog.ts';
import type { ReportKind } from '../../components/reports/catalog.ts';
import { AgingBody, BalanceSheetBody, BudgetBody, CashFlowBody, LedgerBody, PayrollBody, PnlBody, ProjectsBody, SalesBody, StockBody, TaxBody, TrialBalanceBody } from '../../components/reports/kinds.tsx';
import { asAt } from '../../components/reports/kinds.tsx';
import type { KindProps, ReportParams } from '../../components/reports/kinds.tsx';
import { CircleButton, PageHeader, PillButton, PillSelect } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import { back, replaceQuery } from '../../lib/router.ts';
import type { Query } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';

const YEAR_DEFAULT: ReportKind[] = ['pnl', 'cash-flow', 'sales', 'purchases', 'tax'];

export function ReportPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const currency = baseCurrency(me);
  const fiscal = me.company.fiscal_start_month >= 1 ? me.company.fiscal_start_month : 1;
  const sideQ = query.get('side');
  const def = reportDef(query.get('kind') ?? 'pnl', sideQ) ?? reportDef('pnl');
  const kind: ReportKind = def?.kind ?? 'pnl';
  const preset: Preset = YEAR_DEFAULT.includes(kind) ? 'this_year' : 'this_month';
  const dflt = rangeOf(preset, fiscal);
  const fy = (d: string): number => (Number(d.slice(5, 7)) >= fiscal ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
  const p: ReportParams = {
    from: query.get('from') ?? dflt.from,
    to: query.get('to') ?? dflt.to,
    date: query.get('date') ?? today(),
    compare: query.get('compare') ?? 'none',
    by: query.get('by') ?? def?.by?.[0]?.value ?? '',
    side: sideQ === 'payable' ? 'payable' : 'receivable',
    year: Number(query.get('year')) > 1970 ? Number(query.get('year')) : fy(today()),
  };
  const csv = useRef<(() => string) | null>(null);
  const onCsv = useCallback((fn: (() => string) | null) => {
    csv.current = fn;
  }, []);
  const [exporting, setExporting] = useState(false);

  const set = (patch: Partial<Record<keyof ReportParams, string | undefined>>): void => {
    const q: Query = { kind };
    for (const k of ['from', 'to', 'date', 'compare', 'by', 'side', 'year'] as const) {
      const v = patch[k] ?? query.get(k) ?? undefined;
      if (v !== undefined && v !== '') q[k] = v;
    }
    replaceQuery('report', q);
  };
  const setRange = (from: string, to: string): void => set({ from, to });

  const period = def?.range === 'period' ? rangeLabel(p.from, p.to) : def?.range === 'date' ? asAt(p.date) : def?.range === 'year' ? `Year from ${p.year}` : '';

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      if (def?.serverCsv === true) {
        const r = await op<{ filename: string; csv: string }>('reports.export', {
          report: kind,
          from: def.range === 'period' ? p.from : undefined,
          to: def.range === 'period' ? p.to : undefined,
          date: def.range === 'date' ? p.date : undefined,
          compare: def.compare !== undefined ? p.compare : undefined,
          by: def.by !== undefined ? p.by : undefined,
          side: kind === 'aging' ? p.side : undefined,
        });
        saveText(r.csv, r.filename);
      } else if (csv.current !== null) {
        saveText(csv.current(), `${kind}-${today()}.csv`);
      } else toast.error('The report is still loading');
    } catch {
      /* shown */
    } finally {
      setExporting(false);
    }
  };

  const printHead = (
    <div className="erp-print-only mb-6">
      <p className="text-[13px]">{me.company.name}</p>
      <h1 className="text-[26px] font-bold">{def?.title}</h1>
      <p className="text-[13px]">
        {period}
        {period !== '' ? ', ' : ''}in {currency}. Printed {dayLabel(today())}.
      </p>
    </div>
  );
  const props: KindProps = { p, currency, printHead, onCsv, setRange };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('reports')}
        eyebrow={
          <>
            <span>Reports</span>
            {def?.term !== undefined && <span>{def.term}</span>}
          </>
        }
        title={def?.title ?? 'Report'}
        subtitle={def?.desc}
        actions={
          <>
            <PillButton variant="light" icon={Printer} onClick={() => window.print()}>
              Print
            </PillButton>
            <PillButton variant="light" icon={Download} loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </PillButton>
          </>
        }
      />

      <div className="erp-no-print flex flex-col gap-3 @min-[1100px]:flex-row @min-[1100px]:items-center @min-[1100px]:justify-between">
        {def?.range === 'period' && <PeriodBar key={kind} from={p.from} to={p.to} fiscalStart={fiscal} onChange={setRange} />}
        {def?.range === 'date' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--erp-ink-2)]">On</span>
            <DateField value={p.date} onChange={(d) => set({ date: d === '' ? today() : d })} ariaLabel="On" max={today()} className="w-48 [&>button]:bg-[var(--erp-card)]" />
          </div>
        )}
        {def?.range === 'year' && (
          <div className="inline-flex h-11 items-center gap-1 self-start rounded-full bg-[var(--erp-card)] p-1" role="group" aria-label="Year">
            <CircleButton icon={ChevronLeft} label="Previous year" variant="ghost" size={36} onClick={() => set({ year: String(p.year - 1) })} />
            <span className="num min-w-[6rem] text-center text-[14px] font-bold">{fiscal === 1 ? p.year : `${p.year} to ${p.year + 1}`}</span>
            <CircleButton icon={ChevronRight} label="Next year" variant="ghost" size={36} onClick={() => set({ year: String(p.year + 1) })} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'aging' && (
            <Segmented
              ariaLabel="Side"
              onShell
              value={p.side}
              onChange={(v) => set({ side: v })}
              options={[
                { value: 'receivable', label: 'Owed to you' },
                { value: 'payable', label: 'You owe' },
              ]}
            />
          )}
          {def?.by !== undefined && (
            <Segmented ariaLabel="Group by" onShell value={p.by} onChange={(v) => set({ by: v, compare: v === 'month' ? 'none' : undefined })} options={def.by.map((b) => ({ value: b.value, label: b.label }))} />
          )}
          {def?.compare !== undefined && !(kind === 'pnl' && p.by === 'month') && (
            <PillSelect ariaLabel="Compare with" value={p.compare} onChange={(v) => set({ compare: v })} options={def.compare.map((c) => ({ value: c.value, label: c.value === 'none' ? 'No comparison' : `Compare with ${c.label.toLowerCase()}` }))} className="w-full @min-[480px]:w-64" />
          )}
        </div>
      </div>

      {kind === 'pnl' && <PnlBody {...props} />}
      {kind === 'balance-sheet' && <BalanceSheetBody {...props} />}
      {kind === 'cash-flow' && <CashFlowBody {...props} />}
      {kind === 'trial-balance' && <TrialBalanceBody {...props} />}
      {kind === 'ledger' && <LedgerBody {...props} />}
      {kind === 'aging' && <AgingBody {...props} />}
      {kind === 'sales' && <SalesBody {...props} side="sales" />}
      {kind === 'purchases' && <SalesBody {...props} side="purchases" />}
      {kind === 'stock' && <StockBody {...props} />}
      {kind === 'tax' && <TaxBody {...props} />}
      {kind === 'budget' && <BudgetBody {...props} />}
      {kind === 'projects' && <ProjectsBody {...props} />}
      {kind === 'payroll' && <PayrollBody {...props} />}
    </div>
  );
}

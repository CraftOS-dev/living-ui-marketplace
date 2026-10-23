/**
 * Reports: the questions an owner asks, as cards grouped by theme (how the
 * business is doing, where it stands, money owed, selling and buying,
 * stock and tax, people and projects). The month so far sits on top.
 */
import { ArrowUpRight, BarChart3 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { GROUPS, visibleReports } from '../../components/reports/catalog.ts';
import type { ReportDef } from '../../components/reports/catalog.ts';
import { Card, Empty, PageHeader } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { AgingReport, PnlReport } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

interface Snapshot {
  sales: number;
  net: number;
  owed: number;
  owing: number;
}

export function ReportsPage({ query }: PageProps): React.JSX.Element {
  void query;
  const me = useMe();
  const cur = baseCurrency(me);
  const reports = visibleReports(me);
  const snap = useLive(
    async (): Promise<Snapshot> => {
      const from = `${today().slice(0, 7)}-01`;
      const [pnl, rec, pay] = await Promise.all([
        op<PnlReport>('reports.pnl', { from, to: today() }, { quiet: true }),
        op<AgingReport>('reports.aging', { side: 'receivable' }, { quiet: true }),
        op<AgingReport>('reports.aging', { side: 'payable' }, { quiet: true }),
      ]);
      return { sales: pnl.sections.find((s) => s.key === 'revenue')?.totals[0] ?? 0, net: pnl.net[0] ?? 0, owed: rec.totals.total, owing: pay.totals.total };
    },
    [...READS.books, 'documents', 'allocations'],
    [],
  );
  const s = snap.data;

  const open = (r: ReportDef): void => navigate('report', { kind: r.kind, ...(r.query ?? {}) });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" subtitle="How the business is doing, in plain numbers" />

      {reports.length === 0 ? (
        <Card>
          <Empty icon={BarChart3} title="No reports for your role">
            Ask an administrator for access to reports.
          </Empty>
        </Card>
      ) : (
        <>
          <Card tone="dark" delay={1}>
            <p className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">This month so far</p>
            <div className="mt-3 grid grid-cols-2 gap-2 @min-[640px]:grid-cols-4">
              <Snap label="Sales" value={s !== null ? money(s.sales, cur) : '...'} onClick={() => navigate('report', { kind: 'pnl', from: `${today().slice(0, 7)}-01`, to: today() })} />
              <Snap label={s !== null && s.net < 0 ? 'Loss' : 'Profit'} value={s !== null ? money(s.net, cur) : '...'} bad={s !== null && s.net < 0} onClick={() => navigate('report', { kind: 'pnl', from: `${today().slice(0, 7)}-01`, to: today() })} />
              <Snap label="Owed to you" value={s !== null ? money(s.owed, cur) : '...'} onClick={() => navigate('report', { kind: 'aging', side: 'receivable' })} />
              <Snap label="You owe" value={s !== null ? money(s.owing, cur) : '...'} onClick={() => navigate('report', { kind: 'aging', side: 'payable' })} />
            </div>
          </Card>

          {GROUPS.map((g, gi) => {
            const list = reports.filter((r) => r.group === g);
            if (list.length === 0) return null;
            return (
              <section key={g} className="flex flex-col gap-3">
                <h2 className="px-1 text-[15px] font-bold">{g}</h2>
                <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-3">
                  {list.map((r, i) => {
                    const Icon = r.icon;
                    return (
                      <button
                        key={`${r.kind}-${r.query?.['side'] ?? ''}`}
                        type="button"
                        onClick={() => open(r)}
                        className={cn('erp-rise group flex items-start gap-4 rounded-[24px] bg-[var(--erp-card)] p-5 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99]', `erp-d${Math.min(5, gi + i + 1)}`)}
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)] text-[var(--erp-ink)] transition-colors group-hover:bg-[var(--erp-accent)] group-hover:text-[var(--erp-on-accent)]">
                          <Icon size={18} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[15px] font-bold">{r.title}</span>
                            <ArrowUpRight size={16} aria-hidden className="shrink-0 text-[var(--erp-muted)] group-hover:text-[var(--erp-ink)]" />
                          </span>
                          {r.term !== undefined && <span className="block text-[12px] font-semibold text-[var(--erp-muted)]">{r.term}</span>}
                          <span className="mt-1 block text-[13px] leading-5 text-[var(--erp-ink-2)]">{r.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Snap({ label, value, onClick, bad = false }: { label: string; value: string; onClick: () => void; bad?: boolean | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
      <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className={cn('num block truncate text-[15px] font-bold', bad && 'text-[var(--erp-red-on-dark)]')}>{value}</span>
    </button>
  );
}

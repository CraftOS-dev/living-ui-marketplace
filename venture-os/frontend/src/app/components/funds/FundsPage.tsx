/**
 * The Funds page: the fund's J-curve (calls below the axis, distributions
 * above, NAV as a line) and its figures, net beside gross at the same size;
 * then the tabs. The one primary action is New call (three screens, one PIN).
 */
import { useState } from 'react';
import { ArrowUpFromLine, FileSpreadsheet, Handshake, Landmark, Plus, ScrollText } from 'lucide-react';
import { Button, Empty, FigureStrip, LoadError, Menu, MenuItem, PageBody, PageHeader, Panel, Skeleton, Tabs } from '../ui.tsx';
import { BarChart, Legend } from '../charts.tsx';
import { download } from '../../lib/api.ts';
import { allowed, can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { money } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { FUND_READS, FundSwitch, major, mult, rate, shortQ, useFundId } from './common.tsx';
import type { FundDash } from './types.ts';
import { CallSheet } from './CallSheet.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { LpsTab } from './LpsTab.tsx';
import { CapitalTab, StatementImport } from './CapitalTab.tsx';
import { MarksTab } from './MarksTab.tsx';
import { ReservesTab } from './ReservesTab.tsx';
import { ReportsTab } from './ReportsTab.tsx';

type Tab = 'overview' | 'lps' | 'capital' | 'marks' | 'reserves' | 'reports';
const TABS: Tab[] = ['overview', 'lps', 'capital', 'marks', 'reserves', 'reports'];

/** The fund's chart and figures (the visual first). */
export function FundVisual({ d }: { d: FundDash }): React.JSX.Element {
  const cur = d.fund.currency;
  const m = d.metrics;
  const labels = d.jcurve.map((p) => shortQ(p.quarter));
  const fmt = (v: number): string => money(Math.round(v * 100), cur, { compact: true });
  return (
    <Panel>
      <FigureStrip
        items={[
          { label: 'TVPI', value: mult(m.tvpi_e8), tip: 'Net: distributions plus NAV over paid-in, after fees and carry.' },
          { label: 'DPI', value: mult(m.dpi_e8), tip: 'Net: distributions over paid-in.' },
          { label: 'RVPI', value: mult(m.rvpi_e8), tip: 'Net: NAV over paid-in.' },
          { label: 'Net IRR', value: rate(m.net_irr_ppm), tip: 'Net: IRR of LP flows with NAV at the end.' },
          { label: 'Gross MOIC', value: mult(m.gross_moic_e8), tip: 'Gross: proceeds plus holdings value over invested, before fees and carry.' },
        ]}
      />
      <div className="mt-5">
        <BarChart
          label="Calls, distributions and NAV by quarter"
          labels={labels}
          height={220}
          series={[
            { key: 'calls', label: 'Calls', values: d.jcurve.map((p) => major(p.calls_minor, cur)), tone: 'a' },
            { key: 'dist', label: 'Distributions', values: d.jcurve.map((p) => major(p.dist_minor, cur)), tone: 'b' },
          ]}
          lines={[{ key: 'nav', label: 'NAV', values: d.jcurve.map((p) => major(p.nav_minor, cur)), tone: 'ink' }]}
          format={(v) => fmt(v)}
          yFormat={(v) => money(Math.round(v * 100), cur, { compact: true, bare: true })}
        />
        <Legend
          className="mt-2"
          items={[
            { label: 'Calls', tone: 'a' },
            { label: 'Distributions', tone: 'b' },
            { label: 'NAV', tone: 'ink' },
          ]}
        />
      </div>
    </Panel>
  );
}

export function FundsPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { fundId, funds } = useFundId(params['fund']);
  const live = useOp<FundDash>('funds.get', { fund: fundId }, FUND_READS, { name: 'funds.get', skip: fundId === '' });
  const [flow, setFlow] = useState<'call' | 'distribution' | null>(query.get('new') === 'call' ? 'call' : null);
  const [importing, setImporting] = useState(false);
  const lpData = can(me, 'lps', 'view');
  const tabs = TABS.filter((t) => t !== 'lps' || lpData);
  const raw = (query.get('tab') ?? 'overview') as Tab;
  const tab: Tab = tabs.includes(raw) ? raw : 'overview';
  const edit = can(me, 'funds', 'edit');
  const full = can(me, 'funds', 'full');
  const d = live.data;

  const header = (
    <PageHeader title="Funds">
      {d !== null && (edit || lpData) && (
        <Menu label="More" trigger="button">
          {(close) => (
            <>
              {edit && (
                <MenuItem icon={ArrowUpFromLine} onClick={() => (close(), setFlow('distribution'))}>
                  New distribution
                </MenuItem>
              )}
              {lpData && (
                <MenuItem icon={Handshake} onClick={() => (close(), navigate('/funds/raise'))}>
                  Fund raise
                </MenuItem>
              )}
              {edit && lpData && (
                <MenuItem icon={ScrollText} onClick={() => (close(), setImporting(true))}>
                  Import statement
                </MenuItem>
              )}
              {full && lpData && (
                <MenuItem icon={FileSpreadsheet} onClick={() => (close(), void download('exports.ilpa', { fund: d.fund.id }, 'save', 'ilpa.csv'))}>
                  ILPA export
                </MenuItem>
              )}
              {lpData && (
                <MenuItem icon={FileSpreadsheet} onClick={() => (close(), void download('exports.xlsx', { fund: d.fund.id, table: 'lps' }, 'save', 'lps.xlsx'))}>
                  Excel
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      )}
      {d !== null && edit && allowed(me, 'funds:edit') && (
        <Button variant="primary" icon={Plus} onClick={() => setFlow('call')}>
          New call
        </Button>
      )}
    </PageHeader>
  );

  if (fundId === '') {
    return (
      <>
        <PageHeader title="Funds" />
        <PageBody>
          <Empty icon={Landmark} title="No fund yet" action={allowed(me, 'settings:full|funds:full') ? <Button onClick={() => navigate('/settings/funds')}>Add fund</Button> : undefined} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}
      <PageBody>
        <FundSwitch funds={funds} value={fundId} onChange={(id) => navigate('/funds/' + id, tab === 'overview' ? undefined : { tab })} />
        {d === null && live.error !== null && <LoadError message={live.error} onRetry={live.reload} />}
        {d === null && live.error === null && <Skeleton className="h-[330px]" />}
        {d !== null && <FundVisual d={d} />}
        {d !== null && (
          <div className="flex min-w-0 flex-col gap-4">
            <Tabs
              label="Fund"
              value={tab}
              onChange={(t) => setQuery({ tab: t === 'overview' ? null : t, quarter: null, statement: null })}
              tabs={[
                { value: 'overview' as Tab, label: 'Overview' },
                ...(lpData ? [{ value: 'lps' as Tab, label: 'LPs', count: d.overview.lps }] : []),
                { value: 'capital' as Tab, label: 'Capital', count: d.counts.events_open > 0 ? d.counts.events_open : undefined },
                { value: 'marks' as Tab, label: 'Marks', count: d.counts.marks_draft > 0 ? d.counts.marks_draft : undefined },
                { value: 'reserves' as Tab, label: 'Reserves' },
                { value: 'reports' as Tab, label: 'Reports' },
              ]}
            />
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'lps' && <LpsTab fund={d.fund} />}
            {tab === 'capital' && <CapitalTab fund={d.fund} statement={query.get('statement') ?? ''} onNew={edit ? (k) => setFlow(k) : undefined} />}
            {tab === 'marks' && <MarksTab fund={d.fund} />}
            {tab === 'reserves' && <ReservesTab fund={d.fund} />}
            {tab === 'reports' && <ReportsTab fund={d.fund} nextEnd={d.next_quarter_end} quarterId={query.get('quarter') ?? ''} />}
          </div>
        )}
      </PageBody>
      {flow !== null && d !== null && (
        <CallSheet
          fund={d.fund}
          kind={flow}
          onClose={() => {
            setFlow(null);
            if (query.get('new') !== null) setQuery({ new: null });
          }}
        />
      )}
      {importing && d !== null && <StatementImport fund={d.fund} onClose={() => setImporting(false)} />}
    </>
  );
}

/**
 * Portfolio: the figure strip (Companies, Invested, Value, MOIC, Runway
 * under 6 months), then one 36px row per holding with its top-line
 * sparkline, growth, runway bar and reporting dot. The one black button:
 * Request updates.
 */
import { useState } from 'react';
import { Briefcase, FileUp, Inbox, ListFilter, Send } from 'lucide-react';
import { Button, DataTable, Empty, FigureStrip, LoadError, Menu, MenuItem, MenuSep, PageBody, PageHeader, Panel, Skeleton, Tag, Tip } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { CompanyLogo } from '../../components/portfolio/Logo.tsx';
import { Sparkline } from '../../components/charts.tsx';
import { ImportDialog } from '../../components/ImportDialog.tsx';
import { ReportDot, RunwayMeter, chartValue, growthText } from '../../components/portfolio/kit.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { ago, money, multiple } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.ts';
import { RequestDialog } from './RequestDialog.tsx';
import type { HoldingRow, PortfolioList } from './types.ts';

export const LIST_READS = ['holdings', 'securities', 'ownership', 'rounds', 'kpi_values', 'updates', 'requests', 'alerts'];

function columns(showFund: boolean, mark: number): Column<HoldingRow>[] {
  const cols: Column<HoldingRow>[] = [
    {
      key: 'company',
      label: 'Company',
      width: 'minmax(180px,2fr)',
      fixed: true,
      phone: 'title',
      sort: (r) => r.company.name.toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <CompanyLogo name={r.company.name} domain={r.company.logo_domain ?? ''} logoUrl={r.company.logo_url ?? ''} size={22} />
          <span className="truncate font-medium">{r.company.name}</span>
          {r.alert !== '' && <span aria-label="Alert" className={r.alert === 'bad' ? 'size-1.5 shrink-0 rounded-full bg-[var(--vo-bad)]' : 'size-1.5 shrink-0 rounded-full bg-[var(--vo-warn)]'} />}
        </span>
      ),
    },
  ];
  if (showFund) cols.push({ key: 'fund', label: 'Fund', width: '120px', optional: false, sort: (r) => r.fund?.name ?? '', render: (r) => (r.fund !== null ? <Tag>{r.fund.name}</Tag> : null) });
  cols.push(
    { key: 'stage', label: 'Stage', width: '110px', phone: 'hide', sort: (r) => r.stage, render: (r) => <span className="truncate text-[var(--vo-ink-2)]">{r.stage}</span> },
    {
      key: 'kpi',
      label: <Tip text="ARR when reported, else MRR, else revenue. Dashed points are staged, not yet verified.">Top line</Tip>,
      width: 'minmax(170px,1.4fr)',
      align: 'right',
      sort: (r) => (r.kpi.value === null ? -1 : (chartValue('money', r.kpi.value, r.kpi.currency || r.currency) ?? -1)),
      render: (r) =>
        r.kpi.value === null ? (
          <span className="text-[var(--vo-muted)]">None</span>
        ) : (
          <span className="flex min-w-0 items-center justify-end gap-2.5">
            {r.kpi.spark.length > 1 && <Sparkline values={r.kpi.spark.map((p) => chartValue('money', p.value, r.kpi.currency))} width={72} height={20} label={r.kpi.label} />}
            <span className="vo-mono vo-num">{money(r.kpi.value, r.kpi.currency, { compact: true })}</span>
            <span className="w-8 text-left text-[11px] text-[var(--vo-muted)]">{r.kpi.key === 'revenue' ? 'Rev' : r.kpi.label}</span>
          </span>
        ),
    },
    { key: 'growth', label: 'Growth', width: '84px', align: 'right', mono: true, sort: (r) => r.kpi.growth_ppm ?? -1e12, render: (r) => <span className={r.kpi.growth_ppm !== null && r.kpi.growth_ppm < 0 ? 'text-[var(--vo-bad)]' : ''}>{growthText(r.kpi.growth_ppm)}</span> },
    { key: 'runway', label: 'Runway', width: '170px', sort: (r) => (r.runway.months === null ? 1e6 : r.runway.months), render: (r) => (r.runway.state === 'not_burning' ? <span className="text-[12px] text-[var(--vo-good)]">Not burning</span> : <RunwayMeter value={r.runway.months} mark={mark} />) },
    { key: 'reporting', label: 'Reporting', width: '112px', sort: (r) => r.reporting, render: (r) => <ReportDot state={r.reporting} /> },
    { key: 'updated', label: 'Update', width: '96px', align: 'right', phone: 'end', sort: (r) => r.last_update_at, render: (r) => <span className="text-[12px] text-[var(--vo-muted)]">{r.last_update_at !== '' ? ago(r.last_update_at) : ''}</span> },
  );
  return cols;
}

export function PortfolioPage(): React.JSX.Element {
  const me = useMe();
  const ui = useUi();
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [requests, setRequests] = useState(false);
  const [importing, setImporting] = useState<'' | 'holdings' | 'kpi_values'>('');
  const params: Record<string, unknown> = { status };
  if (ui.fund !== '') params['fund'] = ui.fund;
  const live = useOp<PortfolioList>('holdings.list', params, LIST_READS, { name: 'holdings.list', keep: true });
  const edit = allowed(me, 'portfolio:edit');
  const d = live.data;
  const f = d?.figures;
  const low = f?.runway_low ?? 0;

  return (
    <>
      <PageHeader title="Portfolio">
        {edit && (
          <Menu label="More">
            {(close) => (
              <>
                <MenuItem icon={FileUp} onClick={() => (close(), setImporting('holdings'))}>
                  Import holdings
                </MenuItem>
                <MenuItem icon={FileUp} onClick={() => (close(), setImporting('kpi_values'))}>
                  Import KPIs
                </MenuItem>
                <MenuItem icon={Inbox} onClick={() => (close(), void act([], () => op('updates.sweep', {}), LIST_READS))}>
                  Check Gmail
                </MenuItem>
                <MenuSep />
                <MenuItem icon={ListFilter} selected={status === 'all'} onClick={() => (close(), setStatus(status === 'all' ? 'active' : 'all'))}>
                  Show exited
                </MenuItem>
              </>
            )}
          </Menu>
        )}
        {edit && d !== null && d.figures.companies > 0 && (
          <Button variant="primary" icon={Send} onClick={() => setRequests(true)}>
            Request updates
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : d === null || f === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : d.rows.length === 0 && d.figures.companies === 0 ? (
          <Empty icon={Briefcase} title="No holdings yet" action={edit ? <Button onClick={() => setImporting('holdings')}>Import holdings</Button> : undefined} />
        ) : (
          <>
            <FigureStrip
              items={[
                { label: 'Companies', value: String(f.companies) },
                { label: 'Invested', value: f.invested_minor === null ? null : money(f.invested_minor, f.currency, { compact: true }), tip: 'Cost of every holding, in the firm currency.' },
                { label: 'Value', value: f.value_minor === null ? null : money(f.value_minor, f.currency, { compact: true }), tip: f.held_at_cost > 0 ? `Approved marks; ${f.held_at_cost} held at cost.` : 'Approved marks.' },
                { label: 'MOIC', value: f.moic_e8 === null ? null : multiple(f.moic_e8), tip: 'Gross: value and proceeds over cost.' },
                { label: `Runway < ${f.runway_months} mo`, value: String(low), tone: low > 0 ? 'bad' : undefined, tip: 'Companies whose verified cash covers fewer months of burn.' },
              ]}
            />
            <Panel flush>
              <DataTable
                label="Holdings"
                columns={columns(d.funds.length > 1, f.runway_months)}
                rows={d.rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate('/portfolio/' + r.company.id)}
                stickyTop={0}
                viewScope="portfolio.holdings"
                empty={<Empty icon={Briefcase} title="No holdings here" />}
              />
            </Panel>
          </>
        )}
      </PageBody>
      <RequestDialog open={requests} onClose={() => setRequests(false)} />
      <ImportDialog open={importing !== ''} onClose={() => setImporting('')} target={importing === '' ? undefined : importing} />
    </>
  );
}

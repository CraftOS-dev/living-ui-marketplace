/**
 * A portfolio company's KPIs, charts first: the top line (ARR, MRR or
 * revenue), net burn as bars, cash with its runway projected to the month
 * it runs out; then the latest verified figures. Verified points are
 * solid, staged ones dashed (muted bars).
 */
import { useState } from 'react';
import { LineChart as LineIcon, Plus } from 'lucide-react';
import { Button, Empty, FigureStrip, LoadError, Panel, Segmented, Skeleton, Tip } from '../../components/ui.tsx';
import { BarChart, Legend, LineChart } from '../../components/charts.tsx';
import type { Series } from '../../components/charts.tsx';
import { chartFormat, chartValue, growthText, periodLong, periodShort, valueText } from '../../components/portfolio/kit.tsx';
import { useMe } from '../../lib/auth.ts';
import { compact, months as monthsText } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import type { KpiList, KpiPoint, Metric } from './types.ts';

export const KPI_READS = ['kpi_values', 'kpi_defs', 'updates', 'holdings', 'fx_rates'];

/** Split a metric into a solid verified series and a dashed staged one over shared labels. */
function lineSeries(m: Metric, labels: string[], byLabel: (p: KpiPoint) => string, tone: 'a' | 'b' | 'ink'): Series[] {
  const verified: (number | null)[] = labels.map(() => null);
  const staged: (number | null)[] = labels.map(() => null);
  let lastVerified = -1;
  for (const p of m.points) {
    const i = labels.indexOf(byLabel(p));
    if (i < 0) continue;
    const v = chartValue(m.unit, p.value, p.currency);
    if (p.status === 'verified') {
      verified[i] = v;
      lastVerified = Math.max(lastVerified, i);
    } else staged[i] = v;
  }
  const out: Series[] = [{ key: m.key, label: m.label, values: verified, tone }];
  if (staged.some((v) => v !== null)) {
    // Join the dashed line to the last verified point before it.
    const first = staged.findIndex((v) => v !== null);
    if (first > 0 && verified[first - 1] !== null && verified[first - 1] !== undefined) staged[first - 1] = verified[first - 1] ?? null;
    out.push({ key: m.key + '_staged', label: 'Staged', values: staged, tone, dashed: true });
  }
  return out;
}

/** A point's place on the time axis: its period's last month ('2026-10'). */
function labelOf(p: KpiPoint): string {
  return p.period_end.slice(0, 7);
}

/** The last 12 periods (month keys) of a set of metrics, in order. */
function periodsOf(ms: (Metric | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const m of ms) for (const p of m?.points ?? []) seen.add(labelOf(p));
  return [...seen].sort().slice(-12);
}

/** Axis labels for month keys (quarters when every point of the metric covers a quarter). */
function axis(keys: string[], m: Metric | undefined): string[] {
  const quarterly = m !== undefined && m.points.length > 0 && m.points.every((p) => p.months === 3);
  // The first label and every January carry the year ('Nov 25', 'Jan 26', 'Feb').
  return keys.map((k, i) => (quarterly ? periodShort(k + '-01', 3) : i === 0 && k.slice(5, 7) !== '01' ? periodShort(k + '-01') + ' ' + k.slice(2, 4) : periodShort(k + '-01')));
}

export function Overview({ company, baseCurrency, onAdd, strip = true }: { company: string; baseCurrency: string; onAdd: () => void; strip?: boolean | undefined }): React.JSX.Element {
  const me = useMe();
  const [cur, setCur] = useState<'native' | 'base'>('native');
  const live = useOp<KpiList>('kpis.list', { company, currency: cur === 'base' ? baseCurrency : 'native' }, KPI_READS, { name: 'kpis.list', keep: true });
  const d = live.data;
  if (live.error !== null && d === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (d === null) return <Skeleton className="h-72 w-full" />;
  const m = (k: string): Metric | undefined => d.metrics.find((x) => x.key === k);
  const top = [m('arr'), m('mrr'), m('revenue')].find((x) => x !== undefined && x.points.length > 0);
  const burn = m('net_burn');
  const cash = m('cash');
  const any = d.metrics.some((x) => x.points.length > 0);
  if (!any)
    return (
      <Empty
        icon={LineIcon}
        title="KPIs from founder updates appear here"
        action={
          me.levels.portfolio === 'edit' || me.levels.portfolio === 'full' ? (
            <Button icon={Plus} onClick={onAdd}>
              Add update
            </Button>
          ) : undefined
        }
      />
    );
  const curText = (p: KpiPoint | undefined | null): string => (p?.currency ?? '') || d.report_currency;
  const rw = d.runway;

  // Cash: verified and staged, then the runway projected to zero (dashed) at the engine's zero day.
  const cashLabels = periodsOf([cash]);
  let cashSeries: Series[] = [];
  if (cash !== undefined && cash.points.length > 0) {
    cashSeries = lineSeries(cash, cashLabels, labelOf, 'b');
    if (rw.state === 'known' && rw.months !== null && rw.zero_day !== null && rw.cash_minor !== null && rw.as_of_day !== null) {
      const startLabel = rw.as_of_day.slice(0, 7);
      const startIdx = cashLabels.indexOf(startLabel);
      const steps = Math.min(12, Math.max(1, Math.ceil(rw.months)));
      if (startIdx >= 0) {
        const [y0, m0] = [Number(rw.as_of_day.slice(0, 4)), Number(rw.as_of_day.slice(5, 7))];
        const proj: (number | null)[] = cashLabels.map(() => null);
        const start = chartValue('money', rw.cash_minor, rw.currency) ?? 0;
        proj[startIdx] = start;
        for (let i = 1; i <= steps; i++) {
          const mm = m0 + i;
          const yy = y0 + Math.floor((mm - 1) / 12);
          const lab = `${yy}-${String(((mm - 1) % 12) + 1).padStart(2, '0')}`;
          if (startIdx + i >= cashLabels.length) {
            cashLabels.push(lab);
            proj.push(null);
            for (const s of cashSeries) s.values.push(null);
          }
          proj[startIdx + i] = Math.max(0, start * (1 - i / rw.months));
        }
        cashSeries.push({ key: 'runway', label: 'Runway', values: proj, tone: 'bad', dashed: true });
      }
    }
  }

  const topLabels = top !== undefined ? periodsOf([top]) : [];
  const burnLabels = periodsOf([burn]);
  const burnVerified = burnLabels.map((l) => {
    const p = burn?.points.find((x) => labelOf(x) === l && x.status === 'verified');
    return p !== undefined ? chartValue('money', p.value, p.currency) : null;
  });
  const burnStaged = burnLabels.map((l) => {
    const p = burn?.points.find((x) => labelOf(x) === l && x.status !== 'verified');
    return p !== undefined ? chartValue('money', p.value, p.currency) : null;
  });
  const anyStaged = d.metrics.some((x) => x.staged > 0);
  const burnSeries: Series[] = [{ key: 'burn', label: 'Net burn', values: burnVerified, tone: 'ink' }];
  if (burnStaged.some((v) => v !== null)) burnSeries.push({ key: 'burn_staged', label: 'Staged', values: burnStaged, tone: 'muted' });

  const latest = (k: string): string | null => {
    const x = m(k);
    return x?.latest ? valueText(x.unit, x.latest.value, x.latest.currency) : null;
  };
  const figs = [
    { label: 'Runway', value: rw.state === 'not_burning' ? 'Not burning' : rw.months !== null ? monthsText(rw.months) : null, tone: rw.months !== null && rw.months < 6 ? ('bad' as const) : undefined, tip: rw.state === 'unknown' ? (rw.reason === 'missing_month' ? 'Unknown: burn for ' + rw.missing.join(', ') + ' is not verified.' : 'Unknown: no verified cash.') : 'Verified cash over the average net burn of the last three verified months.' },
    { label: 'Cash', value: latest('cash') },
    { label: 'Net burn', value: latest('net_burn') },
  ];
  if (top !== undefined) {
    figs.push({ label: top.label, value: top.latest ? valueText(top.unit, top.latest.value, top.latest.currency) : null, tone: undefined, tip: 'Latest verified value.' });
    if (top.growth.growth_ppm !== null) figs.push({ label: 'Growth', value: growthText(top.growth.growth_ppm), tone: top.growth.growth_ppm < 0 ? 'bad' : undefined, tip: 'On the verified period before.' });
  }
  const hc = latest('headcount');
  if (hc !== null) figs.push({ label: 'Headcount', value: hc, tone: undefined, tip: '' });

  return (
    <div className="flex flex-col gap-3">
      <div className={strip ? 'flex flex-wrap items-center gap-3' : d.report_currency !== baseCurrency ? 'flex justify-end' : 'hidden'}>
        {strip && <FigureStrip items={figs.map((f) => (f.tip === '' ? { label: f.label, value: f.value, tone: f.tone } : f))} className="min-w-0 flex-1" />}
        {d.report_currency !== baseCurrency && (
          <Segmented
            size="sm"
            label="Currency"
            value={cur}
            onChange={setCur}
            options={[
              { value: 'native', label: d.report_currency },
              { value: 'base', label: baseCurrency },
            ]}
          />
        )}
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {top !== undefined && (
          <Panel label={top.label}>
            <LineChart labels={axis(topLabels, top)} series={lineSeries(top, topLabels, labelOf, 'a')} area height={190} format={chartFormat(top.unit, curText(top.latest))} yFormat={(v) => compact(v)} label={top.label} />
          </Panel>
        )}
        {burn !== undefined && burn.points.length > 0 && (
          <Panel label="Net burn">
            <BarChart
              labels={axis(burnLabels, burn)}
              series={burnSeries}
              stacked
              height={190}
              format={chartFormat('money', curText(burn.latest))}
              label="Net burn"
            />
          </Panel>
        )}
        {cash !== undefined && cash.points.length > 0 && (
          <Panel label="Cash" aside={rw.state === 'known' && rw.zero_day !== null ? <Tip text="The month verified cash runs out at the average burn of the last three verified months."><span className="vo-mono vo-num text-[12px] text-[var(--vo-bad)]">{'Runs out ' + periodLong(rw.zero_day)}</span></Tip> : undefined}>
            <LineChart labels={axis(cashLabels, cash)} series={cashSeries} height={190} format={chartFormat('money', curText(cash.latest))} label="Cash" />
          </Panel>
        )}
      </div>
      {anyStaged && <Legend items={[{ label: 'Verified', tone: 'a' }, { label: 'Staged', tone: 'a', dashed: true }]} />}
    </div>
  );
}

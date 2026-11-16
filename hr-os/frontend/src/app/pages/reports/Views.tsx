/**
 * One page per people analytics report: the filters, a quiet chart first,
 * the figures, then the table with CSV export. Every view reads its
 * reports.* operation with the filters kept in the address.
 */
import { useState } from 'react';
import { ChartColumn, RefreshCw } from 'lucide-react';
import { Button, Empty, LoadError, Money, Notice, PageBody, PageHeader, Panel } from '../../components/ui.tsx';
import { Funnel, HBars, Legend, Lines, MonthChart, RangeStrip, seriesColor, SplitBar } from '../../components/reports/charts.tsx';
import { ExportButton, Figure, Figures, filterParams, FilterBar, GroupBy, ReportGrid, ReportSkeleton, useFilters } from '../../components/reports/parts.tsx';
import { useMoneyText } from '../../components/home/load.tsx';
import type { ReportTable } from '../../components/reports/parts.tsx';
import { Segmented } from '../../components/ui.tsx';
import { allowed, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addMonths, ago, dayKey, fmtDay, fmtRange } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { op } from '../../lib/api.ts';
import type { OpName } from '../../lib/api.ts';
import { setQuery } from '../../lib/router.ts';

const READS = ['employments', 'employees', 'job_records', 'pay_records', 'separations', 'grades', 'payslips', 'payruns', 'leave_requests', 'leave_ledger', 'attendance', 'checkins', 'applications', 'hiring_events', 'training_attendees', 'trainings', 'fx_rates'];

interface Base {
  filters: { from: string; to: string; currency: string };
  table: ReportTable;
}

function Shell({ title, report, params, children, data, error, reload, period, money, extra }: { title: string; report: string; params: Record<string, string>; children: (d: never) => React.ReactNode; data: Base | null; error: string | null; reload: () => void; period: 'range' | 'day'; money?: boolean | undefined; extra?: React.ReactNode }): React.JSX.Element {
  const me = useMe();
  const f = useFilters(new URLSearchParams(params));
  const today = dayKey();
  const defaults = { from: data?.filters.from ?? addMonths(today.slice(0, 7) + '-01', -11), to: data?.filters.to ?? today, currency: data?.filters.currency ?? me.company.reporting_currency };
  return (
    <>
      <PageHeader title={title} back="#/reports" meta={data !== null ? (period === 'range' ? fmtRange(data.filters.from, data.filters.to) : t('rep.as_of', { day: fmtDay(data.filters.to, { year: 'always' }) })) + (money === true ? ' · ' + data.filters.currency : '') : ''}>
        <ExportButton report={report} params={params} disabled={data === null || data.table.rows.length === 0} />
      </PageHeader>
      <PageBody>
        {/* One column: the panels stack full width in a readable measure. */}
        <div className="max-w-[1200px]">
          <FilterBar f={f} period={period} money={money} defaults={defaults}>
            {extra}
          </FilterBar>
          {data === null ? error !== null ? <LoadError message={error} onRetry={reload} /> : <ReportSkeleton /> : <div className="flex flex-col gap-3" data-ready="">{children(data as never)}</div>}
        </div>
      </PageBody>
    </>
  );
}

function useReport<T>(name: OpName, params: Record<string, string>): { data: T | null; error: string | null; reload: () => void } {
  const live = useOp<T>(name, params, READS, { name: 'rep.' + name, keep: true });
  return { data: live.data, error: live.error, reload: live.reload };
}

const n = (v: number): string => String(Math.round(v));

/** When the company figures were counted, and a way to count them again now. */
function Counted({ at, report, params, reload }: { at: string; report: OpName; params: Record<string, string>; reload: () => void }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (at === '') return null;
  const again = (): void => {
    setBusy(true);
    void op(report, { ...params, fresh: true })
      .then(() => reload())
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hr-label">{t('rep.counted', { when: ago(at) })}</span>
      <Button className="hit" size="sm" variant="ghost" icon={RefreshCw} busy={busy} onClick={again}>
        {t('rep.count_again')}
      </Button>
    </div>
  );
}
const pct = (v: number): string => v + '%';

/** Groups without an exchange rate, and the one tap that fetches today's rates (people who may). */
function MissingFx({ n }: { n: number }): React.JSX.Element {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const can = allowed(me, 'admin:edit|payroll:edit');
  const fetchRates = (): void => {
    setBusy(true);
    void op('fx.refresh', {})
      .then(() => changed('fx_rates'))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <Notice tone="warn" action={can ? <Button className="hit" size="sm" icon={RefreshCw} busy={busy} onClick={fetchRates}>{t('rep.fx_fetch')}</Button> : undefined}>
      {tn('rep.missing_fx', n)}
    </Notice>
  );
}

/* ------------------------------------------------------------ headcount */

interface Headcount extends Base {
  group_by: 'entity' | 'department' | 'location';
  months: string[];
  total: number[];
  joined: number[];
  left: number[];
  series: { key: string; label: string; values: number[] }[];
  readouts: { now: number; start: number; change: number; change_pct: number; joined: number; left: number };
}

export function HeadcountReport({ query }: PageProps): React.JSX.Element {
  const by = (query.get('group_by') ?? 'entity') as Headcount['group_by'];
  const params = filterParams(useFilters(query), { group_by: by });
  const r = useReport<Headcount>('reports.headcount', params);
  return (
    <Shell title={t('rep.headcount.title')} report="headcount" params={params} period="range" {...r} extra={<GroupBy value={by} onChange={(v) => setQuery({ group_by: v === 'entity' ? undefined : v })} options={[{ value: 'entity', label: t('rep.by.entity') }, { value: 'department', label: t('rep.by.department') }, { value: 'location', label: t('rep.by.location') }]} />}>
      {(d: Headcount) => (
        <>
          <Panel index="01" label={t('rep.headcount.chart')} >
<Legend className="mb-2 justify-end" items={d.series.slice(0, 3).map((s, i) => ({ label: s.label, color: seriesColor(i), line: true }))} />
            {d.series.length === 0 ? <Empty icon={ChartColumn} title={t('rep.no_people')} className="py-8" /> : <Lines months={d.months} series={d.series} label={t('rep.headcount.chart')} height={200} />}
          </Panel>
          <Figures>
            <Figure label={t('rep.f.headcount_now')} value={d.readouts.now} />
            <Figure label={t('rep.f.change')} value={(d.readouts.change > 0 ? '+' : '') + d.readouts.change} sub={d.readouts.start > 0 ? d.readouts.change_pct + '%' : undefined} />
            <Figure label={t('rep.f.joined')} value={d.readouts.joined} />
            <Figure label={t('rep.f.left')} value={d.readouts.left} />
            <Figure label={t('rep.f.start')} value={d.readouts.start} />
            <Figure label={t('rep.f.groups')} value={d.series.length} />
          </Figures>
          <Panel index="02" label={t('rep.headcount.moves')}>
            <MonthChart months={d.months} bars={[{ key: 'j', label: t('rep.f.joined'), color: 'var(--hr-rh)', values: d.joined }, { key: 'l', label: t('rep.f.left'), color: 'var(--hr-lh)', values: d.left }]} line={{ label: t('rep.f.headcount'), values: d.total }} format={n} lineFormat={n} label={t('rep.headcount.moves')} height={150} />
          </Panel>
          <ReportGrid table={d.table} label={t('rep.headcount.title')} />
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------- movement */

interface Movement extends Base {
  months: { month: string; joined: number; left: number; headcount: number; voluntary: number; involuntary: number; other: number; not_recorded: number }[];
  readouts: { joined: number; left: number; net: number; average_headcount: number; turnover_pct: number; turnover_annual_pct: number; voluntary_pct: number; involuntary_pct: number; tenure_at_leaving_years: number };
  kinds: { voluntary: number; involuntary: number; other: number; not_recorded: number };
  reasons: { reason: string; count: number }[];
}

export function MovementReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Movement>('reports.movement', params);
  return (
    <Shell title={t('rep.movement.title')} report="movement" params={params} period="range" {...r}>
      {(d: Movement) => (
        <>
          <Panel index="01" label={t('rep.movement.chart')} >
<Legend className="mb-2 justify-end" items={[{ label: t('rep.k.voluntary'), color: 'var(--hr-rh)' }, { label: t('rep.k.involuntary'), color: 'var(--hr-lh)' }, { label: t('rep.k.other_short'), color: 'var(--hr-muted)' }, { label: t('rep.f.joined'), color: 'var(--hr-ink)', dot: true }]} />
            <MonthChart
              months={d.months.map((m) => m.month)}
              bars={[
                { key: 'v', label: t('rep.k.voluntary'), color: 'var(--hr-rh)', values: d.months.map((m) => m.voluntary) },
                { key: 'i', label: t('rep.k.involuntary'), color: 'var(--hr-lh)', values: d.months.map((m) => m.involuntary) },
                { key: 'o', label: t('rep.k.other_short'), color: 'var(--hr-muted)', values: d.months.map((m) => m.other + m.not_recorded) },
              ]}
              line={{ label: t('rep.f.joined'), values: d.months.map((m) => m.joined), dots: true }}
              format={n}
              lineFormat={n}
              label={t('rep.movement.chart')}
              height={190}
              empty={t('rep.movement.none')}
            />
          </Panel>
          <Figures>
            <Figure label={t('rep.f.turnover')} value={pct(d.readouts.turnover_pct)} sub={t('rep.f.per_year', { v: d.readouts.turnover_annual_pct })} />
            <Figure label={t('rep.k.voluntary')} value={pct(d.readouts.voluntary_pct)} />
            <Figure label={t('rep.k.involuntary')} value={pct(d.readouts.involuntary_pct)} />
            <Figure label={t('rep.f.joined')} value={d.readouts.joined} sub={t('rep.f.net', { v: (d.readouts.net > 0 ? '+' : '') + d.readouts.net })} />
            <Figure label={t('rep.f.left')} value={d.readouts.left} />
            <Figure label={t('rep.f.tenure_leaving')} value={d.readouts.tenure_at_leaving_years} sub={t('rep.f.years')} />
          </Figures>
          <div className="flex flex-col gap-3">
            <Panel index="02" label={t('rep.movement.kinds')}>
              <div className="flex flex-col gap-3 pt-1">
                <SplitBar label={t('rep.movement.kinds')} parts={[{ key: 'v', label: t('rep.k.voluntary'), value: d.kinds.voluntary, color: 'var(--hr-rh)' }, { key: 'i', label: t('rep.k.involuntary'), value: d.kinds.involuntary, color: 'var(--hr-lh)' }, { key: 'o', label: t('rep.k.other'), value: d.kinds.other, color: 'var(--hr-ink-2)' }, { key: 'n', label: t('rep.k.not_recorded'), value: d.kinds.not_recorded, color: 'var(--hr-muted)' }]} />
                <HBars
                  label={t('rep.movement.kinds')}
                  rows={(['voluntary', 'involuntary', 'other', 'not_recorded'] as const).map((k) => ({ key: k, label: t('rep.k.' + k), value: d.kinds[k] }))}
                  max={Math.max(1, d.readouts.left)}
                />
              </div>
            </Panel>
            <Panel index="03" label={t('rep.movement.reasons')}>
              {d.reasons.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.movement.no_reasons')}</p> : <HBars label={t('rep.movement.reasons')} rows={d.reasons.map((x) => ({ key: x.reason, label: t('rep.reason.' + x.reason), value: x.count }))} color="var(--hr-muted)" />}
            </Panel>
          </div>
          <ReportGrid table={d.table} label={t('rep.movement.title')} />
        </>
      )}
    </Shell>
  );
}

/* --------------------------------------------------------------- tenure */

interface Tenure extends Base {
  bands: { key: string; label: string; count: number }[];
  readouts: { people: number; average_years: number; median_years: number; under_1_pct: number };
  groups: { key: string; label: string; people: number; average_years: number; median_years: number }[];
}

export function TenureReport({ query }: PageProps): React.JSX.Element {
  const by = (query.get('group_by') ?? 'department') as 'entity' | 'department' | 'location';
  const params = filterParams(useFilters(query), { group_by: by });
  const r = useReport<Tenure>('reports.tenure', params);
  return (
    <Shell title={t('rep.tenure.title')} report="tenure" params={params} period="day" {...r} extra={<GroupBy value={by} onChange={(v) => setQuery({ group_by: v === 'department' ? undefined : v })} options={[{ value: 'department', label: t('rep.by.department') }, { value: 'entity', label: t('rep.by.entity') }, { value: 'location', label: t('rep.by.location') }]} />}>
      {(d: Tenure) => (
        <>
          <div className="flex flex-col gap-3">
            <Panel index="01" label={t('rep.tenure.bands')}>
              <HBars label={t('rep.tenure.bands')} rows={d.bands.map((b) => ({ key: b.key, label: t('rep.tenure.band.' + b.key), value: b.count }))} />
            </Panel>
            <Panel index="02" label={t('rep.tenure.by_group')}>
              <HBars label={t('rep.tenure.by_group')} rows={d.groups.slice(0, 10).map((g) => ({ key: g.key, label: g.label, value: g.average_years, sub: tn('home.people_n', g.people) }))} format={(v) => v.toFixed(1)} color="var(--hr-lh)" />
            </Panel>
          </div>
          <Figures>
            <Figure label={t('rep.f.people')} value={d.readouts.people} />
            <Figure label={t('rep.f.avg_tenure')} value={d.readouts.average_years} sub={t('rep.f.years')} />
            <Figure label={t('rep.f.median_tenure')} value={d.readouts.median_years} sub={t('rep.f.years')} />
            <Figure label={t('rep.f.under_1')} value={pct(d.readouts.under_1_pct)} />
          </Figures>
          <ReportGrid table={d.table} label={t('rep.tenure.title')} />
        </>
      )}
    </Shell>
  );
}

/* ----------------------------------------------------------------- span */

interface Span extends Base {
  bands: { key: string; label: string; count: number }[];
  readouts: { managers: number; people: number; average_span: number; median_span: number; widest: number; single_report: number; no_manager: number };
}

export function SpanReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Span>('reports.span', params);
  return (
    <Shell title={t('rep.span.title')} report="span" params={params} period="day" {...r}>
      {(d: Span) => (
        <>
          <Panel index="01" label={t('rep.span.bands')}>
            <HBars label={t('rep.span.bands')} rows={d.bands.map((b) => ({ key: b.key, label: t('rep.span.band', { n: b.label }), value: b.count }))} />
          </Panel>
          <Figures>
            <Figure label={t('rep.f.managers')} value={d.readouts.managers} />
            <Figure label={t('rep.f.avg_span')} value={d.readouts.average_span} />
            <Figure label={t('rep.f.median_span')} value={d.readouts.median_span} />
            <Figure label={t('rep.f.widest')} value={d.readouts.widest} />
            <Figure label={t('rep.f.single')} value={d.readouts.single_report} />
            <Figure label={t('rep.f.no_manager')} value={d.readouts.no_manager} tone={d.readouts.no_manager > 0 ? 'warn' : undefined} />
          </Figures>
          <ReportGrid table={d.table} label={t('rep.span.title')} initialSort={{ key: 'direct', dir: 'desc' }} />
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------ diversity */

interface Diversity extends Base {
  dimension: 'gender' | 'age' | 'nationality';
  min_group: number;
  total: number | null;
  groups: { key: string; label: string; count: number | null; share: number | null; hidden: boolean }[];
}

export function DiversityReport({ query }: PageProps): React.JSX.Element {
  const dim = (query.get('dimension') ?? 'gender') as Diversity['dimension'];
  const params = filterParams(useFilters(query), { dimension: dim });
  const r = useReport<Diversity>('reports.diversity', params);
  return (
    <Shell title={t('rep.diversity.title')} report="diversity" params={params} period="day" {...r} extra={<Segmented value={dim} onChange={(v) => setQuery({ dimension: v === 'gender' ? undefined : v })} label={t('rep.diversity.dimension')} size="sm" options={[{ value: 'gender', label: t('rep.diversity.gender') }, { value: 'age', label: t('rep.diversity.age') }, { value: 'nationality', label: t('rep.diversity.nationality') }]} />}>
      {(d: Diversity) => (
        <>
          <Notice>{t('rep.diversity.rule', { n: d.min_group })}</Notice>
          <Panel index="01" label={t('rep.diversity.' + d.dimension)} aside={<span className="hr-label">{d.total === null ? t('rep.fewer_than_5') : tn('home.people_n', d.total)}</span>}>
            {d.groups.length === 0 ? (
              <Empty icon={ChartColumn} title={t('rep.no_people')} className="py-8" />
            ) : (
              <HBars label={t('rep.diversity.title')} rows={d.groups.map((g) => ({ key: g.key === '' ? '_none' : g.key, label: d.dimension === 'gender' ? g.label.charAt(0).toUpperCase() + g.label.slice(1) : g.label, value: g.count, sub: g.count === null ? t('rep.fewer_than_5') : g.share + '%' }))} />
            )}
          </Panel>
          <ReportGrid table={d.table} label={t('rep.diversity.title')} />
        </>
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------- comp bands */

interface CompBands extends Base {
  grades: { grade: string; code: string; name: string; currency: string; min_minor: number; max_minor: number; mid_minor: number; people: number; below: number; inside: number; above: number; no_pay: number; compa_avg: number | null; has_range: boolean }[];
  people: { name: string; grade: string; annual_minor: number | null; currency: string; position: string; compa: number | null }[];
  readouts: { graded: number; ungraded: number; inside_pct: number; below: number; above: number };
  missing_fx: unknown[];
}

export function CompBandsReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<CompBands>('reports.comp-bands', params);
  return (
    <Shell title={t('rep.comp.title')} report="comp-bands" params={params} period="day" {...r}>
      {(d: CompBands) => (
        <CompBody d={d} />
      )}
    </Shell>
  );
}

function CompBody({ d }: { d: CompBands }): React.JSX.Element {
  const money = useMoneyText();
  return (
        <>
          <Panel index="01" label={t('rep.comp.chart')} aside={<span className="hr-label">{t('rep.comp.yearly')}</span>}>
            {d.grades.length === 0 ? (
              <Empty icon={ChartColumn} title={t('rep.comp.none')} className="py-8">
                {t('rep.comp.none_text')}
              </Empty>
            ) : (
              <ul className="flex flex-col">
                {d.grades.map((g) => (
                  <li key={g.grade} className="grid min-w-0 grid-cols-[minmax(84px,18%)_1fr] items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0 sm:grid-cols-[minmax(110px,16%)_1fr_minmax(150px,auto)]">
                    <span className="min-w-0">
                      <span className="hr-mono block text-[13px]">{g.code}</span>
                      <span className="block truncate text-[12px] text-[var(--hr-muted)]">{g.name}</span>
                    </span>
                    {g.has_range ? (
                      <RangeStrip
                        min={g.min_minor}
                        max={g.max_minor}
                        label={g.code}
                        points={d.people.filter((p) => p.grade === g.code && p.annual_minor !== null).map((p, i) => ({ key: g.code + i, value: p.annual_minor ?? 0, title: p.name + (money(p.annual_minor ?? 0, g.currency) !== '' ? ': ' + money(p.annual_minor ?? 0, g.currency) : '') }))}
                      />
                    ) : (
                      <span className="text-[12px] text-[var(--hr-muted)]">{t('rep.comp.no_range')}</span>
                    )}
                    <span className="hr-num col-span-2 text-[12px] text-[var(--hr-muted)] sm:col-span-1 sm:text-right">
                      {g.has_range ? (
                        <>
                          <Money minor={g.min_minor} currency={g.currency} format={{ compact: true }} display="code" /> {t('rep.to')} <Money minor={g.max_minor} currency={g.currency} format={{ compact: true }} display="code" />
                        </>
                      ) : (
                        ''
                      )}
                      {' · '}
                      {t('rep.comp.counts', { in: g.inside, below: g.below, above: g.above })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Figures>
            <Figure label={t('rep.comp.graded')} value={d.readouts.graded} />
            <Figure label={t('rep.comp.inside')} value={pct(d.readouts.inside_pct)} tone={d.readouts.inside_pct >= 80 ? 'good' : undefined} />
            <Figure label={t('rep.comp.below')} value={d.readouts.below} tone={d.readouts.below > 0 ? 'bad' : undefined} />
            <Figure label={t('rep.comp.above')} value={d.readouts.above} tone={d.readouts.above > 0 ? 'warn' : undefined} />
            <Figure label={t('rep.comp.ungraded')} value={d.readouts.ungraded} />
          </Figures>
          {d.missing_fx.length > 0 && <MissingFx n={d.missing_fx.length} />}
          <ReportGrid table={d.table} label={t('rep.comp.title')} />
        </>
  );
}

/* ----------------------------------------------------------------- cost */

interface Cost extends Base {
  currency: string;
  months: { month: string; gross_minor: number; employer_minor: number; net_minor: number; cost_minor: number; people: number; headcount: number }[];
  entities: { entity: string; name: string; currency: string; cost_rep_minor: number }[];
  missing_fx: { month: string; entity: string; currency: string }[];
  readouts: { total_cost_minor: number; total_gross_minor: number; total_employer_minor: number; last_month: string; last_cost_minor: number; change_pct: number | null; cost_per_head_minor: number };
}

export function CostReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Cost>('reports.cost', params);
  return (
    <Shell title={t('rep.cost.title')} report="cost" params={params} period="range" money {...r}>
      {(d: Cost) => <CostBody d={d} />}
    </Shell>
  );
}

function CostBody({ d }: { d: Cost }): React.JSX.Element {
  const money = useMoneyText();
  const cur = d.currency;
  const fmt = (v: number): string => money(Math.round(v), cur, { compact: true });
  return (
          <>
            <Panel index="01" label={t('rep.cost.chart')} >
<Legend className="mb-2 justify-end" items={[{ label: t('home.chart.gross'), color: 'var(--hr-rh)' }, { label: t('home.chart.employer'), color: 'var(--hr-lh)' }, { label: t('home.chart.headcount'), color: 'var(--hr-ink)', line: true }]} />
              <MonthChart months={d.months.map((m) => m.month)} bars={[{ key: 'g', label: t('home.chart.gross'), color: 'var(--hr-rh)', values: d.months.map((m) => m.gross_minor) }, { key: 'e', label: t('home.chart.employer'), color: 'var(--hr-lh)', values: d.months.map((m) => m.employer_minor) }]} line={{ label: t('home.chart.headcount'), values: d.months.map((m) => m.headcount) }} format={fmt} lineFormat={n} label={t('rep.cost.chart')} height={210} empty={t('home.chart.no_runs')} />
            </Panel>
            <Figures>
              <Figure label={t('rep.cost.total')} value={<Money minor={d.readouts.total_cost_minor} currency={cur} format={{ compact: true }} />} />
              <Figure label={t('home.chart.gross')} value={<Money minor={d.readouts.total_gross_minor} currency={cur} format={{ compact: true }} />} />
              <Figure label={t('home.chart.employer')} value={<Money minor={d.readouts.total_employer_minor} currency={cur} format={{ compact: true }} />} />
              <Figure label={t('rep.cost.last')} value={<Money minor={d.readouts.last_cost_minor} currency={cur} format={{ compact: true }} />} sub={d.readouts.change_pct !== null ? (d.readouts.change_pct > 0 ? '+' : '') + d.readouts.change_pct + '%' : undefined} />
              <Figure label={t('rep.cost.per_head')} value={<Money minor={d.readouts.cost_per_head_minor} currency={cur} format={{ compact: true }} />} />
            </Figures>
            {d.missing_fx.length > 0 && <MissingFx n={d.missing_fx.length} />}
            {d.entities.length > 1 && (
              <Panel index="02" label={t('rep.cost.by_entity')}>
                <HBars label={t('rep.cost.by_entity')} rows={d.entities.map((e) => ({ key: e.entity, label: e.name, value: e.cost_rep_minor }))} format={fmt} />
              </Panel>
            )}
            <ReportGrid table={d.table} label={t('rep.cost.title')} />
          </>
  );
}

/* ------------------------------------------------------- leave liability */

interface Liability extends Base {
  counted_at: string;
  basis: 'payout' | 'paid';
  money: boolean;
  currency: string;
  readouts: { days: number; hours: number; value_minor: number | null; people: number };
  types: { type: string; name: string; unit: string; amount: number; value_minor: number | null; people: number }[];
  groups: { key: string; label: string; days: number; hours: number; value_minor: number | null }[];
  missing_fx: unknown[];
}

export function LiabilityReport({ query }: PageProps): React.JSX.Element {
  const money = useMoneyText();
  const basis = (query.get('basis') ?? 'payout') as Liability['basis'];
  const params = filterParams(useFilters(query), { basis });
  const r = useReport<Liability>('reports.leave-liability', params);
  return (
    <Shell title={t('rep.liability.title')} report="leave-liability" params={params} period="day" money {...r} extra={<Segmented value={basis} onChange={(v) => setQuery({ basis: v === 'payout' ? undefined : v })} label={t('rep.liability.basis')} size="sm" options={[{ value: 'payout', label: t('rep.liability.payout') }, { value: 'paid', label: t('rep.liability.paid') }]} />}>
      {(d: Liability) => {
        const fmt = (v: number): string => money(Math.round(v), d.currency, { compact: true });
        const byMoney = d.money && d.readouts.value_minor !== null;
        return (
          <>
            <div className="flex flex-col gap-3">
              <Panel index="01" label={byMoney ? t('rep.liability.by_dept_money') : t('rep.liability.by_dept_days')}>
                {d.groups.length === 0 ? <Empty icon={ChartColumn} title={t('rep.liability.none')} className="py-8" /> : <HBars label={t('rep.liability.title')} rows={[...d.groups].sort((a, b) => (byMoney ? (b.value_minor ?? 0) - (a.value_minor ?? 0) : b.days - a.days)).map((g) => ({ key: g.key === '' ? '_none' : g.key, label: g.label, value: byMoney ? g.value_minor : g.days, sub: byMoney ? t('rep.liability.days_n', { n: g.days }) : undefined }))} format={byMoney ? fmt : (v) => v.toFixed(1)} />}
              </Panel>
              <Panel index="02" label={t('rep.liability.by_type')}>
                {d.types.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.liability.none')}</p> : <HBars label={t('rep.liability.by_type')} rows={d.types.map((x) => ({ key: x.type + x.unit, label: x.name, value: x.amount, sub: x.unit === 'hour' ? t('rep.liability.hours') : t('rep.liability.days') }))} format={(v) => v.toFixed(1)} color="var(--hr-lh)" />}
              </Panel>
            </div>
            <Figures>
              <Figure label={t('rep.liability.days_total')} value={d.readouts.days} />
              {d.readouts.hours > 0 && <Figure label={t('rep.liability.hours_total')} value={d.readouts.hours} />}
              <Figure label={t('rep.f.people')} value={d.readouts.people} />
              {d.money && d.readouts.value_minor !== null && <Figure label={t('rep.liability.value')} value={<Money minor={d.readouts.value_minor} currency={d.currency} format={{ compact: true }} />} />}
            </Figures>
            {!d.money && <Notice>{t('rep.liability.days_only')}</Notice>}
            {d.missing_fx.length > 0 && <MissingFx n={d.missing_fx.length} />}
            <ReportGrid table={d.table} label={t('rep.liability.title')} />
            <Counted at={d.counted_at} report="reports.leave-liability" params={params} reload={r.reload} />
          </>
        );
      }}
    </Shell>
  );
}

/* -------------------------------------------------------------- absence */

interface Absence extends Base {
  counted_at: string;
  months: { month: string; scheduled_days: number; absent_days: number; leave_days: number; absence_pct: number; leave_pct: number; overtime_hours: number }[];
  readouts: { scheduled_days: number; absent_days: number; leave_days: number; absence_pct: number; leave_pct: number; overtime_hours: number; overtime_hours_per_person: number; late_minutes: number };
  groups: { key: string; label: string; absence_pct: number; leave_pct: number; overtime_hours: number; people: number }[];
  leave_types: { type: string; name: string; days: number }[];
}

export function AbsenceReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Absence>('reports.absence', params);
  return (
    <Shell title={t('rep.absence.title')} report="absence" params={params} period="range" {...r}>
      {(d: Absence) => (
        <>
          <Panel index="01" label={t('rep.absence.chart')} >
<Legend className="mb-2 justify-end" items={[{ label: t('rep.absence.absent'), color: 'var(--hr-bad)' }, { label: t('rep.absence.leave'), color: 'var(--hr-lh)' }, { label: t('rep.absence.overtime'), color: 'var(--hr-ink)', line: true }]} />
            <MonthChart months={d.months.map((m) => m.month)} bars={[{ key: 'a', label: t('rep.absence.absent'), color: 'var(--hr-bad)', values: d.months.map((m) => m.absent_days) }, { key: 'l', label: t('rep.absence.leave'), color: 'var(--hr-lh)', values: d.months.map((m) => m.leave_days) }]} line={{ label: t('rep.absence.overtime'), values: d.months.map((m) => m.overtime_hours) }} format={(v) => (Math.round(v * 10) / 10).toString()} lineFormat={(v) => Math.round(v) + 'h'} label={t('rep.absence.chart')} height={190} />
          </Panel>
          <Figures>
            <Figure label={t('rep.absence.rate')} value={pct(d.readouts.absence_pct)} tone={d.readouts.absence_pct >= 3 ? 'warn' : undefined} />
            <Figure label={t('rep.absence.absent_days')} value={d.readouts.absent_days} />
            <Figure label={t('rep.absence.leave_rate')} value={pct(d.readouts.leave_pct)} />
            <Figure label={t('rep.absence.leave_days')} value={d.readouts.leave_days} />
            <Figure label={t('rep.absence.overtime')} value={d.readouts.overtime_hours} sub={t('rep.absence.per_person', { v: d.readouts.overtime_hours_per_person })} />
            <Figure label={t('rep.absence.late')} value={d.readouts.late_minutes} sub={t('rep.absence.minutes')} />
          </Figures>
          <div className="flex flex-col gap-3">
            <Panel index="02" label={t('rep.absence.by_dept')}>
              {d.groups.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.no_people')}</p> : <HBars label={t('rep.absence.by_dept')} rows={d.groups.map((g) => ({ key: g.key === '' ? '_none' : g.key, label: g.label, value: g.absence_pct, sub: t('rep.absence.ot_h', { v: g.overtime_hours }) }))} format={pct} color="var(--hr-bad)" />}
            </Panel>
            <Panel index="03" label={t('rep.absence.by_type')}>
              {d.leave_types.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.absence.no_leave')}</p> : <HBars label={t('rep.absence.by_type')} rows={d.leave_types.map((x) => ({ key: x.type === '' ? '_unpaid' : x.type, label: x.name, value: x.days }))} format={(v) => v.toFixed(1)} color="var(--hr-lh)" />}
            </Panel>
          </div>
          <ReportGrid table={d.table} label={t('rep.absence.title')} />
          <Counted at={d.counted_at} report="reports.absence" params={params} reload={r.reload} />
        </>
      )}
    </Shell>
  );
}

/* --------------------------------------------------------------- hiring */

interface Hiring extends Base {
  funnel: { kind: string; count: number; conversion_pct: number }[];
  readouts: { applications: number; hired: number; hire_rate_pct: number; days_to_hire_avg: number | null; days_to_hire_median: number | null; in_process: number };
  sources: { source: string; applications: number; hired: number }[];
}

export function HiringReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Hiring>('reports.hiring', params);
  return (
    <Shell title={t('rep.hiring.title')} report="hiring" params={params} period="range" {...r}>
      {(d: Hiring) => (
        <>
          <div className="flex flex-col gap-3">
            <Panel index="01" label={t('rep.hiring.funnel')}>
              {d.readouts.applications === 0 ? <Empty icon={ChartColumn} title={t('rep.hiring.none')} className="py-8" /> : <Funnel label={t('rep.hiring.funnel')} steps={d.funnel.map((s) => ({ key: s.kind, label: t('rep.stage.' + s.kind), count: s.count, conversion: s.conversion_pct }))} />}
            </Panel>
            <Panel index="02" label={t('rep.hiring.sources')}>
              {d.sources.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.hiring.none')}</p> : <HBars label={t('rep.hiring.sources')} rows={d.sources.map((s) => ({ key: s.source, label: t('rep.source.' + s.source), value: s.applications, sub: s.hired > 0 ? t('rep.hiring.hired_n', { n: s.hired }) : undefined }))} color="var(--hr-muted)" />}
            </Panel>
          </div>
          <Figures>
            <Figure label={t('rep.hiring.applications')} value={d.readouts.applications} />
            <Figure label={t('rep.hiring.in_process')} value={d.readouts.in_process} />
            <Figure label={t('rep.hiring.hired')} value={d.readouts.hired} sub={pct(d.readouts.hire_rate_pct)} />
            <Figure label={t('rep.hiring.days_avg')} value={d.readouts.days_to_hire_avg ?? t('rep.not_yet')} sub={d.readouts.days_to_hire_avg !== null ? t('rep.days') : undefined} />
            <Figure label={t('rep.hiring.days_median')} value={d.readouts.days_to_hire_median ?? t('rep.not_yet')} sub={d.readouts.days_to_hire_median !== null ? t('rep.days') : undefined} />
          </Figures>
          <ReportGrid table={d.table} label={t('rep.hiring.title')} />
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------- training */

interface Training extends Base {
  readouts: { places: number; completed: number; completion_pct: number; no_show: number; waiting: number; failed: number; hours: number; programs: number };
  groups: { key: string; label: string; places: number; completed: number; completion_pct: number }[];
}

export function TrainingReport({ query }: PageProps): React.JSX.Element {
  const params = filterParams(useFilters(query));
  const r = useReport<Training>('reports.training', params);
  return (
    <Shell title={t('rep.training.title')} report="training" params={params} period="range" {...r}>
      {(d: Training) => {
        const programs = d.table.rows as { name: string; completion_pct: number; places: number }[];
        return (
          <>
            <div className="flex flex-col gap-3">
              <Panel index="01" label={t('rep.training.by_program')}>
                {programs.length === 0 ? <Empty icon={ChartColumn} title={t('rep.training.none')} className="py-8" /> : <HBars label={t('rep.training.by_program')} rows={programs.map((x, i) => ({ key: String(i), label: x.name, value: x.completion_pct, sub: tn('rep.training.places_n', x.places) }))} format={pct} max={100} />}
              </Panel>
              <Panel index="02" label={t('rep.training.by_dept')}>
                {d.groups.length === 0 ? <p className="text-[12px] text-[var(--hr-muted)]">{t('rep.training.none')}</p> : <HBars label={t('rep.training.by_dept')} rows={d.groups.map((g) => ({ key: g.key === '' ? '_none' : g.key, label: g.label, value: g.completion_pct, sub: tn('rep.training.places_n', g.places) }))} format={pct} max={100} color="var(--hr-lh)" />}
              </Panel>
            </div>
            <Figures>
              <Figure label={t('rep.training.completion')} value={pct(d.readouts.completion_pct)} />
              <Figure label={t('rep.training.places')} value={d.readouts.places} />
              <Figure label={t('rep.training.completed')} value={d.readouts.completed} />
              <Figure label={t('rep.training.no_show')} value={d.readouts.no_show} tone={d.readouts.no_show > 0 ? 'warn' : undefined} />
              <Figure label={t('rep.training.waiting')} value={d.readouts.waiting} />
              <Figure label={t('rep.training.hours')} value={d.readouts.hours} />
            </Figures>
            <ReportGrid table={d.table} label={t('rep.training.title')} />
          </>
        );
      }}
    </Shell>
  );
}

export const VIEWS = { headcount: HeadcountReport, movement: MovementReport, tenure: TenureReport, span: SpanReport, diversity: DiversityReport, 'comp-bands': CompBandsReport, cost: CostReport, 'leave-liability': LiabilityReport, absence: AbsenceReport, hiring: HiringReport, training: TrainingReport };

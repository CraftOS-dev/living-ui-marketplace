/**
 * Report building blocks (home-reports): the filter bar (entity, department,
 * location, period or day, reporting currency) kept in the address, the
 * table drawn from a report's `table` block, the CSV export button and the
 * readout strip.
 */
import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, DateRange, DayPicker, Money, Picker, Segmented, Select, Skeleton } from '../ui.tsx';
import type { Column, RangePreset, SegOption } from '../ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import { addMonths, dayKey, fmtDay, humanize, number as fmtNumber } from '../../lib/format.ts';
import { has, t } from '../../lib/i18n.ts';
import { setQuery } from '../../lib/router.ts';
import { pickItems, useDepartments, useOrgList } from '../../pages/people/data.ts';
import { monthLabel } from './charts.tsx';

export interface ReportTable {
  columns: { key: string; label: string; kind: 'text' | 'number' | 'money' | 'day' | 'month' | 'enum' | 'count_min5'; currency_key?: string | undefined; currency?: string | undefined }[];
  rows: Record<string, unknown>[];
}

export interface Filters {
  entity: string;
  department: string;
  location: string;
  from: string;
  to: string;
  currency: string;
}

/** The filters a report page reads from its address (empty strings when not set). */
export function useFilters(query: URLSearchParams): Filters {
  return {
    entity: query.get('entity') ?? '',
    department: query.get('department') ?? '',
    location: query.get('location') ?? '',
    from: query.get('from') ?? '',
    to: query.get('to') ?? '',
    currency: query.get('currency') ?? '',
  };
}

/** Op params from filters (empty ones left out so the server defaults apply). */
export function filterParams(f: Filters, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v !== undefined) out[k] = v;
  return out;
}

function presets(): RangePreset[] {
  const today = dayKey();
  const m0 = today.slice(0, 7) + '-01';
  return [
    { label: t('rep.range.3m'), from: addMonths(m0, -2), to: today },
    { label: t('rep.range.6m'), from: addMonths(m0, -5), to: today },
    { label: t('rep.range.12m'), from: addMonths(m0, -11), to: today },
    { label: t('rep.range.ytd'), from: today.slice(0, 4) + '-01-01', to: today },
    { label: t('rep.range.last_year'), from: String(Number(today.slice(0, 4)) - 1) + '-01-01', to: String(Number(today.slice(0, 4)) - 1) + '-12-31' },
  ];
}

/**
 * The filter bar. `period`: a date range (from and to) or a single day (to);
 * `money`: show the reporting currency; `defaults` shows what the server
 * uses when nothing is chosen.
 */
export function FilterBar({ f, period, money, defaults, children }: { f: Filters; period: 'range' | 'day'; money?: boolean | undefined; defaults: { from: string; to: string; currency: string }; children?: React.ReactNode }): React.JSX.Element {
  const me = useMe();
  const depts = useDepartments(f.entity);
  const locs = useOrgList('locations', f.entity).items;
  const entityItems = useMemo(() => me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country + ' · ' + e.currency })), [me.entities]);
  const currencies = useMemo(() => [...new Set([me.company.reporting_currency, ...me.entities.map((e) => e.currency)].filter((c) => c !== ''))], [me]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {entityItems.length > 1 && <Picker value={f.entity} onChange={(v) => setQuery({ entity: v === '' ? undefined : v, department: undefined, location: undefined })} items={entityItems} label={t('rep.f.entity')} placeholder={t('rep.f.all_entities')} clearable className="w-full sm:w-[210px]" />}
      <Picker value={f.department} onChange={(v) => setQuery({ department: v === '' ? undefined : v })} items={(depts ?? []).map((x) => ({ value: x.id, label: x.name }))} label={t('rep.f.department')} placeholder={t('rep.f.all_departments')} clearable className="w-full sm:w-[200px]" />
      <Picker value={f.location} onChange={(v) => setQuery({ location: v === '' ? undefined : v })} items={pickItems(locs)} label={t('rep.f.location')} placeholder={t('rep.f.all_locations')} clearable className="w-full sm:w-[190px]" />
      {period === 'range' ? (
        <DateRange from={f.from !== '' ? f.from : defaults.from} to={f.to !== '' ? f.to : defaults.to} onChange={(a, b) => setQuery({ from: a, to: b })} label={t('rep.f.period')} presets={presets()} className="w-full sm:w-auto" />
      ) : (
        <DayPicker value={f.to !== '' ? f.to : defaults.to} onChange={(d) => setQuery({ to: d === '' ? undefined : d })} label={t('rep.f.as_of')} className="w-full sm:w-[170px]" />
      )}
      {money === true && currencies.length > 1 && (
        <Select value={f.currency !== '' ? f.currency : defaults.currency} onChange={(e) => setQuery({ currency: e.target.value })} aria-label={t('rep.f.currency')} className="w-full sm:w-[96px]">
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}
      {children}
    </div>
  );
}

export function GroupBy<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: SegOption<T>[] }): React.JSX.Element {
  return <Segmented value={value} onChange={onChange} options={options} label={t('rep.f.group_by')} size="sm" />;
}

/** CSV of the report with the same filters (reports.export). */
export function ExportButton({ report, params, disabled }: { report: string; params: Record<string, string>; disabled?: boolean | undefined }): React.JSX.Element {
  const run = (): void => {
    void op<{ csv: string; filename: string }>('reports.export', { ...params, report })
      .then((r) => saveText(r.csv, r.filename))
      .catch(() => undefined);
  };
  return (
    <Button className="hit" size="sm" icon={Download} onClick={run} disabled={disabled}>
      {t('rep.export')}
    </Button>
  );
}

function enumText(v: string): string {
  const k = 'rep.enum.' + v;
  return has(k) ? t(k) : humanize(v);
}

/** The report's own table (its `table` block), dense and sortable, stacked rows on a phone. */
export function ReportGrid({ table, label, empty, initialSort }: { table: ReportTable; label: string; empty?: React.ReactNode; initialSort?: { key: string; dir: 'asc' | 'desc' } | undefined }): React.JSX.Element {
  const rows = useMemo(() => table.rows.map((r, i) => ({ ...r, __i: i })), [table.rows]);
  const firstText = table.columns.find((c) => c.kind === 'text')?.key ?? table.columns[0]?.key ?? '';
  const cols: Column<Record<string, unknown>>[] = table.columns.map((c, ci) => {
    const right = c.kind === 'number' || c.kind === 'money' || c.kind === 'count_min5';
    const num = (r: Record<string, unknown>): number => (typeof r[c.key] === 'number' ? (r[c.key] as number) : -Infinity);
    const width = c.key === 'number' ? '76px' : c.key === firstText ? 'minmax(150px,1.6fr)' : c.kind === 'money' ? 'minmax(144px,1.2fr)' : c.kind === 'number' || c.kind === 'count_min5' ? 'minmax(112px,0.8fr)' : c.kind === 'day' ? '120px' : c.kind === 'month' ? '96px' : 'minmax(96px,1fr)';
    return {
      key: c.key,
      label: c.label,
      align: right ? 'right' : 'left',
      mono: right || c.kind === 'day' || c.kind === 'month' || c.key === 'number',
      width,
      sort: right ? num : (r) => String(r[c.key] ?? ''),
      phone: c.key === firstText ? 'title' : ci === table.columns.length - 1 ? 'end' : ci > 3 ? 'hide' : 'sub',
      hideBelow: ci > 6 ? 'xl' : ci > 4 ? 'lg' : undefined,
      render: (r) => {
        const v = r[c.key];
        if (c.kind === 'count_min5') return v === null || v === undefined ? <span className="text-[var(--hr-muted)]">{t('rep.fewer_than_5')}</span> : String(v);
        if (v === null || v === undefined || v === '') return '';
        if (c.kind === 'money') return c.currency !== undefined ? <Money minor={v as number} currency={c.currency} /> : <Money minor={v as number} currency={String(r[c.currency_key ?? ''] ?? '')} format={{ display: 'code' }} />;
        if (c.kind === 'number') return typeof v === 'number' ? fmtNumber(v, Number.isInteger(v) ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 ? 1 : 2) : String(v);
        if (c.kind === 'day') return fmtDay(String(v));
        if (c.kind === 'month') return monthLabel(String(v), true);
        if (c.kind === 'enum') return enumText(String(v));
        return <span className="hr-wrap">{String(v)}</span>;
      },
    };
  });
  // In a panel like every other block of the report (its sticky header already wears the panel's surface).
  return (
    <div className="hr-panel hr-in min-w-0">
      <DataTable columns={cols} rows={rows} rowKey={(r) => String(r['__i'])} label={label} empty={empty ?? <p className="px-3.5 py-6 text-center text-[13px] text-[var(--hr-muted)]">{t('rep.table_empty')}</p>} initialSort={initialSort} />
    </div>
  );
}

/** One figure of a report's readout strip. */
export function Figure({ label, value, sub, tone, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'good' | 'warn' | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    // A label that wraps pushes nothing out of line: the figures of a row keep their values on one baseline at the foot.
    <div className={cn('flex min-w-0 flex-col justify-between', className)}>
      <div className="hr-label hr-wrap">{label}</div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
        <span className={cn('hr-mono hr-num truncate text-[15px] leading-tight', tone === 'bad' ? 'text-[var(--hr-bad)]' : tone === 'good' ? 'text-[var(--hr-good)]' : tone === 'warn' ? 'text-[var(--hr-warn)]' : '')}>{value}</span>
        {/* The words after a figure ("a year", "years") read in the text face, not spaced out in mono. */}
        {sub !== undefined && <span className="hr-num truncate text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

/** The shape of a report while it loads: chart, figures, table. */
export function ReportSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="hr-panel p-3.5">
        <Skeleton className="h-[190px] w-full" />
      </div>
      <div className="hr-panel p-3.5">
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="hr-panel p-3.5">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export function Figures({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="hr-panel hr-in grid grid-cols-2 gap-x-6 gap-y-4 px-3.5 py-3.5 sm:grid-cols-3 lg:grid-cols-6">{children}</div>;
}

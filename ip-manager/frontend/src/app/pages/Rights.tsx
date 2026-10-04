/**
 * Rights explorer: can we license this, where, and for how long? Pick
 * titles or properties, the dimension to compare across (territory by
 * default), narrow the other dimensions, choose a window, and read a grid
 * of availability with the agreements that explain every cell.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Globe2, Loader2, Save, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Card, Dialog, Drawer, Input, Select, Switch, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { downloadText, toCsv } from '../lib/csv.ts';
import { addMonths, fmtDate, fmtShort, today } from '../lib/format.ts';
import { href, useRoute } from '../lib/router.ts';
import type { AvailabilityCell, AvailabilityResponse, DimensionValueRec, PropertyRec, SavedViewRec, WorkRec } from '../lib/types.ts';
import { DimensionPicker, MultiRecordPicker } from '../components/pickers.tsx';
import { EmptyHint, ErrorBox, Field, JurChip, Notice, PageHeader, Pill, Section, Segmented, TONE_BG, TONE_TEXT } from '../components/ui.tsx';
import { AVAIL_LABEL, AVAIL_TONE, DateField, availStatus, enabledDims } from '../components/dealsShared.tsx';

const MAJOR_MARKETS = ['US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'JP', 'KR', 'CN', 'AU', 'BR', 'MX'];
const ASIA_PACIFIC = ['JP', 'CN', 'KR', 'TW', 'HK', 'SG', 'IN', 'AU', 'NZ'];
const AMERICAS = ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO'];
const MAX_COLUMNS = 80;

const WORK_SEARCH = ['title'];
const PROPERTY_SEARCH = ['name'];
const workLabel = (w: WorkRec): string => w.title;
const propertyLabel = (p: PropertyRec): string => p.name;

interface Query {
  works: string[];
  properties: string[];
  column: string;
  columns: string[];
  filters: Record<string, string[]>;
  start: string;
  end: string;
  exclusive: boolean;
}

interface Preset {
  key: string;
  label: string;
  codes: string[];
}

function parseIds(v: string | null): string[] {
  return (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A saved search's filters back into a query (fields missing fall back). */
function toQuery(f: Record<string, unknown> | null, fallback: Query): Query {
  if (f === null) return fallback;
  const filters: Record<string, string[]> = {};
  const rawFilters = f['filters'];
  if (rawFilters !== null && typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
    for (const [k, v] of Object.entries(rawFilters as Record<string, unknown>)) filters[k] = strings(v);
  }
  const str = (k: string, d: string): string => (typeof f[k] === 'string' ? (f[k] as string) : d);
  return {
    works: strings(f['works']),
    properties: strings(f['properties']),
    column: str('column', fallback.column),
    columns: strings(f['columns']),
    filters,
    start: str('start', fallback.start),
    end: str('end', fallback.end),
    exclusive: f['exclusive'] === true,
  };
}

function presetsFor(column: string, values: DimensionValueRec[]): Preset[] {
  const has = new Set(values.map((v) => v.code));
  const keep = (codes: string[]): string[] => codes.filter((c) => has.has(c));
  if (column === 'territory') {
    const eu = values.filter((v) => v.parent_code === 'EU').sort((a, b) => a.order - b.order).map((v) => v.code);
    return [
      { key: 'major', label: 'Major markets', codes: keep(MAJOR_MARKETS) },
      { key: 'europe', label: 'Europe', codes: keep([...eu, 'GB', 'CH', 'NO']) },
      { key: 'apac', label: 'Asia Pacific', codes: keep(ASIA_PACIFIC) },
      { key: 'americas', label: 'Americas', codes: keep(AMERICAS) },
    ].filter((p) => p.codes.length > 0);
  }
  const roots = new Set(values.filter((v) => v.parent_code === '').map((v) => v.code));
  const top = values
    .filter((v) => roots.has(v.parent_code))
    .sort((a, b) => a.order - b.order)
    .map((v) => v.code);
  const codes = top.length > 0 ? top : [...roots];
  return codes.length > 0 ? [{ key: 'top', label: 'Main categories', codes }] : [];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Short note under a partial cell: "from 01 Jul 2028", "until 30 Jun 2027". */
function partialNote(c: AvailabilityCell, start: string, end: string): string {
  const first = c.free[0];
  const last = c.free[c.free.length - 1];
  if (first === undefined || last === undefined) return '';
  if (c.free.length > 1) return `${c.free.length} free periods`;
  const opensLate = first[0] > start;
  const closesEarly = first[1] < end;
  if (opensLate && !closesEarly) return `from ${fmtDate(first[0])}`;
  if (!opensLate && closesEarly) return `until ${fmtDate(first[1])}`;
  if (opensLate && closesEarly) return `${fmtShort(first[0])} to ${fmtShort(first[1])}`;
  return 'part of the scope';
}

function cellNote(c: AvailabilityCell, start: string, end: string): string {
  const st = availStatus(c.status);
  if (st === 'partial') return partialNote(c, start, end);
  if (st === 'unavailable') {
    const refs = [...new Set(c.reasons.map((r) => r.ref ?? '').filter((r) => r !== ''))];
    return refs.length > 0 ? refs.join(', ') : '';
  }
  return '';
}

const LEGEND: { status: AvailabilityCell['status']; text: string }[] = [
  { status: 'available', text: 'free for the whole window' },
  { status: 'partial', text: 'free for part of the window or scope' },
  { status: 'unavailable', text: 'licensed out, held back or restricted' },
  { status: 'no_rights', text: 'not owned and not acquired' },
];

export function RightsPage(): React.JSX.Element {
  const { vocab, dimensions, dimValues, me } = useApp();
  const route = useRoute();
  const dims = useMemo(() => enabledDims(dimensions), [dimensions]);
  const defaultColumn = dims.find((d) => d.key === 'territory')?.key ?? dims[0]?.key ?? 'territory';

  const [works, setWorks] = useState<string[]>(() => parseIds(route.params.get('work')));
  const [props, setProps] = useState<string[]>(() => parseIds(route.params.get('property')));
  const [columnState, setColumnState] = useState('');
  const [columnsState, setColumnsState] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addMonths(today(), 24));
  const [exclusive, setExclusive] = useState(false);
  const [result, setResult] = useState<AvailabilityResponse | null>(null);
  const [ranQuery, setRanQuery] = useState<Query | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ rowIndex: number; cellIndex: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewId, setViewId] = useState('');
  const [confirmEl, confirm] = useConfirm();
  const views = useCollection<SavedViewRec>('saved_views', { filter: 'page = "rights"', sort: 'name' });

  const column = columnState !== '' && dims.some((d) => d.key === columnState) ? columnState : defaultColumn;
  const columnDim = dims.find((d) => d.key === column);
  const columnValues = useMemo(() => dimValues.filter((v) => v.dimension === column), [dimValues, column]);
  const presets = useMemo(() => presetsFor(column, columnValues), [column, columnValues]);
  const columns = columnsState ?? presets[0]?.codes ?? [];
  const otherDims = dims.filter((d) => d.key !== column);
  const labelOf = (dim: string, code: string): string => dimValues.find((v) => v.dimension === dim && v.code === code)?.label ?? code;

  const query: Query = useMemo(
    () => ({
      works,
      properties: props,
      column,
      columns,
      filters: Object.fromEntries(Object.entries(filters).filter(([k, v]) => k !== column && v.length > 0)),
      start,
      end,
      exclusive,
    }),
    [works, props, column, columns, filters, start, end, exclusive],
  );
  const stale = result !== null && ranQuery !== null && JSON.stringify(ranQuery) !== JSON.stringify(query);

  const run = async (q: Query): Promise<void> => {
    if (q.works.length + q.properties.length === 0) {
      toast.error(`Choose at least one ${vocab.work.toLowerCase()} or ${vocab.property.toLowerCase()}.`);
      return;
    }
    if (q.columns.length === 0) {
      toast.error('Choose at least one value to compare.');
      return;
    }
    if (q.columns.length > MAX_COLUMNS) {
      toast.error(`Compare at most ${MAX_COLUMNS} values at once.`);
      return;
    }
    if (q.start === '' || q.end === '' || q.end < q.start) {
      toast.error('Choose a window that ends after it starts.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await op<AvailabilityResponse>('rights/availability', {
        assets: [...q.works.map((id) => ({ type: 'work', id })), ...q.properties.map((id) => ({ type: 'property', id }))],
        column: q.column,
        columns: q.columns,
        filters: q.filters,
        start: q.start,
        end: q.end,
        exclusive: q.exclusive,
      });
      setResult(r);
      setRanQuery(q);
      setSelected(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // The grid follows new, changed or ended deals (by anyone, including an
  // agent): the last check re-runs quietly and an open cell updates in place.
  useLiveReload(
    ['grants', 'agreements', 'works', 'properties', 'dimension_values'],
    () => {
      const q = ranQuery;
      if (q === null) return;
      op<AvailabilityResponse>('rights/availability', {
        assets: [...q.works.map((id) => ({ type: 'work', id })), ...q.properties.map((id) => ({ type: 'property', id }))],
        column: q.column,
        columns: q.columns,
        filters: q.filters,
        start: q.start,
        end: q.end,
        exclusive: q.exclusive,
      })
        .then(setResult)
        .catch(() => undefined);
    },
    ranQuery !== null,
  );

  const apply = (q: Query): void => {
    setWorks(q.works);
    setProps(q.properties);
    setColumnState(q.column);
    setColumnsState(q.columns.length > 0 ? q.columns : null);
    setFilters(q.filters);
    setStart(q.start);
    setEnd(q.end);
    setExclusive(q.exclusive);
    setOpenPicker(null);
  };

  // Links from titles, properties and agreements carry ?work= / ?property=: check straight away.
  const paramKey = `${route.params.get('work') ?? ''}|${route.params.get('property') ?? ''}`;
  const autoRan = useRef('');
  useEffect(() => {
    if (paramKey === '|' || autoRan.current === paramKey) return;
    if (columns.length === 0) return;
    autoRan.current = paramKey;
    const w = parseIds(route.params.get('work'));
    const p = parseIds(route.params.get('property'));
    setWorks(w);
    setProps(p);
    void run({ ...query, works: w, properties: p });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, columns.length]);

  const changeColumn = (k: string): void => {
    setColumnState(k);
    setColumnsState(null);
    setFilters((f) => {
      const n = { ...f };
      delete n[k];
      return n;
    });
    setOpenPicker(null);
  };

  const loadView = (id: string): void => {
    setViewId(id);
    const v = views.records.find((x) => x.id === id);
    if (v === undefined) return;
    const q = toQuery(v.filters, query);
    apply(q);
    void run(q);
  };

  const currentView = views.records.find((v) => v.id === viewId);
  const deleteView = async (): Promise<void> => {
    if (currentView === undefined) return;
    if (!(await confirm(`Delete the saved search "${currentView.name}"?`, 'Delete saved search'))) return;
    try {
      await deleteRecord('saved_views', currentView.id);
      setViewId('');
      views.refresh();
      toast.success('Saved search deleted');
    } catch {
      /* toast shown by the client */
    }
  };

  const exportCsv = (): void => {
    if (result === null) return;
    const cols = [{ key: 'asset', label: 'Asset' }, ...result.columns.map((c) => ({ key: `c:${c.code}`, label: c.label }))];
    const rows = result.rows.map((r) => {
      const o: Record<string, unknown> = { asset: r.label };
      r.cells.forEach((c) => {
        const st = availStatus(c.status);
        const why = c.reasons.map((x) => x.text).join('; ');
        const note = cellNote(c, result.start, result.end);
        o[`c:${c.code}`] = `${AVAIL_LABEL[st]}${note !== '' && st === 'partial' ? ` (${note})` : ''}${why !== '' ? `: ${why}` : ''}`;
      });
      return o;
    });
    downloadText(`rights-availability-${result.start}-to-${result.end}.csv`, toCsv(cols, rows));
  };

  const assetCount = works.length + props.length;
  const sel = selected !== null && result !== null ? result.rows[selected.rowIndex] : undefined;
  const selCell = sel !== undefined && selected !== null ? sel.cells[selected.cellIndex] : undefined;

  return (
    <div>
      {confirmEl}
      <PageHeader
        title="Rights explorer"
        subtitle="Can we license this, where, and for how long? Rights you own outright are available unless licensed out; acquired rights come from agreements."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Select
            aria-label="Saved searches"
            value={viewId}
            placeholder={views.records.length > 0 ? 'Load a saved search' : 'No saved searches yet'}
            options={views.records.map((v) => ({ value: v.id, label: v.scope === 'shared' && v.owner !== me?.id ? `${v.name} (shared)` : v.name }))}
            onChange={(e) => loadView(e.target.value)}
          />
        </div>
        {currentView !== undefined && currentView.owner === me?.id && (
          <Button size="sm" variant="ghost" onClick={() => void deleteView()} aria-label="Delete this saved search">
            <Trash2 size={13} aria-hidden /> Delete
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)} disabled={assetCount === 0}>
            <Save size={13} aria-hidden /> Save search
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={result === null}>
            <Download size={13} aria-hidden /> Export CSV
          </Button>
        </div>
      </div>

      <Card className="mb-5">
        <div className="flex flex-col gap-5 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <MultiRecordPicker<WorkRec>
              collection="works"
              label={vocab.works}
              value={works}
              onChange={setWorks}
              labelOf={workLabel}
              searchFields={WORK_SEARCH}
              placeholder={`Add ${vocab.works.toLowerCase()}`}
            />
            <MultiRecordPicker<PropertyRec>
              collection="properties"
              label={vocab.properties}
              value={props}
              onChange={setProps}
              labelOf={propertyLabel}
              searchFields={PROPERTY_SEARCH}
              placeholder={`Add ${vocab.properties.toLowerCase()}`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Compare across" value={column} options={dims.map((d) => ({ value: d.key, label: d.label }))} onChange={(e) => changeColumn(e.target.value)} />
            <DateField label="Window from" value={start} onChange={setStart} />
            <DateField label="Window to" value={end} onChange={setEnd} />
            <Field label="Deal type" help="Any existing licence in scope blocks an exclusive grant.">
              <div className="flex h-9 items-center">
                <Switch checked={exclusive} onCheckedChange={setExclusive} label="Considering an exclusive deal" />
              </div>
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{columnDim?.label ?? 'Values'} to compare</span>
              {presets.map((p) => {
                const on = sameSet(p.codes, columns);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setColumnsState(p.codes)}
                    aria-pressed={on}
                    className={cn(
                      'border px-2 py-1 text-xs',
                      on
                        ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 font-medium text-[var(--agent-app-accent)]'
                        : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                aria-expanded={openPicker === '__columns'}
                onClick={() => setOpenPicker((o) => (o === '__columns' ? null : '__columns'))}
                className={cn(
                  'border px-2 py-1 text-xs',
                  openPicker === '__columns'
                    ? 'border-[var(--agent-app-accent)] text-[var(--agent-app-accent)]'
                    : 'border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                )}
              >
                Choose values
              </button>
            </div>
            <p className="text-xs text-[var(--agent-app-muted)]">
              {columns.length === 0
                ? 'Nothing chosen.'
                : `${columns.length} value${columns.length === 1 ? '' : 's'}: ${columns
                    .slice(0, 12)
                    .map((c) => labelOf(column, c))
                    .join(', ')}${columns.length > 12 ? ` and ${columns.length - 12} more` : ''}`}
            </p>
            {openPicker === '__columns' && (
              <div className="max-w-xl">
                <DimensionPicker key={column} dimension={column} value={{ include: columns }} onChange={(v) => setColumnsState(v.include ?? [])} allowExclude={false} />
              </div>
            )}
          </div>

          {otherDims.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <SlidersHorizontal size={13} aria-hidden /> Narrow by
                </span>
                {otherDims.map((d) => {
                  const chosen = filters[d.key] ?? [];
                  const on = openPicker === d.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      aria-expanded={on}
                      onClick={() => setOpenPicker((o) => (o === d.key ? null : d.key))}
                      className={cn(
                        'max-w-full truncate border px-2 py-1 text-xs',
                        chosen.length > 0
                          ? 'border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-text)]'
                          : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                        on && 'border-[var(--agent-app-accent)]',
                      )}
                    >
                      {d.label}: {chosen.length === 0 ? 'all' : chosen.map((c) => labelOf(d.key, c)).join(', ')}
                    </button>
                  );
                })}
              </div>
              {openPicker !== null && openPicker !== '__columns' && otherDims.some((d) => d.key === openPicker) && (
                <div className="max-w-xl">
                  <DimensionPicker
                    key={openPicker}
                    dimension={openPicker}
                    label={otherDims.find((d) => d.key === openPicker)?.label}
                    value={{ include: filters[openPicker] ?? [] }}
                    onChange={(v) => setFilters((f) => ({ ...f, [openPicker]: v.include ?? [] }))}
                    allowExclude={false}
                  />
                </div>
              )}
              <p className="text-xs text-[var(--agent-app-muted)]">Every value you pick here must be free for a cell to count as available.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--agent-app-border)] pt-4">
            <Button onClick={() => void run(query)} loading={busy} disabled={assetCount === 0}>
              <Search size={14} aria-hidden /> Check availability
            </Button>
            {assetCount === 0 && (
              <span className="text-xs text-[var(--agent-app-muted)]">
                Add at least one {vocab.work.toLowerCase()} or {vocab.property.toLowerCase()}.
              </span>
            )}
            {stale && !busy && <span className="text-xs text-amber-700 dark:text-amber-400">The query changed since the last check. Check again to update the grid.</span>}
          </div>
        </div>
      </Card>

      {error !== '' && (
        <div className="mb-4">
          <ErrorBox message={error} onRetry={() => void run(query)} />
        </div>
      )}

      {result === null ? (
        <Section title="Availability">
          <EmptyHint
            icon={Globe2}
            title="Check where you can license"
            message={`Pick ${vocab.works.toLowerCase()} or ${vocab.properties.toLowerCase()}, the values to compare, any media or language to narrow by, and a window. Each cell shows whether the rights are free for the whole window, part of it, or not at all, with the agreements that explain why.`}
            action={
              <Button onClick={() => void run(query)} loading={busy} disabled={assetCount === 0}>
                Check availability
              </Button>
            }
          />
        </Section>
      ) : (
        <Section
          title="Availability"
          meta={`${fmtDate(result.start)} to ${fmtDate(result.end)}${ranQuery?.exclusive === true ? ', exclusive deal' : ''}`}
          flush
          actions={busy ? <Loader2 size={14} className="animate-spin text-[var(--agent-app-muted)]" aria-hidden /> : undefined}
        >
          {ranQuery !== null && Object.keys(ranQuery.filters).length > 0 && (
            <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
              Narrowed to{' '}
              {Object.entries(ranQuery.filters)
                .map(([k, v]) => `${dims.find((d) => d.key === k)?.label ?? k}: ${v.map((c) => labelOf(k, c)).join(', ')}`)
                .join('; ')}
            </div>
          )}
          <div className={cn('overflow-x-auto', busy && 'opacity-60')}>
            <table className="border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)]">
                  <th className="sticky left-0 z-10 min-w-[11rem] max-w-[16rem] border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                    {vocab.work} or {vocab.property.toLowerCase()}
                  </th>
                  {result.columns.map((c) => (
                    <th key={c.code} className="min-w-[7.5rem] px-1.5 py-2 text-left align-bottom font-normal">
                      <div className="flex flex-col items-start gap-1">
                        {result.column === 'territory' && c.code.length === 2 && <JurChip code={c.code} />}
                        <span className="text-[11.5px] font-medium leading-tight">{c.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, ri) => (
                  <tr key={`${r.type}:${r.id}`} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <th scope="row" className="sticky left-0 z-10 min-w-[11rem] max-w-[16rem] border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2 text-left align-top font-normal">
                      <a href={href(r.type === 'property' ? 'property' : r.type === 'matter' ? 'matter' : 'work', r.id)} className="block truncate font-medium hover:underline" title={r.label}>
                        {r.label}
                      </a>
                      <div className="mt-0.5 text-[11px] leading-snug text-[var(--agent-app-muted)]">
                        {r.type === 'property' ? vocab.property : r.type === 'matter' ? 'Registration' : vocab.work}
                        {r.owned ? ` · Owned outright via ${r.owned_by}` : ''}
                      </div>
                    </th>
                    {r.cells.map((c, ci) => {
                      const st = availStatus(c.status);
                      const tone = AVAIL_TONE[st];
                      const note = cellNote(c, result.start, result.end);
                      const isSel = selected?.rowIndex === ri && selected.cellIndex === ci;
                      return (
                        <td key={c.code} className="p-1 align-top">
                          <button
                            type="button"
                            onClick={() => setSelected({ rowIndex: ri, cellIndex: ci })}
                            aria-label={`${r.label}, ${c.label}: ${AVAIL_LABEL[st]}${note !== '' ? `, ${note}` : ''}`}
                            className={cn(
                              'flex min-h-[3.25rem] w-full flex-col items-start justify-center px-2 py-1.5 text-left transition-shadow hover:ring-1 hover:ring-[var(--agent-app-text)]/30',
                              TONE_BG[tone],
                              isSel && 'ring-2 ring-[var(--agent-app-accent)]',
                            )}
                          >
                            <span className={cn('text-xs font-semibold', TONE_TEXT[tone])}>{AVAIL_LABEL[st]}</span>
                            {note !== '' && <span className="mt-0.5 text-[11px] leading-tight text-[var(--agent-app-text)]/75">{note}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--agent-app-border)] px-4 py-2.5 text-xs text-[var(--agent-app-muted)]">
            {LEGEND.map((l) => (
              <span key={l.status} className="inline-flex items-center gap-1.5">
                <span className={cn('inline-block size-3 border border-[var(--agent-app-border)]', TONE_BG[AVAIL_TONE[l.status]])} aria-hidden />
                <span className={cn('font-medium', TONE_TEXT[AVAIL_TONE[l.status]])}>{AVAIL_LABEL[l.status]}</span> {l.text}
              </span>
            ))}
            <span className="w-full sm:ml-auto sm:w-auto">Click a cell for the reasons.</span>
          </div>
        </Section>
      )}

      {sel !== undefined && selCell !== undefined && result !== null && (
        <CellDrawer
          assetLabel={sel.label}
          owned={sel.owned}
          ownedBy={sel.owned_by}
          cell={selCell}
          start={result.start}
          end={result.end}
          exclusive={ranQuery?.exclusive === true}
          onClose={() => setSelected(null)}
        />
      )}

      {saveOpen && (
        <SaveSearchDialog
          query={query}
          onClose={() => setSaveOpen(false)}
          onSaved={(v) => {
            views.refresh();
            setViewId(v.id);
            setSaveOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CellDrawer({
  assetLabel,
  owned,
  ownedBy,
  cell,
  start,
  end,
  exclusive,
  onClose,
}: {
  assetLabel: string;
  owned: boolean;
  ownedBy: string;
  cell: AvailabilityCell;
  start: string;
  end: string;
  exclusive: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const st = availStatus(cell.status);
  return (
    <Drawer open onClose={onClose} title={`${assetLabel}: ${cell.label}`} width={480}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={AVAIL_TONE[st]}>{AVAIL_LABEL[st]}</Pill>
          <span className="text-xs text-[var(--agent-app-muted)]">
            Window {fmtDate(start)} to {fmtDate(end)}
            {exclusive ? ', checked for an exclusive deal' : ''}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed">
          {owned ? `Owned outright via ${ownedBy}, so the rights are ours unless licensed out or held back.` : 'Not owned outright: only rights acquired under agreements count.'}
        </p>

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Why</h3>
          {cell.reasons.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">Nothing blocks this: the rights are free for the whole window.</p>
          ) : (
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {cell.reasons.map((r, i) => (
                <li key={`${r.code}-${i}`} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 text-[13px] last:border-0">
                  <div className="leading-relaxed">{r.text}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--agent-app-muted)]">
                    {r.agreement_id !== undefined && r.agreement_id !== '' && (
                      <a href={href('agreement', r.agreement_id)} className="font-medium text-[var(--agent-app-accent)] hover:underline" onClick={onClose}>
                        Open {r.ref !== undefined && r.ref !== '' ? r.ref : 'agreement'}
                      </a>
                    )}
                    {r.counterparty !== undefined && r.counterparty !== '' && <span>{r.counterparty}</span>}
                    {r.from !== undefined && r.from !== '' && r.to !== undefined && r.to !== '' && (
                      <span className="tabular-nums">
                        {fmtDate(r.from)} to {fmtDate(r.to)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Free periods</h3>
          {cell.free.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">None in this window.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px] tabular-nums">
              {cell.free.map(([a, b]) => (
                <li key={`${a}-${b}`}>
                  {fmtDate(a)} to {fmtDate(b)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {st === 'partial' && cell.reasons.some((r) => r.code === 'PARTIAL_SCOPE') && (
          <Notice tone="warn">Only part of what you asked for is free, for example some categories, media or languages. Use Narrow by to see exactly which part is free.</Notice>
        )}
      </div>
    </Drawer>
  );
}

function SaveSearchDialog({ query, onClose, onSaved }: { query: Query; onClose: () => void; onSaved: (v: SavedViewRec) => void }): React.JSX.Element {
  const { me } = useApp();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'private' | 'shared'>('private');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error('Give the search a name.');
      return;
    }
    if (me === null) return;
    setBusy(true);
    try {
      const v = await createRecord<SavedViewRec>('saved_views', {
        name: name.trim(),
        page: 'rights',
        filters: { ...query },
        scope,
        owner: me.id,
        schedule: 'none',
      });
      toast.success('Search saved');
      onSaved(v);
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Save this search"
      description="Keeps the assets, values, filters, window and deal type so you can run it again."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          autoFocus
          placeholder="For example: Moonlit Harbor SVOD, Europe"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <Field label="Who can see it" help={scope === 'shared' ? 'Everyone in the organization can load it.' : 'Only you.'}>
          <Segmented<'private' | 'shared'>
            value={scope}
            onChange={setScope}
            ariaLabel="Who can see it"
            options={[
              { value: 'private', label: 'Only me' },
              { value: 'shared', label: 'Everyone' },
            ]}
          />
        </Field>
      </div>
    </Dialog>
  );
}

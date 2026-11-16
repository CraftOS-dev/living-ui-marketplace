/**
 * The People and Companies tables of the Network page: 36px rows with the
 * strength bar, last contact and owner (the member who knows them best);
 * search, a band filter, saved views (views.*) and scroll pagination.
 */
import { useEffect, useState } from 'react';
import { Upload, Users } from 'lucide-react';
import { DataTable, Empty, IconButton, LoadError, PersonChip, SearchInput, Segmented, Tag } from '../ui.tsx';
import type { Column } from '../ui.tsx';
import { ImportDialog } from '../ImportDialog.tsx';
import { ago } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { BAND_TIP, NET_READS, StrengthBar } from './parts.tsx';
import type { Band, CompanyRow, PersonRow } from './types.ts';

type BandFilter = '' | Band;

const BANDS: { value: BandFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'strong', label: 'Strong' },
  { value: 'good', label: 'Good' },
  { value: 'weak', label: 'Weak' },
];

const PAGE = 50;

/** Rows paged by scroll: the first page, then more as the end of the table comes into view. */
function usePaged<R>(name: 'network.people' | 'network.companies', params: Record<string, unknown>, key: 'people' | 'companies') {
  const [limit, setLimit] = useState(PAGE);
  const filters = JSON.stringify(params);
  useEffect(() => setLimit(PAGE), [filters]);
  const live = useOp<Record<string, unknown> & { total: number }>(name, { ...params, limit }, NET_READS, { keep: true, name: name + '.page' });
  const rows = ((live.data?.[key] as R[] | undefined) ?? []) as R[];
  const total = live.data?.total ?? 0;
  return { live, rows, total, more: () => setLimit((n) => n + PAGE), hasMore: rows.length < total };
}

function Toolbar({ q, setQ, band, setBand, onImport, canImport, label }: { q: string; setQ: (v: string) => void; band: BandFilter; setBand: (b: BandFilter) => void; onImport: () => void; canImport: boolean; label: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SearchInput value={q} onChange={setQ} label={'Search ' + label} placeholder="Search" className="min-w-[180px] flex-1 sm:max-w-[260px]" />
      <Segmented value={band} onChange={setBand} options={BANDS} label="Strength" size="sm" />
      <span className="flex-1" />
      {canImport && <IconButton icon={Upload} label={'Import ' + label} onClick={onImport} />}
    </div>
  );
}

export function PeopleTable({ company }: { company?: string | undefined }): React.JSX.Element {
  const me = useMe();
  const [q, setQ] = useState('');
  const [band, setBand] = useState<BandFilter>('');
  const [importing, setImporting] = useState(false);
  const params: Record<string, unknown> = { q, band, sort: 'strength' };
  if (company !== undefined) params['company'] = company;
  const { live, rows, more, hasMore } = usePaged<PersonRow>('network.people', params, 'people');
  const columns: Column<PersonRow>[] = [
    { key: 'name', label: 'Name', width: 'minmax(200px,2fr)', fixed: true, phone: 'title', sort: (r) => r.name, render: (r) => <PersonChip name={r.name} /> },
    { key: 'company', label: 'Company', width: 'minmax(140px,1.4fr)', sort: (r) => r.company?.name ?? '', render: (r) => (r.company !== null ? <span className="vo-wrap text-[13px] text-[var(--vo-ink-2)]">{r.company.name}</span> : null) },
    { key: 'title', label: 'Title', width: 'minmax(120px,1fr)', optional: true, render: (r) => <span className="vo-wrap text-[13px] text-[var(--vo-ink-2)]">{r.title}</span> },
    { key: 'strength', label: <span title={BAND_TIP}>Strength</span>, width: '150px', sort: (r) => r.score, phone: 'end', render: (r) => <StrengthBar score={r.score} band={r.band} /> },
    { key: 'last', label: 'Last contact', width: '120px', align: 'right', mono: true, sort: (r) => r.last_at ?? '', render: (r) => <span className="text-[12px] text-[var(--vo-ink-2)]">{ago(r.last_at)}</span> },
    { key: 'owner', label: 'Owner', width: 'minmax(120px,1fr)', phone: 'hide', sort: (r) => r.owner?.name ?? '', render: (r) => (r.owner !== null ? <PersonChip name={r.owner.name} size={20} /> : null) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar q={q} setQ={setQ} band={band} setBand={setBand} label="people" canImport={company === undefined && allowed(me, 'network:edit')} onImport={() => setImporting(true)} />
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => '#/people/' + r.id}
          onMore={more}
          hasMore={hasMore}
          loadingMore={live.loading}
          stickyTop={company !== undefined ? 0 : 56}
          viewScope={company !== undefined ? undefined : 'network.people'}
          viewState={{ q, band }}
          onApplyView={(s) => {
            setQ(typeof s['q'] === 'string' ? s['q'] : '');
            setBand((typeof s['band'] === 'string' ? s['band'] : '') as BandFilter);
          }}
          empty={<Empty icon={Users} title={q !== '' || band !== '' ? 'Nobody matches' : 'No people yet'} />}
        />
      )}
      <ImportDialog open={importing} onClose={() => setImporting(false)} target="people" />
    </div>
  );
}

const RELATION: Record<string, { label: string; tone: 'a' | 'b' }> = { portfolio: { label: 'Portfolio', tone: 'a' }, pipeline: { label: 'Pipeline', tone: 'b' } };

export function CompaniesTable({ band: presetBand }: { band?: BandFilter | undefined }): React.JSX.Element {
  const me = useMe();
  const [q, setQ] = useState('');
  const [band, setBand] = useState<BandFilter>(presetBand ?? '');
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (presetBand !== undefined) setBand(presetBand);
  }, [presetBand]);
  const { live, rows, more, hasMore } = usePaged<CompanyRow>('network.companies', { q, band, sort: 'strength' }, 'companies');
  const columns: Column<CompanyRow>[] = [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(200px,2fr)',
      fixed: true,
      phone: 'title',
      sort: (r) => r.name,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonChip name={r.name} square />
          {r.relation !== '' && RELATION[r.relation] !== undefined && <Tag tone={RELATION[r.relation]?.tone}>{RELATION[r.relation]?.label}</Tag>}
        </span>
      ),
    },
    { key: 'domain', label: 'Domain', width: 'minmax(120px,1fr)', optional: true, render: (r) => <span className="vo-mono vo-wrap text-[12px] text-[var(--vo-ink-2)]">{r.domain}</span> },
    { key: 'strength', label: <span title={BAND_TIP}>Strength</span>, width: '150px', sort: (r) => r.score, phone: 'end', render: (r) => <StrengthBar score={r.score} band={r.band} /> },
    { key: 'known', label: 'Known', width: '80px', align: 'right', mono: true, sort: (r) => r.people_known, render: (r) => <span className="text-[12px]">{r.people_known}</span> },
    { key: 'last', label: 'Last contact', width: '120px', align: 'right', mono: true, sort: (r) => r.last_at ?? '', render: (r) => <span className="text-[12px] text-[var(--vo-ink-2)]">{ago(r.last_at)}</span> },
    { key: 'owner', label: 'Owner', width: 'minmax(120px,1fr)', phone: 'hide', sort: (r) => r.owner?.name ?? '', render: (r) => (r.owner !== null ? <PersonChip name={r.owner.name} size={20} /> : null) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Toolbar q={q} setQ={setQ} band={band} setBand={setBand} label="companies" canImport={allowed(me, 'network:edit')} onImport={() => setImporting(true)} />
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <DataTable
          label="Companies"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => '#/companies/' + r.id}
          onMore={more}
          hasMore={hasMore}
          loadingMore={live.loading}
          viewScope="network.companies"
          viewState={{ q, band }}
          onApplyView={(s) => {
            setQ(typeof s['q'] === 'string' ? s['q'] : '');
            setBand((typeof s['band'] === 'string' ? s['band'] : '') as BandFilter);
          }}
          empty={<Empty icon={Users} title={q !== '' || band !== '' ? 'Nothing matches' : 'No companies yet'} />}
        />
      )}
      <ImportDialog open={importing} onClose={() => setImporting(false)} target="companies" />
    </div>
  );
}


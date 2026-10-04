/**
 * People and companies: the parties directory (licensors, licensees,
 * committee members, publishers, labels, studios, agencies, creators,
 * performers, counsel, platforms). Search covers names in any script,
 * kana, other names and the company. #/people/<id> opens the detail
 * drawer with credits, agreements, committees, products and, for admins,
 * Portal access.
 */
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { enumLabel, t } from '../lib/i18n.ts';
import { navigate, useHashParam, useRoute } from '../lib/router.ts';
import type { PartyRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { ErrorBox, JurChip, Loading, PageHeader, Segmented, Tag, Toolbar } from '../components/ui.tsx';
import { PartiesEmpty, PartyDialog, PartyDrawer, aliasText, partyNameCell } from '../components/orgParty.tsx';
import { PARTY_ROLES, partyRoleLabel } from '../components/orgShared.tsx';

type KindFilter = 'all' | 'person' | 'organization';

export function PeoplePage({ id }: { id: string }): React.JSX.Element {
  const { can } = useApp();
  const route = useRoute();
  const parties = useCollection<PartyRec>('parties', { sort: 'name' });
  const [kindParam, setKind] = useHashParam('kind', 'all');
  const [role, setRole] = useHashParam('role', '');
  const [query, setQuery] = useHashParam('q', '');
  const [search, setSearch] = useState(query);
  const [editing, setEditing] = useState<PartyRec | 'new' | null>(null);
  const kind: KindFilter = kindParam === 'person' || kindParam === 'organization' ? kindParam : 'all';

  const paramsObj = (): Record<string, string> => Object.fromEntries(route.params.entries());
  const open = (pid: string): void => navigate('people', pid, paramsObj());
  const close = (): void => navigate('people', '', paramsObj());

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return parties.records.filter((p) => {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (role !== '' && !(p.roles ?? []).includes(role)) return false;
      if (term !== '') {
        const hay = [p.name, p.name_kana, p.organization, p.email, p.external_ref, p.ipi, ...(p.aliases ?? []).map(aliasText)].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [parties.records, kind, role, query]);

  const filtered = kind !== 'all' || role !== '' || query.trim() !== '';

  const columns: Col<PartyRec>[] = [
    { key: 'name', label: t('Name|party'), value: (r) => r.name, render: (r) => partyNameCell(r) },
    { key: 'kind', label: t('Kind'), value: (r) => enumLabel('parties.kind', r.kind) },
    {
      key: 'roles',
      label: t('Roles'),
      sortable: false,
      value: (r) => (r.roles ?? []).map(partyRoleLabel).join(', '),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? []).map((x) => (
            <Tag key={x}>{partyRoleLabel(x)}</Tag>
          ))}
        </div>
      ),
    },
    { key: 'country', label: t('Country'), value: (r) => r.country, render: (r) => (r.country !== '' ? <JurChip code={r.country} /> : '') },
    { key: 'email', label: t('Email|field'), render: (r) => (r.email !== '' ? <span className="text-[var(--agent-app-text)]/85">{r.email}</span> : <span className="text-[var(--agent-app-muted)]">-</span>) },
    {
      key: 'society',
      label: t('Society / IPI'),
      value: (r) => [r.society, r.ipi].filter((x) => x !== '').join(' '),
      render: (r) => (
        <span className="whitespace-nowrap text-xs">
          {r.society}
          {r.society !== '' && r.ipi !== '' ? ' · ' : ''}
          {r.ipi !== '' && <span className="font-mono">{r.ipi}</span>}
        </span>
      ),
    },
    {
      key: 'portal',
      label: t('Portal access'),
      align: 'right',
      value: (r) => (r.portal_users ?? []).length,
      render: (r) => ((r.portal_users ?? []).length > 0 ? <span className="tabular-nums">{(r.portal_users ?? []).length}</span> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    { key: 'organization', label: t('Organization|company of a person'), optional: true },
    { key: 'phone', label: t('Phone'), optional: true },
    { key: 'external_ref', label: t('External reference'), optional: true },
  ];

  const selected = id !== '' ? (parties.records.find((p) => p.id === id) ?? null) : null;

  return (
    <div>
      <PageHeader
        title={t('People and companies')}
        meta={parties.loading ? undefined : String(parties.records.length)}
        subtitle={t('Licensors, licensees, committee members, studios, agencies, creators, performers and counsel: everyone an agreement, credit or portal account points to.')}
        actions={
          can.edit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden /> {t('Add a person or company')}
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <Input
            aria-label={t('Search people and companies')}
            placeholder={t('Search name, kana, other names, company')}
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setQuery(e.target.value);
            }}
          />
        </div>
        <Segmented<KindFilter>
          ariaLabel={t('Kind')}
          value={kind}
          onChange={(v) => setKind(v)}
          options={[
            { value: 'all', label: t('All') },
            { value: 'organization', label: enumLabel('parties.kind', 'organization') },
            { value: 'person', label: enumLabel('parties.kind', 'person') },
          ]}
        />
        <div className="w-full sm:w-52">
          <Select aria-label={t('Role')} value={role} placeholder={t('Every role')} options={PARTY_ROLES.map((r) => ({ value: r, label: partyRoleLabel(r) }))} onChange={(e) => setRole(e.target.value)} />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKind('all');
              setRole('');
              setQuery('');
              setSearch('');
            }}
          >
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
        {parties.loading ? (
          <Loading />
        ) : parties.error !== null ? (
          <div className="p-4">
            <ErrorBox message={parties.error} onRetry={parties.refresh} />
          </div>
        ) : (
          <DataTable<PartyRec>
            tableId="eipm-parties"
            exportName="people-and-companies"
            rows={rows}
            columns={columns}
            onRowClick={(r) => open(r.id)}
            initialSort={{ key: 'name', dir: 'asc' }}
            empty={<PartiesEmpty canAdd={can.edit} onAdd={() => setEditing('new')} filtered={filtered} />}
          />
        )}
      </div>

      {selected !== null && <PartyDrawer party={selected} onClose={close} onEdit={() => setEditing(selected)} />}
      {editing !== null && <PartyDialog party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

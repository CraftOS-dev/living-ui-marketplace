/**
 * Production committees (製作委員会): the partnerships that finance a
 * title, with their form, status, members and lead company. Each opens to
 * its windows, money and consent requests.
 */
import { useEffect, useMemo, useState } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import { href, navigate, useHashParam, useRoute } from '../lib/router.ts';
import type { CommitteeRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, EnumPill, Loading, PageHeader, Section, Toolbar } from '../components/ui.tsx';
import { CommitteeForm, ListRowCommittee, leadOf, useCommitteeMembers } from '../components/rightsCommittee.tsx';

export function CommitteesPage(): React.JSX.Element {
  const { can, on, nameOf } = useApp();
  const route = useRoute();
  const list = useCollection<CommitteeRec>('committees', { sort: 'name' });
  const { byCommittee } = useCommitteeMembers();
  const [search, setSearch] = useHashParam('q', '');
  const [status, setStatus] = useHashParam('status', '');
  const [creating, setCreating] = useState(false);

  // Notification links use "#/committees/<id>?consent=<request>": open that committee's consent tab.
  useEffect(() => {
    if (route.id === '') return;
    const consent = route.params.get('consent') ?? '';
    navigate('committee', route.id, consent !== '' ? { tab: 'consent', consent } : {});
  }, [route.id, route.params]);

  const count = (c: CommitteeRec): number => (byCommittee.get(c.id) ?? []).filter((m) => m.status !== 'exited').length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.records.filter((c) => {
      if (status !== '' && c.status !== status) return false;
      if (q !== '') {
        const hay = `${c.name} ${c.work !== '' ? nameOf('work', c.work) : ''} ${leadOf(byCommittee.get(c.id))}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list.records, search, status, byCommittee, nameOf]);

  const cols: Col<CommitteeRec>[] = [
    { key: 'name', label: t('Name'), render: (c) => <span className="block max-w-[20rem] truncate font-medium">{c.name}</span>, value: (c) => c.name },
    {
      key: 'title',
      label: t('Title'),
      render: (c) =>
        c.work !== '' && on('titles') ? (
          <a href={href('title', c.work)} onClick={(e) => e.stopPropagation()} className="block max-w-[16rem] truncate hover:underline">
            {nameOf('work', c.work)}
          </a>
        ) : (
          <span className="block max-w-[16rem] truncate">{c.work !== '' ? nameOf('work', c.work) : ''}</span>
        ),
      value: (c) => (c.work !== '' ? nameOf('work', c.work) : ''),
    },
    { key: 'form', label: t('Form|committee'), value: (c) => enumLabel('committees.form', c.form) },
    { key: 'status', label: t('Status'), render: (c) => <EnumPill field="committees.status" value={c.status} />, value: (c) => enumLabel('committees.status', c.status) },
    { key: 'members', label: t('Members'), align: 'right', value: count },
    { key: 'lead', label: t('Lead company'), render: (c) => <span className="block max-w-[14rem] truncate">{leadOf(byCommittee.get(c.id))}</span>, value: (c) => leadOf(byCommittee.get(c.id)) },
  ];

  const filtered = search !== '' || status !== '';

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('Committees')}
        meta={list.loading ? undefined : String(list.records.length)}
        subtitle={t('The production committees that finance your titles: members and shares, who holds each window, distributions and consent.')}
        actions={
          can.rights ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden /> {t('New committee')}
            </Button>
          ) : undefined
        }
      />
      <Toolbar>
        <div className="w-full sm:w-64">
          <Input aria-label={t('Search')} placeholder={t('Search name, title or lead company')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label={t('Status')} value={status} placeholder={t('Any status')} options={enumOptions('committees.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setStatus('');
            }}
          >
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>
      <Section title={t('Committees')} meta={filtered ? tn(rows.length, '{n} match', '{n} matches') : undefined} flush>
        {list.loading ? (
          <Loading />
        ) : list.records.length === 0 ? (
          <EmptyHint
            icon={Landmark}
            title={t('No committees yet')}
            message={t('Add the production committee behind a title: its members and shares, the windows each member holds, and how distributions flow.')}
            action={can.rights ? <Button onClick={() => setCreating(true)}>{t('New committee')}</Button> : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyHint compact title={t('Nothing matches these filters')} />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<CommitteeRec> tableId="committees" rows={rows} columns={cols} onRowClick={(c) => navigate('committee', c.id)} exportName="committees" />
            </div>
            <div className="md:hidden">
              {rows.map((c) => (
                <ListRowCommittee key={c.id} c={c} list={byCommittee.get(c.id)} onOpen={() => navigate('committee', c.id)} />
              ))}
            </div>
          </>
        )}
      </Section>
      {creating && <CommitteeForm committee={null} onClose={() => setCreating(false)} onSaved={(c) => navigate('committee', c.id)} />}
    </div>
  );
}

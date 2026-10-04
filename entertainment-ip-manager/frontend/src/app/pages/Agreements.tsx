/**
 * Agreements: every contract in and out (original-work licences, committee
 * agreements, creator commissions, talent contracts, merchandise and
 * overseas licences, music deals), filtered by type, direction, status,
 * counterparty and upcoming expiry. New agreements by hand, or from a
 * contract that CraftBot reads and proposes in the Inbox.
 */
import { useMemo, useState } from 'react';
import { Bot, FileSignature, Plus } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { addDays, d10, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, PartyRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { Checkbox, EmptyHint, EnumPill, ListRow, Loading, PageHeader, Ref, Section, Toolbar } from '../components/ui.tsx';
import { AgreementForm, ContractReadDialog } from '../components/rightsAgreementForm.tsx';
import { royaltySummary } from '../components/rightsAgreementTabs.tsx';
import { termText } from '../components/rightsShared.tsx';

function counterpartyOf(a: AgreementRec): string {
  const p = ((a.expand ?? {}) as Record<string, unknown>)['counterparty'] as PartyRec | undefined;
  return p?.name ?? '';
}

export function AgreementsPage(): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<AgreementRec>('agreements', { sort: '-updated', expand: 'counterparty' });
  const [search, setSearch] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [dir, setDir] = useHashParam('dir', '');
  const [status, setStatus] = useHashParam('status', '');
  const [expiring, setExpiring] = useHashParam('expiring', '');
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = today();
    const to = addDays(from, 90);
    return list.records.filter((a) => {
      if (type !== '' && a.agreement_type !== type) return false;
      if (dir !== '' && a.direction !== dir) return false;
      if (status !== '' && a.status !== status) return false;
      if (expiring === '1') {
        const end = d10(a.term_end);
        if (a.perpetual || end === '' || end < from || end > to) return false;
        if (['expired', 'terminated', 'superseded'].includes(a.status)) return false;
      }
      if (q !== '') {
        const hay = `${a.ref} ${a.title} ${counterpartyOf(a)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list.records, search, type, dir, status, expiring]);

  const filtered = search !== '' || type !== '' || dir !== '' || status !== '' || expiring !== '';
  const clear = (): void => {
    setSearch('');
    setType('');
    setDir('');
    setStatus('');
    setExpiring('');
  };

  const cols: Col<AgreementRec>[] = [
    { key: 'ref', label: t('Ref'), render: (a) => <Ref>{a.ref}</Ref>, value: (a) => a.ref },
    { key: 'title', label: t('Title|field'), render: (a) => <span className="block max-w-[22rem] truncate font-medium">{a.title}</span>, value: (a) => a.title },
    { key: 'type', label: t('Type'), render: (a) => <span className="whitespace-nowrap">{enumLabel('agreements.agreement_type', a.agreement_type)}</span>, value: (a) => enumLabel('agreements.agreement_type', a.agreement_type) },
    { key: 'direction', label: t('Direction'), value: (a) => enumLabel('agreements.direction', a.direction), optional: true },
    { key: 'counterparty', label: t('Counterparty'), render: (a) => <span className="block max-w-[14rem] truncate">{counterpartyOf(a)}</span>, value: counterpartyOf },
    { key: 'term', label: t('Term|agreement'), render: (a) => <span className="whitespace-nowrap tabular-nums">{termText(a)}</span>, value: (a) => d10(a.term_end) || d10(a.term_start) },
    { key: 'status', label: t('Status'), render: (a) => <EnumPill field="agreements.status" value={a.status} />, value: (a) => enumLabel('agreements.status', a.status) },
    { key: 'royalty', label: t('Royalty'), render: (a) => <span className="block max-w-[16rem] truncate text-[var(--agent-app-text)]/80">{royaltySummary(a)}</span>, value: royaltySummary },
  ];

  const opts = (key: string): { value: string; label: string }[] => enumOptions(key).map(([value, label]) => ({ value, label }));

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('Agreements')}
        meta={list.loading ? undefined : String(list.records.length)}
        subtitle={t('Every contract in and out, with its terms, grants and the deadlines they create.')}
        actions={
          <>
            {can.contribute && (
              <Button variant="outline" onClick={() => setReading(true)}>
                <Bot size={14} aria-hidden /> {t('From a contract')}
              </Button>
            )}
            {can.edit && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden /> {t('New agreement')}
              </Button>
            )}
          </>
        }
      />

      <Toolbar>
        <div className="w-full sm:w-64">
          <Input aria-label={t('Search')} placeholder={t('Search ref, title or counterparty')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select aria-label={t('Type')} value={type} placeholder={t('All types')} options={opts('agreements.agreement_type')} onChange={(e) => setType(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-36">
          <Select aria-label={t('Direction')} value={dir} placeholder={t('In and out')} options={opts('agreements.direction')} onChange={(e) => setDir(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-40">
          <Select aria-label={t('Status')} value={status} placeholder={t('Any status')} options={opts('agreements.status')} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Checkbox checked={expiring === '1'} onChange={(v) => setExpiring(v ? '1' : '')} label={t('Ends within 90 days')} />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      <Section title={t('Agreements')} meta={filtered ? tn(rows.length, '{n} match', '{n} matches') : undefined} flush>
        {list.loading ? (
          <Loading />
        ) : list.records.length === 0 ? (
          <EmptyHint
            icon={FileSignature}
            title={t('No agreements yet')}
            message={t('Add the contracts you work under: original-work licences, committee agreements, creator commissions, talent contracts and the licences you grant. Or upload a contract and let CraftBot propose it.')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {can.contribute && (
                  <Button variant="outline" onClick={() => setReading(true)}>
                    {t('From a contract')}
                  </Button>
                )}
                {can.edit && <Button onClick={() => setCreating(true)}>{t('New agreement')}</Button>}
              </div>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyHint compact title={t('Nothing matches these filters')} action={<Button size="sm" variant="outline" onClick={clear}>{t('Clear filters')}</Button>} />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<AgreementRec> tableId="agreements" rows={rows} columns={cols} onRowClick={(a) => navigate('agreement', a.id)} exportName="agreements" />
            </div>
            <div className="md:hidden">
              {rows.map((a) => (
                <ListRow
                  key={a.id}
                  onClick={() => navigate('agreement', a.id)}
                  primary={a.title}
                  secondary={[a.ref, enumLabel('agreements.agreement_type', a.agreement_type), counterpartyOf(a), termText(a)].filter((x) => x !== '').join(' · ')}
                  trailing={<EnumPill field="agreements.status" value={a.status} />}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {creating && <AgreementForm agreement={null} onClose={() => setCreating(false)} onSaved={(rec) => navigate('agreement', rec.id)} />}
      {reading && <ContractReadDialog onClose={() => setReading(false)} />}
    </div>
  );
}

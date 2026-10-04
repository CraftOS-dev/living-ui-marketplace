/**
 * Agreements: every option, licence, talent, distribution and merchandise
 * deal in one list, filterable by direction, type, status and property,
 * with the next obligation each one carries.
 */
import { useMemo, useState } from 'react';
import { Bot, FileSignature, Plus, Search } from 'lucide-react';
import { Button, Select, Switch } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, d10, deadlineSeverity, fmtDate, fmtShort, today } from '../lib/format.ts';
import { AGREEMENT_TYPE_LABEL } from '../lib/labels.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, DeadlineRec, PartyRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, ErrorBox, Loading, PageHeader, Ref, Section, Segmented, TONE_TEXT, Toolbar } from '../components/ui.tsx';
import { AgreementForm } from '../components/dealsAgreementForm.tsx';
import { ReadContractDialog } from '../components/dealsReadContract.tsx';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABEL,
  AgreementStatusPill,
  CURRENT_STATUSES,
  DirectionPill,
  EXCLUSIVITY_LABEL,
  expandOne,
} from '../components/dealsShared.tsx';

const TYPE_OPTIONS = Object.entries(AGREEMENT_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = [
  { value: 'current', label: 'Active, negotiating, draft' },
  { value: 'all', label: 'All statuses' },
  ...AGREEMENT_STATUSES.map((s) => ({ value: s, label: `${AGREEMENT_STATUS_LABEL[s]} only` })),
];

type Direction = 'all' | 'in' | 'out';

export function AgreementsPage(): React.JSX.Element {
  const { can, vocab, properties, propertyName } = useApp();
  const [q, setQ] = useHashParam('q', '');
  const [dirParam, setDir] = useHashParam('dir', 'all');
  const [type, setType] = useHashParam('type', '');
  const [status, setStatus] = useHashParam('status', 'current');
  const [property, setProperty] = useHashParam('property', '');
  const [ending, setEnding] = useHashParam('ending', '');
  const [form, setForm] = useState(false);
  const [reader, setReader] = useState(false);

  const dir: Direction = dirParam === 'in' || dirParam === 'out' ? dirParam : 'all';
  const agreements = useCollection<AgreementRec>('agreements', { sort: '-updated', expand: 'counterparty' });
  const obligations = useCollection<DeadlineRec>('deadlines', { filter: 'status = "open" && agreement != ""', sort: 'due_date' });

  const nextByAgreement = useMemo(() => {
    const m = new Map<string, DeadlineRec>();
    for (const d of obligations.records) {
      const cur = m.get(d.agreement);
      if (cur === undefined || d10(d.due_date) < d10(cur.due_date)) m.set(d.agreement, d);
    }
    return m;
  }, [obligations.records]);

  const counterpartyName = (a: AgreementRec): string => expandOne<PartyRec>(a, 'counterparty')?.name ?? '';

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const now = today();
    const horizon = addDays(now, 180);
    return agreements.records.filter((a) => {
      if (dir !== 'all' && a.direction !== dir) return false;
      if (type !== '' && a.agreement_type !== type) return false;
      if (status === 'current' && !CURRENT_STATUSES.includes(a.status)) return false;
      if (status !== 'current' && status !== 'all' && a.status !== status) return false;
      if (property !== '' && a.property !== property) return false;
      if (ending === '1') {
        const end = d10(a.term_end);
        if (a.perpetual || end === '' || end < now || end > horizon) return false;
      }
      if (term !== '') {
        const hay = [a.ref, a.title, a.territory_summary, a.our_entity, expandOne<PartyRec>(a, 'counterparty')?.name ?? '', AGREEMENT_TYPE_LABEL[a.agreement_type]]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [agreements.records, q, dir, type, status, property, ending]);

  const filtered = q !== '' || dir !== 'all' || type !== '' || status !== 'current' || property !== '' || ending !== '';
  const clearFilters = (): void => {
    setQ('');
    setDir('all');
    setType('');
    setStatus('current');
    setProperty('');
    setEnding('');
  };

  const columns: Col<AgreementRec>[] = [
    { key: 'ref', label: 'Ref', render: (a) => <Ref className="whitespace-nowrap">{a.ref}</Ref> },
    { key: 'title', label: 'Title', render: (a) => <span className="block min-w-[11rem] font-medium">{a.title}</span> },
    { key: 'agreement_type', label: 'Type', value: (a) => AGREEMENT_TYPE_LABEL[a.agreement_type], render: (a) => <span className="whitespace-nowrap">{AGREEMENT_TYPE_LABEL[a.agreement_type]}</span> },
    { key: 'direction', label: 'Direction', render: (a) => <DirectionPill direction={a.direction} /> },
    { key: 'counterparty', label: 'Counterparty', value: counterpartyName, render: (a) => counterpartyName(a) || <span className="text-[var(--agent-app-muted)]">-</span> },
    { key: 'status', label: 'Status', value: (a) => AGREEMENT_STATUS_LABEL[a.status], render: (a) => <AgreementStatusPill status={a.status} /> },
    { key: 'term_start', label: 'Term start', value: (a) => d10(a.term_start), render: (a) => <span className="whitespace-nowrap tabular-nums">{fmtDate(a.term_start)}</span> },
    {
      key: 'term_end',
      label: 'Term end',
      value: (a) => (a.perpetual ? '9999-12-31' : d10(a.term_end)),
      render: (a) => <span className="whitespace-nowrap tabular-nums">{a.perpetual ? 'Perpetual' : fmtDate(a.term_end)}</span>,
    },
    { key: 'exclusivity', label: 'Exclusivity', value: (a) => EXCLUSIVITY_LABEL[a.exclusivity] ?? '', render: (a) => EXCLUSIVITY_LABEL[a.exclusivity] ?? '' },
    {
      key: 'next',
      label: 'Next obligation',
      value: (a) => d10(nextByAgreement.get(a.id)?.due_date ?? ''),
      render: (a) => {
        const d = nextByAgreement.get(a.id);
        if (d === undefined) return <span className="text-[var(--agent-app-muted)]">-</span>;
        const sev = deadlineSeverity(d);
        return (
          <div className="min-w-[10rem] max-w-[16rem]">
            <div className="truncate text-[12.5px]" title={d.title}>
              {d.title}
            </div>
            <div className={`text-xs tabular-nums ${TONE_TEXT[sev.tone]}`}>
              {fmtShort(d.due_date)} · {sev.label}
            </div>
          </div>
        );
      },
    },
    { key: 'property', label: vocab.property, value: (a) => propertyName(a.property), render: (a) => propertyName(a.property) },
  ];

  const total = agreements.records.length;

  return (
    <div>
      <PageHeader
        title="Agreements"
        meta={agreements.loading ? undefined : String(total)}
        subtitle="Options, licences, talent, distribution and merchandise deals. Their dates become deadlines automatically."
        actions={
          can.edit ? (
            <>
              <Button variant="outline" onClick={() => setReader(true)}>
                <Bot size={14} aria-hidden />
                <span className="hidden sm:inline">Read a contract with CraftBot</span>
                <span className="sm:hidden">Read a contract</span>
              </Button>
              <Button onClick={() => setForm(true)}>
                <Plus size={14} aria-hidden /> New agreement
              </Button>
            </>
          ) : undefined
        }
      />

      <Toolbar>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <input
            aria-label="Search agreements"
            placeholder="Search title, ref, counterparty"
            className="h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] pl-8 pr-2 text-sm placeholder:text-[var(--agent-app-muted)]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented<Direction>
          value={dir}
          onChange={(v) => setDir(v)}
          ariaLabel="Direction"
          options={[
            { value: 'all', label: 'All' },
            { value: 'in', label: 'Rights in' },
            { value: 'out', label: 'Rights out' },
          ]}
        />
        <div className="w-full sm:w-44">
          <Select aria-label="Type" value={type} placeholder="All types" options={TYPE_OPTIONS} onChange={(e) => setType(e.target.value)} />
        </div>
        <div className="w-full sm:w-60">
          <Select aria-label="Status" value={status} options={STATUS_OPTIONS} onChange={(e) => setStatus(e.target.value)} />
        </div>
        {properties.length > 0 && (
          <div className="w-full sm:w-44">
            <Select
              aria-label={vocab.property}
              value={property}
              placeholder={`All ${vocab.properties.toLowerCase()}`}
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(e) => setProperty(e.target.value)}
            />
          </div>
        )}
        <Switch checked={ending === '1'} onCheckedChange={(v) => setEnding(v ? '1' : '')} label="Ending within 180 days" />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      {agreements.error !== null && agreements.records.length === 0 ? (
        <ErrorBox message={agreements.error} onRetry={agreements.refresh} />
      ) : agreements.loading ? (
        <Loading label="Loading agreements" />
      ) : total === 0 ? (
        <Section title="Agreements">
          <EmptyHint
            icon={FileSignature}
            title="No agreements yet"
            message="Add options, licences and deals here. Term ends, notice periods, payments and royalty reports then show up as deadlines on their own."
            action={
              can.edit ? (
                <Button onClick={() => setForm(true)}>
                  <Plus size={14} aria-hidden /> New agreement
                </Button>
              ) : undefined
            }
          />
        </Section>
      ) : (
        <Section title={filtered ? 'Matching agreements' : status === 'current' ? 'Current agreements' : 'Agreements'} flush>
          <DataTable<AgreementRec>
            tableId="agreements"
            exportName="agreements"
            rows={rows}
            columns={columns}
            onRowClick={(a) => navigate('agreement', a.id)}
            initialSort={{ key: 'next', dir: 'asc' }}
            empty={
              <EmptyHint
                compact
                icon={Search}
                title="No agreements match these filters"
                message={status === 'current' ? 'Expired, terminated and superseded agreements are hidden. Choose All statuses to include them.' : 'Try a broader search or fewer filters.'}
                action={
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            }
          />
        </Section>
      )}

      {form && <AgreementForm onClose={() => setForm(false)} onSaved={(a) => navigate('agreement', a.id)} />}
      {reader && <ReadContractDialog onClose={() => setReader(false)} />}
    </div>
  );
}

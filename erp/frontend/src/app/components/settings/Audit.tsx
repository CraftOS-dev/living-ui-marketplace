/**
 * The audit trail: who did what and when, a person (by name), your AI agent
 * or the app itself. Filter by who, the kind of record, dates and words;
 * open an entry to see everything it recorded.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, ScrollText } from 'lucide-react';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import type { AuditList } from '../../lib/types/settings.ts';
import type { AuditEntry } from '../../lib/types.ts';
import { ENTITY_WORD, humanize, openRecord, stamp } from '../agent/words.ts';
import { SearchBox, Segmented, useDebounced } from '../controls.tsx';
import type { Option } from '../pickers.tsx';
import { DateField, MemberPicker } from '../pickers.tsx';
import { DataTable, Pager } from '../table.tsx';
import { ActorPill, Avatar, Card, Empty, LoadError, Modal, PillButton, PillSelect } from '../ui.tsx';

const LIMIT = 50;

const ENTITIES: { value: string; label: string }[] = [
  { value: '', label: 'Every kind of record' },
  { value: 'documents', label: 'Documents' },
  { value: 'payments', label: 'Payments' },
  { value: 'journals', label: 'Journal entries' },
  { value: 'parties', label: 'Customers and suppliers' },
  { value: 'items', label: 'Items' },
  { value: 'stock_changes', label: 'Stock changes' },
  { value: 'banks', label: 'Bank accounts' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'employees', label: 'Employees' },
  { value: 'expense_claims', label: 'Expense claims' },
  { value: 'leave_requests', label: 'Leave' },
  { value: 'payroll_runs', label: 'Pay runs' },
  { value: 'projects', label: 'Projects' },
  { value: 'builds', label: 'Builds' },
  { value: 'assets', label: 'Fixed assets' },
  { value: 'proposals', label: 'Proposals' },
  { value: 'members', label: 'Members and sign-ins' },
  { value: 'roles', label: 'Roles' },
  { value: 'settings', label: 'Settings' },
];

type Who = '' | 'person' | 'agent' | 'system';

export function AuditSection(): React.JSX.Element {
  const [who, setWho] = useState<Who>('');
  const [member, setMember] = useState<Option | null>(null);
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const key = JSON.stringify([who, member?.id, entity, from, to, q]);
  useEffect(() => setOffset(0), [key]);

  const data = useLive(
    () =>
      op<AuditList>(
        'audit.list',
        { actor: who === '' ? undefined : who, member: who === 'person' ? member?.id : undefined, entity: entity === '' ? undefined : entity, from: from === '' ? undefined : from, to: to === '' ? undefined : to, q: q === '' ? undefined : q, limit: LIMIT, offset },
        { quiet: true },
      ),
    ['audit'],
    [key, offset],
  );

  return (
    <div className="flex flex-col gap-5">
      <Card delay={1}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Who>
              ariaLabel="Who"
              value={who}
              onChange={setWho}
              options={[
                { value: '', label: 'Everyone' },
                { value: 'person', label: 'People' },
                { value: 'agent', label: 'Your AI agent' },
                { value: 'system', label: 'The app' },
              ]}
            />
            {who === 'person' && <MemberPicker value={member} onChange={setMember} clearable placeholder="Any person" className="w-full @min-[480px]:w-64" />}
          </div>
          <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
            <PillSelect soft ariaLabel="Kind of record" value={entity} onChange={setEntity} options={ENTITIES} />
            <DateField value={from} onChange={setFrom} ariaLabel="From" optional placeholder="From" />
            <DateField value={to} onChange={setTo} ariaLabel="To" optional placeholder="To" align="right" />
            <SearchBox value={text} onChange={setText} placeholder="Search" ariaLabel="Search the audit trail" soft />
          </div>
        </div>
      </Card>

      <Card delay={2}>
        {data.data === null && data.error !== null ? (
          <LoadError message={data.error} onRetry={data.reload} />
        ) : (
          <>
            <DataTable
              ariaLabel="Audit trail"
              loading={data.data === null}
              rows={data.data?.entries ?? []}
              rowKey={(e) => e.id}
              onOpen={setOpen}
              dense
              empty={<Empty icon={ScrollText} title="Nothing matches" />}
              columns={[
                { key: 'at', label: 'When', width: '150px', render: (e) => <span className="num text-[13px] text-[var(--erp-ink-2)]">{stamp(e.at)}</span> },
                {
                  key: 'who',
                  label: 'Who',
                  width: 'minmax(0, 1fr)',
                  render: (e) =>
                    e.actor === 'person' ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={e.who} size={26} />
                        <span className="truncate text-[13px] font-semibold">{e.who}</span>
                      </span>
                    ) : (
                      <ActorPill actor={e.actor} />
                    ),
                },
                { key: 'what', label: 'What happened', width: 'minmax(0, 2.6fr)', render: (e) => <span className="truncate">{e.summary}</span> },
                { key: 'rec', label: 'Record', width: 'minmax(0, 1fr)', hide: 'lg', render: (e) => <span className="truncate text-[13px] text-[var(--erp-muted)]">{e.label !== '' ? e.label : (ENTITY_WORD[e.entity] ?? humanize(e.entity))}</span> },
              ]}
              mobile={(e) => ({ title: e.summary, sub: `${e.who} · ${stamp(e.at)}` })}
            />
            {data.data !== null && <Pager offset={offset} limit={LIMIT} total={data.data.total} onChange={setOffset} />}
          </>
        )}
      </Card>
      {open !== null && <EntryModal e={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EntryModal({ e, onClose }: { e: AuditEntry; onClose: () => void }): React.JSX.Element {
  const go = openRecord(e.entity, e.ref);
  return (
    <Modal
      open
      onClose={onClose}
      title={e.summary}
      description={`${e.who}, ${stamp(e.at)}`}
      size="lg"
      footer={
        go !== null ? (
          <PillButton
            icon={ArrowUpRight}
            onClick={() => {
              onClose();
              go();
            }}
          >
            Open the {ENTITY_WORD[e.entity] ?? 'record'}
          </PillButton>
        ) : undefined
      }
    >
      <dl className="flex flex-col text-[14px]">
        {[
          ['Who', e.actor === 'person' ? e.who : e.actor === 'agent' ? 'Your AI agent' : 'The app'],
          ['Kind of event', humanize(e.kind)],
          ['Record', `${ENTITY_WORD[e.entity] ?? humanize(e.entity)}${e.label !== '' ? `: ${e.label}` : ''}`],
          ['When', stamp(e.at)],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--erp-line)] py-2.5 last:border-b-0">
            <dt className="text-[13px] font-semibold text-[var(--erp-muted)]">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {e.data !== null && e.data !== undefined && (
        <pre className="num mt-4 max-h-72 overflow-auto rounded-[18px] bg-[var(--erp-row)] p-4 text-[12px] leading-5 text-[var(--erp-ink-2)]">{JSON.stringify(e.data, null, 2)}</pre>
      )}
    </Modal>
  );
}

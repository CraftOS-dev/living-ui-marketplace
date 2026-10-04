/**
 * Settings, Audit log (people who can edit): every create, change and
 * delete made through the app, with who, when and why. A row opens the
 * change as a readable list of fields (from and to), or the deleted
 * record's last contents.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, FileClock, X } from 'lucide-react';
import { Button, Drawer, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, fmtDateTime, today } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { AuditRec } from '../lib/types.ts';
import type { Tone } from '../lib/labels.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { EmptyHint, ErrorBox, Fact, FactGrid, Loading, Pill, Section } from './ui.tsx';
import { fmtAny } from './adminShared.tsx';

const COLLECTION_LABEL: Record<string, string> = {
  matters: 'Matter',
  families: 'Family',
  properties: 'Property',
  works: 'Work',
  agreements: 'Agreement',
  grants: 'Rights grant',
  goods_services: 'Goods and services',
  deadlines: 'Deadline',
  renewals: 'Renewal',
  documents: 'Document',
  parties: 'Person or company',
  involvements: 'Involvement',
  clearances: 'Clearance',
  approvals: 'Product approval',
  disputes: 'Dispute',
  watch_hits: 'Watch hit',
  disclosures: 'Invention',
  rules: 'Deadline rule',
  settings: 'Organization settings',
  users: 'User',
  fee_schedule: 'Fee',
  fx_rates: 'Exchange rate',
  office_calendars: 'Closure day',
  dimension_values: 'Dimension value',
  scoring_criteria: 'Scoring criterion',
  royalty_reports: 'Royalty report',
  events: 'Event',
  inbox_items: 'Inbox item',
  office_connections: 'Office connection',
};

const ACTION_TONE: Record<string, Tone> = { create: 'good', update: 'info', delete: 'bad', import: 'accent' };
const ACTION_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  import: 'Imported',
  accept: 'Accepted',
  reject: 'Rejected',
  decide: 'Decided',
  close: 'Closed',
  extend: 'Extended',
  move: 'Moved',
  instruct: 'Instructed',
  event: 'Recorded event',
  regenerate: 'Recalculated',
  sync: 'Synced',
};

const LINKS: Record<string, Page> = {
  matters: 'matter',
  families: 'family',
  properties: 'property',
  works: 'work',
  agreements: 'agreement',
  disclosures: 'invention',
  parties: 'people',
};

const SKIP_FIELDS = new Set(['collectionId', 'collectionName', 'id', 'created', 'updated', 'expand']);

function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ');
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'from' in v && 'to' in v;
}

function fieldLabel(k: string): string {
  const s = k.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AuditTab(): React.JSX.Element {
  const { users, userName } = useApp();
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [collection, setCollection] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [open, setOpen] = useState<AuditRec | null>(null);

  const filter = useMemo(() => {
    const parts: string[] = [];
    if (from !== '') parts.push(`created >= "${from} 00:00:00.000Z"`);
    if (to !== '') parts.push(`created <= "${to} 23:59:59.999Z"`);
    if (collection !== '') parts.push(`collection = ${q(collection)}`);
    if (action !== '') parts.push(`action = ${q(action)}`);
    if (actor === 'system') parts.push('actor = ""');
    else if (actor !== '') parts.push(`actor = ${q(actor)}`);
    return parts.join(' && ');
  }, [from, to, collection, action, actor]);

  const log = useCollection<AuditRec>('audit_log', { filter, sort: '-created' });
  const filtered = collection !== '' || action !== '' || actor !== '';

  const who = (r: AuditRec): string => r.actor_name || (r.actor !== '' ? userName(r.actor) : 'System');

  const columns: Col<AuditRec>[] = [
    { key: 'created', label: 'When', value: (r) => r.created, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(r.created)}</span> },
    { key: 'who', label: 'Who', value: (r) => who(r) },
    { key: 'action', label: 'Action', value: (r) => actionLabel(r.action), render: (r) => <Pill tone={ACTION_TONE[r.action] ?? 'neutral'}>{actionLabel(r.action)}</Pill> },
    { key: 'collection', label: 'Record type', value: (r) => COLLECTION_LABEL[r.collection] ?? r.collection },
    { key: 'record_label', label: 'Record', render: (r) => <span className="font-medium">{r.record_label}</span> },
    { key: 'changes', label: 'Fields', sortable: false, value: (r) => (r.action === 'update' && r.changes !== null ? Object.keys(r.changes).join(', ') : ''), render: (r) => <span className="line-clamp-1 text-xs text-[var(--agent-app-muted)]">{r.action === 'update' && r.changes !== null ? Object.keys(r.changes).map(fieldLabel).join(', ') : ''}</span> },
    { key: 'reason', label: 'Reason', render: (r) => <span className="line-clamp-2 text-xs">{r.reason}</span> },
  ];

  const datesBad = from !== '' && to !== '' && from > to;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Audit log" meta={log.loading ? undefined : `${log.records.length} entries`} flush>
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
          <div className="w-36">
            <Input label="From" type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-36">
            <Input label="To" type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="w-44">
            <Select
              label="Record type"
              className="h-8"
              value={collection}
              placeholder="All"
              options={Object.entries(COLLECTION_LABEL)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([value, label]) => ({ value, label }))}
              onChange={(e) => setCollection(e.target.value)}
            />
          </div>
          <div className="w-32">
            <Select label="Action" className="h-8" value={action} placeholder="All" options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="w-44">
            <Select
              label="Who"
              className="h-8"
              value={actor}
              placeholder="Anyone"
              options={[...users.map((u) => ({ value: u.id, label: u.name || u.email })), { value: 'system', label: 'System and CraftBot' }]}
              onChange={(e) => setActor(e.target.value)}
            />
          </div>
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCollection('');
                setAction('');
                setActor('');
              }}
            >
              <X size={12} aria-hidden /> Clear
            </Button>
          )}
        </div>
        {datesBad ? (
          <div className="p-4">
            <ErrorBox message="The start date is after the end date." />
          </div>
        ) : log.loading ? (
          <Loading />
        ) : log.error !== null ? (
          <div className="p-4">
            <ErrorBox message={log.error} onRetry={log.refresh} />
          </div>
        ) : (
          <DataTable<AuditRec>
            tableId="audit-log"
            exportName={`audit-log-${from}-to-${to}`}
            rows={log.records}
            columns={columns}
            dense
            onRowClick={(r) => setOpen(r)}
            empty={<EmptyHint compact icon={FileClock} title="No entries" message="Nothing was recorded for these filters. Try a wider date range." />}
          />
        )}
      </Section>
      {open !== null && <AuditDrawer entry={open} who={who(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AuditDrawer({ entry, who, onClose }: { entry: AuditRec; who: string; onClose: () => void }): React.JSX.Element {
  const { users } = useApp();
  const names = new Map(users.map((u) => [u.id, u.name || u.email]));
  /** Values, with user ids shown as the person's name. */
  const show = (v: unknown): string => (typeof v === 'string' && names.has(v) ? (names.get(v) ?? v) : fmtAny(v));
  const changes = entry.changes ?? {};
  const page = LINKS[entry.collection];
  const deleted = entry.action === 'delete' ? changes['deleted'] : undefined;
  const snapshot = typeof deleted === 'object' && deleted !== null && !Array.isArray(deleted) ? (deleted as Record<string, unknown>) : null;
  const fromTo = Object.entries(changes).filter(([, v]) => isFromTo(v)) as [string, { from: unknown; to: unknown }][];
  const other = Object.entries(changes).filter(([k, v]) => !isFromTo(v) && !(entry.action === 'delete' && k === 'deleted'));

  return (
    <Drawer open onClose={onClose} title={`${actionLabel(entry.action)}: ${entry.record_label || (COLLECTION_LABEL[entry.collection] ?? entry.collection)}`} width={600}>
      <div className="flex flex-col gap-6">
        <FactGrid cols={2}>
          <Fact label="When" value={fmtDateTime(entry.created)} />
          <Fact label="Who" value={who} />
          <Fact label="Record type" value={COLLECTION_LABEL[entry.collection] ?? entry.collection} />
          <Fact
            label="Record"
            value={
              page !== undefined && entry.action !== 'delete' && entry.record_id !== '' ? (
                <a className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline" href={href(page, entry.record_id)}>
                  {entry.record_label || 'Open'} <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                entry.record_label
              )
            }
          />
        </FactGrid>
        {entry.reason !== '' && (
          <div>
            <div className="text-[11px] text-[var(--agent-app-muted)]">Reason</div>
            <div className="mt-0.5 text-[13px]">{entry.reason}</div>
          </div>
        )}

        {fromTo.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">What changed</h4>
            <dl className="border border-[var(--agent-app-border)]">
              {fromTo.map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-[12px] font-medium">{fieldLabel(k)}</dt>
                  <dd className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-[13px]">
                    <span className="break-words text-[var(--agent-app-muted)] line-through decoration-[var(--agent-app-muted)]/50">{show(v.from)}</span>
                    <ArrowRight size={12} className="shrink-0 self-center text-[var(--agent-app-muted)]" aria-hidden />
                    <span className="break-words">{show(v.to)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {snapshot !== null && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Contents when deleted</h4>
            <dl className="border border-[var(--agent-app-border)]">
              {Object.entries(snapshot)
                .filter(([k, v]) => !SKIP_FIELDS.has(k) && v !== '' && v !== null && v !== false && !(Array.isArray(v) && v.length === 0))
                .map(([k, v]) => (
                  <div key={k} className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <dt className="text-[12px] font-medium">{fieldLabel(k)}</dt>
                    <dd className="break-words text-[13px]">{show(v)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        {other.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Details</h4>
            <dl className="border border-[var(--agent-app-border)]">
              {other.map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-[12px] font-medium">{fieldLabel(k)}</dt>
                  <dd className="break-words text-[13px]">{show(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {fromTo.length === 0 && snapshot === null && other.length === 0 && (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{entry.action === 'create' ? 'The record was created. Open it to see its current contents.' : 'No field details were recorded for this entry.'}</p>
        )}
      </div>
    </Drawer>
  );
}

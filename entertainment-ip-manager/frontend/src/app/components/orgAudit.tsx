/**
 * Settings, Audit log (managers): every create, change, delete and
 * decision made through the app or an agent, newest first, with who, when
 * and why. A row opens the change as a readable list of fields (from and
 * to), or the deleted record's last contents; the raw JSON stays collapsed.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, FileClock, X } from 'lucide-react';
import { Button, Drawer, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, fmtDateTime, today } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { RECORD_PAGE, href } from '../lib/router.ts';
import type { AuditRec } from '../lib/records.ts';
import type { Tone } from '../lib/labels.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { EmptyHint, ErrorBox, Fact, FactGrid, Loading, Pill, Section } from './ui.tsx';
import { SubHeading, collectionLabel, fmtAny } from './orgShared.tsx';

const ACTION_TONE: Record<string, Tone> = { create: 'good', update: 'info', delete: 'bad', import: 'accent', publish: 'good', decide: 'accent', submit: 'info' };
const ACTIONS = ['create', 'update', 'delete', 'import', 'accept', 'reject', 'decide', 'close', 'extend', 'move', 'instruct', 'event', 'regenerate', 'sync', 'publish', 'submit', 'resubmit', 'withdraw'];
const COLLECTIONS = [
  'matters', 'families', 'franchises', 'titles', 'characters', 'talents', 'committees', 'committee_members', 'agreements', 'grants', 'deadlines', 'renewals', 'documents',
  'parties', 'involvements', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'songs', 'recordings', 'permissions', 'guidelines', 'fan_registrations',
  'enforcement_cases', 'watch_hits', 'rules', 'settings', 'users', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'events', 'inbox_items',
  'office_connections', 'consent_requests', 'distributions',
];
const SKIP_FIELDS = new Set(['collectionId', 'collectionName', 'id', 'created', 'updated', 'expand']);

function actionLabel(a: string): string {
  return (
    {
      create: t('Created'),
      update: t('Changed'),
      delete: t('Deleted'),
      import: t('Imported'),
      accept: t('Accepted'),
      reject: t('Rejected'),
      decide: t('Decided'),
      close: t('Closed'),
      extend: t('Extended'),
      move: t('Moved'),
      instruct: t('Instructed'),
      event: t('Recorded event'),
      regenerate: t('Recalculated'),
      sync: t('Synced'),
      publish: t('Published'),
      submit: t('Submitted'),
      resubmit: t('Resubmitted'),
      withdraw: t('Withdrawn'),
    }[a] ?? a.replace(/_/g, ' ')
  );
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'from' in v && 'to' in v;
}

function fieldLabel(k: string): string {
  return k.replace(/_/g, ' ');
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
  const who = (r: AuditRec): string => r.actor_name || (r.actor !== '' ? userName(r.actor) : t('System or CraftBot'));

  const columns: Col<AuditRec>[] = [
    { key: 'created', label: t('When|audit'), value: (r) => r.created, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(r.created)}</span> },
    { key: 'who', label: t('Who'), value: (r) => who(r) },
    { key: 'action', label: t('Action'), value: (r) => actionLabel(r.action), render: (r) => <Pill tone={ACTION_TONE[r.action] ?? 'neutral'}>{actionLabel(r.action)}</Pill> },
    { key: 'collection', label: t('Record type'), value: (r) => collectionLabel(r.collection) },
    { key: 'record_label', label: t('Record'), render: (r) => <span className="font-medium">{r.record_label}</span> },
    {
      key: 'changes',
      label: t('Fields'),
      sortable: false,
      value: (r) => (r.action === 'update' && r.changes !== null ? Object.keys(r.changes).join(', ') : ''),
      render: (r) => <span className="line-clamp-1 text-xs text-[var(--agent-app-muted)]">{r.action === 'update' && r.changes !== null ? Object.keys(r.changes).map(fieldLabel).join(', ') : ''}</span>,
    },
    { key: 'reason', label: t('Reason'), render: (r) => <span className="line-clamp-2 text-xs">{r.reason}</span> },
  ];

  const datesBad = from !== '' && to !== '' && from > to;

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('Audit log')} meta={log.loading ? undefined : t('{n} entries', { n: log.records.length })} flush>
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
          <div className="w-[calc(50%-0.25rem)] sm:w-36">
            <Input label={t('From')} type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-36">
            <Input label={t('To')} type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label={t('Record type')}
              className="h-8"
              value={collection}
              placeholder={t('All')}
              options={COLLECTIONS.map((c) => ({ value: c, label: collectionLabel(c) })).sort((a, b) => a.label.localeCompare(b.label))}
              onChange={(e) => setCollection(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select label={t('Action')} className="h-8" value={action} placeholder={t('All')} options={ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label={t('Who')}
              className="h-8"
              value={actor}
              placeholder={t('Anyone')}
              options={[...users.map((u) => ({ value: u.id, label: u.name || u.email })), { value: 'system', label: t('System or CraftBot') }]}
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
              <X size={12} aria-hidden /> {t('Clear')}
            </Button>
          )}
        </div>
        {datesBad ? (
          <div className="p-4">
            <ErrorBox message={t('The start date is after the end date.')} />
          </div>
        ) : log.loading ? (
          <Loading />
        ) : log.error !== null ? (
          <div className="p-4">
            <ErrorBox message={log.error} onRetry={log.refresh} />
          </div>
        ) : (
          <DataTable<AuditRec>
            tableId="eipm-audit-log"
            exportName={`audit-log-${from}-to-${to}`}
            rows={log.records}
            columns={columns}
            dense
            onRowClick={(r) => setOpen(r)}
            empty={<EmptyHint compact icon={FileClock} title={t('No entries')} message={t('Nothing was recorded for these filters. Try a wider date range.')} />}
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
  const show = (v: unknown): string => (typeof v === 'string' && names.has(v) ? (names.get(v) ?? v) : fmtAny(v));
  const changes = entry.changes ?? {};
  const page = RECORD_PAGE[entry.collection];
  const deleted = entry.action === 'delete' ? changes['deleted'] : undefined;
  const snapshot = typeof deleted === 'object' && deleted !== null && !Array.isArray(deleted) ? (deleted as Record<string, unknown>) : null;
  const fromTo = Object.entries(changes).filter(([, v]) => isFromTo(v)) as [string, { from: unknown; to: unknown }][];
  const other = Object.entries(changes).filter(([k, v]) => !isFromTo(v) && !(entry.action === 'delete' && k === 'deleted'));

  const list = (rows: [string, unknown][]): React.JSX.Element => (
    <dl className="border border-[var(--agent-app-border)]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-mono text-[12px]">{fieldLabel(k)}</dt>
          <dd className="break-words text-[13px]">{show(v)}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <Drawer open onClose={onClose} title={`${actionLabel(entry.action)}: ${entry.record_label || collectionLabel(entry.collection)}`} width={620}>
      <div className="flex flex-col gap-6">
        <FactGrid cols={2}>
          <Fact label={t('When|audit')} value={fmtDateTime(entry.created)} />
          <Fact label={t('Who')} value={who} />
          <Fact label={t('Record type')} value={collectionLabel(entry.collection)} />
          <Fact
            label={t('Record')}
            value={
              page !== undefined && entry.action !== 'delete' && entry.record_id !== '' ? (
                <a className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline" href={href(page, entry.record_id)}>
                  {entry.record_label || t('Open|action')} <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                entry.record_label
              )
            }
          />
        </FactGrid>
        {entry.reason !== '' && (
          <div>
            <SubHeading>{t('Reason')}</SubHeading>
            <p className="break-words text-[13px]">{entry.reason}</p>
          </div>
        )}
        {fromTo.length > 0 && (
          <div>
            <SubHeading>{t('What changed')}</SubHeading>
            <dl className="border border-[var(--agent-app-border)]">
              {fromTo.map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="font-mono text-[12px]">{fieldLabel(k)}</dt>
                  <dd className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-[13px]">
                    <span className="break-all text-[var(--agent-app-muted)] line-through decoration-[var(--agent-app-muted)]/50">{show(v.from)}</span>
                    <ArrowRight size={12} className="shrink-0 self-center text-[var(--agent-app-muted)]" aria-hidden />
                    <span className="break-all">{show(v.to)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {snapshot !== null && (
          <div>
            <SubHeading>{t('Contents when deleted')}</SubHeading>
            {list(Object.entries(snapshot).filter(([k, v]) => !SKIP_FIELDS.has(k) && v !== '' && v !== null && v !== false && !(Array.isArray(v) && v.length === 0)))}
          </div>
        )}
        {other.length > 0 && (
          <div>
            <SubHeading>{t('Details')}</SubHeading>
            {list(other)}
          </div>
        )}
        {fromTo.length === 0 && snapshot === null && other.length === 0 && (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{entry.action === 'create' ? t('The record was created. Open it to see its current contents.') : t('No field details were recorded for this entry.')}</p>
        )}
        {entry.changes !== null && Object.keys(changes).length > 0 && (
          <details className="text-xs">
            <summary className="select-none text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">{t('Raw changes (JSON)')}</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-2 font-mono text-[11px]">{JSON.stringify(changes, null, 2)}</pre>
          </details>
        )}
      </div>
    </Drawer>
  );
}

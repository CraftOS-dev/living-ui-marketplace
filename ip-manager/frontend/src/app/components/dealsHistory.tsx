/**
 * Readable audit trail for a record and its parts: who did what, when,
 * which fields changed (before and after), and the reason given.
 */
import { History } from 'lucide-react';
import { useCollection } from '../lib/live.ts';
import { ago, d10, fmtDate, fmtDateTime } from '../lib/format.ts';
import type { AuditRec } from '../lib/types.ts';
import { EmptyHint, ErrorBox, IdentityChip, Loading, Section } from './ui.tsx';
import { humanKey } from './dealsShared.tsx';

const VERB: Record<string, string> = {
  create: 'created',
  update: 'changed',
  delete: 'deleted',
  sync: 'updated the obligations of',
  event: 'recorded an event on',
  decide: 'decided on',
};

const COLLECTION_NOUN: Record<string, string> = {
  agreements: 'the agreement',
  grants: 'a grant',
  royalty_reports: 'a royalty report',
  approvals: 'a product',
  deadlines: 'a deadline',
  documents: 'a document',
};

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(v) && d10(v) !== '') return fmtDate(v);
    return v.length > 80 ? `${v.slice(0, 77)}...` : v;
  }
  if (Array.isArray(v)) return v.length === 0 ? 'none' : `${v.length} item${v.length === 1 ? '' : 's'}`;
  return 'updated';
}

function changeLines(e: AuditRec): string[] {
  const ch = e.changes ?? {};
  if (e.action === 'update') {
    return Object.entries(ch).map(([k, v]) => {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'from' in v && 'to' in v) {
        const fv = (v as { from: unknown; to: unknown }).from;
        const tv = (v as { from: unknown; to: unknown }).to;
        return `${humanKey(k)}: ${fmtValue(fv)} → ${fmtValue(tv)}`;
      }
      return `${humanKey(k)} changed`;
    });
  }
  if (e.action === 'sync') {
    const n = (k: string): number => (typeof ch[k] === 'number' ? (ch[k] as number) : 0);
    return [`${n('created')} added, ${n('updated')} updated, ${n('cancelled')} cancelled`];
  }
  if (e.action === 'decide') {
    return Object.entries(ch).map(([k, v]) => `${humanKey(k)}: ${fmtValue(v)}`);
  }
  if (e.action === 'event') {
    const label = typeof ch['label'] === 'string' ? ch['label'] : typeof ch['code'] === 'string' ? ch['code'] : '';
    return label !== '' ? [label] : [];
  }
  return [];
}

/** Audit filter for a record and its parts (ids), plus any extra clause. */
export function auditFilter(recordIds: string[], extra?: string | undefined): string {
  const parts = recordIds.filter((id) => id !== '').map((id) => `record_id = "${id}"`);
  if (extra !== undefined && extra !== '') parts.push(`(${extra})`);
  return parts.length > 0 ? parts.join(' || ') : 'record_id = "-"';
}

export function AuditTrail({ filter, title = 'History' }: { filter: string; title?: string | undefined }): React.JSX.Element {
  const log = useCollection<AuditRec>('audit_log', { filter, sort: '-created' });

  return (
    <Section title={title} meta={log.records.length ? String(log.records.length) : undefined} flush>
      {log.error !== null && log.records.length === 0 ? (
        <div className="p-4">
          <ErrorBox message={log.error} onRetry={log.refresh} />
        </div>
      ) : log.loading ? (
        <Loading label="Loading history" />
      ) : log.records.length === 0 ? (
        <EmptyHint compact icon={History} title="No history yet" message="Every change to this record, with who made it and why, is listed here." />
      ) : (
        <ol>
          {log.records.map((e) => {
            const who = e.actor_name !== '' ? e.actor_name : e.actor !== '' ? 'Someone' : 'IP Manager';
            const lines = changeLines(e);
            return (
              <li key={e.id} className="flex gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                <IdentityChip name={who} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[13px]">
                      <span className="font-medium">{who}</span> {VERB[e.action] ?? e.action} {COLLECTION_NOUN[e.collection] ?? humanKey(e.collection).toLowerCase()}
                      {e.collection !== 'agreements' && e.collection !== 'grants' && e.record_label !== '' && <span className="text-[var(--agent-app-muted)]"> ({e.record_label})</span>}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--agent-app-muted)]" title={fmtDateTime(e.created)}>
                      {ago(e.created)}
                    </span>
                  </div>
                  {lines.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {lines.map((l, i) => (
                        <li key={`${i}-${l}`} className="break-words text-xs text-[var(--agent-app-text)]/80">
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.reason !== '' && <p className="mt-1 text-xs italic text-[var(--agent-app-muted)]">Reason: {e.reason}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

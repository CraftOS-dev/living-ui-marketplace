import { useMemo, useState } from 'react';
import { EmptyState, PageHeader, SearchInput, Section, Select, Spinner, Table, Toolbar } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { AlertIcon } from '../components/icons.tsx';
import { SeverityPill, StatusPill } from '../components/pills.tsx';
import { CATEGORY_LABELS, categoryLabel, relTime, severityRank } from '../lib/format.ts';
import type { Asset, Finding } from '../lib/types.ts';
import { issueTitle, useDetailed } from '../lib/view.tsx';
import { IssueIcon } from '../components/visual.tsx';
import { ListRow } from '../../kit/index.ts';

const STATUS_FILTERS: Record<string, string> = {
  active: 'status = "open" || status = "acknowledged"',
  open: 'status = "open"',
  acknowledged: 'status = "acknowledged"',
  suppressed: 'status = "suppressed"',
  resolved: 'status = "resolved"',
};

export function Findings({ onOpenFinding, embedded, initialStatus }: { onOpenFinding: (id: string) => void; embedded?: boolean; initialStatus?: string | undefined }): React.JSX.Element {
  const [status, setStatus] = useState(initialStatus ?? 'active');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const detailed = useDetailed();
  const findings = useCollection<Finding>('findings', { filter: STATUS_FILTERS[status] ?? STATUS_FILTERS['active']!, sort: '-last_seen' });
  const assets = useCollection<Asset>('assets');
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);

  const q = query.toLowerCase();
  const rows = findings.records
    .filter(
      (f) =>
        (severity === '' || f.severity === severity) &&
        (category === '' || f.category === category) &&
        (q === '' || f.title.toLowerCase().includes(q) || (f.plain_title || '').toLowerCase().includes(q) || (names[f.asset] ?? '').includes(q) || f.rule_id.toLowerCase().includes(q)),
    )
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.last_seen < b.last_seen ? 1 : -1));

  return (
    <>
      {!embedded && <PageHeader title="Problems" meta={String(rows.length)} />}
      {detailed && (
        <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
          Every problem NetSentry found. An issue closes by itself when the next check no longer sees it.
        </p>
      )}
      <Toolbar>
        <div className="w-full sm:w-56">
          <SearchInput placeholder="Search problems" onSearch={setQuery} label="Search problems" />
        </div>
        <div className="w-full sm:w-44">
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'active', label: 'Not fixed yet' },
              { value: 'open', label: 'Needs attention' },
              { value: 'acknowledged', label: 'Being handled' },
              { value: 'suppressed', label: 'Muted' },
              { value: 'resolved', label: 'Fixed' },
            ]}
          />
        </div>
        <div className="w-full sm:w-36">
          <Select
            aria-label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            options={[
              { value: '', label: detailed ? 'All severities' : 'Any urgency' },
              { value: 'critical', label: detailed ? 'Critical — act now' : 'Urgent' },
              { value: 'high', label: detailed ? 'High — today' : 'Important' },
              { value: 'medium', label: detailed ? 'Medium — this week' : 'Soon' },
              { value: 'low', label: detailed ? 'Low — when convenient' : 'When you have time' },
              { value: 'info', label: detailed ? 'Info' : 'For your information' },
            ]}
          />
        </div>
        {detailed && <div className="w-full sm:w-40">
          <Select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[{ value: '', label: 'All areas' }, ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]}
          />
        </div>}
      </Toolbar>
      <Section title="Problems" meta={String(rows.length)} flush>
        {findings.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : findings.error !== null ? (
          <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">Could not load issues: {findings.error}</p>
        ) : findings.records.length === 0 ? (
          <EmptyState
            icon={<AlertIcon size={20} />}
            title={status === 'active' ? 'No issues' : 'Nothing here'}
            message={status === 'active' ? 'Everything NetSentry checks currently passes.' : undefined}
          />
        ) : !detailed ? (
          rows.length === 0 ? (
            <EmptyState title="Nothing matches" message="Try another filter." />
          ) : (
            rows.map((f) => (
              <ListRow
                key={f.id}
                leading={
                  <span className="text-[var(--agent-app-muted)]">
                    <IssueIcon finding={f} size={20} />
                  </span>
                }
                primary={issueTitle(f, false)}
                secondary={`${names[f.asset] ?? ''} · noticed ${relTime(f.first_seen)}`}
                trailing={f.status === 'open' ? <SeverityPill severity={f.severity} /> : <StatusPill status={f.status} />}
                onClick={() => onOpenFinding(f.id)}
              />
            ))
          )
        ) : (
          <div className="overflow-x-auto">
            <Table<Finding>
              rows={rows}
              rowKey={(f) => f.id}
              emptyMessage="No issues match these filters."
              columns={[
                { key: 'sev', header: 'Severity', render: (f) => <SeverityPill severity={f.severity} action={f.status === 'open' || f.status === 'acknowledged'} /> },
                {
                  key: 'title',
                  header: 'Issue',
                  render: (f) => (
                    <button type="button" className="text-left font-medium text-[var(--agent-app-accent)] hover:underline" onClick={() => onOpenFinding(f.id)}>
                      {f.title}
                    </button>
                  ),
                },
                { key: 'asset', header: 'On', render: (f) => <span className="text-[13px]">{names[f.asset] ?? '—'}</span> },
                { key: 'area', header: 'Area', render: (f) => <span className="text-[13px]">{categoryLabel(f.category)}</span> },
                { key: 'seen', header: 'Last confirmed', render: (f) => relTime(f.last_seen) },
                { key: 'status', header: 'Status', render: (f) => <StatusPill status={f.status} /> },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}

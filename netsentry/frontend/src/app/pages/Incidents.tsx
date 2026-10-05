import { useMemo, useState } from 'react';
import { EmptyState, ListRow, PageHeader, Pill, Section, Select, Spinner, Toolbar } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { ShieldIcon } from '../components/icons.tsx';
import { SeverityPill } from '../components/pills.tsx';
import { incidentStatusTone, relTime, severityRank } from '../lib/format.ts';
import { CASE_STATUS } from '../lib/words.ts';
import { caseTitle, useDetailed } from '../lib/view.tsx';
import type { Asset, Incident } from '../lib/types.ts';

const FILTERS: Record<string, string> = {
  active: 'status = "new" || status = "investigating"',
  triage: 'needs_triage = true && (status = "new" || status = "investigating")',
  mitigated: 'status = "mitigated"',
  closed: 'status = "closed" || status = "false_positive"',
};

export function Incidents({ onOpenIncident, embedded }: { onOpenIncident: (id: string) => void; embedded?: boolean }): React.JSX.Element {
  const [view, setView] = useState('active');
  const detailed = useDetailed();
  const incidents = useCollection<Incident>('incidents', { filter: FILTERS[view] ?? FILTERS['active']!, sort: '-last_activity' });
  const assets = useCollection<Asset>('assets');
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  // A single issue is shown as that issue in the Issues tab, not as a "case".
  const singles = incidents.records.filter((i) => i.finding_count <= 1).length;
  const rows = [...incidents.records.filter((i) => i.finding_count > 1)].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.last_activity < b.last_activity ? 1 : -1),
  );

  return (
    <>
      {!embedded && <PageHeader title="Cases" meta={String(rows.length)} />}
      {detailed && (
        <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
          When serious issues show up on the server, NetSentry groups them into one case so they are looked at together — by your agent or your team.
        </p>
      )}
      <Toolbar>
        <div className="w-full sm:w-56">
          <Select
            aria-label="Show"
            value={view}
            onChange={(e) => setView(e.target.value)}
            options={[
              { value: 'active', label: 'Open' },
              { value: 'triage', label: 'Waiting for a look' },
              { value: 'mitigated', label: 'Contained' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        </div>
      </Toolbar>
      <Section title="Cases" meta={String(rows.length)} flush>
        {singles > 0 && rows.length > 0 && (
          <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">
            {singles} serious issue{singles === 1 ? ' stands' : 's stand'} on its own and {singles === 1 ? 'is' : 'are'} listed in the Issues tab.
          </p>
        )}
        {incidents.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : incidents.error !== null ? (
          <p className="px-4 py-6 text-sm text-red-600 dark:text-red-400">Could not load cases: {incidents.error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ShieldIcon size={20} />}
            title={view === 'active' ? 'No open cases' : 'Nothing here'}
            message={
              view === 'active'
                ? singles
                  ? `No groups of related issues right now. ${singles} serious issue${singles === 1 ? ' is' : 's are'} in the Issues tab.`
                  : 'When several serious issues show up together on the server, they are grouped here.'
                : undefined
            }
          />
        ) : (
          rows.map((i) => (
            <ListRow
              key={i.id}
              leading={<SeverityPill severity={i.severity} />}
              primary={caseTitle(i, names[i.root_asset] ?? '', detailed)}
              secondary={`${names[i.root_asset] ?? '—'} · ${i.finding_count} issue${i.finding_count === 1 ? '' : 's'} · opened ${relTime(i.opened_at)} · last activity ${relTime(i.last_activity)}`}
              trailing={
                <div className="flex flex-wrap justify-end gap-1.5">
                  {i.needs_triage && (i.status === 'new' || i.status === 'investigating') ? (
                    <Pill tone="warn">Waiting for a look</Pill>
                  ) : (
                    <Pill tone={incidentStatusTone(i.status)}>{CASE_STATUS[i.status] ?? i.status}</Pill>
                  )}
                </div>
              }
              onClick={() => onOpenIncident(i.id)}
            />
          ))
        )}
      </Section>
    </>
  );
}

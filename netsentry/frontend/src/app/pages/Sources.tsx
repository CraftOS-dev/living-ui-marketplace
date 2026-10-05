import { NamedSwitch } from '../components/NamedSwitch.tsx';
import { useMemo, useState } from 'react';
import { Button, EmptyState, PageHeader, Pill, Section, Spinner, Switch, Table, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { HealthPill } from '../components/pills.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { COLLECTOR_LABELS, pbSince, relTime } from '../lib/format.ts';
import { CHECK_HELP } from '../lib/words.ts';
import type { Asset, ScanRun, Source } from '../lib/types.ts';

export function Sources({ embedded }: { embedded?: boolean }): React.JSX.Element {
  const { can } = useMe();
  const since = useMemo(() => pbSince(24), []);
  const sources = useCollection<Source>('sources', { sort: 'collector' });
  const runs = useCollection<ScanRun>('scan_runs', { filter: `started >= "${since}"`, sort: '-started' });
  const assets = useCollection<Asset>('assets');
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  const [busy, setBusy] = useState<string | null>(null);

  const runNow = async (s: Source): Promise<void> => {
    setBusy(s.id);
    try {
      const r = await runOp<{ status: string; observations?: number; changes?: number; note?: string; error?: string }>('sources.run-now', { source_id: s.id });
      if (r.status === 'ok') toast.success(`${COLLECTOR_LABELS[s.collector] ?? s.collector}: ${r.observations ?? 0} observations, ${r.changes ?? 0} changes.`);
      else if (r.status === 'skipped') toast.info(r.note ?? 'Skipped.');
      else toast.error(r.error ?? 'Source failed.');
    } catch {
      /* toast shown */
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (s: Source, enabled: boolean): Promise<void> => {
    try {
      await runOp('sources.set-enabled', { source_id: s.id, enabled });
      toast.success(`${COLLECTOR_LABELS[s.collector] ?? s.collector} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch {
      /* toast shown */
    }
  };

  const ordered = [...sources.records].sort((a, b) => Number(Boolean(a.target)) - Number(Boolean(b.target)) || a.collector.localeCompare(b.collector));

  return (
    <>
      {!embedded && <PageHeader title="Checks" meta={String(sources.records.length)} />}
      <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
        Every check NetSentry runs, on which item, and whether it works. Checks that fail retry automatically with growing pauses.
      </p>

      <Section title="Checks" meta={String(sources.records.length)} flush>
        {sources.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : sources.records.length === 0 ? (
          <EmptyState title="No checks yet" message="Checks are set up automatically when you protect something." />
        ) : (
          <div className="overflow-x-auto">
            <Table<Source>
              rows={ordered}
              rowKey={(s) => s.id}
              columns={[
                {
                  key: 'collector',
                  header: 'Check',
                  render: (s) => (
                    <div>
                      <p className="font-medium">{COLLECTOR_LABELS[s.collector] ?? s.collector}</p>
                      <p className="text-[12px] text-[var(--agent-app-muted)]">{s.target ? names[s.target] ?? '—' : 'Threat intelligence (shared)'}</p>
                    </div>
                  ),
                },
                { key: 'health', header: 'State', render: (s) => (s.enabled ? <HealthPill health={s.health} error={s.last_error} /> : <Pill tone="neutral">Disabled</Pill>) },
                { key: 'last', header: 'Last run', render: (s) => (s.last_run ? relTime(s.last_run) : '—') },
                { key: 'next', header: 'Next run', render: (s) => (!s.enabled ? '—' : s.sensor ? 'Reported by the monitor' : relTime(s.next_run)) },
                {
                  key: 'error',
                  header: 'Last problem',
                  render: (s) => (
                    <span className="line-clamp-2 max-w-xs text-[12px] text-[var(--agent-app-muted)]">
                      {s.last_error.startsWith('Not available') ? CHECK_HELP[s.collector]?.enable ?? s.last_error : s.last_error || '—'}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (s) => (
                    <div className="flex items-center justify-end gap-3">
                      {can('admin') && <NamedSwitch checked={s.enabled} onCheckedChange={(v) => void toggle(s, v)} label={s.enabled ? 'Enabled' : 'Disabled'} />}
                      {can('analyst') && !s.sensor && (
                        <Button size="sm" variant="secondary" disabled={!s.enabled} loading={busy === s.id} onClick={() => void runNow(s)}>
                          Run now
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Section>

      <Section title="Check history (last 24 hours)" meta={String(runs.records.length)} className="mt-6" flush>
        {runs.records.length === 0 ? (
          <EmptyState title="No runs in the last 24 hours" />
        ) : (
          <div className="overflow-x-auto">
            <Table<ScanRun>
              rows={runs.records.slice(0, 100)}
              rowKey={(r) => r.id}
              columns={[
                { key: 'when', header: 'When', render: (r) => relTime(r.started) },
                { key: 'what', header: 'Check', render: (r) => `${COLLECTOR_LABELS[r.collector] ?? r.collector} · ${r.target_label}` },
                { key: 'status', header: 'Result', render: (r) => <Pill tone={r.status === 'ok' ? (r.error ? 'warn' : 'good') : 'bad'}>{r.status === 'ok' ? (r.error ? 'partial' : 'ok') : 'error'}</Pill> },
                { key: 'out', header: 'Output', render: (r) => (r.status === 'ok' ? `${r.changes} change(s) · ${r.findings_opened} new issue(s) · ${r.findings_resolved} fixed` : r.error) },
                { key: 'note', header: 'Note', render: (r) => <span className="text-[12px] text-[var(--agent-app-muted)]">{r.note || ({ schedule: 'scheduled', manual: 'run by hand', sensor: 'monitor report' } as Record<string, string>)[r.trigger] || r.trigger}</span> },
                { key: 'ms', header: 'Time', align: 'right', render: (r) => <span className="tabular-nums">{(r.duration_ms / 1000).toFixed(1)} s</span> },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}

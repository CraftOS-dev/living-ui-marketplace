import { NamedSwitch } from '../components/NamedSwitch.tsx';
import { useMemo, useState } from 'react';
import { EmptyState, PageHeader, Pill, Section, Select, Spinner, Switch, Table, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { SeverityPill } from '../components/pills.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { categoryLabel, relTime } from '../lib/format.ts';
import type { Asset, Baseline, Rule } from '../lib/types.ts';

export function Rules({ embedded }: { embedded?: boolean }): React.JSX.Element {
  const { can } = useMe();
  const admin = can('admin');
  const rules = useCollection<Rule>('rules', { sort: 'rule_id' });
  const baselines = useCollection<Baseline>('baselines', { sort: '-at' });
  const assets = useCollection<Asset>('assets');
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const configure = async (r: Rule, params: Record<string, string | boolean>, done: string): Promise<void> => {
    try {
      await runOp('rules.configure', { rule_id: r.rule_id, ...params });
      toast.success(`${r.rule_id}: ${done}`);
    } catch {
      /* toast shown */
    }
  };

  return (
    <>
      {!embedded && <PageHeader title="Detection rules" meta={String(rules.records.length)} />}
      <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
        {admin
          ? 'What NetSentry treats as a problem. Turn a rule off or change how serious it is; open issues update immediately.'
          : 'What NetSentry treats as a problem. Only admins can change these.'}
      </p>
      <Section title="Detection rules" meta={String(rules.records.length)} flush>
        {rules.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : rules.records.length === 0 ? (
          <EmptyState title="Rule catalogue not loaded yet" message="It loads when the app starts; refresh in a moment." />
        ) : (
          <div className="overflow-x-auto">
            <Table<Rule>
              rows={rules.records}
              rowKey={(r) => r.id}
              columns={[
                { key: 'id', header: 'ID', render: (r) => <span className="font-mono text-[12px]">{r.rule_id}</span> },
                {
                  key: 'title',
                  header: 'Check',
                  render: (r) => (
                    <div className="max-w-md">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
                        {r.title}
                      </button>
                      {expanded === r.id && <p className="mt-1 text-[12px] leading-relaxed text-[var(--agent-app-muted)]">{r.rationale}</p>}
                    </div>
                  ),
                },
                { key: 'cat', header: 'Category', render: (r) => <Pill tone="neutral">{categoryLabel(r.category)}</Pill> },
                {
                  key: 'sev',
                  header: 'Severity',
                  render: (r) =>
                    admin ? (
                      <div className="w-36">
                        <Select
                          aria-label={`Severity for ${r.rule_id}`}
                          value={r.severity_override}
                          onChange={(e) => void configure(r, { severity_override: e.target.value }, e.target.value ? `severity set to ${e.target.value}` : 'severity override cleared')}
                          options={[
                            { value: '', label: `Default (${r.severity_default})` },
                            { value: 'critical', label: 'Critical' },
                            { value: 'high', label: 'High' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'low', label: 'Low' },
                            { value: 'info', label: 'Info' },
                          ]}
                        />
                      </div>
                    ) : (
                      <SeverityPill severity={r.severity_override || r.severity_default} />
                    ),
                },
                {
                  key: 'enabled',
                  header: 'Enabled',
                  align: 'right',
                  render: (r) =>
                    admin ? (
                      <NamedSwitch checked={r.enabled} onCheckedChange={(v) => void configure(r, { enabled: v }, v ? 'enabled' : 'disabled — its open findings were closed')} label={r.enabled ? 'On' : 'Off'} />
                    ) : (
                      <Pill tone={r.enabled ? 'good' : 'neutral'}>{r.enabled ? 'On' : 'Off'}</Pill>
                    ),
                },
              ]}
            />
          </div>
        )}
      </Section>

      <Section title="Expected open ports" meta={String(baselines.records.length)} className="mt-6" flush>
        {baselines.records.length === 0 ? (
          <EmptyState title="Nothing recorded yet" message="Expected open ports are recorded after an address is first checked. Update them from the item’s “What we see” tab." />
        ) : (
          <div className="overflow-x-auto">
            <Table<Baseline>
              rows={baselines.records}
              rowKey={(b) => b.id}
              columns={[
                { key: 'asset', header: 'On', render: (b) => names[b.asset] ?? '—' },
                { key: 'ports', header: 'Expected open ports', render: (b) => (Array.isArray(b.accepted) ? (b.accepted as number[]).join(', ') || 'none' : '—') },
                { key: 'by', header: 'Accepted by', render: (b) => b.accepted_by },
                { key: 'at', header: 'When', render: (b) => relTime(b.at) },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}

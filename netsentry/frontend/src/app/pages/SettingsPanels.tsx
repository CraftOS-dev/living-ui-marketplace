import { NamedSwitch } from '../components/NamedSwitch.tsx';
import { useEffect, useMemo, useState } from 'react';
import { Button, ConfirmDialog, EmptyState, Input, NumberInput, PageHeader, Pill, Section, Select, Spinner, Switch, Table, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { ActorLabel } from '../components/pills.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { capitalize, fmtDate, fmtDateTime } from '../lib/format.ts';
import type { AuditEntry, Member, Settings } from '../lib/types.ts';
import { AlertsPanel } from './AlertsPanel.tsx';

export function Members(): React.JSX.Element {
  const { can, member: me } = useMe();
  const members = useCollection<Member>('users', { sort: 'created' });
  const setRole = async (m: Member, role: string): Promise<void> => {
    try {
      await runOp('members.set-role', { user_id: m.id, role });
      toast.success(`${m.email} is now ${role}.`);
    } catch {
      /* toast shown */
    }
  };
  return (
    <Section title="Members" meta={String(members.records.length)} flush>
      {members.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table<Member>
            rows={members.records}
            rowKey={(m) => m.id}
            columns={[
              { key: 'email', header: 'Member', render: (m) => <span>{m.email}{m.id === me?.id ? ' (you)' : ''}</span> },
              {
                key: 'role',
                header: 'Role',
                render: (m) =>
                  can('admin') ? (
                    <div className="w-36">
                      <Select
                        aria-label={`Role for ${m.email}`}
                        value={m.role || 'viewer'}
                        onChange={(e) => void setRole(m, e.target.value)}
                        options={[
                          { value: 'admin', label: 'Admin' },
                          { value: 'analyst', label: 'Analyst' },
                          { value: 'viewer', label: 'Viewer' },
                          { value: 'auditor', label: 'Auditor (read-only, with the audit log)' },
                        ]}
                      />
                    </div>
                  ) : (
                    <Pill tone={m.role === 'admin' ? 'accent' : 'neutral'}>{capitalize(m.role || 'viewer')}</Pill>
                  ),
              },
              { key: 'joined', header: 'Joined', render: (m) => fmtDate(m.created) },
            ]}
          />
        </div>
      )}
      <p className="border-t border-[var(--agent-app-border)] px-4 py-3 text-[12px] text-[var(--agent-app-muted)]">
        Viewers can look at everything. Analysts can also restart apps, back them up and work on problems. Admins also confirm updates and fixes, and
        manage alerts, rules, members and settings. New members sign up while sign-up is open and start as viewers.
      </p>
    </Section>
  );
}

export function SettingsPanel(): React.JSX.Element {
  const { can } = useMe();
  const admin = can('admin');
  const settings = useCollection<Settings>('settings');
  const s = settings.records[0];
  const [name, setName] = useState('');
  const [retention, setRetention] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);

  useEffect(() => {
    if (s !== undefined) {
      setName(s.workspace_name);
      setRetention(s.retention_days);
    }
  }, [s?.id, s?.updated]);

  if (settings.loading || s === undefined) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const save = async (params: Record<string, string | number | boolean>, done: string): Promise<void> => {
    setSaving(true);
    try {
      await runOp('settings.update', params);
      toast.success(done);
    } catch {
      /* toast shown */
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <Section title="Settings">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-4 text-[13px]">
          <dt className="text-[var(--agent-app-muted)]">Name shown at the top</dt>
          <dd>{s.workspace_name}</dd>
          <dt className="text-[var(--agent-app-muted)]">Sign-up</dt>
          <dd>{s.signup_open ? 'Open (new accounts join as viewers)' : 'Closed'}</dd>
          <dt className="text-[var(--agent-app-muted)]">Change-log retention</dt>
          <dd>{s.retention_days} days</dd>
        </dl>
        <p className="px-4 pb-4 text-[12px] text-[var(--agent-app-muted)]">Only admins can change settings.</p>
      </Section>
    );
  }

  const nameError = name.trim() === '' ? 'Enter a name.' : name.length > 80 ? 'At most 80 characters.' : undefined;
  const retentionError = retention === null || retention < 7 || retention > 3650 || !Number.isInteger(retention) ? 'Whole days between 7 and 3650.' : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Workspace">
        <form
          className="flex max-w-md flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameError === undefined && retentionError === undefined && retention !== null) {
              void save({ workspace_name: name.trim(), retention_days: retention }, 'Settings saved.');
            }
          }}
        >
          <Input label="Name shown at the top" value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
          <NumberInput label="Keep change history for (days)" value={retention} onValue={setRetention} min={7} max={3650} step={1} error={retentionError} />
          <div>
            <Button type="submit" loading={saving} disabled={nameError !== undefined || retentionError !== undefined}>
              Save
            </Button>
          </div>
        </form>
      </Section>
      <Section title="Sign-up">
        <div className="flex flex-col gap-2 p-4 text-[13px]">
          <NamedSwitch
            checked={s.signup_open}
            onCheckedChange={(v) => void save({ signup_open: v }, v ? 'Sign-up opened — new accounts join as viewers.' : 'Sign-up closed.')}
            label={s.signup_open ? 'Open — anyone who can reach this app can create a viewer account' : 'Closed'}
          />
          <p className="text-[12px] text-[var(--agent-app-muted)]">Open it while your team joins, then close it again.</p>
        </div>
      </Section>
      <Section title="Fix policy">
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          <NamedSwitch
            checked={s.remediation_paused}
            onCheckedChange={(v) => void save({ remediation_paused: v }, v ? 'All fix execution is paused.' : 'Fix execution resumed.')}
            label={s.remediation_paused ? 'PAUSED — no fix will be approved or applied' : 'Fixes can be applied once an admin approves them'}
          />
          <p className="text-[12px] text-[var(--agent-app-muted)]">The pause is the emergency brake: nothing gets applied while it is on. Every change is confirmed by a person — the agent can never confirm one.</p>
        </div>
      </Section>
      <Section title="Old history">
        <div className="flex flex-col items-start gap-2 p-4 text-[13px]">
          <p>NetSentry deletes history older than {s.retention_days} days by itself every night. You can also do it now.</p>
          <Button variant="danger" size="sm" onClick={() => setConfirmPrune(true)}>
            Delete old history now…
          </Button>
        </div>
      </Section>
      <ConfirmDialog
        open={confirmPrune}
        danger
        title="Delete old history?"
        message={`Change-log entries older than ${s.retention_days} days and check history older than 14 days will be permanently deleted. Findings, assets and the audit log are kept.`}
        confirmLabel="Delete"
        onCancel={() => setConfirmPrune(false)}
        onConfirm={async () => {
          setConfirmPrune(false);
          try {
            const r = await runOp<{ changes_deleted: number; scan_runs_deleted: number }>('retention.prune');
            toast.success(`Deleted ${r.changes_deleted} old change(s) and ${r.scan_runs_deleted} old check run(s).`);
          } catch {
            /* toast shown */
          }
        }}
      />
    </div>
  );
}

type ExportPage = { entries: unknown[]; next_seq: number | null; head: unknown };

export function AuditLog(): React.JSX.Element {
  const { can } = useMe();
  const since = useMemo(() => new Date(Date.now() - 30 * 86400000).toISOString(), []);
  const audit = useCollection<AuditEntry>('audit_log', { filter: `at >= "${since}"`, sort: '-seq' });
  const [actor, setActor] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; checked: number; brokenAt: number | null; reason: string } | null>(null);

  const rows = audit.records.filter((a) => actor === '' || a.actor_type === actor);
  const [exporting, setExporting] = useState(false);

  // The whole chain as JSON Lines, so a copy can live off this machine and be checked with
  // scripts/verify-audit-export.cjs. Paged; the first line records the chain head at export time.
  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const lines: string[] = [];
      let from: number | null = 1;
      let head: unknown = null;
      while (from !== null) {
        const page: ExportPage = await runOp<ExportPage>('audit.export', { from_seq: from, limit: 5000 });
        if (head === null) head = page.head;
        for (const e of page.entries) lines.push(JSON.stringify(e));
        from = page.next_seq;
      }
      const blob = new Blob([JSON.stringify({ netsentry_audit_export: 1, exported_at: new Date().toISOString(), head }) + '\n' + lines.join('\n') + '\n'], { type: 'application/x-ndjson' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `netsentry-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${lines.length} audit entries.`);
    } catch {
      /* toast shown */
    } finally {
      setExporting(false);
    }
  };
  return (
    <Section
      title="Audit log (last 30 days)"
      meta={String(rows.length)}
      flush
      actions={
        can('admin') ? (
          <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={verifying}
            onClick={async () => {
              setVerifying(true);
              try {
                setResult(await runOp('audit.verify-chain'));
              } catch {
                /* toast shown */
              } finally {
                setVerifying(false);
              }
            }}
          >
            Verify chain
          </Button>
          <Button size="sm" variant="secondary" loading={exporting} onClick={() => void download()}>
            Download
          </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-3">
        <div className="w-44">
          <Select
            aria-label="Actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            options={[
              { value: '', label: 'All actors' },
              { value: 'user', label: 'People' },
              { value: 'agent', label: 'Agent' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
        {result !== null && (
          <Pill tone={result.ok ? 'good' : 'bad'}>
            {result.ok ? `Chain intact — ${result.checked} entries verified` : `Broken at entry #${result.brokenAt}: ${result.reason}`}
          </Pill>
        )}
      </div>
      {audit.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No audit entries" message="Every change made by people, the agent or the system is recorded here." />
      ) : (
        <div className="overflow-x-auto">
          <Table<AuditEntry>
            rows={rows.slice(0, 300)}
            rowKey={(a) => a.id}
            columns={[
              { key: 'seq', header: '#', align: 'right', render: (a) => <span className="tabular-nums text-[12px]">{a.seq}</span> },
              { key: 'at', header: 'When', render: (a) => <span className="whitespace-nowrap text-[12px]">{fmtDateTime(a.at)}</span> },
              { key: 'actor', header: 'Actor', render: (a) => <ActorLabel label={a.actor_type === 'user' ? a.actor_label : a.actor_type} /> },
              { key: 'action', header: 'Action', render: (a) => <span className="font-mono text-[12px]">{a.action}</span> },
              { key: 'summary', header: 'Summary', render: (a) => <span className="text-[13px]">{a.summary}</span> },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * Workspace → Alerts: where people get told, independent of any agent.
 * Destination URLs are write-only secrets: the UI only ever sees a hint.
 */
import { NamedSwitch } from '../components/NamedSwitch.tsx';
import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, EmptyState, Input, ListRow, NumberInput, Pill, Section, Select, Spinner, Switch, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { opError, runOp } from '../lib/ops.ts';
import { capitalize, relTime } from '../lib/format.ts';
import type { Notifier, Settings } from '../lib/types.ts';

const KIND_HELP: Record<string, string> = {
  webhook: 'Sends alerts to a chat app (Slack, Discord), to your phone (ntfy), or to any other service (webhook).',
  heartbeat:
    'NetSentry checks in with a free service (for example healthchecks.io) every few minutes. If the check-ins stop — because NetSentry or its computer is down — that service warns you.',
  craftbot_email: 'Emails the CraftBot account owner through CraftBot. Only works when NetSentry runs inside CraftBot.',
};

interface Draft {
  kind: string;
  name: string;
  url: string;
  format: string;
  min_severity: string;
  send_digest: boolean;
  interval_minutes: number | null;
}

const EMPTY: Draft = { kind: 'webhook', name: '', url: '', format: 'slack', min_severity: 'high', send_digest: true, interval_minutes: 5 };

function describe(n: Notifier): string {
  if (n.kind === 'heartbeat') return `Heartbeat every ${n.interval_minutes} min → ${n.url_hint}`;
  if (n.kind === 'craftbot_email') return `Email via CraftBot · ${n.min_severity}+${n.send_digest ? ' · digest' : ''}`;
  return `${capitalize(n.format || 'json')} webhook → ${n.url_hint} · ${n.min_severity}+${n.send_digest ? ' · digest' : ''}`;
}

export function AlertsPanel(): React.JSX.Element {
  const { can } = useMe();
  const admin = can('admin');
  const notifiers = useCollection<Notifier>('notifiers', { sort: 'created' });
  const settings = useCollection<Settings>('settings');
  const s = settings.records[0];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Notifier | null>(null);

  const call = async (key: string, name: string, params: Record<string, string | number | boolean | undefined>, done?: string): Promise<boolean> => {
    setBusy(key);
    try {
      const r = await runOp<{ message?: string; delivered?: boolean }>(name, params, { silent: name === 'notifiers.test' });
      if (name === 'notifiers.test') {
        if (r.delivered) toast.success('Test alert delivered.');
        else toast.error(r.message ?? 'Delivery failed.');
      } else if (done) toast.success(done);
      return true;
    } catch (err) {
      if (name === 'notifiers.test') toast.error(opError(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async (): Promise<void> => {
    if (!draft.name.trim()) return setError('Give it a name.');
    if (draft.kind !== 'craftbot_email' && !/^https:\/\//i.test(draft.url.trim())) return setError('Enter the full https:// URL.');
    setError(undefined);
    setBusy('create');
    try {
      await runOp(
        'notifiers.create',
        {
          kind: draft.kind,
          name: draft.name.trim(),
          url: draft.kind === 'craftbot_email' ? undefined : draft.url.trim(),
          format: draft.kind === 'webhook' ? draft.format : undefined,
          min_severity: draft.kind === 'heartbeat' ? undefined : draft.min_severity,
          send_digest: draft.kind === 'heartbeat' ? undefined : draft.send_digest,
          interval_minutes: draft.kind === 'heartbeat' ? draft.interval_minutes ?? 5 : undefined,
        },
        { silent: true },
      );
      toast.success(`Added "${draft.name.trim()}". Send a test to check it.`);
      setOpen(false);
      setDraft(EMPTY);
    } catch (err) {
      setError(opError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Alert destinations"
        meta={String(notifiers.records.length)}
        flush
        actions={
          admin ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Add destination
            </Button>
          ) : undefined
        }
      >
        {notifiers.loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : notifiers.records.length === 0 ? (
          <EmptyState
            title="No alert destinations"
            message="Without one, you only see problems when you open NetSentry. Add a chat app or phone notification, and a check-in service so you hear about it if NetSentry itself stops."
            action={admin ? <Button onClick={() => setOpen(true)}>Add destination</Button> : undefined}
          />
        ) : (
          notifiers.records.map((n) => (
            <ListRow
              key={n.id}
              primary={n.name}
              secondary={`${describe(n)} · ${n.last_sent ? `last ${n.last_ok ? 'delivered' : 'failed'} ${relTime(n.last_sent)}` : 'never sent'}${n.last_error ? ' — ' + n.last_error : ''}`}
              trailing={
                admin ? (
                  <div className="flex items-center gap-2">
                    <NamedSwitch checked={n.enabled} onCheckedChange={(v) => void call(n.id + 'en', 'notifiers.update', { notifier_id: n.id, enabled: v }, v ? 'Enabled.' : 'Disabled.')} label="Enabled" />
                    <Button size="sm" variant="secondary" loading={busy === n.id + 'test'} onClick={() => void call(n.id + 'test', 'notifiers.test', { notifier_id: n.id })}>
                      Test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(n)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Pill tone={n.enabled ? (n.last_sent && !n.last_ok ? 'bad' : 'good') : 'neutral'}>{n.enabled ? (n.last_sent && !n.last_ok ? 'Failing' : 'On') : 'Off'}</Pill>
                )
              }
            />
          ))
        )}
        <p className="border-t border-[var(--agent-app-border)] px-4 py-3 text-[12px] text-[var(--agent-app-muted)]">
          New security cases and checks that stop working are sent straight to these destinations — no agent is involved. Destination URLs are stored
          encrypted and never shown again. Only admins can manage them; the agent cannot.
        </p>
      </Section>

      <Section title="Daily summary">
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          {s === undefined ? (
            <Spinner />
          ) : admin ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Select
                  label="Send at (UTC)"
                  value={String(s.digest_hour)}
                  onChange={(e) => void call('hour', 'settings.update', { digest_hour: Number(e.target.value) }, 'Digest schedule saved.')}
                  options={[{ value: '-1', label: 'Off' }, ...Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00 UTC` }))]}
                />
              </div>
              <Button size="sm" variant="secondary" loading={busy === 'digest'} onClick={() => void call('digest', 'digest.send-now', {}, 'Digest sent to destinations with "digest" on.')}>
                Send the summary now
              </Button>
            </div>
          ) : (
            <p>{s.digest_hour < 0 ? 'The daily digest is off.' : `Sent daily at ${String(s.digest_hour).padStart(2, '0')}:00 UTC.`}</p>
          )}
          <p className="text-[12px] text-[var(--agent-app-muted)]">Goes to destinations with "Include the daily summary" on, and asks your agent (if connected) to go through it with you.</p>
        </div>
      </Section>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(undefined);
        }}
        title="Add alert destination"
        description={KIND_HELP[draft.kind]}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy === 'create'} onClick={() => void create()}>
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Type"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            options={[
              { value: 'webhook', label: 'A chat app or phone notification (Slack, Discord, ntfy, webhook)' },
              { value: 'heartbeat', label: 'A “still running?” check-in service (heartbeat)' },
              { value: 'craftbot_email', label: 'Email, sent by your agent' },
            ]}
          />
          <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="#security channel" />
          {draft.kind !== 'craftbot_email' && (
            <Input
              label={draft.kind === 'heartbeat' ? 'Check-in address (from the service)' : 'Address to send alerts to (webhook URL)'}
              type="password"
              autoComplete="off"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://…"
            />
          )}
          {draft.kind === 'webhook' && (
            <Select
              label="Format"
              value={draft.format}
              onChange={(e) => setDraft({ ...draft, format: e.target.value })}
              options={[
                { value: 'slack', label: 'Slack' },
                { value: 'discord', label: 'Discord' },
                { value: 'ntfy', label: 'ntfy' },
                { value: 'json', label: 'Other service (JSON)' },
              ]}
            />
          )}
          {draft.kind === 'heartbeat' ? (
            <NumberInput label="Ping every (minutes)" value={draft.interval_minutes} onValue={(v) => setDraft({ ...draft, interval_minutes: v })} min={1} max={1440} step={1} />
          ) : (
            <>
              <Select
                label="Send alerts of at least"
                value={draft.min_severity}
                onChange={(e) => setDraft({ ...draft, min_severity: e.target.value })}
                options={[
                  { value: 'critical', label: 'Urgent only' },
                  { value: 'high', label: 'Important and urgent' },
                  { value: 'medium', label: 'Soon and above (also checks that stop working)' },
                  { value: 'low', label: 'Everything except “for your information”' },
                ]}
              />
              <NamedSwitch checked={draft.send_digest} onCheckedChange={(v) => setDraft({ ...draft, send_digest: v })} label="Include the daily summary" />
            </>
          )}
          {error !== undefined && (
            <p className="text-[13px] text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        danger
        title="Remove destination?"
        message={confirmDelete ? `"${confirmDelete.name}" will stop receiving alerts. Its URL is deleted and cannot be recovered.` : ''}
        confirmLabel="Remove"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const n = confirmDelete;
          setConfirmDelete(null);
          if (n) await call(n.id + 'del', 'notifiers.delete', { notifier_id: n.id }, `Removed "${n.name}".`);
        }}
      />
    </div>
  );
}

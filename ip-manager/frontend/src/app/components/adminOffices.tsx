/**
 * Settings, Office connections (admin): credentials for USPTO, EPO, EUIPO
 * and JPO data services. Secrets are write-only: the server never sends
 * them back, it only says whether one is saved. Sync never changes records
 * directly: changes arrive in the Inbox.
 */
import { useState } from 'react';
import { ExternalLink, Plug, RefreshCw, Save, Zap } from 'lucide-react';
import { Button, Input, Switch, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, ago, fmtDateTime, today, toPb } from '../lib/format.ts';
import type { Tone } from '../lib/labels.ts';
import { OFFICE_LABEL } from '../lib/labels.ts';
import type { Office, OfficeConnectionRec, SyncRunRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { EmptyHint, ErrorBox, Loading, Notice, Pill, Section } from './ui.tsx';

type SecretKey = 'api_key' | 'client_secret' | 'password';
type PlainKey = 'client_id' | 'username';

interface OfficeInfo {
  office: Office;
  covers: string;
  plain: { key: PlainKey; label: string }[];
  secret: { key: SecretKey; label: string };
  sandbox: boolean;
  howTo: string;
  link: { href: string; label: string };
  extra?: string;
}

const OFFICES: OfficeInfo[] = [
  {
    office: 'uspto_odp',
    covers: 'US patent applications and patents: status, dates, office actions and other events.',
    plain: [],
    secret: { key: 'api_key', label: 'API key' },
    sandbox: false,
    howTo: 'Sign in at data.uspto.gov with a USPTO.gov account that has two-step verification (MFA) and ID.me identity verification, then create an API key on your profile page.',
    link: { href: 'https://data.uspto.gov', label: 'data.uspto.gov' },
  },
  {
    office: 'uspto_tsdr',
    covers: 'US trademark applications and registrations: status, dates and owner.',
    plain: [],
    secret: { key: 'api_key', label: 'API key' },
    sandbox: false,
    howTo: 'Sign in at account.uspto.gov and request a TSDR API key in the API manager.',
    link: { href: 'https://account.uspto.gov/api-manager', label: 'account.uspto.gov/api-manager' },
  },
  {
    office: 'epo_ops',
    covers: 'European patents and applications (EP Register), bibliographic data and patent families.',
    plain: [{ key: 'client_id', label: 'Consumer key' }],
    secret: { key: 'client_secret', label: 'Consumer secret' },
    sandbox: false,
    howTo: 'Register on the EPO Developer Portal, create an app and copy its consumer key and secret. Free up to about 4 GB of data a week.',
    link: { href: 'https://developers.epo.org', label: 'developers.epo.org' },
  },
  {
    office: 'euipo',
    covers: 'EU trade marks and registered Community designs.',
    plain: [{ key: 'client_id', label: 'Client ID' }],
    secret: { key: 'client_secret', label: 'Client secret' },
    sandbox: true,
    howTo: 'Register on the EUIPO API portal and create an application to get a client ID and secret. The sandbox works right away; production access needs identity documents and takes about a week.',
    link: { href: 'https://dev.euipo.europa.eu', label: 'dev.euipo.europa.eu' },
  },
  {
    office: 'jpo',
    covers: 'Japanese patents, designs and trademarks: progress, dates and annuity information.',
    plain: [{ key: 'username', label: 'ID' }],
    secret: { key: 'password', label: 'Password' },
    sandbox: false,
    howTo: 'Send the JPO the registration form by email; the JPO then issues an ID and password. One ID per company.',
    link: { href: 'https://www.jpo.go.jp', label: 'jpo.go.jp' },
    extra: 'The JPO cancels an ID that is unused for a year, so IP Manager makes a keep-alive call once a month. The service allows about 800 status calls a day.',
  },
];

const STATUS_PILL: Record<OfficeConnectionRec['status'], { tone: Tone; label: string }> = {
  not_configured: { tone: 'neutral', label: 'Not set up' },
  connected: { tone: 'good', label: 'Connected' },
  error: { tone: 'bad', label: 'Error' },
  paused: { tone: 'warn', label: 'Paused' },
};

const RUN_TONE: Record<SyncRunRec['status'], Tone> = { running: 'info', ok: 'good', partial: 'warn', error: 'bad', skipped: 'neutral' };
const RUN_LABEL: Record<SyncRunRec['status'], string> = { running: 'Running', ok: 'Done', partial: 'Partly done', error: 'Failed', skipped: 'Skipped' };
const TRIGGER_LABEL: Record<string, string> = { scheduled: 'Daily', manual: 'By hand', import: 'Import', '': '' };

export function OfficesTab(): React.JSX.Element {
  const { refreshMeta } = useApp();
  const conns = useCollection<OfficeConnectionRec>('office_connections', { sort: 'office' });
  const since = toPb(addDays(today(), -90));
  const runs = useCollection<SyncRunRec>('sync_runs', { filter: `created >= "${since}"`, sort: '-created' });
  const [syncing, setSyncing] = useState(false);

  const syncAll = async (): Promise<void> => {
    setSyncing(true);
    try {
      const r = await op<Record<string, { checked: number; changes: number; errors: number }>>('offices/sync-all', {});
      const keys = Object.keys(r);
      if (keys.length === 0) toast.info('No office connection is turned on.');
      else {
        const parts = keys.map((k) => {
          const x = r[k];
          return x === undefined ? k : `${OFFICE_LABEL[k] ?? k}: ${x.checked} checked, ${x.changes} with changes${x.errors > 0 ? `, ${x.errors} errors` : ''}`;
        });
        toast.success(`Sync finished. ${parts.join('. ')}.`);
      }
      refreshMeta();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSyncing(false);
    }
  };

  const runCols: Col<SyncRunRec>[] = [
    { key: 'office', label: 'Office', value: (r) => OFFICE_LABEL[r.office] ?? r.office },
    { key: 'trigger', label: 'Trigger', value: (r) => TRIGGER_LABEL[r.trigger] ?? r.trigger },
    { key: 'status', label: 'Status', value: (r) => RUN_LABEL[r.status], render: (r) => <Pill tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Pill> },
    { key: 'checked', label: 'Checked', align: 'right' },
    { key: 'changes', label: 'Changes', align: 'right' },
    { key: 'errors', label: 'Errors', align: 'right', render: (r) => <span className={r.errors > 0 ? 'text-red-700 dark:text-red-400' : ''}>{r.errors}</span> },
    { key: 'message', label: 'Message', render: (r) => <span className="line-clamp-2 whitespace-pre-line text-xs text-[var(--agent-app-muted)]">{r.message}</span> },
    { key: 'finished', label: 'Finished', value: (r) => r.finished || r.created, render: (r) => (r.finished !== '' ? fmtDateTime(r.finished) : <span className="text-[var(--agent-app-muted)]">Running</span>) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={Plug}>
        Office data never changes a record by itself. Each check files what changed in the Inbox, where someone accepts or rejects it. Everything also works by hand without a connection.
      </Notice>

      {conns.loading ? (
        <Loading />
      ) : conns.error !== null ? (
        <ErrorBox message={conns.error} onRetry={conns.refresh} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {OFFICES.map((info) => {
            const c = conns.records.find((x) => x.office === info.office);
            return c === undefined ? null : <OfficeCard key={info.office} info={info} conn={c} onChanged={refreshMeta} />;
          })}
        </div>
      )}

      <Section
        title="Sync history"
        meta="Last 90 days"
        flush
        actions={
          <Button size="sm" variant="outline" loading={syncing} onClick={() => void syncAll()}>
            <RefreshCw size={13} aria-hidden /> Sync all now
          </Button>
        }
      >
        {runs.loading ? (
          <Loading />
        ) : (
          <DataTable<SyncRunRec>
            tableId="sync-runs"
            exportName="office-sync-history"
            rows={runs.records}
            columns={runCols}
            dense
            empty={<EmptyHint compact icon={RefreshCw} title="No syncs yet" message="Turn on a connection, then sync now or wait for the daily run." />}
          />
        )}
      </Section>
    </div>
  );
}

function OfficeCard({ info, conn, onChanged }: { info: OfficeInfo; conn: OfficeConnectionRec; onChanged: () => void }): React.JSX.Element {
  const [plain, setPlain] = useState<Partial<Record<PlainKey, string>>>({});
  const [secret, setSecret] = useState('');
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'toggle' | 'clear' | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const pill = STATUS_PILL[conn.status] ?? STATUS_PILL.not_configured;
  const label = OFFICE_LABEL[info.office] ?? info.office;

  const plainValue = (k: PlainKey): string => plain[k] ?? conn[k];
  const changed: Record<string, unknown> = {};
  for (const p of info.plain) if (plain[p.key] !== undefined && plain[p.key] !== conn[p.key]) changed[p.key] = (plain[p.key] ?? '').trim();
  if (secret.trim() !== '') changed[info.secret.key] = secret.trim();
  if (sandbox !== null && sandbox !== conn.sandbox) changed['sandbox'] = sandbox;
  const dirty = Object.keys(changed).length > 0;

  const call = async (kind: 'save' | 'toggle' | 'clear', body: Record<string, unknown>, success: string): Promise<boolean> => {
    setBusy(kind);
    try {
      await op('offices/save', { office: info.office, ...body });
      toast.success(success);
      onChanged();
      return true;
    } catch (err) {
      toast.error(errText(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (!dirty) return;
    if (await call('save', changed, `${label} settings saved`)) {
      setPlain({});
      setSecret('');
      setSandbox(null);
    }
  };

  const test = async (): Promise<void> => {
    setBusy('test');
    try {
      await op('offices/test', { office: info.office });
      toast.success(`${label}: connection works`);
    } catch (err) {
      toast.error(`${label}: ${errText(err)}`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const clear = async (): Promise<void> => {
    const ok = await confirm(`Remove the saved ${info.secret.label.toLowerCase()} for ${label}? Syncing stops until you enter a new one.`, 'Clear saved secret?');
    if (!ok) return;
    await call('clear', { [`clear_${info.secret.key}`]: true }, `${info.secret.label} removed`);
  };

  const canTest = conn.enabled && (conn.has_secret || info.plain.some((p) => conn[p.key] !== ''));

  return (
    <div className="flex flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {confirmEl}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--agent-app-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">{label}</h3>
            <Pill tone={pill.tone}>{pill.label}</Pill>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{info.covers}</p>
        </div>
        <Switch
          checked={conn.enabled}
          disabled={busy !== null}
          onCheckedChange={(v) => void call('toggle', { enabled: v }, v ? `${label} turned on` : `${label} paused`)}
          label={conn.enabled ? 'On' : 'Off'}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <div className={cn('grid gap-3', info.plain.length > 0 && 'sm:grid-cols-2')}>
          {info.plain.map((p) => (
            <Input key={p.key} label={p.label} autoComplete="off" spellCheck={false} className="font-mono" value={plainValue(p.key)} onChange={(e) => setPlain((x) => ({ ...x, [p.key]: e.target.value }))} />
          ))}
          <div className="flex flex-col gap-1.5">
            <Input
              label={info.secret.label}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={secret}
              placeholder={conn.has_secret ? 'Saved. Enter a new value to replace it.' : 'Not set'}
              onChange={(e) => setSecret(e.target.value)}
            />
            {conn.has_secret && (
              <button type="button" className="self-start text-xs text-[var(--agent-app-muted)] hover:text-red-600 hover:underline" disabled={busy !== null} onClick={() => void clear()}>
                Clear saved {info.secret.label.toLowerCase()}
              </button>
            )}
          </div>
        </div>
        {info.sandbox && (
          <Switch checked={sandbox ?? conn.sandbox} onCheckedChange={(v) => setSandbox(v)} label="Use the EUIPO sandbox (test data)" />
        )}

        <details className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
          <summary className="select-none text-[var(--agent-app-text)]/80 hover:text-[var(--agent-app-text)]">How to get these credentials</summary>
          <p className="mt-1.5">{info.howTo}</p>
          {info.extra !== undefined && <p className="mt-1.5">{info.extra}</p>}
          <a href={info.link.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
            {info.link.label} <ExternalLink size={11} aria-hidden />
          </a>
        </details>

        <div className="flex flex-col gap-1 text-xs text-[var(--agent-app-muted)]">
          {conn.last_check !== '' && <span>Last checked {ago(conn.last_check)}</span>}
          {conn.last_sync !== '' && <span>Last synced {ago(conn.last_sync)}</span>}
          {info.office === 'jpo' && conn.last_check !== '' && <span className="tabular-nums">Status calls left today: {conn.remaining_calls}</span>}
          {conn.status === 'error' && conn.last_error !== '' && <span className="whitespace-pre-line text-red-700 dark:text-red-400">{conn.last_error}</span>}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--agent-app-border)] px-4 py-2.5">
        <Button size="sm" variant="outline" loading={busy === 'test'} disabled={!canTest || busy !== null || dirty} title={dirty ? 'Save first' : !conn.enabled ? 'Turn the connection on first' : undefined} onClick={() => void test()}>
          <Zap size={13} aria-hidden /> Test connection
        </Button>
        <Button size="sm" loading={busy === 'save'} disabled={!dirty || busy !== null} onClick={() => void save()}>
          <Save size={13} aria-hidden /> Save
        </Button>
      </div>
    </div>
  );
}

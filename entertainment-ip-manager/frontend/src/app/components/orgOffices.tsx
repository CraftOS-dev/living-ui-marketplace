/**
 * Settings, Office connections: JPO, USPTO TSDR and EUIPO trademark data.
 * Admins enter credentials (write-only: the server only says whether one
 * is saved), switch connections on, test them; managers run a sync. Sync
 * never changes a record directly: what changed arrives in the Inbox.
 */
import { useState } from 'react';
import { ExternalLink, Plug, RefreshCw, Save, Zap } from 'lucide-react';
import { Button, Input, Switch, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { errText, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, ago, fmtDateTime, today, toPb } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { OFFICE_CONNECTION_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import type { OfficeConnectionRec, SyncRunRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, Notice, Pill, Section, TONE_TEXT } from './ui.tsx';
import { useAsk } from './orgShared.tsx';

type Office = 'jpo' | 'uspto_tsdr' | 'euipo';
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
  extra?: string | undefined;
}

function officeInfo(): OfficeInfo[] {
  return [
    {
      office: 'jpo',
      covers: t('Japanese trademarks and designs: progress, dates and registration details from the JPO patent information API.'),
      plain: [{ key: 'username', label: t('ID') }],
      secret: { key: 'password', label: t('Password') },
      sandbox: false,
      howTo: t('Apply to the JPO for the patent information retrieval API; the JPO issues an ID and password. One ID per company.'),
      link: { href: 'https://www.jpo.go.jp', label: 'jpo.go.jp' },
      extra: t('The JPO cancels an ID that is unused for a year, so the app makes a keep-alive call once a month. The service allows a limited number of calls a day.'),
    },
    {
      office: 'uspto_tsdr',
      covers: t('US trademark applications and registrations: status, dates and owner.'),
      plain: [],
      secret: { key: 'api_key', label: t('API key') },
      sandbox: false,
      howTo: t('Sign in at account.uspto.gov and request a TSDR API key in the API manager.'),
      link: { href: 'https://account.uspto.gov/api-manager', label: 'account.uspto.gov/api-manager' },
    },
    {
      office: 'euipo',
      covers: t('EU trade marks and registered Community designs.'),
      plain: [{ key: 'client_id', label: t('Client ID') }],
      secret: { key: 'client_secret', label: t('Client secret') },
      sandbox: true,
      howTo: t('Register on the EUIPO API portal and create an application to get a client ID and secret. The sandbox works right away; production access takes about a week.'),
      link: { href: 'https://dev.euipo.europa.eu', label: 'dev.euipo.europa.eu' },
    },
  ];
}

const RUN_TONE: Record<string, Tone> = { running: 'info', ok: 'good', partial: 'warn', error: 'bad', skipped: 'neutral' };

function runLabel(s: string): string {
  return { running: t('Running'), ok: t('Done'), partial: t('Partly done'), error: t('Failed'), skipped: t('Skipped') }[s] ?? s;
}

function triggerLabel(s: string): string {
  return { scheduled: t('Daily'), manual: t('By hand'), import: t('Import') }[s] ?? s;
}

function officeName(o: string): string {
  return OFFICE_CONNECTION_LABEL[o] ?? o;
}

export function OfficesTab(): React.JSX.Element {
  const { can, refreshMeta } = useApp();
  const conns = useCollection<OfficeConnectionRec>('office_connections', can.admin ? { sort: 'office' } : { filter: 'id = "__none__"' });
  const since = toPb(addDays(today(), -90));
  const runs = useCollection<SyncRunRec>('sync_runs', { filter: `created >= "${since}"`, sort: '-created' });
  const [syncing, setSyncing] = useState(false);

  const syncAll = async (): Promise<void> => {
    setSyncing(true);
    try {
      const r = await op<Record<string, { checked: number; changes: number; errors: number }>>('offices/sync-all', {});
      const keys = Object.keys(r);
      if (keys.length === 0) toast.info(t('No office connection is switched on.'));
      else {
        const parts = keys.map((k) => {
          const x = r[k];
          return x === undefined ? officeName(k) : t('{office}: {checked} checked, {changes} with changes, {errors} errors', { office: officeName(k), checked: x.checked, changes: x.changes, errors: x.errors });
        });
        toast.success(t('Sync finished. {details}', { details: parts.join(' / ') }));
      }
      refreshMeta();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSyncing(false);
    }
  };

  const runCols: Col<SyncRunRec>[] = [
    { key: 'office', label: t('Office'), value: (r) => officeName(r.office) },
    { key: 'trigger', label: t('Trigger'), value: (r) => triggerLabel(r.trigger) },
    { key: 'status', label: t('Status'), value: (r) => runLabel(r.status), render: (r) => <Pill tone={RUN_TONE[r.status] ?? 'neutral'}>{runLabel(r.status)}</Pill> },
    { key: 'checked', label: t('Checked'), align: 'right' },
    { key: 'changes', label: t('Changes'), align: 'right' },
    { key: 'errors', label: t('Errors'), align: 'right', render: (r) => <span className={r.errors > 0 ? TONE_TEXT.bad : ''}>{r.errors}</span> },
    { key: 'message', label: t('Message'), render: (r) => <span className="line-clamp-2 whitespace-pre-line break-words text-xs text-[var(--agent-app-muted)]">{r.message}</span> },
    { key: 'finished', label: t('Finished'), value: (r) => r.finished || r.created, render: (r) => (r.finished !== '' ? fmtDateTime(r.finished) : <span className="text-[var(--agent-app-muted)]">{t('Running')}</span>) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={Plug}>
        {t('Office data never changes a record by itself. Each check files what changed in the Inbox, where someone accepts or rejects it. Everything also works by hand without a connection.')}
      </Notice>

      {can.admin &&
        (conns.loading ? (
          <Loading />
        ) : conns.error !== null ? (
          <ErrorBox message={conns.error} onRetry={conns.refresh} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {officeInfo().map((info) => {
              const c = conns.records.find((x) => x.office === info.office);
              return c === undefined ? null : <OfficeCard key={info.office} info={info} conn={c} onChanged={refreshMeta} />;
            })}
          </div>
        ))}

      <Section
        title={t('Sync history')}
        meta={t('Last 90 days')}
        flush
        actions={
          can.manage ? (
            <Button size="sm" variant="outline" loading={syncing} onClick={() => void syncAll()}>
              <RefreshCw size={13} aria-hidden /> {t('Sync all now')}
            </Button>
          ) : undefined
        }
      >
        {runs.loading ? (
          <Loading />
        ) : (
          <DataTable<SyncRunRec>
            tableId="eipm-sync-runs"
            exportName="office-sync-history"
            rows={runs.records}
            columns={runCols}
            dense
            empty={<EmptyHint compact icon={RefreshCw} title={t('No syncs yet')} message={t('Switch a connection on, then sync now or wait for the daily run.')} />}
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
  const [askEl, ask] = useAsk();
  const label = officeName(info.office);

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
    if (await call('save', changed, t('{office} settings saved', { office: label }))) {
      setPlain({});
      setSecret('');
      setSandbox(null);
    }
  };

  const test = async (): Promise<void> => {
    setBusy('test');
    try {
      await op('offices/test', { office: info.office });
      toast.success(t('{office}: the connection works', { office: label }));
    } catch (err) {
      toast.error(`${label}: ${errText(err)}`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const clear = async (): Promise<void> => {
    const ok = await ask(t('Remove the saved {secret} for {office}? Syncing stops until a new one is entered.', { secret: info.secret.label, office: label }), t('Clear the saved credential?'), { confirmLabel: t('Clear') });
    if (!ok) return;
    await call('clear', { [`clear_${info.secret.key}`]: true }, t('Credential removed'));
  };

  const canTest = conn.enabled && (conn.has_secret || info.plain.some((p) => conn[p.key] !== ''));

  return (
    <div className="flex min-w-0 flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {askEl}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--agent-app-border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">{label}</h3>
            <EnumPill field="office_connections.status" value={conn.status || 'not_configured'} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{info.covers}</p>
        </div>
        <Switch
          checked={conn.enabled}
          disabled={busy !== null}
          onCheckedChange={(v) => void call('toggle', { enabled: v }, v ? t('{office} switched on', { office: label }) : t('{office} paused', { office: label }))}
          label={conn.enabled ? t('On') : t('Off')}
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
              placeholder={conn.has_secret ? t('Saved. Enter a new value to replace it.') : t('Not set')}
              onChange={(e) => setSecret(e.target.value)}
            />
            {conn.has_secret && (
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="good">{t('Saved')}</Pill>
                <button type="button" className="text-xs text-[var(--agent-app-muted)] hover:text-red-600 hover:underline" disabled={busy !== null} onClick={() => void clear()}>
                  {t('Clear the saved value')}
                </button>
              </div>
            )}
          </div>
        </div>
        {info.sandbox && <Switch checked={sandbox ?? conn.sandbox} onCheckedChange={(v) => setSandbox(v)} label={t('Use the EUIPO sandbox (test data)')} />}

        <details className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
          <summary className="select-none text-[var(--agent-app-text)]/80 hover:text-[var(--agent-app-text)]">{t('How to get these credentials')}</summary>
          <p className="mt-1.5">{info.howTo}</p>
          {info.extra !== undefined && <p className="mt-1.5">{info.extra}</p>}
          <a href={info.link.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
            {info.link.label} <ExternalLink size={11} aria-hidden />
          </a>
        </details>

        <div className="flex flex-col gap-1 text-xs text-[var(--agent-app-muted)]">
          <span>{t('Status: {status}', { status: enumLabel('office_connections.status', conn.status || 'not_configured') })}</span>
          <span>{conn.last_check !== '' ? t('Last checked {when}', { when: ago(conn.last_check) }) : t('Never checked')}</span>
          {conn.last_sync !== '' && <span>{t('Last synced {when}', { when: ago(conn.last_sync) })}</span>}
          {info.office === 'jpo' && conn.last_check !== '' && <span className="tabular-nums">{t('Calls left today: {n}', { n: conn.remaining_calls })}</span>}
          {conn.last_error !== '' && (
            <span className={`whitespace-pre-line break-words ${TONE_TEXT.bad}`}>
              {t('Last error')}: {conn.last_error}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--agent-app-border)] px-4 py-2.5">
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'test'}
          disabled={!canTest || busy !== null || dirty}
          title={dirty ? t('Save first') : !conn.enabled ? t('Switch the connection on first') : undefined}
          onClick={() => void test()}
        >
          <Zap size={13} aria-hidden /> {t('Test connection')}
        </Button>
        <Button size="sm" loading={busy === 'save'} disabled={!dirty || busy !== null} onClick={() => void save()}>
          <Save size={13} aria-hidden /> {t('Save')}
        </Button>
      </div>
    </div>
  );
}

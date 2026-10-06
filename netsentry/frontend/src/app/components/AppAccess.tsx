/**
 * Apps › <app> › Who has access (organisation mode; plan §12.1, §12.4, §16.7, D12):
 * the app's owner and importance, its accounts when NetSentry has a read-only
 * key, and the access review — who looked at the list, when.
 */
import { useState } from 'react';
import { Button, Input, Pill, Select, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { appName } from '../lib/apps.ts';
import { relTime } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import type { AccessReviewRecord, AppAccessRecord, AppRecord, CatalogueApp, Observation } from '../lib/types.ts';

interface Account {
  app_key: string;
  login: string;
  is_admin: boolean;
  active: boolean;
  last_login: string;
  created: string;
}

function Owner({ app, canEdit }: { app: AppRecord; canEdit: boolean }): React.JSX.Element {
  const [owner, setOwner] = useState(app.owner);
  const [busy, setBusy] = useState(false);
  const save = async (fields: Record<string, string>): Promise<void> => {
    setBusy(true);
    try {
      await runOp('apps.update', { app_id: app.id, ...fields });
      toast.success('Saved.');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Owner" placeholder="Who looks after it" value={owner} disabled={!canEdit} onChange={(e) => setOwner(e.target.value)} />
        </div>
        {canEdit && owner !== app.owner && (
          <Button variant="secondary" loading={busy} onClick={() => void save({ owner })}>
            Save
          </Button>
        )}
      </div>
      <Select
        label="Importance"
        value={app.importance}
        disabled={!canEdit || busy}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'critical', label: 'Critical — alert sooner' },
        ]}
        onChange={(e) => void save({ importance: e.target.value })}
      />
    </div>
  );
}

function KeyForm({ app, how }: { app: AppRecord; how: string[] }): React.JSX.Element {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ message: string }>('accounts.set-access', { app_id: app.id, token: token.trim() });
      toast.success(r.message);
      setToken('');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px]">
        To see who has an account in {appName(app)} and who is an administrator, give NetSentry a <strong>read-only</strong> key. It can list accounts and nothing else.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[14px]">
        {how.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="Read-only key" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <Button disabled={token.trim().length < 8} loading={busy} onClick={() => void save()}>
          Save key
        </Button>
      </div>
      <p className="text-[12px] text-[var(--agent-app-muted)]">Stored encrypted on this console, never shown again, and used only by the monitor on this server.</p>
    </div>
  );
}

export function AppAccess({ app, entry }: { app: AppRecord; entry: CatalogueApp | undefined }): React.JSX.Element {
  const { can } = useMe();
  const access = useCollection<AppAccessRecord>('app_access', { filter: `app = "${app.id}"` });
  const reviews = useCollection<AccessReviewRecord>('access_reviews', { filter: `app = "${app.id}"`, sort: '-reviewed_at' });
  const obs = useCollection<Observation>('observations', { filter: `asset = "${app.asset}" && kind = "app.account" && present = true` });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const key = access.records[0];
  const accounts = obs.records.map((o) => o.data as unknown as Account).filter((d) => d && d.app_key === app.key);
  const active = accounts.filter((a) => a.active);
  const admins = active.filter((a) => a.is_admin);
  const last = reviews.records[0];

  const reviewed = async (): Promise<void> => {
    setBusy(true);
    try {
      await runOp('accounts.review', { app_id: app.id, note });
      toast.success('Recorded. Thanks.');
      setNote('');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const removeKey = async (): Promise<void> => {
    try {
      const r = await runOp<{ message: string }>('accounts.remove-access', { app_id: app.id });
      toast.success(r.message);
    } catch {
      /* toast shown */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <h2 className="mb-3 text-[15px] font-medium">Who looks after it</h2>
        <Owner app={app} canEdit={can('analyst')} />
      </section>

      <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <h2 className="mb-3 text-[15px] font-medium">Accounts</h2>
        {key ? (
          <>
            <p className="text-[13px] text-[var(--agent-app-muted)]">
              Read-only key {key.hint} added by {key.added_by} {relTime(key.added_at)}
              {key.last_ok ? ` · last read ${relTime(key.last_ok)}` : ' · not read yet'}
              {key.last_error ? '' : ''}
            </p>
            {key.last_error && (
              <p className="mt-2 rounded-lg bg-[var(--agent-app-surface-2)] px-3 py-2 text-[13px]">
                The last try didn’t work: {key.last_error}. Make a new read-only key and save it again.
              </p>
            )}
            {accounts.length > 0 && (
              <>
                <p className="mt-3 text-[14px]">
                  {active.length} open account{active.length === 1 ? '' : 's'}, {admins.length} administrator{admins.length === 1 ? '' : 's'}.
                </p>
                <div className="mt-2 flex flex-col">
                  {[...accounts]
                    .sort((a, b) => Number(b.is_admin) - Number(a.is_admin) || a.login.localeCompare(b.login))
                    .map((a) => (
                      <div key={a.login} className="flex items-center gap-2 border-b border-[var(--agent-app-border)] py-2 text-[14px] last:border-b-0">
                        <span className="flex-1">{a.login}</span>
                        {a.is_admin && <Pill tone="accent">Administrator</Pill>}
                        {!a.active && <Pill tone="neutral">Can’t sign in</Pill>}
                        <span className="w-40 text-right text-[12px] text-[var(--agent-app-muted)]">{a.last_login ? `signed in ${relTime(a.last_login)}` : 'never signed in'}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
            {can('admin') && (
              <div className="mt-3">
                <Button size="sm" variant="ghost" onClick={() => void removeKey()}>
                  Remove the key
                </Button>
              </div>
            )}
          </>
        ) : entry?.accounts && can('admin') ? (
          <KeyForm app={app} how={entry.accounts.how} />
        ) : entry?.accounts ? (
          <p className="text-[14px] text-[var(--agent-app-muted)]">An admin can give NetSentry a read-only key to list {appName(app)}’s accounts.</p>
        ) : (
          <p className="text-[14px] text-[var(--agent-app-muted)]">
            NetSentry can’t list {appName(app)}’s accounts without a key that could also change things, so it doesn’t ask for one. Review them in {appName(app)} itself and record it
            below.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <h2 className="text-[15px] font-medium">Access review</h2>
        <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">
          {last ? `Last reviewed ${relTime(last.reviewed_at)} by ${last.reviewer}${last.note ? ` — “${last.note}”` : ''}.` : 'Never reviewed.'} Every few months, check that everyone with an
          account — especially administrators — still needs it.
        </p>
        {can('analyst') && (
          <div className="mt-3 flex flex-col gap-2">
            <Textarea label="What you checked or changed (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <div>
              <Button variant="secondary" loading={busy} onClick={() => void reviewed()}>
                I’ve reviewed who has access
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

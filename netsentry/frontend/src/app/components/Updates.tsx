/**
 * Updates (v3 plan §10): what's waiting for an app and how risky it is,
 * "Update now" (copy → update → health check → automatic undo), the app's
 * standing policy, "Roll back" for 14 days; the machine's security updates
 * and restart; the maintenance windows a policy uses.
 */
import { useState } from 'react';
import { Button, Input, Pill, Select, Spinner, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';
import type { AppRecord, Observation, Remediation } from '../lib/types.ts';
import type { RecordModel } from 'pocketbase';
import { useChange, Working, type Preview } from './Controls.tsx';

export interface UpdateInfo {
  state: 'available' | 'current' | 'unknown';
  image?: string;
  tag?: string;
  to?: string;
  kind?: 'patch' | 'minor' | 'major' | 'rebuild';
  risk?: 'low' | 'medium' | 'high';
  why?: string;
  auto_ok?: boolean;
  checked_at?: string;
  major?: { to: string; risk: string; why: string };
}

const RISK_TONE = { low: 'good', medium: 'warn', high: 'bad' } as const;

/** One line for lists and tiles: "10.10.7 ready (fixes only)". */
export function updateWords(u: UpdateInfo | null | undefined): string | null {
  if (!u || u.state !== 'available') return null;
  return u.kind === 'rebuild' ? `A newer build of "${u.tag}" is ready` : `${u.to} is ready (${u.kind === 'patch' ? 'fixes only' : 'new features'})`;
}

const POLICY_WORDS: Record<string, string> = {
  notify: 'Tell me when one is out',
  auto: 'Update small ones in my maintenance window',
  pinned: 'Never update it',
};

export function AppUpdates({ app }: { app: AppRecord & { update?: UpdateInfo | null; update_policy?: string } }): React.JSX.Element {
  const { can } = useMe();
  const flow = useChange();
  const history = useCollection<Remediation & { purpose: string; created: string }>('remediations', { filter: `app = "${app.id}" && purpose = "update"`, sort: '-created' });
  const u = app.update ?? null;
  const policy = app.update_policy || 'notify';
  const recent = history.records.filter((r) => r.status === 'done' && Date.now() - Date.parse(r.created) < 14 * 86400000 && (r.plan?.steps?.[0]?.action ?? '') === 'app.update');

  const setPolicy = async (v: string): Promise<void> => {
    try {
      await runOp('updates.set-policy', { app_id: app.id, policy: v });
      toast.success(POLICY_WORDS[v] ?? 'Saved');
    } catch {
      /* toast shown */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {!u || u.state === 'unknown' ? (
          <p className="text-[14px] text-[var(--agent-app-muted)]">{u?.why ? `We can't tell yet: ${u.why}.` : "We haven't checked for a newer version yet."}</p>
        ) : u.state === 'current' ? (
          <p className="text-[14px]">
            {u.major ? `The newest in its line${u.tag ? ` (${u.tag})` : ''} — but not the newest version.` : `Up to date${u.tag ? ` (${u.tag})` : ''}.`}{u.checked_at ? <span className="text-[var(--agent-app-muted)]"> Checked {relTime(u.checked_at)}.</span> : null}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-medium">{updateWords(u)}</span>
              {u.risk && <Pill tone={RISK_TONE[u.risk]}>{u.risk} risk</Pill>}
            </div>
            {u.why && <p className="text-[13px] text-[var(--agent-app-muted)]">{u.why}</p>}
            <p className="text-[13px] text-[var(--agent-app-muted)]">NetSentry copies its settings first, updates it, checks it comes back healthy — and puts the old version and settings back by itself if it doesn't.</p>
            {can('admin') && (
              <div className="flex items-center gap-2">
                {flow.status ? (
                  <Working status={flow.status} />
                ) : (
                  <Button disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('updates.request', { app_id: app.id }), 'Update now', u.risk === 'high')}>
                    Update now
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {u?.major && (
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--agent-app-border)] pt-3 text-[13px]">
            <p>
              A new major version ({u.major.to}) is out{u.state === 'current' ? ' — security fixes may only be in it' : ''} — <Pill tone={RISK_TONE[(u.major.risk as 'low') || 'high']}>{u.major.risk} risk</Pill> {u.major.why}. Read its release notes first. NetSentry never moves to a new major version on its own — only when you choose to here.
            </p>
            {can('admin') && !flow.status && (
              <div>
                <Button size="sm" variant="secondary" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('updates.request', { app_id: app.id, to: u.major!.to }), `Update to ${u.major!.to.split('.').slice(0, 2).join('.')}`, true)}>
                  Update to {u.major.to.split('.').slice(0, 2).join('.')}…
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <label className="text-[13px] font-semibold" htmlFor={`policy-${app.id}`}>
          When an update is out
        </label>
        {can('admin') ? (
          <Select id={`policy-${app.id}`} value={policy} onChange={(e) => void setPolicy(e.target.value)} options={Object.entries(POLICY_WORDS).map(([value, label]) => ({ value, label }))} />
        ) : (
          <p className="text-[14px]">{POLICY_WORDS[policy]}</p>
        )}
        <p className="text-[12px] text-[var(--agent-app-muted)]">
          {policy === 'auto'
            ? 'Only fixes and small updates, only inside a maintenance window (Settings → Updates), one app at a time — never a new major version or a database upgrade. Each one is recorded under Changes.'
            : policy === 'pinned'
              ? 'NetSentry still tells you about security problems in the version you run.'
              : 'You decide each time.'}
        </p>
      </div>

      {recent.length > 0 && (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          {recent.map((r) => (
            <RollbackRow key={r.id} change={r} canAct={can('admin')} />
          ))}
        </div>
      )}
      {flow.element}
    </div>
  );
}

function RollbackRow({ change, canAct }: { change: Remediation & { created: string }; canAct: boolean }): React.JSX.Element {
  const flow = useChange();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">
      <span className="min-w-0 flex-1 text-[14px]">
        {change.title} <span className="text-[12px] text-[var(--agent-app-muted)]">· {relTime(change.created)}</span>
      </span>
      {canAct &&
        (flow.status ? (
          <Working status={flow.status} />
        ) : (
          <Button size="sm" variant="secondary" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('updates.rollback', { change_id: change.id }), 'Roll back now', true)}>
            Roll back
          </Button>
        ))}
      {flow.element}
    </div>
  );
}

/** The machine's waiting security updates and a pending restart. */
export function MachineUpdates({ assetId }: { assetId: string }): React.JSX.Element | null {
  const { can } = useMe();
  const install = useChange();
  const restart = useChange();
  const obs = useCollection<Observation>('observations', { filter: `asset = "${assetId}" && present = true && (kind = "host.package_updates" || kind = "host.health")` });
  const pk = obs.records.find((o) => o.kind === 'host.package_updates');
  const hh = obs.records.find((o) => o.kind === 'host.health');
  const data = (pk?.data ?? {}) as { security?: number; manager?: string; packages?: Array<{ name: string }> };
  const reboot = !!((hh?.data ?? {}) as { reboot_required?: boolean }).reboot_required;
  if (!pk && !reboot) return null;
  const n = data.security ?? 0;
  return (
    <section aria-label="Operating-system updates" className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
      <h2 className="text-[13px] font-semibold">Operating-system updates</h2>
      <p className="mt-1 text-[14px]">
        {n ? `${n} security update${n === 1 ? '' : 's'} waiting.` : 'No security updates waiting.'}
        {reboot ? ' A restart is waiting to finish earlier updates.' : ''}
      </p>
      {n > 0 && data.packages && data.packages.length > 0 && (
        <p className="mt-1 truncate text-[12px] text-[var(--agent-app-muted)]">{data.packages.slice(0, 8).map((p) => p.name).join(', ')}{data.packages.length > 8 ? ', …' : ''}</p>
      )}
      {can('admin') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {n > 0 &&
            (install.status ? (
              <Working status={install.status} />
            ) : (
              <Button size="sm" disabled={install.working} onClick={() => void install.ask(() => runOp<Preview>('os.request', { asset_id: assetId, what: 'security_updates' }), 'Install now')}>
                Install security updates
              </Button>
            ))}
          {reboot &&
            (restart.status ? (
              <Working status={restart.status} />
            ) : (
              <Button size="sm" variant="secondary" disabled={restart.working} onClick={() => void restart.ask(() => runOp<Preview>('os.request', { asset_id: assetId, what: 'reboot', delay_minutes: 5 }), 'Restart in 5 minutes', true)}>
                Restart the server…
              </Button>
            ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">The kernel, remote login, networking and Docker are never updated by NetSentry — do those yourself with a restart planned.</p>
      {install.element}
      {restart.element}
    </section>
  );
}

interface WindowRec extends RecordModel {
  id: string;
  name: string;
  weekdays: number[] | null;
  start_minute: number;
  duration_minutes: number;
  utc_offset_minutes: number;
  enabled: boolean;
  last_run: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Settings → Updates: the weekly windows when NetSentry may apply what each app's policy allows. */
export function WindowsPanel(): React.JSX.Element {
  const { can } = useMe();
  const wins = useCollection<WindowRec>('maintenance_windows', { sort: 'created' });
  const [days, setDays] = useState<number[]>([0]);
  const [start, setStart] = useState('03:00');
  const [hours, setHours] = useState('2');
  const [busy, setBusy] = useState(false);
  const autoApps = useCollection<AppRecord>('apps', { filter: 'status = "active" && update_policy = "auto"' });
  const [checking, setChecking] = useState(false);

  const save = async (): Promise<void> => {
    const [h, m] = start.split(':').map((x) => parseInt(x, 10));
    setBusy(true);
    try {
      await runOp('windows.save', {
        name: `${days.map((d) => DAYS[d]).join(', ')} ${start}`,
        weekdays: days.join(','),
        start_minute: (h ?? 3) * 60 + (m ?? 0),
        duration_minutes: Math.round(parseFloat(hours || '2') * 60),
        utc_offset_minutes: -new Date().getTimezoneOffset(),
        enabled: true,
      });
      toast.success('Window saved.');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-[var(--agent-app-muted)]">
        Apps set to “Update small ones in my maintenance window” are updated only inside these times, one at a time; the first one that fails stops the rest of that window.
        {autoApps.records.length ? ` ${autoApps.records.length} app${autoApps.records.length === 1 ? ' is' : 's are'} set that way.` : ' No app is set that way yet (each app → Updates).'}
      </p>
      {wins.loading ? (
        <Spinner />
      ) : wins.records.length === 0 ? (
        <p className="text-[14px]">No maintenance window yet.</p>
      ) : (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          {wins.records.map((w) => (
            <div key={w.id} className="flex items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">
              <span className="min-w-0 flex-1 text-[14px]">
                {(w.weekdays ?? []).map((d) => DAYS[d]).join(', ')} from {hhmm(w.start_minute)} for {w.duration_minutes >= 60 ? `${w.duration_minutes / 60} h` : `${w.duration_minutes} min`}
                {w.last_run ? <span className="text-[12px] text-[var(--agent-app-muted)]"> · last used {relTime(w.last_run)}</span> : null}
              </span>
              {can('admin') && (
                <Button size="sm" variant="ghost" onClick={() => void runOp('windows.delete', { window_id: w.id }).then(() => toast.success('Removed.'))}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {can('admin') && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
          <span className="text-[13px] font-semibold">Add a window</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {DAYS.map((d, i) => (
              <button
                key={d}
                aria-pressed={days.includes(i)}
                onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
                className={`rounded-md border px-2 py-1 text-[13px] ${days.includes(i) ? 'border-[var(--agent-app-accent)] font-semibold' : 'border-[var(--agent-app-border)] text-[var(--agent-app-muted)]'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[12px]">
              Starts at
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex flex-col text-[12px]">
              Hours
              <Input type="number" min={0.25} max={12} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
            <Button loading={busy} disabled={!days.length} onClick={() => void save()}>
              Save window
            </Button>
          </div>
          <p className="text-[12px] text-[var(--agent-app-muted)]">Times are in your time zone (the one this browser uses).</p>
        </div>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          loading={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const r = await runOp<{ checked: number }>('updates.check-now');
              toast.success(r.checked ? `Asked the registries about ${r.checked} image(s).` : 'Everything was checked recently.');
            } catch {
              /* toast shown */
            } finally {
              setChecking(false);
            }
          }}
        >
          Check for updates now
        </Button>
      </div>
    </div>
  );
}

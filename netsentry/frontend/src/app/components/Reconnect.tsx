/**
 * Reconnect the monitor (v4 §16, N-B31): when the server stops reporting, NetSentry can't act there
 * (the monitor is the only thing that does), so it walks the person through it on the spot: where to
 * run the one command, the command itself (copy), whether changes are allowed — then it waits and
 * says "Connected" by itself the moment the monitor reports again (the sensors record is realtime).
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Spinner, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';
import type { Sensor, Settings as SettingsRecord } from '../lib/types.ts';
import { TONE_COLOR } from './visual.tsx';
import { consoleForMonitor } from '../pages/Setup.tsx';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--agent-app-surface-2)] text-[12px] font-semibold">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[14px]">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** "1.2.0" newer than "1.10.0"? (numbers, part by part) */
export function newerVersion(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/**
 * mode "reconnect": the monitor stopped reporting (a one-time code in the command, N-B32).
 * mode "update": it reports, but is older than this NetSentry — the same command updates it in place.
 */
export function ReconnectDrawer({ open, onClose, mode = 'reconnect' }: { open: boolean; onClose: () => void; mode?: 'reconnect' | 'update' }): React.JSX.Element {
  const update = mode === 'update';
  const { can } = useMe();
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"', sort: '-last_seen' });
  const settings = useCollection<SettingsRecord>('settings');
  const [windows, setWindows] = useState<boolean | null>(null);
  const [latest, setLatest] = useState<string>('');
  const [allow, setAllow] = useState<boolean | null>(null);
  const [openedAt, setOpenedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  // A one-time code (1 use, 1 day) in the command: whatever key the monitor has — lost, or from another
  // NetSentry — it comes back as this server's monitor (N-B32).
  const [join, setJoin] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !can('admin')) return;
    setJoin(null);
    if (update) return; // updating keeps the monitor's key: no code needed
    void runOp<{ token: string }>('sensors.create-join-token', { label: 'Reconnect the monitor', days: 1, max_uses: 1 }, { silent: true }).then(
      (r) => setJoin(r.token),
      () => toast.error("NetSentry couldn't make the one-time code — try again."),
    );
  }, [open, can, update]);
  useEffect(() => {
    if (!open) return;
    setOpenedAt(Date.now());
    void runOp<{ windows: boolean; version?: string }>('sensors.install-info', {}, { silent: true }).then(
      (r) => {
        setWindows(r.windows);
        setLatest(r.version || '');
      },
      () => setWindows(false),
    );
  }, [open]);
  // The installer only ever uses NetSentry's SAVED address (never the one a request came in on), and
  // only first-time Setup used to save it: save it here too, the same way, before showing the command.
  const saved = settings.records[0]?.console_url || '';
  useEffect(() => {
    if (!open || !can('admin') || settings.loading || saved || saving) return;
    setSaving(true);
    void runOp('settings.update', { console_url: consoleForMonitor() }, { silent: true })
      .catch(() => toast.error("NetSentry couldn't save its address — open Settings → Monitor."))
      .finally(() => setSaving(false));
  }, [open, saved, settings.loading, saving, can]);

  const m = monitors.records[0];
  const changesOn = !!m?.capabilities?.['executor']?.available;
  const manage = allow ?? true; // the buttons on Home need it; the person can untick
  const onWindows = m?.platform ? m.platform === 'windows' : windows === true;
  const url = saved || consoleForMonitor();
  const joinPart = update ? '' : `$env:NETSENTRY_JOIN='${join ?? '…'}'; `;
  const command = onWindows
    ? `${joinPart}$env:NETSENTRY_MANAGE='${manage ? 'yes' : 'no'}'; irm ${url}/api/netsentry/sensor/install.ps1 | iex`
    : `curl -fsSL ${url}/api/netsentry/sensor/install.sh | sudo ${update ? '' : `NETSENTRY_JOIN='${join ?? '…'}' `}NETSENTRY_MANAGE=${manage ? 'yes' : 'no'} sh`;
  const ready = !!saved && (update || !!join);
  // Back: reporting again since this panel opened (the record changes in realtime).
  const back = update
    ? !!m && m.status === 'online' && !!latest && !newerVersion(latest, m.version)
    : !!m && m.status === 'online' && Date.parse(String(m.last_seen).replace(' ', 'T')) >= openedAt - 5000;
  // Feedback on the button itself (a toast would sit behind this panel): "Copied ✓", or — when the
  // browser refuses — the command selected, ready for Ctrl+C.
  const [copied, setCopied] = useState<'' | 'yes' | 'select'>('');
  const pre = useRef<HTMLPreElement>(null);
  const copy = (): void => {
    const done = (how: 'yes' | 'select'): void => {
      setCopied(how);
      window.setTimeout(() => setCopied(''), how === 'yes' ? 2000 : 6000);
    };
    const select = (): void => {
      const range = document.createRange();
      if (pre.current) range.selectNodeContents(pre.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      done('select');
    };
    if (!navigator.clipboard) return select();
    void navigator.clipboard.writeText(command).then(() => done('yes'), select);
  };

  return (
    <Drawer open={open} onClose={onClose} title={back ? (update ? 'Up to date' : 'Connected') : update ? 'Update the monitor' : 'Reconnect the monitor'} width={520} footer={<Button variant={back ? 'primary' : 'ghost'} onClick={onClose}>{back ? 'Done' : 'Close'}</Button>}>
      {back ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-lg px-3 py-3" style={{ background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.good} 12%)` }}>
            <p className="text-[15px] font-semibold">{update ? `The monitor on ${m?.hostname || m?.name} is up to date` : `The monitor on ${m?.hostname || m?.name} is reporting again`}</p>
            <p className="text-[13px] text-[var(--agent-app-muted)]">
              Version {m?.version || '?'} · changes {changesOn ? 'allowed (each one still needs your confirm)' : 'switched off'}. Home is live again; problems the monitor no longer sees clear over the next minute.
            </p>
          </div>
        </div>
      ) : !can('admin') ? (
        <p className="text-[14px]">The monitor on this server stopped reporting. An admin of NetSentry can reconnect it from here (it takes one command on the server).</p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] text-[var(--agent-app-muted)]">
            {update
              ? `The monitor on ${m?.hostname || m?.name || 'this server'} is version ${m?.version || '?'}; this NetSentry has ${latest || 'a newer one'}. Updating it brings the newer parts (live numbers, the terminal's fixes…) — it keeps its key, its name, its history and your apps.`
              : `${m ? `The monitor on ${m.hostname || m.name} last reported ${relTime(m.last_seen)}${m.version ? ` (version ${m.version})` : ''}.` : 'This server has no monitor yet.'} Until it reports, NetSentry can't see or change anything there. Running the installer again with this one-time code reconnects it (even if its key was lost, or came from another NetSentry) and updates it — it keeps its name, its history and your apps here. The code works once, for a day.`}
          </p>
          <ol className="flex flex-col gap-4">
            <Step n={1} title={onWindows ? 'On the server, open PowerShell as Administrator' : 'On the server, open a terminal'}>
              <p className="text-[13px] text-[var(--agent-app-muted)]">
                {onWindows ? 'Press Start, type PowerShell, right-click it and choose "Run as administrator".' : 'Or connect to it with SSH. The command asks for your password (sudo) because the monitor runs as a system service.'}
              </p>
            </Step>
            <Step n={2} title="Paste this and press Enter">
              {!ready && (
                <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
                  <Spinner /> Preparing the command (NetSentry's address and a one-time code)…
                </p>
              )}
              <pre ref={pre} className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] px-3 py-2 font-mono text-[12px]">{command}</pre>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={!ready} onClick={copy} aria-live="polite">
                  {copied === 'yes' ? 'Copied ✓' : 'Copy'}
                </Button>
                {copied === 'yes' && <span className="text-[13px] text-[var(--agent-app-muted)]">Now paste it in PowerShell (right-click pastes).</span>}
                {copied === 'select' && <span className="text-[13px] text-[var(--agent-app-muted)]">Selected — press Ctrl+C to copy it.</span>}
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={manage} onChange={(e) => setAllow(e.target.checked)} />
                  Let NetSentry make changes on this server (Start, Fix, Update… — each one only after you confirm)
                </label>
              </div>
            </Step>
            <Step n={3} title="Wait here">
              <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
                <Spinner /> {update ? 'Waiting for the monitor to report its new version… this changes to "Up to date" by itself.' : 'Waiting for the monitor to report… this changes to "Connected" by itself.'}
              </p>
            </Step>
          </ol>
          <p className="text-[12px] text-[var(--agent-app-muted)]">
            Still nothing after a minute? Check the server is on and can reach {url} — the monitor talks to NetSentry, never the other way round.
          </p>
        </div>
      )}
    </Drawer>
  );
}

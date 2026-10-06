/**
 * Setup — "Let NetSentry look after this server" (v4 plan §0.1): NetSentry runs on the server it
 * looks after, so setup is three steps on that one machine:
 *   1. install the monitor here (the real installer: a service that starts at boot, and the one
 *      question only the server can answer — may NetSentry make changes when a person confirms them);
 *   2. say who should reach each app it found;
 *   3. say where alerts go.
 * Reopenable from Home until finished.
 */
import { useEffect, useState } from 'react';
import { Button, getPbClient, PageHeader, Pill, Section, Spinner, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { go } from '../lib/nav.ts';
import { opError, runOp } from '../lib/ops.ts';
import type { Notifier, Sensor } from '../lib/types.ts';
import { AlertsPanel } from './AlertsPanel.tsx';

function stateKey(): string {
  return 'netsentry.setup.state.' + (getPbClient().pb.authStore.record?.id ?? 'anon');
}

/** 'finished' (or dismissed): never offered again. 'skipped': not opened by itself, but Home still offers it. */
function setupState(): 'finished' | 'skipped' | null {
  try {
    const v = window.localStorage.getItem(stateKey());
    return v === 'finished' || v === 'skipped' ? v : null;
  } catch {
    return null;
  }
}

export function setupFinished(): boolean {
  return setupState() === 'finished';
}

/** Seen at least once (finished or skipped) — do not open it by itself again. */
export function setupSeen(): boolean {
  return setupState() !== null;
}

export function markSetup(state: 'finished' | 'skipped'): void {
  try {
    window.localStorage.setItem(stateKey(), state);
  } catch {
    /* private window: the guide just shows again */
  }
}

/**
 * The address the monitor uses to reach NetSentry: this server itself (loopback). The browser may
 * be on another computer, so its address is not the monitor's — the port is the same.
 */
/** The address the monitor (on this same server) uses to reach NetSentry. */
export function consoleForMonitor(): string {
  const { protocol, hostname, port } = window.location;
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(hostname);
  return loopback ? `${protocol}//${hostname}${port ? `:${port}` : ''}` : `http://127.0.0.1${port ? `:${port}` : ''}`;
}

function Copyable({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] px-3 py-2 font-mono text-[12px]">{text}</pre>
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(
              () => toast.success('Copied.'),
              () => toast.error('Copy failed — select the text instead.'),
            )
          }
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

/** Step 1: a one-time key and the installer command; then wait, live, for the monitor to report. */
export function MonitorInstall(): React.JSX.Element {
  const { can } = useMe();
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"', sort: '-last_seen' });
  const [windows, setWindows] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = can('admin');
  useEffect(() => {
    if (!admin) return;
    void runOp<{ windows: boolean }>('sensors.install-info', {}, { silent: true }).then(
      (r) => setWindows(r.windows),
      () => setWindows(false),
    );
  }, [admin]);

  if (!admin) return <p className="text-[13px] text-[var(--agent-app-muted)]">Installing the monitor needs an admin.</p>;
  const reporting = monitors.records.find((m) => m.status === 'online') ?? null;

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const url = consoleForMonitor();
      await runOp('settings.update', { console_url: url }, { silent: true });
      const r = await runOp<{ token: string }>('sensors.create-join-token', { label: 'This server', days: 1, max_uses: 1 }, { silent: true });
      setToken(r.token);
    } catch (err) {
      setError(opError(err));
    } finally {
      setBusy(false);
    }
  };

  const url = consoleForMonitor();
  const command = windows
    ? `$env:NETSENTRY_JOIN='${token ?? ''}'; $env:NETSENTRY_MANAGE='yes'; irm ${url}/api/netsentry/sensor/install.ps1 | iex`
    : `curl -fsSL ${url}/api/netsentry/sensor/install.sh | sudo NETSENTRY_JOIN='${token ?? ''}' NETSENTRY_MANAGE=yes sh`;

  return (
    <div className="flex flex-col gap-3 p-4 text-[14px]">
      {reporting ? (
        <p className="flex items-center gap-2">
          <Pill tone="good">Reporting ✓</Pill>
          {reporting.hostname || reporting.name} — the monitor is running{reporting.version ? ` (version ${reporting.version})` : ''}.
        </p>
      ) : token === null ? (
        <>
          <p>NetSentry needs a small helper — the monitor — on this server. It reads how the server and its apps are doing, and makes the changes you confirm.</p>
          {error && <p className="text-[13px] text-red-700 dark:text-red-400">{error}</p>}
          <div>
            <Button loading={busy} onClick={() => void start()}>
              Show me the command
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            On this server, open {windows ? <strong>PowerShell as Administrator</strong> : <strong>a terminal</strong>} and run:
          </p>
          <Copyable text={command} />
          <p className="text-[12px] text-[var(--agent-app-muted)]">
            The key in it works once, for one day. <code>NETSENTRY_MANAGE=yes</code> lets NetSentry make changes when a person confirms them (restart an app, update it, back it up) — leave it out and NetSentry only watches. Running the
            same command again later updates the monitor.
          </p>
          <div role="status" className="flex items-center gap-2 text-[13px]">
            <Spinner /> Waiting for the monitor to report…
          </div>
        </>
      )}
    </div>
  );
}

export function Setup({ onFinish }: { onFinish: () => void }): React.JSX.Element {
  const monitors = useCollection<Sensor>('sensors', { filter: 'status = "online"' });
  const notifiers = useCollection<Notifier>('notifiers', { filter: 'enabled = true' });
  const installed = monitors.records.length > 0;

  const finish = (): void => {
    markSetup('finished');
    onFinish();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Let NetSentry look after this server" subtitle="Three steps. You can stop at any point and come back from Home." />
      <div className="flex flex-col gap-4">
        <Section title={`${installed ? '✓' : '1.'} Install the monitor on this server`}>
          <MonitorInstall />
        </Section>
        <Section title="2. Who should reach your apps">
          <div className="flex flex-col gap-2 p-4 text-[14px]">
            <p>NetSentry finds the apps on this server by itself. For each one, say who should be able to open it — it then checks that only they can.</p>
            <div>
              <Button variant="secondary" disabled={!installed} onClick={() => go('setup/apps')}>
                Answer for each app
              </Button>
            </div>
            {!installed && <p className="text-[12px] text-[var(--agent-app-muted)]">Once the monitor reports, the apps appear here.</p>}
          </div>
        </Section>
        <Section title={`${notifiers.records.length ? '✓' : '3.'} Get told when something is wrong`}>
          <AlertsPanel />
        </Section>
        <div className="flex justify-end gap-2 pb-8">
          <Button
            variant="ghost"
            onClick={() => {
              markSetup('skipped');
              onFinish();
            }}
          >
            Later
          </Button>
          <Button onClick={finish}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings › Monitor (v4 §0.1): the one helper on this server — is it reporting, which version,
 * may it make changes, and the commands to update it or change that answer. (Installing it the
 * first time is Setup's step 1, shown here too until it reports.)
 */
import { useEffect, useState } from 'react';
import { EmptyState, Pill, Section, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { useMe } from '../lib/me.tsx';
import { relTime } from '../lib/format.ts';
import { runOp } from '../lib/ops.ts';
import type { Sensor, Settings as SettingsRecord } from '../lib/types.ts';
import { consoleForMonitor, MonitorInstall } from './Setup.tsx';

function Command({ text }: { text: string }): React.JSX.Element {
  return <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] px-3 py-2 font-mono text-[12px]">{text}</pre>;
}

export function SensorsPanel(): React.JSX.Element {
  const { can } = useMe();
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"', sort: '-last_seen' });
  const info = useOp<{ windows: boolean; version?: string }>('sensors.install-info', {}, { freshMs: 300000 });
  const windows = info.data ? info.data.windows : info.error ? false : null;
  const settings = useCollection<SettingsRecord>('settings');
  const consoleUrl = settings.records[0]?.console_url ?? '';
  // The update command needs NetSentry's saved address (the installer never trusts a request's own):
  // save it the way Setup does when it was never saved (servers set up before Setup saved it).
  const { can: canDo } = useMe();
  useEffect(() => {
    if (settings.loading || consoleUrl || !canDo('admin')) return;
    void runOp('settings.update', { console_url: consoleForMonitor() }, { silent: true }).catch(() => undefined);
  }, [settings.loading, consoleUrl, canDo]);

  if (monitors.loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  const m = monitors.records[0];
  if (!m) {
    return can('admin') ? (
      <Section title="Install the monitor on this server">
        <MonitorInstall />
      </Section>
    ) : (
      <EmptyState title="No monitor yet" message="An admin installs it once (Setup)." />
    );
  }
  const changesOn = !!m.capabilities?.['executor']?.available;
  // The commands run on the server, so they follow the monitor's platform (not the computer showing this page).
  const onWindows = m.platform ? m.platform === 'windows' : windows === true;
  const url = consoleUrl || consoleForMonitor();
  const update = onWindows ? `irm ${url}/api/netsentry/sensor/install.ps1 | iex` : `curl -fsSL ${url}/api/netsentry/sensor/install.sh | sudo sh`;
  const toggle = onWindows
    ? `$env:NETSENTRY_MANAGE='${changesOn ? 'no' : 'yes'}'; irm ${url}/api/netsentry/sensor/install.ps1 | iex`
    : `curl -fsSL ${url}/api/netsentry/sensor/install.sh | sudo NETSENTRY_MANAGE=${changesOn ? 'no' : 'yes'} sh`;

  return (
    <div className="flex flex-col gap-4">
      <Section title="The monitor on this server">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 p-4 text-[14px]">
          <dt className="text-[var(--agent-app-muted)]">Status</dt>
          <dd>
            <Pill tone={m.status === 'online' ? 'good' : 'bad'}>{m.status === 'online' ? 'Reporting' : 'Silent'}</Pill>{' '}
            <span className="text-[13px] text-[var(--agent-app-muted)]">last report {relTime(m.last_seen)}</span>
          </dd>
          <dt className="text-[var(--agent-app-muted)]">Server</dt>
          <dd>
            {m.hostname || m.name} · {m.os}
          </dd>
          <dt className="text-[var(--agent-app-muted)]">Version</dt>
          <dd>{m.version || '—'}</dd>
          <dt className="text-[var(--agent-app-muted)]">Changes</dt>
          <dd>{changesOn ? 'Allowed — every change still needs a person to confirm it' : 'Switched off — NetSentry only watches'}</dd>
        </dl>
      </Section>
      {can('admin') && (
        <>
          <Section title="Update the monitor">
            <div className="flex flex-col gap-2 p-4 text-[14px]">
              <p>Run this on the server ({onWindows ? 'PowerShell as Administrator' : 'a terminal'}). It keeps the monitor's identity and your answer about changes.</p>
              <Command text={update} />
            </div>
          </Section>
          <Section title={changesOn ? 'Switch changes off' : 'Allow changes'}>
            <div className="flex flex-col gap-2 p-4 text-[14px]">
              <p>
                {changesOn
                  ? 'NetSentry will only watch: no restarts, updates, backups or installs.'
                  : 'NetSentry can then restart apps, update them safely, back them up and install new ones — each one only after a person confirms it.'}{' '}
                Only the server itself can change this answer:
              </p>
              <Command text={toggle} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

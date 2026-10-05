/**
 * The server (#/server[/<tab>]) — v4 §5.3: the one machine NetSentry runs on and looks after.
 *   Overview            how it runs, operating-system updates and restart, its own problems, changes made
 *   Network & firewall  what accepts connections, what Docker and the router open, firewall, remote access
 *   Users & keys        who can sign in, SSH keys and settings
 *   History             what appeared, disappeared or changed between checks
 *   Details             every check and what it last saw, everything the monitor sees, the security score
 *   Files · Disk space · Programs · Scheduled jobs · Terminal   (v4 N2–N4, §7 and §6)
 */
import { useState } from 'react';
import { Button, EmptyState, Pill, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { Breadcrumbs, DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { ChangeHistory, useWatch } from '../components/Controls.tsx';
import { CoverageList } from '../components/Coverage.tsx';
import { MachineHealth } from '../components/Health.tsx';
import { AlertIcon, GaugeIcon } from '../components/icons.tsx';
import { PageTabs } from '../components/PageTabs.tsx';
import { Inventory, Loading, Timeline, useServer } from '../components/ServerParts.tsx';
import { MachineUpdates } from '../components/Updates.tsx';
import { TONE_COLOR } from '../components/visual.tsx';
import { relTime, severityRank } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { go } from '../lib/nav.ts';
import { runOp } from '../lib/ops.ts';
import { ServerToFix } from './ServerHome.tsx';
import { FilesPanel } from '../components/FilesPanel.tsx';
import { DiskPanel, FirewallPanel, KeysPanel, ProcessesPanel, RemotePanel, SchedulesPanel } from '../components/ServerJobs.tsx';
import { TerminalPanel } from '../components/TerminalPanel.tsx';
import { DetailScope } from '../lib/view.tsx';

export const SERVER_TABS = ['files', 'disk', 'programs', 'network', 'users', 'schedules', 'terminal', 'history', 'details'] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

const NETWORK_KINDS = ['device.posture', 'host.listener', 'container.published_port', 'router.port_mapping', 'router.igd', 'host.address', 'host.remote_access'];
const USER_KINDS = ['host.user', 'host.authorized_key', 'host.ssh_config'];

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ServerPage({ tab }: { tab: ServerTab | null }): React.JSX.Element {
  const { can } = useMe();
  const { asset, sensor, loading } = useServer();
  const observations = useCollection<{ kind: string; data: unknown } & import('pocketbase').RecordModel>('observations', { filter: asset ? `asset = "${asset.id}" && kind = "remote.tailscale" && present = true` : 'id = ""' });
  const [busy, setBusy] = useState(false);
  useWatch(asset?.id);

  if (loading) return <Loading />;
  if (!asset) {
    return (
      <EmptyState
        title="This server isn't set up yet"
        message="NetSentry needs its monitor running on this server first."
        action={can('admin') ? <Button onClick={() => go('setup')}>Set it up</Button> : undefined}
      />
    );
  }

  const name = asset.label || asset.identifier;
  const online = sensor?.status === 'online';
  const changesOn = !!(sensor?.capabilities as { executor?: { available?: boolean } } | undefined)?.executor?.available;
  const checkNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ monitor: { online: boolean } | null }>('assets.rescan', { asset_id: asset.id });
      toast.success(r.monitor && !r.monitor.online ? "The monitor isn't running — start it, then try again." : 'Asked the server to check everything now.');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  let body: React.JSX.Element;
  const caps = (sensor?.capabilities ?? {}) as Record<string, { available?: boolean; reason?: string; user?: string; mode?: string } | undefined>;
  const tailscale = (observations.records.find((o) => o.kind === 'remote.tailscale')?.data ?? null) as { running?: boolean; name?: string } | null;
  if (tab === 'files') {
    body = <FilesPanel assetId={asset.id} />;
  } else if (tab === 'disk') {
    body = <DiskPanel />;
  } else if (tab === 'programs') {
    body = <ProcessesPanel />;
  } else if (tab === 'schedules') {
    body = <SchedulesPanel />;
  } else if (tab === 'terminal') {
    body = <TerminalPanel cap={caps['terminal'] ?? null} online={online} />;
  } else if (tab === 'network') {
    body = (
      <div className="flex flex-col gap-5">
        <FirewallPanel />
        <RemotePanel tailscale={tailscale} />
        <Section title="What accepts connections">
          <Inventory asset={asset} kinds={NETWORK_KINDS} expectedPorts />
        </Section>
      </div>
    );
  } else if (tab === 'users') {
    body = (
      <div className="flex flex-col gap-5">
        <KeysPanel />
        <Section title="What the monitor last saw">
          <Inventory asset={asset} kinds={USER_KINDS} />
        </Section>
      </div>
    );
  } else if (tab === 'history') {
    body = <Timeline assetId={asset.id} />;
  } else if (tab === 'details') {
    body = (
      <div className="flex flex-col gap-5">
        <DrillList>
          <DrillRow to="score" icon={<GaugeIcon size={18} />} label="Security score" hint="How it's worked out, and what raises it" />
          <DrillRow to="issues/all" icon={<AlertIcon size={18} />} label="Every problem, in a table" hint="Open, being handled, accepted and fixed — with technical names" />
        </DrillList>
        <Section title="What NetSentry checks here">
          <CoverageList assetId={asset.id} />
        </Section>
        <Section title="Everything the monitor sees">
          <DetailScope on>
            <Inventory asset={asset} />
          </DetailScope>
        </Section>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <MachineHealth assetId={asset.id} />
        <MachineUpdates assetId={asset.id} />
        <ServerToFix />
        <Section title="Changes made here">
          <ChangeHistory assetId={asset.id} />
        </Section>
      </div>
    );
  }

  const tabs: Array<[string, string]> = [
    ['overview', 'Overview'], ['files', 'Files'], ['disk', 'Disk space'], ['programs', 'Programs'], ['network', 'Network & firewall'],
    ['users', 'Users & keys'], ['schedules', 'Scheduled jobs'], ['terminal', 'Terminal'], ['history', 'History'], ['details', 'Details'],
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: name }]} />
      <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold leading-tight">{name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--agent-app-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: online ? TONE_COLOR.good : TONE_COLOR.bad }} />
                {online ? 'Monitor reporting' : sensor ? `Monitor silent since ${relTime(sensor.last_seen)}` : 'No monitor yet'}
              </span>
              {sensor?.os && <span>· {sensor.os}</span>}
              {sensor?.version && <span>· monitor {sensor.version}</span>}
            </p>
          </div>
          <Pill tone={changesOn ? 'good' : 'neutral'}>{changesOn ? 'Changes allowed' : 'Changes switched off'}</Pill>
          {can('analyst') && (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void checkNow()}>
              Check now
            </Button>
          )}
        </div>
        {!changesOn && sensor && (
          <p className="mt-3 border-t border-[var(--agent-app-border)] pt-3 text-[13px] text-[var(--agent-app-muted)]">
            NetSentry can only look, not change anything, until changes are switched on at the server itself: run the monitor's installer again and answer "yes" to changes (Settings → Monitor).
          </p>
        )}
      </div>
      <div className="mt-4">
        <PageTabs base="server" tabs={tabs} current={tab ?? 'overview'} />
        {body}
      </div>
    </div>
  );
}

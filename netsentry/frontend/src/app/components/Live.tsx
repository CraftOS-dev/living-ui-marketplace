/**
 * The "NetSentry is on it, right now" layer: a pulsing live bar, counters that
 * climb as checks run, and a feed of what it just checked — in plain words,
 * streaming in by realtime. Used on Home (everything) and on an item's page.
 */
import { useMemo } from 'react';
import { useCollection } from '../store/collections.ts';
import { COLLECTOR_LABELS } from '../lib/format.ts';
import { agoShort, clock, useLatest, useNow, type LiveStats } from '../lib/live.ts';
import { href, to } from '../lib/nav.ts';
import type { Asset, ScanRun, Source } from '../lib/types.ts';
import { TONE_COLOR, type Tone } from './visual.tsx';

// New feed rows slide in; the kit's CSS is system-owned, so the keyframes live here.
const STYLE = `@keyframes ns-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}.ns-in{animation:ns-in .45s ease-out}`;

/** What each check does, as a sentence start. */
const DOING: Record<string, string> = {
  dns: 'Checked where your web address points',
  ct: 'Looked for new security certificates',
  rdap: 'Checked when your web address needs renewing',
  internetdb: 'Checked what the internet can reach',
  reputation: 'Checked the blocklists',
  web: 'Checked the website’s security',
  'sensor.liveness': 'Checked the monitor is reporting',
  'host.info': 'Checked the operating system',
  'host.listeners': 'Checked which programs accept connections',
  'host.users': 'Checked user accounts',
  'host.ssh': 'Checked remote-login settings',
  'host.updates': 'Checked for security updates',
  'host.auth': 'Checked login attempts',
  'host.persistence': 'Checked startup programs',
  'host.fim': 'Checked important system files',
  'host.posture': 'Checked encryption, firewall and antivirus',
  'host.docker': 'Checked Docker containers',
  'host.connections': 'Watched which programs connect where',
  'host.dns': 'Watched which websites are looked up',
  'host.ids': 'Checked intrusion alerts',
  'host.cloud': 'Checked the cloud settings',
  'host.deps': 'Checked project dependencies',
  'host.secrets': 'Checked code for leaked passwords',
  'host.containers': 'Checked the apps running in containers',
  'host.app_config': "Read the apps' settings",
  'host.storage': 'Measured disk space',
  'probe.router': "Read the router's port forwards",
  'probe.apps': 'Checked the apps answer',
  'host.remote_access': 'Checked remote access (Tailscale, tunnels, VPN)',
  'probe.accounts': "Read who has accounts in your apps",
};

function doing(collector: string): string {
  if (collector.startsWith('intel.')) return 'Updated the threat lists';
  return DOING[collector] ?? `Checked ${(COLLECTOR_LABELS[collector] ?? collector).toLowerCase()}`;
}

function outcome(r: ScanRun): { text: string; tone: Tone } {
  const s = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (r.status === 'error') return { text: 'could not finish — tries again soon', tone: 'bad' };
  if (r.findings_opened > 0) return { text: `found ${s(r.findings_opened, 'new problem')}`, tone: 'bad' };
  if (r.findings_resolved > 0) return { text: `${s(r.findings_resolved, 'problem')} now fixed`, tone: 'good' };
  if (r.changes > 0) return { text: `noticed ${s(r.changes, 'change')}`, tone: 'warn' };
  return { text: r.observations > 0 ? `all fine · ${r.observations} looked at` : 'all fine', tone: 'good' };
}

/** Pulsing dot + "Watching …" + a ticking "last check". Red when a monitor went quiet. */
export function LiveBar({ names, lastCheck, silent }: { names: string[]; lastCheck: string; silent?: string[] | undefined }): React.JSX.Element {
  const now = useNow();
  const quiet = silent && silent.length > 0;
  const color = quiet ? TONE_COLOR.bad : TONE_COLOR.good;
  const watching = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" role="status" aria-live="polite">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {!quiet && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </span>
      <span className="font-medium" style={{ color }}>
        {quiet ? `${silent.join(', ')} stopped reporting` : 'Live'}
      </span>
      <span className="min-w-0 truncate text-[var(--agent-app-muted)]">Watching {watching || 'nothing yet'}</span>
      <span className="ml-auto whitespace-nowrap tabular-nums text-[var(--agent-app-muted)]">Last check {agoShort(lastCheck, now)}</span>
    </div>
  );
}

function Counter({ value, label, tone }: { value: number | null; label: string; tone?: Tone | undefined }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-3">
      <p className="text-[22px] font-semibold tabular-nums leading-none" style={tone ? { color: TONE_COLOR[tone] } : undefined}>
        {value === null ? '–' : value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[12px] leading-tight text-[var(--agent-app-muted)]">{label}</p>
    </div>
  );
}

/** Four numbers that move: checks today, things watched, connections seen, open problems. */
export function Counters({ stats }: { stats: LiveStats | null }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Counter value={stats?.checks_today ?? null} label="checks today" />
      <Counter value={stats?.watched ?? null} label="things being watched" />
      <Counter value={stats?.connections_today ?? null} label="connections seen today" />
      <Counter value={stats?.problems ?? null} label={stats?.problems === 1 ? 'problem open' : 'problems open'} tone={stats ? (stats.problems ? 'warn' : 'good') : undefined} />
    </div>
  );
}

/** What NetSentry just did, newest first, streaming in. `assetId` limits it to one item. */
export function LiveFeed({ assetId, limit = 8 }: { assetId?: string | undefined; limit?: number }): React.JSX.Element {
  const sources = useCollection<Source>('sources', assetId ? { filter: `target = "${assetId}"` } : {});
  const assets = useCollection<Asset>('assets');
  const target = useMemo(() => Object.fromEntries(sources.records.map((s) => [s.id, s.target])), [sources.records]);
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  // One item: only its checks. Everything: all checks (wait for sources so rows can link).
  const filter = sources.loading ? null : assetId ? (sources.records.length ? sources.records.map((s) => `source = "${s.id}"`).join(' || ') : 'id = ""') : 'id != ""';
  const runs = useLatest<ScanRun>('scan_runs', filter, '-started', limit);
  const now = useNow(5000);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      <style>{STYLE}</style>
      <div className="flex items-center justify-between border-b border-[var(--agent-app-border)] px-4 py-2.5">
        <span className="text-[13px] font-semibold">Just now</span>
        <a href={href(assetId ? to.item(assetId, 'history') : 'activity')} className="text-[12px] text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
          Everything that happened ›
        </a>
      </div>
      {runs.loading ? (
        <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">Loading…</p>
      ) : runs.records.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">No checks yet — the first ones run within a minute or two of adding something.</p>
      ) : (
        <ul>
          {runs.records.map((r) => {
            const o = outcome(r);
            const asset = target[r.source];
            const body = (
              <>
                <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[o.tone] }} aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] leading-snug">
                  {doing(r.collector)}
                  {!assetId && (names[asset ?? ''] || r.target_label) ? <span className="text-[var(--agent-app-muted)]"> on {names[asset ?? ''] || r.target_label}</span> : null}
                  <span style={{ color: o.tone === 'good' ? 'var(--agent-app-muted)' : TONE_COLOR[o.tone] }}> — {o.text}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-[var(--agent-app-muted)]" title={clock(r.started)}>
                  {agoShort(r.started, now)}
                </span>
              </>
            );
            const cls = 'flex items-start gap-3 px-4 py-2';
            return (
              <li key={r.id} className="ns-in border-b border-[var(--agent-app-border)] last:border-b-0">
                {asset ? (
                  <a href={href(to.item(asset, r.changes > 0 ? 'history' : undefined))} className={cls + ' hover:bg-[var(--agent-app-surface-2)]'}>
                    {body}
                  </a>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

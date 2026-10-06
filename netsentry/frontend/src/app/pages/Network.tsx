/**
 * Network — what the sensors see on the wire over the last 24 hours:
 * destinations, programs that talk to the network, DNS names, IDS alerts,
 * and the network findings they produced.
 */
import { useServer } from '../components/ServerParts.tsx';
import { useMemo } from 'react';
import { EmptyState, ListRow, PageHeader, Pill, Section, Spinner, Stat, StatGrid } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { SeverityPill } from '../components/pills.tsx';
import { pbSince, relTime } from '../lib/format.ts';
import type { Asset, Finding, Observation } from '../lib/types.ts';
import type { RecordModel } from 'pocketbase';

interface Signal extends RecordModel {
  asset: string;
  kind: string;
  key: string;
  window_start: string;
  count: number;
  data: Record<string, unknown> | null;
}

export function Network({ onOpenFinding, embedded }: { onOpenFinding: (id: string) => void; embedded?: boolean }): React.JSX.Element {
  const { sensor } = useServer();
  const windows = sensor?.platform === 'windows';
  const since = useMemo(() => pbSince(24), []);
  const signals = useCollection<Signal>('signals', {
    filter: `window_start >= "${since}" && (kind = "net.conn" || kind = "net.dns" || kind = "ids.alert")`,
    sort: '-window_start',
  });
  const procs = useCollection<Observation>('observations', { filter: 'kind = "host.net_process" && present = true' });
  const findings = useCollection<Finding>('findings', { filter: 'category = "network" && (status = "open" || status = "acknowledged")', sort: '-last_seen' });
  const assets = useCollection<Asset>('assets', { filter: 'kind = "host"' });
  const hostName = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);

  const conns = signals.records.filter((s) => s.kind === 'net.conn');
  const dns = signals.records.filter((s) => s.kind === 'net.dns');
  const dnsNames = useMemo(() => {
    const by = new Map<string, { key: string; last: string; hosts: Set<string> }>();
    for (const s of dns) {
      const cur = by.get(s.key) ?? { key: s.key, last: s.window_start, hosts: new Set<string>() };
      if (s.window_start > cur.last) cur.last = s.window_start;
      cur.hosts.add(hostName[s.asset] ?? '');
      by.set(s.key, cur);
    }
    return [...by.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [dns, hostName]);
  const ids = signals.records.filter((s) => s.kind === 'ids.alert');

  const destinations = useMemo(() => {
    const by: Record<string, { key: string; count: number; ports: Set<string>; procs: Set<string>; hosts: Set<string>; last: string; dir: string }> = {};
    for (const s of conns) {
      const d = s.data ?? {};
      const b = (by[s.key] ??= { key: s.key, count: 0, ports: new Set(), procs: new Set(), hosts: new Set(), last: s.window_start, dir: String(d['direction'] ?? '') });
      b.count += s.count;
      b.ports.add(String(d['remote_port'] ?? '?'));
      if (d['process']) b.procs.add(String(d['process']));
      b.hosts.add(hostName[s.asset] ?? '?');
      if (s.window_start > b.last) b.last = s.window_start;
    }
    return Object.values(by).sort((a, b) => b.count - a.count);
  }, [conns, hostName]);

  if (signals.loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const noSensor = assets.records.length === 0;
  return (
    <>
      {!embedded && <PageHeader title="Network" />}
      <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">What the monitor saw on the network in the last 24 hours: where programs connect, what they look up, and intrusion alerts.</p>
      {noSensor ? (
        <Section title="No monitor yet">
          <EmptyState title="Network activity needs the monitor" message="Install it from Setup (Home shows the way). It reports new connections, looked-up names and intrusion alerts." />
        </Section>
      ) : (
        <>
          <StatGrid>
            <Stat label="Destinations (24 h)" value={String(destinations.length)} />
            <Stat label="Programs on the network" value={String(procs.records.length)} />
            <Stat label="DNS names (24 h)" value={String(new Set(dns.map((d) => d.key)).size)} />
            <Stat label="Open network issues" value={String(findings.records.length)} tone={findings.records.length ? 'bad' : 'good'} />
          </StatGrid>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section title="Network issues" meta={String(findings.records.length)} flush>
              {findings.records.length === 0 ? (
                <EmptyState title="Nothing suspicious" message="No contact with known-malicious addresses, crypto-mining pools or Tor, no suspicious looked-up names and no intrusion alerts." />
              ) : (
                findings.records.slice(0, 10).map((f) => (
                  <ListRow key={f.id} leading={<SeverityPill severity={f.severity} />} primary={f.title} secondary={`${f.rule_id} · ${relTime(f.last_seen)}`} onClick={() => onOpenFinding(f.id)} />
                ))
              )}
            </Section>

            <Section title="Intrusion alerts (24 h)" meta={String(ids.length)} flush>
              {ids.length === 0 ? (
                <EmptyState title="No intrusion alerts" message="Install Suricata, Zeek, Falco or CrowdSec on the server to see intrusion alerts here." />
              ) : (
                ids.slice(0, 15).map((s) => (
                  <ListRow
                    key={s.id}
                    primary={String(s.data?.['signature'] ?? 'alert')}
                    secondary={`${String(s.data?.['engine'] ?? '')} · from ${s.key} · ${hostName[s.asset] ?? ''} · ${relTime(s.window_start)}`}
                    trailing={<Pill tone={s.data?.['severity'] === 'high' ? 'bad' : 'warn'}>{String(s.data?.['severity'] ?? 'medium')}</Pill>}
                  />
                ))
              )}
            </Section>

            <Section title="DNS names looked up (24 h)" meta={String(dnsNames.length)} flush>
              {dnsNames.length === 0 ? (
                <EmptyState title="No DNS names reported" message={windows ? 'Looked-up names come from Windows’ own DNS cache.' : 'Looked-up names come from Zeek, or from a Pi-hole set up for the monitor (NETSENTRY_PIHOLE_URL).'} />
              ) : (
                dnsNames.slice(0, 30).map((d) => (
                  <ListRow key={d.key} primary={d.key} secondary={[...d.hosts].join(', ')} trailing={<span className="text-[12px] tabular-nums text-[var(--agent-app-muted)]">{relTime(d.last)}</span>} />
                ))
              )}
            </Section>

            <Section title="Top destinations (24 h)" meta={String(destinations.length)} flush>
              {destinations.length === 0 ? (
                <EmptyState title="No connections reported yet" />
              ) : (
                destinations.slice(0, 20).map((d) => (
                  <ListRow
                    key={d.key}
                    primary={d.key}
                    secondary={`${d.dir} · port ${[...d.ports].slice(0, 4).join(', ')}${d.procs.size ? ' · ' + [...d.procs].slice(0, 3).join(', ') : ''} · ${[...d.hosts].join(', ')}`}
                    trailing={<span className="text-[12px] tabular-nums text-[var(--agent-app-muted)]">{relTime(d.last)}</span>}
                  />
                ))
              )}
            </Section>

            <Section title="Programs on the network" meta={String(procs.records.length)} flush>
              {procs.records.length === 0 ? (
                <EmptyState title="None reported" message={windows ? 'Program names need the monitor to run as Administrator.' : 'Program names need the monitor to run as root.'} />
              ) : (
                procs.records.slice(0, 30).map((p) => <ListRow key={p.id} primary={p.subject} secondary={`${hostName[p.asset] ?? ''} · first seen ${relTime(p.first_seen)}`} />)
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}

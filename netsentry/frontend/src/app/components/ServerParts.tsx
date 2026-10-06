/**
 * Pieces of the Server page (v4 §5.3): which record is THE server, what the monitor sees on it
 * (filtered by kind for each tab), and its history of changes.
 */
import { useMemo, useState } from 'react';
import { Button, EmptyState, ListRow, Pill, Section, Spinner, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { describeObservation, fmtDateTime, KIND_LABELS, observationTitle, relTime } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import type { AppRecord, Asset, Baseline, Change, Observation, Sensor } from '../lib/types.ts';
import { ShieldIcon } from './icons.tsx';
import { TONE_COLOR } from './visual.tsx';

export function Loading(): React.JSX.Element {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

/** The server NetSentry looks after: the machine its monitor reports for. */
export function useServer(): { asset: Asset | null; sensor: Sensor | null; loading: boolean } {
  const sensors = useCollection<Sensor>('sensors', { filter: 'status != "revoked" && asset != ""', sort: '-last_seen' });
  const hosts = useCollection<Asset>('assets', { filter: 'kind = "host" && status = "active"', sort: '-updated' });
  const sensor = sensors.records[0] ?? null;
  const asset = (sensor ? hosts.records.find((h) => h.id === sensor.asset) : null) ?? hosts.records[0] ?? null;
  return { asset, sensor, loading: sensors.loading || hosts.loading };
}

/** container name → the app's name, so rows read "Jellyfin", not "joe-jellyfin-1" (apps removed since included). */
export function useAppNames(): Record<string, string> {
  const apps = useCollection<AppRecord>('apps', {});
  return useMemo(() => Object.fromEntries(apps.records.filter((a) => a.container).map((a) => [a.container, a.label || a.display_name])), [apps.records]);
}

/** What the monitor sees on the server, grouped by kind (only `kinds` when given). */
/** A row's picture: what kind of thing it is, at a glance (§17). */
function rowLeading(o: Observation): React.ReactNode {
  const d = (o.data ?? {}) as Record<string, unknown>;
  if (o.kind === 'device.posture') {
    const on = d['enabled'] === true;
    const tone = d['enabled'] === undefined || d['enabled'] === null ? 'var(--agent-app-muted)' : on ? TONE_COLOR.good : TONE_COLOR.bad;
    return (
      <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: tone, background: `color-mix(in srgb, var(--agent-app-surface), ${tone} 13%)` }} aria-hidden>
        <ShieldIcon size={16} />
      </span>
    );
  }
  if (o.kind === 'host.listener' || o.kind === 'container.published_port') {
    const port = String(o.subject).match(/(\d{1,5})(?!.*\d)/)?.[1] ?? '';
    return (
      <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-[var(--agent-app-surface-2)] px-1.5 font-mono text-[11px] font-semibold text-[var(--agent-app-muted)]" aria-hidden>
        {port}
      </span>
    );
  }
  return undefined;
}

/** On / off / who can reach it, as a coloured pill. */
function rowStatus(o: Observation): React.ReactNode {
  const d = (o.data ?? {}) as Record<string, unknown>;
  if (o.kind === 'device.posture') {
    if (d['enabled'] === true) return <Pill tone="good">On</Pill>;
    if (d['enabled'] === false) return <Pill tone="bad">Off</Pill>;
    return <Pill tone="neutral">Unknown</Pill>;
  }
  if (o.kind === 'host.listener') {
    const exposure = String(d['exposure'] ?? '');
    if (exposure === 'all') return <Pill tone="warn">Other devices</Pill>;
    if (exposure === 'local') return <Pill tone="neutral">This computer only</Pill>;
  }
  return null;
}

export function Inventory({ asset, kinds, expectedPorts = false }: { asset: Asset; kinds?: string[]; expectedPorts?: boolean }): React.JSX.Element {
  const { can } = useMe();
  const obs = useCollection<Observation>('observations', { filter: `asset = "${asset.id}" && present = true`, sort: 'kind,subject' });
  const baselines = useCollection<Baseline>('baselines', { filter: `asset = "${asset.id}"` });
  const [busy, setBusy] = useState(false);
  const names = useAppNames();
  const grouped = useMemo(() => {
    const g: Record<string, Observation[]> = {};
    for (const o of obs.records) if (!kinds || kinds.includes(o.kind)) (g[o.kind] = g[o.kind] ?? []).push(o);
    const order = kinds ?? Object.keys(g).sort();
    return order.filter((k) => g[k]).map((k) => [k, g[k]!] as const);
  }, [obs.records, kinds]);
  const listenerBaseline = baselines.records.find((b) => b.kind === 'listeners');

  return (
    <div className="flex flex-col gap-4">
      {expectedPorts && (
        <Section
          title="Programs expected to accept connections"
          actions={
            can('analyst') ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await runOp<{ accepted: string[] }>('baselines.accept-listeners', { asset_id: asset.id });
                    toast.success(`Marked ${r.accepted.length} open port(s) as expected.`);
                  } catch {
                    /* toast shown */
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Mark current as expected
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {listenerBaseline && (listenerBaseline.accepted as string[]).length > 0 ? (
              <div className="relative flex max-h-[160px] flex-wrap gap-1.5 overflow-y-auto">
                {(listenerBaseline.accepted as string[]).map((p) => (
                  <span key={p} className="inline-flex items-center rounded-full bg-[var(--agent-app-surface-2)] px-2.5 py-1 font-mono text-[12px]">
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[13px]">None yet.</p>
            )}
            <p className="text-[12px] text-[var(--agent-app-muted)]">
              {listenerBaseline ? `Set by ${listenerBaseline.accepted_by} ${relTime(listenerBaseline.at)}. ` : "Recorded from the monitor's first report. "}A new one shows up in Activity to review.
            </p>
          </div>
        </Section>
      )}
      {obs.loading ? (
        <Loading />
      ) : grouped.length === 0 ? (
        <EmptyState title="Nothing yet" message="This fills in as the monitor's checks run for the first time." />
      ) : (
        grouped.map(([kind, list]) => (
          <Section key={kind} title={KIND_LABELS[kind] ?? kind} meta={String(list.length)} flush>
            <div className="relative max-h-[440px] overflow-y-auto">
              {list.slice(0, 100).map((o) => (
                <ListRow
                  key={o.id}
                  leading={rowLeading(o)}
                  primary={observationTitle(o.kind, o.subject, o.data, names)}
                  secondary={describeObservation(o.kind, o.data)}
                  trailing={
                    <span className="flex items-center gap-2">
                      {rowStatus(o)}
                      <span className="text-[12px] text-[var(--agent-app-muted)]">{relTime(o.last_seen)}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}

/** What appeared, disappeared or changed on the server between checks. */
export function Timeline({ assetId }: { assetId: string }): React.JSX.Element {
  const names = useAppNames();
  const changes = useCollection<Change>('changes', { filter: `asset = "${assetId}"`, sort: '-at' });
  return (
    <Section title="What changed on the server" meta={String(changes.records.length)} flush>
      {changes.loading ? (
        <Loading />
      ) : changes.records.length === 0 ? (
        <EmptyState title="No changes yet" message="Anything that appears, disappears or changes between checks is listed here." />
      ) : (
        changes.records.slice(0, 200).map((c) => (
          <ListRow
            key={c.id}
            primary={`${KIND_LABELS[c.kind] ?? c.kind}: ${observationTitle(c.kind, c.subject, (c.after ?? c.before) as Record<string, unknown>, names)}`}
            secondary={`${fmtDateTime(c.at)} · ${
              c.change === 'removed' ? 'was ' + describeObservation(c.kind, c.before as Record<string, unknown>) : describeObservation(c.kind, c.after as Record<string, unknown>)
            }`}
            trailing={<Pill tone={c.change === 'removed' ? 'warn' : c.change === 'added' ? 'info' : 'neutral'}>{c.change === 'added' ? 'new' : c.change === 'removed' ? 'gone' : 'changed'}</Pill>}
          />
        ))
      )}
    </Section>
  );
}

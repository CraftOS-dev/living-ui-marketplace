/**
 * Coverage — what is watching an item, in plain words, and for anything that
 * cannot run here, the one thing to do about it. When the item's machine
 * monitor has gone silent, everything it reports is shown as not working —
 * its last results are stale, whatever the source records say.
 */
import { useState } from 'react';
import { Button, EmptyState, ListRow, Pill, Section, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useDetailed } from '../lib/view.tsx';
import { COLLECTOR_LABELS, relTime } from '../lib/format.ts';
import type { Finding, Sensor, Source } from '../lib/types.ts';
import { CHECK_HELP, CHECK_STATE, checkState, type CheckState } from '../lib/words.ts';

/** A check's state, taking a silent machine monitor into account. */
export function coverageState(s: Source, silent: boolean): CheckState {
  const st = checkState(s);
  if (silent && (s.sensor || s.collector === 'sensor.liveness') && st !== 'unavailable' && st !== 'off') return 'broken';
  return st;
}

export interface CoverageSummary {
  working: number;
  /** Checks that could run here (excludes "not available here" and turned off). */
  applicable: number;
  problems: number;
  unavailable: number;
}

export function summarize(sources: Source[], silent = false): CoverageSummary {
  const c = { working: 0, applicable: 0, problems: 0, unavailable: 0 };
  for (const s of sources) {
    const st = coverageState(s, silent);
    if (st === 'unavailable') c.unavailable += 1;
    if (st === 'unavailable' || st === 'off') continue;
    c.applicable += 1;
    if (st === 'working') c.working += 1;
    if (st === 'trouble' || st === 'broken') c.problems += 1;
  }
  return c;
}

/** Machines whose monitor has stopped reporting, by asset id. */
export function silentAssets(sensors: Sensor[]): Set<string> {
  return new Set(sensors.filter((s) => s.status === 'offline' && s.asset).map((s) => s.asset));
}

export function CoverageBadge({ sources, silent = false }: { sources: Source[]; silent?: boolean }): React.JSX.Element | null {
  if (sources.length === 0) return null;
  if (silent) return <Pill tone="bad">Monitor not reporting</Pill>;
  const c = summarize(sources);
  const tone = c.problems ? 'warn' : c.working === c.applicable ? 'good' : 'neutral';
  return (
    <Pill tone={tone}>
      {c.working}/{c.applicable} checks working
    </Pill>
  );
}

const ORDER: CheckState[] = ['broken', 'trouble', 'working', 'waiting', 'unavailable', 'off'];

function detail(s: Source, st: CheckState, monitor: Sensor | null): string {
  const help = CHECK_HELP[s.collector];
  if (st === 'broken' && monitor?.status === 'offline' && (s.sensor || s.collector === 'sensor.liveness')) {
    return `The monitor stopped reporting ${relTime(monitor.last_seen)} — these results are from before that.`;
  }
  if (st === 'unavailable') return help?.enable ?? s.last_error.replace(/^Not available( here)?:?\s*/, '');
  if (st === 'broken' || st === 'trouble') return `${s.last_error || 'The last runs failed'} — NetSentry retries automatically.`;
  if (st === 'waiting') return s.sensor ? 'Waiting for the monitor’s first report.' : 'Runs for the first time shortly.';
  if (st === 'off') return 'Turned off in Settings → Checks.';
  const when = s.last_run ? (s.sensor ? `last report ${relTime(s.last_run)}` : `checked ${relTime(s.last_run)}`) : '';
  return [help?.what, when].filter(Boolean).join(' · ');
}

export function CoverageList({ assetId }: { assetId: string }): React.JSX.Element {
  const sources = useCollection<Source>('sources', { filter: `target = "${assetId}"`, sort: 'collector' });
  const sensors = useCollection<Sensor>('sensors', { filter: `asset = "${assetId}" && status != "revoked"` });
  const detailed = useDetailed();
  const [showAll, setShowAll] = useState(false);
  if (sources.loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (sources.records.length === 0) {
    return (
      <Section title="Coverage">
        <EmptyState title="Nothing is checking this yet" message="Checks are set up automatically when something is added." />
      </Section>
    );
  }
  const monitor = sensors.records.find((s) => s.status === 'online') ?? sensors.records[0] ?? null;
  const silent = monitor !== null && monitor.status === 'offline';
  const rows = [...sources.records].sort((a, b) => ORDER.indexOf(coverageState(a, silent)) - ORDER.indexOf(coverageState(b, silent)));
  const c = summarize(sources.records, silent);
  return (
    <Section title="Coverage" meta={`${c.working}/${c.applicable} working${c.unavailable ? ` · ${c.unavailable} not available here` : ''}`} flush>
      <p className="border-b border-[var(--agent-app-border)] px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">
        {silent
          ? `The monitor on this server stopped reporting ${relTime(monitor.last_seen)}. Start it again (Settings → Monitor) — until then NetSentry cannot see what happens here.`
          : detailed
            ? 'What NetSentry checks on this item. Items marked “Not available here” tell you what would switch them on.'
            : 'What NetSentry keeps an eye on here. Only checks that need your attention are listed.'}
      </p>
      {(detailed || showAll ? rows : silent ? [] : rows.filter((s) => ['broken', 'trouble', 'waiting'].includes(coverageState(s, silent)))).map((s) => {
        const st = coverageState(s, silent);
        const meta = CHECK_STATE[st];
        return (
          <ListRow
            key={s.id}
            leading={<span aria-hidden className="w-4 text-center font-semibold">{meta.icon}</span>}
            primary={COLLECTOR_LABELS[s.collector] ?? s.collector}
            secondary={detail(s, st, monitor)}
            trailing={<Pill tone={meta.tone}>{meta.label}</Pill>}
          />
        );
      })}
      {!detailed && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
          <span className="text-[var(--agent-app-muted)]">
            {c.problems === 0 && !silent ? `All ${c.working} checks that can run here are working.` : `${c.working} of ${c.applicable} checks are working.`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `Show all ${rows.length} checks`}
          </Button>
        </div>
      )}
    </Section>
  );
}

/**
 * Simple view: what is being watched, as a grid of small chips (✓ working,
 * ! needs attention, – not available here). Tap a chip for one line about it.
 */
/** Which detection rules each check feeds — so a chip can show "found a problem". */
const CHECK_RULES: Record<string, string[]> = {
  web: ['WEB-'], dns: ['DNS-', 'MAIL-'], ct: ['CT-', 'TLS-'], rdap: ['REG-'], internetdb: ['EXP-'], reputation: ['REP-'],
  'host.listeners': ['HOST-001', 'HOST-004'], 'host.docker': ['HOST-002'], 'host.ssh': ['HOST-003', 'HOST-006'], 'host.users': ['HOST-006'],
  'host.updates': ['HOST-007'], 'host.auth': ['HOST-005', 'HOST-016'], 'host.fim': ['HOST-008'], 'host.persistence': ['HOST-009'],
  'host.posture': ['DEV-'], 'sensor.liveness': ['RES-002'], 'host.connections': ['NET-001', 'NET-006', 'NET-007', 'NET-008'],
  'host.dns': ['NET-001', 'NET-004'], 'host.ids': ['NET-009'], 'host.cloud': ['CLD-'], 'host.deps': ['CODE-002'], 'host.secrets': ['CODE-001'],
};

export function CoverageGrid({ assetId }: { assetId: string }): React.JSX.Element | null {
  const sources = useCollection<Source>('sources', { filter: `target = "${assetId}"`, sort: 'collector' });
  const open = useCollection<Finding>('findings', { filter: `asset = "${assetId}" && status = "open"` });
  const sensors = useCollection<Sensor>('sensors', { filter: `asset = "${assetId}" && status != "revoked"` });
  const [picked_id, setOpen] = useState<string | null>(null);
  if (sources.loading || sources.records.length === 0) return null;
  const flagged = (collector: string): boolean => (CHECK_RULES[collector] ?? []).some((p) => open.records.some((f) => f.rule_id.startsWith(p)));
  const monitor = sensors.records.find((s) => s.status === 'online') ?? sensors.records[0] ?? null;
  const silent = monitor !== null && monitor.status === 'offline';
  const rows = [...sources.records].sort((a, b) => ORDER.indexOf(coverageState(a, silent)) - ORDER.indexOf(coverageState(b, silent)));
  const c = summarize(sources.records, silent);
  const picked = rows.find((s) => s.id === picked_id) ?? null;
  const TONE: Record<CheckState, string> = {
    working: 'rgb(22 163 74)',
    trouble: 'rgb(217 119 6)',
    broken: 'rgb(220 38 38)',
    unavailable: 'var(--agent-app-muted)',
    waiting: 'var(--agent-app-muted)',
    off: 'var(--agent-app-muted)',
  };
  return (
    <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-medium">What NetSentry watches here</p>
        <span className="text-[13px] text-[var(--agent-app-muted)]">
          {silent ? 'Monitor not reporting' : `${c.working} of ${c.applicable} working`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((s) => {
          const st = coverageState(s, silent);
          const meta = CHECK_STATE[st];
          const found = st === 'working' && flagged(s.collector);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpen(picked_id === s.id ? null : s.id)}
              aria-pressed={picked_id === s.id}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${
                picked_id === s.id ? 'border-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)]'
              } ${st === 'unavailable' || st === 'off' ? 'text-[var(--agent-app-muted)]' : ''}`}
            >
              <span style={{ color: found ? TONE.trouble : TONE[st] }} aria-hidden>
                {found ? '!' : meta.icon}
              </span>
              {COLLECTOR_LABELS[s.collector] ?? s.collector}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="mt-3 rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[13px]">
          {coverageState(picked, silent) === 'working' && flagged(picked.collector) ? (
            <>
              <span className="font-medium">Found a problem</span> — it is listed above.
            </>
          ) : (
            <>
              <span className="font-medium">{CHECK_STATE[coverageState(picked, silent)].label}.</span> {detail(picked, coverageState(picked, silent), monitor)}
            </>
          )}
        </p>
      )}
    </div>
  );
}

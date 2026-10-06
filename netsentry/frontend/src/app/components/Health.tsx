/**
 * Is it running well? (v3 plan §7.3) — a machine's health strip and an app's
 * CPU / memory. While NetSentry is open the figures are live (the 2-second sample,
 * v4 §16) and the graph ends on that reading; the history behind each graph is
 * the once-a-minute readings `metrics.series` keeps for 90 days (read again each minute).
 */
import { useEffect, useState } from 'react';
import { Pill } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { runOp } from '../lib/ops.ts';
import { RunControls } from './Controls.tsx';
import { useLive, useUpdatedWords } from '../lib/liveStatus.tsx';
import { useOp } from '../store/resources.ts';
import type { Observation } from '../lib/types.ts';

export interface Point {
  t: string;
  cpu?: number;
  cpu_max?: number;
  mem?: number;
  mem_max?: number;
  mem_used?: number;
  mem_total?: number;
  mem_limit?: number;
  load1?: number;
  temp_c?: number;
  uptime_s?: number;
  restarts?: number;
  state?: string;
}

export type Range = '1h' | '24h' | '7d' | '30d';

/** One subject's numbers over a range (cached; read again each minute — the readings are per minute). */
export function useSeries(assetId: string, subject: string, range: Range): { points: Point[]; loading: boolean } {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const t = window.setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 15000);
    return () => window.clearInterval(t);
  }, []);
  const r = useOp<{ points: Point[] }>('metrics.series', { asset_id: assetId, subject, range }, { deps: minute, freshMs: 30000 });
  return { points: r.data?.points ?? [], loading: r.loading };
}

/** A small line chart: `values` in order, scaled to [0, max]. Decorative; the number next to it is the reading. */
export function Sparkline({ values, max, tone = 'accent', label }: { values: Array<number | null>; max: number; tone?: 'accent' | 'warn' | 'danger'; label: string }): React.JSX.Element {
  const w = 160;
  const h = 36;
  const pts = values.map((v, i) => (v === null || !isFinite(v) ? null : [values.length < 2 ? w : (i / (values.length - 1)) * w, h - 2 - (Math.min(v, max) / (max || 1)) * (h - 4)]));
  const path = pts.reduce((acc, p, i) => (p === null ? acc : `${acc}${acc === '' || pts[i - 1] === null ? 'M' : 'L'}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)} `), '');
  // The kit's own tone colours (text-* classes), drawn with currentColor.
  const color = tone === 'danger' ? 'text-red-700 dark:text-red-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--agent-app-accent)]';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-9 w-full ${color}`} role="img" aria-label={label}>
      <line x1="0" x2={w} y1={h - 1} y2={h - 1} stroke="var(--agent-app-border)" strokeWidth="1" />
      {path && <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function bytes(n: number | undefined | null): string {
  if (n === undefined || n === null || !isFinite(n)) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

function uptimeWords(s: number | undefined): string {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} day${d === 1 ? '' : 's'}${h ? `, ${h} h` : ''}` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
}

function Stat({ title, value, hint, chart }: { title: string; value: string; hint?: string | undefined; chart?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3">
      <div className="text-[12px] text-[var(--agent-app-muted)]">{title}</div>
      <div className="text-[18px] font-semibold tabular-nums">{value}</div>
      {hint && <div className="truncate text-[12px] text-[var(--agent-app-muted)]">{hint}</div>}
      {chart && <div className="mt-1">{chart}</div>}
    </div>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }): React.JSX.Element {
  return (
    <div className="flex gap-1" role="group" aria-label="Time range">
      {(['1h', '24h', '7d', '30d'] as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`rounded-md px-2 py-0.5 text-[12px] ${value === r ? 'bg-[var(--agent-app-surface-2)] font-semibold' : 'text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]'}`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** The machine's health strip: CPU, memory, temperature, uptime, plus failed services, disks and a pending restart. */
/** A reading with only the values it has (live samples lack some of the minute readings' fields). */
function pointOf(o: Record<string, number | string | null | undefined>): Point {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as unknown as Point;
}

/** "Live · updated 2 s ago" or "from the last check" — which kind of numbers these are. */
function LiveNote(): React.JSX.Element {
  const live = useLive();
  const words = useUpdatedWords(live.at, live.fresh);
  return live.fresh ? (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]">
      <span className="ns-live-dot h-[7px] w-[7px] rounded-full bg-green-600" aria-hidden />
      Live · {words}
    </span>
  ) : (
    <span className="text-[12px] text-[var(--agent-app-muted)]">From the last check (once a minute)</span>
  );
}

export function MachineHealth({ assetId }: { assetId: string }): React.JSX.Element | null {
  const [range, setRange] = useState<Range>('24h');
  const { points: history, loading } = useSeries(assetId, 'machine', range);
  const live = useLive();
  const s = live.assetId === assetId ? live.sample : null;
  // The graph ends on the live reading: the minute history, then "now".
  const points: Point[] = s
    ? [...history, pointOf({ t: new Date().toISOString(), cpu: s.cpu, mem_used: s.mem_used, mem_total: s.mem_total, uptime_s: s.uptime_s ?? history[history.length - 1]?.uptime_s, temp_c: history[history.length - 1]?.temp_c, load1: history[history.length - 1]?.load1 })]
    : history;
  const health = useCollection<Observation>('observations', { filter: `asset = "${assetId}" && present = true && (kind = "host.health" || kind = "service.problem" || kind = "disk.smart" || kind = "disk.raid" || kind = "disk.pool")` });
  if (loading && !points.length) return null;
  if (!points.length && !health.records.length) return null;
  const last = points[points.length - 1];
  const memPct = (p: Point): number | null => (p.mem_total ? (100 * (p.mem_used ?? 0)) / p.mem_total : null);
  const lastMem = last ? memPct(last) : null;
  const services = health.records.filter((o) => o.kind === 'service.problem');
  const disks = health.records.filter((o) => o.kind.startsWith('disk.'));
  const badDisks = disks.filter((o) => {
    const d = o.data as Record<string, unknown>;
    return d['verdict'] === 'failing' || d['verdict'] === 'warning' || d['state'] === 'degraded' || (typeof d['health'] === 'string' && d['health'] !== 'ONLINE');
  });
  const hh = health.records.find((o) => o.kind === 'host.health');
  const reboot = !!(hh && (hh.data as Record<string, unknown>)['reboot_required']);
  const hasTemp = points.some((p) => typeof p.temp_c === 'number');
  return (
    <section aria-label="How the server is running">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex flex-wrap items-center gap-x-3 text-[13px] font-semibold">
          How it's running <LiveNote />
        </h2>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          title="Processor"
          value={last && typeof last.cpu === 'number' ? `${Math.round(last.cpu)}%` : '—'}
          hint={last && typeof last.load1 === 'number' ? `load ${last.load1}` : undefined}
          chart={<Sparkline label="Processor use over time" values={points.map((p) => (typeof p.cpu === 'number' ? p.cpu : null))} max={100} tone={last && (last.cpu ?? 0) > 90 ? 'warn' : 'accent'} />}
        />
        <Stat
          title="Memory"
          value={lastMem !== null ? `${Math.round(lastMem)}%` : '—'}
          hint={last ? `${bytes(last.mem_used)} of ${bytes(last.mem_total)}` : undefined}
          chart={<Sparkline label="Memory use over time" values={points.map(memPct)} max={100} tone={lastMem !== null && lastMem > 92 ? 'danger' : 'accent'} />}
        />
        {hasTemp ? (
          <Stat
            title="Temperature"
            value={last && typeof last.temp_c === 'number' ? `${Math.round(last.temp_c)} °C` : '—'}
            chart={<Sparkline label="Temperature over time" values={points.map((p) => (typeof p.temp_c === 'number' ? p.temp_c : null))} max={110} />}
          />
        ) : (
          <Stat title="Temperature" value="—" hint="Not reported on this server" />
        )}
        <Stat title="Up for" value={uptimeWords(last?.uptime_s)} hint={reboot ? 'A restart is waiting to finish updates' : undefined} />
      </div>
      {(services.length > 0 || badDisks.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 text-[13px]">
          {services.map((o) => {
            const d = o.data as Record<string, string>;
            return (
              <li key={o.id} className="flex items-center gap-2">
                <Pill tone="bad">{d['sub'] === 'auto-restart' ? 'keeps restarting' : 'failed'}</Pill>
                <span className="min-w-0 flex-1 truncate">{(d['unit'] || o.subject).replace(/\.service$/, '')}{d['description'] ? ` — ${d['description']}` : ''}</span>
                <RunControls compact target={{ asset_id: assetId, service: d['unit'] || o.subject, label: d['description'] || '' }} running={d['sub'] === 'auto-restart' ? null : false} />
              </li>
            );
          })}
          {badDisks.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <Pill tone="bad">disk</Pill>
              <span className="truncate">{String((o.data as Record<string, unknown>)['model'] || o.subject)}: needs attention</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** An app's CPU and memory (its container). Nothing when the machine doesn't report container numbers. */
export function AppNumbers({ assetId, container }: { assetId: string; container: string }): React.JSX.Element | null {
  const [range, setRange] = useState<Range>('24h');
  const { points: history } = useSeries(assetId, container, range);
  const live = useLive();
  const now = live.assetId === assetId ? live.app(container) : null;
  const points: Point[] =
    now && now.running ? [...history, pointOf({ t: new Date().toISOString(), cpu: now.cpu, mem: now.mem, mem_limit: history[history.length - 1]?.mem_limit })] : history;
  if (!points.length) return null;
  const last = points[points.length - 1]!;
  return (
    <section aria-label="How the app is running" className="mb-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex flex-wrap items-center gap-x-3 text-[13px] font-semibold">
          How it's running <LiveNote />
        </h2>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          title="Processor"
          value={typeof last.cpu === 'number' ? `${Math.round(last.cpu)}%` : '—'}
          hint="100% = one core busy"
          chart={<Sparkline label="Processor use over time" values={points.map((p) => (typeof p.cpu === 'number' ? p.cpu : null))} max={Math.max(100, ...points.map((p) => p.cpu_max ?? p.cpu ?? 0))} />}
        />
        <Stat
          title="Memory"
          value={bytes(last.mem)}
          hint={last.mem_limit && last.mem_limit < 1e15 ? `limit ${bytes(last.mem_limit)}` : 'no limit'}
          chart={<Sparkline label="Memory use over time" values={points.map((p) => (typeof p.mem === 'number' ? p.mem : null))} max={Math.max(1, ...points.map((p) => p.mem_max ?? p.mem ?? 0))} />}
        />
      </div>
    </section>
  );
}

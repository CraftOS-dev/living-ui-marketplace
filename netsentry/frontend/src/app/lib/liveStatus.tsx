/**
 * Live numbers while NetSentry is open (v4 plan §16, N-B24).
 *
 * One provider for the whole app: it keeps the server "watched" while this tab is visible (so its
 * monitor samples every 2 s), follows the server's `live_status` record in realtime, and keeps the
 * last 40 processor / memory readings for the small graphs. A sample older than 10 s is not live:
 * pages say so and fall back to the last regular report.
 *
 * It also notices an app stopping or starting between two samples and says so once (a toast), on
 * whatever page the person is.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getPbClient, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import type { AppRecord, Sensor } from './types.ts';
import { useWatch } from '../components/Controls.tsx';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';

export interface LiveApp {
  container: string;
  state: string;
  running: boolean;
  health: string;
  cpu: number | null;
  mem: number | null;
}

export interface LiveSample {
  cpu: number | null;
  mem_pct: number | null;
  mem_used: number | null;
  mem_total: number | null;
  disk_pct: number | null;
  disk_free: number | null;
  disk_mount: string;
  uptime_s?: number | null;
  apps: LiveApp[];
}

interface LiveRecord extends RecordModel {
  asset: string;
  at: string;
  data: LiveSample | null;
}

export interface Live {
  assetId: string | null;
  /** The newest sample, when it is fresh (≤ 10 s old). */
  sample: LiveSample | null;
  /** When the newest sample was taken (fresh or not). */
  at: Date | null;
  fresh: boolean;
  /** The last readings, oldest first (for the small graphs). */
  history: { cpu: number[]; mem: number[] };
  /** Live state of an app's container, when fresh. */
  app: (container: string | undefined | null) => LiveApp | null;
  /** The newest sample even when it is old (numbers "as of" `at`; never used for running/stopped). */
  last: LiveSample | null;
}

const FRESH_MS = 10000;
const KEEP = 40;
const LiveContext = createContext<Live>({ assetId: null, sample: null, at: null, fresh: false, history: { cpu: [], mem: [] }, app: () => null, last: null });

/**
 * The server's live_status record, followed with ONE subscription made when NetSentry opens and kept
 * for as long as it is open. (A subscription re-made when its filter changes was seen to stop
 * delivering on busy pages — walk-verify N6 D6 — so this one never changes; records are matched to
 * the server here.) If no sample arrives for a while, it asks once more, so a lost update can't
 * leave the page stuck.
 */
function useLiveRecord(assetId: string | null): LiveRecord | null {
  const [rec, setRec] = useState<LiveRecord | null>(null);
  const asset = useRef(assetId);
  asset.current = assetId;
  const [resub, setResub] = useState(0);
  const fetchNow = useRef<(check?: boolean) => void>(() => undefined);
  fetchNow.current = (check = false) => {
    if (!assetId) return;
    void getPbClient()
      .call((pb) => pb.collection('live_status').getFirstListItem<LiveRecord>(`asset = "${assetId}"`), { silent: true })
      .then((r) => {
        // Newer than anything realtime brought: the subscription stopped delivering — make it again.
        if (check && rec?.at && r.at !== rec.at) setResub((n) => n + 1);
        setRec(r);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    let unsubscribe: UnsubscribeFunc | null = null;
    let cancelled = false;
    void getPbClient()
      .call((pb) => pb.collection('live_status').subscribe<LiveRecord>('*', (e) => {
        if (e.record.asset === asset.current && e.action !== 'delete') setRec(e.record);
      }), { silent: true })
      .then((fn) => {
        if (cancelled) void fn();
        else unsubscribe = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [resub]);
  useEffect(() => fetchNow.current(), [assetId]);
  // Safety net: while this tab is visible and nothing new came for 6 s, ask once more (every 6 s).
  const lastAt = rec?.at ?? '';
  useEffect(() => {
    if (!assetId) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const at = lastAt ? Date.parse(lastAt.replace(' ', 'T')) : 0;
      if (Date.now() - at > 6000) fetchNow.current(true);
    }, 6000);
    return () => window.clearInterval(t);
  }, [assetId, lastAt]);
  return rec;
}

/** Re-render every second, so "updated 3 s ago" and freshness move on their own. */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function LiveProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked" && asset != ""', sort: '-last_seen' });
  const assetId = monitors.records[0]?.asset || null;
  useWatch(assetId);
  const r = useLiveRecord(assetId);
  const apps = useCollection<AppRecord>('apps', { filter: 'status = "active"' });
  const now = useNow();
  const at = r?.at ? new Date(r.at.replace(' ', 'T')) : null;
  const fresh = !!(at && r?.data && now - at.getTime() < FRESH_MS);

  // The graphs' memory: one point per new sample.
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const lastAt = useRef('');
  useEffect(() => {
    if (!r?.data || !r.at || r.at === lastAt.current) return;
    lastAt.current = r.at;
    const d = r.data;
    setHistory((h) => ({
      cpu: d.cpu === null ? h.cpu : [...h.cpu, d.cpu].slice(-KEEP),
      mem: d.mem_pct === null ? h.mem : [...h.mem, d.mem_pct].slice(-KEEP),
    }));
  }, [r?.at, r?.data]);

  // An app that stopped or started since the last sample: say it once, wherever the person is.
  const states = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    if (!fresh || !r?.data) return;
    const next = new Map(r.data.apps.map((a) => [a.container, a.running]));
    const before = states.current;
    states.current = next;
    if (!before) return;
    const nameOf = (c: string): string | null => {
      const a = apps.records.find((x) => x.container === c);
      return a ? a.label || a.display_name || c : null; // only the apps NetSentry lists
    };
    for (const [c, running] of next) {
      if (before.get(c) === undefined || before.get(c) === running) continue;
      const name = nameOf(c);
      if (!name) continue;
      if (running) toast.success(`${name} is running again.`);
      else toast.error(`${name} just stopped.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.at]);

  const value = useMemo<Live>(
    () => ({
      assetId,
      sample: fresh ? r!.data : null,
      at,
      fresh,
      history,
      app: (container) => (fresh && container ? r!.data!.apps.find((a) => a.container === container) ?? null : null),
      last: r?.data ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assetId, r?.at, fresh, history],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  return useContext(LiveContext);
}

/** How long ago, in the words a live page needs: "4 s ago", "3 min ago", "2 h ago". */
export function agoWords(at: Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

/** "updated just now" / "updated 4 s ago" while live; "not live" when not (the page then shows its last regular report). */
export function useUpdatedWords(at: Date | null, fresh: boolean): string {
  const now = useNow();
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (fresh) return s < 3 ? 'updated just now' : `updated ${s} s ago`;
  return 'not live — showing the last check';
}

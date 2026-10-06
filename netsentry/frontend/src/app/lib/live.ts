/**
 * Live data for the "it is watching right now" feeling: the newest few records
 * of a collection (kept current by realtime), the activity.stats counters, and
 * a ticking clock for "last check 12s ago". Same strategy as the kit's
 * useCollection — fetch + realtime subscription + debounced refetch — but only
 * the latest page, so a busy feed never loads the whole table.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { getPbClient } from '../../kit/index.ts';
import { runOp } from './ops.ts';

function useRealtime(collections: string[], onEvent: () => void): void {
  const key = collections.join(',');
  useEffect(() => {
    const subs: UnsubscribeFunc[] = [];
    let cancelled = false;
    for (const c of collections) {
      void getPbClient()
        .call((pb) => pb.collection(c).subscribe('*', onEvent), { silent: true })
        .then((fn) => {
          if (cancelled) void fn();
          else subs.push(fn);
        })
        .catch(() => {
          /* realtime unavailable — data still loads, just not live */
        });
    }
    return () => {
      cancelled = true;
      for (const fn of subs) void fn();
    };
  }, [key, onEvent]);
}

function useDebounced(fn: () => void, ms: number): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  }, [fn, ms]);
}

/** The newest `limit` records matching `filter`, live. `filter === null` = not ready yet (loads nothing). */
export function useLatest<T extends RecordModel>(collection: string, filter: string | null, sort: string, limit: number): { records: T[]; loading: boolean } {
  const [records, setRecords] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (filter === null) return;
    try {
      const page = await getPbClient().call((pb) => pb.collection(collection).getList<T>(1, limit, { filter, sort, skipTotal: true }), { silent: true });
      setRecords(page.items);
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, [collection, filter, sort, limit]);
  useEffect(() => {
    void load();
  }, [load]);
  const refetch = useDebounced(() => void load(), 250);
  useRealtime(filter === null ? [] : [collection], refetch);
  return { records, loading: loading && filter !== null };
}

export interface LiveStats {
  checks_today: number;
  watched: number;
  connections_today: number;
  problems: number;
  last_check: string;
}

/** activity.stats for everything (or one item), refreshed whenever a check finishes or an issue changes. */
export function useLiveStats(assetId?: string): LiveStats | null {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const load = useCallback(() => {
    void runOp<LiveStats>('activity.stats', assetId ? { asset_id: assetId } : {}, { silent: true }).then(setStats, () => undefined);
  }, [assetId]);
  useEffect(load, [load]);
  const refetch = useDebounced(load, 500);
  useRealtime(['scan_runs', 'findings'], refetch);
  return stats;
}

/** Re-renders every `ms` so relative times ("12s ago") keep moving. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "12s ago", "4 min ago", "2 h ago", "3 days ago". */
export function agoShort(iso: string, now: number): string {
  if (!iso) return 'not yet';
  const t = Date.parse(iso.replace(' ', 'T'));
  if (Number.isNaN(t)) return 'not yet';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** "14:03:21" in the viewer's time. */
export function clock(iso: string): string {
  const t = Date.parse(iso.replace(' ', 'T'));
  return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

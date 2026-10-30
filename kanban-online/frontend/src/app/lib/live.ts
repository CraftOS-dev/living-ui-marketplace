/**
 * Live views over operations: load once, then reload (debounced) whenever a
 * watched collection changes. What teammates do in the app and what the
 * agents do through the CLI shows up on screen without a refresh.
 *
 * One realtime hub: every app collection is subscribed ONCE, in a single
 * tick at startup, and views register listeners with the hub. Subscribing
 * per view does not work: the SDK drops subscriptions made while its first
 * connection is still being set up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';

export const LIVE_COLLECTIONS = ['settings', 'users', 'agents', 'boards', 'columns', 'labels', 'cards', 'events', 'runs', 'rules'] as const;
export type LiveCollection = (typeof LIVE_COLLECTIONS)[number];

export interface LiveEvent {
  action: string;
  record: { id: string; [k: string]: unknown };
}

const listeners = new Map<string, Set<(ev: LiveEvent) => void>>();
let started = false;

export function startLive(): void {
  if (started) return;
  started = true;
  // Every (re)connect after the first means the server came back, often with
  // a new version of the app: check it (same tick as the subscriptions below).
  let connects = 0;
  void getPbClient()
    .call(
      (pb) =>
        pb.realtime.subscribe('PB_CONNECT', () => {
          connects += 1;
          if (connects > 1) void checkForNewVersion();
        }),
      { silent: true },
    )
    .catch(() => undefined);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewVersion();
  });
  for (const c of LIVE_COLLECTIONS) {
    void getPbClient()
      .call(
        (pb) =>
          pb.collection(c).subscribe('*', (e) => {
            for (const fn of listeners.get(c) ?? []) fn(e as unknown as LiveEvent);
          }),
        { silent: true },
      )
      .catch(() => undefined);
  }
}

/* ----------------------------------------------------------- new versions */

function scriptOf(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

let reloading = false;

/**
 * An open page keeps the code it loaded, so a redeploy would not reach it
 * until someone reloads. Compare this page's script with the one the server
 * serves now and reload when they differ, waiting while a dialog is open.
 */
async function checkForNewVersion(): Promise<void> {
  if (reloading) return;
  const mine = scriptOf(document);
  if (mine === null) return;
  let served: string | null = null;
  try {
    const res = await fetch(window.location.pathname, { cache: 'no-store' });
    if (!res.ok) return;
    served = scriptOf(new DOMParser().parseFromString(await res.text(), 'text/html'));
  } catch {
    return;
  }
  if (served === null || served === mine) return;
  reloading = true;
  const reloadWhenIdle = (): void => {
    if (document.querySelector('[role="dialog"]') !== null) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  reloadWhenIdle();
}

/** Listen to one collection's realtime events. Returns the unsubscribe. */
export function listen(collection: LiveCollection, fn: (ev: LiveEvent) => void): () => void {
  let set = listeners.get(collection);
  if (set === undefined) {
    set = new Set();
    listeners.set(collection, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export interface Live<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useLive<T>(load: () => Promise<T>, collections: LiveCollection[], deps: unknown[], delay = 150, minGap = 1000): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps);

  const lastRun = useRef(0);
  // A failed load is tried again a few times (a busy server answers 429 for a moment).
  const failures = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useCallback(() => {
    lastRun.current = Date.now();
    if (retry.current !== null) clearTimeout(retry.current);
    retry.current = null;
    const mine = ++seq.current;
    loader()
      .then((d) => {
        if (mine !== seq.current) return;
        failures.current = 0;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        const e = err as { message?: string; status?: number };
        setError(e.message ?? 'Could not load');
        if (failures.current < 5 && e.status !== 404 && e.status !== 403) {
          failures.current += 1;
          retry.current = setTimeout(() => run(), 1500 * failures.current);
        }
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [loader]);
  useEffect(
    () => () => {
      if (retry.current !== null) clearTimeout(retry.current);
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    run();
  }, [run]);

  const key = collections.join(',');
  useEffect(() => {
    // Debounced, and never more often than once per minGap: the app shares its
    // request budget with the agents working on the same app.
    const schedule = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      const wait = Math.max(delay, lastRun.current + minGap - Date.now());
      timer.current = setTimeout(run, wait);
    };
    const offs = key
      .split(',')
      .filter((x) => x !== '')
      .map((c) => listen(c as LiveCollection, schedule));
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      for (const off of offs) off();
    };
  }, [key, run, delay, minGap]);

  return { data, loading, error, reload: run };
}

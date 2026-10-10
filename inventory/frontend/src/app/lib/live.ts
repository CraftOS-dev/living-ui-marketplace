/**
 * Live views over operations: load once, then reload (debounced) whenever a
 * watched collection changes. The AI agent receiving stock through the CLI
 * shows up on screen without a refresh.
 *
 * One realtime hub: every app collection is subscribed ONCE, in a single
 * tick at startup, and views register listeners with the hub. Subscribing
 * per view does not work: the SDK drops subscriptions made while its first
 * connection is still being set up, so views that mount a moment later would
 * never hear about changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';

export const LIVE_COLLECTIONS = [
  'settings',
  'categories',
  'locations',
  'suppliers',
  'items',
  'codes',
  'stock',
  'movements',
  'orders',
  'order_lines',
  'counts',
  'count_lines',
  'documents',
  'imports',
] as const;
export type LiveCollection = (typeof LIVE_COLLECTIONS)[number];

const listeners = new Map<string, Set<() => void>>();
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
          pb.collection(c).subscribe('*', () => {
            for (const fn of listeners.get(c) ?? []) fn();
          }),
        { silent: true },
      )
      .catch(() => undefined);
  }
}

/* ----------------------------------------------------------- new versions */

/** The app script a document loads (built pages name it by content hash). */
function scriptOf(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

let reloading = false;

/**
 * An open page keeps the code it loaded, so a redeploy would not reach it
 * until someone reloads. Compare this page's script with the one the server
 * serves now and reload when they differ, waiting while a full screen or a
 * dialog is open so nothing being typed is lost.
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

function listen(collection: string, fn: () => void): () => void {
  let set = listeners.get(collection);
  if (set === undefined) {
    set = new Set();
    listeners.set(collection, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export interface Live<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useLive<T>(load: () => Promise<T>, collections: LiveCollection[], deps: unknown[]): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps);

  const run = useCallback(() => {
    const mine = ++seq.current;
    loader()
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        const e = err as { message?: string };
        setError(e.message ?? 'Could not load');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [loader]);

  useEffect(() => {
    setLoading(true);
    run();
  }, [run]);

  const key = collections.join(',');
  useEffect(() => {
    const schedule = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(run, 150);
    };
    const offs = key
      .split(',')
      .filter((x) => x !== '')
      .map((c) => listen(c, schedule));
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      for (const off of offs) off();
    };
  }, [key, run]);

  return { data, loading, error, reload: run };
}

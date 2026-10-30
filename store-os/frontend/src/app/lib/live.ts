/**
 * Live views over operations: load once, then reload whenever something a
 * view reads changes, whoever changed it (you in another window, your AI agent
 * through the CLI, the background jobs). Nothing needs
 * a refresh.
 *
 * The server never streams records. After each operation it sends one
 * message on the realtime topic "store" naming the collections that changed
 * (pb_hooks/lib_bus.js); views reload what they show. The platform's request
 * queue (agent_requests) is followed directly.
 *
 * The topic is subscribed once, in a single tick at startup (the SDK drops
 * subscriptions made while its first connection is being set up). This
 * tab's own writes reload at once; echoes from elsewhere are debounced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { errMessage } from './api.ts';

export type Collection =
  | 'settings'
  | 'shops'
  | 'products'
  | 'variants'
  | 'stock_moves'
  | 'listings'
  | 'customers'
  | 'orders'
  | 'order_lines'
  | 'shipments'
  | 'threads'
  | 'messages'
  | 'proposals'
  | 'chats'
  | 'imports'
  | 'activity'
  | 'tasks'
  | 'agent_requests';

export const ALL: Collection[] = ['settings', 'shops', 'products', 'variants', 'stock_moves', 'listings', 'customers', 'orders', 'order_lines', 'shipments', 'threads', 'messages', 'proposals', 'chats', 'imports', 'activity', 'tasks', 'agent_requests'];

type Listener = (now: boolean) => void;
const listeners = new Map<string, Set<Listener>>();
let started = false;
let pending = new Set<string>();
let hidden = new Set<string>();

function emit(names: string[], now: boolean): void {
  if (document.visibilityState === 'hidden') {
    for (const n of names) hidden.add(n);
    return;
  }
  const fired = new Set<Listener>();
  for (const n of names) {
    for (const fn of listeners.get(n) ?? []) {
      if (fired.has(fn)) continue;
      fired.add(fn);
      fn(now);
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
function flushSoon(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const names = [...pending];
    pending = new Set();
    emit(names, false);
  }, 100);
}

export function startLive(): void {
  if (started) return;
  started = true;
  const client = getPbClient();
  let connects = 0;
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe('PB_CONNECT', () => {
          connects += 1;
          if (connects > 1) {
            emit([...listeners.keys()], false);
            void checkForNewVersion();
          }
        }),
      { silent: true },
    )
    .catch(() => undefined);
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe('store', (msg: { c?: string[] | undefined }) => {
          for (const n of Array.isArray(msg?.c) ? msg.c : []) pending.add(n);
          flushSoon();
        }),
      { silent: true },
    )
    .catch(() => undefined);
  void client
    .call(
      (pb) =>
        pb.collection('agent_requests').subscribe('*', () => {
          pending.add('agent_requests');
          flushSoon();
        }),
      { silent: true },
    )
    .catch(() => undefined);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const names = [...hidden];
    hidden = new Set();
    if (names.length > 0) emit(names, false);
    void checkForNewVersion();
  });
}

/** This tab changed something: reload the views that read it now. */
export function changed(...names: Collection[]): void {
  emit(names, true);
}

/* --------------------------------------------------------------- versions */

function scriptOf(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

let reloading = false;

/** An open page keeps the code it loaded: reload when the server serves a newer build, once nothing is being typed. */
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
  const whenIdle = (): void => {
    const busy = document.querySelector('[role="dialog"]') !== null || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
    if (busy) {
      setTimeout(whenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  whenIdle();
}

export function listen(names: Collection[], fn: Listener): () => void {
  for (const n of names) {
    let set = listeners.get(n);
    if (set === undefined) {
      set = new Set();
      listeners.set(n, set);
    }
    set.add(fn);
  }
  return () => {
    for (const n of names) listeners.get(n)?.delete(fn);
  };
}

export interface Live<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  set: (d: T) => void;
}

/** Each view's last data, so a return visit paints at once. */
const memory = new Map<string, unknown>();

/** Load with `load`; reload when any of `reads` changes. `key` names the view for its memory. */
export function useLive<T>(key: string, load: (signal: AbortSignal) => Promise<T>, reads: Collection[], deps: unknown[] = []): Live<T> {
  const [data, setData] = useState<T | null>(() => (memory.get(key) as T | undefined) ?? null);
  const [loading, setLoading] = useState(!memory.has(key));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps);

  const run = useCallback(() => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    loader(c.signal)
      .then((d) => {
        if (mine !== seq.current) return;
        memory.set(key, d);
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        if ((err as { code?: string }).code === 'aborted') return;
        setError(errMessage(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [loader, key]);

  useEffect(() => {
    run();
    return () => ctrl.current?.abort();
  }, [run]);

  const readKey = reads.join(',');
  useEffect(() => {
    const on = (now: boolean): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (now) run();
      else timer.current = setTimeout(run, 120);
    };
    const off = listen(readKey.split(',').filter((x) => x !== '') as Collection[], on);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      off();
    };
  }, [readKey, run]);

  const set = useCallback(
    (d: T) => {
      memory.set(key, d);
      setData(d);
    },
    [key],
  );

  return { data, loading, error, reload: run, set };
}

/**
 * Live data.
 *
 * Records: every app collection is subscribed ONCE at startup (the SDK
 * drops subscriptions made while its first connection is being set up), and
 * views register listeners with the hub. What the AI agent changes through
 * the CLI (a chart, a drawing, an alert) shows up without a refresh.
 *
 * Market: one polling loop for the whole window. Widgets declare the
 * symbols they show and the chart series they draw; every tick one
 * market.live call returns their quotes and newest bars (the server's cache
 * makes repeated asks cheap). Faster while Binance pairs are on screen,
 * paused while the window is hidden.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { api } from './api.ts';
import type { Health, Quote, Row } from './types.ts';

export const LIVE_COLLECTIONS = ['settings', 'workspaces', 'widgets', 'watchlists', 'watch_items', 'drawings', 'alerts', 'alert_events', 'analyses', 'screens', 'activity'] as const;
export type LiveCollection = (typeof LIVE_COLLECTIONS)[number];

export interface RecordEvent {
  action: 'create' | 'update' | 'delete';
  record: Record<string, unknown>;
}

const listeners = new Map<string, Set<(e: RecordEvent) => void>>();
let started = false;

export function startLive(): void {
  if (started) return;
  started = true;
  let connects = 0;
  void getPbClient()
    .call(
      (pb) =>
        pb.realtime.subscribe('PB_CONNECT', () => {
          connects += 1;
          if (connects > 1) {
            void checkForNewVersion();
            // Missed events while disconnected: reload every view.
            for (const set of listeners.values()) for (const fn of set) fn({ action: 'update', record: {} });
          }
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
            const ev: RecordEvent = { action: e.action as RecordEvent['action'], record: e.record as Record<string, unknown> };
            for (const fn of listeners.get(c) ?? []) fn(ev);
          }),
        { silent: true },
      )
      .catch(() => undefined);
  }
}

function scriptOf(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

let reloading = false;

/** Reload onto a redeployed version when idle (no dialog open, nothing being typed). */
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
    const typing = document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, [contenteditable="true"]');
    if (document.querySelector('[role="dialog"]') !== null || typing) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  reloadWhenIdle();
}

export function onRecord(collection: LiveCollection, fn: (e: RecordEvent) => void): () => void {
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
  set: (d: T) => void;
}

/** Load once, then again (debounced) whenever a watched collection changes. */
export function useLive<T>(load: () => Promise<T>, collections: LiveCollection[], deps: unknown[], filter?: (e: RecordEvent) => boolean): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
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
        const e = err as { message?: string; response?: { message?: string } };
        setError(e.response?.message ?? e.message ?? 'Could not load');
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
    const schedule = (e: RecordEvent): void => {
      if (filterRef.current !== undefined && Object.keys(e.record).length > 0 && !filterRef.current(e)) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(run, 120);
    };
    const offs = key
      .split(',')
      .filter((x) => x !== '')
      .map((c) => onRecord(c as LiveCollection, schedule));
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      for (const off of offs) off();
    };
  }, [key, run]);

  return { data, loading, error, reload: run, set: setData };
}

/* ------------------------------------------------------------- market hub */

type TailFn = (bars: Row[], stale: boolean, error: string) => void;

const symbolRefs = new Map<string, number>();
const tailSubs = new Map<string, Set<TailFn>>();
const quoteStore = new Map<string, Quote>();
const quoteSubs = new Map<string, Set<() => void>>();
const healthSubs = new Set<() => void>();
let health: Record<string, Health> = {};
let lastTick = 0;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let failures = 0;
let hubStarted = false;

function emitQuote(sym: string): void {
  for (const fn of quoteSubs.get(sym) ?? []) fn();
}

/** Seed quotes from another call (watchlist, screener) so rows fill at once. */
export function primeQuotes(quotes: Record<string, Quote>): void {
  for (const [k, q] of Object.entries(quotes)) {
    quoteStore.set(k, q);
    emitQuote(k);
  }
}

function period(): number {
  let crypto = false;
  for (const s of symbolRefs.keys()) if (s.startsWith('BINANCE:')) crypto = true;
  for (const k of tailSubs.keys()) if (k.startsWith('BINANCE:')) crypto = true;
  const base = crypto ? 2500 : 5000;
  return failures > 0 ? Math.min(30000, base * 2 ** Math.min(failures, 3)) : base;
}

async function tick(): Promise<void> {
  tickTimer = null;
  if (document.visibilityState !== 'visible') {
    schedule(2000);
    return;
  }
  const symbols = [...symbolRefs.keys()];
  const series = [...tailSubs.keys()];
  if (symbols.length === 0 && series.length === 0) {
    schedule(1500);
    return;
  }
  if (inFlight) {
    schedule(500);
    return;
  }
  inFlight = true;
  lastTick = Date.now();
  try {
    const r = await api.live(symbols, series);
    failures = 0;
    for (const [k, q] of Object.entries(r.quotes)) {
      const prev = quoteStore.get(k);
      if (prev !== undefined && prev.price === q.price && prev.change_pct === q.change_pct && prev.state === q.state && prev.ext_price === q.ext_price && prev.stale === q.stale) continue;
      quoteStore.set(k, q);
      emitQuote(k);
    }
    for (const [k, t] of Object.entries(r.tails)) for (const fn of tailSubs.get(k) ?? []) fn(t.bars, t.stale, t.error);
    health = r.health;
    for (const fn of healthSubs) fn();
  } catch {
    failures += 1;
  } finally {
    inFlight = false;
    schedule(period());
  }
}

function schedule(ms: number): void {
  if (tickTimer !== null) clearTimeout(tickTimer);
  tickTimer = setTimeout(() => void tick(), ms);
}

function startHub(): void {
  if (hubStarted) return;
  hubStarted = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastTick > 3000) schedule(50);
  });
  schedule(300);
}

/** Refresh soon (a symbol was just added). */
function nudge(): void {
  startHub();
  if (Date.now() - lastTick > 800) schedule(150);
}

function addSymbols(syms: string[]): () => void {
  for (const s of syms) symbolRefs.set(s, (symbolRefs.get(s) ?? 0) + 1);
  if (syms.some((s) => !quoteStore.has(s))) nudge();
  else startHub();
  return () => {
    for (const s of syms) {
      const n = (symbolRefs.get(s) ?? 1) - 1;
      if (n <= 0) symbolRefs.delete(s);
      else symbolRefs.set(s, n);
    }
  };
}

/** Live quotes for symbols (keys of the map). */
export function useQuotes(symbols: string[]): Record<string, Quote | undefined> {
  const key = symbols.join('\n');
  useEffect(() => (key === '' ? undefined : addSymbols(key.split('\n'))), [key]);
  const subscribe = useCallback(
    (fn: () => void) => {
      const syms = key === '' ? [] : key.split('\n');
      for (const s of syms) {
        let set = quoteSubs.get(s);
        if (set === undefined) {
          set = new Set();
          quoteSubs.set(s, set);
        }
        set.add(fn);
      }
      return () => {
        for (const s of syms) quoteSubs.get(s)?.delete(fn);
      };
    },
    [key],
  );
  const snapRef = useRef<{ sig: string; value: Record<string, Quote | undefined> }>({ sig: '', value: {} });
  const getSnapshot = useCallback(() => {
    const syms = key === '' ? [] : key.split('\n');
    let sig = '';
    for (const s of syms) {
      const q = quoteStore.get(s);
      sig += s + ':' + (q === undefined ? '' : `${q.price}|${q.change_pct}|${q.state}|${q.ext_price}|${q.stale === true}|${q.spark.length}`) + ';';
    }
    if (sig !== snapRef.current.sig) {
      const value: Record<string, Quote | undefined> = {};
      for (const s of syms) value[s] = quoteStore.get(s);
      snapRef.current = { sig, value };
    }
    return snapRef.current.value;
  }, [key]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useQuote(symbol: string): Quote | undefined {
  return useQuotes(symbol === '' ? [] : [symbol])[symbol];
}

/** Newest bars of a chart series ("SYM|interval" or "SYM|interval|x"), every tick. */
export function useTail(key: string | null, fn: TailFn): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (key === null) return;
    const wrapped: TailFn = (b, s, e) => ref.current(b, s, e);
    let set = tailSubs.get(key);
    if (set === undefined) {
      set = new Set();
      tailSubs.set(key, set);
    }
    set.add(wrapped);
    startHub();
    return () => {
      const s = tailSubs.get(key);
      s?.delete(wrapped);
      if (s !== undefined && s.size === 0) tailSubs.delete(key);
    };
  }, [key]);
}

export function useHealth(): Record<string, Health> {
  return useSyncExternalStore(
    (fn) => {
      healthSubs.add(fn);
      return () => healthSubs.delete(fn);
    },
    () => health,
  );
}

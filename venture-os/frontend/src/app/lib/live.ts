/**
 * Live views over operations: load once, then reload whenever something a
 * view reads changes, whoever changed it (you in another window, a partner
 * on a phone, your AI agent through the CLI, a cron job). Nothing needs a
 * refresh.
 *
 * The server never streams records (collections are closed to the raw API).
 * After each operation the kernel's bus sends ONE message on the realtime
 * topic "vo" naming the collections that changed: {"c": ["deals", "notes"]}.
 * Views reload what they show through operations. The topic is subscribed
 * once, in a single tick at startup (the SDK drops subscriptions made while
 * its first connection is being set up). This tab's own writes reload at
 * once; echoes from elsewhere are debounced.
 *
 *   const live = useOp<DealList>('deals.list', { stage }, ['deals', 'stage_events']);
 *   await act([patch(id, { status: 'passed' })], () => op('intake.pass', { item: id }), ['intake_items']);
 *
 * act() lays the edits over every live view at once and runs the operation
 * behind; when it fails the edits are withdrawn and the toast says why.
 * A view that reads everything (the Next queue) lists '*'.
 *
 * Views remember their last data per name and params, so going back to a
 * page is instant while it refreshes behind.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { errMessage, op } from './api.ts';
import type { CallOptions, OpName, Params } from './api.ts';

/** The realtime topic the kernel's bus publishes on. */
export const TOPIC = 'vo';

/** A collection name, or '*' for "anything changed". */
export type Collection = string;

type Listener = (now: boolean) => void;
const listeners = new Map<string, Set<Listener>>();
let started = false;
let pending = new Set<string>();
let hidden = new Set<string>();

function emit(names: string[], now: boolean): void {
  if (names.length === 0) return;
  if (document.visibilityState === 'hidden' && !now) {
    for (const n of names) hidden.add(n);
    return;
  }
  const fired = new Set<Listener>();
  const all = names.includes('*') ? [...listeners.keys()] : [...names, '*'];
  for (const n of all) {
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

/** Subscribe the realtime topic (once, at startup, before any view mounts). */
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
            // Back after a drop: whatever changed meanwhile is unknown, so reload all.
            emit(['*'], false);
            void checkForNewVersion();
          }
        }),
      { silent: true },
    )
    .catch(() => undefined);
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe(TOPIC, (msg: { c?: string[] | undefined }) => {
          for (const n of Array.isArray(msg?.c) ? msg.c : []) pending.add(n);
          flushSoon();
        }),
      { silent: true },
    )
    .catch(() => undefined);
  // Your AI agent's requests (the platform's queue) change outside the app's operations: follow them directly.
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
  emit(names.length === 0 ? ['*'] : names, true);
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

/** Run `fn` whenever one of `names` changes (no data of its own). */
export function useOnChange(names: Collection[], fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  const key = names.join(',');
  useEffect(() => listen(key.split(',').filter((x) => x !== ''), () => ref.current()), [key]);
}

/* ----------------------------------------------------------- new versions */

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
    const el = document.activeElement;
    const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (document.querySelector('[role="dialog"]') !== null || typing || document.querySelector('[data-unsaved="true"]') !== null) {
      setTimeout(whenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  whenIdle();
}

/* ---------------------------------------------------------- instant edits */

type Json = unknown;
type Obj = Record<string, unknown>;

/** One change laid over views until the server's own data arrives. */
export type Edit =
  | { kind: 'patch'; id: string; fields: Obj }
  | { kind: 'drop'; id: string }
  | { kind: 'insert'; list: string; item: Obj; at?: 'start' | 'end' | undefined }
  | { kind: 'reshape'; view: string; fn: (data: Json) => Json };

/** Merge `fields` into every object with this id (or key), in every view. */
export const patch = (id: string, fields: Obj): Edit => ({ kind: 'patch', id, fields });
/** Remove every object with this id (or key) from every list. */
export const drop = (id: string): Edit => ({ kind: 'drop', id });
/** Insert `item` into every list held under the key `list`. */
export const insert = (list: string, item: Obj, at: 'start' | 'end' = 'start'): Edit => ({ kind: 'insert', list, item, at });
/** Transform one named view's data. */
export const reshape = (view: string, fn: (data: Json) => Json): Edit => ({ kind: 'reshape', view, fn });

interface Layer {
  edits: Edit[];
  answeredAt: number | null;
}

let layers: Layer[] = [];
let version = 0;
const layerListeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const fn of layerListeners) fn();
}

function subscribeLayers(fn: () => void): () => void {
  layerListeners.add(fn);
  return () => {
    layerListeners.delete(fn);
  };
}

let tempSeq = 0;
/** An id for a draft shown before the server answers. */
export function tempId(): string {
  tempSeq++;
  return 'tmp_' + Date.now().toString(36) + '_' + tempSeq;
}

/**
 * Show `edits` at once, run the operation, then reload what it changed.
 * Returns the operation's answer, or null when it failed (the edits are
 * withdrawn; the operation's own toast says why).
 */
export async function act<T>(edits: Edit[], run: () => Promise<T>, reads: Collection[] = []): Promise<T | null> {
  const layer: Layer = { edits, answeredAt: null };
  if (edits.length > 0) {
    layers = [...layers, layer];
    bump();
  }
  try {
    const out = await run();
    layer.answeredAt = performance.now();
    changed(...(reads.length > 0 ? reads : ['*']));
    setTimeout(() => {
      layers = layers.filter((l) => l !== layer);
      bump();
    }, 8000);
    bump();
    return out;
  } catch {
    layers = layers.filter((l) => l !== layer);
    bump();
    return null;
  }
}

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function idOf(x: unknown): unknown {
  return isObj(x) ? (x['id'] ?? x['key']) : undefined;
}

function applyEdit(v: Json, e: Edit, key: string): Json {
  if (Array.isArray(v)) {
    let arr: Json[] = v;
    let any = false;
    if (e.kind === 'drop') {
      const kept = arr.filter((x) => idOf(x) !== e.id);
      if (kept.length !== arr.length) {
        arr = kept;
        any = true;
      }
    }
    if (e.kind === 'insert' && key === e.list && !arr.some((x) => idOf(x) === idOf(e.item))) {
      arr = e.at === 'end' ? [...arr, e.item] : [e.item, ...arr];
      any = true;
    }
    const mapped = arr.map((x) => applyEdit(x, e, key));
    if (mapped.some((x, i) => x !== arr[i])) {
      arr = mapped;
      any = true;
    }
    return any ? arr : v;
  }
  if (isObj(v)) {
    let out: Obj = v;
    if (e.kind === 'patch' && idOf(v) === e.id) out = { ...v, ...e.fields };
    for (const k of Object.keys(out)) {
      const child = out[k];
      if (child === null || typeof child !== 'object') continue;
      const next = applyEdit(child, e, k);
      if (next !== child) {
        if (out === v) out = { ...v };
        out[k] = next;
      }
    }
    return out;
  }
  return v;
}

function overlay<T>(data: T, fetchedAt: number, view: string): T {
  let out: Json = data;
  for (const l of layers) {
    if (l.answeredAt !== null && fetchedAt > l.answeredAt) continue;
    for (const e of l.edits) {
      if (e.kind === 'reshape') {
        if (e.view === view) out = e.fn(out);
        continue;
      }
      out = applyEdit(out, e, '');
    }
  }
  return out as T;
}

/* ------------------------------------------------------------------ views */

const memory = new Map<string, { data: unknown; at: number }>();

/** Forget every remembered view (sign out: the next person must not see the last one's data). */
export function forgetAll(): void {
  memory.clear();
  layers = [];
  bump();
}

export interface Live<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** The last error's machine code ('' when none). */
  code: string;
  reload: () => void;
}

export interface LiveOptions {
  /** Remembers the data across visits (instant return) and names the view for reshape(). */
  name?: string | undefined;
  delay?: number | undefined;
  /** Skip loading (the params are not ready yet). */
  skip?: boolean | undefined;
  /** Keep showing the previous answer while new params load (filters, searches, paging). */
  keep?: boolean | undefined;
}

/** Load with `load`; reload when any of `reads` changes; show instant edits on top. */
export function useLive<T>(load: (signal: AbortSignal) => Promise<T>, reads: Collection[], deps: unknown[], opts: LiveOptions = {}): Live<T> {
  const memKey = opts.name !== undefined ? opts.name + ':' + JSON.stringify(deps) : '';
  const remembered = memKey !== '' ? memory.get(memKey) : undefined;
  const [state, setState] = useState<{ data: T | null; at: number }>(() => (remembered !== undefined ? { data: remembered.data as T, at: remembered.at } : { data: null, at: 0 }));
  const [loading, setLoading] = useState(remembered === undefined && opts.skip !== true);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps);
  const skip = opts.skip === true;
  useSyncExternalStore(subscribeLayers, () => version);

  const run = useCallback(() => {
    if (skip) return;
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const startedAt = performance.now();
    loader(c.signal)
      .then((d) => {
        if (mine !== seq.current) return;
        setState({ data: d, at: startedAt });
        if (memKey !== '') memory.set(memKey, { data: d, at: startedAt });
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        const e = err as { code?: string };
        if (e.code === 'aborted') return;
        setError({ message: errMessage(err), code: e.code ?? '' });
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [loader, memKey, skip]);

  const keep = opts.keep === true;
  const first = useRef(true);
  useEffect(() => {
    const rem = memKey !== '' ? memory.get(memKey) : undefined;
    if (rem !== undefined) setState({ data: rem.data as T, at: rem.at });
    else {
      if (!first.current && !keep) setState({ data: null, at: 0 });
      if (!skip) setLoading(true);
    }
    first.current = false;
    run();
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, memKey, skip]);

  const key = reads.join(',');
  const delay = opts.delay ?? 150;
  useEffect(() => {
    const schedule = (now: boolean): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (now) {
        timerRef.current = null;
        run();
        return;
      }
      timerRef.current = setTimeout(run, delay);
    };
    const off = listen(key.split(',').filter((x) => x !== ''), schedule);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      off();
    };
  }, [key, run, delay]);

  const data = state.data === null ? null : layers.length === 0 ? state.data : overlay(state.data, state.at, opts.name ?? '');
  return { data, loading: loading && state.data === null, error: error?.message ?? null, code: error?.code ?? '', reload: run };
}

/**
 * One read operation as a live view: `useOp('deals.list', { q }, ['deals'])`.
 * The params object is compared by value, so an inline object is fine.
 */
export function useOp<T>(name: OpName, params: Params, reads: Collection[], opts: LiveOptions & { call?: CallOptions | undefined } = {}): Live<T> {
  const key = JSON.stringify(params);
  return useLive<T>((signal) => op<T>(name, JSON.parse(key) as Params, { quiet: true, ...opts.call, signal }), reads, [name, key], { ...opts, name: opts.name ?? name });
}

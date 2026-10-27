/**
 * Live views over operations: load once, then reload whenever something a
 * view reads changes, whoever changed it (you in another window, your AI
 * agent through the CLI, a background job). Nothing needs a refresh.
 *
 * The server never streams records. After each operation it sends one
 * message on the realtime topic "lo" naming the collections that changed
 * (pb_hooks/lib_bus.js); views reload what they show through operations.
 * The platform's request queue (agent_requests) is followed directly.
 *
 * One hub: the topic is subscribed ONCE, in a single tick at startup, and
 * views register listeners with the hub (the SDK drops subscriptions made
 * while its first connection is being set up). Reloads are debounced and
 * paused while the tab is hidden; a hidden tab catches up when shown.
 *
 * What you do here shows at once: act() lays edits over every live view
 * (patch a record, drop it, insert one), runs the operation behind them, and
 * reloads right after. See "Changes shown before the server answers" below.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { errMessage } from './api.ts';

export type Collection =
  | 'settings' | 'areas' | 'money_pots' | 'goals' | 'goal_checkins' | 'people' | 'interactions' | 'events' | 'projects' | 'tasks' | 'focus_sessions'
  | 'wins' | 'habits' | 'habit_logs' | 'days' | 'health_logs' | 'workouts' | 'money_entries' | 'bills' | 'books' | 'learning' | 'bucket_items'
  | 'trips' | 'chores' | 'shopping_items' | 'journal_entries' | 'recaps' | 'routines' | 'routine_runs' | 'suggestions' | 'proposals' | 'asks' | 'activity'
  | 'calendar_events' | 'agent_requests';

/** Common groups, so a view names what it reads in one word. */
export const READS = {
  /** Everything a life overview shows (Home, the life map, an area). */
  life: [
    'settings', 'areas', 'money_pots', 'goals', 'goal_checkins', 'people', 'interactions', 'events', 'projects', 'tasks', 'focus_sessions', 'wins', 'habits', 'habit_logs',
    'days', 'health_logs', 'workouts', 'money_entries', 'bills', 'books', 'learning', 'bucket_items', 'trips', 'chores', 'shopping_items', 'journal_entries', 'calendar_events',
  ] as Collection[],
  board: ['settings', 'tasks', 'goals', 'projects', 'people', 'events', 'calendar_events', 'areas'] as Collection[],
  habits: ['settings', 'habits', 'habit_logs', 'goals', 'areas'] as Collection[],
  agent: ['proposals', 'suggestions', 'asks', 'agent_requests', 'activity', 'routines', 'routine_runs'] as Collection[],
  frame: ['settings', 'areas', 'goals', 'projects', 'people', 'proposals', 'suggestions', 'asks', 'tasks', 'habits', 'habit_logs', 'days'] as Collection[],
};

/** Everything that can change after a person's action (for proposals and undo). */
export const ALL: Collection[] = [...READS.life, 'recaps', 'routines', 'suggestions', 'proposals', 'asks', 'activity'];

const listeners = new Map<string, Set<(now: boolean) => void>>();
let started = false;
let pending = new Set<string>();
let hiddenChanges = new Set<string>();

function emit(names: string[], now = false): void {
  if (document.visibilityState === 'hidden') {
    for (const n of names) hiddenChanges.add(n);
    return;
  }
  const seen = new Set<(now: boolean) => void>();
  for (const n of names)
    for (const fn of listeners.get(n) ?? []) {
      if (seen.has(fn)) continue;
      seen.add(fn);
      fn(now);
    }
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
            emit([...listeners.keys()]);
            void checkForNewVersion();
          }
        }),
      { silent: true },
    )
    .catch(() => undefined);
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe('lo', (msg: { c?: string[] | undefined }) => {
          const names = Array.isArray(msg?.c) ? msg.c : [];
          for (const n of names) pending.add(n);
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
    const names = [...hiddenChanges];
    hiddenChanges = new Set();
    if (names.length > 0) emit(names);
    void checkForNewVersion();
  });
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flushSoon(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const names = [...pending];
    pending = new Set();
    emit(names);
  }, 120);
}

/** Tell views on this screen that something changed (after this tab's own operation): they reload at once. */
let mine = new Set<string>();
let mineTimer: ReturnType<typeof setTimeout> | null = null;
export function changed(...names: Collection[]): void {
  for (const n of names) mine.add(n);
  if (mineTimer !== null) return;
  mineTimer = setTimeout(() => {
    mineTimer = null;
    const list = [...mine];
    mine = new Set();
    emit(list, true);
  }, 0);
}

/* ------------------------------------------------ changes shown before the server answers */

/**
 * An action lays its edits over every live view at once and the operation
 * runs behind them. A view applies an edit to any data it fetched before the
 * operation was done, so a reload that started too early never flickers back;
 * data fetched after it already holds the change. If the operation fails, the
 * edits go and every view shows the truth again (the operation shows why).
 */
type Tree = unknown;
export type Change = (root: Tree) => Tree;
interface Edit {
  change: Change;
  done: number | null;
}
let clock = 0;
const edits = new Set<Edit>();
const painters = new Set<() => void>();
function repaint(): void {
  for (const fn of painters) fn();
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Rebuild a tree bottom-up through `fn`, copying only the branches that change. */
function walk(x: Tree, fn: (node: Tree, key: string, owner: Record<string, unknown> | null) => Tree, key: string, owner: Record<string, unknown> | null): Tree {
  let node: Tree = x;
  if (Array.isArray(x)) {
    let diff = false;
    const out = x.map((v) => {
      const n = walk(v, fn, '', null);
      if (n !== v) diff = true;
      return n;
    });
    if (diff) node = out;
  } else if (isObj(x)) {
    let out: Record<string, unknown> | null = null;
    for (const k of Object.keys(x)) {
      const v = x[k];
      const n = walk(v, fn, k, x);
      if (n !== v) {
        out = out ?? { ...x };
        out[k] = n;
      }
    }
    if (out !== null) node = out;
  }
  return fn(node, key, owner);
}

/** Every record with this id, changed (fields, or a function of the record). */
export function patch<R extends { id: string }>(id: string, fields: Partial<R> | ((r: R) => Partial<R>)): Change {
  return (root) => walk(root, (n) => (isObj(n) && n.id === id ? { ...n, ...(typeof fields === 'function' ? fields(n as unknown as R) : fields) } : n), '', null);
}

/** Every object `match` picks (records without an id, like a day's body log), changed. */
export function patchWhere(match: (o: Record<string, unknown>) => boolean, fields: (o: Record<string, unknown>) => Record<string, unknown>): Change {
  return (root) => walk(root, (n) => (isObj(n) && match(n) ? { ...n, ...fields(n) } : n), '', null);
}

/** The person's day as the browser sees it (the server's answer settles the edge of a day). */
export function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every record with this id, gone from its lists. */
export function drop(id: string): Change {
  return (root) => walk(root, (n) => (Array.isArray(n) && n.some((x) => isObj(x) && x.id === id) ? n.filter((x) => !(isObj(x) && x.id === id)) : n), '', null);
}

/** A new record put into every list `where` says it belongs (key is the list's field name, owner the object holding it). */
export function insert<R extends { id: string }>(where: (key: string, owner: Record<string, unknown>, list: unknown[]) => boolean, item: R, at: 'start' | 'end' = 'end'): Change {
  return (root) =>
    walk(
      root,
      (n) => {
        if (!isObj(n)) return n;
        let out: Record<string, unknown> | null = null;
        for (const k of Object.keys(n)) {
          const v = n[k];
          if (Array.isArray(v) && !v.some((x) => isObj(x) && x.id === item.id) && where(k, n, v)) {
            out = out ?? { ...n };
            out[k] = at === 'start' ? [item, ...v] : [...v, item];
          }
        }
        return out ?? n;
      },
      '',
      null,
    );
}

/** Lists holding these records put them in this order (records not named keep their place after them). */
export function reorder(ids: string[]): Change {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return (root) =>
    walk(
      root,
      (n) => {
        if (!Array.isArray(n) || n.length < 2 || !n.every((x) => isObj(x)) || n.filter((x) => pos.has(String((x as Record<string, unknown>).id))).length < Math.min(2, ids.length)) return n;
        return [...n].sort((a, b) => (pos.get(String((a as Record<string, unknown>).id)) ?? 1e9) - (pos.get(String((b as Record<string, unknown>).id)) ?? 1e9));
      },
      '',
      null,
    );
}

/** Any change of the whole data of a view (for shapes the helpers above do not cover). */
export function reshape(fn: (root: Tree) => Tree): Change {
  return fn;
}

function view<T>(d: T, at: number): T {
  let x: Tree = d;
  for (const e of edits) if (e.done === null || at < e.done) x = e.change(x);
  return x as T;
}

/** A temporary id for something made here before the server names it. */
export function tempId(): string {
  return 'tmp' + Math.random().toString(36).slice(2, 14);
}

const settledIds = new Set<string>();
/** Ids just written by this tab: they arrive quietly (their placeholder already came in). */
export function isQuiet(id: string): boolean {
  return settledIds.has(id);
}
function quietAll(x: unknown): void {
  if (Array.isArray(x)) x.forEach(quietAll);
  else if (isObj(x)) {
    if (typeof x.id === 'string') settledIds.add(x.id);
    Object.values(x).forEach(quietAll);
  }
}

/**
 * Do it now, tell the server behind: `changes` show at once on every live
 * view, then `run` calls the operation; views reload when it is done. On a
 * failure the changes go away again and the operation shows why. Resolves to
 * the answer, or undefined when it failed.
 */
let flying = 0;
let landed: (() => void)[] = [];
/** Resolves when every write this tab started has been answered (Undo waits for it). */
export function idle(): Promise<void> {
  return flying === 0 ? Promise.resolve() : new Promise((r) => landed.push(r));
}
function land(): void {
  flying -= 1;
  if (flying > 0) return;
  const fns = landed;
  landed = [];
  fns.forEach((f) => f());
}

export async function act<T>(changes: Change[], run: () => Promise<T>, reads: Collection[]): Promise<T | undefined> {
  const e: Edit = { change: (root) => changes.reduce((x, c) => c(x), root), done: null };
  flying += 1;
  if (changes.length > 0) {
    edits.add(e);
    repaint();
  }
  try {
    const r = await run();
    quietAll(r);
    e.done = ++clock;
    changed(...reads);
    setTimeout(() => edits.delete(e), 30000);
    return r;
  } catch {
    edits.delete(e);
    repaint();
    changed(...reads);
    return undefined;
  } finally {
    land();
  }
}

/* ----------------------------------------------------------- new versions */

function scriptOf(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

let reloading = false;

/**
 * An open page keeps the code it loaded. Compare this page's script with the
 * one the server serves now and reload when they differ, waiting while a
 * dialog is open or something is being typed so nothing is lost.
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
    const busy = document.querySelector('[role="dialog"]') !== null || (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) || document.querySelector('[data-unsaved="true"]') !== null;
    if (busy) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  reloadWhenIdle();
}

/** Listen to collections changing (now: this tab's own action, reload at once). Returns the unsubscribe. */
export function listen(names: Collection[], fn: (now: boolean) => void): () => void {
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

/**
 * What each view last loaded, by what it loads (the loader's own text and its
 * inputs): a page you come back to shows at once and refreshes behind.
 */
const memory = new Map<string, { d: unknown; at: number }>();
function remember(key: string, v: { d: unknown; at: number }): void {
  memory.delete(key);
  memory.set(key, v);
  if (memory.size > 80) memory.delete(memory.keys().next().value as string);
}

/** Load with `load`, reload when any of `reads` changes (debounced). */
export function useLive<T>(load: (signal: AbortSignal) => Promise<T>, reads: Collection[], deps: unknown[], delay = 150): Live<T> {
  const memKey = String(load) + '|' + JSON.stringify(deps);
  const [server, setServer] = useState<{ d: T; at: number } | null>(() => (memory.get(memKey) as { d: T; at: number } | undefined) ?? null);
  const shown = useRef(memKey);
  if (shown.current !== memKey) {
    // Other inputs (another part of life, another week): what was last loaded for them, at once.
    shown.current = memKey;
    setServer((memory.get(memKey) as { d: T; at: number } | undefined) ?? null);
  }
  const [paint, setPaint] = useState(0);
  useEffect(() => {
    const fn = (): void => setPaint((n) => n + 1);
    painters.add(fn);
    return () => {
      painters.delete(fn);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => (server === null ? null : view(server.d, server.at)), [server, paint]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, deps);

  const run = useCallback(() => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const at = ++clock;
    const k = shown.current;
    loader(c.signal)
      .then((d) => {
        if (mine !== seq.current) return;
        setServer({ d, at });
        remember(k, { d, at });
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        const e = err as { code?: string | undefined };
        if (e.code === 'aborted') return;
        setError(errMessage(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [loader]);

  useEffect(() => {
    setLoading(true);
    run();
    return () => ctrl.current?.abort();
  }, [run]);

  const key = reads.join(',');
  useEffect(() => {
    const schedule = (now: boolean): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(run, now ? 0 : delay);
    };
    const off = listen(key.split(',').filter((x) => x !== '') as Collection[], schedule);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      off();
    };
  }, [key, run, delay]);

  const set = useCallback((d: T) => setServer({ d, at: ++clock }), []);
  return { data, loading, error, reload: run, set };
}

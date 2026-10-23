/**
 * Live views over operations: load once, then reload whenever something a
 * view reads changes, whoever changed it (you in another window, your AI
 * agent through the CLI, a background job). Nothing needs a refresh.
 *
 * The server never streams records. After each operation it sends one
 * message on the realtime topic "ro" naming the collections that changed
 * (pb_hooks/lib_bus.js); views reload what they show through operations.
 * The platform's request queue (agent_requests) is followed directly.
 *
 * One hub: the topic is subscribed ONCE, in a single tick at startup, and
 * views register listeners with the hub (the SDK drops subscriptions made
 * while its first connection is being set up). Reloads are debounced and
 * paused while the tab is hidden; a hidden tab catches up when shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { errMessage } from './api.ts';

export type Collection =
  | 'settings' | 'import_batches' | 'works' | 'collections' | 'collection_items' | 'tags' | 'work_tags' | 'files' | 'pages' | 'anchors'
  | 'annotations' | 'projects' | 'project_works' | 'notes' | 'nodes' | 'node_anchors' | 'relations' | 'boards' | 'board_items' | 'asks'
  | 'proposals' | 'field_marks' | 'activity' | 'saved_views' | 'searches' | 'search_runs' | 'candidates' | 'oa_cache' | 'work_refs'
  | 'manuscripts' | 'ms_blocks' | 'ms_changes' | 'ms_snapshots' | 'reviews_received'
  | 'response_items' | 'reviews' | 'import_logs' | 'review_records' | 'decisions' | 'tasks' | 'experiments' | 'exp_runs' | 'exp_log' | 'exp_templates' | 'repo_items' | 'repo_versions' | 'note_files' | 'ms_builds' | 'agent_requests';

/** Common groups, so a view names what it reads in one word. */
export const READS = {
  library: ['works', 'files', 'collection_items', 'work_tags', 'tags', 'collections', 'annotations', 'notes', 'nodes'] as Collection[],
  graph: ['nodes', 'relations', 'node_anchors', 'anchors'] as Collection[],
  agent: ['proposals', 'asks', 'agent_requests', 'nodes', 'relations', 'notes', 'works', 'files', 'ms_changes', 'response_items'] as Collection[],
  project: ['projects', 'project_works', 'nodes', 'relations', 'notes', 'boards', 'manuscripts', 'reviews', 'activity', 'works', 'annotations', 'tasks', 'experiments', 'repo_items'] as Collection[],
};

const listeners = new Map<string, Set<() => void>>();
let started = false;
let pending = new Set<string>();
let hiddenChanges = new Set<string>();

function emit(names: string[]): void {
  if (document.visibilityState === 'hidden') {
    for (const n of names) hiddenChanges.add(n);
    return;
  }
  for (const n of names) for (const fn of listeners.get(n) ?? []) fn();
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
        pb.realtime.subscribe('ro', (msg: { c?: string[] | undefined }) => {
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

/** Tell views on this screen that something changed (after this tab's own operation). */
export function changed(...names: Collection[]): void {
  for (const n of names) pending.add(n);
  flushSoon();
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

/** Listen to collections changing. Returns the unsubscribe. */
export function listen(names: Collection[], fn: () => void): () => void {
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

/** Load with `load`, reload when any of `reads` changes (debounced). */
export function useLive<T>(load: (signal: AbortSignal) => Promise<T>, reads: Collection[], deps: unknown[], delay = 150): Live<T> {
  const [data, setData] = useState<T | null>(null);
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
    loader(c.signal)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        const e = err as { code?: string };
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
    const schedule = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(run, delay);
    };
    const off = listen(key.split(',').filter((x) => x !== '') as Collection[], schedule);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      off();
    };
  }, [key, run, delay]);

  return { data, loading, error, reload: run, set: setData };
}

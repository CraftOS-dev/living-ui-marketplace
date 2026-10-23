/**
 * Live views over operations: load once, then reload whenever something a
 * view reads changes, whoever changed it (a teammate, your AI agent through
 * the CLI, a background job). Nothing needs a refresh.
 *
 * The server never streams records. After each operation it sends one
 * message on the realtime topic "erp" naming the collections that changed
 * (pb_hooks/lib_bus.js); views reload what they show through operations,
 * which check the caller's rights as always.
 *
 * One hub: the topic (and the agent request queue) is subscribed ONCE, in a
 * single tick at startup, and views register listeners with the hub.
 * Subscribing per view does not work: the SDK drops subscriptions made while
 * its first connection is still being set up.
 *
 * Reloads are debounced (a burst of changes is one reload) and paused while
 * the tab is hidden; a hidden tab catches up once when it is shown again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { errMessage } from './api.ts';

export type Collection =
  | 'settings' | 'counters' | 'roles' | 'members' | 'audit' | 'notes' | 'attachments' | 'field_marks' | 'departments' | 'accounts'
  | 'ledger_months' | 'payment_terms' | 'currencies' | 'taxes' | 'parties' | 'contacts' | 'employees' | 'projects' | 'project_tasks'
  | 'item_categories' | 'warehouses' | 'items' | 'valuation' | 'stock' | 'journals' | 'journal_lines' | 'documents' | 'document_lines'
  | 'stock_changes' | 'stock_moves' | 'banks' | 'payments' | 'allocations' | 'imports' | 'bank_lines' | 'inbox' | 'proposals' | 'asks'
  | 'leave_types' | 'holidays' | 'leave_requests' | 'leave_adjustments' | 'expense_claims' | 'claim_lines' | 'pay_components'
  | 'employee_components' | 'payroll_runs' | 'payslips' | 'timesheets' | 'boms' | 'bom_lines' | 'builds' | 'assets' | 'budgets'
  | 'agent_requests';

/** Common groups, so a view names what it reads in one word. */
export const READS = {
  books: ['journals', 'journal_lines', 'ledger_months', 'accounts'] as Collection[],
  docs: ['documents', 'document_lines', 'allocations', 'payments'] as Collection[],
  stock: ['items', 'stock', 'valuation', 'stock_moves', 'stock_changes', 'warehouses'] as Collection[],
  money: ['payments', 'allocations', 'banks', 'bank_lines', 'journals'] as Collection[],
  people: ['employees', 'departments', 'leave_requests', 'leave_adjustments', 'leave_types', 'holidays', 'expense_claims', 'claim_lines'] as Collection[],
  agent: ['proposals', 'inbox', 'asks', 'agent_requests'] as Collection[],
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
  // All subscriptions in the same tick (see the note at the top).
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe('PB_CONNECT', () => {
          connects += 1;
          // A reconnect may have missed messages, and often means a new
          // version of the app: reload what is on screen, check the version.
          if (connects > 1) {
            emitAll();
            void checkForNewVersion();
          }
        }),
      { silent: true },
    )
    .catch(() => undefined);
  void client
    .call(
      (pb) =>
        pb.realtime.subscribe('erp', (msg: { c?: string[] | undefined }) => {
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
        pb.realtime.subscribe('agent_requests/*', () => {
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

function emitAll(): void {
  emit([...listeners.keys()]);
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
 * An open page keeps the code it loaded, so a redeploy would not reach it
 * until someone reloads. Compare this page's script with the one the server
 * serves now and reload when they differ, waiting while a dialog or a full
 * screen is open so nothing being typed is lost.
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
    if (document.querySelector('[role="dialog"]') !== null || document.querySelector('[data-busy-screen]') !== null) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };
  reloadWhenIdle();
}

/* ------------------------------------------------------------------ views */

function listen(collection: string, fn: () => void): () => void {
  let set = listeners.get(collection);
  if (set === undefined) {
    set = new Set();
    listeners.set(collection, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

/** Reload when any of `collections` changes (no data of its own). */
export function useOnChange(collections: Collection[], fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  const key = collections.join(',');
  useEffect(() => {
    const call = (): void => ref.current();
    const offs = key
      .split(',')
      .filter((x) => x !== '')
      .map((c) => listen(c, call));
    return () => {
      for (const off of offs) off();
    };
  }, [key]);
}

export interface Live<T> {
  data: T | null;
  /** True on the first load (and after the inputs change), not on live reloads. */
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Replace the data on screen (after an operation returned the new state). */
  set: (data: T) => void;
}

/**
 * `useLive(() => op('docs.list', { type }), ['documents'], [type])`
 * loads now, again when `deps` change, and again (debounced) whenever one
 * of `collections` changes. Errors are kept for the view to show.
 */
export function useLive<T>(load: () => Promise<T>, collections: Collection[], deps: unknown[]): Live<T> {
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
        setError(errMessage(err));
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

  const set = useCallback((d: T) => {
    seq.current += 1;
    setData(d);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, reload: run, set };
}

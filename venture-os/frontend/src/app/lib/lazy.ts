/**
 * Pages load on demand (SPEC U13): the registry's metadata (routes, nav,
 * tabs, settings labels) stays eager, the components behind them are lazy
 * chunks, and every chunk is fetched in the background after the first
 * paint, so a move between pages never waits on the network. Views keep
 * their last data (useOp `name`), so a page returns instantly.
 *
 *   // pages/committee/index.tsx
 *   const CommitteePage = lazyPage(() => import('./CommitteePage.tsx'), 'CommitteePage');
 *   export const routes: RouteDef[] = [{ path: '/committee', page: CommitteePage }];
 *
 * Works for any component a module registers (a page, a tab, a settings
 * section, a Focus card body); the shell wraps them in Suspense. The first
 * page's chunk starts loading at boot, alongside the session check.
 */
import { lazy } from 'react';
import type { ComponentType } from 'react';

const loaders = new Set<() => Promise<unknown>>();
let prefetched = false;

/** A component loaded from its own chunk on first use (and prefetched after the first paint). */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K): M[K] {
  let pending: Promise<M> | null = null;
  const once = (): Promise<M> => {
    if (pending === null) {
      pending = load();
      pending.catch(() => {
        pending = null;
      });
    }
    return pending;
  };
  loaders.add(once);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = lazy(async () => ({ default: (await once())[name] as ComponentType<any> }));
  Object.assign(c, { preload: once });
  return c as unknown as M[K];
}

/** Start loading a lazyPage component's chunk now (no-op for anything else). */
export function preloadPage(component: unknown): void {
  const p = (component as { preload?: unknown } | null | undefined)?.preload;
  if (typeof p === 'function') void (p as () => Promise<unknown>)().catch(() => undefined);
}

/** Fetch every registered chunk while the browser is idle (once, after the first paint). */
export function prefetchPages(): void {
  if (prefetched) return;
  prefetched = true;
  const run = (): void => {
    const list = [...loaders];
    let i = 0;
    // A few at a time, so the first screen's own calls are never crowded out.
    const next = (): void => {
      const batch = list.slice(i, i + 3);
      i += 3;
      if (batch.length === 0) return;
      void Promise.allSettled(batch.map((l) => l())).then(next);
    };
    next();
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback !== undefined) w.requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 800);
}

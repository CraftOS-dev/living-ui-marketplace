/**
 * Hash routes: '#/deals/D-0012?tab=memo'. A route is a path pattern with
 * ':name' segments:
 *
 *   matchPath('/deals/:id', '/deals/D-0012') -> { id: 'D-0012' }
 *
 * The query keeps view state (tabs, filters, the open record) so links and
 * the back button work.
 */
import { startTransition, useEffect, useState } from 'react';

export interface Route {
  /** '/deals/D-0012' */
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#/, '');
  const [p = '', qs = ''] = raw.split('?');
  const path = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
  return { path, segments: path.split('/').filter((s) => s !== '').map(decodeURIComponent), query: new URLSearchParams(qs) };
}

let current = read();
let previous: Route | null = null;
const subs = new Set<(r: Route) => void>();
window.addEventListener('hashchange', () => {
  previous = current;
  current = read();
  startTransition(() => {
    for (const fn of subs) fn(current);
  });
});

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    subs.add(setRoute);
    setRoute(current);
    return () => {
      subs.delete(setRoute);
    };
  }, []);
  return route;
}

export function currentRoute(): Route {
  return current;
}

/** The route before this one (Focus mode returns there on Esc). */
export function previousRoute(): Route | null {
  return previous;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function href(path: string, query?: Query): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '' && v !== false) clean[k] = String(v);
  const qs = new URLSearchParams(clean).toString();
  const p = '/' + path.replace(/^#?\/*/, '');
  return `#${p}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(path: string, query?: Query): void {
  const next = href(path, query);
  if (window.location.hash === next) return;
  window.location.hash = next.slice(1);
}

/** Go to a link as the server writes it ('#/deals/D-1' or '/deals/D-1'). */
export function go(link: string): void {
  const raw = link.replace(/^#/, '');
  const [p = '/', qs = ''] = raw.split('?');
  navigate(p, Object.fromEntries(new URLSearchParams(qs)));
}

/** Change the query of the current page without a new history entry. */
export function setQuery(patch: Query): void {
  const q: Query = {};
  current.query.forEach((v, k) => {
    q[k] = v;
  });
  Object.assign(q, patch);
  const next = href(current.path, q);
  if (window.location.hash === next) return;
  window.history.replaceState(null, '', next);
  current = read();
  // A transition, like a hash change: a tab whose code is still loading keeps the current view on screen.
  startTransition(() => {
    for (const fn of subs) fn(current);
  });
}

/** ':name' segments of `pattern` matched against `path`; null when it does not match. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter((s) => s !== '');
  const b = path.split('/').filter((s) => s !== '');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] ?? '';
    const val = b[i] ?? '';
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

/** True when `path` is `base` or below it ('/deals' contains '/deals/D-0012'). */
export function under(path: string, base: string): boolean {
  if (base === '/') return path === '/';
  return path === base || path.startsWith(base.endsWith('/') ? base : base + '/');
}

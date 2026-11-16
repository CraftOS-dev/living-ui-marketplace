/**
 * Hash routes: '#/people/E0001?tab=job'. A route is a path pattern with
 * ':name' segments (see routes.tsx for the module contract):
 *
 *   matchPath('/people/:id', '/people/E0001') -> { id: 'E0001' }
 *
 * The query keeps view state (tabs, filters, the open record) so links and
 * the back button work.
 */
import { startTransition, useEffect, useState } from 'react';

export interface Route {
  /** '/people/E0001' */
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
const subs = new Set<(r: Route) => void>();
window.addEventListener('hashchange', () => {
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

export type Query = Record<string, string | number | boolean | null | undefined>;

export function href(path: string, query?: Query): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '' && v !== false) clean[k] = String(v);
  const qs = new URLSearchParams(clean).toString();
  const p = '/' + path.replace(/^\/+/, '');
  return `#${p}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(path: string, query?: Query): void {
  const next = href(path, query);
  if (window.location.hash === next) return;
  window.location.hash = next.slice(1);
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
  for (const fn of subs) fn(current);
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

/** True when `path` is `base` or below it ('/people' contains '/people/E0001'). */
export function under(path: string, base: string): boolean {
  return path === base || path.startsWith(base.endsWith('/') ? base : base + '/');
}

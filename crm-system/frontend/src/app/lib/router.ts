/**
 * Hash routes: #/home (default), #/today, #/people?id=.. (a record page) or
 * ?peek=.. (the side panel), #/companies, #/deals?pipeline=..&id=..,
 * #/review, #/reports?r=pipeline, #/activity, #/setup?tab=...
 */
import { useEffect, useState } from 'react';

export type View = 'home' | 'today' | 'people' | 'companies' | 'deals' | 'review' | 'reports' | 'activity' | 'setup';

export const VIEWS: View[] = ['home', 'today', 'people', 'companies', 'deals', 'review', 'reports', 'activity', 'setup'];

export interface Route {
  view: View;
  q: Record<string, string>;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  const view = (VIEWS as string[]).includes(path) ? (path as View) : 'home';
  const q: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) q[k] = v;
  return { view, q };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = (): void => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function href(view: View, q: Record<string, string | undefined> = {}): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') clean[k] = v;
  const qs = new URLSearchParams(clean).toString();
  return `#/${view}${qs !== '' ? `?${qs}` : ''}`;
}

export function go(view: View, q: Record<string, string | undefined> = {}): void {
  window.location.hash = href(view, q).slice(1);
}

/** Open a record's page. */
export function openRecord(object: 'people' | 'companies' | 'deals', id: string): void {
  go(object, { id });
}

/** Change the current view's query without a new history entry. */
export function setQuery(q: Record<string, string | undefined>, merge = true): void {
  const cur = read();
  const next = href(cur.view, merge ? { ...cur.q, ...q } : q);
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

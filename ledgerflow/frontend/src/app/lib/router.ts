/**
 * Hash routes: #/home (default), #/inbox, #/ledger?account=..&txn=.., #/reconcile?account=..,
 * #/sales?doc=.., #/purchases?doc=.., #/reports?r=pnl, #/close?period=..,
 * #/activity, #/setup?tab=...
 */
import { useEffect, useState } from 'react';

export type View = 'home' | 'inbox' | 'ledger' | 'reconcile' | 'sales' | 'purchases' | 'reports' | 'close' | 'activity' | 'setup';

export const VIEWS: View[] = ['home', 'inbox', 'ledger', 'reconcile', 'sales', 'purchases', 'reports', 'close', 'activity', 'setup'];

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

/** Change the current view's query without a new history entry. */
export function setQuery(q: Record<string, string | undefined>, merge = true): void {
  const cur = read();
  const next = href(cur.view, merge ? { ...cur.q, ...q } : q);
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

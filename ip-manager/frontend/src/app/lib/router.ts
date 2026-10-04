/**
 * Hash router: "#/page", "#/page/id", "#/page?key=value". Deep links from
 * notifications and the calendar feed use the same shapes.
 */
import { useCallback, useEffect, useState } from 'react';

export type Page =
  | 'today'
  | 'inbox'
  | 'deadlines'
  | 'renewals'
  | 'properties'
  | 'property'
  | 'patents'
  | 'trademarks'
  | 'designs'
  | 'copyrights'
  | 'works'
  | 'work'
  | 'matter'
  | 'family'
  | 'inventions'
  | 'invention'
  | 'agreements'
  | 'agreement'
  | 'rights'
  | 'approvals'
  | 'enforcement'
  | 'people'
  | 'reports'
  | 'settings';

export const PAGES: readonly Page[] = [
  'today',
  'inbox',
  'deadlines',
  'renewals',
  'properties',
  'property',
  'patents',
  'trademarks',
  'designs',
  'copyrights',
  'works',
  'work',
  'matter',
  'family',
  'inventions',
  'invention',
  'agreements',
  'agreement',
  'rights',
  'approvals',
  'enforcement',
  'people',
  'reports',
  'settings',
];

export interface Route {
  page: Page;
  id: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const [first = '', second = ''] = path.split('/');
  const page = (PAGES as readonly string[]).includes(first) ? (first as Page) : 'today';
  return { page, id: decodeURIComponent(second), params: new URLSearchParams(query) };
}

export function href(page: Page, id?: string, params?: Record<string, string>): string {
  let h = `#/${page}`;
  if (id !== undefined && id !== '') h += `/${encodeURIComponent(id)}`;
  if (params !== undefined) {
    const qs = new URLSearchParams(params).toString();
    if (qs !== '') h += `?${qs}`;
  }
  return h;
}

export function navigate(page: Page, id?: string, params?: Record<string, string>): void {
  window.location.hash = href(page, id, params);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

/** Keep one query param in the hash in sync with state (filters survive reloads). */
export function useHashParam(key: string, fallback: string): [string, (v: string) => void] {
  const route = useRoute();
  const value = route.params.get(key) ?? fallback;
  const set = useCallback(
    (v: string) => {
      const r = parseHash(window.location.hash);
      const p = new URLSearchParams(r.params);
      if (v === fallback || v === '') p.delete(key);
      else p.set(key, v);
      const qs = p.toString();
      const base = `#/${r.page}${r.id !== '' ? `/${encodeURIComponent(r.id)}` : ''}`;
      window.history.replaceState(null, '', qs !== '' ? `${base}?${qs}` : base);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    [key, fallback],
  );
  return [value, set];
}

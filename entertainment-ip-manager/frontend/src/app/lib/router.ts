/**
 * Hash router: "#/page", "#/page/id", "#/page?key=value". Deep links from
 * notifications, digests and the calendar feed use the same shapes.
 */
import { useCallback, useEffect, useState } from 'react';

export const PAGES = [
  // Work
  'today',
  'inbox',
  'deadlines',
  'reports',
  // IP
  'franchises',
  'franchise',
  'characters',
  'character',
  'talents',
  'talent',
  'titles',
  'title',
  'music',
  'song',
  'recording',
  // Rights
  'canwe',
  'agreements',
  'agreement',
  'committees',
  'committee',
  'permissions',
  // Licensing
  'products',
  'product',
  'approvals',
  'royalties',
  // Protect
  'trademarks',
  'matter',
  'family',
  'renewals',
  'enforcement',
  'case',
  // Organization
  'guidelines',
  'people',
  'settings',
  // External accounts
  'portal',
] as const;

export type Page = (typeof PAGES)[number];

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

/** Keep one query param in the hash in sync with state (filters and tabs survive reloads). */
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

/** The page that shows a record of a collection (search results, links, notifications). */
export const RECORD_PAGE: Record<string, Page> = {
  franchises: 'franchise',
  characters: 'character',
  talents: 'talent',
  titles: 'title',
  songs: 'song',
  recordings: 'recording',
  agreements: 'agreement',
  committees: 'committee',
  products: 'product',
  matters: 'matter',
  families: 'family',
  enforcement_cases: 'case',
  parties: 'people',
};

/** Link to the record a deadline, event or Inbox item is about. */
export function subjectHref(subjectType: string, id: string): string {
  const page: Page | undefined = {
    matter: 'matter',
    trademark: 'matter',
    design: 'matter',
    agreement: 'agreement',
    work: 'title',
    character: 'character',
    talent: 'talent',
    product: 'product',
    approval: 'approvals',
    permission: 'permissions',
    committee: 'committee',
    case: 'case',
    registration: 'music',
    claim: 'music',
    recordation: 'enforcement',
    society_contract: 'music',
    fan_registration: 'guidelines',
    enrollment: 'enforcement',
  }[subjectType] as Page | undefined;
  if (page === undefined) return href('today');
  if (page === 'approvals' || page === 'permissions' || page === 'guidelines' || page === 'music' || page === 'enforcement') return href(page, undefined, { open: id });
  return href(page, id);
}

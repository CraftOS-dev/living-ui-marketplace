/** Hash routes: #/ (home), #/items, #/item?id=..., #/locations?id=..., ... */
import { useEffect, useState } from 'react';

export type Page =
  | 'home'
  | 'items'
  | 'item'
  | 'locations'
  | 'scan'
  | 'reorder'
  | 'orders'
  | 'order'
  | 'counts'
  | 'count'
  | 'activity'
  | 'suppliers'
  | 'labels'
  | 'data'
  | 'settings';

const PAGES: Page[] = ['home', 'items', 'item', 'locations', 'scan', 'reorder', 'orders', 'order', 'counts', 'count', 'activity', 'suppliers', 'labels', 'data', 'settings'];

/** The rail entry a page belongs to (detail pages light up their list). */
export const SECTION: Record<Page, Page> = {
  home: 'home',
  items: 'items',
  item: 'items',
  locations: 'locations',
  scan: 'scan',
  reorder: 'reorder',
  orders: 'orders',
  order: 'orders',
  counts: 'counts',
  count: 'counts',
  activity: 'activity',
  suppliers: 'suppliers',
  labels: 'labels',
  data: 'data',
  settings: 'settings',
};

function read(): { page: Page; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'home';
  return { page, query: new URLSearchParams(qs) };
}

export function useRoute(): { page: Page; query: URLSearchParams } {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = (): void => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function href(page: Page, query?: Record<string, string>): string {
  const qs = query !== undefined ? new URLSearchParams(query).toString() : '';
  return `#/${page === 'home' ? '' : page}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(page: Page, query?: Record<string, string>): void {
  window.location.hash = href(page, query).slice(1);
  window.scrollTo({ top: 0 });
}

/** Change the current page's query without scrolling (filters, selection). */
export function replaceQuery(page: Page, query: Record<string, string>): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (v !== '') clean[k] = v;
  const next = href(page, clean);
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

/*
 * Back buttons follow the app's own trail of pages. The browser's history is
 * shared with the host page around the app, so history.back() could leave
 * the app; this trail never does.
 */
const trail: string[] = [];
let tracking = false;

export function trackTrail(): void {
  if (tracking) return;
  tracking = true;
  trail.push(window.location.hash || '#/');
  window.addEventListener('hashchange', () => {
    const now = window.location.hash || '#/';
    if (trail[trail.length - 1] !== now) trail.push(now);
    if (trail.length > 40) trail.splice(0, trail.length - 40);
  });
}

/** Go to the page before this one in the app, or to `fallback`. */
export function back(fallback: Page, query?: Record<string, string>): void {
  trail.pop();
  const prev = trail.pop();
  if (prev !== undefined) {
    window.location.hash = prev.slice(1);
    window.scrollTo({ top: 0 });
  } else navigate(fallback, query);
}

/**
 * Hash routes: #/ (sell), #/orders, #/order?id=..., #/products,
 * #/product?id=..., #/stock, #/customers, #/customer?id=..., #/promotions,
 * #/reports, #/drawer, #/team, #/activity, #/requests, #/settings and
 * #/display?register=... (the customer-facing screen).
 */
import { useEffect, useState } from 'react';

export type Page =
  | 'home'
  | 'orders'
  | 'order'
  | 'products'
  | 'product'
  | 'stock'
  | 'customers'
  | 'customer'
  | 'promotions'
  | 'reports'
  | 'drawer'
  | 'team'
  | 'activity'
  | 'requests'
  | 'settings'
  | 'display';

const PAGES: Page[] = ['home', 'orders', 'order', 'products', 'product', 'stock', 'customers', 'customer', 'promotions', 'reports', 'drawer', 'team', 'activity', 'requests', 'settings', 'display'];

/** The rail entry a page belongs to. */
export const SECTION: Record<Page, Page> = {
  home: 'home',
  orders: 'orders',
  order: 'orders',
  products: 'products',
  product: 'products',
  stock: 'stock',
  customers: 'customers',
  customer: 'customers',
  promotions: 'promotions',
  reports: 'reports',
  drawer: 'drawer',
  team: 'team',
  activity: 'activity',
  requests: 'requests',
  settings: 'settings',
  display: 'display',
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

/** Change the current page's query without scrolling or a new history entry. */
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

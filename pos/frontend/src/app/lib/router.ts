/** Hash routes: #/ (the register), #/orders?id=..., #/products?tab=..., #/display, ... */
import { useEffect, useState } from 'react';

export type Page = 'register' | 'orders' | 'kitchen' | 'products' | 'customers' | 'reports' | 'shifts' | 'settings' | 'display' | 'board';

const PAGES: Page[] = ['register', 'orders', 'kitchen', 'products', 'customers', 'reports', 'shifts', 'settings', 'display', 'board'];

/** Screens customers look at: no rail, no sign-in. */
export const CUSTOMER_FACING: Page[] = ['display', 'board'];

function read(): { page: Page; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'register';
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
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v !== '') clean[k] = v;
  const qs = new URLSearchParams(clean).toString();
  return `#/${page === 'register' ? '' : page}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(page: Page, query?: Record<string, string>): void {
  window.location.hash = href(page, query).slice(1);
  window.scrollTo({ top: 0 });
}

/** Change the current page's query without a new history entry (filters, selection). */
export function replaceQuery(page: Page, query: Record<string, string>): void {
  const next = href(page, query);
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The full URL of a page (to open the customer display in its own window). */
export function absolute(page: Page, query?: Record<string, string>): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}${href(page, query)}`;
}

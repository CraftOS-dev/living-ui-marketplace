/**
 * Hash routes: #/<page>/<sub>/<id>.
 *
 *   #/overview
 *   #/orders/<view>/<order id>        an order opens in a side panel
 *   #/products/<filter>               #/products/stock, #/products/push
 *   #/product/<id>
 *   #/inbox/<view>/<thread id>
 *   #/customers/<filter>/<customer id>
 *   #/approvals/<pending|history>
 *   #/shops                           #/shop/<id>
 *   #/settings/<section>
 */
import { startTransition, useEffect, useState } from 'react';

export type Page = 'overview' | 'orders' | 'products' | 'product' | 'inbox' | 'customers' | 'approvals' | 'shops' | 'shop' | 'settings';
const PAGES: Page[] = ['overview', 'orders', 'products', 'product', 'inbox', 'customers', 'approvals', 'shops', 'shop', 'settings'];

export interface Route {
  page: Page;
  sub: string;
  id: string;
}

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  const page = (PAGES as string[]).includes(parts[0] ?? '') ? (parts[0] as Page) : 'overview';
  return { page, sub: parts[1] ?? '', id: parts[2] ?? '' };
}

export function href(page: Page, sub = '', id = ''): string {
  let h = '#/' + page;
  if (sub !== '' || id !== '') h += '/' + encodeURIComponent(sub);
  if (id !== '') h += '/' + encodeURIComponent(id);
  return h;
}

export function go(page: Page, sub = '', id = ''): void {
  window.location.hash = href(page, sub, id);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = (): void => startTransition(() => setRoute(parse(window.location.hash)));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Where an activity or task target ("order:<id>", "shop:<id>"...) opens. */
export function targetHref(target: string): string {
  const [kind = '', id = ''] = target.split(':');
  if (kind === 'order') return href('orders', 'all', id);
  if (kind === 'shop') return href('shop', id);
  if (kind === 'product') return href('product', id);
  if (kind === 'thread') return href('inbox', 'all', id);
  if (kind === 'proposal') return href('approvals', 'pending');
  if (kind === 'chat') return '';
  if (kind === 'store') return href('orders', 'shipped');
  return '';
}

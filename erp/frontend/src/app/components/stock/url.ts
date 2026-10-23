/**
 * Keep a list's filters in the address without reloading the page. The app
 * keys each page by its full address, so router.replaceQuery (which fires a
 * hashchange) would mount the page again on every keystroke of a search.
 * This writes the same address quietly; a reload or a shared link still
 * opens the page with these filters.
 */
import { href, replaceQuery } from '../../lib/router.ts';
import type { Page, Query } from '../../lib/router.ts';

export function quietQuery(page: Page, query: Query): void {
  const next = href(page, query);
  if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next);
}

/** The query in the address now (quiet filters included), without `key`. */
export function addressQueryWithout(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').forEach((v, k) => {
    if (k !== key) out[k] = v;
  });
  return out;
}

/**
 * Drop a one-shot flag ("?new=1") once its screen closes, but only while the
 * address is still that page: saving may already have moved on to the new
 * record, and that must not be undone.
 */
export function dropFlag(page: Page, key: string): void {
  const [p = '', qs = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  if (p !== page || !new URLSearchParams(qs).has(key)) return;
  replaceQuery(page, addressQueryWithout(key));
}

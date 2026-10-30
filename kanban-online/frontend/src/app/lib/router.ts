/** Hash routes: #/board?id=..&card=.., #/inbox, #/review, #/insights, #/activity, #/team, #/settings. */
import { useEffect, useState } from 'react';

export type Page = 'board' | 'inbox' | 'review' | 'insights' | 'activity' | 'team' | 'settings';

const PAGES: Page[] = ['board', 'inbox', 'review', 'insights', 'activity', 'team', 'settings'];

function read(): { page: Page; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'board';
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
  return `#/${page}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(page: Page, query?: Record<string, string>): void {
  window.location.hash = href(page, query).slice(1);
}

/** Change the query of the current page without a new history entry. */
export function setQuery(page: Page, query: Record<string, string>): void {
  const next = href(page, query);
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

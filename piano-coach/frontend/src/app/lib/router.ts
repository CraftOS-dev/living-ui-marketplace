/**
 * Hash routes: #/today, #/learn?lesson=..&page=.., #/train?skill=.., #/library?song=..,
 * #/practice?song=..&from=..&to=..&mode=..&tempo=..&hands=..&block=.. (or ?gen=<exercise>, ?ex=<lesson.step>),
 * #/reference?tab=.., #/coach, #/settings.
 */
import { useEffect, useState } from 'react';

export type Page = 'today' | 'learn' | 'train' | 'library' | 'reference' | 'practice' | 'coach' | 'settings';

const PAGES: Page[] = ['today', 'learn', 'train', 'library', 'reference', 'practice', 'coach', 'settings'];

function read(): { page: Page; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', qs = ''] = raw.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'today';
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

export function href(page: Page, query?: Record<string, string | number | undefined>): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') clean[k] = String(v);
  const qs = new URLSearchParams(clean).toString();
  return `#/${page}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(page: Page, query?: Record<string, string | number | undefined>): void {
  window.location.hash = href(page, query).slice(1);
}

/** Change the query of the current page without a new history entry. */
export function setQuery(page: Page, query: Record<string, string | number | undefined>): void {
  const next = href(page, query);
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

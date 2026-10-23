/**
 * Hash routes (the app lives in CraftBot's frame, so the address is the hash):
 *
 *   #/                         Home
 *   #/library?view=&collection=&tag=&q=
 *   #/paper?id=                a paper's page (narrow screens; wide ones use the item pane)
 *   #/read?file=&page=         the reader
 *   #/projects                 projects
 *   #/project?id=&view=&board=&ms=&review=&note=&task=
 *   #/discover?tab=&search=
 *   #/notes?note=
 *   #/agent?tab=
 *   #/activity
 *   #/settings
 *
 * Back buttons follow the app's own trail: history.back() could leave the
 * app inside the host's frame.
 */
import { useEffect, useState } from 'react';

export type Page = 'home' | 'library' | 'paper' | 'read' | 'projects' | 'project' | 'discover' | 'notes' | 'agent' | 'activity' | 'settings';

const PAGES: Page[] = ['home', 'library', 'paper', 'read', 'projects', 'project', 'discover', 'notes', 'agent', 'activity', 'settings'];

/** The rail entry a page belongs to. */
export const SECTION: Record<Page, Page> = {
  home: 'home',
  library: 'library',
  paper: 'library',
  read: 'library',
  projects: 'projects',
  project: 'projects',
  discover: 'discover',
  notes: 'notes',
  agent: 'agent',
  activity: 'activity',
  settings: 'settings',
};

export interface Route {
  page: Page;
  query: URLSearchParams;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [p = '', qs = ''] = raw.split('?');
  const page = (PAGES as string[]).includes(p) ? (p as Page) : 'home';
  return { page, query: new URLSearchParams(qs) };
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

export function href(page: Page, query?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `#/${page === 'home' ? '' : page}${qs !== '' ? `?${qs}` : ''}`;
}

const trail: string[] = [];

export function trackTrail(): void {
  trail.push(window.location.hash);
  window.addEventListener('hashchange', () => {
    const h = window.location.hash;
    if (trail[trail.length - 2] === h) trail.pop();
    else if (trail[trail.length - 1] !== h) trail.push(h);
    if (trail.length > 60) trail.shift();
  });
}

export function navigate(page: Page, query?: Record<string, string | undefined>): void {
  window.location.hash = href(page, query);
}

/** Change the query of the current page in place (filters, tabs) without a new Back step. */
export function replaceQuery(patch: Record<string, string | undefined>): void {
  const r = read();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') r.query.delete(k);
    else r.query.set(k, v);
  }
  const qs = r.query.toString();
  const h = `#/${r.page === 'home' ? '' : r.page}${qs !== '' ? `?${qs}` : ''}`;
  window.history.replaceState(null, '', h);
  if (trail.length > 0) trail[trail.length - 1] = h;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Back along the app's own trail (or to a fallback page). */
export function back(fallback: Page = 'home', query?: Record<string, string>): void {
  if (trail.length >= 2) {
    const prev = trail[trail.length - 2] as string;
    window.location.hash = prev;
    return;
  }
  navigate(fallback, query);
}

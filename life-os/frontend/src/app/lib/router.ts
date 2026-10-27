/**
 * Hash routes (the app lives in CraftBot's frame, so the address is the hash):
 *
 *   #/                      Home
 *   #/board?view=&area=     the board (lists or the week)
 *   #/habits
 *   #/life                  the life map and every goal
 *   #/area?kind=            one area of life, with its own tools
 *   #/projects              #/project?id=
 *   #/journal?tab=&entry=
 *   #/agent?tab=
 *   #/settings?tab=
 *   #/welcome               the first run
 *
 * Back buttons follow the app's own trail: history.back() could leave the
 * app inside the host's frame.
 */
import { startTransition, useEffect, useState } from 'react';

export type Page = 'home' | 'board' | 'habits' | 'life' | 'area' | 'projects' | 'project' | 'journal' | 'agent' | 'settings' | 'welcome';

const PAGES: Page[] = ['home', 'board', 'habits', 'life', 'area', 'projects', 'project', 'journal', 'agent', 'settings', 'welcome'];

/** The sidebar entry a page belongs to. */
export const SECTION: Record<Page, Page> = {
  home: 'home',
  board: 'board',
  habits: 'habits',
  life: 'life',
  area: 'life',
  projects: 'projects',
  project: 'projects',
  journal: 'journal',
  agent: 'agent',
  settings: 'settings',
  welcome: 'home',
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
    // A transition: the page you are on stays until the next one is ready (no loading flash).
    const on = (): void => startTransition(() => setRoute(read()));
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
export function back(fallback: Page = 'home', query?: Record<string, string> | undefined): void {
  if (trail.length >= 2) {
    const prev = trail[trail.length - 2] as string;
    window.location.hash = prev;
    return;
  }
  navigate(fallback, query);
}

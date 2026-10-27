/**
 * Hash routes, one per step: #/links, #/team, #/answers/company, #/polish,
 * #/submit. An optional "@key" opens and scrolls to a question:
 * #/answers/company@c_desc. An empty hash opens the step you are on.
 */
import { startTransition, useEffect, useState } from 'react';

export type Page = 'links' | 'team' | 'answers' | 'polish' | 'submit';
export const PAGES: Page[] = ['links', 'team', 'answers', 'polish', 'submit'];

export interface Route {
  page: Page | '';
  sub: string;
  focus: string;
}

export function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', focus = ''] = raw.split('@');
  const [page = '', sub = ''] = path.split('/');
  return { page: (PAGES as string[]).includes(page) ? (page as Page) : '', sub, focus };
}

export function href(page: Page, sub = '', focus = ''): string {
  return '#/' + page + (sub !== '' ? '/' + sub : '') + (focus !== '' ? '@' + focus : '');
}

export function go(page: Page, sub = '', focus = ''): void {
  window.location.hash = href(page, sub, focus);
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

/** The step each backend stage belongs to. */
export const STAGE_PAGE: Record<string, Page> = { gather: 'links', team: 'team', answers: 'answers', review: 'polish', video: 'submit', submit: 'submit' };

/** Where a check, a factor or a question points to. `section` is the question's section when known. */
export function targetHref(t: { kind: string; key?: string | undefined } | null | undefined, section?: string): string {
  if (!t) return href('polish');
  if (t.kind === 'answer' && t.key) {
    if (t.key.startsWith('fp.')) return href('team', '', t.key);
    if (t.key === 'f_video') return href('submit', '', 'video');
    return href('answers', section ?? '', t.key);
  }
  if (t.kind === 'team') return href('team');
  if (t.kind === 'confirm') return href('polish', '', 'before');
  if (t.kind === 'settings') return href('submit');
  return href('polish');
}

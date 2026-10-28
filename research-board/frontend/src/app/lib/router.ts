/** One route: #/board?id=<board>&card=<card to focus>. */
import { useEffect, useState } from 'react';

export type Page = 'board';

function read(): { id: string; card: string } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const qs = new URLSearchParams(raw.split('?')[1] ?? '');
  return { id: qs.get('id') ?? '', card: qs.get('card') ?? '' };
}

export function useRoute(): { id: string; card: string } {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = (): void => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function hashFor(query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return `#/board${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(_page: Page, query: Record<string, string> = {}): void {
  window.location.hash = hashFor(query).slice(1);
}

/** Change the address without a history entry. */
export function replaceQuery(_page: Page, query: Record<string, string>): void {
  const next = hashFor(query);
  if (window.location.hash === next) return;
  window.history.replaceState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Open a card on its board. */
export function openCard(board: string, card: string): void {
  navigate('board', { id: board, card });
}

const LAST_BOARD = 'rb_last_board';

export function rememberBoard(id: string): void {
  try {
    localStorage.setItem(LAST_BOARD, id);
  } catch {
    /* a convenience */
  }
}

export function lastBoard(): string {
  try {
    return localStorage.getItem(LAST_BOARD) ?? '';
  } catch {
    return '';
  }
}

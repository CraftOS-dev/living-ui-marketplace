/** Hash routes: #/ (home), #/expenses, #/insights, ... */
import { useEffect, useState } from 'react';

export type Page = 'home' | 'expenses' | 'insights' | 'budgets' | 'recurring' | 'categories' | 'receipts' | 'import' | 'settings';

const PAGES: Page[] = ['home', 'expenses', 'insights', 'budgets', 'recurring', 'categories', 'receipts', 'import', 'settings'];

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

export function navigate(page: Page, query?: Record<string, string>): void {
  const qs = query !== undefined ? new URLSearchParams(query).toString() : '';
  window.location.hash = `/${page === 'home' ? '' : page}${qs !== '' ? `?${qs}` : ''}`;
  window.scrollTo({ top: 0 });
}

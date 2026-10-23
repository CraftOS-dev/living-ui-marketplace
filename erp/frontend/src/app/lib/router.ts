/**
 * Hash routes: #/ (Home), #/invoices, #/doc?id=..., #/report?kind=pnl ...
 *
 * Every page is its own route, so a link (in a message, a note, a proposal)
 * opens exactly that screen, and Back walks the app's own trail.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

export const DOC_PAGES = {
  quotes: 'quote',
  'sales-orders': 'sales_order',
  deliveries: 'delivery',
  invoices: 'invoice',
  'credit-notes': 'credit_note',
  'purchase-orders': 'purchase_order',
  receipts: 'goods_receipt',
  bills: 'bill',
  'supplier-credits': 'supplier_credit',
} as const;
export type DocPage = keyof typeof DOC_PAGES;
export type DocType = (typeof DOC_PAGES)[DocPage];

export const PAGE_OF_TYPE: Record<DocType, DocPage> = {
  quote: 'quotes',
  sales_order: 'sales-orders',
  delivery: 'deliveries',
  invoice: 'invoices',
  credit_note: 'credit-notes',
  purchase_order: 'purchase-orders',
  goods_receipt: 'receipts',
  bill: 'bills',
  supplier_credit: 'supplier-credits',
};

const PAGES = [
  'home',
  'needs',
  // sales and purchasing
  'customers',
  'suppliers',
  'party',
  ...(Object.keys(DOC_PAGES) as DocPage[]),
  'doc',
  'doc-new',
  // inventory and manufacturing
  'items',
  'item',
  'stock',
  'stock-changes',
  'stock-change',
  'reorder',
  'warehouses',
  'builds',
  'build',
  'boms',
  'bom',
  // money and accounting
  'payments',
  'payment',
  'banks',
  'bank',
  'accounts',
  'account',
  'journals',
  'journal',
  'close',
  'assets',
  'asset',
  'budgets',
  'reports',
  'report',
  // people and projects
  'employees',
  'employee',
  'org',
  'leave',
  'claims',
  'claim',
  'payroll',
  'payrun',
  'payslip',
  'projects',
  'project',
  'timesheets',
  // your AI agent
  'proposals',
  'proposal',
  'inbox',
  'asks',
  'agent-activity',
  // you and the company
  'settings',
  'profile',
] as const;

export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  query: URLSearchParams;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [p = '', qs = ''] = raw.split('?');
  const page = (PAGES as readonly string[]).includes(p) ? (p as Page) : 'home';
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

export type Query = Record<string, string | undefined>;

function clean(query?: Query): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export function href(page: Page, query?: Query): string {
  const qs = new URLSearchParams(clean(query)).toString();
  return `#/${page === 'home' ? '' : page}${qs !== '' ? `?${qs}` : ''}`;
}

export function navigate(page: Page, query?: Query): void {
  window.location.hash = href(page, query).slice(1);
  window.scrollTo({ top: 0 });
}

let replacing = false;

/** Change the current page's query without a new history step or scrolling (filters, tabs). */
export function replaceQuery(page: Page, query: Query): void {
  const next = href(page, query);
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
    replacing = true;
    try {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } finally {
      replacing = false;
    }
  }
}

/*
 * Back buttons follow the app's own trail of pages. The browser's history is
 * shared with the host page around the app, so history.back() could leave
 * the app; this trail never does.
 */
const trail: string[] = [];
let tracking = false;

export function trackTrail(): void {
  if (tracking) return;
  tracking = true;
  trail.push(window.location.hash || '#/');
  window.addEventListener('hashchange', () => {
    const now = window.location.hash || '#/';
    // A filter change replaces the page's entry: Back returns to the page with its filters.
    if (replacing && trail.length > 0) trail[trail.length - 1] = now;
    else if (trail[trail.length - 1] !== now) trail.push(now);
    if (trail.length > 60) trail.splice(0, trail.length - 60);
  });
}

/** Go to the page before this one in the app, or to `fallback`. */
export function back(fallback: Page, query?: Query): void {
  trail.pop();
  const prev = trail.pop();
  if (prev !== undefined) {
    window.location.hash = prev.slice(1);
    window.scrollTo({ top: 0 });
  } else navigate(fallback, query);
}

/* --------------------------------------------------------- active section */

/**
 * The sidebar entry a screen belongs to. Lists light up their own entry;
 * detail screens (a document, a party) say which list they belong to with
 * useSection('invoices') once they know.
 */
let override: { page: Page; key: string } | null = null;
const sectionSubs = new Set<() => void>();

export function setSection(page: Page, key: string): void {
  if (override?.page === page && override.key === key) return;
  override = { page, key };
  for (const fn of sectionSubs) fn();
}

export function useSectionOverride(page: Page): string | null {
  const snap = useSyncExternalStore(
    (fn) => {
      sectionSubs.add(fn);
      return () => sectionSubs.delete(fn);
    },
    () => override,
  );
  return snap !== null && snap.page === page ? snap.key : null;
}

/** For detail pages: `useSection('doc', doc ? PAGE_OF_TYPE[doc.type] : null)`. */
export function useSection(page: Page, key: string | null): void {
  useEffect(() => {
    if (key !== null) setSection(page, key);
  }, [page, key]);
}

/** The nav key of a route before any override. */
export function baseSection(route: Route): string {
  const p = route.page;
  switch (p) {
    case 'party':
      return route.query.get('role') === 'supplier' ? 'suppliers' : 'customers';
    case 'doc-new': {
      const t = route.query.get('type') as DocType | null;
      return t !== null && t in PAGE_OF_TYPE ? PAGE_OF_TYPE[t] : 'invoices';
    }
    case 'item':
      return 'items';
    case 'stock-change':
      return 'stock-changes';
    case 'build':
      return 'builds';
    case 'bom':
      return 'boms';
    case 'payment':
      return 'payments';
    case 'bank':
      return `bank:${route.query.get('id') ?? ''}`;
    case 'account':
      return 'accounts';
    case 'journal':
      return 'journals';
    case 'asset':
      return 'assets';
    case 'report':
      return `report:${route.query.get('kind') ?? ''}`;
    case 'employee':
      return 'employees';
    case 'claim':
      return 'claims';
    case 'payrun':
    case 'payslip':
      return 'payroll';
    case 'project':
      return 'projects';
    case 'proposal':
      return 'proposals';
    default:
      return p;
  }
}

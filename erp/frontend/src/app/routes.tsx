/**
 * Which component draws each page. Pages load on first visit (each area is
 * its own chunk), so the first screen stays quick on a phone.
 *
 * Every page takes the route's query (`?id=...&tab=...`); document lists
 * also get their type.
 */
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { DOC_PAGES } from './lib/router.ts';
import type { DocPage, DocType, Page } from './lib/router.ts';

export interface PageProps {
  query: URLSearchParams;
}

type AnyPage = LazyExoticComponent<ComponentType<PageProps>>;

function page<K extends string>(load: () => Promise<Record<K, ComponentType<PageProps>>>, name: K): AnyPage {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const DocsPage = lazy(() => import('./pages/docs/DocsPage.tsx').then((m) => ({ default: m.DocsPage })));

/** A document list page bound to its type. */
function docsFor(type: DocType): ComponentType<PageProps> {
  return function DocsOfType({ query }: PageProps): React.JSX.Element {
    return <DocsPage query={query} type={type} />;
  };
}

const PartiesPage = lazy(() => import('./pages/parties/PartiesPage.tsx').then((m) => ({ default: m.PartiesPage })));

/** Customers or suppliers. */
function partiesFor(role: 'customer' | 'supplier'): ComponentType<PageProps> {
  return function PartiesOfRole({ query }: PageProps): React.JSX.Element {
    return <PartiesPage query={query} role={role} />;
  };
}

const DOCS: Record<DocPage, ComponentType<PageProps>> = Object.fromEntries((Object.keys(DOC_PAGES) as DocPage[]).map((p) => [p, docsFor(DOC_PAGES[p])])) as Record<DocPage, ComponentType<PageProps>>;

export const ROUTES: Record<Page, ComponentType<PageProps>> = {
  home: page(() => import('./pages/HomePage.tsx'), 'HomePage'),
  needs: page(() => import('./pages/NeedsPage.tsx'), 'NeedsPage'),

  customers: partiesFor('customer'),
  suppliers: partiesFor('supplier'),
  party: page(() => import('./pages/parties/PartyPage.tsx'), 'PartyPage'),
  ...DOCS,
  doc: page(() => import('./pages/docs/DocPage.tsx'), 'DocPage'),
  'doc-new': page(() => import('./pages/docs/DocNewPage.tsx'), 'DocNewPage'),

  items: page(() => import('./pages/stock/ItemsPage.tsx'), 'ItemsPage'),
  item: page(() => import('./pages/stock/ItemPage.tsx'), 'ItemPage'),
  stock: page(() => import('./pages/stock/StockPage.tsx'), 'StockPage'),
  'stock-changes': page(() => import('./pages/stock/StockChangesPage.tsx'), 'StockChangesPage'),
  'stock-change': page(() => import('./pages/stock/StockChangePage.tsx'), 'StockChangePage'),
  reorder: page(() => import('./pages/stock/ReorderPage.tsx'), 'ReorderPage'),
  warehouses: page(() => import('./pages/stock/WarehousesPage.tsx'), 'WarehousesPage'),
  builds: page(() => import('./pages/make/BuildsPage.tsx'), 'BuildsPage'),
  build: page(() => import('./pages/make/BuildPage.tsx'), 'BuildPage'),
  boms: page(() => import('./pages/make/BomsPage.tsx'), 'BomsPage'),
  bom: page(() => import('./pages/make/BomPage.tsx'), 'BomPage'),

  payments: page(() => import('./pages/money/PaymentsPage.tsx'), 'PaymentsPage'),
  payment: page(() => import('./pages/money/PaymentPage.tsx'), 'PaymentPage'),
  banks: page(() => import('./pages/money/BanksPage.tsx'), 'BanksPage'),
  bank: page(() => import('./pages/money/BankPage.tsx'), 'BankPage'),
  accounts: page(() => import('./pages/books/AccountsPage.tsx'), 'AccountsPage'),
  account: page(() => import('./pages/books/AccountPage.tsx'), 'AccountPage'),
  journals: page(() => import('./pages/books/JournalsPage.tsx'), 'JournalsPage'),
  journal: page(() => import('./pages/books/JournalPage.tsx'), 'JournalPage'),
  close: page(() => import('./pages/books/ClosePage.tsx'), 'ClosePage'),
  assets: page(() => import('./pages/books/AssetsPage.tsx'), 'AssetsPage'),
  asset: page(() => import('./pages/books/AssetPage.tsx'), 'AssetPage'),
  budgets: page(() => import('./pages/books/BudgetsPage.tsx'), 'BudgetsPage'),
  reports: page(() => import('./pages/reports/ReportsPage.tsx'), 'ReportsPage'),
  report: page(() => import('./pages/reports/ReportPage.tsx'), 'ReportPage'),

  employees: page(() => import('./pages/people/EmployeesPage.tsx'), 'EmployeesPage'),
  employee: page(() => import('./pages/people/EmployeePage.tsx'), 'EmployeePage'),
  org: page(() => import('./pages/people/OrgPage.tsx'), 'OrgPage'),
  leave: page(() => import('./pages/people/LeavePage.tsx'), 'LeavePage'),
  claims: page(() => import('./pages/people/ClaimsPage.tsx'), 'ClaimsPage'),
  claim: page(() => import('./pages/people/ClaimPage.tsx'), 'ClaimPage'),
  payroll: page(() => import('./pages/people/PayrollPage.tsx'), 'PayrollPage'),
  payrun: page(() => import('./pages/people/PayrunPage.tsx'), 'PayrunPage'),
  payslip: page(() => import('./pages/people/PayslipPage.tsx'), 'PayslipPage'),
  projects: page(() => import('./pages/work/ProjectsPage.tsx'), 'ProjectsPage'),
  project: page(() => import('./pages/work/ProjectPage.tsx'), 'ProjectPage'),
  timesheets: page(() => import('./pages/work/TimesheetsPage.tsx'), 'TimesheetsPage'),

  proposals: page(() => import('./pages/agent/ProposalsPage.tsx'), 'ProposalsPage'),
  proposal: page(() => import('./pages/agent/ProposalPage.tsx'), 'ProposalPage'),
  inbox: page(() => import('./pages/agent/InboxPage.tsx'), 'InboxPage'),
  asks: page(() => import('./pages/agent/AsksPage.tsx'), 'AsksPage'),
  'agent-activity': page(() => import('./pages/agent/AgentActivityPage.tsx'), 'AgentActivityPage'),

  settings: page(() => import('./pages/settings/SettingsPage.tsx'), 'SettingsPage'),
  profile: page(() => import('./pages/settings/ProfilePage.tsx'), 'ProfilePage'),
};

/**
 * The sidebar: what each role sees, in what order. A group is a module
 * (Sales, Purchasing, ...) that expands into its pages; its "+" makes the
 * module's most common record. Entries a role cannot open are not shown.
 * Bank accounts are listed under Banking by name (one entry each).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BarChart3,
  BookOpen,
  Factory,
  FolderKanban,
  House,
  Inbox,
  Landmark,
  PackageSearch,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import { can, moduleOn } from './me.ts';
import type { Page, Query } from './router.ts';
import type { Me } from './types.ts';

export interface NavEntry {
  /** Matches the active section (router baseSection / useSection). */
  key: string;
  label: string;
  page: Page;
  query?: Query | undefined;
  /** home.needs count key shown as a badge. */
  badge?: string | undefined;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  entries: NavEntry[];
  create?: { label: string; page: Page; query?: Query | undefined } | undefined;
}

export interface NavSingle {
  key: string;
  label: string;
  icon: LucideIcon;
  page: Page;
  query?: Query | undefined;
  badge?: string | undefined;
}

export type NavItem = { kind: 'single'; item: NavSingle } | { kind: 'group'; group: NavGroup };

const e = (key: string, label: string, page: Page, query?: Query, badge?: string): NavEntry => ({ key, label, page, query, badge });

export function buildNav(me: Me, banks: { id: string; name: string; unmatched: number }[]): NavItem[] {
  const out: NavItem[] = [];
  out.push({ kind: 'single', item: { key: 'home', label: 'Home', icon: House, page: 'home' } });
  out.push({ kind: 'single', item: { key: 'needs', label: 'Needs you', icon: Inbox, page: 'needs', badge: 'total' } });

  const inv = moduleOn(me, 'inventory');
  if (can(me, 'sales')) {
    out.push({
      kind: 'group',
      group: {
        key: 'sales',
        label: 'Sales',
        icon: Tag,
        create: can(me, 'sales', 'edit') ? { label: 'New invoice', page: 'doc-new', query: { type: 'invoice' } } : undefined,
        entries: [
          e('customers', 'Customers', 'customers'),
          e('quotes', 'Quotes', 'quotes'),
          e('sales-orders', 'Sales orders', 'sales-orders'),
          ...(inv ? [e('deliveries', 'Deliveries', 'deliveries')] : []),
          e('invoices', 'Invoices', 'invoices', undefined, 'overdue'),
          e('credit-notes', 'Credit notes', 'credit-notes'),
        ],
      },
    });
  }
  if (can(me, 'purchasing')) {
    out.push({
      kind: 'group',
      group: {
        key: 'purchasing',
        label: 'Purchasing',
        icon: ShoppingCart,
        create: can(me, 'purchasing', 'edit') ? { label: 'New bill', page: 'doc-new', query: { type: 'bill' } } : undefined,
        entries: [
          e('suppliers', 'Suppliers', 'suppliers'),
          e('purchase-orders', 'Purchase orders', 'purchase-orders'),
          ...(inv ? [e('receipts', 'Goods receipts', 'receipts')] : []),
          e('bills', 'Bills', 'bills', undefined, 'bills_due'),
          e('supplier-credits', 'Supplier credits', 'supplier-credits'),
        ],
      },
    });
  }
  if (can(me, 'inventory')) {
    out.push({
      kind: 'group',
      group: {
        key: 'inventory',
        label: 'Inventory',
        icon: PackageSearch,
        create: can(me, 'inventory', 'edit') ? { label: 'New item', page: 'items', query: { new: '1' } } : undefined,
        entries: [e('items', 'Items', 'items'), e('stock', 'Stock on hand', 'stock'), e('stock-changes', 'Stock changes', 'stock-changes'), e('reorder', 'Reorder', 'reorder'), e('warehouses', 'Warehouses', 'warehouses')],
      },
    });
  }
  if (can(me, 'manufacturing')) {
    out.push({
      kind: 'group',
      group: {
        key: 'manufacturing',
        label: 'Manufacturing',
        icon: Factory,
        create: can(me, 'manufacturing', 'edit') ? { label: 'New build', page: 'builds', query: { new: '1' } } : undefined,
        entries: [e('builds', 'Builds', 'builds'), e('boms', 'Bills of materials', 'boms')],
      },
    });
  }
  if (can(me, 'banking')) {
    out.push({
      kind: 'group',
      group: {
        key: 'banking',
        label: 'Banking',
        icon: Landmark,
        create: can(me, 'banking', 'edit') ? { label: 'Record a payment', page: 'payments', query: { new: 'in' } } : undefined,
        entries: [e('payments', 'Payments', 'payments'), ...banks.map((b) => ({ key: `bank:${b.id}`, label: b.name, page: 'bank' as Page, query: { id: b.id }, badge: `bank:${b.id}` })), e('banks', 'All accounts', 'banks')],
      },
    });
  }
  if (can(me, 'accounting')) {
    out.push({
      kind: 'group',
      group: {
        key: 'accounting',
        label: 'Accounting',
        icon: BookOpen,
        create: can(me, 'accounting', 'full') ? { label: 'New journal entry', page: 'journals', query: { new: '1' } } : undefined,
        entries: [e('accounts', 'Chart of accounts', 'accounts'), e('journals', 'Journal entries', 'journals'), e('close', 'Month-end close', 'close'), e('assets', 'Fixed assets', 'assets'), e('budgets', 'Budgets', 'budgets')],
      },
    });
  }
  if (can(me, 'reports')) {
    out.push({
      kind: 'group',
      group: {
        key: 'reports',
        label: 'Reports',
        icon: BarChart3,
        entries: [
          e('report:pnl', 'Profit and loss', 'report', { kind: 'pnl' }),
          e('report:balance-sheet', 'Balance sheet', 'report', { kind: 'balance-sheet' }),
          e('report:cash-flow', 'Cash flow', 'report', { kind: 'cash-flow' }),
          e('report:aging', 'Who owes what', 'report', { kind: 'aging' }),
          e('reports', 'All reports', 'reports'),
        ],
      },
    });
  }
  const peopleOn = moduleOn(me, 'people');
  const self = me.employee !== null;
  const peopleEntries: NavEntry[] = [];
  if (peopleOn && can(me, 'people')) peopleEntries.push(e('employees', 'Directory', 'employees'), e('org', 'Org chart', 'org'));
  if (peopleOn && (can(me, 'people') || self || me.manages > 0)) peopleEntries.push(e('leave', 'Leave', 'leave', undefined, 'leave'), e('claims', 'Expense claims', 'claims', undefined, 'claims'));
  if (moduleOn(me, 'payroll') && (can(me, 'payroll') || self)) peopleEntries.push(e('payroll', can(me, 'payroll') ? 'Payroll' : 'Payslips', 'payroll'));
  if (peopleEntries.length > 0) {
    out.push({
      kind: 'group',
      group: { key: 'people', label: 'People', icon: Users, create: self ? { label: 'Request leave', page: 'leave', query: { new: '1' } } : undefined, entries: peopleEntries },
    });
  }
  if (moduleOn(me, 'projects') && (can(me, 'projects') || self)) {
    out.push({
      kind: 'group',
      group: {
        key: 'projects',
        label: 'Projects',
        icon: FolderKanban,
        create: can(me, 'projects', 'edit') ? { label: 'New project', page: 'projects', query: { new: '1' } } : undefined,
        entries: [...(can(me, 'projects') ? [e('projects', 'Projects', 'projects')] : []), e('timesheets', 'Timesheets', 'timesheets', undefined, 'timesheets')],
      },
    });
  }
  out.push({
    kind: 'group',
    group: {
      key: 'agent',
      label: 'Your AI agent',
      icon: Sparkles,
      entries: [e('proposals', 'Proposals', 'proposals', undefined, 'proposals'), e('inbox', 'Inbox', 'inbox', undefined, 'inbox_failed'), e('asks', 'Questions', 'asks'), e('agent-activity', 'What it did', 'agent-activity')],
    },
  });
  return out;
}

export const SETTINGS_ENTRY: NavSingle = { key: 'settings', label: 'Settings', icon: Settings, page: 'settings' };

/**
 * The list pages the sidebar offers to some roles and not others. A member
 * who reaches one their own sidebar does not offer (an old or shared link)
 * is told it is not part of their role, instead of the page loading and
 * failing. Detail pages (a document, an employee) check the record itself.
 */
const LISTED: ReadonlySet<Page> = new Set<Page>([
  'customers', 'suppliers', 'quotes', 'sales-orders', 'deliveries', 'invoices', 'credit-notes', 'purchase-orders', 'receipts', 'bills', 'supplier-credits',
  'items', 'stock', 'stock-changes', 'reorder', 'warehouses', 'builds', 'boms', 'payments', 'banks', 'accounts', 'journals', 'close', 'assets', 'budgets',
  'reports', 'report', 'employees', 'org', 'leave', 'claims', 'payroll', 'projects', 'timesheets',
]);

/** Whether this member may open `page` (always true for pages the sidebar does not list). */
export function offered(nav: NavItem[], page: Page): boolean {
  if (!LISTED.has(page)) return true;
  return nav.some((n) => (n.kind === 'single' ? n.item.page === page : n.group.entries.some((x) => x.page === page)));
}

/** The group a section key belongs to (to open it when its page is shown). */
export function groupOf(nav: NavItem[], key: string): string | null {
  for (const n of nav) if (n.kind === 'group' && n.group.entries.some((x) => x.key === key)) return n.group.key;
  return null;
}

export const PAYMENT_ICON = Banknote;

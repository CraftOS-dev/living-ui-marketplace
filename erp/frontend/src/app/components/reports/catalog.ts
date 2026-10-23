/**
 * Every report: its name in plain words, a one-line description, an icon,
 * its group in the gallery, and which controls it takes (a period or a
 * day, a comparison, a grouping). The gallery and the report page read it.
 */
import type { LucideIcon } from 'lucide-react';
import { BarChart3, BookText, Boxes, BriefcaseBusiness, HandCoins, Landmark, ListTree, PiggyBank, Receipt, Scale, ShoppingBag, TrendingUp, Users, Waves } from 'lucide-react';
import type { Me } from '../../lib/types.ts';
import { can, moduleOn } from '../../lib/me.ts';

export type ReportKind = 'pnl' | 'balance-sheet' | 'cash-flow' | 'trial-balance' | 'ledger' | 'aging' | 'sales' | 'purchases' | 'stock' | 'tax' | 'budget' | 'projects' | 'payroll';

export interface ReportDef {
  kind: ReportKind;
  title: string;
  term?: string | undefined;
  desc: string;
  icon: LucideIcon;
  group: string;
  /** A period (from/to), a day (as at), a fiscal year, or nothing. */
  range: 'period' | 'date' | 'year' | 'none';
  compare?: { value: string; label: string }[] | undefined;
  by?: { value: string; label: string }[] | undefined;
  /** Extra query for the gallery link (aging side, sales grouping). */
  query?: Record<string, string> | undefined;
  /** The CSV comes from reports.export. */
  serverCsv: boolean;
}

export const REPORTS: ReportDef[] = [
  {
    kind: 'pnl',
    title: 'Profit and loss',
    term: 'Income statement',
    desc: 'Did the business make money? Sales, costs and profit for a period.',
    icon: TrendingUp,
    group: 'How the business is doing',
    range: 'period',
    compare: [
      { value: 'none', label: 'No comparison' },
      { value: 'previous', label: 'Previous period' },
      { value: 'last_year', label: 'A year earlier' },
    ],
    by: [
      { value: 'total', label: 'Total' },
      { value: 'month', label: 'By month' },
    ],
    serverCsv: true,
  },
  { kind: 'cash-flow', title: 'Cash flow', desc: 'Where the cash came from and where it went: running, investing, financing.', icon: Waves, group: 'How the business is doing', range: 'period', serverCsv: false },
  { kind: 'budget', title: 'Budget against actual', desc: 'Each account against its plan, month by month.', icon: PiggyBank, group: 'How the business is doing', range: 'year', serverCsv: false },
  {
    kind: 'balance-sheet',
    title: 'Balance sheet',
    term: 'Financial position',
    desc: 'What the business owns, what it owes, and what is left for the owners, on a day.',
    icon: Scale,
    group: 'Where it stands',
    range: 'date',
    compare: [
      { value: 'none', label: 'No comparison' },
      { value: 'last_month', label: 'End of last month' },
      { value: 'last_year', label: 'A year earlier' },
    ],
    serverCsv: true,
  },
  { kind: 'trial-balance', title: 'Trial balance', desc: 'Every account with its debits and credits; the two sides must agree.', icon: ListTree, group: 'Where it stands', range: 'period', serverCsv: true },
  { kind: 'ledger', title: 'General ledger', desc: 'Every line posted in a period, account by account.', icon: BookText, group: 'Where it stands', range: 'period', serverCsv: true },
  { kind: 'aging', title: 'Who owes you', term: 'Receivables aging', desc: 'Customers with unpaid invoices, by how late they are.', icon: HandCoins, group: 'Money owed', range: 'date', query: { side: 'receivable' }, serverCsv: true },
  { kind: 'aging', title: 'What you owe', term: 'Payables aging', desc: 'Suppliers waiting to be paid, by how late the bills are.', icon: Receipt, group: 'Money owed', range: 'date', query: { side: 'payable' }, serverCsv: true },
  {
    kind: 'sales',
    title: 'Sales',
    desc: 'What you sold, to whom, with cost and margin.',
    icon: BarChart3,
    group: 'Selling and buying',
    range: 'period',
    by: [
      { value: 'customer', label: 'Customer' },
      { value: 'item', label: 'Item' },
      { value: 'category', label: 'Category' },
      { value: 'month', label: 'Month' },
    ],
    serverCsv: true,
  },
  {
    kind: 'purchases',
    title: 'Purchases',
    desc: 'What you bought, and from whom.',
    icon: ShoppingBag,
    group: 'Selling and buying',
    range: 'period',
    by: [
      { value: 'supplier', label: 'Supplier' },
      { value: 'item', label: 'Item' },
      { value: 'month', label: 'Month' },
    ],
    serverCsv: true,
  },
  { kind: 'stock', title: 'Stock value', term: 'Stock valuation', desc: 'What the stock on hand is worth at average cost, checked against the books.', icon: Boxes, group: 'Stock and tax', range: 'none', serverCsv: true },
  { kind: 'tax', title: 'Tax summary', desc: 'Tax collected on sales, tax paid on purchases, and the difference to pay.', icon: Landmark, group: 'Stock and tax', range: 'period', serverCsv: true },
  { kind: 'payroll', title: 'Payroll summary', desc: 'Each pay run: gross pay, deductions, employer costs and net pay.', icon: Users, group: 'People and projects', range: 'none', serverCsv: false },
  { kind: 'projects', title: 'Project profitability', desc: 'Revenue, costs and time per project, against its budget.', icon: BriefcaseBusiness, group: 'People and projects', range: 'none', serverCsv: false },
];

export const GROUPS = ['How the business is doing', 'Where it stands', 'Money owed', 'Selling and buying', 'Stock and tax', 'People and projects'];

/** Which reports this person can open (switched-on modules and rights). */
export function visibleReports(me: Me): ReportDef[] {
  return REPORTS.filter((r) => {
    if (!can(me, 'reports')) return false;
    if (r.kind === 'stock') return moduleOn(me, 'inventory');
    if (r.kind === 'payroll') return moduleOn(me, 'payroll') && can(me, 'payroll');
    if (r.kind === 'projects') return moduleOn(me, 'projects') && can(me, 'projects');
    if (r.kind === 'budget') return can(me, 'accounting');
    if (r.kind === 'purchases') return moduleOn(me, 'purchasing');
    if (r.kind === 'sales') return moduleOn(me, 'sales');
    return true;
  });
}

export function reportDef(kind: string, side?: string | null): ReportDef | undefined {
  if (kind === 'aging') return REPORTS.find((r) => r.kind === 'aging' && r.query?.['side'] === (side === 'payable' ? 'payable' : 'receivable'));
  return REPORTS.find((r) => r.kind === kind);
}


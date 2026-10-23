/**
 * Words for the money and books screens: payment methods, journal kinds,
 * bank account kinds, and where a journal's source record lives.
 */
import type { LucideIcon } from 'lucide-react';
import { Banknote, CreditCard, Landmark } from 'lucide-react';
import { navigate } from '../../lib/router.ts';
import type { Page } from '../../lib/router.ts';
import type { BankKind } from '../../lib/types/money.ts';

export const METHODS: { value: string; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
];

export function methodLabel(m: string): string {
  return METHODS.find((x) => x.value === m)?.label ?? m.replace(/_/g, ' ');
}

/** Journal kinds in plain words. */
export const JOURNAL_KIND: Record<string, string> = {
  manual: 'By hand',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  bill: 'Bill',
  supplier_credit: 'Supplier credit',
  delivery: 'Delivery',
  goods_receipt: 'Goods receipt',
  payment_in: 'Money in',
  payment_out: 'Money out',
  allocation_fx: 'Exchange difference',
  bank_entry: 'Bank entry',
  transfer: 'Transfer',
  reversal: 'Reversal',
  depreciation: 'Depreciation',
  opening: 'Opening balance',
  stock_change: 'Stock change',
  build: 'Build',
  payroll: 'Payroll',
  payroll_payment: 'Payroll paid',
  claim: 'Expense claim',
  claim_payment: 'Claim paid',
};

export function journalKind(k: string): string {
  return JOURNAL_KIND[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const BANK_KIND: Record<BankKind, { label: string; icon: LucideIcon }> = {
  bank: { label: 'Bank account', icon: Landmark },
  cash: { label: 'Cash', icon: Banknote },
  card: { label: 'Card', icon: CreditCard },
};

export function bankKind(k: string): { label: string; icon: LucideIcon } {
  return BANK_KIND[k as BankKind] ?? BANK_KIND.bank;
}

const SOURCE_PAGE: Record<string, Page> = {
  documents: 'doc',
  payments: 'payment',
  banks: 'bank',
  assets: 'asset',
  payroll_runs: 'payrun',
  expense_claims: 'claim',
  stock_changes: 'stock-change',
  builds: 'build',
  journals: 'journal',
  accounts: 'account',
};

/** Open the record a journal entry came from (null when it has none to open). */
export function openSource(entity: string, id: string): (() => void) | null {
  const page = SOURCE_PAGE[entity];
  if (page === undefined) return null;
  if (id === '') return page === 'asset' ? () => navigate('assets') : null;
  return () => navigate(page, { id });
}

/** Account types in plain words first, the accounting word second. */
export const TYPE_WORDS: Record<string, { plain: string; term: string; hint: string }> = {
  asset: { plain: 'What the business owns', term: 'Assets', hint: 'Money in the bank, what customers owe, stock, equipment' },
  liability: { plain: 'What the business owes', term: 'Liabilities', hint: 'Bills to pay, taxes due, loans, card balances' },
  equity: { plain: "The owners' share", term: 'Equity', hint: 'Money put in, profits kept over the years' },
  income: { plain: 'Money earned', term: 'Income', hint: 'Sales, services, other income' },
  expense: { plain: 'Money spent running the business', term: 'Expenses', hint: 'Cost of goods, wages, rent, fees' },
};

export const SUBTYPE_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank',
  receivable: 'Owed to you',
  inventory: 'Stock',
  current_asset: 'Other current asset',
  fixed_asset: 'Equipment and property',
  accumulated_depreciation: 'Depreciation so far',
  tax_receivable: 'Tax to claim back',
  other_asset: 'Other asset',
  payable: 'Owed to suppliers',
  current_liability: 'Other current liability',
  tax_payable: 'Tax to pay',
  payroll_liability: 'Payroll owed',
  long_term_liability: 'Long-term loan',
  equity: 'Owner equity',
  retained_earnings: 'Kept profits',
  opening_balance: 'Opening balances',
  revenue: 'Sales and services',
  other_income: 'Other income',
  cogs: 'Cost of sales',
  expense: 'Running costs',
  payroll_expense: 'Wages and benefits',
  depreciation: 'Depreciation',
  other_expense: 'Other expense',
};

export function subtypeLabel(s: string): string {
  return SUBTYPE_LABEL[s] ?? s.replace(/_/g, ' ');
}

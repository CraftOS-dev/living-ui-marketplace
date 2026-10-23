/**
 * Shapes the accounting screens read: the chart of accounts, journal
 * entries, the month-end close, fixed assets, budgets and every report.
 * Money is whole minor units of the base currency.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  system_key: string;
  control: boolean;
  parent: string;
  description: string;
  archived: boolean;
  balance?: number | undefined;
  bank?: string | undefined;
}

export interface AccountList {
  accounts: Account[];
  subtypes: Record<AccountType, string[]>;
  currency: string;
}

export interface LedgerLine {
  id: string;
  date: string;
  debit: number;
  credit: number;
  memo: string;
  currency: string;
  amount_cur: number;
  party: string;
  journal_id: string;
  journal: string;
  kind: string;
  entity: string;
  source: string;
  label: string;
  balance: number;
}

export interface AccountDetail extends Account {
  balance: number;
  bank: string;
  from: string;
  to: string;
  opening: number;
  debits: number;
  credits: number;
  closing: number;
  lines: LedgerLine[];
  total: number;
  months: { month: string; debit: number; credit: number; net: number }[];
  currency: string;
  can: { edit: boolean };
}

export interface JournalLineOut {
  account: { id: string; code: string; name: string; type: string } | null;
  debit: number;
  credit: number;
  party: { id: string; name: string } | null;
  employee: string;
  department: string;
  project: string;
  doc: string;
  memo: string;
  currency: string;
  amount_cur: number;
}

export interface Journal {
  id: string;
  number: string;
  date: string;
  kind: string;
  memo: string;
  source: { entity: string; id: string; label: string };
  state: 'posted' | 'reversed' | string;
  total: number;
  total_text: string;
  actor: 'person' | 'agent' | 'system' | string;
  who: string;
  approved_by: string;
  reverses: string;
  reversed_by: string;
  created: string;
  currency: string;
  lines?: JournalLineOut[] | undefined;
  can?: { reverse: boolean; propose_reverse: boolean } | undefined;
}

export interface JournalList {
  journals: Journal[];
  total: number;
  currency: string;
}

export interface CloseCheck {
  key: 'drafts' | 'bank' | 'grni' | 'claims' | 'payroll' | 'depreciation' | 'trial_balance' | 'proposals' | string;
  label: string;
  count: number;
  ok: boolean;
  detail: string;
}

export interface CloseStatus {
  month: string;
  from: string;
  to: string;
  closed: boolean;
  soft_lock_date: string;
  hard_lock_date: string;
  checks: CloseCheck[];
  ready: boolean;
  net_profit: number;
  revenue: number;
  currency: string;
  months: { month: string; closed: boolean }[];
}

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface Asset {
  id: string;
  number: string;
  name: string;
  cost: number;
  salvage: number;
  start: string;
  life_months: number;
  status: 'active' | 'disposed';
  depreciated: number;
  book_value: number;
  last_month: string;
  disposed_on: string;
  monthly: number;
  asset_account: AccountRef | null;
  accumulated_account: AccountRef | null;
  expense_account: AccountRef | null;
  department: string;
  notes: string;
}

export interface AssetDetail extends Asset {
  schedule: { month: string; amount: number; accumulated: number; book_value: number; posted: boolean }[];
  currency: string;
}

export interface AssetList {
  assets: Asset[];
  cost: number;
  book_value: number;
  currency: string;
}

export interface BudgetRow {
  id: string;
  code: string;
  name: string;
  type: 'income' | 'expense';
  budget: number[];
  actual: number[];
  total_budget: number;
  total_actual: number;
  variance: number;
}

export interface BudgetReport {
  report: 'budget';
  year: number;
  months: string[];
  currency: string;
  accounts: BudgetRow[];
}

/* -------------------------------------------------------------- reports */

export interface PnlColumn {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface PnlSection {
  key: 'revenue' | 'cogs' | 'opex' | 'other_income' | 'other_expense' | string;
  label: string;
  accounts: { id: string; code: string; name: string; values: number[] }[];
  totals: number[];
}

export interface PnlReport {
  report: 'pnl';
  from: string;
  to: string;
  columns: PnlColumn[];
  currency: string;
  sections: PnlSection[];
  gross: number[];
  operating: number[];
  net: number[];
}

export interface BsSection {
  key: string;
  label: string;
  side: 'assets' | 'liabilities' | 'equity';
  accounts: { id: string; code: string; name: string; value: number; computed?: boolean | undefined }[];
  total: number;
}

export interface BsAt {
  date: string;
  sections: BsSection[];
  assets: number;
  liabilities: number;
  equity: number;
  balanced: boolean;
  difference: number;
  current_earnings: number;
  fiscal_year_start: string;
}

export interface BsReport {
  report: 'balance-sheet';
  currency: string;
  current: BsAt;
  compare?: BsAt | undefined;
}

export interface FlowPart {
  total: number;
  rows: { id: string; code: string; name: string; value: number }[];
}

export interface CashFlowReport {
  report: 'cash-flow';
  from: string;
  to: string;
  currency: string;
  net_income: number;
  depreciation: number;
  working_capital: FlowPart;
  operating: number;
  investing: FlowPart;
  financing: FlowPart;
  net_change: number;
  opening_cash: number;
  closing_cash: number;
  actual_change: number;
  unexplained: number;
}

export interface TbRow {
  id: string;
  code: string;
  name: string;
  type: string;
  opening_debit: number;
  opening_credit: number;
  debit: number;
  credit: number;
  closing_debit: number;
  closing_credit: number;
}

export interface TbReport {
  report: 'trial-balance';
  from: string;
  to: string;
  currency: string;
  accounts: TbRow[];
  totals: Omit<TbRow, 'id' | 'code' | 'name' | 'type'>;
  balanced: boolean;
}

export interface GlLine {
  date: string;
  code: string;
  account: string;
  debit: number;
  credit: number;
  memo: string;
  party: string;
  journal: string;
  kind: string;
  label: string;
  entity: string;
  source: string;
}

export interface GlReport {
  report: 'ledger';
  from: string;
  to: string;
  currency: string;
  lines: GlLine[];
  total: number;
}

export type Bucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';

export interface AgingParty {
  id: string;
  name: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  over90: number;
  credits: number;
  total: number;
  documents: { id: string; number: string; date: string; due_date: string; open: number; currency: string; base: number; days: number; bucket: Bucket }[];
}

export interface AgingReport {
  report: 'aging';
  side: 'receivable' | 'payable';
  date: string;
  currency: string;
  parties: AgingParty[];
  totals: Record<Bucket | 'credits' | 'total', number>;
}

export interface SalesRow {
  key: string;
  label: string;
  revenue: number;
  documents: number;
  qty?: number | undefined;
  cost?: number | undefined;
  margin?: number | undefined;
  margin_pct?: number | undefined;
}

export interface SalesReport {
  report: 'sales' | 'purchases';
  by: string;
  from: string;
  to: string;
  currency: string;
  rows: SalesRow[];
  total: number;
  cost?: number | null | undefined;
  margin?: number | null | undefined;
  cost_estimated: boolean;
}

export interface StockReport {
  report: 'stock';
  warehouse: { id: string; name: string } | null;
  currency: string;
  items: { id: string; sku: string; name: string; unit: string; category: string; qty: number; value: number; avg_cost: string }[];
  total: number;
  book: number | null;
  difference: number | null;
}

export interface TaxReport {
  report: 'tax';
  from: string;
  to: string;
  currency: string;
  taxes: { id: string; code: string; name: string; recoverable: boolean; sales_taxable: number; sales_tax: number; purchase_taxable: number; purchase_tax: number }[];
  collected: number;
  claimable: number;
  other_collected: number;
  other_claimable: number;
  net: number;
}

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  billing: string;
  customer: { id: string; name: string } | null;
  budget: number;
  revenue: number;
  spent: number;
  time_cost: number;
  hours: number;
  budget_used_pct: number | null;
}

export interface PayRun {
  id: string;
  number: string;
  month: string;
  month_name: string;
  status: string;
  count: number;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  cost: number;
  pay_date: string;
  currency: string;
}

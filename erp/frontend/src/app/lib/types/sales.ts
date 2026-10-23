/**
 * Shapes of the sales and purchasing operations (docs.*, parties.*,
 * contacts.*). Money is whole minor units of `currency` (or of the base
 * currency for fields ending in `_base`, balances and aging). Unit prices
 * arrive as text in major units ("12.50"), discounts and tax rates as
 * percent text ("10", "9").
 */
import type { DocType } from '../router.ts';
import type { Actor } from '../types.ts';

export interface DocRow {
  id: string;
  type: DocType;
  number: string;
  state: string;
  status: string;
  date: string;
  due_date: string;
  expected_date: string;
  valid_until: string;
  days_overdue: number;
  currency: string;
  total: number;
  total_base: number;
  balance: number;
  paid: number;
  reference: string;
  lines_count: number;
  prepared_actor: Actor | string;
  fulfil_status: string;
  bill_status: string;
  party: { id: string; name: string };
}

export interface DocList {
  docs: DocRow[];
  total: number;
  total_base: number;
  open_base: number;
  counts: Record<string, number>;
  currency: string;
}

export interface DocItemRef {
  id: string;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  fractional: boolean;
  photo: string;
}

export interface DocLine {
  id: string;
  sort: number;
  item: DocItemRef | null;
  description: string;
  qty: number;
  unit: string;
  unit_price: string;
  unit_price_e4: number;
  discount: string;
  discount_bp: number;
  tax: { id: string; code: string; name: string; rate: string } | null;
  tax_rate_bp: number;
  account: { id: string; code: string; name: string } | null;
  net: number;
  tax_amount: number;
  total: number;
  net_base: number;
  project: string;
  department: string;
  source_line: string;
  qty_fulfilled: number;
  qty_invoiced: number;
  unit_cost: number;
  cost_value: number;
}

export interface FlowStep {
  id: string;
  type: DocType;
  number: string;
  state: string;
  status: string;
  date: string;
  total: number;
  currency: string;
}

export interface DocAllocation {
  id: string;
  kind: 'payment' | 'credit' | string;
  amount: number;
  currency: string;
  date: string;
  fx_diff: number;
  actor: Actor | string;
  payment: { id: string; number: string; date: string; method: string; reference: string } | null;
  credit: { id: string; number: string; date: string; type: string } | null;
  document: { id: string; number: string; date: string; type: string } | null;
}

export interface DocCan {
  edit: boolean;
  post: boolean;
  propose: boolean;
  confirm: boolean;
  void: boolean;
  convert: DocType[];
  delete: boolean;
  pay: boolean;
  cancel: boolean;
}

export type DocNext = 'approval' | 'send' | 'confirm' | 'post' | 'convert' | 'deliver' | 'invoice' | 'receive' | 'bill' | 'pay' | 'apply' | '';

export interface DocDetail {
  id: string;
  type: DocType;
  type_label: string;
  side: 'sales' | 'purchase';
  number: string;
  label: string;
  state: string;
  status: string;
  next: DocNext;
  party: { id: string; code: string; name: string; email: string; phone: string } | null;
  attention: string;
  date: string;
  due_date: string;
  days_overdue: number;
  valid_until: string;
  expected_date: string;
  currency: string;
  base_currency: string;
  fx_rate: string;
  prices_include_tax: boolean;
  reference: string;
  terms: { id: string; name: string; days: number } | null;
  warehouse: { id: string; code: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  department: { id: string; name: string } | null;
  moves_stock: boolean;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  total_base: number;
  paid: number;
  balance: number;
  fulfil_status: string;
  bill_status: string;
  notes: string;
  internal_note: string;
  agent_note: string;
  billing_address: string;
  shipping_address: string;
  prepared_actor: Actor | string;
  prepared_by: string;
  posted_by: string;
  posted_at: string;
  voided_by: string;
  voided_at: string;
  void_reason: string;
  sent_at: string;
  created: string;
  updated: string;
  lines: DocLine[];
  taxes: { id: string; name: string; code: string; rate: string; net: number; amount: number }[];
  flow: FlowStep[];
  allocations: DocAllocation[];
  journal: { id: string; number: string } | null;
  proposals: { id: string; title: string; op: string; created: string }[];
  agent_fields: string[];
  can: DocCan;
}

/* --------------------------------------------------------------- parties */

export interface PartyRow {
  id: string;
  code: string;
  name: string;
  is_customer: boolean;
  is_supplier: boolean;
  email: string;
  phone: string;
  contact_name: string;
  currency: string;
  archived: boolean;
  receivable: number;
  payable: number;
  overdue_receivable: number;
  overdue_payable: number;
  last_activity: string;
}

export interface PartyList {
  parties: PartyRow[];
  total: number;
  counts: { customers: number; suppliers: number; archived: number; owing: number; overdue: number };
  totals: { receivable: number; payable: number; overdue_receivable: number; overdue_payable: number };
  currency: string;
}

export interface Aging {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  over90: number;
}

export interface PartyContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  primary: boolean;
}

export interface TaxRef {
  id: string;
  code: string;
  name: string;
}

export interface PartyDetail {
  id: string;
  code: string;
  name: string;
  is_customer: boolean;
  is_supplier: boolean;
  email: string;
  phone: string;
  website: string;
  tax_id: string;
  billing_address: string;
  shipping_address: string;
  contact_name: string;
  terms: { id: string; name: string } | null;
  currency: string;
  credit_limit: number;
  sale_tax: TaxRef | null;
  purchase_tax: TaxRef | null;
  notes: string;
  archived: boolean;
  created: string;
  receivable: number;
  payable: number;
  aging_receivable: Aging;
  aging_payable: Aging;
  contacts: PartyContact[];
  sales_this_year: number;
  purchases_this_year: number;
  months: { month: string; value: number }[];
  recent: { id: string; type: DocType; number: string; state: string; date: string; due_date: string; total: number; balance: number; currency: string }[];
  unallocated: { id: string; direction: 'in' | 'out'; number: string; date: string; unallocated: number; currency: string }[];
  open: { invoices: number; bills: number; orders: number; quotes: number };
  base_currency: string;
  effective_terms: { id: string; name: string; days: number; end_of_month: boolean } | null;
  effective_sale_tax: (TaxRef & { rate_bp: number }) | null;
  effective_purchase_tax: (TaxRef & { rate_bp: number }) | null;
  last_activity: string;
  can: { edit: boolean };
}

export interface StatementLine {
  date: string;
  kind: string;
  label: string;
  entity: string;
  source: string;
  memo: string;
  journal: string;
  amount: number;
  balance: number;
}

export interface Statement {
  party: { id: string; name: string; code: string; email: string; billing_address: string };
  side: 'receivable' | 'payable';
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: StatementLine[];
  currency: string;
  company: string;
}

/* ----------------------------------------------------------- references */

export interface TaxRow {
  id: string;
  code: string;
  name: string;
  rate: string;
  rate_bp: number;
  scope: 'sales' | 'purchase' | 'both' | string;
  archived: boolean;
}

export interface TermsRow {
  id: string;
  name: string;
  days: number;
  end_of_month: boolean;
}

export interface CurrencyRow {
  code: string;
  name: string;
  rate: string;
  rate_e8: number;
  base: boolean;
  archived: boolean;
}

export interface ItemRow {
  id: string;
  name: string;
  sku: string;
  kind: string;
  unit: string;
  on_hand: number;
  available: number;
  fractional: boolean;
  sale_price: string;
  purchase_price: string;
}

export interface PaymentRow {
  id: string;
  number: string;
  date: string;
  amount: number;
  amount_base: number;
  currency: string;
  method: string;
  reference: string;
  state: string;
  unallocated: number;
  bank: string;
  party: { id: string; name: string };
  prepared_actor: string;
}

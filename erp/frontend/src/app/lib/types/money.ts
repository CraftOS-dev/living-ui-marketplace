/**
 * Shapes the money screens read: payments, allocations, bank accounts,
 * statement lines, imports and reconciliation suggestions. Money is whole
 * minor units of `currency` (the payment's or the bank's).
 */
import type { Ref } from '../types.ts';

export type Direction = 'in' | 'out';
export type PayMethod = 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'online' | 'other';
export type PayState = 'draft' | 'posted' | 'void';

export interface PaymentRow {
  id: string;
  number: string;
  state: PayState;
  date: string;
  currency: string;
  amount: number;
  amount_base: number;
  unallocated: number;
  method: PayMethod | string;
  reference: string;
  prepared_actor: string;
  party: Ref;
  bank: string;
  /** Added on screen when lists of both directions are merged. */
  direction?: Direction | undefined;
}

export interface PaymentList {
  payments: PaymentRow[];
  total: number;
  total_base: number;
  counts: Partial<Record<PayState | 'unallocated', number>>;
  currency: string;
}

export interface PaymentAllocation {
  id: string;
  document: { id: string; number: string; type: string; date: string; total: number; balance: number } | null;
  amount: number;
  fx_diff: number;
  date: string;
}

export interface OpenDoc {
  id: string;
  number: string;
  date: string;
  due_date: string;
  total: number;
  balance: number;
}

export interface Payment {
  id: string;
  direction: Direction;
  number: string;
  label: string;
  state: PayState;
  party: { id: string; name: string; code: string } | null;
  bank: { id: string; name: string; kind: string } | null;
  date: string;
  currency: string;
  fx_rate: string;
  amount: number;
  amount_base: number;
  amount_text: string;
  allocated: number;
  unallocated: number;
  method: PayMethod | string;
  reference: string;
  memo: string;
  agent_note: string;
  prepared_actor: string;
  prepared_by: string;
  posted_by: string;
  posted_at: string;
  voided_by: string;
  voided_at: string;
  void_reason: string;
  created: string;
  allocations: PaymentAllocation[];
  planned: { doc: string; amount: number }[] | null;
  open_docs: OpenDoc[];
  journal: { id: string; number: string } | null;
  bank_line: { id: string; date: string; description: string } | null;
  proposals: { id: string; title: string }[];
  can: { edit: boolean; post: boolean; void: boolean; apply: boolean };
}

/** A document row from docs.list (the parts the money screens use). */
export interface DocRow {
  id: string;
  type: string;
  number: string;
  state: string;
  status: string;
  date: string;
  due_date: string;
  currency: string;
  total: number;
  total_base: number;
  balance: number;
  paid: number;
  days_overdue: number;
  reference: string;
  party: Ref;
}

export interface DocList {
  docs: DocRow[];
  total: number;
  currency: string;
}

export type BankKind = 'bank' | 'cash' | 'card';

export interface Bank {
  id: string;
  name: string;
  kind: BankKind;
  currency: string;
  bank_name: string;
  account_number: string;
  color: number;
  archived: boolean;
  account: { id: string; code: string; name: string } | null;
  /** Present for people with Banking rights. */
  balance?: number | undefined;
  unmatched?: number | undefined;
  last_statement_date?: string | undefined;
  statement_balance?: number | null | undefined;
}

export interface BankList {
  banks: Bank[];
  total?: number | undefined;
  currency: string;
}

export interface BankDetail extends Bank {
  balance: number;
  unmatched: number;
  last_statement_date: string;
  statement_balance: number | null;
  history: { date: string; balance: number }[];
  recent: { date: string; amount: number; memo: string; journal: string; kind: string; entity: string; source: string; label: string }[];
  can: { edit: boolean; full: boolean };
}

export type LineStatus = 'unmatched' | 'matched' | 'ignored';

export interface BankLine {
  id: string;
  bank: string;
  date: string;
  description: string;
  reference: string;
  amount: number;
  balance: number;
  status: LineStatus;
  match: { kind: 'payment' | 'journal'; id: string; label: string; party: string } | null;
  suggestion: unknown;
  matched_by: string;
  matched_at: string;
  import: string;
}

export interface BankLines {
  lines: BankLine[];
  total: number;
  money_in: number;
  money_out: number;
  counts: Partial<Record<LineStatus, number>>;
  bank: Bank;
}

export interface Suggestion {
  kind: 'payment' | 'journal' | 'invoice' | 'bill';
  id: string;
  label: string;
  party: string;
  party_id?: string | undefined;
  date: string;
  amount: number;
  score: number;
  why: string;
}

export interface Suggest {
  line: BankLine;
  suggestions: Suggestion[];
}

export interface ImportColumn {
  index: number;
  name: string;
  kind: 'date' | 'amount' | 'text' | 'empty' | string;
  sample: string[];
}

export interface ImportMapping {
  date_col: number | null;
  amount_col: number | null;
  debit_col: number | null;
  credit_col: number | null;
  description_col: number | null;
  reference_col: number | null;
  delimiter: string;
  has_header: boolean;
  date_format: string;
  decimal: '.' | ',' | string;
  flip: boolean;
}

export interface ImportPreview {
  import_id: string;
  filename: string;
  status: string;
  currency: string;
  mapping: ImportMapping;
  columns: ImportColumn[];
  date_formats: string[];
  counts: { total: number; new: number; duplicate: number; invalid: number };
  money_in: number;
  money_out: number;
  date_from: string;
  date_to: string;
  rows: { row: number; date: string; amount: number | null; description: string; reference: string; status: 'new' | 'duplicate' | 'invalid'; problem: string }[];
}

export interface ImportRecord {
  id: string;
  filename: string;
  status: 'previewed' | 'imported' | 'undone' | string;
  rows: number;
  added: number;
  skipped: number;
  created: string;
  bank: string;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  rate: string;
  rate_e8: number;
  rate_date: string;
  base: boolean;
  archived: boolean;
}

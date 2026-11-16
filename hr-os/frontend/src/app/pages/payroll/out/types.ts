/** Shapes of the payroll-out operations' answers (pb/pb_hooks/lib_payroll_out*.js, lib_payroll_docs.js). */
import type { AgentAsk } from '../../../components/agent.tsx';

export interface RunView {
  id: string;
  number: string;
  label: string;
  kind: string;
  status: string;
  entity: string;
  entity_name: string;
  country: string;
  currency: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  employee_count: number;
  gross_minor: number;
  deductions_minor: number;
  employer_minor: number;
  net_minor: number;
  locked_at: string;
  paid_at: string;
  year_end: boolean;
}

/** Net pay of the run, less held pay, plus released holds = bank + cash + cheques. */
export interface PayTotals {
  net_minor: number;
  held_minor: number;
  held_count: number;
  released_minor: number;
  released_count: number;
  to_pay_minor: number;
  bank_minor: number;
  bank_people: number;
  cash_minor: number;
  cash_count: number;
  cheque_minor: number;
  cheque_count: number;
  balanced: boolean;
}

export interface OverviewRun extends RunView {
  methods: Record<string, { count: number; total_minor: number }>;
  totals: PayTotals;
  bank_file: { id: string; status: string; format: string; exported_at: string; reference: string } | null;
  journal: boolean;
  next: 'export' | 'confirm' | 'mark_paid' | 'journal' | 'done';
}

export interface Problem {
  ref: string;
  employee: string;
  name: string;
  field: string;
  code: string;
  message: string;
}

export interface PayerField {
  key: string;
  label: string;
  required?: boolean;
  pattern?: string;
  max?: number;
  enum?: string[];
  default?: string;
}

export interface FormatOption {
  key: string;
  type: 'boolean' | 'text' | 'enum';
  default: unknown;
  values?: string[];
  label: string;
}

export interface FormatInfo {
  code: string;
  name: string;
  country: string;
  currency: string;
  extension: string;
  official: boolean;
  label: string;
  layout: string;
  payer_fields: PayerField[];
  options: FormatOption[];
}

export interface BankPart {
  bank_account: string;
  label: string;
  bank_name: string;
  bank_code: string;
  branch_code: string;
  number_masked: string;
  amount_minor: number;
}

export interface BankPerson {
  payslip: string;
  employee: string;
  employee_number: string;
  name: string;
  amount_minor: number;
  kind: string;
  parts: BankPart[];
  problems: Problem[];
  warnings: { code: string; message: string }[];
}

export interface ItemRow {
  payslip: string;
  employee: string;
  employee_number: string;
  name: string;
  amount_minor: number;
  currency: string;
  kind: string;
}

export interface BankFile {
  id: string;
  payrun: string;
  format: string;
  filename: string;
  total_minor: number;
  currency: string;
  count: number;
  hash: string;
  status: 'exported' | 'uploaded' | 'superseded' | 'void';
  reference: string;
  paid_on: string;
  exported_by: string;
  exported_at: string;
  uploaded_by: string;
  uploaded_at: string;
  warnings: { ref?: string; code: string; message: string }[];
  downloads: number;
}

export interface RunPayout {
  run: RunView;
  format: string;
  format_info: FormatInfo;
  formats: string[];
  bank: BankPerson[];
  cash: ItemRow[];
  cheque: ItemRow[];
  held: number;
  totals: PayTotals;
  check: { ok: boolean; problems: Problem[]; warnings: { ref?: string; code: string; message: string }[]; count?: number; total_minor?: number };
  payer_missing: { key: string; label: string }[];
  files: BankFile[];
  lists: { id: string; method: string; status: string; count: number }[];
  journals: { id: string; format: string; filename: string; debit_minor: number; credit_minor: number; exported_at: string; exported_by: string }[];
  can: { export: boolean; confirm: boolean; mark_paid: boolean };
}

export interface CashList {
  run: RunView;
  method: 'cash' | 'cheque';
  rows: (ItemRow & { cheque_number: string; handed: boolean })[];
  total_minor: number;
  currency: string;
  status: 'open' | 'done';
  denominations: { value_minor: number; count: number }[];
}

export interface JournalLine {
  account: string;
  description: string;
  debit_minor: number;
  credit_minor: number;
  cost_center: string;
  department: string;
}

export interface JournalPreview {
  run: RunView;
  format: string;
  formats: { code: string; name: string; label: string }[];
  lines: JournalLine[];
  debit_minor: number;
  credit_minor: number;
  balanced: boolean;
  unset: { role: string; label: string }[];
  problems: { payslip: string; message: string }[];
  csv: string;
}

export interface Filing {
  id: string;
  entity: string;
  entity_name: string;
  country: string;
  kind: string;
  name: string;
  form: string;
  pack: string;
  frequency: string;
  period: string;
  period_start: string;
  period_end: string;
  due_day: string;
  due_manual: boolean;
  due_rule: string;
  days_left: number | null;
  overdue: boolean;
  status: 'todo' | 'prepared' | 'submitted' | 'accepted' | 'rejected' | 'not_needed' | 'amend';
  amount_minor: number;
  currency: string;
  payee: string;
  payruns: string[];
  reference: string;
  note: string;
  prepared_at: string;
  prepared_by: string;
  submitted_on: string;
  submitted_by: string;
  result_at: string;
  has_file: boolean;
  source: string;
  documents: boolean;
}

export interface Worksheet {
  code: string;
  codes: { code: string; name: string; kind: string; amount: number; people: number }[];
  people: { employment: string; employee_number: string; name: string; by_code: Record<string, number>; total_minor: number }[];
  runs: { id: string; number: string; pay_date: string; kind: string }[];
  employee_minor: number;
  employer_minor: number;
  total_minor: number;
  currency: string;
}

export interface FilingDetail extends Filing {
  worksheet: Worksheet;
  worksheet_frozen: boolean;
  rule: { period: string; due: unknown; adjust: string; choice: string; choice_pref: string; choice_options: string[] } | null;
}

export interface FilingList {
  filings: Filing[];
  total: number;
  today: string;
  counts: { overdue: number; due_7: number; open: number; rejected: number; no_due: number };
}

export interface DocBox {
  key: string;
  label: string;
}

export interface DocPerson {
  employment: string;
  employee: string;
  number: string;
  name: string;
  legal_name: string;
  kana: string;
  address: Record<string, string>;
  municipality: string;
  start_day: string;
  end_day: string;
  id: { type: string; masked: string } | null;
  profile?: Record<string, unknown>;
}

export interface DocRow {
  employment: string;
  boxes: Record<string, number>;
  quarters?: Record<string, Record<string, number>>;
  state?: Record<string, number>;
  yea_done?: boolean;
  person: DocPerson;
}

export interface Employer {
  id: string;
  name: string;
  legal_name: string;
  country: string;
  currency: string;
  address: Record<string, string>;
  tax_ids: Record<string, string>;
}

export interface YearDoc {
  doc: { code: string; name: string; form: string; country: string; per: string; boxes: DocBox[]; note: string; quarters: boolean; state: boolean; yea: boolean; list: boolean };
  year: number;
  range: { start: string; end: string; label: string };
  employer: Employer;
  currency: string;
  rows: DocRow[];
  totals: Record<string, number>;
  count: number;
  groups: { municipality: string; count: number; totals: Record<string, number> }[] | null;
  warnings: { code: string; message: string }[];
}

export interface YearOverviewRow {
  entity: string;
  entity_name: string;
  country: string;
  doc: string;
  name: string;
  form: string;
  per: string;
  year: number;
  label: string;
  start: string;
  end: string;
  people: number;
  locked_runs: number;
  open_runs: number;
  issued: number;
}

/** packs.list's compact row; packs.get carries the rest. */
export type PackListRow = Pick<PackRow, 'id' | 'code' | 'country' | 'name' | 'version' | 'status' | 'effective_from' | 'effective_to' | 'vectors_passed' | 'vectors_total' | 'in_use' | 'source'>;

export interface PackRow {
  id: string;
  code: string;
  country: string;
  region: string;
  name: string;
  version: string;
  effective_from: string;
  effective_to: string;
  status: 'draft' | 'tested' | 'active' | 'retired';
  source: string;
  vectors_passed: number;
  vectors_total: number;
  tested_at: string;
  activated_at: string;
  activated_by: string;
  ship: string;
  sources: number;
  official_vectors: number;
  in_use: number;
  updated: string;
}

export interface PackList {
  in_use: boolean;
  left_out: number;
  packs: PackListRow[];
  countries: { country: string; name: string; packs: number; active: number; drafts: number }[];
  /** Packs your AI agent is asked about now (an open pack_update_draft or rule_update_check). */
  asks: (AgentAsk & { pack: string; code: string; version: string })[];
}

export interface PackStep {
  var?: string;
  code?: string;
  check?: string;
  name?: string;
  kind?: string;
  stage?: string;
  expr?: string;
  amount?: string;
  when?: string;
  else?: string;
  round?: { mode: string; step: number };
  tags?: string[];
  payee?: string;
  filing?: string;
  explain?: string;
  severity?: string;
  issue?: string;
  message?: string;
}

export interface PackDiff {
  meta: { field: string; before: unknown; after: unknown }[];
  tables: { name: string; change: string; rows_before?: number; rows_after?: number; changed_rows?: { row: number | string; before: unknown; after: unknown }[] }[];
  steps: { key: string; change: string; before?: PackStep; after?: PackStep; fields?: { field: string; before: unknown; after: unknown }[] }[];
  year_end_steps: { key: string; change: string; fields?: { field: string; before: unknown; after: unknown }[] }[];
  profile_fields: { key: string; change: string; label: string }[];
  vectors: { before: number; after: number; added: string[]; removed: string[] };
  sources: { added: string[]; removed: string[] };
  changes: number;
}

export interface PackDetail {
  pack: PackRow & {
    notes: string;
    sources: { title: string; url: string; retrieved: string; note?: string }[];
    tax_year: { start?: string };
    requires: string[];
    currency: string;
    profile_fields: { key: string; label: string; type: string; scope?: string; default?: unknown; required?: boolean; form?: string; help?: string; options?: { value: string; label: string }[] }[];
    tags: { tag: string; label: string }[];
    tables: { name: string; type: string; rows: number; preview: unknown[]; default: unknown }[];
    steps: PackStep[];
    year_end_steps: PackStep[];
    filings: { code: string; name: string; frequency: string; due_rule: string; form: string }[];
    documents: { code: string; name: string; year_end: boolean }[];
    vectors: { name: string; source: string; reference: string; expect: Record<string, number>; passed: boolean; failure: Record<string, unknown> | null }[];
  };
  check: { ok: boolean; errors: number; warnings: number; problems: { level: string; message: string; code?: string }[]; passed: number; total: number };
  versions: PackRow[];
  against: PackRow | null;
  diff: PackDiff | null;
  can: { activate: boolean; retire: boolean };
  /** The open ask of your AI agent on this pack, else its latest one (null when never asked). */
  agent: AgentAsk | null;
  /** When your AI agent last finished a check or draft of this pack ('' when never). */
  last_checked: string;
}

export interface PayoutSettings {
  entity: string;
  entity_name: string;
  country: string;
  currency: string;
  bank_format: string;
  payer: Record<string, Record<string, string>>;
  bank_options: Record<string, Record<string, unknown>>;
  gl: Record<string, unknown>;
  journal_format: string;
  filing_prefs: Record<string, string>;
  formats: FormatInfo[];
  all_formats: { code: string; name: string; country: string; official: boolean; label: string }[];
  payer_effective: Record<string, string>;
}

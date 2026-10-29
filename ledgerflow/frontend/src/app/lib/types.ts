/** Shapes the operations return (see pb/pb_hooks). Money is in minor units. */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type Actor = 'user' | 'agent' | 'rule' | 'import' | 'recurring' | 'system';
export type Confidence = 'high' | 'medium' | 'low';
export type Method = 'manual' | 'rule' | 'match' | 'memory' | 'agent' | 'transfer' | 'recurring' | 'document';

export interface Currency {
  code: string;
  exponent: number;
  name: string;
  symbol: string;
}

export interface Policy {
  agent_auto_post: boolean;
  ceiling: string;
  auto_methods: string[];
  house_rules: string;
}

export interface Settings {
  id: string;
  business_name: string;
  entity: 'business' | 'personal' | 'both';
  home_currency: string;
  fiscal_year_start: number;
  region: string;
  region_name: string;
  rounding: 'line' | 'document';
  lock_date: string;
  agent_lock_date: string;
  tax_lock_date: string;
  invoice_prefix: string;
  invoice_next: number;
  credit_prefix: string;
  credit_next: number;
  payment_terms: number;
  business_address: string;
  business_email: string;
  business_tax_id: string;
  invoice_footer: string;
  policy: Policy;
  ui: Record<string, unknown>;
  agent_categorize: boolean;
  setup_done: boolean;
}

export interface Region {
  id: string;
  name: string;
  codes: { code: string; name: string; rate: string }[];
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  parent: string;
  currency: string;
  description: string;
  system: string;
  cashflow: string;
  archived: boolean;
  sort: number;
  bank_name: string;
  bank_number: string;
  balance: number | null;
  balance_ccy?: number | undefined;
  debit_normal?: boolean | undefined;
  inbox?: number | undefined;
}

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  rate: string;
  scope: 'sales' | 'purchases' | 'both';
  group: 'standard' | 'reduced' | 'zero' | 'exempt' | 'reverse' | 'outside';
  account: string;
  description: string;
  archived: boolean;
  sort: number;
}

export interface Contact {
  id: string;
  name: string;
  kind: 'customer' | 'vendor' | 'both' | 'other';
  email: string;
  phone: string;
  address: string;
  tax_id: string;
  currency: string;
  terms: number;
  default_account: string;
  default_tax: string;
  aliases: string[];
  notes: string;
  archived: boolean;
  created: string;
  receivable?: number | undefined;
  payable?: number | undefined;
  overdue?: number | undefined;
}

export interface Suggestion {
  method: Method | string;
  confidence?: Confidence | undefined;
  account?: string | undefined;
  splits?: { account: string; percent: string }[] | null | undefined;
  transfer_account?: string | undefined;
  contact?: string | undefined;
  contact_name?: string | undefined;
  tax_code?: string | undefined;
  payee?: string | undefined;
  memo?: string | undefined;
  narration?: string | undefined;
  match?: { type: 'posting' | 'document' | 'line'; id: string; txn?: string; date?: string; label?: string; number?: string; kind?: string } | undefined;
  alternatives?: { type: string; id: string; date?: string; number?: string }[] | undefined;
  rule?: string | undefined;
  rule_name?: string | undefined;
  auto_post?: boolean | undefined;
  reason?: string | undefined;
  similar?: { line?: string; txn?: string; date: string; amount: number; account: string; description?: string }[] | undefined;
  by?: 'system' | 'rule' | 'agent' | 'user' | undefined;
  run?: string | undefined;
  final?: { account: string; contact: string; tax_code: string } | undefined;
}

export interface Line {
  id: string;
  account: string;
  import: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  payee: string;
  bank_id: string;
  status: 'new' | 'proposed' | 'posted' | 'matched' | 'excluded';
  txn: string;
  suggestion: Suggestion | null;
  note: string;
  agent_state: '' | 'waiting' | 'working' | 'done';
  raw: string;
  created: string;
  similar?: { id: string; date: string; amount: number; description: string; txn: string; account: string }[] | undefined;
  transaction?: TxnDetail | null | undefined;
  files?: FileRec[] | undefined;
}

export interface ImportRec {
  id: string;
  account: string;
  file_name: string;
  format: string;
  period_from: string;
  period_to: string;
  balances: { opening?: number | undefined; closing?: number | undefined; date?: string | undefined };
  line_count: number;
  new_count: number;
  dup_count: number;
  added_by: string;
  run: string;
  status: 'done' | 'undone';
  created: string;
}

export interface Mapping {
  header: boolean;
  date: number;
  amount: number;
  debit: number;
  credit: number;
  description: number[];
  payee: number;
  bank_id: number;
  balance: number;
  flip: boolean;
  date_order: 'auto' | 'dmy' | 'mdy';
  delimiter?: string | undefined;
  skip?: number | undefined;
}

export interface Preview {
  account: string;
  format: string;
  currency: string;
  needs_mapping: boolean;
  header: string[] | null;
  mapping: Mapping | null;
  sample: string[][] | null;
  profile: string;
  date_order_used: string;
  date_order_ambiguous: boolean;
  period_from: string;
  period_to: string;
  balances: { opening?: number | undefined; closing?: number | undefined; date?: string | undefined };
  count: number;
  new_count: number;
  dup_count: number;
  already_imported: { id: string; date: string; file_name: string } | null;
  lines: { date: string; amount: number; description: string; payee: string; duplicate: boolean }[];
}

export interface Posting {
  id: string;
  txn: string;
  date: string;
  status: string;
  account: string;
  amount: number;
  currency: string;
  home_amount: number;
  rate: string;
  contact: string;
  tax_code: string;
  tax_role: string;
  memo: string;
  recon_state: '' | 'cleared' | 'reconciled';
  reconciliation: string;
  statement_line: string;
  line: number;
  account_code?: string | undefined;
  account_name?: string | undefined;
  account_type?: string | undefined;
  tax_code_label?: string | undefined;
}

export interface TxnRow {
  id: string;
  date: string;
  narration: string;
  contact: string;
  contact_name: string;
  kind: string;
  status: 'proposed' | 'posted' | 'voided';
  reference: string;
  document: string;
  source_line: string;
  added_by: Actor;
  run: string;
  method: Method;
  confidence: Confidence | '';
  reason: string;
  total: number;
  files: number;
  postings: { account: string; amount: number; currency: string; home_amount: number; recon_state: string; memo: string }[];
}

export interface ActivityEntry {
  id: string;
  actor: Actor;
  run: string;
  op: string;
  summary: string;
  target_type: string;
  target_id: string;
  changes: { field: string; before: unknown; after: unknown }[] | null;
  undoable: boolean;
  redoable: boolean;
  undone: boolean;
  created: string;
}

export interface TxnDetail {
  id: string;
  date: string;
  narration: string;
  contact: string;
  contact_name: string;
  kind: string;
  status: 'proposed' | 'posted' | 'voided';
  reference: string;
  tags: string[];
  document: string;
  source_line: string;
  reverses: string;
  recurring: string;
  added_by: Actor;
  run: string;
  method: Method;
  confidence: Confidence | '';
  reason: string;
  evidence: { similar?: { date: string; amount: number; account: string }[] | undefined; rule?: string | undefined } | null;
  void_reason: string;
  version: number;
  created: string;
  updated: string;
  postings: Posting[];
  total: number;
  files: FileRec[];
  lines: Line[];
  document_info?: { id: string; kind: DocKind; number: string } | null | undefined;
  allocations: { id: string; document: string; number: string; amount: number; kind: string }[];
  reversed_by: string;
  history: ActivityEntry[];
  locked: boolean;
}

export interface RegisterRow {
  posting: string;
  txn: string;
  date: string;
  status: string;
  narration: string;
  kind: string;
  contact: string;
  contact_name: string;
  reference: string;
  amount: number;
  home_amount: number;
  currency: string;
  memo: string;
  recon_state: string;
  added_by: string;
  method: string;
  document: string;
  balance: number;
}

export interface Register {
  account: Account;
  opening: number;
  closing: number;
  total: number;
  rows: RegisterRow[];
}

export type DocKind = 'invoice' | 'bill' | 'credit_note' | 'vendor_credit';
export type DocState = 'draft' | 'open' | 'overdue' | 'partial' | 'paid' | 'applied' | 'void';

export interface DocLine {
  id: string;
  description: string;
  quantity: string;
  unit_price: number;
  account: string;
  tax_code: string;
  subtotal: number;
  tax: number;
  total: number;
  sort: number;
}

export interface Allocation {
  id: string;
  payment: string;
  document: string;
  credit_doc: string;
  kind: 'payment' | 'credit' | 'writeoff';
  amount: number;
  home_amount: number;
  fx_diff: number;
  date: string;
}

export interface Doc {
  id: string;
  kind: DocKind;
  number: string;
  contact: string;
  contact_name: string;
  issue_date: string;
  due_date: string;
  currency: string;
  rate: string;
  inclusive: boolean;
  status: 'draft' | 'approved' | 'void';
  state: DocState;
  subtotal: number;
  tax_total: number;
  total: number;
  home_total: number;
  allocated: number;
  open: number;
  days_overdue: number;
  notes: string;
  terms: string;
  reference: string;
  txn: string;
  file: string;
  added_by: string;
  run: string;
  reminder: string;
  reminded_at: string;
  sent_at: string;
  recurring: string;
  void_reason: string;
  created: string;
  updated: string;
  lines?: DocLine[] | undefined;
  allocations?: Allocation[] | undefined;
  files?: FileRec[] | undefined;
  history?: ActivityEntry[] | undefined;
  warnings?: { kind: string; document: string; number: string; reason: string }[] | undefined;
  contact_info?: Contact | null | undefined;
}

export interface DocSummary {
  open: number;
  open_count: number;
  overdue: number;
  overdue_count: number;
  draft_count: number;
  paid_30: number;
  due_7: number;
}

export interface FileRec {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'receipt' | 'invoice' | 'statement' | 'other';
  status: 'inbox' | 'reading' | 'linked' | 'archived';
  extracted: { vendor?: string | undefined; date?: string | undefined; total?: string | undefined; tax?: string | undefined; currency?: string | undefined; number?: string | undefined; lines?: { description: string; amount: string }[] | undefined } | null;
  linked_type: string;
  linked_id: string;
  added_by: string;
  run: string;
  note: string;
  agent_state: '' | 'waiting' | 'working' | 'done' | 'failed';
  agent_at: string;
  image: boolean;
  created: string;
  candidates?: { txn: string; date: string; narration: string; amount: number; account: string; days: number; has_file: boolean }[] | undefined;
}

export interface Rule {
  id: string;
  name: string;
  sort: number;
  status: 'active' | 'proposed' | 'disabled';
  match: 'all' | 'any';
  conditions: { field: string; op: string; value: string; value2?: string | undefined }[];
  actions: { account?: string | undefined; contact?: string | undefined; tax_code?: string | undefined; payee?: string | undefined; memo?: string | undefined; tags?: string[] | undefined; splits?: { account: string; percent: string }[] | undefined };
  auto_post: boolean;
  one_time: boolean;
  hits: number;
  last_hit: string;
  added_by: 'user' | 'agent';
  run: string;
  note: string;
  created: string;
}

export interface Schedule {
  id: string;
  name: string;
  kind: 'transaction' | 'invoice' | 'bill';
  template: Record<string, unknown>;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  interval: number;
  next_date: string;
  end_date: string;
  auto: boolean;
  active: boolean;
  last_run: string;
  count: number;
  added_by: string;
  created: string;
}

export interface ReconSession {
  id: string;
  account: string;
  statement_date: string;
  statement_balance: number;
  opening_balance: number;
  status: 'open' | 'finished' | 'undone';
  finished_at: string;
  cleared_count: number;
  adjustment: string;
  note: string;
  added_by: string;
  created: string;
}

export interface ReconState {
  session: ReconSession;
  account: Account;
  currency: string;
  sign: number;
  opening: number;
  cleared_total: number;
  cleared_count: number;
  deposits: number;
  payments: number;
  cleared_balance: number;
  statement_balance: number;
  difference: number;
  book_balance: number;
  rows: { posting: string; txn: string; date: string; narration: string; contact: string; reference: string; amount: number; cleared: boolean; matched: boolean; memo: string }[];
  later_cleared: number;
  hint: { balance: number; date: string; file_name: string } | null;
}

export interface ReconOverview {
  account: Account;
  balance_ccy: number;
  last: ReconSession | null;
  open: ReconSession | null;
  unreconciled: number;
  unreconciled_total: number;
  inbox: number;
  hint: { balance: number; date: string; file_name: string } | null;
}

export interface Check {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  count: number;
  detail: string;
  go: Record<string, unknown> | null;
  agent: boolean;
}

export interface PeriodRow {
  period: string;
  from: string;
  to: string;
  status: 'open' | 'closed';
  locked: boolean;
  signed_off_at: string;
  agent_state: string;
  inbox: number;
}

export interface Period {
  id: string;
  period: string;
  from: string;
  to: string;
  status: 'open' | 'closed';
  checklist: Record<string, string | null>;
  signed_off_at: string;
  notes: string;
  agent_state: '' | 'waiting' | 'working' | 'done' | 'failed';
  agent_note: string;
  agent_at: string;
  manual: { key: string; label: string }[];
  checks?: Check[] | undefined;
  lock_date?: string | undefined;
  agent_lock_date?: string | undefined;
  locked?: boolean | undefined;
}

export interface Ask {
  id: string;
  kind: 'question' | 'explain' | 'reminder' | 'review' | 'categorize';
  status: 'waiting' | 'working' | 'done' | 'failed';
  question: string;
  context: Record<string, unknown> | null;
  answer: string;
  links: { type: string; id: string; label: string }[];
  error: string;
  requested_at: string;
  run: string;
  created: string;
  updated: string;
}

export interface Run {
  run: string;
  started: string;
  last: string;
  changes: number;
  undone: number;
  summaries: string[];
}

export interface Summary {
  currency: string;
  cash: number;
  cards: number;
  receivables: DocSummary;
  payables: DocSummary;
  tax_owed: number;
  inbox: number;
  inbox_agent: number;
  proposed: number;
  files_inbox: number;
  uncategorized: number;
  this_month: { income: number; expense: number; net: number };
  last_month: { income: number; expense: number; net: number };
  lock_date: string;
  agent_lock_date: string;
}

export interface ReportRow {
  account: string;
  code: string;
  name: string;
  parent?: string | undefined;
  system?: string | undefined;
  computed?: boolean | undefined;
  values: number[];
}

export interface Column {
  label: string;
  from?: string | undefined;
  to: string;
  compare?: boolean | undefined;
}

export interface PnL {
  report: 'pnl';
  basis: 'accrual' | 'cash';
  from: string;
  to: string;
  columns: Column[];
  sections: { key: string; label: string; rows: ReportRow[]; total: number[] }[];
  gross: number[];
  operating: number[];
  net: number[];
  currency: string;
}

export interface Balance {
  report: 'balance';
  to: string;
  columns: Column[];
  groups: { key: string; label: string; side: string; rows: ReportRow[]; total: number[] }[];
  assets: number[];
  liabilities: number[];
  equity: number[];
  balanced: boolean[];
  currency: string;
}

export interface CashFlow {
  report: 'cashflow';
  from: string;
  to: string;
  classes: { key: string; label: string; rows: { account: string; code: string; name: string; value: number }[]; total: number }[];
  net: number;
  opening: number;
  closing: number;
  accounts: { account: string; code: string; name: string; opening: number; closing: number }[];
  reconciles: boolean;
  currency: string;
}

export interface Trial {
  report: 'trial';
  to: string;
  rows: { account: string; code: string; name: string; type: string; debit: number; credit: number }[];
  debit: number;
  credit: number;
  balanced: boolean;
  currency: string;
}

export interface Aged {
  report: 'aged';
  side: 'receivables' | 'payables';
  to: string;
  buckets: string[];
  rows: { contact: string; name: string; current: number; '1_30': number; '31_60': number; '61_90': number; '90_plus': number; total: number; docs: { id: string; kind: string; number: string; issue_date: string; due_date: string; days: number; open: number; currency: string; home: number; bucket: string }[] }[];
  totals: Record<string, number>;
  currency: string;
}

export interface TaxReport {
  report: 'tax';
  from: string;
  to: string;
  region: string;
  codes: { id: string; code: string; name: string; rate: string; group: string; sales_base: number; sales_tax: number; purchase_base: number; purchase_tax: number }[];
  output_tax: number;
  input_tax: number;
  net: number;
  settled: number;
  control_balance: number;
  boxes?: { box: number; label: string; value: number }[] | undefined;
  currency: string;
}

export interface BudgetReport {
  report: 'budget';
  year: number;
  from: string;
  to: string;
  columns: Column[];
  rows: { account: string; code: string; name: string; type: string; budget: number[]; actual: number[]; budget_total: number; actual_total: number; variance: number; has_budget: boolean }[];
  currency: string;
}

export interface NetWorth {
  report: 'networth';
  points: { date: string; assets: number; liabilities: number; net: number }[];
  currency: string;
}

export interface Spending {
  report: 'spending';
  from: string;
  to: string;
  total: number;
  categories: { account: string; code: string; name: string; value: number; share: number }[];
  payees: { contact: string; name: string; value: number; count: number }[];
  currency: string;
}

export interface Drill {
  account: Account;
  from: string;
  to: string;
  opening: number;
  closing: number;
  total: number;
  rows: RegisterRow[];
}

export interface Dashboard {
  currency: string;
  entity: 'business' | 'personal' | 'both';
  today: string;
  range: { name: string; from: string; to: string; prev_from: string; prev_to: string };
  kpi: {
    cash: number;
    cash_30: number;
    income: number;
    income_prev: number;
    expense: number;
    expense_prev: number;
    net: number;
    net_prev: number;
    receivables: number;
    overdue: number;
    overdue_count: number;
    payables: number;
    payables_due_7: number;
    tax_owed: number;
    cards: number;
    avg_monthly_expense: number;
    runway_months: number | null;
    savings_rate: number | null;
    month_income: number;
    month_expense: number;
  };
  cash: { date: string; value: number }[];
  months: { month: string; income: number; expense: number; net: number }[];
  spending: { total: number; items: { account: string; name: string; code: string; value: number; share: number }[] };
  earning: { total: number; items: { account: string; name: string; code: string; value: number; share: number }[] };
  aged: { receivables: Record<string, number>; payables: Record<string, number>; debtors: { contact: string; name: string; total: number; late: number }[] };
  due: { id: string; kind: 'invoice' | 'bill'; number: string; contact: string; due_date: string; open: number; currency: string; days: number }[];
  recurring: { id: string; name: string; kind: string; next_date: string }[];
  accounts: { id: string; name: string; subtype: string; currency: string; balance: number; home: number; series: number[]; inbox: number }[];
  budgets: { account: string; name: string; type: string; budget: number; actual: number }[];
  inbox: { total: number; mix: { rule: number; match: number; agent: number; memory: number; none: number; ai_working: number }; files: number; proposed: number };
  reconcile: { id: string; name: string; through: string }[];
  activity: ActivityEntry[];
  runs: Run[];
}

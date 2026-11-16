/** Shapes of the payroll-core operation answers the pages read. */
import type { AgentAsk } from '../../../components/agent.tsx';

export interface NextPeriod {
  schedule: string;
  name: string;
  entity: string;
  entity_name: string;
  currency: string;
  frequency?: string;
  people?: number;
  open_inputs?: number;
  period_start: string;
  period_end: string;
  pay_date: string;
  planned_pay_date: string;
  pay_date_moved: boolean;
  moved_because: string;
  cutoff_day: string;
  days_to_pay: number;
  days_to_cutoff: number;
  run: { id: string; number: string; status: string } | null;
}

export interface RunSummary {
  id: string;
  number: string;
  label: string;
  kind: string;
  status: string;
  entity: string;
  entity_name: string;
  country: string;
  schedule: string;
  schedule_name: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  cutoff_day: string;
  currency: string;
  employee_count: number;
  gross_minor: number;
  deductions_minor: number;
  employer_minor: number;
  reimbursement_minor: number;
  net_minor: number;
  held_minor: number;
  held_count: number;
  released_minor: number;
  released_count: number;
  to_pay_minor: number;
  to_pay_count: number;
  blockers: number;
  warnings: number;
  unacknowledged: number;
  approval: string;
  corrects: string;
  replaces: string;
  replaced_by: string;
  progress: { total?: number; done?: number; errors?: { employment: string; error: string }[]; lease_until?: string };
  locked_at: string;
  paid_at: string;
  publish_at: string;
  published_at: string;
  calculated_at: string;
  created: string;
}

export interface RunView extends RunSummary {
  note: string;
  options: Record<string, unknown>;
  issues_summary: { blockers?: number; warnings?: number; unacknowledged?: number; by_code?: { code: string; severity: string; count: number }[] };
  variance_summary: { previous?: { id: string; number: string; pay_date: string } | null; net_minor?: number; gross_minor?: number; headcount?: number };
  hash: string;
  input_hash: string;
  locked_by_name: string;
  paid_by_name: string;
  void_reason: string;
  voided_at: string;
  voided_by_name: string;
  created_by_name: string;
  calc_ms: number;
  version: number;
  steps: { key: string; done: boolean; current: boolean }[];
  approval_status?: string;
  approval_view?: { id: string; status: string; approvers: string[]; step: number; steps: unknown[]; summary: string } | null;
  corrects_run: { id: string; number: string; status: string } | null;
  replaces_run: { id: string; number: string; status: string } | null;
  replaced_by_run: { id: string; number: string; status: string } | null;
  /** Your AI agent asked to review the run (payrun_review), or null. */
  agent: AgentAsk | null;
  can?: { calculate: boolean; submit: boolean; lock: boolean; void: boolean; publish: boolean; correct: boolean; delete: boolean };
}

export interface SlipRow {
  id: string;
  employment: string;
  employee: string;
  number: string;
  name: string;
  title: string;
  gross_minor: number;
  deductions_minor: number;
  employer_minor: number;
  reimbursement_minor: number;
  net_minor: number;
  status: string;
  held: boolean;
  pay_method: string;
  blockers: number;
  warnings: number;
  variance: { prev_net_minor?: number; delta_net_minor?: number; pct?: number | null; reasons?: string[] };
}

export interface RunGet {
  payrun: RunView;
  payslips: SlipRow[];
  total: number;
  open_notes: number;
}

export interface Issue {
  severity: 'blocker' | 'warning' | 'held';
  code: string;
  message: string;
  employment?: string;
  entity?: string;
  payrun?: string;
  number?: string;
  name?: string;
  pack?: string;
  pack_name?: string;
  field?: string;
  field_label?: string;
  scope?: string;
  detail?: string;
  day?: string;
  from?: string;
  to?: string;
  locked_day?: string;
  run_number?: string;
  n?: number;
  employed?: number;
  working?: number;
  pct?: number;
  reasons?: string[];
  days?: string[];
  weeks?: string[];
  month?: string;
  key: string;
  fix?: { label: string; link: string };
  acknowledged: { by_name: string; at: string; reason: string; note: string } | null;
  /** The person field may be set by payroll itself (payroll.person-set). */
  payroll_may_set?: boolean;
  /** opening_balances_missing for the whole run: the people it stops. */
  people?: { employment: string; number: string; name: string }[];
  packs?: string[];
}

export interface Line {
  id: string;
  code: string;
  name: string;
  kind: string;
  stage: string;
  amount_minor: number;
  qty: number;
  rate: number;
  base_minor: number;
  pack: string;
  pack_version: string;
  step: number;
  phase: string;
  source: string;
  tags: string[];
  ref_kind: string;
  explain: {
    source?: string;
    note?: string;
    expr?: string;
    when?: string;
    value?: number;
    reads?: { name: string; value: unknown }[];
    tables?: { fn: string; table: string; x?: number; key?: string; value: unknown }[];
    rounded?: { mode: string; step: number };
    method?: string;
    segments?: { from: string; to: string; amount_minor: number; per: string; fraction: number; period_amount_minor: number }[];
    [k: string]: unknown;
  };
  sort: number;
}

export interface Payslip {
  id: string;
  payrun: string;
  payrun_number: string;
  payrun_status: string;
  kind: string;
  status: string;
  entity: string;
  entity_name: string;
  entity_legal_name: string;
  entity_address: Record<string, string>;
  entity_tax_ids: Record<string, string>;
  country: string;
  employee: string;
  employee_number: string;
  employee_name: string;
  legal_name: string;
  employment: string;
  title: string;
  department: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  currency: string;
  gross_minor: number;
  deductions_minor: number;
  employer_minor: number;
  reimbursement_minor: number;
  net_minor: number;
  held: boolean;
  pay_method: string;
  bank_split: { label: string; bank_name: string; number_masked: string }[];
  groups: { key: string; label: string; lines: Line[]; total_minor: number }[];
  ytd: { from: string; to: string; by_code: Record<string, number>; gross_minor: number; net_minor: number; deductions_minor: number; employer_minor: number } | null;
  packs: { code: string; version: string; name: string }[];
  published_at: string;
  hash: string;
  issues?: Issue[];
  variance?: { prev_net_minor?: number; delta_net_minor?: number; pct?: number | null; reasons?: string[] };
  access: string;
}

export interface FieldDef {
  pack: string;
  pack_name: string;
  key: string;
  label: string;
  type: 'enum' | 'number' | 'money' | 'boolean' | 'text' | 'date';
  options: { value: string; label: string }[];
  default: unknown;
  required: boolean;
  help: string;
  form: string;
  min: number | null;
  max: number | null;
}

export interface Component {
  id: string;
  code: string;
  name: string;
  entity: string;
  kind: string;
  stage: string;
  calc: string;
  amount_minor: number;
  percent: number;
  base: string;
  multiplier: number;
  tags: string[];
  taxable: boolean;
  recurring: boolean;
  prorate: boolean;
  gl_account: string;
  liability_account: string;
  payslip_group: string;
  sort: number;
  role: string;
  pack: string;
  source: string;
  archived: boolean;
  note: string;
}

export interface PayInput {
  id: string;
  employment: string;
  employee_name: string;
  employee_number: string;
  component_code: string;
  component_name: string;
  kind: string;
  period_start: string;
  period_end: string;
  total_minor: number;
  qty: number;
  rate_minor: number;
  currency: string;
  source: string;
  note: string;
  payrun: string;
  payrun_number: string;
  status: string;
  created: string;
}

export interface Loan {
  id: string;
  employment: string;
  employee_name: string;
  employee_number: string;
  kind: string;
  principal_minor: number;
  total_minor: number;
  currency: string;
  interest_pct: number;
  installments: number;
  installment_minor: number;
  start_period: string;
  balance_minor: number;
  repaid_minor: number;
  status: string;
  paused: boolean;
  reason: string;
  repayments: { id: string; day: string; amount_minor: number; kind: string; note: string }[];
  schedule: { period: string; amount_minor: number; balance_after_minor: number }[];
}

export interface Declaration {
  id: string;
  employment: string;
  employee_name: string;
  kind: string;
  fiscal_year: string;
  country: string;
  regime: string;
  items: { section: string; amount_minor: number; description: string; metro?: boolean }[];
  proofs: { file: string; section: string; name: string; uploaded_at: string }[];
  status: string;
  note: string;
  decided_note: string;
  total_minor: number;
  created: string;
  submitted_at: string;
  sections?: { section: string; label: string; field: string; cap: number | null; note?: string }[];
  regimes?: { value: string; label: string }[];
  can?: { edit: boolean; submit: boolean };
}

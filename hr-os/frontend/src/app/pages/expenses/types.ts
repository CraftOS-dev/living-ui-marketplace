/** Expenses shapes as the operations answer them (pb_hooks/lib_expenses*.js views). */
import type { AgentAsk } from '../../components/agent.tsx';

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled';

export interface Flag {
  code: string;
  severity: 'blocker' | 'warning' | 'wait';
  message: string;
  params: Record<string, unknown>;
  source: 'rule' | 'agent';
}

export interface AgentFlag {
  code: string;
  note: string;
  at: string;
  by: string;
  cleared?: boolean | undefined;
  cleared_by_name?: string | undefined;
  cleared_note?: string | undefined;
}

export interface Reading {
  merchant?: string | undefined;
  day?: string | undefined;
  amount_minor?: number | undefined;
  currency?: string | undefined;
  tax_minor?: number | undefined;
  category?: string | undefined;
  category_code?: string | undefined;
  category_name?: string | undefined;
  description?: string | undefined;
  confidence?: 'high' | 'medium' | 'low' | undefined;
  flags?: string[] | undefined;
  note?: string | undefined;
  read_at?: string | undefined;
  state?: 'proposed' | 'applied' | 'accepted' | 'dismissed' | 'late' | 'failed' | undefined;
  applied?: string[] | undefined;
  code?: string | undefined;
  reason?: string | undefined;
}

export interface Line {
  id: string;
  claim: string;
  day: string;
  category: string;
  category_code: string;
  category_name: string;
  category_icon: string;
  kind: 'standard' | 'mileage';
  merchant: string;
  description: string;
  attendees: string;
  amount_minor: number;
  currency: string;
  fx_rate: number;
  fx_day: string;
  fx_source: string;
  base_minor: number;
  tax_minor: number;
  receipt: boolean;
  receipt_kind: '' | 'image' | 'pdf';
  receipt_status: 'none' | 'waiting' | 'reading' | 'read' | 'failed';
  distance: number;
  unit: string;
  rate_minor: number;
  flags: Flag[];
  flag_count: number;
  reason: string;
  agent_read: Reading | null;
  agent_flags: AgentFlag[];
  edited: string[];
  status: 'included' | 'rejected';
  reject_reason: string;
  rejected_by_name: string;
  sort: number;
  created: string;
  updated: string;
}

export interface Category {
  id: string;
  entity: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  kind: 'standard' | 'mileage';
  limit_minor: number;
  per_day_limit_minor: number;
  receipt_rule: 'always' | 'over' | 'never';
  receipt_over_minor: number;
  mileage_rate_minor: number;
  unit: 'km' | 'mile';
  taxable: boolean;
  component: string;
  gl_account: string;
  sort: number;
  archived: boolean;
  used?: number | undefined;
}

export interface Policy {
  entity: string;
  entity_name: string;
  currency: string;
  stored: boolean;
  finance_over_minor: number;
  max_age_days: number;
  flag_weekends: boolean;
  pay_via: 'payroll' | 'bank';
  advance_pay_via: 'payroll' | 'bank';
  advance_recover_via: 'payroll' | 'claim';
  recover_after_days: number;
  note: string;
}

export interface ApprovalStep {
  type: string;
  role?: string | undefined;
  member?: string | undefined;
}

export interface Approval {
  id: string;
  kind: string;
  ref_collection: string;
  ref_id: string;
  entity: string;
  employment: string;
  employee: string;
  employee_name: string;
  requester: string;
  requester_name: string;
  requester_actor: string;
  steps: ApprovalStep[];
  step: number;
  approvers: string[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string;
  decided_by_name: string;
  decided_at: string;
  note: string;
  summary: string;
  amount_minor: number;
  currency: string;
  payload: Record<string, unknown>;
  history: { at: string; event: string; step?: number; by: string; as?: string; note?: string }[];
  needs_pin: boolean;
  due: string;
  created: string;
}

export interface HistoryRow {
  at: string;
  who: string;
  actor: string;
  summary: string;
}

export interface Claim {
  id: string;
  number: string;
  title: string;
  label: string;
  employment: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  entity: string;
  entity_name: string;
  currency: string;
  total_minor: number;
  approved_minor: number;
  advance_applied_minor: number;
  payable_minor: number;
  status: ClaimStatus;
  pay_via: 'payroll' | 'bank';
  payrun: string;
  paid_via: '' | 'payroll' | 'bank' | 'advance';
  paid_reference: string;
  paid_at: string;
  paid_day: string;
  paid_by_name: string;
  advance: string;
  advance_number: string;
  travel: string;
  travel_number: string;
  travel_label: string;
  approval: string;
  submitted_at: string;
  decided_at: string;
  approved_day: string;
  decided_note: string;
  flags: { warnings?: number; blockers?: number; codes?: Record<string, number>; claimed_minor?: number };
  flag_count: number;
  line_count: number;
  note: string;
  created_by_name: string;
  actor: string;
  /** Your AI agent asked to read this claim's receipts (receipt_review), or null. */
  agent: AgentAsk | null;
  created: string;
  updated: string;
  receipts?: number | undefined;
  department?: string | undefined;
  department_name?: string | undefined;
  lines?: Line[] | undefined;
}

export interface ClaimDetail extends Claim {
  lines: Line[];
  approvals: Approval[];
  settlements: { id: string; advance: string; advance_number: string; amount_minor: number; day: string; kind: string }[];
  travel_detail: Trip | null;
  advance_detail: Advance | null;
  history: HistoryRow[];
  access: 'admin' | 'self' | 'team' | 'approver';
  can: { edit: boolean; submit: boolean; withdraw: boolean; reopen: boolean; cancel: boolean; delete: boolean; decide: boolean; reject_lines: boolean; mark_paid: boolean; set_payment: boolean; flag: boolean; clear_flag: boolean };
  pending_approval: Approval | null;
  categories?: Category[] | undefined;
  policy: Policy;
}

export interface Totals {
  currency: string;
  claims: number;
  total_minor: number;
  awaiting_minor: number;
}

export interface ClaimList {
  claims: Claim[];
  total: number;
  totals: Totals[];
  view: 'mine' | 'team' | 'all';
  status: string;
}

export interface Advance {
  id: string;
  number: string;
  employment: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  entity: string;
  entity_name: string;
  travel: string;
  travel_number: string;
  travel_label: string;
  purpose: string;
  currency: string;
  amount_minor: number;
  balance_minor: number;
  settled_minor: number;
  status: 'requested' | 'approved' | 'paid' | 'settled' | 'rejected' | 'cancelled';
  approval: string;
  pay_via: 'payroll' | 'bank';
  recover_via: 'payroll' | 'claim';
  recover_from: string;
  needed_by: string;
  approved_day: string;
  decided_note: string;
  paid_day: string;
  paid_reference: string;
  paid_by_name: string;
  payrun: string;
  requested_by_name: string;
  note: string;
  created: string;
  updated: string;
}

export interface AdvanceDetail extends Advance {
  settlements: { id: string; kind: 'claim' | 'payroll' | 'repayment'; claim: string; claim_number: string; amount_minor: number; day: string; payrun: string; reference: string; note: string; by_name: string; created: string }[];
  approvals: Approval[];
  pending_approval: Approval | null;
  history: HistoryRow[];
  access: string;
  can: { decide: boolean; cancel: boolean; mark_paid: boolean; settle: boolean; update: boolean };
}

export interface Leg {
  day: string;
  from: string;
  to: string;
  mode: 'flight' | 'train' | 'car' | 'bus' | 'boat' | 'other';
  note: string;
}

export interface Trip {
  id: string;
  number: string;
  label: string;
  employment: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  entity: string;
  entity_name: string;
  purpose: string;
  details: string;
  from_day: string;
  to_day: string;
  days: number;
  destinations: { city: string; country: string }[];
  itinerary: Leg[];
  costs: { category: string; category_name: string; amount_minor: number; note: string }[];
  estimate_minor: number;
  currency: string;
  status: 'draft' | 'requested' | 'approved' | 'rejected' | 'cancelled';
  approval: string;
  decided_note: string;
  created_by_name: string;
  created: string;
  claims?: number | undefined;
  spent_minor?: number | undefined;
}

export interface TripDetail extends Trip {
  claims_list: Claim[];
  advances: Advance[];
  approvals: Approval[];
  pending_approval: Approval | null;
  can: { edit: boolean; submit: boolean; decide: boolean; cancel: boolean; advance: boolean; claim: boolean };
  categories: Category[];
  history: HistoryRow[];
}

export interface MyEmployment {
  id: string;
  number: string;
  entity: string;
  entity_name: string;
  currency: string;
  primary: boolean;
  status: string;
  categories: Category[];
  policy: { pay_via: string; max_age_days: number; flag_weekends: boolean };
  draft: string;
}

export interface Mine {
  employee: { id: string; name: string; number: string } | null;
  employments: MyEmployment[];
  drafts: (Claim & { lines: Line[] })[];
  recent: Claim[];
  awaiting: { currency: string; amount_minor: number; claims: number }[];
  waiting_approval: number;
  advances: Advance[];
  trips: Trip[];
}

export interface SpendGroup {
  key: string;
  label: string;
  icon: string;
  approved_minor: number;
  waiting_minor: number;
  total_minor: number;
}

export interface Spend {
  from: string;
  to: string;
  currency: string;
  group_by: string;
  groups: SpendGroup[];
  total_minor: number;
  approved_minor: number;
  waiting_minor: number;
  unconverted: { currency: string; amount_minor: number }[];
}

export interface Home {
  scope: 'admin' | 'team';
  entity: string;
  today: string;
  for_you: { total: number; claims: number; advances: number; trips: number; approvals: Approval[] };
  waiting: { total: number; totals: { currency: string; claims: number; amount_minor: number }[]; claims: Claim[] };
  flagged: { total: number; claims: Claim[] };
  approved_unpaid: { total: number; payroll: { currency: string; claims: number; amount_minor: number }[]; bank: { currency: string; claims: number; amount_minor: number }[]; claims: Claim[] };
  advances: { requested: number; to_pay: number; outstanding: { currency: string; advances: number; amount_minor: number }[] };
  receipts_waiting: number;
  spend_by_category: Spend;
  spend_by_department: Spend;
  entities: { id: string; name: string; currency: string; country: string }[];
  can: { pay: boolean; settings: boolean; export: boolean };
}

export interface CategoryList {
  entity: string;
  entity_name: string;
  currency: string;
  country: string;
  categories: Category[];
  policy: Policy;
  can_edit: boolean;
}

/** Every collection an expenses view reads (live reloads). */
export const READS = ['claims', 'claim_lines', 'advances', 'advance_settlements', 'travel_requests', 'expense_categories', 'expense_policies', 'approvals'];

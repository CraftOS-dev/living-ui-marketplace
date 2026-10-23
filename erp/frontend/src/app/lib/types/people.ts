/**
 * Shapes the People screens read: employees and departments, leave, expense
 * claims and payroll (pb_hooks/lib_people, lib_leave, lib_claims,
 * lib_payroll). Money is whole minor units unless a field ends in _text.
 */
import type { CodeRef, Ref } from '../types.ts';

export type EmployeeStatus = 'active' | 'on_leave' | 'left';
export type Employment = 'full_time' | 'part_time' | 'contractor' | 'intern' | 'temporary';
export type PayFrequency = 'monthly' | 'semi_monthly' | 'biweekly' | 'weekly';

export interface DeptBrief {
  id: string;
  name: string;
  code: string;
}

export interface EmpBrief {
  id: string;
  name: string;
  number: string;
  job_title: string;
  photo: string;
  status: string;
}

export interface Employee {
  id: string;
  number: string;
  name: string;
  job_title: string;
  department: DeptBrief | null;
  manager: EmpBrief | null;
  photo: string;
  email: string;
  phone: string;
  status: EmployeeStatus;
  own: boolean;
  details: boolean;
  pay: boolean;
  reports?: number | undefined;
  employment?: Employment | undefined;
  start_date?: string | undefined;
  end_date?: string | undefined;
  address?: string | undefined;
  birthday?: string | undefined;
  emergency_contact?: string | undefined;
  notes?: string | undefined;
  member?: { id: string; name: string; email: string; status: string } | null | undefined;
  created?: string | undefined;
  pay_basic?: number | undefined;
  pay_basic_text?: string | undefined;
  pay_frequency?: PayFrequency | undefined;
  hourly_cost?: number | undefined;
  hourly_cost_text?: string | undefined;
  bank_details?: string | undefined;
  national_id?: string | undefined;
  tax_number?: string | undefined;
  currency?: string | undefined;
}

export interface DeptCount {
  id: string;
  name: string;
  archived: boolean;
  count: number;
}

export interface EmployeeList {
  employees: Employee[];
  total: number;
  counts: { status: Record<EmployeeStatus, number>; departments: DeptCount[] };
  can: { add: boolean; pay: boolean };
}

export interface ClaimBrief {
  id: string;
  number: string;
  title: string;
  date: string;
  status: ClaimStatus;
  total: number;
  total_text: string;
}

export interface Assigned {
  id: string;
  component: { id: string; name: string; kind: ComponentKind; calc: 'fixed' | 'percent'; applies: 'all' | 'selected'; active: boolean };
  override: boolean;
  amount: number;
  amount_text: string;
  percent: string;
  percent_bp: number;
  uses: string;
}

export interface EmployeeDetail extends Omit<Employee, 'reports'> {
  reports: (EmpBrief & { department: DeptBrief | null })[];
  chain: EmpBrief[];
  leave?: Balances | undefined;
  claims?: ClaimBrief[] | undefined;
  components?: Assigned[] | undefined;
  can: { edit: boolean; pay: boolean; delete: boolean; leave: boolean };
}

export interface Department {
  id: string;
  name: string;
  code: string;
  parent: DeptBrief | null;
  manager: EmpBrief | null;
  archived: boolean;
  sort: number;
  employees: number;
}

export interface DepartmentList {
  departments: Department[];
  without_department: number;
  can: { edit: boolean };
}

export interface OrgNode {
  id: string;
  number: string;
  name: string;
  job_title: string;
  photo: string;
  status: string;
  department: { id: string; name: string } | null;
  reports: number;
  children: OrgNode[];
}

export interface OrgTree {
  roots: OrgNode[];
  count: number;
  depth: number;
}

/* ---------------------------------------------------------------- leave */

export type LeaveIcon = 'sun' | 'thermometer' | 'calendar-off' | 'baby' | 'heart' | 'plane' | 'graduation-cap' | 'briefcase' | 'home' | 'umbrella';
export type LeaveStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveTypeBrief {
  id: string;
  name: string;
  icon: LeaveIcon;
  paid: boolean;
  days_per_year: number;
}

export interface LeaveType {
  id: string;
  name: string;
  days_per_year: number;
  paid: boolean;
  needs_approval: boolean;
  carry_over_max: number;
  icon: LeaveIcon;
  archived: boolean;
  sort: number;
}

export interface LeaveTypes {
  types: LeaveType[];
  icons: LeaveIcon[];
  can: { edit: boolean };
}

export interface Balance {
  type: LeaveTypeBrief;
  limited: boolean;
  entitled: number;
  carried: number;
  taken: number;
  pending: number;
  remaining: number;
}

export interface Adjustment {
  id: string;
  type: LeaveTypeBrief | null;
  days: number;
  reason: string;
  by: string;
  created: string;
}

export interface Balances {
  employee: EmpBrief;
  year: number;
  types: Balance[];
  adjustments?: Adjustment[] | undefined;
  start_date?: string | undefined;
  can?: { adjust: boolean } | undefined;
}

export interface LeaveRequest {
  id: string;
  employee: EmpBrief;
  type: LeaveTypeBrief | null;
  from: string;
  to: string;
  half_day: boolean;
  days: number;
  reason: string;
  status: LeaveStatus;
  requested_by: string;
  decided_by: string;
  decided_at: string;
  decision_note: string;
  created: string;
  can: { cancel: boolean; decide: boolean };
}

export interface LeaveList {
  scope: 'mine' | 'team' | 'all';
  requests: LeaveRequest[];
  total: number;
  counts: Record<LeaveStatus, number>;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  weekday: number;
  working_day: boolean;
}

export interface Holidays {
  year: number;
  holidays: Holiday[];
  working_days: number[];
  can: { edit: boolean };
}

export interface CalendarEntry {
  id: string;
  employee: EmpBrief;
  type: LeaveTypeBrief | null;
  from: string;
  to: string;
  half_day: boolean;
  days: number;
  status: LeaveStatus;
}

export interface LeaveCalendar {
  month: string;
  from: string;
  to: string;
  scope: string;
  entries: CalendarEntry[];
  holidays: Holiday[];
  working_days: number[];
}

/* --------------------------------------------------------------- claims */

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted' | 'paid';

export interface JournalBrief {
  id: string;
  number: string;
  date: string;
  state: string;
}

/** A posted entry as journalOut returns it. */
export interface Entry {
  id: string;
  number: string;
  date: string;
  currency: string;
  lines: { account: CodeRef; debit: number; credit: number; memo: string; party: { name: string } | null }[];
}

export interface ClaimLine {
  id: string;
  date: string;
  account: CodeRef | null;
  description: string;
  amount: number;
  amount_text: string;
  tax: { id: string; code: string; name: string; rate_bp: number; recoverable: boolean } | null;
  tax_amount: number;
  tax_amount_text: string;
  project: CodeRef | null;
  receipt: { name: string; url: string } | null;
  sort: number;
}

export interface Claim {
  id: string;
  number: string;
  title: string;
  date: string;
  employee: (EmpBrief & { department: DeptBrief | null }) | null;
  status: ClaimStatus;
  total: number;
  total_text: string;
  tax: number;
  tax_text: string;
  project: CodeRef | null;
  lines_count: number;
  receipts: number;
  decided_by: string;
  decided_at: string;
  decision_note: string;
  journal: JournalBrief | null;
  pay_journal: JournalBrief | null;
  bank: Ref | null;
  paid_on: string;
  prepared_by: string;
  actor: string;
  created: string;
  currency: string;
}

export interface ClaimDetail extends Claim {
  lines: ClaimLine[];
  can: { edit: boolean; submit: boolean; decide: boolean; post: boolean; pay: boolean; delete: boolean; add_receipt: boolean };
  entry?: Entry | undefined;
  pay_entry?: Entry | undefined;
}

export interface ClaimList {
  scope: 'mine' | 'team' | 'all';
  claims: Claim[];
  total: number;
  totals: { count: number; total: number; tax: number };
  counts: Record<ClaimStatus, { count: number; total: number }>;
  currency: string;
}

/* -------------------------------------------------------------- payroll */

export type ComponentKind = 'earning' | 'deduction' | 'employer';
export type RunStatus = 'draft' | 'approved' | 'posted' | 'paid';

export interface PayComponent {
  id: string;
  name: string;
  kind: ComponentKind;
  calc: 'fixed' | 'percent';
  amount: number;
  amount_text: string;
  percent: string;
  percent_bp: number;
  account: CodeRef | null;
  liability_account: CodeRef | null;
  applies: 'all' | 'selected';
  active: boolean;
  sort: number;
  assigned: number;
}

export interface Components {
  components: PayComponent[];
  currency: string;
  can: { edit: boolean; assign: boolean };
}

export interface Run {
  id: string;
  number: string;
  month: string;
  month_name: string;
  pay_date: string;
  status: RunStatus;
  count: number;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  cost: number;
  journal: JournalBrief | null;
  pay_journal: JournalBrief | null;
  bank: Ref | null;
  approved_by: string;
  posted_by: string;
  paid_on: string;
  note: string;
  created: string;
  currency: string;
}

export interface SlipLine {
  component: string;
  basic: boolean;
  name: string;
  kind: ComponentKind;
  amount: number;
  amount_text: string;
  account: CodeRef | null;
  liability_account: CodeRef | null;
}

export interface Payslip {
  id: string;
  employee: (EmpBrief & { department: DeptBrief | null }) | null;
  basic: number;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  lines: SlipLine[];
  note: string;
}

export interface RunDetail extends Run {
  payslips: Payslip[];
  can: { edit: boolean; approve: boolean; post: boolean; pay: boolean; delete: boolean };
  entry?: Entry | undefined;
  pay_entry?: Entry | undefined;
}

export interface RunList {
  runs: Run[];
  total: number;
  totals: { gross: number; net: number; employer: number };
  currency: string;
  can: { create: boolean };
}

export interface PayslipDetail extends Payslip {
  employee: (EmpBrief & { department: DeptBrief | null; tax_number: string; national_id: string; bank_details: string; pay_frequency: string }) | null;
  run: { id: string; number: string; month: string; month_name: string; pay_date: string; status: RunStatus; paid_on: string };
  company: string;
  currency: string;
}

export interface MyPayslip {
  id: string;
  run: { id: string; number: string; month: string; month_name: string; pay_date: string; status: RunStatus; paid_on: string };
  basic: number;
  gross: number;
  deductions: number;
  net: number;
}

export interface MyPayslips {
  payslips: MyPayslip[];
  total: number;
  currency: string;
}

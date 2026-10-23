/**
 * Shapes the Projects screens read: projects, the task board, timesheets
 * and profitability (pb_hooks/lib_projects). Money is whole minor units of
 * the base currency; hours are plain numbers.
 */
import type { CodeRef } from '../types.ts';

export type ProjectStatus = 'active' | 'on_hold' | 'done' | 'cancelled';
export type Billing = 'fixed' | 'time_materials' | 'non_billable';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type TimeStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'invoiced';

export interface PersonBrief {
  id: string;
  name: string;
  number: string;
}

export interface ProjectMoney {
  hours: number;
  billable_hours: number;
  time_cost: number;
  billable_value: number;
  revenue: number;
  spent: number;
  budget_used: number;
  budget_used_pct: number | null;
  over_budget: boolean;
}

export interface Project extends ProjectMoney {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  billing: Billing;
  customer: CodeRef | null;
  manager: PersonBrief | null;
  start: string;
  end: string;
  budget: number;
  rate: number;
  rate_text: string;
  description: string;
  color: number;
  created: string;
  updated: string;
  progress: { done: number; total: number; pct: number | null };
  member: boolean;
}

export interface ProjectList {
  projects: Project[];
  total: number;
  counts: Record<ProjectStatus, number>;
  currency: string;
  can: { add: boolean };
}

export interface OverBudget extends ProjectMoney {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  manager: PersonBrief | null;
  budget: number;
  over_by: number;
}

export interface ProjectSummary {
  counts: Record<ProjectStatus, number>;
  month: string;
  hours_this_month: number;
  billable_hours_this_month: number;
  to_bill: { entries: number; hours: number; value: number };
  to_approve: { entries: number; hours: number };
  over_budget: OverBudget[];
  currency: string;
}

export interface Task {
  id: string;
  project: string;
  title: string;
  status: TaskStatus;
  assignee: PersonBrief | null;
  due: string;
  overdue: boolean;
  estimate_hours: number;
  hours: number;
  sort: number;
  notes: string;
  created: string;
  updated: string;
}

export interface TimeEntry {
  id: string;
  date: string;
  employee: { id: string; name: string };
  project: CodeRef;
  task: { id: string; title: string } | null;
  hours: number;
  billable: boolean;
  description: string;
  status: TimeStatus;
  locked: boolean;
  rate: number;
  rate_text: string;
  value: number;
  cost: number;
  invoice: { id: string; number: string; state: string } | null;
  approved_by: string;
  actor: string;
}

export interface Profit {
  project: { id: string; code: string; name: string; billing: Billing };
  from: string;
  to: string;
  currency: string;
  revenue: number;
  invoiced: number;
  credited: number;
  costs: number;
  time_cost: number;
  hours: number;
  billable_hours: number;
  billable_value: number;
  books_margin: number;
  books_margin_pct: number | null;
  margin_after_time: number;
  margin_after_time_pct: number | null;
  budget: number;
  budget_used: number;
  budget_used_pct: number | null;
  budget_left: number | null;
  documents: { id: string; type: string; number: string; date: string; net: number }[];
  cost_accounts: { account: CodeRef; amount: number }[];
  note: string;
}

export interface ProjectDetail extends Project {
  tasks: Record<TaskStatus, Task[]>;
  people: { employee: { id: string; name: string }; hours: number; billable_hours: number; cost: number }[];
  timesheets: TimeEntry[];
  documents: { id: string; type: string; number: string; label: string; state: string; status: string; date: string; total: number; currency: string }[];
  to_bill: { entries: number; hours: number; value: number };
  to_approve: number;
  profit: Profit;
  currency: string;
  can: { edit: boolean; delete: boolean; tasks: boolean; log_time: boolean; bill: boolean };
}

export interface TimeList {
  scope: 'mine' | 'team' | 'all';
  entries: TimeEntry[];
  total: number;
  totals: { hours: number; billable_hours: number; billable_value: number; cost: number };
  currency: string;
}

export interface WeekProject {
  id: string;
  code: string;
  name: string;
  color: number;
  billing: Billing;
  billable_default: boolean;
  member: boolean;
  tasks: { id: string; title: string; status: TaskStatus; mine: boolean }[];
}

export interface WeekCell {
  date: string;
  hours: number;
  status: TimeStatus | 'mixed' | '';
  locked: boolean;
  entries: string[];
}

export interface WeekRow {
  key: string;
  project: { id: string; code: string; name: string; color: number; status: string; billing: Billing };
  task: { id: string; title: string } | null;
  cells: WeekCell[];
  total: number;
}

export interface WeekEntry {
  id: string;
  project: { id: string; code: string; name: string };
  task: { id: string; title: string } | null;
  date: string;
  hours: number;
  billable: boolean;
  description: string;
  status: TimeStatus;
  locked: boolean;
  actor: string;
  note: string;
}

export interface Week {
  employee: { id: string; name: string; number: string; manager: PersonBrief | null };
  week: string;
  prev_week: string;
  next_week: string;
  days: { date: string; day: string; holiday: string; total: number }[];
  rows: WeekRow[];
  entries: WeekEntry[];
  totals: { days: number[]; total: number; billable: number; by_status: Partial<Record<TimeStatus, number>> };
  status: TimeStatus | 'mixed' | 'empty';
  projects: WeekProject[];
  can: { edit: boolean; submit: boolean; decide: boolean };
}

export interface BillPreview {
  preview: true;
  project: { id: string; code: string; name: string };
  customer: { id: string; name: string } | null;
  through: string;
  entries: number;
  lines: { employee: { id: string; name: string }; description: string; from: string; to: string; hours: number; rate: number; rate_text: string; amount: number; entries: number }[];
  amount: number;
  currency: string;
  note: string;
}

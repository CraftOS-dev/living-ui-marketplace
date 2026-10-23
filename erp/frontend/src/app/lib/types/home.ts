/** Home and "Needs you" (home.summary, home.needs). Sections are present only when the role sees them. */
import type { CodeRef, Proposal } from '../types.ts';

export interface Aging {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  over90: number;
  total: number;
  overdue: number;
  count: number;
}

export interface DueDoc {
  id: string;
  number: string;
  party: string;
  due_date: string;
  balance: number;
  currency: string;
  days: number;
}

export interface BankCard {
  id: string;
  name: string;
  kind: 'bank' | 'cash' | 'card';
  currency: string;
  balance: number;
  unmatched: number;
  bank_name: string;
  account: CodeRef;
  last_statement_date: string;
}

export interface LeaveBalance {
  type: string;
  icon: string;
  entitled: number;
  taken: number;
  pending: number;
  remaining: number;
}

export interface HomeSummary {
  today: string;
  currency: string;
  company: string;
  name: string;
  cash?: { total: number; banks: BankCard[]; series: { date: string; balance: number }[]; unmatched: number };
  receivables?: Aging;
  overdue_invoices?: DueDoc[];
  sales?: { this_month: number; last_month: number; last_month_to_date: number; days: { date: string; value: number; future: boolean }[] };
  top_customers?: { id: string; name: string; value: number }[];
  orders_to_deliver?: { n: number; v: number };
  quotes_open?: { n: number; v: number };
  payables?: Aging;
  bills_due?: DueDoc[];
  orders_to_receive?: { n: number; v: number };
  profit?: { revenue: number; expenses: number; net: number; last_net: number; months: { month: string; revenue: number; net: number }[] };
  stock?: {
    value: number;
    counts: Record<string, number>;
    reorder: { id: string; name: string; sku: string; on_hand: number; min_qty: number; unit: string; status: string; photo: string }[];
  };
  builds?: number;
  projects?: { active: number; hours_this_month: number };
  me?: {
    employee: { id: string; name: string; job_title: string } | null;
    leave: LeaveBalance[];
    upcoming_leave: { id: string; type: string; start: string; end: string; days: number; status: string }[];
    claims: { status: string; n: number; v: number }[];
    hours_this_week: number;
    next_holiday: { date: string; name: string } | null;
    latest_payslip: { id: string; month: string; net: number } | null;
    team: number;
  };
  agent: { today: number; proposals: number; inbox: number; recent: { kind: string; entity: string; ref: string; label: string; summary: string; created: string }[] };
  needs: Record<string, number>;
  setup?: { key: string; label: string; done: boolean; page: string }[];
}

export interface Needs {
  counts: Record<string, number>;
  proposals: Proposal[];
  leave?: { id: string; employee: string; type: string; start: string; end: string; days: number; reason: string; created: string }[];
  claims?: { id: string; number: string; employee: string; title: string; date: string; total: number }[];
  claims_to_post?: { id: string; number: string; employee: string; title: string; total: number }[];
  claims_to_pay?: { id: string; number: string; employee: string; title: string; total: number }[];
  timesheets?: { employee: string; employee_id: string; start: string; end: string; entries: number; hours: number }[];
  overdue?: DueDoc[];
  bills_due?: DueDoc[];
  bank?: { id: string; name: string; n: number; net: number }[];
  inbox_failed?: { id: string; filename: string; error: string; created: string }[];
  agent_drafts?: { id: string; type: string; number: string; party: string; total: number; currency: string; note: string; created: string }[];
}

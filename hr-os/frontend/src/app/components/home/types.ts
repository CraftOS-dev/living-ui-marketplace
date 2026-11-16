/** Shapes of the home.* operations (lib_home.js). */

import type { ProfileFact } from '../../lib/contract.ts';
import type { ClockStatus } from '../../pages/time/types.ts';
import type { AgentAsk } from '../agent.tsx';

export interface AttentionItem {
  id: string;
  title: string;
  sub?: string | undefined;
  person?: string | undefined;
  due?: string | undefined;
  created?: string | undefined;
  link?: string | undefined;
  kind?: string | undefined;
  count?: number | undefined;
  amount_minor?: number | undefined;
  currency?: string | undefined;
  needs_pin?: boolean | undefined;
  risk?: string | undefined;
  doc_type?: string | undefined;
  action?: { op: string; params: Record<string, unknown>; label: string } | null | undefined;
}

export interface AttentionGroup {
  key: 'approvals' | 'proposals' | 'blockers' | 'documents' | 'starting' | 'leaving' | 'probation';
  count: number;
  items: AttentionItem[];
  link: string;
}

export interface PayPanelData {
  schedules: { schedule: string; name: string; entity: string; entity_name: string; currency: string; frequency: string; people: number; pay_date: string; cutoff_day: string; days_to_pay: number; days_to_cutoff: number; run: { id: string; number: string; status: string } | null }[];
  blockers: { payrun: string; number: string; entity_name: string; blockers: number; link: string }[];
}

export interface BoardPerson {
  employment: string;
  employee: string;
  name: string;
  title: string;
  state: string;
  late_min: number;
  first_in_time: string;
  last_out_time: string;
  holiday: string;
  leave: { type: string; name: string; half: string } | null;
  /** The shift has ended without a clock record (time not tracked for them). */
  shift_over: boolean;
}

/** Today's clock: the time module's clock.status answer, read inside the page's read. */
export type ClockToday = ClockStatus;

export interface SetupSteps {
  steps: { key: string; label: string; done: boolean; link: string }[];
  done: number;
  total: number;
}

export interface SeriesPoint {
  month: string;
  headcount: number;
  joined: number;
  left: number;
  gross_minor: number | null;
  employer_minor: number | null;
}

/** One office on the company globe (lib_home_globe.js): an entity, or a location when the company has one entity. */
export interface GlobeOffice {
  key: string;
  kind: 'entity' | 'location';
  id: string;
  entity: string;
  entity_name: string;
  name: string;
  code: string;
  country: string;
  lat: number;
  lng: number;
  /** Where the coordinates come from: the location's own, or the centre of its region or country. */
  source: 'location' | 'region' | 'country' | 'none';
  timezone: string;
  headcount: number;
  /** null without access to Time. */
  in_now: number | null;
  remote: number | null;
  on_leave: number;
  open_roles: number;
  /** Clock-ins in the last half hour (null without access to Time). */
  ins_recent: number | null;
  last_in: string;
  /** The next pay day of its schedules ('' without payroll access). */
  next_pay: string;
}

/** A person at their desk in the office view: the employee number (for the profile), name, title and today's state. */
export interface OfficePerson {
  id: string;
  name: string;
  title: string;
  /** unknown: the viewer has no access to Time (on leave still shows). */
  state: 'in_now' | 'remote' | 'on_leave' | 'late' | 'not_in' | 'unknown';
  late_min: number;
  /** Minutes since today's clock-in (in now only). */
  since_min: number | null;
}

/** One floor of the office view: an entity with its departments (rooms) and people. */
export interface OfficeFloor {
  entity: string;
  name: string;
  code: string;
  country: string;
  city: string;
  timezone: string;
  local_time: string;
  headcount: number;
  in_now: number | null;
  remote: number | null;
  on_leave: number;
  departments: { id: string; name: string; people: OfficePerson[] }[];
  /** People not drawn (past the cap). */
  more: number;
}

export interface GlobeAnswer {
  mode: 'entities' | 'locations';
  head: string;
  time_visible: boolean;
  offices: GlobeOffice[];
  totals: { in_now: number | null; remote: number | null; on_leave: number; open_roles: number };
  next_pay: { day: string; at: string; days: number; entity: string; entity_name: string; schedule: string; people: number } | null;
  /** Gross plus employer cost of this month's calculated and later runs (with pay access). */
  payroll_month: { month: string; currency: string; minor: number | null; parts: { currency: string; minor: number }[]; runs: number; locked: number } | null;
  /** The office view: one floor per entity, head first. */
  floors: OfficeFloor[];
}

export interface AdminHome {
  today: string;
  company: { name: string; reporting_currency: string; entities: number };
  series: SeriesPoint[];
  readouts: {
    headcount: number;
    headcount_month_ago: number | null;
    joined_month: number;
    left_month: number;
    starting_30: number;
    leaving_30: number;
    out_today: number;
    open_roles: number;
    cost_month: string;
    /** The last paid month's cost in cost_currency; null when part of it has no rate (see cost_month_parts). */
    cost_month_minor: number | null;
    /** The last paid month's cost in each pay currency (gross plus employer), largest first. */
    cost_month_parts: { currency: string; minor: number }[];
    cost_month_unconverted: string[];
    entities: number;
  };
  setup?: SetupSteps | undefined;
  pay: PayPanelData | null;
  /** The company globe (null before anyone is in). */
  globe: GlobeAnswer | null;
  team: { people: BoardPerson[] } | null;
  cost_missing_fx: { month: string; currency: string }[];
  /** The currency of the cost series: the reporting currency, or the one pay currency when no rate to it is known. */
  cost_currency: string;
  pay_visible: boolean;
  attention: AttentionGroup[];
  agent: {
    done_30: number;
    proposals_accepted_30: number;
    actions: { id: string; op: string; summary: string; at: string }[];
  };
}

export interface ManagerHome {
  today: string;
  manager: boolean;
  direct: number;
  team: number;
  readouts: { out_today: number; leave_days_month: number; probation_30: number; starting_30: number };
  attention: AttentionGroup[];
  people: { employee: string; employment: string; number: string; name: string; title: string; depth: number }[];
  board: { people: BoardPerson[] } | null;
  clock: ClockToday | null;
}

export interface MeEmployment {
  id: string;
  number: string;
  entity: string;
  entity_name: string;
  currency: string;
  country: string;
  status: string;
  start_day: string;
  end_day: string;
  probation_end: string;
  primary: boolean;
  title: string;
  department: string;
  department_name: string;
  location_name: string;
  manager: { number: string; name: string } | null;
}

export interface MeHomeData {
  today: string;
  employee: { id: string; number: string; name: string; legal_name: string; photo: boolean; work_email: string; phone: string; status: string } | null;
  employments: MeEmployment[];
  /** Every module's facts on me (the kernel's ProfileFact shape, drawn with FactValue). */
  facts: { module: string; facts: ProfileFact[] }[];
  documents: { id: string; title: string; category: string; source: string; created: string; expires: string }[];
  answers: { id: string; question: string; status: string; answer: string; created: string; done_at: string; ask: AgentAsk | null }[];
  requests_pending: number;
  requests: import('../../pages/me/parts.tsx').RequestRow[];
  requests_total: number;
  clock: ClockToday | null;
  hub: { tasks_open: number; to_read: number; last_payslip: { id: string; pay_date: string } | null; kiosk_pin: boolean } | null;
}

export interface DirectoryRow {
  employee: string;
  number: string;
  name: string;
  title: string;
  department: string;
  department_name: string;
  location_name: string;
  entity_name: string;
  work_email: string;
  manager_name: string;
  photo: boolean;
}

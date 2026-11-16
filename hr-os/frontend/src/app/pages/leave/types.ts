/** Leave shapes as the leave operations answer them (pb/pb_hooks/lib_leave*.js). */

export type Unit = 'day' | 'hour';
export type LeaveColor = 'rh' | 'lh' | 'good' | 'warn' | 'bad' | 'ink';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn' | 'cancelling';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  entity: string;
  entity_name?: string;
  country: string;
  paid: boolean;
  unit: Unit;
  color: LeaveColor;
  icon: string;
  allow_half: boolean;
  allow_hours: boolean;
  allow_negative: boolean;
  max_negative: number;
  attachment_after_days: number;
  min_notice_days: number;
  max_consecutive_days: number;
  counts_holidays: boolean;
  counts_weekends: boolean;
  statutory: boolean;
  gender_specific: string;
  encashable: boolean;
  payout_on_exit: boolean;
  comp_off: boolean;
  /** In leave.mine: the type this person asked for most in the last year (a new request opens with it). */
  usual?: boolean | undefined;
  visibility: 'type' | 'away';
  pay_code: string;
  note: string;
  sort: number;
  archived: boolean;
  source: string;
  used?: number;
  tracked?: boolean;
  available?: number | null;
  method?: string;
}

export interface Expiring {
  /** The last day to use them. */
  day: string;
  /** The day they are gone. */
  expires?: string;
  amount: number;
}

export interface Balance {
  type: string;
  type_id: string;
  name: string;
  icon: string;
  color: LeaveColor;
  unit: Unit;
  paid: boolean;
  day: string;
  tracked: boolean;
  in_policy: boolean;
  method: string;
  balance: number | null;
  available: number | null;
  taken: number;
  granted: number;
  carried?: number;
  booked: number;
  pending: number;
  expiring: Expiring[];
  period: { start: string; end: string; kind?: string };
  allow_negative?: boolean;
  max_negative?: number;
  explain?: ExplainLine[];
  projection?: { day: string; balance: number; available: number; estimate: boolean };
  lots?: { key: string; day: string; remaining: number; expires: string }[];
  rule?: Rule | null;
  policy?: { id: string; name: string; from: string } | null;
  person?: Person;
  employment?: string;
}

export interface ExplainLine {
  day: string;
  to?: string;
  kind: string;
  label: string;
  key?: string;
  ref?: string;
  amount: number;
  balance: number;
  note?: string;
  expires?: string;
  estimate?: boolean;
}

export interface Person {
  id: string;
  number: string;
  name: string;
  member?: string;
}

export interface DayPart {
  day: string;
  days: number;
  amount: number;
  hours: number;
  half: '' | 'am' | 'pm';
}

export interface Warning {
  code: string;
  severity: 'stop' | 'block' | 'warn' | 'info';
  message: string;
  overridden?: boolean;
}

export interface LeaveRequest {
  id: string;
  employment: string;
  employee: string;
  number: string;
  name: string;
  entity: string;
  type: string;
  type_id: string;
  type_name: string;
  color: LeaveColor;
  icon: string;
  paid: boolean;
  start: string;
  end: string;
  start_half: '' | 'am' | 'pm';
  end_half: '' | 'am';
  hours: number;
  days: number;
  amount: number;
  unit: Unit;
  day_list?: DayPart[];
  reason: string;
  has_attachment: boolean;
  status: RequestStatus;
  approval: string;
  cancel_approval: string;
  cancel_from: string;
  cancel_reason: string;
  decided_note: string;
  decided_at: string;
  requested_by: string;
  actor: string;
  warnings: Warning[];
  recorded: boolean;
  created: string;
  away_only?: boolean;
}

export interface CheckResult {
  employment: string;
  person: Person;
  type: LeaveType;
  method: string;
  start: string;
  end: string;
  days: number;
  amount: number;
  unit: Unit;
  day_list: DayPart[];
  holidays: { day: string; name: string; half: boolean }[];
  before: number | null;
  after: number | null;
  warnings: Warning[];
  clashes: LeaveRequest[];
  needs_attachment: boolean;
  can_submit: boolean;
  can_override: boolean;
}

export interface Obligation {
  employment?: string;
  number?: string;
  name?: string;
  type?: string;
  type_name?: string;
  base: string;
  deadline: string;
  granted: number;
  taken: number;
  planned: number;
  short: number;
  days_left: number;
  status: 'done' | 'on_track' | 'at_risk' | 'missed';
}

export interface Encash {
  id: string;
  employment: string;
  number: string;
  name: string;
  type: string;
  type_name: string;
  days: number;
  reason: string;
  status: string;
  approval: string;
  pay_on: string;
  payrun: string;
  paid_at: string;
  reserved_for?: string;
  kind?: 'voluntary' | 'exit';
  separation?: string;
  pay_history?: { event: string; payrun: string; replaced_by?: string; at: string; note?: string }[];
  decided_note: string;
  created: string;
}

export interface CompOff {
  id: string;
  employment: string;
  number: string;
  name: string;
  type: string;
  type_name: string;
  worked_day: string;
  hours: number;
  days: number;
  reason: string;
  status: string;
  approval: string;
  expires: string;
  decided_note: string;
  created: string;
}

export interface Mine {
  employment: string | null;
  reason?: string;
  person: Person;
  entity: { id: string; name: string; country: string; week_start: number };
  today: string;
  start_day: string;
  end_day: string;
  balances: Balance[];
  types: LeaveType[];
  upcoming: LeaveRequest[];
  history: LeaveRequest[];
  obligation: Obligation[];
  encash: Encash[];
  comp_offs: CompOff[];
  employments: { id: string; number: string; entity_name: string }[];
  access: string;
}

export interface Home {
  today: string;
  week_end: string;
  mode: 'all' | 'team' | 'peers';
  people: number;
  out_today: LeaveRequest[];
  out_week: LeaveRequest[];
  waiting: LeaveRequest[];
  waiting_total: number;
  waiting_other: { encash: number; comp_off: number };
  setup: { entity: string; name: string; country: string }[];
}

export interface Attention {
  day: string;
  mode: string;
  attention: {
    obligation: (Obligation & { employment: string; number: string; name: string })[];
    expiring: { employment: string; number: string; name: string; type: string; type_name: string; color: LeaveColor; icon: string; unit: Unit; amount: number; day: string; expires?: string }[];
    negative: { employment: string; number: string; name: string; type: string; type_name: string; unit: Unit; balance: number }[];
  };
}

export interface CalRow {
  employment: string;
  employee: string;
  number: string;
  name: string;
  title: string;
  department: string;
  department_name: string;
  entity: string;
  calendar: string;
  week_off: number[];
  start_day: string;
  end_day: string;
  self: boolean;
}

export interface Block {
  id: string;
  entity: string;
  entity_name: string;
  department: string;
  department_name: string;
  from: string;
  to: string;
  reason: string;
  types: string[];
  allow: { id: string; name: string; number: string }[];
}

export interface CalendarData {
  from: string;
  to: string;
  today: string;
  mode: 'all' | 'team' | 'peers';
  rows: CalRow[];
  bars: LeaveRequest[];
  holidays: Record<string, { day: string; name: string; half: boolean; kind: string }[]>;
  blocks: Block[];
  legend: { code: string; name: string; color: LeaveColor; icon: string }[];
}

export interface Rule {
  type: string;
  method: string;
  amount?: number;
  tenure?: { after: number; amount: number }[];
  tenure_unit?: 'years' | 'months';
  tenure_at?: 'period_start' | 'anniversary';
  eligible_after_months?: number;
  proration?: 'join' | 'none';
  rounding?: 'half' | 'whole' | 'none';
  accrual_day?: 'start' | 'end' | 'daily';
  per_hours?: { per: number; earn: number };
  max_balance?: number;
  expiry?: 'period' | 'grant';
  carryover_max?: number;
  carryover_expiry_months?: number;
  grant_expiry_months?: number;
  scale?: 'none' | 'fte' | 'days_per_week';
  scale_cap?: number;
  deduct_holidays?: boolean;
  includes?: string[];
  encash_max?: number;
  max_hours_per_year?: number;
  first_after_months?: number;
  obligation?: boolean;
  note?: string;
}

export interface Policy {
  id: string;
  name: string;
  entity: string;
  entity_name: string;
  country: string;
  period_start: string;
  rules: Rule[];
  versions: { from: string; by: string; at: string; types: number }[];
  note: string;
  builtin: boolean;
  archived: boolean;
  is_default: boolean;
  people: number;
  updated: string;
}

export interface RegisterRow {
  employment: string;
  number: string;
  name: string;
  department_name: string;
  hire_day: string;
  base: string;
  deadline: string;
  carried: number;
  granted: number;
  basis: string;
  taken: { request: string; start: string; end: string; days: number; hours: number; applied: string; approved: string }[];
  taken_days: number;
  taken_hours: number;
  remaining: number;
  obligation: string;
  keep_until: string;
}

export interface BalanceTable {
  entity: string;
  day: string;
  types: LeaveType[];
  rows: { employment: string; number: string; name: string; department_name: string; balances: Record<string, { balance: number | null; available: number | null; taken: number; pending: number; booked: number; expiring: Expiring | null; unit: Unit }> }[];
  total: number;
  type_count: number;
  mode: string;
}

export interface ApprovalContext {
  kind: string;
  person: Person;
  title: string;
  today: string;
  request?: LeaveRequest;
  action?: 'request' | 'cancel';
  balance?: { unit: Unit; before: number | null; after: number | null; name: string } | null;
  away?: LeaveRequest[];
  blocks?: { id: string; from: string; to: string; reason: string }[];
  warnings?: Warning[];
  holidays?: { day: string; name: string; half: boolean }[];
  encash?: Encash;
  comp_off?: CompOff;
  worked?: { day: string; holiday: { day: string; name: string } | null; rest_day: boolean; scheduled_minutes: number };
}

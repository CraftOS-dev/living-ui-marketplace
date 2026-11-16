/** Shapes of the time operations' answers (pb_hooks/lib_time*.js). */
import type { AgentAsk } from '../../components/agent.tsx';

/** A week of timesheets your AI agent was asked to check (timesheet-reviews.*). */
export interface TimesheetCheck {
  id: string;
  entity: string;
  entity_name: string;
  from: string;
  to: string;
  team: boolean;
  source: 'person' | 'weekly';
  status: 'asked' | 'done' | 'cancelled';
  result: { note: string; people: number; proposals: string[]; anomalies: { employment: string; day: string; note: string }[] } | null;
  asked_by_name: string;
  agent: AgentAsk | null;
  created: string;
}

export type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';
export type ClockState = 'out' | 'in' | 'break';

export interface Punch {
  id: string;
  employment: string;
  at: string;
  day: string;
  time: string;
  kind: PunchKind;
  source: 'web' | 'phone' | 'kiosk' | 'import' | 'agent' | 'manual' | 'request';
  location: string;
  location_name?: string | undefined;
  flagged: boolean;
  flags: string[];
  note: string;
  voided: boolean;
  void_reason: string;
  distance_m: number;
  name?: string | undefined;
  number?: string | undefined;
}

export interface Plan {
  kind: 'work' | 'rest' | 'holiday' | 'outside';
  source: 'shift' | 'schedule' | 'none';
  shift_type?: string | undefined;
  shift_name: string;
  start: string;
  end: string;
  overnight?: boolean | undefined;
  break_min?: number | undefined;
  expected_min: number;
  holiday: { name: string; half: boolean } | null;
  leave?: { type: string; name: string; half: string; hours: number } | null | undefined;
  location?: string | undefined;
}

export interface Attendance {
  id: string;
  employment: string;
  day: string;
  status: AttStatus;
  day_kind: 'work' | 'rest' | 'holiday';
  first_in_time: string;
  last_out_time: string;
  worked_min: number;
  break_min: number;
  expected_min: number;
  late_min: number;
  early_min: number;
  overtime_min: number;
  night_min: number;
  leave_type: string;
  source: 'auto' | 'manual' | 'request' | 'import';
  locked: boolean;
  /** A locked day that changed afterwards (a late punch): the difference goes to the next pay run. */
  adjusted_after_lock: boolean;
  /** What the day is now (the row keeps what was paid). */
  after_lock: { status: AttStatus; worked_min: number; night_min: number; leave_min: number; late_min: number } | null;
  flags: string[];
  note: string;
  name?: string | undefined;
  number?: string | undefined;
}

export type AttStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekly_off' | 'remote' | 'on_duty';

export interface ClockStatus {
  employment: { id: string; number: string; entity: string; entity_name: string };
  employments: { id: string; number: string; entity: string; entity_name: string }[];
  today: string;
  zone: string;
  now: string;
  time: string;
  plan: Plan;
  state: ClockState;
  since: string;
  since_time: string;
  next: PunchKind[];
  punches: Punch[];
  worked_min: number;
  break_min: number;
  location: { id: string; name: string; lat: number | null; lng: number | null; radius_m: number; geofence: boolean } | null;
  ask_location: boolean;
  attendance: Attendance | null;
  kiosk_pin: boolean;
}

export type BoardState = 'in' | 'break' | 'out' | 'late' | 'absent' | 'on_leave' | 'remote' | 'on_duty' | 'expected' | 'off' | 'untracked' | 'none';

export interface Readouts {
  over: number;
  in: number;
  break: number;
  out: number;
  late: number;
  absent: number;
  on_leave: number;
  remote: number;
  expected: number;
  off: number;
  untracked: number;
  scheduled: number;
}

export interface BoardRow {
  employment: string;
  employee: string;
  number: string;
  name: string;
  title: string;
  location: string;
  location_name: string;
  department: string;
  department_name: string;
  state: BoardState;
  /** Untracked (no clock) and the shift has ended: "Shift over". */
  shift_over: boolean;
  late_min: number;
  first_in_time: string;
  last_out_time: string;
  shift: { name: string; start: string; end: string; source: string } | null;
  holiday: string;
  leave: { type: string; name: string; half: string } | null;
  worked_min: number;
  flagged: boolean;
  flags: string[];
  tracking: 'punch' | 'exception';
}

export interface Board {
  day: string;
  today: string;
  is_today: boolean;
  readouts: Readouts;
  by_location: { id: string; name: string; people: number; counts: Readouts }[];
  by_department: { id: string; name: string; people: number; counts: Readouts }[];
  people: BoardRow[];
}

export interface ShiftType {
  id: string;
  entity: string;
  name: string;
  code: string;
  start: string;
  end: string;
  break_min: number;
  minutes: number;
  color: 'grey' | 'blue' | 'teal' | 'ink';
  overnight: boolean;
  grace_in_min: number;
  grace_out_min: number;
  half_day_below_min: number;
  absent_below_min: number;
  auto_attendance: boolean;
  location: string;
  sort: number;
  archived: boolean;
}

export interface Cell {
  id: string;
  employment: string;
  day: string;
  shift_type: string;
  location: string;
  status: 'draft' | 'published' | 'removed';
  published_shift_type: string;
  changed: boolean;
}

export interface WeekCell {
  outside?: boolean | undefined;
  day: string;
  assignment: Cell | null;
  plan: { kind: string; source: string; start: string; end: string; minutes: number };
  holiday: string;
  leave: { type: string; name: string; half: string; hours: number } | null;
  conflict: string;
}

export interface WeekPerson {
  employment: string;
  employee: string;
  number: string;
  name: string;
  title: string;
  entity: string;
  location_name: string;
  department_name: string;
  cells: Record<string, WeekCell>;
  minutes: number;
  issues: { day: string; message: string }[];
  editable: boolean;
}

export interface Week {
  from: string;
  to: string;
  week_start: number;
  days: string[];
  people: WeekPerson[];
  shift_types: ShiftType[];
  types: Record<string, ShiftType>;
  totals: { day: string; shifts: number; minutes: number }[];
  unpublished: number;
  can: { edit: boolean; publish: boolean };
}

export interface MyDay {
  day: string;
  kind: string;
  source: string;
  shift_type: string;
  shift_name: string;
  shift_code: string;
  start: string;
  end: string;
  minutes: number;
  holiday: string;
  leave: { type: string; name: string; half: string } | null;
  location_name: string;
}

export interface ShiftRequest {
  id: string;
  employment: string;
  name: string;
  kind: 'change' | 'swap';
  from_day: string;
  to_day: string;
  shift_type: string;
  shift_name: string;
  swap_with: string;
  swap_name: string;
  swap_day: string;
  reason: string;
  status: 'awaiting_peer' | 'pending' | 'approved' | 'rejected' | 'declined' | 'cancelled';
  created: string;
}

export interface Pattern {
  id: string;
  entity: string;
  name: string;
  cycle: number;
  days: string[];
  note: string;
}

export interface MonthCell {
  status: AttStatus | '' | 'outside';
  code: string;
  worked_min?: number | undefined;
  late_min?: number | undefined;
  overtime_min?: number | undefined;
  source?: string | undefined;
  locked?: boolean | undefined;
  flags?: string[] | undefined;
  leave_type?: string | undefined;
  planned?: 'leave' | 'holiday' | 'off' | 'shift' | 'work' | undefined;
  shift_code?: string | undefined;
  future?: boolean | undefined;
}

export interface MonthRow {
  employment: string;
  number: string;
  name: string;
  title: string;
  department_name: string;
  cells: Record<string, MonthCell>;
  totals: { present: number; absent: number; half_day: number; late: number; leave: number; remote: number; worked_min: number; overtime_min: number; missing: number };
}

export interface Month {
  month: string;
  from: string;
  to: string;
  days: string[];
  people: MonthRow[];
  total: number;
}

export interface DayDetail {
  employment: string;
  employee: { id: string; number: string; name: string };
  day: string;
  plan: Plan;
  leave: { type: string; name: string; half: string } | null;
  attendance: Attendance | null;
  punches: Punch[];
  requests: AttRequest[];
  can: { edit: boolean; request: boolean };
}

export interface AttRequest {
  id: string;
  employment: string;
  name: string;
  number: string;
  kind: 'missed_punch' | 'correction' | 'remote' | 'on_duty';
  kind_label: string;
  from_day: string;
  to_day: string;
  half_day: boolean;
  in_time: string;
  out_time: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_note: string;
  created: string;
}

export interface OtRequest {
  id: string;
  employment: string;
  name: string;
  day: string;
  minutes: number;
  approved_min: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_note: string;
  created: string;
}

export type EntryKind = 'regular' | 'overtime' | 'leave' | 'holiday';

export interface Entry {
  id: string;
  day: string;
  kind: EntryKind;
  minutes: number;
  project: string;
  task: string;
  note: string;
  source: 'attendance' | 'person' | 'agent';
}

export interface Exception {
  day: string;
  code: string;
  message: string;
  severity: 'warning' | 'info' | 'blocker';
}

export interface SheetDay {
  day: string;
  status: string;
  kind: string;
  worked: number;
  regular: number;
  overtime: number;
  leave: number;
  late: number;
  flags: string[];
  future: boolean;
  outside?: boolean | undefined;
}

export interface Totals {
  regular_min: number;
  overtime_min: number;
  leave_min: number;
  holiday_min: number;
  total_min: number;
}

export interface Sheet {
  id: string;
  employment: string;
  employee: { id: string; number: string; name: string };
  period_start: string;
  period_end: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  note: string;
  decided_note: string;
  locked: boolean;
  entries: Entry[];
  totals: Totals;
  projects: { project: string; minutes: number }[];
  exceptions: Exception[];
  days: SheetDay[];
  tracking: 'punch' | 'exception';
  can?: { edit: boolean; submit: boolean; withdraw: boolean; reopen?: boolean | undefined } | undefined;
}

export interface SheetRow {
  id: string;
  employment: string;
  number: string;
  name: string;
  title: string;
  department_name: string;
  period_start: string;
  period_end: string;
  status: Sheet['status'];
  totals: Totals;
  exceptions: number;
  exception_codes: string[];
  locked: boolean;
}

export interface Rule {
  when: 'daily_over' | 'weekly_over' | 'monthly_over' | 'seventh_day' | 'rest_day' | 'holiday' | 'night';
  threshold_min: number;
  multiplier: number;
  component: string;
  from?: string | undefined;
  to?: string | undefined;
  dow?: number[] | undefined;
  note?: string | undefined;
}

export interface RuleSettings {
  tracking: 'exception' | 'punch';
  timesheets: 'optional' | 'required' | 'off';
  unapproved: '' | 'warning' | 'blocker';
  missing_punch: 'warning' | 'blocker';
  cap_severity: 'warning' | 'blocker';
  preapproval: boolean;
  counts_leave: boolean;
  week_start: number | null;
  auto_break_after_min: number;
}

export interface RuleSet {
  id: string;
  entity: string;
  entity_name: string;
  name: string;
  country: string;
  rules: Rule[];
  settings: RuleSettings;
  caps: Record<string, number | string>;
  applies: { employment_types?: string[] | undefined };
  active: boolean;
  source: string;
  notes: string;
  updated: string;
}

export interface KioskDevice {
  id: string;
  location: string;
  location_name: string;
  /** Only for people who may start kiosks. */
  code?: string | undefined;
  name: string;
  last_seen: string;
  revoked: boolean;
  created: string;
}

export interface KioskPerson {
  employee: string;
  employment: string;
  number: string;
  name: string;
  photo: boolean;
  state: ClockState;
  here: boolean;
  has_pin: boolean;
}

export interface KioskRoster {
  location: { id: string; name: string };
  entity: { id: string; name: string };
  zone: string;
  day: string;
  time: string;
  people: KioskPerson[];
}

export interface ReviewPerson {
  employment: string;
  number: string;
  name: string;
  missing: number;
  issues: { day: string; code: string; message: string; severity: string; planned: string; worked_min: number; punches?: { id: string; kind: PunchKind; time: string; source: string; flagged: boolean }[] | undefined }[];
}

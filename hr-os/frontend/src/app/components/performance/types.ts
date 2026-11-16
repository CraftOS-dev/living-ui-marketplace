/** Shapes of the performance operations' answers (pb/pb_hooks/lib_performance*.js). */
import type { AgentAsk } from '../agent.tsx';

export interface Chip {
  id: string;
  number: string;
  name: string;
  title: string;
  department_name: string;
  photo: boolean;
}

export type GoalStatus = 'on_track' | 'at_risk' | 'off_track' | 'done' | 'dropped';
export type GoalScope = 'personal' | 'team' | 'company';

export interface KeyResult {
  key: string;
  title: string;
  start: number;
  target: number;
  current: number;
  unit: string;
  pct: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  kind: 'goal' | 'kra' | 'okr';
  scope: GoalScope;
  employee: Chip | null;
  department: { id: string; name: string } | null;
  entity: string;
  cycle: { id: string; name: string } | null;
  parent: { id: string; title: string } | null;
  key_results: KeyResult[];
  progress_from: 'key_results' | 'aligned' | 'checkins';
  weight: number;
  progress: number;
  status: GoalStatus;
  start_day: string;
  due: string;
  last_checkin: string;
  origin: 'person' | 'agent';
  needs_update: boolean;
  reasons: ('at_risk' | 'off_track' | 'overdue' | 'due_soon' | 'stale')[];
  can: { edit: boolean };
  created: string;
}

export interface Checkin {
  id: string;
  at: string;
  who: string;
  actor: 'person' | 'agent' | 'system';
  note: string;
  progress_before: number;
  progress_after: number;
  status_before: string;
  status_after: string;
  key_results: { key: string; title: string; before: number; after: number; unit: string }[];
  goal_title?: string | undefined;
}

export interface GoalDetail extends Goal {
  checkins: Checkin[];
  children: Goal[];
  chain: { id: string; title: string; progress: number; scope: GoalScope }[];
}

export interface GoalList {
  goals: Goal[];
  total: number;
  counts: Partial<Record<GoalStatus, number>>;
  limit: number;
  offset: number;
  today: string;
}

export interface TreeNode {
  id: string;
  title: string;
  scope: GoalScope;
  kind: string;
  owner: Chip | null;
  department: string;
  progress: number;
  status: GoalStatus;
  due: string;
  parent: string;
  children: number;
}

export type PhaseKey = 'goals' | 'self' | 'peer' | 'upward' | 'manager' | 'calibration' | 'sharing';
export type ReviewKind = 'self' | 'manager' | 'peer' | 'upward';
export type CycleKind = 'annual' | 'half_year' | 'quarterly' | 'probation' | 'project';
export type Stage = 'open' | 'submitted' | 'shared' | 'acknowledged' | 'signoff' | 'signed' | 'removed';

export interface Phase {
  key: PhaseKey;
  start: string;
  end: string;
  label: string;
  state: 'upcoming' | 'open' | 'done';
  days_left: number;
}

export interface Scale {
  points: number;
  labels: string[];
}

export interface KindCount {
  total: number;
  submitted: number;
  declined: number;
}

export interface Cycle {
  id: string;
  name: string;
  kind: CycleKind;
  entity: string;
  entity_name: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'active' | 'closed';
  template: string;
  template_name: string;
  scale: Scale;
  phases: Phase[];
  participants_rule: { entities?: string[]; departments?: string[]; employees?: string[]; exclude?: string[]; started_before?: string; probation_ending?: boolean };
  launched_at: string;
  closed_at: string;
  note: string;
  counts: { reviews: Record<ReviewKind, KindCount>; stages: Partial<Record<Stage, number>>; participants: number };
  can: { run: boolean };
  my?: { participant: string; to_write: number } | null | undefined;
  template_snapshot?: Template | undefined;
}

export interface Section {
  key: string;
  kind: 'goals' | 'competencies' | 'questions';
  title: string;
  weight?: number | undefined;
  kinds: ReviewKind[];
  rate?: boolean | undefined;
  items?: { key: string; name?: string | undefined; description?: string | undefined; text?: string | undefined; help?: string | undefined; required?: boolean | undefined }[] | undefined;
  goals?: { id: string; title: string; kind: string; weight: number; progress: number; status: GoalStatus; due: string; key_results: KeyResult[] }[] | undefined;
}

export interface Template {
  id?: string | undefined;
  name: string;
  description?: string | undefined;
  scale: Scale;
  sections: Section[];
  overall_kinds: ReviewKind[];
  builtin?: boolean | undefined;
  archived?: boolean | undefined;
  used_by?: number | undefined;
}

export interface ReviewStatus {
  self: { id: string; status: string; reviewer: string } | null;
  manager: { id: string; status: string; reviewer: string } | null;
  peer: { total: number; submitted: number };
  upward: { total: number; submitted: number };
}

export interface Participant {
  id: string;
  cycle: string;
  employee: Chip | null;
  employment: string;
  department: string;
  department_name: string;
  manager: Chip | null;
  title: string;
  stage: Stage;
  reviews: ReviewStatus;
  score: number | null;
  overall: number | null;
  final: number | null;
  rating: number | null;
  rating_label: string;
  calibrated: boolean;
  final_reason: string;
  shared_at: string;
  acknowledged_at: string;
  ack_comment: string;
  signoff: string;
  signed_at: string;
  returned_note: string;
  note: string;
}

export interface CalibrationEntry {
  at: string;
  by: string;
  by_name: string;
  from: number;
  to: number;
  from_label: string;
  to_label: string;
  reason: string;
}

export interface ReviewBrief {
  id: string;
  kind: ReviewKind;
  status: 'draft' | 'submitted' | 'declined';
  reviewer: Chip | null;
  anonymous: boolean;
  submitted_at: string;
  answers: Record<string, string>;
  ratings: Record<string, number>;
  overall: number;
  overall_label: string;
  score: number | null;
  hidden: boolean;
  declined_reason: string;
}

export interface Summary {
  id: string;
  review: string;
  status: 'requested' | 'ready' | 'used' | 'dismissed';
  text: string;
  sources: { kind: string; id: string; note: string }[];
  error: string;
  /** Your AI agent asked for this summary (review_summary_draft), or null. */
  agent: AgentAsk | null;
  created: string;
}

export interface Review extends ReviewBrief {
  cycle: { id: string; name: string; kind: CycleKind; status: string; period_start: string; period_end: string };
  employee: Chip;
  participant: Participant;
  scale: Scale;
  overall_enabled: boolean;
  sections: Section[];
  due: string;
  started_at: string;
  saved_at: string;
  mine: boolean;
  can: { write: boolean; submit: boolean; decline: boolean; reopen: boolean; request_summary: boolean };
  related?: ReviewBrief[] | undefined;
  summaries?: Summary[] | undefined;
}

export interface Owed {
  review: string;
  kind: ReviewKind;
  employee: Chip | null;
  cycle: { id: string; name: string };
  due: string;
  overdue: boolean;
  started: boolean;
}

export interface FeedbackRow {
  id: string;
  kind: 'praise' | 'feedback' | 'request';
  from: Chip | null;
  from_name: string;
  to: Chip | null;
  about: Chip | null;
  text: string;
  values: { code: string; name: string; icon: string; description: string }[];
  visibility: 'private' | 'manager' | 'public';
  status: '' | 'open' | 'answered' | 'declined';
  due: string;
  request: string;
  declined_reason: string;
  created: string;
  mine: boolean;
  can_delete: boolean;
  answer?: FeedbackRow | null | undefined;
}

export interface CompanyValue {
  code: string;
  name: string;
  description: string;
  icon: string;
}

export interface Settings {
  values: CompanyValue[];
  praise_wall: boolean;
  checkin_days: number;
  reminder_days: number;
  signoff_default: boolean;
  entities: { entity: string; name: string; country: string; signoff: boolean; own: boolean }[];
  value_icons: string[];
  can_edit: boolean;
}

export interface ComplianceRow {
  requirement: string;
  program: string;
  program_name: string;
  employee: Chip | null;
  state: 'done' | 'expiring' | 'due' | 'overdue';
  due: string;
  completed_on: string;
  expires_on: string;
  unverified: boolean;
  enrolled: { training: string; start: string } | null;
}

export interface Session {
  id: string;
  program: string;
  program_name: string;
  valid_months: number;
  title: string;
  kind: 'course' | 'workshop' | 'certification';
  provider: string;
  entity: string;
  start: string;
  end: string;
  start_time: string;
  end_time: string;
  location: string;
  link: string;
  capacity: number;
  seats_taken: number;
  full: boolean;
  status: 'planned' | 'open' | 'done' | 'cancelled';
  cost_minor: number;
  currency: string;
  trainer: string;
  description: string;
  my: { attendee: string; status: string; result: string; rating: number; has_feedback: boolean } | null;
}

export interface Attendee {
  id: string;
  program: string;
  training: string;
  employee: Chip | null;
  status: 'invited' | 'enrolled' | 'attended' | 'completed' | 'no_show' | 'cancelled';
  score: number;
  result: '' | 'pass' | 'fail';
  completed_on: string;
  expires_on: string;
  feedback: string;
  rating: number;
  has_certificate: boolean;
  verified: boolean;
  source: 'session' | 'external';
  note: string;
  program_name?: string | undefined;
  kind?: string | undefined;
  session?: { id: string; title: string; start: string; end: string; status: string } | null | undefined;
}

export interface Program {
  id: string;
  name: string;
  kind: 'course' | 'workshop' | 'certification';
  provider: string;
  description: string;
  duration_hours: number;
  valid_months: number;
  link: string;
  entity: string;
  archived: boolean;
  sessions: number;
  upcoming: number;
  completions: number;
  required: number;
}

export interface Requirement {
  id: string;
  program: string;
  program_name: string;
  program_kind: string;
  valid_months: number;
  entity: string;
  entity_name: string;
  department: string;
  department_name: string;
  job_title: string;
  job_title_name: string;
  due_days: number;
  due_day: string;
  active: boolean;
  note: string;
  counts?: { done: number; expiring: number; due: number; overdue: number } | undefined;
}

export interface SkillLib {
  id: string;
  name: string;
  category: string;
  description: string;
  levels: string[];
  expected: { job_title: string; job_title_name: string; level: number }[];
  archived: boolean;
  people?: number | undefined;
  avg_level?: number | undefined;
  verified?: number | undefined;
}

export interface MatrixCell {
  level: number;
  verified: boolean;
  entry: string;
  expected?: number | undefined;
}

export interface Matrix {
  scope: 'team' | 'department' | 'all' | 'me';
  people: { employee: Chip; cells: Record<string, MatrixCell>; gaps: number; can_verify: boolean; can_edit: boolean }[];
  skills: { id: string; name: string; category: string; description: string; levels: string[]; holders: number; avg_level: number }[];
  total: number;
  library_size: number;
}

export interface PerfHome {
  today: string;
  employee: Chip | null;
  hr: boolean;
  manager: boolean;
  cycles: Pick<Cycle, 'id' | 'name' | 'kind' | 'period_start' | 'period_end' | 'phases' | 'counts' | 'can'>[];
  owe: Owed[];
  to_acknowledge: { participant: string; review: string; cycle: { id: string; name: string }; shared_at: string }[];
  requests: FeedbackRow[];
  goals: Goal[];
  goals_total: number;
  team_goals_needing_update?: number | undefined;
  praise: FeedbackRow[];
  praise_total: number;
  trainings: ComplianceRow[];
  upcoming_trainings: Session[];
  team?: { people: number; reviews_missing: number; trainings_overdue: number } | undefined;
  settings: { values: CompanyValue[]; praise_wall: boolean };
}

/** Collections each view reads (for live reloads). */
export const READS = {
  goals: ['goals', 'goal_checkins'],
  reviews: ['reviews', 'review_participants', 'review_cycles', 'review_summaries', 'approvals'],
  feedback: ['feedback', 'perf_settings'],
  skills: ['skills', 'employee_skills'],
  training: ['trainings', 'training_attendees', 'training_programs', 'training_requirements'],
  settings: ['perf_settings', 'review_templates'],
};

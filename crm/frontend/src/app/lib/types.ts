/** What the operations return (see pb/pb_hooks/lib_query.js and friends). Money is in minor units. */

export type Obj = 'people' | 'companies' | 'deals';
export type Confidence = 'high' | 'medium' | 'low';
export type Actor = 'user' | 'agent' | 'import' | 'system';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  exponent: number;
}

export interface Prov {
  by: Actor | string;
  at: string;
  run: string;
  source: string;
}

export interface Policy {
  autonomy: Record<string, 'auto' | 'propose'>;
  auto_research: boolean;
  meeting_review: boolean;
  daily_brief: boolean;
  brief_hour: number;
  house_rules: string;
}

export interface Settings {
  id: string;
  workspace: string;
  owner_name: string;
  home_currency: string;
  keep_in_touch_default: number;
  policy: Policy;
  policy_kinds: Record<string, string>;
  setup_done: boolean;
  brief_last: string;
}

export interface Template {
  kind: string;
  name: string;
  stages: string[];
}

export interface Stage {
  id: string;
  pipeline: string;
  name: string;
  position: number;
  kind: 'open' | 'won' | 'lost';
  probability: number;
  rot_days: number;
  target_days: number;
  color: string;
  days?: number | undefined;
}

export interface Pipeline {
  id: string;
  name: string;
  kind: 'sales' | 'fundraising' | 'hiring' | 'partnerships' | 'other';
  currency: string;
  target: number;
  position: number;
  archived: boolean;
  stages: Stage[];
  open_deals: number;
}

export interface Base {
  id: string;
  tags: string[];
  custom: Record<string, unknown>;
  prov: Record<string, Prov>;
  deleted: string;
  created: string;
  updated: string;
  pending: number;
}

export interface Person extends Base {
  name: string;
  first_name: string;
  last_name: string;
  emails: string[];
  email: string;
  phones: string[];
  title: string;
  company: string;
  company_name: string;
  linkedin: string;
  location: string;
  birthday: string;
  how_met: string;
  source: string;
  keep_in_touch: number;
  last_interaction: string;
  next_touch: string;
  strength: number;
  touches: number;
  open_deals: number;
  lists: string[];
  agent_state: string;
  agent_note: string;
  role?: string | undefined;
}

export interface Company extends Base {
  name: string;
  domains: string[];
  domain: string;
  industry: string;
  size: string;
  location: string;
  description: string;
  linkedin: string;
  source: string;
  last_interaction: string;
  strength: number;
  people: number;
  open_deals: number;
  pipeline_value: number;
  lists: string[];
  agent_state: string;
  agent_note: string;
}

export interface Deal extends Base {
  name: string;
  pipeline: string;
  pipeline_name: string;
  stage: string;
  stage_name: string;
  stage_kind: 'open' | 'won' | 'lost';
  stage_color: string;
  status: 'open' | 'won' | 'lost';
  value: number;
  currency: string;
  home_value: number | null;
  weighted: number | null;
  probability: number;
  prob_override: number;
  expected_close: string;
  closed_at: string;
  lost_reason: string;
  company: string;
  company_name: string;
  people: { id: string; name: string; role: string }[];
  source: string;
  next_step: string;
  next_step_date: string;
  stage_entered: string;
  days_in_stage: number;
  last_activity: string;
  idle_days: number;
  rotting: boolean;
  over_target: boolean;
  rot_days: number;
  target_days: number;
  next_task: { id: string; title: string; due: string } | null;
  next_state: 'overdue' | 'today' | 'future' | 'none' | '';
  position: number;
}

export type AnyRecord = Person | Company | Deal;

export interface Ref {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  body: string;
  pinned: boolean;
  by: string;
  run: string;
  created: string;
  updated: string;
  person?: Ref | undefined;
  company?: Ref | undefined;
  deal?: Ref | undefined;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  due: string;
  done_at: string;
  snoozed_until: string;
  kind: 'todo' | 'call' | 'email' | 'meeting' | 'follow_up';
  state: 'overdue' | 'today' | 'upcoming' | 'snoozed' | 'done';
  by: string;
  run: string;
  created: string;
  updated: string;
  person?: Ref | undefined;
  company?: Ref | undefined;
  deal?: Ref | undefined;
}

export interface Email {
  id: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
  by: string;
  run: string;
  queued_at: string;
  sent_at: string;
  error: string;
  created: string;
  updated: string;
  person?: Ref | undefined;
  deal?: Ref | undefined;
}

export interface Interaction {
  id: string;
  kind: 'email' | 'call' | 'meeting' | 'message';
  direction: 'in' | 'out' | '';
  at: string;
  subject: string;
  summary: string;
  people: Ref[];
  company: Ref | null;
  deal: Ref | null;
  source: string;
  ext_id: string;
  by: string;
  run: string;
  agent_state: string;
  agent_note: string;
  created: string;
}

export interface Change {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface Proposal {
  id: string;
  kind: 'update' | 'deal_value' | 'stage' | 'close' | 'merge' | 'delete' | 'email';
  kind_label: string;
  object: string;
  target: string;
  target_name: string;
  title: string;
  changes: Change[];
  payload: Record<string, unknown> & { op: string };
  evidence: string;
  source: string;
  reason: string;
  confidence: Confidence | '';
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
  decided_at: string;
  applied: unknown;
  run: string;
  created: string;
  email?: Email | undefined;
}

export interface KindStat {
  kind: string;
  label: string;
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
  rate: number | null;
}

export type TimelineItem =
  | { type: 'interaction'; at: string; interaction: Interaction }
  | { type: 'note'; at: string; note: Note }
  | { type: 'task'; at: string; task: Task }
  | { type: 'email'; at: string; email: Email }
  | { type: 'stage'; at: string; stage: { from: string; to: string; to_kind: string; actor: string; run: string } }
  | { type: 'change'; at: string; change: { id: string; op: string; summary: string; changes: { field: string; before: unknown; after: unknown }[]; actor: string; run: string } };

export interface Employment {
  id: string;
  company: (Ref & { deleted: boolean }) | null;
  title: string;
  start: string;
  end: string;
  current: boolean;
}

export interface SmallDeal {
  id: string;
  name: string;
  stage_name: string;
  stage_color: string;
  stage_kind: string;
  status: string;
  value: number;
  currency: string;
  home_value: number | null;
  pipeline_name: string;
  expected_close: string;
  closed_at: string;
  rotting: boolean;
  role?: string | undefined;
}

export interface RecordDetail<T> {
  record: T;
  proposals: Proposal[];
  tasks: Task[];
  pinned: Note[];
  counts: { notes: number; tasks: number; emails: number };
  employments?: Employment[] | undefined;
  deals?: SmallDeal[] | undefined;
  lists?: { id: string; name: string; color: string }[] | undefined;
  people?: Person[] | undefined;
  alumni?: { id: string; name: string; title: string; end: string }[] | undefined;
  stages?: Stage[] | undefined;
  company?: Company | null | undefined;
}

export interface ListRec {
  id: string;
  name: string;
  object: 'people' | 'companies';
  color: string;
  position: number;
  description: string;
  count: number;
}

export interface Filter {
  field: string;
  op: string;
  value?: unknown;
}

export interface ViewRec {
  id: string;
  object: Obj;
  name: string;
  filters: Filter[];
  match: 'all' | 'any';
  sort: string;
  dir: 'asc' | 'desc';
  columns: string[];
  mode: 'table' | 'board';
  pipeline: string;
  position: number;
}

export interface FieldDef {
  id: string;
  object: Obj;
  key: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'select' | 'multi_select' | 'checkbox' | 'url' | 'rating';
  options: string[];
  ai_prompt: string;
  position: number;
}

export interface Summary {
  proposals: number;
  tasks_overdue: number;
  tasks_today: number;
  keep_in_touch: number;
  agent_working: number;
  agent_waiting: number;
  emails_queued: number;
  emails_failed: number;
  people: number;
  companies: number;
  open_deals: number;
}

export interface Ask {
  id: string;
  kind: 'question' | 'job' | 'explain' | 'brief';
  status: 'waiting' | 'working' | 'done' | 'failed';
  question: string;
  context: unknown;
  answer: string;
  links: { type: string; id: string; label: string }[];
  error: string;
  requested_at: string;
  run: string;
  created: string;
  updated: string;
}

export interface ActivityEntry {
  id: string;
  actor: string;
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

export interface Run {
  run: string;
  started: string;
  last: string;
  changes: number;
  undone: number;
  summaries: string[];
}

export interface Range {
  name: string;
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
}

export interface PipelineReport {
  pipeline: { id: string; name: string; kind: string; target: number; currency: string; target_home: number | null };
  stages: { id: string; name: string; color: string; probability: number; count: number; value: number; weighted: number; rotting: number }[];
  total: { count: number; value: number; weighted: number };
  won: { count: number; value: number };
  lost: number;
  no_rate: number;
  deals: Deal[];
}

export interface Forecast {
  months: { month: string; won: number; weighted: number; best: number; deals: number }[];
  undated: { count: number; value: number; weighted: number };
}

export interface WinStats {
  won: number;
  lost: number;
  won_value: number;
  lost_value: number;
  win_rate: number | null;
  avg_deal: number | null;
  cycle_days: number | null;
}

export interface WinLoss {
  from: string;
  to: string;
  stats: WinStats;
  previous?: WinStats | undefined;
  range?: Range | undefined;
  months: { month: string; won: number; lost: number; won_count: number; lost_count: number; win_rate: number | null }[];
  reasons: { reason: string; count: number; value: number }[];
  deals: Deal[];
}

export interface Funnel {
  pipeline: { id: string; name: string };
  from: string;
  to: string;
  deals: number;
  win_rate: number | null;
  stages: { id: string; name: string; kind: string; color: string; reached: number; pct: number; from_prev: number }[];
  range?: Range | undefined;
}

export interface StageTime {
  pipeline: { id: string; name: string };
  stages: { id: string; name: string; color: string; target_days: number; count: number; min: number | null; avg: number | null; max: number | null }[];
  range?: Range | undefined;
}

export interface Sources {
  from: string;
  to: string;
  deals: { source: string; deals: number; won: number; lost: number; won_value: number; open_value: number; win_rate: number | null }[];
  people: { source: string; count: number }[];
  range?: Range | undefined;
}

export interface ActivityReport {
  from: string;
  to: string;
  weeks: { week: string; email: number; call: number; meeting: number; message: number }[];
  by_kind: Record<string, number>;
  total: number;
  top_people: { id: string; name: string; count: number; strength: number }[];
  tasks_done: number;
  notes: number;
  range?: Range | undefined;
}

export interface PersonBrief {
  id: string;
  name: string;
  company_name: string;
  title: string;
  strength: number;
  last_interaction: string;
  next_touch: string;
  keep_in_touch: number;
  touches: number;
  birthday: string;
  in_days?: number | undefined;
}

export interface Relationships {
  total: number;
  mix: { strong: number; good: number; weak: number; none: number };
  cold: PersonBrief[];
  keep_in_touch: PersonBrief[];
  strongest: PersonBrief[];
  birthdays: PersonBrief[];
}

export interface DealBrief {
  id: string;
  name: string;
  company_name: string;
  stage_name: string;
  stage_color: string;
  pipeline_name: string;
  home_value: number | null;
  value: number;
  currency: string;
  expected_close: string;
  idle_days: number;
  days_in_stage: number;
  next_state: string;
  probability: number;
}

export interface Dashboard {
  currency: string;
  today: string;
  range: Range;
  pipelines: { id: string; name: string; kind: string }[];
  kpi: {
    open_value: number;
    open_count: number;
    weighted: number;
    won_value: number;
    won_count: number;
    won_prev_value: number;
    won_prev_count: number;
    win_rate: number | null;
    win_rate_prev: number | null;
    avg_deal: number | null;
    avg_deal_prev: number | null;
    cycle_days: number | null;
    cycle_prev: number | null;
    new_people: number;
    new_people_prev: number;
    touches: number;
    touches_prev: number;
    no_rate: number;
  };
  pipeline: PipelineReport | null;
  /** Fundraising and hiring pipelines, kept out of the revenue numbers. */
  others: Pick<PipelineReport, 'pipeline' | 'stages' | 'total' | 'won' | 'lost'>[];
  forecast: Forecast;
  months: WinLoss['months'];
  activity: ActivityReport;
  /** 12 weeks: interactions, people added, revenue deals created and their value. */
  trend: { week: string; touches: number; people: number; deals: number; deal_value: number }[];
  relationships: { mix: Relationships['mix']; cold: PersonBrief[]; strongest: PersonBrief[]; total: number };
  sources: Sources['deals'];
  attention: {
    overdue: number;
    today: number;
    tasks: Task[];
    rotting: DealBrief[];
    rotting_count: number;
    no_next_step: number;
    keep_in_touch: number;
    keep_list: PersonBrief[];
    birthdays: PersonBrief[];
    proposals: number;
    closing: DealBrief[];
  };
  agent: { runs: Run[]; proposals: number; working: number };
}

export interface ImportPreview {
  headers: string[];
  mapping: string[];
  fields: string[];
  rows: number;
  counts: { create: number; update: number; skip: number; conflict: number };
  sample: { row: number; action: 'create' | 'update' | 'skip' | 'conflict'; note: string; values: Record<string, string> }[];
}

export interface DupePair<T> {
  a: T;
  b: T;
  reason: string;
}

export interface FxRate {
  id: string;
  date: string;
  currency: string;
  rate: string;
  source: string;
}

export type CalendarKind = 'task' | 'close' | 'touch' | 'birthday' | 'meeting';

export interface CalendarEvent {
  date: string;
  kind: CalendarKind;
  title: string;
  /** The record it opens: people, deals or tasks (an empty type opens nothing). */
  type: string;
  id: string;
  sub: string;
  value?: number | null | undefined;
}

export interface CalendarMonth {
  month: string;
  from: string;
  to: string;
  events: CalendarEvent[];
}

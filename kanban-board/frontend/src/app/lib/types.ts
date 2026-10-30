/** The shapes the operations answer with (pb_hooks/lib_model.js and friends). */

export type Category = 'triage' | 'backlog' | 'todo' | 'doing' | 'review' | 'done' | 'canceled';
export type AgentState = '' | 'queued' | 'working' | 'needs_input' | 'needs_attention';
export type ReviewState = '' | 'pending' | 'approved' | 'changes' | 'rejected';
export type Tone = 'orange' | 'blue' | 'green' | 'purple' | 'teal' | 'pink' | 'yellow' | 'red' | 'gray';
export type LabelColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink';

/** Who a card is assigned to: you, the agent, or nobody (''). */
export type Assignee = '' | 'you' | 'agent';

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

export interface Question {
  kind: 'question' | 'plan' | 'criteria';
  text: string;
  options?: string[];
  by: string;
  at: string;
}

export interface Criterion {
  text: string;
  met: boolean;
  note?: string;
}

export interface ReviewPacket {
  by: string;
  at: string;
  summary: string;
  evidence: string[];
  unverified: string[];
  criteria: Criterion[];
  run?: string;
  attempt?: number;
  from?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'doing' | 'done' | 'skipped';
}

export interface Card {
  id: string;
  key: string;
  number: number;
  board: string;
  column: string;
  category: Category;
  title: string;
  priority: number;
  labels: Label[];
  due: string;
  estimate: number | null;
  checklist: { done: number; total: number };
  position: number;
  assignee: Assignee;
  created_by: string;
  proposed: boolean;
  agent_state: AgentState;
  lease_until: string;
  attempt: number;
  progress: string;
  attention: string;
  question: Question | null;
  review_state: ReviewState;
  blocked: boolean;
  blocked_reason: string;
  has_criteria: boolean;
  plan: { done: number; total: number };
  column_at: string;
  age_days: number;
  started_at: string;
  done_at: string;
  cost: number;
  version: number;
  archived: boolean;
  created: string;
  updated: string;
  /* inbox and review lists */
  board_name?: string;
  review_summary?: string;
}

export interface CardFull extends Card {
  description: string;
  acceptance: string;
  checklist_items: ChecklistItem[];
  plan_steps: PlanStep[];
  plan_ok: boolean;
  review: ReviewPacket | null;
  feedback: string;
  run: string;
  handoffs: number;
  work_column: string;
  column_name: string;
}

export interface Column {
  id: string;
  board: string;
  name: string;
  category: Category;
  position: number;
  wip: number;
  count: number | null;
  policy: string;
  instructions: string;
  agent: boolean;
  plan_first: boolean;
  need_criteria: boolean;
  need_checklist: boolean;
  next: string;
  return_to: string;
  lease_minutes: number;
  max_attempts: number;
  aging_days: number;
  collapsed: boolean;
}

export interface BoardStats {
  working: number;
  queued: number;
  needs_you: number;
  cards: number;
}

export interface Board {
  id: string;
  name: string;
  key: string;
  description: string;
  instructions: string;
  frozen: boolean;
  archived: boolean;
  swimlanes: 'none' | 'assignee' | 'priority';
  sort: number;
  created: string;
  updated: string;
  stats?: BoardStats;
}

export interface BoardDetail {
  board: Board;
  columns: Column[];
  cards: Card[];
  labels: Label[];
  rules: number;
  archived_cards: number;
}

export interface EventRec {
  id: string;
  board: string;
  card: string;
  actor_kind: 'you' | 'agent' | 'rule' | 'system';
  actor_id: string;
  kind: string;
  text: string;
  field: string;
  before: unknown;
  after: unknown;
  run: string;
  meta: Record<string, unknown>;
  reverted: boolean;
  created: string;
  revertible?: boolean;
  card_key?: string;
  card_title?: string;
  board_name?: string;
}

export interface RunRec {
  id: string;
  card: string;
  column: string;
  attempt: number;
  started: string;
  ended: string;
  outcome: 'working' | 'submitted' | 'asked' | 'returned' | 'failed' | 'expired' | 'stopped' | 'released' | 'planned';
  note: string;
  cost: number;
  decision: '' | 'approved' | 'changes' | 'rejected';
  decided: string;
  card_key?: string;
  card_title?: string;
  board_name?: string;
}

export interface CardDetail {
  card: CardFull;
  board: Board;
  column: Column;
  events: EventRec[];
  runs: RunRec[];
  columns: { id: string; name: string; category: Category; agent: boolean }[];
  labels: Label[];
}

export interface AgentStats {
  runs: number;
  submitted: number;
  asked: number;
  returned: number;
  failed: number;
  expired: number;
  stopped: number;
  approved: number;
  changes: number;
  rejected: number;
  approval_rate: number | null;
  first_pass_rate: number | null;
  median_minutes: number | null;
  cost: number;
}

export interface Settings {
  name: string;
  paused: boolean;
  attention: Record<string, 'interrupt' | 'inbox' | 'digest'>;
  defaults: { lease_minutes?: number; max_attempts?: number };
  max_working: number;
  last_seen: string;
}

export interface Inbox {
  needs: { reviews: Card[]; questions: Card[]; attention: Card[]; proposals: Card[]; blocked: Card[]; overdue: Card[] };
  count: number;
  updates: EventRec[];
  since: string;
}

export interface Template {
  id: string;
  label: string;
  description: string;
  columns: { name: string; category: Category; agent: boolean }[];
}

export interface Rule {
  id: string;
  board: string;
  name: string;
  enabled: boolean;
  when: string;
  column: string;
  days: number;
  conditions: { priority?: number[]; labels?: string[]; assignee?: string };
  actions: { do: string; [k: string]: unknown }[];
  position: number;
  runs: number;
  last_run: string;
  paused_reason: string;
}

export interface Flow {
  days: number;
  board: Board | null;
  columns: { id: string; name: string; category: Category; wip: number; count: number }[];
  kpis: { wip: number; throughput: number; by_agent: number; cycle_p50: number | null; cycle_p85: number | null; review_wait_hours: number | null; in_review: number; first_pass_rate: number | null };
  percentiles: { p50: number | null; p85: number | null; p95: number | null; agent_p50: number | null; you_p50: number | null };
  cycle: { key: string; title: string; done_at: string; days: number; kind: 'agent' | 'you' }[];
  throughput: { week_end: string; agent: number; you: number }[];
  aging: { key: string; id: string; title: string; column: string; column_name: string; age: number; kind: 'agent' | 'you'; state: AgentState; review: ReviewState }[];
  cfd: { day: string; backlog: number; todo: number; doing: number; review: number; done: number }[];
  agent: AgentStats;
}

/** The agent right now: paused, working, waiting (work queued for it) or idle. */
export interface AgentNow {
  status: 'paused' | 'working' | 'waiting' | 'idle';
  paused: boolean;
  working: number;
  queued: number;
  max_working: number;
  last_seen: string;
}

export interface NeedBrief {
  id: string;
  key: string;
  title: string;
  board: string;
  question: Question | null;
  attention: string;
  assignee: string;
  updated: string;
  column_at: string;
}

export interface AppState {
  settings: Settings;
  boards: Board[];
  agent: AgentNow;
  needs: { reviews: NeedBrief[]; questions: NeedBrief[]; attention: NeedBrief[]; proposals: NeedBrief[] };
  count: number;
  reviews: number;
}

export interface Status {
  paused: boolean;
  working: number;
  queued: number;
  max_working: number;
  needs_you: number;
}

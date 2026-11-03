/** What the operations answer (pb_hooks/lib_*.js). */

export type Confirms = Partial<Record<ConfirmKey, boolean>>;
export type ConfirmKey = 'under_3_min' | 'half_on_team' | 'covers_rest' | 'own_voice' | 'residency' | 'full_time_if_accepted' | 'one_application' | 'ip_clear' | 'goals_aligned' | 'metrics_true';

export interface Settings {
  cohort: string;
  deadline: string;
  deadline_note: string;
  cohorts: string[];
  next_cohort: string;
  status: 'preparing' | 'submitted' | 'interview' | 'accepted' | 'rejected';
  submitted_at: string;
  interview_at: string;
  decided_at: string;
  confirms: Confirms;
  confirm_list: { key: ConfirmKey; group: string; label: string; done: boolean }[];
  gather_state: 'idle' | 'requested' | 'working' | 'done' | 'failed';
  gather_request: string;
  gather_at: string;
  gather_summary: string;
  fill_state: 'idle' | 'requested' | 'filling' | 'filled' | 'stopped';
  fill_request: string;
  fill_at: string;
  fill_log: FillStep[];
  review_state: string;
  review_at: string;
}

export interface FillStep {
  at: string;
  section: string;
  status: 'started' | 'waiting' | 'filled' | 'mismatch' | 'stopped' | 'done';
  note: string;
}

export type StageState = 'done' | 'working' | 'todo' | 'blocked' | 'warn';

export interface Stage {
  key: 'gather' | 'team' | 'answers' | 'review' | 'video' | 'submit';
  title: string;
  state: StageState;
  line: string;
  route: string;
  anchor?: string;
  issues?: number;
  current: boolean;
  progress: number;
}

export interface Target {
  kind: 'answer' | 'team' | 'confirm' | 'settings';
  key?: string;
}

export interface Check {
  id: string;
  group: 'before' | 'team' | 'clarity' | 'idea' | 'traction' | 'video' | 'form';
  title: string;
  severity: 'blocker' | 'warning' | 'tip';
  status: 'pass' | 'fail' | 'wait' | 'na';
  detail: string;
  fix: string;
  why?: string;
  first: boolean;
  link: string;
  keys?: string[];
  confirm?: ConfirmKey;
  target: Target | null;
}

export interface FirstItem {
  id: string;
  title: string;
  fix: string;
  link: string;
  severity: Check['severity'];
}

export interface Totals {
  pass: number;
  fail: number;
  wait: number;
  blockers: number;
  warnings: number;
  tips: number;
}

export interface OddsItem {
  id: string;
  label: string;
  got: number;
  max: number;
  note: string;
  pending: boolean;
  check: string;
}

export interface OddsGroup {
  key: string;
  label: string;
  max: number;
  got: number;
  items: OddsItem[];
}

export interface Odds {
  ready: boolean;
  score: number;
  raw: number;
  percent: number | null;
  range: [number, number];
  band: string;
  rank: string;
  base_percent: number;
  confidence: string;
  pending: number;
  groups: OddsGroup[];
  caps: { limit: number; why: string; check: string }[];
  modifiers: { delta: number; why: string }[];
  moves: { id: string; label: string; gain: number; check: string; group: string }[];
  unit: string;
  note: string;
}

export interface Issue {
  type: string;
  label: string;
  quote: string;
  fix: string;
}

export interface Judge {
  restated: string;
  clear: boolean;
  answers_question: boolean;
  strength: number;
  issues: Issue[];
  missing: string[];
  shorter: string;
}

export interface Answer {
  key: string;
  section: string;
  label: string;
  short: string;
  type: 'long' | 'short' | 'url' | 'yesno' | 'number' | 'choice' | 'month' | 'date' | 'rows';
  /** For numbers: what the number counts. */
  unit: '' | 'usd' | 'percent' | 'count' | 'months';
  /** For rows: the columns of each row. */
  columns: { key: string; label: string; num?: boolean }[];
  limit: number;
  choices: string[];
  required: boolean;
  gate: { key: string; is: string } | null;
  open: boolean;
  by: 'fill' | 'draft' | 'founder';
  /** Written from the team page until someone writes it by hand. */
  derived: boolean;
  tip: string;
  words_hint: number;
  judged: boolean;
  value: string;
  origin: '' | 'person' | 'agent' | 'system';
  confirmed: boolean;
  suggestion: string;
  suggestion_why: string;
  source: string;
  need: string;
  judge: Judge | null;
  judge_state: 'none' | 'queued' | 'running' | 'done' | 'offline' | 'error';
  judged_at: string;
  judge_current: boolean;
  measures: { chars: number; words: number; em_dashes: number; over_limit: boolean; long: boolean };
  flags: number;
  /** Titles of failing checks that point at this answer. */
  failing_checks?: string[];
  edited_at: string;
  founder?: string;
  founder_name?: string;
  field?: string;
}

export interface Counts {
  questions: number;
  required: number;
  answered: number;
  missing: number;
  unconfirmed: number;
  flagged: number;
  needs: number;
  suggestions: number;
}

export interface AnswerList {
  sections: { key: string; label: string }[];
  counts: Counts;
  items: Answer[];
}

export interface Founder {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  x: string;
  /** Portfolio: personal website, project portfolio or side project. */
  website: string;
  country: string;
  state: string;
  city: string;
  citizenship: string;
  college: string;
  /** Highest education, one of the form's options or ''. */
  education: string;
  /** Years of professional experience; null until given. */
  years: number | null;
  technical: boolean | null;
  full_time: boolean | null;
  origin: string;
  confirmed: boolean;
  need: string;
  sort: number;
}

export interface Source {
  id: string;
  kind: string;
  url: string;
  file: string;
  disk_path: string;
  title: string;
  founder: string;
  state: 'new' | 'reading' | 'read' | 'failed';
  summary: string;
  error: string;
  origin: string;
  created: string;
}

export interface Message {
  id: string;
  role: 'person' | 'agent';
  text: string;
  state: string;
  request: string;
  reply_to: string;
  created: string;
}

export interface Activity {
  id: string;
  actor: 'person' | 'agent' | 'system';
  text: string;
  target: string;
  created: string;
}

export interface ReviewProgress {
  queued: number; offline: number; review_state: string; llm_down: boolean;
  active: boolean; stale: boolean; has_review: boolean; failed: boolean; manual: boolean;
}

export interface Pipeline {
  settings: Settings;
  stages: Stage[];
  sections: SectionSummary[];
  founders: { id: string; name: string; role: string; technical: boolean | null; full_time: boolean | null; years: number | null; confirmed: boolean }[];
  metrics: Record<string, number>;
  odds: Odds;
  totals: Totals;
  first: FirstItem[];
  top: Check[];
  counts: Counts;
  sources: Source[];
  review: { state: string; summary: string; fixes: string[]; progress: ReviewProgress };
  activity: Activity[];
}

export interface SectionSummary {
  key: string;
  label: string;
  total: number;
  answered: number;
  missing: number;
  unconfirmed: number;
  flagged: number;
  needs: number;
}

export interface ChecksList {
  totals: Totals;
  first: FirstItem[];
  checks: Check[];
  review: { state: string; progress: ReviewProgress };
}

export interface PacketFounder {
  id: string;
  form_block: string;
  name: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  phone: string;
  relevant_experience: string;
  country: string;
  state: string;
  city: string;
  citizenship: string;
  college: string;
  highest_education: string;
  years_of_experience: number | null;
  technical_end_to_end: boolean | null;
  full_time: boolean | null;
  linkedin_url: string;
  github_url: string;
  x_url: string;
  portfolio_url: string;
}

export interface Packet {
  cohort: string;
  apply_url: string;
  sections: { step: string; section: string; fields: { key: string; question: string; type: string; value: string; typed: string; required: boolean }[] }[];
  founders: PacketFounder[];
}

export interface Ready {
  ready: boolean;
  blockers: { id: string; title: string; detail: string; fix: string; target: Target | null }[];
  warnings: { id: string; title: string; detail: string; fix: string; target: Target | null }[];
  waiting: number;
}

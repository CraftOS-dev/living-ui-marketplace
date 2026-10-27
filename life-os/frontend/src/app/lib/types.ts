/**
 * What the operations return (pb_hooks/lib_*.js). Dates are local days
 * (YYYY-MM-DD); money is in minor units (cents) with `digits` decimals.
 */
import type { AreaKind } from '../components/art.tsx';

export type { AreaKind };

export interface Now {
  date: string;
  today: string;
  hour: number;
  minute: number;
  time: string;
  weekday: number;
  stamp: string;
  iso: string;
  offset_minutes: number;
}

export interface Place {
  city: string;
  region?: string | undefined;
  country: string;
  lat?: number | undefined;
  lon?: number | undefined;
  timezone?: string | undefined;
}

export interface Status {
  onboarded: boolean;
  owner_name: string;
  today: string;
  now: Now;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  areas: AreaKind[];
  goals: { id: string; title: string; area: AreaKind; progress: number }[];
  projects: { id: string; title: string; area: string }[];
  people: { id: string; name: string; look: number; circle: Circle }[];
  counts: { proposals: number; suggestions: number; answers: number; today_open: number; inbox: number; habits_due: number; habits_done: number };
  currency: string;
  digits: number;
  units: 'metric' | 'imperial';
  week_starts_on: number;
  place: Place | null;
  prompt: string;
  calendar: { enabled: boolean; state: string };
}

/* ---------------------------------------------------------------- world */

export interface WeatherHour {
  time: string;
  temp: number;
  code: number;
  rain: number;
  day: boolean;
}

export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
  rain: number;
  sunrise: string;
  sunset: string;
  uv: number;
}

export interface Weather {
  current: { time: string; temp: number; feels: number; code: number; day: boolean; humidity: number; wind: number; precipitation: number };
  hours: WeatherHour[];
  days: WeatherDay[];
  place: Place;
  units: 'metric' | 'imperial';
  fetched_at: string;
  stale: boolean;
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  published: string;
}

export interface News {
  topic: string;
  topics: string[];
  items: NewsItem[];
  stale: boolean;
  error: string;
}

/* ---------------------------------------------------------------- tasks */

export type Column = 'inbox' | 'today' | 'coming' | 'later' | 'done';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Recurrence {
  every: number;
  unit: 'day' | 'week' | 'month' | 'year';
  weekdays: number[];
}

export interface GoalBrief {
  id: string;
  title: string;
  progress: number;
  area?: AreaKind | undefined;
}

export interface PersonBrief {
  id: string;
  name: string;
  look: number;
  circle?: Circle | undefined;
  due?: boolean | undefined;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  area: AreaKind | '';
  project: { id: string; title: string } | null;
  goal: GoalBrief | null;
  person: PersonBrief | null;
  state: 'open' | 'done';
  stage: 'todo' | 'doing';
  column: Column;
  do_date: string;
  due_date: string;
  start_time: string;
  duration_min: number;
  someday: boolean;
  top: boolean;
  recurrence: Recurrence | null;
  checklist: ChecklistItem[];
  checked: number;
  overdue: boolean;
  late: boolean;
  done_at: string;
  done_date: string;
  rank: number;
  actor: 'person' | 'agent';
  history?: ActivityEntry[] | undefined;
}

export interface Board {
  today: string;
  columns: { key: Column; tasks: Task[] }[];
  meta: { done_today: number; events: number; planned_min: number; top: number; top_cap: number; weather: { code: number; max: number; min: number; rain: number } | null };
}

export interface WeekDay {
  date: string;
  is_today: boolean;
  past: boolean;
  tasks: Task[];
  events: { id: string; title: string; time: string; source: 'calendar' | 'plan' }[];
  weather: { code: number; max: number; min: number; rain: number } | null;
}

export interface Week {
  today: string;
  week_start: string;
  week_end: string;
  days: WeekDay[];
  inbox: Task[];
}

/* ------------------------------------------------------------- projects */

export interface Project {
  id: string;
  title: string;
  area: AreaKind | '';
  goal: GoalBrief | null;
  state: 'active' | 'someday' | 'done' | 'dropped';
  deadline: string;
  days_left: number | null;
  notes: string;
  look: number;
  rank: number;
  done_at: string;
  actor: string;
  counts?: { todo: number; doing: number; done: number } | undefined;
  progress?: number | undefined;
  next?: { id: string; title: string; stage: string } | null | undefined;
  steps?: { id: string; title: string; done: boolean; stage: string }[] | undefined;
}

export interface ProjectDetail extends Project {
  todo: Task[];
  doing: Task[];
  done: Task[];
}

/* ---------------------------------------------------------------- goals */

export type Measure = 'number_up' | 'number_down' | 'milestones' | 'tasks' | 'habits' | 'pot' | 'books' | 'weight' | 'none';
export type PaceState = 'ahead' | 'on_track' | 'behind' | 'none' | 'done';

export interface Milestone {
  id: string;
  text: string;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  area: AreaKind;
  state: 'active' | 'paused' | 'done' | 'dropped';
  measure: Measure;
  unit: string;
  baseline: number;
  target: number;
  current: number;
  pot: { id: string; name: string; saved: number; target: number } | null;
  milestones: Milestone[];
  start_date: string;
  deadline: string;
  days_left: number | null;
  purpose: string;
  progress: number;
  pace: number | null;
  pace_state: PaceState;
  last_activity: string;
  done_at: string;
  rank: number;
  source: string;
  actor: string;
}

export interface GoalDetail extends Goal {
  checkins: { id: string; date: string; value: number; note: string }[];
  tasks: Task[];
  habits: Habit[];
  projects: Project[];
  done_tasks: number;
}

/* --------------------------------------------------------------- habits */

export type CellState = 'before' | 'skip' | 'done' | 'part' | 'rest' | 'open' | 'miss';

export interface Habit {
  id: string;
  name: string;
  art: string;
  area: AreaKind | '';
  goal: GoalBrief | null;
  schedule: 'daily' | 'weekdays' | 'per_week';
  days: number[];
  times: number;
  target: number;
  unit: string;
  time_of_day: 'anytime' | 'morning' | 'afternoon' | 'evening';
  cue: string;
  /** Counts itself from the body log: glasses of water or calm minutes. */
  source: '' | 'water' | 'mind_min';
  started_on: string;
  archived: boolean;
  rank: number;
  actor: string;
  today: { value: number; done: boolean; skipped: boolean; due: boolean };
  streak: number;
  best: number;
  rate30: number | null;
  cells: { date: string; state: CellState; value: number }[];
  week: { done: number; times: number } | null;
}

export interface HabitDetail extends Habit {
  year: { date: string; state: CellState }[];
  notes: { date: string; note: string }[];
  total_done: number;
}

/* --------------------------------------------------------------- people */

export type Circle = 'partner' | 'friends' | 'family';

export interface Person {
  id: string;
  name: string;
  circle: Circle;
  area: AreaKind;
  relation: string;
  birthday: string;
  keep_in_touch_days: number;
  last_contact: string;
  days_since: number | null;
  due: boolean;
  overdue_by: number;
  next_birthday: { date: string; in_days: number; age: number | null } | null;
  look: number;
  links: string[];
  notes: string;
  archived: boolean;
  actor: string;
}

export interface Interaction {
  id: string;
  person: string;
  kind: 'talk' | 'message' | 'meet' | 'gift' | 'other';
  date: string;
  note: string;
  actor: string;
}

export interface PlanEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  area: AreaKind | '';
  place: string;
  person: PersonBrief | null;
  actor: string;
}

export interface PersonDetail extends Person {
  interactions: Interaction[];
  events: PlanEvent[];
  tasks: Task[];
}

/* --------------------------------------------------------------- health */

export interface HealthLog {
  date: string;
  water: number;
  sleep_h: number;
  steps: number;
  weight: number;
  mind_min: number;
}

export interface Workout {
  id: string;
  kind: 'walk' | 'run' | 'gym' | 'yoga' | 'bike' | 'swim' | 'sport' | 'dance';
  minutes: number;
  date: string;
  note: string;
  actor: string;
}

export interface HealthDay {
  log: HealthLog;
  goals: { water: number; sleep_h: number; steps: number };
  last_weight: { date: string; weight: number } | null;
  units: 'metric' | 'imperial';
  workouts: Workout[];
}

export interface HealthTrend {
  from: string;
  to: string;
  days: (HealthLog & { workout_min: number; workout_kinds: string[] })[];
  averages: { water: number | null; sleep_h: number | null; steps: number | null; mind_min: number | null };
  last_weight: { date: string; weight: number } | null;
  workouts: number;
}

/* ---------------------------------------------------------------- money */

export interface MoneyEntry {
  id: string;
  amount: number;
  kind: 'spend' | 'income';
  category: string;
  date: string;
  note: string;
  actor: string;
}

export interface Pot {
  id: string;
  name: string;
  target: number;
  saved: number;
  progress: number;
  look: number;
  done_at: string;
  actor: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  due_day: number;
  due_date: string;
  in_days: number;
  category: string;
  paid: boolean;
  late: boolean;
  active: boolean;
  actor: string;
}

export interface MoneyMonth {
  month: string;
  currency: string;
  digits: number;
  spent: number;
  income: number;
  budget: number;
  left: number | null;
  per_day_left: number | null;
  days_left: number;
  last_month_same_point: number;
  by_category: { category: string; amount: number }[];
  daily: { date: string; spent: number }[];
  entries: MoneyEntry[];
  bills: Bill[];
  pots: Pot[];
}

/* --------------------------------------------------------------- growth */

export interface Book {
  id: string;
  title: string;
  author: string;
  status: 'want' | 'reading' | 'done';
  pages: number;
  page: number;
  progress: number;
  rating: number;
  started_on: string;
  finished_on: string;
  look: number;
  actor: string;
}

export interface Shelf {
  reading: Book[];
  want: Book[];
  done: Book[];
  read_this_year: number;
}

export interface Learning {
  id: string;
  name: string;
  kind: 'language' | 'skill' | 'course';
  progress: number;
  minutes: number;
  last_practiced: string;
  days_since: number | null;
  note: string;
  archived: boolean;
  actor: string;
}

/* ------------------------------------------------------------------ fun */

export interface BucketItem {
  id: string;
  title: string;
  kind: 'place' | 'experience' | 'skill' | 'food' | 'other';
  note: string;
  done_on: string;
  actor: string;
}

export interface Trip {
  id: string;
  title: string;
  place: string;
  start_date: string;
  end_date: string;
  notes: string;
  checklist: ChecklistItem[];
  packed: number;
  in_days: number | null;
  nights: number;
  state: 'coming' | 'now' | 'past' | 'idea';
  actor: string;
}

/* ----------------------------------------------------------------- home */

export interface Chore {
  id: string;
  name: string;
  room: string;
  every_days: number;
  last_done: string;
  next_due: string;
  due_in: number;
  actor: string;
}

export interface ShoppingItem {
  id: string;
  text: string;
  done: boolean;
  done_at: string;
  actor: string;
}

/* ----------------------------------------------------------------- work */

export interface FocusSession {
  id: string;
  minutes: number;
  date: string;
  note: string;
  task: { id: string; title: string } | null;
  actor: string;
}

export interface Win {
  id: string;
  text: string;
  date: string;
  area: AreaKind | '';
  actor: string;
}

export interface FocusWeek {
  week_start: string;
  days: { date: string; minutes: number }[];
  total: number;
  today: number;
}

/* ------------------------------------------------------------ life map */

export interface Pulse {
  line: string;
  level: 'good' | 'ok' | 'attention' | 'quiet';
  value: number | null;
  unit: string;
  money?: number | undefined;
  people?: PersonBrief[] | undefined;
}

export interface AreaOut {
  kind: AreaKind;
  name: string;
  enabled: boolean;
  rank: number;
  goals: number;
  goal_progress: number | null;
  habits: number;
  open_tasks: number;
  pulse: Pulse;
  score: number | null;
}

export interface LifeOverview {
  today: string;
  areas: AreaOut[];
  goals: Goal[];
}

export interface AreaPage {
  today: string;
  area: AreaOut;
  goals: Goal[];
  done_goals: Goal[];
  habits: Habit[];
  tasks: Task[];
  projects: Project[];
}

/* ---------------------------------------------------------------- days */

export interface Day {
  date: string;
  mood: number;
  energy: number;
  agent_note: string;
  agent_note_at: string;
}

export interface MonthDay {
  date: string;
  mood: number;
  energy: number;
  done: number;
  habits: number;
  journal: number;
  workout_min: number;
  events: number;
}

/* -------------------------------------------------------------- journal */

export interface DayWeather {
  code: number;
  temp: number;
  max: number;
  min: number;
  city: string;
  units: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  body: string;
  mood: number;
  weather: DayWeather | null;
  tags: string[];
  has_photo: boolean;
  photo_key: string;
  privacy: 'private' | 'shared_with_agent';
  words: number;
  created: string;
  updated: string;
}

export interface Recap {
  week_start: string;
  week_end: string;
  numbers: { tasks_done: number; habit_days: number; workout_min: number; focus_min: number; books_finished: number; people: number; spent: number; journal: number };
  mood: { date: string; mood: number }[];
  best_day: string;
  wins: string[];
  goals_moved: { id: string; title: string; area: AreaKind; progress: number }[];
  agent_text: string;
  agent_written_at: string;
}

/* ----------------------------------------------------------------- home */

export interface Nudge {
  kind: 'birthday' | 'reach' | 'bill' | 'weather' | 'trip' | 'chores';
  text: string;
  area: AreaKind | '';
  person?: PersonBrief | undefined;
  id?: string | undefined;
}

export interface ComingItem {
  kind: 'plan' | 'birthday' | 'bill' | 'trip' | 'calendar' | 'task';
  id: string;
  title: string;
  date: string;
  time: string;
  area: AreaKind | '';
  look?: number | undefined;
  amount?: number | undefined;
}

export interface HomeSummary {
  date: string;
  now: { hour: number; part: 'morning' | 'afternoon' | 'evening' | 'night'; time: string; weekday: number };
  season: Status['season'];
  owner_name: string;
  onboarded: boolean;
  areas: AreaKind[];
  place: Place | null;
  day: Day;
  nudges: Nudge[];
  tasks: Task[];
  top_cap: number;
  habits: Habit[];
  health: { log: HealthLog; goals: { water: number; sleep_h: number; steps: number }; workouts: number };
  money: { spent: number; budget: number; left: number | null; per_day_left: number | null; currency: string; digits: number; by_category: { category: string; amount: number }[] } | null;
  people: { due: Person[]; birthdays: Person[]; count: number };
  coming: ComingItem[];
  journal: { latest: JournalEntry[]; photo: JournalEntry | null; streak: number };
  goals: Goal[];
  counts: { inbox: number; proposals: number; suggestions: number };
}

/* ---------------------------------------------------------------- agent */

export interface ProposalItem {
  key: string;
  kind: string;
  label: string;
  title: string;
  detail: string;
}

export interface Proposal {
  id: string;
  op: string;
  kind: string;
  title: string;
  summary: string;
  preview: { items?: ProposalItem[] | undefined; note?: string | undefined; fields?: Record<string, unknown> | undefined; changes?: Record<string, { from: unknown; to: unknown }> | undefined; [k: string]: unknown } | null;
  why: string;
  target_collection: string;
  target_id: string;
  status: 'waiting' | 'approved' | 'partly_approved' | 'rejected' | 'returned' | 'withdrawn' | 'stale';
  decision_note: string;
  decided_at: string;
  result: unknown;
  created: string;
}

export interface Suggestion {
  id: string;
  target_kind: 'tasks' | 'habits' | 'goals';
  target_id: string;
  target_title: string;
  field: string;
  value: unknown;
  shown: unknown;
  why: string;
  status: 'open' | 'accepted' | 'dismissed' | 'stale';
  created: string;
}

export interface Ask {
  id: string;
  question: string;
  about: 'life' | 'area' | 'goal' | 'habit' | 'person';
  target: string;
  status: 'waiting' | 'working' | 'answered' | 'failed';
  answer: string;
  failure: string;
  request: string;
  created: string;
  updated: string;
}

export interface Routine {
  id: string;
  kind: 'morning_note' | 'evening_checkin' | 'weekly_recap';
  enabled: boolean;
  time: string;
  days: number[];
  last_due: string;
  next_due: string;
  trigger: string;
  runs: { id: string; due: string; state: 'fired' | 'quiet' | 'missed' | 'refused'; note: string }[];
}

export interface ActivityEntry {
  id: string;
  actor: 'person' | 'agent' | 'system';
  op: string;
  label: string;
  target: string;
  record: string;
  batch: string;
  undoable: boolean;
  undone: boolean;
  detail: unknown;
  created: string;
}

export interface Settings {
  owner_name: string;
  onboarded: boolean;
  day_starts_hour: number;
  week_starts_on: 'monday' | 'sunday';
  units: 'metric' | 'imperial';
  currency: string;
  month_budget: number;
  city: string;
  region: string;
  country: string;
  water_goal: number;
  sleep_goal: number;
  steps_goal: number;
  reflections_to_agent: 'never' | 'when_shared';
  agent_autonomy: 'as_designed' | 'propose_all';
  quiet_start: string;
  quiet_end: string;
  calendar_enabled: boolean;
  calendar_id: string;
  home_rows: string[];
}

/** Shapes the operations answer with (pb_hooks/lib_*.js). */

export type Stage = 'new' | 'learning' | 'steady' | 'mastered';
export type Mode = 'listen' | 'learn' | 'play';
export type Hands = 'both' | 'right' | 'left';
export type InputKind = 'midi' | 'keyboard' | 'screen' | 'mic';
export type Strictness = 'lenient' | 'normal' | 'strict';

export interface Settings {
  name: string;
  daily_minutes: number;
  strictness: Strictness;
  input: InputKind | '';
  midi_device: string;
  latency_ms: number;
  other_hand: boolean;
  metronome: boolean;
  count_in: boolean;
  view: 'roll' | 'sheet';
  note_names: boolean;
  volume: number;
  click_volume: number;
  coach_reviews: boolean;
  coach_plans: boolean;
  level: number;
  onboarded: boolean;
  last_song: string;
  coach_seen: string;
}

export interface AppState {
  settings: Settings;
  unread: number;
  pending: number;
  new_songs: number;
  agent_active: boolean;
  today: { day: string; minutes: number; goal: number };
  session: { id: string; minutes: number; runs: number } | null;
}

export interface SectionInfo {
  i: number;
  name: string;
  from: number;
  to: number;
  stage: Stage;
  best: number;
  next: number;
  acc: number | null;
  due: string;
  last: string;
  tries: number;
}

export interface Preview {
  lo: number;
  hi: number;
  n: [number, number, number, number][];
}

/* The parsed song (lib_abc.js). */
export interface Bar {
  n: number;
  t: number;
  len: number;
  src: number;
  meter: string;
}
/** [t, d, midi, hand (0 right, 1 left), finger, velocity, voice, bar index, staccato] */
export type NoteTuple = [number, number, number, number, number, number, number, number, number];
/** [midi, step, alter, octave, tie, finger, hold] */
export type EvKey = [number, string, number, number, number, number, number];
export interface Ev {
  t: number;
  d: number;
  r?: number;
  x?: number;
  w?: number;
  k?: EvKey[];
  tp?: [number, number, number];
  dyn?: string;
  st?: number;
}
export interface Model {
  v: number;
  meter: { num: number; den: number; label: string; q: number };
  beat: number;
  key: { fifths: number; mode: string; name: string; vex: string };
  tempo: number;
  pickup: boolean;
  bars: Bar[];
  voices: { id: string; name: string; hand: 'R' | 'L'; clef: string }[];
  events: Ev[][][];
  notes: NoteTuple[];
  total: number;
  /** Sustain pedal spans [down, up] in quarter notes (model v2). */
  pedal?: [number, number][];
  /** Chord symbols written in the notation: [time, symbol] (model v2). */
  chords?: [number, string][];
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  level: number;
  kind: 'piece' | 'exercise';
  bars: number;
  tempo: number;
  seconds: number;
  key: string;
  meter: string;
  hands: Hands;
  range: string;
  notes: number;
  source: 'starter' | 'agent' | 'you' | 'import';
  tags: string[];
  fav: boolean;
  seen: boolean;
  archived: boolean;
  note: string;
  note_at: string;
  created: string;
  status: 'new' | 'learning' | 'mastered';
  progress: {
    pct: number;
    last_at: string;
    runs: number;
    minutes: number;
    counts: Record<Stage, number>;
    due: number;
  };
  sections: SectionInfo[];
  preview?: Preview;
  abc?: string;
  model?: Model;
  request?: string;
  recent?: { day: string; mode: Mode; bars: string; hands: Hands; tempo: number; accuracy: number; clean: boolean }[];
}

export interface CheckResult {
  ok: boolean;
  errors: { line: number; message: string; voice?: string; bar?: number }[];
  warnings: { line: number; message: string }[];
  summary?: {
    title: string;
    composer: string;
    bars: number;
    key: string;
    meter: string;
    tempo: number;
    seconds: number;
    notes: number;
    hands: Hands;
    range: string;
    level: number;
    voices: string[];
  };
  sections?: { name: string; from: number; to: number }[];
}

export interface PlanBlock {
  i: number;
  kind: 'song' | 'lesson' | 'drill';
  lesson: string;
  skill: string;
  song: string;
  title: string;
  composer: string;
  song_kind: 'piece' | 'exercise' | '';
  from: number;
  to: number;
  section: string | null;
  whole: boolean;
  mode: Mode;
  tempo: number;
  bpm: number;
  hands: Hands;
  minutes: number;
  why: string;
  done: boolean;
}

export interface Plan {
  day: string;
  source: 'rules' | 'coach';
  status: 'proposed' | 'active' | 'done';
  note: string;
  blocks: PlanBlock[];
  minutes: number;
  goal: number;
  done: number;
}

export interface Home {
  day: string;
  goal: number;
  level: number;
  today: { minutes: number; runs: number };
  streak: number;
  week: { day: string; minutes: number; accuracy: number | null; runs: number }[];
  series: { day: string; minutes: number; accuracy: number | null; runs: number }[];
  heat: { day: string; minutes: number }[];
  totals: {
    minutes_7: number;
    minutes_prev_7: number;
    accuracy_7: number | null;
    accuracy_prev_7: number | null;
    sections: Record<Stage, number>;
    songs_mastered: number;
    songs: number;
    due: number;
  };
  current: Song[];
  resume: Song | null;
  coach: { id: string; kind: string; text: string; created: string } | null;
  unread: number;
}

export interface SongStats {
  song: Song;
  days: { day: string; minutes: number; runs: number; best: number; accuracy: number | null }[];
  ladders: { section: string; points: { day: string; best: number }[] }[];
  bars: { bar: number; expected: number; errors: number }[];
  play_runs: number;
}

export interface Message {
  id: string;
  role: 'you' | 'coach';
  kind: 'chat' | 'request' | 'review' | 'plan';
  text: string;
  song: string;
  session: string;
  reply_to: string;
  status: '' | 'pending' | 'answered' | 'failed';
  request_id: string;
  error: string;
  context: Record<string, unknown> | null;
  created: string;
  songs?: Song[];
}

export interface Session {
  id: string;
  day: string;
  started: string;
  ended: string;
  last_at: string;
  minutes: number;
  runs: number;
  songs: { song: string; title: string; minutes: number; runs: number }[];
  status: 'open' | 'closed';
  review: string;
  review_at: string;
  review_asked: boolean;
}

export interface RunResult {
  i: number;
  name: string;
  from: number;
  to: number;
  before: Stage;
  after: Stage;
  acc: number | null;
  clean: boolean;
  cold: boolean;
  best: number;
  cleans: number;
}

export interface SavedRun {
  run: { id: string; accuracy: number; clean: boolean; mode: Mode; tempo_pct: number };
  results: RunResult[];
  song: Song;
  session: Session;
  suggestion: { tempo: number; why: 'up' | 'hold' | 'down' | 'again' } | null;
  level_up: number;
}

/* Learning (lib_learn.js) */

export interface LessonInfo {
  key: string;
  unit: string;
  level: number;
  title: string;
  minutes: number;
  done: boolean;
  score: number;
  done_at: string;
}

export interface SkillInfo {
  key: string;
  title: string;
  track: string;
  drill: string;
  mastery: number;
  stars: number;
  attempts: number;
  items: number;
  avg_ms: number;
  level: number;
  best_level: number;
  last_at: string;
  data: Record<string, { best: number; acc: number; title: string; last: string }>;
  history: { d: string; s: number; a: number }[];
}

export interface PathItem {
  track: string;
  kind: 'lesson' | 'skill' | 'scales' | 'sight' | 'songs' | 'program';
  key: string;
  title: string;
  ok: boolean;
  need?: number;
  have?: number;
  level?: number;
  tempo?: number;
  types?: string[];
}

export interface PathLevel {
  level: number;
  name: string;
  done: boolean;
  met: number;
  total: number;
  tracks: Record<string, { done: number; total: number }>;
  items: PathItem[];
}

export interface LearnState {
  level: number;
  tracks: { key: string; title: string }[];
  units: { key: string; title: string }[];
  lessons: LessonInfo[];
  skills: SkillInfo[];
  path: PathLevel[];
  next: { lesson: { key: string; title: string; level: number; minutes: number; unit: string } | null; skill: { key: string; title: string; kind: string } | null };
}

export interface DrillSaved {
  skill: SkillInfo;
  score: number;
  sight_level: number;
  level_up: number;
}

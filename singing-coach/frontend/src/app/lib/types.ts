/** Shapes the operations answer with (pb_hooks/lib_*.js). */

export type Stage = 'new' | 'learning' | 'steady' | 'mastered';
export type Mode = 'listen' | 'echo' | 'sing' | 'solo';
export type Strictness = 'lenient' | 'normal' | 'strict';
export type Feedback = 'auto' | 'full' | 'after';
export type GuideKind = 'voice' | 'piano' | 'start' | 'off';

export interface Settings {
  name: string;
  daily_minutes: number;
  session_cap: number;
  strictness: Strictness;
  feedback: Feedback;
  syllables: 'movable' | 'fixed' | 'numbers' | 'letters' | 'neutral';
  minor_do: 'la' | 'do';
  clef: 'auto' | 'treble' | 'treble8' | 'bass';
  guide: GuideKind;
  vowel: 'oo' | 'ah';
  volume: number;
  guide_volume: number;
  accomp_volume: number;
  click_volume: number;
  drone: boolean;
  metronome: boolean;
  count_in: boolean;
  view: 'lane' | 'sheet';
  output: 'wired' | 'bluetooth' | 'speakers';
  latency_ms: number;
  noise_db: number;
  input_device: string;
  under18: boolean;
  checkins: boolean;
  keep_recordings: boolean;
  rest_day: number;
  coach_reviews: boolean;
  coach_plans: boolean;
  level: number;
  onboarded: boolean;
  last_song: string;
  coach_seen: string;
}

export interface Passaggio {
  primo: number;
  secondo: number;
  source: string;
  closest?: string;
}

export interface Voice {
  id: string;
  tested: boolean;
  kind: string;
  created: string;
  speaking_hz: number;
  low: number;
  high: number;
  comf_low: number;
  comf_high: number;
  family: 'high' | 'medium' | 'low';
  clef: 'treble' | 'treble8' | 'bass';
  passaggio: Passaggio;
  breaks: { at: number; jump: number }[];
  sustain_s: number;
  note?: string;
}

export interface HealthFlag {
  key: string;
  text: string;
}

export interface Checkin {
  id: string;
  day: string;
  when: 'before' | 'after' | 'other';
  hoarse: number;
  effort: number;
  discomfort: number;
  high_loss: number;
  clearing: number;
  pain: boolean;
  sz_ratio: number | null;
  note: string;
  created: string;
}

export interface Load {
  today_min: number;
  today_cycles_k: number;
  cap_min: number;
  week_min: number;
  mean_day_min: number;
  ratio: number | null;
  yesterday_min: number;
  streak_days: number;
}

export interface Health {
  today: string;
  load: Load;
  light: boolean;
  rest: boolean;
  flags: HealthFlag[];
  checkin: Checkin | null;
  checkins_on: boolean;
  under18: boolean;
  history?: Checkin[];
  days?: { day: string; voiced_min: number; cycles_k: number }[];
}

export interface AppState {
  settings: Settings;
  voice: Voice;
  health: { light: boolean; rest: boolean; flags: HealthFlag[]; load: Load; checkin: Checkin | null };
  unread: number;
  pending: number;
  new_songs: number;
  agent_active: boolean;
  today: { day: string; minutes: number; voiced: number; goal: number; cap: number };
  session: { id: string; minutes: number; voiced_min: number; runs: number; warmup_min: number } | null;
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
  weak: number[];
}

export interface Preview {
  lo: number;
  hi: number;
  /** [start 0..1, length 0..1, midi] */
  n: [number, number, number][];
}

/* The parsed song (lib_abc.js). */
export interface Bar {
  n: number;
  t: number;
  len: number;
  src: number;
  meter: string;
}
/** [t, d, midi, hand, finger, velocity, voice, bar index, staccato] */
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
/** [t, d, midi, bar index, flags (1 spoken, 2 free, 4 breath before, 8 staccato), phrase] */
export type MelodyNote = [number, number, number, number, number, number];
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
  pedal?: [number, number][];
  chords?: [number, string][];
  melodyVoice?: number;
  melody?: MelodyNote[];
  /** Per verse, one syllable per melody note ('' none, '_' held, a trailing '-' joins the next). */
  lyrics?: string[][];
  /** [first note, last note, start, end] in quarter notes. */
  phrases?: [number, number, number, number][];
  mrange?: { lo: number; hi: number; span: number; q1: number; med: number; q3: number };
  meta?: { voice: string; language: string; licence: string; source: string; vowel: string };
}

export interface Fit {
  best_shift: number;
  fits: boolean;
  over: number;
  under: number;
}

/** Where a song sits in the recording it was made from (songs.backing). */
export interface BackingMap {
  bpm: number;
  /** Every beat of the recording, in seconds. */
  beats: number[];
  /** The beat that is bar 1, beat 1. */
  downbeat: number;
  /** Quarter notes a beat. */
  beat_q: number;
  /** Where bar 1 starts in the song, in quarter notes from its start. */
  bar1_q: number;
  duration: number;
  channels: number;
  source: 'mix' | 'voice';
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  kind: 'song' | 'vocalise';
  level: number;
  bars: number;
  tempo: number;
  seconds: number;
  key: string;
  meter: string;
  low: number;
  high: number;
  span: number;
  median: number;
  tessitura: string;
  phrases: number;
  longest_phrase_s: number;
  syllables: number;
  verses: number;
  first_words: string;
  language: string;
  licence: string;
  source_note: string;
  voicing: string;
  accompanied: boolean;
  /** The recording the song was made from, played as its backing track; with the voice and the music separated from it, when they were. */
  backing?: { url: string; map: BackingMap | null; voice?: string | null; music?: string | null } | null;
  source: 'starter' | 'agent' | 'you' | 'import';
  tags: string[];
  fav: boolean;
  seen: boolean;
  archived: boolean;
  note: string;
  note_at: string;
  created: string;
  status: 'new' | 'learning' | 'mastered';
  key_shift: number;
  progress: {
    pct: number;
    last_at: string;
    runs: number;
    minutes: number;
    counts: Record<Stage, number>;
    due: number;
    solo: boolean;
    memory: boolean;
  };
  sections: SectionInfo[];
  fit?: Fit | null;
  preview?: Preview;
  abc?: string;
  model?: Model;
  gloss?: string;
  request?: string;
  recent?: { id: string; day: string; mode: Mode; bars: string; key: number; tempo: number; pitch: number; in_tune: number; bias_c: number; clean: boolean }[];
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
    sung_range: string;
    span: number;
    tessitura: string;
    syllables: number;
    verses: number;
    words: boolean;
    phrases: number;
    longest_phrase_s: number;
    language: string;
    licence: string;
    level: number;
    first_words: string;
    accompaniment: boolean;
  };
  sections?: { name: string; from: number; to: number }[];
  fit?: (Fit & { voice_tested: boolean }) | null;
}

export interface PlanBlock {
  i: number;
  kind: 'song' | 'lesson' | 'drill' | 'warmup' | 'cooldown' | 'exercise';
  title: string;
  minutes: number;
  why: string;
  sitting: number;
  done: boolean;
  lesson?: string;
  skill?: string;
  drill?: string;
  ex?: string;
  vowel?: string;
  song?: string;
  composer?: string;
  song_kind?: 'song' | 'vocalise';
  from?: number;
  to?: number;
  section?: string | null;
  whole?: boolean;
  mode?: Mode;
  tempo?: number;
  bpm?: number;
}

export interface Plan {
  day: string;
  source: 'rules' | 'coach';
  status: 'proposed' | 'active' | 'done';
  note: string;
  blocks: PlanBlock[];
  minutes: number;
  sung: number;
  goal: number;
  cap: number;
  done: number;
}

export interface SeriesDay {
  day: string;
  minutes: number;
  voiced: number;
  pitch: number | null;
  in_tune: number | null;
  hold: number | null;
  runs: number;
}

export interface Home {
  day: string;
  goal: number;
  level: number;
  level_name: string;
  level_met: number;
  level_total: number;
  today: { minutes: number; voiced: number; runs: number };
  streak: number;
  week: SeriesDay[];
  series: SeriesDay[];
  heat: { day: string; minutes: number; voiced: number }[];
  totals: {
    minutes_7: number;
    minutes_prev_7: number;
    voiced_7: number;
    pitch_7: number | null;
    pitch_prev_7: number | null;
    in_tune_7: number | null;
    in_tune_prev_7: number | null;
    hold_7: number | null;
    hold_prev_7: number | null;
    sections: Record<Stage, number>;
    songs_mastered: number;
    songs: number;
    due: number;
  };
  voice: { tested: boolean; comf_low: number; comf_high: number; low: number; high: number; family: string; clef: string; passaggio: Passaggio; created: string; sustain_s: number };
  health: { load: Load; light: boolean; rest: boolean; flags: HealthFlag[]; checkin: Checkin | null; checkins_on: boolean };
  map: number[][];
  current: Song[];
  resume: Song | null;
  coach: { id: string; kind: string; text: string; created: string } | null;
  unread: number;
}

export interface SongStats {
  song: Song;
  days: { day: string; minutes: number; runs: number; best: number; pitch: number | null }[];
  ladders: { section: string; points: { day: string; best: number }[] }[];
  bars: { bar: number; expected: number; errors: number; off: number; missed: number }[];
  sung_takes: number;
}

export interface Message {
  id: string;
  role: 'you' | 'coach';
  kind: 'chat' | 'request' | 'review' | 'plan' | 'health';
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
  voiced_min: number;
  cycles_k: number;
  runs: number;
  songs: { song: string; title: string; minutes: number; runs: number }[];
  warmup_min: number;
  cooldown_min: number;
  pain: boolean;
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
  solo_today: boolean;
}

export interface Run {
  id: string;
  song: string;
  mode: Mode;
  from_bar: number;
  to_bar: number;
  key_shift: number;
  tempo_pct: number;
  pitch_pct: number;
  on_pct: number;
  clean: boolean;
  disputed: number;
  created: string;
  per_note?: (number | null)[][];
  disputed_notes?: number[];
}

export interface SavedRun {
  run: Run;
  results: RunResult[];
  song: Song;
  session: Session;
  suggestion: { tempo: number; why: 'up' | 'hold' | 'down' | 'again' } | null;
  level_up: number;
  health: HealthFlag | null;
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
  drill: 'quiz' | 'sing' | 'speak' | 'exercise' | 'sight';
  levels: number;
  mastery: number;
  stars: number;
  attempts: number;
  items: number;
  avg_ms: number;
  level: number;
  best_level: number;
  last_at: string;
  data: Record<string, { clean?: boolean; bpm?: number; acc?: number; title?: string; last?: string; sd?: number; swell?: number } | number>;
  history: { d: string; s: number; a: number }[];
}

export interface PathItem {
  track: string;
  kind: 'lesson' | 'skill' | 'level' | 'tech' | 'voice' | 'songs' | 'program';
  key: string;
  title: string;
  ok: boolean;
  need?: number;
  have?: number | null;
  level?: number;
  bpm?: number;
  skill?: string;
  secs?: number;
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

export interface ExerciseDef {
  title: string;
  skill: string;
  level: number;
}

export interface LearnState {
  level: number;
  tracks: { key: string; title: string }[];
  units: { key: string; title: string }[];
  exercises: Record<string, ExerciseDef>;
  lessons: LessonInfo[];
  skills: SkillInfo[];
  path: PathLevel[];
  next: { lesson: { key: string; title: string; level: number; minutes: number; unit: string } | null; skill: { key: string; title: string; kind: string; ex?: string } | null };
}

export interface DrillSaved {
  skill: SkillInfo;
  score: number;
  level: number;
  level_up: number;
  health: HealthFlag | null;
}

/**
 * The UI calls the same operations the agent calls through the agent-app CLI
 * (pb_hooks/ops.pb.js), so every rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type { AppState, BackingMap, Checkin, CheckResult, DrillSaved, Health, Home, LearnState, Message, Mode, Model, Plan, Run, SavedRun, Session, Settings, Song, SongStats, Voice } from './types.ts';

type Value = string | number | boolean | null | undefined;
type Query = Record<string, Value>;

function clean(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v;
  return out;
}

function get<T>(op: string, params: Query = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) if (v !== null) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'GET', query, requestKey: null }), { silent });
}

function post<T>(op: string, body: Record<string, unknown> | FormData = {}, silent = false): Promise<T> {
  const b = body instanceof FormData ? body : clean(body);
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: b, requestKey: null }), { silent });
}

export interface RunInput {
  song: string;
  mode: Mode;
  from_bar: number;
  to_bar: number;
  verse: number;
  key_shift: number;
  tempo_pct: number;
  guide: string;
  feedback: string;
  memory: boolean;
  duration_ms: number;
  voiced_ms: number;
  cycles: number;
  expected: number;
  on_n: number;
  close_n: number;
  off_n: number;
  missed: number;
  onset_pct: number;
  bias_c?: number | undefined;
  mad_c?: number | undefined;
  timing_mad?: number | undefined;
  timing_bias?: number | undefined;
  hold_sd?: number | undefined;
  vib_rate?: number | undefined;
  vib_extent?: number | undefined;
  vib_share?: number | undefined;
  scoops: number;
  falls: number;
  drift_c?: number | undefined;
  octave: number;
  offset_c?: number | undefined;
  complete: boolean;
  per_bar: number[][];
  per_phrase: unknown[];
  per_note: (number | null)[][];
  map: number[][];
  self_estimate?: string | undefined;
}

export interface SongFields {
  title?: string | undefined;
  composer?: string | undefined;
  level?: number | undefined;
  kind?: 'song' | 'vocalise' | undefined;
  sections?: string | undefined;
  tags?: string | undefined;
  abc?: string | undefined;
  fav?: boolean | undefined;
  gloss?: string | undefined;
}

export interface DrillInput {
  drill: string;
  skill: string;
  items: number;
  correct: number;
  avg_ms?: number | undefined;
  duration_ms: number;
  voiced_ms?: number | undefined;
  cycles?: number | undefined;
  accuracy?: number | undefined;
  tempo_pct?: number | undefined;
  level?: number | undefined;
  complete?: boolean | undefined;
  detail?: Record<string, unknown> | undefined;
}

export const api = {
  state: (): Promise<AppState> => get('app/state', {}, true),
  reportUi: (p: { view: string; song?: string | undefined; from?: number | undefined; to?: number | undefined; mode?: string | undefined; tempo?: number | undefined; key?: number | undefined; lesson?: string | undefined; skill?: string | undefined; title?: string | undefined }): Promise<{ ok: boolean }> => post('app/ui', p, true),
  saveSettings: (p: Partial<Settings>, silent = true): Promise<{ settings: Settings }> => post('settings/update', p as Record<string, unknown>, silent),

  voice: (): Promise<{ voice: Voice; summary: string; history: { id: string; kind: string; created: string; low: number; high: number; comf_low: number; comf_high: number; sustain_s: number }[]; typical: { key: string; title: string; lo: number; hi: number; primo: number; secondo: number }[] }> => get('voice/get', {}, true),
  voiceTest: (p: { low: number; high: number; speaking_hz?: number | undefined; sustain_s?: number | undefined; kind: string; breaks?: { at: number; jump: number }[] | undefined }): Promise<{ voice: Voice; summary: string; level_up: number }> => post('voice/test', p as unknown as Record<string, unknown>),

  health: (): Promise<Health> => get('health/get', {}, true),
  checkin: (p: { when: 'before' | 'after' | 'other'; hoarse: number; effort: number; discomfort: number; high_loss: number; clearing: number; pain: boolean; sz_ratio?: number | undefined; note?: string | undefined }): Promise<{ checkin: Checkin; advice: string; health: Health }> => post('health/checkin', p as unknown as Record<string, unknown>),

  songs: (p: Query = {}): Promise<{ songs: Song[]; count: number; voice: { comf_low: number; comf_high: number; tested: boolean } }> => get('songs/list', { preview: true, ...p }, true),
  song: (song: string): Promise<{ song: Song }> => get('songs/get', { song, abc: true, preview: true }, true),
  /** A song with its notation and the model parsed from it (the editor). */
  songFull: (song: string): Promise<{ song: Song }> => get('songs/get', { song, abc: true, model: true, backingMap: true }, true),
  openSong: (song: string): Promise<{ song: Song }> => post('songs/open', { song }, true),
  check: (abc: string, sections?: string, level?: number): Promise<CheckResult> => post('songs/check', { abc, sections: sections === '' ? undefined : sections, level }, true),
  addSong: (p: SongFields & { abc: string; source?: 'you' | 'import' | undefined; duplicate?: boolean | undefined }): Promise<{ song: Song }> => post('songs/add', p as unknown as Record<string, unknown>),
  updateSong: (song: string, p: SongFields): Promise<{ song: Song }> => post('songs/update', { song, ...p }),
  transpose: (song: string, shift: number): Promise<{ song: Song }> => post('songs/transpose', { song, shift }, true),
  /** Attach the recording a song was made from (its file and where the song sits in it). */
  songBacking: (song: string, file: Blob, name: string, map: BackingMap): Promise<{ song: Song }> => {
    const form = new FormData();
    form.set('song', song);
    form.set('map', JSON.stringify(map));
    form.set('file', file, name);
    return post('songs/backing', form);
  },
  /** Attach the voice or the music separated from that recording. */
  songStem: (song: string, part: 'voice' | 'music', file: Blob, name: string): Promise<{ song: Song }> => {
    const form = new FormData();
    form.set('song', song);
    form.set('part', part);
    form.set('file', file, name);
    return post('songs/backing', form);
  },
  removeBacking: (song: string): Promise<{ song: Song }> => post('songs/backing', { song, remove: true }),
  removeSong: (song: string): Promise<{ song: Song }> => post('songs/remove', { song }),
  restoreSong: (song: string): Promise<{ song: Song }> => post('songs/restore', { song }),
  resetSong: (song: string): Promise<{ song: Song }> => post('songs/reset', { song }),

  saveRun: (p: RunInput): Promise<SavedRun> => post('runs/save', p as unknown as Record<string, unknown>, true),
  run: (run: string, track = false): Promise<{ run: Run; track?: { rate: number; frames: string; audio: string } }> => get('runs/get', { run, track }, true),
  dispute: (run: string, note: number): Promise<{ run: Run; changed: boolean; clean: boolean; credited: boolean; note: string }> => post('runs/dispute', { run, note }),
  saveTrack: (form: FormData): Promise<{ ok: boolean; audio: boolean }> => post('runs/track', form, true),
  forgetAudio: (): Promise<{ ok: boolean; deleted: number }> => post('runs/forget-audio', {}),
  endSession: (pain = false): Promise<{ session: Session | null; asked: boolean; reason: string }> => post('sessions/end', { pain }),
  sessions: (limit = 20): Promise<{ sessions: Session[] }> => get('sessions/list', { limit }, true),

  messages: (): Promise<{ messages: Message[]; seen: string }> => get('coach/list', {}, true),
  send: (p: { text: string; kind?: 'chat' | 'request'; song?: string | undefined; context?: Record<string, unknown> | undefined }): Promise<{ message: Message; asked: boolean; reason: string }> => post('coach/send', p),
  retry: (message: string): Promise<{ message: Message; asked: boolean; reason: string }> => post('coach/retry', { message }),
  read: (): Promise<{ ok: boolean }> => post('coach/read', {}, true),

  plan: (): Promise<{ plan: Plan }> => get('plan/today', {}, true),
  startPlan: (): Promise<{ plan: Plan }> => post('plan/start', {}, true),
  planDone: (block: number, undo = false): Promise<{ plan: Plan }> => post('plan/done', { block, undo }, true),
  resetPlan: (): Promise<{ plan: Plan }> => post('plan/reset', {}),

  home: (): Promise<Home> => get('stats/home', {}, true),
  voiceStats: (): Promise<{ voice: { voice: Voice; history: { created: string; low: number; high: number; comf_low: number; comf_high: number }[] }; hold: { day: string; hold: number }[]; sustain_history: { d: string; s: number; a: number }[]; health: Health; map: number[][]; map_30: number[][] }> => get('stats/voice', {}, true),

  learn: (): Promise<LearnState> => get('learn/state', {}, true),
  lessonDone: (lesson: string, score: number, duration_ms: number, voiced_ms = 0, cycles = 0): Promise<{ lesson: { key: string; title: string; score: number; best: number }; first: boolean; level_up: number }> => post('learn/lesson', { lesson, score, duration_ms, voiced_ms, cycles }, true),
  saveDrill: (p: DrillInput): Promise<DrillSaved> => post('drills/save', p as unknown as Record<string, unknown>, true),
  parse: (abc: string): Promise<{ model: Model; summary: { bars: number; title: string; composer: string; key: string; meter: string; tempo: number; seconds: number; notes: number; span: number; low: number; high: number; median: number; level: number }; sections: { name: string; from: number; to: number }[] }> => post('abc/parse', { abc }, true),
  songStats: (song: string): Promise<SongStats> => get('stats/song', { song }, true),
};

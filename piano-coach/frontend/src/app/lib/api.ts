/**
 * The UI calls the same operations the agent calls through the agent-app CLI
 * (pb_hooks/ops.pb.js), so every rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type { AppState, CheckResult, DrillSaved, Hands, Home, LearnState, Message, Mode, Model, Plan, SavedRun, Session, Settings, Song, SongStats } from './types.ts';

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

function post<T>(op: string, body: Record<string, unknown> = {}, silent = false): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: clean(body), requestKey: null }), { silent });
}

export interface RunInput {
  song: string;
  mode: Mode;
  from_bar: number;
  to_bar: number;
  hands: Hands;
  tempo_pct: number;
  duration_ms: number;
  expected: number;
  hits: number;
  wrong: number;
  missed: number;
  timing_mad?: number | undefined;
  timing_bias?: number | undefined;
  complete: boolean;
  per_bar: number[][];
}

export interface SongFields {
  title?: string | undefined;
  composer?: string | undefined;
  level?: number | undefined;
  kind?: 'piece' | 'exercise' | undefined;
  sections?: string | undefined;
  tags?: string | undefined;
  abc?: string | undefined;
  fav?: boolean | undefined;
}

export const api = {
  state: (): Promise<AppState> => get('app/state', {}, true),
  reportUi: (p: { view: string; song?: string | undefined; from?: number | undefined; to?: number | undefined; mode?: string | undefined; hands?: string | undefined; tempo?: number | undefined; lesson?: string | undefined; skill?: string | undefined; title?: string | undefined }): Promise<{ ok: boolean }> => post('app/ui', p, true),
  saveSettings: (p: Partial<Settings>, silent = true): Promise<{ settings: Settings }> => post('settings/update', p as Record<string, unknown>, silent),

  songs: (p: Query = {}): Promise<{ songs: Song[]; count: number }> => get('songs/list', { preview: true, ...p }, true),
  song: (song: string): Promise<{ song: Song }> => get('songs/get', { song, abc: true, preview: true }, true),
  openSong: (song: string): Promise<{ song: Song }> => post('songs/open', { song }, true),
  check: (abc: string, sections?: string): Promise<CheckResult> => post('songs/check', { abc, sections: sections === '' ? undefined : sections }, true),
  addSong: (p: SongFields & { abc: string; source?: 'you' | 'import' | undefined; duplicate?: boolean | undefined }): Promise<{ song: Song }> => post('songs/add', p as unknown as Record<string, unknown>),
  updateSong: (song: string, p: SongFields): Promise<{ song: Song }> => post('songs/update', { song, ...p }),
  removeSong: (song: string): Promise<{ song: Song }> => post('songs/remove', { song }),
  restoreSong: (song: string): Promise<{ song: Song }> => post('songs/restore', { song }),
  resetSong: (song: string): Promise<{ song: Song }> => post('songs/reset', { song }),

  saveRun: (p: RunInput): Promise<SavedRun> => post('runs/save', p as unknown as Record<string, unknown>, true),
  endSession: (): Promise<{ session: Session | null; asked: boolean; reason: string }> => post('sessions/end', {}),
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

  learn: (): Promise<LearnState> => get('learn/state', {}, true),
  lessonDone: (lesson: string, score: number, duration_ms: number): Promise<{ lesson: { key: string; title: string; score: number; best: number }; first: boolean; level_up: number }> => post('learn/lesson', { lesson, score, duration_ms }, true),
  saveDrill: (p: { drill: string; skill: string; items: number; correct: number; avg_ms?: number | undefined; duration_ms: number; accuracy?: number | undefined; tempo_pct?: number | undefined; level?: number | undefined; complete?: boolean | undefined; mode?: string | undefined; detail?: Record<string, unknown> | undefined }): Promise<DrillSaved> => post('drills/save', p as unknown as Record<string, unknown>, true),
  parse: (abc: string): Promise<{ model: Model; summary: { bars: number; title: string; composer: string; key: string; meter: string; tempo: number; seconds: number; notes: number; hands: Hands; range: string; level: number }; sections: { name: string; from: number; to: number }[] }> => post('abc/parse', { abc }, true),
  songStats: (song: string): Promise<SongStats> => get('stats/song', { song }, true),
};

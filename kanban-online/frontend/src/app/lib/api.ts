/**
 * The UI calls the same operations the agents call through the agent-app
 * CLI (pb_hooks/ops.pb.js), so every rule enforced there holds for both.
 * The signed-in person's token rides along with every call.
 */
import { getPbClient } from '../../kit/index.ts';
import type { Agent, AppState, AssigneeKey, Attention, Board, BoardDetail, Card, CardDetail, CardFull, Column, EventRec, Flow, Inbox, Label, Me, Person, Rule, Settings, Template } from './types.ts';

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

export interface CardChanges {
  title?: string | undefined;
  description?: string | undefined;
  acceptance?: string | undefined;
  priority?: number | undefined;
  labels?: string[] | undefined;
  due?: string | undefined;
  checklist?: { id?: string; text: string; done: boolean }[] | undefined;
}

export interface NewCard extends CardChanges {
  board: string;
  title: string;
  column?: string | undefined;
  assignee?: AssigneeKey | undefined;
  position?: 'top' | 'bottom' | undefined;
}

export type ColumnChanges = Partial<{
  name: string;
  category: string;
  wip: number;
  policy: string;
  instructions: string;
  agent_mode: string;
  agent: string;
  plan_first: boolean;
  need_criteria: boolean;
  need_checklist: boolean;
  next: string;
  return_to: string;
  lease_minutes: number;
  max_attempts: number;
  aging_days: number;
  collapsed: boolean;
}>;

export const api = {
  /* app */
  state: (): Promise<AppState> => get('app/state', {}, true),
  reportUi: (p: { view: string; board?: string | undefined; card?: string | undefined }): Promise<{ ok: boolean }> => post('app/ui', p, true),
  settings: (): Promise<Settings> => get('settings/get'),
  saveSettings: (p: Partial<{ name: string; joining: 'open' | 'approval'; paused: boolean; max_working: number; defaults: Record<string, number> }>, silent = false): Promise<Settings> => post('settings/update', p, silent),

  /* the team */
  me: (): Promise<Me> => get('me/get', {}, true),
  saveMe: (p: Partial<{ name: string; tone: string; prefs: { attention?: Partial<Record<string, Attention>>; inbox?: 'mine' | 'all' } }>, silent = false): Promise<Me> => post('me/update', p, silent),
  people: (): Promise<{ people: Person[]; pending: number }> => get('people/list'),
  updatePerson: (person: string, p: Partial<{ status: 'active' | 'suspended'; role: 'admin' | 'member' }>): Promise<{ person: Person }> => post('people/update', { person, ...p }),
  agents: (days = 7, all = false): Promise<{ agents: Agent[]; days: number }> => get('agents/list', { days, all }),
  updateAgent: (agent: string, p: Partial<{ paused: boolean; name: string; tone: string; max_working: number; restore: boolean }>, silent = false): Promise<{ agent: Agent }> => post('agents/update', { agent, ...p }, silent),
  removeAgent: (agent: string): Promise<{ cards: number }> => post('agents/remove', { agent }),

  /* boards */
  boards: (archived = false): Promise<{ boards: Board[] }> => get('boards/list', { archived }),
  board: (board: string): Promise<BoardDetail> => get('boards/get', { board }, true),
  templates: (): Promise<{ templates: Template[] }> => get('boards/templates'),
  createBoard: (p: { name: string; key?: string | undefined; template?: string | undefined; description?: string | undefined }): Promise<{ board: Board }> => post('boards/create', p),
  updateBoard: (board: string, p: Partial<{ name: string; key: string; description: string; instructions: string; frozen: boolean; swimlanes: string; archived: boolean; sort: number }>): Promise<{ board: Board }> => post('boards/update', { board, ...p }),
  deleteBoard: (board: string): Promise<{ ok: boolean }> => post('boards/delete', { board }),
  addColumn: (board: string, p: ColumnChanges & { index?: number | undefined }): Promise<{ column: Column }> => post('columns/add', { board, ...p }),
  updateColumn: (column: string, p: ColumnChanges, silent = false): Promise<{ column: Column }> => post('columns/update', { column, ...p }, silent),
  moveColumn: (column: string, index: number): Promise<{ ok: boolean }> => post('columns/move', { column, index }),
  removeColumn: (column: string, moveTo?: string): Promise<{ ok: boolean }> => post('columns/remove', { column, move_to: moveTo }),
  saveLabel: (p: { board?: string | undefined; label?: string | undefined; name?: string | undefined; color?: string | undefined }): Promise<{ label: Label }> => post('labels/save', p),
  removeLabel: (label: string): Promise<{ ok: boolean }> => post('labels/remove', { label }),
  rules: (board: string): Promise<{ rules: Rule[]; when: Record<string, string>; actions: string[] }> => get('rules/list', { board }),
  saveRule: (p: Record<string, unknown>): Promise<{ rule: Rule }> => post('rules/save', p),
  removeRule: (rule: string): Promise<{ ok: boolean }> => post('rules/remove', { rule }),

  /* cards */
  card: (card: string): Promise<CardDetail> => get('cards/get', { card }, true),
  cards: (p: Query): Promise<{ cards: Card[] }> => get('cards/list', p),
  addCard: (p: NewCard): Promise<{ card: CardFull }> => post('cards/add', p as unknown as Record<string, unknown>),
  updateCard: (card: string, p: CardChanges, silent = false): Promise<{ card: CardFull }> => post('cards/update', { card, ...p }, silent),
  moveCard: (card: string, column: string, at: { index?: number | undefined; before?: string | undefined; after?: string | undefined } = {}): Promise<{ card: CardFull; warnings: string[] }> => post('cards/move', { card, column, ...at }),
  assign: (card: string, assignee: AssigneeKey): Promise<{ card: CardFull }> => post('cards/assign', { card, assignee: assignee === '' ? 'none' : assignee }),
  comment: (card: string, text: string): Promise<{ ok: boolean }> => post('cards/comment', { card, text }),
  check: (card: string, p: { item?: string; done?: boolean; text?: string; add?: string; remove?: boolean }): Promise<{ checklist: CardFull['checklist_items'] }> => post('cards/check', { card, ...p }),
  block: (card: string, reason: string): Promise<{ ok: boolean }> => post('cards/block', { card, reason }),
  unblock: (card: string): Promise<{ ok: boolean }> => post('cards/unblock', { card }),
  archive: (cards: string[]): Promise<{ changed: number }> => post('cards/archive', { cards }),
  restore: (cards: string[]): Promise<{ changed: number }> => post('cards/restore', { cards }),
  deleteCard: (card: string): Promise<{ ok: boolean }> => post('cards/delete', { card }),
  accept: (card: string, column?: string): Promise<{ card: CardFull }> => post('cards/accept', { card, column }),
  answer: (card: string, text: string): Promise<{ ok: boolean }> => post('cards/answer', { card, text }),
  approvePlan: (card: string, note?: string): Promise<{ ok: boolean }> => post('cards/approve_plan', { card, note }),
  stop: (card: string): Promise<{ ok: boolean }> => post('cards/stop', { card }),
  retry: (card: string, note?: string): Promise<{ ok: boolean }> => post('cards/retry', { card, note }),

  /* review */
  reviews: (mine = false): Promise<{ cards: CardFull[] }> => get('review/list', { mine: mine || undefined }),
  approve: (card: string, note?: string): Promise<{ moved_to: string }> => post('review/approve', { card, note }),
  changes: (card: string, reason: string): Promise<{ returned_to: string }> => post('review/changes', { card, reason }),
  reject: (card: string, reason: string): Promise<{ ok: boolean }> => post('review/reject', { card, reason }),

  /* inbox, insights, activity */
  inbox: (scope?: 'mine' | 'all'): Promise<Inbox> => get('inbox/list', { scope }, true),
  seen: (): Promise<{ ok: boolean }> => post('inbox/seen', {}, true),
  flow: (board: string | undefined, days: number): Promise<Flow> => get('insights/flow', { board, days }),
  activity: (p: Query): Promise<{ events: EventRec[]; more: boolean }> => get('activity/list', p),
  revert: (event: string): Promise<{ reverted: number; done: string[] }> => post('activity/revert', { event }),
  undo: (): Promise<{ undone: string }> => post('activity/undo', {}, true),
};

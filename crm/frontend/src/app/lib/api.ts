/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops_*.pb.js), so every rule enforced there (what the agent
 * may only propose, duplicates, undo) holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  ActivityEntry,
  ActivityReport,
  Ask,
  Company,
  Currency,
  Dashboard,
  Deal,
  DupePair,
  Email,
  FieldDef,
  Filter,
  Forecast,
  Funnel,
  FxRate,
  ImportPreview,
  Interaction,
  KindStat,
  ListRec,
  Note,
  Obj,
  Person,
  Pipeline,
  PipelineReport,
  Policy,
  Proposal,
  RecordDetail,
  Relationships,
  Run,
  Settings,
  Sources,
  Stage,
  StageTime,
  Summary,
  Task,
  Template,
  TimelineItem,
  ViewRec,
  WinLoss,
  CalendarMonth,
} from './types.ts';

type Params = Record<string, unknown>;

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  }
  return out;
}

function get<T>(path: string, params: Params = {}): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'GET', query: clean(params) }), { silent: true });
}

function post<T>(path: string, body: Params): Promise<T> {
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) b[k] = v;
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'POST', body: b }), { silent: true });
}

/** An error's message for a toast. */
export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string }; data?: { message?: string } };
  return e?.response?.message ?? e?.data?.message ?? e?.message ?? 'Something went wrong';
}

/** The candidates of a 409 (a duplicate email or domain, an ambiguous match). */
export function errCandidates(err: unknown): { id: string; name: string; deleted: boolean }[] {
  const e = err as { response?: { candidates?: { id: string; name: string; deleted: boolean }[] }; data?: { candidates?: { id: string; name: string; deleted: boolean }[] } };
  return e?.response?.candidates ?? e?.data?.candidates ?? [];
}

export interface ListParams {
  q?: string | undefined;
  preset?: string | undefined;
  list?: string | undefined;
  filters?: Filter[] | undefined;
  match?: 'all' | 'any' | undefined;
  view?: string | undefined;
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
  limit?: number | undefined;
  pipeline?: string | undefined;
  status?: string | undefined;
  company?: string | undefined;
  deleted?: boolean | undefined;
}

export interface Changed<T> {
  proposed: boolean;
  proposal: Proposal | null;
  changes?: { field: string; label: string; from: string; to: string }[];
  person?: T;
  company?: T;
  deal?: T;
}

export const api = {
  setup: () => get<{ settings: Settings; currencies: Currency[]; templates: Template[] }>('setup/get'),
  applySetup: (p: { workspace: string; owner_name: string; home_currency: string; pipelines: string[]; keep_in_touch_default: number }) => post<{ settings: Settings }>('setup/apply', p),
  updateSettings: (p: Partial<Pick<Settings, 'workspace' | 'owner_name' | 'home_currency' | 'keep_in_touch_default'>>) => post<{ settings: Settings }>('settings/update', p),
  updatePolicy: (p: Partial<Policy> & Record<string, unknown>) => post<{ policy: Policy }>('policy/update', p),
  summary: () => get<Summary>('app/summary'),
  dashboard: (p: { range: string; pipeline?: string | undefined }) => get<Dashboard>('app/dashboard', p),
  calendar: (month: string) => get<CalendarMonth>('app/calendar', { month }),
  ui: (p: { view: string; selection: { type: string; id: string } | null; filters: Record<string, unknown> }) => post<{ ok: boolean }>('app/ui', p),
  search: (q: string, limit = 6) => get<{ people: Person[]; companies: Company[]; deals: Deal[] }>('search/all', { q, limit }),

  people: (p: ListParams = {}) => get<{ people: Person[]; total: number }>('people/list', p as Params),
  companies: (p: ListParams = {}) => get<{ companies: Company[]; total: number }>('companies/list', p as Params),
  deals: (p: ListParams = {}) => get<{ deals: Deal[]; total: number }>('deals/list', p as Params),
  person: (id: string) => get<RecordDetail<Person>>('people/get', { id }),
  company: (id: string) => get<RecordDetail<Company>>('companies/get', { id }),
  deal: (id: string) => get<RecordDetail<Deal>>('deals/get', { id }),
  create: <T>(o: Obj, p: Params) => post<{ created: boolean } & Record<string, T>>(o + '/create', p),
  update: <T>(o: Obj, id: string, values: Params) => post<Changed<T>>(o + '/update', { id, values }),
  remove: (o: Obj, id: string) => post<{ deleted: boolean; proposed: boolean }>(o + '/delete', { id }),
  restore: (o: Obj, id: string) => post<{ restored: boolean }>(o + '/restore', { id }),
  merge: (o: Obj, primary: string, secondary: string) => post<{ merged: boolean; filled: string[] }>(o + '/merge', { primary, secondary }),
  bulk: (o: Obj, p: { ids: string[]; action: string; tag?: string | undefined; list?: string | undefined; field?: string | undefined; value?: unknown; note?: string | undefined }) => post<{ changed?: number; queued?: number; proposed?: number }>(o + '/bulk', p),
  research: (o: 'people' | 'companies', ids: string[], note: string) => post<{ queued: number; asked: boolean }>(o + '/research', { ids, note }),
  exportCsv: (o: Obj, p: ListParams) => get<{ filename: string; csv: string; count: number }>(o + '/export', p as Params),
  timeline: (object: Obj, id: string) => get<{ items: TimelineItem[] }>('timeline/get', { object, id }),
  dupes: (object: 'people' | 'companies') => get<{ pairs: DupePair<Person & Company>[] }>('dupes/list', { object }),
  dismissDupe: (object: string, a: string, b: string) => post<{ dismissed: boolean }>('dupes/dismiss', { object, a, b }),
  trash: () => get<{ people: Person[]; companies: Company[]; deals: Deal[] }>('trash/list'),

  move: (deal: string, stage: string, before?: string | undefined, lost_reason?: string | undefined) => post<{ proposed: boolean; deal: Deal }>('deals/move', { deal, stage, before, lost_reason }),
  close: (deal: string, outcome: 'won' | 'lost', reason?: string | undefined) => post<{ proposed: boolean; deal: Deal }>('deals/close', { deal, outcome, reason }),
  reopen: (deal: string, stage?: string | undefined) => post<{ proposed: boolean; deal: Deal }>('deals/reopen', { deal, stage }),
  addPerson: (deal: string, person: string, role: string) => post<RecordDetail<Deal>>('deals/add_person', { deal, person, role }),
  removePerson: (deal: string, person: string) => post<RecordDetail<Deal>>('deals/remove_person', { deal, person }),

  pipelines: (archived = false) => get<{ pipelines: Pipeline[] }>('pipelines/list', { archived }),
  createPipeline: (p: { kind: string; name?: string | undefined; currency?: string | undefined; target?: string | undefined }) => post<{ pipeline: Pipeline }>('pipelines/create', p),
  updatePipeline: (pipeline: string, p: Params) => post<{ pipeline: Pipeline }>('pipelines/update', { pipeline, ...p }),
  deletePipeline: (pipeline: string) => post<{ deleted: boolean }>('pipelines/delete', { pipeline }),
  createStage: (p: Params) => post<{ stage: Stage }>('stages/create', p),
  updateStage: (stage: string, p: Params) => post<{ stage: Stage }>('stages/update', { stage, ...p }),
  reorderStages: (pipeline: string, stages: string[]) => post<{ pipeline: Pipeline }>('stages/reorder', { pipeline, stages }),
  deleteStage: (stage: string, move_to?: string | undefined) => post<{ deleted: boolean }>('stages/delete', { stage, move_to }),

  notes: (p: { person?: string | undefined; company?: string | undefined; deal?: string | undefined }) => get<{ notes: Note[] }>('notes/list', p),
  addNote: (p: Params) => post<{ note: Note }>('notes/create', p),
  updateNote: (note: string, p: Params) => post<{ note: Note }>('notes/update', { note, ...p }),
  deleteNote: (note: string) => post<{ deleted: boolean }>('notes/delete', { note }),
  logInteraction: (p: Params) => post<{ interaction: Interaction; review: boolean; asked: boolean }>('interactions/log', p),
  updateInteraction: (interaction: string, p: Params) => post<{ interaction: Interaction }>('interactions/update', { interaction, ...p }),
  deleteInteraction: (interaction: string) => post<{ deleted: boolean }>('interactions/delete', { interaction }),
  today: () => get<{ overdue: Task[]; today: Task[]; upcoming: Task[]; snoozed: Task[]; done: Task[] }>('tasks/today'),
  tasks: (p: { person?: string | undefined; company?: string | undefined; deal?: string | undefined; state?: string | undefined }) => get<{ tasks: Task[] }>('tasks/list', p),
  addTask: (p: Params) => post<{ task: Task }>('tasks/create', p),
  updateTask: (task: string, p: Params) => post<{ task: Task }>('tasks/update', { task, ...p }),
  completeTask: (task: string, done = true) => post<{ tasks: Task[] }>('tasks/complete', { task, done }),
  snoozeTask: (task: string, until: string) => post<{ task: Task }>('tasks/snooze', { task, until }),
  deleteTask: (task: string) => post<{ deleted: boolean }>('tasks/delete', { task }),
  emails: (p: { person?: string | undefined; deal?: string | undefined; status?: string | undefined }) => get<{ emails: Email[] }>('emails/list', p),
  draftEmail: (p: Params) => post<{ email: Email }>('emails/draft', p),
  updateEmail: (email: string, p: Params) => post<{ email: Email }>('emails/update', { email, ...p }),
  sendEmail: (email: string) => post<{ email: Email; asked: boolean }>('emails/send', { email }),
  deleteEmail: (email: string) => post<{ deleted: boolean }>('emails/delete', { email }),

  proposals: (p: { status?: string | undefined; target?: string | undefined }) => get<{ proposals: Proposal[] }>('proposals/list', p),
  proposalStats: () => get<{ kinds: KindStat[] }>('proposals/stats'),
  decide: (ids: string[], decision: 'accept' | 'reject', edits?: Record<string, unknown> | undefined) => post<{ decided: Proposal[]; failed: { id: string; error: string }[] }>('proposals/decide', ids.length === 1 ? { proposal: ids[0], decision, edits } : { proposals: ids, decision }),

  lists: (object?: string | undefined) => get<{ lists: ListRec[] }>('lists/list', { object }),
  createList: (p: { name: string; object: string; ids?: string[] | undefined }) => post<{ list: ListRec }>('lists/create', p),
  updateList: (list: string, p: Params) => post<{ list: ListRec }>('lists/update', { list, ...p }),
  deleteList: (list: string) => post<{ deleted: boolean }>('lists/delete', { list }),
  addToList: (list: string, ids: string[]) => post<{ added: number }>('lists/add', { list, ids }),
  removeFromList: (list: string, ids: string[]) => post<{ removed: number }>('lists/remove', { list, ids }),
  views: (object?: string | undefined) => get<{ views: ViewRec[] }>('views/list', { object }),
  saveView: (p: Params) => post<{ view: ViewRec }>('views/save', p),
  deleteView: (view: string) => post<{ deleted: boolean }>('views/delete', { view }),
  fields: (object?: string | undefined) => get<{ fields: FieldDef[]; builtin: Record<string, { key: string; label: string; type: string; options: string[] }[]> }>('fields/list', { object }),
  createField: (p: Params) => post<{ field: FieldDef }>('fields/create', p),
  updateField: (field: string, p: Params) => post<{ field: FieldDef }>('fields/update', { field, ...p }),
  deleteField: (field: string) => post<{ deleted: boolean }>('fields/delete', { field }),
  importPreview: (object: Obj, csv: string, mapping?: string[] | undefined) => post<ImportPreview>('import/preview', { object, csv, mapping }),
  importApply: (p: { object: Obj; csv: string; mapping?: string[] | undefined; overwrite?: boolean | undefined; list?: string | undefined; file_name?: string | undefined }) => post<{ created: number; updated: number; skipped: number; errors: { row: number; error: string }[] }>('import/apply', p),

  reportPipeline: (pipeline: string) => get<PipelineReport>('reports/pipeline', { pipeline }),
  funnel: (p: Params) => get<Funnel>('reports/funnel', p),
  forecast: (p: Params) => get<Forecast>('reports/forecast', p),
  winloss: (p: Params) => get<WinLoss>('reports/winloss', p),
  stageTime: (p: Params) => get<StageTime>('reports/stage_time', p),
  sources: (p: Params) => get<Sources>('reports/sources', p),
  activityReport: (p: Params) => get<ActivityReport>('reports/activity', p),
  relationships: () => get<Relationships>('reports/relationships'),

  fx: () => get<{ home: string; in_use: { currency: string; latest: string; deals: number }[]; rates: FxRate[] }>('fx/list'),
  setRate: (currency: string, rate: string, date?: string | undefined) => post<{ rate: FxRate }>('fx/set', { currency, rate, date }),
  fetchRates: () => post<{ stored: number; missing: string[] }>('fx/fetch', {}),
  deleteRate: (rate: string) => post<{ deleted: boolean }>('fx/delete', { rate }),

  activity: (p: { actor?: string | undefined; run?: string | undefined; target?: string | undefined; limit?: number | undefined }) => get<{ activity: ActivityEntry[] }>('activity/list', p),
  undo: (entry?: string | undefined) => post<{ entry: ActivityEntry }>('activity/undo', { entry }),
  redo: (entry?: string | undefined) => post<{ entry: ActivityEntry }>('activity/redo', { entry }),
  runs: () => get<{ runs: Run[] }>('activity/runs'),
  revertRun: (run: string) => post<{ reverted: number; skipped: { entry: string; summary: string; reason: string }[] }>('activity/revert_run', { run }),

  ask: (question: string, kind: Ask['kind'] = 'question', context?: unknown) => post<{ ask: Ask; asked: boolean; reason: string }>('asks/create', { question, kind, context }),
  asks: () => get<{ asks: Ask[] }>('asks/list', { limit: 30 }),
  deleteAsk: (ask: string) => post<{ deleted: boolean }>('asks/delete', { ask }),
};

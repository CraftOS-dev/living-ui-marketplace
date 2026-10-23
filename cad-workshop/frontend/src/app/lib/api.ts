/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  AppStatus,
  Asset,
  Batch,
  Brief,
  Build,
  Check,
  CompareResult,
  EditResult,
  ExportFile,
  FeatureKind,
  Json,
  MeasureResult,
  Params,
  Part,
  PartDetail,
  Schema,
  Settings,
} from './types.ts';

type Value = string | number | boolean | null | undefined;
type Query = Record<string, Value>;

function clean(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function get<T>(op: string, params: Query = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'GET', query }), { silent });
}

function post<T>(op: string, body: Record<string, unknown> = {}, silent = false): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: clean(body) }), { silent });
}

function postForm<T>(op: string, form: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: form }));
}

export interface EditOptions {
  dry_run?: boolean;
  note?: string;
  silent?: boolean;
  /** Seconds to wait for the build (the form waits to show the result). */
  wait_s?: number;
}

export interface ChecksList {
  part: string;
  checks: Check[];
  passing: number;
  failing: number;
}

export interface Selection {
  part: string;
  keys: string[];
  faces: string[];
  edges: string[];
  bodies: string[];
  set_by: 'you' | 'agent' | null;
  stale: string[];
}

/** The edit options the operations read (silent only changes how errors show here). */
function eo(o: EditOptions): Record<string, unknown> {
  return { dry_run: o.dry_run, note: o.note, wait_s: o.wait_s };
}

export const api = {
  /* app */
  status: (): Promise<AppStatus> => get('app/status', {}, true),
  settings: (): Promise<Settings> => get('settings/get'),
  updateSettings: (p: Partial<Omit<Settings, 'materials' | 'last_prune_at'>> & { materials?: { name: string; density: number }[] }): Promise<Settings> =>
    post('settings/update', { ...p, materials: p.materials !== undefined ? JSON.stringify(p.materials) : undefined }),
  runJob: (job: 'prune' | 'requeue' | 'engine_start' | 'engine_test' | 'engine_install'): Promise<Record<string, unknown>> => post('jobs/run', { job }),
  schema: (): Promise<Schema> => get('features/schema', { full: true }),

  /* parts */
  parts: (p: Query = {}): Promise<{ parts: Part[]; more: boolean; total: number }> => get('parts/list', p),
  part: (part: string, silent = false): Promise<PartDetail> => get('parts/get', { part }, silent),
  createPart: (p: { name: string; description?: string; material?: string; color?: string }): Promise<{ part: Part }> => post('parts/create', p),
  updatePart: (part: string, p: Partial<{ name: string; description: string; material: string; density: number; color: string; pinned: boolean; archived: boolean; notes: string }>): Promise<{ part: Part }> =>
    post('parts/update', { part, ...p }),
  duplicatePart: (part: string, name?: string): Promise<{ part: Part }> => post('parts/duplicate', { part, name }),

  /* tree edits */
  setParam: (part: string, p: { name: string; value?: string | undefined; kind?: string | undefined; min?: number | null | undefined; max?: number | null | undefined; clear_bounds?: boolean | undefined; comment?: string | undefined; rename?: string | undefined }, o: EditOptions = {}): Promise<EditResult> =>
    post('params/set', { part, ...p, ...eo(o) }, o.silent === true),
  addFeature: (part: string, kind: FeatureKind, params: Params, extra: { name?: string | undefined; after?: string | undefined } = {}, o: EditOptions = {}): Promise<EditResult> =>
    post('features/add', { part, kind, params: JSON.stringify(params), ...extra, ...eo(o) }, o.silent === true),
  updateFeature: (part: string, feature: string, p: { params?: Params | undefined; merge?: boolean | undefined; name?: string | undefined; suppressed?: boolean | undefined; feature_note?: string | undefined }, o: EditOptions = {}): Promise<EditResult> =>
    post('features/update', { part, feature, ...p, params: p.params !== undefined ? JSON.stringify(p.params) : undefined, ...eo(o) }, o.silent === true),
  moveFeature: (part: string, feature: string, after: string): Promise<EditResult> => post('features/move', { part, feature, after }),
  rollTo: (part: string, to: string): Promise<EditResult> => post('features/roll-to', { part, to }),
  batch: (part: string, steps: Record<string, Json>[], o: EditOptions = {}): Promise<EditResult> => post('edits/batch', { part, steps: JSON.stringify(steps), ...eo(o) }),

  /* builds and model */
  build: (build: string): Promise<{ build: Build }> => get('builds/get', { build }, true),
  runBuild: (part: string, force = false): Promise<{ status: string; build: Build | null }> => post('builds/run', { part, force }),
  cancelBuild: (part: string): Promise<{ cancelled: number; stopped_running: boolean }> => post('builds/cancel', { part }),
  measure: (part: string, a: string, b?: string): Promise<MeasureResult> => get('model/measure', { part, a, b }, true),
  properties: (part: string): Promise<Record<string, Json>> => get('model/properties', { part }),
  compare: (part: string, p: { batch?: string; from?: string; to?: string }): Promise<CompareResult> => post('compare/builds', { part, ...p }),

  /* exports */
  exportPart: (part: string, format: 'step' | 'stl' | '3mf' | 'glb', tolerance?: number): Promise<{ export: ExportFile; warning?: string; check?: string }> =>
    post('exports/create', { part, format, tolerance }),
  exports: (p: Query = {}): Promise<{ exports: ExportFile[]; more: boolean }> => get('exports/list', p),

  /* history */
  changes: (p: Query = {}): Promise<{ batches: Batch[]; more: boolean }> => get('changes/list', p),
  revert: (batch: string, preview = false, force = false): Promise<EditResult & { would_undo?: string[]; conflicts?: { batch: string; targets: string[] }[]; needs_force?: boolean }> =>
    post('changes/revert', { batch, preview, force }),

  /* selection */
  selection: (part: string): Promise<Selection> => get('selection/get', { part }, true),
  setSelection: (part: string, keys: string[]): Promise<Selection> => post('selection/set', { part, keys: JSON.stringify(keys) }, true),

  /* checks */
  checks: (part: string): Promise<ChecksList> => get('checks/list', { part }),
  saveCheck: (
    part: string,
    p: { check?: string | undefined; name: string; kind: string; op?: string | undefined; target?: number | undefined; target_max?: number | undefined; tolerance?: number | undefined; refs?: Record<string, Json> | undefined; box?: number[] | undefined },
  ): Promise<{ check: Check }> => post('checks/save', { part, ...p, refs: p.refs !== undefined ? JSON.stringify(p.refs) : undefined, box: p.box !== undefined ? JSON.stringify(p.box) : undefined }),

  /* files to import */
  assets: (part: string): Promise<{ assets: Asset[] }> => get('assets/list', { part }),
  addAsset: (part: string, file: File): Promise<{ asset: Asset }> => {
    const f = new FormData();
    f.append('part', part);
    f.append('file', file);
    return postForm('assets/add', f);
  },

  /* requests to the AI agent */
  createRequest: (p: { kind: 'design' | 'repair' | 'review'; part?: string | undefined; title?: string | undefined; body?: string | undefined; process?: string | undefined }): Promise<{ brief: Brief; asked: boolean; message: string }> =>
    post('requests/create', p),
  requests: (p: Query = {}): Promise<{ briefs: Brief[] }> => get('requests/list', p),

  /* delete anything */
  deletePreview: (collection: string, id: string): Promise<Record<string, Json>> => post('records/delete', { collection, id, preview: true }),
  delete: (collection: string, id: string): Promise<Record<string, Json>> => post('records/delete', { collection, id }),
};

/** A stored file's URL, made absolute for downloads. */
export function fileUrl(path: string, download = false): string {
  if (path === '') return '';
  const base = getPbClient().pb.baseURL.replace(/\/$/, '');
  return base + path + (download ? (path.includes('?') ? '&' : '?') + 'download=1' : '');
}

/** Fetch a binary file (the viewer's meshes). */
export async function fetchBinary(path: string): Promise<ArrayBuffer> {
  const res = await fetch(fileUrl(path), { cache: 'force-cache' });
  if (!res.ok) throw new Error('Could not load the model (' + res.status + ')');
  return res.arrayBuffer();
}

/** Fetch a JSON file (the topology). */
export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(fileUrl(path), { cache: 'force-cache' });
  if (!res.ok) throw new Error('Could not load the topology (' + res.status + ')');
  return (await res.json()) as T;
}

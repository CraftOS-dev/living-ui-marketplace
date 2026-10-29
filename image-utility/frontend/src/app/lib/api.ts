/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  Analysis,
  AppStatus,
  Asset,
  BatchPreview,
  BatchRec,
  CompareResult,
  Defaults,
  EditKind,
  EditResult,
  Estimate,
  ExportRec,
  HistoryBatch,
  ImageDetail,
  ImageRec,
  Output,
  Params,
  Policy,
  Preset,
  Proposal,
  Region,
  RenderResult,
  RequestRec,
  Schema,
  Settings,
  UiContext,
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
  /** Preview size (longest edge) of a dry run. */
  max?: number;
  note?: string;
  silent?: boolean;
}

function eo(o: EditOptions): Record<string, unknown> {
  return { dry_run: o.dry_run, max: o.max, note: o.note };
}

export interface ExportSpec {
  outputs?: Output[];
  preset?: string;
  metadata?: 'keep' | 'basic' | 'none';
  strip_gps?: boolean;
  matte?: string;
}

export const api = {
  /* app */
  status: (): Promise<AppStatus> => get('app/status', {}, true),
  schema: (): Promise<Schema> => get('app/schema'),
  settings: (): Promise<Settings> => get('settings/get'),
  updateSettings: (p: { defaults?: Partial<Defaults>; policy?: Partial<Policy>; export_folder?: string }): Promise<Settings> => post('settings/update', p),
  reportUi: (p: { view: string; image?: string; tool?: string; edit?: string; selection?: Region | null; images?: string[] }): Promise<{ ok: boolean }> => post('app/ui', p, true),
  context: (): Promise<UiContext> => get('app/context', {}, true),
  install: (what: 'core' | 'bg' | 'bg_detailed'): Promise<Record<string, unknown>> => post('engine/install', { what }),
  testEngine: (): Promise<{ ok: boolean; engine: Record<string, string | number | null>; ms: number }> => post('engine/test'),

  /* images */
  images: (p: Query = {}): Promise<{ images: ImageRec[]; total: number; total_bytes: number; edited: number }> => get('images/list', p),
  image: (image: string, silent = false): Promise<ImageDetail> => get('images/get', { image }, silent),
  info: (image: string): Promise<ImageRec & { histogram: RenderResult['histogram']; histogram_error?: string; exif?: Record<string, string> }> => get('images/info', { image }),
  render: (
    image: string,
    p: { upto?: string | undefined; proposal?: string | undefined; original?: boolean | undefined; region?: Region | undefined; max?: number | undefined; histogram?: boolean | undefined; layers?: boolean | undefined; draft?: { kind: EditKind; params: Params } | undefined } = {},
    silent = false,
  ): Promise<RenderResult> => post('images/render', { image, ...p }, silent),
  importFiles: (files: File[]): Promise<{ images: ImageRec[]; failed: { name?: string; path?: string; error: string }[] }> => {
    const f = new FormData();
    for (const file of files) f.append('files', file);
    return postForm('images/import', f);
  },
  importPaths: (p: { path?: string; paths?: string[]; folder?: string }): Promise<{ images: ImageRec[]; failed: { name?: string; path?: string; error: string }[] }> => post('images/import', p),
  updateImage: (image: string, p: Partial<{ name: string; title: string; alt_text: string; caption: string; notes: string; keywords: string[]; pinned: boolean }>): Promise<{ ok: boolean; image: ImageRec }> => post('images/update', { image, ...p }),
  duplicate: (image: string, withEdits = true): Promise<{ ok: boolean; image: ImageRec }> => post('images/duplicate', { image, with_edits: withEdits }),
  deleteImages: (images: string[]): Promise<{ ok: boolean; deleted: number }> => post('images/delete', { images }),
  analyze: (image: string, what: string[], p: { ratio?: string | undefined; upto?: string | undefined } = {}): Promise<Analysis> => post('analyze/image', { image, what, ...p }),
  filterPreviews: (image: string, upto?: string): Promise<{ filters: { name: string; label: string; url: string }[] }> => post('filters/previews', { image, upto }, true),

  /* edits */
  addEdit: (image: string, kind: EditKind, params: Params, extra: { at?: number | undefined } = {}, o: EditOptions = {}): Promise<EditResult> =>
    post('edits/add', { image, kind, params, ...extra, ...eo(o) }, o.silent === true),
  updateEdit: (edit: string, p: { params?: Params; replace?: boolean; enabled?: boolean }, o: EditOptions = {}): Promise<EditResult> => post('edits/update', { edit, ...p, ...eo(o) }, o.silent === true),
  moveEdit: (edit: string, to: number): Promise<EditResult> => post('edits/move', { edit, to }),
  removeEdits: (edits: string[]): Promise<EditResult> => post('edits/remove', { edits }),
  applyEdits: (image: string, p: { preset?: string; edits?: { kind: EditKind; params: Params }[]; replace?: boolean }, o: EditOptions = {}): Promise<EditResult> => post('edits/apply', { image, ...p, ...eo(o) }, o.silent === true),
  copyEdits: (from: string, to: string[], kinds?: EditKind[], replace = false): Promise<{ ok: boolean; results: { image: ImageRec; skipped: string[] }[] }> => post('edits/copy', { from, to, kinds, replace }),
  reset: (image: string): Promise<EditResult> => post('edits/reset', { image }),

  /* layers (edits of kind layer; params in the layer's own space) */
  arrangeLayer: (layer: string, to: 'front' | 'back' | 'forward' | 'backward'): Promise<EditResult & { unchanged?: boolean }> => post('layers/arrange', { layer, to }),

  /* history */
  history: (p: Query = {}): Promise<{ batches: HistoryBatch[]; more: boolean }> => get('history/list', p),
  undo: (image: string): Promise<EditResult> => post('history/undo', { image }),
  redo: (image: string): Promise<EditResult> => post('history/redo', { image }),
  revert: (batch: string): Promise<EditResult & { note?: string }> => post('history/revert', { batch }),

  /* proposals */
  proposals: (p: Query = {}): Promise<{ proposals: Proposal[] }> => get('proposals/list', p),
  accept: (proposal: string): Promise<{ ok: boolean; proposal: Proposal }> => post('proposals/accept', { proposal }),
  reject: (proposal: string, reason?: string): Promise<{ ok: boolean; proposal: Proposal }> => post('proposals/reject', { proposal, reason }),

  /* export */
  estimate: (image: string, spec: ExportSpec, silent = true): Promise<Estimate> => post('export/estimate', { image, ...spec }, silent),
  compare: (image: string, spec: ExportSpec & { cx?: number; cy?: number; w?: number; h?: number }): Promise<CompareResult> => post('export/compare', { image, ...spec }),
  exportImage: (image: string, spec: ExportSpec & { name?: string | undefined; folder?: string | undefined }): Promise<{ ok: boolean; exports: ExportRec[]; ms: number }> => post('export/create', { image, ...spec }),
  exports: (p: Query = {}): Promise<{ exports: ExportRec[]; total: number; total_bytes: number }> => get('exports/list', p),
  deleteExports: (exports: string[]): Promise<{ ok: boolean; deleted: number }> => post('exports/delete', { exports }),

  /* presets */
  presets: (kind?: Preset['kind']): Promise<{ presets: Preset[] }> => get('presets/list', { kind }),
  savePreset: (p: { preset?: string; name?: string; kind?: Preset['kind']; description?: string; data?: Preset['data']; from_image?: string }): Promise<{ ok: boolean; preset: Preset; skipped: string[] }> => post('presets/save', p),
  deletePreset: (preset: string): Promise<{ ok: boolean }> => post('presets/delete', { preset }),

  /* batches */
  batches: (p: Query = {}): Promise<{ batches: BatchRec[] }> => get('batches/list', p),
  batch: (batch: string): Promise<{ batch: BatchRec }> => get('batches/get', { batch }),
  createBatch: (p: {
    images: string[];
    name?: string | undefined;
    recipe_preset?: string | undefined;
    edits?: { kind: EditKind; params: Params }[] | undefined;
    use_edits?: boolean | undefined;
    rename?: string | undefined;
    folder?: string | undefined;
    collision?: 'rename' | 'skip' | 'overwrite' | undefined;
    outputs?: Output[] | undefined;
    preset?: string | undefined;
    metadata?: 'keep' | 'basic' | 'none' | undefined;
    strip_gps?: boolean | undefined;
  }): Promise<{ ok: boolean; batch: BatchRec }> => post('batches/create', p),
  previewBatch: (batch: string, samples = 3): Promise<BatchPreview> => post('batches/preview', { batch, samples }),
  runBatch: (batch: string): Promise<{ ok: boolean; batch: BatchRec }> => post('batches/run', { batch }),
  cancelBatch: (batch: string): Promise<{ ok: boolean; batch: BatchRec }> => post('batches/cancel', { batch }),
  retryBatch: (batch: string): Promise<{ ok: boolean; batch: BatchRec }> => post('batches/retry', { batch }),
  deleteBatch: (batch: string): Promise<{ ok: boolean }> => post('batches/delete', { batch }),

  /* requests */
  createRequest: (p: { kind: 'edit' | 'describe'; image?: string | undefined; images?: string[] | undefined; title?: string | undefined; body?: string | undefined; region?: Region | null | undefined }): Promise<{ ok: boolean; request: RequestRec; asked: boolean; message: string }> =>
    post('requests/create', p),
  requests: (p: Query = {}): Promise<{ requests: RequestRec[] }> => get('requests/list', p),

  /* logos */
  assets: (): Promise<{ assets: Asset[] }> => get('assets/list'),
  addAsset: (file: File, name?: string): Promise<{ ok: boolean; asset: Asset }> => {
    const f = new FormData();
    f.append('file', file);
    if (name !== undefined) f.append('name', name);
    return postForm('assets/add', f);
  },
  deleteAsset: (asset: string): Promise<{ ok: boolean }> => post('assets/delete', { asset }),
};

/** A stored file's URL, made absolute (downloads add ?download=1). */
export function fileUrl(path: string, download = false): string {
  if (path === '') return '';
  const base = getPbClient().pb.baseURL.replace(/\/$/, '');
  return base + path + (download ? (path.includes('?') ? '&' : '?') + 'download=1' : '');
}

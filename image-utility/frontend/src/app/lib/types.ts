/** What the operations answer (pb_hooks/lib_*.js serializers). */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Params = Record<string, Json>;

export type EditKind = 'crop' | 'resize' | 'canvas' | 'adjust' | 'filter' | 'remove_bg' | 'layer';
export type LayerType = 'text' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'highlight' | 'step' | 'pen' | 'redact' | 'logo';
/** Photo-to-result map (a, b, c, d, e, f): x' = a x + b y + c, y' = d x + e y + f. */
export type Affine = [number, number, number, number, number, number];
export type Actor = 'you' | 'agent' | 'system';
export type Dims = [number, number];

export interface ImageRec {
  id: string;
  name: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  frames: number;
  duration_ms: number;
  alpha: boolean;
  mode: string;
  icc: string;
  wide_gamut: boolean;
  gps: { lat: number; lon: number; alt?: number } | null;
  out_width: number;
  out_height: number;
  edits_count: number;
  status: 'pending' | 'ready' | 'failed';
  error: string;
  origin: Actor;
  pinned: boolean;
  title: string;
  alt_text: string;
  caption: string;
  keywords: string[];
  notes: string;
  last_exported: string;
  exports_count: number;
  original_url: string;
  original_path: string;
  thumb_url: string;
  preview_url: string;
  preview_path: string;
  transform: Affine | null;
  created: string;
  updated: string;
  exif?: Record<string, string>;
  dpi?: [number, number] | null;
  hash?: string;
  /** Where the file was imported from on this computer ('' for uploads and pastes). */
  source_path: string;
}

export interface Edit {
  id: string;
  kind: EditKind;
  label: string;
  icon: string;
  params: Params;
  enabled: boolean;
  author: Actor;
  state: 'active' | 'proposed';
  proposal: string;
  note: string;
  summary: string;
  in: Dims;
  out: Dims;
  mask_url: string;
  mask_info: { kept_pct: number; soft_edge_pct: number; ms: number } | null;
  created: string;
  updated: string;
}

export interface Proposal {
  id: string;
  kind: 'edits' | 'batch';
  image: { id: string; name: string } | null;
  title: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  preview_url: string;
  preview_path: string;
  summary: { edits?: { kind: EditKind; summary: string }[]; out?: Dims; error?: string };
  batch: string;
  author: Actor;
  decided_at: string;
  response: string;
  created: string;
  updated: string;
}

export interface ExportRec {
  id: string;
  image: string;
  batch: string;
  name: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  source_bytes: number;
  settings: Record<string, Json>;
  folder_path: string;
  url: string;
  path: string;
  requested_by: Actor;
  created: string;
  saved_pct?: number | null;
  quality?: number | null;
  met_target?: boolean | null;
}

export interface RequestRec {
  id: string;
  kind: 'edit' | 'describe';
  image: { id: string; name: string } | null;
  images: string[];
  title: string;
  body: string;
  region: Region | null;
  status: 'sent' | 'working' | 'done' | 'failed';
  result: string;
  request_id: string;
  created: string;
  updated: string;
}

export interface ImageDetail extends ImageRec {
  stack: Edit[];
  proposals: Proposal[];
  exports: ExportRec[];
  requests: RequestRec[];
  undo: { can_undo: boolean; can_redo: boolean };
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Histogram {
  luma: number[];
  r: number[];
  g: number[];
  b: number[];
  clipped: { shadows: number; highlights: number };
}

export interface RenderResult {
  image: string;
  url: string;
  path: string;
  width: number;
  height: number;
  preview_width: number;
  preview_height: number;
  region: Region | null;
  chain: Dims[];
  transform: Affine | null;
  alpha: boolean;
  histogram: Histogram | null;
  ms: number;
  cached: boolean;
}

export interface EditResult {
  ok: boolean;
  dry_run?: boolean;
  applied: boolean;
  proposed?: boolean;
  batch?: string;
  image: ImageRec | { id: string; name: string; width: number; height: number };
  out?: Dims;
  stack: Edit[];
  preview: { url: string; path: string; width?: number; height?: number };
  warnings: string[];
  summary: string;
  edit?: Edit;
  proposal?: Proposal;
  message?: string;
  engine?: string;
}

export interface HistoryChange {
  id: string;
  action: string;
  edit: string;
  before: Json;
  after: Json;
  created: string;
}

export interface HistoryBatch {
  batch: string;
  image: { id: string; name: string };
  actor: Actor;
  note: string;
  kind: 'edit' | 'undo' | 'redo';
  reverted_by: string;
  reverts: string;
  count: number;
  created: string;
  changes: HistoryChange[];
}

export type Format = 'webp' | 'avif' | 'jpeg' | 'png' | 'gif' | 'ico' | 'tiff';
export type QualityName = 'best' | 'balanced' | 'small';

export interface Output {
  format: Format;
  quality?: QualityName | number;
  mode?: 'quality' | 'size' | 'lossless';
  target_kb?: number;
  longest?: number;
  scale?: number;
  square?: number;
  suffix?: string;
  name?: string;
  ico_sizes?: number[];
  effort?: 'fast' | 'normal' | 'max';
}

export interface OutputFacts {
  name: string;
  format: Format;
  width: number;
  height: number;
  bytes: number;
  quality: number | null;
  frames: number;
  saved_pct: number | null;
  met_target: boolean | null;
  shrunk: boolean;
}

export interface Estimate {
  image: string;
  source: { bytes: number; format: string; width: number; height: number };
  outputs: OutputFacts[];
  ms: number;
  settings: { metadata: string; strip_gps: boolean; matte: string };
}

export interface CompareResult {
  before: string;
  after: string;
  box: Region;
  bytes: number;
  width: number;
  height: number;
  quality: number | null;
  ms: number;
}

export interface Preset {
  id: string;
  name: string;
  kind: 'export' | 'size' | 'recipe';
  description: string;
  data: { outputs?: Output[]; metadata?: string; strip_gps?: boolean; width?: number; height?: number; edits?: { kind: EditKind; params: Params }[] };
  builtin: boolean;
  sort: number;
}

export interface BatchRec {
  id: string;
  name: string;
  images: string[];
  recipe: { use_edits?: boolean; edits?: { kind: EditKind; params: Params }[] };
  outputs: { outputs?: Output[]; common?: { metadata: string; strip_gps: boolean; matte: string }; preset?: string };
  rename: string;
  collision: 'rename' | 'skip' | 'overwrite';
  folder: string;
  status: 'draft' | 'proposed' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  total: number;
  done_count: number;
  failed_count: number;
  bytes_in: number;
  bytes_out: number;
  zip_url: string;
  zip_path: string;
  started: string;
  finished: string;
  requested_by: Actor;
  error: string;
  created: string;
  updated: string;
  results?: Record<string, { status: 'done' | 'failed'; outputs?: { export: string; name: string; bytes: number; width: number; height: number }[]; bytes_in?: number; skipped_in_folder?: number; error?: string }>;
}

export interface BatchPreview {
  batch: BatchRec;
  rows: { image: { id: string; name: string; bytes?: number }; outputs: { name: string; format: Format; width: number; height: number; duplicate: boolean; exists: boolean }[]; missing?: boolean }[];
  duplicates: string[];
  existing: string[];
  samples: { image: { id: string; name: string; bytes?: number }; outputs?: OutputFacts[]; ms?: number; error?: string }[];
  estimate: { bytes_in: number; bytes_out: number; from_samples: number } | null;
  tokens: string[];
}

export interface Asset {
  id: string;
  name: string;
  url: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
  created: string;
}

export interface SetupGroup {
  label: string;
  installed: boolean;
  download_mb: number;
  total_mb: number;
}

export interface EngineSetup {
  state: 'ready' | 'pending' | 'downloading' | 'installing' | 'failed' | 'off';
  groups: { core: SetupGroup; bg: SetupGroup; bg_detailed: SetupGroup };
  progress: { phase: string; group: string; label: string; step: string; done_bytes: number; total_bytes: number; error: string } | null;
  requested: string[];
}

export interface EngineStatus {
  installed: boolean;
  missing: string[];
  running: boolean;
  busy: boolean;
  pid: number | null;
  load_ms: number | null;
  folder: string;
  log: string;
  setup: EngineSetup;
}

export interface AppStatus {
  engine: EngineStatus;
  setup: EngineSetup;
  images: number;
  pending_images: number;
  proposals: number;
  open_requests: number;
  batches_running: number;
  exports: number;
  now: string;
}

export interface Defaults {
  format: Format;
  quality: QualityName | number;
  metadata: 'keep' | 'basic' | 'none';
  strip_gps: boolean;
  matte: string;
  effort: 'fast' | 'normal' | 'max';
  resample?: string;
}

export interface Policy {
  agent_edits: 'propose' | 'apply';
  agent_batches: 'propose' | 'run';
  house_rules: string;
}

export interface Settings {
  defaults: Defaults;
  policy: Policy;
  export_folder: string;
}

export interface KindDef {
  label: string;
  icon: string;
  summary: string;
  resizes?: boolean;
}

export interface Schema {
  kinds: Record<EditKind, KindDef>;
  filters: { name: string; label: string }[];
  adjust: { key: string; label: string; min: number; max: number; step: number }[];
  resample: string[];
  fonts: string[];
  layer_types: { type: LayerType; label: string }[];
}

export interface Analysis {
  auto?: Params;
  trim?: Region | null;
  smart?: Region;
  colors?: string[];
  histogram?: Histogram;
  alpha?: boolean;
  ms?: number;
}

export interface UiContext {
  screen: { view: string; image: string; tool: string; edit: string; selection: Region | null; images: string[]; at: string } | null;
}

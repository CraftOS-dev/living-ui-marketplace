/** Shapes of what the operations answer (pb_hooks lib_*.js). */

export type Actor = 'you' | 'agent' | 'system';
export type PartStatus = 'empty' | 'queued' | 'building' | 'ok' | 'warning' | 'failed';
export type FeatureStatus = 'pending' | 'ok' | 'warning' | 'error' | 'suppressed' | 'rolled_back' | 'not_built';
export type BodySlot = 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'graphite';
export type FeatureKind =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'primitive'
  | 'hole'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'pattern_linear'
  | 'pattern_circular'
  | 'mirror'
  | 'boolean'
  | 'transform'
  | 'import_step'
  | 'push_pull';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Params = { [k: string]: Json };

export interface Bbox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface Summary {
  volume_mm3: number;
  area_mm2: number;
  bbox: Bbox | null;
  center_of_mass: [number, number, number];
  bodies: { name: string; volume_mm3: number; bbox: Bbox | null; solids: number }[];
  solids: number;
  faces: number;
  edges: number;
  valid: boolean;
  mass_g?: number;
}

export interface CadError {
  code: string;
  message: string;
  feature?: string;
  found?: number;
  expected?: string;
  candidates?: string[];
}

export interface FeatureResult {
  name: string;
  status: FeatureStatus;
  ms?: number;
  faces?: number;
  error?: CadError;
  warnings?: string[];
  cached?: boolean;
}

export interface CheckResult {
  id: string;
  result: 'pass' | 'fail' | 'cannot_run';
  value: number | null;
  detail?: string;
}

export interface Build {
  id: string;
  status: 'queued' | 'running' | 'ok' | 'warning' | 'failed' | 'cancelled';
  requested_by: Actor;
  preview: boolean;
  created: string;
  finished: string;
  ms: number;
  cached_features: number;
  triangles: number;
  summary: Summary | null;
  features: FeatureResult[];
  error: CadError | null;
  checks: CheckResult[];
  note: string;
  files: { view: string; topology: string; thumb: string; topology_path: string };
}

export interface Part {
  id: string;
  name: string;
  description: string;
  material: string;
  density: number | null;
  density_used: number | null;
  color: BodySlot;
  status: PartStatus;
  tree_hash: string;
  pinned: boolean;
  archived: boolean;
  origin: 'you' | 'agent' | 'import';
  notes: string;
  thumbnail: string;
  current_build: string;
  volume_mm3: number | null;
  mass_g: number | null;
  size_mm: [number, number, number] | null;
  bodies: number;
  features?: number;
  created: string;
  updated: string;
}

export interface Parameter {
  id: string;
  name: string;
  kind: 'length' | 'angle' | 'count' | 'ratio';
  expr: string;
  value: number;
  bounds: { min?: number; max?: number } | null;
  comment: string;
  author: 'you' | 'agent';
  error: string;
}

export interface Feature {
  id: string;
  name: string;
  kind: FeatureKind;
  label: string;
  icon: string;
  params: Params;
  suppressed: boolean;
  author: 'you' | 'agent';
  status: FeatureStatus;
  error: CadError | null;
  warnings: string[] | null;
  ms: number;
  faces: number;
  note: string;
  position: number;
  used_by: string[];
}

export interface Check {
  id: string;
  name: string;
  kind: string;
  refs: { a?: Json; b?: Json } | null;
  op: 'eq' | 'le' | 'ge' | 'between';
  target: number;
  target_max: number;
  tolerance: number;
  box: [number, number, number] | null;
  author: 'you' | 'agent';
  result: 'pending' | 'pass' | 'fail' | 'cannot_run';
  value: number | null;
  detail: string;
  build: string;
}

export interface ExportFile {
  id: string;
  part: { id: string; name: string } | null;
  format: 'step' | 'stl' | '3mf' | 'glb';
  name: string;
  bytes: number;
  triangles: number | null;
  tolerance: number | null;
  verified: boolean;
  requested_by: 'you' | 'agent';
  pinned: boolean;
  created: string;
  path: string;
  url: string;
  outdated: boolean;
}

export interface Asset {
  id: string;
  name: string;
  kind: string;
  bytes: number;
  path: string;
}

export interface PartDetail {
  part: Part;
  parameters: Parameter[];
  features: Feature[];
  rollback_after: string;
  build: Build | null;
  build_is_current: boolean;
  pending_build: { id: string; status: string } | null;
  selection: string[];
  checks: Check[];
  exports: ExportFile[];
  assets: Asset[];
}

export interface Change {
  id: string;
  batch: string;
  actor: Actor;
  action: 'add_feature' | 'update_feature' | 'move_feature' | 'delete_feature' | 'set_parameter' | 'delete_parameter' | 'roll_to';
  target: string;
  before: Json;
  after: Json;
  note: string;
  reverted_by: string;
  reverts: string;
  created: string;
}

export interface Batch {
  batch: string;
  part: { id: string; name: string };
  actor: Actor;
  note: string;
  created: string;
  count: number;
  reverted_by: string;
  reverts: string;
  /** edit: a change made; undo: it reverts an edit; redo: it puts an undone edit back. */
  kind: 'edit' | 'undo' | 'redo';
  hash_before: string;
  hash_after: string;
  changes: Change[];
}

export interface Settings {
  display_unit: 'mm' | 'in';
  navigation: 'left_rotates' | 'right_rotates' | 'middle_rotates';
  projection: 'perspective' | 'orthographic';
  show_grid: boolean;
  default_material: string;
  materials: { name: string; density: number }[];
  agent_wait_s: number;
  last_prune_at: string;
}

/** The engine's one-off first-run download (lib_setup.js). */
export interface EngineSetup {
  state: 'ready' | 'pending' | 'downloading' | 'installing' | 'failed' | 'off';
  step: string;
  done_bytes: number;
  total_bytes: number;
  error: string;
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
  running: { build: string; part: string; seconds: number } | null;
  queued_builds: number;
  parts_by_status: Partial<Record<PartStatus, number>>;
  open_requests: number;
  now: string;
}

export interface Delta {
  volume_mm3: number;
  area_mm2: number;
  faces: number;
  edges: number;
  solids: number;
  size_before_mm: [number, number, number] | null;
  size_after_mm: [number, number, number] | null;
  text: string;
}

export interface EditResult {
  ok: boolean;
  status: 'applied' | 'failed' | 'queued' | 'reverted' | 'unchanged' | 'dry_run';
  part: { id: string; name: string; tree_hash: string; status: PartStatus };
  change: { batch: string; ids: string[]; created: string[] } | null;
  build: { id: string; status: string; ms: number; cached_features: number; preview: boolean; view: string } | null;
  delta: Delta | null;
  summary: Summary | null;
  features: FeatureResult[];
  warnings: string[];
  error: CadError | null;
  hints: string[];
}

export interface Brief {
  id: string;
  kind: 'design' | 'repair' | 'review';
  part: { id: string; name: string } | null;
  title: string;
  body: string;
  selection: string[];
  status: 'sent' | 'working' | 'done' | 'failed';
  result: string;
  request_id: string;
  created: string;
  updated: string;
}

export interface TopoFace {
  i: number;
  key: string;
  base: string;
  feature: string;
  role: string;
  body: string;
  type: string;
  area: number;
  center: [number, number, number];
  normal?: [number, number, number];
  /** For flat faces: the frame a sketch on this face uses. */
  frame?: SketchFrame;
  radius?: number;
  axis?: { origin: [number, number, number]; direction: [number, number, number] };
}

/** A sketch plane: origin, right (u), up (v) and normal. */
export interface SketchFrame {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  normal: [number, number, number];
}

/** A built sketch as the engine reports it: loops (2D polylines) and construction lines. */
export interface SketchOutlineData {
  name: string;
  frame: SketchFrame;
  loops: { id: string; poly: [number, number][]; depth: number; inside: string | null }[];
  lines: { id: string; from: [number, number]; to: [number, number] }[];
}

export interface TopoEdge {
  i: number;
  key: string;
  base: string;
  body: string;
  type: string;
  length: number;
  center: [number, number, number];
  faces: [string, string];
  convexity: string;
  ends: [[number, number, number], [number, number, number]];
  direction?: [number, number, number];
  radius?: number;
  axis?: { origin: [number, number, number]; direction: [number, number, number] };
}

export interface Topology {
  bodies: string[];
  faces: TopoFace[];
  edges: TopoEdge[];
  sketches: SketchOutlineData[];
}

export interface MeasureEntity {
  kind: 'face' | 'edge' | 'body';
  key?: string;
  name?: string;
  type?: string;
  area?: number;
  length?: number;
  radius?: number;
  center?: [number, number, number];
  normal?: [number, number, number];
  volume_mm3?: number;
}

export interface MeasureResult {
  part: string;
  a: MeasureEntity;
  b?: MeasureEntity;
  distance?: { min_mm: number; from: [number, number, number]; to: [number, number, number]; dx: number; dy: number; dz: number };
  angle_deg?: number;
  parallel_gap_mm?: number;
  axis_distance_mm?: number;
  center_distance_mm?: number;
}

export interface CompareResult {
  compare: string;
  part: string;
  from_build: string;
  to_build: string;
  added_mm3: number;
  removed_mm3: number;
  before_mm3: number;
  after_mm3: number;
  files: { added: string; removed: string; from_view: string; to_view: string };
}

/** The feature-kind schema (features.schema --full). */
export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  type: string;
  label?: string;
  help?: string;
  required?: boolean;
  default?: Json;
  options?: FieldOption[];
  when?: Record<string, (string | boolean | null)[]>;
  fields?: FieldDef[];
  item?: FieldDef;
  min?: number;
  max?: number;
}

export interface KindDef {
  kind: FeatureKind;
  label: string;
  icon: string;
  summary: string;
  creates: string;
  fields: FieldDef[];
  example: Params;
}

export interface ItemTypeDef {
  label: string;
  icon: string;
  segments: string;
  fields: FieldDef[];
}

export interface Schema {
  kinds: Record<FeatureKind, KindDef>;
  item_types: Record<string, ItemTypeDef>;
  order: FeatureKind[];
  /** What the automatic name prefixes stand for ("ext" reads "Extrude"). */
  name_labels: Record<string, string>;
}

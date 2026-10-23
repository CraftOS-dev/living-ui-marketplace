/** What the operations answer (pb_hooks/lib_*.js), as the screens read it. */

export type Actor = 'person' | 'agent' | 'system';
export type Judged = 'agent_proposed' | 'researcher_confirmed' | 'researcher_rejected' | 'superseded';
export type WorkType = 'article' | 'preprint' | 'conference' | 'book' | 'chapter' | 'thesis' | 'report' | 'dataset' | 'software' | 'webpage' | 'other';
export type Resolution = 'pending' | 'resolving' | 'resolved' | 'not_found' | 'unreachable' | 'manual';
export type ReadState = 'unread' | 'reading' | 'read';
export type Integrity = 'unchecked' | 'clear' | 'retracted' | 'corrected' | 'concern';
export type TextState = 'waiting' | 'extracting' | 'ready' | 'needs_ocr' | 'failed';

export interface Person {
  family?: string;
  given?: string;
  literal?: string;
  orcid?: string;
}

export interface FileBrief {
  id: string;
  pages: number;
  text_state: TextState;
  has_thumb: boolean;
  pos_page: number;
  max_page: number;
}

export interface WorkRow {
  id: string;
  title: string;
  authors_short: string;
  authors_n: number;
  year: number;
  container: string;
  type: WorkType;
  citekey: string;
  doi: string;
  arxiv_id: string;
  pmid: string;
  resolution: Resolution;
  identity: 'agent_proposed' | 'researcher_confirmed';
  identify: 'none' | 'waiting' | 'working' | 'failed';
  integrity: Integrity;
  read_state: ReadState;
  starred: boolean;
  cited_by: number;
  added_by: Actor;
  source: string;
  trashed: boolean;
  citable: boolean;
  label: string;
  created: string;
  updated: string;
  file?: FileBrief | null;
  counts?: { annotations: number; notes: number; nodes: number; proposed?: number; refs?: number };
  tags?: { id: string; name: string; color_slot: number }[];
}

export interface FileInfo {
  id: string;
  work: string;
  name: string;
  bytes: number;
  pages: number;
  version: number;
  current: boolean;
  text_state: TextState;
  text_error: string;
  pages_with_text: number;
  ocr_pages: number;
  has_thumb: boolean;
  source: string;
  added_by: Actor;
  pos_page: number;
  pos_frac: number;
  max_page: number;
  engine: string;
  file_path: string;
  created: string;
  outline?: { title: string; page: number; depth: number }[];
  meta?: Record<string, string>;
}

export interface WorkDetail extends WorkRow {
  subtitle: string;
  authors: Person[];
  editors: Person[];
  issued: string;
  container_short: string;
  volume: string;
  issue: string;
  pages: string;
  article_number: string;
  publisher: string;
  place: string;
  edition: string;
  isbn: string;
  issn: string;
  abstract: string;
  url: string;
  language: string;
  keywords: string[];
  identifiers: { doi: string; arxiv_id: string; pmid: string; pmcid: string; isbn: string; openalex_id: string };
  resolved_via: string;
  resolve_error: string;
  identify_note: string;
  integrity_detail: { state: string; notices: { type: string; doi: string; date: string; source: string }[] } | null;
  integrity_at: string;
  oa_url: string;
  oa_pdf_url: string;
  oa_fetch: '' | 'due' | 'done' | 'failed';
  oa_status: string;
  refs_count: number;
  rating: number;
  edited: string[];
  extra: Record<string, unknown>;
  tags: { id: string; name: string; color_slot: number }[];
  collections: { id: string; name: string }[];
  projects: { id: string; name: string; color: string; confidentiality: string; status: string; role: string }[];
  files: FileInfo[];
  file: FileInfo | null;
  counts: { annotations: number; notes: number; nodes: number; refs?: number; proposed?: number };
  marks: { field: string; confidence: 'high' | 'check'; reason: string; actor: Actor }[];
  read_at: string;
  opened_at: string;
  trashed_at: string;
}

export interface Counts {
  total: number;
  unread: number;
  reading: number;
  read: number;
  to_identify: number;
  integrity: number;
  starred: number;
  recent: number;
  opened: number;
  trash: number;
  years: { year: number; n: number }[];
  types: { type: string; n: number }[];
}

export interface CollectionRow {
  id: string;
  name: string;
  parent: string;
  sort: number;
  n: number;
}

export interface TagRow {
  id: string;
  name: string;
  color_slot: number;
  n: number;
}

export interface Slot {
  slot: number;
  hue: 'yellow' | 'red' | 'green' | 'blue' | 'violet' | 'orange' | 'teal' | 'gray';
  meaning: string;
}

export interface Settings {
  highlight_slots: Slot[];
  citation_style: string;
  contact_email: string;
  agent_policy: { node_cap: number; auto_identify: boolean; auto_ocr: boolean; auto_oa: boolean };
  welcome_done: boolean;
}

export type Rect = [number, number, number, number, number];

export interface Anchor {
  id: string;
  file: string;
  work: string;
  work_label: string;
  work_title: string;
  page: number;
  start: number;
  end: number;
  quote: string;
  rects: Rect[];
  kind: 'text' | 'area';
  area: [number, number, number, number] | null;
  actor: Actor;
}

export interface Annotation {
  id: string;
  kind: 'highlight' | 'underline' | 'note' | 'area';
  color_slot: number;
  meaning: string;
  comment: string;
  actor: Actor;
  work: string;
  file: string;
  page: number;
  anchor: Anchor | null;
  created: string;
  updated: string;
}

/** A text item: [str, left, top, height, width, angle, eol]. */
export type Item = [string, number, number, number, number, number, number];

export interface PageData {
  page: number;
  width: number;
  height: number;
  rotate: number;
  origin: 'pdf_text' | 'agent_ocr' | 'none';
  items: Item[];
}

export type NodeKind = 'question' | 'claim' | 'evidence';
export type RelKind = 'supports' | 'opposes' | 'informs';

export interface GNode {
  id: string;
  project: string;
  kind: NodeKind;
  title: string;
  body: string;
  status: Judged;
  claim_basis: string;
  confidence: string;
  actor: Actor;
  why: string;
  work: string;
  work_label: string;
  x: number;
  y: number;
  placed: boolean;
  decided_at: string;
  created: string;
  updated: string;
  anchors?: Anchor[];
  passage?: { quote: string; page: number; anchor: string; count: number } | null;
  balance?: { supports: number; opposes: number; informs: number; proposed: number };
  project_name?: string;
}

export interface Relation {
  id: string;
  project: string;
  from: string;
  to: string;
  kind: RelKind;
  status: Judged;
  reason: string;
  actor: Actor;
  created: string;
  from_title?: string;
  to_title?: string;
  from_kind?: NodeKind;
  to_kind?: NodeKind;
  direction?: 'in' | 'out';
  node?: GNode | null;
}

export interface JourneyStep {
  key: 'collect' | 'read' | 'map' | 'synthesize' | 'write';
  label: string;
  done: boolean;
  count: number;
}

export interface ProjectStats {
  papers: number;
  read: number;
  reading: number;
  highlights: number;
  questions: number;
  claims: number;
  evidence: number;
  proposed: number;
  supports: number;
  opposes: number;
  notes: number;
  boards: number;
  manuscripts: number;
  reviews: number;
  tasks_open: number;
  tasks_overdue: number;
  tasks_done: number;
  experiments: number;
  experiments_running: number;
  repo_files: number;
}

/** How the app shows a repository file. */
export type RepoShown = 'text' | 'markdown' | 'table' | 'image' | 'svg' | 'pdf' | 'audio' | 'video' | 'none' | '';

/** A folder or file of a project's research repository. */
export interface RepoItem {
  id: string;
  parent: string;
  kind: 'folder' | 'file';
  name: string;
  /** From the top of the repository, e.g. "data/raw/counts.csv". */
  path: string;
  bytes: number;
  /** The current version (files; 0 for folders). */
  version: number;
  shown_as: RepoShown;
  actor: 'person' | 'agent' | 'system';
  created: string;
  updated: string;
}

export interface RepoList {
  /** False until the project's starter repository is made (repo.init). */
  ready: boolean;
  items: RepoItem[];
  files: number;
  folders: number;
  bytes: number;
}

export interface RepoVersion {
  number: number;
  bytes: number;
  actor: 'person' | 'agent' | 'system';
  made_at: string;
  current: boolean;
}

export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  project: string;
  project_name: string;
  project_color: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string;
  overdue: boolean;
  assignee: 'person' | 'agent';
  labels: string[];
  checklist: { id: string; text: string; done: boolean }[];
  links: { kind: 'work' | 'node' | 'manuscript' | 'board' | 'note' | 'experiment'; id: string; title: string }[];
  recur: 'none' | 'daily' | 'weekly' | 'monthly';
  sort: number;
  done_at: string;
  actor: Actor;
  created: string;
  updated: string;
}

export interface TaskSummary {
  counts: { open: number; overdue: number; today: number; week: number; doing: number; waiting: number; agent: number; no_date: number; urgent: number; done_week: number };
  by_project: { project: string; name: string; color: string; open: number; overdue: number; today: number }[];
  next: Task[];
  today: string;
}

export interface Project {
  id: string;
  name: string;
  question: string;
  description: string;
  color: string;
  confidentiality: 'normal' | 'confidential';
  state: 'active' | 'archived';
  pinned: boolean;
  opened_at: string;
  created: string;
  updated: string;
  stats?: ProjectStats;
  /** The task to do next (the order of every task list), or null when nothing is open. */
  next_task?: { id: string; title: string; due: string; overdue: boolean } | null;
  journey?: { steps: JourneyStep[]; next: JourneyStep['key']; stage: string };
}

export interface ActivityEntry {
  id: string;
  actor: Actor;
  op: string;
  label: string;
  target: string;
  record: string;
  batch: string;
  project: string;
  undoable: boolean;
  undone: boolean;
  detail: Record<string, unknown> | null;
  created: string;
}

export interface NoteBlock {
  id: string;
  type: 'paragraph' | 'heading' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'node' | 'cite' | 'divider' | 'image' | 'table';
  text?: string;
  level?: number;
  checked?: boolean;
  anchor?: string;
  node?: string;
  work?: string;
  locator?: string;
  /** image: the note picture's id, its caption, width (percent of the column) and place. */
  file?: string;
  caption?: string;
  width?: number;
  /** image: left, center or right; table: each column's. */
  align?: 'left' | 'center' | 'right' | ('left' | 'center' | 'right')[];
  /** table: rows of cell texts; the first row is the header when `header`. */
  rows?: string[][];
  header?: boolean;
  /** A picture still uploading: its local preview (never saved). */
  pending?: string;
  ref?: Anchor | GNode | WorkRow | NoteImage | null;
}

/** A picture of a note (note_files). */
export interface NoteImage {
  id: string;
  name: string;
  bytes: number;
}

export interface Note {
  id: string;
  title: string;
  kind: 'literature' | 'project' | 'free';
  work: string;
  work_label: string;
  work_title: string;
  project: string;
  project_name: string;
  pinned: boolean;
  actor: Actor;
  status: 'agent_proposed' | 'researcher_confirmed';
  snippet: string;
  created: string;
  updated: string;
  blocks?: NoteBlock[];
}

export interface Proposal {
  id: string;
  op: string;
  kind: string;
  title: string;
  summary: string;
  preview: Record<string, unknown> | null;
  why: string;
  target_collection: string;
  target_id: string;
  project: string;
  status: string;
  decision_note: string;
  decided_at: string;
  result: unknown;
  created: string;
}

export interface Ask {
  id: string;
  scope: 'work' | 'collection' | 'project' | 'library';
  work: string;
  collection: string;
  project: string;
  question: string;
  status: 'waiting' | 'working' | 'answered' | 'failed';
  answer: { type: string; text?: string; anchor?: string; node?: string; work?: string; ref?: Anchor | null }[];
  answer_text: string;
  failure: string;
  request: string;
  created: string;
  updated: string;
}

export interface NeedsYou {
  counts: {
    nodes: number;
    relations: number;
    proposals: number;
    identities: number;
    unidentified: number;
    retracted: number;
    failed_text: number;
    needs_ocr: number;
    notes: number;
    answers: number;
    candidates: number;
    decisions: number;
    ms_changes: number;
    responses: number;
  };
  total: number;
  nodes?: GNode[];
  relations?: Relation[];
  proposals?: Proposal[];
  identities?: WorkRow[];
  unidentified?: WorkRow[];
  retracted?: WorkRow[];
}

export interface AppStatus {
  needs_you: number;
  needs: NeedsYou['counts'];
  text_waiting: number;
  resolving: number;
  projects: number;
  works: number;
  new_candidates: number;
  today: string;
}

export interface Candidate {
  id: string;
  search: string;
  search_name: string;
  source: string;
  doi: string;
  arxiv_id: string;
  openalex_id: string;
  pmid: string;
  identifier: string;
  title: string;
  authors_short: string;
  year: number;
  venue: string;
  abstract: string;
  cited_by: number;
  oa_url: string;
  type: string;
  relevance: '' | 'high' | 'medium' | 'low';
  reason: string;
  triage: 'new' | 'relevant' | 'not_relevant' | 'added' | 'dismissed';
  work: string;
  rank: number;
  actor: Actor;
  created: string;
}

export interface SearchRun {
  id: string;
  search: string;
  queries: { source: string; query: string; count: number; total: number; error: string }[];
  evaluated: number;
  found: number;
  new: number;
  stop_reason: string;
  actor: Actor;
  error: string;
  created: string;
  finished_at: string;
}

export interface Search {
  id: string;
  name: string;
  query: string;
  sources: string[];
  filters: { from_year?: number; to_year?: number; type?: string; oa?: boolean; rows?: number };
  alert: 'off' | 'daily' | 'weekly';
  project: string;
  saved: boolean;
  last_run_at: string;
  new_count: number;
  candidates: number;
  last_run: SearchRun | null;
  actor: Actor;
  created: string;
}

export interface AgentRequest {
  id: string;
  trigger: string;
  params: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'done' | 'rejected';
  fired_by: string;
  claimed_by: string;
  result: string;
  error: string;
  created: string;
  updated: string;
}

/* ----------------------------------------------------------- experiments */

export type ExpKind = 'lab' | 'chemistry' | 'computational' | 'study' | 'field' | 'other';
export type ExpStatus = 'planned' | 'running' | 'paused' | 'done' | 'cancelled';
export type ExpOutcome = 'supports' | 'refutes' | 'inconclusive' | 'failed';
export type VarRole = 'condition' | 'constant' | 'measure';
export type VarType = 'number' | 'text' | 'category' | 'yesno';

export interface ExpVariable {
  id: string;
  name: string;
  role: VarRole;
  type: VarType;
  unit: string;
  /** Conditions: the values planned. */
  levels?: string[];
  /** Constants: the value held. */
  value?: string;
  /** Categories: the allowed values. */
  options?: string[];
}

export interface ExpStep {
  id: string;
  text: string;
  /** A timed step: a countdown in bench mode. */
  minutes: number;
  done: boolean;
  done_at: string;
}

export interface ExpMaterial {
  id: string;
  name: string;
  detail: string;
}

export interface Experiment {
  id: string;
  project: string;
  number: number;
  code: string;
  title: string;
  kind: ExpKind;
  status: ExpStatus;
  aim: string;
  hypothesis: string;
  variables: ExpVariable[];
  steps: ExpStep[];
  /** The first step not done yet. */
  next_step: { id: string; index: number; text: string; minutes: number } | null;
  materials: ExpMaterial[];
  links: { kind: 'work' | 'node'; id: string; title: string; node_kind: string }[];
  tags: string[];
  planned_start: string;
  planned_end: string;
  started_at: string;
  ended_at: string;
  pinned: boolean;
  outcome: ExpOutcome | '';
  summary: string;
  next_steps: string;
  conclusion_by: '' | 'person' | 'agent';
  /** The experiment this one repeats, and its own repeats. */
  parent: ExpBrief | null;
  repeats: ExpBrief[];
  actor: string;
  counts: { runs: number; done: number; planned: number; failed: number; excluded: number; log: number; steps: number; steps_done: number };
  last_log: string;
  created: string;
  updated: string;
}

export type RunStatus = 'planned' | 'done' | 'failed' | 'excluded';
export type RunValue = number | string | boolean;

export interface ExpRun {
  id: string;
  number: number;
  code: string;
  /** Keyed by variable id. */
  values: Record<string, RunValue>;
  status: RunStatus;
  note: string;
  recorded_at: string;
  actor: string;
  created: string;
}

export type LogKind = 'note' | 'observation' | 'result' | 'deviation' | 'issue' | 'system';
export type CorrectionReason = 'typo' | 'recording' | 'calculation' | 'late' | 'review' | 'other';

export interface ExpEntry {
  id: string;
  kind: LogKind;
  text: string;
  files: { name: string; shown: string; image: boolean }[];
  /** What the entry is about. */
  ref: { kind: 'step' | 'run'; id: string; label: string; text: string } | null;
  /** Corrections (the text before each) and the strike-through, oldest first. */
  edits: { action: 'corrected' | 'struck'; text?: string; kind?: LogKind; reason: string; at: string; actor: string }[];
  struck: string;
  struck_at: string;
  at: string;
  /** Written up more than 10 minutes after it happened. */
  late: boolean;
  written_at: string;
  actor: 'person' | 'agent' | 'system';
}

export interface ExpBrief {
  id: string;
  code: string;
  title: string;
  status: ExpStatus;
}

export interface ExpTemplate {
  id: string;
  name: string;
  kind: ExpKind;
  aim: string;
  hypothesis: string;
  variables: ExpVariable[];
  steps: { id: string; text: string; minutes: number }[];
  materials: ExpMaterial[];
  tags: string[];
  counts: { variables: number; steps: number };
  updated: string;
}

export interface ExpGroup {
  key: string;
  conditions: { variable: string; name: string; value: string }[];
  n: number;
  mean?: number | null;
  sd?: number | null;
  min?: number | null;
  max?: number | null;
  values?: number[];
  counts?: Record<string, number>;
}

export interface ExpResults {
  experiment: string;
  conditions: { id: string; name: string; unit: string; type: VarType }[];
  grouped_by: string[];
  measures: { variable: string; name: string; unit: string; type: VarType; groups: ExpGroup[] }[];
  runs: { runs: number; done: number; failed: number; excluded: number };
}

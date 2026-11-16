/**
 * Diligence shapes as the operations answer them (pb_hooks/lib_diligence*.js).
 */
import type { AgentTrack } from '../../lib/types.ts';
import type { Grade } from '../ui.tsx';

export type QType = 'text' | 'number' | 'yes_no' | 'date';
export type QState = 'open' | 'proposed' | 'confirmed';
export type AStatus = 'agent_proposed' | 'confirmed' | 'rejected' | 'superseded';

export interface Cite {
  anchor: string;
  file: string;
  file_name: string;
  page: number;
  quote: string | null;
  nda: boolean;
  hidden: boolean;
}

export interface Raw {
  text: string;
  minor: number;
  ppm: number;
  e6: number;
  bool: boolean;
  day: string;
}

export interface Answer {
  id: string;
  question: string;
  status: AStatus;
  type: QType;
  value: string;
  raw: Raw;
  unit: string;
  num_kind: string;
  formula: string;
  grade: Grade;
  high: boolean;
  cites: Cite[];
  sources: string[];
  note: string;
  actor: string;
  at: string;
}

export interface Question {
  id: string;
  key: string;
  area: string;
  area_label: string;
  text: string;
  type: QType;
  unit: string;
  state: QState;
  source: string;
  answer: Answer | null;
  proposal: Answer | null;
  checked_at: string;
  check_note: string;
}

export interface Area {
  key: string;
  label: string;
  total: number;
  answered: number;
  confirmed: number;
  proposed: number;
}

export interface Room {
  files: number;
  pages: number;
  pages_read: number;
  pages_ocr: number;
  nda: number;
  reading: number;
}

/** Your AI agent's ask on a deal or a grid as a StepTrack (lib_agent.track). */
export type JobStep = AgentTrack;

export interface DealMini {
  id: string;
  number: string;
  title: string;
  company: string;
  stage: string;
  status: string;
  restricted?: boolean | undefined;
  agent_allowed?: boolean | undefined;
}

export interface DdView {
  deal: DealMini;
  areas: Area[];
  questions: Question[];
  counts: { total: number; open: number; proposed: number; confirmed: number; high: number };
  proposed_ids: string[];
  high_ids: string[];
  room: Room;
  ask: JobStep | null;
  templates: { key: string; name: string; count: number }[];
  suggested_template: string;
  hidden_quotes: number;
}

export interface Mini {
  id: string;
  name: string;
  email?: string | undefined;
  domain?: string | undefined;
}

export type RefKind = 'provided' | 'backchannel' | 'customer' | 'expert';
export type Signal = 'positive' | 'neutral' | 'negative';

export interface Reference {
  id: string;
  person: Mini | null;
  name: string;
  title: string;
  company: Mini | null;
  founder: Mini | null;
  kind: RefKind;
  signal: Signal | '';
  note: string;
  status: 'suggested' | 'logged' | 'dismissed';
  why: { text?: string | undefined; company?: string | undefined } | null;
  day: string;
  called_by: Mini | null;
  actor: string;
}

export interface RefsView {
  references: Reference[];
  counts: { by_kind: Record<RefKind, number>; by_signal: Record<Signal, number>; logged: number; suggested: number };
  ask: JobStep | null;
}

export interface GridColumn {
  key: string;
  text: string;
  type: QType;
  unit: string;
  area?: string | undefined;
  area_label?: string | undefined;
}

export interface GridCell {
  id?: string | undefined;
  question?: string | undefined;
  empty?: boolean | undefined;
  status?: AStatus | undefined;
  type?: QType | undefined;
  value?: string | undefined;
  raw?: Raw | undefined;
  unit?: string | undefined;
  grade?: Grade | undefined;
  high?: boolean | undefined;
  num_kind?: string | undefined;
  formula?: string | undefined;
  cites?: Cite[] | undefined;
  sources?: string[] | undefined;
  note?: string | undefined;
}

export interface GridRow {
  company: Mini;
  deal: DealMini | null;
  cells: (GridCell | null)[];
}

export interface Grid {
  id: string;
  name: string;
  origin: string;
  market_ref: string;
  columns: GridColumn[];
  rows: GridRow[];
  hidden: number;
  missing: number;
  asks: JobStep[];
  working: boolean;
  step: JobStep | null;
  updated: string;
}

export interface Template {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  areas: { key: string; label: string }[];
  questions?: { key: string; area: string; text: string; type: QType; unit: string }[] | undefined;
  count: number;
}

/** What the reader opens: a cited passage, and the answer it supports (to confirm in place). */
export interface ReadTarget {
  cite: Cite;
  question?: string | undefined;
  answer?: { id: string; value: string; status: AStatus; grade: Grade } | undefined;
}

/** Every collection a diligence view reloads on. */
export const DD_READS = ['dd_questions', 'dd_answers', 'dd_templates', 'files', 'file_texts', 'pages', 'agent_requests', 'deals'];
export const REF_READS = ['references', 'agent_requests', 'deal_people', 'employments'];
export const GRID_READS = ['compare_grids', 'dd_answers', 'dd_questions', 'agent_requests', 'deals'];

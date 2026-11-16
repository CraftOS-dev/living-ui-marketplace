/**
 * Shapes the deals module reads: kernel-records' deal views (lib_deals
 * cardOut and dealOut), the board, pipelines, and this module's funnel,
 * notes and templates (lib_deals_flow, lib_deals_notes).
 */
import type { AgentAsks } from '../../lib/types.ts';
import { humanize } from '../../lib/format.ts';

export interface Mini {
  id: string;
  name: string;
}

export interface Stage {
  key: string;
  label: string;
  stall_days: number;
}

export interface Pipeline {
  id: string;
  key: string;
  name: string;
  kind: 'deal_flow' | 'spv' | 'lp_raise' | 'program';
  stages: Stage[];
  archived: boolean;
  open?: number | undefined;
}

/** A deal as boards and lists carry it (lib_deals.cardOut). */
export interface DealCard {
  id: string;
  number: string;
  title: string;
  company: { id: string; name: string; domain: string; logo_url?: string | undefined; logo_domain?: string | undefined } | null;
  pipeline: string;
  stage: string;
  stage_label: string;
  stage_index: number;
  days_in_stage: number;
  stalled: boolean;
  stalls_on: string | null;
  status: 'open' | 'invested' | 'passed' | 'lost' | 'hold';
  point: Mini | null;
  round_type: string;
  raise_minor: number | null;
  currency: string;
  check_minor: number | null;
  restricted: boolean;
  last_activity_at: string;
  stall_days?: number | undefined;
}

/** A deal in full (deals.get). */
export interface Deal extends Omit<DealCard, 'pipeline'> {
  name: string;
  stage_entered_at: string;
  status_reason: string;
  status_at: string;
  source: string;
  source_person: { id: string; name: string; email: string } | null;
  round: { type: string; raise_minor: number | null; pre_money_minor: number | null; post_money_minor: number | null };
  ownership_ppm: number | null;
  instrument: string;
  fund: Mini | null;
  agent_allowed: boolean;
  tags: string[];
  intake_item: string;
  pipeline: Pipeline;
  team: (Mini & { role: string; link: string })[];
  people: (Mini & { email: string; role: string; link: string })[];
  files: number;
  created: string;
  updated: string;
}

export interface BoardAnswer {
  pipeline: Pipeline;
  stages: (Stage & { count: number; deals: DealCard[] })[];
  total: number;
  hidden: number;
}

/** One bar of the cohort funnel: Inbound (key inbound, now null) or a stage. */
export interface FunnelStage {
  key: string;
  label: string;
  /** Inbound: the cohort; a stage: how many of the cohort ever reached it. */
  count: number;
  /** This bar over the bar before it; null for the first bar or when that bar is 0. */
  conversion_ppm: number | null;
  /** Deals in the stage now; null for Inbound. */
  now: number | null;
  median_days: number | null;
  stall_days: number | null;
}

export interface FunnelAnswer {
  pipeline: { key: string; name: string; kind: string };
  quarter: { key: string; start_day: string; end_day: string };
  stages: FunnelStage[];
  cohort: number;
  open: number;
  hidden: number;
}

export interface Template {
  id: string;
  key: string;
  name: string;
  sections: { key: string; label: string }[];
  stages: string[];
  sort: number;
  archived: boolean;
  builtin: boolean;
}

export type Consent = 'informed' | 'not_recorded' | 'unknown';

export interface ProposalView {
  id: string;
  kind: string;
  title: string;
  why: string;
  evidence: { quote?: string | undefined; file?: string | undefined; page?: number | undefined; url?: string | undefined } | null;
  confidence: number | null;
  status: 'pending' | 'accepted' | 'partial' | 'dismissed' | 'failed' | 'expired' | 'withdrawn';
  items: { index: number; op: string; label: string; fields: { name: string; before: string; after: string }[]; state: string; error: string }[];
}

export interface TaskView {
  id: string;
  title: string;
  assignee: string;
  assignee_name: string;
  due_day: string;
  status: 'open' | 'done' | 'cancelled';
  actor: string;
  deal: string;
}

export type ReviewState = 'draft' | 'saved' | 'reading' | 'waiting' | 'working' | 'summary' | 'ready' | 'failed' | 'off';

export interface Note {
  id: string;
  deal: { id: string; number: string; title: string; stage: string } | null;
  company: { id: string; name: string } | null;
  template: { key: string; name: string; sections: { key: string; label: string }[] };
  title: string;
  body: Record<string, string>;
  empty: boolean;
  meeting_day: string;
  cal_event: string;
  consent: Consent;
  status: 'draft' | 'saved';
  saved_at: string;
  author: Mini | null;
  mine: boolean;
  can_edit: boolean;
  actor: string;
  transcript: { file: string; name: string; ext: string; bytes: number; text_state: string; pages: number } | null;
  summary: { headline?: string | undefined; sections?: Record<string, string> | undefined } | null;
  summary_at: string;
  summary_by: string;
  review: { state: ReviewState; steps: { labels: string[]; at: number } | null; request: string; error?: string | undefined; agent?: AgentAsks | undefined; proposals: (ProposalView | string)[]; tasks: (TaskView | string)[]; refs: string[]; pending: number };
  created: string;
  updated: string;
}

export interface FileRow {
  id: string;
  name: string;
  folder: string;
  owner_collection: string;
  owner_id: string;
  bytes: number;
  ext: string;
  version: number;
  nda: boolean;
  text_state: string;
  actor: string;
  created: string;
}

/** Collections a deal screen reads (live reloads). */
export const DEAL_READS = ['deals', 'deal_people', 'stage_events', 'pipelines', 'companies', 'people'];
export const NOTE_READS = ['notes', 'agent_requests', 'proposals', 'tasks', 'files', 'file_texts'];

const ROUND: Record<string, string> = {
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  seed_extension: 'Seed ext',
  series_a: 'Series A',
  series_b: 'Series B',
  series_c: 'Series C',
  series_d_plus: 'Series D+',
  bridge: 'Bridge',
  other: 'Other',
};

export function roundLabel(type: string): string {
  return type === '' ? '' : ROUND[type] ?? humanize(type);
}

export const ROUND_TYPES = Object.keys(ROUND);

const FIELD_LABEL: Record<string, string> = {
  round_type: 'Round',
  raise: 'Raise',
  pre_money: 'Pre-money',
  post_money: 'Post-money',
  check: 'Check',
  currency: 'Currency',
  instrument: 'Instrument',
  source: 'Source',
  source_person: 'Source person',
  fund: 'Fund',
  name: 'Name',
  tags: 'Tags',
};

export function fieldLabel(name: string): string {
  return FIELD_LABEL[name] ?? humanize(name);
}

export const PASS_REASONS = ['Team', 'Market', 'Product', 'Traction', 'Valuation', 'Fit with thesis', 'Timing', 'Other'];

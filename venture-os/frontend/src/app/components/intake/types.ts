/** Intake shapes as the intake operations answer them (lib_intake.js). */
import type { AgentAsks } from '../../lib/types.ts';
import type { Grade, Check3 } from '../ui.tsx';

export type Segment = 'new' | 'waiting' | 'held';
export type ItemStatus = 'new' | 'held' | 'passed' | 'advanced' | 'merged';
export type MailState = 'none' | 'waiting' | 'draft' | 'approved' | 'sent' | 'failed' | 'cancelled';

export interface Due {
  day: string;
  state: 'open' | 'due_today' | 'overdue' | 'none';
  left: number | null;
}

export interface FigureOut {
  key: string;
  label: string;
  fact: string;
  minor?: number | null | undefined;
  ppm?: number | null | undefined;
  currency?: string | undefined;
  grade: Grade;
  text: string;
}

export interface FitCheck {
  key: string;
  label: string;
  op: string;
  required: boolean;
  status: Check3;
  reason: string | null;
  value: unknown;
}

export interface FitOut {
  thesis: { id: string; name: string };
  state: Check3;
  counts: { met: number; unmet: number; unknown: number };
  checks?: FitCheck[] | undefined;
}

export interface PassMini {
  id: string;
  reason: string;
  reason_label: string;
  email_state: MailState;
  revisit_day: string;
}

export interface Row {
  id: string;
  number: string;
  name: string;
  one_liner: string;
  channel: 'email' | 'upload' | 'scout' | 'csv' | 'sourced';
  status: ItemStatus;
  step: string;
  steps: { labels: string[]; at: number };
  triage_state: 'none' | 'waiting' | 'working' | 'done' | 'failed';
  waiting_agent: boolean;
  /** How your AI agent reads it: deck_triage, deck_fetch (a deck link alone), or '' (nothing to read). */
  read_trigger?: 'deck_triage' | 'deck_fetch' | '' | undefined;
  /** The item's asks of your AI agent (deck_triage, deck_fetch), followed live. */
  agent?: AgentAsks | undefined;
  source: { kind: string; label: string; id: string };
  company: { id: string; name: string; domain: string; logo_url?: string | undefined; logo_domain?: string | undefined } | null;
  fit: FitOut[];
  figures: FigureOut[];
  due: Due;
  received_at: string;
  files: number;
  hold_until: string;
  revisit_day: string;
  deal: { id: string; number: string } | null;
  pass: PassMini | null;
}

export interface Fact {
  id: string;
  key: string;
  label: string;
  type: string;
  value: unknown;
  currency: string;
  grade: Grade;
  num_kind: string;
  status: 'agent_proposed' | 'confirmed';
  source: 'deck' | 'email' | 'public' | 'person';
  file: string;
  file_name: string;
  page: number | null;
  quote: string;
  /** The quote is from a deck marked NDA you may not read: quote is '' (hidden_reason says why). */
  hidden?: boolean | undefined;
  hidden_reason?: string | undefined;
  anchor: string;
  url: string;
  note: string;
  actor: string;
  text: string;
}

export interface FileOut {
  id: string;
  name: string;
  ext: string;
  mime: string;
  pages: number;
  text_state: string;
  deal: string;
}

export interface Prior {
  kind: 'item' | 'deal';
  id: string;
  label: string;
  status: string;
  stage?: string | undefined;
  day: string;
  reason: string;
  same: 'company' | 'founder';
  href: string;
}

export interface Outbound {
  id: string;
  status: 'draft' | 'approved' | 'sending' | 'sent' | 'failed' | 'cancelled';
  to: string[];
  subject: string;
  body: string;
  error: string;
  actor: string;
  ai_chars: number;
  typed_chars: number;
}

export interface PassOut {
  id: string;
  reason: string;
  reason_label: string;
  criterion: string;
  revisit_milestone: string;
  revisit_day: string;
  revisit_state: string;
  email_state: MailState;
  to: string[];
  outbound: Outbound | null;
  /** The pass email's ask of your AI agent (pass_draft). */
  agent?: AgentAsks | undefined;
  decided_at: string;
  member: { id: string; name: string } | null;
}

export interface Card extends Row {
  text: string;
  url: string;
  link_kind: string;
  licence: 'public' | 'internal_only';
  website: string;
  email_from: string;
  email_subject: string;
  files_list: FileOut[];
  facts: Fact[];
  fit: FitOut[];
  missing: { key: string; label: string }[];
  questions: string[];
  history: { prior: Prior[]; hidden: number };
  people: { id: string; name: string; email: string; role: string }[];
  thesis: { id: string; name: string } | null;
  pass: (PassMini & PassOut) | null;
  triage_note: string;
  merged_into: { id: string; number: string } | null;
  decided_by: { id: string; name: string } | null;
  decided_at: string;
  may_decide: boolean;
  agent_facts: boolean;
  /** The domain whose public favicon is the logo ('' in a demo firm). */
  logo_domain?: string | undefined;
}

export interface Stats {
  ready: number;
  overdue: number;
  due_today: number;
  reply_days: number | null;
  decided_90: number;
}

export interface ListOut {
  segment: string;
  items: Row[];
  counts: { new: number; waiting: number; held: number; passed: number; advanced: number };
  stats: Stats | null;
  next_offset: number | null;
  sla_days: number;
}

export interface Scout {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'paused';
  note: string;
  account: { id: string; name: string } | null;
  items: number;
  advanced: number;
  last_at: string;
}

export interface IntakeSettingsOut {
  reply_sla_days: number;
  deals_label: string;
  sweep: boolean;
  pass_reasons: { value: string; label: string; on: boolean }[];
  pass_template: string;
  bridge: boolean;
  last_sweep: { at: string; ok: boolean; skipped?: string | undefined; error?: string | undefined; added: number; found: number } | null;
}

/** The collections an Inbox view reads (reload on any change). */
export const INTAKE_READS = ['intake_items', 'facts', 'passes', 'agent_requests', 'outbound', 'files', 'file_texts', 'companies'];

export const REASONS: { value: string; label: string }[] = [
  { value: 'team', label: 'Team' },
  { value: 'market', label: 'Market' },
  { value: 'product', label: 'Product' },
  { value: 'traction', label: 'Traction' },
  { value: 'valuation', label: 'Valuation' },
  { value: 'thesis_fit', label: 'Fit with thesis' },
  { value: 'timing', label: 'Timing' },
  { value: 'other', label: 'Other' },
];

export const HOLDS: { value: string; label: string }[] = [
  { value: '7', label: '1 week' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
];

/** Deck files a drop or the dialog takes. */
export const DECK_ACCEPT = '.pdf,.pptx,.ppt,.key,.docx,.png,.jpg,.jpeg,.webp';
export function isDeck(f: File): boolean {
  return /\.(pdf|pptx?|key|docx?|png|jpe?g|webp|gif)$/i.test(f.name);
}

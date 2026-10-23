/**
 * Shapes shared across screens. Each area keeps the shapes only it reads in
 * lib/types/<area>.ts. Money is whole minor units of `currency` unless the
 * field name says `_text` (plain text in major units) or `_e4`.
 */

export type Level = 'none' | 'view' | 'edit' | 'full';

export const MODULES = ['sales', 'purchasing', 'inventory', 'manufacturing', 'accounting', 'banking', 'reports', 'people', 'payroll', 'projects'] as const;
export type Module = (typeof MODULES)[number];

/** Modules a company can switch off (Accounting, Banking and Reports always run). */
export type SwitchableModule = Exclude<Module, 'reports'>;

export interface Me {
  actor: 'person';
  admin: boolean;
  owner: boolean;
  approval_limit: number;
  company: {
    name: string;
    currency: string;
    country: string;
    setup_done: boolean;
    fiscal_start_month: number;
    prices_include_tax: boolean;
    logo: boolean;
  };
  employee: { id: string; name: string; number: string; job_title: string; department: string } | null;
  levels: Record<Module, Level>;
  modules: Record<Module, boolean>;
  manages: number;
  member: { id: string; name: string; email: string; title: string; prefs: Record<string, unknown> };
  role: { id: string; key: string; name: string };
  today: string;
}

export interface Ref {
  id: string;
  name: string;
}

export interface CodeRef {
  id: string;
  code: string;
  name: string;
}

export type Actor = 'person' | 'agent' | 'system';

/** One line of a journal as previewed before posting (or shown after). */
export interface JournalPreviewLine {
  account: CodeRef;
  debit: number;
  credit: number;
  memo: string;
  party: string;
}

export interface Preview {
  preview?: true | undefined;
  currency: string;
  lines: JournalPreviewLine[];
  warning?: string | undefined;
  date?: string | undefined;
  title?: string | undefined;
  summary?: string | undefined;
  [key: string]: unknown;
}

export type ProposalKind = 'post' | 'payment' | 'stock' | 'journal' | 'void' | 'payroll' | 'claim' | 'other';
export type ProposalStatus = 'waiting' | 'approved' | 'rejected' | 'failed';

export interface Proposal {
  id: string;
  op: string;
  kind: ProposalKind | string;
  title: string;
  summary: string;
  reason: string;
  amount: number;
  status: ProposalStatus;
  can_decide: boolean;
  params: Record<string, unknown>;
  preview: { currency: string; lines: JournalPreviewLine[]; warning: string; extra: unknown };
  target: { entity: string; id: string; label: string };
  created: string;
  decided_at: string;
  decided_by: string;
  decision_note: string;
  error: string;
  result: unknown;
}

/** A row of the audit trail (audit.list, agent.activity). */
export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  who: string;
  member: string;
  entity: string;
  ref: string;
  kind: string;
  label: string;
  summary: string;
  data: unknown;
}

/** One entry of an entity's timeline (activity.list). */
export interface ActivityItem {
  id: string;
  kind: 'event' | 'note';
  event?: string | undefined;
  body: string;
  at: string;
  who: string;
  actor: Actor;
  member: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  at: string;
  actor: Actor;
  who: string;
  image: boolean;
}

export interface FieldMark {
  field: string;
  confidence: 'high' | 'check';
  reason: string;
  at: string;
}

export interface Activity {
  entity: string;
  ref: string;
  items: ActivityItem[];
  attachments: Attachment[];
  marks: FieldMark[];
}

export interface SearchResult {
  kind: 'document' | 'party' | 'item' | 'payment' | 'employee' | 'project' | 'account' | 'journal' | string;
  id: string;
  title: string;
  subtitle: string;
  type?: string | undefined;
  state?: string | undefined;
  amount?: number | undefined;
  currency?: string | undefined;
}

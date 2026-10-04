/**
 * Shapes of JSON fields and of the /api/ops responses the pages read.
 * Server text that varies by language arrives as Bi ({ en, ja }); render it
 * with bi() from i18n.ts.
 */

export type Lang = 'en' | 'ja';
export interface Bi {
  en: string;
  ja: string;
}

export type Profile = 'anime' | 'talent' | 'character';
export type ModuleKey = 'titles' | 'committees' | 'franchises' | 'talents' | 'permissions' | 'guidelines' | 'music' | 'products' | 'royalties' | 'approvals';
export const MODULE_KEYS: readonly ModuleKey[] = ['titles', 'committees', 'franchises', 'talents', 'permissions', 'guidelines', 'music', 'products', 'royalties', 'approvals'];

export type Role = 'admin' | 'manager' | 'rights' | 'licensing' | 'talent_manager' | 'contributor' | 'viewer' | 'licensee' | 'committee_member' | 'reviewer';
export const EXTERNAL_ROLES: readonly Role[] = ['licensee', 'committee_member', 'reviewer'];

/* ---------------- JSON fields ---------------- */

/** names: every way a record is written. */
export interface NameEntry {
  script: 'ja' | 'kana' | 'en' | 'romaji' | 'zh_hans' | 'zh_hant' | 'ko' | string;
  value: string;
}
/** titles.external_ids: EIDR, ISAN, Media Arts Database, streamer IDs, JAN... (lib_engine reads type and value). */
export interface ExternalId {
  type: string;
  value: string;
  note?: string;
}
/** characters.ai_policy (no = not allowed, labelled = allowed if labelled, yes = allowed). */
export interface AiPolicy {
  training?: 'no' | 'yes';
  fan_ai_art?: 'no' | 'labelled' | 'yes';
  voice_clone?: 'no' | 'yes';
}
/** talents.revenue_share and agreements.revenue_share rows. */
export interface RevenueShare {
  category: string;
  talent_pct: number;
  agency_pct?: number;
}
export interface CopyrightLine {
  territory: string;
  text: string;
}
export interface StageTemplate {
  key: string;
  label: string;
  label_ja?: string;
  sla_days?: number;
  reviewers?: ('internal' | 'committee' | 'original' | 'talent' | 'reviewer')[];
}
export interface TalentChannel {
  platform: string;
  handle?: string;
  url?: string;
}
export interface WaterfallStep {
  key?: string;
  label: string;
  label_ja?: string;
  kind?: 'fee' | 'deduction' | 'success_fee';
  pct?: number;
  amount?: number;
  base?: 'gross' | 'net';
  cap_pct?: number;
  threshold?: number;
}
/** Royalty rate by quantity: the server reads from_qty (lib_licensing.rateFor). */
export interface RateTier {
  from_qty: number;
  to_qty?: number;
  rate: number;
}
export interface ScheduledPayment {
  date: string;
  amount: number;
  label?: string;
}
/** Delivery schedule rows: the server reads date and item (lib_obligations). */
export interface ScheduledItem {
  date: string;
  item: string;
  label?: string;
}
export interface DimSpec {
  include?: string[];
  exclude?: string[];
}
export type DimSpecMap = Record<string, DimSpec>;
export interface ApprovalReviewer {
  key: string;
  label: string;
  label_ja?: string;
  kind: 'internal' | 'committee' | 'original' | 'talent' | 'reviewer';
  party?: string;
  user?: string;
  decision: 'pending' | 'approved' | 'changes' | 'rejected' | 'deemed_approved' | 'deemed_refused';
  comment?: string;
  previous_comment?: string;
  decided_at?: string;
  decided_by?: string;
}
export interface ConsentAnswer {
  member: string;
  party: string;
  name: string;
  answer: 'pending' | 'approve' | 'refuse' | 'no_answer';
  reason: string;
  date: string;
  recorded_by?: string;
}
export interface DistributionReceipt {
  window: string;
  holder: string;
  gross: number;
  deductions: { label: string; amount: number }[];
  fee_pct: number;
  fee_base: 'gross' | 'net';
  window_fee: number;
  net: number;
}
export interface DistributionMember {
  member: string;
  party: string;
  name: string;
  share_pct: number;
  amount: number;
}
export interface Calculation {
  steps?: Bi[];
  rule_code?: string;
  base_date?: string;
  nominal?: string;
  office?: string;
  business?: boolean;
  overrides?: Record<string, unknown>;
  computed_at?: string;
}
export interface Citation {
  field?: string;
  page?: number;
  quote?: string;
  url?: string;
}
export interface PriorityClaim {
  jurisdiction: string;
  number: string;
  date: string;
}
export interface RuleExtension {
  label: string;
  label_ja?: string;
  months?: number;
  days?: number;
  fee?: string;
}

/* ---------------- op responses ---------------- */

export interface EventCodeDef {
  label: string;
  label_ja: string;
  subjects: string[];
  status: string | null;
  field?: string;
}
export interface MetaResponse {
  event_codes: Record<string, EventCodeDef>;
  subjects: string[];
  status_group: Record<string, string>;
  offices: Record<string, { enabled: boolean; status: string; last_sync?: string; has_secret?: boolean }>;
  office_labels: Record<string, string>;
  approval_stages: string[];
  reports: string[];
  profiles: Profile[];
  modules: Partial<Record<ModuleKey, boolean>>;
  role: Role | '';
  language: Lang;
  today: string;
}

/** A deadline the engine would create (events.preview, events.record, talents.lifecycle preview). */
export interface Proposal {
  key: string;
  rule_id: string;
  rule_code: string;
  rule_name: string;
  rule_name_ja: string;
  title: string;
  title_ja: string;
  cycle_label: string;
  kind: 'hard' | 'extendable' | 'designated' | 'internal' | 'reminder';
  category: string;
  cycle: number;
  base_date: string;
  nominal_date: string;
  due_date: string;
  target_date: string;
  final_date: string;
  window_opens: string;
  grace_end: string;
  office: string;
  citation: string;
  notes: string;
  steps: Bi[];
  past: boolean;
  exists: boolean;
  selected: boolean;
  assignee?: string;
}

export interface Check {
  key: string;
  level: 'ok' | 'info' | 'warn' | 'block' | 'na' | 'consent';
  text: Bi;
  links?: { type: string; id: string; label: string }[];
}
export interface DeciderWindow {
  grant_id: string;
  agreement_id: string;
  holders: { party: string; name: string }[];
  fee_pct: number;
  fee_base: string;
  start: string;
  end: string;
}
export interface Decider {
  mode: 'window' | 'shared_window' | 'conflict' | 'consent' | 'partial';
  consent_mode?: string;
  text: Bi;
  holders?: { party: string; name: string }[];
  members?: { id: string; party: string; name: string; status?: string }[];
  committee?: { id: string; name: string } | undefined;
  windows?: DeciderWindow[] | undefined;
  [k: string]: unknown;
}
export interface CanWeCell {
  code: string;
  label: string;
  label_ja: string;
  status: 'available' | 'partial' | 'unavailable' | 'no_rights';
  free: [string, string][];
  reasons: { code: string; text: Bi; agreement_id?: string; ref?: string }[];
  available_from: string;
  available_until: string;
  checks?: Check[];
  decider?: Decider | null;
  trademarks?: Record<string, { state: 'registered' | 'pending' | 'missing'; marks: { id: string; ref: string; registration_no: string; application_no: string }[] }> | null;
  copyright_line?: string;
  verdict?: 'yes' | 'conditions' | 'consent' | 'no';
}
export interface CanWeRow {
  type: string;
  id: string;
  label: string;
  owned: boolean;
  owned_by: string;
  committee: string;
  franchise: string;
  work: string;
  characters: string[];
  cells: CanWeCell[];
}
export interface CanWeResponse {
  column: string;
  columns: { code: string; label: string; label_ja: string }[];
  start: string;
  end: string;
  rows: CanWeRow[];
  classes?: number[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'date' | 'link' | string;
}
export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  note?: string;
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  link: string;
  score: number;
}

export interface PortalProductInfo {
  name: string;
  ref: string;
  category: string;
  sales_start: string;
  retail_price: number;
  currency: string;
  includes_voice: boolean;
}

export interface PortalContext {
  role: Role;
  lang: Lang;
  parties: { id: string; name: string }[];
  agreements: {
    id: string;
    ref: string;
    title: string;
    agreement_type: string;
    status: string;
    term_start: string;
    term_end: string;
    royalty_rate: number;
    royalty_basis: string;
    currency: string;
    copyright_notice: string;
    approval_stages: StageTemplate[];
    /** Characters the licence covers (named in its grants or in a licensed franchise). */
    characters: { id: string; name: string }[];
  }[];
  products: { id: string; ref: string; name: string; stage: string; agreement: string; sales_start: string; retail_price: number; currency: string }[];
  approvals: {
    id: string;
    product: string;
    product_name: string;
    product_ref: string;
    product_info: PortalProductInfo | null;
    stage: string;
    status: string;
    round: number;
    due_date: string;
    mine: string[];
  }[];
  statements: {
    id: string;
    agreement: string;
    period_start: string;
    period_end: string;
    due_date: string;
    status: string;
    royalty_due: number;
    currency: string;
    lines: { product: string; description: string; manufactured_qty: number; sold_qty: number; retail_price: number; royalty: number }[];
  }[];
  seals: { id: string; product: string; quantity: number; serial_from: string; serial_to: string; status: string; used: number; void: number; returned: number }[];
  committees: { id: string; name: string; status: string }[];
  consents: { id: string; committee: string; subject: string; due_date: string; status: string; answers: ConsentAnswer[] }[];
  distributions: { id: string; committee: string; period_end: string; pool: number; currency: string; status: string; members: DistributionMember[] }[];
}

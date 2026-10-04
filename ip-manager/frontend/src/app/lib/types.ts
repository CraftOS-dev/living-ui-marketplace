/**
 * Record shapes for every IP Manager collection (mirrors the PocketBase
 * migrations) plus the enum label tables the UI renders. Dates arrive as
 * PocketBase strings ("YYYY-MM-DD 00:00:00.000Z" or "").
 */
import type { RecordModel } from 'pocketbase';

export type Role = 'admin' | 'manager' | 'counsel' | 'contributor' | 'inventor' | 'viewer';
export type IpType = 'patent' | 'utility_model' | 'design' | 'trademark' | 'copyright' | 'domain';
export type StatusGroup = 'pre_filing' | 'pending' | 'live' | 'dead';
export type MatterStatus =
  | 'to_file'
  | 'filed'
  | 'published'
  | 'examination'
  | 'office_action'
  | 'allowed'
  | 'opposed'
  | 'granted'
  | 'registered'
  | 'in_grace'
  | 'lapsed'
  | 'abandoned'
  | 'withdrawn'
  | 'refused'
  | 'expired'
  | 'revoked'
  | 'transferred_out';
export type DeadlineKind = 'hard' | 'extendable' | 'designated' | 'internal' | 'reminder';
export type DeadlineStatus = 'open' | 'done' | 'not_needed' | 'extended' | 'missed' | 'transferred' | 'cancelled';
export type Category =
  | 'prosecution'
  | 'filing'
  | 'maintenance'
  | 'renewal'
  | 'opposition'
  | 'use'
  | 'term'
  | 'agreement'
  | 'copyright'
  | 'clearance'
  | 'dispute'
  | 'invention'
  | 'other';
export type VocabPack = 'general' | 'entertainment' | 'technology' | 'consumer';
export type Office = 'uspto_odp' | 'uspto_tsdr' | 'epo_ops' | 'euipo' | 'jpo';

export interface UserRec extends RecordModel {
  email: string;
  name: string;
  role: Role;
  job_title: string;
  digest_opt_out: boolean;
  avatar: string;
}

export interface SettingsRec extends RecordModel {
  org_name: string;
  vocab_pack: VocabPack;
  home_currency: string;
  target_buffer_days: number;
  reminder_days: number[] | null;
  digest_enabled: boolean;
  digest_hour: number;
  digest_channel: 'in_app' | 'email' | 'slack';
  slack_channel: string;
  second_reviewer: boolean;
  renewal_default: 'renew' | 'lapse' | 'decide';
  default_signup_role: 'manager' | 'counsel' | 'contributor' | 'viewer';
  jurisdictions: string[] | null;
  ref_prefix_patent: string;
  ref_prefix_trademark: string;
  ref_prefix_design: string;
  ref_prefix_copyright: string;
  ref_prefix_agreement: string;
  ref_prefix_invention: string;
  onboarding_done: boolean;
  fx_auto: boolean;
  fx_updated: string;
  sync_enabled: boolean;
  sync_hour: number;
  last_digest: string;
}

export interface OfficeConnectionRec extends RecordModel {
  office: Office;
  enabled: boolean;
  sandbox: boolean;
  client_id: string;
  username: string;
  has_secret: boolean;
  status: 'not_configured' | 'connected' | 'error' | 'paused';
  last_check: string;
  last_error: string;
  calls_today: number;
  remaining_calls: number;
  last_sync: string;
  notes: string;
}

export interface PropertyRec extends RecordModel {
  name: string;
  kind: 'franchise' | 'brand' | 'product_line' | 'technology' | 'portfolio' | 'other' | '';
  rights_basis: 'owned' | 'acquired' | 'mixed' | '';
  description: string;
  image: string;
  business_unit: string;
  status: 'active' | 'dormant' | 'retired' | '';
  tags: string[] | null;
  parent: string;
}

export interface PartyRec extends RecordModel {
  name: string;
  kind: 'person' | 'organization';
  roles: string[] | null;
  email: string;
  phone: string;
  organization: string;
  country: string;
  address: string;
  external_ref: string;
  notes: string;
  user: string;
}

export type WorkType =
  | 'feature_film'
  | 'series'
  | 'season'
  | 'episode'
  | 'short'
  | 'game'
  | 'book'
  | 'comic'
  | 'music_composition'
  | 'sound_recording'
  | 'album'
  | 'character'
  | 'logo'
  | 'artwork'
  | 'photograph'
  | 'software'
  | 'website'
  | 'format'
  | 'script'
  | 'documentation'
  | 'marketing_asset'
  | 'other';

export interface WorkRec extends RecordModel {
  title: string;
  work_type: WorkType;
  property: string;
  rights_basis: 'owned' | 'acquired' | 'mixed' | '';
  status: 'development' | 'production' | 'released' | 'archived' | '';
  description: string;
  creation_date: string;
  publication_date: string;
  publication_country: string;
  eidr: string;
  isrc: string;
  iswc: string;
  isbn: string;
  other_ids: string;
  made_for_hire: boolean;
  authors: string;
  author_death_year: number;
  author_kind: 'individual' | 'joint' | 'corporate' | 'anonymous' | '';
  language: string;
  image: string;
  tags: string[] | null;
  notes: string;
  parent: string;
}

export type MarkType =
  | 'word'
  | 'figurative'
  | 'combined'
  | 'three_d'
  | 'colour'
  | 'sound'
  | 'motion'
  | 'position'
  | 'pattern'
  | 'hologram'
  | 'multimedia'
  | 'other';

export interface FamilyRec extends RecordModel {
  kind: 'patent' | 'design' | 'trademark';
  title: string;
  property: string;
  mark_type: MarkType | '';
  mark_image: string;
  word_element: string;
  vienna_codes: string;
  disclaimer: string;
  transliteration: string;
  translation: string;
  description: string;
  technology_tags: string[] | null;
  products: string;
  strategy: 'maintain' | 'review' | 'prune' | 'abandoned' | '';
  strategy_note: string;
  business_unit: string;
  owner_entity: string;
  tags: string[] | null;
}

export interface PriorityClaim {
  country: string;
  number: string;
  date: string;
}

export interface MatterRec extends RecordModel {
  ref: string;
  ip_type: IpType;
  title: string;
  family: string;
  property: string;
  work: string;
  jurisdiction: string;
  route: string;
  relation: string;
  application_no: string;
  filing_date: string;
  publication_no: string;
  publication_date: string;
  registration_no: string;
  registration_date: string;
  expiry_date: string;
  expiry_override: boolean;
  priority_claims: PriorityClaim[] | null;
  status: MatterStatus;
  status_group: StatusGroup;
  office_status: string;
  status_date: string;
  entity_size: 'large' | 'small' | 'micro' | 'na' | '';
  tm_basis: string;
  tm_register: 'principal' | 'supplemental' | 'na' | '';
  owner_of_record: string;
  applicants: string;
  counsel: string;
  client_ref: string;
  cost_center: string;
  responsible: string;
  docketer: string;
  sync_source: string;
  sync_enabled: boolean;
  sync_state: 'not_connected' | 'connected' | 'error' | 'not_found' | '';
  last_synced: string;
  sync_error: string;
  official_data: Record<string, unknown> | null;
  next_deadline: string;
  next_deadline_title: string;
  abstract: string;
  claims_count: number;
  independent_claims: number;
  pta_days: number;
  options: Record<string, unknown> | null;
  tags: string[] | null;
  notes: string;
  parent: string;
}

export interface GoodsServicesRec extends RecordModel {
  matter: string;
  nice_class: number;
  spec: string;
  class_status: 'pending' | 'registered' | 'refused' | 'partially_refused' | 'deleted' | 'cancelled' | '';
  first_use: string;
  first_use_commerce: string;
  in_use: boolean;
  use_evidence: string[];
  evidence_note: string;
  last_reviewed: string;
}

export interface EventRec extends RecordModel {
  matter: string;
  agreement: string;
  work: string;
  code: string;
  label: string;
  date: string;
  st27: string;
  source: 'manual' | 'office' | 'inbox' | 'rule' | 'system' | '';
  document: string;
  data: Record<string, unknown> | null;
  created_by: string;
}

export interface Extension {
  months: number;
  label: string;
}

export interface RuleRec extends RecordModel {
  code: string;
  name: string;
  ip_type: string;
  jurisdiction: string;
  routes: string[] | null;
  trigger_event: string;
  conditions: Record<string, unknown> | null;
  base: string;
  offset_years: number;
  offset_months: number;
  offset_days: number;
  due_end_of_month: boolean;
  kind: DeadlineKind;
  category: Category | '';
  title: string;
  extensions: Extension[] | null;
  final_offset_months: number;
  window_months: number;
  grace_months: number;
  grace_note: string;
  recurring_years: number;
  recurring_until_years: number;
  recurring_first_cycle: number;
  cycle_label: string;
  roll_office: string;
  citation: string;
  notes: string;
  effective_from: string;
  effective_to: string;
  version: number;
  enabled: boolean;
  system: boolean;
  creates_renewal: boolean;
  fee_kind: string;
}

export interface Calculation {
  steps?: string[];
  rule_code?: string;
  base_date?: string;
  nominal?: string;
  overrides?: Record<string, unknown>;
  computed_at?: string;
}

export interface DeadlineRec extends RecordModel {
  title: string;
  matter: string;
  agreement: string;
  work: string;
  disclosure: string;
  family: string;
  dispute: string;
  kind: DeadlineKind;
  category: Category | '';
  status: DeadlineStatus;
  target_date: string;
  due_date: string;
  final_date: string;
  window_opens: string;
  grace_end: string;
  nominal_date: string;
  closed_at: string;
  closed_by: string;
  close_reason: string;
  assignee: string;
  source: 'rule' | 'office' | 'inbox' | 'manual' | 'agreement' | 'system' | '';
  rule: string;
  rule_code: string;
  base_event: string;
  base_date: string;
  calculation: Calculation | null;
  locked: boolean;
  extension_level: number;
  cycle: number;
  key: string;
  jurisdiction: string;
  ip_type: string;
  ref: string;
  citation: string;
  notes: string;
}

export interface RenewalRec extends RecordModel {
  deadline: string;
  matter: string;
  cycle_label: string;
  cycle: number;
  due_date: string;
  grace_end: string;
  window_opens: string;
  official_fee: number;
  other_fee: number;
  currency: string;
  home_amount: number;
  home_currency: string;
  fee_known: boolean;
  fee_note: string;
  decision: 'pending' | 'renew' | 'renew_partial' | 'lapse' | 'defer';
  decided_by: string;
  decided_at: string;
  rationale: string;
  classes_keep: number[] | null;
  instruction_status: 'not_instructed' | 'instructed' | 'paid' | 'confirmed' | 'lapsed' | '';
  instructed_at: string;
  provider: string;
  po_number: string;
  paid_date: string;
  paid_amount: number;
  receipt: string;
}

export interface FeeRec extends RecordModel {
  office: string;
  ip_type: string;
  fee_kind: string;
  /** 0 = any cycle. */
  cycle: number;
  /** When above 0 the row covers cycle..cycle_to. */
  cycle_to: number;
  entity: 'any' | 'large' | 'small' | 'micro' | '';
  per_class: boolean;
  amount: number;
  /** Added once per claim on the matter (JP patent annuities). */
  per_claim_amount: number;
  /** Price of each class from `from` on, beyond the base (EUIPO, Madrid). */
  class_tiers: { from: number; amount: number }[] | null;
  currency: string;
  grace_surcharge: number;
  surcharge_percent: boolean;
  effective_from: string;
  source: string;
  notes: string;
}

export interface FxRec extends RecordModel {
  code: string;
  per_eur: number;
  as_of: string;
  source: 'ecb' | 'manual' | '';
}

export type AgreementType =
  | 'option'
  | 'acquisition'
  | 'assignment'
  | 'license_in'
  | 'license_out'
  | 'talent'
  | 'services'
  | 'distribution'
  | 'merchandise'
  | 'sync'
  | 'master_use'
  | 'co_production'
  | 'coexistence'
  | 'settlement'
  | 'nda'
  | 'rnd'
  | 'employment_ip'
  | 'other';

export interface PaymentItem {
  date: string;
  amount: number;
  label: string;
  currency?: string;
}

export interface AgreementRec extends RecordModel {
  ref: string;
  title: string;
  agreement_type: AgreementType;
  direction: 'in' | 'out' | 'mutual' | 'none';
  status: 'draft' | 'negotiating' | 'active' | 'expired' | 'terminated' | 'renewed' | 'superseded';
  counterparty: string;
  our_entity: string;
  property: string;
  signed_date: string;
  effective_date: string;
  term_start: string;
  term_end: string;
  perpetual: boolean;
  auto_renew: boolean;
  renewal_notice_days: number;
  exclusivity: 'exclusive' | 'non_exclusive' | 'sole' | 'mixed' | '';
  territory_summary: string;
  currency: string;
  royalty_rate: number;
  royalty_basis: string;
  flat_fee: number;
  advance: number;
  minimum_guarantee: number;
  payment_schedule: PaymentItem[] | null;
  reporting_frequency: 'none' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | '';
  report_due_days: number;
  option_period_end: string;
  option_extension_fee: number;
  reversion_date: string;
  sell_off_days: number;
  author_grant: boolean;
  covers_publication: boolean;
  governing_law: string;
  summary: string;
  notes: string;
  tags: string[] | null;
  responsible: string;
  ai_extracted: boolean;
}

export interface DimSpec {
  include?: string[];
  exclude?: string[];
}

export interface GrantRec extends RecordModel {
  agreement: string;
  direction: 'in' | 'out';
  kind: 'grant' | 'holdback' | 'restriction' | 'reservation';
  exclusive: boolean;
  properties: string[];
  works: string[];
  matters: string[];
  dims: Record<string, DimSpec> | null;
  term_start: string;
  term_end: string;
  rights_text: string;
  override_reason: string;
}

export interface DimensionRec extends RecordModel {
  key: string;
  label: string;
  order: number;
  enabled: boolean;
  description: string;
}

export interface DimensionValueRec extends RecordModel {
  dimension: string;
  code: string;
  label: string;
  parent_code: string;
  order: number;
}

export type DisclosureStage =
  | 'draft'
  | 'submitted'
  | 'search'
  | 'review'
  | 'approved'
  | 'drafting'
  | 'filed'
  | 'rejected'
  | 'on_hold'
  | 'merged'
  | 'archived';

export interface DisclosureRec extends RecordModel {
  ref: string;
  title: string;
  summary: string;
  problem: string;
  solution: string;
  novelty: string;
  advantages: string;
  uses: string;
  stage: DisclosureStage;
  submitted_by: string;
  submitted_at: string;
  property: string;
  products: string;
  tech_tags: string[] | null;
  public_disclosure_date: string;
  on_sale_date: string;
  nda_date: string;
  answers: Record<string, unknown> | null;
  score: number;
  review_count: number;
  decision: string;
  decision_at: string;
  family: string;
  matter: string;
  inventor_names: string;
  /** Accounts named as inventors (derived on the server). */
  inventor_users: string[];
}

export interface DisclosureReviewRec extends RecordModel {
  disclosure: string;
  reviewer: string;
  scores: Record<string, number> | null;
  total: number;
  comment: string;
  recommendation: 'file' | 'hold' | 'reject' | 'more_info' | '';
}

export interface CriterionLevel {
  value: number;
  label: string;
}

export interface ScoringCriterionRec extends RecordModel {
  key: string;
  label: string;
  description: string;
  weight: number;
  order: number;
  levels: CriterionLevel[] | null;
  enabled: boolean;
}

export interface DisputeRec extends RecordModel {
  title: string;
  dispute_type:
    | 'opposition'
    | 'cancellation'
    | 'invalidation'
    | 'non_use'
    | 'appeal'
    | 'litigation'
    | 'udrp'
    | 'cease_and_desist'
    | 'takedown'
    | 'ttab'
    | 'other';
  role: 'offense' | 'defense';
  matter: string;
  family: string;
  other_party: string;
  their_mark: string;
  forum: string;
  proceeding_no: string;
  status: 'monitoring' | 'pending' | 'active' | 'settled' | 'won' | 'lost' | 'withdrawn' | 'closed';
  filed_date: string;
  outcome: string;
  counsel: string;
  notes: string;
}

export type DocType =
  | 'office_action'
  | 'filing'
  | 'receipt'
  | 'certificate'
  | 'correspondence'
  | 'agreement'
  | 'evidence'
  | 'specimen'
  | 'chain_of_title'
  | 'clearance'
  | 'report'
  | 'invoice'
  | 'drawing'
  | 'disclosure'
  | 'other';

export interface DocumentRec extends RecordModel {
  title: string;
  file: string;
  doc_type: DocType | '';
  doc_date: string;
  matter: string;
  agreement: string;
  work: string;
  disclosure: string;
  family: string;
  property: string;
  dispute: string;
  source: 'upload' | 'office' | 'email' | 'agent' | '';
  extracted: Record<string, unknown> | null;
  summary: string;
  uploaded_by: string;
}

export interface DiffItem {
  field: string;
  label: string;
  current: string;
  incoming: string;
  kind: 'text' | 'date';
}

export interface OfficeEvent {
  code: string;
  raw_code: string;
  date: string;
  label: string;
}

export interface Citation {
  field?: string;
  page?: number;
  quote?: string;
}

export interface InboxProposal {
  event?: { code: string; date: string; label?: string; period_months?: number; period_days?: number; due_date?: string };
  events?: OfficeEvent[];
  annuity_updates?: { deadline_id: string; title: string; current: string; incoming: string }[];
  snapshot?: Record<string, unknown>;
  document_type?: string;
  summary?: string;
  extra_deadlines?: { title: string; due_date: string; kind?: DeadlineKind; reason?: string }[];
  fields?: Record<string, string>;
  agreement?: Record<string, unknown>;
  grants?: Record<string, unknown>[];
  first_decision?: Record<string, unknown>;
}

export interface InboxRec extends RecordModel {
  kind: 'office_change' | 'document' | 'agreement_draft' | 'agent_proposal' | 'email' | 'watch_hit';
  title: string;
  summary: string;
  status: 'new' | 'accepted' | 'partially_accepted' | 'rejected' | 'awaiting_second';
  matter: string;
  agreement: string;
  document: string;
  office: string;
  proposal: InboxProposal | null;
  diffs: DiffItem[] | null;
  confidence: 'high' | 'medium' | 'low' | 'none' | '';
  citations: Citation[] | null;
  source: 'office_sync' | 'agent' | 'email' | 'user' | '';
  proposed_by: string;
  decided_by: string;
  decided_at: string;
  first_approver: string;
  first_approved_at: string;
  requires_second: boolean;
  note: string;
}

export interface ClearanceRec extends RecordModel {
  work: string;
  property: string;
  item_type: string;
  title: string;
  status: 'not_started' | 'requested' | 'in_progress' | 'cleared' | 'cleared_with_risk' | 'not_cleared' | 'not_applicable';
  provider: string;
  due_date: string;
  cleared_date: string;
  expires: string;
  document: string;
  responsible: string;
  notes: string;
}

export type ApprovalStage = 'concept' | 'pre_production' | 'production_sample' | 'packaging' | 'final';
export type ApprovalStatus = 'submitted' | 'in_review' | 'approved' | 'approved_with_changes' | 'resubmit' | 'rejected';

export interface ApprovalRec extends RecordModel {
  agreement: string;
  property: string;
  licensee: string;
  product_name: string;
  sku: string;
  category: string;
  stage: ApprovalStage;
  status: ApprovalStatus;
  due_date: string;
  images: string[];
  revision: number;
  decided_by: string;
  decided_at: string;
  notes: string;
}

export interface ApprovalRoundRec extends RecordModel {
  approval: string;
  revision: number;
  stage: ApprovalStage | '';
  status: ApprovalStatus | '';
  comment: string;
  images: string[];
  decided_by: string;
}

export interface RoyaltyReportRec extends RecordModel {
  agreement: string;
  period_start: string;
  period_end: string;
  due_date: string;
  received_date: string;
  gross_sales: number;
  royalty_due: number;
  paid_amount: number;
  currency: string;
  status: 'expected' | 'received' | 'paid' | 'disputed' | 'waived';
  document: string;
  notes: string;
}

export interface WatchHitRec extends RecordModel {
  family: string;
  matter: string;
  their_mark: string;
  their_owner: string;
  jurisdiction: string;
  application_no: string;
  classes: string;
  goods: string;
  publication_date: string;
  opposition_deadline: string;
  score: number;
  status: 'new' | 'reviewing' | 'dismissed' | 'monitor' | 'escalated' | 'actioned';
  action: string;
  source: string;
  reviewer: string;
  decided_at: string;
  notes: string;
}

export interface InvolvementRec extends RecordModel {
  party: string;
  role:
    | 'inventor'
    | 'author'
    | 'applicant'
    | 'owner'
    | 'assignee'
    | 'licensee'
    | 'licensor'
    | 'counsel'
    | 'agent'
    | 'talent'
    | 'contributor'
    | 'claimant'
    | 'other';
  matter: string;
  agreement: string;
  work: string;
  disclosure: string;
  family: string;
  share: number;
  note: string;
}

export interface SavedViewRec extends RecordModel {
  name: string;
  page: string;
  filters: Record<string, unknown> | null;
  columns: string[] | null;
  scope: 'private' | 'shared';
  owner: string;
  schedule: 'none' | 'daily' | 'weekly' | 'monthly' | '';
  last_sent: string;
}

export interface AuditRec extends RecordModel {
  actor: string;
  actor_name: string;
  action: string;
  collection: string;
  record_id: string;
  record_label: string;
  changes: Record<string, unknown> | null;
  reason: string;
}

export interface NotificationRec extends RecordModel {
  user: string;
  kind: 'digest' | 'escalation' | 'inbox' | 'sync' | 'assignment' | 'info';
  title: string;
  body: string;
  link: string;
  read: boolean;
  data: Record<string, unknown> | null;
}

export interface SyncRunRec extends RecordModel {
  office: string;
  trigger: 'scheduled' | 'manual' | 'import' | '';
  status: 'running' | 'ok' | 'partial' | 'error' | 'skipped';
  checked: number;
  changes: number;
  errors: number;
  message: string;
  finished: string;
}

export interface OfficeCalendarRec extends RecordModel {
  office: string;
  date: string;
  name: string;
  source: 'computed' | 'official' | 'manual' | '';
}

/* ------------------------------------------------------------------ */
/* Op responses                                                        */
/* ------------------------------------------------------------------ */

export interface Proposal {
  rule_id: string;
  rule_code: string;
  rule_name: string;
  title: string;
  cycle_label: string;
  kind: DeadlineKind;
  category: Category;
  cycle: number;
  base_date: string;
  nominal_date: string;
  due_date: string;
  target_date: string;
  final_date: string;
  window_opens: string;
  grace_end: string;
  citation: string;
  notes: string;
  steps: string[];
  key: string;
  past: boolean;
  exists: boolean;
  selected: boolean;
  creates_renewal: boolean;
  extensions: Extension[];
}

export interface EventCodeDef {
  label: string;
  status: MatterStatus | null;
  field?: string;
  st27?: string;
}

export interface MetaResponse {
  event_codes: Record<string, EventCodeDef>;
  status_group: Record<string, StatusGroup>;
  offices: Record<string, { enabled: boolean; status: string; last_sync: string; has_secret?: boolean; last_error?: string; remaining_calls?: number }>;
  office_labels: Record<string, string>;
  role: Role;
  today: string;
}

export interface SummaryResponse {
  today: string;
  portfolio: Record<string, Record<StatusGroup, number>>;
  jurisdictions: Record<string, number>;
  deadlines: { overdue: number; week: number; d30: number; d90: number; mine_overdue: number; mine_week: number };
  inbox: { new: number; awaiting_second: number };
  renewals: { pending: number; in_grace: number };
  agreements: { active: number; expiring90: number };
  renewal_spend: { currency: string; months: { month: string; amount: number; count: number; unknown: number }[] };
  counts: {
    properties: number;
    works: number;
    families: number;
    disclosures_open: number;
    watch_new: number;
    approvals_open: number;
    disputes_active: number;
  };
}

export interface AvailabilityReason {
  code: string;
  agreement_id?: string;
  ref?: string;
  counterparty?: string;
  from?: string;
  to?: string;
  exclusive?: boolean;
  text: string;
}

export interface AvailabilityCell {
  code: string;
  label: string;
  status: 'available' | 'partial' | 'unavailable' | 'no_rights';
  free: [string, string][];
  available_from: string;
  available_until: string;
  reasons: AvailabilityReason[];
}

export interface AvailabilityResponse {
  column: string;
  columns: { code: string; label: string }[];
  start: string;
  end: string;
  rows: { type: string; id: string; label: string; owned: boolean; owned_by: string; cells: AvailabilityCell[] }[];
}

export interface ConflictItem {
  grant_index: number;
  asset: string;
  asset_type: string;
  asset_id: string;
  value: string;
  status: string;
  reasons: AvailabilityReason[];
}

export interface ReportResponse {
  title: string;
  columns: { key: string; label: string; type: 'text' | 'date' | 'number' }[];
  rows: Record<string, string | number>[];
}

export interface ForecastResponse {
  currency: string;
  horizon: string;
  years: { year: string; total: number; count: number; unknown: number; by_jurisdiction: Record<string, number> }[];
  items: {
    date: string;
    year: string;
    matter_id: string;
    ref: string;
    title: string;
    jurisdiction: string;
    ip_type: string;
    property: string;
    amount: number;
    currency: string;
    home_amount: number | null;
    projected: boolean;
  }[];
}

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  link: string;
  score: number;
}

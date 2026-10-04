/**
 * Record shapes for every collection, GENERATED from the schema by
 * reference/tools/gen_records.py. Edit the generator, not this file.
 * Dates arrive as PocketBase strings ("YYYY-MM-DD 00:00:00.000Z" or "").
 */
import type { RecordModel } from 'pocketbase';
import type {
  AiPolicy, ApprovalReviewer, Calculation, Citation, ConsentAnswer, CopyrightLine, DimSpecMap, DistributionMember, DistributionReceipt,
  ModuleKey, NameEntry, PriorityClaim, Profile, RateTier, RuleExtension, ScheduledItem, ScheduledPayment, StageTemplate,
  ExternalId, RevenueShare, TalentChannel, WaterfallStep,
} from './shapes.ts';

export interface AgreementRec extends RecordModel {
  ref: string;
  title: string;
  agreement_type: "original_work_license" | "committee" | "production" | "creator_commission" | "talent" | "voice_actor" | "merchandise" | "overseas" | "streaming" | "broadcast" | "video" | "game" | "pachinko" | "stage" | "event_collab" | "brand_tieup" | "publishing" | "music_publishing" | "master_license" | "master_assignment" | "co_master" | "tie_up" | "sync" | "karaoke" | "distribution" | "platform" | "fan_permit" | "assignment" | "nda" | "settlement" | "coexistence" | "other" | '';
  direction: "in" | "out" | "mutual" | "none" | '';
  status: "draft" | "negotiating" | "active" | "expired" | "terminated" | "renewed" | "superseded" | '';
  counterparty: string;
  agent: string;
  our_entity: string;
  franchise: string;
  work: string;
  committee: string;
  signed_date: string;
  effective_date: string;
  term_start: string;
  term_end: string;
  perpetual: boolean;
  auto_renew: boolean;
  renewal_notice_days: number;
  exclusivity: "exclusive" | "non_exclusive" | "sole" | "mixed" | '';
  territory_summary: string;
  currency: string;
  royalty_rate: number;
  royalty_basis: "retail_x_manufactured" | "retail_x_sold" | "wholesale_net" | "net_receipts" | "per_unit" | "per_seal" | "flat_fee" | "revenue_share" | "none" | '';
  rate_tiers: RateTier[] | null;
  deduction_cap_pct: number;
  flat_fee: number;
  advance: number;
  minimum_guarantee: number;
  mg_recoupable: boolean;
  cross_collateral: boolean;
  payment_schedule: ScheduledPayment[] | null;
  reporting_frequency: "none" | "monthly" | "quarterly" | "semiannual" | "annual" | '';
  report_due_days: number;
  late_interest_pct: number;
  audit_threshold_pct: number;
  option_period_end: string;
  option_extension_fee: number;
  reversion_date: string;
  sell_off_days: number;
  sell_off_on_expiry_only: boolean;
  samples_owed: number;
  approval_sla_days: number;
  approval_timeout: "none" | "deemed_refused" | "deemed_approved" | '';
  approval_stages: StageTemplate[] | null;
  original_approval_required: boolean;
  talent_approval_required: boolean;
  copyright_notice: string;
  style_guide_version: string;
  sublicense_allowed: boolean;
  delivery_schedule: ScheduledItem[] | null;
  completion_deadline: string;
  sequel_negotiation_end: string;
  author_grant: boolean;
  art27_28: boolean;
  moral_rights_waiver: boolean;
  payment_due_days: number;
  non_compete: boolean;
  stage_name_clause: "agency_owns" | "talent_owns" | "shared" | "not_stated" | '';
  post_term: unknown | null;
  revenue_share: RevenueShare[] | null;
  governing_law: string;
  summary: string;
  notes: string;
  tags: string[] | null;
  responsible: string;
  ai_extracted: boolean;
  portal_users: string[];
  created: string;
  updated: string;
  parent: string;
}

export interface ApprovalRoundRec extends RecordModel {
  approval: string;
  round: number;
  stage: "proposal" | "concept" | "design" | "color_proof" | "prototype" | "pre_production_sample" | "final_sample" | "packaging" | "advertising" | "mass_production_check" | '';
  status: "submitted" | "in_review" | "changes_requested" | "approved" | "rejected" | "withdrawn" | '';
  reviewer_key: string;
  comment: string;
  annotations: unknown | null;
  images: string[];
  decided_by: string;
  decided_by_name: string;
  created: string;
  updated: string;
}

export interface ApprovalRec extends RecordModel {
  product: string;
  agreement: string;
  stage: "proposal" | "concept" | "design" | "color_proof" | "prototype" | "pre_production_sample" | "final_sample" | "packaging" | "advertising" | "mass_production_check" | '';
  status: "submitted" | "in_review" | "changes_requested" | "approved" | "rejected" | "withdrawn" | '';
  round: number;
  submitted_at: string;
  due_date: string;
  reviewers: ApprovalReviewer[] | null;
  assigned_reviewers: string[];
  timeout_outcome: "none" | "deemed_refused" | "deemed_approved" | '';
  images: string[];
  copyright_check: "unchecked" | "ok" | "wrong" | '';
  draft_comments: string;
  decided_by: string;
  decided_at: string;
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
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
  created: string;
  updated: string;
}

export interface CalendarYearRec extends RecordModel {
  office: string;
  year: number;
  created: string;
  updated: string;
}

export interface CastingRec extends RecordModel {
  character: string;
  talent: string;
  role: "voice" | "performer" | "motion" | "singing" | "voice_and_performer" | '';
  start_date: string;
  end_date: string;
  credit_name: string;
  notes: string;
  created: string;
  updated: string;
}

export interface CharacterAssetRec extends RecordModel {
  character: string;
  component: "name" | "logo" | "design_sheet" | "standing_art" | "outfit" | "live2d_model" | "model_3d" | "emote" | "voice" | "persona_lore" | "jingle" | "other" | '';
  label: string;
  version: string;
  creator: string;
  agreement: string;
  acquisition: "owned_original" | "work_for_hire" | "assignment" | "exclusive_license" | "nonexclusive_license" | "unknown" | '';
  art27_28: boolean;
  moral_rights_waiver: boolean;
  credit_text: string;
  portfolio_use: "not_allowed" | "allowed" | "after_announcement" | "conditions" | '';
  portfolio_note: string;
  delivered_date: string;
  license_end: string;
  territory_limit: string;
  status: "planned" | "commissioned" | "delivered" | "cleared" | "needs_attention" | '';
  order_terms_date: string;
  inspected_date: string;
  payment_due: string;
  paid_date: string;
  fee: number;
  currency: string;
  rework: unknown | null;
  files: string[];
  notes: string;
  created: string;
  updated: string;
  derived_from: string;
}

export interface CharacterRec extends RecordModel {
  name: string;
  names: NameEntry[] | null;
  franchise: string;
  appears_in: string[];
  kind: "anime_character" | "vtuber_persona" | "virtual_singer" | "mascot" | "idol_member" | "game_character" | "other" | '';
  ownership_model: "agency_owned" | "talent_owned" | "co_owned" | "licensed_in" | "committee_owned" | '';
  status: "development" | "active" | "hiatus" | "retired" | "archived" | '';
  debut_date: string;
  birthday: string;
  profile: string;
  image: string;
  ai_policy: AiPolicy | null;
  copyright_line: string;
  announcement_date: string;
  tags: string[] | null;
  created: string;
  updated: string;
}

export interface CidAllowRec extends RecordModel {
  channel_id: string;
  name: string;
  reason: string;
  added_date: string;
  talent: string;
  notes: string;
  created: string;
  updated: string;
}

export interface ClearanceRec extends RecordModel {
  work: string;
  character: string;
  franchise: string;
  item_type: "original_work_license" | "script" | "character_design" | "music_sync" | "music_master" | "voice_cast" | "performer_consent" | "footage" | "artwork" | "trademark_search" | "title_search" | "chain_of_title" | "committee_consent" | "ratings" | "other" | '';
  title: string;
  status: "not_started" | "requested" | "in_progress" | "cleared" | "cleared_with_risk" | "not_cleared" | "not_applicable" | '';
  provider: string;
  due_date: string;
  cleared_date: string;
  expires: string;
  document: string;
  responsible: string;
  notes: string;
  created: string;
  updated: string;
}

export interface CommitteeMemberRec extends RecordModel {
  committee: string;
  party: string;
  name: string;
  investment: number;
  currency: string;
  share_pct: number;
  copyright_share_pct: number;
  roles: string[] | null;
  in_kind: boolean;
  in_kind_note: string;
  status: "active" | "transferred" | "insolvent" | "exited" | '';
  status_date: string;
  notes: string;
  created: string;
  updated: string;
}

export interface CommitteeRec extends RecordModel {
  name: string;
  work: string;
  franchise: string;
  form: "nin_i_kumiai" | "spc" | "llp" | "sole" | "co_production" | "other" | '';
  status: "forming" | "formed" | "production" | "exploiting" | "term_review" | "dissolved" | "consolidated" | '';
  formed_date: string;
  term_end: string;
  review_date: string;
  buyback_window_end: string;
  fiscal_year_end: string;
  distribution_due_days: number;
  lead_fee_pct: number;
  lead_fee_base: "gross" | "net" | '';
  promo_fee_pct: number;
  consent_default: "unanimous" | "majority" | "lead_discretion" | "consult" | '';
  waterfall: WaterfallStep[] | null;
  currency: string;
  copyright_line: string;
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
  agreement: string;
}

export interface ConsentRequestRec extends RecordModel {
  committee: string;
  subject: string;
  use: unknown | null;
  agreement: string;
  product: string;
  requested_by: string;
  requested_date: string;
  due_date: string;
  answers: ConsentAnswer[] | null;
  status: "open" | "approved" | "refused" | "withdrawn" | "expired" | '';
  outcome_note: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface ContentIdAssetRec extends RecordModel {
  recording: string;
  song: string;
  asset_id: string;
  asset_type: "sound_recording" | "composition" | "music_video" | "art_track" | "web" | '';
  ownership: unknown | null;
  policy: "monetize" | "track" | "block" | '';
  administrator: string;
  status: "active" | "inactive" | "conflict" | '';
  notes: string;
  created: string;
  updated: string;
}

export interface ContentIdClaimRec extends RecordModel {
  direction: "incoming" | "outgoing" | '';
  video_url: string;
  video_title: string;
  channel: string;
  claimant: string;
  asset: string;
  recording: string;
  status: "open" | "disputed" | "appealed" | "released" | "upheld" | "expired" | "resolved" | '';
  received_date: string;
  dispute_received: string;
  appeal_received: string;
  reason: string;
  notes: string;
  created: string;
  updated: string;
}

export interface CustomsRecordationRec extends RecordModel {
  jurisdiction: "JP" | "US" | "CN" | "EU" | "KR" | "TW" | "other" | '';
  matter: string;
  right_desc: string;
  application_no: string;
  filed_date: string;
  accepted_date: string;
  valid_until: string;
  status: "preparing" | "filed" | "accepted" | "expired" | "withdrawn" | '';
  notes: string;
  created: string;
  updated: string;
}

export interface DeadlineRec extends RecordModel {
  matter: string;
  agreement: string;
  work: string;
  character: string;
  talent: string;
  product: string;
  approval: string;
  permission: string;
  committee: string;
  case_ref: string;
  registration: string;
  claim: string;
  recordation: string;
  society_contract: string;
  fan_registration: string;
  enrollment: string;
  title: string;
  title_ja: string;
  family: string;
  kind: "hard" | "extendable" | "designated" | "internal" | "reminder" | '';
  category: "prosecution" | "filing" | "renewal" | "opposition" | "use" | "term" | "agreement" | "copyright" | "committee" | "talent" | "playbook" | "licensing" | "approval" | "music" | "content_id" | "enforcement" | "customs" | "permission" | "guideline" | "other" | '';
  status: "open" | "done" | "not_needed" | "extended" | "missed" | "transferred" | "cancelled" | '';
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
  source: "rule" | "office" | "inbox" | "manual" | "agreement" | "system" | "playbook" | '';
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
  subject_type: string;
  ref: string;
  subject_label: string;
  citation: string;
  reminders_sent: string[] | null;
  notes: string;
  created: string;
  updated: string;
}

export interface DimensionValueRec extends RecordModel {
  dimension: string;
  code: string;
  label: string;
  label_ja: string;
  parent_code: string;
  order: number;
  classes: number[] | null;
  created: string;
  updated: string;
}

export interface DimensionRec extends RecordModel {
  key: string;
  label: string;
  label_ja: string;
  order: number;
  enabled: boolean;
  description: string;
  created: string;
  updated: string;
}

export interface DistributionRec extends RecordModel {
  committee: string;
  period_start: string;
  period_end: string;
  currency: string;
  receipts: DistributionReceipt[] | null;
  gross_total: number;
  deductions_total: number;
  window_fees: number;
  lead_fee: number;
  promo_fee: number;
  success_fee: number;
  pool: number;
  members: DistributionMember[] | null;
  status: "draft" | "issued" | "paid" | '';
  issued_date: string;
  due_date: string;
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface DocumentRec extends RecordModel {
  title: string;
  file: string;
  doc_type: "office_action" | "filing" | "receipt" | "certificate" | "correspondence" | "contract" | "style_guide" | "model_sheet" | "statement" | "invoice" | "evidence" | "specimen" | "chain_of_title" | "guideline_snapshot" | "customs" | "platform_notice" | "sample_photo" | "report" | "other" | '';
  doc_date: string;
  matter: string;
  family: string;
  agreement: string;
  work: string;
  franchise: string;
  character: string;
  talent: string;
  product: string;
  approval: string;
  committee: string;
  song: string;
  recording: string;
  permission: string;
  guideline: string;
  case_ref: string;
  source: "upload" | "office" | "email" | "agent" | "portal" | '';
  extracted: unknown | null;
  summary: string;
  uploaded_by: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface CaseRec extends RecordModel {
  ref: string;
  title: string;
  case_type: "counterfeit" | "impersonation" | "piracy" | "unauthorized_derivative" | "clip_violation" | "defamation" | "harassment" | "leak" | "ai_misuse" | "trademark_conflict" | "content_id" | "other" | '';
  forum: "marketplace" | "dmca" | "jp_platform" | "sender_disclosure" | "customs" | "criminal" | "cease_desist" | "litigation" | "coda" | "opposition" | "cancellation" | "invalidation" | "platform_report" | "other" | '';
  role: "offense" | "defense" | '';
  platform: string;
  urls: string[] | null;
  their_party: string;
  franchise: string;
  characters: string[];
  talents: string[];
  works: string[];
  matters: string[];
  status: "new" | "investigating" | "notice_sent" | "takedown_requested" | "removed" | "counter_noticed" | "disclosure_requested" | "complaint_filed" | "litigation" | "settled" | "won" | "lost" | "closed" | "monitoring" | '';
  opened_date: string;
  request_sent: string;
  counter_notice_date: string;
  settlement: unknown | null;
  outcome: string;
  counsel: string;
  assignee: string;
  draft_notice: string;
  notes: string;
  created: string;
  updated: string;
}

export interface EventRec extends RecordModel {
  matter: string;
  agreement: string;
  work: string;
  character: string;
  talent: string;
  product: string;
  approval: string;
  permission: string;
  committee: string;
  case_ref: string;
  registration: string;
  claim: string;
  recordation: string;
  society_contract: string;
  fan_registration: string;
  enrollment: string;
  code: string;
  label: string;
  label_ja: string;
  date: string;
  source: "manual" | "office" | "inbox" | "rule" | "system" | "portal" | '';
  document: string;
  data: Record<string, unknown> | null;
  created_by: string;
  created: string;
  updated: string;
}

export interface EvidenceRec extends RecordModel {
  case_ref: string;
  kind: "screenshot" | "page_archive" | "test_purchase" | "listing" | "video" | "document" | "other" | '';
  url: string;
  captured_at: string;
  file: string[];
  sha256: string;
  captured_by: string;
  preserve_until: string;
  chain_note: string;
  notes: string;
  created: string;
  updated: string;
}

export interface FamilyRec extends RecordModel {
  kind: "design" | "trademark" | '';
  title: string;
  franchise: string;
  character: string;
  talent: string;
  mark_type: "word" | "figurative" | "combined" | "three_d" | "colour" | "sound" | "motion" | "position" | "pattern" | "hologram" | "multimedia" | "other" | '';
  mark_image: string;
  word_element: string;
  name_variants: string[] | null;
  vienna_codes: string;
  disclaimer: string;
  transliteration: string;
  translation: string;
  description: string;
  products: string;
  strategy: "maintain" | "review" | "prune" | "abandoned" | '';
  strategy_note: string;
  owner_entity: string;
  announcement_date: string;
  tags: string[] | null;
  created: string;
  updated: string;
}

export interface FanRegistrationRec extends RecordModel {
  kind: "clip_channel" | "fan_permit" | "event_permit" | "fan_game" | "other" | '';
  permission_no: string;
  applicant_name: string;
  applicant_type: "individual" | "group" | "corporate" | '';
  contact: string;
  channel_url: string;
  platform: string;
  guideline: string;
  franchise: string;
  characters: string[];
  talents: string[];
  event_name: string;
  event_date: string;
  items: unknown | null;
  royalty_pct: number;
  seals_issued: number;
  seals_returned: number;
  monetized: boolean;
  monthly_revenue: number;
  status: "applied" | "approved" | "active" | "rejected" | "suspended" | "expired" | "revoked" | '';
  start_date: string;
  end_date: string;
  notes: string;
  created: string;
  updated: string;
}

export interface FeeRec extends RecordModel {
  office: string;
  ip_type: string;
  fee_kind: string;
  cycle: number;
  cycle_to: number;
  entity: "any" | "large" | "small" | "micro" | '';
  per_class: boolean;
  amount: number;
  per_claim_amount: number;
  class_tiers: unknown | null;
  currency: string;
  grace_surcharge: number;
  surcharge_percent: boolean;
  effective_from: string;
  source: string;
  notes: string;
  created: string;
  updated: string;
}

export interface FranchiseRec extends RecordModel {
  name: string;
  names: NameEntry[] | null;
  kind: "anime_title" | "original_character" | "vtuber_agency" | "vtuber_group" | "virtual_singer" | "game" | "music_project" | "mixed_media" | "other" | '';
  ownership_model: "committee" | "sole_owner" | "licensed_in" | "co_production" | "talent_owned" | '';
  status: "development" | "active" | "dormant" | "retired" | '';
  description: string;
  image: string;
  copyright_lines: CopyrightLine[] | null;
  style_guide_version: string;
  announcement_date: string;
  tags: string[] | null;
  created: string;
  updated: string;
  parent: string;
  original_work: string;
  committee: string;
}

export interface FxRateRec extends RecordModel {
  code: string;
  per_eur: number;
  as_of: string;
  source: "ecb" | "manual" | '';
  created: string;
  updated: string;
}

export interface GoodsServiceRec extends RecordModel {
  matter: string;
  nice_class: number;
  spec: string;
  class_status: "pending" | "registered" | "refused" | "partially_refused" | "deleted" | "cancelled" | '';
  first_use: string;
  first_use_commerce: string;
  in_use: boolean;
  use_evidence: string[];
  evidence_note: string;
  last_reviewed: string;
  created: string;
  updated: string;
}

export interface GrantRec extends RecordModel {
  agreement: string;
  direction: "in" | "out" | '';
  kind: "grant" | "holdback" | "restriction" | "reservation" | "window" | '';
  exclusive: boolean;
  holders: string[];
  holder_split: unknown | null;
  fee_pct: number;
  fee_base: "gross" | "net" | '';
  franchises: string[];
  works: string[];
  characters: string[];
  songs: string[];
  recordings: string[];
  matters: string[];
  dims: DimSpecMap | null;
  term_start: string;
  term_end: string;
  rights_text: string;
  override_reason: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface GuidelineRec extends RecordModel {
  title: string;
  kind: "fan_work" | "clip" | "cover_song" | "ai_use" | "doujin_event" | "corporate" | "other" | '';
  franchise: string;
  talent: string;
  characters: string[];
  version: string;
  effective_date: string;
  languages: string[] | null;
  body: string;
  body_ja: string;
  changelog: string;
  status: "draft" | "published" | "superseded" | '';
  url: string;
  template: boolean;
  created: string;
  updated: string;
  supersedes: string;
}

export interface IcsTokenRec extends RecordModel {
  user: string;
  token: string;
  scope: "mine" | "all" | '';
  created: string;
  updated: string;
}

export interface InboxItemRec extends RecordModel {
  kind: "office_change" | "document" | "agreement_draft" | "royalty_statement" | "permission" | "watch_hit" | "agent_proposal" | "email" | '';
  title: string;
  summary: string;
  status: "new" | "accepted" | "partially_accepted" | "rejected" | "awaiting_second" | '';
  subject_type: string;
  matter: string;
  agreement: string;
  work: string;
  character: string;
  talent: string;
  product: string;
  permission: string;
  committee: string;
  case_ref: string;
  document: string;
  office: string;
  proposal: Record<string, unknown> | null;
  diffs: Record<string, unknown>[] | null;
  confidence: "high" | "medium" | "low" | "none" | '';
  citations: Citation[] | null;
  source: "office_sync" | "agent" | "email" | "user" | "portal" | '';
  proposed_by: string;
  decided_by: string;
  decided_at: string;
  first_approver: string;
  first_approved_at: string;
  requires_second: boolean;
  note: string;
  fingerprint: string;
  created: string;
  updated: string;
}

export interface InvolvementRec extends RecordModel {
  party: string;
  role: "original_author" | "author" | "illustrator" | "modeler" | "composer" | "lyricist" | "arranger" | "publisher" | "label" | "producer" | "director" | "screenwriter" | "voice_actor" | "performer" | "singer" | "owner" | "applicant" | "licensee" | "licensor" | "agent" | "committee_member" | "counsel" | "contributor" | "other" | '';
  matter: string;
  agreement: string;
  work: string;
  character: string;
  song: string;
  recording: string;
  family: string;
  share: number;
  shares: unknown | null;
  credit_name: string;
  featured: boolean;
  note: string;
  created: string;
  updated: string;
}

export interface MatterRec extends RecordModel {
  ref: string;
  ip_type: "trademark" | "design" | '';
  title: string;
  family: string;
  franchise: string;
  character: string;
  talent: string;
  work: string;
  jurisdiction: string;
  route: "national" | "regional" | "madrid" | "hague" | "designation" | "other" | '';
  relation: "none" | "priority" | "designation" | "divisional" | "conversion" | "related" | '';
  application_no: string;
  filing_date: string;
  publication_no: string;
  publication_date: string;
  registration_no: string;
  registration_date: string;
  expiry_date: string;
  expiry_override: boolean;
  priority_claims: PriorityClaim[] | null;
  status: "to_file" | "filed" | "published" | "examination" | "office_action" | "allowed" | "opposed" | "registered" | "in_grace" | "lapsed" | "abandoned" | "withdrawn" | "refused" | "expired" | "revoked" | "cancelled" | "transferred_out" | '';
  status_group: "pre_filing" | "pending" | "live" | "dead" | '';
  office_status: string;
  status_date: string;
  tm_basis: string;
  tm_register: "principal" | "supplemental" | "na" | '';
  owner_of_record: string;
  applicants: string;
  counsel: string;
  client_ref: string;
  cost_center: string;
  responsible: string;
  docketer: string;
  sync_source: "none" | "uspto_tsdr" | "euipo" | "jpo" | '';
  sync_enabled: boolean;
  sync_state: "not_connected" | "connected" | "error" | "not_found" | '';
  last_synced: string;
  sync_error: string;
  official_data: unknown | null;
  next_deadline: string;
  next_deadline_title: string;
  next_deadline_title_ja: string;
  private_owner: boolean;
  announcement_date: string;
  last_use_evidence: string;
  options: unknown | null;
  tags: string[] | null;
  notes: string;
  created: string;
  updated: string;
  parent: string;
}

export interface NotificationRec extends RecordModel {
  user: string;
  kind: "digest" | "escalation" | "inbox" | "sync" | "assignment" | "approval" | "consent" | "portal" | "info" | '';
  title: string;
  body: string;
  link: string;
  read: boolean;
  data: Record<string, unknown> | null;
  created: string;
  updated: string;
}

export interface OfficeCalendarRec extends RecordModel {
  office: string;
  date: string;
  name: string;
  source: "computed" | "official" | "manual" | '';
  working_day: boolean;
  created: string;
  updated: string;
}

export interface OfficeConnectionRec extends RecordModel {
  office: "uspto_tsdr" | "euipo" | "jpo" | '';
  enabled: boolean;
  sandbox: boolean;
  api_key: string;
  client_id: string;
  client_secret: string;
  username: string;
  token: string;
  token_expires: string;
  has_secret: boolean;
  status: "not_configured" | "connected" | "error" | "paused" | '';
  last_check: string;
  last_error: string;
  calls_today: number;
  calls_date: string;
  remaining_calls: number;
  last_sync: string;
  notes: string;
  created: string;
  updated: string;
}

export interface PartyRec extends RecordModel {
  name: string;
  name_kana: string;
  kind: "person" | "organization" | '';
  roles: string[] | null;
  aliases: string[] | null;
  email: string;
  phone: string;
  organization: string;
  country: string;
  address: string;
  external_ref: string;
  ipi: string;
  society: string;
  notes: string;
  user: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface PermissionRec extends RecordModel {
  title: string;
  permission_type: "game_title" | "music_work" | "master" | "backing_track" | "arrangement" | "platform_blanket" | "brand_tieup" | "cross_agency_collab" | "venue" | "other" | '';
  counterparty: string;
  subject_name: string;
  source: "public_guideline" | "contract" | "application" | '';
  guideline_url: string;
  guideline_revision: string;
  approval_id: string;
  agreement: string;
  all_talents: boolean;
  talents: string[];
  characters: string[];
  platforms: string[] | null;
  monetization: string[] | null;
  archive: "yes" | "live_only" | "no" | '';
  content_limits: string;
  credit_line: string;
  regions: string;
  start_date: string;
  end_date: string;
  status: "active" | "pending_application" | "expired" | "revoked" | "suspended" | '';
  recheck_days: number;
  last_checked: string;
  notes: string;
  created: string;
  updated: string;
  snapshot: string;
}

export interface PlatformEnrollmentRec extends RecordModel {
  platform: "amazon_brand_registry" | "mercari" | "alibaba_ipp" | "aidc_ipp" | "ebay_vero" | "rakuten" | "yahoo_auctions" | "youtube" | "x" | "tiktok" | "other" | '';
  account_id: string;
  status: "not_enrolled" | "applying" | "active" | "suspended" | "expired" | '';
  enrolled_date: string;
  documents_valid_until: string;
  requests_sent: number;
  success_rate: number;
  counter_notice_rate: number;
  notes: string;
  created: string;
  updated: string;
}

export interface ProductRec extends RecordModel {
  ref: string;
  name: string;
  sku: string;
  jan: string;
  agreement: string;
  licensee: string;
  franchise: string;
  work: string;
  characters: string[];
  talents: string[];
  category: string;
  channel: string;
  occasion: "regular" | "birthday" | "anniversary" | "graduation" | "event" | "collab" | "campaign" | '';
  sales_start: string;
  sales_end: string;
  timezone: string;
  sales_model: "stock" | "made_to_order" | "preorder" | "lottery" | "gacha" | "prize" | '';
  ship_by: string;
  retail_price: number;
  currency: string;
  digital: boolean;
  digital_end: string;
  includes_voice: boolean;
  regions: string;
  stage: "proposal" | "contract" | "concept" | "design" | "prototype" | "final_sample" | "packaging" | "mass_production" | "on_sale" | "sell_off" | "ended" | "cancelled" | '';
  sell_off_end: string;
  images: string[];
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface RecordingRec extends RecordModel {
  title: string;
  song: string;
  songs: string[];
  song_shares: unknown | null;
  isrc: string;
  version_type: "studio" | "tv_size" | "instrumental" | "a_cappella" | "live" | "remix" | "cover" | "music_video" | "other" | '';
  duration_sec: number;
  recording_date: string;
  p_line: string;
  master_owners: unknown | null;
  virtual_singer: boolean;
  virtual_singer_note: string;
  captured_in_av: boolean;
  sound_only_consent: boolean;
  consent_note: string;
  talents: string[];
  characters: string[];
  status: "draft" | "mixing" | "mastered" | "released" | "archived" | '';
  notes: string;
  created: string;
  updated: string;
  parent: string;
}

export interface ReleaseRec extends RecordModel {
  title: string;
  upc: string;
  catalogue_no: string;
  format: "digital_single" | "digital_album" | "cd_single" | "cd_album" | "vinyl" | "bluray_bundle" | "other" | '';
  label: string;
  distributor: string;
  release_date: string;
  territories: string[] | null;
  tracks: unknown | null;
  recordings: string[];
  status: "planned" | "scheduled" | "released" | "withdrawn" | '';
  notes: string;
  created: string;
  updated: string;
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
  decision: "pending" | "renew" | "renew_partial" | "lapse" | "defer" | '';
  decided_by: string;
  decided_at: string;
  rationale: string;
  classes_keep: number[] | null;
  instruction_status: "not_instructed" | "instructed" | "paid" | "confirmed" | "lapsed" | '';
  instructed_at: string;
  provider: string;
  po_number: string;
  paid_date: string;
  paid_amount: number;
  receipt: string;
  created: string;
  updated: string;
}

export interface RoyaltyLineRec extends RecordModel {
  report: string;
  product: string;
  description: string;
  territory: string;
  manufactured_qty: number;
  sold_qty: number;
  retail_price: number;
  wholesale_price: number;
  rate: number;
  royalty: number;
  currency: string;
  notes: string;
  created: string;
  updated: string;
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
  mg_credit: number;
  late_interest: number;
  currency: string;
  status: "expected" | "received" | "paid" | "disputed" | "waived" | '';
  document: string;
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface RuleRec extends RecordModel {
  code: string;
  name: string;
  name_ja: string;
  subject_type: string;
  jurisdiction: string;
  routes: string[] | null;
  trigger_event: string;
  conditions: Record<string, unknown> | null;
  base: "event_date" | "filing_date" | "priority_date" | "publication_date" | "registration_date" | "expiry_date" | "signed_date" | "term_end" | "graduation_date" | "debut_date" | "valid_until" | "end_date" | "documents_valid_until" | '';
  offset_years: number;
  offset_months: number;
  offset_days: number;
  offset_unit: "calendar" | "business" | '';
  due_end_of_month: boolean;
  kind: "hard" | "extendable" | "designated" | "internal" | "reminder" | '';
  category: "prosecution" | "filing" | "renewal" | "opposition" | "use" | "term" | "agreement" | "copyright" | "committee" | "talent" | "playbook" | "licensing" | "approval" | "music" | "content_id" | "enforcement" | "customs" | "permission" | "guideline" | "other" | '';
  title: string;
  title_ja: string;
  extensions: RuleExtension[] | null;
  final_offset_months: number;
  final_offset_days: number;
  window_months: number;
  grace_months: number;
  grace_note: string;
  recurring_years: number;
  recurring_until_years: number;
  recurring_first_cycle: number;
  cycle_label: string;
  roll_office: string;
  citation: string;
  summary: string;
  summary_ja: string;
  notes: string;
  effective_from: string;
  effective_to: string;
  version: number;
  enabled: boolean;
  system: boolean;
  creates_renewal: boolean;
  fee_kind: string;
  created: string;
  updated: string;
}

export interface SavedViewRec extends RecordModel {
  name: string;
  page: string;
  filters: Record<string, unknown> | null;
  columns: string[] | null;
  scope: "private" | "shared" | '';
  owner: string;
  schedule: "none" | "daily" | "weekly" | "monthly" | '';
  last_sent: string;
  created: string;
  updated: string;
}

export interface SealOrderRec extends RecordModel {
  agreement: string;
  product: string;
  licensee: string;
  quantity: number;
  serial_from: string;
  serial_to: string;
  unit_cost: number;
  currency: string;
  ordered_date: string;
  issued_date: string;
  used: number;
  void: number;
  returned: number;
  status: "requested" | "issued" | "reconciled" | "cancelled" | '';
  notes: string;
  portal_users: string[];
  created: string;
  updated: string;
}

export interface SettingsRec extends RecordModel {
  org_name: string;
  profiles: Profile[] | null;
  modules: Partial<Record<ModuleKey, boolean>> | null;
  default_language: "en" | "ja" | '';
  home_currency: string;
  work_calendar: string;
  target_buffer_days: number;
  reminder_days: number[] | null;
  digest_enabled: boolean;
  digest_hour: number;
  digest_channel: "in_app" | "email" | "slack" | '';
  slack_channel: string;
  second_reviewer: boolean;
  renewal_default: "renew" | "lapse" | "decide" | '';
  default_signup_role: "manager" | "rights" | "licensing" | "talent_manager" | "contributor" | "viewer" | '';
  jurisdictions: string[] | null;
  approval_stages: StageTemplate[] | null;
  approval_sla_days: number;
  leak_lag_days: number;
  ref_prefix_trademark: string;
  ref_prefix_design: string;
  ref_prefix_agreement: string;
  ref_prefix_product: string;
  ref_prefix_case: string;
  ref_prefix_permit: string;
  onboarding_done: boolean;
  fx_auto: boolean;
  fx_updated: string;
  sync_enabled: boolean;
  sync_hour: number;
  last_digest: string;
  last_sweep: string;
  created: string;
  updated: string;
}

export interface SocietyContractRec extends RecordModel {
  society: "jasrac" | "nextone" | "self" | "other" | '';
  model: "trust_all" | "per_work" | '';
  member_no: string;
  our_entity: string;
  scope: unknown | null;
  term_start: string;
  term_end: string;
  renewal_years: number;
  auto_renew: boolean;
  notes: string;
  created: string;
  updated: string;
}

export interface SocietyRegistrationRec extends RecordModel {
  song: string;
  society: "jasrac" | "nextone" | "self" | "other" | '';
  status: "draft" | "submitted" | "code_issued" | "registered" | "disputed" | "withheld" | '';
  work_code: string;
  submitted_date: string;
  registered_date: string;
  shares: unknown | null;
  reservations: unknown | null;
  notes: string;
  created: string;
  updated: string;
}

export interface SongRec extends RecordModel {
  title: string;
  names: NameEntry[] | null;
  iswc: string;
  work_codes: Record<string, string> | null;
  lyrics_language: string;
  original: boolean;
  franchise: string;
  work: string;
  characters: string[];
  tie_up_use: "none" | "opening" | "ending" | "insert" | "theme" | "character_song" | "bgm" | "other" | '';
  first_publication: string;
  copyright_line: string;
  fan_cover_allowed: boolean;
  fan_cover_note: string;
  status: "draft" | "splits_pending" | "registered" | "released" | "archived" | '';
  notes: string;
  created: string;
  updated: string;
  parent: string;
}

export interface SyncRunRec extends RecordModel {
  office: string;
  trigger: "scheduled" | "manual" | "import" | '';
  status: "running" | "ok" | "partial" | "error" | "skipped" | '';
  checked: number;
  changes: number;
  errors: number;
  message: string;
  finished: string;
  created: string;
  updated: string;
}

export interface TalentIdentityRec extends RecordModel {
  talent: string;
  legal_name: string;
  legal_name_kana: string;
  birth_date: string;
  email: string;
  phone: string;
  address: string;
  emergency_contact: string;
  payment_note: string;
  notes: string;
  created: string;
  updated: string;
}

export interface TalentRec extends RecordModel {
  stage_name: string;
  names: NameEntry[] | null;
  talent_type: "vtuber" | "voice_actor" | "singer" | "actor" | "producer" | "other" | '';
  affiliation: "ours" | "external" | '';
  agency: string;
  party: string;
  lifecycle: "audition" | "pre_debut" | "active" | "hiatus" | "suspended" | "graduation_announced" | "graduated" | "terminated" | "alumni" | '';
  debut_date: string;
  graduation_date: string;
  birthday: string;
  managers: string[];
  revenue_share: RevenueShare[] | null;
  channels: TalentChannel[] | null;
  image: string;
  profile: string;
  privacy_class: "public" | "restricted" | '';
  notes: string;
  created: string;
  updated: string;
}

export interface TitleRec extends RecordModel {
  title: string;
  names: NameEntry[] | null;
  title_type: "series" | "season" | "episode" | "film" | "ova" | "special" | "short" | "original_manga" | "original_novel" | "game" | "stage_play" | "event" | "stream" | "stream_archive" | "music_video" | "voice_product" | "book" | "illustration" | "other" | '';
  franchise: string;
  rights_basis: "owned" | "committee" | "acquired" | "licensed_in" | "mixed" | '';
  status: "development" | "production" | "announced" | "released" | "archived" | '';
  description: string;
  creation_date: string;
  publication_date: string;
  publication_country: string;
  episode_number: number;
  external_ids: ExternalId[] | null;
  made_for_hire: boolean;
  authors: string;
  author_death_year: number;
  author_kind: "individual" | "joint" | "corporate" | "anonymous" | "film" | '';
  language: string;
  image: string;
  announcement_date: string;
  tags: string[] | null;
  notes: string;
  created: string;
  updated: string;
  parent: string;
  committee: string;
}

export interface UserRec extends RecordModel {
  email: string;
  emailVisibility: boolean;
  verified: boolean;
  name: string;
  avatar: string;
  created: string;
  updated: string;
  role: "admin" | "manager" | "rights" | "licensing" | "talent_manager" | "contributor" | "viewer" | "licensee" | "committee_member" | "reviewer" | '';
  job_title: string;
  digest_opt_out: boolean;
  ui_language: "en" | "ja" | '';
}

export interface WatchHitRec extends RecordModel {
  kind: "trademark" | "marketplace" | "impersonation" | "web" | '';
  family: string;
  matter: string;
  character: string;
  talent: string;
  case_ref: string;
  their_mark: string;
  their_owner: string;
  url: string;
  jurisdiction: string;
  application_no: string;
  classes: string;
  goods: string;
  publication_date: string;
  opposition_deadline: string;
  score: number;
  status: "new" | "reviewing" | "dismissed" | "monitor" | "escalated" | "actioned" | '';
  action: string;
  source: string;
  reviewer: string;
  decided_at: string;
  notes: string;
  created: string;
  updated: string;
}

/** Shapes of the hiring operations' answers (pb_hooks/lib_hiring*.js). */
import type { AgentAsk } from '../../components/agent.tsx';

export type Access = 'all' | 'team' | 'interviewer' | '';
export type StageKind = 'applied' | 'screen' | 'interview' | 'offer' | 'hired' | 'other';
export type Recommendation = 'strong_no' | 'no' | 'yes' | 'strong_yes';

export interface Stage {
  key: string;
  name: string;
  kind: StageKind;
  kit?: string | undefined;
  kit_name?: string | undefined;
  count?: number | undefined;
}

export interface Issue {
  code: string;
  severity: 'warning' | 'blocker';
  message: string;
  field?: string | undefined;
}

export interface MemberBrief {
  id: string;
  name: string;
}

export interface Opening {
  id: string;
  number: string;
  requisition: string;
  requisition_number: string;
  entity: string;
  entity_name: string;
  entity_country: string;
  department: string;
  department_name: string;
  title: string;
  job_title: string;
  job_title_name: string;
  location: string;
  location_name: string;
  location_text: string;
  country: string;
  region: string;
  remote: 'onsite' | 'hybrid' | 'remote';
  employment_type: string;
  employment_type_name: string;
  currency: string;
  salary_min_minor: number;
  salary_max_minor: number;
  salary_min: string;
  salary_max: string;
  pay_per: string;
  pay_text: string;
  show_pay: boolean;
  pay_rule: { basis: string; when: 'posting' | 'before_interview' } | null;
  issues: Issue[];
  status: 'draft' | 'open' | 'on_hold' | 'closed';
  positions: number;
  hired: number;
  active: number;
  rejected: number;
  withdrawn: number;
  stages: Stage[];
  opened_at: string;
  closed_at: string;
  close_reason: string;
  hiring_manager: string;
  hiring_manager_name: string;
  owner: string;
  owner_name: string;
  team: MemberBrief[];
  /** Your AI agent asked to draft the post (job_post_draft), or null. */
  agent: AgentAsk | null;
  access: Access;
  can: { edit: boolean; publish: boolean; add: boolean };
  created: string;
  updated: string;
  description?: string | undefined;
  kits?: Kit[] | undefined;
}

export interface Kit {
  id: string;
  name: string;
  opening: string;
  kind: string;
  duration_min: number;
  criteria: { key: string; name: string; description: string }[];
  questions: { key: string; text: string; criterion: string; guidance: string }[];
  archived: boolean;
}

export interface BoardCard {
  application: string;
  candidate: string;
  name: string;
  current_title: string;
  current_company: string;
  stage: string;
  status: string;
  since: string;
  days_in_stage: number;
  applied_at: string;
  source: string;
  referred: boolean;
  has_resume: boolean;
  tags: string[];
  next_interview: string;
  scorecards: { submitted: number; total: number };
  offer: string;
  reason: string;
  closed_at: string;
}

export interface Board {
  opening: Opening;
  columns: { key: string; name: string; kind: StageKind; cards: BoardCard[] }[];
  closed: BoardCard[];
  totals: { active: number; hired: number; rejected: number; withdrawn: number };
}

export interface Candidate {
  id: string;
  name: string;
  location: string;
  current_title: string;
  current_company: string;
  links: { label: string; url: string }[];
  tags: string[];
  has_resume: boolean;
  resume_name: string;
  employee: string;
  employee_number: string;
  access: Access;
  created: string;
  email?: string | undefined;
  phone?: string | undefined;
  source?: string | undefined;
  source_detail?: string | undefined;
  consent?: boolean | undefined;
  consent_at?: string | undefined;
  country?: string | undefined;
  retain_until?: string | undefined;
  past_retention?: boolean | undefined;
  notes?: string | undefined;
  owner?: string | undefined;
  owner_name?: string | undefined;
  created_actor?: string | undefined;
  applications?: { id: string; status: string; stage: string; stage_name: string; opening: string; opening_number: string; opening_title: string }[] | undefined;
}

export interface Scorecard {
  id: string;
  interview: string;
  interviewer: string;
  interviewer_name: string;
  recommendation: Recommendation | '';
  scores: Record<string, number>;
  notes: string;
  status: 'pending' | 'draft' | 'submitted';
  submitted_at: string;
  updated: string;
}

export interface ScorecardSet {
  mine: Scorecard | null;
  others: Scorecard[];
  hidden: number;
  submitted: number;
  total: number;
  can_see_others: boolean;
}

export interface Interview {
  id: string;
  application: string;
  opening: string;
  opening_number: string;
  opening_title: string;
  entity: string;
  candidate: string;
  candidate_name: string;
  stage: string;
  stage_name: string;
  kind: string;
  title: string;
  kit: string;
  kit_name: string;
  day: string;
  start: string;
  timezone: string;
  at: string;
  end_at: string;
  duration_min: number;
  interviewers: { id: string; name: string; scorecard: string }[];
  location: string;
  link: string;
  status: 'scheduled' | 'done' | 'cancelled' | 'no_show';
  note: string;
  calendar_event: string;
  calendar_link: string;
  mine: boolean;
  my_scorecard: string;
  scorecards: { submitted: number; total: number };
  summary: string;
  summary_at: string;
  summary_actor: string;
  access: Access;
  scheduled_by_name: string;
  created: string;
  scorecard?: ScorecardSet | undefined;
  kit_detail?: Kit | null | undefined;
  /** Your AI agent asked for a summary (interview_summary), or null. */
  agent?: AgentAsk | null | undefined;
  can?: { edit: boolean; scorecard: boolean; summarize: boolean; calendar: boolean } | undefined;
}

export interface Offer {
  id: string;
  number: string;
  application: string;
  opening: string;
  opening_number: string;
  opening_title: string;
  candidate: string;
  candidate_name: string;
  candidate_email: string;
  entity: string;
  entity_name: string;
  country: string;
  title: string;
  department: string;
  department_name: string;
  location: string;
  location_name: string;
  employment_type: string;
  employment_type_name: string;
  start_day: string;
  pay_basis: 'salary' | 'hourly' | 'daily';
  pay_per: string;
  currency: string;
  amount_minor: number | null;
  amount: string;
  pay_text: string;
  components: { name: string; amount_minor: number; amount: string; per: string; note: string; text: string }[];
  terms: { term: string; title: string; text: string }[];
  template: string;
  template_name: string;
  letter_frozen: boolean;
  status: 'draft' | 'pending' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn';
  approval: string;
  approval_status: string;
  approval_note: string;
  expires_day: string;
  sent_at: string;
  responded_at: string;
  decline_reason: string;
  note: string;
  employment: string;
  employment_number: string;
  created_by_name: string;
  issues: Issue[];
  access: Access;
  can: { edit: boolean; submit: boolean; send: boolean; respond: boolean; withdraw: boolean; hire: boolean };
  letter?: string | undefined;
  hire?: HireDraft | null | undefined;
}

export type HireDraft = Record<string, string>;

export interface Application {
  id: string;
  opening: string;
  opening_number: string;
  opening_title: string;
  opening_status: string;
  entity: string;
  candidate: string;
  candidate_name: string;
  stage: string;
  stage_name: string;
  stage_kind: StageKind | '';
  stage_since: string;
  stages: Stage[];
  status: 'active' | 'hired' | 'rejected' | 'withdrawn';
  rejected_reason: string;
  rejected_reason_name: string;
  closed_note: string;
  closed_at: string;
  closed_by_name: string;
  owner: string;
  owner_name: string;
  applied_at: string;
  source: string;
  referral: string;
  hired_employment: string;
  hired_at: string;
  access: Access;
  can: { move: boolean; reopen: boolean };
  interviews?: Interview[] | undefined;
  offers?: Offer[] | undefined;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  application: string;
  from_stage: string;
  to_stage: string;
  subject: string;
  text: string;
  actor: string;
  who: string;
  delivery: string;
  to_email: string;
  ref: string;
  day: string;
  start: string;
  zone: string;
  at: string;
}

export interface CandidateProfile {
  candidate: Candidate;
  applications: Application[];
  timeline: TimelineEvent[];
  referral: { id: string; referrer_name: string; relationship: string; note: string; created: string } | null;
  can: { edit: boolean; delete: boolean; add_to_opening: boolean; note: boolean };
}

export interface Requisition {
  id: string;
  number: string;
  entity: string;
  entity_name: string;
  department: string;
  department_name: string;
  plan_line: string;
  plan: { id: string; name: string } | null;
  title: string;
  job_title: string;
  job_title_name: string;
  headcount: number;
  reason: 'new_role' | 'replacement' | 'growth';
  replaces: string;
  replaces_name: string;
  employment_type: string;
  employment_type_name: string;
  location: string;
  location_name: string;
  remote: string;
  currency: string;
  budget_minor: number | null;
  budget: string;
  pay_min_minor: number | null;
  pay_max_minor: number | null;
  pay_min: string;
  pay_max: string;
  pay_per: string;
  hiring_manager: string;
  hiring_manager_name: string;
  target_start_day: string;
  justification: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'filled' | 'closed';
  approval: string;
  approval_status: string;
  requested_by: string;
  requested_by_name: string;
  decided_note: string;
  closed_reason: string;
  closed_at: string;
  openings: { id: string; number: string; title: string; status: string; positions: number }[];
  hired: number;
  access: Access;
  can: { edit: boolean; submit: boolean; open: boolean; close: boolean };
  created: string;
  updated: string;
}

export interface PlanLine {
  id: string;
  plan: string;
  department: string;
  department_name: string;
  job_title: string;
  job_title_name: string;
  title: string;
  planned: number;
  current: number;
  requested: number;
  hired: number;
  gap: number;
  budget_minor: number | null;
  budget: string;
  note: string;
  sort: number;
}

export interface Plan {
  id: string;
  entity: string;
  entity_name: string;
  name: string;
  from_day: string;
  to_day: string;
  currency: string;
  status: 'draft' | 'active' | 'closed';
  note: string;
  totals: { planned: number; current: number; requested: number; hired: number; gap: number; budget_minor: number | null };
  lines?: PlanLine[] | undefined;
  line_count: number;
}

export interface Referral {
  id: string;
  opening: string;
  opening_title: string;
  opening_number: string;
  name: string;
  email: string;
  relationship: string;
  note: string;
  status: 'submitted' | 'in_process' | 'hired' | 'not_selected' | 'withdrawn';
  created: string;
  candidate?: string | undefined;
  application?: string | undefined;
  referrer_name?: string | undefined;
}

export interface OpenRole {
  id: string;
  number: string;
  title: string;
  entity_name: string;
  department_name: string;
  location: string;
  remote: string;
  employment_type_name: string;
  description: string;
  currency: string;
  salary_min_minor: number | null;
  salary_max_minor: number | null;
  pay_per: string;
  opened_at: string;
}

export interface HiringHome {
  level: 'none' | 'view' | 'edit' | 'full';
  broad: boolean;
  today: string;
  openings: { id: string; number: string; title: string; entity: string; entity_name: string; status: string; positions: number; hired: number; opened_at: string; active: number; stages: Stage[] }[];
  interviews_today: Interview[];
  interviews_week: Interview[];
  feedback_owed: Owed[];
  offers_waiting: HomeOffer[];
  ready_to_hire: HomeOffer[];
  requisitions_waiting: { id: string; number: string; title: string; status: string; headcount: number; entity_name: string }[];
  retention_due: number;
  referrals: number;
  can: { hire: boolean; edit: boolean; full: boolean };
}

export interface HomeOffer {
  id: string;
  status: string;
  title: string;
  start_day: string;
  expires_day: string;
  application: string;
  candidate_name: string;
  candidate: string;
  employment: string;
  approval: string;
}

export interface Owed {
  scorecard: string;
  status: string;
  interview: string;
  at: string;
  day: string;
  start: string;
  timezone: string;
  title: string;
  candidate: string;
  candidate_name: string;
  opening_title: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  title: string;
  role: string;
  employee_number: string;
}

export interface Reason {
  id: string;
  name: string;
  kind: 'company' | 'candidate';
  subject: string;
  message: string;
  sort: number;
  archived: boolean;
}

export interface Term {
  id: string;
  title: string;
  text: string;
  category: string;
  sort: number;
  archived: boolean;
}

export interface Template {
  id: string;
  name: string;
  entity: string;
  entity_name: string;
  body: string;
  is_default: boolean;
  archived: boolean;
}

export interface Settings {
  default_stages: Stage[];
  stage_kinds: StageKind[];
  retention: { default_days: number; consent_days: number; countries: { country: string; days: number; basis: string }[]; other_basis: string };
  email_candidates: boolean;
  rejection_reasons: Reason[];
  offer_terms: Term[];
  offer_templates: Template[];
  placeholders: { offer: string[]; message: string[] };
  sample: { company: string; entity: string; entity_legal_name: string; country: string; currency: string };
  calendar: { connected: boolean; reason: string };
  can_edit: boolean;
}

/** The collections hiring views read (for live reloads). */
export const READS = ['openings', 'applications', 'candidates', 'interviews', 'interview_feedback', 'offers', 'requisitions', 'referrals', 'hiring_events', 'staffing_plans', 'staffing_plan_lines', 'interview_kits', 'hiring_config', 'rejection_reasons', 'offer_terms', 'offer_templates', 'approvals'];

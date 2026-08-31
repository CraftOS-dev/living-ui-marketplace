/**
 * Record shapes (PB collections) + shared unions. Enums mirror the migration's
 * select fields exactly, values are typed, never matched from free text.
 */
import type { RecordModel } from 'pocketbase';

export type Stage = 'validate' | 'setup' | 'first_customers' | 'grow' | 'scale';
export const STAGES: readonly Stage[] = ['validate', 'setup', 'first_customers', 'grow', 'scale'];
export const STAGE_LABELS: Record<Stage, string> = {
  validate: 'Validate',
  setup: 'Set Up',
  first_customers: 'First Customers',
  grow: 'Grow',
  scale: 'Scale',
};

export type ModuleKey =
  | 'customers'
  | 'money'
  | 'kanban'
  | 'goals'
  | 'team'
  | 'meetings'
  | 'processes'
  | 'marketing';

export type CompanyType =
  | 'services'
  | 'retail_ecommerce'
  | 'food_hospitality'
  | 'software_digital'
  | 'other';

export type TeamSize = 'solo' | 'two_five' | 'six_fifteen' | 'sixteen_fifty' | 'fifty_plus';

export interface Vocab {
  customer_one: string;
  customer_many: string;
  pipeline: string[];
  project_word: string;
}

export const DEFAULT_VOCAB: Vocab = {
  customer_one: 'Customer',
  customer_many: 'Customers',
  pipeline: ['Lead', 'Active', 'Past'],
  project_word: 'Project',
};

export interface Company extends RecordModel {
  name: string;
  what_it_does: string;
  company_type: CompanyType;
  stage: Stage;
  team_size: TeamSize;
  focus: string[] | null;
  vocab: Vocab | null;
  onboarding_done: boolean;
  owner: string;
  mission: string;
  who_we_serve: string;
  offer: string;
  how_money: string;
  values_list: string[] | null;
  three_year_picture: string;
  year_goals: string;
  cash_on_hand: number;
}

export interface ModuleRow extends RecordModel {
  key: ModuleKey;
  active: boolean;
  suggested: boolean;
}

export interface JourneyStep extends RecordModel {
  stage: Stage;
  order: number;
  title: string;
  why: string;
  kind: 'module' | 'attest' | 'form';
  module_key: string;
  auto_rule: string;
  status: 'open' | 'done';
  done_at: string;
  auto_done: boolean;
}

export interface Suggestion extends RecordModel {
  kind: 'stage_advance' | 'module_unlock' | 'follow_up' | 'runway' | 'info';
  title: string;
  body: string;
  payload: { stage?: Stage; module?: ModuleKey; count?: number; months?: number } | null;
  status: 'open' | 'accepted' | 'dismissed';
}

export interface Customer extends RecordModel {
  name: string;
  is_org: boolean;
  pipeline_stage: string;
  email: string;
  phone: string;
  value: number;
  follow_up: string;
  note: string;
}

export interface MoneyEntry extends RecordModel {
  kind: 'in' | 'out';
  amount: number;
  category: string;
  note: string;
  date: string;
}

export interface Invoice extends RecordModel {
  number: string;
  customer: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid';
  issued: string;
  due: string;
  recorded: boolean;
  note: string;
}

export type CardStatus = 'todo' | 'doing' | 'done';

export interface ChecklistItem {
  text: string;
  /** Same three states as a card: not started, in progress, done. */
  state: CardStatus;
}

/** A Kanban board card (the `kanban_cards` collection). */
export interface KanbanCard extends RecordModel {
  title: string;
  status: CardStatus;
  due: string;
  note: string;
  owner: string;
  checklist: ChecklistItem[] | null;
  attachments: string[];
  order: number;
}

export interface Goal extends RecordModel {
  title: string;
  year: number;
  measure: string;
  status: 'active' | 'reached' | 'dropped';
}

export interface Priority extends RecordModel {
  title: string;
  quarter: string;
  owner_member: string;
  status: 'on_track' | 'at_risk' | 'done';
  note: string;
}

export interface Metric extends RecordModel {
  name: string;
  owner_member: string;
  goal: number;
  unit: string;
  direction: 'up' | 'down';
  order: number;
  active: boolean;
}

export interface MetricEntry extends RecordModel {
  metric: string;
  week_start: string;
  value: number;
}

export interface TeamMember extends RecordModel {
  name: string;
  email: string;
  note: string;
  active: boolean;
}

export type AccessRole = 'owner' | 'admin' | 'member' | '';

/** A login account (the `users` auth collection) — access control, not the
 *  team_members directory. Only the owner/admin can list these. */
export interface UserAccount extends RecordModel {
  email: string;
  name: string;
  role: AccessRole;
  approved: boolean;
  verified: boolean;
}

export interface Seat extends RecordModel {
  name: string;
  responsibilities: string[] | null;
  accountable: string;
}

export interface Candidate extends RecordModel {
  name: string;
  seat: string;
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'passed';
  note: string;
}

export interface Process extends RecordModel {
  name: string;
  category: string;
  owner_member: string;
  steps: string[] | null;
}

export interface Meeting extends RecordModel {
  name: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  agenda: string[] | null;
}

export interface MeetingNote extends RecordModel {
  meeting: string;
  date: string;
  notes: string;
  decisions: string;
}

export interface Issue extends RecordModel {
  title: string;
  detail: string;
  status: 'open' | 'solved';
  solution: string;
}

export interface Channel extends RecordModel {
  name: string;
  monthly_cost: number;
  note: string;
  active: boolean;
}

/** Funnel goal a campaign works on (plain-language labels live in the UI). */
export type CampaignGoal = 'awareness' | 'leads' | 'sales' | 'loyalty';
export const CAMPAIGN_GOALS: readonly CampaignGoal[] = ['awareness', 'leads', 'sales', 'loyalty'];
export type CampaignStatus = 'planned' | 'active' | 'paused' | 'done';

export interface Campaign extends RecordModel {
  name: string;
  goal: CampaignGoal;
  status: CampaignStatus;
  channel: string;
  start: string;
  end: string;
  budget: number;
  spend: number;
  target: number;
  result: number;
  note: string;
}

export type ContentStatus = 'idea' | 'draft' | 'scheduled' | 'published';
export type ContentFormat = 'post' | 'email' | 'ad' | 'article' | 'event' | 'other';

/** A content piece / promotion (the `promos` collection). */
export interface Promo extends RecordModel {
  title: string;
  channel: string;
  campaign: string;
  format: ContentFormat | '';
  date: string;
  status: ContentStatus;
  note: string;
}

export interface Note extends RecordModel {
  title: string;
  category: string;
  body: string;
  pinned: boolean;
}

/** A folder in the file repository (the `folders` collection, self-nesting). */
export interface Folder extends RecordModel {
  name: string;
  /** Parent folder id, or '' for the root. */
  parent: string;
}

/** A stored file in the repository (the `files` collection). */
export interface FileDoc extends RecordModel {
  title: string;
  /** Stored filename on the record's file field (PB-mangled, keeps extension). */
  file: string;
  size: number;
  mime: string;
  note: string;
  /** Owning folder id, or '' for the root. */
  folder: string;
}

export type RoadmapStatus = 'planned' | 'in_progress' | 'done' | 'cut';

export interface RoadmapItem extends RecordModel {
  title: string;
  description: string;
  status: RoadmapStatus;
  quarter: string;
  target_date: string;
  owner: string;
  pos_x: number;
  pos_y: number;
  /** ids of the milestones that must finish before this one can ship. */
  prerequisites: string[] | null;
}

export interface RoadmapDivider extends RecordModel {
  label: string;
  x: number;
}

export interface WorkflowRun extends RecordModel {
  workflow: 'weekly_digest' | 'journey_autocheck' | 'stage_check' | 'attention_sweep';
  status: 'ok' | 'error';
  summary: string;
  finished: string;
}

/** Pages the hash router knows. Module pages match ModuleKey values. */
export type Page =
  | 'home'
  | 'journey'
  | 'profile'
  | 'notes'
  | 'files'
  | 'settings'
  | ModuleKey;

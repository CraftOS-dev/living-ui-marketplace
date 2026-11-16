/** Shapes of the lifecycle operations' answers (pb/pb_hooks/lib_lifecycle*.js). */
import type { AgentAsk } from '../agent.tsx';

export type Lane = 'hr' | 'manager' | 'it' | 'employee' | 'member' | 'agent';
export type TaskKind = 'task' | 'document' | 'signature';
export type ChecklistKind = 'onboarding' | 'offboarding' | 'custom';

export interface Progress {
  done: number;
  skipped: number;
  open: number;
  overdue: number;
  total: number;
  percent: number;
}

export interface ProgressOf {
  id: string;
  kind: ChecklistKind;
  name: string;
  status: string;
  anchor_day: string;
  progress: Progress;
}

export interface Task {
  id: string;
  checklist: string;
  checklist_name: string;
  checklist_kind: ChecklistKind;
  anchor_day: string;
  employment: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  entity: string;
  title: string;
  description: string;
  assignee_kind: Lane;
  assignee_member: string;
  assignee_label: string;
  due: string;
  due_shown: string;
  days_left: number | null;
  overdue: boolean;
  status: 'open' | 'done' | 'skipped';
  kind: TaskKind;
  document_category: string;
  document: { id: string; title: string; has_file: boolean } | null;
  link: string;
  sort: number;
  done_at: string;
  done_actor: string;
  done_by_name: string;
  note: string;
  can: { act: boolean; edit: boolean };
}

export interface TaskList {
  tasks: Task[];
  total: number;
  today: string;
}

export interface Checklist {
  id: string;
  kind: ChecklistKind;
  name: string;
  status: 'open' | 'done' | 'cancelled';
  anchor_day: string;
  anchor_shown: string;
  employment: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  employee_status: string;
  photo: boolean;
  title: string;
  entity: string;
  entity_name: string;
  template: string;
  template_name: string;
  separation: string;
  first_day: { time?: string; place?: string; contact?: string; contact_name?: string; bring?: string; note?: string };
  started_actor: string;
  started_by_name: string;
  done_at: string;
  created: string;
  progress: Progress;
  tasks?: Task[];
  see?: 'all' | 'own' | 'tasks';
  can?: { edit: boolean; ask_agent: boolean };
  /** Your AI agent asked to do its tasks on this checklist (onboarding_help), or null. */
  agent?: AgentAsk | null;
  no_it_team?: boolean;
}

export interface TemplateTask {
  key: string;
  title: string;
  description: string;
  assignee: string;
  assignee_label?: string;
  due_offset_days: number;
  kind: TaskKind;
  document_category: string;
  needs_document?: boolean;
}

export interface ChecklistTemplate {
  id: string;
  kind: ChecklistKind;
  name: string;
  entity: string;
  entity_name: string;
  country: string;
  description: string;
  tasks: TemplateTask[];
  task_count: number;
  is_default: boolean;
  builtin: boolean;
  archived: boolean;
  used: number;
}

export interface Mover {
  employment: string;
  employee: string;
  number: string;
  name: string;
  title: string;
  entity: string;
  entity_name: string;
  day: string;
  checklist: ProgressOf | null;
  separation: { id: string; kind: string; status: string } | null;
  has_member: boolean;
  photo: boolean;
}

export interface LetterRow {
  id: string;
  number: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  employment: string;
  entity: string;
  entity_name: string;
  template: string;
  template_name: string;
  language: string;
  kind: string;
  kind_label: string;
  title: string;
  status: 'draft' | 'issued' | 'void';
  letter_day: string;
  letter_day_shown: string;
  needs_ack: boolean;
  acked_at: string;
  document: string;
  issued_at: string;
  issued_by_name: string;
  drafted_actor: string;
  drafted_by_name: string;
  void_reason: string;
  note: string;
  values: Record<string, string>;
  agent_drafting: boolean;
  /** Your AI agent asked to write this letter (letter_draft), or null. */
  agent: AgentAsk | null;
  created: string;
  body?: string;
  rendered?: string;
  missing?: string[];
  hidden?: string[];
  at_issue?: string[];
  custom?: string[];
  print?: { entity_name: string; legal_name: string; address: string; country: string } | null;
  can?: { edit: boolean; issue: boolean; acknowledge: boolean };
}

export interface Placeholder {
  key: string;
  label: string;
  pay?: boolean;
  optional?: boolean;
  signer?: boolean;
}

export interface LetterTemplate {
  id: string;
  kind: string;
  kind_label: string;
  name: string;
  country: string;
  entity: string;
  entity_name: string;
  language: string;
  description: string;
  body: string;
  placeholders: string[];
  custom: string[];
  uses_pay: boolean;
  needs_ack: boolean;
  builtin: boolean;
  archived: boolean;
  used: number;
}

export interface Separation {
  id: string;
  number: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  employment: string;
  entity: string;
  entity_name: string;
  kind: string;
  kind_label: string;
  notice_day: string;
  last_day: string;
  last_day_shown: string;
  days_left: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'completed';
  approval: string;
  requested_actor: string;
  requested_by_name: string;
  decided_at: string;
  completed_at: string;
  settlement_payrun: string;
  checklist: ProgressOf | null;
  exit_interview_done: boolean;
  see: 'hr' | 'agent' | 'self' | 'manager';
  created: string;
  reason?: string;
  reason_code?: string;
  rehire_eligible?: string;
  hr_note?: string;
  exit_interview?: { questions?: ExitQuestion[]; answers?: Record<string, string | number>; done_at?: string; form_name?: string };
  form?: { id: string; name: string; questions: ExitQuestion[] };
  assets?: Asset[];
  can?: { edit: boolean; withdraw: boolean; exit_interview: boolean; complete: boolean; settlement: boolean };
}

export interface ExitQuestion {
  key: string;
  label: string;
  type: 'text' | 'rating' | 'choice' | 'yes_no';
  options?: string[];
}

export interface Asset {
  id: string;
  tag: string;
  name: string;
  category: string;
  serial: string;
  entity: string;
  entity_name: string;
  employee: string;
  employee_name: string;
  employee_number: string;
  status: 'in_stock' | 'issued' | 'retired';
  condition: string;
  issued_day: string;
  returned_day: string;
  currency: string;
  value_minor?: number | null;
  purchased_day?: string;
  note?: string;
  history?: { at: string; event: string; employee_name?: string; day?: string; condition?: string; note?: string; by_name?: string }[];
}

export interface HandbookPage {
  id: string;
  category: string;
  entity: string;
  entity_name: string;
  needs_ack: boolean;
  version: number;
  published: boolean;
  published_at: string;
  title: string;
  sort: number;
  acked_at: string;
  to_ack: boolean;
  body?: string;
  draft_title?: string;
  draft_body?: string;
  changed?: boolean;
  archived?: boolean;
  updated_by_name?: string;
  versions?: { id: string; version: number; title: string; published_by_name: string; note: string; created: string; acks: number }[];
  version_body?: string;
  version_title?: string;
  version_shown?: number;
  editor?: boolean;
}

export interface Grievance {
  id: string;
  number: string;
  type: string;
  type_name: string;
  subject: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed' | 'withdrawn';
  occurred_on: string;
  confidential: boolean;
  anonymous: boolean;
  resolution: string;
  created: string;
  updated: string;
  closed_at: string;
  see: 'hr' | 'assignee' | 'shared' | 'reporter' | 'agent';
  description?: string;
  notes?: { id: string; at: string; by_name: string; as: string; text: string; visible_to_reporter: boolean }[];
  reporter?: string;
  reporter_name?: string;
  entity_name?: string;
  against?: string;
  against_name?: string;
  assignee?: string;
  assignee_name?: string;
  shared_with?: { id: string; name: string }[];
  agent_shared?: boolean;
  notes_count?: number;
  can?: { manage: boolean; status: boolean; note: boolean; withdraw: boolean };
}

export interface Settlement {
  separation: Separation;
  entity: { id: string; name: string; legal_name: string; currency: string; country: string };
  last_day: string;
  pay_hidden: boolean;
  pay: { kind: string; label: string; ref: string; amount_minor: number | null; currency: string }[];
  recover: { kind: string; label: string; ref: string; amount_minor: number | null; currency: string }[];
  leave: { type: string; name: string; unit: string; balance: number; amount_minor: number | null; currency: string; valued: 'payrun' | 'final_pay'; request?: string; status?: string }[];
  leave_from: 'payrun' | 'requests' | 'balance';
  assets: { id: string; tag: string; name: string; category: string; value_minor: number | null; currency: string }[];
  payrun: { id: string; number: string; kind: string; status: string; period_start: string; period_end: string; pay_date: string; currency: string; calculated: boolean; net_minor: number | null } | null;
  totals: { currency: string; source: 'payrun' | 'estimate'; gross_minor: number | null; deductions_minor: number | null; reimbursement_minor: number | null; pay_minor: number | null; recover_minor: number | null; net_minor: number | null }[];
  today: string;
}

export interface LifecycleHome {
  today: string;
  days: number;
  hr: boolean;
  starting: Mover[];
  leaving: Mover[];
  my_tasks: Task[];
  my_tasks_total: number;
  overdue: Task[];
  overdue_total: number;
  letters_to_issue?: number;
  letters?: LetterRow[];
  separations_pending?: number;
  templates_missing?: { id: string; name: string; country: string }[];
  grievances_open?: number;
}

export interface Welcome {
  linked: boolean;
  employee?: { id: string; number: string; name: string; status: string };
  pre_hire?: boolean;
  joining?: boolean;
  entity?: { id: string; name: string } | null;
  job?: { title: string; department: string; location: string } | null;
  manager?: { name: string; number: string } | null;
  first_day?: { day: string; day_shown: string; days_to_go: number; time: string; place: string; address: Record<string, string> | null; contact: string; bring: string; note: string } | null;
  checklist?: ProgressOf | null;
  tasks?: Task[];
  documents?: { id: string; title: string; category: string; acked_at: string; source: string; has_file: boolean; letter: string }[];
  handbook?: { id: string; title: string; version: number; category: string }[];
  today?: string;
}

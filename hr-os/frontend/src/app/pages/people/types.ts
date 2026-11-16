/** People shapes as the people.* operations answer them (pb_hooks/lib_people.js). */

export interface DirectoryRow {
  employee: string;
  employment: string;
  number: string;
  name: string;
  legal_name: string;
  title: string;
  department: string;
  department_name: string;
  location: string;
  location_name: string;
  entity: string;
  entity_name: string;
  manager: string;
  manager_name: string;
  work_email: string;
  phone: string;
  photo: boolean;
  status: string;
  employment_status: string;
  start_day: string;
  end_day: string;
}

export interface Directory {
  people: DirectoryRow[];
  total: number;
  limit: number;
  offset: number;
  as_of: string;
}

export interface OrgNode {
  employee: string;
  employment: string;
  number: string;
  name: string;
  title: string;
  department_name: string;
  location_name: string;
  entity_name: string;
  manager: string;
  photo: boolean;
  reports: number;
}

export interface Employee {
  id: string;
  number: string;
  name: string;
  legal_name: string;
  preferred_name: string;
  family_name: string;
  given_name: string;
  name_order: 'family_first' | 'given_first';
  work_email: string;
  phone: string;
  photo: boolean;
  status: string;
  archived: boolean;
  member: string;
  kana?: Record<string, string> | undefined;
  birth_date?: string | undefined;
  gender?: string | undefined;
  nationality?: string | undefined;
  personal_email?: string | undefined;
  address?: Record<string, string> | undefined;
  emergency?: EmergencyContact[] | undefined;
  dependants?: Dependant[] | undefined;
  notes?: string | undefined;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
  email: string;
  address: string;
  primary: boolean;
}

export interface Dependant {
  name: string;
  relation: string;
  birth_date: string;
  tax_dependant: boolean;
  disabled: boolean;
  note: string;
}

export interface JobRecord {
  id: string;
  employment: string;
  effective_from: string;
  title: string;
  job_title: string;
  job_title_name: string;
  department: string;
  department_name: string;
  location: string;
  location_name: string;
  manager: string;
  manager_name: string;
  grade: string;
  grade_code: string;
  employment_type: string;
  employment_type_code: string;
  employment_type_name: string;
  fte: number;
  schedule: string;
  schedule_name: string;
  calendar: string;
  calendar_code: string;
  cost_center: string;
  cost_center_code: string;
  reason: string;
  note: string;
  approved_by: string;
  created: string;
  state?: 'past' | 'current' | 'scheduled' | undefined;
}

export interface PayRecord {
  id: string;
  employment: string;
  effective_from: string;
  basis: 'salary' | 'hourly' | 'daily';
  amount_minor: number;
  amount: string;
  currency: string;
  per: 'year' | 'month' | 'week' | 'day' | 'hour';
  pay_schedule: string;
  reason: string;
  note: string;
  approved_by: string;
  created: string;
  state?: 'past' | 'current' | 'scheduled' | undefined;
}

export interface TaxProfile {
  id: string;
  employment: string;
  effective_from: string;
  country: string;
  packs: string[];
  fields: Record<string, unknown>;
  note: string;
  created: string;
  state?: 'past' | 'current' | 'scheduled' | undefined;
}

export interface EmploymentDetail {
  id: string;
  employee: string;
  entity: string;
  entity_name: string;
  number: string;
  start_day: string;
  end_day: string;
  notice_day: string;
  probation_end: string;
  status: string;
  primary: boolean;
  end_reason: string;
  currency: string;
  country: string;
  job: JobRecord | null;
  pay: PayRecord | null;
  pay_hidden: boolean;
  tax: TaxProfile | null;
  upcoming: { kind: 'job' | 'pay'; effective_from: string; id: string; reason: string }[];
  /** The tax profile fields the employment's packs declare (scope 'employee' are the person's own). */
  profile_fields?: ProfileFieldDef[] | undefined;
}

export interface ProfileFieldDef {
  pack?: string | undefined;
  version?: string | undefined;
  key: string;
  label: string;
  type: 'enum' | 'number' | 'boolean' | 'text' | 'date' | 'money';
  options?: { value: string; label: string }[] | undefined;
  default?: unknown;
  required?: boolean | undefined;
  help?: string | undefined;
  form?: string | undefined;
  scope?: 'employee' | 'entity' | undefined;
}

export interface BankAccount {
  id: string;
  employee: string;
  label: string;
  country: string;
  currency: string;
  bank_name: string;
  bank_code: string;
  branch_code: string;
  account_type: string;
  holder: string;
  number_masked: string;
  iban_masked: string;
  swift: string;
  split: { kind: 'rest' | 'percent' | 'fixed'; value?: number | undefined };
  status: 'pending' | 'active' | 'retired' | 'rejected';
  approval: string;
  approved_by: string;
  approved_at: string;
  created: string;
}

export interface IdentityDoc {
  id: string;
  employee: string;
  type: string;
  country: string;
  number_masked: string;
  issued: string;
  expires: string;
  has_file: boolean;
  note: string;
  created: string;
}

export interface DocumentRow {
  id: string;
  employee: string;
  employment: string;
  category: string;
  title: string;
  has_file: boolean;
  file_name: string;
  visible_to_employee: boolean;
  needs_ack: boolean;
  acked_at: string;
  expires: string;
  source: 'upload' | 'letter' | 'payslip' | 'agent';
  note: string;
  created: string;
}

export interface Skill {
  id: string;
  employee: string;
  skill: string;
  level: number;
  verified_by: string;
  note: string;
}

/** One fact a module shows on the profile and Home (its events_<module>.js profileFacts). */
/** The one fact shape (lib/contract.ts). */
export type { ProfileFact } from '../../lib/contract.ts';
import type { ProfileFact } from '../../lib/contract.ts';

export interface ModuleFacts {
  module: string;
  facts?: ProfileFact[] | undefined;
  error?: string | undefined;
}

export interface Profile {
  employee: Employee;
  access: 'full' | 'edit' | 'view' | 'team' | 'self';
  can: { edit: boolean; edit_self: boolean; hire: boolean; job: boolean; pay: boolean; bank: boolean; reveal: boolean };
  employments: EmploymentDetail[];
  primary_employment: string;
  manager: { id: string; number: string; name: string; member: string } | null;
  reports: number;
  as_of: string;
  bank_accounts?: BankAccount[] | undefined;
  identity_docs?: IdentityDoc[] | undefined;
  skills?: Skill[] | undefined;
  documents?: DocumentRow[] | undefined;
  facts: ModuleFacts[];
}

export interface Timeline {
  employment: { id: string; start_day: string; end_day: string };
  today: string;
  job: JobRecord[];
  pay: PayRecord[] | null;
  tax: TaxProfile[] | null;
  pay_hidden: boolean;
  changes: AuditEntry[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
  entity: string;
  parent: string;
  head: string;
  head_name: string;
  approver: string;
  approver_name: string;
  cost_center: string;
  archived: boolean;
  people: number;
}

export interface OrgItem {
  id: string;
  name?: string | undefined;
  code?: string | undefined;
  [k: string]: unknown;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: 'person' | 'agent' | 'system';
  member: string;
  who: string;
  op: string;
  collection: string;
  record: string;
  summary: string;
  before: unknown;
  after: unknown;
  data: unknown;
}

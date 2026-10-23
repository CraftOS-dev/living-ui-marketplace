/**
 * Shapes read by Settings and the profile: the company, members and roles,
 * taxes, payment terms, currencies, imports and the audit trail.
 */
import type { AuditEntry, CodeRef, Level, Module, Ref } from '../types.ts';

export interface SeriesConfig {
  prefix: string;
  width: number;
  /** The next number as it will read ("INV-00019"). */
  next: string;
}

export interface AgentAutonomy {
  auto: Record<string, boolean>;
  /** Minor units of the base currency (0: no ceiling). */
  limit: number;
  chase_overdue: boolean;
  auto_reorder: boolean;
  kinds: string[];
}

export interface CompanySettings {
  company_name: string;
  legal_name: string;
  tax_id: string;
  registration_no: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  /** A path under /api/files ('' when there is none). */
  logo: string;
  country: string;
  base_currency: string;
  fiscal_start_month: number;
  business_type: string;
  modules: Partial<Record<Module, boolean>>;
  prices_include_tax: boolean;
  allow_negative_stock: boolean;
  invoice_footer: string;
  quote_terms: string;
  quote_validity_days: number;
  working_days: number[];
  soft_lock_date: string;
  hard_lock_date: string;
  /** Administrators and accountants only. */
  numbering?: Record<string, SeriesConfig> | undefined;
  default_accounts?: Record<string, CodeRef | null> | undefined;
  defaults?: { warehouse: string; bank: string; sale_tax: string; purchase_tax: string; terms: string } | undefined;
  agent?: AgentAutonomy | undefined;
}

export type MemberStatus = 'invited' | 'active' | 'disabled';

export interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  status: MemberStatus;
  role: { id: string; name: string; key: string } | null;
  employee: { id: string; name: string; number: string } | null;
  last_seen: string;
  invite_expires: string;
  locked: boolean;
  created: string;
}

export interface MemberList {
  members: Member[];
  total: number;
  counts: Partial<Record<MemberStatus, number>>;
}

export interface InviteResult {
  member: Member;
  code: string;
  expires: string;
}

export interface Role {
  id: string;
  name: string;
  key: string;
  levels: Record<Module, Level>;
  admin: boolean;
  /** Minor units of the base currency (0: no limit). */
  approval_limit: number;
  description: string;
  system: boolean;
  members: number;
}

export interface RoleList {
  roles: Role[];
  modules: { key: Module; label: string }[];
  levels: Level[];
}

export interface Tax {
  id: string;
  code: string;
  name: string;
  rate: string;
  rate_bp: number;
  scope: 'sales' | 'purchase' | 'both';
  recoverable: boolean;
  sales_account: CodeRef | null;
  purchase_account: CodeRef | null;
  description: string;
  archived: boolean;
}

export interface Terms {
  id: string;
  name: string;
  days: number;
  end_of_month: boolean;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  rate: string;
  rate_e8: number;
  rate_date: string;
  base: boolean;
  archived: boolean;
}

export type ImportKind = 'parties' | 'items' | 'accounts' | 'opening_accounts' | 'opening_documents' | 'opening_stock' | 'employees';

export interface ImportPreview {
  import_id: string;
  kind: ImportKind;
  filename: string;
  columns: { index: number; name: string }[];
  fields: { field: string; required: boolean; column: number }[];
  counts: { rows: number; create: number; update: number; invalid: number };
  rows: { row: number; status: 'create' | 'update' | 'invalid'; problems: string[]; values: Record<string, string> }[];
  problems: { row: number; problems: string[] }[];
}

export interface ImportRun {
  added: number;
  updated?: number | undefined;
  skipped: number;
}

export interface ImportRecord {
  id: string;
  kind: ImportKind | string;
  filename: string;
  status: 'previewed' | 'imported' | 'undone' | string;
  rows: number;
  added: number;
  skipped: number;
  created: string;
  who: string;
}

export interface AuditList {
  entries: AuditEntry[];
  total: number;
}

export interface OpeningJournal {
  id: string;
  number: string;
  date: string;
  kind: string;
  memo: string;
  total: number;
  source: { entity: string; id: string; label: string } | null;
  [key: string]: unknown;
}

export interface WarehouseRef extends Ref {
  code: string;
}

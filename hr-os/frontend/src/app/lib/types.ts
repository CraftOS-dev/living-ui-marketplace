/**
 * Kernel shapes as the operations answer them. Modules keep their own types
 * next to their pages.
 */

export type Module = 'people' | 'time' | 'leave' | 'expenses' | 'payroll' | 'hiring' | 'performance' | 'reports' | 'admin';
export type Level = 'none' | 'view' | 'edit' | 'full';

export const MODULES: Module[] = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'reports', 'admin'];

export interface EntityRef {
  id: string;
  name: string;
  code: string;
  country: string;
  region: string;
  currency: string;
  timezone: string;
}

export interface Me {
  actor: 'person' | 'agent';
  member: { id: string; name: string; email: string; title: string; prefs: Record<string, unknown> };
  role: { id: string; code: string; name: string; team_scope: boolean } | null;
  levels: Record<Module, Level>;
  owner: boolean;
  admin: boolean;
  /** Entity ids this member is limited to; empty means all. */
  entities_scope: string[];
  entities: EntityRef[];
  employee: { id: string; number: string; name: string; employments: { id: string; entity: string; number: string; status: string }[] } | null;
  /** How many people report to me (directly or not). */
  manages: number;
  has_pin: boolean;
  /** `logo`, `logo_dark`: the stored logo files ('' = none), used as versions in the image URL (settings.logo). */
  company: { name: string; reporting_currency: string; setup_done: boolean; date_style: string; agent_sees_pay: boolean; managers_see_pay: boolean; logo: string; logo_dark: string };
  unread: number;
  today: string;
}

export interface Ref {
  id: string;
  name: string;
}

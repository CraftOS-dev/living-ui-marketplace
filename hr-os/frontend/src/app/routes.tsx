/**
 * Every page of HR OS, gathered from the modules.
 *
 * THE MODULE PAGE CONTRACT
 * ------------------------
 * Each module owns `frontend/src/app/pages/<module>/index.tsx` and every file
 * in that folder. The index exports (types in lib/contract.ts):
 *
 *   export const routes: RouteDef[] = [
 *     { path: '/time', page: TimePage, title: t('time.title') },
 *     { path: '/time/attendance/:id', page: AttendanceDay, title: t('time.day'), perm: 'time:view|team' },
 *     { path: '/print/payroll/payslip/:id', page: PayslipPrint, title: 'Payslip', frame: 'print' },
 *   ];
 *   export const nav: NavChild[] = [ { key: 'timesheets', label: t('time.timesheets'), to: '/time/timesheets', perm: 'time:view|team' } ];
 *   export const useNavTree = (): NavTree | null => ...;       // optional dynamic children with "+"
 *   export const profileTabs: ProfileTab[] = [ { key: 'time', label: t('time.title'), component: TimeTab, order: 30 } ];
 *   export const primary: PrimaryDef[] = [ { for: 'employee', usePrimary: useClockAction } ];
 *   export const approvalViews = { attendance_request: AttendanceRequestContext };
 *   export const inboxSections: InboxSection[] = [
 *     { key: 'tasks', label: t('lifecycle.my_tasks'), useItems: useMyTasks, order: 30 },   // hook -> InboxItem[] | null
 *   ];
 *   export const homeWidgets: HomeWidget[] = [
 *     { key: 'whos_out', for: 'admin', component: WhosOut, order: 20, size: 'narrow' },
 *   ];
 *   export const publicRoutes: RouteDef[] = [
 *     { path: '/time/kiosk/:code', page: KioskPage, title: t('time.kiosk.title') },   // before sign-in
 *   ];
 *
 * Rules:
 *  - Paths start with the module's own segment ('/time/...'); print pages
 *    start with '/print/<module>/...' and carry frame: 'print'.
 *  - The place in the sidebar (label, icon, order, who sees it) is the
 *    kernel's (PLACES below); `nav` adds child rows under it, `useNavTree`
 *    adds data rows (departments, pay schedules) with an inline "+".
 *  - A module root page ('/time', '/leave', '/expenses', '/payroll',
 *    '/performance') serves every role that reaches it: an employee sees
 *    their own view there (the phone bottom bar links to it).
 *  - `perm` is checked on the screen only to hide what a role cannot use;
 *    the server refuses it anyway.
 *  - Pages are wrapped by the shell; start them with <PageHeader> and put
 *    the content in <PageBody>. Read with useOp(), write with op() / act().
 *  - A page remounts when its route params change ('/people/E0005' to
 *    '/people/E0021'); query changes (?tab=, filters) keep it mounted.
 *    useOp empties when its params change; pass { keep: true } for filters
 *    and searches so the old rows stay while the new answer loads.
 *  - All copy goes through t('key') with keys in i18n/<module>.en.ts.
 *  - Shared UI rules (reference/notes/kernel-frontend.md, section 0): the
 *    type scale (10.5 labels, 12, 13, 14, 15, 26), one date style through
 *    lib/format.ts, every amount through <Money>, 40px tap targets on touch,
 *    one primary button per screen, panels numbered 01, 02, 03.
 *  - inboxSections render in the Inbox "For you" view below approvals and
 *    proposals; their item counts add to the sidebar Inbox badge. A
 *    section's useItems is a hook (it may call useOp) and must return the
 *    viewer's own open items only. It runs once per refresh in the shell's
 *    one provider (components/shell/counts.ts), mounted on every page for
 *    the whole session: keep it to one small read and skip it when the
 *    viewer lacks the right. Never call it yourself; read useShellCounts().
 *  - homeWidgets are placed by the Home page (home-reports builder) by
 *    `for` (admin, manager, employee), `order` and `size`. The host passes
 *    each widget `{ index }` ("03", its place in Home's reading order); the
 *    widget hands it to its Panel so Home is numbered 01, 02, 03 throughout.
 *  - publicRoutes open before sign-in, for every session state once the
 *    company is set up (signed out or in): the page renders alone, without
 *    the shell, and gets { params, query } like any page. Its operations
 *    must be perm 'public' on the server; the page keeps its own device
 *    credential (the kiosk token), never a member session.
 *  - Payroll: pages/payroll/index.tsx (payroll-core) spreads the exports of
 *    pages/payroll/out/index.tsx (payroll-out) into its own.
 */
import type { LucideIcon } from 'lucide-react';
import { Banknote, CalendarDays, ChartColumn, CircleUser, Clock, House, Inbox, ListChecks, Receipt, Route as RouteIcon, Target, UserPlus, Users } from 'lucide-react';
import type { HomeWidget, InboxSection, ModuleExports, NavChild, ProfileTab, RouteDef } from './lib/contract.ts';
import { t } from './lib/i18n.ts';
import * as expenses from './pages/expenses/index.tsx';
import * as hiring from './pages/hiring/index.tsx';
import * as home from './pages/home/index.tsx';
import * as inbox from './pages/inbox/index.tsx';
import * as leave from './pages/leave/index.tsx';
import * as lifecycle from './pages/lifecycle/index.tsx';
import * as me from './pages/me/index.tsx';
import * as payroll from './pages/payroll/index.tsx';
import * as people from './pages/people/index.tsx';
import * as performance from './pages/performance/index.tsx';
import * as print from './pages/print/index.tsx';
import * as reports from './pages/reports/index.tsx';
import * as settings from './pages/settings/index.tsx';
import * as account from './pages/auth/index.tsx';
import * as time from './pages/time/index.tsx';

export type ModuleKey = 'home' | 'inbox' | 'people' | 'time' | 'leave' | 'expenses' | 'payroll' | 'hiring' | 'lifecycle' | 'performance' | 'reports' | 'me' | 'settings' | 'account' | 'print';

export const MODULE_EXPORTS: Record<ModuleKey, ModuleExports> = {
  home,
  inbox,
  people,
  time,
  leave,
  expenses,
  payroll,
  hiring,
  lifecycle,
  performance,
  reports,
  me,
  settings,
  account,
  print,
};

export interface Place {
  module: ModuleKey;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Who sees the place (see auth.allowed). */
  perm: string;
}

/** The places in the sidebar, in order. Settings sits at the foot. */
export function places(): Place[] {
  return [
    { module: 'home', label: t('nav.home'), icon: House, to: '/home', perm: 'signed' },
    { module: 'inbox', label: t('nav.inbox'), icon: Inbox, to: '/inbox', perm: 'signed' },
    { module: 'people', label: t('nav.people'), icon: Users, to: '/people', perm: 'people:view|team' },
    { module: 'time', label: t('nav.time'), icon: Clock, to: '/time', perm: 'signed' },
    { module: 'leave', label: t('nav.leave'), icon: CalendarDays, to: '/leave', perm: 'signed' },
    { module: 'expenses', label: t('nav.expenses'), icon: Receipt, to: '/expenses', perm: 'signed' },
    { module: 'payroll', label: t('nav.payroll'), icon: Banknote, to: '/payroll', perm: 'signed' },
    { module: 'hiring', label: t('nav.hiring'), icon: UserPlus, to: '/hiring', perm: 'hiring:view|team' },
    { module: 'lifecycle', label: t('nav.lifecycle'), icon: RouteIcon, to: '/lifecycle', perm: 'people:view|team' },
    { module: 'performance', label: t('nav.performance'), icon: Target, to: '/performance', perm: 'signed' },
    { module: 'reports', label: t('nav.reports'), icon: ChartColumn, to: '/reports', perm: 'reports:view' },
    { module: 'me', label: t('nav.me'), icon: CircleUser, to: '/me', perm: 'employee' },
  ];
}

/** The phone bottom bar: the five jobs people do away from a desk. 'more' opens the full menu. */
export function phoneBar(kind: 'employee' | 'admin'): { label: string; icon: LucideIcon; to: string | 'more' }[] {
  if (kind === 'employee')
    return [
      { label: t('nav.home'), icon: House, to: '/home' },
      { label: t('nav.clock'), icon: Clock, to: '/time' },
      { label: t('nav.leave'), icon: CalendarDays, to: '/leave' },
      { label: t('nav.pay'), icon: Banknote, to: '/payroll' },
      { label: t('nav.me'), icon: CircleUser, to: '/me' },
    ];
  return [
    { label: t('nav.home'), icon: House, to: '/home' },
    { label: t('nav.inbox'), icon: ListChecks, to: '/inbox' },
    { label: t('nav.people'), icon: Users, to: '/people' },
    { label: t('nav.payroll'), icon: Banknote, to: '/payroll' },
    { label: t('nav.more'), icon: ListChecks, to: 'more' },
  ];
}

/** Every route of every module. */
export function allRoutes(): RouteDef[] {
  const out: RouteDef[] = [];
  for (const m of Object.values(MODULE_EXPORTS)) out.push(...m.routes);
  return out;
}

/** Every module's pages that open before sign-in (no shell, no session). */
export function publicRoutes(): RouteDef[] {
  const out: RouteDef[] = [];
  for (const m of Object.values(MODULE_EXPORTS)) out.push(...(m.publicRoutes ?? []));
  return out;
}

/** The static child rows of a place. */
export function navChildren(module: ModuleKey): NavChild[] {
  return MODULE_EXPORTS[module].nav ?? [];
}

/** Every module's tabs for the employee profile, in order. */
export function profileTabs(): ProfileTab[] {
  const out: ProfileTab[] = [];
  for (const m of Object.values(MODULE_EXPORTS)) out.push(...(m.profileTabs ?? []));
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Every module's Inbox sections, in order. */
export function inboxSections(): InboxSection[] {
  const out: InboxSection[] = [];
  for (const m of Object.values(MODULE_EXPORTS)) out.push(...(m.inboxSections ?? []));
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Every module's Home widgets for one kind of viewer, in order. */
export function homeWidgets(kind: HomeWidget['for']): HomeWidget[] {
  const out: HomeWidget[] = [];
  for (const m of Object.values(MODULE_EXPORTS)) out.push(...(m.homeWidgets ?? []).filter((w) => w.for === kind));
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

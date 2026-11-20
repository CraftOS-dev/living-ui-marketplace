/**
 * Leave (the leave builder's module): the home (HR: who is out, what waits,
 * what needs attention; everyone else: their own leave), the wallchart,
 * requests, balances, settings (types, policies, locked days, the bulk
 * tools, the daily run) and the Japanese register. The profile gets a Leave
 * tab, the Inbox the decision context of leave approvals, Home two widgets.
 */
import type { HomeWidget, NavChild, ProfileTab, ProfileTabProps, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { CompOffView, EncashView, LeaveRequestView } from './Approvals.tsx';
import { BalancesPage } from './Balances.tsx';
import { CalendarPage } from './Calendar.tsx';
import { LeaveHomePage } from './Home.tsx';
import { LeaveOverview, MyLeavePage } from './Mine.tsx';
import { RegisterPage } from './Register.tsx';
import { RequestPage, RequestsPage } from './Requests.tsx';
import { LeaveSettingsPage } from './Settings.tsx';
import { MyLeaveWidget, WhosOutWidget } from './Widgets.tsx';

export const routes: RouteDef[] = [
  { path: '/leave', page: LeaveHomePage, title: t('leave.title') },
  { path: '/leave/me', page: MyLeavePage, title: t('leave.my'), perm: 'employee' },
  { path: '/leave/calendar', page: CalendarPage, title: t('leave.calendar.title') },
  { path: '/leave/requests', page: RequestsPage, title: t('leave.requests'), perm: 'leave:view|team' },
  { path: '/leave/requests/:id', page: RequestPage, title: t('leave.request_title') },
  { path: '/leave/balances', page: BalancesPage, title: t('leave.balances'), perm: 'leave:view|team' },
  { path: '/leave/register', page: RegisterPage, title: t('leave.reg.title'), perm: 'leave:view' },
  { path: '/leave/settings', page: LeaveSettingsPage, title: t('leave.settings.title'), perm: 'leave:full' },
];

export const nav: NavChild[] = [
  { key: 'calendar', label: t('leave.calendar.title'), to: '/leave/calendar' },
  { key: 'requests', label: t('leave.requests'), to: '/leave/requests', perm: 'leave:view|team' },
  { key: 'balances', label: t('leave.balances'), to: '/leave/balances', perm: 'leave:view|team' },
  { key: 'register', label: t('leave.reg.nav'), to: '/leave/register', perm: 'leave:view' },
  { key: 'settings', label: t('leave.settings.title'), to: '/leave/settings', perm: 'leave:full' },
];

function LeaveTab({ employment, self }: ProfileTabProps): React.JSX.Element {
  return <LeaveOverview employment={employment} self={self} compact />;
}

export const profileTabs: ProfileTab[] = [{ key: 'leave', label: t('leave.title'), component: LeaveTab, order: 40 }];

export const approvalViews = { leave_request: LeaveRequestView, leave_encash: EncashView, comp_off: CompOffView };

export const homeWidgets: HomeWidget[] = [
  { key: 'leave_whos_out', for: 'admin', component: WhosOutWidget, order: 30, size: 'narrow' },
  { key: 'leave_whos_out_team', for: 'manager', component: WhosOutWidget, order: 30, size: 'narrow' },
  { key: 'leave_mine', for: 'employee', component: MyLeaveWidget, order: 20, size: 'narrow' },
];

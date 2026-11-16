/**
 * Expenses: claims with receipts your AI agent reads, advances and trips.
 * /expenses opens on what needs HR, finance and managers; an employee sees
 * their own expenses there (with the one "Add expense"). The place expands
 * to Claims, Advances, Trips and Settings.
 */
import { ApprovalViews } from './approvals.ts';
import { AdvancePage, AdvancesPage } from './Advances.tsx';
import { ClaimPage } from './Claim.tsx';
import { ClaimsPage } from './Claims.tsx';
import { ExpensesRoot } from './Home.tsx';
import { MinePage } from './Mine.tsx';
import { SettingsPage } from './Settings.tsx';
import { TripNewPage, TripPage, TripsPage } from './Travel.tsx';
import { ExpensesProfileTab, ExpensesWaitingWidget, MyExpensesWidget, useMyExpenseItems } from '../../components/expenses/Panels.tsx';
import type { HomeWidget, InboxSection, NavChild, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';

export const routes: RouteDef[] = [
  { path: '/expenses', page: ExpensesRoot, title: t('exp.title') },
  { path: '/expenses/mine', page: MinePage, title: t('exp.mine.title'), perm: 'employee' },
  { path: '/expenses/claims', page: ClaimsPage, title: t('exp.claims.title'), perm: 'expenses:view|team' },
  { path: '/expenses/claims/:id', page: ClaimPage, title: t('exp.claims.one') },
  { path: '/expenses/advances', page: AdvancesPage, title: t('exp.adv.title'), perm: 'expenses:view|team' },
  { path: '/expenses/advances/:id', page: AdvancePage, title: t('exp.adv.one') },
  { path: '/expenses/travel', page: TripsPage, title: t('exp.trip.title'), perm: 'expenses:view|team' },
  { path: '/expenses/travel/new', page: TripNewPage, title: t('exp.trip.plan'), perm: 'employee' },
  { path: '/expenses/travel/:id', page: TripPage, title: t('exp.trip.one') },
  { path: '/expenses/settings', page: SettingsPage, title: t('exp.settings.title'), perm: 'expenses:view' },
];

export const nav: NavChild[] = [
  { key: 'mine', label: t('exp.mine.title'), to: '/expenses/mine', perm: 'employee' },
  { key: 'claims', label: t('exp.claims.title'), to: '/expenses/claims', perm: 'expenses:view|team' },
  { key: 'advances', label: t('exp.adv.title'), to: '/expenses/advances', perm: 'expenses:view|team' },
  { key: 'travel', label: t('exp.trip.title'), to: '/expenses/travel', perm: 'expenses:view|team' },
  { key: 'settings', label: t('exp.settings.short'), to: '/expenses/settings', perm: 'expenses:full' },
];

export const profileTabs: ProfileTab[] = [{ key: 'expenses', label: t('exp.title'), component: ExpensesProfileTab, perm: 'expenses:view', order: 50 }];

export const approvalViews = ApprovalViews;

export const homeWidgets: HomeWidget[] = [
  { key: 'expenses_mine', for: 'employee', component: MyExpensesWidget, order: 40, size: 'narrow' },
  { key: 'expenses_waiting', for: 'admin', component: ExpensesWaitingWidget, order: 40, size: 'narrow' },
  { key: 'expenses_team', for: 'manager', component: ExpensesWaitingWidget, order: 40, size: 'narrow' },
];

export const inboxSections: InboxSection[] = [{ key: 'expenses', label: t('exp.inbox.title'), useItems: useMyExpenseItems, order: 40 }];

/**
 * Lifecycle: onboarding and offboarding checklists, letters, separations,
 * assets, the employee handbook and grievances (module page contract in
 * routes.tsx and lib/contract.ts).
 *
 * Exports:
 *   routes         every lifecycle page and two print pages
 *   nav            child rows under Lifecycle in the sidebar
 *   profileTabs    the "Lifecycle" tab on a person's profile
 *   inboxSections  'lifecycle.tasks' (the viewer's open checklist tasks, from
 *                  tasks.list --view mine --status open) and 'lifecycle.read'
 *                  (handbook pages the viewer still has to acknowledge)
 *   homeWidgets    'lifecycle.movers' (admin, manager), 'lifecycle.first_days' (employee)
 */
import type { HomeWidget, InboxSection, NavChild, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { AssetsPage } from './Assets.tsx';
import { BoardPage } from './Board.tsx';
import { GrievancePage, GrievancesPage } from './Grievances.tsx';
import { HandbookPage } from './Handbook.tsx';
import { LifecycleHomePage } from './Home.tsx';
import { LetterPage, LettersPage, LetterTemplatePage } from './Letters.tsx';
import { ChecklistsPage, TasksPage } from './Lists.tsx';
import { LifecycleTab } from './ProfileTab.tsx';
import { SeparationPage, SeparationsPage, SettlementPage, SettlementPrint } from './Separations.tsx';
import { TemplatesPage } from './Templates.tsx';
import { WelcomePage } from './Welcome.tsx';
import { FirstDaysWidget, LetterPrint, MoversWidget, MoversWidgetNarrow, useReadItems, useTaskItems } from './widgets.tsx';

export const routes: RouteDef[] = [
  { path: '/lifecycle', page: LifecycleHomePage, title: t('lifecycle.title') },
  { path: '/lifecycle/welcome', page: WelcomePage, title: t('lifecycle.welcome') },
  { path: '/lifecycle/tasks', page: TasksPage, title: t('lifecycle.tasks') },
  { path: '/lifecycle/checklists', page: ChecklistsPage, title: t('lifecycle.checklists'), perm: 'people:view|team' },
  { path: '/lifecycle/checklists/:id', page: BoardPage, title: t('lifecycle.checklist') },
  { path: '/lifecycle/templates', page: TemplatesPage, title: t('lifecycle.templates'), perm: 'people:view' },
  { path: '/lifecycle/letters', page: LettersPage, title: t('lifecycle.letters') },
  { path: '/lifecycle/letters/:id', page: LetterPage, title: t('lifecycle.letter') },
  { path: '/lifecycle/letter-templates/:id', page: LetterTemplatePage, title: t('lifecycle.letter_template'), perm: 'people:view' },
  { path: '/lifecycle/separations', page: SeparationsPage, title: t('lifecycle.separations') },
  { path: '/lifecycle/separations/:id', page: SeparationPage, title: t('lifecycle.separation') },
  { path: '/lifecycle/separations/:id/settlement', page: SettlementPage, title: t('lifecycle.full_and_final'), perm: 'people:edit' },
  { path: '/lifecycle/assets', page: AssetsPage, title: t('lifecycle.assets'), perm: 'people:view' },
  { path: '/lifecycle/handbook', page: HandbookPage, title: t('lifecycle.handbook') },
  { path: '/lifecycle/handbook/:id', page: HandbookPage, title: t('lifecycle.handbook') },
  { path: '/lifecycle/grievances', page: GrievancesPage, title: t('lifecycle.concerns') },
  { path: '/lifecycle/grievances/:id', page: GrievancePage, title: t('lifecycle.concern') },
  { path: '/print/lifecycle/letter/:id', page: LetterPrint, title: t('lifecycle.letter'), frame: 'print' },
  { path: '/print/lifecycle/settlement/:id', page: SettlementPrint, title: t('lifecycle.full_and_final'), perm: 'people:edit', frame: 'print' },
];

export const nav: NavChild[] = [
  { key: 'tasks', label: t('lifecycle.tasks'), to: '/lifecycle/tasks', perm: 'people:view|team' },
  { key: 'checklists', label: t('lifecycle.checklists'), to: '/lifecycle/checklists', perm: 'people:view' },
  { key: 'templates', label: t('lifecycle.templates'), to: '/lifecycle/templates', perm: 'people:view' },
  { key: 'letters', label: t('lifecycle.letters'), to: '/lifecycle/letters', perm: 'people:view' },
  { key: 'separations', label: t('lifecycle.separations'), to: '/lifecycle/separations', perm: 'people:view|team' },
  { key: 'assets', label: t('lifecycle.assets'), to: '/lifecycle/assets', perm: 'people:view' },
  { key: 'handbook', label: t('lifecycle.handbook'), to: '/lifecycle/handbook', perm: 'people:view|team' },
  { key: 'grievances', label: t('lifecycle.grievances'), to: '/lifecycle/grievances', perm: 'people:full' },
];

export const profileTabs: ProfileTab[] = [{ key: 'lifecycle', label: t('lifecycle.title'), component: LifecycleTab, perm: 'people:view', order: 60 }];

export const inboxSections: InboxSection[] = [
  { key: 'lifecycle.tasks', label: t('lifecycle.inbox_tasks'), useItems: useTaskItems, order: 30 },
  { key: 'lifecycle.read', label: t('lifecycle.inbox_read'), useItems: useReadItems, order: 35 },
];

export const homeWidgets: HomeWidget[] = [
  { key: 'lifecycle.movers', for: 'admin', component: MoversWidget, order: 40, size: 'wide' },
  { key: 'lifecycle.movers', for: 'manager', component: MoversWidgetNarrow, order: 40, size: 'narrow' },
  { key: 'lifecycle.first_days', for: 'employee', component: FirstDaysWidget, order: 10, size: 'narrow' },
];

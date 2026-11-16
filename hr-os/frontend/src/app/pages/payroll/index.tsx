/**
 * Payroll (payroll-core): the module's pages, sidebar children, the "Run
 * payroll" action, the profile Pay tab, Inbox approval context and Home
 * widgets. It spreads payroll-out's exports (pages/payroll/out/index.tsx and
 * pages/print/payroll/out.tsx) into its own.
 */
import { useMemo } from 'react';
import { Play } from 'lucide-react';
import type { HomeWidget, InboxSection, NavChild, NavTree, PrimaryAction, PrimaryDef, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { routes as outRoutes, nav as outNav, inboxSections as outInbox, homeWidgets as outWidgets } from './out/index.tsx';
import { routes as outPrintRoutes } from '../print/payroll/out.tsx';
import { PayslipPrint } from '../print/payroll/payslip.tsx';
import { LatestPayslipWidget, LoanApproval, PayChangeApproval, PayrunApproval, TaxDeclarationApproval } from './core/Approvals.tsx';
import { PayrollRoot, RunPayrollPage, RunsPage } from './core/Home.tsx';
import { PayslipPage } from './core/Payslip.tsx';
import { BackpayPage, DeclarationsPage, LoansPage, ProfilePayTab, TaxProfilePage } from './core/People.tsx';
import { OpeningsPage } from './core/Openings.tsx';
import { RunPage } from './core/Run.tsx';
import { ComponentsPage, ItemsPage, SchedulesPage, SettingsPage } from './core/Setup.tsx';
import type { NextPeriod } from './core/types.ts';
import { periodWords } from '../../components/payroll/bits.tsx';

const coreRoutes: RouteDef[] = [
  { path: '/payroll', page: PayrollRoot, title: t('payroll.title') },
  { path: '/payroll/run', page: RunPayrollPage, title: t('payroll.act.run_payroll'), perm: 'payroll:edit' },
  { path: '/payroll/runs', page: RunsPage, title: t('payroll.runs'), perm: 'payroll:view' },
  { path: '/payroll/runs/:id', page: RunPage, title: t('payroll.run'), perm: 'payroll:view' },
  { path: '/payroll/payslip/:id', page: PayslipPage, title: t('payroll.payslip') },
  { path: '/payroll/schedules', page: SchedulesPage, title: t('payroll.schedules'), perm: 'payroll:view' },
  { path: '/payroll/components', page: ComponentsPage, title: t('payroll.components'), perm: 'payroll:view' },
  { path: '/payroll/items', page: ItemsPage, title: t('payroll.items'), perm: 'payroll:view' },
  { path: '/payroll/settings', page: SettingsPage, title: t('payroll.settings'), perm: 'payroll:view' },
  { path: '/payroll/openings', page: OpeningsPage, title: t('payroll.open.title'), perm: 'payroll:view' },
  { path: '/payroll/loans', page: LoansPage, title: t('payroll.tab.loans') },
  { path: '/payroll/declarations', page: DeclarationsPage, title: t('payroll.tab.declarations') },
  { path: '/payroll/tax/:employment', page: TaxProfilePage, title: t('payroll.tax.title') },
  { path: '/payroll/backpay', page: BackpayPage, title: t('payroll.backpay.title'), perm: 'payroll:view' },
  { path: '/print/payroll/payslip/:id', page: PayslipPrint, title: t('payroll.payslip'), frame: 'print' },
];

export const routes: RouteDef[] = [...coreRoutes, ...outRoutes, ...outPrintRoutes];

const coreNav: NavChild[] = [
  { key: 'runs', label: t('payroll.runs'), to: '/payroll/runs', perm: 'payroll:view' },
  { key: 'items', label: t('payroll.items'), to: '/payroll/items', perm: 'payroll:view' },
  { key: 'components', label: t('payroll.components'), to: '/payroll/components', perm: 'payroll:view' },
  { key: 'loans', label: t('payroll.tab.loans'), to: '/payroll/loans', perm: 'payroll:view' },
  { key: 'declarations', label: t('payroll.tab.declarations'), to: '/payroll/declarations', perm: 'payroll:view' },
  { key: 'openings', label: t('payroll.open.title'), to: '/payroll/openings', perm: 'payroll:view' },
  { key: 'settings', label: t('payroll.settings'), to: '/payroll/settings', perm: 'payroll:view' },
];

/** Every payroll page (core and pay-out), listed on Payroll home. */
export const payrollPages: NavChild[] = [...coreNav, ...outNav];

/** The sidebar lists Payroll's pay schedules only (useNavTree); its pages are on Payroll home (QA2 K4). */
export const nav: NavChild[] = [];

/** Pay schedules under Payroll, each with "+" for an off-cycle run. */
export function useNavTree(): NavTree | null {
  const me = useMe();
  const { entity } = useUi();
  const view = can(me, 'payroll', 'view');
  const live = useOp<{ schedules: { id: string; name: string; entity_name: string; people: number }[] }>('pay-schedules.list', { entity: entity === '' ? undefined : entity }, ['pay_schedules'], { skip: !view, name: 'payroll.nav' });
  const edit = can(me, 'payroll', 'edit');
  return useMemo(() => {
    if (!view || live.data === null) return null;
    const many = new Set(live.data.schedules.map((s) => s.entity_name)).size > 1;
    return {
      children: live.data.schedules.map((s) => ({ id: s.id, label: many ? s.entity_name + ' · ' + s.name : s.name, to: '/payroll/schedules?schedule=' + s.id, count: s.people })),
      onAdd: edit ? () => navigate('/payroll/schedules') : undefined,
      addLabel: t('payroll.act.add_schedule'),
      addTo: edit ? () => navigate('/payroll/runs', { new: '1' }) : undefined,
      addToLabel: t('payroll.act.off_cycle'),
    };
  }, [view, edit, live.data]);
}

/** "Run payroll": the next due period ("Start November payroll" opens its preview; "Continue November payroll" its run). */
function useRunPayroll(): PrimaryAction | null {
  const me = useMe();
  const edit = can(me, 'payroll', 'edit');
  const live = useOp<{ first: NextPeriod | null }>('payruns.next', {}, ['payruns', 'pay_schedules'], { skip: !edit, name: 'payroll.primary' });
  if (!edit) return null;
  const n = live.data?.first ?? null;
  if (n !== null && n.run !== null) return { label: t('payroll.act.continue_period', { period: periodWords(n.period_start, n.period_end) }), short: t('payroll.act.run_payroll'), icon: Play, to: '/payroll/runs/' + n.run.id };
  if (n !== null) return { label: t('payroll.act.start_period', { period: periodWords(n.period_start, n.period_end) }), short: t('payroll.act.run_payroll'), icon: Play, to: '/payroll/run' };
  return { label: t('payroll.act.run_payroll'), short: t('payroll.act.run_payroll'), icon: Play, to: '/payroll/run' };
}

export const primary: PrimaryDef[] = [{ for: 'payroll', usePrimary: useRunPayroll }];

export const profileTabs: ProfileTab[] = [{ key: 'pay', label: t('payroll.tab.pay'), component: ProfilePayTab, perm: 'payroll:view', selfAndTeam: true, order: 50 }];

export const approvalViews = { payrun: PayrunApproval, pay_change: PayChangeApproval, loan: LoanApproval, tax_declaration: TaxDeclarationApproval };

export const homeWidgets: HomeWidget[] = [
  { key: 'payroll_latest', for: 'employee', component: LatestPayslipWidget, order: 30, size: 'narrow' },
  ...outWidgets,
];

export const inboxSections: InboxSection[] = [...outInbox];

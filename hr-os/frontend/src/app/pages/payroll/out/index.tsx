/**
 * Payroll out (owned by the payroll-out builder): pay-out of locked runs,
 * filings, year-end documents, payroll reports and rule packs, plus their
 * pages/payroll/index.tsx (payroll-core) spreads these exports into its own:
 * routes, nav, inboxSections, homeWidgets. The print routes are in
 * pages/print/payroll/out.tsx.
 */
import { periodLabel } from '../../../components/payroll-out/parts.tsx';
import { can, useMe } from '../../../lib/auth.tsx';
import type { HomeWidget, InboxItem, InboxSection, NavChild, RouteDef } from '../../../lib/contract.ts';
import { t } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { FilingsPage } from './Filings.tsx';
import { PackDetailPage, PacksPage } from './Packs.tsx';
import { PayOutPage, RunPayOutPage } from './PayOut.tsx';
import { ReportsPage } from './Reports.tsx';
import { PayOutSettingsPage } from './Settings.tsx';
import type { FilingList } from './types.ts';
import { YearEndPage } from './YearEnd.tsx';

export const routes: RouteDef[] = [
  { path: '/payroll/pay-out', page: PayOutPage, title: t('po.payout.title'), perm: 'payroll:view' },
  { path: '/payroll/pay-out/settings', page: PayOutSettingsPage, title: t('po.settings.title'), perm: 'payroll:view' },
  { path: '/payroll/pay-out/:run', page: RunPayOutPage, title: t('po.payout.title'), perm: 'payroll:view' },
  { path: '/payroll/filings', page: FilingsPage, title: t('po.filings.title'), perm: 'payroll:view' },
  { path: '/payroll/year-end', page: YearEndPage, title: t('po.yearend.title') },
  { path: '/payroll/reports', page: ReportsPage, title: t('po.reports.title'), perm: 'payroll:view|reports:view' },
  { path: '/payroll/packs', page: PacksPage, title: t('po.packs.title'), perm: 'payroll:view' },
  { path: '/payroll/packs/:pack', page: PackDetailPage, title: t('po.packs.title'), perm: 'payroll:view' },
];

export const nav: NavChild[] = [
  { key: 'pay-out', label: t('po.nav.payout'), to: '/payroll/pay-out', perm: 'payroll:view' },
  { key: 'filings', label: t('po.nav.filings'), to: '/payroll/filings', perm: 'payroll:view' },
  { key: 'year-end', label: t('po.nav.yearend'), to: '/payroll/year-end', perm: 'payroll:view' },
  { key: 'reports', label: t('po.nav.reports'), to: '/payroll/reports', perm: 'payroll:view|reports:view' },
  { key: 'packs', label: t('po.nav.packs'), to: '/payroll/packs', perm: 'payroll:view' },
];

/** Filings late, due within 7 days or rejected: for people who handle payroll. */
function useDueFilings(): FilingList | null {
  const me = useMe();
  const live = useOp<FilingList>('filings.list', { show: 'due', days: 7, limit: 20 }, ['filings'], { name: 'filings.due', skip: !can(me, 'payroll', 'edit') });
  return can(me, 'payroll', 'edit') ? live.data : null;
}

function useFilingItems(): InboxItem[] | null {
  const d = useDueFilings();
  if (d === null) return null;
  return d.filings.map((f) => ({
    id: f.id,
    title: t('po.inbox.file', { name: f.name, period: periodLabel(f) }),
    sub: [f.entity_name, f.status === 'rejected' ? t('po.filing.status.rejected') : ''].filter((x) => x !== '').join(' · '),
    link: `#/payroll/filings?filing=${f.id}&show=due`,
    due: f.due_day !== '' ? f.due_day : undefined,
  }));
}

export const inboxSections: InboxSection[] = [{ key: 'filings', label: t('po.inbox.filings'), useItems: useFilingItems, order: 40, perm: 'payroll:edit' }];

// Filings late, due this week or rejected are on Home once, in Needs you (the inbox section
// above); the next 30 days are the Filings page's Due soon. No Home widget repeats them.
export const homeWidgets: HomeWidget[] = [];


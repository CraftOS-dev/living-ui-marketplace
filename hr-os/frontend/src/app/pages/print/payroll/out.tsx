/**
 * Payroll-out print routes (year-end documents, filing worksheets, cash and
 * cheque lists). pages/payroll/index.tsx (payroll-core) spreads `routes`
 * into its own exports, next to its payslip print page.
 */
import type { RouteDef } from '../../../lib/contract.ts';
import { t } from '../../../lib/i18n.ts';
import { CashPrint, FilingPrint } from './FilingPrint.tsx';
import { IssuedDocPrint, YearEndPrint } from './YearEndPrint.tsx';

export const routes: RouteDef[] = [
  { path: '/print/payroll/year-end/doc/:id', page: IssuedDocPrint, title: t('po.yearend.title'), frame: 'print' },
  { path: '/print/payroll/year-end/:doc', page: YearEndPrint, title: t('po.yearend.title'), perm: 'payroll:view', frame: 'print' },
  { path: '/print/payroll/filing/:id', page: FilingPrint, title: t('po.filings.title'), perm: 'payroll:view', frame: 'print' },
  { path: '/print/payroll/cash/:run', page: CashPrint, title: t('po.payout.title'), perm: 'payroll:view', frame: 'print' },
];

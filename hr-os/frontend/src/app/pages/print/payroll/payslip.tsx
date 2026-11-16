/**
 * #/print/payroll/payslip/:id: the payslip on white A4 (plain entity name,
 * no logo): earnings, deductions, employer costs, reimbursements, net, year
 * to date. The route's print frame (frame: 'print') wraps it; this page
 * renders the document only, with the frame's parts.
 */
import { Loading, LoadError, Money } from '../../../components/ui.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../../lib/format.ts';
import { t } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';
import { PrintHead, PrintTable } from '../index.tsx';
import type { Payslip } from '../../payroll/core/types.ts';

export function PayslipPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ payslip: Payslip }>('payslips.get', { payslip: params.id ?? '' }, ['payslips', 'payslip_lines']);
  const s = live.data?.payslip ?? null;
  if (s === null) return live.error !== null ? <LoadError message={live.error} /> : <Loading />;
  const cur = s.currency;
  const m = (minor: number): React.ReactNode => <Money minor={minor} currency={cur} display="code" always />;
  const address = [s.entity_address['line1'], s.entity_address['line2'], [s.entity_address['postcode'], s.entity_address['city']].filter((x) => x).join(' ')].filter((x) => x).join('\n');
  return (
    <>
      <PrintHead entity={s.entity_legal_name} address={address} title={t('payroll.payslip')} meta={fmtRange(s.period_start, s.period_end)} />
      <div className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1 text-[12px]">
        <div><span className="text-[#666]">{t('payroll.print.employee')}: </span>{s.legal_name}</div>
        <div><span className="text-[#666]">{t('payroll.print.number')}: </span>{s.employee_number}</div>
        <div><span className="text-[#666]">{t('payroll.print.title')}: </span>{s.title}</div>
        <div><span className="text-[#666]">{t('payroll.pay_day')}: </span>{fmtDay(s.pay_date, { year: 'always' })}</div>
        <div><span className="text-[#666]">{t('payroll.print.department')}: </span>{s.department}</div>
        <div><span className="text-[#666]">{t('payroll.print.paid_by')}: </span>{t('payroll.method.' + s.pay_method)}{s.bank_split.length > 0 ? ' ' + s.bank_split.map((b) => b.number_masked).join(', ') : ''}</div>
      </div>
      {s.groups.map((g) => (
        <div key={g.key} className="mb-4">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#444]">{t('payroll.group.' + g.key)}</div>
          <PrintTable head={[{ label: t('payroll.print.item') }, { label: t('payroll.print.qty'), right: true }, { label: t('payroll.amount'), right: true }]} rows={g.lines.map((l) => [l.name, l.qty !== 0 && l.qty !== 1 && l.source === 'input' ? String(l.qty) : '', m(l.amount_minor)])} foot={[t('payroll.print.total'), '', m(g.total_minor)]} />
        </div>
      ))}
      <div className="mt-6 flex items-end justify-between border-t-2 border-[#111] pt-3">
        <div className="text-[12px] text-[#555]">
          {t('payroll.gross')} {m(s.gross_minor)} · {t('payroll.deductions')} {m(s.deductions_minor)}
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-[0.08em] text-[#555]">{t('payroll.net_pay')}</div>
          <div className="text-[26px] font-semibold">{m(s.net_minor)}</div>
        </div>
      </div>
      {s.ytd && (
        <div className="mt-5 text-[12px] text-[#555]">
          {t('payroll.ytd_from', { day: fmtDay(s.ytd.from, { year: 'always' }) })}: {t('payroll.gross')} {m(s.ytd.gross_minor)} · {t('payroll.deductions')} {m(s.ytd.deductions_minor)} · {t('payroll.net_pay')} {m(s.ytd.net_minor)}
        </div>
      )}
      <div className="hr-mono mt-8 break-all text-[10.5px] text-[#888]">{s.payrun_number + ' · ' + s.packs.map((p) => (p.name !== undefined && p.name !== '' ? p.name : p.code) + ' ' + p.version).join(', ') + ' · ' + s.hash}</div>
    </>
  );
}

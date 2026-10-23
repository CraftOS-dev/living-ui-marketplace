/**
 * A payslip as paper: the company, the person, the period and pay date,
 * earnings, deductions, net pay, and what the company paid on top. Print
 * sends only the paper to the printer.
 */
import { Printer } from 'lucide-react';
import { RUN_STATE } from '../../components/people/common.tsx';
import { LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { PayslipDetail, SlipLine } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

function Rows({ title, lines, total, totalLabel, currency, minus = false }: { title: string; lines: SlipLine[]; total: number; totalLabel: string; currency: string; minus?: boolean | undefined }): React.JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <section className="mt-6">
      <h3 className="border-b border-[var(--erp-paper-line)] pb-2 text-[12px] font-bold text-[var(--erp-paper-muted)]">{title}</h3>
      <ul>
        {lines.map((l, i) => (
          <li key={`${l.name}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-[var(--erp-paper-line)] py-2 text-[14px]">
            <span className="min-w-0">{l.name}</span>
            <span className="num shrink-0">
              {minus ? '−' : ''}
              {money(l.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex items-baseline justify-between gap-4 py-2 text-[14px] font-bold">
        <span>{totalLabel}</span>
        <span className="num">
          {minus ? '−' : ''}
          {money(total, currency)}
        </span>
      </p>
    </section>
  );
}

export function PayslipPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = query.get('id') ?? '';
  const live = useLive(() => op<PayslipDetail>('payroll.payslip-get', { payslip: id }, { quiet: true }), ['payroll_runs', 'payslips'], [id]);
  useSection('payslip', 'payroll');
  const s = live.data;
  const staff = can(me, 'payroll');
  const goBack = (): void => (staff && s !== null ? back('payrun', { id: s.run.id }) : back('payroll'));
  if (s === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Payslip" back={() => back('payroll')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton rows={4} />
    );
  }
  const cur = s.currency;
  const earnings = s.lines.filter((l) => l.kind === 'earning');
  const deductions = s.lines.filter((l) => l.kind === 'deduction');
  const employer = s.lines.filter((l) => l.kind === 'employer');
  const st = RUN_STATE[s.run.status];
  const e = s.employee;
  const details = e !== null ? [e.number !== '' ? ['Employee number', e.number] : null, e.tax_number !== '' ? ['Tax number', e.tax_number] : null, e.national_id !== '' ? ['National id', e.national_id] : null, e.bank_details !== '' ? ['Paid into', e.bank_details] : null].filter((x): x is string[] => x !== null) : [];

  return (
    <div>
      <PageHeader
        back={goBack}
        eyebrow={
          <>
            <span>Payslip</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
          </>
        }
        title={s.run.month_name}
        subtitle={
          <span>
            {e?.name ?? ''}
            {staff && (
              <>
                {' · '}
                <TextLink tone="muted" onClick={() => navigate('payrun', { id: s.run.id })}>
                  {s.run.number}
                </TextLink>
              </>
            )}
          </span>
        }
        actions={
          <PillButton icon={Printer} dot onClick={() => window.print()}>
            Print
          </PillButton>
        }
      />

      <article className="erp-print erp-rise mx-auto max-w-[760px] rounded-[24px] bg-[var(--erp-paper)] p-6 text-[var(--erp-paper-ink)] shadow-[var(--erp-shadow)] @min-[640px]:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[var(--erp-paper-ink)] pb-5">
          <div>
            <p className="text-[15px] font-bold">{s.company}</p>
            <p className="mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">Payslip</p>
          </div>
          <dl className="text-left text-[13px] @min-[480px]:text-right">
            <div>
              <dt className="inline text-[var(--erp-paper-muted)]">Period </dt>
              <dd className="inline font-bold">{s.run.month_name}</dd>
            </div>
            <div>
              <dt className="inline text-[var(--erp-paper-muted)]">Pay date </dt>
              <dd className="inline font-bold">{dayLabel(s.run.paid_on !== '' ? s.run.paid_on : s.run.pay_date)}</dd>
            </div>
            <div>
              <dt className="inline text-[var(--erp-paper-muted)]">Run </dt>
              <dd className="num inline font-bold">{s.run.number}</dd>
            </div>
          </dl>
        </header>

        {e !== null && (
          <section className="mt-5 grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
            <div>
              <p className="text-[15px] font-bold">{e.name}</p>
              <p className="text-[13px] text-[var(--erp-paper-muted)]">{[e.job_title, e.department?.name ?? ''].filter((x) => x !== '').join(' · ')}</p>
            </div>
            {details.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] @min-[480px]:justify-self-end">
                {details.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-[var(--erp-paper-muted)]">{k}</dt>
                    <dd className="num font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        <Rows title="Earnings" lines={earnings} total={s.gross} totalLabel="Gross pay" currency={cur} />
        <Rows title="Deductions" lines={deductions} total={s.deductions} totalLabel="Total deductions" currency={cur} minus />

        <section className="mt-6 flex items-center justify-between gap-4 rounded-[16px] border-2 border-[var(--erp-paper-ink)] px-5 py-4">
          <span className="text-[15px] font-bold">Net pay</span>
          <span className="num text-[26px] font-extrabold tracking-[-0.02em]">{money(s.net, cur)}</span>
        </section>

        {employer.length > 0 && (
          <section className="mt-6">
            <h3 className="border-b border-[var(--erp-paper-line)] pb-2 text-[12px] font-bold text-[var(--erp-paper-muted)]">Paid by the company on top of your pay</h3>
            <ul>
              {employer.map((l, i) => (
                <li key={`${l.name}-${i}`} className="flex items-baseline justify-between gap-4 py-2 text-[13px] text-[var(--erp-paper-muted)]">
                  <span>{l.name}</span>
                  <span className="num">{money(l.amount, cur)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {s.note !== '' && <p className="mt-6 text-[13px] text-[var(--erp-paper-muted)]">{s.note}</p>}
      </article>
    </div>
  );
}

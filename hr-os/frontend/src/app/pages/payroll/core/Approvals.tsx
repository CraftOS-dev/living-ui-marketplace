/**
 * The decision context inside Inbox approval cards (pay runs, pay changes,
 * loans, tax declarations and tax profile changes) and the employee's Home
 * widget (the latest payslip).
 */
import { Money, Notice, Skeleton } from '../../../components/ui.tsx';
import type { ApprovalViewProps, HomeWidgetProps } from '../../../lib/contract.ts';
import { fmtDay, monthName } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { useOp } from '../../../lib/live.ts';

type Obj = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="hr-label">{label}</div>
      <div className="hr-mono hr-num text-[13px]">{children}</div>
    </div>
  );
}

export function PayrunApproval({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] as Obj) ?? {};
  const cur = str(approval['currency']);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('payroll.net_to_pay')}>
          <Money minor={num(p['to_pay_minor'] ?? p['net_minor'])} currency={cur} />
        </Fact>
        {num(p['held_count']) > 0 && (
          <Fact label={tn('payroll.approval.held', num(p['held_count']))}>
            <Money minor={num(p['held_minor'])} currency={cur} />
          </Fact>
        )}
        <Fact label={t('payroll.gross')}>
          <Money minor={num(p['gross_minor'])} currency={cur} />
        </Fact>
        <Fact label={t('payroll.employer_cost')}>
          <Money minor={num(p['employer_minor'])} currency={cur} />
        </Fact>
        <Fact label={t('payroll.pay_day')}>{fmtDay(str(p['pay_date']))}</Fact>
      </div>
      <div className="text-[12px] text-[var(--hr-muted)]">
        {tn('payroll.approval.paid', num(p['to_pay_count'] ?? p['employee_count']))}
        {num(p['warnings']) > 0 ? ' · ' + tn('payroll.lock.warnings', num(p['warnings'])) : ''}
        {' · '}
        <a className="cursor-pointer underline" href={'#/payroll/runs/' + str(p['payrun'])}>
          {t('payroll.open_run', { number: str(p['number']) })}
        </a>
      </div>
    </div>
  );
}

export function PayChangeApproval({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] as Obj) ?? {};
  const cur = str(approval['currency']);
  const before = num(p['before_minor']);
  const after = num(p['amount_minor']);
  const pct = before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-3">
        <Fact label={t('payroll.comp.now')}>{before > 0 ? <><Money minor={before} currency={cur} />{' / ' + t('payroll.per.' + str(p['before_per']))}</> : t('payroll.not_set')}</Fact>
        <Fact label={t('payroll.comp.new')}><Money minor={after} currency={cur} />{' / ' + t('payroll.per.' + str(p['per']))}</Fact>
        <Fact label={t('payroll.comp.change')}>{pct === null ? '' : (pct > 0 ? '+' : '') + pct + '%'}</Fact>
      </div>
      <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.comp.from_day', { day: fmtDay(str(p['effective_from'])), reason: t('payroll.comp_reason.' + str(p['reason'])) })}</div>
      {p['retro'] === true && <Notice tone="warn">{t('payroll.comp.retro')}</Notice>}
    </div>
  );
}

export function LoanApproval({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] as Obj) ?? {};
  const cur = str(approval['currency']);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Fact label={t('payroll.loan.amount')}><Money minor={num(p['principal_minor'])} currency={cur} /></Fact>
      <Fact label={t('payroll.loan.total')}><Money minor={num(p['total_minor'])} currency={cur} /></Fact>
      <Fact label={t('payroll.loan.installment')}><Money minor={num(p['installment_minor'])} currency={cur} />{' × ' + num(p['installments'])}</Fact>
      <Fact label={t('payroll.loan.first')}>{str(p['start_period']) === '' ? '' : monthName(Number(str(p['start_period']).slice(5, 7)), 'long') + ' ' + str(p['start_period']).slice(0, 4)}</Fact>
      {str(p['reason']) !== '' && <div className="hr-wrap col-span-full text-[12px] text-[var(--hr-muted)]">{str(p['reason'])}</div>}
    </div>
  );
}

export function TaxDeclarationApproval({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] as Obj) ?? {};
  const cur = str(approval['currency']);
  if (p['kind'] === 'profile') {
    const ch = (p['changes'] as { key: string; label: string; before: unknown; after: unknown }[]) ?? [];
    return (
      <div className="flex flex-col gap-1">
        <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.tax.change_from', { day: fmtDay(str(p['effective_from'])) })}</div>
        {ch.map((c) => (
          <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-[13px]">
            <span className="hr-wrap min-w-0">{c.label}</span>
            <span className="hr-mono text-[var(--hr-faint)] line-through">{str(c.before)}</span>
            <span className="hr-mono">{str(c.after)}</span>
          </div>
        ))}
      </div>
    );
  }
  const items = (p['items'] as { section: string; amount_minor: number; description: string }[]) ?? [];
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.decl.summary', { year: str(p['fiscal_year']), regime: str(p['regime']), n: num(p['proofs']) })}</div>
      {items.map((i, k) => (
        <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)_auto] gap-3 text-[13px]">
          <span className="hr-mono">{i.section}</span>
          <span className="hr-wrap min-w-0 text-[var(--hr-muted)]">{i.description}</span>
          <Money minor={i.amount_minor} currency={cur} />
        </div>
      ))}
    </div>
  );
}

/** Home (employee): the latest payslip (a skeleton while it loads, never "no payslips" then). */
export function LatestPayslipWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const live = useOp<{ payslips: { id: string; period_start: string; period_end: string; pay_date: string; currency: string; net_minor: number; viewed: boolean }[] }>('payslips.mine', { limit: 1 }, ['payslips'], { name: 'payroll.latest' });
  const s = live.data?.payslips[0] ?? null;
  return (
    <a href={s ? '#/payroll/payslip/' + s.id : '#/payroll'} className="hr-panel block cursor-pointer px-4 py-3 transition-colors duration-150 hover:bg-[var(--hr-hover)]">
      <div className="mb-1 flex items-center gap-2">
        {index !== undefined && <span className="hr-label !text-[var(--hr-faint)]">{index}</span>}
        <span className="hr-label">{t('payroll.widget.latest')}</span>
      </div>
      {live.data === null ? (
        live.error !== null ? (
          <div className="text-[13px] text-[var(--hr-muted)]">{live.error}</div>
        ) : (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label={t('ui.loading')}>
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="w-3/5" />
          </div>
        )
      ) : s === null ? (
        <div className="text-[13px] text-[var(--hr-muted)]">{t('payroll.empty.no_payslips')}</div>
      ) : (
        <>
          <Money minor={s.net_minor} currency={s.currency} className="hr-mono hr-num block text-[26px] font-light leading-tight" />
          <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.pay_day_on', { day: fmtDay(s.pay_date) })}</div>
        </>
      )}
    </a>
  );
}

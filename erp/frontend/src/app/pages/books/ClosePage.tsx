/**
 * Month-end close: pick a month, see what is left to do (computed from the
 * data, nothing to tick by hand), fix each item from its link, check the
 * trial balance, then close the month so only people with full accounting
 * rights can post into it. Your AI agent can review the month first.
 */
import { AlertCircle, ArrowUpRight, CheckCircle2, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { AskAgent } from '../../components/AskAgent.tsx';
import { monthShort } from '../../components/books/period.ts';
import { ProgressRing } from '../../components/controls.tsx';
import { MonthField } from '../../components/pickers.tsx';
import { Card, CardHeader, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import type { Collection } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Page, Query } from '../../lib/router.ts';
import type { CloseCheck, CloseStatus } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

const READS_CLOSE: Collection[] = ['documents', 'bank_lines', 'journals', 'ledger_months', 'expense_claims', 'payroll_runs', 'assets', 'proposals', 'settings'];

/** Plain words and where to fix each check, by its key. */
const CHECKS: Record<string, { title: string; fix: string; links: { label: string; page: Page; query?: Query | undefined }[] }> = {
  drafts: { title: 'Drafts are posted or deleted', fix: 'Invoices, bills, deliveries and receipts still in draft', links: [{ label: 'Invoices', page: 'invoices', query: { status: 'draft' } }, { label: 'Bills', page: 'bills', query: { status: 'draft' } }] },
  bank: { title: 'Bank statements are reconciled', fix: 'Statement lines not matched to the books', links: [{ label: 'Banks', page: 'banks' }] },
  grni: { title: 'Goods received are billed', fix: 'Received from suppliers and not billed yet', links: [{ label: 'Orders to bill', page: 'purchase-orders', query: { status: 'to_bill' } }] },
  claims: { title: 'Approved expense claims are posted', fix: 'Claims approved and not in the books', links: [{ label: 'Claims', page: 'claims' }] },
  payroll: { title: 'Payroll is posted', fix: "The month's pay run", links: [{ label: 'Payroll', page: 'payroll' }] },
  depreciation: { title: 'Depreciation is posted', fix: 'Fixed assets not depreciated through the month', links: [{ label: 'Fixed assets', page: 'assets' }] },
  trial_balance: { title: 'The books balance', fix: 'Debits equal credits for the month', links: [] },
  proposals: { title: "Your AI agent's proposals are decided", fix: 'Waiting for approval', links: [{ label: 'Proposals', page: 'proposals' }] },
};

function lastMonth(): string {
  return addMonths(today().slice(0, 7), -1);
}

export function ClosePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const monthQ = query.get('month');
  const month = monthQ !== null && /^\d{4}-\d{2}$/.test(monthQ) ? monthQ : lastMonth();
  const data = useLive(() => op<CloseStatus>('close.status', { month }, { quiet: true }), READS_CLOSE, [month]);
  const [confirmEl, confirm] = useConfirm();
  const s = data.data;
  const canClose = can(me, 'accounting', 'full');
  const setMonth = (m: string): void => replaceQuery('close', { month: m });

  if (data.error !== null && s === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (s === null) return <PageSkeleton rows={8} />;

  const done = s.checks.filter((c) => c.ok).length;
  const ended = s.to < today();
  const label = monthLabel(s.month);

  const close = async (): Promise<void> => {
    const left = s.checks.length - done;
    const ok = await confirm(
      <>
        {left > 0 ? (
          <p className="mb-2 font-semibold text-[var(--erp-amber-text)]">
            {left} {left === 1 ? 'check is' : 'checks are'} not done yet.
          </p>
        ) : null}
        Closing {label} locks the books through {dayLabel(s.to)}: only people with full accounting rights can still post into it. It can be reopened by an administrator.
      </>,
      `Close ${label}?`,
      `Close ${monthLabel(s.month, true)}`,
      false,
    );
    if (!ok) return;
    try {
      data.set(await op<CloseStatus>('close.month', { month: s.month }));
      toast.success(`${label} is closed`);
    } catch {
      /* shown */
    }
  };

  const reopen = async (): Promise<void> => {
    const ok = await confirm(<>Entries dated from {dayLabel(s.from)} on can be posted again by anyone with the rights.</>, `Reopen ${label}?`, 'Reopen', false);
    if (!ok) return;
    try {
      data.set(await op<CloseStatus>('close.reopen', { month: s.month }));
      toast.success(`${label} is open again`);
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Month-end close" subtitle="Check the month, then close it so nothing changes it by accident" actions={<MonthField value={s.month} onChange={setMonth} ariaLabel="Month" max={today().slice(0, 7)} />} />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">{label}</p>
              <p className="mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{s.closed ? 'Closed' : !ended ? 'Still running' : s.ready ? 'Ready to close' : `${s.checks.length - done} to do`}</p>
              <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
                {s.closed ? `Locked through ${dayLabel(s.soft_lock_date)}` : !ended ? `It ends ${dayLabel(s.to)}; close it after that` : s.ready ? 'Every check is done' : 'Fix what is left below, or close it anyway'}
              </p>
            </div>
            <ProgressRing value={s.checks.length > 0 ? done / s.checks.length : 0} size={84} dark tone={s.ready ? 'green' : 'accent'}>
              {done}/{s.checks.length}
            </ProgressRing>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => navigate('report', { kind: 'pnl', from: s.from, to: s.to })} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Sales in the month</span>
              <span className="num block truncate text-[15px] font-bold">{money(s.revenue, s.currency)}</span>
            </button>
            <button type="button" onClick={() => navigate('report', { kind: 'pnl', from: s.from, to: s.to })} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{s.net_profit >= 0 ? 'Profit' : 'Loss'}</span>
              <span className={cn('num block truncate text-[15px] font-bold', s.net_profit < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(s.net_profit, s.currency)}</span>
            </button>
          </div>
          {canClose && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!s.closed && ended && (
                <PillButton variant="accent" icon={Lock} onClick={() => void close()}>
                  Close {monthLabel(s.month, true)}
                </PillButton>
              )}
              {s.closed && me.admin && (
                <PillButton variant="light" icon={LockOpen} onClick={() => void reopen()}>
                  Reopen {monthLabel(s.month, true)}
                </PillButton>
              )}
            </div>
          )}
        </Card>

        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <CardHeader title="Locked periods" icon={ShieldCheck} />
          <dl className="flex flex-col gap-3">
            <div className="rounded-[18px] bg-[var(--erp-card)] p-3">
              <dt className="text-[12px] text-[var(--erp-muted)]">Closed through</dt>
              <dd className="text-[15px] font-bold">{s.soft_lock_date !== '' ? dayLabel(s.soft_lock_date) : 'Nothing closed yet'}</dd>
              <dd className="mt-0.5 text-[12px] text-[var(--erp-muted)]">Only full accounting rights post on or before it</dd>
            </div>
            <div className="rounded-[18px] bg-[var(--erp-card)] p-3">
              <dt className="text-[12px] text-[var(--erp-muted)]">Locked for good through</dt>
              <dd className="text-[15px] font-bold">{s.hard_lock_date !== '' ? dayLabel(s.hard_lock_date) : 'Not set'}</dd>
              <dd className="mt-0.5 text-[12px] text-[var(--erp-muted)]">Nobody posts on or before it (set in Settings)</dd>
            </div>
          </dl>
          {!s.closed && ended && (
            <div className="mt-4">
              <AskAgent kind="close_review_requested" params={{ month: s.month }} label="Ask your AI agent to review" variant="dark" size="sm" align="start" />
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <Card className="@min-[900px]:col-span-8" delay={2}>
          <CardHeader title="Checklist" subtitle={`Worked out from the books for ${label}`} />
          <ul className="flex flex-col gap-2">
            {s.checks.map((c) => (
              <CheckRow key={c.key} c={c} from={s.from} to={s.to} />
            ))}
          </ul>
        </Card>
        <Card className="@min-[900px]:col-span-4" delay={3}>
          <CardHeader title="The last 12 months" />
          <div className="grid grid-cols-4 gap-2">
            {s.months.map((m) => (
              <button
                key={m.month}
                type="button"
                onClick={() => setMonth(m.month)}
                aria-pressed={m.month === s.month}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-[16px] py-2.5 text-[12px] font-semibold transition-colors',
                  m.month === s.month ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]',
                )}
              >
                {monthShort(m.month)}
                {m.closed ? <Lock size={13} aria-label="Closed" /> : <span className="block h-[13px]" aria-hidden />}
              </button>
            ))}
          </div>
        </Card>
      </div>
      {confirmEl}
    </div>
  );
}

function CheckRow({ c, from, to }: { c: CloseCheck; from: string; to: string }): React.JSX.Element {
  const words = CHECKS[c.key];
  const links = c.key === 'trial_balance' ? [{ label: 'Trial balance', page: 'report' as Page, query: { kind: 'trial-balance', from, to } }] : (words?.links ?? []);
  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] px-4 py-3', c.ok ? 'bg-[var(--erp-row)]' : 'bg-[var(--erp-amber)]/15')}>
      <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-[var(--erp-green)]/15 text-[var(--erp-green-text)]' : 'bg-[var(--erp-amber)]/30 text-[var(--erp-amber-text)]')}>
          {c.ok ? <CheckCircle2 size={18} aria-label="Done" /> : <AlertCircle size={18} aria-label="To do" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">{words?.title ?? c.label}</span>
          <span className="block text-[12px] text-[var(--erp-muted)]">{c.ok ? (words?.fix ?? '') : c.detail !== '' ? c.detail : (words?.fix ?? c.label)}</span>
        </span>
      </span>
      {(!c.ok || c.key === 'trial_balance') && (
        <span className="flex flex-wrap items-center gap-2 pl-12 @min-[480px]:pl-0">
          {!c.ok && c.count > 0 && c.key !== 'grni' && c.key !== 'trial_balance' && c.key !== 'payroll' && (
            <StatusPill tone="warn" size="sm">
              {c.count} left
            </StatusPill>
          )}
          {links.map((l) => (
            <PillButton key={l.label} size="sm" variant="light" icon={ArrowUpRight} onClick={() => navigate(l.page, l.query)}>
              {l.label}
            </PillButton>
          ))}
        </span>
      )}
    </li>
  );
}

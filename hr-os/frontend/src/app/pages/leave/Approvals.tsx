/**
 * The decision context on Inbox cards for leave approvals: the days and the
 * balance before and after, who else in the team is away then, holidays and
 * locked days in the range, the checks it went past and the certificate.
 */
import { ArrowRight, FileText, Lock, Users } from 'lucide-react';
import { Button, Fact, Notice, PersonChip, Skeleton } from '../../components/ui.tsx';
import { download } from '../../lib/api.ts';
import type { ApprovalViewProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { amount, figure, READS, unitWord, whenText } from './data.ts';
import type { ApprovalContext } from './types.ts';

function useContext(approval: Record<string, unknown>): ApprovalContext | null {
  const id = String(approval['id'] ?? '');
  return useOp<ApprovalContext>('leave.approval-context', { approval: id }, READS, { name: 'leave.approval-context' }).data;
}

function BalanceLine({ b }: { b: NonNullable<ApprovalContext['balance']> }): React.JSX.Element {
  return (
    <Fact label={b.name} mono>
      <span className="text-[var(--hr-muted)]">{figure(b.before)}</span>
      <ArrowRight size={11} aria-label={t('leave.ctx.becomes')} className="mx-1 inline align-[-1px] text-[var(--hr-muted)]" />
      <span className={b.after !== null && b.after < 0 ? 'text-[var(--hr-bad)]' : ''}>{figure(b.after)}</span> {unitWord(b.unit, b.after)}
    </Fact>
  );
}

export function LeaveRequestView({ approval }: ApprovalViewProps): React.JSX.Element {
  const c = useContext(approval);
  if (c === null || c.request === undefined) return <Skeleton className="h-10 w-full" />;
  const r = c.request;
  const cancel = c.action === 'cancel';
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={cancel ? t('leave.ctx.cancel_from') : t('leave.ctx.when')}>{cancel ? fmtRange(r.cancel_from !== '' ? r.cancel_from : r.start, r.end) : whenText(r)}</Fact>
        <Fact label={t('leave.ctx.takes')} mono>{amount(r.amount, r.unit)}</Fact>
        {c.balance !== null && c.balance !== undefined ? <BalanceLine b={c.balance} /> : <Fact label={t('leave.type')}>{r.type_name}</Fact>}
        <Fact label={t('leave.ctx.role')}>{c.title !== '' ? c.title : t('ui.none')}</Fact>
      </div>
      {r.reason !== '' && <p className="hr-wrap border-l-2 border-[var(--hr-line-2)] pl-2.5 text-[13px] leading-[18px] text-[var(--hr-ink-2)]">{r.reason}</p>}
      {(c.warnings ?? []).filter((w) => w.code !== 'clash').map((w) => (
        <Notice key={w.code + w.message} tone={w.overridden === true || w.severity === 'block' ? 'warn' : 'neutral'}>
          {w.overridden === true ? t('leave.went_past', { what: w.message }) : w.message}
        </Notice>
      ))}
      {(c.blocks ?? []).map((b) => (
        <Notice key={b.id} tone="warn">
          <Lock size={12} aria-hidden className="mr-1 inline" />
          {t('leave.ctx.locked', { reason: b.reason, range: fmtRange(b.from, b.to) })}
        </Notice>
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--hr-muted)]">
        <span className="hr-label inline-flex items-center gap-1">
          <Users size={11} aria-hidden />
          {t('leave.ctx.away')}
        </span>
        {(c.away ?? []).length === 0 ? (
          <span>{t('leave.ctx.nobody_away')}</span>
        ) : (
          (c.away ?? []).slice(0, 8).map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5">
              <PersonChip name={a.name} size={18} strong={false} />
              <span className="hr-mono text-[12px]">{fmtRange(a.start, a.end)}</span>
            </span>
          ))
        )}
      </div>
      {(c.holidays ?? []).length > 0 && <p className="text-[12px] text-[var(--hr-muted)]">{t('leave.form.holidays_inside', { list: (c.holidays ?? []).map((h) => `${fmtDay(h.day)} ${h.name}`).join(', ') })}</p>}
      {r.has_attachment && (
        <div>
          <Button size="sm" icon={FileText} onClick={() => void download('leave.attachment', { request: r.id }, 'open')}>
            {t('leave.open_certificate')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function EncashView({ approval }: ApprovalViewProps): React.JSX.Element {
  const c = useContext(approval);
  if (c === null || c.encash === undefined) return <Skeleton className="h-10 w-full" />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Fact label={t('leave.ctx.cash_in')} mono>{amount(c.encash.days, 'day')}</Fact>
      {c.balance !== null && c.balance !== undefined && <BalanceLine b={c.balance} />}
      <Fact label={t('leave.ctx.paid_with')}>{t('leave.ctx.next_run')}</Fact>
      {c.encash.reason !== '' && <p className="hr-wrap col-span-full text-[13px] text-[var(--hr-ink-2)]">{c.encash.reason}</p>}
    </div>
  );
}

export function CompOffView({ approval }: ApprovalViewProps): React.JSX.Element {
  const c = useContext(approval);
  if (c === null || c.comp_off === undefined) return <Skeleton className="h-10 w-full" />;
  const w = c.worked;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('leave.ctx.worked')}>{fmtDay(c.comp_off.worked_day, { weekday: true })}</Fact>
        <Fact label={t('leave.ctx.day_was')}>{w?.holiday !== null && w?.holiday !== undefined ? w.holiday.name : w?.rest_day === true ? t('leave.ctx.rest_day') : t('leave.ctx.work_day')}</Fact>
        <Fact label={t('leave.ctx.earns')} mono>{amount(c.comp_off.days, 'day')}{c.comp_off.hours > 0 ? ` (${c.comp_off.hours} h)` : ''}</Fact>
        <Fact label={t('leave.ctx.use_by')} mono>{c.comp_off.expires !== '' ? fmtDay(c.comp_off.expires, { year: 'always' }) : t('leave.ctx.no_expiry')}</Fact>
      </div>
      {w !== undefined && w.holiday === null && !w.rest_day && <Notice tone="warn">{t('leave.ctx.scheduled_day')}</Notice>}
      {c.comp_off.reason !== '' && <p className="hr-wrap text-[13px] text-[var(--hr-ink-2)]">{c.comp_off.reason}</p>}
    </div>
  );
}

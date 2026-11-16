/**
 * The decision context inside an Inbox approval card (routes.tsx
 * approvalViews): a claim shows its expenses with receipt thumbnails and
 * flags, and lets the approver leave single expenses out with a reason
 * before the one-tap approve; an advance shows what it is for and when it
 * is needed; a trip shows where, when and the estimate.
 */
import { useState } from 'react';
import { Ban, Undo2 } from 'lucide-react';
import { Money, Button, Dialog, Fact, IconButton, Spinner, Textarea } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import type { ApprovalViewProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import type { ClaimDetail, Line, TripDetail } from '../../pages/expenses/types.ts';
import { READS } from '../../pages/expenses/types.ts';
import { CategoryIcon, Flags, ReceiptDialog, ReceiptThumb } from './parts.tsx';

export function ClaimApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const id = String(approval['ref_id'] ?? '');
  const live = useOp<{ claim: ClaimDetail }>('claims.get', { claim: id }, READS, { name: 'claims.get.inbox' });
  const [viewing, setViewing] = useState<Line | null>(null);
  const [leaving, setLeaving] = useState<Line | null>(null);
  const [why, setWhy] = useState('');
  const c = live.data?.claim ?? null;
  if (c === null) return live.error !== null ? <div className="text-[12px] text-[var(--hr-muted)]">{live.error}</div> : <Spinner />;
  const shown = c.lines.slice(0, 8);
  const flagged = c.lines.filter((l) => l.flags.length > 0).length;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {shown.map((l) => (
          <li key={l.id} className="flex items-center gap-2.5 border-b border-[var(--hr-hair)] py-1.5 last:border-b-0">
            <ReceiptThumb line={l} size={34} onOpen={l.receipt ? () => setViewing(l) : undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
                <CategoryIcon name={l.category_icon} size={12} className="shrink-0 text-[var(--hr-muted)]" />
                <span className={`truncate font-medium ${l.status === 'rejected' ? 'text-[var(--hr-muted)] line-through' : ''}`}>{l.merchant !== '' ? l.merchant : l.category_name}</span>
                <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtDay(l.day)}</span>
              </div>
              {l.status === 'rejected' ? <div className="hr-wrap text-[12px] text-[var(--hr-bad)]">{t('exp.line.left_out', { why: l.reject_reason })}</div> : <Flags flags={l.flags} max={2} className="mt-0.5" />}
              {l.reason !== '' && l.status !== 'rejected' && <div className="hr-wrap text-[12px] text-[var(--hr-muted)]">{t('exp.claim.their_reason', { why: l.reason })}</div>}
            </div>
            <Money minor={l.base_minor} currency={c.currency} className={`text-[12px] ${l.status === 'rejected' ? 'text-[var(--hr-muted)] line-through' : ''}`} />
            {c.can.reject_lines &&
              (l.status === 'rejected' ? (
                <IconButton icon={Undo2} label={t('exp.line.put_back')} size={26} onClick={() => void act([patch(l.id, { status: 'included' })], () => op('claims.reject-lines', { claim: c.id, lines: [l.id], undo: true }), READS)} />
              ) : (
                <IconButton icon={Ban} label={t('exp.line.leave_out')} size={26} tone="danger" onClick={() => (setWhy(''), setLeaving(l))} />
              ))}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--hr-muted)]">
        {c.lines.length > shown.length && <span>{tn('exp.more_lines', c.lines.length - shown.length)}</span>}
        {flagged > 0 && <span>{tn('exp.n_flagged', flagged)}</span>}
        {c.travel_label !== '' && <span>{t('exp.claim.on_trip', { trip: c.travel_label })}</span>}
        <span className="flex-1" />
        <a href={`#/expenses/claims/${c.number}`} className="hr-link hr-focus font-medium text-[var(--hr-ink-2)] hover:text-[var(--hr-ink)]">
          {t('exp.open_claim')}
        </a>
      </div>
      <ReceiptDialog line={viewing} onClose={() => setViewing(null)} />
      {leaving !== null && (
        <Dialog
          open
          onClose={() => setLeaving(null)}
          title={t('exp.line.leave_out')}
          meta={leaving.merchant !== '' ? leaving.merchant : leaving.category_name}
          footer={
            <>
              <Button variant="ghost" onClick={() => setLeaving(null)}>
                {t('ui.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={why.trim() === ''}
                onClick={() => {
                  const l = leaving;
                  setLeaving(null);
                  void act([patch(l.id, { status: 'rejected', reject_reason: why.trim() })], () => op('claims.reject-lines', { claim: c.id, lines: [l.id], reason: why.trim() }), READS);
                }}
              >
                {t('exp.line.leave_out')}
              </Button>
            </>
          }
        >
          <Textarea value={why} onChange={(e) => setWhy(e.target.value)} minRows={3} aria-label={t('exp.reason')} placeholder={t('exp.reason_ph')} autoFocus />
        </Dialog>
      )}
    </div>
  );
}

export function AdvanceApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] ?? {}) as { number?: string; purpose?: string; travel?: string; needed_by?: string; pay_via?: string };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Fact label={t('exp.f.purpose')}>{p.purpose ?? ''}</Fact>
      <Fact label={t('exp.f.needed_by')} mono>
        {p.needed_by !== undefined && p.needed_by !== '' ? fmtDay(p.needed_by) : t('ui.none')}
      </Fact>
      <Fact label={t('exp.claim.trip')}>{p.travel !== undefined && p.travel !== '' ? <a className="hr-link hr-focus hr-mono" href={`#/expenses/travel/${p.travel}`}>{p.travel}</a> : t('ui.none')}</Fact>
      <Fact label={t('exp.col.pay_via')}>{p.pay_via === 'payroll' ? t('exp.pay_via.payroll') : t('exp.pay_via.bank')}</Fact>
    </div>
  );
}

export function TravelApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const id = String(approval['ref_id'] ?? '');
  const live = useOp<{ trip: TripDetail }>('travel.get', { travel: id }, READS, { name: 'travel.get.inbox' });
  const x = live.data?.trip ?? null;
  if (x === null) return live.error !== null ? <div className="text-[12px] text-[var(--hr-muted)]">{live.error}</div> : <Spinner />;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('exp.f.purpose')}>{t(`exp.purpose.${x.purpose}`)}</Fact>
        <Fact label={t('exp.trip.days')}>{`${fmtRange(x.from_day, x.to_day)} · ${tn('exp.n_days', x.days)}`}</Fact>
        <Fact label={t('exp.trip.destinations')}>{x.destinations.map((d) => d.city + (d.country !== '' ? ` (${d.country})` : '')).join(', ')}</Fact>
        <Fact label={t('exp.trip.estimate')}>
          <Money minor={x.estimate_minor} currency={x.currency} />
        </Fact>
      </div>
      {x.costs.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--hr-muted)]">
          {x.costs.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {c.category_name !== '' ? c.category_name : t('exp.trip.cost')} <Money minor={c.amount_minor} currency={x.currency} />
            </li>
          ))}
        </ul>
      )}
      {x.details !== '' && <p className="hr-wrap text-[12px] text-[var(--hr-ink-2)]">{x.details}</p>}
    </div>
  );
}

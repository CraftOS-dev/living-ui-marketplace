/**
 * One payment: how much, from or to whom, through which account; what it
 * settled (each allocation can be taken back); what is left as credit
 * (apply it to open invoices or bills); its entry in the books; the bank
 * statement line it was matched to; void; and its history.
 */
import { useState } from 'react';
import { ArrowUpRight, Ban, BookOpen, Check, FileText, Landmark, Trash2, Undo2, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { BooksDetail, ConfirmPosting } from '../../components/Books.tsx';
import { previewLines } from '../../components/books/util.ts';
import { Menu, ProgressRing } from '../../components/controls.tsx';
import { ApplyCredit } from '../../components/money/ApplyCredit.tsx';
import { DirIcon } from '../../components/money/bits.tsx';
import { methodLabel } from '../../components/money/labels.ts';
import { ProposalCard } from '../../components/Proposal.tsx';
import { PAYMENT_STATUS, docTypeLabel, statusOf } from '../../components/status.ts';
import { ActorPill, Card, CardHeader, Empty, Field, LoadError, Notice, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink, softInput, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import { back, navigate } from '../../lib/router.ts';
import type { Proposal } from '../../lib/types.ts';
import type { Journal } from '../../lib/types/books.ts';
import type { Payment } from '../../lib/types/money.ts';
import type { PageProps } from '../../routes.tsx';

export function PaymentPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const base = baseCurrency(me);
  const data = useLive(() => op<Payment>('payments.get', { payment: id }, { quiet: true }), [...READS.money, 'documents'], [id]);
  const p = data.data;
  const journalId = p?.journal?.id ?? '';
  const journal = useLive(() => (journalId === '' ? Promise.resolve(null) : op<Journal>('journals.get', { journal: journalId }, { quiet: true }).catch(() => null)), ['journals'], [journalId]);
  const proposals = useLive(() => op<{ proposals: Proposal[] }>('proposals.list', { status: 'waiting' }, { quiet: true }).then((r) => r.proposals), ['proposals'], []);
  const [voiding, setVoiding] = useState(false);
  const [posting, setPosting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmEl, confirm] = useConfirm();

  if (data.error !== null && p === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (p === null) return <PageSkeleton />;

  const st = p.state === 'posted' && p.unallocated > 0 ? statusOf(PAYMENT_STATUS, 'unallocated') : statusOf(PAYMENT_STATUS, p.state);
  const cur = p.currency;
  const incoming = p.direction === 'in';
  const docWord = incoming ? 'invoice' : 'bill';
  const share = p.amount > 0 ? (p.amount - p.unallocated) / p.amount : 0;
  const waiting = (proposals.data ?? []).filter((x) => x.target.entity === 'payments' && x.target.id === p.id);

  const takeBack = async (allocation: string, label: string): Promise<void> => {
    const ok = await confirm(<>The {label} is open again and this amount goes back to credit on {p.party?.name ?? 'the party'}.</>, `Take back ${label}?`, 'Take back', false);
    if (!ok) return;
    try {
      await op('payments.unallocate', { allocation });
      toast.success('Taken back');
      data.reload();
    } catch {
      /* shown */
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm('This draft payment is deleted. Nothing was posted, so the books do not change.', 'Delete this draft?');
    if (!ok) return;
    try {
      await op('payments.delete', { payment: p.id });
      toast.success('Draft deleted');
      navigate('payments');
    } catch {
      /* shown */
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('payments')}
        eyebrow={
          <>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
            <span>{incoming ? 'Payment received' : 'Payment made'}</span>
            {p.prepared_actor === 'agent' && <ActorPill actor="agent" />}
          </>
        }
        title={p.number !== '' ? p.number : 'Draft payment'}
        subtitle={`${p.party?.name ?? ''} · ${dayLabel(p.date)}`}
        actions={
          <>
            {p.can.void && (
              <PillButton variant="light" icon={Ban} onClick={() => setVoiding(true)}>
                Void
              </PillButton>
            )}
            {p.can.post && (
              <PillButton icon={Check} dot onClick={() => setPosting(true)}>
                Post payment
              </PillButton>
            )}
            {p.can.apply && p.open_docs.length > 0 && (
              <PillButton icon={FileText} dot onClick={() => setApplying(true)}>
                Apply to {docWord}s
              </PillButton>
            )}
            <Menu
              items={[
                { label: 'Open the account', icon: Landmark, onClick: () => navigate('bank', { id: p.bank?.id ?? '' }), hidden: p.bank === null },
                { label: 'Open the entry in the books', icon: BookOpen, onClick: () => navigate('journal', { id: p.journal?.id ?? '' }), hidden: p.journal === null },
                { label: 'Delete the draft', icon: Trash2, danger: true, onClick: () => void remove(), hidden: !(p.state === 'draft' && p.can.edit) },
              ]}
            />
          </>
        }
      />

      {p.state === 'void' && (
        <Notice tone="neutral" icon={Ban}>
          Voided{p.voided_by !== '' ? ` by ${p.voided_by}` : ''}
          {p.voided_at !== '' ? ` on ${dayLabel(p.voided_at.slice(0, 10))}` : ''}
          {p.void_reason !== '' ? `: ${p.void_reason}` : ''}. What it settled is open again and its entry is reversed.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          <Card tone="dark" delay={1}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">{incoming ? 'Received from' : 'Paid to'}</p>
                <button type="button" onClick={() => navigate('party', { id: p.party?.id ?? '', role: incoming ? 'customer' : 'supplier' })} className="mt-0.5 max-w-full truncate text-left text-[15px] font-bold hover:underline">
                  {p.party?.name ?? ''}
                </button>
              </div>
              <DirIcon dir={p.direction} size={44} />
            </div>
            <p className={cn('num mt-4 text-[26px] font-extrabold leading-8 tracking-[-0.02em]', p.state === 'void' && 'text-[var(--erp-on-dark-muted)] line-through')}>{money(p.amount, cur)}</p>
            {cur !== base && (
              <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">
                {money(p.amount_base, base)} at {p.fx_rate} {base} for 1 {cur}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2 @min-[640px]:grid-cols-4">
              <DarkTile label="Date" value={dayLabel(p.date)} />
              <DarkTile label={incoming ? 'Into' : 'From'} value={p.bank?.name ?? ''} onClick={p.bank !== null ? () => navigate('bank', { id: p.bank?.id ?? '' }) : undefined} />
              <DarkTile label="How" value={methodLabel(p.method)} />
              <DarkTile label="Reference" value={p.reference !== '' ? p.reference : 'None'} />
            </div>
            {p.memo !== '' && <p className="mt-4 text-[13px] text-[var(--erp-on-dark-muted)]">{p.memo}</p>}
          </Card>

          <Card delay={2}>
            <CardHeader title="What it settles" subtitle={p.state === 'draft' ? 'Applied when the payment posts' : p.allocations.length === 0 ? `Not applied to any ${docWord} yet` : `${p.allocations.length} ${docWord}${p.allocations.length === 1 ? '' : 's'}`} />
            {p.state === 'draft' ? (
              p.planned !== null && p.planned.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {p.planned.map((x) => {
                    const d = p.open_docs.find((o) => o.id === x.doc);
                    return (
                      <li key={x.doc} className="flex items-center justify-between gap-3 rounded-[16px] bg-[var(--erp-row)] px-4 py-3">
                        <TextLink onClick={() => navigate('doc', { id: x.doc })}>{d?.number ?? 'Document'}</TextLink>
                        <span className="num text-[14px] font-bold">{money(x.amount, cur)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-[var(--erp-muted)]">When it posts, it settles the oldest open {docWord}s of {p.party?.name ?? 'the party'} first.</p>
              )
            ) : p.allocations.length === 0 ? (
              <Empty icon={FileText} title={`Not applied to any ${docWord}`} compact>
                {p.state === 'posted' ? `The whole amount is credit on ${p.party?.name ?? 'the party'}.` : 'Nothing is settled by a void payment.'}
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {p.allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] bg-[var(--erp-row)] px-4 py-3">
                    <span className="min-w-0 flex-1 basis-[200px]">
                      <TextLink onClick={() => navigate('doc', { id: a.document?.id ?? '' })}>
                        <span className="num">{a.document?.number ?? ''}</span>
                        <ArrowUpRight size={13} aria-hidden />
                      </TextLink>
                      <span className="block text-[12px] text-[var(--erp-muted)]">
                        {docTypeLabel(a.document?.type ?? docWord)} of {dayLabel(a.document?.date ?? p.date)} · {a.document !== null && a.document.balance > 0 ? `${money(a.document.balance, cur)} still open` : 'Paid in full'}
                        {a.fx_diff !== 0 ? ` · exchange difference ${money(a.fx_diff, base)}` : ''}
                      </span>
                    </span>
                    <span className="num text-[15px] font-bold">{money(a.amount, cur)}</span>
                    {p.state === 'posted' && p.can.void && (
                      <button type="button" onClick={() => void takeBack(a.id, a.document?.number ?? docWord)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--erp-card)] px-3 text-[12px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                        <Undo2 size={13} aria-hidden /> Take back
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {p.state === 'posted' && p.unallocated > 0 && (
              <div className="erp-on-sand mt-3 flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-sand)] px-4 py-3">
                <Wallet size={18} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 text-[13px]">
                  <b className="num">{money(p.unallocated, cur)}</b> is not applied: it stays as credit on {p.party?.name ?? 'the party'}.
                  {p.open_docs.length === 0 ? ` No open ${docWord}s to apply it to yet.` : ''}
                </span>
                {p.can.apply && p.open_docs.length > 0 && (
                  <PillButton size="sm" variant="light" onClick={() => setApplying(true)}>
                    Apply to {docWord}s
                  </PillButton>
                )}
              </div>
            )}
          </Card>

          {journal.data !== null && journal.data !== undefined && (journal.data.lines ?? []).length > 0 && (
            <Card delay={3}>
              <CardHeader
                title="In the books"
                subtitle={`${journal.data.number} on ${dayLabel(journal.data.date)}`}
                action={
                  <TextLink tone="muted" onClick={() => navigate('journal', { id: journal.data?.id ?? '' })}>
                    Open entry <ArrowUpRight size={13} aria-hidden />
                  </TextLink>
                }
              />
              <BooksDetail lines={previewLines(journal.data.lines)} currency={base} label="Accounts it moved" />
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="sand" delay={2}>
            <div className="flex items-center gap-4">
              <ProgressRing value={p.state === 'posted' ? share : 0} size={64}>
                {p.state === 'posted' ? `${Math.round(share * 100)}%` : '-'}
              </ProgressRing>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--erp-ink-2)]">Applied</p>
                <p className="num text-[15px] font-bold">{money(p.allocated, cur)}</p>
                <p className="text-[12px] text-[var(--erp-muted)]">{p.unallocated > 0 ? `${money(p.unallocated, cur)} left as credit` : 'Nothing left over'}</p>
              </div>
            </div>
            <dl className="mt-5 flex flex-col gap-2 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--erp-muted)]">Prepared by</dt>
                <dd>{p.prepared_actor === 'agent' ? <ActorPill actor="agent" /> : <span className="font-semibold">{p.prepared_by}</span>}</dd>
              </div>
              {p.posted_by !== '' && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--erp-muted)]">Posted by</dt>
                  <dd className="font-semibold">{p.posted_by}</dd>
                </div>
              )}
              {p.agent_note !== '' && <p className="mt-1 rounded-[14px] bg-[var(--erp-card)] px-3 py-2 text-[12px] leading-5">{p.agent_note}</p>}
            </dl>
          </Card>

          {p.state === 'posted' && (
            <Card delay={3}>
              <CardHeader title="Bank statement" icon={Landmark} subtitle={p.bank_line !== null ? 'Matched to a statement line' : 'Not on an imported statement yet'} />
              {p.bank_line !== null ? (
                <button type="button" onClick={() => navigate('bank', { id: p.bank?.id ?? '', tab: 'matched' })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-left hover:bg-[var(--erp-row-hover)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{p.bank_line.description}</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">{dayLabel(p.bank_line.date)}</span>
                  </span>
                  <ArrowUpRight size={15} aria-hidden />
                </button>
              ) : (
                <TextLink tone="muted" onClick={() => navigate('bank', { id: p.bank?.id ?? '' })}>
                  Reconcile {p.bank?.name ?? 'the account'} <ArrowUpRight size={13} aria-hidden />
                </TextLink>
              )}
            </Card>
          )}

          {waiting.map((x) => (
            <ProposalCard key={x.id} p={x} onDecided={() => proposals.reload()} />
          ))}

          <RecordActivity entity="payments" refId={p.id} />
        </div>
      </div>

      <ConfirmPosting
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void ${p.number}`}
        verb="Void payment"
        danger
        previewOp="payments.preview-void"
        runOp="payments.void"
        params={{ payment: p.id }}
        withDate
        defaultDate={today()}
        extraParams={{ reason: reason.trim() === '' ? undefined : reason.trim() }}
        intro={<p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">What it settled opens again, and its entry in the books is reversed. Use this when the money did not really move, or was recorded twice.</p>}
        extra={
          <Field label="Why" optional>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Recorded twice, bounced cheque..." aria-label="Why" className={softInput} />
          </Field>
        }
        onDone={() => {
          toast.success('Payment voided');
          data.reload();
        }}
      />
      <ConfirmPosting
        open={posting}
        onClose={() => setPosting(false)}
        title={`Post ${incoming ? 'payment received' : 'payment'}`}
        verb="Post"
        previewOp="payments.preview-post"
        runOp="payments.post"
        params={{ payment: p.id }}
        onDone={() => {
          toast.success('Posted');
          data.reload();
        }}
      />
      <ApplyCredit open={applying} onClose={() => setApplying(false)} payment={p.id} available={p.unallocated} currency={cur} docs={p.open_docs} docWord={docWord} onDone={data.reload} />
      {confirmEl}
    </div>
  );
}

function DarkTile({ label, value, onClick }: { label: string; value: string; onClick?: (() => void) | undefined }): React.JSX.Element {
  const inner = (
    <>
      <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className="block truncate text-[14px] font-bold">{value}</span>
    </>
  );
  if (onClick === undefined) return <div className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3">{inner}</div>;
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform hover:underline active:scale-[0.98]">
      {inner}
    </button>
  );
}

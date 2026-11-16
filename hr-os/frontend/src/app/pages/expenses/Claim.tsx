/**
 * One claim: its expenses on the left with the receipt of the chosen one
 * beside them, flags in words, your AI agent's reading to use or dismiss,
 * the approval steps and the history. The person edits and submits a
 * draft here; an approver leaves out single expenses with a reason and
 * approves the rest; finance marks it paid with a reference.
 */
import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, CircleCheck, Ellipsis, Pencil, Plane, RotateCcw, Send, Trash2, Undo2, Wallet, X } from 'lucide-react';
import { Money, AgentMark, Button, DayPicker, Dialog, Empty, FactStrip, Field, IconButton, Input, LinkButton, LoadError, Loading, Menu, MenuItem, MenuSep, Notice, PageBody, PageHeader, Panel, StatusDot, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import { AddExpense } from '../../components/expenses/AddExpense.tsx';
import { LineEditor } from '../../components/expenses/LineEditor.tsx';
import { CategoryIcon, ClaimStatus, FlagList, Flags, ReceiptDialog, ReceiptThumb, ReceiptView, readingState, shownReading, LineAmount, ReadingMark, lineTitle, PhoneActions } from '../../components/expenses/parts.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtStampDay, today } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, patch, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Approval, ClaimDetail, Line } from './types.ts';
import { READS } from './types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';

export function stepLabel(s: { type: string; role?: string | undefined }): string {
  if (s.type === 'role') return t(`exp.step.role.${s.role ?? ''}`) === `exp.step.role.${s.role ?? ''}` ? (s.role ?? '') : t(`exp.step.role.${s.role ?? ''}`);
  return t(`exp.step.${s.type}`);
}

/** The steps of an approval as dots: done, now, to come. */
export function Steps({ a }: { a: Approval }): React.JSX.Element {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {a.steps.map((s, i) => {
        const done = a.status === 'approved' || i < a.step;
        const now = a.status === 'pending' && i === a.step;
        return (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="h-px w-4 bg-[var(--hr-line-2)]" />}
            <StatusDot tone={done ? 'good' : now ? 'warn' : a.status === 'rejected' && i === a.step ? 'bad' : 'faint'} label={stepLabel(s)} />
          </li>
        );
      })}
    </ol>
  );
}

function ApprovalRound({ a }: { a: Approval }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1.5 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Steps a={a} />
        <span className="flex-1" />
        <span className="hr-label">{ago(a.created)}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {a.history.map((h, i) => (
          <li key={i} className="hr-wrap text-[12px] text-[var(--hr-muted)]">
            <span className="hr-mono">{fmtStampDay(h.at, { entity: a.entity })}</span> {t(`exp.event.${h.event}`)}
            {h.event === 'cancelled' && h.note !== undefined && h.note !== '' && <span>: {h.note}</span>}
          </li>
        ))}
      </ul>
      {a.status !== 'pending' && a.decided_by_name !== '' && (
        <div className="text-[12px] text-[var(--hr-ink-2)]">
          {t(`exp.decided.${a.status}`, { who: a.decided_by_name })}
          {a.note !== '' && <span className="hr-wrap text-[var(--hr-muted)]"> · {a.note}</span>}
        </div>
      )}
    </li>
  );
}

/** What your AI agent read: the amount (a Money figure), where, the day, the category. */
function ReadingLine({ l }: { l: Line }): React.JSX.Element | null {
  const r = l.agent_read;
  if (r === null) return null;
  const bits: React.ReactNode[] = [];
  if ((r.amount_minor ?? 0) > 0 && r.currency !== undefined) bits.push(<Money minor={r.amount_minor ?? 0} currency={r.currency} />);
  if (r.merchant !== undefined && r.merchant !== '') bits.push(t('exp.reading.at', { where: r.merchant }));
  if (r.day !== undefined && r.day !== '') bits.push(fmtDay(r.day));
  if (r.category_name !== undefined && r.category_name !== '') bits.push(r.category_name);
  if (bits.length === 0) return null;
  return (
    <div className="hr-wrap mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-[var(--hr-ink-2)]">
      {bits.map((b, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          {i > 0 && <span aria-hidden className="text-[var(--hr-faint)]">·</span>}
          {b}
        </span>
      ))}
    </div>
  );
}

/** How a paid claim was paid: the pay run or the bank reference, or an advance. */
function PaidHow({ c }: { c: ClaimDetail }): React.JSX.Element {
  if (c.paid_via === 'advance') return <>{t('exp.pay_via.advance_short')}</>;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="whitespace-nowrap">{c.paid_via === 'payroll' ? t('exp.pay_via.payroll_short') : t('exp.pay_via.bank_short')}</span>
      {c.paid_reference !== '' && <span className="hr-mono hr-wrap min-w-0 text-[12px] text-[var(--hr-muted)]">{c.paid_reference}</span>}
    </span>
  );
}

/** Your AI agent's reading of the chosen receipt, with the actions it allows. */
function ReadingCard({ l, canEdit }: { l: Line; canEdit: boolean }): React.JSX.Element | null {
  const state = readingState(l);
  if (!shownReading(l)) return null;
  const use = (): void => void act([patch(l.id, { agent_read: { ...(l.agent_read ?? {}), state: 'accepted' } })], () => op('claim-lines.accept-reading', { line: l.id }), READS);
  const dismiss = (): void => void act([patch(l.id, { agent_read: { ...(l.agent_read ?? {}), state: 'dismissed' } })], () => op('claim-lines.dismiss-reading', { line: l.id }), READS);
  const again = (): void => void act([patch(l.id, { receipt_status: 'waiting' })], () => op('claim-lines.read-again', { line: l.id }), READS);
  return (
    <div className="flex items-start gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-3">
      <AgentMark size={24} working={state === 'reading' ? true : undefined} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">
          {state === 'reading' ? t('exp.reading.reading') : state === 'suggested' ? t('exp.reading.suggested') : state === 'filled' ? t('exp.reading.filled') : state === 'failed' ? t('exp.reading.failed') : t('exp.reading.read')}
        </div>
        {state === 'failed' ? (
          <div className="hr-wrap mt-0.5 text-[12px] text-[var(--hr-muted)]">{l.agent_read?.reason ?? ''}</div>
        ) : (
          <ReadingLine l={l} />
        )}
        {l.agent_read?.note !== undefined && l.agent_read.note !== '' && <div className="hr-wrap mt-1 text-[12px] text-[var(--hr-muted)]">{l.agent_read.note}</div>}
        {canEdit && (
          <div className="mt-2 flex flex-wrap gap-2">
            {state === 'suggested' && (
              <>
                <Button size="sm" icon={Check} onClick={use}>
                  {t('exp.reading.use')}
                </Button>
                <Button size="sm" variant="ghost" icon={X} onClick={dismiss}>
                  {t('exp.reading.dismiss')}
                </Button>
              </>
            )}
            {state === 'failed' && l.receipt && (
              <Button size="sm" icon={RotateCcw} onClick={again}>
                {t('exp.reading.ask_again')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LineRow({ l, c, selected, onSelect, onEdit, onOpen, onReject }: { l: Line; c: ClaimDetail; selected: boolean; onSelect: () => void; onEdit: () => void; onOpen: () => void; onReject: (undo: boolean) => void }): React.JSX.Element {
  const rejected = l.status === 'rejected';
  const state = readingState(l);
  const title = lineTitle(l);
  return (
    <li
      onClick={onSelect}
      className={`group flex cursor-pointer items-start gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 last:border-b-0 ${selected ? 'bg-[var(--hr-active)]' : 'hover:bg-[var(--hr-hover)]'}`}
    >
      <ReceiptThumb line={l} size={40} onOpen={onOpen} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <CategoryIcon name={l.category_icon} size={13} className="shrink-0 text-[var(--hr-muted)]" />
          <span className={`hr-wrap min-w-0 text-[13px] font-medium ${rejected ? 'text-[var(--hr-muted)] line-through' : ''}`}>{title}</span>
          <ReadingMark l={l} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--hr-muted)]">
          <span className="hr-mono">{fmtDay(l.day, { weekday: true })}</span>
          {l.category_name !== '' && l.kind !== 'mileage' && l.category_name !== title && <span>{l.category_name}</span>}
          {l.description !== '' && <span className="hr-wrap min-w-0">{l.description}</span>}
        </div>
        {rejected ? <div className="hr-wrap mt-1 text-[12px] text-[var(--hr-bad)]">{t('exp.line.left_out', { why: l.reject_reason })}</div> : <Flags flags={l.flags} className="mt-1" />}
        {!rejected && l.reject_reason !== '' && <div className="hr-wrap mt-1 text-[12px] text-[var(--hr-muted)]">{t('exp.line.last_time', { why: l.reject_reason })}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <LineAmount l={l} currency={c.currency} className={`text-[13px] ${rejected ? 'text-[var(--hr-muted)] line-through' : ''}`} />
        {l.currency !== c.currency && l.amount_minor > 0 && <Money minor={l.amount_minor} currency={l.currency} className="text-[12px] text-[var(--hr-muted)]" />}
        <div className="mt-1 flex gap-0.5" onClick={(e) => e.stopPropagation()}>
          {c.can.edit && <IconButton icon={Pencil} label={t('ui.edit')} size={26} onRow={!selected} onClick={onEdit} />}
          {c.can.edit && (
            <IconButton
              icon={Trash2}
              label={t('ui.remove')}
              size={26}
              tone="danger"
              onClick={() =>
                void confirmAsk(t('exp.line.remove_q'), t('exp.line.remove')).then((yes) => {
                  if (yes) void act([], () => op('claim-lines.delete', { line: l.id, confirm: true }), READS);
                })
              }
            />
          )}
          {c.can.reject_lines && (rejected ? <IconButton icon={Undo2} label={t('exp.line.put_back')} size={26} onRow={!selected} onClick={() => onReject(true)} /> : <IconButton icon={Ban} label={t('exp.line.leave_out')} size={26} tone="danger" onClick={() => onReject(false)} />)}
        </div>
      </div>
    </li>
  );
}

function PaidDialog({ c, onClose }: { c: ClaimDetail; onClose: () => void }): React.JSX.Element {
  const [ref, setRef] = useState('');
  const [day, setDay] = useState(() => today({ entity: c.entity }));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.paid.title')}
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          {c.number} <span aria-hidden>·</span> <Money minor={c.payable_minor} currency={c.currency} />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Wallet}
            busy={busy}
            disabled={ref.trim() === ''}
            onClick={() => {
              setBusy(true);
              void op('claims.mark-paid', { claim: c.id, reference: ref.trim(), day })
                .then(() => {
                  changed(...READS);
                  toast.success(t('exp.paid.done', { n: c.number }));
                  onClose();
                })
                .catch(() => setBusy(false));
            }}
          >
            {t('exp.paid.title')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('exp.paid.reference')} hint={t('exp.paid.reference_hint')}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} aria-label={t('exp.paid.reference')} autoFocus />
        </Field>
        <Field label={t('exp.paid.day')}>
          <DayPicker value={day} onChange={setDay} label={t('exp.paid.day')} />
        </Field>
      </div>
    </Dialog>
  );
}

function ReasonDialog({ title, ok, onDone, onClose, tone }: { title: string; ok: string; onDone: (why: string) => void; onClose: () => void; tone?: 'danger' | undefined }): React.JSX.Element {
  const [why, setWhy] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={why.trim() === ''} onClick={() => onDone(why.trim())}>
            {ok}
          </Button>
        </>
      }
    >
      <Textarea value={why} onChange={(e) => setWhy(e.target.value)} minRows={3} aria-label={t('exp.reason')} placeholder={t('exp.reason_ph')} autoFocus />
    </Dialog>
  );
}

export function ClaimPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ claim: ClaimDetail }>('claims.get', { claim: params['id'] ?? '' }, READS, { name: 'claims.get' });
  const c = live.data?.claim ?? null;
  const [sel, setSel] = useState('');
  const [editing, setEditing] = useState<Line | null>(null);
  const [viewing, setViewing] = useState<Line | null>(null);
  const [paying, setPaying] = useState(false);
  const [rejecting, setRejecting] = useState<{ lines: string[] } | null>(null);
  const [declining, setDeclining] = useState(false);
  const lines = c?.lines ?? [];
  useEffect(() => {
    if (lines.length > 0 && !lines.some((l) => l.id === sel)) setSel((lines.find((l) => l.receipt) ?? lines[0])?.id ?? '');
  }, [lines, sel]);
  const chosen = lines.find((l) => l.id === sel) ?? null;
  const blockers = useMemo(() => lines.filter((l) => l.status === 'included' && l.flags.some((f) => f.severity === 'blocker')), [lines]);
  const reading = lines.filter((l) => l.status === 'included' && readingState(l) === 'reading').length;
  const suggested = lines.filter((l) => readingState(l) === 'suggested').length;

  if (c === null) return live.error !== null ? (live.code === 'not_found' || live.code === 'not_permitted' ? <Empty icon={X} title={t('exp.claim.not_found')} action={<Button onClick={() => navigate('/expenses')}>{t('exp.back_to')}</Button>} /> : <LoadError message={live.error} onRetry={live.reload} />) : <Loading />;

  const own = me.employee !== null && me.employee.id === c.employee;
  const decide = (decision: 'approved' | 'rejected', note?: string): void => {
    if (c.pending_approval === null) return;
    void act([patch(c.id, { status: decision === 'approved' && c.pending_approval.step >= c.pending_approval.steps.length - 1 ? 'approved' : c.status })], () => op('approvals.decide', { approval: c.pending_approval?.id, decision, note }), [...READS, 'approvals']).then((r) => {
      if (r !== null) toast.success(decision === 'approved' ? t('exp.claim.approved_toast', { n: c.number }) : t('exp.claim.rejected_toast', { n: c.number }), { label: t('exp.to_inbox'), run: () => navigate('/inbox') });
    });
  };
  const submit = (): void => {
    void act([patch(c.id, { status: 'submitted' })], () => op('claims.submit', { claim: c.id }), READS).then((r) => r !== null && toast.success(t('exp.claim.submitted_toast', { n: c.number })));
  };
  const backTo = own ? '#/expenses' : '#/expenses/claims';
  const metaBits = [c.title !== '' ? c.number : '', own ? '' : c.employee_name, c.entity_name, c.currency].filter((x) => x !== '');

  const claimActions = (
    <>
          {c.can.submit && (
            <Button variant="primary" icon={Send} disabled={blockers.length > 0 || reading > 0 || suggested > 0} onClick={submit}>
              {t('exp.claim.submit')}
            </Button>
          )}
          {c.can.decide && (
            <>
              <Button icon={X} onClick={() => setDeclining(true)}>
                {t('exp.claim.reject')}
              </Button>
              <Button variant="primary" icon={Check} onClick={() => decide('approved')}>
                {c.lines.some((l) => l.status === 'rejected') ? t('exp.claim.approve_rest') : t('exp.claim.approve')}
              </Button>
            </>
          )}
          {c.can.mark_paid && c.pay_via === 'bank' && (
            <Button variant="primary" icon={Wallet} onClick={() => setPaying(true)}>
              {t('exp.paid.title')}
            </Button>
          )}
    </>
  );
  return (
    <>
      <PageHeader title={c.title !== '' ? c.title : t('exp.claim.title', { n: c.number })} meta={metaBits.join(' · ')} back={backTo}>
        <span className="hidden md:contents">{claimActions}</span>
        {(c.can.withdraw || c.can.reopen || c.can.cancel || c.can.delete || c.can.set_payment || (c.can.mark_paid && c.pay_via !== 'bank')) && (
          <Menu icon={Ellipsis} label={t('exp.more')}>
            {(close) => (
              <>
                {c.can.reopen && (
                  <MenuItem icon={Pencil} onClick={() => (close(), void act([patch(c.id, { status: 'draft' })], () => op('claims.reopen', { claim: c.id }), READS))}>
                    {t('exp.claim.reopen')}
                  </MenuItem>
                )}
                {c.can.withdraw && (
                  <MenuItem icon={Undo2} onClick={() => (close(), void act([patch(c.id, { status: 'draft' })], () => op('claims.withdraw', { claim: c.id }), READS))}>
                    {t('exp.claim.withdraw')}
                  </MenuItem>
                )}
                {c.can.set_payment && (
                  <MenuItem icon={Wallet} onClick={() => (close(), void act([patch(c.id, { pay_via: c.pay_via === 'payroll' ? 'bank' : 'payroll' })], () => op('claims.set-payment', { claim: c.id, pay_via: c.pay_via === 'payroll' ? 'bank' : 'payroll' }), READS))}>
                    {c.pay_via === 'payroll' ? t('exp.claim.pay_by_bank') : t('exp.claim.pay_with_payroll')}
                  </MenuItem>
                )}
                {c.can.mark_paid && c.pay_via !== 'bank' && (
                  <MenuItem icon={CircleCheck} onClick={() => (close(), setPaying(true))}>
                    {t('exp.paid.title')}
                  </MenuItem>
                )}
                {(c.can.cancel || c.can.delete) && <MenuSep />}
                {c.can.cancel && (
                  <MenuItem icon={Ban} danger onClick={() => (close(), void confirmAsk(t('exp.claim.cancel_q'), t('exp.claim.cancel')).then((y) => y && void act([patch(c.id, { status: 'cancelled' })], () => op('claims.cancel', { claim: c.id }), READS)))}>
                    {t('exp.claim.cancel')}
                  </MenuItem>
                )}
                {c.can.delete && (
                  <MenuItem icon={Trash2} danger onClick={() => (close(), void confirmAsk(t('exp.claim.delete_q'), t('exp.claim.delete')).then((y) => y && void op('claims.delete', { claim: c.id, confirm: true }).then(() => (changed(...READS), navigate('/expenses')))))}>
                    {t('exp.claim.delete')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        <PhoneActions>{claimActions}</PhoneActions>
        <div className="flex flex-col gap-3">
          {c.status === 'rejected' && (
            <Notice tone="bad" action={c.can.reopen ? <Button size="sm" onClick={() => void act([patch(c.id, { status: 'draft' })], () => op('claims.reopen', { claim: c.id }), READS)}>{t('exp.claim.reopen')}</Button> : undefined}>
              {t('exp.claim.was_rejected')}
              {c.decided_note !== '' && <span>: {c.decided_note}</span>}
            </Notice>
          )}
          {c.status === 'draft' && blockers.length > 0 && lines.length > 0 && <Notice tone="warn">{tn('exp.claim.blocked', blockers.length)}</Notice>}
          {c.status === 'draft' && reading > 0 && (
            <Notice>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {tn('exp.claim.reading', reading)}
                <AgentAskStatus ask={c.agent} reads={READS} canRetry={c.can.edit} />
              </span>
            </Notice>
          )}
          {c.status === 'draft' && suggested > 0 && <Notice tone="agent">{tn('exp.claim.suggested', suggested)}</Notice>}
          {c.status === 'paid' && (
            <Notice tone="good">
              {c.paid_via === 'payroll' ? t('exp.claim.paid_payroll', { day: fmtDay(c.paid_day) }) : c.paid_via === 'advance' ? t('exp.claim.paid_advance') : t('exp.claim.paid_bank', { day: fmtDay(c.paid_day), ref: c.paid_reference })}
            </Notice>
          )}
          <div className="hr-panel hr-in px-3.5 py-3">
            <FactStrip
              items={[
                { label: t('exp.col.status'), value: <ClaimStatus c={c} /> },
                { label: t('exp.claim.total'), value: <Money minor={c.status === 'approved' || c.status === 'paid' ? c.approved_minor : c.total_minor} currency={c.currency} className="text-[14px]" /> },
                ...(c.advance_applied_minor > 0 ? [{ label: t('exp.claim.from_advance'), value: <Money minor={c.advance_applied_minor} currency={c.currency} /> }, { label: t('exp.claim.to_pay'), value: <Money minor={c.payable_minor} currency={c.currency} /> }] : []),
                { label: t('exp.claim.paid_how'), value: c.status === 'paid' ? <PaidHow c={c} /> : c.pay_via === 'payroll' ? t('exp.pay_via.payroll') : t('exp.pay_via.bank') },
                ...(c.submitted_at !== '' ? [{ label: t('exp.claim.submitted'), value: fmtStampDay(c.submitted_at, { entity: c.entity }), mono: true }] : []),
                ...(c.travel !== '' ? [{ label: t('exp.claim.trip'), value: <a className="hr-link hr-focus" href={`#/expenses/travel/${c.travel_number}`}>{c.travel_label}</a> }] : []),
                ...(c.advance !== '' ? [{ label: t('exp.claim.advance'), value: <a className="hr-link hr-focus hr-mono" href={`#/expenses/advances/${c.advance_number}`}>{c.advance_number}</a> }] : []),
              ]}
            />
          </div>
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
            <Panel index="01" label={tn('exp.claim.expenses', lines.length)} className="lg:col-span-7" flush aside={c.can.edit && c.categories !== undefined ? <AddExpense categories={c.categories} currency={c.currency} entity={c.entity} claim={c.id} variant="default" size="sm" /> : undefined}>
              {lines.length === 0 ? (
                <Empty icon={Plane} title={t('exp.claim.no_lines')} action={c.can.edit && c.categories !== undefined ? <AddExpense categories={c.categories} currency={c.currency} entity={c.entity} claim={c.id} /> : undefined} />
              ) : (
                <>
                  <ul aria-label={t('exp.claim.expenses.other', { n: lines.length })}>
                    {lines.map((l) => (
                      <LineRow
                        key={l.id}
                        l={l}
                        c={c}
                        selected={l.id === sel}
                        onSelect={() => setSel(l.id)}
                        onEdit={() => setEditing(l)}
                        onOpen={() => setViewing(l)}
                        onReject={(undo) => (undo ? void act([patch(l.id, { status: 'included' })], () => op('claims.reject-lines', { claim: c.id, lines: [l.id], undo: true }), READS) : setRejecting({ lines: [l.id] }))}
                      />
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-[var(--hr-line)] bg-[var(--hr-sunk)] px-3.5 py-2">
                    <span className="hr-label">{t('exp.claim.total')}</span>
                    <Money minor={c.total_minor} currency={c.currency} className="text-[14px] font-medium" />
                  </div>
                </>
              )}
            </Panel>
            <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
              {chosen !== null && (
                <Panel index="02" label={chosen.receipt ? t('exp.claim.receipt') : t('exp.claim.the_expense')} className={shownReading(chosen) || chosen.flags.length > 0 ? undefined : 'hidden md:flex'}>
                  <div className="flex flex-col gap-3">
                    <ReadingCard l={chosen} canEdit={c.can.edit} />
                    <ReceiptView line={chosen} className="hidden md:flex" />
                    {chosen.flags.length > 0 && (
                      <div className="border-t border-[var(--hr-hair)] pt-3">
                        <div className="hr-label mb-2">{t('exp.claim.flags')}</div>
                        <FlagList flags={chosen.flags} />
                        {chosen.reason !== '' && <div className="hr-wrap mt-2 text-[12px]">{t('exp.claim.their_reason', { why: chosen.reason })}</div>}
                        {c.can.clear_flag &&
                          chosen.agent_flags
                            .filter((f) => f.cleared !== true)
                            .map((f) => (
                              <LinkButton key={f.code} onClick={() => void act([], () => op('claim-lines.clear-flag', { line: chosen.id, code: f.code, note: t('exp.claim.checked_by_you') }), READS)} className="mt-2 mr-3">
                                {t('exp.claim.clear_flag', { what: t(`exp.flag.${f.code}`) })}
                              </LinkButton>
                            ))}
                      </div>
                    )}
                  </div>
                </Panel>
              )}
              {c.approvals.length > 0 && (
                <Panel index="03" label={t('exp.claim.approval')}>
                  <ul>
                    {[...c.approvals].reverse().map((a) => (
                      <ApprovalRound key={a.id} a={a} />
                    ))}
                  </ul>
                </Panel>
              )}
              {c.history.length > 0 && (
                <Panel index={c.approvals.length > 0 ? '04' : '03'} label={t('exp.claim.history')}>
                  <ul className="flex flex-col gap-1">
                    {c.history.slice(0, 12).map((h, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]">
                        {h.actor === 'agent' ? <AgentMark size={16} /> : <span aria-hidden className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--hr-line-2)]" />}
                        <span className="hr-wrap min-w-0 flex-1 text-[var(--hr-ink-2)]">{h.summary}</span>
                        <span className="hr-label shrink-0">{ago(h.at)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </div>
        </div>
      </PageBody>
      {editing !== null && c.categories !== undefined && <LineEditor line={editing} categories={c.categories} claimCurrency={c.currency} onClose={() => setEditing(null)} />}
      <ReceiptDialog line={viewing} onClose={() => setViewing(null)} />
      {paying && <PaidDialog c={c} onClose={() => setPaying(false)} />}
      {rejecting !== null && (
        <ReasonDialog
          title={t('exp.line.leave_out')}
          ok={t('exp.line.leave_out')}
          tone="danger"
          onClose={() => setRejecting(null)}
          onDone={(why) => {
            const ids = rejecting.lines;
            setRejecting(null);
            void act(
              ids.map((id) => patch(id, { status: 'rejected', reject_reason: why })),
              () => op('claims.reject-lines', { claim: c.id, lines: ids, reason: why }),
              READS,
            );
          }}
        />
      )}
      {declining && (
        <ReasonDialog
          title={t('exp.claim.reject')}
          ok={t('exp.claim.reject')}
          tone="danger"
          onClose={() => setDeclining(false)}
          onDone={(why) => {
            setDeclining(false);
            decide('rejected', why);
          }}
        />
      )}
    </>
  );
}

/**
 * The right column of a document's page: where it stands (balance due,
 * payments and credits applied, or how much of an order is delivered and
 * invoiced), the chain it belongs to (quote, order, delivery, invoice), the
 * journal it posted, and the dialogs it opens (record a payment, the
 * document as text).
 */
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookOpen, Copy, CreditCard, FileText, GitCommitHorizontal, Mail, ReceiptText } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel, dayPhrase, today } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, plural, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import type { DocDetail } from '../../lib/types/sales.ts';
import { BooksDetail, ConfirmPosting } from '../Books.tsx';
import { ProgressBar } from '../controls.tsx';
import { BankPicker, DateField, MoneyInput } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { docStatus } from '../status.ts';
import { Card, CardHeader, Field, Modal, PillButton, PillSelect, Skeleton, StatusPill, TextLink, softInput } from '../ui.tsx';
import { SHORT_TYPE, moneyOf } from './parts.tsx';

/* ------------------------------------------------------------ status card */

const METHOD: Record<string, string> = { bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', cheque: 'Cheque', online: 'Online', other: 'Other' };

/** Balance due and what settled it (money documents), on the page's one dark card. */
export function MoneyStatus({ doc, onPay, onApply }: { doc: DocDetail; onPay?: ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined; onApply?: (() => void) | undefined }): React.JSX.Element {
  const cur = doc.currency;
  const credit = doc.type === 'credit_note' || doc.type === 'supplier_credit';
  const st = docStatus(doc.status);
  const posted = doc.state === 'posted';
  const share = doc.total > 0 ? (doc.total - doc.balance) / doc.total : 0;
  return (
    <Card tone="dark" delay={1}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">{!posted ? (doc.state === 'void' ? 'Voided' : 'Total') : credit ? 'Credit left' : 'Balance due'}</span>
        <StatusPill tone={doc.status === 'overdue' ? 'bad' : 'dark'} size="sm">
          {st.label}
        </StatusPill>
      </div>
      <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(posted ? doc.balance : doc.total, cur)}</p>
      <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
        {doc.state === 'draft' && 'Not posted yet'}
        {doc.state === 'void' && (doc.voided_at !== '' ? `Voided ${dayPhrase(doc.voided_at.slice(0, 10))}${doc.voided_by !== '' ? ` by ${doc.voided_by}` : ''}` : 'Voided')}
        {posted && !credit && doc.balance > 0 && doc.due_date !== '' && (
          <>
            Due {dayPhrase(doc.due_date)}
            {doc.days_overdue > 0 && <span className="font-bold text-[var(--erp-red-text)]"> · {plural(doc.days_overdue, 'day')} overdue</span>}
          </>
        )}
        {posted && !credit && doc.balance <= 0 && 'Paid in full'}
        {posted && credit && (doc.balance > 0 ? `Of ${money(doc.total, cur)} credit` : 'All of it is used')}
      </p>
      {posted && doc.total > 0 && (
        <div className="mt-4">
          <ProgressBar value={share} dark tone="accent" />
          <p className="num mt-2 text-[12px] text-[var(--erp-on-dark-muted)]">
            {credit ? 'Used' : 'Paid'} {money(doc.total - doc.balance, cur)} of {money(doc.total, cur)}
          </p>
        </div>
      )}
      {doc.allocations.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {doc.allocations.map((a) => {
            const isPay = a.kind === 'payment' && a.payment !== null;
            const target = credit ? a.document : isPay ? a.payment : a.credit;
            const label = target?.number ?? '';
            const go = (): void => {
              if (credit && a.document !== null) navigate('doc', { id: a.document.id });
              else if (isPay && a.payment !== null) navigate('payment', { id: a.payment.id });
              else if (a.credit !== null) navigate('doc', { id: a.credit.id });
            };
            return (
              <li key={a.id}>
                <button type="button" onClick={go} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2.5 text-left transition-transform active:scale-[0.99]">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-dark)] text-[var(--erp-accent)]">
                    {isPay ? doc.side === 'sales' ? <ArrowDownLeft size={15} aria-hidden /> : <ArrowUpRight size={15} aria-hidden /> : <ReceiptText size={15} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="num block truncate text-[13px] font-bold">{label}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">
                      {dayLabel(a.date)}
                      {isPay && a.payment !== null ? ` · ${METHOD[a.payment.method] ?? a.payment.method}` : credit ? '' : ' · Credit applied'}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-bold">{money(a.amount, a.currency !== '' ? a.currency : cur)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(onPay !== undefined || onApply !== undefined) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {onPay !== undefined && (
            <PillButton variant="accent" size="sm" icon={CreditCard} onClick={onPay}>
              Record payment
            </PillButton>
          )}
          {onApply !== undefined && (
            <PillButton variant="accent" size="sm" icon={ReceiptText} onClick={onApply}>
              Apply to {doc.type === 'credit_note' ? 'invoices' : 'bills'}
            </PillButton>
          )}
        </div>
      )}
    </Card>
  );
}

function sumLines(doc: DocDetail): { total: number; done: number; invoiced: number } {
  let total = 0;
  let done = 0;
  let invoiced = 0;
  for (const l of doc.lines) {
    total += l.qty;
    done += Math.min(l.qty, l.qty_fulfilled);
    invoiced += Math.min(l.qty, l.qty_invoiced);
  }
  return { total, done, invoiced };
}

/** Where a quote, order, delivery or receipt stands. */
export function FlowStatus({ doc }: { doc: DocDetail }): React.JSX.Element {
  const st = docStatus(doc.status);
  const order = doc.type === 'sales_order' || doc.type === 'purchase_order';
  const s = sumLines(doc);
  const t = today();
  return (
    <Card delay={1}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-semibold text-[var(--erp-muted)]">{doc.type === 'quote' ? 'Quote value' : order ? 'Order value' : 'Units'}</span>
        <StatusPill tone={st.tone} size="sm">
          {st.label}
        </StatusPill>
      </div>
      <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{doc.type === 'delivery' || doc.type === 'goods_receipt' ? qty(s.total) : money(doc.total, doc.currency)}</p>
      <p className="mt-1 text-[13px] text-[var(--erp-muted)]">
        {doc.type === 'quote' && doc.valid_until !== '' && (doc.valid_until < t ? `Expired ${dayPhrase(doc.valid_until)}` : `Valid until ${dayPhrase(doc.valid_until)}`)}
        {order && doc.expected_date !== '' && `${doc.type === 'sales_order' ? 'Delivery' : 'Arrival'} expected ${dayPhrase(doc.expected_date)}`}
        {(doc.type === 'delivery' || doc.type === 'goods_receipt') && (doc.state === 'posted' ? `${doc.type === 'delivery' ? 'Sent out' : 'Taken in'}${doc.warehouse !== null ? ` at ${doc.warehouse.name}` : ''}` : 'Stock moves when it is posted')}
      </p>
      {order && doc.state !== 'draft' && s.total > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <div className="mb-1.5 flex justify-between text-[12px] font-semibold">
              <span>{doc.type === 'sales_order' ? 'Delivered' : 'Received'}</span>
              <span className="num text-[var(--erp-muted)]">
                {qty(s.done)} of {qty(s.total)}
              </span>
            </div>
            <ProgressBar value={s.done / s.total} tone={s.done >= s.total ? 'green' : 'ink'} />
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[12px] font-semibold">
              <span>{doc.type === 'sales_order' ? 'Invoiced' : 'Billed'}</span>
              <span className="num text-[var(--erp-muted)]">
                {qty(s.invoiced)} of {qty(s.total)}
              </span>
            </div>
            <ProgressBar value={s.invoiced / s.total} tone={s.invoiced >= s.total ? 'green' : 'accent'} />
          </div>
        </div>
      )}
      {doc.sent_at !== '' && <p className="mt-3 text-[12px] text-[var(--erp-muted)]">Sent {dayPhrase(doc.sent_at.slice(0, 10))}</p>}
    </Card>
  );
}

/* -------------------------------------------------------------- the flow */

/** The chain the document belongs to; the current one in ink. */
export function FlowChain({ doc }: { doc: DocDetail }): React.JSX.Element | null {
  if (doc.flow.length < 2) return null;
  return (
    <Card delay={2}>
      <CardHeader title="Flow" subtitle="Where it came from and what it became" icon={GitCommitHorizontal} />
      <ol className="relative flex flex-col gap-1.5">
        <span aria-hidden className="absolute bottom-6 left-[27px] top-6 w-0.5 rounded-full bg-[var(--erp-line)]" />
        {doc.flow.map((f) => {
          const on = f.id === doc.id;
          const st = docStatus(f.status);
          return (
            <li key={f.id} className="relative">
              <button
                type="button"
                disabled={on}
                aria-current={on ? 'step' : undefined}
                onClick={() => navigate('doc', { id: f.id })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors disabled:cursor-default',
                  on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'hover:bg-[var(--erp-row)]',
                )}
              >
                <span className={cn('relative flex size-[30px] shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-row)]')}>
                  <span
                    aria-hidden
                    className={cn(
                      'size-2.5 rounded-full',
                      on && 'bg-[var(--erp-on-accent)]',
                      !on && st.tone === 'good' && 'bg-[var(--erp-green)]',
                      !on && st.tone === 'warn' && 'bg-[var(--erp-amber)]',
                      !on && st.tone === 'bad' && 'bg-[var(--erp-red)]',
                      !on && (st.tone === 'info' || st.tone === 'accent' || st.tone === 'dark') && 'bg-[var(--erp-ink)]',
                      !on && st.tone === 'neutral' && 'bg-[var(--erp-muted)]',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">
                    {SHORT_TYPE[f.type]} <span className="num">{f.number !== '' ? f.number : 'Draft'}</span>
                  </span>
                  <span className={cn('block truncate text-[12px]', on ? 'font-medium' : 'text-[var(--erp-muted)]')}>
                    {st.label}
                    {f.date !== '' ? ` · ${dayLabel(f.date)}` : ''}
                  </span>
                </span>
                {f.type !== 'delivery' && f.type !== 'goods_receipt' && <span className="num shrink-0 text-[13px] font-bold">{money(f.total, f.currency)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* --------------------------------------------------------------- journal */

interface JournalLineRow {
  account: { id: string; code: string; name: string };
  debit: number;
  credit: number;
  memo: string;
  party: { name: string } | null;
}

/** What the document posted, collapsed under a plain line. */
export function JournalCard({ doc }: { doc: DocDetail }): React.JSX.Element | null {
  const me = useMe();
  // Journal entries show to people with Accounting or Reports access (the server's rule).
  const id = can(me, 'accounting', 'view') || can(me, 'reports', 'view') ? (doc.journal?.id ?? '') : '';
  const j = useLive(
    () => (id === '' ? Promise.resolve(null) : op<{ number: string; currency: string; lines: JournalLineRow[] }>('journals.get', { journal: id }, { quiet: true })),
    READS.books,
    [id],
  );
  if (id === '' || j.error !== null) return null;
  const lines: JournalPreviewLine[] = (j.data?.lines ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, memo: l.memo, party: l.party?.name ?? '' }));
  return (
    <Card delay={3}>
      <CardHeader
        title="In the books"
        subtitle={doc.posted_at !== '' ? `Posted ${dayPhrase(doc.posted_at.slice(0, 10))}${doc.posted_by !== '' ? ` by ${doc.posted_by}` : ''}` : undefined}
        icon={BookOpen}
        action={
          <TextLink tone="muted" onClick={() => navigate('journal', { id })}>
            {doc.journal?.number}
          </TextLink>
        }
      />
      {j.data === null ? <Skeleton className="h-6 w-2/3" /> : <BooksDetail lines={lines} currency={j.data.currency !== '' ? j.data.currency : doc.base_currency} label="The journal lines" />}
    </Card>
  );
}

/* ---------------------------------------------------------- record payment */

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'online', 'other'];

interface BankRow {
  id: string;
  name: string;
  kind: string;
  currency: string;
  archived: boolean;
}

/** Record a payment against this invoice or bill: the form, then exactly what it posts. */
export function RecordPayment({ doc, open, onClose }: { doc: DocDetail; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [bank, setBank] = useState<Option | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amountText, setAmount] = useState(() => minorToText(doc.balance, doc.currency));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const balanceText = minorToText(doc.balance, doc.currency);

  useEffect(() => {
    if (!open) return;
    setAmount(balanceText);
    setDate(today());
    setReference('');
    setLoaded(false);
    op<{ banks: BankRow[] }>('banks.list', {}, { quiet: true })
      .then((r) => {
        const live = r.banks.filter((b) => !b.archived);
        const pick = live.find((b) => b.currency === doc.currency && b.kind === 'bank') ?? live.find((b) => b.currency === doc.currency) ?? live[0];
        setBank(pick !== undefined ? { id: pick.id, label: pick.name, sub: pick.currency, value: pick.id, data: pick } : null);
      })
      .catch(() => setBank(null))
      .finally(() => setLoaded(true));
  }, [open, balanceText, doc.currency]);

  if (!open || !loaded || doc.party === null) return null;
  const direction = doc.side === 'sales' ? 'in' : 'out';
  const ready = bank !== null && amountText !== '' && Number(amountText) > 0;
  const bankCurrency = (bank?.data as BankRow | undefined)?.currency ?? doc.currency;
  const typedMinor = Math.round(Number(amountText) * 10 ** decimalsOf(doc.currency));
  // Same currency and less than what is open: settle exactly that much; otherwise all that is open.
  const allocAmount = bankCurrency === doc.currency && typedMinor > 0 && typedMinor < doc.balance ? amountText : '';
  return (
    <ConfirmPosting
      open
      onClose={onClose}
      title={direction === 'in' ? `Money in for ${doc.number}` : `Pay ${doc.number}`}
      verb="Record payment"
      previewOp="payments.preview-record"
      runOp="payments.record"
      canRun={ready}
      params={{
        direction,
        party: doc.party.id,
        bank: bank?.id,
        amount: amountText === '' ? '0' : amountText,
        date,
        method,
        reference: reference.trim() === '' ? undefined : reference.trim(),
        allocations: [allocAmount !== '' ? { doc: doc.id, amount: allocAmount } : { doc: doc.id }],
        auto_allocate: false,
      }}
      onDone={() => toast.success('Payment recorded')}
      intro={
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Amount" hint={`${money(doc.balance, doc.currency)} is open`}>
            <MoneyInput value={amountText} onChange={setAmount} currency={doc.currency} ariaLabel="Amount" autoFocus />
          </Field>
          <Field label={direction === 'in' ? 'Into' : 'From'}>
            <BankPicker value={bank} onChange={setBank} />
          </Field>
          <Field label="Date">
            <DateField value={date} onChange={setDate} ariaLabel="Payment date" max={today()} />
          </Field>
          <PillSelect soft label="How" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: METHOD[m] ?? m }))} />
          <Field label="Reference" optional className="@min-[480px]:col-span-2">
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} aria-label="Reference" placeholder="Bank reference or cheque number" className={softInput} />
          </Field>
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------ as text */

export function TextModal({ doc, open, onClose }: { doc: DocDetail; open: boolean; onClose: () => void }): React.JSX.Element {
  const t = useLive(() => (open ? op<{ to: string; subject: string; text: string }>('docs.text', { doc: doc.id }, { quiet: true }) : Promise.resolve(null)), ['documents', 'document_lines'], [doc.id, open]);
  const copy = async (): Promise<void> => {
    if (t.data === null) return;
    try {
      await navigator.clipboard.writeText(`${t.data.subject}\n\n${t.data.text}`);
      toast.success('Copied');
    } catch {
      toast.info('Select the text to copy it');
    }
  };
  const mail = t.data !== null && t.data.to !== '' ? `mailto:${t.data.to}?subject=${encodeURIComponent(t.data.subject)}&body=${encodeURIComponent(t.data.text)}` : '';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${doc.type_label} as text`}
      description={t.data !== null ? (t.data.to !== '' ? `For ${t.data.to}` : `${doc.party?.name ?? 'The party'} has no email address`) : undefined}
      size="lg"
      footer={
        <>
          {mail !== '' && (
            <a href={mail} className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--erp-row)] px-5 text-[14px] font-semibold hover:bg-[var(--erp-row-hover)]">
              <Mail size={16} aria-hidden /> Open in email
            </a>
          )}
          <PillButton icon={Copy} onClick={() => void copy()} disabled={t.data === null}>
            Copy
          </PillButton>
        </>
      }
    >
      {t.data === null ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <FileText size={14} aria-hidden /> {t.data.subject}
          </p>
          <textarea readOnly value={t.data.text} rows={14} aria-label="Document text" onFocus={(e) => e.target.select()} className="num w-full resize-none rounded-[18px] bg-[var(--erp-row)] p-4 text-[13px] leading-5 outline-none" />
        </div>
      )}
    </Modal>
  );
}

/** "Money documents" have the dark status card; others the white one. */
export function StatusCard({ doc, onPay, onApply }: { doc: DocDetail; onPay?: ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined; onApply?: (() => void) | undefined }): React.JSX.Element {
  return moneyOf(doc.type) ? <MoneyStatus doc={doc} onPay={onPay} onApply={onApply} /> : <FlowStatus doc={doc} />;
}

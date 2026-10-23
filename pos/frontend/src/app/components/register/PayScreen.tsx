/**
 * Taking payment: a full screen that grows out of the pay button. Three
 * numbered steps read left to right: how the customer pays (method tiles),
 * the amount (a dark display, one-touch cash amounts and a keypad; card, QR
 * and other methods take what is due, or part of it to split), then the
 * button that takes it. Cash rounds to the smallest coin when the shop does
 * (the "Cash rounding" line); card and QR stay exact.
 *
 * When the payments cover what is due, the sale is recorded at once and the
 * screen turns into the receipt: the change to hand back (the biggest thing
 * on screen), the order number to call, print or email, and New sale, which
 * shrinks the screen back into the register.
 *
 * The sale's ref was made with the cart, so a retry after a lost answer
 * finds the sale already recorded instead of charging twice; a manager's PIN
 * is asked for here if the sale needs one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Banknote, Check, ChefHat, CircleAlert, CreditCard, Mail, Plus, Printer, QrCode, Split, Trash2, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { Cancelled, OpError, api, withApproval } from '../../lib/api.ts';
import { cashDue, roundTo } from '../../lib/calc.ts';
import { toInput } from '../../lib/cart.ts';
import type { Cart, CartTotals } from '../../lib/cart.ts';
import { useApp } from '../../lib/context.tsx';
import { quickCash } from '../../lib/denominations.ts';
import { post as postDisplay } from '../../lib/display.ts';
import { money } from '../../lib/format.ts';
import type { Sale, SalePayment, Tender, TenderKind } from '../../lib/types.ts';
import { Keypad, pressAmount } from '../Keypad.tsx';
import type { KeypadKey } from '../Keypad.tsx';
import { printReceipt } from '../printReceipt.tsx';
import { Button, IconButton, RevealScreen, ScreenHeader, Spinner, Step, inputCls } from '../ui.tsx';
import type { Origin, StepState } from '../ui.tsx';

const KIND_ICON: Record<TenderKind, LucideIcon> = { cash: Banknote, card: CreditCard, qr: QrCode, other: Wallet };

interface Paid {
  tender: Tender;
  amount: number;
  tendered: number;
  reference: string;
}

/** What is still due given the payments so far (cash rounding applies once any cash is in). */
function balance(total: number, paid: Paid[], inc: number, cashNext: boolean): { remaining: number; rounding: number } {
  const nonCash = paid.filter((p) => p.tender.kind !== 'cash').reduce((s, p) => s + p.amount, 0);
  const cash = paid.filter((p) => p.tender.kind === 'cash').reduce((s, p) => s + p.amount, 0);
  const anyCash = cashNext || paid.some((p) => p.tender.kind === 'cash');
  const rounding = anyCash ? cashDue(total, nonCash, inc).rounding : 0;
  return { remaining: total + rounding - nonCash - cash, rounding };
}

/** One line of a step's sums. */
function Sum({ label, value, strong = false, good = false }: { label: string; value: string; strong?: boolean; good?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-[13px]', strong ? 'font-bold' : 'text-[var(--ps-muted)]')}>{label}</span>
      <span className={cn('num font-bold', strong ? 'text-[26px] leading-8 tracking-[-0.01em]' : 'text-[14px]', good && 'text-[var(--ps-green-text)]')}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------- the receipt */

function Done({ sale, register, customerEmail, onNew }: { sale: Sale; register: string; customerEmail: string; onNew: () => void }): React.JSX.Element {
  const { settings, currency, exp } = useApp();
  const [email, setEmail] = useState(customerEmail);
  const [emailing, setEmailing] = useState(false);
  const [sent, setSent] = useState('');
  const typed = useRef(false);
  const printed = useRef(false);
  const total = sale.total + sale.rounding;
  const refund = total < 0;

  // The customer's address on file arrives a moment after the sale: use it unless one was typed.
  useEffect(() => {
    if (!typed.current) setEmail(customerEmail);
  }, [customerEmail]);

  useEffect(() => {
    postDisplay(register, { type: 'done', business: settings?.business_name ?? '', currency, exp, total: Math.abs(total), change: sale.change, number: sale.number, orderNo: sale.order_no });
    if (settings?.after_sale === 'print' && !printed.current && !sale.replayed) {
      printed.current = true;
      printReceipt(sale, settings.receipt_width, settings.receipt_barcode);
    }
  }, [sale, register, settings, currency, exp, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);

  const sendEmail = async (): Promise<void> => {
    setEmailing(true);
    try {
      await api.emailReceipt(sale.id, email.trim());
      setSent(email.trim());
      toast.success('Your AI agent will email the receipt');
    } catch {
      /* toasted */
    } finally {
      setEmailing(false);
    }
  };

  const headline = sale.change > 0 ? 'Change' : refund ? 'Refunded' : sale.kind === 'exchange' && total === 0 ? 'Exchanged' : 'Paid';
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center gap-4 px-4 py-8">
      <section className="ps-rise ps-on-dark flex flex-col items-center gap-3 rounded-[28px] bg-[var(--ps-dark)] px-6 py-8 text-center text-[var(--ps-on-dark)]">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
          <Check size={26} strokeWidth={2.6} />
        </span>
        <p className="text-[15px] font-bold text-[var(--ps-muted)]">{headline}</p>
        <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{money(sale.change > 0 ? sale.change : Math.abs(total), currency, exp)}</p>
        {sale.change > 0 && (
          <p className="num text-[13px] text-[var(--ps-muted)]">
            {money(sale.paid, currency, exp)} given for {money(total, currency, exp)}
          </p>
        )}
        <p className="text-[13px] text-[var(--ps-muted)]">
          {sale.number}
          {sale.training ? ' · training' : ''}
          {sale.payments.length > 0 ? ` · ${[...new Set(sale.payments.map((p) => p.name))].join(', ')}` : ''}
        </p>
        {sale.order_no > 0 && (
          <div className="mt-1 flex items-center gap-3 rounded-full bg-[var(--ps-dark-2)] py-2 pl-5 pr-5">
            <span className="text-[13px] font-semibold text-[var(--ps-muted)]">Order</span>
            <span className="num text-[26px] font-extrabold leading-8">{sale.order_no}</span>
            {sale.ticket !== null && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ps-muted)]">
                <ChefHat size={14} aria-hidden /> Sent to the kitchen
              </span>
            )}
          </div>
        )}
      </section>

      <section className="ps-rise ps-d1 ps-on-card flex flex-col gap-3 rounded-[28px] bg-[var(--ps-card)] p-5">
        <h2 className="text-[15px] font-bold">Receipt</h2>
        <Button
          size="lg"
          className="h-12 text-[14px]"
          icon={Printer}
          onClick={() => {
            // The first print is the receipt; any print after it is a recorded copy.
            const copy = printed.current;
            printed.current = true;
            if (copy) void api.reprint(sale.id).catch(() => undefined);
            printReceipt(sale, settings?.receipt_width ?? '80', settings?.receipt_barcode ?? true, copy);
          }}
        >
          Print receipt
        </Button>
        {!sale.training && (
          <div className="flex gap-2">
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                typed.current = true;
                setEmail(e.target.value);
              }}
              placeholder="Email the receipt to"
              aria-label="Email address for the receipt"
              className={cn(inputCls, 'h-12 flex-1')}
            />
            <Button size="lg" className="h-12 text-[14px]" icon={Mail} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || emailing || sent === email.trim()} loading={emailing} onClick={() => void sendEmail()}>
              {sent === email.trim() && sent !== '' ? 'Asked' : 'Send'}
            </Button>
          </div>
        )}
      </section>

      <Button variant="primary" size="lg" icon={Plus} dot className="ps-rise ps-d2 w-full" onClick={onNew}>
        New sale
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- paying */

export function PayScreen({
  origin,
  cart,
  totals,
  register,
  registerName,
  originPayments,
  onPaid,
  onClosed,
  onShiftClosed,
}: {
  origin: Origin;
  cart: Cart;
  totals: CartTotals;
  register: string;
  registerName: string;
  /** For returns: how the original sale was paid (refunds go back the same way by default). */
  originPayments: SalePayment[];
  /** The sale is recorded: the register clears the cart. */
  onPaid: (sale: Sale) => void;
  onClosed: () => void;
  onShiftClosed: () => void;
}): React.JSX.Element {
  const { tenders, settings, currency, exp } = useApp();
  // The cart as it was when Pay was pressed: the register clears its own once the sale is recorded.
  const [snap] = useState(() => ({ cart, totals }));
  const total = snap.totals.calc.total;
  const refund = total < 0;
  const sign = refund ? -1 : 1;
  const inc = settings?.cash_rounding ?? 0;
  const [paid, setPaid] = useState<Paid[]>([]);
  const firstDefault = refund ? tenders.find((t) => originPayments.some((o) => o.tender === t.id)) : undefined;
  const [tender, setTender] = useState<Tender | null>(firstDefault ?? null);
  const [entry, setEntry] = useState(0);
  const [split, setSplit] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [email, setEmail] = useState('');

  // Refunds go back the way they were paid: the original method arrives a moment after the screen.
  useEffect(() => {
    if (tender === null && firstDefault !== undefined && paid.length === 0) setTender(firstDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDefault?.id]);

  const isCash = tender?.kind === 'cash';
  const { remaining, rounding } = balance(total, paid, inc, isCash);
  const due = Math.abs(remaining);
  const fmt = (n: number): string => money(n, currency, exp);

  // The customer display follows: the amount due, and the QR to scan.
  useEffect(() => {
    if (sale !== null) return;
    postDisplay(register, { type: 'pay', business: settings?.business_name ?? '', currency, exp, due, tender: tender?.name ?? '', qr: tender?.kind === 'qr' ? tender.qr_url : '' });
  }, [register, settings?.business_name, currency, exp, due, tender, sale]);

  const finalize = useCallback(
    async (all: Paid[]): Promise<void> => {
      setBusy(true);
      setError(null);
      const c = snap.cart;
      const recorded = (s: Sale): void => {
        setSale(s);
        onPaid(s);
        // The receipt can go to the customer's email on file.
        if (c.customer !== null) {
          api
            .customer(c.customer.id)
            .then((x) => setEmail(x.email))
            .catch(() => undefined);
        }
      };
      try {
        recorded(
          await withApproval(
            (approvals) =>
              api.finalize({
                ref: c.ref,
                register,
                lines: toInput(c),
                payments: all.map((p) => ({ tender: p.tender.id, amount: p.amount, tendered: p.tendered, reference: p.reference })),
                discount: c.discount,
                order_type: c.orderType,
                customer: c.customer?.id ?? '',
                name: c.name,
                note: c.note,
                expected_total: total,
                approvals: [...c.approvals, ...approvals],
                cart: c.ticketRef,
              }),
            refund ? 'Refund' : 'Sale',
          ),
        );
      } catch (err) {
        if (err instanceof Cancelled) {
          setError({ message: 'Not approved. Change the sale or ask a manager again.', code: 'cancelled' });
        } else if (err instanceof OpError) {
          if (err.code === 'ref_conflict') {
            // Recorded before with other payments (a retry after a lost answer): show that sale.
            try {
              recorded(await api.sale(c.ref));
              return;
            } catch {
              /* fall through to the message */
            }
          }
          if (err.code === 'shift_closed') onShiftClosed();
          setError({ message: err.message, code: err.code });
        } else {
          setError({ message: 'The sale could not be recorded. Try again.', code: 'error' });
        }
      } finally {
        setBusy(false);
      }
    },
    [snap, register, total, refund, onPaid, onShiftClosed],
  );

  /** Add a payment; when it settles the sale, record it. */
  const add = (p: Paid): void => {
    const all = [...paid, p];
    setPaid(all);
    setEntry(0);
    setReference('');
    setSplit(false);
    const b = balance(total, all, inc, false);
    if (b.remaining === 0) void finalize(all);
    else setTender(null);
  };

  // An even exchange (nothing to pay either way) is recorded straight away.
  useEffect(() => {
    if (total === 0) void finalize([]);
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cashTarget = due; // already rounded when cash is the tender
  const quick = useMemo(() => (refund ? [] : quickCash(cashTarget, currency, exp)), [refund, cashTarget, currency, exp]);

  const takeCash = (given: number): void => {
    if (tender === null || given <= 0) return;
    if (refund) {
      const out = Math.min(given, cashTarget);
      add({ tender, amount: -out, tendered: -out, reference: '' });
      return;
    }
    const applied = given >= cashTarget ? cashTarget : roundTo(given, inc);
    if (applied <= 0) return;
    add({ tender, amount: applied, tendered: given, reference: '' });
  };

  const takeOther = (): void => {
    if (tender === null) return;
    const amt = split && entry > 0 ? Math.min(entry, due) : due;
    if (amt <= 0) return;
    add({ tender, amount: sign * amt, tendered: sign * amt, reference: reference.trim() });
  };

  const onKey = useCallback((k: KeypadKey): void => setEntry((v) => pressAmount(v, k)), []);

  const change = isCash && !refund && entry > cashTarget ? entry - cashTarget : 0;
  // A cash refund gives back everything unless an amount is typed.
  const cashOut = entry > 0 ? Math.min(entry, cashTarget) : cashTarget;
  const cashAmount = refund ? cashOut : entry;
  const otherAmount = split && entry > 0 ? Math.min(entry, due) : due;
  const settled = paid.length > 0 && balance(total, paid, inc, false).remaining === 0;

  return (
    <RevealScreen origin={origin} label={refund ? 'Give a refund' : 'Take payment'} onClosed={onClosed}>
      {(close) => {
        // Esc goes back to the sale while nothing has been taken yet.
        const back = (): void => {
          if (paid.length === 0 && !busy) close();
        };
        if (sale !== null) return <Done sale={sale} register={register} customerEmail={email} onNew={close} />;
        if (busy) {
          return (
            <div data-paying="true" className="flex min-h-screen flex-col items-center justify-center gap-4">
              <Spinner size={32} />
              <p className="text-[15px] font-bold">Recording the {refund ? 'refund' : 'sale'}</p>
            </div>
          );
        }
        const step1: StepState = tender !== null ? 'done' : 'current';
        const step2: StepState = tender === null ? 'todo' : isCash && !refund && entry <= 0 ? 'current' : 'done';
        const step3: StepState = tender !== null && step2 === 'done' ? 'current' : 'todo';
        const cashLabel = refund
          ? `Give ${fmt(cashOut)}`
          : entry >= cashTarget
            ? change > 0
              ? `Take cash · change ${fmt(change)}`
              : 'Take cash'
            : entry > 0
              ? `Take ${fmt(roundTo(entry, inc))} in cash`
              : 'Enter the cash given';
        const otherLabel = tender === null ? '' : refund ? `Refunded by ${tender.name}` : tender.kind === 'card' ? 'Card approved' : tender.kind === 'qr' ? 'Payment received' : `Paid by ${tender.name}`;
        return (
          <div data-paying="true" className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
            <EscToGoBack onEsc={back} />
            <div className="mx-auto max-w-[560px] min-[1100px]:max-w-none">
              <ScreenHeader
                title={refund ? 'Give a refund' : 'Take payment'}
                subtitle={`${registerName} · ${snap.totals.items === 1 ? '1 item' : `${snap.totals.items} items`}${snap.cart.customer !== null ? ` · ${snap.cart.customer.name}` : ''}`}
                onBack={back}
                backLabel="Back to the sale (Esc)"
                backDisabled={paid.length > 0}
              />
            </div>

            {error !== null && (
              <div role="alert" className="ps-pop mx-auto mb-4 flex max-w-[560px] items-center gap-3 rounded-[22px] bg-[var(--ps-red)]/12 px-4 py-3 min-[1100px]:max-w-none">
                <CircleAlert size={18} aria-hidden className="shrink-0 text-[var(--ps-red-text)]" />
                <p className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--ps-red-text)]">{error.message}</p>
                {settled && (
                  <Button size="sm" variant="primary" onClick={() => void finalize(paid)}>
                    Try again
                  </Button>
                )}
              </div>
            )}

            <div className="mx-auto grid max-w-[560px] gap-4 min-[1100px]:max-w-none min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] min-[1100px]:gap-5">
              {/* 1. How */}
              <Step n={1} state={step1} title={refund ? 'Refund by' : 'Paid by'} hint="Required" delay={2}>
                <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
                  {tenders.map((t) => {
                    const Icon = KIND_ICON[t.kind];
                    const on = tender?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setTender(t);
                          setEntry(0);
                          setError(null);
                        }}
                        className={cn('ps-press flex flex-col items-center gap-2 rounded-[20px] px-2 py-4', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
                      >
                        <span aria-hidden className={cn('flex size-11 items-center justify-center rounded-full', on ? 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)]')}>
                          <Icon size={19} />
                        </span>
                        <span className="w-full truncate text-center text-[14px] font-bold">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
                {refund && originPayments.length > 0 && <p className="mt-3 px-1 text-[12px] text-[var(--ps-muted)]">Paid by {[...new Set(originPayments.map((o) => o.name))].join(' and ')} on the original sale</p>}
                {paid.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-2" aria-label="Payments so far">
                    {paid.map((p, i) => {
                      const Icon = KIND_ICON[p.tender.kind];
                      return (
                        <li key={i} className="flex items-center gap-3 rounded-full bg-[var(--ps-row)] py-1.5 pl-1.5 pr-1.5">
                          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ps-solid)] text-[var(--ps-on-solid)]">
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                            {p.tender.name}
                            {p.reference !== '' && <span className="font-normal text-[var(--ps-muted)]"> · {p.reference}</span>}
                          </span>
                          <span className="num text-[14px] font-bold">{fmt(Math.abs(p.amount))}</span>
                          <IconButton icon={Trash2} label="Remove this payment" variant="danger" size={36} onClick={() => setPaid(paid.filter((_, k) => k !== i))} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Step>

              {/* 2. The amount */}
              <Step n={2} state={step2} title="Amount" hint={tender === null ? 'Choose how first' : isCash ? 'Type or tap' : split ? 'Part of it' : 'All of it'} delay={3}>
                <div className="ps-on-dark rounded-[22px] bg-[var(--ps-dark)] p-5 text-[var(--ps-on-dark)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-[var(--ps-muted)]">{paid.length > 0 ? (refund ? 'Still to refund' : 'Still to pay') : refund ? 'Refund' : 'Amount due'}</span>
                    <span className="rounded-full bg-[var(--ps-dark-2)] px-3 py-1 text-[12px] font-semibold">{currency}</span>
                  </div>
                  <p className="num mt-3 text-[26px] font-extrabold leading-8 tracking-[-0.01em]" aria-live="polite">
                    {fmt(due)}
                  </p>
                  {rounding !== 0 && <p className="num mt-1 text-[12px] text-[var(--ps-muted)]">Cash rounding {fmt(rounding)}</p>}
                  {tender !== null && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-full bg-[var(--ps-dark-2)] py-2 pl-4 pr-4">
                      <span className="text-[13px] font-semibold text-[var(--ps-muted)]">{isCash ? (refund ? 'Cash out' : 'Cash given') : split ? 'This payment' : tender.kind === 'card' ? 'Key on the card terminal' : refund ? 'Refund' : 'Amount'}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="num text-[15px] font-bold">{fmt(isCash ? cashAmount : otherAmount)}</span>
                        {(isCash || split) && <span aria-hidden className="ps-caret h-5 w-[3px] rounded-full bg-[var(--ps-accent)]" />}
                      </span>
                    </div>
                  )}
                </div>

                {tender !== null && isCash && (
                  <>
                    {quick.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {quick.map((q, i) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => takeCash(q)}
                            className={cn('ps-press num inline-flex h-11 items-center rounded-full px-4 text-[14px] font-bold', i === 0 ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
                          >
                            {i === 0 ? `Exact ${fmt(q)}` : fmt(q)}
                          </button>
                        ))}
                      </div>
                    )}
                    <Keypad onKey={onKey} extra="00" size="md" className="mt-3" onEnter={() => takeCash(cashAmount)} />
                  </>
                )}

                {tender !== null && !isCash && (
                  <div className="mt-3 flex flex-col gap-3">
                    {tender.kind === 'qr' && tender.qr_url !== '' && (
                      <div className="flex justify-center rounded-[22px] bg-[var(--ps-paper)] p-4">
                        <img src={tender.qr_url} alt={`${tender.name} QR code`} className="max-h-[220px] object-contain" />
                      </div>
                    )}
                    {(tender.ask_reference || tender.kind === 'card') && (
                      <input
                        value={reference}
                        maxLength={60}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder={tender.kind === 'card' ? 'Last 4 digits or approval code (optional)' : 'Reference (optional)'}
                        aria-label="Reference"
                        className={inputCls}
                      />
                    )}
                    <Button icon={Split} onClick={() => setSplit(!split)} aria-pressed={split} className="self-start">
                      {split ? 'Whole amount' : 'Split'}
                    </Button>
                    {split && <Keypad onKey={onKey} extra="00" size="md" onEnter={takeOther} />}
                  </div>
                )}
              </Step>

              {/* 3. Take it */}
              <Step n={3} state={step3} title={refund ? 'Give it back' : 'Take it'} delay={4}>
                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-col gap-2 rounded-[22px] bg-[var(--ps-row)] p-4">
                    <Sum label={refund ? 'Refund' : 'Total'} value={fmt(Math.abs(total + rounding))} />
                    {paid.length > 0 && <Sum label={refund ? 'Refunded so far' : 'Paid so far'} value={fmt(Math.abs(paid.reduce((s, p) => s + p.amount, 0)))} />}
                    {isCash && !refund && entry > 0 && entry < cashTarget && <Sum label="Still to pay after this" value={fmt(cashTarget - roundTo(entry, inc))} />}
                    {isCash && !refund && <Sum label="Change" value={fmt(change)} strong good={change > 0} />}
                    {(!isCash || refund) && <Sum label={refund ? 'To give back' : 'To take'} value={fmt(tender === null ? due : isCash ? cashAmount : otherAmount)} strong />}
                  </div>
                  <span className="flex-1" />
                  {tender === null ? (
                    <Button variant="primary" size="lg" disabled className="w-full">
                      Choose how they pay
                    </Button>
                  ) : isCash ? (
                    <Button variant="primary" size="lg" icon={refund ? ArrowRight : Banknote} dot disabled={cashAmount <= 0} onClick={() => takeCash(cashAmount)} className="w-full">
                      {cashLabel}
                    </Button>
                  ) : (
                    <Button variant="primary" size="lg" icon={Check} dot disabled={split && entry <= 0} onClick={takeOther} className="w-full">
                      {otherLabel}
                    </Button>
                  )}
                </div>
              </Step>
            </div>
          </div>
        );
      }}
    </RevealScreen>
  );
}

/** Esc anywhere on the pay screen (outside a text field) goes back. */
function EscToGoBack({ onEsc }: { onEsc: () => void }): null {
  const fn = useRef(onEsc);
  fn.current = onEsc;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      fn.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

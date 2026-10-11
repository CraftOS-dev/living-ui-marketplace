/**
 * Taking payment. The left card is what is due (with the tip, the payments
 * taken so far and their voids); the right side takes one payment at a
 * time in any tender, so a split is just paying part and then the rest.
 * Cash suggests the notes a customer is likely to hand over and shows the
 * change; a card payment is taken on the shop's own terminal and recorded
 * here. A negative balance is a refund, paid out the same ways. When the
 * balance reaches zero the sale is finished and the receipt choices show.
 *
 * Every payment attempt carries its own key, so pressing twice or retrying
 * after a dropped connection never charges twice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Banknote, Check, CircleCheck, CreditCard, Gift, Mail, Printer, Search, Star, Wallet, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, clientRef, errMessage, isCancelled } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { plain, toMinor } from '../../lib/format.ts';
import { printReceipt, tenderName } from '../../lib/print.ts';
import { useScanner } from '../../lib/scanner.ts';
import type { GiftCard, Order, Payment } from '../../lib/types.ts';
import { AmountPad } from '../pads.tsx';
import { Button, IconButton, inputCls } from '../ui.tsx';
import { useTicket } from './ticket.tsx';

type TenderId = 'cash' | 'card' | 'gift_card' | 'store_credit' | 'points' | string;

interface TenderOption {
  id: TenderId;
  label: string;
  icon: LucideIcon;
  custom?: boolean;
}

/**
 * What a customer is likely to hand over for `due`: the amount rounded up to
 * each note or coin big enough to matter (at least a twentieth of the
 * amount), so $6.53 suggests $7, $10 and $20, not $6.55.
 */
export function suggestions(due: number, denominations: number[]): number[] {
  const notes = [...denominations].filter((d) => d > 0 && d * 20 >= due).sort((a, b) => a - b);
  const out = new Set<number>();
  for (const d of notes) {
    const up = Math.ceil(due / d) * d;
    if (up > due) out.add(up);
  }
  return Array.from(out)
    .sort((a, b) => a - b)
    .slice(0, 4);
}

function PaymentRow({ p, onVoid, canVoid }: { p: Payment; onVoid: () => void; canVoid: boolean }): React.JSX.Element {
  const { money } = useStore();
  const voided = p.status === 'voided';
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className={cn('min-w-0 flex-1', voided && 'line-through opacity-60')}>
        <span className="block truncate text-[13px] font-semibold">{tenderName(p.tender, p.label)}</span>
        <span className="block truncate text-[12px] text-[var(--ps-on-dark-muted)]">
          {p.reference !== '' ? p.reference + ' · ' : ''}
          {p.tender === 'cash' && p.tendered > 0 ? 'Given ' + money.fmt(p.tendered) + (p.change > 0 ? ', change ' + money.fmt(p.change) : '') : p.tender === 'points' ? p.points + ' points' : p.staff}
          {voided ? ' · voided' : ''}
        </span>
      </span>
      <span className={cn('num shrink-0 text-[13px] font-semibold', voided && 'line-through opacity-60')}>{money.fmt(p.amount)}</span>
      {canVoid && !voided && <IconButton icon={X} label={'Void this ' + tenderName(p.tender, p.label).toLowerCase() + ' payment'} variant="onDark" size={24} onClick={onVoid} />}
    </li>
  );
}

function Done({ order, change, onNew }: { order: Order; change: number; onNew: () => void }): React.JSX.Element {
  const { money } = useStore();
  const [contact, setContact] = useState(order.customer?.email || order.customer?.phone || '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [printing, setPrinting] = useState<'receipt' | 'gift' | null>(null);
  const refund = order.total < 0;
  const newRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => newRef.current?.focus(), []);

  const print = async (gift: boolean): Promise<void> => {
    setPrinting(gift ? 'gift' : 'receipt');
    try {
      const r = await api.receipt(order.id);
      await printReceipt(r.receipt, money, gift);
    } catch {
      // Shown by the transport.
    } finally {
      setPrinting(null);
    }
  };

  const send = async (): Promise<void> => {
    if (contact.trim() === '') return;
    setSending(true);
    try {
      const r = await api.ask('receipt', { order: order.id, contact: contact.trim() });
      setSent(r.asked ? 'Your AI agent is sending it to ' + contact.trim() : r.message);
    } catch {
      // Shown by the transport.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-[var(--ps-green)] text-[var(--ps-on-green)]">
        <Check size={28} strokeWidth={2.6} />
      </span>
      <div>
        {change > 0 ? (
          <>
            <p className="text-[13px] font-semibold text-[var(--ps-muted)]">Change</p>
            <p className="num text-[26px] font-bold leading-8 tracking-tight">{money.fmt(change)}</p>
          </>
        ) : (
          <p className="text-[26px] font-bold leading-8">{refund ? 'Refunded ' + money.fmt(-order.paid_total) : 'Paid ' + money.fmt(order.paid_total)}</p>
        )}
        <p className="mt-1 text-[13px] text-[var(--ps-muted)]">
          Receipt {order.number}
          {order.points_earned > 0 && order.customer !== null ? ' · ' + order.customer.name + ' earned ' + order.points_earned + ' points' : ''}
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" icon={Printer} loading={printing === 'receipt'} onClick={() => void print(false)} className="h-11">
            Print receipt
          </Button>
          <Button size="lg" icon={Gift} loading={printing === 'gift'} onClick={() => void print(true)} className="h-11" disabled={refund}>
            Gift receipt
          </Button>
        </div>
        {sent === null ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input className={cn(inputCls, 'h-11 flex-1')} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone for the receipt" inputMode="email" aria-label="Email or phone for the receipt" />
            <Button type="submit" size="lg" icon={Mail} loading={sending} disabled={contact.trim() === ''} className="h-11">
              Send
            </Button>
          </form>
        ) : (
          <p className="rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 text-[12px] text-[var(--ps-ink-2)]">{sent}</p>
        )}
        <button ref={newRef} type="button" onClick={onNew} className="ps-on-ink mt-2 flex h-14 items-center justify-center rounded-[var(--ps-r-md)] bg-[var(--ps-ink)] text-[15px] font-bold text-[var(--ps-shell)] hover:opacity-90">
          New sale
        </button>
      </div>
    </div>
  );
}

export function Checkout({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const ticket = useTicket();
  const order = ticket.order;
  const [tender, setTender] = useState<TenderId>('cash');
  const [amount, setAmount] = useState(0);
  const [splitting, setSplitting] = useState(false);
  const [given, setGiven] = useState(0);
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [card, setCard] = useState<GiftCard | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ order: Order; change: number } | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipCustom, setTipCustom] = useState('');
  const ref = useRef(clientRef());

  const balance = order?.balance ?? 0;
  const refund = balance < 0;
  const due = Math.abs(balance);
  const take = Math.min(splitting ? amount : due, due);

  // Fresh state each time the sheet opens or the balance moves.
  useEffect(() => {
    if (!open) return;
    setAmount(due);
    setGiven(0);
    ref.current = clientRef();
  }, [open, due]);
  useEffect(() => {
    if (open) {
      setDone(null);
      setSplitting(false);
      setTender('cash');
      setReference('');
      setCode('');
      setCard(null);
    }
  }, [open]);

  const customer = order?.customer ?? null;
  const tenders: TenderOption[] = useMemo(() => {
    const list: TenderOption[] = [
      { id: 'cash', label: 'Cash', icon: Banknote },
      { id: 'card', label: 'Card', icon: CreditCard },
      { id: 'gift_card', label: 'Gift card', icon: Gift },
    ];
    if (customer !== null && (refund || customer.credit > 0)) list.push({ id: 'store_credit', label: 'Store credit', icon: Wallet });
    if (!refund && customer !== null && settings?.loyalty_enabled === true && settings.point_value > 0 && customer.points >= settings.points_min_redeem && customer.points > 0) list.push({ id: 'points', label: 'Points', icon: Star });
    for (const t of settings?.custom_tenders ?? []) list.push({ id: t.id, label: t.label, icon: Wallet, custom: true });
    return list;
  }, [customer, refund, settings]);

  // A gift card scanned while the gift card tender is chosen fills the number.
  useScanner(
    (c) => {
      setCode(c);
      void check(c);
    },
    open && done === null && tender === 'gift_card',
  );

  const check = async (c: string): Promise<void> => {
    if (c.trim() === '') return;
    setChecking(true);
    try {
      const r = await api.giftCard(c.trim(), { quiet: true });
      setCard(r.gift_card);
    } catch (err) {
      setCard(null);
      if (!refund) toast.error(errMessage(err));
    } finally {
      setChecking(false);
    }
  };

  if (order === null) return <></>;

  const finish = (o: Order, change: number): void => {
    ticket.accept(o);
    setDone({ order: o, change });
    ticket.announce({ kind: 'thanks', change });
  };

  const pay = async (input: { tender: string; amount?: number; tendered?: number; reference?: string; gift_code?: string; label?: string }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.pay({
        order: order.id,
        tender: input.tender,
        amount: input.amount !== undefined ? plain(input.amount, money.digits) : undefined,
        tendered: input.tendered !== undefined ? plain(input.tendered, money.digits) : undefined,
        reference: input.reference,
        gift_code: input.gift_code,
        label: input.label,
        client_ref: ref.current,
      });
      ref.current = clientRef();
      if (r.completed) finish(r.order, r.change);
      else {
        ticket.accept(r.order);
        setSplitting(false);
        setReference('');
        setCode('');
        setCard(null);
        setGiven(0);
        if (r.change > 0) toast.success('Change ' + money.fmt(r.change));
      }
    } catch (err) {
      if (!isCancelled(err)) ref.current = clientRef();
    } finally {
      setBusy(false);
    }
  };

  const voidPayment = async (p: Payment): Promise<void> => {
    try {
      const r = await api.voidPayment(p.id, 'Taken by mistake');
      ticket.accept(r.order);
      toast.success('Payment voided');
    } catch {
      // Shown by the transport.
    }
  };

  const complete = async (): Promise<void> => {
    setBusy(true);
    try {
      const o = await api.complete(order.id);
      finish(o, 0);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  const setTip = async (input: { tip_percent?: number; tip?: string }): Promise<void> => {
    setTipOpen(false);
    await ticket.change(input);
  };

  const captured = order.payments.filter((p) => p.status === 'captured');
  const tipsOn = settings?.tips_enabled === true && !refund && order.total > 0 && captured.length === 0;
  const tipBase = settings?.tip_basis === 'after_tax' ? order.total : order.total - order.tax_total;
  const t = tenders.find((x) => x.id === tender) ?? tenders[0];
  const cardRef = settings?.card_reference ?? 'optional';

  let action: React.JSX.Element;
  if (balance === 0) {
    action = (
      <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} icon={CircleCheck} onClick={() => void complete()}>
        Complete the sale
      </Button>
    );
  } else if (tender === 'cash') {
    // A part paid in cash is taken exactly; the whole balance can be given in notes, with change.
    // With cash rounding, the cash due is the balance rounded to the step (the server does the same).
    const step = settings?.cash_round_to ?? 0;
    const exact = !splitting && !refund && step > 0 ? Math.round(take / step) * step : take;
    const sugg = refund || splitting ? [] : suggestions(exact, settings?.denominations ?? []);
    const cash = (tendered: number): Promise<void> => (splitting ? pay({ tender: 'cash', amount: take, tendered: take }) : pay({ tender: 'cash', tendered }));
    action = (
      <div className="flex flex-col gap-3">
        {!refund && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" disabled={busy} onClick={() => void cash(exact)} className="num h-12 rounded-[var(--ps-r-md)] border border-[var(--ps-line)] bg-[var(--ps-card)] text-[15px] font-bold hover:bg-[var(--ps-row)] disabled:opacity-50">
              Exact {money.fmt(exact)}
            </button>
            {sugg.map((x) => (
              <button key={x} type="button" disabled={busy} onClick={() => void cash(x)} className="num h-12 rounded-[var(--ps-r-md)] border border-[var(--ps-line)] bg-[var(--ps-card)] text-[15px] font-bold hover:bg-[var(--ps-row)] disabled:opacity-50">
                {money.fmt(x)}
              </button>
            ))}
          </div>
        )}
        {!refund && !splitting && (
          <div className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] p-2">
            <div className="flex items-baseline justify-between px-1 pb-2">
              <span className="text-[12px] font-semibold text-[var(--ps-ink-2)]">Cash given</span>
              <span className="num text-[26px] font-bold">{money.fmt(given)}</span>
            </div>
            <AmountPad value={given} onChange={setGiven} onEnter={() => given > 0 && void cash(given)} keys={open} />
            {given > exact && <p className="num px-1 pt-2 text-right text-[13px] font-semibold text-[var(--ps-green-text)]">Change {money.fmt(given - exact)}</p>}
            {given > 0 && given < exact && <p className="num px-1 pt-2 text-right text-[12px] font-semibold text-[var(--ps-amber-text)]">{money.fmt(exact - given)} still to pay after this</p>}
          </div>
        )}
        <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} onClick={() => void (refund ? pay({ tender: 'cash', amount: take }) : cash(given > 0 && !splitting ? given : exact))}>
          {refund ? 'Give back ' + money.fmt(take) + ' in cash' : 'Take ' + money.fmt(given > 0 && !splitting ? given : exact) + ' cash'}
        </Button>
      </div>
    );
  } else if (tender === 'card') {
    const needRef = cardRef === 'required' && !refund;
    action = (
      <div className="flex flex-col gap-3">
        <div className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-3 text-[13px]">
          <p className="font-semibold">{refund ? 'Refund ' : 'Charge '}<span className="num">{money.fmt(take)}</span> on the card terminal</p>
          <p className="mt-0.5 text-[12px] text-[var(--ps-muted)]">Then confirm here once it is approved.</p>
        </div>
        {cardRef !== 'off' && <input className={cn(inputCls, 'h-11')} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={needRef ? 'Approval code or last 4 digits (required)' : 'Approval code or last 4 digits (optional)'} aria-label="Approval code or last 4 digits" />}
        <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} disabled={needRef && reference.trim() === ''} onClick={() => void pay({ tender: 'card', amount: take, reference: reference.trim() })}>
          {refund ? 'Card refund done' : 'Card payment approved'}
        </Button>
      </div>
    );
  } else if (tender === 'gift_card') {
    const cardTake = card !== null && !refund ? Math.min(take, card.balance) : take;
    action = (
      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void check(code);
          }}
        >
          <input className={cn(inputCls, 'num h-11 flex-1 tracking-wider')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={refund ? 'Card number (empty for a new card)' : 'Scan or type the card number'} aria-label="Gift card number" autoFocus />
          <Button type="submit" size="lg" icon={Search} className="h-11" loading={checking} disabled={code.trim() === ''}>
            Check
          </Button>
        </form>
        {card !== null && (
          <div className="flex items-center justify-between rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-2.5">
            <span className="text-[13px] font-semibold">Card {card.masked}</span>
            <span className={cn('num text-[15px] font-bold', card.status !== 'active' && 'text-[var(--ps-red-text)]')}>{card.status === 'active' ? money.fmt(card.balance) : 'Disabled'}</span>
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          className="h-14 w-full text-[15px]"
          loading={busy}
          disabled={refund ? false : card === null || card.status !== 'active' || card.balance <= 0}
          onClick={() => void pay({ tender: 'gift_card', amount: cardTake, gift_code: code.trim() })}
        >
          {refund ? (code.trim() === '' ? 'Put ' + money.fmt(take) + ' on a new gift card' : 'Put ' + money.fmt(take) + ' on this card') : card === null ? 'Check the card first' : 'Take ' + money.fmt(cardTake) + ' from the card'}
        </Button>
      </div>
    );
  } else if (tender === 'store_credit' && customer !== null) {
    const credTake = refund ? take : Math.min(take, customer.credit);
    action = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-2.5">
          <span className="text-[13px] font-semibold">{customer.name}&rsquo;s store credit</span>
          <span className="num text-[15px] font-bold">{money.fmt(customer.credit)}</span>
        </div>
        <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} onClick={() => void pay({ tender: 'store_credit', amount: credTake })}>
          {refund ? 'Add ' + money.fmt(take) + ' to store credit' : 'Use ' + money.fmt(credTake) + ' of store credit'}
        </Button>
      </div>
    );
  } else if (tender === 'points' && customer !== null && settings !== null) {
    const worth = customer.points * settings.point_value;
    const ptsTake = Math.min(take, worth);
    const pts = Math.ceil(ptsTake / settings.point_value);
    action = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-2.5">
          <span className="text-[13px] font-semibold">
            {customer.points} points <span className="font-normal text-[var(--ps-muted)]">worth {money.fmt(worth)}</span>
          </span>
          <span className="num text-[13px] font-semibold">{pts} used</span>
        </div>
        <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} disabled={pts < settings.points_min_redeem} onClick={() => void pay({ tender: 'points', amount: ptsTake })}>
          Pay {money.fmt(ptsTake)} with points
        </Button>
      </div>
    );
  } else {
    action = (
      <div className="flex flex-col gap-3">
        <input className={cn(inputCls, 'h-11')} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Reference (optional)" aria-label="Reference" />
        <Button variant="primary" size="lg" className="h-14 w-full text-[15px]" loading={busy} onClick={() => void pay({ tender: 'other', label: t?.label ?? '', amount: take, reference: reference.trim() })}>
          {(refund ? 'Refund ' : 'Take ') + money.fmt(take) + ' by ' + (t?.label ?? 'other')}
        </Button>
      </div>
    );
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && done === null && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[50] bg-black/40" />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => {
            if (done !== null) e.preventDefault();
          }}
          className="ps-pop ps-touch fixed inset-0 z-[51] flex flex-col overflow-hidden bg-[var(--ps-shell)] text-[var(--ps-ink)] md:inset-4 md:rounded-[var(--ps-r-lg)] md:border md:border-[var(--ps-line)] md:shadow-[var(--ps-shadow)]"
        >
          <RadixDialog.Title className="sr-only">{refund ? 'Refund' : 'Take payment'}</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Amount due {money.fmt(due)}</RadixDialog.Description>
          {done !== null ? (
            <Done order={done.order} change={done.change} onNew={onClose} />
          ) : (
            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(280px,380px)_1fr]">
              <aside className="ps-on-dark flex min-h-0 flex-col bg-[var(--ps-dark)] p-5 text-[var(--ps-on-dark)]">
                <button type="button" onClick={onClose} className="mb-4 inline-flex items-center gap-1.5 self-start rounded-[var(--ps-r)] px-1.5 py-1 text-[13px] font-semibold text-[var(--ps-on-dark-muted)] hover:bg-[var(--ps-dark-2)] hover:text-[var(--ps-on-dark)]">
                  <ArrowLeft size={15} />
                  Back to the sale
                </button>
                <p className="text-[13px] font-semibold text-[var(--ps-on-dark-muted)]">{refund ? 'To refund' : captured.length > 0 ? 'Left to pay' : 'To pay'}</p>
                <p className="num text-[26px] font-bold leading-8 tracking-tight">{money.fmt(due)}</p>
                <div className="mt-4 space-y-1 border-t border-[var(--ps-dark-2)] pt-3 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[var(--ps-on-dark-muted)]">Sale</span>
                    <span className="num">{money.fmt(order.total)}</span>
                  </div>
                  {order.tip !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--ps-on-dark-muted)]">Tip</span>
                      <span className="num">{money.fmt(order.tip)}</span>
                    </div>
                  )}
                  {order.rounding !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--ps-on-dark-muted)]">Cash rounding</span>
                      <span className="num">{money.fmt(order.rounding)}</span>
                    </div>
                  )}
                  {captured.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--ps-on-dark-muted)]">{refund ? 'Refunded' : 'Paid'}</span>
                      <span className="num">{money.fmt(order.paid_total)}</span>
                    </div>
                  )}
                </div>

                {tipsOn && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-[12px] font-semibold text-[var(--ps-on-dark-muted)]">Tip</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" aria-pressed={order.tip === 0} onClick={() => void setTip({ tip: '0' })} className={cn('h-10 rounded-[var(--ps-r)] px-3 text-[13px] font-semibold', order.tip === 0 ? 'bg-[var(--ps-accent)] text-[var(--ps-on-accent)]' : 'bg-[var(--ps-dark-2)] hover:opacity-90')}>
                        No tip
                      </button>
                      {(settings?.tip_presets ?? []).map((pct) => {
                        const amt = Math.round((Math.max(tipBase, 0) * pct) / 100);
                        const on = order.tip === amt && order.tip > 0;
                        return (
                          <button key={pct} type="button" aria-pressed={on} onClick={() => void setTip({ tip_percent: pct })} className={cn('flex h-10 flex-col items-center justify-center rounded-[var(--ps-r)] px-3 leading-4', on ? 'bg-[var(--ps-accent)] text-[var(--ps-on-accent)]' : 'bg-[var(--ps-dark-2)] hover:opacity-90')}>
                            <span className="text-[13px] font-bold">{pct}%</span>
                            <span className="num text-[12px] opacity-80">{money.fmt(amt)}</span>
                          </button>
                        );
                      })}
                      <button type="button" onClick={() => setTipOpen((o) => !o)} className={cn('h-10 rounded-[var(--ps-r)] px-3 text-[13px] font-semibold', tipOpen ? 'bg-[var(--ps-accent)] text-[var(--ps-on-accent)]' : 'bg-[var(--ps-dark-2)] hover:opacity-90')}>
                        Other
                      </button>
                    </div>
                    {tipOpen && (
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const m = toMinor(tipCustom, money.digits);
                          if (m !== null && m >= 0) void setTip({ tip: plain(m, money.digits) });
                        }}
                      >
                        <input autoFocus className="num h-9 w-32 rounded-[var(--ps-r)] border border-[var(--ps-dark-2)] bg-[var(--ps-dark-2)] px-2 text-right text-[13px] text-[var(--ps-on-dark)] outline-none focus:border-[var(--ps-accent)]" inputMode="decimal" value={tipCustom} onChange={(e) => setTipCustom(e.target.value)} placeholder={money.plain(0)} aria-label="Tip amount" />
                        <Button type="submit" variant="accent">
                          Add tip
                        </Button>
                      </form>
                    )}
                  </div>
                )}

                {order.payments.length > 0 && (
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-[var(--ps-dark-2)] pt-2">
                    <ul className="divide-y divide-[var(--ps-dark-2)]">
                      {order.payments.map((p) => (
                        <PaymentRow key={p.id} p={p} canVoid onVoid={() => void voidPayment(p)} />
                      ))}
                    </ul>
                  </div>
                )}
              </aside>

              <section className="flex min-h-0 flex-col overflow-y-auto p-5">
                {balance !== 0 && (
                  <>
                    <div role="radiogroup" aria-label="How the customer pays" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {tenders.map((x) => {
                        const on = x.id === tender;
                        const Icon = x.icon;
                        return (
                          <button
                            key={x.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              setTender(x.id);
                              setReference('');
                              ref.current = clientRef();
                            }}
                            className={cn('flex h-14 items-center gap-2 rounded-[var(--ps-r-md)] border px-3 text-left text-[14px] font-bold transition-colors', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}
                          >
                            <Icon size={18} className={on ? 'text-[var(--ps-accent)]' : 'text-[var(--ps-ink-2)]'} />
                            <span className="truncate">{x.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-[var(--ps-ink-2)]">{splitting ? (refund ? 'Refund this part' : 'Pay this part') : refund ? 'Refund all of it' : 'Pay all of it'}</span>
                      <Button size="sm" variant="ghost" onClick={() => setSplitting((s) => !s)}>
                        {splitting ? 'Pay all of it' : 'Split the payment'}
                      </Button>
                    </div>
                    {splitting && (
                      <div className="mt-2 rounded-[var(--ps-r-md)] bg-[var(--ps-card)] p-2">
                        <div className="flex items-baseline justify-between px-1 pb-2">
                          <span className="text-[12px] font-semibold text-[var(--ps-ink-2)]">Amount</span>
                          <span className={cn('num text-[26px] font-bold', amount > due && 'text-[var(--ps-red-text)]')}>{money.fmt(amount)}</span>
                        </div>
                        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                          {[2, 3, 4, 5].map((n) => (
                            <button key={n} type="button" onClick={() => setAmount(Math.ceil(due / n))} className={cn('num h-9 rounded-[var(--ps-r)] border px-3 text-[13px] font-semibold', amount === Math.ceil(due / n) ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
                              {'1/' + n + ' · ' + money.fmt(Math.ceil(due / n))}
                            </button>
                          ))}
                        </div>
                        <AmountPad value={amount} onChange={setAmount} />
                        {amount > due && <p className="px-1 pt-2 text-[12px] font-semibold text-[var(--ps-red-text)]">More than the {money.fmt(due)} left</p>}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-4">{action}</div>
              </section>
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * "Record a payment": a full screen of three steps. Who paid (or who was
 * paid); which open invoices or bills it settles (oldest first, editable);
 * and the money itself: amount, day, account, how. What is not applied
 * stays as credit on the customer or supplier. Saving shows exactly what
 * it posts to the books first.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, FileText, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { money, minorToText, normalizeNumber, decimalsOf } from '../../lib/format.ts';
import { useMe, baseCurrency } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { Bank, BankList, Currency, Direction, DocList, DocRow, Payment } from '../../lib/types/money.ts';
import { ConfirmPosting } from '../Books.tsx';
import { Segmented } from '../controls.tsx';
import { ScreenBar } from '../FullScreen.tsx';
import { BankPicker, DateField, MoneyInput, PartyPicker, partyOption } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Empty, Field, Notice, PillButton, Skeleton, StatusPill, cellInput, softInput } from '../ui.tsx';
import { METHODS } from './labels.ts';
import { ChoicePills, MoreOptions, Step } from './Step.tsx';

/** Parse typed major-unit text to minor units (null when not a number). */
export function toMinor(text: string, currency: string): number | null {
  const n = normalizeNumber(text, decimalsOf(currency));
  if (n === null) return null;
  const [w = '0', f = ''] = n.split('.');
  const d = decimalsOf(currency);
  return Number(w) * 10 ** d + Number((f + '0'.repeat(d)).slice(0, d) || '0');
}

interface Alloc {
  on: boolean;
  text: string;
}

function bankOption(b: Bank): Option {
  return { id: b.id, label: b.name, sub: `${b.kind === 'cash' ? 'Cash' : b.kind === 'card' ? 'Card' : 'Bank'} · ${b.currency}`, value: b.id, data: b };
}

export function RecordPayment({
  initialDirection,
  initialParty,
  initialDoc,
  onClose,
}: {
  initialDirection: Direction;
  initialParty?: string | undefined;
  initialDoc?: string | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [party, setParty] = useState<Option | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, Alloc>>({});
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [date, setDate] = useState(today());
  const [bank, setBank] = useState<Option | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [rates, setRates] = useState<Currency[]>([]);
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [fx, setFx] = useState('');
  const [more, setMore] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const bankRow = (bank?.data as Bank | undefined) ?? null;
  const cur = bankRow?.currency ?? base;
  const role = direction === 'in' ? 'customer' : 'supplier';
  const docType = direction === 'in' ? 'invoice' : 'bill';

  // Accounts and exchange rates, once.
  useEffect(() => {
    op<BankList>('banks.list', {}, { quiet: true })
      .then((r) => setBanks(r.banks.filter((b) => !b.archived)))
      .catch(() => undefined);
    op<{ currencies: Currency[] }>('currencies.list', {}, { quiet: true })
      .then((r) => setRates(r.currencies))
      .catch(() => undefined);
  }, []);

  // A party handed in by the link (?party=...).
  useEffect(() => {
    if (initialParty === undefined || initialParty === '') return;
    op<{ id: string; name: string; code: string; email: string }>('parties.get', { party: initialParty }, { quiet: true })
      .then((p) => setParty(partyOption(p)))
      .catch(() => undefined);
  }, [initialParty]);

  // The party's open invoices or bills, oldest due first.
  useEffect(() => {
    setDocs(null);
    setAlloc({});
    if (party === null) return;
    let live = true;
    op<DocList>('docs.list', { type: docType, status: 'unpaid', party: party.id, sort: 'due', desc: false, limit: 200 }, { quiet: true })
      .then((r) => {
        if (!live) return;
        setDocs(r.docs);
        // A document handed in by the link is ticked in full.
        const pre = initialDoc !== undefined ? r.docs.find((d) => d.id === initialDoc || d.number === initialDoc) : undefined;
        if (pre !== undefined) {
          setAlloc({ [pre.id]: { on: true, text: minorToText(pre.balance, pre.currency) } });
          setAmount(minorToText(pre.balance, pre.currency));
          setAmountTouched(false);
        }
      })
      .catch(() => {
        if (live) setDocs([]);
      });
    return () => {
      live = false;
    };
  }, [party, docType, initialDoc]);

  // The account follows the documents' currency (a bank account first).
  useEffect(() => {
    if (banks.length === 0) return;
    const want = docs !== null && docs.length > 0 ? (docs[0]?.currency ?? base) : base;
    if (bankRow !== null && bankRow.currency === want) return;
    const pick = banks.find((b) => b.currency === want && b.kind === 'bank') ?? banks.find((b) => b.currency === want) ?? banks.find((b) => b.kind === 'bank') ?? banks[0];
    if (pick !== undefined) setBank(bankOption(pick));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks, docs, base]);

  // The rate of a foreign account, prefilled.
  useEffect(() => {
    if (cur === base) {
      setFx('');
      return;
    }
    const r = rates.find((c) => c.code === cur);
    setFx(r?.rate ?? '');
  }, [cur, base, rates]);

  const payable = useMemo(() => (docs ?? []).filter((d) => d.currency === cur), [docs, cur]);
  const otherCurrency = useMemo(() => (docs ?? []).filter((d) => d.currency !== cur), [docs, cur]);

  const amountMinor = amount === '' ? 0 : (toMinor(amount, cur) ?? 0);
  const applied = payable.reduce((s, d) => {
    const a = alloc[d.id];
    if (a === undefined || !a.on) return s;
    return s + (toMinor(a.text, cur) ?? 0);
  }, 0);
  const left = amountMinor - applied;
  const overApplied = applied > amountMinor && amountMinor > 0;
  const badAlloc = payable.some((d) => {
    const a = alloc[d.id];
    if (a === undefined || !a.on) return false;
    const v = toMinor(a.text, cur);
    return v === null || v <= 0 || v > d.balance;
  });

  /** Fill the open documents oldest first with `total`. */
  const fillOldest = (total: number): void => {
    let rest = total;
    const next: Record<string, Alloc> = {};
    for (const d of payable) {
      if (rest <= 0) break;
      const take = Math.min(rest, d.balance);
      next[d.id] = { on: true, text: minorToText(take, cur) };
      rest -= take;
    }
    setAlloc(next);
  };

  const onAmount = (v: string): void => {
    setAmount(v);
    setAmountTouched(v !== '');
    const m = v === '' ? 0 : (toMinor(v, cur) ?? 0);
    fillOldest(m);
  };

  const sumWith = (next: Record<string, Alloc>): number =>
    payable.reduce((s, d) => {
      const a = next[d.id];
      return a !== undefined && a.on ? s + (toMinor(a.text, cur) ?? 0) : s;
    }, 0);

  const toggle = (d: DocRow): void => {
    const was = alloc[d.id];
    const next = { ...alloc };
    if (was?.on === true) next[d.id] = { on: false, text: was.text };
    else {
      const others = sumWith({ ...alloc, [d.id]: { on: false, text: '' } });
      const room = amountTouched ? Math.max(0, amountMinor - others) : d.balance;
      next[d.id] = { on: true, text: minorToText(room > 0 ? Math.min(room, d.balance) : d.balance, cur) };
    }
    setAlloc(next);
    if (!amountTouched) {
      const s = sumWith(next);
      setAmount(s > 0 ? minorToText(s, cur) : '');
    }
  };

  const editAlloc = (d: DocRow, text: string): void => {
    const next = { ...alloc, [d.id]: { on: true, text } };
    setAlloc(next);
    if (!amountTouched) {
      const s = sumWith(next);
      setAmount(s > 0 ? minorToText(s, cur) : '');
    }
  };

  const switchDirection = (d: Direction): void => {
    if (d === direction) return;
    setDirection(d);
    setParty(null);
    setAmount('');
    setAmountTouched(false);
  };

  const allocations = payable
    .filter((d) => alloc[d.id]?.on === true)
    .map((d) => ({ doc: d.number !== '' ? d.number : d.id, amount: normalizeNumber(alloc[d.id]?.text ?? '', decimalsOf(cur)) ?? '' }));

  const ready = party !== null && bank !== null && amountMinor > 0 && !overApplied && !badAlloc && (cur === base || fx !== '');
  const params = {
    direction,
    party: party?.id ?? '',
    bank: bank?.id ?? '',
    date,
    amount: amountMinor > 0 ? minorToText(amountMinor, cur) : '',
    method,
    reference: reference.trim() === '' ? undefined : reference.trim(),
    memo: memo.trim() === '' ? undefined : memo.trim(),
    fx_rate: cur !== base && fx !== '' ? fx : undefined,
    allocations,
  };

  const s1 = party !== null ? 'done' : 'current';
  const s2 = party === null ? 'todo' : applied > 0 ? 'done' : 'current';
  const s3 = ready ? 'current' : party !== null ? 'current' : 'todo';
  const open = payable.reduce((s, d) => s + d.balance, 0);
  const overdue = payable.filter((d) => d.status === 'overdue').length;
  const InIcon = direction === 'in' ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="pb-12">
      <ScreenBar
        title="Record a payment"
        sub={direction === 'in' ? 'Money a customer paid you' : 'Money you paid a supplier'}
        onClose={onClose}
        actions={
          <Segmented
            ariaLabel="Money in or out"
            value={direction}
            onChange={switchDirection}
            options={[
              { value: 'in', label: 'Money in', icon: ArrowDownLeft },
              { value: 'out', label: 'Money out', icon: ArrowUpRight },
            ]}
            className="hidden @min-[480px]:inline-flex"
          />
        }
      />
      <div className="mx-auto w-full max-w-[1180px] px-4 @min-[640px]:px-8">
        <Segmented
          ariaLabel="Money in or out"
          value={direction}
          onChange={switchDirection}
          options={[
            { value: 'in', label: 'Money in', icon: ArrowDownLeft },
            { value: 'out', label: 'Money out', icon: ArrowUpRight },
          ]}
          className="mb-4 w-full @min-[480px]:hidden"
        />
        <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1fr)] min-[1100px]:gap-5">
          {/* 1. Who */}
          <Step n={1} state={s1} title={direction === 'in' ? 'Who paid you' : 'Who you paid'} delay={1}>
            <PartyPicker value={party} onChange={setParty} role={role} />
            {party !== null && docs !== null && (
              <div className="erp-on-sand mt-4 rounded-[22px] bg-[var(--erp-sand)] p-4">
                <span className="block text-[12px] font-semibold text-[var(--erp-muted)]">{direction === 'in' ? 'They owe you' : 'You owe them'}</span>
                <span className="num block text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(open, cur)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--erp-muted)]">
                  {payable.length === 0 ? (direction === 'in' ? 'No open invoices' : 'No open bills') : `${payable.length} open ${direction === 'in' ? (payable.length === 1 ? 'invoice' : 'invoices') : payable.length === 1 ? 'bill' : 'bills'}`}
                  {overdue > 0 && (
                    <StatusPill tone="bad" size="sm">
                      {overdue} overdue
                    </StatusPill>
                  )}
                </span>
              </div>
            )}
            {party === null && (
              <p className="mt-4 text-[13px] leading-5 text-[var(--erp-muted)]">{direction === 'in' ? 'Their open invoices show next, oldest first.' : 'Their open bills show next, oldest first.'}</p>
            )}
          </Step>

          {/* 2. What it settles */}
          <Step
            n={2}
            state={s2}
            title="What it settles"
            delay={2}
            hint={payable.length > 0 ? `${allocations.length} of ${payable.length}` : undefined}
          >
            {party === null ? (
              <Empty icon={FileText} title={direction === 'in' ? 'Open invoices' : 'Open bills'} compact>
                Choose {direction === 'in' ? 'a customer' : 'a supplier'} first.
              </Empty>
            ) : docs === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : payable.length === 0 ? (
              <Empty icon={Wallet} title={direction === 'in' ? 'Nothing open to settle' : 'Nothing open to pay'} compact>
                The whole amount stays as credit on {party.label}, ready for their next {direction === 'in' ? 'invoice' : 'bill'}.
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {payable.map((d) => {
                  const a = alloc[d.id];
                  const on = a?.on === true;
                  const v = on ? toMinor(a.text, cur) : null;
                  const bad = on && (v === null || v <= 0 || v > d.balance);
                  return (
                    <li key={d.id} className={cn('flex items-center gap-3 rounded-[18px] px-3 py-2.5 transition-colors', on ? 'bg-[var(--erp-accent-soft)]' : 'bg-[var(--erp-row)]')}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`Settle ${d.number}`}
                        onClick={() => toggle(d)}
                        className={cn('flex size-6 shrink-0 items-center justify-center rounded-full transition-colors', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)]')}
                      >
                        {on && <Check size={14} strokeWidth={3} />}
                      </button>
                      <button type="button" onClick={() => toggle(d)} className="min-w-0 flex-1 text-left">
                        <span className="flex items-center gap-2">
                          <span className="num truncate text-[14px] font-bold">{d.number}</span>
                          {d.status === 'overdue' && (
                            <StatusPill tone="bad" size="sm" className="hidden @min-[480px]:inline-flex">
                              {d.days_overdue > 0 ? `${d.days_overdue} days late` : 'Overdue'}
                            </StatusPill>
                          )}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                          {d.status === 'overdue' && <span className="font-semibold text-[var(--erp-red-text)] @min-[480px]:hidden">Late · </span>}
                          {d.due_date !== '' ? `Due ${dayLabel(d.due_date)}` : dayLabel(d.date)} · {money(d.balance, cur)} open
                        </span>
                      </button>
                      <input
                        value={on ? a.text : ''}
                        onChange={(e) => editAlloc(d, e.target.value)}
                        onFocus={() => {
                          if (!on) toggle(d);
                        }}
                        inputMode="decimal"
                        placeholder={minorToText(d.balance, cur)}
                        aria-label={`Amount for ${d.number}`}
                        aria-invalid={bad}
                        className={cn(cellInput, 'num w-24 shrink-0 bg-[var(--erp-card)] text-right @min-[480px]:w-28', bad && 'ring-2 ring-[var(--erp-red)]')}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {otherCurrency.length > 0 && (
              <p className="mt-3 text-[12px] text-[var(--erp-muted)]">
                {otherCurrency.length} more in {[...new Set(otherCurrency.map((d) => d.currency))].join(', ')}: choose an account in that currency to settle them.
              </p>
            )}
          </Step>

          {/* 3. The money */}
          <Step n={3} state={s3} title="The money" delay={3}>
            <div className="flex flex-1 flex-col gap-4">
              <div className="erp-on-dark rounded-[22px] bg-[var(--erp-dark)] p-4 text-[var(--erp-on-dark)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">
                    <InIcon size={14} aria-hidden />
                    {direction === 'in' ? 'Received' : 'Paid'}
                  </span>
                  <span className="rounded-full bg-[var(--erp-dark-2)] px-3 py-1 text-[12px] font-semibold">{cur}</span>
                </div>
                <MoneyInput
                  value={amount}
                  onChange={onAmount}
                  currency={cur}
                  ariaLabel="Amount"
                  className="mt-3 [&_input]:h-14 [&_input]:bg-[var(--erp-dark-2)] [&_input]:text-[26px] [&_input]:font-extrabold [&_input]:text-[var(--erp-on-dark)] [&_span]:text-[15px] [&_span]:text-[var(--erp-on-dark-muted)]"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2">
                    <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">Applied</span>
                    <span className="num block text-[15px] font-bold">{money(applied, cur)}</span>
                  </div>
                  <div className="rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2">
                    <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{left >= 0 ? 'Left as credit' : 'Short by'}</span>
                    <span className={cn('num block text-[15px] font-bold', left < 0 && 'text-[var(--erp-red-on-dark)]')}>{money(Math.abs(left), cur)}</span>
                  </div>
                </div>
              </div>
              {overApplied && (
                <Notice tone="bad">
                  The amounts to settle add up to {money(applied, cur)}, more than the {money(amountMinor, cur)} {direction === 'in' ? 'received' : 'paid'}.
                </Notice>
              )}
              <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2 min-[1100px]:grid-cols-1">
                <Field label="Date">
                  <DateField value={date} onChange={setDate} ariaLabel="Date" />
                </Field>
                <Field label={direction === 'in' ? 'Into' : 'From'}>
                  <BankPicker value={bank} onChange={setBank} />
                </Field>
              </div>
              <Field label="How">
                <ChoicePills ariaLabel="How it was paid" value={method} onChange={setMethod} options={METHODS} />
              </Field>
              <Field label="Reference" optional>
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="Bank reference or cheque number" aria-label="Reference" className={softInput} />
              </Field>
              <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
                {cur !== base && (
                  <Field label={`Exchange rate (${base} for 1 ${cur})`} hint="Prefilled with the rate on file">
                    <input value={fx} onChange={(e) => setFx(e.target.value)} inputMode="decimal" aria-label="Exchange rate" className={cn(softInput, 'num')} />
                  </Field>
                )}
                <Field label="Memo" optional>
                  <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} aria-label="Memo" className={softInput} />
                </Field>
              </MoreOptions>
              {cur !== base && !more && <p className="text-[12px] text-[var(--erp-muted)]">In {cur} at {fx !== '' ? fx : 'no rate yet'} {base} each.</p>}
              <div className="mt-auto pt-2">
                <PillButton icon={Check} dot disabled={!ready} onClick={() => setConfirming(true)} className="h-14 w-full text-[15px]">
                  {amountMinor > 0 ? `Record ${money(amountMinor, cur)}` : 'Record the payment'}
                </PillButton>
              </div>
            </div>
          </Step>
        </div>
      </div>
      <ConfirmPosting
        open={confirming}
        onClose={() => setConfirming(false)}
        title={direction === 'in' ? 'Record money in' : 'Record money out'}
        verb="Record and post"
        previewOp="payments.preview-record"
        runOp="payments.record"
        params={params}
        intro={
          <p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">
            {money(amountMinor, cur)} {direction === 'in' ? 'from' : 'to'} <b>{party?.label ?? ''}</b>
            {applied > 0 ? `, settling ${allocations.map((a) => a.doc).join(', ')}` : ''}
            {left > 0 ? `, ${money(left, cur)} left as credit` : ''}.
          </p>
        }
        onDone={(r) => {
          const p = r as Payment;
          toast.success(`${p.number} recorded`);
          navigate('payment', { id: p.id });
        }}
      />
    </div>
  );
}

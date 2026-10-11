/**
 * The smaller sheets of the sell screen: the customer, a discount on the
 * whole sale (by hand, a saved promotion or a code), the ticket's name and
 * note, selling a gift card, a custom amount, clearing the sale and
 * keeping it open while starting another.
 */
import { useEffect, useState } from 'react';
import { BadgePercent, Check, Gift, Plus, Tag, UserPlus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { plain, toMinor, time } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useScanner } from '../../lib/scanner.ts';
import type { Customer, Discount, Order } from '../../lib/types.ts';
import { Avatar, MoneyField, SearchField, useDebounced } from '../common.tsx';
import { AmountPad, AmountReadout } from '../pads.tsx';
import { Button, Field, Modal, Segmented, Spinner, inputCls, textareaCls } from '../ui.tsx';
import { useTicket } from './ticket.tsx';

/* --------------------------------------------------------------- customer */

export function CustomerPicker({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const ticket = useTicket();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 200);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useLive(() => (open ? api.customers({ q: term, limit: 30, sort: term === '' ? 'recent' : undefined }, { quiet: true }) : Promise.resolve(null)), ['customers'], [open, term]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setAdding(false);
      setName('');
      setPhone('');
      setEmail('');
    }
  }, [open]);

  const attach = async (c: Customer): Promise<void> => {
    setBusy(true);
    const ok = await ticket.change({ customer: c.id });
    setBusy(false);
    if (ok) onClose();
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.saveCustomer({ name: name.trim(), phone: phone.trim(), email: email.trim() });
      const ok = await ticket.change({ customer: r.customer.id });
      if (ok) onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  const rows = list.data?.customers ?? [];
  return (
    <Modal touch open={open} onClose={onClose} title={adding ? 'New customer' : 'Customer'} wide>
      {adding ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() !== '') void create();
          }}
        >
          <div className="sm:col-span-2">
            <Field label="Name">
              <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
            </Field>
          </div>
          <Field label="Phone">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Email">
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} inputMode="email" autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => setAdding(false)}>Back</Button>
            <Button type="submit" variant="primary" icon={Check} loading={busy} disabled={name.trim() === ''}>
              Add to the sale
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <SearchField value={q} onChange={setQ} placeholder="Name, phone or email" autoFocus className="flex-1 [&_input]:h-9" />
            <Button
              size="lg"
              icon={UserPlus}
              className="h-9"
              onClick={() => setAdding(true)}
            >
              New
            </Button>
          </div>
          {list.loading && rows.length === 0 ? (
            <div className="flex justify-center py-6">
              <Spinner size={16} className="text-[var(--ps-muted)]" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--ps-muted)]">{term === '' ? 'No customers yet' : 'Nobody matches "' + term + '"'}</p>
          ) : (
            <ul className="-mx-1 max-h-[46vh] overflow-y-auto">
              {rows.map((c) => (
                <li key={c.id}>
                  <button type="button" disabled={busy} onClick={() => void attach(c)} className="flex w-full items-center gap-3 rounded-[var(--ps-r)] px-2 py-2 text-left hover:bg-[var(--ps-row)]">
                    <Avatar name={c.name} size={32} color="accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                      <span className="block truncate text-[12px] text-[var(--ps-muted)]">{[c.phone, c.email].filter((x) => x !== '').join(' · ') || 'No contact'}</span>
                    </span>
                    <span className="shrink-0 text-right text-[12px] text-[var(--ps-muted)]">
                      {settings?.loyalty_enabled ? <span className="block font-semibold text-[var(--ps-ink-2)]">{c.points} pts</span> : null}
                      {c.credit > 0 && <span className="num block">{money.fmt(c.credit)} credit</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------- order discount */

const QUICK = [5, 10, 15, 20];

export function OrderDiscountDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money } = useStore();
  const ticket = useTicket();
  const order = ticket.order;
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const promos = useLive(() => (open ? api.discounts() : Promise.resolve(null)), ['discounts'], [open]);
  const manual = (promos.data?.discounts ?? []).filter((d) => d.mode === 'manual' && d.scope === 'order' && d.active);
  const current = order?.order_discount ?? null;

  useEffect(() => {
    if (!open) return;
    setKind('percent');
    setValue('');
    setReason('');
    setCode('');
  }, [open]);

  const apply = async (input: Parameters<typeof ticket.change>[0]): Promise<void> => {
    setBusy(true);
    const ok = await ticket.change(input);
    setBusy(false);
    if (ok) onClose();
  };

  const num = kind === 'percent' ? Number(value.replace(',', '.')) : toMinor(value, money.digits);
  const ok = num !== null && Number.isFinite(num) && num > 0 && (kind !== 'percent' || num <= 100);

  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title="Discount on the sale"
      description={current !== null ? 'Now: ' + (current.source === 'code' ? 'code ' + (current.code ?? '') : current.name) : undefined}
      wide
      footer={
        <>
          {current !== null && (
            <Button variant="danger" className="mr-auto" onClick={() => void apply({ discount: null })} disabled={busy}>
              Remove the discount
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={BadgePercent} loading={busy} disabled={!ok} onClick={() => void apply({ discount: { kind, value: kind === 'percent' ? (num ?? 0) : plain(num ?? 0, money.digits), reason: reason.trim() } })}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {manual.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-[var(--ps-ink-2)]">Saved discounts</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {manual.map((d: Discount) => (
                <button key={d.id} type="button" disabled={busy} onClick={() => void apply({ discount: { promotion: d.id } })} className="flex h-12 flex-col items-start justify-center rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] px-3 text-left hover:bg-[var(--ps-row)]">
                  <span className="w-full truncate text-[13px] font-semibold">{d.name}</span>
                  <span className="num text-[12px] text-[var(--ps-muted)]">{d.kind === 'percent' ? d.value + '% off' : money.fmt(d.value) + ' off'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">By hand</h3>
            <Segmented
              label="Kind"
              size="sm"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setValue('');
              }}
              options={[
                { value: 'percent', label: 'Percent' },
                { value: 'amount', label: 'Amount' },
              ]}
            />
          </div>
          {kind === 'percent' ? (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((p) => (
                <button key={p} type="button" aria-pressed={value === String(p)} onClick={() => setValue(String(p))} className={cn('num h-10 w-16 rounded-[var(--ps-r)] border text-[13px] font-semibold', value === String(p) ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
                  {p}%
                </button>
              ))}
              <input aria-label="Percent" className={cn(inputCls, 'num h-10 w-24 text-right')} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="%" />
            </div>
          ) : (
            <MoneyField value={value} onChange={setValue} money={money} label="Amount off" className="w-40 [&_input]:h-10" />
          )}
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason (kept with the sale)" />
        </section>
        <section className="flex flex-col gap-2 border-t border-[var(--ps-hair)] pt-3">
          <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">Promotion code</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim() !== '') void apply({ code: code.trim() });
            }}
          >
            <input className={cn(inputCls, 'h-9 flex-1 uppercase tracking-wider')} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="SUMMER10" aria-label="Promotion code" />
            <Button type="submit" size="lg" icon={Tag} className="h-9" disabled={code.trim() === '' || busy}>
              Use code
            </Button>
          </form>
        </section>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- name, note */

export function NameDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const ticket = useTicket();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setLabel(ticket.order?.label ?? '');
      setNote(ticket.order?.note ?? '');
    }
  }, [open, ticket.order]);
  const save = async (): Promise<void> => {
    setBusy(true);
    const ok = await ticket.change({ label: label.trim(), note: note.trim() });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title="Name and note"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Ticket name" hint="A table, a name or an order number; open tickets are listed by it">
          <input autoFocus className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Table 4" />
        </Field>
        <Field label="Note" hint="Printed on the receipt">
          <textarea className={textareaCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- gift card */

export function GiftCardDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money } = useStore();
  const ticket = useTicket();
  const [amount, setAmount] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const unit = 10 ** money.digits;
  const presets = [25, 50, 100].map((x) => x * unit);
  useEffect(() => {
    if (open) {
      setAmount(0);
      setCode('');
    }
  }, [open]);
  useScanner((c) => setCode(c), open);
  const add = async (): Promise<void> => {
    if (amount <= 0) return;
    setBusy(true);
    const ok = await ticket.add({ kind: 'gift_card', amount: plain(amount, money.digits), gift_code: code.trim() !== '' ? code.trim() : undefined });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title="Sell a gift card"
      description="A new card, or money added to a card the customer has."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Gift} loading={busy} disabled={amount <= 0} onClick={() => void add()}>
            Add {money.fmt(amount)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p) => (
            <button key={p} type="button" aria-pressed={amount === p} onClick={() => setAmount(p)} className={cn('num h-11 rounded-[var(--ps-r-md)] border text-[14px] font-bold', amount === p ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
              {money.fmt(p)}
            </button>
          ))}
        </div>
        <AmountReadout minor={amount} digits={money.digits} symbol={money.symbol} className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] py-2" />
        <AmountPad value={amount} onChange={setAmount} onEnter={() => void add()} />
        <Field label="Card number" hint="Scan a printed card, or leave empty and a number is made when the sale is paid">
          <input className={cn(inputCls, 'num tracking-wider')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- custom amount */

export function CustomAmountDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money, catalog } = useStore();
  const ticket = useTicket();
  const [amount, setAmount] = useState(0);
  const [name, setName] = useState('');
  const [taxed, setTaxed] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const hasTax = (catalog?.taxes ?? []).some((t) => t.is_default);
  useEffect(() => {
    if (open) {
      setAmount(0);
      setName('');
      setTaxed('yes');
    }
  }, [open]);
  const add = async (): Promise<void> => {
    if (amount <= 0) return;
    setBusy(true);
    const ok = await ticket.add({ kind: 'custom', amount: plain(amount, money.digits), name: name.trim() || undefined, tax: hasTax && taxed === 'yes' ? 'default' : 'none' });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title="Custom amount"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Plus} loading={busy} disabled={amount <= 0} onClick={() => void add()}>
            Add {money.fmt(amount)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <AmountReadout minor={amount} digits={money.digits} symbol={money.symbol} className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] py-3" />
        <AmountPad value={amount} onChange={setAmount} onEnter={() => void add()} />
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on the receipt (optional)" maxLength={120} />
        {hasTax && (
          <Segmented
            label="Tax"
            value={taxed}
            onChange={setTaxed}
            options={[
              { value: 'yes', label: 'With tax' },
              { value: 'no', label: 'No tax' },
            ]}
            className="self-start"
          />
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- clear, park */

export function ClearDialog({ open, onClose, onCleared }: { open: boolean; onClose: () => void; onCleared: () => void }): React.JSX.Element {
  const { money } = useStore();
  const ticket = useTicket();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const order = ticket.order;
  const paid = (order?.payments ?? []).some((p) => p.status === 'captured');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const clear = async (): Promise<void> => {
    if (order === null) return;
    setBusy(true);
    try {
      await api.voidOrder(order.id, reason.trim());
      onCleared();
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title="Clear this sale?"
      description={order !== null ? order.lines.length + ' lines, ' + money.fmt(order.total) : undefined}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="primary" loading={busy} disabled={paid} onClick={() => void clear()}>
            Clear the sale
          </Button>
        </>
      }
    >
      {paid ? (
        <p className="text-[13px] text-[var(--ps-ink-2)]">Payments were taken on this sale. Void them in checkout first, or finish the sale.</p>
      ) : (
        <Field label="Reason" hint="Kept in the activity log">
          <input autoFocus className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder="Customer changed their mind" />
        </Field>
      )}
    </Modal>
  );
}

/** Starting a new sale while this one has items: keep it as an open ticket (with a name) or clear it. */
export function ParkDialog({ order, onClose, onKept, onClear }: { order: Order | null; onClose: () => void; onKept: () => void; onClear: () => void }): React.JSX.Element {
  const ticket = useTicket();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (order !== null) setLabel(order.label !== '' ? order.label : order.customer !== null ? order.customer.name : 'Ticket ' + time(new Date()));
  }, [order]);
  const keep = async (): Promise<void> => {
    if (order === null) return;
    setBusy(true);
    const ok = label.trim() === order.label ? true : await ticket.change({ label: label.trim() });
    setBusy(false);
    if (ok) onKept();
  };
  return (
    <Modal touch
      open={order !== null}
      onClose={onClose}
      title="Keep this sale open?"
      description="It stays in Tickets until someone finishes it."
      footer={
        <>
          <Button variant="danger" className="mr-auto" onClick={onClear}>
            Clear it instead
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} onClick={() => void keep()}>
            Keep open
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void keep();
        }}
      >
        <Field label="Ticket name">
          <input autoFocus className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </Field>
      </form>
    </Modal>
  );
}

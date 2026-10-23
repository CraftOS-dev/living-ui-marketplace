/**
 * The sale, always on screen: a white card with the sale's name, tickets,
 * order type and customer at the top; the lines as soft rows (tap one for
 * its quantity, discount, price, options, note or to remove it; a removed
 * line can be put back); the quiet actions (save as a ticket, discount,
 * more); and the dark card that holds what is due and the pay button.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, Minus, MoreHorizontal, Pencil, Percent, Plus, RotateCcw, ShoppingBag, Sparkles, StickyNote, Tag, Ticket, Trash2, Undo2, User, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { cartStore, useCart } from '../../lib/cart.ts';
import type { CartLine, CartTotals, LineDiscount, PricedLine } from '../../lib/cart.ts';
import { useApp } from '../../lib/context.tsx';
import { ORDER_TYPE_LABEL, money, percent } from '../../lib/format.ts';
import type { OrderType } from '../../lib/types.ts';
import { Badge, Button, Count, IconBadge, IconButton, Popover, Segmented, Toggle, menuItem } from '../ui.tsx';
import { CustomerDialog, DiscountDialog, PriceDialog, TextDialog } from './Pickers.tsx';

function discountLabel(d: LineDiscount, currency: string, exp: number): string {
  const v = d.kind === 'percent' ? percent(d.value) : money(d.value, currency, exp);
  return d.name !== '' ? `${d.name} (${v})` : `Discount ${v}`;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }): React.JSX.Element {
  const btn = 'ps-press flex size-10 items-center justify-center rounded-full bg-[var(--ps-card)] hover:bg-[var(--ps-row-hover)] disabled:opacity-40';
  return (
    <div className="flex items-center gap-1 rounded-full bg-[var(--ps-card)] p-0.5">
      <button type="button" aria-label="One less" disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>
        <Minus size={16} aria-hidden />
      </button>
      <span className="num w-8 text-center text-[15px] font-bold" aria-label={`Quantity ${value}`}>
        {value}
      </span>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

interface Removed {
  line: CartLine;
  index: number;
  label: string;
}

/** A small pill action under an open line. */
const lineAction = 'ps-press inline-flex h-10 items-center gap-2 rounded-full bg-[var(--ps-card)] px-4 text-[13px] font-semibold hover:bg-[var(--ps-row-hover)]';

function Line({ pl, open, onToggle, onOptions, onRemoved, flash }: { pl: PricedLine; open: boolean; onToggle: () => void; onOptions: (l: CartLine) => void; onRemoved: (r: Removed) => void; flash: boolean }): React.JSX.Element {
  const { currency, exp, productById } = useApp();
  const l = pl.line;
  const [dialog, setDialog] = useState<'discount' | 'price' | 'note' | null>(null);
  const isReturn = pl.kind === 'return' || pl.kind === 'blind';
  const product = l.product !== '' ? productById.get(l.product) : undefined;
  const hasOptions = product !== undefined && !l.blind && (product.variants.length > 1 || product.modifier_groups.length > 0 || product.open_price);
  const shown = isReturn ? pl.net : pl.gross - pl.lineDiscount;
  return (
    <li className={cn('rounded-[18px] bg-[var(--ps-row)] transition-colors', flash && 'ps-flash', open && 'bg-[var(--ps-row-hover)]')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 rounded-[18px] px-3 py-3 text-left">
        <span className={cn('num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] font-bold', isReturn ? 'bg-[var(--ps-red)]/14 text-[var(--ps-red-text)]' : 'bg-[var(--ps-card)]')}>
          {isReturn ? `−${l.qty}` : l.qty}
        </span>
        <span className="min-w-0 flex-1 pt-px">
          <span className="block text-[14px] font-bold leading-5">
            {pl.mark !== '' && <span className="mr-1 text-[var(--ps-muted)]">{pl.mark}</span>}
            {pl.label}
            {pl.variantName !== '' && <span className="font-semibold text-[var(--ps-ink-2)]"> {pl.variantName}</span>}
          </span>
          {pl.modifiers.length > 0 && <span className="block text-[13px] leading-[18px] text-[var(--ps-ink-2)]">{pl.modifiers.map((m) => m.name).join(', ')}</span>}
          {isReturn && (
            <span className="block text-[12px] font-semibold text-[var(--ps-red-text)]">
              {l.origin !== null ? `Return from ${l.origin.sale_number}` : 'Return without a receipt'}
              {l.restock ? ', back to stock' : ''}
            </span>
          )}
          {l.discount !== null && <span className="block text-[12px] font-semibold text-[var(--ps-green-text)]">{discountLabel(l.discount, currency, exp)}</span>}
          {l.price !== null && product !== undefined && !product.open_price && <span className="block text-[12px] font-semibold text-[var(--ps-amber-text)]">Price changed from {money(pl.base, currency, exp)}</span>}
          {l.note !== '' && <span className="block text-[12px] italic text-[var(--ps-ink-2)]">{l.note}</span>}
          {pl.problem !== '' && (
            <span className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--ps-red-text)]">
              <CircleAlert size={12} aria-hidden /> {pl.problem}
            </span>
          )}
        </span>
        <span className="num shrink-0 pt-px text-right">
          <span className={cn('block text-[14px] font-bold leading-5', isReturn && 'text-[var(--ps-red-text)]')}>{money(shown, currency, exp)}</span>
          {l.qty > 1 && !isReturn && <span className="block text-[12px] text-[var(--ps-muted)]">{money(pl.unit, currency, exp)} each</span>}
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Stepper value={l.qty} min={1} max={l.origin !== null ? l.origin.left : 999} onChange={(v) => cartStore.setQty(l.key, v)} />
          {!isReturn && (
            <>
              <button type="button" className={lineAction} onClick={() => setDialog('discount')}>
                <Percent size={15} aria-hidden /> Discount
              </button>
              {product !== undefined && !product.open_price && (
                <button type="button" className={lineAction} onClick={() => setDialog('price')}>
                  <Tag size={15} aria-hidden /> Price
                </button>
              )}
              {hasOptions && (
                <button type="button" className={lineAction} onClick={() => onOptions(l)}>
                  <Pencil size={15} aria-hidden /> Options
                </button>
              )}
              <button type="button" className={lineAction} onClick={() => setDialog('note')}>
                <StickyNote size={15} aria-hidden /> Note
              </button>
            </>
          )}
          {isReturn && (
            <span className="flex h-10 items-center gap-2 px-1 text-[13px] font-semibold">
              <Toggle checked={l.restock} onChange={(v) => cartStore.update(l.key, { restock: v })} label="Back to stock" />
              Back to stock
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className={cn(lineAction, 'text-[var(--ps-red-text)]')}
            onClick={() => {
              const r = cartStore.remove(l.key);
              if (r !== null) onRemoved({ ...r, label: pl.label });
            }}
          >
            <Trash2 size={15} aria-hidden /> Remove
          </button>
        </div>
      )}
      {dialog === 'discount' && (
        <DiscountDialog
          title={`Discount on ${pl.label}`}
          base={pl.gross}
          current={l.discount}
          scope="item"
          onClose={() => setDialog(null)}
          onApply={(d, approvals) => {
            cartStore.update(l.key, { discount: d });
            if (approvals.length > 0) cartStore.addApprovals(approvals);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'price' && (
        <PriceDialog
          title={pl.label}
          current={pl.unit}
          onClose={() => setDialog(null)}
          onApply={(price, approvals) => {
            cartStore.update(l.key, { price });
            if (approvals.length > 0) cartStore.addApprovals(approvals);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'note' && (
        <TextDialog
          title={`Note on ${pl.label}`}
          label="Note (for the kitchen and the receipt)"
          initial={l.note}
          max={200}
          quick={['No ice', 'Less sugar', 'Extra hot', 'To go', 'No onion']}
          confirmLabel="Save note"
          onClose={() => setDialog(null)}
          onSave={(v) => {
            cartStore.update(l.key, { note: v });
            setDialog(null);
          }}
        />
      )}
    </li>
  );
}

/** One line of the dark card's sums. */
function DueRow({ label, value, good = false }: { label: string; value: string; good?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-[13px]', good ? 'font-semibold text-[var(--ps-on-dark)]' : 'text-[var(--ps-muted)]')}>
      <span className="truncate">{label}</span>
      <span className="num shrink-0 font-semibold">{value}</span>
    </div>
  );
}

export function CartPane({
  totals,
  blocked,
  onPay,
  onPark,
  onOptions,
  onReturns,
  onTickets,
  ticketCount,
  onClose,
}: {
  totals: CartTotals;
  /** Why paying is not possible right now (the register is closed), or ''. */
  blocked: string;
  /** Pay grows out of the button that was pressed. */
  onPay: (from: HTMLElement | null) => void;
  onPark: () => void;
  onOptions: (l: CartLine) => void;
  onReturns: () => void;
  onTickets: () => void;
  ticketCount: number;
  /** On phones the sale is a full screen with a way back. */
  onClose?: () => void;
}): React.JSX.Element {
  const cart = useCart();
  const { settings, currency, exp } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [dialog, setDialog] = useState<'customer' | 'discount' | 'note' | 'name' | null>(null);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const last = cartStore.lastAdded();
  const c = totals.calc;
  const types = settings?.order_types ?? [];
  const inclusive = settings?.price_mode === 'inclusive';
  const count = cart.lines.length;
  const title = cart.name !== '' ? cart.name : cart.ticketRef !== '' ? 'Ticket' : 'New sale';

  useEffect(() => {
    if (removed === null) return;
    const t = window.setTimeout(() => setRemoved(null), 6000);
    return () => window.clearTimeout(t);
  }, [removed]);

  // A new line scrolls into view at the bottom of the list.
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [count]);

  const due = c.total;
  const verb = due < 0 ? 'Refund' : due === 0 && totals.hasReturns ? 'Complete the exchange' : 'Pay';
  const itemsBase = totals.lines.filter((x) => x.kind === 'item' || x.kind === 'custom').reduce((s, x) => s + x.gross - x.lineDiscount, 0);
  const canPay = blocked === '' && count > 0 && totals.problems.length === 0;

  return (
    <div className="ps-on-card flex h-full min-h-0 flex-col gap-3 rounded-[28px] bg-[var(--ps-card)] p-4">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          {onClose !== undefined && <IconButton icon={ArrowLeft} label="Back to the products" variant="secondary" onClick={onClose} />}
          <button type="button" onClick={() => setDialog('name')} aria-label={`Name this sale (${title})`} className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left hover:bg-[var(--ps-row)]">
            <span className="truncate text-[15px] font-bold">{title}</span>
            <Pencil size={13} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
          </button>
          <Button size="sm" className="h-10 gap-2" icon={Ticket} onClick={onTickets}>
            Tickets
            {ticketCount > 0 && <Count n={ticketCount} on />}
          </Button>
        </div>
        {cart.ticketSource === 'agent' && (
          <Badge tone="agent" className="self-start">
            <Sparkles size={13} aria-hidden /> From your AI agent
          </Badge>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {types.length > 0 && (
            <Segmented<OrderType>
              label="Order type"
              value={(cart.orderType !== '' ? cart.orderType : types[0]) as OrderType}
              onChange={(t) => cartStore.setOrderType(t)}
              options={types.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] ?? t }))}
            />
          )}
          <span className="flex-1" />
          {cart.customer !== null ? (
            <span className="flex h-11 min-w-0 items-center gap-2 rounded-full bg-[var(--ps-row)] pl-1.5 pr-1 text-[13px] font-bold">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)]">
                <User size={15} />
              </span>
              <button type="button" onClick={() => setDialog('customer')} className="truncate">
                {cart.customer.name}
              </button>
              <button type="button" aria-label="Remove the customer" onClick={() => cartStore.setCustomer(null)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--ps-muted)] hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-ink)]">
                <X size={14} aria-hidden />
              </button>
            </span>
          ) : (
            <Button icon={User} onClick={() => setDialog('customer')}>
              Customer
            </Button>
          )}
        </div>
      </div>

      {count === 0 ? (
        <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <IconBadge icon={ShoppingBag} size={56} />
          <p className="text-[15px] font-bold">No items yet</p>
          <div className="flex flex-wrap justify-center gap-2">
            {ticketCount > 0 && (
              <Button icon={Ticket} onClick={onTickets}>
                Open a ticket
              </Button>
            )}
            <Button icon={RotateCcw} onClick={onReturns}>
              Return items
            </Button>
          </div>
        </div>
      ) : (
        <ul ref={listRef} className="ps-no-scrollbar -mr-1 flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-label="Items in the sale">
          {totals.lines.map((pl) => (
            <Line
              key={pl.line.key}
              pl={pl}
              open={open === pl.line.key}
              flash={pl.line.key === last && Date.now() - pl.line.added < 900}
              onToggle={() => setOpen(open === pl.line.key ? null : pl.line.key)}
              onOptions={(l) => {
                setOpen(null);
                onOptions(l);
              }}
              onRemoved={(r) => {
                setOpen(null);
                setRemoved(r);
              }}
            />
          ))}
        </ul>
      )}

      {removed !== null && (
        <div role="status" className="ps-pop ps-on-ink flex shrink-0 items-center gap-2 rounded-full bg-[var(--ps-ink)] py-1.5 pl-5 pr-1.5 text-[var(--ps-shell)]">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Removed {removed.label}</span>
          <button
            type="button"
            onClick={() => {
              cartStore.restore(removed.line, removed.index);
              setRemoved(null);
            }}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-shell)]/10"
          >
            <Undo2 size={14} aria-hidden /> Undo
          </button>
        </div>
      )}

      {cart.note !== '' && (
        <p className="flex shrink-0 items-center gap-2 truncate px-1 text-[12px] italic text-[var(--ps-ink-2)]">
          <StickyNote size={13} aria-hidden className="shrink-0" /> {cart.note}
        </p>
      )}

      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Button disabled={count === 0} onClick={onPark}>
          Save
        </Button>
        <Button icon={Percent} disabled={!totals.hasSales} onClick={() => setDialog('discount')}>
          Discount
        </Button>
        <div className="relative">
          <Button ref={moreRef} className="w-full" icon={MoreHorizontal} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            More
          </Button>
          <Popover open={more} onClose={() => setMore(false)} keep={moreRef} align="right" className="bottom-[calc(100%+8px)] top-auto w-60">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMore(false);
                setDialog('note');
              }}
            >
              <StickyNote size={16} /> {cart.note !== '' ? 'Edit the order note' : 'Note on the order'}
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMore(false);
                onReturns();
              }}
            >
              <RotateCcw size={16} /> Return items
            </button>
            <button
              type="button"
              disabled={count === 0}
              className={cn(menuItem, 'disabled:opacity-40')}
              onClick={() => {
                setMore(false);
                cartStore.clear(settings?.default_order_type ?? '');
              }}
            >
              <Trash2 size={16} /> Clear the sale
            </button>
          </Popover>
        </div>
      </div>

      {/* What is due, and the way to take it. */}
      <div className="ps-on-dark shrink-0 rounded-[24px] bg-[var(--ps-dark)] p-4 text-[var(--ps-on-dark)]">
        {count > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">
            <DueRow label={`Subtotal · ${totals.items === 1 ? '1 item' : `${totals.items} items`}`} value={money(c.subtotal, currency, exp)} />
            {c.discount_total !== 0 && <DueRow label={cart.discount !== null ? discountLabel(cart.discount, currency, exp) : 'Discounts'} value={money(-c.discount_total, currency, exp)} good />}
            {c.service_charge !== 0 && <DueRow label={`Service charge ${settings !== null ? percent(settings.service_charge_bp) : ''}`} value={money(c.service_charge, currency, exp)} />}
            {inclusive
              ? c.tax_total !== 0 && <DueRow label="Tax included" value={money(c.tax_total, currency, exp)} />
              : c.taxes.filter((t) => t.tax !== 0).map((t) => <DueRow key={`${t.tax_id}${t.rate_bp}`} label={t.name} value={money(t.tax, currency, exp)} />)}
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-bold">{due < 0 ? 'Refund' : 'Total'}</span>
          <span className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.01em]', count === 0 && 'text-[var(--ps-muted)]')}>{money(Math.abs(due), currency, exp)}</span>
        </div>
        <button
          type="button"
          data-pay-button
          disabled={!canPay}
          onClick={(e) => onPay(e.currentTarget)}
          aria-label={canPay ? `${verb} ${money(Math.abs(due), currency, exp)}` : undefined}
          className="ps-press mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[var(--ps-accent-fill)] px-5 text-[15px] font-bold text-[var(--ps-on-accent)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--ps-dark-2)] disabled:text-[var(--ps-muted)] disabled:hover:opacity-100"
        >
          {blocked !== '' ? blocked : totals.problems.length > 0 ? 'Check the items' : verb}
          {canPay && <ArrowRight size={18} strokeWidth={2.4} aria-hidden />}
        </button>
      </div>

      {dialog === 'customer' && (
        <CustomerDialog
          onClose={() => setDialog(null)}
          onPick={(cust) => {
            cartStore.setCustomer(cust);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'discount' && (
        <DiscountDialog
          title="Discount on the order"
          base={itemsBase}
          current={cart.discount}
          scope="order"
          onClose={() => setDialog(null)}
          onApply={(d, approvals) => {
            cartStore.setDiscount(d);
            if (approvals.length > 0) cartStore.addApprovals(approvals);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'note' && (
        <TextDialog
          title="Note on the order"
          label="Note (for the kitchen and the receipt)"
          initial={cart.note}
          max={300}
          confirmLabel="Save note"
          onClose={() => setDialog(null)}
          onSave={(v) => {
            cartStore.setNote(v);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'name' && (
        <TextDialog
          title="Name this sale"
          label="Table, name or number"
          initial={cart.name}
          max={40}
          quick={['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'Bar', 'Patio']}
          confirmLabel="Save"
          onClose={() => setDialog(null)}
          onSave={(v) => {
            cartStore.setName(v);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

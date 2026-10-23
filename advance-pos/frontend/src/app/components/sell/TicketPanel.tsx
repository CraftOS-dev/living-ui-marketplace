/**
 * The sale side of the sell screen: the ticket's name and the open
 * tickets, the customer, the lines (tap one to change it), the totals and
 * the dark charge card. Everything a cashier does to a sale is one tap from
 * here; the rarer actions sit in the ticket menu.
 */
import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Ban, BadgePercent, ChevronRight, CircleDollarSign, Gift, Layers, MoreHorizontal, PencilLine, Plus, Receipt, RotateCcw, ShoppingBag, UserPlus, Vault, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { qty as qtyText, time } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useSession } from '../../lib/session.tsx';
import type { Order, OrderLine } from '../../lib/types.ts';
import { Avatar } from '../common.tsx';
import { IconButton, Popover, Spinner, menuItem } from '../ui.tsx';
import { useTicket } from './ticket.tsx';

export type TicketAction = 'name' | 'discount' | 'tax' | 'return' | 'gift_card' | 'custom' | 'clear' | 'no_sale' | 'pay_in' | 'pay_out' | 'customer' | 'new';

function Line({ l, order, onOpen }: { l: OrderLine; order: Order; onOpen: () => void }): React.JSX.Element {
  const { money } = useStore();
  const isReturn = l.qty < 0;
  const source = l.return_of !== '' ? order.sources[l.return_of] : undefined;
  const q = Math.abs(l.qty);
  const promo = l.auto_discount;
  const manual = l.line_discount;
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex w-full gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--ps-row)]">
        <span className={cn('num mt-px flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[var(--ps-r-sm)] px-1 text-[12px] font-bold', isReturn ? 'bg-[var(--ps-red)]/12 text-[var(--ps-red-text)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink)] group-hover:bg-[var(--ps-card)]')}>
          {qtyText(q)}
          {l.unit !== '' ? <span className="ml-0.5 font-semibold">{l.unit}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] font-semibold">
              {l.name}
              {l.variant_title !== '' && <span className="font-medium text-[var(--ps-ink-2)]"> &middot; {l.variant_title}</span>}
            </span>
            <span className={cn('num shrink-0 text-[13px] font-semibold', isReturn && 'text-[var(--ps-red-text)]')}>{money.fmt(l.gross)}</span>
          </span>
          {isReturn && <span className="block text-[12px] font-semibold text-[var(--ps-red-text)]">Return{source !== undefined && source.number !== '' ? ' from ' + source.number : ' without receipt'}{l.restock ? '' : ', not restocked'}</span>}
          {l.modifiers.length > 0 && <span className="block truncate text-[12px] text-[var(--ps-muted)]">{l.modifiers.map((m) => m.name).join(', ')}</span>}
          {l.kind === 'gift_card' && <span className="block text-[12px] text-[var(--ps-muted)]">{l.gift_code !== '' ? 'Card •••• ' + l.gift_code.slice(-4) : 'A new card number is made when paid'}</span>}
          {l.price_override !== null && <span className="block text-[12px] text-[var(--ps-amber-text)]">Price changed from {money.fmt(l.price_override.from)}{l.price_override.reason !== '' ? ': ' + l.price_override.reason : ''}</span>}
          {promo !== null && (
            <span className="flex justify-between gap-2 text-[12px] text-[var(--ps-green-text)]">
              <span className="truncate">{promo.name}</span>
              <span className="num shrink-0">{money.fmt(-promo.amount)}</span>
            </span>
          )}
          {manual !== null && (manual.amount ?? 0) > 0 && (
            <span className="flex justify-between gap-2 text-[12px] text-[var(--ps-green-text)]">
              <span className="truncate">
                {manual.kind === 'percent' ? manual.value + '% off' : 'Discount'}
                {manual.reason !== '' ? ': ' + manual.reason : ''}
              </span>
              <span className="num shrink-0">{money.fmt(-(manual.amount ?? 0))}</span>
            </span>
          )}
          {l.note !== '' && <span className="block truncate text-[12px] italic text-[var(--ps-ink-2)]">{l.note}</span>}
        </span>
      </button>
    </li>
  );
}

function Row({ label, value, strong = false, tone }: { label: React.ReactNode; value: string; strong?: boolean; tone?: 'green' | 'muted' }): React.JSX.Element {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', strong ? 'text-[14px] font-bold' : 'text-[12px]', tone === 'green' && 'text-[var(--ps-green-text)]', tone === 'muted' && 'text-[var(--ps-muted)]')}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="num shrink-0 font-semibold">{value}</span>
    </div>
  );
}

/** The open tickets on every register, to switch to one. */
function Tickets({ current, onNew }: { current: Order | null; onNew: () => void }): React.JSX.Element {
  const { money } = useStore();
  const ticket = useTicket();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const list = useLive(() => api.orders({ status: 'open', limit: 100 }), ['orders'], [], 300);
  const others = (list.data?.orders ?? []).filter((o) => current === null || o.id !== current.id);
  return (
    <div className="relative">
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Open tickets" className="relative inline-flex h-8 items-center gap-1.5 rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] px-2 text-[12px] font-semibold hover:bg-[var(--ps-row)]">
        <Layers size={14} className="text-[var(--ps-ink-2)]" />
        Tickets
        {others.length > 0 && <span className="num rounded-full bg-[var(--ps-accent)] px-1.5 text-[12px] font-bold leading-4 text-[var(--ps-on-accent)]">{others.length}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align="right" className="w-72 p-1">
        <button
          type="button"
          className={cn(menuItem, 'h-9 font-semibold')}
          onClick={() => {
            setOpen(false);
            onNew();
          }}
        >
          <Plus size={15} />
          New sale
        </button>
        <div className="my-1 border-t border-[var(--ps-hair)]" />
        {others.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-[var(--ps-muted)]">No other open tickets</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto">
            {others.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    ticket.open(o.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--ps-r-sm)] px-2 py-1.5 text-left hover:bg-[var(--ps-row)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{o.label !== '' ? o.label : o.customer !== null ? o.customer.name : 'Sale from ' + time(o.created)}</span>
                    <span className="block truncate text-[12px] text-[var(--ps-muted)]">
                      {qtyText(o.items)} items &middot; {o.staff !== '' ? o.staff + ' · ' : ''}
                      {time(o.updated)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold">{money.fmt(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </div>
  );
}

function Menu({ order, onAction }: { order: Order | null; onAction: (a: TicketAction) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const item = (a: TicketAction, icon: LucideIcon, label: string, disabled = false, danger = false): React.JSX.Element => {
    const Icon = icon;
    return (
      <button
        type="button"
        disabled={disabled}
        className={cn(menuItem, 'disabled:opacity-40', danger && 'text-[var(--ps-red-text)] [&>svg]:text-[var(--ps-red-text)]')}
        onClick={() => {
          setOpen(false);
          onAction(a);
        }}
      >
        <Icon size={15} />
        {label}
      </button>
    );
  };
  const has = order !== null && order.status === 'open' && order.lines.length > 0;
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-label="More for this sale" title="More for this sale" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex size-8 items-center justify-center rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]">
        <MoreHorizontal size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align="right" className="w-60">
        {item('name', PencilLine, 'Name and note', order === null)}
        {item('discount', BadgePercent, 'Discount on the sale', !has)}
        {item('tax', Receipt, order !== null && order.tax_exempt ? 'Charge tax again' : 'Remove tax', !has)}
        <div className="my-1 border-t border-[var(--ps-hair)]" />
        {item('return', RotateCcw, 'Return or exchange')}
        {item('gift_card', Gift, 'Sell a gift card')}
        {item('custom', CircleDollarSign, 'Custom amount')}
        <div className="my-1 border-t border-[var(--ps-hair)]" />
        {item('no_sale', Vault, 'Open the drawer')}
        {item('pay_in', Plus, 'Pay cash in')}
        {item('pay_out', CircleDollarSign, 'Pay cash out')}
        <div className="my-1 border-t border-[var(--ps-hair)]" />
        {item('clear', Ban, 'Clear this sale', order === null || order.status !== 'open', true)}
      </Popover>
    </div>
  );
}

export function TicketPanel({ onLine, onAction, onCharge, drawerClosed, onOpenDrawer, onBack }: { onLine: (l: OrderLine) => void; onAction: (a: TicketAction) => void; onCharge: () => void; drawerClosed: boolean; onOpenDrawer: () => void; onBack: () => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const { staff, register } = useSession();
  const { order, loading, busy, change } = useTicket();
  const live = order !== null && order.status === 'open' ? order : null;
  const lines = live?.lines ?? [];
  const due = live?.due ?? 0;
  const balance = live?.balance ?? 0;
  const paid = live?.paid_total ?? 0;
  const refund = balance < 0;
  const title = live === null ? 'New sale' : live.label !== '' ? live.label : live.has_returns && live.total <= 0 ? 'Return' : 'Sale';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--ps-card)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ps-line)] px-3 py-2.5">
        <IconButton icon={ArrowLeft} label="Back to products" onClick={onBack} className="md:hidden" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold leading-5">{title}</h2>
          <p className="truncate text-[12px] text-[var(--ps-muted)]">{live === null ? [register?.name, staff?.name].filter(Boolean).join(' · ') : qtyText(live.items) + (live.items === 1 ? ' item' : ' items') + (live.note !== '' ? ' · ' + live.note : '')}</p>
        </div>
        {busy && <Spinner size={14} className="text-[var(--ps-muted)]" />}
        <Tickets current={live} onNew={() => onAction('new')} />
        <Menu order={live} onAction={onAction} />
      </div>

      {live !== null && live.customer !== null ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ps-hair)] px-3 py-2">
          <button type="button" onClick={() => onAction('customer')} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <Avatar name={live.customer.name} size={28} color="accent" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{live.customer.name}</span>
              <span className="block truncate text-[12px] text-[var(--ps-muted)]">
                {settings?.loyalty_enabled ? live.customer.points + ' points' : live.customer.phone || live.customer.email}
                {live.customer.credit > 0 ? ' · ' + money.fmt(live.customer.credit) + ' credit' : ''}
                {live.customer.tax_exempt ? ' · Tax exempt' : ''}
              </span>
            </span>
          </button>
          <IconButton icon={X} label="Remove the customer from the sale" onClick={() => void change({ customer: '' })} />
        </div>
      ) : (
        <button type="button" onClick={() => onAction('customer')} className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--ps-hair)] px-3 text-[13px] font-semibold text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]">
          <UserPlus size={15} />
          Add a customer
          <ChevronRight size={14} className="ml-auto text-[var(--ps-muted)]" />
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner size={18} className="text-[var(--ps-muted)]" />
          </div>
        ) : lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center text-[var(--ps-muted)]">
            <ShoppingBag size={28} strokeWidth={1.5} />
            <p className="mt-2 text-[13px] font-semibold">No items yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {live !== null &&
              lines.map((l) => (
                <Line key={l.id} l={l} order={live} onOpen={() => onLine(l)} />
              ))}
          </ul>
        )}
      </div>

      {live !== null && lines.length > 0 && (
        <div className="shrink-0 space-y-1 border-t border-[var(--ps-line)] px-3 py-2.5">
          <Row label="Subtotal" value={money.fmt(live.subtotal)} />
          {live.discount_total !== 0 && <Row label={live.applied_discount !== null ? live.applied_discount.name : 'Discounts'} value={money.fmt(-live.discount_total)} tone="green" />}
          {live.taxes.map((t) => (
            <Row key={t.id + t.rate} label={t.name + ' ' + t.rate + '%' + (settings?.prices_include_tax ? ' (included)' : '')} value={money.fmt(t.tax)} tone="muted" />
          ))}
          {live.tax_exempt && <Row label="Tax removed" value={money.fmt(0)} tone="muted" />}
          {live.tip !== 0 && <Row label="Tip" value={money.fmt(live.tip)} />}
          {live.rounding !== 0 && <Row label="Cash rounding" value={money.fmt(live.rounding)} tone="muted" />}
          {paid !== 0 && <Row label="Paid so far" value={money.fmt(-paid)} tone="muted" />}
        </div>
      )}

      <div className="shrink-0 p-3 pt-0">
        {drawerClosed && (
          <button type="button" onClick={onOpenDrawer} className="mb-2 flex w-full items-center gap-2 rounded-[var(--ps-r-md)] bg-[var(--ps-amber)]/20 px-3 py-2 text-left text-[12px] font-semibold text-[var(--ps-amber-text)] hover:bg-[var(--ps-amber)]/30">
            <Vault size={15} className="shrink-0" />
            <span className="flex-1">The drawer is closed. Open it to take payments.</span>
            <ChevronRight size={14} />
          </button>
        )}
        <button
          type="button"
          disabled={live === null || lines.length === 0 || busy}
          onClick={onCharge}
          className="ps-on-dark flex h-16 w-full items-center justify-between rounded-[var(--ps-r-md)] bg-[var(--ps-dark)] px-4 text-[var(--ps-on-dark)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="text-left">
            <span className="block text-[15px] font-bold">{live === null || lines.length === 0 ? 'Charge' : balance === 0 ? 'Complete' : refund ? 'Refund' : paid !== 0 ? 'Pay the rest' : 'Charge'}</span>
            {live !== null && paid !== 0 && <span className="block text-[12px] text-[var(--ps-on-dark-muted)]">of {money.fmt(due)}</span>}
          </span>
          <span className="num text-[26px] font-bold tracking-tight">{money.fmt(Math.abs(balance))}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The order forms, plus the small pieces the order and customer panels share.
 *
 *   AddOrderDialog   an order by hand (Direct by default), items from your
 *                    catalog or typed in
 *   ShipDialog       mark one order shipped (or add its tracking), or many
 *                    at once with one row per order
 *   RefundDialog, ReturnDialog, CancelDialog, LinkSkuDialog
 *   InlineInput      a field that looks like text and saves when you leave it
 *   ButtonMenu       a pill button that opens a menu
 *   Stepper, Thumb, SkuSearch
 *
 * The seller's own refund, return and cancel run at once; only your AI
 * agent's calls of those become proposals.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Minus, Package, Plus, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, useDebounce } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { currencySign, money, plural } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { useBase, useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { OrderDetail, OrderLine, OrderStatus, Payment, ProductDetail, ProductList, ProductRow, Variant } from '../lib/types.ts';
import { Button, buttonClass, Dialog, Field, IconButton, Segmented, Select, TextArea, TextInput, Toggle } from './ui.tsx';
import type { ButtonSize, ButtonVariant, MenuItem } from './ui.tsx';

/* ---------------------------------------------------------------- shared */

/** Everything an order write can touch, so this tab reloads it at once. */
export const ORDER_WRITES: Collection[] = ['orders', 'order_lines', 'shipments', 'customers', 'variants', 'stock_moves', 'activity', 'tasks'];

export function orderChanged(): void {
  changed(...ORDER_WRITES);
}

export const PAYMENT_LABEL: Record<Payment, string> = { paid: 'Paid', pending: 'Pending', cod: 'Cash on delivery', refunded: 'Refunded', partial_refund: 'Part refunded' };

/** A typed amount: null when blank, NaN when it is not a number. */
export function parseAmount(s: string): number | null {
  const t = s.trim().split(',').join('');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A product picture, or a package icon when there is none. */
export function Thumb({ image, size = 40, onTile = false, className }: { image: string; size?: number; onTile?: boolean; className?: string }): React.JSX.Element {
  return (
    <span style={{ width: size, height: size }} className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-[10px]', onTile ? 'bg-[var(--so-card)]' : 'bg-[var(--so-tile)]', className)}>
      {image !== '' ? <img src={image} alt="" className="size-full object-cover" /> : <Package size={Math.round(size * 0.45)} strokeWidth={1.8} className="text-[var(--so-faint)]" aria-hidden />}
    </span>
  );
}

/** A quantity with minus and plus. `onTile` when it sits on a grey tile. */
export function Stepper({ value, min, max, onChange, label, onTile = false }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; onTile?: boolean }): React.JSX.Element {
  const btn = cn('hit flex size-8 items-center justify-center rounded-full text-[var(--so-ink)] disabled:cursor-not-allowed disabled:opacity-40', onTile ? 'hover:bg-[var(--so-row-hover)]' : 'hover:bg-[var(--so-tile-hover)]');
  return (
    <span className={cn('inline-flex h-10 shrink-0 items-center rounded-full p-1', onTile ? 'bg-[var(--so-card)]' : 'bg-[var(--so-tile)]')}>
      <button type="button" aria-label={'Fewer ' + label} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>
        <Minus size={14} strokeWidth={2.2} aria-hidden />
      </button>
      <span className="num w-8 text-center text-[14px] font-semibold">{value}</span>
      <button type="button" aria-label={'More ' + label} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>
        <Plus size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </span>
  );
}

/**
 * A field that reads like text and saves when you leave it (Enter saves,
 * Escape puts the old value back). A refused save puts the old value back.
 */
export function InlineInput({
  value,
  onSave,
  label,
  placeholder,
  prefix,
  className,
  inputMode,
  type = 'text',
  align = 'left',
  strong = false,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown>;
  label: string;
  placeholder?: string | undefined;
  prefix?: string | undefined;
  className?: string | undefined;
  inputMode?: 'text' | 'decimal' | 'email' | 'tel' | undefined;
  type?: 'text' | 'email' | 'tel';
  align?: 'left' | 'right';
  strong?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focus, setFocus] = useState(false);
  const skip = useRef(false);
  useEffect(() => {
    if (!focus) setDraft(value);
  }, [value, focus]);
  const commit = async (): Promise<void> => {
    setFocus(false);
    if (skip.current) {
      skip.current = false;
      setDraft(value);
      return;
    }
    const v = draft.trim();
    if (v === value.trim()) {
      setDraft(value);
      return;
    }
    try {
      await onSave(v);
    } catch {
      setDraft(value);
    }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // Only this field: the panel around it stays open.
      e.stopPropagation();
      skip.current = true;
      e.currentTarget.blur();
    }
  };
  return (
    <span className={cn('flex h-8 min-w-0 items-center rounded-[10px] px-2 ring-[var(--so-ink)] transition-colors hover:bg-[var(--so-row-hover)] focus-within:bg-[var(--so-tile)] focus-within:ring-2', className)}>
      {prefix !== undefined && prefix !== '' && <span className="pr-1 text-[13px] font-semibold text-[var(--so-muted)]">{prefix}</span>}
      <input
        type={type}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        onFocus={() => setFocus(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey}
        className={cn('h-full w-full min-w-0 bg-transparent text-[14px] text-[var(--so-ink)] outline-none', align === 'right' && 'num text-right', strong && 'font-semibold')}
      />
    </span>
  );
}

/** A pill button with a label that opens a small menu under it. */
export function ButtonMenu({ label, icon, items, variant = 'secondary', size = 'md' }: { label: string; icon?: LucideIcon; items: MenuItem[]; variant?: ButtonVariant; size?: ButtonSize }): React.JSX.Element {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean; right: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (pos === null) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos, close]);
  const Icon = icon;
  const s = size === 'md' ? 16 : 14;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={(e) => {
          e.stopPropagation();
          const r = btn.current?.getBoundingClientRect();
          if (!r) return;
          const up = r.bottom + 40 * items.length + 16 > window.innerHeight;
          const right = r.left + 240 > window.innerWidth;
          setPos({ x: right ? r.right : r.left, y: up ? r.top - 6 : r.bottom + 6, up, right });
        }}
        className={buttonClass(variant, size)}
      >
        {Icon !== undefined && <Icon size={s} strokeWidth={2} aria-hidden />}
        {label}
        <ChevronDown size={s} strokeWidth={2} aria-hidden />
      </button>
      {pos !== null &&
        createPortal(
          <div className="so-portal fixed inset-0 z-[70]" onMouseDown={close}>
            <div
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
              className="so-drop absolute min-w-[220px] rounded-[16px] bg-[var(--so-card)] p-1 text-[var(--so-ink)] shadow-[0_18px_50px_-12px_var(--so-shadow)] ring-1 ring-[var(--so-border)]"
              style={{
                left: pos.right ? undefined : pos.x,
                right: pos.right ? window.innerWidth - pos.x : undefined,
                top: pos.up ? undefined : pos.y,
                bottom: pos.up ? window.innerHeight - pos.y : undefined,
              }}
            >
              {items.map((it) => {
                const I = it.icon;
                return (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      close();
                      it.onSelect();
                    }}
                    className={cn('flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40', it.danger ? 'text-[var(--so-red-text)] hover:bg-[var(--so-red-soft)]' : 'hover:bg-[var(--so-tile)]')}
                  >
                    {I !== undefined && <I size={15} strokeWidth={2} aria-hidden />}
                    {it.label}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** The bold label over a group of fields that are not one input (so no <label>). */
function GroupLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }): React.JSX.Element {
  return (
    <p className="mb-2 flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--so-ink-2)]">
      <span>{children}</span>
      {hint !== undefined && <span className="font-medium text-[var(--so-muted)]">{hint}</span>}
    </p>
  );
}

function FormError({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="mt-2 text-[12px] font-medium text-[var(--so-red-text)]">{children}</p>;
}

/* -------------------------------------------------------------- carriers */

const CARRIERS = ['J&T Express', 'Ninja Van', 'Pos Laju', 'DHL eCommerce', 'Shopee Express', 'Lazada Logistics', 'Flash Express', 'GDEX', 'Yamato', 'Sagawa', 'Japan Post', 'USPS', 'UPS', 'FedEx', 'Royal Mail'];

const LOCAL_CARRIERS: Record<string, string[]> = {
  MY: ['J&T Express', 'Ninja Van', 'Pos Laju', 'Shopee Express', 'Lazada Logistics', 'DHL eCommerce', 'Flash Express', 'GDEX'],
  SG: ['Ninja Van', 'J&T Express', 'Shopee Express', 'Lazada Logistics', 'DHL eCommerce'],
  TH: ['Flash Express', 'J&T Express', 'Ninja Van', 'Shopee Express', 'Lazada Logistics', 'DHL eCommerce'],
  PH: ['J&T Express', 'Ninja Van', 'Flash Express', 'Shopee Express', 'Lazada Logistics'],
  ID: ['J&T Express', 'Ninja Van', 'Shopee Express', 'Lazada Logistics'],
  VN: ['J&T Express', 'Ninja Van', 'Shopee Express', 'Lazada Logistics'],
  JP: ['Yamato', 'Sagawa', 'Japan Post'],
  US: ['USPS', 'UPS', 'FedEx', 'DHL eCommerce'],
  GB: ['Royal Mail', 'DHL eCommerce', 'UPS', 'FedEx'],
};

/** Carriers for a country first, then the rest. */
export function carriersFor(country: string): string[] {
  const first = LOCAL_CARRIERS[country.toUpperCase()] ?? [];
  return [...first, ...CARRIERS.filter((c) => !first.includes(c))];
}

function lastCarrier(): string {
  try {
    return window.localStorage.getItem('so-carrier') ?? '';
  } catch {
    return '';
  }
}

function rememberCarrier(c: string): void {
  if (c === '') return;
  try {
    window.localStorage.setItem('so-carrier', c);
  } catch {
    /* a convenience only */
  }
}

/* ------------------------------------------------------------ ship dialog */

export interface ShipTarget {
  id: string;
  number: string;
  buyer: string;
  /** The shop id (its region picks the carriers shown first). */
  shop: string;
  status: OrderStatus;
}

/** Mark one order shipped (or add tracking to a shipped one), or many at once. */
export function ShipDialog({ open, onClose, orders, onDone }: { open: boolean; onClose: () => void; orders: ShipTarget[]; onDone?: () => void }): React.JSX.Element | null {
  if (!open || orders.length === 0) return null;
  return <ShipForm onClose={onClose} orders={orders} onDone={onDone} />;
}

function ShipForm({ onClose, orders, onDone }: { onClose: () => void; orders: ShipTarget[]; onDone: (() => void) | undefined }): React.JSX.Element {
  const { settings, shop } = useStore();
  const listId = useId();
  const formId = useId();
  const first = orders[0];
  const country = (first !== undefined ? shop(first.shop)?.region : '') || settings?.country || '';
  const [rows, setRows] = useState(() => {
    const c = lastCarrier();
    return orders.map((o) => ({ order: o, carrier: c, tracking: '' }));
  });
  const [all, setAll] = useState(() => lastCarrier());
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const single = rows.length === 1;
  const addingTracking = single && first?.status === 'shipped';
  const setRow = (i: number, patch: { carrier?: string; tracking?: string }): void => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const one = rows[0];
      if (single && one !== undefined) {
        await op('orders.ship', { order: one.order.id, carrier: one.carrier.trim() || undefined, tracking: one.tracking.trim() || undefined, url: url.trim() || undefined });
        rememberCarrier(one.carrier.trim());
        notify.info(addingTracking ? 'Tracking saved' : 'Order ' + one.order.number + ' shipped');
      } else {
        const res = await op<{ shipped: number; problems: string[] }>('orders.ship-many', { items: rows.map((r) => ({ order: r.order.id, carrier: r.carrier.trim(), tracking: r.tracking.trim() })) });
        rememberCarrier(rows.find((r) => r.carrier.trim() !== '')?.carrier.trim() ?? '');
        if (res.shipped > 0) notify.info(plural(res.shipped, 'order') + ' shipped');
        const problem = res.problems[0];
        if (problem !== undefined) notify.error(res.problems.length === 1 ? problem : problem + ' (and ' + (res.problems.length - 1) + ' more)');
      }
      orderChanged();
      onDone?.();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={single ? 480 : 680}
      title={addingTracking ? 'Add tracking' : single ? 'Mark order ' + (first?.number ?? '') + ' shipped' : 'Mark ' + plural(rows.length, 'order') + ' shipped'}
      subtitle={addingTracking ? 'The buyer can follow the parcel with it.' : 'The items leave your stock. Tracking is optional.'}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {addingTracking ? 'Save tracking' : 'Mark shipped'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <datalist id={listId}>
          {carriersFor(country).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {single ? (
          <div className="grid gap-4">
            <Field label="Carrier">
              <TextInput list={listId} value={rows[0]?.carrier ?? ''} onChange={(e) => setRow(0, { carrier: e.target.value })} placeholder={carriersFor(country)[0]} autoComplete="off" autoFocus />
            </Field>
            <Field label="Tracking number">
              <TextInput value={rows[0]?.tracking ?? ''} onChange={(e) => setRow(0, { tracking: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Tracking link" hint="Optional">
              <TextInput type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4">
            <Field label="Carrier for all">
              <TextInput
                list={listId}
                value={all}
                autoComplete="off"
                placeholder={carriersFor(country)[0]}
                onChange={(e) => {
                  const v = e.target.value;
                  setAll(v);
                  setRows((rs) => rs.map((r) => ({ ...r, carrier: v })));
                }}
              />
            </Field>
            <div>
              <GroupLabel hint="Tracking is optional">Each order</GroupLabel>
              <div className="divide-y divide-[var(--so-line)]">
                {rows.map((r, i) => (
                  <div key={r.order.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_168px_184px] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold">{r.order.number}</p>
                      <p className="truncate text-[12px] text-[var(--so-muted)]">{r.order.buyer || 'No buyer name'}</p>
                    </div>
                    <TextInput aria-label={'Carrier for order ' + r.order.number} list={listId} value={r.carrier} onChange={(e) => setRow(i, { carrier: e.target.value })} placeholder="Carrier" autoComplete="off" />
                    <TextInput aria-label={'Tracking number for order ' + r.order.number} value={r.tracking} onChange={(e) => setRow(i, { tracking: e.target.value })} placeholder="Tracking number" autoComplete="off" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------- refund dialog */

export interface RefundTarget {
  id: string;
  number: string;
  currency: string;
  total: number;
  refunded: number;
}

export function RefundDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: RefundTarget | null }): React.JSX.Element | null {
  if (!open || order === null) return null;
  return <RefundForm onClose={onClose} order={order} />;
}

function RefundForm({ onClose, order }: { onClose: () => void; order: RefundTarget }): React.JSX.Element {
  const formId = useId();
  const max = Math.max(0, Math.round((order.total - order.refunded) * 100) / 100);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const n = parseAmount(amount);
  const error = n === null ? 'Enter the amount refunded' : Number.isNaN(n) ? 'Enter a number, like 25.50' : n <= 0 ? 'The amount must be more than 0' : n > max + 1e-9 ? 'At most ' + money(max, order.currency) + ' can still be refunded' : '';
  const submit = async (): Promise<void> => {
    setTried(true);
    if (error !== '' || n === null) return;
    setBusy(true);
    try {
      await op('orders.refund', { order: order.id, amount: n, reason: reason.trim() || undefined });
      notify.info('Refund recorded');
      orderChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={'Record a refund on order ' + order.number}
      subtitle="The money itself goes back on the shop."
      width={460}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy} disabled={max <= 0}>
            Record refund
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <GroupLabel
            hint={
              <button type="button" className="hit rounded-full px-2 text-[12px] font-semibold text-[var(--so-ink)] hover:bg-[var(--so-row-hover)]" onClick={() => setAmount(String(max))}>
                Up to {money(max, order.currency)}
              </button>
            }
          >
            Amount
          </GroupLabel>
          <TextInput aria-label="Amount refunded" prefix={currencySign(order.currency)} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus autoComplete="off" />
          {tried && error !== '' && <FormError>{error}</FormError>}
        </div>
        <Field label="Reason" hint="Optional">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Item arrived damaged" autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------- return dialog */

export function ReturnDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: { id: string; number: string; lines: OrderLine[] } | null }): React.JSX.Element | null {
  if (!open || order === null) return null;
  return <ReturnForm onClose={onClose} order={order} />;
}

function ReturnForm({ onClose, order }: { onClose: () => void; order: { id: string; number: string; lines: OrderLine[] } }): React.JSX.Element {
  const formId = useId();
  const open = order.lines.filter((l) => l.qty - l.qty_returned > 0);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(open.map((l) => [l.id, l.qty - l.qty_returned])));
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const units = open.reduce((n, l) => n + (qty[l.id] ?? 0), 0);
  const submit = async (): Promise<void> => {
    if (units <= 0) return;
    setBusy(true);
    try {
      await op('orders.return', { order: order.id, lines: open.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ line: l.id, qty: qty[l.id] ?? 0 })), restock });
      notify.info(plural(units, 'item') + ' returned');
      orderChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={'Record a return on order ' + order.number}
      subtitle="What came back from the buyer."
      width={560}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy} disabled={units <= 0}>
            {units > 0 ? 'Record ' + plural(units, 'item') : 'Record return'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {open.length === 0 ? (
          <p className="py-4 text-[13px] text-[var(--so-muted)]">Everything on this order has already come back.</p>
        ) : (
          <div className="divide-y divide-[var(--so-line)]">
            {open.map((l) => {
              const left = l.qty - l.qty_returned;
              return (
                <div key={l.id} className="flex items-center gap-3 py-3">
                  <Thumb image={l.image} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{l.title}</p>
                    <p className="truncate text-[12px] text-[var(--so-muted)]">{[l.option, l.sku, left < l.qty ? l.qty_returned + ' back already' : ''].filter((x) => x !== '').join(' · ') || 'Qty ' + l.qty}</p>
                  </div>
                  <Stepper value={qty[l.id] ?? 0} min={0} max={left} label={l.title} onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))} />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-[var(--so-tile)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">Put back in stock</p>
            <p className="text-[12px] text-[var(--so-muted)]">Off when the items cannot be sold again.</p>
          </div>
          <Toggle checked={restock} onChange={setRestock} label="Put back in stock" />
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------- cancel dialog */

const CANCEL_REASONS = ['Buyer asked', 'Out of stock', 'Not paid', 'Duplicate order'];

export function CancelDialog({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: { id: string; number: string } | null; onDone?: () => void }): React.JSX.Element | null {
  if (!open || order === null) return null;
  return <CancelForm onClose={onClose} order={order} onDone={onDone} />;
}

function CancelForm({ onClose, order, onDone }: { onClose: () => void; order: { id: string; number: string }; onDone: (() => void) | undefined }): React.JSX.Element {
  const formId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('orders.cancel', { order: order.id, reason: reason.trim() || undefined });
      notify.info('Order ' + order.number + ' cancelled');
      orderChanged();
      onDone?.();
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={'Cancel order ' + order.number + '?'}
      subtitle="Its items go back to available. Cancel it on the shop too."
      width={460}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Keep order
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={busy}>
            Cancel order
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <GroupLabel hint="Optional">Reason</GroupLabel>
        <div className="mb-3 flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(reason === r ? '' : r)}
              className={cn('so-press h-8 rounded-full px-3 text-[13px] font-semibold', reason === r ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-tile)] text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)]')}
            >
              {r}
            </button>
          ))}
        </div>
        <TextInput aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write a reason" autoComplete="off" />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------- SKU search */

export interface SkuPick {
  variant: string;
  sku: string;
  title: string;
  option: string;
  /** Selling price in the base currency. */
  price: number;
  image: string;
}

type SearchOption = { kind: 'pick'; pick: SkuPick; key: string } | { kind: 'expand'; product: ProductRow; key: string } | { kind: 'free'; key: string };

/**
 * Search your catalog by title or SKU. A product with one SKU is picked at
 * once; one with several opens its SKUs. Arrow keys move, Enter picks.
 * `browse` lists products before anything is typed; `onFreeText` offers
 * the typed words as an item of their own.
 */
export function SkuSearch({ onPick, onFreeText, browse = false, placeholder = 'Search title or SKU', autoFocus = false }: { onPick: (p: SkuPick) => void; onFreeText?: (title: string) => void; browse?: boolean; placeholder?: string; autoFocus?: boolean }): React.JSX.Element {
  const base = useBase();
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 200);
  const [found, setFound] = useState<ProductRow[] | null>(null);
  const [open, setOpen] = useState('');
  const [variants, setVariants] = useState<Record<string, Variant[]>>({});
  const [active, setActive] = useState(0);
  const term = dq.trim();

  useEffect(() => {
    if (!browse && term === '') {
      setFound(null);
      return;
    }
    const c = new AbortController();
    op<ProductList>('products.list', { q: term === '' ? undefined : term, limit: 8 }, { quiet: true, signal: c.signal })
      .then((r) => {
        setFound(r.products);
        setActive(0);
      })
      .catch(() => undefined);
    return () => c.abort();
  }, [term, browse]);

  const expand = (p: ProductRow): void => {
    if (open === p.id) {
      setOpen('');
      return;
    }
    setOpen(p.id);
    if (variants[p.id] !== undefined) return;
    op<{ product: ProductDetail }>('products.get', { product: p.id }, { quiet: true })
      .then((r) => setVariants((m) => ({ ...m, [p.id]: r.product.variants })))
      .catch(() => setOpen(''));
  };

  const pickOf = (p: ProductRow): SkuPick => ({ variant: '', sku: p.skus[0] ?? '', title: p.title, option: '', price: p.price_min, image: p.image });

  const options: SearchOption[] = [];
  for (const p of found ?? []) {
    if (p.variants <= 1) {
      if ((p.skus[0] ?? '') !== '') options.push({ kind: 'pick', pick: pickOf(p), key: p.id });
      continue;
    }
    options.push({ kind: 'expand', product: p, key: p.id });
    if (open === p.id) for (const v of variants[p.id] ?? []) options.push({ kind: 'pick', key: p.id + ':' + v.id, pick: { variant: v.id, sku: v.sku, title: p.title, option: v.option, price: v.price, image: p.image } });
  }
  const typed = q.trim();
  if (onFreeText !== undefined && typed !== '') options.push({ kind: 'free', key: 'free' });

  const choose = (o: SearchOption): void => {
    if (o.kind === 'expand') {
      expand(o.product);
      return;
    }
    if (o.kind === 'free') onFreeText?.(typed);
    else onPick(o.pick);
    setQ('');
    setOpen('');
  };

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o !== undefined) choose(o);
    } else if (e.key === 'Escape' && q !== '') {
      // The first Escape clears the search; the next one closes the dialog.
      e.stopPropagation();
      setQ('');
    }
  };

  const showList = found !== null && (browse || typed !== '');
  return (
    <div>
      <span className="flex h-10 min-w-0 items-center gap-2 rounded-full bg-[var(--so-tile)] px-4 ring-[var(--so-ink)] focus-within:ring-2">
        <Search size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-[var(--so-ink)] outline-none"
        />
        {q !== '' && (
          <button type="button" aria-label="Clear" onClick={() => setQ('')} className="hit rounded-full p-1 text-[var(--so-muted)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
            <X size={14} aria-hidden />
          </button>
        )}
      </span>
      {(showList || (onFreeText !== undefined && typed !== '')) && (
        <div role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-[14px] p-1 shadow-[inset_0_0_0_1px_var(--so-border)]">
          {showList && options.filter((o) => o.kind !== 'free').length === 0 && <p className="px-3 py-2 text-[13px] text-[var(--so-muted)]">{typed === '' ? 'No products yet' : 'No product matches "' + typed + '"'}</p>}
          {options.map((o, i) => {
            const on = i === active;
            const row = cn('flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--so-row-hover)]', on && 'bg-[var(--so-row-hover)]');
            if (o.kind === 'free') {
              return (
                <button key={o.key} type="button" role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className={row}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--so-tile)]">
                    <Plus size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Add &quot;{typed}&quot; as an item</span>
                </button>
              );
            }
            if (o.kind === 'expand') {
              const p = o.product;
              const Chev = open === p.id ? ChevronDown : ChevronRight;
              return (
                <button key={o.key} type="button" role="option" aria-selected={on} aria-expanded={open === p.id} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className={row}>
                  <Thumb image={p.image} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{p.title}</span>
                    <span className="block truncate text-[12px] text-[var(--so-muted)]">{plural(p.variants, 'SKU')}</span>
                  </span>
                  <span className="num shrink-0 text-[13px] text-[var(--so-ink-2)]">{p.price_min === p.price_max ? money(p.price_min, base) : money(p.price_min, base) + ' to ' + money(p.price_max, base)}</span>
                  <Chev size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
                </button>
              );
            }
            const k = o.pick;
            const nested = k.variant !== '';
            return (
              <button key={o.key} type="button" role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className={cn(row, nested && 'pl-12')}>
                {!nested && <Thumb image={k.image} size={32} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{nested ? k.option || k.sku : k.title}</span>
                  <span className="block truncate text-[12px] text-[var(--so-muted)]">{k.sku}</span>
                </span>
                <span className="num shrink-0 text-[13px] text-[var(--so-ink-2)]">{money(k.price, base)}</span>
              </button>
            );
          })}
          {open !== '' && variants[open] === undefined && <p className="px-3 py-2 pl-12 text-[12px] text-[var(--so-muted)]">Loading SKUs</p>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- link SKU dialog */

export function LinkSkuDialog({ open, onClose, line }: { open: boolean; onClose: () => void; line: OrderLine | null }): React.JSX.Element | null {
  if (!open || line === null) return null;
  return <LinkSkuForm onClose={onClose} line={line} />;
}

function LinkSkuForm({ onClose, line }: { onClose: () => void; line: OrderLine }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const link = async (p: SkuPick): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await op('orders.link-line', { line: line.id, variant: p.variant !== '' ? p.variant : p.sku });
      notify.info('Linked to ' + p.sku);
      orderChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Link to your SKU" subtitle="Other orders with the same SKU are linked too." width={520}>
      <div className="mb-4 flex items-center gap-3 rounded-[14px] bg-[var(--so-tile)] p-3">
        <Thumb image={line.image} size={40} onTile />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{line.title}</p>
          <p className="truncate text-[12px] text-[var(--so-muted)]">{line.sku !== '' ? 'SKU ' + line.sku + ' on the shop' : 'No SKU on the shop'}</p>
        </div>
      </div>
      <SkuSearch browse autoFocus onPick={(p) => void link(p)} placeholder="Search your products" />
      <div className="pb-2" />
    </Dialog>
  );
}

/* ---------------------------------------------------------- not a product */

/**
 * "Not a product" on an order line (gift wrap, a gift card, a fee): a small
 * popover asks what it costs you, in the base currency. It then moves no
 * stock, stops counting as an unknown SKU, and later orders with the same
 * SKU (or title) are known too.
 */
export function NotProductButton({ line }: { line: OrderLine }): React.JSX.Element {
  const base = useBase();
  const formId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean; right: boolean } | null>(null);
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (pos === null) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Only the popover closes; the panel under it stays.
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
    };
  }, [pos, close]);
  const n = parseAmount(cost);
  const bad = n !== null && (Number.isNaN(n) || n < 0);
  const save = async (): Promise<void> => {
    if (bad) return;
    setBusy(true);
    try {
      await op('orders.line-extra', { line: line.id, cost: n ?? 0 });
      notify.info((line.sku || line.title) + ' is not a product');
      orderChanged();
      close();
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={pos !== null}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (!r) return;
          const up = r.bottom + 240 > window.innerHeight;
          const right = r.left + 296 > window.innerWidth;
          setCost('');
          setPos({ x: right ? r.right : r.left, y: up ? r.top - 8 : r.bottom + 8, up, right });
        }}
        className={buttonClass('secondary', 'sm')}
      >
        Not a product
      </button>
      {pos !== null &&
        createPortal(
          <div className="so-portal fixed inset-0 z-[70]" onMouseDown={close}>
            <div
              role="dialog"
              aria-label="Not a product"
              onMouseDown={(e) => e.stopPropagation()}
              className="so-drop absolute w-[288px] max-w-[calc(100vw-16px)] rounded-[16px] bg-[var(--so-card)] p-4 text-[var(--so-ink)] shadow-[0_18px_50px_-12px_var(--so-shadow)] ring-1 ring-[var(--so-border)]"
              style={{
                left: pos.right ? undefined : pos.x,
                right: pos.right ? window.innerWidth - pos.x : undefined,
                top: pos.up ? undefined : pos.y,
                bottom: pos.up ? window.innerHeight - pos.y : undefined,
              }}
            >
              <p className="text-[13px] font-semibold">Not a product</p>
              <p className="mt-1 text-[12px] leading-[18px] text-[var(--so-muted)]">Like gift wrap or a fee: no stock moves. Later orders with it are known too.</p>
              <form
                id={formId}
                className="mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <GroupLabel>Your cost, each</GroupLabel>
                <TextInput aria-label="Your cost, each" prefix={currencySign(base)} inputMode="decimal" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} autoFocus autoComplete="off" />
                {bad && <FormError>Enter a number, like 2.50</FormError>}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="tile" size="sm" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" loading={busy} disabled={bad}>
                    Save
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* -------------------------------------------------------- add order dialog */

interface DraftLine {
  key: number;
  sku: string;
  title: string;
  option: string;
  image: string;
  qty: number;
  price: string;
}

/**
 * An order by hand: a sale from chat, social or in person (Direct), or one
 * typed in from any shop. Opens the new order when added unless `onAdded`
 * says otherwise.
 */
export function AddOrderDialog({ open, onClose, shopId, onAdded }: { open: boolean; onClose: () => void; shopId?: string; onAdded?: (id: string, status: 'to_ship' | 'unpaid') => void }): React.JSX.Element | null {
  if (!open) return null;
  return <AddOrderForm onClose={onClose} shopId={shopId} onAdded={onAdded} />;
}

function AddOrderForm({ onClose, shopId, onAdded }: { onClose: () => void; shopId: string | undefined; onAdded: ((id: string, status: 'to_ship' | 'unpaid') => void) | undefined }): React.JSX.Element {
  const { shops } = useStore();
  const base = useBase();
  const formId = useId();
  const seq = useRef(0);
  const [shopSel, setShopSel] = useState(() => shopId ?? shops.find((s) => s.platform === 'direct')?.id ?? shops[0]?.id ?? '');
  const shop = shops.find((s) => s.id === shopSel);
  const cur = shop?.currency || base;
  const sign = currencySign(cur);
  const [number, setNumber] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [buyer, setBuyer] = useState({ name: '', phone: '', email: '', address: '' });
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');
  const [payment, setPayment] = useState<'paid' | 'pending' | 'cod'>('paid');
  const [status, setStatus] = useState<'to_ship' | 'unpaid'>('to_ship');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const add = (l: Omit<DraftLine, 'key'>): void => {
    setLines((ls) => {
      const same = l.sku !== '' ? ls.find((x) => x.sku === l.sku) : undefined;
      if (same !== undefined) return ls.map((x) => (x.key === same.key ? { ...x, qty: x.qty + 1 } : x));
      seq.current += 1;
      return [...ls, { ...l, key: seq.current }];
    });
  };
  const setLine = (key: number, patch: Partial<Omit<DraftLine, 'key'>>): void => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const prices = lines.map((l) => parseAmount(l.price));
  const ship = parseAmount(shipping);
  const disc = parseAmount(discount);
  const items = lines.reduce((n, l, i) => n + l.qty * (Number.isNaN(prices[i] ?? 0) ? 0 : (prices[i] ?? 0)), 0);
  const total = items - (disc !== null && !Number.isNaN(disc) ? disc : 0) + (ship !== null && !Number.isNaN(ship) ? ship : 0);
  const badPrice = prices.some((p) => p !== null && (Number.isNaN(p) || p < 0));
  const error =
    lines.length === 0
      ? 'Add at least one item'
      : lines.some((l) => l.title.trim() === '')
        ? 'Every item needs a name'
        : badPrice
          ? 'Prices must be numbers, like 29.90'
          : (ship !== null && (Number.isNaN(ship) || ship < 0)) || (disc !== null && (Number.isNaN(disc) || disc < 0))
            ? 'Shipping and discount must be numbers'
            : '';

  const submit = async (): Promise<void> => {
    setTried(true);
    if (error !== '') return;
    setBusy(true);
    try {
      const res = await op<{ order: OrderDetail; unlinked: string[] }>('orders.add', {
        shop: shopSel === '' ? undefined : shopSel,
        number: number.trim() || undefined,
        lines: lines.map((l, i) => {
          const price = prices[i] ?? null;
          return l.sku !== '' ? { sku: l.sku, qty: l.qty, ...(price !== null ? { price } : {}) } : { title: l.title.trim(), qty: l.qty, price: price ?? 0 };
        }),
        buyer_name: buyer.name.trim() || undefined,
        buyer_phone: buyer.phone.trim() || undefined,
        buyer_email: buyer.email.trim() || undefined,
        address: buyer.address.trim() || undefined,
        shipping: ship ?? undefined,
        discount: disc ?? undefined,
        payment,
        status,
        note: note.trim() || undefined,
      });
      notify.info('Order ' + res.order.number + ' added');
      orderChanged();
      onClose();
      if (onAdded !== undefined) onAdded(res.order.id, status);
      else go('orders', status, res.order.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add order"
      subtitle="A sale from chat, social or in person, or one from any shop."
      width={680}
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-[var(--so-muted)]">
            Total <span className="num ml-1 text-[15px] font-semibold text-[var(--so-ink)]">{money(total, cur)}</span>
          </span>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            Add order
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shop">
            <Select value={shopSel} onChange={(e) => setShopSel(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order number" hint="Optional">
            <TextInput value={number} onChange={(e) => setNumber(e.target.value)} placeholder={shop === undefined || shop.platform === 'direct' ? 'Numbered for you' : 'As on ' + shop.name} autoComplete="off" />
          </Field>
        </div>

        <div>
          <GroupLabel hint={lines.length > 0 ? plural(lines.reduce((n, l) => n + l.qty, 0), 'unit') : undefined}>Items</GroupLabel>
          {lines.length > 0 && (
            <div className="mb-2 grid gap-2">
              {lines.map((l) => (
                <div key={l.key} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[var(--so-tile)] p-2 sm:flex-nowrap">
                  <Thumb image={l.image} size={36} onTile />
                  <div className="min-w-0 flex-1 basis-40">
                    {l.sku !== '' ? (
                      <>
                        <p className="truncate text-[13px] font-semibold">{l.title}</p>
                        <p className="truncate text-[12px] text-[var(--so-muted)]">{[l.option, l.sku].filter((x) => x !== '').join(' · ')}</p>
                      </>
                    ) : (
                      <input aria-label="Item name" value={l.title} onChange={(e) => setLine(l.key, { title: e.target.value })} className="h-8 w-full rounded-[8px] bg-transparent px-1 text-[13px] font-semibold text-[var(--so-ink)] outline-none ring-[var(--so-ink)] focus-visible:ring-2" />
                    )}
                  </div>
                  <Stepper value={l.qty} min={1} max={9999} label={l.title || 'items'} onTile onChange={(v) => setLine(l.key, { qty: v })} />
                  <TextInput aria-label={'Price of ' + (l.title || 'item')} prefix={sign} inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} className="w-28 bg-[var(--so-card)]" />
                  <IconButton icon={X} label={'Remove ' + (l.title || 'item')} size={32} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                </div>
              ))}
            </div>
          )}
          <SkuSearch
            placeholder="Search your products, or type an item"
            onPick={(p) => add({ sku: p.sku, title: p.title, option: p.option, image: p.image, qty: 1, price: cur === base ? String(p.price) : '' })}
            onFreeText={(title) => add({ sku: '', title, option: '', image: '', qty: 1, price: '' })}
          />
          {tried && error !== '' && <FormError>{error}</FormError>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shipping charged">
            <TextInput prefix={sign} inputMode="decimal" placeholder="0.00" value={shipping} onChange={(e) => setShipping(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Discount">
            <TextInput prefix={sign} inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Payment">
            <Select value={payment} onChange={(e) => setPayment(e.target.value === 'pending' ? 'pending' : e.target.value === 'cod' ? 'cod' : 'paid')}>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="cod">Cash on delivery</option>
            </Select>
          </Field>
          <div>
            <GroupLabel>Status</GroupLabel>
            <Segmented
              className="h-10"
              value={status}
              onChange={(v) => {
                setStatus(v);
                if (v === 'unpaid' && payment === 'paid') setPayment('pending');
                if (v === 'to_ship' && payment === 'pending') setPayment('paid');
              }}
              items={[
                { key: 'to_ship', label: 'To ship' },
                { key: 'unpaid', label: 'Unpaid' },
              ]}
            />
          </div>
        </div>

        <div>
          <GroupLabel hint="Optional">Buyer</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput aria-label="Buyer name" placeholder="Name" value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} autoComplete="off" />
            <TextInput aria-label="Buyer phone" placeholder="Phone" type="tel" value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))} autoComplete="off" />
            <TextInput aria-label="Buyer email" placeholder="Email" type="email" value={buyer.email} onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))} autoComplete="off" />
          </div>
          <TextArea aria-label="Delivery address" placeholder="Delivery address" rows={2} className="mt-3" value={buyer.address} onChange={(e) => setBuyer((b) => ({ ...b, address: e.target.value }))} />
        </div>

        <Field label="Note" hint="Only you see it">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gift wrap, deliver after 6pm" />
        </Field>
      </form>
    </Dialog>
  );
}

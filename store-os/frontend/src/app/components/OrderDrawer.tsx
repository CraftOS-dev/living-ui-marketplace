/**
 * One order in a side panel, over the orders list or any other page:
 *
 *   what to do next (ship, deliver, ask your AI agent, more)
 *   ship-by, payment and total
 *   items with their SKU links (an unknown SKU links in one step)
 *   money down to profit and margin, with fees and shipping cost editable
 *   the buyer, the shipment with its tracking events, conversations
 *   a note, the timeline and your AI agent's tasks on it
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Ban,
  CalendarClock,
  Copy,
  CreditCard,
  ExternalLink,
  HandCoins,
  History,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  PackageCheck,
  PackageX,
  Phone,
  Radar,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  Undo2,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { copyText, op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { ago, currencySign, day, dayShort, dayTime, money, pct, plural, toDate } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useBase, useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { Address, OrderDetail, OrderLine, Shipment } from '../lib/types.ts';
import { Clock, OrderStatus, TrackPill } from './badges.tsx';
import { ShopChip } from './PlatformMark.tsx';
import { Button, Card, CardHeader, confirmAsk, Drawer, Empty, IconBadge, IconButton, Menu, Pill, Skeleton, TaskBadge, TextArea, Tip } from './ui.tsx';
import type { MenuItem } from './ui.tsx';
import { ButtonMenu, CancelDialog, InlineInput, LinkSkuDialog, NotProductButton, orderChanged, parseAmount, PAYMENT_LABEL, RefundDialog, ReturnDialog, ShipDialog, Thumb } from './OrderDialogs.tsx';

/** What an order panel reads: it reloads when any of these change. */
export const ORDER_READS: Collection[] = ['orders', 'order_lines', 'shipments', 'shops', 'tasks', 'threads', 'customers', 'activity', 'variants', 'products'];

type DialogKind = 'ship' | 'refund' | 'return' | 'cancel' | 'link';

/** The order with `orderId` in a right-hand panel; nothing when the id is empty. */
export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }): React.JSX.Element | null {
  const live = useLive<{ order: OrderDetail; asked: string } | null>(
    'order:' + orderId,
    (signal) => (orderId === '' ? Promise.resolve(null) : op<{ order: OrderDetail }>('orders.get', { order: orderId }, { signal, quiet: true }).then((r) => ({ order: r.order, asked: orderId }))),
    ORDER_READS,
    [orderId],
  );
  const o = live.data !== null && live.data.asked === orderId ? live.data.order : null;
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [linkLine, setLinkLine] = useState<OrderLine | null>(null);
  useEffect(() => {
    setDialog(null);
  }, [orderId]);
  // Escape in a dialog, a menu or a confirmation closes that, not the panel under it.
  const close = useCallback(() => {
    if (dialog !== null || document.querySelector('[role="alertdialog"], [role="menu"]') !== null) return;
    onClose();
  }, [dialog, onClose]);
  const shut = useCallback(() => setDialog(null), []);

  return (
    <>
      <Drawer
        open={orderId !== ''}
        onClose={close}
        width={680}
        title={o !== null ? 'Order ' + o.number : 'Order'}
        subtitle={
          o !== null ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <ShopChip name={o.shop.name} platform={o.shop.platform} />
              <OrderStatus status={o.status} health={o.health} />
              <span>Placed {dayTime(o.placed_at)}</span>
            </span>
          ) : undefined
        }
      >
        {o !== null ? (
          <OrderBody o={o} open={setDialog} onLink={(l) => {
            setLinkLine(l);
            setDialog('link');
          }} onRemoved={onClose} />
        ) : live.error !== null && !live.loading ? (
          <Card>
            <Empty icon={PackageX} title="This order is not here" action={<Button variant="secondary" onClick={onClose}>Close</Button>}>
              {live.error}
            </Empty>
          </Card>
        ) : (
          <BodySkeleton />
        )}
      </Drawer>
      {o !== null && (
        <>
          <ShipDialog open={dialog === 'ship'} onClose={shut} orders={[{ id: o.id, number: o.number, buyer: o.buyer_name, shop: o.shop.id, status: o.status }]} />
          <RefundDialog open={dialog === 'refund'} onClose={shut} order={{ id: o.id, number: o.number, currency: o.currency, total: o.money.total, refunded: o.money.refund }} />
          <ReturnDialog open={dialog === 'return'} onClose={shut} order={{ id: o.id, number: o.number, lines: o.lines_detail }} />
          <CancelDialog open={dialog === 'cancel'} onClose={shut} order={{ id: o.id, number: o.number }} />
          <LinkSkuDialog open={dialog === 'link'} onClose={shut} line={linkLine} />
        </>
      )}
    </>
  );
}

function BodySkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-3" aria-busy>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-36 rounded-full bg-[var(--so-card)]" />
        <Skeleton className="h-10 w-44 rounded-full bg-[var(--so-card)]" />
      </div>
      <Skeleton className="h-24 rounded-[20px] bg-[var(--so-card)]" />
      <Skeleton className="h-44 rounded-[20px] bg-[var(--so-card)]" />
      <Skeleton className="h-56 rounded-[20px] bg-[var(--so-card)]" />
    </div>
  );
}

/* ------------------------------------------------------------------- body */

function OrderBody({ o, open, onLink, onRemoved }: { o: OrderDetail; open: (k: DialogKind) => void; onLink: (l: OrderLine) => void; onRemoved: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState('');
  const openStatus = o.status === 'unpaid' || o.status === 'to_ship';
  const moving = o.status === 'shipped' || o.status === 'delivered' || o.status === 'returned';
  const returnable = moving && o.lines_detail.some((l) => l.qty - l.qty_returned > 0);
  const refundable = o.status !== 'cancelled' && o.status !== 'unpaid' && o.money.total - o.money.refund > 0;

  const run = async (key: string, fn: () => Promise<unknown>, done: string, after: () => void = orderChanged): Promise<void> => {
    setBusy(key);
    try {
      await fn();
      notify.info(done);
      after();
    } catch {
      /* the notice says why */
    } finally {
      setBusy('');
    }
  };
  const help = (task: 'tracking' | 'exception'): void => void run(task, () => op('orders.help', { order: o.id, task }), 'Asked your AI agent', () => changed('tasks', 'activity'));
  const remove = async (): Promise<void> => {
    const ok = await confirmAsk('Delete order ' + o.number + '?', 'It leaves Store OS for good. Stock already moved stays in the ledger.', 'Delete order', { danger: true });
    if (!ok) return;
    try {
      await op('orders.remove', { order: o.id });
      notify.info('Order ' + o.number + ' deleted');
      onRemoved();
      orderChanged();
    } catch {
      /* the notice says why */
    }
  };

  const more: MenuItem[] = [];
  if (refundable) more.push({ label: 'Record refund', icon: HandCoins, onSelect: () => open('refund') });
  if (returnable) more.push({ label: 'Record return', icon: Undo2, onSelect: () => open('return') });
  if (o.status === 'shipped' && o.shipments.length > 0) more.push({ label: 'Add tracking', icon: Truck, onSelect: () => open('ship') });
  const admin = o.shop_detail.admin_url;
  if (admin !== '') more.push({ label: 'Open ' + o.shop.name + ' admin', icon: ExternalLink, onSelect: () => window.open(admin, '_blank', 'noopener') });
  if (openStatus) more.push({ label: 'Cancel order', icon: Ban, danger: true, onSelect: () => open('cancel') });
  more.push({ label: 'Delete order', icon: Trash2, danger: true, onSelect: () => void remove() });

  const ask: MenuItem[] = [
    { label: 'Check the tracking', icon: Radar, onSelect: () => help('tracking') },
    { label: 'Sort out a delivery problem', icon: Sparkles, onSelect: () => help('exception') },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {openStatus && (
          <Button icon={Truck} onClick={() => open('ship')}>
            Mark shipped
          </Button>
        )}
        {o.status === 'shipped' && (
          <Button icon={PackageCheck} loading={busy === 'deliver'} onClick={() => void run('deliver', () => op('orders.deliver', { order: o.id }), 'Marked delivered')}>
            Mark delivered
          </Button>
        )}
        {moving && <ButtonMenu label="Ask your AI agent" icon={Sparkles} items={ask} />}
        <TaskBadge task={o.task} />
        <span className="ml-auto">
          <Menu items={more} label="More actions" variant="card" size={40} />
        </span>
      </div>

      <Facts o={o} />
      <Items o={o} onLink={onLink} />
      <MoneyCard o={o} />
      <Buyer o={o} />
      {(moving || o.shipments.length > 0) && <Shipments o={o} onAdd={o.status === 'shipped' ? () => open('ship') : undefined} />}
      {o.threads.length > 0 && <Conversations o={o} />}
      <NoteCard o={o} />
      <Timeline o={o} />
      {o.tasks.length > 0 && <Tasks o={o} />}
    </div>
  );
}

/* ------------------------------------------------------------------ facts */

/** "2026-10-31" for a date input, in the seller's own clock. */
function dateValue(d: Date | null): string {
  if (d === null) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function ShipByInput({ o }: { o: OrderDetail }): React.JSX.Element {
  const was = toDate(o.ship_by);
  const value = dateValue(was);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = async (): Promise<void> => {
    if (draft === value) return;
    let iso = '';
    if (draft !== '') {
      const [y = 0, m = 1, d = 1] = draft.split('-').map(Number);
      // Keep the time of day the deadline had (18:00 when there was none).
      iso = new Date(y, m - 1, d, was?.getHours() ?? 18, was?.getMinutes() ?? 0).toISOString();
    }
    try {
      await op('orders.update', { order: o.id, ship_by: iso });
      notify.info('Ship-by date changed');
      orderChanged();
    } catch {
      setDraft(value);
    }
  };
  return (
    <input
      type="date"
      aria-label="Ship by"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
        }
      }}
      className="so-edge h-8 w-full min-w-0 rounded-[10px] bg-[var(--so-card)] px-2 text-[13px] font-semibold text-[var(--so-ink)] outline-none ring-[var(--so-ink)] focus-visible:ring-2"
    />
  );
}

function FactTile({ icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[14px] bg-[var(--so-tile)] p-3">
      <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--so-muted)]">
        <IconBadge icon={icon} tone="card" size={24} />
        {label}
      </p>
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  );
}

function Facts({ o }: { o: OrderDetail }): React.JSX.Element {
  const openStatus = o.status === 'unpaid' || o.status === 'to_ship';
  let when: { label: string; text: string } = { label: 'Ship by', text: '' };
  if (o.status === 'shipped') when = { label: 'Shipped', text: dayTime(o.shipped_at) };
  else if (o.status === 'delivered') when = { label: 'Delivered', text: dayTime(o.delivered_at) };
  else if (o.status === 'returned') when = { label: 'Returned', text: dayTime(o.delivered_at || o.shipped_at) };
  else if (o.status === 'cancelled') when = { label: 'Cancelled', text: dayTime(o.cancelled_at) };
  return (
    <Card className="p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <FactTile icon={CalendarClock} label={when.label}>
          {openStatus ? (
            <>
              <ShipByInput o={o} />
              <Clock hours={o.hours_left} className="mt-1 block px-2" />
            </>
          ) : (
            <p className="truncate text-[14px] font-semibold">{when.text || 'Not recorded'}</p>
          )}
        </FactTile>
        <FactTile icon={CreditCard} label="Payment">
          <p className="truncate text-[14px] font-semibold">{PAYMENT_LABEL[o.payment] ?? o.payment}</p>
          {o.money.refund > 0 && <p className="num text-[12px] text-[var(--so-red-text)]">{money(o.money.refund, o.currency)} refunded</p>}
        </FactTile>
        <FactTile icon={ReceiptText} label="Total">
          <p className="num truncate text-[14px] font-semibold">{money(o.total, o.currency)}</p>
          <p className="text-[12px] text-[var(--so-muted)]">{plural(o.units, 'unit')}</p>
        </FactTile>
      </div>
      {o.status === 'cancelled' && o.cancel_reason !== '' && <p className="mt-2 px-1 text-[13px] text-[var(--so-ink-2)]">Reason: {o.cancel_reason}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ items */

function Items({ o, onLink }: { o: OrderDetail; onLink: (l: OrderLine) => void }): React.JSX.Element {
  const base = useBase();
  return (
    <Card>
      <CardHeader title="Items" subtitle={plural(o.units, 'unit') + (o.lines > 1 ? ' in ' + o.lines + ' lines' : '')} />
      {o.lines_detail.length === 0 ? (
        <p className="text-[13px] text-[var(--so-muted)]">This order came in without its items.</p>
      ) : (
        <ul className="divide-y divide-[var(--so-line)]">
          {o.lines_detail.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0 sm:flex-nowrap">
              <Thumb image={l.image} size={44} />
              <div className="min-w-0 flex-1 basis-48">
                {l.product !== '' ? (
                  <a href={href('product', l.product)} className="block truncate text-[14px] font-semibold hover:underline">
                    {l.title}
                  </a>
                ) : (
                  <p className="truncate text-[14px] font-semibold">{l.title}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--so-muted)]">
                  {l.option !== '' && <span>{l.option}</span>}
                  {l.sku !== '' && <span className="num">SKU {l.sku}</span>}
                  {l.qty_returned > 0 && <span className="font-semibold text-[var(--so-ink-2)]">{l.qty_returned} returned</span>}
                </p>
                {l.kind === 'extra' ? (
                  <div className="mt-2">
                    <Tip text={'Moves no stock. Costs you ' + money(l.cost, base) + ' each.'}>
                      <Pill tone="neutral">Not a product</Pill>
                    </Tip>
                  </div>
                ) : (
                  l.variant === '' && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Pill tone="warn">SKU not in catalog</Pill>
                      <Button variant="secondary" size="sm" icon={Link2} onClick={() => onLink(l)}>
                        Link to a SKU
                      </Button>
                      <NotProductButton line={l} />
                    </div>
                  )
                )}
              </div>
              <div className="ml-auto text-right">
                <p className="num text-[14px] font-semibold">{money(l.qty * l.price, o.currency)}</p>
                <p className="num text-[12px] text-[var(--so-muted)]">
                  {l.qty} x {money(l.price, o.currency)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ money */

function Line({ label, children, strong = false, tone }: { label: ReactNode; children: ReactNode; strong?: boolean; tone?: 'bad' }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-8 items-center justify-between gap-3 text-[13px]', strong ? 'font-semibold text-[var(--so-ink)]' : 'text-[var(--so-ink-2)]')}>
      <span className="flex min-w-0 items-center gap-2">{label}</span>
      <span className={cn('num shrink-0 text-right', tone === 'bad' && 'text-[var(--so-red-text)]', strong && 'text-[15px]')}>{children}</span>
    </div>
  );
}

function MoneyCard({ o }: { o: OrderDetail }): React.JSX.Element {
  const m = o.money;
  const cur = m.currency;
  const update = async (params: Record<string, unknown>, done: string): Promise<void> => {
    await op('orders.update', { order: o.id, ...params });
    notify.info(done);
    orderChanged();
  };
  const saveFees = (v: string): Promise<void> => {
    const n = parseAmount(v);
    if (n !== null && (Number.isNaN(n) || n < 0)) {
      notify.error('Fees must be a number, like 12.50');
      return Promise.reject(new Error('invalid'));
    }
    return update({ fees: n === null ? '' : String(n) }, n === null ? 'Fees estimated again' : 'Fees saved');
  };
  const saveShipCost = (v: string): Promise<void> => {
    const n = parseAmount(v);
    if (n !== null && (Number.isNaN(n) || n < 0)) {
      notify.error('Shipping cost must be a number, like 8.00');
      return Promise.reject(new Error('invalid'));
    }
    return update({ ship_cost: n ?? 0 }, 'Shipping cost saved');
  };
  const margin = m.margin_pct;
  return (
    <Card>
      <CardHeader title="Money" subtitle={cur !== m.base && m.base !== '' ? 'Order in ' + cur + ', profit in ' + m.base : undefined} />
      <div className="grid gap-0">
        <Line label="Subtotal">{money(m.subtotal, cur)}</Line>
        {m.discount > 0 && <Line label="Discount">-{money(m.discount, cur)}</Line>}
        <Line label="Shipping charged">{money(m.shipping, cur)}</Line>
        {m.tax > 0 && <Line label="Tax">{money(m.tax, cur)}</Line>}
        <Line label="Total" strong>
          {money(m.total, cur)}
        </Line>
        {m.refund > 0 && (
          <Line label="Refunded" tone="bad">
            -{money(m.refund, cur)}
          </Line>
        )}
      </div>
      <div className="my-3 border-t border-[var(--so-line)]" />
      <div className="grid gap-0">
        <Line
          label={
            <>
              <Tip text="What the shop charged you. Leave it blank to estimate it from the shop's fee rates.">
                <span className="border-b border-dashed border-[var(--so-faint)]">Fees</span>
              </Tip>
              {m.fees_estimated && <Pill tone="neutral">estimated</Pill>}
            </>
          }
        >
          <InlineInput label="Fees" value={m.fees_estimated ? '' : String(m.fees)} placeholder={String(m.fees)} prefix={currencySign(cur)} inputMode="decimal" align="right" className="w-36" onSave={saveFees} />
        </Line>
        <Line label="Your shipping cost">
          <InlineInput label="Your shipping cost" value={m.ship_cost > 0 ? String(m.ship_cost) : ''} placeholder="0.00" prefix={currencySign(cur)} inputMode="decimal" align="right" className="w-36" onSave={saveShipCost} />
        </Line>
        <Line
          label={
            <>
              <span>Cost of goods</span>
              {m.cost_missing && (
                <Tip text="Some items have no cost. Add it on the product and this order's profit fills in.">
                  <Pill tone="warn">Cost missing</Pill>
                </Tip>
              )}
            </>
          }
        >
          <span className="px-2">{money(m.cogs_base, m.base)}</span>
        </Line>
        <Line
          strong
          label={
            <>
              <span>Profit</span>
              {margin !== null && <Pill tone={margin >= 0 ? 'good' : 'bad'}>{pct(margin)} margin</Pill>}
            </>
          }
        >
          {m.profit_base === null ? (
            <Tip text={'There is no exchange rate from ' + cur + ' to ' + m.base + ' yet.'}>
              <span className="px-2 text-[13px] font-medium text-[var(--so-muted)]">No exchange rate</span>
            </Tip>
          ) : (
            <span className={cn('px-2', m.profit_base < 0 && 'text-[var(--so-red-text)]')}>{money(m.profit_base, m.base)}</span>
          )}
        </Line>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ buyer */

function addressLines(a: Address): string[] {
  if (a.text !== undefined && a.text.trim() !== '') return a.text.split('\n').map((x) => x.trim()).filter((x) => x !== '');
  const cityLine = [a.postcode, a.city].filter((x) => x !== undefined && x !== '').join(' ');
  return [a.name, a.line1, a.line2, cityLine, a.state, a.country].filter((x): x is string => x !== undefined && x.trim() !== '');
}

function ContactRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-3 text-[13px]">
      <Icon size={16} strokeWidth={2} className="mt-1 shrink-0 text-[var(--so-muted)]" aria-hidden />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

function Buyer({ o }: { o: OrderDetail }): React.JSX.Element {
  const { settings } = useStore();
  const c = o.customer_detail;
  const address = addressLines(o.address);
  const phone = o.buyer_phone || o.address.phone || '';
  const removed = (
    <Tip text={'Store OS removes addresses and phone numbers ' + (settings?.pii_days ?? 30) + ' days after an order is finished.'}>
      <span className="text-[var(--so-muted)]">Removed after delivery</span>
    </Tip>
  );
  return (
    <Card>
      <CardHeader
        title="Buyer"
        action={
          c !== null ? (
            <a href={href('customers', 'all', c.id)} className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]">
              <UserRound size={14} aria-hidden />
              {c.orders > 1 ? plural(c.orders, 'order') : 'First order'}
            </a>
          ) : undefined
        }
      />
      <div className="grid gap-3">
        <p className="text-[14px] font-semibold">{o.buyer_name || c?.name || 'No name given'}</p>
        {o.buyer_email !== '' && (
          <ContactRow icon={Mail}>
            <a href={'mailto:' + o.buyer_email} className="hover:underline">
              {o.buyer_email}
            </a>
          </ContactRow>
        )}
        {o.purged ? (
          <ContactRow icon={Phone}>{removed}</ContactRow>
        ) : (
          phone !== '' && (
            <ContactRow icon={Phone}>
              <a href={'tel:' + phone.replace(/\s+/g, '')} className="num hover:underline">
                {phone}
              </a>
            </ContactRow>
          )
        )}
        <ContactRow icon={MapPin}>
          {o.purged ? (
            removed
          ) : address.length > 0 ? (
            address.map((x, i) => (
              <span key={i} className="block">
                {x}
              </span>
            ))
          ) : (
            <span className="text-[var(--so-muted)]">No address</span>
          )}
        </ContactRow>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- shipment */

function ShipmentBlock({ s }: { s: Shipment }): React.JSX.Element {
  const copy = async (): Promise<void> => {
    if (await copyText(s.tracking)) notify.info('Tracking number copied');
    else notify.error('Could not copy here');
  };
  const events = [...s.events].reverse();
  const eta = toDate(s.eta);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconBadge icon={Truck} size={32} />
        <span className="text-[14px] font-semibold">{s.carrier || 'Carrier not given'}</span>
        <TrackPill status={s.status} />
        {s.url !== '' && (
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)]">
            Track
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </div>
      {s.tracking !== '' && (
        <div className="flex items-center gap-2 rounded-[12px] bg-[var(--so-tile)] py-1 pl-3 pr-1">
          <span className="num min-w-0 flex-1 truncate text-[13px] font-semibold">{s.tracking}</span>
          <IconButton icon={Copy} label="Copy tracking number" size={32} onClick={() => void copy()} />
        </div>
      )}
      {(s.last_event !== '' || eta !== null) && (
        <p className="text-[13px] text-[var(--so-ink-2)]">
          {s.last_event !== '' && (
            <>
              <span className="font-semibold text-[var(--so-ink)]">{s.last_event}</span>
              {s.last_event_at !== '' && <span className="text-[var(--so-muted)]"> {ago(s.last_event_at)}</span>}
            </>
          )}
          {eta !== null && s.status !== 'delivered' && <span className="block text-[12px] text-[var(--so-muted)]">Expected {day(s.eta)}</span>}
        </p>
      )}
      {events.length > 0 && (
        <ol className="relative ml-1 grid gap-3 border-l border-[var(--so-line)] pl-4">
          {events.map((e, i) => (
            <li key={e.at + i} className="relative">
              <span aria-hidden className={cn('absolute -left-[21px] top-1.5 size-2 rounded-full', i === 0 ? 'bg-[var(--so-accent)]' : 'bg-[var(--so-faint)]')} />
              <p className={cn('text-[13px]', i === 0 ? 'font-semibold' : 'text-[var(--so-ink-2)]')}>{e.text || e.status}</p>
              <p className="text-[12px] text-[var(--so-muted)]">{dayTime(e.at)}</p>
            </li>
          ))}
        </ol>
      )}
      {s.checked_at !== '' && <p className="text-[12px] text-[var(--so-muted)]">Checked {ago(s.checked_at)}</p>}
    </div>
  );
}

function Shipments({ o, onAdd }: { o: OrderDetail; onAdd: (() => void) | undefined }): React.JSX.Element {
  const list = [...o.shipments].reverse();
  return (
    <Card>
      <CardHeader title={list.length > 1 ? 'Shipments' : 'Shipment'} subtitle={o.shipped_at !== '' ? 'Shipped ' + dayShort(o.shipped_at) : undefined} />
      {list.length === 0 ? (
        <Empty
          icon={Truck}
          title="No tracking yet"
          className="py-6"
          action={
            onAdd !== undefined ? (
              <Button variant="secondary" size="sm" icon={Truck} onClick={onAdd}>
                Add tracking
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-5">
          {list.map((s) => (
            <ShipmentBlock key={s.id} s={s} />
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- conversations */

function Conversations({ o }: { o: OrderDetail }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Conversations" subtitle={plural(o.threads.length, 'conversation')} />
      <div className="-mx-2 grid gap-0">
        {o.threads.map((t) => (
          <a key={t.id} href={href('inbox', 'all', t.id)} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
            <IconBadge icon={MessageSquare} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{t.subject || 'Conversation'}</span>
              <span className="block text-[12px] text-[var(--so-muted)]">{ago(t.last_at)}</span>
            </span>
            <Pill tone={t.status === 'open' ? 'accent' : t.status === 'waiting' ? 'info' : 'neutral'}>{t.status === 'open' ? 'Open' : t.status === 'waiting' ? 'Waiting' : 'Closed'}</Pill>
          </a>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- note */

function NoteCard({ o }: { o: OrderDetail }): React.JSX.Element {
  const [draft, setDraft] = useState(o.note);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setDraft(o.note);
  }, [o.note, focus]);
  const save = async (): Promise<void> => {
    setFocus(false);
    if (draft.trim() === o.note.trim()) return;
    try {
      await op('orders.update', { order: o.id, note: draft.trim() });
      notify.info('Note saved');
      orderChanged();
    } catch {
      setDraft(o.note);
    }
  };
  return (
    <Card>
      <CardHeader title="Note" subtitle="Only you see it" />
      <TextArea
        aria-label="Note"
        rows={3}
        value={draft}
        placeholder="Add a note"
        onFocus={() => setFocus(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          // Escape saves and leaves the field; the panel stays open.
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
    </Card>
  );
}

/* --------------------------------------------------------------- timeline */

const KIND_ICON: Record<string, LucideIcon> = { placed: ShoppingBag, shipped: Truck, delivered: PackageCheck, cancelled: Ban, tracking: MapPin, activity: History, message: MessageSquare };

function Timeline({ o }: { o: OrderDetail }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Timeline" />
      {o.timeline.length === 0 ? (
        <p className="text-[13px] text-[var(--so-muted)]">Nothing has happened yet.</p>
      ) : (
        <ol className="grid gap-0">
          {o.timeline.map((t, i) => {
            const Icon = KIND_ICON[t.kind] ?? Package;
            const last = i === o.timeline.length - 1;
            return (
              <li key={t.at + t.kind + i} className="relative flex gap-3 pb-4 last:pb-0">
                {!last && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-[var(--so-line)]" />}
                <IconBadge icon={Icon} size={28} tone={i === 0 ? 'ink' : 'tile'} />
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[13px] text-[var(--so-ink)]">{t.text}</p>
                  <p className="text-[12px] text-[var(--so-muted)]">{dayTime(t.at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ tasks */

function Tasks({ o }: { o: OrderDetail }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Your AI agent on this order" />
      <ul className="divide-y divide-[var(--so-line)]">
        {o.tasks.map((t) => (
          <li key={t.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.label}</span>
              <TaskBadge task={t} />
            </div>
            {t.note !== '' && <p className="text-[13px] text-[var(--so-ink-2)]">{t.note}</p>}
            <p className="text-[12px] text-[var(--so-muted)]">Asked {ago(t.created)}{t.done_at !== '' ? ', finished ' + ago(t.done_at) : ''}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Orders from every shop in one queue.
 *
 *   views by what needs doing: to ship (soonest ship-by first), at risk,
 *   unpaid, shipped, delivery problems, delivered, returns, cancelled, all
 *   a table with checkboxes: select orders to mark them shipped together or
 *   save a pick list
 *   the order panel over the list (#/orders/<view>/<order id>)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ClipboardList, CircleX, PackageCheck, PanelRight, Plus, Radar, ShoppingBag, Truck, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, useDebounce } from '../../kit/index.ts';
import { download, op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { dayShort, money, num, plural, time } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { OrderDetail, OrderList, OrderRow, OrderView, Task } from '../lib/types.ts';
import { Clock, OrderStatus, ShopFilter, TrackPill } from '../components/badges.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { AddOrderDialog, CancelDialog, orderChanged, PAYMENT_LABEL, ShipDialog } from '../components/OrderDialogs.tsx';
import type { ShipTarget } from '../components/OrderDialogs.tsx';
import { OrderDrawer } from '../components/OrderDrawer.tsx';
import { ShopChip } from '../components/PlatformMark.tsx';
import { Button, Checkbox, Empty, Menu, NoRowTap, PageHeader, PhoneList, PhoneRow, Pill, SearchField, Skeleton, TableCard, TaskBadge, Tabs, Td, Th, Tr } from '../components/ui.tsx';
import type { MenuItem, TabItem } from '../components/ui.tsx';

const VIEWS: { key: OrderView; label: string }[] = [
  { key: 'to_ship', label: 'To ship' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'exceptions', label: 'Problems' },
  { key: 'unlinked', label: 'SKU not in catalog' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'returns', label: 'Returns' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

/** Views that count something to fix: their count is red when above 0. */
const ALERT_VIEWS: OrderView[] = ['at_risk', 'exceptions', 'unlinked'];

const EMPTY: Record<OrderView, { title: string; body: string }> = {
  unlinked: { title: 'Every SKU is in your catalog', body: 'Orders with a SKU your catalog does not have show here.' },
  to_ship: { title: 'Nothing to ship', body: 'New orders from every shop land here, soonest ship-by first.' },
  at_risk: { title: 'Nothing at risk', body: 'Orders close to or past their ship-by time show here.' },
  unpaid: { title: 'No unpaid orders', body: 'Orders waiting for payment show here.' },
  shipped: { title: 'Nothing on its way', body: 'Shipped orders stay here until they arrive.' },
  exceptions: { title: 'No delivery problems', body: 'A failed delivery, or a parcel with no news for 7 days, shows here.' },
  delivered: { title: 'No deliveries yet', body: 'Orders that arrived show here.' },
  returns: { title: 'No returns', body: 'Returned items and refunds show here.' },
  cancelled: { title: 'No cancelled orders', body: 'Cancelled orders show here.' },
  all: { title: 'No orders yet', body: 'Add one by hand, or import an order export from a shop.' },
};

const LIST_READS: Collection[] = ['orders', 'order_lines', 'shipments', 'shops', 'tasks', 'threads', 'customers'];
const PAGE = 100;
/** The server answers at most this many rows a call. */
const SERVER_MAX = 500;

/** `limit` rows of a view, in calls of at most 500. */
async function loadOrders(params: Record<string, unknown>, limit: number, signal: AbortSignal): Promise<OrderList> {
  const calls = Math.max(1, Math.ceil(limit / SERVER_MAX));
  const pages = await Promise.all(Array.from({ length: calls }, (_, i) => op<OrderList>('orders.list', { ...params, limit: Math.min(SERVER_MAX, limit - i * SERVER_MAX), offset: i * SERVER_MAX }, { signal, quiet: true })));
  const first = pages[0];
  if (first === undefined) throw new Error('No answer from the app');
  return { ...first, orders: pages.flatMap((p) => p.orders) };
}

function isOpen(r: OrderRow): boolean {
  return r.status === 'unpaid' || r.status === 'to_ship';
}

function shipTarget(r: OrderRow): ShipTarget {
  return { id: r.id, number: r.number, buyer: r.buyer_name, shop: r.shop.id, status: r.status };
}

/* --------------------------------------------------------------- pick list */

function csvCell(v: string): string {
  // A cell that starts like a formula is kept as text in spreadsheets.
  const safe = /^[=+\-@]/.test(v) ? "'" + v : v;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function today(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** What to take off the shelf for these orders: SKU, title, option and quantity, as a CSV. */
async function savePickList(ids: string[]): Promise<void> {
  const details = await Promise.all(ids.map((id) => op<{ order: OrderDetail }>('orders.get', { order: id }, { quiet: true })));
  const sum = new Map<string, { sku: string; title: string; option: string; qty: number; orders: string[] }>();
  for (const { order } of details) {
    for (const l of order.lines_detail) {
      const qty = l.qty - l.qty_shipped;
      if (qty <= 0) continue;
      const key = (l.sku !== '' ? l.sku : l.title) + '\n' + l.option;
      const row = sum.get(key) ?? { sku: l.sku, title: l.title, option: l.option, qty: 0, orders: [] };
      row.qty += qty;
      if (!row.orders.includes(order.number)) row.orders.push(order.number);
      sum.set(key, row);
    }
  }
  if (sum.size === 0) {
    notify.error('Everything in these orders has shipped');
    return;
  }
  const rows = [...sum.values()].sort((a, b) => (a.sku || a.title).localeCompare(b.sku || b.title));
  const lines = [['SKU', 'Title', 'Option', 'Qty', 'Orders'], ...rows.map((r) => [r.sku, r.title, r.option, String(r.qty), r.orders.join(' ')])];
  download('pick-list-' + today() + '.csv', String.fromCharCode(0xfeff) + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  notify.info('Pick list saved');
}

/* -------------------------------------------------------------------- page */

export function OrdersPage({ route }: { route: Route }): React.JSX.Element {
  const view: OrderView = VIEWS.find((v) => v.key === route.sub)?.key ?? 'to_ship';
  const { attention } = useStore();
  const [shop, setShop] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 250);
  const asked = view + '|' + shop + '|' + dq;
  // Rows to show; back to one page when the view, shop or search changes.
  const [paging, setPaging] = useState({ asked, limit: PAGE });
  const limit = paging.asked === asked ? paging.limit : PAGE;

  const list = useLive<OrderList & { asked: string }>(
    'orders:' + asked,
    (signal) => loadOrders({ view, shop: shop === '' ? undefined : shop, q: dq === '' ? undefined : dq }, limit, signal).then((r) => ({ ...r, asked })),
    LIST_READS,
    [asked, limit],
  );
  // While another view loads, the tabs keep the last counts and the table shows placeholders.
  const data = list.data !== null && list.data.asked === asked ? list.data : null;
  const counts = list.data?.counts ?? null;
  const rows = data?.orders ?? [];

  const [sel, setSel] = useState<Set<string>>(() => new Set());
  useEffect(() => setSel(new Set()), [asked]);
  const picked = rows.filter((r) => sel.has(r.id));
  const shippable = picked.filter(isOpen);
  const allOn = rows.length > 0 && picked.length === rows.length;
  const check = (id: string, on: boolean): void =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ship, setShip] = useState<ShipTarget[] | null>(null);
  const [cancel, setCancel] = useState<{ id: string; number: string } | null>(null);
  const [picking, setPicking] = useState(false);

  /* your AI agent checking every parcel on its way */
  const trackable = view === 'shipped' || view === 'exceptions';
  const [trackId, setTrackId] = useState('');
  const [trackBusy, setTrackBusy] = useState(false);
  const track = useLive<Task | null>(
    'orders:track-all:' + (trackable ? trackId : 'off'),
    async (signal) => {
      if (!trackable) return null;
      if (trackId !== '') return (await op<{ task: Task }>('tasks.get', { task: trackId }, { signal, quiet: true })).task;
      const open = await op<{ tasks: Task[] }>('tasks.list', {}, { signal, quiet: true });
      return open.tasks.find((t) => t.target === 'store:tracking') ?? null;
    },
    ['tasks'],
    [trackable, trackId],
  );
  const trackAll = async (): Promise<void> => {
    setTrackBusy(true);
    try {
      const r = await op<{ task: Task }>('orders.track-all', {});
      setTrackId(r.task.id);
      notify.info('Asked your AI agent to check tracking');
      changed('tasks', 'activity');
    } catch {
      /* the notice says why */
    } finally {
      setTrackBusy(false);
    }
  };

  /* rows */
  const deliver = async (r: OrderRow): Promise<void> => {
    try {
      await op('orders.deliver', { order: r.id });
      notify.info('Order ' + r.number + ' delivered');
      orderChanged();
    } catch {
      /* the notice says why */
    }
  };
  const askTracking = async (r: OrderRow): Promise<void> => {
    try {
      await op('orders.help', { order: r.id, task: 'tracking' });
      notify.info('Asked your AI agent');
      changed('tasks', 'activity');
    } catch {
      /* the notice says why */
    }
  };
  const rowMenu = (r: OrderRow): MenuItem[] => {
    const items: MenuItem[] = [{ label: 'Open', icon: PanelRight, onSelect: () => go('orders', view, r.id) }];
    if (isOpen(r)) items.push({ label: 'Mark shipped', icon: Truck, onSelect: () => setShip([shipTarget(r)]) });
    if (r.status === 'shipped') {
      items.push({ label: 'Mark delivered', icon: PackageCheck, onSelect: () => void deliver(r) });
      items.push({ label: 'Ask your AI agent to check tracking', icon: Radar, onSelect: () => void askTracking(r) });
    }
    if (isOpen(r)) items.push({ label: 'Cancel order', icon: CircleX, danger: true, onSelect: () => setCancel({ id: r.id, number: r.number }) });
    return items;
  };

  const pickList = async (): Promise<void> => {
    setPicking(true);
    try {
      await savePickList(picked.map((r) => r.id));
    } catch {
      notify.error('Could not make the pick list. Try again.');
    } finally {
      setPicking(false);
    }
  };

  /* more rows as the table's end comes near */
  const more = data !== null && rows.length < data.total && rows.length >= limit;
  const loadMore = useCallback(() => setPaging({ asked, limit: limit + PAGE }), [asked, limit]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!more || el === null) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loadMore]);

  const toShip = attention?.to_ship ?? counts?.to_ship ?? null;
  const late = attention?.late ?? 0;
  const subtitle = toShip === null ? undefined : toShip === 0 ? 'Nothing waiting to ship' : num(toShip) + ' to ship' + (late > 0 ? ', ' + num(late) + ' late' : '');
  // "SKU not in catalog" is a tab only while it has orders (or is open).
  const tabs: TabItem<OrderView>[] = VIEWS.filter((v) => v.key !== 'unlinked' || view === 'unlinked' || (counts?.unlinked ?? 0) > 0).map((v) => {
    const n = counts?.[v.key];
    return { key: v.key, label: v.label, count: n, alert: ALERT_VIEWS.includes(v.key) && (n ?? 0) > 0 };
  });
  const trackCol = view === 'shipped' || view === 'exceptions' || view === 'delivered';
  const noOrders = counts !== null && counts.all === 0 && shop === '' && dq === '';
  const empty = noOrders ? EMPTY.all : EMPTY[view];
  const addImport = (
    <>
      <Button icon={Plus} onClick={() => setAdding(true)}>
        Add order
      </Button>
      <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
        Import
      </Button>
    </>
  );

  return (
    <div className="pb-24">
      <PageHeader
        title="Orders"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add order
            </Button>
          </>
        }
      />

      <div className="so-rise mb-4">
        <Tabs items={tabs} value={view} onChange={(k) => go('orders', k)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ShopFilter value={shop} onChange={setShop} className="min-w-0 flex-1" />
        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          {trackable && (
            <>
              <TaskBadge task={track.data} />
              <Button variant="secondary" icon={Radar} loading={trackBusy} disabled={(counts?.shipped ?? 0) === 0} onClick={() => void trackAll()}>
                Check tracking
              </Button>
            </>
          )}
          <SearchField value={q} onChange={setQ} placeholder="Order number or buyer" onCard={false} className="w-full sm:w-72" />
        </div>
      </div>

      <TableCard
        foot={
          data !== null && rows.length > 0 ? (
            <p className="text-[12px] text-[var(--so-muted)]">
              {rows.length < data.total ? 'Showing ' + num(rows.length) + ' of ' + num(data.total) + ' orders' : plural(data.total, 'order')}
            </p>
          ) : undefined
        }
      >
        {data === null && list.error !== null && !list.loading ? (
          <Empty icon={ShoppingBag} title="Orders did not load" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>
            {list.error}
          </Empty>
        ) : data !== null && rows.length === 0 ? (
          dq !== '' ? (
            <Empty icon={ShoppingBag} title={'No orders match "' + dq + '"'} action={<Button variant="secondary" onClick={() => setQ('')}>Clear search</Button>}>
              Search by order number, buyer name, email or phone.
            </Empty>
          ) : (
            <Empty
              icon={view === 'shipped' || view === 'exceptions' ? Truck : ShoppingBag}
              title={empty.title}
              action={
                noOrders || view === 'to_ship' || view === 'all' ? (
                  addImport
                ) : (
                  <Button variant="secondary" onClick={() => go('orders', 'all')}>
                    See all orders
                  </Button>
                )
              }
            >
              {empty.body}
            </Empty>
          )
        ) : (
          <>
          <PhoneList label="Orders" wide>
            {data === null
              ? Array.from({ length: 6 }, (_, i) => <SkeletonPhoneRow key={i} />)
              : rows.map((r) => <OrderPhoneRow key={r.id} r={r} open={route.id === r.id} checked={sel.has(r.id)} onCheck={(v) => check(r.id, v)} onOpen={() => go('orders', view, r.id)} menu={rowMenu(r)} />)}
          </PhoneList>
          <table className="hidden w-full min-w-[1000px] border-collapse text-left lg:table">
            <thead>
              <tr>
                <th className="w-10 pl-3">
                  <Checkbox checked={allOn} indeterminate={picked.length > 0 && !allOn} label="Select all orders" onChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())} />
                </th>
                <Th>Order</Th>
                <Th>Buyer</Th>
                <Th>Items</Th>
                <Th>Placed</Th>
                <Th>{trackCol ? 'Tracking' : 'Ship by'}</Th>
                <Th align="right">Total</Th>
                <Th>Status</Th>
                <th className="w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data === null
                ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
                : rows.map((r) => <OrderTr key={r.id} r={r} open={route.id === r.id} checked={sel.has(r.id)} onCheck={(v) => check(r.id, v)} onOpen={() => go('orders', view, r.id)} menu={rowMenu(r)} />)}
            </tbody>
          </table>
          </>
        )}
        <div ref={sentinel} aria-hidden />
      </TableCard>

      {picked.length > 0 && (
        <div className="so-toast pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div role="toolbar" aria-label="Selected orders" className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-[var(--so-primary)] p-1 pl-4 text-[var(--so-on-primary)] shadow-[0_18px_50px_-12px_var(--so-shadow)] [scrollbar-width:none]">
            <span className="num shrink-0 pr-2 text-[13px] font-semibold">
              {picked.length}
              <span className="hidden sm:inline"> selected</span>
            </span>
            <BarButton icon={Truck} disabled={shippable.length === 0} onClick={() => setShip(shippable.map(shipTarget))}>
              {shippable.length > 0 && shippable.length < picked.length ? 'Ship ' + shippable.length : 'Mark shipped'}
            </BarButton>
            <BarButton icon={ClipboardList} busy={picking} onClick={() => void pickList()}>
              Pick list
            </BarButton>
            <button type="button" aria-label="Clear selection" title="Clear selection" onClick={() => setSel(new Set())} className="hit so-press flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--so-primary-hover)]">
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <OrderDrawer orderId={route.id} onClose={() => go('orders', view)} />
      <AddOrderDialog open={adding} onClose={() => setAdding(false)} onAdded={(id, status) => go('orders', view === 'all' || view === status ? view : status, id)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} kind="orders" {...(shop !== '' ? { shopId: shop } : {})} />
      <ShipDialog open={ship !== null} onClose={() => setShip(null)} orders={ship ?? []} onDone={() => setSel(new Set())} />
      <CancelDialog open={cancel !== null} onClose={() => setCancel(null)} order={cancel} />
    </div>
  );
}

/* --------------------------------------------------------------------- rows */

function BarButton({ icon: Icon, children, onClick, disabled = false, busy = false }: { icon: LucideIcon; children: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean }): React.JSX.Element {
  return (
    <button type="button" disabled={disabled || busy} onClick={onClick} className="so-press inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-semibold hover:bg-[var(--so-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? <span aria-hidden className="so-spin size-4 rounded-full border-2 border-current border-t-transparent" /> : <Icon size={15} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
}

function SkeletonRow(): React.JSX.Element {
  return (
    <tr className="border-t border-[var(--so-line)]">
      <td className="h-16 pl-3">
        <Skeleton className="size-[18px] rounded-[5px]" />
      </td>
      {[96, 112, 160, 64, 80, 72, 88].map((w, i) => (
        <td key={i} className="px-3">
          <div style={{ width: w }}>
            <Skeleton className="h-3 rounded-full" />
          </div>
        </td>
      ))}
      <td />
    </tr>
  );
}

/** Ship-by clock for open orders, tracking for shipped ones. */
function ShipInfo({ r, inline = false }: { r: OrderRow; inline?: boolean }): React.JSX.Element | null {
  const muted = cn('text-[12px] text-[var(--so-muted)]', inline ? 'inline' : 'block');
  if (isOpen(r)) {
    if (r.hours_left === null) return <span className={muted}>No ship-by date</span>;
    return (
      <>
        <Clock hours={r.hours_left} className={inline ? 'inline' : 'block'} />
        <span className={muted}>{inline ? ', ' : ''}{dayShort(r.ship_by)}</span>
      </>
    );
  }
  if (r.status !== 'shipped' && r.status !== 'delivered') return null;
  if (r.tracking_status === '') return <span className={muted}>No tracking</span>;
  return (
    <>
      <TrackPill status={r.tracking_status} />
      {r.carrier !== '' && <span className={cn(muted, 'max-w-[160px] truncate', inline ? 'ml-2' : 'mt-1')}>{r.carrier}</span>}
    </>
  );
}

function SkeletonPhoneRow(): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 border-t border-[var(--so-line)] px-3 py-3 first:border-t-0">
      <Skeleton className="size-[18px] rounded-[5px]" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-3 w-3/5 rounded-full" />
        <Skeleton className="h-3 w-4/5 rounded-full" />
        <Skeleton className="h-6 w-2/5 rounded-full" />
      </div>
    </li>
  );
}

/** An order on a phone: number and total, buyer and item, then where it stands. */
function OrderPhoneRow({ r, open, checked, onCheck, onOpen, menu }: { r: OrderRow; open: boolean; checked: boolean; onCheck: (v: boolean) => void; onOpen: () => void; menu: MenuItem[] }): React.JSX.Element {
  const item = r.first_item === '' ? 'No items' : r.lines > 1 ? r.first_item + ' +' + (r.lines - 1) + ' more' : r.first_item;
  return (
    <PhoneRow
      onClick={onOpen}
      on={open || checked}
      lead={
        <NoRowTap className="pt-0.5">
          <Checkbox checked={checked} onChange={onCheck} label={'Select order ' + r.number} />
        </NoRowTap>
      }
      end={
        <NoRowTap className="-mr-1 -mt-1">
          <Menu items={menu} label={'Actions for order ' + r.number} />
        </NoRowTap>
      }
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-semibold">{r.number}</span>
        <span className="num shrink-0 text-[14px] font-semibold">{money(r.total, r.currency)}</span>
      </span>
      <span className="mt-0.5 block truncate text-[13px] text-[var(--so-ink-2)]">
        {(r.buyer_name || 'No name') + ', ' + item}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ShopChip name={r.shop.name} platform={r.shop.platform} className="max-w-[160px]" />
        <OrderStatus status={r.status} health={r.health} />
        <span className="whitespace-nowrap text-[13px]">
          <ShipInfo r={r} inline />
        </span>
        {r.payment !== 'paid' && <span className="text-[12px] text-[var(--so-muted)]">{PAYMENT_LABEL[r.payment] ?? r.payment}</span>}
        {r.unlinked && <Pill tone="warn">SKU not in catalog</Pill>}
        {r.task !== null && <TaskBadge task={r.task} />}
      </span>
    </PhoneRow>
  );
}

function OrderTr({ r, open, checked, onCheck, onOpen, menu }: { r: OrderRow; open: boolean; checked: boolean; onCheck: (v: boolean) => void; onOpen: () => void; menu: MenuItem[] }): React.JSX.Element {
  const muted = 'block text-[12px] text-[var(--so-muted)]';
  return (
    <Tr onClick={onOpen} on={open || checked}>
      <td
        className="w-10 cursor-pointer pl-3"
        onClick={(e) => {
          e.stopPropagation();
          onCheck(!checked);
        }}
      >
        <Checkbox checked={checked} onChange={onCheck} label={'Select order ' + r.number} />
      </td>
      <Td className="py-2">
        <span className="block whitespace-nowrap text-[14px] font-semibold">{r.number}</span>
        <ShopChip name={r.shop.name} platform={r.shop.platform} className="mt-1 max-w-[180px]" />
      </Td>
      <Td className="max-w-[180px] py-2">
        {r.buyer_name !== '' ? <span className="block truncate font-medium">{r.buyer_name}</span> : <span className={muted}>No name</span>}
      </Td>
      <Td className="max-w-[260px] py-2">
        <span className="block truncate">{r.first_item || 'No items'}</span>
        {(r.lines > 1 || r.units > 1) && <span className={muted}>{r.lines > 1 ? '+' + (r.lines - 1) + ' more, ' + plural(r.units, 'unit') : plural(r.units, 'unit')}</span>}
        {r.unlinked && (
          <Pill tone="warn" className="mt-1">
            SKU not in catalog
          </Pill>
        )}
      </Td>
      <Td className="whitespace-nowrap py-2">
        <span className="block">{dayShort(r.placed_at)}</span>
        <span className={muted}>{time(r.placed_at)}</span>
      </Td>
      <Td className="whitespace-nowrap py-2">
        <ShipInfo r={r} />
      </Td>
      <Td align="right" className="whitespace-nowrap py-2">
        <span className="block font-semibold">{money(r.total, r.currency)}</span>
        {r.payment !== 'paid' && <span className={muted}>{PAYMENT_LABEL[r.payment] ?? r.payment}</span>}
      </Td>
      <Td className="py-2">
        <OrderStatus status={r.status} health={r.health} />
        {r.task !== null && (
          <span className="mt-1 block">
            <TaskBadge task={r.task} />
          </span>
        )}
      </Td>
      <td className="w-12 pr-2" onClick={(e) => e.stopPropagation()}>
        <Menu items={menu} label={'Actions for order ' + r.number} />
      </td>
    </Tr>
  );
}

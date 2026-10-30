/**
 * Overview: what needs you and how money moves, across every shop.
 *
 *   greeting and range
 *   four figures (net sales highlighted, orders, profit, margin)
 *   the sales chart (this period against the previous one) | what needs you
 *   recent orders                                          | best sellers
 *   sales by shop (stacked bars and each shop's figures)
 *
 * A new store opens on setup instead: the business, then the first shop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Boxes, ChevronLeft, ChevronRight, CircleCheck, Coins, Link2Off, ListChecks, MessageSquare, Package, Percent, Plus, Receipt, Rocket, ShoppingBag, Sparkles, Store, Tag, TrendingUp, Upload, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { bucketLabel, bucketLong, dayShort, greeting, money, moneyCompact, num, pct, plural, time } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import type { Home, Overview, Range, Settings } from '../lib/types.ts';
import { OrderStatus } from '../components/badges.tsx';
import { Legend, SalesChart, SERIES_COLORS, Sparkline, StackedBars } from '../components/Charts.tsx';
import { PlatformMark, ShopChip } from '../components/PlatformMark.tsx';
import { openAddShop, openAgent } from '../components/Shell.tsx';
import { Button, Card, CardHeader, Delta, Empty, Field, IconBadge, IconButton, PhoneList, PhoneRow, Segmented, Select, Skeleton, Td, Th, Tr, TextInput, Tip } from '../components/ui.tsx';

const RANGES: { key: Range; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '12m', label: '12m' },
];
const RANGE_WORDS: Record<Range, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days', '12m': 'last 12 months' };

function rangeStored(): Range {
  try {
    const v = window.localStorage.getItem('so-range');
    if (v === '7d' || v === '30d' || v === '90d' || v === '12m') return v;
  } catch {
    /* default */
  }
  return '30d';
}

/* ------------------------------------------------------------- onboarding */

function SetUp({ settings }: { settings: Settings }): React.JSX.Element {
  const { catalog } = useStore();
  const [name, setName] = useState(settings.business_name);
  const [owner, setOwner] = useState(settings.owner_name);
  const [country, setCountry] = useState(settings.country || 'MY');
  const [cur, setCur] = useState(settings.base_currency || 'MYR');
  const [busy, setBusy] = useState(false);
  const countries = catalog?.countries ?? [];
  const currencies = catalog?.currencies ?? [];
  const save = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      let tz = '';
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        tz = '';
      }
      await op('settings.update', { business_name: name.trim(), owner_name: owner.trim(), country, base_currency: cur, timezone: tz, onboarded: true });
      changed('settings', 'shops');
    } catch {
      /* the notice says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[620px] pt-6">
      <Card className="p-6 sm:p-8">
        <IconBadge icon={Store} tone="ink" size={44} />
        <h1 className="mt-4 text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">Set up your store</h1>
        <p className="mt-1 text-[13px] text-[var(--so-muted)]">Prices, costs and reports use your base currency; each shop keeps its own.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Business name" className="sm:col-span-2">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" />
          </Field>
          <Field label="Your name">
            <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="What we call you" />
          </Field>
          <Field label="Country">
            <Select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                const c = countries.find((x) => x.code === e.target.value);
                if (c) setCur(c.currency);
              }}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Base currency" hint="Cannot change once products have prices" className="sm:col-span-2">
            <Select value={cur} onChange={(e) => setCur(e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <Button iconRight={ArrowRight} loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FirstShop(): React.JSX.Element {
  const { catalog, settings } = useStore();
  const local = (catalog?.platforms ?? []).filter((p) => p.id !== 'direct' && p.id !== 'other' && (p.regions.includes(settings?.country ?? '') || p.regions.includes('*'))).slice(0, 7);
  return (
    <Card className="so-rise mb-5 overflow-hidden p-0">
      <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
        <div className="p-6">
          <IconBadge icon={Rocket} tone="accent" size={40} />
          <h2 className="mt-4 text-[15px] font-semibold">Add your first shop</h2>
          <p className="mt-1 max-w-md text-[13px] leading-5 text-[var(--so-muted)]">Open a new shop with a step-by-step checklist, or bring in one you already run. Your AI agent can sync it for you.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button icon={Plus} onClick={openAddShop}>
              Add a shop
            </Button>
            <Button variant="secondary" icon={Package} onClick={() => go('orders', 'to_ship')}>
              Take a direct order
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap content-center gap-2 p-6 lg:pl-0">
          {local.map((p) => (
            <button key={p.id} type="button" onClick={openAddShop} className="so-press inline-flex h-10 items-center gap-2 rounded-full bg-[var(--so-tile)] pl-1.5 pr-4 text-[13px] font-semibold hover:bg-[var(--so-tile-hover)]">
              <PlatformMark platform={p.id} size={28} onCard={false} />
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- figures */

/** What the profit figure leaves out, in one line for a tooltip. */
function profitNote(r: Overview): string {
  const parts: string[] = [];
  if (r.quality.orders_missing_cost > 0) parts.push(plural(r.quality.orders_missing_cost, 'order') + ' with a product that has no cost (counted as free)');
  if (r.fees_estimated_share > 0) parts.push(r.fees_estimated_share + '% of fees estimated from shop fee rates');
  if (r.quality.orders_without_ship_cost > 0) parts.push(plural(r.quality.orders_without_ship_cost, 'order') + ' without your shipping cost');
  return 'Profit may be high: ' + parts.join('; ') + '.';
}

function Figure({ label, value, delta, icon, hero = false, sub, invert = false, deltaSuffix, warn = '' }: { label: string; value: string; delta: number | null | undefined; icon: LucideIcon; hero?: boolean; sub: string; invert?: boolean; deltaSuffix?: string; warn?: string }): React.JSX.Element {
  return (
    <section className={cn('so-rise flex min-h-[148px] flex-col justify-between rounded-[20px] p-5', hero ? 'so-hero' : 'bg-[var(--so-card)]')}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('flex items-center gap-1.5 text-[14px] font-medium', hero ? 'text-white/90' : 'text-[var(--so-ink-2)]')}>
          {label}
          {warn !== '' && (
            <Tip text={warn}>
              <AlertTriangle size={14} className="text-[var(--so-amber)]" aria-label={warn} />
            </Tip>
          )}
        </p>
        <IconBadge icon={icon} tone={hero ? 'onAccent' : 'tile'} size={36} />
      </div>
      <div>
        <p className="num truncate text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">{value}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <Delta value={delta} onAccent={hero} invert={invert} {...(deltaSuffix !== undefined ? { suffix: deltaSuffix } : {})} />
          <span className={cn('truncate text-[12px]', hero ? 'text-white/80' : 'text-[var(--so-muted)]')}>{sub}</span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- sales chart */

type Metric = 'net' | 'profit' | 'orders';

function SalesCard({ report, range, onRange }: { report: Overview; range: Range; onRange: (r: Range) => void }): React.JSX.Element {
  const [metric, setMetric] = useState<Metric>('net');
  const cur = report.currency;
  const k = metric === 'net' ? report.kpis.net_sales : metric === 'profit' ? report.kpis.profit : report.kpis.orders;
  const points = report.series.map((s) => ({
    key: s.key,
    label: bucketLabel(s.key, report.monthly),
    long: bucketLong(s.key, report.monthly),
    value: metric === 'net' ? s.net : metric === 'profit' ? s.profit : s.orders,
    prev: metric === 'net' ? s.prev_net : 0,
  }));
  const fmt = metric === 'orders' ? (v: number): string => num(Math.round(v)) : (v: number): string => moneyCompact(v, cur);
  const empty = report.series.every((s) => s.orders === 0);
  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Sales report</h2>
          <p className="text-[12px] text-[var(--so-muted)]">{metric === 'net' ? 'Net sales' : metric === 'profit' ? 'Profit' : 'Orders'} across every shop, {RANGE_WORDS[range]}</p>
        </div>
        <Segmented
          value={metric}
          onChange={setMetric}
          items={[
            { key: 'net', label: 'Net sales' },
            { key: 'profit', label: 'Profit' },
            { key: 'orders', label: 'Orders' },
          ]}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="num text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">{metric === 'orders' ? num(k.value ?? 0) : money(k.value ?? 0, cur)}</p>
        <div className="flex items-center gap-2 pb-1">
          <Delta value={k.delta_pct} />
          <span className="text-[12px] text-[var(--so-muted)]">vs the period before</span>
        </div>
        {metric === 'net' && (
          <Legend
            className="ml-auto pb-1.5"
            items={[
              { color: 'var(--so-chart-1)', label: 'This period' },
              { color: 'var(--so-chart-3)', label: 'Period before', dashed: true },
            ]}
          />
        )}
      </div>
      <div className="mt-3 flex min-h-[260px] flex-1 flex-col">
        {empty ? (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[16px] bg-[var(--so-tile)]">
            <Empty icon={TrendingUp} title="No sales in this period">Orders from every shop add up here.</Empty>
          </div>
        ) : (
          <SalesChart points={points} format={fmt} valueName={metric === 'orders' ? 'orders' : 'this period'} prevName={metric === 'net' ? 'period before' : ''} rows={(i) => (metric !== 'orders' ? <p className="text-[var(--so-tooltip-muted)]">{plural(report.series[i]?.orders ?? 0, 'order')}</p> : null)} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={range} onChange={onRange} items={RANGES} />
        {report.fees_estimated_share > 0 && metric === 'profit' && (
          <Tip text="Fees come from each shop's fee rates until the platform's real fees are imported or synced.">
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--so-muted)]">
              <AlertTriangle size={13} /> {report.fees_estimated_share}% of fees estimated
            </span>
          </Tip>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- needs you */

interface Need {
  key: string;
  icon: LucideIcon;
  label: string;
  count: number;
  sub?: string;
  bad?: boolean;
  to: string;
  tone: 'bad' | 'warn' | 'accent' | 'tile';
}

function NeedsYou({ home }: { home: Home }): React.JSX.Element {
  const a = home.attention;
  const needs: Need[] = (
    [
      { key: 'ship', icon: Package, label: 'Orders to ship', count: a.to_ship, sub: a.late > 0 ? a.late + ' late' : a.due_soon > 0 ? a.due_soon + ' due today' : '', bad: a.late > 0, to: href('orders', a.late > 0 ? 'at_risk' : 'to_ship'), tone: a.late > 0 ? 'bad' : 'accent' },
      { key: 'msg', icon: MessageSquare, label: 'Buyer messages', count: a.messages_open, sub: a.messages_overdue > 0 ? a.messages_overdue + ' overdue' : a.drafts_ready > 0 ? a.drafts_ready + ' drafts ready' : '', bad: a.messages_overdue > 0, to: href('inbox', 'due'), tone: a.messages_overdue > 0 ? 'bad' : 'accent' },
      { key: 'appr', icon: ListChecks, label: 'Approvals', count: a.approvals, sub: 'From your AI agent', to: href('approvals', 'pending'), tone: 'accent' },
      { key: 'exc', icon: AlertTriangle, label: 'Delivery problems', count: a.exceptions, bad: true, to: href('orders', 'exceptions'), tone: 'bad' },
      { key: 'unpaid', icon: Receipt, label: 'Waiting for payment', count: a.unpaid, to: href('orders', 'unpaid'), tone: 'warn' },
      { key: 'issues', icon: Tag, label: 'Listing issues', count: a.listing_issues, to: href('products', 'issues'), tone: 'warn' },
      { key: 'stock', icon: Boxes, label: 'Low or out of stock', count: a.low_stock + a.out_of_stock, sub: a.out_of_stock > 0 ? a.out_of_stock + ' out' : '', to: href('products', a.out_of_stock > 0 ? 'out' : 'low'), tone: a.out_of_stock > 0 ? 'bad' : 'warn' },
      { key: 'push', icon: Upload, label: 'Stock to set on shops', count: a.stock_to_push, to: href('products', 'push'), tone: 'tile' },
      { key: 'cost', icon: Coins, label: 'Products missing a cost', count: a.missing_cost_products, sub: 'Profit is incomplete', to: href('products', 'missing_cost'), tone: 'tile' },
      { key: 'sku', icon: Link2Off, label: 'Order lines without a SKU', count: a.unlinked_lines, to: href('orders', 'to_ship'), tone: 'tile' },
    ] as Need[]
  ).filter((n) => n.count > 0);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Needs you"
        subtitle={needs.length === 0 ? 'Nothing waiting' : plural(needs.length, 'thing') + ' to look at'}
        action={
          a.tasks_open > 0 ? (
            <button type="button" onClick={() => openAgent('tasks')} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--so-accent-soft)] px-2.5 text-[12px] font-semibold text-[var(--so-accent-text)] hover:brightness-95">
              <span className="so-breathe size-1.5 rounded-full bg-[var(--so-accent)]" />
              {plural(a.tasks_open, 'task')} with your AI agent
            </button>
          ) : undefined
        }
      />
      {needs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-[16px] bg-[var(--so-tile)] py-8 text-center">
          <IconBadge icon={CircleCheck} tone="good" size={44} />
          <p className="mt-3 text-[14px] font-semibold">All clear</p>
          <p className="text-[12px] text-[var(--so-muted)]">Every order, message and listing is in order.</p>
        </div>
      ) : (
        <ul className="-mx-2 flex-1 space-y-0.5">
          {needs.map((n) => (
            <li key={n.key}>
              <a href={n.to} className="flex items-center gap-3 rounded-[14px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
                <IconBadge icon={n.icon} tone={n.tone} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{n.label}</span>
                  {n.sub !== undefined && n.sub !== '' && <span className={cn('block truncate text-[12px]', n.bad ? 'font-semibold text-[var(--so-red-text)]' : 'text-[var(--so-muted)]')}>{n.sub}</span>}
                </span>
                <span className="num text-[15px] font-semibold">{num(n.count)}</span>
                <ChevronRight size={16} className="text-[var(--so-faint)]" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- recent orders */

function RecentOrders({ home }: { home: Home }): React.JSX.Element {
  const rows = home.recent_orders;
  return (
    <Card flush className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[15px] font-semibold">Recent orders</h2>
          <p className="text-[12px] text-[var(--so-muted)]">The latest from every shop</p>
        </div>
        <Button variant="secondary" size="sm" iconRight={ArrowRight} onClick={() => go('orders', 'all')}>
          All orders
        </Button>
      </div>
      {rows.length === 0 ? (
        <Empty icon={ShoppingBag} title="No orders yet" action={<Button size="sm" icon={Plus} onClick={() => go('orders', 'to_ship')}>Add an order</Button>}>
          Orders from every shop land here.
        </Empty>
      ) : (
        <div className="relative mt-3 overflow-x-auto px-2 pb-2">
          <PhoneList label="Recent orders">
            {rows.map((o) => (
              <PhoneRow key={o.id} onClick={() => go('orders', 'all', o.id)}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[14px] font-semibold">{o.number}</span>
                  <span className="num shrink-0 text-[14px] font-semibold">{money(o.total, o.currency)}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-[var(--so-muted)]">
                  <span className="min-w-0 truncate">{(o.first_item || 'Order') + (o.lines > 1 ? ' +' + (o.lines - 1) + ' more' : '')}</span>
                  <span className="shrink-0">{dayShort(o.placed_at)}, {time(o.placed_at)}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <ShopChip name={o.shop.name} platform={o.shop.platform} className="max-w-[180px]" />
                  <OrderStatus status={o.status} health={o.health} />
                </span>
              </PhoneRow>
            ))}
          </PhoneList>
          <table className="hidden w-full min-w-[620px] border-collapse sm:table">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Item</Th>
                <Th>Date</Th>
                <Th align="right">Total</Th>
                <Th>Shop</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <Tr key={o.id} onClick={() => go('orders', 'all', o.id)}>
                  <Td className="font-semibold">{o.number}</Td>
                  <Td className="max-w-[220px]">
                    <span className="block truncate">{o.first_item || 'Order'}</span>
                    {o.lines > 1 && <span className="text-[12px] text-[var(--so-muted)]">+{o.lines - 1} more</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-[var(--so-ink-2)]">
                    {dayShort(o.placed_at)}, {time(o.placed_at)}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {money(o.total, o.currency)}
                  </Td>
                  <Td>
                    <ShopChip name={o.shop.name} platform={o.shop.platform} />
                  </Td>
                  <Td>
                    <OrderStatus status={o.status} health={o.health} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ best sellers */

function BestSellers({ report }: { report: Overview }): React.JSX.Element {
  const top = report.top_products;
  const [i, setI] = useState(0);
  const swipe = useRef(Number.NaN);
  useEffect(() => {
    if (i >= top.length) setI(0);
  }, [top.length, i]);
  const cur = top[i];
  const at = (k: number): (typeof top)[number] | undefined => (top.length === 0 ? undefined : top[(k + top.length) % top.length]);
  return (
    <Card className="flex h-full flex-col bg-[var(--so-card)]">
      <CardHeader title="Best sellers" subtitle={'Most units sold, ' + RANGE_WORDS[report.range]} />
      {cur === undefined ? (
        <div className="flex flex-1 items-center justify-center rounded-[16px] bg-[var(--so-tile)]">
          <Empty icon={Sparkles} title="No sales yet">Your best sellers show here.</Empty>
        </div>
      ) : (
        <div className="flex flex-1 flex-col rounded-[16px] bg-[var(--so-tile)] p-4">
          <div
            className="relative flex flex-1 touch-pan-y items-center justify-center py-2"
            onPointerDown={(e) => {
              swipe.current = e.clientX;
            }}
            onPointerUp={(e) => {
              const dx = e.clientX - swipe.current;
              swipe.current = Number.NaN;
              if (top.length > 1 && Math.abs(dx) > 40) setI((i + (dx < 0 ? 1 : -1) + top.length) % top.length);
            }}
          >
            {top.length > 1 && (
              <>
                <Thumb image={at(i - 1)?.image ?? ''} className="absolute left-0 top-1/2 size-24 -translate-y-1/2 sm:size-28" />
                <Thumb image={at(i + 1)?.image ?? ''} className="absolute right-0 top-1/2 size-24 -translate-y-1/2 sm:size-28" />
              </>
            )}
            <Thumb image={cur.image} className="relative z-[1] size-36 shadow-[0_20px_40px_-20px_var(--so-shadow)] sm:size-40" main />
            {top.length > 1 && (
              <>
                <IconButton icon={ChevronLeft} label="Previous" variant="card" size={32} className="absolute left-1 top-1/2 z-[2] -translate-y-1/2" onClick={() => setI((i - 1 + top.length) % top.length)} />
                <IconButton icon={ChevronRight} label="Next" variant="card" size={32} className="absolute right-1 top-1/2 z-[2] -translate-y-1/2" onClick={() => setI((i + 1) % top.length)} />
              </>
            )}
          </div>
          <a href={cur.product ? href('product', cur.product) : undefined} className={cn('mt-3 block text-center', cur.product && 'hover:underline')}>
            <span className="block truncate text-[14px] font-semibold">{cur.title}</span>
          </a>
          <p className="text-center text-[12px] text-[var(--so-muted)]">
            {plural(cur.units, 'sold', 'sold')}, {money(cur.net, report.currency, { whole: true })}
          </p>
          {top.length > 1 && (
            <div className="mt-2 flex justify-center">
              {top.map((t, k) => (
                <button key={t.title + k} type="button" aria-label={'Show ' + t.title} onClick={() => setI(k)} className="-my-[9px] flex h-6 items-center px-1">
                  <span className={cn('h-1.5 rounded-full transition-[width] duration-300', k === i ? 'w-4 bg-[var(--so-ink)]' : 'w-1.5 bg-[var(--so-faint)]')} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Thumb({ image, className, main = false }: { image: string; className?: string; main?: boolean }): React.JSX.Element {
  return (
    <span className={cn('flex items-center justify-center overflow-hidden rounded-[18px] bg-[var(--so-card)]', !main && 'opacity-70', className)}>
      {image !== '' ? <img src={image} alt="" className="size-full object-cover" /> : <Package size={main ? 36 : 24} className="text-[var(--so-faint)]" strokeWidth={1.6} />}
    </span>
  );
}

/* -------------------------------------------------------------- by shop */

function ByShop({ report }: { report: Overview }): React.JSX.Element {
  const shops = [...report.shops].sort((a, b) => b.net - a.net);
  const colors = useMemo(() => {
    const out: Record<string, string> = {};
    shops.forEach((s, i) => {
      out[s.id] = SERIES_COLORS[i % SERIES_COLORS.length] ?? 'var(--so-chart-3)';
    });
    return out;
  }, [shops]);
  const groups = report.series.map((s) => ({ key: s.key, label: bucketLabel(s.key, report.monthly), long: bucketLong(s.key, report.monthly), parts: shops.map((sh) => ({ id: sh.id, name: sh.name, value: s.by_shop[sh.id] ?? 0 })) }));
  const total = shops.reduce((n, s) => n + s.net, 0);
  return (
    <Card>
      <CardHeader title="Sales by shop" subtitle={'Net sales per shop, ' + RANGE_WORDS[report.range]} action={<Legend items={shops.slice(0, 6).map((s) => ({ color: colors[s.id] ?? 'var(--so-chart-3)', label: s.name }))} className="hidden md:flex" />} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>{total === 0 ? <div className="flex h-[220px] items-center justify-center rounded-[16px] bg-[var(--so-tile)] text-[13px] text-[var(--so-muted)]">No sales yet</div> : <StackedBars groups={groups} colors={colors} format={(v) => moneyCompact(v, report.currency)} />}</div>
        <ul className="-mx-2 space-y-0.5">
          {shops.map((s) => (
            <li key={s.id}>
              <a href={href('shop', s.id)} className="flex items-center gap-3 rounded-[14px] px-2 py-2 hover:bg-[var(--so-row-hover)]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: colors[s.id] }} />
                <PlatformMark platform={s.platform} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{s.name}</span>
                  <span className="block text-[12px] text-[var(--so-muted)]">
                    {plural(s.orders, 'order')}
                    {s.margin !== null ? ', ' + pct(s.margin) + ' margin' : ''}
                  </span>
                </span>
                <Sparkline values={s.spark} width={72} height={24} tone={s.net > 0 ? 'accent' : 'muted'} className="hidden sm:block" />
                <span className="w-[96px] text-right">
                  <span className="num block text-[14px] font-semibold">{money(s.net, report.currency, { whole: true })}</span>
                  <Delta value={s.delta_pct} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export function OverviewPage(): React.JSX.Element {
  const { settings, shops } = useStore();
  const [range, setRangeState] = useState<Range>(rangeStored);
  const setRange = (r: Range): void => {
    setRangeState(r);
    try {
      window.localStorage.setItem('so-range', r);
    } catch {
      /* the choice still applies now */
    }
  };
  const home = useLive<Home>('home:' + range, (signal) => op<Home>('app.home', { range }, { signal, quiet: true }), ['orders', 'order_lines', 'shipments', 'threads', 'proposals', 'listings', 'products', 'variants', 'stock_moves', 'shops', 'settings', 'tasks', 'activity'], [range]);
  if (settings === null) return <Loading />;
  if (settings.base_currency === '') return <SetUp settings={settings} />;
  const h = home.data;
  const r = h?.report ?? null;
  const onlyDirect = shops.every((s) => s.platform === 'direct');
  const name = settings.owner_name.trim();
  const live = shops.filter((s) => s.platform !== 'direct').length;
  return (
    <div>
      <header className="so-rise mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">
            {greeting()}
            {name !== '' ? ', ' + name : ''}!
          </h1>
          <p className="mt-1 text-[13px] text-[var(--so-muted)]">Here is what is happening across {live === 0 ? 'your store' : live === 1 ? 'your shop' : 'your ' + live + ' shops'} today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Plus} onClick={() => go('orders', 'to_ship')}>
            New order
          </Button>
          <Button variant="secondary" icon={Store} onClick={openAddShop}>
            Add shop
          </Button>
        </div>
      </header>
      {onlyDirect && <FirstShop />}
      {h === null || r === null ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure hero label="Net sales" value={money(r.kpis.net_sales.value ?? 0, r.currency)} delta={r.kpis.net_sales.delta_pct} icon={Wallet} sub={RANGE_WORDS[range]} />
            <Figure label="Orders" value={num(r.kpis.orders.value ?? 0)} delta={r.kpis.orders.delta_pct} icon={ShoppingBag} sub={plural(r.kpis.units.value ?? 0, 'unit') + ' sold'} />
            <Figure
              label="Profit"
              value={money(r.kpis.profit.value ?? 0, r.currency)}
              delta={r.kpis.profit.delta_pct}
              icon={TrendingUp}
              sub={r.quality.orders_missing_cost > 0 ? plural(r.quality.orders_missing_cost, 'order') + ' missing a cost' : 'Avg order ' + money(r.kpis.aov.value ?? 0, r.currency, { whole: true })}
              warn={r.quality.orders_missing_cost > 0 || r.fees_estimated_share > 0 ? profitNote(r) : ''}
            />
            <Figure label="Margin" value={r.kpis.margin.value === null ? 'No sales' : pct(r.kpis.margin.value)} delta={r.kpis.margin.delta_pct} deltaSuffix=" pts" icon={Percent} sub={r.kpis.refunds.value ? money(r.kpis.refunds.value, r.currency, { whole: true }) + ' refunded' : 'No refunds'} />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <SalesCard report={r} range={range} onRange={setRange} />
            </div>
            <div className="xl:col-span-4">
              <NeedsYou home={h} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <RecentOrders home={h} />
            </div>
            <div className="xl:col-span-4">
              <BestSellers report={r} />
            </div>
          </div>
          <ByShop report={r} />
          {r.unconverted > 0 && (
            <p className="text-[12px] text-[var(--so-muted)]">
              {plural(r.unconverted, 'order')} in a currency without an exchange rate today {r.unconverted === 1 ? 'is' : 'are'} left out of these totals.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Loading(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[148px] rounded-[20px] bg-[var(--so-card)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Skeleton className="h-[380px] rounded-[20px] bg-[var(--so-card)] xl:col-span-8" />
        <Skeleton className="h-[380px] rounded-[20px] bg-[var(--so-card)] xl:col-span-4" />
      </div>
    </div>
  );
}

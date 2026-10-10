/**
 * Home: the stockroom at a glance. The greeting with search and the two
 * main actions; then the health of the stock (the ring), what it is worth,
 * what needs attention, the last 30 days of stock in and out, what is coming,
 * what is used most, where it is kept, and the latest changes. A first-time
 * checklist leads through setting up until items and reorder points exist.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  Check,
  ClipboardCheck,
  FileUp,
  History,
  PackagePlus,
  Plus,
  ScanBarcode,
  ShoppingCart,
  Store,
  Truck,
  Warehouse,
} from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { FlowBars, RankBars, SplitBar } from '../components/charts.tsx';
import { LevelBar, SearchBox } from '../components/controls.tsx';
import { Donut } from '../components/Donut.tsx';
import type { DonutSlice } from '../components/Donut.tsx';
import { useItemEditor } from '../components/ItemEditor.tsx';
import { StockMapCard } from '../components/map/StockMap.tsx';
import { BatchCard, groupBatches } from '../components/rows.tsx';
import { useStockChange } from '../components/StockChange.tsx';
import { Card, CardHeader, CircleButton, Empty, PillButton, StatusPill, TextLink } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dayLabel } from '../lib/dates.ts';
import { money, plural, qty } from '../lib/format.ts';
import { ItemThumb } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { segmentColor } from '../lib/palette.ts';
import { navigate } from '../lib/router.ts';
import type { Dashboard } from '../lib/types.ts';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatusLine({ d }: { d: Dashboard }): React.JSX.Element | null {
  const reading = d.documents.waiting + d.documents.reading;
  const late = d.incoming.counts.late;
  if (reading === 0 && d.documents.failed === 0 && d.counting === 0 && late === 0) return null;
  return (
    <div className="iv-rise flex flex-wrap items-center gap-2">
      {reading > 0 && (
        <button type="button" onClick={() => navigate('orders')}>
          <StatusPill tone="info" pulse>
            {plural(reading, 'document')} with your AI agent
          </StatusPill>
        </button>
      )}
      {d.documents.failed > 0 && (
        <button type="button" onClick={() => navigate('orders')}>
          <StatusPill tone="bad">{plural(d.documents.failed, 'document')} could not be read</StatusPill>
        </button>
      )}
      {late > 0 && (
        <button type="button" onClick={() => navigate('orders')}>
          <StatusPill tone="bad">{plural(late, 'order')} late</StatusPill>
        </button>
      )}
      {d.counting > 0 && (
        <button type="button" onClick={() => navigate('counts')}>
          <StatusPill tone="warn">{plural(d.counting, 'count')} in progress</StatusPill>
        </button>
      )}
    </div>
  );
}

function SetupCard({ d }: { d: Dashboard }): React.JSX.Element | null {
  const editor = useItemEditor();
  if (d.setup.items && d.setup.reorder_points) return null;
  const steps: { done: boolean; title: string; text: string; icon: LucideIcon; action: React.JSX.Element }[] = [
    {
      done: d.setup.locations,
      title: 'Add your places',
      text: 'Rooms, shelves, bins or vans: wherever stock is kept.',
      icon: Warehouse,
      action: (
        <PillButton variant="dark" icon={Plus} dot onClick={() => navigate('locations')}>
          Add places
        </PillButton>
      ),
    },
    {
      done: d.setup.items,
      title: 'Add your items',
      text: 'One by one, or import a spreadsheet you already have.',
      icon: PackagePlus,
      action: (
        <span className="flex flex-wrap gap-2">
          <PillButton variant="dark" icon={Plus} dot onClick={(e) => editor.create(e.currentTarget)}>
            New item
          </PillButton>
          <PillButton variant="light" icon={FileUp} onClick={() => navigate('data')} className="bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]">
            Import
          </PillButton>
        </span>
      ),
    },
    {
      done: d.setup.reorder_points,
      title: 'Set reorder points',
      text: 'The level where an item counts as low, so nothing runs out.',
      icon: ShoppingCart,
      action: (
        <PillButton variant="dark" icon={ArrowUpRight} dot onClick={() => navigate('items')}>
          Open items
        </PillButton>
      ),
    },
    {
      done: d.setup.suppliers,
      title: 'Add suppliers',
      text: 'Reorders become draft purchase orders, one per supplier.',
      icon: Store,
      action: (
        <PillButton variant="dark" icon={Plus} dot onClick={() => navigate('suppliers')}>
          Add suppliers
        </PillButton>
      ),
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card tone="sand" delay={1}>
      <CardHeader title="Set up your stockroom" subtitle={`${doneCount} of ${steps.length} done. Your AI agent can do any of these for you in chat, too.`} />
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const current = i === next;
          return (
            <li key={s.title} className={cn('flex flex-col gap-3 rounded-[22px] p-4', current ? 'bg-[var(--iv-card)]' : 'bg-[var(--iv-card)]/55')}>
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full',
                    s.done ? 'bg-[var(--iv-solid)] text-[var(--iv-on-solid)]' : current ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] text-[var(--iv-ink-2)]',
                  )}
                >
                  {s.done ? <Check size={16} strokeWidth={3} aria-label="Done" /> : <Icon size={16} aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold">{s.title}</span>
                  <span className="block text-[13px] text-[var(--iv-ink-2)]">{s.text}</span>
                </span>
              </div>
              {!s.done && current && <div>{s.action}</div>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function healthSlices(d: Dashboard): DonutSlice[] {
  const total = d.status.ok + d.status.low + d.status.out + d.status.over;
  const share = (n: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);
  const rows: { key: string; label: string; value: number; fill: string; text: string }[] = [
    { key: 'ok', label: 'In stock', value: d.status.ok, fill: 'var(--iv-green)', text: 'var(--iv-on-green)' },
    { key: 'low', label: 'Low', value: d.status.low, fill: 'var(--iv-amber)', text: 'var(--iv-on-amber)' },
    { key: 'out', label: 'Out', value: d.status.out, fill: 'var(--iv-red)', text: 'var(--iv-on-red)' },
    { key: 'over', label: 'Over', value: d.status.over, fill: 'var(--iv-ink-2)', text: 'var(--iv-shell)' },
  ];
  return rows.filter((r) => r.value > 0).map((r) => ({ ...r, amount: qty(r.value), share: share(r.value) }));
}

export function HomePage(): React.JSX.Element {
  const { currency } = useApp();
  const change = useStockChange();
  const editor = useItemEditor();
  const [q, setQ] = useState('');
  const dash = useLive(() => api.dashboard(), ['items', 'stock', 'movements', 'orders', 'order_lines', 'counts', 'documents', 'locations', 'suppliers', 'settings', 'codes'], []);
  const d = dash.data;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const batches = d !== null ? groupBatches(d.recent).slice(0, 4) : [];

  const search = (v: string): void => {
    if (v === '') return;
    api
      .lookup(v)
      .then((hit) => {
        if (hit.type === 'item') navigate('item', { id: hit.item.id });
        else if (hit.type === 'location') navigate('locations', { id: hit.location.id });
        else navigate('items', { q: v });
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="iv-rise mb-1 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{greeting()}</h1>
          <p className="mt-1 text-[13px] text-[var(--iv-muted)]">{dateLine}. Here is your stockroom.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={q} onChange={setQ} onEnter={search} placeholder="Find an item or scan a code" ariaLabel="Find an item" className="hidden w-72 lg:block" />
          <PillButton variant="light" icon={PackagePlus} onClick={(e) => editor.create(e.currentTarget)} className="hidden sm:inline-flex">
            New item
          </PillButton>
          <PillButton variant="dark" icon={Plus} dot onClick={(e) => change.open(e.currentTarget)} className="hidden md:inline-flex">
            Stock change
          </PillButton>
        </div>
      </header>

      {d !== null && <StatusLine d={d} />}
      {d !== null && <SetupCard d={d} />}

      {/* The stockroom in 3D, across the full width, above health and value. */}
      <StockMapCard />

      {d !== null && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-5">
            {/* Stock health ring */}
            <Card tone="sand" className="order-1 lg:order-none" delay={1}>
              <CardHeader
                title="Stock health"
                subtitle={d.totals.items === 0 ? 'No items yet' : `${qty(d.totals.units)} units on hand. Pick a slice to see those items.`}
                action={<CircleButton icon={ArrowUpRight} label="Open items" variant="dark" size={36} onClick={() => navigate('items')} />}
              />
              <div className="flex flex-col-reverse items-center gap-6 md:flex-row md:items-center md:justify-between">
                <div className="w-full md:max-w-[260px]">
                  {d.totals.items === 0 ? (
                    <p className="text-[13px] text-[var(--iv-ink-2)]">Add items and this ring shows how many are in stock, running low, out, or over their target level.</p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {[
                        { key: 'ok', label: 'In stock', n: d.status.ok, fill: 'var(--iv-green)' },
                        { key: 'low', label: 'Low', n: d.status.low, fill: 'var(--iv-amber)' },
                        { key: 'out', label: 'Out of stock', n: d.status.out, fill: 'var(--iv-red)' },
                        { key: 'over', label: 'Overstocked', n: d.status.over, fill: 'var(--iv-ink-2)' },
                      ].map((s) => (
                        <li key={s.key}>
                          <button type="button" onClick={() => navigate('items', { status: s.key })} className="flex w-full items-center gap-3 rounded-full py-0.5 text-left">
                            <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: s.fill }} />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.label}</span>
                            <span className="num text-[13px] font-bold">{qty(s.n)}</span>
                          </button>
                        </li>
                      ))}
                      {d.reorder > 0 && (
                        <li className="pt-1">
                          <TextLink onClick={() => navigate('reorder')}>{plural(d.reorder, 'item')} to reorder</TextLink>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <Donut
                  slices={healthSlices(d)}
                  centerValue={qty(d.totals.items)}
                  centerCaption={d.totals.items === 1 ? 'item' : 'items'}
                  size={300}
                  onPick={(key) => navigate('items', { status: key })}
                  chips={[
                    { icon: ScanBarcode, label: 'Scan', onClick: () => navigate('scan') },
                    { icon: ShoppingCart, label: 'Reorder', onClick: () => navigate('reorder') },
                    { icon: ClipboardCheck, label: 'Count stock', onClick: () => navigate('counts') },
                  ]}
                />
              </div>
            </Card>

            {/* In and out, last 30 days */}
            <Card className="order-4 lg:order-none" delay={2}>
              <CardHeader
                title="Stock in and out"
                subtitle={d.in_30d + d.out_30d > 0 ? `${qty(d.in_30d)} in and ${qty(d.out_30d)} out over the last 30 days` : 'The last 30 days'}
                action={
                  <div className="hidden items-center gap-3 text-[12px] font-semibold text-[var(--iv-ink-2)] sm:flex">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-[var(--iv-accent)]" /> In
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-[var(--iv-ink)]" /> Out
                    </span>
                  </div>
                }
              />
              <FlowBars days={d.days} height={190} onPick={(day) => navigate('activity', { from: day, to: day })} />
            </Card>

            {/* Latest changes */}
            <Card className="order-7 lg:order-none" delay={4}>
              <CardHeader
                title="Recent activity"
                action={
                  <button type="button" onClick={(e) => change.open(e.currentTarget.querySelector('span[data-plus]'))} className="inline-flex items-center gap-2.5 text-[13px] font-semibold">
                    Stock change
                    <span data-plus className="flex size-8 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
                      <Plus size={16} strokeWidth={2.4} aria-hidden />
                    </span>
                  </button>
                }
              />
              {batches.length === 0 ? (
                <Empty icon={History} title="Nothing recorded yet">
                  Stock coming in, going out and moving between places shows up here, with an Undo for each change.
                </Empty>
              ) : (
                <div className="flex flex-col gap-2">
                  {batches.map((b) => (
                    <BatchCard key={b[0]?.batch} rows={b} />
                  ))}
                  <div className="pt-2 text-center">
                    <TextLink tone="muted" onClick={() => navigate('activity')}>
                      See all activity
                    </TextLink>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
            {/* Value */}
            <Card tone="dark" className="order-2 lg:order-none" delay={2}>
              <CardHeader title="Stock value" dark subtitle="At average cost" />
              <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(d.totals.value, currency)}</p>
              <p className="mt-1 text-[13px] text-[var(--iv-on-dark-muted)]">
                {qty(d.totals.units)} units across {plural(d.totals.items, 'item')} in {plural(d.totals.locations, 'place')}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => navigate('reorder')} className="rounded-[18px] bg-[var(--iv-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
                  <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">To reorder</span>
                  <span className="num block text-[15px] font-bold">{plural(d.reorder, 'item')}</span>
                </button>
                <div className="rounded-[18px] bg-[var(--iv-dark-2)] p-3" title={`${plural(d.idle.items, 'item')} with stock nobody touched for 90 days`}>
                  <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">Idle 90 days</span>
                  <span className="num block text-[15px] font-bold">{money(d.idle.value, currency, true)}</span>
                </div>
              </div>
            </Card>

            {/* Needs attention */}
            <Card className="order-3 lg:order-none" delay={3}>
              <CardHeader title="Needs attention" subtitle={d.attention.length > 0 ? 'Out of stock or at the reorder point' : 'Nothing is low right now'} />
              {d.attention.length === 0 ? (
                <Empty icon={Check} title="All stocked up">
                  Items show here when they drop to their reorder point.
                </Empty>
              ) : (
                <>
                  <ul className="flex flex-col gap-2">
                    {d.attention.map((it) => (
                      <li key={it.id}>
                        <button type="button" onClick={() => navigate('item', { id: it.id })} className="flex w-full items-center gap-3 rounded-[18px] bg-[var(--iv-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--iv-row-hover)]">
                          <ItemThumb photo={it.photo} icon={it.icon} size={38} tone="card" rounded="rounded-[12px]" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13px] font-bold">{it.name}</span>
                              <span className="num shrink-0 text-[13px] font-bold">
                                {qty(it.on_hand)} <span className="font-medium text-[var(--iv-muted)]">/ {qty(it.min_qty)}</span>
                              </span>
                            </span>
                            <LevelBar onHand={it.on_hand} min={it.min_qty} max={it.max_qty} status={it.status} className="mt-2" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
                    <PillButton variant="soft" icon={ShoppingCart} onClick={() => navigate('reorder')}>
                      Reorder
                    </PillButton>
                    {d.reorder > 0 && <AskAgent trigger="restock_review" label="Ask your AI agent" />}
                  </div>
                </>
              )}
            </Card>

            {/* Coming in */}
            <Card className="order-5 lg:order-none" delay={3}>
              <CardHeader
                title="Coming in"
                subtitle={d.incoming.counts.ordered + d.incoming.counts.partial > 0 ? `${plural(d.incoming.counts.ordered + d.incoming.counts.partial, 'open order')}` : 'Nothing on order'}
                action={<CircleButton icon={Truck} label="Purchase orders" variant="row" size={36} onClick={() => navigate('orders')} />}
              />
              {d.incoming.orders.length === 0 ? (
                <p className="text-[13px] text-[var(--iv-ink-2)]">Orders you place show here until they arrive.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {d.incoming.orders.map((o) => (
                    <li key={o.id}>
                      <button type="button" onClick={() => navigate('order', { id: o.id })} className="flex w-full flex-col gap-2 rounded-[18px] bg-[var(--iv-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--iv-row-hover)]">
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-bold">
                            {o.number} · {o.supplier?.name ?? 'No supplier'}
                          </span>
                          <span className={cn('shrink-0 text-[12px] font-semibold', o.late ? 'text-[var(--iv-red-text)]' : 'text-[var(--iv-muted)]')}>
                            {o.expected_on !== '' ? (o.late ? `Late, ${dayLabel(o.expected_on)}` : dayLabel(o.expected_on)) : 'No date'}
                          </span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-[var(--iv-line)]">
                          <span className="block h-full rounded-full bg-[var(--iv-ink)]" style={{ width: `${Math.max(3, o.progress * 100)}%` }} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Most used */}
            {d.movers.length > 0 && (
              <Card className="order-6 lg:order-none" delay={4}>
                <CardHeader title="Most used" subtitle="Out over the last 30 days" />
                <RankBars
                  rows={d.movers.map((m) => ({
                    key: m.id,
                    label: m.name,
                    value: m.used,
                    valueText: `${qty(m.used)} ${m.unit}`,
                    lead: <ItemThumb photo={m.photo} icon={m.icon} size={32} tone="row" rounded="rounded-[10px]" />,
                    onClick: () => navigate('item', { id: m.id }),
                  }))}
                />
              </Card>
            )}

            {/* Where it is */}
            {d.places.length > 0 && d.totals.units > 0 && (
              <Card className="order-8 lg:order-none" delay={5}>
                <CardHeader
                  title="Where it is"
                  subtitle={d.totals.value > 0 ? 'Stock value by place' : 'Units by place'}
                  action={<CircleButton icon={Warehouse} label="Locations" variant="row" size={36} onClick={() => navigate('locations')} />}
                />
                <SplitBar
                  parts={d.places.slice(0, 6).map((p, i) => ({
                    key: p.id,
                    label: p.name,
                    value: d.totals.value > 0 ? p.value : p.units,
                    valueText: d.totals.value > 0 ? money(p.value, currency, true) : `${qty(p.units)} units`,
                    fill: segmentColor(i, false).fill,
                    onClick: () => navigate('locations', { id: p.id }),
                  }))}
                />
                {d.places.length > 6 && <p className="mt-3 text-[12px] text-[var(--iv-muted)]">and {plural(d.places.length - 6, 'more place')}</p>}
              </Card>
            )}
          </div>
        </div>
      )}
      {d === null && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <span className="h-[360px] animate-pulse rounded-[24px] bg-[var(--iv-sand)] lg:col-span-8" />
          <span className="h-[360px] animate-pulse rounded-[24px] bg-[var(--iv-card)] lg:col-span-4" />
        </div>
      )}
    </div>
  );
}


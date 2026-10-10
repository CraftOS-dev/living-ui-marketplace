/**
 * One item: how many there are and where, its stock level over 90 days,
 * reordering (with a one-step draft order), its codes and label, and its
 * history with Undo. In, Out, Move and Set open the stock change screen.
 */
import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardCheck,
  History,
  Minus,
  MoveRight,
  PackageX,
  Pencil,
  Plus,
  QrCode as QrIcon,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Code128 } from '../components/Barcode.tsx';
import { LevelChart } from '../components/charts.tsx';
import { LevelBar, Menu, StatusBadge } from '../components/controls.tsx';
import { useItemEditor } from '../components/ItemEditor.tsx';
import { BatchCard, groupBatches } from '../components/rows.tsx';
import { useStockChange } from '../components/StockChange.tsx';
import type { ChangeMode } from '../components/StockChange.tsx';
import { Card, CardHeader, CircleButton, Empty, PillButton, StatusPill, TextLink, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, dayLabel } from '../lib/dates.ts';
import { money, plain, plural, qty, unitCost } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import type { ItemDetail } from '../lib/types.ts';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-[18px] bg-[var(--iv-dark-2)] p-3">
      <span className="block text-[12px] text-[var(--iv-on-dark-muted)]">{label}</span>
      <span className="num block truncate text-[15px] font-bold">{value}</span>
      {hint !== undefined && <span className="block truncate text-[12px] text-[var(--iv-on-dark-muted)]">{hint}</span>}
    </div>
  );
}

function ReorderCard({ it }: { it: ItemDetail }): React.JSX.Element {
  const { currency } = useApp();
  const [busy, setBusy] = useState(false);
  const draft = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.createOrders([{ item: it.id, qty: plain(it.reorder_qty) }]);
      const o = r.orders[0];
      toast.success(o !== undefined ? `On draft ${o.number}` : 'Added to a draft order');
      if (o !== undefined) navigate('order', { id: o.id });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const drafts = it.open_lines.filter((l) => l.order.status === 'draft');
  return (
    <Card tone="sand" delay={3}>
      <CardHeader title="Reorder" subtitle={it.min_qty > 0 ? `Low at ${qty(it.min_qty)} ${it.unit}${it.max_qty > 0 ? `, fill up to ${qty(it.max_qty)}` : ''}` : 'No reorder point set'} />
      {it.min_qty === 0 ? (
        <p className="text-[13px] text-[var(--iv-ink-2)]">Set a reorder point (Edit) and this item turns low before it runs out, and shows up on the Reorder page.</p>
      ) : it.reorder_qty > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px]">
            Suggested order: <span className="num font-bold">{qty(it.reorder_qty)} {it.unit}</span>
            {it.unit_cost_e4 > 0 && <span className="text-[var(--iv-muted)]"> · {money(Math.round(it.reorder_qty * it.unit_cost_e4), currency)}</span>}
          </p>
          {drafts.length > 0 ? (
            <TextLink onClick={() => navigate('order', { id: drafts[0]?.order.id ?? '' })}>Already on draft {drafts[0]?.order.number}</TextLink>
          ) : (
            <PillButton variant="dark" icon={ShoppingCart} dot loading={busy} onClick={() => void draft()} className="self-start">
              Add to a draft order
            </PillButton>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--iv-ink-2)]">{it.incoming > 0 ? `Enough is on its way (${qty(it.incoming)} ${it.unit} incoming).` : 'Stock is above the reorder point.'}</p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <div>
          <dt className="text-[12px] text-[var(--iv-muted)]">Supplier</dt>
          <dd className="truncate font-semibold">{it.supplier !== null ? <TextLink onClick={() => navigate('suppliers', { id: it.supplier?.id ?? '' })}>{it.supplier.name}</TextLink> : 'None'}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--iv-muted)]">Lead time</dt>
          <dd className="font-semibold">{it.lead_time_days > 0 ? plural(it.lead_time_days, 'day') : 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--iv-muted)]">Cost per unit</dt>
          <dd className="num font-semibold">{it.unit_cost_e4 > 0 ? unitCost(it.unit_cost, currency) : 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--iv-muted)]">Used per day</dt>
          <dd className="num font-semibold">{it.usage_per_day > 0 ? `${qty(it.usage_per_day)} ${it.unit}` : 'No recent use'}</dd>
        </div>
      </dl>
      {it.open_lines.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {it.open_lines.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => navigate('order', { id: l.order.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--iv-card)] px-3 py-2 text-left text-[13px]">
                <Truck size={15} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {l.order.number} · {l.order.status === 'draft' ? 'draft' : l.order.expected_on !== '' ? `due ${dayLabel(l.order.expected_on)}` : 'ordered'}
                </span>
                <span className="num font-bold">{qty(l.remaining)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ItemPage({ id }: { id: string }): React.JSX.Element {
  const { currency } = useApp();
  const change = useStockChange();
  const editor = useItemEditor();
  const [confirmEl, confirm] = useConfirm();
  const live = useLive(() => api.item(id), ['items', 'stock', 'movements', 'codes', 'order_lines', 'orders', 'categories', 'suppliers', 'locations'], [id]);
  const it = live.data;

  if (it === null) {
    return live.error !== null ? (
      <Card>
        <Empty icon={PackageX} title="This item is gone" action={<PillButton variant="dark" onClick={() => navigate('items')}>Back to items</PillButton>}>
          It may have been deleted.
        </Empty>
      </Card>
    ) : (
      <div className="flex flex-col gap-5">
        <span className="h-16 w-80 animate-pulse rounded-full bg-[var(--iv-card)]" />
        <span className="h-64 animate-pulse rounded-[24px] bg-[var(--iv-dark)]" />
      </div>
    );
  }

  const open = (el: Element, mode: ChangeMode, location?: string): void => change.open(el, { item: it, mode, ...(location !== undefined ? { location } : {}) });
  const archive = async (): Promise<void> => {
    try {
      await api.setArchived([it.id], !it.archived);
      toast.success(it.archived ? 'Restored' : 'Archived. It no longer shows in lists or reorders.');
    } catch {
      /* toasted */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      const p = await api.deleteItem(it.id, true);
      const parts = [p.on_hand !== 0 ? `${qty(p.on_hand)} ${it.unit} in stock` : null, p.history_entries > 0 ? `${p.history_entries} history entries` : null, p.order_lines > 0 ? `${p.order_lines} order lines` : null].filter(
        (x) => x !== null,
      );
      const ok = await confirm(`"${it.name}" is deleted${parts.length > 0 ? ` with its ${parts.join(', ')}` : ''}. Archiving keeps the history instead.`, 'Delete this item?');
      if (!ok) return;
      await api.deleteItem(it.id);
      toast.success('Deleted');
      navigate('items');
    } catch {
      /* toasted */
    }
  };
  const batches = groupBatches(it.recent);

  return (
    <div className="flex flex-col gap-5">
      <header className="iv-rise flex flex-wrap items-center gap-4">
        <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={() => back('items')} />
        <ItemThumb photo={it.photo_large} icon={it.icon} size={64} tone="card" rounded="rounded-[20px]" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{it.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-[var(--iv-muted)]">
            <span className="num">{it.sku}</span>
            {it.category !== null && <span>· {it.category.name}</span>}
            <StatusBadge status={it.status} />
            {it.archived && <StatusPill tone="neutral">Archived</StatusPill>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillButton variant="light" icon={Pencil} onClick={(e) => editor.edit(e.currentTarget, it)}>
            Edit
          </PillButton>
          <Menu
            items={[
              { label: 'Print a label', icon: QrIcon, onClick: () => navigate('labels', { items: it.id }) },
              { label: 'Count this item', icon: ClipboardCheck, onClick: () => navigate('counts', { item: it.id }) },
              { label: 'Full history', icon: History, onClick: () => navigate('activity', { item: it.id }) },
              { label: it.archived ? 'Restore' : 'Archive', icon: it.archived ? ArchiveRestore : Archive, onClick: () => void archive() },
              { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove() },
            ]}
          />
          <PillButton variant="dark" icon={Plus} dot onClick={(e) => open(e.currentTarget, 'in')}>
            Stock change
          </PillButton>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-5">
          {/* On hand */}
          <Card tone="dark" className="order-1 lg:order-none" delay={1}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-[var(--iv-on-dark-muted)]">On hand{it.places > 1 ? ` in ${it.places} places` : ''}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{qty(it.on_hand)}</span>
                  <span className="text-[15px] font-semibold text-[var(--iv-on-dark-muted)]">{it.unit}</span>
                </p>
                <p className="num mt-1 text-[13px] text-[var(--iv-on-dark-muted)]">Worth {money(it.value, currency)}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    { mode: 'in', label: 'In', icon: Plus },
                    { mode: 'out', label: 'Out', icon: Minus },
                    { mode: 'move', label: 'Move', icon: MoveRight },
                    { mode: 'set', label: 'Set', icon: RefreshCw },
                  ] as const
                ).map((b) => {
                  const Icon = b.icon;
                  return (
                    <button
                      key={b.mode}
                      type="button"
                      onClick={(e) => open(e.currentTarget, b.mode)}
                      disabled={(b.mode === 'out' || b.mode === 'move') && it.on_hand <= 0}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-[18px] px-3 py-2.5 text-[12px] font-semibold transition-transform active:scale-95 disabled:opacity-35',
                        b.mode === 'in' ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]' : 'bg-[var(--iv-dark-2)] text-[var(--iv-on-dark)]',
                      )}
                    >
                      <Icon size={18} strokeWidth={2.2} aria-hidden />
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <LevelBar onHand={it.on_hand} min={it.min_qty} max={it.max_qty} status={it.status} dark className="mt-5" />
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Incoming" value={it.incoming > 0 ? `${qty(it.incoming)} ${it.unit}` : 'None'} />
              <Stat label="Reorder at" value={it.min_qty > 0 ? qty(it.min_qty) : 'Not set'} />
              <Stat label="Target level" value={it.max_qty > 0 ? qty(it.max_qty) : 'Not set'} />
              <Stat label="Lasts about" value={it.days_left !== null ? plural(it.days_left, 'day') : 'No recent use'} />
            </div>
          </Card>

          {/* Level over time */}
          <Card className="order-3 lg:order-none" delay={2}>
            <CardHeader
              title="Stock level"
              subtitle={`Last ${it.series.length} days · ${qty(it.in_30d)} in and ${qty(it.out_30d)} out in the last 30`}
              action={it.last_counted !== null ? <span className="text-[12px] text-[var(--iv-muted)]">Counted {ago(it.last_counted)}</span> : undefined}
            />
            <LevelChart series={it.series} min={it.min_qty} unit={it.unit} />
          </Card>

          {/* History */}
          <Card className="order-6 lg:order-none" delay={3}>
            <CardHeader title="History" action={batches.length > 0 ? <TextLink tone="muted" onClick={() => navigate('activity', { item: it.id })}>See all</TextLink> : undefined} />
            {batches.length === 0 ? (
              <Empty icon={History} title="No changes yet">
                Every change to this item's stock shows here, with an Undo.
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.slice(0, 8).map((b) => (
                  <BatchCard key={b[0]?.batch} rows={b} showItem={false} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
          {/* Where it is */}
          <Card className="order-2 lg:order-none" delay={2}>
            <CardHeader title="Where it is" subtitle={it.default_location !== null ? `Home: ${it.default_location.path}` : 'No home location'} />
            {it.stock.length === 0 ? (
              <p className="text-[13px] text-[var(--iv-ink-2)]">Not stocked anywhere. Record stock coming in with In.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {it.stock.map((s) => {
                  const Icon = kindIcon(s.location.kind);
                  return (
                    <li key={s.location.id} className="group flex items-center gap-3 rounded-[18px] bg-[var(--iv-row)] px-3 py-2.5">
                      <button type="button" onClick={() => navigate('locations', { id: s.location.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--iv-card)]">
                          <Icon size={15} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{s.location.name}</span>
                          <span className="block truncate text-[12px] text-[var(--iv-muted)]">{s.location.path}</span>
                        </span>
                      </button>
                      <span className="num text-[15px] font-bold">{qty(s.qty)}</span>
                      <button
                        type="button"
                        aria-label={`Move from ${s.location.name}`}
                        title="Move from here"
                        onClick={(e) => open(e.currentTarget, 'move', s.location.id)}
                        className="flex size-8 items-center justify-center rounded-full bg-[var(--iv-card)] hover:bg-[var(--iv-row-hover)]"
                      >
                        <MoveRight size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="order-4 lg:order-none">
            <ReorderCard it={it} />
          </div>

          {/* Codes and label */}
          <Card className="order-5 lg:order-none" delay={4}>
            <CardHeader title="Codes and label" action={<CircleButton icon={QrIcon} label="Print a label" variant="row" size={36} onClick={() => navigate('labels', { items: it.id })} />} />
            <div className="rounded-[18px] bg-[var(--iv-paper)] p-4 text-[var(--iv-paper-ink)] ring-1 ring-[var(--iv-line)]">
              <p className="truncate text-[13px] font-bold">{it.name}</p>
              <Code128 value={it.sku} height={44} className="mt-2 h-12 w-full" />
              <p className="num mt-1 text-center text-[12px] font-semibold tracking-wider">{it.sku}</p>
            </div>
            {it.codes.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {it.codes.map((c) => (
                  <li key={c.id} className="num rounded-full bg-[var(--iv-row)] px-3 py-1.5 text-[12px] font-semibold">
                    {c.code}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[12px] text-[var(--iv-muted)]">Scan the product's own barcode in Edit to add it, so either code finds this item.</p>
            )}
          </Card>

          {/* Details */}
          {(it.description !== '' || it.fractional) && (
            <Card className="order-7 lg:order-none" delay={5}>
              <CardHeader title="Details" />
              {it.description !== '' && <p className="whitespace-pre-line text-[14px] leading-[22px]">{it.description}</p>}
              {it.fractional && <p className="mt-2 text-[12px] text-[var(--iv-muted)]">Counted in part units ({it.unit}).</p>}
            </Card>
          )}
          {live.data !== null && it.status === 'low' && (
            <p className="order-8 flex items-center gap-2 px-2 text-[12px] text-[var(--iv-muted)] lg:order-none">
              <Sparkles size={13} aria-hidden /> Your AI agent can draft the reorder: ask it in chat, or use the Reorder page.
            </p>
          )}
        </div>
      </div>
      {confirmEl}
    </div>
  );
}

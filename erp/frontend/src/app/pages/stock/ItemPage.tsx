/**
 * One item: how much there is and where, what it is worth, what is coming
 * and promised, its stock level over 90 days against the reorder point, every
 * move with the record behind it, open orders, prices, and its activity.
 * "Stock change" opens the stock change screen with this item in it.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Archive, ArchiveRestore, ArrowLeftRight, ClipboardCheck, Factory, History, Minus, PackageX, Pencil, Plus, ShoppingCart, Trash2, Truck, Warehouse as WarehouseIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { Menu } from '../../components/controls.tsx';
import { ItemThumb } from '../../components/stock/icons.tsx';
import { useItemEditor } from '../../components/stock/ItemEditor.tsx';
import { ItemStatusPill, KIND_LABEL, LevelBar, LevelChart, MoveRow } from '../../components/stock/parts.tsx';
import { useStockChange } from '../../components/stock/StockChangeScreen.tsx';
import { dropFlag } from '../../components/stock/url.ts';
import type { ChangeMode } from '../../components/stock/StockChangeScreen.tsx';
import { DOC_TYPE_LABEL } from '../../components/status.ts';
import { Pager } from '../../components/table.tsx';
import { Card, CardHeader, CircleButton, Empty, LoadError, PageHeader, PageSkeleton, PillButton, Skeleton, TextLink, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { ItemDetail, MoveList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

const MOVES_PAGE = 12;

export function ItemPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const currency = baseCurrency(me);
  useSection('item', 'items');
  const live = useLive(() => op<ItemDetail>('items.get', { item: id }, { quiet: true }), [...READS.stock, 'item_categories', 'documents', 'document_lines', 'parties', 'taxes', 'boms'], [id]);
  const it = live.data;
  // ?edit=1 (from Reorder's "set a supplier") opens the editor; closing it drops the flag.
  const wantsEdit = query.get('edit') !== null;
  const editor = useItemEditor({
    onClosed: () => {
      dropFlag('item', 'edit');
    },
  });
  const change = useStockChange();
  const [confirmEl, confirm] = useConfirm();
  const loaded = it !== null;
  useEffect(() => {
    if (wantsEdit && it !== null && it.can.edit) editor.edit(null, it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsEdit, loaded]);

  if (it === null) {
    if (live.error !== null) {
      return (
        <div>
          <PageHeader title="Item" back={() => back('items')} />
          {live.loading ? <PageSkeleton /> : <LoadError message={live.error} onRetry={live.reload} />}
        </div>
      );
    }
    return <PageSkeleton />;
  }

  const stock = it.kind === 'stock';
  const canChange = it.can.adjust && stock && !it.archived;
  const openChange = (el: Element | null, mode: ChangeMode, warehouse?: string): void => change.open(el, { item: it.id, mode, ...(warehouse !== undefined ? { warehouse } : {}) });

  const archive = async (): Promise<void> => {
    try {
      await op('items.archive', { items: [it.id], archived: !it.archived });
      toast.success(it.archived ? 'Restored' : 'Archived. It no longer shows in lists or reorders.');
      live.reload();
    } catch {
      /* shown */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await op('items.delete', { item: it.id, preview: true });
    } catch {
      return; // the refusal (history) was shown
    }
    if (!(await confirm(`${it.name} is deleted for good. It has no history, so nothing else changes.`, 'Delete this item?'))) return;
    try {
      await op('items.delete', { item: it.id });
      toast.success('Deleted');
      navigate('items');
    } catch {
      /* shown */
    }
  };

  return (
    <div>
      <PageHeader
        back={() => back('items')}
        eyebrow={
          <>
            <span className="num">{it.sku}</span>
            {it.category !== null && <span>· {it.category.name}</span>}
            <ItemStatusPill status={it.status} kind={it.kind} archived={it.archived} size="sm" />
          </>
        }
        title={it.name}
        actions={
          <>
            {it.can.edit && (
              <PillButton variant="light" icon={Pencil} onClick={(e) => editor.edit(e.currentTarget, it)}>
                Edit
              </PillButton>
            )}
            <Menu
              items={[
                { label: 'New build', icon: Factory, hidden: !it.bom || !can(me, 'manufacturing', 'edit'), onClick: () => navigate('builds', { new: '1', item: it.id }) },
                { label: 'Stock on hand', icon: WarehouseIcon, hidden: !stock, onClick: () => navigate('stock', { q: it.sku }) },
                { label: it.archived ? 'Restore' : 'Archive', icon: it.archived ? ArchiveRestore : Archive, hidden: !it.can.edit, onClick: () => void archive() },
                { label: 'Delete', icon: Trash2, danger: true, hidden: !it.can.edit, onClick: () => void remove() },
              ]}
            />
            {canChange && (
              <PillButton icon={Plus} dot onClick={(e) => openChange(e.currentTarget, 'in')}>
                Stock change
              </PillButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        {/* On a phone the cards interleave: stock first, then where it is and what is coming. */}
        <div className="contents @min-[900px]:col-span-8 @min-[900px]:flex @min-[900px]:flex-col @min-[900px]:gap-5">
          <div className="order-1 @min-[900px]:order-none">{stock ? <OnHandCard it={it} currency={currency} canChange={canChange} onChange={openChange} /> : <PriceHero it={it} currency={currency} />}</div>

          {stock && (
            <Card delay={2} className="order-4 @min-[900px]:order-none">
              <CardHeader title="Stock level" subtitle={`Last 90 days${it.used_30d > 0 ? ` · ${qty(it.used_30d)} ${it.unit} used in the last 30` : ' · no use in the last 30 days'}`} />
              <LevelChart series={it.history} min={it.min_qty} unit={it.unit} />
            </Card>
          )}

          {stock && (
            <div className="order-5 @min-[900px]:order-none">
              <MovesCard itemId={it.id} unit={it.unit} currency={currency} />
            </div>
          )}
        </div>

        <div className="contents @min-[900px]:col-span-4 @min-[900px]:flex @min-[900px]:flex-col @min-[900px]:gap-5">
          {stock && (
            <Card delay={2} className="order-2 @min-[900px]:order-none">
              <CardHeader title="By warehouse" subtitle={it.stock.length === 0 ? 'Not stocked anywhere' : plural(it.stock.length, 'warehouse')} icon={WarehouseIcon} />
              {it.stock.length === 0 ? (
                <p className="text-[13px] text-[var(--erp-ink-2)]">No stock yet. Record what comes in with a stock change or a goods receipt.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {it.stock.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
                      <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)] text-[12px] font-bold">{s.code.slice(0, 3)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{s.name}</span>
                        <span className="mt-1.5 block">
                          <span className="block h-1.5 rounded-full bg-[var(--erp-line)]">
                            <span className="erp-grow-x block h-1.5 rounded-full bg-[var(--erp-ink)]" style={{ width: `${Math.max(4, it.on_hand > 0 ? (s.qty / it.on_hand) * 100 : 0)}%` }} />
                          </span>
                        </span>
                      </span>
                      <span className="num text-right">
                        <span className="block text-[15px] font-bold">{qty(s.qty)}</span>
                        <span className="block text-[12px] text-[var(--erp-muted)]">{it.unit}</span>
                      </span>
                      {canChange && (
                        <CircleButton icon={ArrowLeftRight} label={`Transfer from ${s.name}`} variant="light" size={32} onClick={(e) => openChange(e.currentTarget, 'transfer', s.id)} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card delay={3} className="order-3 @min-[900px]:order-none">
            <CardHeader title="Open orders" subtitle={it.open_lines.length === 0 ? 'Nothing coming or promised' : `${qty(it.incoming)} coming · ${qty(it.committed)} promised`} icon={Truck} />
            {it.open_lines.length === 0 ? (
              <p className="text-[13px] text-[var(--erp-ink-2)]">Purchase orders still to receive and sales orders still to deliver show here.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {it.open_lines.map((l) => (
                  <li key={`${l.id}-${l.type}`}>
                    <button type="button" onClick={() => navigate('doc', { id: l.id })} className="flex w-full items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', l.type === 'purchase_order' ? 'bg-[var(--erp-accent-soft)]' : 'bg-[var(--erp-card)]')}>
                        {l.type === 'purchase_order' ? <ShoppingCart size={15} aria-hidden /> : <Truck size={15} aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">
                          {DOC_TYPE_LABEL[l.type] ?? l.type} {l.number}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                          {l.party}
                          {l.expected !== '' ? ` · due ${dayLabel(l.expected)}` : ` · ${dayLabel(l.date)}`}
                        </span>
                      </span>
                      <span className="num text-right text-[14px] font-bold">
                        {l.type === 'purchase_order' ? '+' : '−'}
                        {qty(l.open)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="order-6 @min-[900px]:order-none">
            <PricesCard it={it} currency={currency} />
          </div>

          <RecordActivity entity="items" refId={it.id} className="order-7 @min-[900px]:order-none" />
        </div>
      </div>
      {editor.node}
      {change.node}
      {confirmEl}
    </div>
  );
}

function OnHandCard({ it, currency, canChange, onChange }: { it: ItemDetail; currency: string; canChange: boolean; onChange: (el: Element | null, mode: ChangeMode) => void }): React.JSX.Element {
  const actions: { mode: ChangeMode; label: string; icon: LucideIcon }[] = [
    { mode: 'in', label: 'In', icon: Plus },
    { mode: 'out', label: 'Out', icon: Minus },
    { mode: 'count', label: 'Count', icon: ClipboardCheck },
    { mode: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
  ];
  return (
    <Card tone="dark" delay={1}>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <ItemThumb photo={it.photo} icon={it.category?.icon} size={72} rounded="rounded-[20px]" tone="sand" />
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--erp-on-dark-muted)]">On hand{it.stock.length > 1 ? ` in ${it.stock.length} warehouses` : ''}</p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{qty(it.on_hand)}</span>
              <span className="text-[15px] font-semibold text-[var(--erp-on-dark-muted)]">{it.unit}</span>
            </p>
            <p className="num mt-0.5 text-[13px] text-[var(--erp-on-dark-muted)]">
              Worth {money(it.value, currency)} · {price(it.avg_cost, currency)} each
            </p>
          </div>
        </div>
        {canChange && (
          <div className="grid w-full grid-cols-4 gap-2 @min-[480px]:w-auto">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.mode}
                  type="button"
                  onClick={(e) => onChange(e.currentTarget, a.mode)}
                  disabled={(a.mode === 'out' || a.mode === 'transfer') && it.on_hand <= 0}
                  className={cn(
                    'flex min-w-[64px] flex-col items-center gap-1.5 rounded-[18px] px-3 py-2.5 text-[12px] font-semibold transition-transform active:scale-95 disabled:opacity-35',
                    a.mode === 'in' ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-dark-2)] text-[var(--erp-on-dark)]',
                  )}
                >
                  <Icon size={18} strokeWidth={2.2} aria-hidden />
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <LevelBar onHand={it.on_hand} min={it.min_qty} max={it.max_qty} status={it.status} dark className="mt-5" />
      <div className="mt-5 grid grid-cols-2 gap-2 @min-[480px]:grid-cols-4">
        <Stat label="Available" value={`${qty(it.available)} ${it.unit}`} hint="On hand less promised" alert={it.available < 0} />
        <Stat label="Incoming" value={it.incoming > 0 ? `${qty(it.incoming)} ${it.unit}` : 'None'} hint="On purchase orders" />
        <Stat label="Committed" value={it.committed > 0 ? `${qty(it.committed)} ${it.unit}` : 'None'} hint="On sales orders" />
        <Stat label="Lasts about" value={it.days_left !== null ? plural(it.days_left, 'day') : 'No recent use'} hint={it.min_qty > 0 ? `Reorder at ${qty(it.min_qty)}` : 'No reorder point'} />
      </div>
    </Card>
  );
}

function Stat({ label, value, hint, alert = false }: { label: string; value: string; hint: string; alert?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[18px] bg-[var(--erp-dark-2)] p-3">
      <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className={cn('num block truncate text-[15px] font-bold', alert && 'text-[var(--erp-red-on-dark)]')}>{value}</span>
      <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">{hint}</span>
    </div>
  );
}

/** A service or non-stock item: its prices are the headline. */
function PriceHero({ it, currency }: { it: ItemDetail; currency: string }): React.JSX.Element {
  return (
    <Card tone="dark" delay={1}>
      <div className="flex flex-wrap items-center gap-5">
        <ItemThumb photo={it.photo} icon={it.category?.icon} size={72} rounded="rounded-[20px]" tone="sand" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[var(--erp-on-dark-muted)]">{KIND_LABEL[it.kind]} · sold per {it.unit}</p>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{it.sale_price_e4 > 0 ? price(it.sale_price, currency) : 'No sale price'}</p>
          <p className="num text-[13px] text-[var(--erp-on-dark-muted)]">{it.purchase_price_e4 > 0 ? `Bought at ${price(it.purchase_price, currency)}` : 'No purchase price'}</p>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-[var(--erp-on-dark-muted)]">{it.kind === 'service' ? 'A service is not counted in stock.' : 'Non-stock goods are bought and sold without counting them.'}</p>
    </Card>
  );
}

function PricesCard({ it, currency }: { it: ItemDetail; currency: string }): React.JSX.Element {
  const sale = it.sale_price_e4;
  const cost = it.kind === 'stock' && it.on_hand > 0 ? Number(it.avg_cost) * 10000 : it.purchase_price_e4;
  const margin = sale > 0 && cost > 0 ? (sale - cost) / sale : null;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Sale price', value: sale > 0 ? `${price(it.sale_price, currency)}${it.sale_tax !== null ? ` + ${it.sale_tax.name}` : ''}` : 'Not set' },
    { label: 'Purchase price', value: it.purchase_price_e4 > 0 ? `${price(it.purchase_price, currency)}${it.purchase_tax !== null ? ` + ${it.purchase_tax.name}` : ''}` : 'Not set' },
  ];
  if (it.kind === 'stock') rows.push({ label: 'Average cost', value: price(it.avg_cost, currency) });
  if (margin !== null) rows.push({ label: 'Margin', value: <span className={cn(margin < 0 && 'text-[var(--erp-red-text)]')}>{Math.round(margin * 1000) / 10}%</span> });
  rows.push({ label: 'Supplier', value: it.supplier !== null ? <TextLink onClick={() => navigate('party', { id: it.supplier?.id ?? '', role: 'supplier' })}>{it.supplier.name}</TextLink> : 'None' });
  if (it.lead_time_days > 0) rows.push({ label: 'Lead time', value: plural(it.lead_time_days, 'day') });
  if (it.kind === 'stock') rows.push({ label: 'Reorder', value: it.min_qty > 0 ? `at ${qty(it.min_qty)}${it.max_qty > 0 ? `, up to ${qty(it.max_qty)}` : ''}` : 'Not set' });
  if (it.barcode !== '') rows.push({ label: 'Barcode', value: <span className="num">{it.barcode}</span> });
  if (it.income_account !== null) rows.push({ label: 'Income account', value: <TextLink onClick={() => navigate('account', { id: it.income_account?.id ?? '' })}>{`${it.income_account.code} ${it.income_account.name}`}</TextLink> });
  if (it.expense_account !== null) rows.push({ label: it.kind === 'stock' ? 'Cost account' : 'Expense account', value: <TextLink onClick={() => navigate('account', { id: it.expense_account?.id ?? '' })}>{`${it.expense_account.code} ${it.expense_account.name}`}</TextLink> });
  return (
    <Card tone="sand" delay={3}>
      <CardHeader title="Prices and buying" />
      <dl className="flex flex-col gap-2.5 text-[13px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[var(--erp-muted)]">{r.label}</dt>
            <dd className="num min-w-0 truncate text-right font-semibold">{r.value}</dd>
          </div>
        ))}
      </dl>
      {it.description !== '' && <p className="mt-4 whitespace-pre-line border-t border-[var(--erp-line)] pt-3 text-[13px] leading-5 text-[var(--erp-ink-2)]">{it.description}</p>}
    </Card>
  );
}

function MovesCard({ itemId, unit, currency }: { itemId: string; unit: string; currency: string }): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const moves = useLive(() => op<MoveList>('stock.moves', { item: itemId, limit: MOVES_PAGE, offset }, { quiet: true }), ['stock_moves'], [itemId, offset]);
  const d = moves.data;
  return (
    <Card delay={3}>
      <CardHeader title="Movements" subtitle={d !== null ? plural(d.total, 'move') : undefined} icon={History} />
      {d === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : d.moves.length === 0 ? (
        <Empty icon={PackageX} title="No movements yet" compact>
          Receipts, deliveries, builds and stock changes of this item show here.
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {d.moves.map((m) => (
              <MoveRow key={m.id} m={{ ...m, unit }} currency={currency} />
            ))}
          </ul>
          <Pager offset={offset} limit={MOVES_PAGE} total={d.total} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

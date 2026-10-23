/**
 * Reorder: every stock item whose on hand plus incoming, less what is
 * promised to customers, is at or below its reorder point, grouped by its
 * supplier. Each line says why in plain words and suggests a quantity that
 * fills it back to the target; change it, untick what you do not want, and
 * "Create purchase orders" drafts one order per supplier (never sent). Items
 * without a supplier are listed with a way to fix that.
 */
import { useMemo, useState } from 'react';
import { CircleCheck, PackageX, ShoppingCart, Store, Truck } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { AskAgent } from '../../components/AskAgent.tsx';
import { Stepper } from '../../components/controls.tsx';
import { ItemThumb } from '../../components/stock/icons.tsx';
import { Card, Empty, LoadError, Notice, PageHeader, PageSkeleton, PillButton, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { decimalsOf, money, normalizeNumber, plain, plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { ReorderGroup, ReorderLine, ReorderList, ReorderResult } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

interface Pick {
  qty: string;
  on: boolean;
}

/** What `q` units cost at the purchase price (unit_price is major-unit text), in minor units. */
function lineValue(l: ReorderLine, q: string, currency: string): number {
  return Math.round(Number(l.unit_price) * 10 ** decimalsOf(currency) * (Number(q) || 0));
}

export function ReorderPage({ query }: PageProps): React.JSX.Element {
  void query;
  const me = useMe();
  const canOrder = can(me, 'purchasing', 'edit');
  const live = useLive(() => op<ReorderList>('reorder.list', {}, { quiet: true }), [...READS.stock, 'documents', 'document_lines', 'parties'], []);
  const data = live.data;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const withSupplier = groups.filter((g) => g.supplier !== null);
  const orphans = groups.find((g) => g.supplier === null);
  const pickOf = (l: ReorderLine): Pick => picks[l.item.id] ?? { qty: plain(l.qty), on: true };
  const setPick = (id: string, p: Partial<Pick>, l: ReorderLine): void => setPicks((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { qty: plain(l.qty), on: true }), ...p } }));

  const chosen = (gs: ReorderGroup[]): { item: string; qty: string; value: number }[] => {
    const out: { item: string; qty: string; value: number }[] = [];
    for (const g of gs) {
      for (const l of g.items) {
        const p = pickOf(l);
        const n = normalizeNumber(p.qty, 3);
        if (!p.on || n === null || Number(n) <= 0) continue;
        out.push({ item: l.item.id, qty: n, value: lineValue(l, n, data?.currency ?? me.company.currency) });
      }
    }
    return out;
  };
  const all = chosen(withSupplier);
  const allValue = all.reduce((s, x) => s + x.value, 0);

  const create = async (gs: ReorderGroup[], key: string): Promise<void> => {
    const items = chosen(gs).map((x) => ({ item: x.item, qty: x.qty }));
    if (items.length === 0) return;
    setBusy(key);
    try {
      const r = await op<ReorderResult>('reorder.create-orders', { items });
      const first = r.orders[0];
      if (r.orders.length === 1 && first !== undefined) {
        toast.success(`${first.updated ? 'Updated' : 'Drafted'} ${first.number} for ${first.supplier}`);
        navigate('doc', { id: first.id });
      } else {
        toast.success(`${plural(r.orders.length, 'draft order')} ready to check and send`);
        navigate('purchase-orders', { status: 'draft' });
      }
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  if (data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <PageSkeleton rows={4} />;
  const currency = data.currency;
  const suppliers = withSupplier.length;

  return (
    <div>
      <PageHeader
        title="Reorder"
        subtitle={data.count > 0 ? <span className="num">{plural(data.count, 'item')} at or below the reorder point</span> : 'Nothing to reorder'}
        actions={
          data.count > 0 && canOrder ? (
            <>
              <AskAgent kind="reorder_review" label="Ask your AI agent" variant="light" />
              <PillButton icon={ShoppingCart} dot loading={busy === 'all'} disabled={all.length === 0} onClick={() => void create(withSupplier, 'all')}>
                Create purchase orders
              </PillButton>
            </>
          ) : undefined
        }
      />

      {data.count === 0 ? (
        <Card>
          <Empty icon={CircleCheck} title="Nothing to reorder" action={<PillButton variant="soft" onClick={() => navigate('items')}>Open items</PillButton>}>
            Items show up here when on hand plus what is on order drops to their reorder point. Give each item you never want to run out of a reorder point.
          </Empty>
        </Card>
      ) : (
        <>
          <Card tone="dark" className="mb-5" delay={1}>
            <div className="grid grid-cols-2 gap-4 @min-[640px]:grid-cols-4">
              <Fig label="To reorder" value={qty(data.count)} sub={plural(suppliers, 'supplier')} />
              {canOrder ? (
                <Fig label="Selected" value={qty(all.length)} sub={`${plural(all.length, 'line')} on ${plural(new Set(withSupplier.filter((g) => chosen([g]).length > 0).map((g) => g.supplier?.id)).size, 'order')}`} />
              ) : (
                <Fig label="Suppliers" value={qty(suppliers)} sub="Each gets one order" />
              )}
              <Fig label="Estimated cost" value={money(allValue, currency, 'short')} sub="At purchase prices" />
              <Fig label="No supplier" value={qty(orphans?.items.length ?? 0)} sub={orphans !== undefined ? 'Need a supplier first' : 'All set'} />
            </div>
            {canOrder && <p className="mt-4 text-[12px] text-[var(--erp-on-dark-muted)]">Orders are drafted, never sent: you check and send each one.</p>}
          </Card>

          {!canOrder && (
            <div className="mb-5">
              <Notice tone="neutral" icon={ShoppingCart}>
                Your role can see what to reorder; someone in purchasing turns it into orders.
              </Notice>
            </div>
          )}

          <div className="flex flex-col gap-5">
            {withSupplier.map((g, i) => {
              const sel = chosen([g]);
              const total = sel.reduce((s, x) => s + x.value, 0);
              return (
                <Card key={g.supplier?.id ?? i} delay={Math.min(5, i + 2)}>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="erp-on-ink flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-shell)]">
                      <Store size={18} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => navigate('party', { id: g.supplier?.id ?? '', role: 'supplier' })} className="block max-w-full truncate text-left text-[15px] font-bold hover:underline">
                        {g.supplier?.name}
                      </button>
                      <p className="truncate text-[13px] text-[var(--erp-muted)]">
                        {plural(g.items.length, 'item')}
                        {g.draft !== null && (
                          <>
                            {' · adds to draft '}
                            <TextLink onClick={() => navigate('doc', { id: g.draft?.id ?? '' })} className="!text-[13px]">
                              <span className="num">{g.draft.number}</span>
                            </TextLink>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="num text-right">
                      <span className="block text-[15px] font-bold">{money(total, currency)}</span>
                      <span className="block text-[12px] text-[var(--erp-muted)]">{plural(sel.length, 'line')}</span>
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {g.items.map((l) => (
                      <Line key={l.item.id} line={l} pick={pickOf(l)} currency={currency} editable={canOrder} onChange={(p) => setPick(l.item.id, p, l)} />
                    ))}
                  </ul>
                  {canOrder && (
                    <div className="mt-4 flex justify-end">
                      <PillButton variant="soft" icon={Truck} loading={busy === g.supplier?.id} disabled={sel.length === 0} onClick={() => void create([g], g.supplier?.id ?? '')}>
                        {g.draft !== null ? `Add to ${g.draft.number}` : 'Draft this order'}
                      </PillButton>
                    </div>
                  )}
                </Card>
              );
            })}

            {orphans !== undefined && (
              <Card tone="sand" delay={Math.min(5, withSupplier.length + 2)}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                    <PackageX size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-bold">No supplier yet</h2>
                    <p className="text-[13px] text-[var(--erp-ink-2)]">Orders go to an item's usual supplier. Set one and the item joins that supplier's order.</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2">
                  {orphans.items.map((l) => (
                    <li key={l.item.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-card)] px-3 py-2.5">
                      <ItemThumb photo={null} icon={l.item.icon} size={40} rounded="rounded-[12px]" />
                      <button type="button" onClick={() => navigate('item', { id: l.item.id })} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[14px] font-bold hover:underline">{l.item.name}</span>
                        <span className="num block truncate text-[12px] text-[var(--erp-muted)]">
                          {qty(l.on_hand)} {l.item.unit} on hand · reorder at {qty(l.min_qty)}
                        </span>
                      </button>
                      <TextLink onClick={() => navigate('item', { id: l.item.id, edit: '1' })}>Set a supplier</TextLink>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <span className="block text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{label}</span>
      <span className="num block text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{value}</span>
      <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">{sub}</span>
    </div>
  );
}

function Line({ line, pick, currency, editable, onChange }: { line: ReorderLine; pick: Pick; currency: string; editable: boolean; onChange: (p: Partial<Pick>) => void }): React.JSX.Element {
  const value = lineValue(line, pick.qty, currency);
  const stats: { label: string; short: string; value: string; tone?: 'red' | undefined }[] = [
    { label: 'On hand', short: 'On hand', value: qty(line.on_hand), ...(line.on_hand <= 0 ? { tone: 'red' as const } : {}) },
    { label: 'Coming', short: 'Coming', value: qty(line.incoming) },
    { label: 'Promised', short: 'Promised', value: qty(line.committed) },
    { label: 'Reorder at', short: 'Min', value: qty(line.min_qty) },
  ];
  return (
    <li className={cn('rounded-[20px] p-3 transition-colors', pick.on ? 'bg-[var(--erp-row)]' : 'bg-[var(--erp-row)]/40 text-[var(--erp-muted)]')}>
      <div className="flex flex-col gap-3 @min-[640px]:flex-row @min-[640px]:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {editable && <input type="checkbox" checked={pick.on} onChange={(e) => onChange({ on: e.target.checked })} aria-label={`Order ${line.item.name}`} className="size-4 shrink-0 accent-[var(--erp-ink)]" />}
          <ItemThumb photo={null} icon={line.item.icon} size={44} tone="card" />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => navigate('item', { id: line.item.id })} className="block max-w-full truncate text-left text-[14px] font-bold hover:underline">
              {line.item.name}
            </button>
            <span className="num block truncate text-[12px] text-[var(--erp-muted)]">
              {line.item.sku} · {price(line.unit_price, currency)} per {line.item.unit}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-1.5 @min-[640px]:w-[340px]">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[12px] bg-[var(--erp-card)] px-2 py-1.5 text-center">
              <dt className="truncate text-[12px] text-[var(--erp-muted)]">
                <span className="@min-[480px]:hidden">{s.short}</span>
                <span className="hidden @min-[480px]:inline">{s.label}</span>
              </dt>
              <dd className={cn('num text-[13px] font-bold', s.tone === 'red' && 'text-[var(--erp-red-text)]')}>{s.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-3 @min-[640px]:justify-end">
          {editable ? <Stepper value={pick.qty} onChange={(v) => onChange({ qty: v, on: Number(v) > 0 })} fractional min={0} ariaLabel={`${line.item.name} to order`} size="sm" className="bg-[var(--erp-card)]" /> : <span className="num text-[14px] font-bold">{qty(line.qty)} {line.item.unit}</span>}
          <span className="num w-24 text-right text-[14px] font-bold">{money(value, currency)}</span>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--erp-ink-2)] @min-[640px]:pl-7">{line.why}</p>
    </li>
  );
}

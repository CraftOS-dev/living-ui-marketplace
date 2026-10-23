/**
 * Products: everything the register sells, and how. The views are pills
 * under the title: the products themselves (a searchable list of soft rows;
 * a row grows into the editor), their categories, option groups, discounts,
 * stock and imports. Products your AI agent imported wait under "To review"
 * until a person adds them.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Package, Plus, Sparkles, Star, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { money, plural } from '../lib/format.ts';
import { catVars, iconFor } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import type { Product } from '../lib/types.ts';
import { CategoriesTab, DiscountsTab, OptionsTab } from '../components/products/Lists.tsx';
import { ProductEditor } from '../components/products/ProductEditor.tsx';
import { ImportTab, StockTab } from '../components/products/StockImport.tsx';
import { Badge, Button, Card, Chip, Count, Empty, PageHeader, SearchField, Select, Spinner, Tabs, Toggle, originOf, rowCls, useConfirm } from '../components/ui.tsx';
import type { Origin } from '../components/ui.tsx';

type Tab = 'products' | 'categories' | 'options' | 'discounts' | 'stock' | 'import';
type Status = 'active' | 'draft' | 'archived';

function priceText(p: Product, currency: string, exp: number): string {
  if (p.open_price) return 'At the counter';
  if (p.variants.length === 0) return money(p.price, currency, exp);
  const prices = p.variants.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? money(lo, currency, exp) : `${money(lo, currency, exp)} to ${money(hi, currency, exp)}`;
}

/** A pill on a soft row is white. */
const onRow = 'bg-[var(--ps-card)]';

/** One product as a soft row: its badge, what it is, its price, stock and whether it sells now. The name opens the editor, and its click area covers the row. */
function ProductRow({
  p,
  status,
  selected,
  onSelect,
  onOpen,
  onAvailable,
}: {
  p: Product;
  status: Status;
  selected: boolean;
  onSelect: () => void;
  onOpen: (row: HTMLElement) => void;
  onAvailable: () => void;
}): React.JSX.Element {
  const { currency, exp } = useApp();
  const v = catVars(p.color);
  const I = iconFor(p.icon);
  const draft = status === 'draft';
  const sub = [p.category_name, p.variants.length > 0 ? plural(p.variants.length, 'size') : '', p.modifier_groups.length > 0 ? plural(p.modifier_groups.length, 'option group') : '', p.sku].filter((x) => x !== '').join(' · ');
  const stock = p.stock ?? 0;
  return (
    <li className={cn(rowCls, 'relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-[var(--ps-row-hover)]')}>
      {draft && (
        <label className="relative z-10 flex size-10 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={selected} aria-label={`Select ${p.name}`} onChange={onSelect} className="peer sr-only" />
          <span
            aria-hidden
            className={cn(
              'flex size-6 items-center justify-center rounded-full ring-[var(--ps-ink)] ring-offset-2 ring-offset-[var(--ps-row)] peer-focus-visible:ring-2',
              selected ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-card)] text-transparent',
            )}
          >
            <Check size={14} strokeWidth={3} />
          </span>
        </label>
      )}
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-[18px] after:ring-[var(--ps-ink)] focus-visible:after:ring-2"
      >
        {p.thumb_url !== '' ? (
          <img data-origin src={p.thumb_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <span data-origin aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: v.soft, color: v.text }}>
            <I size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('truncate text-[14px] font-bold', !p.available && 'line-through')}>{p.name}</span>
            {p.favorite && <Star size={12} aria-hidden className="shrink-0 text-[var(--ps-ink-2)]" fill="currentColor" />}
          </span>
          {(sub !== '' || p.tax_name !== '') && (
            <span className="block truncate text-[12px] text-[var(--ps-muted)]">
              {sub}
              {p.tax_name !== '' && <span className="hidden xl:inline">{`${sub !== '' ? ' · ' : ''}${p.tax_name}`}</span>}
            </span>
          )}
        </span>
      </button>
      <div className={cn('order-last flex w-full flex-wrap items-center gap-2 lg:order-none lg:w-auto lg:flex-nowrap lg:pl-0', draft ? 'pl-[104px]' : 'pl-[52px]')}>
        <span className="num text-[14px] font-bold lg:w-48 lg:text-right">{priceText(p, currency, exp)}</span>
        <span className="flex flex-wrap items-center gap-1 lg:w-[124px]">
          {p.track_stock &&
            (stock <= 0 ? (
              <Badge tone="bad" className={onRow}>
                None left
              </Badge>
            ) : p.low ? (
              <Badge tone="warn" className={onRow}>
                {stock} left
              </Badge>
            ) : (
              <Badge tone="neutral" className={onRow}>
                {stock} in stock
              </Badge>
            ))}
          {!p.available && (
            <Badge tone="bad" className={onRow}>
              Sold out
            </Badge>
          )}
        </span>
      </div>
      {status === 'active' && (
        <span className="relative z-10 flex shrink-0">
          <Toggle checked={p.available} onChange={onAvailable} label={`${p.name} for sale`} />
        </span>
      )}
    </li>
  );
}

function ProductsList({ query, from, onCreate }: { query: URLSearchParams; from: React.RefObject<Origin | null>; onCreate: (el: HTMLElement) => void }): React.JSX.Element {
  const { catalog } = useApp();
  const [status, setStatus] = useState<Status>((query.get('status') as Status | null) ?? 'active');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const editing = query.get('id');
  const creating = query.get('new') === '1';
  const d = useLive(() => api.products({ status, category, q, limit: 0 }), ['products', 'variants', 'codes', 'stock', 'categories', 'tax_classes'], [status, category, q]);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmEl, confirm] = useConfirm();
  const list = d.data?.products ?? [];
  const counts = d.data?.counts;

  useEffect(() => setSelected([]), [status]);

  // The editor grows out of the row's badge.
  const open = (id: string, row: HTMLElement): void => {
    from.current = originOf(row.querySelector('[data-origin]') ?? row);
    replaceQuery('products', { tab: 'products', status, id });
  };
  const close = (): void => replaceQuery('products', { tab: 'products', status });

  const toggleAvailable = async (p: Product): Promise<void> => {
    try {
      await api.setAvailable(p.id, !p.available);
    } catch {
      /* toasted */
    }
  };

  const review = async (approve: boolean): Promise<void> => {
    const ids = selected.length > 0 ? selected : list.map((p) => p.id);
    if (!approve) {
      const ok = await confirm(`${ids.length === 1 ? 'This product is' : `These ${ids.length} products are`} thrown away.`, 'Discard the imported products?', 'Discard');
      if (!ok) return;
    }
    try {
      const res = approve ? await api.approveProducts(ids) : await api.discardProducts(ids);
      toast.success(approve ? `Added ${plural(res.done, 'product')} to the register` : `Discarded ${plural(res.done, 'product')}`);
      setSelected([]);
    } catch {
      /* toasted */
    }
  };

  return (
    <>
      <div className="ps-rise ps-d1 flex flex-wrap items-center gap-3">
        <SearchField value={q} onChange={setQ} placeholder="Name, SKU or barcode" label="Find a product" tone="card" className="min-w-[13rem] flex-1" />
        <Select ariaLabel="Category" value={category} onChange={setCategory} tone="card" options={[{ value: '', label: 'Every category' }, { value: 'none', label: 'No category' }, ...(catalog?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} className="w-full sm:w-52" />
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
          <Chip active={status === 'active'} onClick={() => setStatus('active')} count={counts?.active}>
            For sale
          </Chip>
          {(counts?.draft ?? 0) > 0 && (
            <Chip active={status === 'draft'} onClick={() => setStatus('draft')} count={counts?.draft}>
              To review
            </Chip>
          )}
          <Chip active={status === 'archived'} onClick={() => setStatus('archived')} count={counts?.archived}>
            Archived
          </Chip>
          {(counts?.sold_out ?? 0) > 0 && status === 'active' && <Badge tone="bad">{counts?.sold_out} sold out</Badge>}
        </div>
      </div>

      {status === 'draft' && list.length > 0 && (
        <div className="ps-on-sand ps-pop flex flex-wrap items-center gap-2 rounded-[28px] bg-[var(--ps-sand)] p-1.5">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ps-solid)] text-[var(--ps-on-solid)]">
            <Sparkles size={16} />
          </span>
          <span className="min-w-0 flex-1 basis-[180px] px-1 text-[13px] font-bold">
            Imported by your AI agent{selected.length > 0 ? `: ${selected.length} selected` : ''}
          </span>
          <Button size="sm" variant="light" icon={Trash2} className="text-[var(--ps-red-text)]" onClick={() => void review(false)}>
            Discard {selected.length > 0 ? 'selected' : 'all'}
          </Button>
          <Button size="sm" variant="primary" icon={Check} onClick={() => void review(true)}>
            Add {selected.length > 0 ? 'selected' : 'all'} to the register
          </Button>
        </div>
      )}

      <Card delay={2} className="p-3 md:p-4">
        {d.data === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <Empty
            icon={Package}
            title={q.trim() !== '' ? `Nothing matches "${q.trim()}"` : status === 'archived' ? 'Nothing archived' : 'No products yet'}
            action={
              status === 'active' && q.trim() === '' && can('catalog') ? (
                <Button variant="primary" icon={Plus} dot onClick={(e) => onCreate(e.currentTarget)}>
                  New product
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((p) => {
              const sel = selected.includes(p.id);
              return (
                <ProductRow
                  key={p.id}
                  p={p}
                  status={status}
                  selected={sel}
                  onSelect={() => setSelected(sel ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
                  onOpen={(row) => open(p.id, row)}
                  onAvailable={() => void toggleAvailable(p)}
                />
              );
            })}
          </ul>
        )}
      </Card>

      {(editing !== null || creating) && can('catalog') && (
        <ProductEditor
          key={editing ?? 'new'}
          id={editing}
          origin={from.current}
          preset={{ ...(query.get('barcode') !== null ? { barcode: query.get('barcode') ?? '' } : {}), ...(category !== '' && category !== 'none' ? { category } : {}) }}
          onClose={(saved) => {
            from.current = null;
            close();
            if (saved !== null && editing === null) setQ('');
          }}
        />
      )}
      {confirmEl}
    </>
  );
}

export function ProductsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const tabFromQuery = (query.get('tab') as Tab | null) ?? (can('catalog') ? 'products' : 'stock');
  const [tab, setTab] = useState<Tab>(tabFromQuery);
  useEffect(() => setTab(tabFromQuery), [tabFromQuery]);
  const status = useApp().status;
  // Where the product editor grows from: the row or the button that opened it.
  const from = useRef<Origin | null>(null);
  // On a phone the views scroll sideways: the one that is open stays in sight (the counts change the pills' widths).
  const strip = useRef<HTMLDivElement | null>(null);
  const lowStock = status?.low_stock ?? 0;
  const drafts = status?.drafts ?? 0;
  useEffect(() => {
    const show = (): void => {
      const list = strip.current?.querySelector('[role="tablist"]') ?? null;
      const on = list?.querySelector('[aria-selected="true"]') ?? null;
      if (list === null || on === null) return;
      const outer = list.getBoundingClientRect();
      const inner = on.getBoundingClientRect();
      if (inner.left < outer.left || inner.right > outer.right) list.scrollLeft += inner.left - outer.left - 16;
    };
    show();
    // The pills are measured again once the font has loaded.
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) show();
    });
    return () => {
      live = false;
    };
  }, [tab, lowStock, drafts]);
  const tabs: { value: Tab; label: React.ReactNode }[] = [
    ...(can('catalog')
      ? ([
          { value: 'products', label: 'Products' },
          { value: 'categories', label: 'Categories' },
          { value: 'options', label: 'Options' },
          { value: 'discounts', label: 'Discounts' },
        ] as { value: Tab; label: React.ReactNode }[])
      : []),
    {
      value: 'stock',
      label: (
        <>
          Stock
          {lowStock > 0 && <Count n={lowStock} on={tab === 'stock'} />}
        </>
      ),
    },
    ...(can('catalog') || can('imports')
      ? ([
          {
            value: 'import',
            label: (
              <>
                Import
                {drafts > 0 && <Count n={drafts} on={tab === 'import'} />}
              </>
            ),
          },
        ] as { value: Tab; label: React.ReactNode }[])
      : []),
  ];
  const go = (t: Tab): void => {
    setTab(t);
    replaceQuery('products', { tab: t });
  };
  const create = (el: HTMLElement): void => {
    from.current = originOf(el);
    setTab('products');
    replaceQuery('products', { tab: 'products', new: '1' });
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Products"
        subtitle={status !== null ? `${status.products} for sale` : undefined}
        actions={
          can('catalog') ? (
            <Button variant="primary" icon={Plus} dot onClick={(e) => create(e.currentTarget)}>
              New product
            </Button>
          ) : undefined
        }
      />
      <div ref={strip} className="min-w-0">
        <Tabs value={tab} onChange={go} options={tabs} label="Products" />
      </div>
      {tab === 'products' && <ProductsList query={query} from={from} onCreate={create} />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'options' && <OptionsTab />}
      {tab === 'discounts' && <DiscountsTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'import' && <ImportTab onReview={() => replaceQuery('products', { tab: 'products', status: 'draft' })} />}
    </div>
  );
}

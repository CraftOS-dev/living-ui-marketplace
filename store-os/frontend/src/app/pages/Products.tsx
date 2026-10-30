/**
 * Products: the catalog (one row per product with its stock and its status
 * on every shop), the stock ledger view (receive, count, see each SKU's
 * moves) and "Set on shops" (the numbers each shop should show, for your AI
 * agent or you to set).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ChevronRight, CircleCheck, Layers, Package, PackageX, Plus, SearchX, Sparkles, TriangleAlert, Upload, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { useBase, useStore } from '../lib/store.tsx';
import { money, num, plural } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { notify } from '../lib/toast.tsx';
import type { PlanRow, ProductList, ProductRow, Shop, ShopRef, StockOverview, StockRow, TaskBrief } from '../lib/types.ts';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { PlatformMark } from '../components/PlatformMark.tsx';
import { ShopFilter, StockPill } from '../components/badges.tsx';
import { ProductThumb, StockDialog, StockLedger } from '../components/ProductDialogs.tsx';
import type { StockMode, StockTarget } from '../components/ProductDialogs.tsx';
import { Button, Card, Empty, IconBadge, LinkButton, NoRowTap, PageHeader, PhoneList, PhoneRow, Pill, SearchField, Skeleton, TableCard, Tabs, TaskBadge, Td, Th, Tip, Tr, confirmAsk } from '../components/ui.tsx';

const READS: Collection[] = ['products', 'variants', 'listings', 'stock_moves', 'orders', 'order_lines', 'shops', 'tasks'];

type View = 'catalog' | 'stock' | 'push';
const FILTERS = ['issues', 'unlisted', 'low', 'out', 'missing_cost', 'draft', 'archived'] as const;
type CatalogFilter = '' | (typeof FILTERS)[number];
type Counts = ProductList['counts'];

/** What the page remembers between visits (shop chip and searches). */
const memory = { shop: '', q: '', stockQ: '' };

function isFilter(s: string): s is (typeof FILTERS)[number] {
  return (FILTERS as readonly string[]).includes(s);
}

/** Adding a product happens on its own page. */
function addProduct(): void {
  go('product', 'new');
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProductsPage({ route }: { route: Route }): React.JSX.Element {
  const view: View = route.sub === 'stock' ? 'stock' : route.sub === 'push' ? 'push' : 'catalog';
  const filter: CatalogFilter = isFilter(route.sub) ? route.sub : '';
  const { attention } = useStore();
  const [importing, setImporting] = useState(false);
  const [shop, setShopState] = useState(memory.shop);
  const setShop = (id: string): void => {
    memory.shop = id;
    setShopState(id);
  };
  const summary = useLive<ProductList>('products:summary', (signal) => op<ProductList>('products.list', { limit: 1 }, { signal, quiet: true }), READS);
  const c = summary.data?.counts;
  const subtitle = c === undefined ? undefined : c.all === 0 ? 'No products yet' : plural(c.all, 'product') + (c.issues > 0 ? ', ' + num(c.issues) + ' with listing issues' : '');
  const toPush = attention?.stock_to_push ?? 0;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
            <LinkButton icon={Plus} href={href('product', 'new')}>
              Add product
            </LinkButton>
          </>
        }
      />
      <Tabs<View>
        className="so-rise mb-4"
        items={[
          { key: 'catalog', label: 'Catalog' },
          { key: 'stock', label: 'Stock' },
          { key: 'push', label: 'Set on shops', count: toPush > 0 ? toPush : undefined },
        ]}
        value={view}
        onChange={(k) => go('products', k === 'catalog' ? '' : k)}
      />
      {view === 'catalog' && <CatalogView filter={filter} shop={shop} onShop={setShop} fallback={c} onAdd={addProduct} onImport={() => setImporting(true)} />}
      {view === 'stock' && <StockView onAdd={addProduct} />}
      {view === 'push' && <PushView />}
      <ImportDialog open={importing} onClose={() => setImporting(false)} kind="products" {...(view === 'catalog' && shop !== '' ? { shopId: shop } : {})} />
    </div>
  );
}

/* ------------------------------------------------------------ filter chips */

interface Chip<K extends string> {
  key: K;
  label: string;
  count?: number | undefined;
  alert?: boolean;
}

/** Small filter pills on a card: the chosen one is black, each with its count. */
function FilterChips<K extends string>({ items, value, onChange, label }: { items: Chip<K>[]; value: K; onChange: (k: K) => void; label: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.key)}
            className={cn('so-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', on ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-tile)] text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]')}
          >
            {it.label}
            {it.count !== undefined && <span className={cn('num text-[12px]', on ? 'opacity-70' : it.alert && it.count > 0 ? 'text-[var(--so-red-text)]' : 'text-[var(--so-muted)]')}>{num(it.count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- catalog */

const PAGE = 100;
const MAX_ROWS = 500;

function catalogChips(c: Counts | undefined): Chip<CatalogFilter>[] {
  return [
    { key: '', label: 'All', count: c?.all },
    { key: 'issues', label: 'Listing issues', count: c?.issues, alert: true },
    { key: 'unlisted', label: 'Not listed', count: c?.unlisted },
    { key: 'low', label: 'Low stock', count: c?.low, alert: true },
    { key: 'out', label: 'Out of stock', count: c?.out, alert: true },
    { key: 'missing_cost', label: 'Missing cost', count: c?.missing_cost, alert: true },
    { key: 'draft', label: 'Drafts', count: c?.draft },
    { key: 'archived', label: 'Archived', count: c?.archived },
  ];
}

function CatalogView({ filter, shop, onShop, fallback, onAdd, onImport }: { filter: CatalogFilter; shop: string; onShop: (id: string) => void; fallback: Counts | undefined; onAdd: () => void; onImport: () => void }): React.JSX.Element {
  const base = useBase();
  const [q, setQState] = useState(memory.q);
  const setQ = (v: string): void => {
    memory.q = v;
    setQState(v);
  };
  const dq = useDebounced(q.trim(), 250);
  // How many rows to load, starting over for each filter, shop and search.
  const viewKey = filter + ':' + shop + ':' + dq;
  const [paged, setPaged] = useState({ key: viewKey, n: PAGE });
  const limit = paged.key === viewKey ? paged.n : PAGE;
  const status = filter === 'draft' ? 'draft' : filter === 'archived' ? 'archived' : undefined;
  const serverFilter = filter !== '' && filter !== 'draft' && filter !== 'archived' ? filter : undefined;
  const list = useLive<ProductList>(
    'products:list:' + viewKey,
    (signal) => op<ProductList>('products.list', { q: dq || undefined, shop: shop || undefined, status, filter: serverFilter, limit }, { signal, quiet: true }),
    READS,
    [filter, shop, dq, limit],
  );
  const data = list.data;
  const rows = data?.products ?? null;
  const cur = data?.currency || base;
  const more = data !== null && rows !== null && data.total > rows.length && rows.length < MAX_ROWS;

  // Load the next rows as the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (el === null || !more || list.loading) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setPaged((p) => ({ key: viewKey, n: Math.min(MAX_ROWS, (p.key === viewKey ? p.n : PAGE) + PAGE) }));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, list.loading, rows?.length, viewKey]);

  const empty = data !== null && data.total === 0;
  const storeEmpty = empty && filter === '' && dq === '' && shop === '' && data.counts.all === 0 && data.counts.archived === 0;

  return (
    <div className="grid gap-4">
      <ShopFilter value={shop} onChange={onShop} includeDirect={false} />
      <Card flush className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          <FilterChips label="Filter products" items={catalogChips(data?.counts ?? fallback)} value={filter} onChange={(k) => go('products', k)} />
          <SearchField value={q} onChange={setQ} placeholder="Search title, SKU, brand" className="w-full sm:w-[280px]" />
        </div>
        {rows === null ? (
          list.error !== null ? (
            <p className="px-5 pb-6 text-[13px] text-[var(--so-red-text)]">{list.error}</p>
          ) : (
            <div className="grid gap-2 px-5 pb-5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-[60px]" />
              ))}
            </div>
          )
        ) : storeEmpty ? (
          <Empty
            icon={Package}
            title="No products yet"
            action={
              <>
                <Button icon={Plus} onClick={onAdd}>
                  Add product
                </Button>
                <Button variant="secondary" icon={Upload} onClick={onImport}>
                  Import
                </Button>
              </>
            }
          >
            Add what you sell once; every shop is fed from here.
          </Empty>
        ) : empty ? (
          <Empty
            icon={SearchX}
            title="Nothing matches"
            action={
              <Button
                variant="tile"
                onClick={() => {
                  setQ('');
                  onShop('');
                  go('products');
                }}
              >
                Show all products
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-[var(--so-line)] px-5 pb-2 text-[12px] font-semibold text-[var(--so-muted)] md:flex">
              <span className="w-12 shrink-0" />
              <span className="min-w-0 flex-1">Product</span>
              <span className="w-[150px] text-right">Price</span>
              <span className="w-[120px]">Stock</span>
              <span className="w-[148px]">Shops</span>
              <span className="w-4 shrink-0" />
            </div>
            <div className="grid gap-0.5 p-2">
              {rows.map((r) => (
                <ProductLine key={r.id} row={r} cur={cur} />
              ))}
            </div>
            {more && <div ref={sentinel} className="h-px" />}
            {data !== null && data.total > rows.length && !more && <p className="px-5 pb-4 text-[12px] text-[var(--so-muted)]">Showing {num(rows.length)} of {num(data.total)}. Search to find the rest.</p>}
          </>
        )}
      </Card>
    </div>
  );
}

function priceText(row: ProductRow, cur: string): string {
  if (row.variants === 0) return '';
  if (row.price_min === row.price_max) return money(row.price_min, cur);
  return money(row.price_min, cur) + ' to ' + money(row.price_max, cur);
}

function skuText(row: ProductRow): string {
  if (row.variants === 0) return 'No SKU yet';
  const rest = row.variants - row.skus.length;
  return row.skus.join(', ') + (rest > 0 ? ' +' + rest + ' more' : '');
}

type Mark = ProductRow['listings'][number];

function markState(l: Mark): { dot: string; label: string } {
  const warn = l.warnings > 0 ? ', ' + plural(l.warnings, 'warning') : '';
  if (l.blocking > 0 && l.status !== 'live') return { dot: 'bg-[var(--so-red)]', label: plural(l.blocking, 'issue') };
  if (l.status === 'live') return { dot: 'bg-[var(--so-green)]', label: 'Live' + warn };
  if (l.status === 'ready') return { dot: 'bg-[var(--so-accent)]', label: 'Ready to publish' + warn };
  if (l.status === 'paused') return { dot: 'bg-[var(--so-amber)]', label: 'Paused' + warn };
  return { dot: 'bg-[var(--so-faint)]', label: 'Draft' + warn };
}

/** One mark per shop the product is on, each with its listing's status dot. */
function ListingMarks({ listings }: { listings: Mark[] }): React.JSX.Element {
  if (listings.length === 0) return <span className="text-[12px] font-medium text-[var(--so-muted)]">Not listed</span>;
  const shown = listings.slice(0, 4);
  return (
    <span className="flex items-center gap-1.5">
      {shown.map((l) => {
        const s = markState(l);
        return (
          <Tip key={l.id} text={l.shop_name + ': ' + s.label}>
            <span className="relative inline-flex" aria-label={l.shop_name + ': ' + s.label}>
              <PlatformMark platform={l.platform} size={26} />
              <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--so-card)]', s.dot)} />
            </span>
          </Tip>
        );
      })}
      {listings.length > shown.length && <span className="num text-[12px] font-semibold text-[var(--so-muted)]">+{listings.length - shown.length}</span>}
    </span>
  );
}

function Flags({ row }: { row: ProductRow }): React.JSX.Element | null {
  if (!row.cost_missing && row.task === null) return null;
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
      {row.cost_missing && (
        <Tip text="A SKU has no cost, so profit is unknown">
          <Pill tone="warn">Missing cost</Pill>
        </Tip>
      )}
      <TaskBadge task={row.task} />
    </span>
  );
}

function ProductLine({ row, cur }: { row: ProductRow; cur: string }): React.JSX.Element {
  const price = priceText(row, cur);
  return (
    <a href={href('product', row.id)} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 hover:bg-[var(--so-row-hover)]">
      <ProductThumb src={row.image} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-[var(--so-ink)]">{row.title}</span>
              {row.status !== 'active' && <Pill tone="neutral">{row.status === 'draft' ? 'Draft' : 'Archived'}</Pill>}
            </div>
            <p className="truncate text-[12px] text-[var(--so-muted)]">{skuText(row)}</p>
          </div>
          <span className="hidden md:flex">
            <Flags row={row} />
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
          {price !== '' && <span className="num text-[13px] font-semibold">{price}</span>}
          <StockPill state={row.stock_state} available={row.available} />
          <ListingMarks listings={row.listings} />
          <Flags row={row} />
        </div>
      </div>
      <span className="num hidden w-[150px] shrink-0 truncate text-right text-[13px] font-semibold md:block">{price}</span>
      <span className="hidden w-[120px] shrink-0 md:block">
        <StockPill state={row.stock_state} available={row.available} />
      </span>
      <span className="hidden w-[148px] shrink-0 md:block">
        <ListingMarks listings={row.listings} />
      </span>
      <ChevronRight size={16} className="shrink-0 text-[var(--so-faint)]" aria-hidden />
    </a>
  );
}

/* ------------------------------------------------------------------- stock */

type StockFilter = 'all' | 'attention' | 'low' | 'out';

function Figure({ label, value, icon, tone, hero = false }: { label: string; value: string; icon: LucideIcon; tone: 'tile' | 'warn' | 'bad'; hero?: boolean }): React.JSX.Element {
  return (
    <section className={cn('so-rise flex min-h-[124px] flex-col justify-between rounded-[20px] p-5', hero ? 'so-hero col-span-2 md:col-span-1' : 'bg-[var(--so-card)]')}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-[14px] font-medium', hero ? 'text-[var(--so-on-accent)] opacity-90' : 'text-[var(--so-ink-2)]')}>{label}</p>
        <IconBadge icon={icon} tone={hero ? 'onAccent' : tone} size={36} />
      </div>
      <p className="num truncate text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">{value}</p>
    </section>
  );
}

function availableClass(available: number, low: number): string {
  if (available <= 0) return 'text-[var(--so-red-text)]';
  if (available <= low) return 'text-[var(--so-amber-text)]';
  return 'text-[var(--so-ink)]';
}

function StockView({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const base = useBase();
  const data = useLive<StockOverview>('stock:overview', (signal) => op<StockOverview>('stock.overview', { limit: 1000 }, { signal, quiet: true }), ['variants', 'stock_moves', 'products', 'orders', 'order_lines']);
  const [f, setF] = useState<StockFilter>('all');
  const [q, setQState] = useState(memory.stockQ);
  const setQ = (v: string): void => {
    memory.stockQ = v;
    setQState(v);
  };
  const [openRow, setOpenRow] = useState('');
  const [dialog, setDialog] = useState<{ target: StockTarget; mode: StockMode } | null>(null);
  const all = data.data?.rows ?? null;
  const cur = data.data?.currency || base;
  const t = data.data?.totals;

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    if (all === null) return [];
    return all.filter((r) => {
      if (f === 'low' && r.state !== 'low') return false;
      if (f === 'out' && r.state !== 'out') return false;
      if (f === 'attention' && r.state === 'ok') return false;
      if (needle !== '' && (r.sku + ' ' + r.option + ' ' + r.title).toLowerCase().indexOf(needle) < 0) return false;
      return true;
    });
  }, [all, f, needle]);

  const attention = all === null ? 0 : all.filter((r) => r.state !== 'ok').length;
  const chips: Chip<StockFilter>[] = [
    { key: 'all', label: 'All', count: all?.length },
    { key: 'attention', label: 'Needs attention', count: attention, alert: true },
    { key: 'low', label: 'Low', count: t?.low, alert: true },
    { key: 'out', label: 'Out', count: t?.out, alert: true },
  ];
  const ask = (r: StockRow, mode: StockMode): void => setDialog({ target: { variant: r.variant, sku: r.sku, option: r.option, title: r.title, on_hand: r.on_hand, reserved: r.reserved }, mode });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {t === undefined ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className={cn('h-[124px] rounded-[20px] bg-[var(--so-card)]', i === 0 && 'col-span-2 md:col-span-1')} />)
        ) : (
          <>
            <Figure hero label="Stock value" value={money(t.value, cur)} icon={Wallet} tone="tile" />
            <Figure label="SKUs" value={num(t.skus)} icon={Boxes} tone="tile" />
            <Figure label="Units on hand" value={num(t.units)} icon={Layers} tone="tile" />
            <Figure label="Low" value={num(t.low)} icon={TriangleAlert} tone={t.low > 0 ? 'warn' : 'tile'} />
            <Figure label="Out" value={num(t.out)} icon={PackageX} tone={t.out > 0 ? 'bad' : 'tile'} />
          </>
        )}
      </div>
      <TableCard
        head={
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <FilterChips label="Filter stock" items={chips} value={f} onChange={setF} />
            <SearchField value={q} onChange={setQ} placeholder="Search SKU or product" className="w-full sm:w-[260px]" />
          </div>
        }
      >
        {all === null ? (
          data.error !== null ? (
            <p className="px-3 py-6 text-[13px] text-[var(--so-red-text)]">{data.error}</p>
          ) : (
            <div className="grid gap-2 px-3 py-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )
        ) : all.length === 0 ? (
          <Empty
            icon={Boxes}
            title="No stock yet"
            action={
              <Button icon={Plus} onClick={onAdd}>
                Add product
              </Button>
            }
          >
            Every SKU you add shows here with what is on your shelf.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty
            icon={SearchX}
            title="Nothing matches"
            action={
              <Button
                variant="tile"
                onClick={() => {
                  setF('all');
                  setQ('');
                }}
              >
                Show all SKUs
              </Button>
            }
          />
        ) : (
          <>
          <PhoneList label="Stock" wide>
            {rows.map((r) => {
              const open = openRow === r.variant;
              return (
                <Fragment key={r.variant}>
                  <PhoneRow on={open} onClick={() => setOpenRow(open ? '' : r.variant)} lead={<ProductThumb src={r.image} size={40} />}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-semibold">{r.title}</span>
                      <span className={cn('num shrink-0 text-[15px] font-bold', availableClass(r.available, r.low_stock))}>{num(r.available)}</span>
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-[var(--so-muted)]">
                      <span className="min-w-0 truncate">{r.option !== '' ? r.sku + ', ' + r.option : r.sku}</span>
                      <span className="shrink-0">available</span>
                    </span>
                    <span className="num mt-1 block text-[12px] text-[var(--so-muted)]">
                      {num(r.on_hand)} on hand, {num(r.reserved)} reserved, {money(r.value, cur)}
                    </span>
                    <NoRowTap className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="tile" icon={Plus} onClick={() => ask(r, 'received')}>
                        Received
                      </Button>
                      <Button size="sm" variant="tile" onClick={() => ask(r, 'count')}>
                        Count
                      </Button>
                    </NoRowTap>
                  </PhoneRow>
                  {open && (
                    <li className="px-1 pb-3">
                      <div className="rounded-[14px] bg-[var(--so-tile)] p-2">
                        <StockLedger variant={r.variant} />
                      </div>
                    </li>
                  )}
                </Fragment>
              );
            })}
          </PhoneList>
          <table className="hidden w-full min-w-[980px] lg:table">
            <thead>
              <tr className="text-left">
                <Th className="w-[60px]" />
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th align="right">On hand</Th>
                <Th align="right">
                  <Tip text="Ordered but not shipped yet">
                    <span>Reserved</span>
                  </Tip>
                </Th>
                <Th align="right">Available</Th>
                <Th align="right">Low at</Th>
                <Th align="right">Value</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openRow === r.variant;
                return (
                  <Fragment key={r.variant}>
                    <Tr on={open} onClick={() => setOpenRow(open ? '' : r.variant)}>
                      <Td>
                        <ProductThumb src={r.image} size={40} />
                      </Td>
                      <Td>
                        <a href={href('product', r.product)} onClick={(e) => e.stopPropagation()} className="block max-w-[280px] truncate font-semibold hover:underline">
                          {r.title}
                        </a>
                        {r.option !== '' && <span className="block max-w-[280px] truncate text-[12px] text-[var(--so-muted)]">{r.option}</span>}
                      </Td>
                      <Td className="whitespace-nowrap text-[var(--so-ink-2)]">{r.sku}</Td>
                      <Td align="right">{num(r.on_hand)}</Td>
                      <Td align="right" className="text-[var(--so-muted)]">
                        {num(r.reserved)}
                      </Td>
                      <Td align="right">
                        <span className={cn('text-[14px] font-bold', availableClass(r.available, r.low_stock))}>{num(r.available)}</span>
                      </Td>
                      <Td align="right" className="text-[var(--so-muted)]">
                        {num(r.low_stock)}
                      </Td>
                      <Td align="right">{money(r.value, cur)}</Td>
                      <Td align="right">
                        <span className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="tile"
                            icon={Plus}
                            onClick={(e) => {
                              e.stopPropagation();
                              ask(r, 'received');
                            }}
                          >
                            Received
                          </Button>
                          <Button
                            size="sm"
                            variant="tile"
                            onClick={(e) => {
                              e.stopPropagation();
                              ask(r, 'count');
                            }}
                          >
                            Count
                          </Button>
                        </span>
                      </Td>
                    </Tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="px-3 pb-3">
                          <div className="rounded-[14px] bg-[var(--so-tile)] p-2">
                            <StockLedger variant={r.variant} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </>
        )}
      </TableCard>
      <StockDialog target={dialog?.target ?? null} mode={dialog?.mode ?? 'received'} onClose={() => setDialog(null)} />
    </div>
  );
}

/* ------------------------------------------------------------ set on shops */

interface Plan {
  rows: PlanRow[];
  shops: number;
}

function PushView(): React.JSX.Element {
  const plan = useLive<Plan>('stock:plan', (signal) => op<Plan>('stock.plan', {}, { signal, quiet: true }), READS);
  const groups = useMemo(() => {
    const out: { shop: ShopRef; rows: PlanRow[] }[] = [];
    for (const r of plan.data?.rows ?? []) {
      let g = out.find((x) => x.shop.id === r.shop.id);
      if (g === undefined) {
        g = { shop: r.shop, rows: [] };
        out.push(g);
      }
      g.rows.push(r);
    }
    return out;
  }, [plan.data]);

  if (plan.data === null) {
    if (plan.error !== null) return <p className="text-[13px] text-[var(--so-red-text)]">{plan.error}</p>;
    return <Skeleton className="h-[220px] rounded-[20px] bg-[var(--so-card)]" />;
  }
  if (groups.length === 0) {
    return (
      <Card>
        <Empty
          icon={CircleCheck}
          title="Every shop shows the right stock"
          action={
            <Button variant="tile" onClick={() => go('products', 'stock')}>
              Open stock
            </Button>
          }
        >
          When stock moves, the numbers each shop should show appear here.
        </Empty>
      </Card>
    );
  }
  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <PushShop key={g.shop.id} shopRef={g.shop} rows={g.rows} />
      ))}
    </div>
  );
}

/** "Shows 80% of available, keeps 2 back, at most 50." */
function ruleText(shop: Shop): string {
  const share = shop.stock_share > 0 ? shop.stock_share : 0;
  let t = share >= 100 ? 'Shows all available stock' : 'Shows ' + share + '% of available stock';
  if (shop.stock_buffer > 0) t += ', keeps ' + num(shop.stock_buffer) + ' back';
  if (shop.stock_max > 0) t += ', at most ' + num(shop.stock_max);
  return t;
}

function openTask(t: TaskBrief | null | undefined, kind: TaskBrief['kind']): TaskBrief | null {
  if (!t || t.kind !== kind) return null;
  return t.state === 'queued' || t.state === 'asked' || t.state === 'working' ? t : null;
}

function PushShop({ shopRef, rows }: { shopRef: ShopRef; rows: PlanRow[] }): React.JSX.Element {
  const store = useStore();
  const shop = store.shop(shopRef.id);
  const task = openTask(shop?.task, 'push_stock');
  const [busy, setBusy] = useState<'' | 'ask' | 'mark'>('');

  const askAgent = async (): Promise<void> => {
    setBusy('ask');
    try {
      const r = await op<{ task: TaskBrief | null; rows: number }>('stock.push', { shop: shopRef.id });
      changed('tasks', 'shops');
      notify.info(r.task !== null ? 'Asked your AI agent' : 'Nothing left to set');
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };
  const markSet = async (): Promise<void> => {
    const ok = await confirmAsk('Mark ' + plural(rows.length, 'SKU') + ' as set on ' + shopRef.name + '?', 'Do this once ' + shopRef.name + ' shows these numbers.', 'Mark as set');
    if (!ok) return;
    setBusy('mark');
    try {
      await op('stock.mark-pushed', { shop: shopRef.id, all: true });
      changed('listings', 'tasks', 'shops');
      notify.info('Marked as set');
    } catch {
      /* op showed why */
    } finally {
      setBusy('');
    }
  };

  return (
    <TableCard
      head={
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformMark platform={shopRef.platform} size={40} />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[15px] font-semibold leading-[22px]">
                <span className="truncate">{shopRef.name}</span>
                <Pill tone="neutral">{plural(rows.length, 'SKU')}</Pill>
              </p>
              {shop !== undefined && <p className="text-[12px] text-[var(--so-muted)]">{ruleText(shop)}.</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskBadge task={task} />
            <Button size="sm" variant="secondary" loading={busy === 'mark'} disabled={busy !== ''} onClick={() => void markSet()}>
              I set them
            </Button>
            <Button size="sm" icon={Sparkles} loading={busy === 'ask'} disabled={busy !== '' || task !== null} onClick={() => void askAgent()}>
              Ask your AI agent to set them
            </Button>
          </div>
        </div>
      }
    >
      <PhoneList label={'Stock to set on ' + shopRef.name}>
        {rows.map((r) => (
          <PhoneRow key={r.listing + ':' + r.variant}>
            <span className="flex items-baseline justify-between gap-3">
              <a href={href('product', r.product)} className="truncate text-[14px] font-semibold hover:underline">
                {r.title}
              </a>
              <span className="num shrink-0 text-[15px] font-bold">{num(r.qty)}</span>
            </span>
            <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-[var(--so-muted)]">
              <span className="min-w-0 truncate">{r.option !== '' ? r.sku + ', ' + r.option : r.sku}</span>
              <span className="shrink-0">should show</span>
            </span>
            <span className="num mt-1 block text-[12px] text-[var(--so-muted)]">
              {num(r.available)} available, shop shows {r.last === null ? 'unknown' : num(r.last)}
            </span>
          </PhoneRow>
        ))}
      </PhoneList>
      <table className="hidden w-full min-w-[620px] sm:table">
        <thead>
          <tr className="text-left">
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th align="right">Available</Th>
            <Th align="right">Shop shows now</Th>
            <Th align="right">Should show</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.listing + ':' + r.variant}>
              <Td className="whitespace-nowrap font-semibold">{r.sku}</Td>
              <Td>
                <a href={href('product', r.product)} className="block max-w-[320px] truncate font-medium hover:underline">
                  {r.title}
                </a>
                {r.option !== '' && <span className="block max-w-[320px] truncate text-[12px] text-[var(--so-muted)]">{r.option}</span>}
              </Td>
              <Td align="right" className="text-[var(--so-ink-2)]">
                {num(r.available)}
              </Td>
              <Td align="right" className="text-[var(--so-muted)]">
                {r.last === null ? 'unknown' : num(r.last)}
              </Td>
              <Td align="right">
                <span className="text-[15px] font-bold">{num(r.qty)}</span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

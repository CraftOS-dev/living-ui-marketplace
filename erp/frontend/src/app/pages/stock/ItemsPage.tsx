/**
 * Items: everything the company sells, buys or keeps in stock. Figures on
 * top (how many, what the stock is worth, what is low or out), filters by
 * status, kind and category, a search that also takes a scanned barcode,
 * and photo cards or a list. Quick + and - on a stock item open the stock
 * change screen; Select turns on bulk archive and reorder drafts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, CheckSquare, LayoutGrid, List, Minus, PackagePlus, PackageSearch, Plus } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { AskAgent } from '../../components/AskAgent.tsx';
import { Chips, SearchBox, Segmented, useDebounced } from '../../components/controls.tsx';
import type { ChipOption } from '../../components/controls.tsx';
import { ItemThumb, iconOf, photoSrc } from '../../components/stock/icons.tsx';
import { useItemEditor } from '../../components/stock/ItemEditor.tsx';
import { ItemStatusPill, KIND_LABEL, LevelBar } from '../../components/stock/parts.tsx';
import { useStockChange } from '../../components/stock/StockChangeScreen.tsx';
import { dropFlag, quietQuery } from '../../components/stock/url.ts';
import type { ChangeMode } from '../../components/stock/StockChangeScreen.tsx';
import { DataTable, SelectionBar } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, Empty, LoadError, PageHeader, PillButton, PillSelect, Skeleton, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { money, plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { CategoryList, Item, ItemKind, ItemList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

const PAGE = 60;
type View = 'cards' | 'list';
type Chip = 'all' | 'low' | 'out' | 'reorder' | 'services' | 'archived';
const CHIPS: Chip[] = ['all', 'low', 'out', 'reorder', 'services', 'archived'];
const SORTS = ['name', 'on_hand', 'value', 'sku', 'price'] as const;
type Sort = (typeof SORTS)[number];

function savedView(): View {
  try {
    return window.localStorage.getItem('erp.items.view') === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function saveView(v: View): void {
  try {
    window.localStorage.setItem('erp.items.view', v);
  } catch {
    /* a per-viewer convenience only */
  }
}

interface Summary {
  all: ItemList;
  services: number;
  archived: number;
}

export function ItemsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const currency = baseCurrency(me);
  const canCatalog = can(me, 'inventory', 'edit') || can(me, 'sales', 'edit') || can(me, 'purchasing', 'edit') || can(me, 'manufacturing', 'edit');
  const canAdjust = can(me, 'inventory', 'edit');
  const canOrder = can(me, 'purchasing', 'edit');

  const [text, setText] = useState(query.get('q') ?? '');
  const q = useDebounced(text.trim(), 250);
  const [chip, setChip] = useState<Chip>(CHIPS.includes(query.get('show') as Chip) ? (query.get('show') as Chip) : 'all');
  const [kind, setKind] = useState<'' | ItemKind>((['stock', 'service', 'non_stock'].includes(query.get('kind') ?? '') ? query.get('kind') : '') as '' | ItemKind);
  const [category, setCategory] = useState(query.get('category') ?? '');
  const [sort, setSort] = useState<Sort>((SORTS as readonly string[]).includes(query.get('sort') ?? '') ? (query.get('sort') as Sort) : 'name');
  const [view, setView] = useState<View>(savedView);
  const [pages, setPages] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sentinel = useRef<HTMLDivElement | null>(null);

  // The sidebar "+" and the New screen open the editor with ?new=1; closing it drops the flag.
  const wantsNew = query.get('new') !== null;
  const editor = useItemEditor({
    onSaved: (it, created) => created && navigate('item', { id: it.id }),
    onClosed: () => {
      dropFlag('items', 'new');
    },
  });
  const change = useStockChange();
  useEffect(() => {
    if (wantsNew && canCatalog) editor.create(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew]);

  useEffect(() => {
    setPages(1);
    quietQuery('items', { q, show: chip === 'all' ? '' : chip, kind, category, sort: sort === 'name' ? '' : sort, new: wantsNew ? '1' : '' });
  }, [q, chip, kind, category, sort, wantsNew]);

  const effKind = chip === 'services' ? 'service' : kind;
  const status = chip === 'low' || chip === 'out' || chip === 'reorder' ? chip : '';
  const desc = sort === 'on_hand' || sort === 'value' || sort === 'price';

  const summary = useLive(
    async (): Promise<Summary> => {
      const [all, services, archived] = await Promise.all([
        op<ItemList>('items.list', { limit: 1 }, { quiet: true }),
        op<ItemList>('items.list', { kind: 'service', limit: 1 }, { quiet: true }),
        op<ItemList>('items.list', { archived: 'archived', limit: 1 }, { quiet: true }),
      ]);
      return { all, services: services.total, archived: archived.total };
    },
    [...READS.stock, 'documents', 'document_lines'],
    [],
  );
  const cats = useLive(() => op<CategoryList>('categories.list', {}, { quiet: true }), ['item_categories', 'items'], []);
  const list = useLive(
    () =>
      op<ItemList>(
        'items.list',
        {
          q: q === '' ? undefined : q,
          status: status === '' ? undefined : status,
          kind: effKind === '' ? undefined : effKind,
          category: category === '' ? undefined : category,
          archived: chip === 'archived' ? 'archived' : 'active',
          sort,
          desc,
          limit: pages * PAGE,
        },
        { quiet: true },
      ),
    [...READS.stock, 'item_categories', 'documents', 'document_lines', 'parties'],
    [q, status, effKind, category, chip, sort, desc, pages],
  );
  const data = list.data;
  const items = data?.items ?? [];
  const more = data !== null && items.length < data.total;

  useEffect(() => {
    const el = sentinel.current;
    if (el === null || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setPages((p) => p + 1);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  const s = summary.data;
  const counts = s?.all.counts;
  const chips: ChipOption<Chip>[] = useMemo(
    () => [
      { value: 'all', label: 'All', ...(s !== null ? { count: s.all.total } : {}) },
      { value: 'low', label: 'Low', ...(counts !== undefined ? { count: counts.low } : {}) },
      { value: 'out', label: 'Out', alert: true, ...(counts !== undefined ? { count: counts.out } : {}) },
      { value: 'reorder', label: 'To reorder', ...(counts !== undefined ? { count: counts.reorder } : {}) },
      { value: 'services', label: 'Services', ...(s !== null ? { count: s.services } : {}) },
      { value: 'archived', label: 'Archived', ...(s !== null && s.archived > 0 ? { count: s.archived } : {}) },
    ],
    [s, counts],
  );

  const quick = (el: Element, it: Item, mode: ChangeMode): void => change.open(el, { item: it.id, mode });

  const ids = [...selected];
  const stopSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };
  const archive = async (value: boolean): Promise<void> => {
    try {
      await op('items.archive', { items: ids, archived: value });
      toast.success(value ? `${plural(ids.length, 'item')} archived` : `${plural(ids.length, 'item')} restored`);
      stopSelecting();
      list.reload();
      summary.reload();
    } catch {
      /* shown */
    }
  };

  const filtered = q !== '' || chip !== 'all' || kind !== '' || category !== '';
  const clear = (): void => {
    setText('');
    setChip('all');
    setKind('');
    setCategory('');
  };

  const columns: Column<Item>[] = [
    {
      key: 'item',
      label: 'Item',
      width: 'minmax(220px, 2.4fr)',
      sort: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <ItemThumb photo={r.photo} icon={r.category?.icon} size={40} rounded="rounded-[12px]" />
          <span className="min-w-0">
            <span className="block truncate font-bold">{r.name}</span>
            <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{r.sku}</span>
          </span>
        </span>
      ),
    },
    { key: 'category', label: 'Category', hide: 'xl', render: (r) => <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{r.category?.name ?? ''}</span> },
    { key: 'status', label: 'Status', width: '132px', hide: 'lg', render: (r) => <ItemStatusPill status={r.status} kind={r.kind} archived={r.archived} size="sm" /> },
    { key: 'level', label: 'Level', width: 'minmax(100px, 1fr)', hide: 'lg', render: (r) => (r.kind === 'stock' ? <LevelBar onHand={r.on_hand} min={r.min_qty} max={r.max_qty} status={r.status} /> : null) },
    {
      key: 'on_hand',
      label: 'On hand',
      align: 'right',
      width: '110px',
      sort: (r) => r.on_hand,
      render: (r) =>
        r.kind === 'stock' ? (
          <span>
            <span className="font-bold">{qty(r.on_hand)}</span> <span className="text-[12px] text-[var(--erp-muted)]">{r.unit}</span>
          </span>
        ) : (
          <span className="text-[var(--erp-muted)]">-</span>
        ),
    },
    { key: 'available', label: 'Available', align: 'right', width: '96px', hide: 'xl', sort: (r) => r.available, render: (r) => (r.kind === 'stock' ? qty(r.available) : '') },
    { key: 'value', label: 'Value', align: 'right', width: '120px', hide: 'md', sort: (r) => r.value, render: (r) => (r.kind === 'stock' ? money(r.value, currency) : '') },
    { key: 'price', label: 'Price', align: 'right', width: '104px', hide: 'md', sort: (r) => r.sale_price_e4, render: (r) => (r.sale_price_e4 > 0 ? price(r.sale_price, currency) : <span className="text-[var(--erp-muted)]">-</span>) },
  ];

  return (
    <div>
      <PageHeader
        title="Items"
        subtitle={data !== null ? <span className="num">{plural(data.total, filtered ? 'match' : 'item', filtered ? 'matches' : 'items')}</span> : undefined}
        actions={
          <>
            {items.length > 0 && !selecting && canCatalog && (
              <PillButton variant="light" icon={CheckSquare} onClick={() => setSelecting(true)}>
                Select
              </PillButton>
            )}
            {canCatalog && (
              <PillButton variant="dark" icon={PackagePlus} dot onClick={(e) => editor.create(e.currentTarget)}>
                New item
              </PillButton>
            )}
          </>
        }
      />

      {/* Figures (when they cannot load, the list below says why) */}
      {!(s === null && summary.error !== null) && (
      <Card tone="dark" className="mb-5" delay={1}>
        {s === null ? (
          <div className="grid grid-cols-2 gap-4 @min-[640px]:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 bg-[var(--erp-dark-2)]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 @min-[640px]:grid-cols-4">
            <DarkFigure label="Stock items" value={qty(s.all.counts.all)} sub={`${plural(s.all.total, 'item')} in all`} />
            <DarkFigure label="Stock value" value={money(s.all.value, currency, 'short')} sub="At average cost" />
            <DarkFigure label="Low" value={qty(s.all.counts.low)} sub={s.all.counts.reorder > 0 ? `${qty(s.all.counts.reorder)} to reorder` : 'None to reorder'} tone={s.all.counts.low > 0 ? 'amber' : undefined} onClick={() => setChip('low')} />
            <DarkFigure label="Out of stock" value={qty(s.all.counts.out)} sub={s.all.counts.out > 0 ? 'Need stock now' : 'Nothing is out'} tone={s.all.counts.out > 0 ? 'red' : undefined} onClick={() => setChip('out')} />
          </div>
        )}
      </Card>
      )}

      {/* Search and filters */}
      <div className="erp-rise erp-d2 mb-4 flex flex-wrap items-center gap-3">
        <SearchBox
          value={text}
          onChange={setText}
          onEnter={(v) => {
            if (v !== '' && items.length === 1 && items[0] !== undefined) navigate('item', { id: items[0].id });
          }}
          placeholder="Search name, SKU, or scan a barcode"
          ariaLabel="Search items"
          className="min-w-[14rem] flex-1"
        />
        <PillSelect
          ariaLabel="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: 'All categories' }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          className="w-[calc(50%-6px)] @min-[480px]:w-48"
        />
        <PillSelect
          ariaLabel="Kind"
          value={effKind}
          onChange={(v) => {
            if (v === 'service') {
              setChip('services');
              setKind('');
            } else {
              if (chip === 'services') setChip('all');
              setKind(v as '' | ItemKind);
            }
          }}
          options={[
            { value: '', label: 'All kinds' },
            { value: 'stock', label: 'Stock items' },
            { value: 'service', label: 'Services' },
            { value: 'non_stock', label: 'Non-stock goods' },
          ]}
          className="w-[calc(50%-6px)] @min-[480px]:w-44"
        />
      </div>

      <div className="erp-rise erp-d2 mb-5 flex flex-wrap items-center justify-between gap-3">
        <Chips ariaLabel="Show" value={chip} onChange={setChip} options={chips} className="min-w-0 flex-1" />
        <div className="flex w-full items-center gap-2 @min-[480px]:w-auto">
          <PillSelect
            ariaLabel="Sort"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            options={[
              { value: 'name', label: 'By name' },
              { value: 'on_hand', label: 'Most on hand' },
              { value: 'value', label: 'Highest value' },
              { value: 'price', label: 'Highest price' },
              { value: 'sku', label: 'By SKU' },
            ]}
            className="min-w-0 flex-1 @min-[480px]:w-44 @min-[480px]:flex-none"
          />
          <Segmented
            ariaLabel="View"
            onShell
            value={view}
            onChange={(v) => {
              setView(v);
              saveView(v);
            }}
            options={[
              { value: 'cards', label: 'Cards', icon: LayoutGrid },
              { value: 'list', label: 'List', icon: List },
            ]}
          />
        </div>
      </div>

      {list.error !== null && data === null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : data !== null && items.length === 0 ? (
        <Card>
          <Empty
            icon={PackageSearch}
            title={filtered ? 'Nothing matches' : 'No items yet'}
            action={
              filtered ? (
                <TextLink onClick={clear}>Clear the filters</TextLink>
              ) : canCatalog ? (
                <PillButton icon={PackagePlus} dot onClick={(e) => editor.create(e.currentTarget)}>
                  Add your first item
                </PillButton>
              ) : undefined
            }
          >
            {filtered ? 'Try another search or filter.' : 'Add items one by one, import a spreadsheet, or ask your AI agent to set them up.'}
          </Empty>
        </Card>
      ) : data === null ? (
        <div className="grid grid-cols-2 gap-3 @min-[480px]:gap-4 @min-[640px]:grid-cols-3 @min-[1100px]:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-64" rounded="rounded-[24px]" />
          ))}
        </div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-2 gap-3 @min-[480px]:gap-4 @min-[640px]:grid-cols-3 @min-[1100px]:grid-cols-4">
          {items.map((it, i) => (
            <div key={it.id} className={i < 12 ? `erp-rise erp-d${Math.min(5, Math.floor(i / 3) + 1)}` : ''}>
              <ItemCard
                item={it}
                currency={currency}
                selecting={selecting}
                selected={selected.has(it.id)}
                onToggle={() =>
                  setSelected((cur) => {
                    const n = new Set(cur);
                    if (n.has(it.id)) n.delete(it.id);
                    else n.add(it.id);
                    return n;
                  })
                }
                onQuick={canAdjust ? quick : undefined}
              />
            </div>
          ))}
        </div>
      ) : (
        <Card className="!p-3 @min-[640px]:!p-4" delay={3}>
          <DataTable
            ariaLabel="Items"
            rows={items}
            columns={columns}
            rowKey={(r) => r.id}
            onOpen={(r) => navigate('item', { id: r.id })}
            rowTone={(r) => (r.archived ? 'muted' : r.kind === 'stock' && r.status === 'out' ? 'alert' : undefined)}
            selected={selecting ? selected : undefined}
            onSelect={selecting ? setSelected : undefined}
            mobile={(r) => ({
              lead: <ItemThumb photo={r.photo} icon={r.category?.icon} size={40} rounded="rounded-[12px]" tone="card" />,
              title: r.name,
              sub: `${r.sku}${r.kind !== 'stock' ? ` · ${KIND_LABEL[r.kind]}` : r.status === 'low' ? ' · Low' : r.status === 'out' ? ' · Out of stock' : ''}`,
              right: r.kind === 'stock' ? `${qty(r.on_hand)}` : r.sale_price_e4 > 0 ? price(r.sale_price, currency) : '',
              rightSub: r.kind === 'stock' ? r.unit : '',
            })}
          />
        </Card>
      )}
      <div ref={sentinel} className="h-10" />
      {more && <p className="text-center text-[12px] text-[var(--erp-muted)]">Loading more</p>}

      {selecting && (
        <SelectionBar count={selected.size} onClear={stopSelecting}>
          {chip === 'archived' ? (
            <PillButton size="sm" variant="accent" icon={ArchiveRestore} onClick={() => void archive(false)}>
              Restore
            </PillButton>
          ) : (
            <PillButton size="sm" variant="accent" icon={Archive} onClick={() => void archive(true)}>
              Archive
            </PillButton>
          )}
          {canOrder && chip !== 'archived' && <AskAgent kind="reorder_review" label="Draft reorders" variant="light" size="sm" onAsked={stopSelecting} />}
        </SelectionBar>
      )}
      {selecting && selected.size === 0 && (
        <div className="erp-pop erp-on-ink fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-[22px] bg-[var(--erp-ink)] px-4 py-3 text-[var(--erp-shell)] md:bottom-6">
          <span className="flex-1 text-[14px] font-semibold">Choose items</span>
          <button type="button" onClick={() => setSelected(new Set(items.map((i) => i.id)))} className="rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--erp-shell)]/10">
            All shown
          </button>
          <PillButton size="sm" variant="accent" onClick={stopSelecting}>
            Done
          </PillButton>
        </div>
      )}
      {editor.node}
      {change.node}
    </div>
  );
}

function DarkFigure({ label, value, sub, tone, onClick }: { label: string; value: string; sub: string; tone?: 'red' | 'amber' | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">
        {tone !== undefined && <span aria-hidden className={cn('size-2 rounded-full', tone === 'red' ? 'bg-[var(--erp-red)]' : 'bg-[var(--erp-amber)]')} />}
        {label}
      </span>
      <span className="num mt-0.5 block text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{value}</span>
      <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">{sub}</span>
    </>
  );
  if (onClick === undefined) return <div className="min-w-0">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-[14px] text-left transition-transform active:scale-[0.98]">
      {body}
    </button>
  );
}

function ItemCard({
  item,
  currency,
  selecting,
  selected,
  onToggle,
  onQuick,
}: {
  item: Item;
  currency: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onQuick: ((el: Element, it: Item, mode: ChangeMode) => void) | undefined;
}): React.JSX.Element {
  const Icon = iconOf(item.category?.icon);
  const src = photoSrc(item.photo, '480x480');
  const stock = item.kind === 'stock';
  return (
    <div className={cn('relative flex h-full flex-col overflow-hidden rounded-[24px] bg-[var(--erp-card)] transition-shadow hover:shadow-[var(--erp-pop-shadow)]', selected && 'ring-2 ring-[var(--erp-ink)]', item.archived && 'text-[var(--erp-muted)]')}>
      <button type="button" onClick={() => (selecting ? onToggle() : navigate('item', { id: item.id }))} className="flex flex-1 flex-col text-left" aria-label={selecting ? `Select ${item.name}` : item.name} aria-pressed={selecting ? selected : undefined}>
        <span className="relative block p-2 pb-0">
          {src !== null ? (
            <img src={src} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-[18px] object-cover" />
          ) : (
            <span aria-hidden className="erp-on-sand flex aspect-[4/3] w-full items-center justify-center rounded-[18px] bg-[var(--erp-sand)] text-[var(--erp-ink-2)]">
              <Icon size={36} strokeWidth={1.5} />
            </span>
          )}
          <span className="absolute left-4 top-4">
            <ItemStatusPill status={item.status} kind={item.kind} archived={item.archived} size="sm" />
          </span>
          {selecting && (
            <span className={cn('absolute right-4 top-4 flex size-7 items-center justify-center rounded-full border-2', selected ? 'erp-on-ink border-[var(--erp-ink)] bg-[var(--erp-ink)]' : 'border-[var(--erp-card)] bg-[var(--erp-card)]')}>
              {selected && <span className="size-2.5 rounded-full bg-[var(--erp-accent)]" />}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-2 p-4 pt-3">
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold">{item.name}</span>
            <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{item.category !== null ? `${item.sku} · ${item.category.name}` : item.sku}</span>
          </span>
          {stock ? (
            <>
              <span className="flex items-baseline gap-1.5">
                <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{qty(item.on_hand)}</span>
                <span className="truncate text-[13px] text-[var(--erp-muted)]">{item.unit}</span>
              </span>
              <LevelBar onHand={item.on_hand} min={item.min_qty} max={item.max_qty} status={item.status} />
            </>
          ) : (
            <span className="flex items-baseline gap-1.5">
              <span className="num text-[15px] font-bold">{item.sale_price_e4 > 0 ? price(item.sale_price, currency) : 'No price'}</span>
              <span className="text-[13px] text-[var(--erp-muted)]">per {item.unit}</span>
            </span>
          )}
        </span>
      </button>
      {stock && !selecting && !item.archived && onQuick !== undefined && (
        // Over the bottom corner of the picture, where nothing else sits.
        <span className="pointer-events-none absolute inset-x-2 top-2 flex aspect-[4/3] items-end justify-end p-2">
          <span className="pointer-events-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={`Take out ${item.name}`}
            title="Stock out"
            disabled={item.on_hand <= 0}
            onClick={(e) => onQuick(e.currentTarget, item, 'out')}
            className="flex size-9 items-center justify-center rounded-full bg-[var(--erp-card)] text-[var(--erp-ink)] ring-1 ring-[var(--erp-line)] transition-transform hover:bg-[var(--erp-row)] active:scale-90 disabled:opacity-35"
          >
            <Minus size={15} strokeWidth={2.4} />
          </button>
          <button type="button" aria-label={`Add ${item.name}`} title="Stock in" onClick={(e) => onQuick(e.currentTarget, item, 'in')} className="erp-on-ink flex size-9 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-shell)] transition-transform active:scale-90">
            <Plus size={15} strokeWidth={2.4} />
          </button>
          </span>
        </span>
      )}
    </div>
  );
}

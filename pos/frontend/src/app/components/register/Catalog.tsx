/**
 * The register's catalog: category pills across the top (Favorites, All,
 * then each category with its icon and color), then the product tiles: a
 * soft rounded square with the photo (or the category's icon on its tint),
 * the name under it and the price when the shop shows it.
 * A tap adds the product, or opens its options when it has sizes or
 * required choices. Holding a tile (or right-clicking it) opens its menu:
 * options, sold out, favorite, edit. In arrange mode tiles are dragged into
 * the order the counter wants (per category, and for Favorites).
 *
 * Typing in the search box lists matches by name, SKU or barcode; Enter on
 * an exact code adds it, the same as scanning it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calculator, Check, GripVertical, LayoutGrid, Pencil, Plus, Star, Undo2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { money } from '../../lib/format.ts';
import { catVars, iconFor } from '../../lib/icons.tsx';
import { navigate } from '../../lib/router.ts';
import { can } from '../../lib/session.ts';
import type { CatalogProduct } from '../../lib/types.ts';
import { RollingText } from '../RollingText.tsx';
import { Badge, Button, Card, Empty, Modal, menuItem } from '../ui.tsx';

export type CatalogView = 'favorites' | 'all' | string;

const VIEW_KEY = 'pos.catalog.view';

export function readView(): CatalogView {
  try {
    return window.localStorage.getItem(VIEW_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function storeView(v: CatalogView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* per-browser convenience only */
  }
}

/** The price a tile shows: its price, "from" its cheapest variant, or "Open price". */
export function tilePrice(p: CatalogProduct, currency: string, exp: number): string {
  if (p.open_price) return 'Enter price';
  if (p.variants.length > 0) {
    const prices = p.variants.map((v) => v.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? money(lo, currency, exp) : `from ${money(lo, currency, exp)}`;
  }
  return money(p.price, currency, exp);
}

function ChipButton({ active, onClick, icon: Icon, label, color }: { active: boolean; onClick: () => void; icon?: LucideIcon; label: string; color?: number }): React.JSX.Element {
  const c = color !== undefined ? catVars(color) : null;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'ps-press inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full text-[14px] font-semibold',
        Icon !== undefined ? 'pl-1.5 pr-4' : 'px-5',
        active ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row)]',
      )}
    >
      {Icon !== undefined && (
        <span
          aria-hidden
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', c === null && (active ? 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink)]'))}
          style={c !== null ? { background: c.soft, color: c.text } : undefined}
        >
          <Icon size={16} />
        </span>
      )}
      {label}
    </button>
  );
}

/**
 * A product tile: the square card is the photo (or the category's icon on
 * its tint), with the name centered under it (a long name rolls) and, when
 * the shop shows prices on tiles, the price under the name.
 */
function Tile({
  p,
  currency,
  exp,
  showPrice,
  onPick,
  onMenu,
  arranging,
  dragProps,
}: {
  p: CatalogProduct;
  currency: string;
  exp: number;
  showPrice: boolean;
  onPick: (p: CatalogProduct, el: HTMLElement) => void;
  onMenu: (p: CatalogProduct) => void;
  arranging: boolean;
  dragProps: React.HTMLAttributes<HTMLButtonElement> & { draggable?: boolean };
}): React.JSX.Element {
  const c = catVars(p.color);
  const Icon = iconFor(p.icon);
  const [broken, setBroken] = useState(false);
  const photo = p.thumb_url !== '' && !broken;
  const mark = 'flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)]';
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const startHold = (): void => {
    held.current = false;
    if (arranging) return;
    hold.current = window.setTimeout(() => {
      held.current = true;
      onMenu(p);
    }, 550);
  };
  const endHold = (): void => {
    if (hold.current !== null) window.clearTimeout(hold.current);
    hold.current = null;
  };
  const stock = p.track_stock ? p.stock ?? 0 : null;
  return (
    <button
      type="button"
      aria-label={`${p.name}${showPrice ? ', ' + tilePrice(p, currency, exp) : ''}${!p.available ? ', sold out' : ''}`}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onContextMenu={(e) => {
        e.preventDefault();
        endHold();
        if (!arranging) onMenu(p);
      }}
      onClick={(e) => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (arranging) return;
        if (!p.available) {
          onMenu(p);
          return;
        }
        onPick(p, e.currentTarget);
      }}
      {...dragProps}
      className={cn('ps-press group flex min-w-0 flex-col text-center', arranging && 'cursor-grab active:cursor-grabbing')}
    >
      <span
        style={{ background: c.soft, color: c.text }}
        className={cn('relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[22px]', arranging && 'outline-dashed outline-2 -outline-offset-2 outline-[var(--ps-line)]')}
      >
        {photo ? (
          <img src={p.thumb_url} srcSet={`${p.thumb_url} 1x, ${p.tile_url} 2x`} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" draggable={false} />
        ) : (
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)]">
            <Icon size={24} />
          </span>
        )}
        <span className="absolute right-2.5 top-2.5 flex">
          {arranging ? (
            <span aria-hidden className={mark}>
              <GripVertical size={16} />
            </span>
          ) : !p.available ? (
            <Badge tone="bad" className="bg-[var(--ps-card)]">
              Sold out
            </Badge>
          ) : stock !== null && (stock <= 0 || p.low) ? (
            <Badge tone="warn" className="bg-[var(--ps-card)]">
              {stock <= 0 ? 'None left' : `${stock} left`}
            </Badge>
          ) : p.favorite ? (
            <span aria-hidden className={mark}>
              <Star size={14} fill="currentColor" />
            </span>
          ) : null}
        </span>
      </span>
      <RollingText text={p.name} className="mt-2 text-[14px] font-bold leading-[18px] text-[var(--ps-ink)]" textClassName={!p.available ? 'line-through' : undefined} />
      {showPrice && <span className="num text-[13px] font-semibold leading-[18px] text-[var(--ps-ink-2)]">{tilePrice(p, currency, exp)}</span>}
    </button>
  );
}

/** The menu a held tile opens. */
function TileMenu({ p, onClose, onOptions }: { p: CatalogProduct; onClose: () => void; onOptions: (p: CatalogProduct) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const hasOptions = p.variants.length > 0 || p.modifier_groups.length > 0 || p.open_price;
  const run = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={p.name} description={p.available ? undefined : 'Sold out'}>
      <div className="ps-on-card flex flex-col gap-1 rounded-[22px] bg-[var(--ps-card)] p-2">
        {p.available && (
          <button type="button" className={menuItem} onClick={() => onOptions(p)}>
            <LayoutGrid size={16} /> {hasOptions ? 'Choose size and options' : 'Add with a note or quantity'}
          </button>
        )}
        <button type="button" disabled={busy} className={menuItem} onClick={() => void run(() => api.setAvailable(p.id, !p.available), p.available ? `${p.name} is sold out` : `${p.name} is back`)}>
          {p.available ? <Undo2 size={16} /> : <Check size={16} />}
          {p.available ? 'Mark as sold out' : 'Back in stock'}
        </button>
        {can('catalog') && (
          <>
            <button type="button" disabled={busy} className={menuItem} onClick={() => void run(() => api.updateProduct({ product: p.id, favorite: !p.favorite }), p.favorite ? 'Removed from favorites' : 'Added to favorites')}>
              <Star size={16} /> {p.favorite ? 'Remove from favorites' : 'Add to favorites'}
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                onClose();
                navigate('products', { id: p.id });
              }}
            >
              <Pencil size={16} /> Edit product
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Catalog({
  query,
  onPick,
  onOptions,
  onKeypad,
  arranging,
  onArrangeDone,
}: {
  query: string;
  onPick: (p: CatalogProduct, el: HTMLElement | null) => void;
  onOptions: (p: CatalogProduct) => void;
  onKeypad: () => void;
  arranging: boolean;
  onArrangeDone: () => void;
}): React.JSX.Element {
  const { catalog, currency, exp, categoryById, settings } = useApp();
  const showPrice = settings?.show_tile_prices !== false;
  const [view, setView] = useState<CatalogView>(readView);
  const [menu, setMenu] = useState<CatalogProduct | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const drag = useRef<string | null>(null);
  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const hasFavorites = products.some((p) => p.favorite);

  useEffect(() => {
    if (view !== 'all' && view !== 'favorites' && !categoryById.has(view)) setView('all');
    if (view === 'favorites' && !hasFavorites && products.length > 0) setView('all');
  }, [view, categoryById, hasFavorites, products.length]);

  // Tiles are arranged per category (and for Favorites): arranging from All starts on the first one.
  useEffect(() => {
    if (!arranging || view !== 'all') return;
    const first = hasFavorites ? 'favorites' : categories[0]?.id;
    if (first !== undefined) setView(first);
  }, [arranging, view, hasFavorites, categories]);

  const choose = (v: CatalogView): void => {
    setView(v);
    storeView(v);
    setOrder(null);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q !== '') {
      return products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcodes.some((b) => b.code.toLowerCase().includes(q)) ||
          p.variants.some((v) => v.sku.toLowerCase().includes(q) || `${p.name} ${v.name}`.toLowerCase().includes(q)),
      );
    }
    if (view === 'favorites') return products.filter((p) => p.favorite).sort((a, b) => a.fav_sort - b.fav_sort);
    if (view === 'all') {
      const catSort = new Map(categories.map((c) => [c.id, c.sort]));
      return products.slice().sort((a, b) => (catSort.get(a.category) ?? 1e9) - (catSort.get(b.category) ?? 1e9) || a.sort - b.sort);
    }
    return products.filter((p) => p.category === view).sort((a, b) => a.sort - b.sort);
  }, [products, categories, view, query]);

  const arranged = order !== null ? order.map((id) => shown.find((p) => p.id === id)).filter((p): p is CatalogProduct => p !== undefined) : shown;
  const canArrange = arranging && query.trim() === '' && view !== 'all';

  const saveOrder = async (): Promise<void> => {
    if (order === null) {
      onArrangeDone();
      return;
    }
    try {
      await api.reorderProducts(order, view === 'favorites');
      toast.success('Saved the order');
      setOrder(null);
      onArrangeDone();
    } catch {
      /* toasted */
    }
  };

  const dragProps = (p: CatalogProduct): React.HTMLAttributes<HTMLButtonElement> & { draggable?: boolean } =>
    canArrange
      ? {
          draggable: true,
          onDragStart: (e) => {
            drag.current = p.id;
            e.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: (e) => {
            e.preventDefault();
            const from = drag.current;
            if (from === null || from === p.id) return;
            const ids = (order ?? shown.map((x) => x.id)).slice();
            const a = ids.indexOf(from);
            const b = ids.indexOf(p.id);
            if (a < 0 || b < 0) return;
            ids.splice(a, 1);
            ids.splice(b, 0, from);
            setOrder(ids);
          },
          onDrop: (e) => {
            e.preventDefault();
            drag.current = null;
          },
        }
      : {};

  return (
    <div className="flex flex-col gap-4">
      {query.trim() === '' && (
        <div role="tablist" aria-label="Categories" className="ps-rise ps-no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1">
          <ChipButton active={false} onClick={onKeypad} icon={Calculator} label="Amount" />
          {hasFavorites && <ChipButton active={view === 'favorites'} onClick={() => choose('favorites')} icon={Star} label="Favorites" />}
          <ChipButton active={view === 'all'} onClick={() => choose('all')} label="All" />
          {categories.map((c) => (
            <ChipButton key={c.id} active={view === c.id} onClick={() => choose(c.id)} icon={iconFor(c.icon)} label={c.name} color={c.color} />
          ))}
        </div>
      )}
      {arranging && (
        <div className="ps-on-sand ps-pop flex items-center gap-3 rounded-full bg-[var(--ps-sand)] py-1.5 pl-1.5 pr-1.5">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ps-solid)] text-[var(--ps-on-solid)]">
            <GripVertical size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">Arranging {view === 'favorites' ? 'Favorites' : (categoryById.get(view)?.name ?? '')}</span>
          <Button
            size="sm"
            variant="light"
            onClick={() => {
              setOrder(null);
              onArrangeDone();
            }}
          >
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void saveOrder()}>
            Done
          </Button>
        </div>
      )}
      {products.length === 0 ? (
        <Card>
          <Empty
            icon={LayoutGrid}
            title="No products yet"
            action={
              can('catalog') ? (
                <Button variant="primary" icon={Plus} dot onClick={() => navigate('products', { new: '1' })}>
                  Add products
                </Button>
              ) : undefined
            }
          >
            {can('catalog') ? 'Add them one by one, import a spreadsheet, or give your AI agent a photo of your menu.' : 'Ask a manager to add products.'}
          </Empty>
        </Card>
      ) : arranged.length === 0 ? (
        <Card>
          <Empty icon={LayoutGrid} title={query.trim() !== '' ? `Nothing matches "${query.trim()}"` : 'Nothing in this category yet'} compact />
        </Card>
      ) : (
        <div className="ps-rise ps-d1 grid grid-cols-2 gap-x-3 gap-y-4 min-[520px]:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]">
          {arranged.map((p) => (
            <Tile key={p.id} p={p} currency={currency} exp={exp} showPrice={showPrice} onPick={onPick} onMenu={setMenu} arranging={canArrange} dragProps={dragProps(p)} />
          ))}
        </div>
      )}
      {menu !== null && (
        <TileMenu
          p={menu}
          onClose={() => setMenu(null)}
          onOptions={(p) => {
            setMenu(null);
            onOptions(p);
          }}
        />
      )}
    </div>
  );
}

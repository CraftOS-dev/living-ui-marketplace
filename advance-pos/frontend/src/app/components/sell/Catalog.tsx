/**
 * The product side of the sell screen: one search field that also takes
 * typed and scanned codes, category tabs (favorites first), the product
 * tiles (a square picture, the name under it, the price when the store
 * shows it), and the keypad for amounts that are not products. A tile adds
 * its product at once when there is nothing to choose; otherwise it opens
 * the item sheet (variants, options, weight).
 */
import { useMemo, useRef, useState } from 'react';
import { Calculator, Gift, ImageOff, LayoutGrid, Star } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { abbreviation } from '../../lib/format.ts';
import { useScanner } from '../../lib/scanner.ts';
import type { Product, Variant } from '../../lib/types.ts';
import { RollingText } from '../RollingText.tsx';
import { SearchField, tile } from '../common.tsx';
import { AmountPad, AmountReadout } from '../pads.tsx';
import { Button, Segmented, inputCls } from '../ui.tsx';

export type Pick = (product: Product, variant: Variant | null, opts?: { qty?: number }) => void;

const ALL = '__all';
const FAV = '__fav';
const KEYPAD = '__keypad';

/** A product needs the item sheet when there is a choice to make (or a weight to enter). */
export function needsSheet(p: Product, groups: Map<string, { min: number }>): boolean {
  const live = p.variants.filter((v) => !v.archived);
  if (live.length !== 1) return true;
  if (p.sold_by === 'weight') return true;
  return p.modifier_groups.some((g) => (groups.get(g)?.min ?? 0) > 0);
}

function priceText(p: Product, fmt: (n: number) => string): string {
  return p.price_min === p.price_max ? fmt(p.price_min) : fmt(p.price_min) + ' +';
}

/**
 * A product tile: the square card is the picture (or the product's initials
 * in its color), with the name centered under it (a long name rolls) and,
 * when the store shows prices on tiles, the price under the name.
 */
function Tile({ p, showPrice, onPress }: { p: Product; showPrice: boolean; onPress: () => void }): React.JSX.Element {
  const { money, catalog } = useStore();
  // A product without its own color wears its category's.
  const color = p.color !== 'neutral' ? p.color : ((catalog?.categories ?? []).find((c) => p.category !== null && c.id === p.category.id)?.color ?? 'neutral');
  const live = p.variants.filter((v) => !v.archived);
  const out = p.status === 'out';
  const [broken, setBroken] = useState(false);
  const img = p.image !== '' && !broken ? p.image : '';
  return (
    <button type="button" onClick={onPress} title={p.name} className="group flex min-w-0 touch-manipulation flex-col text-center">
      <span
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--ps-r-md)] border border-[var(--ps-line)] bg-[var(--ps-card)] transition-[transform,box-shadow] group-hover:shadow-[var(--ps-shadow)] group-active:scale-[0.98]"
        style={img === '' ? tile(color) : undefined}
      >
        {img !== '' && <img src={img + '?thumb=160x160'} srcSet={`${img}?thumb=160x160 1x, ${img}?thumb=480x480 2x`} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />}
        {img === '' && (p.image !== '' ? <ImageOff size={18} className="opacity-50" /> : <span className="text-[26px] font-bold leading-none tracking-wide">{abbreviation(p.name)}</span>)}
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {live.length > 1 && <span className="rounded-[var(--ps-r-sm)] bg-[var(--ps-card)] px-1 text-[12px] font-bold text-[var(--ps-ink-2)] shadow-[var(--ps-shadow-sm)]">{live.length}</span>}
          {p.status === 'low' && <span className="rounded-[var(--ps-r-sm)] bg-[var(--ps-amber)] px-1 text-[12px] font-bold text-[var(--ps-on-amber)]">Low</span>}
          {out && <span className="rounded-[var(--ps-r-sm)] bg-[var(--ps-red)] px-1 text-[12px] font-bold text-[var(--ps-on-red)]">Out</span>}
        </span>
      </span>
      <RollingText text={p.name} className="mt-1.5 text-[13px] font-semibold leading-[18px]" />
      {showPrice && (
        <span className="num text-[12px] font-semibold leading-4 text-[var(--ps-ink-2)]">
          {priceText(p, money.fmt)}
          {p.sold_by === 'weight' && p.unit !== '' ? ' / ' + p.unit : ''}
        </span>
      )}
    </button>
  );
}

/** The keypad tab: an amount that is not a product (or a gift card). */
function Keypad({ onAdd, onGiftCard }: { onAdd: (amount: number, name: string, taxed: boolean) => Promise<boolean>; onGiftCard: () => void }): React.JSX.Element {
  const { money, catalog } = useStore();
  const [amount, setAmount] = useState(0);
  const [name, setName] = useState('');
  const hasTax = (catalog?.taxes ?? []).some((t) => t.is_default);
  const [taxed, setTaxed] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    if (amount <= 0 || busy) return;
    setBusy(true);
    const ok = await onAdd(amount, name.trim(), hasTax && taxed === 'yes');
    setBusy(false);
    if (ok) {
      setAmount(0);
      setName('');
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-col gap-3 py-2">
      <AmountReadout minor={amount} digits={money.digits} symbol={money.symbol} className="rounded-[var(--ps-r-md)] bg-[var(--ps-card)] py-4" />
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on the receipt (optional)" maxLength={120} />
      {hasTax && (
        <Segmented
          label="Tax"
          value={taxed}
          onChange={setTaxed}
          options={[
            { value: 'yes', label: 'With tax' },
            { value: 'no', label: 'No tax' },
          ]}
          className="self-center"
        />
      )}
      <AmountPad value={amount} onChange={setAmount} onEnter={() => void add()} />
      <Button variant="primary" size="lg" className="h-11 text-[14px]" disabled={amount <= 0} loading={busy} onClick={() => void add()}>
        Add {money.fmt(amount)}
      </Button>
      <Button variant="ghost" icon={Gift} onClick={onGiftCard}>
        Sell a gift card
      </Button>
    </div>
  );
}

export function Catalog({ onPick, onCustom, onGiftCard, scanEnabled }: { onPick: Pick; onCustom: (amount: number, name: string, taxed: boolean) => Promise<boolean>; onGiftCard: () => void; scanEnabled: boolean }): React.JSX.Element {
  const { catalog, settings } = useStore();
  const showPrice = settings?.show_tile_prices !== false;
  const products = useMemo(() => (catalog?.products ?? []).filter((p) => !p.archived && p.variants.some((v) => !v.archived)), [catalog]);
  const favorites = products.filter((p) => p.favorite);
  const [tab, setTab] = useState<string>(() => (favorites.length > 0 ? FAV : ALL));
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Codes (SKU and barcode, case-insensitive) to their variant.
  const byCode = useMemo(() => {
    const m = new Map<string, { product: Product; variant: Variant }>();
    for (const p of products)
      for (const v of p.variants) {
        if (v.archived) continue;
        if (v.barcode !== '') m.set(v.barcode.toLowerCase(), { product: p, variant: v });
        if (v.sku !== '') m.set(v.sku.toLowerCase(), { product: p, variant: v });
      }
    return m;
  }, [products]);

  /** A scanned or typed code: add that variant (or say there is none). */
  const byCodeAdd = async (code: string): Promise<boolean> => {
    const hit = byCode.get(code.trim().toLowerCase());
    if (hit !== undefined) {
      onPick(hit.product, hit.variant);
      return true;
    }
    try {
      const r = await api.lookup(code.trim());
      onPick(r.product, r.variant);
      return true;
    } catch {
      toast.error('No product has the code ' + code.trim());
      return false;
    }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term !== '') {
      return products.filter((p) => p.name.toLowerCase().includes(term) || p.variants.some((v) => v.sku.toLowerCase().includes(term) || v.barcode.toLowerCase() === term || v.title.toLowerCase().includes(term)));
    }
    if (tab === FAV) return favorites;
    if (tab === ALL || tab === KEYPAD) return products;
    return products.filter((p) => p.category !== null && p.category.id === tab);
  }, [q, tab, products, favorites]);

  const cats = (catalog?.categories ?? []).filter((c) => products.some((p) => p.category !== null && p.category.id === c.id));
  const tabs: { id: string; label: string; color?: string; icon?: typeof Star }[] = [
    ...(favorites.length > 0 ? [{ id: FAV, label: 'Favorites', icon: Star }] : []),
    { id: ALL, label: 'All', icon: LayoutGrid },
    ...cats.map((c) => ({ id: c.id, label: c.name, color: c.color })),
    { id: KEYPAD, label: 'Keypad', icon: Calculator },
  ];
  const showing = q.trim() !== '' ? 'search' : tab === KEYPAD ? 'keypad' : 'grid';
  // The keypad takes typed digits itself; scans go to the item sheet or here otherwise.
  useScanner((code) => void byCodeAdd(code), scanEnabled && showing !== 'keypad');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--ps-line)] bg-[var(--ps-card)] px-3 pb-2 pt-3">
        <SearchField
          inputRef={searchRef}
          value={q}
          onChange={setQ}
          placeholder="Search products, or type a barcode or SKU"
          onEnter={() => {
            const term = q.trim();
            if (term === '') return;
            if (byCode.has(term.toLowerCase())) {
              void byCodeAdd(term).then((ok) => ok && setQ(''));
              return;
            }
            if (shown.length === 1 && shown[0] !== undefined) {
              const p = shown[0];
              const live = p.variants.filter((v) => !v.archived);
              onPick(p, live.length === 1 ? (live[0] ?? null) : null);
              setQ('');
              return;
            }
            void byCodeAdd(term).then((ok) => ok && setQ(''));
          }}
          className="[&_input]:h-9 [&_input]:text-[14px]"
        />
        <div role="tablist" aria-label="Categories" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {tabs.map((t) => {
            const on = q.trim() === '' && t.id === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setTab(t.id);
                  setQ('');
                }}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--ps-r)] px-3 text-[13px] font-semibold transition-colors', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] text-[var(--ps-ink-2)] hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-ink)]')}
              >
                {Icon !== undefined ? <Icon size={14} /> : <span aria-hidden className="size-2 rounded-full" style={{ background: `var(--ps-dot-${t.color ?? 'neutral'})` }} />}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ps-shell)] p-3 pb-20 md:pb-3">
        {showing === 'keypad' ? (
          <Keypad onAdd={onCustom} onGiftCard={onGiftCard} />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <p className="text-[13px] font-bold">{q.trim() !== '' ? 'Nothing matches "' + q.trim() + '"' : products.length === 0 ? 'No products yet' : 'Nothing in this category'}</p>
            {products.length === 0 && <p className="mt-1 max-w-xs text-[12px] text-[var(--ps-muted)]">Add products in Products, import a CSV, or ask your AI agent to set up the catalog.</p>}
            {products.length === 0 && (
              <a href="#/product?id=new" className="mt-3 text-[12px] font-semibold text-[var(--ps-accent-text)] underline-offset-4 hover:underline">
                Add a product
              </a>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-2 gap-y-3">
            {shown.map((p) => (
              <Tile key={p.id} p={p} showPrice={showPrice} onPress={() => onPick(p, null)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

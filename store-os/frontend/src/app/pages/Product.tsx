/**
 * The product editor, one page for a new product (#/product/new) and a
 * saved one (#/product/<id>), in two columns like a shop. Main column:
 * details, media (the pictures, the cover large), pricing and inventory
 * while it is one SKU, variants, and facts. Side column: status,
 * organization and the shops it is listed on (each listing opens in a
 * side panel). A new product is checked and created in one go, pictures
 * after; a saved one saves each field when you leave it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, ChevronRight, ClipboardCheck, FileText, History, PackagePlus, PackageX, Plus, Sparkles, Store, Trash2, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { OpError, op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { useBase, useStore } from '../lib/store.tsx';
import { currencySign, day, money, num, pct, plural } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import { notify } from '../lib/toast.tsx';
import type { Listing, ProductDetail, ProductList, ShopRef, Variant } from '../lib/types.ts';
import { openAddShop } from '../components/Shell.tsx';
import { ListingPill } from '../components/badges.tsx';
import { PlatformMark, PLATFORM_NAME } from '../components/PlatformMark.tsx';
import { ListingDrawer } from '../components/ListingDrawer.tsx';
import { DraftMedia, ProductMedia } from '../components/MediaCard.tsx';
import type { LocalPicture } from '../components/MediaCard.tsx';
import { MAX_SKUS, OptionsEditor, rowsOf } from '../components/OptionsEditor.tsx';
import type { OptionDraft, RowEdit, RowFlags, VariantRow } from '../components/OptionsEditor.tsx';
import { PrepareDialog, ProductThumb, StockDialog, StockLedger, addImages, amountText, parseAmount } from '../components/ProductDialogs.tsx';
import type { StockMode, StockTarget } from '../components/ProductDialogs.tsx';
import { Cell, CellInput, ChipInput, Choice, FigureBox, HelpLabel, Labeled, SourcePill, bindState, chars, isOpenTask, parseCount, smallField, useEditable } from '../components/ProductParts.tsx';
import type { Bound } from '../components/ProductParts.tsx';
import { SkuCard, availableClass, saveCost, saveCount, savePrice, saveSku, stockTarget, updateVariant } from '../components/SkuTable.tsx';
import { Button, Card, CardHeader, Checkbox, Empty, Field, IconButton, Menu, PageHeader, Pill, Skeleton, TaskBadge, TextArea, TextInput, confirmAsk } from '../components/ui.tsx';
import type { MenuItem, Tone } from '../components/ui.tsx';

const READS: Collection[] = ['products', 'variants', 'listings', 'stock_moves', 'orders', 'order_lines', 'shops', 'tasks'];
const COLUMNS = 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]';

type Status = ProductDetail['status'];
const STATUS_LABEL: Record<Status, string> = { active: 'Active', draft: 'Draft', archived: 'Archived' };
const STATUS_TONE: Record<Status, Tone> = { active: 'good', draft: 'neutral', archived: 'warn' };

/** `{ error }` for a Field, only when there is one. */
function errorOf(e: string | undefined): { error?: string } {
  return e === undefined ? {} : { error: e };
}

function BackLink({ onClick }: { onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void }): React.JSX.Element {
  return (
    <a href={href('products')} onClick={onClick} className="mb-2 inline-flex h-8 items-center gap-1.5 text-[13px] font-semibold text-[var(--so-muted)] hover:text-[var(--so-ink)]">
      <ArrowLeft size={14} strokeWidth={2} aria-hidden />
      Products
    </a>
  );
}

export function ProductPage({ id }: { id: string }): React.JSX.Element {
  if (id === 'new') return <NewProduct />;
  return <SavedProduct key={id} id={id} />;
}

/** Brands and categories already in the catalog, offered while typing. */
function CatalogHints(): React.JSX.Element {
  const l = useLive<ProductList>('products:hints', (signal) => op<ProductList>('products.list', { status: 'all', limit: 500 }, { signal, quiet: true }), ['products']);
  const { brands, categories } = useMemo(() => {
    const b = new Set<string>();
    const c = new Set<string>();
    for (const r of l.data?.products ?? []) {
      if (r.brand.trim() !== '') b.add(r.brand.trim());
      if (r.category.trim() !== '') c.add(r.category.trim());
    }
    return { brands: [...b].sort(), categories: [...c].sort() };
  }, [l.data]);
  return (
    <>
      <datalist id="so-brands">
        {brands.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id="so-categories">
        {categories.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  );
}

/* =================================================================== cards */

function DetailsCard({ title, description, titleError, autoFocus = false }: { title: Bound; description: Bound; titleError?: string | undefined; autoFocus?: boolean }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Details" />
      <div className="grid gap-4">
        <Field label="Title" {...errorOf(titleError)}>
          <TextInput autoFocus={autoFocus} placeholder="e.g. Speckled stoneware mug" maxLength={300} aria-invalid={titleError !== undefined || undefined} className={cn(titleError !== undefined && 'ring-2 ring-[var(--so-red)]')} {...title} />
        </Field>
        <Field label="Description" hint={<span className="num">{num(chars(description.value))} characters</span>}>
          <TextArea rows={8} placeholder="What it is, what it is made of, sizes, care, what is in the box" {...description} />
        </Field>
      </div>
    </Card>
  );
}

function PricingCard({ price, cost, cur, errors }: { price: Bound; cost: Bound; cur: string; errors?: { price?: string | undefined; cost?: string | undefined } }): React.JSX.Element {
  const { settings } = useStore();
  const sign = currencySign(cur);
  const pr = parseAmount(price.value);
  const co = parseAmount(cost.value);
  const hasPrice = typeof pr === 'number' && pr > 0;
  const hasCost = typeof co === 'number' && co > 0;
  const profit = hasPrice && hasCost ? pr - co : null;
  const margin = profit !== null && hasPrice ? (profit / pr) * 100 : null;
  const minMargin = settings?.guards.min_margin_pct ?? 0;
  const low = margin !== null && minMargin > 0 && margin < minMargin;
  return (
    <Card className="@container">
      <CardHeader title="Pricing" />
      <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
        <Field label="Price" {...errorOf(errors?.price)}>
          <TextInput prefix={sign} inputMode="decimal" placeholder="0.00" aria-invalid={errors?.price !== undefined || undefined} className={cn(errors?.price !== undefined && 'ring-2 ring-[var(--so-red)]')} {...price} />
        </Field>
        <Field label={<HelpLabel label="Cost per item" tip="What one costs you, so profit and margin are known. Buyers never see it." />} {...errorOf(errors?.cost)}>
          <TextInput prefix={sign} inputMode="decimal" placeholder="0.00" aria-invalid={errors?.cost !== undefined || undefined} className={cn(errors?.cost !== undefined && 'ring-2 ring-[var(--so-red)]')} {...cost} />
        </Field>
        {profit !== null && margin !== null ? (
          <>
            <FigureBox label="Profit" tone={profit < 0 ? 'bad' : 'ink'}>
              {money(profit, cur)}
            </FigureBox>
            <FigureBox label={low ? <HelpLabel label="Margin" tip={'Below your minimum margin of ' + pct(minMargin, 0)} /> : 'Margin'} tone={profit < 0 ? 'bad' : low ? 'warn' : 'ink'}>
              {pct(margin, 1)}
            </FigureBox>
          </>
        ) : (
          <FigureBox label="Profit and margin" tone="muted" className="col-span-2">
            {hasCost ? 'Add a price to see profit' : 'Add a cost to see profit'}
          </FigureBox>
        )}
      </div>
    </Card>
  );
}

function InventoryCard({
  sku,
  barcode,
  low,
  weight,
  stock,
  errors,
  skuHint,
}: {
  sku: Bound;
  barcode: Bound;
  low: Bound;
  weight: Bound;
  stock: ReactNode;
  errors?: { sku?: string | undefined; low?: string | undefined; weight?: string | undefined };
  skuHint?: string;
}): React.JSX.Element {
  const { settings } = useStore();
  const lowDefault = settings?.low_stock ?? 0;
  const bad = (e: string | undefined): { 'aria-invalid'?: true; className?: string } => (e === undefined ? {} : { 'aria-invalid': true, className: 'ring-2 ring-[var(--so-red)]' });
  return (
    <Card className="@container">
      <CardHeader title="Inventory" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="SKU" className="col-span-2 @lg:col-span-1" {...(skuHint !== undefined ? { hint: skuHint } : {})} {...errorOf(errors?.sku)}>
          <TextInput placeholder="e.g. MUG-SPK" maxLength={120} {...bad(errors?.sku)} {...sku} />
        </Field>
        <Field label="Barcode" hint="EAN, UPC or JAN" className="col-span-2 @lg:col-span-1">
          <TextInput maxLength={60} {...barcode} />
        </Field>
        <Field label={<HelpLabel label="Low-stock alert" tip={'Warn when available falls to this. Empty uses your store default of ' + String(lowDefault) + '.'} />} {...errorOf(errors?.low)}>
          <TextInput inputMode="numeric" placeholder={String(lowDefault)} {...bad(errors?.low)} {...low} />
        </Field>
        <Field label="Weight (g)" {...errorOf(errors?.weight)}>
          <TextInput inputMode="numeric" placeholder="0" {...bad(errors?.weight)} {...weight} />
        </Field>
      </div>
      <div className="mt-5 border-t border-[var(--so-line)] pt-4">{stock}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ facts */

const FACT_HINTS = ['Material', 'Size', 'Colour', 'Care', 'In the box', 'Made in'];

function FactLine({ keyCell, valueCell, source, onRemove, label }: { keyCell: ReactNode; valueCell: ReactNode; source: string; onRemove: () => void; label: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2 border-b border-[var(--so-line)] py-1.5 last:border-b-0 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto]">
      {keyCell}
      {valueCell}
      <SourcePill source={source} className="hidden @lg:inline-flex" />
      <IconButton icon={X} label={'Remove ' + label} variant="ghost" size={32} onClick={onRemove} />
    </div>
  );
}

/** Facts: the rows given, then a row to add one (with common names a tap away). */
function FactsCard({ children, count, used, onAdd }: { children: ReactNode; count: number; used: string[]; onAdd: (key: string, value: string) => Promise<boolean> }): React.JSX.Element {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const ready = key.trim() !== '' && value.trim() !== '';
  const add = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    const ok = await onAdd(key.trim(), value.trim());
    setBusy(false);
    if (ok) {
      setKey('');
      setValue('');
      keyRef.current?.focus();
    }
  };
  const enter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.currentTarget === keyRef.current && value.trim() === '') valueRef.current?.focus();
    else void add();
  };
  const hints = FACT_HINTS.filter((h) => !used.some((u) => u.toLowerCase() === h.toLowerCase())).slice(0, 5);
  return (
    <Card className="@container">
      <CardHeader title={<HelpLabel label="Facts" tip="What buyers ask about. Your AI agent writes listings and answers from these." />} subtitle={count === 0 ? 'Material, size, care: what buyers ask' : plural(count, 'fact')} />
      {count > 0 && <div className="mb-3 grid">{children}</div>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
        <input ref={keyRef} aria-label="New fact" placeholder="Fact, e.g. Material" maxLength={60} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={enter} className={cn(smallField, 'col-span-2 h-9 @lg:col-span-1')} />
        <input ref={valueRef} aria-label="New fact value" placeholder="Value, e.g. Stoneware" maxLength={1000} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={enter} className={cn(smallField, 'h-9')} />
        <Button size="sm" variant="tile" icon={Plus} loading={busy} disabled={!ready} onClick={() => void add()} className="h-9">
          Add
        </Button>
      </div>
      {hints.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hints.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                setKey(h);
                valueRef.current?.focus();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--so-tile)] px-2.5 text-[12px] font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]"
            >
              <Plus size={12} aria-hidden />
              {h}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- status */

function StatusCard({ status, onStatus, onRestore, rows }: { status: Status; onStatus: (s: 'active' | 'draft') => void; onRestore?: () => void; rows?: [string, string][] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Status" className="mb-3" />
      {status === 'archived' ? (
        <div className="flex items-center justify-between gap-3">
          <Pill tone="warn" icon={Archive}>
            Archived
          </Pill>
          {onRestore !== undefined && (
            <Button size="sm" variant="secondary" icon={ArchiveRestore} onClick={onRestore}>
              Restore
            </Button>
          )}
        </div>
      ) : (
        <>
          <Choice<'active' | 'draft'>
            items={[
              { key: 'active', label: 'Active' },
              { key: 'draft', label: 'Draft' },
            ]}
            value={status}
            onChange={onStatus}
          />
          <p className="mt-2 text-[12px] text-[var(--so-muted)]">{status === 'active' ? 'Ready to sell on your shops' : 'Not ready to sell yet'}</p>
        </>
      )}
      {rows !== undefined && rows.length > 0 && (
        <dl className="mt-4 border-t border-[var(--so-line)] pt-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-1 text-[13px]">
              <dt className="text-[var(--so-muted)]">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function OrganizationCard({ brand, category, tags, onTags }: { brand: Bound; category: Bound; tags: string[]; onTags: (t: string[]) => void }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Organization" />
      <div className="grid gap-4">
        <Field label="Brand">
          <TextInput list="so-brands" maxLength={120} autoComplete="off" {...brand} />
        </Field>
        <Field label="Category">
          <TextInput list="so-categories" maxLength={200} autoComplete="off" placeholder="e.g. Kitchen / Mugs" {...category} />
        </Field>
        <Labeled label={<HelpLabel label="Tags" tip="Your own words to find and group products. Shops do not see them." />}>
          <ChipInput values={tags} onChange={onTags} label="Add tag" placeholder="Add tags, press Enter" />
        </Labeled>
      </div>
      <CatalogHints />
    </Card>
  );
}

function NoShops(): React.JSX.Element {
  return (
    <Empty
      icon={Store}
      title="No shops yet"
      className="px-2 py-6"
      action={
        <Button size="sm" icon={Plus} onClick={openAddShop}>
          Add a shop
        </Button>
      }
    >
      Each shop gets its own listing of this product.
    </Empty>
  );
}

/* ============================================================ new product */

interface FactDraft {
  id: string;
  key: string;
  value: string;
}

interface Draft {
  title: string;
  description: string;
  price: string;
  cost: string;
  sku: string;
  barcode: string;
  low: string;
  weight: string;
  stock: string;
  brand: string;
  category: string;
  tags: string[];
  status: 'active' | 'draft';
  facts: FactDraft[];
  /** null until changed: every active shop. */
  shops: string[] | null;
  options: OptionDraft[];
  edits: Record<string, RowEdit>;
  excluded: string[];
}

const EMPTY: Draft = { title: '', description: '', price: '', cost: '', sku: '', barcode: '', low: '', weight: '', stock: '', brand: '', category: '', tags: [], status: 'active', facts: [], shops: null, options: [], edits: {}, excluded: [] };

interface Problems {
  title?: string;
  price?: string;
  cost?: string;
  stock?: string;
  low?: string;
  weight?: string;
  sku?: string;
  options: Record<string, string>;
  rows: Record<string, RowFlags>;
  note: string;
  any: boolean;
}

const NONE: Problems = { options: {}, rows: {}, note: '', any: false };

/** Options with neither a name nor a value count as not there. */
function realOptions(d: Draft): OptionDraft[] {
  return d.options.filter((o) => o.name.trim() !== '' || o.values.length > 0);
}

function check(d: Draft, rows: VariantRow[], taken: string): Problems {
  const p: Problems = { options: {}, rows: {}, note: '', any: false };
  const t = taken.toLowerCase();
  if (d.title.trim() === '') p.title = 'Add a title';
  const options = realOptions(d);
  if (options.length === 0) {
    const price = parseAmount(d.price);
    if (price === undefined) p.price = 'Add a price';
    else if (price === null || price < 0) p.price = 'Not a price';
    const cost = parseAmount(d.cost);
    if (cost === null || (typeof cost === 'number' && cost < 0)) p.cost = 'Not a cost';
    if (parseCount(d.stock) === null) p.stock = 'A whole number';
    if (parseCount(d.low) === null) p.low = 'A whole number';
    if (parseCount(d.weight) === null) p.weight = 'A whole number';
    if (t !== '' && d.sku.trim().toLowerCase() === t) p.sku = 'Used by another product';
  } else {
    const named = new Map<string, number>();
    for (const o of options) {
      const n = o.name.trim().toLowerCase();
      if (n !== '') named.set(n, (named.get(n) ?? 0) + 1);
    }
    for (const o of options) {
      if (o.name.trim() === '') p.options[o.id] = 'Name this option';
      else if (o.values.length === 0) p.options[o.id] = 'Add at least one value';
      else if ((named.get(o.name.trim().toLowerCase()) ?? 0) > 1) p.options[o.id] = 'Two options have this name';
    }
    const notes: string[] = [];
    if (rows.length === 0 && Object.keys(p.options).length === 0) notes.push('Every combination is left out');
    if (rows.length > MAX_SKUS) notes.push('At most ' + String(MAX_SKUS) + ' SKUs');
    const seen = new Map<string, number>();
    for (const r of rows) {
      const s = r.sku.trim().toLowerCase();
      if (s !== '') seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    let noPrice = 0;
    let twice = false;
    let usedElsewhere = false;
    let numbers = false;
    for (const r of rows) {
      const f: RowFlags = {};
      const pr = parseAmount(r.price);
      if (typeof pr !== 'number' || pr < 0) {
        f.price = true;
        noPrice++;
      }
      const co = parseAmount(r.cost);
      if (co === null || (typeof co === 'number' && co < 0)) {
        f.cost = true;
        numbers = true;
      }
      if (parseCount(r.stock) === null) {
        f.stock = true;
        numbers = true;
      }
      const s = r.sku.trim().toLowerCase();
      if (s !== '' && (seen.get(s) ?? 0) > 1) {
        f.sku = true;
        twice = true;
      }
      if (s !== '' && s === t) {
        f.sku = true;
        usedElsewhere = true;
      }
      if (Object.keys(f).length > 0) p.rows[r.label] = f;
    }
    if (noPrice > 0) notes.push(noPrice === rows.length ? 'Add a price to every SKU' : noPrice === 1 ? '1 SKU needs a price' : String(noPrice) + ' SKUs need a price');
    if (twice) notes.push('Each SKU code must be different');
    if (usedElsewhere) notes.push('SKU ' + taken + ' is used by another product');
    if (numbers) notes.push('Check the costs and stock');
    p.note = notes.join('. ');
  }
  p.any = p.title !== undefined || p.price !== undefined || p.cost !== undefined || p.stock !== undefined || p.low !== undefined || p.weight !== undefined || p.sku !== undefined || Object.keys(p.options).length > 0 || Object.keys(p.rows).length > 0 || p.note !== '';
  return p;
}

function focusFirstProblem(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('.so-app [aria-invalid="true"]') ?? document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (el === null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

let factSeq = 0;

function NewProduct(): React.JSX.Element {
  const base = useBase();
  const sign = currencySign(base);
  const { shops } = useStore();
  const [d, setD] = useState<Draft>(EMPTY);
  const [pictures, setPictures] = useState<LocalPicture[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((prev) => ({ ...prev, [k]: v }));
  const bind = (k: 'title' | 'description' | 'price' | 'cost' | 'sku' | 'barcode' | 'low' | 'weight' | 'stock' | 'brand' | 'category'): Bound => bindState(d[k], (v) => set(k, v));

  // Previews are links to files in memory: let them go when the page closes.
  const pics = useRef<LocalPicture[]>([]);
  useEffect(() => {
    pics.current = pictures;
  }, [pictures]);
  useEffect(
    () => () => {
      for (const p of pics.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const sellable = shops.filter((s) => s.platform !== 'direct');
  const chosenShops = d.shops ?? sellable.filter((s) => s.status === 'active').map((s) => s.id);
  const withOptions = d.options.length > 0;
  const seed = { price: d.price, cost: d.cost, sku: d.sku, stock: d.stock };
  const allRows = rowsOf(d.options, d.edits, seed, []);
  const rows = allRows.filter((r) => !d.excluded.includes(r.label));
  const left = d.excluded.filter((l) => allRows.some((r) => r.label === l));
  const problems = check(d, rows, taken);
  const show = tried ? problems : NONE;
  const simple = realOptions(d).length === 0;
  const skuCount = simple ? 1 : rows.length;
  const dirty = pictures.length > 0 || JSON.stringify(d) !== JSON.stringify(EMPTY);

  const save = async (): Promise<void> => {
    if (busy) return;
    setTried(true);
    if (problems.any) {
      // Options left blank are dropped, so the single price and stock show again.
      if (simple && withOptions) set('options', []);
      notify.error('Check the fields marked in red');
      focusFirstProblem();
      return;
    }
    const lowN = parseCount(d.low) ?? 0;
    const weightN = parseCount(d.weight) ?? 0;
    const variants = simple
      ? [{ option: '', sku: d.sku.trim(), price: parseAmount(d.price) ?? 0, cost: parseAmount(d.cost) ?? undefined, stock: parseCount(d.stock) ?? undefined, barcode: d.barcode.trim(), weight_g: weightN, low_stock: lowN }]
      : rows.map((r) => ({ option: r.label, sku: r.sku.trim(), price: parseAmount(r.price) ?? 0, cost: parseAmount(r.cost) ?? undefined, stock: parseCount(r.stock) ?? undefined, barcode: '', weight_g: weightN, low_stock: lowN }));
    const facts: Record<string, { value: string; source: string }> = {};
    for (const f of d.facts) if (f.key.trim() !== '' && f.value.trim() !== '') facts[f.key.trim()] = { value: f.value.trim(), source: 'you' };
    setBusy(true);
    let id: string;
    try {
      const r = await op<{ product: ProductDetail }>('products.create', {
        title: d.title.trim(),
        description: d.description,
        brand: d.brand.trim(),
        category: d.category.trim(),
        status: d.status,
        tags: d.tags,
        facts,
        variants,
        shops: chosenShops,
      });
      id = r.product.id;
    } catch (err) {
      if (err instanceof OpError && err.code === 'duplicate_sku' && typeof err.data.sku === 'string') {
        setTaken(err.data.sku);
        focusFirstProblem();
      }
      setBusy(false);
      return;
    }
    let picturesFailed = false;
    if (pictures.length > 0) {
      try {
        await addImages(
          id,
          pictures.map((p) => p.file),
          { quiet: true },
        );
      } catch {
        picturesFailed = true;
      }
    }
    changed('products', 'variants', 'listings', 'stock_moves');
    if (picturesFailed) notify.error('Product added, but the pictures did not upload. Add them again here.');
    else notify.info('Product added');
    go('product', id);
  };

  const discard = async (): Promise<void> => {
    if (dirty && !(await confirmAsk('Discard this product?', 'Nothing you entered is saved.', 'Discard', { danger: true }))) return;
    go('products');
  };

  // Ctrl+S or Cmd+S saves; leaving the page with unsaved work asks first.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const factRows = d.facts.map((f) => (
    <FactLine
      key={f.id}
      label={f.key || 'fact'}
      source="you"
      onRemove={() => set('facts', d.facts.filter((x) => x.id !== f.id))}
      keyCell={<CellInput bound={bindState(f.key, (v) => set('facts', d.facts.map((x) => (x.id === f.id ? { ...x, key: v.slice(0, 60) } : x))))} label="Fact" className="font-semibold" inputClass="text-[var(--so-ink-2)]" />}
      valueCell={<CellInput bound={bindState(f.value, (v) => set('facts', d.facts.map((x) => (x.id === f.id ? { ...x, value: v } : x))))} label={(f.key || 'Fact') + ' value'} />}
    />
  ));

  const actions = (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void discard()}>
        Discard
      </Button>
      <Button loading={busy} onClick={() => void save()}>
        Save product
      </Button>
    </>
  );

  return (
    <div>
      <PageHeader
        back={
          <BackLink
            onClick={(e) => {
              if (!dirty) return;
              e.preventDefault();
              void discard();
            }}
          />
        }
        title="Add product"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill>
            <span className="num">{skuCount === 0 ? 'No SKU yet' : plural(skuCount, 'SKU')}</span>
            {pictures.length > 0 && <span className="num">{plural(pictures.length, 'picture')}</span>}
          </span>
        }
        actions={actions}
      />
      <div className={COLUMNS}>
        <div className="flex min-w-0 flex-col gap-4">
          <DetailsCard autoFocus title={bind('title')} description={bind('description')} titleError={show.title} />
          <DraftMedia pictures={pictures} onChange={setPictures} />
          {!withOptions && <PricingCard price={bind('price')} cost={bind('cost')} cur={base} errors={{ price: show.price, cost: show.cost }} />}
          {!withOptions && (
            <InventoryCard
              sku={bind('sku')}
              skuHint="Made when empty"
              barcode={bind('barcode')}
              low={bind('low')}
              weight={bind('weight')}
              errors={{ sku: show.sku, low: show.low, weight: show.weight }}
              stock={
                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field label={<HelpLabel label="Opening stock" tip="Units on your shelf now. Later changes go through Received and Count." />} {...errorOf(show.stock)}>
                    <TextInput inputMode="numeric" placeholder="0" aria-invalid={show.stock !== undefined || undefined} className={cn(show.stock !== undefined && 'ring-2 ring-[var(--so-red)]')} {...bind('stock')} />
                  </Field>
                </div>
              }
            />
          )}
          <OptionsEditor
            options={d.options}
            onOptions={(o) => set('options', o)}
            rows={rows}
            left={left}
            onRow={(label, field, value) => set('edits', { ...d.edits, [label]: { ...d.edits[label], [field]: value } })}
            onExclude={(label) => set('excluded', [...d.excluded, label])}
            onRestore={() => set('excluded', [])}
            sign={sign}
            optionErrors={show.options}
            rowErrors={show.rows}
            note={show.note}
          />
          <FactsCard
            count={d.facts.length}
            used={d.facts.map((f) => f.key)}
            onAdd={(key, value) => {
              const same = d.facts.find((f) => f.key.trim().toLowerCase() === key.toLowerCase());
              set('facts', same !== undefined ? d.facts.map((f) => (f.id === same.id ? { ...f, value } : f)) : [...d.facts, { id: 'fact-' + String(++factSeq), key, value }]);
              return Promise.resolve(true);
            }}
          >
            {factRows}
          </FactsCard>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <StatusCard status={d.status} onStatus={(s) => set('status', s)} />
          <OrganizationCard brand={bind('brand')} category={bind('category')} tags={d.tags} onTags={(t) => set('tags', t)} />
          <Card>
            <CardHeader title="Shops" subtitle="Start a draft listing on" className="mb-3" />
            {sellable.length === 0 ? (
              <NoShops />
            ) : (
              <div className="-mx-2 grid gap-0.5">
                {sellable.map((s) => {
                  const on = chosenShops.includes(s.id);
                  const toggle = (): void => set('shops', on ? chosenShops.filter((x) => x !== s.id) : [...chosenShops, s.id]);
                  return (
                    <div key={s.id} onClick={toggle} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[12px] px-2 hover:bg-[var(--so-row-hover)]">
                      <Checkbox checked={on} onChange={toggle} label={'Draft a listing on ' + s.name} />
                      <PlatformMark platform={s.platform} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                        <span className="block truncate text-[12px] text-[var(--so-muted)]">{s.status === 'active' ? (PLATFORM_NAME[s.platform] ?? s.platform_name) : 'Setting up'}</span>
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold text-[var(--so-muted)]">{s.currency}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--so-border)] pt-5">{actions}</div>
    </div>
  );
}

/* ========================================================== saved product */

interface Got {
  product: ProductDetail;
}

function SavedProduct({ id }: { id: string }): React.JSX.Element {
  const live = useLive<Got>('product:' + id, (signal) => op<Got>('products.get', { product: id }, { signal, quiet: true }), READS, [id]);
  const p = live.data?.product ?? null;
  if (p === null) {
    if (live.error !== null) {
      return (
        <div>
          <PageHeader back={<BackLink />} title="Product" />
          <Card>
            <Empty
              icon={PackageX}
              title="Cannot open this product"
              action={
                <Button variant="tile" onClick={() => go('products')}>
                  Back to products
                </Button>
              }
            >
              {live.error}
            </Empty>
          </Card>
        </div>
      );
    }
    return (
      <div>
        <PageHeader back={<BackLink />} title={<Skeleton className="h-[34px] w-[320px] max-w-full" />} />
        <div className={COLUMNS}>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[300px] rounded-[20px] bg-[var(--so-card)]" />
            <Skeleton className="h-[280px] rounded-[20px] bg-[var(--so-card)]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[160px] rounded-[20px] bg-[var(--so-card)]" />
            <Skeleton className="h-[240px] rounded-[20px] bg-[var(--so-card)]" />
          </div>
        </div>
      </div>
    );
  }
  return <ProductView p={p} />;
}

/** Change product fields; true when it saved. */
async function saveProduct(p: ProductDetail, fields: Record<string, unknown>, done: string): Promise<boolean> {
  try {
    await op('products.update', { product: p.id, ...fields });
    changed('products', 'listings');
    notify.info(done);
    return true;
  } catch {
    return false;
  }
}

function ProductView({ p }: { p: ProductDetail }): React.JSX.Element {
  const [prepare, setPrepare] = useState(false);
  const [stock, setStock] = useState<{ target: StockTarget; mode: StockMode } | null>(null);
  const v = p.variants[0];
  const simple = p.variants.length === 1 && v !== undefined && v.option === '';
  const onStock = (target: StockTarget, mode: StockMode): void => setStock({ target, mode });

  // Ctrl+S or Cmd+S saves the field being typed in (everything else is saved already).
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const setStatus = async (status: Status): Promise<void> => {
    await saveProduct(p, { status }, status === 'archived' ? 'Archived' : status === 'draft' ? 'Made a draft' : 'Made active');
  };
  const remove = async (): Promise<void> => {
    const ok = await confirmAsk('Delete ' + p.title + '?', 'Its SKUs, pictures, stock history and listings go too. Past orders keep their lines.', 'Delete product', { danger: true });
    if (!ok) return;
    try {
      await op('products.remove', { product: p.id });
      go('products');
      changed('products', 'variants', 'listings', 'stock_moves');
      notify.info('Product deleted');
    } catch {
      /* op showed why */
    }
  };
  const menu: MenuItem[] = [];
  if (p.status !== 'draft') menu.push({ label: 'Make draft', icon: FileText, onSelect: () => void setStatus('draft') });
  if (p.status !== 'active') menu.push({ label: 'Make active', icon: ArchiveRestore, onSelect: () => void setStatus('active') });
  if (p.status !== 'archived') menu.push({ label: 'Archive', icon: Archive, onSelect: () => void setStatus('archived') });
  menu.push({ label: 'Delete product', icon: Trash2, danger: true, onSelect: () => void remove() });
  const task = isOpenTask(p.task) ? p.task : null;

  return (
    <div>
      <PageHeader
        back={<BackLink />}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <ProductThumb src={p.images[0]?.thumb ?? ''} size={44} className="bg-[var(--so-card)]" />
            <span className="min-w-0 break-words">{p.title}</span>
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
            <span className="num">{num(p.sold_30d)} sold in 30 days</span>
            <span className="num">{p.variants.length === 0 ? 'No SKU yet' : plural(p.variants.length, 'SKU')}</span>
          </span>
        }
        actions={
          <>
            <TaskBadge task={task} />
            <Button variant="secondary" icon={Sparkles} onClick={() => setPrepare(true)}>
              Write listings with your AI agent
            </Button>
            <Menu items={menu} label="Product actions" variant="card" size={40} />
          </>
        }
      />
      <div className={COLUMNS}>
        <div className="flex min-w-0 flex-col gap-4">
          <SavedDetails p={p} />
          <ProductMedia product={p} />
          {simple && <SavedPricing key={'pr' + v.id} p={p} v={v} />}
          {simple && <SavedInventory key={'in' + v.id} p={p} v={v} onStock={onStock} />}
          <SkuCard product={p} onStock={onStock} />
          <SavedFacts p={p} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <StatusCard
            status={p.status}
            onStatus={(s) => void setStatus(s)}
            onRestore={() => void saveProduct(p, { status: 'active' }, 'Restored')}
            rows={[
              ['Sold in 30 days', num(p.sold_30d)],
              ['Added', day(p.created)],
            ]}
          />
          <SavedOrganization p={p} />
          <ProductShops p={p} />
        </div>
      </div>
      <PrepareDialog open={prepare} onClose={() => setPrepare(false)} product={p} />
      <StockDialog target={stock?.target ?? null} mode={stock?.mode ?? 'received'} onClose={() => setStock(null)} />
    </div>
  );
}

function SavedDetails({ p }: { p: ProductDetail }): React.JSX.Element {
  const title = useEditable(p.title, async (s) => {
    if (s.trim() === '') {
      notify.error('A product needs a title');
      return false;
    }
    return saveProduct(p, { title: s.trim() }, 'Title saved');
  });
  const description = useEditable(p.description, (s) => saveProduct(p, { description: s }, 'Description saved'));
  return <DetailsCard title={title} description={description} />;
}

function SavedPricing({ p, v }: { p: ProductDetail; v: Variant }): React.JSX.Element {
  const price = useEditable(amountText(v.price, p.currency), (s) => savePrice(v, s));
  const cost = useEditable(amountText(v.cost, p.currency, true), (s) => saveCost(v, s));
  return <PricingCard price={price} cost={cost} cur={p.currency} />;
}

function SavedInventory({ p, v, onStock }: { p: ProductDetail; v: Variant; onStock: (t: StockTarget, m: StockMode) => void }): React.JSX.Element {
  const [history, setHistory] = useState(false);
  const sku = useEditable(v.sku, (s) => saveSku(v, s));
  const barcode = useEditable(v.barcode, (s) => updateVariant(v, { barcode: s.trim() }, 'Barcode saved'));
  const low = useEditable(String(v.low_stock), (s) => saveCount(v, 'low_stock', s));
  const weight = useEditable(v.weight_g > 0 ? String(v.weight_g) : '', (s) => saveCount(v, 'weight_g', s));
  const target = stockTarget(p, v);
  const tone = v.available <= 0 ? 'bad' : v.available <= v.low_stock ? 'warn' : 'ink';
  return (
    <InventoryCard
      sku={sku}
      barcode={barcode}
      low={low}
      weight={weight}
      stock={
        <>
          <div className="grid grid-cols-3 gap-3">
            <FigureBox label="On hand">{num(v.on_hand)}</FigureBox>
            <FigureBox label={<HelpLabel label="Reserved" tip="Ordered but not shipped yet" />}>{num(v.reserved)}</FigureBox>
            <FigureBox label="Available" tone={tone}>
              <span className={availableClass(v)}>{num(v.available)}</span>
            </FigureBox>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={PackagePlus} onClick={() => onStock(target, 'received')}>
              Received
            </Button>
            <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => onStock(target, 'count')}>
              Count
            </Button>
            <Button size="sm" variant="ghost" icon={History} aria-pressed={history} onClick={() => setHistory(!history)} className={cn('ml-auto', history && 'bg-[var(--so-tile)] text-[var(--so-ink)]')}>
              {history ? 'Hide history' : 'History'}
            </Button>
          </div>
          {history && (
            <div className="mt-3 rounded-[14px] bg-[var(--so-tile)] p-2">
              <StockLedger variant={v.id} />
            </div>
          )}
        </>
      }
    />
  );
}

function SavedOrganization({ p }: { p: ProductDetail }): React.JSX.Element {
  const brand = useEditable(p.brand, (s) => saveProduct(p, { brand: s.trim() }, 'Brand saved'));
  const category = useEditable(p.category, (s) => saveProduct(p, { category: s.trim() }, 'Category saved'));
  return <OrganizationCard brand={brand} category={category} tags={p.tags} onTags={(t) => void saveProduct(p, { tags: t }, 'Tags saved')} />;
}

/* ------------------------------------------------------------------ facts */

async function writeFacts(p: ProductDetail, facts: Record<string, unknown>, done: string): Promise<boolean> {
  try {
    await op('products.facts', { product: p.id, facts });
    changed('products', 'listings');
    if (done !== '') notify.info(done);
    return true;
  } catch {
    return false;
  }
}

function SavedFacts({ p }: { p: ProductDetail }): React.JSX.Element {
  const remove = async (key: string): Promise<void> => {
    const ok = await confirmAsk('Remove "' + key + '"?', undefined, 'Remove', { danger: true });
    if (ok) await writeFacts(p, { [key]: '' }, 'Fact removed');
  };
  return (
    <FactsCard count={p.facts.length} used={p.facts.map((f) => f.key)} onAdd={(key, value) => writeFacts(p, { [key]: value }, 'Fact added')}>
      {p.facts.map((f) => (
        <FactLine
          key={f.key}
          label={f.key}
          source={f.source}
          onRemove={() => void remove(f.key)}
          keyCell={
            <Cell
              value={f.key}
              label={'Name of ' + f.key}
              className="font-semibold"
              inputClass="text-[var(--so-ink-2)]"
              onSave={(s) => {
                const k = s.trim();
                if (k === '') {
                  notify.error('Remove a fact with its x');
                  return Promise.resolve(false);
                }
                return writeFacts(p, { [f.key]: '', [k]: { value: f.value, source: f.source } }, 'Fact renamed');
              }}
            />
          }
          valueCell={
            <Cell
              value={f.value}
              label={f.key}
              onSave={(s) => {
                if (s.trim() === '') {
                  notify.error('Remove a fact with its x');
                  return Promise.resolve(false);
                }
                return writeFacts(p, { [f.key]: s.trim() }, 'Saved');
              }}
            />
          }
        />
      ))}
    </FactsCard>
  );
}

/* ------------------------------------------------------------------ shops */

type ShopRow = { kind: 'listed'; id: string; l: Listing } | { kind: 'free'; id: string; s: ShopRef };

function ProductShops({ p }: { p: ProductDetail }): React.JSX.Element {
  const store = useStore();
  const [openId, setOpenId] = useState('');
  const [fresh, setFresh] = useState<Listing | null>(null);
  const [adding, setAdding] = useState('');
  const order = (id: string): number => {
    const i = store.shops.findIndex((s) => s.id === id);
    return i < 0 ? 999 : i;
  };
  const rows: ShopRow[] = [
    ...p.listings.map((l): ShopRow => ({ kind: 'listed', id: l.shop.id, l })),
    ...p.not_listed_on.filter((s) => s.platform !== 'direct').map((s): ShopRow => ({ kind: 'free', id: s.id, s })),
  ].sort((a, b) => order(a.id) - order(b.id));
  const liveCount = p.listings.filter((l) => l.status === 'live').length;
  const open = p.listings.find((l) => l.id === openId) ?? (fresh !== null && fresh.id === openId ? fresh : null);

  const addOn = async (s: ShopRef): Promise<void> => {
    setAdding(s.id);
    try {
      const r = await op<{ listing: Listing }>('listings.draft', { product: p.id, shop: s.id });
      setFresh(r.listing);
      setOpenId(r.listing.id);
      changed('listings', 'products');
      notify.info('Draft started on ' + s.name);
    } catch {
      /* op showed why */
    } finally {
      setAdding('');
    }
  };

  return (
    <Card>
      <CardHeader title="Shops" subtitle={rows.length === 0 ? undefined : p.listings.length === 0 ? 'Not listed yet' : 'Live on ' + String(liveCount) + ' of ' + plural(p.listings.length, 'shop')} className="mb-2" />
      {rows.length === 0 ? (
        <NoShops />
      ) : (
        <div className="-mx-2 grid gap-0.5">
          {rows.map((r) => {
            if (r.kind === 'listed') {
              const l = r.l;
              const shop = store.shop(l.shop.id);
              const publishing = shop?.task?.kind === 'publish' && isOpenTask(shop.task) ? shop.task : null;
              return (
                <button key={r.id} type="button" onClick={() => setOpenId(l.id)} aria-label={'Edit the ' + l.shop.name + ' listing'} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-[var(--so-row-hover)]">
                  <PlatformMark platform={l.shop.platform} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{l.shop.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ListingPill status={l.status} blocking={l.blocking} />
                      {l.needs_update && <span className="text-[12px] font-medium text-[var(--so-amber-text)]">Changes to publish</span>}
                      <TaskBadge task={publishing} />
                    </span>
                  </span>
                  {l.price > 0 ? <span className="num shrink-0 text-[14px] font-semibold">{money(l.price, l.currency)}</span> : <span className="shrink-0 text-[12px] font-medium text-[var(--so-muted)]">No price</span>}
                  <ChevronRight size={16} className="shrink-0 text-[var(--so-faint)]" aria-hidden />
                </button>
              );
            }
            const s = r.s;
            return (
              <div key={r.id} className="flex items-center gap-3 px-2 py-2.5">
                <PlatformMark platform={s.platform} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                  <span className="block text-[12px] text-[var(--so-muted)]">Not listed</span>
                </span>
                <Button size="sm" variant="tile" icon={Plus} loading={adding === s.id} disabled={adding !== ''} onClick={() => void addOn(s)}>
                  Add
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <ListingDrawer
        product={p}
        listing={open}
        onClose={() => {
          setOpenId('');
          setFresh(null);
        }}
      />
    </Card>
  );
}

/**
 * The Variants card of a saved product: every SKU in one table, edited in
 * place (saved when you leave a cell), its stock with what open orders
 * reserve, and a row to add a SKU. A product sold as one SKU shows a short
 * line instead (its price and stock live in the Pricing and Inventory
 * cards) until you add a second one.
 */
import { Fragment, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Barcode, ClipboardCheck, History, Layers, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { currencySign, num, plural } from '../lib/format.ts';
import { notify } from '../lib/toast.tsx';
import type { ProductDetail, Variant } from '../lib/types.ts';
import { StockLedger, amountText, parseAmount } from './ProductDialogs.tsx';
import type { StockMode, StockTarget } from './ProductDialogs.tsx';
import { Cell, HelpLabel, SmallAmount, parseCount, smallField } from './ProductParts.tsx';
import { Button, Card, CardHeader, Dialog, Field, IconBadge, Menu, PhoneList, TextInput, Tip, confirmAsk } from './ui.tsx';
import type { MenuItem } from './ui.tsx';

export function availableClass(v: Pick<Variant, 'available' | 'low_stock'>): string {
  if (v.available <= 0) return 'text-[var(--so-red-text)]';
  if (v.available <= v.low_stock) return 'text-[var(--so-amber-text)]';
  return 'text-[var(--so-ink)]';
}

export function stockTarget(p: ProductDetail, v: Variant): StockTarget {
  return { variant: v.id, sku: v.sku, option: v.option, title: p.title, on_hand: v.on_hand, reserved: v.reserved };
}

/** Change a SKU; true when it saved. */
export async function updateVariant(v: Variant, params: Record<string, unknown>, done: string): Promise<boolean> {
  try {
    await op('variants.update', { variant: v.id, ...params });
    changed('variants', 'products', 'listings', 'orders');
    notify.info(done);
    return true;
  } catch {
    return false;
  }
}

export async function savePrice(v: Variant, s: string): Promise<boolean> {
  const n = parseAmount(s);
  if (typeof n !== 'number' || n < 0) {
    notify.error('Enter a price, for example 29.90');
    return false;
  }
  try {
    await op('variants.set-price', { variant: v.id, price: n });
    changed('variants', 'products', 'listings');
    notify.info('Price saved');
    return true;
  } catch {
    return false;
  }
}

export async function saveCost(v: Variant, s: string): Promise<boolean> {
  const n = parseAmount(s);
  if (n === null || (typeof n === 'number' && n < 0)) {
    notify.error('Enter a cost, for example 9.50');
    return false;
  }
  return updateVariant(v, { cost: n ?? 0 }, 'Cost saved');
}

export async function saveSku(v: Variant, s: string): Promise<boolean> {
  if (s.trim() === '') {
    notify.error('A SKU cannot be empty');
    return false;
  }
  return updateVariant(v, { sku: s.trim() }, 'SKU saved');
}

/** A whole number that may be blank (0). */
export async function saveCount(v: Variant, field: 'low_stock' | 'weight_g', s: string): Promise<boolean> {
  const n = parseCount(s);
  if (n === null) {
    notify.error('A whole number, 0 or more');
    return false;
  }
  return updateVariant(v, { [field]: n ?? 0 }, 'Saved');
}

export function SkuCard({ product: p, onStock }: { product: ProductDetail; onStock: (t: StockTarget, m: StockMode) => void }): React.JSX.Element {
  const simple = p.variants.length === 1 && p.variants[0]?.option === '';
  const [showTable, setShowTable] = useState(false);
  const [history, setHistory] = useState('');
  const [details, setDetails] = useState<Variant | null>(null);
  const cur = p.currency;
  const sign = currencySign(cur);
  const available = p.variants.reduce((n, v) => n + v.available, 0);

  if (simple && !showTable) {
    return (
      <Card>
        <CardHeader title="Variants" subtitle="One SKU, priced and stocked above" className="mb-3" />
        <button type="button" onClick={() => setShowTable(true)} className="flex w-full items-center gap-3 rounded-[14px] bg-[var(--so-tile)] px-3 py-3 text-left hover:bg-[var(--so-tile-hover)]">
          <IconBadge icon={Layers} size={36} tone="card" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Add a SKU</span>
            <span className="block text-[12px] text-[var(--so-muted)]">When it comes in sizes, colours or packs</span>
          </span>
          <Plus size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
        </button>
      </Card>
    );
  }

  return (
    <Card flush className="overflow-hidden">
      <div className="px-5 pt-5">
        <CardHeader title="Variants" subtitle={p.variants.length === 0 ? 'No SKU yet: add one to sell this product' : plural(p.variants.length, 'SKU') + ', ' + num(available) + ' available'} className="mb-2" />
      </div>
      <PhoneList label="SKUs">
        {p.variants.map((v) => (
          <Fragment key={v.id}>
            <SkuPhoneItem v={v} cur={cur} sign={sign} history={history === v.id} menu={skuMenu(p, v, history === v.id, () => setHistory(history === v.id ? '' : v.id), onStock, () => setDetails(v))} />
            {history === v.id && (
              <li className="px-3 pb-3">
                <div className="rounded-[14px] bg-[var(--so-tile)] p-2">
                  <StockLedger variant={v.id} />
                </div>
              </li>
            )}
          </Fragment>
        ))}
        <li className={cn(p.variants.length > 0 && 'border-t border-[var(--so-line)]')}>
          <AddSkuRow p={p} sign={sign} first={p.variants.length === 0} phone />
        </li>
      </PhoneList>
      <div className="relative hidden overflow-x-auto px-2 pb-2 sm:block">
        <table className="w-full min-w-[620px]">
          <thead>
            <tr className="text-left">
              <th className="h-10 px-3 text-[12px] font-semibold text-[var(--so-muted)]">Option and SKU</th>
              <th className="h-10 w-[116px] px-3 text-right text-[12px] font-semibold text-[var(--so-muted)]">Price</th>
              <th className="h-10 w-[116px] px-3 text-right text-[12px] font-semibold text-[var(--so-muted)]">Cost</th>
              <th className="h-10 w-[140px] px-3 text-right text-[12px] font-semibold text-[var(--so-muted)]">
                <HelpLabel label="Available" tip="On hand minus what open orders reserve" />
              </th>
              <th className="h-10 w-[72px] px-3 text-right text-[12px] font-semibold text-[var(--so-muted)]">
                <HelpLabel label="Low" tip="Low-stock alert: warn when available falls to this" />
              </th>
              <th className="h-10 w-[44px]">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <Fragment key={v.id}>
                <SkuRow v={v} cur={cur} sign={sign} history={history === v.id} menu={skuMenu(p, v, history === v.id, () => setHistory(history === v.id ? '' : v.id), onStock, () => setDetails(v))} />
                {history === v.id && (
                  <tr>
                    <td colSpan={6} className="px-3 pb-3">
                      <div className="rounded-[14px] bg-[var(--so-tile)] p-2">
                        <StockLedger variant={v.id} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <AddSkuRow p={p} sign={sign} first={p.variants.length === 0} />
          </tbody>
        </table>
      </div>
      <SkuDetailsDialog v={details} onClose={() => setDetails(null)} />
    </Card>
  );
}

/** What a SKU's kebab offers: stock moves, history, details, delete. */
function skuMenu(p: ProductDetail, v: Variant, history: boolean, onHistory: () => void, onStock: (t: StockTarget, m: StockMode) => void, onDetails: () => void): MenuItem[] {
  const last = p.variants.length === 1;
  const removeSku = async (): Promise<void> => {
    const ok = await confirmAsk('Delete ' + v.sku + '?', last ? 'It is the last SKU: the product cannot be sold until you add another. Its stock history goes too.' : 'Its stock history goes too. Past orders keep their lines.', 'Delete SKU', { danger: true });
    if (!ok) return;
    try {
      await op('variants.remove', { variant: v.id });
      changed('variants', 'products', 'listings', 'stock_moves');
      notify.info('SKU deleted');
    } catch {
      /* op showed why */
    }
  };
  const target = stockTarget(p, v);
  return [
    { label: 'Received', icon: PackagePlus, onSelect: () => onStock(target, 'received') },
    { label: 'Count', icon: ClipboardCheck, onSelect: () => onStock(target, 'count') },
    { label: history ? 'Hide history' : 'History', icon: History, onSelect: onHistory },
    { label: 'Barcode and weight', icon: Barcode, onSelect: onDetails },
    { label: 'Delete SKU', icon: Trash2, danger: true, onSelect: () => void removeSku() },
  ];
}

/** A SKU on a phone: option and SKU on top, then price, cost, stock and the low level. */
function SkuPhoneItem({ v, cur, sign, history, menu }: { v: Variant; cur: string; sign: string; history: boolean; menu: MenuItem[] }): React.JSX.Element {
  return (
    <li className={cn('border-t border-[var(--so-line)] px-1.5 py-2 first:border-t-0', history && 'bg-[var(--so-row-hover)]')}>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Cell value={v.option} label={'Option of ' + v.sku} placeholder="Name it, e.g. Red / M" onSave={(t) => updateVariant(v, { option: t.trim() }, 'Option saved')} className="font-semibold" />
          <Cell value={v.sku} label={'SKU ' + v.sku} onSave={(t) => saveSku(v, t)} className="h-7" inputClass="text-[12px] text-[var(--so-muted)] focus:text-[var(--so-ink)]" />
        </div>
        <Menu label={'Actions for ' + v.sku} items={menu} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
        <PhoneField label="Price">
          <Cell numeric prefix={sign} value={amountText(v.price, cur)} label={'Price of ' + v.sku} onSave={(t) => savePrice(v, t)} inputClass="text-left" />
        </PhoneField>
        <PhoneField label="Cost">
          <Cell numeric prefix={sign} value={amountText(v.cost, cur, true)} placeholder="Missing" danger={v.cost_missing} label={'Cost of ' + v.sku} onSave={(t) => saveCost(v, t)} inputClass="text-left" />
        </PhoneField>
        <PhoneField label="Available">
          <span className="flex h-8 items-center gap-1.5 px-2">
            <span className={cn('num text-[14px] font-bold', availableClass(v))}>{num(v.available)}</span>
            <span className="num truncate text-[12px] text-[var(--so-muted)]">
              of {num(v.on_hand)}
            </span>
          </span>
        </PhoneField>
        <PhoneField label="Low at">
          <Cell numeric value={String(v.low_stock)} label={'Low-stock level of ' + v.sku} onSave={(t) => saveCount(v, 'low_stock', t)} inputClass="text-left" />
        </PhoneField>
      </div>
    </li>
  );
}

function PhoneField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <span className="block px-2 text-[12px] font-semibold text-[var(--so-muted)]">{label}</span>
      {children}
    </div>
  );
}

function SkuRow({ v, cur, sign, history, menu }: { v: Variant; cur: string; sign: string; history: boolean; menu: MenuItem[] }): React.JSX.Element {
  return (
    <tr className={cn('border-t border-[var(--so-line)]', history && 'bg-[var(--so-row-hover)]')}>
      <td className="min-w-[168px] px-1.5 py-1.5">
        <Cell value={v.option} label={'Option of ' + v.sku} placeholder="Name it, e.g. Red / M" onSave={(s) => updateVariant(v, { option: s.trim() }, 'Option saved')} className="font-semibold" />
        <Cell value={v.sku} label={'SKU ' + v.sku} onSave={(s) => saveSku(v, s)} className="h-7" inputClass="text-[12px] text-[var(--so-muted)] focus:text-[var(--so-ink)]" />
      </td>
      <td className="px-1.5 py-2">
        <Cell numeric prefix={sign} value={amountText(v.price, cur)} label={'Price of ' + v.sku} onSave={(s) => savePrice(v, s)} />
      </td>
      <td className="px-1.5 py-2">
        <Cell numeric prefix={sign} value={amountText(v.cost, cur, true)} placeholder="Missing" danger={v.cost_missing} label={'Cost of ' + v.sku} onSave={(s) => saveCost(v, s)} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <span className={cn('num text-[14px] font-bold', availableClass(v))}>{num(v.available)}</span>
        <span className="num block text-[12px] text-[var(--so-muted)]">
          {num(v.on_hand)} on hand{v.reserved > 0 ? ', ' + num(v.reserved) + ' reserved' : ''}
        </span>
      </td>
      <td className="px-1.5 py-2">
        <Cell numeric value={String(v.low_stock)} label={'Low-stock level of ' + v.sku} onSave={(s) => saveCount(v, 'low_stock', s)} />
      </td>
      <td className="px-1.5 py-2 text-right">
        <Menu label={'Actions for ' + v.sku} items={menu} />
      </td>
    </tr>
  );
}

interface NewSku {
  option: string;
  sku: string;
  price: string;
  cost: string;
  stock: string;
}

const BLANK_SKU: NewSku = { option: '', sku: '', price: '', cost: '', stock: '' };

function AddSkuRow({ p, sign, first, phone = false }: { p: ProductDetail; sign: string; first: boolean; phone?: boolean }): React.JSX.Element {
  const [f, setF] = useState<NewSku>(BLANK_SKU);
  const [busy, setBusy] = useState(false);
  const optionRef = useRef<HTMLInputElement>(null);
  const price = parseAmount(f.price);
  const cost = parseAmount(f.cost);
  const stock = parseCount(f.stock);
  const blank = f.option.trim() === '' && f.sku.trim() === '' && price === undefined && cost === undefined && stock === undefined;

  const add = async (): Promise<void> => {
    if (busy || blank) return;
    if (typeof price !== 'number' || price < 0) {
      notify.error('Give the new SKU a price');
      return;
    }
    if (cost === null || (typeof cost === 'number' && cost < 0) || stock === null) {
      notify.error('Check the cost and stock');
      return;
    }
    setBusy(true);
    try {
      await op('variants.add', { product: p.id, option: f.option.trim() || undefined, sku: f.sku.trim() || undefined, price, cost, stock });
      changed('variants', 'products', 'listings', 'stock_moves');
      notify.info('SKU added');
      setF(BLANK_SKU);
      optionRef.current?.focus();
    } catch {
      /* op showed why */
    } finally {
      setBusy(false);
    }
  };
  const bind = (k: keyof NewSku) => ({
    value: f[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void add();
      }
    },
  });
  if (phone) {
    return (
      <div className="grid grid-cols-2 gap-1.5 px-1.5 py-3">
        <input aria-label="New SKU option" placeholder={first ? 'Option (optional)' : 'New option, e.g. Blue'} {...bind('option')} className={smallField} />
        <input aria-label="New SKU code" placeholder="SKU (made when empty)" {...bind('sku')} className={smallField} />
        <SmallAmount sign={sign} aria-label="New SKU price" placeholder="Price" {...bind('price')} />
        <SmallAmount sign={sign} aria-label="New SKU cost" placeholder="Cost" {...bind('cost')} />
        <input aria-label="New SKU opening stock" placeholder="Opening stock" inputMode="numeric" {...bind('stock')} className={cn(smallField, 'num')} />
        <Button size="sm" variant="tile" icon={Plus} loading={busy} disabled={blank} onClick={() => void add()} className="h-8">
          Add SKU
        </Button>
      </div>
    );
  }
  return (
    <tr className={cn(!first && 'border-t border-[var(--so-line)]')}>
      <td className="px-1.5 py-3">
        <span className="grid gap-1.5">
          <input ref={optionRef} aria-label="New SKU option" placeholder={first ? 'Option (optional)' : 'New option, e.g. Blue'} {...bind('option')} className={smallField} />
          <input aria-label="New SKU code" placeholder="SKU (made when empty)" {...bind('sku')} className={smallField} />
        </span>
      </td>
      <td className="px-1.5 py-3 align-top">
        <SmallAmount sign={sign} aria-label="New SKU price" placeholder="Price" {...bind('price')} />
      </td>
      <td className="px-1.5 py-3 align-top">
        <SmallAmount sign={sign} aria-label="New SKU cost" placeholder="Cost" {...bind('cost')} />
      </td>
      <td className="px-1.5 py-3 align-top">
        <Tip text="Opening stock" className="w-full">
          <input aria-label="New SKU opening stock" placeholder="Stock" inputMode="numeric" {...bind('stock')} className={cn(smallField, 'num text-right')} />
        </Tip>
      </td>
      <td colSpan={2} className="px-1.5 py-3 text-right align-top">
        <Button size="sm" variant="tile" icon={Plus} loading={busy} disabled={blank} onClick={() => void add()}>
          Add SKU
        </Button>
      </td>
    </tr>
  );
}

/** A SKU's barcode and weight (the table keeps to what changes often). */
function SkuDetailsDialog({ v, onClose }: { v: Variant | null; onClose: () => void }): React.JSX.Element | null {
  if (v === null) return null;
  return <SkuDetailsForm key={v.id} v={v} onClose={onClose} />;
}

function SkuDetailsForm({ v, onClose }: { v: Variant; onClose: () => void }): React.JSX.Element {
  const [barcode, setBarcode] = useState(v.barcode);
  const [weight, setWeight] = useState(v.weight_g > 0 ? String(v.weight_g) : '');
  const [busy, setBusy] = useState(false);
  const w = parseCount(weight);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (w === null || busy) return;
    setBusy(true);
    const ok = await updateVariant(v, { barcode: barcode.trim(), weight_g: w ?? 0 }, 'Saved');
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      width={440}
      title={v.option !== '' ? v.option : v.sku}
      subtitle={v.sku}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-sku-details" loading={busy} disabled={w === null}>
            Save
          </Button>
        </>
      }
    >
      <form id="so-sku-details" onSubmit={(e) => void submit(e)} className="grid gap-3 pb-1 sm:grid-cols-2">
        <Field label="Barcode" hint="EAN, UPC or JAN">
          <TextInput autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </Field>
        <Field label="Weight (g)" {...(w === null ? { error: 'A whole number' } : {})}>
          <TextInput inputMode="numeric" placeholder="0" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

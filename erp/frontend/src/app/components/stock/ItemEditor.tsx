/**
 * New item / edit item: a full screen that grows from the button that opened
 * it. Three cards read left to right: what it is (photo, name, kind,
 * category with its icon, unit), prices and taxes (with the usual supplier),
 * then stock (reorder point, target, opening stock for a new stock item).
 * Only the name is required; codes and accounts sit under More options.
 *
 *   const editor = useItemEditor({ onSaved });
 *   editor.create(e.currentTarget) / editor.edit(e.currentTarget, item)
 *   {editor.node}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ImagePlus, Plus, SlidersHorizontal } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { errMessage, op, opForm } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { normalizeNumber, plain } from '../../lib/format.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import type { CategoryList, ItemDetail, ItemKind, WarehouseList } from '../../lib/types/stock.ts';
import { Segmented, Stepper } from '../controls.tsx';
import { ScreenBar, useFullScreen } from '../FullScreen.tsx';
import { AccountPicker, DateField, MoneyInput, NumberInput, PartyPicker, accountOption, partyOption } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Card, Field, Notice, PillButton, PillSelect, Toggle, softArea, softInput } from '../ui.tsx';
import { CATEGORY_ICON_NAMES, iconOf, photoSrc } from './icons.tsx';

export interface ItemEditorControl {
  create: (from: Element | null, preset?: { name?: string | undefined } | undefined) => void;
  edit: (from: Element | null, item: ItemDetail) => void;
  node: React.ReactNode;
}

export function useItemEditor(opts: { onSaved?: ((item: ItemDetail, created: boolean) => void) | undefined; onClosed?: (() => void) | undefined } = {}): ItemEditorControl {
  const [state, setState] = useState<{ item: ItemDetail | null; name: string; n: number }>({ item: null, name: '', n: 0 });
  const fs = useFullScreen(opts.onClosed);
  const savedRef = useRef(opts.onSaved);
  savedRef.current = opts.onSaved;
  const create = useCallback(
    (from: Element | null, preset?: { name?: string | undefined }) => {
      setState((s) => ({ item: null, name: preset?.name ?? '', n: s.n + 1 }));
      fs.open(from);
    },
    [fs],
  );
  const edit = useCallback(
    (from: Element | null, item: ItemDetail) => {
      setState((s) => ({ item, name: '', n: s.n + 1 }));
      fs.open(from);
    },
    [fs],
  );
  const node = fs.node(
    <EditorScreen
      key={state.n}
      item={state.item}
      startName={state.name}
      onClose={fs.close}
      onSaved={(it, created) => {
        fs.close();
        savedRef.current?.(it, created);
      }}
    />,
    { title: state.item !== null ? 'Edit item' : 'New item' },
  );
  return { create, edit, node };
}

const UNITS = ['pcs', 'box', 'pack', 'set', 'bag', 'kg', 'g', 'L', 'm', 'hour'];
const PART_UNITS = new Set(['kg', 'g', 'L', 'm', 'hour']);

interface TaxRow {
  id: string;
  code: string;
  name: string;
  scope: string;
  archived: boolean;
}

function EditorScreen({ item, startName, onClose, onSaved }: { item: ItemDetail | null; startName: string; onClose: () => void; onSaved: (it: ItemDetail, created: boolean) => void }): React.JSX.Element {
  const me = useMe();
  const currency = baseCurrency(me);
  const editing = item !== null;
  const [cats, setCats] = useState<CategoryList | null>(null);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [whs, setWhs] = useState<WarehouseList['warehouses']>([]);
  const [skuNext, setSkuNext] = useState('');

  const [name, setName] = useState(item?.name ?? startName);
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'stock');
  const [category, setCategory] = useState(item?.category?.id ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [fractional, setFractional] = useState(item?.fractional ?? false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(item !== null ? photoSrc(item.photo, '480x480') : null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [salePrice, setSalePrice] = useState(item !== null && item.sale_price_e4 > 0 ? item.sale_price : '');
  const [buyPrice, setBuyPrice] = useState(item !== null && item.purchase_price_e4 > 0 ? item.purchase_price : '');
  const [saleTax, setSaleTax] = useState(item?.sale_tax?.code ?? '');
  const [buyTax, setBuyTax] = useState(item?.purchase_tax?.code ?? '');
  const [supplier, setSupplier] = useState<Option | null>(item?.supplier != null ? partyOption(item.supplier) : null);
  const [lead, setLead] = useState(item !== null && item.lead_time_days > 0 ? String(item.lead_time_days) : '');
  const [minQty, setMinQty] = useState(item !== null ? plain(item.min_qty) : '0');
  const [maxQty, setMaxQty] = useState(item !== null ? plain(item.max_qty) : '0');
  const [openQty, setOpenQty] = useState('0');
  const [openCost, setOpenCost] = useState('');
  const [openWh, setOpenWh] = useState('');
  const [openDate, setOpenDate] = useState(today());
  const [sku, setSku] = useState(item?.sku ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [income, setIncome] = useState<Option | null>(item?.income_account != null ? accountOption(item.income_account) : null);
  const [expense, setExpense] = useState<Option | null>(item?.expense_account != null ? accountOption(item.expense_account) : null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const loadCats = useCallback(() => {
    op<CategoryList>('categories.list', {}, { quiet: true })
      .then(setCats)
      .catch(() => setCats({ categories: [], icons: CATEGORY_ICON_NAMES }));
  }, []);

  useEffect(() => {
    loadCats();
    op<{ taxes: TaxRow[] }>('taxes.list', {}, { quiet: true })
      .then((r) => setTaxes(r.taxes.filter((t) => !t.archived)))
      .catch(() => undefined);
    op<WarehouseList>('warehouses.list', {}, { quiet: true })
      .then((r) => {
        const active = r.warehouses.filter((w) => !w.archived);
        setWhs(active);
        setOpenWh((w) => (w !== '' ? w : (active[0]?.id ?? '')));
      })
      .catch(() => undefined);
    op<{ numbering?: Record<string, { next: string }> | undefined; defaults?: { warehouse?: string | undefined } | undefined }>('settings.get', {}, { quiet: true })
      .then((s) => {
        setSkuNext(s.numbering?.['item']?.next ?? '');
        const d = s.defaults?.warehouse ?? '';
        if (d !== '') setOpenWh(d);
      })
      .catch(() => undefined);
  }, [loadCats]);

  useEffect(() => {
    if (photo === null) return;
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const hasHistory = editing && item.kind === 'stock' && (item.moves.length > 0 || item.on_hand !== 0);
  const isStock = kind === 'stock';
  const qd = fractional ? 3 : 0;

  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      setError('Give the item a name');
      nameRef.current?.focus();
      return;
    }
    const min = normalizeNumber(minQty, qd);
    const max = normalizeNumber(maxQty, qd);
    const start = normalizeNumber(openQty, qd);
    if (isStock && (min === null || max === null || (!editing && start === null))) {
      setError(fractional ? 'Quantities must be numbers' : 'Quantities must be whole numbers for this item');
      return;
    }
    if (isStock && Number(max) > 0 && Number(max) < Number(min)) {
      setError('The target level must be at least the reorder point');
      return;
    }
    const params: Record<string, string | number | boolean | undefined> = {
      name: name.trim(),
      kind,
      category,
      unit: unit.trim() === '' ? 'pcs' : unit.trim(),
      fractional,
      sale_price: salePrice === '' ? '0' : salePrice,
      purchase_price: buyPrice === '' ? '0' : buyPrice,
      sale_tax: saleTax,
      purchase_tax: buyTax,
      supplier: supplier?.id ?? '',
      lead_time_days: lead.trim() === '' ? 0 : Number(lead),
      min_qty: isStock ? (min ?? '0') : '0',
      max_qty: isStock ? (max ?? '0') : '0',
      barcode: barcode.trim(),
      description: description.trim(),
      income_account: income?.id ?? '',
      expense_account: expense?.id ?? '',
    };
    if (sku.trim() !== '' || editing) params['sku'] = sku.trim();
    if (editing) params['item'] = item.id;
    if (editing && removePhoto && photo === null) params['remove_photo'] = true;
    if (!editing && isStock && Number(start) > 0) {
      params['opening_qty'] = start ?? '0';
      if (openCost !== '') params['opening_cost'] = openCost;
      else if (buyPrice !== '') params['opening_cost'] = buyPrice;
      params['warehouse'] = openWh;
      params['opening_date'] = openDate;
    }
    setBusy(true);
    setError(null);
    try {
      const opName = editing ? 'items.update' : 'items.add';
      const r = photo !== null ? await opForm<ItemDetail>(opName, params, { photo }, { quiet: true }) : await op<ItemDetail>(opName, params, { quiet: true });
      toast.success(editing ? 'Saved' : `Added ${r.name}`);
      onSaved(r, !editing);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const taxOptions = (scope: 'sales' | 'purchase'): { value: string; label: string }[] => [
    { value: '', label: 'Default' },
    ...taxes.filter((t) => t.scope === 'both' || t.scope === scope).map((t) => ({ value: t.code, label: t.name })),
  ];

  return (
    <div className="pb-28 md:pb-12">
      <ScreenBar title={editing ? `Edit ${item.name}` : 'New item'} sub={editing ? item.sku : undefined} onClose={onClose} />
      <div className="mx-auto max-w-[1180px] px-4 @min-[640px]:px-8">
        <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-3 @min-[900px]:items-start">
          {/* What it is */}
          <Card delay={1}>
            <h2 className="mb-4 text-[15px] font-bold">What it is</h2>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label={photoUrl !== null && !removePhoto ? 'Change photo' : 'Add a photo'}
                  className="erp-on-sand relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[22px] bg-[var(--erp-sand)] transition-transform active:scale-[0.97]"
                >
                  {photoUrl !== null && !removePhoto ? (
                    <img src={photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-[var(--erp-ink-2)]">
                      <ImagePlus size={22} aria-hidden />
                      <span className="text-[12px] font-semibold">Photo</span>
                    </span>
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError(null);
                    }}
                    autoFocus={!editing}
                    maxLength={200}
                    placeholder="Name, e.g. Oat milk 1L"
                    aria-label="Item name"
                    className={cn(softInput, 'text-[15px] font-semibold')}
                  />
                  {photoUrl !== null && !removePhoto && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhoto(null);
                        setRemovePhoto(true);
                      }}
                      className="self-start rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--erp-muted)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f === undefined) return;
                    if (f.size > 10 * 1024 * 1024) {
                      toast.error('Photos can be at most 10 MB');
                      return;
                    }
                    setPhoto(f);
                    setRemovePhoto(false);
                  }}
                />
              </div>
              <Field label="Kind" hint={hasHistory ? 'It has stock history, so it stays a stock item.' : kind === 'stock' ? 'Counted in stock, with a value in the books.' : kind === 'service' ? 'Work you sell or buy; nothing is counted.' : 'Goods you sell or buy without counting them.'}>
                <Segmented
                  ariaLabel="Kind"
                  value={kind}
                  onChange={(k) => {
                    if (hasHistory) return;
                    setKind(k);
                    if (k === 'service' && unit === 'pcs') setUnit('hour');
                  }}
                  options={[
                    { value: 'stock', label: 'Stock' },
                    { value: 'service', label: 'Service' },
                    { value: 'non_stock', label: 'Non-stock' },
                  ]}
                  className="flex w-full"
                />
              </Field>
              <Field label="Category">
                <div className="grid max-h-[282px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                  {(cats?.categories ?? []).map((c) => {
                    const Icon = iconOf(c.icon);
                    const on = c.id === category;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCategory(on ? '' : c.id)}
                        className={cn('flex flex-col items-center gap-1.5 rounded-[18px] px-2 py-2.5 transition-[background,transform] active:scale-[0.97]', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                      >
                        <span className={cn('flex size-9 items-center justify-center rounded-full', on ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-card)]')}>
                          <Icon size={16} strokeWidth={1.9} aria-hidden />
                        </span>
                        <span className="w-full truncate text-center text-[12px] font-semibold">{c.name}</span>
                      </button>
                    );
                  })}
                  <button type="button" aria-expanded={newCat} onClick={() => setNewCat((v) => !v)} className={cn('flex flex-col items-center gap-1.5 rounded-[18px] border-2 border-dashed px-2 py-2 transition-colors hover:bg-[var(--erp-row)]', newCat ? 'border-[var(--erp-ink)]' : 'border-[var(--erp-line)]')}>
                    <span className="flex size-9 items-center justify-center rounded-full bg-[var(--erp-row)]">
                      <Plus size={16} aria-hidden />
                    </span>
                    <span className="w-full truncate text-center text-[12px] font-semibold">New</span>
                  </button>
                </div>
                {newCat && (
                  <NewCategory
                    icons={cats?.icons ?? CATEGORY_ICON_NAMES}
                    onClose={() => setNewCat(false)}
                    onAdded={(id) => {
                      setCategory(id);
                      loadCats();
                    }}
                  />
                )}
              </Field>
              <Field label="Counted in">
                <div className="flex flex-wrap gap-2">
                  {UNITS.map((u) => (
                    <button
                      key={u}
                      type="button"
                      aria-pressed={unit === u}
                      onClick={() => {
                        setUnit(u);
                        if (PART_UNITS.has(u)) setFractional(true);
                      }}
                      className={cn('inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors', unit === u ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                    >
                      {u}
                    </button>
                  ))}
                  <input
                    value={UNITS.includes(unit) ? '' : unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={20}
                    placeholder="Other"
                    aria-label="Other unit"
                    className="h-9 w-24 rounded-full bg-[var(--erp-row)] px-3.5 text-[13px] font-semibold outline-none ring-[var(--erp-ink)] focus-visible:ring-2"
                  />
                </div>
              </Field>
              {isStock && (
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
                  <span>
                    <span className="block text-[13px] font-semibold">Counted in part units</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">Quantities like 2.5 (kg, metres, litres)</span>
                  </span>
                  <Toggle checked={fractional} onChange={setFractional} label="Counted in part units" disabled={hasHistory} />
                </div>
              )}
            </div>
          </Card>

          {/* Prices and taxes */}
          <Card delay={2}>
            <h2 className="mb-4 text-[15px] font-bold">Prices and taxes</h2>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sale price">
                  <MoneyInput value={salePrice} onChange={setSalePrice} currency={currency} decimals={4} ariaLabel="Sale price" />
                </Field>
                <Field label="Sales tax">
                  <PillSelect soft ariaLabel="Sales tax" value={saleTax} onChange={setSaleTax} options={taxOptions('sales')} />
                </Field>
                <Field label={isStock ? 'Purchase cost' : 'Purchase price'}>
                  <MoneyInput value={buyPrice} onChange={setBuyPrice} currency={currency} decimals={4} ariaLabel="Purchase price" />
                </Field>
                <Field label="Purchase tax">
                  <PillSelect soft ariaLabel="Purchase tax" value={buyTax} onChange={setBuyTax} options={taxOptions('purchase')} />
                </Field>
              </div>
              {salePrice !== '' && buyPrice !== '' && Number(salePrice) > 0 && <Margin sale={Number(salePrice)} cost={Number(buyPrice)} />}
              <Field label="Usual supplier" optional>
                <PartyPicker role="supplier" value={supplier} onChange={setSupplier} clearable />
              </Field>
              <Field label="Lead time" optional hint="Days the supplier takes to deliver">
                <NumberInput value={lead} onChange={setLead} decimals={0} ariaLabel="Lead time in days" suffix="days" placeholder="0" />
              </Field>
            </div>
          </Card>

          {/* Stock, more, save */}
          <div className="flex flex-col gap-5">
            {isStock && (
              <Card delay={3}>
                <h2 className="mb-4 text-[15px] font-bold">Stock</h2>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                    <Field label="Reorder point" hint="Low at or below this">
                      <Stepper value={minQty} onChange={setMinQty} fractional={fractional} ariaLabel="reorder point" className="w-full justify-between" />
                    </Field>
                    <Field label="Target level" hint="Reorders fill up to this">
                      <Stepper value={maxQty} onChange={setMaxQty} fractional={fractional} ariaLabel="target level" className="w-full justify-between" />
                    </Field>
                  </div>
                  {!editing && (
                    <div className="flex flex-col gap-3 rounded-[20px] bg-[var(--erp-row)] p-3">
                      <Field label="Opening stock" hint="What you have now. It is posted as the opening value.">
                        <Stepper value={openQty} onChange={setOpenQty} fractional={fractional} ariaLabel="opening stock" className="self-start bg-[var(--erp-card)]" />
                      </Field>
                      {Number(openQty) > 0 && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Cost per unit">
                              <MoneyInput value={openCost} onChange={setOpenCost} currency={currency} decimals={4} ariaLabel="Opening cost per unit" placeholder={buyPrice !== '' ? buyPrice : '0.00'} className="[&_input]:bg-[var(--erp-card)]" />
                            </Field>
                            <Field label="As of">
                              <DateField value={openDate} onChange={setOpenDate} ariaLabel="Opening stock date" max={today()} className="[&_button]:bg-[var(--erp-card)]" />
                            </Field>
                          </div>
                          {whs.length > 1 && (
                            <Field label="Warehouse">
                              <PillSelect soft ariaLabel="Opening stock warehouse" value={openWh} onChange={setOpenWh} options={whs.map((w) => ({ value: w.id, label: w.name }))} className="[&_select]:bg-[var(--erp-card)]" />
                            </Field>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Card delay={4}>
              <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                <SlidersHorizontal size={14} aria-hidden />
                {more ? 'Fewer options' : 'More options: codes, accounts, description'}
              </button>
              {more && (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="SKU" hint={editing ? undefined : 'Empty numbers it'}>
                      <input value={sku} onChange={(e) => setSku(e.target.value.replace(/\s/g, ''))} maxLength={40} placeholder={skuNext !== '' ? skuNext : 'Automatic'} aria-label="SKU" className={cn(softInput, 'num')} />
                    </Field>
                    <Field label="Barcode">
                      <input value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} maxLength={60} placeholder="Scan or type" aria-label="Barcode" className={cn(softInput, 'num')} />
                    </Field>
                  </div>
                  <Field label="Income account" hint="Empty uses the category's account">
                    <AccountPicker value={income} onChange={setIncome} types={['income']} postable clearable placeholder="From the category" />
                  </Field>
                  <Field label={isStock ? 'Cost of goods account' : 'Expense account'} hint="Empty uses the category's account">
                    <AccountPicker value={expense} onChange={setExpense} types={['expense']} postable clearable placeholder="From the category" />
                  </Field>
                  <Field label="Description" optional>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Size, colour, what it is for" aria-label="Description" className={softArea} />
                  </Field>
                </div>
              )}
            </Card>

            {error !== null && (
              <div className="erp-shake">
                <Notice tone="bad" icon={AlertTriangle}>
                  {error}
                </Notice>
              </div>
            )}
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--erp-line)] bg-[var(--erp-shell)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <PillButton variant="dark" icon={editing ? Check : Plus} dot loading={busy} disabled={name.trim() === ''} onClick={() => void save()} className="h-14 w-full text-[15px]">
                {editing ? 'Save changes' : 'Add item'}
              </PillButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Margin({ sale, cost }: { sale: number; cost: number }): React.JSX.Element {
  const m = sale > 0 ? (sale - cost) / sale : 0;
  return (
    <div className="flex items-center justify-between rounded-[18px] bg-[var(--erp-row)] px-4 py-2.5 text-[13px]">
      <span className="font-semibold text-[var(--erp-ink-2)]">Margin</span>
      <span className={cn('num font-bold', m < 0 && 'text-[var(--erp-red-text)]')}>{Math.round(m * 1000) / 10}%</span>
    </div>
  );
}

/** Add a category in place: a name and its line icon. */
function NewCategory({ icons, onClose, onAdded }: { icons: string[]; onClose: () => void; onAdded: (id: string) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('package');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ id: string }>('categories.add', { name: name.trim(), icon }, { quiet: true });
      onAdded(r.id);
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="erp-pop mt-1 flex flex-col gap-3 rounded-[20px] bg-[var(--erp-row)] p-3">
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
        }}
        maxLength={60}
        autoFocus
        placeholder="New category name"
        aria-label="New category name"
        className={cn(softInput, 'bg-[var(--erp-card)]')}
      />
      <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Category icon">
        {icons.map((n) => {
          const Icon = iconOf(n);
          const on = n === icon;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={n.replace(/-/g, ' ')}
              title={n.replace(/-/g, ' ')}
              onClick={() => setIcon(n)}
              className={cn('flex aspect-square items-center justify-center rounded-[10px] transition-colors', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)] hover:bg-[var(--erp-row-hover)]')}
            >
              <Icon size={15} strokeWidth={1.9} />
            </button>
          );
        })}
      </div>
      {error !== null && <p className="px-1 text-[12px] font-semibold text-[var(--erp-red-text)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <PillButton size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </PillButton>
        <PillButton size="sm" loading={busy} disabled={name.trim() === ''} onClick={() => void add()}>
          Add category
        </PillButton>
      </div>
    </div>
  );
}

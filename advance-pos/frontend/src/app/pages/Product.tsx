/**
 * One product: its name, category, price and codes; options (up to three,
 * like Size and Color) whose combinations are its variants, each with its
 * own price, codes and stock; the option groups sold with it; its picture
 * or tile color; tax; and archiving or deleting it. Opening stock is set
 * here for new variants; after that stock moves through Stock, with
 * history.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Check, ImagePlus, Plus, Star, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import type { ProductInput } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { abbreviation, qty as qtyText, toMinor, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { back, href, navigate } from '../lib/router.ts';
import type { Product, Variant } from '../lib/types.ts';
import { MoneyField, SlotPicker, StockBadge, tile } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Button, Field, IconButton, PageHeader, Panel, Segmented, Select, Toggle, inputCls, textareaCls } from '../components/ui.tsx';
import { noteSaved } from './Products.tsx';

interface Row {
  id?: string | undefined;
  options: string[];
  price: string;
  cost: string;
  sku: string;
  barcode: string;
  track: boolean;
  stock: string;
  low: string;
}

const MAX_OPTIONS = 3;

function combos(values: string[][]): string[][] {
  if (values.length === 0) return [];
  return values.reduce<string[][]>((acc, vals) => acc.flatMap((a) => vals.map((v) => [...a, v])), [[]]).filter((c) => c.length === values.length);
}

/** Values of one option: type and press Enter or comma; click a value to remove it. */
function ValueInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const add = (): void => {
    const parts = text
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x !== '' && !values.some((v) => v.toLowerCase() === x.toLowerCase()));
    if (parts.length > 0) onChange([...values, ...parts]);
    setText('');
  };
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)] px-1 py-0.5 focus-within:border-[var(--ps-ink)]">
      {values.map((v) => (
        <button key={v} type="button" title={'Remove ' + v} onClick={() => onChange(values.filter((x) => x !== v))} className="inline-flex h-5 items-center gap-1 rounded-[var(--ps-r-sm)] bg-[var(--ps-row-hover)] px-1.5 text-[12px] font-semibold hover:bg-[var(--ps-red)]/15">
          {v}
          <X size={11} />
        </button>
      ))}
      <input
        className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && text === '' && values.length > 0) onChange(values.slice(0, -1));
        }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        aria-label={placeholder}
      />
    </div>
  );
}

function rowOf(v: Variant, plain: (n: number) => string): Row {
  return { id: v.id, options: v.options, price: plain(v.price), cost: v.cost === 0 ? '' : plain(v.cost), sku: v.sku, barcode: v.barcode, track: v.track_stock, stock: '', low: v.low_at === 0 ? '' : qtyText(v.low_at) };
}

function Editor({ product }: { product: Product | null }): React.JSX.Element {
  const { money, catalog, settings } = useStore();
  const isNew = product === null;
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [soldBy, setSoldBy] = useState<'each' | 'weight'>(product?.sold_by ?? 'each');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [color, setColor] = useState<string>(product?.color ?? 'neutral');
  const [favorite, setFavorite] = useState(product?.favorite ?? false);
  const [tax, setTax] = useState(product === null ? 'default' : product.tax_exempt ? 'exempt' : product.tax_own !== '' ? product.tax_own : 'default');
  const [groups, setGroups] = useState<string[]>(product?.modifier_groups ?? []);
  const [optionNames, setOptionNames] = useState<string[]>(product?.option_names ?? []);
  const live = useMemo(() => (product?.variants ?? []).filter((v) => !v.archived), [product]);
  const [optionValues, setOptionValues] = useState<string[][]>(() => (product?.option_names ?? []).map((_, i) => Array.from(new Set(live.map((v) => v.options[i] ?? '').filter((x) => x !== '')))));
  const [rows, setRows] = useState<Row[]>(() => live.map((v) => rowOf(v, money.plain)));
  const [single, setSingle] = useState<Row>(() => (live.length === 1 && (product?.option_names ?? []).length === 0 && live[0] !== undefined ? rowOf(live[0], money.plain) : { options: [], price: '', cost: '', sku: '', barcode: '', track: false, stock: '', low: '' }));
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (image === null) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const optioned = optionNames.length > 0;

  // Keep the variant rows in step with the option values (existing rows keep their details).
  useEffect(() => {
    if (!optioned) return;
    const wanted = combos(optionValues.slice(0, optionNames.length));
    setRows((cur) =>
      wanted.map((opts) => {
        const hit = cur.find((r) => r.options.length === opts.length && r.options.every((x, i) => x === opts[i]));
        if (hit !== undefined) return hit;
        const old = live.find((v) => v.options.length === opts.length && v.options.every((x, i) => x === opts[i]));
        if (old !== undefined) return rowOf(old, money.plain);
        const first = cur[0];
        return { options: opts, price: first?.price ?? single.price, cost: first?.cost ?? '', sku: '', barcode: '', track: first?.track ?? false, stock: '', low: first?.low ?? '' };
      }),
    );
  }, [optionValues, optionNames.length, optioned, live, money, single.price]);

  const setRow = (i: number, patch: Partial<Row>): void => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const moneyOk = (t: string, required: boolean): boolean => (t.trim() === '' ? !required : (toMinor(t, money.digits) ?? -1) >= 0);
  const numOk = (t: string): boolean => t.trim() === '' || (Number.isFinite(Number(t.replace(',', '.'))) && Number(t.replace(',', '.')) >= 0);
  const rowOk = (r: Row): boolean => moneyOk(r.price, true) && moneyOk(r.cost, false) && numOk(r.low) && (r.stock.trim() === '' || Number.isFinite(Number(r.stock.replace(',', '.')))) && !/\s/.test(r.sku) && !/\s/.test(r.barcode);
  const names = optionNames.map((n) => n.trim());
  const namesOk = names.every((n) => n !== '') && new Set(names.map((n) => n.toLowerCase())).size === names.length;
  const ok = name.trim() !== '' && (optioned ? namesOk && rows.length > 0 && rows.every(rowOk) && optionValues.slice(0, optionNames.length).every((v) => v.length > 0) : rowOk(single));

  const variantInput = (r: Row): NonNullable<ProductInput['variants']>[number] => ({
    id: r.id,
    options: optioned ? r.options : undefined,
    price: r.price.trim(),
    cost: r.cost.trim() === '' ? '0' : r.cost.trim(),
    sku: r.sku.trim(),
    barcode: r.barcode.trim(),
    track_stock: r.track,
    low_at: r.low.trim() === '' ? 0 : Number(r.low.replace(',', '.')),
    stock: r.id === undefined && r.stock.trim() !== '' ? Number(r.stock.replace(',', '.')) : undefined,
  });

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const input: ProductInput = {
      id: product?.id,
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      sold_by: soldBy,
      unit: unit.trim(),
      color,
      favorite,
      tax: tax === 'exempt' ? 'default' : tax,
      tax_exempt: tax === 'exempt',
      modifier_groups: groups,
      option_names: names,
      variants: optioned ? rows.map(variantInput) : [variantInput(single)],
      remove_image: removeImage && image === null ? true : undefined,
    };
    try {
      const r = await api.saveProduct(input, image);
      noteSaved(r.product.name, r.notes);
      if (isNew) navigate('product', { id: r.product.id });
      else {
        setImage(null);
        setRemoveImage(false);
      }
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  const archive = async (on: boolean): Promise<void> => {
    if (product === null) return;
    try {
      await api.saveProduct({ id: product.id, archived: on });
      toast.success(on ? product.name + ' archived: it is off the sell screen and stays in reports' : product.name + ' is back on sale');
    } catch {
      // Shown by the transport.
    }
  };

  const shownImage = preview !== '' ? preview : !removeImage && product !== null && product.image !== '' ? product.image + '?thumb=480x480' : '';
  const taxes = catalog?.taxes ?? [];
  const groupsAll = catalog?.modifier_groups ?? [];
  const cats = catalog?.categories ?? [];

  /** Live stock of an existing variant (it moves while this page is open). */
  const stockOf = (r: Row): { stock: number; status: Variant['status'] } | null => {
    if (r.id === undefined) return null;
    const v = (product?.variants ?? []).find((x) => x.id === r.id);
    return v === undefined ? null : { stock: v.stock, status: v.status };
  };

  return (
    <div>
      <div className="mb-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => back('products')}>
          Products
        </Button>
      </div>
      <PageHeader
        title={isNew ? 'New product' : product.name}
        subtitle={product !== null && product.archived ? 'Archived: not on the sell screen' : product !== null ? 'Changed ' + when(product.updated) : undefined}
        actions={
          <>
            {product !== null && (product.archived ? <Button icon={ArchiveRestore} onClick={() => void archive(false)}>Put back on sale</Button> : <Button icon={Archive} onClick={() => void archive(true)}>Archive</Button>)}
            {product !== null && <DeleteButton collection="products" id={product.id} name={product.name} variant="button" onDeleted={() => navigate('products')} />}
            <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
              {isNew ? 'Add product' : 'Save'}
            </Button>
          </>
        }
      />

      <form
        className="grid gap-4 lg:grid-cols-[1fr_300px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Name">
                  <input autoFocus={isNew} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Flat white" />
                </Field>
              </div>
              <Field label="Category" hint="Pick one or type a new one">
                <input className={inputCls} list="ps-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} placeholder="No category" />
                <datalist id="ps-categories">
                  {cats.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
              <Field group label="Sold by">
                <div className="flex items-center gap-2">
                  <Segmented
                    label="Sold by"
                    value={soldBy}
                    onChange={setSoldBy}
                    options={[
                      { value: 'each', label: 'Each' },
                      { value: 'weight', label: 'Weight or length' },
                    ]}
                  />
                  {soldBy === 'weight' && <input className={inputCls + ' w-20'} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={12} placeholder="kg" aria-label="Unit" />}
                </div>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <textarea className={textareaCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel
            title={optioned ? 'Variants' : 'Price and stock'}
            subtitle={optioned ? rows.length + ' combinations of ' + names.join(', ') : undefined}
            actions={
              optionNames.length < MAX_OPTIONS ? (
                <Button
                  size="sm"
                  icon={Plus}
                  onClick={() => {
                    setOptionNames([...optionNames, optionNames.length === 0 ? 'Size' : optionNames.length === 1 ? 'Color' : 'Material']);
                    setOptionValues([...optionValues, []]);
                  }}
                >
                  Add an option
                </Button>
              ) : undefined
            }
          >
            {optioned && (
              <div className="mb-3 flex flex-col gap-2">
                {optionNames.map((n, i) => (
                  <div key={i} className="grid grid-cols-[140px_1fr_auto] items-start gap-2">
                    <input className={inputCls} value={n} onChange={(e) => setOptionNames(optionNames.map((x, k) => (k === i ? e.target.value : x)))} maxLength={30} aria-label="Option name" />
                    <ValueInput values={optionValues[i] ?? []} onChange={(v) => setOptionValues(optionValues.map((x, k) => (k === i ? v : x)))} placeholder={'Values of ' + (n || 'this option') + ', e.g. Small, Large'} />
                    <IconButton
                      icon={Trash2}
                      label={'Remove the option ' + n}
                      variant="danger"
                      onClick={() => {
                        const nextNames = optionNames.filter((_, k) => k !== i);
                        setOptionNames(nextNames);
                        setOptionValues(optionValues.filter((_, k) => k !== i));
                        if (nextNames.length === 0) setRows([]);
                        else setRows((cur) => cur.map((r) => ({ ...r, id: undefined, options: r.options.filter((_, k) => k !== i) })));
                      }}
                    />
                  </div>
                ))}
                {!namesOk && <p className="text-[12px] font-semibold text-[var(--ps-red-text)]">Each option needs a different name.</p>}
              </div>
            )}

            {optioned ? (
              rows.length === 0 ? (
                <p className="rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-3 text-center text-[12px] text-[var(--ps-muted)]">Add values to each option to make the variants.</p>
              ) : (
                <div className="-mx-3 overflow-x-auto">
                  <table className="ps-table">
                    <thead>
                      <tr>
                        <th>Variant</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Cost</th>
                        <th>SKU</th>
                        <th>Barcode</th>
                        <th>Count stock</th>
                        <th className="text-right">{isNew ? 'Opening' : 'On hand'}</th>
                        <th className="text-right">Low at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.options.join('|')}>
                          <td className="whitespace-nowrap font-semibold">{r.options.join(' / ')}</td>
                          <td>
                            <MoneyField value={r.price} onChange={(v) => setRow(i, { price: v })} money={money} label="Price" className="min-w-[96px]" invalid={!moneyOk(r.price, true) && r.price !== ''} />
                          </td>
                          <td>
                            <MoneyField value={r.cost} onChange={(v) => setRow(i, { cost: v })} money={money} label="Cost" className="min-w-[88px]" />
                          </td>
                          <td>
                            <input className={cn(inputCls, 'mono min-w-[96px]')} value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} maxLength={64} placeholder="SKU" aria-label="SKU" />
                          </td>
                          <td>
                            <input className={cn(inputCls, 'mono min-w-[110px]')} value={r.barcode} onChange={(e) => setRow(i, { barcode: e.target.value })} maxLength={64} placeholder="Barcode" aria-label="Barcode" />
                          </td>
                          <td>
                            <Toggle checked={r.track} onChange={(v) => setRow(i, { track: v })} label={'Count stock of ' + r.options.join(' / ')} />
                          </td>
                          <td className="text-right">
                            {r.id === undefined ? (
                              <input className={cn(inputCls, 'num w-20 text-right')} inputMode="decimal" value={r.stock} onChange={(e) => setRow(i, { stock: e.target.value, track: e.target.value.trim() !== '' ? true : r.track })} placeholder="0" aria-label="Opening stock" />
                            ) : r.track ? (
                              <StockBadge status={stockOf(r)?.status ?? 'ok'} stock={stockOf(r)?.stock ?? 0} />
                            ) : (
                              <span className="text-[12px] text-[var(--ps-muted)]">Not counted</span>
                            )}
                          </td>
                          <td>
                            <input className={cn(inputCls, 'num w-16 text-right')} inputMode="decimal" value={r.low} onChange={(e) => setRow(i, { low: e.target.value })} placeholder={String(settings?.low_stock_default ?? 0)} aria-label="Low at" disabled={!r.track} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={soldBy === 'weight' && unit !== '' ? 'Price per ' + unit : 'Price'} error={single.price !== '' && !moneyOk(single.price, true) ? 'Not an amount' : null}>
                  <MoneyField value={single.price} onChange={(v) => setSingle({ ...single, price: v })} money={money} label="Price" />
                </Field>
                <Field label="Cost" hint="What you pay for it; reports show the margin">
                  <MoneyField value={single.cost} onChange={(v) => setSingle({ ...single, cost: v })} money={money} label="Cost" />
                </Field>
                <Field label="SKU">
                  <input className={inputCls + ' mono'} value={single.sku} onChange={(e) => setSingle({ ...single, sku: e.target.value })} maxLength={64} />
                </Field>
                <Field label="Barcode" hint="Scan it into this field">
                  <input className={inputCls + ' mono'} value={single.barcode} onChange={(e) => setSingle({ ...single, barcode: e.target.value })} maxLength={64} />
                </Field>
                <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 sm:col-span-2">
                  <span>
                    <span className="block text-[13px] font-semibold">Count stock</span>
                    <span className="block text-[12px] text-[var(--ps-muted)]">Sales take it out; returns and deliveries put it back.</span>
                  </span>
                  <Toggle checked={single.track} onChange={(v) => setSingle({ ...single, track: v })} label="Count stock" />
                </label>
                {single.track && (
                  <>
                    {single.id === undefined ? (
                      <Field label="Opening stock">
                        <input className={inputCls + ' num text-right'} inputMode="decimal" value={single.stock} onChange={(e) => setSingle({ ...single, stock: e.target.value })} placeholder="0" />
                      </Field>
                    ) : (
                      <Field group label="On hand" hint={<a className="font-semibold underline-offset-4 hover:underline" href={href('stock', { q: single.sku !== '' ? single.sku : name })}>Receive or count in Stock</a>}>
                        <div className="flex h-7 items-center">
                          <StockBadge status={stockOf(single)?.status ?? 'ok'} stock={stockOf(single)?.stock ?? 0} unit={unit} />
                        </div>
                      </Field>
                    )}
                    <Field label="Low at" hint="Shows as low and goes on the restock list">
                      <input className={inputCls + ' num text-right'} inputMode="decimal" value={single.low} onChange={(e) => setSingle({ ...single, low: e.target.value })} placeholder={String(settings?.low_stock_default ?? 0)} />
                    </Field>
                  </>
                )}
              </div>
            )}
          </Panel>

          {groupsAll.length > 0 && (
            <Panel title="Option groups" subtitle="Choices offered when this product is sold">
              <div className="flex flex-wrap gap-1.5">
                {groupsAll.map((g) => {
                  const on = groups.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGroups(on ? groups.filter((x) => x !== g.id) : [...groups, g.id])}
                      className={cn('inline-flex h-8 items-center gap-1.5 rounded-[var(--ps-r)] border px-3 text-[13px] font-semibold', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}
                    >
                      {on && <Check size={13} />}
                      {g.name}
                      {g.min > 0 && <span className="text-[12px] opacity-70">required</span>}
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="On the sell screen">
            <div className="flex flex-col gap-3">
              <div className="relative">
                {shownImage !== '' ? (
                  <img src={shownImage} alt="" className="aspect-square w-full rounded-[var(--ps-r-md)] object-cover" />
                ) : (
                  <div style={tile(color)} className="flex aspect-square w-full items-center justify-center rounded-[var(--ps-r-md)] text-[26px] font-bold">
                    {abbreviation(name || 'New')}
                  </div>
                )}
                <div className="absolute bottom-2 right-2 flex gap-1">
                  <IconButton icon={ImagePlus} label="Choose a picture" variant="secondary" onClick={() => fileRef.current?.click()} />
                  {shownImage !== '' && (
                    <IconButton
                      icon={X}
                      label="Remove the picture"
                      variant="secondary"
                      onClick={() => {
                        setImage(null);
                        setRemoveImage(true);
                      }}
                    />
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f !== undefined) {
                      if (f.size > 5 * 1024 * 1024) toast.error('The picture is larger than 5 MB');
                      else {
                        setImage(f);
                        setRemoveImage(false);
                      }
                    }
                    e.target.value = '';
                  }}
                />
              </div>
              {shownImage === '' && (
                <Field group label="Tile color">
                  <SlotPicker value={color} onChange={setColor} />
                </Field>
              )}
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <Star size={15} className="text-[var(--ps-amber-text)]" />
                  Favorite
                </span>
                <Toggle checked={favorite} onChange={setFavorite} label="Favorite" />
              </label>
            </div>
          </Panel>
          <Panel title="Tax">
            <Select
              ariaLabel="Tax"
              value={tax}
              onChange={setTax}
              options={[
                { value: 'default', label: 'Store default' + (taxes.find((t) => t.is_default) ? ' (' + (taxes.find((t) => t.is_default)?.name ?? '') + ' ' + (taxes.find((t) => t.is_default)?.rate ?? 0) + '%)' : '') },
                ...taxes.filter((t) => !t.is_default).map((t) => ({ value: t.id, label: t.name + ' ' + t.rate + '%' })),
                { value: 'exempt', label: 'No tax' },
              ]}
            />
          </Panel>
        </div>
      </form>
    </div>
  );
}

export function ProductPage({ id }: { id: string }): React.JSX.Element {
  const isNew = id === 'new' || id === '';
  const p = useLive(() => (isNew ? Promise.resolve(null) : api.product(id)), ['products', 'variants'], [id]);
  if (isNew) return <Editor product={null} />;
  if (p.data === null) return <div className="py-16 text-center text-[13px] text-[var(--ps-muted)]">{p.error ?? ''}</div>;
  // Re-mount the editor when the product changes elsewhere (keyed by its update time).
  return <Editor key={p.data.product.updated} product={p.data.product} />;
}

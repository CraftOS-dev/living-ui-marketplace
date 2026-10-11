/**
 * The product editor: a full screen that grows out of the row or the button
 * that opened it. Three numbered steps read left to right: what it is (name,
 * category, price or open price, tax class), its sizes and the option groups
 * offered with it, then stock and details (SKU, barcodes typed or scanned,
 * stock tracking, cost, tile color, photo, favorite, description) ending in
 * Save. Prices are typed as on the receipt ("4.50"); a product that was ever
 * sold is archived, never deleted.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Ban, Check, ImagePlus, Plus, Star, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { majorText, money, parseMoney, symbolOf } from '../../lib/format.ts';
import { catVars, iconFor } from '../../lib/icons.tsx';
import { useScanner } from '../../lib/scanner.ts';
import type { Product } from '../../lib/types.ts';
import { Button, Field, IconButton, RevealScreen, ScreenHeader, Select, Spinner, Step, TextField, Toggle, inputCls, originOf, textareaCls, useConfirm } from '../ui.tsx';
import type { Origin, StepState } from '../ui.tsx';

interface VariantRow {
  id: string;
  name: string;
  price: string;
  sku: string;
  cost: string;
}

/** The label over a group of controls (the look of a field's label). */
const groupLabel = 'px-1 text-[13px] font-semibold text-[var(--ps-ink-2)]';
/** The small label over a field inside a soft row. */
const miniLabel = 'px-1 text-[12px] font-semibold text-[var(--ps-ink-2)]';
/** A white pill field for soft rows. */
const rowInput = cn(inputCls, 'bg-[var(--ps-card)] px-4');
/** A switch with its words: the whole soft row toggles it. */
const switchRow = 'flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-[20px] bg-[var(--ps-row)] px-4 py-3 text-[13px] font-semibold';
const invalid = 'ring-2 ring-[var(--ps-red)]';

export function MoneyField({ label, value, onChange, currency, exp, hint, allowEmpty = true }: { label: string; value: string; onChange: (v: string) => void; currency: string; exp: number; hint?: string; allowEmpty?: boolean }): React.JSX.Element {
  const bad = value.trim() !== '' ? parseMoney(value, exp) === null : !allowEmpty;
  return (
    <Field label={label} error={bad && value.trim() !== '' ? `An amount like ${exp === 0 ? '500' : '4.50'}` : null} hint={hint}>
      <div className="relative">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[var(--ps-muted)]">{symbolOf(currency)}</span>
        <input inputMode="decimal" aria-label={label !== '' ? label : 'Amount'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={exp === 0 ? '0' : '0.00'} className={cn(inputCls, 'num pl-14 text-right', bad && value.trim() !== '' && invalid)} />
      </div>
    </Field>
  );
}

export function ColorPicker({ value, onChange, allowNone, noneLabel }: { value: number; onChange: (v: number) => void; allowNone: boolean; noneLabel: string }): React.JSX.Element {
  const slots = allowNone ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <div role="radiogroup" aria-label="Color" className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1.5">
      {slots.map((n) => {
        const c = catVars(n);
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={n === 0 ? noneLabel : `Color ${n}`}
            title={n === 0 ? noneLabel : `Color ${n}`}
            onClick={() => onChange(n)}
            className={cn('ps-press flex aspect-square w-full max-w-10 items-center justify-center rounded-full ring-inset ring-[var(--ps-ink)]', on ? 'ring-2' : 'hover:bg-[var(--ps-row-hover)]')}
          >
            {n === 0 ? (
              <span className="flex size-[70%] items-center justify-center rounded-full bg-[var(--ps-row)] text-[var(--ps-ink-2)]">
                <Ban size={13} aria-hidden />
              </span>
            ) : (
              <span className="size-[70%] rounded-full" style={{ background: c.mark }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ProductEditor({
  id,
  preset,
  origin,
  onClose,
}: {
  id: string | null;
  preset?: { barcode?: string; category?: string };
  /** Where the screen grows from (the row or button that opened it); the middle of the screen without one. */
  origin?: Origin | null;
  onClose: (saved: Product | null) => void;
}): React.JSX.Element {
  const { catalog, taxes, settings, currency, exp } = useApp();
  const categories = catalog?.categories ?? [];
  const groups = catalog?.groups ?? [];
  const liveTaxes = taxes.filter((t) => !t.archived);
  const [from] = useState<Origin>(() => origin ?? originOf(null));
  const [loaded, setLoaded] = useState<Product | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(preset?.category ?? '');
  const [price, setPrice] = useState('');
  const [openPrice, setOpenPrice] = useState(false);
  const [tax, setTax] = useState(liveTaxes.find((t) => t.is_default)?.id ?? '');
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [codes, setCodes] = useState<{ code: string; variant: string }[]>(preset?.barcode !== undefined && preset.barcode !== '' ? [{ code: preset.barcode, variant: '' }] : []);
  const [codeDraft, setCodeDraft] = useState('');
  const [sku, setSku] = useState('');
  const [cost, setCost] = useState('');
  const [color, setColor] = useState(0);
  const [favorite, setFavorite] = useState(false);
  const [available, setAvailable] = useState(true);
  const [track, setTrack] = useState(false);
  const [low, setLow] = useState('');
  const [opening, setOpening] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const categoryLabel = useId();
  const optionsLabel = useId();
  // The screen shrinks back into where it came from, then tells the page what was saved (the first ending counts).
  const result = useRef<Product | null>(null);
  const shrink = useRef<() => void>(() => undefined);
  const ended = useRef(false);
  const finish = useCallback((saved: Product | null): void => {
    if (ended.current) return;
    ended.current = true;
    result.current = saved;
    shrink.current();
  }, []);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    api
      .product(id)
      .then((p) => {
        if (!live) return;
        setLoaded(p);
        setName(p.name);
        setCategory(p.category);
        setPrice(p.variants.length > 0 ? '' : majorText(p.price, exp));
        setOpenPrice(p.open_price);
        setTax(p.tax_class);
        setVariants(p.variants.map((v) => ({ id: v.id, name: v.name, price: majorText(v.price, exp), sku: v.sku, cost: v.cost > 0 ? majorText(v.cost, exp) : '' })));
        setMods(p.modifier_groups);
        setCodes(p.barcodes.map((b) => ({ code: b.code, variant: b.variant })));
        setSku(p.sku);
        setCost(p.cost > 0 ? majorText(p.cost, exp) : '');
        setColor(p.own_color);
        setFavorite(p.favorite);
        setAvailable(p.available);
        setTrack(p.track_stock);
        setLow(p.low_stock > 0 ? String(p.low_stock) : '');
        setDescription(p.description);
      })
      .catch(() => {
        if (live) finish(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Load once per product.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Esc goes back to the list (a dialog on top takes its own Esc first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      finish(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  // A barcode scanned while the editor is open is added to it.
  useScanner((code) => {
    if (!codes.some((c) => c.code.toLowerCase() === code.toLowerCase())) setCodes([...codes, { code, variant: '' }]);
  });

  const addCode = (): void => {
    const c = codeDraft.trim();
    if (c === '' || codes.some((x) => x.code.toLowerCase() === c.toLowerCase())) return;
    setCodes([...codes, { code: c, variant: '' }]);
    setCodeDraft('');
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    if (name.trim() === '') out.push('A name');
    if (variants.length === 0 && !openPrice && parseMoney(price, exp) === null) out.push('A price');
    for (const v of variants) {
      if (v.name.trim() === '') out.push('A name for every size');
      if (parseMoney(v.price, exp) === null) out.push('A price for every size');
      if (v.cost.trim() !== '' && parseMoney(v.cost, exp) === null) out.push('Size costs as amounts');
    }
    if (cost.trim() !== '' && parseMoney(cost, exp) === null) out.push('The cost as an amount');
    if (low.trim() !== '' && !/^\d+$/.test(low.trim())) out.push('The low stock alert as a whole number');
    if (opening.trim() !== '' && !/^-?\d+$/.test(opening.trim())) out.push('Opening stock as a whole number');
    return [...new Set(out)];
  }, [name, variants, openPrice, price, cost, low, opening, exp]);

  const save = async (): Promise<void> => {
    if (problems.length > 0) {
      toast.error(`Missing: ${problems.join(', ')}`);
      return;
    }
    setBusy(true);
    const fields: Record<string, string> = {
      name: name.trim(),
      category,
      price: variants.length > 0 || openPrice ? '0' : price.trim(),
      open_price: String(openPrice),
      tax_class: tax,
      sku: sku.trim(),
      cost: cost.trim(),
      color: String(color),
      favorite: String(favorite),
      available: String(available),
      track_stock: String(track),
      low_stock: low.trim() === '' ? '0' : low.trim(),
      description: description.trim(),
      modifier_groups: JSON.stringify(mods),
      variants: JSON.stringify(variants.map((v) => ({ ...(v.id !== '' ? { id: v.id } : {}), name: v.name.trim(), price: v.price.trim(), sku: v.sku.trim(), cost: v.cost.trim() }))),
      barcodes: JSON.stringify(codes),
    };
    if (id === null && track && opening.trim() !== '') fields['stock'] = opening.trim();
    if (id !== null) fields['product'] = id;
    if (clearPhoto) fields['clear_photo'] = 'true';
    try {
      let saved: Product;
      if (photo !== null) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) form.append(k, v);
        form.append('photo', photo);
        saved = id === null ? await api.addProduct(form) : await api.updateProduct(form);
      } else saved = id === null ? await api.addProduct(fields) : await api.updateProduct(fields);
      toast.success(id === null ? `Added ${saved.name}` : `Saved ${saved.name}`);
      finish(saved);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (loaded === null) return;
    if (!loaded.archived) {
      const ok = await confirm(`${loaded.name} stops selling and leaves the register. Its sales stay in reports.`, `Archive ${loaded.name}?`, 'Archive');
      if (!ok) return;
    }
    try {
      if (loaded.archived) await api.restoreProduct(loaded.id);
      else await api.archiveProduct(loaded.id);
      toast.success(loaded.archived ? `${loaded.name} is back` : `Archived ${loaded.name}`);
      finish(null);
    } catch {
      /* toasted */
    }
  };

  // The picked photo's preview lives as long as the pick does.
  const picked = useMemo(() => (photo !== null ? URL.createObjectURL(photo) : ''), [photo]);
  useEffect(
    () => () => {
      if (picked !== '') URL.revokeObjectURL(picked);
    },
    [picked],
  );
  const photoUrl = photo !== null ? picked : clearPhoto ? '' : (loaded?.thumb_url ?? '');
  const cat = categories.find((c) => c.id === category);
  const Icon = iconFor(cat?.icon ?? 'tag');
  const tint = catVars(color || (cat?.color ?? 0));

  const setVariant = (i: number, patch: Partial<VariantRow>): void => setVariants(variants.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const sizePrices = variants.map((v) => parseMoney(v.price, exp)).filter((n): n is number => n !== null);
  const sizeRange =
    sizePrices.length === 0
      ? ''
      : Math.min(...sizePrices) === Math.max(...sizePrices)
        ? money(Math.min(...sizePrices), currency, exp)
        : `${money(Math.min(...sizePrices), currency, exp)} to ${money(Math.max(...sizePrices), currency, exp)}`;

  // The step to do next is marked; finished steps show a check.
  const basics = name.trim() !== '' && (variants.length > 0 || openPrice || parseMoney(price, exp) !== null);
  const sizes = variants.every((v) => v.name.trim() !== '' && parseMoney(v.price, exp) !== null && (v.cost.trim() === '' || parseMoney(v.cost, exp) !== null));
  const step1: StepState = basics ? 'done' : 'current';
  const step2: StepState = !basics ? 'todo' : sizes ? 'done' : 'current';
  const step3: StepState = basics && sizes ? 'current' : 'todo';

  const title = id === null ? 'New product' : (loaded?.name ?? 'Product');
  const subtitle =
    loaded !== null && loaded.status === 'draft'
      ? 'Imported by your AI agent, to review'
      : loaded?.sold_30d !== undefined && loaded.sold_30d.qty > 0
        ? `Sold ${loaded.sold_30d.qty} in the last 30 days (${money(loaded.sold_30d.net, currency, exp)})`
        : undefined;
  const pickable = [{ id: '', name: 'No category', color: 0, icon: 'tag' }, ...categories];

  return (
    <RevealScreen origin={from} label={title} onClosed={() => onClose(result.current)}>
      {(close) => {
        shrink.current = close;
        return (
          <div className="mx-auto w-full max-w-[1240px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
            <div className="mx-auto max-w-[560px] min-[1100px]:max-w-none">
              <ScreenHeader
                title={title}
                subtitle={subtitle}
                onBack={() => finish(null)}
                actions={
                  loaded !== null ? (
                    <Button variant="light" icon={loaded.archived ? ArchiveRestore : Archive} onClick={() => void archive()} className={cn('hidden sm:inline-flex', !loaded.archived && 'text-[var(--ps-red-text)]')}>
                      {loaded.archived ? 'Restore' : 'Archive'}
                    </Button>
                  ) : undefined
                }
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-24">
                <Spinner size={28} />
              </div>
            ) : (
              <div className="mx-auto grid max-w-[560px] gap-4 min-[1100px]:max-w-none min-[1100px]:grid-cols-3 min-[1100px]:gap-5">
                {/* 1. What it is */}
                <Step n={1} state={step1} title="What it is" hint="Required" delay={2}>
                  <div className="flex flex-col gap-4">
                    <TextField label="Name" value={name} onChange={setName} autoFocus={id === null} maxLength={80} />
                    <div className="flex min-w-0 flex-col gap-2">
                      <span id={categoryLabel} className={groupLabel}>
                        Category
                      </span>
                      <div role="radiogroup" aria-labelledby={categoryLabel} className="grid grid-cols-3 gap-2 sm:max-[1099px]:grid-cols-4">
                        {pickable.map((c) => {
                          const on = c.id === category;
                          const v = catVars(c.color);
                          const CatIcon = iconFor(c.icon);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => setCategory(c.id)}
                              className={cn('ps-press flex min-w-0 flex-col items-center gap-2 rounded-[20px] px-2 py-3', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
                            >
                              <span aria-hidden className={cn('flex size-10 items-center justify-center rounded-full', on && 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)]')} style={on ? undefined : { background: v.soft, color: v.text }}>
                                <CatIcon size={18} />
                              </span>
                              <span className="w-full truncate text-center text-[12px] font-semibold">{c.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {variants.length === 0 && !openPrice ? (
                        <MoneyField label={`Price${settings?.price_mode === 'inclusive' ? ' (with tax)' : ' (before tax)'}`} value={price} onChange={setPrice} currency={currency} exp={exp} />
                      ) : (
                        <>
                          <span className={groupLabel}>Price</span>
                          {!openPrice && (
                            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-[22px] bg-[var(--ps-row)] px-5 py-2 text-[13px]">
                              <span className="whitespace-nowrap font-semibold text-[var(--ps-ink-2)]">Priced by size</span>
                              <span className="num font-bold">{sizeRange}</span>
                            </div>
                          )}
                        </>
                      )}
                      <label className={switchRow}>
                        <span>Entered at the counter</span>
                        <Toggle checked={openPrice} onChange={setOpenPrice} label="Price entered at the counter" />
                      </label>
                    </div>
                    <Select label="Tax" value={tax} onChange={setTax} options={[{ value: '', label: 'No tax' }, ...liveTaxes.map((t) => ({ value: t.id, label: t.name }))]} />
                  </div>
                </Step>

                {/* 2. Sizes and the options offered with it */}
                <Step n={2} state={step2} title="Sizes and options" hint="Optional" delay={3}>
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                      <span className={groupLabel}>Sizes</span>
                      {variants.map((v, i) => (
                        <div key={i} className="flex flex-col gap-2 rounded-[18px] bg-[var(--ps-row)] p-3">
                          <div className="flex items-end gap-2">
                            <label className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className={miniLabel}>Size or variant</span>
                              <input value={v.name} maxLength={40} placeholder="Large" aria-label="Size name" onChange={(e) => setVariant(i, { name: e.target.value })} className={rowInput} />
                            </label>
                            <IconButton icon={Trash2} label={`Remove ${v.name || 'this size'}`} variant="light" size={44} className="hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-red-text)]" onClick={() => setVariants(variants.filter((_, k) => k !== i))} />
                          </div>
                          <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
                            <label className="flex min-w-0 flex-col gap-1">
                              <span className={miniLabel}>Price</span>
                              <input
                                value={v.price}
                                inputMode="decimal"
                                placeholder={exp === 0 ? '0' : '0.00'}
                                aria-label="Size price"
                                onChange={(e) => setVariant(i, { price: e.target.value })}
                                className={cn(rowInput, 'num px-3 text-right', v.price.trim() !== '' && parseMoney(v.price, exp) === null && invalid)}
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1">
                              <span className={miniLabel}>Cost</span>
                              <input
                                value={v.cost}
                                inputMode="decimal"
                                placeholder={exp === 0 ? '0' : '0.00'}
                                aria-label="Size cost"
                                onChange={(e) => setVariant(i, { cost: e.target.value })}
                                className={cn(rowInput, 'num px-3 text-right', v.cost.trim() !== '' && parseMoney(v.cost, exp) === null && invalid)}
                              />
                            </label>
                            <label className="col-span-2 flex min-w-0 flex-col gap-1 min-[380px]:col-span-1">
                              <span className={miniLabel}>SKU</span>
                              <input value={v.sku} maxLength={40} placeholder="Optional" aria-label="Size SKU" onChange={(e) => setVariant(i, { sku: e.target.value })} className={cn(rowInput, 'px-3')} />
                            </label>
                          </div>
                        </div>
                      ))}
                      <Button icon={Plus} className="self-start" onClick={() => setVariants([...variants, { id: '', name: '', price: variants.length === 0 ? price : '', sku: '', cost: '' }])}>
                        {variants.length === 0 ? 'Sizes or variants' : 'Another size'}
                      </Button>
                    </div>

                    {groups.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <h3 id={optionsLabel} className={groupLabel}>
                          Options offered
                        </h3>
                        <div role="group" aria-labelledby={optionsLabel} className="flex flex-wrap gap-2">
                          {groups.map((g) => {
                            const on = mods.includes(g.id);
                            return (
                              <button
                                key={g.id}
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                title={g.options.map((o) => o.name).join(', ')}
                                onClick={() => setMods(on ? mods.filter((m) => m !== g.id) : [...mods, g.id])}
                                className={cn(
                                  'ps-press inline-flex h-10 max-w-full items-center gap-2 rounded-full text-[13px] font-semibold',
                                  on ? 'ps-on-ink bg-[var(--ps-ink)] pl-1.5 pr-4 text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] px-4 hover:bg-[var(--ps-row-hover)]',
                                )}
                              >
                                {on && (
                                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
                                    <Check size={14} strokeWidth={2.6} />
                                  </span>
                                )}
                                <span className="truncate">{g.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </Step>

                {/* 3. Stock and details, then Save */}
                <Step n={3} state={step3} title="Stock and details" hint="Optional" delay={4}>
                  <div className="flex flex-1 flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="SKU" value={sku} onChange={setSku} maxLength={40} />
                      <MoneyField label="Cost (for profit)" value={cost} onChange={setCost} currency={currency} exp={exp} />
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className={groupLabel}>Barcodes</span>
                      {codes.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {codes.map((c) => (
                            <span key={c.code} className="flex h-10 max-w-full items-center gap-1 rounded-full bg-[var(--ps-row)] pl-4 pr-1">
                              <span className="mono truncate">{c.code}</span>
                              {c.variant !== '' && variants.length > 0 && <span className="shrink-0 text-[12px] text-[var(--ps-muted)]">· {variants.find((v) => v.id === c.variant)?.name ?? ''}</span>}
                              <button
                                type="button"
                                aria-label={`Remove ${c.code}`}
                                onClick={() => setCodes(codes.filter((x) => x.code !== c.code))}
                                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--ps-ink-2)] hover:bg-[var(--ps-row-hover)] hover:text-[var(--ps-red-text)]"
                              >
                                <X size={14} aria-hidden />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={codeDraft}
                          maxLength={64}
                          onChange={(e) => setCodeDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCode();
                            }
                          }}
                          placeholder="Scan or type a barcode"
                          aria-label="Barcode"
                          className={inputCls}
                        />
                        <Button icon={Plus} disabled={codeDraft.trim() === ''} onClick={addCode}>
                          Add
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className={switchRow}>
                        <span>Count its stock</span>
                        <Toggle checked={track} onChange={setTrack} label="Count its stock" />
                      </label>
                      {track && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <TextField label="Alert at or below" value={low} onChange={setLow} inputMode="numeric" maxLength={7} />
                          {id === null ? (
                            <TextField label="In stock now" value={opening} onChange={setOpening} inputMode="numeric" maxLength={7} />
                          ) : (
                            <Field label="In stock now">
                              <span className="num flex h-11 items-center px-1 text-[15px] font-bold">{loaded?.stock ?? 0}</span>
                            </Field>
                          )}
                        </div>
                      )}
                      <label className={switchRow}>
                        <span>For sale now (off: sold out)</span>
                        <Toggle checked={available} onChange={setAvailable} label="For sale now" />
                      </label>
                      <label className={switchRow}>
                        <span className="flex min-w-0 items-center gap-2">
                          <Star size={14} aria-hidden className="shrink-0" /> Favorite (on the Favorites page of the register)
                        </span>
                        <Toggle checked={favorite} onChange={setFavorite} label="Favorite" />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-3">
                      <div className="flex flex-col gap-2">
                        <span className={groupLabel}>Photo</span>
                        <label className="relative flex size-16 shrink-0 cursor-pointer rounded-full ring-[var(--ps-ink)] ring-offset-2 ring-offset-[var(--ps-card)] has-[:focus-visible]:ring-2">
                          <span className="flex size-16 items-center justify-center overflow-hidden rounded-full" style={{ background: tint.soft, color: tint.text }}>
                            {photoUrl !== '' ? <img src={photoUrl} alt="" className="size-full object-cover" /> : <Icon size={24} aria-hidden />}
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            aria-label="Product photo"
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              setPhoto(f);
                              setClearPhoto(false);
                            }}
                          />
                          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-[var(--ps-solid)] text-[var(--ps-on-solid)] ring-2 ring-[var(--ps-card)]">
                            <ImagePlus size={13} />
                          </span>
                        </label>
                      </div>
                      <div className="flex min-w-[200px] flex-1 flex-col gap-2">
                        <span className={groupLabel}>Tile color</span>
                        <div className="flex min-h-16 items-center">
                          <div className="min-w-0 flex-1">
                            <ColorPicker value={color} onChange={setColor} allowNone noneLabel={cat !== undefined ? `The ${cat.name} color` : 'No color'} />
                          </div>
                        </div>
                      </div>
                      {(photoUrl !== '' || photo !== null) && (
                        <div className="basis-full">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setPhoto(null);
                              setClearPhoto(true);
                            }}
                          >
                            Remove the photo
                          </Button>
                        </div>
                      )}
                    </div>

                    <Field label="Description">
                      <textarea value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} className={textareaCls} />
                    </Field>

                    <div className="mt-auto flex gap-2 pt-2">
                      {loaded !== null && (
                        <Button size="lg" variant={loaded.archived ? 'secondary' : 'danger'} icon={loaded.archived ? ArchiveRestore : Archive} onClick={() => void archive()} className="sm:hidden">
                          {loaded.archived ? 'Restore' : 'Archive'}
                        </Button>
                      )}
                      <Button variant="primary" size="lg" icon={id === null ? Plus : Check} dot loading={busy} onClick={() => void save()} className="min-w-0 flex-1">
                        {id === null ? 'Add product' : 'Save'}
                      </Button>
                    </div>
                  </div>
                </Step>
              </div>
            )}
            {confirmEl}
          </div>
        );
      }}
    </RevealScreen>
  );
}

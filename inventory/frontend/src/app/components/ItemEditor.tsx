/**
 * New item / edit item: a full screen that grows from the button that opened
 * it, like the stock change screen. Three numbered steps: what it is (photo,
 * name, category, unit), its codes and where it is kept (SKU, barcodes,
 * opening stock), then reordering and buying. Only the name is required.
 * Scanning a barcode adds it to the item.
 *
 * useItemEditor().create(origin, { barcode?, name?, onSaved? })
 * useItemEditor().edit(origin, item, { onSaved? })
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Check, FileUp, ImagePlus, Plus, ScanBarcode, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { normalizeNumber, plain, symbolOf } from '../lib/format.ts';
import { iconOf } from '../lib/icons.tsx';
import { navigate } from '../lib/router.ts';
import { useScanner } from '../lib/scanner.ts';
import type { ItemDetail } from '../lib/types.ts';
import { Stepper } from './controls.tsx';
import { LocationSelect } from './pickers.tsx';
import { Step, reveal } from './StockChange.tsx';
import { CircleButton, Field, PillButton, PillSelect, Toggle, errMessage, softInput, useConfirm } from './ui.tsx';

type Origin = { x: number; y: number };

export interface EditorPreset {
  barcode?: string;
  name?: string;
  onSaved?: (item: ItemDetail) => void;
}

interface EditorApi {
  create: (from: Element | null, preset?: EditorPreset) => void;
  edit: (from: Element | null, item: ItemDetail, preset?: EditorPreset) => void;
}

const Ctx = createContext<EditorApi | null>(null);

export function useItemEditor(): EditorApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useItemEditor outside ItemEditorProvider');
  return v;
}

function originOf(el: Element | null): Origin {
  if (el === null) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function ItemEditorProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<{ item: ItemDetail | null; preset: EditorPreset; origin: Origin; n: number } | null>(null);
  const counter = useRef(0);
  const value = useMemo<EditorApi>(
    () => ({
      create: (from, preset) => setState({ item: null, preset: preset ?? {}, origin: originOf(from), n: ++counter.current }),
      edit: (from, item, preset) => setState({ item, preset: preset ?? {}, origin: originOf(from), n: ++counter.current }),
    }),
    [],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {state !== null && <EditorScreen key={state.n} item={state.item} preset={state.preset} origin={state.origin} onClosed={() => setState(null)} />}
    </Ctx.Provider>
  );
}

const UNITS = ['pcs', 'box', 'pack', 'roll', 'pair', 'set', 'kg', 'g', 'm', 'L'];
const PART_UNITS = new Set(['kg', 'g', 'm', 'L']);

function EditorScreen({ item, preset, origin, onClosed }: { item: ItemDetail | null; preset: EditorPreset; origin: Origin; onClosed: () => void }): React.JSX.Element {
  const { categories, suppliers, currency, locations } = useApp();
  const root = useRef<HTMLDivElement | null>(null);
  const closing = useRef(false);
  const editing = item !== null;
  const [name, setName] = useState(item?.name ?? preset.name ?? '');
  const [category, setCategory] = useState(item?.category?.id ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [fractional, setFractional] = useState(item?.fractional ?? false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(item?.photo_large ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [sku, setSku] = useState(item?.sku ?? '');
  const [codes, setCodes] = useState<string[]>(preset.barcode !== undefined ? [preset.barcode] : []);
  const [existing, setExisting] = useState(item?.codes ?? []);
  const [codeText, setCodeText] = useState('');
  const [startQty, setStartQty] = useState('0');
  const [location, setLocation] = useState(item?.default_location?.id ?? locations.find((l) => l.depth === 0)?.id ?? '');
  const [minQty, setMinQty] = useState(item !== null ? plain(item.min_qty) : '0');
  const [maxQty, setMaxQty] = useState(item !== null ? plain(item.max_qty) : '0');
  const [supplier, setSupplier] = useState(item?.supplier?.id ?? '');
  const [cost, setCost] = useState(item !== null && item.unit_cost_e4 > 0 ? item.unit_cost : '');
  const [lead, setLead] = useState(item !== null && item.item_lead_time_days > 0 ? String(item.item_lead_time_days) : '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (root.current !== null) reveal(root.current, origin, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [origin]);

  useEffect(() => {
    if (photo === null) return;
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const anim = root.current !== null ? reveal(root.current, origin, false) : null;
    if (anim === null) onClosed();
    else anim.onfinish = () => onClosed();
  }, [origin, onClosed]);

  const addCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (code === '') return;
      if (codes.includes(code) || existing.some((c) => c.code === code)) {
        toast.info('That barcode is already on this item');
        return;
      }
      try {
        const hit = await api.lookup(code);
        if (hit.type === 'location') {
          setError(`"${code}" is the code of the location "${hit.location.path}"`);
          return;
        }
        if (hit.type === 'item' && hit.item.id !== item?.id) {
          setError(`"${code}" already belongs to the item "${hit.item.name}"`);
          return;
        }
      } catch {
        return;
      }
      setError(null);
      setCodes((c) => [...c, code]);
      setCodeText('');
    },
    [codes, existing, item],
  );

  useScanner((code) => void addCode(code));

  const removeExisting = async (code: string): Promise<void> => {
    if (item === null) return;
    try {
      await api.removeBarcode(item.id, code);
      setExisting((list) => list.filter((c) => c.code !== code));
      toast.success('Barcode removed');
    } catch {
      /* toasted */
    }
  };

  const save = useCallback(async () => {
    if (name.trim() === '') {
      setError('Give the item a name');
      nameRef.current?.focus();
      return;
    }
    const nums = { min: normalizeNumber(minQty, fractional ? 3 : 0), max: normalizeNumber(maxQty, fractional ? 3 : 0), start: normalizeNumber(startQty, fractional ? 3 : 0) };
    if (nums.min === null || nums.max === null || (!editing && nums.start === null)) {
      setError(fractional ? 'Quantities must be numbers' : 'Quantities must be whole numbers for this item');
      return;
    }
    if (Number(nums.max) > 0 && Number(nums.max) < Number(nums.min)) {
      setError('The target level must be at least the reorder point');
      return;
    }
    const c = cost.trim() === '' ? '' : normalizeNumber(cost, 4);
    if (c === null) {
      setError('Enter the cost like 2.35');
      return;
    }
    if (lead.trim() !== '' && !/^\d{1,3}$/.test(lead.trim())) {
      setError('Lead time is a number of days');
      return;
    }
    const startN = Number(nums.start ?? '0');
    if (!editing && startN > 0 && location === '') {
      setError('Choose where the starting stock is');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        sku: sku.trim(),
        category,
        unit: unit.trim() === '' ? 'pcs' : unit.trim(),
        fractional,
        description: description.trim(),
        min_qty: nums.min,
        max_qty: nums.max,
        unit_cost: c === '' ? '0' : c,
        supplier,
        lead_time_days: lead.trim() === '' ? '0' : lead.trim(),
        default_location: location,
        barcodes: codes,
        ...(editing ? (removePhoto && photo === null ? { remove_photo: true } : {}) : startN > 0 ? { qty: nums.start ?? '0', location } : {}),
      };
      const r = editing ? await api.updateItem(item.id, input, photo) : await api.addItem(input, photo);
      toast.success(editing ? 'Saved' : `Added ${r.item.name}`);
      close();
      if (preset.onSaved !== undefined) preset.onSaved(r.item);
      else if (!editing) navigate('item', { id: r.item.id });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }, [name, minQty, maxQty, startQty, fractional, editing, cost, lead, location, sku, category, unit, description, supplier, codes, removePhoto, photo, item, close, preset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const archive = async (): Promise<void> => {
    if (item === null) return;
    try {
      await api.setArchived([item.id], !item.archived);
      toast.success(item.archived ? 'Restored' : 'Archived. It no longer shows in lists or reorders.');
      close();
    } catch {
      /* toasted */
    }
  };

  const remove = async (): Promise<void> => {
    if (item === null) return;
    try {
      const p = await api.deleteItem(item.id, true);
      const parts = [
        p.on_hand !== 0 ? `${plain(p.on_hand)} ${item.unit} in stock` : null,
        p.history_entries > 0 ? `${p.history_entries} history entries` : null,
        p.order_lines > 0 ? `${p.order_lines} purchase order lines` : null,
      ].filter((x) => x !== null);
      const ok = await confirm(
        `"${item.name}" is deleted${parts.length > 0 ? ` with its ${parts.join(', ')}` : ''}. This cannot be undone; archiving keeps the history instead.`,
        'Delete this item?',
      );
      if (!ok) return;
      await api.deleteItem(item.id);
      toast.success('Deleted');
      close();
      navigate('items');
    } catch {
      /* toasted */
    }
  };

  const filled = (s: 1 | 2 | 3): 'todo' | 'current' | 'done' => {
    if (s === 1) return name.trim() !== '' ? 'done' : 'current';
    if (s === 2) return name.trim() === '' ? 'todo' : sku !== '' || codes.length > 0 || Number(startQty) > 0 ? 'done' : 'current';
    return name.trim() === '' ? 'todo' : 'current';
  };
  const chip = (on: boolean): string =>
    cn('inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors', on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]');
  const title = editing ? 'Edit item' : 'New item';

  return (
    <div ref={root} className="fixed inset-0 z-50 overflow-y-auto bg-[var(--iv-shell)] text-[var(--iv-ink)]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
        <header className="iv-rise iv-d1 mx-auto mb-6 flex max-w-[560px] flex-wrap items-center gap-4 min-[1100px]:max-w-none">
          <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={close} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
            <p className="text-[13px] text-[var(--iv-muted)]">Start with the name. Everything else is optional and can change later.</p>
          </div>
          {editing && (
            <div className="flex gap-2">
              <PillButton variant="light" icon={item.archived ? ArchiveRestore : Archive} onClick={() => void archive()}>
                {item.archived ? 'Restore' : 'Archive'}
              </PillButton>
              <PillButton variant="danger" icon={Trash2} onClick={() => void remove()}>
                Delete
              </PillButton>
            </div>
          )}
        </header>

        <div className="mx-auto grid max-w-[560px] gap-4 min-[1100px]:max-w-none min-[1100px]:grid-cols-3 min-[1100px]:gap-5">
          {/* 1. What it is */}
          <Step n={1} state={filled(1)} title="What it is" hint="Name required" delay={2}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label={photoUrl !== null ? 'Change photo' : 'Add a photo'}
                  className="iv-on-sand relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[22px] bg-[var(--iv-sand)] transition-transform active:scale-[0.97]"
                >
                  {photoUrl !== null && !removePhoto ? (
                    <img src={photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-[var(--iv-ink-2)]">
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
                    maxLength={120}
                    placeholder="Name, e.g. Packing tape 48mm"
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
                      className="self-start rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--iv-muted)] hover:bg-[var(--iv-row)] hover:text-[var(--iv-ink)]"
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
              <Field label="Category">
                <div className="grid max-h-[284px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:max-[1099px]:grid-cols-4">
                  {categories.map((c) => {
                    const Icon = iconOf(c.icon);
                    const on = c.id === category;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCategory(on ? '' : c.id)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-[18px] px-2 py-2.5 transition-[background,transform] active:scale-[0.97]',
                          on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
                        )}
                      >
                        <span className={cn('flex size-9 items-center justify-center rounded-full', on ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]' : 'bg-[var(--iv-card)]')}>
                          <Icon size={16} strokeWidth={1.9} aria-hidden />
                        </span>
                        <span className="w-full truncate text-center text-[12px] font-semibold">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
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
                      className={cn(chip(unit === u), 'h-9 px-3.5')}
                    >
                      {u}
                    </button>
                  ))}
                  <input
                    value={UNITS.includes(unit) ? '' : unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={16}
                    placeholder="Other"
                    aria-label="Other unit"
                    className="h-9 w-24 rounded-full bg-[var(--iv-row)] px-3.5 text-[13px] font-semibold outline-none ring-[var(--iv-ink)] focus-visible:ring-2"
                  />
                </div>
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
                <span>
                  <span className="block text-[13px] font-semibold">Counted in part units</span>
                  <span className="block text-[12px] text-[var(--iv-muted)]">For kg, metres, litres: quantities like 2.5</span>
                </span>
                <Toggle checked={fractional} onChange={setFractional} label="Counted in part units" />
              </div>
            </div>
          </Step>

          {/* 2. Codes and stock */}
          <Step n={2} state={filled(2)} title="Codes and place" hint="Optional" delay={3}>
            <div className="flex flex-col gap-4">
              <Field label="SKU" hint={editing ? 'Its own code in this app; printed on its label.' : 'Leave empty to number it automatically.'}>
                <input value={sku} onChange={(e) => setSku(e.target.value.replace(/\s/g, ''))} maxLength={40} placeholder="Automatic, e.g. SKU-0012" aria-label="SKU" className={cn(softInput, 'num')} />
              </Field>
              <Field label="Barcodes" hint="Scan the product's barcode, or type it and press Enter.">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    {existing.map((c) => (
                      <span key={c.id} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--iv-row)] pl-3.5 pr-1 text-[13px] font-semibold">
                        <ScanBarcode size={14} aria-hidden />
                        <span className="num">{c.code}</span>
                        <button type="button" onClick={() => void removeExisting(c.code)} aria-label={`Remove barcode ${c.code}`} className="flex size-7 items-center justify-center rounded-full hover:bg-[var(--iv-row-hover)]">
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                    {codes.map((c) => (
                      <span key={c} className="iv-pop inline-flex h-9 items-center gap-2 rounded-full bg-[var(--iv-accent)] pl-3.5 pr-1 text-[13px] font-semibold text-[var(--iv-on-accent)]">
                        <ScanBarcode size={14} aria-hidden />
                        <span className="num">{c}</span>
                        <button type="button" onClick={() => setCodes((x) => x.filter((y) => y !== c))} aria-label={`Remove barcode ${c}`} className="flex size-7 items-center justify-center rounded-full hover:bg-black/10">
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={codeText}
                      onChange={(e) => setCodeText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          void addCode(codeText);
                        }
                      }}
                      maxLength={128}
                      placeholder="Scan or type a barcode"
                      aria-label="Barcode"
                      className={cn(softInput, 'num')}
                    />
                    <CircleButton icon={Plus} label="Add barcode" variant="row" size={44} onClick={() => void addCode(codeText)} disabled={codeText.trim() === ''} />
                  </div>
                </div>
              </Field>
              {!editing && (
                <Field label="Starting stock">
                  <div className="flex flex-col gap-2">
                    <Stepper value={startQty} onChange={setStartQty} fractional={fractional} ariaLabel="starting quantity" className="self-start" />
                    <LocationSelect value={location} onChange={setLocation} soft ariaLabel="Where the starting stock is" />
                  </div>
                </Field>
              )}
              {editing && (
                <Field label="Home location" hint="Where it usually lives; stock coming in goes here by default.">
                  <LocationSelect value={location} onChange={setLocation} soft allowNone noneLabel="No home location" ariaLabel="Home location" />
                </Field>
              )}
            </div>
          </Step>

          {/* 3. Reorder and buying, then Save */}
          <Step n={3} state={filled(3)} title="Reorder and buying" hint="Optional" delay={4}>
            <div className="flex flex-1 flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Reorder point" hint="Low at or below this">
                  <Stepper value={minQty} onChange={setMinQty} fractional={fractional} ariaLabel="reorder point" />
                </Field>
                <Field label="Target level" hint="Reorders fill up to this">
                  <Stepper value={maxQty} onChange={setMaxQty} fractional={fractional} ariaLabel="target level" />
                </Field>
              </div>
              <PillSelect
                soft
                label="Usual supplier"
                value={supplier}
                onChange={setSupplier}
                options={[{ value: '', label: 'No supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost per unit">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[var(--iv-muted)]">{symbolOf(currency)}</span>
                    <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Cost per unit" className={cn(softInput, 'num pl-9')} />
                  </div>
                </Field>
                <Field label="Lead time">
                  <div className="relative">
                    <input value={lead} onChange={(e) => setLead(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="Supplier's" aria-label="Lead time in days" className={cn(softInput, 'num pr-14')} />
                    <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[13px] text-[var(--iv-muted)]">days</span>
                  </div>
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Size, colour, where to buy it..."
                  aria-label="Description"
                  className="w-full resize-none rounded-[20px] bg-[var(--iv-row)] px-5 py-3 text-[14px] outline-none ring-[var(--iv-ink)] focus-visible:ring-2"
                />
              </Field>
              {error !== null && <p className="iv-shake rounded-[16px] bg-[var(--iv-red)]/12 px-4 py-2.5 text-[13px] font-semibold text-[var(--iv-red-text)]">{error}</p>}
              <div className="mt-auto pt-2">
                <PillButton variant="dark" icon={editing ? Check : Plus} dot loading={busy} disabled={name.trim() === ''} onClick={() => void save()} className="h-14 w-full text-[15px]">
                  {editing ? 'Save changes' : 'Add item'}
                </PillButton>
              </div>
            </div>
          </Step>
        </div>
        {!editing && (
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-[12px] text-[var(--iv-muted)]">
            <FileUp size={14} aria-hidden /> Have a spreadsheet of items? Import it on the Import and export page.
          </p>
        )}
      </div>
      {confirmEl}
    </div>
  );
}

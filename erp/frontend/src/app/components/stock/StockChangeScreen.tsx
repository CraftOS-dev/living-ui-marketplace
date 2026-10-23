/**
 * The stock change screen: a full screen that grows from the button that
 * opened it. What happened (stock in, stock out, a count, a transfer), where,
 * why, and the items with their quantities; a count shows the difference to
 * what the books say. The value it posts is previewed as you type, then Save
 * posts it as one numbered change with its journal entry.
 *
 *   const change = useStockChange();
 *   <button onClick={(e) => change.open(e.currentTarget, { item: id, mode: 'out' })} />
 *   {change.node}
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowRight, Check, ClipboardCheck, Minus, MoveRight, Plus, ScanBarcode, SlidersHorizontal, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { errMessage, op } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { money, normalizeNumber, plain, plural, qty, signed } from '../../lib/format.ts';
import type { ChangeReason, ItemDetail, ItemList, StockChangeDetail, WarehouseList } from '../../lib/types/stock.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import { BooksDetail } from '../Books.tsx';
import { Segmented, Stepper, useDebounced } from '../controls.tsx';
import { useFullScreen, ScreenBar } from '../FullScreen.tsx';
import { AccountPicker, DateField, MoneyInput } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Card, CircleButton, Field, Notice, PillButton, Skeleton, softInput } from '../ui.tsx';
import { ItemThumb } from './icons.tsx';

export type ChangeMode = 'in' | 'out' | 'count' | 'transfer';

export interface ChangePreset {
  item?: string | undefined;
  mode?: ChangeMode | undefined;
  warehouse?: string | undefined;
  to?: string | undefined;
}

export interface StockChangeControl {
  open: (from: Element | null, preset?: ChangePreset) => void;
  node: React.ReactNode;
  isOpen: boolean;
}

/** The screen and the way to open it. Render `node` once in the page. */
export function useStockChange(opts: { onClosed?: (() => void) | undefined; onSaved?: ((c: StockChangeDetail) => void) | undefined } = {}): StockChangeControl {
  const [state, setState] = useState<{ preset: ChangePreset; n: number }>({ preset: {}, n: 0 });
  const fs = useFullScreen(opts.onClosed);
  const savedRef = useRef(opts.onSaved);
  savedRef.current = opts.onSaved;
  const open = useCallback(
    (from: Element | null, preset?: ChangePreset) => {
      setState((s) => ({ preset: preset ?? {}, n: s.n + 1 }));
      fs.open(from);
    },
    [fs],
  );
  const node = fs.node(
    <ChangeScreen
      key={state.n}
      preset={state.preset}
      onClose={fs.close}
      onSaved={(c) => {
        savedRef.current?.(c);
        fs.close();
      }}
    />,
    { title: 'Stock change' },
  );
  return { open, node, isOpen: fs.isOpen };
}

const MODES: { value: ChangeMode; label: string; icon: LucideIcon }[] = [
  { value: 'in', label: 'Stock in', icon: Plus },
  { value: 'out', label: 'Stock out', icon: Minus },
  { value: 'count', label: 'Count', icon: ClipboardCheck },
  { value: 'transfer', label: 'Transfer', icon: MoveRight },
];

const REASONS: Record<ChangeMode, { value: ChangeReason; label: string }[]> = {
  in: [
    { value: 'found', label: 'Found' },
    { value: 'correction', label: 'Correction' },
    { value: 'opening', label: 'Opening stock' },
    { value: 'other', label: 'Other' },
  ],
  out: [
    { value: 'damage', label: 'Damaged' },
    { value: 'loss', label: 'Lost or stolen' },
    { value: 'expiry', label: 'Expired' },
    { value: 'sample', label: 'Sample or gift' },
    { value: 'correction', label: 'Correction' },
    { value: 'other', label: 'Other' },
  ],
  count: [],
  transfer: [],
};

interface Line {
  key: string;
  item: ItemDetail;
  qty: string;
  cost: string;
}

interface PreviewOut {
  amount: number;
  currency: string;
  lines: JournalPreviewLine[];
  title: string;
}

function hereOf(item: ItemDetail, warehouse: string): number {
  return item.stock.find((s) => s.id === warehouse)?.qty ?? 0;
}

/** The warehouse that holds most of an item (where stock goes out from). */
function fullest(item: ItemDetail): string {
  let best = '';
  let top = 0;
  for (const s of item.stock) {
    if (s.qty > top) {
      top = s.qty;
      best = s.id;
    }
  }
  return best;
}

let lineSeq = 0;

function ChangeScreen({ preset, onClose, onSaved }: { preset: ChangePreset; onClose: () => void; onSaved: (c: StockChangeDetail) => void }): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const seeBooks = can(me, 'accounting', 'view');
  const [mode, setMode] = useState<ChangeMode>(preset.mode ?? 'in');
  const [whs, setWhs] = useState<WarehouseList['warehouses'] | null>(null);
  const [defaultWh, setDefaultWh] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [warehouse, setWarehouse] = useState(preset.warehouse ?? '');
  const [to, setTo] = useState(preset.to ?? '');
  const [reason, setReason] = useState<ChangeReason>(REASONS[preset.mode ?? 'in'][0]?.value ?? 'correction');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState<Option | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingItem, setLoadingItem] = useState(preset.item !== undefined);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Warehouses and the company's default one.
  useEffect(() => {
    let live = true;
    void Promise.all([
      op<WarehouseList>('warehouses.list', {}, { quiet: true }),
      op<{ defaults?: { warehouse?: string | undefined } | undefined; allow_negative_stock?: boolean | undefined }>('settings.get', {}, { quiet: true }).catch(() => ({ defaults: undefined, allow_negative_stock: false })),
    ])
      .then(([w, s]) => {
        if (!live) return;
        const active = w.warehouses.filter((x) => !x.archived);
        setWhs(active);
        const def = s.defaults?.warehouse ?? '';
        const d = active.some((x) => x.id === def) ? def : (active[0]?.id ?? '');
        setDefaultWh(d);
        setAllowNegative(s.allow_negative_stock === true);
        setWarehouse((cur) => (cur !== '' ? cur : d));
      })
      .catch((e: unknown) => {
        if (live) setError(errMessage(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const startQty = useCallback((item: ItemDetail, m: ChangeMode, wh: string): string => (m === 'count' ? plain(hereOf(item, wh)) : '1'), []);

  const addItem = useCallback(
    async (id: string, focusSearch = true) => {
      setError(null);
      const existing = lines.find((l) => l.item.id === id);
      if (existing !== undefined) {
        if (mode !== 'count') setLines((ls) => ls.map((l) => (l.key === existing.key ? { ...l, qty: plain((Number(l.qty) || 0) + 1) } : l)));
        return;
      }
      setLoadingItem(true);
      try {
        const it = await op<ItemDetail>('items.get', { item: id }, { quiet: true });
        if (it.kind !== 'stock') {
          setError(`${it.name} is not counted in stock.`);
          return;
        }
        let wh = warehouse;
        // Stock going out (or moving) starts where the item is.
        if (lines.length === 0 && preset.warehouse === undefined && (mode === 'out' || mode === 'transfer')) {
          const f = fullest(it);
          if (f !== '') {
            wh = f;
            setWarehouse(f);
          }
        }
        setLines((ls) => [...ls, { key: `l${++lineSeq}`, item: it, qty: startQty(it, mode, wh !== '' ? wh : defaultWh), cost: '' }]);
        if (focusSearch) setTimeout(() => searchRef.current?.focus(), 0);
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setLoadingItem(false);
      }
    },
    [lines, mode, warehouse, preset.warehouse, startQty, defaultWh],
  );

  // The preset item, once the warehouses are known.
  const presetDone = useRef(false);
  useEffect(() => {
    if (presetDone.current || preset.item === undefined || whs === null) return;
    presetDone.current = true;
    void addItem(preset.item, false);
  }, [preset.item, whs, addItem]);

  const switchMode = (m: ChangeMode): void => {
    setMode(m);
    setError(null);
    setReason(REASONS[m][0]?.value ?? (m === 'count' ? 'count' : 'correction'));
    setLines((ls) => ls.map((l) => ({ ...l, qty: startQty(l.item, m, warehouse) })));
    if (m === 'transfer' && to === warehouse) setTo('');
  };

  const switchWarehouse = (w: string): void => {
    setWarehouse(w);
    if (to === w) setTo('');
    if (mode === 'count') setLines((ls) => ls.map((l) => ({ ...l, qty: plain(hereOf(l.item, w)) })));
  };

  /* --------------------------------------------------------- validity */

  const parsed = lines.map((l) => {
    const n = normalizeNumber(l.qty, l.item.fractional ? 3 : 0);
    const v = n === null ? NaN : Number(n);
    const here = hereOf(l.item, warehouse);
    const diff = mode === 'count' ? v - here : mode === 'in' ? v : -v;
    const ok = Number.isFinite(v) && (mode === 'count' ? v >= 0 : v > 0);
    const short = (mode === 'out' || mode === 'transfer') && ok && v > here && !allowNegative;
    return { l, v, here, diff: Number.isFinite(diff) ? Math.round(diff * 1000) / 1000 : 0, ok, short };
  });
  const changing = parsed.filter((p) => p.ok && (mode !== 'count' || p.diff !== 0));
  const badLine = parsed.find((p) => !p.ok || p.short);
  const needTo = mode === 'transfer';
  const ready = whs !== null && warehouse !== '' && lines.length > 0 && badLine === undefined && changing.length > 0 && (!needTo || (to !== '' && to !== warehouse));

  const params = useMemo(() => {
    const ls = parsed
      .filter((p) => p.ok)
      .map((p) => {
        const id = p.l.item.id;
        if (mode === 'count') return { item: id, counted: p.v };
        if (mode === 'transfer') return { item: id, qty: p.v };
        const c = mode === 'in' && p.l.cost.trim() !== '' ? normalizeNumber(p.l.cost, 4) : null;
        return { item: id, qty: mode === 'out' ? -p.v : p.v, ...(c !== null ? { unit_cost: c } : {}) };
      });
    return {
      kind: mode === 'count' ? 'count' : mode === 'transfer' ? 'transfer' : 'adjust',
      warehouse,
      to_warehouse: mode === 'transfer' ? to : undefined,
      reason: mode === 'count' ? 'count' : mode === 'transfer' ? undefined : reason,
      account: account?.id,
      date,
      note: note.trim() === '' ? undefined : note.trim(),
      lines: ls,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parsed.map((p) => [p.l.item.id, p.v, p.l.cost])), mode, warehouse, to, reason, account, date, note]);

  /* ---------------------------------------------------------- preview */

  const [preview, setPreview] = useState<PreviewOut | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewKey = useDebounced(ready ? JSON.stringify(params) : '', 350);
  useEffect(() => {
    if (previewKey === '') {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let live = true;
    op<PreviewOut>('stock.preview-change', JSON.parse(previewKey) as Record<string, string>, { quiet: true })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setPreviewError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setPreview(null);
        setPreviewError(errMessage(e));
      });
    return () => {
      live = false;
    };
  }, [previewKey]);

  const save = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await op<StockChangeDetail>('stock.change', params, { quiet: true });
      toast.success(`${r.number} saved`);
      onSaved(r);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const whName = (id: string): string => whs?.find((w) => w.id === id)?.name ?? '';
  const units = changing.reduce((s, p) => s + Math.abs(p.diff), 0);
  const cur = preview?.currency ?? base;
  const verb = mode === 'in' ? 'Add' : mode === 'out' ? 'Remove' : mode === 'count' ? 'Save count' : 'Transfer';
  const saveLabel = mode === 'count' ? (changing.length > 0 ? `Save count (${plural(changing.length, 'change')})` : 'Save count') : lines.length === 1 && ready && parsed[0] !== undefined ? `${verb} ${qty(parsed[0].v)} ${parsed[0].l.item.unit}` : lines.length > 1 ? `${verb} ${plural(lines.length, 'item')}` : verb;

  return (
    <div className="pb-28 md:pb-12">
      <ScreenBar
        title="Stock change"
        sub={warehouse !== '' ? (mode === 'transfer' ? `${whName(warehouse)} to ${to !== '' ? whName(to) : 'another warehouse'}` : whName(warehouse)) : undefined}
        onClose={onClose}
      />
      <div className="mx-auto max-w-[1180px] px-4 @min-[640px]:px-8">
        <Segmented ariaLabel="What happened" value={mode} onChange={switchMode} options={MODES} className="erp-rise mb-5 w-full @min-[640px]:w-[600px]" onShell />

        <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
          <div className="flex flex-col gap-5 @min-[900px]:col-span-7">
            {/* Where and why */}
            <Card delay={1}>
              <div className="flex flex-col gap-4">
                <Field label={mode === 'transfer' ? 'From' : mode === 'in' ? 'Into' : 'Warehouse'}>
                  {whs === null ? <Skeleton className="h-10 w-2/3" rounded="rounded-full" /> : <WarehouseChips list={whs} value={warehouse} onChange={switchWarehouse} />}
                </Field>
                {mode === 'transfer' && whs !== null && (
                  <Field label="To">
                    <WarehouseChips list={whs.filter((w) => w.id !== warehouse)} value={to} onChange={setTo} lead={ArrowRight} />
                  </Field>
                )}
                {REASONS[mode].length > 0 && (
                  <Field label="Why">
                    <div className="flex flex-wrap gap-2">
                      {REASONS[mode].map((r) => (
                        <button key={r.value} type="button" aria-pressed={reason === r.value} onClick={() => setReason(r.value)} className={chip(reason === r.value)}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </Card>

            {/* Items */}
            <Card delay={2}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-bold">{mode === 'count' ? 'What you counted' : 'Items'}</h2>
                {lines.length > 0 && <span className="num text-[13px] font-semibold text-[var(--erp-muted)]">{plural(lines.length, 'item')}</span>}
              </div>
              <ItemSearch inputRef={searchRef} warehouse={mode === 'in' ? '' : warehouse} onPick={(id) => void addItem(id)} autoFocus={preset.item === undefined} exclude={lines.map((l) => l.item.id)} />
              <ul className="mt-3 flex flex-col gap-2">
                {loadingItem && lines.length === 0 && <Skeleton className="h-20" />}
                {parsed.map((p) => (
                  <li key={p.l.key} className={cn('erp-pop rounded-[20px] p-3', p.short || (!p.ok && p.l.qty !== '') ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
                    <div className="flex items-center gap-3">
                      <ItemThumb photo={p.l.item.photo} icon={p.l.item.category?.icon} size={44} tone="card" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold">{p.l.item.name}</p>
                        <p className="num truncate text-[12px] text-[var(--erp-muted)]">
                          {p.l.item.sku} · {qty(p.here)} {p.l.item.unit} {mode === 'count' ? 'in the books' : 'here'}
                        </p>
                      </div>
                      <CircleButton icon={Trash2} label={`Remove ${p.l.item.name}`} variant="ghost" size={36} onClick={() => setLines((ls) => ls.filter((x) => x.key !== p.l.key))} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <Stepper
                        value={p.l.qty}
                        onChange={(v) => setLines((ls) => ls.map((x) => (x.key === p.l.key ? { ...x, qty: v } : x)))}
                        fractional={p.l.item.fractional}
                        min={0}
                        ariaLabel={`${mode === 'count' ? 'Counted' : 'Quantity of'} ${p.l.item.name}`}
                        className="bg-[var(--erp-card)]"
                      />
                      <LineOutcome mode={mode} here={p.here} diff={p.diff} ok={p.ok} short={p.short} unit={p.l.item.unit} />
                    </div>
                    {mode === 'in' && more && (
                      <div className="mt-3">
                        <Field label="Cost per unit" hint={`Average now ${p.l.item.avg_cost}. Leave empty to use it.`}>
                          <MoneyInput value={p.l.cost} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === p.l.key ? { ...x, cost: v } : x)))} currency={base} decimals={4} ariaLabel={`Cost per unit of ${p.l.item.name}`} placeholder={p.l.item.avg_cost} className="[&_input]:bg-[var(--erp-card)]" />
                        </Field>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            {/* Note and more */}
            <Card delay={3}>
              <div className="flex flex-col gap-4">
                <Field label="Note" optional>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For the team, e.g. pallet 4 water damage" aria-label="Note" className={softInput} />
                </Field>
                <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-2 self-start text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                  <SlidersHorizontal size={14} aria-hidden />
                  {more ? 'Fewer options' : 'More options'}
                </button>
                {more && (
                  <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
                    <Field label="Date in the books">
                      <DateField value={date} onChange={setDate} ariaLabel="Date in the books" max={today()} />
                    </Field>
                    {mode !== 'transfer' && mode !== 'count' && (
                      <Field label="Offset account" hint={reason === 'opening' ? 'Opening balance equity by default' : 'Stock adjustments by default'}>
                        <AccountPicker value={account} onChange={setAccount} postable clearable placeholder="The usual account" />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Summary and save */}
          <div className="@min-[900px]:sticky @min-[900px]:top-24 @min-[900px]:col-span-5">
            <Card tone="dark" delay={2}>
              <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{mode === 'count' ? 'Differences found' : mode === 'transfer' ? 'Moving' : mode === 'in' ? 'Coming in' : 'Going out'}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{mode === 'count' ? changing.length : qty(Math.round(units * 1000) / 1000)}</span>
                <span className="text-[14px] font-semibold text-[var(--erp-on-dark-muted)]">{mode === 'count' ? (changing.length === 1 ? 'item' : 'items') : lines.length === 1 ? (lines[0]?.item.unit ?? 'units') : 'units'}</span>
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{mode === 'transfer' ? 'Stock value' : mode === 'count' ? 'Value moved' : 'Value change'}</span>
                  {mode === 'transfer' ? (
                    <span className="block truncate text-[15px] font-bold">Unchanged</span>
                  ) : changing.length === 0 || !ready ? (
                    <span className="block truncate text-[15px] font-bold text-[var(--erp-on-dark-muted)]">None yet</span>
                  ) : preview === null ? (
                    <Skeleton className="mt-1 h-5 w-20 bg-[var(--erp-dark)]" rounded="rounded-full" />
                  ) : (
                    <span className="num block truncate text-[15px] font-bold">{mode === 'count' ? money(preview.amount, cur) : money(preview.amount * (mode === 'out' ? -1 : 1), cur)}</span>
                  )}
                </div>
                <div className="rounded-[18px] bg-[var(--erp-dark-2)] p-3">
                  <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{mode === 'transfer' ? 'Route' : 'Warehouse'}</span>
                  <span className="block truncate text-[15px] font-bold">{mode === 'transfer' ? `${whCode(whs, warehouse)} to ${to !== '' ? whCode(whs, to) : '...'}` : whName(warehouse) || '...'}</span>
                </div>
              </div>
            </Card>
            <div className="mt-4 flex flex-col gap-3">
              {previewError !== null && (
                <Notice tone="bad" icon={AlertTriangle}>
                  {previewError}
                </Notice>
              )}
              {error !== null && (
                <Notice tone="bad" icon={AlertTriangle}>
                  {error}
                </Notice>
              )}
              {seeBooks && preview !== null && preview.lines.length > 0 && (
                <div className="rounded-[24px] bg-[var(--erp-card)] p-4">
                  <BooksDetail lines={preview.lines} currency={cur} />
                </div>
              )}
              {mode === 'count' && lines.length > 0 && changing.length === 0 && parsed.every((p) => p.ok) && (
                <Notice tone="good" icon={Check}>
                  Everything matches the books. Nothing to save.
                </Notice>
              )}
              <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--erp-line)] bg-[var(--erp-shell)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 md:static md:border-0 md:bg-transparent md:p-0">
                <PillButton variant="dark" icon={Check} dot loading={busy} disabled={!ready} onClick={() => void save()} className="h-14 w-full text-[15px]">
                  {saveLabel}
                </PillButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function whCode(list: WarehouseList['warehouses'] | null, id: string): string {
  const w = list?.find((x) => x.id === id);
  return w === undefined ? '' : w.code !== '' ? w.code : w.name;
}

function chip(on: boolean): string {
  return cn(
    'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors',
    on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)] hover:bg-[var(--erp-row-hover)]',
  );
}

function WarehouseChips({ list, value, onChange, lead }: { list: WarehouseList['warehouses']; value: string; onChange: (id: string) => void; lead?: LucideIcon | undefined }): React.JSX.Element {
  const Lead = lead ?? WarehouseIcon;
  if (list.length === 0) return <p className="text-[13px] text-[var(--erp-muted)]">No other warehouse yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((w) => (
        <button key={w.id} type="button" aria-pressed={value === w.id} onClick={() => onChange(w.id)} className={chip(value === w.id)}>
          <Lead size={14} aria-hidden />
          {w.name}
        </button>
      ))}
    </div>
  );
}

function LineOutcome({ mode, here, diff, ok, short, unit }: { mode: ChangeMode; here: number; diff: number; ok: boolean; short: boolean; unit: string }): React.JSX.Element {
  if (!ok) return <span className="text-[12px] font-semibold text-[var(--erp-red-text)]">{mode === 'count' ? 'Enter what is there' : 'Enter how many'}</span>;
  if (short) return <span className="text-[12px] font-semibold text-[var(--erp-red-text)]">Only {qty(here)} {unit} here</span>;
  if (mode === 'count') {
    return (
      <span className={cn('num inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold', diff === 0 ? 'bg-[var(--erp-card)] text-[var(--erp-ink-2)]' : diff > 0 ? 'bg-[var(--erp-green)]/12 text-[var(--erp-green-text)]' : 'bg-[var(--erp-red)]/12 text-[var(--erp-red-text)]')}>
        {diff === 0 ? 'Matches' : `${signed(diff)} ${unit}`}
      </span>
    );
  }
  const after = Math.round((here + diff) * 1000) / 1000;
  return (
    <span className="num text-[13px] text-[var(--erp-ink-2)]">
      {qty(here)} <ArrowRight size={12} className="mx-0.5 inline" aria-hidden /> <span className="font-bold text-[var(--erp-ink)]">{qty(mode === 'transfer' ? here - Math.abs(diff) : after)}</span> {unit}
    </span>
  );
}

/** Search for a stock item (name, SKU, barcode); Enter takes the first match, so a scanner works. */
function ItemSearch({ onPick, warehouse, autoFocus, exclude, inputRef }: { onPick: (id: string) => void; warehouse: string; autoFocus: boolean; exclude: string[]; inputRef: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 160);
  const [rows, setRows] = useState<ItemList['items'] | null>(null);
  const [focus, setFocus] = useState(autoFocus);
  useEffect(() => {
    let live = true;
    op<ItemList>('items.list', { q: dq, kind: 'stock', warehouse: warehouse !== '' && dq === '' ? warehouse : undefined, limit: 8 }, { quiet: true })
      .then((r) => {
        if (live) setRows(r.items);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [dq, warehouse]);
  const shown = (rows ?? []).filter((r) => !exclude.includes(r.id)).slice(0, dq === '' ? 5 : 8);
  const pick = (id: string): void => {
    onPick(id);
    setQ('');
  };
  return (
    <div>
      <label className="relative block">
        <ScanBarcode size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = shown[0];
              if (first !== undefined && q.trim() !== '') pick(first.id);
            }
          }}
          placeholder="Name, SKU or barcode"
          aria-label="Find an item"
          className={cn(softInput, 'pl-11')}
        />
      </label>
      {(focus || q !== '') && (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Matching items">
          {rows === null && <Skeleton className="h-12" />}
          {rows !== null && shown.length === 0 && <li className="px-3 py-2 text-[13px] text-[var(--erp-muted)]">{dq === '' ? 'Type to find an item' : 'No stock item matches'}</li>}
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => pick(r.id)} className="flex w-full items-center gap-3 rounded-[16px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--erp-row)]">
                <ItemThumb photo={r.photo} icon={r.category?.icon} size={36} rounded="rounded-[12px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{r.name}</span>
                  <span className="num block truncate text-[12px] text-[var(--erp-muted)]">
                    {r.sku} · {qty(r.on_hand)} {r.unit} on hand
                  </span>
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)] text-[var(--erp-ink)]">
                  <Plus size={15} aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

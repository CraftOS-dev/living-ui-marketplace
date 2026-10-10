/**
 * The stock change screen. The "+" (or an In / Out / Move / Set button on an
 * item) grows into a full screen with a circular reveal from where it was
 * pressed; closing shrinks it back. Three numbered steps read left to right:
 * the item (search, or scan its barcode), how many (In, Out, Move or Set,
 * on a keypad; the physical keyboard works too), then where and why, and
 * Save. After saving, a pill offers Undo.
 *
 * useStockChange().open(origin, { item?, mode?, location?, to? })
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Delete, Minus, MoveRight, Plus, RefreshCw, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { NUMBER_LOCALE, normalizeNumber, qty, symbolOf } from '../lib/format.ts';
import { ItemThumb, kindIcon } from '../lib/icons.tsx';
import { useScanner } from '../lib/scanner.ts';
import type { Item, ItemDetail } from '../lib/types.ts';
import { Segmented, StatusBadge } from './controls.tsx';
import { ItemSearch, LocationSelect } from './pickers.tsx';
import { CircleButton, Field, PillButton, errMessage, softInput } from './ui.tsx';

export type ChangeMode = 'in' | 'out' | 'move' | 'set';
type Origin = { x: number; y: number };

export interface ChangePreset {
  item?: { id: string };
  mode?: ChangeMode;
  location?: string;
  /** Where a move goes (mode 'move'). */
  to?: string;
}

interface ChangeApi {
  /** `from` is the element pressed, or the screen point it grows from (a drop on the map). */
  open: (from: Element | Origin | null, preset?: ChangePreset) => void;
  /** Show the "saved" pill with Undo for a change made elsewhere (Scan, Reorder...). */
  saved: (message: string, batch: string) => void;
}

const Ctx = createContext<ChangeApi | null>(null);

export function useStockChange(): ChangeApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useStockChange outside StockChangeProvider');
  return v;
}

function originOf(el: Element | Origin | null): Origin {
  if (el === null) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  if (!(el instanceof Element)) return el;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

interface Done {
  message: string;
  batch: string;
}

export function StockChangeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<{ preset: ChangePreset; origin: Origin; n: number } | null>(null);
  const [snack, setSnack] = useState<Done | null>(null);
  const counter = useRef(0);
  const value = useMemo<ChangeApi>(
    () => ({
      open: (from, preset) => setState({ preset: preset ?? {}, origin: originOf(from), n: ++counter.current }),
      saved: (message, batch) => setSnack({ message, batch }),
    }),
    [],
  );
  useEffect(() => {
    if (snack === null) return;
    const t = setTimeout(() => setSnack(null), 8000);
    return () => clearTimeout(t);
  }, [snack]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {state !== null && (
        <ChangeScreen
          key={state.n}
          preset={state.preset}
          origin={state.origin}
          onClosed={(done) => {
            setState(null);
            if (done !== null) setSnack(done);
          }}
        />
      )}
      {snack !== null && <UndoSnack done={snack} onDone={() => setSnack(null)} />}
    </Ctx.Provider>
  );
}

/** "Saved" pill with Undo, shown after a change. */
export function UndoSnack({ done, onDone }: { done: Done; onDone: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.undo(done.batch);
      toast.info('Undone');
    } catch {
      /* toasted */
    }
    onDone();
  };
  return (
    <div
      role="status"
      className="iv-pop iv-on-ink fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--iv-ink)] p-2 text-[var(--iv-shell)] shadow-2xl md:bottom-8"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--iv-accent)] text-[var(--iv-on-accent)]">
        <Check size={16} strokeWidth={2.6} aria-hidden />
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold">{done.message}</span>
      {done.batch !== '' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void undo()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold text-[var(--iv-accent)] hover:bg-[var(--iv-shell)]/10"
        >
          <Undo2 size={14} aria-hidden /> Undo
        </button>
      )}
      <button type="button" onClick={onDone} aria-label="Dismiss" className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--iv-shell)]/10">
        <X size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

export function reveal(el: HTMLElement, o: Origin, open: boolean): Animation | null {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    return el.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 160, fill: 'both' });
  }
  const r = Math.hypot(Math.max(o.x, window.innerWidth - o.x), Math.max(o.y, window.innerHeight - o.y)) + 24;
  const small = `circle(24px at ${o.x}px ${o.y}px)`;
  const big = `circle(${r}px at ${o.x}px ${o.y}px)`;
  return el.animate([{ clipPath: open ? small : big }, { clipPath: open ? big : small }], {
    duration: open ? 560 : 420,
    easing: open ? 'cubic-bezier(0.65, 0, 0.35, 1)' : 'cubic-bezier(0.55, 0, 0.75, 0.2)',
    fill: 'both',
  });
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

const REASONS: Record<ChangeMode, { value: string; label: string }[]> = {
  in: [
    { value: 'received', label: 'Received' },
    { value: 'returned', label: 'Returned' },
    { value: 'found', label: 'Found' },
    { value: 'produced', label: 'Made' },
  ],
  out: [
    { value: 'used', label: 'Used' },
    { value: 'sold', label: 'Sold' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'lost', label: 'Lost or stolen' },
    { value: 'expired', label: 'Expired' },
    { value: 'sample', label: 'Sample or gift' },
    { value: 'returned', label: 'Returned to supplier' },
  ],
  move: [],
  set: [
    { value: 'correction', label: 'Correction' },
    { value: 'found', label: 'Found more' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'lost', label: 'Lost' },
    { value: 'expired', label: 'Expired' },
  ],
};

const MODES: { value: ChangeMode; label: string; icon: typeof Plus }[] = [
  { value: 'in', label: 'In', icon: Plus },
  { value: 'out', label: 'Out', icon: Minus },
  { value: 'move', label: 'Move', icon: MoveRight },
  { value: 'set', label: 'Set', icon: RefreshCw },
];

type StepState = 'todo' | 'current' | 'done';

function ChangeScreen({ preset, origin, onClosed }: { preset: ChangePreset; origin: Origin; onClosed: (done: Done | null) => void }): React.JSX.Element {
  const { currency, locations, locationById, settings } = useApp();
  const root = useRef<HTMLDivElement | null>(null);
  const closing = useRef(false);
  const [mode, setMode] = useState<ChangeMode>(preset.mode ?? 'in');
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loadingItem, setLoadingItem] = useState(preset.item !== undefined);
  const [amount, setAmount] = useState('');
  const amountLog = useRef<{ t: number; value: string }[]>([]);
  const [location, setLocation] = useState(preset.location ?? '');
  const [to, setTo] = useState(preset.to ?? '');
  const [reason, setReason] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (root.current !== null) reveal(root.current, origin, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [origin]);

  const close = useCallback(
    (done: Done | null) => {
      if (closing.current) return;
      closing.current = true;
      const anim = root.current !== null ? reveal(root.current, origin, false) : null;
      if (anim === null) onClosed(done);
      else anim.onfinish = () => onClosed(done);
    },
    [origin, onClosed],
  );

  const places = item?.stock ?? [];
  const placeIds = places.map((p) => p.location.id);

  // Sensible places once the item (or the mode) is known.
  const pickDefaults = useCallback(
    (it: ItemDetail, m: ChangeMode, keep: string) => {
      const held = it.stock.map((s) => s.location.id);
      const home = it.default_location?.id ?? '';
      const firstRoot = locations.find((l) => l.depth === 0)?.id ?? '';
      if (m === 'in') setLocation(keep !== '' ? keep : home !== '' ? home : (held[0] ?? firstRoot));
      else if (m === 'out' || m === 'move') setLocation(keep !== '' && held.includes(keep) ? keep : held.includes(home) ? home : (held[0] ?? ''));
      else setLocation(keep !== '' ? keep : held.includes(home) ? home : (held[0] ?? (home !== '' ? home : firstRoot)));
      setReason(REASONS[m][0]?.value ?? '');
      if (m === 'in' && it.unit_cost_e4 > 0) setCost(it.unit_cost);
    },
    [locations],
  );

  const choose = useCallback(
    async (picked: { id: string }) => {
      setError(null);
      setLoadingItem(true);
      try {
        const d = await api.item(picked.id);
        setItem(d);
        pickDefaults(d, mode, preset.location ?? '');
      } catch {
        /* toasted */
      } finally {
        setLoadingItem(false);
      }
    },
    [mode, pickDefaults, preset.location],
  );

  useEffect(() => {
    if (preset.item !== undefined) void choose(preset.item);
    // Only the preset item, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (m: ChangeMode): void => {
    setMode(m);
    setError(null);
    if (item !== null) pickDefaults(item, m, location);
    else setReason(REASONS[m][0]?.value ?? '');
  };

  const fractional = item?.fractional ?? true;
  const decimals = fractional ? 3 : 0;

  const setAmountLogged = (next: string): void => {
    amountLog.current.push({ t: performance.now(), value: next });
    if (amountLog.current.length > 50) amountLog.current.shift();
    setAmount(next);
  };

  const press = useCallback(
    (k: string) => {
      setError(null);
      setAmount((a) => {
        let next = a;
        if (k === 'del') next = a.slice(0, -1);
        else if (k === 'clear') next = '';
        else if (k === '.') {
          if (decimals === 0 || a.includes('.')) return a;
          next = a === '' ? '0.' : `${a}.`;
        } else {
          const [whole = '', frac] = a.split('.');
          if (frac !== undefined && frac.length >= decimals) return a;
          if (frac === undefined && whole.replace(/^0+/, '').length >= 9) return a;
          next = a === '0' ? k : a + k;
        }
        amountLog.current.push({ t: performance.now(), value: next });
        return next;
      });
    },
    [decimals],
  );

  const n = amount === '' ? NaN : Number(amount.endsWith('.') ? amount.slice(0, -1) : amount);
  const here = places.find((p) => p.location.id === location)?.qty ?? 0;
  const validAmount = Number.isFinite(n) && (mode === 'set' ? n >= 0 : n > 0);
  const needTo = mode === 'move';
  const ready = item !== null && validAmount && location !== '' && (!needTo || (to !== '' && to !== location));

  const save = useCallback(async () => {
    if (item === null) {
      setError('Choose an item first');
      return;
    }
    if (!validAmount) {
      setError(mode === 'set' ? 'Enter how many are really there' : 'Enter how many');
      return;
    }
    if (location === '') {
      setError(mode === 'in' ? 'Choose where it goes' : 'Choose where it is');
      return;
    }
    if (mode === 'move' && (to === '' || to === location)) {
      setError('Choose where it moves to');
      return;
    }
    const q = amount.endsWith('.') ? amount.slice(0, -1) : amount;
    const noteText = note.trim() !== '' ? note.trim() : undefined;
    setBusy(true);
    try {
      let r;
      if (mode === 'in') {
        const c = cost.trim() !== '' ? normalizeNumber(cost, 4) : null;
        if (cost.trim() !== '' && c === null) {
          setError('Enter the cost like 2.35');
          setBusy(false);
          return;
        }
        r = await api.stockIn({ item: item.id, qty: q, location, reason, ...(c !== null ? { unit_cost: c } : {}), ...(noteText !== undefined ? { note: noteText } : {}) });
      } else if (mode === 'out') r = await api.stockOut({ item: item.id, qty: q, location, reason, ...(noteText !== undefined ? { note: noteText } : {}) });
      else if (mode === 'move') r = await api.stockMove({ item: item.id, qty: q, from: location, to, ...(noteText !== undefined ? { note: noteText } : {}) });
      else r = await api.stockSet({ item: item.id, qty: q, location, reason, ...(noteText !== undefined ? { note: noteText } : {}) });
      close({ message: r.message, batch: r.batch });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }, [item, validAmount, mode, location, to, amount, note, cost, reason, close]);

  // Keyboard: digits go to the amount unless a text field has focus; Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Enter' && !typing && t?.tagName !== 'BUTTON') {
        e.preventDefault();
        void save();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || item === null) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.code === 'NumpadDecimal') press('.');
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Delete') press('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, save, close, item]);

  // A scan: an item code picks the item, a location code picks the place.
  // Digits of the scan that reached the keypad are taken back first.
  useScanner((code, startedAt) => {
    const before = [...amountLog.current].reverse().find((x) => x.t < startedAt - 1);
    if (amountLog.current.some((x) => x.t >= startedAt - 1)) setAmountLogged(before?.value ?? '');
    api
      .lookup(code)
      .then((hit) => {
        if (hit.type === 'item') {
          setItem(hit.item);
          pickDefaults(hit.item, mode, '');
          setAmountLogged('');
        } else if (hit.type === 'location') {
          if (mode === 'move' && location !== '' && hit.location.id !== location) setTo(hit.location.id);
          else setLocation(hit.location.id);
        } else setError(`Nothing has the code "${code}"`);
      })
      .catch(() => undefined);
  });

  const step = (s: 1 | 2 | 3): StepState => {
    if (s === 1) return item !== null ? 'done' : 'current';
    if (s === 2) return validAmount ? 'done' : item !== null ? 'current' : 'todo';
    return ready ? 'current' : 'todo';
  };

  const [whole = '', frac] = amount.split('.');
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString(NUMBER_LOCALE);
  const unit = item?.unit ?? 'pcs';
  const verb = mode === 'in' ? 'Add' : mode === 'out' ? 'Take out' : mode === 'move' ? 'Move' : 'Set to';
  const saveLabel = validAmount && item !== null ? `${verb} ${qty(n)} ${unit}` : mode === 'set' ? 'Set the count' : `${verb} stock`;
  const chip = (on: boolean): string =>
    cn('inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors', on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]');
  const after = mode === 'in' ? here + (Number.isFinite(n) ? n : 0) : mode === 'out' || mode === 'move' ? here - (Number.isFinite(n) ? n : 0) : Number.isFinite(n) ? n : here;
  const short = (mode === 'out' || mode === 'move') && validAmount && n > here && settings?.allow_negative !== true;

  return (
    <div ref={root} className="fixed inset-0 z-50 overflow-y-auto bg-[var(--iv-shell)] text-[var(--iv-ink)]" role="dialog" aria-modal="true" aria-label="Stock change">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
        <header className="iv-rise iv-d1 mx-auto mb-6 flex max-w-[560px] flex-wrap items-center gap-4 min-[1100px]:max-w-none">
          <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={() => close(null)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Stock change</h1>
            <p className="text-[13px] text-[var(--iv-muted)]">Pick the item, say how many, then where. Scanning a barcode works at any step.</p>
          </div>
          <Segmented ariaLabel="What happened" value={mode} onChange={switchMode} options={MODES} className="w-full sm:w-auto" />
        </header>

        <div className="mx-auto grid max-w-[560px] gap-4 min-[1100px]:max-w-none min-[1100px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.05fr)] min-[1100px]:gap-5">
          {/* 1. Item */}
          <Step n={1} state={step(1)} title="Item" delay={2}>
            {item !== null ? (
              <div className="flex flex-col gap-3">
                <div className="iv-on-sand flex items-center gap-3 rounded-[22px] bg-[var(--iv-sand)] p-3">
                  <ItemThumb photo={item.photo} icon={item.icon} size={56} tone="card" rounded="rounded-[16px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold">{item.name}</p>
                    <p className="truncate text-[12px] text-[var(--iv-muted)]">
                      {item.sku} · {qty(item.on_hand)} {item.unit} on hand
                    </p>
                  </div>
                  <button type="button" onClick={() => setItem(null)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-[var(--iv-ink-2)] hover:bg-[var(--iv-card)]">
                    Change
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} />
                  {item.min_qty > 0 && <span className="text-[12px] text-[var(--iv-muted)]">Reorder at {qty(item.min_qty)}</span>}
                </div>
                {places.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {places.map((p) => {
                      const Icon = kindIcon(p.location.kind);
                      return (
                        <li key={p.location.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2 text-[13px]">
                          <Icon size={15} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-semibold">{p.location.path}</span>
                          <span className="num font-bold">{qty(p.qty)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="rounded-[16px] bg-[var(--iv-row)] px-3 py-2.5 text-[13px] text-[var(--iv-ink-2)]">Not stocked anywhere yet.</p>
                )}
              </div>
            ) : loadingItem ? (
              <div className="flex flex-col gap-2">
                <span className="h-20 animate-pulse rounded-[22px] bg-[var(--iv-row)]" />
                <span className="h-10 animate-pulse rounded-[16px] bg-[var(--iv-row)]" />
              </div>
            ) : (
              <ItemSearch onPick={(it: Item) => void choose(it)} onLocationCode={(l) => setLocation(l.id)} autoFocus scanning={false} limit={6} emptyHint="Add an item first, then record its stock here." />
            )}
          </Step>

          {/* 2. How many */}
          <Step n={2} state={step(2)} title="How many" delay={3} hint={mode === 'set' ? 'What is really there' : undefined}>
            <div className="iv-on-dark rounded-[22px] bg-[var(--iv-dark)] p-5 text-[var(--iv-on-dark)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-[var(--iv-on-dark-muted)]">
                  {mode === 'in' ? 'Coming in' : mode === 'out' ? 'Going out' : mode === 'move' ? 'Moving' : 'Counted'}
                </span>
                <span className="rounded-full bg-[var(--iv-dark-2)] px-3 py-1 text-[12px] font-semibold">{unit}</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2" aria-live="polite">
                <span className="text-[26px] font-bold text-[var(--iv-on-dark-muted)]">
                  {mode === 'in' ? '+' : mode === 'out' ? '−' : mode === 'move' ? '' : '='}
                </span>
                <span className={cn('num min-w-0 truncate text-[26px] font-extrabold tracking-[-0.01em]', amount === '' && 'text-[var(--iv-on-dark-muted)]')}>
                  {shownWhole}
                  {frac !== undefined ? `.${frac}` : ''}
                </span>
                <span aria-hidden className="iv-caret h-7 w-[3px] shrink-0 self-center rounded-full bg-[var(--iv-accent)]" />
              </div>
              <p className={cn('mt-2 min-h-5 text-[12px]', error !== null || short ? 'font-semibold text-[var(--iv-red-text)]' : 'text-[var(--iv-on-dark-muted)]')}>
                {error ??
                  (short
                    ? `Only ${qty(here)} ${unit} here`
                    : item !== null && location !== ''
                      ? `${qty(here)} here now${validAmount ? `, ${qty(Math.round(after * 1000) / 1000)} after` : ''}`
                      : fractional
                        ? ''
                        : 'Whole units')}
              </p>
            </div>
            <div className="mt-3 grid flex-1 grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  disabled={(k === '.' && decimals === 0) || item === null}
                  aria-label={k === 'del' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
                  className="num flex min-h-14 items-center justify-center rounded-[18px] bg-[var(--iv-row)] text-[15px] font-bold transition-[background,transform] hover:bg-[var(--iv-row-hover)] active:scale-95 disabled:opacity-30"
                >
                  {k === 'del' ? <Delete size={20} strokeWidth={2} /> : k}
                </button>
              ))}
            </div>
          </Step>

          {/* 3. Where and why, then Save */}
          <Step n={3} state={step(3)} title={mode === 'move' ? 'From and to' : 'Where and why'} delay={4}>
            <div className="flex flex-1 flex-col gap-4">
              {mode === 'move' ? (
                <>
                  <Field label="From">
                    <PlaceChips places={places} value={location} onChange={setLocation} />
                  </Field>
                  <Field label="To">
                    <div className="flex items-center gap-2">
                      <ArrowRight size={16} className="shrink-0 text-[var(--iv-muted)]" aria-hidden />
                      <LocationSelect value={to} onChange={setTo} soft placeholder="Choose where it goes" ariaLabel="Move to" className="flex-1" />
                    </div>
                  </Field>
                </>
              ) : (
                <Field label={mode === 'in' ? 'Where it goes' : 'Where'}>
                  {mode === 'out' ? (
                    <PlaceChips places={places} value={location} onChange={setLocation} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {places.length > 0 && <PlaceChips places={places} value={location} onChange={setLocation} />}
                      <LocationSelect
                        value={placeIds.includes(location) ? '' : location}
                        onChange={setLocation}
                        soft
                        placeholder={places.length > 0 ? 'Somewhere else' : 'Choose a location'}
                        ariaLabel="Location"
                      />
                    </div>
                  )}
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
              {mode === 'in' && (
                <Field label="Cost per unit" hint="Optional. Moves the average cost of this item.">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[var(--iv-muted)]">{symbolOf(currency)}</span>
                    <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="Same as before" aria-label="Cost per unit" className={cn(softInput, 'num pl-10')} />
                  </div>
                </Field>
              )}
              <Field label="Note">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional, e.g. order #1043" aria-label="Note" className={softInput} />
              </Field>
              <div className="mt-auto pt-2">
                <PillButton variant="dark" icon={Check} dot loading={busy} disabled={!ready || short} onClick={() => void save()} className="h-14 w-full text-[15px]">
                  {saveLabel}
                </PillButton>
              </div>
            </div>
          </Step>
        </div>
        {locationById.size === 0 && <p className="mt-4 text-center text-[13px] text-[var(--iv-muted)]">Add a location first on the Locations page.</p>}
      </div>
    </div>
  );
}

/** The places that hold the item, as chips with their quantities. */
function PlaceChips({
  places,
  value,
  onChange,
}: {
  places: ItemDetail['stock'];
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  if (places.length === 0) return <p className="rounded-[16px] bg-[var(--iv-row)] px-3 py-2.5 text-[13px] text-[var(--iv-ink-2)]">Nothing in stock to take from.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {places.map((p) => {
        const on = p.location.id === value;
        return (
          <button
            key={p.location.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(p.location.id)}
            title={p.location.path}
            className={cn(
              'inline-flex h-10 max-w-full items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors',
              on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
            )}
          >
            <span className="truncate">{p.location.name}</span>
            <span className={cn('num rounded-full px-1.5 text-[12px] font-bold', on ? 'bg-[var(--iv-accent)] text-[var(--iv-on-accent)]' : 'bg-[var(--iv-card)]')}>{qty(p.qty)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One numbered step: the next step to do is ink, finished ones show a check. */
export function Step({
  n,
  state,
  title,
  hint,
  action,
  delay,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  hint?: string | undefined;
  action?: ReactNode;
  delay: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('iv-rise flex flex-col rounded-[28px] bg-[var(--iv-card)] p-5', `iv-d${delay}`)} aria-label={`Step ${n}: ${title}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
            state === 'todo' && 'bg-[var(--iv-row)] text-[var(--iv-ink-2)]',
            state === 'current' && 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]',
            state === 'done' && 'bg-[var(--iv-solid)] text-[var(--iv-on-solid)]',
          )}
        >
          {state === 'done' ? <Check size={14} strokeWidth={3} aria-label="Done" /> : n}
        </span>
        <h2 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h2>
        {action ?? (hint !== undefined && <span className="text-[12px] font-semibold text-[var(--iv-muted)]">{hint}</span>)}
      </div>
      {children}
    </section>
  );
}

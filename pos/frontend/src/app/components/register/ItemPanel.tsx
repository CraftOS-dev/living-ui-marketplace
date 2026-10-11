/**
 * A product's options, in a dialog over the tiles: its sizes as tiles, every
 * option group at once in its own card with its rule ("Pick 1", "Up to 3")
 * and a state that reads without color (Required / Done), defaults already
 * picked, a note, and the price for products whose price is entered at the
 * counter. The Add pill shows the line's price as it is built; with a
 * required choice missing it points at it.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { useApp } from '../../lib/context.tsx';
import { money } from '../../lib/format.ts';
import type { CatalogProduct, ModifierGroup } from '../../lib/types.ts';
import { Keypad, pressAmount } from '../Keypad.tsx';
import type { KeypadKey } from '../Keypad.tsx';
import { Badge, Modal, inputCls } from '../ui.tsx';

export interface ItemChoice {
  variant: string;
  modifiers: string[];
  qty: number;
  price: number | null;
  note: string;
}

function rule(g: ModifierGroup): string {
  if (g.min === 1 && g.max === 1) return 'Pick 1';
  if (g.min === 0 && g.max === 1) return 'Up to 1';
  if (g.min === 0 && g.max === 0) return 'Any';
  if (g.min === 0) return `Up to ${g.max}`;
  if (g.max === 0) return `${g.min} or more`;
  if (g.min === g.max) return `Pick ${g.min}`;
  return `Pick ${g.min} to ${g.max}`;
}

function signed(n: number, currency: string, exp: number): string {
  if (n === 0) return '';
  return `${n > 0 ? '+' : ''}${money(n, currency, exp)}`;
}

export function ItemPanel({
  product,
  initial,
  submitLabel = 'Add',
  onSubmit,
  onClose,
}: {
  product: CatalogProduct;
  initial?: ItemChoice | undefined;
  submitLabel?: string;
  onSubmit: (c: ItemChoice) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { groupById, currency, exp } = useApp();
  const groups = product.modifier_groups.map((id) => groupById.get(id)).filter((g): g is ModifierGroup => g !== undefined);
  const [variant, setVariant] = useState<string>(initial?.variant ?? (product.variants.length === 1 ? (product.variants[0]?.id ?? '') : ''));
  const [mods, setMods] = useState<string[]>(
    initial?.modifiers ?? groups.flatMap((g) => g.options.filter((o) => o.is_default && o.available).map((o) => o.id)),
  );
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const [note, setNote] = useState(initial?.note ?? '');
  const [price, setPrice] = useState<number>(initial?.price ?? 0);
  const [flash, setFlash] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());

  const unitBase = product.open_price ? price : (product.variants.find((v) => v.id === variant)?.price ?? (product.variants.length > 0 ? 0 : product.price));
  const modTotal = groups.reduce((s, g) => s + g.options.filter((o) => mods.includes(o.id)).reduce((t, o) => t + o.price, 0), 0);
  const lineTotal = (unitBase + modTotal) * qty;

  const missing = useMemo(() => {
    const out: string[] = [];
    if (product.variants.length > 0 && variant === '') out.push('variant');
    if (product.open_price && price <= 0) out.push('price');
    for (const g of groups) if (g.options.filter((o) => mods.includes(o.id)).length < g.min) out.push(g.id);
    return out;
  }, [product, variant, price, groups, mods]);

  const toggle = (g: ModifierGroup, optionId: string): void => {
    const inGroup = g.options.map((o) => o.id);
    const picked = mods.filter((m) => inGroup.includes(m));
    if (mods.includes(optionId)) {
      setMods(mods.filter((m) => m !== optionId));
      return;
    }
    if (g.max === 1) {
      setMods([...mods.filter((m) => !inGroup.includes(m)), optionId]);
      return;
    }
    if (g.max > 0 && picked.length >= g.max) {
      setFlash(g.id);
      window.setTimeout(() => setFlash(null), 700);
      return;
    }
    setMods([...mods, optionId]);
  };

  const submit = (): void => {
    const first = missing[0];
    if (first !== undefined) {
      setFlash(first);
      refs.current.get(first)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(() => setFlash(null), 900);
      return;
    }
    onSubmit({ variant, modifiers: mods, qty, price: product.open_price ? price : null, note: note.trim() });
  };

  const onPriceKey = useCallback((k: KeypadKey): void => setPrice((p) => pressAmount(p, k)), []);

  const head = (id: string, title: string, sub: string, ok: boolean, required: boolean): React.JSX.Element => (
    <div className={cn('mb-3 flex items-center gap-2 rounded-full', flash === id && 'ps-shake')}>
      <h3 className="text-[15px] font-bold">{title}</h3>
      <span className="text-[12px] font-semibold text-[var(--ps-muted)]">{sub}</span>
      <span className="flex-1" />
      {required && (ok ? <Badge tone="good">Done</Badge> : <Badge tone="bad">Required</Badge>)}
    </div>
  );
  const optionCls = (on: boolean): string =>
    cn('ps-press flex min-h-14 flex-col justify-center rounded-[18px] px-4 py-2 text-left disabled:cursor-not-allowed', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]');
  const section = 'ps-on-card rounded-[22px] bg-[var(--ps-card)] p-4';

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={product.name}
      description={product.open_price ? 'Price entered here' : product.variants.length > 0 ? `${product.variants.length} sizes` : money(product.price, currency, exp)}
      footer={
        <>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--ps-card)] p-1">
            <button type="button" aria-label="One less" disabled={qty <= 1} onClick={() => setQty(qty - 1)} className="ps-press flex size-12 items-center justify-center rounded-full hover:bg-[var(--ps-row)] disabled:opacity-40">
              <Minus size={18} aria-hidden />
            </button>
            <span className="num w-9 text-center text-[15px] font-bold" aria-label={`Quantity ${qty}`}>
              {qty}
            </span>
            <button type="button" aria-label="One more" disabled={qty >= 999} onClick={() => setQty(qty + 1)} className="ps-press flex size-12 items-center justify-center rounded-full hover:bg-[var(--ps-row)] disabled:opacity-40">
              <Plus size={18} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={submit}
            className={cn('ps-press ps-on-ink flex h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-full bg-[var(--ps-ink)] py-2 pl-2 pr-6 text-[15px] font-bold text-[var(--ps-shell)] hover:opacity-90', missing.length > 0 && 'bg-[var(--ps-ink-2)]')}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
                <Plus size={18} strokeWidth={2.2} />
              </span>
              <span className="truncate">{missing.length > 0 ? 'Choose the required options' : submitLabel}</span>
            </span>
            <span className="num shrink-0 text-[var(--ps-accent)]">{money(lineTotal, currency, exp)}</span>
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {product.variants.length > 0 && (
          <section className={section} ref={(el) => void (el !== null && refs.current.set('variant', el))}>
            {head('variant', 'Size', 'Pick 1', variant !== '', true)}
            <div role="radiogroup" aria-label="Size" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {product.variants.map((v) => {
                const on = v.id === variant;
                return (
                  <button key={v.id} type="button" role="radio" aria-checked={on} onClick={() => setVariant(v.id)} className={optionCls(on)}>
                    <span className="text-[14px] font-bold">{v.name}</span>
                    <span className={cn('num text-[13px]', on ? 'text-[var(--ps-accent)]' : 'text-[var(--ps-muted)]')}>{money(v.price, currency, exp)}</span>
                    {v.stock !== null && v.stock <= 0 && <span className="text-[12px] font-semibold">None left</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {product.open_price && (
          <section className={section} ref={(el) => void (el !== null && refs.current.set('price', el))}>
            {head('price', 'Price', '', price > 0, true)}
            <div className="ps-on-dark mb-3 flex items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-dark)] px-5 py-4 text-[var(--ps-on-dark)]">
              <span className="text-[12px] font-semibold text-[var(--ps-muted)]">Type or tap the keys</span>
              <span className="flex items-center gap-2">
                <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{money(price, currency, exp)}</span>
                <span aria-hidden className="ps-caret h-7 w-[3px] rounded-full bg-[var(--ps-accent)]" />
              </span>
            </div>
            <Keypad onKey={onPriceKey} extra="00" size="md" />
          </section>
        )}
        {groups.map((g) => {
          const picked = g.options.filter((o) => mods.includes(o.id)).length;
          return (
            <section key={g.id} className={section} ref={(el) => void (el !== null && refs.current.set(g.id, el))}>
              {head(g.id, g.name, rule(g), picked >= g.min, g.min > 0)}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.options.map((o) => {
                  const on = mods.includes(o.id);
                  return (
                    <button key={o.id} type="button" role={g.max === 1 ? 'radio' : 'checkbox'} aria-checked={on} disabled={!o.available} onClick={() => toggle(g, o.id)} className={cn(optionCls(on), !o.available && 'text-[var(--ps-ink-2)]')}>
                      <span className={cn('text-[14px] font-bold', !o.available && 'line-through')}>{o.name}</span>
                      <span className={cn('num text-[12px]', on ? 'text-[var(--ps-accent)]' : 'text-[var(--ps-muted)]')}>{!o.available ? 'Sold out' : signed(o.price, currency, exp) || 'No charge'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <section className={section}>
          <h3 className="mb-3 text-[15px] font-bold">Note</h3>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="For the kitchen or the receipt" aria-label="Note" className={inputCls} />
        </section>
      </div>
    </Modal>
  );
}

/** Does tapping this product need the options panel, or can it go straight in? */
export function needsPanel(p: CatalogProduct, groupById: Map<string, ModifierGroup>): boolean {
  if (p.open_price) return true;
  if (p.variants.length > 1) return true;
  for (const id of p.modifier_groups) {
    const g = groupById.get(id);
    if (g === undefined) continue;
    const defaults = g.options.filter((o) => o.is_default && o.available).length;
    if (g.min > defaults) return true;
  }
  return false;
}

/** The default choice for a product that goes straight into the cart. */
export function defaultChoice(p: CatalogProduct, groupById: Map<string, ModifierGroup>): ItemChoice {
  return {
    variant: p.variants.length === 1 ? (p.variants[0]?.id ?? '') : '',
    modifiers: p.modifier_groups.flatMap((id) => (groupById.get(id)?.options ?? []).filter((o) => o.is_default && o.available).map((o) => o.id)),
    qty: 1,
    price: null,
    note: '',
  };
}


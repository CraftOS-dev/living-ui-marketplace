/**
 * The item sheet: choose the variant (one button row per option, values
 * that do not exist with the current choice are off), the options of its
 * option groups (required groups first), the quantity or weight and a
 * note, then add it to the sale. Used for new lines and for changing the
 * options of a line already on the sale.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { useStore } from '../../lib/context.tsx';
import { qty as qtyText } from '../../lib/format.ts';
import type { ModifierGroup, Product, Variant } from '../../lib/types.ts';
import { Stepper } from '../pads.tsx';
import { Button, Modal, inputCls } from '../ui.tsx';

export interface ItemChoice {
  variant: Variant;
  qty: number;
  modifiers: string[];
  note: string;
}

function liveVariants(p: Product): Variant[] {
  return p.variants.filter((v) => !v.archived);
}

export function ItemDialog({
  product,
  initialVariant,
  initial,
  mode = 'add',
  onClose,
  onDone,
}: {
  product: Product | null;
  initialVariant: Variant | null;
  initial?: { qty: number; modifiers: string[]; note: string };
  mode?: 'add' | 'edit';
  onClose: () => void;
  onDone: (c: ItemChoice) => Promise<boolean>;
}): React.JSX.Element | null {
  const { catalog, money } = useStore();
  const [choice, setChoice] = useState<string[]>([]);
  const [variantId, setVariantId] = useState('');
  const [mods, setMods] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const variants = useMemo(() => (product === null ? [] : liveVariants(product)), [product]);
  const groups = useMemo(() => {
    if (product === null) return [] as ModifierGroup[];
    const all = new Map((catalog?.modifier_groups ?? []).map((g) => [g.id, g]));
    return product.modifier_groups.map((id) => all.get(id)).filter((g): g is ModifierGroup => g !== undefined);
  }, [product, catalog]);
  const byWeight = product?.sold_by === 'weight';

  useEffect(() => {
    if (product === null) return;
    const v = initialVariant ?? (variants.length === 1 ? (variants[0] ?? null) : null);
    setVariantId(v?.id ?? '');
    setChoice(v !== null && product.option_names.length > 0 ? [...v.options] : product.option_names.map(() => ''));
    setMods(initial?.modifiers ?? []);
    setCount(initial !== undefined && !byWeight ? initial.qty : 1);
    setWeight(initial !== undefined && byWeight ? qtyText(initial.qty) : '');
    setNote(initial?.note ?? '');
  }, [product, initialVariant, variants, initial, byWeight]);

  if (product === null) return null;

  const optioned = product.option_names.length > 0;
  const variant = variants.find((v) => v.id === variantId) ?? null;

  const pickOption = (i: number, value: string): void => {
    const next = [...choice];
    next[i] = next[i] === value ? '' : value;
    // Clear later choices that no longer combine.
    for (let k = 0; k < next.length; k++) {
      if (k === i || next[k] === '') continue;
      const ok = variants.some((v) => next.every((x, j) => x === '' || v.options[j] === x));
      if (!ok) next[k] = '';
    }
    setChoice(next);
    const match = variants.find((v) => next.every((x, j) => x !== '' && v.options[j] === x));
    setVariantId(match?.id ?? '');
  };

  const possible = (i: number, value: string): boolean => variants.some((v) => v.options[i] === value && choice.every((x, j) => j === i || x === '' || v.options[j] === x));

  const toggleMod = (g: ModifierGroup, id: string): void => {
    setMods((cur) => {
      const has = cur.includes(id);
      if (has) return cur.filter((x) => x !== id);
      const inGroup = cur.filter((x) => g.options.some((o) => o.id === x));
      if (g.max === 1) return [...cur.filter((x) => !inGroup.includes(x)), id];
      if (g.max > 0 && inGroup.length >= g.max) return cur;
      return [...cur, id];
    });
  };

  const missing = groups.filter((g) => mods.filter((x) => g.options.some((o) => o.id === x)).length < g.min);
  const modsEach = groups.reduce((a, g) => a + g.options.filter((o) => mods.includes(o.id)).reduce((b, o) => b + o.price, 0), 0);
  const w = byWeight ? Number(weight.replace(',', '.')) : count;
  const qtyOk = byWeight ? weight.trim() !== '' && Number.isFinite(w) && w > 0 && Math.round(w * 1000) === w * 1000 : count >= 1;
  const each = variant === null ? 0 : variant.price + modsEach;
  const total = Math.round(each * (qtyOk ? w : 0));
  const ready = variant !== null && missing.length === 0 && qtyOk;

  const done = async (): Promise<void> => {
    if (!ready || variant === null) return;
    setBusy(true);
    const ok = await onDone({ variant, qty: w, modifiers: mods, note: note.trim() });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal touch
      open
      onClose={onClose}
      title={product.name}
      description={product.description !== '' ? product.description : undefined}
      wide
      footer={
        <>
          <span className="num mr-auto self-center text-[15px] font-bold">{money.fmt(total)}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="lg" icon={mode === 'add' ? Plus : Check} disabled={!ready} loading={busy} onClick={() => void done()}>
            {mode === 'add' ? 'Add to sale' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {optioned &&
          mode === 'add' &&
          product.option_names.map((name, i) => {
            const values = Array.from(new Set(variants.map((v) => v.options[i] ?? ''))).filter((x) => x !== '');
            return (
              <section key={name}>
                <h3 className="mb-1.5 text-[12px] font-bold text-[var(--ps-ink-2)]">{name}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {values.map((val) => {
                    const on = choice[i] === val;
                    const can = possible(i, val);
                    return (
                      <button
                        key={val}
                        type="button"
                        aria-pressed={on}
                        disabled={!can && !on}
                        onClick={() => pickOption(i, val)}
                        className={cn('h-10 min-w-16 rounded-[var(--ps-r)] border px-3 text-[13px] font-semibold transition-colors disabled:opacity-35', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

        {!optioned && variants.length > 1 && mode === 'add' && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-[var(--ps-ink-2)]">Variant</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {variants.map((v) => {
                const on = v.id === variantId;
                return (
                  <button key={v.id} type="button" aria-pressed={on} onClick={() => setVariantId(v.id)} className={cn('flex h-12 flex-col items-start justify-center rounded-[var(--ps-r)] border px-3 text-left transition-colors', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
                    <span className="truncate text-[13px] font-semibold">{v.title || v.sku || 'Default'}</span>
                    <span className={cn('num text-[12px]', on ? 'opacity-80' : 'text-[var(--ps-muted)]')}>{money.fmt(v.price)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {variant !== null && (optioned || variants.length > 1) && (
          <p className={cn('flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--ps-muted)]', mode === 'add' && '-mt-2')}>
            {mode === 'edit' && variant.title !== '' && <span className="font-semibold text-[var(--ps-ink)]">{variant.title}</span>}
            <span className="num font-semibold text-[var(--ps-ink)]">{money.fmt(variant.price)}</span>
            {variant.sku !== '' && <span>SKU {variant.sku}</span>}
            {variant.track_stock && <span className={cn(variant.status === 'out' && 'font-semibold text-[var(--ps-red-text)]', variant.status === 'low' && 'font-semibold text-[var(--ps-amber-text)]')}>{qtyText(variant.stock)} in stock</span>}
          </p>
        )}

        {groups.map((g) => {
          const picked = mods.filter((x) => g.options.some((o) => o.id === x)).length;
          const rule = g.min > 0 ? (g.max === 1 ? 'Choose 1' : g.max > 0 ? 'Choose ' + g.min + ' to ' + g.max : 'Choose at least ' + g.min) : g.max === 1 ? 'Optional, 1' : g.max > 0 ? 'Optional, up to ' + g.max : 'Optional';
          return (
            <section key={g.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">{g.name}</h3>
                <span className={cn('text-[12px]', g.min > 0 && picked < g.min ? 'font-semibold text-[var(--ps-amber-text)]' : 'text-[var(--ps-muted)]')}>{rule}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {g.options.map((o) => {
                  const on = mods.includes(o.id);
                  return (
                    <button key={o.id} type="button" aria-pressed={on} onClick={() => toggleMod(g, o.id)} className={cn('flex h-10 items-center justify-between gap-2 rounded-[var(--ps-r)] border px-3 text-left text-[13px] font-semibold transition-colors', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
                      <span className="truncate">{o.name}</span>
                      {o.price !== 0 && <span className={cn('num shrink-0 text-[12px]', on ? 'opacity-80' : 'text-[var(--ps-muted)]')}>{money.signed(o.price)}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="flex flex-wrap items-end gap-4">
          {byWeight ? (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-[var(--ps-ink-2)]">Weight{product.unit !== '' ? ' (' + product.unit + ')' : ''}</span>
              <input autoFocus className={cn(inputCls, 'num h-10 w-32 text-right text-[15px]')} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.000" onKeyDown={(e) => e.key === 'Enter' && void done()} />
            </label>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-[var(--ps-ink-2)]">Quantity</span>
              <Stepper value={count} onChange={setCount} label="Quantity" min={1} />
            </div>
          )}
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[12px] font-bold text-[var(--ps-ink-2)]">Note</span>
            <input className={cn(inputCls, 'h-9')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="For the kitchen or the receipt" />
          </label>
        </section>
      </div>
    </Modal>
  );
}


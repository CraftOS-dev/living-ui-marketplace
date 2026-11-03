/**
 * Options of a new product (Size, Colour...), up to three, each with its
 * values as chips. Every combination becomes a SKU row ("Red / M") with its
 * own price, cost, SKU and opening stock, first filled from the product's
 * single price and stock and then edited per row. A row can be left out.
 */
import { useRef } from 'react';
import { Layers, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { plural } from '../lib/format.ts';
import { ChipInput, SmallAmount, badRing, smallField } from './ProductParts.tsx';
import { Button, Card, CardHeader, IconBadge, IconButton } from './ui.tsx';

export const MAX_OPTIONS = 3;
export const MAX_SKUS = 100;

export interface OptionDraft {
  id: string;
  name: string;
  values: string[];
}

/** What was typed in one row; a blank field falls back to the product's value. */
export interface RowEdit {
  price?: string;
  cost?: string;
  sku?: string;
  stock?: string;
}

export interface VariantRow {
  label: string;
  values: string[];
  price: string;
  cost: string;
  sku: string;
  stock: string;
}

export type RowField = keyof RowEdit;
export type RowFlags = Partial<Record<RowField, true>>;

export interface Seed {
  price: string;
  cost: string;
  sku: string;
  stock: string;
}

let seq = 0;
export function newOption(): OptionDraft {
  return { id: 'opt-' + String(++seq), name: '', values: [] };
}

/** The options that make rows: named, with at least one value. */
export function usable(options: OptionDraft[]): OptionDraft[] {
  return options.filter((o) => o.name.trim() !== '' && o.values.length > 0);
}

/** Every combination of the options' values, in order. */
export function combos(options: OptionDraft[]): string[][] {
  let out: string[][] = [[]];
  for (const o of usable(options)) {
    const next: string[][] = [];
    for (const c of out) for (const v of o.values) next.push([...c, v]);
    out = next;
    if (out.length > MAX_SKUS * 4) break;
  }
  return out.length === 1 && out[0]?.length === 0 ? [] : out;
}

function skuPart(v: string): string {
  return v
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
}

/** "MUG" and Red, M give "MUG-RED-M"; no base SKU leaves it to the server. */
export function skuFor(base: string, values: string[]): string {
  const b = base.trim();
  if (b === '') return '';
  return [b, ...values.map(skuPart).filter((x) => x !== '')].join('-');
}

export function rowsOf(options: OptionDraft[], edits: Record<string, RowEdit>, seed: Seed, excluded: string[]): VariantRow[] {
  return combos(options)
    .map((values) => {
      const label = values.join(' / ');
      const e = edits[label] ?? {};
      return { label, values, price: e.price ?? seed.price, cost: e.cost ?? seed.cost, sku: e.sku ?? skuFor(seed.sku, values), stock: e.stock ?? seed.stock };
    })
    .filter((r) => !excluded.includes(r.label));
}

const NAME_HINTS = ['Size', 'Colour', 'Material'];

export function OptionsEditor({
  options,
  onOptions,
  rows,
  left,
  onRow,
  onExclude,
  onRestore,
  sign,
  optionErrors,
  rowErrors,
  note,
}: {
  options: OptionDraft[];
  onOptions: (o: OptionDraft[]) => void;
  rows: VariantRow[];
  /** Rows left out. */
  left: string[];
  onRow: (label: string, field: RowField, value: string) => void;
  onExclude: (label: string) => void;
  onRestore: () => void;
  sign: string;
  optionErrors: Record<string, string>;
  rowErrors: Record<string, RowFlags>;
  note: string;
}): React.JSX.Element {
  const names = useRef(new Map<string, HTMLInputElement>());
  const add = (): void => {
    const o = newOption();
    onOptions([...options, o]);
    requestAnimationFrame(() => {
      const el = names.current.get(o.id);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    });
  };
  const patch = (id: string, change: Partial<OptionDraft>): void => onOptions(options.map((o) => (o.id === id ? { ...o, ...change } : o)));
  const subtitle = options.length === 0 ? 'One SKU, priced and stocked above' : rows.length === 0 ? 'Add values to make the SKUs' : plural(rows.length, 'SKU');

  return (
    <Card flush className="@container overflow-hidden">
      <div className="px-5 pt-5">
        <CardHeader title="Variants" subtitle={subtitle} className={cn(options.length === 0 && 'mb-3')} />
        {options.length === 0 ? (
          <button type="button" onClick={add} className="mb-5 flex w-full items-center gap-3 rounded-[14px] bg-[var(--so-tile)] px-3 py-3 text-left hover:bg-[var(--so-tile-hover)]">
            <IconBadge icon={Layers} size={36} tone="card" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Add options</span>
              <span className="block text-[12px] text-[var(--so-muted)]">Like size or colour, each with its own price and stock</span>
            </span>
            <Plus size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
          </button>
        ) : (
          <div className="grid gap-3 pb-4">
            {options.map((o, i) => {
              const err = optionErrors[o.id];
              return (
                <div key={o.id} className="grid gap-2 @lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] @lg:items-start">
                  <div className="min-w-0">
                    <input
                      ref={(el) => {
                        if (el === null) names.current.delete(o.id);
                        else names.current.set(o.id, el);
                      }}
                      aria-label={'Option ' + String(i + 1) + ' name'}
                      placeholder={NAME_HINTS[i] ?? 'Option'}
                      value={o.name}
                      onChange={(e) => patch(o.id, { name: e.target.value.slice(0, 40) })}
                      aria-invalid={(err !== undefined && o.name.trim() === '') || undefined}
                      className={cn('h-10 w-full rounded-[12px] bg-[var(--so-tile)] px-3.5 text-[14px] font-semibold text-[var(--so-ink)] outline-none ring-[var(--so-ink)] focus-visible:ring-2', err !== undefined && o.name.trim() === '' && badRing)}
                    />
                  </div>
                  <div className="min-w-0">
                    <ChipInput values={o.values} onChange={(v) => patch(o.id, { values: v })} label={(o.name.trim() || 'Option ' + String(i + 1)) + ' values'} placeholder="Add values, press Enter" max={30} invalid={err !== undefined && o.values.length === 0} />
                    {err !== undefined && <span className="mt-1 block text-[12px] font-medium text-[var(--so-red-text)]">{err}</span>}
                  </div>
                  <IconButton icon={Trash2} label={'Remove option ' + (o.name.trim() || String(i + 1))} variant="ghost" size={40} onClick={() => onOptions(options.filter((x) => x.id !== o.id))} className="justify-self-end" />
                </div>
              );
            })}
            {options.length < MAX_OPTIONS && (
              <div>
                <Button size="sm" variant="tile" icon={Plus} onClick={add}>
                  Add another option
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="border-t border-[var(--so-line)]">
          <div className="relative overflow-x-auto px-2 pb-2">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="text-left">
                  <th className="h-10 px-3 text-[12px] font-semibold text-[var(--so-muted)]">Variant</th>
                  <th className="h-10 w-[128px] px-3.5 text-right text-[12px] font-semibold text-[var(--so-muted)]">Price</th>
                  <th className="h-10 w-[128px] px-3.5 text-right text-[12px] font-semibold text-[var(--so-muted)]">Cost</th>
                  <th className="h-10 w-[164px] px-3.5 text-[12px] font-semibold text-[var(--so-muted)]">SKU</th>
                  <th className="h-10 w-[96px] px-3.5 text-right text-[12px] font-semibold text-[var(--so-muted)]">Stock</th>
                  <th className="h-10 w-[44px]">
                    <span className="sr-only">Leave out</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bad = rowErrors[r.label] ?? {};
                  return (
                    <tr key={r.label} className="border-t border-[var(--so-line)]">
                      <td className="h-12 px-3 text-[13px] font-semibold">
                        <span className="block max-w-[240px] truncate" title={r.label}>
                          {r.label}
                        </span>
                      </td>
                      <td className="px-1.5">
                        <SmallAmount sign={sign} aria-label={r.label + ' price'} placeholder="0.00" value={r.price} invalid={bad.price === true} onChange={(e) => onRow(r.label, 'price', e.target.value)} />
                      </td>
                      <td className="px-1.5">
                        <SmallAmount sign={sign} aria-label={r.label + ' cost'} placeholder="0.00" value={r.cost} invalid={bad.cost === true} onChange={(e) => onRow(r.label, 'cost', e.target.value)} />
                      </td>
                      <td className="px-1.5">
                        <input aria-label={r.label + ' SKU'} placeholder="Made on save" value={r.sku} aria-invalid={bad.sku === true || undefined} onChange={(e) => onRow(r.label, 'sku', e.target.value)} className={cn(smallField, bad.sku === true && badRing)} />
                      </td>
                      <td className="px-1.5">
                        <input aria-label={r.label + ' opening stock'} inputMode="numeric" placeholder="0" value={r.stock} aria-invalid={bad.stock === true || undefined} onChange={(e) => onRow(r.label, 'stock', e.target.value)} className={cn(smallField, 'num text-right', bad.stock === true && badRing)} />
                      </td>
                      <td className="px-1 text-right">
                        <IconButton icon={X} label={'Leave out ' + r.label} variant="ghost" size={32} onClick={() => onExclude(r.label)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {(left.length > 0 || note !== '') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--so-line)] px-5 py-3">
          {note !== '' && <span className="text-[12px] font-medium text-[var(--so-red-text)]">{note}</span>}
          {left.length > 0 && (
            <span className="flex items-center gap-2 text-[12px] text-[var(--so-muted)]">
              {left.length === 1 ? left[0] + ' left out' : plural(left.length, 'combination') + ' left out'}
              <button type="button" onClick={onRestore} className="inline-flex h-7 items-center gap-1 rounded-full px-2 font-semibold text-[var(--so-ink-2)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]">
                <RotateCcw size={12} aria-hidden />
                Bring back
              </button>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

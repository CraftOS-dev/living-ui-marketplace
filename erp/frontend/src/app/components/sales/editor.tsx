/**
 * The line editor of a document (the new-document flow and a draft's page):
 * an item search or free text per line, quantity, unit price, discount, tax
 * and the amount, with live totals worked out exactly as the server will.
 *
 * Keyboard: Tab walks the fields of a line; Enter in a field of the last
 * line adds a new line and opens its item search.
 */
import { useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, Package, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { amount, money, plain, qty as fmtQty } from '../../lib/format.ts';
import type { DocType } from '../../lib/router.ts';
import type { DocDetail, ItemRow, TaxRow } from '../../lib/types/sales.ts';
import { AccountPicker, MoneyInput, NumberInput, Picker, TaxPicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Card, CircleButton, PillButton, cellInput } from '../ui.tsx';
import { lineMath, validQty } from './calc.ts';
import type { LineMath } from './calc.ts';
import { pricedOf, taxedOf } from './parts.tsx';

/* ------------------------------------------------------------------ model */

export interface EditLine {
  key: string;
  /** The saved line's id ('' for a new one). */
  id: string;
  item: ItemRow | null;
  description: string;
  qty: string;
  price: string;
  discount: string;
  /** Tax code, or 'none'. */
  tax: string;
  account: Option | null;
  source_line: string;
  /** Open this line's item search when it appears. */
  focus?: boolean | undefined;
}

let seq = 0;
export function newLine(tax: string, focus = false): EditLine {
  seq += 1;
  return { key: `n${seq}`, id: '', item: null, description: '', qty: '1', price: '', discount: '', tax, account: null, source_line: '', focus };
}

/** A saved document's lines as editable lines. */
export function linesFromDoc(d: DocDetail): EditLine[] {
  return d.lines.map((l) => ({
    key: l.id,
    id: l.id,
    item:
      l.item !== null
        ? { id: l.item.id, name: l.item.name, sku: l.item.sku, kind: l.item.kind, unit: l.item.unit, fractional: l.item.fractional, on_hand: 0, available: Number.NaN, sale_price: l.unit_price, purchase_price: l.unit_price }
        : null,
    description: l.description,
    qty: plain(l.qty),
    price: l.unit_price,
    discount: l.discount_bp > 0 ? l.discount : '',
    tax: l.tax !== null ? l.tax.code : 'none',
    account: l.account !== null ? { id: l.account.id, label: `${l.account.code} ${l.account.name}`, value: l.account.id } : null,
    source_line: l.source_line,
  }));
}

/** A line has something on it (an item or words). */
export function filled(l: EditLine): boolean {
  return l.item !== null || l.description.trim() !== '';
}

export function lineOk(l: EditLine): boolean {
  return filled(l) && validQty(l.qty, l.item !== null && l.item.kind === 'stock' && !l.item.fractional);
}

/** What docs.create / docs.update take for the lines. */
export function lineParams(lines: EditLine[], type: DocType): Record<string, unknown>[] {
  return lines.filter(filled).map((l) => {
    const out: Record<string, unknown> = { qty: l.qty, description: l.description.trim() };
    if (l.id !== '') out['id'] = l.id;
    if (l.item !== null) out['item'] = l.item.id;
    if (pricedOf(type)) {
      out['unit_price'] = l.price.trim() === '' ? '0' : l.price.trim();
      out['discount'] = l.discount.trim() === '' ? '0' : l.discount.trim();
    }
    if (taxedOf(type)) out['tax'] = l.tax === '' ? 'none' : l.tax;
    if (l.account !== null) out['account'] = l.account.id;
    if (l.source_line !== '' && l.id === '') out['source_line'] = l.source_line;
    return out;
  });
}

/* ----------------------------------------------------------------- totals */

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  byTax: { code: string; name: string; amount: number }[];
  count: number;
}

export function rateOf(taxes: TaxRow[], code: string): number {
  if (code === '' || code === 'none') return 0;
  return taxes.find((t) => t.code === code || t.id === code)?.rate_bp ?? 0;
}

export function mathOf(l: EditLine, type: DocType, taxes: TaxRow[], inclusive: boolean, currency: string): LineMath | null {
  if (!filled(l) || !pricedOf(type)) return null;
  return lineMath(l.qty, l.price, l.discount, taxedOf(type) ? rateOf(taxes, l.tax) : 0, inclusive, currency);
}

export function totalsOf(lines: EditLine[], type: DocType, taxes: TaxRow[], inclusive: boolean, currency: string): Totals {
  const t: Totals = { subtotal: 0, discount: 0, tax: 0, total: 0, byTax: [], count: 0 };
  const by = new Map<string, { code: string; name: string; amount: number }>();
  for (const l of lines) {
    if (!filled(l)) continue;
    t.count += 1;
    const m = mathOf(l, type, taxes, inclusive, currency);
    if (m === null) continue;
    t.subtotal += m.net;
    t.discount += m.discount;
    t.tax += m.tax;
    t.total += m.total;
    if (m.tax !== 0) {
      const tx = taxes.find((x) => x.code === l.tax);
      const k = tx?.code ?? l.tax;
      const row = by.get(k) ?? { code: k, name: tx?.name ?? k, amount: 0 };
      row.amount += m.tax;
      by.set(k, row);
    }
  }
  t.byTax = [...by.values()];
  return t;
}

/** Subtotal, discount, tax per rate and the total, as a receipt would. */
export function TotalsBlock({ totals, currency, inclusive, className }: { totals: Totals; currency: string; inclusive: boolean; className?: string | undefined }): React.JSX.Element {
  const row = (label: string, value: string, strong = false): React.JSX.Element => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={cn('text-[13px]', strong ? 'font-semibold text-[var(--erp-ink)]' : 'text-[var(--erp-muted)]')}>{label}</span>
      <span className={cn('num text-[14px]', strong ? 'font-bold' : 'font-semibold')}>{value}</span>
    </div>
  );
  return (
    <div className={className}>
      {row(inclusive ? 'Subtotal before tax' : 'Subtotal', money(totals.subtotal, currency))}
      {totals.discount > 0 && row('Discounts given', `${money(-totals.discount, currency)}`)}
      {totals.byTax.map((t) => (
        <div key={t.code}>{row(t.name, money(t.amount, currency))}</div>
      ))}
      {totals.byTax.length === 0 && row('Tax', money(0, currency))}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-[var(--erp-line)] pt-3">
        <span className="text-[14px] font-bold">Total</span>
        <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(totals.total, currency)}</span>
      </div>
      {inclusive && <p className="mt-1 text-right text-[12px] text-[var(--erp-muted)]">Prices include tax</p>}
    </div>
  );
}

/**
 * The live totals as a card. `sticky` keeps it in view beside the lines on
 * wide screens; only for a card that is last in its column, or the cards
 * after it would scroll up over it.
 */
export function TotalsCard({ totals, currency, inclusive, children, title = 'Total', sticky = false }: { totals: Totals; currency: string; inclusive: boolean; children?: React.ReactNode | undefined; title?: string | undefined; sticky?: boolean | undefined }): React.JSX.Element {
  return (
    <Card tone="sand" className={sticky ? '@min-[900px]:sticky @min-[900px]:top-6' : undefined}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <span className="text-[12px] font-semibold text-[var(--erp-muted)]">{totals.count === 1 ? '1 line' : `${totals.count} lines`}</span>
      </div>
      <TotalsBlock totals={totals} currency={currency} inclusive={inclusive} />
      {children !== undefined && <div className="mt-5 flex flex-col gap-2">{children}</div>}
    </Card>
  );
}

/* ----------------------------------------------------------------- editor */

/** Items to choose from; deliveries and receipts only move goods, so services are left out. */
function itemSearch(goodsOnly: boolean): (q: string) => Promise<Option[]> {
  return async (q) => {
    const r = await op<{ items: ItemRow[] }>('items.list', { q, limit: 30 }, { quiet: true });
    return r.items.filter((i) => !goodsOnly || i.kind !== 'service').map((i) => ({
      id: i.id,
      label: i.name,
      sub: [i.sku, i.kind === 'stock' ? `${fmtQty(i.on_hand)} ${i.unit} on hand` : i.kind === 'service' ? 'Service' : ''].filter((x) => x !== '').join(' · '),
      icon: Package,
      value: i.id,
      data: i,
    }));
  };
}

interface EditorProps {
  type: DocType;
  side: 'sales' | 'purchase';
  currency: string;
  inclusive: boolean;
  taxes: TaxRow[];
  /** Tax a new line starts with (the party's or the company's), or 'none'. */
  defaultTax: string;
  lines: EditLine[];
  setLines: Dispatch<SetStateAction<EditLine[]>>;
  /** Show the description and account of each line. */
  advanced: boolean;
  /** Stock items going out: warn when there is not enough. */
  watchStock: boolean;
  disabled?: boolean | undefined;
}

export function LineEditor(p: EditorProps): React.JSX.Element {
  const { type, side, currency, inclusive, taxes, defaultTax, lines, setLines, advanced, watchStock } = p;
  const priced = pricedOf(type);
  const taxed = taxedOf(type);
  const goodsOnly = type === 'delivery' || type === 'goods_receipt';
  const search = useMemo(() => itemSearch(goodsOnly), [goodsOnly]);
  const box = useRef<HTMLDivElement | null>(null);
  const taxOptions = useMemo(() => new Map(taxes.map((t) => [t.code, { id: t.id, label: t.name, sub: t.code, right: `${t.rate}%`, value: t.code }])), [taxes]);
  const taxScope = side === 'sales' ? 'sales' : 'purchase';

  const update = (key: string, patch: Partial<EditLine>): void => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch, focus: false } : l)));
  const remove = (key: string): void =>
    setLines((ls) => {
      const next = ls.filter((l) => l.key !== key);
      return next.length === 0 ? [newLine(defaultTax)] : next;
    });
  const add = (): void => setLines((ls) => [...ls.map((l) => ({ ...l, focus: false })), newLine(defaultTax, true)]);

  const pickItem = (key: string, o: Option | null): void => {
    const it = (o?.data ?? null) as ItemRow | null;
    if (it === null) {
      update(key, { item: null });
      return;
    }
    const priceText = side === 'sales' ? it.sale_price : it.purchase_price;
    update(key, { item: it, description: it.name, price: priced ? (Number(priceText) > 0 ? priceText : '') : '' });
    // The item's own tax wins over the party's (the server's order).
    if (taxed) {
      op<{ sale_tax: { code: string } | null; purchase_tax: { code: string } | null }>('items.get', { item: it.id }, { quiet: true })
        .then((full) => {
          const own = side === 'sales' ? full.sale_tax : full.purchase_tax;
          if (own !== null && own !== undefined && own.code !== '') setLines((ls) => ls.map((l) => (l.key === key && l.item?.id === it.id ? { ...l, tax: own.code } : l)));
        })
        .catch(() => undefined);
    }
  };

  const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>, index: number): void => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.tagName !== 'INPUT' || t.getAttribute('role') === 'combobox') return;
    e.preventDefault();
    if (index === lines.length - 1) add();
    else {
      const next = box.current?.querySelectorAll<HTMLElement>('[data-line]')[index + 1];
      next?.querySelector<HTMLElement>('button, input')?.focus();
    }
  };

  // Wide screens: item, qty, price, amount and remove on the first row; discount and tax under the item.
  const cols = priced ? '@min-[640px]:grid-cols-[minmax(0,1fr)_92px_128px_108px_36px]' : '@min-[640px]:grid-cols-[minmax(0,1fr)_128px_36px]';
  const label = 'text-[12px] font-semibold text-[var(--erp-muted)] @min-[640px]:hidden';

  return (
    <div ref={box} className="flex flex-col">
      <div className={cn('hidden gap-x-2 px-1 pb-2 text-[12px] font-semibold text-[var(--erp-muted)] @min-[640px]:grid', cols)}>
        <span>{goodsOnly ? 'Item' : 'Item or description'}</span>
        <span className="text-right">Qty</span>
        {priced && <span className="text-right">Unit price</span>}
        {priced && <span className="text-right">{inclusive ? 'Amount with tax' : 'Amount'}</span>}
        <span />
      </div>
      <div className="flex flex-col">
        {lines.map((l, i) => {
          const m = mathOf(l, type, taxes, inclusive, currency);
          const whole = l.item !== null && l.item.kind === 'stock' && !l.item.fractional;
          const badQty = filled(l) && !validQty(l.qty, whole);
          const short = watchStock && l.item !== null && l.item.kind === 'stock' && Number.isFinite(l.item.available) && Number(l.qty) > l.item.available;
          const itemValue: Option | null = l.item !== null ? { id: l.item.id, label: l.item.name, icon: Package, value: l.item.id } : l.description !== '' ? { id: `text-${l.key}`, label: l.description, value: '' } : null;
          return (
            <div
              key={l.key}
              data-line
              onKeyDown={(e) => onRowKey(e, i)}
              className={cn('grid grid-cols-6 items-end gap-2 py-3 @min-[640px]:items-center @min-[640px]:gap-x-2 @min-[640px]:gap-y-2', cols, i > 0 && 'border-t border-[var(--erp-line)]')}
            >
              <div className="col-span-5 min-w-0 @min-[640px]:col-span-1">
                <Picker
                  value={itemValue}
                  onChange={(o) => pickItem(l.key, o)}
                  search={search}
                  icon={Package}
                  size="cell"
                  placeholder={goodsOnly ? 'Search an item' : i === 0 ? 'Search an item, or type a description' : 'Item or description'}
                  ariaLabel={`Line ${i + 1} item`}
                  onCreate={goodsOnly ? undefined : (text) => update(l.key, { item: null, description: text })}
                  createLabel="Use as description"
                  autoOpen={l.focus === true}
                  disabled={p.disabled}
                />
              </div>
              <div className="col-span-1 flex justify-end @min-[640px]:hidden">
                <CircleButton icon={Trash2} label={`Remove line ${i + 1}`} variant="ghost" size={40} onClick={() => remove(l.key)} disabled={p.disabled} />
              </div>
              <label className="col-span-2 flex min-w-0 flex-col gap-1 @min-[640px]:col-span-1">
                <span className={label}>Qty</span>
                <NumberInput value={l.qty} onChange={(v) => update(l.key, { qty: v })} ariaLabel={`Line ${i + 1} quantity`} decimals={whole ? 0 : 3} size="cell" suffix={l.item !== null && l.item.unit !== '' ? l.item.unit.slice(0, 5) : undefined} disabled={p.disabled} placeholder="1" />
              </label>
              {priced && (
                <label className="col-span-2 flex min-w-0 flex-col gap-1 @min-[640px]:col-span-1">
                  <span className={label}>Unit price</span>
                  <MoneyInput value={l.price} onChange={(v) => update(l.key, { price: v })} currency={currency} ariaLabel={`Line ${i + 1} unit price`} size="cell" decimals={4} disabled={p.disabled} />
                </label>
              )}
              {priced && (
                <div className="col-span-2 flex min-w-0 flex-col items-end gap-1 @min-[640px]:col-span-1">
                  <span className={label}>Amount</span>
                  <span className="num flex h-10 items-center truncate text-[14px] font-bold">{m !== null ? amount(inclusive ? m.total : m.net, currency) : ''}</span>
                </div>
              )}
              <div className="hidden justify-end @min-[640px]:flex">
                <CircleButton icon={Trash2} label={`Remove line ${i + 1}`} variant="ghost" size={36} onClick={() => remove(l.key)} disabled={p.disabled} />
              </div>
              {priced && (
                <div className="col-span-6 grid grid-cols-6 gap-2 @min-[640px]:col-span-1 @min-[640px]:flex @min-[640px]:items-center">
                  <label className="col-span-2 flex min-w-0 flex-col gap-1 @min-[640px]:w-[112px] @min-[640px]:shrink-0">
                    <span className={label}>Discount</span>
                    <NumberInput value={l.discount} onChange={(v) => update(l.key, { discount: v })} ariaLabel={`Line ${i + 1} discount percent`} decimals={2} size="cell" placeholder="0" suffix="% off" disabled={p.disabled} />
                  </label>
                  {taxed && (
                    <div className="col-span-4 flex min-w-0 flex-col gap-1 @min-[640px]:w-[200px] @min-[640px]:shrink-0">
                      <span className={label}>Tax</span>
                      <TaxPicker
                        value={l.tax === 'none' || l.tax === '' ? { id: 'none', label: 'No tax', value: 'none' } : (taxOptions.get(l.tax) ?? { id: l.tax, label: l.tax, value: l.tax })}
                        onChange={(o) => update(l.key, { tax: o?.value ?? 'none' })}
                        scope={taxScope}
                        size="cell"
                        disabled={p.disabled}
                      />
                    </div>
                  )}
                  {m !== null && m.tax > 0 && !inclusive && <span className="num hidden truncate text-[12px] text-[var(--erp-muted)] @min-[640px]:inline">+ {amount(m.tax, currency)} tax</span>}
                </div>
              )}
              {advanced && filled(l) && (
                <div className="col-span-6 grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2 @min-[640px]:col-span-full">
                  <input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} placeholder="Description on the document" className={cellInput} disabled={p.disabled} />
                  {priced && (
                    <AccountPicker
                      value={l.account}
                      onChange={(o) => update(l.key, { account: o })}
                      types={side === 'sales' ? ['income'] : ['expense', 'asset']}
                      postable
                      size="cell"
                      clearable
                      placeholder={side === 'sales' ? 'Income account (from the item)' : 'Expense account (from the item)'}
                      disabled={p.disabled}
                    />
                  )}
                </div>
              )}
              {(badQty || short) && (
                <p className={cn('col-span-6 flex items-center gap-1.5 text-[12px] font-semibold @min-[640px]:col-span-full', badQty ? 'text-[var(--erp-red-text)]' : 'text-[var(--erp-amber-text)]')}>
                  <AlertTriangle size={13} aria-hidden />
                  {badQty ? (whole ? 'Use a whole quantity above 0' : 'Use a quantity above 0') : `Only ${fmtQty(l.item?.available ?? 0)} ${l.item?.unit ?? ''} available`}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <PillButton variant="soft" size="sm" icon={Plus} onClick={add} disabled={p.disabled} title="Add a line (Enter in the last line)">
          Add a line
        </PillButton>
      </div>
    </div>
  );
}

/**
 * A line on the sale: its quantity (or weight), price, discount, options,
 * note, and for a returned item whether it goes back on the shelf. A price
 * change or a discount above the person's limit asks for a manager's PIN.
 */
import { useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import type { LineChange } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { qty as qtyText, toMinor } from '../../lib/format.ts';
import type { OrderLine } from '../../lib/types.ts';
import { MoneyField } from '../common.tsx';
import { Stepper } from '../pads.tsx';
import { Button, Field, Modal, Segmented, Toggle, inputCls } from '../ui.tsx';
import { ItemDialog } from './ItemDialog.tsx';
import type { ItemChoice } from './ItemDialog.tsx';

const QUICK = [5, 10, 15, 20, 50];

export function LineDialog({ line, onClose, onSave, onRemove }: { line: OrderLine | null; onClose: () => void; onSave: (c: LineChange) => Promise<boolean>; onRemove: (line: string) => Promise<boolean> }): React.JSX.Element | null {
  const { money, productById } = useStore();
  const [count, setCount] = useState(1);
  const [weight, setWeight] = useState('');
  const [price, setPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [dKind, setDKind] = useState<'none' | 'percent' | 'amount'>('none');
  const [dValue, setDValue] = useState('');
  const [dReason, setDReason] = useState('');
  const [note, setNote] = useState('');
  const [restock, setRestock] = useState(true);
  const [name, setName] = useState('');
  const [options, setOptions] = useState(false);
  const [busy, setBusy] = useState(false);

  const product = line !== null && line.product !== '' ? (productById.get(line.product) ?? null) : null;
  const isReturn = line !== null && (line.return_of !== '' || line.qty < 0);
  const byWeight = product?.sold_by === 'weight' || (line !== null && !Number.isInteger(line.qty));

  useEffect(() => {
    if (line === null) return;
    setCount(Math.abs(line.qty));
    setWeight(qtyText(Math.abs(line.qty)));
    setPrice(money.plain(line.unit_price));
    setPriceReason(line.price_override?.reason ?? '');
    const d = line.line_discount;
    setDKind(d === null ? 'none' : d.kind);
    setDValue(d === null ? '' : d.kind === 'percent' ? String(d.value) : money.plain(d.value));
    setDReason(d?.reason ?? '');
    setNote(line.note);
    setRestock(line.restock);
    setName(line.name);
  }, [line, money]);

  if (line === null) return null;

  const canPrice = !isReturn && line.kind !== 'gift_card';
  const canDiscount = !isReturn && line.kind !== 'gift_card';
  const canQty = line.kind !== 'gift_card';
  const sign = isReturn ? -1 : 1;
  const newQty = byWeight ? Number(weight.replace(',', '.')) : count;
  const qtyOk = Number.isFinite(newQty) && newQty > 0 && Math.round(newQty * 1000) === newQty * 1000;
  const priceMinor = toMinor(price, money.digits);
  const priceOk = !canPrice || (priceMinor !== null && priceMinor >= 0);
  const dNum = dKind === 'percent' ? Number(dValue.replace(',', '.')) : dKind === 'amount' ? toMinor(dValue, money.digits) : null;
  const dOk = dKind === 'none' || (dNum !== null && Number.isFinite(dNum) && dNum > 0 && (dKind !== 'percent' || dNum <= 100));

  const build = (): LineChange => {
    const c: LineChange = { line: line.id };
    if (canQty && qtyOk && sign * newQty !== line.qty) c.qty = sign * newQty;
    if (canPrice && priceMinor !== null && priceMinor !== line.unit_price) {
      c.price = money.plain(priceMinor);
      if (priceReason.trim() !== '') c.reason = priceReason.trim();
    }
    if (canDiscount) {
      const d = line.line_discount;
      if (dKind === 'none' && d !== null) c.discount = null;
      else if (dKind !== 'none' && dNum !== null) {
        const value = dKind === 'percent' ? dNum : money.plain(dNum);
        const same = d !== null && d.kind === dKind && (dKind === 'percent' ? d.value === dNum : d.value === dNum) && d.reason === dReason.trim();
        if (!same) c.discount = { kind: dKind, value, reason: dReason.trim() };
      }
    }
    if (note.trim() !== line.note) c.note = note.trim();
    if (isReturn && restock !== line.restock) c.restock = restock;
    if (line.kind === 'custom' && name.trim() !== '' && name.trim() !== line.name) c.name = name.trim();
    return c;
  };

  const change = build();
  const dirty = Object.keys(change).length > 1;
  const ok = qtyOk && priceOk && dOk;

  const save = async (): Promise<void> => {
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    const done = await onSave(change);
    setBusy(false);
    if (done) onClose();
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    const done = await onRemove(line.id);
    setBusy(false);
    if (done) onClose();
  };

  const saveOptions = async (c: ItemChoice): Promise<boolean> => onSave({ line: line.id, modifiers: c.modifiers, qty: c.qty !== Math.abs(line.qty) ? c.qty : undefined, note: c.note !== line.note ? c.note : undefined });

  const title = (isReturn ? 'Return: ' : '') + line.name + (line.variant_title !== '' ? ' (' + line.variant_title + ')' : '');

  return (
    <>
      <Modal touch
        open={!options}
        onClose={onClose}
        title={title}
        description={line.sku !== '' ? 'SKU ' + line.sku : undefined}
        wide
        footer={
          <>
            <Button variant="danger" icon={Trash2} className="mr-auto" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            {canQty &&
              (byWeight ? (
                <Field label={(isReturn ? 'Returning' : 'Weight') + (line.unit !== '' ? ' (' + line.unit + ')' : '')}>
                  <input className={cn(inputCls, 'num h-9 w-32 text-right')} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </Field>
              ) : (
                <Field group label={isReturn ? 'Returning' : 'Quantity'}>
                  <Stepper value={count} onChange={setCount} label="Quantity" min={1} />
                </Field>
              ))}
            {canPrice && (
              <Field label={line.kind === 'custom' ? 'Amount' : 'Price each'}>
                <MoneyField value={price} onChange={setPrice} money={money} label="Price" className="w-36 [&_input]:h-9" />
              </Field>
            )}
            {canPrice && line.kind === 'item' && priceMinor !== null && priceMinor !== line.list_price && (
              <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                <Field label="Why the price changed">
                  <input className={cn(inputCls, 'h-9')} value={priceReason} onChange={(e) => setPriceReason(e.target.value)} maxLength={200} placeholder="Price match, damaged, ..." />
                </Field>
              </div>
            )}
          </div>
          {canPrice && line.kind === 'item' && line.list_price !== (priceMinor ?? line.list_price) && (
            <p className="-mt-2 text-[12px] text-[var(--ps-muted)]">
              List price {money.fmt(line.list_price)}.{' '}
              <button type="button" className="font-semibold text-[var(--ps-ink-2)] underline-offset-4 hover:underline" onClick={() => setPrice(money.plain(line.list_price))}>
                Use the list price
              </button>
            </p>
          )}
          {line.kind === 'custom' && (
            <Field label="Name on the receipt">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
          )}

          {canDiscount && (
            <section className="flex flex-col gap-2 border-t border-[var(--ps-hair)] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">Discount on this item</h3>
                <Segmented
                  label="Discount kind"
                  size="sm"
                  value={dKind}
                  onChange={(k) => {
                    setDKind(k);
                    setDValue('');
                  }}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'percent', label: 'Percent' },
                    { value: 'amount', label: 'Amount' },
                  ]}
                />
              </div>
              {dKind === 'percent' && (
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map((pct) => (
                    <button key={pct} type="button" aria-pressed={dValue === String(pct)} onClick={() => setDValue(String(pct))} className={cn('num h-9 w-14 rounded-[var(--ps-r)] border text-[13px] font-semibold', dValue === String(pct) ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}>
                      {pct}%
                    </button>
                  ))}
                  <input aria-label="Percent" className={cn(inputCls, 'num h-9 w-20 text-right')} inputMode="decimal" value={dValue} onChange={(e) => setDValue(e.target.value)} placeholder="%" />
                </div>
              )}
              {dKind === 'amount' && <MoneyField value={dValue} onChange={setDValue} money={money} label="Discount amount" className="w-36 [&_input]:h-9" />}
              {dKind !== 'none' && <input className={inputCls} value={dReason} onChange={(e) => setDReason(e.target.value)} maxLength={200} placeholder="Reason (shown on the receipt)" />}
              {line.auto_discount !== null && dKind === 'none' && (
                <p className="text-[12px] text-[var(--ps-muted)]">
                  {line.auto_discount.name}: {money.fmt(-line.auto_discount.amount)} applies by itself.
                </p>
              )}
            </section>
          )}

          {product !== null && product.modifier_groups.length > 0 && !isReturn && (
            <section className="flex items-center justify-between gap-2 border-t border-[var(--ps-hair)] pt-3">
              <div className="min-w-0">
                <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">Options</h3>
                <p className="truncate text-[13px]">{line.modifiers.length > 0 ? line.modifiers.map((m) => m.name).join(', ') : 'None chosen'}</p>
              </div>
              <Button onClick={() => setOptions(true)}>Change</Button>
            </section>
          )}

          {isReturn && (
            <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
              <span>
                <span className="block text-[13px] font-semibold">Put back in stock</span>
                <span className="block text-[12px] text-[var(--ps-muted)]">Off for damaged items that cannot be sold again.</span>
              </span>
              <Toggle checked={restock} onChange={setRestock} label="Put back in stock" />
            </label>
          )}

          <Field label="Note">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="For the kitchen or the receipt" />
          </Field>
        </div>
      </Modal>
      {options && product !== null && (
        <ItemDialog
          product={product}
          initialVariant={product.variants.find((v) => v.id === line.variant) ?? null}
          initial={{ qty: Math.abs(line.qty), modifiers: line.modifiers.map((m) => m.id), note: line.note }}
          mode="edit"
          onClose={() => setOptions(false)}
          onDone={async (c) => {
            const done = await saveOptions(c);
            if (done) onClose();
            return done;
          }}
        />
      )}
    </>
  );
}

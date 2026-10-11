/**
 * Returns and exchanges. With a receipt: find the sale (scan or type the
 * receipt number, or pick a recent one), choose what comes back and whether
 * it goes back on the shelf. The items join the sale on screen as negative
 * lines, so adding new items to it makes an exchange and only the
 * difference is paid or refunded. Without a receipt: choose the product;
 * that needs someone allowed to do returns.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RotateCcw, Search } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/context.tsx';
import { qty as qtyText, when } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useScanner } from '../../lib/scanner.ts';
import type { Order, Product, Variant } from '../../lib/types.ts';
import { SearchField, useDebounced } from '../common.tsx';
import { Stepper } from '../pads.tsx';
import { Button, Modal, Segmented, Spinner, Toggle, inputCls } from '../ui.tsx';
import { useTicket } from './ticket.tsx';

interface Pick {
  qty: number;
  restock: boolean;
}

function WithReceipt({ from, onDone }: { from: string; onDone: () => void }): React.JSX.Element {
  const { money } = useStore();
  const ticket = useTicket();
  const [number, setNumber] = useState('');
  const term = useDebounced(number, 250);
  const [sale, setSale] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  const recent = useLive(() => api.orders({ status: 'paid', q: term.trim() || undefined, limit: 12 }), ['orders'], [term]);

  const open = async (ref: string): Promise<void> => {
    setLoading(true);
    try {
      const r = await api.order(ref.trim());
      if (r.order.status !== 'paid') {
        setSale(null);
        return;
      }
      setSale(r.order);
      setPicks({});
    } catch {
      // Shown by the transport.
    } finally {
      setLoading(false);
    }
  };

  useScanner((code) => void open(code), sale === null);

  // Started from a receipt: show that sale straight away.
  useEffect(() => {
    if (from !== '') void open(from);
    // Once per receipt handed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  if (sale !== null) {
    const lines = sale.lines.filter((l) => l.qty > 0 && l.kind !== 'gift_card' && l.return_of === '');
    const left = (id: string): number => sale.returnable?.[id] ?? 0;
    const chosen = Object.entries(picks).filter(([, p]) => p.qty > 0);
    const allLeft = lines.every((l) => left(l.id) <= 0);
    const go = async (all: boolean): Promise<void> => {
      setBusy(true);
      const ok = await ticket.startReturn(sale.id, all ? { all: true } : { lines: chosen.map(([line, p]) => ({ line, qty: p.qty, restock: p.restock })) });
      setBusy(false);
      if (ok) onDone();
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => setSale(null)}>
            Other sale
          </Button>
          <span className="min-w-0 flex-1 truncate text-right text-[12px] text-[var(--ps-muted)]">
            Receipt {sale.number} &middot; {when(sale.paid_at)} &middot; {money.fmt(sale.total)}
            {sale.customer !== null ? ' · ' + sale.customer.name : ''}
          </span>
        </div>
        {allLeft ? (
          <p className="rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-4 text-center text-[13px] text-[var(--ps-ink-2)]">Everything on this sale was already returned.</p>
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)] rounded-[var(--ps-r-md)] border border-[var(--ps-line)]">
            {lines.map((l) => {
              const max = left(l.id);
              const p = picks[l.id] ?? { qty: 0, restock: true };
              const whole = Number.isInteger(l.qty);
              const each = l.qty !== 0 ? Math.round(l.total / l.qty) : 0;
              return (
                <li key={l.id} className={cn('flex flex-wrap items-center gap-3 px-3 py-2', max <= 0 && 'bg-[var(--ps-row)]')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {l.name}
                      {l.variant_title !== '' ? ' · ' + l.variant_title : ''}
                    </span>
                    <span className="block text-[12px] text-[var(--ps-muted)]">
                      Bought {qtyText(l.qty)}
                      {l.unit !== '' ? ' ' + l.unit : ''} &middot; paid {money.fmt(l.total)}
                      {max < l.qty ? ' · ' + qtyText(l.qty - max) + ' already back' : ''}
                    </span>
                  </span>
                  {max > 0 ? (
                    <>
                      {whole ? (
                        <Stepper value={p.qty} min={0} max={max} onChange={(n) => setPicks((x) => ({ ...x, [l.id]: { ...p, qty: n } }))} label={'Return ' + l.name} />
                      ) : (
                        <Button size="sm" variant={p.qty > 0 ? 'primary' : 'secondary'} onClick={() => setPicks((x) => ({ ...x, [l.id]: { ...p, qty: p.qty > 0 ? 0 : max } }))}>
                          {p.qty > 0 ? 'Returning ' + qtyText(max) : 'Return ' + qtyText(max) + (l.unit !== '' ? ' ' + l.unit : '')}
                        </Button>
                      )}
                      {p.qty > 0 && (
                        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ps-ink-2)]">
                          <Toggle checked={p.restock} onChange={(v) => setPicks((x) => ({ ...x, [l.id]: { ...p, restock: v } }))} label="Back in stock" />
                          Restock
                        </label>
                      )}
                      {p.qty > 0 && <span className="num w-20 text-right text-[13px] font-semibold text-[var(--ps-red-text)]">{money.fmt(-each * p.qty)}</span>}
                    </>
                  ) : (
                    <span className="text-[12px] font-semibold text-[var(--ps-muted)]">Returned</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={allLeft || busy} onClick={() => void go(true)}>
            Return everything
          </Button>
          <Button variant="primary" icon={RotateCcw} loading={busy} disabled={chosen.length === 0} onClick={() => void go(false)}>
            Return {chosen.length > 0 ? chosen.reduce((a, [, p]) => a + p.qty, 0) + ' selected' : 'selected'}
          </Button>
        </div>
      </div>
    );
  }

  const rows = recent.data?.orders ?? [];
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (number.trim() !== '') void open(number);
        }}
      >
        <input autoFocus className={cn(inputCls, 'h-10 flex-1 text-[14px]')} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Receipt number, customer or ticket name" aria-label="Receipt number" />
        <Button type="submit" size="lg" icon={Search} className="h-10" loading={loading} disabled={number.trim() === ''}>
          Find
        </Button>
      </form>
      <div>
        <h3 className="mb-1 text-[12px] font-bold text-[var(--ps-ink-2)]">{term.trim() === '' ? 'Recent sales' : 'Matching sales'}</h3>
        {recent.loading && rows.length === 0 ? (
          <div className="flex justify-center py-4">
            <Spinner size={16} className="text-[var(--ps-muted)]" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--ps-muted)]">No paid sales found</p>
        ) : (
          <ul className="-mx-1 max-h-[40vh] overflow-y-auto">
            {rows.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => void open(o.id)} className="flex w-full items-center gap-3 rounded-[var(--ps-r)] px-2 py-1.5 text-left hover:bg-[var(--ps-row)]">
                  <span className="num w-16 shrink-0 text-[13px] font-bold">{o.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ps-muted)]">
                    {when(o.paid_at)}
                    {o.customer !== null ? ' · ' + o.customer.name : ''}
                    {o.return_status !== 'none' ? ' · ' + (o.return_status === 'full' ? 'returned' : 'part returned') : ''}
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold">{money.fmt(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WithoutReceipt({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { money, catalog } = useStore();
  const ticket = useTicket();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ product: Product; variant: Variant } | null>(null);
  const [count, setCount] = useState(1);
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out: { product: Product; variant: Variant }[] = [];
    for (const p of catalog?.products ?? []) {
      for (const v of p.variants) {
        if (v.archived) continue;
        if (t === '' || p.name.toLowerCase().includes(t) || v.sku.toLowerCase().includes(t) || v.barcode.toLowerCase() === t || v.title.toLowerCase().includes(t)) out.push({ product: p, variant: v });
      }
    }
    return out.slice(0, 60);
  }, [catalog, q]);

  useScanner((code) => {
    const hit = rows.find((r) => r.variant.barcode.toLowerCase() === code.toLowerCase() || r.variant.sku.toLowerCase() === code.toLowerCase());
    if (hit !== undefined) setPick(hit);
    else setQ(code);
  }, pick === null);

  const go = async (): Promise<void> => {
    if (pick === null) return;
    setBusy(true);
    let o = await ticket.add({ variant: pick.variant.id, qty: -count });
    if (o !== null && !restock) {
      // The newest returned line of this variant is the one just added.
      const line = [...o.lines].reverse().find((l) => l.variant === pick.variant.id && l.qty < 0 && l.return_of === '');
      if (line !== undefined) o = await ticket.changeLine({ line: line.id, restock: false });
    }
    setBusy(false);
    if (o !== null) onDone();
  };

  if (pick !== null) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => setPick(null)}>
            Other product
          </Button>
        </div>
        <div className="rounded-[var(--ps-r-md)] border border-[var(--ps-line)] px-3 py-2.5">
          <p className="text-[13px] font-semibold">
            {pick.product.name}
            {pick.variant.title !== '' ? ' · ' + pick.variant.title : ''}
          </p>
          <p className="num text-[12px] text-[var(--ps-muted)]">{money.fmt(pick.variant.price)} each, refunded at the current price</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Stepper value={count} onChange={setCount} min={1} label="Quantity" />
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <Toggle checked={restock} onChange={setRestock} label="Back in stock" />
            Back in stock
          </label>
          <span className="num ml-auto text-[15px] font-bold text-[var(--ps-red-text)]">{money.fmt(-pick.variant.price * count)}</span>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" icon={RotateCcw} loading={busy} onClick={() => void go()}>
            Return {count}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchField value={q} onChange={setQ} placeholder="Find the product" autoFocus className="[&_input]:h-9" />
      <ul className="-mx-1 max-h-[44vh] overflow-y-auto">
        {rows.map((r) => (
          <li key={r.variant.id}>
            <button type="button" onClick={() => setPick(r)} className="flex w-full items-center gap-3 rounded-[var(--ps-r)] px-2 py-1.5 text-left hover:bg-[var(--ps-row)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {r.product.name}
                  {r.variant.title !== '' ? ' · ' + r.variant.title : ''}
                </span>
                {r.variant.sku !== '' && <span className="block truncate text-[12px] text-[var(--ps-muted)]">SKU {r.variant.sku}</span>}
              </span>
              <span className="num shrink-0 text-[13px] font-semibold">{money.fmt(r.variant.price)}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-center text-[13px] text-[var(--ps-muted)]">Nothing matches</li>}
      </ul>
    </div>
  );
}

export function ReturnDialog({ open, onClose, from = '' }: { open: boolean; onClose: () => void; from?: string }): React.JSX.Element {
  const [mode, setMode] = useState<'receipt' | 'none'>('receipt');
  useEffect(() => {
    if (open) setMode('receipt');
  }, [open]);
  return (
    <Modal touch open={open} onClose={onClose} title="Return or exchange" description="Returned items join the sale on screen; add new items to it for an exchange." xl>
      <div className="flex flex-col gap-3">
        <Segmented
          label="Receipt"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'receipt', label: 'With a receipt' },
            { value: 'none', label: 'Without a receipt' },
          ]}
          className="self-start"
        />
        {open && (mode === 'receipt' ? <WithReceipt from={from} onDone={onClose} /> : <WithoutReceipt onDone={onClose} />)}
      </div>
    </Modal>
  );
}

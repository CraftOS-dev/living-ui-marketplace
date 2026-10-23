/**
 * Returns, in a dialog over the tiles: find the receipt (scan its barcode,
 * type its number, or pick it from today's sales), choose what comes back
 * (each line up to what is still returnable, everything picked when the
 * receipt has one line), whether it goes back to stock, and add it to the
 * sale. Adding new items to the same sale makes it an exchange; the pay
 * button then collects or refunds the difference. A return without a
 * receipt picks the product instead (a manager approves it at payment).
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Minus, PackageSearch, Plus, ReceiptText, RotateCcw, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { OpError, api } from '../../lib/api.ts';
import { cartStore, originOf } from '../../lib/cart.ts';
import { useApp } from '../../lib/context.tsx';
import { money, time } from '../../lib/format.ts';
import { useScanner } from '../../lib/scanner.ts';
import type { CatalogProduct, Refundable, SaleListItem } from '../../lib/types.ts';
import { Badge, Button, Empty, IconButton, Modal, SearchField, Spinner, TextLink, Toggle } from '../ui.tsx';

/** A white row on the dialog. */
const row = 'rounded-[18px] bg-[var(--ps-card)]';

function Qty({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }): React.JSX.Element {
  const btn = 'ps-press flex size-10 items-center justify-center rounded-full hover:bg-[var(--ps-row-hover)] disabled:opacity-40';
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--ps-row)] p-0.5">
      <button type="button" aria-label="One less" disabled={value <= 0} onClick={() => onChange(value - 1)} className={btn}>
        <Minus size={16} aria-hidden />
      </button>
      <span className="num w-12 text-center text-[14px] font-bold">
        {value}/{max}
      </span>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

function BlindReturn({ onBack, onAdded }: { onBack: () => void; onAdded: () => void }): React.JSX.Element {
  const { catalog, currency, exp } = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CatalogProduct | null>(null);
  const [variant, setVariant] = useState('');
  const [qty, setQty] = useState(1);
  const [restock, setRestock] = useState(true);
  const list = (catalog?.products ?? []).filter((p) => q.trim() === '' || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.sku.toLowerCase() === q.trim().toLowerCase()).slice(0, 40);
  return (
    <div className="flex flex-col gap-3">
      <TextLink onClick={onBack} className="self-start">
        <ArrowLeft size={14} aria-hidden /> Find the receipt instead
      </TextLink>
      {picked === null ? (
        <>
          <SearchField value={q} onChange={setQ} placeholder="The product coming back" label="Find the product" autoFocus tone="card" />
          <ul className="flex flex-col gap-2">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(p);
                    setVariant(p.variants.length === 1 ? (p.variants[0]?.id ?? '') : '');
                  }}
                  className={cn(row, 'ps-press flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--ps-row)]')}
                >
                  <span className="truncate text-[14px] font-semibold">{p.name}</span>
                  <span className="num text-[13px] text-[var(--ps-muted)]">{money(p.price, currency, exp)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="ps-on-card flex flex-col gap-4 rounded-[22px] bg-[var(--ps-card)] p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-bold">{picked.name}</span>
            <IconButton icon={X} label="Pick another product" variant="secondary" size={36} onClick={() => setPicked(null)} />
          </div>
          {picked.variants.length > 0 && (
            <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-2">
              {picked.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={variant === v.id}
                  onClick={() => setVariant(v.id)}
                  className={cn('ps-press h-10 rounded-full px-4 text-[13px] font-bold', variant === v.id ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
                >
                  {v.name} · {money(v.price, currency, exp)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Qty value={qty} max={99} onChange={(v) => setQty(Math.max(1, v))} />
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Toggle checked={restock} onChange={setRestock} label="Back to stock" /> Back to stock
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            icon={RotateCcw}
            dot
            disabled={picked.variants.length > 0 && variant === ''}
            onClick={() => {
              cartStore.addBlindReturn(picked.id, variant, qty, restock);
              onAdded();
            }}
          >
            Add the return
          </Button>
        </div>
      )}
    </div>
  );
}

export function ReturnPanel({ initialSale, onClose }: { initialSale: string; onClose: () => void }): React.JSX.Element {
  const { currency, exp, settings } = useApp();
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<SaleListItem[] | null>(null);
  const [sale, setSale] = useState<Refundable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [blind, setBlind] = useState(false);

  const open = useCallback(async (ref: string): Promise<void> => {
    const r = ref.trim();
    if (r === '') return;
    setLoading(true);
    setError('');
    try {
      const res = await api.refundable(r);
      setSale(res);
      const open = res.lines.filter((l) => l.left > 0);
      setPick(open.length === 1 && open[0] !== undefined ? { [open[0].id]: open[0].left } : {});
    } catch (err) {
      setError(err instanceof OpError && err.code === 'not_found' ? `No receipt "${r}"` : err instanceof OpError ? err.message : 'Could not open the receipt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialSale !== '') void open(initialSale);
  }, [initialSale, open]);

  useEffect(() => {
    api
      .sales({ from: settings?.today ?? '', to: settings?.today ?? '', kind: 'all', limit: 30 })
      .then((r) => setRecent(r.sales.filter((s) => s.kind !== 'refund')))
      .catch(() => setRecent([]));
  }, [settings?.today]);

  // A receipt's barcode scanned here opens it.
  useScanner((code) => void open(code), sale === null && !blind);

  const chosen = sale === null ? [] : sale.lines.filter((l) => (pick[l.id] ?? 0) > 0);
  const add = (): void => {
    if (sale === null) return;
    for (const l of chosen) cartStore.addReturn(originOf(sale.sale.id, sale.sale.number, l), pick[l.id] ?? 0, restock);
    toast.success(`${chosen.reduce((s, l) => s + (pick[l.id] ?? 0), 0)} to return from ${sale.sale.number}`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} wide title="Return items" description={sale !== null ? `${sale.sale.number} · ${time(sale.sale.created)}` : 'Scan the receipt or find the sale'}>
      {blind ? (
        <BlindReturn onBack={() => setBlind(false)} onAdded={onClose} />
      ) : sale === null ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <SearchField value={q} onChange={setQ} placeholder="Receipt number, e.g. R1-000123" label="Receipt number" autoFocus tone="card" className="flex-1" onEnter={(v) => void open(v)} />
            <Button variant="primary" disabled={q.trim() === '' || loading} onClick={() => void open(q)}>
              Open
            </Button>
          </div>
          {error !== '' && (
            <p className="px-1 text-[13px] font-semibold text-[var(--ps-red-text)]" role="alert">
              {error}
            </p>
          )}
          {loading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <h3 className="px-1 text-[15px] font-bold">Today</h3>
            <Button variant="light" icon={PackageSearch} onClick={() => setBlind(true)}>
              No receipt
            </Button>
          </div>
          {recent === null ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : recent.length === 0 ? (
            <div className={row}>
              <Empty icon={ReceiptText} title="No sales today" compact />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void open(s.number)} className={cn(row, 'ps-press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--ps-row)]')}>
                    <span className="num w-12 shrink-0 text-[13px] text-[var(--ps-muted)]">{time(s.created)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{s.number}</span>
                      <span className="block truncate text-[12px] text-[var(--ps-muted)]">{[s.name, s.customer_name, s.items === 1 ? '1 item' : `${s.items} items`].filter((x) => x !== '').join(' · ')}</span>
                    </span>
                    <span className="num text-[14px] font-bold">{money(s.collected, currency, exp)}</span>
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <TextLink onClick={() => setSale(null)} className="self-start">
            <ArrowLeft size={14} aria-hidden /> Another receipt
          </TextLink>
          {sale.sale.training && <Badge tone="warn">A training sale: only returnable in training mode.</Badge>}
          <ul className="flex flex-col gap-2">
            {sale.lines.map((l) => (
              <li key={l.id} className={cn(row, 'flex flex-wrap items-center gap-3 px-4 py-3')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">
                    {l.name}
                    {l.variant_name !== '' ? ` ${l.variant_name}` : ''}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--ps-muted)]">
                    {l.modifiers.map((m) => m.name).join(', ') || `${l.qty} x ${money(l.unit, currency, exp)}`}
                    {l.returned > 0 ? ` · ${l.returned} returned` : ''}
                  </span>
                </span>
                {l.left > 0 ? <Qty value={pick[l.id] ?? 0} max={l.left} onChange={(v) => setPick({ ...pick, [l.id]: v })} /> : <Badge tone="neutral">All returned</Badge>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Toggle checked={restock} onChange={setRestock} label="Back to stock" /> Back to stock
            </span>
            <span className="flex-1" />
            <Button
              variant="light"
              onClick={() => {
                const all: Record<string, number> = {};
                for (const l of sale.lines) if (l.left > 0) all[l.id] = l.left;
                setPick(all);
              }}
            >
              Everything
            </Button>
            <Button variant="primary" icon={RotateCcw} dot disabled={chosen.length === 0} onClick={add}>
              Add to the sale
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

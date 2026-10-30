/**
 * The product forms and the small pieces the Products and Product pages
 * share: the picture thumb, receiving or counting stock, a SKU's stock
 * ledger, asking your AI agent to write listings, marking a listing live,
 * and the picture upload.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, History, Package, Store } from 'lucide-react';
import { ClientResponseError } from 'pocketbase';
import { cn, getPbClient } from '../../kit/index.ts';
import { errMessage, op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { useStore } from '../lib/store.tsx';
import { dayTime, num, plural } from '../lib/format.ts';
import { notify } from '../lib/toast.tsx';
import type { Listing, ProductDetail, StockMove, TaskBrief } from '../lib/types.ts';
import { openAddShop } from './Shell.tsx';
import { PlatformMark, PLATFORM_NAME } from './PlatformMark.tsx';
import { ListingPill } from './badges.tsx';
import { Button, Checkbox, Dialog, Empty, Field, Segmented, Skeleton, TextArea, TextInput, Tile } from './ui.tsx';

/* ---------------------------------------------------------------- helpers */

/** A server file path ("/api/files/...") as a full link to the app's server. */
export function fileUrl(path: string): string {
  if (path === '' || /^(https?:|blob:|data:)/.test(path)) return path;
  return getPbClient().pb.buildURL(path);
}

/** A typed amount: undefined when blank, null when it is not a number. */
export function parseAmount(s: string): number | null | undefined {
  const t = s.trim().split(',').join('');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const digitsCache = new Map<string, number>();

function digitsOf(cur: string): number {
  let d = digitsCache.get(cur);
  if (d === undefined) {
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'USD' }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      d = 2;
    }
    digitsCache.set(cur, d);
  }
  return d;
}

/** An amount as plain text for an input ("12.50", "5000"); '' for zero when `blankZero`. */
export function amountText(v: number, cur: string, blankZero = false): string {
  if (blankZero && v === 0) return '';
  return v.toFixed(digitsOf(cur));
}

/** The picture of a product on a soft tile, or a package icon when it has none. */
export function ProductThumb({ src, size = 48, className }: { src: string; size?: number; className?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const show = src !== '' && !broken;
  return (
    <span style={{ width: size, height: size }} className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[var(--so-tile)] text-[var(--so-muted)]', className)}>
      {show ? <img src={fileUrl(src)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" /> : <Package size={Math.round(size * 0.42)} strokeWidth={1.8} aria-hidden />}
    </span>
  );
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Upload pictures to a product in one call (several files under "images"). `quiet` leaves telling why to the caller. */
export async function addImages(product: string, files: File[], opts: { quiet?: boolean } = {}): Promise<void> {
  const fd = new FormData();
  fd.append('product', product);
  for (const f of files) fd.append('images', f, f.name);
  try {
    await getPbClient().pb.send('/api/ops/products/add-images', { method: 'POST', body: fd, requestKey: null });
  } catch (err) {
    let message = errMessage(err);
    if (err instanceof ClientResponseError) {
      const r = err.response as { message?: unknown };
      message = err.status === 0 ? 'Cannot reach the app right now. Try again in a moment.' : typeof r.message === 'string' && r.message !== '' ? r.message : err.message;
    }
    if (opts.quiet !== true) notify.error(message);
    throw err;
  }
}

/* ------------------------------------------------------------------ stock */

export type StockMode = 'received' | 'count' | 'damage' | 'return' | 'adjust';

/** The SKU a stock dialog works on. */
export interface StockTarget {
  variant: string;
  sku: string;
  option: string;
  title: string;
  on_hand: number;
  reserved: number;
}

const MODES: { key: StockMode; label: string }[] = [
  { key: 'received', label: 'Received' },
  { key: 'count', label: 'Count' },
  { key: 'damage', label: 'Damaged' },
  { key: 'return', label: 'Returned' },
  { key: 'adjust', label: 'Adjust' },
];

const MODE_TITLE: Record<StockMode, string> = { received: 'Stock received', count: 'Count stock', damage: 'Damaged stock', return: 'Returned stock', adjust: 'Adjust stock' };

/** Receive, count, write off or correct a SKU's stock; shows the on hand it leads to. */
export function StockDialog({ target, mode, onClose }: { target: StockTarget | null; mode: StockMode; onClose: () => void }): React.JSX.Element | null {
  if (target === null) return null;
  return <StockForm key={target.variant + ':' + mode} target={target} mode={mode} onClose={onClose} />;
}

function StockForm({ target, mode, onClose }: { target: StockTarget; mode: StockMode; onClose: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<StockMode>(mode);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const n = parseAmount(qty);
  let delta: number | null = null;
  if (typeof n === 'number' && Number.isInteger(n)) {
    if (kind === 'count' && n >= 0) delta = n - target.on_hand;
    else if (kind === 'adjust' && n !== 0) delta = n;
    else if ((kind === 'received' || kind === 'return' || kind === 'damage') && n > 0) delta = kind === 'damage' ? -n : n;
  }
  const after = target.on_hand + (delta ?? 0);
  const typedBad = qty.trim() !== '' && delta === null;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (delta === null || typeof n !== 'number' || busy) return;
    setBusy(true);
    try {
      if (kind === 'count') {
        await op('stock.count', { variant: target.variant, on_hand: n, note: note.trim() || undefined });
      } else {
        await op('stock.adjust', {
          variant: target.variant,
          qty: delta,
          reason: kind,
          ref: kind === 'received' ? note.trim() || undefined : undefined,
          note: kind !== 'received' ? note.trim() || undefined : undefined,
        });
      }
      changed('variants', 'stock_moves', 'products', 'listings');
      notify.info(kind === 'count' ? 'Count saved' : kind === 'received' ? 'Received ' + num(n) : kind === 'return' ? 'Returned ' + num(n) : kind === 'damage' ? 'Removed ' + num(n) : 'Stock changed');
      onClose();
    } catch {
      /* op showed why */
    } finally {
      setBusy(false);
    }
  };

  const qtyLabel = kind === 'count' ? 'Counted on hand' : kind === 'adjust' ? 'Change' : 'Quantity';
  const placeholder = kind === 'count' ? String(target.on_hand) : kind === 'adjust' ? 'e.g. -2 or 5' : '0';
  return (
    <Dialog
      open
      onClose={onClose}
      title={MODE_TITLE[kind]}
      subtitle={target.title + (target.option !== '' ? ', ' + target.option : '') + ' (' + target.sku + ')'}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-stock" loading={busy} disabled={delta === null}>
            Save
          </Button>
        </>
      }
    >
      <form id="so-stock" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Segmented items={MODES} value={kind} onChange={setKind} className="flex-wrap" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={qtyLabel} {...(typedBad ? { error: kind === 'adjust' ? 'A whole number, not 0' : kind === 'count' ? 'A whole number' : 'A whole number above 0' } : {})}>
            <TextInput autoFocus inputMode={kind === 'adjust' ? 'text' : 'numeric'} placeholder={placeholder} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label={kind === 'received' ? 'Reference' : 'Note'} hint="Optional">
            <TextInput placeholder={kind === 'received' ? 'Supplier invoice' : ''} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Tile className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--so-muted)]">On hand</p>
            <p className="num flex items-center gap-2 text-[26px] font-semibold leading-[34px] tracking-[-0.02em]">
              <span className={cn(delta !== null && 'text-[var(--so-muted)]')}>{num(target.on_hand)}</span>
              {delta !== null && (
                <>
                  <ArrowRight size={18} className="text-[var(--so-faint)]" aria-hidden />
                  <span className={cn(after < 0 && 'text-[var(--so-red-text)]')}>{num(after)}</span>
                </>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold text-[var(--so-muted)]">Available</p>
            <p className={cn('num text-[15px] font-semibold', after - target.reserved <= 0 && 'text-[var(--so-red-text)]')}>{num(after - target.reserved)}</p>
            {target.reserved > 0 && <p className="text-[12px] text-[var(--so-muted)]">{num(target.reserved)} reserved</p>}
          </div>
        </Tile>
      </form>
    </Dialog>
  );
}

const REASON_LABEL: Record<string, string> = { opening: 'Opening stock', received: 'Received', sale: 'Sold', return: 'Returned', adjust: 'Adjusted', damage: 'Damaged', count: 'Counted' };
const ACTOR_LABEL: Record<string, string> = { person: 'You', agent: 'Your AI agent', system: 'Automatic' };

interface MovesResult {
  variant: string;
  sku: string;
  moves: StockMove[];
}

/** A SKU's stock ledger: every move, who made it and the balance after. */
export function StockLedger({ variant }: { variant: string }): React.JSX.Element {
  const m = useLive<MovesResult>('moves:' + variant, (signal) => op<MovesResult>('stock.moves', { variant, limit: 50 }, { signal, quiet: true }), ['stock_moves', 'variants'], [variant]);
  const rows = m.data?.variant === variant ? m.data.moves : null;
  if (rows === null) {
    if (m.error !== null) return <p className="px-3 py-4 text-[13px] text-[var(--so-red-text)]">{m.error}</p>;
    return (
      <div className="grid gap-2 p-3">
        <Skeleton className="h-6 bg-[var(--so-tile-hover)]" />
        <Skeleton className="h-6 bg-[var(--so-tile-hover)]" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-[13px] text-[var(--so-muted)]">
        <History size={14} aria-hidden />
        No stock moves yet
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-[var(--so-muted)]">
            <th className="h-8 px-3 font-semibold">Date</th>
            <th className="h-8 px-3 text-right font-semibold">Change</th>
            <th className="h-8 px-3 font-semibold">Reason</th>
            <th className="h-8 px-3 font-semibold">Reference</th>
            <th className="h-8 px-3 font-semibold">Who</th>
            <th className="h-8 px-3 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--so-border)] text-[13px]">
              <td className="h-9 whitespace-nowrap px-3 text-[var(--so-ink-2)]">{dayTime(r.created)}</td>
              <td className={cn('num h-9 px-3 text-right font-semibold', r.qty > 0 ? 'text-[var(--so-green-text)]' : 'text-[var(--so-red-text)]')}>{(r.qty > 0 ? '+' : '') + num(r.qty)}</td>
              <td className="h-9 whitespace-nowrap px-3">{REASON_LABEL[r.reason] ?? r.reason}</td>
              <td className="h-9 max-w-[220px] truncate px-3 text-[var(--so-muted)]">{r.ref || r.note}</td>
              <td className="h-9 whitespace-nowrap px-3 text-[var(--so-muted)]">{ACTOR_LABEL[r.actor] ?? r.actor}</td>
              <td className="num h-9 px-3 text-right font-semibold">{num(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------- write listings (your AI agent) */

/** Ask your AI agent to write this product's listings for the shops chosen. */
export function PrepareDialog({ open, onClose, product }: { open: boolean; onClose: () => void; product: ProductDetail }): React.JSX.Element | null {
  if (!open) return null;
  return <PrepareForm onClose={onClose} product={product} />;
}

function PrepareForm({ onClose, product }: { onClose: () => void; product: ProductDetail }): React.JSX.Element {
  const { shops } = useStore();
  const sellable = shops.filter((s) => s.platform !== 'direct');
  const [chosen, setChosen] = useState<string[]>(() => sellable.map((s) => s.id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const listingOn = (shopId: string): Listing | undefined => product.listings.find((l) => l.shop.id === shopId);
  const submit = async (): Promise<void> => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      await op<{ task: TaskBrief }>('products.prepare', { product: product.id, shops: chosen, note: note.trim() || undefined });
      changed('tasks', 'products');
      notify.info('Asked your AI agent');
      onClose();
    } catch {
      /* op showed why */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Write listings with your AI agent"
      subtitle="Drafts come back to Approvals for you to check."
      footer={
        sellable.length > 0 ? (
          <>
            <Button variant="tile" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={chosen.length === 0} onClick={() => void submit()}>
              {chosen.length === 1 ? 'Ask for 1 shop' : 'Ask for ' + chosen.length + ' shops'}
            </Button>
          </>
        ) : undefined
      }
    >
      {sellable.length === 0 ? (
        <Empty
          icon={Store}
          title="Add a shop first"
          action={
            <Button
              onClick={() => {
                onClose();
                openAddShop();
              }}
            >
              Add a shop
            </Button>
          }
        >
          Listings are written for a shop.
        </Empty>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1">
            {sellable.map((s) => {
              const on = chosen.includes(s.id);
              const l = listingOn(s.id);
              const toggle = (): void => setChosen(on ? chosen.filter((x) => x !== s.id) : [...chosen, s.id]);
              return (
                <div key={s.id} onClick={toggle} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[12px] px-2 hover:bg-[var(--so-row-hover)]">
                  <Checkbox checked={on} onChange={toggle} label={s.name} />
                  <PlatformMark platform={s.platform} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                    <span className="block truncate text-[12px] text-[var(--so-muted)]">{PLATFORM_NAME[s.platform] ?? s.platform_name}</span>
                  </span>
                  {l !== undefined ? <ListingPill status={l.status} blocking={l.blocking} /> : <span className="text-[12px] font-medium text-[var(--so-muted)]">Not listed</span>}
                </div>
              );
            })}
          </div>
          <Field label="Note" hint="Optional">
            <TextArea rows={3} placeholder="e.g. Stress that it is a good gift" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="text-[12px] text-[var(--so-muted)]">{plural(chosen.length, 'shop')} chosen</p>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- mark live */

/** Record that a listing is live on its shop, with its id and link there. */
export function MarkLiveDialog({ listing, onClose }: { listing: Listing | null; onClose: () => void }): React.JSX.Element | null {
  if (listing === null) return null;
  return <MarkLiveForm key={listing.id} listing={listing} onClose={onClose} />;
}

function MarkLiveForm({ listing, onClose }: { listing: Listing; onClose: () => void }): React.JSX.Element {
  const [extId, setExtId] = useState(listing.external_id);
  const [url, setUrl] = useState(listing.url);
  const [busy, setBusy] = useState(false);
  const platform = PLATFORM_NAME[listing.shop.platform] ?? listing.shop.name;
  const urlBad = url.trim() !== '' && !/^https?:\/\/\S+$/i.test(url.trim());

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (urlBad || busy) return;
    setBusy(true);
    try {
      await op('listings.status', { listing: listing.id, status: 'live', external_id: extId.trim() || undefined, url: url.trim() || undefined });
      changed('listings', 'products', 'tasks', 'shops');
      notify.info('Marked as live');
      onClose();
    } catch {
      /* op showed why */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={'Live on ' + listing.shop.name}
      width={480}
      footer={
        <>
          <Button variant="tile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="so-mark-live" loading={busy} disabled={urlBad}>
            Mark as live
          </Button>
        </>
      }
    >
      <form id="so-mark-live" onSubmit={(e) => void submit(e)} className="grid gap-3">
        <Field label={'Listing id on ' + platform} hint="Optional">
          <TextInput autoFocus value={extId} onChange={(e) => setExtId(e.target.value)} />
        </Field>
        <Field label="Link" hint="Optional" {...(urlBad ? { error: 'Starts with https://' } : {})}>
          <TextInput inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

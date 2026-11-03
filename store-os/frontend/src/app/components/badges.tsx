/**
 * Shared small pieces: order status and health, tracking status, listing
 * status, stock state, the ship-by clock and the shop filter chips.
 */
import { cn } from '../../kit/index.ts';
import { clock, STATUS_LABEL, TRACK_LABEL } from '../lib/format.ts';
import { useStore } from '../lib/store.tsx';
import type { Health, ListingStatus, OrderStatus, StockState, TrackStatus } from '../lib/types.ts';
import { PlatformMark } from './PlatformMark.tsx';
import { Pill, StatusDot } from './ui.tsx';
import type { Tone } from './ui.tsx';

const ORDER_TONE: Record<OrderStatus, Tone> = { unpaid: 'warn', to_ship: 'accent', shipped: 'info', delivered: 'good', returned: 'neutral', cancelled: 'neutral' };

export function OrderStatus({ status, health }: { status: OrderStatus; health?: Health }): React.JSX.Element {
  let tone = ORDER_TONE[status] ?? 'neutral';
  let label = STATUS_LABEL[status] ?? status;
  if (health === 'late') {
    tone = 'bad';
    label = 'Late';
  } else if (health === 'exception') {
    tone = 'bad';
    label = 'Delivery problem';
  } else if (health === 'stalled') {
    tone = 'warn';
    label = 'No update';
  }
  return <StatusDot tone={tone}>{label}</StatusDot>;
}

export function TrackPill({ status }: { status: TrackStatus | '' }): React.JSX.Element | null {
  if (status === '') return null;
  const tone: Tone = status === 'delivered' ? 'good' : status === 'failed_attempt' || status === 'exception' || status === 'returned' ? 'bad' : status === 'out_for_delivery' || status === 'available_for_pickup' ? 'accent' : 'info';
  return <Pill tone={tone}>{TRACK_LABEL[status] ?? status}</Pill>;
}

/** Time left to ship (or to reply), red when late, amber within a day. */
export function Clock({ hours, className }: { hours: number | null | undefined; className?: string }): React.JSX.Element | null {
  const c = clock(hours);
  if (c.text === '') return null;
  return (
    <span className={cn('num whitespace-nowrap text-[12px] font-semibold', c.tone === 'bad' ? 'text-[var(--so-red-text)]' : c.tone === 'warn' ? 'text-[var(--so-amber-text)]' : 'text-[var(--so-muted)]', className)}>
      {c.text}
    </span>
  );
}

export const LISTING_LABEL: Record<ListingStatus, string> = { draft: 'Draft', ready: 'Ready', live: 'Live', paused: 'Paused' };
const LISTING_TONE: Record<ListingStatus, Tone> = { draft: 'neutral', ready: 'accent', live: 'good', paused: 'warn' };

export function ListingPill({ status, blocking = 0 }: { status: ListingStatus; blocking?: number }): React.JSX.Element {
  if (blocking > 0 && status !== 'live') return <Pill tone="bad">{blocking === 1 ? '1 issue' : blocking + ' issues'}</Pill>;
  return <Pill tone={LISTING_TONE[status] ?? 'neutral'}>{LISTING_LABEL[status] ?? status}</Pill>;
}

export function StockPill({ state, available }: { state: StockState; available: number }): React.JSX.Element {
  if (state === 'none') return <span className="text-[13px] text-[var(--so-muted)]">No SKU</span>;
  const tone: Tone = state === 'out' ? 'bad' : state === 'low' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{state === 'out' ? 'Out of stock' : available + ' available'}</Pill>;
}

/** "All shops" plus one chip per shop. Not for the sidebar: page headers only. */
export function ShopFilter({ value, onChange, className, includeDirect = true }: { value: string; onChange: (id: string) => void; className?: string; includeDirect?: boolean }): React.JSX.Element | null {
  const { shops } = useStore();
  const list = shops.filter((s) => includeDirect || s.platform !== 'direct');
  if (list.length <= 1) return null;
  return (
    <div className={cn('flex max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none]', className)} role="radiogroup" aria-label="Shop">
      <button
        type="button"
        role="radio"
        aria-checked={value === ''}
        onClick={() => onChange('')}
        className={cn('so-press h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold', value === '' ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-card)] text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)]')}
      >
        All shops
      </button>
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          onClick={() => onChange(value === s.id ? '' : s.id)}
          className={cn('so-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-[13px] font-semibold', value === s.id ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'bg-[var(--so-card)] text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)]')}
        >
          <PlatformMark platform={s.platform} size={24} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

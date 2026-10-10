/**
 * Rows and cards: an item as a list row or a photo card (with quick In and
 * Out buttons), and the history as entries grouped by the action that made
 * them (one batch), with Undo.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, ClipboardCheck, FileText, Minus, MoveRight, Plus, RefreshCw, Sparkles, Trash2, Undo2, User } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { ago } from '../lib/dates.ts';
import { qty, signed } from '../lib/format.ts';
import { ItemThumb, iconOf } from '../lib/icons.tsx';
import { navigate } from '../lib/router.ts';
import type { Item, Movement } from '../lib/types.ts';
import { LevelBar, Menu, StatusBadge } from './controls.tsx';
import { useStockChange } from './StockChange.tsx';
import { StatusPill, useConfirm } from './ui.tsx';

/* ------------------------------------------------------------ items */

/** Quick Out and In. `on` is the surface they sit on, so the Out button stands off it. */
function QuickButtons({ item, on = 'row' }: { item: Item; on?: 'row' | 'card' }): React.JSX.Element {
  const change = useStockChange();
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Take out ${item.name}`}
        title="Out"
        disabled={item.on_hand <= 0}
        onClick={(e) => {
          e.stopPropagation();
          change.open(e.currentTarget, { item, mode: 'out' });
        }}
        className={cn('flex size-9 items-center justify-center rounded-full transition-transform hover:bg-[var(--iv-row-hover)] active:scale-90 disabled:opacity-35', on === 'card' ? 'bg-[var(--iv-row)]' : 'bg-[var(--iv-card)]')}
      >
        <Minus size={15} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        aria-label={`Add ${item.name}`}
        title="In"
        onClick={(e) => {
          e.stopPropagation();
          change.open(e.currentTarget, { item, mode: 'in' });
        }}
        className="flex size-9 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)] transition-transform active:scale-90"
      >
        <Plus size={15} strokeWidth={2.4} />
      </button>
    </span>
  );
}

export function ItemRow({
  item,
  selectable = false,
  selected = false,
  onToggle,
  quick = true,
}: {
  item: Item;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  quick?: boolean;
}): React.JSX.Element {
  const sub = [item.archived ? 'Archived' : null, item.sku, item.category?.name ?? null, item.places > 1 ? `${item.places} places` : null].filter((x) => x !== null).join(' · ');
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-[18px] px-3 py-2.5 transition-colors',
        selected ? 'bg-[var(--iv-row-hover)] ring-2 ring-[var(--iv-ink)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
      )}
    >
      {selectable && (
        <input type="checkbox" checked={selected} onChange={() => onToggle?.(item.id)} aria-label={`Select ${item.name}`} className="ml-1 size-4 shrink-0 accent-[var(--iv-ink)]" />
      )}
      <button
        type="button"
        onClick={() => (selectable ? onToggle?.(item.id) : navigate('item', { id: item.id }))}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <ItemThumb photo={item.photo} icon={item.icon} size={44} tone="card" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{item.name}</span>
          <span className="block truncate text-[12px] text-[var(--iv-muted)]">{sub}</span>
        </span>
        <span className="hidden w-32 shrink-0 lg:block">
          <LevelBar onHand={item.on_hand} min={item.min_qty} max={item.max_qty} status={item.status} />
        </span>
        <span className="hidden shrink-0 sm:block">
          <StatusBadge status={item.status} />
        </span>
        <span className="num w-24 shrink-0 text-right">
          <span className="block text-[15px] font-bold">{qty(item.on_hand)}</span>
          <span className="block text-[12px] text-[var(--iv-muted)]">{item.incoming > 0 ? `+${qty(item.incoming)} coming` : item.unit}</span>
        </span>
      </button>
      {quick && !selectable ? <QuickButtons item={item} /> : !selectable && <ChevronRight size={16} className="text-[var(--iv-muted)]" aria-hidden />}
    </div>
  );
}

/** The picture area of an item card without a photo: its category icon on sand. */
function CardArt({ icon }: { icon: string }): React.JSX.Element {
  const Icon = iconOf(icon);
  return (
    <span aria-hidden className="iv-on-sand flex aspect-[4/3] w-full items-center justify-center rounded-[18px] bg-[var(--iv-sand)] text-[var(--iv-ink-2)]">
      <Icon size={36} strokeWidth={1.5} />
    </span>
  );
}

export function ItemCard({ item, selectable = false, selected = false, onToggle }: { item: Item; selectable?: boolean; selected?: boolean; onToggle?: (id: string) => void }): React.JSX.Element {
  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[24px] bg-[var(--iv-card)] transition-[box-shadow,transform] hover:shadow-[0_20px_40px_-30px_rgba(29,28,26,0.6)]',
        selected && 'ring-2 ring-[var(--iv-ink)]',
      )}
    >
      <button type="button" onClick={() => (selectable ? onToggle?.(item.id) : navigate('item', { id: item.id }))} className="flex flex-1 flex-col text-left" aria-label={item.name}>
        <span className="relative block p-2 pb-0">
          {item.photo_large !== null ? (
            <img src={item.photo_large} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-[18px] object-cover" />
          ) : (
            <CardArt icon={item.icon} />
          )}
          <span className="absolute left-4 top-4">
            <StatusBadge status={item.status} />
          </span>
          {selectable && (
            <span className={cn('absolute right-4 top-4 flex size-7 items-center justify-center rounded-full border-2', selected ? 'border-[var(--iv-ink)] bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'border-[var(--iv-card)] bg-[var(--iv-card)]/80')}>
              {selected && <span className="size-2.5 rounded-full bg-[var(--iv-accent)]" />}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-2 p-4 pt-3">
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold">{item.name}</span>
            <span className="block truncate text-[12px] text-[var(--iv-muted)]">{item.archived ? `${item.sku} · Archived` : item.sku}</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{qty(item.on_hand)}</span>
            <span className="text-[13px] text-[var(--iv-muted)]">{item.unit}</span>
          </span>
          <LevelBar onHand={item.on_hand} min={item.min_qty} max={item.max_qty} status={item.status} />
        </span>
      </button>
      {!selectable && (
        <span className="absolute bottom-[68px] right-3 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <QuickButtons item={item} on="card" />
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- history */

export const KIND_ICON: Record<Movement['kind'], LucideIcon> = {
  in: ArrowDownLeft,
  out: ArrowUpRight,
  move: MoveRight,
  adjust: RefreshCw,
  count: ClipboardCheck,
};

const KIND_TEXT: Record<Movement['kind'], string> = {
  in: 'In',
  out: 'Out',
  move: 'Moved',
  adjust: 'Adjusted',
  count: 'Counted',
};

export function ActorPill({ actor }: { actor: Movement['actor'] }): React.JSX.Element {
  if (actor === 'agent') {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--iv-accent)]/25 px-2.5 text-[12px] font-semibold text-[var(--iv-ink)]">
        <Sparkles size={12} aria-hidden /> AI agent
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--iv-row)] px-2.5 text-[12px] font-semibold text-[var(--iv-ink-2)]">
      <User size={12} aria-hidden /> {actor === 'system' ? 'App' : 'You'}
    </span>
  );
}

/** One history line: item, place, change and the balance it left. */
export function MovementLine({ m, showItem = true }: { m: Movement; showItem?: boolean }): React.JSX.Element {
  const Icon = KIND_ICON[m.kind];
  return (
    <div className="flex items-center gap-3 py-1.5">
      {showItem ? (
        <button type="button" onClick={() => navigate('item', { id: m.item.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ItemThumb photo={m.item.photo} icon={m.item.icon} size={36} tone="row" rounded="rounded-[12px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">{m.item.name}</span>
            <span className="block truncate text-[12px] text-[var(--iv-muted)]">
              {m.location.path} · {m.reason_label}
            </span>
          </span>
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--iv-row)] text-[var(--iv-ink-2)]">
            <Icon size={15} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">
              {KIND_TEXT[m.kind]} · {m.reason_label}
            </span>
            <span className="block truncate text-[12px] text-[var(--iv-muted)]">{m.location.path}</span>
          </span>
        </span>
      )}
      <span className="num w-24 shrink-0 text-right">
        <span className={cn('block text-[14px] font-bold', m.qty < 0 && 'text-[var(--iv-ink-2)]')}>{signed(m.qty)}</span>
        <span className="block text-[12px] text-[var(--iv-muted)]">left {qty(m.balance)}</span>
      </span>
    </div>
  );
}

/** Entries made by one action, grouped, with who did it, its source and Undo. */
export function BatchCard({ rows, showItem = true, compact = false }: { rows: Movement[]; showItem?: boolean; compact?: boolean }): React.JSX.Element {
  const first = rows[0];
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  if (first === undefined) return <></>;
  const Icon = KIND_ICON[first.kind];
  const isUndo = first.reverses !== '';
  const undone = first.undone_by !== '';
  const canUndo = !isUndo && !undone && first.ref_type !== 'import';
  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.undo(first.batch);
      toast.success('Undone');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    try {
      const p = await api.deleteBatch(first.batch, true);
      const ok = await confirm(
        `${p.entries} ${p.entries === 1 ? 'entry is' : 'entries are'} removed from the history${p.batches.length > 1 ? ' (with the undo of it)' : ''} and stock goes back as if ${p.batches.length > 1 ? 'they' : 'it'} never happened. Undo keeps a record instead.`,
        'Delete from history?',
      );
      if (!ok) return;
      await api.deleteBatch(first.batch);
      toast.success('Removed from history');
    } catch {
      /* toasted */
    }
  };
  const refLink =
    first.ref_type === 'order' && first.ref_label !== ''
      ? { label: first.ref_label, go: () => navigate('order', { id: first.ref }) }
      : first.ref_type === 'count' && first.ref_label !== ''
        ? { label: first.ref_label, go: () => navigate('count', { id: first.ref }) }
        : first.ref_type === 'import'
          ? { label: 'CSV import', go: () => navigate('data') }
          : null;
  return (
    <div className={cn('rounded-[20px] bg-[var(--iv-row)] px-3', compact ? 'py-1.5' : 'py-2')}>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="flex size-7 items-center justify-center rounded-full bg-[var(--iv-card)] text-[var(--iv-ink)]">
          <Icon size={14} aria-hidden />
        </span>
        <span className="text-[13px] font-bold">{isUndo ? 'Undo' : KIND_TEXT[first.kind]}</span>
        <ActorPill actor={first.actor} />
        {refLink !== null && (
          <button type="button" onClick={refLink.go} className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--iv-card)] px-2.5 text-[12px] font-semibold hover:underline">
            <FileText size={12} aria-hidden /> {refLink.label}
          </button>
        )}
        {undone && <StatusPill tone="neutral">Undone</StatusPill>}
        <span className="ml-auto text-[12px] text-[var(--iv-muted)]">{ago(first.created)}</span>
        {!isUndo && (
          <span className="flex items-center gap-1">
            {canUndo && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void undo()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--iv-card)] px-3 text-[12px] font-bold transition-colors hover:bg-[var(--iv-row-hover)] disabled:opacity-50"
              >
                <Undo2 size={13} aria-hidden /> Undo
              </button>
            )}
            {first.ref_type !== 'import' && <Menu variant="light" size={32} label="More" items={[{ label: 'Delete from history', icon: Trash2, danger: true, onClick: () => void remove() }]} />}
          </span>
        )}
      </div>
      {first.note !== '' && <p className="px-1 pt-1 text-[12px] text-[var(--iv-ink-2)]">{first.note}</p>}
      <div className="divide-y divide-[var(--iv-line)]/60">
        {rows.map((m) => (
          <MovementLine key={m.id} m={m} showItem={showItem} />
        ))}
      </div>
      {confirmEl}
    </div>
  );
}

/** Movements (newest first) grouped into consecutive batches. */
export function groupBatches(list: Movement[]): Movement[][] {
  const out: Movement[][] = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0]?.batch === m.batch) last.push(m);
    else out.push([m]);
  }
  return out;
}

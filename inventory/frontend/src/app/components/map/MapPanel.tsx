/**
 * The stockroom map's side panel, docked right on wide screens and a sheet on
 * phones. A place: its figures, the places inside it, what is stored there
 * (each with quick Out and In), Stock change here, Count here and Open place.
 * An item: how much is here and in total, its level, where else it is (each
 * place flies there), In, Out, Move and Open item.
 */
import { ArrowRight, ClipboardCheck, ExternalLink, Minus, MoveRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { money, plural, qty } from '../../lib/format.ts';
import { ItemThumb, KIND_LABELS, kindIcon } from '../../lib/icons.tsx';
import { navigate } from '../../lib/router.ts';
import { LevelBar, StatusBadge } from '../controls.tsx';
import { useStockChange } from '../StockChange.tsx';
import { CircleButton, PillButton, TextLink } from '../ui.tsx';
import type { Slot, World } from './layout.ts';

export type Sel = { kind: 'zone'; id: string; fly: boolean } | { kind: 'unit'; id: string; fly: boolean } | { kind: 'item'; item: string; slot: string | null; fly: boolean };

/** Items, units and value stored in a set of places, and the stacks that show them. */
export function figures(world: World, holds: string[]): { items: number; units: number; value: number; slots: Slot[] } {
  const set = new Set(holds);
  const slots = world.slots.filter((s) => set.has(s.place) && s.boxes > 0);
  const items = new Set(slots.map((s) => s.item.id));
  let units = 0;
  let value = 0;
  for (const s of slots) {
    units += s.qty;
    value += s.qty * s.item.unit_cost_e4;
  }
  return { items: items.size, units: Math.round(units * 1000) / 1000, value: Math.round(value), slots };
}

const SEVERITY: Record<string, number> = { out: 0, low: 1, ok: 2, over: 3, archived: 4 };

function Shell({ narrow, onClose, children, footer }: { narrow: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }): React.JSX.Element {
  return (
    <aside
      className={cn(
        'iv-pop iv-on-card absolute z-20 flex flex-col overflow-hidden rounded-[22px] bg-[var(--iv-card)] text-[var(--iv-ink)] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.55)] ring-1 ring-[var(--iv-line)]',
        narrow ? 'inset-x-2 bottom-2 max-h-[58%]' : 'bottom-3 right-3 top-3 w-[352px]',
      )}
      aria-label="Details"
    >
      <CircleButton icon={X} label="Close" variant="row" size={32} onClick={onClose} className="absolute right-3 top-3 z-10" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-3 pr-3">{children}</div>
      <div className="shrink-0 border-t border-[var(--iv-line)] p-4 pt-3">{footer}</div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[16px] bg-[var(--iv-row)] px-3 py-2">
      <span className="block text-[12px] text-[var(--iv-muted)]">{label}</span>
      <span className="num block truncate text-[14px] font-bold">{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------- a place */

export function PlacePanel({
  world,
  sel,
  currency,
  narrow,
  onSelect,
}: {
  world: World;
  sel: Extract<Sel, { kind: 'zone' | 'unit' }>;
  currency: string;
  narrow: boolean;
  onSelect: (s: Sel | null) => void;
}): React.JSX.Element | null {
  const change = useStockChange();
  const [counting, setCounting] = useState(false);
  const zone = sel.kind === 'zone' ? world.zones.find((z) => z.id === sel.id) : undefined;
  const unit = sel.kind === 'unit' ? world.units.get(sel.id) : undefined;
  const place = zone?.place ?? unit?.place;
  if (place === undefined) return null;
  const holds = zone?.holds ?? unit?.holds ?? [];
  const f = figures(world, holds);
  // The places directly inside it; the ones drawn on the map can be chosen.
  const inside = [...world.places.values()].filter((p) => p.parent === place.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const Icon = kindIcon(place.kind);
  const rows = [...f.slots].sort((a, b) => (SEVERITY[a.item.status] ?? 9) - (SEVERITY[b.item.status] ?? 9) || a.item.name.localeCompare(b.item.name));
  const missing = world.slots.filter((s) => s.boxes === 0 && holds.includes(s.place));

  const count = async (): Promise<void> => {
    setCounting(true);
    try {
      const c = await api.startCount({ location: place.id, include_sub: true });
      navigate('count', { id: c.id });
    } catch {
      /* toasted */
    } finally {
      setCounting(false);
    }
  };

  return (
    <Shell
      narrow={narrow}
      onClose={() => onSelect(null)}
      footer={
        <div className="flex items-center gap-2">
          <PillButton variant="dark" icon={Plus} dot onClick={(e) => change.open(e.currentTarget, { location: place.id })} className="h-10 min-w-0 flex-1 whitespace-nowrap pr-4 text-[13px]">
            Stock change
          </PillButton>
          <PillButton variant="soft" icon={ClipboardCheck} loading={counting} onClick={() => void count()} className="h-10 shrink-0 px-3.5 text-[13px]">
            Count
          </PillButton>
          <CircleButton icon={ExternalLink} label="Open place" variant="row" size={40} onClick={() => navigate('locations', { id: place.id })} />
        </div>
      }
    >
      <div className="flex items-center gap-3 pr-10">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--iv-sand)] text-[var(--iv-ink)]">
          <Icon size={19} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold leading-[22px]">{place.name}</h3>
          <p className="truncate text-[12px] text-[var(--iv-muted)]">
            {KIND_LABELS[place.kind]} · <span className="num">{place.code}</span>
          </p>
        </div>
      </div>
      {place.depth > 0 && <p className="mt-2 truncate text-[12px] text-[var(--iv-muted)]">{place.path}</p>}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Items" value={qty(f.items)} />
        <Stat label="Units" value={qty(f.units)} />
        <Stat label="Value" value={money(f.value, currency, true)} />
      </div>

      {inside.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] font-semibold text-[var(--iv-ink-2)]">Inside</p>
          <div className="flex flex-wrap gap-1.5">
            {inside.map((p) => {
              const PIcon = kindIcon(p.kind);
              const drawn = world.units.get(p.id);
              return drawn !== undefined ? (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect({ kind: 'unit', id: p.id, fly: true })}
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[var(--iv-row)] px-3 text-[12px] font-semibold hover:bg-[var(--iv-row-hover)]"
                >
                  <PIcon size={13} aria-hidden />
                  <span className="truncate">{p.name}</span>
                </button>
              ) : (
                <span key={p.id} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[var(--iv-row)] px-3 text-[12px] font-semibold">
                  <PIcon size={13} aria-hidden />
                  <span className="truncate">{p.name}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--iv-ink-2)]">{rows.length === 0 ? 'Nothing stored here yet' : `Stored here (${plural(rows.length, 'stack')})`}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((s) => (
          <li key={s.key} className="flex items-center gap-2 rounded-[16px] bg-[var(--iv-row)] py-1.5 pl-1.5 pr-1.5">
            <button
              type="button"
              onClick={() => onSelect({ kind: 'item', item: s.item.id, slot: s.key, fly: true })}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <ItemThumb photo={s.item.photo} icon={s.item.icon} size={34} tone="card" rounded="rounded-[11px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{s.item.name}</span>
                <span className="num block truncate text-[12px] text-[var(--iv-muted)]">
                  {qty(s.qty)} {s.item.unit}
                  {s.place !== place.id ? ` · ${world.places.get(s.place)?.name ?? ''}` : ''}
                </span>
              </span>
            </button>
            <CircleButton
              icon={Minus}
              label={`Take out ${s.item.name}`}
              variant="light"
              size={30}
              onClick={(e) => change.open(e.currentTarget, { item: { id: s.item.id }, mode: 'out', location: s.place })}
            />
            <CircleButton
              icon={Plus}
              label={`Add ${s.item.name}`}
              variant="dark"
              size={30}
              onClick={(e) => change.open(e.currentTarget, { item: { id: s.item.id }, mode: 'in', location: s.place })}
            />
          </li>
        ))}
        {missing.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'item', item: s.item.id, slot: s.key, fly: true })}
              className="flex w-full items-center gap-2.5 rounded-[16px] border border-dashed border-[var(--iv-red)] px-2.5 py-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.item.name}</span>
              <span className="shrink-0 text-[12px] font-semibold text-[var(--iv-red-text)]">Out of stock</span>
            </button>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

/* ---------------------------------------------------------------- an item */

export function ItemPanel({
  world,
  sel,
  narrow,
  onSelect,
}: {
  world: World;
  sel: Extract<Sel, { kind: 'item' }>;
  narrow: boolean;
  onSelect: (s: Sel | null) => void;
}): React.JSX.Element | null {
  const change = useStockChange();
  const item = world.items.get(sel.item);
  if (item === undefined) return null;
  const stacks = world.slots.filter((s) => s.item.id === item.id && s.boxes > 0);
  const here = stacks.find((s) => s.key === sel.slot) ?? stacks[0];
  const home = item.home !== null ? world.places.get(item.home) : undefined;
  const open = (el: Element, mode: 'in' | 'out' | 'move'): void =>
    change.open(el, { item: { id: item.id }, mode, ...(here !== undefined ? { location: here.place } : home !== undefined ? { location: home.id } : {}) });

  return (
    <Shell
      narrow={narrow}
      onClose={() => onSelect(null)}
      footer={
        <>
          <div className="grid grid-cols-3 gap-2">
            <PillButton variant="dark" icon={Plus} onClick={(e) => open(e.currentTarget, 'in')} className="h-10 px-3 text-[13px]">
              In
            </PillButton>
            <PillButton variant="soft" icon={Minus} disabled={stacks.length === 0} onClick={(e) => open(e.currentTarget, 'out')} className="h-10 px-3 text-[13px]">
              Out
            </PillButton>
            <PillButton variant="soft" icon={MoveRight} disabled={stacks.length === 0} onClick={(e) => open(e.currentTarget, 'move')} className="h-10 px-3 text-[13px]">
              Move
            </PillButton>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[12px] text-[var(--iv-muted)]">{stacks.length > 0 ? 'Or drag its boxes to another place.' : ''}</p>
            <TextLink onClick={() => navigate('item', { id: item.id })} className="inline-flex shrink-0 items-center gap-1">
              Open item <ExternalLink size={12} aria-hidden />
            </TextLink>
          </div>
        </>
      }
    >
      <div className="flex items-center gap-3 pr-10">
        <ItemThumb photo={item.photo} icon={item.icon} size={44} tone="row" />
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold leading-[22px]">{item.name}</h3>
          <p className="truncate text-[12px] text-[var(--iv-muted)]">
            <span className="num">{item.sku}</span>
            {item.category !== null ? ` · ${item.category}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="num text-[13px] text-[var(--iv-ink-2)]">
          {here !== undefined && stacks.length > 1 ? `${qty(here.qty)} here · ` : ''}
          {qty(item.on_hand)} {item.unit} in total
        </span>
      </div>
      <LevelBar onHand={item.on_hand} min={item.min_qty} max={item.max_qty} status={item.status} className="mt-3" />
      <p className="mt-2 text-[12px] text-[var(--iv-muted)]">
        {item.min_qty > 0 ? `Reorder at ${qty(item.min_qty)}` : 'No reorder point'}
        {item.max_qty > 0 ? ` · target ${qty(item.max_qty)}` : ''}
      </p>

      <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--iv-ink-2)]">Where it is</p>
      {stacks.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-[var(--iv-red)] px-3 py-2.5 text-[13px] text-[var(--iv-ink-2)]">
          Out of stock{home !== undefined ? `. It belongs at ${home.path}.` : '.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {stacks.map((s) => {
            const p = world.places.get(s.place);
            const on = s.key === here?.key;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'item', item: item.id, slot: s.key, fly: true })}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[16px] px-3 py-2 text-left transition-colors',
                    on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-row)] hover:bg-[var(--iv-row-hover)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p?.path ?? ''}</span>
                  <span className="num shrink-0 text-[13px] font-bold">{qty(s.qty)}</span>
                  <ArrowRight size={14} aria-hidden className="shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

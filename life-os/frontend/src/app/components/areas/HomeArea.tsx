/**
 * Home: chores by room, each showing when it is due again (tap Done and it
 * starts over), and the shopping list on a notepad (paste a list, tick off,
 * clear what is bought).
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { act, drop, insert, localDay, patch, reshape, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { Chore, ShoppingItem } from '../../lib/types.ts';
import { CategoryArt } from '../art.tsx';
import { ROOMS, RoomArt } from '../art2.tsx';
import { AddLine, CheckButton, Chip } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { snack } from '../snack.tsx';
import { Button, Skeleton } from '../ui.tsx';

function dueWords(c: Chore): { text: string; tone: 'late' | 'now' | 'soon' | 'fine' } {
  if (c.last_done === '') return { text: 'Not done yet', tone: 'now' };
  if (c.due_in < 0) return { text: `${-c.due_in} day${c.due_in === -1 ? '' : 's'} late`, tone: 'late' };
  if (c.due_in === 0) return { text: 'Today', tone: 'now' };
  if (c.due_in === 1) return { text: 'Tomorrow', tone: 'soon' };
  return { text: `In ${c.due_in} days`, tone: c.due_in <= 2 ? 'soon' : 'fine' };
}

function ChoreRow({ c }: { c: Chore }): React.JSX.Element {
  const d = dueWords(c);
  const frac = c.last_done === '' ? 0 : Math.max(0, Math.min(1, c.due_in / Math.max(1, c.every_days)));
  const done = async (): Promise<void> => {
    snack(`"${c.name}" done. Next in ${c.every_days} days`);
    await act([patch<Chore>(c.id, { last_done: localDay(), due_in: c.every_days })], () => op('chores.done', { chore: c.id }), ['chores', 'goals']);
  };
  return (
    <li data-row className={cn('group flex min-h-12 items-center gap-2.5 rounded-[var(--lo-r)] px-1.5 hover:bg-[var(--lo-sunk)]', enter(c.id))}>
      <span className="relative flex size-9 shrink-0 items-center justify-center" title={d.text}>
        <svg width={36} height={36} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={18} cy={18} r={15} fill="none" stroke="var(--lo-track)" strokeWidth={4} />
          <circle cx={18} cy={18} r={15} fill="none" stroke={d.tone === 'late' ? 'var(--lo-red)' : d.tone === 'now' ? 'var(--lo-amber)' : 'var(--lo-k-home)'} strokeWidth={4} strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 * (1 - (d.tone === 'late' || d.tone === 'now' ? 1 : frac))} strokeLinecap="round" />
        </svg>
      </span>
      <span className="min-w-0 flex-1" title={`Every ${c.every_days === 1 ? 'day' : c.every_days === 7 ? 'week' : c.every_days === 14 ? 'two weeks' : c.every_days === 30 ? 'month' : c.every_days + ' days'}`}>
        <span className="block truncate text-[14px] font-bold">{c.name}</span>
        <span className={cn('block text-[12px] font-bold', d.tone === 'late' ? 'text-[var(--lo-red-text)]' : d.tone === 'now' ? 'text-[var(--lo-amber-text)]' : 'text-[var(--lo-muted)]')}>
          {d.text}
        </span>
      </span>
      <button type="button" onClick={() => void done()} className="flex h-8 items-center gap-1 rounded-[var(--lo-r-sm)] bg-[var(--lo-moss-soft)] px-3 text-[12px] font-extrabold text-[var(--lo-moss-text)] hover:brightness-[0.97]">
        <Check size={13} strokeWidth={3} /> Done
      </button>
      <button
        type="button"
        aria-label={`Remove ${c.name}`}
        onClick={(e) => {
          void vanish(rowOf(e), [drop(c.id)], () => op('chores.delete', { chore: c.id }), ['chores', 'goals']).then((r) => r !== undefined && snack('Removed'));
        }}
        className="hit hidden size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100 sm:flex"
      >
        <X size={13} />
      </button>
    </li>
  );
}

function NewChore(): React.JSX.Element {
  const [room, setRoom] = useState<string>('kitchen');
  const [every, setEvery] = useState(7);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {ROOMS.map((r) => (
          <Chip key={r.key} active={room === r.key} art={<RoomArt room={r.key} size={20} />} onClick={() => setRoom(r.key)} className="h-8 text-[12px]">
            {r.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AddLine
          className="min-w-[220px] flex-1"
          placeholder="Clean the oven, change the sheets"
          onAdd={async (name) => {
            const draft: Chore = { id: tempId(), name, room, every_days: every, last_done: '', next_due: localDay(), due_in: 0, actor: 'person' };
            const r = await act([insert((k) => k === 'chores', draft)], () => op('chores.add', { name, room, every_days: every }), ['chores', 'goals']);
            if (r === undefined) return false;
            snack(`"${name}" every ${every === 7 ? 'week' : every + ' days'}`);
            return true;
          }}
        />
        <div className="flex gap-1">
          {(
            [
              [1, 'Daily'],
              [7, 'Weekly'],
              [14, '2 weeks'],
              [30, 'Monthly'],
            ] as [number, string][]
          ).map(([n, l]) => (
            <Chip key={n} active={every === n} onClick={() => setEvery(n)} className="h-8 text-[12px]">
              {l}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

function Shopping({ items }: { items: ShoppingItem[] }): React.JSX.Element {
  const bought = items.filter((i) => i.done).length;
  return (
    <div className="lo-lined rounded-[var(--lo-r-lg)] border border-[var(--lo-hair)] bg-[var(--lo-card)] px-4 pb-4 pt-3 shadow-[var(--lo-shadow-sm)]">
      <ul className="flex flex-col">
        {items.map((i) => (
          <li key={i.id} data-row className={cn('group flex h-8 items-center gap-2.5', enter(i.id))}>
            <CheckButton
              done={i.done}
              size={18}
              label={i.text}
              onClick={() => {
                void act([patch<ShoppingItem>(i.id, { done: !i.done })], () => op('shopping.check', { item: i.id, done: !i.done }), ['shopping_items']);
              }}
            />
            <span className={cn('serif min-w-0 flex-1 truncate text-[15px]', i.done && 'text-[var(--lo-muted)] line-through')}>{i.text}</span>
            <button
              type="button"
              aria-label={`Remove ${i.text}`}
              onClick={(e) => {
                void vanish(rowOf(e), [drop(i.id)], () => op('shopping.delete', { item: i.id }), ['shopping_items']);
              }}
              className="hit flex size-6 items-center justify-center rounded-[var(--lo-r-xs)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-sunk)] focus:opacity-100 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="serif h-8 text-[15px] leading-8 text-[var(--lo-muted)]">The list is empty.</p>}
      <AddLine
        className="mt-2"
        placeholder="Milk, bread (paste a whole list)"
        onAdd={async (text) => {
          // A pasted list becomes one line per thing, all shown at once.
          const lines = text.split('\n').map((x) => x.trim()).filter((x) => x !== '');
          const isShop = (k: string, o: Record<string, unknown>, list: unknown[]): boolean => k === 'items' && !('kinds' in o) && list.every((x) => typeof x === 'object' && x !== null && 'text' in x);
          const drafts = lines.map((t): ShoppingItem => ({ id: tempId(), text: t, done: false } as ShoppingItem));
          const r = await act(drafts.map((d) => insert(isShop, d)), () => op('shopping.add', { text }), ['shopping_items']);
          return r !== undefined;
        }}
      />
      {bought > 0 && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              snack(`Cleared ${bought} bought`);
              const clear = reshape((root) => {
                if (typeof root !== 'object' || root === null || !Array.isArray((root as { items?: unknown }).items)) return root;
                const r = root as { items: ShoppingItem[] };
                return r.items.every((x) => 'text' in x) ? { ...r, items: r.items.filter((x) => !x.done) } : root;
              });
              void act([clear], () => op('shopping.clear'), ['shopping_items']);
            }}
          >
            Clear {bought} bought
          </Button>
        </div>
      )}
    </div>
  );
}

export default function HomeTool(): React.JSX.Element {
  const chores = useLive<{ chores: Chore[] }>((signal) => op('chores.list', {}, { quiet: true, signal }), ['chores'], []);
  const shop = useLive<{ items: ShoppingItem[] }>((signal) => op('shopping.list', {}, { quiet: true, signal }), ['shopping_items'], []);
  if (chores.data === null || shop.data === null) return <Skeleton className="h-48 w-full" />;
  const list = chores.data.chores;
  const rooms = ROOMS.filter((r) => list.some((c) => c.room === r.key));
  return (
    <>
      <Panel title="Chores" art={<RoomArt room="other" size={24} />} note={list.length > 0 ? `${list.filter((c) => c.due_in <= 0).length} due` : undefined}>
        {rooms.length === 0 && <p className="mb-3 text-[13px] text-[var(--lo-muted)]">Add the jobs that come round again. Each one shows when it is due, so nothing is forgotten and nothing is done too often.</p>}
        <div className={cn('grid gap-5', rooms.length > 1 && 'md:grid-cols-2')}>
          {rooms.map((r) => (
            <div key={r.key}>
              <p className="mb-1 flex items-center gap-2 px-1">
                <RoomArt room={r.key} size={30} />
                <span className="text-[13px] font-extrabold text-[var(--lo-k-home-text)]">{r.label}</span>
              </p>
              <ul className="flex flex-col">
                {list
                  .filter((c) => c.room === r.key)
                  .map((c) => (
                    <ChoreRow key={c.id} c={c} />
                  ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={cn(rooms.length > 0 && 'mt-4 border-t border-[var(--lo-hair)] pt-4')}>
          <NewChore />
        </div>
      </Panel>
      <Panel title="Shopping list" art={<CategoryArt category="groceries" size={24} />} note={shop.data.items.length > 0 ? `${shop.data.items.filter((i) => !i.done).length} to buy` : undefined}>
        <div className="max-w-[520px]">
          <Shopping items={shop.data.items} />
        </div>
      </Panel>
    </>
  );
}

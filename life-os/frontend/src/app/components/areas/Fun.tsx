/**
 * Fun: trips as tickets counting down (each with its packing list), and a
 * bucket list of stamps that get stamped when done.
 */
import { useState } from 'react';
import { Check, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useStatus } from '../../lib/context.tsx';
import { MON, parseDay, relDay } from '../../lib/format.ts';
import { act, drop, insert, localDay, patch, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { BucketItem, Trip } from '../../lib/types.ts';
import { ThingArt } from '../art2.tsx';
import type { ThingKind } from '../art2.tsx';
import { AddLine, CheckButton, Chip, Meter } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { DateButton } from '../pickers.tsx';
import { snack } from '../snack.tsx';
import { Button, Skeleton, useConfirm } from '../ui.tsx';

function short(d: string): string {
  const x = parseDay(d);
  return `${x.getDate()} ${MON[x.getMonth()]}`;
}

function Ticket({ trip }: { trip: Trip }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  // The packing list changes at once; the server keeps it behind.
  const pack = async (params: Record<string, unknown>): Promise<boolean> => {
    const lines = (list: Trip['checklist']): Partial<Trip> => ({ checklist: list, packed: list.filter((c) => c.done).length });
    const change =
      params.item === undefined
        ? patch<Trip>(trip.id, (t) => lines([...t.checklist, ...String(params.text).split('\n').map((x) => x.trim()).filter((x) => x !== '').map((x) => ({ id: tempId(), text: x, done: false }))]))
        : params.remove === true
          ? patch<Trip>(trip.id, (t) => lines(t.checklist.filter((c) => c.id !== params.item)))
          : patch<Trip>(trip.id, (t) => lines(t.checklist.map((c) => (c.id === params.item ? { ...c, done: params.done === true } : c))));
    const r = await act([change], () => op('trips.pack', { trip: trip.id, ...params }), ['trips']);
    return r !== undefined;
  };
  const remove = async (e: React.MouseEvent): Promise<void> => {
    const row = rowOf(e);
    if (!(await confirm(`"${trip.title}" and its packing list will be deleted.`, 'Delete this trip?'))) return;
    const r = await vanish(row, [drop(trip.id)], () => op('trips.delete', { trip: trip.id }), ['trips']);
    if (r !== undefined) snack(`Deleted "${trip.title}"`);
  };
  const away = trip.state === 'now';
  const n = trip.checklist.length;
  const dates = trip.start_date !== '' ? `${short(trip.start_date)}${trip.end_date !== '' && trip.end_date !== trip.start_date ? ' to ' + short(trip.end_date) : ''}` : '';
  const when = [trip.place !== '' ? trip.place : 'Somewhere nice', dates, trip.nights > 0 ? `${trip.nights} ${trip.nights === 1 ? 'night' : 'nights'}` : ''].filter((x) => x !== '').join(' · ');
  return (
    <div data-row className={cn('relative overflow-hidden rounded-[var(--lo-r-lg)] bg-[var(--lo-k-fun-soft)]', enter(trip.id))}>
      {confirmEl}
      <div className="relative flex">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left">
          <ThingArt kind="suitcase" size={44} />
          <span className="min-w-0 flex-1">
            <span className="serif block break-words text-[15px] font-semibold">{trip.title}</span>
            <span className="block text-[13px] font-semibold text-[var(--lo-ink-2)]">{when}</span>
            <span className="mt-2 flex items-center gap-2">
              {n > 0 && <Meter value={trip.packed / n} color="var(--lo-k-fun)" className="w-full max-w-36" />}
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-[var(--lo-k-fun-text)]">
                {n > 0 ? `${trip.packed} of ${n} packed` : 'Packing list'}
                <ChevronDown size={14} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
              </span>
            </span>
          </span>
        </button>
        <span aria-hidden className="my-3 border-l-2 border-dashed border-[var(--lo-card)]" />
        <div className="flex w-24 shrink-0 flex-col items-center justify-center px-2 text-center sm:w-28">
          {away ? (
            <span className="text-[13px] font-extrabold text-[var(--lo-k-fun-text)]">Away now</span>
          ) : trip.in_days !== null && trip.in_days >= 0 ? (
            <>
              <span className="num text-[26px] font-extrabold leading-8 text-[var(--lo-k-fun-text)]">{trip.in_days}</span>
              <span className="text-[12px] font-bold text-[var(--lo-k-fun-text)]">{trip.in_days === 1 ? 'day to go' : 'days to go'}</span>
            </>
          ) : (
            <span className="text-[12px] font-bold text-[var(--lo-ink-2)]">{trip.state === 'idea' ? 'Someday' : 'Been'}</span>
          )}
        </div>
        {/* The ticket's punched notches, where the stub tears off. */}
        <span aria-hidden className="absolute -top-2 right-24 size-4 translate-x-1/2 rounded-full bg-[var(--lo-card)] sm:right-28" />
        {!open && <span aria-hidden className="absolute -bottom-2 right-24 size-4 translate-x-1/2 rounded-full bg-[var(--lo-card)] sm:right-28" />}
      </div>
      {open && (
        <div className="border-t-2 border-dashed border-[var(--lo-card)] px-4 pb-4 pt-3">
          <p className="mb-1 text-[12px] font-extrabold text-[var(--lo-ink-2)]">Packing list</p>
          {n > 0 && (
            <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {trip.checklist.map((c) => (
                <li key={c.id} data-row className="group flex h-9 items-center gap-2.5 rounded-[var(--lo-r-sm)] px-1 hover:bg-[var(--lo-card)]">
                  <CheckButton done={c.done} size={18} onClick={() => void pack({ item: c.id, done: !c.done })} label={c.text} />
                  <span className={cn('min-w-0 flex-1 truncate text-[14px]', c.done && 'text-[var(--lo-ink-2)] line-through')}>{c.text}</span>
                  <button type="button" aria-label={`Remove ${c.text}`} onClick={(e) => void vanish(rowOf(e), [], async () => { if (!(await pack({ item: c.id, remove: true }))) throw new Error('kept'); }, [])} className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-ink-2)] opacity-0 hover:bg-[var(--lo-sunk)] focus:opacity-100 group-hover:opacity-100">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <AddLine placeholder="Something to pack" onAdd={(text) => pack({ text })} className="min-w-[200px] flex-1" />
            <button type="button" onClick={(e) => void remove(e)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--lo-r-sm)] px-2 text-[13px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-card)] hover:text-[var(--lo-red-text)]">
              <Trash2 size={14} aria-hidden />
              Delete trip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One add bar: the trip's name first; where and when appear as soon as there is a name. */
function NewTrip(): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    const t = title.trim();
    if (t === '' || busy) return;
    const was = { title, place, start, end };
    setTitle('');
    setPlace('');
    setStart('');
    setEnd('');
    // The ticket shows at once (its countdown settles when the server answers).
    const days = start !== '' ? Math.round((new Date(start + 'T12:00:00').getTime() - new Date(localDay() + 'T12:00:00').getTime()) / 86400000) : null;
    const nights = start !== '' && end !== '' ? Math.max(0, Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86400000)) : 0;
    const basics = ['Passport or ID', 'Chargers', 'Toothbrush', 'Clothes'].map((x) => ({ id: tempId(), text: x, done: false }));
    const draft = { id: tempId(), title: t, place: place.trim(), start_date: start, end_date: end, notes: '', checklist: basics, packed: 0, in_days: days, nights, state: start === '' ? 'idea' : 'coming', actor: 'person' } as unknown as Trip;
    const r = await act([insert((k) => k === 'trips', draft, 'start')], () => op('trips.add', { title: t, place: place.trim(), ...(start !== '' ? { start_date: start } : {}), ...(end !== '' ? { end_date: end } : {}) }), ['trips']);
    if (r === undefined) {
      setTitle(was.title);
      setPlace(was.place);
      setStart(was.start);
      setEnd(was.end);
      return;
    }
    snack(`"${t}" is on the way`);
  };
  const more = title !== '' || place !== '' || start !== '' || end !== '';
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void add();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[var(--lo-r)] border border-dashed border-[var(--lo-line)] bg-[var(--lo-card)] px-2.5 py-1.5 transition-colors focus-within:border-solid focus-within:border-[var(--lo-accent)] focus-within:shadow-[var(--lo-shadow-sm)]">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] text-white">
        <Plus size={15} strokeWidth={3} />
      </span>
      <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={enter} placeholder="Plan a trip: Lisbon in spring" aria-label="Trip" maxLength={120} className="h-7 min-w-[160px] flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--lo-muted)]" />
      {more && (
        <>
          <input value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={enter} placeholder="Where" aria-label="Where" maxLength={120} className="h-7 w-32 rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-2.5 text-[13px] font-semibold outline-none placeholder:text-[var(--lo-muted)]" />
          <DateButton size="sm" value={start} today={today} onChange={setStart} placeholder="Leaving" />
          <DateButton size="sm" value={end} today={today} onChange={setEnd} placeholder="Back" />
          <Button variant="primary" size="sm" disabled={title.trim() === '' || busy} onClick={() => void add()}>
            Add trip
          </Button>
        </>
      )}
    </div>
  );
}

const KINDS: { key: BucketItem['kind']; label: string; art: ThingKind }[] = [
  { key: 'place', label: 'A place', art: 'pin' },
  { key: 'experience', label: 'An experience', art: 'balloon' },
  { key: 'skill', label: 'A skill', art: 'star' },
  { key: 'food', label: 'Food', art: 'bowl' },
  { key: 'other', label: 'Something else', art: 'ticket' },
];

function Stamp({ item }: { item: BucketItem }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const done = item.done_on !== '';
  const k = KINDS.find((x) => x.key === item.kind) ?? KINDS[4]!;
  const toggle = async (): Promise<void> => {
    if (!done) snack(`Done: ${item.title}`);
    await act([patch<BucketItem>(item.id, { done_on: done ? '' : today })], () => op('bucket.update', { item: item.id, done: !done }), ['bucket_items', 'goals']);
  };
  return (
    <div data-row className={cn('group relative', enter(item.id))}>
      <button type="button" onClick={() => void toggle()} aria-pressed={done} title={done ? 'Done. Tap to undo' : 'Tap when you have done it'} className={cn('relative flex h-[150px] w-full flex-col items-center justify-center gap-2 rounded-[6px] border-[3px] border-dotted p-3 text-center transition-transform hover:-rotate-1', done ? 'border-[var(--lo-k-fun)] bg-[var(--lo-k-fun-soft)]' : 'border-[var(--lo-line)] bg-[var(--lo-card)]')}>
        <ThingArt kind={k.art} size={52} />
        <span className="line-clamp-2 text-[13px] font-bold leading-4">{item.title}</span>
        {done && (
          <span className="absolute -right-2 -top-2 flex size-14 rotate-12 flex-col items-center justify-center rounded-full border-2 border-[var(--lo-k-fun-text)] bg-[var(--lo-card)] text-[var(--lo-k-fun-text)]">
            <Check size={16} strokeWidth={3} />
            <span className="text-[12px] font-extrabold leading-3">{relDay(item.done_on, today) === 'Today' ? 'Today' : short(item.done_on)}</span>
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Remove ${item.title}`}
        onClick={(e) => {
          void vanish(rowOf(e), [drop(item.id)], () => op('bucket.delete', { item: item.id }), ['bucket_items', 'goals'], 'shrink').then((r) => r !== undefined && snack('Removed'));
        }}
        className="hit absolute bottom-1 right-1 flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-sunk)] focus:opacity-100 group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default function FunTool(): React.JSX.Element {
  const trips = useLive<{ trips: Trip[] }>((signal) => op('trips.list', {}, { quiet: true, signal }), ['trips'], []);
  const bucket = useLive<{ items: BucketItem[] }>((signal) => op('bucket.list', {}, { quiet: true, signal }), ['bucket_items'], []);
  const [kind, setKind] = useState<BucketItem['kind']>('place');
  if (trips.data === null || bucket.data === null) return <Skeleton className="h-48 w-full" />;
  const upcoming = trips.data.trips.filter((t) => t.state !== 'past');
  const past = trips.data.trips.filter((t) => t.state === 'past');
  const items = bucket.data.items;
  const doneN = items.filter((i) => i.done_on !== '').length;
  return (
    <>
      <Panel title="Trips" art={<ThingArt kind="suitcase" size={24} />} note={upcoming.length > 0 ? `${upcoming.length} coming` : undefined}>
        {upcoming.length > 0 ? (
          <div className="mb-3 flex flex-col gap-3">
            {upcoming.map((t) => (
              <Ticket key={t.id} trip={t} />
            ))}
          </div>
        ) : (
          <p className="mb-3 text-[13px] text-[var(--lo-muted)]">Something to look forward to. Add the next trip, even a weekend.</p>
        )}
        <NewTrip />
        {past.length > 0 && <p className="mt-2 text-[12px] font-semibold text-[var(--lo-muted)]">Been: {past.map((t) => t.title).join(', ')}</p>}
      </Panel>

      <Panel title="Bucket list" art={<ThingArt kind="balloon" size={24} />} note={items.length > 0 ? `${doneN} of ${items.length} done` : undefined}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4">
          {items.map((i) => (
            <Stamp key={i.id} item={i} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <Chip key={k.key} active={kind === k.key} art={<ThingArt kind={k.art} size={18} />} onClick={() => setKind(k.key)} className="h-8 text-[12px]">
                {k.label}
              </Chip>
            ))}
          </div>
          <AddLine
            className="min-w-[220px] flex-1"
            placeholder="See the northern lights"
            onAdd={async (title) => {
              const draft = { id: tempId(), title, kind, note: '', done_on: '', date: '', actor: 'person' } as unknown as BucketItem;
              const r = await act([insert((k, _o, list) => k === 'items' && list.every((x) => typeof x === 'object' && x !== null && 'title' in x), draft)], () => op('bucket.add', { title, kind }), ['bucket_items', 'goals']);
              if (r === undefined) return false;
              snack('On the bucket list');
              return true;
            }}
          />
        </div>
      </Panel>
    </>
  );
}

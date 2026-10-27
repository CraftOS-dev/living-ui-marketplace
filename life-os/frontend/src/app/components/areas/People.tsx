/**
 * Friends and family: everyone on a connection map around you, who it is time to reach out to (one tap:
 * talked today), the birthdays coming and the plans made together.
 */
import { useState } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useStatus } from '../../lib/context.tsx';
import { plural, relDay } from '../../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { Circle, Person, PlanEvent } from '../../lib/types.ts';
import { AreaArt, Avatar } from '../art.tsx';
import { ThingArt } from '../art2.tsx';
import { AddLine, Chip } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { PeopleToReach } from '../glance.tsx';
import { addPerson, CIRCLES as CIRCLE_NAMES, usePersonPanel } from '../people.tsx';
import { ConnectionMap, MapKey } from '../connections.tsx';
import { DateButton } from '../pickers.tsx';
import { snack } from '../snack.tsx';
import { Button, Skeleton } from '../ui.tsx';

const CIRCLES: Circle[] = ['partner', 'family', 'friends'];

function Plans({ events, people }: { events: PlanEvent[]; people: Person[] }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [who, setWho] = useState('');
  const add = async (): Promise<void> => {
    if (title.trim() === '' || date === '') return;
    await op('events.create', { title: title.trim(), date, area: 'relationships', ...(who !== '' ? { person: who } : {}) });
    changed('events', 'people');
    snack('Plan made');
    setTitle('');
    setDate('');
    setWho('');
  };
  return (
    <div>
      {events.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {events.map((e) => (
            <li key={e.id} data-row className={cn('group flex h-12 items-center gap-3 rounded-[var(--lo-r)] bg-[var(--lo-card)] px-3 shadow-[var(--lo-shadow-sm)]', enter(e.id))}>
              {e.person !== null ? <Avatar look={e.person.look} size={30} /> : <ThingArt kind="balloon" size={30} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{e.title}</span>
                <span className="block text-[12px] font-semibold text-[var(--lo-muted)]">
                  {relDay(e.date, today)}
                  {e.time !== '' ? ` · ${e.time}` : ''}
                  {e.person !== null ? ` · with ${e.person.name}` : ''}
                </span>
              </span>
              <button
                type="button"
                aria-label="Remove plan"
                onClick={(ev) => {
                  void vanish(rowOf(ev), [drop(e.id)], () => op('events.delete', { event: e.id }), ['events', 'people']).then((r) => r !== undefined && snack('Plan removed'));
                }}
                className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-sunk)] focus:opacity-100 group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Sunday lunch, a game night" aria-label="Plan" maxLength={200} className="h-10 min-w-0 flex-1 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
        <DateButton value={date} today={today} onChange={setDate} placeholder="When" icon={CalendarPlus} />
        {people.length > 0 && (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="With" className="h-8 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none">
            <option value="">With...</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="primary" size="sm" disabled={title.trim() === '' || date === ''} onClick={() => void add()}>
          Add plan
        </Button>
      </div>
    </div>
  );
}

export default function PeopleTool(): React.JSX.Element {
  const panel = usePersonPanel();
  const today = useStatus().data?.today ?? '';
  const [circle, setCircle] = useState<Circle>('friends');
  const owner = useStatus().data?.owner_name ?? '';
  const live = useLive<{ people: Person[] }>((signal) => op('people.list', {}, { quiet: true, signal }), ['people', 'interactions'], []);
  const plans = useLive<{ events: PlanEvent[] }>((signal) => op('events.list', { area: 'relationships' }, { quiet: true, signal }), ['events', 'people'], []);
  const people = live.data?.people ?? [];
  if (live.data === null) return <Skeleton className="h-48 w-full" />;
  const due = people.filter((p) => p.due);
  const bdays = people.filter((p) => p.next_birthday !== null).sort((a, b) => (a.next_birthday?.in_days ?? 0) - (b.next_birthday?.in_days ?? 0));
  return (
    <>
      <Panel title="Your connection map" art={<AreaArt kind="relationships" size={26} />} note={people.length > 0 ? plural(people.length, 'person', 'people') : undefined}>
        <ConnectionMap people={people} owner={owner} circles={CIRCLES} hint="Add your partner, family and friends below and they appear around you." onOpen={panel.open} />
        {people.length > 0 && (
          <div className="mt-3">
            <MapKey />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {CIRCLE_NAMES.map((c) => (
            <Chip key={c.key} active={circle === c.key} onClick={() => setCircle(c.key)} className="h-7 text-[12px]">
              {c.label}
            </Chip>
          ))}
          <AddLine placeholder="Add someone (just a name)" onAdd={(name) => addPerson(name, circle)} className="min-w-[240px] flex-1" />
        </div>
      </Panel>
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
        <Panel title="Time to reach out" art={<ThingArt kind="bubble" size={24} />}>
          {due.length === 0 && bdays.filter((b) => (b.next_birthday?.in_days ?? 99) <= 14).length === 0 ? (
            <p className="text-[13px] text-[var(--lo-muted)]">{people.length === 0 ? 'Add someone first.' : 'Everyone is in touch.'}</p>
          ) : (
            <PeopleToReach due={due} birthdays={bdays} limit={6} />
          )}
        </Panel>
        <Panel title="Birthdays" art={<ThingArt kind="cake" size={24} />} bodyClassName="p-2 md:p-3">
          {bdays.length === 0 ? (
            <p className="p-2 text-[13px] text-[var(--lo-muted)]">Add a birthday to someone and it shows here.</p>
          ) : (
            <ul className="flex flex-col">
              {bdays.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => panel.open(p.id)} className="flex h-10 w-full items-center gap-2.5 rounded-[var(--lo-r-sm)] px-2 text-left hover:bg-[var(--lo-sunk)]">
                    <Avatar look={p.look} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="text-[12px] font-bold text-[var(--lo-muted)]">{p.next_birthday!.in_days === 0 ? 'Today' : p.next_birthday!.in_days === 1 ? 'Tomorrow' : `in ${p.next_birthday!.in_days} days`}{p.next_birthday!.age !== null ? ` · turns ${p.next_birthday!.age}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Plans together" art={<ThingArt kind="balloon" size={24} />}>
        <Plans events={(plans.data?.events ?? []).filter((e) => e.date >= today)} people={people} />
      </Panel>
    </>
  );
}

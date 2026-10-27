/**
 * The people in a life: little villager faces, how long since you were in
 * touch (a ring that empties as the time you set runs out), birthdays and
 * plans. One tap notes that you talked today.
 */
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, CalendarPlus, Gift, MessageCircle, Phone, RefreshCw, Trash2, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { longDay, MON, relDay } from '../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, tempId, useLive } from '../lib/live.ts';
import type { Circle, Interaction, Person, PersonDetail } from '../lib/types.ts';
import { Avatar, newLook } from './art.tsx';
import { ThingArt } from './art2.tsx';
import { Chip, InlineText } from './bits.tsx';
import { DateButton, RecordPicker } from './pickers.tsx';
import { snack } from './snack.tsx';
import { QuickAdd, TaskRow } from './tasks.tsx';
import { Button, Drawer, Skeleton, useConfirm } from './ui.tsx';

export function peopleChanged(): void {
  changed('people', 'interactions', 'events', 'tasks');
}

export const CIRCLES: { key: Circle; label: string }[] = [
  { key: 'partner', label: 'Partner' },
  { key: 'friends', label: 'Friends' },
  { key: 'family', label: 'Family' },
];

const TOUCH: { key: Interaction['kind']; label: string; icon: LucideIcon }[] = [
  { key: 'talk', label: 'Talked', icon: Phone },
  { key: 'message', label: 'Messaged', icon: MessageCircle },
  { key: 'meet', label: 'Met up', icon: Users },
  { key: 'gift', label: 'Gave a gift', icon: Gift },
];

const PEOPLE_READS = ['people', 'interactions', 'events', 'tasks', 'goals'] as const;

/** Being in touch: the person moves out of "time to reach out" at once. */
export async function touch(p: { id: string; name: string }, kind: Interaction['kind'] = 'talk'): Promise<void> {
  snack(`Noted: ${TOUCH.find((t) => t.key === kind)?.label.toLowerCase() ?? 'in touch'} with ${p.name}`);
  await act([patch<Person>(p.id, { last_contact: localDay(), days_since: 0, due: false, overdue_by: 0 })], () => op('people.touch', { person: p.id, kind }), [...PEOPLE_READS]);
}

export function sinceWords(p: Person): string {
  if (p.days_since === null) return 'Not noted yet';
  if (p.days_since === 0) return 'Today';
  if (p.days_since === 1) return 'Yesterday';
  if (p.days_since < 14) return `${p.days_since} days ago`;
  if (p.days_since < 60) return `${Math.round(p.days_since / 7)} weeks ago`;
  return `${Math.round(p.days_since / 30)} months ago`;
}

/** How full the keep-in-touch ring is (1 right after talking, 0 when it is time). */
function touchRing(p: Person): number | null {
  if (p.keep_in_touch_days <= 0) return null;
  if (p.days_since === null) return 0;
  return Math.max(0, 1 - p.days_since / p.keep_in_touch_days);
}

/* ------------------------------------------------------------- a face */

/** A person: the face in a ring that empties until it is time to get in touch. */
export function Face({ person, size = 64, onClick, showName = true, sub }: { person: Person; size?: number | undefined; onClick?: (() => void) | undefined; showName?: boolean | undefined; sub?: ReactNode | undefined }): React.JSX.Element {
  const ring = touchRing(person);
  const stroke = Math.max(3, Math.round(size / 18));
  const R = size / 2 + stroke + 1;
  const r = R - stroke / 2;
  const c = 2 * Math.PI * r;
  const bday = person.next_birthday !== null && person.next_birthday.in_days <= 7;
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col items-center text-center" title={person.due ? `Time to get in touch with ${person.name}` : person.name}>
      <span className="relative flex items-center justify-center rounded-full transition-transform group-hover:-translate-y-0.5" style={{ width: R * 2, height: R * 2 }}>
        <svg width={R * 2} height={R * 2} className="absolute inset-0 -rotate-90" aria-hidden>
          {ring !== null && <circle cx={R} cy={R} r={r} fill="none" stroke="var(--lo-track)" strokeWidth={stroke} />}
          {ring !== null && ring > 0 && <circle cx={R} cy={R} r={r} fill="none" stroke={ring < 0.25 ? 'var(--lo-amber)' : 'var(--lo-moss)'} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - ring)} strokeLinecap="round" />}
        </svg>
        <Avatar look={person.look} size={size} label={person.name} />
        {bday && (
          <span className="absolute -right-1 -top-1" title={`Birthday ${person.next_birthday?.in_days === 0 ? 'today' : 'in ' + person.next_birthday?.in_days + ' days'}`}>
            <ThingArt kind="cake" size={Math.round(size * 0.42)} />
          </span>
        )}
        {person.due && !bday && <span className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-[var(--lo-card)] bg-[var(--lo-amber)]" aria-hidden />}
      </span>
      {showName && <span className="mt-1.5 max-w-[96px] truncate text-[13px] font-bold">{person.name}</span>}
      {sub !== undefined && <span className="max-w-[110px] truncate text-[12px] font-semibold text-[var(--lo-muted)]">{sub}</span>}
    </button>
  );
}

/* ---------------------------------------------------------- the drawer */

interface PanelApi {
  open: (id: string) => void;
}

const Ctx = createContext<PanelApi>({ open: () => undefined });

export function usePersonPanel(): PanelApi {
  return useContext(Ctx);
}

export function PersonPanelProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((p: string) => setId(p), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {id !== null && <PersonDrawer id={id} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

/** Add someone: just a name (the circle comes from the page). */
export async function addPerson(name: string, circle: Circle): Promise<Person | false> {
  const look = newLook();
  const draft: Person = { id: tempId(), name, circle, area: 'relationships', relation: '', birthday: '', keep_in_touch_days: { partner: 0, friends: 30, family: 14 }[circle], last_contact: '', days_since: null, due: false, overdue_by: 0, next_birthday: null, look, links: [], notes: '', archived: false, actor: 'person' };
  const r = await act([insert((k, _o, list) => k === 'people' && list.every((x) => typeof x === 'object' && x !== null && 'circle' in x), draft)], () => op<{ person: Person }>('people.create', { name, circle, look }), [...PEOPLE_READS]);
  if (r === undefined) return false;
  snack(`${name} is in your ${CIRCLES.find((c) => c.key === circle)?.label.toLowerCase() ?? ''} circle`);
  return r.person;
}

function BirthdayField({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const md = value.length === 10 ? value.slice(5) : value;
  const m = md === '' ? '' : String(Number(md.slice(0, 2)));
  const d = md === '' ? '' : String(Number(md.slice(3, 5)));
  const set = (mm: string, dd: string): void => {
    if (mm === '' || dd === '') return;
    const days = new Date(2000, Number(mm), 0).getDate();
    const day = Math.min(Number(dd), days);
    onChange(String(mm).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
  };
  const cls = 'h-8 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]';
  return (
    <span className="inline-flex items-center gap-1.5">
      <select aria-label="Birthday day" value={d} onChange={(e) => set(m === '' ? '1' : m, e.target.value)} className={cls}>
        <option value="">Day</option>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
      <select aria-label="Birthday month" value={m} onChange={(e) => set(e.target.value, d === '' ? '1' : d)} className={cls}>
        <option value="">Month</option>
        {MON.map((l, i) => (
          <option key={l} value={String(i + 1)}>
            {l}
          </option>
        ))}
      </select>
      {value !== '' && (
        <button type="button" aria-label="Clear birthday" onClick={() => onChange('')} className="flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] hover:bg-[var(--lo-sunk)]">
          <X size={13} />
        </button>
      )}
    </span>
  );
}

/** Who this person knows: the lines between people on the connection map. */
function Knows({ person, onChange }: { person: PersonDetail; onChange: () => void }): React.JSX.Element {
  const everyone = useStatus().data?.people ?? [];
  const linked = everyone.filter((o) => person.links.includes(o.id));
  const others = everyone.filter((o) => o.id !== person.id && !person.links.includes(o.id));
  const set = async (other: string, linked: boolean): Promise<void> => {
    const flip = (id: string, to: string) => patch<Person>(id, (x) => ({ links: linked ? [...x.links.filter((l) => l !== to), to] : x.links.filter((l) => l !== to) }));
    await act([flip(person.id, other), flip(other, person.id)], () => op('people.link', { person: person.id, other, linked }), [...PEOPLE_READS]);
    onChange();
  };
  return (
    <div>
      <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Knows</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {linked.map((o) => (
          <span key={o.id} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--lo-r-sm)] border border-[var(--lo-hair)] bg-[var(--lo-card)] pl-1 pr-1 text-[13px] font-bold">
            <Avatar look={o.look} size={22} />
            {o.name}
            <button type="button" aria-label={`${person.name} does not know ${o.name}`} onClick={() => void set(o.id, false)} className="flex size-6 items-center justify-center rounded-[var(--lo-r-xs)] text-[var(--lo-muted)] hover:bg-[var(--lo-sunk)]">
              <X size={12} />
            </button>
          </span>
        ))}
        {others.length > 0 && <RecordPicker value="" placeholder="Someone they know" emptyLabel="Nobody" onChange={(v) => v !== '' && void set(v, true)} options={others.map((o) => ({ value: o.id, label: o.name, art: <Avatar look={o.look} size={20} /> }))} />}
        {everyone.length <= 1 && <span className="text-[12px] text-[var(--lo-muted)]">Add more people to connect them.</span>}
      </div>
    </div>
  );
}

function PlanAdd({ person, area, onDone }: { person: PersonDetail; area: string; onDone: () => void }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const add = async (): Promise<void> => {
    if (title.trim() === '' || date === '') return;
    await op('events.create', { title: title.trim(), date, person: person.id, area });
    peopleChanged();
    setTitle('');
    setDate('');
    snack('Plan made');
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder={`Dinner with ${person.name}`} aria-label="Plan" className="h-9 min-w-0 flex-1 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
      <DateButton value={date} today={today} onChange={setDate} placeholder="When" icon={CalendarPlus} />
      <Button variant="primary" size="sm" disabled={title.trim() === '' || date === ''} onClick={() => void add()}>
        Add plan
      </Button>
    </div>
  );
}

function PersonDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const live = useLive<{ person: PersonDetail }>((signal) => op('people.get', { person: id }, { quiet: true, signal }), ['people', 'interactions', 'events', 'tasks'], [id]);
  const [confirmEl, confirm] = useConfirm();
  const p = live.data?.person;
  const save = async (fields: Record<string, unknown>): Promise<void> => {
    await act([patch<Person>(id, fields as Partial<Person>)], () => op('people.update', { person: id, ...fields }), [...PEOPLE_READS]);
  };
  const remove = async (): Promise<void> => {
    if (p === undefined) return;
    if (!(await confirm(`${p.name} and the times you noted being in touch will be deleted. You can undo it right after.`, `Delete ${p.name}?`))) return;
    onClose();
    const r = await act([drop(id)], () => op('people.delete', { person: id }), [...PEOPLE_READS]);
    if (r !== undefined) snack(`Deleted ${p.name}`);
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={p !== undefined ? (CIRCLES.find((c) => c.key === p.circle)?.label ?? 'Person') : 'Person'}
      width={500}
      footer={
        p !== undefined ? (
          <>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" icon={Archive} onClick={() => void save({ archived: !p.archived })}>
              {p.archived ? 'Bring back' : 'Put away'}
            </Button>
          </>
        ) : undefined
      }
    >
      {confirmEl}
      {p === undefined ? (
        <div className="flex flex-col items-center gap-3 p-6">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : (
        <div className="pb-6">
          <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
            <div className="relative">
              <Face person={p} size={96} showName={false} />
              <button type="button" aria-label="A new look" title="A new look" onClick={() => void save({ look: newLook() })} className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border border-[var(--lo-hair)] bg-[var(--lo-card)] text-[var(--lo-ink-2)] shadow-[var(--lo-shadow-sm)] hover:text-[var(--lo-ink)]">
                <RefreshCw size={14} />
              </button>
            </div>
            <InlineText value={p.name} onSave={(v) => save({ name: v })} placeholder="Name" ariaLabel="Name" className="serif mt-2 text-center text-[26px] font-semibold leading-9" maxLength={80} />
            <InlineText value={p.relation} onSave={(v) => save({ relation: v })} placeholder="Who they are to you" ariaLabel="Relation" className="text-center text-[14px] font-semibold text-[var(--lo-ink-2)]" maxLength={60} />
            <p className="mt-1 text-[13px] font-semibold text-[var(--lo-muted)]">
              Last in touch: {sinceWords(p)}
              {p.next_birthday !== null && ` · Birthday ${p.next_birthday.in_days === 0 ? 'today' : relDay(p.next_birthday.date, today)}`}
            </p>
          </div>

          <div className="px-5">
            <div className="flex flex-wrap justify-center gap-2">
              {TOUCH.map((t) => (
                <Button key={t.key} variant={t.key === 'talk' ? 'primary' : 'soft'} size="md" icon={t.icon} onClick={() => void touch(p, t.key).then(() => live.reload())}>
                  {t.label} today
                </Button>
              ))}
            </div>
          </div>

          <div className="mx-5 mt-5 flex flex-col gap-4 border-t border-[var(--lo-hair)] pt-4">
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Keep in touch</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    [7, 'Every week'],
                    [14, 'Every 2 weeks'],
                    [30, 'Every month'],
                    [90, 'Every 3 months'],
                    [0, 'No reminder'],
                  ] as [number, string][]
                ).map(([n, l]) => (
                  <Chip key={n} active={p.keep_in_touch_days === n} onClick={() => void save({ keep_in_touch_days: n })}>
                    {l}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Circle</p>
              <div className="flex flex-wrap gap-1.5">
                {CIRCLES.map((c) => (
                  <Chip key={c.key} active={p.circle === c.key} onClick={() => void save({ circle: c.key })}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            </div>
            <Knows person={p} onChange={live.reload} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-bold text-[var(--lo-muted)]">Birthday</span>
              <BirthdayField value={p.birthday} onChange={(v) => void save({ birthday: v })} />
            </div>

            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Plans</p>
              {p.events.length > 0 && (
                <ul className="mb-2 flex flex-col gap-1">
                  {p.events.map((e) => (
                    <li key={e.id} className="flex h-9 items-center gap-2 rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-3 text-[14px] font-semibold">
                      <CalendarPlus size={14} className="shrink-0 text-[var(--lo-ink-2)]" />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="shrink-0 text-[12px] font-bold text-[var(--lo-muted)]">{relDay(e.date, today)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <PlanAdd person={p} area={p.area} onDone={live.reload} />
            </div>

            <div>
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">To do for {p.name}</p>
              {p.tasks
                .filter((t) => t.state === 'open')
                .map((t) => (
                  <TaskRow key={t.id} task={t} today={today} showArea={false} />
                ))}
              <QuickAdd defaults={{ person: p.id, column: 'inbox' }} placeholder={`Call ${p.name}, send a card...`} className="mt-1" />
            </div>

            <div>
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Remember</p>
              <InlineText multiline value={p.notes} onSave={(v) => save({ notes: v })} placeholder="Gift ideas, kids' names, what they are going through" className="text-[14px] leading-6" maxLength={4000} />
            </div>

            {p.interactions.length > 0 && (
              <div>
                <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Times in touch</p>
                <ul className="flex flex-col">
                  {p.interactions.slice(0, 12).map((i) => {
                    const T = TOUCH.find((t) => t.key === i.kind);
                    const Icon = T?.icon ?? MessageCircle;
                    return (
                      <li key={i.id} className="group flex h-9 items-center gap-2.5 rounded-[var(--lo-r-sm)] px-2 text-[13px] hover:bg-[var(--lo-sunk)]">
                        <Icon size={14} className="text-[var(--lo-ink-2)]" />
                        <span className="font-semibold">{T?.label ?? 'In touch'}</span>
                        {i.note !== '' && <span className="min-w-0 flex-1 truncate text-[var(--lo-ink-2)]">{i.note}</span>}
                        <span className={cn('ml-auto shrink-0 text-[12px] font-bold text-[var(--lo-muted)]')}>{longDay(i.date)}</span>
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={() => {
                            void act([drop(i.id)], () => op('people.untouch', { interaction: i.id }), [...PEOPLE_READS]);
                          }}
                          className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

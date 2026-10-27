/**
 * The board: a life on cards, like a pinboard of lists.
 *
 * Lists by time: Inbox (not placed yet), Today (with the weather, the top
 * three and how much is planned), Coming up (the next seven days, by day),
 * Later and Done. Every list has "Add a card" at its top; cards drag
 * between lists and up and down. Cards carry their area's color, the goal
 * they move, the person they are for, their steps and dates.
 *
 * The Week view lays the cards out on seven days with each day's weather and
 * plans, and the inbox beside them to drag from.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, Plus, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { addDays, between, minutes, MON, parseDay, rangeLabel, relDay, temp, WD, WEEKDAYS } from '../lib/format.ts';
import { READS, useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';
import type { Board, Column, Task, Week } from '../lib/types.ts';
import { AgentButton, ProposalCard, useProposals } from '../components/agent.tsx';
import { AREA_NAMES, AreaArt, WeatherArt, weatherWord } from '../components/art.tsx';
import type { AreaKind } from '../components/art.tsx';
import { ColumnArt } from '../components/art2.tsx';
import type { ColumnKind } from '../components/art2.tsx';
import { Chip, useKinds } from '../components/bits.tsx';
import { addTask, moveCard, TaskCard } from '../components/tasks.tsx';
import { LoadError, Segmented, Skeleton } from '../components/ui.tsx';

const EMPTY: Record<Column, string> = {
  inbox: 'Anything not placed yet lands here.',
  today: 'Drag cards here, or add one.',
  coming: 'The next seven days.',
  later: 'Someday, no rush.',
  done: 'Ticked off cards rest here for a week.',
};

/* ----------------------------------------------------------- the composer */

/** "Add a card" at the top of a list; it opens into a small note and stays open for the next one. */
function Composer({ onAdd, label = 'Add a card' }: { onAdd: (title: string) => Promise<unknown>; label?: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const busy = false;
  const add = async (): Promise<void> => {
    const t = text.trim();
    if (t === '') return;
    setText('');
    // The card is already on the list; the words come back only if the server refused it.
    if ((await onAdd(t)) === false) setText(t);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full items-center gap-2 rounded-[var(--lo-r)] px-2 text-[14px] font-bold text-[var(--lo-ink-2)] transition-colors hover:bg-[var(--lo-card)] hover:text-[var(--lo-ink)]">
        <span className="flex size-6 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] text-white">
          <Plus size={15} strokeWidth={3} />
        </span>
        {label}
      </button>
    );
  return (
    <div className="rounded-[var(--lo-r)] border border-[var(--lo-accent)] bg-[var(--lo-card)] p-2 shadow-[var(--lo-shadow)]">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setText('');
          }
        }}
        onBlur={() => {
          if (text.trim() === '') setOpen(false);
        }}
        rows={2}
        placeholder="What is it?"
        aria-label="New card"
        className="lo-autosize min-h-12 w-full resize-none bg-transparent px-1 text-[14px] font-semibold leading-5 outline-none placeholder:text-[var(--lo-muted)]"
      />
      <div className="mt-1 flex items-center gap-1">
        <button type="button" disabled={text.trim() === '' || busy} onClick={() => void add()} className="h-8 rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] px-3 text-[13px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)] disabled:opacity-50">
          Add card
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            setOpen(false);
            setText('');
          }}
          className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- dragging */

interface Drag {
  id: string;
  from: string;
}

/** Where in a list the pointer is: the index to drop before. */
function dropIndex(list: HTMLElement, y: number): number {
  const cards = [...list.querySelectorAll<HTMLElement>('[data-task]')];
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i]!.getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return cards.length;
}

function Lane({
  id,
  head,
  tasks,
  today,
  drag,
  setDrag,
  onDrop,
  composer,
  empty,
  className,
  children,
  group,
  compact = false,
}: {
  id: string;
  head: ReactNode;
  tasks: Task[];
  today: string;
  drag: Drag | null;
  setDrag: (d: Drag | null) => void;
  onDrop: (taskId: string, index: number, ids: string[]) => void;
  composer?: ReactNode | undefined;
  empty: string;
  className?: string | undefined;
  children?: ReactNode | undefined;
  group?: ((t: Task, prev: Task | undefined) => string | null) | undefined;
  compact?: boolean | undefined;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const ids = tasks.map((t) => t.id);
  return (
    <section
      aria-label={typeof head === 'string' ? head : id}
      onDragOver={(e) => {
        if (drag === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (list.current !== null) setOver(dropIndex(list.current, e.clientY));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const i = over ?? tasks.length;
        setOver(null);
        if (drag !== null) onDrop(drag.id, i, ids);
        setDrag(null);
      }}
      className={cn('flex max-h-full w-[300px] shrink-0 snap-start flex-col rounded-[var(--lo-r-xl)] border border-[var(--lo-hair)] bg-[var(--lo-sunk)] transition-shadow', over !== null && 'shadow-[0_0_0_2px_var(--lo-accent)]', className)}
    >
      <div className="shrink-0 px-3 pt-3">{head}</div>
      {composer !== undefined && <div className="shrink-0 px-2 pt-2">{composer}</div>}
      {children}
      <div ref={list} className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-2">
        {tasks.map((t, i) => {
          const label = group?.(t, tasks[i - 1]) ?? null;
          return (
            <div key={t.id} className="flex flex-col gap-2">
              {label !== null && <p className="px-1 pt-1 text-[12px] font-extrabold text-[var(--lo-ink-2)]">{label}</p>}
              {over === i && drag !== null && drag.id !== t.id && <span className="h-1 rounded-full bg-[var(--lo-accent)]" />}
              <TaskCard
                task={t}
                today={today}
                compact={compact}
                dragging={drag?.id === t.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                  setDrag({ id: t.id, from: id });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              />
            </div>
          );
        })}
        {over === tasks.length && drag !== null && <span className="h-1 rounded-full bg-[var(--lo-accent)]" />}
        {tasks.length === 0 && over === null && <p className="px-2 py-3 text-center text-[12px] font-semibold text-[var(--lo-muted)]">{empty}</p>}
      </div>
    </section>
  );
}

function LaneHead({ kind, title, count, extra }: { kind: ColumnKind; title: string; count: number; extra?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2">
        <ColumnArt kind={kind} size={30} />
        <h2 className="serif flex-1 text-[15px] font-semibold">{title}</h2>
        {count > 0 && <span className="num rounded-[var(--lo-r-xs)] bg-[var(--lo-card)] px-1.5 text-[12px] font-extrabold text-[var(--lo-ink-2)]">{count}</span>}
      </div>
      {extra}
    </div>
  );
}

/* ------------------------------------------------------------- the lists */

function move(list: Task[], id: string, index: number): string[] {
  const ids = list.map((t) => t.id).filter((x) => x !== id);
  ids.splice(Math.min(index, ids.length), 0, id);
  return ids;
}

function Lists({ board, area }: { board: Board; area: AreaKind | '' }): React.JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null);
  const today = board.today;
  const col = (k: Column): Task[] => board.columns.find((c) => c.key === k)?.tasks ?? [];
  const drop = (to: Column) => (taskId: string, index: number) => {
    const all = board.columns.flatMap((c) => c.tasks);
    const t = all.find((x) => x.id === taskId);
    if (t === undefined) return;
    const target = col(to).filter((x) => x.id !== taskId);
    const order = move(target, taskId, index);
    // In Coming up a card takes the day of the card it lands under (or above).
    let doDate: string | undefined;
    if (to === 'coming') {
      const prev = target[index - 1] ?? target[index];
      doDate = prev !== undefined && prev.do_date > today ? prev.do_date : t.do_date > today && between(today, t.do_date) <= 7 ? t.do_date : addDays(today, 1);
    }
    // It lands at once; the server's answer settles it.
    const fields: Partial<Task> = { column: to, state: to === 'done' ? 'done' : 'open', do_date: to === 'today' ? today : to === 'coming' ? (doDate ?? t.do_date) : to === 'inbox' || to === 'later' ? '' : t.do_date };
    const params: Record<string, unknown> = { task: taskId, column: to };
    if (to !== 'done') params.order = JSON.stringify(order);
    if (doDate !== undefined) params.do_date = doDate;
    void moveCard(t, fields, to !== 'done' ? order : null, params);
  };
  const add = (to: Exclude<Column, 'done'>) => (title: string) => addTask(title, { column: to, area: area !== '' ? area : undefined });
  const todayTasks = col('today');
  return (
    <div className="flex h-full snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 pb-4 md:snap-none md:px-8">
      <Lane id="inbox" head={<LaneHead kind="inbox" title="Inbox" count={col('inbox').length} extra={col('inbox').length >= 2 ? <div className="mt-1.5"><AgentButton kind="inbox" label="Sort with your AI agent" size="sm" variant="ghost" /></div> : undefined} />} tasks={col('inbox')} today={today} drag={drag} setDrag={setDrag} onDrop={drop('inbox')} composer={<Composer onAdd={add('inbox')} />} empty={EMPTY.inbox} />
      <Lane
        id="today"
        className="w-[320px] bg-[var(--lo-moss-soft)]"
        head={
          <LaneHead
            kind="today"
            title="Today"
            count={todayTasks.length}
            extra={
              board.meta.planned_min > 0 || board.meta.done_today > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-bold text-[var(--lo-ink-2)]">
                  {board.meta.planned_min > 0 && <span>{minutes(board.meta.planned_min)} planned</span>}
                  {board.meta.done_today > 0 && <span>{board.meta.done_today} done</span>}
                </div>
              ) : undefined
            }
          />
        }
        tasks={todayTasks}
        today={today}
        drag={drag}
        setDrag={setDrag}
        onDrop={drop('today')}
        composer={<Composer onAdd={add('today')} />}
        empty={EMPTY.today}
      />
      <Lane
        id="coming"
        head={<LaneHead kind="coming" title="Coming up" count={col('coming').length} />}
        tasks={col('coming')}
        today={today}
        drag={drag}
        setDrag={setDrag}
        onDrop={drop('coming')}
        composer={<Composer onAdd={add('coming')} label="Add for tomorrow" />}
        empty={EMPTY.coming}
        group={(t, prev) => (prev === undefined || prev.do_date !== t.do_date ? relDay(t.do_date, today) : null)}
      />
      <Lane id="later" head={<LaneHead kind="later" title="Later" count={col('later').length} />} tasks={col('later')} today={today} drag={drag} setDrag={setDrag} onDrop={drop('later')} composer={<Composer onAdd={add('later')} />} empty={EMPTY.later} />
      <Lane id="done" head={<LaneHead kind="done" title="Done" count={col('done').length} />} tasks={col('done')} today={today} drag={drag} setDrag={setDrag} onDrop={drop('done')} empty={EMPTY.done} group={(t, prev) => (prev === undefined || prev.done_date !== t.done_date ? relDay(t.done_date, today) : null)} />
      <span className="w-2 shrink-0" />
    </div>
  );
}

/* --------------------------------------------------------------- the week */

function WeekView({ start, area, onStart }: { start: string; area: AreaKind | ''; onStart: (d: string) => void }): React.JSX.Element {
  const live = useLive<Week>((signal) => op('board.week', start !== '' ? { start } : {}, { quiet: true, signal }), READS.board, [start]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const w = live.data;
  if (w === null) return <div className="px-8">{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />}</div>;
  const keep = (t: Task): boolean => area === '' || t.area === area;
  const drop = (d: string | null) => (taskId: string, index: number) => {
    const all = w.days.flatMap((x) => x.tasks).concat(w.inbox);
    const t = all.find((x) => x.id === taskId);
    if (t === undefined) return;
    const target = d === null ? w.inbox : (w.days.find((x) => x.date === d)?.tasks ?? []);
    const order = move(target.filter((x) => x.id !== taskId), taskId, index);
    const params: Record<string, unknown> = d === null ? { task: taskId, column: 'inbox', order: JSON.stringify(order) } : { task: taskId, column: d === w.today ? 'today' : 'coming', do_date: d, order: JSON.stringify(order) };
    const fields: Partial<Task> = d === null ? { column: 'inbox', do_date: '' } : { column: d === w.today ? 'today' : 'coming', do_date: d };
    void moveCard(t, fields, order, params);
  };
  const ws = parseDay(w.week_start);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-3 md:px-8">
        <button type="button" aria-label="Seven days earlier" onClick={() => onStart(addDays(w.week_start, -7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)]">
          <ChevronLeft size={16} />
        </button>
        <p className="serif text-[15px] font-semibold">{w.week_start === w.today ? 'The next seven days' : rangeLabel(w.week_start, w.week_end)}</p>
        <button type="button" aria-label="Seven days later" onClick={() => onStart(addDays(w.week_start, 7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)]">
          <ChevronRight size={16} />
        </button>
        {w.week_start !== w.today && (
          <Chip onClick={() => onStart(w.today)} className="h-7 text-[12px]">
            From today
          </Chip>
        )}
        <span className="ml-auto text-[12px] font-semibold text-[var(--lo-muted)]">{w.week_start === w.today ? rangeLabel(w.week_start, w.week_end) : MON[ws.getMonth()]}</span>
      </div>
      <div className="flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 pb-4 md:snap-none md:px-8">
        <Lane id="inbox" head={<LaneHead kind="inbox" title="Inbox" count={w.inbox.filter(keep).length} />} tasks={w.inbox.filter(keep)} compact today={w.today} drag={drag} setDrag={setDrag} onDrop={drop(null)} composer={<Composer onAdd={(t) => addTask(t, { column: 'inbox', area: area !== '' ? area : undefined }).then(() => live.reload())} />} empty="Nothing waiting." className="w-[200px]" />
        {w.days.map((d) => (
          <Lane
            key={d.date}
            id={d.date}
            className={cn('w-auto min-w-[150px] flex-1', d.is_today && 'bg-[var(--lo-moss-soft)]', d.past && 'opacity-80')}
            head={
              <div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[12px] font-extrabold', d.is_today ? 'text-[var(--lo-moss-text)]' : 'text-[var(--lo-muted)]')}>{d.is_today ? 'Today' : WEEKDAYS[parseDay(d.date).getDay()]}</p>
                    <p className="serif num text-[26px] font-semibold leading-8">{parseDay(d.date).getDate()}</p>
                  </div>
                  {d.weather !== null && (
                    <span className="flex flex-col items-center text-[12px] font-bold text-[var(--lo-ink-2)]" title={weatherWord(d.weather.code)}>
                      <WeatherArt code={d.weather.code} size={34} />
                      <span className="num">
                        {temp(d.weather.max)} / {temp(d.weather.min)}
                      </span>
                    </span>
                  )}
                </div>
                {d.events.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {d.events.map((e) => (
                      <li key={e.id} className="flex items-center gap-1.5 rounded-[var(--lo-r-sm)] bg-[var(--lo-card)] px-2 py-1 text-[12px] font-bold">
                        <span className="size-1.5 shrink-0 rounded-full bg-[var(--lo-accent)]" />
                        {e.time !== '' && <span className="num text-[var(--lo-muted)]">{e.time}</span>}
                        <span className="truncate">{e.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            }
            tasks={d.tasks.filter(keep).sort((a, b) => (a.state === b.state ? 0 : a.state === 'done' ? 1 : -1))}
            compact
            today={w.today}
            drag={drag}
            setDrag={setDrag}
            onDrop={drop(d.date)}
            composer={d.past ? undefined : <Composer label="Add" onAdd={(t) => addTask(t, { do_date: d.date, area: area !== '' ? area : undefined }).then(() => live.reload())} />}
            empty={d.past ? '' : 'Free'}
          />
        ))}
        <span className="w-2 shrink-0" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export default function BoardPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const status = useStatus().data;
  const kinds = useKinds();
  const view = query.get('view') === 'week' ? 'week' : 'lists';
  const area = (query.get('area') ?? '') as AreaKind | '';
  const start = query.get('start') ?? '';
  const live = useLive<Board>((signal) => op('board.get', area !== '' ? { area } : {}, { quiet: true, signal }), READS.board, [area]);
  const { proposals } = useProposals(['plan']);
  const waiting = proposals.filter((p) => p.status === 'waiting');
  const today = status?.today ?? '';
  const label = useMemo(() => (today !== '' ? `${WD[parseDay(today).getDay()]} ${parseDay(today).getDate()} ${MON[parseDay(today).getMonth()]}` : ''), [today]);
  return (
    <div className="flex h-[calc(100dvh-80px)] flex-col md:h-dvh">
      <header className="shrink-0 px-4 pb-3 pt-5 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-[var(--lo-muted)]">{label}</p>
            <h1 className="serif text-[26px] font-semibold leading-9">Board</h1>
          </div>
          <AgentButton kind="day_plan" label="Plan my day with your AI agent" size="md" variant="soft" />
          <Segmented
            label="View"
            value={view}
            onChange={(v) => replaceQuery({ view: v === 'week' ? 'week' : undefined })}
            options={[
              { value: 'lists', label: 'Lists', icon: Columns3 },
              { value: 'week', label: 'Week', icon: CalendarDays },
            ]}
          />
        </div>
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Chip active={area === ''} onClick={() => replaceQuery({ area: undefined })}>
            Everything
          </Chip>
          {kinds.map((k) => (
            <Chip key={k} active={area === k} tone={k} art={<AreaArt kind={k} size={20} />} onClick={() => replaceQuery({ area: area === k ? undefined : k })}>
              {AREA_NAMES[k]}
            </Chip>
          ))}
        </div>
        {waiting.length > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            {waiting.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {view === 'week' ? (
          <WeekView start={start} area={area} onStart={(d) => replaceQuery({ start: d === today ? undefined : d })} />
        ) : live.data === null ? (
          <div className="px-8">{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />}</div>
        ) : (
          <Lists board={live.data} area={area} />
        )}
      </div>
    </div>
  );
}

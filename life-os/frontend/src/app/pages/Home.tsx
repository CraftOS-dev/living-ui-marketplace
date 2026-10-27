/**
 * Home: today at a glance, in rows that read top to bottom.
 *
 * The landscape at the top shows the time of day, the season and the
 * weather outside; your AI agent's note sits on it. Then rows of one to
 * three panels, in the order the person dragged them into (kept in
 * settings.home_rows):
 *   Today (the list, with a big add)  | Heads up
 *   Habits                            | You today (mood, water, the journal)
 *   Goals                             | Money
 *   Coming up | People | Weather
 *   News
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { greetingFor, longDay, money, plural } from '../lib/format.ts';
import { changed, READS, useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import type { HomeSummary, Nudge, Settings } from '../lib/types.ts';
import { useWeather } from '../lib/world.ts';
import { AREA_NAMES, AreaArt, Avatar, HabitArt, Jar, Mascot } from '../components/art.tsx';
import { ColumnArt, ThingArt } from '../components/art2.tsx';
import type { ThingKind } from '../components/art2.tsx';
import { Meter } from '../components/bits.tsx';
import { ComingUp, HourStrip, MoodPicker, NewsList, PeopleToReach, PlaceSearch, QuickSpend, WaterGlasses, WeatherNow, WeatherWeek } from '../components/glance.tsx';
import { GoalTrail, useGoalPanel } from '../components/goals.tsx';
import { HabitIdeas, HabitTile } from '../components/habits.tsx';
import { useSky } from '../components/page.tsx';
import { Panel, PanelLink, SubHead } from '../components/panel.tsx';
import { usePersonPanel } from '../components/people.tsx';
import { Scene } from '../components/Scene.tsx';
import { WeatherSky } from '../components/sky.tsx';
import { QuickAdd, TaskRow } from '../components/tasks.tsx';
import { Button, IconButton, LoadError, Modal, Skeleton } from '../components/ui.tsx';

const NUDGE_ART: Record<Nudge['kind'], ThingKind> = { birthday: 'cake', reach: 'bubble', bill: 'envelope', weather: 'umbrella', trip: 'suitcase', chores: 'basket' };

/** What needs you today, one per line. */
function HeadsUp({ nudges }: { nudges: Nudge[] }): React.JSX.Element {
  const person = usePersonPanel();
  if (nudges.length === 0) return <p className="text-[13px] text-[var(--lo-muted)]">Nothing needs you right now.</p>;
  return (
    <ul className="-mx-2 flex flex-col">
      {nudges.map((n, i) => (
        <li key={n.kind + i}>
          <button
            type="button"
            onClick={() => {
              if (n.person !== undefined) person.open(n.person.id);
              else if (n.area !== '') navigate('area', { kind: n.area });
            }}
            className="flex w-full items-center gap-3 rounded-[var(--lo-r)] px-2 py-2 text-left hover:bg-[var(--lo-sunk)]"
          >
            {n.person !== undefined ? (
              <span className="relative shrink-0">
                <Avatar look={n.person.look} size={34} />
                <span className="absolute -bottom-1 -right-1">
                  <ThingArt kind={NUDGE_ART[n.kind] ?? 'star'} size={18} />
                </span>
              </span>
            ) : (
              <ThingArt kind={NUDGE_ART[n.kind] ?? 'star'} size={34} className="shrink-0" />
            )}
            <span className="text-[13px] font-semibold leading-5">{n.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What your AI agent says about today, or the day in a sentence when it has not written yet. */
function dayLine(h: HomeSummary): string {
  if (h.day.agent_note !== '') return h.day.agent_note;
  const open = h.tasks.filter((t) => t.state === 'open').length;
  const parts: string[] = [];
  parts.push(open === 0 ? 'Nothing on your list yet' : `${plural(open, 'thing')} on your list`);
  const due = h.habits.filter((x) => x.today.due && !x.today.done).length;
  if (due > 0) parts.push(`${plural(due, 'habit')} to tick`);
  const first = h.nudges[0];
  return parts.join(', ') + '.' + (first !== undefined ? ' ' + first.text.replace(/\.$/, '') + '.' : '');
}

function Hero({ h }: { h: HomeSummary }): React.JSX.Element {
  const sky = useSky();
  const { weather } = useWeather();
  return (
    <Scene height={260} seed="home" part={sky.part} season={sky.season} variant="home" className="border-b border-[var(--lo-hair)]">
      {weather !== null && <WeatherSky code={weather.current.code} />}
      <div className="relative mx-auto flex h-full max-w-[1320px] flex-col justify-between gap-4 px-4 pb-5 pt-6 md:flex-row md:items-start md:px-8">
        <div className="min-w-0 max-w-[560px]">
          <p className="text-[13px] font-bold text-[var(--lo-on-sky-muted)]">{longDay(h.date)}</p>
          <h1 className="serif text-[26px] font-semibold leading-9 text-[var(--lo-on-sky)]">
            {greetingFor(h.now.part)}
            {h.owner_name !== '' ? `, ${h.owner_name}` : ''}
          </h1>
          <div className="mt-3 flex items-end gap-2">
            <Mascot size={52} className="shrink-0" />
            <a href={href('agent')} className="relative mb-3 max-w-[440px] rounded-[var(--lo-r-lg)] rounded-bl-[4px] bg-[var(--lo-card)] px-4 py-2.5 text-[14px] font-semibold leading-5 shadow-[var(--lo-shadow)] hover:shadow-[var(--lo-shadow-lg)]" title="Your AI agent">
              {dayLine(h)}
            </a>
          </div>
        </div>
        <div className="hidden w-[300px] shrink-0 md:block">{weather !== null ? <WeatherNow weather={weather} /> : h.place === null ? <PlaceSearch /> : null}</div>
      </div>
    </Scene>
  );
}

function TodayList({ h }: { h: HomeSummary }): React.JSX.Element {
  const [showDone, setShowDone] = useState(false);
  const open = h.tasks.filter((t) => t.state === 'open');
  const top = open.filter((t) => t.top);
  const rest = open.filter((t) => !t.top);
  const done = h.tasks.filter((t) => t.state === 'done');
  return (
    <div>
      <QuickAdd big defaults={{ column: 'today' }} placeholder="What do you want to do today?" />
      {top.length > 0 && (
        <div className="mt-4">
          <p className="px-2 pb-0.5 text-[12px] font-extrabold text-[var(--lo-art-honey-text)]">Top {top.length === 1 ? 'one' : top.length === 2 ? 'two' : 'three'}</p>
          {top.map((t) => (
            <TaskRow key={t.id} task={t} today={h.date} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className={cn(top.length > 0 ? 'mt-1 border-t border-[var(--lo-hair)] pt-1' : 'mt-3')}>
          {rest.map((t) => (
            <TaskRow key={t.id} task={t} today={h.date} />
          ))}
        </div>
      )}
      {open.length === 0 && done.length === 0 && <p className="px-2 pt-3 text-[13px] text-[var(--lo-muted)]">A clear day. Add the one thing that would make it a good one.</p>}
      {done.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowDone(!showDone)} className="flex h-8 items-center gap-1 rounded-[var(--lo-r-sm)] px-2 text-[12px] font-bold text-[var(--lo-muted)] hover:bg-[var(--lo-sunk)]">
            {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {done.length} done today
          </button>
          {showDone && done.map((t) => <TaskRow key={t.id} task={t} today={h.date} />)}
        </div>
      )}
    </div>
  );
}

/** You today: how the day feels, the water, sleep and steps, and the journal. */
function YouToday({ h }: { h: HomeSummary }): React.JSX.Element {
  const latest = h.journal.latest[0];
  const todays = latest !== undefined && latest.date === h.date ? latest : undefined;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>How is today?</SubHead>
        <MoodPicker value={h.day.mood} size={36} />
      </div>
      <div className="border-t border-[var(--lo-hair)] pt-4">
        <SubHead action={<PanelLink to={href('area', { kind: 'health' })}>Health</PanelLink>}>Water</SubHead>
        <WaterGlasses log={h.health.log} goal={h.health.goals.water} size={24} />
        <p className="mt-2 text-[12px] font-semibold text-[var(--lo-muted)]">
          {h.health.log.water} of {h.health.goals.water} glasses
          {h.health.log.sleep_h > 0 ? ` · slept ${h.health.log.sleep_h} h` : ''}
          {h.health.log.steps > 0 ? ` · ${h.health.log.steps.toLocaleString()} steps` : ''}
          {h.health.workouts > 0 ? ` · ${plural(h.health.workouts, 'workout')}` : ''}
        </p>
      </div>
      <div className="border-t border-[var(--lo-hair)] pt-4">
        <SubHead action={<PanelLink to={href('journal')}>{todays !== undefined ? 'Open' : 'Write'}</PanelLink>}>Journal</SubHead>
        {latest !== undefined ? (
          <a href={href('journal', { entry: latest.id })} className="block rounded-[var(--lo-r)] bg-[var(--lo-sunk)] px-3 py-2 hover:bg-[var(--lo-sunk-hover)]">
            <span className="block text-[12px] font-bold text-[var(--lo-muted)]">{todays !== undefined ? 'Today' : longDay(latest.date)}</span>
            <span className="serif line-clamp-2 text-[14px] leading-6">{latest.body}</span>
          </a>
        ) : (
          <p className="text-[13px] text-[var(--lo-muted)]">A few lines about today, whenever you like.</p>
        )}
      </div>
    </div>
  );
}

function MoneyGlance({ m }: { m: NonNullable<HomeSummary['money']> }): React.JSX.Element {
  const fmt = (v: number): string => money(v, m.currency, m.digits, { whole: Math.abs(v) >= 100 * Math.pow(10, m.digits) });
  return (
    <div className="flex flex-col gap-4">
      {m.budget > 0 && m.left !== null ? (
        <div className="flex items-center gap-3">
          <Jar fill={m.budget > 0 ? Math.max(0, m.left) / m.budget : 0} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">
              <span className={cn('num text-[15px] font-extrabold', m.left < 0 && 'text-[var(--lo-red-text)]')}>{fmt(Math.abs(m.left))}</span> {m.left < 0 ? 'over budget' : 'left this month'}
            </p>
            {m.per_day_left !== null && m.left > 0 && <p className="text-[12px] font-semibold text-[var(--lo-muted)]">About {fmt(m.per_day_left)} a day</p>}
            <Meter value={m.budget > 0 ? m.spent / m.budget : 0} color={m.left < 0 ? 'var(--lo-red)' : 'var(--lo-k-money)'} className="mt-1.5" label="Spent of the budget" />
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--lo-ink-2)]">
          <span className="num font-extrabold">{fmt(m.spent)}</span> spent this month.{' '}
          <a href={href('area', { kind: 'money' })} className="font-bold underline-offset-4 hover:underline">
            Set a budget
          </a>
        </p>
      )}
      <div className="border-t border-[var(--lo-hair)] pt-4">
        <QuickSpend categories={6} />
      </div>
    </div>
  );
}

type RowKey = 'today' | 'habits' | 'goals' | 'days' | 'news';
const DEFAULT_ROWS: RowKey[] = ['today', 'habits', 'goals', 'days', 'news'];
const ROW_NAMES: Record<RowKey, string> = { today: 'Today', habits: 'Habits and you', goals: 'Goals and money', days: 'Coming up, people and weather', news: 'News' };

interface Cell {
  key: string;
  wide: 1 | 2 | 3;
  node: ReactNode;
}

/**
 * One row of Home: one to three panels side by side (stacked on smaller
 * screens), and a handle at its left to drag the row up or down (or move it
 * with the arrow keys).
 */
function HomeRow({ id, cells, dragging, over, onDragStart, onDragEnd, onOver, onDrop, onMove }: { id: RowKey; cells: Cell[]; dragging: boolean; over: 'before' | 'after' | null; onDragStart: () => void; onDragEnd: () => void; onOver: (where: 'before' | 'after') => void; onDrop: () => void; onMove: (by: -1 | 1) => void }): React.JSX.Element {
  return (
    <section
      aria-label={ROW_NAMES[id]}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onOver(e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn('group/row relative', dragging && 'opacity-50')}
    >
      {over === 'before' && <span aria-hidden className="absolute -top-3 left-0 right-0 h-1 rounded-full bg-[var(--lo-accent)]" />}
      {over === 'after' && <span aria-hidden className="absolute -bottom-3 left-0 right-0 h-1 rounded-full bg-[var(--lo-accent)]" />}
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
          const row = e.currentTarget.closest('section');
          if (row !== null) e.dataTransfer.setDragImage(row, 40, 24);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onMove(-1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onMove(1);
          }
        }}
        aria-label={`Move the row ${ROW_NAMES[id]}`}
        title="Drag to move this row"
        className="absolute -left-7 top-3 hidden size-6 cursor-grab items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-40 transition-opacity hover:bg-[var(--lo-sunk)] hover:text-[var(--lo-ink)] focus:opacity-100 active:cursor-grabbing group-hover/row:opacity-100 md:flex"
      >
        <GripVertical size={16} />
      </button>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {cells.map((c) => (
          <div key={c.key} className={cn('flex min-w-0 flex-col', c.wide === 2 ? 'xl:col-span-2' : c.wide === 3 ? 'xl:col-span-3' : '')}>
            {c.node}
          </div>
        ))}
      </div>
    </section>
  );
}

/** On a phone there is no room to drag rows: a short list of them with up and down instead. */
function ArrangeRows({ rows, onMove }: { rows: RowKey[]; onMove: (key: RowKey, by: -1 | 1) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-center md:hidden">
      <Button variant="ghost" icon={ArrowUpDown} onClick={() => setOpen(true)}>
        Arrange Home
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Arrange Home" description="The order of the rows on Home." width={420} footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
        <ol className="flex flex-col gap-1.5">
          {rows.map((key, i) => (
            <li key={key} className="flex h-12 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-sunk)] pl-3 pr-1">
              <span className="num w-5 text-[13px] font-extrabold text-[var(--lo-muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{ROW_NAMES[key]}</span>
              <IconButton icon={ArrowUp} label={`Move ${ROW_NAMES[key]} up`} size={40} disabled={i === 0} onClick={() => onMove(key, -1)} />
              <IconButton icon={ArrowDown} label={`Move ${ROW_NAMES[key]} down`} size={40} disabled={i === rows.length - 1} onClick={() => onMove(key, 1)} />
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}

export default function HomePage(): React.JSX.Element {
  const goals = useGoalPanel();
  const live = useLive<HomeSummary>((signal) => op('home.summary', {}, { quiet: true, signal }), READS.life, []);
  const { weather } = useWeather();
  const settings = useLive<{ settings: Settings }>((signal) => op('settings.get', {}, { quiet: true, signal }), ['settings'], []);
  const [order, setOrder] = useState<RowKey[] | null>(null);
  const [drag, setDrag] = useState<RowKey | null>(null);
  const [over, setOver] = useState<{ key: RowKey; where: 'before' | 'after' } | null>(null);
  const saved = settings.data?.settings.home_rows as RowKey[] | undefined;
  const rows: RowKey[] = order ?? (saved !== undefined && saved.length === DEFAULT_ROWS.length ? saved : DEFAULT_ROWS);
  const save = (next: RowKey[]): void => {
    setOrder(next);
    void op('settings.update', { home_rows: JSON.stringify(next) }, { quiet: true }).then(() => changed('settings'));
  };
  const drop = (): void => {
    if (drag === null || over === null || drag === over.key) {
      setDrag(null);
      setOver(null);
      return;
    }
    const rest = rows.filter((r) => r !== drag);
    const at = rest.indexOf(over.key) + (over.where === 'after' ? 1 : 0);
    rest.splice(at, 0, drag);
    setDrag(null);
    setOver(null);
    save(rest);
  };
  const move = (key: RowKey, by: -1 | 1): void => {
    const i = rows.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    next[i] = next[j] as RowKey;
    next[j] = key;
    save(next);
  };
  const h = live.data;
  if (h === null) {
    return (
      <div>
        <div className="h-[260px] border-b border-[var(--lo-hair)] bg-[var(--lo-sunk)]" />
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-6 px-4 py-6 md:px-8 lg:grid-cols-[1fr_380px]">{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />}</div>
      </div>
    );
  }
  const on = (k: string): boolean => h.areas.includes(k as never);
  const people = on('relationships');
  const open = h.tasks.filter((t) => t.state === 'open').length;
  const habitsDue = h.habits.filter((x) => x.today.due).length;
  const habitsDone = h.habits.filter((x) => x.today.done).length;
  const todayPanel = (
    <Panel className="flex-1" title="Today" art={<ColumnArt kind="today" size={26} />} note={open > 0 ? `${open} to do` : undefined} action={<PanelLink to={href('board')}>Board</PanelLink>}>
      <TodayList h={h} />
    </Panel>
  );
  const headsUp = (
    <Panel className="flex-1" title="Heads up" art={<ThingArt kind="umbrella" size={24} />}>
      <HeadsUp nudges={h.nudges} />
    </Panel>
  );
  const habitsPanel = (
    <Panel className="flex-1" title="Habits" art={<HabitArt art="sprout" size={26} />} note={habitsDue > 0 ? `${habitsDone} of ${habitsDue} done` : undefined} action={<PanelLink to={href('habits')}>Tracker</PanelLink>}>
      {h.habits.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] justify-items-center gap-y-5">
          {h.habits.map((x) => (
            <HabitTile key={x.id} habit={x} />
          ))}
        </div>
      ) : (
        <HabitIdeas have={[]} limit={8} />
      )}
    </Panel>
  );
  const youToday = (
    <Panel className="flex-1" title="You today" art={<ThingArt kind="balloon" size={24} />}>
      <YouToday h={h} />
    </Panel>
  );
  const goalsPanel = (
    <Panel className="flex-1" title="Goals" art={<ThingArt kind="flag" size={24} />} action={h.goals.length > 0 ? <PanelLink to={href('life')}>My life</PanelLink> : undefined}>
      {h.goals.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
          {h.goals.slice(0, 4).map((g) => (
            <GoalTrail key={g.id} goal={g} onOpen={() => goals.open(g.id)} />
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => goals.create()} className="flex w-full items-center gap-3 rounded-[var(--lo-r-lg)] border border-dashed border-[var(--lo-line)] px-4 py-3 text-left hover:border-solid hover:border-[var(--lo-moss)]">
          <ThingArt kind="flag" size={40} />
          <span>
            <span className="block text-[14px] font-bold">Something you want to reach?</span>
            <span className="block text-[13px] text-[var(--lo-muted)]">Saving for a trip, reading more, a healthier weight. It keeps count for you.</span>
          </span>
        </button>
      )}
    </Panel>
  );
  const moneyPanel =
    on('money') && h.money !== null ? (
      <Panel className="flex-1" title="Money" art={<AreaArt kind="money" size={26} />} action={<PanelLink to={href('area', { kind: 'money' })}>Open</PanelLink>}>
        <MoneyGlance m={h.money} />
      </Panel>
    ) : null;
  const comingPanel = (
    <Panel className="flex-1" title="Coming up" art={<ColumnArt kind="coming" size={24} />} action={<PanelLink to={href('board', { view: 'week' })}>Week</PanelLink>}>
      <ComingUp items={h.coming} today={h.date} />
    </Panel>
  );
  const peoplePanel = people ? (
    <Panel className="flex-1" title="People" art={<AreaArt kind="relationships" size={26} />} action={<PanelLink to={href('area', { kind: 'relationships' })}>Open</PanelLink>}>
      {h.people.count === 0 ? (
        <p className="text-[13px] text-[var(--lo-ink-2)]">
          Add the people who matter in{' '}
          <a href={href('area', { kind: 'relationships' })} className="font-bold underline-offset-4 hover:underline">
            {AREA_NAMES.relationships}
          </a>
          . You will be nudged when it has been a while.
        </p>
      ) : h.people.due.length === 0 && h.people.birthdays.filter((p) => (p.next_birthday?.in_days ?? 99) <= 14).length === 0 ? (
        <p className="text-[13px] text-[var(--lo-ink-2)]">Everyone is in touch.</p>
      ) : (
        <PeopleToReach due={h.people.due} birthdays={h.people.birthdays} limit={3} />
      )}
    </Panel>
  ) : null;
  const weatherPanel = (wide: boolean): ReactNode =>
    weather !== null ? (
      <Panel className="flex-1" title="Weather" art={<ThingArt kind="umbrella" size={24} />} note={weather.place.city}>
        <div className={cn('grid grid-cols-1 gap-5', wide && 'md:grid-cols-2')}>
          <div>
            <SubHead>The next hours</SubHead>
            <HourStrip weather={weather} hours={wide ? 7 : 6} />
          </div>
          <div>
            <SubHead>The week</SubHead>
            <WeatherWeek weather={weather} />
          </div>
        </div>
      </Panel>
    ) : null;
  const cellsOf = (key: RowKey): Cell[] => {
    if (key === 'today')
      return [
        { key: 'today', wide: 2, node: todayPanel },
        { key: 'heads', wide: 1, node: headsUp },
      ];
    if (key === 'habits')
      return [
        { key: 'habits', wide: 2, node: habitsPanel },
        { key: 'you', wide: 1, node: youToday },
      ];
    if (key === 'goals')
      return moneyPanel !== null
        ? [
            { key: 'goals', wide: 2, node: goalsPanel },
            { key: 'money', wide: 1, node: moneyPanel },
          ]
        : [{ key: 'goals', wide: 3, node: goalsPanel }];
    if (key === 'days') {
      const parts = [
        { key: 'coming', node: comingPanel as ReactNode | null },
        { key: 'people', node: peoplePanel as ReactNode | null },
      ].filter((x) => x.node !== null);
      const n = parts.length + (weather !== null ? 1 : 0);
      const cells: Cell[] = parts.map((x) => ({ key: x.key, wide: n === 1 ? 3 : 1, node: x.node }));
      if (weather !== null) cells.push({ key: 'weather', wide: n === 3 ? 1 : n === 2 ? 2 : 3, node: weatherPanel(n < 3) });
      return cells;
    }
    return [
      {
        key: 'news',
        wide: 3,
        node: (
          <Panel className="flex-1" title="News" art={<ThingArt kind="envelope" size={24} />}>
            <NewsList limit={8} columns />
          </Panel>
        ),
      },
    ];
  };
  return (
    <div>
      <Hero h={h} />
      <div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-4 pb-12 pt-5 md:px-8">
        {weather !== null && (
          <div className="md:hidden">
            <WeatherNow weather={weather} />
          </div>
        )}
        {weather === null && h.place === null && (
          <div className="md:hidden">
            <PlaceSearch />
          </div>
        )}
        {rows.map((key) => (
          <HomeRow
            key={key}
            id={key}
            cells={cellsOf(key)}
            dragging={drag === key}
            over={over !== null && over.key === key && drag !== null && drag !== key ? over.where : null}
            onDragStart={() => setDrag(key)}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onOver={(where) => {
              if (drag !== null) setOver({ key, where });
            }}
            onDrop={drop}
            onMove={(by) => move(key, by)}
          />
        ))}
        <ArrangeRows rows={rows} onMove={move} />
      </div>
    </div>
  );
}

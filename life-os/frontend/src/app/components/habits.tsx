/**
 * Habits as a tracker: big drawn buttons to tap for today (counted habits
 * fill a ring one tap at a time), a grid of the last two weeks where any
 * square can be tapped, one-tap suggestions to start a habit, and a habit's
 * drawer (its year, its numbers, its schedule).
 */
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Archive, Check, Flame, MoreHorizontal, SkipForward, Trash2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { enter } from '../lib/motion.ts';
import { useStatus } from '../lib/context.tsx';
import { addDays, parseDay, WD1 } from '../lib/format.ts';
import { act, changed, drop, patch, useLive } from '../lib/live.ts';
import type { Habit, HabitDetail } from '../lib/types.ts';
import { AREA_NAMES, HABIT_ARTS, HabitArt } from './art.tsx';
import type { AreaKind } from './art.tsx';
import { AreaChoice, Chip, InlineText, kindColor, Stepper, useKinds } from './bits.tsx';
import { AgentButton } from './agent.tsx';
import { Heatmap } from './charts.tsx';
import { RecordPicker, WeekdayPicker } from './pickers.tsx';
import { snack } from './snack.tsx';
import { Button, Drawer, Skeleton, useConfirm } from './ui.tsx';

export function habitsChanged(): void {
  changed('habits', 'habit_logs', 'goals', 'days');
}

const HABIT_READS = ['habits', 'habit_logs', 'goals', 'days', 'health_logs'] as const;

/** What a tap does to a habit, shown before the server answers (the server's numbers settle it). */
function tapped(h: Habit, date: string | undefined): Partial<Habit> {
  const isToday = date === undefined || h.cells.length === 0 || date === h.cells[h.cells.length - 1]!.date;
  const cell = date === undefined ? undefined : h.cells.find((c) => c.date === date);
  const was = isToday ? (h.today.skipped ? 0 : h.today.value) : cell === undefined || cell.state === 'skip' ? 0 : cell.value;
  const wasDone = isToday ? h.today.done : cell?.state === 'done';
  const next = h.target <= 1 ? (wasDone ? 0 : 1) : was >= h.target ? 0 : was + 1;
  const done = next >= h.target;
  const day = date ?? (h.cells.length > 0 ? h.cells[h.cells.length - 1]!.date : '');
  const cells = h.cells.map((c) => (c.date === day ? { ...c, value: next, state: done ? ('done' as const) : next > 0 ? ('part' as const) : ('open' as const) } : c));
  const out: Partial<Habit> = { cells };
  if (isToday) {
    out.today = { ...h.today, value: next, done, skipped: false };
    out.streak = done && !wasDone ? h.streak + 1 : !done && wasDone ? Math.max(0, h.streak - 1) : h.streak;
  }
  return out;
}

/** Tap a habit (today, or a day on the tracker): it fills at once, the server counts behind. */
export async function tapHabit(h: Habit, date?: string | undefined): Promise<Habit | undefined> {
  const r = await act([patch<Habit>(h.id, tapped(h, date))], () => op<{ habit: Habit }>('habits.tap', date !== undefined ? { habit: h.id, date } : { habit: h.id }), [...HABIT_READS]);
  return r?.habit;
}

/* ------------------------------------------------------------ the drawer */

const Ctx = createContext<(id: string) => void>(() => undefined);

export function useHabitPanel(): (id: string) => void {
  return useContext(Ctx);
}

export function HabitPanelProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((h: string) => setId(h), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {id !== null && <HabitDrawer id={id} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------- the words */

export function streakWords(h: Habit): string {
  if (h.schedule === 'per_week' && h.week !== null) return `${h.week.done} of ${h.week.times} this week`;
  if (h.streak > 0) return `${h.streak} day${h.streak === 1 ? '' : 's'} in a row`;
  if (h.best > 0) return `Best: ${h.best} in a row`;
  return h.schedule === 'weekdays' ? 'On chosen days' : 'Every day';
}

function ringValue(h: Habit): number {
  if (h.today.done) return 1;
  if (h.target > 1) return Math.min(1, h.today.value / h.target);
  return 0;
}

/* -------------------------------------------------------------- the tile */

/**
 * Today's button for a habit: the drawing inside a ring that fills. Tap it
 * to tick it off (a counted habit counts up one per tap); the small button
 * opens the habit.
 */
export function HabitTile({ habit, size = 'md' }: { habit: Habit; size?: 'sm' | 'md' | 'lg' | undefined }): React.JSX.Element {
  const open = useHabitPanel();
  const [pop, setPop] = useState(0);
  const d = size === 'lg' ? 104 : size === 'sm' ? 68 : 88;
  const art = size === 'lg' ? 60 : size === 'sm' ? 40 : 52;
  const stroke = size === 'sm' ? 5 : 7;
  const r = (d - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = ringValue(habit);
  const done = habit.today.done;
  const resting = !habit.today.due && !done;
  const tap = async (): Promise<void> => {
    setPop((p) => p + 1);
    const becomesDone = !habit.today.done && (habit.target <= 1 || habit.today.value + 1 >= habit.target);
    if (becomesDone) snack(`${habit.name}: done for today`);
    const h = await tapHabit(habit);
    if (becomesDone && h !== undefined && h.streak > 1) snack(`${h.name}: ${h.streak} days in a row`);
  };
  const color = habit.area !== '' ? kindColor(habit.area) : 'var(--lo-moss)';
  return (
    <div className={cn('group relative flex flex-col items-center text-center', size === 'sm' ? 'w-[84px]' : size === 'lg' ? 'w-[132px]' : 'w-[112px]', enter(habit.id))}>
      <button
        type="button"
        onClick={() => void tap()}
        aria-label={done ? `${habit.name}: done today. Tap to undo` : habit.target > 1 ? `${habit.name}: ${habit.today.value} of ${habit.target}. Tap to add one` : `Tick off ${habit.name}`}
        title={habit.cue !== '' ? habit.cue : undefined}
        className={cn('relative flex items-center justify-center rounded-full transition-transform active:scale-95', resting && 'opacity-60')}
        style={{ width: d, height: d }}
      >
        <svg width={d} height={d} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={d / 2} cy={d / 2} r={r} fill={done ? 'var(--lo-moss-soft)' : 'var(--lo-card)'} stroke="var(--lo-track)" strokeWidth={stroke} />
          {v > 0 && <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={done ? 'var(--lo-moss)' : color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 420ms ease' }} />}
        </svg>
        <span key={pop} className={cn('relative', pop > 0 && 'lo-check-pop')}>
          <HabitArt art={habit.art} size={art} />
        </span>
        {done && (
          <span className="lo-check-pop absolute -right-0.5 bottom-0.5 flex size-7 items-center justify-center rounded-full border-2 border-[var(--lo-card)] bg-[var(--lo-moss)] text-white">
            <Check size={15} strokeWidth={3.2} />
          </span>
        )}
        {!done && habit.target > 1 && (
          <span className="num absolute -bottom-1 rounded-[var(--lo-r-xs)] bg-[var(--lo-card)] px-1.5 text-[12px] font-extrabold shadow-[var(--lo-shadow-sm)]">
            {habit.today.value}/{habit.target}
          </span>
        )}
      </button>
      <span className="mt-2 line-clamp-2 text-[13px] font-bold leading-4">{habit.name}</span>
      <span className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--lo-muted)]">
        {habit.streak >= 3 && <Flame size={12} className="text-[var(--lo-art-clay)]" />}
        {resting ? 'Resting today' : streakWords(habit)}
      </span>
      <button type="button" aria-label={`Open ${habit.name}`} onClick={() => open(habit.id)} className="hit absolute right-0 top-0 flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-card)] text-[var(--lo-ink-2)] opacity-0 shadow-[var(--lo-shadow-sm)] transition-opacity hover:text-[var(--lo-ink)] focus:opacity-100 group-hover:opacity-100">
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- the grid */

function Cell({ state, value, target, onClick, label, today }: { state: Habit['cells'][number]['state']; value: number; target: number; onClick?: (() => void) | undefined; label: string; today: boolean }): React.JSX.Element {
  const body =
    state === 'done' ? (
      <span className="flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-moss)] text-white">
        <Check size={14} strokeWidth={3.2} />
      </span>
    ) : state === 'part' ? (
      <span className="relative size-7 overflow-hidden rounded-[var(--lo-r-sm)] bg-[var(--lo-track)]">
        <span className="absolute inset-x-0 bottom-0 bg-[var(--lo-moss)] opacity-70" style={{ height: `${Math.min(1, value / Math.max(1, target)) * 100}%` }} />
      </span>
    ) : state === 'skip' ? (
      <span className="flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] border-2 border-dashed border-[var(--lo-line)] text-[var(--lo-muted)]">
        <SkipForward size={11} />
      </span>
    ) : state === 'rest' ? (
      <span className="flex size-7 items-center justify-center">
        <span className="size-1.5 rounded-full bg-[var(--lo-line)]" />
      </span>
    ) : state === 'before' ? (
      <span className="size-7" />
    ) : (
      <span className={cn('size-7 rounded-[var(--lo-r-sm)] border-2', today ? 'border-[var(--lo-moss)] border-dashed' : 'border-[var(--lo-track)] bg-[var(--lo-sunk)]')} />
    );
  if (onClick === undefined || state === 'before') return <span className="flex size-9 items-center justify-center">{body}</span>;
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-9 items-center justify-center rounded-[var(--lo-r-sm)] transition-transform hover:scale-110">
      {body}
    </button>
  );
}

/** The tracker: one row per habit, the last two weeks as squares to tap. */
export function HabitGrid({ habits, today, days = 14 }: { habits: Habit[]; today: string; days?: number | undefined }): React.JSX.Element {
  const open = useHabitPanel();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[var(--lo-card)]" />
            {dates.map((d) => (
              <th key={d} className="px-0 pb-1 text-center">
                <span className={cn('mx-auto flex w-9 flex-col items-center rounded-[var(--lo-r-sm)] py-0.5 text-[12px] font-bold leading-4', d === today ? 'bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]' : 'text-[var(--lo-muted)]')}>
                  <span>{WD1[parseDay(d).getDay()]}</span>
                  <span className="num">{parseDay(d).getDate()}</span>
                </span>
              </th>
            ))}
            <th className="pl-3 text-left text-[12px] font-bold text-[var(--lo-muted)]">Streak</th>
          </tr>
        </thead>
        <tbody>
          {habits.map((h) => {
            const cells = new Map(h.cells.map((c) => [c.date, c]));
            return (
              <tr key={h.id} className="group">
                <th className="sticky left-0 z-10 bg-[var(--lo-card)] pr-3 text-left font-normal">
                  <button type="button" onClick={() => open(h.id)} className="flex h-11 min-w-[150px] max-w-[220px] items-center gap-2 rounded-[var(--lo-r-sm)] pr-2 text-left hover:bg-[var(--lo-sunk)]">
                    <HabitArt art={h.art} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold">{h.name}</span>
                      <span className="block truncate text-[12px] text-[var(--lo-muted)]">{h.schedule === 'per_week' ? `${h.times} times a week` : h.schedule === 'weekdays' ? 'Chosen days' : h.target > 1 ? `${h.target} ${h.unit !== '' ? h.unit : 'times'} a day` : 'Every day'}</span>
                    </span>
                  </button>
                </th>
                {dates.map((d) => {
                  const c = cells.get(d);
                  const state = c?.state ?? 'before';
                  return (
                    <td key={d} className="p-0 text-center">
                      <Cell state={state} value={c?.value ?? 0} target={h.target} today={d === today} label={`${h.name}, ${d}: ${state === 'done' ? 'done. Tap to undo' : 'tap to mark done'}`} onClick={() => void tapHabit(h, d)} />
                    </td>
                  );
                })}
                <td className="pl-3">
                  <span className="num inline-flex items-center gap-1 text-[14px] font-extrabold">
                    {h.streak >= 3 && <Flame size={14} className="text-[var(--lo-art-clay)]" />}
                    {h.schedule === 'per_week' && h.week !== null ? `${h.week.done}/${h.week.times}` : h.streak}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- suggestions */

export interface HabitIdea {
  name: string;
  art: string;
  area: AreaKind;
  target?: number | undefined;
  unit?: string | undefined;
  schedule?: 'daily' | 'per_week' | undefined;
  times?: number | undefined;
  time_of_day?: 'morning' | 'afternoon' | 'evening' | 'anytime' | undefined;
  source?: 'water' | 'mind_min' | undefined;
}

export const HABIT_IDEAS: HabitIdea[] = [
  { name: 'Drink water', art: 'water', area: 'health', target: 8, unit: 'glasses', source: 'water' },
  { name: 'Go for a walk', art: 'walk', area: 'health' },
  { name: 'Read 10 pages', art: 'read', area: 'growth', time_of_day: 'evening' },
  { name: 'Meditate', art: 'meditate', area: 'mind', time_of_day: 'morning' },
  { name: 'Stretch', art: 'yoga', area: 'health', time_of_day: 'morning' },
  { name: 'Write a few lines', art: 'journal', area: 'mind', time_of_day: 'evening' },
  { name: 'In bed by 11', art: 'sleep', area: 'health', time_of_day: 'evening' },
  { name: 'Eat vegetables', art: 'veggies', area: 'health' },
  { name: 'No phone in bed', art: 'nophone', area: 'mind', time_of_day: 'evening' },
  { name: 'Floss', art: 'teeth', area: 'health', time_of_day: 'evening' },
  { name: 'Take vitamins', art: 'vitamins', area: 'health', time_of_day: 'morning' },
  { name: 'Tidy for 10 minutes', art: 'tidy', area: 'home' },
  { name: 'Water the plants', art: 'plants', area: 'home' },
  { name: 'Practise music', art: 'music', area: 'growth' },
  { name: 'Practise a language', art: 'language', area: 'growth' },
  { name: 'Put something aside', art: 'save', area: 'money' },
  { name: 'Get some sunlight', art: 'outside', area: 'health', time_of_day: 'morning' },
  { name: 'Three good things', art: 'gratitude', area: 'mind', time_of_day: 'evening' },
  { name: 'Run', art: 'run', area: 'health', schedule: 'per_week', times: 3 },
  { name: 'Work out', art: 'workout', area: 'health', schedule: 'per_week', times: 3 },
  { name: 'Call someone you love', art: 'language', area: 'relationships', schedule: 'per_week', times: 2 },
  { name: 'Study', art: 'study', area: 'growth' },
  { name: 'Call home', art: 'language', area: 'relationships', schedule: 'per_week', times: 2 },
  { name: 'Eat together', art: 'veggies', area: 'relationships', time_of_day: 'evening' },
  { name: 'Read to the kids', art: 'read', area: 'relationships', time_of_day: 'evening' },
  { name: 'Plan tomorrow', art: 'journal', area: 'work', time_of_day: 'evening' },
  { name: 'No email before 9', art: 'nophone', area: 'work', time_of_day: 'morning' },
  { name: 'A real lunch break', art: 'coffee', area: 'work', time_of_day: 'afternoon' },
  { name: 'Play some music', art: 'music', area: 'fun' },
  { name: 'Something new each week', art: 'sprout', area: 'fun', schedule: 'per_week', times: 1 },
  { name: 'Get outside for fun', art: 'outside', area: 'fun', schedule: 'per_week', times: 2 },
  { name: 'Message a friend', art: 'language', area: 'relationships' },
  { name: 'Note what I spend', art: 'save', area: 'money', time_of_day: 'evening' },
  { name: 'No buying on impulse', art: 'nophone', area: 'money' },
];

/** The habit ideas for an area (or for every area switched on). */
export function ideasFor(have: Habit[], area: AreaKind | undefined, kinds: AreaKind[]): HabitIdea[] {
  const names = new Set(have.map((h) => h.name.toLowerCase()));
  return HABIT_IDEAS.filter((i) => !names.has(i.name.toLowerCase()) && (area !== undefined ? i.area === area : kinds.includes(i.area)));
}

export async function addHabit(idea: HabitIdea, goal?: string | undefined): Promise<Habit> {
  const params: Record<string, unknown> = { name: idea.name, art: idea.art, area: idea.area, schedule: idea.schedule ?? 'daily' };
  if (idea.target !== undefined) params.target = idea.target;
  if (idea.unit !== undefined) params.unit = idea.unit;
  if (idea.times !== undefined) params.times = idea.times;
  if (idea.time_of_day !== undefined) params.time_of_day = idea.time_of_day;
  if (idea.source !== undefined) params.source = idea.source;
  if (goal !== undefined) params.goal = goal;
  const r = await op<{ habit: Habit }>('habits.create', params);
  habitsChanged();
  snack(`Started "${idea.name}"`);
  return r.habit;
}

/** One tap to start a habit: drawings with names. */
export function HabitIdeas({ have, area, goal, limit, onAdded }: { have: Habit[]; area?: AreaKind | undefined; goal?: string | undefined; limit?: number | undefined; onAdded?: ((h: Habit) => void) | undefined }): React.JSX.Element | null {
  const kinds = useKinds();
  let list = ideasFor(have, area, kinds);
  if (limit !== undefined) list = list.slice(0, limit);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((i) => (
        <button
          key={i.name}
          type="button"
          onClick={() => void addHabit(i, goal).then((h) => onAdded?.(h))}
          title={`Start "${i.name}"`}
          className="flex h-10 items-center gap-2 rounded-[var(--lo-r)] border border-dashed border-[var(--lo-line)] bg-[var(--lo-card)] pl-1.5 pr-3 text-[13px] font-bold text-[var(--lo-ink-2)] transition-colors hover:border-solid hover:border-[var(--lo-moss)] hover:text-[var(--lo-ink)]"
        >
          <HabitArt art={i.art} size={28} />
          {i.name}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- the drawer */

function HabitDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const status = useStatus().data;
  const live = useLive<{ habit: HabitDetail }>((signal) => op('habits.get', { habit: id }, { quiet: true, signal }), ['habits', 'habit_logs', 'goals'], [id]);
  const [confirmEl, confirm] = useConfirm();
  const h = live.data?.habit;
  const today = status?.today ?? '';
  const save = async (fields: Record<string, unknown>): Promise<void> => {
    // Plain fields show at once; days arrive as a JSON list.
    const shown: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) shown[k] = k === 'days' && typeof v === 'string' ? JSON.parse(v) : v;
    await act([patch<Habit>(id, shown as Partial<Habit>)], () => op('habits.update', { habit: id, ...fields }), [...HABIT_READS]);
  };
  const remove = async (): Promise<void> => {
    if (h === undefined) return;
    if (!(await confirm(`"${h.name}" and every day you ticked will be deleted. You can undo it right after.`, 'Delete this habit?'))) return;
    onClose();
    const r = await act([drop(id)], () => op('habits.delete', { habit: id }), [...HABIT_READS]);
    if (r !== undefined) snack(`Deleted "${h.name}"`);
  };
  const skip = async (): Promise<void> => {
    if (h === undefined) return;
    snack(`Skipped "${h.name}" today. The streak keeps going`);
    await act([patch<Habit>(id, { today: { ...h.today, skipped: true, done: false, value: 0 } })], () => op('habits.log', { habit: id, state: 'skipped' }), [...HABIT_READS]);
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Habit"
      width={520}
      footer={
        h !== undefined ? (
          <>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" icon={Archive} onClick={() => void save({ archived: !h.archived }).then(() => snack(h.archived ? 'Back on your list' : `Put "${h.name}" away`))}>
                {h.archived ? 'Bring back' : 'Put away'}
              </Button>
            </div>
            {!h.today.done && h.today.due && (
              <Button variant="soft" size="sm" icon={SkipForward} onClick={() => void skip()}>
                Skip today
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {confirmEl}
      {h === undefined ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="pb-6">
          <div className="flex items-center gap-4 px-5 pt-5">
            <HabitTile habit={h} size="lg" />
            <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
              {(
                [
                  ['In a row', h.streak],
                  ['Best', h.best],
                  ['Last 30 days', h.rate30 === null ? '-' : Math.round(h.rate30 * 100) + '%'],
                  ['Days done', h.total_done],
                ] as [string, ReactNode][]
              ).map(([l, v]) => (
                <div key={l}>
                  <p className="num text-[26px] font-extrabold leading-8">{v}</p>
                  <p className="text-[12px] font-bold text-[var(--lo-muted)]">{l}</p>
                </div>
              ))}
            </div>
          </div>

          {h.rate30 !== null && h.rate30 < 0.5 && h.total_done > 0 && (
            <div className="px-5 pt-4">
              <AgentButton kind="habit_help" params={{ habit: h.id }} label="Not sticking? Ask your AI agent" size="sm" variant="soft" />
            </div>
          )}
          <div className="px-5 pt-5">
            <Heatmap from={h.year[0]?.date ?? today} levels={h.year.map((c) => (c.state === 'done' ? 4 : c.state === 'part' ? 2 : c.state === 'skip' ? 's' : c.state === 'before' || c.state === 'rest' ? -1 : 0))} weekStartsOn={status?.week_starts_on ?? 1} label={`${h.name} over the last year`} />
          </div>

          <div className="mx-5 mt-4 flex flex-col gap-4 border-t border-[var(--lo-hair)] pt-4">
            <div>
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Name</p>
              <InlineText value={h.name} onSave={(v) => save({ name: v })} placeholder="Name" className="text-[15px] font-bold" maxLength={80} />
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Drawing</p>
              <div className="flex flex-wrap gap-1">
                {HABIT_ARTS.map((a) => (
                  <button key={a.key} type="button" title={a.label} aria-label={a.label} aria-pressed={h.art === a.key} onClick={() => void save({ art: a.key })} className={cn('flex size-11 items-center justify-center rounded-[var(--lo-r)] border-2 transition-colors', h.art === a.key ? 'border-[var(--lo-moss)] bg-[var(--lo-moss-soft)]' : 'border-transparent hover:bg-[var(--lo-sunk)]')}>
                    <HabitArt art={a.key} size={32} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">How often</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={h.schedule === 'daily'} onClick={() => void save({ schedule: 'daily' })}>
                  Every day
                </Chip>
                <Chip active={h.schedule === 'weekdays'} onClick={() => void save({ schedule: 'weekdays', days: JSON.stringify(h.days.length > 0 ? h.days : [1, 2, 3, 4, 5]) })}>
                  Some days
                </Chip>
                <Chip active={h.schedule === 'per_week'} onClick={() => void save({ schedule: 'per_week', times: h.times > 0 ? h.times : 3 })}>
                  Times a week
                </Chip>
              </div>
              {h.schedule === 'weekdays' && (
                <div className="mt-2">
                  <WeekdayPicker value={h.days} onChange={(v) => void save({ days: JSON.stringify(v) })} weekStartsOn={status?.week_starts_on ?? 1} />
                </div>
              )}
              {h.schedule === 'per_week' && (
                <div className="mt-2">
                  <Stepper label="times a week" value={h.times} min={1} max={7} onChange={(v) => void save({ times: v })} format={(v) => `${v} a week`} />
                </div>
              )}
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Each day</p>
              <div className="flex flex-wrap items-center gap-3">
                <Stepper label="times a day" value={h.target} min={1} max={100} onChange={(v) => void save({ target: v })} format={(v) => (v === 1 ? 'Once' : `${v} times`)} />
                {h.target > 1 && <InlineText value={h.unit} onSave={(v) => save({ unit: v })} placeholder="glasses, pages" className="w-40 text-[14px]" maxLength={20} />}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[12px] font-bold text-[var(--lo-muted)]">Counts itself from</span>
                {(
                  [
                    ['', 'Nothing'],
                    ['water', 'Glasses of water'],
                    ['mind_min', 'Calm minutes'],
                  ] as const
                ).map(([v, label]) => (
                  <Chip key={v} active={h.source === v} onClick={() => void save({ source: v })} className="h-7 text-[12px]">
                    {label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">When</p>
              <div className="flex flex-wrap gap-1.5">
                {(['morning', 'afternoon', 'evening', 'anytime'] as const).map((t) => (
                  <Chip key={t} active={h.time_of_day === t} onClick={() => void save({ time_of_day: t })}>
                    {t === 'anytime' ? 'Any time' : t[0]!.toUpperCase() + t.slice(1)}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">After what</p>
              <InlineText value={h.cue} onSave={(v) => save({ cue: v })} placeholder="After my morning coffee" className="text-[14px]" maxLength={200} />
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Area of life</p>
              <AreaChoice value={h.area} onChange={(k) => void save({ area: k })} size="sm" />
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Helps a goal</p>
              <RecordPicker value={h.goal?.id ?? ''} placeholder="Pick a goal" emptyLabel="No goal" onChange={(v) => void save({ goal: v })} options={(status?.goals ?? []).map((g) => ({ value: g.id, label: g.title, hint: AREA_NAMES[g.area] }))} />
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

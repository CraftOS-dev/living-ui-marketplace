/**
 * Tasks everywhere: a row for lists (Home, an area), a card for the board,
 * the one-line add, and the card's drawer (when, steps, area, goal,
 * project, person, repeat, notes). Finishing a card with a person on it
 * counts as being in touch with them; finishing a repeating card makes the
 * next one.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, Clock, Flag, FolderKanban, Mountain, Repeat, Star, Trash2, User, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { addDays, ago, minutes, parseDay, relDay } from '../lib/format.ts';
import { act, changed, drop, insert, patch, reorder, reshape, tempId, useLive } from '../lib/live.ts';
import type { Change, Collection } from '../lib/live.ts';
import { enter, rowOf, vanish } from '../lib/motion.ts';
import type { Column, Recurrence, Task } from '../lib/types.ts';
import { AREA_NAMES, AreaArt, Avatar } from './art.tsx';
import type { AreaKind } from './art.tsx';
import { AddLine, AreaChoice, CheckButton, Chip, InlineText, kindColor } from './bits.tsx';
import { DateButton, RecordPicker, TimeField } from './pickers.tsx';
import { snack } from './snack.tsx';
import { Button, Drawer, IconButton, Ring, Skeleton, useConfirm } from './ui.tsx';

const TASK_READS: Collection[] = ['tasks', 'goals', 'projects', 'people', 'interactions', 'days'];

export function tasksChanged(): void {
  changed(...TASK_READS);
}

/* --------------------------------------------------------------- actions */

/** The person's day, as the browser sees it (the server's answer settles the edge cases). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Which board list a card sits in for its day. */
function columnFor(doDate: string, today: string): Column {
  return doDate === '' ? 'inbox' : doDate <= today ? 'today' : 'coming';
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A card that changed list leaves its old list everywhere it is shown in lists (Board, week, Home's today). */
function relist(id: string, column: Column, doDate: string, today: string): Change {
  return reshape((root) => {
    if (!isObj(root)) return root;
    const take = (list: unknown): { rest: Task[]; card: Task | null } => {
      const arr = (Array.isArray(list) ? list : []) as Task[];
      const card = arr.find((t) => t.id === id) ?? null;
      return { rest: card === null ? arr : arr.filter((t) => t.id !== id), card };
    };
    if (Array.isArray(root.columns) && isObj(root.meta)) {
      let card: Task | null = null;
      const cols = (root.columns as { key: Column; tasks: Task[] }[]).map((c) => {
        const x = take(c.tasks);
        card = card ?? x.card;
        return x.card === null ? c : { ...c, tasks: x.rest };
      });
      if (card === null) return root;
      const moved = card as Task;
      return { ...root, columns: cols.map((c) => (c.key === column ? { ...c, tasks: [moved, ...c.tasks] } : c)) };
    }
    if (Array.isArray(root.days) && Array.isArray(root.inbox)) {
      const inb = take(root.inbox);
      let card = inb.card;
      const days = (root.days as { date: string; tasks: Task[] }[]).map((d) => {
        const x = take(d.tasks);
        card = card ?? x.card;
        return x.card === null ? d : { ...d, tasks: x.rest };
      });
      if (card === null) return root;
      const moved = card as Task;
      return { ...root, inbox: column === 'inbox' ? [moved, ...inb.rest] : inb.rest, days: days.map((d) => (column !== 'inbox' && d.date === doDate ? { ...d, tasks: [...d.tasks, moved] } : d)) };
    }
    if (Array.isArray(root.nudges) && Array.isArray(root.tasks) && column !== 'today' && column !== 'done' && doDate !== today) return { ...root, tasks: take(root.tasks).rest };
    return root;
  });
}

/** The changes a card's new fields make on screen: the card itself, and the list it now belongs to. */
export function taskChanges(task: Task, fields: Partial<Task>): Change[] {
  const today = localToday();
  const out: Change[] = [patch<Task>(task.id, fields)];
  const column = fields.column ?? task.column;
  const doDate = fields.do_date ?? task.do_date;
  if (column !== task.column || doDate !== task.do_date) out.push(relist(task.id, column, doDate, today));
  return out;
}

/** Tick a card off (or back on). With its row, the tick shows, then the row folds away before it moves. */
export async function toggleDone(task: Task, row: HTMLElement | null = null): Promise<void> {
  const done = task.state !== 'done';
  const today = localToday();
  if (done) snack(`Ticked off "${task.title}"`);
  if (row !== null) await new Promise((r) => setTimeout(r, 320));
  const fields: Partial<Task> = done ? { state: 'done', column: 'done', done_date: today } : { state: 'open', column: columnFor(task.do_date, today), done_date: '' };
  const r = await vanish(row, taskChanges(task, fields), () => op<{ task: Task; next: Task | null }>('tasks.complete', { task: task.id, done }), TASK_READS);
  if (done && r !== undefined && r.next !== null) snack(`Ticked off "${task.title}". The next one is on the board`);
}

/** Move a card (dragged on the Board or a project): it lands at once, in its new order. */
export async function moveCard(task: Task, fields: Partial<Task>, order: string[] | null, params: Record<string, unknown>): Promise<void> {
  const changes = taskChanges(task, fields);
  if (order !== null) changes.push(reorder(order));
  await act(changes, () => op('tasks.move', params), TASK_READS);
}

export async function toggleTop(task: Task): Promise<void> {
  await act([patch<Task>(task.id, { top: !task.top })], () => op('tasks.top', { task: task.id, top: !task.top }), TASK_READS);
}

/** Fields of a card that can be shown before the server answers (the rest arrive with it). */
const SHOWN = ['title', 'notes', 'area', 'do_date', 'due_date', 'start_time', 'duration_min', 'someday', 'stage', 'column', 'top'] as const;
function shownFields(task: Task, p: Record<string, unknown>): Partial<Task> {
  const out: Record<string, unknown> = {};
  for (const k of SHOWN) if (p[k] !== undefined) out[k] = p[k];
  const today = localToday();
  if (p.someday === true) Object.assign(out, { column: 'later', do_date: '' });
  else if (p.do_date !== undefined && p.column === undefined) out.column = columnFor(String(p.do_date), today);
  else if (p.column === 'today') out.do_date = today;
  else if (p.column === 'inbox') out.do_date = '';
  return out as Partial<Task>;
}

/* ------------------------------------------------------------ the drawer */

const PanelCtx = createContext<(id: string) => void>(() => undefined);

export function useTaskPanel(): (id: string) => void {
  return useContext(PanelCtx);
}

export function TaskPanelProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((t: string) => setId(t), []);
  return (
    <PanelCtx.Provider value={open}>
      {children}
      {id !== null && <TaskDrawer id={id} onClose={() => setId(null)} />}
    </PanelCtx.Provider>
  );
}

/* ------------------------------------------------------------ meta chips */

function Tiny({ children, title, tone }: { children: ReactNode; title?: string | undefined; tone?: 'late' | 'soon' | undefined }): React.JSX.Element {
  return (
    <span title={title} className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--lo-r-xs)] px-1.5 text-[12px] font-bold', tone === 'late' ? 'bg-[var(--lo-red)]/12 text-[var(--lo-red-text)]' : tone === 'soon' ? 'bg-[var(--lo-amber)]/20 text-[var(--lo-amber-text)]' : 'bg-[var(--lo-sunk)] text-[var(--lo-ink-2)]')}>
      {children}
    </span>
  );
}

/** What a card carries, small: its goal, person, steps, dates, length, repeat. */
export function TaskMeta({ task, today, showDate = true, className }: { task: Task; today: string; showDate?: boolean | undefined; className?: string | undefined }): React.JSX.Element | null {
  const parts: ReactNode[] = [];
  if (task.goal !== null)
    parts.push(
      <Tiny key="g" title={`Moves the goal "${task.goal.title}"`}>
        <Ring value={task.goal.progress} size={12} stroke={2.5} color={kindColor(task.area)} />
        <span className="max-w-[120px] truncate">{task.goal.title}</span>
      </Tiny>,
    );
  if (task.project !== null)
    parts.push(
      <Tiny key="p" title={`Project: ${task.project.title}`}>
        <FolderKanban size={11} />
        <span className="max-w-[110px] truncate">{task.project.title}</span>
      </Tiny>,
    );
  if (task.checklist.length > 0)
    parts.push(
      <Tiny key="c" title="Steps done">
        <span className="num">
          {task.checked}/{task.checklist.length}
        </span>
      </Tiny>,
    );
  if (showDate && task.do_date !== '' && task.state === 'open' && task.do_date !== today)
    parts.push(
      <Tiny key="d" tone={task.overdue ? 'late' : undefined} title={task.overdue ? 'Planned for an earlier day' : 'Planned for'}>
        <CalendarClock size={11} />
        {relDay(task.do_date, today)}
      </Tiny>,
    );
  if (task.due_date !== '' && task.state === 'open') {
    const d = Math.round((parseDay(task.due_date).getTime() - parseDay(today).getTime()) / 86400000);
    parts.push(
      <Tiny key="due" tone={d < 0 ? 'late' : d <= 2 ? 'soon' : undefined} title="Due">
        <Flag size={11} />
        {d < 0 ? 'Late' : relDay(task.due_date, today)}
      </Tiny>,
    );
  }
  if (task.start_time !== '' || task.duration_min > 0)
    parts.push(
      <Tiny key="t" title="Time">
        <Clock size={11} />
        {task.start_time !== '' ? task.start_time : ''}
        {task.start_time !== '' && task.duration_min > 0 ? ' · ' : ''}
        {task.duration_min > 0 ? minutes(task.duration_min) : ''}
      </Tiny>,
    );
  if (task.recurrence !== null)
    parts.push(
      <Tiny key="r" title={repeatWords(task.recurrence)}>
        <Repeat size={11} />
      </Tiny>,
    );
  if (parts.length === 0) return null;
  return <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>{parts}</span>;
}

export function repeatWords(r: Recurrence | null): string {
  if (r === null) return 'Does not repeat';
  const n = r.every;
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[r.unit];
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

/* -------------------------------------------------------------- the row */

/** A task in a list: tick, its area's drawing, the title and what it carries; the star at the end. */
/** A card's tick as you see it: flips at once, then follows the data. */
function useTick(task: Task): [boolean, (e: React.MouseEvent) => void] {
  const [tick, setTick] = useState<boolean | null>(null);
  useEffect(() => setTick(null), [task.state]);
  const done = tick ?? task.state === 'done';
  const flip = (e: React.MouseEvent): void => {
    setTick(!done);
    void toggleDone(task, rowOf(e));
  };
  return [done, flip];
}

export function TaskRow({ task, today, showDate = true, showArea = true, className }: { task: Task; today: string; showDate?: boolean | undefined; showArea?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const open = useTaskPanel();
  const [done, flip] = useTick(task);
  return (
    <div
      role="button"
      tabIndex={0}
      data-row
      onClick={() => open(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open(task.id);
      }}
      className={cn('group flex min-h-11 items-center gap-3 rounded-[var(--lo-r)] px-2 py-1.5 transition-colors hover:bg-[var(--lo-sunk)]', enter(task.id), className)}
    >
      <CheckButton done={done} kind={task.area} onClick={flip} label={done ? `Mark "${task.title}" not done` : `Tick off "${task.title}"`} />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[14px] font-semibold leading-5', done && 'text-[var(--lo-muted)] line-through')}>{task.title}</span>
        <TaskMeta task={task} today={today} showDate={showDate} className="mt-0.5" />
      </span>
      {task.person !== null && <Avatar look={task.person.look} size={24} label={task.person.name} />}
      {showArea && task.area !== '' && <AreaArt kind={task.area} size={22} label={AREA_NAMES[task.area]} />}
      <button
        type="button"
        aria-label={task.top ? 'Take off the top three' : 'Make it one of the top three today'}
        title={task.top ? 'One of the top three today' : 'Make it one of the top three today'}
        onClick={(e) => {
          e.stopPropagation();
          void toggleTop(task);
        }}
        className={cn('hit flex size-7 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] transition-opacity hover:bg-[var(--lo-card)]', task.top ? 'text-[var(--lo-art-honey-d)]' : 'no-touch text-[var(--lo-muted)] opacity-0 focus:opacity-100 group-hover:opacity-100', done && 'hidden')}
      >
        <Star size={16} fill={task.top ? 'currentColor' : 'none'} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- the card */

/** A card on the board: its area's color along the top, the tick, the title and its little things. */
export function TaskCard({ task: card, today, onDragStart, onDragEnd, dragging = false, compact = false, inProject = false }: { task: Task; today: string; onDragStart?: ((e: React.DragEvent) => void) | undefined; onDragEnd?: (() => void) | undefined; dragging?: boolean | undefined; compact?: boolean | undefined; inProject?: boolean | undefined }): React.JSX.Element {
  // Inside its project a card does not repeat the project or its part of life.
  const task: Task = inProject ? { ...card, project: null, area: '' } : card;
  const open = useTaskPanel();
  const [done, flip] = useTick(card);
  return (
    <div
      role="button"
      tabIndex={0}
      data-row
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => open(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open(task.id);
      }}
      data-task={task.id}
      className={cn('group relative overflow-hidden rounded-[var(--lo-r)] border border-[var(--lo-hair)] bg-[var(--lo-card)] shadow-[var(--lo-shadow-sm)] transition-shadow hover:shadow-[var(--lo-shadow)]', enter(task.id), dragging && 'opacity-40')}
    >
      {task.area !== '' && <span aria-hidden className={cn('block', compact ? 'h-1' : 'h-1.5')} style={{ background: kindColor(task.area) }} />}
      {compact ? (
        <div className="flex items-start gap-2 px-2.5 py-2">
          <span className="pt-px">
            <CheckButton done={done} kind={task.area} size={18} onClick={flip} label={done ? `Mark "${task.title}" not done` : `Tick off "${task.title}"`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('line-clamp-3 break-words text-[13px] font-semibold leading-[18px]', done && 'text-[var(--lo-muted)] line-through')}>{task.title}</span>
            {(task.start_time !== '' || task.person !== null || task.top) && (
              <span className="mt-1 flex items-center gap-1 text-[12px] font-bold text-[var(--lo-ink-2)]">
                {task.top && <Star size={11} className="text-[var(--lo-art-honey-d)]" fill="currentColor" />}
                {task.start_time !== '' && <span className="num">{task.start_time}</span>}
                {task.person !== null && <Avatar look={task.person.look} size={18} label={task.person.name} />}
              </span>
            )}
          </span>
        </div>
      ) : (
      <>
      <div className={cn('flex items-start gap-2.5 px-3 pb-2.5', task.area !== '' ? 'pt-2' : 'pt-2.5')}>
        <span className="pt-0.5">
          <CheckButton done={done} kind={task.area} size={20} onClick={flip} label={done ? `Mark "${task.title}" not done` : `Tick off "${task.title}"`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block break-words text-[14px] font-semibold leading-5', done && 'text-[var(--lo-muted)] line-through')}>{task.title}</span>
          <TaskMeta task={task} today={today} className="mt-1.5" />
          {(task.person !== null || task.area !== '') && (
            <span className="mt-2 flex items-center gap-1.5">
              {task.area !== '' && <AreaArt kind={task.area} size={20} label={AREA_NAMES[task.area]} />}
              {task.area !== '' && <span className="text-[12px] font-bold" style={{ color: kindColor(task.area, 'text') }}>{AREA_NAMES[task.area]}</span>}
              {task.person !== null && (
                <span className="ml-auto flex items-center gap-1 text-[12px] font-bold text-[var(--lo-ink-2)]">
                  <Avatar look={task.person.look} size={22} />
                  {task.person.name}
                </span>
              )}
            </span>
          )}
        </span>
        {!done && (
          <button
            type="button"
            aria-label={task.top ? 'Take off the top three' : 'Make it one of the top three today'}
            title={task.top ? 'One of the top three today' : 'Star: one of the top three today'}
            onClick={(e) => {
              e.stopPropagation();
              void toggleTop(task);
            }}
            className={cn('hit -mr-1 flex size-7 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)]', task.top ? 'text-[var(--lo-art-honey-d)]' : 'no-touch text-[var(--lo-muted)] opacity-0 focus:opacity-100 group-hover:opacity-100')}
          >
            <Star size={15} fill={task.top ? 'currentColor' : 'none'} strokeWidth={2.2} />
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- adding */

export interface TaskDefaults {
  column?: Exclude<Column, 'done'> | undefined;
  do_date?: string | undefined;
  area?: AreaKind | '' | undefined;
  goal?: string | undefined;
  project?: string | undefined;
  person?: string | undefined;
  stage?: 'todo' | 'doing' | undefined;
}

/** A card made here, shown before the server names it. */
function draftTask(title: string, d: TaskDefaults, today: string): Task {
  const doDate = d.do_date ?? (d.column === 'today' ? today : '');
  return {
    id: tempId(),
    title,
    notes: '',
    area: d.area ?? '',
    project: null,
    goal: null,
    person: null,
    state: 'open',
    stage: d.stage ?? 'todo',
    column: d.column ?? columnFor(doDate, today),
    do_date: doDate,
    due_date: '',
    start_time: '',
    duration_min: 0,
    someday: d.column === 'later',
    top: false,
    recurrence: null,
    checklist: [],
    checked: 0,
    overdue: false,
    late: false,
    done_at: '',
    done_date: '',
    rank: 0,
    actor: 'person',
  };
}

/** Every list a new card belongs in, whatever page shows it. */
function homeOf(t: Task, d: TaskDefaults, today: string): (key: string, owner: Record<string, unknown>) => boolean {
  return (key, owner) => {
    if (key === 'tasks') {
      if (Array.isArray(owner.nudges)) return t.column === 'today' || t.do_date === today;
      if (typeof owner.key === 'string' && Array.isArray(owner.tasks) && !('date' in owner)) return owner.key === t.column;
      if (typeof owner.date === 'string' && Array.isArray(owner.events)) return t.column !== 'inbox' && owner.date === t.do_date;
      if (isObj(owner.area) && owner.area.kind !== undefined) return t.area !== '' && owner.area.kind === t.area;
      if (typeof owner.measure === 'string') return d.goal !== undefined && owner.id === d.goal;
      if (typeof owner.circle === 'string') return d.person !== undefined && owner.id === d.person;
      return false;
    }
    if (key === 'inbox' && Array.isArray(owner.days)) return t.column === 'inbox';
    if ((key === 'todo' || key === 'doing') && Array.isArray(owner.todo) && Array.isArray(owner.doing)) return d.project !== undefined && owner.id === d.project && t.stage === key;
    return false;
  };
}

/** Add a card: it shows at once; false when the server refused it. */
export async function addTask(title: string, d: TaskDefaults): Promise<Task | false> {
  const params: Record<string, unknown> = { title };
  if (d.column !== undefined) params.column = d.column;
  if (d.do_date !== undefined) params.do_date = d.do_date;
  if (d.area !== undefined && d.area !== '') params.area = d.area;
  if (d.goal !== undefined) params.goal = d.goal;
  if (d.project !== undefined) params.project = d.project;
  if (d.person !== undefined) params.person = d.person;
  if (d.stage !== undefined) params.stage = d.stage;
  const today = localToday();
  const draft = draftTask(title, d, today);
  const r = await act([insert(homeOf(draft, d, today), draft)], () => op<{ task: Task }>('tasks.create', params), TASK_READS);
  return r === undefined ? false : r.task;
}

/** Delete a card: its row folds away at once. */
export async function removeTask(task: Task, row: HTMLElement | null = null): Promise<boolean> {
  const r = await vanish(row, [drop(task.id)], () => op('tasks.delete', { task: task.id }), TASK_READS);
  if (r !== undefined) snack(`Deleted "${task.title}"`);
  return r !== undefined;
}

/** The one-line add: type a task, Enter. */
export function QuickAdd({ defaults, placeholder = 'Add a task', big = false, className, autoFocus }: { defaults: TaskDefaults; placeholder?: string | undefined; big?: boolean | undefined; className?: string | undefined; autoFocus?: boolean | undefined }): React.JSX.Element {
  return <AddLine big={big} autoFocus={autoFocus} className={className} placeholder={placeholder} tone={defaults.area !== undefined && defaults.area !== '' ? defaults.area : undefined} onAdd={(t) => addTask(t, defaults)} />;
}

/* ------------------------------------------------------------- the panel */

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-3 py-2">
      <span className="flex h-8 items-center gap-1.5 text-[12px] font-bold text-[var(--lo-muted)]">
        {icon}
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function nextWeekday(today: string, wd: number): string {
  const d = parseDay(today).getDay();
  const n = (wd - d + 7) % 7 || 7;
  return addDays(today, n);
}

function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const status = useStatus().data;
  const live = useLive<{ task: Task }>((signal) => op('tasks.get', { task: id }, { quiet: true, signal }), TASK_READS, [id]);
  const [confirmEl, confirm] = useConfirm();
  const t = live.data?.task;
  const today = status?.today ?? '';
  const save = async (fields: Record<string, unknown>): Promise<void> => {
    if (t === undefined) return;
    await act(taskChanges(t, shownFields(t, fields)), () => op<{ task: Task }>('tasks.update', { task: id, ...fields }), TASK_READS);
  };
  const remove = async (): Promise<void> => {
    if (t === undefined) return;
    if (!(await confirm(`"${t.title}" will be deleted. You can undo it right after.`, 'Delete this card?'))) return;
    onClose();
    void removeTask(t, document.querySelector<HTMLElement>(`[data-task="${t.id}"]`));
  };
  const check = async (params: Record<string, unknown>): Promise<void> => {
    if (t === undefined) return;
    const steps = (list: Task['checklist']): Partial<Task> => ({ checklist: list, checked: list.filter((c) => c.done).length });
    const change =
      typeof params.text === 'string'
        ? patch<Task>(id, (x) => steps([...x.checklist, { id: tempId(), text: String(params.text), done: false }]))
        : params.remove === true
          ? patch<Task>(id, (x) => steps(x.checklist.filter((c) => c.id !== params.item)))
          : patch<Task>(id, (x) => steps(x.checklist.map((c) => (c.id === params.item ? { ...c, done: params.done === true } : c))));
    await act([change], () => op<{ task: Task }>('tasks.check', { task: id, ...params }), TASK_READS);
  };
  const when = t === undefined ? '' : t.state === 'done' ? 'done' : t.someday ? 'later' : t.do_date === '' ? 'inbox' : t.do_date === today ? 'today' : t.do_date === addDays(today, 1) ? 'tomorrow' : 'date';
  return (
    <Drawer
      open
      onClose={onClose}
      title={t === undefined ? 'Card' : t.state === 'done' ? 'Done' : { inbox: 'In the inbox', today: 'On today', coming: 'Coming up', later: 'Later', done: 'Done' }[t.column]}
      width={520}
      footer={
        t !== undefined ? (
          <>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
              Delete
            </Button>
            <Button
              variant={t.state === 'done' ? 'soft' : 'primary'}
              onClick={() => {
                void toggleDone(t);
              }}
            >
              {t.state === 'done' ? 'Not done yet' : 'Mark done'}
            </Button>
          </>
        ) : undefined
      }
    >
      {confirmEl}
      {t === undefined ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="pb-6">
          <div className="h-2" style={{ background: kindColor(t.area) }} />
          <div className="flex items-start gap-3 px-5 pt-4">
            <span className="pt-1.5">
              <CheckButton done={t.state === 'done'} kind={t.area} size={24} onClick={() => void toggleDone(t)} label="Done" />
            </span>
            <InlineText value={t.title} onSave={(v) => save({ title: v })} placeholder="What is it?" ariaLabel="Title" className="serif text-[15px] font-semibold leading-6" maxLength={300} />
            <IconButton
              icon={Star}
              label={t.top ? 'Take off the top three' : 'Make it one of the top three today'}
              className={t.top ? 'text-[var(--lo-art-honey-d)] [&>svg]:fill-current' : undefined}
              onClick={() => {
                void toggleTop(t);
              }}
            />
          </div>
          {t.actor === 'agent' && <p className="px-5 pt-1 text-[12px] font-semibold text-[var(--lo-accent-text)]">Added by your AI agent</p>}

          <div className="px-5 pt-3">
            <Row icon={<CalendarClock size={13} />} label="When">
              {(
                [
                  ['inbox', 'Inbox', { column: 'inbox' }],
                  ['today', 'Today', { column: 'today' }],
                  ['tomorrow', 'Tomorrow', { do_date: addDays(today, 1) }],
                  ['weekend', 'Weekend', { do_date: nextWeekday(today, 6) }],
                  ['later', 'Later', { column: 'later' }],
                ] as [string, string, Record<string, unknown>][]
              ).map(([k, l, patch]) => (
                <Chip key={k} active={when === k || (k === 'weekend' && t.do_date === nextWeekday(today, 6) && when === 'date')} onClick={() => void save(patch)}>
                  {l}
                </Chip>
              ))}
              <DateButton value={when === 'date' ? t.do_date : ''} today={today} onChange={(d) => void save(d === '' ? { column: 'inbox' } : { do_date: d })} placeholder="Pick a day" size="md" clearable={false} />
            </Row>
            <Row icon={<Flag size={13} />} label="Due">
              <DateButton value={t.due_date} today={today} onChange={(d) => void save({ due_date: d })} placeholder="No due date" />
            </Row>
            <Row icon={<Clock size={13} />} label="Time">
              <TimeField value={t.start_time} onChange={(v) => void save({ start_time: v })} placeholder="Any time" />
              {[15, 30, 60, 120].map((m) => (
                <Chip key={m} active={t.duration_min === m} onClick={() => void save({ duration_min: t.duration_min === m ? 0 : m })}>
                  {minutes(m)}
                </Chip>
              ))}
            </Row>
            <Row icon={<Repeat size={13} />} label="Repeat">
              {(
                [
                  ['none', 'No', null],
                  ['day', 'Daily', { every: 1, unit: 'day' }],
                  ['week', 'Weekly', { every: 1, unit: 'week' }],
                  ['month', 'Monthly', { every: 1, unit: 'month' }],
                ] as [string, string, Recurrence | null][]
              ).map(([k, l, r]) => (
                <Chip key={k} active={k === 'none' ? t.recurrence === null : t.recurrence?.unit === k && t.recurrence.every === 1} onClick={() => void save({ recurrence: r === null ? '' : JSON.stringify(r) })}>
                  {l}
                </Chip>
              ))}
            </Row>
          </div>

          <div className="mx-5 mt-2 border-t border-[var(--lo-hair)] pt-3">
            <p className="pb-2 text-[12px] font-bold text-[var(--lo-muted)]">Area of life</p>
            <AreaChoice value={t.area} onChange={(k) => void save({ area: k })} size="sm" />
          </div>

          <div className="px-5 pt-3">
            <Row icon={<Mountain size={13} />} label="Goal">
              <RecordPicker
                value={t.goal?.id ?? ''}
                placeholder="Moves a goal"
                emptyLabel="No goal"
                onChange={(v) => void save({ goal: v })}
                options={(status?.goals ?? []).map((g) => ({ value: g.id, label: g.title, art: <AreaArt kind={g.area} size={18} /> }))}
              />
            </Row>
            <Row icon={<FolderKanban size={13} />} label="Project">
              <RecordPicker value={t.project?.id ?? ''} placeholder="Part of a project" emptyLabel="No project" onChange={(v) => void save({ project: v })} options={(status?.projects ?? []).map((p) => ({ value: p.id, label: p.title }))} />
            </Row>
            <Row icon={<User size={13} />} label="With">
              <RecordPicker value={t.person?.id ?? ''} placeholder="Someone" emptyLabel="Nobody" onChange={(v) => void save({ person: v })} options={(status?.people ?? []).map((p) => ({ value: p.id, label: p.name, art: <Avatar look={p.look} size={20} /> }))} />
            </Row>
          </div>

          <div className="mx-5 mt-2 border-t border-[var(--lo-hair)] pt-3">
            <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Steps {t.checklist.length > 0 && <span className="num">({t.checked}/{t.checklist.length})</span>}</p>
            <ul className="flex flex-col">
              {t.checklist.map((c) => (
                <li key={c.id} className="group flex min-h-9 items-center gap-2.5 rounded-[var(--lo-r-sm)] px-1 hover:bg-[var(--lo-sunk)]">
                  <CheckButton done={c.done} size={18} onClick={() => void check({ item: c.id, done: !c.done })} label={c.text} />
                  <span className={cn('min-w-0 flex-1 text-[14px]', c.done && 'text-[var(--lo-muted)] line-through')}>{c.text}</span>
                  <button type="button" aria-label={`Remove "${c.text}"`} onClick={() => void check({ item: c.id, remove: true })} className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100">
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <AddLine placeholder="Add a step" onAdd={(text) => check({ text })} className="mt-1.5" />
          </div>

          <div className="mx-5 mt-3 border-t border-[var(--lo-hair)] pt-3">
            <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Notes</p>
            <InlineText multiline value={t.notes} onSave={(v) => save({ notes: v })} placeholder="Anything to remember" className="text-[14px] leading-6" />
          </div>

          {(t.history ?? []).length > 0 && (
            <div className="mx-5 mt-3 border-t border-[var(--lo-hair)] pt-3">
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">History</p>
              <ul className="flex flex-col gap-1">
                {(t.history ?? []).slice(0, 8).map((h) => (
                  <li key={h.id} className="flex gap-2 text-[12px] leading-5 text-[var(--lo-ink-2)]">
                    <span className="shrink-0 font-bold">{h.actor === 'agent' ? 'Your AI agent' : h.actor === 'system' ? 'Life OS' : 'You'}</span>
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    <span className="shrink-0 text-[var(--lo-muted)]">{ago(h.created)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

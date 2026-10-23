/**
 * A project's to-do list. It opens as a board by status (to do, in
 * progress, waiting, done) with drag and drop and a "+" on each column; the
 * list groups open tasks by when they are due (late, today, this week,
 * later, no day). A task opens beside them: status, due day, priority,
 * who it is for (you or your AI agent), repeat, labels, a checklist, notes
 * and links to the project's papers, claims, manuscripts, boards and
 * notes.
 *
 *   N adds a task, Esc closes the open one.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpenText, CalendarDays, CheckSquare, Columns3, FileText, Flag, FlaskConical, Lightbulb, Link2, List, ListTodo, NotebookPen, Plus, Repeat, Search, Sparkles, SquareKanban, Trash2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import type { Params } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { ago, clip, num } from '../../lib/format.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { GNode, Note, Project, Task, TaskPriority, TaskStatus } from '../../lib/types.ts';
import { RequestStatus } from '../agent.tsx';
import { Button, Empty, IconButton, LoadError, Popover, Segmented, Select, Spinner, Toggle, inputCls, menuItem, textareaCls, useConfirm } from '../ui.tsx';
import { addDays, DueChip, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_RANK, PriorityFlag, STATUS_LABEL, TaskCheck, today } from '../tasks/bits.tsx';
import type { ReadingRow } from '../../pages/Project.tsx';

type Filter = 'all' | 'mine' | 'agent' | 'late' | 'today' | 'week';
const STATUSES: TaskStatus[] = ['todo', 'doing', 'waiting', 'done'];
const LINK_ICON: Record<Task['links'][number]['kind'], LucideIcon> = { work: BookOpenText, node: Lightbulb, manuscript: FileText, board: SquareKanban, note: NotebookPen, experiment: FlaskConical };
const DRAG_TASK = 'application/x-research-task';

async function save(task: string, patch: Params): Promise<{ task: Task; request: string } | null> {
  try {
    const r = await op<{ task: Task; request: string }>('tasks.update', { task, ...patch });
    changed('tasks');
    return r;
  } catch {
    return null;
  }
}

async function toggle(t: Task): Promise<void> {
  try {
    await op('tasks.complete', { task: t.id, done: t.status !== 'done' });
    changed('tasks');
  } catch {
    /* toasted */
  }
}

export function TasksView({ project, taskId }: { project: Project; taskId: string }): React.JSX.Element {
  // The board is the default; the list is remembered only when picked.
  const [mode, setMode] = useState<'list' | 'board'>(() => {
    try {
      return localStorage.getItem('ro_tasks_view') === 'list' ? 'list' : 'board';
    } catch {
      return 'board';
    }
  });
  const [adding, setAdding] = useState<TaskStatus | ''>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [label, setLabel] = useState('');
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const open = useLive((signal) => op<{ tasks: Task[] }>('tasks.list', { project: project.id, status: 'open', limit: 2000 }, { quiet: true, signal }).then((r) => r.tasks), ['tasks', 'nodes', 'works', 'manuscripts', 'boards', 'notes'], [project.id], 120);
  const done = useLive((signal) => (showDone || mode === 'board' ? op<{ tasks: Task[] }>('tasks.list', { project: project.id, status: 'done', limit: 60 }, { quiet: true, signal }).then((r) => r.tasks) : Promise.resolve([] as Task[])), ['tasks'], [project.id, showDone, mode], 120);
  const all = useMemo(() => [...(open.data ?? []), ...(done.data ?? [])], [open.data, done.data]);
  const now = today();
  const week = addDays(now, 7);
  const labels = useMemo(() => [...new Set(all.flatMap((t) => t.labels))].sort(), [all]);
  const pass = (t: Task): boolean => {
    if (label !== '' && !t.labels.includes(label)) return false;
    if (q.trim() !== '' && !(t.title + ' ' + t.notes).toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'mine') return t.assignee === 'person';
    if (filter === 'agent') return t.assignee === 'agent';
    if (filter === 'late') return t.overdue;
    if (filter === 'today') return t.due === now;
    if (filter === 'week') return t.due !== '' && t.due >= now && t.due <= week;
    return true;
  };
  const shownOpen = (open.data ?? []).filter(pass);
  const shownDone = (done.data ?? []).filter(pass);
  const selected = all.find((t) => t.id === taskId);
  const select = (id: string): void => replaceQuery({ task: id === '' ? undefined : id });
  const quick = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (mode === 'board') setAdding('todo');
        else quick.current?.focus();
      } else if (e.key === 'Escape' && taskId !== '') select('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, mode]);
  const setModeKeep = (m: 'list' | 'board'): void => {
    setMode(m);
    try {
      localStorage.setItem('ro_tasks_view', m);
    } catch {
      /* a convenience */
    }
  };
  const counts: Record<Filter, number> = {
    all: (open.data ?? []).length,
    mine: (open.data ?? []).filter((t) => t.assignee === 'person').length,
    agent: (open.data ?? []).filter((t) => t.assignee === 'agent').length,
    late: (open.data ?? []).filter((t) => t.overdue).length,
    today: (open.data ?? []).filter((t) => t.due === now).length,
    week: (open.data ?? []).filter((t) => t.due !== '' && t.due >= now && t.due <= week).length,
  };
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All open' },
    { key: 'late', label: 'Late' },
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'mine', label: 'Yours' },
    { key: 'agent', label: 'Your AI agent' },
  ];
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
          <ListTodo size={14} className="text-[var(--ro-muted)]" />
          <span className="text-[13px] font-bold">To-do</span>
          <span className="num text-[12px] text-[var(--ro-muted)]">{num(counts.all)} open</span>
          <span className="mx-1 h-5 w-px bg-[var(--ro-line)]" />
          <Segmented label="View" size="sm" value={mode} onChange={setModeKeep} options={[{ value: 'list', label: 'List', icon: List }, { value: 'board', label: 'Board', icon: Columns3 }]} />
          <span className="flex-1" />
          <label className="flex h-7 w-44 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2 focus-within:border-[var(--ro-ink)]">
            <Search size={13} className="shrink-0 text-[var(--ro-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
          </label>
          {mode === 'list' && (
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">
              <Toggle checked={showDone} onChange={setShowDone} label="Show done" /> Done
            </label>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--ro-hair)] px-3 py-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold', filter === f.key ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)]', f.key === 'late' && counts.late > 0 && filter !== 'late' && 'text-[var(--ro-red-text)]')}>
              {f.label} <span className="num opacity-70">{counts[f.key]}</span>
            </button>
          ))}
          {labels.length > 0 && <span className="mx-1 h-4 w-px bg-[var(--ro-line)]" />}
          {labels.map((l) => (
            <button key={l} type="button" onClick={() => setLabel(label === l ? '' : l)} className={cn('h-6 rounded-[var(--ro-r-sm)] px-1.5 text-[12px]', label === l ? 'bg-[var(--ro-accent-soft)] font-semibold text-[var(--ro-accent-text)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
              #{l}
            </button>
          ))}
        </div>
        {open.error !== null ? (
          <div className="p-4">
            <LoadError message={open.error} onRetry={open.reload} />
          </div>
        ) : open.data === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size={20} />
          </div>
        ) : mode === 'list' ? (
          <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
            <QuickAdd project={project.id} inputRef={quick} />
            <ListView open={shownOpen} done={showDone ? shownDone : []} now={now} week={week} selected={taskId} onSelect={select} empty={(open.data ?? []).length === 0} />
          </div>
        ) : (
          <BoardView project={project.id} tasks={[...shownOpen, ...shownDone]} selected={taskId} onSelect={select} adding={adding} setAdding={setAdding} />
        )}
      </div>
      {selected !== undefined && <TaskPanel key={selected.id} task={selected} project={project} labels={labels} onClose={() => select('')} />}
    </div>
  );
}

/* ------------------------------------------------------------ quick add */

export function QuickAdd({ project, inputRef, status = 'todo', compact = false, autoFocus = false, blurCloses = false, className, onDone, onCancel }: { project: string; inputRef?: React.RefObject<HTMLInputElement | null>; status?: TaskStatus; compact?: boolean; autoFocus?: boolean; blurCloses?: boolean; className?: string; onDone?: () => void; onCancel?: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [busy, setBusy] = useState(false);
  const dueBtn = useRef<HTMLButtonElement | null>(null);
  const prBtn = useRef<HTMLButtonElement | null>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const add = async (): Promise<void> => {
    if (title.trim() === '' || busy) return;
    setBusy(true);
    try {
      await op('tasks.create', { project, title: title.trim(), due: due || undefined, priority, status });
      changed('tasks', 'projects');
      setTitle('');
      setDue('');
      setPriority('none');
      onDone?.();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const now = today();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      className={cn('flex items-center gap-2 border-b border-[var(--ro-hair)]', compact ? 'px-2 py-1.5' : 'px-4 py-2', className)}
    >
      <Plus size={15} className="shrink-0 text-[var(--ro-muted)]" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          (e.target as HTMLInputElement).blur();
          onCancel?.();
        }}
        onBlur={() => blurCloses && title.trim() === '' && onCancel?.()}
        placeholder="Add a task" aria-label="Add a task" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      {title.trim() !== '' && (
        <>
          <button ref={dueBtn} type="button" onClick={() => setDueOpen((o) => !o)} className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold hover:bg-[var(--ro-row)]', due !== '' ? 'text-[var(--ro-ink)]' : 'text-[var(--ro-muted)]')} title="Due day">
            <CalendarDays size={12} /> {due !== '' ? <DueChip task={{ due, status: 'todo', overdue: due < now }} /> : !compact && 'Due'}
          </button>
          <Popover open={dueOpen} anchor={dueBtn} onClose={() => setDueOpen(false)} align="right" className="w-56 p-1">
            <DuePicker value={due} onPick={(d) => { setDue(d); setDueOpen(false); }} />
          </Popover>
          <button ref={prBtn} type="button" onClick={() => setPrOpen((o) => !o)} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold text-[var(--ro-muted)] hover:bg-[var(--ro-row)]" title="Priority">
            {priority === 'none' ? <PriorityFlag priority="low" /> : <PriorityFlag priority={priority} />} {!compact && (priority === 'none' ? 'Priority' : PRIORITY_LABEL[priority])}
          </button>
          <Popover open={prOpen} anchor={prBtn} onClose={() => setPrOpen(false)} align="right" className="w-44">
            <PriorityMenu value={priority} onPick={(p) => { setPriority(p); setPrOpen(false); }} />
          </Popover>
          <Button size="sm" variant="primary" type="submit" loading={busy}>
            Add
          </Button>
        </>
      )}
    </form>
  );
}

const PriorityDot = (): React.JSX.Element => <span className="size-2.5 shrink-0 rounded-full border-[1.5px] border-[var(--ro-ink-2)]" />;

function PriorityMenu({ value, onPick }: { value: TaskPriority; onPick: (p: TaskPriority) => void }): React.JSX.Element {
  return (
    <div className="flex flex-col p-1">
      {(['urgent', 'high', 'medium', 'low', 'none'] as TaskPriority[]).map((p) => (
        <button key={p} type="button" className={cn(menuItem, value === p && 'bg-[var(--ro-row)]')} onClick={() => onPick(p)}>
          <span className="flex w-3.5 justify-center">{p === 'none' ? <PriorityDot /> : <PriorityFlag priority={p} />}</span> {PRIORITY_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function DuePicker({ value, onPick }: { value: string; onPick: (d: string) => void }): React.JSX.Element {
  const now = today();
  const nextMonday = (() => {
    const d = new Date(now + 'T12:00:00');
    const add = ((8 - d.getDay()) % 7) || 7;
    return addDays(now, add);
  })();
  const options: { label: string; day: string }[] = [
    { label: 'Today', day: now },
    { label: 'Tomorrow', day: addDays(now, 1) },
    { label: 'Next week', day: nextMonday },
    { label: 'In two weeks', day: addDays(now, 14) },
  ];
  return (
    <div className="flex flex-col">
      {options.map((o) => (
        <button key={o.label} type="button" className={menuItem} onClick={() => onPick(o.day)}>
          <CalendarDays size={13} /> <span className="flex-1">{o.label}</span>
          <span className="text-[12px] text-[var(--ro-muted)]">{o.day.slice(5)}</span>
        </button>
      ))}
      <div className="flex items-center gap-1.5 border-t border-[var(--ro-hair)] px-2 py-1.5">
        <input type="date" value={value} onChange={(e) => e.target.value !== '' && onPick(e.target.value)} aria-label="Pick a day" className={cn(inputCls, 'h-7 flex-1 text-[12px]')} />
        {value !== '' && <IconButton icon={X} label="No due day" size={26} onClick={() => onPick('')} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- list */

function ListView({ open, done, now, week, selected, onSelect, empty }: { open: Task[]; done: Task[]; now: string; week: string; selected: string; onSelect: (id: string) => void; empty: boolean }): React.JSX.Element {
  const [doneOpen, setDoneOpen] = useState(true);
  const byPriority = (a: Task, b: Task): number => (a.due !== b.due ? (a.due === '' ? 1 : b.due === '' ? -1 : a.due < b.due ? -1 : 1) : PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.sort - b.sort);
  const groups: { key: string; label: string; tone?: 'late'; rows: Task[] }[] = [
    { key: 'late', label: 'Late', tone: 'late' as const, rows: open.filter((t) => t.overdue) },
    { key: 'today', label: 'Today', rows: open.filter((t) => t.due === now) },
    { key: 'week', label: 'This week', rows: open.filter((t) => t.due > now && t.due <= week) },
    { key: 'later', label: 'Later', rows: open.filter((t) => t.due > week) },
    { key: 'none', label: 'No due day', rows: open.filter((t) => t.due === '') },
  ]
    .map((g) => ({ ...g, rows: g.rows.sort(byPriority) }))
    .filter((g) => g.rows.length > 0);
  if (empty && done.length === 0)
    return (
      <div className="flex flex-col items-center px-6 py-12">
        <Empty compact icon={ListTodo} title="Nothing to do yet">
          Reading to finish, analyses to run, people to write to: keep them here with the project.
        </Empty>
      </div>
    );
  return (
    <div className="flex flex-col pb-10">
      {groups.length === 0 && open.length === 0 && done.length === 0 && <p className="px-4 py-6 text-[12px] text-[var(--ro-muted)]">No tasks match.</p>}
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className={cn('sticky top-0 z-10 flex items-center gap-2 bg-[var(--ro-shell)] px-4 py-1.5 text-[12px] font-bold', g.tone === 'late' ? 'text-[var(--ro-red-text)]' : 'text-[var(--ro-ink-2)]')}>
            {g.label} <span className="num font-normal text-[var(--ro-muted)]">{g.rows.length}</span>
          </h3>
          <ul>
            {g.rows.map((t) => (
              <Row key={t.id} t={t} selected={selected === t.id} onSelect={() => onSelect(t.id)} />
            ))}
          </ul>
        </section>
      ))}
      {done.length > 0 && (
        <section>
          <button type="button" onClick={() => setDoneOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] font-bold text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)]">
            Done <span className="num font-normal text-[var(--ro-muted)]">{done.length}</span>
          </button>
          {doneOpen && (
            <ul>
              {done.map((t) => (
                <Row key={t.id} t={t} selected={selected === t.id} onSelect={() => onSelect(t.id)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Meta({ t }: { t: Task }): React.JSX.Element {
  const steps = t.checklist.length;
  const ticked = t.checklist.filter((c) => c.done).length;
  return (
    <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--ro-muted)]">
      {t.labels.slice(0, 2).map((l) => (
        <span key={l} className="max-lg:hidden">
          #{l}
        </span>
      ))}
      {steps > 0 && (
        <span className={cn('num inline-flex items-center gap-0.5', ticked === steps && 'text-[var(--ro-green-text)]')} title="Checklist">
          <CheckSquare size={11} /> {ticked}/{steps}
        </span>
      )}
      {t.links.length > 0 && (
        <span className="num inline-flex items-center gap-0.5" title={t.links.map((l) => l.title).join(', ')}>
          <Link2 size={11} /> {t.links.length}
        </span>
      )}
      {t.notes !== '' && <NotebookPen size={11} aria-label="Has notes" />}
      {t.recur !== 'none' && <Repeat size={11} aria-label={'Repeats ' + t.recur} />}
      {t.status === 'doing' && <span className="rounded-[var(--ro-r-sm)] bg-[var(--ro-row-hover)] px-1.5 font-semibold text-[var(--ro-ink-2)]">In progress</span>}
      {t.status === 'waiting' && <span className="rounded-[var(--ro-r-sm)] bg-[var(--ro-row-hover)] px-1.5 font-semibold text-[var(--ro-ink-2)]">Waiting</span>}
      <span className="flex w-3 justify-center">{t.assignee === 'agent' && <Sparkles size={12} className="text-[var(--ro-accent)]" aria-label="For your AI agent" />}</span>
      <span className="flex w-[76px] justify-end">
        <DueChip task={t} />
      </span>
    </span>
  );
}

function Row({ t, selected, onSelect }: { t: Task; selected: boolean; onSelect: () => void }): React.JSX.Element {
  return (
    <li>
      <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => e.key === 'Enter' && onSelect()} className={cn('group flex h-9 cursor-pointer items-center gap-2.5 border-b border-[var(--ro-hair)] px-4', selected ? 'bg-[var(--ro-row-hover)]' : 'hover:bg-[var(--ro-row)]')}>
        <PriorityPick t={t} />
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', t.status === 'done' && 'text-[var(--ro-muted)] line-through')}>{t.title}</span>
        <Meta t={t} />
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- board */

interface DropAt {
  s: TaskStatus;
  /** The card it lands above; '' is the end of the column. */
  before: string;
}

/** A task's priority flag, in the place of a check on every task row and card: click it to change the priority. */
export function PriorityPick({ t }: { t: Task }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={btn}
        type="button"
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={PRIORITY_LABEL[t.priority] + ': click to change'}
        aria-label={'Priority: ' + PRIORITY_LABEL[t.priority]}
        className="-ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[var(--ro-r-sm)] hover:bg-[var(--ro-row-hover)]"
      >
        {t.priority === 'none' ? <Flag size={13} style={{ color: PRIORITY_COLOR.none }} aria-hidden /> : <PriorityFlag priority={t.priority} size={13} />}
      </button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} className="w-44">
        {/* The menu lives in the page's top layer but its clicks still bubble to the card: keep them here. */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <PriorityMenu
            value={t.priority}
            onPick={(pr) => {
              setOpen(false);
              void save(t.id, { priority: pr });
            }}
          />
        </div>
      </Popover>
    </>
  );
}

function BoardView({ project, tasks, selected, onSelect, adding, setAdding }: { project: string; tasks: Task[]; selected: string; onSelect: (id: string) => void; adding: TaskStatus | ''; setAdding: (s: TaskStatus | '') => void }): React.JSX.Element {
  const [dragging, setDragging] = useState('');
  const [at, setAt] = useState<DropAt | null>(null);
  // A move shows the moment the card is dropped; the server's answer takes over once the list has it.
  const [moved, setMoved] = useState<{ id: string; status: TaskStatus; sort: number; done_at: string; answered: boolean } | null>(null);
  useEffect(() => {
    if (moved === null || !moved.answered) return;
    const t = tasks.find((x) => x.id === moved.id);
    if (t === undefined || (t.status === moved.status && t.sort === moved.sort)) setMoved(null);
  }, [tasks, moved]);
  const shown = moved === null ? tasks : tasks.map((t) => (t.id === moved.id ? { ...t, status: moved.status, sort: moved.sort, done_at: moved.done_at } : t));
  const cols = STATUSES.map((s) => ({ s, rows: shown.filter((t) => t.status === s).sort((a, b) => (s === 'done' ? b.done_at.localeCompare(a.done_at) : a.sort - b.sort)) }));
  const aim = (next: DropAt | null): void => setAt((cur) => (cur?.s === next?.s && cur?.before === next?.before ? cur : next));
  const end = (): void => {
    setDragging('');
    setAt(null);
  };
  const drop = async (e: React.DragEvent, fallback: TaskStatus): Promise<void> => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_TASK);
    const target = at ?? { s: fallback, before: '' };
    end();
    if (id === '' || target.before === id) return;
    const card = shown.find((t) => t.id === id);
    if (card === undefined) return;
    const col = (cols.find((c) => c.s === target.s)?.rows ?? []).filter((t) => t.id !== id);
    const i = target.before === '' ? col.length : Math.max(0, col.findIndex((t) => t.id === target.before));
    const prev = col[i - 1];
    const next = col[i];
    // The same place the server works out, so the card does not jump when its answer arrives.
    const sort = prev === undefined ? (next === undefined ? 1 : next.sort - 1) : next === undefined ? prev.sort + 1 : (prev.sort + next.sort) / 2;
    const doneAt = target.s === 'done' ? (card.status === 'done' ? card.done_at : new Date().toISOString().replace('T', ' ')) : '';
    setMoved({ id, status: target.s, sort, done_at: doneAt, answered: false });
    try {
      const r = await op<{ task: Task }>('tasks.move', { task: id, status: target.s, after: target.before === '' ? 'end' : prev === undefined ? 'start' : prev.id });
      setMoved({ id, status: r.task.status, sort: r.task.sort, done_at: r.task.done_at, answered: true });
      changed('tasks', 'projects');
    } catch {
      setMoved(null);
    }
  };
  const Line = (): React.JSX.Element => <li aria-hidden className="-my-[3px] h-[2px] shrink-0 rounded-full bg-[var(--ro-accent)]" />;
  return (
    <div
      data-scroll
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAt(null);
      }}
      className="grid min-h-0 flex-1 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto bg-[var(--ro-stage)] p-3"
    >
      {cols.map((c) => (
        <section
          key={c.s}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TASK)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            aim({ s: c.s, before: '' });
          }}
          onDrop={(e) => void drop(e, c.s)}
          className={cn('flex min-h-0 flex-col rounded-[var(--ro-r-md)] border bg-[var(--ro-shell)]', at?.s === c.s ? 'border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}
        >
          <h3 className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] font-bold">
            {STATUS_LABEL[c.s]} <span className="num font-normal text-[var(--ro-muted)]">{c.rows.length}</span>
          </h3>
          <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 pt-0">
            {c.rows.map((t, i) => (
              <Fragment key={t.id}>
                {/* Done keeps the newest first, so it shows no place to land. */}
                {c.s !== 'done' && at?.s === c.s && at.before === t.id && dragging !== t.id && <Line />}
                <li
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TASK, t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(t.id);
                  }}
                  onDragEnd={end}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DRAG_TASK)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    const r = e.currentTarget.getBoundingClientRect();
                    aim({ s: c.s, before: e.clientY < r.top + r.height / 2 ? t.id : (c.rows[i + 1]?.id ?? '') });
                  }}
                  className={cn(dragging === t.id && 'opacity-40')}
                >
                  <div role="button" tabIndex={0} onClick={() => onSelect(t.id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)} className={cn('flex cursor-pointer flex-col gap-1.5 rounded-[var(--ro-r)] border bg-[var(--ro-card)] p-2.5 shadow-[var(--ro-shadow-sm)] hover:border-[var(--ro-ink-2)]', selected === t.id ? 'border-[var(--ro-ink)]' : 'border-[var(--ro-line)]')}>
                    <span className="flex items-start gap-2">
                      <PriorityPick t={t} />
                      <span className={cn('min-w-0 flex-1 text-[13px] leading-[18px]', t.status === 'done' && 'text-[var(--ro-muted)] line-through')}>{t.title}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 pl-[24px] text-[12px] text-[var(--ro-muted)] empty:hidden">
                      <DueChip task={t} />
                      {t.checklist.length > 0 && (
                        <span className="num inline-flex items-center gap-0.5">
                          <CheckSquare size={11} /> {t.checklist.filter((x) => x.done).length}/{t.checklist.length}
                        </span>
                      )}
                      {t.links.length > 0 && (
                        <span className="num inline-flex items-center gap-0.5">
                          <Link2 size={11} /> {t.links.length}
                        </span>
                      )}
                      {t.assignee === 'agent' && <Sparkles size={12} className="text-[var(--ro-accent)]" aria-label="For your AI agent" />}
                      {t.labels.slice(0, 2).map((l) => (
                        <span key={l}>#{l}</span>
                      ))}
                    </span>
                  </div>
                </li>
              </Fragment>
            ))}
            {c.s !== 'done' && at?.s === c.s && at.before === '' && c.rows.length > 0 && <Line />}
            {c.rows.length === 0 && <li className={cn('rounded-[var(--ro-r)] border border-dashed px-3 py-4 text-center text-[12px] text-[var(--ro-muted)]', at?.s === c.s ? 'border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}>Drop a task here</li>}
            {c.s !== 'done' && (
              <li className="shrink-0">
                {adding === c.s ? (
                  // Enter adds the task above and keeps the line open for the next; Esc or leaving it empty closes it.
                  <QuickAdd project={project} status={c.s} compact autoFocus blurCloses onCancel={() => setAdding('')} className="rounded-[var(--ro-r)] border border-[var(--ro-ink-2)] bg-[var(--ro-card)]" />
                ) : (
                  <button type="button" onClick={() => setAdding(c.s)} className="flex h-8 w-full items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-left text-[13px] text-[var(--ro-muted)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]">
                    <Plus size={14} /> Add a task
                  </button>
                )}
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
      <span className="text-[12px] text-[var(--ro-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TaskPanel({ task: t, project, labels, onClose }: { task: Task; project: Project; labels: string[]; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [labelText, setLabelText] = useState('');
  const [step, setStep] = useState('');
  const [request, setRequest] = useState('');
  const [confirmNode, confirm] = useConfirm();
  const dueBtn = useRef<HTMLButtonElement | null>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const prBtn = useRef<HTMLButtonElement | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => setNotes(t.notes), [t.notes]);
  const secret = project.confidentiality === 'confidential';
  const set = async (patch: Params): Promise<void> => {
    const r = await save(t.id, patch);
    if (r !== null && r.request !== '') setRequest(r.request);
  };
  const addLabel = (): void => {
    const v = labelText.trim().toLowerCase();
    setLabelText('');
    if (v !== '' && !t.labels.includes(v)) void set({ labels: [...t.labels, v] });
  };
  const steps = t.checklist;
  const ticked = steps.filter((x) => x.done).length;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)] max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-30 max-[900px]:w-full max-[900px]:shadow-[var(--ro-shadow)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ro-hair)] px-3">
        <TaskCheck task={t} onToggle={() => void toggle(t)} />
        <span className="flex-1 text-[12px] font-semibold text-[var(--ro-muted)]">{t.status === 'done' ? 'Done ' + ago(t.done_at) : STATUS_LABEL[t.status]}</span>
        <IconButton icon={X} label="Close (Esc)" size={24} onClick={onClose} />
      </div>
      <div data-scroll className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <textarea
          rows={2}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== '' && title.trim() !== t.title && void set({ title: title.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Title"
          className="w-full resize-none bg-transparent text-[15px] font-bold leading-[22px] outline-none [field-sizing:content]"
        />
        <Segmented label="Status" size="sm" value={t.status} onChange={(s) => void set({ status: s })} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <div className="flex flex-col gap-2.5">
          <Field label="Due">
            <button ref={dueBtn} type="button" onClick={() => setDueOpen((o) => !o)} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r-sm)] px-1.5 text-[13px] hover:bg-[var(--ro-row)]">
              <CalendarDays size={13} className="text-[var(--ro-muted)]" />
              {t.due !== '' ? (
                <>
                  <DueChip task={t} className="text-[13px]" /> <span className="text-[12px] text-[var(--ro-muted)]">{t.due}</span>
                </>
              ) : (
                <span className="text-[var(--ro-muted)]">No due day</span>
              )}
            </button>
            <Popover open={dueOpen} anchor={dueBtn} onClose={() => setDueOpen(false)} className="w-56 p-1">
              <DuePicker value={t.due} onPick={(d) => { setDueOpen(false); void set({ due: d }); }} />
            </Popover>
          </Field>
          <Field label="Priority">
            <button ref={prBtn} type="button" onClick={() => setPrOpen((o) => !o)} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r-sm)] px-1.5 text-[13px] hover:bg-[var(--ro-row)]">
              {t.priority === 'none' ? <PriorityDot /> : <PriorityFlag priority={t.priority} size={13} />}
              <span className={t.priority === 'none' ? 'text-[var(--ro-muted)]' : undefined}>{PRIORITY_LABEL[t.priority]}</span>
            </button>
            <Popover open={prOpen} anchor={prBtn} onClose={() => setPrOpen(false)} className="w-44">
              <PriorityMenu value={t.priority} onPick={(p) => { setPrOpen(false); void set({ priority: p }); }} />
            </Popover>
          </Field>
          <Field label="For">
            <Segmented label="For whom" size="sm" value={t.assignee} onChange={(a) => (a === 'agent' && secret ? undefined : void set({ assignee: a }))} options={[{ value: 'person', label: 'You' }, { value: 'agent', label: 'Your AI agent', icon: Sparkles, title: secret ? 'Your AI agent is kept out of this confidential project' : 'Your AI agent works the task and writes what it did in the notes' }]} />
            {request !== '' && <RequestStatus id={request} className="mt-1" />}
          </Field>
          <Field label="Repeat">
            <Select ariaLabel="Repeat" className="w-40" value={t.recur} onChange={(v) => void set({ recur: v })} options={[{ value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }]} />
          </Field>
          <Field label="Labels">
            <div className="flex flex-wrap items-center gap-1">
              {t.labels.map((l) => (
                <span key={l} className="inline-flex h-6 items-center gap-0.5 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] pl-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">
                  #{l}
                  <button type="button" aria-label={'Remove ' + l} onClick={() => void set({ labels: t.labels.filter((x) => x !== l) })} className="rounded-[3px] p-0.5 hover:bg-[var(--ro-row-hover)]">
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                onBlur={addLabel}
                list={'ro-labels-' + project.id}
                placeholder="Add a label"
                aria-label="Add a label"
                className="h-6 w-24 min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
              <datalist id={'ro-labels-' + project.id}>
                {labels.filter((l) => !t.labels.includes(l)).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
          </Field>
        </div>

        <section className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-[12px] font-bold text-[var(--ro-ink-2)]">
            Checklist
            {steps.length > 0 && <span className="num font-normal text-[var(--ro-muted)]">{ticked}/{steps.length}</span>}
          </span>
          {steps.length > 0 && (
            <span className="h-1 overflow-hidden rounded-full bg-[var(--ro-track)]">
              <span className="block h-full bg-[var(--ro-green)]" style={{ width: `${(100 * ticked) / steps.length}%` }} />
            </span>
          )}
          <ul className="flex flex-col">
            {steps.map((it) => (
              <li key={it.id} className="group flex items-center gap-2 rounded-[var(--ro-r-sm)] px-1 py-1 hover:bg-[var(--ro-row)]">
                <input type="checkbox" checked={it.done} onChange={() => void op('tasks.check', { task: t.id, item: it.id, done: !it.done }).then(() => changed('tasks'))} aria-label={it.text} className="accent-[var(--ro-ink)]" />
                <span className={cn('min-w-0 flex-1 text-[13px]', it.done && 'text-[var(--ro-muted)] line-through')}>{it.text}</span>
                <span className="opacity-0 group-hover:opacity-100">
                  <IconButton icon={X} label="Remove the step" size={20} variant="danger" onClick={() => void set({ checklist: steps.filter((x) => x.id !== it.id) })} />
                </span>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step.trim() === '') return;
              void op('tasks.check', { task: t.id, text: step.trim() }).then(() => changed('tasks'));
              setStep('');
            }}
            className="flex items-center gap-2 px-1"
          >
            <Plus size={13} className="text-[var(--ro-muted)]" />
            <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" aria-label="Add a step" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          </form>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-[var(--ro-ink-2)]">Notes</span>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== t.notes && void set({ notes })} placeholder="Details, results, what is left" aria-label="Notes" className={cn(textareaCls, '[field-sizing:content] min-h-20')} />
        </section>

        <Links t={t} project={project} onChange={(links) => void set({ links })} />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ro-hair)] px-4 py-2.5 text-[12px] text-[var(--ro-muted)]">
        <span className="min-w-0 flex-1 truncate">
          Added {t.actor === 'agent' ? 'by your AI agent' : t.actor === 'system' ? 'as the next repeat' : 'by you'} · {ago(t.created)}
        </span>
        <Button
          size="sm"
          variant="danger"
          icon={Trash2}
          onClick={async () => {
            if (!(await confirm('Delete "' + clip(t.title, 80) + '"? Activity can bring it back.', 'Delete task', 'Delete'))) return;
            await op('tasks.delete', { task: t.id });
            changed('tasks', 'projects');
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
      {confirmNode}
    </aside>
  );
}

/* ---------------------------------------------------------------- links */

type LinkKind = Task['links'][number]['kind'];

function Links({ t, project, onChange }: { t: Task; project: Project; onChange: (links: { kind: LinkKind; id: string }[]) => void }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<{ kind: LinkKind; id: string; title: string }[] | null>(null);
  useEffect(() => {
    if (!open || options !== null) return;
    void Promise.all([
      op<{ works: ReadingRow[] }>('projects.works', { project: project.id }, { quiet: true }).then((r) => r.works.map((w) => ({ kind: 'work' as const, id: w.work.id, title: w.work.title }))),
      op<{ nodes: GNode[] }>('nodes.list', { project: project.id, passages: false, limit: 1000 }, { quiet: true }).then((r) => r.nodes.filter((n) => n.status !== 'researcher_rejected').map((n) => ({ kind: 'node' as const, id: n.id, title: n.title }))),
      op<{ manuscripts: { id: string; title: string }[] }>('ms.list', { project: project.id }, { quiet: true }).then((r) => r.manuscripts.map((m) => ({ kind: 'manuscript' as const, id: m.id, title: m.title }))),
      op<{ boards: { id: string; name: string }[] }>('boards.list', { project: project.id }, { quiet: true }).then((r) => r.boards.map((x) => ({ kind: 'board' as const, id: x.id, title: x.name }))),
      op<{ notes: Note[] }>('notes.list', { project: project.id, limit: 300 }, { quiet: true }).then((r) => r.notes.map((x) => ({ kind: 'note' as const, id: x.id, title: x.title || 'Untitled note' }))),
      op<{ experiments: { id: string; code: string; title: string }[] }>('exp.list', { project: project.id }, { quiet: true }).then((r) => r.experiments.map((x) => ({ kind: 'experiment' as const, id: x.id, title: x.code + ' ' + x.title }))),
    ]).then((parts) => setOptions(parts.flat()));
  }, [open, options, project.id]);
  const goTo = (l: Task['links'][number]): void => {
    if (l.kind === 'work') navigate('paper', { id: l.id });
    else if (l.kind === 'node') navigate('project', { id: project.id, view: 'map', node: l.id });
    else if (l.kind === 'manuscript') navigate('project', { id: project.id, view: 'ms', ms: l.id });
    else if (l.kind === 'board') navigate('project', { id: project.id, view: 'board', board: l.id });
    else if (l.kind === 'experiment') navigate('project', { id: project.id, view: 'exp', exp: l.id });
    else navigate('project', { id: project.id, view: 'notes', note: l.id });
  };
  const current = t.links.map((l) => ({ kind: l.kind, id: l.id }));
  const shown = (options ?? []).filter((o) => !t.links.some((l) => l.kind === o.kind && l.id === o.id) && (q.trim() === '' || o.title.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 40);
  return (
    <section className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-[12px] font-bold text-[var(--ro-ink-2)]">
        <span className="flex-1">Linked</span>
        <Button ref={btn} size="sm" variant="ghost" icon={Link2} onClick={() => setOpen((o) => !o)}>
          Link
        </Button>
      </span>
      {t.links.length === 0 ? (
        <span className="text-[12px] text-[var(--ro-muted)]">Papers, claims, experiments, manuscripts or boards this task is about</span>
      ) : (
        <ul className="flex flex-col">
          {t.links.map((l) => {
            const Icon = LINK_ICON[l.kind];
            return (
              <li key={l.kind + l.id} className="group flex items-center gap-2 rounded-[var(--ro-r-sm)] px-1 py-1 hover:bg-[var(--ro-row)]">
                <Icon size={13} className="shrink-0 text-[var(--ro-muted)]" />
                <button type="button" onClick={() => goTo(l)} className="min-w-0 flex-1 truncate text-left text-[13px]">
                  {l.title}
                </button>
                <span className="opacity-0 group-hover:opacity-100">
                  <IconButton icon={X} label="Unlink" size={20} variant="danger" onClick={() => onChange(current.filter((x) => !(x.kind === l.kind && x.id === l.id)))} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} align="right" className="w-80">
        <div className="border-b border-[var(--ro-hair)] p-1.5">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a paper, claim, experiment..." aria-label="Find something to link" className={cn(inputCls, 'h-7 text-[12px]')} />
        </div>
        <div data-scroll className="max-h-72 overflow-y-auto py-1">
          {options === null ? (
            <div className="flex justify-center p-3">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-[var(--ro-muted)]">Nothing to link</p>
          ) : (
            shown.map((o) => {
              const Icon = LINK_ICON[o.kind];
              return (
                <button
                  key={o.kind + o.id}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    onChange([...current, { kind: o.kind, id: o.id }]);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <Icon size={13} /> <span className="truncate">{o.title}</span>
                </button>
              );
            })
          )}
        </div>
      </Popover>
    </section>
  );
}

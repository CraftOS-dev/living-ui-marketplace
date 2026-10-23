/**
 * Small pieces every task view shares: the round check (its ring shows the
 * priority), the due day as people say it, the priority flag, the labels
 * for statuses and priorities, and a project card's to-do fields.
 */
import { Check, Flag } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { num } from '../../lib/format.ts';
import type { Project, Task, TaskPriority, TaskStatus } from '../../lib/types.ts';

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', waiting: 'Waiting', done: 'Done' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const PRIORITY_COLOR: Record<TaskPriority, string> = { none: 'var(--ro-line)', low: 'var(--ro-muted)', medium: 'var(--ro-pc-blue)', high: 'var(--ro-amber)', urgent: 'var(--ro-red)' };
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };

const pad = (n: number): string => (n < 10 ? '0' : '') + n;
export function dayOf(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function today(): string {
  return dayOf(new Date());
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dayOf(d);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime()) / 86400000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", "Friday", "Oct 30", "Yesterday", "3 days late". */
export function dueLabel(due: string, now = today()): string {
  if (due === '') return '';
  const d = diffDays(due, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < -1) return -d + ' days late';
  const date = new Date(due + 'T12:00:00');
  if (d < 7) return DAYS[date.getDay()] as string;
  return (MONTHS[date.getMonth()] as string) + ' ' + date.getDate() + (date.getFullYear() !== new Date().getFullYear() ? ', ' + date.getFullYear() : '');
}

export function DueChip({ task, className }: { task: Pick<Task, 'due' | 'status' | 'overdue'>; className?: string }): React.JSX.Element | null {
  if (task.due === '') return null;
  const t = today();
  const late = task.overdue;
  const soon = !late && task.status !== 'done' && task.due === t;
  return (
    <span className={cn('num inline-flex shrink-0 items-center text-[12px] font-semibold', late ? 'text-[var(--ro-red-text)]' : soon ? 'text-[var(--ro-accent-text)]' : 'text-[var(--ro-muted)]', className)} title={task.due}>
      {dueLabel(task.due, t)}
    </span>
  );
}

export function PriorityFlag({ priority, size = 12 }: { priority: TaskPriority; size?: number }): React.JSX.Element | null {
  if (priority === 'none') return null;
  return <Flag size={size} className="shrink-0" style={{ color: PRIORITY_COLOR[priority], fill: priority === 'urgent' || priority === 'high' ? PRIORITY_COLOR[priority] : 'none' }} aria-label={PRIORITY_LABEL[priority] + ' priority'} />;
}

/** The round check: its ring carries the priority; ticked, it fills. */
export function TaskCheck({ task, onToggle, size = 18 }: { task: Pick<Task, 'status' | 'priority' | 'title'>; onToggle: () => void; size?: number }): React.JSX.Element {
  const done = task.status === 'done';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={(done ? 'Reopen ' : 'Complete ') + task.title}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn('group/check flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors', done ? 'border-[var(--ro-ink-2)] bg-[var(--ro-ink-2)] text-[var(--ro-card)]' : 'hover:bg-[var(--ro-row-hover)]')}
      style={{ width: size, height: size, borderColor: done ? undefined : task.priority === 'none' ? 'var(--ro-ink-2)' : PRIORITY_COLOR[task.priority] }}
    >
      <Check size={size - 7} strokeWidth={3} className={cn(done ? 'opacity-100' : 'opacity-0 group-hover/check:opacity-40')} />
    </button>
  );
}

/**
 * A project card's to-do, as labelled fields: open, late and done tasks,
 * then the next task and when it is due.
 */
export function ProjectTodo({ p }: { p: Project }): React.JSX.Element {
  const s = p.stats;
  const open = s?.tasks_open ?? 0;
  const late = s?.tasks_overdue ?? 0;
  const done = s?.tasks_done ?? 0;
  const next = p.next_task ?? null;
  const label = 'block text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--ro-muted)]';
  const value = 'num block truncate text-[13px] font-semibold';
  return (
    <span className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
      <span className="min-w-0">
        <span className={label}>To do</span>
        <span className={value}>{num(open)}</span>
      </span>
      <span className="min-w-0">
        <span className={label}>Late</span>
        <span className={cn(value, late > 0 && 'text-[var(--ro-red-text)]')}>{num(late)}</span>
      </span>
      <span className="min-w-0">
        <span className={label}>Done</span>
        <span className={value}>{open + done === 0 ? '0' : `${num(done)} of ${num(open + done)}`}</span>
      </span>
      <span className="col-span-2 min-w-0" title={next?.title}>
        <span className={label}>Next</span>
        <span className={cn(value, next === null && 'font-normal text-[var(--ro-muted)]')}>{next !== null ? next.title : 'Nothing to do'}</span>
      </span>
      <span className="min-w-0">
        <span className={label}>Due</span>
        {next !== null && next.due !== '' ? (
          <DueChip task={{ due: next.due, status: 'todo', overdue: next.overdue }} className="block truncate text-[13px]" />
        ) : (
          <span className={cn(value, 'font-normal text-[var(--ro-muted)]')}>{next !== null ? 'No date' : 'None'}</span>
        )}
      </span>
    </span>
  );
}

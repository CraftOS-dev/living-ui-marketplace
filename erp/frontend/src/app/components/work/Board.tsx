/**
 * A project's task board: To do, Doing, Done. Cards drag between and within
 * columns (tasks.move keeps the order); a task opens to change anything,
 * including its column (the way to move a task on a phone). Each column
 * adds a task inline.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel, shortDay } from '../../lib/dates.ts';
import { hours, qty } from '../../lib/format.ts';
import type { Task, TaskStatus } from '../../lib/types/work.ts';
import { Segmented } from '../controls.tsx';
import { PersonAvatar } from '../people/common.tsx';
import { DateField, EmployeePicker, NumberInput } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, Notice, PillButton, softArea, softInput, useConfirm } from '../ui.tsx';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'Doing' },
  { status: 'done', label: 'Done' },
];

type Cols = Record<TaskStatus, Task[]>;

/* ---------------------------------------------------------------- modal */

function TaskModal({ task, canDelete, onClose, onSaved }: { task: Task; canDelete: boolean; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assignee, setAssignee] = useState<Option | null>(task.assignee !== null ? { id: task.assignee.id, label: task.assignee.name, value: task.assignee.id } : null);
  const [due, setDue] = useState(task.due);
  const [estimate, setEstimate] = useState(task.estimate_hours > 0 ? String(task.estimate_hours) : '');
  const [notes, setNotes] = useState(task.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const save = async (): Promise<void> => {
    if (title.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await op('tasks.update', { task: task.id, title: title.trim(), status, assignee: assignee?.id ?? 'none', due: due === '' ? 'none' : due, estimate_hours: estimate === '' ? '0' : estimate, notes }, { quiet: true });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`"${task.title}" is deleted.`, 'Delete this task?'))) return;
    try {
      await op('tasks.delete', { task: task.id }, { quiet: true });
      toast.success('Deleted');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Task"
      footer={
        <>
          {canDelete && (
            <PillButton variant="ghost" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              Delete
            </PillButton>
          )}
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={title.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" className={softInput} />
        </Field>
        <Field label="Column">
          <Segmented ariaLabel="Column" value={status} onChange={setStatus} options={COLUMNS.map((c) => ({ value: c.status, label: c.label }))} />
        </Field>
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
          <Field label="Assigned to" optional>
            <EmployeePicker value={assignee} onChange={setAssignee} clearable placeholder="Nobody" />
          </Field>
          <Field label="Due" optional>
            <DateField value={due} onChange={setDue} ariaLabel="Due" optional placeholder="No due date" />
          </Field>
          <Field label="Estimate" optional hint={task.hours > 0 ? `${hours(task.hours)} logged so far` : undefined}>
            <NumberInput value={estimate} onChange={setEstimate} ariaLabel="Estimate in hours" decimals={2} suffix="h" />
          </Field>
        </div>
        <Field label="Notes" optional>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" className={cn(softArea, 'min-h-[72px]')} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
      {confirmEl}
    </Modal>
  );
}

/* ----------------------------------------------------------------- card */

function TaskCard({ t, editable, dragging, onOpen, onDragStart, onDragEnd }: { t: Task; editable: boolean; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }): React.JSX.Element {
  const share = t.estimate_hours > 0 ? t.hours / t.estimate_hours : 0;
  return (
    <button
      type="button"
      data-task={t.id}
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'flex w-full flex-col gap-2 rounded-[18px] bg-[var(--erp-card)] p-3 text-left shadow-[0_8px_18px_-16px_rgba(29,28,26,0.6)] transition-transform',
        editable && 'cursor-grab active:cursor-grabbing',
        dragging && 'rotate-[1.5deg] scale-[0.98] ring-2 ring-[var(--erp-ink)]',
      )}
    >
      <span className={cn('text-[14px] font-semibold leading-5', t.status === 'done' && 'text-[var(--erp-ink-2)] line-through decoration-[var(--erp-muted)]')}>{t.title}</span>
      {(t.due !== '' || t.estimate_hours > 0 || t.hours > 0 || t.assignee !== null) && (
        <span className="flex items-center gap-2">
          {t.due !== '' && (
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold',
                t.overdue ? 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
              )}
              title={t.overdue ? `Late: was due ${dayLabel(t.due)}` : `Due ${dayLabel(t.due)}`}
            >
              <CalendarDays size={12} aria-hidden />
              {shortDay(t.due)}
            </span>
          )}
          {(t.estimate_hours > 0 || t.hours > 0) && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--erp-muted)]" title={t.estimate_hours > 0 ? `${hours(t.hours)} of ${hours(t.estimate_hours)} estimated` : `${hours(t.hours)} logged`}>
              {t.estimate_hours > 0 && (
                <span className="h-1.5 w-10 overflow-hidden rounded-full bg-[var(--erp-line)]">
                  <span className={cn('block h-full rounded-full', share > 1 ? 'bg-[var(--erp-red)]' : 'bg-[var(--erp-ink)]')} style={{ width: `${Math.min(100, share * 100)}%` }} />
                </span>
              )}
              <span className="num">
                {qty(t.hours)}
                {t.estimate_hours > 0 ? `/${qty(t.estimate_hours)}` : ''} h
              </span>
            </span>
          )}
          <span className="flex-1" />
          {t.assignee !== null && (
            <span title={t.assignee.name}>
              <PersonAvatar name={t.assignee.name} size={24} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- board */

export function Board({ projectId, tasks, editable, canDelete, onChanged }: { projectId: string; tasks: Cols; editable: boolean; canDelete: boolean; onChanged: () => void }): React.JSX.Element {
  const [cols, setCols] = useState<Cols>(tasks);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; index: number } | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [title, setTitle] = useState('');
  const lists = useRef<Record<TaskStatus, HTMLDivElement | null>>({ todo: null, doing: null, done: null });
  useEffect(() => setCols(tasks), [tasks]);

  const indexAt = (status: TaskStatus, y: number): number => {
    const el = lists.current[status];
    if (el === null) return 0;
    const cards = [...el.querySelectorAll<HTMLElement>('[data-task]')].filter((c) => c.dataset['task'] !== drag);
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]?.getBoundingClientRect();
      if (r !== undefined && y < r.top + r.height / 2) return i;
    }
    return cards.length;
  };

  const drop = async (status: TaskStatus, index: number): Promise<void> => {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (id === null) return;
    const from = (Object.keys(cols) as TaskStatus[]).find((k) => cols[k].some((t) => t.id === id));
    if (from === undefined) return;
    const task = cols[from].find((t) => t.id === id);
    if (task === undefined) return;
    const before = cols[from].findIndex((t) => t.id === id);
    if (from === status && before === index) return;
    // Show the move at once; the server keeps the same order.
    const next: Cols = { todo: [...cols.todo], doing: [...cols.doing], done: [...cols.done] };
    next[from] = next[from].filter((t) => t.id !== id);
    next[status].splice(index, 0, { ...task, status });
    setCols(next);
    try {
      await op('tasks.move', { task: id, status, sort: index });
      onChanged();
    } catch {
      setCols(tasks);
    }
  };

  const add = async (status: TaskStatus): Promise<void> => {
    const t = title.trim();
    if (t === '') {
      setAdding(null);
      return;
    }
    try {
      await op('tasks.add', { project: projectId, title: t, status });
      setTitle('');
      onChanged();
    } catch {
      /* shown */
    }
  };

  return (
    <div className="erp-strip -mx-4 flex snap-x snap-mandatory gap-3 relative overflow-x-auto px-4 pb-2 @min-[640px]:mx-0 @min-[640px]:grid @min-[640px]:snap-none @min-[640px]:grid-cols-3 @min-[640px]:overflow-visible @min-[640px]:px-0">
      {COLUMNS.map((c) => {
        const list = cols[c.status];
        const isOver = over?.status === c.status;
        return (
          <section
            key={c.status}
            aria-label={c.label}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const index = indexAt(c.status, e.clientY);
              if (over?.status !== c.status || over.index !== index) setOver({ status: c.status, index });
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void drop(c.status, indexAt(c.status, e.clientY));
            }}
            className={cn('flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col rounded-[24px] bg-[var(--erp-row)] p-3 transition-colors @min-[640px]:w-auto @min-[640px]:max-w-none', isOver && 'bg-[var(--erp-row-hover)]')}
          >
            <header className="mb-3 flex items-center gap-2 px-1">
              <span className={cn('size-2.5 rounded-full', c.status === 'todo' ? 'bg-[var(--erp-muted)]' : c.status === 'doing' ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-green)]')} />
              <h3 className="text-[14px] font-bold">{c.label}</h3>
              <span className="num rounded-full bg-[var(--erp-card)] px-2 text-[12px] font-bold text-[var(--erp-ink-2)]">{list.length}</span>
            </header>
            <div
              ref={(el) => {
                lists.current[c.status] = el;
              }}
              className="flex min-h-[64px] flex-col gap-2"
            >
              {list.map((t, i) => (
                <div key={t.id} className="flex flex-col gap-2">
                  {isOver && over.index === i && drag !== t.id && <span aria-hidden className="h-1 rounded-full bg-[var(--erp-ink)]" />}
                  <TaskCard t={t} editable={editable} dragging={drag === t.id} onOpen={() => editable && setOpen(t)} onDragStart={() => setDrag(t.id)} onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }} />
                </div>
              ))}
              {isOver && over.index >= list.filter((t) => t.id !== drag).length && <span aria-hidden className="h-1 rounded-full bg-[var(--erp-ink)]" />}
              {list.length === 0 && !isOver && <p className="px-2 py-4 text-center text-[12px] text-[var(--erp-muted)]">{c.status === 'done' ? 'Nothing finished yet' : 'Nothing here'}</p>}
            </div>
            {editable &&
              (adding === c.status ? (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void add(c.status);
                      if (e.key === 'Escape') {
                        setAdding(null);
                        setTitle('');
                      }
                    }}
                    onBlur={() => {
                      if (title.trim() === '') setAdding(null);
                    }}
                    placeholder="What needs doing"
                    aria-label={`New task in ${c.label}`}
                    className={cn(softInput, 'bg-[var(--erp-card)]')}
                  />
                  <div className="flex justify-end gap-2">
                    <PillButton size="sm" variant="ghost" onClick={() => setAdding(null)}>
                      Cancel
                    </PillButton>
                    <PillButton size="sm" icon={Plus} disabled={title.trim() === ''} onClick={() => void add(c.status)}>
                      Add
                    </PillButton>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTitle('');
                    setAdding(c.status);
                  }}
                  className="mt-2 flex h-10 items-center gap-2 rounded-[14px] px-3 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:bg-[var(--erp-card)] hover:text-[var(--erp-ink)]"
                >
                  <Plus size={15} aria-hidden /> Add a task
                </button>
              ))}
          </section>
        );
      })}
      {open !== null && <TaskModal task={open} canDelete={canDelete} onClose={() => setOpen(null)} onSaved={onChanged} />}
    </div>
  );
}


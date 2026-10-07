import { useRef, useState } from 'react';
import { CalendarDays, Check, Plus, X } from 'lucide-react';
import { RelDate, cn } from '../../kit/index.ts';
import { fmtDay } from '../format.ts';
import type { ActionItem } from '../types.ts';
import { InlineInput } from './fields.tsx';

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Compact due date: "Oct 8" or a quiet "Due date", opening the date picker. */
function DueDate({ value, onChange, done }: { value: string; onChange: (day: string) => void; done: boolean }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => input.current?.showPicker?.()}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-[var(--agent-app-radius)] px-2 text-[13px] transition-colors hover:bg-[var(--agent-app-hover)]',
          value === '' ? 'text-[var(--agent-app-muted)]/70' : 'text-[var(--agent-app-muted)]',
        )}
      >
        <CalendarDays size={13} />
        {value === '' ? 'Due date' : fmtDay(value, false)}
        {value !== '' && !done && <RelDate iso={value} className="ml-0.5" />}
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-label="Due date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}

/** Checklist of action items: done, text, owner and due date, all inline. */
export function ActionItems({
  items,
  onSave,
  onClearDone,
}: {
  items: ActionItem[];
  onSave: (next: ActionItem[]) => void;
  onClearDone: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const patch = (id: string, change: Partial<ActionItem>): void =>
    onSave(items.map((a) => (a.id === id ? { ...a, ...change } : a)));
  const add = (): void => {
    const title = draft.trim();
    if (title === '') return;
    onSave([...items, { id: newId(), title, assignee: '', due: '', done: false }]);
    setDraft('');
  };
  const doneCount = items.filter((a) => a.done).length;

  return (
    <div className="flex flex-col">
      {items.length === 0 && <p className="py-1 text-[15px] leading-7 text-[var(--agent-app-muted)]">No action items.</p>}
      {items.map((a) => (
        <div key={a.id} className="group -mx-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[var(--agent-app-radius)] px-2 py-1 transition-colors hover:bg-[var(--agent-app-hover)]/40">
          <button
            type="button"
            role="checkbox"
            aria-checked={a.done}
            aria-label={a.done ? 'Mark as not done' : 'Mark as done'}
            onClick={() => patch(a.id, { done: !a.done })}
            className={cn(
              'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
              a.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-[var(--agent-app-muted)]/60 hover:border-[var(--agent-app-text)]',
            )}
          >
            {a.done && <Check size={12} strokeWidth={3} />}
          </button>
          <InlineInput
            ariaLabel="Action item"
            value={a.title}
            onSave={(title) => (title.trim() === '' ? onSave(items.filter((x) => x.id !== a.id)) : patch(a.id, { title: title.trim() }))}
            className={cn('h-8 min-w-0 flex-1 basis-56 text-[15px]', a.done && 'text-[var(--agent-app-muted)] line-through')}
          />
          <div className="ml-7 flex items-center gap-1 sm:ml-0">
            <InlineInput
              ariaLabel="Owner"
              value={a.assignee}
              placeholder="Owner"
              onSave={(assignee) => patch(a.id, { assignee: assignee.trim() })}
              className="h-7 w-28 text-[13px] text-[var(--agent-app-muted)]"
            />
            <DueDate value={a.due} done={a.done} onChange={(due) => patch(a.id, { due })} />
            <button
              type="button"
              aria-label="Delete action item"
              title="Delete"
              onClick={() => onSave(items.filter((x) => x.id !== a.id))}
              className="inline-flex size-7 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] opacity-0 transition-opacity hover:bg-[var(--agent-app-hover)] hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-3">
        <Plus size={16} className="ml-px shrink-0 text-[var(--agent-app-muted)]" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          onBlur={add}
          placeholder="Add an action item"
          aria-label="New action item"
          className="h-9 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--agent-app-muted)]/80"
        />
        {doneCount > 0 && (
          <button
            type="button"
            onClick={onClearDone}
            className="inline-flex h-8 shrink-0 items-center rounded-[var(--agent-app-radius)] px-2.5 text-[13px] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
          >
            Clear {doneCount} done
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline editing primitives. Each keeps its own draft while focused and saves
 * on blur, so a background update (the worker finishing) never overwrites
 * what someone is typing, and nothing is written per keystroke.
 *
 * Every field sits flush with the text around it: the hover/focus frame is
 * drawn in negative margin, so the words line up with their section title.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';

const FRAME =
  'editable rounded-[var(--agent-app-radius)] border border-transparent bg-transparent outline-none transition-colors placeholder:text-[var(--agent-app-muted)]/70 hover:bg-[var(--agent-app-hover)]/60 focus:border-[var(--agent-app-border)] focus:bg-[var(--agent-app-surface)]';

function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

/** A self-sizing text area that saves on blur (reading size by default). */
export function TextBlock({
  value,
  onSave,
  placeholder,
  className,
  minRows = 2,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
  minRows?: number | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  useAutosize(ref, draft);
  return (
    <textarea
      ref={ref}
      value={draft}
      rows={minRows}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onSave(draft);
      }}
      className={cn(FRAME, '-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden px-2 py-1 text-[15px] leading-7', className)}
    />
  );
}

/** A title that wraps instead of being cut off; Enter saves, no newlines. */
export function TitleField({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  useAutosize(ref, draft);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label="Title"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => {
        focused.current = false;
        const t = draft.trim();
        if (t === '') setDraft(value);
        else if (t !== value) onSave(t);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          const el = e.currentTarget;
          setDraft(value);
          requestAnimationFrame(() => el.blur());
        }
      }}
      className={cn(FRAME, '-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden px-2 py-0.5', className)}
    />
  );
}

/** One-line inline input that saves on blur or Enter; Escape reverts. */
export function InlineInput({
  value,
  onSave,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
  ariaLabel: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          const el = e.currentTarget;
          setDraft(value);
          // Blur after the reverted draft has rendered, so blur saves nothing.
          requestAnimationFrame(() => el.blur());
        }
      }}
      className={cn(FRAME, 'min-w-0 px-2 py-0.5', className)}
    />
  );
}

/**
 * A name being renamed in place (speakers, attendees): opens focused with the
 * name selected; Enter or leaving saves, Escape cancels. onDone gets the new
 * name, or null when nothing changed.
 */
export function NameInput({
  value,
  ariaLabel,
  onDone,
  className,
}: {
  value: string;
  ariaLabel: string;
  onDone: (next: string | null) => void;
  className?: string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (save: boolean): void => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    onDone(save && next !== '' && next !== value ? next : null);
  };
  return (
    <input
      type="text"
      autoFocus
      value={draft}
      maxLength={80}
      aria-label={ariaLabel}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className={cn(
        'min-w-24 max-w-64 rounded-md border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 outline-none [field-sizing:content] focus:border-[var(--agent-app-accent)]',
        className,
      )}
    />
  );
}

/** "+ Add ..." affordance shared by every list. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 mt-1 inline-flex h-8 w-fit items-center gap-1.5 rounded-[var(--agent-app-radius)] px-2 text-[13px] font-medium text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
    >
      <Plus size={14} />
      {label}
    </button>
  );
}

/** An editable bullet list of strings (key points, decisions). */
export function BulletList({
  items,
  onSave,
  addLabel,
  emptyText,
}: {
  items: string[];
  onSave: (next: string[]) => void;
  addLabel: string;
  emptyText: string;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const t = draft.trim();
    if (t !== '') onSave([...items, t]);
    setDraft('');
    setAdding(false);
  };
  return (
    <div className="flex flex-col">
      {items.length === 0 && !adding && <p className="py-1 text-[15px] leading-7 text-[var(--agent-app-muted)]">{emptyText}</p>}
      <ul className="flex flex-col">
        {items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 24)}`} className="group flex items-start gap-3">
            <span aria-hidden className="flex h-9 w-1.5 shrink-0 items-center">
              <span className="size-1.5 rounded-full bg-[var(--agent-app-muted)]/70" />
            </span>
            <div className="min-w-0 flex-1">
              <TextBlock
                value={item}
                minRows={1}
                onSave={(next) => {
                  const t = next.trim();
                  onSave(t === '' ? items.filter((_, k) => k !== i) : items.map((x, k) => (k === i ? t : x)));
                }}
              />
            </div>
            <button
              type="button"
              aria-label="Remove"
              title="Remove"
              onClick={() => onSave(items.filter((_, k) => k !== i))}
              className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] opacity-0 transition-opacity hover:bg-[var(--agent-app-hover)] hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="Type and press Enter"
          className="ml-[18px] mt-1 h-9 rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-[15px] outline-none"
        />
      ) : (
        <AddButton label={addLabel} onClick={() => setAdding(true)} />
      )}
    </div>
  );
}

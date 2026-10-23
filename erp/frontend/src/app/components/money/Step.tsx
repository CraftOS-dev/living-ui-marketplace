/**
 * One numbered step of a full-screen flow (record a payment, import a
 * statement, write a journal entry): the step to do now is ink, finished
 * ones show a check, later ones stay soft.
 */
import type { ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';

export type StepState = 'todo' | 'current' | 'done';

export function Step({
  n,
  state,
  title,
  hint,
  action,
  delay = 1,
  className,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  hint?: ReactNode | undefined;
  action?: ReactNode | undefined;
  delay?: number | undefined;
  className?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('erp-rise flex min-w-0 flex-col rounded-[28px] bg-[var(--erp-card)] p-5', `erp-d${Math.min(5, delay)}`, className)} aria-label={`Step ${n}: ${title}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
            state === 'todo' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
            state === 'current' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
            state === 'done' && 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]',
          )}
        >
          {state === 'done' ? <Check size={14} strokeWidth={3} aria-label="Done" /> : n}
        </span>
        <h2 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h2>
        {action ?? (hint !== undefined && <span className="shrink-0 text-[12px] font-semibold text-[var(--erp-muted)]">{hint}</span>)}
      </div>
      {children}
    </section>
  );
}

/** A row of choice pills (methods, kinds); the chosen one is ink. */
export function ChoicePills<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors',
              on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)] hover:bg-[var(--erp-row-hover)] hover:text-[var(--erp-ink)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "More options": advanced fields one tap away. */
export function MoreOptions({ open, onToggle, children, label = 'More options' }: { open: boolean; onToggle: () => void; children: ReactNode; label?: string | undefined }): React.JSX.Element {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
        <span className={cn('flex size-5 items-center justify-center rounded-full bg-[var(--erp-row)] transition-transform', open && 'rotate-45')} aria-hidden>
          <Plus size={12} strokeWidth={2.6} />
        </span>
        {label}
      </button>
      {open && <div className="erp-pop mt-3 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

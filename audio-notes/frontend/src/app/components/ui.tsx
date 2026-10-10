/**
 * The app's small design system on top of the kit.
 *
 * Type scale (px): 12 caption / timestamp, 13 secondary and meta, 14 UI
 * body, 15 reading text (summary, points, transcript), 26 page title.
 * Hierarchy comes from weight and color, not more sizes. Spacing follows a
 * 4 px grid. Controls in one row share one height (28 chips, 32 / 36
 * buttons).
 */
import { useRef } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { fmtDay } from '../format.ts';

/** A native select styled as a field, with real room around its chevron. */
export function SelectField({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  variant = 'field',
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel: string;
  className?: string | undefined;
  /** field: bordered input look; chip: compact pill for meta rows. */
  variant?: 'field' | 'chip' | undefined;
}): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full min-w-0 appearance-none truncate outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--agent-app-ring)]/40',
          variant === 'field'
            ? 'h-9 rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] pl-3 pr-9 text-sm hover:border-[var(--agent-app-muted)]/50'
            : 'h-7 rounded-full bg-[var(--agent-app-surface-2)] pl-3 pr-7 text-[13px] font-medium [field-sizing:content] hover:bg-[var(--agent-app-hover)]',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={variant === 'field' ? 16 : 14}
        aria-hidden
        className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--agent-app-muted)]', variant === 'field' ? 'right-3' : 'right-2.5')}
      />
    </span>
  );
}

/** A date shown as a readable chip; clicking opens the browser's date picker. */
export function DateChip({ value, onChange }: { value: string; onChange: (day: string) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          const el = input.current;
          if (el === null) return;
          if (typeof el.showPicker === 'function') el.showPicker();
          else el.focus();
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--agent-app-surface-2)] px-3 text-[13px] font-medium transition-colors hover:bg-[var(--agent-app-hover)]"
      >
        <CalendarDays size={14} className="text-[var(--agent-app-muted)]" />
        {value !== '' ? fmtDay(value) : 'Set date'}
      </button>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-label="Date"
        value={value}
        onChange={(e) => e.target.value !== '' && onChange(e.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}

/** Read-only meta item: icon + text, same height as the chips. */
export function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 text-[13px] text-[var(--agent-app-muted)]">
      {icon}
      {children}
    </span>
  );
}

/** Document-style tabs: text with an accent underline. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ value: T; label: string; badge?: React.ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div role="tablist" className="flex gap-6 border-b border-[var(--agent-app-border)]">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px inline-flex items-center gap-2 border-b-2 pb-2.5 text-sm font-medium transition-colors',
            t.value === value
              ? 'border-[var(--agent-app-accent)] text-[var(--agent-app-text)]'
              : 'border-transparent text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/** Section title inside a page: reading-size, weight carries the hierarchy. */
export function SectionTitle({ children, meta, actions }: { children: React.ReactNode; meta?: string | undefined; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-baseline gap-2 text-[15px] font-semibold">
        {children}
        {meta !== undefined && <span className="text-[13px] font-normal tabular-nums text-[var(--agent-app-muted)]">{meta}</span>}
      </h3>
      {actions}
    </div>
  );
}

/** Small ghost icon button (32 px), always with a label for screen readers. */
export function IconButton({
  label,
  onClick,
  children,
  active = false,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] transition-colors hover:bg-[var(--agent-app-hover)]',
        active ? 'text-[var(--agent-app-text)]' : 'text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

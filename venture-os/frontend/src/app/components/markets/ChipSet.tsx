/**
 * Several choices as chips (sectors, stages, countries). The kernel's
 * ChipPicker picks one; a thesis needs several, so this local wrapper keeps
 * ChipPicker's look (same tokens, sizes and hover) for a set. Reported to
 * kernel-frontend as a needed `multiple` mode of ChipPicker.
 */
import { useState } from 'react';
import { cn } from '../../../kit/index.ts';

export function ChipSet<T extends string>({
  options,
  value,
  onChange,
  label,
  max = 12,
  className,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
  max?: number | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const [all, setAll] = useState(false);
  const chosenFirst = [...options.filter((o) => value.includes(o.value)), ...options.filter((o) => !value.includes(o.value))];
  const shown = all ? chosenFirst : chosenFirst.slice(0, Math.max(max, value.length));
  const rest = chosenFirst.length - shown.length;
  const toggle = (v: T): void => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {shown.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(o.value)}
            className={cn(
              'vo-focus vo-tap inline-flex h-8 cursor-pointer items-center rounded-[var(--vo-radius-sm)] border px-3 text-[13px] font-medium transition-colors duration-150',
              on ? 'border-[var(--vo-ink)] bg-[var(--vo-ink)] text-[var(--vo-on-ink)]' : 'border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink)] hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          aria-label={`${rest} more ${label.toLowerCase()}`}
          className="vo-focus vo-tap vo-mono inline-flex h-8 cursor-pointer items-center rounded-[var(--vo-radius-sm)] border border-dashed border-[var(--vo-line-2)] px-3 text-[12px] text-[var(--vo-muted)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]"
        >
          {`+${rest}`}
        </button>
      )}
    </div>
  );
}

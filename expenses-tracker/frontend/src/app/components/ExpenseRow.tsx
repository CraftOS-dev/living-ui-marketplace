/** One expense as a soft rounded row: icon badge, what and when, where it came from, amount. */
import { FileText, Paperclip, Repeat, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { dayLabel } from '../lib/dates.ts';
import { CategoryBadge } from '../lib/icons.tsx';
import { money } from '../lib/money.ts';
import type { Expense } from '../lib/types.ts';

const SOURCE: Record<string, { label: string; icon: LucideIcon }> = {
  agent: { label: 'AI agent', icon: Sparkles },
  receipt: { label: 'Receipt', icon: Paperclip },
  csv: { label: 'Imported', icon: FileText },
  recurring: { label: 'Recurring', icon: Repeat },
};

export function ExpenseRow({
  e,
  currency,
  onOpen,
  showDate = true,
  selectable = false,
  selected = false,
  onToggle,
}: {
  e: Expense;
  currency: string;
  onOpen: (el: Element, e: Expense) => void;
  showDate?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}): React.JSX.Element {
  const title = e.note !== '' ? e.note : (e.category ?? 'Expense');
  const sub = [e.note !== '' ? (e.category ?? 'Uncategorized') : e.category === null ? 'Uncategorized' : null, showDate ? dayLabel(e.date) : null]
    .filter((x) => x !== null)
    .join(' · ');
  const src = SOURCE[e.source];
  const SrcIcon = src?.icon;
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[18px] px-3 py-2.5 transition-colors',
        selected ? 'bg-[var(--et-accent)]/20' : 'bg-[var(--et-row)] hover:bg-[var(--et-row-hover)]',
      )}
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle?.(e.id)}
          aria-label={`Select ${title}`}
          className="ml-1 size-4 shrink-0 accent-[var(--et-ink)]"
        />
      )}
      <button type="button" onClick={(ev) => (selectable ? onToggle?.(e.id) : onOpen(ev.currentTarget, e))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <CategoryBadge icon={e.category_icon} size={40} tone="light" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{title}</span>
          {sub !== '' && <span className="block truncate text-[12px] text-[var(--et-muted)]">{sub}</span>}
        </span>
        {src !== undefined && SrcIcon !== undefined && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[var(--et-card)] px-2.5 py-1 text-[12px] font-semibold text-[var(--et-ink-2)] sm:inline-flex">
            <SrcIcon size={12} aria-hidden />
            {src.label}
          </span>
        )}
        <span className="num w-24 shrink-0 text-right">
          <span className="block text-[14px] font-bold">{money(e.amount_minor, currency)}</span>
          {e.original_currency !== undefined && (
            <span className="block text-[12px] text-[var(--et-muted)]">
              {e.original_amount} {e.original_currency}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

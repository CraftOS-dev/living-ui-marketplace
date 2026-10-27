/**
 * The one container every page is built from: a card with a header (a
 * small drawing, the title, a quiet note and one action, always in the same
 * places) and its content under a hairline. Pages lay panels out on a grid,
 * the most important one first and widest.
 */
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/** Delay a panel's rise by how far down the page it sits (the page cascades from the top). */
function rise(el: HTMLElement | null): void {
  if (el === null || el.dataset.risen === '1') return;
  el.dataset.risen = '1';
  const top = el.getBoundingClientRect().top;
  el.style.animationDelay = `${Math.round(Math.min(280, Math.max(0, top - 80) / 3))}ms`;
}

export function Panel({
  title,
  art,
  note,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode;
  art?: ReactNode | undefined;
  note?: ReactNode | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  id?: string | undefined;
}): React.JSX.Element {
  return (
    <section ref={rise} id={id} className={cn('lo-panel flex min-w-0 flex-col rounded-[var(--lo-r-xl)] border border-[var(--lo-hair)] bg-[var(--lo-card)] shadow-[var(--lo-shadow-sm)]', className)}>
      <header className="flex min-h-[52px] items-center gap-2.5 border-b border-[var(--lo-hair)] px-4 py-2.5 md:px-5">
        {art !== undefined && <span className="flex size-7 shrink-0 items-center justify-center">{art}</span>}
        <h2 className="serif min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        {note !== undefined && <span className="shrink-0 text-[12px] font-bold text-[var(--lo-muted)]">{note}</span>}
        {action}
      </header>
      <div className={cn('min-w-0 flex-1 p-4 md:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** The panel's way to the full page ("Board", "Open"). */
export function PanelLink({ to, children }: { to: string; children: ReactNode }): React.JSX.Element {
  return (
    <a href={to} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--lo-r-sm)] px-2 text-[12px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)] hover:text-[var(--lo-ink)]">
      {children} <ArrowRight size={12} />
    </a>
  );
}

/** A small heading inside a panel, to split its content into parts. */
export function SubHead({ children, action }: { children: ReactNode; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2">
      <p className="min-w-0 flex-1 text-[12px] font-extrabold text-[var(--lo-muted)]">{children}</p>
      {action}
    </div>
  );
}

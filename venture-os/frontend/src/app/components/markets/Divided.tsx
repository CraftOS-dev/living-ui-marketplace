/**
 * Cards whose structure is visible (fix 4, the owner's divider rule): a
 * card is a stack of sections, each separated from the next by a
 * full-width hairline, each starting with its title at the top left (and at
 * most one small aside on the right). Nothing floats between sections.
 *
 *   <DCard label="Funding activity">
 *     <DSection title="Rounds per month" aside={...}>...</DSection>
 *     <DSection title="Recent rounds">...</DSection>
 *   </DCard>
 *
 * Facts inside a section align on a two-column grid (FactGrid).
 */
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import { Hint } from '../ui.tsx';

/** A hairline card whose children are DSections with full-width dividers between them. */
export function DCard({ children, className, label, as = 'section' }: { children: ReactNode; className?: string | undefined; label?: string | undefined; as?: 'section' | 'article' | undefined }): React.JSX.Element {
  const Tag = as;
  return (
    <Tag aria-label={label} className={cn('vo-in vo-panel flex min-w-0 flex-col divide-y divide-[var(--vo-line)] overflow-hidden', className)}>
      {children}
    </Tag>
  );
}

/** One section of a DCard: its title top left, an optional aside top right, then its content. */
export function DSection({ title, aside, tip, children, className, bodyClass, flush }: { title?: ReactNode; aside?: ReactNode; tip?: string | undefined; children?: ReactNode; className?: string | undefined; bodyClass?: string | undefined; flush?: boolean | undefined }): React.JSX.Element {
  const head = title !== undefined || (aside !== undefined && aside !== null);
  return (
    <div className={cn('flex min-w-0 flex-col', flush === true ? '' : 'px-4 py-3', className)}>
      {head && (
        <div className={cn('flex min-h-6 min-w-0 items-center gap-2', flush === true && 'px-4 pt-3', children !== undefined && 'mb-2')}>
          {title !== undefined && (
            <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold leading-5 text-[var(--vo-ink)]">
              <span className="vo-wrap min-w-0">{title}</span>
              {tip !== undefined && <Hint text={tip} />}
            </h3>
          )}
          {aside !== undefined && aside !== null && <div className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--vo-muted)]">{aside}</div>}
        </div>
      )}
      {children !== undefined && <div className={cn('min-w-0', bodyClass)}>{children}</div>}
    </div>
  );
}

/** Labels and values on one grid: label column, value column. */
export function FactGrid({ rows, className }: { rows: { label: string; value: ReactNode; tip?: string | undefined }[]; className?: string | undefined }): React.JSX.Element {
  return (
    <dl className={cn('grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]', className)}>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt title={r.tip} className="text-[var(--vo-muted)]">
            {r.label}
          </dt>
          <dd className="vo-wrap min-w-0 text-[var(--vo-ink)]">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

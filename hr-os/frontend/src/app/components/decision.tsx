/**
 * Decisions on rows (Approve, Accept, Reject, Decline, Dismiss) and items
 * marked done, built once for the Inbox, Home "Needs you", the modules'
 * approval lists and task lists.
 *
 * A click marks the row with its outcome: the row shows it inline (a check in
 * --hr-good with "Approved", or an X in muted ink with "Dismissed") for
 * 600 ms, folds its height away (250 ms), and only then does the decision run
 * (its optimistic drop takes the row out of the data). No success toast. When
 * the decision fails, the operation's error toast shows and the row returns.
 * Reduced motion: the outcome shows, then the row goes, with no fold. A row
 * marked done shows the check filled in --hr-good with "Done".
 *
 *   <DecisionRow id={a.id} as="li" className="...">
 *     ...
 *     <DecisionButton outcome="approved" onClick={() => decide(a.id, 'approved', () => act([drop(a.id)], () => op(...), READS))}>Approve</DecisionButton>
 *   </DecisionRow>
 *
 * decide([...ids], outcome, commit) marks several rows at once (Approve all).
 * A decision that needs the PIN asks for it first (askPin), then decides.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, CheckCheck, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { Outcome } from '../lib/contract.ts';
import { t } from '../lib/i18n.ts';
import { Button } from './ui.tsx';
import type { ButtonProps } from './ui.tsx';

export type { Outcome };

/** A decision's icon, on its button and in its outcome: a check (approve, done), a double check (accept), an X (reject, decline, dismiss). */
export const OUTCOME_ICON: Record<Outcome, LucideIcon> = { approved: Check, accepted: CheckCheck, rejected: X, declined: X, dismissed: X, done: Check };

function positive(o: Outcome): boolean {
  return o === 'approved' || o === 'accepted' || o === 'done';
}

const SHOW = 600;
const FOLD = 250;

const marks = new Map<string, Outcome>();
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Mark rows decided, then run `commit` once the outcome has shown and the
 * rows have folded. The timer is not tied to the page: leaving it at once
 * still sends the decision. `commit` answering null (act's failure) or
 * false, or throwing, lifts the marks, and the rows come back.
 */
export function decide(ids: string | string[], outcome: Outcome, commit: () => unknown): void {
  const list = typeof ids === 'string' ? [ids] : ids;
  if (list.length === 0) return;
  for (const id of list) marks.set(id, outcome);
  emit();
  const lift = (): void => {
    let any = false;
    for (const id of list) {
      if (marks.get(id) === outcome) {
        marks.delete(id);
        any = true;
      }
    }
    if (any) emit();
  };
  window.setTimeout(
    () => {
      Promise.resolve()
        .then(commit)
        .then(
          // Done: the row left with the data. Should the data still hold it a while later, it shows again.
          (r) => (r === null || r === false ? lift() : window.setTimeout(lift, 5000)),
          lift,
        );
    },
    reducedMotion() ? SHOW : SHOW + FOLD,
  );
}

/** The outcome a row was marked with, or null. */
export function useOutcome(id: string): Outcome | null {
  useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    () => version,
  );
  return marks.get(id) ?? null;
}

const FOLDED = ['height', 'overflow', 'transition', 'padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width', 'margin-top', 'margin-bottom', 'opacity'];

/**
 * A row (or card) that can be decided: while marked it shows the outcome over
 * its content (the content cannot be used), then folds its height to nothing.
 * Its children sit in a `display: contents` box, so the row's own layout
 * (flex, grid, gap) is unchanged.
 */
export function DecisionRow({ id, as = 'li', className, children }: { id: string; as?: 'li' | 'div' | 'section' | undefined; className?: string | undefined; children: ReactNode }): React.JSX.Element {
  const outcome = useOutcome(id);
  const ref = useRef<HTMLElement | null>(null);
  const [fold, setFold] = useState(false);
  useEffect(() => {
    if (outcome === null) {
      setFold(false);
      return;
    }
    if (reducedMotion()) return;
    const timer = window.setTimeout(() => setFold(true), SHOW);
    return () => window.clearTimeout(timer);
  }, [outcome]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (!fold) {
      for (const k of FOLDED) el.style.removeProperty(k);
      return;
    }
    // In a list with a gap, the row also gives its gap back, so the next row rises without a jump.
    const gap = parseFloat(getComputedStyle(el.parentElement ?? el).rowGap) || 0;
    el.style.height = `${el.offsetHeight}px`;
    el.style.overflow = 'hidden';
    void el.offsetHeight;
    el.style.transition = `height ${FOLD}ms ease, padding ${FOLD}ms ease, margin ${FOLD}ms ease, border-width ${FOLD}ms ease, opacity ${FOLD}ms ease`;
    el.style.height = '0px';
    el.style.paddingTop = '0px';
    el.style.paddingBottom = '0px';
    el.style.borderTopWidth = '0px';
    el.style.borderBottomWidth = '0px';
    el.style.marginTop = '0px';
    el.style.marginBottom = gap > 0 ? `-${gap}px` : '0px';
    el.style.opacity = '0';
  }, [fold]);
  const Icon = outcome !== null ? OUTCOME_ICON[outcome] : null;
  const body = (
    <>
      <div className="contents" inert={outcome !== null}>
        {children}
      </div>
      {outcome !== null && Icon !== null && (
        <div role="status" className="hr-outcome absolute inset-0 z-[2] flex items-center justify-center gap-1.5 rounded-[inherit] bg-[color-mix(in_srgb,var(--hr-panel)_88%,transparent)] text-[13px] font-medium">
          {outcome === 'done' ? (
            // The task's check, filled.
            <span aria-hidden className="flex size-[18px] items-center justify-center rounded-full bg-[var(--hr-good)] text-[var(--hr-page)]">
              <Check size={11} strokeWidth={3} />
            </span>
          ) : (
            <Icon size={16} strokeWidth={2.2} aria-hidden className={positive(outcome) ? 'text-[var(--hr-good)]' : 'text-[var(--hr-muted)]'} />
          )}
          <span className={positive(outcome) ? 'text-[var(--hr-ink)]' : 'text-[var(--hr-ink-2)]'}>{t(`ui.outcome.${outcome}`)}</span>
        </div>
      )}
    </>
  );
  const cls = cn('relative', className);
  if (as === 'div')
    return (
      <div ref={(el) => void (ref.current = el)} className={cls} data-outcome={outcome ?? undefined}>
        {body}
      </div>
    );
  if (as === 'section')
    return (
      <section ref={(el) => void (ref.current = el)} className={cls} data-outcome={outcome ?? undefined}>
        {body}
      </section>
    );
  return (
    <li ref={(el) => void (ref.current = el)} className={cls} data-outcome={outcome ?? undefined}>
      {body}
    </li>
  );
}

/** A decision button: its icon follows the outcome (check, double check, X). */
export function DecisionButton({ outcome, ...rest }: Omit<ButtonProps, 'icon'> & { outcome: Outcome }): React.JSX.Element {
  return <Button icon={OUTCOME_ICON[outcome]} {...rest} />;
}

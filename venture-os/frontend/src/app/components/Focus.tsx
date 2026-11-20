/**
 * Focus mode, the queue view (SPEC 2, U7): one card at a time, the result
 * your AI agent prepared and 1 to 3 buttons. Keys: J and K move, A takes the
 * primary action, X skips, E edits, Esc leaves. After a decision the next
 * card slides in (6px, 200ms). The end state is "All clear".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useOp } from '../lib/live.ts';
import { go, navigate, previousRoute } from '../lib/router.ts';
import type { NextAction, NextKind, NextList } from '../lib/types.ts';
import { NEXT_READS, NextCard, primaryOf, runNextAction } from './next.tsx';
import { Button, Empty, IconButton, LoadError, Skeleton } from './ui.tsx';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767.98px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767.98px)');
    const fn = (): void => setNarrow(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return narrow;
}

function leave(): void {
  const prev = previousRoute();
  if (prev !== null && prev.path !== '/focus') navigate(prev.path, Object.fromEntries(prev.query));
  else navigate('/');
}

export interface FocusProps {
  /** Open at this item key. */
  at?: string | undefined;
  /** Only these kinds (a module's own queue, e.g. verdicts in the Inbox). */
  kinds?: NextKind[] | undefined;
  /** Where Esc goes (default: the page before, else Home). */
  onLeave?: (() => void) | undefined;
}

/**
 * The queue view (SPEC 2, U7): the Next items one card at a time with
 * J, K, A, X, E and Esc; a progress bar; "All clear" at the end. The Focus
 * page shows it whole; a module can embed it for its own kinds.
 */
export function Focus({ at: atKey, kinds, onLeave }: FocusProps): React.JSX.Element {
  const live = useOp<NextList>('next.list', kinds !== undefined ? { limit: 200, kinds } : { limit: 200 }, NEXT_READS, { name: 'focus.next', keep: true });
  const narrow = useNarrow();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState<NextAction | null>(null);
  const [done, setDone] = useState(0);
  const started = useRef(false);

  const order = useMemo(() => {
    const items = live.data?.items ?? [];
    return [...items.filter((i) => !skipped.includes(i.key)), ...items.filter((i) => skipped.includes(i.key))];
  }, [live.data, skipped]);
  const at = Math.min(pos, Math.max(0, order.length - 1));
  const item = order[at];

  // Open at the item a row asked for (once).
  useEffect(() => {
    if (started.current || live.data === null) return;
    started.current = true;
    const key = atKey ?? null;
    if (key !== null) {
      const i = order.findIndex((x) => x.key === key);
      if (i >= 0) setPos(i);
    }
  }, [live.data, order, atKey]);

  const move = useCallback(
    (d: 1 | -1) => {
      if (order.length === 0) return;
      setDir(d === 1 ? 'next' : 'prev');
      setEditing(false);
      setChoosing(null);
      setPos((p) => Math.max(0, Math.min(order.length - 1, Math.min(p, order.length - 1) + d)));
    },
    [order.length],
  );

  const afterDone = useCallback(() => {
    setDir('next');
    setEditing(false);
    setChoosing(null);
    setDone((n) => n + 1);
  }, []);

  const skip = useCallback(() => {
    if (item === undefined) return;
    setDir('next');
    setEditing(false);
    setChoosing(null);
    setSkipped((s) => [...s.filter((k) => k !== item.key), item.key]);
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target as HTMLElement;
      if (tg.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        e.preventDefault();
        if (choosing !== null) setChoosing(null);
        else if (editing) setEditing(false);
        else (onLeave ?? leave)();
        return;
      }
      if (item === undefined) return;
      if (k === 'j' || e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      } else if (k === 'k' || e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      } else if (k === 'x') {
        e.preventDefault();
        skip();
      } else if (k === 'e') {
        e.preventDefault();
        if (item.data?.edit !== undefined) setEditing(true);
        else if (item.href !== '') go(item.href);
      } else if (k === 'a') {
        e.preventDefault();
        const p = primaryOf(item);
        if (p === undefined || editing) return;
        if (p.choose !== null && p.choose !== undefined) setChoosing(p);
        else void runNextAction(item, p).then((ok) => ok && afterDone());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, move, skip, editing, choosing, afterDone, onLeave]);

  const total = order.length + done;
  const progress = total === 0 ? 1 : done / total;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <div className="vo-panel flex flex-col gap-4 p-6">
            <Skeleton className="w-24" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-20 w-full" />
          </div>
        )
      ) : item === undefined ? (
        <div className="vo-in flex min-h-[50vh] items-center justify-center">
          <Empty icon={CheckCheck} title="All clear" action={<Button onClick={() => navigate('/')}>Home</Button>} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--vo-sunk)]" role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-label="Cleared">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--vo-ink)] transition-[width] duration-200 ease-out" style={{ width: `${progress * 100}%` }} />
            </span>
            <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">
              {at + 1} / {order.length}
            </span>
            <IconButton icon={ChevronLeft} label="Previous (K)" size={28} disabled={at === 0} onClick={() => move(-1)} />
            <IconButton icon={ChevronRight} label="Next (J)" size={28} disabled={at >= order.length - 1} onClick={() => move(1)} />
          </div>
          <div key={item.key} className={cn(dir === 'next' ? 'vo-slide-next' : 'vo-slide-prev')}>
            <NextCard item={item} editing={editing} onEditing={setEditing} onDone={afterDone} large={narrow} choosing={choosing} onChoosing={setChoosing} onSkip={skip} />
          </div>
        </>
      )}
    </div>
  );
}


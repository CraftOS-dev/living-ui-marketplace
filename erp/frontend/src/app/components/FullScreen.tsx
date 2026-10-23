/**
 * A full screen that grows from the button that opened it with a circular
 * reveal and shrinks back into it on close (the Expenses and Inventory "+"
 * screens). Used for focused work: creating something, recording a payment,
 * reconciling, a stock change.
 *
 *   const fs = useFullScreen();
 *   <button onClick={(e) => fs.open(e.currentTarget)}>...</button>
 *   {fs.node(<MyScreen onClose={fs.close} />)}
 *
 * Escape closes it. While it is open the page behind does not scroll, and
 * the new-version reload waits (data-busy-screen).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { CircleButton } from './ui.tsx';

type Origin = { x: number; y: number };

export function originOf(el: Element | null | undefined): Origin {
  if (el === null || el === undefined) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function reveal(el: HTMLElement, o: Origin, open: boolean): Animation | null {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return null;
  const r = Math.hypot(Math.max(o.x, window.innerWidth - o.x), Math.max(o.y, window.innerHeight - o.y)) + 24;
  const small = `circle(24px at ${o.x}px ${o.y}px)`;
  const big = `circle(${r}px at ${o.x}px ${o.y}px)`;
  return el.animate([{ clipPath: open ? small : big }, { clipPath: open ? big : small }], {
    duration: open ? 520 : 380,
    easing: open ? 'cubic-bezier(0.65, 0, 0.35, 1)' : 'cubic-bezier(0.55, 0, 0.75, 0.2)',
    fill: 'both',
  });
}

export interface FullScreenControl {
  open: (from?: Element | null) => void;
  close: () => void;
  isOpen: boolean;
  /** Render the screen's content inside the reveal (only while open). */
  node: (content: ReactNode, opts?: { title?: string | undefined; tone?: 'shell' | 'canvas' | undefined }) => ReactNode;
}

export function useFullScreen(onClosed?: () => void): FullScreenControl {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const closing = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  const open = useCallback((from?: Element | null) => {
    closing.current = false;
    setOrigin(originOf(from));
  }, []);

  const close = useCallback(() => {
    if (closing.current || origin === null) return;
    closing.current = true;
    const anim = root.current !== null ? reveal(root.current, origin, false) : null;
    const done = (): void => {
      setOrigin(null);
      closedRef.current?.();
    };
    if (anim === null) done();
    else anim.onfinish = done;
  }, [origin]);

  const node = useCallback(
    (content: ReactNode, opts?: { title?: string | undefined; tone?: 'shell' | 'canvas' | undefined }) =>
      origin === null ? null : (
        <Screen origin={origin} rootRef={root} onEscape={close} title={opts?.title} tone={opts?.tone ?? 'shell'}>
          {content}
        </Screen>
      ),
    [origin, close],
  );

  return { open, close, isOpen: origin !== null, node };
}

function Screen({ origin, rootRef, onEscape, children, title, tone }: { origin: Origin; rootRef: React.RefObject<HTMLDivElement | null>; onEscape: () => void; children: ReactNode; title?: string | undefined; tone: 'shell' | 'canvas' }): React.JSX.Element {
  useLayoutEffect(() => {
    if (rootRef.current !== null) reveal(rootRef.current, origin, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [origin, rootRef]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);
  return createPortal(
    <div
      ref={rootRef}
      data-busy-screen
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn('@container fixed inset-0 z-[70] overflow-y-auto text-[var(--erp-ink)]', tone === 'shell' ? 'bg-[var(--erp-shell)]' : 'bg-[var(--erp-canvas)]')}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The top bar of a full screen: a title, optional steps or actions, and close. */
export function ScreenBar({ title, sub, onClose, actions, width = 'wide' }: { title: ReactNode; sub?: ReactNode | undefined; onClose: () => void; actions?: ReactNode | undefined; width?: 'wide' | 'narrow' | undefined }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 bg-[var(--erp-shell)]/95 backdrop-blur-sm">
      <div className={cn('mx-auto flex items-center gap-3 px-4 py-4 @min-[640px]:px-8', width === 'narrow' ? 'max-w-[760px]' : 'max-w-[1180px]')}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold">{title}</h2>
          {sub !== undefined && <div className="truncate text-[13px] text-[var(--erp-muted)]">{sub}</div>}
        </div>
        {actions}
        <CircleButton icon={X} label="Close" variant="row" size={40} onClick={onClose} />
      </div>
    </div>
  );
}

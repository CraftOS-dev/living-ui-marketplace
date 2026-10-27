/**
 * Motion for lists: a new row comes in once (lo-in), a row that goes
 * collapses first and only then leaves the data. Nothing moves when the
 * system asks for reduced motion.
 */
import { act, isQuiet } from './live.ts';
import type { Change, Collection } from './live.ts';

function still(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------ arriving */

// A page's first rows arrive with the page (its panels rise); only rows that
// come later animate on their own. Each row decides once, when first seen.
let shownAt = typeof performance !== 'undefined' ? performance.now() : 0;
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => (shownAt = performance.now()));
const decided = new Map<string, string>();

/** The class for a row by its id: 'lo-in' when it arrives after the page opened, otherwise nothing. */
export function enter(id: string): string {
  let c = decided.get(id);
  if (c === undefined) {
    c = isQuiet(id) || performance.now() - shownAt < 900 ? '' : 'lo-in';
    decided.set(id, c);
  }
  return c;
}

/* ------------------------------------------------------------ leaving */

/** The row an event came from (the nearest element marked data-row). */
export function rowOf(e: { currentTarget: EventTarget | null }): HTMLElement | null {
  const t = e.currentTarget;
  return t instanceof Element ? (t.closest('[data-row]') as HTMLElement | null) : null;
}

interface Leaving {
  done: Promise<void>;
  back: () => void;
}

/** Collapse a row out of its list ('collapse'), or shrink a tile out of its grid ('shrink'). */
export function leave(el: HTMLElement | null, how: 'collapse' | 'shrink' = 'collapse'): Leaving {
  if (el === null || still() || typeof el.animate !== 'function') return { done: Promise.resolve(), back: () => undefined };
  el.style.pointerEvents = 'none';
  let a: Animation;
  if (how === 'shrink') {
    a = el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }], { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
  } else {
    const h = el.getBoundingClientRect().height;
    el.style.overflow = 'hidden';
    a = el.animate(
      [
        { height: `${h}px`, opacity: 1, transform: 'translateX(0)' },
        { height: `${h}px`, opacity: 0, transform: 'translateX(14px)', offset: 0.55 },
        { height: '0px', opacity: 0, transform: 'translateX(14px)', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
  }
  return {
    done: a.finished.then(
      () => undefined,
      () => undefined,
    ),
    back: () => {
      a.cancel();
      el.style.pointerEvents = '';
      el.style.overflow = '';
    },
  };
}

/** Animate the row out, then take it out of the data and tell the server. */
export async function vanish<T>(el: HTMLElement | null, changes: Change[], run: () => Promise<T>, reads: Collection[], how: 'collapse' | 'shrink' = 'collapse'): Promise<T | undefined> {
  const l = leave(el, how);
  await l.done;
  const r = await act(changes, run, reads);
  if (r === undefined) l.back();
  return r;
}

/** Replay a small bounce on an element (a tapped sticker or glass). */
export function bounce(el: Element | null): void {
  if (!(el instanceof HTMLElement) || still()) return;
  el.classList.remove('lo-bounce');
  void el.offsetWidth;
  el.classList.add('lo-bounce');
}

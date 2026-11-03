/**
 * The little motion the app has, without a library: the gauge sweeping to
 * its score and rows folding away when removed. Only transforms and sizes
 * move; nothing fades. Reduced motion turns it off.
 */
import { useEffect, useRef, useState } from 'react';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

/** A number that runs from where it was (0 on first show) to `target`. */
export function useTween(target: number, ms = 700): number {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  const cur = useRef(v);
  useEffect(() => {
    if (reducedMotion()) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    let t0 = -1;
    const step = (t: number): void => {
      if (t0 < 0) t0 = t;
      const k = Math.min(1, (t - t0) / ms);
      const x = from + (target - from) * easeOut(k);
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/**
 * Fold a row away before it is removed. Returns `undo`, which puts it back
 * when the server refuses; on success the list reload drops the element.
 */
export async function vanish(el: Element | null): Promise<() => void> {
  if (!(el instanceof HTMLElement) || reducedMotion()) return () => {};
  const h = el.offsetHeight;
  const overflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const anim = el.animate(
    [
      { height: h + 'px', transform: 'scale(1)' },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', transform: 'scale(0.98)' },
    ],
    { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
  );
  await anim.finished.catch(() => undefined);
  return () => {
    anim.cancel();
    el.style.overflow = overflow;
  };
}

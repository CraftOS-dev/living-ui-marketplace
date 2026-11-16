/**
 * Loading order for the first pages (home-reports): the page's one combined
 * read starts while the page renders, before any panel's own effect sends
 * its reads, so it is first in line; the modules' parts mount after it
 * answered, one after another, and those below the fold only when they
 * scroll into view. The server serves few requests at once well, so a page
 * that asks for one thing at a time is ready sooner than one that asks for
 * twenty together.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { op } from '../../lib/api.ts';
import type { OpName, Params } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import { useUi } from '../../lib/store.tsx';
import { formatMoney } from '../../lib/money.ts';
import type { MoneyFormat } from '../../lib/money.ts';

const early = new Map<string, Promise<unknown>>();

/** One request per key while it is in flight, shared by every view that asks meanwhile. */
function shared<T>(key: string, start: () => Promise<T>): Promise<T> {
  const got = early.get(key);
  if (got !== undefined) return got as Promise<T>;
  const p = start();
  early.set(key, p);
  const drop = (): void => {
    if (early.get(key) === p) early.delete(key);
  };
  p.then(drop, drop);
  return p;
}

/**
 * A live read of the page's combined operation, sent while the page renders
 * (not after its first paint). The page paints at once from the last answer
 * it remembers; `answered` turns true when this visit's read is in, which is
 * when the modules' parts may start theirs (they would only slow it down).
 */
export function usePageOp<T>(name: OpName, params: Params, reads: string[], memory: string): Live<T> & { answered: boolean } {
  const key = name + ':' + JSON.stringify(params);
  const first = useRef<Promise<unknown> | null>(null);
  if (first.current === null) first.current = shared(key, () => op<T>(name, params, { quiet: true }));
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    let on = true;
    const done = (): void => {
      if (on) setAnswered(true);
    };
    first.current?.then(done, done);
    return () => {
      on = false;
    };
  }, []);
  const live = useLive<T>(
    () => shared(key, () => op<T>(name, JSON.parse(key.slice(name.length + 1)) as Params, { quiet: true })),
    reads,
    [key],
    { name: memory },
  );
  return { ...live, answered };
}

/**
 * Mount `children` once `ready`, `wait` ms later, and (with `lazy`) only
 * when the place comes within 200 px of the viewport. Until then an empty
 * block of `min` px holds the place (no skeleton: nothing is loading yet).
 */
export function Later({ ready, wait = 0, lazy, min = 0, className, children }: { ready: boolean; wait?: number | undefined; lazy?: boolean | undefined; min?: number | undefined; className?: string | undefined; children: ReactNode }): React.JSX.Element {
  const [timeUp, setTimeUp] = useState(false);
  const [seen, setSeen] = useState(lazy !== true);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ready || timeUp) return;
    const h = setTimeout(() => setTimeUp(true), wait);
    return () => clearTimeout(h);
  }, [ready, wait, timeUp]);
  useEffect(() => {
    if (seen || ref.current === null) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setSeen(true);
    }, { rootMargin: '200px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  const on = ready && timeUp && seen;
  return (
    <div ref={ref} className={on ? (className ?? '') + ' empty:hidden' : className} style={!on && min > 0 ? { minHeight: min } : undefined}>
      {on ? children : null}
    </div>
  );
}

/** Money as text for charts and bars, blank while Hide pay is on (the figures, not the shapes, are private). */
export function useMoneyText(): (minor: number, currency: string, f?: MoneyFormat) => string {
  const { hidePay } = useUi();
  return (minor, currency, f) => (hidePay ? '' : formatMoney(minor, currency, f));
}

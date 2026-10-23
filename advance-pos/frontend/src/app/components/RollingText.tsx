/**
 * One line of text, centered. A text too long for its box rolls through it
 * in a loop: a short hold, the whole text passes, and its next copy arrives
 * where the first began. With reduced motion it is cut with an ellipsis.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../kit/index.ts';

/** Pixels a second, and the space between the end of the text and its next pass. */
const SPEED = 30;
const GAP = 28;

export function RollingText({ text, className, textClassName }: { text: string; className?: string | undefined; textClassName?: string | undefined }): React.JSX.Element {
  const box = useRef<HTMLSpanElement | null>(null);
  const first = useRef<HTMLSpanElement | null>(null);
  // The text's own width while it does not fit (it rolls); 0 while it fits.
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    const t = first.current;
    if (el === null || t === null) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const measure = (): void => {
      const w = t.offsetWidth;
      setWidth(!still.matches && w > el.clientWidth + 1 ? w : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    still.addEventListener('change', measure);
    // The app's font arrives after the first paint and changes every width.
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      ro.disconnect();
      still.removeEventListener('change', measure);
    };
  }, [text]);

  const rolling = width > 0;
  const style = rolling ? ({ '--ps-roll-by': `-${width + GAP}px`, animationDuration: `${Math.max(6, (width + GAP) / SPEED)}s` } as React.CSSProperties) : undefined;
  return (
    <span ref={box} className={cn('block min-w-0 overflow-hidden whitespace-nowrap', rolling ? 'text-left' : 'text-ellipsis text-center', className)}>
      <span className={cn(rolling && 'ps-roll inline-block')} style={style}>
        <span ref={first} className={textClassName}>
          {text}
        </span>
        {rolling && (
          <span aria-hidden className={textClassName} style={{ paddingLeft: GAP }}>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}

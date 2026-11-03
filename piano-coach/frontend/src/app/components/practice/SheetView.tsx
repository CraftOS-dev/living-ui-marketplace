/**
 * The engraved score sliding past a fixed cursor. Notes turn the hand's
 * colour when played right and red when missed; bars outside the practice
 * range are dimmed.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ST_HIT, ST_MISS } from '../../music/engine.ts';
import type { Engine } from '../../music/engine.ts';
import { renderSheet, xAt } from '../../music/sheet.ts';
import type { SheetLayout } from '../../music/sheet.ts';
import type { Model } from '../../lib/types.ts';
import type { ChordSpan } from '../../music/harmony.ts';
import { Spinner } from '../ui.tsx';

export interface SheetHandle {
  update: (now: number) => void;
}

export const SheetView = forwardRef<SheetHandle, { model: Model; engine: Engine | null; chords?: ChordSpan[] | null; pedal?: boolean }>(function SheetView({ model, engine, chords = null, pedal = false }, ref) {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const layout = useRef<SheetLayout | null>(null);
  const applied = useRef<Int8Array | null>(null);
  const range = useRef('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const el = inner.current;
    if (el === null) return;
    setReady(false);
    renderSheet(el, model, { chords, pedal })
      .then((l) => {
        if (!alive) return;
        layout.current = l;
        applied.current = new Int8Array(model.notes.length).fill(-1);
        range.current = '';
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [model, chords, pedal]);

  useImperativeHandle(ref, () => ({
    update() {
      const l = layout.current;
      const box = outer.current;
      const el = inner.current;
      if (l === null || box === null || el === null || engine === null) return;
      const h = box.clientHeight;
      const scale = Math.max(0.7, Math.min(1.35, (h - 24) / l.height, box.clientWidth / 640));
      const cursorX = box.clientWidth * 0.3;
      const x = xAt(l, engine.pos) * scale;
      el.style.transform = `translate3d(${(cursorX - x).toFixed(1)}px, ${Math.max(0, (h - l.height * scale) / 2).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      // Dim what is outside the practice range (once per range).
      const key = `${engine.q0}|${engine.q1}|${engine.cfg.hands}`;
      if (key !== range.current) {
        range.current = key;
        const inRange = new Set(engine.inRange);
        l.noteEls.forEach((n, i) => {
          if (n === null) return;
          const note = model.notes[i];
          const dim = !inRange.has(i) || (note !== undefined && !engine.judges(note[3]) && engine.cfg.mode !== 'listen');
          n.classList.toggle('is-dim', dim);
        });
        applied.current?.fill(-1);
      }
      const ap = applied.current;
      if (ap === null) return;
      for (const i of engine.inRange) {
        const s = engine.status[i] ?? 0;
        if (ap[i] === s) continue;
        ap[i] = s;
        const n = l.noteEls[i];
        if (n === null || n === undefined) continue;
        const hand = model.notes[i]?.[3] ?? 0;
        n.classList.toggle('is-hit-r', s === ST_HIT && hand === 0);
        n.classList.toggle('is-hit-l', s === ST_HIT && hand === 1);
        n.classList.toggle('is-miss', s === ST_MISS);
      }
    },
  }));

  return (
    <div ref={outer} className="pc-sheet-ink relative h-full w-full overflow-hidden">
      <div ref={inner} className="absolute left-0 top-0 origin-top-left will-change-transform" />
      <div aria-hidden className="pointer-events-none absolute bottom-6 top-6 w-[2px] rounded-full bg-[var(--pc-rh)] opacity-70" style={{ left: '30%', boxShadow: '0 0 12px var(--pc-rh)' }} />
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--pc-muted)]">
          <Spinner size={18} />
        </div>
      )}
      {failed && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--pc-muted)]">The sheet music could not be drawn; the falling notes still work.</div>}
    </div>
  );
});

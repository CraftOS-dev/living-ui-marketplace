/**
 * The engraved melody with its words, sliding past a fixed cursor, in the key
 * and clef the singer sings it. Notes turn voice blue when sung on pitch (or
 * close) and red when off or missed; the note being sung now is darker.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Engine } from '../../music/engine.ts';
import { ST_CLOSE, ST_MISSED, ST_OFF, ST_ON } from '../../music/judge.ts';
import { renderSheet, xAt } from '../../music/sheet.ts';
import type { SheetLayout } from '../../music/sheet.ts';
import { lyricMap, melodyModel } from '../../music/transpose.ts';
import type { Model } from '../../lib/types.ts';
import { Spinner } from '../ui.tsx';

export interface SheetHandle {
  update: () => void;
}

export const SheetView = forwardRef<SheetHandle, { model: Model; shift: number; clef: 'treble' | 'treble8' | 'bass'; verse: number; engine: Engine | null; marks: boolean; words: boolean }>(function SheetView({ model, shift, clef, verse, engine, marks, words }, ref) {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const layout = useRef<SheetLayout | null>(null);
  const applied = useRef<Int8Array | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const sub = useMemo(() => melodyModel(model, shift, clef), [model, shift, clef]);
  // Melody note → engraved note (first sub-model note starting with it).
  const map = useMemo(() => {
    const out: number[] = [];
    const notes = sub.notes;
    (model.melody ?? []).forEach((m, i) => {
      out[i] = notes.findIndex((n) => Math.abs(n[0] - m[0]) < 1e-4);
    });
    return out;
  }, [model, sub]);

  useEffect(() => {
    let alive = true;
    const el = inner.current;
    if (el === null) return;
    setReady(false);
    const chords = (sub.chords ?? []).map(([t, sym], i, all) => ({ t, d: (all[i + 1]?.[0] ?? sub.total) - t, sym }));
    renderSheet(el, sub, { chords, lyrics: words ? lyricMap(model, verse) : undefined })
      .then((l) => {
        if (!alive) return;
        layout.current = l;
        applied.current = new Int8Array((model.melody ?? []).length).fill(-1);
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [sub, model, verse, words]);

  useImperativeHandle(ref, () => ({
    update() {
      const l = layout.current;
      const box = outer.current;
      const el = inner.current;
      if (l === null || box === null || el === null || engine === null) return;
      const h = box.clientHeight;
      const scale = Math.max(0.75, Math.min(1.4, (h - 20) / l.height, box.clientWidth / 600));
      const cursorX = box.clientWidth * 0.28;
      const x = xAt(l, engine.pos) * scale;
      el.style.transform = `translate3d(${(cursorX - x).toFixed(1)}px, ${Math.max(0, (h - l.height * scale) / 2).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      const ap = applied.current;
      if (ap === null) return;
      engine.notes.forEach((n, k) => {
        const r = engine.judged[k] ?? null;
        const cur = engine.current === n;
        const s = cur && r === null ? 9 : r === null || !marks ? 0 : r.status === ST_ON || r.status === ST_CLOSE ? 1 : r.status === ST_OFF || r.status === ST_MISSED ? 2 : 0;
        if (ap[n.i] === s) return;
        ap[n.i] = s;
        const j = map[n.i] ?? -1;
        const elN = j >= 0 ? l.noteEls[j] : null;
        if (elN === null || elN === undefined) return;
        elN.classList.toggle('is-on', s === 1);
        elN.classList.toggle('is-miss', s === 2);
        elN.classList.toggle('is-now', s === 9);
      });
    },
  }));

  return (
    <div ref={outer} className="sc-sheet-ink relative h-full w-full overflow-hidden">
      <div ref={inner} className="absolute left-0 top-0 origin-top-left will-change-transform" />
      <div aria-hidden className="pointer-events-none absolute bottom-6 top-6 w-px bg-[var(--sc-ink)] opacity-70" style={{ left: '28%' }} />
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--sc-muted)]">
          <Spinner size={18} />
        </div>
      )}
      {failed && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--sc-muted)]">The sheet music could not be drawn; the lane still works.</div>}
    </div>
  );
});

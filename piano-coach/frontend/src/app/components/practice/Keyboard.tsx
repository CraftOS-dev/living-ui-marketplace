/**
 * The keys under the falling notes, in the same geometry. Pressed keys go
 * down; the keys to play next show a dot in the hand's colour (with the
 * finger number); a right note lights up and rings, a wrong one flashes
 * red. Mouse and touch play them.
 *
 * Updated straight from the animation frame (update()), not through React,
 * so playing never re-renders the page.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { noteName } from '../../lib/format.ts';
import type { Layout } from '../../music/keys.ts';
import { input } from '../../music/input.ts';

export interface KeyboardHandle {
  update: (now: number, cues: Map<number, [number, number]>, wrongs: Map<number, number>) => void;
  hit: (midi: number, hand: number) => void;
}

interface Props {
  layout: Layout;
  names: boolean;
  computerKeys: boolean;
  height?: number;
}

export const Keyboard = forwardRef<KeyboardHandle, Props>(function Keyboard({ layout, names, computerKeys, height = 132 }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<number, HTMLDivElement>());
  const state = useRef(new Map<number, string>());
  const flash = useRef(new Map<number, { cls: string; until: number }>());
  const pointer = useRef(new Map<number, number>());

  useImperativeHandle(ref, () => ({
    update(now, cues, wrongs) {
      for (const [m, el] of els.current) {
        let cls = '';
        if (input.held.has(m)) cls += ' down';
        const cue = cues.get(m);
        if (cue !== undefined) cls += cue[0] === 1 ? ' cue-l' : ' cue-r';
        const f = flash.current.get(m);
        if (f !== undefined) {
          if (f.until < now) flash.current.delete(m);
          else cls += ' ' + f.cls;
        }
        if ((wrongs.get(m) ?? 0) > now) cls += ' bad';
        const key = cls + '|' + (cue?.[1] ?? 0);
        if (state.current.get(m) !== key) {
          state.current.set(m, key);
          el.classList.toggle('down', cls.includes(' down'));
          el.classList.toggle('cue-r', cls.includes('cue-r'));
          el.classList.toggle('cue-l', cls.includes('cue-l'));
          el.classList.toggle('hit-r', cls.includes('hit-r'));
          el.classList.toggle('hit-l', cls.includes('hit-l'));
          el.classList.toggle('bad', cls.includes(' bad'));
          const dot = el.querySelector<HTMLElement>('.pc-cue');
          if (dot !== null) dot.textContent = cue !== undefined && cue[1] > 0 ? String(cue[1]) : '';
        }
      }
    },
    hit(midi, hand) {
      const el = els.current.get(midi);
      if (el === undefined) return;
      flash.current.set(midi, { cls: hand === 1 ? 'hit-l' : 'hit-r', until: performance.now() + 200 });
      const ring = document.createElement('span');
      ring.className = 'pc-ripple';
      ring.style.color = hand === 1 ? 'var(--pc-lh)' : 'var(--pc-rh)';
      el.appendChild(ring);
      window.setTimeout(() => ring.remove(), 560);
    },
  }));

  const keys = useMemo(() => layout.keys, [layout]);

  const press = (midi: number, id: number): void => {
    const prev = pointer.current.get(id);
    if (prev === midi) return;
    if (prev !== undefined) input.screen(prev, false);
    pointer.current.set(id, midi);
    input.screen(midi, true);
  };
  const release = (id: number): void => {
    const prev = pointer.current.get(id);
    if (prev !== undefined) input.screen(prev, false);
    pointer.current.delete(id);
  };
  const keyAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>('[data-midi]');
    return k === null || k === undefined ? null : Number(k.dataset['midi']);
  };

  return (
    <div
      ref={host}
      className="relative w-full select-none border-t border-[var(--pc-line-2)] bg-[var(--pc-key-black)]"
      style={{ height, touchAction: 'none' }}
      onPointerDown={(e) => {
        const m = keyAt(e.clientX, e.clientY);
        if (m === null) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        press(m, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!pointer.current.has(e.pointerId)) return;
        const m = keyAt(e.clientX, e.clientY);
        if (m !== null) press(m, e.pointerId);
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
    >
      {keys.map((k) => {
        const label = !k.black && (names || k.midi % 12 === 0) ? noteName(k.midi, k.midi % 12 === 0) : '';
        const ck = computerKeys ? input.keyFor(k.midi) : '';
        return (
          <div
            key={k.midi}
            data-midi={k.midi}
            ref={(el) => {
              if (el === null) els.current.delete(k.midi);
              else els.current.set(k.midi, el);
            }}
            className={`pc-key ${k.black ? 'black' : 'white'}`}
            style={{ left: `${k.x * 100}%`, width: `${k.w * 100}%` }}
          >
            <span className="pc-cue" />
            {ck !== '' && (
              <span className="pc-mono pointer-events-none absolute left-1/2 -translate-x-1/2 text-[9px] font-semibold" style={{ top: k.black ? 6 : '58%', color: k.black ? '#cfd6da' : 'var(--pc-muted)' }}>
                {ck}
              </span>
            )}
            {label !== '' && (
              <span className="pc-mono pointer-events-none absolute bottom-1.5 left-0 right-0 text-center text-[9px]" style={{ color: k.midi % 12 === 0 ? '#5b666c' : '#8a959b' }}>
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

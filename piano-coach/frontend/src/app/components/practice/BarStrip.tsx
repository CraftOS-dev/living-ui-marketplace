/**
 * The whole song at a glance: every bar as a cell (as wide as it is long),
 * grouped into sections shaded by their stage, the bars being practised
 * bracketed, and the cursor moving through them.
 *
 * Click a section's name to practise it; drag across bars to choose any
 * stretch; double-click for the whole song.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import type { Model, SectionInfo, Stage } from '../../lib/types.ts';

export interface BarStripHandle {
  /** Song position (quarter notes) for the cursor. */
  setPos: (q: number) => void;
}

const FILL: Record<Stage, string> = {
  new: 'var(--pc-panel)',
  learning: 'color-mix(in srgb, var(--pc-ink) 9%, var(--pc-panel))',
  steady: 'color-mix(in srgb, var(--pc-ink) 22%, var(--pc-panel))',
  mastered: 'color-mix(in srgb, var(--pc-ink) 40%, var(--pc-panel))',
};

export const BarStrip = forwardRef<BarStripHandle, { model: Model; sections: SectionInfo[]; from: number; to: number; onRange: (from: number, to: number, loop: boolean) => void; errors?: Map<number, number> | undefined }>(function BarStrip({ model, sections, from, to, onRange, errors }, ref) {
  const cursor = useRef<HTMLDivElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const total = model.total || 1;
  const first = model.bars[0]?.n ?? 0;
  const last = model.bars[model.bars.length - 1]?.n ?? 0;

  useImperativeHandle(ref, () => ({
    setPos(q) {
      if (cursor.current !== null) cursor.current.style.left = `${Math.max(0, Math.min(1, q / total)) * 100}%`;
    },
  }));

  const barAtX = (clientX: number): number => {
    const el = strip.current;
    if (el === null) return first;
    const r = el.getBoundingClientRect();
    const q = ((clientX - r.left) / r.width) * total;
    let pick = model.bars[0];
    for (const b of model.bars) if (b.t <= q + 1e-6) pick = b;
    return pick?.n ?? first;
  };

  const sel = drag !== null ? { from: Math.min(drag.a, drag.b), to: Math.max(drag.a, drag.b) } : { from, to };
  const span = (a: number, b: number): { left: number; width: number } => {
    const ba = model.bars.find((x) => x.n === a);
    const bb = model.bars.find((x) => x.n === b);
    const l = (ba?.t ?? 0) / total;
    const r = ((bb?.t ?? 0) + (bb?.len ?? 0)) / total;
    return { left: l * 100, width: (r - l) * 100 };
  };
  const whole = from === first && to === last;
  const selSpan = span(sel.from, sel.to);
  const tick = useMemo(() => Math.max(1, Math.ceil(model.bars.length / 28)), [model.bars.length]);

  return (
    <div className="flex h-[54px] shrink-0 select-none flex-col justify-center gap-1 border-b border-[var(--pc-line)] bg-[var(--pc-panel)] px-4">
      {/* Section names */}
      <div className="relative h-4">
        {sections.map((s) => {
          const sp = span(s.from, s.to);
          const on = !whole && s.from === from && s.to === to;
          return (
            <button
              key={s.i}
              type="button"
              title={`${s.name} · bars ${s.from}–${s.to} · ${s.stage}`}
              onClick={() => (on ? onRange(first, last, false) : onRange(s.from, s.to, true))}
              className={cn('pc-mono absolute top-0 flex h-4 items-center gap-1 truncate rounded-[3px] px-1 text-left text-[10px] font-medium uppercase tracking-[0.06em] transition-colors', on ? 'bg-[var(--pc-ink)] text-[var(--pc-page)]' : 'text-[var(--pc-muted)] hover:bg-[var(--pc-hover)] hover:text-[var(--pc-ink)]')}
              style={{ left: `${sp.left}%`, maxWidth: `${sp.width}%` }}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      {/* Bars */}
      <div
        ref={strip}
        className="relative h-[22px] cursor-pointer"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const n = barAtX(e.clientX);
          setDrag({ a: n, b: n });
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const n = barAtX(e.clientX);
          if (n !== drag.b) setDrag({ a: drag.a, b: n });
        }}
        onPointerUp={() => {
          if (drag === null) return;
          const a = Math.min(drag.a, drag.b);
          const b = Math.max(drag.a, drag.b);
          setDrag(null);
          if (a === b) {
            // One click: the section around that bar.
            const s = sections.find((x) => x.from <= a && x.to >= a);
            if (s !== undefined) onRange(s.from, s.to, true);
          } else onRange(a, b, true);
        }}
        onDoubleClick={() => onRange(first, last, false)}
      >
        {sections.map((s) => {
          const sp = span(s.from, s.to);
          return <div key={s.i} className="absolute bottom-0 top-0 transition-[background-color] duration-500" style={{ left: `${sp.left}%`, width: `${sp.width}%`, background: FILL[s.stage] }} />;
        })}
        {model.bars.map((b, i) => {
          const err = errors?.get(b.n) ?? 0;
          return (
            <div key={i} className="absolute bottom-0 top-0 border-l border-[var(--pc-line)]" style={{ left: `${(b.t / total) * 100}%`, width: `${(b.len / total) * 100}%` }}>
              {err > 0 && <span className="absolute inset-x-[2px] bottom-[2px] h-[3px] rounded-full bg-[var(--pc-bad)]" style={{ opacity: Math.min(1, 0.35 + err * 0.2) }} />}
              {(i % tick === 0 || b.n === first) && <span className="pc-mono pointer-events-none absolute left-1 top-[3px] text-[9px] leading-none text-[var(--pc-muted)]">{b.n}</span>}
            </div>
          );
        })}
        <div className="absolute inset-0 rounded-[2px] border border-[var(--pc-line-2)]" />
        {/* The chosen bars */}
        {!(whole && drag === null) && <div className="pointer-events-none absolute -bottom-[3px] -top-[3px] rounded-[3px] border-[1.5px] border-[var(--pc-ink)] transition-[left,width] duration-200" style={{ left: `${selSpan.left}%`, width: `${selSpan.width}%` }} />}
        <div ref={cursor} className="pointer-events-none absolute -bottom-1 -top-1 w-[2px] -translate-x-1/2 rounded-full bg-[var(--pc-rh)]" style={{ left: '0%' }} />
      </div>
    </div>
  );
});

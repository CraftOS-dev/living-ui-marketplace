/**
 * The board's tools (click to add in view, or drag a tool to where the card
 * should go), the link legend, the minimap and the undo bar after a delete.
 */
import { useEffect, useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { KIND, LINK_LIST } from '../lib/kinds.ts';
import type { Card, Kind, Viewport } from '../lib/types.ts';
import type { Box } from './canvas.tsx';
import { bounds } from './canvas.tsx';

export const DRAG_KIND = 'application/x-research-board-kind';

const TOOLS: Kind[] = ['note', 'link', 'youtube', 'image', 'video', 'doc', 'quote', 'section'];

export function Tools({ onPick }: { onPick: (kind: Kind) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Add to the board">
      {TOOLS.map((k) => {
        const info = KIND[k];
        const Icon = info.icon;
        return (
          <button
            key={k}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_KIND, k);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onPick(k)}
            aria-label={`Add ${info.label.toLowerCase()}`}
            title={`${info.label}${k === 'note' ? ' (N)' : ''}: click, or drag onto the board`}
            className="flex size-8 cursor-grab items-center justify-center rounded-[7px] text-[var(--rb-ink-2)] transition-colors hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)] active:cursor-grabbing"
          >
            <Icon size={17} strokeWidth={1.9} />
          </button>
        );
      })}
    </div>
  );
}

export function Legend({ proposed }: { proposed: boolean }): React.JSX.Element {
  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-[var(--rb-line)] bg-[var(--rb-card)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--rb-ink-2)]">
      {LINK_LIST.map((l) => (
        <span key={l.kind} className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" strokeWidth="2" strokeLinecap="round" style={{ stroke: `var(--rb-link-${l.kind})` }} />
          </svg>
          {l.label.toLowerCase()}
        </span>
      ))}
      {proposed && (
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" strokeWidth="2" strokeDasharray="4 3" style={{ stroke: 'var(--rb-accent)' }} />
          </svg>
          proposed
        </span>
      )}
    </div>
  );
}

/** The whole board in small, with the visible area; click or drag to look elsewhere. */
export function MiniMap({ cards, boxOf, vp, view, onCenter }: { cards: Card[]; boxOf: (c: Card) => Box; vp: Viewport; view: { w: number; h: number }; onCenter: (x: number, y: number) => void }): React.JSX.Element | null {
  const ref = useRef<SVGSVGElement | null>(null);
  const boxes = cards.map(boxOf);
  const content = bounds(boxes);
  if (content === null) return null;
  const visible = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: view.w / vp.zoom, h: view.h / vp.zoom };
  const all = bounds([content, visible]) as Box;
  const pad = Math.max(all.w, all.h) * 0.05;
  const W = 168;
  const H = 108;
  const s = Math.min(W / (all.w + pad * 2), H / (all.h + pad * 2));
  const ox = (W - (all.w + pad * 2) * s) / 2 - (all.x - pad) * s;
  const oy = (H - (all.h + pad * 2) * s) / 2 - (all.y - pad) * s;
  const toWorld = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0) - ox) / s, y: (e.clientY - (r?.top ?? 0) - oy) / s };
  };
  return (
    <svg
      ref={ref}
      width={W}
      height={H}
      className="pointer-events-auto cursor-pointer rounded-[8px] border border-[var(--rb-line)] bg-[var(--rb-card)]"
      aria-label="Minimap"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const p = toWorld(e);
        onCenter(p.x, p.y);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        const p = toWorld(e);
        onCenter(p.x, p.y);
      }}
    >
      {cards.map((c, i) => {
        const b = boxes[i] as Box;
        const section = c.kind === 'section';
        return (
          <rect
            key={c.id}
            x={ox + b.x * s}
            y={oy + b.y * s}
            width={Math.max(1.5, b.w * s)}
            height={Math.max(1.5, b.h * s)}
            rx={section ? 2 : 1}
            fill={section ? 'transparent' : 'var(--rb-muted)'}
            stroke={section ? 'var(--rb-line)' : 'none'}
            opacity={section ? 1 : 0.55}
          />
        );
      })}
      <rect x={ox + visible.x * s} y={oy + visible.y * s} width={visible.w * s} height={visible.h * s} rx={3} fill="none" stroke="var(--rb-ink)" strokeWidth={1.5} />
    </svg>
  );
}

export function UndoBar({ count, onUndo, onDone }: { count: number; onUndo: () => void; onDone: () => void }): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onDone, 8000);
    return () => clearTimeout(t);
  }, [onDone, count]);
  return (
    <div className="rb-pop pointer-events-auto flex items-center gap-1 rounded-[8px] bg-[var(--rb-ink)] py-1 pl-3.5 pr-1 text-[var(--rb-card)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
      <span className="pr-2 text-[13px] font-semibold">{count === 1 ? 'Card deleted' : `${count} cards deleted`}</span>
      <button type="button" onClick={onUndo} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-bold hover:bg-white/15">
        <RotateCcw size={13} strokeWidth={2.4} /> Undo
      </button>
      <button type="button" onClick={onDone} aria-label="Dismiss" className="flex size-7 items-center justify-center rounded-[6px] hover:bg-white/15">
        <X size={14} />
      </button>
    </div>
  );
}

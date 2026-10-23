/**
 * One page of the reader: the picture pdf.js draws, the app's stored text
 * layer over it (transparent, selectable; each span knows its offset in the
 * page text), and the marks drawn from stored rectangles: highlights,
 * underlines, comments, area boxes, your AI agent's proposed evidence
 * (dashed) and confirmed evidence, and find hits.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import type { Annotation, Item, PageData, Rect } from '../../lib/types.ts';
import { hueOfSlot } from '../paper.tsx';
import { Skeleton } from '../ui.tsx';
import { itemOffsets, stretchOf } from './geometry.ts';
import { drawPage } from './pdf.ts';
import type { PDFDocumentProxy } from './pdf.ts';

export interface EvidenceMark {
  key: string;
  node: string;
  status: string;
  kind: string;
  title: string;
  rects: Rect[];
}

export type Tool = 'select' | 'highlight' | 'underline' | 'note' | 'area';

export const PageView = memo(function PageView({
  pageNo,
  width,
  height,
  data,
  doc,
  scale,
  near,
  marks,
  evidence,
  hits,
  activeHit,
  flash,
  tool,
  onArea,
  onMarkClick,
  onEvidenceClick,
  onFirstDraw,
}: {
  pageNo: number;
  width: number;
  height: number;
  data: PageData | undefined;
  doc: PDFDocumentProxy | null;
  scale: number;
  near: boolean;
  marks: Annotation[];
  evidence: EvidenceMark[];
  hits: Rect[][];
  activeHit: number;
  flash: string;
  tool: Tool;
  onArea: (page: number, box: [number, number, number, number]) => void;
  onMarkClick: (a: Annotation, x: number, y: number) => void;
  onEvidenceClick: (e: EvidenceMark, x: number, y: number) => void;
  onFirstDraw?: (canvas: HTMLCanvasElement) => void;
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const w = width * scale;
  const h = height * scale;

  useEffect(() => {
    if (!near || doc === null || canvas.current === null) return;
    let cancel: (() => void) | null = null;
    let gone = false;
    setDrawn(false);
    void doc.getPage(pageNo).then((page) => {
      if (gone || canvas.current === null) return;
      cancel = drawPage(page, canvas.current, scale, () => {
        setDrawn(true);
        if (onFirstDraw && canvas.current) onFirstDraw(canvas.current);
      });
    });
    return () => {
      gone = true;
      cancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, doc, pageNo, scale]);

  return (
    <div data-page={pageNo} className="ro-page" style={{ width: w, height: h }}>
      {near && <canvas ref={canvas} aria-hidden />}
      {near && !drawn && <Skeleton className="absolute inset-4 h-auto opacity-60" />}
      {near && <Marks marks={marks} evidence={evidence} hits={hits} activeHit={activeHit} scale={scale} flash={flash} onMarkClick={onMarkClick} onEvidenceClick={onEvidenceClick} />}
      {near && data !== undefined && <TextLayer items={data.items} scale={scale} tool={tool} />}
      {near && data !== undefined && data.origin === 'none' && (
        <div className="pointer-events-none absolute inset-x-6 top-6 z-[3] rounded-[var(--ro-r)] bg-[var(--ro-ink)]/80 px-3 py-2 text-center text-[12px] font-semibold text-[var(--ro-shell)]">Scanned page: its text arrives when your AI agent reads it</div>
      )}
      {near && tool === 'area' && <AreaTool pageNo={pageNo} scale={scale} onArea={onArea} />}
      <span className="pointer-events-none absolute -bottom-5 right-0 text-[12px] text-[var(--ro-muted)]">{pageNo}</span>
    </div>
  );
});

/** The stored text layer: one transparent span per item, stretched to the glyphs pdf.js drew. */
const TextLayer = memo(function TextLayer({ items, scale, tool }: { items: Item[]; scale: number; tool: Tool }): React.JSX.Element {
  const prepared = useMemo(() => {
    const starts = itemOffsets(items);
    return items.map((it, i) => ({ it, start: starts[i] as number, sx: it[0].length > 0 ? stretchOf(it) : 1 }));
  }, [items]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const layer = ref.current;
    if (layer === null) return;
    return trackLayer(layer);
  }, []);
  return (
    <div ref={ref} className={cn('ro-textlayer', tool === 'area' && 'ro-tool-area')} data-textlayer>
      {prepared.map(({ it, start, sx }, i) =>
        it[0].length === 0 ? (
          it[6] ? <br key={i} /> : null
        ) : (
          <span key={i} data-o={start} style={{ left: it[1] * scale, top: it[2] * scale, fontSize: it[3] * scale, fontFamily: 'sans-serif', transform: `${it[5] !== 0 ? `rotate(${it[5]}rad) ` : ''}scaleX(${sx})` }}>
            {it[0]}
            {it[6] ? '\n' : ''}
          </span>
        ),
      )}
    </div>
  );
});

function Marks({ marks, evidence, hits, activeHit, scale, flash, onMarkClick, onEvidenceClick }: { marks: Annotation[]; evidence: EvidenceMark[]; hits: Rect[][]; activeHit: number; scale: number; flash: string; onMarkClick: (a: Annotation, x: number, y: number) => void; onEvidenceClick: (e: EvidenceMark, x: number, y: number) => void }): React.JSX.Element {
  return (
    <div className="ro-marks">
      {hits.map((rects, hi) =>
        rects.map((r, i) => (
          <span key={'h' + hi + '-' + i} className={cn('pointer-events-none absolute rounded-[2px]', hi === activeHit ? 'bg-[rgb(255_150_0/0.55)] outline outline-2 outline-[rgb(255_120_0)]' : 'bg-[rgb(255_200_0/0.4)]')} style={{ left: r[0] * scale - 1, top: r[1] * scale - 1, width: r[2] * scale + 2, height: r[3] * scale + 2 }} />
        )),
      )}
      {marks.map((a) => {
        const hue = hueOfSlot(a.color_slot);
        const rects = a.anchor?.rects ?? [];
        const first = rects[0];
        return (
          <span key={a.id}>
            {rects.map((r, i) => {
              const style = { left: r[0] * scale, top: r[1] * scale, width: r[2] * scale, height: r[3] * scale } as React.CSSProperties;
              if (a.kind === 'area') {
                return <span key={i} data-mark={a.id} onClick={(e) => onMarkClick(a, e.clientX, e.clientY)} className={cn('rounded-[2px] border-2', flash === a.id && 'animate-pulse')} style={{ ...style, borderColor: `var(--ro-hl-${hue}-line)`, background: `var(--ro-hl-${hue}-fill)`, mixBlendMode: 'normal', opacity: 0.85 }} />;
              }
              if (a.kind === 'underline') {
                return <span key={i} data-mark={a.id} onClick={(e) => onMarkClick(a, e.clientX, e.clientY)} style={{ ...style, top: (r[1] + r[3]) * scale - 2, height: 3, background: `var(--ro-hl-${hue}-line)` }} className={cn(flash === a.id && 'animate-pulse')} />;
              }
              return <span key={i} data-mark={a.id} onClick={(e) => onMarkClick(a, e.clientX, e.clientY)} className={cn('rounded-[2px]', flash === a.id && 'animate-pulse')} style={{ ...style, background: `var(--ro-hl-${hue}-fill)` }} />;
            })}
            {a.comment !== '' && first !== undefined && (
              <span data-mark={a.id} onClick={(e) => onMarkClick(a, e.clientX, e.clientY)} className="flex items-center justify-center rounded-[3px] text-[var(--ro-shell)] shadow-sm" style={{ left: Math.max(0, first[0] * scale - 18), top: first[1] * scale, width: 15, height: 15, background: `var(--ro-hl-${hue}-line)`, mixBlendMode: 'normal' }} title={a.comment}>
                <MessageSquare size={10} />
              </span>
            )}
          </span>
        );
      })}
      {evidence.map((ev) =>
        ev.rects.map((r, i) => (
          <span
            key={ev.key + i}
            data-mark={ev.key}
            title={ev.title}
            onClick={(e) => onEvidenceClick(ev, e.clientX, e.clientY)}
            className={cn('rounded-[2px]', flash === ev.key && 'animate-pulse')}
            style={{
              left: r[0] * scale - 1,
              top: r[1] * scale - 1,
              width: r[2] * scale + 2,
              height: r[3] * scale + 2,
              mixBlendMode: 'normal',
              border: ev.status === 'agent_proposed' ? '1.5px dashed var(--ro-accent)' : '0',
              borderBottom: ev.status === 'agent_proposed' ? '1.5px dashed var(--ro-accent)' : `2px solid var(--ro-kind-${ev.kind})`,
              background: ev.status === 'agent_proposed' ? 'color-mix(in srgb, var(--ro-accent) 10%, transparent)' : 'transparent',
            }}
          />
        )),
      )}
    </div>
  );
}

/** Drag a box over a figure or table to mark it. */
function AreaTool({ pageNo, scale, onArea }: { pageNo: number; scale: number; onArea: (page: number, box: [number, number, number, number]) => void }): React.JSX.Element {
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (ref.current as HTMLDivElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[4] cursor-crosshair"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = at(e);
        setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (box === null) return;
        const p = at(e);
        setBox({ ...box, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (box === null) return;
        const x = Math.min(box.x0, box.x1);
        const y = Math.min(box.y0, box.y1);
        const w = Math.abs(box.x1 - box.x0);
        const hh = Math.abs(box.y1 - box.y0);
        setBox(null);
        if (w > 8 && hh > 8) onArea(pageNo, [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(w * 100) / 100, Math.round(hh * 100) / 100]);
      }}
    >
      {box !== null && <span className="absolute border-2 border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent)]/10" style={{ left: Math.min(box.x0, box.x1) * scale, top: Math.min(box.y0, box.y1) * scale, width: Math.abs(box.x1 - box.x0) * scale, height: Math.abs(box.y1 - box.y0) * scale }} />}
    </div>
  );
}

/*
 * pdf.js's end-of-content block. While you drag, an empty block covering the
 * page sits right after the span the selection ends in, so dragging over
 * blank space keeps the end where it is instead of jumping to whichever span
 * comes next in the page's order (a footnote, the next column).
 */
const layers = new Map<HTMLElement, HTMLElement>();
let prevRange: Range | null = null;
let pointerDown = false;
let listening = false;

function resetLayer(layer: HTMLElement, end: HTMLElement): void {
  if (end.parentElement !== layer || end !== layer.lastChild) layer.append(end);
  layer.classList.remove('ro-selecting');
}

function resetAll(): void {
  pointerDown = false;
  prevRange = null;
  for (const [l, e] of layers) resetLayer(l, e);
}

function onSelectionChange(): void {
  const sel = document.getSelection();
  if (sel === null || sel.rangeCount === 0) {
    for (const [l, e] of layers) resetLayer(l, e);
    prevRange = null;
    return;
  }
  const range = sel.getRangeAt(0);
  for (const [l, e] of layers) {
    if (range.intersectsNode(l)) l.classList.add('ro-selecting');
    else resetLayer(l, e);
  }
  if (!pointerDown) return;
  const modifyStart = prevRange !== null && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor !== null && anchor.previousSibling === null) anchor = anchor.parentNode;
      anchor = anchor?.previousSibling ?? null;
    } while (anchor !== null && anchor.childNodes.length === 0);
  }
  const el = anchor instanceof HTMLElement ? anchor : null;
  const layer = el?.parentElement?.closest<HTMLElement>('[data-textlayer]') ?? null;
  const end = layer !== null ? layers.get(layer) : undefined;
  if (el !== null && end !== undefined && el !== end && el.parentElement !== null) el.parentElement.insertBefore(end, modifyStart ? el : el.nextSibling);
  prevRange = range.cloneRange();
}

function trackLayer(layer: HTMLElement): () => void {
  if (!listening) {
    listening = true;
    document.addEventListener('pointerdown', () => (pointerDown = true), true);
    document.addEventListener('pointerup', resetAll, true);
    window.addEventListener('blur', resetAll);
    document.addEventListener('selectionchange', onSelectionChange);
  }
  const end = document.createElement('div');
  end.className = 'ro-endofcontent';
  layer.append(end);
  layers.set(layer, end);
  return () => {
    layers.delete(layer);
    end.remove();
  };
}

/**
 * The offsets of the current selection inside one page's stored text, or
 * null. A selection running onto another page ends at the end of the first.
 */
export function selectionOffsets(): { page: number; start: number; end: number; rect: DOMRect; text: string } | null {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const pos = (node: Node, offset: number, isEnd: boolean): { page: number; off: number } | null => {
    let el: Element | null = null;
    let local = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      el = node.parentElement;
      local = offset;
    } else if ((node as Element).hasAttribute('data-o')) {
      el = node as Element;
      local = offset === 0 ? 0 : Infinity;
    } else {
      // A point between children (of the layer, or at the end-of-content
      // block): the nearest span on the inside of the selection.
      const e = node as Element;
      let c: Node | null = e.hasAttribute('data-textlayer') ? ((isEnd ? e.childNodes[offset - 1] : e.childNodes[offset]) ?? null) : isEnd ? e.previousSibling : e.nextSibling;
      while (c !== null && !(c instanceof Element && c.hasAttribute('data-o'))) c = isEnd ? c.previousSibling : c.nextSibling;
      if (c === null) return null;
      el = c as Element;
      local = isEnd ? Infinity : 0;
    }
    while (el !== null && !el.hasAttribute('data-o')) el = el.parentElement;
    if (el === null) return null;
    const pageEl = el.closest('[data-page]');
    if (pageEl === null) return null;
    const textLen = (el.textContent ?? '').replace(/\n$/, '').length;
    return { page: Number(pageEl.getAttribute('data-page')), off: Number(el.getAttribute('data-o')) + Math.min(local, textLen) };
  };
  const a = pos(range.startContainer, range.startOffset, false);
  let b = pos(range.endContainer, range.endOffset, true);
  if (a === null) return null;
  if (b === null || b.page !== a.page) {
    const layer = document.querySelector(`[data-page="${a.page}"] [data-textlayer]`);
    const last = layer ? Array.from(layer.querySelectorAll('[data-o]')).pop() : undefined;
    b = last ? { page: a.page, off: Number(last.getAttribute('data-o')) + (last.textContent ?? '').replace(/\n$/, '').length } : null;
  }
  if (b === null || b.off <= a.off) return null;
  return { page: a.page, start: a.off, end: b.off, rect: range.getBoundingClientRect(), text: sel.toString() };
}

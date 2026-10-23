/**
 * The canvas both the claims map and boards stand on: a dotted stage that
 * pans when you drag empty space, zooms around the pointer with the wheel
 * (or a pinch), and fits its content. World coordinates are what the server
 * stores; screen = world * zoom + offset.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from '../ui.tsx';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN = 0.15;
const MAX = 2.5;

export function bounds(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function useCanvas(initial?: Viewport | null): {
  ref: React.RefObject<HTMLDivElement | null>;
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  fit: (b: Box | null, maxZoom?: number) => void;
  zoomBy: (f: number) => void;
  centerOn: (x: number, y: number) => void;
  panning: boolean;
  onBackgroundPointerDown: (e: React.PointerEvent) => boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState<Viewport>(initial ?? { x: 40, y: 40, zoom: 1 });
  const [panning, setPanning] = useState(false);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number; cx: number; cy: number; vx: number; vy: number } | null>(null);

  const zoomAt = useCallback((clientX: number, clientY: number, next: number) => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    setVp((v) => {
      const z = Math.max(MIN, Math.min(MAX, next));
      const wx = (px - v.x) / v.zoom;
      const wy = (py - v.y) / v.zoom;
      return { zoom: z, x: px - wx * z, y: py - wy * z };
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return;
      e.preventDefault();
      // The wheel zooms, as in Miro: a notch is about 15%. Lines and pages count as pixels, and one event never jumps far.
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      zoomAt(e.clientX, e.clientY, vpRef.current.zoom * Math.exp(-Math.max(-150, Math.min(150, dy)) * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.zoom, y: (clientY - (r?.top ?? 0) - v.y) / v.zoom };
  }, []);

  const fit = useCallback((b: Box | null, maxZoom = 1) => {
    const el = ref.current;
    if (el === null || b === null) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const z = Math.max(MIN, Math.min(maxZoom, Math.min((W - 80) / Math.max(1, b.w), (H - 80) / Math.max(1, b.h))));
    setVp({ zoom: z, x: (W - b.w * z) / 2 - b.x * z, y: (H - b.h * z) / 2 - b.y * z });
  }, []);

  const zoomBy = useCallback(
    (f: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, vpRef.current.zoom * f);
    },
    [zoomAt],
  );

  const centerOn = useCallback((x: number, y: number) => {
    const el = ref.current;
    if (el === null) return;
    setVp((v) => ({ ...v, x: el.clientWidth / 2 - x * v.zoom, y: el.clientHeight / 2 - y * v.zoom }));
  }, []);

  /** Start panning (or pinching) from empty space; returns true when it took the event. */
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent): boolean => {
      if (e.button !== 0 && e.button !== 1) return false;
      const el = ref.current;
      if (el === null) return false;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
      let moved = false;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: vpRef.current.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: vpRef.current.x, vy: vpRef.current.y };
      }
      const onMove = (ev: PointerEvent): void => {
        if (!pointers.current.has(ev.pointerId)) return;
        pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch.current !== null && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt(pinch.current.cx, pinch.current.cy, (pinch.current.zoom * d) / Math.max(1, pinch.current.d));
          return;
        }
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
        moved = true;
        setPanning(true);
        setVp((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
      };
      const onUp = (ev: PointerEvent): void => {
        pointers.current.delete(ev.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) {
          setPanning(false);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return true;
    },
    [zoomAt],
  );

  return { ref, vp, setVp, toWorld, fit, zoomBy, centerOn, panning, onBackgroundPointerDown };
}

/** The dot grid's spacing: it follows the zoom but never closes up into noise. */
export function gridStyle(vp: Viewport): React.CSSProperties {
  let size = 22 * vp.zoom;
  while (size < 14) size *= 2;
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${vp.x}px ${vp.y}px` };
}

/** Whether any of the boxes shows in a view of the given size. */
export function anyVisible(boxes: Box[], vp: Viewport, w: number, h: number): boolean {
  return boxes.some((b) => b.x * vp.zoom + vp.x < w && (b.x + b.w) * vp.zoom + vp.x > 0 && b.y * vp.zoom + vp.y < h && (b.y + b.h) * vp.zoom + vp.y > 0);
}

/** Zoom out, the zoom level (click to fit), zoom in. */
export function ZoomControls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (f: number) => void; onFit: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-0.5 shadow-[var(--ro-shadow-sm)]">
      <IconButton icon={Minus} label="Zoom out" size={26} onClick={() => onZoom(1 / 1.2)} />
      <button type="button" onClick={onFit} title="Fit everything (F)" className="num h-[26px] w-12 rounded-[var(--ro-r-sm)] text-[12px] font-semibold hover:bg-[var(--ro-row)]">
        {Math.round(zoom * 100)}%
      </button>
      <IconButton icon={Plus} label="Zoom in" size={26} onClick={() => onZoom(1.2)} />
      <IconButton icon={Maximize} label="Fit everything (F)" size={26} onClick={onFit} />
    </div>
  );
}

/** A smooth link between two boxes, leaving each from the side facing the other. */
export function linkPath(a: Box, b: Box): { d: string; mid: { x: number; y: number } } {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  // Cards stacked in one column: go round the left side so the link does not pass behind the cards between them.
  if (Math.abs(a.x - b.x) < 12 && Math.abs(dy) > (a.h + b.h) / 2 + 110) {
    const p0 = { x: a.x, y: ac.y };
    const p1 = { x: b.x, y: bc.y };
    const k = 34 + Math.min(80, Math.abs(dy) * 0.12);
    const c0 = { x: p0.x - k, y: p0.y };
    const c1 = { x: p1.x - k, y: p1.y };
    const mid = { x: 0.125 * p0.x + 0.375 * c0.x + 0.375 * c1.x + 0.125 * p1.x, y: (p0.y + p1.y) / 2 };
    return { d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`, mid };
  }
  const vertical = Math.abs(dy) > Math.abs(dx) * 0.6;
  let p0: { x: number; y: number };
  let p1: { x: number; y: number };
  let c0: { x: number; y: number };
  let c1: { x: number; y: number };
  if (vertical) {
    p0 = { x: ac.x, y: dy > 0 ? a.y + a.h : a.y };
    p1 = { x: bc.x, y: dy > 0 ? b.y : b.y + b.h };
    const k = Math.max(30, Math.abs(p1.y - p0.y) * 0.45);
    c0 = { x: p0.x, y: p0.y + (dy > 0 ? k : -k) };
    c1 = { x: p1.x, y: p1.y - (dy > 0 ? k : -k) };
  } else {
    p0 = { x: dx > 0 ? a.x + a.w : a.x, y: ac.y };
    p1 = { x: dx > 0 ? b.x : b.x + b.w, y: bc.y };
    const k = Math.max(30, Math.abs(p1.x - p0.x) * 0.45);
    c0 = { x: p0.x + (dx > 0 ? k : -k), y: p0.y };
    c1 = { x: p1.x - (dx > 0 ? k : -k), y: p1.y };
  }
  const mid = { x: 0.125 * p0.x + 0.375 * c0.x + 0.375 * c1.x + 0.125 * p1.x, y: 0.125 * p0.y + 0.375 * c0.y + 0.375 * c1.y + 0.125 * p1.y };
  return { d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`, mid };
}

/** Arrowheads for the three link kinds and for proposed links. */
export function LinkMarkers(): React.JSX.Element {
  const kinds: [string, string][] = [
    ['supports', 'var(--ro-rel-supports)'],
    ['opposes', 'var(--ro-rel-opposes)'],
    ['informs', 'var(--ro-rel-informs)'],
    ['proposed', 'var(--ro-accent)'],
    ['draft', 'var(--ro-ink-2)'],
  ];
  return (
    <defs>
      {kinds.map(([k, c]) => (
        <marker key={k} id={'ro-arrow-' + k} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: c }} />
        </marker>
      ))}
    </defs>
  );
}

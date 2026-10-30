/**
 * The stage a board stands on (the same model as the Research OS map): a
 * dotted canvas that pans when you drag empty space, zooms around the
 * pointer with the wheel or a pinch, and fits its content. World
 * coordinates are what the server stores; screen = world * zoom + offset.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { LinkKind, Viewport } from '../lib/types.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 2.5;

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

export function inside(b: Box, frame: Box): boolean {
  return b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface Canvas {
  ref: React.RefObject<HTMLDivElement | null>;
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  fit: (b: Box | null, maxZoom?: number, animate?: boolean, padRight?: number) => void;
  zoomBy: (f: number) => void;
  centerOn: (x: number, y: number, zoom?: number) => void;
  center: () => { x: number; y: number };
  panning: boolean;
  gliding: boolean;
  onBackgroundPointerDown: (e: React.PointerEvent) => boolean;
}

export function useCanvas(initial: Viewport | null): Canvas {
  const ref = useRef<HTMLDivElement | null>(null);
  const [vp, setVpRaw] = useState<Viewport>(initial ?? { x: 80, y: 80, zoom: 1 });
  const [panning, setPanning] = useState(false);
  const [gliding, setGliding] = useState(false);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number; cx: number; cy: number } | null>(null);

  const setVp: React.Dispatch<React.SetStateAction<Viewport>> = useCallback((v) => {
    setGliding(false);
    setVpRaw(v);
  }, []);

  /** Move the view with an eased transition (fit, center): the world layer animates its transform. */
  const glideTo = useCallback((next: Viewport) => {
    setGliding(true);
    setVpRaw(next);
    if (glideTimer.current !== null) clearTimeout(glideTimer.current);
    glideTimer.current = setTimeout(() => setGliding(false), 460);
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, next: number) => {
      const el = ref.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      setVp((v) => {
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
        const wx = (px - v.x) / v.zoom;
        const wy = (py - v.y) / v.zoom;
        return { zoom: z, x: px - wx * z, y: py - wy * z };
      });
    },
    [setVp],
  );

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return;
      e.preventDefault();
      // Two-finger scroll on a trackpad pans; the wheel and a pinch (ctrl) zoom.
      const pixel = e.deltaMode === 0;
      if (pixel && !e.ctrlKey && Math.abs(e.deltaX) > 0.5 && Math.abs(e.deltaY) < 50) {
        setVp((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
        return;
      }
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      const k = e.ctrlKey ? 0.01 : 0.0016;
      zoomAt(e.clientX, e.clientY, vpRef.current.zoom * Math.exp(-Math.max(-150, Math.min(150, dy)) * k));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setVp]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.zoom, y: (clientY - (r?.top ?? 0) - v.y) / v.zoom };
  }, []);

  const fit = useCallback(
    (b: Box | null, maxZoom = 1, animate = true, padRight = 0) => {
      const el = ref.current;
      if (el === null || b === null) return;
      // padRight: a panel covers that much of the right edge; fit into what is left.
      const W = Math.max(240, el.clientWidth - padRight);
      const H = el.clientHeight;
      const z = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min((W - 140) / Math.max(1, b.w), (H - 140) / Math.max(1, b.h))));
      const next = { zoom: z, x: (W - b.w * z) / 2 - b.x * z, y: (H - b.h * z) / 2 - b.y * z };
      if (animate) glideTo(next);
      else setVp(next);
    },
    [glideTo, setVp],
  );

  const zoomBy = useCallback(
    (f: number) => {
      const el = ref.current;
      if (el === null) return;
      const v = vpRef.current;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f));
      const px = el.clientWidth / 2;
      const py = el.clientHeight / 2;
      const wx = (px - v.x) / v.zoom;
      const wy = (py - v.y) / v.zoom;
      glideTo({ zoom: z, x: px - wx * z, y: py - wy * z });
    },
    [glideTo],
  );

  const centerOn = useCallback(
    (x: number, y: number, zoom?: number) => {
      const el = ref.current;
      if (el === null) return;
      const z = zoom ?? vpRef.current.zoom;
      glideTo({ zoom: z, x: el.clientWidth / 2 - x * z, y: el.clientHeight / 2 - y * z });
    },
    [glideTo],
  );

  const center = useCallback(() => {
    const el = ref.current;
    const r = el?.getBoundingClientRect();
    return toWorld((r?.left ?? 0) + (el?.clientWidth ?? 800) / 2, (r?.top ?? 0) + (el?.clientHeight ?? 600) / 2);
  }, [toWorld]);

  /** Start panning (or pinching) from empty space; returns true when it took the event. */
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent): boolean => {
      if (e.button !== 0 && e.button !== 1) return false;
      const el = ref.current;
      if (el === null) return false;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const start = { x: e.clientX, y: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
      let moved = false;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: vpRef.current.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
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
    [zoomAt, setVp],
  );

  return { ref, vp, setVp, toWorld, fit, zoomBy, centerOn, center, panning, gliding, onBackgroundPointerDown };
}

/** The dot grid's spacing: it follows the zoom but never closes up into noise. */
export function gridStyle(vp: Viewport): React.CSSProperties {
  let size = 24 * vp.zoom;
  while (size < 14) size *= 2;
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${vp.x}px ${vp.y}px` };
}

/** Whether any of the boxes shows in a view of the given size. */
export function anyVisible(boxes: Box[], vp: Viewport, w: number, h: number): boolean {
  return boxes.some((b) => b.x * vp.zoom + vp.x < w && (b.x + b.w) * vp.zoom + vp.x > 0 && b.y * vp.zoom + vp.y < h && (b.y + b.h) * vp.zoom + vp.y > 0);
}

/** A smooth link between two boxes, leaving each from the side facing the other. */
export function linkPath(a: Box, b: Box): { d: string; mid: { x: number; y: number }; length: number } {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
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
  const length = Math.hypot(c0.x - p0.x, c0.y - p0.y) + Math.hypot(c1.x - c0.x, c1.y - c0.y) + Math.hypot(p1.x - c1.x, p1.y - c1.y);
  return { d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`, mid, length };
}

/** Arrowheads for each link kind, for proposed links and for the link being drawn. */
export function LinkMarkers(): React.JSX.Element {
  const kinds: [string, string][] = [
    ['relates', 'var(--rb-link-relates)'],
    ['supports', 'var(--rb-link-supports)'],
    ['contradicts', 'var(--rb-link-contradicts)'],
    ['leads', 'var(--rb-link-leads)'],
    ['proposed', 'var(--rb-accent)'],
    ['draft', 'var(--rb-ink-2)'],
  ];
  return (
    <defs>
      {kinds.map(([k, c]) => (
        <marker key={k} id={'rb-arrow-' + k} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: c }} />
        </marker>
      ))}
    </defs>
  );
}

export function linkStroke(kind: LinkKind, proposed: boolean): string {
  return proposed ? 'var(--rb-accent)' : `var(--rb-link-${kind})`;
}

/** Zoom out, the zoom level (click to fit), zoom in, fit. */
export function ZoomControls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (f: number) => void; onFit: () => void }): React.JSX.Element {
  const btn = 'flex size-8 items-center justify-center rounded-full text-[var(--rb-ink-2)] transition-colors hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]';
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-[var(--rb-card)] p-1 shadow-[0_10px_30px_-16px_rgba(29,28,26,0.5)] ring-1 ring-[var(--rb-hair)]">
      <button type="button" className={btn} aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(1 / 1.25)}>
        <Minus size={15} />
      </button>
      <button type="button" onClick={onFit} title="Fit everything (F)" className="num h-8 w-14 rounded-full text-[12px] font-bold hover:bg-[var(--rb-row)]">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(1.25)}>
        <Plus size={15} />
      </button>
      <span className="mx-0.5 h-5 w-px bg-[var(--rb-line)]" />
      <button type="button" className={btn} aria-label="Fit everything" title="Fit everything (F)" onClick={onFit}>
        <Maximize size={14} />
      </button>
    </div>
  );
}

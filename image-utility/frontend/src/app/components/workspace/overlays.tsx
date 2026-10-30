/**
 * What tools draw on the stage, in image pixels of the picture shown:
 *
 *  - CropOverlay: the crop box with eight handles, the rule-of-thirds grid
 *    and a shade outside; a ratio keeps its shape; drag outside the box to
 *    draw a new one.
 *  - RegionOverlay: a box to point the AI agent at part of the image.
 *
 * Layers have their own overlay (LayersOverlay.tsx).
 */
import type { Dims, Region } from '../../lib/types.ts';
import type { OverlayApi, View } from './Stage.tsx';

type Pt = [number, number];

function sx(v: View, x: number): number {
  return v.x + x * v.s;
}
function sy(v: View, y: number): number {
  return v.y + y * v.s;
}

/** Track a drag from a pointer press until release (pointer capture on the target). */
function drag(e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void): void {
  e.preventDefault();
  e.stopPropagation();
  // HTML and SVG elements share the pointer events; typed as one for the listeners.
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent): void => onMove(ev);
  const up = (ev: PointerEvent): void => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    onUp(ev);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------- crop */

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** A crop box resized from one handle, kept inside the image and to a ratio when one is set. */
export function resizeRect(start: Region, h: Handle, px: number, py: number, [W, H]: Dims, ratio: number | null): Region {
  let l = start.x;
  let t = start.y;
  let r = start.x + start.w;
  let b = start.y + start.h;
  if (h.includes('w')) l = Math.min(px, r - 1);
  if (h.includes('e')) r = Math.max(px, l + 1);
  if (h.includes('n')) t = Math.min(py, b - 1);
  if (h.includes('s')) b = Math.max(py, t + 1);
  l = Math.max(0, l);
  t = Math.max(0, t);
  r = Math.min(W, r);
  b = Math.min(H, b);
  if (ratio !== null) {
    let w = r - l;
    let hh = b - t;
    if (h.length === 2) {
      // A corner: the opposite corner stays.
      const ax = h.includes('w') ? r : l;
      const ay = h.includes('n') ? b : t;
      if (w / hh > ratio) w = hh * ratio;
      else hh = w / ratio;
      const maxW = h.includes('w') ? ax : W - ax;
      const maxH = h.includes('n') ? ay : H - ay;
      w = Math.min(w, maxW);
      hh = Math.min(hh, maxH);
      if (w / hh > ratio) w = hh * ratio;
      else hh = w / ratio;
      l = h.includes('w') ? ax - w : ax;
      t = h.includes('n') ? ay - hh : ay;
      r = l + w;
      b = t + hh;
    } else if (h === 'e' || h === 'w') {
      const cy = start.y + start.h / 2;
      const maxH = 2 * Math.min(cy, H - cy);
      const maxW = h === 'e' ? W - l : r;
      w = Math.min(w, maxW, maxH * ratio);
      hh = w / ratio;
      if (h === 'e') r = l + w;
      else l = r - w;
      t = cy - hh / 2;
      b = t + hh;
    } else {
      const cx = start.x + start.w / 2;
      const maxW = 2 * Math.min(cx, W - cx);
      const maxH = h === 's' ? H - t : b;
      hh = Math.min(hh, maxH, maxW / ratio);
      w = hh * ratio;
      if (h === 's') b = t + hh;
      else t = b - hh;
      l = cx - w / 2;
      r = l + w;
    }
  }
  const x = Math.max(0, Math.round(l));
  const y = Math.max(0, Math.round(t));
  return { x, y, w: Math.max(1, Math.min(W - x, Math.round(r - l))), h: Math.max(1, Math.min(H - y, Math.round(b - t))) };
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

export function CropOverlay({ o, base, rect, ratio, onChange }: { o: OverlayApi; base: Dims; rect: Region; ratio: number | null; onChange: (r: Region, done: boolean) => void }): React.JSX.Element {
  const v = o.view;
  const [W, H] = base;
  const L = sx(v, rect.x);
  const T = sy(v, rect.y);
  const R = sx(v, rect.x + rect.w);
  const B = sy(v, rect.y + rect.h);
  const IL = sx(v, 0);
  const IT = sy(v, 0);
  const IR = sx(v, W);
  const IB = sy(v, H);

  const at = (h: Handle): Pt => {
    const x = h.includes('w') ? L : h.includes('e') ? R : (L + R) / 2;
    const y = h.includes('n') ? T : h.includes('s') ? B : (T + B) / 2;
    return [x, y];
  };

  const startHandle = (e: React.PointerEvent, h: Handle): void => {
    const start = rect;
    let last = rect;
    drag(
      e,
      (ev) => {
        const [px, py] = o.toImage(ev.clientX, ev.clientY);
        last = resizeRect(start, h, px, py, base, ratio);
        onChange(last, false);
      },
      () => onChange(last, true),
    );
  };

  const startMove = (e: React.PointerEvent): void => {
    const start = rect;
    const [x0, y0] = o.toImage(e.clientX, e.clientY);
    let last = rect;
    drag(
      e,
      (ev) => {
        const [px, py] = o.toImage(ev.clientX, ev.clientY);
        last = { ...start, x: Math.round(Math.min(W - start.w, Math.max(0, start.x + px - x0))), y: Math.round(Math.min(H - start.h, Math.max(0, start.y + py - y0))) };
        onChange(last, false);
      },
      () => onChange(last, true),
    );
  };

  const startNew = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    const [ax, ay] = o.toImage(e.clientX, e.clientY);
    const x0 = Math.min(W, Math.max(0, ax));
    const y0 = Math.min(H, Math.max(0, ay));
    let last: Region | null = null;
    drag(
      e,
      (ev) => {
        const [px, py] = o.toImage(ev.clientX, ev.clientY);
        if (Math.abs(px - x0) * v.s < 4 && Math.abs(py - y0) * v.s < 4) return;
        const h: Handle = ((py < y0 ? 'n' : 's') + (px < x0 ? 'w' : 'e')) as Handle;
        last = resizeRect({ x: x0, y: y0, w: 0, h: 0 }, h, px, py, base, ratio);
        onChange(last, false);
      },
      () => {
        if (last !== null) onChange(last, true);
      },
    );
  };

  const thirds = [1, 2].map((k) => ({ x: L + ((R - L) * k) / 3, y: T + ((B - T) * k) / 3 }));
  return (
    <svg className="absolute inset-0 size-full" style={{ cursor: 'crosshair' }} onPointerDown={startNew}>
      <path d={`M${IL} ${IT}H${IR}V${IB}H${IL}Z M${L} ${T}V${B}H${R}V${T}Z`} fillRule="evenodd" fill="rgba(0,0,0,0.55)" />
      <rect x={L} y={T} width={Math.max(0, R - L)} height={Math.max(0, B - T)} fill="transparent" stroke="#fff" strokeWidth={1} style={{ cursor: 'move' }} onPointerDown={startMove} />
      {thirds.map((t, i) => (
        <g key={i} pointerEvents="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.75}>
          <line x1={t.x} y1={T} x2={t.x} y2={B} />
          <line x1={L} y1={t.y} x2={R} y2={t.y} />
        </g>
      ))}
      {HANDLES.map((h) => {
        const [x, y] = at(h);
        const corner = h.length === 2;
        const w = corner ? 10 : h === 'n' || h === 's' ? 18 : 6;
        const hh = corner ? 10 : h === 'n' || h === 's' ? 6 : 18;
        return (
          <rect
            key={h}
            x={x - w / 2}
            y={y - hh / 2}
            width={w}
            height={hh}
            rx={1.5}
            fill="#fff"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={1}
            style={{ cursor: CURSOR[h] }}
            onPointerDown={(e) => startHandle(e, h)}
          />
        );
      })}
      <g pointerEvents="none">
        <rect x={(L + R) / 2 - 44} y={Math.min(B + 8, o.viewport.h - 70)} width={88} height={20} rx={4} fill="rgba(17,17,17,0.82)" />
        <text x={(L + R) / 2} y={Math.min(B + 8, o.viewport.h - 70) + 14} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff" className="num">
          {rect.w} × {rect.h}
        </text>
      </g>
    </svg>
  );
}

/* ----------------------------------------------------------------- region */

export function RegionOverlay({ o, size, region, onChange }: { o: OverlayApi; size: Dims; region: Region | null; onChange: (r: Region | null) => void }): React.JSX.Element {
  const v = o.view;
  const [W, H] = size;
  const start = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    const [ax, ay] = o.toImage(e.clientX, e.clientY);
    const x0 = Math.min(W, Math.max(0, ax));
    const y0 = Math.min(H, Math.max(0, ay));
    let last: Region | null = null;
    drag(
      e,
      (ev) => {
        const [px0, py0] = o.toImage(ev.clientX, ev.clientY);
        const px = Math.min(W, Math.max(0, px0));
        const py = Math.min(H, Math.max(0, py0));
        last = { x: Math.round(Math.min(x0, px)), y: Math.round(Math.min(y0, py)), w: Math.max(1, Math.round(Math.abs(px - x0))), h: Math.max(1, Math.round(Math.abs(py - y0))) };
        onChange(last);
      },
      () => {
        if (last !== null && last.w * v.s < 6 && last.h * v.s < 6) onChange(null);
      },
    );
  };
  return (
    <svg className="absolute inset-0 size-full" style={{ cursor: 'crosshair' }} onPointerDown={start}>
      {region !== null && (
        <g pointerEvents="none">
          <path
            d={`M${sx(v, 0)} ${sy(v, 0)}H${sx(v, W)}V${sy(v, H)}H${sx(v, 0)}Z M${sx(v, region.x)} ${sy(v, region.y)}V${sy(v, region.y + region.h)}H${sx(v, region.x + region.w)}V${sy(v, region.y)}Z`}
            fillRule="evenodd"
            fill="rgba(0,0,0,0.35)"
          />
          <rect x={sx(v, region.x)} y={sy(v, region.y)} width={region.w * v.s} height={region.h * v.s} fill="none" stroke="#fff" strokeWidth={1.5} />
          <rect className="iu-ants" x={sx(v, region.x)} y={sy(v, region.y)} width={region.w * v.s} height={region.h * v.s} fill="none" stroke="#111" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
}

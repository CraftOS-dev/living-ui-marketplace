/**
 * Sizes through an edit stack, exactly as the engine computes them
 * (engine/img_engine/geom.py; the hooks have the same code in lib_geom.js),
 * so the workspace places crop boxes and marks without asking the engine.
 *
 * Every edit's coordinates are full-resolution pixels of the image as it
 * enters that edit. Only crop, resize and canvas change the size.
 */
import type { Dims, EditKind, Json, Params } from './types.ts';

export function rnd(x: number): number {
  return Math.floor(x + 0.5);
}

function int(v: Json | undefined): number {
  return typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' ? Math.trunc(Number(v)) || 0 : 0;
}

/** '4:3' / '1.5' / 'original' / null -> width/height, or null for free. */
export function ratioOf(r: Json | undefined, w: number, h: number): number | null {
  if (r === null || r === undefined || r === '' || r === 'free') return null;
  if (r === 'original') return h ? w / h : null;
  if (typeof r === 'number') return r > 0 ? r : null;
  const s = String(r);
  if (s.includes(':')) {
    const [a, b] = s.split(':').map(Number);
    return a !== undefined && b !== undefined && a > 0 && b > 0 ? a / b : null;
  }
  const v = Number(s);
  return v > 0 ? v : null;
}

export function straightenScale(w: number, h: number, angle: number): number {
  const t = (Math.abs(angle) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

export function largestOfRatio(w: number, h: number, r: number): Dims {
  if (w / h > r) return [Math.max(1, rnd(h * r)), h];
  return [w, Math.max(1, rnd(w / r))];
}

/** The size after flips, quarter turns and straightening, before the crop box. */
export function cropBase(p: Params, w: number, h: number): Dims {
  const turns = ((int(p['turns']) % 4) + 4) % 4;
  if (turns % 2) [w, h] = [h, w];
  const angle = Number(p['angle'] ?? 0);
  if (Math.abs(angle) > 1e-9) {
    const k = straightenScale(w, h, angle);
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  return [w, h];
}

function cropDims(p: Params, w0: number, h0: number): Dims {
  const [w, h] = cropBase(p, w0, h0);
  const rect = p['rect'];
  if (rect !== null && rect !== undefined && typeof rect === 'object' && !Array.isArray(rect)) {
    let x = int(rect['x']);
    let y = int(rect['y']);
    const rw = rect['w'] === undefined ? w : int(rect['w']);
    const rh = rect['h'] === undefined ? h : int(rect['h']);
    x = Math.min(Math.max(0, x), w - 1);
    y = Math.min(Math.max(0, y), h - 1);
    return [Math.max(1, Math.min(rw, w - x)), Math.max(1, Math.min(rh, h - y))];
  }
  const r = ratioOf(p['ratio'], w, h);
  if (r) return largestOfRatio(w, h, r);
  return [w, h];
}

function resizeDims(p: Params, w: number, h: number): Dims {
  const mode = String(p['mode'] ?? 'longest');
  const enlarge = p['enlarge'] === true;
  if (mode === 'pixels') {
    const tw = int(p['width']);
    const th = int(p['height']);
    if (tw && th) return [Math.max(1, tw), Math.max(1, th)];
    if (tw) return [Math.max(1, tw), Math.max(1, rnd((h * tw) / w))];
    if (th) return [Math.max(1, rnd((w * th) / h)), Math.max(1, th)];
    return [w, h];
  }
  if (mode === 'percent') {
    const pc = Number(p['percent'] ?? 100);
    return [Math.max(1, rnd((w * pc) / 100)), Math.max(1, rnd((h * pc) / 100))];
  }
  if (mode === 'cover') return [Math.max(1, int(p['width']) || w), Math.max(1, int(p['height']) || h)];
  let k: number;
  if (mode === 'fit') {
    const bw = int(p['width']) || w;
    const bh = int(p['height']) || h;
    k = Math.min(bw / w, bh / h);
  } else {
    k = (int(p['longest']) || Math.max(w, h)) / Math.max(w, h);
  }
  if (!enlarge) k = Math.min(k, 1);
  return [Math.max(1, rnd(w * k)), Math.max(1, rnd(h * k))];
}

/** Padding as [top, right, bottom, left]. */
export function padOf(p: Params): [number, number, number, number] {
  const pad = p['padding'];
  if (typeof pad === 'number') {
    const v = Math.max(0, Math.trunc(pad));
    return [v, v, v, v];
  }
  const o = pad !== null && typeof pad === 'object' && !Array.isArray(pad) ? pad : {};
  return [Math.max(0, int(o['t'])), Math.max(0, int(o['r'])), Math.max(0, int(o['b'])), Math.max(0, int(o['l']))];
}

function canvasDims(p: Params, w: number, h: number): Dims {
  const r = ratioOf(p['ratio'], w, h);
  if (r) {
    if (w / h < r) w = Math.max(w, rnd(h * r));
    else h = Math.max(h, rnd(w / r));
  }
  const [t, rr, b, l] = padOf(p);
  return [w + l + rr, h + t + b];
}

export function dims(kind: EditKind, params: Params, w: number, h: number): Dims {
  if (kind === 'crop') return cropDims(params, w, h);
  if (kind === 'resize') return resizeDims(params, w, h);
  if (kind === 'canvas') return canvasDims(params, w, h);
  return [w, h];
}

/** [[w, h] entering edit 0, after edit 0, ...] for the enabled edits. */
export function chain(stack: { kind: EditKind; params: Params; enabled?: boolean }[], w: number, h: number): Dims[] {
  const out: Dims[] = [[w, h]];
  for (const e of stack) {
    if (e.enabled !== false) [w, h] = dims(e.kind, e.params, w, h);
    out.push([w, h]);
  }
  return out;
}

/**
 * Layers in the workspace: where each one sits in result pixels, and back.
 *
 * The same rules as the engine (engine/img_engine/layers.py): a layer
 * pinned to the photo has its numbers in pixels of the original photo and
 * reaches the result through F, the photo-to-result map a render reports;
 * a layer pinned to the frame has positions as fractions of the result's
 * width and height and sizes as fractions of its shorter side. Rotation is
 * in degrees, clockwise, about the layer's centre.
 */
import type { Affine, Json, LayerType, Params } from './types.ts';

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export interface Frame {
  F: Affine;
  /** The result's full-resolution size. */
  W: number;
  H: number;
}

export function applyF(F: Affine, x: number, y: number): [number, number] {
  return [F[0] * x + F[1] * y + F[2], F[3] * x + F[4] * y + F[5]];
}

export function invertF(F: Affine): Affine {
  const det = F[0] * F[4] - F[1] * F[3] || 1;
  return [F[4] / det, -F[1] / det, (F[1] * F[5] - F[4] * F[2]) / det, -F[3] / det, F[0] / det, (F[3] * F[2] - F[0] * F[5]) / det];
}

function n(p: Params, k: string, d = 0): number {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Maps between a layer's own space and result pixels. */
export class Space {
  readonly frame: boolean;
  readonly unit: number;
  private readonly fr: Frame;
  private readonly Fi: Affine;

  constructor(anchor: Json | undefined, fr: Frame) {
    this.frame = anchor === 'frame';
    this.fr = fr;
    this.Fi = invertF(fr.F);
    const S = Math.min(fr.W, fr.H);
    this.unit = this.frame ? S : Math.sqrt(Math.abs(fr.F[0] * fr.F[4] - fr.F[1] * fr.F[3])) || 1;
  }

  pos(x: number, y: number): [number, number] {
    return this.frame ? [x * this.fr.W, y * this.fr.H] : applyF(this.fr.F, x, y);
  }

  posInv(x: number, y: number): [number, number] {
    return this.frame ? [x / this.fr.W, y / this.fr.H] : applyF(this.Fi, x, y);
  }

  vec(x: number, y: number): [number, number] {
    if (this.frame) return [x * this.unit, y * this.unit];
    const F = this.fr.F;
    return [F[0] * x + F[1] * y, F[3] * x + F[4] * y];
  }

  vecInv(x: number, y: number): [number, number] {
    if (this.frame) return [x / this.unit, y / this.unit];
    const F = this.Fi;
    return [F[0] * x + F[1] * y, F[3] * x + F[4] * y];
  }
}

export type Shape = 'box' | 'text' | 'step' | 'line';

export function shapeOf(t: LayerType): Shape {
  if (t === 'arrow' || t === 'line') return 'line';
  if (t === 'text') return 'text';
  if (t === 'step') return 'step';
  return 'box';
}

/** A layer in result pixels: what the workspace draws and drags. */
export interface Placed {
  shape: Shape;
  cx: number;
  cy: number;
  /** Box size (text: its measured block; step: its circle). */
  w: number;
  h: number;
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Text and step size in result pixels. */
  size: number;
  /** Result pixels per layer unit (stroke widths, radius). */
  unit: number;
}

/* ------------------------------------------------------------------ text */

export const FONT_CSS: Record<string, { family: string; weight: number }> = {
  sans: { family: "'Segoe UI', system-ui, sans-serif", weight: 400 },
  'sans-bold': { family: "'Segoe UI', system-ui, sans-serif", weight: 600 },
  serif: { family: 'Georgia, serif', weight: 400 },
  'serif-bold': { family: 'Georgia, serif', weight: 700 },
  mono: { family: 'Consolas, ui-monospace, monospace', weight: 400 },
  hand: { family: "'Segoe Print', 'Comic Sans MS', cursive", weight: 400 },
  impact: { family: 'Impact, sans-serif', weight: 400 },
};

let measureCtx: CanvasRenderingContext2D | null = null;

/** The text block's size at a font size (as the engine lays it out: 0.18 line spacing, padding with a label box). */
export function textBlock(p: Params, size: number): { w: number; h: number; pad: number; lines: string[]; lineH: number } {
  const lines = String(p['text'] ?? '').replace(/\n+$/, '').split('\n');
  const f = FONT_CSS[String(p['font'] ?? 'sans-bold')] ?? { family: 'sans-serif', weight: 600 };
  if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d');
  let wMax = size * 0.5;
  if (measureCtx !== null) {
    measureCtx.font = `${f.weight} ${size}px ${f.family}`;
    for (const l of lines) wMax = Math.max(wMax, measureCtx.measureText(l === '' ? ' ' : l).width);
  }
  const lineH = size * 1.18;
  const pad = p['bg'] !== undefined ? size * 0.28 : size * 0.06;
  return { w: wMax + pad * 2, h: lineH * lines.length - size * 0.18 + size * 0.22 + pad * 2, pad, lines, lineH };
}

/* --------------------------------------------------------------- placing */

export function place(p: Params, fr: Frame): Placed {
  const type = String(p['type'] ?? 'rect') as LayerType;
  const shape = shapeOf(type);
  const sp = new Space(p['anchor'], fr);
  const base: Placed = { shape, cx: 0, cy: 0, w: 1, h: 1, angle: 0, x1: 0, y1: 0, x2: 0, y2: 0, size: 0, unit: sp.unit };
  if (shape === 'line') {
    const [x1, y1] = sp.pos(n(p, 'x1'), n(p, 'y1'));
    const [x2, y2] = sp.pos(n(p, 'x2'), n(p, 'y2'));
    return { ...base, x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: Math.hypot(x2 - x1, y2 - y1), h: 0, angle: deg(Math.atan2(y2 - y1, x2 - x1)) };
  }
  const [cx, cy] = sp.pos(n(p, 'cx'), n(p, 'cy'));
  const r = rad(n(p, 'rotation'));
  const ax = sp.vec(Math.cos(r), Math.sin(r));
  const angle = deg(Math.atan2(ax[1], ax[0]));
  if (shape === 'text') {
    const size = n(p, 'size', 48) * sp.unit;
    const b = textBlock(p, size);
    return { ...base, cx, cy, size, w: b.w, h: b.h, angle };
  }
  if (shape === 'step') {
    const size = Math.max(12, n(p, 'size', 40) * sp.unit);
    return { ...base, cx, cy, size, w: size, h: size, angle: 0 };
  }
  const vx = sp.vec(Math.cos(r) * n(p, 'w', 1), Math.sin(r) * n(p, 'w', 1));
  const vy = sp.vec(-Math.sin(r) * n(p, 'h', 1), Math.cos(r) * n(p, 'h', 1));
  return { ...base, cx, cy, w: Math.hypot(vx[0], vx[1]), h: Math.hypot(vy[0], vy[1]), angle: deg(Math.atan2(vx[1], vx[0])) };
}

function rounded(v: number, frame: boolean): number {
  const k = frame ? 100000 : 100;
  return Math.round(v * k) / k;
}

/** Write result-pixel geometry back into a layer's params (in its own space). */
export function unplace(p: Params, g: Partial<Placed>, fr: Frame): Params {
  const sp = new Space(p['anchor'], fr);
  const out: Params = { ...p };
  const shape = shapeOf(String(p['type'] ?? 'rect') as LayerType);
  const R = (v: number): number => rounded(v, sp.frame);
  if (shape === 'line') {
    if (g.x1 !== undefined && g.y1 !== undefined) {
      const [x, y] = sp.posInv(g.x1, g.y1);
      out['x1'] = R(x);
      out['y1'] = R(y);
    }
    if (g.x2 !== undefined && g.y2 !== undefined) {
      const [x, y] = sp.posInv(g.x2, g.y2);
      out['x2'] = R(x);
      out['y2'] = R(y);
    }
    return out;
  }
  if (g.cx !== undefined && g.cy !== undefined) {
    const [x, y] = sp.posInv(g.cx, g.cy);
    out['cx'] = R(x);
    out['cy'] = R(y);
  }
  if (g.angle !== undefined && shape !== 'step') {
    const a = rad(g.angle);
    const lx = sp.vecInv(Math.cos(a), Math.sin(a));
    let r = deg(Math.atan2(lx[1], lx[0]));
    r = ((((r + 180) % 360) + 360) % 360) - 180;
    out['rotation'] = Math.round(r * 100) / 100;
    if (shape === 'box' && g.w !== undefined && g.h !== undefined) {
      const vx = sp.vecInv(Math.cos(a) * g.w, Math.sin(a) * g.w);
      const vy = sp.vecInv(-Math.sin(a) * g.h, Math.cos(a) * g.h);
      out['w'] = R(Math.max(sp.frame ? 0.001 : 1, Math.hypot(vx[0], vx[1])));
      out['h'] = R(Math.max(sp.frame ? 0.001 : 1, Math.hypot(vy[0], vy[1])));
    }
  }
  if (g.size !== undefined && (shape === 'text' || shape === 'step')) out['size'] = R(Math.max(sp.frame ? 0.002 : 4, g.size / sp.unit));
  return out;
}

/** Change what a layer is pinned to, keeping where it sits. */
export function repin(p: Params, anchor: 'photo' | 'frame', fr: Frame): Params {
  const g = place(p, fr);
  const next: Params = { ...p };
  if (anchor === 'frame') next['anchor'] = 'frame';
  else delete next['anchor'];
  const unitOld = new Space(p['anchor'], fr).unit;
  const unitNew = new Space(next['anchor'], fr).unit;
  for (const k of ['width', 'radius']) {
    const v = p[k];
    if (typeof v === 'number') next[k] = rounded((v * unitOld) / unitNew, anchor === 'frame');
  }
  return unplace(next, g, fr);
}

/* ------------------------------------------------------------- creating */

export const LAYER_LABEL: Record<LayerType, string> = {
  text: 'Text',
  rect: 'Box',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  line: 'Line',
  highlight: 'Highlight',
  step: 'Step',
  pen: 'Drawing',
  redact: 'Redaction',
  logo: 'Logo',
};

/** The name a layer shows (its own, or what it is). */
export function layerTitle(p: Params): string {
  if (typeof p['name'] === 'string' && p['name'] !== '') return p['name'];
  const t = String(p['type'] ?? '') as LayerType;
  const label = LAYER_LABEL[t] ?? 'Layer';
  if (t === 'text') return label + ' "' + String(p['text'] ?? '').split('\n')[0]?.slice(0, 28) + '"' + (p['tile'] === true ? ' (tiled)' : '');
  if (t === 'redact') return label + ' (' + String(p['mode'] ?? 'solid') + ')';
  if (t === 'step') return label + ' ' + String(p['n'] ?? 1);
  if (t === 'logo' && p['tile'] === true) return label + ' (tiled)';
  return label;
}

/** Stroke width in result pixels that reads well on this result. */
export function defaultStroke(fr: Frame): number {
  return Math.max(3, Math.round(Math.min(fr.W, fr.H) / 130));
}

export function defaultTextSize(fr: Frame): number {
  return Math.max(14, Math.round(Math.min(fr.W, fr.H) / 16));
}

/** A new layer of a type with its geometry in result pixels (then written in photo space). */
export function newLayer(type: LayerType, g: Partial<Placed> & { points?: [number, number][] }, fr: Frame, style: { color: string; width: number; size: number; font: string; mode: string }, extra: Params = {}): Params {
  const p: Params = { type, ...extra };
  if (type === 'arrow' || type === 'line') {
    p['width'] = style.width;
    p['color'] = style.color;
  } else if (type === 'text') {
    p['text'] = typeof extra['text'] === 'string' ? extra['text'] : 'Text';
    p['font'] = style.font;
    p['color'] = style.color;
  } else if (type === 'step') {
    p['color'] = style.color;
  } else if (type === 'rect' || type === 'ellipse' || type === 'pen') {
    p['width'] = style.width;
    p['color'] = style.color;
  } else if (type === 'highlight') {
    p['color'] = '#ffd60a';
  } else if (type === 'redact') {
    p['mode'] = style.mode;
    if (style.mode === 'solid') p['color'] = '#000000';
  }
  // Widths are written in the layer's own units (result pixels / unit).
  const sp = new Space(p['anchor'], fr);
  if (typeof p['width'] === 'number') p['width'] = Math.round((p['width'] / sp.unit) * 100) / 100;
  const out = unplace(p, { angle: 0, w: 1, h: 1, ...g }, fr);
  if (type === 'text' || type === 'step') {
    const pos = sp.posInv(g.cx ?? 0, g.cy ?? 0);
    out['cx'] = rounded(pos[0], sp.frame);
    out['cy'] = rounded(pos[1], sp.frame);
    out['size'] = rounded((g.size ?? style.size) / sp.unit, sp.frame);
    if (type === 'text') delete out['w'];
    delete out['h'];
    delete out['w'];
    if (type === 'step') delete out['rotation'];
  }
  if (type === 'pen' && g.points !== undefined) out['points'] = g.points.map(([u, v]) => [Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000]);
  if (out['rotation'] === 0) delete out['rotation'];
  return out;
}

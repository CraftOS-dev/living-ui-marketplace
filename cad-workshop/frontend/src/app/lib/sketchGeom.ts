/**
 * Sketch items in the browser: their outlines (drawn exactly as the engine
 * builds them: rectangles with rounded corners, circles, slots, polygons,
 * outlines of lines and three-point arcs, construction lines), what a click
 * hits, the points to snap to, the dimensions shown on the canvas and the
 * handles that reshape an item. All in sketch-plane coordinates (mm).
 */
import { valueOf } from './expr.ts';
import type { Json } from './types.ts';

export type P2 = [number, number];
export type Item = { [k: string]: Json };
export type Env = Record<string, number>;

export const ITEM_ORDER = ['rectangle', 'circle', 'slot', 'polygon', 'path', 'line'] as const;
export type ItemType = (typeof ITEM_ORDER)[number];

/* ------------------------------------------------------------- numbers */

export function num(v: Json | undefined, env: Env, dflt: number): number {
  const x = valueOf(v, env);
  return x === null ? dflt : x;
}

export function pt(v: Json | undefined, env: Env, dflt: P2): P2 {
  if (!Array.isArray(v)) return dflt;
  return [num(v[0], env, dflt[0]), num(v[1], env, dflt[1])];
}

/** A plain number rounded for storage (drags write numbers, not expressions). */
export function r4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function rot(p: P2, c: P2, a: number): P2 {
  const s = Math.sin(a);
  const k = Math.cos(a);
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * k - y * s, c[1] + x * s + y * k];
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/* ------------------------------------------------------------ outlines */

/** Points of the arc from a through m to b (excluding a). */
export function arcPoints(a: P2, m: P2, b: P2, steps = 24): P2[] {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-12) return [b];
  const ux = ((a[0] ** 2 + a[1] ** 2) * (m[1] - b[1]) + (m[0] ** 2 + m[1] ** 2) * (b[1] - a[1]) + (b[0] ** 2 + b[1] ** 2) * (a[1] - m[1])) / d;
  const uy = ((a[0] ** 2 + a[1] ** 2) * (b[0] - m[0]) + (m[0] ** 2 + m[1] ** 2) * (a[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  const a0 = Math.atan2(a[1] - uy, a[0] - ux);
  const am = Math.atan2(m[1] - uy, m[0] - ux);
  const a1 = Math.atan2(b[1] - uy, b[0] - ux);
  const ccw = (f: number, t: number): number => (((t - f) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const sweep = ccw(a0, am) < ccw(a0, a1) ? ccw(a0, a1) : -(((a0 - a1) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Array.from({ length: steps }, (_, i) => [ux + r * Math.cos(a0 + (sweep * (i + 1)) / steps), uy + r * Math.sin(a0 + (sweep * (i + 1)) / steps)] as P2);
}

export interface RectGeom {
  c: P2;
  w: number;
  h: number;
  r: number;
  a: number;
}

export function rectOf(it: Item, env: Env): RectGeom {
  const w = num(it['width'], env, 0);
  const h = num(it['height'], env, 0);
  let c = pt(it['center'], env, [0, 0]);
  if (Array.isArray(it['corner'])) {
    const k = pt(it['corner'], env, [0, 0]);
    c = [k[0] + w / 2, k[1] + h / 2];
  }
  const r = Math.min(Math.max(0, num(it['corner_radius'], env, 0)), Math.min(w, h) / 2);
  return { c, w, h, r, a: (num(it['angle_deg'], env, 0) * Math.PI) / 180 };
}

/** Closed outline of an item (the last point repeats the first), or null for a line or a degenerate item. */
export function outline(it: Item, env: Env): P2[] | null {
  const type = it['type'];
  const ang = (num(it['angle_deg'], env, 0) * Math.PI) / 180;
  if (type === 'circle') {
    const c = pt(it['center'], env, [0, 0]);
    const r = num(it['diameter'], env, 0) / 2;
    if (r <= 0) return null;
    return Array.from({ length: 65 }, (_, i) => [c[0] + r * Math.cos((i / 64) * Math.PI * 2), c[1] + r * Math.sin((i / 64) * Math.PI * 2)] as P2);
  }
  if (type === 'rectangle') {
    const g = rectOf(it, env);
    if (g.w <= 0 || g.h <= 0) return null;
    const out: P2[] = [];
    const corners: [number, number, number][] = [
      [g.c[0] + g.w / 2 - g.r, g.c[1] - g.h / 2 + g.r, -Math.PI / 2],
      [g.c[0] + g.w / 2 - g.r, g.c[1] + g.h / 2 - g.r, 0],
      [g.c[0] - g.w / 2 + g.r, g.c[1] + g.h / 2 - g.r, Math.PI / 2],
      [g.c[0] - g.w / 2 + g.r, g.c[1] - g.h / 2 + g.r, Math.PI],
    ];
    for (const [x, y, a0] of corners) {
      const n = g.r > 0 ? 8 : 0;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (n === 0 ? 0 : (i / n) * (Math.PI / 2));
        out.push(rot([x + g.r * Math.cos(a), y + g.r * Math.sin(a)], g.c, g.a));
      }
    }
    out.push(out[0] as P2);
    return out;
  }
  if (type === 'slot') {
    const L = num(it['length'], env, 0);
    const W = num(it['width'], env, 0);
    if (L <= 0 || W <= 0) return null;
    const c = pt(it['center'], env, [0, 0]);
    const out: P2[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * Math.PI;
      out.push(rot([c[0] + L / 2 + (W / 2) * Math.cos(a), c[1] + (W / 2) * Math.sin(a)], c, ang));
    }
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI / 2 + (i / 16) * Math.PI;
      out.push(rot([c[0] - L / 2 + (W / 2) * Math.cos(a), c[1] + (W / 2) * Math.sin(a)], c, ang));
    }
    out.push(out[0] as P2);
    return out;
  }
  if (type === 'polygon') {
    const sides = Math.round(num(it['sides'], env, 6));
    if (sides < 3) return null;
    const R = polygonRadius(it, env, sides);
    if (R <= 0) return null;
    const c = pt(it['center'], env, [0, 0]);
    return Array.from({ length: sides + 1 }, (_, i) => [c[0] + R * Math.cos(ang + (i / sides) * Math.PI * 2), c[1] + R * Math.sin(ang + (i / sides) * Math.PI * 2)] as P2);
  }
  if (type === 'path') {
    let cur = pt(it['start'], env, [0, 0]);
    const out: P2[] = [cur];
    for (const s of pathSegments(it)) {
      const to = pt(s['to'], env, cur);
      const via = s['via'];
      if (Array.isArray(via)) out.push(...arcPoints(cur, pt(via, env, cur), to));
      else out.push(to);
      cur = to;
    }
    return out.length > 2 ? out : null;
  }
  return null;
}

export function polygonRadius(it: Item, env: Env, sides: number): number {
  if (it['across_flats'] !== undefined) return num(it['across_flats'], env, 0) / 2 / Math.cos(Math.PI / sides);
  return num(it['diameter'], env, 0) / 2;
}

export function pathSegments(it: Item): Item[] {
  const segs = it['segments'];
  return Array.isArray(segs) ? segs.filter((s): s is Item => s !== null && typeof s === 'object' && !Array.isArray(s)) : [];
}

/** The vertices of a path: the start, then each segment's end. */
export function pathPoints(it: Item, env: Env): P2[] {
  let cur = pt(it['start'], env, [0, 0]);
  const out: P2[] = [cur];
  for (const s of pathSegments(it)) {
    cur = pt(s['to'], env, cur);
    out.push(cur);
  }
  return out;
}

/** Everything an item draws, as line segments. */
export function segmentsOf(it: Item, env: Env): [P2, P2][] {
  if (it['type'] === 'line') {
    const a = pt(it['from'], env, [0, 0]);
    const b = pt(it['to'], env, [0, 0]);
    return [[a, b]];
  }
  const o = outline(it, env);
  if (o === null) return [];
  const out: [P2, P2][] = [];
  for (let i = 0; i < o.length - 1; i++) out.push([o[i] as P2, o[i + 1] as P2]);
  return out;
}

function distToSeg(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointInPoly(poly: P2[], p: P2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as P2;
    const b = poly[j] as P2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] + 1e-300) + a[0]) inside = !inside;
  }
  return inside;
}

/** The item a click hits: the nearest curve within `tol`, else the smallest closed item around the point. */
export function hitItem(items: Item[], env: Env, p: P2, tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  items.forEach((it, i) => {
    for (const [a, b] of segmentsOf(it, env)) {
      const d = distToSeg(p, a, b);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  if (best !== null) return best;
  let area = Infinity;
  items.forEach((it, i) => {
    const o = outline(it, env);
    if (o === null || !pointInPoly(o, p)) return;
    const a = Math.abs(signedArea(o));
    if (a < area) {
      area = a;
      best = i;
    }
  });
  return best;
}

export function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i] as P2;
    const b = poly[i + 1] as P2;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Closed items as fill regions, holes by containment (as the engine nests them). */
export function regions(items: Item[], env: Env): { outer: P2[]; holes: P2[][] }[] {
  const loops = items.map((it) => outline(it, env)).filter((o): o is P2[] => o !== null);
  const depth = loops.map((o, i) => loops.filter((q, j) => j !== i && Math.abs(signedArea(q)) > Math.abs(signedArea(o)) && pointInPoly(q, o[0] as P2)).length);
  return loops
    .map((o, i) => ({ o, i }))
    .filter(({ i }) => (depth[i] ?? 0) % 2 === 0)
    .map(({ o, i }) => ({
      outer: o,
      holes: loops.filter((q, j) => j !== i && (depth[j] ?? 0) === (depth[i] ?? 0) + 1 && pointInPoly(o, q[0] as P2)),
    }));
}

/* ----------------------------------------------------------- snapping */

export interface SnapPoint {
  p: P2;
  kind: 'end' | 'center' | 'mid' | 'origin';
}

/** The points worth snapping to: ends, corners, centers and straight-segment midpoints. */
export function snapPoints(items: Item[], env: Env, skip: number | null = null): SnapPoint[] {
  const out: SnapPoint[] = [{ p: [0, 0], kind: 'origin' }];
  items.forEach((it, i) => {
    if (i === skip) return;
    const type = it['type'];
    if (type === 'line') {
      const a = pt(it['from'], env, [0, 0]);
      const b = pt(it['to'], env, [0, 0]);
      out.push({ p: a, kind: 'end' }, { p: b, kind: 'end' }, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: 'mid' });
      return;
    }
    if (type === 'path') {
      const pts = pathPoints(it, env);
      pts.forEach((q, k) => {
        out.push({ p: q, kind: 'end' });
        const nx = pts[k + 1];
        const seg = pathSegments(it)[k];
        if (nx !== undefined && seg !== undefined && !Array.isArray(seg['via'])) out.push({ p: [(q[0] + nx[0]) / 2, (q[1] + nx[1]) / 2], kind: 'mid' });
      });
      return;
    }
    if (type === 'rectangle') {
      const g = rectOf(it, env);
      out.push({ p: g.c, kind: 'center' });
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as [number, number][])
        out.push({ p: rot([g.c[0] + (sx * g.w) / 2, g.c[1] + (sy * g.h) / 2], g.c, g.a), kind: 'end' });
      for (const [sx, sy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as [number, number][])
        out.push({ p: rot([g.c[0] + (sx * g.w) / 2, g.c[1] + (sy * g.h) / 2], g.c, g.a), kind: 'mid' });
      return;
    }
    const c = pt(it['center'], env, [0, 0]);
    out.push({ p: c, kind: 'center' });
    if (type === 'polygon') {
      const o = outline(it, env);
      if (o !== null) for (const q of o.slice(0, -1)) out.push({ p: q, kind: 'end' });
    }
    if (type === 'circle') {
      const r = num(it['diameter'], env, 0) / 2;
      for (const [dx, dy] of [
        [r, 0],
        [0, r],
        [-r, 0],
        [0, -r],
      ] as [number, number][])
        out.push({ p: [c[0] + dx, c[1] + dy], kind: 'mid' });
    }
  });
  return out;
}

/* ---------------------------------------------------------- dimensions */

export interface Dim {
  id: string;
  /** Where the label sits. */
  at: P2;
  /** The value shown (mm or a count). */
  value: number;
  /** Text shown when the value comes from an expression. */
  expr: string | null;
  /** A short name for the editor ("Width"). */
  name: string;
  unit: 'mm' | 'deg' | '';
  /** A new item with this dimension set (a number or an expression). */
  set: (v: Json) => Item;
}

function exprOf(v: Json | undefined): string | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (v as { expr?: Json }).expr === 'string' ? ((v as { expr: string }).expr as string) : null;
}

/** The driving dimensions of an item, with where to draw each label. */
export function dimensionsOf(it: Item, env: Env, selected: boolean): Dim[] {
  const type = it['type'];
  const out: Dim[] = [];
  const setKey = (k: string) => (v: Json): Item => ({ ...it, [k]: v });
  if (type === 'rectangle') {
    const g = rectOf(it, env);
    out.push({ id: 'width', name: 'Width', at: rot([g.c[0], g.c[1] - g.h / 2], g.c, g.a), value: g.w, expr: exprOf(it['width']), unit: 'mm', set: setKey('width') });
    out.push({ id: 'height', name: 'Height', at: rot([g.c[0] + g.w / 2, g.c[1]], g.c, g.a), value: g.h, expr: exprOf(it['height']), unit: 'mm', set: setKey('height') });
    if (g.r > 0) out.push({ id: 'corner_radius', name: 'Corner radius', at: rot([g.c[0] + g.w / 2 - g.r * 0.3, g.c[1] + g.h / 2 - g.r * 0.3], g.c, g.a), value: g.r, expr: exprOf(it['corner_radius']), unit: 'mm', set: setKey('corner_radius') });
  } else if (type === 'circle') {
    const c = pt(it['center'], env, [0, 0]);
    const r = num(it['diameter'], env, 0) / 2;
    out.push({ id: 'diameter', name: 'Diameter', at: [c[0] + r * 0.707, c[1] + r * 0.707], value: r * 2, expr: exprOf(it['diameter']), unit: 'mm', set: setKey('diameter') });
  } else if (type === 'slot') {
    const c = pt(it['center'], env, [0, 0]);
    const a = (num(it['angle_deg'], env, 0) * Math.PI) / 180;
    const L = num(it['length'], env, 0);
    const W = num(it['width'], env, 0);
    out.push({ id: 'length', name: 'Length', at: rot([c[0], c[1] - W / 2], c, a), value: L, expr: exprOf(it['length']), unit: 'mm', set: setKey('length') });
    out.push({ id: 'width', name: 'Width', at: rot([c[0] + L / 2 + W / 2, c[1]], c, a), value: W, expr: exprOf(it['width']), unit: 'mm', set: setKey('width') });
  } else if (type === 'polygon') {
    const c = pt(it['center'], env, [0, 0]);
    const sides = Math.round(num(it['sides'], env, 6));
    const af = polygonRadius(it, env, sides) * 2 * Math.cos(Math.PI / sides);
    out.push({
      id: 'across_flats',
      name: 'Across flats',
      at: [c[0] + af / 2, c[1]],
      value: af,
      expr: exprOf(it['across_flats']),
      unit: 'mm',
      set: (v) => {
        const next: Item = { ...it, across_flats: v };
        delete next['diameter'];
        return next;
      },
    });
    if (selected) out.push({ id: 'sides', name: 'Sides', at: [c[0], c[1] - af / 2], value: sides, expr: exprOf(it['sides']), unit: '', set: setKey('sides') });
  } else if (type === 'line') {
    const a = pt(it['from'], env, [0, 0]);
    const b = pt(it['to'], env, [0, 0]);
    const len = dist(a, b);
    out.push({
      id: 'length',
      name: 'Length',
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      value: len,
      expr: null,
      unit: 'mm',
      set: (v) => {
        const L = typeof v === 'number' ? v : num(v, env, len);
        const d: P2 = len < 1e-9 ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        return { ...it, to: [r4(a[0] + d[0] * L), r4(a[1] + d[1] * L)] };
      },
    });
  } else if (type === 'path') {
    const pts = pathPoints(it, env);
    const segs = pathSegments(it);
    // Lengths of straight segments, except the closing one (it must end at the start).
    segs.forEach((s, k) => {
      if (k === segs.length - 1 || Array.isArray(s['via'])) return;
      const a = pts[k] as P2;
      const b = pts[k + 1] as P2;
      const len = dist(a, b);
      out.push({
        id: 'seg' + k,
        name: 'Segment ' + (k + 1),
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        value: len,
        expr: null,
        unit: 'mm',
        set: (v) => {
          const L = typeof v === 'number' ? v : num(v, env, len);
          const d: P2 = len < 1e-9 ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
          const moved: P2 = [r4(a[0] + d[0] * L), r4(a[1] + d[1] * L)];
          return { ...it, segments: segs.map((x, j) => (j === k ? { ...x, to: moved } : x)) };
        },
      });
    });
  }
  // Position of the item's center, from the sketch origin.
  if (selected && (type === 'rectangle' || type === 'circle' || type === 'slot' || type === 'polygon')) {
    const g = type === 'rectangle' ? rectOf(it, env).c : pt(it['center'], env, [0, 0]);
    const center = Array.isArray(it['center']) ? (it['center'] as Json[]) : [g[0], g[1]];
    const setAxis = (k: 0 | 1) => (v: Json): Item => {
      const next: Item = { ...it, center: k === 0 ? [v, center[1] ?? g[1]] : [center[0] ?? g[0], v] };
      delete next['corner'];
      return next;
    };
    if (Math.abs(g[0]) > 1e-9) out.push({ id: 'x', name: 'X', at: [g[0] / 2, g[1]], value: g[0], expr: exprOf(center[0]), unit: 'mm', set: setAxis(0) });
    if (Math.abs(g[1]) > 1e-9) out.push({ id: 'y', name: 'Y', at: [g[0], g[1] / 2], value: g[1], expr: exprOf(center[1]), unit: 'mm', set: setAxis(1) });
  }
  return out;
}

/* -------------------------------------------------------- handles, moves */

export interface ItemHandle {
  id: string;
  p: P2;
}

/** Points that reshape a selected item when dragged. */
export function handlesOf(it: Item, env: Env): ItemHandle[] {
  const type = it['type'];
  if (type === 'rectangle') {
    const g = rectOf(it, env);
    return ([
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as [number, number][]).map(([sx, sy], i) => ({ id: 'corner' + i, p: rot([g.c[0] + (sx * g.w) / 2, g.c[1] + (sy * g.h) / 2], g.c, g.a) }));
  }
  if (type === 'circle') {
    const c = pt(it['center'], env, [0, 0]);
    const r = num(it['diameter'], env, 0) / 2;
    return [{ id: 'rim', p: [c[0] + r, c[1]] }];
  }
  if (type === 'slot') {
    const c = pt(it['center'], env, [0, 0]);
    const a = (num(it['angle_deg'], env, 0) * Math.PI) / 180;
    const L = num(it['length'], env, 0);
    return [
      { id: 'end0', p: rot([c[0] - L / 2, c[1]], c, a) },
      { id: 'end1', p: rot([c[0] + L / 2, c[1]], c, a) },
    ];
  }
  if (type === 'polygon') {
    const o = outline(it, env);
    return o === null ? [] : [{ id: 'vertex', p: o[0] as P2 }];
  }
  if (type === 'line') return [
    { id: 'from', p: pt(it['from'], env, [0, 0]) },
    { id: 'to', p: pt(it['to'], env, [0, 0]) },
  ];
  if (type === 'path') {
    const pts = pathPoints(it, env);
    const segs = pathSegments(it);
    const out: ItemHandle[] = pts.slice(0, -1).map((p, k) => ({ id: 'pt' + k, p }));
    // A handle in the middle of each segment bends it into an arc.
    segs.forEach((s, k) => {
      const a = pts[k] as P2;
      const b = pts[k + 1] as P2;
      const via = s['via'];
      out.push({ id: 'mid' + k, p: Array.isArray(via) ? pt(via, env, a) : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    });
    return out;
  }
  return [];
}

/** An item with one handle moved to p (numbers, rounded). */
export function dragHandle(it: Item, env: Env, id: string, p: P2): Item {
  const type = it['type'];
  const P: P2 = [r4(p[0]), r4(p[1])];
  if (type === 'rectangle') {
    const g = rectOf(it, env);
    const k = Number(id.slice(6));
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const s = signs[k] ?? [1, 1];
    // The opposite corner stays put; work in the rectangle's own axes.
    const opp = rot([g.c[0] - (s[0] * g.w) / 2, g.c[1] - (s[1] * g.h) / 2], g.c, g.a);
    const local = rot(P, opp, -g.a);
    const w = Math.abs(local[0] - opp[0]);
    const h = Math.abs(local[1] - opp[1]);
    const mid = rot([(local[0] + opp[0]) / 2, (local[1] + opp[1]) / 2], opp, g.a);
    const next: Item = { ...it, width: r4(Math.max(w, 0.01)), height: r4(Math.max(h, 0.01)), center: [r4(mid[0]), r4(mid[1])] };
    delete next['corner'];
    return next;
  }
  if (type === 'circle') {
    const c = pt(it['center'], env, [0, 0]);
    return { ...it, diameter: r4(Math.max(dist(c, P) * 2, 0.01)) };
  }
  if (type === 'slot') {
    const c = pt(it['center'], env, [0, 0]);
    const a = (num(it['angle_deg'], env, 0) * Math.PI) / 180;
    const L = num(it['length'], env, 0);
    const other = id === 'end1' ? rot([c[0] - L / 2, c[1]], c, a) : rot([c[0] + L / 2, c[1]], c, a);
    const nl = dist(other, P);
    const na = Math.atan2(id === 'end1' ? P[1] - other[1] : other[1] - P[1], id === 'end1' ? P[0] - other[0] : other[0] - P[0]);
    return { ...it, center: [r4((other[0] + P[0]) / 2), r4((other[1] + P[1]) / 2)], length: r4(Math.max(nl, 0.01)), angle_deg: r4((na * 180) / Math.PI) };
  }
  if (type === 'polygon') {
    const c = pt(it['center'], env, [0, 0]);
    const sides = Math.round(num(it['sides'], env, 6));
    const R = dist(c, P);
    const next: Item = { ...it, across_flats: r4(Math.max(R * 2 * Math.cos(Math.PI / sides), 0.01)), angle_deg: r4((Math.atan2(P[1] - c[1], P[0] - c[0]) * 180) / Math.PI) };
    delete next['diameter'];
    return next;
  }
  if (type === 'line') return { ...it, [id]: P };
  if (type === 'path') {
    const segs = pathSegments(it);
    if (id.startsWith('pt')) {
      const k = Number(id.slice(2));
      if (k === 0) return { ...it, start: P, segments: segs.map((s, j) => (j === segs.length - 1 ? { ...s, to: P } : s)) };
      return { ...it, segments: segs.map((s, j) => (j === k - 1 ? { ...s, to: P } : s)) };
    }
    const k = Number(id.slice(3));
    const pts = pathPoints(it, env);
    const a = pts[k] as P2;
    const b = pts[k + 1] as P2;
    // Dragged back onto the chord: a straight segment again.
    const chordD = distToSeg(P, a, b);
    return { ...it, segments: segs.map((s, j) => {
      if (j !== k) return s;
      const next: Item = { ...s };
      if (chordD < dist(a, b) * 0.02) delete next['via'];
      else next['via'] = P;
      return next;
    }) };
  }
  return it;
}

function shift(v: Json | undefined, env: Env, d: P2): Json {
  const p = pt(v, env, [0, 0]);
  return [r4(p[0] + d[0]), r4(p[1] + d[1])];
}

/** An item moved by d. */
export function moveItem(it: Item, env: Env, d: P2): Item {
  const type = it['type'];
  if (type === 'line') return { ...it, from: shift(it['from'], env, d), to: shift(it['to'], env, d) };
  if (type === 'path')
    return {
      ...it,
      start: shift(it['start'], env, d),
      segments: pathSegments(it).map((s) => {
        const next: Item = { ...s, to: shift(s['to'], env, d) };
        if (Array.isArray(s['via'])) next['via'] = shift(s['via'], env, d);
        return next;
      }),
    };
  if (type === 'rectangle' && Array.isArray(it['corner'])) {
    const g = rectOf(it, env);
    const next: Item = { ...it, center: [r4(g.c[0] + d[0]), r4(g.c[1] + d[1])] };
    delete next['corner'];
    return next;
  }
  return { ...it, center: shift(it['center'], env, d) };
}

/** A fresh id for a new item of a type: r1, c2, sl1, p1, o1, l1. */
export function nextId(items: Item[], type: ItemType): string {
  const prefix = type === 'rectangle' ? 'r' : type === 'circle' ? 'c' : type === 'slot' ? 'sl' : type === 'polygon' ? 'p' : type === 'path' ? 'o' : 'l';
  const used = new Set(items.map((i) => String(i['id'] ?? '')));
  for (let n = 1; n < 100000; n++) if (!used.has(prefix + n)) return prefix + n;
  return prefix + used.size;
}

/** Profiles that cross or touch (the engine refuses those). */
export function crossingItems(items: Item[], env: Env): [string, string] | null {
  const loops = items.map((it) => ({ id: String(it['id'] ?? ''), o: outline(it, env) })).filter((x): x is { id: string; o: P2[] } => x.o !== null);
  const segX = (p1: P2, p2: P2, p3: P2, p4: P2): boolean => {
    const d = (p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
    if (Math.abs(d) < 1e-12) return false;
    const ua = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0])) / d;
    const ub = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0])) / d;
    return ua >= -1e-9 && ua <= 1 + 1e-9 && ub >= -1e-9 && ub <= 1 + 1e-9;
  };
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const a = (loops[i] as { o: P2[] }).o;
      const b = (loops[j] as { o: P2[] }).o;
      for (let s = 0; s < a.length - 1; s++) for (let t = 0; t < b.length - 1; t++) if (segX(a[s] as P2, a[s + 1] as P2, b[t] as P2, b[t + 1] as P2)) return [(loops[i] as { id: string }).id, (loops[j] as { id: string }).id];
    }
  }
  return null;
}

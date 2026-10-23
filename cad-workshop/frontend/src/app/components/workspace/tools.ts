/**
 * What each modelling tool does in the view: which field the clicks in the
 * view fill, which fields show up front (the rest wait under More options),
 * the drag handles it puts on the model and what a drag writes back, the
 * ghost drawn while dragging, and sensible starting values from what is
 * selected. Everything is derived from the feature's params and the build's
 * topology; nothing here talks to the server.
 */
import { valueOf } from '../../lib/expr.ts';
import { creatorOf, keyFeatures } from '../../lib/keys.ts';
import type { Feature, FeatureKind, Json, Params, SketchOutlineData, Summary, TopoEdge, TopoFace, Topology } from '../../lib/types.ts';
import type { GhostSpec } from '../viewer/engine.ts';
import type { HandleSpec } from '../viewer/handles.ts';
import type { Frame, P2, P3, Region } from '../viewer/overlays.ts';

/* --------------------------------------------------------------- specs */

export type PickWhat = 'edges' | 'faces' | 'face' | 'profiles';

export interface ToolSpec {
  /** Fields shown up front, in this order; the rest wait under More options. */
  essentials: string[];
  /** The field clicks in the view fill when the tool opens. */
  pick: { path: string; what: PickWhat } | null;
  /** A drag draws a ghost at once (the real preview follows). */
  ghost: boolean;
  /** Keyboard shortcut that opens the tool. */
  key: string | null;
}

export const TOOLS: Record<FeatureKind, ToolSpec> = {
  sketch: { essentials: [], pick: null, ghost: false, key: 'S' },
  extrude: { essentials: ['items', 'extent', 'operation'], pick: { path: 'items', what: 'profiles' }, ghost: true, key: 'E' },
  revolve: { essentials: ['items', 'axis', 'angle_deg', 'operation'], pick: { path: 'items', what: 'profiles' }, ghost: false, key: null },
  primitive: { essentials: ['shape', 'size', 'diameter', 'diameter_start', 'diameter_end', 'height', 'major_diameter', 'minor_diameter', 'position', 'operation'], pick: null, ghost: true, key: null },
  hole: { essentials: ['face', 'positions', 'size', 'fit', 'diameter', 'through', 'depth', 'head'], pick: { path: 'face', what: 'face' }, ghost: false, key: 'H' },
  fillet: { essentials: ['edges', 'radius'], pick: { path: 'edges', what: 'edges' }, ghost: false, key: 'Shift+F' },
  chamfer: { essentials: ['edges', 'distance'], pick: { path: 'edges', what: 'edges' }, ghost: false, key: 'Shift+C' },
  shell: { essentials: ['remove', 'thickness'], pick: { path: 'remove', what: 'faces' }, ghost: false, key: null },
  pattern_linear: { essentials: ['source', 'direction', 'count', 'spacing'], pick: null, ghost: false, key: null },
  pattern_circular: { essentials: ['source', 'axis', 'count', 'angle_deg'], pick: null, ghost: false, key: null },
  mirror: { essentials: ['source', 'plane'], pick: null, ghost: false, key: null },
  boolean: { essentials: ['operation', 'target', 'tools'], pick: null, ghost: false, key: null },
  transform: { essentials: ['bodies', 'translate', 'rotate'], pick: null, ghost: false, key: 'M' },
  import_step: { essentials: ['asset', 'scale', 'translate', 'operation'], pick: null, ghost: false, key: null },
  push_pull: { essentials: ['face', 'distance'], pick: { path: 'face', what: 'face' }, ghost: true, key: 'Q' },
};

/** What a pick field accepts, from its schema type. */
export function pickWhatOf(type: string): PickWhat | null {
  if (type === 'face') return 'face';
  if (type === 'faces') return 'faces';
  if (type === 'edges') return 'edges';
  if (type === 'items') return 'profiles';
  return null;
}

/* ------------------------------------------------------------ the context */

export interface ToolCtx {
  /** The build the tool works on (before this edit's preview). */
  topo: Topology | null;
  env: Record<string, number>;
  summary: Summary | null;
  features: Feature[];
  /** The feature being edited; null when adding. */
  feature: Feature | null;
}

/* ------------------------------------------------------------- params */

export type Path = (string | number)[];

export function parsePath(p: string): Path {
  return p.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
}

export function getIn(v: Json | undefined, path: Path): Json | undefined {
  let cur: Json | undefined = v;
  for (const k of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[k as number] : (cur as Record<string, Json>)[k as string];
  }
  return cur;
}

/** A copy of params with the value at path set (undefined removes it). */
export function setIn(params: Params, path: Path, value: Json | undefined): Params {
  const go = (node: Json | undefined, i: number): Json | undefined => {
    if (i === path.length) return value;
    const k = path[i] as string | number;
    if (typeof k === 'number') {
      const arr = Array.isArray(node) ? [...node] : [];
      const next = go(arr[k], i + 1);
      arr[k] = next === undefined ? 0 : next;
      return arr;
    }
    const obj: Record<string, Json> = node !== null && node !== undefined && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Record<string, Json>) } : {};
    const next = go(obj[k], i + 1);
    if (next === undefined) delete obj[k];
    else obj[k] = next;
    return obj;
  };
  return (go(params, 0) ?? {}) as Params;
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

function n(v: Json | undefined, env: Record<string, number>, dflt: number): number {
  const x = valueOf(v, env);
  return x === null ? dflt : x;
}

/* ---------------------------------------------------------- references */

export type RefKind = 'faces' | 'edges';

/** The keys of a plain pick reference ({faces: {keys}}), or null for a rule. */
export function refKeys(v: Json | undefined, kind: RefKind): string[] | null {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) return null;
  const sel = (v as Record<string, Json>)[kind];
  if (sel === null || sel === undefined || typeof sel !== 'object' || Array.isArray(sel)) return null;
  const s = sel as Record<string, Json>;
  if (Object.keys(s).length !== 1 || !Array.isArray(s['keys'])) return null;
  return (s['keys'] as Json[]).filter((k): k is string => typeof k === 'string');
}

export function keysRef(kind: RefKind, keys: string[]): Json | undefined {
  return keys.length ? { [kind]: { keys }, expect: keys.length } : undefined;
}

/** Whether a key may be picked for this edit: it exists before the edit, and this feature did not make it. */
export function pickable(ctx: ToolCtx, key: string): boolean {
  if (ctx.topo === null) return false;
  if (ctx.feature !== null && keyFeatures(key).includes(ctx.feature.name)) return false;
  return ctx.topo.faces.some((f) => f.key === key) || ctx.topo.edges.some((e) => e.key === key);
}

function face(ctx: ToolCtx, v: Json | undefined): TopoFace | undefined {
  const k = refKeys(v, 'faces')?.[0];
  return k === undefined ? undefined : ctx.topo?.faces.find((f) => f.key === k);
}

function edge(ctx: ToolCtx, v: Json | undefined): TopoEdge | undefined {
  const k = refKeys(v, 'edges')?.[0];
  return k === undefined ? undefined : ctx.topo?.edges.find((e) => e.key === k);
}

/* ------------------------------------------------------------ vectors */

const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(a: P3): P3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-12 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
}
const AXES: Record<string, P3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Plane coordinates of a world point on a face's frame. */
export function onFrame(f: Frame, p: P3): P2 {
  const d = sub(p, f.origin);
  return [r4(dot(d, f.u)), r4(dot(d, f.v))];
}

function fromFrame(f: Frame, q: P2): P3 {
  return add(f.origin, add(mul(f.u, q[0]), mul(f.v, q[1])));
}

/* ------------------------------------------------------------ profiles */

export function sketchOutline(ctx: ToolCtx, name: Json | undefined): SketchOutlineData | undefined {
  return typeof name === 'string' ? ctx.topo?.sketches.find((s) => s.name === name) : undefined;
}

/** The outer profiles of a sketch (what an extrude uses when none are picked). */
export function outerProfiles(s: SketchOutlineData): string[] {
  return s.loops.filter((l) => l.depth % 2 === 0).map((l) => l.id);
}

/** The profiles a tool uses: the picked items, or every outer profile. */
export function usedProfiles(s: SketchOutlineData | undefined, items: Json | undefined): string[] {
  if (s === undefined) return [];
  const picked = Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string') : [];
  return picked.length ? picked : outerProfiles(s);
}

function regionsOf(s: SketchOutlineData, ids: string[]): Region[] {
  const out: Region[] = [];
  for (const id of ids) {
    const lp = s.loops.find((l) => l.id === id);
    if (lp !== undefined) out.push({ outer: lp.poly, holes: s.loops.filter((l) => l.inside === id).map((l) => l.poly) });
  }
  return out;
}

function centroid(polys: P2[][]): P2 {
  let x = 0;
  let y = 0;
  let k = 0;
  for (const p of polys)
    for (const q of p) {
      x += q[0];
      y += q[1];
      k++;
    }
  return k === 0 ? [0, 0] : [x / k, y / k];
}

/** Toggle a clicked profile: the stored list stays empty while it means "every outer profile". */
export function toggleProfile(params: Params, s: SketchOutlineData, item: string): Params {
  const sameSketch = params['sketch'] === s.name;
  const cur = sameSketch ? usedProfiles(s, params['items']) : [];
  const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
  const outer = outerProfiles(s);
  const all = next.length === outer.length && outer.every((x) => next.includes(x));
  const p: Params = { ...params, sketch: s.name };
  if (all) delete p['items'];
  else p['items'] = next;
  return p;
}

/** Whether the sketch lies on a face of the model (so pulling into it cuts). */
function sketchOnFace(ctx: ToolCtx, sketch: Json | undefined): boolean {
  const f = ctx.features.find((x) => x.name === sketch && x.kind === 'sketch');
  return f !== undefined && f.params['plane'] === 'face';
}

/* ------------------------------------------------------------- handles */

export interface ToolHandle {
  spec: HandleSpec;
  /** The param a value typed beside the handle sets (arrows only). */
  path?: Path;
  /** What the label shows: the param's value. */
  label?: string;
  unit?: 'mm' | '°' | '';
}

function arrow(id: string, origin: P3, dir: P3, value: number, extra: Partial<Pick<ToolHandle, 'path' | 'label' | 'unit'>> & { min?: number; tone?: 'accent' | 'x' | 'y' | 'z'; lead?: number } = {}): ToolHandle {
  const spec: HandleSpec = { kind: 'arrow', id, origin, dir: unit(dir), value, ...(extra.min !== undefined ? { min: extra.min } : {}), ...(extra.tone !== undefined ? { tone: extra.tone } : {}), ...(extra.lead !== undefined ? { lead: extra.lead } : {}) };
  const out: ToolHandle = { spec };
  if (extra.path !== undefined) out.path = extra.path;
  if (extra.label !== undefined) out.label = extra.label;
  out.unit = extra.unit ?? 'mm';
  return out;
}

const fmt = (x: number): string => String(r4(x));

/** Inward-or-outward bisector of an edge's two faces, from their normals or centers. */
function edgeOutward(ctx: ToolCtx, e: TopoEdge): P3 {
  const fa = ctx.topo?.faces.find((f) => f.key === e.faces[0]);
  const fb = ctx.topo?.faces.find((f) => f.key === e.faces[1]);
  if (fa?.normal !== undefined && fb?.normal !== undefined) {
    const s = add(fa.normal, fb.normal);
    if (Math.hypot(...s) > 1e-6) return unit(s);
  }
  if (fa !== undefined && fb !== undefined) return unit(sub(e.center, mul(add(fa.center, fb.center), 0.5)));
  return [0, 0, 1];
}

function bodyBox(ctx: ToolCtx, name: string): { min: P3; max: P3 } | null {
  const b = ctx.summary?.bodies.find((x) => x.name === name)?.bbox;
  return b === null || b === undefined ? null : { min: b.min, max: b.max };
}

/** The extrude's start and end along the sketch normal, as the engine computes them. */
function extrudeSpan(params: Params, env: Record<string, number>): { start: number; end: number; type: string; sign: number } | null {
  const ext = params['extent'];
  const type = String(getIn(ext, ['type']) ?? 'distance');
  const sign = params['direction'] === 'reverse' ? -1 : 1;
  const d = n(getIn(ext, ['distance']), env, 0);
  if (type === 'distance') return { start: 0, end: sign * d, type, sign };
  if (type === 'symmetric') return { start: -d / 2, end: d / 2, type, sign };
  if (type === 'two_sided') return { start: -sign * n(getIn(ext, ['distance2']), env, 0), end: sign * d, type, sign };
  return null;
}

/** Primitive placement: the base point, axis and sizes, as the engine places them. */
function primitiveGeom(params: Params, env: Record<string, number>): { shape: string; min?: P3; max?: P3; base?: P3; axis?: P3; r?: number; h?: number; center?: P3 } {
  const shape = String(params['shape'] ?? 'box');
  const pos: P3 = [n(getIn(params['position'], [0]), env, 0), n(getIn(params['position'], [1]), env, 0), n(getIn(params['position'], [2]), env, 0)];
  if (shape === 'box') {
    const s: P3 = [n(getIn(params['size'], [0]), env, 0), n(getIn(params['size'], [1]), env, 0), n(getIn(params['size'], [2]), env, 0)];
    const anchor = String(params['anchor'] ?? 'bottom');
    const lo: P3 = anchor === 'corner' ? pos : anchor === 'center' ? sub(pos, mul(s, 0.5)) : [pos[0] - s[0] / 2, pos[1] - s[1] / 2, pos[2]];
    return { shape, min: lo, max: add(lo, s) };
  }
  if (shape === 'cylinder' || shape === 'cone') {
    const axis = AXES[String(params['axis'] ?? 'Z')] ?? [0, 0, 1];
    const h = n(params['height'], env, 0);
    const base = String(params['anchor'] ?? 'bottom') === 'bottom' ? pos : sub(pos, mul(axis, h / 2));
    const r = shape === 'cylinder' ? n(params['diameter'], env, 0) / 2 : Math.max(n(params['diameter_start'], env, 0), n(params['diameter_end'], env, 0)) / 2;
    return { shape, base, axis, r, h };
  }
  if (shape === 'sphere') return { shape, center: pos, r: n(params['diameter'], env, 0) / 2 };
  return { shape, center: pos };
}

function perpendicular(a: P3): P3 {
  return Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
}

const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** p turned by deg degrees about the line through o along unit d (Rodrigues). */
function turn(p: P3, o: P3, d: P3, deg: number): P3 {
  const a = (deg * Math.PI) / 180;
  const v = sub(p, o);
  const k = Math.cos(a);
  const s = Math.sin(a);
  return add(o, add(add(mul(v, k), mul(cross(d, v), s)), mul(d, dot(d, v) * (1 - k))));
}

/** Signed angle in degrees from a to b about unit d, both taken square to d. */
function angleAbout(a: P3, b: P3, d: P3): number {
  const pa = sub(a, mul(d, dot(a, d)));
  const pb = sub(b, mul(d, dot(b, d)));
  return (Math.atan2(dot(cross(pa, pb), d), dot(pa, pb)) * 180) / Math.PI;
}

/** The revolve axis in the world: a world axis, a construction line of its sketch, or a straight edge. */
function revolveAxis(ctx: ToolCtx, params: Params, s: SketchOutlineData): { o: P3; d: P3 } | null {
  const axis = params['axis'];
  if (typeof axis === 'string') {
    const d = AXES[axis];
    return d === undefined ? null : { o: [0, 0, 0], d };
  }
  const seg = getIn(axis, ['segment']);
  if (typeof seg === 'string') {
    const l = s.lines.find((x) => x.id === seg);
    if (l === undefined) return null;
    const a = fromFrame(s.frame, l.from);
    const b = fromFrame(s.frame, l.to);
    return { o: a, d: unit(sub(b, a)) };
  }
  const e = edge(ctx, getIn(axis, ['edge']));
  if (e?.direction !== undefined) return { o: e.center, d: unit(e.direction) };
  return null;
}

/** The drag handles a tool shows for its current params. */
export function toolHandles(kind: FeatureKind, params: Params, ctx: ToolCtx): ToolHandle[] {
  const env = ctx.env;
  switch (kind) {
    case 'extrude': {
      const s = sketchOutline(ctx, params['sketch']);
      const span = extrudeSpan(params, env);
      if (s === undefined || span === null) return [];
      const ids = usedProfiles(s, params['items']);
      const polys = s.loops.filter((l) => ids.includes(l.id)).map((l) => l.poly);
      const c = fromFrame(s.frame, centroid(polys));
      const nrm = s.frame.normal;
      if (span.type === 'distance') return [arrow('distance', c, mul(nrm, span.sign), n(getIn(params['extent'], ['distance']), env, 0), { path: ['extent', 'distance'], label: fmt(n(getIn(params['extent'], ['distance']), env, 0)) })];
      if (span.type === 'symmetric') {
        const d = n(getIn(params['extent'], ['distance']), env, 0);
        return [arrow('symmetric', c, nrm, d / 2, { path: ['extent', 'distance'], label: fmt(d), min: 0 })];
      }
      return [
        arrow('distance', c, mul(nrm, span.sign), n(getIn(params['extent'], ['distance']), env, 0), { path: ['extent', 'distance'], label: fmt(n(getIn(params['extent'], ['distance']), env, 0)), min: 0 }),
        arrow('distance2', c, mul(nrm, -span.sign), n(getIn(params['extent'], ['distance2']), env, 0), { path: ['extent', 'distance2'], label: fmt(n(getIn(params['extent'], ['distance2']), env, 0)), min: 0 }),
      ];
    }
    case 'revolve': {
      const s = sketchOutline(ctx, params['sketch']);
      if (s === undefined) return [];
      const ax = revolveAxis(ctx, params, s);
      if (ax === null) return [];
      const ids = usedProfiles(s, params['items']);
      const c = fromFrame(s.frame, centroid(s.loops.filter((l) => ids.includes(l.id)).map((l) => l.poly)));
      const ang = n(params['angle_deg'], env, 360);
      const sign = params['direction'] === 'reverse' ? -1 : 1;
      return [{ spec: { kind: 'point', id: 'angle', at: turn(c, ax.o, ax.d, sign * ang), normal: ax.d }, path: ['angle_deg'], label: fmt(ang), unit: '°' }];
    }
    case 'push_pull': {
      const f = face(ctx, params['face']);
      if (f === undefined || f.normal === undefined) return [];
      const d = n(params['distance'], env, 0);
      return [arrow('distance', f.center, f.normal, d, { path: ['distance'], label: fmt(d) })];
    }
    case 'fillet':
    case 'chamfer': {
      const e = edge(ctx, params['edges']);
      if (e === undefined) return [];
      const key = kind === 'fillet' ? 'radius' : 'distance';
      const v = n(params[key], env, 0);
      return [arrow(key, e.center, edgeOutward(ctx, e), v, { path: [key], label: fmt(v), min: 0.01 })];
    }
    case 'shell': {
      const f = face(ctx, params['remove']);
      if (f === undefined || f.normal === undefined) return [];
      const t = n(params['thickness'], env, 0);
      const dir = params['direction'] === 'outside' ? f.normal : mul(f.normal, -1);
      return [arrow('thickness', f.center, dir, t, { path: ['thickness'], label: fmt(t), min: 0.01 })];
    }
    case 'hole': {
      const f = face(ctx, params['face']);
      if (f === undefined || f.frame === undefined) return [];
      const fr = f.frame;
      const pts = Array.isArray(params['positions']) ? params['positions'] : [];
      const out: ToolHandle[] = pts.map((q, i) => ({ spec: { kind: 'point', id: 'pos' + i, at: fromFrame(fr, [n(getIn(q, [0]), env, 0), n(getIn(q, [1]), env, 0)]), normal: fr.normal } }));
      if (params['through'] === false && pts.length > 0) {
        const p0 = fromFrame(fr, [n(getIn(pts[0], [0]), env, 0), n(getIn(pts[0], [1]), env, 0)]);
        const d = n(params['depth'], env, 0);
        out.push(arrow('depth', p0, mul(fr.normal, -1), d, { path: ['depth'], label: fmt(d), min: 0.01 }));
      }
      return out;
    }
    case 'primitive': {
      const g = primitiveGeom(params, env);
      if (g.shape === 'box' && g.min !== undefined && g.max !== undefined) {
        const s = sub(g.max, g.min);
        const mid = mul(add(g.min, g.max), 0.5);
        const anchor = String(params['anchor'] ?? 'bottom');
        const fromX: P3 = anchor === 'corner' ? [g.min[0], mid[1], mid[2]] : mid;
        const fromY: P3 = anchor === 'corner' ? [mid[0], g.min[1], mid[2]] : mid;
        const fromZ: P3 = anchor === 'center' ? mid : [mid[0], mid[1], g.min[2]];
        const half = (axis: number): number => (anchor === 'corner' ? s[axis] ?? 0 : (s[axis] ?? 0) / 2);
        const zv = anchor === 'center' ? s[2] / 2 : s[2];
        return [
          arrow('sx', fromX, [1, 0, 0], half(0), { path: ['size', 0], label: fmt(s[0]), min: 0.01, tone: 'x' }),
          arrow('sy', fromY, [0, 1, 0], half(1), { path: ['size', 1], label: fmt(s[1]), min: 0.01, tone: 'y' }),
          arrow('sz', fromZ, [0, 0, 1], zv, { path: ['size', 2], label: fmt(s[2]), min: 0.01, tone: 'z' }),
          { spec: { kind: 'point', id: 'pos', at: [mid[0], mid[1], g.min[2]], normal: [0, 0, 1] } },
        ];
      }
      if ((g.shape === 'cylinder' || g.shape === 'cone') && g.base !== undefined && g.axis !== undefined) {
        const h = g.h ?? 0;
        const out: ToolHandle[] = [arrow('height', g.base, g.axis, h, { path: ['height'], label: fmt(h), min: 0.01 })];
        if (g.shape === 'cylinder') out.push(arrow('radius', add(g.base, mul(g.axis, h / 2)), perpendicular(g.axis), g.r ?? 0, { path: ['diameter'], label: fmt((g.r ?? 0) * 2), min: 0.01 }));
        out.push({ spec: { kind: 'point', id: 'pos', at: g.base, normal: g.axis } });
        return out;
      }
      if (g.shape === 'sphere' && g.center !== undefined) return [arrow('radius', g.center, [1, 0, 0], g.r ?? 0, { path: ['diameter'], label: fmt((g.r ?? 0) * 2), min: 0.01 })];
      return [];
    }
    case 'transform': {
      const bodies = Array.isArray(params['bodies']) ? params['bodies'].filter((x): x is string => typeof x === 'string') : [];
      const box = bodies[0] !== undefined ? bodyBox(ctx, bodies[0]) : null;
      if (box === null) return [];
      const t: P3 = [n(getIn(params['translate'], [0]), env, 0), n(getIn(params['translate'], [1]), env, 0), n(getIn(params['translate'], [2]), env, 0)];
      // Editing a move: the build already includes it, so measure from where the body started.
      const stored = ctx.feature !== null ? ([0, 1, 2].map((i) => n(getIn(ctx.feature?.params['translate'], [i]), env, 0)) as P3) : ([0, 0, 0] as P3);
      const c = sub(mul(add(box.min, box.max), 0.5), stored);
      // A gizmo at the body's center: arrows of a fixed screen length, so they stay in view and apart at 0.
      const out: ToolHandle[] = (['x', 'y', 'z'] as const).map((a, i) =>
        arrow('t' + a, c, AXES[a.toUpperCase()] as P3, t[i] ?? 0, { path: ['translate', i], label: fmt(t[i] ?? 0), tone: a, lead: 64 }),
      );
      // Turning about Z: a point on a ring around the body.
      const rot = params['rotate'];
      const axis = getIn(rot, ['axis']);
      if (axis === undefined || axis === 'Z') {
        const r = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) * 0.3;
        const deg = n(getIn(rot, ['angle_deg']), env, 0);
        const at: P3 = [c[0] + r * Math.cos(((deg + 45) * Math.PI) / 180), c[1] + r * Math.sin(((deg + 45) * Math.PI) / 180), c[2]];
        out.push({ spec: { kind: 'point', id: 'turn', at, normal: [0, 0, 1], tone: 'z' }, path: ['rotate', 'angle_deg'], label: fmt(deg), unit: '°' });
      }
      return out;
    }
    default:
      return [];
  }
}

/** Params after a handle moved to a value (arrows) or a point (point handles). */
export function dragTo(kind: FeatureKind, params: Params, id: string, value: number | P3, ctx: ToolCtx, touched: Set<string>): Params {
  if (typeof value === 'number') {
    const h = toolHandles(kind, params, ctx).find((x) => x.spec.id === id);
    if (h === undefined || h.path === undefined) return params;
    let v = value;
    if (kind === 'extrude' && id === 'symmetric') v = value * 2;
    if (kind === 'primitive' && (id === 'sx' || id === 'sy') && String(params['anchor'] ?? 'bottom') !== 'corner') v = value * 2;
    if (kind === 'primitive' && id === 'sz' && String(params['anchor'] ?? 'bottom') === 'center') v = value * 2;
    if (kind === 'primitive' && id === 'radius') v = value * 2;
    let next = setIn(params, h.path, r4(v));
    // Pulling a profile on a face into the model cuts; out of it adds (unless the operation was set by hand).
    if (kind === 'extrude' && id === 'distance' && ctx.feature === null && !touched.has('operation') && sketchOnFace(ctx, params['sketch']) && (ctx.summary?.bodies.length ?? 0) > 0) {
      next = { ...next, operation: value < 0 ? 'cut' : 'add' };
    }
    return next;
  }
  if (kind === 'revolve' && id === 'angle') {
    const s = sketchOutline(ctx, params['sketch']);
    const ax = s === undefined ? null : revolveAxis(ctx, params, s);
    if (s === undefined || ax === null) return params;
    const ids = usedProfiles(s, params['items']);
    const c = fromFrame(s.frame, centroid(s.loops.filter((l) => ids.includes(l.id)).map((l) => l.poly)));
    let a = angleAbout(sub(c, ax.o), sub(value, ax.o), ax.d) * (params['direction'] === 'reverse' ? -1 : 1);
    if (a <= 0.5) a += 360;
    return { ...params, angle_deg: Math.min(360, Math.round(a)) };
  }
  if (kind === 'transform' && id === 'turn') {
    const bodies = Array.isArray(params['bodies']) ? params['bodies'].filter((x): x is string => typeof x === 'string') : [];
    const box = bodies[0] !== undefined ? bodyBox(ctx, bodies[0]) : null;
    if (box === null) return params;
    const stored = ctx.feature !== null ? ([0, 1, 2].map((i) => n(getIn(ctx.feature?.params['translate'], [i]), ctx.env, 0)) as P3) : ([0, 0, 0] as P3);
    const c = sub(mul(add(box.min, box.max), 0.5), stored);
    let deg = Math.round((Math.atan2(value[1] - c[1], value[0] - c[0]) * 180) / Math.PI) - 45;
    if (deg <= -180) deg += 360;
    const rot = getIn(params, ['rotate']);
    const origin = getIn(rot, ['origin']) ?? [r4(c[0]), r4(c[1]), r4(c[2])];
    return { ...params, rotate: { axis: 'Z', angle_deg: deg, origin } };
  }
  if (kind === 'hole' && id.startsWith('pos')) {
    const f = face(ctx, params['face']);
    if (f?.frame === undefined) return params;
    return setIn(params, ['positions', Number(id.slice(3))], onFrame(f.frame, value));
  }
  if (kind === 'primitive' && id === 'pos') {
    const g = primitiveGeom(params, ctx.env);
    const anchor = String(params['anchor'] ?? 'bottom');
    let pos: P3 = [r4(value[0]), r4(value[1]), r4(value[2])];
    if (g.shape === 'box' && g.min !== undefined && g.max !== undefined) {
      const s = sub(g.max, g.min);
      // The handle sits at the bottom center; the stored position follows the anchor.
      if (anchor === 'corner') pos = [r4(value[0] - s[0] / 2), r4(value[1] - s[1] / 2), r4(g.min[2])];
      else if (anchor === 'center') pos = [r4(value[0]), r4(value[1]), r4(g.min[2] + s[2] / 2)];
      else pos = [r4(value[0]), r4(value[1]), r4(g.min[2])];
    }
    return { ...params, position: pos };
  }
  return params;
}

/** A value typed beside a handle (a number or an expression). */
export function typeAt(kind: FeatureKind, params: Params, id: string, v: Json, ctx: ToolCtx): Params {
  const h = toolHandles(kind, params, ctx).find((x) => x.spec.id === id);
  return h?.path === undefined ? params : setIn(params, h.path, v);
}

/** Whether the params would change anything yet (a move by nothing is not an edit). */
export function toolReady(kind: FeatureKind, params: Params, env: Record<string, number>): boolean {
  if (kind === 'transform') {
    const t = [0, 1, 2].map((i) => n(getIn(params['translate'], [i]), env, 0));
    const a = n(getIn(params['rotate'], ['angle_deg']), env, 0);
    return t.some((x) => Math.abs(x) > 1e-9) || Math.abs(a) > 1e-9;
  }
  return true;
}

/* -------------------------------------------------------------- ghosts */

/** What a drag in progress would add or cut, drawn at once. */
export function toolGhost(kind: FeatureKind, params: Params, ctx: ToolCtx): GhostSpec {
  const env = ctx.env;
  if (kind === 'extrude') {
    const s = sketchOutline(ctx, params['sketch']);
    const span = extrudeSpan(params, env);
    if (s === undefined || span === null) return null;
    const regions = regionsOf(s, usedProfiles(s, params['items']));
    return { kind: 'prism', regions, frame: s.frame, start: span.start, end: span.end, cut: params['operation'] === 'cut' };
  }
  if (kind === 'push_pull') {
    const k = refKeys(params['face'], 'faces')?.[0];
    return k === undefined ? null : { kind: 'face', key: k, distance: n(params['distance'], env, 0) };
  }
  if (kind === 'primitive') {
    const g = primitiveGeom(params, env);
    const cut = params['operation'] === 'cut';
    if (g.shape === 'box' && g.min !== undefined && g.max !== undefined) return { kind: 'box', min: g.min, max: g.max, cut };
    if (g.shape === 'cylinder' && g.base !== undefined && g.axis !== undefined) return { kind: 'cylinder', base: g.base, axis: g.axis, radius: g.r ?? 0, height: g.h ?? 0, cut };
    if (g.shape === 'sphere' && g.center !== undefined) return { kind: 'sphere', center: g.center, radius: g.r ?? 0, cut };
  }
  return null;
}

/* ---------------------------------------------------------------- picks */

/** Params after a face or edge is clicked while the tool's pick field at `path` is active. */
export function pickInto(kind: FeatureKind, params: Params, path: string, what: PickWhat, key: string, point: P3, ctx: ToolCtx): Params | null {
  const isEdge = key.includes('|');
  if (what === 'edges' && !isEdge) {
    // A face clicked for an edges field: take all its edges (as Fusion's face-pick does).
    if (ctx.topo === null) return null;
    const around = ctx.topo.edges.filter((e) => e.faces.includes(key)).map((e) => e.key);
    if (around.length === 0) return null;
    const cur = refKeys(getIn(params, parsePath(path)), 'edges') ?? [];
    const allIn = around.every((k) => cur.includes(k));
    const next = allIn ? cur.filter((k) => !around.includes(k)) : [...cur, ...around.filter((k) => !cur.includes(k))];
    return setIn(params, parsePath(path), keysRef('edges', next));
  }
  if (what !== 'edges' && isEdge) return null;
  const p = parsePath(path);
  if (what === 'face') {
    const cur = refKeys(getIn(params, p), 'faces')?.[0];
    const f = ctx.topo?.faces.find((x) => x.key === key);
    if (kind === 'hole' && path === 'face' && f?.frame !== undefined) {
      // The first click picks the face and drills there; later clicks on it add holes.
      const pts = Array.isArray(params['positions']) && cur === key ? params['positions'] : [];
      return { ...setIn(params, p, keysRef('faces', [key])), positions: [...pts, onFrame(f.frame, point)] };
    }
    if (kind === 'push_pull' || kind === 'hole' || path.endsWith('face')) {
      if (f === undefined || (f.type !== 'plane' && (kind === 'push_pull' || kind === 'hole'))) return null;
    }
    return setIn(params, p, cur === key ? undefined : keysRef('faces', [key]));
  }
  const kindKey: RefKind = what === 'edges' ? 'edges' : 'faces';
  const cur = refKeys(getIn(params, p), kindKey) ?? [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  return setIn(params, p, keysRef(kindKey, next));
}

const REPEATABLE = ['extrude', 'revolve', 'primitive', 'hole', 'pattern_linear', 'pattern_circular', 'mirror', 'import_step', 'push_pull'];

/** For pattern and mirror with no pick field active: a face picks the feature that made it, a straight edge the direction (or axis). */
export function patternPick(kind: FeatureKind, params: Params, key: string, ctx: ToolCtx): Params | null {
  if (kind !== 'pattern_linear' && kind !== 'pattern_circular' && kind !== 'mirror') return null;
  if (key.includes('|')) {
    if (kind === 'mirror') return null;
    const e = ctx.topo?.edges.find((x) => x.key === key);
    if (e === undefined) return null;
    if (kind === 'pattern_linear' && e.direction === undefined) return null;
    return { ...params, [kind === 'pattern_linear' ? 'direction' : 'axis']: { edge: keysRef('edges', [key]) ?? null } };
  }
  const owner = creatorOf(key);
  const f = ctx.features.find((x) => x.name === owner);
  if (f === undefined || !REPEATABLE.includes(f.kind) || owner === ctx.feature?.name) return null;
  const src = getIn(params, ['source']);
  const list = (Array.isArray(getIn(src, ['features'])) ? (getIn(src, ['features']) as Json[]) : []).filter((x): x is string => typeof x === 'string');
  const next = list.includes(owner) ? list.filter((x) => x !== owner) : [...list, owner];
  return { ...params, source: { features: next } };
}

/* ------------------------------------------------------------ defaults */

export interface StartFrom {
  selection: string[];
  /** Profiles picked in the view ("sketch:item"). */
  profiles: { sketch: string; item: string }[];
}

/** Sensible starting params for a new feature, from the selection and what came before. */
export function defaultsFor(kind: FeatureKind, ctx: ToolCtx, from: StartFrom): Params {
  const topo = ctx.topo;
  const faces = topo === null ? [] : from.selection.filter((k) => topo.faces.some((f) => f.key === k));
  const planar = topo === null ? [] : faces.filter((k) => topo.faces.find((f) => f.key === k)?.type === 'plane');
  const edges = topo === null ? [] : from.selection.filter((k) => topo.edges.some((e) => e.key === k));
  const sketches = ctx.features.filter((f) => f.kind === 'sketch');
  const unused = sketches.filter((f) => f.used_by.length === 0);
  const pickedSketch = from.profiles[0]?.sketch;
  const sketch = pickedSketch ?? unused[unused.length - 1]?.name ?? sketches[sketches.length - 1]?.name;
  const lastMaterial = [...ctx.features].reverse().find((f) => ['extrude', 'revolve', 'primitive', 'hole', 'push_pull'].includes(f.kind))?.name;
  const bodies = ctx.summary?.bodies.map((b) => b.name) ?? [];
  const hasBody = bodies.length > 0;
  const items = pickedSketch !== undefined ? from.profiles.filter((p) => p.sketch === pickedSketch).map((p) => p.item) : [];
  switch (kind) {
    case 'extrude': {
      const onFace = sketchOnFace(ctx, sketch);
      return {
        ...(sketch !== undefined ? { sketch } : {}),
        ...(items.length ? { items } : {}),
        extent: { type: 'distance', distance: onFace ? 5 : 10 },
        operation: hasBody ? 'add' : 'new',
      };
    }
    case 'revolve':
      return { ...(sketch !== undefined ? { sketch } : {}), ...(items.length ? { items } : {}), axis: 'Z', angle_deg: 360, operation: hasBody ? 'add' : 'new' };
    case 'primitive':
      return { shape: 'box', size: [20, 20, 20], position: [0, 0, 0], anchor: 'bottom', operation: hasBody ? 'add' : 'new' };
    case 'hole': {
      const f = planar.length === 1 ? topo?.faces.find((x) => x.key === planar[0]) : undefined;
      return { ...(f?.frame !== undefined ? { face: keysRef('faces', [f.key]) ?? null, positions: [onFrame(f.frame, f.center)] } : {}), size: 'M3', fit: 'clearance', through: true, head: 'none' };
    }
    case 'fillet':
      return { ...(edges.length ? { edges: keysRef('edges', edges) ?? null } : {}), radius: 2 };
    case 'chamfer':
      return { ...(edges.length ? { edges: keysRef('edges', edges) ?? null } : {}), distance: 1 };
    case 'shell':
      return { ...(faces.length ? { remove: keysRef('faces', faces) ?? null } : {}), thickness: 2, direction: 'inside' };
    case 'push_pull':
      return { ...(planar.length === 1 ? { face: keysRef('faces', planar) ?? null } : {}), distance: 5 };
    case 'pattern_linear':
      return { source: { features: lastMaterial !== undefined ? [lastMaterial] : [] }, direction: 'X', count: 3, spacing: 20 };
    case 'pattern_circular':
      return { source: { features: lastMaterial !== undefined ? [lastMaterial] : [] }, axis: 'Z', count: 6, angle_deg: 360 };
    case 'mirror':
      return { source: { features: lastMaterial !== undefined ? [lastMaterial] : [] }, plane: 'YZ' };
    case 'boolean':
      return { operation: 'add', ...(bodies[0] !== undefined ? { target: bodies[0] } : {}), ...(bodies.length > 1 ? { tools: bodies.slice(1) } : {}) };
    case 'transform': {
      const owner = faces[0] !== undefined ? topo?.faces.find((f) => f.key === faces[0])?.body : undefined;
      const b = owner ?? bodies[bodies.length - 1];
      return { bodies: b !== undefined ? [b] : [], translate: [0, 0, 0] };
    }
    case 'import_step':
      return { operation: hasBody ? 'add' : 'new' };
    default:
      return {};
  }
}

/** The faces a feature made (for highlighting its row's geometry). */
export function facesOf(topo: Topology | null, feature: string): string[] {
  return topo === null ? [] : topo.faces.filter((f) => keyFeatures(f.base).includes(feature)).map((f) => f.key);
}

/** The feature that made a face or edge (the first face's creator for an edge). */
export function ownerOf(key: string): string {
  return creatorOf(key);
}

/* ------------------------------------------------------- edge selection */

const close = (a: P3, b: P3, tol: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;

/** Edges joined end to end with this one and smooth across the join (a tangent chain). */
export function tangentChain(topo: Topology, start: string): string[] {
  const edges = topo.edges;
  const first = edges.find((e) => e.key === start);
  if (first === undefined) return [start];
  const tol = 1e-4 * Math.max(1, first.length);
  const tangentAt = (e: TopoEdge, p: P3): P3 => {
    // Straight edges: their direction; curved ones: the chord near that end.
    if (e.direction !== undefined) return e.direction;
    const other = close(e.ends[0], p, tol) ? e.ends[1] : e.ends[0];
    return unit(sub(other, p));
  };
  const chain = new Set([start]);
  const queue: TopoEdge[] = [first];
  while (queue.length) {
    const e = queue.shift() as TopoEdge;
    for (const p of e.ends) {
      for (const o of edges) {
        if (chain.has(o.key) || o.body !== e.body) continue;
        if (!o.ends.some((q) => close(q, p, tol))) continue;
        const a = tangentAt(e, p);
        const b = tangentAt(o, p);
        if (Math.abs(dot(unit(a), unit(b))) > 0.996) {
          chain.add(o.key);
          queue.push(o);
        }
      }
    }
  }
  return [...chain];
}

/** Faces or edges like this one: same body and type; for faces the same facing (flat) or radius (round), for edges the same length and radius. */
export function similar(topo: Topology, key: string): string[] {
  const f = topo.faces.find((x) => x.key === key);
  if (f !== undefined) {
    return topo.faces
      .filter((g) => {
        if (g.body !== f.body || g.type !== f.type) return false;
        if (f.normal !== undefined && g.normal !== undefined) return dot(f.normal, g.normal) > 0.9999;
        if (f.radius !== undefined && g.radius !== undefined) return Math.abs(f.radius - g.radius) < 1e-6 * Math.max(1, f.radius);
        return true;
      })
      .map((g) => g.key);
  }
  const e = topo.edges.find((x) => x.key === key);
  if (e === undefined) return [key];
  return topo.edges
    .filter((g) => g.body === e.body && g.type === e.type && Math.abs(g.length - e.length) < 1e-6 * Math.max(1, e.length) && (e.radius === undefined || (g.radius !== undefined && Math.abs(g.radius - e.radius) < 1e-6 * Math.max(1, e.radius))))
    .map((g) => g.key);
}

/** The edges around a face. */
export function boundaryEdges(topo: Topology, faceKey: string): string[] {
  return topo.edges.filter((e) => e.faces.includes(faceKey)).map((e) => e.key);
}

export { fromFrame };

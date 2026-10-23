/**
 * Things drawn over or beside the model that are not the model itself:
 * sketches (curves and clickable profile regions), the three origin planes
 * to sketch on, ghost previews of an edit in progress, and the sketch-mode
 * drawing layer (curves, points, inference lines and the plane grid). All
 * geometry is built from sketch-plane frames and 2D points, so the viewer
 * draws exactly what the engine will build.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, ExtrudeGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { Frame, P2, P3 } from './frames.ts';

export type { Frame, P2, P3 } from './frames.ts';
export { BASE_FRAMES, offsetFrame } from './frames.ts';

/** One closed region to fill or extrude: an outline with holes, in plane coordinates. */
export interface Region {
  outer: P2[];
  holes: P2[][];
}

export function v3(p: P3): Vector3 {
  return new Vector3(p[0], p[1], p[2]);
}

/** A plane point in world space, lifted along the normal by `lift`. */
export function at(f: Frame, p: P2, lift = 0): Vector3 {
  return new Vector3(
    f.origin[0] + f.u[0] * p[0] + f.v[0] * p[1] + f.normal[0] * lift,
    f.origin[1] + f.u[1] * p[0] + f.v[1] * p[1] + f.normal[1] * lift,
    f.origin[2] + f.u[2] * p[0] + f.v[2] * p[1] + f.normal[2] * lift,
  );
}

/** The matrix that places plane coordinates (x, y, z along the normal) in the world. */
export function frameMatrix(f: Frame): Matrix4 {
  return new Matrix4().makeBasis(v3(f.u), v3(f.v), v3(f.normal)).setPosition(v3(f.origin));
}

function shapeOf(r: Region): Shape {
  const s = new Shape(r.outer.map((p) => new Vector2(p[0], p[1])));
  for (const h of r.holes) s.holes.push(new Path(h.map((p) => new Vector2(p[0], p[1]))));
  return s;
}

/** Flat fill of regions on a plane (profiles, the face of a hole). */
export function regionGeometry(regions: Region[], f: Frame, lift = 0): BufferGeometry {
  const g = new ShapeGeometry(regions.map(shapeOf), 4);
  g.applyMatrix4(new Matrix4().makeTranslation(0, 0, lift));
  g.applyMatrix4(frameMatrix(f));
  return g;
}

/** Regions swept along the plane normal from `start` to `end` (a live extrude preview). */
export function prismGeometry(regions: Region[], f: Frame, start: number, end: number): BufferGeometry | null {
  const depth = Math.abs(end - start);
  if (depth < 1e-6 || regions.length === 0) return null;
  const g = new ExtrudeGeometry(regions.map(shapeOf), { depth, bevelEnabled: false, curveSegments: 4 });
  g.applyMatrix4(new Matrix4().makeTranslation(0, 0, Math.min(start, end)));
  g.applyMatrix4(frameMatrix(f));
  return g;
}

/** Fat line segments (pairs of points) with one color and width. */
export function lines(points: Vector3[], c: Color, width: number, size: { w: number; h: number }, opts: { dashed?: boolean; onTop?: boolean } = {}): LineSegments2 {
  const g = new LineSegmentsGeometry();
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y, p.z);
  g.setPositions(flat.length ? flat : [0, 0, 0, 0, 0, 0]);
  const m = new LineMaterial({ color: c.getHex(), linewidth: width, worldUnits: false, dashed: opts.dashed === true, dashSize: 3, gapSize: 3, dashScale: 1, depthTest: opts.onTop !== true, transparent: true });
  m.resolution.set(size.w, size.h);
  const l = new LineSegments2(g, m);
  if (opts.dashed === true) l.computeLineDistances();
  l.visible = points.length > 0;
  if (opts.onTop === true) l.renderOrder = 20;
  l.raycast = () => undefined;
  return l;
}

/** Consecutive pairs of a closed or open polyline, as segment endpoints. */
export function polySegments(poly: P2[], f: Frame, closed: boolean, lift = 0): Vector3[] {
  const out: Vector3[] = [];
  const n = poly.length;
  for (let i = 0; i < n - 1; i++) out.push(at(f, poly[i] as P2, lift), at(f, poly[i + 1] as P2, lift));
  if (closed && n > 2) {
    const a = poly[n - 1] as P2;
    const b = poly[0] as P2;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) out.push(at(f, a, lift), at(f, b, lift));
  }
  return out;
}

export function fill(c: Color, opacity: number, onTop = false): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: c, transparent: true, opacity, side: DoubleSide, depthWrite: false, depthTest: !onTop, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/* ---------------------------------------------------------- sketches */

export interface SketchLoop {
  id: string;
  poly: P2[];
  depth: number;
  inside: string | null;
}

export interface SketchOutline {
  name: string;
  frame: Frame;
  loops: SketchLoop[];
  lines: { id: string; from: P2; to: P2 }[];
}

/** The region a profile pick makes: the loop with its direct children cut out. */
export function profileRegion(s: SketchOutline, id: string): Region | null {
  const lp = s.loops.find((l) => l.id === id);
  if (lp === undefined) return null;
  return { outer: lp.poly, holes: s.loops.filter((l) => l.inside === id).map((l) => l.poly) };
}

/** A pickable profile mesh: what a click on a region of a sketch hits. */
export interface ProfileHit {
  sketch: string;
  item: string;
}

/* ---------------------------------------------------------- disposal */

export function disposeObject(o: Object3D): void {
  const any = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
  any.geometry?.dispose();
  const mat = any.material;
  if (Array.isArray(mat)) for (const m of mat) m.dispose();
  else mat?.dispose();
}

export function clearGroup(g: Group): void {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => disposeObject(o));
  }
}

/** Triangles of a plane square, centred, for the origin planes. */
export function squareGeometry(f: Frame, half: number): BufferGeometry {
  const pts = [at(f, [-half, -half]), at(f, [half, -half]), at(f, [half, half]), at(f, [-half, half])];
  const g = new BufferGeometry();
  const pos = new Float32Array(18);
  const order = [0, 1, 2, 0, 2, 3];
  order.forEach((k, i) => {
    const p = pts[k] as Vector3;
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = p.y;
    pos[i * 3 + 2] = p.z;
  });
  g.setAttribute('position', new BufferAttribute(pos, 3));
  return g;
}

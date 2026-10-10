/**
 * The stockroom map's 3D models (three.js): the bases top-level places stand
 * on, the furniture and spaces inside them, and the shapes items take.
 *
 * Every material comes from the theme (the engine sets the colors); the view
 * is a fixed isometric one from the +x, +z side, so walls go on the far (-x,
 * -z) edges and open fronts (cabinet doors, the pulled-out drawer, a
 * container's doors) face the viewer.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Line,
  LineSegments,
  Matrix4,
  Mesh,
  Euler,
  Quaternion,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { LineBasicMaterial, LineDashedMaterial, Material, MeshLambertMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD_T, PLATFORM_H, VAN_BED, centre } from './layout.ts';
import type { Rect, Unit, Zone } from './layout.ts';
import type { ItemShape } from './shapes.ts';

/** The theme-colored materials the models use. */
export interface Mats {
  floor: MeshLambertMaterial;
  row: MeshLambertMaterial;
  card: MeshLambertMaterial;
  ink2: MeshLambertMaterial;
  /** The darker of ink and card: tyres, gaps, shadows in a model. */
  shade: MeshLambertMaterial;
  line: MeshLambertMaterial;
  tub: MeshLambertMaterial;
  kraft: MeshLambertMaterial;
  beam: MeshLambertMaterial;
  steel: MeshLambertMaterial;
  glass: MeshLambertMaterial;
  inset: LineBasicMaterial;
  dash: LineDashedMaterial;
}

/* ------------------------------------------------------------- helpers */

const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r: number, seg = 2): RoundedBoxGeometry => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
const cyl = (r: number, h: number, seg = 22): CylinderGeometry => new CylinderGeometry(r, r, h, seg);

function put(g: Group, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, ry = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A flat outline (optionally dashed) at height y. */
export function flatRect(cx: number, y: number, cz: number, w: number, d: number, r: number, mat: Material, dashed = false): Line {
  const pts: number[] = [];
  const seg = 6;
  const corners = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, Math.PI / 2],
    [-w / 2 + r, -d / 2 + r, Math.PI],
    [w / 2 - r, -d / 2 + r, (3 * Math.PI) / 2],
  ] as const;
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(cx + ox + Math.cos(a) * r, y, cz + oz + Math.sin(a) * r);
    }
  }
  pts.push(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const line = new Line(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
}

/** Floor lines every `step` inside a rectangle (tiles, a grid painted on a slab). */
function floorGrid(r: Rect, y: number, step: number, mat: Material): LineSegments {
  const pts: number[] = [];
  for (let x = r.x + step; x < r.x + r.w - 0.05; x += step) pts.push(x, y, r.z, x, y, r.z + r.d);
  for (let z = r.z + step; z < r.z + r.d - 0.05; z += step) pts.push(r.x, y, z, r.x + r.w, y, z);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return new LineSegments(geo, mat);
}

/** A door panel hinged at (hx, hz), `len` long along +x before it swings by `angle` (radians, about y). */
function door(g: Group, mat: Material, hx: number, y: number, hz: number, len: number, h: number, t: number, angle: number): void {
  const hinge = new Group();
  hinge.position.set(hx, y, hz);
  hinge.rotation.y = angle;
  const p = new Mesh(box(len, h, t), mat);
  p.position.set(len / 2, h / 2, 0);
  p.castShadow = true;
  p.receiveShadow = true;
  hinge.add(p);
  g.add(hinge);
}

/* --------------------------------------------------------------- bases */

/** The base a top-level place stands on. `floorMat` is its own (it lights up when hovered or selected). */
export function buildBase(z: Zone, m: Mats, floorMat: MeshLambertMaterial): Group {
  const g = new Group();
  const r = z.rect;
  const c = centre(r);
  if (z.base === 'van') {
    buildVan(g, r, 0, floorMat, m, true);
    return g;
  }
  if (z.base === 'container') {
    buildContainer(g, r, 0, floorMat, m);
    return g;
  }
  if (z.base === 'warehouse') {
    const t = 0.16;
    put(g, rbox(r.w, t, r.d, 0.05), floorMat, c.x, t / 2, c.z);
    g.add(floorGrid({ x: r.x + 0.2, z: r.z + 0.2, w: r.w - 0.4, d: r.d - 0.4 }, t + 0.002, 1, m.inset));
    const h = 1.55;
    put(g, box(r.w, h, 0.12), m.card, c.x, t + h / 2, r.z + 0.06);
    put(g, box(0.12, h, r.d - 0.12), m.card, r.x + 0.06, t + h / 2, c.z + 0.06);
    put(g, box(r.w, 0.06, 0.15), m.ink2, c.x, t + h + 0.03, r.z + 0.075);
    put(g, box(0.15, 0.06, r.d - 0.12), m.ink2, r.x + 0.075, t + h + 0.03, c.z + 0.06);
    // A roll-up door in the back wall.
    const dw = Math.min(1.4, r.w * 0.35);
    const dx = r.x + r.w * 0.62;
    put(g, box(dw, 1.05, 0.03), m.row, dx, t + 0.525, r.z + 0.135);
    for (let i = 1; i < 7; i++) put(g, box(dw, 0.012, 0.035), m.line, dx, t + i * 0.15, r.z + 0.137);
    put(g, box(dw + 0.08, 0.06, 0.06), m.ink2, dx, t + 1.08, r.z + 0.14);
    return g;
  }
  if (z.base === 'room') {
    const t = 0.12;
    put(g, rbox(r.w, t, r.d, 0.04), floorMat, c.x, t / 2, c.z);
    g.add(floorGrid({ x: r.x, z: r.z, w: r.w, d: r.d }, t + 0.002, 0.5, m.inset));
    const h = 0.95;
    put(g, box(r.w, h, 0.1), m.card, c.x, t + h / 2, r.z + 0.05);
    put(g, box(0.1, h, r.d - 0.1), m.card, r.x + 0.05, t + h / 2, c.z + 0.05);
    // A door in the left wall.
    const dz = r.z + Math.min(r.d - 0.5, 0.9);
    put(g, box(0.03, 0.72, 0.42), m.row, r.x + 0.115, t + 0.36, dz);
    put(g, box(0.04, 0.04, 0.12), m.ink2, r.x + 0.14, t + 0.36, dz + 0.13);
    return g;
  }
  if (z.base === 'area') {
    const t = 0.04;
    put(g, box(r.w, t, r.d), floorMat, c.x, t / 2, c.z);
    g.add(flatRect(c.x, t + 0.003, c.z, r.w - 0.24, r.d - 0.24, 0.02, m.dash, true));
    return g;
  }
  put(g, rbox(r.w, PLATFORM_H, r.d, 0.1, 3), floorMat, c.x, PLATFORM_H / 2, c.z);
  g.add(flatRect(c.x, PLATFORM_H + 0.003, c.z, r.w - 0.3, r.d - 0.3, 0.1, m.inset));
  return g;
}

/** A van: chassis, wheels, a cab at the +x end, a bed with low walls. */
function buildVan(g: Group, r: Rect, b: number, bedMat: Material, m: Mats, whole: boolean): void {
  const cab = whole ? 1.1 : 0.9;
  const bedW = r.w - cab;
  const cz = r.z + r.d / 2;
  const bedX = r.x + bedW / 2;
  put(g, box(r.w - 0.25, 0.22, r.d - 0.3), m.ink2, r.x + r.w / 2, b + 0.36, cz);
  put(g, rbox(bedW, 0.1, r.d, 0.035), bedMat, bedX, b + VAN_BED - 0.05, cz);
  const wall = 0.26;
  put(g, box(bedW, wall, 0.05), m.card, bedX, b + VAN_BED + wall / 2, r.z + 0.025);
  put(g, box(bedW, wall, 0.05), m.card, bedX, b + VAN_BED + wall / 2, r.z + r.d - 0.025);
  put(g, box(0.05, wall, r.d), m.card, r.x + 0.025, b + VAN_BED + wall / 2, cz);
  const cabX = r.x + r.w - cab / 2;
  put(g, rbox(cab - 0.06, 0.95, r.d - 0.06, 0.12, 3), m.card, cabX, b + 0.3 + 0.475, cz);
  put(g, box(0.05, 0.34, r.d - 0.24), m.glass, r.x + r.w - 0.06, b + 0.98, cz);
  put(g, box(0.04, 0.06, 0.06), m.beam, r.x + r.w - 0.04, b + 0.5, r.z + 0.08);
  put(g, box(0.04, 0.06, 0.06), m.beam, r.x + r.w - 0.04, b + 0.5, r.z + r.d - 0.08);
  const tyre = cyl(0.24, 0.16, 22);
  const hub = cyl(0.1, 0.17, 14);
  for (const [wx, wz] of [
    [r.x + 0.65, r.z + 0.06],
    [r.x + 0.65, r.z + r.d - 0.06],
    [r.x + r.w - 0.6, r.z + 0.06],
    [r.x + r.w - 0.6, r.z + r.d - 0.06],
  ] as const) {
    put(g, tyre, m.shade, wx, b + 0.24, wz).rotation.x = Math.PI / 2;
    put(g, hub, m.steel, wx, b + 0.24, wz).rotation.x = Math.PI / 2;
  }
}

/** A shipping container: ribbed walls, a cut-away front, doors swung open at the +x end. */
function buildContainer(g: Group, r: Rect, b: number, floorMat: Material, m: Mats): void {
  const c = centre(r);
  const t = 0.1;
  const h = 1.05;
  put(g, box(r.w, t, r.d), floorMat, c.x, b + t / 2, c.z);
  put(g, box(r.w, h, 0.06), m.beam, c.x, b + h / 2, r.z + 0.03);
  put(g, box(0.06, h, r.d), m.beam, r.x + 0.03, b + h / 2, c.z);
  put(g, box(r.w, 0.3, 0.06), m.beam, c.x, b + 0.15, r.z + r.d - 0.03);
  for (let x = r.x + 0.2; x < r.x + r.w - 0.1; x += 0.24) {
    put(g, box(0.05, h - 0.06, 0.03), m.beam, x, b + h / 2, r.z + 0.07);
    put(g, box(0.05, 0.26, 0.03), m.beam, x, b + 0.15, r.z + r.d - 0.07);
  }
  for (let z = r.z + 0.2; z < r.z + r.d - 0.1; z += 0.24) put(g, box(0.03, h - 0.06, 0.05), m.beam, r.x + 0.07, b + h / 2, z);
  put(g, box(r.w, 0.05, 0.08), m.ink2, c.x, b + h, r.z + 0.04);
  put(g, box(0.08, 0.05, r.d), m.ink2, r.x + 0.04, b + h, c.z);
  // The doors at the +x end, swung open.
  door(g, m.beam, r.x + r.w, b + 0.02, r.z + 0.03, r.d / 2 - 0.02, h - 0.04, 0.04, 0.35);
  door(g, m.beam, r.x + r.w, b + 0.02, r.z + r.d - 0.03, r.d / 2 - 0.02, h - 0.04, 0.04, -0.35);
}

/* --------------------------------------------------------------- units */

/** A place inside a space (or furniture at the top level), drawn by its kind. */
export function buildUnit(u: Unit, m: Mats): Group {
  const g = new Group();
  const { x, z, w, d } = u.rect;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const b = u.base;
  const top = (u.levels[u.levels.length - 1] ?? 0.5) + 0.42;

  if (u.model === 'shelf') {
    const post = box(0.07, top, 0.07);
    for (const [px, pz] of [
      [x + 0.035, z + 0.035],
      [x + w - 0.035, z + 0.035],
      [x + 0.035, z + d - 0.035],
      [x + w - 0.035, z + d - 0.035],
    ] as const) {
      put(g, post, m.ink2, px, b + top / 2, pz);
    }
    put(g, box(w, 0.06, 0.05), m.ink2, cx, b + top - 0.03, z + 0.035);
    put(g, box(w, 0.06, 0.05), m.ink2, cx, b + top - 0.03, z + d - 0.035);
    put(g, box(0.05, 0.06, d), m.ink2, x + 0.035, b + top - 0.03, cz);
    put(g, box(0.05, 0.06, d), m.ink2, x + w - 0.035, b + top - 0.03, cz);
    const board = rbox(w - 0.02, BOARD_T, d - 0.02, 0.012, 1);
    for (const ly of u.levels) put(g, board, m.card, cx, b + ly - BOARD_T / 2, cz);
    return g;
  }

  if (u.model === 'rack') {
    // Pallet racking: steel uprights, colored beams at each level, decking.
    const h = (u.levels[u.levels.length - 1] ?? 1.6) + 0.62;
    const post = box(0.08, h, 0.08);
    const bays = Math.max(1, Math.round((w - 0.1) / 1.3));
    for (let i = 0; i <= bays; i++) {
      const px = x + 0.04 + ((w - 0.08) * i) / bays;
      put(g, post, m.steel, px, b + h / 2, z + 0.04);
      put(g, post, m.steel, px, b + h / 2, z + d - 0.04);
      for (const by of [0.4, 1.2, h - 0.2]) if (by < h) put(g, box(0.03, 0.03, d - 0.08), m.steel, px, b + by, cz);
    }
    const beam = box(w, 0.08, 0.06);
    const deck = box(w - 0.1, 0.02, d - 0.12);
    for (const ly of u.levels) {
      put(g, beam, m.beam, cx, b + ly - 0.05, z + 0.05);
      put(g, beam, m.beam, cx, b + ly - 0.05, z + d - 0.05);
      put(g, deck, m.line, cx, b + ly - 0.01, cz);
    }
    put(g, beam, m.beam, cx, b + h - 0.06, z + 0.05);
    put(g, beam, m.beam, cx, b + h - 0.06, z + d - 0.05);
    return g;
  }

  if (u.model === 'cabinet' || u.model === 'fridge') {
    const fridge = u.model === 'fridge';
    const h = (u.levels[u.levels.length - 1] ?? 0.9) + (fridge ? 0.46 : 0.44);
    const t = 0.035;
    const body = m.card;
    put(g, box(w, h, t), body, cx, b + h / 2, z + t / 2);
    put(g, box(t, h, d), body, x + t / 2, b + h / 2, cz);
    put(g, box(t, h, d), body, x + w - t / 2, b + h / 2, cz);
    put(g, box(w, t, d), body, cx, b + h - t / 2, cz);
    put(g, box(w, 0.05, d), body, cx, b + 0.025, cz);
    for (const ly of u.levels.slice(1)) put(g, box(w - 2 * t, 0.025, d - t - 0.02), fridge ? m.glass : m.row, cx, b + ly - 0.0125, cz - 0.01);
    if (fridge) {
      // A glass door, closed, with a handle; a cold strip along the top.
      put(g, box(w - 0.04, h - 0.12, 0.025), m.glass, cx, b + (h - 0.12) / 2 + 0.06, z + d + 0.0125);
      put(g, box(0.04, h * 0.45, 0.04), m.ink2, x + w - 0.1, b + h * 0.55, z + d + 0.04);
      put(g, box(w, 0.09, d), m.ink2, cx, b + h + 0.045, cz);
    } else {
      // Two doors swung open toward the viewer.
      const leaf = w / 2;
      door(g, m.row, x, b + 0.05, z + d, leaf, h - 0.1, 0.03, -1.95);
      door(g, m.row, x + w, b + 0.05, z + d, leaf, h - 0.1, 0.03, Math.PI + 1.95);
    }
    return g;
  }

  if (u.model === 'drawer') {
    // A drawer unit: two closed drawers and the top one pulled out toward the viewer.
    const body = 0.56;
    const h = 0.8;
    put(g, box(w, h, body), m.card, cx, b + h / 2, z + body / 2);
    for (const fy of [0.15, 0.39]) {
      put(g, box(w - 0.06, 0.2, 0.02), m.row, cx, b + fy, z + body + 0.01);
      put(g, box(0.16, 0.025, 0.03), m.ink2, cx, b + fy + 0.04, z + body + 0.03);
    }
    put(g, box(w - 0.06, 0.22, 0.02), m.shade, cx, b + 0.64, z + body + 0.001);
    const tz = z + body + 0.19;
    const floorY = (u.levels[0] ?? 0.54) - 0.015;
    put(g, box(w - 0.08, 0.03, 0.4), m.row, cx, b + floorY, tz);
    put(g, box(0.02, 0.17, 0.4), m.row, x + 0.05, b + floorY + 0.085, tz);
    put(g, box(0.02, 0.17, 0.4), m.row, x + w - 0.05, b + floorY + 0.085, tz);
    put(g, box(w - 0.04, 0.22, 0.03), m.row, cx, b + floorY + 0.1, z + d - 0.015);
    put(g, box(0.16, 0.025, 0.03), m.ink2, cx, b + floorY + 0.15, z + d + 0.01);
    return g;
  }

  if (u.model === 'tub' || u.model === 'carton') {
    const carton = u.model === 'carton';
    const h = carton ? 0.4 : 0.36;
    const t = carton ? 0.03 : 0.04;
    const mat = carton ? m.kraft : m.tub;
    put(g, box(w, t, d), mat, cx, b + t / 2, cz);
    put(g, box(w, h, t), mat, cx, b + h / 2, z + t / 2);
    put(g, box(w, h, t), mat, cx, b + h / 2, z + d - t / 2);
    put(g, box(t, h, d - 2 * t), mat, x + t / 2, b + h / 2, cz);
    put(g, box(t, h, d - 2 * t), mat, x + w - t / 2, b + h / 2, cz);
    if (carton) {
      // Open flaps folded out over each side.
      const flap = (len: number, hx: number, hz: number, ry: number): void => {
        const hinge = new Group();
        hinge.position.set(hx, b + h, hz);
        hinge.rotation.set(0, ry, 0);
        const tilt = new Group();
        tilt.rotation.x = 0.55;
        const p = new Mesh(box(len, 0.012, 0.2), m.kraft);
        p.position.set(0, 0, -0.1);
        p.castShadow = true;
        tilt.add(p);
        hinge.add(tilt);
        g.add(hinge);
      };
      flap(w, cx, z, 0);
      flap(w, cx, z + d, Math.PI);
      flap(d, x, cz, Math.PI / 2);
      flap(d, x + w, cz, -Math.PI / 2);
    }
    return g;
  }

  if (u.model === 'pallet') {
    put(g, rbox(w, 0.04, d, 0.012, 1), m.kraft, cx, b + 0.13, cz);
    const runner = box(w, 0.09, 0.12);
    for (const rz of [z + 0.08, cz, z + d - 0.08]) put(g, runner, m.line, cx, b + 0.055, rz);
    return g;
  }

  if (u.model === 'room') {
    // A room inside a site: its own floor, two walls and a door.
    const t = 0.06;
    put(g, box(w, t, d), m.row, cx, b + t / 2, cz);
    g.add(floorGrid({ x, z, w, d }, b + t + 0.002, 0.5, m.inset));
    const h = 0.7;
    put(g, box(w, h, 0.08), m.card, cx, b + t + h / 2, z + 0.04);
    put(g, box(0.08, h, d - 0.08), m.card, x + 0.04, b + t + h / 2, cz + 0.04);
    put(g, box(w, 0.03, 0.1), m.ink2, cx, b + t + h + 0.015, z + 0.05);
    put(g, box(0.1, 0.03, d - 0.08), m.ink2, x + 0.05, b + t + h + 0.015, cz + 0.04);
    const dz = z + Math.min(d - 0.4, 0.7);
    put(g, box(0.025, 0.52, 0.34), m.row, x + 0.093, b + t + 0.26, dz);
    return g;
  }

  if (u.model === 'container') {
    buildContainer(g, u.rect, b, m.row, m);
    return g;
  }

  if (u.model === 'van') {
    buildVan(g, u.rect, b, m.row, m, false);
    return g;
  }

  if (u.model === 'deck') {
    put(g, box(w, 0.03, d), m.row, cx, b + 0.015, cz);
    g.add(flatRect(cx, b + 0.033, cz, w - 0.12, d - 0.12, 0.02, m.dash, true));
    return g;
  }

  // plinth (any other place): a low block.
  put(g, rbox(w, 0.12, d, 0.04), m.row, cx, b + 0.06, cz);
  return g;
}

/* --------------------------------------------------------------- items */

/** How a part of an item takes its color: the status color, a darker or lighter shade of it, or a neutral. */
export type Tone = 'body' | 'dark' | 'light' | 'neutral';

export interface Part {
  geo: BufferGeometry;
  tone: Tone;
  /** Where the part sits in the item (origin at the centre of its foot). */
  local: Matrix4;
}

function part(geo: BufferGeometry, tone: Tone, x = 0, y = 0, z = 0, rx = 0, sx = 1, sy = 1, sz = 1): Part {
  return {
    geo,
    tone,
    local: new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, 0, 0)), new Vector3(sx, sy, sz)),
  };
}

function lathe(points: [number, number][]): LatheGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    22,
  );
}

/** Every item shape as parts, built once. */
export function shapeParts(): Record<ItemShape, Part[]> {
  const sole = box(0.145, 0.02, 0.275);
  const shoe = rbox(0.14, 0.11, 0.27, 0.045, 2);
  const disc = cyl(0.12, 0.024, 24);
  const terminal = cyl(0.018, 0.024, 10);
  return {
    crate: [part(rbox(0.34, 0.26, 0.3, 0.035), 'body', 0, 0.13, 0), part(box(0.346, 0.03, 0.306), 'dark', 0, 0.245, 0)],
    carton: [
      part(rbox(0.34, 0.26, 0.3, 0.012, 1), 'body', 0, 0.13, 0),
      part(box(0.07, 0.006, 0.302), 'light', 0, 0.263, 0),
      part(box(0.07, 0.09, 0.006), 'light', 0, 0.215, 0.151),
    ],
    pack: [part(rbox(0.32, 0.17, 0.28, 0.07, 4), 'body', 0, 0.085, 0), part(box(0.3, 0.01, 0.03), 'dark', 0, 0.168, 0)],
    case: [
      part(rbox(0.34, 0.17, 0.22, 0.03), 'body', 0, 0.085, 0),
      part(box(0.346, 0.012, 0.226), 'dark', 0, 0.12, 0),
      part(new TorusGeometry(0.055, 0.012, 8, 18, Math.PI), 'neutral', 0, 0.17, 0),
      part(box(0.03, 0.03, 0.012), 'neutral', -0.1, 0.12, 0.112),
      part(box(0.03, 0.03, 0.012), 'neutral', 0.1, 0.12, 0.112),
    ],
    ream: [part(box(0.32, 0.09, 0.24), 'light', 0, 0.045, 0), part(box(0.322, 0.035, 0.242), 'body', 0, 0.045, 0)],
    pair: [part(shoe, 'body', -0.075, 0.065, 0), part(shoe, 'body', 0.075, 0.065, 0), part(sole, 'dark', -0.075, 0.01, 0), part(sole, 'dark', 0.075, 0.01, 0)],
    roll: [part(cyl(0.09, 0.22, 26), 'body', 0, 0.11, 0), part(cyl(0.036, 0.004, 16), 'dark', 0, 0.222, 0)],
    spool: [part(disc, 'neutral', 0, 0.012, 0), part(disc, 'neutral', 0, 0.208, 0), part(cyl(0.1, 0.172, 24), 'body', 0, 0.11, 0), part(cyl(0.03, 0.006, 12), 'dark', 0, 0.222, 0)],
    sack: [
      part(
        lathe([
          [0, 0],
          [0.1, 0],
          [0.125, 0.025],
          [0.13, 0.1],
          [0.12, 0.16],
          [0.085, 0.2],
          [0.045, 0.215],
          [0.04, 0.225],
          [0.06, 0.245],
          [0, 0.25],
        ]),
        'body',
        0,
        0,
        0,
        0,
        1,
        1,
        0.82,
      ),
      part(new TorusGeometry(0.042, 0.012, 8, 16), 'neutral', 0, 0.217, 0, Math.PI / 2),
    ],
    bottle: [
      part(
        lathe([
          [0, 0],
          [0.06, 0],
          [0.065, 0.012],
          [0.065, 0.17],
          [0.05, 0.21],
          [0.026, 0.235],
          [0.026, 0.262],
          [0, 0.262],
        ]),
        'body',
      ),
      part(cyl(0.067, 0.075, 22), 'light', 0, 0.095, 0),
      part(cyl(0.03, 0.04, 12), 'neutral', 0, 0.28, 0),
    ],
    spray: [
      part(
        lathe([
          [0, 0],
          [0.058, 0],
          [0.062, 0.012],
          [0.062, 0.18],
          [0.045, 0.215],
          [0.03, 0.235],
          [0.03, 0.25],
          [0, 0.25],
        ]),
        'body',
      ),
      part(box(0.07, 0.05, 0.06), 'neutral', 0, 0.272, 0),
      part(box(0.022, 0.022, 0.06), 'neutral', 0, 0.284, 0.05),
      part(box(0.02, 0.06, 0.02), 'neutral', 0, 0.235, 0.045),
    ],
    can: [part(cyl(0.075, 0.15, 24), 'body', 0, 0.075, 0), part(cyl(0.071, 0.016, 24), 'light', 0, 0.158, 0)],
    cell: [
      part(rbox(0.2, 0.18, 0.12, 0.02), 'body', 0, 0.09, 0),
      part(box(0.202, 0.05, 0.122), 'light', 0, 0.1, 0),
      part(terminal, 'neutral', -0.05, 0.19, 0),
      part(terminal, 'neutral', 0.05, 0.19, 0),
    ],
  };
}

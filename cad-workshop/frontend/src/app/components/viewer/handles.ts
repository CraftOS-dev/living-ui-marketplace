/**
 * Drag handles on the model, the direct-manipulation part of every tool:
 * arrows that slide along a line (an extrude's distance, a fillet's radius,
 * a face being pulled) and points that slide on a plane (a hole's position).
 * Handles keep a constant size on screen, draw on top of the model, and
 * turn the pointer into a value: the distance along the arrow, or the point
 * on the plane.
 */
import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Plane, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Camera, Color, Ray } from 'three';
import { clearGroup } from './overlays.ts';
import type { P3 } from './overlays.ts';

export interface ArrowHandle {
  kind: 'arrow';
  id: string;
  /** Where the value is measured from. */
  origin: P3;
  /** Unit direction the value grows in. */
  dir: P3;
  /** Current value: the tip sits at origin + dir * value. */
  value: number;
  /** Optional limits the drag respects. */
  min?: number;
  max?: number;
  /** Screen pixels the arrow reaches beyond its value (a move gizmo stays visible at 0). */
  lead?: number;
  /** Color role: the accent, or an axis color. */
  tone?: 'accent' | 'x' | 'y' | 'z';
}

export interface PointHandle {
  kind: 'point';
  id: string;
  /** Current position, on the plane through it with this normal. */
  at: P3;
  normal: P3;
  tone?: 'accent' | 'x' | 'y' | 'z';
}

export type HandleSpec = ArrowHandle | PointHandle;

export interface HandleColors {
  accent: Color;
  x: Color;
  y: Color;
  z: Color;
  hover: Color;
  shaft: Color;
}

interface Built {
  spec: HandleSpec;
  group: Group;
  head: Mesh;
  shaft: Mesh | null;
  hit: Mesh;
}

const UP = new Vector3(0, 1, 0);

export class HandleLayer {
  readonly group = new Group();
  private built: Built[] = [];
  private hover: string | null = null;
  private colors: HandleColors;

  constructor(colors: HandleColors) {
    this.colors = colors;
    this.group.renderOrder = 30;
  }

  setColors(c: HandleColors): void {
    this.colors = c;
    this.paint();
  }

  get specs(): HandleSpec[] {
    return this.built.map((b) => b.spec);
  }

  set(specs: HandleSpec[]): void {
    // Rebuild only when the set of handles changes; a new value just moves them.
    const sameIds = specs.length === this.built.length && specs.every((s, i) => this.built[i]?.spec.id === s.id && this.built[i]?.spec.kind === s.kind);
    if (!sameIds) {
      clearGroup(this.group);
      this.built = specs.map((s) => this.make(s));
    } else {
      specs.forEach((s, i) => {
        const b = this.built[i];
        if (b !== undefined) b.spec = s;
      });
    }
    this.paint();
  }

  private material(): MeshBasicMaterial {
    return new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true });
  }

  private make(spec: HandleSpec): Built {
    const g = new Group();
    const head = spec.kind === 'arrow' ? new Mesh(new ConeGeometry(0.42, 1.25, 20), this.material()) : new Mesh(new SphereGeometry(0.5, 20, 14), this.material());
    head.renderOrder = 32;
    let shaft: Mesh | null = null;
    if (spec.kind === 'arrow') {
      shaft = new Mesh(new CylinderGeometry(0.08, 0.08, 1, 8), this.material());
      shaft.renderOrder = 31;
      g.add(shaft);
    }
    // A generous invisible target, so the handle is easy to grab.
    const hit = new Mesh(new SphereGeometry(1.15, 10, 8), new MeshBasicMaterial({ visible: false }));
    hit.userData['handle'] = spec.id;
    g.add(head, hit);
    this.group.add(g);
    return { spec, group: g, head, shaft, hit };
  }

  private tone(spec: HandleSpec): Color {
    const t = spec.tone ?? 'accent';
    return this.colors[t];
  }

  private paint(): void {
    for (const b of this.built) {
      const c = b.spec.id === this.hover ? this.colors.hover : this.tone(b.spec);
      (b.head.material as MeshBasicMaterial).color = c;
      if (b.shaft !== null) (b.shaft.material as MeshBasicMaterial).color = this.colors.shaft;
    }
  }

  setHover(id: string | null): boolean {
    if (id === this.hover) return false;
    this.hover = id;
    this.paint();
    return true;
  }

  /** Lay the handles out for this camera: `px` is world units per screen pixel at a point. */
  layout(px: (p: Vector3) => number): void {
    for (const b of this.built) {
      const s = b.spec;
      if (s.kind === 'arrow') {
        const o = new Vector3(...s.origin);
        const d = new Vector3(...s.dir).normalize();
        const lead = px(o) * (s.lead ?? 0);
        const tip = o.clone().addScaledVector(d, s.value + lead);
        const unit = px(tip) * 14;
        const q = new Quaternion().setFromUnitVectors(UP, d);
        b.head.quaternion.copy(q);
        b.head.scale.setScalar(unit);
        // The head sits just beyond the tip, pointing on.
        b.head.position.copy(tip).addScaledVector(d, unit * 0.62);
        b.hit.position.copy(b.head.position);
        b.hit.scale.setScalar(unit);
        if (b.shaft !== null) {
          const reach = s.value + lead;
          const len = Math.abs(reach);
          const shaftUnit = px(o.clone().addScaledVector(d, reach / 2)) * 14;
          b.shaft.visible = len > 1e-6;
          b.shaft.quaternion.copy(q);
          b.shaft.scale.set(shaftUnit, Math.max(len, 1e-6), shaftUnit);
          b.shaft.position.copy(o).addScaledVector(d, reach / 2);
        }
      } else {
        const p = new Vector3(...s.at);
        const unit = px(p) * 12;
        b.head.position.copy(p);
        b.head.scale.setScalar(unit);
        b.hit.position.copy(p);
        b.hit.scale.setScalar(unit);
      }
    }
  }

  /** Where each handle's label goes: just past an arrow's head, beside a point. */
  labelAnchor(id: string, px: (p: Vector3) => number): Vector3 | null {
    const b = this.built.find((x) => x.spec.id === id);
    if (b === undefined) return null;
    const s = b.spec;
    if (s.kind === 'arrow') {
      const d = new Vector3(...s.dir).normalize();
      const o = new Vector3(...s.origin);
      const tip = o.clone().addScaledVector(d, s.value + px(o) * (s.lead ?? 0));
      return tip.addScaledVector(d, px(tip) * 30);
    }
    return new Vector3(...s.at);
  }

  hitTargets(): Mesh[] {
    return this.built.map((b) => b.hit);
  }

  clear(): void {
    clearGroup(this.group);
    this.built = [];
    this.hover = null;
  }
}

/** The value along an arrow's line closest to a pointer ray. */
export function valueOnArrow(spec: ArrowHandle, ray: Ray): number {
  const o = new Vector3(...spec.origin);
  const d = new Vector3(...spec.dir).normalize();
  // Closest points between the handle line (o + t d) and the ray (r0 + s r).
  const r0 = ray.origin;
  const r = ray.direction;
  const w = o.clone().sub(r0);
  const a = d.dot(d);
  const b = d.dot(r);
  const c = r.dot(r);
  const dd = d.dot(w);
  const e = r.dot(w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return spec.value;
  return (b * e - c * dd) / den;
}

/** Where a pointer ray meets a point handle's plane, or null when parallel. */
export function pointOnPlane(spec: PointHandle, ray: Ray): Vector3 | null {
  const n = new Vector3(...spec.normal).normalize();
  const plane = new Plane().setFromNormalAndCoplanarPoint(n, new Vector3(...spec.at));
  const out = new Vector3();
  return ray.intersectPlane(plane, out);
}

export function cameraIsOrtho(c: Camera): boolean {
  return (c as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
}

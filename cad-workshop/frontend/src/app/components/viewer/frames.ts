/**
 * Sketch-plane frames without three.js, so pages can use them without
 * loading the 3D engine: points, the frame type and the three base planes
 * (matching the engine's geom.BASE_PLANES: u right, v up seen from the
 * normal's side).
 */
export type P2 = [number, number];
export type P3 = [number, number, number];

/** A sketch plane, as the engine reports it (origin, right, up, normal). */
export interface Frame {
  origin: P3;
  u: P3;
  v: P3;
  normal: P3;
}

export const BASE_FRAMES: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
};

/** A base plane moved along its normal. */
export function offsetFrame(f: Frame, d: number): Frame {
  return { ...f, origin: [f.origin[0] + f.normal[0] * d, f.origin[1] + f.normal[1] * d, f.origin[2] + f.normal[2] * d] };
}

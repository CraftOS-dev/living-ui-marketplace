/**
 * The engine's view.bin (engine/cad_engine/mesh.py): one triangle mesh with
 * a range per face, and a polyline per edge, in topology order, so a picked
 * triangle or line segment maps straight to its face or edge key.
 *
 *   4 bytes "CWV1", uint32 header length, header JSON (space padded),
 *   float32 positions, float32 normals, uint32 indices, float32 edge points
 */

export interface ViewHeader {
  version: number;
  nv: number;
  nt: number;
  nep: number;
  /** [first triangle, triangle count, body index] per face. */
  faces: [number, number, number][];
  /** [first point, point count] per edge polyline. */
  edges: [number, number][];
  bodies: string[];
  bbox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } | null;
}

export interface ViewData {
  header: ViewHeader;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edgePoints: Float32Array;
}

export function parseView(buf: ArrayBuffer): ViewData {
  const bytes = new Uint8Array(buf, 0, 4);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic !== 'CWV1') throw new Error('Not a CAD Workshop view file');
  const dv = new DataView(buf);
  const hlen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen))) as ViewHeader;
  let off = 8 + hlen;
  const positions = new Float32Array(buf, off, header.nv * 3);
  off += header.nv * 12;
  const normals = new Float32Array(buf, off, header.nv * 3);
  off += header.nv * 12;
  const indices = new Uint32Array(buf, off, header.nt * 3);
  off += header.nt * 12;
  const edgePoints = new Float32Array(buf, off, header.nep * 3);
  return { header, positions, normals, indices, edgePoints };
}

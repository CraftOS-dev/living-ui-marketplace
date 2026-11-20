/**
 * The office campus (home-reports): one single-storey cutaway building per
 * entity (front and right walls taken off, open roof), side by side on a
 * shared ground like a small campus, head office first, seen through an
 * orthographic isometric camera. Its own chunk, loaded by globe.tsx when the
 * viewer picks "Office".
 *
 *   - Rooms per department behind low glass partitions; one desk per person
 *     in neat rows. In now: a figure at the desk, screen on. Remote: an empty
 *     chair and a teal desk lamp. On leave: chair tucked in, an amber card on
 *     the desk. Not in: a dim desk. Someone who clocked in a few minutes ago
 *     walks in from the lobby to their desk.
 *   - Each office's light follows its real local time: daylight
 *     through the windows, warm desk lamps in the evening, mostly dark at night.
 *   - Crafted like a premium isometric drawing: soft key light from the front
 *     left with gentle shadows, four tones by facing (top, front, side, cut),
 *     thin edge lines on the structure, every colour from the --hr-* tokens,
 *     calm eased motion (a slight typing bob, a plant leaf sway). People are
 *     low-poly figures with human proportions (head and hair, neck, torso,
 *     jointed arms and legs, hands, shoes), coloured per person (steady by id)
 *     in muted tones; arrivals walk with a jointed stride, arm swing and bob.
 *   - Explorable like a map: a left drag (one finger) pans, the wheel or a
 *     pinch zooms toward the pointer (the pinch centre), a right drag or Shift
 *     with a drag turns within a small angle, a double click resets the view.
 *     Panning stays over the campus; a drag never counts as a click.
 *     Hovering an office shows its tooltip (it never moves); hovering a desk
 *     lights that desk, its chair and its person with a soft accent glow and a
 *     halo ring on the floor, and shows the person's tooltip. A click (a second tap) picks: an office opens
 *     its people, a person their profile.
 *
 * Instanced meshes per floor keep 300 people smooth. Reduced motion: no
 * walking or idle motion, frames only on change. The loop runs only while on
 * screen and the page is visible; DPR at most 2; everything is disposed.
 */
import { AmbientLight, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage, EdgesGeometry, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, NotEqualStencilFunc, Object3D, OrthographicCamera, PCFShadowMap, PlaneGeometry, Quaternion, Ray, Raycaster, ReplaceStencilOp, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, Box3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { disposeTree, mixRGB, onTheme, readPalette, srgb } from './scene3d.ts';
import type { Palette, RGB, SceneEvents, SceneHandle } from './scene3d.ts';

/* ------------------------------------------------------------------ types */

export type DeskState = 'in_now' | 'remote' | 'on_leave' | 'late' | 'not_in' | 'unknown';

export interface OfficeSceneFloor {
  /** 'f:<entity id>' */
  key: string;
  timezone: string;
  rooms: { key: string; people: { key: string; state: DeskState; since: number | null }[] }[];
}

export interface OfficeSceneData {
  floors: OfficeSceneFloor[];
  /** Offices not drawn (past eight floors). */
  more: number;
}

export type OfficeHandle = SceneHandle<OfficeSceneData>;

/** An office's name plate: its country code, then a small clock and its local time. */
export interface Plate {
  code: string;
  time: string;
}

/* -------------------------------------------------------------- dimensions */

const COL = 0.68; // desk pitch along x
const ROW = 0.86; // row pitch along z
const Z0 = 0.62; // first row's desk centre
const CHAIR_OUT = 0.33; // chair behind the desk, pulled out
const CHAIR_IN = 0.2; // tucked in
const ROOM_PAD = 0.16;
const X0 = 1.02; // rooms start after the lobby
const SLAB = 0.09;
const WALL = 0.06;
const FH = 1.15; // a single storey, open roof
const MAX_FLOORS = 8;
const WALK_MIN = 6; // clocked in this recently: walks in from the lobby
const WALK_SPEED = 0.55;
const UP = new Vector3(0, 1, 0);

/* ------------------------------------------------------------- utilities */

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lin(c: RGB): [number, number, number] {
  const k = new Color().setRGB(c[0], c[1], c[2], SRGBColorSpace);
  return [k.r, k.g, k.b];
}

/** A geometry painted one colour (vertex colours, linear), so many parts merge into one mesh. */
function paint(g: BufferGeometry, c: RGB): BufferGeometry {
  const [r, gg, b] = lin(c);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = r;
    a[i * 3 + 1] = gg;
    a[i * 3 + 2] = b;
  }
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}

/** A box by its min corner and size. */
function box(x: number, y: number, z: number, w: number, h: number, d: number, c: RGB): BufferGeometry {
  return paint(new BoxGeometry(w, h, d).translate(x + w / 2, y + h / 2, z + d / 2), c);
}

/** A box by its centre and size. */
function boxC(x: number, y: number, z: number, w: number, h: number, d: number, c: RGB): BufferGeometry {
  return paint(new BoxGeometry(w, h, d).translate(x, y, z), c);
}

function cyl(x: number, y: number, z: number, r: number, h: number, c: RGB, seg = 14, r2?: number): BufferGeometry {
  return paint(new CylinderGeometry(r2 ?? r, r, h, seg).translate(x, y + h / 2, z), c);
}

function merge(list: BufferGeometry[]): BufferGeometry {
  const m = mergeGeometries(list.map((g) => (g.index === null ? g : g.toNonIndexed())), false);
  for (const g of list) g.dispose();
  return m ?? new BoxGeometry(0.001, 0.001, 0.001);
}

/** The hour (with fraction) in a time zone now. */
function hourIn(zone: string): number {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const h = Number(p.find((x) => x.type === 'hour')?.value ?? 12);
    const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
    return h + m / 60;
  } catch {
    return 12;
  }
}

/** Daylight, evening and night shares for a local hour. */
function phaseOf(h: number): { day: number; eve: number; night: number } {
  const day = smooth(6, 7.6, h) * (1 - smooth(17.4, 19, h));
  const eve = (1 - day) * smooth(16.5, 18.6, h) * (1 - smooth(22, 23.6, h));
  return { day, eve, night: Math.max(0, 1 - day - eve) };
}

/* ------------------------------------------------------------- the parts */

interface Kit {
  desk: BufferGeometry;
  chair: BufferGeometry;
  /** The seated figure in five parts, one colour each: skin, hair, top, trousers, shoes. */
  seatSkin: BufferGeometry;
  seatHair: BufferGeometry;
  seatTop: BufferGeometry;
  seatBottom: BufferGeometry;
  seatShoes: BufferGeometry;
  screen: BufferGeometry;
  bulb: BufferGeometry;
  glow: BufferGeometry;
  card: BufferGeometry;
  leaf: BufferGeometry;
  /** The standing figure's parts (limbs hang from their joint at the origin). */
  wTorso: BufferGeometry;
  wPelvis: BufferGeometry;
  wHead: BufferGeometry;
  wHair: BufferGeometry;
  wThigh: BufferGeometry;
  wShin: BufferGeometry;
  wFoot: BufferGeometry;
  wUpper: BufferGeometry;
  wFore: BufferGeometry;
  wHand: BufferGeometry;
  /** Hulls (smooth normals) of a desk, a chair and a seated person, for the hover glow. */
  deskHull: BufferGeometry;
  chairHull: BufferGeometry;
  seatHull: BufferGeometry;
}

const WHITE: RGB = [1, 1, 1];

/** A limb segment from a to b, tapering r0 to r1, low-poly. */
function seg(a: [number, number, number], b: [number, number, number], r0: number, r1: number, sides = 7): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(r1, r0, len, sides, 1, false);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return paint(g, WHITE);
}

function ball(x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  return paint(new IcosahedronGeometry(r, 1).scale(sx, sy, sz).translate(x, y, z), WHITE);
}

function head(y: number, z: number): BufferGeometry {
  return paint(new IcosahedronGeometry(0.05, 1).scale(1, 1.13, 1.06).translate(0, y, z), WHITE);
}

/** Hair: a cap over the crown and the back of the head (the figure faces -z seated, +z standing). */
function hair(y: number, z: number, back: 1 | -1): BufferGeometry {
  return paint(new SphereGeometry(0.0548, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(1, 1.12, 1.08).rotateX(0.45 * back).translate(0, y + 0.004, z + 0.004 * back), WHITE);
}

/** A copy for the glow: positions only, shared vertices, smooth normals (so the pushed-out hull has no gaps). */
function hullOf(g: BufferGeometry): BufferGeometry {
  const h = new BufferGeometry();
  h.setAttribute('position', g.getAttribute('position').clone());
  const m = mergeVertices(h, 1e-4);
  h.dispose();
  m.computeVertexNormals();
  return m;
}

/** The furniture and figures, built once per palette (desk faces -z: the person sits on its +z side, facing the back wall). */
function makeKit(p: Palette): Kit {
  const top = p.dark ? mixRGB(p.raised, p.line2, 0.35) : mixRGB(p.raised, p.panel, 0.4);
  const side = p.dark ? mixRGB(p.line, p.line2, 0.5) : mixRGB(p.line2, p.line, 0.4);
  const metal = p.dark ? mixRGB(p.muted, p.line2, 0.5) : mixRGB(p.ink2, p.muted, 0.5);
  const dark = p.dark ? mixRGB(p.ink, p.page, 0.82) : mixRGB(p.ink, p.ink2, 0.3);
  const paper = p.dark ? mixRGB(p.ink, p.page, 0.25) : mixRGB(p.raised, p.page, 0.3);
  const desk = merge([
    boxC(0, 0.335, 0, 0.56, 0.026, 0.3, top),
    boxC(-0.262, 0.161, 0, 0.022, 0.322, 0.28, side),
    boxC(0.262, 0.161, 0, 0.022, 0.322, 0.28, side),
    boxC(0, 0.24, -0.128, 0.5, 0.16, 0.012, side),
    // monitor on a stand at the back edge, keyboard and mouse at the front
    boxC(0, 0.352, -0.085, 0.09, 0.008, 0.06, metal),
    cyl(0, 0.355, -0.088, 0.011, 0.09, metal, 10),
    boxC(0, 0.5, -0.1, 0.27, 0.165, 0.014, dark),
    boxC(0, 0.352, 0.07, 0.18, 0.009, 0.058, metal),
    boxC(0.15, 0.351, 0.075, 0.03, 0.009, 0.045, metal),
    // lamp: base, stem, arm, shade
    cyl(-0.22, 0.348, -0.09, 0.024, 0.01, metal, 14),
    cyl(-0.22, 0.358, -0.09, 0.006, 0.17, metal, 8),
    boxC(-0.19, 0.53, -0.075, 0.07, 0.008, 0.008, metal),
    cyl(-0.155, 0.49, -0.06, 0.036, 0.04, metal, 14, 0.012),
    // a mug and a sheet of paper
    cyl(0.205, 0.348, -0.02, 0.019, 0.036, side, 12),
    boxC(-0.2, 0.3495, 0.03, 0.075, 0.003, 0.1, paper),
  ]);
  // An office chair: five-star base on casters, gas lift, seat pan and cushion, a reclined back on its spine, armrests.
  const seat = p.dark ? mixRGB(p.ink2, p.page, 0.55) : mixRGB(p.ink, p.ink2, 0.6);
  const chairParts: BufferGeometry[] = [cyl(0, 0.026, 0, 0.022, 0.022, metal, 10), cyl(0, 0.048, 0, 0.013, 0.13, metal, 10), boxC(0, 0.172, 0, 0.15, 0.014, 0.14, metal), boxC(0, 0.196, 0, 0.22, 0.034, 0.21, seat)];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    chairParts.push(paint(new BoxGeometry(0.1, 0.012, 0.018).translate(0.05, 0.032, 0).rotateY(a), metal));
    chairParts.push(paint(new SphereGeometry(0.013, 8, 6).translate(0.098, 0.013, 0).rotateY(a), dark));
  }
  chairParts.push(boxC(0, 0.25, 0.104, 0.03, 0.1, 0.018, metal), paint(new BoxGeometry(0.2, 0.2, 0.026).rotateX(0.12).translate(0, 0.345, 0.115), seat));
  for (const x of [-0.115, 0.115]) chairParts.push(boxC(x, 0.24, 0.0, 0.016, 0.07, 0.016, metal), boxC(x, 0.278, -0.005, 0.026, 0.012, 0.12, seat));
  const chair = merge(chairParts);
  // Seated, facing -z: hips on the cushion, thighs forward under the desk, shins down, forearms on the desk, hands at the keyboard.
  const seatSkin = merge([head(0.608, 0.0), seg([0, 0.49, 0.006], [0, 0.565, 0.0], 0.021, 0.019), ball(-0.06, 0.364, -0.205, 0.016), ball(0.06, 0.364, -0.205, 0.016), paint(new BoxGeometry(0.03, 0.013, 0.048).rotateY(0.18).translate(-0.056, 0.362, -0.238), WHITE), paint(new BoxGeometry(0.03, 0.013, 0.048).rotateY(-0.18).translate(0.056, 0.362, -0.238), WHITE)]);
  const seatHair = hair(0.608, 0.0, 1);
  const seatTop = merge([
    paint(new CylinderGeometry(0.083, 0.063, 0.22, 8).scale(1, 1, 0.62).rotateX(-0.09).translate(0, 0.38, 0.005), WHITE),
    ball(-0.084, 0.484, 0.0, 0.03),
    ball(0.084, 0.484, 0.0, 0.03),
    seg([-0.09, 0.485, 0.0], [-0.096, 0.386, -0.07], 0.025, 0.021),
    seg([0.09, 0.485, 0.0], [0.096, 0.386, -0.07], 0.025, 0.021),
    ball(-0.096, 0.386, -0.07, 0.021),
    ball(0.096, 0.386, -0.07, 0.021),
    seg([-0.096, 0.384, -0.07], [-0.062, 0.367, -0.2], 0.02, 0.016),
    seg([0.096, 0.384, -0.07], [0.062, 0.367, -0.2], 0.02, 0.016),
  ]);
  const seatBottom = merge([
    ball(0, 0.265, 0.01, 1, 0.077, 0.046, 0.062),
    seg([-0.045, 0.255, 0.0], [-0.05, 0.262, -0.185], 0.037, 0.03),
    seg([0.045, 0.255, 0.0], [0.05, 0.262, -0.185], 0.037, 0.03),
    ball(-0.05, 0.262, -0.185, 0.029),
    ball(0.05, 0.262, -0.185, 0.029),
    seg([-0.05, 0.262, -0.185], [-0.052, 0.045, -0.2], 0.027, 0.021),
    seg([0.05, 0.262, -0.185], [0.052, 0.045, -0.2], 0.027, 0.021),
  ]);
  const seatShoes = merge([boxC(-0.053, 0.021, -0.226, 0.043, 0.042, 0.092, WHITE), boxC(0.053, 0.021, -0.226, 0.043, 0.042, 0.092, WHITE)]);
  const seatAll = merge([seatSkin.clone(), seatHair.clone(), seatTop.clone(), seatBottom.clone(), seatShoes.clone()]);
  const seatHull = hullOf(seatAll);
  seatAll.dispose();
  return {
    desk,
    chair,
    seatSkin,
    seatHair,
    seatTop,
    seatBottom,
    seatShoes,
    screen: new PlaneGeometry(0.25, 0.145).translate(0, 0.5, -0.0925),
    bulb: new SphereGeometry(0.014, 10, 8).translate(-0.155, 0.49, -0.06),
    glow: new CircleGeometry(0.12, 32).rotateX(-Math.PI / 2).translate(-0.15, 0.3505, -0.04),
    card: merge([boxC(0.2, 0.372, 0.108, 0.075, 0.042, 0.006, p.warn), boxC(0.2, 0.351, 0.095, 0.075, 0.004, 0.03, mixRGB(p.warn, p.ink, 0.25))]),
    leaf: paint(new SphereGeometry(1, 10, 8).scale(0.035, 0.13, 0.016).translate(0, 0.12, 0), mixRGB(p.good, p.muted, p.dark ? 0.25 : 0.35)),
    // Standing, facing +z: hips at 0.42, shoulders at 0.66, head top at 0.82.
    wTorso: merge([paint(new CylinderGeometry(0.083, 0.064, 0.24, 8).scale(1, 1, 0.62).translate(0, 0.55, 0), WHITE), ball(-0.085, 0.662, 0, 0.03), ball(0.085, 0.662, 0, 0.03)]),
    wPelvis: ball(0, 0.432, 0, 1, 0.077, 0.05, 0.062),
    wHead: merge([head(0.765, 0.0), seg([0, 0.66, 0], [0, 0.725, 0], 0.021, 0.019)]),
    wHair: hair(0.765, 0.0, -1),
    wThigh: merge([seg([0, 0, 0], [0, -0.19, 0], 0.037, 0.03), ball(0, -0.19, 0, 0.029)]),
    wShin: seg([0, 0, 0], [0, -0.2, 0], 0.027, 0.021),
    wFoot: boxC(0, -0.212, 0.022, 0.043, 0.04, 0.092, WHITE),
    wUpper: merge([seg([0, 0, 0], [0, -0.135, 0], 0.025, 0.021), ball(0, -0.135, 0, 0.021)]),
    wFore: seg([0, 0, 0], [0, -0.12, 0], 0.02, 0.016),
    wHand: merge([ball(0, -0.122, 0, 0.016), paint(new BoxGeometry(0.014, 0.048, 0.03).translate(0, -0.15, 0), WHITE)]),
    deskHull: hullOf(desk),
    chairHull: hullOf(chair),
    seatHull,
  };
}

/** A person's look, steady by their id: skin, hair, top, trousers and shoes in muted tones, the top taken from the theme. */
function lookOf(id: string, p: Palette): RGB[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const pickOf = <T,>(list: T[], shift: number): T => list[((h >>> shift) & 0xff) % list.length] as T;
  const grey: RGB = [0.6, 0.6, 0.62];
  const toward = (c: RGB): RGB => mixRGB(c, p.page, 0.1);
  const skin: RGB[] = [[0.95, 0.8, 0.69], [0.89, 0.71, 0.57], [0.78, 0.58, 0.43], [0.62, 0.44, 0.31], [0.45, 0.31, 0.22]];
  const hairs: RGB[] = [[0.12, 0.1, 0.09], [0.27, 0.18, 0.12], [0.44, 0.29, 0.17], [0.6, 0.5, 0.37], [0.55, 0.55, 0.56], [0.19, 0.15, 0.14]];
  const tops: RGB[] = [mixRGB(p.rh, grey, 0.45), mixRGB(p.lh, grey, 0.5), mixRGB(p.warn, grey, 0.6), mixRGB(p.good, grey, 0.62), mixRGB(p.rh, [0.12, 0.13, 0.16], 0.55), [0.88, 0.87, 0.84], [0.52, 0.53, 0.56]];
  const bottoms: RGB[] = [[0.16, 0.17, 0.2], [0.22, 0.26, 0.36], [0.4, 0.36, 0.3], [0.29, 0.29, 0.3]];
  const shoes: RGB[] = [[0.1, 0.09, 0.09], [0.33, 0.23, 0.16], [0.82, 0.81, 0.79]];
  return [toward(pickOf(skin, 0)), toward(pickOf(hairs, 8)), toward(pickOf(tops, 16)), toward(pickOf(bottoms, 24)), toward(pickOf(shoes, 4))];
}

/* ---------------------------------------------------------------- shaders */

const SPOT_VS = `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #endif
  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #endif
}`;

/** A soft round pool (lamp light, the halo): colour from the instance, strength in its brightness. */
const POOL_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv; varying vec3 vColor;
void main() {
  float r = length(vUv - vec2(0.5)) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.0);
  float k = max(vColor.r, max(vColor.g, vColor.b));
  if (k <= 0.001) discard;
  gl_FragColor = vec4(uColor * vColor / k, a * uAlpha * k);
}`;

/**
 * The hover glow: the hull pushed out along its smooth normals, back faces
 * only, in the accent at a low alpha. Three shells (near, mid, far), each
 * blended once per pixel (stencil), stack into a soft edge that fades out.
 */
const HULL_VS = `
uniform float uThick;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uThick, 1.0);
}`;

const HULL_FS = `
uniform vec3 uColor; uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor, uAlpha); }`;

/** The hover halo on the floor: a soft accent ring with a faint pool inside. */
const RING_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - vec2(0.5)) * 2.0;
  float ring = exp(-pow((r - 0.8) / 0.1, 2.0));
  float pool = 0.3 * (1.0 - smoothstep(0.0, 0.85, r));
  float a = (ring + pool) * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** Daylight through the windows: strongest at the glass, gone a metre in. */
const DAY_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv; varying vec3 vColor;
void main() {
  float a = pow(vUv.y, 1.8) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  gl_FragColor = vec4(uColor, a * uAlpha);
}`;

/* ---------------------------------------------------------------- plates */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An office's plate: the country code, a small clock (lucide's Clock, drawn at the label's size), the local time. */
function makePlate(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'hr-label pointer-events-none absolute left-0 top-0 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[3px] border border-[var(--hr-hair)] bg-[color-mix(in_srgb,var(--hr-raised)_88%,transparent)] px-1.5 leading-[18px] !text-[var(--hr-ink-2)]';
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '10'], ['height', '10'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2.4'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']] as const) svg.setAttribute(k, v);
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  const hands = document.createElementNS(SVG_NS, 'path');
  hands.setAttribute('d', 'M12 6v6l4 2');
  svg.append(circle, hands);
  el.append(document.createElement('span'), svg, document.createElement('span'));
  return el;
}

function writePlate(el: HTMLDivElement, v: Plate): void {
  const [code, clock, time] = [...el.children] as [HTMLElement, SVGElement, HTMLElement];
  code.textContent = v.code;
  code.style.display = v.code === '' ? 'none' : '';
  clock.style.display = v.time === '' ? 'none' : '';
  time.textContent = v.time;
}

/* ------------------------------------------------------------- the floors */

interface Desk {
  key: string;
  floor: number;
  state: DeskState;
  since: number | null;
  x: number;
  z: number;
  room: { x0: number; x1: number; z0: number; z1: number };
  row: number;
  band: number;
  phase: number;
  walking: boolean;
}

/** One office's plan: rooms in one or two bands (back, front) along a corridor, desks row by row. */
interface Plan {
  desks: Desk[];
  rooms: { x0: number; x1: number; z0: number; z1: number }[];
  end: number;
  w: number;
  d: number;
  rows: number;
  bands: number;
  corridors: number[];
}

interface FloorView {
  key: string;
  zone: string;
  group: Group;
  base: number;
  lift: number;
  liftTo: number;
  desks: Desk[];
  w: number;
  d: number;
  rows: number;
  bands: number;
  corridors: number[];
  /** Big offices are drawn smaller so the small ones stay readable. */
  scale: number;
  halo: Mesh;
  deskMesh: InstancedMesh;
  chairMesh: InstancedMesh;
  /** The seated figure: skin, hair, top, trousers, shoes. */
  people: InstancedMesh[];
  screenMesh: InstancedMesh;
  bulbMesh: InstancedMesh;
  glowMesh: InstancedMesh;
  cardMesh: InstancedMesh;
  leafMesh: InstancedMesh | null;
  leaves: { x: number; z: number; a: number; tilt: number; phase: number }[];
  mats: { solid: MeshLambertMaterial; inst: MeshLambertMaterial[]; window: MeshBasicMaterial; day: ShaderMaterial; glow: ShaderMaterial };
  windows: Mesh;
  plate: HTMLDivElement;
  /** Interior light by the local hour (multiplies every lit surface). */
  light: number;
  /** Warm desk lamps after dark, 0..1. */
  warm: number;
}

interface Walker {
  floor: number;
  desk: number;
  group: Group;
  body: Group;
  legs: [Object3D, Object3D];
  knees: [Object3D, Object3D];
  arms: [Object3D, Object3D];
  elbows: [Object3D, Object3D];
  mats: MeshLambertMaterial[];
  path: Vector3[];
  seg: number;
  t: number;
  wait: number;
  started: boolean;
}

/**
 * Build the campus into `host`, with plates in `labels` and the tooltip
 * `anchor` moved over the focused office or desk. `plate(key)` gives an
 * office's name plate (country code and local time); `more(n)` the plate for
 * offices not drawn. Throws when WebGL cannot start.
 */
export async function createOffice(opts: { host: HTMLElement; labels: HTMLElement; anchor: HTMLElement; data: OfficeSceneData; reduced: boolean; events: SceneEvents; plate: (key: string) => Plate; more: (n: number) => string }): Promise<OfficeHandle> {
  const { host, labels, anchor, events } = opts;
  // The stencil keeps each glow shell to one blend per pixel.
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const ambient = new AmbientLight(0xffffff, 0.72 * Math.PI);
  const key = new DirectionalLight(0xffffff, 0.34 * Math.PI);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(ambient, key, key.target);
  const building = new Group();
  scene.add(building);

  let pal = readPalette();
  let reduced = opts.reduced;
  let data = opts.data;
  let kit: Kit | null = null;
  let floors: FloorView[] = [];
  let walkers: Walker[] = [];
  let queue: { floor: number; desk: number }[] = [];
  let spawnIn = 0;
  let width = 1;
  let height = 1;
  let ppu = 40;
  const centre = new Vector3();
  let fitAt = { x: 0, y: 0 };
  let morePlate: HTMLDivElement | null = null;
  /** Each person's colours (linear), by desk key, for this palette. */
  const looks = new Map<string, Color[]>();
  /** The hover glow in the accent (--hr-rh): three shells (width in pixels) and the halo ring on the floor. */
  const glowColour = new Vector3();
  const SHELLS = [1.5, 3.5, 6];
  const hullMats = SHELLS.map(
    (_, k) =>
      new ShaderMaterial({
        vertexShader: HULL_VS,
        fragmentShader: HULL_FS,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: k + 1,
        stencilFunc: NotEqualStencilFunc,
        stencilZPass: ReplaceStencilOp,
        uniforms: { uColor: { value: glowColour }, uAlpha: { value: 0.3 }, uThick: { value: 0.01 } },
      }),
  );
  const ringMat = new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: glowColour }, uAlpha: { value: 0.6 } } });
  const hull = { group: new Group(), shells: [] as { desk: Mesh; chair: Mesh; person: Mesh }[], ring: new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), ringMat) };
  hull.ring.matrixAutoUpdate = false;
  hull.ring.renderOrder = 20;
  hull.group.add(hull.ring);
  hullMats.forEach((mat, k) => {
    const set = { desk: new Mesh(), chair: new Mesh(), person: new Mesh() };
    for (const m of [set.desk, set.chair, set.person]) {
      m.material = mat;
      m.matrixAutoUpdate = false;
      m.renderOrder = 21 + k;
      hull.group.add(m);
    }
    hull.shells.push(set);
  });
  hull.group.visible = false;
  const morePoint = new Vector3();
  let arrangedFor = '';

  /* view */
  const REST = { yaw: 0.62, pitch: 0.5 };
  let yaw = REST.yaw;
  let pitch = REST.pitch;
  let goYaw = yaw;
  let goPitch = pitch;
  let zoom = 1;
  let goZoom = 1;
  /** Pan in the camera plane (world units across and up the screen), eased toward its goal. */
  const pan = { x: 0, y: 0 };
  const goPan = { x: 0, y: 0 };
  /** The campus extent in the camera plane at rest, around the fit centre (pan stays inside it). */
  let reach = { x: 1, y: 1 };
  let focus: string | null = null;
  let hoverFloor = -1;
  let hoverDesk: { f: number; i: number } | null = null;
  let drag: { id: number; x: number; y: number; sx: number; sy: number; moved: boolean; touch: boolean; turn: boolean } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; cy: number } | null = null;
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let dirty = true;
  let shadowAt = 0;
  let frames = 0;
  let drawn = 0;
  let fpsAt = 0;
  let pointer: { x: number; y: number } | null = null;

  /* ------------------------------------------------------------- build */

  function clearBuilding(): void {
    hull.group.removeFromParent();
    hull.group.visible = false;
    looks.clear();
    for (const f of floors) f.plate.remove();
    morePlate?.remove();
    morePlate = null;
    for (const w of walkers) for (const m of w.mats) m.dispose();
    walkers = [];
    disposeTree(building);
    building.clear();
    floors = [];
    arrangedFor = '';
  }

  /**
   * An office's plan: its rows grow with its people so it stays near square;
   * four rooms or more go in two bands (back and front, split to balance their
   * widths) along a corridor; the lobby on the left runs front to back.
   */
  function layout(f: OfficeSceneFloor, fi: number): Plan {
    const n = f.rooms.reduce((a, r) => a + r.people.length, 0);
    const rows = n <= 10 ? 2 : n <= 36 ? 3 : Math.min(8, Math.ceil(Math.sqrt(n / 4)));
    const cols = f.rooms.map((r) => Math.max(1, Math.ceil(r.people.length / rows)));
    const widthOf = (i: number): number => (cols[i] ?? 1) * COL + ROOM_PAD * 2;
    let split = f.rooms.length;
    if (f.rooms.length >= 4) {
      const total = cols.reduce((a, _, i) => a + widthOf(i), 0);
      let acc = 0;
      let best = Infinity;
      for (let k = 1; k < f.rooms.length; k++) {
        acc += widthOf(k - 1);
        const diff = Math.abs(total - 2 * acc);
        if (diff < best) {
          best = diff;
          split = k;
        }
      }
    }
    const spans: [number, number][] = split < f.rooms.length ? [[0, split], [split, f.rooms.length]] : [[0, f.rooms.length]];
    const pitchZ = (rows - 1) * ROW + CHAIR_OUT + 0.95;
    const desks: Desk[] = [];
    const rooms: Plan['rooms'] = [];
    const corridors: number[] = [];
    let end = X0;
    spans.forEach(([a, b], bi) => {
      const z0 = bi * pitchZ;
      const zA = bi === 0 ? 0.1 : z0 + Z0 - 0.25;
      const zB = z0 + Z0 + (rows - 1) * ROW + CHAIR_OUT + 0.12;
      if (bi < spans.length - 1) corridors.push(z0 + Z0 + (rows - 1) * ROW + CHAIR_OUT + 0.4);
      let x = X0;
      for (let ri = a; ri < b; ri++) {
        const r = f.rooms[ri];
        if (r === undefined) continue;
        const c = cols[ri] ?? 1;
        const w = widthOf(ri);
        const room = { x0: x, x1: x + w, z0: zA, z1: zB };
        rooms.push(room);
        r.people.forEach((p, i) => {
          const row = Math.floor(i / c);
          desks.push({ key: p.key, floor: fi, state: p.state, since: p.since, x: x + ROOM_PAD + COL * ((i % c) + 0.5), z: z0 + Z0 + row * ROW, room, row, band: bi, phase: (i * 1.7 + fi * 0.9) % 6.28, walking: false });
        });
        x += w;
      }
      end = Math.max(end, x);
    });
    const d = (spans.length - 1) * pitchZ + Z0 + (rows - 1) * ROW + CHAIR_OUT + 0.62;
    return { desks, rooms, end, w: Math.max(3.6, end + 0.6), d, rows, bands: spans.length, corridors };
  }

  function buildAll(): void {
    clearBuilding();
    width = Math.max(1, Math.round(host.getBoundingClientRect().width));
    const p = pal;
    if (kit !== null) for (const g of Object.values(kit)) g.dispose();
    kit = makeKit(p);
    for (const s of hull.shells) {
      s.desk.geometry = kit.deskHull;
      s.chair.geometry = kit.chairHull;
      s.person.geometry = kit.seatHull;
    }
    // The accent as is (sRGB, written straight out); a little stronger on dark, where it reads as light.
    glowColour.set(p.rh[0], p.rh[1], p.rh[2]);
    const shellAlpha = p.dark ? [0.5, 0.28, 0.14] : [0.42, 0.22, 0.1];
    hullMats.forEach((m, k) => (m.uniforms['uAlpha']!.value = shellAlpha[k] ?? 0.1));
    ringMat.uniforms['uAlpha']!.value = p.dark ? 0.75 : 0.6;
    const shown = data.floors.slice(0, MAX_FLOORS);
    const plans = shown.map((f, i) => layout(f, i));
    // Sized by headcount, within limits: an office far bigger than the others is drawn smaller.
    const sizes = plans.map((x) => Math.max(x.w, x.d)).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 4;
    const cap = Math.max(7.5, 2.2 * median);

    const floorTone = p.dark ? mixRGB(p.panel, p.line, 0.3) : mixRGB(p.sunk, p.panel, 0.55);
    const slabEdge = p.dark ? mixRGB(p.line, p.line2, 0.3) : mixRGB(p.line, p.panel, 0.3);
    const wallTone = p.dark ? mixRGB(p.raised, p.panel, 0.4) : mixRGB(p.raised, p.panel, 0.2);
    const cutTone = p.dark ? mixRGB(p.line2, p.muted, 0.2) : mixRGB(p.line2, p.muted, 0.35);
    const inlay = p.dark ? mixRGB(p.sunk, p.panel, 0.3) : mixRGB(p.panel, p.raised, 0.3);
    const frame = p.dark ? mixRGB(p.muted, p.line2, 0.4) : mixRGB(p.ink2, p.muted, 0.4);
    const rail = p.dark ? mixRGB(p.line2, p.muted, 0.4) : mixRGB(p.muted, p.line2, 0.4);
    const pot = p.dark ? mixRGB(p.line2, p.panel, 0.3) : mixRGB(p.line2, p.raised, 0.25);
    const sofa = p.dark ? mixRGB(p.line, p.line2, 0.6) : mixRGB(p.line2, p.line, 0.2);
    const edgeMat = new LineBasicMaterial({ color: srgb(p.dark ? mixRGB(p.line2, p.muted, 0.25) : mixRGB(p.line2, p.muted, 0.45)), transparent: true, opacity: p.dark ? 0.75 : 0.7 });
    const haloColour = new Vector3(...lin(p.dark ? [0, 0, 0] : mixRGB(p.ink, p.line2, 0.4)));

    shown.forEach((f, fi) => {
      const plan = plans[fi];
      if (plan === undefined || kit === null) return;
      const W = plan.w;
      const D = plan.d;
      const group = new Group();
      building.add(group);
      const parts: BufferGeometry[] = [];
      const hh = FH - SLAB;
      // slab, with its cut edge a step darker
      parts.push(box(-WALL, -SLAB, -WALL, W + WALL, SLAB, D + WALL, floorTone));
      parts.push(box(-WALL, -SLAB - 0.002, D - 0.004, W + WALL, SLAB * 0.55, 0.008, slabEdge));
      // back wall with a window band and mullions; left wall the same
      parts.push(box(-WALL, 0, -WALL, W + WALL, 0.3, WALL, wallTone));
      parts.push(box(-WALL, hh - 0.24, -WALL, W + WALL, 0.24, WALL, wallTone));
      parts.push(box(0, 0, -WALL, 0.012, hh, 0.012, cutTone));
      parts.push(box(-WALL, 0, 0, WALL, 0.3, D, wallTone));
      parts.push(box(-WALL, hh - 0.24, 0, WALL, 0.24, D, wallTone));
      parts.push(box(W - 0.012, 0, -WALL, 0.012, hh, WALL, cutTone));
      parts.push(box(-WALL, 0, D - 0.012, WALL, hh, 0.012, cutTone));
      for (let x = 0.7; x < W - 0.2; x += 0.74) parts.push(box(x - 0.016, 0.3, -WALL, 0.032, hh - 0.54, WALL * 0.9, wallTone));
      for (let z = 0.7; z < D - 0.2; z += 0.74) parts.push(box(-WALL, 0.3, z - 0.016, WALL * 0.9, hh - 0.54, 0.032, wallTone));
      // sills, the open roof's cap on the walls
      parts.push(box(0, 0.3, 0, W, 0.012, 0.05, frame));
      parts.push(box(0, 0.3, 0, 0.05, 0.012, D, frame));
      parts.push(box(-WALL - 0.01, hh, -WALL - 0.01, W + WALL + 0.01, 0.025, WALL + 0.02, frame), box(-WALL - 0.01, hh, -WALL - 0.01, WALL + 0.02, 0.025, D + WALL + 0.01, frame));
      // the lobby (and its entrance mat), rooms as inlays with glass partitions between them
      parts.push(box(0.04, 0.0, 0.04, X0 - 0.12, 0.004, D - 0.5, inlay));
      parts.push(box(0.12, 0.0, D - 0.3, X0 - 0.3, 0.008, 0.22, frame));
      plan.rooms.forEach((r, ri) => {
        parts.push(box(r.x0 + 0.05, 0, r.z0 + 0.02, r.x1 - r.x0 - 0.1, 0.004, r.z1 - r.z0 - 0.04, inlay));
        if (ri > 0 && r.x0 > X0 + 0.01) {
          parts.push(box(r.x0 - 0.012, 0, r.z0, 0.024, 0.02, r.z1 - r.z0, rail));
          parts.push(box(r.x0 - 0.012, 0.37, r.z0, 0.024, 0.016, r.z1 - r.z0, rail));
          parts.push(box(r.x0 - 0.016, 0, r.z1 - 0.03, 0.032, 0.386, 0.03, frame));
          parts.push(box(r.x0 - 0.016, 0, r.z0, 0.032, 0.386, 0.03, frame));
        }
      });
      // a plant in the lobby and one at the far corner; a small lounge when the office has room
      const plants = [
        { x: 0.2, z: D - 0.72 },
        { x: W - 0.36, z: 0.42 },
      ];
      if (plan.bands === 1 && W - plan.end > 1.5) {
        const sx = plan.end + 0.35;
        parts.push(box(sx, 0, 0.3, 0.9, 0.12, 0.36, sofa), box(sx, 0.12, 0.3, 0.9, 0.2, 0.09, sofa), box(sx, 0.12, 0.3, 0.08, 0.1, 0.36, sofa), box(sx + 0.82, 0.12, 0.3, 0.08, 0.1, 0.36, sofa));
        parts.push(cyl(sx + 0.45, 0, 1.05, 0.2, 0.012, frame, 24), cyl(sx + 0.45, 0.012, 1.05, 0.02, 0.17, frame, 8), cyl(sx + 0.45, 0.18, 1.05, 0.22, 0.014, inlay, 24));
        plants.push({ x: sx + 1.15, z: 1.25 });
      }
      for (const pl of plants) {
        parts.push(cyl(pl.x, 0, pl.z, 0.065, 0.13, pot, 16, 0.08));
        parts.push(cyl(pl.x, 0.13, pl.z, 0.074, 0.012, frame, 16));
      }
      const solidGeo = merge(parts);
      const solid = new MeshLambertMaterial({ vertexColors: true });
      const mesh = new Mesh(solidGeo, solid);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
      // thin lines on the structure: every crease of the solid parts, and each desk's top
      const edgeParts: BufferGeometry[] = [new EdgesGeometry(solidGeo, 28)];
      const deskTop = new EdgesGeometry(new BoxGeometry(0.56, 0.026, 0.3));
      for (const d of plan.desks) edgeParts.push(deskTop.clone().translate(d.x, 0.335, d.z));
      deskTop.dispose();
      const edgeGeo = mergeGeometries(edgeParts, false);
      for (const g of edgeParts) g.dispose();
      if (edgeGeo !== null) group.add(new LineSegments(edgeGeo, edgeMat.clone()));
      // window glass (lit by the hour) and partition glass
      const glassParts: BufferGeometry[] = [box(0, 0.312, -WALL * 0.5, W, hh - 0.556, 0.006, p.page), box(-WALL * 0.5, 0.312, 0, 0.006, hh - 0.556, D, p.page)];
      const windowMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const windowMesh = new Mesh(merge(glassParts), windowMat);
      group.add(windowMesh);
      const parts2: BufferGeometry[] = [];
      plan.rooms.forEach((r, ri) => {
        if (ri > 0 && r.x0 > X0 + 0.01) parts2.push(box(r.x0 - 0.004, 0.02, r.z0, 0.008, 0.35, r.z1 - r.z0, p.page));
      });
      const glassMat = new MeshLambertMaterial({ color: srgb(p.dark ? mixRGB(p.rh, p.line2, 0.7) : mixRGB(p.rh, p.raised, 0.82)), transparent: true, opacity: p.dark ? 0.22 : 0.3, depthWrite: false, side: DoubleSide });
      if (parts2.length > 0) group.add(new Mesh(merge(parts2), glassMat));
      else glassMat.dispose();
      // daylight on the floor along the windows
      const dayMat = new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: DAY_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: new Vector3(...lin(p.dark ? mixRGB(p.page, p.rh, 0.3).map((x) => Math.min(1, x + 0.25)) as RGB : [1, 0.99, 0.95])) }, uAlpha: { value: 0 } } });
      group.add(new Mesh(new PlaneGeometry(W, 1.1).rotateX(-Math.PI / 2).translate(W / 2, 0.006, 0.55), dayMat));

      // furniture and people, one instanced mesh per kind
      const n = plan.desks.length;
      const lam = (vc: boolean): MeshLambertMaterial => new MeshLambertMaterial({ vertexColors: vc });
      const instMats = [lam(true), lam(true), lam(true)];
      const mk = (g: BufferGeometry, m: MeshLambertMaterial | MeshBasicMaterial | ShaderMaterial, shadow: boolean): InstancedMesh => {
        const im = new InstancedMesh(g, m, Math.max(1, n));
        im.count = n;
        im.castShadow = shadow;
        im.receiveShadow = shadow;
        im.instanceMatrix.setUsage(DynamicDrawUsage);
        group.add(im);
        return im;
      };
      const deskMesh = mk(kit.desk, instMats[0] as MeshLambertMaterial, true);
      const chairMesh = mk(kit.chair, instMats[1] as MeshLambertMaterial, true);
      const personMats = [0, 1, 2, 3, 4].map(() => {
        const m = lam(true);
        m.flatShading = true;
        return m;
      });
      const people = [kit.seatSkin, kit.seatHair, kit.seatTop, kit.seatBottom, kit.seatShoes].map((g, k) => mk(g, personMats[k] as MeshLambertMaterial, true));
      const cardMesh = mk(kit.card, instMats[2] as MeshLambertMaterial, false);
      const screenMesh = mk(kit.screen, new MeshBasicMaterial({ color: 0xffffff }), false);
      const bulbMesh = mk(kit.bulb, new MeshBasicMaterial({ color: 0xffffff }), false);
      const glowMat = new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: POOL_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: new Vector3(1, 1, 1) }, uAlpha: { value: p.dark ? 0.85 : 0.7 } } });
      const glowMesh = mk(kit.glow, glowMat, false);
      // plant leaves, swaying
      const leaves: FloorView['leaves'] = [];
      for (const pl of plants) for (let k = 0; k < 6; k++) leaves.push({ x: pl.x, z: pl.z, a: (k / 6) * Math.PI * 2 + fi, tilt: 0.35 + (k % 3) * 0.12, phase: k * 1.3 + pl.x });
      const leafMesh = new InstancedMesh(kit.leaf, lam(true), leaves.length);
      leafMesh.castShadow = true;
      leafMesh.instanceMatrix.setUsage(DynamicDrawUsage);
      group.add(leafMesh);
      // its halo on the ground (stays down when the office lifts)
      const halo = new Mesh(new PlaneGeometry(W + 1.4, D + 1.4).rotateX(-Math.PI / 2), new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: POOL_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: haloColour }, uAlpha: { value: p.dark ? 0.6 : 0.22 } } }));
      building.add(halo);
      const plate = makePlate();
      labels.appendChild(plate);
      const scale = Math.min(1, cap / Math.max(W, D));
      floors.push({ key: f.key, zone: f.timezone, group, base: 0, lift: 0, liftTo: 0, desks: plan.desks, w: W, d: D, rows: plan.rows, bands: plan.bands, corridors: plan.corridors, scale, halo, deskMesh, chairMesh, people, screenMesh, bulbMesh, glowMesh, cardMesh, leafMesh, leaves, mats: { solid, inst: [...instMats, ...personMats, leafMesh.material as MeshLambertMaterial], window: windowMat, day: dayMat, glow: glowMat }, windows: windowMesh, plate, light: 1, warm: 0 });
    });
    edgeMat.dispose();
    if (data.more > 0) {
      morePlate = document.createElement('div');
      morePlate.className = 'hr-label pointer-events-none absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-[var(--hr-hair)] bg-[color-mix(in_srgb,var(--hr-raised)_88%,transparent)] px-1.5 leading-[18px]';
      morePlate.textContent = opts.more(data.more);
      labels.appendChild(morePlate);
    }
    // where the walkers start: people who clocked in a few minutes ago
    if (!reduced)
      floors.forEach((fv, fi) =>
        fv.desks.forEach((d, i) => {
          if (d.state === 'in_now' && d.since !== null && d.since <= WALK_MIN) queue.push({ floor: fi, desk: i });
        }),
      );
    for (const q of queue) {
      const d = floors[q.floor]?.desks[q.desk];
      if (d !== undefined) d.walking = true;
    }
    spawnIn = 0.6;
    resize();
    applyTime();
    for (let i = 0; i < floors.length; i++) writeFloor(i);
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }

  /**
   * The campus: offices on a grid that reads across the screen (columns left
   * to right, rows back to front), head office first; four across on a wide
   * stage, two on a phone. Places the halos, the light and the "+N" plate.
   */
  function arrange(): void {
    const n = floors.length;
    const narrow = width < 640;
    const cols = Math.max(1, narrow ? Math.min(2, n) : n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4);
    const sig = cols + ':' + n;
    if (sig === arrangedFor) return;
    arrangedFor = sig;
    const c = Math.cos(REST.yaw);
    const s = Math.sin(REST.yaw);
    const U = new Vector3(c, 0, -s); // across the screen
    const V = new Vector3(s, 0, c); // toward the viewer
    const eu = floors.map((f) => (f.w * c + f.d * s) * f.scale);
    const ev = floors.map((f) => (f.w * s + f.d * c) * f.scale);
    const gridRows = Math.ceil((n + (data.more > 0 && n % cols !== 0 ? 1 : 0)) / cols);
    const colW = Array.from({ length: cols }, (_, k) => Math.max(0, ...eu.filter((_, i) => i % cols === k)));
    const rowD = Array.from({ length: gridRows }, (_, r) => Math.max(0, ...ev.filter((_, i) => Math.floor(i / cols) === r)));
    // Rows sit far enough apart that each office's plate, which hangs below its building, stays clear of the next row.
    const GAP_U = 0.8;
    const GAP_V = 4.8;
    const uAt = (k: number): number => colW.slice(0, k).reduce((a, x) => a + x + GAP_U, 0) + (colW[k] ?? 0) / 2;
    const vAt = (r: number): number => rowD.slice(0, r).reduce((a, x) => a + x + GAP_V, 0) + (rowD[r] ?? 0) / 2;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    floors.forEach((f, i) => {
      const mid = new Vector3().addScaledVector(U, uAt(i % cols)).addScaledVector(V, vAt(Math.floor(i / cols)));
      const sw = f.w * f.scale;
      const sd = f.d * f.scale;
      f.group.position.set(mid.x - sw / 2, f.base + f.lift, mid.z - sd / 2);
      f.group.scale.setScalar(f.scale);
      f.halo.position.set(mid.x, -SLAB - 0.004, mid.z);
      f.halo.scale.setScalar(f.scale);
      x0 = Math.min(x0, mid.x - sw / 2);
      x1 = Math.max(x1, mid.x + sw / 2);
      z0 = Math.min(z0, mid.z - sd / 2);
      z1 = Math.max(z1, mid.z + sd / 2);
    });
    // the "+N more offices" plate stands in the next cell
    morePoint.copy(new Vector3().addScaledVector(U, uAt(n % cols)).addScaledVector(V, vAt(Math.floor(n / cols)))).setY(0);
    centre.set((x0 + x1) / 2, FH / 2, (z0 + z1) / 2);
    const span = Math.max(x1 - x0, z1 - z0) * 0.8 + 3;
    key.position.set(centre.x - 4.2, 5.2, centre.z + 6.4);
    key.target.position.set(centre.x, 0, centre.z);
    const sc = key.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 0.5;
    sc.far = span * 4 + 20;
    sc.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  }

  /* -------------------------------------------------------- per floor */

  const m4 = new Matrix4();
  const q4 = new Quaternion();
  const v4 = new Vector3();
  const s4 = new Vector3();
  const ZERO = new Matrix4().makeScale(0, 0, 0);
  const col = new Color();

  /** Light of each floor by its local hour: daylight in the glass and on the floor, lamps after dark. */
  function applyTime(): void {
    const p = pal;
    const dayGlass = lin(p.dark ? mixRGB(p.rh, p.page, 0.55).map((x) => Math.min(1, x + 0.18)) as RGB : mixRGB(p.rh, [1, 1, 1], 0.78));
    const eveGlass = lin(p.dark ? mixRGB(p.warn, p.page, 0.7) : mixRGB(p.warn, p.ink2, 0.55));
    const nightGlass = lin(p.dark ? mixRGB(p.page, p.rh, 0.12) : mixRGB(p.ink, p.rh, 0.22));
    for (const f of floors) {
      const ph = phaseOf(hourIn(f.zone));
      // Dark themes start from dark tokens: daylight lifts them further.
      f.light = p.dark ? 0.72 + 0.62 * ph.day + 0.22 * ph.eve : 0.64 + 0.36 * ph.day + 0.16 * ph.eve;
      const L = f.light;
      f.mats.solid.color.setRGB(L, L, L);
      for (const m of f.mats.inst) m.color.setRGB(L, L, L);
      const g = [0, 1, 2].map((k) => (nightGlass[k] ?? 0) * ph.night + (eveGlass[k] ?? 0) * ph.eve + (dayGlass[k] ?? 0) * ph.day) as [number, number, number];
      f.mats.window.color.setRGB(g[0], g[1], g[2]);
      f.mats.day.uniforms['uAlpha']!.value = ph.day * (p.dark ? 0.32 : 0.5);
      f.windows.castShadow = ph.day < 0.5;
      f.warm = Math.min(1, ph.eve * 0.95 + ph.night * 0.85);
      writePlate(f.plate, opts.plate(f.key));
    }
    for (let i = 0; i < floors.length; i++) writeFloor(i);
    dirty = true;
    renderer.shadowMap.needsUpdate = true;
  }

  /** Write a floor's instances from its desks' states (and hover). */
  function writeFloor(fi: number): void {
    const f = floors[fi];
    if (f === undefined) return;
    const p = pal;
    const warm = f.warm;
    const screenOn = lin(p.dark ? mixRGB(p.rh, [1, 1, 1], 0.45) : mixRGB(p.rh, [1, 1, 1], 0.6));
    const screenOff = lin(p.dark ? mixRGB(p.page, p.ink, 0.08) : mixRGB(p.ink, p.ink2, 0.4));
    const teal = lin(p.lh);
    const warmC = lin(mixRGB(p.warn, [1, 1, 1], 0.6));
    const bulbOff = lin(p.dark ? mixRGB(p.line2, p.page, 0.3) : mixRGB(p.line2, p.muted, 0.3));
    f.desks.forEach((d, i) => {
      const hover = hoverDesk !== null && hoverDesk.f === fi && hoverDesk.i === i;
      // desk
      m4.makeTranslation(d.x, 0, d.z);
      f.deskMesh.setMatrixAt(i, m4);
      const dim = d.state === 'not_in' || d.state === 'late' ? 0.8 : d.state === 'unknown' ? 0.92 : 1;
      const k = hover ? 1.14 : dim;
      f.deskMesh.setColorAt(i, col.setRGB(k, k, k));
      // chair: tucked in on leave and when nobody is in, pulled out otherwise
      const out = d.state === 'in_now' || d.state === 'remote' || d.walking ? CHAIR_OUT : CHAIR_IN;
      m4.makeTranslation(d.x, 0, d.z + out);
      f.chairMesh.setMatrixAt(i, m4);
      f.chairMesh.setColorAt(i, col.setRGB(dim, dim, dim));
      // the person, at the desk when in now (not while walking in)
      const seated = d.state === 'in_now' && !d.walking ? seatedAt(d, 0) : ZERO;
      const look = lookFor(d.key);
      f.people.forEach((im, k) => {
        im.setMatrixAt(i, seated);
        const c = look[k];
        if (c !== undefined) im.setColorAt(i, c);
      });
      // screen, lamp and its pool
      m4.makeTranslation(d.x, 0, d.z);
      f.screenMesh.setMatrixAt(i, m4);
      const on = d.state === 'in_now' && !d.walking;
      const sc = on ? screenOn : screenOff;
      f.screenMesh.setColorAt(i, col.setRGB(sc[0], sc[1], sc[2]));
      const lamp = d.state === 'remote' ? 1 : on ? warm : 0;
      const lc = d.state === 'remote' ? teal : warmC;
      f.bulbMesh.setMatrixAt(i, m4);
      const bc = lamp > 0.02 ? lc : bulbOff;
      f.bulbMesh.setColorAt(i, col.setRGB(bc[0], bc[1], bc[2]));
      f.glowMesh.setMatrixAt(i, lamp > 0.02 ? m4 : ZERO);
      f.glowMesh.setColorAt(i, col.setRGB(lc[0] * lamp, lc[1] * lamp, lc[2] * lamp));
      // the leave card
      f.cardMesh.setMatrixAt(i, d.state === 'on_leave' ? m4 : ZERO);
    });
    for (const im of [f.deskMesh, f.chairMesh, ...f.people, f.screenMesh, f.bulbMesh, f.glowMesh, f.cardMesh]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor !== null) im.instanceColor.needsUpdate = true;
    }
    writeLeaves(f, 0);
  }

  function lookFor(key: string): Color[] {
    let l = looks.get(key);
    if (l === undefined) {
      l = lookOf(key, pal).map((c) => new Color().setRGB(c[0], c[1], c[2], SRGBColorSpace));
      looks.set(key, l);
    }
    return l;
  }

  /** The hover glow follows the hovered desk, its chair and (when seated) its person; the halo ring sits on the floor under them. */
  function writeHull(): void {
    const f = hoverDesk !== null ? floors[hoverDesk.f] : undefined;
    const d = f !== undefined && hoverDesk !== null ? f.desks[hoverDesk.i] : undefined;
    if (f === undefined || d === undefined || hoverDesk === null) {
      hull.group.visible = false;
      return;
    }
    if (hull.group.parent !== f.group) f.group.add(hull.group);
    hull.group.visible = true;
    const out = d.state === 'in_now' || d.state === 'remote' || d.walking ? CHAIR_OUT : CHAIR_IN;
    const seated = d.state === 'in_now' && !d.walking;
    for (const s of hull.shells) {
      s.desk.matrix.makeTranslation(d.x, 0, d.z);
      s.chair.matrix.makeTranslation(d.x, 0, d.z + out);
      s.person.visible = seated;
      f.people[2]?.getMatrixAt(hoverDesk.i, s.person.matrix);
    }
    // An oval around the desk and its chair, just above the room's floor inlay.
    hull.ring.matrix.makeScale(0.96, 1, 1.2).setPosition(d.x, 0.009, d.z + 0.14);
    // The same width in pixels at any zoom.
    const px = 1 / Math.max(1, ppu * zoom * f.scale);
    hullMats.forEach((m, k) => (m.uniforms['uThick']!.value = (SHELLS[k] ?? 2) * px));
  }

  function seatedAt(d: Desk, bob: number): Matrix4 {
    v4.set(d.x, bob * 0.0045, d.z + CHAIR_OUT);
    q4.setFromAxisAngle(UP, bob * 0.02);
    return m4.compose(v4, q4, s4.set(1, 1, 1));
  }

  const leafE = new Object3D();
  function writeLeaves(f: FloorView, t: number): void {
    if (f.leafMesh === null) return;
    f.leaves.forEach((l, i) => {
      const sway = reduced ? 0 : Math.sin(t * 0.9 + l.phase) * 0.05;
      leafE.position.set(l.x, 0.14, l.z);
      leafE.rotation.set(0, l.a, l.tilt + sway, 'YXZ');
      leafE.updateMatrix();
      f.leafMesh?.setMatrixAt(i, leafE.matrix);
    });
    f.leafMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------ camera */

  function viewDir(): Vector3 {
    return new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }

  /** Arrange the campus, then fit it to the stage at the resting view (room left for the readouts on wide screens). */
  function resize(): void {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    arrange();
    const wide = width >= 900;
    const availW = Math.max(160, wide ? width - 480 : width - 16);
    const availH = Math.max(160, height - (wide ? 28 : 24));
    const dir = new Vector3(Math.sin(REST.yaw) * Math.cos(REST.pitch), Math.sin(REST.pitch), Math.cos(REST.yaw) * Math.cos(REST.pitch));
    const right = new Vector3().crossVectors(UP, dir).normalize();
    const up = new Vector3().crossVectors(dir, right).normalize();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const f of floors)
      for (const x of [-WALL, f.w])
        for (const y of [-SLAB, FH + 0.3])
          for (const z of [-WALL, f.d]) {
            const c = new Vector3(f.group.position.x + x * f.scale, y * f.scale, f.group.position.z + z * f.scale).sub(centre);
            const a = c.dot(right);
            const b = c.dot(up);
            x0 = Math.min(x0, a);
            x1 = Math.max(x1, a);
            y0 = Math.min(y0, b);
            y1 = Math.max(y1, b);
          }
    if (!Number.isFinite(x0)) {
      x0 = -1;
      x1 = 1;
      y0 = -1;
      y1 = 1;
    }
    ppu = Math.min(availW / ((x1 - x0) * 1.04), availH / ((y1 - y0) * 1.04));
    fitAt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    reach = { x: (x1 - x0) / 2, y: (y1 - y0) / 2 };
    clampPan();
    for (const f of floors) writePlate(f.plate, opts.plate(f.key));
    placeCamera();
    dirty = true;
  }

  function placeCamera(): void {
    const dir = viewDir();
    const right = new Vector3().crossVectors(UP, dir).normalize();
    const up = new Vector3().crossVectors(dir, right).normalize();
    const target = centre.clone().addScaledVector(right, fitAt.x + pan.x).addScaledVector(up, fitAt.y + pan.y);
    camera.position.copy(target).addScaledVector(dir, 60);
    camera.up.copy(UP);
    camera.lookAt(target);
    const s = ppu * zoom;
    camera.left = -width / 2 / s;
    camera.right = width / 2 / s;
    camera.top = height / 2 / s;
    camera.bottom = -height / 2 / s;
    camera.near = 1;
    camera.far = 140;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /* ------------------------------------------------------- exploring */

  const ZOOM_MAX = 4;

  /** Keep the view's centre over the campus. */
  function clampPan(): void {
    goPan.x = Math.max(-reach.x, Math.min(reach.x, goPan.x));
    goPan.y = Math.max(-reach.y, Math.min(reach.y, goPan.y));
  }

  /** Pan by a screen move (px): the campus follows the pointer. */
  function panBy(dx: number, dy: number): void {
    const s = ppu * zoom;
    goPan.x -= dx / s;
    goPan.y += dy / s;
    clampPan();
    pan.x = goPan.x;
    pan.y = goPan.y;
  }

  /** Zoom to `next`, keeping the point under (x, y) in place. */
  function zoomAt(next: number, x: number, y: number): boolean {
    const z = Math.max(1, Math.min(ZOOM_MAX, next));
    if (Math.abs(z - goZoom) < 1e-6) return false;
    const ox = (x - width / 2) / (ppu * goZoom);
    const oy = -(y - height / 2) / (ppu * goZoom);
    goPan.x += ox * (1 - goZoom / z);
    goPan.y += oy * (1 - goZoom / z);
    goZoom = z;
    clampPan();
    return true;
  }

  function resetView(): void {
    goYaw = REST.yaw;
    goPitch = REST.pitch;
    goZoom = 1;
    goPan.x = 0;
    goPan.y = 0;
    kick();
  }

  /* ------------------------------------------------------------ labels */

  const pv = new Vector3();
  function toScreen(x: number, y: number, z: number, g?: Object3D): { x: number; y: number } {
    pv.set(x, y, z);
    if (g !== undefined) pv.applyMatrix4(g.matrixWorld);
    pv.project(camera);
    return { x: ((pv.x + 1) / 2) * width, y: ((1 - pv.y) / 2) * height };
  }

  function overlays(): void {
    building.updateMatrixWorld();
    for (const f of floors) {
      // The plate sits on the ground just below the building's footprint, centred, never over the office.
      const corners = [toScreen(-WALL, 0, -WALL, f.group), toScreen(f.w, 0, -WALL, f.group), toScreen(-WALL, 0, f.d, f.group), toScreen(f.w, 0, f.d, f.group)];
      const xs = corners.map((c) => c.x);
      const bottom = Math.max(...corners.map((c) => c.y));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      f.plate.style.transform = `translate3d(${Math.round(cx)}px, ${Math.round(bottom + 6)}px, 0)`;
    }
    if (morePlate !== null) {
      const s = toScreen(morePoint.x, 0, morePoint.z);
      morePlate.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y - 9)}px, 0)`;
    }
    const tip = anchor.firstElementChild as HTMLElement | null;
    const w = tip?.offsetWidth ?? 220;
    const h = tip?.offsetHeight ?? 120;
    let at: { x: number; y: number } | null = null;
    if (hoverDesk !== null) {
      // Above the person's head (the pointer is on the desk below it).
      const f = floors[hoverDesk.f];
      const d = f?.desks[hoverDesk.i];
      if (f !== undefined && d !== undefined) {
        const p = toScreen(d.x, 0.62, d.z + 0.1, f.group);
        at = { x: p.x, y: p.y - h - 12 < 4 ? p.y + 18 : p.y - h - 12 };
      }
    } else if (hoverFloor >= 0) {
      // Beside the building at the floor's height, clear of the pointer; above the floor when there is no room.
      const f = floors[hoverFloor];
      if (f !== undefined) {
        const mid = (FH - SLAB) / 2;
        const xs = [toScreen(f.w, mid, f.d, f.group), toScreen(f.w, mid, -WALL, f.group), toScreen(-WALL, mid, f.d, f.group), toScreen(-WALL, mid, -WALL, f.group)];
        const right = Math.max(...xs.map((q) => q.x));
        const left = Math.min(...xs.map((q) => q.x));
        const cy = xs.reduce((a, q) => a + q.y, 0) / xs.length;
        const top = toScreen(f.w * 0.55, FH - SLAB, f.d, f.group);
        if (right + 14 + w <= width - 4) at = { x: right + 14 + w / 2, y: cy - h / 2 };
        else if (left - 14 - w >= 4) at = { x: left - 14 - w / 2, y: cy - h / 2 };
        else at = { x: top.x, y: top.y - h - 12 };
      }
    }
    if (at !== null && focus !== null) {
      const x = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, at.x));
      let y = Math.max(4, Math.min(height - h - 4, at.y));
      // Never under the pointer (a click there is meant for the building).
      if (pointer !== null && pointer.x > x - w / 2 - 6 && pointer.x < x + w / 2 + 6 && pointer.y > y - 6 && pointer.y < y + h + 6) y = pointer.y - h - 16 >= 4 ? pointer.y - h - 16 : Math.min(height - h - 4, pointer.y + 22);
      anchor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      anchor.style.opacity = '1';
      anchor.style.visibility = 'visible';
    } else {
      anchor.style.opacity = '0';
      anchor.style.visibility = 'hidden';
    }
  }

  /* ------------------------------------------------------------ motion */

  /** From the lobby's entrance mat along the front aisle (or up the lobby to a corridor), down the room's side lane, to the chair. */
  function walkPath(f: FloorView, d: Desk): Vector3[] {
    const aisle = f.d - 0.28;
    const lobby = X0 * 0.5;
    const lane = d.room.x0 + 0.075;
    const seat = d.z + CHAIR_OUT;
    const front = d.band === f.bands - 1;
    const via = front ? aisle : (f.corridors[d.band] ?? aisle);
    const pts = [new Vector3(lobby, 0, f.d - 0.08), new Vector3(lobby, 0, front ? aisle : via), new Vector3(lane, 0, via)];
    const behind = d.row === f.rows - 1 ? via : seat + 0.25;
    if (Math.abs(behind - via) > 0.01) pts.push(new Vector3(lane, 0, behind));
    pts.push(new Vector3(d.x, 0, behind), new Vector3(d.x, 0, seat + 0.06));
    return pts;
  }

  function spawnWalker(fi: number, di: number): void {
    const f = floors[fi];
    const d = f?.desks[di];
    if (f === undefined || d === undefined || kit === null) return;
    const k = kit;
    const look = lookFor(d.key);
    const mats = look.map((c) => {
      const m = new MeshLambertMaterial({ color: c.clone().multiplyScalar(f.light), transparent: true, opacity: 0, flatShading: true });
      return m;
    });
    const [skin, hairM, topM, bottomM, shoesM] = mats as [MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial];
    const part = (g: BufferGeometry, m: MeshLambertMaterial, parent: Object3D): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const joint = (parent: Object3D, x: number, y: number): Group => {
      const o = new Group();
      o.position.set(x, y, 0);
      parent.add(o);
      return o;
    };
    const g = new Group();
    const body = new Group();
    g.add(body);
    part(k.wTorso, topM, body);
    part(k.wPelvis, bottomM, body);
    part(k.wHead, skin, body);
    part(k.wHair, hairM, body);
    const legs: [Object3D, Object3D] = [joint(body, -0.046, 0.42), joint(body, 0.046, 0.42)];
    const knees: [Object3D, Object3D] = [joint(legs[0], 0, -0.19), joint(legs[1], 0, -0.19)];
    for (const l of legs) part(k.wThigh, bottomM, l);
    for (const kn of knees) {
      part(k.wShin, bottomM, kn);
      part(k.wFoot, shoesM, kn);
    }
    const arms: [Object3D, Object3D] = [joint(body, -0.092, 0.662), joint(body, 0.092, 0.662)];
    const elbows: [Object3D, Object3D] = [joint(arms[0], 0, -0.135), joint(arms[1], 0, -0.135)];
    for (const a of arms) part(k.wUpper, topM, a);
    for (const e of elbows) {
      part(k.wFore, topM, e);
      part(k.wHand, skin, e);
    }
    const path = walkPath(f, d);
    g.position.copy(path[0] ?? new Vector3());
    f.group.add(g);
    walkers.push({ floor: fi, desk: di, group: g, body, legs, knees, arms, elbows, mats, path, seg: 0, t: 0, wait: 0, started: true });
  }

  /** Walkers set off one after another. */
  function stepQueue(dt: number): void {
    if (queue.length === 0) return;
    spawnIn -= dt;
    if (spawnIn > 0) return;
    const q = queue.shift();
    if (q !== undefined) spawnWalker(q.floor, q.desk);
    spawnIn = 1.2;
  }

  function stepWalkers(dt: number): boolean {
    if (walkers.length === 0) return false;
    const done: Walker[] = [];
    for (const w of walkers) {
      const f = floors[w.floor];
      const d = f?.desks[w.desk];
      if (f === undefined || d === undefined) {
        done.push(w);
        continue;
      }
      const a = w.path[w.seg];
      const b = w.path[w.seg + 1];
      const fade = w.mats[0]?.opacity ?? 0;
      if (a === undefined || b === undefined) {
        // arrived: sit down
        const o = Math.max(0, fade - dt * 3);
        for (const m of w.mats) m.opacity = o;
        if (o <= 0) done.push(w);
        if (d.walking) {
          d.walking = false;
          const fi = floors.indexOf(f);
          writeFloor(fi);
        }
        continue;
      }
      const o = Math.min(1, fade + dt * 3);
      for (const m of w.mats) m.opacity = o;
      const len = a.distanceTo(b);
      w.t += (dt * WALK_SPEED) / Math.max(0.001, len);
      if (w.t >= 1) {
        w.t = 0;
        w.seg++;
      }
      const t = Math.min(1, w.t);
      w.group.position.lerpVectors(a, b, t);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const face = Math.atan2(dx, dz);
      w.group.rotation.y += (face - w.group.rotation.y) * Math.min(1, dt * 10);
      // A walk cycle: hips swing, the swinging leg's knee bends, arms swing against the legs, the body bobs and turns a touch.
      const ph = clock * 7.4;
      for (let side = 0; side < 2; side++) {
        const q = ph + side * Math.PI;
        const leg = w.legs[side as 0 | 1];
        const knee = w.knees[side as 0 | 1];
        const arm = w.arms[side as 0 | 1];
        const elbow = w.elbows[side as 0 | 1];
        leg.rotation.x = -0.42 * Math.sin(q);
        knee.rotation.x = 0.08 + 0.62 * Math.max(0, Math.sin(q + 0.9));
        arm.rotation.x = 0.34 * Math.sin(q);
        elbow.rotation.x = -0.22 - 0.18 * Math.max(0, -Math.sin(q));
      }
      w.body.position.y = 0.011 * (1 - Math.cos(2 * ph)) * 0.5;
      w.body.rotation.y = 0.05 * Math.sin(ph);
    }
    for (const w of done) {
      w.group.parent?.remove(w.group);
      for (const m of w.mats) m.dispose();
      walkers.splice(walkers.indexOf(w), 1);
    }
    return true;
  }

  function step(dt: number): boolean {
    let moving = false;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    if (drag === null) {
      yaw += (goYaw - yaw) * k;
      pitch += (goPitch - pitch) * k;
    }
    zoom += (goZoom - zoom) * k;
    pan.x += (goPan.x - pan.x) * k;
    pan.y += (goPan.y - pan.y) * k;
    if (Math.abs(goYaw - yaw) > 1e-4 || Math.abs(goPitch - pitch) > 1e-4 || Math.abs(goZoom - zoom) > 1e-4 || Math.abs(goPan.x - pan.x) > 1e-4 || Math.abs(goPan.y - pan.y) > 1e-4) moving = true;
    else {
      yaw = goYaw;
      pitch = goPitch;
      zoom = goZoom;
      pan.x = goPan.x;
      pan.y = goPan.y;
    }
    placeCamera();
    writeHull();
    let lifting = false;
    for (const f of floors) {
      const kk = reduced ? 1 : 1 - Math.exp(-dt * 9);
      f.lift += (f.liftTo - f.lift) * kk;
      if (Math.abs(f.liftTo - f.lift) > 1e-4) lifting = true;
      else f.lift = f.liftTo;
      f.group.position.y = f.base + f.lift;
    }
    if (lifting) moving = true;
    if (!reduced) {
      // idle life: a slight typing bob at every occupied desk, the leaves sway
      for (const f of floors) {
        f.desks.forEach((d, i) => {
          if (d.state !== 'in_now' || d.walking) return;
          const m = seatedAt(d, Math.sin(clock * 2.4 + d.phase) * (0.5 + 0.5 * Math.sin(clock * 0.37 + d.phase)));
          for (const im of f.people) im.setMatrixAt(i, m);
        });
        for (const im of f.people) im.instanceMatrix.needsUpdate = true;
        writeLeaves(f, clock);
      }
      stepQueue(dt);
      const wm = stepWalkers(dt);
      if (wm || lifting) {
        // shadows follow what moves, a dozen times a second
        if (clock - shadowAt > 0.08) {
          renderer.shadowMap.needsUpdate = true;
          shadowAt = clock;
        }
      }
      moving = true;
    } else if (lifting) renderer.shadowMap.needsUpdate = true;
    return moving;
  }

  function frame(t: number): void {
    raf = 0;
    if (!running) return;
    const dt = last === 0 ? 0.016 : Math.min(1 / 30, (t - last) / 1000);
    last = t;
    clock += dt;
    const moving = step(dt);
    if (moving || dirty) {
      renderer.render(scene, camera);
      overlays();
      dirty = false;
      drawn++;
    }
    frames++;
    if (t - fpsAt > 1000) {
      host.dataset['fps'] = String(Math.round((frames * 1000) / (t - fpsAt)));
      host.dataset['frames'] = String(drawn);
      frames = 0;
      fpsAt = t;
    }
    if (!reduced || moving || drag !== null) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function kick(): void {
    dirty = true;
    if (running && raf === 0) raf = requestAnimationFrame(frame);
  }

  function setRunning(on: boolean): void {
    if (on === running) return;
    running = on;
    if (on) {
      last = 0;
      kick();
    } else if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* ---------------------------------------------------------- pointing */

  const ray = new Raycaster();
  const ndc = new Vector2();
  const tmpBox = new Box3();
  const hitAt = new Vector3();

  /** The floor or desk under a point: desks first (nearest), else the floor whose volume the ray meets first. */
  function pick(x: number, y: number): { floor: number; desk: number } | null {
    ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    building.updateMatrixWorld();
    const meshes = floors.flatMap((f) => [f.deskMesh, f.chairMesh, ...f.people]);
    const hits = ray.intersectObjects(meshes, false);
    let best: { floor: number; desk: number; d: number } | null = null;
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const fi = floors.findIndex((f) => f.deskMesh === h.object || f.chairMesh === h.object || f.people.includes(h.object as InstancedMesh));
      if (fi >= 0) {
        best = { floor: fi, desk: h.instanceId, d: h.distance };
        break;
      }
    }
    let floorHit: { floor: number; d: number } | null = null;
    const r: Ray = ray.ray;
    floors.forEach((f, fi) => {
      // At rest, so an office that lifts under the pointer stays the one pointed at.
      const gp = f.group.position;
      tmpBox.min.set(gp.x - WALL * f.scale, f.base - SLAB * f.scale, gp.z - WALL * f.scale);
      tmpBox.max.set(gp.x + f.w * f.scale, f.base + (FH - SLAB) * f.scale, gp.z + f.d * f.scale);
      if (r.intersectBox(tmpBox, hitAt) !== null) {
        const dd = hitAt.distanceTo(r.origin);
        if (floorHit === null || dd < floorHit.d) floorHit = { floor: fi, d: dd };
      }
    });
    if (best !== null) return { floor: best.floor, desk: best.desk };
    const fh = floorHit as { floor: number; d: number } | null;
    return fh !== null ? { floor: fh.floor, desk: -1 } : null;
  }

  function setHover(h: { floor: number; desk: number } | null): void {
    const nf = h === null ? -1 : h.floor;
    const nd = h !== null && h.desk >= 0 ? { f: h.floor, i: h.desk } : null;
    const keyNow = nd !== null ? (floors[nd.f]?.desks[nd.i]?.key ?? null) : nf >= 0 ? (floors[nf]?.key ?? null) : null;
    const prevDesk = hoverDesk;
    hoverFloor = nf;
    hoverDesk = nd;
    if (prevDesk !== null && (nd === null || prevDesk.f !== nd.f || prevDesk.i !== nd.i)) writeFloor(prevDesk.f);
    if (nd !== null) writeFloor(nd.f);
    canvas.style.cursor = h !== null ? 'pointer' : drag !== null ? 'grabbing' : 'grab';
    if (keyNow !== focus) {
      focus = keyNow;
      events.onFocus(keyNow);
    }
    kick();
  }

  function local(e: MouseEvent): { x: number; y: number } {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let pickQueued = 0;
  function hoverAt(x: number, y: number): void {
    pointer = { x, y };
    if (pickQueued !== 0) return;
    pickQueued = requestAnimationFrame(() => {
      pickQueued = 0;
      if (pointer !== null && drag === null) setHover(pick(pointer.x, pointer.y));
    });
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    const p = local(e);
    if (e.pointerType !== 'mouse') {
      touches.set(e.pointerId, p);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        if (a !== undefined && b !== undefined) pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag = null;
        if (focus !== null) setHover(null);
        return;
      }
    }
    // Left drag (one finger) pans; a right drag or Shift with a drag turns.
    drag = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, touch: e.pointerType !== 'mouse', turn: e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey) };
  }

  function onMove(e: PointerEvent): void {
    const p = local(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, p);
    if (pinch !== null && touches.size === 2) {
      // Two fingers: zoom toward the pinch centre, and pan as the centre moves.
      const [a, b] = [...touches.values()];
      if (a !== undefined && b !== undefined) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        zoomAt(goZoom * (d / Math.max(1, pinch.d)), cx, cy);
        zoom = goZoom;
        pan.x = goPan.x;
        pan.y = goPan.y;
        panBy(cx - pinch.cx, cy - pinch.cy);
        pinch = { d, cx, cy };
        kick();
      }
      return;
    }
    if (drag !== null && e.pointerId === drag.id) {
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) {
        drag.moved = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is gone */
        }
        canvas.style.cursor = 'grabbing';
        if (focus !== null) setHover(null);
      }
      if (drag.moved && drag.turn) {
        goYaw = Math.max(REST.yaw - 0.45, Math.min(REST.yaw + 0.45, goYaw - (p.x - drag.x) * 0.006));
        goPitch = Math.max(REST.pitch - 0.12, Math.min(REST.pitch + 0.14, goPitch + (p.y - drag.y) * 0.003));
        yaw = goYaw;
        pitch = goPitch;
        kick();
      } else if (drag.moved) {
        panBy(p.x - drag.x, p.y - drag.y);
        kick();
      }
      drag.x = p.x;
      drag.y = p.y;
      return;
    }
    if (e.pointerType === 'mouse') hoverAt(p.x, p.y);
  }

  function onUp(e: PointerEvent): void {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag === null || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (d.moved) {
      canvas.style.cursor = 'grab';
      return;
    }
    const p = local(e);
    const h = pick(p.x, p.y);
    if (h === null) {
      if (d.touch) setHover(null);
      return;
    }
    const keyHit = h.desk >= 0 ? floors[h.floor]?.desks[h.desk]?.key : floors[h.floor]?.key;
    if (keyHit === undefined) return;
    if (d.touch && keyHit !== focus) setHover(h);
    else {
      if (pendingSelect !== 0) clearTimeout(pendingSelect);
      pendingSelect = window.setTimeout(() => {
        pendingSelect = 0;
        events.onSelect(keyHit);
      }, d.touch ? 0 : 260);
    }
  }

  let pendingSelect = 0;
  function onDouble(e: MouseEvent): void {
    e.preventDefault();
    if (pendingSelect !== 0) clearTimeout(pendingSelect);
    pendingSelect = 0;
    resetView();
  }

  function onMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  function onCancel(e: PointerEvent): void {
    touches.delete(e.pointerId);
    pinch = null;
    if (drag !== null && e.pointerId === drag.id) drag = null;
  }

  function onLeave(e: PointerEvent): void {
    pointer = null;
    if (e.pointerType === 'mouse' && drag === null) {
      const to = e.relatedTarget as Node | null;
      if (to !== null && anchor.contains(to)) return;
      setHover(null);
    }
  }

  function onAnchorLeave(e: PointerEvent): void {
    const to = e.relatedTarget as Node | null;
    if (to === canvas) return;
    setHover(null);
  }

  /** The wheel (or a trackpad) zooms toward the pointer; at either end it leaves the page to scroll. */
  function onWheel(e: WheelEvent): void {
    const p = local(e);
    const k = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0018;
    if (!zoomAt(goZoom * Math.exp(-e.deltaY * k), p.x, p.y)) return;
    e.preventDefault();
    kick();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDouble);
  canvas.addEventListener('contextmenu', onMenu);
  anchor.addEventListener('pointerleave', onAnchorLeave);

  /* ------------------------------------------------------- lifecycle */

  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(host);
  const io = new IntersectionObserver((es) => {
    visible = es[es.length - 1]?.isIntersecting ?? visible;
    setRunning(visible && !document.hidden);
  });
  io.observe(host);
  const onVis = (): void => setRunning(visible && !document.hidden);
  document.addEventListener('visibilitychange', onVis);
  const stopTheme = onTheme(() => {
    const next = readPalette();
    if (JSON.stringify(next) === JSON.stringify(pal)) return;
    pal = next;
    queue = [];
    buildAll();
    kick();
  });
  // Each floor's light and plate follow its local time.
  const clockTimer = window.setInterval(() => {
    applyTime();
    kick();
  }, 30000);
  const lost = (e: Event): void => {
    e.preventDefault();
    setRunning(false);
  };
  canvas.addEventListener('webglcontextlost', lost);

  buildAll();
  setRunning(!document.hidden);

  let gone = false;
  return {
    update(d: OfficeSceneData): void {
      if (gone || JSON.stringify(d) === JSON.stringify(data)) return;
      const before = new Map<string, DeskState>();
      for (const f of data.floors) for (const r of f.rooms) for (const p of r.people) before.set(p.key, p.state);
      data = d;
      queue = [];
      buildAll();
      // Someone who has just clocked in walks in from the lift.
      if (!reduced) {
        queue = [];
        floors.forEach((fv, fi) =>
          fv.desks.forEach((dk, i) => {
            dk.walking = false;
            if (dk.state === 'in_now' && before.get(dk.key) !== 'in_now' && before.has(dk.key) && dk.since !== null && dk.since <= WALK_MIN) {
              dk.walking = true;
              queue.push({ floor: fi, desk: i });
            }
          }),
        );
        for (let i = 0; i < floors.length; i++) writeFloor(i);
        if (queue.length > 0) spawnIn = 0.6;
      }
      if (focus !== null && !floors.some((f) => f.key === focus || f.desks.some((x) => x.key === focus))) setHover(null);
      kick();
    },
    setReduced(on: boolean): void {
      reduced = on;
      if (on) {
        for (const w of walkers) {
          for (const m of w.mats) m.dispose();
          w.group.parent?.remove(w.group);
        }
        walkers = [];
        queue = [];
        for (const f of floors) for (const d of f.desks) d.walking = false;
        for (let i = 0; i < floors.length; i++) writeFloor(i);
        renderer.shadowMap.needsUpdate = true;
      }
      kick();
    },
    dispose(): void {
      gone = true;
      setRunning(false);
      if (pickQueued !== 0) cancelAnimationFrame(pickQueued);
      if (pendingSelect !== 0) clearTimeout(pendingSelect);
      clearInterval(clockTimer);
      ro.disconnect();
      io.disconnect();
      stopTheme();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('contextmenu', onMenu);
      canvas.removeEventListener('webglcontextlost', lost);
      anchor.removeEventListener('pointerleave', onAnchorLeave);
      clearBuilding();
      for (const m of hullMats) m.dispose();
      ringMat.dispose();
      hull.ring.geometry.dispose();
      if (kit !== null) for (const g of Object.values(kit)) g.dispose();
      kit = null;
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

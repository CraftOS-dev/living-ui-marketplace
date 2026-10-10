/**
 * The stockroom map's 3D engine (three.js), driven by the StockMap card.
 *
 * A fixed isometric view (orthographic camera, 45 degrees around and about
 * 35 degrees above the floor) that can be moved and zoomed but never turned.
 * It draws only when something changes (a move, an animation, new data), so
 * an idle Home page costs nothing. Every color comes from the theme palette
 * the card passes in; the stock states keep their fixed colors. Places are
 * drawn by models.ts, items by their shape (shapes.ts) as instanced parts.
 *
 * Gestures: drag to move around, scroll or pinch to zoom. A press on an item
 * takes the gesture instead: a click selects it, a drag (on touch: press and
 * hold first) carries it, centred on the pointer, to another place and asks
 * the card to move the stock there. In arrange mode a press on any place
 * picks it (a base, a room in a site, a shelf in a room) and drags it within
 * the space it stands in; its corner handles resize it. Everything snaps to
 * the arrange grid, may not overlap what stands next to it or leave its
 * space, and is saved in one go.
 */
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Spherical,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { qty } from '../../lib/format.ts';
import { FOOT, PAD, centre, inside, overlaps, plinthSize, snapGrid, snapUpGrid, zoneMin } from './layout.ts';
import type { Rect, Slot, Unit, World, Zone } from './layout.ts';
import { buildBase, buildUnit, flatRect, shapeParts } from './models.ts';
import type { Mats, Part, Tone } from './models.ts';
import { SHAPES, STACK_GAP, clusterOffsets, clusterScale } from './shapes.ts';
import type { ItemShape } from './shapes.ts';

export interface Palette {
  /** Outlines of what is selected or carried. */
  mark: string;
  card: string;
  sand: string;
  row: string;
  line: string;
  ink: string;
  ink2: string;
  accent: string;
  green: string;
  amber: string;
  red: string;
}

export type Pick = { type: 'zone'; id: string } | { type: 'unit'; id: string } | { type: 'slot'; key: string };

/** A place's new layout from arrange mode: centre (top level: on the floor; inside a space: from its far corner) and size. */
export interface Placement {
  id: string;
  x: number;
  z: number;
  w?: number;
  d?: number;
}

export interface MapEvents {
  /** The thing under the pointer changed (x, y relative to the host). */
  hover: (pick: Pick | null, x: number, y: number) => void;
  select: (pick: Pick | null) => void;
  /** An item was dropped on another place. */
  move: (slot: Slot, to: string, clientX: number, clientY: number) => void;
  /** While an item is carried: what and where it would go (host px), null when it is put down. */
  carry: (info: { slot: Slot; to: string | null; x: number; y: number } | null) => void;
  /** Arrange mode: places moved or resized; save them all. */
  arrange: (placements: Placement[]) => void;
  /** Arrange mode: the place picked to arrange (its name and size), or null. */
  arrangeFocus: (info: { name: string; w: number; d: number } | null) => void;
  refuse: (message: string) => void;
  /** The first touch, drag or scroll on the map. */
  interact: () => void;
}

export type StatusFilter = 'low' | 'out' | 'over' | null;

/** The fixed view: 45 degrees around, the isometric angle above the floor. */
const POLAR = Math.acos(1 / Math.sqrt(3));
const AZIMUTH = Math.PI / 4;

/* ------------------------------------------------------------------ math */

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number): number => {
  const c = 1.5;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
function easeBounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const metres = (v: number): string => (Math.round(v * 100) / 100).toString();

/** "rgb(1 2 3)", "rgb(1, 2, 3)" or "#rrggbb" as a three.js color (sRGB in, linear inside). */
function colorOf(css: string, out = new Color()): Color {
  const s = css.trim();
  if (s.startsWith('#')) {
    const hex = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1, 7);
    const v = parseInt(hex, 16);
    return out.setRGB(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, SRGBColorSpace);
  }
  const n = (s.match(/[\d.]+/g) ?? []).map(Number);
  return out.setRGB((n[0] ?? 0) / 255, (n[1] ?? 0) / 255, (n[2] ?? 0) / 255, SRGBColorSpace);
}

interface Tween {
  start: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
  /** A camera flight: a pan or zoom by the user takes over from it. */
  camera?: boolean;
}

/** One drawn item (one of the one to three in a spot). */
interface Obj {
  id: string;
  slot: Slot;
  zone: string;
  /** Offset within the spot (a cluster) and its size there. */
  ox: number;
  oz: number;
  size: number;
  x: number;
  y: number;
  z: number;
  /** Animation clocks (ms, performance.now), 0 when idle. */
  born: number;
  bornDelay: number;
  pop: boolean;
  dying: number;
  flash: number;
  /** Where a moved one glides from. */
  from: Vector3 | null;
  moved: number;
}

/** One part of one shape, drawn for every item of that shape. */
interface PartMesh {
  mesh: InstancedMesh;
  part: Part;
  owners: Obj[];
  count: number;
}

/** What arrange mode works on: a base, or a place standing in a space. */
type Target = { kind: 'zone'; zone: Zone } | { kind: 'unit'; unit: Unit };

type Drag =
  | { kind: 'press'; slot: Slot; x: number; y: number; id: number; touch: boolean; timer: number; swiped: boolean }
  | { kind: 'carry'; slot: Slot; id: number; carried: Group; target: string | null; startPoint: Vector3 }
  | { kind: 'move'; target: Target; id: number; plane: Plane; grab: Vector3; start: Rect; base: Vector3; rect: Rect; why: string | null; moved: boolean; cx: number; cy: number }
  | { kind: 'resize'; target: Target; id: number; plane: Plane; corner: number; start: Rect; limits: Limits; rect: Rect; why: string | null; cx: number; cy: number; live: boolean };

/** How far (px) a press must travel before it moves or resizes anything: a tap never does. */
const TAP = 4;

/** How small (and, inside a space, how big) a resize may go, for the corner being dragged. */
interface Limits {
  minW: number;
  minD: number;
  maxW: number;
  maxD: number;
}

/* ---------------------------------------------------------------- engine */

export class MapEngine {
  private readonly host: HTMLElement;
  private readonly labelsEl: HTMLElement;
  private readonly events: MapEvents;
  private readonly motion: boolean;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, -200, 400);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly frustum = 10;
  private size = { w: 1, h: 1 };
  private inset = { right: 0, bottom: 0 };

  private readonly ambient = new AmbientLight(0xffffff, 0.72 * Math.PI);
  private readonly sun = new DirectionalLight(0xffffff, 0.42 * Math.PI);
  private readonly catcher: Mesh;
  private readonly grid: GridHelper;

  private readonly world = new Group();
  private readonly fx = new Group();
  private readonly mats: Mats = {
    floor: new MeshLambertMaterial(),
    row: new MeshLambertMaterial(),
    card: new MeshLambertMaterial(),
    ink2: new MeshLambertMaterial(),
    shade: new MeshLambertMaterial(),
    line: new MeshLambertMaterial(),
    tub: new MeshLambertMaterial(),
    kraft: new MeshLambertMaterial(),
    beam: new MeshLambertMaterial(),
    steel: new MeshLambertMaterial(),
    glass: new MeshLambertMaterial({ transparent: true, opacity: 0.3, depthWrite: false }),
    inset: new LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    dash: new LineDashedMaterial({ dashSize: 0.14, gapSize: 0.1 }),
  };
  private readonly fxMats = {
    item: new MeshLambertMaterial({ color: 0xffffff }),
    ghost: new MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false }),
    ghostLine: new LineDashedMaterial({ dashSize: 0.045, gapSize: 0.035 }),
    outline: new MeshBasicMaterial({ side: BackSide, transparent: true, opacity: 0.95 }),
    edge: new LineBasicMaterial(),
    refuse: new LineBasicMaterial(),
    // The arrange ring is drawn over everything, so it shows over a raised floor.
    ring: new LineBasicMaterial({ depthTest: false, transparent: true }),
    ringBad: new LineBasicMaterial({ depthTest: false, transparent: true }),
  };
  private readonly zoneMats = new Map<string, MeshLambertMaterial>();
  private readonly palette = {
    card: new Color(),
    accent: new Color(),
    neutral: new Color(),
    ok: new Color(),
    low: new Color(),
    out: new Color(),
    over: new Color(),
  };

  private readonly parts: Record<ItemShape, Part[]> = shapeParts();
  private readonly partMeshes = new Map<string, PartMesh>();
  private readonly meshPart = new Map<Object3D, PartMesh>();
  private objs: Obj[] = [];
  private readonly zoneGroups = new Map<string, Group>();
  private readonly unitGroups = new Map<string, Group>();
  /**
   * How far a base, or a place in a space, has been dragged and not yet
   * redrawn from saved data: each its own drag; what stands in a space adds
   * up the drags of every space around it.
   */
  private readonly zoneOffset = new Map<string, Vector3>();
  private readonly unitOffset = new Map<string, Vector3>();
  private readonly ghostGroups: Group[] = [];
  private readonly labels = new Map<string, HTMLButtonElement>();
  private unitLabel: HTMLDivElement | null = null;
  private readonly handles: HTMLButtonElement[] = [];
  private readonly sizeTag: HTMLDivElement;
  private readonly outlines: Mesh[] = [];
  private hoverEdge: LineSegments | null = null;
  private selectEdge: LineSegments | null = null;
  private ring: Line | null = null;

  private data: World | null = null;
  private hover: Pick | null = null;
  private selected: Pick | null = null;
  private focus: string | null = null;
  private filter: StatusFilter = null;
  private arranging = false;
  /** The place picked in arrange mode (a zone or unit id). */
  private arrangeSel: string | null = null;
  private drag: Drag | null = null;
  private down: { x: number; y: number; t: number; pick: Pick | null; id: number } | null = null;
  private dropTarget: string | null = null;

  private tweens: Tween[] = [];
  private ghostPulseUntil = 0;
  private raf = 0;
  private disposed = false;
  private readonly resize: ResizeObserver;
  private readonly tmpO = new Object3D();
  private readonly tmpM = new Matrix4();
  private readonly tmpC = new Color();
  private readonly tmpT = new Color();
  private readonly white = new Color(1, 1, 1);
  private readonly zero = new Vector3();

  constructor(host: HTMLElement, labelsEl: HTMLElement, events: MapEvents, motion: boolean) {
    this.host = host;
    this.labelsEl = labelsEl;
    this.events = events;
    this.motion = motion;

    // Throws when the browser cannot draw WebGL; the card shows its fallback.
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    canvas.style.cursor = 'grab';
    host.appendChild(canvas);

    this.scene.add(this.ambient, this.sun, this.sun.target, this.world, this.fx);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;

    this.catcher = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ opacity: 0.1 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.receiveShadow = true;
    this.scene.add(this.catcher);

    this.grid = new GridHelper(80, 320);
    const gm = this.grid.material as Material;
    gm.transparent = true;
    gm.opacity = 0.4;
    this.grid.visible = false;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    for (const shape of Object.keys(this.parts) as ItemShape[]) this.ensureParts(shape, 16);

    // Corner handles and a size readout for arrange mode (DOM, over the canvas).
    // On screen a footprint is a diamond: its far corner on top, then right, front and left.
    const cursors = ['ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'];
    for (let i = 0; i < 4; i++) {
      const hnd = document.createElement('button');
      hnd.type = 'button';
      hnd.setAttribute('aria-label', 'Drag to resize');
      hnd.className =
        'pointer-events-auto absolute left-0 top-0 hidden size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--iv-card)] touch-none';
      hnd.style.cursor = cursors[i] ?? 'nwse-resize';
      const corner = i;
      hnd.addEventListener('pointerdown', (e) => this.startResize(e, corner, hnd));
      hnd.addEventListener('pointermove', (e) => this.onHandleMove(e));
      hnd.addEventListener('pointerup', (e) => this.onHandleUp(e, hnd));
      hnd.addEventListener('pointercancel', (e) => this.onHandleUp(e, hnd));
      labelsEl.appendChild(hnd);
      this.handles.push(hnd);
    }
    this.sizeTag = document.createElement('div');
    this.sizeTag.className =
      'iv-on-ink pointer-events-none absolute left-0 top-0 hidden whitespace-nowrap rounded-full bg-[var(--iv-ink)] px-2.5 py-1 text-[12px] font-semibold text-[var(--iv-shell)] shadow-lg';
    labelsEl.appendChild(this.sizeTag);

    // The one view: isometric, never turned.
    this.camera.position.setFromSpherical(new Spherical(60, POLAR, AZIMUTH));
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableRotate = false;
    c.minPolarAngle = POLAR;
    c.maxPolarAngle = POLAR;
    c.minAzimuthAngle = AZIMUTH;
    c.maxAzimuthAngle = AZIMUTH;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.zoomSpeed = 1.1;
    c.panSpeed = 1;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    c.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN };
    c.addEventListener('change', this.onControlsChange);
    c.addEventListener('start', this.onControlsStart);

    this.raycaster.params.Line = { threshold: 0.02 };
    host.addEventListener('pointerdown', this.onDown, { capture: true });
    host.addEventListener('pointermove', this.onMove);
    host.addEventListener('pointerup', this.onUp);
    host.addEventListener('pointercancel', this.onCancel);
    host.addEventListener('pointerleave', this.onLeave);
    host.addEventListener('contextmenu', this.onContextMenu);
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(host);
    this.onResize();
  }

  /* ----------------------------------------------------------- public api */

  setPalette(p: Palette): void {
    const m = this.mats;
    colorOf(p.sand, m.floor.color);
    colorOf(p.row, m.row.color);
    colorOf(p.card, m.card.color);
    colorOf(p.ink2, m.ink2.color);
    colorOf(p.line, m.line.color);
    colorOf(p.line, m.inset.color);
    colorOf(p.ink2, m.dash.color);
    colorOf(p.card, this.palette.card);
    colorOf(p.accent, this.palette.accent);
    colorOf(p.ink2, this.palette.neutral);
    colorOf(p.green, this.palette.ok);
    colorOf(p.amber, this.palette.low);
    colorOf(p.red, this.palette.out);
    colorOf(p.ink2, this.palette.over);
    // Tyres and gaps: whichever of ink and card is darker.
    const ink = colorOf(p.ink);
    const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    m.shade.color.copy(lum(ink) < lum(this.palette.card) ? ink : this.palette.card);
    m.tub.color.copy(this.palette.accent).lerp(this.palette.card, 0.55);
    m.kraft.color.copy(m.floor.color).lerp(this.palette.accent, 0.12).multiplyScalar(0.82);
    m.beam.color.copy(this.palette.accent).lerp(this.palette.card, 0.12);
    m.steel.color.copy(m.ink2.color).lerp(this.palette.card, 0.35);
    colorOf(p.line, m.glass.color);
    colorOf(p.red, this.fxMats.ghost.color);
    colorOf(p.red, this.fxMats.ghostLine.color);
    colorOf(p.mark, this.fxMats.outline.color);
    colorOf(p.mark, this.fxMats.edge.color);
    colorOf(p.red, this.fxMats.refuse.color);
    colorOf(p.mark, this.fxMats.ring.color);
    colorOf(p.red, this.fxMats.ringBad.color);
    // Resize handles: a card dot ringed in the selection color (the accent, or the ink where the accent is faint).
    for (const hnd of this.handles) hnd.style.boxShadow = `0 0 0 3px ${p.mark}, 0 4px 10px -4px rgba(0, 0, 0, 0.5)`;
    colorOf(p.ink, (this.catcher.material as ShadowMaterial).color);
    colorOf(p.line, (this.grid.material as LineBasicMaterial).color);
    for (const zm of this.zoneMats.values()) zm.color.copy(m.floor.color);
    this.request();
  }

  setWorld(next: World): void {
    if (this.drag?.kind === 'move' || this.drag?.kind === 'resize') this.cancelGesture();
    // Items on a place that was just dragged stay where they were dropped (the new layout puts them there).
    for (const o of this.objs) {
      const off = this.shiftOf(o.zone, o.slot.unit);
      o.x += off.x;
      o.z += off.z;
      if (o.from !== null) o.from.add(off);
    }
    const prev = this.data;
    this.data = next;
    this.buildStatic(next);
    this.buildItems(next, prev);
    this.buildGhosts(next);
    this.buildLabels(next);
    this.placeShadowCamera(next);
    if (this.arrangeSel !== null && this.targetById(this.arrangeSel) === null) this.arrangeSel = null;
    this.applyHighlights();
    this.reportFocus();
    if (prev === null) {
      this.fit(false);
      if (this.motion && prev === null) this.intro();
    }
    this.request();
  }

  setFilter(f: StatusFilter): void {
    this.filter = f;
    if (f === 'out') this.ghostPulseUntil = performance.now() + 2600;
    for (const g of this.ghostGroups) g.visible = f === null || f === 'out';
    this.request();
  }

  setArrange(on: boolean): void {
    this.arranging = on;
    this.grid.visible = on;
    if (!on) this.arrangeSel = null;
    for (const l of this.labels.values()) l.classList.toggle('iv-map-arrange', on);
    this.renderer.domElement.style.cursor = on ? 'move' : 'grab';
    this.setHover(null);
    this.applyHighlights();
    this.reportFocus();
    this.request();
  }

  /** Space covered by the panel (on the right, or a sheet at the bottom); the view centres in what is left. */
  setInset(right: number, bottom = 0): void {
    this.inset = { right: Math.max(0, Math.min(right, this.size.w - 160)), bottom: Math.max(0, Math.min(bottom, this.size.h - 120)) };
    this.applyFrustum();
    this.request();
  }

  select(pick: Pick | null, fly = true): void {
    this.selected = pick;
    this.applyHighlights();
    if (fly && pick !== null) {
      const box = this.boxOf(pick);
      if (box !== null) this.flyTo(box, pick.type === 'slot' ? 3.2 : pick.type === 'unit' ? 1.9 : 1.35);
    }
    this.request();
  }

  /** Outline every spot of one item and frame them. */
  focusItem(itemId: string | null, fly = true): void {
    this.focus = itemId;
    this.applyHighlights();
    if (fly && itemId !== null && this.data !== null) {
      const slots = this.data.slots.filter((s) => s.item.id === itemId);
      const box = this.boxOfSlots(slots);
      if (box !== null) this.flyTo(box, slots.length === 1 ? 3.2 : 1.6);
    }
    this.request();
  }

  zoomBy(f: number): void {
    const from = this.camera.zoom;
    const to = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, from * f));
    this.animate(
      this.motion ? 260 : 0,
      (k) => {
        this.camera.zoom = from + (to - from) * easeOut(k);
        this.camera.updateProjectionMatrix();
      },
      undefined,
      true,
    );
  }

  /** Move the view by a step across the screen (keyboard arrows). */
  pan(dx: number, dy: number): void {
    const step = 1.2 / this.camera.zoom;
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const d = right.multiplyScalar(dx * step).add(up.multiplyScalar(dy * step));
    const t0 = this.controls.target.clone();
    const p0 = this.camera.position.clone();
    this.animate(
      this.motion ? 220 : 0,
      (k) => {
        const e = easeOut(k);
        this.controls.target.copy(t0).addScaledVector(d, e);
        this.camera.position.copy(p0).addScaledVector(d, e);
      },
      undefined,
      true,
    );
  }

  /** Frame everything. */
  fit(animated = true): void {
    if (this.data === null) return;
    const b = this.data.bounds;
    this.flyTo({ min: new Vector3(b.minX, 0, b.minZ), max: new Vector3(b.maxX, b.maxY, b.maxZ) }, 1.04, animated ? 700 : 0, true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    const h = this.host;
    h.removeEventListener('pointerdown', this.onDown, { capture: true });
    h.removeEventListener('pointermove', this.onMove);
    h.removeEventListener('pointerup', this.onUp);
    h.removeEventListener('pointercancel', this.onCancel);
    h.removeEventListener('pointerleave', this.onLeave);
    h.removeEventListener('contextmenu', this.onContextMenu);
    if (this.drag?.kind === 'press') window.clearTimeout(this.drag.timer);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry !== undefined) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const list of Object.values(this.parts)) for (const p of list) p.geo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const m of Object.values(this.fxMats)) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();
    for (const hnd of this.handles) hnd.remove();
    this.sizeTag.remove();
    this.unitLabel?.remove();
  }

  /** Escape while carrying or arranging: put it back. */
  cancelGesture(): boolean {
    const d = this.drag;
    if (d === null) return false;
    if (d.kind === 'press') window.clearTimeout(d.timer);
    if (d.kind === 'carry') {
      this.dropCarried(d.carried);
      this.events.carry(null);
    }
    if (d.kind === 'move') {
      this.offsetOf(d.target).copy(d.base);
      this.shiftTarget(d.target);
    }
    this.renderer.domElement.style.cursor = this.arranging ? 'move' : 'grab';
    this.clearRing();
    this.sizeTag.classList.add('hidden');
    if (this.host.hasPointerCapture(d.id)) this.host.releasePointerCapture(d.id);
    this.drag = null;
    this.holdView(false);
    this.dropTarget = null;
    this.hover = null;
    this.applyHighlights();
    this.reportFocus();
    return true;
  }

  /** While an item is carried or a place is arranged, the view stays put. */
  private holdView(on: boolean): void {
    this.controls.enabled = !on;
  }

  /* ------------------------------------------------------------ building */

  private clearGroup(g: Group): void {
    g.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry !== undefined) m.geometry.dispose();
    });
    g.removeFromParent();
  }

  private buildStatic(w: World): void {
    for (const g of this.zoneGroups.values()) this.clearGroup(g);
    this.zoneGroups.clear();
    this.unitGroups.clear();
    for (const m of this.zoneMats.values()) m.dispose();
    this.zoneMats.clear();
    this.zoneOffset.clear();
    this.unitOffset.clear();
    for (const z of w.zones) {
      const g = new Group();
      g.userData['pick'] = { type: 'zone', id: z.id } satisfies Pick;
      const mat = this.mats.floor.clone();
      this.zoneMats.set(z.id, mat);
      g.add(buildBase(z, this.mats, mat));
      for (const u of z.units) {
        const ug = buildUnit(u, this.mats);
        ug.userData['pick'] = { type: 'unit', id: u.id } satisfies Pick;
        g.add(ug);
        this.unitGroups.set(u.id, ug);
      }
      this.world.add(g);
      this.zoneGroups.set(z.id, g);
      this.zoneOffset.set(z.id, new Vector3());
    }
  }

  /** Make sure every part mesh of a shape can draw `n` of it. */
  private ensureParts(shape: ItemShape, n: number): void {
    this.parts[shape].forEach((part, i) => {
      const key = `${shape}#${i}`;
      const have = this.partMeshes.get(key);
      if (have !== undefined && have.mesh.instanceMatrix.count >= n) return;
      const cap = Math.max(16, 1 << Math.ceil(Math.log2(n + 1)));
      if (have !== undefined) {
        this.meshPart.delete(have.mesh);
        have.mesh.removeFromParent();
        have.mesh.dispose();
      }
      const mesh = new InstancedMesh(part.geo, this.fxMats.item, cap);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.white);
      this.world.add(mesh);
      const pm: PartMesh = { mesh, part, owners: [], count: 0 };
      this.partMeshes.set(key, pm);
      this.meshPart.set(mesh, pm);
    });
  }

  private objId(s: Slot, i: number): string {
    return `${s.key}#${i}`;
  }

  private buildItems(w: World, prev: World | null): void {
    const now = performance.now();
    const old = new Map(this.objs.filter((o) => o.dying === 0).map((o) => [o.id, o]));
    const oldQty = new Map<string, number>();
    if (prev !== null) for (const s of prev.slots) oldQty.set(s.key, s.qty);
    const next: Obj[] = [];
    const perShape = new Map<ItemShape, number>();
    let order = 0;
    for (const s of w.slots) {
      if (s.boxes === 0) continue;
      const zone = w.zoneOf.get(s.place) ?? '';
      const meta = SHAPES[s.shape];
      const changed = prev !== null && oldQty.has(s.key) && oldQty.get(s.key) !== s.qty;
      const offs = clusterOffsets(s.boxes);
      for (let i = 0; i < s.boxes; i++) {
        const id = this.objId(s, i);
        const up = meta.stack === 'up';
        const off = up ? [0, 0] : (offs[i] ?? [0, 0]);
        const o: Obj = {
          id,
          slot: s,
          zone,
          ox: off[0] ?? 0,
          oz: off[1] ?? 0,
          size: up ? 1 : clusterScale(s.boxes),
          x: s.x,
          y: s.y + (up ? i * (meta.h + STACK_GAP) : 0),
          z: s.z,
          born: 0,
          bornDelay: 0,
          pop: false,
          dying: 0,
          flash: 0,
          from: null,
          moved: 0,
        };
        const was = old.get(id);
        if (was !== undefined && was.slot.shape === s.shape) {
          old.delete(id);
          o.born = was.born;
          o.bornDelay = was.bornDelay;
          o.pop = was.pop;
          if (this.motion && (Math.abs(was.x + was.ox - o.x - o.ox) > 0.001 || Math.abs(was.y - o.y) > 0.001 || Math.abs(was.z + was.oz - o.z - o.oz) > 0.001)) {
            o.from = new Vector3(was.x + was.ox - o.ox, was.y, was.z + was.oz - o.oz);
            o.moved = now;
          }
        } else if (prev !== null && this.motion) {
          // Arrived since the last picture: one more on a known spot pops, a new spot drops in.
          o.born = now;
          o.pop = oldQty.has(s.key);
          o.bornDelay = o.pop ? 0 : Math.min(order * 30, 300);
        }
        if (changed && this.motion) o.flash = now;
        next.push(o);
        perShape.set(s.shape, (perShape.get(s.shape) ?? 0) + 1);
        order++;
      }
    }
    // What left shrinks away.
    if (this.motion && prev !== null) {
      for (const o of old.values()) {
        o.dying = now;
        next.push(o);
        perShape.set(o.slot.shape, (perShape.get(o.slot.shape) ?? 0) + 1);
      }
    }
    this.objs = next;
    for (const [shape, n] of perShape) this.ensureParts(shape, n);
    this.stepItems(now);
  }

  private statusColor(s: Slot, out: Color): Color {
    const st = s.item.status;
    return out.copy(st === 'low' ? this.palette.low : st === 'out' ? this.palette.out : st === 'over' ? this.palette.over : this.palette.ok);
  }

  private toneColor(tone: Tone, body: Color, fade: number, out: Color): Color {
    if (tone === 'neutral') out.copy(this.palette.neutral);
    else if (tone === 'dark') out.copy(body).multiplyScalar(0.72);
    else if (tone === 'light') out.copy(body).lerp(this.white, 0.55);
    else out.copy(body);
    if (fade > 0) out.lerp(this.palette.card, fade);
    return out;
  }

  /** How far a unit has been dragged with the spaces around it (its base's drag not included). */
  private chain(unit: string | null): Vector3 {
    const out = new Vector3();
    const units = this.data?.units;
    for (let id = unit, n = 0; id !== null && n < 64; n++) {
      const o = this.unitOffset.get(id);
      if (o !== undefined) out.add(o);
      id = units?.get(id)?.parent ?? null;
    }
    return out;
  }

  /** How far a unit (and what is on it) has been dragged in arrange mode, its base's drag included. */
  private shiftOf(zone: string, unit: string | null): Vector3 {
    const z = this.zoneOffset.get(zone) ?? this.zero;
    return this.chain(unit).add(new Vector3(z.x, 0, z.z));
  }

  /** Place and color every item part for this moment; true while anything still moves. */
  private stepItems(now: number): boolean {
    let busy = false;
    const carrying = this.drag?.kind === 'carry' ? this.drag.slot.key : null;
    const hovered = this.hover?.type === 'slot' ? this.hover.key : null;
    for (const pm of this.partMeshes.values()) pm.count = 0;
    const keep: Obj[] = [];
    for (const o of this.objs) {
      let scale = o.size;
      let dy = 0;
      if (o.dying !== 0) {
        const k = clamp01((now - o.dying) / 280);
        if (k >= 1) continue;
        scale *= 1 - easeOut(k);
        busy = true;
      }
      if (o.born !== 0) {
        const k = clamp01((now - o.born - o.bornDelay) / (o.pop ? 360 : 620));
        if (k < 1) busy = true;
        if (o.pop) scale *= Math.max(0.001, easeBack(k));
        else dy = (1 - easeBounce(k)) * 1.6;
        if (now - o.born - o.bornDelay < 0) scale = 0.001;
      }
      const off = this.shiftOf(o.zone, o.slot.unit);
      let x = o.x + off.x;
      let y = o.y + dy + (hovered === o.slot.key ? 0.06 : 0);
      let z = o.z + off.z;
      if (o.from !== null) {
        const k = clamp01((now - o.moved) / 450);
        if (k < 1) {
          const e = easeInOut(k);
          x = o.from.x + off.x + (x - o.from.x - off.x) * e;
          y = o.from.y + (y - o.from.y) * e;
          z = o.from.z + off.z + (z - o.from.z - off.z) * e;
          busy = true;
        } else o.from = null;
      }
      this.tmpO.position.set(x + o.ox, y, z + o.oz);
      this.tmpO.scale.set(scale, scale, scale);
      this.tmpO.updateMatrix();

      const body = this.statusColor(o.slot, this.tmpT);
      if (o.flash !== 0) {
        const k = clamp01((now - o.flash) / 1100);
        if (k < 1) {
          body.lerp(this.white, 0.5 * (1 - k));
          busy = true;
        } else o.flash = 0;
      }
      const fade =
        carrying === o.slot.key ? 0.7 : this.filter !== null && o.slot.item.status !== this.filter ? 0.78 : this.focus !== null && o.slot.item.id !== this.focus ? 0.55 : 0;

      this.parts[o.slot.shape].forEach((part, i) => {
        const pm = this.partMeshes.get(`${o.slot.shape}#${i}`);
        if (pm === undefined || pm.count >= pm.mesh.instanceMatrix.count) return;
        this.tmpM.multiplyMatrices(this.tmpO.matrix, part.local);
        pm.mesh.setMatrixAt(pm.count, this.tmpM);
        pm.mesh.setColorAt(pm.count, this.toneColor(part.tone, body, fade, this.tmpC));
        pm.owners[pm.count] = o;
        pm.count++;
      });
      keep.push(o);
    }
    this.objs = keep;
    for (const pm of this.partMeshes.values()) {
      pm.mesh.count = pm.count;
      pm.owners.length = pm.count;
      pm.mesh.instanceMatrix.needsUpdate = true;
      if (pm.mesh.instanceColor !== null) pm.mesh.instanceColor.needsUpdate = true;
      if (pm.count > 0) pm.mesh.computeBoundingSphere();
    }
    return busy;
  }

  /* ------------------------------------------------------------- ghosts */

  private buildGhosts(w: World): void {
    for (const g of this.ghostGroups) this.clearGroup(g);
    this.ghostGroups.length = 0;
    for (const s of w.slots) {
      if (s.boxes > 0) continue;
      const g = new Group();
      g.userData['pick'] = { type: 'slot', key: s.key } satisfies Pick;
      g.userData['zone'] = w.zoneOf.get(s.place) ?? '';
      g.userData['unit'] = s.unit;
      const plane = new Mesh(new PlaneGeometry(FOOT.w - 0.02, FOOT.d - 0.02), this.fxMats.ghost);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(s.x, s.y + 0.006, s.z);
      g.add(plane);
      g.add(flatRect(s.x, s.y + 0.008, s.z, FOOT.w - 0.02, FOOT.d - 0.02, 0.03, this.fxMats.ghostLine, true));
      g.visible = this.filter === null || this.filter === 'out';
      this.world.add(g);
      this.ghostGroups.push(g);
    }
    this.ghostPulseUntil = performance.now() + 2600;
  }

  /* ------------------------------------------------------------- labels */

  /** Spaces standing inside another (a room in a site): they get a name label of their own. */
  private nestedSpaces(w: World): Unit[] {
    return [...w.units.values()].filter((u) => !u.floor && !u.self && (u.model === 'room' || u.model === 'deck' || u.model === 'container' || u.model === 'van'));
  }

  private buildLabels(w: World): void {
    const seen = new Set<string>();
    for (const u of this.nestedSpaces(w)) {
      seen.add(u.id);
      let el = this.labels.get(u.id);
      if (el === undefined) {
        el = document.createElement('button');
        el.type = 'button';
        el.className =
          'iv-map-label pointer-events-auto absolute left-0 top-0 max-w-[180px] truncate rounded-full bg-[var(--iv-card)] px-2.5 py-1 text-[12px] font-semibold leading-4 text-[var(--iv-ink)] shadow-[0_6px_16px_-10px_rgba(0,0,0,0.45)] ring-1 ring-[var(--iv-line)] transition-opacity duration-200 will-change-transform';
        el.dataset['unit'] = '1';
        const unitId = u.id;
        el.addEventListener('click', () => {
          if (this.arranging) return;
          this.events.interact();
          this.events.select({ type: 'unit', id: unitId });
        });
        el.addEventListener('pointerdown', (e) => this.labelDown(e, unitId));
        el.addEventListener('pointerenter', () => this.setHover({ type: 'unit', id: unitId }));
        el.addEventListener('pointerleave', () => this.setHover(null));
        this.labelsEl.insertBefore(el, this.labelsEl.firstChild);
        this.labels.set(u.id, el);
      }
      el.textContent = u.place.name;
      el.setAttribute('aria-label', u.place.name);
      el.classList.toggle('iv-map-arrange', this.arranging);
    }
    for (const z of w.zones) {
      seen.add(z.id);
      let el = this.labels.get(z.id);
      if (el === undefined) {
        el = document.createElement('button');
        el.type = 'button';
        el.className =
          'iv-map-label pointer-events-auto absolute left-0 top-0 flex max-w-[220px] flex-col items-center rounded-[14px] bg-[var(--iv-card)] px-3 py-1.5 text-center shadow-[0_8px_20px_-12px_rgba(0,0,0,0.45)] ring-1 ring-[var(--iv-line)] transition-[box-shadow,opacity] duration-200 will-change-transform';
        const zoneId = z.id;
        el.addEventListener('click', () => {
          if (this.arranging) return;
          this.events.interact();
          this.events.select({ type: 'zone', id: zoneId });
        });
        el.addEventListener('pointerdown', (e) => this.labelDown(e, zoneId));
        el.addEventListener('pointerenter', () => this.setHover({ type: 'zone', id: zoneId }));
        el.addEventListener('pointerleave', () => this.setHover(null));
        this.labelsEl.insertBefore(el, this.labelsEl.firstChild);
        this.labels.set(z.id, el);
      }
      const holds = new Set(z.holds);
      let units = 0;
      const items = new Set<string>();
      for (const s of w.slots) {
        if (!holds.has(s.place) || s.boxes === 0) continue;
        units += s.qty;
        items.add(s.item.id);
      }
      el.replaceChildren();
      const name = document.createElement('span');
      name.className = 'block max-w-full truncate text-[13px] font-bold leading-[18px] text-[var(--iv-ink)]';
      name.textContent = z.place.name;
      const meta = document.createElement('span');
      meta.className = 'iv-map-meta num block text-[12px] leading-4 text-[var(--iv-muted)]';
      meta.textContent = items.size === 0 ? 'Empty' : `${items.size} ${items.size === 1 ? 'item' : 'items'} · ${qty(units)} ${units === 1 ? 'unit' : 'units'}`;
      el.append(name, meta);
      el.setAttribute('aria-label', `${z.place.name}: ${meta.textContent}`);
      el.classList.toggle('iv-map-arrange', this.arranging);
    }
    for (const [id, el] of this.labels) {
      if (seen.has(id)) continue;
      el.remove();
      this.labels.delete(id);
    }
  }

  private project(v: Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.size.w, y: ((1 - p.y) / 2) * this.size.h };
  }

  /**
   * Each base's label stands on its own base, near the edge closest to the
   * viewer; a space inside another gets a smaller one. A narrow map shows
   * names only; where two labels still collide the one further back steps
   * aside (hovering its place still names it). In arrange mode the picked
   * place shows its corner handles.
   */
  private placeLabels(): void {
    if (this.data === null) return;
    const sel = this.selected?.type === 'zone' ? this.selected.id : null;
    this.labelsEl.classList.toggle('iv-map-compact', this.size.w < 560);
    const placed: { id: string; el: HTMLButtonElement; x: number; y: number; w: number; h: number; visible: boolean; base: boolean }[] = [];
    const selUnit = this.selected?.type === 'unit' ? this.selected.id : null;
    const put = (id: string, el: HTMLButtonElement, p: { x: number; y: number }, base: boolean, ring: boolean): void => {
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      const visible = p.x > -lw / 2 && p.x < this.size.w + lw / 2 && p.y < this.size.h + lh && p.y > -lh;
      const x = Math.round(Math.min(this.size.w - lw - 4, Math.max(4, p.x - lw / 2)));
      const y = Math.round(Math.min(this.size.h - lh - 4, Math.max(4, p.y - lh / 2)));
      placed.push({ id, el, x, y, w: lw, h: lh, visible, base });
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.toggle('ring-2', ring);
      el.classList.toggle('ring-[var(--iv-accent)]', ring);
    };
    for (const u of this.nestedSpaces(this.data)) {
      const el = this.labels.get(u.id);
      if (el === undefined) continue;
      const r = this.unitRect(u);
      const c = centre(r);
      const near = { x: r.x + r.w, z: r.z + r.d };
      put(u.id, el, this.project(new Vector3(near.x + (c.x - near.x) * 0.3, u.base + (u.levels[0] ?? 0), near.z + (c.z - near.z) * 0.3)), false, selUnit === u.id);
    }
    for (const z of this.data.zones) {
      const el = this.labels.get(z.id);
      if (el === undefined) continue;
      const r = this.zoneRect(z);
      const c = centre(r);
      // With the view fixed from +x, +z, the corner nearest the viewer is the far one.
      const near = { x: r.x + r.w, z: r.z + r.d };
      put(z.id, el, this.project(new Vector3(near.x + (c.x - near.x) * 0.38, z.top, near.z + (c.z - near.z) * 0.38)), true, sel === z.id);
    }
    // The selected label always shows, then the bases' own, then front ones (lower on screen).
    const first = (l: { id: string; base: boolean }): number => (l.id === sel || l.id === selUnit ? 0 : l.base ? 1 : 2);
    placed.sort((a, b) => first(a) - first(b) || b.y - a.y);
    const shown: typeof placed = [];
    for (const l of placed) {
      const clash = shown.some((o) => l.x < o.x + o.w + 4 && o.x < l.x + l.w + 4 && l.y < o.y + o.h + 2 && o.y < l.y + l.h + 2);
      const on = l.visible && !clash;
      l.el.style.opacity = on ? '1' : '0';
      l.el.style.pointerEvents = on ? '' : 'none';
      if (on) shown.push(l);
    }
    this.placeHandles();
    // The selected unit's name floats above it.
    const unit = this.selected?.type === 'unit' ? this.data.units.get(this.selected.id) : undefined;
    if (unit === undefined || unit.floor || unit.self || this.labels.has(unit.id)) {
      this.unitLabel?.remove();
      this.unitLabel = null;
      return;
    }
    if (this.unitLabel === null) {
      this.unitLabel = document.createElement('div');
      this.unitLabel.className =
        'iv-on-ink pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full bg-[var(--iv-ink)] px-3 py-1 text-[12px] font-semibold text-[var(--iv-shell)] shadow-lg';
      this.labelsEl.appendChild(this.unitLabel);
    }
    this.unitLabel.textContent = unit.place.name;
    const r = this.unitRect(unit);
    const p = this.project(new Vector3(r.x + r.w / 2, unit.base + unit.height + 0.25, r.z + r.d / 2));
    const lw = this.unitLabel.offsetWidth;
    this.unitLabel.style.transform = `translate(${Math.round(p.x - lw / 2)}px, ${Math.round(p.y - 34)}px)`;
  }

  /** The picked place's corner handles (arrange mode), at the corners of its footprint. */
  private placeHandles(): void {
    const t = this.arranging && this.arrangeSel !== null ? this.targetById(this.arrangeSel) : null;
    const d = this.drag;
    const r = d?.kind === 'resize' ? d.rect : t !== null ? this.sizeRect(t) : null;
    const y = t !== null ? this.floorY(t) : 0;
    const corners = r === null ? [] : [
      [r.x, r.z],
      [r.x + r.w, r.z],
      [r.x + r.w, r.z + r.d],
      [r.x, r.z + r.d],
    ];
    this.handles.forEach((hnd, i) => {
      const c = corners[i];
      if (t === null || c === undefined) {
        hnd.classList.add('hidden');
        return;
      }
      const p = this.project(new Vector3(c[0], y, c[1]));
      hnd.classList.remove('hidden');
      hnd.style.left = `${Math.round(p.x)}px`;
      hnd.style.top = `${Math.round(p.y)}px`;
    });
  }

  /* ---------------------------------------------------------- highlights */

  private applyHighlights(): void {
    for (const o of this.outlines) {
      o.geometry.dispose();
      o.removeFromParent();
    }
    this.outlines.length = 0;
    for (const e of [this.hoverEdge, this.selectEdge]) {
      if (e === null) continue;
      e.geometry.dispose();
      e.removeFromParent();
    }
    this.hoverEdge = null;
    this.selectEdge = null;
    const arrangeZone = this.arranging && this.arrangeSel !== null && this.data?.zones.some((z) => z.id === this.arrangeSel) === true ? this.arrangeSel : null;
    // A place dragged where it cannot go shows in red until it is dropped (and put back).
    const bad = (this.drag?.kind === 'move' || this.drag?.kind === 'resize') && this.drag.why !== null;
    for (const [id, m] of this.zoneMats) {
      const on = (this.hover?.type === 'zone' && this.hover.id === id) || (this.selected?.type === 'zone' && this.selected.id === id) || arrangeZone === id;
      m.emissive.copy(bad && arrangeZone === id ? this.palette.out : this.palette.accent);
      m.emissiveIntensity = on ? (bad && arrangeZone === id ? 0.3 : 0.14) : 0;
    }
    if (this.data === null) return;
    const w = this.data;
    // Spots: the hovered one, the selected one, and every spot of the focused item.
    const keys = new Set<string>();
    if (this.hover?.type === 'slot') keys.add(this.hover.key);
    if (this.selected?.type === 'slot') keys.add(this.selected.key);
    if (this.focus !== null) for (const s of w.slots) if (s.item.id === this.focus) keys.add(s.key);
    for (const s of w.slots) {
      if (!keys.has(s.key)) continue;
      const off = this.shiftOf(w.zoneOf.get(s.place) ?? '', s.unit);
      const h = s.boxes === 0 ? 0.03 : s.h;
      const lift = this.hover?.type === 'slot' && this.hover.key === s.key ? 0.06 : 0;
      const o = new Mesh(new BoxGeometry(FOOT.w + 0.07, h + 0.07, FOOT.d + 0.07), this.fxMats.outline);
      o.position.set(s.x + off.x, s.y + lift + h / 2, s.z + off.z);
      this.fx.add(o);
      this.outlines.push(o);
    }
    const unitEdge = (u: Unit, mat: LineBasicMaterial = this.fxMats.edge): LineSegments => {
      const r = this.unitRect(u);
      const e = new LineSegments(new EdgesGeometry(new BoxGeometry(r.w + 0.1, u.height + 0.1, r.d + 0.1)), mat);
      e.position.set(r.x + r.w / 2, u.base + u.height / 2, r.z + r.d / 2);
      this.fx.add(e);
      return e;
    };
    if (this.hover?.type === 'unit') {
      const u = w.units.get(this.hover.id);
      if (u !== undefined) this.hoverEdge = unitEdge(u);
    }
    const selUnit = this.arranging && this.arrangeSel !== null ? this.arrangeSel : this.selected?.type === 'unit' ? this.selected.id : null;
    if (selUnit !== null) {
      const u = w.units.get(selUnit);
      if (u !== undefined) this.selectEdge = unitEdge(u, bad && this.arranging ? this.fxMats.refuse : this.fxMats.edge);
    }
    this.request();
  }

  private setHover(p: Pick | null): void {
    const same = (a: Pick | null, b: Pick | null): boolean =>
      a === b || (a !== null && b !== null && a.type === b.type && (a.type === 'slot' ? a.key === (b as { key: string }).key : a.id === (b as { id: string }).id));
    if (same(this.hover, p)) return;
    this.hover = p;
    this.applyHighlights();
  }

  /* -------------------------------------------------------------- camera */

  private onResize(): void {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.applyFrustum();
    if (this.data !== null) this.fit(false);
    this.request();
  }

  private applyFrustum(): void {
    const aspect = this.size.w / this.size.h;
    this.camera.left = (-this.frustum * aspect) / 2;
    this.camera.right = (this.frustum * aspect) / 2;
    this.camera.top = this.frustum / 2;
    this.camera.bottom = -this.frustum / 2;
    const { right, bottom } = this.inset;
    if (right > 0 || bottom > 0) this.camera.setViewOffset(this.size.w, this.size.h, right / 2, bottom / 2, this.size.w, this.size.h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private boxOfSlots(slots: Slot[]): { min: Vector3; max: Vector3 } | null {
    if (slots.length === 0 || this.data === null) return null;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const s of slots) {
      const off = this.shiftOf(this.data.zoneOf.get(s.place) ?? '', s.unit);
      min.min(new Vector3(s.x - 0.4 + off.x, s.y, s.z - 0.4 + off.z));
      max.max(new Vector3(s.x + 0.4 + off.x, s.y + Math.max(0.2, s.h) + 0.2, s.z + 0.4 + off.z));
    }
    return { min, max };
  }

  private boxOf(p: Pick): { min: Vector3; max: Vector3 } | null {
    const w = this.data;
    if (w === null) return null;
    if (p.type === 'zone') {
      const z = w.zones.find((x) => x.id === p.id);
      if (z === undefined) return null;
      const r = this.zoneRect(z);
      return { min: new Vector3(r.x, 0, r.z), max: new Vector3(r.x + r.w, z.height, r.z + r.d) };
    }
    if (p.type === 'unit') {
      const u = w.units.get(p.id);
      if (u === undefined) return null;
      const r = this.unitRect(u);
      return { min: new Vector3(r.x, u.base, r.z), max: new Vector3(r.x + r.w, u.base + u.height, r.z + r.d) };
    }
    const s = w.slots.find((x) => x.key === p.key);
    return s === undefined ? null : this.boxOfSlots([s]);
  }

  /** The zoom that frames a box from the view. */
  private zoomFor(box: { min: Vector3; max: Vector3 }, pad: number): number {
    const inv = this.camera.quaternion.clone().invert();
    let ex = 0;
    let ey = 0;
    const c = box.min.clone().add(box.max).multiplyScalar(0.5);
    for (let i = 0; i < 8; i++) {
      const v = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c).applyQuaternion(inv);
      ex = Math.max(ex, Math.abs(v.x));
      ey = Math.max(ey, Math.abs(v.y));
    }
    const aspect = this.size.w / this.size.h;
    const usableW = Math.max(0.3, (this.size.w - this.inset.right) / this.size.w);
    const usableH = Math.max(0.25, (this.size.h - this.inset.bottom) / this.size.h);
    const zx = (this.frustum * aspect * usableW) / (2 * ex * pad);
    const zy = (this.frustum * usableH) / (2 * ey * pad);
    return Math.max(0.05, Math.min(zx, zy));
  }

  private flyTo(box: { min: Vector3; max: Vector3 }, pad: number, dur = 700, setLimits = false): void {
    const target = box.min.clone().add(box.max).multiplyScalar(0.5);
    const zoom = this.zoomFor(box, pad);
    if (setLimits) {
      this.controls.minZoom = zoom * 0.45;
      this.controls.maxZoom = zoom * 8;
    }
    const to = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, zoom));
    const t0 = this.controls.target.clone();
    const z0 = this.camera.zoom;
    const offset = this.camera.position.clone().sub(t0);
    this.animate(
      this.motion ? dur : 0,
      (k) => {
        const e = easeInOut(k);
        this.controls.target.lerpVectors(t0, target, e);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.zoom = z0 + (to - z0) * e;
        this.camera.updateProjectionMatrix();
      },
      undefined,
      true,
    );
  }

  private placeShadowCamera(w: World): void {
    const b = w.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
    this.sun.position.set(cx - 7, 16, cz + 10);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -ext * 1.3;
    sc.right = ext * 1.3;
    sc.top = ext * 1.3;
    sc.bottom = -ext * 1.3;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.grid.position.set(Math.round(cx), 0.002, Math.round(cz));
    this.catcher.position.set(cx, 0, cz);
  }

  /* ---------------------------------------------------------- animation */

  private animate(dur: number, step: (k: number) => void, done?: () => void, camera = false): void {
    if (dur <= 0) {
      step(1);
      done?.();
      this.controls.update();
      this.request();
      return;
    }
    this.tweens.push({ start: performance.now(), dur, step, camera, ...(done !== undefined ? { done } : {}) });
    this.request();
  }

  private intro(): void {
    const now = performance.now();
    let i = 0;
    for (const g of this.zoneGroups.values()) {
      const delay = i * 70;
      g.scale.y = 0.001;
      this.tweens.push({
        start: now + delay,
        dur: 560,
        step: (k) => {
          g.scale.y = Math.max(0.001, easeBack(k));
        },
      });
      i++;
    }
    let n = 0;
    for (const o of this.objs) {
      o.born = now;
      o.pop = false;
      o.bornDelay = 260 + Math.min(n * 9, 520);
      n++;
    }
    this.request();
  }

  private stepTweens(now: number): boolean {
    if (this.tweens.length === 0) return false;
    const live: Tween[] = [];
    for (const t of this.tweens) {
      const k = clamp01((now - t.start) / t.dur);
      if (now >= t.start) t.step(k);
      if (k < 1) live.push(t);
      else t.done?.();
    }
    this.tweens = live;
    return live.length > 0;
  }

  private request(): void {
    if (this.raf === 0 && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    const now = performance.now();
    let busy = this.stepTweens(now);
    if (this.tweens.length === 0) busy = this.controls.update() || busy;
    else this.controls.update();
    busy = this.stepItems(now) || busy;
    if (now < this.ghostPulseUntil && this.ghostGroups.length > 0) {
      this.fxMats.ghost.opacity = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(now / 160));
      busy = true;
    } else this.fxMats.ghost.opacity = 0.16;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    if (busy) this.request();
  };

  private readonly onControlsChange = (): void => {
    // Keep the view over the map.
    if (this.data !== null) {
      const b = this.data.bounds;
      const t = this.controls.target;
      const cx = Math.max(b.minX - 2, Math.min(b.maxX + 2, t.x));
      const cz = Math.max(b.minZ - 2, Math.min(b.maxZ + 2, t.z));
      const cy = Math.max(-1, Math.min(b.maxY + 1, t.y));
      if (cx !== t.x || cz !== t.z || cy !== t.y) {
        this.camera.position.x += cx - t.x;
        this.camera.position.y += cy - t.y;
        this.camera.position.z += cz - t.z;
        t.set(cx, cy, cz);
      }
    }
    this.request();
  };

  private readonly onControlsStart = (): void => {
    // The user takes the view: camera flights stop; the intro, drops and snap-backs finish.
    this.tweens = this.tweens.filter((t) => t.camera !== true);
    this.events.interact();
  };

  /* ------------------------------------------------------------ picking */

  private setRay(clientX: number, clientY: number): void {
    const r = this.host.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private pickAt(clientX: number, clientY: number, only?: 'places'): { pick: Pick; point: Vector3 } | null {
    if (this.data === null) return null;
    this.setRay(clientX, clientY);
    const targets: Object3D[] = [...this.zoneGroups.values()];
    if (only !== 'places') {
      for (const pm of this.partMeshes.values()) if (pm.count > 0) targets.push(pm.mesh);
      targets.push(...this.ghostGroups);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      const pm = this.meshPart.get(h.object);
      if (pm !== undefined) {
        if (h.instanceId === undefined) continue;
        const o = pm.owners[h.instanceId];
        if (o === undefined || o.dying !== 0) continue;
        return { pick: { type: 'slot', key: o.slot.key }, point: h.point };
      }
      let o: Object3D | null = h.object;
      while (o !== null && o.userData['pick'] === undefined) o = o.parent;
      if (o !== null) return { pick: o.userData['pick'] as Pick, point: h.point };
    }
    return null;
  }

  private slotOf(key: string): Slot | undefined {
    return this.data?.slots.find((s) => s.key === key);
  }

  /** The place a pick stands for: a unit's place, a base's place (its loose stock and furniture included). */
  private placeOf(p: Pick): string | null {
    const w = this.data;
    if (w === null) return null;
    if (p.type === 'zone') return p.id;
    if (p.type === 'unit') return w.units.get(p.id)?.place.id ?? null;
    const s = this.slotOf(p.key);
    return s === undefined ? null : (w.units.get(s.unit)?.place.id ?? null);
  }

  /* ------------------------------------------------------------ arranging */

  private zoneRect(z: Zone): Rect {
    const off = this.zoneOffset.get(z.id) ?? this.zero;
    return { x: z.rect.x + off.x, z: z.rect.z + off.z, w: z.rect.w, d: z.rect.d };
  }

  /** Where a unit stands right now (a drag not yet redrawn from saved data included). */
  private unitRect(u: Unit): Rect {
    const off = this.shiftOf(u.zone, u.id);
    return { x: u.rect.x + off.x, z: u.rect.z + off.z, w: u.rect.w, d: u.rect.d };
  }

  /** The footprint a target moves by: a base, or the unit. */
  private targetRect(t: Target): Rect {
    return t.kind === 'zone' ? this.zoneRect(t.zone) : this.unitRect(t.unit);
  }

  /** The furniture standing on its own on a plinth base. */
  private selfOf(z: Zone): Unit | null {
    return z.base === 'plinth' ? (z.units.find((u) => u.self) ?? null) : null;
  }

  /** The footprint a target is resized by: furniture on its own is resized itself, and its plinth follows. */
  private sizeRect(t: Target): Rect {
    if (t.kind === 'zone') {
      const self = this.selfOf(t.zone);
      if (self !== null) return this.unitRect(self);
    }
    return this.targetRect(t);
  }

  private targetId(t: Target): string {
    return t.kind === 'zone' ? t.zone.id : t.unit.id;
  }

  private targetName(t: Target): string {
    return t.kind === 'zone' ? t.zone.place.name : t.unit.place.name;
  }

  private targetById(id: string): Target | null {
    const z = this.data?.zones.find((x) => x.id === id);
    if (z !== undefined) return { kind: 'zone', zone: z };
    const u = this.data?.units.get(id);
    return u !== undefined && !u.floor && !u.self ? { kind: 'unit', unit: u } : null;
  }

  /** What a press picks to arrange: the place itself, or the space its loose stock or items stand for. */
  private arrangeTargetOf(p: Pick): Target | null {
    const w = this.data;
    if (w === null) return null;
    if (p.type === 'zone') return this.targetById(p.id);
    const unitId = p.type === 'unit' ? p.id : this.slotOf(p.key)?.unit;
    const u = unitId !== undefined ? w.units.get(unitId) : undefined;
    if (u === undefined) return null;
    if (u.self || (u.floor && u.place.id === u.zone)) return this.targetById(u.zone);
    if (u.floor) return this.targetById(u.place.id);
    return { kind: 'unit', unit: u };
  }

  /** The floor height a target stands on (where its handles go). */
  private floorY(t: Target): number {
    return t.kind === 'zone' ? (this.selfOf(t.zone)?.base ?? 0) : t.unit.base;
  }

  /** The units standing directly in a space (a base's floor when parent is null). */
  private unitsIn(zone: string, parent: string | null): Unit[] {
    return [...(this.data?.units.values() ?? [])].filter((u) => u.zone === zone && u.parent === parent);
  }

  /** A unit and every unit inside it (they move together). */
  private subtree(u: Unit): Unit[] {
    const all = [...(this.data?.units.values() ?? [])];
    const out = [u];
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      if (cur === undefined) break;
      for (const c of all) if (c.parent === cur.id && c.zone === u.zone) out.push(c);
    }
    return out;
  }

  /** The footprint of the space a unit stands in (its base, or a space unit), where it stands now. */
  private parentRect(u: Unit): Rect | null {
    const w = this.data;
    if (w === null) return null;
    if (u.parent !== null) {
      const p = w.units.get(u.parent);
      return p !== undefined ? this.unitRect(p) : null;
    }
    const z = w.zones.find((x) => x.id === u.zone);
    return z !== undefined ? this.zoneRect(z) : null;
  }

  /** The floor a unit must stay on: its space's usable floor (inside the walls), or its base's. */
  private boundsOf(u: Unit): Rect | null {
    const w = this.data;
    if (w === null) return null;
    if (u.parent !== null) {
      const p = w.units.get(u.parent);
      if (p === undefined || p.inner === null) return null;
      const off = this.shiftOf(p.zone, p.id);
      return { x: p.inner.x + off.x, z: p.inner.z + off.z, w: p.inner.w, d: p.inner.d };
    }
    const z = w.zones.find((x) => x.id === u.zone);
    if (z === undefined) return null;
    const off = this.zoneOffset.get(z.id) ?? this.zero;
    return { x: z.inner.x + off.x, z: z.inner.z + off.z, w: z.inner.w, d: z.inner.d };
  }

  /** The name of the space a unit stands in. */
  private spaceName(u: Unit): string {
    const w = this.data;
    if (u.parent !== null) return w?.units.get(u.parent)?.place.name ?? 'its space';
    return w?.zones.find((z) => z.id === u.zone)?.place.name ?? 'its space';
  }

  /** The floor a base would take with this rect (furniture on its own: its plinth around it). */
  private zoneFootprint(t: Extract<Target, { kind: 'zone' }>, r: Rect): Rect {
    if (this.selfOf(t.zone) === null) return r;
    const c = centre(r);
    const p = plinthSize(r.w, r.d);
    return { x: c.x - p.w / 2, z: c.z - p.d / 2, w: p.w, d: p.d };
  }

  /** Why a target cannot stand at rect r (its size rect), or null when it can. */
  private checkRect(t: Target, r: Rect): string | null {
    const w = this.data;
    if (w === null) return 'The map is not ready.';
    if (t.kind === 'zone') {
      const foot = this.zoneFootprint(t, r);
      return w.zones.some((z) => z.id !== t.zone.id && overlaps(foot, this.zoneRect(z), 0.2)) ? 'Places cannot overlap. Drop it on free floor.' : null;
    }
    const u = t.unit;
    const b = this.boundsOf(u);
    if (b !== null && !inside(r, b, 0)) return `It has to stay inside ${this.spaceName(u)}.`;
    // Loose stock makes way: it is laid out again around what was moved.
    if (this.unitsIn(u.zone, u.parent).some((x) => x.id !== u.id && !x.floor && overlaps(r, this.unitRect(x), 0.05))) return 'Places cannot overlap. Drop it on free floor.';
    return null;
  }

  /** A target's own drag offset (what stands in it follows through the chain). */
  private offsetOf(t: Target): Vector3 {
    const map = t.kind === 'zone' ? this.zoneOffset : this.unitOffset;
    const id = this.targetId(t);
    let v = map.get(id);
    if (v === undefined) {
      v = new Vector3();
      map.set(id, v);
    }
    return v;
  }

  /** Move a target's meshes, empty spots and outlines to where it has been dragged. */
  private shiftTarget(t: Target): void {
    if (t.kind === 'zone') this.zoneGroups.get(t.zone.id)?.position.copy(this.zoneOffset.get(t.zone.id) ?? this.zero);
    else for (const u of this.subtree(t.unit)) this.unitGroups.get(u.id)?.position.copy(this.chain(u.id));
    for (const g of this.ghostGroups) {
      const off = this.shiftOf(g.userData['zone'] as string, g.userData['unit'] as string);
      g.position.set(off.x, 0, off.z);
    }
    this.applyHighlights();
  }

  private reportFocus(): void {
    const t = this.arranging && this.arrangeSel !== null ? this.targetById(this.arrangeSel) : null;
    if (t === null) {
      this.events.arrangeFocus(null);
      return;
    }
    const r = this.drag?.kind === 'resize' ? this.drag.rect : this.sizeRect(t);
    this.events.arrangeFocus({ name: this.targetName(t), w: r.w, d: r.d });
  }

  private drawRing(r: Rect, y: number, ok: boolean): void {
    this.clearRing();
    const c = centre(r);
    this.ring = flatRect(c.x, y + 0.012, c.z, r.w + 0.12, r.d + 0.12, 0.08, ok ? this.fxMats.ring : this.fxMats.ringBad);
    this.ring.renderOrder = 10;
    this.fx.add(this.ring);
    this.request();
  }

  private clearRing(): void {
    if (this.ring === null) return;
    this.ring.geometry.dispose();
    this.ring.removeFromParent();
    this.ring = null;
  }

  /** Where the pointer meets a floor plane. */
  private onPlane(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    this.setRay(clientX, clientY);
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(plane, p);
  }

  /** Follow the pointer: the far corner on the arrange grid, kept inside the space it stands in. */
  private moveTarget(d: Extract<Drag, { kind: 'move' }>, clientX: number, clientY: number): void {
    if (!d.moved && Math.hypot(clientX - d.cx, clientY - d.cy) < TAP) return;
    const p = this.onPlane(clientX, clientY, d.plane);
    if (p === null) return;
    let x = snapGrid(d.start.x + p.x - d.grab.x);
    let z = snapGrid(d.start.z + p.z - d.grab.z);
    const b = d.target.kind === 'unit' ? this.boundsOf(d.target.unit) : null;
    if (b !== null) {
      x = Math.max(b.x, Math.min(b.x + b.w - d.start.w, x));
      z = Math.max(b.z, Math.min(b.z + b.d - d.start.d, z));
    }
    const dx = x - d.start.x;
    const dz = z - d.start.z;
    if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) d.moved = true;
    d.rect = { x, z, w: d.start.w, d: d.start.d };
    this.offsetOf(d.target).set(d.base.x + dx, 0, d.base.z + dz);
    d.why = this.checkRect(d.target, this.sizeRect(d.target));
    this.shiftTarget(d.target);
    this.drawRing(d.rect, this.floorY(d.target), d.why === null);
    this.reportFocus();
  }

  /**
   * How far a corner may be dragged: furniture down to its smallest, a space
   * down to what stands in it, and inside a space no further than its walls.
   */
  private limitsFor(t: Target, start: Rect, sx: number, sz: number): Limits {
    const fx = sx > 0 ? start.x : start.x + start.w;
    const fz = sz > 0 ? start.z : start.z + start.d;
    let minW = 0.5;
    let minD = 0.5;
    let maxW = 400;
    let maxD = 400;
    // A space keeps what stands in it inside its walls (the far edges) and clear of a van's cab (+x side).
    let space: { inner: Rect; holds: Unit[] } | null = null;
    if (t.kind === 'zone') {
      const self = this.selfOf(t.zone);
      if (self !== null) {
        minW = self.minW;
        minD = self.minD;
        if (self.model === 'drawer') maxD = minD = start.d;
      } else {
        const m = zoneMin(t.zone.base);
        minW = m.w;
        minD = m.d;
        const off = this.zoneOffset.get(t.zone.id) ?? this.zero;
        space = { inner: { ...t.zone.inner, x: t.zone.inner.x + off.x, z: t.zone.inner.z + off.z }, holds: this.unitsIn(t.zone.id, null) };
      }
    } else {
      const u = t.unit;
      minW = u.minW;
      minD = u.minD;
      // A drawer unit's depth is its pulled-out drawer: only its width changes.
      if (u.model === 'drawer') maxD = minD = start.d;
      if (u.inner !== null) {
        const off = this.shiftOf(u.zone, u.id);
        space = { inner: { ...u.inner, x: u.inner.x + off.x, z: u.inner.z + off.z }, holds: this.unitsIn(u.zone, u.id) };
      }
      const b = this.boundsOf(u);
      if (b !== null) {
        maxW = sx > 0 ? b.x + b.w - fx : fx - b.x;
        maxD = sz > 0 ? b.z + b.d - fz : fz - b.z;
      }
    }
    if (space !== null && space.holds.length > 0) {
      const leadX = space.inner.x - start.x;
      const leadZ = space.inner.z - start.z;
      const cab = start.w - space.inner.w - leadX;
      const back = start.d - space.inner.d - leadZ;
      // Loose stock is laid out again with room around it (layout.ts PAD).
      const pad = t.kind === 'zone' ? PAD.zone : PAD.space;
      const rs = space.holds.map((h) => ({ r: this.unitRect(h), pad: h.floor ? pad : 0 }));
      const minX = Math.min(...rs.map((o) => o.r.x));
      const maxX = Math.max(...rs.map((o) => o.r.x + o.r.w + o.pad));
      const minZ = Math.min(...rs.map((o) => o.r.z));
      const maxZ = Math.max(...rs.map((o) => o.r.z + o.r.d + o.pad));
      // On the grid, as the layout rounds a space's size up to it.
      minW = Math.max(minW, snapUpGrid(sx > 0 ? maxX + cab - fx : fx + leadX - minX));
      minD = Math.max(minD, snapUpGrid(sz > 0 ? maxZ + back - fz : fz + leadZ - minZ));
    }
    return { minW, minD, maxW: Math.max(minW, maxW), maxD: Math.max(minD, maxD) };
  }

  private startResize(e: PointerEvent, corner: number, hnd: HTMLButtonElement): void {
    const t = this.arrangeSel !== null ? this.targetById(this.arrangeSel) : null;
    if (t === null || e.button !== 0 || this.drag !== null) return;
    e.preventDefault();
    e.stopPropagation();
    hnd.setPointerCapture(e.pointerId);
    this.holdView(true);
    const start = this.sizeRect(t);
    const sx = corner === 1 || corner === 2 ? 1 : -1;
    const sz = corner >= 2 ? 1 : -1;
    this.drag = {
      kind: 'resize',
      target: t,
      id: e.pointerId,
      plane: new Plane(new Vector3(0, 1, 0), -this.floorY(t)),
      corner,
      start,
      limits: this.limitsFor(t, start, sx, sz),
      rect: { ...start },
      why: null,
      cx: e.clientX,
      cy: e.clientY,
      live: false,
    };
    this.renderer.domElement.style.cursor = hnd.style.cursor;
    this.events.interact();
  }

  private onHandleMove(e: PointerEvent): void {
    const d = this.drag;
    if (d?.kind !== 'resize' || e.pointerId !== d.id) return;
    if (!d.live) {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < TAP) return;
      d.live = true;
    }
    const p = this.onPlane(e.clientX, e.clientY, d.plane);
    if (p === null) return;
    // The opposite corner stays put; this one follows the pointer, the size in grid steps.
    const s = d.start;
    const sx = d.corner === 1 || d.corner === 2 ? 1 : -1;
    const sz = d.corner >= 2 ? 1 : -1;
    const fx = sx > 0 ? s.x : s.x + s.w;
    const fz = sz > 0 ? s.z : s.z + s.d;
    const L = d.limits;
    const w = Math.max(L.minW, Math.min(L.maxW, s.w + snapGrid(sx * (p.x - fx) - s.w)));
    const dd = Math.max(L.minD, Math.min(L.maxD, s.d + snapGrid(sz * (p.z - fz) - s.d)));
    d.rect = { x: sx > 0 ? fx : fx - w, z: sz > 0 ? fz : fz - dd, w, d: dd };
    d.why = this.checkRect(d.target, d.rect);
    this.applyHighlights();
    this.drawRing(d.target.kind === 'zone' ? this.zoneFootprint(d.target, d.rect) : d.rect, this.floorY(d.target), d.why === null);
    const c = this.project(new Vector3(d.rect.x + d.rect.w, this.floorY(d.target), d.rect.z + d.rect.d));
    this.sizeTag.textContent = `${metres(d.rect.w)} × ${metres(d.rect.d)} m`;
    this.sizeTag.classList.remove('hidden');
    const tw = this.sizeTag.offsetWidth;
    this.sizeTag.style.transform = `translate(${Math.round(Math.max(4, Math.min(this.size.w - tw - 4, c.x - tw / 2)))}px, ${Math.round(Math.min(this.size.h - 32, c.y + 14))}px)`;
    this.reportFocus();
    this.request();
  }

  private onHandleUp(e: PointerEvent, hnd: HTMLButtonElement): void {
    const d = this.drag;
    if (d?.kind !== 'resize' || e.pointerId !== d.id) return;
    if (hnd.hasPointerCapture(e.pointerId)) hnd.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.holdView(false);
    this.renderer.domElement.style.cursor = this.arranging ? 'move' : 'grab';
    this.sizeTag.classList.add('hidden');
    this.clearRing();
    const changed = Math.abs(d.rect.x - d.start.x) + Math.abs(d.rect.z - d.start.z) + Math.abs(d.rect.w - d.start.w) + Math.abs(d.rect.d - d.start.d) > 1e-6;
    if (changed && e.type !== 'pointercancel') {
      if (d.why !== null) this.events.refuse(d.why);
      else this.commit(d.target, d.rect, true);
    }
    this.applyHighlights();
    this.reportFocus();
    this.request();
  }

  /**
   * Save an arranged place: its new centre (and size when resized) and every
   * place next to it where it stands now, so nothing else moves. The space it
   * stands in keeps the size it shows, and when a space is resized the places
   * in it keep standing where they are.
   */
  private commit(t: Target, r: Rect, resized: boolean): void {
    const w = this.data;
    if (w === null) return;
    const out = new Map<string, Placement>();
    const put = (p: Placement): void => {
      out.set(p.id, { ...out.get(p.id), ...p });
    };
    const at = (rect: Rect, origin: Rect | null): { x: number; z: number } => {
      const c = centre(rect);
      return origin === null ? c : { x: c.x - origin.x, z: c.z - origin.z };
    };
    if (t.kind === 'zone') {
      // Every base keeps its place, so none fills the floor this one left.
      for (const z of w.zones) put({ id: z.id, ...at(this.zoneRect(z), null) });
      put({ id: t.zone.id, ...at(r, null), ...(resized ? { w: r.w, d: r.d } : {}) });
      if (resized && this.selfOf(t.zone) === null) {
        for (const u of this.unitsIn(t.zone.id, null)) if (!u.floor) put({ id: u.id, ...at(this.unitRect(u), r) });
      }
    } else {
      const u = t.unit;
      const origin = this.parentRect(u);
      for (const x of this.unitsIn(u.zone, u.parent)) if (!x.floor && !x.self) put({ id: x.id, ...at(this.unitRect(x), origin) });
      put({ id: u.id, ...at(r, origin), ...(resized ? { w: r.w, d: r.d } : {}) });
      const parent = u.parent !== null ? w.units.get(u.parent) : undefined;
      if (parent !== undefined) {
        const pr = this.unitRect(parent);
        put({ id: parent.id, ...at(pr, this.parentRect(parent)), w: pr.w, d: pr.d });
      } else {
        const z = w.zones.find((x) => x.id === u.zone);
        if (z !== undefined) {
          const zr = this.zoneRect(z);
          put({ id: z.id, ...at(zr, null), w: zr.w, d: zr.d });
        }
      }
      if (resized && u.inner !== null) for (const c of this.unitsIn(u.zone, u.id)) if (!c.floor) put({ id: c.id, ...at(this.unitRect(c), r) });
    }
    const cm = (v: number): number => Math.round(v * 100) / 100;
    this.events.arrange(
      [...out.values()].map((p) => ({ ...p, x: cm(p.x), z: cm(p.z), ...(p.w !== undefined ? { w: cm(p.w) } : {}), ...(p.d !== undefined ? { d: cm(p.d) } : {}) })),
    );
  }

  /* ----------------------------------------------------------- gestures */

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (e.target !== this.renderer.domElement) return;
    if (this.drag !== null) {
      // Another finger. A pinch that began on an item belongs to the view (the
      // press lets go); a carry or an arrange keeps its finger and ignores this one.
      if (this.drag.kind === 'press' && this.drag.touch) {
        window.clearTimeout(this.drag.timer);
        this.drag = null;
      } else e.stopPropagation();
      return;
    }
    this.events.interact();
    const hit = this.pickAt(e.clientX, e.clientY);
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), pick: hit?.pick ?? null, id: e.pointerId };
    if (e.button !== 0 || this.data === null) return;

    if (this.arranging) {
      if (hit === null) return;
      // Any place picks itself (or the space its loose stock stands for) and drags it.
      const t = this.arrangeTargetOf(hit.pick);
      if (t === null) return;
      e.stopPropagation();
      this.beginMove(t, e);
      return;
    }

    if (hit === null) return;
    if (hit.pick.type === 'slot') {
      const slot = this.slotOf(hit.pick.key);
      if (slot === undefined || slot.boxes === 0) return;
      // An item takes a mouse gesture: click to select it, drag to carry it. A
      // touch still pans or pinches the view; a tap selects, a hold picks it up.
      const touch = e.pointerType !== 'mouse';
      if (!touch) {
        e.stopPropagation();
        this.host.setPointerCapture(e.pointerId);
      }
      const timer = touch
        ? window.setTimeout(() => {
            if (this.drag?.kind === 'press') {
              navigator.vibrate?.(12);
              this.startCarry(this.drag.slot, this.drag.id, e.clientX, e.clientY);
            }
          }, 320)
        : 0;
      this.drag = { kind: 'press', slot, x: e.clientX, y: e.clientY, id: e.pointerId, touch, timer, swiped: false };
    }
  };

  /** Arrange mode: pick a place and start dragging it (from the map or from its label). */
  private beginMove(t: Target, e: PointerEvent): void {
    this.host.setPointerCapture(e.pointerId);
    this.arrangeSel = this.targetId(t);
    const plane = new Plane(new Vector3(0, 1, 0), -this.floorY(t));
    const grab = this.onPlane(e.clientX, e.clientY, plane) ?? new Vector3();
    const start = this.targetRect(t);
    this.drag = { kind: 'move', target: t, id: e.pointerId, plane, grab, start, base: this.offsetOf(t).clone(), rect: { ...start }, why: null, moved: false, cx: e.clientX, cy: e.clientY };
    this.holdView(true);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.applyHighlights();
    this.reportFocus();
  }

  /** A press on a place's label: in arrange mode the label moves its place. */
  private labelDown(e: PointerEvent, id: string): void {
    if (!this.arranging || e.button !== 0 || this.drag !== null) return;
    const t = this.targetById(id);
    if (t === null) return;
    e.preventDefault();
    e.stopPropagation();
    this.events.interact();
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), pick: t.kind === 'zone' ? { type: 'zone', id } : { type: 'unit', id }, id: e.pointerId };
    this.beginMove(t, e);
  }

  private startCarry(slot: Slot, id: number, clientX: number, clientY: number): void {
    const carried = new Group();
    const body = this.statusColor(slot, new Color());
    const meta = SHAPES[slot.shape];
    const offs = clusterOffsets(slot.boxes);
    const tones = new Map<Tone, MeshLambertMaterial>();
    const matFor = (tone: Tone): MeshLambertMaterial => {
      let m = tones.get(tone);
      if (m === undefined) {
        m = new MeshLambertMaterial({ transparent: true, opacity: 0.9 });
        this.toneColor(tone, body, 0, m.color);
        tones.set(tone, m);
      }
      return m;
    };
    for (let i = 0; i < slot.boxes; i++) {
      const up = meta.stack === 'up';
      const off = up ? [0, 0] : (offs[i] ?? [0, 0]);
      const size = up ? 1 : clusterScale(slot.boxes);
      const one = new Group();
      one.position.set(off[0] ?? 0, up ? i * (meta.h + STACK_GAP) : 0, off[1] ?? 0);
      one.scale.setScalar(size);
      for (const part of this.parts[slot.shape]) {
        const mesh = new Mesh(part.geo, matFor(part.tone));
        mesh.applyMatrix4(part.local);
        mesh.castShadow = true;
        one.add(mesh);
      }
      carried.add(one);
    }
    const ring = new Mesh(new BoxGeometry(FOOT.w + 0.08, slot.h + 0.08, FOOT.d + 0.08), this.fxMats.outline);
    ring.position.y = slot.h / 2;
    carried.add(ring);
    carried.userData['tones'] = [...tones.values()];
    const off = this.shiftOf(this.data?.zoneOf.get(slot.place) ?? '', slot.unit);
    carried.position.set(slot.x + off.x, slot.y, slot.z + off.z);
    this.fx.add(carried);
    this.drag = { kind: 'carry', slot, id, carried, target: null, startPoint: carried.position.clone() };
    this.holdView(true);
    this.setHover(null);
    this.events.hover(null, 0, 0);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.moveCarry(clientX, clientY);
  }

  private dropCarried(g: Group): void {
    for (const m of (g.userData['tones'] as MeshLambertMaterial[] | undefined) ?? []) m.dispose();
    g.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry !== undefined && m.material === this.fxMats.outline) m.geometry.dispose();
    });
    g.removeFromParent();
  }

  /** The carried stack stands on whatever is under the pointer, its middle exactly under the pointer. */
  private moveCarry(clientX: number, clientY: number): void {
    if (this.drag?.kind !== 'carry') return;
    const d = this.drag;
    const hit = this.pickAt(clientX, clientY, 'places');
    const surface = hit !== null ? hit.point.y : 0;
    const target = hit !== null ? this.placeOf(hit.pick) : null;
    const mid = surface + 0.04 + d.slot.h / 2;
    const p = new Vector3();
    if (this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -mid), p) === null) return;
    d.carried.position.set(p.x, mid - d.slot.h / 2, p.z);
    const valid = target !== null && target !== d.slot.place;
    d.target = valid ? target : null;
    const r = this.host.getBoundingClientRect();
    this.events.carry({ slot: d.slot, to: d.target, x: clientX - r.left, y: clientY - r.top });
    if (this.dropTarget !== d.target) {
      this.dropTarget = d.target;
      const unit = d.target === null ? undefined : this.data?.units.get(d.target);
      const isUnit = unit !== undefined && !unit.floor && !unit.self;
      this.hover = d.target === null ? null : isUnit ? { type: 'unit', id: unit.id } : { type: 'zone', id: this.data?.zoneOf.get(d.target) ?? d.target };
      this.applyHighlights();
    }
    this.request();
  }

  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (d !== null && e.pointerId !== d.id) return;
    if (d?.kind === 'press') {
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (!d.touch && dist > 5) this.startCarry(d.slot, d.id, e.clientX, e.clientY);
      else if (d.touch && dist > 12 && !d.swiped) {
        // A swipe: the view pans; the item is neither picked up nor selected.
        window.clearTimeout(d.timer);
        d.swiped = true;
      }
      return;
    }
    if (d?.kind === 'carry') {
      this.moveCarry(e.clientX, e.clientY);
      return;
    }
    if (d?.kind === 'move') {
      this.moveTarget(d, e.clientX, e.clientY);
      return;
    }
    if (d?.kind === 'resize') return;
    if (e.buttons !== 0) return;
    const hit = this.pickAt(e.clientX, e.clientY);
    const p = hit?.pick ?? null;
    if (this.arranging) {
      // In arrange mode, hovering shows what a press would pick.
      const t = p !== null ? this.arrangeTargetOf(p) : null;
      this.setHover(t === null ? null : t.kind === 'zone' ? { type: 'zone', id: t.zone.id } : { type: 'unit', id: t.unit.id });
      this.renderer.domElement.style.cursor = t !== null ? 'move' : 'grab';
      return;
    }
    this.setHover(p);
    this.renderer.domElement.style.cursor = p !== null ? 'pointer' : 'grab';
    const l = this.local(e);
    this.events.hover(p, l.x, l.y);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const d = this.drag;
    const down = this.down;
    this.down = null;
    if (d !== null && e.pointerId === d.id && d.kind !== 'resize') {
      this.drag = null;
      this.holdView(false);
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = this.arranging ? 'move' : 'grab';
      if (d.kind === 'press') {
        window.clearTimeout(d.timer);
        if (!d.swiped) this.events.select({ type: 'slot', key: d.slot.key });
        return;
      }
      if (d.kind === 'carry') {
        this.dropTarget = null;
        this.hover = null;
        this.applyHighlights();
        this.events.carry(null);
        const target = d.target;
        const from = d.carried.position.clone();
        const back = target === null;
        const to = back ? d.startPoint : from;
        this.animate(
          this.motion ? 260 : 0,
          (k) => {
            d.carried.position.lerpVectors(from, to, easeOut(k));
            d.carried.scale.setScalar(back ? 1 : 1 - 0.6 * k);
          },
          () => {
            this.dropCarried(d.carried);
            this.request();
          },
        );
        if (target !== null) this.events.move(d.slot, target, e.clientX, e.clientY);
        this.request();
        return;
      }
      // A place dropped in arrange mode.
      this.clearRing();
      if (!d.moved) {
        this.reportFocus();
        return;
      }
      if (d.why !== null) {
        const off = this.offsetOf(d.target);
        const o0 = off.clone();
        this.animate(this.motion ? 260 : 0, (k) => {
          off.lerpVectors(o0, d.base, easeOut(k));
          this.shiftTarget(d.target);
        });
        this.events.refuse(d.why);
        this.reportFocus();
        return;
      }
      this.commit(d.target, d.rect, false);
      this.applyHighlights();
      this.reportFocus();
      return;
    }
    // A click (no drag) on the map.
    if (down !== null && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 600 && e.button === 0) {
      if (this.arranging) {
        // A click on empty floor lets go of the picked place.
        if (down.pick === null) {
          this.arrangeSel = null;
          this.applyHighlights();
          this.reportFocus();
        }
      } else this.events.select(down.pick);
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const d = this.drag;
    if (d === null || e.pointerId !== d.id) return;
    this.cancelGesture();
    this.down = null;
  };

  private readonly onLeave = (): void => {
    if (this.drag !== null) return;
    this.setHover(null);
    this.events.hover(null, 0, 0);
  };
}

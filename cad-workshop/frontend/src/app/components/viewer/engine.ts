/**
 * The 3D viewer: draws a build's own tessellation (the engine computes all
 * geometry; the browser only draws it), picks faces, edges, sketch profiles
 * and origin planes, and runs the direct-manipulation layer: drag handles,
 * live ghost previews, box selection, a right-click menu, double-click,
 * Alt-click to cycle through what is under the pointer, orbit around the
 * point under the pointer, and sketch mode (the plane, its grid and the
 * curves being drawn).
 *
 * Z is up; Front looks from -Y. It renders only when something changes
 * (zero frames while idle), takes every color from the theme palette, and
 * disposes everything it made.
 */
import {
  AmbientLight,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Camera, Intersection, Material } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { RGB, ViewportPalette } from '../../lib/themeColors.ts';
import type { BodySlot, Topology } from '../../lib/types.ts';
import { HandleLayer, cameraIsOrtho, pointOnPlane, valueOnArrow } from './handles.ts';
import type { HandleSpec } from './handles.ts';
import { BASE_FRAMES, at, clearGroup, disposeObject, fill, lines, polySegments, prismGeometry, profileRegion, regionGeometry, squareGeometry, v3 } from './overlays.ts';
import type { Frame, P2, P3, Region, SketchOutline } from './overlays.ts';
import type { ViewData } from './viewbin.ts';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type Navigation = 'left_rotates' | 'right_rotates' | 'middle_rotates';
export type Projection = 'perspective' | 'orthographic';
export type PickFilter = 'any' | 'faces' | 'edges';
export type StdView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';
export type SectionAxis = 'x' | 'y' | 'z';
export type BasePlane = 'XY' | 'XZ' | 'YZ';

export interface Pick {
  kind: 'face' | 'edge' | 'profile' | 'plane';
  index: number;
  key: string;
  point: P3;
  /** For a profile: the sketch and the item (loop) clicked. */
  sketch?: string;
  item?: string;
  /** For an origin plane. */
  plane?: BasePlane;
}

export interface SketchPointer {
  type: 'down' | 'move' | 'up' | 'leave';
  /** The pointer on the sketch plane, in plane coordinates; null off the plane. */
  p: P2 | null;
  /** Pointer position in the viewer, in CSS pixels. */
  screen: { x: number; y: number };
  button: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface ViewerCallbacks {
  onHover: (pick: Pick | null) => void;
  onPick: (pick: Pick | null, additive: boolean) => void;
  onBoxSelect: (picks: Pick[], additive: boolean) => void;
  onBoxRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  onContext: (pick: Pick | null, client: { x: number; y: number }) => void;
  onDoubleClick: (pick: Pick | null) => void;
  onHandle: (id: string, phase: 'start' | 'move' | 'end', value: number | P3) => void;
  onSketchPointer: (ev: SketchPointer) => void;
  onRender?: () => void;
}

/** What the sketch-mode layer draws, in plane coordinates. */
export interface SketchOverlay {
  segs: { a: P2; b: P2; role: 'curve' | 'construction' | 'selected' | 'hover' | 'preview' | 'inference' | 'axis' }[];
  points: { p: P2; role: 'vertex' | 'snap' | 'handle' | 'origin' }[];
  fills: { outer: P2[]; holes: P2[][] }[];
}

/** A ghost: what an edit in progress would add (or cut), drawn while dragging. */
export type GhostSpec =
  | { kind: 'prism'; regions: Region[]; frame: Frame; start: number; end: number; cut: boolean }
  | { kind: 'box'; min: P3; max: P3; cut: boolean }
  | { kind: 'cylinder'; base: P3; axis: P3; radius: number; height: number; cut: boolean }
  | { kind: 'sphere'; center: P3; radius: number; cut: boolean }
  | { kind: 'face'; key: string; distance: number }
  | null;

export interface SketchShow {
  outline: SketchOutline;
  /** Items to draw as selected profiles. */
  selected: string[];
  /** Whether a click on a region picks that profile. */
  pickable: boolean;
}

const VIEW_DIRS: Record<StdView, [number, number, number]> = {
  // Direction from the target to the camera.
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [1, -1, 0.85],
};

function color(c: RGB): Color {
  return new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace);
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-6)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

interface Model {
  group: Group;
  mesh: Mesh;
  cap: Mesh;
  edges: LineSegments2;
  edgeMat: LineMaterial;
  faceVerts: [number, number][];
  faceTriStart: Int32Array;
  faceBody: string[];
  segEdge: Int32Array;
  edgeSegs: [number, number][];
  topo: Topology;
  colors: Float32Array;
  bbox: Box3;
  view: ViewData;
}

type Drag =
  | { kind: 'pending'; button: number; x: number; y: number; t: number; shift: boolean; alt: boolean; ctrl: boolean; touch: boolean }
  | { kind: 'orbit'; pivot: Vector3; lx: number; ly: number }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'handle'; id: string; grab: number }
  | { kind: 'sketch' }
  | { kind: 'nav' };

export class CadViewer {
  private readonly el: HTMLElement;
  private readonly cb: ViewerCallbacks;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly top = new Scene();
  private readonly persp: PerspectiveCamera;
  private readonly ortho: OrthographicCamera;
  private camera: PerspectiveCamera | OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly key = new DirectionalLight(0xffffff, 2.4);
  private readonly hemi = new HemisphereLight(0xffffff, 0x888888, 1.5);
  private readonly ambient = new AmbientLight(0xffffff, 0.1);
  private readonly world = new Group();
  private readonly overlay = new Group();
  private readonly sketchGroup = new Group();
  private readonly planeGroup = new Group();
  private readonly ghostGroup = new Group();
  private readonly drawGroup = new Group();
  private readonly raycaster = new Raycaster();
  private readonly handles: HandleLayer;
  private palette: ViewportPalette;
  private model: Model | null = null;
  private slot: BodySlot = 'neutral';
  private grid: LineSegments | null = null;
  private showGrid = true;
  private filter: PickFilter = 'any';
  private navigation: Navigation = 'right_rotates';
  private selected = new Set<string>();
  private marked = new Set<string>();
  private hovered: Pick | null = null;
  private hidden = new Set<string>();
  private xray = false;
  private pickModel = true;
  private section: { axis: SectionAxis; offset: number; flip: boolean } | null = null;
  private readonly clip = new Plane(new Vector3(0, 0, -1), 0);
  private measureObj: Group | null = null;
  private compareObj: Group | null = null;
  private sketches: SketchShow[] = [];
  private profileMeshes: Mesh[] = [];
  private planesShown = false;
  private planeMeshes: Mesh[] = [];
  private sketchFrame: Frame | null = null;
  private sketchGrid: LineSegments | null = null;
  private sketchOverlay: SketchOverlay | null = null;
  private frame = 0;
  private anim: { from: { pos: Vector3; target: Vector3; up: Vector3 }; to: { pos: Vector3; target: Vector3; up: Vector3 }; start: number; dur: number } | null = null;
  private readonly ro: ResizeObserver;
  private drag: Drag | null = null;
  private lastClick: { x: number; y: number; t: number } | null = null;
  private cycle: { x: number; y: number; picks: Pick[]; index: number } | null = null;
  private pendingHover: { x: number; y: number } | null = null;
  private disposed = false;
  private width = 1;
  private height = 1;
  // The navigation cube, drawn in a corner of the same canvas.
  private readonly cubeScene = new Scene();
  private readonly cubeCam = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private cube: Group | null = null;
  private cubeFaces: Mesh[] = [];
  private cubeEdges: LineSegments | null = null;
  private cubeHover = -1;
  private readonly cubeSize = 88;

  constructor(el: HTMLElement, palette: ViewportPalette, cb: ViewerCallbacks) {
    this.el = el;
    this.cb = cb;
    this.palette = palette;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.autoClear = false;
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Model view');

    this.persp = new PerspectiveCamera(32, 1, 0.1, 100000);
    this.ortho = new OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.camera = this.persp;
    this.camera.position.set(200, -200, 160);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.85;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.anim = null;
      this.el.classList.add('cw-drag');
    });
    this.controls.addEventListener('end', () => this.el.classList.remove('cw-drag'));

    this.handles = new HandleLayer(this.handleColors());
    this.top.add(this.handles.group);
    this.scene.add(this.hemi, this.ambient, this.world, this.overlay, this.sketchGroup, this.planeGroup, this.ghostGroup);
    this.top.add(this.drawGroup);
    // The key light rides with the camera and shines from its upper left, so
    // faces turned different ways shade differently from every viewpoint
    // (its target rides along too; at the world origin it would be a headlight).
    this.camera.add(this.key, this.key.target);
    this.scene.add(this.camera);
    this.key.position.set(-0.2, 0.5, 0.85);
    this.key.target.position.set(0, 0, 0);
    // Z is up: the sky half of the hemisphere light shines down from +Z.
    this.hemi.position.set(0, 0, 1);

    this.setNavigation('right_rotates');
    this.buildCube();
    this.applyPalette();

    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('contextmenu', this.onContextMenu);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  /* ------------------------------------------------------------ settings */

  setPalette(p: ViewportPalette): void {
    this.palette = p;
    this.handles.setColors(this.handleColors());
    this.applyPalette();
  }

  private handleColors(): { accent: Color; x: Color; y: Color; z: Color; hover: Color; shaft: Color } {
    const p = this.palette;
    return { accent: color(p.select), x: color(p.axisX), y: color(p.axisY), z: color(p.axisZ), hover: color(p.hover), shaft: color(p.edge) };
  }

  /** The mouse scheme. Our own code turns the view (around the point under the pointer); OrbitControls pans and zooms. */
  setNavigation(n: Navigation): void {
    this.navigation = n;
    if (n === 'left_rotates') this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    else if (n === 'right_rotates') this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: null };
    else this.controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: MOUSE.PAN };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  }

  private rotateButton(): number {
    return this.navigation === 'left_rotates' ? 0 : this.navigation === 'right_rotates' ? 2 : 1;
  }

  setProjection(p: Projection): void {
    const next = p === 'orthographic' ? this.ortho : this.persp;
    if (next === this.camera) return;
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    next.position.copy(this.camera.position);
    next.up.copy(this.camera.up);
    next.quaternion.copy(this.camera.quaternion);
    this.camera.remove(this.key, this.key.target);
    this.scene.remove(this.camera);
    this.camera = next;
    this.camera.add(this.key, this.key.target);
    this.scene.add(this.camera);
    if (next === this.ortho) this.fitOrtho(dist);
    this.controls.object = this.camera;
    this.controls.update();
    this.resize();
  }

  setGrid(show: boolean): void {
    this.showGrid = show;
    if (this.grid !== null) this.grid.visible = show && this.sketchFrame === null;
    this.requestRender();
  }

  setFilter(f: PickFilter): void {
    this.filter = f;
  }

  setBodySlot(slot: BodySlot): void {
    this.slot = slot;
    this.recolor();
  }

  /** Whether clicks pick the model (off while sketching or placing). */
  setPickModel(on: boolean): void {
    this.pickModel = on;
    if (!on && this.hovered !== null && (this.hovered.kind === 'face' || this.hovered.kind === 'edge')) {
      this.hovered = null;
      this.recolor();
      this.cb.onHover(null);
    }
  }

  /* --------------------------------------------------------------- model */

  setModel(view: ViewData, topo: Topology, keepCamera: boolean): void {
    const first = this.model === null;
    this.clearModel();
    const h = view.header;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(view.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(view.normals, 3));
    geo.setIndex(new BufferAttribute(view.indices, 1));
    const colors = new Float32Array(h.nv * 3);
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.setAttribute('aHide', new BufferAttribute(new Float32Array(h.nv), 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // Indirect: the BVH must not reorder the triangles, since each face is a
    // range of them (picking and highlighting rely on that order).
    if (h.nt > 0) geo.computeBoundsTree({ indirect: true });
    const mat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.58,
      metalness: 0.06,
      side: FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: [],
    });
    hideable(mat);
    const mesh = new Mesh(geo, mat);
    const capMat = new MeshBasicMaterial({ side: BackSide, clippingPlanes: [], color: color(this.palette.cap) });
    hideable(capMat);
    const cap = new Mesh(geo, capMat);
    cap.visible = false;
    cap.raycast = () => undefined;

    // Per-face vertex ranges (each face's triangulation has its own nodes).
    const faceVerts: [number, number][] = [];
    const faceTriStart = new Int32Array(h.faces.length);
    const faceBody: string[] = [];
    h.faces.forEach((f, i) => {
      faceTriStart[i] = f[0];
      let lo = Infinity;
      let hi = -1;
      for (let t = f[0] * 3; t < (f[0] + f[1]) * 3; t++) {
        const v = view.indices[t] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      faceVerts.push(hi < 0 ? [0, -1] : [lo, hi]);
      faceBody.push(h.bodies[f[2]] ?? '');
    });

    const edgeMat = new LineMaterial({ linewidth: 1.25, vertexColors: true, worldUnits: false, clippingPlanes: [] });
    edgeMat.resolution.set(this.width, this.height);
    const edges = new LineSegments2(new LineSegmentsGeometry(), edgeMat);
    const group = new Group();
    group.add(mesh, cap, edges);
    this.world.add(group);
    const bbox = geo.boundingBox !== null ? geo.boundingBox.clone() : new Box3(new Vector3(), new Vector3());
    this.model = { group, mesh, cap, edges, edgeMat, faceVerts, faceTriStart, faceBody, segEdge: new Int32Array(0), edgeSegs: [], topo, colors, bbox, view };
    this.hovered = null;
    this.rebuildEdges();
    this.applyVisibility();
    this.buildGrid();
    this.applySection();
    this.recolor();
    this.applyXray();
    if (first || !keepCamera) this.view('iso', false);
    this.requestRender();
  }

  /** Edges as fat-line segments, without the hidden bodies' edges. */
  private rebuildEdges(): void {
    const m = this.model;
    if (m === null) return;
    const view = m.view;
    const segs: number[] = [];
    const segEdgeList: number[] = [];
    const edgeSegs: [number, number][] = [];
    view.header.edges.forEach((e, ei) => {
      const startSeg = segEdgeList.length;
      const body = m.topo.edges[ei]?.body ?? '';
      if (!this.hidden.has(body)) {
        for (let k = e[0]; k < e[0] + e[1] - 1; k++) {
          const a = k * 3;
          const b = (k + 1) * 3;
          segs.push(view.edgePoints[a] ?? 0, view.edgePoints[a + 1] ?? 0, view.edgePoints[a + 2] ?? 0, view.edgePoints[b] ?? 0, view.edgePoints[b + 1] ?? 0, view.edgePoints[b + 2] ?? 0);
          segEdgeList.push(ei);
        }
      }
      edgeSegs.push([startSeg, segEdgeList.length - startSeg]);
    });
    const eg = new LineSegmentsGeometry();
    eg.setPositions(segs.length ? segs : [0, 0, 0, 0, 0, 0]);
    eg.setColors(new Float32Array(Math.max(segs.length, 6)));
    m.edges.geometry.dispose();
    m.edges.geometry = eg;
    m.edges.visible = segs.length > 0;
    m.segEdge = Int32Array.from(segEdgeList);
    m.edgeSegs = edgeSegs;
  }

  clearModel(): void {
    const m = this.model;
    if (m === null) return;
    this.world.remove(m.group);
    m.mesh.geometry.disposeBoundsTree();
    m.mesh.geometry.dispose();
    (m.mesh.material as Material).dispose();
    (m.cap.material as Material).dispose();
    m.edges.geometry.dispose();
    m.edgeMat.dispose();
    this.model = null;
    this.requestRender();
  }

  hasModel(): boolean {
    return this.model !== null && this.model.mesh.geometry.index !== null && (this.model.mesh.geometry.index.count ?? 0) > 0;
  }

  /* ---------------------------------------------------- visibility, x-ray */

  /** Hide whole bodies (they are neither drawn nor picked). */
  setHidden(bodies: string[]): void {
    this.hidden = new Set(bodies);
    this.rebuildEdges();
    this.applyVisibility();
    this.recolor();
  }

  private applyVisibility(): void {
    const m = this.model;
    if (m === null) return;
    const attr = m.mesh.geometry.getAttribute('aHide') as BufferAttribute;
    const arr = attr.array as Float32Array;
    m.faceVerts.forEach((r, i) => {
      const hide = this.hidden.has(m.faceBody[i] ?? '') ? 1 : 0;
      for (let v = r[0]; v <= r[1]; v++) arr[v] = hide;
    });
    attr.needsUpdate = true;
    this.requestRender();
  }

  /** See-through bodies, to reach faces behind others. */
  setXray(on: boolean): void {
    this.xray = on;
    this.applyXray();
  }

  private applyXray(): void {
    const m = this.model;
    if (m === null) return;
    const on = this.xray || this.sketchFrame !== null;
    const mat = m.mesh.material as MeshStandardMaterial;
    mat.transparent = on;
    mat.opacity = on ? (this.sketchFrame !== null ? 0.28 : 0.42) : 1;
    mat.depthWrite = !on;
    mat.side = on ? DoubleSide : FrontSide;
    mat.needsUpdate = true;
    this.requestRender();
  }

  /* ---------------------------------------------------------- highlights */

  setSelection(keys: string[]): void {
    this.selected = new Set(keys);
    this.recolor();
  }

  /** Keys to point out (candidates of a failed reference, a check's entities). */
  setMarked(keys: string[]): void {
    this.marked = new Set(keys);
    this.recolor();
  }

  private faceColor(i: number): Color {
    const m = this.model as Model;
    const f = m.topo.faces[i];
    const p = this.palette;
    if (f !== undefined) {
      if (this.selected.has(f.key)) return color(p.select);
      if (this.hovered !== null && this.hovered.kind === 'face' && this.hovered.index === i) return color(p.hover);
      if (this.marked.has(f.key)) return color(p.measure);
    }
    return color(p.body[this.slot]);
  }

  private edgeColor(i: number): Color {
    const m = this.model as Model;
    const e = m.topo.edges[i];
    const p = this.palette;
    if (e !== undefined) {
      if (this.selected.has(e.key)) return color(p.select);
      if (this.hovered !== null && this.hovered.kind === 'edge' && this.hovered.index === i) return color(p.hover);
      if (this.marked.has(e.key)) return color(p.measure);
    }
    return color(p.edge);
  }

  private recolor(): void {
    const m = this.model;
    if (m === null) return;
    const col = m.colors;
    m.faceVerts.forEach((r, i) => {
      if (r[1] < r[0]) return;
      const c = this.faceColor(i);
      for (let v = r[0]; v <= r[1]; v++) {
        col[v * 3] = c.r;
        col[v * 3 + 1] = c.g;
        col[v * 3 + 2] = c.b;
      }
    });
    const attr = m.mesh.geometry.getAttribute('color') as BufferAttribute;
    attr.needsUpdate = true;
    const segCount = m.segEdge.length;
    if (segCount > 0) {
      const ec = new Float32Array(segCount * 6);
      const cache = new Map<number, Color>();
      for (let s = 0; s < segCount; s++) {
        const ei = m.segEdge[s] ?? 0;
        let c = cache.get(ei);
        if (c === undefined) {
          c = this.edgeColor(ei);
          cache.set(ei, c);
        }
        ec[s * 6] = c.r;
        ec[s * 6 + 1] = c.g;
        ec[s * 6 + 2] = c.b;
        ec[s * 6 + 3] = c.r;
        ec[s * 6 + 4] = c.g;
        ec[s * 6 + 5] = c.b;
      }
      (m.edges.geometry as LineSegmentsGeometry).setColors(ec);
    }
    this.paintSketches();
    this.paintPlanes();
    this.requestRender();
  }

  private applyPalette(): void {
    const p = this.palette;
    this.scene.background = color(p.stage);
    this.hemi.color = color(p.dark ? [220, 226, 236] : [255, 255, 255]);
    this.hemi.groundColor = color(p.dark ? [84, 86, 94] : [160, 158, 154]);
    if (this.model !== null) (this.model.cap.material as MeshBasicMaterial).color = color(p.cap);
    this.buildGrid();
    this.buildSketchGrid();
    this.paintCube();
    this.recolor();
    this.drawSketches();
    this.drawPlanes();
    this.drawSketchOverlay();
    this.requestRender();
  }

  /* ---------------------------------------------------------------- grid */

  private buildGrid(): void {
    if (this.grid !== null) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as Material).dispose();
      this.grid = null;
    }
    const bb = this.model?.bbox ?? new Box3(new Vector3(-50, -50, 0), new Vector3(50, 50, 20));
    const size = bb.getSize(new Vector3());
    const span = Math.max(size.x, size.y, 20);
    const step = niceStep(span / 6);
    const n = Math.ceil((span * 1.6) / step);
    const half = n * step;
    const z = Math.min(0, bb.min.z) - 1e-3;
    const pts: number[] = [];
    const cols: number[] = [];
    const minor = color(this.palette.grid);
    const major = color(this.palette.gridMajor);
    const ax = color(this.palette.axisX);
    const ay = color(this.palette.axisY);
    for (let i = -n; i <= n; i++) {
      const v = i * step;
      const isMajor = i % 5 === 0;
      const onAxis = i === 0;
      const cy = onAxis ? ax : isMajor ? major : minor;
      pts.push(-half, v, z, half, v, z);
      cols.push(cy.r, cy.g, cy.b, cy.r, cy.g, cy.b);
      const cx = onAxis ? ay : isMajor ? major : minor;
      pts.push(v, -half, z, v, half, z);
      cols.push(cx.r, cx.g, cx.b, cx.r, cx.g, cx.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    const grid = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, depthWrite: false }));
    grid.renderOrder = -1;
    grid.raycast = () => undefined;
    grid.visible = this.showGrid && this.sketchFrame === null;
    this.grid = grid;
    this.scene.add(grid);
  }

  /* ------------------------------------------------------------- section */

  setSection(axis: SectionAxis | null, offset: number, flip: boolean): void {
    this.section = axis === null ? null : { axis, offset, flip };
    this.applySection();
  }

  private applySection(): void {
    const m = this.model;
    if (m === null) return;
    const planes = this.section === null ? [] : [this.clip];
    if (this.section !== null) {
      const n = new Vector3(this.section.axis === 'x' ? 1 : 0, this.section.axis === 'y' ? 1 : 0, this.section.axis === 'z' ? 1 : 0);
      // Keep the side below the plane (clip what is above it), or the other side.
      const sign = this.section.flip ? 1 : -1;
      this.clip.normal.copy(n.multiplyScalar(sign));
      this.clip.constant = -sign * this.section.offset;
    }
    const mat = m.mesh.material as MeshStandardMaterial;
    mat.clippingPlanes = planes;
    (m.cap.material as MeshBasicMaterial).clippingPlanes = planes;
    m.cap.visible = this.section !== null;
    m.edgeMat.clippingPlanes = planes;
    mat.needsUpdate = true;
    (m.cap.material as Material).needsUpdate = true;
    m.edgeMat.needsUpdate = true;
    this.requestRender();
  }

  /** The model's extent along an axis (for the section slider). */
  extent(axis: SectionAxis): [number, number] {
    const bb = this.model?.bbox;
    if (bb === undefined) return [0, 1];
    if (axis === 'x') return [bb.min.x, bb.max.x];
    if (axis === 'y') return [bb.min.y, bb.max.y];
    return [bb.min.z, bb.max.z];
  }

  /* ------------------------------------------------------------- measure */

  setMeasure(from: P3 | null, to: P3 | null): void {
    if (this.measureObj !== null) {
      this.overlay.remove(this.measureObj);
      this.measureObj.traverse((o) => disposeObject(o));
      this.measureObj = null;
    }
    if (from !== null && to !== null) {
      const g = new Group();
      const geo = new LineSegmentsGeometry();
      geo.setPositions([...from, ...to]);
      const mat = new LineMaterial({ color: color(this.palette.measure).getHex(), linewidth: 2.5, worldUnits: false, depthTest: false });
      mat.resolution.set(this.width, this.height);
      const line = new LineSegments2(geo, mat);
      line.renderOrder = 10;
      g.add(line);
      const r = (this.model?.bbox.getSize(new Vector3()).length() ?? 100) * 0.006;
      for (const p of [from, to]) {
        const s = new Mesh(new SphereGeometry(r, 16, 12), new MeshBasicMaterial({ color: color(this.palette.measure), depthTest: false }));
        s.position.set(p[0], p[1], p[2]);
        s.renderOrder = 11;
        g.add(s);
      }
      g.traverse((o) => {
        o.raycast = () => undefined;
      });
      this.measureObj = g;
      this.overlay.add(g);
    }
    this.requestRender();
  }

  /* ------------------------------------------------------------- compare */

  setCompare(added: ViewData | null, removed: ViewData | null): void {
    if (this.compareObj !== null) {
      this.overlay.remove(this.compareObj);
      this.compareObj.traverse((o) => disposeObject(o));
      this.compareObj = null;
    }
    if (added === null && removed === null) {
      this.requestRender();
      return;
    }
    const g = new Group();
    const add = (v: ViewData, c: RGB, offset: number): void => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(v.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(v.normals, 3));
      geo.setIndex(new BufferAttribute(v.indices, 1));
      const mat = new MeshStandardMaterial({ color: color(c), roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      mesh.raycast = () => undefined;
      g.add(mesh);
    };
    if (added !== null) add(added, this.palette.added, -2);
    if (removed !== null) add(removed, this.palette.removed, -2);
    this.compareObj = g;
    this.overlay.add(g);
    this.requestRender();
  }

  /* -------------------------------------------------------------- ghosts */

  /** What an edit in progress would add (accent) or cut (red), drawn while dragging. */
  setGhost(spec: GhostSpec): void {
    clearGroup(this.ghostGroup);
    if (spec === null) {
      this.requestRender();
      return;
    }
    let geo: BufferGeometry | null = null;
    let cut = false;
    if (spec.kind === 'prism') {
      geo = prismGeometry(spec.regions, spec.frame, spec.start, spec.end);
      cut = spec.cut;
    } else if (spec.kind === 'box') {
      const size = new Vector3(spec.max[0] - spec.min[0], spec.max[1] - spec.min[1], spec.max[2] - spec.min[2]);
      if (size.x > 1e-6 && size.y > 1e-6 && size.z > 1e-6) {
        geo = new BoxGeometry(size.x, size.y, size.z);
        geo.translate((spec.min[0] + spec.max[0]) / 2, (spec.min[1] + spec.max[1]) / 2, (spec.min[2] + spec.max[2]) / 2);
      }
      cut = spec.cut;
    } else if (spec.kind === 'cylinder') {
      if (spec.radius > 1e-6 && spec.height > 1e-6) {
        geo = new CylinderGeometry(spec.radius, spec.radius, spec.height, 48);
        // CylinderGeometry runs along +Y about its middle: turn it onto the axis, from the base.
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...spec.axis).normalize());
        geo.applyQuaternion(q);
        const mid = new Vector3(...spec.axis).normalize().multiplyScalar(spec.height / 2).add(new Vector3(...spec.base));
        geo.translate(mid.x, mid.y, mid.z);
      }
      cut = spec.cut;
    } else if (spec.kind === 'sphere') {
      if (spec.radius > 1e-6) {
        geo = new SphereGeometry(spec.radius, 40, 24);
        geo.translate(spec.center[0], spec.center[1], spec.center[2]);
      }
      cut = spec.cut;
    } else {
      geo = this.facePrism(spec.key, spec.distance);
      cut = spec.distance < 0;
    }
    if (geo !== null) {
      const c = color(cut ? this.palette.removed : this.palette.select);
      const mesh = new Mesh(geo, fill(c, 0.38));
      mesh.renderOrder = 5;
      mesh.raycast = () => undefined;
      const edges = new LineSegments(new EdgesFromGeometry(geo), new LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
      edges.raycast = () => undefined;
      this.ghostGroup.add(mesh, edges);
    }
    this.requestRender();
  }

  /** A face swept along its normal by `d`, from the drawn mesh: the face, its moved copy and the walls between. */
  private facePrism(key: string, d: number): BufferGeometry | null {
    const m = this.model;
    if (m === null) return null;
    const fi = m.topo.faces.findIndex((f) => f.key === key);
    const f = m.topo.faces[fi];
    const hf = m.view.header.faces[fi];
    if (f === undefined || hf === undefined || f.normal === undefined || Math.abs(d) < 1e-9) return null;
    const n = new Vector3(...f.normal).multiplyScalar(d);
    const pos: number[] = [];
    const P = m.view.positions;
    const I = m.view.indices;
    for (let t = hf[0]; t < hf[0] + hf[1]; t++) {
      for (const lift of [0, 1]) {
        for (let k = 0; k < 3; k++) {
          const vi = (I[t * 3 + k] ?? 0) * 3;
          pos.push((P[vi] ?? 0) + n.x * lift, (P[vi + 1] ?? 0) + n.y * lift, (P[vi + 2] ?? 0) + n.z * lift);
        }
      }
    }
    // Walls: every edge bounding the face, extruded.
    m.topo.edges.forEach((e, ei) => {
      if (!e.faces.includes(key)) return;
      const he = m.view.header.edges[ei];
      if (he === undefined) return;
      for (let k = he[0]; k < he[0] + he[1] - 1; k++) {
        const a = new Vector3(m.view.edgePoints[k * 3] ?? 0, m.view.edgePoints[k * 3 + 1] ?? 0, m.view.edgePoints[k * 3 + 2] ?? 0);
        const b = new Vector3(m.view.edgePoints[k * 3 + 3] ?? 0, m.view.edgePoints[k * 3 + 4] ?? 0, m.view.edgePoints[k * 3 + 5] ?? 0);
        const a2 = a.clone().add(n);
        const b2 = b.clone().add(n);
        for (const p of [a, b, b2, a, b2, a2]) pos.push(p.x, p.y, p.z);
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    return g;
  }

  /* ------------------------------------------------------------- handles */

  /** Drag handles on the model; values update in place while dragging. */
  setHandles(specs: HandleSpec[]): void {
    this.handles.set(specs);
    this.requestRender();
  }

  /** Where each handle's label sits on screen (for value boxes beside the handles). */
  handleLabels(): { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    for (const s of this.handles.specs) {
      const p = this.handles.labelAnchor(s.id, (q) => this.pixelSize(q));
      if (p === null) continue;
      const sp = this.project([p.x, p.y, p.z]);
      if (sp !== null) out.push({ id: s.id, x: sp.x, y: sp.y });
    }
    return out;
  }

  /* ------------------------------------------------------------ sketches */

  /** Sketches drawn in place: curves, with clickable profile regions when asked. */
  setSketches(list: SketchShow[]): void {
    this.sketches = list;
    this.drawSketches();
  }

  private drawSketches(): void {
    clearGroup(this.sketchGroup);
    this.profileMeshes = [];
    const p = this.palette;
    const size = { w: this.width, h: this.height };
    for (const s of this.sketches) {
      const o = s.outline;
      const pts: Vector3[] = [];
      for (const lp of o.loops) pts.push(...polySegments(lp.poly, o.frame, true, 0.01));
      this.sketchGroup.add(lines(pts, color(s.pickable ? p.select : p.edge), s.pickable ? 1.6 : 1.2, size));
      const cl: Vector3[] = [];
      for (const l of o.lines) cl.push(at(o.frame, l.from, 0.01), at(o.frame, l.to, 0.01));
      if (cl.length) this.sketchGroup.add(lines(cl, color(p.edge), 1, size, { dashed: true }));
      if (s.pickable) {
        for (const lp of o.loops) {
          const region = profileRegion(o, lp.id);
          if (region === null) continue;
          const mesh = new Mesh(regionGeometry([region], o.frame, 0.02), fill(color(p.select), 0));
          mesh.userData['profile'] = { sketch: o.name, item: lp.id };
          mesh.renderOrder = 4;
          this.profileMeshes.push(mesh);
          this.sketchGroup.add(mesh);
        }
      }
    }
    this.paintSketches();
    this.requestRender();
  }

  private paintSketches(): void {
    const h = this.hovered;
    for (const mesh of this.profileMeshes) {
      const d = mesh.userData['profile'] as { sketch: string; item: string };
      const show = this.sketches.find((s) => s.outline.name === d.sketch);
      const on = show?.selected.includes(d.item) === true;
      const hover = h !== null && h.kind === 'profile' && h.sketch === d.sketch && h.item === d.item;
      const mat = mesh.material as MeshBasicMaterial;
      mat.opacity = on ? 0.42 : hover ? 0.26 : 0.08;
      mat.color = color(hover && !on ? this.palette.hover : this.palette.select);
    }
  }

  /* -------------------------------------------------------- origin planes */

  /** The three origin planes, shown to pick one to sketch on. */
  setOriginPlanes(show: boolean): void {
    this.planesShown = show;
    this.drawPlanes();
  }

  private drawPlanes(): void {
    clearGroup(this.planeGroup);
    this.planeMeshes = [];
    if (!this.planesShown) {
      this.requestRender();
      return;
    }
    const half = Math.max(this.radius() * 0.75, 30);
    const size = { w: this.width, h: this.height };
    for (const name of ['XY', 'XZ', 'YZ'] as BasePlane[]) {
      const f = BASE_FRAMES[name];
      const mesh = new Mesh(squareGeometry(f, half), fill(color(this.palette.select), 0.1));
      mesh.userData['plane'] = name;
      mesh.renderOrder = 3;
      this.planeMeshes.push(mesh);
      const border = polySegments(
        [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ],
        f,
        true,
      );
      this.planeGroup.add(mesh, lines(border, color(this.palette.select), 1.2, size));
    }
    this.paintPlanes();
    this.requestRender();
  }

  private paintPlanes(): void {
    for (const mesh of this.planeMeshes) {
      const hover = this.hovered !== null && this.hovered.kind === 'plane' && this.hovered.plane === mesh.userData['plane'];
      (mesh.material as MeshBasicMaterial).opacity = hover ? 0.3 : 0.1;
    }
  }

  /* ---------------------------------------------------------- sketch mode */

  /** Enter sketch mode on a plane (null leaves it): the plane's grid, see-through bodies, no model picking. */
  setSketchMode(frame: Frame | null): void {
    this.sketchFrame = frame;
    this.buildSketchGrid();
    if (this.grid !== null) this.grid.visible = this.showGrid && frame === null;
    if (frame === null) {
      this.sketchOverlay = null;
      this.drawSketchOverlay();
    }
    this.applyXray();
    this.requestRender();
  }

  private buildSketchGrid(): void {
    if (this.sketchGrid !== null) {
      this.scene.remove(this.sketchGrid);
      this.sketchGrid.geometry.dispose();
      (this.sketchGrid.material as Material).dispose();
      this.sketchGrid = null;
    }
    const f = this.sketchFrame;
    if (f === null) return;
    const span = Math.max(this.radius() * 2.4, 120);
    const step = this.sketchStep();
    const n = Math.min(400, Math.ceil(span / step));
    const half = n * step;
    const pts: number[] = [];
    const cols: number[] = [];
    const minor = color(this.palette.grid);
    const major = color(this.palette.gridMajor);
    const ax = color(this.palette.axisX);
    const ay = color(this.palette.axisY);
    const push = (a: Vector3, b: Vector3, c: Color): void => {
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    for (let i = -n; i <= n; i++) {
      const v = i * step;
      const c = i === 0 ? null : i % 5 === 0 ? major : minor;
      push(at(f, [-half, v], -0.01), at(f, [half, v], -0.01), c ?? ax);
      push(at(f, [v, -half], -0.01), at(f, [v, half], -0.01), c ?? ay);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    const grid = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, depthWrite: false, transparent: true, opacity: 0.9 }));
    grid.renderOrder = -1;
    grid.raycast = () => undefined;
    this.sketchGrid = grid;
    this.scene.add(grid);
  }

  /** The sketch grid's step, from how big the model is. */
  sketchStep(): number {
    return niceStep(Math.max(this.radius() * 2, 20) / 40);
  }

  /** Draw the sketch being edited: curves, points, inference lines and filled profiles. */
  setSketchOverlay(o: SketchOverlay | null): void {
    this.sketchOverlay = o;
    this.drawSketchOverlay();
  }

  private drawSketchOverlay(): void {
    clearGroup(this.drawGroup);
    const o = this.sketchOverlay;
    const f = this.sketchFrame;
    if (o === null || f === null) {
      this.requestRender();
      return;
    }
    const p = this.palette;
    const size = { w: this.width, h: this.height };
    const roles: Record<SketchOverlay['segs'][number]['role'], { c: RGB; w: number; dashed: boolean }> = {
      curve: { c: p.labelText, w: 2, dashed: false },
      construction: { c: p.edge, w: 1.4, dashed: true },
      selected: { c: p.select, w: 2.6, dashed: false },
      hover: { c: p.hover, w: 2.4, dashed: false },
      preview: { c: p.select, w: 2, dashed: false },
      inference: { c: p.measure, w: 1, dashed: true },
      axis: { c: p.gridMajor, w: 1, dashed: true },
    };
    for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
      const segs = o.segs.filter((s) => s.role === role);
      if (segs.length === 0) continue;
      const pts: Vector3[] = [];
      for (const s of segs) pts.push(at(f, s.a, 0.03), at(f, s.b, 0.03));
      const r = roles[role];
      this.drawGroup.add(lines(pts, color(r.c), r.w, size, { dashed: r.dashed, onTop: true }));
    }
    if (o.fills.length) {
      const mesh = new Mesh(regionGeometry(o.fills, f, 0.02), fill(color(p.select), 0.12, true));
      mesh.raycast = () => undefined;
      mesh.renderOrder = 19;
      this.drawGroup.add(mesh);
    }
    for (const pt of o.points) {
      const c = pt.role === 'snap' ? p.measure : pt.role === 'handle' ? p.select : pt.role === 'origin' ? p.axisZ : p.labelText;
      const mesh = new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: color(c), depthTest: false, transparent: true }));
      const w = at(f, pt.p, 0.05);
      mesh.position.copy(w);
      mesh.userData['dot'] = pt.role === 'snap' ? 5 : pt.role === 'handle' ? 4.5 : 3;
      mesh.renderOrder = 22;
      mesh.raycast = () => undefined;
      this.drawGroup.add(mesh);
    }
    this.requestRender();
  }

  /** The pointer on the sketch plane, in plane coordinates (null when the ray misses it). */
  planePoint(x: number, y: number, f: Frame | null = this.sketchFrame): P2 | null {
    if (f === null) return null;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera as Camera);
    const plane = new Plane().setFromNormalAndCoplanarPoint(v3(f.normal), v3(f.origin));
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (hit === null) return null;
    const d = hit.sub(v3(f.origin));
    return [d.dot(v3(f.u)), d.dot(v3(f.v))];
  }

  /** World units per screen pixel at a world point. */
  pixelAt(p: P3): number {
    return this.pixelSize(new Vector3(p[0], p[1], p[2]));
  }

  /** World units per screen pixel at a point (for snapping tolerances and handle sizes). */
  pixelSize(p: Vector3): number {
    if (cameraIsOrtho(this.camera)) {
      const o = this.ortho;
      return (o.top - o.bottom) / o.zoom / Math.max(this.height, 1);
    }
    const dist = this.camera.position.distanceTo(p);
    return (2 * dist * Math.tan((this.persp.fov * Math.PI) / 360)) / Math.max(this.height, 1);
  }

  /* -------------------------------------------------------------- camera */

  private center(): Vector3 {
    const bb = this.model?.bbox;
    if (bb === undefined || bb.isEmpty()) return new Vector3(0, 0, 0);
    return bb.getCenter(new Vector3());
  }

  private radius(): number {
    const bb = this.model?.bbox;
    if (bb === undefined || bb.isEmpty()) return 60;
    return Math.max(bb.getSize(new Vector3()).length() / 2, 1);
  }

  private fitOrtho(dist: number): void {
    const aspect = this.width / Math.max(this.height, 1);
    const h = Math.max(dist * Math.tan((this.persp.fov * Math.PI) / 360), 1);
    this.ortho.left = -h * aspect;
    this.ortho.right = h * aspect;
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
  }

  /** Look at the model from a standard direction. */
  view(name: StdView, animate = true): void {
    const d = VIEW_DIRS[name];
    this.lookFrom(new Vector3(d[0], d[1], d[2]).normalize(), animate);
  }

  /** Look straight at a plane (a face or a sketch plane), with its "up" up. */
  lookAlong(normal: P3, up: P3 | null, target: P3 | null): void {
    const dir = new Vector3(...normal).normalize();
    this.lookFrom(dir, true, target === null ? undefined : new Vector3(...target), undefined, up === null ? undefined : new Vector3(...up));
  }

  private lookFrom(dir: Vector3, animate: boolean, target?: Vector3, radius?: number, upHint?: Vector3): void {
    const c = target ?? this.center();
    const r = radius ?? this.radius();
    // Fit the model's sphere in the narrower of the two fields of view.
    const vHalf = (this.persp.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (this.width / Math.max(this.height, 1)));
    const dist = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.08;
    const up = upHint ?? (Math.abs(dir.z) > 0.999 ? new Vector3(0, dir.z > 0 ? 1 : -1, 0) : new Vector3(0, 0, 1));
    const to = { pos: c.clone().add(dir.clone().multiplyScalar(dist)), target: c, up };
    if (this.camera === this.ortho) this.fitOrtho(dist);
    if (!animate) {
      this.camera.position.copy(to.pos);
      this.camera.up.copy(up);
      this.controls.target.copy(c);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.anim = { from: { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone() }, to, start: performance.now(), dur: 320 };
    this.requestRender();
  }

  fit(): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.lookFrom(dir, true);
  }

  /** Frame the given keys (faces and edges). */
  zoomTo(keys: string[]): void {
    const m = this.model;
    if (m === null || keys.length === 0) return;
    const box = new Box3();
    const want = new Set(keys);
    m.topo.faces.forEach((f) => {
      if (want.has(f.key)) box.expandByPoint(new Vector3(...f.center));
    });
    m.topo.edges.forEach((e) => {
      if (want.has(e.key)) box.expandByPoint(new Vector3(...e.center));
    });
    if (box.isEmpty()) return;
    const c = box.getCenter(new Vector3());
    const r = Math.max(box.getSize(new Vector3()).length() / 2, this.radius() * 0.15);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.lookFrom(dir, true, c, r * 1.4);
  }

  /** Screen position (CSS pixels inside the viewer) of a world point, or null when behind the camera. */
  project(p: P3): { x: number; y: number } | null {
    const v = new Vector3(p[0], p[1], p[2]).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** Turn the camera around a pivot: dx turns about world Z, dy tilts about the camera's right axis. */
  private orbit(pivot: Vector3, dx: number, dy: number): void {
    const k = (2 * Math.PI * this.controls.rotateSpeed) / Math.max(this.height, 1);
    const az = -dx * k;
    let el = -dy * k;
    const pos = this.camera.position.clone();
    const tgt = this.controls.target.clone();
    // Keep the view from tipping over the poles.
    const fwd = tgt.clone().sub(pos).normalize();
    const polar = Math.acos(Math.max(-1, Math.min(1, -fwd.z)));
    const minPolar = 0.02;
    const maxPolar = Math.PI - 0.02;
    if (polar - el < minPolar) el = polar - minPolar;
    if (polar - el > maxPolar) el = polar - maxPolar;
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const q = new Quaternion().setFromAxisAngle(right, el).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), az));
    pos.sub(pivot).applyQuaternion(q).add(pivot);
    tgt.sub(pivot).applyQuaternion(q).add(pivot);
    this.camera.position.copy(pos);
    this.controls.target.copy(tgt);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(tgt);
    this.controls.update();
    this.requestRender();
  }

  /* ------------------------------------------------------------- picking */

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }

  private faceAtTriangle(tri: number): number {
    const starts = (this.model as Model).faceTriStart;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= tri) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Model hits under a screen point, nearest first: visible faces and the edges in front of them. */
  private modelHits(x: number, y: number, all: boolean): Pick[] {
    const m = this.model;
    if (m === null || !this.pickModel) return [];
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera as Camera);
    this.raycaster.camera = this.camera;
    this.raycaster.firstHitOnly = false;
    const out: { pick: Pick; d: number }[] = [];
    const seeThrough = this.xray;
    let frontFace: number | null = null;
    for (const h of this.raycaster.intersectObject(m.mesh, false)) {
      if (this.section !== null && this.clip.distanceToPoint(h.point) < 0) continue;
      if (h.faceIndex === undefined || h.faceIndex === null) continue;
      const fi = this.faceAtTriangle(h.faceIndex);
      if (this.hidden.has(m.faceBody[fi] ?? '')) continue;
      const info = m.topo.faces[fi];
      if (info === undefined) continue;
      if (frontFace === null) frontFace = h.distance;
      if (this.filter !== 'edges' && !out.some((o) => o.pick.kind === 'face' && o.pick.index === fi)) out.push({ pick: { kind: 'face', index: fi, key: info.key, point: [h.point.x, h.point.y, h.point.z] }, d: h.distance });
      if (!all && !seeThrough) break;
    }
    if (this.filter !== 'faces' && m.edges.visible) {
      (this.raycaster.params as typeof this.raycaster.params & { Line2?: { threshold: number } }).Line2 = { threshold: 7 };
      const hits: Intersection[] = [];
      m.edges.raycast(this.raycaster, hits);
      hits.sort((a, b) => a.distance - b.distance);
      const r = this.radius();
      for (const h of hits) {
        if (this.section !== null && this.clip.distanceToPoint(h.point) < 0) continue;
        // An edge behind the face under the cursor is hidden (unless seeing through).
        if (!all && !seeThrough && frontFace !== null && h.distance > frontFace + r * 0.004) break;
        if (h.faceIndex === undefined || h.faceIndex === null) continue;
        const ei = m.segEdge[h.faceIndex];
        const info = ei === undefined ? undefined : m.topo.edges[ei];
        if (ei === undefined || info === undefined) continue;
        if (out.some((o) => o.pick.kind === 'edge' && o.pick.index === ei)) continue;
        // Edges win over the face they border when the pointer is on them.
        out.push({ pick: { kind: 'edge', index: ei, key: info.key, point: [h.point.x, h.point.y, h.point.z] }, d: h.distance - r * 0.01 });
        if (!all) break;
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.pick);
  }

  private overlayHit(x: number, y: number): Pick | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera as Camera);
    if (this.planeMeshes.length) {
      const h = this.raycaster.intersectObjects(this.planeMeshes, false)[0];
      if (h !== undefined) return { kind: 'plane', index: 0, key: String(h.object.userData['plane']), plane: h.object.userData['plane'] as BasePlane, point: [h.point.x, h.point.y, h.point.z] };
    }
    if (this.profileMeshes.length) {
      const h = this.raycaster.intersectObjects(this.profileMeshes, false)[0];
      if (h !== undefined) {
        const d = h.object.userData['profile'] as { sketch: string; item: string };
        return { kind: 'profile', index: 0, key: d.sketch + ':' + d.item, sketch: d.sketch, item: d.item, point: [h.point.x, h.point.y, h.point.z] };
      }
    }
    return null;
  }

  private pickAt(x: number, y: number): Pick | null {
    return this.overlayHit(x, y) ?? this.modelHits(x, y, false)[0] ?? null;
  }

  private handleAt(x: number, y: number): string | null {
    const targets = this.handles.hitTargets();
    if (targets.length === 0) return null;
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera as Camera);
    const h = this.raycaster.intersectObjects(targets, false)[0];
    return h === undefined ? null : String(h.object.userData['handle']);
  }

  /** Faces and edges whose centers fall inside a screen rectangle and can be seen. */
  private boxPicks(x0: number, y0: number, x1: number, y1: number): Pick[] {
    const m = this.model;
    if (m === null || !this.pickModel) return [];
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1);
    const hy = Math.max(y0, y1);
    const out: Pick[] = [];
    const visible = (p: P3, kind: 'face' | 'edge', index: number): boolean => {
      if (this.xray) return true;
      const s = this.project(p);
      if (s === null) return false;
      const front = this.modelHits(s.x, s.y, true);
      // Seen when it is the nearest thing there, or an edge of the nearest face.
      const first = front[0];
      if (first === undefined) return false;
      if (first.kind === kind && first.index === index) return true;
      if (kind === 'edge') return front.slice(0, 3).some((q) => q.kind === 'edge' && q.index === index);
      return false;
    };
    const inside = (p: P3): boolean => {
      const s = this.project(p);
      return s !== null && s.x >= lx && s.x <= hx && s.y >= ly && s.y <= hy;
    };
    if (this.filter !== 'edges')
      m.topo.faces.forEach((f, i) => {
        if (this.hidden.has(f.body)) return;
        if (inside(f.center) && visible(f.center, 'face', i)) out.push({ kind: 'face', index: i, key: f.key, point: f.center });
      });
    if (this.filter !== 'faces')
      m.topo.edges.forEach((e, i) => {
        if (this.hidden.has(e.body)) return;
        if (inside(e.center) && visible(e.center, 'edge', i)) out.push({ kind: 'edge', index: i, key: e.key, point: e.center });
      });
    return out;
  }

  private local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inCube(x: number, y: number): boolean {
    return x > this.width - this.cubeSize - 8 && y < this.cubeSize + 8;
  }

  private sketchEvent(type: SketchPointer['type'], e: PointerEvent, p: { x: number; y: number }): SketchPointer {
    return { type, p: this.planePoint(p.x, p.y), screen: p, button: e.button, buttons: e.buttons, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.anim = null;
    if (e.button === 0 && !this.inCube(p.x, p.y)) {
      const h = this.handleAt(p.x, p.y);
      if (h !== null) {
        this.renderer.domElement.setPointerCapture(e.pointerId);
        const spec = this.handles.specs.find((s) => s.id === h);
        let grab = 0;
        if (spec !== undefined && spec.kind === 'arrow') {
          this.raycaster.setFromCamera(this.ndc(p.x, p.y), this.camera as Camera);
          grab = valueOnArrow(spec, this.raycaster.ray) - spec.value;
        }
        this.drag = { kind: 'handle', id: h, grab };
        if (spec !== undefined) this.cb.onHandle(h, 'start', spec.kind === 'arrow' ? spec.value : spec.at);
        this.el.classList.add('cw-drag');
        return;
      }
      if (this.sketchFrame !== null) {
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.drag = { kind: 'sketch' };
        this.cb.onSketchPointer(this.sketchEvent('down', e, p));
        return;
      }
    }
    this.drag = { kind: 'pending', button: e.button, x: p.x, y: p.y, t: performance.now(), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, touch: e.pointerType === 'touch' };
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const d = this.drag;
    if (d === null) {
      this.pendingHover = p;
      if (this.sketchFrame !== null) this.cb.onSketchPointer(this.sketchEvent('move', e, p));
      this.requestRender();
      return;
    }
    if (d.kind === 'pending') {
      if (Math.hypot(p.x - d.x, p.y - d.y) < 4) return;
      if (d.touch) {
        this.drag = { kind: 'nav' };
        return;
      }
      const rotate = d.button === this.rotateButton() && !(d.button === 0 && d.shift);
      if (rotate && !this.inCube(d.x, d.y)) {
        const hit = this.modelHits(d.x, d.y, false)[0];
        const pivot = hit !== undefined ? new Vector3(...hit.point) : this.controls.target.clone();
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.drag = { kind: 'orbit', pivot, lx: p.x, ly: p.y };
        this.el.classList.add('cw-drag');
        this.orbit(pivot, p.x - d.x, p.y - d.y);
        return;
      }
      if (d.button === 0 && !this.inCube(d.x, d.y)) {
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.drag = { kind: 'box', x0: d.x, y0: d.y, x1: p.x, y1: p.y, additive: d.shift || d.ctrl };
        this.cb.onBoxRect({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) });
        return;
      }
      this.drag = { kind: 'nav' };
      return;
    }
    if (d.kind === 'orbit') {
      this.orbit(d.pivot, p.x - d.lx, p.y - d.ly);
      d.lx = p.x;
      d.ly = p.y;
      return;
    }
    if (d.kind === 'box') {
      d.x1 = p.x;
      d.y1 = p.y;
      this.cb.onBoxRect({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
      return;
    }
    if (d.kind === 'handle') {
      const spec = this.handles.specs.find((s) => s.id === d.id);
      if (spec === undefined) return;
      this.raycaster.setFromCamera(this.ndc(p.x, p.y), this.camera as Camera);
      if (spec.kind === 'arrow') {
        let v = valueOnArrow(spec, this.raycaster.ray) - d.grab;
        // Snap to round values unless Alt is held.
        if (!e.altKey) {
          const step = niceStep(this.pixelSize(new Vector3(...spec.origin)) * 6);
          v = Math.round(v / step) * step;
        }
        if (spec.min !== undefined) v = Math.max(spec.min, v);
        if (spec.max !== undefined) v = Math.min(spec.max, v);
        this.handles.set(this.handles.specs.map((s) => (s.id === spec.id && s.kind === 'arrow' ? { ...s, value: v } : s)));
        this.cb.onHandle(spec.id, 'move', v);
      } else {
        const q = pointOnPlane(spec, this.raycaster.ray);
        if (q === null) return;
        const at3: P3 = [q.x, q.y, q.z];
        this.handles.set(this.handles.specs.map((s) => (s.id === spec.id && s.kind === 'point' ? { ...s, at: at3 } : s)));
        this.cb.onHandle(spec.id, 'move', at3);
      }
      this.requestRender();
      return;
    }
    if (d.kind === 'sketch') {
      this.cb.onSketchPointer(this.sketchEvent('move', e, p));
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    this.el.classList.remove('cw-drag');
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    const p = this.local(e);
    if (d === null) return;
    if (d.kind === 'handle') {
      const spec = this.handles.specs.find((s) => s.id === d.id);
      if (spec !== undefined) this.cb.onHandle(d.id, 'end', spec.kind === 'arrow' ? spec.value : spec.at);
      return;
    }
    if (d.kind === 'sketch') {
      this.cb.onSketchPointer(this.sketchEvent('up', e, p));
      return;
    }
    if (d.kind === 'box') {
      this.cb.onBoxRect(null);
      this.cb.onBoxSelect(this.boxPicks(d.x0, d.y0, d.x1, d.y1), d.additive);
      return;
    }
    if (d.kind !== 'pending') return;
    if (performance.now() - d.t > 700) return;
    if (d.button === 2) {
      const r = this.renderer.domElement.getBoundingClientRect();
      // In sketch mode a right click ends what is being drawn (the page decides).
      if (this.sketchFrame !== null) {
        this.cb.onContext(null, { x: r.left + p.x, y: r.top + p.y });
        return;
      }
      this.cb.onContext(this.pickAt(p.x, p.y), { x: r.left + p.x, y: r.top + p.y });
      return;
    }
    if (d.button !== 0) return;
    if (this.inCube(p.x, p.y)) {
      this.cubeClick(p.x, p.y);
      return;
    }
    const now = performance.now();
    const last = this.lastClick;
    this.lastClick = { x: p.x, y: p.y, t: now };
    if (last !== null && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 5) {
      this.lastClick = null;
      this.cb.onDoubleClick(this.pickAt(p.x, p.y));
      return;
    }
    if (d.alt) {
      // Alt-click: the next thing under the pointer each time.
      const c = this.cycle;
      if (c !== null && Math.hypot(p.x - c.x, p.y - c.y) < 4 && c.picks.length > 1) {
        c.index = (c.index + 1) % c.picks.length;
        this.cb.onPick(c.picks[c.index] ?? null, d.shift || d.ctrl);
        return;
      }
      const picks = this.modelHits(p.x, p.y, true);
      this.cycle = { x: p.x, y: p.y, picks, index: 0 };
      this.cb.onPick(picks[0] ?? null, d.shift || d.ctrl);
      return;
    }
    this.cycle = null;
    this.cb.onPick(this.pickAt(p.x, p.y), d.shift || d.ctrl);
  };

  private readonly onLeave = (e: PointerEvent): void => {
    this.pendingHover = null;
    if (this.sketchFrame !== null) this.cb.onSketchPointer(this.sketchEvent('leave', e, this.local(e)));
    if (this.cubeHover !== -1) {
      this.cubeHover = -1;
      this.paintCube();
    }
    if (this.handles.setHover(null)) this.requestRender();
    if (this.hovered !== null) {
      this.hovered = null;
      this.recolor();
      this.cb.onHover(null);
    }
    this.el.classList.remove('cw-pick');
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private updateHover(): void {
    const p = this.pendingHover;
    this.pendingHover = null;
    if (p === null) return;
    if (this.inCube(p.x, p.y)) {
      const f = this.cubeFaceAt(p.x, p.y);
      if (f !== this.cubeHover) {
        this.cubeHover = f;
        this.paintCube();
      }
      this.el.classList.toggle('cw-pick', f !== -1);
      if (this.hovered !== null) {
        this.hovered = null;
        this.recolor();
        this.cb.onHover(null);
      }
      return;
    }
    if (this.cubeHover !== -1) {
      this.cubeHover = -1;
      this.paintCube();
    }
    const h = this.handleAt(p.x, p.y);
    this.handles.setHover(h);
    if (h !== null) {
      this.el.classList.add('cw-pick');
      if (this.hovered !== null) {
        this.hovered = null;
        this.recolor();
        this.cb.onHover(null);
      }
      return;
    }
    if (this.sketchFrame !== null) {
      this.el.classList.remove('cw-pick');
      return;
    }
    const pick = this.pickAt(p.x, p.y);
    const same =
      (pick === null && this.hovered === null) ||
      (pick !== null && this.hovered !== null && pick.kind === this.hovered.kind && pick.index === this.hovered.index && pick.key === this.hovered.key);
    this.el.classList.toggle('cw-pick', pick !== null);
    if (same) return;
    this.hovered = pick;
    this.recolor();
    this.cb.onHover(pick);
  }

  /* ----------------------------------------------------- navigation cube */

  // Each face with the direction its label reads upward, matching the
  // camera's up in that standard view (Z up; Top has Back above it).
  private static readonly CUBE_FACES: { label: string; dir: [number, number, number]; up: [number, number, number] }[] = [
    { label: 'Right', dir: [1, 0, 0], up: [0, 0, 1] },
    { label: 'Left', dir: [-1, 0, 0], up: [0, 0, 1] },
    { label: 'Back', dir: [0, 1, 0], up: [0, 0, 1] },
    { label: 'Front', dir: [0, -1, 0], up: [0, 0, 1] },
    { label: 'Top', dir: [0, 0, 1], up: [0, 1, 0] },
    { label: 'Bottom', dir: [0, 0, -1], up: [0, -1, 0] },
  ];

  private buildCube(): void {
    const half = 0.9;
    const cube = new Group();
    this.cubeFaces = CadViewer.CUBE_FACES.map((f, i) => {
      const n = new Vector3(...f.dir);
      const up = new Vector3(...f.up);
      const right = up.clone().cross(n);
      const face = new Mesh(new PlaneGeometry(half * 2, half * 2), new MeshBasicMaterial());
      face.matrixAutoUpdate = false;
      face.matrix.makeBasis(right, up, n).setPosition(n.clone().multiplyScalar(half));
      face.userData['face'] = i;
      cube.add(face);
      return face;
    });
    const box = new BoxGeometry(half * 2, half * 2, half * 2);
    this.cubeEdges = new LineSegments(new EdgesGeometryLite(box), new LineBasicMaterial({ color: 0x000000 }));
    box.dispose();
    cube.add(this.cubeEdges);
    cube.updateMatrixWorld(true);
    this.cube = cube;
    this.cubeScene.add(cube);
    this.cubeCam.up.set(0, 0, 1);
  }

  private paintCube(): void {
    const cube = this.cube;
    if (cube === null) return;
    const p = this.palette;
    CadViewer.CUBE_FACES.forEach((f, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const bg = i === this.cubeHover ? p.select : p.label;
        ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
        ctx.fillRect(0, 0, 128, 128);
        const fg = i === this.cubeHover ? ([255, 255, 255] as RGB) : p.labelText;
        ctx.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
        ctx.font = '600 26px Manrope Variable, Manrope, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.label, 64, 66);
      }
      const mat = this.cubeFaces[i]?.material as MeshBasicMaterial | undefined;
      if (mat !== undefined) {
        mat.map?.dispose();
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
      }
    });
    if (this.cubeEdges !== null) (this.cubeEdges.material as LineBasicMaterial).color = color(p.cubeEdge);
    this.requestRender();
  }

  private cubeNdc(x: number, y: number): Vector2 | null {
    const s = this.cubeSize;
    const left = this.width - s - 8;
    const top = 8;
    if (x < left || x > left + s || y < top || y > top + s) return null;
    return new Vector2(((x - left) / s) * 2 - 1, -((y - top) / s) * 2 + 1);
  }

  private cubeFaceAt(x: number, y: number): number {
    const n = this.cubeNdc(x, y);
    if (n === null || this.cube === null) return -1;
    const rc = new Raycaster();
    rc.setFromCamera(n, this.cubeCam);
    const hit = rc.intersectObjects(this.cubeFaces, false)[0];
    const i = hit?.object.userData['face'] as number | undefined;
    return i ?? -1;
  }

  private cubeClick(x: number, y: number): void {
    const i = this.cubeFaceAt(x, y);
    const f = i >= 0 ? CadViewer.CUBE_FACES[i] : undefined;
    if (f === undefined) return;
    const dir = new Vector3(...f.dir);
    // Clicking the face you already look at turns to the iso view.
    const now = this.camera.position.clone().sub(this.controls.target).normalize();
    if (now.dot(dir) > 0.999) this.view('iso');
    else this.lookFrom(dir, true);
  }

  /* -------------------------------------------------------------- render */

  requestRender(): void {
    if (this.frame !== 0 || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    if (this.disposed) return;
    if (this.anim !== null) {
      const a = this.anim;
      const t = Math.min(1, (performance.now() - a.start) / a.dur);
      const k = 1 - (1 - t) ** 3;
      this.camera.position.lerpVectors(a.from.pos, a.to.pos, k);
      this.controls.target.lerpVectors(a.from.target, a.to.target, k);
      this.camera.up.lerpVectors(a.from.up, a.to.up, k).normalize();
      this.camera.lookAt(this.controls.target);
      if (t >= 1) {
        this.anim = null;
        this.camera.up.copy(a.to.up);
        this.controls.update();
      } else this.requestRender();
    }
    if (this.pendingHover !== null) this.updateHover();
    // Near and far planes that suit the model's size.
    const r = this.radius();
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.persp.near = Math.max(0.01, (dist - r * 4) * 0.5, dist / 2000);
    this.persp.far = dist + r * 20;
    this.persp.updateProjectionMatrix();
    // Constant on-screen sizes for handles and sketch points.
    this.handles.layout((q) => this.pixelSize(q));
    for (const o of this.drawGroup.children) {
      const dot = o.userData['dot'] as number | undefined;
      if (dot !== undefined) o.scale.setScalar(this.pixelSize(o.position) * dot);
    }
    const R = this.renderer;
    R.setViewport(0, 0, this.width, this.height);
    R.setScissorTest(false);
    R.clear();
    R.render(this.scene, this.camera);
    R.clearDepth();
    R.render(this.top, this.camera);
    // The navigation cube in the top-right corner, turned like the view.
    if (this.cube !== null) {
      const s = this.cubeSize;
      R.setScissorTest(true);
      R.setViewport(this.width - s - 8, this.height - s - 8, s, s);
      R.setScissor(this.width - s - 8, this.height - s - 8, s, s);
      R.clearDepth();
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.cubeCam.position.copy(dir.multiplyScalar(5));
      this.cubeCam.up.copy(this.camera.up);
      this.cubeCam.lookAt(0, 0, 0);
      R.render(this.cubeScene, this.cubeCam);
      R.setScissorTest(false);
      R.setViewport(0, 0, this.width, this.height);
    }
    this.cb.onRender?.();
  }

  resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, true);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    if (this.camera === this.ortho) this.fitOrtho(this.camera.position.distanceTo(this.controls.target));
    for (const root of [this.world, this.overlay, this.sketchGroup, this.planeGroup, this.drawGroup]) {
      root.traverse((o) => {
        const m = (o as LineSegments2).material;
        if (m instanceof LineMaterial) m.resolution.set(w, h);
      });
    }
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    const c = this.renderer.domElement;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.clearModel();
    this.setMeasure(null, null);
    this.setCompare(null, null);
    clearGroup(this.sketchGroup);
    clearGroup(this.planeGroup);
    clearGroup(this.ghostGroup);
    clearGroup(this.drawGroup);
    this.handles.clear();
    if (this.grid !== null) {
      this.grid.geometry.dispose();
      (this.grid.material as Material).dispose();
    }
    if (this.sketchGrid !== null) {
      this.sketchGrid.geometry.dispose();
      (this.sketchGrid.material as Material).dispose();
    }
    if (this.cube !== null) this.cube.traverse((o) => disposeObject(o));
    this.renderer.dispose();
    c.remove();
  }
}

/** Let a material skip the faces of hidden bodies (vertex attribute aHide = 1). */
function hideable(m: Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aHide;\nvarying float vHide;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = aHide;');
    shader.fragmentShader = 'varying float vHide;\n' + shader.fragmentShader.replace('void main() {', 'void main() {\nif (vHide > 0.5) discard;');
  };
}

/** The 12 edges of a box as line segments (BoxGeometry's own edges, without EdgesGeometry's angle test). */
class EdgesGeometryLite extends BufferGeometry {
  constructor(box: BoxGeometry) {
    super();
    const p = box.parameters;
    const x = p.width / 2;
    const y = p.height / 2;
    const z = p.depth / 2;
    const c = [
      [-x, -y, -z],
      [x, -y, -z],
      [x, y, -z],
      [-x, y, -z],
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
    ];
    const pairs = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const pts: number[] = [];
    for (const i of pairs) pts.push(...(c[i] ?? [0, 0, 0]));
    this.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  }
}

/** Feature lines of a ghost: edges where the surface folds sharply. */
class EdgesFromGeometry extends BufferGeometry {
  constructor(src: BufferGeometry) {
    super();
    const pos = src.getAttribute('position');
    const index = src.getIndex();
    const tri = (i: number): number => (index !== null ? index.getX(i) : i);
    const count = index !== null ? index.count : pos.count;
    const key = (a: number): string => pos.getX(a).toFixed(3) + ',' + pos.getY(a).toFixed(3) + ',' + pos.getZ(a).toFixed(3);
    const edges = new Map<string, { a: number; b: number; n: Vector3[] }>();
    const va = new Vector3();
    const vb = new Vector3();
    const vc = new Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = [tri(i), tri(i + 1), tri(i + 2)];
      va.fromBufferAttribute(pos, ids[0] ?? 0);
      vb.fromBufferAttribute(pos, ids[1] ?? 0);
      vc.fromBufferAttribute(pos, ids[2] ?? 0);
      const n = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
      for (let k = 0; k < 3; k++) {
        const a = ids[k] ?? 0;
        const b = ids[(k + 1) % 3] ?? 0;
        const ka = key(a);
        const kb = key(b);
        const id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        const e = edges.get(id);
        if (e === undefined) edges.set(id, { a, b, n: [n] });
        else e.n.push(n);
      }
    }
    const pts: number[] = [];
    for (const e of edges.values()) {
      const n0 = e.n[0];
      const n1 = e.n[1];
      const sharp = n1 === undefined || n0 === undefined || n0.dot(n1) < 0.94;
      if (!sharp) continue;
      pts.push(pos.getX(e.a), pos.getY(e.a), pos.getZ(e.a), pos.getX(e.b), pos.getY(e.b), pos.getZ(e.b));
    }
    this.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  }
}

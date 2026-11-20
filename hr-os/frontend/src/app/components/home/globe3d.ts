/**
 * The company globe's scene (home-reports), loaded on demand by globe.tsx in
 * its own chunk with three.js and the land outline (world-atlas 110m through
 * topojson-client), so Home's first paint never waits for it.
 *
 *   - Land as fine dots on a slowly turning sphere, in the theme's ink (day)
 *     and faint grey (night): the day and night terminator follows the real
 *     time, so every office sits in its own daylight.
 *   - Each office is a pillar whose height follows its headcount, split into
 *     in now (blue), remote (teal), on leave today (amber) and not in (grey),
 *     with a soft glow; pulse rings mark clock-ins of the last half hour.
 *   - Arcs run from the head office to the others with light particles that
 *     speed up as the next pay day comes closer.
 *   - Drag turns the globe (with inertia); hovering an office eases the globe
 *     to it and places the tooltip anchor over its pillar; a click or a second
 *     tap selects it.
 *
 * Colours are read from the --hr-* tokens and follow light and dark live.
 * Reduced motion: no auto-rotation, particles or rings, and frames are drawn
 * only when something changes. The loop runs only while the globe is on
 * screen and the page is visible. Everything is disposed with the handle.
 */
import { BackSide, BufferAttribute, BufferGeometry, CatmullRomCurve3, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Points, Quaternion, RingGeometry, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3, WebGLRenderer } from 'three';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landUrl from 'world-atlas/land-110m.json?url';
import { disposeTree, mixRGB, readPalette, srgb, v3 } from './scene3d.ts';
import type { Palette, RGB } from './scene3d.ts';

/* ------------------------------------------------------------------ types */

export interface SceneOffice {
  key: string;
  label: string;
  lat: number;
  lng: number;
  headcount: number;
  in_now: number | null;
  remote: number | null;
  on_leave: number;
  ins_recent: number | null;
  last_in: string;
}

export interface SceneData {
  offices: SceneOffice[];
  head: string;
  /** One entity: the globe turns to its country and comes a little closer. */
  close: boolean;
  /** Days to the next pay day (particles speed up as it nears); null when unknown. */
  payDays: number | null;
}

export interface SceneEvents {
  /** The office the pointer rests on (or a first tap), null when none. */
  onFocus: (key: string | null) => void;
  /** A click on an office, or a second tap. */
  onSelect: (key: string) => void;
}

export interface GlobeHandle {
  update: (d: SceneData) => void;
  setReduced: (on: boolean) => void;
  dispose: () => void;
}

/* ------------------------------------------------------------------ land */

const D2R = Math.PI / 180;
const ROWS = 160;

/** A point on the unit sphere: longitude 0 faces the camera at rest, north is up. */
function toVec(lat: number, lng: number, r = 1): Vector3 {
  const p = lat * D2R;
  const l = lng * D2R;
  return new Vector3(Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r);
}

let landDots: Promise<Float32Array> | null = null;

/** Dots on land: rows of equal spacing, kept where the land outline (drawn once on a canvas) is filled. */
function loadLand(): Promise<Float32Array> {
  if (landDots !== null) return landDots;
  landDots = fetch(landUrl)
    .then((r) => r.json() as Promise<Topology<{ land: GeometryCollection }>>)
    .then((topo) => {
      const land = feature(topo, topo.objects.land);
      const W = 1024;
      const H = 512;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (g === null) return new Float32Array(0);
      g.fillStyle = '#000';
      const px = (lng: number): number => ((lng + 180) / 360) * W;
      const py = (lat: number): number => ((90 - lat) / 180) * H;
      // Rings that cross the antimeridian are unwrapped (longitudes run on past 180) and every
      // polygon is drawn three times, a turn apart; a ring that circles a pole closes over it.
      const ring = (pts: number[][], off: number): void => {
        let prev = 0;
        let cur = 0;
        let first = 0;
        let lat = 0;
        pts.forEach((pt, i) => {
          const lng = pt[0] ?? 0;
          if (i === 0) cur = first = lng;
          else {
            let d = lng - prev;
            if (d > 180) d -= 360;
            else if (d < -180) d += 360;
            cur += d;
          }
          prev = lng;
          lat += pt[1] ?? 0;
          if (i === 0) g.moveTo(px(cur + off), py(pt[1] ?? 0));
          else g.lineTo(px(cur + off), py(pt[1] ?? 0));
        });
        if (Math.abs(cur - first) > 180) {
          const pole = lat < 0 ? -90 : 90;
          g.lineTo(px(cur + off), py(pole));
          g.lineTo(px(first + off), py(pole));
        }
        g.closePath();
      };
      const polygon = (rings: number[][][]): void => {
        for (const off of [-360, 0, 360]) {
          g.beginPath();
          for (const r of rings) ring(r, off);
          g.fill('evenodd');
        }
      };
      for (const f of land.features) {
        const geo = f.geometry;
        if (geo.type === 'Polygon') polygon(geo.coordinates);
        else if (geo.type === 'MultiPolygon') for (const p of geo.coordinates) polygon(p);
      }
      const img = g.getImageData(0, 0, W, H).data;
      const out: number[] = [];
      const step = Math.PI / ROWS;
      for (let i = 0; i < ROWS; i++) {
        const lat = 90 - (i + 0.5) * (180 / ROWS);
        const n = Math.max(1, Math.round((2 * Math.PI * Math.cos(lat * D2R)) / step));
        for (let j = 0; j < n; j++) {
          const lng = -180 + ((j + (i % 2) * 0.5) / n) * 360;
          const x = Math.min(W - 1, Math.floor(((lng + 180) / 360) * W));
          const y = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
          if ((img[(y * W + x) * 4 + 3] ?? 0) < 128) continue;
          const v = toVec(lat, lng);
          out.push(v.x, v.y, v.z);
        }
      }
      return new Float32Array(out);
    });
  return landDots;
}

/* ------------------------------------------------------------------- sun */

/** The point under the sun now: [lat, lng] in degrees (NOAA's fractional-year formulas). */
function subsolar(now: number): [number, number] {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const g = ((2 * Math.PI) / 365) * ((now - start) / 86400000);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lng = -15 * ((utcMin + eqt) / 60 - 12);
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return [decl / D2R, lng];
}

/* --------------------------------------------------------------- shaders */

const DOT_VS = `
uniform float uSize; uniform float uDist; uniform vec3 uSun;
varying float vDay; varying float vFace;
void main() {
  vec3 n = normalize(position);
  vDay = dot(n, uSun);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFace = normalize(normalMatrix * n).z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (uDist / -mv.z);
}`;

const DOT_FS = `
uniform vec3 uDayColor; uniform vec3 uNightColor; uniform float uAlpha;
varying float vDay; varying float vFace;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = 1.0 - smoothstep(0.32, 0.5, d);
  if (a <= 0.0) discard;
  float day = smoothstep(-0.08, 0.16, vDay);
  vec3 col = mix(uNightColor, uDayColor, day);
  float limb = smoothstep(0.0, 0.45, vFace);
  gl_FragColor = vec4(col, a * uAlpha * (0.3 + 0.7 * limb));
}`;

const BODY_VS = `
varying vec3 vN; varying float vFace;
void main() {
  vN = normalize(position);
  vFace = normalize(normalMatrix * normal).z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BODY_FS = `
uniform vec3 uDay; uniform vec3 uNight; uniform vec3 uRim; uniform vec3 uSun;
varying vec3 vN; varying float vFace;
void main() {
  float day = smoothstep(-0.12, 0.22, dot(vN, uSun));
  vec3 col = mix(uNight, uDay, day);
  float rim = pow(1.0 - max(vFace, 0.0), 3.0);
  gl_FragColor = vec4(mix(col, uRim, rim * 0.6), 1.0);
}`;

const HALO_VS = `
varying float vFace;
void main() {
  vFace = normalize(normalMatrix * normal).z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const HALO_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying float vFace;
void main() {
  // Back faces: 0 at the halo's outer edge, about -0.4 where it meets the globe.
  float i = pow(clamp(-vFace / 0.42, 0.0, 1.0), 2.0);
  gl_FragColor = vec4(uColor, i * uAlpha);
}`;

/** A soft radial spot (base glow), uv centred. */
const SPOT_VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SPOT_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv - vec2(0.5)) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.2);
  gl_FragColor = vec4(uColor, a * uAlpha);
}`;

/** The glow sheath around a pillar: brightest at the base, gone at the top. */
const SHEATH_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main() {
  float a = pow(1.0 - vUv.y, 1.6) * uAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

/** Arcs: faint at both ends, a little stronger in the middle. */
const ARC_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main() {
  float a = (0.18 + 0.82 * sin(3.14159 * vUv.x)) * uAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

const SPARK_VS = `
uniform float uSize; uniform float uDist;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (uDist / -mv.z);
}`;

const SPARK_FS = `
uniform vec3 uColor; uniform vec3 uCore;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.0);
  float core = 1.0 - smoothstep(0.0, 0.35, d);
  gl_FragColor = vec4(mix(uColor, uCore, core * 0.6), (glow * 0.55 + core * 0.45) * vAlpha);
}`;

/* ------------------------------------------------------------------ scene */

interface OfficeView {
  o: SceneOffice;
  lat: number;
  lng: number;
  normal: Vector3;
  height: number;
  group: Group;
  rings: { mesh: Mesh; mat: MeshBasicMaterial; age: number; live: boolean }[];
  nextRing: number;
  label: HTMLDivElement;
  screen: { x: number; y: number; bx: number; by: number; face: number };
}

interface ArcView {
  mesh: Mesh;
  pts: Vector3[];
  phase: number;
}

const UP = new Vector3(0, 1, 0);
const PILLAR_R = 0.0135;
const SPARKS_PER_ARC = 5;
const RING_LIFE = 2.6;

/** Spread offices that would stand on one spot around a small circle. */
function spread(offices: SceneOffice[]): { lat: number; lng: number }[] {
  const pos = offices.map((o) => ({ lat: o.lat, lng: o.lng }));
  const used = new Array<boolean>(offices.length).fill(false);
  for (let i = 0; i < pos.length; i++) {
    if (used[i]) continue;
    const a = pos[i];
    if (a === undefined) continue;
    const group = [i];
    for (let j = i + 1; j < pos.length; j++) {
      const b = pos[j];
      if (b === undefined || used[j]) continue;
      if (Math.abs(a.lat - b.lat) < 1.4 && Math.abs(a.lng - b.lng) < 1.4 / Math.max(0.2, Math.cos(a.lat * D2R))) group.push(j);
    }
    if (group.length < 2) continue;
    const r = 1.1;
    group.forEach((k, n) => {
      used[k] = true;
      const p = pos[k];
      if (p === undefined) return;
      const ang = (2 * Math.PI * n) / group.length;
      pos[k] = { lat: a.lat + r * Math.sin(ang), lng: a.lng + (r * Math.cos(ang)) / Math.max(0.2, Math.cos(a.lat * D2R)) };
    });
  }
  return pos;
}

/** The angle closest to `from` that equals `to` modulo a full turn. */
function nearAngle(from: number, to: number): number {
  const t = Math.PI * 2;
  return to + Math.round((from - to) / t) * t;
}

/**
 * Build the globe into `host` (a positioned element the canvas fills), with
 * office labels in `labels` and the tooltip `anchor` moved over the focused
 * office. Throws when WebGL cannot start.
 */
export async function createGlobe(opts: { host: HTMLElement; labels: HTMLElement; anchor: HTMLElement; data: SceneData; reduced: boolean; events: SceneEvents }): Promise<GlobeHandle> {
  const { host, labels, anchor, events } = opts;
  const dots = await loadLand();
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  const globe = new Group();
  globe.rotation.order = 'XYZ';
  scene.add(globe);

  let pal = readPalette();
  let reduced = opts.reduced;
  let data = opts.data;
  let width = 1;
  let height = 1;
  let dist = 5;
  let dpr = renderer.getPixelRatio();

  /* body, halo, dots */
  const sun = new Vector3(0, 0, 1);
  const bodyMat = new ShaderMaterial({ vertexShader: BODY_VS, fragmentShader: BODY_FS, uniforms: { uDay: { value: new Vector3() }, uNight: { value: new Vector3() }, uRim: { value: new Vector3() }, uSun: { value: sun } } });
  const body = new Mesh(new SphereGeometry(0.992, 96, 64), bodyMat);
  globe.add(body);
  const haloMat = new ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, side: BackSide, transparent: true, depthWrite: false, uniforms: { uColor: { value: new Vector3() }, uAlpha: { value: 0.5 } } });
  const halo = new Mesh(new SphereGeometry(1.09, 64, 48), haloMat);
  scene.add(halo);
  const dotGeo = new BufferGeometry();
  dotGeo.setAttribute('position', new BufferAttribute(dots, 3));
  const dotMat = new ShaderMaterial({ vertexShader: DOT_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false, uniforms: { uSize: { value: 2 }, uDist: { value: 5 }, uSun: { value: sun }, uDayColor: { value: new Vector3() }, uNightColor: { value: new Vector3() }, uAlpha: { value: 1 } } });
  const land = new Points(dotGeo, dotMat);
  globe.add(land);

  /* offices, arcs, sparks */
  let offices: OfficeView[] = [];
  let arcs: ArcView[] = [];
  const officeLayer = new Group();
  const arcLayer = new Group();
  globe.add(arcLayer);
  globe.add(officeLayer);
  const ringGeo = new RingGeometry(0.9, 1, 64);
  const sparkGeo = new BufferGeometry();
  const sparkMat = new ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, uniforms: { uSize: { value: 7 }, uDist: { value: 5 }, uColor: { value: new Vector3() }, uCore: { value: new Vector3() } } });
  const sparks = new Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  globe.add(sparks);
  const arcMats: ShaderMaterial[] = [];

  /* view state */
  let yaw = 0;
  let tilt = 0.25;
  let restTilt = 0.25;
  let restYaw = 0;
  let vyaw = 0;
  let vtilt = 0;
  let spin = 0; // auto-rotation ramp 0..1
  let idleAt = 0; // when auto-rotation may resume (ms)
  let focus: string | null = null;
  let target: { yaw: number; tilt: number } | null = null;
  let drag: { id: number; x: number; y: number; sx: number; sy: number; t: number; moved: boolean; touch: boolean } | null = null;
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let sunAt = 0;
  let frames = 0;
  let drawn = 0;
  let fpsAt = 0;
  let dirty = true;

  function colours(): void {
    const p = pal;
    const day = mixRGB(p.page, p.panel, 0.85);
    bodyMat.uniforms['uDay']!.value = v3(p.dark ? mixRGB(p.panel, p.line, 0.25) : day);
    bodyMat.uniforms['uNight']!.value = v3(p.dark ? mixRGB(p.page, p.sunk, 0.6) : mixRGB(p.sunk, p.line, 0.35));
    bodyMat.uniforms['uRim']!.value = v3(p.line2);
    haloMat.uniforms['uColor']!.value = v3(p.dark ? mixRGB(p.line2, p.rh, 0.3) : p.line2);
    haloMat.uniforms['uAlpha']!.value = p.dark ? 0.35 : 0.45;
    dotMat.uniforms['uDayColor']!.value = v3(mixRGB(p.ink, p.ink2, 0.25));
    dotMat.uniforms['uNightColor']!.value = v3(p.dark ? mixRGB(p.faint, p.line2, 0.4) : mixRGB(p.faint, p.line2, 0.25));
    dotMat.uniforms['uAlpha']!.value = p.dark ? 0.9 : 0.85;
    sparkMat.uniforms['uColor']!.value = v3(p.rh);
    sparkMat.uniforms['uCore']!.value = v3(p.dark ? p.ink : mixRGB(p.rh, p.ink, 0.35));
    for (const m of arcMats) m.uniforms['uColor']!.value = v3(p.dark ? p.ink2 : p.muted);
    buildOffices();
    dirty = true;
  }

  function segColours(): RGB[] {
    return [pal.rh, pal.lh, pal.warn, pal.dark ? mixRGB(pal.muted, pal.line2, 0.5) : mixRGB(pal.muted, pal.line2, 0.35)];
  }

  function buildOffices(): void {
    for (const v of offices) {
      disposeTree(v.group, ringGeo);
      officeLayer.remove(v.group);
      v.label.remove();
    }
    for (const a of arcs) {
      disposeTree(a.mesh);
      arcLayer.remove(a.mesh);
    }
    arcMats.length = 0;
    offices = [];
    arcs = [];
    const list = data.offices;
    const max = Math.max(1, ...list.map((o) => o.headcount));
    const pos = spread(list);
    const cols = segColours();
    list.forEach((o, i) => {
      const p = pos[i] ?? { lat: o.lat, lng: o.lng };
      const normal = toVec(p.lat, p.lng);
      const group = new Group();
      group.position.copy(normal);
      group.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
      const h = o.headcount > 0 ? 0.05 + 0.33 * Math.sqrt(o.headcount / max) : 0.018;
      const inNow = o.in_now ?? 0;
      const remote = o.remote ?? 0;
      const leave = Math.min(o.on_leave, Math.max(0, o.headcount - inNow - remote));
      const parts = [inNow, remote, leave, Math.max(0, o.headcount - inNow - remote - leave)];
      const total = parts.reduce((a, b) => a + b, 0);
      let y = 0;
      parts.forEach((n, k) => {
        if (n <= 0 || total <= 0) return;
        const sh = (h * n) / total;
        const geo = new CylinderGeometry(PILLAR_R, PILLAR_R, sh, 14, 1, false);
        geo.translate(0, y + sh / 2, 0);
        const mat = new MeshBasicMaterial({ color: srgb(cols[k] ?? pal.muted), transparent: true, opacity: k === 3 ? 0.8 : 0.96 });
        group.add(new Mesh(geo, mat));
        y += sh;
      });
      if (total <= 0) {
        const geo = new CylinderGeometry(PILLAR_R, PILLAR_R, h, 14, 1, false);
        geo.translate(0, h / 2, 0);
        group.add(new Mesh(geo, new MeshBasicMaterial({ color: srgb(cols[3] ?? pal.muted), transparent: true, opacity: 0.6 })));
      }
      const glow = (inNow > 0 ? pal.rh : remote > 0 ? pal.lh : pal.muted) as RGB;
      const sheathGeo = new CylinderGeometry(PILLAR_R * 2.8, PILLAR_R * 2.8, h, 18, 1, true);
      sheathGeo.translate(0, h / 2, 0);
      const sheath = new Mesh(sheathGeo, new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: SHEATH_FS, transparent: true, depthWrite: false, side: DoubleSide, uniforms: { uColor: { value: v3(glow) }, uAlpha: { value: pal.dark ? 0.32 : 0.22 } } }));
      group.add(sheath);
      const spotGeo = new CircleGeometry(0.07, 40);
      spotGeo.rotateX(-Math.PI / 2);
      spotGeo.translate(0, 0.003, 0);
      group.add(new Mesh(spotGeo, new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: SPOT_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: v3(glow) }, uAlpha: { value: pal.dark ? 0.55 : 0.4 } } })));
      officeLayer.add(group);
      const label = document.createElement('div');
      label.className = 'hr-label pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-[3px] bg-[color-mix(in_srgb,var(--hr-page)_80%,transparent)] px-1 leading-[16px] !text-[var(--hr-ink-2)]';
      label.textContent = o.label + ' · ' + o.headcount;
      label.style.opacity = '0';
      labels.appendChild(label);
      offices.push({ o, lat: p.lat, lng: p.lng, normal, height: h, group, rings: [], nextRing: 0.4 + i * 0.5, label, screen: { x: 0, y: 0, bx: 0, by: 0, face: 0 } });
    });
    const head = offices.find((v) => v.o.key === data.head) ?? offices[0];
    if (head !== undefined) {
      offices.forEach((v, i) => {
        if (v === head) return;
        const a = head.normal;
        const b = v.normal;
        const ang = a.angleTo(b);
        if (ang < 0.01) return;
        const lift = 0.06 + 0.32 * (ang / Math.PI);
        const pts: Vector3[] = [];
        for (let k = 0; k <= 64; k++) {
          const t = k / 64;
          const s = Math.sin(ang);
          const w1 = Math.sin((1 - t) * ang) / s;
          const w2 = Math.sin(t * ang) / s;
          pts.push(new Vector3().addScaledVector(a, w1).addScaledVector(b, w2).normalize().multiplyScalar(1.004 + lift * Math.sin(Math.PI * t)));
        }
        const mat = new ShaderMaterial({ vertexShader: SPOT_VS, fragmentShader: ARC_FS, transparent: true, depthWrite: false, uniforms: { uColor: { value: v3(pal.dark ? pal.ink2 : pal.muted) }, uAlpha: { value: pal.dark ? 0.5 : 0.55 } } });
        arcMats.push(mat);
        const mesh = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 96, 0.0022, 5, false), mat);
        arcLayer.add(mesh);
        arcs.push({ mesh, pts, phase: i * 0.37 });
      });
    }
    const n = arcs.length * SPARKS_PER_ARC;
    sparkGeo.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
    sparkGeo.setAttribute('aAlpha', new BufferAttribute(new Float32Array(Math.max(1, n)), 1));
    sparkGeo.setDrawRange(0, reduced ? 0 : n);
    // Rest view: the offices' middle latitude a little below the centre, so pillars rise.
    const lats = offices.map((v) => v.lat);
    const mid = lats.length > 0 ? (Math.min(...lats) + Math.max(...lats)) / 2 : 20;
    // Seen from about 30 degrees below them, so the pillars lean up instead of pointing at the camera.
    restTilt = Math.max(-0.6, Math.min(0.75, mid * D2R - (data.close ? 0.3 : 0.52)));
    restYaw = head !== undefined ? -head.lng * D2R : 0;
    dirty = true;
  }

  function resize(): void {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const wide = width >= 900;
    // Globe radius in CSS px: room for the readouts at the sides on wide screens.
    let rpx = wide ? Math.min(height * 0.39, (width - 470) / 2) : Math.min(height * 0.36, width * 0.4);
    if (data.close) rpx = Math.min(rpx * 1.18, height * 0.42);
    rpx = Math.max(80, rpx);
    dist = height / (2 * rpx * Math.tan((camera.fov * D2R) / 2));
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    // About 55% of the dot spacing at the front of the globe, in device pixels.
    dotMat.uniforms['uSize']!.value = Math.max(1.2, rpx * (Math.PI / ROWS) * 0.6) * dpr;
    dotMat.uniforms['uDist']!.value = dist - 1;
    sparkMat.uniforms['uSize']!.value = 8 * dpr;
    sparkMat.uniforms['uDist']!.value = dist - 1;
    dirty = true;
  }

  /* ------------------------------------------------------------ animate */

  function updateSun(): void {
    const [lat, lng] = subsolar(Date.now());
    sun.copy(toVec(lat, lng)).normalize();
  }

  const tmp = new Vector3();
  const tmp2 = new Vector3();
  function project(v: Vector3): { x: number; y: number } {
    tmp2.copy(v).applyMatrix4(globe.matrixWorld).project(camera);
    return { x: ((tmp2.x + 1) / 2) * width, y: ((1 - tmp2.y) / 2) * height };
  }

  function overlays(): void {
    globe.updateMatrixWorld();
    for (const v of offices) {
      tmp.copy(v.normal).transformDirection(globe.matrixWorld);
      // Seen from the camera (on +z at dist): above the horizon when n.z > 1 / dist.
      const face = (tmp.z * dist - 1) / Math.max(0.001, Math.hypot(tmp.x, tmp.y, dist - tmp.z));
      const top = project(tmp.copy(v.normal).multiplyScalar(1 + v.height));
      const base = project(v.normal);
      v.screen = { x: top.x, y: top.y, bx: base.x, by: base.y, face };
      const show = face > 0.12 && v.o.key !== focus;
      v.label.style.opacity = show ? String(Math.min(1, (face - 0.12) * 5)) : '0';
      v.label.style.transform = `translate3d(${Math.round(top.x + 6)}px, ${Math.round(top.y - 18)}px, 0)`;
    }
    const f = offices.find((v) => v.o.key === focus);
    if (f !== undefined && f.screen.face > 0) {
      // Above the pillar, or under its foot when there is no room above; always inside the stage.
      const tip = anchor.firstElementChild as HTMLElement | null;
      const w = tip?.offsetWidth ?? 220;
      const h = tip?.offsetHeight ?? 140;
      const x = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, f.screen.x));
      let y = Math.min(f.screen.y, f.screen.by) - h - 12;
      if (y < 4) y = Math.max(f.screen.y, f.screen.by) + 14;
      y = Math.max(4, Math.min(height - h - 4, y));
      anchor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      anchor.style.opacity = '1';
      anchor.style.visibility = 'visible';
    } else {
      anchor.style.opacity = '0';
      anchor.style.visibility = 'hidden';
    }
  }

  function emitRing(v: OfficeView): void {
    let r = v.rings.find((x) => !x.live);
    if (r === undefined) {
      if (v.rings.length >= 3) return;
      const mat = new MeshBasicMaterial({ color: srgb(pal.rh), transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.004;
      v.group.add(mesh);
      r = { mesh, mat, age: 0, live: false };
      v.rings.push(r);
    }
    r.mat.color.copy(srgb(pal.rh));
    r.age = 0;
    r.live = true;
  }

  function step(dt: number): boolean {
    let moving = false;
    const now = performance.now();
    if (drag === null) {
      if (Math.abs(vyaw) > 0.0001 || Math.abs(vtilt) > 0.0001) {
        yaw += vyaw * dt;
        tilt += vtilt * dt;
        const k = Math.exp(-dt * 3.2);
        vyaw *= k;
        vtilt *= k;
        moving = true;
      }
      if (target !== null) {
        const k = reduced ? 1 : 1 - Math.exp(-dt * 3.6);
        yaw += (target.yaw - yaw) * k;
        tilt += (target.tilt - tilt) * k;
        if (Math.abs(target.yaw - yaw) > 0.0005 || Math.abs(target.tilt - tilt) > 0.0005) moving = true;
      } else if (!reduced) {
        const resume = now > idleAt;
        if (data.close) {
          // One country: the globe rests on it with a slow sway.
          if (resume) {
            const k = 1 - Math.exp(-dt * 0.9);
            yaw += (nearAngle(yaw, restYaw) + 0.13 * Math.sin(clock * 0.21) - yaw) * k;
            tilt += (restTilt + 0.04 * Math.sin(clock * 0.17) - tilt) * k;
          }
        } else {
          // Back to the rest tilt and the slow turn once nothing holds the globe.
          spin = Math.min(1, Math.max(0, spin + (resume ? dt * 0.6 : -dt * 3)));
          yaw += spin * 0.075 * dt;
          if (resume) tilt += (restTilt - tilt) * (1 - Math.exp(-dt * 0.8));
        }
        moving = true;
      }
    }
    tilt = Math.max(-1.1, Math.min(1.1, tilt));
    globe.rotation.set(tilt, yaw, 0);
    if (!reduced) {
      // Particles along the arcs, faster as pay day nears.
      const days = data.payDays;
      const u = days === null ? 0.25 : Math.max(0, Math.min(1, 1 - days / 31));
      const speed = 0.045 + 0.32 * u * u;
      const posAttr = sparkGeo.getAttribute('position') as BufferAttribute | undefined;
      const alphaAttr = sparkGeo.getAttribute('aAlpha') as BufferAttribute | undefined;
      if (posAttr !== undefined && alphaAttr !== undefined && arcs.length > 0) {
        let n = 0;
        for (const a of arcs) {
          for (let s = 0; s < SPARKS_PER_ARC; s++) {
            const t = (((clock * speed + a.phase + s / SPARKS_PER_ARC) % 1) + 1) % 1;
            const f = t * (a.pts.length - 1);
            const i0 = Math.floor(f);
            const p0 = a.pts[i0];
            const p1 = a.pts[Math.min(a.pts.length - 1, i0 + 1)];
            if (p0 !== undefined && p1 !== undefined) {
              tmp.copy(p0).lerp(p1, f - i0);
              posAttr.setXYZ(n, tmp.x, tmp.y, tmp.z);
              alphaAttr.setX(n, Math.sin(Math.PI * t));
            }
            n++;
          }
        }
        posAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
      }
      // Pulse rings for offices with clock-ins in the last half hour.
      for (const v of offices) {
        const recent = v.o.ins_recent ?? 0;
        if (recent > 0) {
          v.nextRing -= dt;
          if (v.nextRing <= 0) {
            emitRing(v);
            v.nextRing = Math.max(1.1, 3.4 / Math.sqrt(recent));
          }
        }
        for (const r of v.rings) {
          if (!r.live) continue;
          r.age += dt;
          const p = r.age / RING_LIFE;
          if (p >= 1) {
            r.live = false;
            r.mat.opacity = 0;
            continue;
          }
          const e = 1 - Math.pow(1 - p, 2.4);
          const s = 0.018 + 0.085 * e;
          r.mesh.scale.set(s, s, s);
          r.mat.opacity = (1 - p) * (pal.dark ? 0.7 : 0.55);
        }
      }
      moving = true;
    }
    return moving;
  }

  function frame(t: number): void {
    raf = 0;
    if (!running) return;
    const dt = last === 0 ? 0.016 : Math.min(0.05, (t - last) / 1000);
    last = t;
    clock += dt;
    if (t - sunAt > 10000) {
      sunAt = t;
      updateSun();
    }
    const moving = step(dt);
    if (moving || dirty) {
      renderer.render(scene, camera);
      overlays();
      dirty = false;
    }
    frames++;
    drawn++;
    if (t - fpsAt > 1000) {
      // The scene's own frame rate and frame count (read by the performance checks).
      host.dataset['fps'] = String(Math.round((frames * 1000) / (t - fpsAt)));
      host.dataset['frames'] = String(drawn);
      frames = 0;
      fpsAt = t;
    }
    // Reduced motion: draw only while something eases or was changed.
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

  /** The office under a point: near its pillar on screen, on the side facing the camera. */
  function pick(x: number, y: number, slack: number): OfficeView | null {
    let best: OfficeView | null = null;
    let bestD = Infinity;
    for (const v of offices) {
      const s = v.screen;
      if (s.face < 0.1) continue;
      const dx = s.x - s.bx;
      const dy = s.y - s.by;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.bx) * dx + (y - s.by) * dy) / len2)) : 0;
      const d = Math.hypot(x - (s.bx + dx * t), y - (s.by + dy * t));
      if (d < slack && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  function setFocus(v: OfficeView | null): void {
    const key = v === null ? null : v.o.key;
    if (key === focus) return;
    focus = key;
    if (v !== null) {
      target = { yaw: nearAngle(yaw, -v.lng * D2R), tilt: Math.max(-0.9, Math.min(0.95, v.lat * D2R - 0.3)) };
      vyaw = 0;
      vtilt = 0;
      canvas.style.cursor = 'pointer';
    } else {
      target = null;
      idleAt = performance.now() + 1400;
      canvas.style.cursor = 'grab';
    }
    events.onFocus(key);
    kick();
  }

  function local(e: PointerEvent): { x: number; y: number } {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    drag = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), moved: false, touch: e.pointerType !== 'mouse' };
    vyaw = 0;
    vtilt = 0;
    kick();
  }

  function onMove(e: PointerEvent): void {
    const p = local(e);
    if (drag !== null && e.pointerId === drag.id) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) {
        drag.moved = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is gone */
        }
        canvas.style.cursor = 'grabbing';
        target = null;
      }
      if (drag.moved) {
        const k = 0.0062 * (160 / Math.max(120, height * 0.39));
        const now = performance.now();
        const dtm = Math.max(1, now - drag.t) / 1000;
        yaw += dx * k;
        tilt += drag.touch ? 0 : dy * k;
        vyaw = vyaw * 0.6 + ((dx * k) / dtm) * 0.4;
        vtilt = drag.touch ? 0 : vtilt * 0.6 + ((dy * k) / dtm) * 0.4;
        drag.t = now;
        idleAt = now + 1800;
        spin = 0;
      }
      drag.x = p.x;
      drag.y = p.y;
      kick();
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const hit = pick(p.x, p.y, 16);
    if (hit !== null) setFocus(hit);
    else if (focus !== null) {
      const f = offices.find((v) => v.o.key === focus);
      if (f === undefined || Math.hypot(p.x - f.screen.x, p.y - f.screen.y) > 150) setFocus(null);
    }
  }

  function onUp(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    canvas.style.cursor = focus !== null ? 'pointer' : 'grab';
    if (d.moved) {
      idleAt = performance.now() + 1800;
      kick();
      return;
    }
    const p = local(e);
    const hit = pick(p.x, p.y, d.touch ? 26 : 16);
    if (hit === null) {
      if (d.touch) setFocus(null);
      return;
    }
    if (!d.touch || hit.o.key === focus) events.onSelect(hit.o.key);
    else setFocus(hit);
  }

  function onCancel(e: PointerEvent): void {
    if (drag !== null && e.pointerId === drag.id) drag = null;
  }

  function onLeave(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && drag === null) {
      // Leaving for the tooltip keeps the focus.
      const to = e.relatedTarget as Node | null;
      if (to !== null && anchor.contains(to)) return;
      setFocus(null);
    }
  }

  function onAnchorLeave(e: PointerEvent): void {
    const to = e.relatedTarget as Node | null;
    if (to === canvas || (to !== null && host.contains(to) && !anchor.contains(to))) return;
    setFocus(null);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  anchor.addEventListener('pointerleave', onAnchorLeave);

  /* ------------------------------------------------------- lifecycle */

  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(host);
  const io = new IntersectionObserver((es) => {
    visible = es.some((x) => x.isIntersecting);
    setRunning(visible && !document.hidden);
  });
  io.observe(host);
  const onVis = (): void => setRunning(visible && !document.hidden);
  document.addEventListener('visibilitychange', onVis);
  // The theme: the tokens are rewritten on <html> (attributes and inline style) when it changes.
  let themeQueued = 0;
  const mo = new MutationObserver(() => {
    if (themeQueued !== 0) return;
    themeQueued = window.setTimeout(() => {
      themeQueued = 0;
      const next = readPalette();
      if (JSON.stringify(next) === JSON.stringify(pal)) return;
      pal = next;
      colours();
      kick();
    }, 60);
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style', 'class'] });
  const lost = (e: Event): void => {
    e.preventDefault();
    setRunning(false);
  };
  canvas.addEventListener('webglcontextlost', lost);

  // Start facing the head office (or the one country).
  const head = data.offices.find((o) => o.key === data.head) ?? data.offices[0];
  updateSun();
  resize();
  colours();
  yaw = head !== undefined ? -head.lng * D2R - (data.close ? 0 : 0.35) : 0;
  tilt = restTilt;
  spin = data.close ? 0 : 1;
  globe.rotation.set(tilt, yaw, 0);
  setRunning(!document.hidden);

  let gone = false;
  return {
    update(d: SceneData): void {
      // Home reloads its read on many changes; rebuild only when what the globe shows changed.
      if (gone || JSON.stringify(d) === JSON.stringify(data)) return;
      const before = new Map(data.offices.map((o) => [o.key, o.last_in]));
      const wasClose = data.close;
      data = d;
      buildOffices();
      if (d.close !== wasClose) resize();
      // A new clock-in since the last answer: a ring at once.
      if (!reduced)
        for (const v of offices) {
          const was = before.get(v.o.key);
          if (was !== undefined && v.o.last_in !== '' && v.o.last_in > was) emitRing(v);
        }
      if (focus !== null && !offices.some((v) => v.o.key === focus)) setFocus(null);
      kick();
    },
    setReduced(on: boolean): void {
      reduced = on;
      if (on) {
        sparkGeo.setDrawRange(0, 0);
        for (const v of offices) for (const r of v.rings) ((r.live = false), (r.mat.opacity = 0));
      } else sparkGeo.setDrawRange(0, arcs.length * SPARKS_PER_ARC);
      kick();
    },
    dispose(): void {
      gone = true;
      setRunning(false);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      if (themeQueued !== 0) clearTimeout(themeQueued);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', lost);
      anchor.removeEventListener('pointerleave', onAnchorLeave);
      for (const v of offices) v.label.remove();
      disposeTree(scene);
      ringGeo.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

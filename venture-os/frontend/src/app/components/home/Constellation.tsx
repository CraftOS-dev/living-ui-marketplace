/**
 * The firm constellation (Home's hero, Fix 3, alive in Fix 4): monochrome
 * thin line art on the page background that reads as the firm's picture.
 *
 *   - The wireframe sphere at the centre is the firm; it turns slowly and
 *     continuously (one turn in 40 seconds).
 *   - The thick circle around it is committed capital: solid for the share
 *     called, dashed for dry powder, labelled "62% called".
 *   - Each tilted orbit is a fund, sized by the fund, its name beside the
 *     orbit where it is widest. Each node on it is a portfolio company,
 *     sized by its current value, its name beside it (nudged so no two
 *     names overlap): the companies keep their order on the orbit (by the
 *     day first invested) and travel slowly round it (one lap in about four
 *     minutes); on the back half they pass behind the firm.
 *   - A company that needs attention (runway under the threshold or valued
 *     below cost) is a hollow ring in the bad token that pulses: a soft ring
 *     grows and fades every 2 seconds.
 *   - The vertical axis is TVPI, the horizontal axis DPI: tick dots at 1x,
 *     2x and 3x, a bar at the current value, the value at the end.
 *
 * Two layers: what stands still is SVG (axes, orbits, the capital circle,
 * the fund names, the words), what moves is drawn on a canvas above it (the
 * sphere's lines, the companies, the pulses, the company names), so a frame
 * changes no page element and costs the browser almost nothing. A timer
 * wakes the loop about 15 times a second. It pauses while the pointer or
 * keyboard focus rests on a company, when the drawing is off screen or the
 * tab hidden, and does not run with prefers-reduced-motion (the drawing is
 * then still, every name placed).
 *
 * Pointing at a company shows its detail (Hero's tooltip) and a ring; a
 * click opens it. Keyboard: each company is a button in a list read by
 * screen readers; focusing one stops the motion and rings it in the drawing.
 * Ink strokes (light in dark mode) from --vo-ink; the only colour is the bad
 * token on the companies that need attention.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { daysBetween, money, months, multiple, plural } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Constellation as Data, ConstellationNode, Ring } from './types.ts';

export const VIEW_W = 760;
export const VIEW_H = 440;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
/** The sphere, the capital circle, the dashed arcs. */
const R0 = 48;
const R1 = 82;
/** The firm's disc: what passes behind it is hidden. */
const DISC = R1 + 2;
/** The axes: the TVPI arm runs up from the circle, the DPI arm right. */
const AXIS_TOP = 18;
const AXIS_BOTTOM = VIEW_H - 18;
const AXIS_LEFT = 64;
const AXIS_RIGHT = VIEW_W - 64;
const ARM_FROM = R1 + 12;
/** One turn of the sphere. */
const SPIN_MS = 40000;
/** One lap of a company round an orbit of 260 units (a wider orbit takes longer). */
const LAP_MS = 240000;
/** One pulse of a company that needs attention. */
const PULSE_MS = 2000;
/** About 15 frames a second: smooth at these speeds. */
const FRAME_MS = 66;
const SPHERE_AT_REST = 0.6;

/** Orbit shapes by fund size rank: the largest flat and rising to the right, the next rounder and falling. */
const SHAPES = [
  { tilt: -32, ratio: 0.34 },
  { tilt: 40, ratio: 0.44 },
  { tilt: -60, ratio: 0.42 },
  { tilt: 62, ratio: 0.46 },
  { tilt: -12, ratio: 0.3 },
  { tilt: 16, ratio: 0.56 },
];

interface Orbit {
  ring: Ring;
  rx: number;
  ry: number;
  tilt: number;
  companies: number;
  /** Milliseconds per lap. */
  lap: number;
}

interface Seat {
  node: ConstellationNode;
  orbit: Orbit;
  /** The angle on the orbit at phase 0. */
  t0: number;
  r: number;
}

export interface Hover {
  kind: 'node' | 'orbit' | 'capital' | 'firm';
  key: string;
  /** In view box units. */
  x: number;
  y: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Where a company is now and where its name sits (eased). */
interface Spot {
  x: number;
  y: number;
  behind: boolean;
  hidden: boolean;
  lx: number;
  ly: number;
  spot: number;
  placed: boolean;
  /** The name's box size. */
  w: number;
  h: number;
  /** The name's opacity now (it fades in and out when it has, or loses, a clear spot). */
  a: number;
  /** When (phase ms) the name last took its spot. */
  since: number;
  /** Gliding to a new spot. */
  moving: boolean;
}

function at(o: Orbit, t: number): [number, number] {
  const a = (o.tilt * Math.PI) / 180;
  const ex = o.rx * Math.cos(t);
  const ey = o.ry * Math.sin(t);
  return [CX + ex * Math.cos(a) - ey * Math.sin(a), CY + ex * Math.sin(a) + ey * Math.cos(a)];
}

/** Half an orbit as a path: the back half (t from pi to 2 pi) or the front half. */
function half(o: Orbit, back: boolean): string {
  const pts: string[] = [];
  const from = back ? Math.PI : 0;
  for (let i = 0; i <= 64; i++) {
    const [x, y] = at(o, from + (Math.PI * i) / 64);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return 'M' + pts.join('L');
}

function orbitsOf(c: Data): Orbit[] {
  const sizes = c.rings.map((r) => (r.size_minor !== null && r.size_minor > 0 ? r.size_minor : 0));
  const max = Math.max(1, ...sizes);
  const rank = c.rings
    .map((r, i) => ({ i, s: sizes[i] ?? 0 }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
  return c.rings.map((ring, i) => {
    const pos = rank.indexOf(i);
    const shape = SHAPES[pos % SHAPES.length] ?? { tilt: -32, ratio: 0.34 };
    const s = sizes[i] ?? 0;
    let rx = 168 + 140 * (s > 0 ? Math.sqrt(s / max) : 0.6);
    let ry = Math.max(R1 + 8, rx * shape.ratio);
    const a = (shape.tilt * Math.PI) / 180;
    // Keep each orbit inside the frame.
    const hh = Math.sqrt((rx * Math.sin(a)) ** 2 + (ry * Math.cos(a)) ** 2);
    const hw = Math.sqrt((rx * Math.cos(a)) ** 2 + (ry * Math.sin(a)) ** 2);
    const k = Math.min(1, (CY - 26) / hh, (CX - 40) / hw);
    rx *= k;
    ry *= k;
    return { ring, rx, ry, tilt: shape.tilt, companies: c.nodes.filter((n) => n.fund === ring.id).length, lap: LAP_MS * Math.max(0.75, rx / 260) };
  });
}

/** Each company's starting place on its fund's orbit, in the order it was first invested; nodes never sit on top of each other. */
function seatsOf(c: Data, orbits: Orbit[], today: string): Seat[] {
  const maxV = Math.max(1, ...c.nodes.map((n) => Math.max(0, n.value_minor)));
  const out: Seat[] = [];
  for (const o of orbits) {
    const list = c.nodes.filter((n) => n.fund === o.ring.id);
    if (list.length === 0) continue;
    const known = list.map((n) => n.first_day).filter((d) => d !== '').sort();
    const start = o.ring.start_day !== '' && (known[0] === undefined || o.ring.start_day <= known[0]) ? o.ring.start_day : (known[0] ?? today);
    const span = Math.max(30, daysBetween(start, today));
    const ordered = list
      .map((n, i) => ({ n, f: n.first_day !== '' ? Math.min(1, Math.max(0, daysBetween(start, n.first_day) / span)) : 0.5 + (0.5 * i) / Math.max(1, list.length) }))
      .sort((a, b) => a.f - b.f || (a.n.company.name < b.n.company.name ? -1 : 1));
    const SPAN = Math.PI * 2 * 0.86;
    let last = -Infinity;
    const minStep = 26 / Math.max(80, (o.rx + o.ry) / 2);
    for (const { n, f } of ordered) {
      let t = Math.PI + 0.12 + f * SPAN;
      if (t - last < minStep) t = last + minStep;
      last = t;
      out.push({ node: n, orbit: o, t0: t, r: 3.5 + 6.5 * Math.sqrt(Math.max(0, n.value_minor) / maxV) });
    }
  }
  return out;
}

/** Where each fund's name sits: beyond the end of its orbit's long axis, alternating sides (right for the first). */
function orbitLabels(orbits: Orbit[], k: number): { id: string; text: string; x: number; y: number; anchor: 'start' | 'end'; box: Box }[] {
  return orbits
    .filter((o) => o.ring.label !== '')
    .map((o, i) => {
      const [ax, ay] = at(o, 0);
      const [bx, by] = at(o, Math.PI);
      const rightEnd: [number, number] = ax >= bx ? [ax, ay] : [bx, by];
      const leftEnd: [number, number] = ax >= bx ? [bx, by] : [ax, ay];
      const right = i % 2 === 0;
      const [ex, ey] = right ? rightEnd : leftEnd;
      const w = o.ring.label.length * 6.9 * k;
      let x = right ? ex + 9 * k : ex - 9 * k;
      // Keep the name inside the frame.
      if (right && x + w > VIEW_W - 4) x = VIEW_W - 4 - w;
      if (!right && x - w < 4) x = 4 + w;
      const y = Math.max(14 * k, Math.min(VIEW_H - 6 * k, ey + 4 * k));
      const l = right ? x : x - w;
      return { id: o.ring.id, text: o.ring.label, x, y, anchor: right ? 'start' : 'end', box: { l: l - 3 * k, t: y - 12 * k, r: l + w + 3 * k, b: y + 5 * k } };
    });
}

/** The wireframe sphere's lines at a turn (radians), front side only, as a canvas path. */
function sphere(turn: number): Path2D {
  const tiltX = (24 * Math.PI) / 180;
  const tiltZ = (-38 * Math.PI) / 180;
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);
  const proj = (lat: number, lon: number): [number, number, number] => {
    const l = lon + turn;
    let x = Math.cos(lat) * Math.cos(l);
    let y = Math.sin(lat);
    let z = Math.cos(lat) * Math.sin(l);
    // Tip the pole toward the viewer, then lean it on the screen.
    const y2 = y * cx - z * sx;
    const z2 = y * sx + z * cx;
    y = y2;
    z = z2;
    const x3 = x * cz - y * sz;
    const y3 = x * sz + y * cz;
    x = x3;
    y = y3;
    return [CX + x * R0, CY - y * R0, z];
  };
  const path = new Path2D();
  const line = (pts: [number, number, number][]): void => {
    let open = false;
    for (const [x, y, z] of pts) {
      if (z > -0.02) {
        if (open) path.lineTo(x, y);
        else path.moveTo(x, y);
        open = true;
      } else open = false;
    }
  };
  for (let m = 0; m < 12; m++) {
    const lon = (m * Math.PI) / 6;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 36; i++) pts.push(proj(-Math.PI / 2 + (Math.PI * i) / 36, lon));
    line(pts);
  }
  for (const deg of [-60, -30, 0, 30, 60]) {
    const lat = (deg * Math.PI) / 180;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 48; i++) pts.push(proj(lat, (Math.PI * 2 * i) / 48));
    line(pts);
  }
  return path;
}

/** An arc of the capital circle from angle a to b (degrees, clockwise from the top). */
function arc(r: number, a: number, b: number): string {
  const p = (d: number): string => {
    const t = ((d - 90) * Math.PI) / 180;
    return `${(CX + r * Math.cos(t)).toFixed(1)},${(CY + r * Math.sin(t)).toFixed(1)}`;
  };
  const large = b - a > 180 ? 1 : 0;
  return `M${p(a)}A${r},${r} 0 ${large} 1 ${p(b)}`;
}

/** Where a multiple sits on an arm: 0x at the circle, the arm's end at `max`. */
function armAt(v: number, max: number, len: number): number {
  return ARM_FROM + (Math.max(0, Math.min(v, max)) / max) * len;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How far a box reaches into the firm's circle and its inner dashed ring (0 when clear). */
function intoFirm(b: Box): number {
  const R = R1 + 16;
  const nx = Math.max(b.l, Math.min(CX, b.r));
  const ny = Math.max(b.t, Math.min(CY, b.b));
  const d = Math.hypot(nx - CX, ny - CY);
  return d < R ? (R - d) * (b.r - b.l) : 0;
}

/** The theme's colours as the canvas needs them (resolved from the --vo-* tokens). */
interface Ink {
  ink: string;
  page: string;
  bad: string;
}

function readInk(probe: HTMLElement | null): Ink {
  if (probe === null) return { ink: '#111', page: '#fff', bad: '#c81e1e' };
  const get = (v: string): string => {
    probe.style.color = `var(${v})`;
    return getComputedStyle(probe).color;
  };
  return { ink: get('--vo-ink'), page: get('--vo-page'), bad: get('--vo-bad') };
}

const INK = 'var(--vo-ink)';
const HALO = { paintOrder: 'stroke', stroke: 'var(--vo-page)', strokeLinejoin: 'round' } as const;
const FONT = "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif";

export interface ConstellationProps {
  data: Data | null;
  currency: string;
  today: string;
  tvpi: number | null;
  dpi: number | null;
  /** Called share of committed capital, 0 to 1 (null: no commitments). */
  called: number | null;
  reduced: boolean;
  /** CSS pixels per view box unit: labels keep their 12 and 13 px on any width. */
  scale: number;
  onHover: (h: Hover | null) => void;
  hover: Hover | null;
  label: string;
}

export function Constellation({ data, currency, today, tvpi, dpi, called, reduced, scale, onHover, hover, label }: ConstellationProps): React.JSX.Element {
  const k = 1 / Math.max(0.3, Math.min(1.25, scale || 1));
  const orbits = useMemo(() => (data !== null ? orbitsOf(data) : []), [data]);
  const seats = useMemo(() => (data !== null ? seatsOf(data, orbits, today) : []), [data, orbits, today]);
  const fundNames = useMemo(() => orbitLabels(orbits, k), [orbits, k]);
  const upLen = CY - ARM_FROM - AXIS_TOP - 26;
  const rightLen = AXIS_RIGHT - CX - ARM_FROM - 26;
  const tMax = Math.max(3.5, (tvpi ?? 0) + 0.5);
  const dMax = Math.max(3.5, (dpi ?? 0) + 0.5);
  const calledDeg = called !== null ? Math.max(0, Math.min(1, called)) * 360 : 0;
  // The label sits outside the circle on the diagonal nearest the end of the called arc, clear of both axes.
  const diag = [45, 135, 225, 315].reduce((b, d) => (Math.abs(d - calledDeg) < Math.abs(b - calledDeg) ? d : b), 135);
  const end = ((diag - 90) * Math.PI) / 180;
  const lx = CX + (R1 + 20) * Math.cos(end);
  const ly = CY + (R1 + 20) * Math.sin(end);
  const calledAnchor: 'start' | 'end' | 'middle' = Math.cos(end) < -0.2 ? 'end' : Math.cos(end) > 0.2 ? 'start' : 'middle';

  // The fixed words the company names keep clear of: the fund names, TVPI, DPI and "called".
  const fixed = useMemo<Box[]>(() => {
    const out = fundNames.map((f) => f.box);
    out.push({ l: CX + 6 * k, t: AXIS_TOP - 6 * k, r: CX + 110 * k, b: AXIS_TOP + 14 * k });
    out.push({ l: AXIS_RIGHT - 100 * k, t: CY - 22 * k, r: AXIS_RIGHT + 4, b: CY - 2 * k });
    if (called !== null) {
      const w = 74 * k;
      const l = calledAnchor === 'end' ? lx - w : calledAnchor === 'middle' ? lx - w / 2 : lx;
      out.push({ l, t: ly - 9 * k, r: l + w, b: ly + 9 * k });
    }
    return out;
  }, [fundNames, k, called, calledAnchor, lx, ly]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const spots = useRef<Map<string, Spot>>(new Map());
  const phase = useRef(0);
  const ink = useRef<Ink | null>(null);
  /** Name widths at the current size (measured once). */
  const widths = useRef<{ fs: number; w: Map<string, number> }>({ fs: 0, w: new Map() });
  /** The view box in the canvas: CSS pixels per unit and offsets (preserveAspectRatio meet). */
  const box = useRef({ w: 0, h: 0, s: 1, ox: 0, oy: 0, dpr: 1 });
  const hoverKey = hover !== null && hover.kind === 'node' ? hover.key : '';
  const live = useRef({ seats, fixed, k, hoverKey, reduced });
  live.current = { seats, fixed, k, hoverKey, reduced };

  /** Draw one frame at the phase (ms of motion so far); `snap` places the names at once (no easing). */
  const draw = useRef((ms: number, snap: boolean): void => {
    const cv = canvasRef.current;
    const g = cv?.getContext('2d') ?? null;
    if (cv === null || g === null) return;
    const { seats: list, fixed: fixedBoxes, k: kk, hoverKey: on, reduced: still } = live.current;
    const b = box.current;
    if (ink.current === null) ink.current = readInk(probeRef.current);
    const c = ink.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(b.dpr * b.s, 0, 0, b.dpr * b.s, b.dpr * b.ox, b.dpr * b.oy);
    g.lineJoin = 'round';

    // The sphere's lines.
    g.globalAlpha = 0.62;
    g.strokeStyle = c.ink;
    g.lineWidth = 0.9;
    g.stroke(sphere(SPHERE_AT_REST + (still ? 0 : ((ms % SPIN_MS) / SPIN_MS) * Math.PI * 2)));
    g.globalAlpha = 1;

    // Where each company is now.
    for (const s of list) {
      let sp = spots.current.get(s.node.holding);
      if (sp === undefined) {
        sp = { x: 0, y: 0, behind: false, hidden: false, lx: 0, ly: 0, spot: 0, placed: false, w: 0, h: 0, a: 0, since: 0, moving: false };
        spots.current.set(s.node.holding, sp);
      }
      const t = s.t0 + (still ? 0 : (ms / s.orbit.lap) * Math.PI * 2);
      const [x, y] = at(s.orbit, t);
      const back = Math.sin(t) < 0;
      const dist = Math.hypot(x - CX, y - CY);
      sp.x = x;
      sp.y = y;
      sp.behind = back && dist < DISC + s.r + 12;
      sp.hidden = back && dist < DISC;
    }

    // The companies: solid when healthy, a hollow ring that pulses when it needs attention; behind the firm hidden.
    const p = (ms % PULSE_MS) / PULSE_MS;
    for (const s of list) {
      const sp = spots.current.get(s.node.holding);
      if (sp === undefined) continue;
      g.save();
      if (sp.behind) {
        g.beginPath();
        g.rect(-40, -40, VIEW_W + 80, VIEW_H + 80);
        g.arc(CX, CY, DISC, 0, Math.PI * 2);
        g.clip('evenodd');
      }
      const rr = Math.max(4, s.r);
      if (s.node.attention) {
        if (!still) {
          const e = 1 - (1 - p) * (1 - p);
          g.globalAlpha = 0.55 * (1 - p);
          g.strokeStyle = c.bad;
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(sp.x, sp.y, rr + 1.5 + 10 * e, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        g.fillStyle = c.page;
        g.strokeStyle = c.bad;
        g.lineWidth = on === s.node.holding ? 2.6 : 1.9;
        g.beginPath();
        g.arc(sp.x, sp.y, rr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        g.globalAlpha = on === s.node.holding ? 1 : 0.86;
        g.fillStyle = c.ink;
        g.strokeStyle = c.page;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(sp.x, sp.y, s.r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.globalAlpha = 1;
      }
      if (on === s.node.holding) {
        g.globalAlpha = 0.6;
        g.strokeStyle = c.ink;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(sp.x, sp.y, rr + 4, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.restore();
    }

    // The names beside the companies: the first clear spot (outward, inward, above, below...), kept while it stays
    // clear. Companies that need attention are placed first, then by value; a name with no clear spot (a narrow
    // phone) fades out until it has one again. Names keep off the firm's circle, the words and every dot.
    const fs = 12 * kk;
    const h = 15 * kk;
    g.font = `400 ${fs}px ${FONT}`;
    g.textBaseline = 'alphabetic';
    if (widths.current.fs !== fs) widths.current = { fs, w: new Map() };
    const known = widths.current.w;
    const placed: Box[] = [];
    const dots: Box[] = [];
    for (const s of list) {
      const sp = spots.current.get(s.node.holding);
      if (sp === undefined || sp.hidden) continue;
      const rr = Math.max(4, s.r) + 1;
      dots.push({ l: sp.x - rr, t: sp.y - rr, r: sp.x + rr, b: sp.y + rr });
    }
    const order = list.map((s) => ({ s, sp: spots.current.get(s.node.holding) })).filter((x): x is { s: Seat; sp: Spot } => x.sp !== undefined);
    order.sort((a, b2) => Number(b2.s.node.attention) - Number(a.s.node.attention) || b2.s.node.value_minor - a.s.node.value_minor || (a.s.node.company.name < b2.s.node.company.name ? -1 : 1));
    for (const { s, sp } of order) {
      if (sp.hidden) {
        sp.placed = false;
        sp.a = 0;
        continue;
      }
      let w = known.get(s.node.company.name);
      if (w === undefined) {
        w = g.measureText(s.node.company.name).width + 4 * kk;
        known.set(s.node.company.name, w);
      }
      sp.w = w;
      sp.h = h;
      const gap = Math.max(4, s.r) + 3 * kk;
      const out = sp.x >= CX ? 1 : -1;
      const side = out > 0 ? sp.x + gap : sp.x - gap - w;
      const other = out > 0 ? sp.x - gap - w : sp.x + gap;
      const spotsAt: [number, number][] = [
        [side, sp.y - h / 2],
        [other, sp.y - h / 2],
        [sp.x - w / 2, sp.y - gap - h],
        [sp.x - w / 2, sp.y + gap],
        [side, sp.y - h * 1.3],
        [side, sp.y + h * 0.3],
        [other, sp.y - h * 1.3],
        [other, sp.y + h * 0.3],
        [side, sp.y - h * 2],
        [side, sp.y + h],
        [other, sp.y - h * 2],
        [other, sp.y + h],
        [sp.x - w / 2, sp.y - gap - h * 2],
        [sp.x - w / 2, sp.y + gap + h],
        [side + (out > 0 ? h : -h), sp.y - h * 2.6],
        [side + (out > 0 ? h : -h), sp.y + h * 1.6],
      ];
      const score = (i: number, margin = true): number => {
        const q = spotsAt[i];
        if (q === undefined) return Infinity;
        const bx: Box = { l: q[0], t: q[1], r: q[0] + w, b: q[1] + h };
        let sc = i * 0.01;
        if (bx.l < 2) sc += (2 - bx.l) * h * 4;
        if (bx.r > VIEW_W - 2) sc += (bx.r - VIEW_W + 2) * h * 4;
        if (bx.t < 2) sc += (2 - bx.t) * w * 4;
        if (bx.b > VIEW_H - 2) sc += (bx.b - VIEW_H + 2) * w * 4;
        // Other names keep a small margin, so a name moves on before two touch.
        const m = margin ? 2 * kk : 0;
        const wide: Box = { l: bx.l - m, t: bx.t - m, r: bx.r + m, b: bx.b + m };
        for (const o of placed) sc += overlap(wide, o) * 3;
        for (const o of fixedBoxes) sc += overlap(bx, o) * 2;
        for (const o of dots) sc += overlap(bx, o);
        sc += intoFirm(bx);
        return sc;
      };
      // The name keeps its spot while it touches nothing; a new spot must also keep a small margin from other names.
      let best = sp.placed ? sp.spot : 0;
      let bestScore = sp.placed && !snap ? score(best, false) : score(best);
      if (bestScore >= 1)
        for (let i = 0; i < spotsAt.length; i++) {
          const sc = score(i);
          if (sc < bestScore - 0.5) {
            best = i;
            bestScore = sc;
          }
        }
      const strong = on === s.node.holding;
      // A name shows where it is clear (the one pointed at always shows). It travels with its dot; when its spot
      // stops being clear it glides to the new one (nudged), and a name with no clear spot fades out.
      const clear = bestScore < 1 || strong;
      const target = spotsAt[best] ?? spotsAt[0] ?? [side, sp.y - h / 2];
      if (clear) {
        if (snap || still || !sp.placed || sp.a <= 0.05) {
          sp.lx = target[0];
          sp.ly = target[1];
        } else {
          sp.lx += (target[0] - sp.lx) * 0.3;
          sp.ly += (target[1] - sp.ly) * 0.3;
        }
        if (!sp.placed || sp.spot !== best) sp.since = ms;
        sp.spot = best;
        sp.placed = true;
      }
      sp.moving = Math.hypot(target[0] - sp.lx, target[1] - sp.ly) > 1.5;
      const goal = clear ? 1 : 0;
      sp.a = snap || still ? goal : sp.a + (goal - sp.a) * 0.3;
      if (!clear && sp.a < 0.05) {
        sp.a = 0;
        sp.placed = false;
      }
      if (sp.a > 0) placed.push({ l: sp.lx, t: sp.ly, r: sp.lx + w, b: sp.ly + h });
      if (sp.a <= 0) continue;
      const tx = sp.lx + 2 * kk;
      const ty = sp.ly + h * 0.72;
      if (strong) g.font = `500 ${fs}px ${FONT}`;
      g.globalAlpha = sp.a;
      g.strokeStyle = c.page;
      g.lineWidth = 4 * kk;
      g.strokeText(s.node.company.name, tx, ty);
      g.globalAlpha = (strong ? 1 : 0.7) * sp.a;
      g.fillStyle = c.ink;
      g.fillText(s.node.company.name, tx, ty);
      g.globalAlpha = 1;
      if (strong) g.font = `400 ${fs}px ${FONT}`;
    }
  }).current;

  // The canvas follows the drawing's box (and the screen's pixel ratio).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (wrap === null || cv === null) return;
    const fit = (): void => {
      const w = wrap.clientWidth;
      const hh = wrap.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const s = Math.min(w / VIEW_W, hh / VIEW_H) || 1;
      box.current = { w, h: hh, s, ox: (w - VIEW_W * s) / 2, oy: (hh - VIEW_H * s) / 2, dpr };
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(hh * dpr));
      draw(phase.current, true);
    };
    fit();
    // For tests and support: where each company and its name are now (view box units). Not part of the page.
    Object.defineProperty(cv, 'voSpots', { configurable: true, get: () => [...spots.current.entries()].map(([key, v]) => ({ key, ...v })) });
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // The theme's colours: read again when <html> changes theme or the scheme flips.
  useEffect(() => {
    const again = (): void => {
      ink.current = null;
      widths.current = { fs: 0, w: new Map() };
      draw(phase.current, true);
    };
    const mo = new MutationObserver(again);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener('change', again);
    // The web font may arrive after the first frame: measure and draw again.
    void document.fonts?.ready.then(again);
    return () => {
      mo.disconnect();
      mq?.removeEventListener('change', again);
    };
  }, [draw]);

  // Every change of data, size, hover or motion setting draws at once.
  useLayoutEffect(() => {
    if (reduced) phase.current = 0;
    draw(phase.current, true);
  }, [seats, fixed, k, hoverKey, reduced, draw]);

  // The loop: a timer wakes it about 15 times a second and asks for one frame then (no frame requested in between);
  // paused on a company, off screen or in a hidden tab; never with reduced motion.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (reduced || wrap === null) return;
    let raf = 0;
    let timer = 0;
    let last = performance.now();
    let seen = true;
    const io = new IntersectionObserver((e) => {
      const x = e[e.length - 1];
      if (x !== undefined) seen = x.isIntersecting;
    });
    io.observe(wrap);
    const wake = (): void => {
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(step);
      }, FRAME_MS);
    };
    const step = (now: number): void => {
      const dt = Math.min(250, Math.max(0, now - last));
      last = now;
      if (seen && !document.hidden && live.current.hoverKey === '') {
        phase.current += dt;
        draw(phase.current, false);
      }
      wake();
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [reduced, draw]);

  // Pointing: the company under the pointer (the canvas does not take events; the wrapper hit-tests the companies).
  const nodeAt = (clientX: number, clientY: number): Seat | null => {
    const wrap = wrapRef.current;
    if (wrap === null) return null;
    const r = wrap.getBoundingClientRect();
    const b = box.current;
    const x = (clientX - r.left - b.ox) / b.s;
    const y = (clientY - r.top - b.oy) / b.s;
    let best: Seat | null = null;
    let bestD = Infinity;
    for (const s of seats) {
      const sp = spots.current.get(s.node.holding);
      if (sp === undefined || sp.hidden) continue;
      const d = Math.hypot(sp.x - x, sp.y - y);
      const reach = Math.max(12 * k * 0.8, s.r + 6);
      if (d <= reach && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };
  const show = (s: Seat): void => {
    const sp = spots.current.get(s.node.holding);
    onHover({ kind: 'node', key: s.node.holding, x: sp !== undefined ? sp.x : CX, y: (sp !== undefined ? sp.y : CY) - s.r });
  };
  const onMove = (e: React.PointerEvent): void => {
    const s = nodeAt(e.clientX, e.clientY);
    const wrap = wrapRef.current;
    if (s !== null) {
      if (hoverKey !== s.node.holding) show(s);
      if (wrap !== null) wrap.style.cursor = 'pointer';
      return;
    }
    if (wrap !== null) wrap.style.cursor = '';
    if (hoverKey !== '') {
      // Off the company: back to the orbit under the pointer, if any, else nothing.
      const t = e.target as Element;
      const orbit = t.getAttribute?.('data-vo-orbit');
      const o = orbit !== null && orbit !== undefined ? orbits.find((x) => x.ring.id === orbit) : undefined;
      if (o !== undefined) {
        const [hx, hy] = at(o, Math.PI * 1.5);
        onHover({ kind: 'orbit', key: o.ring.id, x: hx, y: hy });
      } else onHover(null);
    }
  };
  const onClickWrap = (e: React.MouseEvent): void => {
    const s = nodeAt(e.clientX, e.clientY);
    if (s !== null) {
      e.preventDefault();
      e.stopPropagation();
      navigate('/portfolio/' + s.node.company.id);
    }
  };

  const focusOn = (h: Hover): (() => void) => () => {
    if (hoverKey === '') onHover(h);
  };
  const off = (): void => {
    if (hoverKey === '') onHover(null);
  };
  const keyOpen = (go: () => void) => (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  };
  const ticks = (max: number, len: number, vertical: boolean): ReactNode =>
    [1, 2, 3].map((m) => {
      const d = armAt(m, max, len);
      return (
        <circle key={(vertical ? 't' : 'd') + m} cx={vertical ? CX : CX + d} cy={vertical ? CY - d : CY} r={2.6} fill={INK} opacity={0.75}>
          <title>{`${m}x`}</title>
        </circle>
      );
    });
  const halo = { ...HALO, strokeWidth: 5 * k };
  const thin = { ...HALO, strokeWidth: 4 * k };
  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      onPointerMove={onMove}
      onPointerLeave={() => {
        if (wrapRef.current !== null) wrapRef.current.style.cursor = '';
        if (hoverKey !== '') onHover(null);
      }}
      onClickCapture={onClickWrap}
      data-vo-motion={reduced ? 'still' : 'on'}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} className="absolute inset-0 block h-full w-full overflow-visible" style={{ fontFamily: 'var(--vo-font)' }}>
        {/* The axes: TVPI up, DPI right; each end with its mark. */}
        <g stroke={INK} strokeWidth={1.1} fill="none" opacity={0.6}>
          <line x1={CX} y1={AXIS_TOP + 14} x2={CX} y2={AXIS_BOTTOM - 5} />
          <line x1={AXIS_LEFT + 5} y1={CY} x2={AXIS_RIGHT - 14} y2={CY} />
          <path d={`M${CX - 6},${AXIS_TOP + 11}L${CX},${AXIS_TOP}L${CX + 6},${AXIS_TOP + 11}Z`} />
          <line x1={CX - 6} y1={AXIS_TOP + 15} x2={CX + 6} y2={AXIS_TOP + 15} />
          <line x1={CX - 6} y1={AXIS_TOP + 18} x2={CX + 6} y2={AXIS_TOP + 18} />
          <path d={`M${AXIS_RIGHT - 11},${CY - 6}L${AXIS_RIGHT},${CY}L${AXIS_RIGHT - 11},${CY + 6}Z`} />
          <line x1={AXIS_RIGHT - 15} y1={CY - 6} x2={AXIS_RIGHT - 15} y2={CY + 6} />
          <line x1={AXIS_RIGHT - 18} y1={CY - 6} x2={AXIS_RIGHT - 18} y2={CY + 6} />
          <circle cx={CX} cy={AXIS_BOTTOM} r={4} fill="var(--vo-page)" />
          <circle cx={AXIS_LEFT} cy={CY} r={4} fill="var(--vo-page)" />
        </g>
        {ticks(tMax, upLen, true)}
        {ticks(dMax, rightLen, false)}

        {/* The back halves of the orbits pass behind the firm. */}
        <g fill="none" stroke={INK} strokeWidth={1.25} opacity={0.5}>
          {orbits.map((o) => (
            <path key={'b' + o.ring.id} d={half(o, true)} />
          ))}
        </g>

        {/* Committed capital: a disc over the axes, solid for the share called, dashed for dry powder. */}
        <circle cx={CX} cy={CY} r={DISC} fill="var(--vo-page)" />
        <g fill="none" stroke={INK} opacity={0.32} strokeWidth={1}>
          <path d={arc(R1 + 13, 200, 330)} strokeDasharray="5 5" />
          <path d={arc(R1 + 13, 20, 150)} strokeDasharray="5 5" />
          <path d={arc(R1 + 24, 240, 300)} strokeDasharray="3 6" />
          <path d={arc(R1 + 24, 60, 120)} strokeDasharray="3 6" />
        </g>
        {called === null ? (
          <circle cx={CX} cy={CY} r={R1} fill="none" stroke={INK} strokeWidth={1.25} opacity={0.6} />
        ) : (
          <g fill="none" stroke={INK} strokeWidth={4} strokeLinecap="butt">
            {calledDeg >= 359.5 ? <circle cx={CX} cy={CY} r={R1} opacity={0.88} /> : calledDeg > 0.5 && <path d={arc(R1, 0, calledDeg)} opacity={0.88} />}
            {calledDeg < 359.5 && <path d={arc(R1, calledDeg, 360)} strokeDasharray="5 5" strokeWidth={3} opacity={0.42} />}
          </g>
        )}
        {called !== null && (
          <path
            d={arc(R1, 0, 359.9)}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            tabIndex={0}
            role="img"
            aria-label="Committed capital"
            className="vo-focus cursor-help outline-none"
            onPointerEnter={focusOn({ kind: 'capital', key: 'capital', x: CX, y: CY - R1 })}
            onPointerLeave={off}
            onFocus={focusOn({ kind: 'capital', key: 'capital', x: CX, y: CY - R1 })}
            onBlur={off}
          />
        )}

        {/* The firm: the sphere's outline (its turning lines are on the canvas). */}
        <circle cx={CX} cy={CY} r={R0} fill="var(--vo-page)" stroke={INK} strokeWidth={1.25} opacity={0.9} />
        <circle
          cx={CX}
          cy={CY}
          r={R0}
          fill="transparent"
          tabIndex={0}
          role="img"
          aria-label="Your funds"
          className="vo-focus cursor-help outline-none"
          onPointerEnter={focusOn({ kind: 'firm', key: 'firm', x: CX, y: CY + R0 })}
          onPointerLeave={off}
          onFocus={focusOn({ kind: 'firm', key: 'firm', x: CX, y: CY + R0 })}
          onBlur={off}
        />

        {/* The front halves of the orbits, and an invisible wide line to point at each fund. */}
        <g fill="none" stroke={INK} strokeWidth={1.25} opacity={0.78}>
          {orbits.map((o) => (
            <path key={'f' + o.ring.id} d={half(o, false)} strokeWidth={o.ring.scoped ? 2 : 1.25} />
          ))}
        </g>
        {orbits.map((o) => {
          const [hx, hy] = at(o, Math.PI * 1.5);
          const go = (): void => navigate('/funds/' + o.ring.id);
          return (
            <path
              key={'h' + o.ring.id}
              d={half(o, true) + half(o, false)}
              fill="none"
              stroke="transparent"
              strokeWidth={10}
              role="link"
              tabIndex={0}
              aria-label={`${o.ring.label || 'Fund'}: ${plural(o.companies, 'company', 'companies')}`}
              className="vo-focus cursor-pointer outline-none"
              data-vo-orbit={o.ring.id}
              onPointerEnter={focusOn({ kind: 'orbit', key: o.ring.id, x: hx, y: hy })}
              onPointerLeave={off}
              onFocus={focusOn({ kind: 'orbit', key: o.ring.id, x: hx, y: hy })}
              onBlur={off}
              onClick={go}
              onKeyDown={keyOpen(go)}
            />
          );
        })}

        {/* The current TVPI and DPI: a bar across each arm, the value at its end. */}
        {tvpi !== null && <line x1={CX - 7} x2={CX + 7} y1={CY - armAt(tvpi, tMax, upLen)} y2={CY - armAt(tvpi, tMax, upLen)} stroke={INK} strokeWidth={2.2} />}
        {dpi !== null && <line y1={CY - 7} y2={CY + 7} x1={CX + armAt(dpi, dMax, rightLen)} x2={CX + armAt(dpi, dMax, rightLen)} stroke={INK} strokeWidth={2.2} />}
        <text x={CX + 10 + 4 * k} y={AXIS_TOP + 4 + 7 * k} fontSize={13 * k} fill={INK} style={halo}>
          <tspan fill="var(--vo-muted)">TVPI</tspan>
          {tvpi !== null && (
            <tspan dx={5 * k} style={{ fontFamily: 'var(--vo-mono)' }}>
              {multiple(tvpi * 1e8)}
            </tspan>
          )}
        </text>
        <text x={AXIS_RIGHT} y={CY - 6 - 7 * k} fontSize={13 * k} fill={INK} textAnchor="end" style={halo}>
          <tspan fill="var(--vo-muted)">DPI</tspan>
          {dpi !== null && (
            <tspan dx={5 * k} style={{ fontFamily: 'var(--vo-mono)' }}>
              {multiple(dpi * 1e8)}
            </tspan>
          )}
        </text>
        {called !== null && (
          <text x={lx} y={ly + 4 * k} fontSize={12 * k} fill={INK} textAnchor={calledAnchor} style={halo}>
            <tspan style={{ fontFamily: 'var(--vo-mono)' }}>{Math.round((called ?? 0) * 100)}%</tspan>
            <tspan dx={4 * k} fill="var(--vo-muted)">
              called
            </tspan>
          </text>
        )}

        {/* Each fund's name beside its orbit, where the orbit is widest. */}
        <g fontSize={12 * k} fontWeight={500} fill="var(--vo-ink-2)" style={thin} pointerEvents="none" aria-hidden>
          {fundNames.map((f) => (
            <text key={f.id} x={f.x} y={f.y} textAnchor={f.anchor} data-vo-fund="">
              {f.text}
            </text>
          ))}
        </g>
      </svg>
      {/* What moves: the sphere's lines, the companies, the pulses and the company names. */}
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 block h-full w-full" data-vo-canvas="" />
      <span ref={probeRef} aria-hidden className="pointer-events-none absolute size-0 overflow-hidden opacity-0" />
      {/* The companies for the keyboard and screen readers: focusing one stops the motion and rings it in the drawing. */}
      <ul className="sr-only" aria-label="Portfolio companies in the picture">
        {seats.map((s) => (
          <li key={s.node.holding}>
            <button
              type="button"
              data-vo-node={s.node.attention ? 'attention' : 'healthy'}
              onFocus={() => show(s)}
              onBlur={() => onHover(null)}
              onClick={() => navigate('/portfolio/' + s.node.company.id)}
            >
              {s.node.company.name}: {money(s.node.value_minor, currency, { compact: true })}
              {s.node.runway_months !== null ? `, runway ${months(s.node.runway_months)}` : ''}
              {s.node.attention ? ', needs attention' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

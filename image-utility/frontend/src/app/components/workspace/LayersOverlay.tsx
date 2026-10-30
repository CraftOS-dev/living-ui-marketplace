/**
 * The layers, drawn live over the photo and edited in place, as in a
 * design tool: click a layer to select it, drag to move it, the handles
 * resize it (Shift keeps its proportions), the round handle above turns it
 * (Shift snaps to 15 degrees), arrows and lines have a handle at each end.
 * Double-click text to type in it. With a drawing tool on, a drag (or a
 * click) on the image makes a new layer.
 *
 * Layers are drawn here, in the browser, so every change shows at once; the
 * engine draws the same layers for exports, thumbnails and your AI agent.
 * Redactions pixelate or blur the photo under them right here too.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl } from '../../lib/api.ts';
import { FONT_CSS, place, textBlock, unplace } from '../../lib/layers.ts';
import type { Frame, Placed } from '../../lib/layers.ts';
import type { LayerType, Params } from '../../lib/types.ts';
import type { OverlayApi, View } from './Stage.tsx';

export type DrawTool = Exclude<LayerType, 'logo'>;

export interface LayerView {
  id: string;
  params: Params;
  visible: boolean;
  locked: boolean;
}

export interface DrawStyle {
  color: string;
  width: number;
  size: number;
  font: string;
  mode: string;
}

type Pt = [number, number];

const ACCENT = '#ff4f18';

function num(p: Params, k: string, d = 0): number {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function str(p: Params, k: string, d: string): string {
  const v = p[k];
  return typeof v === 'string' && v !== '' ? v : d;
}

/** Track a press until release with the pointer captured on the pressed element. */
function drag(e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void): void {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent): void => onMove(ev);
  const up = (ev: PointerEvent): void => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    onUp(ev);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

const rad = (d: number): number => (d * Math.PI) / 180;

function rot(x: number, y: number, a: number): Pt {
  const c = Math.cos(rad(a));
  const s = Math.sin(rad(a));
  return [x * c - y * s, x * s + y * c];
}

/* ------------------------------------------------------- redaction fills */

const patchCache = new Map<string, string>();

/** A pixelated or blurred copy of the photo under a box, as a data URL (made from the photo bitmap on screen). */
function usePatch(img: HTMLImageElement | null, fr: Frame, box: { x: number; y: number; w: number; h: number }, mode: string): string | null {
  const key = img === null ? '' : [img.src, mode, Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)].join('|');
  return useMemo(() => {
    if (img === null || mode === 'solid' || box.w < 1 || box.h < 1) return null;
    const hit = patchCache.get(key);
    if (hit !== undefined) return hit;
    const k = img.naturalWidth / fr.W;
    const sx = Math.max(0, box.x * k);
    const sy = Math.max(0, box.y * k);
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, box.w * k));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, box.h * k));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const ctx = out.getContext('2d');
    if (ctx === null) return null;
    if (mode === 'pixelate') {
      const block = Math.max(3, Math.round(Math.max(sw, sh) / 10));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(sw / block));
      small.height = Math.max(1, Math.round(sh / block));
      const sc = small.getContext('2d');
      if (sc === null) return null;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(img, sx, sy, sw, sh, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, out.width, out.height);
    } else {
      const r = Math.max(6, Math.min(sw, sh) / 3);
      ctx.filter = `blur(${r}px)`;
      ctx.drawImage(img, sx - r * 2, sy - r * 2, sw + r * 4, sh + r * 4, -r * 2, -r * 2, out.width + r * 4, out.height + r * 4);
    }
    let url: string | null = null;
    try {
      url = out.toDataURL('image/png');
    } catch {
      url = null;
    }
    if (url !== null) {
      if (patchCache.size > 60) patchCache.clear();
      patchCache.set(key, url);
    }
    return url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/* ---------------------------------------------------------------- shapes */

function Arrowhead({ x1, y1, x2, y2, w, s, color }: { x1: number; y1: number; x2: number; y2: number; w: number; s: number; color: string }): React.JSX.Element {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // As the engine draws it: 3.6 x the width, 26 degrees each side.
  const head = Math.max(10 * s, w * 3.6);
  const half = head * Math.tan(rad(26));
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  return <polygon points={`${x2},${y2} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`} fill={color} />;
}

function Redaction({ v, g, p, img, fr, clipId }: { v: View; g: Placed; p: Params; img: HTMLImageElement | null; fr: Frame; clipId: string }): React.JSX.Element {
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([u, w]) => {
    const [dx, dy] = rot((u ?? 0) * g.w, (w ?? 0) * g.h, g.angle);
    return [g.cx + dx, g.cy + dy] as Pt;
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const mode = str(p, 'mode', 'solid');
  const patch = usePatch(img, fr, box, mode);
  const pts = corners.map((c) => v.x + c[0] * v.s + ',' + (v.y + c[1] * v.s)).join(' ');
  if (mode === 'solid' || patch === null)
    return <polygon points={pts} fill={mode === 'solid' ? str(p, 'color', '#000000') : '#8a8a8a'} />;
  return (
    <g>
      <clipPath id={clipId}>
        <polygon points={pts} />
      </clipPath>
      <image href={patch} x={v.x + box.x * v.s} y={v.y + box.y * v.s} width={box.w * v.s} height={box.h * v.s} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
    </g>
  );
}

function TextMark({ p, g, s, hidden = false }: { p: Params; g: Placed; s: number; hidden?: boolean }): React.JSX.Element {
  const size = g.size * s;
  const b = textBlock(p, size);
  const f = FONT_CSS[str(p, 'font', 'sans-bold')] ?? { family: 'sans-serif', weight: 600 };
  const align = str(p, 'align', 'left');
  const tx = align === 'center' ? 0 : align === 'right' ? b.w / 2 - b.pad : -b.w / 2 + b.pad;
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const outline = p['outline'];
  return (
    <g opacity={hidden ? 0 : 1}>
      {p['bg'] !== undefined && <rect x={-b.w / 2} y={-b.h / 2} width={b.w} height={b.h} rx={size * 0.2} fill={String(p['bg'])} fillOpacity={num(p, 'bg_opacity', 0.75)} />}
      <text
        x={tx}
        y={-b.h / 2 + b.pad + size * 0.04}
        fontSize={size}
        fontFamily={f.family}
        fontWeight={f.weight}
        fill={str(p, 'color', ACCENT)}
        stroke={typeof outline === 'string' ? outline : undefined}
        strokeWidth={typeof outline === 'string' ? size * 0.12 : 0}
        paintOrder="stroke"
        textAnchor={anchor}
        dominantBaseline="hanging"
      >
        {b.lines.map((l, i) => (
          <tspan key={i} x={tx} dy={i === 0 ? 0 : b.lineH}>
            {l === '' ? ' ' : l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function Tiled({ v, fr, g, p, logoUrl, id }: { v: View; fr: Frame; g: Placed; p: Params; logoUrl: string | null; id: string }): React.JSX.Element | null {
  const s = v.s;
  const isText = p['type'] === 'text';
  const mw = (isText ? g.w : g.w) * s;
  const mh = (isText ? g.h : g.h) * s;
  // The engine turns each mark, then repeats it on a grid, every other row shifted half a step.
  const c = Math.abs(Math.cos(rad(g.angle)));
  const sn = Math.abs(Math.sin(rad(g.angle)));
  const ew = mw * c + mh * sn;
  const eh = mw * sn + mh * c;
  const gap = Math.max(ew, eh) * (1 + num(p, 'gap', 60) / 100);
  if (!(gap > 2)) return null;
  const mark = (x: number, y: number, key: string): React.JSX.Element => (
    <g key={key} transform={`translate(${x} ${y}) rotate(${g.angle})`}>
      {isText ? <TextMark p={p} g={g} s={s} /> : logoUrl !== null && <image href={logoUrl} x={-mw / 2} y={-mh / 2} width={mw} height={mh} preserveAspectRatio="xMidYMid meet" />}
    </g>
  );
  return (
    <g>
      <defs>
        <pattern id={'tile-' + id} patternUnits="userSpaceOnUse" x={v.x} y={v.y} width={gap} height={gap * 1.2}>
          {mark(ew / 2, eh / 2, 'a')}
          {mark(ew / 2 + gap / 2, eh / 2 + gap * 0.6, 'b')}
          {mark(ew / 2 - gap / 2, eh / 2 + gap * 0.6, 'c')}
        </pattern>
      </defs>
      <rect x={v.x} y={v.y} width={fr.W * s} height={fr.H * s} fill={`url(#tile-${id})`} pointerEvents="none" />
    </g>
  );
}

function LayerShape({ l, v, fr, img, logoUrl, editing }: { l: LayerView; v: View; fr: Frame; img: HTMLImageElement | null; logoUrl: string | null; editing: boolean }): React.JSX.Element | null {
  const p = l.params;
  const type = str(p, 'type', 'rect') as LayerType;
  const g = place(p, fr);
  const s = v.s;
  const color = str(p, 'color', type === 'highlight' ? '#ffd60a' : ACCENT);
  const sw = Math.max(0, num(p, 'width', 6) * g.unit * s);
  const X = v.x + g.cx * s;
  const Y = v.y + g.cy * s;
  if ((type === 'text' || type === 'logo') && p['tile'] === true) return <Tiled v={v} fr={fr} g={g} p={p} logoUrl={logoUrl} id={l.id} />;
  if (type === 'arrow' || type === 'line') {
    const x1 = v.x + g.x1 * s;
    const y1 = v.y + g.y1 * s;
    const x2 = v.x + g.x2 * s;
    const y2 = v.y + g.y2 * s;
    const lw = Math.max(1, sw);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const head = type === 'arrow' ? Math.max(10 * s, lw * 3.6) * 0.6 : 0;
    const ex = x2 - ((x2 - x1) / len) * head;
    const ey = y2 - ((y2 - y1) / len) * head;
    const both = type === 'arrow' && p['both'] === true;
    const bx = both ? x1 + ((x2 - x1) / len) * head : x1;
    const by = both ? y1 + ((y2 - y1) / len) * head : y1;
    return (
      <g>
        <line x1={bx} y1={by} x2={ex} y2={ey} stroke={color} strokeWidth={lw} strokeLinecap="round" />
        {type === 'arrow' && <Arrowhead x1={x1} y1={y1} x2={x2} y2={y2} w={lw} s={s} color={color} />}
        {both && <Arrowhead x1={x2} y1={y2} x2={x1} y2={y1} w={lw} s={s} color={color} />}
      </g>
    );
  }
  if (type === 'text') {
    return (
      <g transform={`translate(${X} ${Y}) rotate(${g.angle})`}>
        <TextMark p={p} g={g} s={s} hidden={editing} />
      </g>
    );
  }
  if (type === 'step') {
    const r = (g.size * s) / 2;
    return (
      <g>
        <circle cx={X} cy={Y} r={r} fill={color} />
        <text x={X} y={Y} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.15} fontWeight={700} fontFamily="'Segoe UI', system-ui, sans-serif" fill={str(p, 'text_color', '#ffffff')}>
          {String(p['n'] ?? 1)}
        </text>
      </g>
    );
  }
  if (type === 'redact') return <Redaction v={v} g={g} p={p} img={img} fr={fr} clipId={'clip-' + l.id} />;
  const w = g.w * s;
  const h = g.h * s;
  const T = `translate(${X} ${Y}) rotate(${g.angle})`;
  if (type === 'logo') return <g transform={T}>{logoUrl !== null && <image href={logoUrl} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />}</g>;
  if (type === 'highlight') return <rect transform={T} x={-w / 2} y={-h / 2} width={w} height={h} fill={color} fillOpacity={0.4} />;
  if (type === 'pen') {
    const pts = (Array.isArray(p['points']) ? (p['points'] as unknown as Pt[]) : []).map((q) => (q[0] * w).toFixed(2) + ',' + (q[1] * h).toFixed(2)).join(' ');
    return <polyline transform={T} points={pts} fill="none" stroke={color} strokeWidth={Math.max(1, sw)} strokeLinecap="round" strokeLinejoin="round" />;
  }
  const fill = typeof p['fill'] === 'string' ? p['fill'] : 'none';
  const fo = num(p, 'fill_opacity', 0.25);
  if (type === 'ellipse') return <ellipse transform={T} cx={0} cy={0} rx={w / 2} ry={h / 2} fill={fill} fillOpacity={fo} stroke={color} strokeWidth={sw} />;
  return <rect transform={T} x={-w / 2} y={-h / 2} width={w} height={h} rx={num(p, 'radius') * g.unit * s} fill={fill} fillOpacity={fo} stroke={color} strokeWidth={sw} />;
}

/** The area that takes clicks for a layer (a little wider than thin strokes). */
function HitArea({ l, v, fr }: { l: LayerView; v: View; fr: Frame }): React.JSX.Element | null {
  const p = l.params;
  const g = place(p, fr);
  const s = v.s;
  if (g.shape === 'line') return <line x1={v.x + g.x1 * s} y1={v.y + g.y1 * s} x2={v.x + g.x2 * s} y2={v.y + g.y2 * s} stroke="transparent" strokeWidth={16} strokeLinecap="round" />;
  if (g.shape === 'step') return <circle cx={v.x + g.cx * s} cy={v.y + g.cy * s} r={(g.size * s) / 2 + 3} fill="transparent" />;
  const w = g.w * s;
  const h = g.h * s;
  return <rect transform={`translate(${v.x + g.cx * s} ${v.y + g.cy * s}) rotate(${g.angle})`} x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} fill="transparent" />;
}

/* -------------------------------------------------------------- overlay */

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

export function LayersOverlay({
  o,
  fr,
  baseUrl,
  layers,
  selected,
  tool,
  style,
  editingText,
  logos,
  interactive,
  onSelect,
  onChange,
  onCreate,
  onEditText,
}: {
  o: OverlayApi;
  fr: Frame;
  /** The photo bitmap on screen (redaction fills come from it). */
  baseUrl: string;
  layers: LayerView[];
  selected: string | null;
  tool: DrawTool | 'select';
  style: DrawStyle;
  editingText: string | null;
  logos: Record<string, string>;
  interactive: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, params: Params, done: boolean) => void;
  onCreate: (type: DrawTool, g: Partial<Placed> & { points?: Pt[] }) => void;
  onEditText: (id: string | null) => void;
}): React.JSX.Element {
  const v = o.view;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [draft, setDraft] = useState<{ type: DrawTool; a: Pt; b: Pt; pts: Pt[] } | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // The photo bitmap, for redaction fills.
  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = fileUrl(baseUrl);
    return () => {
      im.onload = null;
    };
  }, [baseUrl]);

  const at = (e: { clientX: number; clientY: number }): Pt => o.toImage(e.clientX, e.clientY);
  const sel = layers.find((l) => l.id === selected) ?? null;
  const selG = sel !== null ? place(sel.params, fr) : null;
  const selType = sel !== null ? (str(sel.params, 'type', 'rect') as LayerType) : null;
  const tiled = sel !== null && sel.params['tile'] === true;

  const startMove = (e: React.PointerEvent, l: LayerView): void => {
    if (e.button !== 0) return;
    onSelect(l.id);
    if (l.locked) {
      e.stopPropagation();
      return;
    }
    const p0 = l.params;
    const g0 = place(p0, fr);
    const [x0, y0] = at(e);
    let last: Params = p0;
    let moved = false;
    drag(
      e,
      (ev) => {
        let [x, y] = at(ev);
        let dx = x - x0;
        let dy = y - y0;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!moved && Math.hypot(dx, dy) * v.s < 2) return;
        moved = true;
        x = dx;
        y = dy;
        last = unplace(p0, g0.shape === 'line' ? { x1: g0.x1 + x, y1: g0.y1 + y, x2: g0.x2 + x, y2: g0.y2 + y } : { cx: g0.cx + x, cy: g0.cy + y }, fr);
        onChange(l.id, last, false);
      },
      () => {
        if (moved) onChange(l.id, last, true);
      },
    );
  };

  const startResize = (e: React.PointerEvent, hx: number, hy: number): void => {
    if (sel === null || selG === null) return;
    const p0 = sel.params;
    const g0 = selG;
    const uniform = g0.shape === 'text' || g0.shape === 'step' || selType === 'logo';
    let last: Params = p0;
    drag(
      e,
      (ev) => {
        const [px, py] = at(ev);
        const [lx, ly] = rot(px - g0.cx, py - g0.cy, -g0.angle);
        const ox = (-hx * g0.w) / 2;
        const oy = (-hy * g0.h) / 2;
        let w = hx !== 0 ? Math.max(4 / v.s, (lx - ox) * hx) : g0.w;
        let h = hy !== 0 ? Math.max(4 / v.s, (ly - oy) * hy) : g0.h;
        let k = 1;
        if ((uniform || ev.shiftKey) && hx !== 0 && hy !== 0) {
          k = Math.max(w / g0.w, h / g0.h);
          w = g0.w * k;
          h = g0.h * k;
        } else if (uniform) {
          k = hx !== 0 ? w / g0.w : h / g0.h;
          w = g0.w * k;
          h = g0.h * k;
        }
        const lcx = hx !== 0 ? ox + (hx * w) / 2 : 0;
        const lcy = hy !== 0 ? oy + (hy * h) / 2 : 0;
        const [dx, dy] = rot(lcx, lcy, g0.angle);
        const g = { cx: g0.cx + dx, cy: g0.cy + dy, angle: g0.angle, w, h, size: g0.size * (uniform ? k : 1) };
        last = unplace(p0, g, fr);
        onChange(sel.id, last, false);
      },
      () => onChange(sel.id, last, true),
    );
  };

  const startRotate = (e: React.PointerEvent): void => {
    if (sel === null || selG === null) return;
    const p0 = sel.params;
    const g0 = selG;
    let last: Params = p0;
    drag(
      e,
      (ev) => {
        const [px, py] = at(ev);
        let a = (Math.atan2(py - g0.cy, px - g0.cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        last = unplace(p0, { cx: g0.cx, cy: g0.cy, angle: a, w: g0.w, h: g0.h }, fr);
        onChange(sel.id, last, false);
      },
      () => onChange(sel.id, last, true),
    );
  };

  const startEnd = (e: React.PointerEvent, end: 1 | 2): void => {
    if (sel === null || selG === null) return;
    const p0 = sel.params;
    const g0 = selG;
    let last: Params = p0;
    drag(
      e,
      (ev) => {
        let [px, py] = at(ev);
        const ax = end === 1 ? g0.x2 : g0.x1;
        const ay = end === 1 ? g0.y2 : g0.y1;
        if (ev.shiftKey) {
          // Snap to 45 degree steps around the other end.
          const len = Math.hypot(px - ax, py - ay);
          const a = Math.round(Math.atan2(py - ay, px - ax) / (Math.PI / 4)) * (Math.PI / 4);
          px = ax + Math.cos(a) * len;
          py = ay + Math.sin(a) * len;
        }
        last = unplace(p0, end === 1 ? { x1: px, y1: py } : { x2: px, y2: py }, fr);
        onChange(sel.id, last, false);
      },
      () => onChange(sel.id, last, true),
    );
  };

  /** A press on empty space: draw a new layer, or clear the selection. */
  const startDraw = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !interactive) return;
    if (tool === 'select') {
      onSelect(null);
      onEditText(null);
      return;
    }
    const a = at(e);
    if (tool === 'text' || tool === 'step') {
      e.preventDefault();
      e.stopPropagation();
      onCreate(tool, { cx: a[0], cy: a[1] });
      return;
    }
    let d = { type: tool, a, b: a, pts: [a] as Pt[] };
    setDraft(d);
    drag(
      e,
      (ev) => {
        const b = at(ev);
        const pts = tool === 'pen' && Math.hypot(b[0] - (d.pts[d.pts.length - 1] as Pt)[0], b[1] - (d.pts[d.pts.length - 1] as Pt)[1]) * v.s >= 2 ? [...d.pts, b] : d.pts;
        d = { ...d, b, pts };
        setDraft(d);
      },
      () => {
        setDraft(null);
        const small = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * v.s < 6;
        const S = Math.min(fr.W, fr.H);
        if (tool === 'arrow' || tool === 'line') {
          const b = small ? ([d.a[0] + S * 0.2, d.a[1] - S * 0.1] as Pt) : d.b;
          onCreate(tool, { x1: d.a[0], y1: d.a[1], x2: b[0], y2: b[1] });
          return;
        }
        if (tool === 'pen') {
          if (d.pts.length < 2) return;
          const xs = d.pts.map((q) => q[0]);
          const ys = d.pts.map((q) => q[1]);
          const x0 = Math.min(...xs);
          const y0 = Math.min(...ys);
          const w = Math.max(2, Math.max(...xs) - x0);
          const h = Math.max(2, Math.max(...ys) - y0);
          onCreate('pen', { cx: x0 + w / 2, cy: y0 + h / 2, w, h, angle: 0, points: d.pts.map((q) => [(q[0] - x0) / w - 0.5, (q[1] - y0) / h - 0.5] as Pt) });
          return;
        }
        const w = small ? S * (tool === 'highlight' ? 0.3 : 0.25) : Math.abs(d.b[0] - d.a[0]);
        const h = small ? S * (tool === 'highlight' ? 0.06 : 0.16) : Math.abs(d.b[1] - d.a[1]);
        const cx = small ? d.a[0] : (d.a[0] + d.b[0]) / 2;
        const cy = small ? d.a[1] : (d.a[1] + d.b[1]) / 2;
        onCreate(tool, { cx, cy, w, h, angle: 0 });
      },
    );
  };

  const sx = (x: number): number => v.x + x * v.s;
  const sy = (y: number): number => v.y + y * v.s;

  // The draft while drawing.
  let draftEl: React.JSX.Element | null = null;
  if (draft !== null) {
    const [ax, ay] = draft.a;
    const [bx, by] = draft.b;
    const c = draft.type === 'redact' ? '#111111' : draft.type === 'highlight' ? '#ffd60a' : style.color;
    const sw = Math.max(1, style.width * v.s);
    if (draft.type === 'arrow' || draft.type === 'line') {
      draftEl = (
        <g>
          <line x1={sx(ax)} y1={sy(ay)} x2={sx(bx)} y2={sy(by)} stroke={c} strokeWidth={sw} strokeLinecap="round" />
          {draft.type === 'arrow' && <Arrowhead x1={sx(ax)} y1={sy(ay)} x2={sx(bx)} y2={sy(by)} w={sw} s={v.s} color={c} />}
        </g>
      );
    } else if (draft.type === 'pen') {
      draftEl = <polyline points={draft.pts.map((q) => sx(q[0]) + ',' + sy(q[1])).join(' ')} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
    } else {
      const x = sx(Math.min(ax, bx));
      const y = sy(Math.min(ay, by));
      const w = Math.abs(bx - ax) * v.s;
      const h = Math.abs(by - ay) * v.s;
      draftEl =
        draft.type === 'ellipse' ? (
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={c} strokeWidth={sw} />
        ) : (
          <rect x={x} y={y} width={w} height={h} fill={draft.type === 'highlight' ? c : draft.type === 'redact' ? 'rgba(17,17,17,0.6)' : 'none'} fillOpacity={draft.type === 'highlight' ? 0.4 : 1} stroke={draft.type === 'highlight' || draft.type === 'redact' ? 'none' : c} strokeWidth={sw} />
        );
    }
  }

  // The selection: a frame with handles (boxes, text, steps) or a handle at each end (arrows, lines).
  let selection: React.JSX.Element | null = null;
  if (sel !== null && selG !== null && sel.visible) {
    if (tiled) {
      selection = <rect className="iu-ants" x={v.x} y={v.y} width={fr.W * v.s} height={fr.H * v.s} fill="none" stroke="#111" strokeWidth={1.5} pointerEvents="none" />;
    } else if (selG.shape === 'line') {
      selection = (
        <g>
          {([1, 2] as const).map((end) => (
            <circle key={end} cx={sx(end === 1 ? selG.x1 : selG.x2)} cy={sy(end === 1 ? selG.y1 : selG.y2)} r={6} fill="#fff" stroke={ACCENT} strokeWidth={2} style={{ cursor: sel.locked ? 'default' : 'grab' }} onPointerDown={(e) => !sel.locked && startEnd(e, end)} />
          ))}
        </g>
      );
    } else {
      const w = selG.w * v.s;
      const h = selG.h * v.s;
      const corners = selG.shape === 'text' || selG.shape === 'step' || selType === 'logo';
      const T = `translate(${sx(selG.cx)} ${sy(selG.cy)}) rotate(${selG.angle})`;
      selection = (
        <g transform={T}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke={ACCENT} strokeWidth={1.5} pointerEvents="none" />
          {!sel.locked && selG.shape !== 'step' && (
            <g>
              <line x1={0} y1={-h / 2} x2={0} y2={-h / 2 - 22} stroke={ACCENT} strokeWidth={1.5} pointerEvents="none" />
              <circle cx={0} cy={-h / 2 - 26} r={6} fill="#fff" stroke={ACCENT} strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={startRotate}>
                <title>Rotate (Shift snaps to 15°)</title>
              </circle>
            </g>
          )}
          {!sel.locked &&
            // Middle handles only where the edge is long enough on screen to leave the layer visible.
            HANDLES.filter(([hx, hy]) => (hx !== 0 && hy !== 0) || (!corners && (hx === 0 ? w >= 64 : h >= 64))).map(([hx, hy]) => {
              const cursorAngle = (((Math.atan2(hy, hx) * 180) / Math.PI + selG.angle) % 180 + 180) % 180;
              const cursor = cursorAngle < 22.5 || cursorAngle >= 157.5 ? 'ew-resize' : cursorAngle < 67.5 ? 'nwse-resize' : cursorAngle < 112.5 ? 'ns-resize' : 'nesw-resize';
              return <rect key={hx + ':' + hy} x={(hx * w) / 2 - 5} y={(hy * h) / 2 - 5} width={10} height={10} rx={2} fill="#fff" stroke={ACCENT} strokeWidth={1.5} style={{ cursor }} onPointerDown={(e) => startResize(e, hx, hy)} />;
            })}
        </g>
      );
    }
  }

  // Inline text editing.
  const editing = editingText !== null ? (layers.find((l) => l.id === editingText) ?? null) : null;
  let editor: React.JSX.Element | null = null;
  if (editing !== null) {
    const g = place(editing.params, fr);
    const size = g.size * v.s;
    const f = FONT_CSS[str(editing.params, 'font', 'sans-bold')] ?? { family: 'sans-serif', weight: 600 };
    const b = textBlock(editing.params, size);
    editor = (
      <textarea
        autoFocus
        aria-label="Text"
        value={String(editing.params['text'] ?? '')}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(editing.id, { ...editing.params, text: e.target.value === '' ? ' ' : e.target.value }, false)}
        onBlur={() => {
          onChange(editing.id, editing.params, true);
          onEditText(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) (e.target as HTMLTextAreaElement).blur();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
        className="absolute resize-none overflow-hidden whitespace-pre border border-dashed border-[var(--iu-accent)] bg-transparent p-0 outline-none"
        style={{
          left: sx(g.cx),
          top: sy(g.cy),
          width: Math.max(40, b.w + size * 0.6),
          height: b.h + size * 0.3,
          transform: `translate(-50%, -50%) rotate(${g.angle}deg)`,
          fontFamily: f.family,
          fontWeight: f.weight,
          fontSize: size,
          lineHeight: 1.18,
          color: str(editing.params, 'color', ACCENT),
          textAlign: str(editing.params, 'align', 'left') as 'left' | 'center' | 'right',
          padding: b.pad,
        }}
      />
    );
  }

  const drawing = tool !== 'select';
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 size-full" style={{ cursor: drawing ? 'crosshair' : 'default' }} onPointerDown={startDraw}>
        <defs>
          <clipPath id="iu-frame-clip">
            <rect x={v.x} y={v.y} width={fr.W * v.s} height={fr.H * v.s} />
          </clipPath>
        </defs>
        <g clipPath="url(#iu-frame-clip)">
          {layers.map((l) =>
            l.visible ? (
              <g key={l.id} opacity={num(l.params, 'opacity', 1)}>
                <LayerShape l={l} v={v} fr={fr} img={img} logoUrl={l.params['type'] === 'logo' ? (logos[String(l.params['asset'] ?? '')] ?? null) : null} editing={editingText === l.id} />
              </g>
            ) : null,
          )}
        </g>
        {interactive &&
          !drawing &&
          layers.map((l) =>
            l.visible && l.params['tile'] !== true && (!l.locked || l.id === selected) ? (
              <g
                key={'hit-' + l.id}
                style={{ cursor: l.locked ? 'default' : 'move' }}
                onPointerDown={(e) => startMove(e, l)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (l.params['type'] === 'text' && !l.locked) onEditText(l.id);
                }}
              >
                <HitArea l={l} v={v} fr={fr} />
              </g>
            ) : null,
          )}
        {interactive && selection}
        {draftEl}
      </svg>
      {editor}
    </div>
  );
}

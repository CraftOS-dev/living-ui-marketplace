/**
 * Sketch mode: drawing on a plane directly in the view, as in desktop CAD.
 * The camera turns to face the plane, the model goes see-through, and the
 * tools draw where you click: lines (closing on the start point makes an
 * outline), rectangles, circles, slots, polygons and construction lines.
 * The pointer snaps to ends, centers and midpoints, lines up with other
 * points and with the horizontal and vertical, and steps on a grid that
 * follows the zoom (Alt turns snapping off). While drawing, typing a number
 * sets the size (Tab moves to the next one, Enter places it). A selected
 * item shows its dimensions on the canvas, which take a number or an
 * expression, and handles that reshape it; dragging the middle of an
 * outline's segment bends it into an arc. Undo inside the sketch is local;
 * Finish saves the sketch as one change.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Circle, Grid3x3, Hexagon, Magnet, MousePointer2, PenLine, RectangleEllipsis, RectangleHorizontal, Redo2, ScanEye, Slash, Trash2, Undo2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { evaluate, fromText, isPlain } from '../../lib/expr.ts';
import { iconByName } from '../../lib/icons.ts';
import { crossingItems, dimensionsOf, dist, dragHandle, handlesOf, hitItem, moveItem, nextId, num, outline, pt, r4, regions, rot, segmentsOf, snapPoints } from '../../lib/sketchGeom.ts';
import type { Dim, Env, Item, ItemType, P2, SnapPoint } from '../../lib/sketchGeom.ts';
import type { FieldDef, Json, Params, Schema } from '../../lib/types.ts';
import type { SketchOverlay, SketchPointer } from '../viewer/engine.ts';
import type { Frame, P3 } from '../viewer/overlays.ts';
import type { ViewerHandle } from '../viewer/Viewer.tsx';
import { Button } from '../ui.tsx';
import { FieldInput, FieldLabel, inlineField, isVisible, withDefaults } from './fields.tsx';
import type { FormContext } from './fields.tsx';

export type SketchTool = 'select' | 'line' | 'rectangle' | 'circle' | 'slot' | 'polygon' | 'construction';

export interface SketchTarget {
  /** The sketch feature being edited; null for a new sketch. */
  name: string | null;
  frame: Frame;
  /** Where it sits, as people read it ("XY plane", "End face of Extrude 1"). */
  where: string;
  /** Its params apart from the items (plane, face, offset). */
  params: Params;
  items: Item[];
}

export interface SketchSession {
  palette: ReactNode;
  toolbar: ReactNode;
  properties: ReactNode;
  labels: ReactNode;
  onPointer: (ev: SketchPointer) => void;
  onContext: () => void;
  cursor: string;
}

const TOOL_LIST: { tool: SketchTool; label: string; icon: LucideIcon; key: string | null }[] = [
  { tool: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
  { tool: 'line', label: 'Line', icon: PenLine, key: 'L' },
  { tool: 'rectangle', label: 'Rectangle', icon: RectangleHorizontal, key: 'R' },
  { tool: 'circle', label: 'Circle', icon: Circle, key: 'C' },
  { tool: 'slot', label: 'Slot', icon: RectangleEllipsis, key: null },
  { tool: 'polygon', label: 'Polygon', icon: Hexagon, key: 'P' },
  { tool: 'construction', label: 'Construction line', icon: Slash, key: 'X' },
];

interface Draft {
  tool: Exclude<SketchTool, 'select'>;
  pts: P2[];
  typed: Record<string, string>;
  focus: string | null;
}

type Drag = { kind: 'handle'; index: number; id: string; base: Item[] } | { kind: 'move'; start: P2; base: Item[]; moved: boolean } | null;

const FIELD_LABEL: Record<string, string> = { length: 'Length', angle: 'Angle', width: 'Width', height: 'Height', diameter: 'Diameter' };

function draftFields(d: Draft): string[] {
  if (d.pts.length === 0) return [];
  if (d.tool === 'line' || d.tool === 'construction') return ['length', 'angle'];
  if (d.tool === 'rectangle') return ['width', 'height'];
  if (d.tool === 'circle' || d.tool === 'polygon') return ['diameter'];
  return d.pts.length === 1 ? ['length', 'angle'] : ['width'];
}

/** 1, 2 or 5 times a power of ten, at least x. */
function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

/** A typed value: a number, or an expression kept as one. */
function typedValue(text: string | undefined, env: Env): { n: number; store: Json } | null {
  if (text === undefined || text.trim() === '') return null;
  try {
    const n = evaluate(text, env);
    return { n, store: isPlain(text) ? n : { expr: text.trim() } };
  } catch {
    return null;
  }
}

interface Computed {
  item: Item | null;
  /** The chain's next point (line tools) or the slot's second center. */
  end: P2 | null;
  values: Record<string, number>;
  /** Where each value box sits. */
  at: Record<string, P2>;
}

/** What the draft would place, from the clicks so far, the pointer and typed values. */
function compute(d: Draft, c: P2 | null, env: Env, items: Item[]): Computed {
  const out: Computed = { item: null, end: null, values: {}, at: {} };
  const t = (k: string): { n: number; store: Json } | null => typedValue(d.typed[k], env);
  const a = d.pts[0];
  if (a === undefined) return out;
  if (d.tool === 'line' || d.tool === 'construction' || (d.tool === 'slot' && d.pts.length === 1)) {
    const L = d.pts[d.pts.length - 1] as P2;
    if (c === null) return out;
    const len = t('length')?.n ?? dist(L, c);
    const ang = t('angle')?.n ?? (Math.atan2(c[1] - L[1], c[0] - L[0]) * 180) / Math.PI;
    const e: P2 = [r4(L[0] + len * Math.cos((ang * Math.PI) / 180)), r4(L[1] + len * Math.sin((ang * Math.PI) / 180))];
    out.end = e;
    out.values = { length: len, angle: ang };
    out.at = { length: [(L[0] + e[0]) / 2, (L[1] + e[1]) / 2], angle: L };
    if (d.tool === 'construction') out.item = { type: 'line', id: nextId(items, 'line'), from: L, to: e };
    return out;
  }
  if (d.tool === 'rectangle') {
    if (c === null) return out;
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const w = t('width')?.n ?? Math.abs(dx);
    const h = t('height')?.n ?? Math.abs(dy);
    const b: P2 = [a[0] + (dx < 0 ? -w : w), a[1] + (dy < 0 ? -h : h)];
    const center: P2 = [r4((a[0] + b[0]) / 2), r4((a[1] + b[1]) / 2)];
    out.values = { width: w, height: h };
    out.at = { width: [center[0], Math.min(a[1], b[1])], height: [Math.max(a[0], b[0]), center[1]] };
    out.item = { type: 'rectangle', id: nextId(items, 'rectangle'), width: t('width')?.store ?? r4(w), height: t('height')?.store ?? r4(h), center };
    return out;
  }
  if (d.tool === 'circle' || d.tool === 'polygon') {
    if (c === null) return out;
    const typed = t('diameter');
    const r = typed !== null ? typed.n / 2 : dist(a, c);
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    out.values = { diameter: r * 2 };
    out.at = { diameter: [a[0] + r * Math.cos(ang) * 0.5, a[1] + r * Math.sin(ang) * 0.5] };
    out.item =
      d.tool === 'circle'
        ? { type: 'circle', id: nextId(items, 'circle'), diameter: typed?.store ?? r4(r * 2), center: a }
        : { type: 'polygon', id: nextId(items, 'polygon'), sides: 6, diameter: typed?.store ?? r4(r * 2), center: a, angle_deg: r4((ang * 180) / Math.PI) };
    return out;
  }
  // Slot, second stage: the width from the pointer's distance to the center line.
  const b = d.pts[1] as P2;
  const L = dist(a, b);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  let w = t('width')?.n ?? null;
  if (w === null && c !== null) {
    const local = rot(c, a, -ang);
    w = Math.abs(local[1] - a[1]) * 2;
  }
  const width = Math.max(w ?? L / 3, 0.01);
  const center: P2 = [r4((a[0] + b[0]) / 2), r4((a[1] + b[1]) / 2)];
  out.values = { width };
  out.at = { width: rot([center[0] + L / 2 + width / 2, center[1]], center, ang) };
  out.item = { type: 'slot', id: nextId(items, 'slot'), length: r4(L), width: t('width')?.store ?? r4(width), center, angle_deg: r4((ang * 180) / Math.PI) };
  return out;
}

function sameP(a: P2, b: P2, tol: number): boolean {
  return dist(a, b) <= tol;
}

function world(f: Frame, p: P2): P3 {
  return [f.origin[0] + f.u[0] * p[0] + f.v[0] * p[1], f.origin[1] + f.u[1] * p[0] + f.v[1] * p[1], f.origin[2] + f.u[2] * p[0] + f.v[2] * p[1]];
}

export function useSketchSession({
  target,
  viewer,
  env,
  schema,
  onFinish,
  onCancel,
}: {
  target: SketchTarget | null;
  viewer: RefObject<ViewerHandle | null>;
  env: Env;
  schema: Schema | null;
  onFinish: (params: Params) => Promise<boolean>;
  onCancel: () => void;
}): SketchSession | null {
  const [items, setItemsState] = useState<Item[]>(target?.items ?? []);
  const [past, setPast] = useState<Item[][]>([]);
  const [future, setFuture] = useState<Item[][]>([]);
  const [tool, setTool] = useState<SketchTool>(target !== null && target.items.length === 0 ? 'rectangle' : 'select');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<P2 | null>(null);
  const [snap, setSnap] = useState<SnapPoint | null>(null);
  const [infer, setInfer] = useState<[P2, P2][]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [hover, setHover] = useState<{ item: number; handle: string | null } | null>(null);
  const [gridSnap, setGridSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const drag = useRef<Drag>(null);
  const lastDown = useRef<{ t: number; x: number; y: number; p: P2 | null }>({ t: 0, x: 0, y: 0, p: null });
  const key = target === null ? '' : (target.name ?? 'new') + '|' + target.where;

  // A new target starts a fresh session.
  useEffect(() => {
    setItemsState(target?.items ?? []);
    setPast([]);
    setFuture([]);
    setDraft(null);
    setSelected([]);
    setHover(null);
    setTool(target !== null && target.items.length === 0 ? 'rectangle' : 'select');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const commit = useCallback(
    (next: Item[], before: Item[] = items) => {
      setPast((p) => [...p.slice(-99), before]);
      setFuture([]);
      setItemsState(next);
    },
    [items],
  );
  const undo = (): void => {
    const prev = past[past.length - 1];
    if (prev === undefined) return;
    setFuture((f) => [items, ...f]);
    setPast((p) => p.slice(0, -1));
    setItemsState(prev);
    setSelected([]);
  };
  const redo = (): void => {
    const next = future[0];
    if (next === undefined) return;
    setPast((p) => [...p, items]);
    setFuture((f) => f.slice(1));
    setItemsState(next);
    setSelected([]);
  };

  const frame = target?.frame ?? null;

  /** World size of one screen pixel on the plane near a point. */
  const pixel = useCallback(
    (p: P2): number => {
      const v = viewer.current;
      if (v === null || frame === null) return 0.1;
      return v.pixelAt(world(frame, p));
    },
    [viewer, frame],
  );

  /** The pointer snapped to points, alignments and the grid. */
  const snapAt = useCallback(
    (raw: P2, anchor: P2 | null, alt: boolean, skip: number | null): { p: P2; snap: SnapPoint | null; infer: [P2, P2][] } => {
      if (alt) return { p: raw, snap: null, infer: [] };
      const px = pixel(raw);
      const tol = px * 9;
      const points = snapPoints(items, env, skip);
      if (draft !== null) for (const q of draft.pts) points.push({ p: q, kind: 'end' });
      let best: SnapPoint | null = null;
      let bestD = tol;
      for (const s of points) {
        const d = dist(s.p, raw);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best !== null) return { p: best.p, snap: best, infer: [] };
      let x: number | null = null;
      let y: number | null = null;
      const lines: [P2, P2][] = [];
      if (anchor !== null) {
        if (Math.abs(raw[1] - anchor[1]) < tol) y = anchor[1];
        if (Math.abs(raw[0] - anchor[0]) < tol) x = anchor[0];
      }
      let ax: SnapPoint | null = null;
      let ay: SnapPoint | null = null;
      for (const s of points) {
        if (x === null && Math.abs(s.p[0] - raw[0]) < tol && (ax === null || Math.abs(s.p[0] - raw[0]) < Math.abs(ax.p[0] - raw[0]))) ax = s;
        if (y === null && Math.abs(s.p[1] - raw[1]) < tol && (ay === null || Math.abs(s.p[1] - raw[1]) < Math.abs(ay.p[1] - raw[1]))) ay = s;
      }
      if (ax !== null) x = ax.p[0];
      if (ay !== null) y = ay.p[1];
      const step = niceStep(px * 14);
      const p: P2 = [x ?? (gridSnap ? Math.round(raw[0] / step) * step : raw[0]), y ?? (gridSnap ? Math.round(raw[1] / step) * step : raw[1])];
      const P: P2 = [r4(p[0]), r4(p[1])];
      if (anchor !== null && y === anchor[1]) lines.push([anchor, P]);
      if (anchor !== null && x === anchor[0]) lines.push([anchor, P]);
      if (ax !== null) lines.push([ax.p, P]);
      if (ay !== null) lines.push([ay.p, P]);
      return { p: P, snap: null, infer: lines };
    },
    [pixel, items, env, draft, gridSnap],
  );

  const anchorOf = (d: Draft | null): P2 | null => {
    if (d === null || d.pts.length === 0) return null;
    if (d.tool === 'line' || d.tool === 'construction' || (d.tool === 'slot' && d.pts.length === 1)) return d.pts[d.pts.length - 1] as P2;
    return d.pts[0] as P2;
  };

  const place = (item: Item): void => {
    const next = [...items, item];
    commit(next);
    setSelected([next.length - 1]);
  };

  /** End a line chain: an outline when it closes, construction lines when it stays open. */
  const endChain = (d: Draft): void => {
    if (d.pts.length >= 2) {
      const made: Item[] = [];
      const all = [...items];
      for (let i = 0; i < d.pts.length - 1; i++) {
        const line: Item = { type: 'line', id: nextId([...all, ...made], 'line'), from: d.pts[i] as P2, to: d.pts[i + 1] as P2 };
        made.push(line);
      }
      commit([...items, ...made]);
      setSelected(made.map((_, i) => items.length + i));
    }
    setDraft(null);
  };

  const advance = (d: Draft, p: P2, computed: Computed): void => {
    const tol = pixel(p) * 9;
    if (d.tool === 'line') {
      const end = d.pts.length > 0 ? (computed.end ?? p) : p;
      const start = d.pts[0];
      if (start !== undefined && d.pts.length >= 3 && sameP(end, start, tol)) {
        const pts = d.pts;
        const path: Item = { type: 'path', id: nextId(items, 'path'), start, segments: [...pts.slice(1).map((q) => ({ to: q })), { to: start }] };
        place(path);
        setDraft(null);
        return;
      }
      const last = d.pts[d.pts.length - 1];
      if (last !== undefined && sameP(end, last, tol)) {
        endChain(d);
        return;
      }
      setDraft({ ...d, pts: [...d.pts, end], typed: {}, focus: 'length' });
      return;
    }
    if (d.pts.length === 0) {
      setDraft({ ...d, pts: [p], typed: {}, focus: draftFields({ ...d, pts: [p] })[0] ?? null });
      return;
    }
    if (d.tool === 'slot' && d.pts.length === 1) {
      const b = computed.end ?? p;
      if (sameP(b, d.pts[0] as P2, tol)) return;
      setDraft({ ...d, pts: [d.pts[0] as P2, b], typed: {}, focus: 'width' });
      return;
    }
    if (computed.item !== null) {
      const o = outline(computed.item, env);
      if (computed.item['type'] !== 'line' && o === null) return;
      if (computed.item['type'] === 'line' && sameP(computed.item['from'] as P2, computed.item['to'] as P2, tol)) return;
      place(computed.item);
      setDraft(null);
    }
  };

  const onPointer = (ev: SketchPointer): void => {
    if (target === null) return;
    if (ev.type === 'leave') {
      setCursor(null);
      setSnap(null);
      setInfer([]);
      setHover(null);
      return;
    }
    const raw = ev.p;
    if (raw === null) return;
    const tol = pixel(raw) * 8;

    if (tool !== 'select') {
      const d = draft ?? { tool, pts: [], typed: {}, focus: null };
      const s = snapAt(raw, anchorOf(d), ev.alt, null);
      setCursor(s.p);
      setSnap(s.snap);
      setInfer(s.infer);
      if (ev.type === 'down' && ev.button === 0) {
        const now = performance.now();
        const ld = lastDown.current;
        const dbl = now - ld.t < 320 && Math.hypot(ev.screen.x - ld.x, ev.screen.y - ld.y) < 5;
        lastDown.current = { t: now, x: ev.screen.x, y: ev.screen.y, p: s.p };
        if (dbl && d.tool === 'line' && draft !== null) {
          endChain(draft);
          return;
        }
        advance(d, s.p, compute(d, s.p, env, items));
      } else if (ev.type === 'up' && draft !== null && draft.pts.length === 1 && (draft.tool === 'rectangle' || draft.tool === 'circle' || draft.tool === 'polygon')) {
        // Press, drag and release draws in one stroke.
        const ld = lastDown.current;
        if (Math.hypot(ev.screen.x - ld.x, ev.screen.y - ld.y) > 8) advance(draft, s.p, compute(draft, s.p, env, items));
      }
      return;
    }

    // The select tool: pick, move, reshape.
    const d = drag.current;
    if (ev.type === 'down' && ev.button === 0) {
      for (const i of selected) {
        const it = items[i];
        if (it === undefined) continue;
        const h = handlesOf(it, env).find((x) => dist(x.p, raw) < tol);
        if (h !== undefined) {
          drag.current = { kind: 'handle', index: i, id: h.id, base: items };
          return;
        }
      }
      const hit = hitItem(items, env, raw, tol);
      if (hit === null) {
        if (!ev.shift) setSelected([]);
        return;
      }
      if (ev.shift || ev.ctrl) setSelected((cur) => (cur.includes(hit) ? cur.filter((x) => x !== hit) : [...cur, hit]));
      else if (!selected.includes(hit)) setSelected([hit]);
      drag.current = { kind: 'move', start: raw, base: items, moved: false };
      return;
    }
    if (ev.type === 'move' && d !== null) {
      if (d.kind === 'handle') {
        const it = d.base[d.index];
        if (it === undefined) return;
        const s = snapAt(raw, null, ev.alt, d.index);
        setCursor(s.p);
        setSnap(s.snap);
        setInfer(s.infer);
        setItemsState(d.base.map((x, i) => (i === d.index ? dragHandle(it, env, d.id, s.p) : x)));
        return;
      }
      const step = ev.alt ? 0 : niceStep(pixel(raw) * 14);
      let dx = raw[0] - d.start[0];
      let dy = raw[1] - d.start[1];
      if (step > 0) {
        dx = Math.round(dx / step) * step;
        dy = Math.round(dy / step) * step;
      }
      if (!d.moved && Math.hypot(raw[0] - d.start[0], raw[1] - d.start[1]) < tol) return;
      d.moved = true;
      const moving = selected.length ? selected : [];
      setItemsState(d.base.map((x, i) => (moving.includes(i) ? moveItem(x, env, [dx, dy]) : x)));
      return;
    }
    if (ev.type === 'up' && d !== null) {
      drag.current = null;
      setSnap(null);
      setInfer([]);
      if (d.kind === 'handle' || d.moved) {
        setPast((p) => [...p.slice(-99), d.base]);
        setFuture([]);
      }
      return;
    }
    if (ev.type === 'move') {
      for (const i of selected) {
        const it = items[i];
        if (it === undefined) continue;
        const h = handlesOf(it, env).find((x) => dist(x.p, raw) < tol);
        if (h !== undefined) {
          setHover({ item: i, handle: h.id });
          return;
        }
      }
      const hit = hitItem(items, env, raw, tol);
      setHover(hit === null ? null : { item: hit, handle: null });
    }
  };

  const onContext = (): void => {
    if (draft !== null && draft.tool === 'line') endChain(draft);
    else if (draft !== null) setDraft(null);
    else setTool('select');
  };

  const pickTool = (t: SketchTool): void => {
    setDraft(null);
    setTool(t);
    setHover(null);
  };

  const deleteSelected = (): void => {
    if (selected.length === 0) return;
    commit(items.filter((_, i) => !selected.includes(i)));
    setSelected([]);
  };

  const finish = async (): Promise<void> => {
    if (target === null || saving) return;
    setSaving(true);
    try {
      await onFinish({ ...target.params, items });
    } finally {
      setSaving(false);
    }
  };

  // Keys: tools, typed sizes while drawing, delete, local undo, finish.
  useEffect(() => {
    if (target === null) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === 'Enter') {
        e.preventDefault();
        void finish();
        return;
      }
      if (draft !== null && draft.pts.length > 0) {
        const fields = draftFields(draft);
        const focus = draft.focus ?? fields[0] ?? null;
        const cur = focus === null ? '' : (draft.typed[focus] ?? '');
        if (focus !== null && (/^[0-9.]$/.test(k) || ((k === '-' || k === '(') && cur === '') || (cur !== '' && k.length === 1 && /[\w+\-*/^(). ]/.test(k)))) {
          e.preventDefault();
          setDraft({ ...draft, focus, typed: { ...draft.typed, [focus]: cur + k } });
          return;
        }
        if (k === 'Backspace' && focus !== null && cur !== '') {
          e.preventDefault();
          setDraft({ ...draft, focus, typed: { ...draft.typed, [focus]: cur.slice(0, -1) } });
          return;
        }
        if (k === 'Tab' && fields.length > 1) {
          e.preventDefault();
          const i = focus === null ? -1 : fields.indexOf(focus);
          setDraft({ ...draft, focus: fields[(i + (e.shiftKey ? fields.length - 1 : 1)) % fields.length] ?? null });
          return;
        }
        if (k === 'Enter') {
          e.preventDefault();
          const c = cursor ?? (draft.pts[draft.pts.length - 1] as P2);
          advance(draft, c, compute(draft, c, env, items));
          return;
        }
      }
      if (k === 'Enter' && draft !== null && draft.tool === 'line') {
        e.preventDefault();
        endChain(draft);
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        if (draft !== null) setDraft(null);
        else if (selected.length) setSelected([]);
        else setTool('select');
        return;
      }
      if ((k === 'Delete' || k === 'Backspace') && draft === null) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (mod || e.altKey) return;
      const pick = TOOL_LIST.find((x) => x.key !== null && x.key.toLowerCase() === k.toLowerCase());
      if (pick !== undefined) {
        e.preventDefault();
        pickTool(pick.tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ----------------------------------------------------- what is drawn */

  const computed = useMemo(() => (draft === null || tool === 'select' ? null : compute(draft, cursor, env, items)), [draft, tool, cursor, env, items]);

  const overlay = useMemo((): SketchOverlay | null => {
    if (target === null) return null;
    const segs: SketchOverlay['segs'] = [];
    items.forEach((it, i) => {
      const role = selected.includes(i) ? 'selected' : hover?.item === i && hover.handle === null ? 'hover' : it['type'] === 'line' ? 'construction' : 'curve';
      for (const [a, b] of segmentsOf(it, env)) segs.push({ a, b, role });
    });
    if (draft !== null && tool !== 'select') {
      if (draft.tool === 'line') {
        for (let i = 0; i < draft.pts.length - 1; i++) segs.push({ a: draft.pts[i] as P2, b: draft.pts[i + 1] as P2, role: 'preview' });
        const last = draft.pts[draft.pts.length - 1];
        if (last !== undefined && computed?.end !== null && computed?.end !== undefined) segs.push({ a: last, b: computed.end, role: 'preview' });
      } else if (draft.tool === 'slot' && draft.pts.length === 1) {
        const a = draft.pts[0] as P2;
        if (computed?.end !== null && computed?.end !== undefined) segs.push({ a, b: computed.end, role: 'preview' });
      }
      if (computed?.item !== null && computed?.item !== undefined) for (const [a, b] of segmentsOf(computed.item, env)) segs.push({ a, b, role: 'preview' });
    }
    for (const [a, b] of infer) segs.push({ a, b, role: 'inference' });
    const points: SketchOverlay['points'] = [{ p: [0, 0], role: 'origin' }];
    for (const s of snapPoints(items, env)) if (s.kind === 'end' || s.kind === 'center') points.push({ p: s.p, role: 'vertex' });
    if (draft !== null) for (const q of draft.pts) points.push({ p: q, role: 'vertex' });
    for (const i of selected) {
      const it = items[i];
      if (it !== undefined) for (const h of handlesOf(it, env)) points.push({ p: h.p, role: 'handle' });
    }
    if (snap !== null) points.push({ p: snap.p, role: 'snap' });
    else if (cursor !== null && tool !== 'select') points.push({ p: cursor, role: 'snap' });
    const fills = regions(
      items.filter((it) => it['type'] !== 'line'),
      env,
    );
    return { segs, points, fills };
  }, [target, items, env, selected, hover, draft, tool, computed, infer, snap, cursor]);

  useEffect(() => {
    viewer.current?.setSketchOverlay(overlay);
  }, [viewer, overlay]);
  useEffect(() => () => viewer.current?.setSketchOverlay(null), [viewer]);

  /* --------------------------------------------------------- the labels */

  const [editing, setEditing] = useState<{ item: number; dim: string } | null>(null);
  const dims: { item: number; d: Dim }[] = [];
  selected.forEach((i) => {
    const it = items[i];
    if (it !== undefined && selected.length <= 3) for (const d of dimensionsOf(it, env, true)) dims.push({ item: i, d });
  });
  const labelList: PlaneLabel[] = dims.map(({ item, d }) => ({
    id: 'dim:' + item + ':' + d.id,
    p: d.at,
    node: (
      <DimLabel
        dim={d}
        env={env}
        interactive={tool === 'select'}
        editing={editing?.item === item && editing.dim === d.id}
        onEdit={() => setEditing({ item, dim: d.id })}
        onDone={(v) => {
          setEditing(null);
          if (v === null) return;
          const it = items[item];
          if (it === undefined) return;
          commit(items.map((x, i) => (i === item ? d.set(v) : x)));
        }}
      />
    ),
  }));
  if (draft !== null && computed !== null && tool !== 'select') {
    const fields = draftFields(draft);
    for (const f of fields) {
      const at = computed.at[f];
      const v = computed.values[f];
      if (at === undefined || v === undefined) continue;
      const typed = draft.typed[f];
      const focus = (draft.focus ?? fields[0]) === f;
      labelList.push({
        id: 'draft:' + f,
        p: at,
        node: (
          <span className={cn('num pointer-events-none inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[var(--cw-r-sm)] border px-1 text-[12px] shadow-[var(--cw-shadow-sm)]', focus ? 'border-[var(--cw-accent-text)] bg-[var(--cw-card)] text-[var(--cw-ink)]' : 'border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink-2)]')}>
            <span className="text-[var(--cw-muted)]">{FIELD_LABEL[f] ?? f}</span>
            {typed !== undefined && typed !== '' ? <span className="font-semibold text-[var(--cw-ink)]">{typed}</span> : <span>{f === 'angle' ? r4(v).toFixed(1) + '°' : r4(v).toFixed(2)}</span>}
          </span>
        ),
      });
    }
  }

  if (target === null || frame === null || schema === null) return null;

  /* ------------------------------------------------------ the panels */

  const crossing = crossingItems(
    items.filter((it) => it['type'] !== 'line'),
    env,
  );
  const profiles = regions(
    items.filter((it) => it['type'] !== 'line'),
    env,
  ).length;

  const palette = (
    <section aria-label="Sketch" className="pointer-events-auto flex w-[min(260px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] shadow-[var(--cw-shadow)]">
      <header className="flex h-8 items-center gap-1.5 border-b border-[var(--cw-hair)] px-2">
        <PenLine size={14} aria-hidden className="text-[var(--cw-ink-2)]" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold">{target.name === null ? 'New sketch' : 'Edit sketch'}</h2>
        <button type="button" title="Look at the sketch" aria-label="Look at the sketch" onClick={() => viewer.current?.lookAlong(frame.normal, frame.v, world(frame, [0, 0]))} className="flex size-6 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]">
          <ScanEye size={14} aria-hidden />
        </button>
        <button
          type="button"
          title={gridSnap ? 'Snapping to the grid (click to turn off; Alt while drawing)' : 'Not snapping to the grid'}
          aria-label="Snap to grid"
          aria-pressed={gridSnap}
          onClick={() => setGridSnap((g) => !g)}
          className={cn('flex size-6 items-center justify-center rounded-[var(--cw-r-sm)]', gridSnap ? 'cw-on-ink bg-[var(--cw-ink)] text-[var(--cw-shell)]' : 'text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)]')}
        >
          <Magnet size={13} aria-hidden />
        </button>
      </header>
      <div className="flex flex-col gap-0.5 px-2 py-1.5 text-[12px]">
        <p className="truncate text-[var(--cw-ink-2)]" title={target.where}>
          On {target.where}
        </p>
        <p className="num text-[var(--cw-muted)]">
          {profiles} {profiles === 1 ? 'profile' : 'profiles'} · {items.length} {items.length === 1 ? 'item' : 'items'}
        </p>
        {crossing !== null && <p className="text-[var(--cw-amber-text)]">{crossing[0] + ' and ' + crossing[1] + ' cross; profiles must not overlap.'}</p>}
      </div>
      <footer className="flex items-center justify-end gap-1 border-t border-[var(--cw-hair)] px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={Check} loading={saving} disabled={items.length === 0 || saving} onClick={() => void finish()}>
          Finish sketch
        </Button>
      </footer>
    </section>
  );

  const toolbar = (
    <div className="flex min-w-0 items-center gap-0.5">
      {TOOL_LIST.map((t) => (
        <RibbonButton key={t.tool} icon={t.icon} label={t.label} shortcut={t.key} on={tool === t.tool} onClick={() => pickTool(t.tool)} />
      ))}
      <span className="mx-1 h-6 w-px bg-[var(--cw-line)]" />
      <RibbonButton icon={Undo2} label="Undo" shortcut="Ctrl Z" disabled={past.length === 0} onClick={undo} compact />
      <RibbonButton icon={Redo2} label="Redo" shortcut="Ctrl Y" disabled={future.length === 0} onClick={redo} compact />
      <RibbonButton icon={Trash2} label="Delete" shortcut="Del" disabled={selected.length === 0} onClick={deleteSelected} compact />
      <span className="ml-auto" />
      <RibbonButton icon={X} label="Cancel" shortcut={null} onClick={onCancel} compact />
      <RibbonButton icon={Check} label="Finish sketch" shortcut="Ctrl Enter" accent disabled={items.length === 0} onClick={() => void finish()} />
    </div>
  );

  const one = selected.length === 1 ? items[selected[0] as number] : undefined;
  const properties = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--cw-line)] px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold">{one !== undefined ? (schema.item_types[String(one['type'])]?.label ?? 'Item') + ' ' + String(one['id'] ?? '') : selected.length > 1 ? selected.length + ' items' : 'Sketch'}</h2>
        {selected.length > 0 && (
          <button type="button" aria-label="Delete" title="Delete (Del)" onClick={deleteSelected} className="flex size-6 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-red)]/10 hover:text-[var(--cw-red-text)]">
            <Trash2 size={13} aria-hidden />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {one !== undefined ? (
          <ItemProperties item={one} schema={schema} env={env} onChange={(next) => commit(items.map((x, i) => (i === selected[0] ? next : x)))} />
        ) : (
          <ItemList items={items} env={env} schema={schema} selected={selected} hover={hover?.item ?? null} onSelect={(i, add) => setSelected((cur) => (add ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i]))} onHover={(i) => setHover(i === null ? null : { item: i, handle: null })} />
        )}
      </div>
    </div>
  );

  const labels = <PlaneLabels viewer={viewer} frame={frame} labels={labelList} />;

  const cursorCss = tool !== 'select' ? 'crosshair' : hover !== null ? (hover.handle !== null ? 'grab' : 'pointer') : 'default';
  return { palette, toolbar, properties, labels, onPointer, onContext, cursor: cursorCss };
}

/* --------------------------------------------------------------- pieces */

export function RibbonButton({ icon: Icon, label, shortcut, on = false, disabled = false, accent = false, compact = false, onClick }: { icon: LucideIcon; label: string; shortcut: string | null; on?: boolean; disabled?: boolean; accent?: boolean; compact?: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      title={label + (shortcut !== null ? ' (' + shortcut + ')' : '')}
      onClick={onClick}
      className={cn(
        'flex h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--cw-r-sm)] text-[12px] leading-none transition-colors disabled:cursor-default disabled:opacity-40',
        compact ? 'w-9' : 'min-w-[52px] px-1.5',
        on ? 'cw-on-ink bg-[var(--cw-ink)] text-[var(--cw-shell)]' : accent ? 'text-[var(--cw-green-text)] hover:bg-[var(--cw-green)]/10' : 'text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]',
      )}
    >
      <Icon size={17} aria-hidden strokeWidth={1.75} />
      {!compact && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

function DimLabel({ dim, env, interactive, editing, onEdit, onDone }: { dim: Dim; env: Env; interactive: boolean; editing: boolean; onEdit: () => void; onDone: (v: Json | null) => void }): React.JSX.Element {
  const [text, setText] = useState(dim.expr ?? String(r4(dim.value)));
  useEffect(() => {
    if (editing) setText(dim.expr ?? String(r4(dim.value)));
  }, [editing, dim.expr, dim.value]);
  const shown = dim.unit === 'deg' ? r4(dim.value) + '°' : dim.unit === '' ? String(Math.round(dim.value)) : String(r4(dim.value));
  if (editing) {
    let bad = false;
    try {
      evaluate(text, env);
    } catch {
      bad = true;
    }
    return (
      <input
        autoFocus
        aria-label={dim.name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => onDone(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !bad) onDone(fromText(text) as Json);
          if (e.key === 'Escape') onDone(null);
        }}
        className={cn('num pointer-events-auto h-6 w-20 rounded-[var(--cw-r-sm)] border bg-[var(--cw-card)] px-1 text-center text-[12px] text-[var(--cw-ink)] shadow-[var(--cw-shadow)] outline-none', bad ? 'border-[var(--cw-red)]' : 'border-[var(--cw-accent-text)]')}
        spellCheck={false}
      />
    );
  }
  if (!interactive)
    return (
      <span className="num inline-flex h-5 items-center whitespace-nowrap rounded-[var(--cw-r-sm)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-1 text-[12px] font-semibold text-[var(--cw-ink-2)] shadow-[var(--cw-shadow-sm)]">
        {dim.expr !== null ? <span className="mr-1 font-normal text-[var(--cw-muted)]">{dim.expr} =</span> : null}
        {shown}
      </span>
    );
  return (
    <button
      type="button"
      title={dim.name + (dim.expr !== null ? ' = ' + dim.expr : '') + ' (click to change)'}
      onClick={onEdit}
      className="num pointer-events-auto inline-flex h-5 items-center whitespace-nowrap rounded-[var(--cw-r-sm)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-1 text-[12px] font-semibold text-[var(--cw-ink)] shadow-[var(--cw-shadow-sm)] hover:border-[var(--cw-ink)]"
    >
      {dim.expr !== null ? <span className="mr-1 font-normal text-[var(--cw-muted)]">{dim.expr} =</span> : null}
      {shown}
    </button>
  );
}

export interface PlaneLabel {
  id: string;
  p: P2;
  node: ReactNode;
}

/** HTML labels pinned to points on the sketch plane; they follow the camera every frame. */
export function PlaneLabels({ viewer, frame, labels }: { viewer: RefObject<ViewerHandle | null>; frame: Frame; labels: PlaneLabel[] }): React.JSX.Element {
  const els = useRef(new Map<string, HTMLDivElement>());
  const list = useRef(labels);
  list.current = labels;
  const place = useCallback((): void => {
    const v = viewer.current;
    if (v === null) return;
    for (const l of list.current) {
      const el = els.current.get(l.id);
      if (el === undefined) continue;
      const s = v.project(world(frame, l.p));
      if (s === null) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
    }
  }, [viewer, frame]);
  useLayoutEffect(place);
  useEffect(() => viewer.current?.onRender(place), [viewer, place]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {labels.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el === null) els.current.delete(l.id);
            else els.current.set(l.id, el);
          }}
          className="absolute left-0 top-0"
          style={{ display: 'none' }}
        >
          {l.node}
        </div>
      ))}
    </div>
  );
}

function itemSummary(it: Item, env: Env): string {
  const t = it['type'];
  const f = (x: number): string => String(r4(x));
  if (t === 'rectangle') return f(num(it['width'], env, 0)) + ' × ' + f(num(it['height'], env, 0));
  if (t === 'circle') return 'Ø' + f(num(it['diameter'], env, 0));
  if (t === 'slot') return f(num(it['length'], env, 0)) + ' × ' + f(num(it['width'], env, 0));
  if (t === 'polygon') return Math.round(num(it['sides'], env, 6)) + ' sides';
  if (t === 'line') return f(dist(pt(it['from'], env, [0, 0]), pt(it['to'], env, [0, 0])));
  if (t === 'path') return (Array.isArray(it['segments']) ? it['segments'].length : 0) + ' segments';
  return '';
}

function ItemList({ items, env, schema, selected, hover, onSelect, onHover }: { items: Item[]; env: Env; schema: Schema; selected: number[]; hover: number | null; onSelect: (i: number, add: boolean) => void; onHover: (i: number | null) => void }): React.JSX.Element {
  if (items.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[var(--cw-muted)]">
        <Grid3x3 size={20} aria-hidden />
        <p className="text-[12px]">Nothing drawn yet</p>
      </div>
    );
  return (
    <ul className="py-1">
      {items.map((it, i) => {
        const def = schema.item_types[String(it['type'])];
        const Icon = iconByName(def?.icon ?? 'Square');
        return (
          <li key={String(it['id'] ?? i)}>
            <button
              type="button"
              onClick={(e) => onSelect(i, e.shiftKey || e.ctrlKey || e.metaKey)}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              className={cn('flex h-7 w-full items-center gap-2 px-3 text-left text-[13px]', selected.includes(i) ? 'bg-[var(--cw-row)] font-semibold' : hover === i ? 'bg-[var(--cw-row)]/60' : 'hover:bg-[var(--cw-row)]/60')}
            >
              <Icon size={14} aria-hidden className="shrink-0 text-[var(--cw-ink-2)]" />
              <span className="min-w-0 flex-1 truncate">
                {def?.label ?? String(it['type'])} <span className="text-[var(--cw-muted)]">{String(it['id'] ?? '')}</span>
              </span>
              <span className="num shrink-0 text-[12px] text-[var(--cw-muted)]">{itemSummary(it, env)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ItemProperties({ item, schema, env, onChange }: { item: Item; schema: Schema; env: Env; onChange: (next: Item) => void }): React.JSX.Element {
  const def = schema.item_types[String(item['type'])];
  const ctx: FormContext = { kind: 'sketch', before: [], env, paramNames: Object.keys(env), bodies: [], assets: [], topo: null, activePick: null, onActivatePick: () => undefined };
  const fields = (def?.fields ?? []).filter((f: FieldDef) => f.type !== 'list' && f.key !== 'corner' && isVisible(f, withDefaults(def?.fields ?? [], item)));
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      {fields.map((f) => (
        <FieldLabel key={f.key} def={f} inline={inlineField(f)}>
          <FieldInput
            def={f}
            ctx={ctx}
            siblings={item}
            path={f.key}
            value={item[f.key]}
            onChange={(v) => {
              const next: Item = { ...item };
              if (v === undefined) delete next[f.key];
              else next[f.key] = v;
              if (f.key === 'center') delete next['corner'];
              if (f.key === 'across_flats') delete next['diameter'];
              if (f.key === 'diameter' && item['type'] === 'polygon') delete next['across_flats'];
              onChange(next);
            }}
          />
        </FieldLabel>
      ))}
      {item['type'] === 'path' && (
        <p className="num text-[12px] text-[var(--cw-muted)]">
          {(Array.isArray(item['segments']) ? item['segments'].length : 0) + ' segments, from ' + pt(item['start'], env, [0, 0]).map((x) => r4(x)).join(', ')}
        </p>
      )}
    </div>
  );
}

export type { ItemType };

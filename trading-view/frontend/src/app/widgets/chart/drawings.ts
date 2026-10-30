/**
 * The drawing layer: renders every drawing of the symbol in time/price
 * coordinates (so drawings stay put across intervals) and answers hit tests
 * for selecting, hovering and dragging. The AI agent's drawings are its
 * markup: accent colored and dashed until the person keeps them.
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, PrimitivePaneViewZOrder, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { alpha, chartColors, namedColor } from '../../lib/themeColors.ts';
import { price as fmtPrice, pct } from '../../lib/format.ts';
import type { Drawing, Point, Tool } from '../../lib/types.ts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;

export interface Geo {
  timeToX: (t: number) => number | null;
  xToTime: (x: number) => number | null;
  priceToY: (p: number) => number | null;
  yToPrice: (y: number) => number | null;
  hint: () => number;
  /** Bars between two times (for measure and position labels). */
  barsBetween: (a: number, b: number) => number;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const POINTS: Record<Tool, number> = { trend: 2, ray: 2, extended: 2, rect: 2, fib: 2, measure: 2, channel: 3, hline: 1, hray: 1, text: 1, arrow_up: 1, arrow_down: 1, vline: 1, long: 3, short: 3 };

export interface Hit {
  id: string;
  /** Index of the point grabbed, or -1 for the body. */
  handle: number;
}

interface XY {
  x: number;
  y: number;
}

function dist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The segment from a through b extended to the chart's edges (left, right or both). */
function extend(a: XY, b: XY, w: number, left: boolean, right: boolean): [XY, XY] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) return [a, b];
  const k = dy / dx;
  let s = a;
  let e = b;
  const goRight = dx > 0;
  if (right) e = goRight ? { x: w, y: a.y + k * (w - a.x) } : { x: 0, y: a.y - k * a.x };
  if (left) s = goRight ? { x: 0, y: a.y - k * a.x } : { x: w, y: a.y + k * (w - a.x) };
  return [s, e];
}

class View implements IPrimitivePaneView {
  constructor(
    private readonly fn: (t: Target) => void,
    private readonly z: PrimitivePaneViewZOrder,
  ) {}
  zOrder(): PrimitivePaneViewZOrder {
    return this.z;
  }
  renderer(): IPrimitivePaneRenderer {
    return { draw: (t) => this.fn(t) };
  }
}

export class DrawingLayer implements ISeriesPrimitive<Time> {
  private p: SeriesAttachedParameter<Time> | null = null;
  private geo: Geo | null = null;
  items: Drawing[] = [];
  /** A drawing being placed or dragged (drawn instead of its saved version). */
  draft: Drawing | null = null;
  selected = '';
  hover = '';
  showAgent = true;
  private w = 0;
  private h = 0;
  private readonly views = [new View((t) => this.draw(t), 'top')];

  setGeo(geo: Geo): void {
    this.geo = geo;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.p = param;
  }

  detached(): void {
    this.p = null;
  }

  update(): void {
    this.p?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private visible(): Drawing[] {
    const out: Drawing[] = [];
    for (const d of this.items) {
      if (d.hidden) continue;
      if (d.added_by === 'agent' && !this.showAgent) continue;
      if (this.draft !== null && d.id === this.draft.id) continue;
      out.push(d);
    }
    if (this.draft !== null) out.push(this.draft);
    return out;
  }

  private pts(d: Drawing): (XY | null)[] {
    const g = this.geo;
    if (g === null) return [];
    return d.points.map((q) => {
      const x = q.t === null ? null : g.timeToX(q.t);
      const y = q.p === null ? null : g.priceToY(q.p);
      if (d.tool === 'hline' && y !== null) return { x: 0, y };
      if (d.tool === 'vline' && x !== null) return { x, y: 0 };
      if ((d.tool === 'long' || d.tool === 'short') && q.t === null && y !== null) return { x: 0, y };
      return x === null || y === null ? null : { x, y };
    });
  }

  /* ---------------------------------------------------------- hit testing */

  hit(x: number, y: number): Hit | null {
    const m: XY = { x, y };
    const list = this.visible().slice().reverse();
    // Handles of the selected drawing win.
    for (const d of list) {
      if (d.id !== this.selected || d.locked) continue;
      const pts = this.pts(d);
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (q === null || q === undefined) continue;
        const hx = d.tool === 'hline' ? this.w - 40 : q.x;
        const hy = d.tool === 'vline' ? 30 : q.y;
        const handleX = (d.tool === 'long' || d.tool === 'short') && i === 2 ? (pts[0]?.x ?? hx) : hx;
        if (Math.hypot(x - handleX, y - hy) <= 7) return { id: d.id, handle: i };
      }
    }
    for (const d of list) {
      if (this.near(d, m)) return { id: d.id, handle: -1 };
    }
    return null;
  }

  private near(d: Drawing, m: XY): boolean {
    const pts = this.pts(d);
    const a = pts[0] ?? null;
    const b = pts[1] ?? null;
    const tol = 6;
    switch (d.tool) {
      case 'hline':
        return a !== null && Math.abs(m.y - a.y) <= tol;
      case 'hray':
        return a !== null && Math.abs(m.y - a.y) <= tol && m.x >= a.x - tol;
      case 'vline':
        return a !== null && Math.abs(m.x - a.x) <= tol;
      case 'trend':
      case 'ray':
      case 'extended': {
        if (a === null || b === null) return false;
        const [s, e] = extend(a, b, this.w, d.tool === 'extended' || d.style.extend_left === true, d.tool !== 'trend' || d.style.extend_right === true);
        return dist(m, s, e) <= tol;
      }
      case 'rect':
      case 'measure':
      case 'fib': {
        if (a === null || b === null) return false;
        const x1 = Math.min(a.x, b.x) - tol;
        const x2 = d.tool === 'fib' ? Math.max(a.x, b.x, this.w) : Math.max(a.x, b.x) + tol;
        return m.x >= x1 && m.x <= x2 && m.y >= Math.min(a.y, b.y) - tol && m.y <= Math.max(a.y, b.y) + tol;
      }
      case 'channel': {
        const c = pts[2] ?? null;
        if (a === null || b === null) return false;
        if (dist(m, a, b) <= tol) return true;
        if (c === null) return false;
        const off = this.channelOffset(a, b, c);
        return dist(m, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }) <= tol || (m.x >= Math.min(a.x, b.x) && m.x <= Math.max(a.x, b.x) && between(m.y, lineY(a, b, m.x), lineY(a, b, m.x) + off));
      }
      case 'long':
      case 'short': {
        const c = pts[2] ?? null;
        if (a === null || b === null) return false;
        const lo = Math.min(a.y, b.y, c?.y ?? a.y);
        const hi = Math.max(a.y, b.y, c?.y ?? a.y);
        return m.x >= Math.min(a.x, b.x) - tol && m.x <= Math.max(a.x, b.x) + tol && m.y >= lo - tol && m.y <= hi + tol;
      }
      case 'text':
      case 'arrow_up':
      case 'arrow_down': {
        if (a === null) return false;
        const wText = d.tool === 'text' ? Math.max(30, d.text.length * 7) : 14;
        return m.x >= a.x - 8 && m.x <= a.x + wText && m.y >= a.y - 16 && m.y <= a.y + 16;
      }
      default:
        return false;
    }
  }

  private channelOffset(a: XY, b: XY, c: XY): number {
    return c.y - lineY(a, b, c.x);
  }

  /* ------------------------------------------------------------- drawing */

  private draw(target: Target): void {
    if (this.geo === null) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.w = mediaSize.width;
      this.h = mediaSize.height;
      for (const d of this.visible()) {
        ctx.save();
        try {
          this.one(ctx, d);
        } finally {
          ctx.restore();
        }
      }
    });
  }

  private one(ctx: Ctx, d: Drawing): void {
    const c = chartColors();
    const agent = d.added_by === 'agent';
    const color = agent && (d.style.color === undefined || d.style.color === 'accent') ? c.accent : namedColor(d.style.color ?? 'ink');
    const hot = d.id === this.selected || d.id === this.hover;
    const width = (d.style.width ?? (d.tool === 'hline' || d.tool === 'hray' ? 1 : 1.5)) + (hot ? 0.5 : 0);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(d.style.dash === true || (agent && d.style.dash !== false) ? [5, 4] : []);
    ctx.font = '600 11px Manrope Variable, Manrope, system-ui, sans-serif';
    const pts = this.pts(d);
    const a = pts[0] ?? null;
    const b = pts[1] ?? null;
    const hint = this.geo?.hint() ?? 2;
    const w = this.w;
    switch (d.tool) {
      case 'trend':
      case 'ray':
      case 'extended': {
        if (a === null || b === null) break;
        const [s, e] = extend(a, b, w, d.tool === 'extended' || d.style.extend_left === true, d.tool !== 'trend' || d.style.extend_right === true);
        line(ctx, s, e);
        if (d.text !== '') label(ctx, d.text, (a.x + b.x) / 2, (a.y + b.y) / 2 - 8, color, 'center');
        break;
      }
      case 'hline':
      case 'hray': {
        if (a === null) break;
        const x0 = d.tool === 'hline' ? 0 : a.x;
        line(ctx, { x: x0, y: a.y }, { x: w, y: a.y });
        const p0 = d.points[0]?.p ?? null;
        const txt = (agent ? 'AI · ' : '') + (d.text !== '' ? d.text + '  ' : '') + (p0 !== null ? fmtPrice(p0, hint) : '');
        // Left end: the right edge belongs to the price axis labels.
        label(ctx, txt, x0 + 8, a.y - 5, color, 'left');
        break;
      }
      case 'vline': {
        if (a === null) break;
        line(ctx, { x: a.x, y: 0 }, { x: a.x, y: this.h });
        if (d.text !== '') label(ctx, d.text, a.x + 5, 14, color, 'left');
        break;
      }
      case 'rect': {
        if (a === null || b === null) break;
        ctx.fillStyle = alpha(color, d.style.fill === false ? 0 : 0.1);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (d.text !== '') label(ctx, d.text, Math.min(a.x, b.x) + 5, Math.min(a.y, b.y) - 5, color, 'left');
        break;
      }
      case 'channel': {
        const cc = pts[2] ?? null;
        if (a === null || b === null) break;
        line(ctx, a, b);
        if (cc !== null) {
          const off = this.channelOffset(a, b, cc);
          const a2 = { x: a.x, y: a.y + off };
          const b2 = { x: b.x, y: b.y + off };
          line(ctx, a2, b2);
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          line(ctx, { x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 });
          ctx.fillStyle = alpha(color, 0.08);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'fib': {
        const p0 = d.points[0]?.p ?? null;
        const p1 = d.points[1]?.p ?? null;
        if (a === null || b === null || p0 === null || p1 === null || this.geo === null) break;
        const levels = d.style.levels ?? FIB_LEVELS;
        const x1 = Math.min(a.x, b.x);
        const x2 = d.style.extend_right === false ? Math.max(a.x, b.x) : w;
        ctx.setLineDash(agent ? [5, 4] : []);
        ctx.lineWidth = 1;
        let prevY: number | null = null;
        for (const lv of levels) {
          const pr = p1 - (p1 - p0) * lv;
          const y = this.geo.priceToY(pr);
          if (y === null) continue;
          if (prevY !== null) {
            ctx.fillStyle = alpha(color, lv === 0.5 || lv === 0.618 ? 0.1 : 0.05);
            ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY));
          }
          ctx.strokeStyle = alpha(color, lv === 0 || lv === 1 ? 0.95 : 0.7);
          line(ctx, { x: x1, y }, { x: x2, y });
          label(ctx, `${lv} (${fmtPrice(pr, hint)})`, x1 + 4, y - 4, color, 'left');
          prevY = y;
        }
        ctx.strokeStyle = alpha(color, 0.5);
        ctx.setLineDash([3, 3]);
        line(ctx, a, b);
        break;
      }
      case 'long':
      case 'short': {
        const cc = pts[2] ?? null;
        const entry = d.points[0]?.p ?? null;
        const target = d.points[1]?.p ?? null;
        const stop = d.points[2]?.p ?? null;
        if (a === null || b === null || cc === null || entry === null || target === null || stop === null) break;
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x, x1 + 20);
        const up = c.up;
        const down = c.down;
        ctx.setLineDash([]);
        ctx.fillStyle = alpha(up, 0.16);
        ctx.fillRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
        ctx.fillStyle = alpha(down, 0.16);
        ctx.fillRect(x1, Math.min(a.y, cc.y), x2 - x1, Math.abs(cc.y - a.y));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        line(ctx, { x: x1, y: a.y }, { x: x2, y: a.y });
        const reward = Math.abs(target - entry);
        const risk = Math.abs(entry - stop);
        const rr = risk > 0 ? reward / risk : 0;
        const tpct = ((target - entry) / entry) * 100;
        const spct = ((stop - entry) / entry) * 100;
        label(ctx, `Target ${fmtPrice(target, hint)} (${pct(tpct)})`, x1 + 4, b.y + (b.y < a.y ? -4 : 13), up, 'left');
        label(ctx, `Stop ${fmtPrice(stop, hint)} (${pct(spct)})`, x1 + 4, cc.y + (cc.y < a.y ? -4 : 13), down, 'left');
        label(ctx, `${d.tool === 'long' ? 'Long' : 'Short'} ${fmtPrice(entry, hint)} · R:R ${rr.toFixed(2)}${agent ? ' · AI' : ''}`, x1 + 4, a.y - 4, c.ink, 'left');
        break;
      }
      case 'measure': {
        const p0 = d.points[0]?.p ?? null;
        const p1 = d.points[1]?.p ?? null;
        const t0 = d.points[0]?.t ?? null;
        const t1 = d.points[1]?.t ?? null;
        if (a === null || b === null || p0 === null || p1 === null || t0 === null || t1 === null || this.geo === null) break;
        const tone = p1 >= p0 ? c.up : c.down;
        ctx.fillStyle = alpha(tone, 0.14);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = tone;
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        line(ctx, a, b);
        const bars = this.geo.barsBetween(t0, t1);
        const txt = `${p1 - p0 >= 0 ? '+' : '−'}${fmtPrice(Math.abs(p1 - p0), hint)}  ${pct(((p1 - p0) / p0) * 100)}  ${bars} bars`;
        pill(ctx, txt, (a.x + b.x) / 2, Math.max(a.y, b.y) + 16, tone, '#ffffff');
        break;
      }
      case 'text': {
        if (a === null) break;
        const size = d.style.size ?? 12;
        ctx.font = `600 ${size}px Manrope Variable, Manrope, system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.fillText((agent ? 'AI · ' : '') + (d.text || 'Text'), a.x, a.y);
        break;
      }
      case 'arrow_up':
      case 'arrow_down': {
        if (a === null) break;
        const dir = d.tool === 'arrow_up' ? 1 : -1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x - 6, a.y + dir * 10);
        ctx.lineTo(a.x + 6, a.y + dir * 10);
        ctx.closePath();
        ctx.fillStyle = d.style.color !== undefined ? color : d.tool === 'arrow_up' ? c.up : c.down;
        ctx.fill();
        if (d.text !== '') label(ctx, d.text, a.x, a.y + dir * 22, color, 'center');
        break;
      }
    }
    if (d.id === this.selected && !d.locked) this.handles(ctx, d, pts, color);
  }

  private handles(ctx: Ctx, d: Drawing, pts: (XY | null)[], color: string): void {
    const c = chartColors();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    pts.forEach((q, i) => {
      if (q === null) return;
      let x = d.tool === 'hline' ? this.w - 40 : q.x;
      const y = d.tool === 'vline' ? 30 : q.y;
      if ((d.tool === 'long' || d.tool === 'short') && i === 2) x = pts[0]?.x ?? x;
      ctx.fillStyle = c.card;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
}

function lineY(a: XY, b: XY, x: number): number {
  if (b.x === a.x) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

function between(v: number, a: number, b: number): boolean {
  return v >= Math.min(a, b) && v <= Math.max(a, b);
}

function line(ctx: Ctx, a: XY, b: XY): void {
  ctx.beginPath();
  ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
  ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
  ctx.stroke();
}

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign): void {
  if (text === '') return;
  ctx.save();
  ctx.setLineDash([]);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const c = chartColors();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.card;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function pill(ctx: Ctx, text: string, x: number, y: number, bg: string, fg: string): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = '600 11px Manrope Variable, Manrope, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 9, w, 18, 4);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

/** A new drawing's points while it is being placed: missing points follow the mouse. */
export function draftPoints(tool: Tool, placed: Point[], mouse: Point): Point[] {
  const out = placed.slice();
  const need = POINTS[tool];
  while (out.length < need) out.push(mouse);
  if ((tool === 'long' || tool === 'short') && placed.length === 1) {
    // One click places the entry: target and stop default to a 2:1 setup.
    const e = placed[0] as Point;
    const span = Math.abs((mouse.p ?? 0) - (e.p ?? 0)) || Math.abs(e.p ?? 0) * 0.02;
    const dir = tool === 'long' ? 1 : -1;
    return [e, { t: mouse.t, p: (e.p ?? 0) + dir * span * 2 }, { t: null, p: (e.p ?? 0) - dir * span }];
  }
  return out;
}

/**
 * Falling notes: the song as bars of light that fall onto the keys below.
 * The bottom edge is "now"; a note reaches it as it sounds. Drawn on a
 * canvas every frame from the engine's position and each note's status.
 * Chord names fall at the left with the music; the sustain pedal is a lane
 * at the right edge (a notch where it changes).
 */
import type { Model } from '../lib/types.ts';
import { noteName } from '../lib/format.ts';
import { ST_HIT, ST_MISS } from './engine.ts';
import type { Engine } from './engine.ts';
import { pedalDown } from './harmony.ts';
import type { ChordSpan } from './harmony.ts';
import type { Layout } from './keys.ts';

interface Colors {
  rh: string;
  lh: string;
  bad: string;
  ink: string;
  muted: string;
  line: string;
  hair: string;
  lane: string;
  font: string;
  sans: string;
  page: string;
}

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
  return {
    rh: v('--pc-rh', '#2563eb'),
    lh: v('--pc-lh', '#0d9488'),
    bad: v('--pc-bad', '#dc2626'),
    ink: v('--pc-ink', '#1f1e1b'),
    muted: v('--pc-muted', '#6f6d67'),
    line: v('--pc-line', '#ccc'),
    hair: v('--pc-hair', '#e5e5e5'),
    lane: v('--pc-sunk', '#eef0f0'),
    font: v('--pc-mono', 'monospace'),
    sans: v('--pc-font', 'sans-serif'),
    page: v('--pc-page', '#f4f5f5'),
  };
}

interface Burst {
  x: number;
  w: number;
  color: string;
  t0: number;
}

export class Roll {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors: Colors;
  private bursts: Burst[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  showNames = false;
  /** The chord track and whether to show it; whether to show the pedal. */
  chords: ChordSpan[] = [];
  showChords = true;
  showPedal = true;
  /** Seconds of music above the now line. */
  seconds = 4.5;

  constructor(
    canvas: HTMLCanvasElement,
    private engine: Engine,
    private keys: Layout,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('canvas 2d is not available');
    this.ctx = ctx;
    this.colors = readColors(canvas);
  }

  setKeys(keys: Layout): void {
    this.keys = keys;
  }

  refreshColors(): void {
    this.colors = readColors(this.canvas);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** A ring where a note met its key. */
  burst(midi: number, hand: number): void {
    const k = this.keys.byMidi.get(midi);
    if (k === undefined) return;
    this.bursts.push({ x: (k.x + k.w / 2) * this.w, w: k.w * this.w, color: hand === 1 ? this.colors.lh : this.colors.rh, t0: performance.now() });
  }

  draw(now: number): void {
    const { ctx, w, h, dpr, colors } = this;
    const e = this.engine;
    const m: Model = e.model;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Lanes: black keys slightly shaded, a line at every C.
    for (const k of this.keys.keys) {
      const x = k.x * w;
      if (k.black) {
        ctx.fillStyle = colors.lane;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x, 0, k.w * w, h);
        ctx.globalAlpha = 1;
      } else if (k.midi % 12 === 0) {
        ctx.fillStyle = colors.hair;
        ctx.fillRect(Math.round(x), 0, 1, h);
      }
    }

    const qpm = (m.tempo * e.cfg.tempo) / 100;
    const visQ = Math.max(2, Math.min(16, (this.seconds * qpm) / 60));
    const ppq = h / visQ;
    const pos = e.pos;
    const yOf = (q: number): number => h - (q - pos) * ppq;

    // Bar lines and numbers.
    ctx.font = `500 10px ${colors.font}`;
    ctx.textBaseline = 'bottom';
    const i0 = e.barAt(Math.max(0, pos - 1));
    for (let i = i0; i < m.bars.length; i++) {
      const b = m.bars[i];
      if (b === undefined) break;
      const y = yOf(b.t);
      if (y < -20) break;
      if (b.t < e.q0 - 1e-6 || b.t > e.q1 + 1e-6) continue;
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, Math.round(y), w, 1);
      ctx.fillStyle = colors.muted;
      ctx.fillText(String(b.n).padStart(2, '0'), 6, y - 3);
      // Beats inside the bar, fainter.
      ctx.fillStyle = colors.hair;
      for (let q = b.t + m.beat; q < b.t + b.len - 1e-6; q += m.beat) {
        const yb = Math.round(yOf(q));
        if (yb > 0 && yb < h) ctx.fillRect(28, yb, w - 28, 1);
      }
    }
    if (e.q1 > pos) {
      const ye = yOf(e.q1);
      if (ye > 0) {
        ctx.fillStyle = colors.ink;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(0, Math.round(ye), w, 1.5);
        ctx.globalAlpha = 1;
      }
    }

    // Notes in the practice range, from those still sounding to the top.
    const notes = m.notes;
    let lo = 0;
    let hi = notes.length;
    const startQ = pos - 8;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((notes[mid]?.[0] ?? 0) < startQ) lo = mid + 1;
      else hi = mid;
    }
    const r = Math.max(2, Math.min(5, (this.keys.byMidi.get(60)?.w ?? 0.02) * w * 0.12));
    for (let i = lo; i < notes.length; i++) {
      const n = notes[i];
      if (n === undefined) continue;
      if (n[0] > pos + visQ + 0.1) break;
      if (n[0] < e.q0 - 1e-6 || n[0] >= e.q1 - 1e-6) continue;
      if (n[0] + n[1] < pos - 0.4) continue;
      const k = this.keys.byMidi.get(n[2]);
      if (k === undefined) continue;
      const judged = e.judges(n[3]);
      const color = n[3] === 1 ? colors.lh : colors.rh;
      const y1 = yOf(n[0]);
      const y0 = yOf(n[0] + Math.max(n[1], 0.12));
      // Slimmer than the key, centred on it: notes read as notes, not blocks.
      const kw = k.w * w;
      const ww = Math.max(3, Math.min(kw - 2, kw * (k.black ? 0.86 : 0.62)));
      const x = k.x * w + (kw - ww) / 2;
      const hh = Math.max(4, y1 - y0 - 1.5);
      const st = e.status[i];
      ctx.beginPath();
      ctx.roundRect(x, y0, ww, hh, r);
      if (!judged) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      if (st === ST_MISS) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = colors.muted;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.bad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (st === ST_HIT) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 2, y0 + 2, Math.max(1, ww * 0.18), Math.max(2, hh - 4));
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.86;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const label = n[4] > 0 ? String(n[4]) : this.showNames ? noteName(n[2], false) : '';
      if (label !== '' && ww >= 11 && hh >= 14) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.min(11, ww * 0.7)}px ${colors.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x + ww / 2, y1 - 3);
        ctx.textAlign = 'left';
      }
    }

    // The sustain pedal: a lane at the right edge, a notch where it changes.
    const pedal = m.pedal ?? [];
    if (this.showPedal && pedal.length > 0) {
      const lw = 6;
      const lx = w - 14;
      // The foot lifts at each change and presses again about a fifth of a second later.
      const lag = (0.2 * qpm) / 60;
      for (const [a, b] of pedal) {
        if (b < pos - 0.05) continue;
        if (a > pos + visQ) break;
        const down = pedalDown(a, b, lag);
        const top = Math.max(-4, yOf(b));
        const bottom = Math.min(h, yOf(down));
        if (bottom - top < 1) continue;
        ctx.fillStyle = colors.ink;
        ctx.globalAlpha = down <= pos + 1e-6 && pos < b ? 0.6 : 0.2;
        ctx.beginPath();
        ctx.roundRect(lx, top, lw, bottom - top, 3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 9px ${colors.font}`;
      ctx.fillStyle = colors.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('PED', lx + lw / 2, 6);
      ctx.textAlign = 'left';
    }

    // Chord names fall at the left; the one sounding now waits at the bottom.
    if (this.showChords && this.chords.length > 0) {
      ctx.font = `600 13px ${colors.sans}`;
      ctx.textBaseline = 'middle';
      for (const c of this.chords) {
        if (c.t + c.d < pos + 1e-6) continue;
        if (c.t > pos + visQ) break;
        if (c.t + c.d <= e.q0 + 1e-6 || c.t >= e.q1 - 1e-6) continue;
        const now = c.t <= pos + 1e-6;
        const y = now ? h - 16 : Math.min(h - 16, yOf(c.t) - 12);
        if (y < -10) continue;
        const tw = ctx.measureText(c.sym).width;
        const x = 34;
        ctx.globalAlpha = now ? 0.96 : 0.82;
        ctx.fillStyle = now ? colors.ink : colors.page;
        ctx.beginPath();
        ctx.roundRect(x - 6, y - 10, tw + 12, 20, 6);
        ctx.fill();
        if (!now) {
          ctx.strokeStyle = colors.line;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = now ? colors.page : colors.ink;
        ctx.fillText(c.sym, x, y + 0.5);
      }
      ctx.textBaseline = 'bottom';
    }

    // Now: where the notes meet the keys.
    ctx.fillStyle = colors.ink;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, h - 3, w, 3);
    ctx.globalAlpha = 1;

    // Rings where notes landed.
    this.bursts = this.bursts.filter((b) => now - b.t0 < 520);
    for (const b of this.bursts) {
      const k = (now - b.t0) / 520;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(b.x, h - 2, b.w * (0.5 + k * 1.4), 6 + k * 22, 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * The Voice Dial: the instrument in place of a keyboard. A half circle, the
 * rim, with a fixed notch at 12 o'clock that is the note to sing. The voice
 * is a head riding the rim: its angle is how far off the note it is (flat to
 * the left, sharp to the right, on a scale that is fine near the target and
 * compressed far from it: θ = 90° × tanh(cents / 350)), its size is how loud,
 * its edge how steady. The last 1.5 seconds flow inward from the rim as a
 * trace, so a scoop, a vibrato, a drift or a crack can be seen. When the
 * voice holds inside the in-tune band the notch's two jaws close around it.
 *
 * Modes: song (the default, under the lane), hold (long tones: a strobe ring
 * drifts while off and freezes within ±10¢), free (a tuner: no target, the
 * nearest note is the reference), breath (a ring that breathes with a guide,
 * filled by the sound), blind (feedback after the take: rim, notch and a slow
 * activity ring, never the pitch).
 *
 * Drawing: a static canvas (rim, ticks, labels, notch) redrawn only on resize,
 * theme or target change; a dynamic canvas for the head, trace and jaws, with
 * glows from pre-rendered sprites (never shadowBlur), one batched path per
 * alpha bucket. Readouts are DOM, fed from `readout()` at 10 Hz. Only the
 * voice moves; under reduced motion the trace and strobe go and the head
 * follows a plain low-pass.
 */
import { fold } from './judge.ts';

export type DialMode = 'song' | 'hold' | 'free' | 'breath' | 'blind';

export interface DialFrame {
  /** performance.now() ms */
  at: number;
  voiced: boolean;
  /** Sung pitch, fractional MIDI (NaN when not voiced). */
  midi: number;
  db: number;
}

export interface DialTarget {
  midi: number;
  /** The note's name as the song spells it (for the top label). */
  name?: string | undefined;
}

export interface Readout {
  voiced: boolean;
  cents: number | null;
  note: string;
  locked: boolean;
  /** SD of cents over the last 300 ms (steadiness). */
  steady: number | null;
  db: number;
  octave: number;
  sung: number | null;
}

interface Theme {
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  line: string;
  voice: string;
  dark: boolean;
}

interface Hist {
  at: number;
  e: number;
  db: number;
  voiced: boolean;
  /** The target at that moment (a change draws an arc). */
  tgt: number;
}

const NAMES_SHARP = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function noteLabel(m: number, octave = true): string {
  const r = Math.round(m);
  return NAMES_SHARP[((r % 12) + 12) % 12]! + (octave ? String(Math.floor(r / 12) - 1) : '');
}

/** θ (radians from 12 o'clock, right positive) for an error in cents. */
export function angleOf(cents: number): number {
  return (Math.PI / 2) * Math.tanh(cents / 350);
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v === '' ? fallback : v;
}

/** A soft round glow, pre-rendered once per colour and radius. */
function sprite(color: string, r: number, soft: number): HTMLCanvasElement {
  const size = Math.ceil((r + soft) * 2 + 4);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g === null) return c;
  const mid = size / 2;
  const grad = g.createRadialGradient(mid, mid, Math.max(0, r * 0.2), mid, mid, r + soft);
  grad.addColorStop(0, color);
  grad.addColorStop(Math.min(0.99, r / (r + soft)), color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(mid, mid, r + soft, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class Dial {
  mode: DialMode = 'song';
  private sc: HTMLCanvasElement;
  private dc: HTMLCanvasElement;
  private s: CanvasRenderingContext2D | null;
  private d: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  private R = 100;
  private theme: Theme = { ink: '#1b2024', ink2: '#3a4247', muted: '#6b757b', faint: '#9aa3a8', line: '#c9d0d4', voice: '#2f6fe4', dark: false };
  private sprites: HTMLCanvasElement[] = [];
  private target: DialTarget | null = null;
  private next: DialTarget | null = null;
  private nextSoon = false;
  private onBand = 25;
  private closeBand = 50;
  private hist: Hist[] = [];
  private headE = 0;
  private headV = 0;
  private headR = 0;
  private lastAt = 0;
  private locked = false;
  private jaw = 0;
  private strobe = 0;
  private labelFade = 1;
  private reduced = false;
  private lastVoiceAt = 0;
  private breath: { phase: 'inhale' | 'suspend' | 'exhale' | 'rest'; p: number } = { phase: 'rest', p: 0 };
  private freeRef = 60;
  private lastMidi = NaN;

  constructor(staticCanvas: HTMLCanvasElement, dynamicCanvas: HTMLCanvasElement) {
    this.sc = staticCanvas;
    this.dc = dynamicCanvas;
    this.s = staticCanvas.getContext('2d');
    this.d = dynamicCanvas.getContext('2d');
    try {
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.reduced = false;
    }
    this.readTheme();
  }

  /** Read the colours from the CSS tokens (call on theme change). */
  readTheme(): void {
    const el = this.sc;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.theme = {
      ink: cssVar(el, '--sc-ink', '#1b2024'),
      ink2: cssVar(el, '--sc-ink-2', '#3a4247'),
      muted: cssVar(el, '--sc-muted', '#6b757b'),
      faint: cssVar(el, '--sc-faint', '#9aa3a8'),
      line: cssVar(el, '--sc-line-2', '#c9d0d4'),
      voice: cssVar(el, '--sc-voice', '#2f6fe4'),
      dark,
    };
    // Glows: crisp, soft, softer, frayed.
    this.sprites = [2, 5, 9, 14].map((soft) => sprite(this.theme.voice, 6, soft));
    this.drawStatic();
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.sc, this.dc]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.cx = w / 2;
    this.cy = h - 14;
    this.R = Math.max(40, Math.min(h - 30, w / 2 - 60));
    this.drawStatic();
  }

  setBands(on: number, close: number): void {
    if (on === this.onBand && close === this.closeBand) return;
    this.onBand = on;
    this.closeBand = close;
    this.drawStatic();
  }

  setMode(m: DialMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.hist = [];
    this.drawStatic();
  }

  /** The note to sing now and the one after it (a ghost tick appears when it is close). */
  setTarget(t: DialTarget | null, next: DialTarget | null = null, soon = false): void {
    const changed = (t?.midi ?? null) !== (this.target?.midi ?? null);
    this.target = t;
    this.next = next;
    this.nextSoon = soon;
    if (changed) {
      this.labelFade = this.reduced ? 1 : 0;
      this.drawStatic();
    }
  }

  setBreath(phase: 'inhale' | 'suspend' | 'exhale' | 'rest', p: number): void {
    this.breath = { phase, p };
  }

  /** The reference the dial measures against right now. */
  private ref(): number | null {
    if (this.mode === 'free') return this.freeRef;
    return this.target === null ? null : this.target.midi;
  }

  private pt(theta: number, r: number): [number, number] {
    return [this.cx + r * Math.sin(theta), this.cy - r * Math.cos(theta)];
  }

  /* ----------------------------------------------------------- static layer */

  private drawStatic(): void {
    const g = this.s;
    if (g === null || this.w === 0) return;
    const t = this.theme;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const R = this.R;
    const ref = this.ref();
    const off = ref === null && this.mode !== 'breath';
    g.globalAlpha = off ? 0.4 : 1;
    // The rim and an inner hairline.
    g.lineWidth = 1;
    g.strokeStyle = t.line;
    g.beginPath();
    g.arc(this.cx, this.cy, R, -Math.PI, 0);
    g.stroke();
    g.globalAlpha = (off ? 0.4 : 1) * 0.55;
    g.beginPath();
    g.arc(this.cx, this.cy, R - 22, -Math.PI, 0);
    g.stroke();
    g.globalAlpha = off ? 0.4 : 1;
    // The baseline.
    g.strokeStyle = t.line;
    g.beginPath();
    g.moveTo(this.cx - R - 10, this.cy + 0.5);
    g.lineTo(this.cx + R + 10, this.cy + 0.5);
    g.stroke();
    if (this.mode === 'breath') return;
    // Semitone ticks (6 px) and, near the target, a 10-cent vernier.
    g.strokeStyle = t.muted;
    for (let k = -12; k <= 12; k++) {
      const th = angleOf(k * 100);
      const [x0, y0] = this.pt(th, R - (k % 12 === 0 ? 9 : 6));
      const [x1, y1] = this.pt(th, R);
      g.lineWidth = k % 12 === 0 ? 1.4 : 1;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.lineWidth = 1;
    g.strokeStyle = t.faint;
    for (let c = -90; c <= 90; c += 10) {
      if (c === 0) continue;
      const th = angleOf(c);
      const len = c % 50 === 0 ? 5 : 3;
      const [x0, y0] = this.pt(th, R + 2);
      const [x1, y1] = this.pt(th, R + 2 + len);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // The close band: faint dots at ±close.
    g.fillStyle = t.faint;
    for (const c of [-this.closeBand, this.closeBand]) {
      const [x, y] = this.pt(angleOf(c), R - 14);
      g.beginPath();
      g.arc(x, y, 1.4, 0, Math.PI * 2);
      g.fill();
    }
    // Note names outside the rim where ticks are 18 px or more apart.
    if (ref !== null) {
      g.font = '500 10px ' + cssVar(this.sc, '--sc-mono', 'ui-monospace, monospace');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let lastX = -1e9;
      let lastY = -1e9;
      for (let k = -12; k <= 12; k++) {
        if (k === 0) continue;
        const th = angleOf(k * 100);
        const [x, y] = this.pt(th, R + 16);
        if (Math.hypot(x - lastX, y - lastY) < 26 && Math.abs(k) > 1) continue;
        const [xa, ya] = this.pt(angleOf((k - Math.sign(k)) * 100), R + 16);
        if (Math.hypot(x - xa, y - ya) < 18) continue;
        lastX = x;
        lastY = y;
        g.fillStyle = Math.abs(k) <= 2 ? t.ink2 : t.muted;
        g.fillText(noteLabel(Math.round(ref) + k, Math.abs(k) <= 2), x, y);
      }
    }
  }

  /* ---------------------------------------------------------- dynamic layer */

  /** Feed a voice frame (about 94 a second). */
  push(f: DialFrame): void {
    const ref = this.ref();
    if (this.mode === 'free' && f.voiced && Number.isFinite(f.midi)) {
      const r = Math.round(f.midi);
      if (r !== this.freeRef && Math.abs(f.midi - this.freeRef) > 0.62) {
        this.freeRef = r;
        this.labelFade = this.reduced ? 1 : 0;
        this.drawStatic();
      }
    }
    if (f.voiced) {
      this.lastVoiceAt = f.at;
      if (Number.isFinite(f.midi)) this.lastMidi = f.midi;
    }
    const e = ref !== null && f.voiced && Number.isFinite(f.midi) ? fold(f.midi, ref) : NaN;
    this.hist.push({ at: f.at, e, db: f.db, voiced: f.voiced && Number.isFinite(e), tgt: ref ?? -1 });
    const cut = f.at - 1600;
    while (this.hist.length > 0 && this.hist[0]!.at < cut) this.hist.shift();
  }

  private recent(ms: number, now: number): number[] {
    const out: number[] = [];
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const h = this.hist[i]!;
      if (now - h.at > ms) break;
      if (h.voiced) out.push(h.e);
    }
    return out;
  }

  /** The numbers for the DOM readouts. */
  readout(lastMidi: number, lastDb: number): Readout {
    const now = performance.now();
    const ref = this.ref();
    const r = this.recent(300, now);
    const voiced = now - this.lastVoiceAt < 160;
    let cents: number | null = null;
    let steady: number | null = null;
    if (r.length >= 3 && voiced) {
      const s = r.slice().sort((a, b) => a - b);
      cents = Math.round(s[Math.floor(s.length / 2)]!);
      const m = r.reduce((a, b) => a + b, 0) / r.length;
      steady = Math.round(Math.sqrt(r.reduce((a, b) => a + (b - m) * (b - m), 0) / r.length));
    }
    const octave = ref !== null && Number.isFinite(lastMidi) ? Math.round(((lastMidi - ref) * 100 - fold(lastMidi, ref)) / 1200) : 0;
    return { voiced, cents, note: voiced && Number.isFinite(lastMidi) ? noteLabel(lastMidi) : '', locked: this.locked, steady, db: lastDb, octave, sung: voiced && Number.isFinite(lastMidi) ? lastMidi : null };
  }

  /** Draw one frame (call from requestAnimationFrame). Returns false when nothing moves. */
  draw(now: number): boolean {
    const g = this.d;
    if (g === null || this.w === 0) return false;
    const t = this.theme;
    const dt = this.lastAt === 0 ? 16 : Math.min(64, now - this.lastAt);
    this.lastAt = now;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (this.labelFade < 1) {
      this.labelFade = Math.min(1, this.labelFade + dt / 120);
      this.sc.style.opacity = String(0.35 + 0.65 * this.labelFade);
    }
    const R = this.R;
    const ref = this.ref();
    if (this.mode === 'breath') return this.drawBreath(g, now);
    const voicedNow = now - this.lastVoiceAt < 140;
    const last = this.hist.length > 0 ? this.hist[this.hist.length - 1]! : null;
    // Lock: the median of the last 250 ms inside the on band; released 10 cents wider.
    const r250 = this.recent(250, now);
    let med = NaN;
    if (r250.length >= 4) {
      const s = r250.slice().sort((a, b) => a - b);
      med = s[Math.floor(s.length / 2)]!;
    }
    const wasLocked = this.locked;
    this.locked = voicedNow && Number.isFinite(med) && (wasLocked ? Math.abs(med) <= this.onBand + 10 : Math.abs(med) <= this.onBand);
    // The jaws close around a locked head in 90 ms.
    const jawTarget = this.locked ? 1 : 0;
    this.jaw += (jawTarget - this.jaw) * Math.min(1, this.reduced ? 1 : dt / 90);
    this.drawJaws(g, ref);
    if (this.mode === 'blind') {
      this.drawActivity(g, now, voicedNow);
      return voicedNow || now - this.lastVoiceAt < 2000;
    }
    // Ghost tick for the next note.
    if (this.next !== null && this.nextSoon && ref !== null && this.mode === 'song') {
      const k = this.next.midi - ref;
      const th = angleOf(k * 100);
      const [x, y] = this.pt(th, R);
      g.strokeStyle = t.ink2;
      g.lineWidth = 1.2;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    // Strobe ring (hold mode): drifts while off, freezes within ±10 cents.
    if (this.mode === 'hold' && !this.reduced && ref !== null) {
      const r300 = this.recent(300, now);
      const m300 = r300.length > 0 ? r300.reduce((a, b) => a + b, 0) / r300.length : 0;
      if (voicedNow && Math.abs(m300) > 10) this.strobe += (dt / 1000) * Math.max(-1.6, Math.min(1.6, m300 / 40));
      g.save();
      g.translate(this.cx, this.cy);
      g.rotate(this.strobe);
      g.strokeStyle = t.muted;
      g.globalAlpha = voicedNow ? 0.7 : 0.3;
      g.setLineDash([2, 7]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, R - 34, Math.PI, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.restore();
      g.globalAlpha = 1;
    }
    if (ref === null) return false;
    // The trace: the last 1.5 s flowing inward, in alpha buckets.
    if (!this.reduced && this.hist.length > 1) {
      const buckets = 5;
      for (let bkt = 0; bkt < buckets; bkt++) {
        const a0 = (bkt / buckets) * 1500;
        const a1 = ((bkt + 1) / buckets) * 1500;
        g.beginPath();
        let open = false;
        let lastTgt = -2;
        for (const hpt of this.hist) {
          const age = now - hpt.at;
          if (age < a0 - 25 || age > a1 + 25 || !hpt.voiced) {
            open = false;
            continue;
          }
          if (hpt.tgt !== lastTgt) open = false;
          lastTgt = hpt.tgt;
          const rr = R * (1 - (0.6 * Math.min(1500, age)) / 1500);
          const [x, y] = this.pt(angleOf(hpt.e), rr);
          if (!open) {
            g.moveTo(x, y);
            open = true;
          } else g.lineTo(x, y);
        }
        const loud = last !== null ? Math.max(0, Math.min(1, (last.db + 50) / 44)) : 0.5;
        g.lineWidth = 1 + loud * 4 * (1 - bkt / buckets);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = t.voice;
        g.globalAlpha = 0.75 * (1 - bkt / buckets) + 0.05;
        g.stroke();
      }
      g.globalAlpha = 1;
      // A faint arc where the target changed.
      g.strokeStyle = t.faint;
      g.lineWidth = 1;
      for (let i = 1; i < this.hist.length; i++) {
        const a = this.hist[i - 1]!;
        const b = this.hist[i]!;
        if (a.tgt === b.tgt || a.tgt < 0) continue;
        const age = now - b.at;
        if (age > 1500) continue;
        const rr = R * (1 - (0.6 * age) / 1500);
        g.globalAlpha = 0.5 * (1 - age / 1500);
        g.beginPath();
        g.arc(this.cx, this.cy, rr, -Math.PI * 0.92, -Math.PI * 0.08);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // The head: a critically damped spring (35 ms) toward the newest error.
    const target = last !== null && last.voiced ? last.e : this.headE;
    if (this.reduced) this.headE += (target - this.headE) * Math.min(1, dt / 60);
    else {
      const w0 = 1 / 0.035;
      const x = this.headE - target;
      const a = -w0 * w0 * x - 2 * w0 * this.headV;
      this.headV += (a * dt) / 1000;
      this.headE += (this.headV * dt) / 1000;
    }
    const sinceVoice = now - this.lastVoiceAt;
    const show = this.mode === 'song' || this.mode === 'hold' || this.mode === 'free';
    if (show && sinceVoice < 900) {
      const fade = sinceVoice < 140 ? 1 : Math.max(0, 1 - (sinceVoice - 140) / 400);
      const loud = last !== null ? Math.max(0, Math.min(1, (last.db + 50) / 44)) : 0.4;
      const rad = 3 + Math.sqrt(loud) * 8;
      this.headR += (rad - this.headR) * Math.min(1, dt / 80);
      const th = angleOf(this.headE);
      const [x, y] = this.pt(th, R);
      const r300 = this.recent(300, now);
      const m = r300.length > 0 ? r300.reduce((a, b) => a + b, 0) / r300.length : 0;
      const sdv = r300.length > 2 ? Math.sqrt(r300.reduce((a, b) => a + (b - m) * (b - m), 0) / r300.length) : 0;
      const which = sdv <= 8 ? 0 : sdv <= 15 ? 1 : sdv <= 30 ? 2 : 3;
      const spr = this.sprites[which];
      if (spr !== undefined) {
        g.save();
        g.globalAlpha = fade * (this.locked ? 0.55 : 0.32);
        if (t.dark) g.globalCompositeOperation = 'lighter';
        const scale = this.headR / 6;
        const sz = spr.width * scale;
        g.drawImage(spr, x - sz / 2, y - sz / 2, sz, sz);
        g.restore();
      }
      const confident = sinceVoice < 140;
      g.globalAlpha = fade;
      g.beginPath();
      g.arc(x, y, this.headR, 0, Math.PI * 2);
      if (confident) {
        g.fillStyle = t.voice;
        g.globalAlpha = fade * (this.locked ? 1 : 0.88);
        g.fill();
        if (which === 3 && !this.reduced) {
          // Frayed: a broken ring around an unsteady voice.
          g.setLineDash([2, 3]);
          g.strokeStyle = t.voice;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(x, y, this.headR + 3, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      } else {
        g.strokeStyle = t.voice;
        g.lineWidth = 1.5;
        g.stroke();
      }
      // An octave tag when the voice sits an octave away from the written note.
      const lm = this.lastMidi;
      const octave = last !== null && last.voiced && this.mode !== 'free' && Number.isFinite(lm) ? Math.round(((lm - ref) * 100 - fold(lm, ref)) / 1200) : 0;
      if (Number.isFinite(octave) && octave !== 0) {
        g.globalAlpha = fade * 0.9;
        g.fillStyle = t.muted;
        g.font = '500 9px ' + cssVar(this.sc, '--sc-mono', 'ui-monospace, monospace');
        g.textAlign = 'center';
        g.fillText(octave < 0 ? '8vb' : '8va', x, y - this.headR - 8);
      }
      g.globalAlpha = 1;
    }
    return sinceVoice < 2000 || this.jaw > 0.01;
  }

  private drawJaws(g: CanvasRenderingContext2D, ref: number | null): void {
    const t = this.theme;
    const R = this.R;
    if (ref === null && this.mode !== 'blind') return;
    // Open: at the edges of the in-tune band. Closed: touching the head.
    const open = angleOf(this.onBand);
    const shut = Math.max(0.012, Math.asin(Math.min(0.9, (this.headR + 2) / R)));
    const centre = this.jaw > 0.01 ? angleOf(this.headE) * this.jaw : 0;
    const half = open + (shut - open) * this.jaw;
    g.strokeStyle = this.jaw > 0.5 ? t.ink : t.ink2;
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (const side of [-1, 1]) {
      const th = centre + side * half;
      const [x0, y0] = this.pt(th, R - 13);
      const [x1, y1] = this.pt(th, R + 7);
      g.globalAlpha = this.reduced ? (this.locked ? 1 : 0.7) : 0.6 + 0.4 * this.jaw;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** Blind mode: a slow ring at the hub that pulses with voicing, never the pitch. */
  private drawActivity(g: CanvasRenderingContext2D, now: number, voiced: boolean): void {
    const t = this.theme;
    const base = 14;
    const p = voiced ? 0.5 + 0.5 * Math.sin(now / 420) : 0;
    g.strokeStyle = t.voice;
    g.globalAlpha = voiced ? 0.35 + 0.35 * p : 0.18;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(this.cx, this.cy - 28, base + p * 5, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  /** Breath mode: the ring grows on the in-breath, holds, shrinks on the out-breath; filled by the sound. */
  private drawBreath(g: CanvasRenderingContext2D, now: number): boolean {
    const t = this.theme;
    const { phase, p } = this.breath;
    const minR = this.R * 0.22;
    const maxR = this.R * 0.82;
    let r = minR;
    if (phase === 'inhale') r = minR + (maxR - minR) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    else if (phase === 'suspend') r = maxR;
    else if (phase === 'exhale') r = maxR - (maxR - minR) * p;
    const cy = this.cy - this.R * 0.45;
    g.strokeStyle = t.ink2;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(this.cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    // The sound fills it.
    const last = this.hist.length > 0 ? this.hist[this.hist.length - 1]! : null;
    const sounding = last !== null && now - last.at < 200 && last.db > -55;
    const loud = last !== null ? Math.max(0, Math.min(1, (last.db + 60) / 40)) : 0;
    if (sounding) {
      g.fillStyle = t.voice;
      g.globalAlpha = 0.18 + 0.4 * loud;
      g.beginPath();
      g.arc(this.cx, cy, r * (0.35 + 0.6 * loud), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    return true;
  }
}

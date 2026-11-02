/**
 * The practice engine: plays, follows and judges one stretch of bars.
 *
 *   listen  the app plays the bars (both hands, or one) with the cursor
 *   learn   the cursor waits on each note or chord until the right keys
 *           are pressed; the other hand can play along by itself
 *   play    in time, after a count-in, with the metronome: every note is
 *           judged for pitch and for timing against a window (lenient 220,
 *           normal 160, strict 110 ms); a pass ends at the last bar and,
 *           with the loop on, the next pass follows without a gap
 *
 * Time: audio is scheduled ahead on the audio clock, the cursor follows
 * performance.now() shifted by the output latency so it meets each note as
 * it is heard, and key presses are compared to the same moment (less the
 * person's measured input latency).
 *
 * The engine knows nothing about React: the practice page drives frame()
 * from requestAnimationFrame and listens to on().
 */
import type { Hands, Mode, Model, Strictness } from '../lib/types.ts';
import { audio } from './audio.ts';
import type { NoteEvent } from './input.ts';

export const WINDOW_MS: Record<Strictness, number> = { lenient: 220, normal: 160, strict: 110 };
export const CLEAN: Record<Strictness, number> = { lenient: 0.9, normal: 0.95, strict: 0.98 };

export const ST_PENDING = 0;
export const ST_HIT = 1;
export const ST_MISS = 2;

export interface EngineConfig {
  mode: Mode;
  from: number;
  to: number;
  hands: Hands;
  tempo: number;
  loop: boolean;
  metronome: boolean;
  countIn: boolean;
  otherHand: boolean;
  strictness: Strictness;
  latencyMs: number;
  mic: boolean;
  /** Rhythm drills: any key counts, only the timing is judged. */
  anyPitch?: boolean;
}

export interface PassResult {
  mode: Mode;
  from: number;
  to: number;
  hands: Hands;
  tempo: number;
  durationMs: number;
  expected: number;
  hits: number;
  wrong: number;
  missed: number;
  mad: number | null;
  bias: number | null;
  perBar: number[][];
  complete: boolean;
  accuracy: number;
  clean: boolean;
  pass: number;
}

export type EngineEvent =
  | { type: 'state' }
  | { type: 'hit'; note: number; midi: number; hand: number; dev: number }
  | { type: 'wrong'; midi: number }
  | { type: 'miss'; note: number }
  | { type: 'pass'; result: PassResult }
  | { type: 'count'; beat: number; of: number };

interface Expect {
  i: number;
  pass: number;
  t: number;
  p: number;
  n: number;
  hand: number;
  group: number;
  matched: boolean;
  missed: boolean;
}

interface Target {
  q: number;
  idx: number[];
  pitches: Set<number>;
  n: number;
}

type State = 'idle' | 'countin' | 'running' | 'done';

const LEAD_MS = 140;
const HORIZON_MS = 180;

export class Engine {
  readonly model: Model;
  cfg: EngineConfig;
  status: Int8Array;
  state: State = 'idle';
  /** Song position in quarter notes (what the screen shows). */
  pos = 0;
  /** Pass number on screen (0-based). */
  passOnScreen = 0;
  lastResult: PassResult | null = null;
  q0 = 0;
  q1 = 0;
  msPerQ = 500;
  judged: number[] = [];
  other: number[] = [];
  inRange: number[] = [];
  /** Recent wrong keys, for the keyboard flash: midi → until (ms). */
  wrongs = new Map<number, number>();

  private listeners = new Set<(e: EngineEvent) => void>();
  private beats: { q: number; accent: boolean }[] = [];
  private countBeats = 0;
  private beatQ = 1;
  private startPerf = 0;
  private countInMs = 0;
  private spanMs = 0;
  private maxPasses = 1;
  private schedUntil = 0;
  private outLat = 0;
  private ref = { perf: 0, ctx: 0 };
  private expected: Expect[] = [];
  private generated = -1;
  private finalized = -1;
  private stats = new Map<number, { wrong: number; wrongBars: Map<number, number>; devs: number[] }>();
  private lastCount = -1;
  private timer: number | null = null;
  // learn
  private targets: Target[] = [];
  private ti = 0;
  private pressed = new Set<number>();
  private wrongHere = false;
  private learn = { correct: 0, wrong: 0, done: 0, perBar: new Map<number, [number, number, number]>(), active: 0, last: 0 };
  private anim = { from: 0, to: 0, start: 0 };

  /** How long each note sounds, in quarters: its length, or until the pedal lifts. */
  private soundQ: Float64Array;

  constructor(model: Model, cfg: EngineConfig) {
    this.model = model;
    this.cfg = cfg;
    this.status = new Int8Array(model.notes.length);
    this.soundQ = new Float64Array(model.notes.length);
    const pedal = model.pedal ?? [];
    model.notes.forEach((n, i) => {
      const end = n[0] + n[1];
      let until = end;
      for (const [a, b] of pedal) {
        if (a > end + 1e-6) break;
        if (b > end + 1e-6 && a <= end + 1e-6) until = Math.max(until, b);
      }
      this.soundQ[i] = until - n[0];
    });
    this.configure(cfg);
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /* ------------------------------------------------------------- range */

  barIndex(n: number): number {
    const bars = this.model.bars;
    for (let i = 0; i < bars.length; i++) if ((bars[i]?.n ?? -1) === n) return i;
    return n <= (bars[0]?.n ?? 0) ? 0 : bars.length - 1;
  }

  /** The bar index at a song time (quarter notes). */
  barAt(q: number): number {
    const bars = this.model.bars;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((bars[mid]?.t ?? 0) <= q + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  judges(hand: number): boolean {
    const h = this.cfg.hands;
    return h === 'both' || (h === 'right' && hand === 0) || (h === 'left' && hand === 1);
  }

  configure(next: Partial<EngineConfig>): void {
    if (this.state !== 'idle' && this.state !== 'done') this.stop(false);
    this.cfg = { ...this.cfg, ...next };
    const m = this.model;
    const i0 = this.barIndex(this.cfg.from);
    const i1 = Math.max(i0, this.barIndex(this.cfg.to));
    const b0 = m.bars[i0];
    const b1 = m.bars[i1];
    this.q0 = b0?.t ?? 0;
    this.q1 = (b1?.t ?? 0) + (b1?.len ?? 0);
    this.msPerQ = 60000 / Math.max(10, (m.tempo * this.cfg.tempo) / 100);
    this.judged = [];
    this.other = [];
    this.inRange = [];
    m.notes.forEach((n, i) => {
      if (n[0] < this.q0 - 1e-6 || n[0] >= this.q1 - 1e-6) return;
      this.inRange.push(i);
      if (this.judges(n[3])) this.judged.push(i);
      else this.other.push(i);
    });
    // Metronome beats on the bar grid.
    this.beatQ = m.beat > 0 ? m.beat : 1;
    this.beats = [];
    for (let i = i0; i <= i1; i++) {
      const b = m.bars[i];
      if (b === undefined) continue;
      const full = m.meter.q > 0 ? m.meter.q : b.len;
      const offset = b.len < full - 1e-6 && i === 0 ? full - b.len : 0;
      for (let k = 0; k * this.beatQ < full - 1e-6; k++) {
        const q = b.t - offset + k * this.beatQ;
        if (q < b.t - 1e-6) continue;
        this.beats.push({ q, accent: k === 0 });
      }
    }
    const barQ = m.meter.q > 0 ? m.meter.q : 4;
    this.countBeats = Math.max(1, Math.round(barQ / this.beatQ));
    this.resetStatus();
    this.pos = this.q0;
    this.targets = this.cfg.mode === 'learn' ? this.buildTargets() : [];
    this.ti = 0;
    if (this.targets.length > 0) this.pos = this.targets[0]?.q ?? this.q0;
    this.emit({ type: 'state' });
  }

  private resetStatus(): void {
    for (const i of this.inRange) this.status[i] = ST_PENDING;
  }

  get running(): boolean {
    return this.state === 'countin' || this.state === 'running';
  }

  /** 0..1 through the current pass (for the bar strip). */
  progress(): number {
    if (this.q1 <= this.q0) return 0;
    return Math.max(0, Math.min(1, (this.pos - this.q0) / (this.q1 - this.q0)));
  }

  /* ---------------------------------------------------------- transport */

  start(): void {
    if (this.running) return;
    audio.ensure();
    this.wrongs.clear();
    if (this.cfg.mode === 'learn') this.startLearn();
    else this.startTimed();
    this.emit({ type: 'state' });
  }

  toggle(): void {
    if (this.running) this.stop(true);
    else this.start();
  }

  /** Stop. A pass cut short still reports its time (complete = false). */
  stop(report = true): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const was = this.state;
    audio.stopAll();
    if (this.cfg.mode === 'learn') {
      if (was === 'running' && report && this.learn.done > 0) this.finishLearn(false);
      this.state = 'idle';
      this.emit({ type: 'state' });
      return;
    }
    if ((was === 'running' || was === 'countin') && report) {
      const now = performance.now();
      const k = this.finalized + 1;
      const elapsed = now - this.outLat - this.passStart(k);
      if (k < this.maxPasses && elapsed > 1500) this.finalizePass(k, false, Math.min(this.spanMs, elapsed));
    }
    this.state = 'idle';
    this.expected = [];
    this.pos = this.q0;
    this.resetStatus();
    this.emit({ type: 'state' });
  }

  private passStart(k: number): number {
    return this.startPerf + this.countInMs + k * this.spanMs;
  }

  private ctxAt(perf: number): number {
    return this.ref.ctx + (perf - this.ref.perf) / 1000;
  }

  private startTimed(): void {
    const now = performance.now();
    this.outLat = audio.outputLatency() * 1000;
    this.ref = { perf: now, ctx: audio.now() };
    this.startPerf = now + LEAD_MS;
    const countIn = this.cfg.mode === 'play' && this.cfg.countIn;
    this.countInMs = countIn ? this.countBeats * this.beatQ * this.msPerQ : 0;
    this.spanMs = Math.max(1, (this.q1 - this.q0) * this.msPerQ);
    this.maxPasses = this.cfg.loop ? 100000 : 1;
    this.schedUntil = this.startPerf - 1;
    this.expected = [];
    this.stats.clear();
    this.generated = -1;
    this.finalized = -1;
    this.passOnScreen = 0;
    this.lastCount = -1;
    this.resetStatus();
    this.state = this.countInMs > 0 ? 'countin' : 'running';
    if (this.cfg.mode === 'play') this.generate(0);
    this.schedule(now);
    // Keep scheduling when the page's frames slow down.
    this.timer = window.setInterval(() => this.schedule(performance.now()), 25);
  }

  /** Audio for the next few hundred milliseconds: notes and clicks. */
  private schedule(now: number): void {
    if (!this.running) return;
    const horizon = now + HORIZON_MS;
    if (this.schedUntil >= horizon) return;
    const from = this.schedUntil;
    const to = horizon;
    const notes = this.model.notes;
    const msPerQ = this.msPerQ;
    if (this.countInMs > 0) {
      for (let j = 0; j < this.countBeats; j++) {
        const t = this.startPerf + j * this.beatQ * msPerQ;
        if (t > from && t <= to) audio.click(this.ctxAt(t), j === 0);
      }
    }
    const listen = this.cfg.mode === 'listen';
    const audible = listen ? (this.cfg.otherHand || this.cfg.hands === 'both' ? this.inRange : this.judged) : this.cfg.otherHand ? this.other : [];
    const clicks = this.cfg.metronome && (this.cfg.mode === 'play' || listen);
    let k = Math.max(0, Math.floor((from - this.startPerf - this.countInMs) / this.spanMs));
    for (; k < this.maxPasses; k++) {
      const base = this.passStart(k);
      if (base > to) break;
      if (base + this.spanMs < from) continue;
      for (const i of audible) {
        const n = notes[i];
        if (n === undefined) continue;
        const t = base + (n[0] - this.q0) * msPerQ;
        if (t > from && t <= to) audio.play(n[2], n[5], this.ctxAt(t), ((this.soundQ[i] ?? n[1]) * msPerQ) / 1000);
      }
      if (clicks) {
        for (const b of this.beats) {
          const t = base + (b.q - this.q0) * msPerQ;
          if (t > from && t <= to) audio.click(this.ctxAt(t), b.accent);
        }
      }
    }
    this.schedUntil = horizon;
  }

  /** The notes to judge in pass k. */
  private generate(k: number): void {
    if (k <= this.generated || k >= this.maxPasses) return;
    this.generated = k;
    const base = this.passStart(k);
    const notes = this.model.notes;
    for (const i of this.judged) {
      const n = notes[i];
      if (n === undefined) continue;
      this.expected.push({ i, pass: k, t: base + (n[0] - this.q0) * this.msPerQ + this.outLat, p: n[2], n: this.model.bars[n[7]]?.n ?? 0, hand: n[3], group: Math.round(n[0] * 1000), matched: false, missed: false });
    }
    this.stats.set(k, { wrong: 0, wrongBars: new Map(), devs: [] });
  }

  private window(): number {
    // Fast passages get a tighter window, so a note is not taken for its neighbour.
    return WINDOW_MS[this.cfg.strictness];
  }

  /** Called every animation frame. */
  frame(now: number): void {
    for (const [m, until] of this.wrongs) if (until < now) this.wrongs.delete(m);
    if (this.cfg.mode === 'learn') {
      if (this.state === 'running') {
        const k = Math.min(1, (now - this.anim.start) / 180);
        const e = 1 - (1 - k) ** 3;
        this.pos = this.anim.from + (this.anim.to - this.anim.from) * e;
      }
      return;
    }
    if (!this.running) return;
    this.schedule(now);
    const vis = now - this.outLat;
    const startQ = this.startPerf + this.countInMs;
    if (vis < startQ) {
      this.pos = this.q0 - (startQ - vis) / this.msPerQ;
      const beat = Math.floor((vis - this.startPerf) / (this.beatQ * this.msPerQ));
      if (beat >= 0 && beat !== this.lastCount && beat < this.countBeats) {
        this.lastCount = beat;
        this.emit({ type: 'count', beat: beat + 1, of: this.countBeats });
      }
    } else {
      if (this.state === 'countin') {
        this.state = 'running';
        this.emit({ type: 'state' });
      }
      const k = Math.floor((vis - startQ) / this.spanMs);
      if (k >= this.maxPasses) this.pos = this.q1;
      else {
        if (k !== this.passOnScreen) {
          this.passOnScreen = k;
          this.resetStatus();
        }
        this.pos = this.q0 + (vis - this.passStart(k)) / this.msPerQ;
        if (this.cfg.mode === 'listen') this.markPlayed();
      }
    }
    if (this.cfg.mode === 'play') {
      const w = this.window();
      // The next pass's notes, as soon as an early press could reach them.
      const next = this.generated + 1;
      if (next < this.maxPasses && now >= this.passStart(next) - w - 60) this.generate(next);
      for (const e of this.expected) {
        if (!e.matched && !e.missed && now > e.t + w) {
          e.missed = true;
          if (e.pass === this.passOnScreen) this.status[e.i] = ST_MISS;
          this.emit({ type: 'miss', note: e.i });
        }
      }
    }
    // A pass is over once its last note's window has closed.
    const k = this.finalized + 1;
    if (k < this.maxPasses && now > this.passStart(k) + this.spanMs + this.outLat + this.window() + 30) {
      this.finalizePass(k, true, this.spanMs);
      if (k + 1 >= this.maxPasses) {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        this.state = 'done';
        this.pos = this.q1;
        this.emit({ type: 'state' });
      }
    }
  }

  private markPlayed(): void {
    const notes = this.model.notes;
    for (const i of this.inRange) {
      const n = notes[i];
      if (n !== undefined && n[0] <= this.pos && this.status[i] === ST_PENDING) this.status[i] = ST_HIT;
    }
  }

  private finalizePass(k: number, complete: boolean, durationMs: number): void {
    this.finalized = k;
    const mine = this.expected.filter((e) => e.pass === k);
    this.expected = this.expected.filter((e) => e.pass !== k);
    const st = this.stats.get(k) ?? { wrong: 0, wrongBars: new Map<number, number>(), devs: [] };
    this.stats.delete(k);
    const bars = new Map<number, [number, number, number, number]>();
    let hits = 0;
    let missed = 0;
    let counted = 0;
    const cutoff = complete ? Infinity : this.passStart(k) + durationMs + this.outLat;
    for (const e of mine) {
      if (!complete && e.t > cutoff) continue;
      counted += 1;
      const b = bars.get(e.n) ?? [0, 0, 0, 0];
      b[0] += 1;
      if (e.matched) {
        b[1] += 1;
        hits += 1;
      } else {
        b[3] += 1;
        missed += 1;
      }
      bars.set(e.n, b);
    }
    for (const [n, w] of st.wrongBars) {
      const b = bars.get(n) ?? [0, 0, 0, 0];
      b[2] += w;
      bars.set(n, b);
    }
    const devs = st.devs;
    const mad = devs.length > 0 ? devs.reduce((a, d) => a + Math.abs(d), 0) / devs.length : null;
    const bias = devs.length > 0 ? devs.reduce((a, d) => a + d, 0) / devs.length : null;
    const listen = this.cfg.mode === 'listen';
    const expected = listen ? 0 : counted;
    const accuracy = expected + st.wrong > 0 ? hits / (expected + st.wrong) : 0;
    const result: PassResult = {
      mode: this.cfg.mode,
      from: this.cfg.from,
      to: this.cfg.to,
      hands: this.cfg.hands,
      tempo: this.cfg.tempo,
      durationMs: Math.round(durationMs + (k === 0 ? this.countInMs : 0)),
      expected,
      hits: listen ? 0 : hits,
      wrong: listen ? 0 : st.wrong,
      missed: listen ? 0 : missed,
      mad: mad === null ? null : Math.round(mad),
      bias: bias === null ? null : Math.round(bias),
      perBar: listen ? [] : [...bars.entries()].sort((a, b) => a[0] - b[0]).map(([n, v]) => [n, v[0], v[1], v[2], v[3]]),
      complete,
      accuracy,
      clean: complete && !listen && expected > 0 && accuracy >= CLEAN[this.cfg.strictness],
      pass: k,
    };
    this.lastResult = result;
    this.emit({ type: 'pass', result });
  }

  /* -------------------------------------------------------------- input */

  input(ev: NoteEvent): void {
    if (!ev.on) return;
    if (this.cfg.mode === 'learn') {
      this.inputLearn(ev);
      return;
    }
    if (this.cfg.mode !== 'play' || !this.running) return;
    const t = ev.t - this.cfg.latencyMs;
    const w = this.window();
    let best: Expect | null = null;
    let bestD = Infinity;
    for (const e of this.expected) {
      if (e.matched || e.missed) continue;
      const same = this.cfg.anyPitch === true || e.p === ev.note || (this.cfg.mic && (e.p - ev.note) % 12 === 0);
      if (!same) continue;
      const d = Math.abs(t - e.t);
      if (d <= w && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (best === null && this.cfg.mic) {
      // The microphone hears one note of a chord: any note of it counts.
      for (const e of this.expected) {
        if (e.matched || e.missed) continue;
        const d = Math.abs(t - e.t);
        if (d > w || d >= bestD) continue;
        const chord = this.expected.some((x) => x !== e && x.group === e.group && x.pass === e.pass && x.p === ev.note);
        if (chord) {
          best = e;
          bestD = d;
        }
      }
    }
    if (best !== null) {
      const hit = best;
      const group = this.cfg.mic ? this.expected.filter((x) => x.pass === hit.pass && x.group === hit.group && !x.matched && !x.missed) : [hit];
      for (const e of group) {
        e.matched = true;
        if (e.pass === this.passOnScreen) this.status[e.i] = ST_HIT;
      }
      const dev = t - hit.t;
      this.stats.get(hit.pass)?.devs.push(dev);
      this.emit({ type: 'hit', note: hit.i, midi: ev.note, hand: hit.hand, dev });
      return;
    }
    // A wrong note: counted in the pass and bar it fell in.
    const vis = t - this.outLat;
    const k = Math.floor((vis - this.startPerf - this.countInMs) / this.spanMs);
    if (k < 0 && vis < this.startPerf + this.countInMs - w) return;
    const kk = Math.max(0, k);
    if (kk >= this.maxPasses || kk <= this.finalized) return;
    const q = this.q0 + (vis - this.passStart(kk)) / this.msPerQ;
    const n = this.model.bars[this.barAt(Math.max(this.q0, Math.min(this.q1 - 1e-3, q)))]?.n ?? 0;
    const st = this.stats.get(kk);
    if (st !== undefined) {
      st.wrong += 1;
      st.wrongBars.set(n, (st.wrongBars.get(n) ?? 0) + 1);
    }
    this.wrongs.set(ev.note, performance.now() + 260);
    this.emit({ type: 'wrong', midi: ev.note });
  }

  /* -------------------------------------------------------------- learn */

  private buildTargets(): Target[] {
    const out: Target[] = [];
    const notes = this.model.notes;
    for (const i of this.judged) {
      const n = notes[i];
      if (n === undefined) continue;
      const last = out[out.length - 1];
      if (last !== undefined && Math.abs(last.q - n[0]) < 1e-3) {
        last.idx.push(i);
        last.pitches.add(n[2]);
      } else out.push({ q: n[0], idx: [i], pitches: new Set([n[2]]), n: this.model.bars[n[7]]?.n ?? 0 });
    }
    return out;
  }

  /** The keys the learner must press now (learn mode). */
  currentTarget(): Target | null {
    if (this.cfg.mode !== 'learn') return null;
    return this.targets[this.ti] ?? null;
  }

  targetCount(): number {
    return this.targets.length;
  }

  targetIndex(): number {
    return this.ti;
  }

  private startLearn(): void {
    if (this.targets.length === 0) return;
    if (this.ti >= this.targets.length || this.state === 'done') {
      this.ti = 0;
      this.resetStatus();
    }
    const now = performance.now();
    this.learn = { correct: 0, wrong: 0, done: 0, perBar: new Map(), active: 0, last: now };
    this.msPerQ = 60000 / Math.max(10, (this.model.tempo * this.cfg.tempo) / 100);
    this.state = 'running';
    this.pressed.clear();
    this.wrongHere = false;
    this.moveTo(this.targets[this.ti]?.q ?? this.q0);
  }

  /** Jump the learn cursor to a bar. */
  jumpTo(n: number): void {
    if (this.cfg.mode !== 'learn') return;
    const i = this.targets.findIndex((t) => t.n >= n);
    if (i < 0) return;
    this.ti = i;
    this.pressed.clear();
    this.wrongHere = false;
    for (const t of this.targets.slice(i)) for (const x of t.idx) this.status[x] = ST_PENDING;
    this.moveTo(this.targets[i]?.q ?? this.q0);
    this.emit({ type: 'state' });
  }

  private moveTo(q: number): void {
    this.anim = { from: this.pos, to: q, start: performance.now() };
  }

  private inputLearn(ev: NoteEvent): void {
    if (this.state !== 'running') return;
    const tgt = this.targets[this.ti];
    if (tgt === undefined) return;
    const now = performance.now();
    this.learn.active += Math.min(15000, now - this.learn.last);
    this.learn.last = now;
    let pitch = ev.note;
    if (this.cfg.anyPitch === true && !tgt.pitches.has(pitch)) pitch = tgt.pitches.values().next().value ?? pitch;
    if (this.cfg.mic && !tgt.pitches.has(pitch)) {
      // One note heard of a chord, or the right note an octave off.
      for (const p of tgt.pitches) if ((p - pitch) % 12 === 0) pitch = p;
    }
    if (tgt.pitches.has(pitch)) {
      if (this.pressed.has(pitch)) return;
      this.pressed.add(pitch);
      const notes = this.model.notes;
      for (const i of tgt.idx) {
        const n = notes[i];
        if (n !== undefined && n[2] === pitch) {
          this.status[i] = ST_HIT;
          this.emit({ type: 'hit', note: i, midi: pitch, hand: n[3], dev: 0 });
        }
      }
      if (this.pressed.size >= tgt.pitches.size || this.cfg.mic || this.cfg.anyPitch === true) this.advance(tgt);
      return;
    }
    this.wrongHere = true;
    this.learn.wrong += 1;
    const b = this.learn.perBar.get(tgt.n) ?? [0, 0, 0];
    b[2] += 1;
    this.learn.perBar.set(tgt.n, b);
    this.wrongs.set(ev.note, now + 260);
    this.emit({ type: 'wrong', midi: ev.note });
  }

  private advance(tgt: Target): void {
    const b = this.learn.perBar.get(tgt.n) ?? [0, 0, 0];
    b[0] += 1;
    if (!this.wrongHere) {
      b[1] += 1;
      this.learn.correct += 1;
    }
    this.learn.perBar.set(tgt.n, b);
    this.learn.done += 1;
    const notes = this.model.notes;
    for (const i of tgt.idx) this.status[i] = ST_HIT;
    const next = this.targets[this.ti + 1];
    // The other hand plays the notes between this chord and the next.
    if (this.cfg.otherHand && this.other.length > 0) {
      const until = next !== undefined ? next.q : this.q1;
      const now = audio.now() + 0.02;
      for (const i of this.other) {
        const n = notes[i];
        if (n === undefined || n[0] < tgt.q - 1e-6 || n[0] >= until - 1e-6) continue;
        audio.play(n[2], n[5], now + ((n[0] - tgt.q) * this.msPerQ) / 1000, Math.min(this.soundQ[i] ?? n[1], until - n[0] + 0.5) * (this.msPerQ / 1000));
      }
    }
    this.ti += 1;
    this.pressed.clear();
    this.wrongHere = false;
    if (next === undefined) {
      this.finishLearn(true);
      if (this.cfg.loop) {
        this.ti = 0;
        this.resetStatus();
        this.learn = { correct: 0, wrong: 0, done: 0, perBar: new Map(), active: 0, last: performance.now() };
        this.moveTo(this.targets[0]?.q ?? this.q0);
      } else {
        this.state = 'done';
        this.moveTo(this.q1);
      }
      this.emit({ type: 'state' });
      return;
    }
    this.moveTo(next.q);
  }

  private finishLearn(complete: boolean): void {
    const L = this.learn;
    const expected = complete ? this.targets.length : L.done;
    const result: PassResult = {
      mode: 'learn',
      from: this.cfg.from,
      to: this.cfg.to,
      hands: this.cfg.hands,
      tempo: this.cfg.tempo,
      durationMs: Math.round(L.active + Math.min(15000, performance.now() - L.last)),
      expected,
      hits: L.correct,
      wrong: L.wrong,
      missed: 0,
      mad: null,
      bias: null,
      perBar: [...L.perBar.entries()].sort((a, b) => a[0] - b[0]).map(([n, v]) => [n, v[0], v[1], v[2], 0]),
      complete,
      accuracy: expected > 0 ? L.correct / expected : 0,
      clean: false,
      pass: 0,
    };
    this.lastResult = result;
    this.emit({ type: 'pass', result });
  }

  /* --------------------------------------------------------- what to show */

  /** Notes to play next, for the cues on the keys: midi → [hand, finger]. */
  cues(): Map<number, [number, number]> {
    const out = new Map<number, [number, number]>();
    const notes = this.model.notes;
    if (this.cfg.mode === 'learn') {
      const t = this.targets[this.ti];
      if (t === undefined || this.state === 'done') return out;
      for (const i of t.idx) {
        const n = notes[i];
        if (n !== undefined && !this.pressed.has(n[2])) out.set(n[2], [n[3], n[4]]);
      }
      return out;
    }
    if (this.cfg.mode === 'listen') {
      for (const i of this.inRange) {
        const n = notes[i];
        if (n !== undefined && n[0] <= this.pos && this.pos < n[0] + n[1] && (this.cfg.otherHand || this.judges(n[3]))) out.set(n[2], [n[3], n[4]]);
      }
      return out;
    }
    const ahead = Math.min(0.75, this.beatQ * 0.75);
    for (const i of this.judged) {
      const n = notes[i];
      if (n === undefined) continue;
      if (n[0] >= this.pos - 0.08 && n[0] <= this.pos + ahead && this.status[i] === ST_PENDING) out.set(n[2], [n[3], n[4]]);
    }
    return out;
  }

  /** Bar and beat at the cursor (for the readout). */
  where(): { bar: number; beat: number } {
    const q = Math.max(this.q0, this.pos);
    const i = this.barAt(q);
    const b = this.model.bars[i];
    if (b === undefined) return { bar: 0, beat: 1 };
    return { bar: b.n, beat: Math.floor((q - b.t) / this.beatQ + 1e-6) + 1 };
  }

  /** Beats per minute of the beat a person counts. */
  bpm(): number {
    return Math.round(((this.model.tempo * this.cfg.tempo) / 100) / this.beatQ);
  }

  dispose(): void {
    this.stop(false);
    this.listeners.clear();
  }
}

/**
 * The microphone, for acoustic pianos: listens for one note at a time.
 *
 * Every ~23 ms it takes the latest 2048 samples (downsampled by two), finds
 * the pitch with the YIN method, and reports a note when a new pitch holds
 * steady for two frames or the sound gets suddenly louder (a new strike of
 * the same key). Chords are heard as one of their notes, so the practice
 * screen accepts any note of a chord from the microphone.
 */

export type MicStatus = 'off' | 'starting' | 'on' | 'denied' | 'blocked' | 'missing' | 'unsupported';

export interface MicNote {
  on: boolean;
  note: number;
  vel: number;
  t: number;
}

const FRAME_MS = 23;

function frameAllows(feature: string): boolean {
  const d = document as Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };
  const pol = d.permissionsPolicy ?? d.featurePolicy;
  if (pol === undefined) return true;
  try {
    return pol.allowsFeature(feature);
  } catch {
    return true;
  }
}

/** YIN pitch (Hz) of a buffer, or 0 when there is no clear pitch. */
function yin(buf: Float32Array, rate: number, minHz = 50, maxHz = 2100): { hz: number; clarity: number } {
  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(rate / maxHz));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(rate / minHz));
  const half = n - tauMax;
  const d = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const x = (buf[i] ?? 0) - (buf[i + tau] ?? 0);
      sum += x * x;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau] ?? 0;
    cmnd[tau] = tau < tauMin ? 1 : ((d[tau] ?? 0) * tau) / (running || 1);
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if ((cmnd[tau] ?? 1) < 0.15) {
      while (tau + 1 <= tauMax && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return { hz: 0, clarity: 0 };
  const a = cmnd[best - 1] ?? cmnd[best] ?? 1;
  const b = cmnd[best] ?? 1;
  const c = cmnd[best + 1] ?? b;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  return { hz: rate / (best + shift), clarity: 1 - b };
}

export class Mic {
  status: MicStatus = 'off';
  level = 0;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: number | null = null;
  private buf = new Float32Array(4096);
  private small = new Float32Array(2048);
  private current = -1;
  private candidate = -1;
  private candidateFrames = 0;
  private lastRms = 0;
  private floor = 0.004;
  onNote: (n: MicNote) => void = () => undefined;
  onStatus: (s: MicStatus) => void = () => undefined;

  private set(s: MicStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  async start(): Promise<MicStatus> {
    if (this.status === 'on' || this.status === 'starting') return this.status;
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      this.set('unsupported');
      return this.status;
    }
    if (!frameAllows('microphone')) {
      this.set('blocked');
      return this.status;
    }
    this.set('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      this.set(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : name === 'SecurityError' ? 'blocked' : 'denied');
      return this.status;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.timer = window.setInterval(() => this.tick(), FRAME_MS);
    this.set('on');
    return this.status;
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.current >= 0) this.onNote({ on: false, note: this.current, vel: 0, t: performance.now() });
    this.current = -1;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.level = 0;
    if (this.status === 'on' || this.status === 'starting') this.set('off');
  }

  private tick(): void {
    const an = this.analyser;
    const ctx = this.ctx;
    if (an === null || ctx === null) return;
    an.getFloatTimeDomainData(this.buf);
    // Downsample by two (the band that matters for piano pitch stays).
    let sum = 0;
    for (let i = 0; i < 2048; i++) {
      const v = ((this.buf[2 * i] ?? 0) + (this.buf[2 * i + 1] ?? 0)) * 0.5;
      this.small[i] = v;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / 2048);
    this.level = Math.min(1, rms * 8);
    // Track the room's noise floor slowly.
    if (rms < this.floor * 1.5) this.floor = this.floor * 0.98 + rms * 0.02;
    const now = performance.now() - ((2048 / ctx.sampleRate) * 1000) / 2;
    const gate = Math.max(0.006, this.floor * 3);
    if (rms < gate) {
      if (this.current >= 0 && rms < gate * 0.7) {
        this.onNote({ on: false, note: this.current, vel: 0, t: now });
        this.current = -1;
      }
      this.candidate = -1;
      this.candidateFrames = 0;
      this.lastRms = rms;
      return;
    }
    const { hz, clarity } = yin(this.small, ctx.sampleRate / 2);
    const attack = rms > this.lastRms * 1.8 && rms > gate * 1.5;
    this.lastRms = rms;
    if (hz <= 0 || clarity < 0.75) return;
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    if (midi < 21 || midi > 108) return;
    const vel = Math.max(20, Math.min(127, Math.round(rms * 900)));
    if (midi === this.current) {
      // The same key struck again.
      if (attack) {
        this.onNote({ on: false, note: midi, vel: 0, t: now });
        this.onNote({ on: true, note: midi, vel, t: now });
      }
      return;
    }
    if (midi === this.candidate) this.candidateFrames += 1;
    else {
      this.candidate = midi;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames >= 2 || attack) {
      if (this.current >= 0) this.onNote({ on: false, note: this.current, vel: 0, t: now });
      this.current = midi;
      this.candidate = -1;
      this.candidateFrames = 0;
      this.onNote({ on: true, note: midi, vel, t: now - FRAME_MS });
    }
  }
}

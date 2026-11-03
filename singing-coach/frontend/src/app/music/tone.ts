/**
 * Two tone measures for the Tone lab, read from the microphone while a vowel
 * is held. Both depend on the microphone, the room and the distance, so the
 * lab only ever compares takes of one sitting on one device, against the
 * first, and never stores them.
 *
 *   brightness   the singing power ratio (Omori 1996): the strongest
 *                harmonic between 2 and 4 kHz against the strongest below
 *                2 kHz, in dB. More "ring", less negative.
 *   clarity      the cepstral peak prominence (Hillenbrand 1994): how far
 *                the pitch peak of the cepstrum stands above its trend
 *                line, in dB. A clearer, less breathy tone, higher.
 */
import { audio } from './audio.ts';
import { mic } from './mic.ts';

export interface ToneSample {
  /** Singing power ratio, dB (negative; nearer 0 is brighter). */
  spr: number;
  /** Cepstral peak prominence, dB. */
  cpp: number;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export class ToneMeter {
  private an: AnalyserNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private spec: Float32Array<ArrayBuffer> | null = null;

  /** Taps the microphone (it must be on). */
  open(): boolean {
    if (this.an !== null) return true;
    const stream = mic.stream;
    if (stream === null) return false;
    const ctx = audio.ensure();
    this.src = ctx.createMediaStreamSource(stream);
    this.an = ctx.createAnalyser();
    this.an.fftSize = 4096;
    this.an.smoothingTimeConstant = 0;
    this.src.connect(this.an);
    this.spec = new Float32Array(this.an.frequencyBinCount);
    return true;
  }

  close(): void {
    this.src?.disconnect();
    this.an?.disconnect();
    this.src = null;
    this.an = null;
    this.spec = null;
  }

  /** One frame's measures, given the sung pitch (Hz); null when the frame is unusable. */
  read(f0: number): ToneSample | null {
    const an = this.an;
    const X = this.spec;
    if (an === null || X === null || !(f0 > 50 && f0 < 1400)) return null;
    an.getFloatFrequencyData(X);
    const sr = an.context.sampleRate;
    const bins = X.length;
    const hzPerBin = sr / an.fftSize;
    let low = -200;
    let high = -200;
    for (let k = Math.max(1, Math.floor(70 / hzPerBin)); k < bins; k++) {
      const hz = k * hzPerBin;
      const v = Number.isFinite(X[k]!) ? X[k]! : -200;
      if (hz < 2000) low = Math.max(low, v);
      else if (hz <= 4000) high = Math.max(high, v);
      else break;
    }
    if (low < -100) return null;
    // Cepstrum of the dB spectrum (mirrored to a full, real, even sequence).
    const n = an.fftSize;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let k = 0; k < bins; k++) {
      const v = Number.isFinite(X[k]!) ? Math.max(-160, X[k]!) : -160;
      re[k] = v;
      if (k > 0) re[n - k] = v;
    }
    re[bins] = re[bins - 1]!;
    fft(re, im);
    const qMin = Math.floor(sr / 1400);
    const qMax = Math.min(n / 2 - 1, Math.ceil(sr / 55));
    const c = new Float64Array(qMax + 1);
    for (let q = qMin; q <= qMax; q++) c[q] = 10 * Math.log10(re[q]! * re[q]! + im[q]! * im[q]! + 1e-12);
    // The peak near the sung pitch's period.
    const q0 = sr / f0;
    let peak = -1;
    for (let q = Math.max(qMin, Math.floor(q0 * 0.9)); q <= Math.min(qMax, Math.ceil(q0 * 1.1)); q++) if (peak < 0 || c[q]! > c[peak]!) peak = q;
    if (peak < 0) return null;
    // Trend line over the searched quefrencies (least squares).
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let cnt = 0;
    for (let q = qMin; q <= qMax; q++) {
      sx += q;
      sy += c[q]!;
      sxx += q * q;
      sxy += q * c[q]!;
      cnt += 1;
    }
    const slope = (cnt * sxy - sx * sy) / Math.max(1e-9, cnt * sxx - sx * sx);
    const icpt = (sy - slope * sx) / cnt;
    return { spr: high - low, cpp: c[peak]! - (slope * peak + icpt) };
  }
}

/** The median of each measure over a take's frames. */
export function summarise(frames: ToneSample[]): ToneSample | null {
  if (frames.length < 8) return null;
  const med = (xs: number[]): number => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  return { spr: Math.round(med(frames.map((f) => f.spr)) * 10) / 10, cpp: Math.round(med(frames.map((f) => f.cpp)) * 10) / 10 };
}

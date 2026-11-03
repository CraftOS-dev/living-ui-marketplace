/**
 * Pitch of the singing voice: the McLeod Pitch Method (MPM, McLeod & Wyvill
 * 2005), the same method as the 0BSD `pitchy` library, written here so it
 * runs inside an AudioWorklet without imports.
 *
 * The signal is averaged down by two (to 24 kHz at a 48 kHz context: the
 * voice's fundamental never comes near the new Nyquist), a 1024-sample
 * window (about 43 ms, reaching below 50 Hz) is analysed every 256 samples
 * (about 10.7 ms of the original), and each analysis gives the pitch, a
 * clarity from 0 to 1 (the normalised square difference at the chosen peak:
 * how periodic the sound is) and the loudness in dBFS.
 *
 * The worklet posts {t, hz, clarity, db}: t is the context time at the
 * centre of the analysed window, so frames line up with sounds scheduled on
 * the same AudioContext.
 */

export interface RawFrame {
  /** Context time (s) at the centre of the analysed window. */
  t: number;
  hz: number;
  clarity: number;
  db: number;
}

/** MPM on a buffer: pitch in Hz (0 when none) and clarity 0..1. */
export function mpm(buf: Float32Array, rate: number, minHz = 50, maxHz = 1500, k = 0.9): { hz: number; clarity: number } {
  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(rate / maxHz));
  const tauMax = Math.min(n - 2, Math.ceil(rate / minHz));
  const nsdf = new Float32Array(tauMax + 2);
  // Running energy: m(tau) = sum of x[i]^2 over the first n-tau samples plus over the last n-tau.
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + (buf[i] ?? 0) * (buf[i] ?? 0);
  for (let tau = 0; tau <= tauMax + 1; tau++) {
    let acf = 0;
    for (let i = 0; i < n - tau; i++) acf += (buf[i] ?? 0) * (buf[i + tau] ?? 0);
    const m = pre[n - tau]! + pre[n]! - pre[tau]!;
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // Key maxima: the highest point between each positive-going zero crossing and the next negative one.
  const peaks: number[] = [];
  let pos = 0;
  while (pos < tauMax && (nsdf[pos] ?? 0) > 0) pos++;
  while (pos < tauMax && (nsdf[pos] ?? 0) <= 0) pos++;
  if (pos < tauMin) pos = tauMin;
  let best = -1;
  for (; pos <= tauMax; pos++) {
    const v = nsdf[pos] ?? 0;
    if (v > 0) {
      if (best < 0 || v > (nsdf[best] ?? 0)) best = pos;
    } else if (best >= 0) {
      peaks.push(best);
      best = -1;
    }
  }
  if (best >= 0) peaks.push(best);
  if (peaks.length === 0) return { hz: 0, clarity: 0 };
  let top = 0;
  for (const p of peaks) top = Math.max(top, nsdf[p] ?? 0);
  const cut = top * k;
  let chosen = peaks[0] ?? 0;
  for (const p of peaks) {
    if ((nsdf[p] ?? 0) >= cut) {
      chosen = p;
      break;
    }
  }
  // Parabolic interpolation around the chosen lag.
  const a = nsdf[chosen - 1] ?? nsdf[chosen] ?? 0;
  const b = nsdf[chosen] ?? 0;
  const c = nsdf[chosen + 1] ?? b;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (a - c) / (2 * den) : 0;
  const peak = b - ((a - c) * shift) / 4;
  const tau = chosen + shift;
  if (tau <= 0) return { hz: 0, clarity: 0 };
  return { hz: rate / tau, clarity: Math.max(0, Math.min(1, peak)) };
}

/**
 * The AudioWorklet processor, as source text (loaded from a Blob URL, so the
 * build needs no separate entry). It keeps a ring of downsampled samples and
 * analyses the latest window every hop.
 */
export const WORKLET_SOURCE = `
const WIN = 1024;
const HOP = 256;
const pre = new Float64Array(WIN + 1);
let nsdf = new Float32Array(0);
function mpm(buf, rate) {
  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(rate / 1500));
  const tauMax = Math.min(n - 2, Math.ceil(rate / 55));
  if (nsdf.length < tauMax + 2) nsdf = new Float32Array(tauMax + 2);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + buf[i] * buf[i];
  for (let tau = 0; tau <= tauMax + 1; tau++) {
    let acf = 0;
    const end = n - tau;
    for (let i = 0; i < end; i++) acf += buf[i] * buf[i + tau];
    const m = pre[n - tau] + pre[n] - pre[tau];
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  const peaks = [];
  let pos = 0;
  while (pos < tauMax && nsdf[pos] > 0) pos++;
  while (pos < tauMax && nsdf[pos] <= 0) pos++;
  if (pos < tauMin) pos = tauMin;
  let best = -1;
  for (; pos <= tauMax; pos++) {
    const v = nsdf[pos];
    if (v > 0) { if (best < 0 || v > nsdf[best]) best = pos; }
    else if (best >= 0) { peaks.push(best); best = -1; }
  }
  if (best >= 0) peaks.push(best);
  if (peaks.length === 0) return [0, 0];
  let top = 0;
  for (const p of peaks) top = Math.max(top, nsdf[p]);
  const cut = top * 0.9;
  let chosen = peaks[0];
  for (const p of peaks) { if (nsdf[p] >= cut) { chosen = p; break; } }
  const a = nsdf[chosen - 1] !== undefined ? nsdf[chosen - 1] : nsdf[chosen];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1] !== undefined ? nsdf[chosen + 1] : b;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (a - c) / (2 * den) : 0;
  const peak = b - ((a - c) * shift) / 4;
  const tau = chosen + shift;
  if (tau <= 0) return [0, 0];
  return [rate / tau, Math.max(0, Math.min(1, peak))];
}
class ScPitch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(WIN);
    this.w = 0;
    this.filled = 0;
    this.since = 0;
    this.half = 0;
    this.odd = false;
    this.win = new Float32Array(WIN);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // Average pairs: half the rate.
      if (!this.odd) { this.half = ch[i]; this.odd = true; continue; }
      this.odd = false;
      this.ring[this.w] = (this.half + ch[i]) * 0.5;
      this.w = (this.w + 1) % WIN;
      if (this.filled < WIN) this.filled++;
      this.since++;
    }
    if (this.filled >= WIN && this.since >= HOP) {
      this.since = 0;
      let sum = 0;
      for (let i = 0; i < WIN; i++) { const v = this.ring[(this.w + i) % WIN]; this.win[i] = v; sum += v * v; }
      const rms = Math.sqrt(sum / WIN);
      const db = rms > 1e-7 ? 20 * Math.log10(rms) : -140;
      let hz = 0, clarity = 0;
      if (db > -75) { const r = mpm(this.win, sampleRate / 2); hz = r[0]; clarity = r[1]; }
      // The window ends at the end of this render quantum; its centre is half a window earlier.
      const t = currentTime + ch.length / sampleRate - WIN / (sampleRate / 2) / 2;
      this.port.postMessage({ t: t, hz: hz, clarity: clarity, db: db });
    }
    return true;
  }
}
registerProcessor('sc-pitch', ScPitch);
`;

/** Hz to a fractional MIDI note (69 = A4 = 440 Hz). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Octave-folded error in cents from a target: -600..+600. */
export function foldCents(sungMidi: number, targetMidi: number): number {
  const d = (sungMidi - targetMidi) * 100;
  return ((((d + 600) % 1200) + 1200) % 1200) - 600;
}

/** Octaves between the sung note and the target once folded. */
export function octaveOf(sungMidi: number, targetMidi: number): number {
  const d = (sungMidi - targetMidi) * 100;
  return Math.round((d - foldCents(sungMidi, targetMidi)) / 1200);
}

/**
 * The note held over a stretch of voiced frames (fractional MIDI, ~94 a
 * second), or null when the voice is moving. Vibrato is averaged out over
 * one cycle (16 frames, about 170 ms) first, so a wide vibrato still counts
 * as holding its centre; the averaged pitch must then stay within about half
 * a semitone (10th to 90th percentile). The centre is the median.
 */
export function heldPitch(xs: number[], spread = 0.6): number | null {
  const w = 16;
  if (xs.length < w + 8) return null;
  const smooth: number[] = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
    if (i >= w) sum -= xs[i - w]!;
    if (i >= w - 1) smooth.push(sum / w);
  }
  const s = smooth.slice().sort((a, b) => a - b);
  if (s[Math.floor(s.length * 0.9)]! - s[Math.floor(s.length * 0.1)]! > spread) return null;
  const raw = xs.slice().sort((a, b) => a - b);
  return raw[Math.floor(raw.length / 2)]!;
}

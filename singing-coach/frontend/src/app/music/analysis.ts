/**
 * Listening to a recording, off the main thread: the sung melody as notes on
 * the recording's own beat, its key, and (for a song with music) its chords.
 *
 *   resample   to 22.05 kHz after a 4th-order low-pass; mid (L+R)/2 and
 *              side (L-R)/2 for a stereo file
 *   voice      a stereo mix keeps the voice in the middle: its spectrum is
 *              the mid's minus the side's (instruments panned wide fade)
 *   pitch      just a voice: McLeod pitch (pitch.ts) on the mid signal;
 *              a song with music: harmonic-sum salience of the voice
 *              spectrum's peaks (10-cent bins, 55-1760 Hz, as Melodia does),
 *              followed through each voiced stretch by a Viterbi path over
 *              the five strongest candidates (small steps cheap, octave
 *              leaps dear)
 *   tuning     the recording's offset from A = 440 Hz, taken out
 *   notes      a note changes where the pitch settles somewhere new for 45 ms
 *              or more, or after a gap; a repeated note splits where the
 *              voice strikes again (a jump in its loudness)
 *   beat       spectral flux of the whole recording, its tempo from the
 *              autocorrelation (a prior around 115 BPM), the beats by dynamic
 *              programming (Ellis 2007); a steady track is fitted to one grid
 *   metre      3 or 4, and which beat is the bar's first: where the accents
 *              and the chord changes fall
 *   key        Krumhansl-Kessler profiles over the recording's chroma and the
 *              notes found
 *   chords     per half bar (per bar in 3), major, minor and dominant
 *              seventh templates over the chroma with the bass, the key's own
 *              chords preferred, smoothed by Viterbi
 *
 * A song split into its sources first (separate.ts, mode "stems") is heard
 * as a voice alone for the melody, while the beat comes from the onsets of
 * the drums, bass and other instruments, the chroma from the other
 * instruments, and the bass note of each beat from the bass by itself
 * (harmonic sum over a long window), which allows a wider set of chords
 * (sevenths, sus4, diminished) and inversions (C/E). The key comes from the
 * sung notes alone (how long each pitch is held), not the instruments.
 *
 * Notes come back on the beat grid in quarter notes from bar 1 (a pickup is
 * negative), rounded to sixteenths.
 */
import { mpm } from './pitch.ts';

export interface TranscribeRequest {
  /** The recording (stereo or mono); for "stems", the singer alone (mono). */
  channels: Float32Array[];
  rate: number;
  mode: 'voice' | 'mix' | 'stems';
  /** For "stems": the other sources, mono at `rate`. */
  stems?: { bass: Float32Array; other: Float32Array; drums: Float32Array };
}

export interface TranscribeResult {
  duration: number;
  /** The sung notes in seconds (start, end) and MIDI pitch (tuning taken out). */
  notes: { t: number; e: number; midi: number }[];
  /** Chord changes in seconds (on a beat). */
  chords: { t: number; name: string }[];
  /** Every beat found, in seconds. */
  beats: number[];
  /** The beat that starts bar 1 (the first bar line at or after the first note). */
  downbeat: number;
  meter: 3 | 4;
  bpm: number;
  steady: boolean;
  key: { fifths: number; mode: 'major' | 'minor' };
  /** Cents the recording sits off A = 440 Hz. */
  tuning: number;
  /** Share of the recording where a voice was followed. */
  voiced: number;
  /** How sure the melody is, 0..1. */
  confidence: number;
}


const SR = 22050;
const N = 2048;
const HOP = 256;
const FPS = SR / HOP;
const SAL_BINS = 600;
const F_LO = 55;

/* ------------------------------------------------------------ resampling */

function biquadLowpass(x: Float32Array, rate: number, fc: number, q: number): Float32Array {
  const w = (2 * Math.PI * fc) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = o;
    y[i] = o;
  }
  return y;
}

export function resampleTo(x: Float32Array, rate: number, to: number, cutoff: number): Float32Array {
  if (rate === to) return x;
  // Butterworth 4th order (two sections) under the new Nyquist.
  const f = biquadLowpass(biquadLowpass(x, rate, cutoff, 0.5412), rate, cutoff, 1.3066);
  const len = Math.floor((x.length * to) / rate);
  const out = new Float32Array(len);
  const step = rate / to;
  for (let i = 0; i < len; i++) {
    const p = i * step;
    const k = Math.floor(p);
    const fr = p - k;
    out[i] = (f[k] ?? 0) * (1 - fr) + (f[k + 1] ?? 0) * fr;
  }
  return out;
}

function resample(x: Float32Array, rate: number): Float32Array {
  return resampleTo(x, rate, SR, 9800);
}

/* -------------------------------------------------- the bass, by itself */

const BASS_SR = 4000;
const BASS_N = 4096;

/**
 * The bass note of each stretch between beats, from the bass alone: a
 * 4096-point spectrum of the stretch at 4 kHz (about 1 Hz a bin), and for
 * each semitone from E1 to C4 the sum of its first four harmonics; the best
 * one's pitch class gets its strength.
 */
function bassPerBeat(bass: Float32Array, rate: number, beats: number[], beatLen: number): number[][] {
  const x = resampleTo(bass, rate, BASS_SR, 1600);
  const out: number[][] = [];
  const re = new Float64Array(BASS_N);
  const im = new Float64Array(BASS_N);
  const mag = new Float64Array(BASS_N / 2);
  for (let b = 0; b < beats.length; b++) {
    const v = new Array<number>(12).fill(0);
    out.push(v);
    const a = Math.max(0, Math.round(beats[b]! * BASS_SR));
    const e = Math.min(x.length, Math.round((beats[b + 1] ?? beats[b]! + beatLen) * BASS_SR));
    const len = Math.min(BASS_N, e - a);
    if (len < 200) continue;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < len; i++) re[i] = x[a + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
    fftN(re, im, BASS_N);
    for (let k = 0; k < BASS_N / 2; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
    const at = (f: number): number => {
      const p = (f * BASS_N) / BASS_SR;
      const k = Math.floor(p);
      if (k + 1 >= BASS_N / 2) return 0;
      // The strongest bin within a quarter tone.
      const span = Math.max(1, Math.round(p * 0.03));
      let m = 0;
      for (let j = Math.max(1, k - span); j <= Math.min(BASS_N / 2 - 1, k + 1 + span); j++) m = Math.max(m, mag[j]!);
      return m;
    };
    let best = 0;
    let bestM = -1;
    for (let m = 28; m <= 60; m++) {
      const f = 440 * 2 ** ((m - 69) / 12);
      const s = at(f) + 0.8 * at(2 * f) + 0.6 * at(3 * f) + 0.4 * at(4 * f) - 0.5 * at(f / 2);
      if (s > best) {
        best = s;
        bestM = m;
      }
    }
    if (bestM >= 0) v[bestM % 12] = best;
  }
  return out;
}

/** An in-place radix-2 FFT of any power-of-two size. */
function fftN(re: Float64Array, im: Float64Array, n: number): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = i + k;
        const b = a + size / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/* ------------------------------------------------------------------- FFT */

const rev = new Uint32Array(N);
for (let i = 0, j = 0; i < N; i++) {
  rev[i] = j;
  let bit = N >> 1;
  while (j & bit) {
    j ^= bit;
    bit >>= 1;
  }
  j |= bit;
}
const cosT = new Float64Array(N / 2);
const sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N);
  sinT[i] = -Math.sin((2 * Math.PI * i) / N);
}
const hann = new Float64Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < N; i++) {
    const j = rev[i]!;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step]!;
        const s = sinT[k * step]!;
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * c - im[b]! * s;
        const xi = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/* --------------------------------------------------------------- helpers */

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function percentile(xs: ArrayLike<number>, p: number): number {
  const s = Array.from(xs)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
}

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/* ------------------------------------------------------------- the notes */

type SecNote = { t: number; e: number; midi: number };

/**
 * A blip (under 0.12 s), or a short note outside the key (under 0.25 s), a
 * semitone or less from a note it touches takes that note's pitch (the
 * longer one's, in the key when it was outside); notes that then touch on
 * one pitch are one when either is under 0.1 s (a split, not a new syllable).
 */
function tidyNotes(ns: SecNote[], scale: Set<number>): SecNote[] {
  const out = ns.map((n) => ({ ...n }));
  const pc = (m: number): number => ((m % 12) + 12) % 12;
  const touching = (a: SecNote, b: SecNote): boolean => b.t - a.e < 0.08;
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    const d = n.e - n.t;
    const outside = !scale.has(pc(n.midi));
    if (!(d < 0.12 || (outside && d < 0.25))) continue;
    const near: SecNote[] = [];
    const p = out[i - 1];
    const q = out[i + 1];
    if (p !== undefined && touching(p, n) && Math.abs(p.midi - n.midi) <= 1 && (!outside || scale.has(pc(p.midi)))) near.push(p);
    if (q !== undefined && touching(n, q) && Math.abs(q.midi - n.midi) <= 1 && (!outside || scale.has(pc(q.midi)))) near.push(q);
    near.sort((a, b) => b.e - b.t - (a.e - a.t));
    if (near[0] !== undefined) n.midi = near[0].midi;
  }
  const merged: SecNote[] = [];
  for (const n of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.midi === n.midi && touching(last, n) && Math.min(last.e - last.t, n.e - n.t) < 0.1) last.e = Math.max(last.e, n.e);
    else merged.push(n);
  }
  return merged;
}

/* ------------------------------------------------------------------ main */

export function analyse(req: TranscribeRequest, progress: (p: number, stage: string) => void): TranscribeResult {
  const stereo = req.channels.length >= 2;
  const L = req.channels[0]!;
  const R = stereo ? req.channels[1]! : L;
  const duration = L.length / req.rate;
  progress(0.02, 'Reading the recording');
  const midRaw = new Float32Array(L.length);
  const sideRaw = new Float32Array(L.length);
  let sideE = 0;
  let midE = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i]!;
    const b = R[i]!;
    midRaw[i] = (a + b) * 0.5;
    sideRaw[i] = (a - b) * 0.5;
    midE += midRaw[i]! * midRaw[i]!;
    sideE += sideRaw[i]! * sideRaw[i]!;
  }
  // A "stereo" file whose channels are the same is mono.
  const wide = stereo && sideE > midE * 0.002;
  const mid = resample(midRaw, req.rate);
  const side = wide ? resample(sideRaw, req.rate) : null;
  progress(0.08, req.mode === 'mix' ? 'Separating the voice' : 'Listening');

  const frames = Math.max(1, Math.floor((mid.length - N) / HOP) + 1);
  const time = (i: number): number => (i * HOP + N / 2) / SR;
  const kMax = Math.min(N / 2 - 1, Math.floor((5000 * N) / SR));
  const kMin = Math.max(2, Math.floor((F_LO * N) / SR));
  const binHz = SR / N;
  // Per frame.
  const flux = new Float32Array(frames);
  const voiceE = new Float32Array(frames);
  const chroma = new Float32Array(frames * 12);
  const bass = new Float32Array(frames * 12);
  const cand: { b: number; v: number }[][] = [];
  const topSal = new Float32Array(frames);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const magM = new Float64Array(N / 2 + 1);
  const magS = new Float64Array(N / 2 + 1);
  const prevLog = new Float64Array(N / 2 + 1);
  const sal = new Float64Array(SAL_BINS);
  // Bin → pitch class (and whether it counts for chroma / bass).
  const pcOf = new Int8Array(N / 2 + 1).fill(-1);
  const bassOf = new Int8Array(N / 2 + 1).fill(-1);
  for (let k = 1; k <= N / 2; k++) {
    const f = k * binHz;
    const m = Math.round(69 + 12 * Math.log2(f / 440));
    const pc = ((m % 12) + 12) % 12;
    // Chroma where the bins resolve semitones; the bass from its own peak below.
    if (f >= 150 && f <= 1500) pcOf[k] = pc;
    if (f >= 38 && f <= 165) bassOf[k] = pc;
  }
  const mixMode = req.mode === 'mix';
  const stems = req.mode === 'stems' && req.stems !== undefined ? req.stems : null;
  // The beat, the metre, the key and the chords come from the music: the mix, or its separated instruments.
  const music = mixMode || stems !== null;
  const harm = stems !== null ? resample(stems.other.map((v, i) => v + 0.3 * (stems.bass[i] ?? 0)), req.rate) : null;
  const drm = stems !== null ? resample(stems.drums, req.rate) : null;
  const magH = new Float64Array(N / 2 + 1);
  const magD = new Float64Array(N / 2 + 1);
  const unpack = (k: number, a: Float64Array, b: Float64Array): void => {
    const k2 = (N - k) % N;
    a[k] = Math.hypot((re[k]! + re[k2]!) / 2, (im[k]! - im[k2]!) / 2);
    b[k] = Math.hypot((im[k]! + im[k2]!) / 2, (re[k2]! - re[k]!) / 2);
  };

  for (let fi = 0; fi < frames; fi++) {
    const o = fi * HOP;
    if (harm !== null && drm !== null) {
      // Separated: the harmony in the real part, the drums in the imaginary.
      for (let i = 0; i < N; i++) {
        re[i] = (harm[o + i] ?? 0) * hann[i]!;
        im[i] = (drm[o + i] ?? 0) * hann[i]!;
      }
      fft(re, im);
      for (let k = 0; k <= N / 2; k++) unpack(k, magH, magD);
      let fl = 0;
      for (let k = 1; k <= N / 2; k++) {
        const lg = Math.log(1 + 100 * (magH[k]! + magD[k]!));
        const d = lg - prevLog[k]!;
        if (d > 0 && k < 744) fl += d;
        prevLog[k] = lg;
        const pc = pcOf[k]!;
        if (pc >= 0) chroma[fi * 12 + pc] = chroma[fi * 12 + pc]! + magH[k]!;
      }
      flux[fi] = fl;
      // The voice is followed below by McLeod pitch, the bass per beat.
      if (fi % 400 === 0) progress(0.08 + 0.3 * (fi / frames), 'Listening to the music');
      continue;
    }
    // Mid in the real part, side in the imaginary: one FFT for both.
    for (let i = 0; i < N; i++) {
      re[i] = (mid[o + i] ?? 0) * hann[i]!;
      im[i] = side !== null ? (side[o + i] ?? 0) * hann[i]! : 0;
    }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) unpack(k, magM, magS);
    if (side === null) magS.fill(0);
    // Onsets, chroma, bass from the whole recording.
    let fl = 0;
    for (let k = 1; k <= N / 2; k++) {
      const total = magM[k]! + magS[k]!;
      const lg = Math.log(1 + 100 * total);
      const d = lg - prevLog[k]!;
      if (d > 0 && k < 744) fl += d;
      prevLog[k] = lg;
      const pc = pcOf[k]!;
      // The harmony, with the middle (where the voice is) weighted down in a stereo mix.
      if (pc >= 0) chroma[fi * 12 + pc] = chroma[fi * 12 + pc]! + (wide ? 1.5 * magS[k]! + 0.35 * magM[k]! : magM[k]!);
    }
    // The bass: the lowest strong peak under 165 Hz (not the loudest: a chord's low note can be louder), refined.
    let bmax = 0;
    for (let k = 3; k <= N / 2 && k * binHz <= 165; k++) if (bassOf[k]! >= 0) bmax = Math.max(bmax, magM[k]! + magS[k]!);
    let bk = -1;
    for (let k = 4; k < N / 2 && k * binHz <= 165; k++) {
      const v = magM[k]! + magS[k]!;
      if (bassOf[k]! >= 0 && v >= 0.45 * bmax && v >= magM[k - 1]! + magS[k - 1]! && v >= magM[k + 1]! + magS[k + 1]!) {
        bk = k;
        break;
      }
    }
    if (bk > 1) {
      const l = magM[bk - 1]! + magS[bk - 1]!;
      const c = magM[bk]! + magS[bk]!;
      const r = magM[bk + 1]! + magS[bk + 1]!;
      const den = l - 2 * c + r;
      const fb = (bk + (den !== 0 ? (0.5 * (l - r)) / den : 0)) * binHz;
      if (fb > 30) {
        const pcb = ((Math.round(69 + 12 * Math.log2(fb / 440)) % 12) + 12) % 12;
        bass[fi * 12 + pcb] = bass[fi * 12 + pcb]! + c;
      }
    }
    flux[fi] = fl;
    // The voice's spectrum.
    let ve = 0;
    let vmax = 0;
    for (let k = kMin; k <= kMax; k++) {
      const v = mixMode && side !== null ? Math.max(0, magM[k]! - 1.0 * magS[k]!) : magM[k]!;
      magM[k] = v;
      if (k * binHz >= 150 && k * binHz <= 4000) ve += v * v;
      if (v > vmax) vmax = v;
    }
    voiceE[fi] = ve;
    if (mixMode) {
      // Peaks of the voice spectrum (within 40 dB of the strongest), refined.
      const peaks: { f: number; a: number }[] = [];
      const floor = vmax * 0.01;
      // Above 100 Hz: the bass and the kick drum sit in the middle too, below the voice's harmonics.
      for (let k = Math.max(kMin + 1, Math.ceil(100 / binHz)); k < kMax; k++) {
        const c = magM[k]!;
        if (c <= floor || c < magM[k - 1]! || c < magM[k + 1]!) continue;
        const l = Math.log(magM[k - 1]! + 1e-12);
        const cc = Math.log(c + 1e-12);
        const r = Math.log(magM[k + 1]! + 1e-12);
        const den = l - 2 * cc + r;
        const delta = den !== 0 ? (0.5 * (l - r)) / den : 0;
        peaks.push({ f: (k + Math.max(-0.5, Math.min(0.5, delta))) * binHz, a: c });
      }
      peaks.sort((a, b) => b.a - a.a);
      sal.fill(0);
      for (const pk of peaks.slice(0, 40)) {
        let wh = 1;
        for (let h = 1; h <= 16; h++) {
          const f0 = pk.f / h;
          if (f0 < F_LO) break;
          const b = 120 * Math.log2(f0 / F_LO);
          if (b < SAL_BINS + 10) {
            const bi = Math.round(b);
            for (let j = Math.max(0, bi - 10); j <= Math.min(SAL_BINS - 1, bi + 10); j++) {
              const d = Math.abs(b - j) / 10;
              if (d <= 1) {
                const c = Math.cos((Math.PI / 2) * d);
                sal[j] = sal[j]! + c * c * wh * pk.a;
              }
            }
          }
          wh *= 0.8;
        }
      }
      const cs: { b: number; v: number }[] = [];
      // Only pitches a voice sings (F2 to C6).
      const jLo = Math.round(120 * Math.log2(87.3 / F_LO));
      const jHi = Math.min(SAL_BINS - 2, Math.round(120 * Math.log2(1046.5 / F_LO)));
      for (let j = Math.max(1, jLo); j <= jHi; j++) if (sal[j]! > 0 && sal[j]! >= sal[j - 1]! && sal[j]! > sal[j + 1]!) cs.push({ b: j, v: sal[j]! });
      cs.sort((a, b) => b.v - a.v);
      const top = cs.slice(0, 5);
      cand.push(top);
      topSal[fi] = top[0]?.v ?? 0;
    }
    if (fi % 400 === 0) progress(0.08 + 0.55 * (fi / frames), mixMode ? 'Following the voice' : 'Listening');
  }

  /* ---------------------------------------------------------- the pitch */
  const f0 = new Float32Array(frames).fill(NaN);
  let confidence = 0;
  if (mixMode) {
    const p90 = percentile(topSal, 0.9) || 1;
    const ve90 = percentile(voiceE, 0.9) || 1;
    const voiced = new Uint8Array(frames);
    for (let i = 0; i < frames; i++) voiced[i] = topSal[i]! / p90 > 0.28 && voiceE[i]! / ve90 > 0.03 ? 1 : 0;
    // Voiced stretches: a Viterbi path over the candidates.
    let i = 0;
    let confSum = 0;
    let confN = 0;
    while (i < frames) {
      if (voiced[i] === 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < frames && voiced[j] === 1) j++;
      if (j - i >= 6) {
        const T = j - i;
        const cost: number[][] = [];
        const back: number[][] = [];
        for (let t = 0; t < T; t++) {
          const cs = cand[i + t]!;
          const best = cs[0]?.v ?? 1;
          cost.push([]);
          back.push([]);
          cs.forEach((c, k) => {
            const midi = 33 + c.b / 10;
            let em = Math.log(Math.max(1e-6, c.v / best));
            if (midi < 43 || midi > 84) em -= 0.6;
            if (t === 0) {
              cost[t]!.push(em);
              back[t]!.push(-1);
              return;
            }
            let top = -Infinity;
            let from = 0;
            (cand[i + t - 1] ?? []).forEach((p, pk) => {
              const jump = Math.abs(c.b - p.b) / 10;
              const tr = -(jump > 0.5 ? 0.35 * (jump - 0.5) : 0) - (Math.abs(jump - 12) < 0.8 ? 0.8 : 0);
              const v = (cost[t - 1]![pk] ?? -Infinity) + tr;
              if (v > top) {
                top = v;
                from = pk;
              }
            });
            cost[t]!.push(top + em);
            back[t]!.push(from);
          });
        }
        let k = cost[T - 1]!.reduce((bi, v, ii, arr) => (v > arr[bi]! ? ii : bi), 0);
        for (let t = T - 1; t >= 0; t--) {
          const c = cand[i + t]![k];
          if (c !== undefined) {
            f0[i + t] = 33 + c.b / 10;
            confSum += Math.min(1, c.v / p90);
            confN++;
          }
          k = back[t]![k] ?? 0;
        }
      }
      i = j;
    }
    confidence = confN > 0 ? confSum / confN : 0;
  } else {
    // A voice alone: McLeod pitch on the mid signal, one analysis per frame.
    const W = 1024;
    const buf = new Float32Array(W);
    const energies: number[] = [];
    const clar = new Float32Array(frames);
    const dbs = new Float32Array(frames);
    for (let fi = 0; fi < frames; fi++) {
      const c = fi * HOP + N / 2 - W / 2;
      let e = 0;
      for (let i = 0; i < W; i++) {
        const v = mid[c + i] ?? 0;
        buf[i] = v;
        e += v * v;
      }
      const db = 10 * Math.log10(e / W + 1e-12);
      dbs[fi] = db;
      energies.push(db);
      if (db > -60) {
        const r = mpm(buf, SR, 55, 1400);
        clar[fi] = r.clarity;
        if (r.hz > 0) f0[fi] = 69 + 12 * Math.log2(r.hz / 440);
      }
      if (fi % 400 === 0) progress(stems !== null ? 0.38 + 0.3 * (fi / frames) : 0.1 + 0.5 * (fi / frames), 'Following the voice');
    }
    // Loud enough: well over the quietest frames, and not far under the loud ones
    // (a recording sung from start to end has almost no silence to measure).
    // A separated voice is silent between phrases; what is left there (reverb, a trace of the music) is not sung.
    const gate =
      stems !== null
        ? Math.max(percentile(energies, 0.05) + 15, percentile(energies, 0.9) - 28)
        : Math.min(percentile(energies, 0.05) + 15, percentile(energies, 0.9) - 22);
    let confSum = 0;
    let confN = 0;
    for (let fi = 0; fi < frames; fi++) {
      if (!(clar[fi]! >= 0.72 && dbs[fi]! > gate)) f0[fi] = NaN;
      else {
        confSum += clar[fi]!;
        confN++;
      }
      voiceE[fi] = 10 ** (dbs[fi]! / 10);
    }
    confidence = confN > 0 ? confSum / confN : 0;
  }
  // A running median of five, and stray octave jumps of a frame or two put back.
  const sm = new Float32Array(frames).fill(NaN);
  for (let i = 0; i < frames; i++) {
    if (!Number.isFinite(f0[i]!)) continue;
    const w: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(frames - 1, i + 2); k++) if (Number.isFinite(f0[k]!)) w.push(f0[k]!);
    sm[i] = median(w);
  }
  const voicedFrames = Array.from(sm).filter((x) => Number.isFinite(x));
  const fracs = voicedFrames.map((m) => m - Math.round(m));
  const tuning = fracs.length > 20 ? median(fracs) : 0;
  for (let i = 0; i < frames; i++) if (Number.isFinite(sm[i]!)) sm[i] = sm[i]! - tuning;
  progress(0.66, 'Writing the notes');

  /* ---------------------------------------------------------- the notes */
  const logE = Array.from(voiceE, (e) => 10 * Math.log10(e + 1e-12));
  const raw: { a: number; b: number; ps: number[] }[] = [];
  let cur: { a: number; b: number; ps: number[] } | null = null;
  let gap = 0;
  let devStart = -1;
  let devPs: number[] = [];
  const close = (): void => {
    if (cur !== null && cur.b - cur.a >= 7) raw.push(cur);
    cur = null;
  };
  for (let i = 0; i < frames; i++) {
    const m = sm[i]!;
    if (!Number.isFinite(m)) {
      gap++;
      if (gap >= 3) close();
      devStart = -1;
      continue;
    }
    gap = 0;
    if (cur === null) {
      cur = { a: i, b: i + 1, ps: [m] };
      continue;
    }
    const ref = median(cur.ps.slice(-12));
    // A new strike on the same pitch: the voice's loudness jumps after a dip.
    const strike = i >= 3 && cur.b - cur.a >= 12 && logE[i]! - Math.min(logE[i - 1]!, logE[i - 2]!, logE[i - 3]!) > 6;
    if (Math.abs(m - ref) > 0.6) {
      if (devStart < 0) {
        devStart = i;
        devPs = [];
      }
      devPs.push(m);
      // Settled somewhere new: the last four frames agree (the glide before them does not count).
      const last4 = devPs.slice(-4);
      if (last4.length === 4 && Math.max(...last4) - Math.min(...last4) < 0.8) {
        const at = i - 3;
        cur.b = Math.max(cur.a + 1, at);
        close();
        cur = { a: at, b: i + 1, ps: last4 };
        devStart = -1;
      }
      continue;
    }
    devStart = -1;
    if (strike) {
      close();
      cur = { a: i, b: i + 1, ps: [m] };
      continue;
    }
    cur.b = i + 1;
    cur.ps.push(m);
  }
  close();
  const secNotes = raw.map((n) => {
    const lo = Math.floor(n.ps.length * 0.2);
    const hi = Math.max(lo + 1, Math.ceil(n.ps.length * 0.8));
    return { t: time(n.a) - (HOP / SR) * 0.5, e: time(n.b - 1) + (HOP / SR) * 0.5, midi: Math.round(median(n.ps.slice(lo, hi))) };
  });

  /* ----------------------------------------------------------- the beat */
  progress(0.72, 'Finding the beat');
  // The onset envelope: the flux less its local mean, positive part, normalised.
  const env = new Float32Array(frames);
  const win = Math.round(FPS * 0.5);
  let acc = 0;
  const q: number[] = [];
  for (let i = 0; i < frames; i++) {
    const v = music || wide ? flux[i]! : Math.max(0, logE[i]! - (logE[i - 1] ?? logE[i]!));
    q.push(v);
    acc += v;
    if (q.length > win) acc -= q.shift()!;
    env[i] = Math.max(0, v - acc / q.length);
  }
  // Note onsets help a voice alone.
  if (!music) {
    const lift = percentile(env, 0.95) + 1e-6;
    for (const n of secNotes) {
      const k = Math.round(n.t * FPS);
      if (k >= 0 && k < frames) env[k] = env[k]! + lift;
    }
  }
  const sd = Math.sqrt(env.reduce((a, v) => a + v * v, 0) / frames) || 1;
  for (let i = 0; i < frames; i++) env[i] = env[i]! / sd;
  // Tempo: autocorrelation with a prior around 115 BPM.
  const lagMin = Math.round((60 / 200) * FPS);
  const lagMax = Math.round((60 / 50) * FPS);
  let bestLag = Math.round((60 / 100) * FPS);
  let bestScore = -Infinity;
  const ac = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += env[i]! * env[i - lag]!;
    ac[lag] = s / (frames - lag);
  }
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.8) ** 2);
    // Its double and half support a real beat.
    const s = (ac[lag]! + 0.5 * (ac[lag * 2] ?? 0) + 0.25 * (ac[Math.round(lag / 2)] ?? 0)) * w;
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  const a0 = ac[bestLag - 1]!;
  const a1 = ac[bestLag]!;
  const a2 = ac[bestLag + 1]!;
  const den = a0 - 2 * a1 + a2;
  const period = bestLag + (den !== 0 ? (0.5 * (a0 - a2)) / den : 0);
  // Beats by dynamic programming.
  const score = new Float64Array(frames);
  const from = new Int32Array(frames).fill(-1);
  const tight = 120;
  for (let i = 0; i < frames; i++) {
    let best = 0;
    let bi = -1;
    for (let k = Math.max(0, Math.round(i - 2 * period)); k <= i - Math.round(period / 2); k++) {
      const r = Math.log((i - k) / period);
      const v = score[k]! - tight * r * r;
      if (bi < 0 || v > best) {
        best = v;
        bi = k;
      }
    }
    score[i] = env[i]! + (bi >= 0 ? Math.max(0, best) : 0);
    from[i] = bi >= 0 && best > 0 ? bi : -1;
  }
  let end = frames - 1;
  for (let i = Math.max(0, frames - Math.round(period)); i < frames; i++) if (score[i]! > score[end]!) end = i;
  const beatFrames: number[] = [];
  for (let i = end; i >= 0; i = from[i]!) {
    beatFrames.unshift(i);
    if (from[i]! < 0) break;
  }
  // Fill the stretch before the first beat found and after the last, at the period.
  while (beatFrames.length > 0 && beatFrames[0]! - period > 0) beatFrames.unshift(beatFrames[0]! - period);
  while (beatFrames.length > 0 && beatFrames[beatFrames.length - 1]! + period < frames) beatFrames.push(beatFrames[beatFrames.length - 1]! + period);
  let beats = beatFrames.map((f) => time(f));
  if (beats.length < 4) beats = Array.from({ length: Math.ceil(duration / (period / FPS)) + 1 }, (_, i) => (i * period) / FPS);
  // A steady recording: one straight grid through the beats.
  const n = beats.length;
  const mx = (n - 1) / 2;
  const my = beats.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  beats.forEach((b, i) => {
    sxy += (i - mx) * (b - my);
    sxx += (i - mx) ** 2;
  });
  const slope = sxy / sxx;
  const icpt = my - slope * mx;
  const resid = Math.sqrt(beats.reduce((a, b, i) => a + (b - (icpt + slope * i)) ** 2, 0) / n);
  const steady = resid < 0.045;
  if (steady) beats = beats.map((_, i) => icpt + slope * i);
  let bpm = 60 / (steady ? slope : median(beats.slice(1).map((b, i) => b - beats[i]!)));
  // A voice alone carries no drum to say whether the beat is this or twice as slow (or fast):
  // take the reading where a typical note lasts about a beat, near a singing tempo.
  if (!music && secNotes.length >= 4) {
    const durs = secNotes.map((x) => x.e - x.t).sort((x, y) => x - y);
    const med = durs[Math.floor(durs.length / 2)]!;
    const period = 60 / bpm;
    let pick = 1;
    let best = Infinity;
    for (const f of [1, 2, 0.5]) {
      const pd = period * f;
      const sc = Math.abs(Math.log2(med / pd)) + 0.3 * Math.abs(Math.log2(60 / pd / 95));
      if (sc < best) {
        best = sc;
        pick = f;
      }
    }
    if (pick === 2) {
      // Every other beat: the half where the notes start.
      const onBeat = (ph: number): number =>
        secNotes.filter((x) => {
          const k = beats.findIndex((bt) => Math.abs(bt - x.t) < period * 0.2);
          return k >= 0 && k % 2 === ph;
        }).length;
      const ph = onBeat(0) >= onBeat(1) ? 0 : 1;
      beats = beats.filter((_, i) => i % 2 === ph);
      bpm /= 2;
    } else if (pick === 0.5) {
      const more: number[] = [];
      beats.forEach((bt, i) => {
        more.push(bt);
        const nx = beats[i + 1];
        if (nx !== undefined) more.push((bt + nx) / 2);
      });
      beats = more;
      bpm *= 2;
    }
  }

  /* -------------------------------------------------- chroma per beat */
  const beatChroma: number[][] = [];
  const beatBass: number[][] = [];
  const beatAccent: number[] = [];
  for (let b = 0; b < beats.length; b++) {
    const f0i = Math.max(0, Math.round(beats[b]! * FPS - N / 2 / HOP));
    const f1i = Math.min(frames, Math.round((beats[b + 1] ?? beats[b]! + 60 / bpm) * FPS - N / 2 / HOP));
    const c = new Array<number>(12).fill(0);
    const bs = new Array<number>(12).fill(0);
    for (let f = f0i; f < f1i; f++)
      for (let k = 0; k < 12; k++) {
        c[k] = c[k]! + chroma[f * 12 + k]!;
        bs[k] = bs[k]! + bass[f * 12 + k]!;
      }
    beatChroma.push(c);
    beatBass.push(bs);
    const fr = Math.round(beats[b]! * FPS - N / 2 / HOP);
    let a = 0;
    for (let f = Math.max(0, fr - 2); f <= Math.min(frames - 1, fr + 2); f++) a = Math.max(a, env[f]!);
    beatAccent.push(a);
  }
  const cos = (a: number[], b: number[]): number => {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let k = 0; k < 12; k++) {
      ab += a[k]! * b[k]!;
      aa += a[k]! * a[k]!;
      bb += b[k]! * b[k]!;
    }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 1;
  };
  let change = beatChroma.map((c, i) => (i === 0 ? 0 : 1 - cos(c, beatChroma[i - 1]!)));
  // A song with music counted twice too fast changes chord only every six beats or more:
  // halve the tempo when that holds, the tempo is quick, and the melody would not become sixteenths.
  if (music && beats.length > 16 && bpm > 105) {
    const mean = change.reduce((x, y) => x + y, 0) / change.length;
    const sd2 = Math.sqrt(change.reduce((x, y) => x + (y - mean) ** 2, 0) / change.length);
    const at = change.map((v, i) => (v > mean + sd2 ? i : -1)).filter((i) => i > 0);
    const gaps = at.slice(1).map((v, i) => v - at[i]!).filter((g) => g > 1);
    const spacing = gaps.length >= 3 ? median(gaps) : 0;
    const durs = secNotes.map((x) => ((x.e - x.t) * bpm) / 60).sort((x, y) => x - y);
    const medBeats = durs.length > 0 ? durs[Math.floor(durs.length / 2)]! : 1;
    if (spacing >= 6 && medBeats / 2 >= 0.45) {
      const onBeat = (ph: number): number => {
        let v = 0;
        for (let i = ph; i < beats.length; i += 2) v += beatAccent[i]! + change[i]! * 4;
        return v;
      };
      const ph = onBeat(0) >= onBeat(1) ? 0 : 1;
      const keep = (_: unknown, i: number): boolean => i % 2 === ph;
      beats = beats.filter(keep);
      bpm /= 2;
      // Per beat again: two old beats make one.
      const merge = <T,>(xs: T[], add: (a: T, b: T) => T): T[] => {
        const out: T[] = [];
        for (let i = ph; i < xs.length; i += 2) out.push(xs[i + 1] !== undefined ? add(xs[i]!, xs[i + 1]!) : xs[i]!);
        return out;
      };
      const addV = (x: number[], y: number[]): number[] => x.map((v, k) => v + y[k]!);
      const nc = merge(beatChroma, addV);
      const nb = merge(beatBass, addV);
      const na = merge(beatAccent, (x, y) => Math.max(x, y * 0.5));
      beatChroma.length = 0;
      beatChroma.push(...nc);
      beatBass.length = 0;
      beatBass.push(...nb);
      beatAccent.length = 0;
      beatAccent.push(...na);
      change = beatChroma.map((c, i) => (i === 0 ? 0 : 1 - cos(c, beatChroma[i - 1]!)));
    }
  }

  /* ----------------------------------------------------- metre and bar 1 */
  progress(0.8, 'Finding the bars');
  const noteBeat = (t: number): number => {
    // Fractional beat index of a time (straight lines beyond the ends).
    if (t <= beats[0]!) return (t - beats[0]!) / (beats[1]! - beats[0]!);
    for (let i = 1; i < beats.length; i++) if (t <= beats[i]!) return i - 1 + (t - beats[i - 1]!) / (beats[i]! - beats[i - 1]!);
    const last = beats.length - 1;
    return last + (t - beats[last]!) / (beats[last]! - beats[last - 1]!);
  };
  // Long notes and note starts also mark strong beats.
  const noteStrength = new Array<number>(beats.length).fill(0);
  for (const nt of secNotes) {
    const bi = Math.round(noteBeat(nt.t));
    if (bi >= 0 && bi < beats.length && Math.abs(noteBeat(nt.t) - bi) < 0.2) noteStrength[bi] = noteStrength[bi]! + Math.min(2, (nt.e - nt.t) * (bpm / 60));
  }
  let meter: 3 | 4 = 4;
  let phase = 0;
  let bestM = -Infinity;
  const zs = (xs: number[]): number[] => {
    const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length)) || 1;
    return xs.map((x) => (x - m) / s);
  };
  const zA = zs(beatAccent);
  const zC = zs(change);
  const zN = zs(noteStrength);
  for (const M of [4, 3] as const) {
    for (let p = 0; p < M; p++) {
      let on = 0;
      let onN = 0;
      for (let b = p; b < beats.length; b += M) {
        on += zA[b]! + (music ? 1.5 * zC[b]! : 0) + zN[b]!;
        onN++;
      }
      let s = (onN > 0 ? on / onN : 0) + (M === 4 ? 0.12 : 0);
      if (!music && secNotes.length > 0) {
        // A tune most often ends, and often starts, on the first beat of a bar.
        const firstB = Math.round(noteBeat(secNotes[0]!.t));
        if ((((firstB - p) % M) + M) % M === 0) s += 0.2;
      }
      if (s > bestM) {
        bestM = s;
        meter = M;
        phase = p;
      }
    }
  }
  // Bar 1: the first bar line at or after the first note (what comes before is a pickup).
  const firstBeat = secNotes.length > 0 ? noteBeat(secNotes[0]!.t) : 0;
  let downbeat = phase;
  while (downbeat < firstBeat - 0.3) downbeat += meter;
  if (downbeat >= beats.length) downbeat = Math.max(0, beats.length - 1);

  /* -------------------------------------------------------------- key */
  progress(0.86, 'Finding the key');
  const hist = new Array<number>(12).fill(0);
  // Separated: the key from the voice alone (the instruments' passing and colour notes blur it); a mix: both.
  if (music && stems === null) {
    for (const c of beatChroma) {
      const s = c.reduce((a, b) => a + b, 0) || 1;
      for (let k = 0; k < 12; k++) hist[k] = hist[k]! + c[k]! / s;
    }
  }
  const nHist = new Array<number>(12).fill(0);
  for (const nt of secNotes) nHist[((nt.midi % 12) + 12) % 12] = nHist[((nt.midi % 12) + 12) % 12]! + (nt.e - nt.t);
  const nSum = nHist.reduce((a, b) => a + b, 0) || 1;
  const hSum = hist.reduce((a, b) => a + b, 0) || 1;
  const comb = hist.map((h, k) => h / hSum + nHist[k]! / nSum);
  const lastPc = secNotes.length > 0 ? ((secNotes[secNotes.length - 1]!.midi % 12) + 12) % 12 : -1;
  let keyBest = { s: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  for (let tonic = 0; tonic < 12; tonic++)
    for (const mode of ['major', 'minor'] as const) {
      const prof = mode === 'major' ? KK_MAJOR : KK_MINOR;
      const s = corr(comb, comb.map((_, pc) => prof[(pc - tonic + 12) % 12]!)) + (lastPc === tonic ? 0.12 : 0);
      if (s > keyBest.s) keyBest = { s, tonic, mode };
    }
  const majorPc = keyBest.mode === 'minor' ? (keyBest.tonic + 3) % 12 : keyBest.tonic;
  let fifths = 0;
  for (let f = -6; f <= 6; f++) if ((((f * 7) % 12) + 12) % 12 === majorPc && (fifths === 0 || Math.abs(f) < Math.abs(fifths))) fifths = f;
  if ((((fifths * 7) % 12) + 12) % 12 !== majorPc) fifths = 0;

  /* ------------------------------------------------------------ chords */
  const chords: { t: number; name: string }[] = [];
  if (music) {
    progress(0.9, 'Finding the chords');
    // Separated: the bass note of each beat from the bass alone.
    const rich = stems !== null;
    if (stems !== null) {
      const sb = bassPerBeat(stems.bass, req.rate, beats, 60 / bpm);
      for (let b = 0; b < beats.length; b++) beatBass[b] = sb[b]!;
    }
    const bassTop = Math.max(1e-9, ...beatBass.map((v) => Math.max(...v)));
    // One segment a beat, from the pickup on; changing chord costs least on the bar line.
    const segs: { b: number; c: number[]; bs: number[]; e: number }[] = [];
    for (let b = Math.max(0, Math.floor(firstBeat)); b < beats.length; b++) {
      const c = beatChroma[b]!.slice();
      const bs = beatBass[b]!.slice();
      segs.push({ b, c, bs, e: c.reduce((a, x) => a + x, 0) });
    }
    const changeCost = (b: number): number => {
      const inBar = (((b - downbeat) % meter) + meter) % meter;
      return inBar === 0 ? 0.08 : meter === 4 && inBar === 2 ? 0.14 : 0.22;
    };
    const eMax = Math.max(1e-9, ...segs.map((s) => s.e));
    const tonic = keyBest.tonic;
    const diat =
      keyBest.mode === 'major'
        ? { maj: [0, 5, 7], min: [2, 4, 9], dom: [7] }
        : { maj: [3, 8, 10, 7], min: [0, 5], dom: [7] };
    // With the bass heard alone, sevenths, sus4 and diminished chords are told apart too.
    type Q = '' | 'm' | '7' | 'maj7' | 'm7' | 'sus4' | 'dim';
    const SHAPES: { q: Q; ivs: number[]; w: number[] }[] = [
      { q: '', ivs: [0, 4, 7], w: [1, 0.9, 0.8] },
      { q: 'm', ivs: [0, 3, 7], w: [1, 0.9, 0.8] },
      { q: '7', ivs: [0, 4, 7, 10], w: [1, 0.85, 0.7, 0.75] },
    ];
    if (rich)
      SHAPES.push(
        { q: 'maj7', ivs: [0, 4, 7, 11], w: [1, 0.85, 0.7, 0.75] },
        { q: 'm7', ivs: [0, 3, 7, 10], w: [1, 0.85, 0.7, 0.75] },
        { q: 'sus4', ivs: [0, 5, 7], w: [1, 0.9, 0.8] },
        { q: 'dim', ivs: [0, 3, 6], w: [1, 0.9, 0.8] },
      );
    // Where each extra kind belongs in the key (semitones from the tonic).
    const home: Record<'maj7' | 'm7' | 'sus4' | 'dim', number[]> =
      keyBest.mode === 'major' ? { maj7: [0, 5], m7: [2, 4, 9], sus4: [7, 0, 5], dim: [11] } : { maj7: [3, 8], m7: [0, 5, 7], sus4: [7], dim: [2, 11] };
    const C: { root: number; q: Q; tones: number[]; w: number[] }[] = [];
    for (let r = 0; r < 12; r++) for (const sh of SHAPES) C.push({ root: r, q: sh.q, tones: sh.ivs.map((i) => (r + i) % 12), w: sh.w });
    const bassOfSeg = (s: { bs: number[] }): number => {
      const bsMax = Math.max(...s.bs);
      return bsMax > (rich ? bassTop * 0.06 : 0) ? s.bs.indexOf(bsMax) : -1;
    };
    const emit = segs.map((s) => {
      const norm = Math.sqrt(s.c.reduce((a, x) => a + x * x, 0)) || 1;
      const bassPc = bassOfSeg(s);
      return C.map((ch) => {
        let dot = 0;
        let tn = 0;
        ch.tones.forEach((pc, i) => {
          dot += (s.c[pc]! / norm) * ch.w[i]!;
          tn += ch.w[i]! * ch.w[i]!;
        });
        // Notes outside the chord count against it.
        let out = 0;
        for (let pc = 0; pc < 12; pc++) if (!ch.tones.includes(pc)) out += s.c[pc]! / norm;
        let v = dot / Math.sqrt(tn) - out * 0.12;
        if (bassPc === ch.root) v += 0.12;
        else if (rich && bassPc >= 0) v += ch.tones.includes(bassPc) ? 0.04 : -0.04;
        const rel = (ch.root - tonic + 12) % 12;
        if (ch.q === '' && diat.maj.includes(rel)) v += 0.06;
        if (ch.q === 'm' && diat.min.includes(rel)) v += 0.06;
        if (ch.q === '7') v += diat.dom.includes(rel) ? 0.01 : rich ? -0.06 : -0.08;
        if (ch.q === 'maj7' || ch.q === 'm7') v += home[ch.q].includes(rel) ? 0.03 : -0.08;
        if (ch.q === 'sus4') v += home.sus4.includes(rel) ? -0.02 : -0.1;
        if (ch.q === 'dim') v += home.dim.includes(rel) ? -0.02 : -0.12;
        if (rel === 0 && ch.q === (keyBest.mode === 'minor' ? 'm' : '')) v += 0.03;
        return v;
      });
    });
    // Viterbi with a cost for every change.
    const S = segs.length;
    if (S > 0) {
      const dp: number[][] = [emit[0]!.slice()];
      const bk: number[][] = [emit[0]!.map(() => -1)];
      for (let t = 1; t < S; t++) {
        const row: number[] = [];
        const br: number[] = [];
        const prev = dp[t - 1]!;
        const bestPrev = prev.reduce((bi, v, i, arr) => (v > arr[bi]! ? i : bi), 0);
        const cost = changeCost(segs[t]!.b);
        for (let c = 0; c < C.length; c++) {
          const stay = prev[c]!;
          const move = prev[bestPrev]! - cost;
          row.push(Math.max(stay, move) + emit[t]![c]!);
          br.push(stay >= move ? c : bestPrev);
        }
        dp.push(row);
        bk.push(br);
      }
      let k = dp[S - 1]!.reduce((bi, v, i, arr) => (v > arr[bi]! ? i : bi), 0);
      const path: number[] = new Array<number>(S);
      for (let t = S - 1; t >= 0; t--) {
        path[t] = k;
        k = bk[t]![k] ?? k;
      }
      const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
      const NA = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
      const names = fifths < 0 ? FL : fifths > 0 ? SH : NA;
      // Each beat's name: an inversion (C/E) when the bass alone plays another note of the chord.
      const named = segs.map((s, t) => {
        if (s.e < eMax * 0.05) return null;
        const ch = C[path[t]!]!;
        const base = names[ch.root]! + ch.q;
        const bp = rich ? bassOfSeg(s) : -1;
        return { base, name: bp >= 0 && bp !== ch.root && ch.q !== 'sus4' && ch.tones.includes(bp) ? `${base}/${names[bp]!}` : base };
      });
      // A bass note passing for a single beat under the same chord is not an inversion.
      named.forEach((n, t) => {
        const prev = named[t - 1];
        const next = named[t + 1];
        if (n === null || prev == null || n.name === prev.name || n.base !== prev.base) return;
        if (next == null || next.name !== n.name) n.name = prev.name;
      });
      let last = '';
      segs.forEach((s, t) => {
        const n = named[t];
        if (n == null || n.name === last) return;
        last = n.name;
        chords.push({ t: beats[s.b]!, name: n.name });
      });
    }
  }

  // A voice slides and wavers: what is left of that in the notes is folded into the notes beside it.
  const scale = new Set((keyBest.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11]).map((i) => (keyBest.tonic + i) % 12));
  const sungNotes = tidyNotes(secNotes, scale);

  const voicedShare = voicedFrames.length / frames;
  progress(1, 'Done');
  return {
    duration,
    notes: sungNotes.map((x) => ({ t: Math.round(x.t * 1000) / 1000, e: Math.round(x.e * 1000) / 1000, midi: x.midi })),
    chords,
    beats: beats.map((b) => Math.round(b * 10000) / 10000),
    downbeat,
    meter,
    bpm: Math.round(bpm * 10) / 10,
    steady,
    key: { fifths, mode: keyBest.mode },
    tuning: Math.round(tuning * 100),
    voiced: Math.round(voicedShare * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Splitting a recording into the singer and the music with Meta's Hybrid
 * Transformer Demucs (htdemucs v4, MIT), as an ONNX model with its
 * normalisation inside the graph. Each 7.8 s segment goes in twice: as sound
 * (2 × 343980 samples at 44.1 kHz) and as its complex spectrogram the way
 * htdemucs makes it (reflect padding of 1.5 hops, a centred 4096-point Hann
 * STFT scaled by 1/√4096, the last frequency bin dropped, frames 2..337
 * kept, real and imaginary as channels). Out come four sources (drums, bass,
 * other, vocals) from a time branch and a spectral branch; the spectral one
 * goes back to sound by the same steps undone and is added to the time one.
 * Segments overlap by a quarter and are cross-faded.
 *
 * The runtime is passed in (`run`), so the same code serves the browser
 * (onnxruntime-web) and the tests (onnxruntime-node).
 */

export type RunDemucs = (wave: Float32Array, spec: Float32Array) => Promise<{ time: Float32Array; spec: Float32Array }>;

/** The model's sample rate. */
export const DEMUCS_RATE = 44100;

const N = 4096;
const HOP = 1024;
const SEG = 343980;
const BINS = 2048;
const FRAMES = 336;
const PAD = 1536;
const PLANE = BINS * FRAMES;

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
// Periodic Hann, as torch.hann_window.
const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  for (let i = 0; i < N; i++) {
    const j = rev[i]!;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  const sgn = inverse ? -1 : 1;
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step]!;
        const s = sgn * sinT[k * step]!;
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

/** Reflect padding (the edge sample not repeated), as torch's. */
function reflect(x: Float32Array, left: number, right: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n + left + right);
  out.set(x, left);
  for (let i = 0; i < left; i++) out[left - 1 - i] = x[Math.min(n - 1, i + 1)]!;
  for (let i = 0; i < right; i++) out[left + n + i] = x[Math.max(0, n - 2 - i)]!;
  return out;
}

/** The htdemucs spectrogram of one channel of a segment: [2048 bins][336 frames], real and imaginary. */
function spec(x: Float32Array): { re: Float32Array; im: Float32Array } {
  const le = Math.ceil(SEG / HOP);
  const padded = reflect(x, PAD, PAD + le * HOP - SEG);
  const centred = reflect(padded, N / 2, N / 2);
  const re = new Float32Array(PLANE);
  const im = new Float32Array(PLANE);
  const fr = new Float64Array(N);
  const fi = new Float64Array(N);
  const scale = 1 / Math.sqrt(N);
  for (let f = 0; f < FRAMES; f++) {
    // Frames 2.. of the centred STFT.
    const o = (f + 2) * HOP;
    for (let i = 0; i < N; i++) {
      fr[i] = centred[o + i]! * win[i]!;
      fi[i] = 0;
    }
    fft(fr, fi, false);
    for (let b = 0; b < BINS; b++) {
      re[b * FRAMES + f] = fr[b]! * scale;
      im[b * FRAMES + f] = fi[b]! * scale;
    }
  }
  return { re, im };
}

/** The inverse of spec: [2048][336] complex back to a segment of sound. */
function ispec(re: Float32Array, im: Float32Array): Float32Array {
  const frames = FRAMES + 4;
  const len = (frames - 1) * HOP + N;
  const out = new Float64Array(len);
  const norm = new Float64Array(len);
  const r = new Float64Array(N);
  const i2 = new Float64Array(N);
  const scale = Math.sqrt(N);
  for (let f = 0; f < frames; f++) {
    const src = f - 2;
    const live = src >= 0 && src < FRAMES;
    if (live) {
      r.fill(0);
      i2.fill(0);
      for (let b = 0; b < BINS; b++) {
        r[b] = re[b * FRAMES + src]! * scale;
        i2[b] = im[b * FRAMES + src]! * scale;
      }
      // The Nyquist bin was dropped (zero); Hermitian symmetry for the rest.
      for (let b = 1; b < N / 2; b++) {
        r[N - b] = r[b]!;
        i2[N - b] = -i2[b]!;
      }
      fft(r, i2, true);
    }
    const o = f * HOP;
    for (let k = 0; k < N; k++) {
      if (live) out[o + k] = out[o + k]! + (r[k]! / N) * win[k]!;
      norm[o + k] = norm[o + k]! + win[k]! * win[k]!;
    }
  }
  const y = new Float32Array(SEG);
  const off = N / 2 + PAD;
  for (let k = 0; k < SEG; k++) {
    const p = k + off;
    y[k] = norm[p]! > 1e-8 ? out[p]! / norm[p]! : 0;
  }
  return y;
}

export interface Stems {
  /** The singer, stereo. */
  vocals: [Float32Array, Float32Array];
  /** Everything else (drums, bass and the rest), stereo. */
  music: [Float32Array, Float32Array];
  /** Mono, for listening: the bass, the other instruments (the harmony), the drums. */
  bass: Float32Array;
  other: Float32Array;
  drums: Float32Array;
}

/** How many model runs a recording of this many samples takes. */
export function segmentsFor(samples: number): number {
  const stride = Math.floor(SEG * 0.75);
  let n = 1;
  for (let s = 0; s + SEG < samples; s += stride) n++;
  return n;
}

/**
 * Split a recording at 44.1 kHz (stereo, or mono played as both channels)
 * into the singer and the music.
 */
export async function separateDemucs(channels: Float32Array[], run: RunDemucs, onProgress: (p: number) => void): Promise<Stems> {
  const L = channels[0]!;
  const R = channels[1] ?? L;
  const total = L.length;
  const stride = Math.floor(SEG * 0.75);
  const fade = SEG - stride;
  const vocals: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
  const music: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
  const bass = new Float32Array(total);
  const other = new Float32Array(total);
  const drums = new Float32Array(total);
  const weight = new Float32Array(total);
  const starts: number[] = [];
  for (let s = 0; ; s += stride) {
    starts.push(s);
    if (s + SEG >= total) break;
  }
  const wave = new Float32Array(2 * SEG);
  const input = new Float32Array(4 * PLANE);
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si]!;
    const len = Math.min(SEG, total - start);
    const sl = new Float32Array(SEG);
    const sr = new Float32Array(SEG);
    sl.set(L.subarray(start, start + len));
    sr.set(R.subarray(start, start + len));
    wave.set(sl, 0);
    wave.set(sr, SEG);
    const zl = spec(sl);
    const zr = spec(sr);
    input.set(zl.re, 0);
    input.set(zl.im, PLANE);
    input.set(zr.re, 2 * PLANE);
    input.set(zr.im, 3 * PLANE);
    const out = await run(wave, input);
    // Sources 0 drums, 1 bass, 2 other, 3 vocals. Time branch [4][2][SEG]; spectral [4][4][2048][336].
    const source = (s: number, ch: number): Float32Array => {
      const t = out.time.subarray((s * 2 + ch) * SEG, (s * 2 + ch + 1) * SEG);
      const base = s * 4 * PLANE + ch * 2 * PLANE;
      const y = ispec(out.spec.subarray(base, base + PLANE), out.spec.subarray(base + PLANE, base + 2 * PLANE));
      for (let i = 0; i < SEG; i++) y[i] = y[i]! + t[i]!;
      return y;
    };
    const first = si === 0;
    const last = si === starts.length - 1;
    for (let ch = 0; ch < 2; ch++) {
      const d = source(0, ch);
      const b = source(1, ch);
      const o = source(2, ch);
      const v = source(3, ch);
      const vo = vocals[ch]!;
      const mu = music[ch]!;
      for (let i = 0; i < len; i++) {
        const w = Math.min(1, first ? 1 : (i + 1) / fade, last ? 1 : (len - i) / fade);
        const k = start + i;
        vo[k] = vo[k]! + v[i]! * w;
        mu[k] = mu[k]! + (d[i]! + b[i]! + o[i]!) * w;
        drums[k] = drums[k]! + 0.5 * d[i]! * w;
        bass[k] = bass[k]! + 0.5 * b[i]! * w;
        other[k] = other[k]! + 0.5 * o[i]! * w;
        if (ch === 0) weight[k] = weight[k]! + w;
      }
    }
    onProgress((si + 1) / starts.length);
  }
  for (let i = 0; i < total; i++) {
    const w = weight[i]! > 1e-6 ? 1 / weight[i]! : 1;
    vocals[0][i] = vocals[0][i]! * w;
    vocals[1][i] = vocals[1][i]! * w;
    music[0][i] = music[0][i]! * w;
    music[1][i] = music[1][i]! * w;
    drums[i] = drums[i]! * w;
    bass[i] = bass[i]! * w;
    other[i] = other[i]! * w;
  }
  return { vocals, music, bass, other, drums };
}

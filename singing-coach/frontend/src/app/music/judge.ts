/**
 * Judging sung notes: pure functions over pitch frames (node-testable).
 *
 *   note pitch   the median octave-folded error (cents) over the note's
 *                stable part (the first 120 ms and the last 50 ms skipped; the
 *                middle 60% of short notes): a vibrato is heard at its mean
 *   on / close   inside the strictness bands (Normal ±25 / ±50 cents);
 *                off beyond; missed when under half the note is voiced
 *   onset        when the voice arrives near the note (within 150 cents and
 *                holding 70 ms), against the note's start
 *   scoop, fall  the first 150 ms more than 50 cents under the note's pitch;
 *                the last 150 ms dropping more than 50 cents: labels, not faults
 *   hold         the spread (SD, cents) of a long note after a 5 Hz low-pass
 *                (vibrato removed): how steady it is
 *   vibrato      the detrended pitch oscillating 4.5-8.5 times a second with
 *                a half-swing of 20 cents or more, over 400 ms or more
 *
 * In Solo the singer may settle in a slightly different key: notes are then
 * judged against the singer's own median offset, which is reported.
 */
import type { Strictness } from '../lib/types.ts';

export interface Bands {
  on: number;
  close: number;
  onset: number;
}

export const BANDS: Record<Strictness, Bands> = {
  lenient: { on: 35, close: 75, onset: 150 },
  normal: { on: 25, close: 50, onset: 100 },
  strict: { on: 15, close: 35, onset: 50 },
};

/** Clean take: notes on or close, notes on, onsets in the window. */
export const CLEAN: Record<Strictness, { pitch: number; on: number; onset: number }> = {
  lenient: { pitch: 0.85, on: 0.5, onset: 0.7 },
  normal: { pitch: 0.9, on: 0.65, onset: 0.75 },
  strict: { pitch: 0.95, on: 0.8, onset: 0.85 },
};

/** A frame of the take: seconds on the take's clock (latency removed), pitch and loudness. */
export interface TFrame {
  s: number;
  midi: number;
  db: number;
}

/** A note to sing: start and length in seconds on the take's clock. */
export interface Target {
  i: number;
  t: number;
  d: number;
  midi: number;
  /** 1 spoken, 2 free (not scored), 4 breath before, 8 staccato. */
  flags: number;
  /** Bar number as printed. */
  bar: number;
  phrase: number;
}

export const ST_MISSED = 0;
export const ST_ON = 1;
export const ST_CLOSE = 2;
export const ST_OFF = 3;
export const ST_FREE = 4;

export interface NoteResult {
  i: number;
  status: number;
  /** Signed cents from the target (after any Solo offset); null when not sung. */
  cents: number | null;
  /** Before any Solo offset. */
  raw: number | null;
  onsetMs: number | null;
  scoop: boolean;
  fall: boolean;
  vib: boolean;
  vibRate: number;
  vibExtent: number;
  holdSd: number | null;
  voiced: number;
  octave: number;
  db: number;
  bar: number;
  phrase: number;
}

export function fold(midi: number, target: number): number {
  const d = (midi - target) * 100;
  return ((((d + 600) % 1200) + 1200) % 1200) - 600;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** A centred moving average over k frames. */
function smooth(xs: number[], k: number): number[] {
  const out: number[] = [];
  const h = Math.floor(k / 2);
  for (let i = 0; i < xs.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(xs.length - 1, i + h); j++) {
      s += xs[j]!;
      n++;
    }
    out.push(s / n);
  }
  return out;
}

/** Frames between a and b seconds (sorted input; binary search start). */
export function slice(frames: TFrame[], a: number, b: number): TFrame[] {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.s < a) lo = mid + 1;
    else hi = mid;
  }
  const out: TFrame[] = [];
  for (let i = lo; i < frames.length && frames[i]!.s <= b; i++) out.push(frames[i]!);
  return out;
}

/** Vibrato and steadiness of a run of errors (cents), sampled every `dt` seconds. */
export function wobble(errs: number[], dt: number): { holdSd: number; vib: boolean; rate: number; extent: number } {
  if (errs.length < 6) return { holdSd: 0, vib: false, rate: 0, extent: 0 };
  // A 5 Hz low-pass: a moving average over about 200 ms.
  const k = Math.max(3, Math.round(0.2 / dt) | 1);
  const slow = smooth(errs, k);
  const holdSd = sd(slow);
  const det = errs.map((e, i) => e - slow[i]!);
  let cross = 0;
  for (let i = 1; i < det.length; i++) if ((det[i - 1]! < 0 && det[i]! >= 0) || (det[i - 1]! >= 0 && det[i]! < 0)) cross++;
  const dur = errs.length * dt;
  const rate = cross / 2 / Math.max(dur, 1e-6);
  let ss = 0;
  for (const x of det) ss += x * x;
  const extent = Math.sqrt(ss / det.length) * Math.SQRT2;
  const vib = dur >= 0.4 && rate >= 4.5 && rate <= 8.5 && extent >= 20;
  return { holdSd, vib, rate: vib ? rate : 0, extent: vib ? extent : 0 };
}

/**
 * Judge one note from the frames around it. `exact` judges against the
 * written octave (range work); otherwise any octave counts.
 */
export function judgeNote(frames: TFrame[], n: Target, bands: Bands, exact = false): NoteResult {
  const base: NoteResult = { i: n.i, status: ST_MISSED, cents: null, raw: null, onsetMs: null, scoop: false, fall: false, vib: false, vibRate: 0, vibExtent: 0, holdSd: null, voiced: 0, octave: 0, db: -120, bar: n.bar, phrase: n.phrase };
  if (n.flags & 2) return Object.assign(base, { status: ST_FREE });
  const inNote = slice(frames, n.t, n.t + n.d);
  if (inNote.length === 0) return base;
  const voicedF = inNote.filter((f) => Number.isFinite(f.midi));
  const share = voicedF.length / inNote.length;
  base.voiced = Math.round(share * 100) / 100;
  base.db = voicedF.length > 0 ? Math.round(mean(voicedF.map((f) => f.db))) : -120;
  const err = (f: TFrame): number => (exact ? (f.midi - n.midi) * 100 : fold(f.midi, n.midi));
  // Onset: the first moment the voice is near the note and stays there 70 ms.
  const before = slice(frames, n.t - Math.max(0.25, bands.onset / 500), n.t + Math.min(n.d, 0.45));
  for (let i = 0; i < before.length; i++) {
    const f = before[i]!;
    if (!Number.isFinite(f.midi) || Math.abs(err(f)) > 150) continue;
    let ok = true;
    let j = i + 1;
    for (; j < before.length && before[j]!.s - f.s < 0.07; j++) {
      const g = before[j]!;
      if (!Number.isFinite(g.midi) || Math.abs(err(g)) > 150) {
        ok = false;
        break;
      }
    }
    if (ok && j > i + 2) {
      base.onsetMs = Math.round((f.s - n.t) * 1000);
      break;
    }
  }
  if (n.flags & 1) {
    // Spoken: the voice is there, in time.
    base.status = share >= 0.3 ? ST_ON : ST_MISSED;
    if (base.onsetMs === null && share >= 0.3) {
      const v = voicedF[0];
      if (v !== undefined) base.onsetMs = Math.round((v.s - n.t) * 1000);
    }
    return base;
  }
  if (share < 0.5 || voicedF.length < 3) return base;
  // The stable part.
  let a = n.t + 0.12;
  let b = n.t + n.d - 0.05;
  if (n.d < 0.25 || b - a < 0.06) {
    a = n.t + n.d * 0.2;
    b = n.t + n.d * 0.8;
  }
  let stable = voicedF.filter((f) => f.s >= a && f.s <= b);
  if (stable.length < 3) stable = voicedF;
  const errs = stable.map(err);
  const cents = median(errs);
  base.raw = Math.round(cents);
  base.cents = Math.round(cents);
  if (!exact) {
    const octs = stable.map((f) => Math.round(((f.midi - n.midi) * 100 - fold(f.midi, n.midi)) / 1200));
    base.octave = Math.round(median(octs));
  }
  base.status = Math.abs(cents) <= bands.on ? ST_ON : Math.abs(cents) <= bands.close ? ST_CLOSE : ST_OFF;
  // Scoop and fall: the edges against the note's own pitch.
  const t0 = base.onsetMs !== null ? n.t + base.onsetMs / 1000 : n.t;
  const head = voicedF.filter((f) => f.s >= t0 && f.s <= t0 + 0.15).map(err);
  if (n.d >= 0.3 && head.length >= 4) {
    const h = mean(head);
    const first = head[0]!;
    if (cents - h > 50 && cents - first > 60) base.scoop = true;
  }
  const tail = voicedF.filter((f) => f.s >= n.t + n.d - 0.15).map(err);
  if (n.d >= 0.35 && tail.length >= 4) {
    const last = tail[tail.length - 1]!;
    if (cents - mean(tail.slice(-3)) > 50 && cents - last > 60) base.fall = true;
  }
  // Steadiness and vibrato on long notes.
  const dt = stable.length > 1 ? (stable[stable.length - 1]!.s - stable[0]!.s) / (stable.length - 1) : 0.0107;
  if (n.d >= 0.4 && stable.length >= 20) {
    const w = wobble(errs, dt);
    base.vib = w.vib;
    base.vibRate = Math.round(w.rate * 10) / 10;
    base.vibExtent = Math.round(w.extent);
    if (n.d >= 0.6) base.holdSd = Math.round(w.holdSd * 10) / 10;
  }
  return base;
}

/** Solo: judge against the singer's own key. Returns the offset applied (cents). */
export function applyOffset(results: NoteResult[], bands: Bands): number {
  const raws = results.filter((r) => r.raw !== null && Math.abs(r.raw) < 300).map((r) => r.raw as number);
  if (raws.length < 3) return 0;
  const off = Math.round(median(raws));
  for (const r of results) {
    if (r.raw === null) continue;
    const c = r.raw - off;
    r.cents = c;
    r.status = Math.abs(c) <= bands.on ? ST_ON : Math.abs(c) <= bands.close ? ST_CLOSE : ST_OFF;
  }
  return off;
}

export interface PhraseSummary {
  i: number;
  from_bar: number;
  to_bar: number;
  n: number;
  on: number;
  on_close: number;
  mean_c: number | null;
  worst: { i: number; bar: number; cents: number } | null;
}

export interface TakeSummary {
  expected: number;
  on: number;
  close: number;
  off: number;
  missed: number;
  pitch: number;
  inTune: number;
  onsetPct: number;
  bias: number | null;
  mad: number | null;
  timingMad: number | null;
  timingBias: number | null;
  holdSd: number | null;
  vibRate: number | null;
  vibExtent: number | null;
  vibShare: number | null;
  scoops: number;
  falls: number;
  drift: number | null;
  octave: number;
  phrases: PhraseSummary[];
  /** [bar, expected, on, close, off, missed, onset ok] */
  perBar: number[][];
  /** [melody index, status, cents, onset ms, flags (1 scoop, 2 fall, 4 vibrato, 8 octave), bar] */
  perNote: (number | null)[][];
  clean: boolean;
  weakest: PhraseSummary | null;
}

/** Everything a take says, from its judged notes. */
export function summarize(results: NoteResult[], bands: Bands, strict: Strictness): TakeSummary {
  const scored = results.filter((r) => r.status !== ST_FREE);
  const count = (s: number): number => scored.filter((r) => r.status === s).length;
  const expected = scored.length;
  const on = count(ST_ON);
  const close = count(ST_CLOSE);
  const off = count(ST_OFF);
  const missed = count(ST_MISSED);
  const sung = scored.filter((r) => r.cents !== null);
  const cents = sung.map((r) => r.cents as number);
  const onsets = scored.filter((r) => r.onsetMs !== null).map((r) => r.onsetMs as number);
  const onsetOk = scored.filter((r) => r.onsetMs !== null && Math.abs(r.onsetMs) <= bands.onset).length;
  const holds = scored.filter((r) => r.holdSd !== null).map((r) => r.holdSd as number);
  const longs = scored.filter((r) => r.vibRate > 0 || r.holdSd !== null);
  const vibs = scored.filter((r) => r.vib);
  const octs = sung.map((r) => r.octave);
  const octave = octs.length > 0 ? Math.round(median(octs)) : 0;
  // Phrases.
  const byPhrase = new Map<number, NoteResult[]>();
  for (const r of scored) {
    const l = byPhrase.get(r.phrase) ?? [];
    l.push(r);
    byPhrase.set(r.phrase, l);
  }
  const phrases: PhraseSummary[] = [];
  for (const [i, rs] of [...byPhrase.entries()].sort((a, b) => a[0] - b[0])) {
    const sc = rs.filter((r) => r.cents !== null);
    let worst: PhraseSummary['worst'] = null;
    for (const r of rs) {
      const c = r.cents === null ? 999 : Math.abs(r.cents);
      if (r.status === ST_ON) continue;
      if (worst === null || c > Math.abs(worst.cents)) worst = { i: r.i, bar: r.bar, cents: r.cents === null ? 0 : r.cents };
    }
    phrases.push({
      i,
      from_bar: Math.min(...rs.map((r) => r.bar)),
      to_bar: Math.max(...rs.map((r) => r.bar)),
      n: rs.length,
      on: rs.filter((r) => r.status === ST_ON).length,
      on_close: rs.filter((r) => r.status === ST_ON || r.status === ST_CLOSE).length,
      mean_c: sc.length > 0 ? Math.round(mean(sc.map((r) => r.cents as number))) : null,
      worst,
    });
  }
  const drift = phrases.length >= 2 && phrases[0]!.mean_c !== null && phrases[phrases.length - 1]!.mean_c !== null ? phrases[phrases.length - 1]!.mean_c! - phrases[0]!.mean_c! : null;
  // Bars.
  const bars = new Map<number, number[]>();
  for (const r of scored) {
    const b = bars.get(r.bar) ?? [r.bar, 0, 0, 0, 0, 0, 0];
    b[1]! += 1;
    if (r.status === ST_ON) b[2]! += 1;
    if (r.status === ST_CLOSE) b[3]! += 1;
    if (r.status === ST_OFF) b[4]! += 1;
    if (r.status === ST_MISSED) b[5]! += 1;
    if (r.onsetMs !== null && Math.abs(r.onsetMs) <= bands.onset) b[6]! += 1;
    bars.set(r.bar, b);
  }
  const perNote = results.map((r) => [r.i, r.status, r.cents, r.onsetMs, (r.scoop ? 1 : 0) | (r.fall ? 2 : 0) | (r.vib ? 4 : 0) | (r.octave !== 0 ? 8 : 0), r.bar]);
  const pitch = expected > 0 ? (on + close) / expected : 0;
  const inTune = expected > 0 ? on / expected : 0;
  const onsetPct = expected > 0 ? onsetOk / expected : 0;
  const T = CLEAN[strict];
  const weakest = phrases.filter((p) => p.on_close < p.n).sort((a, b) => a.on_close / a.n - b.on_close / b.n)[0] ?? null;
  return {
    expected,
    on,
    close,
    off,
    missed,
    pitch,
    inTune,
    onsetPct,
    bias: cents.length > 0 ? Math.round(mean(cents)) : null,
    mad: cents.length > 0 ? Math.round(mean(cents.map(Math.abs))) : null,
    timingMad: onsets.length > 0 ? Math.round(mean(onsets.map(Math.abs))) : null,
    timingBias: onsets.length > 0 ? Math.round(mean(onsets)) : null,
    holdSd: holds.length > 0 ? Math.round(median(holds) * 10) / 10 : null,
    vibRate: vibs.length > 0 ? Math.round(mean(vibs.map((r) => r.vibRate)) * 10) / 10 : null,
    vibExtent: vibs.length > 0 ? Math.round(mean(vibs.map((r) => r.vibExtent))) : null,
    vibShare: longs.length > 0 ? Math.round((vibs.length / longs.length) * 100) / 100 : null,
    scoops: scored.filter((r) => r.scoop).length,
    falls: scored.filter((r) => r.fall).length,
    drift,
    octave,
    phrases,
    perBar: [...bars.values()].sort((a, b) => a[0]! - b[0]!),
    perNote,
    clean: expected > 0 && pitch >= T.pitch && inTune >= T.on && onsetPct >= T.onset,
    weakest,
  };
}

/** Voiced time, fold cycles and the voice map ([midi, loudness 0-9, frames]) of a take's frames. */
export function voiceUse(frames: TFrame[], hzOf: (midi: number) => number): { voicedMs: number; cycles: number; map: number[][] } {
  let voiced = 0;
  let cycles = 0;
  const cells = new Map<string, number>();
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    if (!Number.isFinite(f.midi)) continue;
    const dt = Math.min(0.05, f.s - frames[i - 1]!.s);
    if (dt <= 0) continue;
    voiced += dt;
    cycles += hzOf(f.midi) * dt;
    const k = Math.round(f.midi) + ':' + Math.max(0, Math.min(9, Math.floor((f.db + 60) / 5)));
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const map = [...cells.entries()].map(([k, n]) => {
    const [m, b] = k.split(':');
    return [Number(m), Number(b), n];
  });
  return { voicedMs: Math.round(voiced * 1000), cycles: Math.round(cycles), map };
}

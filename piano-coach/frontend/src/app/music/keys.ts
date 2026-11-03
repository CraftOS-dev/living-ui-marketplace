/**
 * Keyboard geometry shared by the falling notes and the keys under them, so
 * a note always lands exactly on its key. Positions are fractions of the
 * keyboard's width.
 */

export function isBlack(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export interface KeyGeom {
  midi: number;
  black: boolean;
  /** Left edge, 0..1 of the width. */
  x: number;
  /** Width, 0..1 of the width. */
  w: number;
}

export interface Layout {
  lo: number;
  hi: number;
  keys: KeyGeom[];
  byMidi: Map<number, KeyGeom>;
  whites: number;
}

/** Black keys sit a little off the line between white keys, as on a piano. */
const BLACK_SHIFT: Record<number, number> = { 1: -0.12, 3: 0.12, 6: -0.14, 8: 0, 10: 0.14 };

export function layout(lo: number, hi: number): Layout {
  let a = Math.max(21, lo);
  let b = Math.min(108, hi);
  if (isBlack(a)) a -= 1;
  if (isBlack(b)) b += 1;
  let whites = 0;
  for (let m = a; m <= b; m++) if (!isBlack(m)) whites += 1;
  const ww = 1 / whites;
  const keys: KeyGeom[] = [];
  const byMidi = new Map<number, KeyGeom>();
  let wi = 0;
  for (let m = a; m <= b; m++) {
    if (!isBlack(m)) {
      const k = { midi: m, black: false, x: wi * ww, w: ww };
      keys.push(k);
      byMidi.set(m, k);
      wi += 1;
    } else {
      const bw = ww * 0.6;
      const shift = (BLACK_SHIFT[((m % 12) + 12) % 12] ?? 0) * ww;
      const k = { midi: m, black: true, x: wi * ww - bw / 2 + shift, w: bw };
      keys.push(k);
      byMidi.set(m, k);
    }
  }
  return { lo: a, hi: b, keys, byMidi, whites };
}

/**
 * The keys to show for a range of notes: whole octaves (C to B) around it,
 * at least two octaves, at most the 88 keys.
 */
export function rangeFor(low: number, high: number, minOctaves = 2): [number, number] {
  let lo = Math.floor(Math.max(21, low) / 12) * 12;
  let hi = Math.ceil((Math.min(108, high) + 1) / 12) * 12 - 1;
  while (hi - lo + 1 < minOctaves * 12) {
    if (lo > 24 && (hi >= 107 || (lo + hi) / 2 > 60)) lo -= 12;
    else hi += 12;
  }
  return [Math.max(21, lo), Math.min(108, hi)];
}

/**
 * The keys to show at a given width: whole octaves around the notes, widened
 * an octave at a time (on the side with less room around the music) until a
 * white key is no wider than `maxWhite` pixels, so the keys keep a piano's
 * proportions. At most the 88 keys.
 */
export function fitRange(low: number, high: number, width: number, maxWhite = 30): [number, number] {
  let [a, b] = rangeFor(low, high);
  const need = Math.ceil(width / maxWhite);
  for (let guard = 0; guard < 10 && layout(a, b).whites < need; guard++) {
    const canLo = a > 21;
    const canHi = b < 108;
    if (!canLo && !canHi) break;
    if (canLo && (low - a <= b - high || !canHi)) a = Math.max(21, a - 12);
    else b = Math.min(108, b + 12);
  }
  return [a, b];
}

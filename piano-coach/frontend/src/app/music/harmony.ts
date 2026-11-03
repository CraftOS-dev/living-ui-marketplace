/**
 * The chords of a song over time, for the practice screen. Chord symbols
 * written in the notation ("Am7") are used as they are; otherwise the notes
 * sounding in each beat are matched against chord templates (the bass
 * weighs more, notes outside the chord count against it), equal neighbours
 * merge, and a beat with too little to go on stays blank.
 */
import type { Model } from '../lib/types.ts';
import { iv, name as noteName, note as parseNote, transpose } from './theory.ts';

export interface ChordSpan {
  t: number;
  d: number;
  sym: string;
}

const TYPES: { sym: string; ivs: number[]; bias: number }[] = [
  { sym: '', ivs: [0, 4, 7], bias: 0.06 },
  { sym: 'm', ivs: [0, 3, 7], bias: 0.05 },
  { sym: '7', ivs: [0, 4, 7, 10], bias: 0.02 },
  { sym: 'maj7', ivs: [0, 4, 7, 11], bias: 0 },
  { sym: 'm7', ivs: [0, 3, 7, 10], bias: 0 },
  { sym: '°', ivs: [0, 3, 6], bias: 0 },
  { sym: 'm7♭5', ivs: [0, 3, 6, 10], bias: -0.01 },
  { sym: '°7', ivs: [0, 3, 6, 9], bias: 0 },
  { sym: '+', ivs: [0, 4, 8], bias: -0.04 },
];

/** The chords that belong to the key (root pitch class above the tonic → chord types). */
const DIATONIC: Record<'major' | 'minor', Record<number, string[]>> = {
  major: { 0: ['', 'maj7'], 2: ['m', 'm7'], 4: ['m', 'm7'], 5: ['', 'maj7'], 7: ['', '7'], 9: ['m', 'm7'], 11: ['°', 'm7♭5'] },
  minor: { 0: ['m', 'm7'], 2: ['°', 'm7♭5'], 3: ['', 'maj7'], 5: ['m', 'm7'], 7: ['', '7', 'm'], 8: ['', 'maj7'], 10: ['', '7'], 11: ['°', '°7'] },
};

function tonicPc(model: Model): number {
  const majors = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
  const pc = majors[model.key.fifths + 7] ?? 0;
  return model.key.mode === 'minor' ? (pc + 9) % 12 : pc;
}

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** C major and A minor: the usual names for chromatic roots. */
const NATURAL = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** The chord tone above the root, spelled: semitones → interval (a diminished 7th for °7). */
function spellTone(root: string, semis: number, type: string): string {
  const code = semis === 3 ? 'm3' : semis === 4 ? 'M3' : semis === 5 ? 'P4' : semis === 6 ? 'd5' : semis === 7 ? 'P5' : semis === 8 ? 'A5' : semis === 9 ? (type === '°7' ? 'd7' : 'M6') : semis === 10 ? 'm7' : 'M7';
  try {
    return noteName(transpose(parseNote(root.replace('♯', '#').replace('♭', 'b') + '4'), iv(code)), false);
  } catch {
    return '';
  }
}

function rootName(pc: number, fifths: number): string {
  const list = fifths < 0 ? FLAT : fifths > 0 ? SHARP : NATURAL;
  return list[((pc % 12) + 12) % 12] ?? 'C';
}

/** Symbols in the notation, written with ASCII accidentals, read nicely. */
function pretty(sym: string): string {
  return sym.replace(/^([A-G])#/, '$1♯').replace(/^([A-G])b/, '$1♭').replace(/\/([A-G])#/, '/$1♯').replace(/\/([A-G])b/, '/$1♭');
}

/** The best chord for the notes sounding between t0 and t1, with how well it fits (0..1). */
function fit(model: Model, t0: number, t1: number): { sym: string; score: number } {
  const w = new Array<number>(12).fill(0);
  const lh = new Set<number>();
  let bass = 128;
  let total = 0;
  for (const n of model.notes) {
    if (n[0] >= t1 - 1e-6) break;
    const end = n[0] + n[1];
    if (end <= t0 + 1e-6) continue;
    const ov = Math.min(end, t1) - Math.max(n[0], t0);
    if (ov <= 0) continue;
    // Notes struck in the window count fully; notes held into it count less.
    const weight = ov * (n[0] >= t0 - 1e-6 ? 1 : 0.6);
    w[n[2] % 12] = (w[n[2] % 12] ?? 0) + weight;
    total += weight;
    if (n[2] < bass) bass = n[2];
    if (n[3] === 1) lh.add(n[2] % 12);
  }
  const present = w.filter((x) => x > 0.04 * total).length;
  if (total <= 0 || present < 2) return { sym: '', score: 0 };
  const fifths = model.key.fifths;
  const bassPc = bass % 12;
  const tonic = tonicPc(model);
  const mode = model.key.mode === 'minor' ? 'minor' : 'major';
  // Two notes only: a bass with its fifth (or third) is the key's own triad on that bass.
  if (present === 2) {
    const other = w.findIndex((x, pc) => x > 0.04 * total && pc !== bassPc);
    const iv = (other - bassPc + 12) % 12;
    const types = DIATONIC[mode][(bassPc - tonic + 12) % 12];
    if ((iv === 7 || iv === 3 || iv === 4) && types !== undefined) {
      const type = iv === 3 ? 'm' : iv === 4 ? '' : (types[0] ?? '');
      if (type === '' || type === 'm') return { sym: rootName(bassPc, fifths) + type, score: 0.5 };
    }
    return { sym: '', score: 0 };
  }
  // A left hand of one or two notes is a bass line: its lowest note is likely the root.
  const lhOther = [...lh].find((pc) => pc !== bassPc);
  const bassLine = lh.has(bassPc) && (lh.size === 1 || (lh.size === 2 && lhOther !== undefined && (lhOther - bassPc + 12) % 12 === 7));
  let best = { score: -Infinity, sym: '' };
  let onBass = { score: -Infinity, sym: '' };
  for (let root = 0; root < 12; root++) {
    if ((w[root] ?? 0) <= 0) continue;
    for (const type of TYPES) {
      const pcs = type.ivs.map((iv) => (root + iv) % 12);
      let inside = 0;
      let missing = 0;
      for (const pc of pcs) {
        inside += w[pc] ?? 0;
        if ((w[pc] ?? 0) <= 0) missing += 1;
      }
      // Without its third a chord is only a guess (an open fifth over its root is fine).
      const fifthOverRoot = bassPc === root && (w[(root + 7) % 12] ?? 0) > 0;
      if ((w[pcs[1] ?? 0] ?? 0) <= 0 && !fifthOverRoot) missing += 0.5;
      const outside = total - inside;
      let score = (inside - outside * 0.75) / total - missing * 0.22 + type.bias;
      if (bassPc === root) score += 0.12;
      else if (pcs.includes(bassPc)) score += 0.03;
      if (type.ivs.length === 4 && missing > 0) score -= 0.15;
      // A seventh in passing does not make a seventh chord.
      if (type.ivs.length === 4 && (w[pcs[3] ?? 0] ?? 0) < 0.09 * total) score -= 0.12;
      // The key's own chords are the likelier reading.
      if ((DIATONIC[mode][(root - tonic + 12) % 12] ?? []).includes(type.sym)) score += 0.08;
      const rn = rootName(root, fifths);
      const sym = (): string => {
        if (bassPc === root || !pcs.includes(bassPc)) return rn + type.sym;
        const b = spellTone(rn, (bassPc - root + 12) % 12, type.sym);
        return rn + type.sym + (b !== '' ? '/' + b : '');
      };
      if (score > best.score) best = { score, sym: sym() };
      if (root === bassPc && score > onBass.score) onBass = { score, sym: sym() };
    }
  }
  // Over a bass line, the chord on the bass wins unless another reading is clearly better.
  if (bassLine && onBass.score >= 0.35 && best.score - onBass.score < 0.1) best = onBass;
  return best.score >= 0.35 ? best : { sym: '', score: Math.max(0, best.score) };
}

function guess(model: Model): ChordSpan[] {
  const beat = model.beat > 0 ? model.beat : 1;
  const out: ChordSpan[] = [];
  for (const bar of model.bars) {
    const beats = Math.max(1, Math.round(bar.len / beat));
    // Ways to split the bar: one chord, two halves (an even number of beats), every beat.
    const ways: number[][] = [[bar.len]];
    if (beats % 2 === 0 && beats >= 2) ways.push([bar.len / 2, bar.len / 2]);
    if (beats >= 2) ways.push(new Array<number>(beats).fill(bar.len / beats));
    let pick: ChordSpan[] = [];
    let pickScore = -Infinity;
    for (const way of ways) {
      let t = bar.t;
      const spans: ChordSpan[] = [];
      let sum = 0;
      for (const d of way) {
        const f = fit(model, t, t + d);
        spans.push({ t, d, sym: f.sym });
        sum += f.score * d;
        t += d;
      }
      // More chords must earn their place.
      const score = sum / bar.len - (way.length - 1) * 0.06;
      if (score > pickScore + 1e-9) {
        pickScore = score;
        pick = spans;
      }
    }
    out.push(...pick);
  }
  const merged: ChordSpan[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.sym === s.sym && Math.abs(last.t + last.d - s.t) < 1e-6) last.d += s.d;
    else merged.push({ ...s });
  }
  return merged.filter((s) => s.sym !== '');
}

/** The chord track: written symbols when the notation has them, else the analysis. */
export function chordTrack(model: Model): ChordSpan[] {
  const written = model.chords ?? [];
  if (written.length > 0) {
    return written.map(([t, sym], i) => {
      const next = written[i + 1];
      return { t, d: (next !== undefined ? next[0] : model.total) - t, sym: pretty(sym) };
    });
  }
  return guess(model);
}

/** The chord sounding at time q (or null). */
export function chordAt(track: ChordSpan[], q: number): ChordSpan | null {
  let lo = 0;
  let hi = track.length - 1;
  let found: ChordSpan | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = track[mid]!;
    if (s.t <= q + 1e-6) {
      found = s;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found !== null && q < found.t + found.d - 1e-6 ? found : null;
}

/**
 * When the foot goes down for a pedal span [a, b): a moment after a, as a
 * pianist lifts when the new chord sounds and presses again just after.
 * So every change shows a real lift (lagQ in quarter notes).
 */
export function pedalDown(a: number, b: number, lagQ: number): number {
  return a + Math.min(lagQ, (b - a) * 0.4);
}

/** Whether the foot is down at time q (lifted for a moment at every change). */
export function pedalAt(pedal: [number, number][] | undefined, q: number, lagQ = 0): boolean {
  if (pedal === undefined) return false;
  for (const [a, b] of pedal) {
    if (a > q + 1e-6) return false;
    if (q < b - 1e-6) return q >= pedalDown(a, b, lagQ) - 1e-6;
  }
  return false;
}

/**
 * Music theory, spelled correctly: notes with letters and accidentals,
 * intervals by number and quality, scales and modes, keys and signatures,
 * chords and inversions, diatonic chords with Roman numerals, progressions,
 * chord recognition from keys pressed, and standard scale fingerings.
 * Lessons, trainers, generators and the reference all use it.
 */

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

export interface Note {
  /** Letter index, 0 = C … 6 = B. */
  l: number;
  /** Accidental: -2 double flat … +2 double sharp. */
  a: number;
  /** Octave in scientific pitch (middle C = C4). */
  o: number;
}

export function midiOf(n: Note): number {
  return 12 * (n.o + 1) + (LETTER_PC[n.l] ?? 0) + n.a;
}

export function pcOf(n: Note): number {
  return (((LETTER_PC[n.l] ?? 0) + n.a) % 12 + 12) % 12;
}

/** "C4", "F#3", "Bb", "Ebb5", "Fx4" (x = double sharp). Octave defaults to 4. */
export function note(s: string): Note {
  const m = /^([A-Ga-g])(##|#|x|bb|b|♯|♭)?(-?\d)?$/.exec(s.trim());
  if (m === null) throw new Error('not a note: ' + s);
  const l = LETTERS.indexOf((m[1] ?? 'C').toUpperCase() as (typeof LETTERS)[number]);
  const acc = m[2] ?? '';
  const a = acc === '#' || acc === '♯' ? 1 : acc === '##' || acc === 'x' ? 2 : acc === 'b' || acc === '♭' ? -1 : acc === 'bb' ? -2 : 0;
  return { l, a, o: m[3] !== undefined ? Number(m[3]) : 4 };
}

export function accText(a: number, unicode = true): string {
  if (a === 0) return '';
  if (unicode) return a === 1 ? '♯' : a === 2 ? '𝄪' : a === -1 ? '♭' : '𝄫';
  return a === 1 ? '#' : a === 2 ? '##' : a === -1 ? 'b' : 'bb';
}

export function name(n: Note, octave = true): string {
  return (LETTERS[n.l] ?? 'C') + accText(n.a) + (octave ? String(n.o) : '');
}

/** "c#/4" for VexFlow. */
export function vexKey(n: Note): string {
  return (LETTERS[n.l] ?? 'C').toLowerCase() + accText(n.a, false) + '/' + n.o;
}

/** The sharp-side spelling of a MIDI note (black keys as sharps, or flats when asked). */
export function fromMidi(m: number, flats = false): Note {
  const pc = ((m % 12) + 12) % 12;
  const o = Math.floor(m / 12) - 1;
  const sharp = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const flat = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const [l, a] = (flats ? flat : sharp)[pc] ?? [0, 0];
  return { l: l ?? 0, a: a ?? 0, o };
}

export function pcName(pc: number, flats = false): string {
  return name(fromMidi(60 + pc, flats), false);
}

/* -------------------------------------------------------------- intervals */

export type Quality = 'P' | 'M' | 'm' | 'A' | 'd';
export interface Interval {
  n: number;
  q: Quality;
}

const BASE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
function perfectClass(n: number): boolean {
  const s = ((n - 1) % 7) + 1;
  return s === 1 || s === 4 || s === 5;
}

export function semis(iv: Interval): number {
  const simple = ((iv.n - 1) % 7) + 1;
  const oct = Math.floor((iv.n - 1) / 7);
  const base = (BASE_SEMIS[simple - 1] ?? 0) + 12 * oct;
  if (perfectClass(iv.n)) return base + (iv.q === 'A' ? 1 : iv.q === 'd' ? -1 : 0);
  return base + (iv.q === 'm' ? -1 : iv.q === 'A' ? 1 : iv.q === 'd' ? -2 : 0);
}

export function iv(s: string): Interval {
  const m = /^([PMmAd])(\d+)$/.exec(s);
  if (m === null) throw new Error('not an interval: ' + s);
  return { q: m[1] as Quality, n: Number(m[2]) };
}

/** The note an interval above (or below) another, spelled by the interval. */
export function transpose(n: Note, i: Interval, down = false): Note {
  const steps = i.n - 1;
  const idx = down ? n.l - steps : n.l + steps;
  const l = ((idx % 7) + 7) % 7;
  const o = n.o + Math.floor(idx / 7);
  const target = midiOf(n) + (down ? -semis(i) : semis(i));
  const plain = midiOf({ l, a: 0, o });
  return { l, a: target - plain, o };
}

/** The interval from a up to b (b at or above a). */
export function between(a: Note, b: Note): Interval {
  const n = (b.l + 7 * b.o) - (a.l + 7 * a.o) + 1;
  const s = midiOf(b) - midiOf(a);
  const simple = ((n - 1) % 7) + 1;
  const oct = Math.floor((n - 1) / 7);
  const base = (BASE_SEMIS[simple - 1] ?? 0) + 12 * oct;
  const d = s - base;
  let q: Quality;
  if (perfectClass(n)) q = d === 0 ? 'P' : d > 0 ? 'A' : 'd';
  else q = d === 0 ? 'M' : d === -1 ? 'm' : d > 0 ? 'A' : 'd';
  return { n, q };
}

const ORD = ['', 'unison', '2nd', '3rd', '4th', '5th', '6th', '7th', 'octave', '9th', '10th', '11th', '12th', '13th'];
const QNAME: Record<Quality, string> = { P: 'perfect', M: 'major', m: 'minor', A: 'augmented', d: 'diminished' };

export function ivName(i: Interval, short = false): string {
  if (short) return i.q + i.n;
  if (i.n === 1 && i.q === 'P') return 'unison';
  if (i.n === 8 && i.q === 'P') return 'octave';
  return QNAME[i.q] + ' ' + (ORD[i.n] ?? i.n + 'th');
}

/** Common simple intervals by semitones (for ear training): name and short form. */
export const SIMPLE: { s: number; short: string; name: string }[] = [
  { s: 1, short: 'm2', name: 'minor 2nd' },
  { s: 2, short: 'M2', name: 'major 2nd' },
  { s: 3, short: 'm3', name: 'minor 3rd' },
  { s: 4, short: 'M3', name: 'major 3rd' },
  { s: 5, short: 'P4', name: 'perfect 4th' },
  { s: 6, short: 'TT', name: 'tritone' },
  { s: 7, short: 'P5', name: 'perfect 5th' },
  { s: 8, short: 'm6', name: 'minor 6th' },
  { s: 9, short: 'M6', name: 'major 6th' },
  { s: 10, short: 'm7', name: 'minor 7th' },
  { s: 11, short: 'M7', name: 'major 7th' },
  { s: 12, short: 'P8', name: 'octave' },
];

/* ----------------------------------------------------------------- scales */

export const SCALES: Record<string, { name: string; ivs: string[]; family?: string }> = {
  major: { name: 'Major', ivs: ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7'] },
  nminor: { name: 'Natural minor', ivs: ['P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'] },
  hminor: { name: 'Harmonic minor', ivs: ['P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'M7'] },
  mminor: { name: 'Melodic minor', ivs: ['P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'M7'] },
  dorian: { name: 'Dorian', ivs: ['P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'm7'], family: 'mode' },
  phrygian: { name: 'Phrygian', ivs: ['P1', 'm2', 'm3', 'P4', 'P5', 'm6', 'm7'], family: 'mode' },
  lydian: { name: 'Lydian', ivs: ['P1', 'M2', 'M3', 'A4', 'P5', 'M6', 'M7'], family: 'mode' },
  mixolydian: { name: 'Mixolydian', ivs: ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'm7'], family: 'mode' },
  locrian: { name: 'Locrian', ivs: ['P1', 'm2', 'm3', 'P4', 'd5', 'm6', 'm7'], family: 'mode' },
  pentmajor: { name: 'Major pentatonic', ivs: ['P1', 'M2', 'M3', 'P5', 'M6'] },
  pentminor: { name: 'Minor pentatonic', ivs: ['P1', 'm3', 'P4', 'P5', 'm7'] },
  blues: { name: 'Blues', ivs: ['P1', 'm3', 'P4', 'A4', 'P5', 'm7'] },
  wholetone: { name: 'Whole tone', ivs: ['P1', 'M2', 'M3', 'A4', 'A5', 'A6'] },
};

/** One octave of a scale from a tonic (the octave note on top). */
export function scale(tonic: Note, type: string): Note[] {
  const def = SCALES[type];
  if (def === undefined) throw new Error('unknown scale ' + type);
  const out = def.ivs.map((x) => transpose(tonic, iv(x)));
  out.push({ ...tonic, o: tonic.o + 1 });
  return out;
}

/** The chromatic scale: sharps going up, flats coming down. */
export function chromatic(start: number, octaves: number, down = false): Note[] {
  const out: Note[] = [];
  for (let i = 0; i <= 12 * octaves; i++) out.push(fromMidi(down ? start - i : start + i, down));
  return out;
}

/* ------------------------------------------------------------------- keys */

export const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
export const MINOR_KEYS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';

export interface Key {
  tonic: Note;
  mode: 'major' | 'minor';
  fifths: number;
}

export function key(tonic: string, mode: 'major' | 'minor' = 'major'): Key {
  const t = note(tonic.replace(/m$/, ''));
  const list = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
  const idx = list.findIndex((k) => k === name(t, false).replace('♯', '#').replace('♭', 'b'));
  return { tonic: { ...t, o: 4 }, mode, fifths: idx >= 0 ? idx - 7 : 0 };
}

export function keyName(k: Key): string {
  return name(k.tonic, false) + ' ' + k.mode;
}

/** The letters a signature alters: [letter, +1 or -1]. */
export function signature(fifths: number): { letter: string; a: number }[] {
  const out: { letter: string; a: number }[] = [];
  for (let i = 0; i < Math.abs(fifths); i++) out.push({ letter: (fifths > 0 ? SHARP_ORDER : FLAT_ORDER)[i] ?? 'F', a: fifths > 0 ? 1 : -1 });
  return out;
}

export function keyFromFifths(fifths: number, mode: 'major' | 'minor' = 'major'): Key {
  const list = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
  return key(list[fifths + 7] ?? 'C', mode);
}

export function relative(k: Key): Key {
  return keyFromFifths(k.fifths, k.mode === 'major' ? 'minor' : 'major');
}

/** The VexFlow key name for a signature (VexFlow uses major names). */
export function vexKeySpec(fifths: number): string {
  return MAJOR_KEYS[fifths + 7] ?? 'C';
}

/** The ABC key name ("G", "Em", "Bb"). */
export function abcKey(k: Key): string {
  return name(k.tonic, false).replace('♯', '#').replace('♭', 'b') + (k.mode === 'minor' ? 'm' : '');
}

/* ----------------------------------------------------------------- chords */

export interface ChordType {
  id: string;
  name: string;
  symbol: string;
  ivs: string[];
}

export const CHORDS: ChordType[] = [
  { id: 'maj', name: 'major', symbol: '', ivs: ['P1', 'M3', 'P5'] },
  { id: 'min', name: 'minor', symbol: 'm', ivs: ['P1', 'm3', 'P5'] },
  { id: 'dim', name: 'diminished', symbol: '°', ivs: ['P1', 'm3', 'd5'] },
  { id: 'aug', name: 'augmented', symbol: '+', ivs: ['P1', 'M3', 'A5'] },
  { id: 'sus2', name: 'suspended 2nd', symbol: 'sus2', ivs: ['P1', 'M2', 'P5'] },
  { id: 'sus4', name: 'suspended 4th', symbol: 'sus4', ivs: ['P1', 'P4', 'P5'] },
  { id: '6', name: 'major sixth', symbol: '6', ivs: ['P1', 'M3', 'P5', 'M6'] },
  { id: 'm6', name: 'minor sixth', symbol: 'm6', ivs: ['P1', 'm3', 'P5', 'M6'] },
  { id: '7', name: 'dominant seventh', symbol: '7', ivs: ['P1', 'M3', 'P5', 'm7'] },
  { id: 'maj7', name: 'major seventh', symbol: 'maj7', ivs: ['P1', 'M3', 'P5', 'M7'] },
  { id: 'm7', name: 'minor seventh', symbol: 'm7', ivs: ['P1', 'm3', 'P5', 'm7'] },
  { id: 'mmaj7', name: 'minor-major seventh', symbol: 'm(maj7)', ivs: ['P1', 'm3', 'P5', 'M7'] },
  { id: 'm7b5', name: 'half-diminished seventh', symbol: 'm7♭5', ivs: ['P1', 'm3', 'd5', 'm7'] },
  { id: 'dim7', name: 'diminished seventh', symbol: '°7', ivs: ['P1', 'm3', 'd5', 'd7'] },
  { id: 'aug7', name: 'augmented seventh', symbol: '+7', ivs: ['P1', 'M3', 'A5', 'm7'] },
  { id: '7sus4', name: 'dominant seventh sus4', symbol: '7sus4', ivs: ['P1', 'P4', 'P5', 'm7'] },
  { id: 'add9', name: 'added ninth', symbol: 'add9', ivs: ['P1', 'M3', 'P5', 'M9'] },
  { id: '9', name: 'dominant ninth', symbol: '9', ivs: ['P1', 'M3', 'P5', 'm7', 'M9'] },
  { id: 'maj9', name: 'major ninth', symbol: 'maj9', ivs: ['P1', 'M3', 'P5', 'M7', 'M9'] },
  { id: 'm9', name: 'minor ninth', symbol: 'm9', ivs: ['P1', 'm3', 'P5', 'm7', 'M9'] },
  { id: '11', name: 'dominant eleventh', symbol: '11', ivs: ['P1', 'P5', 'm7', 'M9', 'P11'] },
  { id: '13', name: 'dominant thirteenth', symbol: '13', ivs: ['P1', 'M3', 'm7', 'M9', 'M13'] },
];

export function chordType(id: string): ChordType {
  return CHORDS.find((c) => c.id === id) ?? CHORDS[0]!;
}

/** The notes of a chord in close position from a root, optionally inverted (bass moves up). */
export function chord(root: Note, typeId: string, inversion = 0): Note[] {
  const t = chordType(typeId);
  let notes = t.ivs.map((x) => transpose(root, iv(x)));
  for (let i = 0; i < inversion && i < notes.length - 1; i++) {
    const first = notes.shift();
    if (first === undefined) break;
    let up = { ...first, o: first.o + 1 };
    const last = notes[notes.length - 1];
    while (last !== undefined && midiOf(up) <= midiOf(last)) up = { ...up, o: up.o + 1 };
    notes.push(up);
  }
  notes = notes.sort((a, b) => midiOf(a) - midiOf(b));
  return notes;
}

export function chordSymbol(root: Note, typeId: string, bass?: Note): string {
  const s = name(root, false) + chordType(typeId).symbol;
  return bass !== undefined && pcOf(bass) !== pcOf(root) ? s + '/' + name(bass, false) : s;
}

/** "Dm7", "F#°", "Bb/D", "C7sus4" → root, type, bass. */
export function parseChord(sym: string): { root: Note; type: string; bass: Note | null } | null {
  const m = /^([A-G](?:#|b|♯|♭)?)(.*?)(?:\/([A-G](?:#|b|♯|♭)?))?$/.exec(sym.trim());
  if (m === null) return null;
  const root = note(m[1] ?? 'C');
  const rest = (m[2] ?? '').replace('dim7', '°7').replace('dim', '°').replace('aug', '+').replace('ø7', 'm7♭5').replace('m7b5', 'm7♭5').replace('min', 'm').replace('M7', 'maj7');
  const t = CHORDS.find((c) => c.symbol === rest);
  if (t === undefined) return null;
  return { root, type: t.id, bass: m[3] !== undefined ? note(m[3]) : null };
}

/**
 * Which chord a set of keys spells: tries every pitch class as the root and
 * every chord type. Returns the root, type and inversion (from the lowest
 * key), or null.
 */
export function identify(midis: number[], types: string[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6', 'm6', 'mmaj7', 'aug7', '7sus4']): { root: number; type: string; inversion: number; bass: number } | null {
  if (midis.length < 2) return null;
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  for (const id of types) {
    const t = chordType(id);
    const rel = t.ivs.map((x) => semis(iv(x)) % 12);
    if (rel.length !== pcs.length) continue;
    for (const root of pcs) {
      const set = rel.map((r) => (root + r) % 12).sort((a, b) => a - b);
      if (set.every((v, i) => v === pcs[i])) {
        const inv = rel.indexOf(((bass - root) % 12 + 12) % 12);
        return { root, type: id, inversion: inv < 0 ? 0 : inv, bass };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------ chords of a key */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export interface Diatonic {
  degree: number;
  roman: string;
  root: Note;
  type: string;
  notes: Note[];
}

function qualityOf(notes: Note[]): string {
  const r = notes[0]!;
  const ivs = notes.slice(1).map((n) => ivName(between(r, n), true));
  const sig = ivs.join(',');
  const map: Record<string, string> = {
    'M3,P5': 'maj', 'm3,P5': 'min', 'm3,d5': 'dim', 'M3,A5': 'aug',
    'M3,P5,M7': 'maj7', 'M3,P5,m7': '7', 'm3,P5,m7': 'm7', 'm3,d5,m7': 'm7b5', 'm3,d5,d7': 'dim7', 'm3,P5,M7': 'mmaj7', 'M3,A5,M7': 'aug7',
  };
  return map[sig] ?? 'maj';
}

function romanOf(degree: number, type: string): string {
  const base = ROMAN[degree] ?? 'I';
  const lower = type === 'min' || type === 'dim' || type === 'm7' || type === 'm7b5' || type === 'dim7' || type === 'mmaj7';
  const r = lower ? base.toLowerCase() : base;
  const suffix: Record<string, string> = { maj: '', min: '', dim: '°', aug: '+', maj7: 'maj7', '7': '7', m7: '7', m7b5: 'ø7', dim7: '°7', mmaj7: '(maj7)', aug7: '+7' };
  return r + (suffix[type] ?? '');
}

/**
 * Triads (or seventh chords) on each degree. Minor keys use the harmonic
 * minor (raised 7th) for V and vii°; `subtonic` makes degree 7 the natural
 * minor's VII (as in i–VI–III–VII).
 */
export function diatonic(k: Key, sevenths = false, subtonic = false): Diatonic[] {
  const sc = scale(k.tonic, k.mode === 'major' ? 'major' : 'hminor').slice(0, 7);
  const nat = k.mode === 'minor' ? scale(k.tonic, 'nminor').slice(0, 7) : sc;
  const out: Diatonic[] = [];
  for (let d = 0; d < 7; d++) {
    // In minor, III and VI use the natural 7th; V and vii use the raised one.
    const src = k.mode === 'minor' && (d === 2 || d === 5 || d === 0 || d === 3 || (subtonic && d === 6)) ? nat : sc;
    const pick = (i: number): Note => {
      const idx = d + i;
      const n = src[idx % 7]!;
      return { ...n, o: n.o + Math.floor(idx / 7) };
    };
    const notes = sevenths ? [pick(0), pick(2), pick(4), pick(6)] : [pick(0), pick(2), pick(4)];
    const type = qualityOf(notes);
    out.push({ degree: d + 1, roman: romanOf(d, type), root: notes[0]!, type, notes });
  }
  return out;
}

/* ----------------------------------------------------------- progressions */

export const PROGRESSIONS: { id: string; name: string; mode: 'major' | 'minor'; degrees: number[]; sevenths?: boolean; subtonic?: boolean; level: 1 | 2 }[] = [
  { id: 'I-IV-V-I', name: 'I – IV – V – I', mode: 'major', degrees: [1, 4, 5, 1], level: 1 },
  { id: 'I-V-I', name: 'I – V – I', mode: 'major', degrees: [1, 5, 1], level: 1 },
  { id: 'I-IV-I-V-I', name: 'I – IV – I – V – I', mode: 'major', degrees: [1, 4, 1, 5, 1], level: 1 },
  { id: 'i-iv-V-i', name: 'i – iv – V – i', mode: 'minor', degrees: [1, 4, 5, 1], level: 1 },
  { id: 'I-V-vi-IV', name: 'I – V – vi – IV', mode: 'major', degrees: [1, 5, 6, 4], level: 2 },
  { id: 'I-vi-IV-V', name: 'I – vi – IV – V', mode: 'major', degrees: [1, 6, 4, 5], level: 2 },
  { id: 'ii-V-I', name: 'ii7 – V7 – Imaj7', mode: 'major', degrees: [2, 5, 1], sevenths: true, level: 2 },
  { id: 'vi-ii-V-I', name: 'vi – ii – V – I', mode: 'major', degrees: [6, 2, 5, 1], level: 2 },
  { id: 'canon', name: 'I – V – vi – iii – IV – I – IV – V', mode: 'major', degrees: [1, 5, 6, 3, 4, 1, 4, 5], level: 2 },
  { id: 'i-VI-III-VII', name: 'i – VI – III – VII', mode: 'minor', degrees: [1, 6, 3, 7], subtonic: true, level: 2 },
];

/**
 * Voice a progression: the left hand plays each root low, the right hand a
 * close triad moving as little as possible (the nearest inversion).
 */
export function voice(k: Key, degrees: number[], sevenths = false, subtonic = false): { bass: Note; upper: Note[]; roman: string; symbol: string }[] {
  const chords = diatonic(k, sevenths, subtonic);
  const out: { bass: Note; upper: Note[]; roman: string; symbol: string }[] = [];
  let prev: number[] | null = null;
  for (const d of degrees) {
    const c = chords[(d - 1 + 7) % 7]!;
    const pcs = c.notes.map(pcOf);
    // Candidates: every inversion of the chord between G3 and E5.
    let best: number[] = [];
    let bestCost = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      for (let base = 55; base <= 67; base++) {
        if (((base % 12) + 12) % 12 !== pcs[inv]) continue;
        const v: number[] = [base];
        for (let j = 1; j < pcs.length; j++) {
          const pc = pcs[(inv + j) % pcs.length]!;
          let mm = v[v.length - 1]! + 1;
          while (((mm % 12) + 12) % 12 !== pc) mm++;
          v.push(mm);
        }
        const cost = prev === null ? Math.abs(v[0]! - 60) + Math.abs(v[v.length - 1]! - 71) * 0.3 : v.reduce((a, x, j) => a + Math.abs(x - (prev![j] ?? prev![prev!.length - 1]!)), 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = v;
        }
      }
    }
    prev = best;
    const spell = (m: number): Note => {
      const pc = ((m % 12) + 12) % 12;
      const n = c.notes.find((x) => pcOf(x) === pc) ?? fromMidi(m);
      const o = Math.floor((m - (LETTER_PC[n.l]! + n.a)) / 12) - 1;
      return { ...n, o };
    };
    const rootPc = pcOf(c.root);
    let bm = 48 + ((rootPc - 0 + 12) % 12);
    if (bm > 52) bm -= 12;
    out.push({ bass: spell(bm), upper: best.map(spell), roman: c.roman, symbol: chordSymbol(c.root, c.type) });
  }
  return out;
}

/* -------------------------------------------------------------- fingering */

/** One-octave fingerings, ascending, tonic to tonic: [right hand, left hand]. */
const MAJOR_FINGERS: Record<string, [number[], number[]]> = {
  C: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  G: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  D: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  A: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  E: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  B: [[1, 2, 3, 1, 2, 3, 4, 5], [4, 3, 2, 1, 4, 3, 2, 1]],
  'F#': [[2, 3, 4, 1, 2, 3, 1, 2], [4, 3, 2, 1, 3, 2, 1, 4]],
  Gb: [[2, 3, 4, 1, 2, 3, 1, 2], [4, 3, 2, 1, 3, 2, 1, 4]],
  Db: [[2, 3, 1, 2, 3, 4, 1, 2], [3, 2, 1, 4, 3, 2, 1, 3]],
  'C#': [[2, 3, 1, 2, 3, 4, 1, 2], [3, 2, 1, 4, 3, 2, 1, 3]],
  Ab: [[3, 4, 1, 2, 3, 1, 2, 3], [3, 2, 1, 4, 3, 2, 1, 3]],
  Eb: [[3, 1, 2, 3, 4, 1, 2, 3], [3, 2, 1, 4, 3, 2, 1, 3]],
  Bb: [[4, 1, 2, 3, 1, 2, 3, 4], [3, 2, 1, 4, 3, 2, 1, 3]],
  F: [[1, 2, 3, 4, 1, 2, 3, 4], [5, 4, 3, 2, 1, 3, 2, 1]],
};
/** Harmonic (and natural) minor. */
const MINOR_FINGERS: Record<string, [number[], number[]]> = {
  A: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  E: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  B: [[1, 2, 3, 1, 2, 3, 4, 5], [4, 3, 2, 1, 4, 3, 2, 1]],
  D: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  G: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  C: [[1, 2, 3, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 3, 2, 1]],
  F: [[1, 2, 3, 4, 1, 2, 3, 4], [5, 4, 3, 2, 1, 3, 2, 1]],
  'F#': [[3, 4, 1, 2, 3, 1, 2, 3], [4, 3, 2, 1, 3, 2, 1, 4]],
  'C#': [[3, 4, 1, 2, 3, 1, 2, 3], [3, 2, 1, 4, 3, 2, 1, 3]],
  'G#': [[3, 4, 1, 2, 3, 1, 2, 3], [3, 2, 1, 3, 2, 1, 4, 3]],
  'D#': [[3, 1, 2, 3, 4, 1, 2, 3], [2, 1, 4, 3, 2, 1, 3, 2]],
  Eb: [[3, 1, 2, 3, 4, 1, 2, 3], [2, 1, 4, 3, 2, 1, 3, 2]],
  Bb: [[4, 1, 2, 3, 1, 2, 3, 4], [2, 1, 3, 2, 1, 4, 3, 2]],
};

/**
 * Fingers for an ascending scale of `count` notes (several octaves): the
 * right hand repeats from the start and ends on its top finger; the left
 * hand starts on its first finger and then repeats the rest. Null when no
 * standard fingering is known.
 */
export function scaleFingers(tonic: Note, type: string, hand: 'R' | 'L', count: number): number[] | null {
  const tn = name(tonic, false).replace('♯', '#').replace('♭', 'b');
  const table = type === 'major' ? MAJOR_FINGERS : type === 'hminor' || type === 'nminor' ? MINOR_FINGERS : null;
  const row = table?.[tn];
  if (row === undefined) return null;
  const pat = hand === 'R' ? row[0] : row[1];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (hand === 'R') out.push(i === count - 1 ? pat[7]! : pat[i % 7]!);
    else out.push(i === 0 ? pat[0]! : pat[((i - 1) % 7) + 1]!);
  }
  return out;
}

/** Arpeggio fingers for triads on white-key roots (C, D, E, F, G, A): right 1-2-3, left 5-4-2-1. */
export function arpeggioFingers(root: Note, hand: 'R' | 'L', count: number): number[] | null {
  if (root.a !== 0 || root.l === 6) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (hand === 'R') out.push(i === count - 1 ? 5 : [1, 2, 3][i % 3]!);
    else out.push(i === 0 ? 5 : [4, 2, 1][(i - 1) % 3]!);
  }
  return out;
}

/* ------------------------------------------------------------------ misc */

export function rand<T>(list: readonly T[], seed?: () => number): T {
  const r = seed ? seed() : Math.random();
  return list[Math.floor(r * list.length)]!;
}

/** A small seeded random generator (so an exercise can be made again). */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const TWELVE_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const TWELVE_MINOR = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'];

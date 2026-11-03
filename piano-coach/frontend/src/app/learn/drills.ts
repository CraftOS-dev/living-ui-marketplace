/**
 * The quiz drills: each skill makes items to answer by choosing, by playing
 * on the keys, or either. Reading, keys, intervals, ear, key signatures,
 * Roman numerals, terms and chords. (Rhythm, technique, progressions and
 * sight-reading are played in the practice screen; see music/generate.ts.)
 */
import * as T from '../music/theory.ts';
import type { Note } from '../music/theory.ts';
import { GLOSSARY } from './glossary.ts';
import type { Sound, StaffPic } from './schema.ts';

export interface PlayAnswer {
  /** The keys that answer (exact keys, or letters when `octave`). */
  notes: number[];
  mode: 'any' | 'chord' | 'order';
  octave?: boolean;
  /** Chords: the lowest key must be this pitch class (inversions, slash chords). */
  bass?: number;
  from: number;
  to: number;
  /** Keys shown as given (the lower note of an interval, a melody's first note). */
  given?: number[];
}

export interface Item {
  key: string;
  prompt: string;
  big?: string;
  staff?: StaffPic;
  sound?: Sound;
  options?: string[];
  answer?: number;
  play?: PlayAnswer;
  /** Shown after answering. */
  explain?: string;
}

export const QUIZ_DRILLS = ['keys', 'notes', 'intervals', 'ear', 'keysig', 'roman', 'terms', 'chords'];

/* --------------------------------------------------------------- helpers */

const r = <X>(list: readonly X[]): X => list[Math.floor(Math.random() * list.length)]!;
const ri = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
function shuffle<X>(list: X[]): X[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** ASCII with octave, for staff pictures: 'F#4'. */
export function str(n: Note): string {
  return T.LETTERS[n.l] + (n.a === 1 ? '#' : n.a === 2 ? '##' : n.a === -1 ? 'b' : n.a === -2 ? 'bb' : '') + n.o;
}
const nm = (n: Note): string => T.name(n, false);
const midi = T.midiOf;
const pc = (m: number): number => ((m % 12) + 12) % 12;

/** Options: the answer plus distinct distractors, shuffled. */
function choices(right: string, pool: string[], count: number): { options: string[]; answer: number } {
  const others = shuffle(pool.filter((p) => p !== right));
  const options = shuffle([right, ...others.slice(0, count - 1)]);
  return { options, answer: options.indexOf(right) };
}

/** Naturals between two notes. */
function naturals(lo: string, hi: string): Note[] {
  const a = midi(T.note(lo));
  const b = midi(T.note(hi));
  const out: Note[] = [];
  for (let m = a; m <= b; m++) {
    const n = T.fromMidi(m);
    if (n.a === 0) out.push(n);
  }
  return out;
}

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/* ---------------------------------------------------------------- reading */

const READ: Record<string, { clef: 'treble' | 'bass' | 'grand'; pool: () => Note[]; from: number; to: number }> = {
  'read.treble.1': { clef: 'treble', pool: () => naturals('C4', 'G4'), from: 60, to: 71 },
  'read.treble.2': { clef: 'treble', pool: () => naturals('C4', 'G5'), from: 60, to: 83 },
  'read.treble.3': { clef: 'treble', pool: () => [...naturals('G3', 'C4'), ...naturals('A5', 'E6'), ...naturals('D4', 'G5').filter(() => Math.random() < 0.3)], from: 55, to: 88 },
  'read.bass.1': { clef: 'bass', pool: () => naturals('C3', 'G3'), from: 48, to: 59 },
  'read.bass.2': { clef: 'bass', pool: () => naturals('F2', 'C4'), from: 41, to: 60 },
  'read.bass.3': { clef: 'bass', pool: () => [...naturals('C2', 'E2'), ...naturals('D4', 'G4'), ...naturals('G2', 'B3').filter(() => Math.random() < 0.3)], from: 36, to: 67 },
  'read.grand': { clef: 'grand', pool: () => naturals('F2', 'G5'), from: 41, to: 79 },
};

function readItem(skill: string): Item {
  if (skill === 'read.acc') {
    const clef = Math.random() < 0.6 ? 'treble' : 'bass';
    const base = r(clef === 'treble' ? naturals('C4', 'G5') : naturals('F2', 'C4'));
    const a = r([1, -1, 1, -1, 0]);
    const n: Note = { ...base, a };
    const right = nm(n);
    const letter = T.LETTERS[n.l];
    const next = T.LETTERS[(n.l + 1) % 7];
    const prev = T.LETTERS[(n.l + 6) % 7];
    const pool = [`${letter}`, `${letter}♯`, `${letter}♭`, `${next}${a === 1 ? '♯' : '♭'}`, `${prev}${a === -1 ? '♭' : '♯'}`, `${next}`];
    return { key: str(n), prompt: 'Name or play this note', staff: { clef, items: [{ notes: [str(n)] }] }, ...choices(right, pool, 4), play: { notes: [midi(n)], mode: 'any', from: clef === 'treble' ? 57 : 36, to: clef === 'treble' ? 83 : 64 } };
  }
  const def = READ[skill] ?? READ['read.treble.1']!;
  const n = r(def.pool());
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  return { key: str(n), prompt: 'Name or play this note', staff: { clef: def.clef, items: [{ notes: [str(n)] }] }, options: letters, answer: n.l, play: { notes: [midi(n)], mode: 'any', from: def.from, to: def.to } };
}

/* ------------------------------------------------------------------- keys */

function keysItem(skill: string): Item {
  if (skill === 'keys.find') {
    const n = r(naturals('C4', 'B4'));
    return { key: nm(n), prompt: 'Play', big: nm(n), play: { notes: [midi(n)], mode: 'any', octave: true, from: 48, to: 83 } };
  }
  const m = ri(48, 83);
  const n = T.fromMidi(m, Math.random() < 0.5);
  return { key: str(n), prompt: 'Play', big: `${nm(n)}${n.o}`, play: { notes: [m], mode: 'any', from: 48, to: 83 }, explain: n.o === 4 ? 'Octave 4 starts at middle C.' : `Octave ${n.o} starts at C${n.o}.` };
}

/* -------------------------------------------------------------- intervals */

const IV_POOL = ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
const IV_NAMES = IV_POOL.map((s) => cap(T.ivName(T.iv(s))));

function intervalItem(skill: string): Item {
  const lowPool = [...naturals('C4', 'B4'), T.note('Bb4'), T.note('Eb4'), T.note('F#4')];
  const lo = r(lowPool);
  const code = r(IV_POOL);
  const hi = T.transpose(lo, T.iv(code));
  const right = cap(T.ivName(T.iv(code)));
  if (skill === 'int.play') {
    const base = midi(lo) - (midi(lo) % 12);
    return { key: code + str(lo), prompt: `Play the note a ${T.ivName(T.iv(code))} above`, big: nm(lo), play: { notes: [midi(hi)], mode: 'any', from: base, to: base + 23, given: [midi(lo)] }, explain: `${nm(lo)} up a ${T.ivName(T.iv(code))} is ${nm(hi)}.` };
  }
  const harmonic = Math.random() < 0.5;
  const staff: StaffPic = { clef: 'treble', items: harmonic ? [{ notes: [str(lo), str(hi)] }] : [{ notes: [str(lo)] }, { notes: [str(hi)] }] };
  return { key: code + str(lo), prompt: 'Name the interval', staff, ...choices(right, IV_NAMES, 6), sound: { seq: harmonic ? [[str(lo), str(hi)]] : [str(lo), str(hi)], bpm: harmonic ? 45 : 80 }, explain: `${nm(lo)} to ${nm(hi)}: ${T.semis(T.iv(code))} half steps.` };
}

/* -------------------------------------------------------------------- ear */

const EAR_INT: Record<string, string[]> = {
  'ear.int.1': ['M2', 'M3', 'P5', 'P8'],
  'ear.int.2': ['M2', 'M3', 'P4', 'P5', 'M6', 'M7', 'P8'],
  'ear.int.3': ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
};
const EAR_CHORD: Record<string, string[]> = {
  'ear.chord.1': ['maj', 'min'],
  'ear.chord.2': ['maj', 'min', 'dim', 'aug'],
  'ear.chord.3': ['maj7', '7', 'm7', 'm7b5', 'dim7'],
};
const EAR_SCALES = ['major', 'nminor', 'hminor', 'mminor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'pentmajor', 'blues'];
const CADENCES: { name: string; degrees: number[] }[] = [
  { name: 'Perfect (V–I)', degrees: [1, 4, 5, 1] },
  { name: 'Plagal (IV–I)', degrees: [1, 6, 4, 1] },
  { name: 'Imperfect (ends on V)', degrees: [1, 6, 2, 5] },
  { name: 'Interrupted (V–vi)', degrees: [1, 4, 5, 6] },
];

function ivLabel(code: string): string {
  return code === 'A4' ? 'Tritone' : cap(T.ivName(T.iv(code)));
}

function earItem(skill: string): Item {
  if (skill in EAR_INT) {
    const pool = EAR_INT[skill]!;
    const code = r(pool);
    const lo = T.fromMidi(ri(52, 67));
    const hi = T.transpose(lo, T.iv(code));
    const how = skill === 'ear.int.3' ? r(['up', 'down', 'together']) : 'up';
    const seq: Sound['seq'] = how === 'together' ? [[str(lo), str(hi)]] : how === 'down' ? [str(hi), str(lo)] : [str(lo), str(hi)];
    const names = pool.map(ivLabel);
    return { key: code + how, prompt: how === 'together' ? 'Which interval? (together)' : how === 'down' ? 'Which interval? (falling)' : 'Which interval?', sound: { seq, bpm: how === 'together' ? 40 : 75 }, options: names, answer: pool.indexOf(code), explain: `${ivLabel(code)}: ${nm(lo)}–${nm(hi)}` };
  }
  if (skill in EAR_CHORD) {
    const pool = EAR_CHORD[skill]!;
    const type = r(pool);
    const root = T.fromMidi(ri(55, 64));
    const notes = T.chord(root, type).map(str);
    const names = pool.map((t) => cap(T.chordType(t).name));
    return { key: type + str(root), prompt: 'Which chord?', sound: { seq: [notes, ...notes, notes], bpm: 110, hold: 1 }, options: names, answer: pool.indexOf(type), explain: `${nm(root)}${T.chordType(type).symbol}: ${T.chord(root, type).map(nm).join(' ')}` };
  }
  if (skill === 'ear.scale') {
    const type = r(EAR_SCALES);
    const tonic = T.fromMidi(ri(57, 64));
    const notes = T.scale(tonic, type).map(str);
    const names = EAR_SCALES.map((t) => T.SCALES[t]!.name);
    return { key: type + str(tonic), prompt: 'Which scale?', sound: { seq: notes, bpm: 170 }, options: names, answer: EAR_SCALES.indexOf(type), explain: `${nm(tonic)} ${T.SCALES[type]!.name.toLowerCase()}: ${T.scale(tonic, type).map(nm).join(' ')}` };
  }
  if (skill === 'ear.cadence') {
    const k = T.key(r(['C', 'G', 'F', 'D', 'Bb']), 'major');
    const cad = r(CADENCES);
    const v = T.voice(k, cad.degrees);
    const seq = v.map((c) => [str(c.bass), ...c.upper.map(str)]);
    return { key: cad.name + T.keyName(k), prompt: 'Which cadence ends this phrase?', sound: { seq, bpm: 56 }, options: CADENCES.map((c) => c.name), answer: CADENCES.indexOf(cad), explain: v.map((c) => c.roman).join(' – ') };
  }
  // Melodies: hear, then play back from the given first note.
  const long = skill === 'ear.melody.2';
  const len = long ? ri(5, 7) : 4;
  const scaleNotes = T.scale(T.note('C4'), 'major').concat(T.scale(T.note('C5'), 'major').slice(1, 5));
  const top = long ? 11 : 4;
  let idx = r(long ? [0, 2, 4, 7] : [0, 2, 4]);
  const seq: Note[] = [scaleNotes[idx]!];
  for (let i = 1; i < len; i++) {
    let next = idx;
    for (let tries = 0; tries < 12; tries++) {
      const step = long ? r([-3, -2, -1, -1, 1, 1, 2, 3]) : r([-2, -1, -1, 1, 1, 2]);
      next = Math.max(0, Math.min(top, idx + step));
      // No repeated note and no tritone leap.
      if (next !== idx && Math.abs(midi(scaleNotes[next]!) - midi(scaleNotes[idx]!)) !== 6) break;
    }
    if (next === idx) next = idx === 0 ? 1 : idx - 1;
    idx = next;
    seq.push(scaleNotes[idx]!);
  }
  const ms = seq.map(midi);
  return { key: ms.join(','), prompt: 'Play it back', sound: { seq: seq.map(str), bpm: long ? 100 : 88 }, play: { notes: ms, mode: 'order', from: 60, to: long ? 83 : 71, given: [ms[0]!] }, explain: seq.map(nm).join(' ') };
}

/* ---------------------------------------------------------- key signatures */

function keySigItem(): Item {
  const kind = r(['major', 'minor', 'count', 'major']);
  const fifths = r([-6, -5, -4, -3, -3, -2, -2, -1, -1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7, -7, 0]);
  if (kind === 'count') {
    const mode = Math.random() < 0.7 ? 'major' : 'minor';
    const k = T.keyFromFifths(fifths, mode);
    const label = (f: number): string => (f === 0 ? 'None' : f > 0 ? `${f} ♯` : `${-f} ♭`);
    const pool = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].filter((f) => Math.abs(f - fifths) <= 3 || f === -fifths).map(label);
    return { key: 'c' + fifths + mode, prompt: 'How many sharps or flats?', big: cap(T.keyName(k)), ...choices(label(fifths), pool, 4), explain: `${cap(T.keyName(k))}: ${fifths === 0 ? 'no sharps or flats' : T.signature(fifths).map((s) => s.letter + (s.a > 0 ? '♯' : '♭')).join(' ')}` };
  }
  const mode = kind === 'minor' ? 'minor' : 'major';
  const k = T.keyFromFifths(fifths, mode);
  const right = cap(T.keyName(k));
  const pool = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].filter((f) => f !== fifths && Math.abs(f - fifths) <= 3).map((f) => cap(T.keyName(T.keyFromFifths(f, mode))));
  pool.push(cap(T.keyName(T.relative(k))));
  const item: Item = { key: 'k' + fifths + mode, prompt: mode === 'major' ? 'Which major key?' : 'Which minor key?', staff: { clef: Math.random() < 0.7 ? 'treble' : 'bass', fifths, items: [] }, ...choices(right, pool, 4), explain: mode === 'major' ? `Relative minor: ${T.keyName(T.relative(k))}` : `Relative major: ${T.keyName(T.relative(k))}` };
  return item;
}

/* --------------------------------------------------------- Roman numerals */

function romanItem(): Item {
  const minor = Math.random() < 0.3;
  const k = T.key(minor ? r(['A', 'E', 'D', 'G', 'C', 'B']) : r(['C', 'G', 'D', 'F', 'Bb', 'A', 'Eb', 'E']), minor ? 'minor' : 'major');
  const chords = T.diatonic(k);
  const d = r(minor ? [0, 3, 4, 5, 2, 6] : [0, 1, 3, 4, 5, 2, 6]);
  const c = chords[d]!;
  const sym = T.chordSymbol(c.root, c.type);
  const kind = r(['name', 'play', 'roman']);
  const where = cap(T.keyName(k));
  if (kind === 'play') {
    return { key: 'p' + where + d, prompt: `Play ${c.roman} in ${where}`, big: c.roman, play: { notes: c.notes.map(midi), mode: 'chord', octave: true, from: 48, to: 83 }, explain: `${c.roman} in ${where} is ${sym}: ${c.notes.map(nm).join(' ')}` };
  }
  if (kind === 'roman') {
    const romans = chords.map((x) => x.roman);
    return { key: 'r' + where + d, prompt: `In ${where}, ${sym} is…`, big: sym, ...choices(c.roman, romans, 4), explain: `${sym} is built on degree ${c.degree} of ${where}.` };
  }
  return { key: 'n' + where + d, prompt: `In ${where}, ${c.roman} is…`, big: c.roman, ...choices(sym, chords.map((x) => T.chordSymbol(x.root, x.type)), 4), explain: `${sym}: ${c.notes.map(nm).join(' ')}` };
}

/* ------------------------------------------------------------------ terms */

function termItem(level: number): Item {
  const pool = GLOSSARY.filter((t) => t.level <= Math.max(3, level + 1));
  const t = r(pool.length > 0 ? pool : GLOSSARY);
  const same = GLOSSARY.filter((x) => x.cat === t.cat && x.term !== t.term).map((x) => x.meaning);
  const any = GLOSSARY.filter((x) => x.term !== t.term).map((x) => x.meaning);
  const distract = shuffle(same).slice(0, 3);
  while (distract.length < 3) {
    const x = r(any);
    if (!distract.includes(x) && x !== t.meaning) distract.push(x);
  }
  const options = shuffle([t.meaning, ...distract]);
  return { key: t.term, prompt: 'What does it mean?', big: t.sign !== undefined && t.sign !== t.term ? `${t.term}  ${t.sign}` : t.term, options, answer: options.indexOf(t.meaning) };
}

/* ----------------------------------------------------------------- chords */

const PLAY_TYPES: Record<string, string[]> = {
  'chord.play.1': ['maj', 'min'],
  'chord.play.2': ['maj', 'min', 'dim', 'aug'],
  'chord.play.3': ['7', 'maj7', 'm7', 'm7b5', 'dim7'],
  'chord.play.4': ['6', 'm6', 'add9', 'sus2', 'sus4', '7sus4', '9', 'maj9', 'm9'],
};

function chordItem(skill: string): Item {
  if (skill === 'chord.name') {
    const type = r(['maj', 'min', 'dim', 'aug', 'maj', 'min', '7', 'maj7', 'm7']);
    const root = T.note(r(type === 'min' || type === 'dim' ? MINOR_ROOTS : ROOTS) + '4');
    const inv = type.length <= 3 && !type.includes('7') ? r([0, 0, 1, 2]) : 0;
    const notes = T.chord(root, type, inv);
    const lowest = notes[0]!;
    if (midi(notes[notes.length - 1]!) > 81) notes.forEach((n) => (n.o -= 1));
    const sym = T.chordSymbol(root, type, inv > 0 ? lowest : undefined);
    const alts = ['maj', 'min', 'dim', 'aug', '7', 'maj7', 'm7'].filter((t) => t !== type).map((t) => T.chordSymbol(root, t, inv > 0 ? lowest : undefined));
    alts.push(T.chordSymbol(lowest, type));
    return { key: sym, prompt: 'Name the chord', staff: { clef: 'treble', items: [{ notes: notes.map(str) }] }, ...choices(sym, alts, 4), sound: { seq: [notes.map(str)], bpm: 40 }, explain: `${sym}: ${notes.map(nm).join(' ')}` };
  }
  const types = PLAY_TYPES[skill] ?? PLAY_TYPES['chord.play.1']!;
  const type = r(types);
  const root = T.note(r(type === 'min' || type === 'dim' || type === 'm7' || type === 'm7b5' || type === 'm6' || type === 'm9' ? MINOR_ROOTS : ROOTS) + '4');
  const notes = T.chord(root, type);
  const inv = skill === 'chord.play.2' ? r([0, 0, 1, 2]) : skill === 'chord.play.4' && notes.length === 4 && Math.random() < 0.3 ? 1 : 0;
  const voiced = T.chord(root, type, inv);
  const bass = inv > 0 ? voiced[0] : undefined;
  const sym = T.chordSymbol(root, type, bass);
  const play: PlayAnswer = { notes: voiced.map(midi), mode: 'chord', octave: true, from: 48, to: 83 };
  if (bass !== undefined) play.bass = pc(midi(bass));
  return { key: sym, prompt: inv === 1 ? 'Play (first inversion)' : inv === 2 ? 'Play (second inversion)' : 'Play', big: sym, play, explain: `${sym}: ${voiced.map(nm).join(' ')}` };
}

/* ------------------------------------------------------------------ public */

/** Fresh items for a skill (no item twice in a row). */
export function makeItems(skill: string, drill: string, count: number, level = 1): Item[] {
  const one = (): Item => {
    if (drill === 'notes') return readItem(skill);
    if (drill === 'keys') return keysItem(skill);
    if (drill === 'intervals') return intervalItem(skill);
    if (drill === 'ear') return earItem(skill);
    if (drill === 'keysig') return keySigItem();
    if (drill === 'roman') return romanItem();
    if (drill === 'terms') return termItem(level);
    return chordItem(skill);
  };
  const out: Item[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard < count * 30) {
    guard++;
    const it = one();
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.key === it.key) continue;
    if (seen.has(it.key) && guard < count * 10) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out;
}

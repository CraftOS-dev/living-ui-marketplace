/**
 * Exercises written as ABC: the vocalise catalogue, sight-singing levels
 * 1-30, scales against a drone, two-part harmony and unaccompanied tunes.
 * The app parses them with the server's own parser (abc.parse), so the
 * practice screen sings them like any song.
 *
 * Patterns are written in scale degrees (1 2 b3 … 8 9 #4), so every note is
 * spelled right in every key. A vocalise moves up a semitone a repetition
 * from the low-middle of the comfortable range to a ceiling (the comfortable
 * top less the pattern's span; at levels 1-3 no higher than the passaggio),
 * then back down, in the style of a voice teacher at the piano. Each
 * repetition is its own key, with its chord for the piano.
 */
import type { Spec } from './spec.ts';
import { seeded } from './theory.ts';

export interface VoiceRange {
  comf_low: number;
  comf_high: number;
  passaggio: { primo: number; secondo: number };
  clef: 'treble' | 'treble8' | 'bass';
}

export interface Built {
  abc: string;
  title: string;
  skill: string;
  ex: string;
  /** Each repetition's starting note and its bars (vocalises). */
  reps: { start: string; startMidi: number; from: number; to: number }[];
  /** Notes not scored (warm-up sirens): judged on voice only. */
  free: boolean;
  /** Held-note work (messa di voce): the dial's hold mode. */
  hold: boolean;
  drone: boolean;
  /** Sing it in this mode (harmony from memory in echo, unaccompanied in solo). */
  mode: 'sing' | 'echo' | 'solo';
  guide: 'voice' | 'piano' | 'start' | 'off';
  tempo: number;
  level: number;
}

/* ---------------------------------------------------------------- spelling */

const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_NAME = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAME = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const LETTER_OF: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function noteName(m: number): string {
  return NOTE_NAMES[((m % 12) + 12) % 12]! + String(Math.floor(m / 12) - 1);
}

interface KeySpec {
  name: string;
  tonicPc: number;
  minor: boolean;
  letter: number;
  /** Alteration per letter from the signature. */
  sig: number[];
}

function fifthsOf(name: string, minor: boolean): number {
  const MAJ: Record<string, number> = { Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
  const MIN: Record<string, number> = { Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1, A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7 };
  return (minor ? MIN[name] : MAJ[name]) ?? 0;
}

function keySpec(tonicPc: number, minor: boolean): KeySpec {
  const pc = ((tonicPc % 12) + 12) % 12;
  const name = (minor ? MINOR_NAME : MAJOR_NAME)[pc]!;
  const f = fifthsOf(name, minor);
  const sig = [0, 0, 0, 0, 0, 0, 0];
  if (f > 0) for (let i = 0; i < f; i++) sig[LETTER_OF[SHARPS[i]!]!] = 1;
  if (f < 0) for (let i = 0; i < -f; i++) sig[LETTER_OF[FLATS[i]!]!] = -1;
  return { name: name + (minor ? 'm' : ''), tonicPc: pc, minor, letter: LETTER_OF[name[0]!]!, sig };
}

/** A scale degree: "5", "b3", "#4", "8", "10" (a 3rd up an octave), "-7" (7 an octave below). */
interface Pitch {
  letter: number;
  octave: number;
  alter: number;
  midi: number;
}

/** Spell a degree in a key whose tonic sounds at `tonicMidi`. */
function degree(tok: string, key: KeySpec, tonicMidi: number): Pitch {
  const m = /^(bb|b|##|#|n)?(-?\d+)$/.exec(tok);
  if (m === null) throw new Error('bad degree ' + tok);
  const accTok = m[1] ?? '';
  let d = Number(m[2]);
  if (d === 0) d = 1;
  // Below the tonic: -7 is the 7th an octave down (one letter below), -5 the 5th below.
  const idx = d < 0 ? -d - 1 - 7 : d - 1;
  const oct = Math.floor(idx / 7);
  const within = ((idx % 7) + 7) % 7;
  // The major-scale semitone of this degree from the tonic, then the mode's own sixth/third/seventh.
  let semi = LETTER_SEMI[within]! + 12 * oct;
  if (key.minor && (within === 2 || within === 5 || within === 6)) semi -= 1;
  const acc = accTok === '#' ? 1 : accTok === '##' ? 2 : accTok === 'b' ? -1 : accTok === 'bb' ? -2 : 0;
  // In minor, "#6" and "#7" are written as raised from the natural minor.
  semi += acc;
  const midi = tonicMidi + semi;
  const letterAbs = key.letter + idx;
  const letter = ((letterAbs % 7) + 7) % 7;
  // The octave by the letter: C-based octave numbers.
  const naturalMidi = (o: number): number => 12 * (o + 1) + LETTER_SEMI[letter]!;
  let octave = Math.floor(midi / 12) - 1;
  for (const o of [octave - 1, octave, octave + 1]) if (Math.abs(midi - naturalMidi(o)) <= 2) octave = o;
  const alter = midi - naturalMidi(octave);
  return { letter, octave, alter, midi };
}

/** ABC text for a pitch, given what the bar already altered. */
function abcPitch(p: Pitch, key: KeySpec, barAcc: Map<string, number>): string {
  const L = 'CDEFGAB'[p.letter]!;
  const id = L + p.octave;
  const current = barAcc.has(id) ? barAcc.get(id)! : key.sig[p.letter]!;
  let acc = '';
  if (p.alter !== current) {
    acc = p.alter === 1 ? '^' : p.alter === 2 ? '^^' : p.alter === -1 ? '_' : p.alter === -2 ? '__' : '=';
    barAcc.set(id, p.alter);
  }
  let s: string;
  if (p.octave >= 5) s = L.toLowerCase() + "'".repeat(p.octave - 5);
  else s = L + ','.repeat(Math.max(0, 4 - p.octave));
  return acc + s;
}

/* ---------------------------------------------------------------- writing */

/** One event in sixteenths: a note (or a triplet of three), or a rest. */
interface Ev {
  deg?: string | undefined;
  tri?: string[] | undefined;
  units: number;
  stacc?: boolean | undefined;
  syl?: string | undefined;
  chord?: string | undefined;
  breath?: boolean | undefined;
  free?: boolean | undefined;
  dyn?: string | undefined;
}

function lenText(u: number): string {
  // L:1/16 — 1 = sixteenth.
  if (u === 1) return '';
  if (Number.isInteger(u)) return String(u);
  if (u === 0.5) return '/2';
  return String(u);
}

/**
 * Write events into bars of `perBar` sixteenths (ties across bar lines), each
 * line with its w: syllables. `key` applies from the line's first bar.
 */
function writeLine(evs: Ev[], perBar: number, key: KeySpec, tonicMidi: number, inlineKey: boolean): { music: string; words: string; bars: number } {
  let pos = 0;
  let music = inlineKey ? `[K:${key.name}] ` : '';
  const syls: string[] = [];
  let barAcc = new Map<string, number>();
  let bars = 0;
  const flush = (): void => {
    music += ' | ';
    bars += 1;
    barAcc = new Map();
  };
  for (const e of evs) {
    let left = e.units;
    let first = true;
    if (e.tri !== undefined) {
      // A triplet group takes its whole length inside one bar.
      if (pos + e.units > perBar) {
        music += 'z' + lenText(perBar - pos) + ' ';
        flush();
        pos = 0;
      }
      const each = (e.units / 2);
      music += (e.chord ? `"${e.chord}"` : '') + '(3';
      for (const d of e.tri) {
        const p = degree(d, key, tonicMidi);
        music += abcPitch(p, key, barAcc) + lenText(each);
        syls.push(e.syl ?? '');
      }
      music += ' ';
      pos += e.units;
      if (pos === perBar) {
        flush();
        pos = 0;
      }
      continue;
    }
    while (left > 0) {
      const room = perBar - pos;
      const take = Math.min(room, left);
      if (e.deg === undefined) music += 'z' + lenText(take) + ' ';
      else {
        const p = degree(e.deg, key, tonicMidi);
        let deco = '';
        if (first) {
          if (e.breath) deco += '!breath!';
          if (e.free) deco += '!free!';
          if (e.dyn) deco += '!' + e.dyn + '!';
          if (e.stacc) deco += '.';
          if (e.chord) deco = `"${e.chord}"` + deco;
        }
        music += deco + abcPitch(p, key, barAcc) + lenText(take) + (left - take > 0 ? '-' : '') + ' ';
        if (first) syls.push(e.syl ?? '');
      }
      left -= take;
      pos += take;
      first = false;
      if (pos === perBar) {
        flush();
        pos = 0;
      }
    }
  }
  if (pos > 0) {
    music += 'z' + lenText(perBar - pos) + ' ';
    flush();
  }
  return { music: music.trim(), words: syls.some((s) => s !== '') ? syls.map((s) => (s === '' ? '*' : s)).join(' ') : '', bars };
}

function header(title: string, tempo: number, clef: string, meter = '4/4', key = 'C', extra: string[] = []): string[] {
  const clefTxt = clef === 'bass' ? ' clef=bass' : clef === 'treble8' ? ' clef=treble-8' : '';
  return ['X:1', 'T:' + title, 'C:Singing Coach', 'M:' + meter, 'L:1/16', 'Q:1/4=' + Math.round(tempo), 'K:' + key, '%%licence own', ...extra, `V:1 name="Voice"${clefTxt}`];
}

/* ------------------------------------------------------------ the patterns */

interface Pattern {
  /** Scale degrees with lengths in sixteenths: "1:2 2:2 3:2 5:4" (default length per pattern). */
  seq: string;
  len: number;
  minor?: boolean;
  tempo: number;
  title: string;
  syl?: string[];
  free?: boolean;
  stacc?: boolean;
  hold?: boolean;
  chord7?: boolean;
  tri?: boolean;
}

const P: Record<string, Pattern> = {
  'sovt.siren': { seq: '1:8 5:8 8:12 5:8 1:12', len: 8, tempo: 72, title: 'Sirens', free: true },
  'sovt.hills': { seq: '1 2 1:8', len: 4, tempo: 72, title: 'Little hills', free: true },
  desc5: { seq: '5 4 3 2 1:8', len: 4, tempo: 90, title: 'Gentle descents' },
  three: { seq: '1 2 3 2 1:8', len: 4, tempo: 90, title: 'Three-note scale' },
  'five.maj': { seq: '1 2 3 4 5 4 3 2 1:8', len: 2, tempo: 90, title: 'Five-tone scale' },
  'triad.maj': { seq: '1 3 5 3 1:8', len: 4, tempo: 80, title: 'Triad' },
  'five.min': { seq: '1 2 3 4 5 4 3 2 1:8', len: 2, minor: true, tempo: 90, title: 'Five-tone scale, minor' },
  'vowels.one': { seq: '1:8 1:8 1:8 1:8 1:8', len: 8, tempo: 60, title: 'Five vowels on one pitch', syl: ['ee', 'eh', 'ah', 'oh', 'oo'] },
  thirds: { seq: '1 3 2 4 3 5 4 2 1:8', len: 2, tempo: 84, title: 'Thirds' },
  'arp.maj': { seq: '1 3 5 8 5 3 1:8', len: 2, tempo: 80, title: 'Arpeggio' },
  'arp.min': { seq: '1 3 5 8 5 3 1:8', len: 2, minor: true, tempo: 80, title: 'Arpeggio, minor' },
  'scale.maj': { seq: '1 2 3 4 5 6 7 8 7 6 5 4 3 2 1:8', len: 2, tempo: 72, title: 'Major scale' },
  'scale.nmin': { seq: '1 2 3 4 5 6 7 8 7 6 5 4 3 2 1:8', len: 2, minor: true, tempo: 72, title: 'Natural minor scale' },
  'scale.hmin': { seq: '1 2 3 4 5 6 #7 8 #7 6 5 4 3 2 1:8', len: 2, minor: true, tempo: 72, title: 'Harmonic minor scale' },
  'scale.mmin': { seq: '1 2 3 4 5 #6 #7 8 7 6 5 4 3 2 1:8', len: 2, minor: true, tempo: 72, title: 'Melodic minor scale' },
  chromatic: { seq: '1 #1 2 #2 3 4 #4 5 #5 6 #6 7 8 7 b7 6 b6 5 b5 4 3 b3 2 b2 1:8', len: 2, tempo: 60, title: 'Chromatic scale' },
  'arp.stacc': { seq: '1 3 5 8 5 3 1', len: 4, tempo: 80, title: 'Staccato arpeggio', stacc: true },
  'octave.rep': { seq: '1:4 8:4 7 6 5 4 3 2 1:8', len: 2, tempo: 84, title: 'Octave and descending scale' },
  nine: { seq: '1 2 3 4 5 6 7 8 9 8 7 6 5 4 3 2 1:8', len: 2, tempo: 84, title: 'Nine-tone scale' },
  bridge: { seq: '1 2 3 4 5 4 3 2 1:8', len: 2, tempo: 80, title: 'Five-tone through the passaggio' },
  dom7: { seq: '1 3 5 b7 5 3 1:8', len: 2, tempo: 72, title: 'Dominant seventh arpeggio', chord7: true },
  intervals: { seq: '1 2 1 3 1 4 1 5 1 6 1 7 1 8:8', len: 4, tempo: 72, title: 'Intervals from the tonic' },
  'scale.thirds': { seq: '1 3 2 4 3 5 4 6 5 7 6 8 7 6 5 4 3 2 1:8', len: 2, tempo: 80, title: 'Scale in thirds' },
  messa: { seq: '1:32', len: 32, tempo: 60, title: 'Messa di voce', hold: true },
  agility: { seq: '1 2 3 4 5 4 3 2 1 2 3 4 5 4 3 2 1:8', len: 1, tempo: 96, title: 'Agility run' },
  turns: { seq: '1 2 1 -7 1 3 4 3 2 3 5 6 5 4 5 3 2 1:8', len: 1, tempo: 72, title: 'Scale with turns' },
  triplets: { seq: 'T1,2,3 T3,4,5 T5,4,3 T3,2,1 1:8', len: 4, tempo: 72, title: 'Triplet figures', tri: true },
  'arp.10': { seq: '1 3 5 8 10 8 5 3 1:8', len: 2, tempo: 76, title: 'Arpeggio to the tenth' },
  'arp.12': { seq: '1 3 5 8 10 12 10 8 5 3 1:8', len: 2, tempo: 76, title: 'Arpeggio to the twelfth' },
  'trill.m': { seq: '1:4 2 1 2 1 2 1 2 1 2 1 2 1 -7 1:8', len: 1, tempo: 72, title: 'Measured trill' },
  'two.oct': { seq: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1:8', len: 1, tempo: 72, title: 'Two-octave scale' },
  martellato: { seq: '1 1 2 2 3 3 4 4 5 6 5 4 3 4 3 2 1:8', len: 1, tempo: 72, title: 'Martellato with turns', stacc: true },
  'trill.u': { seq: '1:4 2 1 2 1 2 1 2 1 2 1 2 1 2 1 2 1 -7 1:8', len: 1, tempo: 88, title: 'Trill' },
};

export const PATTERN_KEYS = Object.keys(P);

function parseSeq(p: Pattern): Ev[] {
  const out: Ev[] = [];
  for (const tok of p.seq.split(/\s+/)) {
    if (tok.startsWith('T')) {
      out.push({ tri: tok.slice(1).split(','), units: p.len * 2 });
      continue;
    }
    const [d, l] = tok.split(':');
    out.push({ deg: d!, units: l !== undefined ? Number(l) : p.len, stacc: p.stacc });
  }
  return out;
}

/** Span of a pattern in semitones (above its first note). */
function spanOf(p: Pattern): { lo: number; hi: number } {
  const k = keySpec(0, p.minor === true);
  let lo = 0;
  let hi = 0;
  for (const e of parseSeq(p)) {
    for (const d of e.tri ?? (e.deg !== undefined ? [e.deg] : [])) {
      const m = degree(d, k, 60).midi - 60;
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
  }
  return { lo, hi };
}

/** The starting notes: up a semitone a repetition to the ceiling, then back down. */
export function startNotes(ex: string, v: VoiceRange, level: number, under18 = false): number[] {
  const p = P[ex];
  if (p === undefined) return [];
  const { lo, hi } = spanOf(p);
  let bottom = Math.round(v.comf_low + 2 - lo);
  let ceiling = Math.round(v.comf_high - 2 - hi);
  if (level <= 3 || under18) ceiling = Math.min(ceiling, Math.round(v.passaggio.secondo - hi));
  if (ex === 'bridge') {
    // Through the bridge: patterns whose top crosses the primo passaggio.
    bottom = Math.round(v.passaggio.primo - hi - 2);
    ceiling = Math.min(Math.round(v.comf_high - 2 - hi), Math.round(v.passaggio.primo + 3 - hi + 2));
  }
  if (ceiling < bottom) {
    const mid = Math.round((v.comf_low + v.comf_high) / 2 - (lo + hi) / 2);
    return [mid];
  }
  // At most six steps up, then the same back down.
  const steps = Math.min(6, ceiling - bottom);
  const up: number[] = [];
  for (let i = 0; i <= steps; i++) up.push(bottom + i);
  const down = up.slice(0, -1).reverse().slice(0, Math.min(3, up.length - 1));
  return p.hold ? up.filter((_, i) => i % 2 === 0).slice(0, 4) : [...up, ...down];
}

const SOLFEGE_MAJ = ['do', 're', 'mi', 'fa', 'so', 'la', 'ti'];

function sylFor(deg: string, vowel: string, minor: boolean): string {
  if (vowel !== 'solfege') return vowel;
  const m = /^(b|#)?(-?\d+)$/.exec(deg);
  if (m === null) return 'la';
  let d = Number(m[2]);
  if (d < 0) d = 8 + d;
  const idx = (((d - 1) % 7) + 7) % 7;
  // La-based minor: the tonic is la.
  const names = minor ? ['la', 'ti', 'do', 're', 'mi', 'fa', 'so'] : SOLFEGE_MAJ;
  let s = names[idx]!;
  if (m[1] === '#') s = ({ do: 'di', re: 'ri', fa: 'fi', so: 'si', la: 'li' } as Record<string, string>)[s] ?? s;
  if (m[1] === 'b') s = ({ re: 'ra', mi: 'me', so: 'se', la: 'le', ti: 'te' } as Record<string, string>)[s] ?? s;
  return s;
}

/** A vocalise from the catalogue for this voice. */
export function buildVocalise(spec: { ex: string; vowel?: string | undefined; tempo?: number | undefined; start?: string | undefined }, v: VoiceRange, level: number, title: string, skill: string, under18 = false): Built {
  const p = P[spec.ex] ?? P['five.maj']!;
  const tempo = spec.tempo ?? p.tempo;
  const vowel = spec.vowel ?? (p.free ? 'brr' : 'a');
  const starts = spec.start !== undefined ? [noteMidi(spec.start)] : startNotes(spec.ex, v, level, under18);
  const lines: string[] = header(title, tempo, v.clef, '4/4', 'C', p.free ? [] : vowel === 'solfege' || p.syl !== undefined ? [] : ['%%vowel ' + vowel]);
  const reps: Built['reps'] = [];
  let bar = 1;
  starts.forEach((tonic, ri) => {
    const key = keySpec(tonic % 12, p.minor === true);
    const evs: Ev[] = parseSeq(p).map((e, i) => {
      const deg = e.deg ?? e.tri?.[0] ?? '1';
      return { ...e, syl: p.syl !== undefined ? p.syl[i % p.syl.length] : vowel === 'solfege' ? sylFor(deg, 'solfege', p.minor === true) : '', free: p.free, chord: i === 0 ? key.name.replace('m', 'm') + (p.chord7 ? '7' : '') : undefined, breath: i === 0 && ri > 0 };
    });
    if (p.hold) {
      evs[0]!.dyn = 'pp';
    }
    // At least a beat of rest after each repetition, to breathe.
    const used = evs.reduce((a, e) => a + e.units, 0);
    const total = Math.ceil((used + 4) / 16) * 16;
    evs.push({ units: total - used });
    const w = writeLine(evs, 16, key, tonic, true);
    lines.push(w.music);
    if (w.words !== '') lines.push('w: ' + w.words);
    reps.push({ start: noteName(tonic), startMidi: tonic, from: bar, to: bar + w.bars - 1 });
    bar += w.bars;
  });
  const last = lines.length - 1;
  lines[last] = lines[last]!.replace(/\|\s*$/, '|]');
  if (lines[last]!.startsWith('w:') && lines[last - 1] !== undefined) lines[last - 1] = lines[last - 1]!.replace(/\|\s*$/, '|]');
  return { abc: lines.join('\n'), title, skill, ex: spec.ex, reps, free: p.free === true, hold: p.hold === true, drone: false, mode: 'sing', guide: 'voice', tempo, level };
}

export function noteMidi(n: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (m === null) return 60;
  const base = LETTER_SEMI[LETTER_OF[m[1]!]!]!;
  return 12 * (Number(m[3]) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/* ---------------------------------------------------------- sight-singing */

interface SightLevel {
  bars: number;
  meter: string;
  keys: string[];
  minors: string[];
  leaps: number[];
  rhythms: number[][];
  range: number;
  chromatic: boolean;
}

/** Calibrated against the ABRSM and RCM sight-singing ladders (lengths, keys, leaps, rhythms). */
export function sightLevel(level: number): SightLevel {
  const L = Math.max(1, Math.min(30, level));
  const q = 4;
  const h = 8;
  const e = 2;
  const rhythms: number[][] = [[q, q, q, q], [h, q, q], [q, q, h], [h, h]];
  if (L >= 4) rhythms.push([e, e, q, q, q], [q, e, e, h]);
  if (L >= 7) rhythms.push([6, e, q, q], [q, q, 6, e]);
  if (L >= 13) rhythms.push([e, e, e, e, q, q], [6, e, e, e, q]);
  if (L >= 17) rhythms.push([1, 1, e, q, h], [e, 1, 1, q, h]);
  const keys = ['C'];
  if (L >= 3) keys.push('G', 'F');
  if (L >= 6) keys.push('D');
  if (L >= 9) keys.push('Bb');
  if (L >= 13) keys.push('A', 'Eb');
  if (L >= 17) keys.push('E', 'Ab');
  if (L >= 25) keys.push('B', 'Db');
  const minors: string[] = [];
  if (L >= 9) minors.push('A');
  if (L >= 13) minors.push('E', 'D');
  if (L >= 17) minors.push('B', 'G');
  if (L >= 21) minors.push('C', 'F#');
  if (L >= 25) minors.push('C#', 'F');
  const leaps = [1];
  if (L >= 3) leaps.push(2);
  if (L >= 9) leaps.push(3);
  if (L >= 11) leaps.push(4);
  if (L >= 13) leaps.push(7);
  if (L >= 17) leaps.push(5);
  if (L >= 21) leaps.push(6);
  return {
    bars: L <= 2 ? 2 : L <= 8 ? 4 : L <= 20 ? 8 : L <= 26 ? 10 : 12,
    meter: L >= 13 && L % 3 === 1 ? '6/8' : L >= 6 && L % 2 === 0 ? '3/4' : '4/4',
    keys,
    minors,
    leaps,
    rhythms,
    range: L <= 2 ? 4 : L <= 5 ? 5 : L <= 8 ? 7 : L <= 20 ? 9 : 11,
    chromatic: L >= 21,
  };
}

/** How far notes placed on a tonic go outside the comfortable range (semitones). */
function placement(evs: Ev[], key: KeySpec, tonic: number, v: VoiceRange): number {
  let out = 0;
  for (const e of evs) {
    for (const d of e.tri ?? (e.deg !== undefined ? [e.deg] : [])) {
      const m = degree(d, key, tonic).midi;
      out = Math.max(out, v.comf_low - m, m - v.comf_high);
    }
  }
  return Math.max(0, out);
}

/** The tonic (in the key's pitch class) that sits these notes best in the comfortable range. */
function fitTonic(evs: Ev[], key: KeySpec, tonicPc: number, v: VoiceRange): number {
  let lo = 99;
  let hi = -99;
  for (const e of evs) {
    for (const d of e.tri ?? (e.deg !== undefined ? [e.deg] : [])) {
      const m = degree(d, key, 60).midi - 60;
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
  }
  const centre = (v.comf_low + v.comf_high) / 2;
  let best = tonicPc + 60;
  let bestP = 1e9;
  for (let k = -4; k <= 4; k++) {
    const t = tonicPc + 60 + 12 * k;
    const p = Math.max(0, v.comf_low - (t + lo)) * 4 + Math.max(0, t + hi - v.comf_high) * 4 + Math.abs(t + (lo + hi) / 2 - centre);
    if (p < bestP) {
      bestP = p;
      best = t;
    }
  }
  return best;
}

/** A new sight-singing melody at a level, in a key that fits the voice. */
export function buildSight(level: number, seed: number, v: VoiceRange): Built {
  const rnd = seeded(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const L = sightLevel(level);
  const minor = L.minors.length > 0 && rnd() < 0.3;
  const names = minor ? L.minors : L.keys;
  // Degrees: a walk from 1, 3 or 5 that ends on 1, within the range, leaps then a step back.
  const perBar = L.meter === '3/4' ? 12 : L.meter === '6/8' ? 12 : 16;
  const rhythm: number[] = [];
  for (let b = 0; b < L.bars; b++) {
    const last = b === L.bars - 1;
    if (last) {
      rhythm.push(perBar === 12 ? 12 : 16);
      continue;
    }
    let pat = pick(L.rhythms.filter((r) => r.reduce((a, x) => a + x, 0) === perBar));
    if (pat === undefined) pat = perBar === 12 ? (L.meter === '6/8' ? [6, 6] : [4, 4, 4]) : [4, 4, 4, 4];
    rhythm.push(...pat);
  }
  if (perBar === 12 && L.meter === '6/8') {
    // Compound time: dotted quarters and eighths.
    for (let i = 0; i < rhythm.length; i++) if (rhythm[i] === 4) rhythm[i] = 2;
  }
  const n = rhythm.length;
  let d = pick([1, 3, 5].filter((x) => x <= L.range + 1));
  const degs: number[] = [d];
  for (let i = 1; i < n; i++) {
    const remaining = n - i;
    if (remaining === 1) {
      d = 1;
      degs.push(d);
      break;
    }
    if (remaining === 2) {
      // Into the final tonic by step: from 2 above or the leading tone below (0).
      degs.push(rnd() < 0.6 || L.range < 4 ? 2 : 0);
      continue;
    }
    const prev = degs[i - 1]!;
    const prev2 = i >= 2 ? degs[i - 2]! : prev;
    const lastLeap = Math.abs(prev - prev2) >= 2;
    let step = pick(L.leaps);
    if (lastLeap) step = 1;
    let dir = rnd() < 0.5 ? -1 : 1;
    if (lastLeap) dir = prev > prev2 ? -1 : 1;
    let next = prev + dir * step;
    if (next < 1 || next > L.range + 1) next = prev - dir * step;
    if (next < 1) next = 1;
    if (next > L.range + 1) next = L.range + 1;
    if (L.range >= 7 && rnd() < 0.08 && next > 2) next = next - 1;
    degs.push(next);
  }
  const evs: Ev[] = degs.map((x, i) => {
    let deg = String(x);
    if (x === 0) deg = '-7';
    if (L.chromatic && i > 0 && i < degs.length - 2 && rnd() < 0.12 && x === 4) deg = '#4';
    return { deg, units: rhythm[i]!, syl: '' };
  });
  // The key: one of the level's keys whose placement fits the voice best (a random one among those that fit).
  const options = names.map((nm) => {
    const pc = noteMidi(nm + '4') % 12;
    const k = keySpec(pc, minor);
    const t = fitTonic(evs, k, pc, v);
    return { k, t, p: placement(evs, k, t, v) };
  });
  const bestP = Math.min(...options.map((o) => o.p));
  const choice = pick(options.filter((o) => o.p <= bestP + 1e-9));
  const key = choice.k;
  const tonic = choice.t;
  const lines = header('Sight-singing, level ' + level, 72 + Math.min(24, level), v.clef, L.meter, key.name);
  const w = writeLine(evs, perBar, key, tonic, false);
  lines.push(w.music.replace(/\|\s*$/, '|]'));
  return { abc: lines.join('\n'), title: 'Sight-singing, level ' + level, skill: 'sight.sing', ex: 'sight', reps: [], free: false, hold: false, drone: false, mode: 'solo', guide: 'start', tempo: 72 + Math.min(24, level), level };
}

/* ---------------------------------------------------- drone, harmony, unacc */

/** A scale up and down against a drone on the tonic. */
export function buildDrone(minor: boolean, seed: number, v: VoiceRange, level: number): Built {
  const rnd = seeded(seed);
  const p = P[minor ? 'scale.nmin' : level < 4 ? 'five.maj' : 'scale.maj']!;
  const { hi } = spanOf(p);
  const lowest = v.comf_low + 2;
  const highest = Math.max(lowest, v.comf_high - 2 - hi);
  const tonic = Math.round(lowest + rnd() * (highest - lowest));
  const key = keySpec(tonic % 12, minor);
  const lines = header('Scale against a drone', p.tempo - 12, v.clef, '4/4', key.name, ['%%vowel la']);
  const evs = parseSeq(p).map((e) => ({ ...e, units: e.units * 2 }));
  const used = evs.reduce((a, e) => a + e.units, 0);
  evs.push({ units: Math.ceil((used + 4) / 16) * 16 - used });
  const w = writeLine(evs, 16, key, tonic, false);
  lines.push(w.music.replace(/\|\s*$/, '|]'));
  return { abc: lines.join('\n'), title: 'Scale against a drone', skill: 'pitch.drone', ex: 'drone', reps: [], free: false, hold: false, drone: true, mode: 'sing', guide: 'start', tempo: p.tempo - 12, level };
}

/** A two-part phrase: the singer sings `part`, the piano plays the other. */
export function buildHarmony(part: 'upper' | 'lower', seed: number, v: VoiceRange, level: number, skill: string): Built {
  const rnd = seeded(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const tonicPc = noteMidi(pick(['C', 'G', 'F', 'D']) + '4') % 12;
  const key = keySpec(tonicPc, false);
  // The upper line walks; the lower moves in thirds and sixths below it, meeting the tonic at the end.
  const len = level >= 7 ? 8 : 4;
  const upperDegs: number[] = [];
  let d = pick([3, 5]);
  for (let i = 0; i < len * 2 - 1; i++) {
    upperDegs.push(d);
    const step = pick([-1, 1, 1, -1, 2, -2]);
    d = Math.max(2, Math.min(7, d + step));
  }
  upperDegs.push(3);
  const lowerDegs = upperDegs.map((u, i) => (i === upperDegs.length - 1 ? 1 : i % 3 === 2 ? u - 5 : u - 2));
  const sung = part === 'upper' ? upperDegs : lowerDegs;
  const other = part === 'upper' ? lowerDegs : upperDegs;
  const evs = (degs: number[]): Ev[] => degs.map((x, i) => ({ deg: String(x <= 0 ? x - 8 : x), units: i === degs.length - 1 ? 16 : 8, syl: '' }));
  const tonic = fitTonic(evs(sung), key, tonicPc, v);
  const lines = header(part === 'upper' ? 'Harmony: the upper part' : 'Harmony: the lower part', 72, v.clef, '4/4', key.name, ['%%vowel la']);
  lines.push('V:2 name="Other part"' + (v.clef === 'bass' ? ' clef=bass' : v.clef === 'treble8' ? ' clef=treble-8' : ''));
  const a = writeLine(evs(sung), 16, key, tonic, false);
  const b = writeLine(evs(other), 16, key, tonic, false);
  lines.push('[V:1] ' + a.music.replace(/\|\s*$/, '|]'));
  lines.push('[V:2] ' + b.music.replace(/\|\s*$/, '|]'));
  return { abc: lines.join('\n'), title: part === 'upper' ? 'Harmony: the upper part' : 'Harmony: the lower part', skill, ex: 'harmony', reps: [], free: false, hold: false, drone: false, mode: skill.startsWith('ear.') ? 'echo' : 'sing', guide: skill.startsWith('ear.') ? 'voice' : 'start', tempo: 72, level };
}

/** A folk-like 16-bar tune to sing unaccompanied (the drift from first to last phrase is the point). */
export function buildUnacc(seed: number, v: VoiceRange, level: number): Built {
  const b = buildSight(Math.min(14, Math.max(6, level + 4)), seed, v);
  // Twice the length: the tune sung twice through.
  const lines = b.abc.split('\n');
  const body = lines[lines.length - 1]!.replace(/\|\]\s*$/, '|');
  lines[lines.length - 1] = body + ' ' + body.replace(/\|\s*$/, '|]');
  lines[1] = 'T:Unaccompanied tune';
  return { ...b, abc: lines.join('\n'), title: 'Unaccompanied tune', skill: 'pitch.unacc', ex: 'unacc', mode: 'solo', guide: 'start' };
}

/* ------------------------------------------------------------------ specs */

/** A spec as a URL value (?gen=). */
export function specKey(s: Spec): string {
  if (s.k === 'vocalise') return ['v', s.ex, s.vowel ?? '', s.tempo ?? '', s.start ?? ''].join('~');
  if (s.k === 'sight') return ['s', s.level, s.seed ?? ''].join('~');
  if (s.k === 'drone') return ['d', s.minor ? 1 : 0, s.seed ?? ''].join('~');
  if (s.k === 'harmony') return ['h', s.part, s.level ?? '', s.seed ?? ''].join('~');
  return ['u', s.level ?? '', s.seed ?? ''].join('~');
}

export function parseSpecKey(t: string): Spec | null {
  const p = t.split('~');
  const num = (x: string | undefined): number | undefined => (x === undefined || x === '' ? undefined : Number(x));
  if (p[0] === 'v' && p[1] !== undefined) return { k: 'vocalise', ex: p[1], vowel: p[2] || undefined, tempo: num(p[3]), start: p[4] || undefined };
  if (p[0] === 's') return { k: 'sight', level: num(p[1]) ?? 1, seed: num(p[2]) };
  if (p[0] === 'd') return { k: 'drone', minor: p[1] === '1', seed: num(p[2]) };
  if (p[0] === 'h') return { k: 'harmony', part: p[1] === 'lower' ? 'lower' : 'upper', level: num(p[2]), seed: num(p[3]) };
  if (p[0] === 'u') return { k: 'unacc', level: num(p[1]), seed: num(p[2]) };
  return null;
}

/** Build any spec for this voice. */
export function build(spec: Spec, v: VoiceRange, level: number, exercises: Record<string, { title: string; skill: string }>, skillHint?: string, under18 = false): Built {
  const seed = (spec.k !== 'vocalise' ? spec.seed : undefined) ?? Math.floor(Math.random() * 1e9);
  if (spec.k === 'vocalise') {
    const def = exercises[spec.ex] ?? { title: P[spec.ex]?.title ?? spec.ex, skill: 'tech.fivetone' };
    return buildVocalise(spec, v, level, def.title, def.skill, under18);
  }
  if (spec.k === 'sight') return buildSight(spec.level, seed, v);
  if (spec.k === 'drone') return buildDrone(spec.minor === true, seed, v, level);
  if (spec.k === 'harmony') return buildHarmony(spec.part, seed, v, spec.level ?? level, skillHint ?? (spec.part === 'upper' ? 'ear.harmony.1' : 'ear.harmony.2'));
  return buildUnacc(seed, v, spec.level ?? level);
}

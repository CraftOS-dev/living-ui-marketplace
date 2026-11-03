/**
 * The drills' items. Three kinds:
 *
 *   quiz   answered by tapping (1-9): intervals and chords by ear, major or
 *          minor, cadences, note names and solfège on the staff, key
 *          signatures, intervals and chords on the staff, terms, IPA vowels
 *   sing   sung and judged by the voice dial: matching notes, holding them,
 *          sliding onto them, intervals up and down (levels 1-9), echoes and
 *          melodies from memory (adaptive), scale degrees after a cadence,
 *          sustain and phrase length on one breath
 *   speak  rhythms spoken on "ta" with a click (levels 1-5)
 *
 * Everything sung is placed in the singer's comfortable range.
 */
import * as T from '../music/theory.ts';
import type { Note } from '../music/theory.ts';
import { GLOSSARY, IPA_VOWELS } from './glossary.ts';
import type { Sound, StaffPic } from './schema.ts';
import type { SingMode } from './useSing.ts';

export interface QuizItem {
  key: string;
  prompt: string;
  big?: string;
  staff?: StaffPic;
  sound?: Sound;
  options: string[];
  answer: number;
  explain?: string;
}

export interface SungItem {
  key: string;
  prompt: string;
  /** Absolute MIDI notes to sing (already in range). */
  notes: number[];
  mode: SingMode;
  hold?: number;
  /** Give the first note before singing (else the singer finds it). */
  cue: boolean;
  /** Something to hear first: a cadence (chords) for scale degrees. */
  pre?: number[][];
  /** Hear the melody twice (memory). */
  twice?: boolean;
  limit?: number;
  /** Special runners. */
  kind?: 'sustain' | 'phrase';
  seconds?: number;
}

export interface SpeakItem {
  key: string;
  prompt: string;
  rhythm: string;
  meter: string;
  bpm: number;
}

/* ------------------------------------------------------------------ helpers */

function rnd(n: number): number {
  return Math.floor(Math.random() * n);
}
function pick<T2>(xs: readonly T2[]): T2 {
  return xs[rnd(xs.length)]!;
}
function shuffle<T2>(xs: T2[]): T2[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
/** Options with the answer among distractors (unique), and its index. */
function choices(answer: string, pool: string[], n = 4): { options: string[]; answer: number } {
  const others = shuffle(pool.filter((p) => p !== answer)).slice(0, n - 1);
  const opts = shuffle([answer, ...others]);
  return { options: opts, answer: opts.indexOf(answer) };
}
export function str(n: Note): string {
  return T.name(n, true).replace('♯', '#').replace('♭', 'b');
}
function nm(m: number): string {
  return T.name(T.fromMidi(m), true).replace('♯', '#').replace('♭', 'b');
}

const IV_NAMES: Record<number, string> = { 1: 'Minor 2nd', 2: 'Major 2nd', 3: 'Minor 3rd', 4: 'Major 3rd', 5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th', 8: 'Minor 6th', 9: 'Major 6th', 10: 'Minor 7th', 11: 'Major 7th', 12: 'Octave', 13: 'Minor 9th', 14: 'Major 9th' };

/** Intervals sung up and down at each int.sing level (the RCM ladder). */
export const SING_LEVELS: number[][] = [[], [3, 4], [3, 4, 7], [3, 4, 5, 7], [3, 4, 5, 7, 12], [3, 4, 5, 7, 8, 9, 12], [1, 2, 3, 4, 5, 7, 8, 9, 12], [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]];
const HEAR_LEVELS: number[][] = [[], [3, 4, 7, 12], [2, 3, 4, 5, 7, 9, 12], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];

export interface VoiceBox {
  lo: number;
  hi: number;
}

function mid(v: VoiceBox): number {
  return Math.round((v.lo + v.hi) / 2);
}

/* ------------------------------------------------------------------- quiz */

const KEYS_MAJ = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab', 'B', 'Db', 'F#'];
const SOLFEGE = ['do', 're', 'mi', 'fa', 'so', 'la', 'ti'];

export function quizItems(skill: string, count: number, level: number, v: VoiceBox, clef: 'treble' | 'treble8' | 'bass'): QuizItem[] {
  const out: QuizItem[] = [];
  for (let k = 0; k < count; k++) out.push(quizItem(skill, k, level, v, clef));
  return out;
}

function quizItem(skill: string, k: number, level: number, v: VoiceBox, clef: 'treble' | 'treble8' | 'bass'): QuizItem {
  const base = mid(v) - 4 + rnd(5);
  if (skill === 'int.hear') {
    const pool = HEAR_LEVELS[Math.max(1, Math.min(3, level))]!;
    const iv = pick(pool);
    const up = Math.random() < 0.6;
    const a = up ? base : base + 3;
    const b = up ? a + iv : a - iv;
    const c = choices(IV_NAMES[iv]!, pool.map((x) => IV_NAMES[x]!));
    return { key: `ih${k}`, prompt: 'Which interval?', sound: { seq: [nm(a), nm(b)], bpm: 70, with: 'voice' }, ...c };
  }
  if (skill === 'ear.majmin') {
    const minor = Math.random() < 0.5;
    const r = base - 5;
    const tri = [r, r + (minor ? 3 : 4), r + 7];
    return { key: `mm${k}`, prompt: 'Major or minor?', sound: { seq: [nm(tri[0]!), nm(tri[1]!), nm(tri[2]!), tri.map(nm)], bpm: 96, hold: 1, with: 'piano' }, options: ['Major', 'Minor'], answer: minor ? 1 : 0 };
  }
  if (skill === 'ear.cadence') {
    const kinds = ['Perfect (V–I)', 'Plagal (IV–I)', 'Imperfect (ends on V)', 'Interrupted (V–vi)'];
    const which = rnd(4);
    const r = 48 + rnd(5);
    const I = [r, r + 4, r + 7, r + 12];
    const IV = [r + 5, r + 9, r + 12, r + 17 - 12];
    const V = [r + 7 - 12, r + 7, r + 11, r + 14];
    const vi = [r + 9 - 12, r + 9, r + 12, r + 16];
    const seqs = [
      [I, IV, V, I],
      [I, V, IV, I],
      [I, IV, I, V],
      [I, IV, V, vi],
    ];
    return { key: `cd${k}`, prompt: 'Which cadence ends this?', sound: { seq: seqs[which]!.map((c) => c.map(nm)), bpm: 66, hold: 1, with: 'piano' }, options: kinds, answer: which };
  }
  if (skill === 'read.staff') {
    const L = pick(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    const oct = clef === 'bass' ? pick([2, 3]) : pick([4, 4, 5]);
    const n = L + oct;
    const c = choices(L, ['C', 'D', 'E', 'F', 'G', 'A', 'B'], 4);
    return { key: `rs${k}`, prompt: 'Which note?', staff: { clef, items: [{ notes: [n] }] }, ...c };
  }
  if (skill === 'sight.solfege') {
    const keyName = pick(level >= 2 ? ['C', 'G', 'F', 'D', 'Bb'] : ['C', 'G', 'F']);
    const kk = T.key(keyName, 'major');
    const scale = T.scale(T.note(keyName + (clef === 'bass' ? '3' : '4')), 'major');
    const d = rnd(7);
    const n = scale[d]!;
    const c = choices(SOLFEGE[d]!, SOLFEGE, 4);
    return { key: `sf${k}`, prompt: `Key of ${keyName} major: which syllable?`, staff: { clef, fifths: kk.fifths, items: [{ notes: [str(scale[0]!)], dur: 'h', lyric: 'do' }, { notes: [str(n)], dur: 'h', lyric: '?' }] }, ...c };
  }
  if (skill === 'key.sig') {
    const keyName = pick(KEYS_MAJ.slice(0, level >= 2 ? 12 : 7));
    const kk = T.key(keyName, 'major');
    const minor = Math.random() < 0.3;
    const label = minor ? T.keyName(T.relative(kk)) : T.keyName(kk);
    const pool = KEYS_MAJ.map((x) => (minor ? T.keyName(T.relative(T.key(x, 'major'))) : T.keyName(T.key(x, 'major'))));
    const c = choices(label, pool, 4);
    return { key: `ks${k}`, prompt: minor ? 'Which minor key has this signature?' : 'Which major key has this signature?', staff: { clef, fifths: kk.fifths, items: [] }, ...c };
  }
  if (skill === 'int.name') {
    const pool = [2, 3, 4, 5, 7, 9, 12].concat(level >= 2 ? [1, 8, 10, 11, 6] : []);
    const iv = pick(pool);
    const lowLetter = pick(['C', 'D', 'E', 'F', 'G', 'A']);
    const a = T.note(lowLetter + (clef === 'bass' ? '3' : '4'));
    const ivName = { 1: 'm2', 2: 'M2', 3: 'm3', 4: 'M3', 5: 'P4', 6: 'A4', 7: 'P5', 8: 'm6', 9: 'M6', 10: 'm7', 11: 'M7', 12: 'P8' }[iv] ?? 'P5';
    const b = T.transpose(a, T.iv(ivName));
    const c = choices(IV_NAMES[iv]!, pool.map((x) => IV_NAMES[x]!));
    return { key: `in${k}`, prompt: 'Which interval?', staff: { clef, items: [{ notes: [str(a)], dur: 'h' }, { notes: [str(b)], dur: 'h' }] }, sound: { seq: [str(a), str(b)], bpm: 72 }, ...c };
  }
  if (skill === 'chord.name') {
    const types = level >= 2 ? ['maj', 'min', 'dim', 'aug', '7'] : ['maj', 'min'];
    const rootL = pick(['C', 'D', 'E', 'F', 'G', 'A', 'Bb']);
    const type = pick(types);
    const root = T.note(rootL + (clef === 'bass' ? '3' : '4'));
    const notes = T.chord(root, type);
    const sym = T.chordSymbol(root, type);
    const pool = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'Caug', 'D', 'E', 'A', 'Bb', 'Gm', 'Cm', 'Fm', 'G7', 'C7', 'D7', 'A7'].concat([sym]);
    const c = choices(sym, [...new Set(pool)], 4);
    return { key: `cn${k}`, prompt: 'Which chord?', staff: { clef, items: [{ notes: notes.map(str) }] }, sound: { seq: [notes.map(str)], bpm: 40, with: 'piano' }, ...c };
  }
  if (skill === 'terms') {
    const t = pick(GLOSSARY);
    if (Math.random() < 0.5) {
      const c = choices(t.def, shuffle(GLOSSARY.filter((x) => x.cat === t.cat && x.term !== t.term)).slice(0, 6).map((x) => x.def).concat(shuffle(GLOSSARY).slice(0, 3).map((x) => x.def)), 4);
      return { key: `tm${k}`, prompt: 'What does it mean?', big: t.term, ...c };
    }
    const c = choices(t.term, shuffle(GLOSSARY.filter((x) => x.cat === t.cat)).slice(0, 8).map((x) => x.term).concat(shuffle(GLOSSARY).slice(0, 3).map((x) => x.term)), 4);
    return { key: `tm${k}`, prompt: t.def, ...c };
  }
  if (skill === 'ipa') {
    if (Math.random() < 0.5) {
      const sung: { v: 'oo' | 'ah' | 'ee' | 'eh' | 'oh'; sym: string }[] = [
        { v: 'ee', sym: '[i]' },
        { v: 'eh', sym: '[e]' },
        { v: 'ah', sym: '[a]' },
        { v: 'oh', sym: '[o]' },
        { v: 'oo', sym: '[u]' },
      ];
      const x = pick(sung);
      const c = choices(x.sym, sung.map((s) => s.sym), 5);
      return { key: `ip${k}`, prompt: 'Which vowel does the voice sing?', sound: { seq: [nm(base)], bpm: 40, hold: 1.5, with: 'voice', vowel: x.v }, ...c };
    }
    const x = pick(IPA_VOWELS);
    const c = choices(x.sym, IPA_VOWELS.map((y) => y.sym), 4);
    return { key: `ip${k}`, prompt: `The vowel in “${x.example}”`, ...c };
  }
  // Unknown: a harmless interval item.
  return quizItem('int.hear', k, 1, v, clef);
}

/* ------------------------------------------------------------------- sung */

const ECHO_LEN = [0, 3, 4, 5, 6, 6, 8];

/** A short tune on scale steps (and leaps at higher levels), in a key placed in the voice. */
function tune(len: number, v: VoiceBox, minor: boolean, leaps: boolean, span: number): number[] {
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
  const tonic = Math.max(v.lo + 1, Math.min(v.hi - span - 1, mid(v) - Math.round(span / 2)));
  let d = pick([0, 2, 4].filter((x) => x <= span));
  const degs = [d];
  for (let i = 1; i < len; i++) {
    const step = leaps && Math.random() < 0.35 ? pick([2, 3, 4]) : 1;
    let nd = d + (Math.random() < 0.5 ? -step : step);
    if (nd < 0) nd = d + step;
    if (scale[nd] === undefined || (scale[nd] ?? 0) > span) nd = d - step;
    if (nd < 0) nd = 0;
    d = nd;
    degs.push(d);
  }
  degs[degs.length - 1] = 0;
  return degs.map((x) => tonic + (scale[x] ?? 0));
}

export function sungItems(skill: string, count: number, level: number, v: VoiceBox, mastery: number): SungItem[] {
  const out: SungItem[] = [];
  const box = { lo: v.lo + 1, hi: v.hi - 1 };
  for (let k = 0; k < count; k++) {
    const m = mid(box);
    if (skill === 'pitch.match.1') {
      const n = m - 3 + rnd(7);
      out.push({ key: `m1${k}`, prompt: 'Listen, then sing the same note', notes: [n], mode: 'echo', cue: true, limit: 6 });
    } else if (skill === 'pitch.match.2') {
      const n = box.lo + rnd(Math.max(1, box.hi - box.lo + 1));
      out.push({ key: `m2${k}`, prompt: 'Listen, then sing the same note', notes: [n], mode: 'echo', cue: true, limit: 6 });
    } else if (skill === 'pitch.hold') {
      const secs = mastery >= 0.8 ? 8 : mastery >= 0.6 ? 6 : mastery >= 0.4 ? 4 : 3;
      out.push({ key: `ho${k}`, prompt: `Hold the note steady for ${secs} seconds`, notes: [m - 2 + rnd(5)], mode: 'hold', hold: secs, cue: true, limit: secs + 10 });
    } else if (skill === 'pitch.slide') {
      const a = m - 4 + rnd(4);
      const b = a + (Math.random() < 0.5 ? -1 : 1) * (3 + rnd(5));
      out.push({ key: `sl${k}`, prompt: 'Start on the first note, then slide and land on the second', notes: [a, b], mode: 'order', cue: true, limit: 6 });
    } else if (skill === 'int.sing') {
      const pool = SING_LEVELS[Math.max(1, Math.min(9, level))]!;
      const iv = pick(pool);
      const up = Math.random() < 0.6;
      let a = up ? m - Math.round(iv / 2) : m + Math.round(iv / 2);
      a = Math.max(box.lo, Math.min(box.hi, a));
      let b = up ? a + iv : a - iv;
      if (b > box.hi + 1 || b < box.lo - 1) {
        b = up ? a - iv : a + iv;
      }
      out.push({ key: `is${k}`, prompt: `Sing the given note, then a ${IV_NAMES[iv]!.toLowerCase()} ${b > a ? 'up' : 'down'}`, notes: [a, b], mode: 'order', cue: true, limit: 7 });
    } else if (skill === 'ear.echo') {
      const L = Math.max(1, Math.min(6, level));
      const notes = tune(ECHO_LEN[L]!, box, L >= 5, L >= 3, L <= 1 ? 4 : L <= 2 ? 7 : 12);
      out.push({ key: `ec${k}`, prompt: 'Listen, then sing it back', notes, mode: 'echo', cue: true, limit: 6 });
    } else if (skill === 'ear.memory') {
      const L = Math.max(1, Math.min(3, level));
      const notes = tune(5 + L * 2, box, Math.random() < 0.3, true, 12);
      out.push({ key: `me${k}`, prompt: 'Listen twice, then sing it from memory', notes, mode: 'echo', cue: true, twice: true, limit: 7 });
    } else if (skill === 'ear.degree') {
      const tonic = Math.max(box.lo, Math.min(box.hi - 12, m - 6));
      const degs = [0, 2, 4, 5, 7, 9, 11, 12];
      const di = rnd(degs.length);
      const I = [tonic - 12, tonic - 8, tonic - 5];
      const IV = [tonic - 7, tonic - 3, tonic];
      const V = [tonic - 5, tonic - 1, tonic + 2];
      out.push({ key: `dg${k}`, prompt: `After the cadence, sing ${['do', 're', 'mi', 'fa', 'so', 'la', 'ti', 'high do'][di]} (degree ${di + 1 === 8 ? 8 : di + 1})`, notes: [tonic + degs[di]!], mode: 'order', cue: false, pre: [I, IV, V, I], limit: 8 });
    } else if (skill === 'breath.sustain') {
      out.push({ key: `su${k}`, prompt: 'One easy breath, then “ah” on this note for as long as it stays comfortable', notes: [m - 2], mode: 'hold', cue: true, kind: 'sustain' });
    } else if (skill === 'breath.phrase') {
      const secs = Math.round(4 + mastery * 8);
      const notes = [0, 2, 4, 2, 0].map((x) => m - 2 + x);
      out.push({ key: `ph${k}`, prompt: `Sing this on one breath, ${secs} seconds in all`, notes, mode: 'hold', hold: Math.max(0.8, secs / notes.length), cue: true, kind: 'phrase', seconds: secs });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ speak */

const RHY: Record<number, string[]> = {
  1: ['q q q q', 'h q q', 'q q h', 'h h', 'w', 'q q q rq'],
  2: ['8 8 q 8 8 q', 'q 8 8 h', '8 8 8 8 q q', 'q rq 8 8 q', 'q 8 8 q rq'],
  3: ['qd 8 q q', 'hd q', 'qd 8 h', 'q qd 8 q', '8 q 8 q q'],
  4: ['qd qd', 'q 8 qd', '8 8 8 qd', 'q 8 q 8', 'qd 8 8 8'],
  5: ['t8 t8 t8 q h', '8 q 8 q q', '16 16 16 16 q h', '8 16 16 q h', 't8 t8 t8 t8 t8 t8 h'],
};

export function speakItems(skill: string, count: number): SpeakItem[] {
  const L = Math.max(1, Math.min(5, Number(skill.split('.')[1]) || 1));
  const out: SpeakItem[] = [];
  for (let k = 0; k < count; k++) {
    const bars = [pick(RHY[L]!), pick(RHY[L]!)].join(' ');
    out.push({ key: `rh${k}`, prompt: 'Speak it on “ta” with the click', rhythm: bars, meter: L === 4 ? '6/8' : '4/4', bpm: L >= 4 ? 66 : 72 });
  }
  return out;
}

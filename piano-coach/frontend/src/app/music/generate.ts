/**
 * Exercises made on demand, as ABC notation the server parses into the same
 * model songs use, so every exercise gets the whole practice screen
 * (falling notes or sheet, Learn and Play, tempo, loop, judging):
 *
 *   scale      any of 13 scale types in 12 keys, 1-4 octaves, one hand,
 *              hands together or in contrary motion, with fingering
 *   arpeggio   major, minor, diminished seventh, dominant seventh, inversions
 *   five       five-finger patterns, major or minor
 *   chromatic  with the standard chromatic fingering
 *   triads     the triads of a key, or one chord through its inversions
 *   prog       a progression in a key with an accompaniment pattern (block,
 *              broken, Alberti, waltz, arpeggio, stride), the 12-bar blues
 *   rhythm     graded rhythms on one note: tap any key in time
 *   sight      graded sight-reading pieces, levels 1 to 30
 */
import * as T from './theory.ts';
import type { Note } from './theory.ts';

export type Hands = 'R' | 'L' | 'both' | 'contrary';
export type Pattern = 'block' | 'broken' | 'alberti' | 'waltz' | 'arpeggio' | 'stride';

export type Spec =
  | { k: 'scale'; tonic: string; type: string; oct: number; hands: Hands; rhythm: 4 | 2 | 1 }
  | { k: 'arpeggio'; tonic: string; quality: 'maj' | 'min' | 'dim7' | '7'; oct: number; hands: Hands; inversion: number }
  | { k: 'five'; tonic: string; minor: boolean; hands: Hands }
  | { k: 'chromatic'; tonic: string; oct: number; hands: Hands }
  | { k: 'triads'; tonic: string; mode: 'major' | 'minor' }
  | { k: 'inversions'; tonic: string; quality: string }
  | { k: 'prog'; tonic: string; prog: string; pattern: Pattern }
  | { k: 'rhythm'; level: number; seed: number }
  | { k: 'sight'; level: number; seed: number };

export interface Generated {
  abc: string;
  title: string;
  /** The skill a pass trains and the drill that records it. */
  skill: string;
  drill: 'technique' | 'prog' | 'rhythm' | 'sight';
  /** Key for technique bests (major:D, arp-min:A …). */
  id: string;
  mode: 'listen' | 'learn' | 'play';
  tempo: number;
  anyPitch?: boolean;
  sight?: boolean;
  level?: number;
}

/* ---------------------------------------------------------- the writer */

const UNIT = 16; // L:1/16: a quarter note is 4 units

function lenText(u: number): string {
  if (u === 1) return '';
  if (Number.isInteger(u)) return String(u);
  const den = u === 0.5 ? 2 : u === 0.25 ? 4 : 0;
  if (den > 0) return '/' + den;
  const num = Math.round(u * 3);
  return `${num}/3`;
}

class Bar {
  acc = new Map<string, number>();
}

/** One voice of ABC: notes with lengths, bar lines, accidentals as needed. */
class Voice {
  bars: string[] = [];
  cur: string[] = [];
  pos = 0;
  private bar = new Bar();
  id: string;
  clef: 'treble' | 'bass';
  private keyAlt: Record<string, number>;
  private barLen: number;
  constructor(id: string, clef: 'treble' | 'bass', keyAlt: Record<string, number>, barLen: number) {
    this.id = id;
    this.clef = clef;
    this.keyAlt = keyAlt;
    this.barLen = barLen;
  }

  private pitch(n: Note): string {
    const letter = T.LETTERS[n.l] ?? 'C';
    const id = letter + n.o;
    const cur = this.bar.acc.has(id) ? this.bar.acc.get(id)! : (this.keyAlt[letter] ?? 0);
    let a = '';
    if (n.a !== cur) {
      a = n.a === 1 ? '^' : n.a === 2 ? '^^' : n.a === -1 ? '_' : n.a === -2 ? '__' : '=';
      this.bar.acc.set(id, n.a);
    }
    const body = n.o >= 5 ? letter.toLowerCase() + "'".repeat(n.o - 5) : letter + ','.repeat(Math.max(0, 4 - n.o));
    return a + body;
  }

  note(notes: Note[] | Note, units: number, opts: { finger?: number | number[] | null; tie?: boolean; dyn?: string; stacc?: boolean } = {}): void {
    const list = Array.isArray(notes) ? notes : [notes];
    let s = opts.dyn !== undefined ? `!${opts.dyn}!` : '';
    if (opts.stacc === true) s += '.';
    const fingers = Array.isArray(opts.finger) ? opts.finger : opts.finger ? [opts.finger] : [];
    if (list.length === 1) s += (fingers[0] ? `!${fingers[0]}!` : '') + this.pitch(list[0]!);
    else s += '[' + list.map((n, i) => (fingers[i] ? `!${fingers[i]}!` : '') + this.pitch(n)).join('') + ']';
    s += lenText(units) + (opts.tie === true ? '-' : '');
    this.push(s, units);
  }

  /** Three notes in the time of two: each written as `each` units, together `total`. */
  triplet(notes: Note[], each: number, total: number): void {
    this.push('(3' + notes.map((n) => this.pitch(n) + lenText(each)).join(''), total);
  }

  rest(units: number, invisible = false): void {
    if (units <= 0) return;
    this.push((invisible ? 'x' : 'z') + lenText(units), units);
  }

  raw(text: string, units: number): void {
    this.push(text, units);
  }

  private push(tok: string, units: number): void {
    this.cur.push(tok);
    this.pos += units;
    if (this.pos >= this.barLen - 1e-6) {
      this.bars.push(this.cur.join(' '));
      this.cur = [];
      this.pos = 0;
      this.bar = new Bar();
    }
  }

  /** Fill the bar with a rest (or end an unfinished last bar). */
  fill(): void {
    if (this.pos > 0) this.rest(this.barLen - this.pos);
  }
}

function keyAltOf(fifths: number): Record<string, number> {
  const m: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (const s of T.signature(fifths)) m[s.letter] = s.a;
  return m;
}

function render(title: string, composer: string, meter: string, tempo: number, keyText: string, voices: Voice[]): string {
  for (const v of voices) v.fill();
  const head = ['X:1', `T:${title}`, `C:${composer}`, `M:${meter}`, 'L:1/16', `Q:1/4=${Math.round(tempo)}`];
  for (const v of voices) head.push(`V:${v.id} clef=${v.clef}`);
  head.push(`K:${keyText}`);
  const n = Math.max(...voices.map((v) => v.bars.length));
  const lines: string[] = [];
  for (let c = 0; c < n; c += 4) {
    voices.forEach((v, vi) => {
      const chunk = v.bars.slice(c, c + 4);
      while (chunk.length < Math.min(4, n - c)) chunk.push('Z');
      lines.push(`[V:${v.id}] ${chunk.join(' | ')} ${c + 4 >= n ? '|]' : '|'}`);
      void vi;
    });
  }
  return head.concat(lines).join('\n') + '\n';
}

const ENHARMONIC: Record<string, string> = { Db: 'C#', 'C#': 'Db', Gb: 'F#', 'F#': 'Gb', Ab: 'G#', 'G#': 'Ab', Eb: 'D#', 'D#': 'Eb', Bb: 'A#', 'A#': 'Bb', Cb: 'B', B: 'Cb', Fb: 'E', 'E#': 'F', 'B#': 'C' };

/** The key on a tonic, spelled the way that has a real signature (D♭ minor is written C♯ minor). */
export function keyFor(tonic: string, minor: boolean): T.Key {
  const list = minor ? T.MINOR_KEYS : T.MAJOR_KEYS;
  const t = list.includes(tonic) ? tonic : ENHARMONIC[tonic] !== undefined && list.includes(ENHARMONIC[tonic]!) ? ENHARMONIC[tonic]! : 'C';
  return T.key(t, minor ? 'minor' : 'major');
}

const HAND_TEXT: Record<Hands, string> = { R: 'right hand', L: 'left hand', both: 'hands together', contrary: 'contrary motion' };

/* --------------------------------------------------------------- scales */

function scaleRun(tonic: Note, type: string, oct: number): Note[] {
  const one = T.scale(tonic, type);
  const per = one.length - 1;
  const up: Note[] = [];
  for (let o = 0; o < oct; o++) for (let i = 0; i < per; i++) up.push({ ...one[i]!, o: one[i]!.o + o });
  up.push({ ...tonic, o: tonic.o + oct });
  return up;
}

function genScale(s: Extract<Spec, { k: 'scale' }>): Generated {
  const minor = s.type === 'nminor' || s.type === 'hminor' || s.type === 'mminor' || s.type === 'pentminor' || s.type === 'blues' || s.type === 'dorian' || s.type === 'phrygian' || s.type === 'locrian';
  const k = keyFor(s.tonic, minor && (s.type === 'nminor' || s.type === 'hminor' || s.type === 'mminor'));
  const keyText = s.type === 'nminor' || s.type === 'hminor' || s.type === 'mminor' ? T.abcKey(k) : s.type === 'major' ? T.abcKey(k) : 'C';
  const fifths = keyText === 'C' ? 0 : k.fifths;
  const keyAlt = keyAltOf(fifths);
  const tonal = s.type === 'major' || s.type === 'nminor' || s.type === 'hminor' || s.type === 'mminor';
  const t = tonal ? k.tonic : T.note(s.tonic);
  const rhOct = s.hands === 'contrary' ? 4 : s.oct >= 3 || t.l >= 4 ? 3 : 4;
  const rh0: Note = { ...t, o: rhOct };
  const lh0: Note = { ...t, o: rhOct - 1 };
  const units = s.rhythm;
  const bar = UNIT;
  const voices: Voice[] = [];
  const mk = (hand: 'R' | 'L', start: Note, contrary: boolean): Voice => {
    const v = new Voice(hand === 'R' ? 'RH' : 'LH', hand === 'R' ? 'treble' : 'bass', keyAlt, bar);
    let up = scaleRun(start, s.type, s.oct);
    // Melodic minor comes down as the natural minor.
    let down = (s.type === 'mminor' ? scaleRun(start, 'nminor', s.oct) : up).slice(0, -1).reverse();
    if (contrary) {
      // The left hand goes down first while the right goes up, then back.
      const full = scaleRun({ ...start, o: start.o - s.oct }, s.type, s.oct);
      up = full.slice().reverse();
      down = full.slice(1);
    }
    const fUp = T.scaleFingers(start, s.type, hand, up.length);
    const fingersUp = contrary && hand === 'L' ? (T.scaleFingers({ ...start, o: start.o - s.oct }, s.type, 'L', up.length)?.slice().reverse() ?? null) : fUp;
    const all = up.concat(down);
    const fingers = fingersUp === null ? null : fingersUp.concat(fingersUp.slice(0, -1).reverse());
    all.forEach((n, i) => {
      const last = i === all.length - 1;
      const room = bar - v.pos;
      v.note(n, last ? Math.max(units, room) : units, { finger: fingers ? (fingers[i] ?? null) : null });
    });
    return v;
  };
  if (s.hands === 'R' || s.hands === 'both' || s.hands === 'contrary') voices.push(mk('R', rh0, false));
  if (s.hands === 'L' || s.hands === 'both' || s.hands === 'contrary') voices.push(mk('L', lh0, s.hands === 'contrary'));
  const sname = T.SCALES[s.type]?.name ?? s.type;
  const title = `${T.name(t, false)} ${sname.toLowerCase()} scale, ${s.oct} octave${s.oct > 1 ? 's' : ''}, ${HAND_TEXT[s.hands]}`;
  return { abc: render(title, 'Exercise', '4/4', s.rhythm === 1 ? 60 : s.rhythm === 2 ? 80 : 90, keyText, voices), title, skill: 'tech.scales', drill: 'technique', id: `${s.type}:${s.tonic}`, mode: 'learn', tempo: 70 };
}

/* ------------------------------------------------------------- arpeggios */

function genArpeggio(s: Extract<Spec, { k: 'arpeggio' }>): Generated {
  const minor = s.quality === 'min';
  const k = keyFor(s.tonic, minor);
  const t = s.quality === 'maj' || s.quality === 'min' ? k.tonic : T.note(s.tonic);
  const keyAlt = keyAltOf(s.quality === 'maj' || s.quality === 'min' ? k.fifths : 0);
  const keyText = s.quality === 'maj' || s.quality === 'min' ? T.abcKey(k) : 'C';
  const voices: Voice[] = [];
  const mk = (hand: 'R' | 'L', o: number): Voice => {
    const v = new Voice(hand === 'R' ? 'RH' : 'LH', hand === 'R' ? 'treble' : 'bass', keyAlt, UNIT);
    const base = T.chord({ ...t, o }, s.quality, s.inversion);
    const per = base.length;
    const up: Note[] = [];
    for (let i = 0; i < s.oct; i++) for (const n of base) up.push({ ...n, o: n.o + i });
    up.push({ ...base[0]!, o: base[0]!.o + s.oct });
    const down = up.slice(0, -1).reverse();
    const fUp = per === 3 && s.inversion === 0 ? T.arpeggioFingers(t, hand, up.length) : null;
    const fingers = fUp === null ? null : fUp.concat(fUp.slice(0, -1).reverse());
    const all = up.concat(down);
    all.forEach((n, i) => {
      const last = i === all.length - 1;
      v.note(n, last ? Math.max(2, UNIT - v.pos) : 2, { finger: fingers ? (fingers[i] ?? null) : null });
    });
    return v;
  };
  const o = t.l >= 4 ? 3 : 4;
  if (s.hands !== 'L') voices.push(mk('R', o));
  if (s.hands !== 'R') voices.push(mk('L', o - 1));
  const qn: Record<string, string> = { maj: 'major', min: 'minor', dim7: 'diminished seventh', '7': 'dominant seventh' };
  const inv = s.inversion === 0 ? '' : s.inversion === 1 ? ', first inversion' : s.inversion === 2 ? ', second inversion' : ', third inversion';
  const title = `${T.name(t, false)} ${qn[s.quality]} arpeggio${inv}, ${s.oct} octave${s.oct > 1 ? 's' : ''}, ${HAND_TEXT[s.hands === 'contrary' ? 'both' : s.hands]}`;
  return { abc: render(title, 'Exercise', '4/4', 80, keyText, voices), title, skill: 'tech.arps', drill: 'technique', id: `arp-${s.quality}:${s.tonic}`, mode: 'learn', tempo: 70 };
}

/* ------------------------------------------------------ five-finger, etc */

function genFive(s: Extract<Spec, { k: 'five' }>): Generated {
  const k = keyFor(s.tonic, s.minor);
  const t = k.tonic;
  const keyAlt = keyAltOf(k.fifths);
  const sc = T.scale({ ...t, o: 4 }, s.minor ? 'nminor' : 'major').slice(0, 5);
  const seq = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0];
  const voices: Voice[] = [];
  const mk = (hand: 'R' | 'L', shift: number): Voice => {
    const v = new Voice(hand === 'R' ? 'RH' : 'LH', hand === 'R' ? 'treble' : 'bass', keyAlt, UNIT);
    seq.forEach((d, i) => {
      const n = sc[d]!;
      const finger = hand === 'R' ? d + 1 : 5 - d;
      v.note({ ...n, o: n.o + shift }, i === seq.length - 1 ? UNIT : 4, { finger: i < 5 || i === seq.length - 1 ? finger : null });
    });
    return v;
  };
  if (s.hands !== 'L') voices.push(mk('R', 0));
  if (s.hands !== 'R') voices.push(mk('L', -1));
  const title = `${T.name(t, false)} ${s.minor ? 'minor' : 'major'} five-finger pattern, ${HAND_TEXT[s.hands === 'contrary' ? 'both' : s.hands]}`;
  return { abc: render(title, 'Exercise', '4/4', 90, T.abcKey(k), voices), title, skill: 'tech.five', drill: 'technique', id: `five${s.minor ? '-min' : ''}:${s.tonic}`, mode: 'learn', tempo: 80 };
}

function genChromatic(s: Extract<Spec, { k: 'chromatic' }>): Generated {
  const t = T.note(s.tonic);
  const voices: Voice[] = [];
  const mk = (hand: 'R' | 'L', start: number): Voice => {
    const v = new Voice(hand === 'R' ? 'RH' : 'LH', hand === 'R' ? 'treble' : 'bass', keyAltOf(0), UNIT);
    const up = T.chromatic(start, s.oct);
    const down = T.chromatic(start + 12 * s.oct, s.oct, true).slice(1);
    const fingerOf = (n: Note, next: Note | undefined, prev: Note | undefined): number => {
      const pc = T.pcOf(n);
      const black = [1, 3, 6, 8, 10].includes(pc);
      if (black) return 3;
      // Two white keys side by side (E–F, B–C) take 1 and 2.
      if (hand === 'R') return (pc === 5 || pc === 0) && prev !== undefined && [4, 11].includes(T.pcOf(prev)) ? 2 : 1;
      return (pc === 4 || pc === 11) && next !== undefined && [5, 0].includes(T.pcOf(next)) ? 2 : 1;
    };
    const all = up.concat(down);
    all.forEach((n, i) => {
      const last = i === all.length - 1;
      const asc = i < up.length;
      const f = asc ? fingerOf(n, all[i + 1], all[i - 1]) : fingerOf(n, all[i - 1], all[i + 1]);
      v.note(n, last ? Math.max(2, UNIT - v.pos) : 2, { finger: f });
    });
    return v;
  };
  const base = T.midiOf({ ...t, o: 4 });
  if (s.hands !== 'L') voices.push(mk('R', base));
  if (s.hands !== 'R') voices.push(mk('L', base - 12));
  const title = `Chromatic scale from ${T.name(t, false)}, ${s.oct} octave${s.oct > 1 ? 's' : ''}, ${HAND_TEXT[s.hands === 'contrary' ? 'both' : s.hands]}`;
  return { abc: render(title, 'Exercise', '4/4', 72, 'C', voices), title, skill: 'tech.scales', drill: 'technique', id: `chromatic:${s.tonic}`, mode: 'learn', tempo: 70 };
}

function genTriads(s: Extract<Spec, { k: 'triads' }>): Generated {
  const k = keyFor(s.tonic, s.mode === 'minor');
  const keyAlt = keyAltOf(k.fifths);
  const chords = T.diatonic(k);
  const rh = new Voice('RH', 'treble', keyAlt, UNIT);
  const lh = new Voice('LH', 'bass', keyAlt, UNIT);
  const order = [0, 1, 2, 3, 4, 5, 6, 0];
  order.forEach((d, i) => {
    const c = chords[d]!;
    const up = i === order.length - 1 ? 1 : 0;
    const notes = c.notes.map((n) => ({ ...n, o: n.o + up }));
    rh.note(notes, 8);
    lh.note({ ...c.root, o: c.root.o - 1 + up }, 8);
  });
  [...order].reverse().slice(1).forEach((d, i, arr) => {
    const c = chords[d]!;
    const last = i === arr.length - 1;
    rh.note(c.notes, last ? 16 : 8);
    lh.note({ ...c.root, o: c.root.o - 1 }, last ? 16 : 8);
  });
  const title = `The triads of ${T.keyName(k)}`;
  return { abc: render(title, 'Exercise', '4/4', 72, T.abcKey(k), [rh, lh]), title, skill: 'chord.play.1', drill: 'technique', id: `triads:${s.tonic}${s.mode === 'minor' ? 'm' : ''}`, mode: 'learn', tempo: 80 };
}

function genInversions(s: Extract<Spec, { k: 'inversions' }>): Generated {
  const t = T.note(s.tonic);
  const per = T.chordType(s.quality).ivs.length;
  const rh = new Voice('RH', 'treble', keyAltOf(0), UNIT);
  const steps: Note[][] = [];
  for (let inv = 0; inv <= per; inv++) {
    const ch = inv === per ? T.chord({ ...t, o: 5 }, s.quality, 0) : T.chord({ ...t, o: 4 }, s.quality, inv);
    steps.push(ch);
  }
  const seq = steps.concat(steps.slice(0, -1).reverse());
  seq.forEach((c, i) => {
    rh.note(c, i === seq.length - 1 ? 8 : 4);
  });
  // Then broken, one inversion per beat-group.
  for (const c of steps) for (const n of c) rh.note(n, 2);
  rh.note(steps[0]!, Math.max(4, UNIT - rh.pos));
  const title = `${T.chordSymbol(t, s.quality)} through its inversions`;
  return { abc: render(title, 'Exercise', '4/4', 72, 'C', [rh]), title, skill: per > 3 ? 'chord.play.3' : 'chord.play.2', drill: 'technique', id: `inv-${s.quality}:${s.tonic}`, mode: 'learn', tempo: 80 };
}

/* ---------------------------------------------------------- progressions */

function genProg(s: Extract<Spec, { k: 'prog' }>): Generated {
  const blues = s.prog === '12-bar';
  const def = T.PROGRESSIONS.find((p) => p.id === s.prog) ?? T.PROGRESSIONS[0]!;
  const minor = !blues && def.mode === 'minor';
  const k = keyFor(s.tonic, minor);
  const keyAlt = keyAltOf(k.fifths);
  const waltz = s.pattern === 'waltz' && !blues;
  const bar = waltz ? 12 : 16;
  const rh = new Voice('RH', 'treble', keyAlt, bar);
  const lh = new Voice('LH', 'bass', keyAlt, bar);
  let voiced: { bass: Note; upper: Note[]; roman: string; symbol: string }[];
  if (blues) {
    const degrees = [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5];
    const tonic = { ...k.tonic, o: 4 };
    voiced = degrees.map((d) => {
      const root = d === 1 ? tonic : T.transpose(tonic, T.iv(d === 4 ? 'P4' : 'P5'));
      const c = T.chord({ ...root, o: 4 }, '7');
      const upper = c.slice(1).map((n) => (T.midiOf(n) > 74 ? { ...n, o: n.o - 1 } : n)).sort((a, b) => T.midiOf(a) - T.midiOf(b));
      return { bass: { ...root, o: 2 }, upper, roman: d === 1 ? 'I7' : d === 4 ? 'IV7' : 'V7', symbol: T.chordSymbol(root, '7') };
    });
  } else voiced = T.voice(k, def.degrees, def.sevenths === true, def.subtonic === true);
  const rounds = blues ? 1 : 2;
  for (let r = 0; r < rounds; r++) {
    voiced.forEach((v, i) => {
      const lastChord = r === rounds - 1 && i === voiced.length - 1;
      const ch = v.upper;
      const b = v.bass;
      const third = ch.find((n) => ((T.pcOf(n) - T.pcOf(b) + 12) % 12 === 3 || (T.pcOf(n) - T.pcOf(b) + 12) % 12 === 4)) ?? ch[1]!;
      const fifth = T.transpose(b, T.iv('P5'));
      if (blues) {
        // Boogie: root–fifth, root–sixth in eighths; the right hand comps on 2 and 4.
        const six = T.transpose(b, T.iv('M6'));
        const pat = [b, fifth, b, six, b, fifth, b, six];
        for (const n of pat) lh.note({ ...n, o: n.o + (T.midiOf(n) < 36 ? 1 : 0) }, 2);
        rh.rest(4);
        rh.note(ch, 4, { stacc: true });
        rh.rest(4);
        rh.note(ch, 4, { stacc: true });
        return;
      }
      if (lastChord) {
        rh.note(ch, bar);
        lh.note(b, bar);
        return;
      }
      if (s.pattern === 'block') {
        rh.note(ch, bar);
        lh.note(b, bar);
      } else if (s.pattern === 'broken') {
        rh.note(ch, 8);
        for (const n of [ch[0]!, ch[1]!, ch[2]!, ch[1]!]) rh.note(n, 2);
        lh.note(b, bar);
      } else if (s.pattern === 'alberti') {
        rh.note(ch, bar);
        const lowCh = [b, { ...third, o: b.o + (T.midiOf({ ...third, o: b.o }) < T.midiOf(b) ? 1 : 0) }, fifth];
        const [lo, mid, hi] = [lowCh[0]!, lowCh[1]!, lowCh[2]!];
        for (const n of [lo, hi, mid, hi, lo, hi, mid, hi]) lh.note(n, 2);
      } else if (s.pattern === 'waltz') {
        lh.note(b, 4);
        lh.note({ ...fifth }, 4);
        lh.note({ ...fifth }, 4);
        rh.rest(4);
        rh.note(ch, 4);
        rh.note(ch, 4);
      } else if (s.pattern === 'arpeggio') {
        rh.note(ch, bar);
        const tenth = { ...third, o: third.o };
        const up = [b, fifth, { ...b, o: b.o + 1 }, tenth];
        for (const n of up.concat(up.slice(1, 3).reverse()).concat([fifth, b]).slice(0, 8)) lh.note(n, 2);
      } else {
        // Stride: a low bass on 1 and 3, the chord in the middle on 2 and 4.
        const midCh = ch.map((n) => ({ ...n, o: n.o - 1 }));
        lh.note({ ...b, o: b.o - (b.o > 2 ? 1 : 0) }, 4);
        lh.note(midCh, 4);
        lh.note({ ...fifth, o: fifth.o - (fifth.o > 2 ? 1 : 0) }, 4);
        lh.note(midCh, 4);
        rh.rest(bar);
      }
    });
  }
  if (blues) {
    rh.note(voiced[0]!.upper, UNIT);
    lh.note(voiced[0]!.bass, UNIT);
  }
  const pname = blues ? '12-bar blues' : def.name;
  const title = `${pname} in ${T.keyName(k)}${blues ? '' : `, ${s.pattern === 'block' ? 'block chords' : s.pattern === 'broken' ? 'broken chords' : s.pattern === 'alberti' ? 'Alberti bass' : s.pattern === 'waltz' ? 'waltz' : s.pattern === 'arpeggio' ? 'arpeggiated bass' : 'stride'}`}`;
  const level2 = blues || def.level === 2;
  return { abc: render(title, 'Exercise', waltz ? '3/4' : '4/4', blues ? 110 : 76, T.abcKey(k), [rh, lh]), title, skill: level2 ? 'prog.2' : 'prog.1', drill: 'prog', id: `prog:${s.prog}:${s.tonic}`, mode: 'learn', tempo: 80 };
}

/* --------------------------------------------------------------- rhythm */

const RHYTHM_BEAT: Record<number, string[][]> = {
  // [ABC on B (units in a beat of 4)], one entry per beat-sized cell
  1: [['B4'], ['B4'], ['B4'], ['z4']],
  2: [['B4'], ['B2B2'], ['B2B2'], ['z4'], ['z2B2']],
  3: [['B4'], ['B2B2'], ['z4'], ['B3B']],
  4: [['B4'], ['B2B2'], ['(3B2B2B2'], ['z2B2'], ['B3B']],
  5: [['B4'], ['B2B2'], ['BBBB'], ['B2BB'], ['BBB2'], ['B3B'], ['(3B2B2B2']],
};
const RHYTHM_LONG: Record<number, string[]> = {
  1: ['B8', 'B16', 'B8', 'z8'],
  2: ['B8', 'B8', 'z8'],
  3: ['B12', 'B6B2', 'B6B2', 'B8', 'B4-B4'],
  4: ['B2B4B2', 'B6B2', 'B2B4B2', 'B8'],
  5: ['B2B4B2', 'B6B2', 'B4-BBBB'],
};

function genRhythm(s: Extract<Spec, { k: 'rhythm' }>): Generated {
  const rnd = T.seeded(s.seed);
  const lvl = Math.max(1, Math.min(5, s.level));
  const bars: string[] = [];
  const nBars = lvl <= 2 ? 4 : 8;
  for (let b = 0; b < nBars; b++) {
    const cells: string[] = [];
    let beats = 0;
    while (beats < 4) {
      const long = rnd() < 0.35 && beats <= 2;
      if (long) {
        const opts = RHYTHM_LONG[lvl]!.filter((x) => (x === 'B16' ? beats === 0 : x === 'B12' ? beats <= 1 : true));
        const pick = T.rand(opts, rnd);
        const len = pick === 'B16' ? 4 : pick === 'B12' ? 3 : 2;
        if (beats + len > 4) continue;
        cells.push(pick);
        beats += len;
      } else {
        const cell = T.rand(RHYTHM_BEAT[lvl]!, rnd)[0]!;
        // Never start a bar on a rest at the first levels.
        if (beats === 0 && cell.startsWith('z') && lvl <= 2) continue;
        cells.push(cell);
        beats += 1;
      }
    }
    bars.push(cells.join(' '));
  }
  bars[bars.length - 1] = lvl <= 2 ? 'B8 B8' : 'B4 B4 B8';
  const lines: string[] = [];
  for (let i = 0; i < bars.length; i += 4) lines.push('[V:RH] ' + bars.slice(i, i + 4).join(' | ') + (i + 4 >= bars.length ? ' |]' : ' |'));
  const title = `Rhythm, level ${lvl}`;
  const abc = ['X:1', `T:${title}`, 'C:Exercise', 'M:4/4', 'L:1/16', `Q:1/4=${lvl <= 2 ? 80 : lvl <= 4 ? 72 : 66}`, 'V:RH clef=treble', 'K:C'].concat(lines).join('\n') + '\n';
  return { abc, title, skill: `rhythm.${lvl}`, drill: 'rhythm', id: `rhythm:${lvl}`, mode: 'play', tempo: 100, anyPitch: true, level: lvl };
}

/* --------------------------------------------------------- sight-reading */

interface SightParams {
  keys: string[];
  minorKeys: string[];
  meters: string[];
  bars: number;
  span: number;
  maxLeap: number;
  cells: string[];
  lh: 'none' | 'whole' | 'half' | 'quarter' | 'broken';
  chordProb: number;
  accProb: number;
  tempo: number;
  low: number;
}

function sightParams(level: number): SightParams {
  const L = Math.max(1, Math.min(30, level));
  const keys = L <= 4 ? ['C'] : L <= 6 ? ['C', 'G', 'F'] : L <= 10 ? ['C', 'G', 'F', 'D'] : L <= 14 ? ['C', 'G', 'F', 'D', 'Bb'] : L <= 20 ? ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb'] : ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db'];
  const minorKeys = L < 11 ? [] : L <= 16 ? ['A', 'E', 'D'] : ['A', 'E', 'D', 'G', 'B', 'C', 'F#'];
  const meters = L <= 2 ? ['4/4'] : L <= 13 ? ['4/4', '3/4'] : L <= 18 ? ['4/4', '3/4', '2/4', '6/8'] : ['4/4', '3/4', '6/8', '2/4'];
  const cells = L <= 1 ? ['h', 'q'] : L <= 4 ? ['h', 'q', 'q', 'w'] : L <= 8 ? ['h', 'q', 'q', 'ee'] : L <= 12 ? ['q', 'q', 'ee', 'h', 'dq'] : L <= 18 ? ['q', 'ee', 'dq', 'h', 'ee', 'qr'] : ['q', 'ee', 'ssss', 'dq', 'trip', 'h', 'ees'];
  return {
    keys,
    minorKeys,
    meters,
    bars: L <= 6 ? 4 : L <= 16 ? 8 : 8,
    span: L <= 3 ? 4 : L <= 8 ? 5 : L <= 14 ? 8 : 10,
    maxLeap: L <= 1 ? 1 : L <= 3 ? 2 : L <= 8 ? 3 : L <= 16 ? 4 : 6,
    cells,
    lh: L <= 5 ? 'none' : L <= 8 ? 'whole' : L <= 12 ? 'half' : L <= 17 ? 'quarter' : 'broken',
    chordProb: L < 16 ? 0 : L < 22 ? 0.12 : 0.22,
    accProb: L < 13 ? 0 : L < 20 ? 0.05 : 0.09,
    tempo: L <= 6 ? 72 : L <= 14 ? 80 : L <= 22 ? 88 : 96,
    low: L <= 8 ? 0 : -2,
  };
}

function genSight(s: Extract<Spec, { k: 'sight' }>): Generated {
  const rnd = T.seeded(s.seed);
  const P = sightParams(s.level);
  const minor = P.minorKeys.length > 0 && rnd() < 0.35;
  const tonicName = minor ? T.rand(P.minorKeys, rnd) : T.rand(P.keys, rnd);
  const k = keyFor(tonicName, minor);
  const keyAlt = keyAltOf(k.fifths);
  const meter = T.rand(P.meters, rnd);
  const compound = meter === '6/8';
  const barUnits = meter === '4/4' ? 16 : meter === '3/4' ? 12 : meter === '2/4' ? 8 : 12;
  const scaleType = minor ? 'hminor' : 'major';
  const tonic: Note = { ...k.tonic, o: k.tonic.l >= 4 ? 3 : 4 };
  const deg = (d: number): Note => {
    const per = 7;
    const o = Math.floor(d / per);
    const sc = T.scale(tonic, scaleType);
    const n = sc[((d % per) + per) % per]!;
    return { ...n, o: n.o + o };
  };
  const rh = new Voice('RH', 'treble', keyAlt, barUnits);
  const lh = new Voice('LH', 'bass', keyAlt, barUnits);
  let cur = 0;
  const lo = P.low;
  const hi = P.low + P.span - 1;
  const chordsOfKey = T.diatonic(k);
  const harmony: number[] = [];
  for (let b = 0; b < P.bars; b++) {
    const last = b === P.bars - 1;
    const plan = last ? [0] : b === P.bars - 2 ? [4] : [T.rand([0, 3, 4, 0, 5, 1], rnd)];
    harmony.push(plan[0]!);
    if (last) {
      rh.note(deg(0 + (cur > 3 ? 7 : 0) * 0), barUnits);
      continue;
    }
    let pos = 0;
    while (pos < barUnits) {
      const left = barUnits - pos;
      const options = P.cells.filter((c) => {
        const len = c === 'w' ? 16 : c === 'h' ? 8 : c === 'dq' ? 6 : c === 'ee' || c === 'ssss' || c === 'trip' || c === 'ees' ? 4 : c === 'qr' ? 4 : 4;
        if (compound) return c === 'q' || c === 'ee' || c === 'h';
        return len <= left;
      });
      const c = T.rand(options.length > 0 ? options : ['q'], rnd);
      const step = (): Note => {
        const dir = rnd() < 0.5 ? -1 : 1;
        const leap = 1 + Math.floor(rnd() * P.maxLeap);
        let next = cur + dir * (rnd() < 0.6 ? 1 : leap);
        if (next < lo) next = lo + (lo - next);
        if (next > hi) next = hi - (next - hi);
        cur = Math.max(lo, Math.min(hi, next));
        let n = deg(cur);
        if (P.accProb > 0 && rnd() < P.accProb && n.a === 0) n = { ...n, a: rnd() < 0.5 ? 1 : -1 };
        return n;
      };
      const maybeChord = (n: Note): Note[] | Note => (P.chordProb > 0 && rnd() < P.chordProb ? [T.transpose(n, T.iv(rnd() < 0.5 ? 'M3' : 'm3'), true), n].sort((a, b) => T.midiOf(a) - T.midiOf(b)) : n);
      if (compound) {
        if (c === 'h' && left >= 6) {
          rh.note(maybeChord(step()), 6);
          pos += 6;
        } else if (c === 'q' && left >= 4) {
          rh.note(step(), 4);
          rh.note(step(), 2);
          pos += 6;
        } else {
          rh.note(step(), 2);
          rh.note(step(), 2);
          rh.note(step(), 2);
          pos += 6;
        }
        continue;
      }
      if (c === 'w') {
        rh.note(maybeChord(step()), 16);
        pos += 16;
      } else if (c === 'h') {
        rh.note(maybeChord(step()), 8);
        pos += 8;
      } else if (c === 'dq' && left >= 6) {
        rh.note(step(), 6);
        if (left - 6 >= 2) {
          rh.note(step(), 2);
          pos += 8;
        } else pos += 6;
      } else if (c === 'ee') {
        rh.note(step(), 2);
        rh.note(step(), 2);
        pos += 4;
      } else if (c === 'ssss') {
        for (let i = 0; i < 4; i++) rh.note(step(), 1);
        pos += 4;
      } else if (c === 'ees') {
        rh.note(step(), 2);
        rh.note(step(), 1);
        rh.note(step(), 1);
        pos += 4;
      } else if (c === 'trip') {
        rh.triplet([step(), step(), step()], 2, 4);
        pos += 4;
      } else if (c === 'qr' && pos > 0) {
        rh.rest(4);
        pos += 4;
      } else {
        rh.note(maybeChord(step()), 4);
        pos += 4;
      }
    }
  }
  const hasLh = P.lh !== 'none';
  if (hasLh) {
    harmony.forEach((d, b) => {
      const c = chordsOfKey[d]!;
      const root = { ...c.root, o: 3 };
      const r = T.midiOf(root) > 55 ? { ...root, o: 2 } : root;
      const last = b === harmony.length - 1;
      if (P.lh === 'whole' || last) lh.note(r, barUnits);
      else if (P.lh === 'half') {
        if (compound) lh.note(r, barUnits);
        else {
          for (let p = 0; p < barUnits; p += 8) lh.note(p === 0 ? r : T.transpose(r, T.iv('P5')), Math.min(8, barUnits - p));
        }
      } else if (P.lh === 'quarter') {
        const tones = [r, T.transpose(r, T.iv('P5')), c.notes[1] ? { ...c.notes[1], o: r.o + (T.midiOf({ ...c.notes[1], o: r.o }) <= T.midiOf(r) ? 1 : 0) } : r];
        for (let p = 0, i = 0; p < barUnits; p += compound ? 6 : 4, i++) lh.note(tones[i % tones.length]!, compound ? 6 : 4);
      } else {
        const third = c.notes[1]!;
        const tones = [r, T.transpose(r, T.iv('P5')), { ...third, o: r.o + 1 }, T.transpose(r, T.iv('P5'))];
        for (let p = 0, i = 0; p < barUnits; p += 2, i++) lh.note(tones[i % 4]!, 2);
      }
    });
  }
  const title = `Sight-reading, level ${s.level}`;
  const voices = hasLh ? [rh, lh] : [rh];
  return { abc: render(title, 'Sight-reading', meter, P.tempo, T.abcKey(k), voices), title, skill: 'sight.read', drill: 'sight', id: `sight:${s.level}`, mode: 'play', tempo: 100, sight: true, level: s.level };
}

/* --------------------------------------------------------------- public */

export function generate(spec: Spec): Generated {
  switch (spec.k) {
    case 'scale':
      return genScale(spec);
    case 'arpeggio':
      return genArpeggio(spec);
    case 'five':
      return genFive(spec);
    case 'chromatic':
      return genChromatic(spec);
    case 'triads':
      return genTriads(spec);
    case 'inversions':
      return genInversions(spec);
    case 'prog':
      return genProg(spec);
    case 'rhythm':
      return genRhythm(spec);
    case 'sight':
      return genSight(spec);
  }
}

export function encodeSpec(spec: Spec): string {
  return btoa(JSON.stringify(spec)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSpec(text: string): Spec | null {
  try {
    const b = text.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as Spec;
  } catch {
    return null;
  }
}

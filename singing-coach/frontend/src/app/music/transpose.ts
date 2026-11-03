/**
 * The sung melody alone, moved to the key the singer sings it in, for the
 * engraved sheet: one staff in the singer's clef (treble, treble with an 8
 * below for men's voices, or bass), every note spelled again in the new key,
 * chord symbols moved with it, and the words of a verse under the notes.
 */
import type { Ev, EvKey, Model } from '../lib/types.ts';

const LETTERS = 'CDEFGAB';
const SEMI = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_BY_FIFTHS: Record<number, string> = { [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#' };
const MINOR_BY_FIFTHS: Record<number, string> = { [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#' };

function pcOfName(n: string): number {
  const l = LETTERS.indexOf(n[0] ?? 'C');
  const a = n.slice(1) === '#' ? 1 : n.slice(1) === 'b' ? -1 : 0;
  return (((SEMI[l] ?? 0) + a) % 12 + 12) % 12;
}

/** The key a shift leads to (at most six sharps or flats) and how far its letters move. */
export function keyAfter(fifths: number, minor: boolean, shift: number): { fifths: number; name: string; letterDelta: number } {
  const table = minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS;
  const oldName = table[Math.max(-6, Math.min(6, fifths))] ?? (minor ? 'A' : 'C');
  const pc = (pcOfName(oldName) + shift + 1200) % 12;
  let best = 0;
  let bestAbs = 99;
  for (let f = -6; f <= 6; f++) {
    const nm = table[f]!;
    if (pcOfName(nm) === pc && Math.abs(f) < bestAbs) {
      best = f;
      bestAbs = Math.abs(f);
    }
  }
  const name = table[best]!;
  let delta = LETTERS.indexOf(name[0]!) - LETTERS.indexOf(oldName[0]!);
  // The letter move follows the direction and size of the shift.
  const approx = Math.round((shift * 7) / 12);
  while (delta - approx > 3) delta -= 7;
  while (approx - delta > 3) delta += 7;
  return { fifths: best, name: name + (minor ? 'm' : ''), letterDelta: delta };
}

/** Spell a sounding note again after a shift: letters move by `letterDelta`. */
export function respell(step: string, octave: number, midi: number, shift: number, letterDelta: number): { step: string; alter: number; octave: number; midi: number } {
  const li = LETTERS.indexOf(step.toUpperCase());
  const abs = li + 7 * octave + letterDelta;
  const nl = ((abs % 7) + 7) % 7;
  const no = Math.floor(abs / 7);
  const m = midi + shift;
  const natural = 12 * (no + 1) + (SEMI[nl] ?? 0);
  return { step: LETTERS[nl]!, alter: m - natural, octave: no, midi: m };
}

function shiftChord(sym: string, shift: number, flats: boolean): string {
  const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const move = (root: string): string => {
    const pc = (pcOfName(root) + shift + 1200) % 12;
    return (flats ? FL : SH)[pc]!;
  };
  return sym.replace(/^([A-G][#b]?)/, (r) => move(r)).replace(/\/([A-G][#b]?)/, (_, r: string) => '/' + move(r));
}

/** The melody voice of a song as its own model, moved by `shift` semitones, in `clef`. */
export function melodyModel(model: Model, shift: number, clef: 'treble' | 'treble8' | 'bass'): Model {
  const mv = model.melodyVoice ?? 0;
  const minor = model.key.mode === 'minor';
  const k = keyAfter(model.key.fifths, minor, shift);
  // The treble clef with an 8 below is read an octave lower: draw the sounding notes an octave up.
  const up = clef === 'treble8' ? 1 : 0;
  const moveKey = (key: EvKey): EvKey => {
    if (shift === 0 && up === 0) return key;
    const r = respell(key[1], key[3], key[0], shift, k.letterDelta);
    return [r.midi + 12 * up, r.step, r.alter, r.octave + up, key[4], key[5], key[6]];
  };
  const events: Ev[][] = (model.events[mv] ?? []).map((bar) => bar.map((ev) => (ev.k === undefined ? ev : { ...ev, k: ev.k.map(moveKey) })));
  const notes = model.notes.filter((n) => n[6] === mv).map((n) => [n[0], n[1], n[2] + shift + 12 * up, 0, n[4], n[5], 0, n[7], n[8]] as Model['notes'][number]);
  const v = model.voices[mv] ?? { id: '1', name: 'Voice', hand: 'R' as const, clef: 'treble' };
  return {
    ...model,
    key: { fifths: k.fifths, mode: model.key.mode, name: k.name, vex: k.name },
    voices: [{ ...v, hand: 'R', clef: clef === 'treble8' ? 'treble8' : clef }],
    events: [events],
    notes,
    melodyVoice: 0,
    chords: (model.chords ?? []).map(([t, s]) => [t, shift === 0 ? s : shiftChord(s, shift, k.fifths < 0)] as [number, string]),
    pedal: [],
  };
}

/** Words of a verse by bar and onset, for the engraved sheet: "barIndex|ms" → syllable. */
export function lyricMap(model: Model, verse: number): Map<string, string> {
  const out = new Map<string, string>();
  const lyr = model.lyrics?.[Math.max(0, Math.min((model.lyrics?.length ?? 1) - 1, verse - 1))];
  if (lyr === undefined) return out;
  (model.melody ?? []).forEach((n, i) => {
    const s = lyr[i];
    if (s === undefined || s === '' || s === '_') return;
    const bar = model.bars[n[3]];
    if (bar === undefined) return;
    out.set(`${n[3]}|${Math.round((n[0] - bar.t) * 1000)}`, s);
  });
  return out;
}

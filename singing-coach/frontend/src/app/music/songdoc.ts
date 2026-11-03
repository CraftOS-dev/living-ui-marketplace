/**
 * A song as the editor holds it: the sung notes on a grid of ticks (48 a
 * quarter note) from the start of the first bar, each with its syllable in
 * every verse; chord symbols at ticks; the metre, the pickup, the tempo and
 * the key; any accompaniment kept as notes; the header lines the editor does
 * not touch (composer, licence, source, voicing, language, vowel) as they
 * were. It is made from the song's notation and the model the server parsed
 * from it, and written back as notation (musicxml.writeSong), which the
 * server checks and parses again.
 *
 * Plain functions on plain data: the editor keeps every version for undo.
 */
import type { Model } from '../lib/types.ts';
import { TICKS, barTicks, writeSong } from './musicxml.ts';
import type { SongSpec } from './musicxml.ts';
import { parseChord } from './theory.ts';

export { TICKS, barTicks };

export interface DocNote {
  id: number;
  t: number;
  d: number;
  midi: number;
  /** Per verse: the syllable ('' none: the note holds the one before, or carries no word). */
  syl: string[];
  /** Per verse: the word goes on into the next syllable (a hyphen). */
  join: boolean[];
  breath: boolean;
  stacc: boolean;
  spoken: boolean;
  free: boolean;
}

export interface DocChord {
  id: number;
  t: number;
  name: string;
}

export interface SongDoc {
  title: string;
  head: string[];
  meter: { num: number; den: number };
  pickup: number;
  tempo: number;
  fifths: number;
  mode: 'major' | 'minor';
  verses: number;
  voiceName: string;
  notes: DocNote[];
  chords: DocChord[];
  parts: SongSpec['parts'];
  /** What could not be kept as written (repeats written out, a change of metre). */
  changed: string[];
}

let seq = 1;
export const newId = (): number => seq++;

const DROP = /^(X|T|M|L|Q|K|V|w|W):/;

/** The song's notation and parsed model → the editor's song. */
export function docFromSong(abc: string, model: Model, title: string): SongDoc {
  const lines = abc.split(/\r?\n/);
  const kEnd = lines.findIndex((l) => /^K:/.test(l.trim()));
  const head = (kEnd >= 0 ? lines.slice(0, kEnd) : [])
    .map((l) => l.trim())
    .filter((l) => l !== '' && !DROP.test(l) && !/^%%melody\b/.test(l));
  const t0 = /^T:(.*)$/m.exec(abc)?.[1]?.trim() ?? '';
  const tick = (q: number): number => Math.round(q * TICKS);
  const changed: string[] = [];
  const srcs = model.bars.map((b) => b.src);
  if (new Set(srcs).size !== srcs.length) changed.push('Repeats are written out in full.');
  if (new Set(model.bars.map((b) => b.meter)).size > 1) changed.push(`The changes of metre become ${model.meter.label} throughout.`);
  const melody = model.melody ?? [];
  const lyr = (model.lyrics ?? []).filter((v) => v.some((s) => s !== '' && s !== '_'));
  const verses = lyr.length;
  const notes: DocNote[] = melody.map((n, i) => {
    const syl: string[] = [];
    const join: boolean[] = [];
    for (let v = 0; v < verses; v++) {
      const raw = lyr[v]![i] ?? '';
      const j = raw.endsWith('-') && raw.length > 1;
      const s = j ? raw.slice(0, -1) : raw;
      syl.push(s === '_' ? '' : s);
      join.push(j);
    }
    const f = n[4];
    return { id: newId(), t: tick(n[0]), d: Math.max(1, tick(n[1])), midi: n[2], syl, join, breath: (f & 4) !== 0, stacc: (f & 8) !== 0, spoken: (f & 1) !== 0, free: (f & 2) !== 0 };
  });
  const mv = model.melodyVoice ?? 0;
  const parts: SongSpec['parts'] = [];
  model.voices.forEach((v, vi) => {
    if (vi === mv) return;
    const ns = model.notes.filter((n) => n[6] === vi).map((n) => ({ t: tick(n[0]), d: Math.max(1, tick(n[1])), midi: n[2] }));
    if (ns.length > 0) parts.push({ name: v.name || `Part ${parts.length + 1}`, notes: ns });
  });
  return {
    title: t0 !== '' ? t0 : title,
    head,
    meter: { num: model.meter.num, den: model.meter.den },
    pickup: model.pickup ? tick(model.bars[0]?.len ?? 0) : 0,
    tempo: Math.round(model.tempo),
    fifths: model.key.fifths,
    mode: model.key.mode === 'minor' ? 'minor' : 'major',
    verses,
    voiceName: model.voices[mv]?.name || 'Voice',
    notes,
    chords: (model.chords ?? []).map(([q, name]) => ({ id: newId(), t: tick(q), name })),
    parts,
    changed,
  };
}

/** The editor's song → notation. */
export function docToAbc(doc: SongDoc): string {
  return writeSong({
    title: doc.title,
    head: doc.head,
    meter: doc.meter,
    pickup: doc.pickup,
    tempo: doc.tempo,
    fifths: doc.fifths,
    mode: doc.mode,
    verses: doc.verses,
    voiceName: doc.voiceName,
    melody: doc.notes,
    chords: doc.chords,
    parts: doc.parts,
  });
}

/* ------------------------------------------------------------- the grid */

/** Where bar `n` starts (bar 0 is the pickup when there is one; else bar 1 starts at 0). */
export function barStart(doc: SongDoc, n: number): number {
  const bt = barTicks(doc.meter);
  return doc.pickup > 0 ? (n <= 0 ? 0 : doc.pickup + (n - 1) * bt) : (n - 1) * bt;
}

/** The bar a tick is in, and the beat in it (1-based, fractional). */
export function barBeat(doc: SongDoc, t: number): { bar: number; beat: number } {
  const bt = barTicks(doc.meter);
  const beatT = (4 / doc.meter.den) * TICKS;
  // A pickup counts as the end of a full bar (a one-beat pickup in 3/4 is beat 3).
  if (doc.pickup > 0 && t < doc.pickup) return { bar: 0, beat: 1 + (t + bt - doc.pickup) / beatT };
  const from = doc.pickup;
  const bar = Math.floor((t - from) / bt) + 1;
  return { bar, beat: 1 + (t - from - (bar - 1) * bt) / beatT };
}

/** The end of the song: the last note or chord, rounded up to a bar line. */
export function songEnd(doc: SongDoc): number {
  const bt = barTicks(doc.meter);
  const last = Math.max(doc.pickup + bt, ...doc.notes.map((n) => n.t + n.d), ...doc.chords.map((c) => c.t + 1));
  return doc.pickup + Math.ceil((last - doc.pickup) / bt) * bt;
}

/**
 * One note at a time: sorted, and where two overlap the earlier one is cut
 * short (or goes, if nothing of it is left) — unless it is one of `keep`
 * (just moved or drawn), when the other gives way.
 */
export function normalize(doc: SongDoc, keep: Set<number> = new Set()): SongDoc {
  const ns = doc.notes
    .map((n) => ({ ...n, t: Math.max(0, Math.round(n.t)), d: Math.max(1, Math.round(n.d)), midi: Math.max(24, Math.min(108, n.midi)) }))
    .sort((a, b) => a.t - b.t || (keep.has(a.id) ? -1 : 1));
  const out: DocNote[] = [];
  for (const n of ns) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.t + prev.d > n.t) {
      if (prev.t === n.t) {
        // Two at once: the kept one stays.
        if (keep.has(n.id) && !keep.has(prev.id)) out[out.length - 1] = n;
        continue;
      }
      if (keep.has(prev.id) && !keep.has(n.id)) {
        // The kept note covers the start of this one: what is left of it starts after.
        const end = n.t + n.d;
        const t = prev.t + prev.d;
        if (end - t >= 3) out.push({ ...n, t, d: end - t, syl: n.syl.map(() => ''), join: n.join.map(() => false) });
        continue;
      }
      prev.d = n.t - prev.t;
    }
    out.push(n);
  }
  return { ...doc, notes: out, chords: doc.chords.slice().sort((a, b) => a.t - b.t) };
}

/* ---------------------------------------------------------------- keys */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pcOfName(n: string): number {
  const base = PC[n[0] ?? 'C'] ?? 0;
  const acc = n.slice(1).replace(/[^#b♯♭]/g, '');
  return (base + [...acc].reduce((a, c) => a + (c === '#' || c === '♯' ? 1 : -1), 0) + 12) % 12;
}

/** The key signature (fifths) whose major (or minor) tonic is this pitch class, the simplest spelling. */
export function fifthsFor(tonicPc: number, mode: 'major' | 'minor'): number {
  const major = mode === 'minor' ? (tonicPc + 3) % 12 : tonicPc;
  let best = 0;
  for (let f = -6; f <= 6; f++) if ((((f * 7) % 12) + 12) % 12 === major && (best === 0 || Math.abs(f) < Math.abs(best))) best = f;
  return (((best * 7) % 12) + 12) % 12 === major ? best : 0;
}

export function tonicOf(fifths: number, mode: 'major' | 'minor'): number {
  const major = (((fifths * 7) % 12) + 12) % 12;
  return mode === 'minor' ? (major + 9) % 12 : major;
}

export function keyLabel(fifths: number, mode: 'major' | 'minor'): string {
  const names = fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  return `${(names[tonicOf(fifths, mode)] ?? 'C').replace('#', '♯').replace('b', '♭')} ${mode}`;
}

/** A chord symbol moved by semitones, spelled for the key (the bass after a slash too). */
export function transposeChord(name: string, semis: number, fifths: number): string {
  const p = parseChord(name);
  if (p === null) return name;
  const names = fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const m = /^([A-G](?:#|b|♯|♭)?)(.*?)(?:\/([A-G](?:#|b|♯|♭)?))?$/.exec(name.trim());
  if (m === null) return name;
  const root = names[(pcOfName(m[1] ?? 'C') + semis + 120) % 12]!;
  const bass = m[3] !== undefined ? '/' + names[(pcOfName(m[3]) + semis + 120) % 12]! : '';
  return root + (m[2] ?? '') + bass;
}

/** The whole song moved by semitones: notes, chords, accompaniment and the key. */
export function transpose(doc: SongDoc, semis: number): SongDoc {
  if (semis === 0) return doc;
  const fifths = fifthsFor((tonicOf(doc.fifths, doc.mode) + semis + 120) % 12, doc.mode);
  return {
    ...doc,
    fifths,
    notes: doc.notes.map((n) => ({ ...n, midi: n.midi + semis })),
    chords: doc.chords.map((c) => ({ ...c, name: transposeChord(c.name, semis, fifths) })),
    parts: doc.parts.map((p) => ({ ...p, notes: p.notes.map((n) => ({ ...n, midi: n.midi + semis })) })),
  };
}

/* -------------------------------------------------------------- words */

/** Where a phrase ends: the next rest of a beat or more, else the song's end. */
function phraseEnd(doc: SongDoc, i: number): number {
  const beat = (4 / doc.meter.den) * TICKS;
  let j = i;
  while (j + 1 < doc.notes.length) {
    const a = doc.notes[j]!;
    const b = doc.notes[j + 1]!;
    if (b.t - (a.t + a.d) >= beat) break;
    j++;
  }
  return j;
}

/**
 * The words of one verse from note i to the end of its phrase, one note
 * earlier (-1) or later (+1). Earlier needs the note before to be free of a
 * syllable of its own; later pushes the phrase's last syllable onto its last
 * note with the one before it.
 */
export function shiftWords(doc: SongDoc, i: number, verse: number, dir: -1 | 1): SongDoc | null {
  const end = phraseEnd(doc, i);
  const notes = doc.notes.map((n) => ({ ...n, syl: n.syl.slice(), join: n.join.slice() }));
  const S = (k: number): string => notes[k]!.syl[verse] ?? '';
  const J = (k: number): boolean => notes[k]!.join[verse] ?? false;
  const set = (k: number, s: string, j: boolean): void => {
    notes[k]!.syl[verse] = s;
    notes[k]!.join[verse] = j;
  };
  if (dir === -1) {
    if (i === 0 || S(i - 1) !== '') return null;
    for (let k = i - 1; k < end; k++) set(k, S(k + 1), J(k + 1));
    set(end, '', false);
  } else {
    const lastS = S(end);
    const lastJ = J(end);
    for (let k = end; k > i; k--) set(k, S(k - 1), J(k - 1));
    set(i, '', false);
    // What fell off the end goes with the last note's own syllable.
    if (lastS !== '') set(end, S(end) === '' ? lastS : `${S(end)}${/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(lastS) ? '' : ' '}${lastS}`, lastJ);
  }
  return { ...doc, notes };
}

/** A copy with one more (empty) verse, or without verse `v`. */
export function addVerse(doc: SongDoc): SongDoc {
  return { ...doc, verses: doc.verses + 1, notes: doc.notes.map((n) => ({ ...n, syl: [...n.syl, ''], join: [...n.join, false] })) };
}

export function removeVerse(doc: SongDoc, v: number): SongDoc {
  return { ...doc, verses: Math.max(0, doc.verses - 1), notes: doc.notes.map((n) => ({ ...n, syl: n.syl.filter((_, k) => k !== v), join: n.join.filter((_, k) => k !== v) })) };
}

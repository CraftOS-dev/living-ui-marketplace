/**
 * Files in, ABC notation out: .abc as it is, MusicXML (.musicxml, .xml,
 * compressed .mxl, as exported by MuseScore, Sibelius, Finale, Dorico and
 * others) and UltraStar karaoke files (.txt) converted here; UltraStar out
 * (toUltraStar). The result goes through the same check as anything typed,
 * so the person sees what was read before adding it.
 *
 * MusicXML: the sung line is the part that carries the words (or the one
 * named voice, soprano, tenor and so on; else the first part), its first
 * voice, with every verse of lyrics. A piano part (two staves, or named
 * piano, keyboard, organ, harp, guitar) is kept as the accompaniment, every
 * staff and voice of it, played as written; other instruments are left out.
 * Chord symbols (<harmony>) are kept wherever they are written.
 *
 * UltraStar: the notes, their syllables and line breaks (which become
 * breaths); golden notes sing like any other, freestyle and rap notes are
 * drawn but not scored. The key is read from the notes.
 *
 * Chords, when a file names none, are worked out: from the piano part and
 * the melody together when there is a piano part (harmony.ts, the chord
 * analysis), else from the melody alone (harmonize below: the key's own
 * chords scored against the notes, strong beats weighing most, with the
 * usual progressions and a cadence home). They are written as chord symbols,
 * which the person can see and correct in the notation.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { Model } from '../lib/types.ts';
import { chordTrack } from './harmony.ts';

export interface Imported {
  abc: string;
  title: string;
  composer: string;
  warnings: string[];
  /** Where the chord symbols came from. */
  chords: 'written' | 'piano' | 'melody' | 'recording' | 'none';
  /** A piano part plays as written. */
  accompaniment: boolean;
}

/** Ticks per quarter note (32nds and triplets of 8ths and 16ths land on whole ticks). */
const TPQ = 48;
/** L:1/16: one ABC unit is a sixteenth, 12 ticks. */
const UNIT = 12;
const MAX_ACC_VOICES = 4;

type Clef = 'treble' | 'treble-8' | 'bass';

interface P {
  step: string;
  alter: number;
  oct: number;
  midi: number;
}

interface Item {
  /** Ticks from the start of the measure, and the sounding length. */
  t: number;
  dur: number;
  rest: boolean;
  ps: P[];
  /** Tied to the next note. */
  tie: boolean;
  /** Continues a tie (carries no syllable). */
  cont: boolean;
  /** Tuplet [actual, normal], e.g. [3, 2]. */
  tm: [number, number] | null;
  stacc: boolean;
  /** Per verse: the syllable ('' none; '_' held from the last one). */
  syl: string[];
  /** Per verse: the word goes on after this syllable. */
  join: boolean[];
  breath: boolean;
  free: boolean;
  spoken: boolean;
  /** A chord symbol written before it. */
  cs: string;
}

interface Voice {
  id: string;
  name: string;
  clef: Clef;
  melody: boolean;
  /** The first voice of its staff (fills gaps with visible rests). */
  primary: boolean;
  measures: Item[][];
}

interface MeasureInfo {
  start: number;
  len: number;
  /** The metre's own length (a pickup is shorter). */
  meterLen: number;
  label: string;
  fifths: number;
  mode: 'major' | 'minor';
  meterChange: boolean;
  keyChange: boolean;
}

interface Score {
  title: string;
  composer: string;
  tempo: number;
  measures: MeasureInfo[];
  voices: Voice[];
  verses: number;
  marks: { at: number; name: string }[];
}

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
const VOCAL = /voice|vocal|voix|stimme|voce|sopran|mezzo|alto|contralto|tenor|bariton|bass|melod|sing|lead|chant|canto/i;
const KEYBOARD = /piano|klavier|pianoforte|keyboard|organ|orgel|harp|harpsichord|cembalo|guitar|gitarre|accomp/i;

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function keyName(fifths: number, mode: string): string {
  const i = Math.max(-7, Math.min(7, fifths)) + 7;
  return (mode === 'minor' ? MINOR[i] : MAJOR[i]) ?? 'C';
}

function keyAlters(fifths: number): Record<string, number> {
  const m: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (let i = 0; i < Math.abs(fifths) && i < 7; i++) m[(fifths > 0 ? SHARPS : FLATS)[i] ?? 'C'] = fifths > 0 ? 1 : -1;
  return m;
}

function tonicPc(fifths: number, mode: 'major' | 'minor'): number {
  const major = (((fifths * 7) % 12) + 12) % 12;
  return mode === 'minor' ? (major + 9) % 12 : major;
}

function headerOf(abc: string, field: string): string {
  return new RegExp(`^${field}:(.*)$`, 'm').exec(abc)?.[1]?.trim() ?? '';
}

function blank(): Omit<Item, 't' | 'dur'> {
  return { rest: true, ps: [], tie: false, cont: false, tm: null, stacc: false, syl: [], join: [], breath: false, free: false, spoken: false, cs: '' };
}

export async function importFile(file: File): Promise<Imported> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.abc')) {
    const abc = await file.text();
    return { abc, title: headerOf(abc, 'T'), composer: headerOf(abc, 'C'), warnings: [], chords: /"[A-G]/.test(abc) ? 'written' : 'none', accompaniment: false };
  }
  if (name.endsWith('.txt')) {
    const text = await file.text();
    if (/^#(TITLE|BPM)\s*:/im.test(text)) return finish(fromUltraStar(text), ['UltraStar files have no bars: the song is set in 4/4 and the key is read from the notes. Check both, and the sections, before adding.']);
    if (/^X:\s*\d*/m.test(text) && /^K:/m.test(text)) return { abc: text, title: headerOf(text, 'T'), composer: headerOf(text, 'C'), warnings: [], chords: /"[A-G]/.test(text) ? 'written' : 'none', accompaniment: false };
    throw new Error('This text file is neither ABC notation nor an UltraStar song.');
  }
  if (name.endsWith('.mxl')) {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    let path = '';
    const container = files['META-INF/container.xml'];
    if (container !== undefined) {
      const m = /full-path="([^"]+)"/.exec(strFromU8(container));
      if (m !== null) path = m[1] ?? '';
    }
    if (path === '' || files[path] === undefined) path = Object.keys(files).find((k) => !k.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(k)) ?? '';
    const data = files[path];
    if (data === undefined) throw new Error('This .mxl file has no score inside.');
    return fromMusicXml(strFromU8(data));
  }
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return fromMusicXml(await file.text());
  if (name.endsWith('.mid') || name.endsWith('.midi') || name.endsWith('.kar')) throw new Error('MIDI files carry no reliable notation or words. Export MusicXML from your notation app, or ask the coach to add the song.');
  throw new Error('Choose an .abc, .musicxml, .xml, .mxl or UltraStar .txt file.');
}

/* ------------------------------------------------------------- MusicXML */

function text(el: Element | null | undefined, sel: string): string {
  return el?.querySelector(sel)?.textContent?.trim() ?? '';
}

/** A chord symbol from <harmony> as ABC text ("Am7", "F#/C#"). */
function harmonyName(h: Element): string {
  const step = text(h, 'root > root-step');
  if (step === '') return '';
  const alter = Number(text(h, 'root > root-alter') || '0');
  const kind = text(h, 'kind');
  const kindText = h.querySelector('kind')?.getAttribute('text') ?? null;
  const SUFFIX: Record<string, string> = {
    major: '',
    minor: 'm',
    augmented: 'aug',
    diminished: 'dim',
    dominant: '7',
    'major-seventh': 'maj7',
    'minor-seventh': 'm7',
    'diminished-seventh': 'dim7',
    'augmented-seventh': 'aug7',
    'half-diminished': 'm7b5',
    'major-minor': 'm(maj7)',
    'major-sixth': '6',
    'minor-sixth': 'm6',
    'dominant-ninth': '9',
    'major-ninth': 'maj9',
    'minor-ninth': 'm9',
    'suspended-second': 'sus2',
    'suspended-fourth': 'sus4',
  };
  const suffix = kindText !== null && kindText !== '' && /^[\w#b+()]*$/.test(kindText) ? kindText : (SUFFIX[kind] ?? '');
  let out = step + (alter === 1 ? '#' : alter === -1 ? 'b' : '') + suffix;
  const bass = text(h, 'bass > bass-step');
  if (bass !== '') {
    const ba = Number(text(h, 'bass > bass-alter') || '0');
    out += '/' + bass + (ba === 1 ? '#' : ba === -1 ? 'b' : '');
  }
  return out;
}

interface PartRead {
  measures: { items: Map<string, Item[]>; content: number; meterLen: number; label: string; fifths: number; mode: 'major' | 'minor'; meterChange: boolean; keyChange: boolean; implicit: boolean }[];
  /** Voice keys "staff:voice" in order of appearance. */
  keys: string[];
  clefs: Record<string, Clef>;
  staves: number;
  harmony: { m: number; t: number; name: string }[];
  tempo: number | null;
  verses: number;
  graces: boolean;
}

function readPart(part: Element): PartRead {
  let divisions = 1;
  let fifths = 0;
  let mode: 'major' | 'minor' = 'major';
  let label = '4/4';
  let meterLen = 4 * TPQ;
  let tempo: number | null = null;
  let verses = 0;
  let graces = false;
  const clefs: Record<string, Clef> = {};
  const keys: string[] = [];
  const harmony: PartRead['harmony'] = [];
  const out: PartRead['measures'] = [];
  const staves = Number(text(part, 'attributes > staves') || '1') || 1;
  const pendingBreath = new Set<string>();
  Array.from(part.querySelectorAll(':scope > measure')).forEach((m, mi) => {
    let pos = 0;
    let len = 0;
    let meterChange = false;
    let keyChange = false;
    const items = new Map<string, Item[]>();
    const last = new Map<string, Item>();
    for (const el of Array.from(m.children)) {
      const tag = el.nodeName;
      if (tag === 'attributes') {
        const d = text(el, 'divisions');
        if (d !== '') divisions = Number(d) || divisions;
        const f = text(el, 'key > fifths');
        if (f !== '') {
          const nf = Number(f) || 0;
          const nm = text(el, 'key > mode') === 'minor' ? 'minor' : 'major';
          if (mi > 0 && (nf !== fifths || nm !== mode)) keyChange = true;
          fifths = nf;
          mode = nm;
        }
        const b = text(el, 'time > beats');
        if (b !== '') {
          const beats = b.split('+').reduce((a, x) => a + (Number(x) || 0), 0) || 4;
          const bt = Number(text(el, 'time > beat-type')) || 4;
          const nl = `${beats}/${bt}`;
          if (mi > 0 && nl !== label) meterChange = true;
          label = nl;
          meterLen = Math.round((beats * 4 * TPQ) / bt);
        }
        for (const c of Array.from(el.querySelectorAll('clef'))) {
          const n = c.getAttribute('number') ?? '1';
          const sign = text(c, 'sign');
          const oct = Number(text(c, 'clef-octave-change') || '0');
          clefs[n] = sign === 'F' ? 'bass' : oct === -1 ? 'treble-8' : 'treble';
        }
      } else if (tag === 'direction') {
        const snd = el.querySelector('sound[tempo]');
        if (snd !== null && tempo === null) tempo = Number(snd.getAttribute('tempo')) || null;
        if (/breath/i.test(text(el, 'direction-type > words'))) pendingBreath.add((text(el, 'staff') || '1') + ':' + (text(el, 'voice') || '1'));
      } else if (tag === 'sound') {
        if (el.getAttribute('tempo') !== null && tempo === null) tempo = Number(el.getAttribute('tempo')) || null;
      } else if (tag === 'harmony') {
        const nm = harmonyName(el);
        const off = Number(text(el, 'offset') || '0');
        if (nm !== '') harmony.push({ m: mi, t: Math.round(((pos + off) * TPQ) / divisions), name: nm });
      } else if (tag === 'backup') pos -= Number(text(el, 'duration')) || 0;
      else if (tag === 'forward') {
        pos += Number(text(el, 'duration')) || 0;
        len = Math.max(len, pos);
      } else if (tag === 'note') {
        if (el.querySelector('grace') !== null) {
          graces = true;
          continue;
        }
        const chord = el.querySelector('chord') !== null;
        const dur = Number(text(el, 'duration')) || 0;
        if (el.querySelector('cue') !== null) {
          if (!chord) pos += dur;
          continue;
        }
        const key = (text(el, 'staff') || '1') + ':' + (text(el, 'voice') || '1');
        if (!keys.includes(key)) keys.push(key);
        const isRest = el.querySelector('rest') !== null;
        const ties = Array.from(el.querySelectorAll('tie, notations > tied'));
        const tieStart = ties.some((x) => x.getAttribute('type') === 'start');
        const tieStop = ties.some((x) => x.getAttribute('type') === 'stop');
        let p: P | null = null;
        if (!isRest) {
          const step = text(el, 'pitch > step') || 'C';
          const alter = Math.round(Number(text(el, 'pitch > alter') || '0'));
          const oct = Number(text(el, 'pitch > octave') || '4');
          p = { step, alter, oct, midi: (oct + 1) * 12 + (STEP[step] ?? 0) + alter };
        }
        if (chord) {
          const prev = last.get(key);
          if (prev !== undefined && p !== null) {
            prev.ps.push(p);
            if (tieStart) prev.tie = true;
          }
          continue;
        }
        const am = text(el, 'time-modification > actual-notes');
        const nm = text(el, 'time-modification > normal-notes');
        const item: Item = {
          ...blank(),
          t: Math.round((pos * TPQ) / divisions),
          dur: Math.max(1, Math.round((dur * TPQ) / divisions)),
          rest: isRest,
          ps: p !== null ? [p] : [],
          tie: tieStart && !isRest,
          cont: tieStop && !isRest,
          tm: am !== '' && nm !== '' ? [Number(am), Number(nm)] : null,
          stacc: el.querySelector('notations > articulations > staccato') !== null,
          free: el.querySelector('notehead[parentheses="yes"]') !== null,
          spoken: el.querySelector('notehead')?.textContent === 'x',
        };
        if (!isRest) {
          item.breath = pendingBreath.has(key);
          pendingBreath.delete(key);
          for (const ly of Array.from(el.querySelectorAll(':scope > lyric'))) {
            const v = Math.max(1, Number(ly.getAttribute('number') ?? '1') || 1) - 1;
            if (v > 7) continue;
            const tx = Array.from(ly.querySelectorAll('text'))
              .map((x) => x.textContent ?? '')
              .join(' ')
              .trim();
            if (tx === '') continue;
            const sy = text(ly, 'syllabic');
            item.syl[v] = tx;
            item.join[v] = sy === 'begin' || sy === 'middle';
            verses = Math.max(verses, v + 1);
          }
          // A breath mark on a note is a breath after it.
          if (el.querySelector('notations > articulations > breath-mark') !== null) pendingBreath.add(key);
        }
        const list = items.get(key) ?? [];
        list.push(item);
        items.set(key, list);
        last.set(key, item);
        pos += dur;
        len = Math.max(len, pos);
      }
    }
    out.push({ items, content: Math.round((len * TPQ) / divisions), meterLen, label, fifths, mode, meterChange, keyChange, implicit: m.getAttribute('implicit') === 'yes' });
  });
  return { measures: out, keys, clefs, staves, harmony, tempo, verses, graces };
}

function sortKeys(keys: string[]): string[] {
  return keys.slice().sort((a, b) => {
    const [sa, va] = a.split(':').map(Number);
    const [sb, vb] = b.split(':').map(Number);
    return (sa ?? 0) - (sb ?? 0) || (va ?? 0) - (vb ?? 0);
  });
}

export function fromMusicXml(xml: string): Imported {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) throw new Error('This file is not valid MusicXML.');
  const root = doc.documentElement;
  if (root.nodeName === 'score-timewise') throw new Error('Timewise MusicXML is not supported; export partwise MusicXML.');
  if (root.nodeName !== 'score-partwise') throw new Error('This file is not a MusicXML score.');
  const warnings: string[] = [];
  const title = text(root, 'work > work-title') || text(root, 'movement-title') || text(root, 'credit-words');
  const composer = root.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ?? '';
  const parts = Array.from(root.querySelectorAll(':scope > part'));
  if (parts.length === 0) throw new Error('This score has no parts.');
  const names = new Map<string, string>();
  for (const sp of Array.from(root.querySelectorAll('part-list > score-part'))) names.set(sp.getAttribute('id') ?? '', `${text(sp, 'part-name')} ${text(sp, 'part-abbreviation')}`.trim());
  const nameOf = (p: Element): string => names.get(p.getAttribute('id') ?? '') ?? '';
  const melPart = parts.find((p) => p.querySelector('note > lyric') !== null) ?? parts.find((p) => VOCAL.test(nameOf(p)) && !KEYBOARD.test(nameOf(p))) ?? parts[0]!;
  const accPart = parts.find((p) => p !== melPart && (Number(text(p, 'attributes > staves') || '1') >= 2 || KEYBOARD.test(nameOf(p)))) ?? null;
  const left = parts.filter((p) => p !== melPart && p !== accPart).length;
  if (left > 0) warnings.push(`${left === 1 ? 'One other part was' : `${left} other parts were`} left out; the sung line${accPart !== null ? ' and the piano part are' : ' is'} kept.`);

  const mel = readPart(melPart);
  const acc = accPart !== null ? readPart(accPart) : null;
  if (mel.measures.length === 0) throw new Error('This score has no measures.');

  // The sung voice: the voice with words, else the first voice of the first staff.
  const melKeys = sortKeys(mel.keys);
  const withWords = melKeys.find((k) => mel.measures.some((m) => (m.items.get(k) ?? []).some((it) => it.syl.length > 0)));
  const melKey = withWords ?? melKeys[0] ?? '1:1';
  const melStaff = melKey.split(':')[0] ?? '1';

  // Measures: the longest content of either part, a pickup kept short, the rest filled to the metre.
  let start = 0;
  const measures: MeasureInfo[] = mel.measures.map((m, i) => {
    const content = Math.max(m.content, acc?.measures[i]?.content ?? 0);
    let len = content === 0 ? m.meterLen : content;
    if (len < m.meterLen && !(i === 0 && content > 0)) len = m.meterLen;
    const info: MeasureInfo = { start, len, meterLen: m.meterLen, label: m.label, fifths: m.fifths, mode: m.mode, meterChange: m.meterChange, keyChange: m.keyChange };
    start += len;
    return info;
  });

  // Voices: the melody first, then the accompaniment (the piano part; the melody part's other staves when it has two).
  const voices: Voice[] = [];
  const pick = (src: PartRead, key: string): Item[][] => measures.map((_, i) => (src.measures[i]?.items.get(key) ?? []).map((it) => ({ ...it, ps: it.ps.slice() })));
  const melItems = pick(mel, melKey);
  let chordsInMelody = false;
  for (const ms of melItems)
    for (const it of ms)
      if (it.ps.length > 1) {
        // The tune is the top note of a chord in the sung line.
        chordsInMelody = true;
        it.ps = [it.ps.reduce((a, b) => (b.midi > a.midi ? b : a))];
      }
  const melNotes = melItems.flat().filter((it) => !it.rest);
  if (melNotes.length === 0) throw new Error('No sung notes were found in this score.');
  voices.push({ id: 'S', name: 'Voice', clef: mel.clefs[melStaff] ?? clefFor(melNotes.map((it) => it.ps[0]!.midi)), melody: true, primary: true, measures: melItems });

  const accSources: { src: PartRead; key: string }[] = [];
  if (mel.staves >= 2) for (const k of sortKeys(mel.keys)) if (k !== melKey && (k.split(':')[0] ?? '1') !== melStaff) accSources.push({ src: mel, key: k });
  if (acc !== null) for (const k of sortKeys(acc.keys)) accSources.push({ src: acc, key: k });
  const otherSung = melKeys.filter((k) => k !== melKey && (k.split(':')[0] ?? '1') === melStaff);
  if (otherSung.length > 0) warnings.push('A second voice on the sung staff was left out.');
  if (accSources.length > MAX_ACC_VOICES) warnings.push(`The accompaniment has ${accSources.length} voices; the first ${MAX_ACC_VOICES} are kept.`);
  const perStaff = new Map<string, number>();
  for (const { src, key } of accSources.slice(0, MAX_ACC_VOICES)) {
    const staff = key.split(':')[0] ?? '1';
    const tag = `${src === mel ? 'M' : 'P'}${staff}`;
    const n = (perStaff.get(tag) ?? 0) + 1;
    perStaff.set(tag, n);
    const items = pick(src, key);
    if (items.every((ms) => ms.every((it) => it.rest))) continue;
    voices.push({ id: `P${voices.length}`, name: 'Piano', clef: src.clefs[staff] ?? (staff === '2' ? 'bass' : 'treble'), melody: false, primary: n === 1, measures: items });
  }

  // Chord symbols written anywhere, in absolute ticks (one per moment).
  const marks: Score['marks'] = [];
  for (const h of [...mel.harmony, ...(acc?.harmony ?? [])]) {
    const at = (measures[h.m]?.start ?? 0) + h.t;
    if (!marks.some((x) => x.at === at)) marks.push({ at, name: h.name });
  }
  marks.sort((a, b) => a.at - b.at);

  if (mel.verses === 0) warnings.push('This score has no words; it is added as a wordless song, sung on one vowel.');
  if (chordsInMelody) warnings.push('Chords in the sung line were reduced to their top note.');
  if (mel.graces || acc?.graces === true) warnings.push('Grace notes were left out.');
  if (root.querySelector('repeat, ending') !== null) warnings.push('Repeats were written out once; add the repeat back in the notation if you need it.');
  const score: Score = { title, composer, tempo: mel.tempo ?? acc?.tempo ?? 90, measures, voices, verses: mel.verses, marks };
  return finish(score, warnings);
}

function clefFor(midis: number[]): Clef {
  const sorted = midis.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 64;
  return med < 50 ? 'bass' : med < 60 ? 'treble-8' : 'treble';
}

/* ------------------------------------------------------------ UltraStar */

/** A pitch spelled in a key (sharps in sharp keys, flats in flat ones). */
function spellMidi(midi: number, fifths: number): P {
  const pc = ((midi % 12) + 12) % 12;
  const SH: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const FL: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
  const [step, alter] = (fifths < 0 ? FL : SH)[pc]!;
  return { step, alter, oct: Math.floor((midi - alter) / 12) - 1, midi };
}

// Krumhansl-Kessler key profiles: how strongly each scale step belongs to a major and a minor key.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** The fifths of a key signature for a major tonic (fewest accidentals). */
function fifthsOf(majorPc: number): number {
  let best: number | null = null;
  for (let f = -6; f <= 6; f++) if ((((f * 7) % 12) + 12) % 12 === majorPc && (best === null || Math.abs(f) < Math.abs(best))) best = f;
  return best ?? 0;
}

/**
 * The key of a melody: the pitch classes weighted by length, correlated with
 * the major and minor profiles in all 24 keys (Krumhansl-Schmuckler), with a
 * bonus when the tune ends on the tonic and a smaller one when it starts there.
 */
function guessKey(notes: { d: number; midi: number }[]): { fifths: number; mode: 'major' | 'minor' } {
  const pcOf = (m: number): number => ((m % 12) + 12) % 12;
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[pcOf(n.midi)] = (hist[pcOf(n.midi)] ?? 0) + n.d;
  const lastPc = pcOf(notes[notes.length - 1]?.midi ?? 0);
  const firstPc = pcOf(notes[0]?.midi ?? 0);
  let best = { score: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const prof = mode === 'major' ? KK_MAJOR : KK_MINOR;
      const rotated = hist.map((_, pc) => prof[(pc - tonic + 12) % 12]!);
      const score = corr(hist, rotated) + (lastPc === tonic ? 0.15 : 0) + (firstPc === tonic ? 0.04 : 0);
      if (score > best.score) best = { score, tonic, mode };
    }
  }
  const majorPc = best.mode === 'minor' ? (best.tonic + 3) % 12 : best.tonic;
  return { fifths: fifthsOf(majorPc), mode: best.mode };
}

/**
 * UltraStar: "#BPM" counts beats of a sixteenth (the file's BPM is a
 * quarter of the beat rate), each note line is "<type> <start> <length>
 * <pitch> <syllable>" with pitch 0 = C4, and "- <beat>" ends a line.
 */
function fromUltraStar(src: string): Score {
  const tags = new Map<string, string>();
  const raw: { t: number; d: number; midi: number; syl: string; breath: boolean; free: boolean; spoken: boolean }[] = [];
  let breakNext = false;
  let relative = false;
  let offset = 0;
  for (const line0 of src.split(/\r?\n/)) {
    // Keep a note line's trailing space: it ends a word ("kle " then "lit").
    const line = line0.startsWith('#') || line0.trim() === '' || line0.trim() === 'E' ? line0.trim() : line0;
    if (line.startsWith('#')) {
      const i = line.indexOf(':');
      if (i > 1) tags.set(line.slice(1, i).trim().toUpperCase(), line.slice(i + 1).trim());
      if (/^#RELATIVE\s*:\s*yes/i.test(line)) relative = true;
      continue;
    }
    if (line.startsWith('E')) break;
    if (line === '') continue;
    const type = line[0];
    if (type === '-') {
      breakNext = true;
      if (relative) {
        const ps = line.slice(1).trim().split(/\s+/);
        offset += Number(ps[1] ?? ps[0]) || 0;
      }
      continue;
    }
    if (type !== ':' && type !== '*' && type !== 'F' && type !== 'R' && type !== 'G') continue;
    const m = /^.\s*(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/.exec(line);
    if (m === null) continue;
    raw.push({ t: Number(m[1]) + offset, d: Math.max(1, Number(m[2])), midi: 60 + Number(m[3]), syl: m[4] ?? '', breath: breakNext, free: type === 'F', spoken: type === 'R' || type === 'G' });
    breakNext = false;
  }
  if (raw.length === 0) throw new Error('No notes were found in this UltraStar file.');
  // Pitches may sit in any octave; move the line to where it most likely sits.
  const sorted = raw.map((n) => n.midi).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 60;
  const shift = med < 45 ? 12 * Math.ceil((52 - med) / 12) : med > 84 ? -12 * Math.ceil((med - 72) / 12) : 0;
  for (const n of raw) n.midi += shift;
  // Start on the first bar: drop the lead-in before the first note's bar (16 beats a bar).
  const lead = raw[0]!.t - (raw[0]!.t % 16);
  const key = guessKey(raw);
  const bar = 16 * UNIT;
  const end = Math.max(...raw.map((n) => (n.t - lead + n.d) * UNIT));
  const count = Math.max(1, Math.ceil(end / bar));
  const measures: MeasureInfo[] = Array.from({ length: count }, (_, i) => ({ start: i * bar, len: bar, meterLen: bar, label: '4/4', fifths: key.fifths, mode: key.mode, meterChange: false, keyChange: false }));
  const items: Item[][] = measures.map(() => []);
  raw.forEach((n, i) => {
    // Words: a syllable that starts with a space begins a word; "~" holds the last one.
    const s = n.syl;
    const ns = raw[i + 1]?.syl ?? ' ';
    const held = s.trim() === '~' || s.trim() === '';
    const nextHeld = ns.trim() === '~' || ns.trim() === '';
    const join = !nextHeld && !/\s$/.test(s) && !/^\s/.test(ns) && raw[i + 1] !== undefined && !raw[i + 1]!.breath;
    let t = (n.t - lead) * UNIT;
    let left = n.d * UNIT;
    let first = true;
    while (left > 0) {
      const mi = Math.min(count - 1, Math.floor(t / bar));
      const ms = measures[mi]!;
      const piece = Math.min(left, ms.start + ms.len - t);
      items[mi]!.push({
        ...blank(),
        t: t - ms.start,
        dur: piece,
        rest: false,
        ps: [spellMidi(n.midi, key.fifths)],
        tie: left > piece,
        cont: !first,
        syl: first ? [held ? '_' : s.trim()] : [],
        join: first ? [join] : [],
        breath: first && n.breath && i > 0,
        free: n.free,
        spoken: n.spoken,
      });
      first = false;
      t += piece;
      left -= piece;
    }
  });
  const bpm = Number((tags.get('BPM') ?? '120').replace(',', '.')) || 120;
  const notes = raw.map((n) => n.midi);
  return {
    title: tags.get('TITLE') ?? 'Imported song',
    composer: tags.get('COMPOSER') ?? tags.get('ARTIST') ?? '',
    tempo: Math.max(30, Math.min(240, Math.round(bpm))),
    measures,
    voices: [{ id: 'S', name: 'Voice', clef: clefFor(notes), melody: true, primary: true, measures: items }],
    verses: 1,
    marks: [],
  };
}

/* ------------------------------------------------------- working out chords */

const ROOT_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_NATURAL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function rootName(pc: number, fifths: number): string {
  return (fifths < 0 ? ROOT_FLAT : fifths > 0 ? ROOT_SHARP : ROOT_NATURAL)[((pc % 12) + 12) % 12] ?? 'C';
}

/** harmony.ts's symbols (♯ ♭ ° ø +) in ABC's plain spelling. */
function asciiChord(sym: string): string {
  return sym.replace(/♯/g, '#').replace(/♭/g, 'b').replace('°7', 'dim7').replace('°', 'dim').replace(/\+$/, 'aug');
}

/** Beats in a bar and the length of one, in ticks (6/8 is two dotted quarters). */
function beatsOf(m: MeasureInfo): { beats: number; beatLen: number } {
  const [num, den] = m.label.split('/').map(Number);
  const n = num ?? 4;
  const d = den ?? 4;
  if (d === 8 && n % 3 === 0 && n > 3) return { beats: n / 3, beatLen: (3 * 4 * TPQ) / 8 };
  return { beats: n, beatLen: (4 * TPQ) / d };
}

interface Cand {
  deg: number;
  q: '' | 'm' | 'dim';
  tones: number[];
  /** The seventh that makes it a dominant seventh, if it is the dominant. */
  seventh?: number;
  prior: number;
}

const MAJOR_CANDS: Cand[] = [
  { deg: 0, q: '', tones: [0, 4, 7], prior: 0.3 },
  { deg: 2, q: 'm', tones: [0, 3, 7], prior: 0.1 },
  { deg: 4, q: 'm', tones: [0, 3, 7], prior: 0.03 },
  { deg: 5, q: '', tones: [0, 4, 7], prior: 0.22 },
  { deg: 7, q: '', tones: [0, 4, 7], seventh: 10, prior: 0.25 },
  { deg: 9, q: 'm', tones: [0, 3, 7], prior: 0.12 },
  { deg: 2, q: '', tones: [0, 4, 7], prior: 0.02 },
];
const MINOR_CANDS: Cand[] = [
  { deg: 0, q: 'm', tones: [0, 3, 7], prior: 0.3 },
  { deg: 5, q: 'm', tones: [0, 3, 7], prior: 0.18 },
  { deg: 7, q: '', tones: [0, 4, 7], seventh: 10, prior: 0.24 },
  { deg: 3, q: '', tones: [0, 4, 7], prior: 0.1 },
  { deg: 8, q: '', tones: [0, 4, 7], prior: 0.1 },
  { deg: 10, q: '', tones: [0, 4, 7], prior: 0.07 },
  { deg: 2, q: 'dim', tones: [0, 3, 6], prior: 0.02 },
];
/** Progressions that sound right ("from-to" in semitones above the tonic) and one that does not. */
const MOVES: Record<string, number> = { '7-0': 0.2, '5-7': 0.1, '2-7': 0.12, '0-5': 0.06, '0-7': 0.06, '9-2': 0.07, '9-5': 0.06, '5-0': 0.07, '7-9': 0.04, '4-9': 0.05, '3-8': 0.04, '8-5': 0.05, '10-3': 0.05, '8-7': 0.05, '7-5': -0.12 };

/**
 * Chords for a melody alone: per bar one chord, or two (on even metres)
 * when that fits clearly better; each scored by how much of the melody it
 * holds (strong beats and long notes weigh most, a passing note costs
 * little), how common it is in the key and how it follows the last; the
 * first chord leans to the tonic and the last bar goes home.
 */
function harmonize(score: Score): { at: number; name: string }[] {
  const mel = score.voices[0]!;
  const m0 = score.measures[0]!;
  const fifths = m0.fifths;
  const mode = m0.mode;
  const tonic = tonicPc(fifths, mode);
  const cands = mode === 'minor' ? MINOR_CANDS : MAJOR_CANDS;
  const notes: { t: number; d: number; midi: number }[] = [];
  score.measures.forEach((ms, i) => {
    for (const it of mel.measures[i] ?? []) if (!it.rest && it.ps[0] !== undefined) notes.push({ t: ms.start + it.t, d: it.dur, midi: it.ps[0].midi });
  });
  if (notes.length === 0) return [];
  const lastWithNotes = score.measures.reduce((acc, ms, i) => ((mel.measures[i] ?? []).some((it) => !it.rest) ? i : acc), 0);

  const fit = (c: Cand, a: number, b: number, beatLen: number): { score: number; seventh: boolean } => {
    const root = (tonic + c.deg) % 12;
    let sum = 0;
    let total = 0;
    let sev = 0;
    for (const n of notes) {
      if (n.t >= b) break;
      const e = n.t + n.d;
      if (e <= a) continue;
      const ov = Math.min(e, b) - Math.max(n.t, a);
      if (ov <= 0) continue;
      const struck = n.t >= a;
      const onBeat = struck && (n.t - a) % beatLen === 0;
      const w = (ov / beatLen) * (!struck ? 0.6 : n.t === a ? 1.6 : onBeat ? 1.2 : 0.8);
      total += w;
      const rel = (((n.midi - root) % 12) + 12) % 12;
      if (c.tones.includes(rel)) sum += w;
      else if (c.seventh === rel) {
        sum += 0.6 * w;
        sev += w;
      } else sum -= (onBeat || n.d >= beatLen ? 0.7 : 0.35) * w;
    }
    return { score: total > 0 ? sum / total : 0, seventh: sev > 0 };
  };

  interface Opt {
    segs: { at: number; c: number; seventh: boolean }[];
    emit: number;
  }
  const options: Opt[][] = score.measures.map((ms, mi) => {
    const { beats, beatLen } = beatsOf(ms);
    const out: Opt[] = [];
    const finalBar = mi === lastWithNotes;
    cands.forEach((c, ci) => {
      const f = fit(c, ms.start, ms.start + ms.len, beatLen);
      let emit = f.score + c.prior * 0.4;
      if (finalBar && c.deg === 0) emit += 0.8;
      out.push({ segs: [{ at: ms.start, c: ci, seventh: f.seventh }], emit });
    });
    if (beats >= 2 && beats % 2 === 0 && ms.len === ms.meterLen) {
      const half = ms.len / 2;
      cands.forEach((c1, i1) => {
        const f1 = fit(c1, ms.start, ms.start + half, beatLen);
        cands.forEach((c2, i2) => {
          if (i1 === i2) return;
          const f2 = fit(c2, ms.start + half, ms.start + ms.len, beatLen);
          let emit = (f1.score + f2.score) / 2 + ((c1.prior + c2.prior) / 2) * 0.4 + (MOVES[`${c1.deg}-${c2.deg}`] ?? 0) - 0.1;
          if (finalBar) emit += c2.deg === 0 ? 0.8 : -0.3;
          out.push({ segs: [{ at: ms.start, c: i1, seventh: f1.seventh }, { at: ms.start + half, c: i2, seventh: f2.seventh }], emit });
        });
      });
    }
    return out;
  });

  // Best path over the bars (a chord carries into a bar of rests).
  const n = options.length;
  const best: { score: number; from: number }[][] = options.map((o) => o.map(() => ({ score: -Infinity, from: -1 })));
  options[0]!.forEach((o, k) => {
    best[0]![k] = { score: o.emit + (cands[o.segs[0]!.c]!.deg === 0 ? 0.3 : cands[o.segs[0]!.c]!.deg === 7 ? 0.1 : 0), from: -1 };
  });
  for (let i = 1; i < n; i++) {
    options[i]!.forEach((o, k) => {
      const first = cands[o.segs[0]!.c]!;
      let top = -Infinity;
      let from = -1;
      options[i - 1]!.forEach((p, j) => {
        const prevC = cands[p.segs[p.segs.length - 1]!.c]!;
        const move = prevC === first ? 0.04 : (MOVES[`${prevC.deg}-${first.deg}`] ?? 0);
        const s = best[i - 1]![j]!.score + move;
        if (s > top) {
          top = s;
          from = j;
        }
      });
      best[i]![k] = { score: top + o.emit, from };
    });
  }
  let k = best[n - 1]!.reduce((bi, x, i, arr) => (x.score > arr[bi]!.score ? i : bi), 0);
  const path: Opt[] = [];
  for (let i = n - 1; i >= 0; i--) {
    path.unshift(options[i]![k]!);
    k = best[i]![k]!.from;
  }
  const out: { at: number; name: string }[] = [];
  let last = '';
  for (const o of path)
    for (const s of o.segs) {
      const c = cands[s.c]!;
      const name = rootName((tonic + c.deg) % 12, fifths) + (c.seventh !== undefined && s.seventh ? '7' : c.q);
      if (name !== last) out.push({ at: s.at, name });
      last = name;
    }
  return out;
}

/** Chords from everything that sounds (piano and melody), by harmony.ts's analysis. */
function chordsFromParts(score: Score): { at: number; name: string }[] {
  const notes: Model['notes'] = [];
  score.voices.forEach((v, vi) => {
    score.measures.forEach((ms, mi) => {
      for (const it of v.measures[mi] ?? []) {
        if (it.rest) continue;
        for (const p of it.ps) notes.push([(ms.start + it.t) / TPQ, it.dur / TPQ, p.midi, v.clef === 'bass' ? 1 : 0, 0, 64, vi, mi, 0]);
      }
    });
  });
  notes.sort((a, b) => a[0] - b[0]);
  const m0 = score.measures[0]!;
  const last = score.measures[score.measures.length - 1]!;
  const model = {
    notes,
    key: { fifths: m0.fifths, mode: m0.mode, name: keyName(m0.fifths, m0.mode), vex: '' },
    beat: beatsOf(m0).beatLen / TPQ,
    bars: score.measures.map((ms, i) => ({ n: i, t: ms.start / TPQ, len: ms.len / TPQ, src: 0, meter: ms.label })),
    total: (last.start + last.len) / TPQ,
    chords: [],
  } as unknown as Model;
  const spans = chordTrack(model).map((s) => ({ at: Math.round(s.t * TPQ), end: Math.round((s.t + s.d) * TPQ), name: asciiChord(s.sym) }));
  // Bars the analysis leaves blank (a bare octave or a single note): the melody's harmony fills them.
  const fill = harmonize(score);
  const out: { at: number; name: string }[] = spans.map((s) => ({ at: s.at, name: s.name }));
  for (const ms of score.measures) {
    if (spans.some((s) => s.at <= ms.start && ms.start < s.end)) continue;
    let carry: string | null = null;
    for (const f of fill) if (f.at <= ms.start) carry = f.name;
    const inBar = fill.filter((f) => f.at > ms.start && f.at < ms.start + ms.len && !spans.some((s) => s.at <= f.at && f.at < s.end));
    if (carry !== null) out.push({ at: ms.start, name: carry });
    out.push(...inBar);
  }
  out.sort((x, y) => x.at - y.at);
  // One symbol per change.
  return out.filter((m, i) => i === 0 || m.name !== out[i - 1]!.name);
}

/** Write chord symbols into the sung line, splitting a note (tied) where a chord changes inside it. */
function applyMarks(score: Score): void {
  const mel = score.voices[0]!;
  score.measures.forEach((ms, mi) => {
    // Fill the gaps with rests so every moment of the bar has an item.
    const items = (mel.measures[mi] ?? []).slice().sort((a, b) => a.t - b.t);
    const full: Item[] = [];
    let cur = 0;
    for (const it of items) {
      if (it.t < cur) continue;
      if (it.t > cur) full.push({ ...blank(), t: cur, dur: it.t - cur });
      full.push(it);
      cur = it.t + it.dur;
    }
    if (cur < ms.len) full.push({ ...blank(), t: cur, dur: ms.len - cur });
    for (const mk of score.marks) {
      const at = mk.at - ms.start;
      if (at < 0 || at >= ms.len) continue;
      const k = full.findIndex((it) => it.t <= at && at < it.t + it.dur);
      if (k < 0) continue;
      const it = full[k]!;
      if (it.t === at || it.tm !== null) {
        if (it.cs === '') it.cs = mk.name;
        continue;
      }
      const a: Item = { ...it, dur: at - it.t, tie: !it.rest };
      const b: Item = { ...it, t: at, dur: it.t + it.dur - at, cont: !it.rest, syl: [], join: [], breath: false, cs: mk.name };
      full.splice(k, 1, a, b);
    }
    mel.measures[mi] = full;
  });
}

/** A sung note on a grid of quarter notes, with its syllable (from a recording). */
export interface GridNote {
  q: number;
  d: number;
  midi: number;
  syl?: string | undefined;
  join?: boolean | undefined;
  breath?: boolean | undefined;
}

/**
 * A song from notes found in a recording: quarter notes from bar 1 (a pickup
 * is negative), the metre's beats, the tempo, the key and the chords heard.
 * Returns the notation and where bar 1 sits in it (quarter notes from the
 * start), which the backing track's map needs.
 */
export function fromNotes(opts: { notes: GridNote[]; chords: { q: number; name: string }[]; meter: number; bpm: number; fifths: number; mode: 'major' | 'minor'; title: string; words: boolean }): Imported & { bar1Q: number } {
  const notes = opts.notes.slice().sort((a, b) => a.q - b.q);
  if (notes.length === 0) throw new Error('No sung notes were found in the recording.');
  const barQ = opts.meter;
  const startQ = Math.min(0, notes[0]!.q, ...opts.chords.map((c) => c.q));
  // Before bar 1: a pickup shorter than a bar, else whole bars.
  const before = -startQ;
  const pickup = before > 1e-9 && before < barQ - 1e-9;
  const bar1Q = pickup ? before : Math.ceil(before / barQ - 1e-9) * barQ;
  const tick = (q: number): number => Math.round((q + bar1Q) * 4) * UNIT;
  const end = Math.max(...notes.map((n) => tick(n.q + n.d)));
  const barT = barQ * TPQ;
  const label = `${opts.meter}/4`;
  const measures: MeasureInfo[] = [];
  let t = 0;
  if (pickup) {
    measures.push({ start: 0, len: tick(0), meterLen: barT, label, fifths: opts.fifths, mode: opts.mode, meterChange: false, keyChange: false });
    t = tick(0);
  }
  while (t < end) {
    measures.push({ start: t, len: barT, meterLen: barT, label, fifths: opts.fifths, mode: opts.mode, meterChange: false, keyChange: false });
    t += barT;
  }
  const items: Item[][] = measures.map(() => []);
  const find = (x: number): number => {
    for (let i = measures.length - 1; i >= 0; i--) if (measures[i]!.start <= x) return i;
    return 0;
  };
  for (const n of notes) {
    let at = tick(n.q);
    let left = Math.max(UNIT, tick(n.q + n.d) - at);
    let first = true;
    while (left > 0) {
      const mi = find(at);
      const ms = measures[mi]!;
      const piece = Math.min(left, ms.start + ms.len - at);
      if (piece <= 0) break;
      items[mi]!.push({
        ...blank(),
        t: at - ms.start,
        dur: piece,
        rest: false,
        ps: [spellMidi(n.midi, opts.fifths)],
        tie: left > piece,
        cont: !first,
        syl: first && n.syl !== undefined ? [n.syl] : [],
        join: first && n.join !== undefined ? [n.join] : [],
        breath: first && n.breath === true,
      });
      first = false;
      at += piece;
      left -= piece;
    }
  }
  const score: Score = {
    title: opts.title,
    composer: '',
    tempo: Math.max(30, Math.min(240, Math.round(opts.bpm))),
    measures,
    voices: [{ id: 'S', name: 'Voice', clef: clefFor(notes.map((n) => n.midi)), melody: true, primary: true, measures: items }],
    verses: opts.words ? 1 : 0,
    marks: opts.chords.map((c) => ({ at: tick(c.q), name: c.name })).filter((c) => c.at >= 0),
  };
  const warnings: string[] = [];
  const heard = score.marks.length > 0;
  const out = finish(score, warnings);
  return { ...out, chords: heard ? 'recording' : out.chords, bar1Q };
}

function finish(score: Score, warnings: string[]): Imported {
  let chords: Imported['chords'] = 'written';
  const acc = score.voices.length > 1;
  if (score.marks.length === 0) {
    if (acc) {
      score.marks = chordsFromParts(score);
      chords = 'piano';
      if (score.marks.length > 0) warnings.push('The chords were worked out from the piano part and are shown as chord symbols; the piano part itself plays as written.');
    } else {
      score.marks = harmonize(score);
      chords = 'melody';
      if (score.marks.length > 0) warnings.push('The file names no chords, so they were worked out from the melody: a fitting harmony in the key, not necessarily the original. Check them in the notation before adding.');
    }
    if (score.marks.length === 0) chords = 'none';
  }
  applyMarks(score);
  return { abc: writeAbc(score), title: score.title, composer: score.composer, warnings, chords, accompaniment: acc };
}

/* ------------------------------------------------------------ write ABC */

function lengthText(ticks: number): string {
  const g = gcd(ticks, UNIT) || 1;
  const num = ticks / g;
  const den = UNIT / g;
  if (den === 1) return num === 1 ? '' : String(num);
  return (num === 1 ? '' : String(num)) + '/' + den;
}

function pitchText(p: P, acc: Record<string, number>, keyAlt: Record<string, number>): string {
  const id = p.step + p.oct;
  const cur = acc[id] ?? keyAlt[p.step] ?? 0;
  let a = '';
  if (p.alter !== cur) {
    a = p.alter === 1 ? '^' : p.alter === 2 ? '^^' : p.alter === -1 ? '_' : p.alter === -2 ? '__' : '=';
    acc[id] = p.alter;
  }
  const letter = p.oct >= 5 ? p.step.toLowerCase() + "'".repeat(p.oct - 5) : p.step + ','.repeat(Math.max(0, 4 - p.oct));
  return a + letter;
}

/** ABC w: text for one syllable: the characters with a meaning in w: lines are dropped. */
function wordText(s: string): string {
  return s.replace(/[-_*~|\\]/g, '').replace(/\s+/g, '~').trim();
}

/**
 * ABC from a score. `kept` are header lines to keep as the song had them
 * (C:, %%licence, %%source, %%voice, %%language, %%vowel…); without them an
 * imported song's header is written.
 */
function writeAbc(score: Score, kept?: string[]): string {
  const verses = Math.max(0, Math.min(8, score.verses));
  const head = ['X:1', `T:${score.title || 'Imported song'}`];
  const m0 = score.measures[0]!;
  if (kept !== undefined) {
    head.push(...kept.filter((l) => l.startsWith('C:')), `M:${m0.label}`, 'L:1/16', `Q:1/4=${Math.round(score.tempo)}`, ...kept.filter((l) => !l.startsWith('C:')));
    if (verses === 0 && !kept.some((l) => l.startsWith('%%vowel'))) head.push('%%vowel ah');
  } else {
    if (score.composer !== '') head.push(`C:${score.composer}`);
    head.push(`M:${m0.label}`, 'L:1/16', `Q:1/4=${Math.round(score.tempo)}`, '%%licence import');
    if (verses === 0) head.push('%%vowel ah');
  }
  for (const v of score.voices) head.push(`V:${v.id} clef=${v.clef} name="${v.name}"`);
  head.push(`K:${keyName(m0.fifths, m0.mode)}`);

  const barText: string[][] = score.voices.map(() => []);
  const barWords: string[][][][] = score.voices.map(() => []);
  score.voices.forEach((v, vi) => {
    const held: boolean[] = Array.from({ length: verses }, () => false);
    score.measures.forEach((ms, mi) => {
      const keyAlt = keyAlters(ms.fifths);
      const acc: Record<string, number> = {};
      const parts: string[] = [];
      const words: string[][] = Array.from({ length: verses }, () => []);
      if (ms.keyChange) parts.push(`[K:${keyName(ms.fifths, ms.mode)}]`);
      if (ms.meterChange) parts.push(`[M:${ms.label}]`);
      const items = (v.measures[mi] ?? []).slice().sort((a, b) => a.t - b.t);
      const restChar = v.primary ? 'z' : 'x';
      let cur = 0;
      let tupLeft = 0;
      let wrote = false;
      const gap = (to: number): void => {
        if (to > cur) {
          parts.push(restChar + lengthText(to - cur));
          wrote = true;
          for (let k = 0; k < verses; k++) held[k] = false;
        }
        cur = Math.max(cur, to);
      };
      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii]!;
        if (it.t < cur) continue;
        gap(it.t);
        let shown = it.dur;
        let pre = '';
        if (it.tm !== null) {
          const [a, n] = it.tm;
          shown = Math.round((it.dur * a) / n);
          if (tupLeft <= 0) {
            let r = a;
            if (a === 3 && n === 2) {
              // A triplet group ends where its notes add up to plain time (a quarter and an eighth make two notes).
              r = 0;
              let sum = 0;
              for (let k = ii; k < items.length && items[k]!.tm !== null; k++) {
                r++;
                sum += items[k]!.dur;
                if (sum % 3 === 0) break;
              }
            }
            pre = a === 3 && n === 2 && r === 3 ? '(3' : `(${a}:${n}:${r}`;
            tupLeft = r;
          }
          tupLeft -= 1;
        } else tupLeft = 0;
        const cs = v.melody && it.cs !== '' ? `"${it.cs}"` : '';
        wrote = true;
        if (it.rest) {
          parts.push(pre + cs + restChar + lengthText(shown));
          for (let k = 0; k < verses; k++) held[k] = false;
        } else {
          const deco = (v.melody && it.breath ? '!breath!' : '') + (v.melody && it.spoken ? '!spoken!' : v.melody && it.free ? '!free!' : '') + (it.stacc ? '.' : '');
          const ps = it.ps.slice().sort((a, b) => a.midi - b.midi);
          const body = ps.length === 1 ? pitchText(ps[0]!, acc, keyAlt) : '[' + ps.map((p) => pitchText(p, acc, keyAlt)).join('') + ']';
          parts.push(pre + cs + deco + body + lengthText(shown) + (it.tie ? '-' : ''));
          if (v.melody && !it.cont)
            for (let k = 0; k < verses; k++) {
              const s = it.syl[k];
              if (s !== undefined && s !== '' && s !== '_' && wordText(s) !== '') {
                words[k]!.push(wordText(s) + (it.join[k] === true ? '-' : ''));
                held[k] = true;
              } else if (held[k] === true || s === '_') words[k]!.push('_');
              else words[k]!.push('*');
            }
        }
        cur = it.t + it.dur;
      }
      gap(ms.len);
      if (!wrote) parts.push(restChar + lengthText(ms.len));
      barText[vi]!.push(parts.join(' '));
      barWords[vi]!.push(words);
    });
  });

  const body: string[] = [];
  const per = 4;
  const count = score.measures.length;
  for (let c = 0; c < count; c += per) {
    score.voices.forEach((v, vi) => {
      let line = `[V:${v.id}]`;
      for (let i = c; i < Math.min(count, c + per); i++) line += ` ${barText[vi]![i]} ${i === count - 1 ? '|]' : '|'}`;
      body.push(line);
      if (v.melody)
        for (let k = 0; k < verses; k++) {
          const ws: string[] = [];
          for (let i = c; i < Math.min(count, c + per); i++) ws.push(...(barWords[vi]![i]?.[k] ?? []));
          // A line where this verse has no words at all is left out (the skips would say nothing).
          if (ws.some((w) => w !== '*' && w !== '_')) body.push('w: ' + ws.join(' ').replace(/- /g, '-'));
        }
    });
  }
  return head.concat(body).join('\n') + '\n';
}

/* ------------------------------------------------------- a song, edited */

/** Ticks a quarter note on the editor's grid (a sixteenth is 12, a triplet eighth 16). */
export const TICKS = TPQ;

/** A song as the editor holds it: ticks from the start of the first bar (the pickup, if any). */
export interface SongSpec {
  title: string;
  /** Header lines kept as written (C:, %%licence, %%source, %%voice, %%language, %%vowel…). */
  head: string[];
  meter: { num: number; den: number };
  /** The pickup bar's length in ticks (0: none). */
  pickup: number;
  tempo: number;
  fifths: number;
  mode: 'major' | 'minor';
  verses: number;
  voiceName: string;
  melody: { t: number; d: number; midi: number; syl: string[]; join: boolean[]; breath: boolean; stacc: boolean; spoken: boolean; free: boolean }[];
  chords: { t: number; name: string }[];
  parts: { name: string; notes: { t: number; d: number; midi: number }[] }[];
}

/** A bar's length in ticks. */
export function barTicks(meter: { num: number; den: number }): number {
  return Math.round(meter.num * (4 / meter.den) * TPQ);
}

/**
 * The notation of an edited song: bars from the metre and the pickup, notes
 * tied over bar lines, triplet lengths written as triplets, rests between,
 * the chords on the melody, the words of every verse, the header kept.
 */
export function writeSong(spec: SongSpec): string {
  const barT = barTicks(spec.meter);
  const label = `${spec.meter.num}/${spec.meter.den}`;
  const end = Math.max(spec.pickup + barT, ...spec.melody.map((n) => n.t + n.d), ...spec.chords.map((c) => c.t + 1), ...spec.parts.flatMap((p) => p.notes.map((n) => n.t + n.d)));
  const measures: MeasureInfo[] = [];
  const info = (start: number, len: number): MeasureInfo => ({ start, len, meterLen: barT, label, fifths: spec.fifths, mode: spec.mode, meterChange: false, keyChange: false });
  if (spec.pickup > 0) measures.push(info(0, spec.pickup));
  for (let t = spec.pickup; t < end; t += barT) measures.push(info(t, barT));
  const find = (x: number): number => {
    for (let i = measures.length - 1; i >= 0; i--) if (measures[i]!.start <= x) return i;
    return 0;
  };
  const place = (notes: { t: number; d: number; midi: number; syl?: string[]; join?: boolean[]; breath?: boolean; stacc?: boolean; spoken?: boolean; free?: boolean }[]): Item[][] => {
    const items: Item[][] = measures.map(() => []);
    // Notes struck together for as long make one chord (an accompaniment's).
    const groups: (typeof notes[number] & { midis: number[] })[] = [];
    for (const n of notes.slice().sort((a, b) => a.t - b.t || a.midi - b.midi)) {
      const g = groups[groups.length - 1];
      if (g !== undefined && g.t === n.t && g.d === n.d) g.midis.push(n.midi);
      else groups.push({ ...n, midis: [n.midi] });
    }
    for (const n of groups) {
      let at = n.t;
      let left = Math.max(1, n.d);
      let first = true;
      while (left > 0) {
        const mi = find(at);
        const ms = measures[mi]!;
        const piece = Math.min(left, ms.start + ms.len - at);
        if (piece <= 0) break;
        items[mi]!.push({
          ...blank(),
          t: at - ms.start,
          dur: piece,
          rest: false,
          ps: n.midis.map((m) => spellMidi(m, spec.fifths)),
          tie: left > piece,
          cont: !first,
          // A length no plain note has (a third of a beat) is a triplet.
          tm: piece % 3 !== 0 ? [3, 2] : null,
          stacc: n.stacc === true && left === piece,
          syl: first ? (n.syl ?? []) : [],
          join: first ? (n.join ?? []) : [],
          breath: first && n.breath === true,
          spoken: n.spoken === true,
          free: n.free === true,
        });
        first = false;
        at += piece;
        left -= piece;
      }
    }
    // A gap no plain rest can fill (inside a triplet) is a triplet rest.
    items.forEach((list, mi) => {
      const sorted = list.slice().sort((a, b) => a.t - b.t);
      let cur = 0;
      const rests: Item[] = [];
      for (const it of [...sorted, { t: measures[mi]!.len } as Item]) {
        const gap = it.t - cur;
        if (gap > 0 && gap % 3 !== 0) rests.push({ ...blank(), t: cur, dur: gap, tm: [3, 2] });
        cur = Math.max(cur, it.t + (it.dur ?? 0));
      }
      list.push(...rests);
    });
    return items;
  };
  const score: Score = {
    title: spec.title,
    composer: '',
    tempo: Math.max(20, Math.min(300, spec.tempo)),
    measures,
    voices: [
      { id: 'S', name: spec.voiceName || 'Voice', clef: clefFor(spec.melody.map((n) => n.midi)), melody: true, primary: true, measures: place(spec.melody) },
      ...spec.parts.map((p, i): Voice => ({ id: `P${i + 1}`, name: p.name, clef: clefFor(p.notes.map((n) => n.midi)), melody: false, primary: true, measures: place(p.notes) })),
    ],
    verses: spec.verses,
    marks: spec.chords.filter((c) => c.t >= 0 && c.name.trim() !== '').map((c) => ({ at: c.t, name: c.name.trim() })),
  };
  applyMarks(score);
  return writeAbc(score, spec.head);
}

/* ------------------------------------------------------- UltraStar out */

/**
 * A song as an UltraStar file: the sung notes on a sixteenth grid at the
 * song's tempo (pitch 0 = C4), one verse's syllables (a held note is "~"),
 * a line break at the end of each phrase, freestyle and rap notes marked.
 */
export function toUltraStar(model: Model, title: string, artist: string, verse = 0): string {
  const mel = model.melody ?? [];
  const words = model.lyrics?.[verse] ?? [];
  const ends = new Set((model.phrases ?? []).map((p) => p[1]));
  const out = [`#TITLE:${title}`, `#ARTIST:${artist || 'Unknown'}`, `#LANGUAGE:${model.meta?.language ?? ''}`, `#BPM:${Math.round(model.tempo * 100) / 100}`, '#GAP:0'];
  mel.forEach((n, i) => {
    const start = Math.round(n[0] * 4);
    const len = Math.max(1, Math.round(n[1] * 4));
    const type = (n[4] & 2) !== 0 ? 'F' : (n[4] & 1) !== 0 ? 'R' : ':';
    const w = words[i] ?? '';
    const txt = w === '' || w === '_' ? '~' : w.endsWith('-') ? w.slice(0, -1) : w + ' ';
    out.push(`${type} ${start} ${len} ${n[2] - 60} ${txt}`);
    if (ends.has(i) && i < mel.length - 1) out.push(`- ${Math.round((n[0] + n[1]) * 4)}`);
  });
  out.push('E');
  return out.join('\n') + '\n';
}

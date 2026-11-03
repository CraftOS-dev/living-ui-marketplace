/**
 * A song from a recording, on the page side: the analysis runs in a worker
 * (a song with music is first split into its voice and its music by
 * stems.worker.ts, a voice memo goes straight to transcribe.worker.ts);
 * here its notes and chords (in seconds) are put on a beat grid the person
 * can correct (metre, twice or half as fast, bar 1 a beat earlier or
 * later), words they paste without timing are split into syllables and laid
 * under the notes in order (timed words: lyrics.ts), and the map the backing
 * track needs is made.
 */
import type { BackingMap, Preview } from '../lib/types.ts';
import type { TranscribeResult } from './analysis.ts';
import type { GridNote } from './musicxml.ts';
import type { StemsDone, StemsOut, StemsRequest } from './stems.worker.ts';

export type { BackingMap, StemsDone, TranscribeResult };

export interface GridChoice {
  meter: 3 | 4;
  /** 1 as found, 2 twice as fast (the beat was a half), 0.5 half as fast. */
  speed: 1 | 2 | 0.5;
  /** Beats bar 1 moves (negative: earlier). */
  shift: number;
}

export interface Gridded {
  notes: GridNote[];
  chords: { q: number; name: string }[];
  beats: number[];
  downbeat: number;
  bpm: number;
  meter: 3 | 4;
}


/** Run the analysis on decoded audio, reporting progress. */
export function transcribe(buffer: AudioBuffer, mode: 'voice' | 'mix', onProgress: (p: number, stage: string) => void): Promise<TranscribeResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
    worker.onmessage = (ev: MessageEvent<{ type: 'progress'; p: number; stage: string } | { type: 'done'; result: TranscribeResult } | { type: 'error'; message: string }>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.p, m.stage);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m.result);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || 'The recording could not be analysed.'));
    };
    worker.postMessage({ channels, rate: buffer.sampleRate, mode }, channels.map((c) => c.buffer));
  });
}

/**
 * A song with music: decoded again at 44.1 kHz (the separator's rate),
 * split into its voice and its music, each listened to, and (when asked)
 * its words heard. cancel() stops it.
 */
export function separateAndListen(file: Blob, words: boolean, language: string, onProgress: (p: number, stage: string) => void): { done: Promise<StemsDone>; cancel: () => void } {
  let worker: Worker | null = null;
  let cancelled = false;
  const done = (async (): Promise<StemsDone> => {
    const data = await file.arrayBuffer();
    const buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
    if (cancelled) throw new Error('Stopped.');
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c).slice());
    return new Promise<StemsDone>((resolve, reject) => {
      const w = new Worker(new URL('./stems.worker.ts', import.meta.url), { type: 'module' });
      worker = w;
      w.onmessage = (ev: MessageEvent<StemsOut>) => {
        const m = ev.data;
        if (m.type === 'progress') onProgress(m.p, m.stage);
        else {
          w.terminate();
          worker = null;
          if (m.type === 'done') resolve(m.out);
          else reject(new Error(m.message));
        }
      };
      w.onerror = (ev) => {
        w.terminate();
        worker = null;
        reject(new Error(ev.message || 'The recording could not be separated.'));
      };
      const req: StemsRequest = { channels, words, language };
      w.postMessage(req, channels.map((c) => c.buffer));
    });
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      (worker as Worker | null)?.terminate();
      worker = null;
    },
  };
}

export function defaultChoice(r: TranscribeResult): GridChoice {
  // A beat found faster than 170 a minute is an eighth note: count quarters.
  return { meter: r.meter, speed: r.bpm > 170 ? 0.5 : 1, shift: 0 };
}

/** The beats and bar 1 under a choice. */
function beatsFor(r: TranscribeResult, c: GridChoice): { beats: number[]; downbeat: number; bpm: number } {
  let beats = r.beats.slice();
  let down = r.downbeat;
  let bpm = r.bpm;
  if (c.speed === 0.5) {
    const ph = down % 2;
    beats = beats.filter((_, i) => i % 2 === ph);
    down = (down - ph) / 2;
    bpm /= 2;
  } else if (c.speed === 2) {
    const more: number[] = [];
    beats.forEach((b, i) => {
      more.push(b);
      const nx = beats[i + 1];
      if (nx !== undefined) more.push((b + nx) / 2);
    });
    beats = more;
    down *= 2;
    bpm *= 2;
  }
  down = Math.max(0, Math.min(beats.length - 1, down + c.shift));
  return { beats, downbeat: down, bpm };
}

/** Seconds → fractional beat index (straight lines beyond the ends). */
function beatOf(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  if (t <= beats[0]!) return (t - beats[0]!) / (beats[1]! - beats[0]!);
  let lo = 0;
  let hi = n - 1;
  if (t >= beats[hi]!) return hi + (t - beats[hi]!) / (beats[hi]! - beats[hi - 1]!);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]!) / (beats[hi]! - beats[lo]!);
}

/** Seconds → quarter notes from bar 1 under a choice (not rounded). */
export function quarterOf(r: TranscribeResult, c: GridChoice): (t: number) => number {
  const { beats, downbeat } = beatsFor(r, c);
  return (t: number) => beatOf(beats, t) - downbeat;
}

/** Notes and chords on the chosen grid, in quarter notes from bar 1, rounded to sixteenths. */
export function gridOf(r: TranscribeResult, c: GridChoice): Gridded {
  const { beats, downbeat, bpm } = beatsFor(r, c);
  const q = (t: number): number => Math.round((beatOf(beats, t) - downbeat) * 4) / 4;
  const notes: GridNote[] = [];
  for (const n of r.notes) {
    const qs = q(n.t);
    let qe = q(n.e);
    if (qe <= qs) qe = qs + 0.25;
    const prev = notes[notes.length - 1];
    if (prev !== undefined && prev.q === qs) {
      if (qe - qs > prev.d) {
        prev.d = qe - qs;
        prev.midi = n.midi;
      }
      continue;
    }
    if (prev !== undefined && prev.q + prev.d > qs) prev.d = Math.max(0.25, qs - prev.q);
    // Legato: a sixteenth's gap after a longer note is the consonant, not a rest.
    if (prev !== undefined && qs - (prev.q + prev.d) > 0 && qs - (prev.q + prev.d) <= 0.25 && prev.d >= 0.75) prev.d = qs - prev.q;
    notes.push({ q: qs, d: qe - qs, midi: n.midi });
  }
  const chords: { q: number; name: string }[] = [];
  for (const ch of r.chords) {
    const cq = q(ch.t);
    const last = chords[chords.length - 1];
    if (last !== undefined && last.q === cq) last.name = ch.name;
    else if (last === undefined || last.name !== ch.name) chords.push({ q: cq, name: ch.name });
  }
  return { notes, chords, beats, downbeat, bpm: Math.round(bpm * 10) / 10, meter: c.meter };
}

/** The map the backing track needs: the beats, bar 1, where bar 1 is in the song. */
export function backingMap(r: TranscribeResult, g: Gridded, bar1Q: number, channels: number, source: 'mix' | 'voice'): BackingMap {
  return { bpm: g.bpm, beats: g.beats.map((b) => Math.round(b * 10000) / 10000), downbeat: g.downbeat, beat_q: 1, bar1_q: bar1Q, duration: Math.round(r.duration * 1000) / 1000, channels, source };
}

/** A tile contour of the notes found. */
export function previewOf(g: Gridded): Preview {
  const ns = g.notes;
  if (ns.length === 0) return { lo: 60, hi: 72, n: [] };
  const a = ns[0]!.q;
  const b = Math.max(...ns.map((n) => n.q + n.d));
  const span = Math.max(1, b - a);
  return { lo: Math.min(...ns.map((n) => n.midi)), hi: Math.max(...ns.map((n) => n.midi)), n: ns.map((n) => [(n.q - a) / span, n.d / span, n.midi] as [number, number, number]) };
}

/* ------------------------------------------------------------ words */

const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœ]/i;
const DIGRAPH = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu']);

/** One word split into syllables (by the vowel groups; hyphens the person wrote are kept). */
export function splitWord(word: string): string[] {
  if (word.includes('-')) return word.split('-').filter((x) => x !== '');
  const lower = word.toLowerCase();
  const isV = (i: number): boolean => {
    const ch = lower[i] ?? '';
    if (!VOWEL.test(ch)) return false;
    // A y before a vowel (at the start or after a vowel) is a consonant.
    if (ch === 'y' && (i === 0 || VOWEL.test(lower[i + 1] ?? ''))) return false;
    return true;
  };
  const groups: [number, number][] = [];
  for (let i = 0; i < lower.length; i++) {
    if (!isV(i)) continue;
    const start = i;
    while (i + 1 < lower.length && isV(i + 1)) i++;
    groups.push([start, i]);
  }
  const letters = lower.replace(/[^a-zà-ÿœ]/gi, '');
  // A silent final e ("love", "time"), and -ed after anything but t or d ("loved").
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]!;
    const end = letters.length;
    const silentE = /[^aeiouy]e[s]?$/i.test(letters) && !/[^aeiouy]le$/i.test(letters) && last[0] === last[1] && lower[last[0]] === 'e' && last[0] >= lower.replace(/[^a-zà-ÿœ]+$/i, '').length - 2;
    const silentEd = /[^aeiouytd]ed$/i.test(letters) && lower[last[0]] === 'e' && last[0] === last[1];
    if ((silentE || silentEd) && end > 2) groups.pop();
  }
  if (groups.length <= 1) return [word];
  const cuts: number[] = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const a = groups[g]![1] + 1;
    const b = groups[g + 1]![0];
    const cluster = lower.slice(a, b);
    let cut: number;
    const finalLe = g === groups.length - 2 && /[^aeiouy]le[s]?$/i.test(letters) && cluster.endsWith('l');
    if (finalLe && cluster.length === 2) cut = a;
    else if (cluster.length <= 1) cut = a;
    else if (DIGRAPH.has(cluster.slice(0, 2)) && cluster.length === 2) cut = cluster === 'ck' || cluster === 'ng' ? b : a;
    else cut = a + 1;
    cuts.push(cut);
  }
  const out: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev && c < word.length) {
      out.push(word.slice(prev, c));
      prev = c;
    }
  }
  out.push(word.slice(prev));
  return out.filter((x) => x !== '');
}

interface Syl {
  s: string;
  join: boolean;
  line: number;
}

function syllables(words: string): Syl[] {
  const out: Syl[] = [];
  words
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .forEach((line, li) => {
      for (const w of line.split(/\s+/)) {
        const parts = splitWord(w);
        parts.forEach((p, i) => out.push({ s: p, join: i < parts.length - 1, line: li }));
      }
    });
  return out;
}

/** Phrases of the melody: a new one after a rest of a beat or more. */
function phrases(notes: GridNote[]): number[][] {
  const out: number[][] = [];
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    if (prev === undefined || n.q - (prev.q + prev.d) >= 1) out.push([]);
    out[out.length - 1]!.push(i);
  });
  return out;
}

/**
 * Lay the words under the notes: line by line when the lines match the
 * melody's phrases, else in order. When there are more notes than
 * syllables, the extra notes hold the syllable before them (a melisma),
 * chosen where the voice moves by a step in quick succession; when there are
 * more syllables than notes, the last ones share a note.
 */
export function layWords(notes: GridNote[], words: string): { notes: GridNote[]; syllables: number; unplaced: number } {
  const syls = syllables(words);
  const out = notes.map((n) => ({ ...n, syl: undefined as string | undefined, join: undefined as boolean | undefined }));
  if (syls.length === 0) return { notes: out, syllables: 0, unplaced: 0 };
  const ph = phrases(notes);
  const lines = Math.max(...syls.map((s) => s.line)) + 1;
  const units: { notes: number[]; syls: Syl[] }[] = [];
  if (lines === ph.length && lines > 1) for (let i = 0; i < lines; i++) units.push({ notes: ph[i]!, syls: syls.filter((s) => s.line === i) });
  else units.push({ notes: notes.map((_, i) => i), syls });
  let unplaced = 0;
  for (const u of units) {
    const extra = u.notes.length - u.syls.length;
    const hold = new Set<number>();
    if (extra > 0) {
      // Melisma candidates: quick notes a step or less from the note before.
      const cand = u.notes
        .slice(1)
        .map((ni, k) => ({ ni, k: k + 1, score: Math.abs(notes[ni]!.midi - notes[u.notes[k]!]!.midi) + notes[ni]!.d * 2 }))
        .sort((a, b) => a.score - b.score);
      for (const c of cand.slice(0, extra)) hold.add(c.ni);
    }
    let si = 0;
    for (const ni of u.notes) {
      const n = out[ni]!;
      if (hold.has(ni) || si >= u.syls.length) {
        n.syl = '_';
        continue;
      }
      const sy = u.syls[si]!;
      n.syl = sy.s;
      n.join = sy.join;
      si++;
    }
    if (si < u.syls.length && u.notes.length > 0) {
      // More syllables than notes: the rest go with the last note.
      const last = out[u.notes[u.notes.length - 1]!]!;
      const rest = u.syls.slice(si);
      last.syl = [last.syl ?? '', ...rest.map((r) => r.s)].filter((x) => x !== '' && x !== '_').join(' ');
      last.join = rest[rest.length - 1]!.join;
      unplaced += rest.length;
    }
  }
  return { notes: out, syllables: syls.length, unplaced };
}

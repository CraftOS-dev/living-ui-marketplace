/**
 * Words from a recording. The listener (stems.worker.ts) returns what it
 * heard as small pieces of text with times. They are shown as lines the
 * person can correct or replace with the published lyrics; whatever text
 * they keep is matched back to the heard text character by character (edit
 * distance, katakana and hiragana, case and width folded), so each of its
 * characters gets a time (interpolated where it matched nothing). The text
 * is then cut into syllables: one per character in Japanese, Chinese and
 * Korean (small kana and the long-vowel mark stay with the one before), the
 * vowel groups of words in letters. Each syllable goes on a note by dynamic
 * programming: in order, each note at most one new syllable, near its own
 * time; a note left over holds the syllable before it (a melisma).
 */
import type { GridNote } from './musicxml.ts';
import { splitWord } from './recording.ts';

/** A piece of what was heard, in seconds. */
export interface Heard {
  t: number;
  e: number;
  text: string;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}々〆ヵヶ]/u;
// Small kana, the sokuon and the long-vowel mark belong to the syllable before.
const ATTACH = /[ぁぃぅぇぉゃゅょゎっゕゖァィゥェォャュョヮッヵヶー〜]/u;
const LETTER = /[\p{L}\p{N}]/u;

/** The heard words as lines: a new line after a pause of 0.6 s, or a long run. */
export function heardLines(pieces: Heard[]): string {
  const lines: string[] = [];
  let cur = '';
  let lastE = -Infinity;
  for (const p of pieces) {
    const text = p.text.replace(/\s+/g, ' ');
    if (text.trim() === '') continue;
    const long = [...cur].length >= (CJK.test(cur) ? 24 : 48);
    if (cur !== '' && (p.t - lastE >= 0.6 || (long && /^\s/.test(text)) || [...cur].length >= 64)) {
      lines.push(cur.trim());
      cur = '';
    }
    cur += text;
    lastE = p.e;
  }
  if (cur.trim() !== '') lines.push(cur.trim());
  return lines.join('\n');
}

/** Fold a character for matching: width and case, katakana as hiragana. */
function fold(ch: string): string {
  const c = ch.normalize('NFKC').toLowerCase();
  const code = c.codePointAt(0) ?? 0;
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
}

interface TimedChar {
  ch: string;
  t: number;
}

/** Every letter of the heard text with its time (spread across its piece). */
function timedChars(pieces: Heard[]): TimedChar[] {
  const out: TimedChar[] = [];
  for (const p of pieces) {
    const chars = [...p.text].filter((c) => LETTER.test(c));
    chars.forEach((c, i) => out.push({ ch: fold(c), t: p.t + ((p.e - p.t) * i) / Math.max(1, chars.length) }));
  }
  return out;
}

/**
 * The time of every character of `text` (NaN for spaces and punctuation),
 * by matching it to what was heard.
 */
export function timeText(text: string, pieces: Heard[]): number[] {
  const chars = [...text];
  const heard = timedChars(pieces);
  const idx: number[] = [];
  chars.forEach((c, i) => LETTER.test(c) && idx.push(i));
  const times = new Array<number>(chars.length).fill(NaN);
  if (heard.length === 0 || idx.length === 0) return times;
  const a = idx.map((i) => fold(chars[i]!));
  const n = a.length;
  const m = heard.length;
  // Edit distance with a full table (texts of a song are a few thousand characters at most).
  const W = m + 1;
  const d = new Int32Array((n + 1) * W);
  for (let i = 0; i <= n; i++) d[i * W] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const sub = d[(i - 1) * W + j - 1]! + (a[i - 1] === heard[j - 1]!.ch ? 0 : 1);
      d[i * W + j] = Math.min(sub, d[(i - 1) * W + j]! + 1, d[i * W + j - 1]! + 1);
    }
  const got = new Array<number>(n).fill(NaN);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const here = d[i * W + j]!;
    if (here === d[(i - 1) * W + j - 1]! + (a[i - 1] === heard[j - 1]!.ch ? 0 : 1)) {
      got[i - 1] = heard[j - 1]!.t;
      i--;
      j--;
    } else if (here === d[(i - 1) * W + j]! + 1) i--;
    else j--;
  }
  // Characters that matched nothing: between their neighbours' times.
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(got[i]!)) continue;
    let lo = i - 1;
    while (lo >= 0 && Number.isNaN(got[lo]!)) lo--;
    let hi = i + 1;
    while (hi < n && Number.isNaN(got[hi]!)) hi++;
    const tl = lo >= 0 ? got[lo]! : hi < n ? got[hi]! - 0.3 * (hi - i) : 0;
    const th = hi < n ? got[hi]! : tl + 0.3 * (i - lo);
    got[i] = lo >= 0 && hi < n ? tl + ((th - tl) * (i - lo)) / (hi - lo) : lo >= 0 ? tl + 0.3 * (i - lo) : th;
  }
  idx.forEach((ci, k) => (times[ci] = got[k]!));
  return times;
}

export interface TimedSyl {
  s: string;
  join: boolean;
  line: number;
  /** Seconds (NaN when unknown). */
  t: number;
}

/** The syllables of a text, each with the time of its first character. */
export function syllablesOf(text: string, times: number[]): TimedSyl[] {
  const chars = [...text];
  const out: TimedSyl[] = [];
  let line = 0;
  let word: { s: string; t: number[] } | null = null;
  const flushWord = (): void => {
    if (word === null) return;
    const parts = splitWord(word.s);
    let at = 0;
    const w = word;
    parts.forEach((p, i) => {
      out.push({ s: p, join: i < parts.length - 1, line, t: w.t[at] ?? NaN });
      at += [...p].length;
    });
    word = null;
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === '\n') {
      flushWord();
      if (out.length > 0 && out[out.length - 1]!.line === line) line++;
      continue;
    }
    // (The long-vowel mark ー is of no script of its own, so it is looked for before the scripts.)
    if (ATTACH.test(c) || CJK.test(c)) {
      flushWord();
      const prev = out[out.length - 1];
      if (ATTACH.test(c) && prev !== undefined && prev.line === line) prev.s += c;
      else out.push({ s: c, join: false, line, t: times[i] ?? NaN });
      continue;
    }
    if (LETTER.test(c) || (c === "'" && word !== null)) {
      if (word === null) word = { s: '', t: [] };
      word.s += c;
      word.t.push(times[i] ?? NaN);
      continue;
    }
    // Space or punctuation: ends a word; punctuation stays with the syllable before.
    flushWord();
    const prev = out[out.length - 1];
    if (!/\s/.test(c) && prev !== undefined && prev.line === line && !/[-_*~|\\]/.test(c)) prev.s += c;
  }
  flushWord();
  return out;
}

export interface Laid {
  notes: GridNote[];
  syllables: number;
  unplaced: number;
}

/**
 * Lay timed syllables on the notes (quarter notes from bar 1; `toQ` turns
 * seconds into the same). Syllables without a time are spread between the
 * ones around them.
 */
export function layTimed(notes: GridNote[], syls: TimedSyl[], toQ: (t: number) => number): Laid {
  const out: GridNote[] = notes.map((n) => ({ ...n, syl: undefined, join: undefined }));
  const S = syls.length;
  const Nn = notes.length;
  if (S === 0 || Nn === 0) return { notes: out, syllables: S, unplaced: S };
  // Syllable times in quarter notes, gaps filled.
  const q = syls.map((s) => (Number.isFinite(s.t) ? toQ(s.t) : NaN));
  for (let i = 0; i < S; i++) {
    if (!Number.isNaN(q[i]!)) continue;
    let lo = i - 1;
    while (lo >= 0 && Number.isNaN(q[lo]!)) lo--;
    let hi = i + 1;
    while (hi < S && Number.isNaN(q[hi]!)) hi++;
    q[i] = lo >= 0 && hi < S ? q[lo]! + ((q[hi]! - q[lo]!) * (i - lo)) / (hi - lo) : lo >= 0 ? q[lo]! + 0.5 * (i - lo) : hi < S ? q[hi]! - 0.5 * (hi - i) : notes[0]!.q;
  }
  // cost[i][j]: syllables 0..i laid, syllable i on note j. A note may take a second syllable (dear),
  // notes between two syllables hold the first (cheap), each syllable wants its own time.
  const INF = 1e18;
  const HOLD = 0.04;
  const SHARE = 1.5;
  // A syllable belongs to the note being sung when it was heard (the word starts at that note,
  // not at the next one); a note starting just after the time is a near second, others cost by distance.
  const near = (i: number, j: number): number => {
    const n = notes[j]!;
    const d = q[i]! - n.q;
    if (d >= 0 && d <= n.d + 0.1) return 0.02 * (d / Math.max(0.25, n.d));
    if (d < 0 && d >= -0.15) return 0.25 * (-d / 0.15);
    return Math.min(3, d < 0 ? 0.25 + 1.2 * (-d - 0.15) : 0.3 + 0.8 * (d - n.d - 0.1));
  };
  const cost = new Float64Array(S * Nn).fill(INF);
  const from = new Int32Array(S * Nn).fill(-1);
  for (let j = 0; j < Nn; j++) cost[j] = near(0, j) + 0.01 * j;
  for (let i = 1; i < S; i++) {
    // best over j' < j of cost[i-1][j'] + HOLD·(j - j' - 1), carried along j.
    let run = INF;
    let runJ = -1;
    for (let j = 0; j < Nn; j++) {
      if (j > 0) {
        const c = cost[(i - 1) * Nn + j - 1]!;
        if (run + HOLD < c) run += HOLD;
        else {
          run = c;
          runJ = j - 1;
        }
      }
      const share = cost[(i - 1) * Nn + j]! + SHARE;
      const base = near(i, j);
      if (run <= share) {
        cost[i * Nn + j] = run + base;
        from[i * Nn + j] = runJ;
      } else {
        cost[i * Nn + j] = share + base;
        from[i * Nn + j] = j;
      }
    }
  }
  let j = 0;
  for (let k = 1; k < Nn; k++) if (cost[(S - 1) * Nn + k]! < cost[(S - 1) * Nn + j]!) j = k;
  const at = new Array<number>(S);
  for (let i = S - 1; i >= 0; i--) {
    at[i] = j;
    j = i > 0 ? from[i * Nn + j]! : j;
  }
  let unplaced = 0;
  for (let i = 0; i < S; i++) {
    const n = out[at[i]!]!;
    const sy = syls[i]!;
    if (n.syl !== undefined) {
      // Two syllables on one note: sung together.
      n.syl = `${n.syl}${CJK.test(sy.s) ? '' : ' '}${sy.s}`;
      unplaced++;
    } else n.syl = sy.s;
    n.join = sy.join;
  }
  return { notes: out, syllables: S, unplaced };
}

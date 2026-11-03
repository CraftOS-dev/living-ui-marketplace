/**
 * The shape of a lesson. A lesson is a short run of steps: explanations
 * with pictures (a staff, the keys, an engraved example you can hear) and
 * tasks the learner does (play these keys, pick the answer, name what you
 * hear, a short drill, an exercise in the practice screen).
 *
 * Notes are written as names with an octave: 'C4' is middle C, 'F#3',
 * 'Bb5', 'E##4'. Lesson keys and titles live in the server's curriculum
 * (pb_hooks/lib_curriculum.js); the content lives here.
 */
import type { Spec } from '../music/generate.ts';

/** Something to hear: one entry per beat; an array is a chord. */
export interface Sound {
  seq: (string | string[])[];
  /** Beats per minute (default 80). */
  bpm?: number;
  /** Let each entry ring for this many beats (default 1). */
  hold?: number;
}

export interface StaffItem {
  notes: string[];
  /** 'w' (default), 'h', 'q', '8', '16'; add 'd' for dotted ('hd', 'qd'). */
  dur?: string;
  /** Text above: a chord symbol, a Roman numeral, an interval, a finger. */
  label?: string;
  /** Mark this item: 'rh' blue, 'lh' teal, 'bad' red. */
  tone?: 'rh' | 'lh' | 'bad';
}

export interface StaffPic {
  clef: 'treble' | 'bass' | 'grand';
  /** Key signature as a count of sharps (+) or flats (-). */
  fifths?: number;
  time?: string;
  items: StaffItem[];
}

export interface KeysPic {
  /** The range shown, whole keys (default C3 to B5 or what the marks need). */
  from?: string;
  to?: string;
  marks: { note: string; label?: string; tone?: 'rh' | 'lh' | 'bad' | 'ink' }[];
  /** Write every white key's name. */
  names?: boolean;
}

export type Step =
  /** Explanation. A small Markdown: paragraphs, **bold**, *italic*, lists ("- ", "1. "). */
  | { t: 'text'; md: string }
  /** A highlighted rule of thumb or warning. */
  | { t: 'tip'; md: string }
  /** A picture on the staff; with `sound`, a play button hears it. */
  | { t: 'staff'; staff: StaffPic; sound?: Sound; caption?: string }
  /** A picture on the keys; with `sound`, a play button hears it. */
  | { t: 'keys'; keys: KeysPic; sound?: Sound; caption?: string }
  /** An engraved example in ABC notation, playable; `practice` offers it in the practice screen. */
  | { t: 'score'; abc: string; caption?: string; practice?: boolean }
  /**
   * The learner plays on the keys (screen, computer keys, MIDI or mic).
   *   order  these notes, in this order
   *   set    each of these notes, any order
   *   any    any one of these notes
   *   chord  all of these held together
   * `octave`: the same letter in any octave counts.
   */
  | { t: 'play'; prompt: string; notes: string[]; mode: 'order' | 'set' | 'any' | 'chord'; octave?: boolean; keys?: Omit<KeysPic, 'marks'> & { marks?: KeysPic['marks'] }; staff?: StaffPic; hint?: boolean }
  /** A question with one right answer, with a staff, keys or a sound to look at or hear. */
  | { t: 'choose'; prompt: string; options: string[]; answer: number; staff?: StaffPic; keys?: KeysPic; sound?: Sound; explain?: string }
  /** A short drill from the trainers, inside the lesson. */
  | { t: 'drill'; skill: string; items: number }
  /** An exercise played in the practice screen (scales, chords, rhythm, sight-reading). */
  | { t: 'exercise'; spec: Spec; label: string };

export interface Lesson {
  key: string;
  steps: Step[];
}

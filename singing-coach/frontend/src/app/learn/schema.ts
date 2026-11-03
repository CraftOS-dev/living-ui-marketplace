/**
 * The shape of a lesson. A lesson is a short run of steps: explanations with
 * pictures (a figure, a staff, an engraved example with words you can hear)
 * and tasks the learner does (sing these notes, hold a note, speak a rhythm,
 * breathe with the guide, pick the answer, check yourself, a short drill, a
 * vocalise in the practice screen).
 *
 * Notes are written as names with an octave: 'C4' is middle C, 'F#3',
 * 'Bb4'. Sung tasks are moved to fit the learner's voice (by octaves unless
 * `fit` says otherwise) and judged in any octave unless `exact` is set.
 * Lesson keys and titles live in the server's curriculum
 * (pb_hooks/lib_curriculum.js); the content lives here.
 */
import type { Spec } from '../music/spec.ts';

/** Something to hear: one entry per beat; an array is a chord (piano). */
export interface Sound {
  seq: (string | string[])[];
  /** Beats per minute (default 80). */
  bpm?: number;
  /** Let each entry ring for this many beats (default 1). */
  hold?: number;
  /** Who sings it: the guide voice (default for single notes) or the piano (default for chords). */
  with?: 'voice' | 'piano';
  /** The guide voice's vowel (default 'oo'). */
  vowel?: 'oo' | 'ah' | 'ee' | 'eh' | 'oh';
}

export interface StaffItem {
  notes: string[];
  /** 'w' (default), 'h', 'q', '8', '16'; add 'd' for dotted ('hd', 'qd'); 'qr' etc. for a rest. */
  dur?: string;
  /** Text above: a chord symbol, an interval, a mark. */
  label?: string;
  /** Text below: a syllable, a solfège name, a word. */
  lyric?: string;
  /** Mark this item: 'voice' (the singer's colour), 'bad' (red), 'ink'. */
  tone?: 'voice' | 'bad' | 'ink';
}

export interface StaffPic {
  /** 'auto' (default) uses the learner's clef: treble, treble with an 8 below, or bass. */
  clef?: 'auto' | 'treble' | 'treble8' | 'bass';
  /** Key signature as a count of sharps (+) or flats (-). */
  fifths?: number;
  time?: string;
  items: StaffItem[];
}

/** In-house diagrams (learn/figures.tsx). */
export type FigureKey =
  | 'source-filter'
  | 'folds'
  | 'larynx'
  | 'breath-cycle'
  | 'posture'
  | 'resonators'
  | 'harmonics'
  | 'formants'
  | 'registers'
  | 'passaggio'
  | 'vowel-chart'
  | 'hand-signs'
  | 'cents'
  | 'vibrato'
  | 'onsets'
  | 'messa'
  | 'clefs'
  | 'dynamics'
  | 'sovt'
  | 'load';

export type Step =
  /** Explanation. A small Markdown: paragraphs, **bold**, *italic*, lists ("- ", "1. "). */
  | { t: 'text'; md: string }
  /** A highlighted rule of thumb or a caution. */
  | { t: 'tip'; md: string }
  /** An in-house diagram. */
  | { t: 'figure'; fig: FigureKey; caption?: string }
  /** A picture on the staff; with `sound`, a play button hears it. */
  | { t: 'staff'; staff: StaffPic; sound?: Sound; caption?: string }
  /** An engraved example in ABC notation (words on w: lines), sung by the guide voice; `practice` offers it in the practice screen. */
  | { t: 'score'; abc: string; caption?: string; practice?: boolean }
  /** A play button: hear a note, an interval, a chord, a pattern. */
  | { t: 'sound'; sound: Sound; label: string; caption?: string }
  /** The voice dial as a still picture: a target note and marks at cents from it (-50 flat … +50 sharp). */
  | { t: 'dial'; target: string; marks?: { cents: number; label?: string }[]; caption?: string }
  /**
   * The learner sings; the voice dial shows the pitch and judges each note.
   *   order  these notes in this order, each reached and held briefly (default)
   *   hold   each note held for `hold` seconds (default 2), steady
   *   glide  a slide from the first note to the last, covering every note between
   *   echo   the app sings the notes first, then the learner sings them back
   * `fit`: 'octave' (default) moves the task by octaves into the learner's
   * range; 'key' moves it by semitones (the pattern matters, not the names);
   * 'none' keeps it exactly. `exact`: the octave must match too.
   */
  | { t: 'sing'; prompt: string; notes: string[]; mode?: 'order' | 'hold' | 'glide' | 'echo'; hold?: number; vowel?: string; fit?: 'octave' | 'key' | 'none'; exact?: boolean }
  /**
   * A rhythm spoken on "ta" with a click: tokens 'w' 'h' 'hd' 'q' 'qd' '8' '8d' '16',
   * rests 'rw' 'rh' 'rq' 'r8', triplet eighths 't8' (three make one beat). Judged on onsets.
   */
  | { t: 'speak'; prompt: string; rhythm: string; bpm?: number; meter?: string }
  /** Guided breathing: inhale, suspend, exhale (seconds) for some cycles; `sound` is what the exhale is (a hiss is heard by the microphone). */
  | { t: 'breath'; prompt: string; inhale: number; suspend: number; exhale: number; cycles: number; sound?: 'hiss' | 'hum' | 'none' }
  /** A question with one right answer, with a staff, a figure or a sound to look at or hear. */
  | { t: 'choose'; prompt: string; options: string[]; answer: number; staff?: StaffPic; sound?: Sound; figure?: FigureKey; explain?: string }
  /** A body skill the microphone cannot hear (posture, jaw, breath): the learner checks each point. */
  | { t: 'selfcheck'; prompt: string; items: string[] }
  /** A short drill from the trainers, inside the lesson (quiz, sung and spoken skills). */
  | { t: 'drill'; skill: string; items: number }
  /** A vocalise or generated exercise sung in the practice screen. */
  | { t: 'exercise'; spec: Spec; label: string };

export interface Lesson {
  key: string;
  steps: Step[];
}

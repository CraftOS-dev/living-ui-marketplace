/**
 * What a generated exercise is: the practice screen builds its music from
 * this (see generate.ts) and encodes it in the URL (?gen=).
 *
 *   vocalise  a pattern from the catalogue (pb_hooks/lib_curriculum.js
 *             EXERCISES), sung on a vowel, moving up a semitone a repetition
 *             through the singer's comfortable range and back down
 *   sight     a sight-singing melody at a level (1-30), new every time
 *   drone     a scale sung against a drone on the tonic
 *   harmony   a two-part phrase: the app sings one part, the singer the other
 *   unacc     a folk-like tune sung unaccompanied, judged for drift
 */
export type Spec =
  | { k: 'vocalise'; ex: string; vowel?: string | undefined; tempo?: number | undefined; reps?: number | undefined; start?: string | undefined }
  | { k: 'sight'; level: number; seed?: number | undefined }
  | { k: 'drone'; minor?: boolean | undefined; seed?: number | undefined }
  | { k: 'harmony'; part: 'upper' | 'lower'; level?: number | undefined; seed?: number | undefined }
  | { k: 'unacc'; level?: number | undefined; seed?: number | undefined };

/** Vowels and syllables a pattern can be sung on. */
export const VOWELS = ['a', 'i', 'u', 'e', 'o', 'oo', 'ah', 'ee', 'eh', 'oh', 'mm', 'ng', 'brr', 'straw', 'la', 'ma', 'nay', 'ya', 'ha', 'solfege'] as const;

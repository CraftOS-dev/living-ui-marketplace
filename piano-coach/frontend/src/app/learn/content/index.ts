/** Every lesson's content by key (loaded on demand by the lesson player). */
import type { Lesson } from '../schema.ts';
import { lessons as advanced } from './advanced.ts';
import { lessons as chords } from './chords.ts';
import { lessons as creative } from './creative.ts';
import { lessons as harmony } from './harmony.ts';
import { lessons as intervals } from './intervals.ts';
import { lessons as keyboard } from './keyboard.ts';
import { lessons as musicianship } from './musicianship.ts';
import { lessons as practice } from './practice.ts';
import { lessons as reading } from './reading.ts';
import { lessons as rhythm } from './rhythm.ts';
import { lessons as scales } from './scales.ts';
import { lessons as technique } from './technique.ts';

export const CONTENT: Record<string, Lesson> = Object.fromEntries([keyboard, rhythm, reading, scales, intervals, chords, harmony, technique, musicianship, advanced, practice, creative].flat().map((l) => [l.key, l]));

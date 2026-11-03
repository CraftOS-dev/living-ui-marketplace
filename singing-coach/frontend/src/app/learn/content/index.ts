/** Every lesson's content by key (loaded on demand by the lesson player). */
import type { Lesson } from '../schema.ts';
import { lessons as breath } from './breath.ts';
import { lessons as diction } from './diction.ts';
import { lessons as expression } from './expression.ts';
import { lessons as health } from './health.ts';
import { lessons as performance } from './performance.ts';
import { lessons as pitch } from './pitch.ts';
import { lessons as reading } from './reading.ts';
import { lessons as registers } from './registers.ts';
import { lessons as rhythm } from './rhythm.ts';
import { lessons as styles } from './styles.ts';
import { lessons as theory } from './theory.ts';
import { lessons as tone } from './tone.ts';
import { lessons as voice } from './voice.ts';

export const CONTENT: Record<string, Lesson> = Object.fromEntries([voice, breath, tone, pitch, rhythm, reading, theory, registers, diction, expression, styles, performance, health].flat().map((l) => [l.key, l]));

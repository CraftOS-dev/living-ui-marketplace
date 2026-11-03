/**
 * Small sound helpers for lessons, drills and the reference: sing a note or a
 * melody with the guide voice, play a chord on the piano, or perform a parsed
 * song (the melody sung, the rest on the piano). Starting a new sound stops
 * the last one.
 */
import type { Model } from '../lib/types.ts';
import { audio } from './audio.ts';
import type { Vowel } from './audio.ts';
import { midiOf, note } from './theory.ts';

let token = 0;
let timer = 0;
const listeners = new Set<(playing: boolean) => void>();

function setPlaying(v: boolean): void {
  for (const fn of listeners) fn(v);
}

/** Hear when something starts and stops playing (for buttons). */
export function onPlaying(fn: (playing: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function stopSound(): void {
  token += 1;
  window.clearTimeout(timer);
  audio.stopAll();
  setPlaying(false);
}

export function toMidi(n: string | number): number {
  return typeof n === 'number' ? n : midiOf(note(n));
}

/**
 * Play a sequence: one entry per step (a note or a chord), `step` seconds
 * apart, each held for `hold` steps. Resolves when it ends (or is stopped).
 */
export function playSeq(seq: (string | number | (string | number)[])[], opts: { bpm?: number; hold?: number; vel?: number; roll?: number; voice?: boolean; vowel?: Vowel } = {}): Promise<void> {
  stopSound();
  const ctx = audio.ensure();
  const my = token;
  const step = 60 / (opts.bpm ?? 80);
  const hold = step * (opts.hold ?? 1) * 0.96;
  const start = ctx.currentTime + 0.06;
  // Single notes are sung by the guide voice (unless the piano is asked for); chords go to the piano.
  const sung = opts.voice !== false && seq.every((e) => !Array.isArray(e) || e.length === 1);
  if (sung) {
    const line = seq.map((entry, i) => ({ midi: toMidi(Array.isArray(entry) ? entry[0]! : entry), t: start + i * step, d: hold * (opts.hold !== undefined && opts.hold > 1 ? 1 : 0.92) }));
    audio.singLine(line, { vowel: opts.vowel ?? 'oo' });
  } else
    seq.forEach((entry, i) => {
      const list = Array.isArray(entry) ? entry : [entry];
      list.forEach((n, j) => audio.play(toMidi(n), opts.vel ?? 82, start + i * step + j * (opts.roll ?? 0), hold));
    });
  setPlaying(true);
  const total = (seq.length - 1) * step + hold;
  return new Promise((resolve) => {
    timer = window.setTimeout(() => {
      if (my === token) setPlaying(false);
      resolve();
    }, total * 1000 + 120);
  });
}

export function playChord(notes: (string | number)[], seconds = 1.6, roll = 0): Promise<void> {
  return playSeq([notes], { bpm: 60 / seconds, roll, voice: false });
}

/** Perform a parsed song at a tempo (percent of its own): the melody sung by the guide voice, the rest on the piano. */
export function playModel(model: Model, tempoPct = 100, vowel: Vowel = 'oo'): Promise<void> {
  stopSound();
  const ctx = audio.ensure();
  const my = token;
  const secPerQ = 60 / Math.max(10, (model.tempo * tempoPct) / 100);
  const start = ctx.currentTime + 0.08;
  let end = 0;
  const mv = model.melodyVoice ?? 0;
  const melody = model.melody ?? [];
  if (melody.length > 0) {
    const byPhrase = new Map<number, { midi: number; t: number; d: number; st: boolean }[]>();
    for (const n of melody) {
      if (n[4] & 1) continue;
      const g = byPhrase.get(n[5]) ?? [];
      g.push({ midi: n[2], t: start + n[0] * secPerQ, d: n[1] * secPerQ * 0.97, st: (n[4] & 8) !== 0 });
      byPhrase.set(n[5], g);
      end = Math.max(end, (n[0] + n[1]) * secPerQ);
    }
    for (const g of byPhrase.values()) audio.singLine(g, { vowel });
  }
  for (const n of model.notes) {
    if (melody.length > 0 && n[6] === mv) continue;
    const t = n[0] * secPerQ;
    const d = Math.max(0.08, n[1] * secPerQ * (n[8] === 1 ? 0.45 : 0.95));
    audio.play(n[2], Math.min(72, n[5] || 70), start + t, d);
    end = Math.max(end, t + d);
  }
  setPlaying(true);
  return new Promise((resolve) => {
    timer = window.setTimeout(() => {
      if (my === token) setPlaying(false);
      resolve();
    }, end * 1000 + 300);
  });
}

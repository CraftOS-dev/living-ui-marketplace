/**
 * Small sound helpers for lessons, drills and the reference: play a note, a
 * chord, a melody or a parsed model on the app's piano voice. Each returns
 * a stop function; starting a new sound stops the last one.
 */
import type { Model } from '../lib/types.ts';
import { audio } from './audio.ts';
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
export function playSeq(seq: (string | number | (string | number)[])[], opts: { bpm?: number; hold?: number; vel?: number; roll?: number } = {}): Promise<void> {
  stopSound();
  const ctx = audio.ensure();
  const my = token;
  const step = 60 / (opts.bpm ?? 80);
  const hold = step * (opts.hold ?? 1) * 0.96;
  const start = ctx.currentTime + 0.06;
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
  return playSeq([notes], { bpm: 60 / seconds, roll });
}

/** Play a parsed song model at a tempo (percent of its own). */
export function playModel(model: Model, tempoPct = 100): Promise<void> {
  stopSound();
  const ctx = audio.ensure();
  const my = token;
  const secPerQ = 60 / Math.max(10, (model.tempo * tempoPct) / 100);
  const start = ctx.currentTime + 0.08;
  let end = 0;
  const pedal = model.pedal ?? [];
  for (const n of model.notes) {
    const t = n[0] * secPerQ;
    // Held by the pedal until it lifts.
    let q = n[1];
    for (const [a, b] of pedal) if (a <= n[0] + n[1] + 1e-6 && b > n[0] + n[1]) q = Math.max(q, b - n[0]);
    const d = Math.max(0.08, q * secPerQ * (n[8] === 1 && q === n[1] ? 0.45 : 0.95));
    audio.play(n[2], n[5] || 80, start + t, d);
    end = Math.max(end, t + d);
  }
  setPlaying(true);
  return new Promise((resolve) => {
    timer = window.setTimeout(() => {
      if (my === token) setPlaying(false);
      resolve();
    }, end * 1000 + 200);
  });
}

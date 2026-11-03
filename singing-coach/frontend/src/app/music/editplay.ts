/**
 * Playing the song being edited, from any point: the melody on the guide
 * voice or the piano, the chords on the piano, and the recording the song
 * was made from (or its voice or its music alone). With a recording, the
 * notes keep to its own beats, so what is heard and the playhead stay with
 * the singer; without one, the written tempo. Everything is tagged, so stop
 * silences only this.
 */
import type { BackingMap } from '../lib/types.ts';
import { audio } from './audio.ts';
import type { Vowel } from './audio.ts';
import { quarterAt, secondsAt } from './backing.ts';
import { chord as chordNotes, midiOf, parseChord } from './theory.ts';
import { TICKS, barTicks } from './songdoc.ts';
import type { SongDoc } from './songdoc.ts';

export interface EditPlayOpts {
  melody: 'voice' | 'piano' | 'off';
  chords: boolean;
  /** The recording to play with (already decoded), and where the song sits in it. */
  recording: { buffer: AudioBuffer; map: BackingMap } | null;
  vowel: Vowel;
}

export interface EditPlayback {
  /** The tick heard now. */
  tick: () => number;
  /** The tick where the song (or the recording) ends. */
  end: number;
  stop: () => void;
}

const TAGS = ['ed-guide', 'ed-piano', 'ed-rec'];

export function playFrom(doc: SongDoc, from: number, end: number, opts: EditPlayOpts): EditPlayback {
  const ctx = audio.ensure();
  audio.stopTags(TAGS);
  const lead = 0.12;
  const t0 = ctx.currentTime + lead;
  const lat = audio.outputLatency();
  const rec = opts.recording;
  const secPerTick = 60 / Math.max(20, doc.tempo) / TICKS;
  // Seconds after t0 at which a tick sounds.
  const at = rec !== null ? (t: number): number => secondsAt(rec.map, t / TICKS) - secondsAt(rec.map, from / TICKS) : (t: number): number => (t - from) * secPerTick;
  const stopAt = rec !== null ? Math.min(rec.buffer.duration - secondsAt(rec.map, from / TICKS), at(end)) : at(end);
  if (rec !== null) {
    const off = secondsAt(rec.map, from / TICKS);
    audio.playBacking(rec.buffer, t0, off, Math.max(0, Math.min(rec.buffer.duration - off, stopAt)), true, 'ed-rec');
  }
  // The melody: one sung line per phrase (rests split them), or piano notes.
  const notes = doc.notes.filter((n) => n.t + n.d > from && n.t < end);
  if (opts.melody === 'voice') {
    let line: { midi: number; t: number; d: number; st?: boolean }[] = [];
    let lastEnd = -1;
    const flush = (): void => {
      if (line.length > 0) audio.singLine(line, { vowel: opts.vowel }, 'ed-guide');
      line = [];
    };
    for (const n of notes) {
      const s = Math.max(n.t, from);
      if (lastEnd >= 0 && s - lastEnd > 6) flush();
      const a = at(s);
      line.push({ midi: n.midi, t: t0 + a, d: Math.max(0.06, (at(n.t + n.d) - a) * 0.97), st: n.stacc });
      lastEnd = n.t + n.d;
    }
    flush();
  } else if (opts.melody === 'piano') for (const n of notes) {
    const s = Math.max(n.t, from);
    audio.play(n.midi, 78, t0 + at(s), Math.max(0.08, (at(n.t + n.d) - at(s)) * 0.95), 'ed-guide');
  }
  // The chords: the bass and the chord on each beat, softly.
  if (opts.chords) {
    const beat = (4 / doc.meter.den) * TICKS;
    const cs = doc.chords.slice().sort((a, b) => a.t - b.t);
    cs.forEach((c, i) => {
      const cEnd = Math.min(end, cs[i + 1]?.t ?? end);
      if (cEnd <= from) return;
      const pc = parseChord(c.name);
      if (pc === null) return;
      const ns = chordNotes(pc.root, pc.type).map((x) => midiOf(x));
      let root = ns[0] ?? 48;
      while (root >= 50) root -= 12;
      while (root < 38) root += 12;
      const bass = pc.bass !== null ? (midiOf(pc.bass) % 12) + 36 : root;
      const upper = ns.map((m) => {
        let x = m;
        while (x < 55) x += 12;
        while (x > 67) x -= 12;
        return x;
      });
      const s0 = Math.max(c.t, from);
      audio.play(bass, 62, t0 + at(s0), Math.max(0.1, at(cEnd) - at(s0)) * 0.98, 'ed-piano');
      for (let b = s0; b < cEnd - 1; b += beat) for (const u of upper) audio.play(u, b === s0 ? 46 : 38, t0 + at(b), Math.max(0.1, (at(Math.min(cEnd, b + beat)) - at(b)) * 0.9), 'ed-piano');
    });
  }
  const tick = (): number => {
    const heard = audio.now() - t0 - lat;
    if (heard <= 0) return from;
    if (rec !== null) return quarterAt(rec.map, secondsAt(rec.map, from / TICKS) + heard) * TICKS;
    return from + heard / secPerTick;
  };
  return { tick, end, stop: () => audio.stopTags(TAGS) };
}

/** A short taste of a pitch (a note drawn, moved or chosen). */
export function preview(midi: number): void {
  audio.ensure();
  audio.play(midi, 70, audio.now() + 0.01, 0.35, 'ed-preview');
}

export { barTicks };

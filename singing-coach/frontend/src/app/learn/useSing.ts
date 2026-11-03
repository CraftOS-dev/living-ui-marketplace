/**
 * Sung tasks in lessons and drills: the notes are moved into the singer's
 * range (by octaves, or by semitones when only the pattern matters), the
 * microphone listens, and each note counts when the voice reaches it (within
 * 50 cents) and stays a moment. Any octave counts unless the task is exact.
 *
 *   order  each note in turn, held 0.35 s
 *   echo   the app sings the notes first, then as order
 *   hold   each note held for `hold` seconds; steadiness (SD) is kept
 *   glide  one slide from the first note to the last that passes every
 *          semitone between them
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/context.tsx';
import { audio } from '../music/audio.ts';
import { fold } from '../music/judge.ts';
import { mic, micProblem } from '../music/mic.ts';
import type { VoiceFrame } from '../music/mic.ts';

export type SingMode = 'order' | 'hold' | 'glide' | 'echo';

export interface SingTarget {
  notes: number[];
  mode: SingMode;
  hold?: number | undefined;
  fit?: 'octave' | 'key' | 'none' | undefined;
  exact?: boolean | undefined;
  /** Seconds allowed per note before it counts as a miss (drills). */
  limit?: number | undefined;
  /** Sing the first note as a reference before listening (default true). */
  cue?: boolean | undefined;
  /** Hear the notes twice before singing (echo). */
  twice?: boolean | undefined;
}

export interface SingState {
  status: 'idle' | 'hearing' | 'listening' | 'done';
  /** The notes as the singer sings them (moved into range). */
  notes: number[];
  index: number;
  /** Notes reached (order/echo/hold) or semitones covered (glide). */
  hits: boolean[];
  /** Cents of each reached note (median while held). */
  cents: (number | null)[];
  /** ms from the start (or the previous note) to reaching each note. */
  times: (number | null)[];
  /** Steadiness of each held note (hold mode). */
  sds: (number | null)[];
  /** For hold: seconds held so far of the current note. */
  held: number;
  error: string;
}

/** Move notes into a comfortable range: by octaves (default) or semitones. */
export function fitNotes(notes: number[], fit: 'octave' | 'key' | 'none', lo: number, hi: number): number[] {
  if (fit === 'none' || notes.length === 0) return notes;
  const nlo = Math.min(...notes);
  const nhi = Math.max(...notes);
  const centre = (lo + hi) / 2;
  const mid = (nlo + nhi) / 2;
  if (fit === 'key') {
    let s = Math.round(centre - mid);
    if (nhi + s > hi) s -= nhi + s - hi;
    if (nlo + s < lo) s += lo - (nlo + s);
    return notes.map((n) => n + s);
  }
  let best = 0;
  let bestD = 1e9;
  for (let k = -3; k <= 3; k++) {
    const over = Math.max(0, nhi + 12 * k - hi) + Math.max(0, lo - (nlo + 12 * k));
    const d = over * 4 + Math.abs(mid + 12 * k - centre);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return notes.map((n) => n + 12 * best);
}

export function useSing(target: SingTarget | null, onDone?: (s: SingState) => void): { state: SingState; start: () => Promise<void>; stop: () => void; reset: () => void; hear: () => void; frames: React.RefObject<((f: VoiceFrame) => void) | null> } {
  const app = useApp();
  const v = app.state?.voice;
  const lo = v?.comf_low ?? 55;
  const hi = v?.comf_high ?? 70;
  const fitted = target === null ? [] : fitNotes(target.notes, target.fit ?? 'octave', lo, hi);
  const key = JSON.stringify([fitted, target?.mode, target?.hold]);
  const blank = (): SingState => ({ status: 'idle', notes: fitted, index: 0, hits: fitted.map(() => false), cents: fitted.map(() => null), times: fitted.map(() => null), sds: fitted.map(() => null), held: 0, error: '' });
  const [state, setState] = useState<SingState>(blank);
  const st = useRef<SingState>(state);
  const onFrame = useRef<((f: VoiceFrame) => void) | null>(null);
  const run = useRef({ since: 0, errs: [] as number[], noteStart: 0, glideLo: 99, glideHi: -99, glideVoiced: false, covered: new Set<number>(), recent: [] as number[], offAt: 0, lastVoiced: 0 });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const commit = (s: SingState): void => {
    st.current = s;
    setState(s);
  };

  useEffect(() => {
    commit(blank());
    // A new task: start over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const finish = (s: SingState): void => {
    const done = { ...s, status: 'done' as const };
    commit(done);
    doneRef.current?.(done);
  };

  const handle = useCallback(
    (f: VoiceFrame) => {
      const s = st.current;
      if (s.status !== 'listening' || target === null) return;
      const now = performance.now();
      const r = run.current;
      const mode = target.mode;
      if (mode === 'glide') {
        // One continuous voiced slide; a break starts it over.
        if (!f.voiced) {
          if (r.glideVoiced && now - r.since > 250) {
            r.covered = new Set();
            r.glideVoiced = false;
          }
          return;
        }
        r.glideVoiced = true;
        r.since = now;
        const a = Math.min(...s.notes);
        const b = Math.max(...s.notes);
        // Fold the voice into the task's octave (unless exact), then mark the semitones it passes.
        let mm = f.midi;
        if (target.exact !== true) {
          while (mm < a - 6) mm += 12;
          while (mm > b + 6) mm -= 12;
        }
        const near = Math.round(mm);
        if (near >= a && near <= b) r.covered.add(near);
        const need = b - a + 1;
        const hits = s.notes.map((n) => r.covered.has(n));
        const cov = r.covered.size / need;
        if (cov >= 0.85 && r.covered.has(a) && r.covered.has(b)) finish({ ...s, hits: s.notes.map(() => true), index: s.notes.length });
        else if (hits.some((h, i) => h !== s.hits[i])) commit({ ...s, hits, index: Math.round(cov * s.notes.length) });
        return;
      }
      const tgt = s.notes[s.index];
      if (tgt === undefined) return;
      if (target.limit !== undefined && now - r.noteStart > target.limit * 1000) {
        // Out of time: a miss, on to the next.
        const next = { ...s, index: s.index + 1, times: s.times.map((t, i) => (i === s.index ? null : t)) };
        r.noteStart = now;
        r.errs = [];
        r.since = 0;
        if (next.index >= s.notes.length) finish(next);
        else commit(next);
        return;
      }
      if (!f.voiced) {
        // A dropout of more than a quarter second ends the attempt; shorter ones are bridged.
        if (now - r.lastVoiced > 250) {
          r.since = 0;
          r.errs = [];
          r.recent = [];
        }
        return;
      }
      r.lastVoiced = now;
      const e = target.exact === true ? (f.midi - tgt) * 100 : fold(f.midi, tgt);
      const need = mode === 'hold' ? (target.hold ?? 2) : 0.35;
      // On the note: the average error over about one vibrato cycle (16 frames, ~170 ms).
      r.recent.push(e);
      if (r.recent.length > 16) r.recent.shift();
      const avg = r.recent.reduce((a2, b2) => a2 + b2, 0) / r.recent.length;
      if (Math.abs(avg) <= 50) {
        r.offAt = 0;
        if (r.since === 0) r.since = now;
        r.errs.push(e);
        const held = (now - r.since) / 1000;
        if (mode === 'hold' && Math.abs(held - s.held) > 0.1) commit({ ...s, held });
        if (held >= need) {
          const sorted = r.errs.slice().sort((x, y) => x - y);
          const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
          const mean = r.errs.reduce((a2, b2) => a2 + b2, 0) / Math.max(1, r.errs.length);
          const sd = Math.sqrt(r.errs.reduce((a2, b2) => a2 + (b2 - mean) * (b2 - mean), 0) / Math.max(1, r.errs.length));
          const i = s.index;
          const next: SingState = {
            ...s,
            index: i + 1,
            held: 0,
            hits: s.hits.map((h, k) => (k === i ? true : h)),
            cents: s.cents.map((c, k) => (k === i ? Math.round(med) : c)),
            times: s.times.map((t, k) => (k === i ? Math.round(r.since - r.noteStart) : t)),
            sds: s.sds.map((d, k) => (k === i ? Math.round(sd * 10) / 10 : d)),
          };
          r.since = 0;
          r.errs = [];
          r.recent = [];
          r.noteStart = now;
          if (next.index >= s.notes.length) finish(next);
          else commit(next);
        }
      } else {
        // Wandered off: the hold starts again once it has been off for 200 ms (a slip is forgiven).
        if (r.offAt === 0) r.offAt = now;
        if (r.since !== 0 && now - r.offAt > 200) {
          r.since = 0;
          r.errs = [];
          if (mode === 'hold' && s.held !== 0) commit({ ...s, held: 0 });
        }
      }
    },
    // The handler follows the task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  onFrame.current = handle;

  useEffect(() => {
    const off = mic.onFrame((f) => onFrame.current?.(f));
    return () => {
      off();
    };
  }, []);

  const hear = useCallback(() => {
    if (target === null) return;
    audio.ensure();
    const t = audio.now() + 0.08;
    const step = target.mode === 'hold' ? Math.min(2, target.hold ?? 2) : 0.6;
    if (target.mode === 'glide') audio.singLine(st.current.notes.map((n, i) => ({ midi: n, t: t + i * 0.18, d: 0.2 })), { vowel: 'oo' });
    else audio.singLine(st.current.notes.map((n, i) => ({ midi: n, t: t + i * step, d: step * 0.9 })), { vowel: 'oo' });
  }, [target]);

  const start = useCallback(async () => {
    if (target === null) return;
    audio.ensure();
    if (mic.status !== 'on') {
      const ms = await mic.start(app.settings?.input_device ?? '');
      if (ms !== 'on') {
        commit({ ...st.current, error: micProblem(ms) });
        return;
      }
    }
    const fresh = blank();
    run.current = { since: 0, errs: [], noteStart: performance.now(), glideLo: 99, glideHi: -99, glideVoiced: false, covered: new Set(), recent: [], offAt: 0, lastVoiced: 0 };
    if (target.mode === 'echo') {
      // Hear it first, then sing it back.
      commit({ ...fresh, status: 'hearing' });
      const t = audio.now() + 0.08;
      let end = audio.singLine(fresh.notes.map((n, i) => ({ midi: n, t: t + i * 0.62, d: 0.56 })), { vowel: 'oo' });
      if (target.twice === true) {
        const t2 = end + 0.9;
        end = audio.singLine(fresh.notes.map((n, i) => ({ midi: n, t: t2 + i * 0.62, d: 0.56 })), { vowel: 'oo' });
      }
      window.setTimeout(
        () => {
          run.current.noteStart = performance.now();
          commit({ ...st.current, status: 'listening' });
        },
        Math.max(300, (end - audio.now()) * 1000 + 450),
      );
      return;
    }
    // The first note as a reference (unless the task is to find it), then listen.
    if (target.mode !== 'glide' && target.cue !== false) audio.singNote(fresh.notes[0]!, audio.now() + 0.05, 0.7, 'oo');
    commit({ ...fresh, status: 'listening' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, app.settings?.input_device]);

  const stop = useCallback(() => {
    commit({ ...st.current, status: st.current.status === 'done' ? 'done' : 'idle' });
  }, []);

  const reset = useCallback(() => {
    commit(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, start, stop, reset, hear, frames: onFrame };
}

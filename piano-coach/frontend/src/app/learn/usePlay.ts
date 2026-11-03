/**
 * Judging what is played on the keys for a task: a note, a set of notes, a
 * melody in order, or a chord (held together on a piano; tapped one key at a
 * time on the screen). Strict tasks (drills) end at the first wrong note;
 * gentle ones (lessons) flash it and let the learner carry on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Source } from '../music/input.ts';
import type { KeyMark } from './widgets.tsx';

export interface PlayTask {
  notes: number[];
  mode: 'any' | 'set' | 'order' | 'chord';
  octave?: boolean | undefined;
  /** Chords: the lowest key must be this pitch class. */
  bass?: number | undefined;
  given?: number[] | undefined;
}

export interface PlayState {
  marks: Map<number, KeyMark>;
  onNote: (midi: number, on: boolean, src: Source) => void;
  /** 0..1 */
  progress: number;
  errors: number;
  done: boolean;
  reveal: () => void;
  reset: () => void;
}

const pc = (m: number): number => ((m % 12) + 12) % 12;

export function usePlay(task: PlayTask | null, opts: { strict: boolean; hint?: boolean | undefined; onDone: (ok: boolean, errors: number) => void }): PlayState {
  const [good, setGood] = useState<number[]>([]);
  const [bad, setBad] = useState<number[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(false);
  const errors = useRef(0);
  const idx = useRef(0);
  const held = useRef(new Set<number>());
  const toggled = useRef(new Set<number>());
  const timer = useRef(0);
  const finished = useRef(false);
  const cb = useRef(opts.onDone);
  cb.current = opts.onDone;
  const sig = task === null ? '' : JSON.stringify(task);

  const reset = useCallback(() => {
    setGood([]);
    setBad([]);
    setPicked([]);
    setShown(false);
    setDone(false);
    errors.current = 0;
    idx.current = 0;
    held.current.clear();
    toggled.current.clear();
    finished.current = false;
    window.clearTimeout(timer.current);
  }, []);
  useEffect(() => reset(), [sig, reset]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const same = (a: number, b: number): boolean => (task?.octave === true ? pc(a) === pc(b) : a === b);
  const finish = (ok: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    setDone(true);
    if (!ok) setShown(true);
    cb.current(ok, errors.current);
  };
  const flash = (m: number): void => {
    setBad((b) => [...b, m]);
    window.setTimeout(() => setBad((b) => b.filter((x) => x !== m)), 420);
  };

  const evalChord = (): void => {
    if (task === null) return;
    const notes = [...new Set([...held.current, ...toggled.current])];
    const want = [...new Set(task.notes.map(pc))].sort((a, b) => a - b);
    const have = [...new Set(notes.map(pc))].sort((a, b) => a - b);
    setPicked(notes);
    if (have.length < want.length) return;
    const bassOk = task.bass === undefined || pc(Math.min(...notes)) === task.bass;
    const exact = task.octave === true ? true : task.notes.every((n) => notes.includes(n));
    if (have.length === want.length && have.every((v, i) => v === want[i]) && bassOk && exact) {
      setGood(notes);
      finish(errors.current === 0 || !opts.strict);
      return;
    }
    errors.current += 1;
    for (const m of notes) flash(m);
    if (opts.strict) {
      finish(false);
      return;
    }
    window.setTimeout(() => {
      toggled.current.clear();
      setPicked([...held.current]);
    }, 450);
  };

  const onNote = (m: number, on: boolean, src: Source): void => {
    if (task === null || finished.current) return;
    if (task.mode === 'chord') {
      const tap = src === 'screen' || src === 'keyboard';
      if (tap) {
        if (!on) return;
        if (toggled.current.has(m)) toggled.current.delete(m);
        else toggled.current.add(m);
      } else if (on) held.current.add(m);
      else {
        held.current.delete(m);
        setPicked([...new Set([...held.current, ...toggled.current])]);
        return;
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(evalChord, tap ? 60 : 140);
      setPicked([...new Set([...held.current, ...toggled.current])]);
      return;
    }
    if (!on) return;
    if (task.mode === 'any') {
      if (task.notes.some((n) => same(n, m))) {
        setGood([m]);
        finish(errors.current === 0 || !opts.strict);
      } else {
        errors.current += 1;
        flash(m);
        if (opts.strict) finish(false);
      }
      return;
    }
    if (task.mode === 'order') {
      const want = task.notes[idx.current];
      if (want !== undefined && same(want, m)) {
        idx.current += 1;
        setGood((g) => [...g, m]);
        if (idx.current >= task.notes.length) finish(errors.current === 0 || !opts.strict);
      } else {
        errors.current += 1;
        flash(m);
        if (opts.strict) finish(false);
      }
      return;
    }
    // set: each note once, any order
    const target = task.notes.find((n) => same(n, m) && !good.some((g) => same(n, g)));
    if (target !== undefined) {
      const next = [...good, m];
      setGood(next);
      if (task.notes.every((n) => next.some((g) => same(n, g)))) finish(errors.current === 0 || !opts.strict);
    } else if (!task.notes.some((n) => same(n, m))) {
      errors.current += 1;
      flash(m);
      if (opts.strict) finish(false);
    }
  };

  const marks = useMemo(() => {
    const out = new Map<number, KeyMark>();
    if (task === null) return out;
    for (const g of task.given ?? []) out.set(g, { tone: 'ink' });
    if (opts.hint === true || shown) for (const n of task.notes) if (!out.has(n)) out.set(n, { tone: shown ? 'good' : 'rh', label: '' });
    for (const p of picked) out.set(p, { tone: 'rh' });
    good.forEach((g, i) => out.set(g, { tone: 'good', label: task.mode === 'order' && task.notes.length > 1 ? String(i + 1) : '' }));
    for (const b of bad) out.set(b, { tone: 'bad' });
    return out;
  }, [task, good, bad, picked, shown, opts.hint]);

  const progress = task === null ? 0 : task.mode === 'order' ? idx.current / task.notes.length : task.mode === 'set' ? good.length / task.notes.length : done ? 1 : 0;
  return { marks, onNote, progress, errors: errors.current, done, reveal: () => setShown(true), reset };
}

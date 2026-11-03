/**
 * What the learner does in a lesson (and in sung drills): sing notes with a
 * live Voice Dial, speak a rhythm on "ta" with a click, breathe with the
 * guide ring, or check off what the microphone cannot hear.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Ear, Mic, RotateCcw, Square, Wind } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { VoiceDial } from '../components/practice/VoiceDial.tsx';
import type { DialHandle } from '../components/practice/VoiceDial.tsx';
import { Button } from '../components/ui.tsx';
import { useApp } from '../lib/context.tsx';
import { audio } from '../music/audio.ts';
import { noteLabel } from '../music/dial.ts';
import type { DialMode } from '../music/dial.ts';
import { mic, micProblem } from '../music/mic.ts';
import { toMidi } from '../music/play.ts';
import { useSing } from './useSing.ts';
import type { SingMode, SingState } from './useSing.ts';

/** The Voice Dial, live, on a target: for tasks and drills. */
export function LiveDial({ target, next, mode = 'song', height = 124, breath }: { target: number | null; next?: number | null | undefined; mode?: DialMode; height?: number; breath?: { phase: 'inhale' | 'suspend' | 'exhale' | 'rest'; p: number } | undefined }): React.JSX.Element {
  const dial = useRef<DialHandle | null>(null);
  const tRef = useRef(target);
  tRef.current = target;
  const bRef = useRef(breath);
  bRef.current = breath;
  useEffect(() => {
    const off = mic.onFrame((f) => dial.current?.push({ at: performance.now(), voiced: f.voiced, midi: f.midi, db: f.db }));
    let raf = 0;
    const tick = (now: number): void => {
      const d = dial.current;
      if (d !== null) {
        const t = tRef.current;
        d.target(t === null ? null : { midi: t, name: noteLabel(t) }, null, false);
        const b = bRef.current;
        if (b !== undefined) d.breath(b.phase, b.p);
        d.draw(now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  void next;
  return (
    <div className="w-full rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)]">
      <VoiceDial ref={dial} height={height} hideSides mode={mode} />
    </div>
  );
}

/** A sung task: the notes, the dial, hear it, start, done. Scores 1 when right first time. */
export function SingTask({ notes, mode, hold, fit, exact, vowel, done, onResult }: { notes: string[]; mode: SingMode; hold?: number | undefined; fit?: 'octave' | 'key' | 'none' | undefined; exact?: boolean | undefined; vowel?: string | undefined; done: boolean; onResult: (v: number, s: SingState) => void }): React.JSX.Element {
  const midis = useMemo(() => notes.map(toMidi), [notes]);
  const target = useMemo(() => ({ notes: midis, mode, hold, fit, exact }), [midis, mode, hold, fit, exact]);
  const [tries, setTries] = useState(0);
  const sing = useSing(target, (s) => onResult(tries === 0 ? 1 : tries === 1 ? 0.7 : 0.5, s));
  const s = sing.state;
  const listening = s.status === 'listening';
  const cur = s.notes[Math.min(s.index, s.notes.length - 1)] ?? null;
  const ok = s.status === 'done' || (done && s.status === 'idle');
  // Stop listening when the task leaves the page (stop is stable; the hook's object is new each render).
  const stopSing = sing.stop;
  useEffect(() => () => stopSing(), [stopSing]);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {s.notes.map((n, i) => (
          <span key={i} className={cn('sc-mono sc-num inline-flex h-7 min-w-9 items-center justify-center rounded-[var(--sc-radius-sm)] border px-2 text-[12.5px] transition-colors', s.hits[i] ? 'border-[var(--sc-voice)] bg-[var(--sc-voice-soft)] text-[var(--sc-ink)]' : i === s.index && listening ? 'border-[var(--sc-ink)] text-[var(--sc-ink)]' : 'border-[var(--sc-line)] text-[var(--sc-muted)]')}>
            {mode === 'echo' && !s.hits[i] && s.status !== 'done' ? '?' : noteLabel(n)}
          </span>
        ))}
        {vowel !== undefined && vowel !== '' && <span className="ml-1 text-[12px] text-[var(--sc-muted)]">on “{vowel}”</span>}
      </div>
      <LiveDial target={s.status === 'hearing' ? null : mode === 'glide' ? null : cur} mode={mode === 'glide' ? 'free' : mode === 'hold' ? 'hold' : 'song'} />
      <div className="flex h-8 items-center gap-2">
        {mode === 'hold' && listening && <span className="sc-mono sc-num text-[12.5px] text-[var(--sc-ink-2)]">{s.held.toFixed(1)} / {hold ?? 2} s</span>}
        {s.status === 'hearing' && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--sc-ink-2)]">
            <Ear size={14} aria-hidden /> Listen…
          </span>
        )}
        {ok ? (
          <span className="sc-pop flex items-center gap-1.5 text-[13px] font-semibold text-[var(--sc-ink)]">
            <Check size={15} strokeWidth={2.6} aria-hidden className="text-[var(--sc-voice)]" /> {s.status === 'done' && s.cents.some((c) => c !== null) ? `Done · ${avgText(s.cents)}` : 'Done'}
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => (setTries((t) => t + 1), void sing.start())}>
              Again
            </Button>
          </span>
        ) : listening ? (
          <Button size="sm" icon={Square} onClick={() => (sing.stop(), setTries((t) => t + 1))}>
            Stop
          </Button>
        ) : s.status !== 'hearing' ? (
          <>
            {mode !== 'echo' && (
              <Button size="sm" variant="ghost" icon={Ear} onClick={sing.hear}>
                Hear it
              </Button>
            )}
            <Button size="sm" variant="primary" icon={Mic} onClick={() => void sing.start()}>
              {tries > 0 ? 'Try again' : 'Sing'}
            </Button>
          </>
        ) : null}
      </div>
      {s.error !== '' && <p className="text-center text-[12.5px] text-[var(--sc-bad)]">{s.error}</p>}
    </div>
  );
}

function avgText(cs: (number | null)[]): string {
  const v = cs.filter((c): c is number => c !== null);
  if (v.length === 0) return '';
  const m = Math.round(v.reduce((a, b) => a + Math.abs(b), 0) / v.length);
  return `±${m}¢ on average`;
}

/* ------------------------------------------------------------------ rhythm */

const TOKEN: Record<string, { q: number; rest: boolean; glyph: string; syl: string }> = {
  w: { q: 4, rest: false, glyph: '𝅝', syl: 'ta-a-a-a' },
  h: { q: 2, rest: false, glyph: '𝅗𝅥', syl: 'ta-a' },
  hd: { q: 3, rest: false, glyph: '𝅗𝅥.', syl: 'ta-a-a' },
  q: { q: 1, rest: false, glyph: '♩', syl: 'ta' },
  qd: { q: 1.5, rest: false, glyph: '♩.', syl: 'ta-i' },
  '8': { q: 0.5, rest: false, glyph: '♪', syl: 'ti' },
  '8d': { q: 0.75, rest: false, glyph: '♪.', syl: 'ti' },
  '16': { q: 0.25, rest: false, glyph: '𝅘𝅥𝅯', syl: 'ti' },
  t8: { q: 1 / 3, rest: false, glyph: '♪³', syl: 'tri' },
  rw: { q: 4, rest: true, glyph: '𝄻', syl: '' },
  rh: { q: 2, rest: true, glyph: '𝄼', syl: '' },
  rhd: { q: 3, rest: true, glyph: '𝄼.', syl: '' },
  rq: { q: 1, rest: true, glyph: '𝄽', syl: '' },
  rqd: { q: 1.5, rest: true, glyph: '𝄽.', syl: '' },
  r8: { q: 0.5, rest: true, glyph: '𝄾', syl: '' },
};

export function rhythmTokens(rhythm: string): { tok: string; q: number; rest: boolean; glyph: string; syl: string; at: number }[] {
  let at = 0;
  return rhythm
    .trim()
    .split(/\s+/)
    .filter((t) => TOKEN[t] !== undefined)
    .map((t) => {
      const d = TOKEN[t]!;
      const out = { tok: t, ...d, at };
      at += d.q;
      return out;
    });
}

/** Speak a rhythm on "ta" with a click; each note counts when its onset lands within the window. */
export function SpeakTask({ rhythm, bpm = 72, meter = '4/4', done, onResult, windowMs = 160 }: { rhythm: string; bpm?: number | undefined; meter?: string | undefined; done: boolean; onResult: (v: number) => void; windowMs?: number }): React.JSX.Element {
  const app = useApp();
  const toks = useMemo(() => rhythmTokens(rhythm), [rhythm]);
  const [state, setState] = useState<'idle' | 'count' | 'run' | 'done'>(done ? 'done' : 'idle');
  const [marks, setMarks] = useState<(boolean | null)[]>(toks.map(() => null));
  const [pos, setPos] = useState(-1);
  const [error, setError] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const compound = /^(6|9|12)\/8$/.test(meter);
  const beatQ = compound ? 1.5 : 1;
  const beatsPerBar = compound ? Number(meter.split('/')[0]) / 3 : Number(meter.split('/')[0]) || 4;
  const run = async (): Promise<void> => {
    if (mic.status !== 'on') {
      const ms = await mic.start(app.settings?.input_device ?? '');
      if (ms !== 'on') return setError(micProblem(ms));
    }
    setError('');
    const ctx = audio.ensure();
    const secPerQ = 60 / bpm;
    const lead = beatsPerBar * beatQ * secPerQ;
    const t0 = ctx.currentTime + 0.3 + lead;
    const total = toks.reduce((a, t) => a + t.q, 0);
    for (let b = 0; b < beatsPerBar; b++) audio.click(t0 - lead + b * beatQ * secPerQ, b === 0);
    for (let q = 0; q < total - 1e-6; q += beatQ) audio.click(t0 + q * secPerQ, Math.round(q / beatQ) % beatsPerBar === 0);
    const lat = (app.settings?.latency_ms ?? 0) / 1000;
    const onsets: number[] = [];
    let loud = false;
    let quietSince = 0;
    const off = mic.onFrame((f) => {
      const isLoud = f.db > Math.max(mic.noise + 15, -52);
      if (isLoud && !loud && f.t - quietSince > 0.06) onsets.push(f.t - lat);
      if (!isLoud && loud) quietSince = f.t;
      loud = isLoud;
    });
    setState('count');
    setMarks(toks.map(() => null));
    const timer = window_setInterval(() => {
      const q = (audio.now() - t0) / secPerQ;
      if (q >= 0) setState('run');
      let p = -1;
      toks.forEach((t, i) => {
        if (q >= t.at) p = i;
      });
      setPos(p);
    }, 50);
    window.setTimeout(
      () => {
        off();
        window.clearInterval(timer);
        setPos(-1);
        const used = new Set<number>();
        const m = toks.map((t) => {
          if (t.rest) return null;
          const want = t0 + t.at * secPerQ;
          let best = -1;
          let bestD = 1e9;
          onsets.forEach((o, k) => {
            const d = Math.abs(o - want);
            if (!used.has(k) && d < bestD) {
              best = k;
              bestD = d;
            }
          });
          if (best >= 0 && bestD * 1000 <= windowMs) {
            used.add(best);
            return true;
          }
          return false;
        });
        const expected = m.filter((x) => x !== null).length;
        const hits = m.filter((x) => x === true).length;
        const extras = Math.max(0, onsets.filter((o) => o > t0 - 0.2 && o < t0 + total * secPerQ).length - hits);
        const sc = Math.max(0, Math.min(1, (hits - extras * 0.5) / Math.max(1, expected)));
        setMarks(m);
        setScore(sc);
        setState('done');
        onResult(sc);
      },
      (0.3 + lead + total * secPerQ + 0.5) * 1000,
    );
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-end justify-center gap-x-1 gap-y-2 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-4 py-3">
        {toks.map((t, i) => (
          <span key={i} className={cn('flex min-w-7 flex-col items-center rounded-[4px] px-1 pb-0.5 transition-colors', i === pos && 'bg-[var(--sc-active)]')} style={{ width: Math.max(28, t.q * 34) }}>
            <span className={cn('text-[24px] leading-none', marks[i] === true ? 'text-[var(--sc-voice)]' : marks[i] === false ? 'text-[var(--sc-bad)]' : t.rest ? 'text-[var(--sc-muted)]' : 'text-[var(--sc-ink)]')} style={{ fontFamily: '"Segoe UI Symbol", "Noto Music", "Apple Symbols", "Noto Sans Symbols 2", serif' }}>
              {t.glyph}
            </span>
            <span className="sc-mono mt-1 text-[10px] text-[var(--sc-muted)]">{t.syl}</span>
          </span>
        ))}
      </div>
      <div className="flex h-8 items-center gap-2">
        {state === 'count' && <span className="text-[12.5px] text-[var(--sc-ink-2)]">One bar of clicks, then speak…</span>}
        {state === 'done' && score !== null && (
          <span className="sc-pop flex items-center gap-1.5 text-[13px] font-semibold">
            <Check size={15} strokeWidth={2.6} aria-hidden className="text-[var(--sc-voice)]" /> {Math.round(score * 100)}% in time
          </span>
        )}
        {(state === 'idle' || state === 'done') && (
          <Button size="sm" variant={state === 'done' ? 'ghost' : 'primary'} icon={state === 'done' ? RotateCcw : Mic} onClick={() => void run()}>
            {state === 'done' ? 'Again' : `Speak it (${bpm} bpm)`}
          </Button>
        )}
      </div>
      {error !== '' && <p className="text-center text-[12.5px] text-[var(--sc-bad)]">{error}</p>}
    </div>
  );
}

function window_setInterval(fn: () => void, ms: number): number {
  return window.setInterval(fn, ms);
}

/* ------------------------------------------------------------------- breath */

/** Breathe with the ring: in, hold, out (a steady hiss the microphone hears), for some cycles. */
export function BreathTask({ inhale, suspend, exhale, cycles, sound = 'hiss', done, onResult }: { inhale: number; suspend: number; exhale: number; cycles: number; sound?: 'hiss' | 'hum' | 'none' | undefined; done: boolean; onResult: (v: number) => void }): React.JSX.Element {
  const app = useApp();
  const [phase, setPhase] = useState<{ phase: 'inhale' | 'suspend' | 'exhale' | 'rest'; p: number; cycle: number; left: number }>({ phase: 'rest', p: 0, cycle: 0, left: 0 });
  const [state, setState] = useState<'idle' | 'run' | 'done'>(done ? 'done' : 'idle');
  const [heard, setHeard] = useState<number | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const run = async (): Promise<void> => {
    if (sound !== 'none' && mic.status !== 'on') await mic.start(app.settings?.input_device ?? '');
    audio.ensure();
    const cycleLen = inhale + suspend + exhale;
    const start = performance.now();
    let exhaleFrames = 0;
    let soundFrames = 0;
    const off = mic.onFrame((f) => {
      const t = (performance.now() - start) / 1000;
      const inCycle = t % cycleLen;
      if (inCycle >= inhale + suspend && t < cycles * cycleLen) {
        exhaleFrames++;
        if (f.db > mic.noise + 8) soundFrames++;
      }
    });
    setState('run');
    timer.current = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      if (t >= cycles * cycleLen) {
        window.clearInterval(timer.current);
        off();
        const share = exhaleFrames > 0 ? soundFrames / exhaleFrames : 1;
        setHeard(sound === 'none' || mic.status !== 'on' ? null : share);
        setPhase({ phase: 'rest', p: 0, cycle: cycles, left: 0 });
        setState('done');
        onResult(sound === 'none' || mic.status !== 'on' ? 1 : Math.max(0.5, Math.min(1, share / 0.8)));
        return;
      }
      const c = Math.floor(t / cycleLen);
      const x = t - c * cycleLen;
      if (x < inhale) setPhase({ phase: 'inhale', p: x / inhale, cycle: c, left: inhale - x });
      else if (x < inhale + suspend) setPhase({ phase: 'suspend', p: (x - inhale) / Math.max(0.01, suspend), cycle: c, left: inhale + suspend - x });
      else setPhase({ phase: 'exhale', p: (x - inhale - suspend) / exhale, cycle: c, left: cycleLen - x });
    }, 40);
  };
  const label = phase.phase === 'inhale' ? 'Breathe in' : phase.phase === 'suspend' ? 'Hold, ribs open' : phase.phase === 'exhale' ? (sound === 'hiss' ? 'Out on a steady “sss”' : sound === 'hum' ? 'Out on a hum' : 'Breathe out') : '';
  return (
    <div className="flex flex-col items-center gap-3">
      <LiveDial target={null} mode="breath" height={150} breath={{ phase: phase.phase, p: phase.p }} />
      <div className="flex h-8 items-center gap-3">
        {state === 'run' && (
          <>
            <span className="text-[13.5px] font-semibold">{label}</span>
            <span className="sc-mono sc-num text-[12px] text-[var(--sc-muted)]">
              {Math.ceil(phase.left)} s · {phase.cycle + 1}/{cycles}
            </span>
          </>
        )}
        {state !== 'run' && (
          <>
            {state === 'done' && (
              <span className="sc-pop flex items-center gap-1.5 text-[13px] font-semibold">
                <Check size={15} strokeWidth={2.6} aria-hidden className="text-[var(--sc-voice)]" /> Done{heard !== null ? ` · sound on ${Math.round(heard * 100)}% of the out-breath` : ''}
              </span>
            )}
            <Button size="sm" variant={state === 'done' ? 'ghost' : 'primary'} icon={state === 'done' ? RotateCcw : Wind} onClick={() => void run()}>
              {state === 'done' ? 'Again' : `Start (${inhale}-${suspend}-${exhale} s × ${cycles})`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- self-check */

/** What only the singer can feel: tick each point. */
export function SelfCheck({ items, done, onResult }: { items: string[]; done: boolean; onResult: (v: number) => void }): React.JSX.Element {
  const [ticks, setTicks] = useState<boolean[]>(items.map(() => done));
  const all = ticks.every(Boolean);
  useEffect(() => {
    if (all && !done) onResult(1);
    // Reports once when the last box is ticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <label key={i} className={cn('flex cursor-pointer items-start gap-2.5 rounded-[var(--sc-radius-sm)] border px-3 py-2 text-[13px] leading-5 transition-colors', ticks[i] ? 'border-[var(--sc-line-2)] bg-[var(--sc-sunk)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)] hover:bg-[var(--sc-hover)]')}>
          <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks((t) => t.map((x, k) => (k === i ? e.target.checked : x)))} className="mt-0.5 size-4 shrink-0 accent-[var(--sc-ink)]" />
          <span>{it}</span>
        </label>
      ))}
      <p className="mt-1 text-[11.5px] text-[var(--sc-muted)]">The microphone cannot hear these: you are the judge. A recording or a teacher helps.</p>
    </div>
  );
}

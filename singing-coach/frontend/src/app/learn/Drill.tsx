/**
 * A drill run: a handful of items, one at a time.
 *
 *   quiz   tap a choice (or 1-9): right moves on by itself; wrong shows the
 *          answer and waits
 *   sing   each item sung on the voice dial (a note, an interval, an echo, a
 *          hold, a sustain); right when every note is reached in time
 *   speak  a rhythm spoken on "ta" with a click
 *
 * At the end the run is saved and the skill's mastery (and an adaptive
 * skill's level) moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Ear, Mic, Repeat, RotateCcw, Square, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { CountUp } from '../components/charts.tsx';
import { Button, IconButton, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { DrillSaved, SkillInfo } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { noteLabel } from '../music/dial.ts';
import { mic, micProblem } from '../music/mic.ts';
import { stopSound } from '../music/play.ts';
import { quizItems, speakItems, sungItems } from './drills.ts';
import type { QuizItem, SpeakItem, SungItem } from './drills.ts';
import { LiveDial, SpeakTask } from './tasks.tsx';
import { useSing } from './useSing.ts';
import { Options, SoundButton, Staff, useClef } from './widgets.tsx';

export interface DrillResult {
  items: number;
  correct: number;
  accuracy: number;
  saved: DrillSaved | null;
}

type Skill = Pick<SkillInfo, 'key' | 'title' | 'drill' | 'mastery' | 'level' | 'levels'>;

export function Drill({ skill, count = 8, embedded, onFinish, onExit }: { skill: Skill; count?: number; embedded?: boolean; onFinish?: (r: DrillResult) => void; onExit?: () => void }): React.JSX.Element {
  const app = useApp();
  const v = app.state?.voice;
  const box = useMemo(() => ({ lo: v?.comf_low ?? 55, hi: v?.comf_high ?? 70 }), [v?.comf_low, v?.comf_high]);
  const clef = useClef('auto');
  const level = skill.levels > 0 ? Math.max(1, skill.level || 1) : 1;
  const [round, setRound] = useState(0);
  const quiz = useMemo(() => (skill.drill === 'quiz' ? quizItems(skill.key, count, level, box, clef) : []), [skill.key, skill.drill, count, level, box, clef, round]);
  const sung = useMemo(() => (skill.drill === 'sing' ? sungItems(skill.key, skill.key.startsWith('breath.') ? 1 : count, level, box, skill.mastery) : []), [skill.key, skill.drill, count, level, box, skill.mastery, round]);
  const speak = useMemo(() => (skill.drill === 'speak' ? speakItems(skill.key, Math.min(count, 5)) : []), [skill.key, skill.drill, count, round]);
  const total = skill.drill === 'quiz' ? quiz.length : skill.drill === 'sing' ? sung.length : speak.length;
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ ok: boolean; ms: number; score: number }[]>([]);
  const [saved, setSaved] = useState<DrillSaved | null>(null);
  const [summary, setSummary] = useState<DrillResult | null>(null);
  const startedAt = useRef(performance.now());
  const voiced = useRef(0);
  const extra = useRef<Record<string, unknown>>({});

  useEffect(() => () => stopSound(), []);
  useEffect(() => {
    // Voiced time counts toward the day's voice use.
    if (skill.drill === 'quiz') return;
    let last = 0;
    const off = mic.onFrame((f) => {
      const now = performance.now();
      if (f.voiced && last > 0 && now - last < 60) voiced.current += now - last;
      last = f.voiced ? now : 0;
    });
    return () => {
      off();
    };
  }, [skill.drill]);

  const finishRun = useCallback(
    (all: { ok: boolean; ms: number; score: number }[]) => {
      const correct = all.filter((r) => r.ok).length;
      const timed = all.filter((r) => r.ms > 0);
      const avg = timed.length > 0 ? timed.reduce((s2, r) => s2 + r.ms, 0) / timed.length : 0;
      const acc = all.length > 0 ? all.reduce((s2, r) => s2 + r.score, 0) / all.length : 0;
      const res: DrillResult = { items: all.length, correct, accuracy: acc, saved: null };
      setSummary(res);
      api
        .saveDrill({ drill: skill.drill, skill: skill.key, items: all.length, correct, accuracy: Math.max(0, Math.min(1, acc)), avg_ms: Math.round(avg), duration_ms: Math.round(performance.now() - startedAt.current), voiced_ms: Math.round(voiced.current), cycles: Math.round((voiced.current / 1000) * 200), level: skill.levels > 0 ? level : undefined, detail: extra.current })
        .then((s2) => {
          setSaved(s2);
          if (s2.level_up > 0) toast.success(`Level ${s2.level_up} reached`);
          if (s2.health !== null) toast.info(s2.health.text);
          onFinish?.({ ...res, saved: s2 });
        })
        .catch((err: unknown) => {
          toast.error(errMessage(err));
          onFinish?.(res);
        });
    },
    [skill.drill, skill.key, skill.levels, level, onFinish],
  );

  const record = (ok: boolean, ms: number, score: number): void => {
    const all = [...results, { ok, ms, score }];
    setResults(all);
    if (all.length >= total) finishRun(all);
    else setI((x) => x + 1);
  };

  const again = (): void => {
    setRound((r) => r + 1);
    setI(0);
    setResults([]);
    setSaved(null);
    setSummary(null);
    startedAt.current = performance.now();
    voiced.current = 0;
    extra.current = {};
  };

  if (summary !== null)
    return (
      <div className={cn('flex flex-col items-center gap-4 text-center', embedded === true ? 'py-2' : 'py-10')}>
        <span className="sc-pop flex size-14 items-center justify-center rounded-full bg-[var(--sc-ink)] text-[var(--sc-page)]">
          <Check size={26} strokeWidth={2.6} aria-hidden />
        </span>
        <div>
          <div className="sc-mono sc-num text-[30px] font-light">
            <CountUp value={Math.round(summary.accuracy * 100)} />%
          </div>
          <div className="sc-label mt-1">
            {summary.correct} of {summary.items} right{saved !== null ? ` · mastery ${Math.round(saved.skill.mastery * 100)}%` : ''}
            {saved !== null && saved.level > 0 && skill.levels > 0 ? ` · next: level ${saved.level}` : ''}
          </div>
        </div>
        {embedded !== true && (
          <div className="flex gap-2">
            <Button icon={RotateCcw} onClick={again}>
              Again
            </Button>
            {onExit !== undefined && (
              <Button variant="primary" onClick={onExit}>
                Done
              </Button>
            )}
          </div>
        )}
      </div>
    );

  return (
    <div className={cn('flex flex-col gap-4', embedded === true ? '' : 'mx-auto w-full max-w-[640px] py-6')}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: total }, (_, k) => (
            <span key={k} className={cn('h-1 flex-1 rounded-full transition-colors', k < results.length ? (results[k]!.ok ? 'bg-[var(--sc-ink)]' : 'bg-[var(--sc-bad)]') : k === i ? 'bg-[var(--sc-ink-2)] opacity-50' : 'bg-[var(--sc-line)]')} />
          ))}
        </div>
        <span className="sc-mono sc-num text-[11.5px] text-[var(--sc-muted)]">
          {Math.min(i + 1, total)}/{total}
          {skill.levels > 0 ? ` · L${level}` : ''}
        </span>
        {embedded !== true && onExit !== undefined && <IconButton icon={X} label="Stop the drill" onClick={onExit} size={28} />}
      </div>
      {skill.drill === 'quiz' && quiz[i] !== undefined && <QuizView key={quiz[i]!.key + round} item={quiz[i]!} onAnswer={record} />}
      {skill.drill === 'sing' && sung[i] !== undefined && (
        <SungView
          key={sung[i]!.key + round}
          item={sung[i]!}
          onAnswer={(ok, ms, score, info) => {
            if (info?.hold !== undefined) extra.current = { ...extra.current, holds: [...((extra.current.holds as unknown[]) ?? []), info.hold] };
            if (info?.seconds !== undefined) extra.current = { ...extra.current, seconds: Math.max(Number(extra.current.seconds) || 0, info.seconds) };
            record(ok, ms, score);
          }}
        />
      )}
      {skill.drill === 'speak' && speak[i] !== undefined && <SpeakView key={speak[i]!.key + round} item={speak[i]!} onAnswer={record} />}
    </div>
  );
}

/* ------------------------------------------------------------------- quiz */

function QuizView({ item, onAnswer }: { item: QuizItem; onAnswer: (ok: boolean, ms: number, score: number) => void }): React.JSX.Element {
  const [chosen, setChosen] = useState<number | null>(null);
  const shown = useRef(performance.now());
  const choose = useCallback(
    (k: number) => {
      if (chosen !== null) return;
      setChosen(k);
      const ok = k === item.answer;
      const ms = performance.now() - shown.current;
      if (ok) window.setTimeout(() => onAnswer(true, ms, 1), 650);
    },
    [chosen, item.answer, onAnswer],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= item.options.length) choose(n - 1);
      if (e.key === 'Enter' && chosen !== null && chosen !== item.answer) onAnswer(false, performance.now() - shown.current, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, chosen, item, onAnswer]);
  return (
    <div className="sc-rise flex flex-col items-center gap-4">
      <div className="text-center text-[15px] font-semibold leading-snug">{item.prompt}</div>
      {item.big !== undefined && <div className="text-center text-[26px] font-semibold tracking-[-0.01em]">{item.big}</div>}
      {item.staff !== undefined && <Staff pic={item.staff} scale={1.3} />}
      {item.sound !== undefined && <SoundButton sound={item.sound} size="lg" label="Hear it" auto />}
      <Options options={item.options} answer={item.answer} chosen={chosen} onChoose={choose} numbered />
      {chosen !== null && chosen !== item.answer && (
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--sc-ink-2)]">{item.explain ?? `The answer is ${item.options[item.answer]}.`}</span>
          <Button variant="primary" iconRight={ArrowRight} onClick={() => onAnswer(false, performance.now() - shown.current, 0)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- sung */

function SungView({ item, onAnswer }: { item: SungItem; onAnswer: (ok: boolean, ms: number, score: number, info?: { hold?: { secs: number; sd: number }; seconds?: number }) => void }): React.JSX.Element {
  if (item.kind === 'sustain') return <SustainView item={item} onAnswer={onAnswer} />;
  return <NotesView item={item} onAnswer={onAnswer} />;
}

function NotesView({ item, onAnswer }: { item: SungItem; onAnswer: (ok: boolean, ms: number, score: number, info?: { hold?: { secs: number; sd: number } }) => void }): React.JSX.Element {
  const target = useMemo(() => ({ notes: item.notes, mode: item.mode, hold: item.hold, fit: 'none' as const, limit: item.limit, cue: item.cue, twice: item.twice }), [item]);
  const breathBroken = useRef(false);
  const lastVoiced = useRef(0);
  const sing = useSing(target, (s) => {
    const all = s.hits.every(Boolean) && !breathBroken.current;
    const share = s.hits.filter(Boolean).length / Math.max(1, s.hits.length);
    const ms = s.times[0] ?? 0;
    const sd = s.sds.filter((x): x is number => x !== null);
    const info = item.mode === 'hold' && item.kind !== 'phrase' && sd.length > 0 ? { hold: { secs: item.hold ?? 2, sd: sd[0]! } } : undefined;
    window.setTimeout(() => onAnswer(all, ms, breathBroken.current ? share * 0.5 : share, info), 700);
  });
  const s = sing.state;
  // A phrase on one breath: a gap of more than 0.3 s once started breaks it.
  useEffect(() => {
    if (item.kind !== 'phrase') return;
    const off = mic.onFrame((f) => {
      if (sing.state.status !== 'listening') return;
      const now = performance.now();
      if (f.voiced) {
        if (lastVoiced.current > 0 && now - lastVoiced.current > 300 && sing.state.index > 0) breathBroken.current = true;
        lastVoiced.current = now;
      }
    });
    return () => {
      off();
    };
  }, [item.kind, sing.state]);
  const begin = async (): Promise<void> => {
    breathBroken.current = false;
    lastVoiced.current = 0;
    if (item.pre !== undefined) {
      // A cadence first: the key in the ear.
      audio.ensure();
      const t = audio.now() + 0.1;
      item.pre.forEach((ch, k) => ch.forEach((m) => audio.play(m, 70, t + k * 0.75, 0.7)));
      window.setTimeout(() => void sing.start(), item.pre.length * 750 + 300);
      return;
    }
    await sing.start();
  };
  const cur = s.notes[Math.min(s.index, s.notes.length - 1)] ?? null;
  const reveal = item.mode !== 'echo' || s.status === 'done';
  return (
    <div className="sc-rise flex flex-col items-center gap-3">
      <div className="text-center text-[15px] font-semibold leading-snug">{item.prompt}</div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {s.notes.map((n, k) => (
          <span key={k} className={cn('sc-mono sc-num inline-flex h-7 min-w-9 items-center justify-center rounded-[var(--sc-radius-sm)] border px-2 text-[12.5px]', s.hits[k] ? 'border-[var(--sc-voice)] bg-[var(--sc-voice-soft)]' : k === s.index && s.status === 'listening' ? 'border-[var(--sc-ink)]' : 'border-[var(--sc-line)] text-[var(--sc-muted)]')}>
            {reveal || s.hits[k] ? (item.cue || k > 0 || s.status === 'done' ? noteLabel(n) : '?') : '?'}
          </span>
        ))}
      </div>
      <LiveDial target={s.status === 'listening' && (item.cue || s.index > 0 || item.pre !== undefined) ? cur : null} mode={item.mode === 'hold' ? 'hold' : 'song'} />
      <div className="flex h-8 items-center gap-2">
        {s.status === 'hearing' && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--sc-ink-2)]">
            <Ear size={14} aria-hidden /> Listen…
          </span>
        )}
        {s.status === 'listening' && item.mode === 'hold' && <span className="sc-mono sc-num text-[12.5px]">{s.held.toFixed(1)} s</span>}
        {s.status === 'listening' && (
          <Button size="sm" icon={Square} onClick={() => (sing.stop(), onAnswer(false, 0, s.hits.filter(Boolean).length / Math.max(1, s.hits.length)))}>
            Skip
          </Button>
        )}
        {s.status === 'idle' && (
          <Button size="sm" variant="primary" icon={Mic} onClick={() => void begin()}>
            {item.mode === 'echo' ? 'Listen, then sing' : item.pre !== undefined ? 'Hear the cadence' : 'Sing'}
          </Button>
        )}
        {s.status === 'done' && (
          <span className="sc-pop flex items-center gap-1.5 text-[13px] font-semibold">
            {s.hits.every(Boolean) && !breathBroken.current ? <Check size={15} strokeWidth={2.6} aria-hidden className="text-[var(--sc-voice)]" /> : <Repeat size={14} aria-hidden className="text-[var(--sc-muted)]" />}
            {breathBroken.current ? 'A breath in the middle' : s.hits.every(Boolean) ? 'Right' : 'Not this time'}
          </span>
        )}
      </div>
      {s.error !== '' && <p className="text-center text-[12.5px] text-[var(--sc-bad)]">{s.error}</p>}
    </div>
  );
}

/** Sustain: "ah" for as long as it stays easy; short gaps under 0.15 s are bridged. */
function SustainView({ item, onAnswer }: { item: SungItem; onAnswer: (ok: boolean, ms: number, score: number, info?: { seconds?: number }) => void }): React.JSX.Element {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'on' | 'done'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const run = useRef({ start: 0, last: 0, best: 0 });
  useEffect(() => {
    const off = mic.onFrame((f) => {
      if (state !== 'on') return;
      const now = performance.now();
      const r = run.current;
      if (f.voiced) {
        if (r.start === 0 || now - r.last > 150) r.start = now;
        r.last = now;
        setSecs((now - r.start) / 1000);
      } else if (r.start > 0 && now - r.last > 450) {
        const s2 = (r.last - r.start) / 1000;
        r.best = Math.max(r.best, s2);
        r.start = 0;
        if (s2 > 1.5) {
          setState('done');
          onAnswer(s2 >= 5, 0, Math.min(1, s2 / 15), { seconds: Math.round(s2 * 10) / 10 });
        }
      }
    });
    return () => {
      off();
    };
  }, [state, onAnswer]);
  const begin = async (): Promise<void> => {
    if (mic.status !== 'on') {
      const ms = await mic.start(app.settings?.input_device ?? '');
      if (ms !== 'on') return setError(micProblem(ms));
    }
    audio.singNote(item.notes[0]!, audio.now() + 0.05, 1, 'ah');
    run.current = { start: 0, last: 0, best: 0 };
    setSecs(0);
    setState('on');
  };
  return (
    <div className="sc-rise flex flex-col items-center gap-3">
      <div className="text-center text-[15px] font-semibold leading-snug">{item.prompt}</div>
      <LiveDial target={item.notes[0] ?? null} mode="hold" />
      <div className="sc-mono sc-num text-[32px] font-light">{secs.toFixed(1)} s</div>
      {state === 'idle' && (
        <Button variant="primary" icon={Mic} onClick={() => void begin()}>
          Start
        </Button>
      )}
      {state === 'on' && <span className="text-[12.5px] text-[var(--sc-muted)]">Stop when it stops being easy: never squeeze the last drop.</span>}
      {error !== '' && <p className="text-center text-[12.5px] text-[var(--sc-bad)]">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ speak */

function SpeakView({ item, onAnswer }: { item: SpeakItem; onAnswer: (ok: boolean, ms: number, score: number) => void }): React.JSX.Element {
  return (
    <div className="sc-rise flex flex-col items-center gap-3">
      <div className="text-center text-[15px] font-semibold leading-snug">{item.prompt}</div>
      <SpeakTask rhythm={item.rhythm} bpm={item.bpm} meter={item.meter} done={false} onResult={(sc) => window.setTimeout(() => onAnswer(sc >= 0.75, 0, sc), 900)} />
    </div>
  );
}

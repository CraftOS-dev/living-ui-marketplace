/**
 * A drill run: a handful of items, one at a time. Answer by tapping a
 * choice (or 1–9) or by playing on the keys. A right answer moves on by
 * itself; a wrong one shows the answer and waits. At the end the run is
 * saved and the skill's mastery moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Repeat, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { CountUp } from '../components/charts.tsx';
import { Button, IconButton, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { DrillSaved, SkillInfo } from '../lib/types.ts';
import { input } from '../music/input.ts';
import { stopSound } from '../music/play.ts';
import { makeItems } from './drills.ts';
import type { Item } from './drills.ts';
import { usePlay } from './usePlay.ts';
import { MiniKeys, Options, SoundButton, Staff } from './widgets.tsx';

export interface QuizResult {
  items: number;
  correct: number;
  accuracy: number;
  saved: DrillSaved | null;
}

export function Quiz({ skill, count = 10, level = 1, embedded, onFinish, onExit }: { skill: Pick<SkillInfo, 'key' | 'title' | 'drill' | 'mastery'>; count?: number; level?: number; embedded?: boolean; onFinish?: (r: QuizResult) => void; onExit?: () => void }): React.JSX.Element {
  const [round, setRound] = useState(0);
  const items = useMemo(() => makeItems(skill.key, skill.drill, count, level), [skill.key, skill.drill, count, level, round]);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ ok: boolean; ms: number }[]>([]);
  const [answer, setAnswer] = useState<{ ok: boolean; choice: number | null } | null>(null);
  const [saved, setSaved] = useState<DrillSaved | null>(null);
  const [summary, setSummary] = useState<QuizResult | null>(null);
  const shownAt = useRef(performance.now());
  const startedAt = useRef(performance.now());
  const item = items[i];

  useEffect(() => {
    shownAt.current = performance.now();
  }, [i, round]);
  useEffect(() => () => stopSound(), []);

  const finishRun = useCallback(
    (all: { ok: boolean; ms: number }[]) => {
      const correct = all.filter((r) => r.ok).length;
      const avg = all.length > 0 ? all.reduce((s, r) => s + r.ms, 0) / all.length : 0;
      const res: QuizResult = { items: all.length, correct, accuracy: correct / Math.max(1, all.length), saved: null };
      setSummary(res);
      api
        .saveDrill({ drill: skill.drill, skill: skill.key, items: all.length, correct, avg_ms: Math.round(avg), duration_ms: Math.round(performance.now() - startedAt.current), level })
        .then((s) => {
          setSaved(s);
          if (s.level_up > 0) toast.success(`Level ${s.level_up} reached`);
        })
        .catch((err: unknown) => toast.error(errMessage(err)));
    },
    [skill.drill, skill.key, level],
  );

  const next = useCallback(() => {
    stopSound();
    setAnswer(null);
    if (i + 1 >= items.length) finishRun(results);
    else setI(i + 1);
  }, [i, items.length, results, finishRun]);

  const record = useCallback(
    (ok: boolean, choice: number | null) => {
      if (answer !== null) return;
      const ms = performance.now() - shownAt.current;
      const all = [...results, { ok, ms }];
      setResults(all);
      setAnswer({ ok, choice });
      if (ok) window.setTimeout(() => (i + 1 >= items.length ? finishRun(all) : (setAnswer(null), setI((x) => x + 1))), 650);
    },
    [answer, results, i, items.length, finishRun],
  );

  const play = usePlay(item?.play ?? null, { strict: true, onDone: (ok) => record(ok, null) });

  // Options-only items: the number keys choose (and stop playing notes).
  const choiceOnly = item !== undefined && item.play === undefined;
  useEffect(() => {
    if (!choiceOnly || summary !== null) return;
    const prev = input.keyboardOn;
    input.keyboardOn = false;
    return () => {
      input.keyboardOn = prev;
    };
  }, [choiceOnly, summary]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (summary !== null || item === undefined) return;
      if (e.key === 'Enter' && answer !== null && !answer.ok) {
        e.preventDefault();
        next();
        return;
      }
      if (!choiceOnly || answer !== null || item.options === undefined) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= item.options.length) {
        e.preventDefault();
        record(n - 1 === item.answer, n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, answer, choiceOnly, summary, next, record]);

  const again = (): void => {
    setRound((r) => r + 1);
    setI(0);
    setResults([]);
    setAnswer(null);
    setSaved(null);
    setSummary(null);
    startedAt.current = performance.now();
  };

  if (summary !== null) return <Summary skill={skill} result={summary} saved={saved} embedded={embedded === true} onAgain={again} onDone={() => (onFinish !== undefined ? onFinish({ ...summary, saved }) : onExit?.())} />;
  if (item === undefined) return <div />;

  return (
    <div className={cn('flex w-full flex-col items-center', embedded === true ? 'gap-4' : 'gap-6')}>
      <div className="flex w-full max-w-[640px] items-center gap-3">
        <div className="flex flex-1 gap-1">
          {items.map((_, k) => {
            const r = results[k];
            return <span key={k} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', r === undefined ? (k === i ? 'bg-[var(--pc-ink-2)]' : 'bg-[var(--pc-line)]') : r.ok ? 'bg-[var(--pc-good)]' : 'bg-[var(--pc-bad)]')} />;
          })}
        </div>
        <span className="pc-mono pc-num text-[12px] text-[var(--pc-muted)]">
          {i + 1}/{items.length}
        </span>
        {onExit !== undefined && embedded !== true && <IconButton icon={X} label="Stop" onClick={onExit} size={28} />}
      </div>
      <ItemView key={`${round}.${i}`} item={item} answer={answer} play={play} onChoose={(k) => record(k === item.answer, k)} embedded={embedded === true} />
      <div className="flex min-h-[40px] w-full max-w-[640px] flex-col items-center gap-2">
        {answer !== null && item.explain !== undefined && <div className="pc-rise text-center text-[13px] text-[var(--pc-ink-2)]">{item.explain}</div>}
        {answer !== null && !answer.ok && (
          <Button variant="primary" iconRight={ArrowRight} onClick={next} autoFocus className="pc-rise">
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function ItemView({ item, answer, play, onChoose, embedded }: { item: Item; answer: { ok: boolean; choice: number | null } | null; play: ReturnType<typeof usePlay>; onChoose: (k: number) => void; embedded: boolean }): React.JSX.Element {
  const opts = item.options ?? [];
  return (
    <div className="pc-rise flex w-full max-w-[640px] flex-col items-center gap-4">
      <div className="text-[13px] font-medium text-[var(--pc-muted)]">{item.prompt}</div>
      <div className={cn('flex min-h-[96px] items-center justify-center gap-5 rounded-[var(--pc-radius)] transition-shadow', answer?.ok === true && 'pc-glow', answer?.ok === false && 'pc-shake')}>
        {item.big !== undefined && <span className={cn('font-semibold tracking-[-0.02em] text-[var(--pc-ink)]', item.big.length > 12 ? 'text-[26px]' : embedded ? 'text-[40px]' : 'text-[52px]')}>{item.big}</span>}
        {item.staff !== undefined && <Staff pic={item.staff} scale={embedded ? 1.35 : 1.6} />}
        {item.sound !== undefined && <SoundButton sound={item.sound} size={item.staff === undefined && item.big === undefined ? 'lg' : 'md'} auto={item.staff === undefined} label="Hear it" />}
        {answer !== null && (
          <span className={cn('pc-pop flex size-8 items-center justify-center rounded-full text-white', answer.ok ? 'bg-[var(--pc-good)]' : 'bg-[var(--pc-bad)]')}>
            {answer.ok ? <Check size={17} strokeWidth={3} aria-hidden /> : <X size={17} strokeWidth={3} aria-hidden />}
          </span>
        )}
      </div>
      {opts.length > 0 && <Options options={opts} answer={item.answer ?? -1} chosen={answer === null ? null : (answer.choice ?? (answer.ok ? (item.answer ?? -1) : -2))} onChoose={onChoose} numbered={item.play === undefined} />}
      {item.play !== undefined && <MiniKeys from={item.play.from} to={item.play.to} marks={play.marks} onNote={answer === null ? play.onNote : undefined} height={embedded ? 104 : 128} names={false} />}
      {item.play !== undefined && item.play.mode === 'chord' && answer === null && <div className="text-[11.5px] text-[var(--pc-faint)]">Tap the keys one by one, or hold them on your piano</div>}
    </div>
  );
}

function Summary({ skill, result, saved, embedded, onAgain, onDone }: { skill: Pick<SkillInfo, 'title' | 'mastery'>; result: QuizResult; saved: DrillSaved | null; embedded: boolean; onAgain: () => void; onDone: () => void }): React.JSX.Element {
  const pct = Math.round(result.accuracy * 100);
  const before = skill.mastery;
  const after = saved?.skill.mastery ?? before;
  const stars = saved?.skill.stars ?? 0;
  return (
    <div className="pc-rise flex w-full max-w-[420px] flex-col items-center gap-4 text-center">
      <div className="pc-mono pc-num text-[60px] font-light leading-none tracking-tight">
        <CountUp value={pct} />
        <span className="text-[26px] text-[var(--pc-muted)]">%</span>
      </div>
      <div className="text-[13px] text-[var(--pc-ink-2)]">
        {result.correct} of {result.items} · {skill.title}
      </div>
      <div className="w-full">
        <div className="pc-label mb-1.5 flex justify-between">
          <span className="flex items-center gap-1">
            {[1, 2, 3].map((s) => (
              <span key={s} className={cn('text-[13px] transition-colors duration-500', s <= stars ? 'text-[var(--pc-warn)]' : 'text-[var(--pc-line-2)]')}>
                ★
              </span>
            ))}
          </span>
          <span className="pc-num">
            {Math.round(before * 100)} → {Math.round(after * 100)}
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--pc-line)]">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--pc-ink-2)] opacity-40" style={{ width: `${before * 100}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--pc-ink)] transition-[width] duration-1000 ease-out" style={{ width: `${after * 100}%` }} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button icon={Repeat} onClick={onAgain}>
          Again
        </Button>
        <Button variant="primary" iconRight={ArrowRight} onClick={onDone}>
          {embedded ? 'Continue' : 'Done'}
        </Button>
      </div>
    </div>
  );
}

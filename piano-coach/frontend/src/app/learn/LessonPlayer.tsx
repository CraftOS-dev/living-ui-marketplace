/**
 * A lesson, page by page. A page is a short explanation with its pictures
 * and ends with something to do: play it, pick the answer, a quick drill,
 * an exercise. Continue unlocks when the task is done. The last page saves
 * the lesson with its score (right first time).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, Lightbulb, Piano, RotateCcw, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { CountUp } from '../components/charts.tsx';
import { Button, IconButton, Spinner, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { clock } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { LessonInfo, SkillInfo } from '../lib/types.ts';
import { encodeSpec, generate } from '../music/generate.ts';
import { stopSound, toMidi } from '../music/play.ts';
import { Quiz } from './Quiz.tsx';
import type { Lesson, Sound, Step } from './schema.ts';
import { usePlay } from './usePlay.ts';
import { KeysPicture, MiniKeys, Options, Prose, Score, SoundButton, Staff, keysRange } from './widgets.tsx';

const TASKS = ['play', 'choose', 'drill', 'exercise'];
const isTask = (s: Step): boolean => TASKS.includes(s.t);

/** Group steps into pages: explanation and pictures, ending at a task. */
function paginate(steps: Step[]): { step: Step; i: number }[][] {
  const out: { step: Step; i: number }[][] = [];
  let cur: { step: Step; i: number }[] = [];
  steps.forEach((step, i) => {
    const next = steps[i + 1];
    cur.push({ step, i });
    const info = cur.filter((c) => !isTask(c.step)).length;
    if (isTask(step) || (info >= 3 && next !== undefined && next.t === 'text')) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length > 0) out.push(cur);
  return out;
}

let contentCache: Promise<Record<string, Lesson>> | null = null;
export function loadContent(): Promise<Record<string, Lesson>> {
  if (contentCache === null) contentCache = import('./content/index.ts').then((m) => m.CONTENT);
  return contentCache;
}

const SAVE = 'pc.lesson.';

export function LessonPlayer({ info, unitTitle, skills, next, startPage, doneStep, block, onExit, onOpen }: { info: LessonInfo; unitTitle: string; skills: SkillInfo[]; next: LessonInfo | null; startPage: number | null; doneStep: number | null; block: number | null; onExit: () => void; onOpen: (key: string) => void }): React.JSX.Element {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadContent()
      .then((c) => {
        if (!alive) return;
        const l = c[info.key];
        if (l === undefined) setFailed(true);
        else setLesson(l);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [info.key]);
  if (failed)
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--pc-muted)]">
        This lesson could not be loaded. <Button className="ml-2" onClick={onExit}>Back</Button>
      </div>
    );
  if (lesson === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--pc-muted)]">
        <Spinner size={18} />
      </div>
    );
  return <Player key={info.key} lesson={lesson} info={info} unitTitle={unitTitle} skills={skills} next={next} startPage={startPage} doneStep={doneStep} block={block} onExit={onExit} onOpen={onOpen} />;
}

function Player({ lesson, info, unitTitle, skills, next, startPage, doneStep, block, onExit, onOpen }: { lesson: Lesson; info: LessonInfo; unitTitle: string; skills: SkillInfo[]; next: LessonInfo | null; startPage: number | null; doneStep: number | null; block: number | null; onExit: () => void; onOpen: (key: string) => void }): React.JSX.Element {
  const pages = useMemo(() => paginate(lesson.steps), [lesson]);
  const restored = useMemo(() => {
    try {
      const raw = localStorage.getItem(SAVE + lesson.key);
      return raw === null ? null : (JSON.parse(raw) as { page: number; results: Record<number, number>; ms: number });
    } catch {
      return null;
    }
  }, [lesson.key]);
  const [page, setPage] = useState(() => Math.min(pages.length - 1, Math.max(0, startPage ?? restored?.page ?? 0)));
  // Back from an exercise played in the practice screen: that step is done.
  const [results, setResults] = useState<Record<number, number>>(() => ({ ...(restored?.results ?? {}), ...(doneStep !== null ? { [doneStep]: 1 } : {}) }));
  const [finished, setFinished] = useState<{ score: number; ms: number; first: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(performance.now() - (restored?.ms ?? 0));
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (finished !== null) return;
    try {
      localStorage.setItem(SAVE + lesson.key, JSON.stringify({ page, results, ms: performance.now() - started.current }));
    } catch {
      /* a convenience */
    }
  }, [page, results, lesson.key, finished]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    stopSound();
  }, [page]);
  useEffect(() => () => stopSound(), []);

  const cur = pages[page] ?? [];
  const task = cur.find((c) => isTask(c.step));
  const ready = task === undefined || task.step.t === 'exercise' || results[task.i] !== undefined;

  const finish = useCallback(() => {
    const scored = lesson.steps.map((s, i) => ({ s, i })).filter((x) => x.s.t !== 'exercise' && isTask(x.s));
    const score = scored.length === 0 ? 1 : scored.reduce((sum, x) => sum + (results[x.i] ?? 0), 0) / scored.length;
    const ms = performance.now() - started.current;
    setBusy(true);
    api
      .lessonDone(lesson.key, Math.round(score * 1000) / 1000, Math.round(ms))
      .then((r) => {
        setFinished({ score, ms, first: r.first });
        if (r.level_up > 0) toast.success(`Level ${r.level_up} reached`);
        if (block !== null) void api.planDone(block).catch(() => undefined);
        try {
          localStorage.removeItem(SAVE + lesson.key);
        } catch {
          /* a convenience */
        }
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  }, [lesson, results, block]);

  const go = useCallback(() => {
    if (!ready) return;
    if (page + 1 < pages.length) setPage(page + 1);
    else finish();
  }, [ready, page, pages.length, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || finished !== null) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'BUTTON')) return;
      e.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, finished]);

  const setResult = (i: number, v: number): void => setResults((r) => (r[i] !== undefined ? r : { ...r, [i]: v }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--pc-line)] px-3 md:px-5">
        <IconButton icon={X} label="Close the lesson" onClick={onExit} />
        <div className="min-w-0 max-w-[300px] leading-tight">
          <div className="pc-label truncate">{unitTitle}</div>
          <div className="truncate text-[14px] font-semibold">{info.title}</div>
        </div>
        <div className="mx-2 flex flex-1 items-center gap-1">
          {pages.map((_, k) => (
            <span key={k} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', finished !== null || k < page ? 'bg-[var(--pc-ink)]' : k === page ? 'bg-[var(--pc-ink-2)] opacity-60' : 'bg-[var(--pc-line)]')} />
          ))}
        </div>
        <span className="pc-mono pc-num hidden text-[12px] text-[var(--pc-muted)] sm:block">{info.minutes} min</span>
      </header>

      <div ref={scroller} className="pc-scroll min-h-0 flex-1 overflow-y-auto">
        {finished !== null ? (
          <Done info={info} score={finished.score} ms={finished.ms} next={next} onNext={() => next !== null && onOpen(next.key)} onBack={onExit} onAgain={() => (setFinished(null), setResults({}), setPage(0), (started.current = performance.now()))} />
        ) : (
          <div key={page} className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-6 px-5 py-8 md:px-8">
            {cur.map(({ step, i }, k) => (
              <div key={i} className="pc-rise" style={{ animationDelay: `${Math.min(k, 4) * 70}ms` }}>
                <StepView step={step} index={i} lessonKey={lesson.key} page={page} skills={skills} result={results[i]} onResult={(v) => setResult(i, v)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {finished === null && (
        <footer className="flex h-[60px] shrink-0 items-center gap-2 border-t border-[var(--pc-line)] bg-[var(--pc-panel)] px-4 md:px-6">
          <Button variant="ghost" icon={ArrowLeft} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Back
          </Button>
          <div className="flex-1" />
          {task !== undefined && task.step.t === 'exercise' && results[task.i] === undefined && <span className="hidden text-[12px] text-[var(--pc-muted)] sm:block">Optional</span>}
          <Button variant="primary" size="lg" iconRight={page + 1 < pages.length ? ArrowRight : Check} onClick={go} disabled={!ready} busy={busy} className="min-w-[132px]">
            {page + 1 < pages.length ? 'Continue' : 'Finish'}
          </Button>
        </footer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

function StepView({ step, index, lessonKey, page, skills, result, onResult }: { step: Step; index: number; lessonKey: string; page: number; skills: SkillInfo[]; result: number | undefined; onResult: (v: number) => void }): React.JSX.Element {
  switch (step.t) {
    case 'text':
      return <Prose md={step.md} />;
    case 'tip':
      return (
        <div className="flex gap-3 rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-sunk)] px-4 py-3">
          <Lightbulb size={16} strokeWidth={1.9} aria-hidden className="mt-1 shrink-0 text-[var(--pc-warn)]" />
          <Prose md={step.md} className="text-[13.5px]" />
        </div>
      );
    case 'staff':
      return (
        <Figure caption={step.caption} sound={step.sound}>
          <Staff pic={step.staff} scale={1.35} />
        </Figure>
      );
    case 'keys':
      return (
        <Figure caption={step.caption} sound={step.sound}>
          <KeysPicture pic={step.keys} height={120} />
        </Figure>
      );
    case 'score':
      return (
        <Figure caption={step.caption}>
          <Score abc={step.abc} actions={step.practice === true ? <Button size="sm" icon={Piano} onClick={() => navigate('practice', { ex: `${lessonKey}.${index}`, back: `learn?lesson=${lessonKey}&page=${page}` })}>Practise</Button> : undefined} />
        </Figure>
      );
    case 'play':
      return <PlayStep step={step} done={result !== undefined} onResult={onResult} />;
    case 'choose':
      return <ChooseStep step={step} onResult={onResult} />;
    case 'drill': {
      const sk = skills.find((s) => s.key === step.skill);
      if (sk === undefined) return <div />;
      return (
        <Task title={sk.title} done={result !== undefined}>
          {result === undefined ? <Quiz skill={sk} count={step.items} embedded onFinish={(r) => onResult(r.accuracy)} /> : <div className="pc-rise flex items-center justify-center gap-2 py-3 text-[14px] font-semibold"><Check size={16} className="text-[var(--pc-good)]" aria-hidden /> {Math.round(result * 100)}%</div>}
        </Task>
      );
    }
    case 'exercise':
      return <ExerciseStep step={step} index={index} lessonKey={lessonKey} page={page} done={result !== undefined} />;
  }
}

function Figure({ caption, sound, children }: { caption?: string | undefined; sound?: Sound | undefined; children: React.ReactNode }): React.JSX.Element {
  return (
    <figure className="flex flex-col items-center gap-2.5">
      <div className="w-full">{children}</div>
      {(caption !== undefined || sound !== undefined) && (
        <figcaption className="flex items-center gap-2.5 text-[12.5px] text-[var(--pc-muted)]">
          {sound !== undefined && <SoundButton sound={sound} size="sm" />}
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** A task box: a hairline panel with the prompt. */
function Task({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className={cn('rounded-[calc(var(--pc-radius)*1.25)] border bg-[var(--pc-panel)] px-4 pb-4 pt-3.5 transition-colors duration-300 md:px-5', done ? 'border-[color-mix(in_srgb,var(--pc-good),transparent_55%)]' : 'border-[var(--pc-line)]')}>
      <div className="mb-3.5 flex items-center gap-2">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300', done ? 'bg-[var(--pc-good)] text-white' : 'border border-[var(--pc-line-2)] text-transparent')}>
          <Check size={12} strokeWidth={3} aria-hidden />
        </span>
        <h3 className="text-[14.5px] font-semibold leading-snug">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function PlayStep({ step, done, onResult }: { step: Extract<Step, { t: 'play' }>; done: boolean; onResult: (v: number) => void }): React.JSX.Element {
  const notes = useMemo(() => step.notes.map(toMidi), [step.notes]);
  const task = useMemo(() => ({ notes, mode: step.mode, octave: step.octave }), [notes, step.mode, step.octave]);
  const [ok, setOk] = useState(done);
  const play = usePlay(ok ? null : task, {
    strict: false,
    hint: step.hint,
    onDone: (_good, errors) => {
      setOk(true);
      onResult(errors === 0 ? 1 : errors <= 2 ? 0.6 : 0.3);
    },
  });
  const errs = play.errors;
  const extra = useMemo(() => {
    const m = new Map(play.marks);
    if (ok) for (const n of notes) m.set(n, { tone: 'good' });
    for (const x of step.keys?.marks ?? []) if (!m.has(toMidi(x.note))) m.set(toMidi(x.note), { label: x.label, tone: x.tone ?? 'ink' });
    return m;
  }, [play.marks, ok, notes, step.keys]);
  const [a, b] = keysRange(step.keys ?? {}, notes);
  return (
    <Task title={step.prompt} done={ok}>
      <div className="flex flex-col items-center gap-3">
        {step.staff !== undefined && <Staff pic={step.staff} scale={1.25} />}
        <MiniKeys from={a} to={b} marks={extra} names={step.keys?.names} onNote={ok ? undefined : play.onNote} height={124} />
        <div className="flex h-7 items-center gap-3 text-[12.5px] text-[var(--pc-muted)]">
          {step.mode === 'order' && notes.length > 1 && !ok && (
            <span className="flex gap-1">
              {notes.map((_, k) => (
                <span key={k} className={cn('size-1.5 rounded-full transition-colors', k < Math.round(play.progress * notes.length) ? 'bg-[var(--pc-good)]' : 'bg-[var(--pc-line-2)]')} />
              ))}
            </span>
          )}
          {ok && (
            <span className="pc-pop flex items-center gap-1.5 font-semibold text-[var(--pc-good)]">
              <Check size={15} strokeWidth={2.6} aria-hidden /> {errs === 0 ? 'Right first time' : 'Done'}
            </span>
          )}
          {!ok && errs >= 2 && step.hint !== true && (
            <Button size="sm" variant="ghost" icon={Eye} onClick={play.reveal}>
              Show me
            </Button>
          )}
          {!ok && step.mode === 'chord' && <span className="text-[11.5px] text-[var(--pc-faint)]">Tap the keys one by one, or hold them on your piano</span>}
        </div>
      </div>
    </Task>
  );
}

function ChooseStep({ step, onResult }: { step: Extract<Step, { t: 'choose' }>; onResult: (v: number) => void }): React.JSX.Element {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <Task title={step.prompt} done={chosen !== null}>
      <div className="flex flex-col items-center gap-4">
        {(step.staff !== undefined || step.keys !== undefined || step.sound !== undefined) && (
          <div className="flex w-full flex-col items-center gap-3">
            {step.staff !== undefined && <Staff pic={step.staff} scale={1.3} />}
            {step.keys !== undefined && <KeysPicture pic={step.keys} height={110} />}
            {step.sound !== undefined && <SoundButton sound={step.sound} size={step.staff === undefined && step.keys === undefined ? 'lg' : 'md'} label="Hear it" />}
          </div>
        )}
        <Options
          options={step.options}
          answer={step.answer}
          chosen={chosen}
          onChoose={(k) => {
            setChosen(k);
            onResult(k === step.answer ? 1 : 0);
          }}
        />
        {chosen !== null && step.explain !== undefined && <div className="pc-rise w-full text-[13px] leading-5 text-[var(--pc-ink-2)]">{step.explain}</div>}
      </div>
    </Task>
  );
}

function ExerciseStep({ step, index, lessonKey, page, done }: { step: Extract<Step, { t: 'exercise' }>; index: number; lessonKey: string; page: number; done: boolean }): React.JSX.Element {
  const gen = useMemo(() => {
    try {
      return generate(step.spec);
    } catch {
      return null;
    }
  }, [step.spec]);
  if (gen === null) return <div />;
  return (
    <Task title={step.label} done={done}>
      <Score
        abc={gen.abc}
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={Piano}
            onClick={() => navigate('practice', { gen: encodeSpec(step.spec), back: `learn?lesson=${lessonKey}&page=${page}&step=${index}` })}
          >
            {done ? 'Play again' : 'Play it'}
          </Button>
        }
      />
    </Task>
  );
}

/* ---------------------------------------------------------------- the end */

function Done({ info, score, ms, next, onNext, onBack, onAgain }: { info: LessonInfo; score: number; ms: number; next: LessonInfo | null; onNext: () => void; onBack: () => void; onAgain: () => void }): React.JSX.Element {
  const pct = Math.round(score * 100);
  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-5 px-6 pt-[12vh] text-center">
      <span className="pc-pop flex size-16 items-center justify-center rounded-full bg-[var(--pc-ink)] text-[var(--pc-page)]">
        <Check size={30} strokeWidth={2.6} aria-hidden />
      </span>
      <div>
        <div className="text-[19px] font-semibold tracking-[-0.01em]">{info.title}</div>
        <div className="pc-label mt-1">Lesson complete</div>
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        <div className="rounded-[var(--pc-radius)] bg-[var(--pc-sunk)] px-3 py-2.5">
          <div className="pc-label text-[9.5px]">Right first time</div>
          <div className="pc-mono pc-num mt-0.5 text-[22px] font-medium">
            <CountUp value={pct} />%
          </div>
        </div>
        <div className="rounded-[var(--pc-radius)] bg-[var(--pc-sunk)] px-3 py-2.5">
          <div className="pc-label text-[9.5px]">Time</div>
          <div className="pc-mono pc-num mt-0.5 text-[22px] font-medium">{clock(ms / 1000)}</div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2">
        {next !== null && (
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={onNext} className="w-full">
            <span className="truncate">{next.title}</span>
          </Button>
        )}
        <div className="flex gap-2">
          <Button icon={RotateCcw} onClick={onAgain} className="flex-1">
            Again
          </Button>
          <Button onClick={onBack} className="flex-1">
            All lessons
          </Button>
        </div>
      </div>
    </div>
  );
}

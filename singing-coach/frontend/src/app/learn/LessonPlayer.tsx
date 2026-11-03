/**
 * A lesson, page by page. A page is a short explanation with its pictures
 * and ends with something to do: sing it, speak it, breathe with the guide,
 * pick the answer, check yourself, a quick drill, a vocalise. Continue
 * unlocks when the task is done. The last page saves the lesson with its
 * score (right first time) and the voice time it took.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lightbulb, Mic, Music2, RotateCcw, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { CountUp } from '../components/charts.tsx';
import { Button, IconButton, Spinner, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { clock } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { LessonInfo, SkillInfo } from '../lib/types.ts';
import { specKey } from '../music/generate.ts';
import { mic } from '../music/mic.ts';
import { stopSound } from '../music/play.ts';
import { Drill } from './Drill.tsx';
import { Figure as Diagram } from './figures.tsx';
import type { Lesson, Sound, Step } from './schema.ts';
import { BreathTask, SelfCheck, SingTask, SpeakTask } from './tasks.tsx';
import { DialPicture, Options, Prose, Score, SoundButton, Staff } from './widgets.tsx';

const TASKS = ['sing', 'speak', 'breath', 'choose', 'selfcheck', 'drill', 'exercise'];
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

const SAVE = 'sc.lesson.';

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
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--sc-muted)]">
        This lesson could not be loaded.{' '}
        <Button className="ml-2" onClick={onExit}>
          Back
        </Button>
      </div>
    );
  if (lesson === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--sc-muted)]">
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
  // Back from a vocalise sung in the practice screen: that step is done.
  const [results, setResults] = useState<Record<number, number>>(() => ({ ...(restored?.results ?? {}), ...(doneStep !== null ? { [doneStep]: 1 } : {}) }));
  const [finished, setFinished] = useState<{ score: number; ms: number; first: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(performance.now() - (restored?.ms ?? 0));
  const voiced = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let last = 0;
    const off = mic.onFrame((f) => {
      const now = performance.now();
      if (f.voiced && last > 0 && now - last < 60) voiced.current += now - last;
      last = f.voiced ? now : 0;
    });
    return () => {
      off();
      mic.stop();
    };
  }, []);

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
  const optional = task !== undefined && (task.step.t === 'exercise' || task.step.t === 'breath');
  const ready = task === undefined || optional || results[task.i] !== undefined;

  const finish = useCallback(() => {
    const scored = lesson.steps.map((s, i) => ({ s, i })).filter((x) => x.s.t !== 'exercise' && x.s.t !== 'selfcheck' && x.s.t !== 'breath' && isTask(x.s));
    const score = scored.length === 0 ? 1 : scored.reduce((sum, x) => sum + (results[x.i] ?? 0), 0) / scored.length;
    const ms = performance.now() - started.current;
    setBusy(true);
    api
      .lessonDone(lesson.key, Math.round(score * 1000) / 1000, Math.round(ms), Math.round(voiced.current), Math.round((voiced.current / 1000) * 200))
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--sc-line)] px-3 md:px-5">
        <IconButton icon={X} label="Close the lesson" onClick={onExit} />
        <div className="min-w-0 max-w-[300px] leading-tight">
          <div className="sc-label truncate">{unitTitle}</div>
          <div className="truncate text-[14px] font-semibold">{info.title}</div>
        </div>
        <div className="mx-2 flex flex-1 items-center gap-1">
          {pages.map((_, k) => (
            <span key={k} className={cn('h-1 flex-1 rounded-full transition-colors duration-300', finished !== null || k < page ? 'bg-[var(--sc-ink)]' : k === page ? 'bg-[var(--sc-ink-2)] opacity-60' : 'bg-[var(--sc-line)]')} />
          ))}
        </div>
        <span className="sc-mono sc-num hidden text-[12px] text-[var(--sc-muted)] sm:block">{info.minutes} min</span>
      </header>

      <div ref={scroller} className="sc-scroll min-h-0 flex-1 overflow-y-auto">
        {finished !== null ? (
          <Done info={info} score={finished.score} ms={finished.ms} next={next} onNext={() => next !== null && onOpen(next.key)} onBack={onExit} onAgain={() => (setFinished(null), setResults({}), setPage(0), (started.current = performance.now()))} />
        ) : (
          <div key={page} className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-6 px-5 py-8 md:px-8">
            {cur.map(({ step, i }, k) => (
              <div key={i} className="sc-rise" style={{ animationDelay: `${Math.min(k, 4) * 70}ms` }}>
                <StepView step={step} index={i} lessonKey={lesson.key} page={page} skills={skills} result={results[i]} onResult={(v) => setResult(i, v)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {finished === null && (
        <footer className="flex h-[60px] shrink-0 items-center gap-2 border-t border-[var(--sc-line)] bg-[var(--sc-panel)] px-4 md:px-6">
          <Button variant="ghost" icon={ArrowLeft} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Back
          </Button>
          <div className="flex-1" />
          {optional && task !== undefined && results[task.i] === undefined && <span className="hidden text-[12px] text-[var(--sc-muted)] sm:block">Optional</span>}
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
        <div className="flex gap-3 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-sunk)] px-4 py-3">
          <Lightbulb size={16} strokeWidth={1.9} aria-hidden className="mt-1 shrink-0 text-[var(--sc-warn)]" />
          <Prose md={step.md} className="text-[13.5px]" />
        </div>
      );
    case 'figure':
      return (
        <Pic caption={step.caption}>
          <div className="rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-3 py-3">
            <Diagram fig={step.fig} />
          </div>
        </Pic>
      );
    case 'staff':
      return (
        <Pic caption={step.caption} sound={step.sound}>
          <Staff pic={step.staff} scale={1.35} />
        </Pic>
      );
    case 'sound':
      return (
        <div className="flex items-center gap-3 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-4 py-3">
          <SoundButton sound={step.sound} label={step.label} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">{step.label}</div>
            {step.caption !== undefined && <div className="text-[12px] text-[var(--sc-muted)]">{step.caption}</div>}
          </div>
        </div>
      );
    case 'dial':
      return (
        <Pic caption={step.caption}>
          <div className="rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-3 py-2">
            <DialPicture target={step.target} marks={step.marks} />
          </div>
        </Pic>
      );
    case 'score':
      return (
        <Pic caption={step.caption}>
          <Score
            abc={step.abc}
            actions={
              step.practice === true ? (
                <Button size="sm" icon={Music2} onClick={() => navigate('practice', { ex: `${lessonKey}.${index}`, back: `learn?lesson=${lessonKey}&page=${page}` })}>
                  Sing it in practice
                </Button>
              ) : undefined
            }
          />
        </Pic>
      );
    case 'sing':
      return (
        <Task title={step.prompt} done={result !== undefined}>
          <SingTask notes={step.notes} mode={step.mode ?? 'order'} hold={step.hold} fit={step.fit} exact={step.exact} vowel={step.vowel} done={result !== undefined} onResult={(v) => onResult(v)} />
        </Task>
      );
    case 'speak':
      return (
        <Task title={step.prompt} done={result !== undefined}>
          <SpeakTask rhythm={step.rhythm} bpm={step.bpm} meter={step.meter} done={result !== undefined} onResult={onResult} />
        </Task>
      );
    case 'breath':
      return (
        <Task title={step.prompt} done={result !== undefined}>
          <BreathTask inhale={step.inhale} suspend={step.suspend} exhale={step.exhale} cycles={step.cycles} sound={step.sound} done={result !== undefined} onResult={onResult} />
        </Task>
      );
    case 'choose':
      return <ChooseStep step={step} onResult={onResult} />;
    case 'selfcheck':
      return (
        <Task title={step.prompt} done={result !== undefined}>
          <SelfCheck items={step.items} done={result !== undefined} onResult={onResult} />
        </Task>
      );
    case 'drill': {
      const sk = skills.find((s) => s.key === step.skill);
      if (sk === undefined) return <div />;
      return (
        <Task title={sk.title} done={result !== undefined}>
          {result === undefined ? (
            <Drill skill={sk} count={step.items} embedded onFinish={(r) => onResult(r.accuracy)} />
          ) : (
            <div className="sc-rise flex items-center justify-center gap-2 py-3 text-[14px] font-semibold">
              <Check size={16} className="text-[var(--sc-voice)]" aria-hidden /> {Math.round(result * 100)}%
            </div>
          )}
        </Task>
      );
    }
    case 'exercise':
      return (
        <Task title={step.label} done={result !== undefined}>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--sc-ink-2)]">Sung in the practice screen, moved into your range, with the voice dial and the pitch lane. Come back here when you are done.</p>
            <Button variant="primary" icon={Mic} onClick={() => navigate('practice', { gen: specKey(step.spec), back: `learn?lesson=${lessonKey}&page=${page}&step=${index}` })}>
              {result !== undefined ? 'Sing again' : 'Sing it'}
            </Button>
          </div>
        </Task>
      );
  }
}

function Pic({ caption, sound, children }: { caption?: string | undefined; sound?: Sound | undefined; children: React.ReactNode }): React.JSX.Element {
  return (
    <figure className="flex flex-col items-center gap-2.5">
      <div className="w-full">{children}</div>
      {(caption !== undefined || sound !== undefined) && (
        <figcaption className="flex items-center gap-2.5 text-[12.5px] text-[var(--sc-muted)]">
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
    <section className={cn('rounded-[calc(var(--sc-radius)*1.25)] border bg-[var(--sc-panel)] px-4 pb-4 pt-3.5 transition-colors duration-300 md:px-5', done ? 'border-[color-mix(in_srgb,var(--sc-voice),transparent_55%)]' : 'border-[var(--sc-line)]')}>
      <div className="mb-3.5 flex items-center gap-2">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300', done ? 'bg-[var(--sc-voice)] text-white' : 'border border-[var(--sc-line-2)] text-transparent')}>
          <Check size={12} strokeWidth={3} aria-hidden />
        </span>
        <h3 className="text-[14.5px] font-semibold leading-snug">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function ChooseStep({ step, onResult }: { step: Extract<Step, { t: 'choose' }>; onResult: (v: number) => void }): React.JSX.Element {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <Task title={step.prompt} done={chosen !== null}>
      <div className="flex flex-col items-center gap-4">
        {(step.staff !== undefined || step.sound !== undefined || step.figure !== undefined) && (
          <div className="flex w-full flex-col items-center gap-3">
            {step.figure !== undefined && <Diagram fig={step.figure} />}
            {step.staff !== undefined && <Staff pic={step.staff} scale={1.3} />}
            {step.sound !== undefined && <SoundButton sound={step.sound} size={step.staff === undefined ? 'lg' : 'md'} label="Hear it" />}
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
        {chosen !== null && step.explain !== undefined && <div className="sc-rise w-full text-[13px] leading-5 text-[var(--sc-ink-2)]">{step.explain}</div>}
      </div>
    </Task>
  );
}

/* ---------------------------------------------------------------- the end */

function Done({ info, score, ms, next, onNext, onBack, onAgain }: { info: LessonInfo; score: number; ms: number; next: LessonInfo | null; onNext: () => void; onBack: () => void; onAgain: () => void }): React.JSX.Element {
  const pct = Math.round(score * 100);
  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-5 px-6 pt-[12vh] text-center">
      <span className="sc-pop flex size-16 items-center justify-center rounded-full bg-[var(--sc-ink)] text-[var(--sc-page)]">
        <Check size={30} strokeWidth={2.6} aria-hidden />
      </span>
      <div>
        <div className="text-[19px] font-semibold tracking-[-0.01em]">{info.title}</div>
        <div className="sc-label mt-1">Lesson complete</div>
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        <div className="rounded-[var(--sc-radius)] bg-[var(--sc-sunk)] px-3 py-2.5">
          <div className="sc-label text-[9.5px]">Right first time</div>
          <div className="sc-mono sc-num mt-0.5 text-[22px] font-medium">
            <CountUp value={pct} />%
          </div>
        </div>
        <div className="rounded-[var(--sc-radius)] bg-[var(--sc-sunk)] px-3 py-2.5">
          <div className="sc-label text-[9.5px]">Time</div>
          <div className="sc-mono sc-num mt-0.5 text-[22px] font-medium">{clock(ms / 1000)}</div>
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

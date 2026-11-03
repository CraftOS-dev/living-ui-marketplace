/**
 * The practice screen: the song's bars on top, the falling notes (or the
 * sheet) in the middle, the keys at the bottom, and one big button.
 *
 *   Listen  the app plays it          Learn  it waits for each right note
 *   Play    in time; every note is judged and each pass is saved
 *
 * A pass that ends saves a run: the server moves the sections it covered
 * through their stages and suggests the next tempo. With a plan block open,
 * practice time counts toward it and the next block follows.
 *
 * The deck shows the bar, beat, time, tempo, the chord sounding and the
 * sustain pedal; chord names and the pedal also show on the falling notes
 * and the sheet (both can be switched off in the options).
 *
 * The same screen plays generated exercises (?gen=: scales, arpeggios,
 * chords, progressions, rhythm, sight-reading), whose passes move a skill
 * instead of a song, and a lesson's examples (?ex=lesson.step).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, Sparkle, Check, FileMusic, Footprints, Headphones, Library, Minus, Piano, Play, Plus, Repeat, Send, Shuffle, SlidersHorizontal, Square, Timer } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { openBlock } from '../App.tsx';
import { CountUp, Ring, useWidth } from '../components/charts.tsx';
import { INPUTS, InputCards, InputStatus, useInputState } from '../components/InputSetup.tsx';
import { BarStrip } from '../components/practice/BarStrip.tsx';
import type { BarStripHandle } from '../components/practice/BarStrip.tsx';
import { Keyboard } from '../components/practice/Keyboard.tsx';
import type { KeyboardHandle } from '../components/practice/Keyboard.tsx';
import { SheetView } from '../components/practice/SheetView.tsx';
import type { SheetHandle } from '../components/practice/SheetView.tsx';
import { Button, Empty, IconButton, Kbd, MenuButton, Popover, Row, Segmented, Spinner, StageDots, Textarea, Toggle, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { STAGE_LABEL, bars as barsText, clock, pad2 } from '../lib/format.ts';
import { navigate, setQuery, useRoute } from '../lib/router.ts';
import type { DrillSaved, Hands, Mode, Model, Plan, RunResult, SavedRun, SectionInfo, Song, Stage } from '../lib/types.ts';
import { loadContent } from '../learn/LessonPlayer.tsx';
import { decodeSpec, encodeSpec, generate } from '../music/generate.ts';
import type { Generated, Spec } from '../music/generate.ts';
import { Engine } from '../music/engine.ts';
import type { PassResult } from '../music/engine.ts';
import { input } from '../music/input.ts';
import { fitRange, layout as keyLayout } from '../music/keys.ts';
import { chordAt, chordTrack, pedalAt } from '../music/harmony.ts';
import type { ChordSpan } from '../music/harmony.ts';
import { Roll } from '../music/roll.ts';

const MODES: { value: Mode; label: string; icon: LucideIcon }[] = [
  { value: 'listen', label: 'Listen', icon: Headphones },
  { value: 'learn', label: 'Learn', icon: Footprints },
  { value: 'play', label: 'Play', icon: Play },
];

/** A practice-screen preference kept in this browser (a convenience). */
function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === '1';
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setV(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* a convenience */
      }
    },
    [key],
  );
  return [v, set];
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** A generated exercise or a lesson example dressed as a song for the practice screen. */
export interface Exercise {
  spec: Spec | null;
  gen: Generated | null;
  back: string | null;
}

function asSong(id: string, title: string, model: Model, r: Awaited<ReturnType<typeof api.parse>>): Song {
  const sections: SectionInfo[] = r.sections.map((x, i) => ({ i, name: x.name, from: x.from, to: x.to, stage: 'new', best: 0, next: 100, acc: null, due: '', last: '', tries: 0 }));
  return {
    id,
    title,
    composer: '',
    level: r.summary.level,
    kind: 'exercise',
    bars: r.summary.bars,
    tempo: r.summary.tempo,
    seconds: r.summary.seconds,
    key: r.summary.key,
    meter: r.summary.meter,
    hands: r.summary.hands,
    range: r.summary.range,
    notes: r.summary.notes,
    source: 'you',
    tags: [],
    fav: false,
    seen: true,
    archived: false,
    note: '',
    note_at: '',
    created: '',
    status: 'new',
    progress: { pct: 0, last_at: '', runs: 0, minutes: 0, counts: { new: sections.length, learning: 0, steady: 0, mastered: 0 }, due: 0 },
    sections,
    model,
  };
}

export function PracticePage(): React.JSX.Element {
  const app = useApp();
  const { query } = useRoute();
  const genText = query.get('gen');
  const exText = query.get('ex');
  const songId = genText !== null || exText !== null ? '' : query.get('song') ?? app.settings?.last_song ?? '';
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);

  // A generated exercise or a lesson's example.
  useEffect(() => {
    if (genText === null && exText === null) return;
    let alive = true;
    setSong(null);
    setError(null);
    const back = query.get('back');
    const load = async (): Promise<void> => {
      if (genText !== null) {
        const spec = decodeSpec(genText);
        if (spec === null) throw new Error('This exercise link is broken');
        const gen = generate(spec);
        const r = await api.parse(gen.abc);
        if (!alive) return;
        setExercise({ spec, gen, back });
        setSong(asSong('gen', gen.title, r.model, r));
        return;
      }
      const [lessonKey = '', idx = '0'] = (exText ?? '').split('.');
      const content = await loadContent();
      const step = content[lessonKey]?.steps[Number(idx)];
      if (step === undefined || step.t !== 'score') throw new Error('This example could not be found');
      const r = await api.parse(step.abc);
      if (!alive) return;
      setExercise({ spec: null, gen: null, back });
      setSong(asSong('ex', r.summary.title || 'Example', r.model, r));
    };
    load().catch((err: unknown) => alive && setError(errMessage(err)));
    return () => {
      alive = false;
    };
    // Loaded once per link (the page remounts for a new one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genText, exText]);

  useEffect(() => {
    if (songId === '') return;
    let alive = true;
    setSong(null);
    setError(null);
    api
      .openSong(songId)
      .then((r) => alive && setSong(r.song))
      .catch((err: unknown) => alive && setError(errMessage(err)));
    return () => {
      alive = false;
    };
  }, [songId]);

  if (songId === '' && genText === null && exText === null)
    return (
      <div className="flex h-full flex-col">
        <div className="px-4 pt-3 md:hidden">
          <MenuButton />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Empty icon={Piano} title="Pick a song to practise" action={<Button variant="primary" icon={Library} onClick={() => navigate('library')}>Open the library</Button>} />
        </div>
      </div>
    );
  if (error !== null)
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={Piano} title="This song could not be opened" action={<Button onClick={() => navigate('library')}>Back to the library</Button>}>
          {error}
        </Empty>
      </div>
    );
  if (song === null || song.model === undefined || app.settings === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--pc-muted)]">
        <Spinner size={18} />
      </div>
    );
  return <Workspace song={song} setSong={setSong} exercise={exercise} />;
}

interface Live {
  hits: number;
  judged: number;
  streak: number;
}

function Workspace({ song, setSong, exercise }: { song: Song; setSong: (s: Song | ((p: Song | null) => Song | null)) => void; exercise: Exercise | null }): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  const { query } = useRoute();
  const model = song.model!;
  const gen = exercise?.gen ?? null;
  const reading = gen !== null && (gen.sight === true || gen.drill === 'rhythm');
  const first = model.bars[0]?.n ?? 0;
  const last = model.bars[model.bars.length - 1]?.n ?? 0;
  useInputState();

  const qn = (k: string): number | null => {
    const v = query.get(k);
    return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const initialFrom = Math.max(first, Math.min(last, qn('from') ?? first));
  const initialTo = Math.max(initialFrom, Math.min(last, qn('to') ?? last));
  const sectionFor = (a: number, b: number) => song.sections.find((x) => x.from === a && x.to === b);
  const initialMode = (['listen', 'learn', 'play'] as Mode[]).includes(query.get('mode') as Mode) ? (query.get('mode') as Mode) : gen !== null ? gen.mode : song.status === 'new' ? 'learn' : 'play';
  const playTempo = (a: number, b: number): number => {
    const sec = sectionFor(a, b);
    if (sec !== undefined) return sec.next;
    const inside = song.sections.filter((x) => x.from >= a && x.to <= b);
    return inside.length > 0 ? Math.min(100, Math.min(...inside.map((x) => x.next))) : 100;
  };

  const [mode, setMode] = useState<Mode>(initialMode);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [hands, setHands] = useState<Hands>((['both', 'right', 'left'] as Hands[]).includes(query.get('hands') as Hands) ? (query.get('hands') as Hands) : song.hands === 'both' ? 'both' : song.hands);
  const [tempo, setTempo] = useState<number>(qn('tempo') ?? (gen !== null ? gen.tempo : initialMode === 'play' ? playTempo(initialFrom, initialTo) : 100));
  const [loop, setLoop] = useState<boolean>(!(initialFrom === first && initialTo === last));
  const [view, setView] = useState<'roll' | 'sheet'>(reading ? 'sheet' : s.view);
  const [drill, setDrill] = useState<DrillSaved | null>(null);
  const [run, setRun] = useState<'idle' | 'countin' | 'running' | 'done'>('idle');
  const [count, setCount] = useState<{ beat: number; of: number } | null>(null);
  const [result, setResult] = useState<PassResult | null>(null);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const [passes, setPasses] = useState<{ clean: boolean; acc: number }[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [blockMs, setBlockMs] = useState(0);
  const [errBars, setErrBars] = useState<Map<number, number>>(new Map());
  const blockNo = qn('block');

  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const rollRef = useRef<Roll | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetRef = useRef<SheetHandle | null>(null);
  const kbRef = useRef<KeyboardHandle | null>(null);
  const stripRef = useRef<BarStripHandle | null>(null);
  const hudBar = useRef<HTMLSpanElement | null>(null);
  const hudBeat = useRef<HTMLSpanElement | null>(null);
  const hudAcc = useRef<HTMLSpanElement | null>(null);
  const hudStreak = useRef<HTMLSpanElement | null>(null);
  const hudTime = useRef<HTMLSpanElement | null>(null);
  const hudChord = useRef<HTMLSpanElement | null>(null);
  const hudPed = useRef<HTMLSpanElement | null>(null);
  const [showChords, setShowChords] = usePref('pc.chords', true);
  const [showPedal, setShowPedal] = usePref('pc.pedal', true);
  // Exercises (scales, five-finger, Hanon) have no harmony to name.
  const chords = useMemo<ChordSpan[]>(() => (song.kind === 'exercise' ? [] : chordTrack(model)), [model, song.kind]);
  const chordsRef = useRef(chords);
  chordsRef.current = showChords ? chords : [];
  const hasPedal = (model.pedal?.length ?? 0) > 0;
  const pedalRef = useRef(showPedal);
  pedalRef.current = showPedal;
  const live = useRef<Live>({ hits: 0, judged: 0, streak: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const blockRef = useRef(0);
  const played = useRef(false);

  // Natural key proportions: a wider screen shows more keys, not wider keys.
  const [stageRef, stageWidth] = useWidth<HTMLDivElement>();
  const span = useMemo(() => {
    let lo = 127;
    let hi = 0;
    for (const n of model.notes) {
      lo = Math.min(lo, n[2]);
      hi = Math.max(hi, n[2]);
    }
    return { lo, hi };
  }, [model]);
  const fitW = stageWidth > 0 ? stageWidth : typeof window !== 'undefined' ? window.innerWidth - 60 : 1200;
  const [keyLo, keyHi] = fitRange(span.lo, span.hi, fitW, fitW < 640 ? 26 : 30);
  const keys = useMemo(() => keyLayout(keyLo, keyHi), [keyLo, keyHi]);

  const cfg = useMemo(
    () => ({ mode, from: range.from, to: range.to, hands, tempo, loop, metronome: s.metronome || gen?.drill === 'rhythm', countIn: s.count_in || reading, otherHand: s.other_hand, strictness: s.strictness, latencyMs: s.latency_ms, mic: s.input === 'mic', anyPitch: gen?.anyPitch === true }),
    [mode, range.from, range.to, hands, tempo, loop, s.metronome, s.count_in, s.other_hand, s.strictness, s.latency_ms, s.input, gen, reading],
  );

  /* ------------------------------------------------------------ engine */

  const savePass = useCallback(
    (r: PassResult) => {
      if (!r.complete && r.durationMs < 1500) return;
      blockRef.current += r.durationMs;
      if (r.mode !== 'listen') played.current = true;
      setBlockMs(blockRef.current);
      if (r.mode !== 'listen') {
        setPasses((p) => [...p.slice(-11), { clean: r.clean, acc: r.accuracy }]);
        setResult(r);
        const eb = new Map<number, number>();
        for (const row of r.perBar) if ((row[3] ?? 0) + (row[4] ?? 0) > 0) eb.set(row[0] ?? 0, (row[3] ?? 0) + (row[4] ?? 0));
        setErrBars(eb);
      }
      if (exercise !== null) {
        // Exercises move a skill; a lesson's example is just practice.
        if (gen === null || r.mode === 'listen') return;
        api
          .saveDrill({ drill: gen.drill, skill: gen.skill, items: r.expected, correct: r.hits, accuracy: r.accuracy, tempo_pct: r.tempo, duration_ms: r.durationMs, complete: r.complete, level: gen.level, mode: r.mode, detail: { id: gen.id, title: gen.title } })
          .then((res) => {
            setDrill(res);
            if (res.level_up > 0) toast.success(`Level ${res.level_up} reached`);
          })
          .catch((err: unknown) => toast.error(errMessage(err)));
        return;
      }
      api
        .saveRun({
          song: song.id,
          mode: r.mode,
          from_bar: r.from,
          to_bar: r.to,
          hands: r.hands,
          tempo_pct: r.tempo,
          duration_ms: r.durationMs,
          expected: r.expected,
          hits: r.hits,
          wrong: r.wrong,
          missed: r.missed,
          timing_mad: r.mad ?? undefined,
          timing_bias: r.bias ?? undefined,
          complete: r.complete,
          per_bar: r.perBar,
        })
        .then((res) => {
          setSong((prev) => (prev === null ? prev : { ...prev, sections: res.song.sections, progress: res.song.progress, status: res.song.status }));
          if (r.mode !== 'listen') setSaved(res);
          if (res.level_up > 0) toast.success(`Level ${res.level_up} reached`);
        })
        .catch((err: unknown) => toast.error(errMessage(err)));
    },
    [song.id, setSong, exercise, gen],
  );

  useEffect(() => {
    const e = new Engine(model, cfg);
    engineRef.current = e;
    setEngine(e);
    const off = e.on((ev) => {
      if (ev.type === 'hit') {
        kbRef.current?.hit(ev.midi, ev.hand);
        rollRef.current?.burst(ev.midi, ev.hand);
        live.current.hits += 1;
        live.current.judged += 1;
        live.current.streak += 1;
      } else if (ev.type === 'wrong' || ev.type === 'miss') {
        live.current.streak = 0;
        if (ev.type === 'miss') live.current.judged += 1;
      } else if (ev.type === 'count') setCount({ beat: ev.beat, of: ev.of });
      else if (ev.type === 'state') {
        setRun(e.state);
        if (e.state !== 'countin') setCount(null);
      } else if (ev.type === 'pass') {
        live.current = { hits: 0, judged: 0, streak: 0 };
        savePass(ev.result);
      }
    });
    if (canvasRef.current !== null) {
      const r = new Roll(canvasRef.current, e, keys);
      r.showNames = s.note_names;
      r.chords = chordsRef.current;
      r.showPedal = pedalRef.current;
      r.resize();
      rollRef.current = r;
    }
    const offInput = input.on((n) => e.input(n));
    return () => {
      off();
      offInput();
      e.dispose();
      engineRef.current = null;
      rollRef.current = null;
      setEngine(null);
    };
    // The engine is rebuilt only for a new song; settings flow through configure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    engineRef.current?.configure(cfg);
    live.current = { hits: 0, judged: 0, streak: 0 };
  }, [cfg]);

  useEffect(() => {
    if (rollRef.current !== null) rollRef.current.showNames = s.note_names;
  }, [s.note_names]);

  useEffect(() => {
    if (rollRef.current === null) return;
    rollRef.current.chords = showChords ? chords : [];
    rollRef.current.showPedal = showPedal;
  }, [showChords, showPedal, chords]);

  // The canvas follows its box and the theme.
  useEffect(() => {
    const c = canvasRef.current;
    if (c === null) return;
    const ro = new ResizeObserver(() => rollRef.current?.resize());
    ro.observe(c);
    const mo = new MutationObserver(() => rollRef.current?.refreshColors());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [view]);

  // Re-create the roll when the canvas comes back (view switch).
  useEffect(() => {
    const e = engineRef.current;
    if (view === 'roll' && canvasRef.current !== null && e !== null) {
      const r = new Roll(canvasRef.current, e, keys);
      r.showNames = s.note_names;
      r.chords = chordsRef.current;
      r.showPedal = pedalRef.current;
      r.resize();
      rollRef.current = r;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, keys]);

  // One loop draws everything.
  useEffect(() => {
    let raf = 0;
    let lastBar = '';
    let lastTime = '';
    let lastChord = '';
    let lastPed = '';
    const tick = (now: number): void => {
      const e = engineRef.current;
      if (e !== null) {
        e.frame(now);
        if (viewRef.current === 'roll') rollRef.current?.draw(now);
        else sheetRef.current?.update(now);
        kbRef.current?.update(now, e.cues(), e.wrongs);
        stripRef.current?.setPos(e.pos);
        const w = e.where();
        const bar = pad2(w.bar) + '|' + w.beat;
        if (bar !== lastBar) {
          lastBar = bar;
          if (hudBar.current !== null) hudBar.current.textContent = pad2(w.bar);
          if (hudBeat.current !== null) hudBeat.current.textContent = String(w.beat);
        }
        const L = live.current;
        if (hudAcc.current !== null) hudAcc.current.textContent = L.judged > 0 ? `${Math.round((L.hits / L.judged) * 100)}%` : '—';
        if (hudStreak.current !== null) hudStreak.current.textContent = String(L.streak);
        // Time into the song and its length, at the tempo set.
        const t0 = e.model.bars[0]?.t ?? 0;
        const time = `${clock((Math.max(0, e.pos - t0) * e.msPerQ) / 1000)} / ${clock(((e.model.total - t0) * e.msPerQ) / 1000)}`;
        if (time !== lastTime && hudTime.current !== null) {
          lastTime = time;
          hudTime.current.textContent = time;
        }
        const c = chordAt(chordsRef.current, e.pos)?.sym ?? '—';
        if (c !== lastChord && hudChord.current !== null) {
          lastChord = c;
          hudChord.current.textContent = c;
        }
        const ped = (pedalRef.current && pedalAt(e.model.pedal, e.pos, 200 / e.msPerQ) ? 'down' : 'up') + (input.sustain ? '|you' : '');
        if (ped !== lastPed && hudPed.current !== null) {
          lastPed = ped;
          hudPed.current.dataset['state'] = ped;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------------------------------------------------- input on arrival */

  useEffect(() => {
    if (s.input === 'midi' && input.midiStatus === 'idle') void input.connectMidi(s.midi_device);
    if (s.input === 'mic' && input.mic.status === 'off') void input.startMic();
    return () => {
      if (input.mic.status === 'on') input.stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.input]);

  /* ----------------------------------------------------------- the plan */

  useEffect(() => {
    if (blockNo === null) return;
    void api
      .plan()
      .then((r) => setPlan(r.plan))
      .catch(() => undefined);
  }, [blockNo]);
  const block = plan?.blocks.find((b) => b.i === blockNo) ?? null;
  const blockLeft = block === null ? 0 : Math.max(0, block.minutes * 60000 - blockMs);
  const nextBlock = plan?.blocks.find((b) => !b.done && b.i !== blockNo) ?? null;
  useEffect(() => {
    if (block === null || block.done || blockLeft > 0) return;
    void api
      .planDone(block.i)
      .then((r) => setPlan(r.plan))
      .catch(() => undefined);
  }, [block, blockLeft]);
  const goNext = (): void => {
    engineRef.current?.stop(true);
    if (nextBlock !== null) openBlock(nextBlock);
    else navigate('today');
  };

  /* ------------------------------------------------- tell the coach where */

  useEffect(() => {
    const ex = exercise !== null;
    const t = window.setTimeout(() => void api.reportUi({ view: ex ? 'exercise' : 'practice', song: ex ? undefined : song.id, title: ex ? song.title : undefined, skill: gen?.skill, from: range.from, to: range.to, mode, hands, tempo }).catch(() => undefined), 1200);
    const where = { from: range.from === first ? undefined : range.from, to: range.to === last ? undefined : range.to, mode, tempo, hands: hands === 'both' ? undefined : hands, block: blockNo ?? undefined };
    if (ex) setQuery('practice', { gen: query.get('gen') ?? undefined, ex: query.get('ex') ?? undefined, back: exercise.back ?? undefined, ...where });
    else setQuery('practice', { song: song.id, ...where });
    return () => window.clearTimeout(t);
    // The query is read for the exercise link only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, range.from, range.to, mode, hands, tempo, first, last, blockNo, exercise]);

  const fromLesson = exercise?.back?.startsWith('learn') === true;
  const leave = (): void => {
    engineRef.current?.stop(false);
    // Back to the lesson page it came from; a pass played there completes that step.
    if (exercise?.back !== null && exercise?.back !== undefined && exercise.back !== '') window.location.hash = '#/' + exercise.back + (fromLesson && played.current ? '&done=1' : '');
    else if (exercise !== null) navigate('train');
    else navigate('library');
  };
  const another = (): void => {
    if (exercise?.spec === null || exercise?.spec === undefined) return;
    const sp = exercise.spec;
    const seed = Math.floor(Math.random() * 100000);
    const nextSpec: Spec = sp.k === 'sight' ? { ...sp, level: drill !== null && drill.sight_level > 0 ? drill.sight_level : sp.level, seed } : sp.k === 'rhythm' ? { ...sp, seed } : sp;
    navigate('practice', { gen: encodeSpec(nextSpec), back: exercise.back ?? undefined, block: blockNo ?? undefined });
  };

  /* -------------------------------------------------------------- keys */

  const chooseRange = useCallback(
    (a: number, b: number, lp: boolean) => {
      setRange({ from: a, to: b });
      setLoop(lp);
      setResult(null);
      setSaved(null);
      setPasses([]);
      if (mode === 'play') setTempo(playTempo(a, b));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, song.sections],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      const eng = engineRef.current;
      if (eng === null) return;
      if (e.code === 'Space') {
        e.preventDefault();
        eng.toggle();
      } else if (e.key === 'Escape') eng.stop(true);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setTempo((t) => Math.max(30, Math.min(150, t + (e.key === 'ArrowUp' ? 5 : -5))));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const secs = song.sections;
        if (secs.length === 0) return;
        const cur = secs.findIndex((x) => x.from === range.from && x.to === range.to);
        const next = cur < 0 ? (e.key === 'ArrowRight' ? 0 : secs.length - 1) : Math.max(0, Math.min(secs.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
        const sec = secs[next];
        if (sec !== undefined) chooseRange(sec.from, sec.to, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [song.sections, range, chooseRange]);

  /* ------------------------------------------------------------ render */

  const running = run === 'running' || run === 'countin';
  const bpm = Math.round((model.tempo * tempo) / 100 / (model.beat || 1));
  const changes = (saved?.results ?? []).filter((x) => x.before !== x.after && x.after !== 'learning');

  return (
    <div ref={stageRef} className="flex h-full min-h-0 flex-col">
      {/* Header: the song and how to practise it */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-[var(--pc-line)] bg-[var(--pc-page)] px-3 py-2">
        <MenuButton />
        <IconButton icon={ArrowLeft} label={fromLesson ? 'Back to the lesson' : exercise !== null ? 'Back' : 'Library'} onClick={leave} />
        <div className="mr-2 min-w-0 max-w-[340px] flex-1 leading-tight">
          <div className="truncate text-[14px] font-semibold">{song.title}</div>
          <div className="pc-label truncate">{[gen !== null ? (gen.sight === true ? `Sight-reading · level ${gen.level ?? 1}` : gen.drill === 'rhythm' ? 'Rhythm' : 'Exercise') : song.composer, song.key, song.meter].filter(Boolean).join(' · ')}</div>
        </div>
        <Segmented value={mode} onChange={(m) => (setMode(m), setResult(null), setSaved(null), setPasses([]), m === 'play' && setTempo(playTempo(range.from, range.to)))} options={MODES} label="Mode" />
        <HandsControl value={hands} onChange={setHands} songHands={song.hands} />
        <TempoControl tempo={tempo} onChange={setTempo} />
        <IconButton icon={Repeat} label={loop ? 'Loop on' : 'Loop off'} active={loop} onClick={() => setLoop((l) => !l)} />
        <IconButton icon={Timer} label={s.metronome ? 'Metronome on' : 'Metronome off'} active={s.metronome} onClick={() => app.save({ metronome: !s.metronome })} />
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            if (exercise === null) app.save({ view: v });
          }}
          options={[
            { value: 'roll', label: '', icon: Piano, title: 'Falling notes' },
            { value: 'sheet', label: '', icon: FileMusic, title: 'Sheet music' },
          ]}
          label="View"
          size="sm"
        />
        <MoreMenu chords={showChords} onChords={setShowChords} pedal={showPedal} onPedal={setShowPedal} />
        <InputChip />
      </header>

      <BarStrip ref={stripRef} model={model} sections={song.sections} from={range.from} to={range.to} onRange={chooseRange} errors={errBars} />

      {/* Stage */}
      <div className="pc-grid relative min-h-[180px] flex-1 overflow-hidden bg-[var(--pc-page)]">
        {view === 'roll' ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" /> : <SheetView ref={sheetRef} model={model} engine={engine} chords={showChords && chords.length > 0 ? chords : null} pedal={showPedal} />}

        {/* Count-in */}
        {count !== null && run === 'countin' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span key={count.beat} className="pc-pop pc-mono text-[88px] font-light leading-none text-[var(--pc-ink)] opacity-80">
              {count.beat}
            </span>
          </div>
        )}

        {/* The pass just played */}
        {result !== null && !running && (
          <ResultCard
            result={result}
            changes={changes}
            saved={saved}
            onAgain={() => engineRef.current?.start()}
            onTempo={(t) => (setTempo(t), setResult(null))}
            onPlay={(t) => (setMode('play'), setTempo(t), setResult(null))}
            sectionNext={exercise !== null ? Math.max(tempo, 60) : sectionFor(range.from, range.to)?.next ?? tempo}
            drill={gen !== null ? drill : null}
            onAnother={exercise?.spec !== null && exercise?.spec !== undefined && (exercise.spec.k === 'sight' || exercise.spec.k === 'rhythm') ? another : undefined}
            onLesson={fromLesson ? leave : undefined}
          />
        )}
        {result !== null && running && result.mode !== 'listen' && loop && <LoopToast result={result} changes={changes} />}
      </div>

      {/* The deck: where you are, the button, how the passes went */}
      <div className="relative flex h-[58px] shrink-0 items-center gap-3 border-t border-[var(--pc-line)] bg-[var(--pc-panel)] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-5">
          <Readout label="Bar">
            <span ref={hudBar}>00</span>
          </Readout>
          <Readout label="Beat">
            <span ref={hudBeat}>1</span>
          </Readout>
          <span className="hidden sm:flex">
            <Readout label="Time">
              <span ref={hudTime} className="text-[14px]">
                0:00 / 0:00
              </span>
            </Readout>
          </span>
          <Readout label={model.beat === 1.5 ? '♩. /min' : model.beat === 0.5 ? '♪ /min' : '♩ /min'}>{bpm}</Readout>
          {showChords && chords.length > 0 && (
            <span className="hidden min-w-[64px] md:flex">
              <Readout label="Chord">
                <span ref={hudChord} className="inline-block font-semibold" style={{ fontFamily: 'var(--pc-font)' }}>
                  —
                </span>
              </Readout>
            </span>
          )}
          {showPedal && hasPedal && (
            <span className="hidden md:flex" title="Sustain pedal: dark when the music asks for it; a blue ring when your pedal is down">
              <Readout label="Ped">
                <span ref={hudPed} data-state="up" className="pc-ped mt-0.5 block" />
              </Readout>
            </span>
          )}
          {mode === 'play' && (
            <span className="hidden items-center gap-5 sm:flex">
              <Readout label="Now">
                <span ref={hudAcc}>—</span>
              </Readout>
              <Readout label="Run">
                <span ref={hudStreak}>0</span>
              </Readout>
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={running ? 'Stop' : 'Start'}
          title={running ? 'Stop (Space)' : 'Start (Space)'}
          onClick={() => engineRef.current?.toggle()}
          className={cn('pc-focus absolute left-1/2 top-1/2 flex size-[46px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-[var(--pc-shadow-lg)] transition-[transform,background-color] duration-200 hover:scale-[1.05] active:scale-95', running ? 'bg-[var(--pc-raised)] text-[var(--pc-ink)] ring-1 ring-[var(--pc-line-2)]' : 'bg-[var(--pc-ink)] text-[var(--pc-page)]')}
        >
          {running ? <Square size={15} fill="currentColor" aria-hidden /> : <Play size={18} fill="currentColor" className="ml-0.5" aria-hidden />}
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
          {passes.length > 0 && (
            <span className="hidden items-center gap-1 lg:flex" title="Passes: filled = clean">
              {passes.map((p, i) => (
                <span key={i} title={`${Math.round(p.acc * 100)}%`} className={cn('pc-pop size-2 rounded-full border', p.clean ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)]' : 'border-[var(--pc-ink-2)] bg-transparent')} />
              ))}
            </span>
          )}
          {block !== null && (
            <span className="flex items-center gap-2 rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] py-1 pl-1.5 pr-1.5">
              <Ring value={block.minutes > 0 ? 1 - blockLeft / (block.minutes * 60000) : 0} size={24} stroke={2.5} />
              <span className="pc-mono pc-num text-[12px]">
                {(plan?.blocks.findIndex((b) => b.i === block.i) ?? 0) + 1}/{plan?.blocks.length ?? 0} · {blockLeft > 0 ? clock(blockLeft / 1000) : 'done'}
              </span>
              {blockLeft <= 0 && (
                <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={goNext} className="h-6 rounded-full">
                  {nextBlock !== null ? 'Next' : 'Finish'}
                </Button>
              )}
            </span>
          )}
          {exercise === null && <CoachCorner song={song} from={range.from} to={range.to} mode={mode} tempo={tempo} />}
        </div>
      </div>

      <Keyboard ref={kbRef} layout={keys} names={s.note_names} computerKeys={s.input === 'keyboard' && typeof window !== 'undefined' && window.innerWidth >= 768} height={typeof window !== 'undefined' && window.innerWidth < 640 ? 96 : 124} />
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="flex flex-col leading-none">
      <span className="pc-label text-[9px]">{label}</span>
      <span className="pc-mono pc-num mt-1 text-[17px] font-medium tracking-tight text-[var(--pc-ink)]">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------ controls */

function HandsControl({ value, onChange, songHands }: { value: Hands; onChange: (h: Hands) => void; songHands: Hands }): React.JSX.Element {
  const left = value === 'both' || value === 'left';
  const right = value === 'both' || value === 'right';
  const set = (l: boolean, r: boolean): void => {
    if (!l && !r) return;
    onChange(l && r ? 'both' : l ? 'left' : 'right');
  };
  const single = songHands !== 'both';
  return (
    <div role="group" aria-label="Hands" className="inline-flex items-center gap-0.5 rounded-[var(--pc-radius-sm)] border border-[var(--pc-line)] bg-[var(--pc-sunk)] p-0.5">
      {(['L', 'R'] as const).map((h) => {
        const on = h === 'L' ? left : right;
        const disabled = single && ((h === 'L' && songHands === 'right') || (h === 'R' && songHands === 'left'));
        return (
          <button
            key={h}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            title={h === 'L' ? 'Left hand' : 'Right hand'}
            onClick={() => (h === 'L' ? set(!left, right) : set(left, !right))}
            className={cn('pc-focus pc-mono inline-flex h-7 w-8 items-center justify-center rounded-[calc(var(--pc-radius-sm)-2px)] text-[12px] font-semibold transition-colors disabled:opacity-30', on && !disabled ? 'text-[var(--pc-raised)]' : 'text-[var(--pc-muted)] hover:text-[var(--pc-ink)]')}
            style={on && !disabled ? { background: h === 'L' ? 'var(--pc-lh)' : 'var(--pc-rh)' } : undefined}
          >
            {h}
          </button>
        );
      })}
    </div>
  );
}

function TempoControl({ tempo, onChange }: { tempo: number; onChange: (t: number) => void }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const step = (d: number): void => onChange(Math.max(30, Math.min(150, tempo + d)));
  return (
    <div className="inline-flex items-center rounded-[var(--pc-radius-sm)] border border-[var(--pc-line)] bg-[var(--pc-raised)]">
      <IconButton icon={Minus} label="Slower" size={28} onClick={() => step(-5)} />
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title="Tempo" className="pc-focus pc-mono pc-num flex h-7 min-w-[56px] items-center justify-center gap-1.5 px-1 text-[12.5px] hover:bg-[var(--pc-hover)]">
        <span className={cn('font-semibold', tempo === 100 ? 'text-[var(--pc-ink)]' : 'text-[var(--pc-rh)]')}>{tempo}%</span>
      </button>
      <IconButton icon={Plus} label="Faster" size={28} onClick={() => step(5)} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={240} className="p-3">
        <div className="pc-label mb-2 flex justify-between">
          <span>Tempo</span>
          <span className="pc-num">{tempo}%</span>
        </div>
        <input type="range" min={30} max={150} step={5} value={tempo} onChange={(e) => onChange(Number(e.target.value))} className="pc-range w-full" aria-label="Tempo" />
        <div className="mt-2 grid grid-cols-4 gap-1">
          {[50, 75, 90, 100].map((t) => (
            <Button key={t} size="sm" variant={tempo === t ? 'primary' : 'default'} onClick={() => onChange(t)}>
              {t}%
            </Button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--pc-muted)]">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </div>
      </Popover>
    </div>
  );
}

function MoreMenu({ chords, onChords, pedal, onPedal }: { chords: boolean; onChords: (v: boolean) => void; pedal: boolean; onPedal: (v: boolean) => void }): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={anchor} icon={SlidersHorizontal} label="Practice options" onClick={() => setOpen((o) => !o)} active={open} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={270} align="end" className="px-3 py-2">
        <Row label="Count in">
          <Toggle checked={s.count_in} onChange={(v) => app.save({ count_in: v })} label="Count in" />
        </Row>
        <Row label="Other hand plays along">
          <Toggle checked={s.other_hand} onChange={(v) => app.save({ other_hand: v })} label="Other hand plays along" />
        </Row>
        <Row label="Note names">
          <Toggle checked={s.note_names} onChange={(v) => app.save({ note_names: v })} label="Note names" />
        </Row>
        <Row label="Chord names">
          <Toggle checked={chords} onChange={onChords} label="Chord names" />
        </Row>
        <Row label="Pedal">
          <Toggle checked={pedal} onChange={onPedal} label="Pedal" />
        </Row>
        <div className="py-2">
          <div className="mb-1.5 text-[13px]">Strictness</div>
          <Segmented
            value={s.strictness}
            onChange={(v) => app.save({ strictness: v })}
            options={[
              { value: 'lenient', label: 'Easy' },
              { value: 'normal', label: 'Normal' },
              { value: 'strict', label: 'Strict' },
            ]}
            label="Strictness"
            size="sm"
          />
        </div>
      </Popover>
    </>
  );
}

function InputChip(): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  useInputState();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const kind = s.input === '' ? 'screen' : s.input;
  const meta = INPUTS.find((i) => i.value === kind) ?? INPUTS[2]!;
  const ok = kind === 'midi' ? input.midiStatus === 'ready' : kind === 'mic' ? input.mic.status === 'on' : true;
  const label = kind === 'midi' ? (input.midiStatus === 'ready' ? input.deviceName() : 'Not connected') : meta.label;
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} className="pc-focus ml-auto inline-flex h-8 max-w-[200px] items-center gap-2 rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] pl-2.5 pr-3 text-[12px] hover:bg-[var(--pc-hover)]">
        <span className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-[var(--pc-good)]' : 'pc-pulse bg-[var(--pc-warn)]')} />
        <meta.icon size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--pc-muted)]" />
        <span className="truncate">{label}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={420} align="end" className="flex flex-col gap-3 p-3">
        <InputCards value={kind} onChange={(v) => app.save({ input: v })} />
        <InputStatus kind={kind} device={s.midi_device} onDevice={(name) => app.save({ midi_device: name })} />
      </Popover>
    </>
  );
}

/* ------------------------------------------------------------- results */

function timingText(bias: number | null): string {
  if (bias === null) return '';
  if (Math.abs(bias) < 15) return 'On the beat';
  return `${Math.abs(bias)} ms ${bias < 0 ? 'early' : 'late'}`;
}

function StageChanges({ changes }: { changes: RunResult[] }): React.JSX.Element | null {
  if (changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--pc-hair)] pt-2.5">
      {changes.map((c) => (
        <div key={c.i} className="pc-rise flex items-center gap-2.5">
          <StageDots stage={c.after} size={7} />
          <span className="text-[13px] font-semibold">
            {c.name} · {STAGE_LABEL[c.after as Stage]}
          </span>
          <span className="pc-label ml-auto">{barsText(c.from, c.to)}</span>
        </div>
      ))}
    </div>
  );
}

function ResultCard({ result, changes, saved, onAgain, onTempo, onPlay, sectionNext, drill, onAnother, onLesson }: { result: PassResult; changes: RunResult[]; saved: SavedRun | null; onAgain: () => void; onTempo: (t: number) => void; onPlay: (t: number) => void; sectionNext: number; drill?: DrillSaved | null; onAnother?: (() => void) | undefined; onLesson?: (() => void) | undefined }): React.JSX.Element {
  const learn = result.mode === 'learn';
  const pct = Math.round(result.accuracy * 100);
  const sug = saved?.suggestion ?? null;
  const cells = result.perBar;
  return (
    <div className={cn('pc-rise absolute left-1/2 top-[18%] -translate-x-1/2', onLesson !== undefined ? 'w-[min(440px,calc(100%-32px))]' : 'w-[min(380px,calc(100%-32px))]')}>
      <div className="pc-panel flex flex-col gap-3 bg-[var(--pc-raised)] p-4 shadow-[var(--pc-shadow-lg)]">
        <div className="flex items-start gap-4">
          <div>
            <div className="pc-label">{learn ? 'First try' : 'Accuracy'}</div>
            <div className="pc-mono pc-num text-[44px] font-light leading-none tracking-tight">
              <CountUp value={pct} />
              <span className="text-[22px] text-[var(--pc-muted)]">%</span>
            </div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5 pt-1">
            {result.clean && (
              <span className="pc-pop inline-flex h-6 items-center gap-1 rounded-full bg-[var(--pc-ink)] px-2.5 text-[12px] font-semibold text-[var(--pc-page)]">
                <Check size={13} strokeWidth={2.5} aria-hidden /> Clean
              </span>
            )}
            {!result.complete && <span className="pc-label">Stopped early</span>}
            <span className="pc-label">{result.tempo}% tempo</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label={learn ? 'Notes' : 'Hit'} value={`${result.hits}/${result.expected}`} />
          <Stat label="Wrong" value={String(result.wrong)} bad={result.wrong > 0} />
          {learn ? <Stat label="Time" value={clock(result.durationMs / 1000)} /> : <Stat label="Timing" value={timingText(result.bias)} small />}
        </div>
        {cells.length > 1 && (
          <div className="flex h-5 items-end gap-[2px]" title="Bars: darker = more notes off">
            {cells.map((c) => {
              const off = (c[3] ?? 0) + (c[4] ?? 0) + (learn ? (c[1] ?? 0) - (c[2] ?? 0) : 0);
              const rate = (c[1] ?? 0) > 0 ? Math.min(1, off / (c[1] ?? 1)) : 0;
              return <span key={c[0]} title={`Bar ${c[0]}`} className="flex-1 rounded-[2px] transition-colors" style={{ height: `${30 + rate * 70}%`, background: rate === 0 ? 'var(--pc-line-2)' : rate > 0.2 ? 'var(--pc-bad)' : 'var(--pc-warn)' }} />;
            })}
          </div>
        )}
        <StageChanges changes={changes} />
        {drill !== null && drill !== undefined && <DrillLine drill={drill} />}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--pc-hair)] pt-3">
          <Button icon={Repeat} onClick={onAgain}>
            Again
          </Button>
          {onAnother !== undefined && (
            <Button variant={learn ? 'default' : 'primary'} icon={Shuffle} onClick={onAnother}>
              New one
            </Button>
          )}
          {learn ? (
            <Button variant={onLesson !== undefined ? 'default' : 'primary'} icon={Play} onClick={() => onPlay(sectionNext)}>
              Play in time
            </Button>
          ) : sug !== null && sug.tempo !== result.tempo ? (
            <Button variant={onLesson !== undefined ? 'default' : 'primary'} onClick={() => onTempo(sug.tempo)}>
              {sug.why === 'up' ? `Faster · ${sug.tempo}%` : `Slower · ${sug.tempo}%`}
            </Button>
          ) : null}
          {onLesson !== undefined && (
            <Button variant="primary" iconRight={ArrowRight} onClick={onLesson} className="ml-auto">
              Back to lesson
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** What a pass did to the skill it trains. */
function DrillLine({ drill }: { drill: DrillSaved }): React.JSX.Element {
  const sk = drill.skill;
  return (
    <div className="pc-rise flex items-center gap-2.5 border-t border-[var(--pc-hair)] pt-2.5">
      <span className="flex gap-px">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('text-[12px] leading-none', i <= sk.stars ? 'text-[var(--pc-warn)]' : 'text-[var(--pc-line-2)]')}>
            ★
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{sk.title}</span>
      <span className="pc-mono pc-num text-[12px] text-[var(--pc-ink-2)]">{drill.sight_level > 0 ? `Level ${drill.sight_level}` : `${Math.round(sk.mastery * 100)}%`}</span>
    </div>
  );
}

function Stat({ label, value, bad, small }: { label: string; value: string; bad?: boolean; small?: boolean }): React.JSX.Element {
  return (
    <div className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-sunk)] px-2 py-1.5">
      <div className="pc-label text-[9.5px]">{label}</div>
      <div className={cn('pc-mono pc-num mt-0.5 font-medium', small === true ? 'text-[12px]' : 'text-[15px]', bad === true && 'text-[var(--pc-bad)]')}>{value || '—'}</div>
    </div>
  );
}

/** While looping: the last pass, small, at the top. */
function LoopToast({ result, changes }: { result: PassResult; changes: RunResult[] }): React.JSX.Element {
  return (
    <div key={result.pass} className="pc-rise pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--pc-line)] bg-[var(--pc-raised)] px-3.5 py-1.5 shadow-[var(--pc-shadow)]">
      <span className="pc-mono pc-num text-[15px] font-medium">{Math.round(result.accuracy * 100)}%</span>
      {result.mode === 'learn' ? <span className="pc-label">First try</span> : result.clean ? <span className="pc-label text-[var(--pc-ink)]">Clean</span> : <span className="pc-label">{result.wrong + result.missed} off</span>}
      {changes.map((c) => (
        <span key={c.i} className="flex items-center gap-1.5 border-l border-[var(--pc-hair)] pl-3 text-[12px] font-semibold">
          <StageDots stage={c.after} /> {c.name} · {STAGE_LABEL[c.after as Stage]}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- coach */

function CoachCorner({ song, from, to, mode, tempo }: { song: Song; from: number; to: number; mode: Mode; tempo: number }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (): void => {
    if (text.trim() === '') return;
    setBusy(true);
    api
      .send({ text: text.trim(), song: song.id, context: { view: 'practice', bars: `${from}-${to}`, mode, tempo } })
      .then((r) => {
        setText('');
        setOpen(false);
        if (r.asked) toast.success('Sent to your coach');
        else toast.info(`Saved. ${r.reason}`);
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };
  const hasNote = song.note !== '';
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title="Coach" className={cn('pc-focus relative inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors', open ? 'border-[var(--pc-ink-2)] bg-[var(--pc-raised)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}>
        <Sparkle size={14} aria-hidden className="shrink-0 text-[var(--pc-coach)]" />
        <span className="truncate text-[var(--pc-ink-2)]">{hasNote ? song.note : 'Ask'}</span>
        {hasNote && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--pc-coach)] ring-2 ring-[var(--pc-panel)]" />}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} side="top" align="end" width={340} className="flex flex-col gap-2.5 p-3">
        {hasNote && (
          <div className="flex gap-2 rounded-[var(--pc-radius-sm)] border-l-2 border-[var(--pc-coach)] bg-[var(--pc-coach-soft)] px-2.5 py-2">
            <p className="text-[12.5px] leading-[18px] text-[var(--pc-ink)]">{song.note}</p>
          </div>
        )}
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          minRows={3}
          placeholder={`Ask about ${barsText(from, to)}`}
        />
        <div className="flex justify-end">
          <Button size="sm" variant="coach" icon={Send} busy={busy} onClick={send} disabled={text.trim() === ''}>
            Send
          </Button>
        </div>
      </Popover>
    </>
  );
}

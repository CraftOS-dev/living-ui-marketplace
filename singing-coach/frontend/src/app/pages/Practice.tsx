/**
 * The practice screen: the song's bars on top, the pitch lane (or the
 * engraved melody with its words) in the middle, the Voice Dial at the
 * bottom with the target and the voice's numbers beside it, and one big
 * button.
 *
 *   Listen  the guide voice sings it        Echo  phrase by phrase, back to it
 *   Sing    in time with the guide          Solo  key chord, first note, alone
 *
 * Every sung take is judged note by note and saved: the server moves the
 * sections it covered through their stages and suggests the next tempo.
 * Live feedback fades as a section matures (full while learning, faded when
 * steady, after the take once mastered), and the singer guesses first when
 * it is faded. With a plan block open, the time counts toward it and the
 * next block follows. "Stop: it hurts" ends everything at once.
 *
 * The same screen sings generated exercises (?gen=: vocalises, sight-singing,
 * a scale against a drone, harmony parts, unaccompanied tunes), whose takes
 * move a skill instead of a song, and a lesson's examples (?ex=lesson.step).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, AudioLines, ChevronDown, FileMusic, Guitar, Hand, PenLine, Headphones, KeyRound, Library, Mic, MicOff, MicVocal, Minus, Music2, Pause, Plus, Repeat, Send, Sparkle, Square, Play, Timer, Waves, Wind, Ear, EyeOff } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { openBlock } from '../App.tsx';
import { CheckInDialog, HurtDialog } from '../components/CheckIn.tsx';
import { Ring, useWidth } from '../components/charts.tsx';
import { BarStrip } from '../components/practice/BarStrip.tsx';
import type { BarStripHandle } from '../components/practice/BarStrip.tsx';
import { DisputeDialog, EstimateCard, ResultCard, suggest } from '../components/practice/ResultCard.tsx';
import { SheetView } from '../components/practice/SheetView.tsx';
import type { SheetHandle } from '../components/practice/SheetView.tsx';
import { VoiceDial } from '../components/practice/VoiceDial.tsx';
import type { DialHandle } from '../components/practice/VoiceDial.tsx';
import { Button, Empty, IconButton, MenuButton, MenuItem, Popover, Segmented, Spinner, StageDots, Textarea, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { RunInput } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { clock, shift as shiftText } from '../lib/format.ts';
import { navigate, setQuery, useRoute } from '../lib/router.ts';
import type { DrillSaved, HealthFlag, Mode, Model, Plan, SavedRun, Song, Stage, Strictness } from '../lib/types.ts';
import { loadContent } from '../learn/LessonPlayer.tsx';
import { audio } from '../music/audio.ts';
import { loadBacking } from '../music/backing.ts';
import { noteLabel } from '../music/dial.ts';
import { Engine } from '../music/engine.ts';
import type { EngineConfig, Guide, LiveSettings, PassResult, StageNote } from '../music/engine.ts';
import { build, parseSpecKey, specKey } from '../music/generate.ts';
import type { Built } from '../music/generate.ts';
import { BANDS, CLEAN, ST_CLOSE, ST_ON } from '../music/judge.ts';
import type { NoteResult } from '../music/judge.ts';
import { Lane } from '../music/lane.ts';
import type { LaneNote } from '../music/lane.ts';
import { mic, micProblem } from '../music/mic.ts';
import type { MicStatus } from '../music/mic.ts';
import type { Spec } from '../music/spec.ts';

const MODES: { value: Mode; label: string; icon: LucideIcon; title: string }[] = [
  { value: 'listen', label: 'Listen', icon: Headphones, title: 'The guide voice sings it' },
  { value: 'echo', label: 'Echo', icon: Ear, title: 'Hear a phrase, sing it back' },
  { value: 'sing', label: 'Sing', icon: Music2, title: 'Sing in time with the guide' },
  { value: 'solo', label: 'Solo', icon: Mic, title: 'Key chord and first note, then alone' },
];

const GUIDES: { value: Guide; label: string; hint: string }[] = [
  { value: 'voice', label: 'Guide voice', hint: 'A voice sings the melody with you' },
  { value: 'piano', label: 'Piano', hint: 'The melody on the piano' },
  { value: 'start', label: 'Start note only', hint: 'The first note, then you lead' },
  { value: 'off', label: 'Off', hint: 'Accompaniment only' },
];

interface Exercise {
  spec: Spec | null;
  built: Built | null;
  back: string | null;
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (el === null) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A generated exercise or a lesson example as a song the screen can sing. */
function asSong(id: string, title: string, model: Model, sections: { name: string; from: number; to: number }[]): Song {
  const mr = model.mrange ?? { lo: 60, hi: 67, span: 7, q1: 60, med: 62, q3: 64 };
  return {
    id,
    title,
    composer: '',
    kind: 'vocalise',
    level: 1,
    bars: model.bars.length,
    tempo: model.tempo,
    seconds: Math.round((model.total * 60) / model.tempo),
    key: model.key.name,
    meter: model.meter.label,
    low: mr.lo,
    high: mr.hi,
    span: mr.span,
    median: mr.med,
    tessitura: '',
    phrases: model.phrases?.length ?? 1,
    longest_phrase_s: 0,
    syllables: 0,
    verses: model.lyrics?.length ?? 0,
    first_words: '',
    language: '',
    licence: 'own',
    source_note: '',
    voicing: 'any',
    accompanied: true,
    source: 'you',
    tags: [],
    fav: false,
    seen: true,
    archived: false,
    note: '',
    note_at: '',
    created: '',
    status: 'new',
    key_shift: 0,
    progress: { pct: 0, last_at: '', runs: 0, minutes: 0, counts: { new: sections.length, learning: 0, steady: 0, mastered: 0 }, due: 0, solo: false, memory: false },
    sections: sections.map((s, i) => ({ i, name: s.name, from: s.from, to: s.to, stage: 'new', best: 0, next: 100, acc: null, due: '', last: '', tries: 0, weak: [] })),
    model,
  };
}

export function PracticePage(): React.JSX.Element {
  const app = useApp();
  const { query } = useRoute();
  const genText = query.get('gen');
  const exText = query.get('ex');
  const songId = genText !== null || exText !== null ? '' : (query.get('song') ?? app.settings?.last_song ?? '');
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const ready = app.state !== null;

  // A generated exercise or a lesson's example (built for this voice).
  useEffect(() => {
    if ((genText === null && exText === null) || !ready) return;
    let alive = true;
    setSong(null);
    setError(null);
    const back = query.get('back');
    const load = async (): Promise<void> => {
      if (genText !== null) {
        const spec = parseSpecKey(genText);
        if (spec === null) throw new Error('This exercise link is broken');
        const st = app.state!;
        const learn = await api.learn();
        const built = build(spec, { comf_low: st.voice.comf_low, comf_high: st.voice.comf_high, passaggio: st.voice.passaggio, clef: app.settings?.clef === 'auto' || app.settings?.clef === undefined ? st.voice.clef : app.settings.clef }, st.settings.level, learn.exercises, query.get('skill') ?? undefined, st.settings.under18);
        const r = await api.parse(built.abc);
        if (!alive) return;
        const secs = built.reps.length > 0 ? built.reps.map((x) => ({ name: x.start.replace('b', '♭').replace('#', '♯'), from: x.from, to: x.to })) : r.sections;
        setExercise({ spec, built, back });
        setSong(asSong('gen', built.title, r.model, secs));
        return;
      }
      const [lessonKey = '', idx = '0'] = (exText ?? '').split('.');
      const content = await loadContent();
      const step = content[lessonKey]?.steps[Number(idx)];
      if (step === undefined || step.t !== 'score') throw new Error('This example could not be found');
      const r = await api.parse(step.abc);
      if (!alive) return;
      setExercise({ spec: null, built: null, back });
      setSong(asSong('ex', r.summary.title || 'Example', r.model, r.sections));
    };
    load().catch((err: unknown) => alive && setError(errMessage(err)));
    return () => {
      alive = false;
    };
    // Loaded once per link (the page remounts for a new one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genText, exText, ready]);

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
          <Empty
            icon={Music2}
            title="Pick a song to sing"
            action={
              <Button variant="primary" icon={Library} onClick={() => navigate('library')}>
                Open the library
              </Button>
            }
          />
        </div>
      </div>
    );
  if (error !== null)
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={Music2} title="This could not be opened" action={<Button onClick={() => navigate('library')}>Back to the library</Button>}>
          {error}
        </Empty>
      </div>
    );
  if (song === null || song.model === undefined || app.settings === null || app.state === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--sc-muted)]">
        <Spinner size={18} />
      </div>
    );
  return <Workspace song={song} setSong={setSong} exercise={exercise} />;
}

const STAGE_RANK: Record<Stage, number> = { new: 0, learning: 1, steady: 2, mastered: 3 };

function Workspace({ song, setSong, exercise }: { song: Song; setSong: (s: Song | ((p: Song | null) => Song | null)) => void; exercise: Exercise | null }): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  const st = app.state!;
  const { query } = useRoute();
  const model = song.model!;
  const built = exercise?.built ?? null;
  const voice = st.voice;
  const clef = s.clef === 'auto' ? voice.clef : s.clef;
  const first = model.bars[0]?.n ?? 1;
  const last = model.bars[model.bars.length - 1]?.n ?? 1;
  const qn = (k: string): number | null => {
    const v = query.get(k);
    return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const blockNo = qn('block');
  const qMode = query.get('mode') as Mode | null;
  const initialMode: Mode = qMode !== null && ['listen', 'echo', 'sing', 'solo'].includes(qMode) ? qMode : built !== null ? built.mode : 'sing';
  const initialFrom = Math.max(first, Math.min(last, qn('from') ?? first));
  const initialTo = Math.max(initialFrom, Math.min(last, qn('to') ?? last));
  // A song made from a recording opens in the recording's key: the recording plays only there.
  const fromRecording = exercise === null && song.backing != null;
  const initialShift = qn('key') ?? (exercise !== null || fromRecording ? 0 : song.progress.runs > 0 ? song.key_shift : voice.tested ? (song.fit?.best_shift ?? 0) : 0);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [tempo, setTempo] = useState<number>(qn('tempo') ?? 100);
  const [shift, setShiftState] = useState<number>(initialShift);
  const [loop, setLoop] = useState<boolean>(!(initialFrom === first && initialTo === last) && built === null);
  const [guide, setGuide] = useState<Guide>(built !== null ? built.guide : s.output === 'speakers' && s.guide === 'voice' ? 'start' : s.guide);
  const [drone, setDrone] = useState<boolean>(built?.drone === true || s.drone);
  const [accomp, setAccomp] = useState(true);
  // The recording a song was made from: decoded once (offline, so nothing plays before a click).
  const backingUrl = exercise === null ? (song.backing?.url ?? '') : '';
  // The map for this recording (the song object refreshes; the recording does not change under it).
  const backingMap = useMemo(() => song.backing?.map ?? null, [backingUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const [backBuf, setBackBuf] = useState<AudioBuffer | null>(null);
  const [track, setTrack] = useState<Track>(backingMap?.source === 'voice' ? 'with' : 'without');
  useEffect(() => {
    setBackBuf(null);
    if (backingUrl === '' || backingMap === null) return;
    let live = true;
    loadBacking(backingUrl)
      .then((b) => live && setBackBuf(b))
      .catch(() => live && toast.error('The recording could not be loaded; the piano accompanies instead.'));
    return () => {
      live = false;
    };
  }, [backingUrl, backingMap]);
  // A song made from a recording kept in another key: it is the recording's key again (where takes now happen).
  useEffect(() => {
    if (!fromRecording || qn('key') !== null || song.key_shift === 0) return;
    void api
      .transpose(song.id, 0)
      .then((r) => setSong((p) => (p === null ? p : { ...p, sections: r.song.sections, key_shift: 0 })))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);
  // The voice and the music separated from the recording, each on or off (both on: the recording itself).
  const voiceUrl = backingUrl !== '' ? (song.backing?.voice ?? '') : '';
  const musicUrl = backingUrl !== '' ? (song.backing?.music ?? '') : '';
  const split = voiceUrl !== '' && musicUrl !== '';
  const [parts, setParts] = useState<Parts>({ voice: true, music: true });
  const [voiceBuf, setVoiceBuf] = useState<AudioBuffer | null>(null);
  const [musicBuf, setMusicBuf] = useState<AudioBuffer | null>(null);
  useEffect(() => {
    setVoiceBuf(null);
    setMusicBuf(null);
    if (!split) return;
    let live = true;
    loadBacking(voiceUrl)
      .then((b) => live && setVoiceBuf(b))
      .catch(() => live && toast.error('The voice could not be loaded.'));
    loadBacking(musicUrl)
      .then((b) => live && setMusicBuf(b))
      .catch(() => live && toast.error('The music could not be loaded.'));
    return () => {
      live = false;
    };
  }, [split, voiceUrl, musicUrl]);
  const backing = useMemo((): NonNullable<EngineConfig['backing']> | null => {
    if (backingMap === null) return null;
    if (backBuf === null) return null;
    if (split) {
      const buf = parts.voice && parts.music ? backBuf : parts.voice ? voiceBuf : parts.music ? musicBuf : null;
      return buf !== null ? { buffer: buf, map: backingMap, withVoice: true, singer: parts.voice, original: backBuf } : null;
    }
    // Listen plays the recording as it is; elsewhere with or without its voice.
    return track !== 'off' ? { buffer: backBuf, map: backingMap, withVoice: track === 'with', singer: mode === 'listen' || track === 'with', original: backBuf } : null;
  }, [backingMap, split, parts, backBuf, voiceBuf, musicBuf, track, mode]);
  const [countIn, setCountIn] = useState<boolean>(s.count_in);
  const [view, setView] = useState<'lane' | 'sheet'>(built?.ex === 'sight' ? 'sheet' : s.view);
  const [verse, setVerse] = useState(1);
  const [memory, setMemory] = useState(false);
  const [run, setRun] = useState<'idle' | 'countin' | 'running' | 'done'>('idle');
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState<{ beat: number; of: number } | null>(null);
  const [echo, setEcho] = useState<{ phrase: number; of: number; tries: boolean[]; phase: string }>({ phrase: 0, of: 0, tries: [], phase: '' });
  const [result, setResult] = useState<PassResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState('');
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const [drill, setDrill] = useState<DrillSaved | null>(null);
  const [health, setHealth] = useState<HealthFlag | null>(null);
  const [takes, setTakes] = useState<{ clean: boolean; pitch: number }[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [blockMs, setBlockMs] = useState(0);
  const [micState, setMicState] = useState<MicStatus>(mic.status);
  const [micNote, setMicNote] = useState('');
  const [checkin, setCheckin] = useState(false);
  const [hurt, setHurt] = useState(false);
  const [warmOffer, setWarmOffer] = useState(false);
  const [dispute, setDispute] = useState<{ n: NoteResult; note: StageNote } | null>(null);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeDone, setDisputeDone] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [dock, setDock] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sc.dock') !== '0';
    } catch {
      return true;
    }
  });
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const laneRef = useRef<Lane | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetRef = useRef<SheetHandle | null>(null);
  const dialRef = useRef<DialHandle | null>(null);
  const stripRef = useRef<BarStripHandle | null>(null);
  const blockRef = useRef(0);
  const sungOnce = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lastAudio = useRef<{ url: string; blob: Blob; recStart: number } | null>(null);
  const recStart = useRef(0);
  const replayRef = useRef<{ audio: HTMLAudioElement; offset: number; frames: PassResult['frames'] } | null>(null);
  const pendingStart = useRef(false);
  const offSince = useRef(0);
  const breathRun = useRef<{ start: number; last: number }>({ start: 0, last: 0 });
  const hud = { time: useRef<HTMLSpanElement | null>(null), take: useRef<HTMLSpanElement | null>(null) };
  const [stageBox, stageW] = useWidth<HTMLDivElement>();
  const phone = stageW > 0 && stageW < 640;

  /* ------------------------------------------------------------ feedback */

  const sectionsIn = song.sections.filter((x) => x.from >= range.from && x.to <= range.to);
  const lowest: Stage = sectionsIn.length === 0 ? 'new' : sectionsIn.reduce<Stage>((a, x) => (STAGE_RANK[x.stage] < STAGE_RANK[a] ? x.stage : a), 'mastered');
  const feedback: 'full' | 'fade' | 'after' = mode === 'listen' || mode === 'echo' ? 'full' : s.feedback === 'full' ? 'full' : s.feedback === 'after' ? 'after' : built !== null ? (built.ex === 'sight' ? 'fade' : 'full') : mode === 'solo' || lowest === 'mastered' ? 'after' : lowest === 'steady' ? 'fade' : 'full';
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const memoryOn = memory && mode === 'solo';
  const memRef = useRef(memoryOn);
  memRef.current = memoryOn;

  /* -------------------------------------------------------------- engine */

  // What plays along (the recording's voice and music, the guide, the piano, the drone, the
  // metronome, the loop…) changes during a take without starting it over.
  const liveCfg = useMemo(
    (): LiveSettings => ({ guide, vowel: s.vowel, accomp, metronome: s.metronome, countIn, drone, loop, strictness: s.strictness as Strictness, backing }),
    [guide, s.vowel, accomp, s.metronome, countIn, drone, loop, s.strictness, backing],
  );
  const liveRef = useRef(liveCfg);
  liveRef.current = liveCfg;
  useEffect(() => {
    engineRef.current?.setLive(liveCfg);
  }, [liveCfg]);
  // What the take is (its mode, bars, tempo, key, verse): a new engine when it changes.
  const cfg = useMemo(
    () => ({ mode, from: range.from, to: range.to, tempo, shift, latencyMs: s.latency_ms, verse }),
    [mode, range.from, range.to, tempo, shift, s.latency_ms, verse],
  );

  useEffect(() => {
    const e = new Engine(model, { ...cfg, ...liveRef.current });
    engineRef.current = e;
    setEngine(e);
    laneRef.current?.setRange(e.notes);
    const off = e.on((ev) => {
      if (ev.type === 'count') setCount({ beat: ev.beat, of: ev.of });
      else if (ev.type === 'state') {
        setRun(e.state);
        setPaused(e.paused);
        if (e.state !== 'countin') setCount(null);
        if (e.cfg.mode === 'echo') setEcho((x) => ({ ...x, phrase: e.echoIndex, of: e.phrases.length }));
      } else if (ev.type === 'note') {
        if (ev.result.vib) dialRef.current?.vibrato(ev.result.vibRate, ev.result.vibExtent);
      } else if (ev.type === 'phrase') setEcho({ phrase: ev.phrase, of: e.phrases.length, tries: ev.tries, phase: '' });
      else if (ev.type === 'pass') onPass(ev.result);
    });
    return () => {
      off();
      e.stop();
      engineRef.current = null;
    };
    // A new engine for each configuration (it is idle when the controls change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, cfg]);

  // The voice from the microphone feeds the engine, the dial and the breath timer.
  useEffect(() => {
    const offF = mic.onFrame((f) => {
      engineRef.current?.voice(f);
      const now = performance.now();
      dialRef.current?.push({ at: now, voiced: f.voiced, midi: f.midi, db: f.db });
      const b = breathRun.current;
      if (f.voiced) {
        if (b.start === 0 || now - b.last > 150) b.start = now;
        b.last = now;
      }
    });
    const offS = mic.onStatus((x) => setMicState(x));
    return () => {
      offF();
      offS();
    };
  }, []);

  // The lane's canvas, its size and the theme.
  useEffect(() => {
    const c = canvasRef.current;
    if (c === null || view !== 'lane') return;
    const l = new Lane(c);
    laneRef.current = l;
    if (engineRef.current !== null) l.setRange(engineRef.current.notes);
    const fit = (): void => {
      const box = c.parentElement;
      if (box !== null) l.resize(box.clientWidth, box.clientHeight);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (c.parentElement !== null) ro.observe(c.parentElement);
    const mo = new MutationObserver(() => {
      l.readTheme();
      dialRef.current?.theme();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      laneRef.current = null;
    };
  }, [view]);

  // The dial's bands follow the strictness; its mode the exercise.
  useEffect(() => {
    const b = BANDS[s.strictness as Strictness] ?? BANDS.normal;
    dialRef.current?.bands(b.on, b.close);
  }, [s.strictness]);

  /* ------------------------------------------------------- the one loop */

  const laneNotes = useMemo<LaneNote[]>(() => (engine === null ? [] : engine.notes.map((n) => ({ t: n.t, d: n.d, midi: n.midi, flags: n.flags, syl: n.syl, bar: n.bar }))), [engine]);
  const barLines = useMemo(() => {
    if (engine === null) return [];
    return model.bars.filter((b) => b.t >= engine.q0 - 1e-6 && b.t < engine.q1 - 1e-6).map((b) => ({ s: (b.t - engine.q0) * engine.secPerQ, n: b.n }));
  }, [engine, model]);
  const tonicPc = useMemo(() => {
    const k = model.key;
    const pcs = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
    const maj = pcs[((k.fifths % 12) + 12) % 12] ?? 0;
    return ((k.mode === 'minor' ? maj + 9 : maj) + shift + 120) % 12;
  }, [model, shift]);
  const live = useRef({ laneNotes, barLines, tonicPc, view, memoryOn, built, voice });
  live.current = { laneNotes, barLines, tonicPc, view, memoryOn, built, voice };

  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const tick = (now: number): void => {
      const e = engineRef.current;
      const L = live.current;
      if (e !== null) {
        e.frame();
        const rp = replayRef.current;
        const heard = rp !== null ? rp.audio.currentTime + rp.offset : e.running || e.state === 'done' ? e.heard : 0;
        const fb = feedbackRef.current;
        const running = e.running;
        const showLive = fb === 'full' || !running;
        const lane = laneRef.current;
        if (L.view === 'lane' && lane !== null) {
          lane.draw({
            heard,
            notes: L.laneNotes,
            frames: rp !== null ? rp.frames : e.frames,
            judged: e.judged,
            current: e.current === null ? -1 : e.notes.indexOf(e.current),
            barLines: L.barLines,
            ribbon: rp !== null || showLive,
            lyrics: !(L.memoryOn && running),
            targets: !(L.memoryOn && running),
            marks: rp !== null || (showLive && (fb === 'full' || e.state === 'done')),
            passaggio: L.voice.tested ? [L.voice.passaggio.primo, L.voice.passaggio.secondo] : null,
            tonicPc: L.tonicPc,
            hearing: e.cfg.mode === 'echo' && e.echoPhase === 'hear',
            vowel: e.model.meta?.vowel || 'a',
          });
        } else sheetRef.current?.update();
        stripRef.current?.setPos(e.pos);
        // The dial: the note now (or the first note while idle), the next one coming.
        const dial = dialRef.current;
        if (dial !== null) {
          const cur = e.current ?? (running ? null : (e.notes[0] ?? null));
          const nxt = e.next;
          const soon = nxt !== null && nxt.t - e.heard < 60 / Math.max(30, (model.tempo * e.cfg.tempo) / 100);
          dial.target(cur === null ? null : { midi: cur.midi, name: noteLabel(cur.midi) }, nxt === null ? null : { midi: nxt.midi }, soon && running, { syl: cur?.syl, bar: cur?.bar });
          // Fade: the head only shows when the voice is clearly off for a while; After: never while singing.
          let dm: 'song' | 'blind' | 'hold' = L.built?.hold === true ? 'hold' : 'song';
          if (running && fb === 'after') dm = 'blind';
          if (running && fb === 'fade') {
            const lastF = mic.last;
            const off = lastF !== null && lastF.voiced && cur !== null && Math.abs(((lastF.midi - cur.midi) * 100 + 600) % 1200 - 600) > 50;
            if (off) {
              if (offSince.current === 0) offSince.current = now;
            } else offSince.current = 0;
            dm = offSince.current > 0 && now - offSince.current > 300 ? 'song' : 'blind';
          }
          dial.mode(dm);
          const b = breathRun.current;
          dial.breathTime(b.last > 0 && now - b.last < 200 ? (b.last - b.start) / 1000 : 0);
          dial.draw(now);
        }
        if (now - lastHud > 250) {
          lastHud = now;
          const t = `${clock(Math.max(0, e.heard))} / ${clock(e.seconds)}`;
          if (hud.time.current !== null && hud.time.current.textContent !== t) hud.time.current.textContent = t;
          if (e.cfg.mode === 'echo' && e.running) setEcho((x) => (x.phase === e.echoPhase && x.phrase === e.echoIndex ? x : { ...x, phase: e.echoPhase, phrase: e.echoIndex, of: e.phrases.length }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The microphone goes off when leaving the screen, and after two quiet minutes when idle.
  useEffect(() => {
    const t = window.setInterval(() => {
      const e = engineRef.current;
      if (mic.status === 'on' && (e === null || !e.running) && mic.quietFor() > 120) mic.stop();
    }, 5000);
    return () => {
      window.clearInterval(t);
      mic.stop();
      replayRef.current?.audio.pause();
      if (lastAudio.current !== null) URL.revokeObjectURL(lastAudio.current.url);
    };
  }, []);

  /* --------------------------------------------------------------- takes */

  const startRecorder = (): void => {
    const stream = mic.stream;
    if (stream === null || typeof MediaRecorder === 'undefined') return;
    try {
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, type !== '' ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.current.push(ev.data);
      };
      recStart.current = audio.now();
      rec.start(1000);
      recorder.current = rec;
    } catch {
      recorder.current = null;
    }
  };

  const stopRecorder = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const rec = recorder.current;
      if (rec === null || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => resolve(chunks.current.length > 0 ? new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }) : null);
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
      recorder.current = null;
    });

  const hasSession = st.session !== null;
  const warmedToday = (st.session?.warmup_min ?? 0) > 0;

  const begin = async (): Promise<void> => {
    const e = engineRef.current;
    if (e === null) return;
    replayRef.current?.audio.pause();
    replayRef.current = null;
    setReplaying(false);
    setResult(null);
    setSaved(null);
    setDrill(null);
    setEstimate('');
    setEstimating(false);
    audio.ensure();
    if (mode !== 'listen') {
      // Before the day's first singing: the voice check, then (for songs) a warm-up offer.
      if (s.checkins && st.health.checkin === null && !sungOnce.current && sessionStorage.getItem('sc.checked.' + st.today.day) === null) {
        pendingStart.current = true;
        setCheckin(true);
        return;
      }
      if (exercise === null && !warmedToday && !hasSession && sessionStorage.getItem('sc.warm.' + st.today.day) === null) {
        setWarmOffer(true);
        return;
      }
      if (mic.status !== 'on') {
        const ms = await mic.start(s.input_device);
        if (ms !== 'on') {
          setMicNote(micProblem(ms));
          return;
        }
      }
      setMicNote('');
      startRecorder();
    }
    sungOnce.current = true;
    e.start();
  };

  const pauseOrResume = (): void => {
    const e = engineRef.current;
    if (e === null || !e.running) return;
    const rec = recorder.current;
    if (e.paused) {
      e.resume();
      if (rec !== null && rec.state === 'paused') rec.resume();
    } else {
      e.pause();
      if (rec !== null && rec.state === 'recording') rec.pause();
    }
  };

  const toggle = (): void => {
    const e = engineRef.current;
    if (e === null) return;
    if (e.running) {
      const partial = e.finishEarly();
      void stopRecorder();
      if (partial !== null) onPass(partial);
      return;
    }
    void begin();
  };

  const onPass = (r: PassResult): void => {
    blockRef.current += r.durationMs;
    setBlockMs(blockRef.current);
    const e = engineRef.current;
    const keepRec = e !== null && e.running && e.cfg.loop;
    void stopRecorder().then((blob) => {
      if (blob !== null) {
        if (lastAudio.current !== null) URL.revokeObjectURL(lastAudio.current.url);
        lastAudio.current = { url: URL.createObjectURL(blob), blob, recStart: recStart.current };
      }
      if (keepRec) startRecorder();
    });
    if (r.mode === 'listen') {
      if (exercise === null) void save(r, '');
      return;
    }
    setTakes((t) => [...t.slice(-11), { clean: r.summary.clean, pitch: r.summary.pitch }]);
    setResult(r);
    if (feedbackRef.current !== 'full' && exercise === null && r.summary.expected > 0) {
      setEstimating(true);
      return;
    }
    void save(r, '');
  };

  const save = async (r: PassResult, est: string): Promise<void> => {
    const sm = r.summary;
    try {
      if (exercise !== null) {
        if (built === null) return;
        // Each repetition of a vocalise counts for its own starting note.
        const T = CLEAN[s.strictness as Strictness] ?? CLEAN.normal;
        const reps = built.reps.map((rp) => {
          const rs = r.results.filter((x) => x.bar >= rp.from && x.bar <= rp.to && x.status !== 4);
          const n = rs.length;
          const ok = rs.filter((x) => x.status === ST_ON || x.status === ST_CLOSE).length;
          const on = rs.filter((x) => x.status === ST_ON).length;
          const acc = n > 0 ? ok / n : rs.length === 0 ? 1 : 0;
          let swell = 0;
          if (built.hold) {
            const fr = r.frames.filter((f) => Number.isFinite(f.midi));
            if (fr.length > 20) {
              const dbs = fr.map((f) => f.db);
              const startDb = dbs.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
              swell = Math.max(...dbs) - startDb;
            }
          }
          return { start: rp.start, clean: n > 0 && acc >= T.pitch && on / n >= T.on, acc, swell: Math.round(swell * 10) / 10, sung: n > 0 && r.results.some((x) => x.bar >= rp.from && x.bar <= rp.to && x.voiced > 0.3) };
        });
        const coverage = r.results.length > 0 ? r.results.filter((x) => x.voiced >= 0.5).length / r.results.length : 0;
        const accuracy = built.free ? coverage : built.ex === 'unacc' && sm.drift !== null ? sm.pitch * (Math.abs(sm.drift) <= 30 ? 1 : Math.max(0.4, 1 - (Math.abs(sm.drift) - 30) / 100)) : sm.pitch;
        const phase = query.get('phase') ?? '';
        const res = await api.saveDrill({
          drill: built.ex === 'sight' ? 'sight' : 'exercise',
          skill: built.skill,
          items: Math.max(1, sm.expected || r.results.length),
          correct: built.free ? r.results.filter((x) => x.voiced >= 0.5).length : sm.on + sm.close,
          accuracy: Math.max(0, Math.min(1, accuracy)),
          tempo_pct: r.tempo,
          duration_ms: r.durationMs,
          voiced_ms: r.voicedMs,
          cycles: r.cycles,
          complete: r.complete,
          level: built.ex === 'sight' ? built.level : undefined,
          detail: { ex: built.ex, title: built.title, bpm: Math.round((built.tempo * r.tempo) / 100), reps: reps.filter((x) => x.sung), phase: phase === 'warmup' || phase === 'cooldown' ? phase : undefined, drift: sm.drift ?? undefined },
        });
        setDrill(res);
        setHealth(res.health);
        if (res.level_up > 0) toast.success(`Level ${res.level_up} reached`);
        return;
      }
      const body: RunInput = {
        song: song.id,
        mode: r.mode,
        from_bar: r.from,
        to_bar: r.to,
        verse,
        key_shift: r.shift,
        tempo_pct: r.tempo,
        guide,
        feedback: feedbackRef.current,
        memory: memRef.current && r.mode === 'solo',
        duration_ms: r.durationMs,
        voiced_ms: r.voicedMs,
        cycles: r.cycles,
        expected: sm.expected,
        on_n: sm.on,
        close_n: sm.close,
        off_n: sm.off,
        missed: sm.missed,
        onset_pct: Math.round(sm.onsetPct * 1000) / 1000,
        bias_c: sm.bias ?? undefined,
        mad_c: sm.mad ?? undefined,
        timing_mad: sm.timingMad ?? undefined,
        timing_bias: sm.timingBias ?? undefined,
        hold_sd: sm.holdSd ?? undefined,
        vib_rate: sm.vibRate ?? undefined,
        vib_extent: sm.vibExtent ?? undefined,
        vib_share: sm.vibShare ?? undefined,
        scoops: sm.scoops,
        falls: sm.falls,
        drift_c: sm.drift ?? undefined,
        octave: sm.octave,
        offset_c: r.mode === 'solo' ? r.offset : undefined,
        complete: r.complete,
        per_bar: sm.perBar,
        per_phrase: sm.phrases,
        per_note: sm.perNote,
        map: r.map,
        self_estimate: est,
      };
      const res = await api.saveRun(body);
      setSong((prev) => (prev === null ? prev : { ...prev, sections: res.song.sections, progress: res.song.progress, status: res.song.status, key_shift: res.song.key_shift }));
      if (r.mode !== 'listen') setSaved(res);
      setHealth(res.health);
      if (res.level_up > 0) toast.success(`Level ${res.level_up} reached`);
      // The pitch track for replay and disputes (small); the audio only when recordings are kept.
      if (r.mode !== 'listen' && r.frames.length > 10) {
        const fd = new FormData();
        fd.append('run', res.run.id);
        fd.append('rate', '94');
        fd.append('frames', JSON.stringify(r.frames.map((f) => [Math.round(f.s * 1000), Number.isFinite(f.midi) ? Math.round(f.midi * 100) : null, Math.round(f.db)])));
        if (s.keep_recordings && lastAudio.current !== null) fd.append('audio', lastAudio.current.blob, 'take.webm');
        void api.saveTrack(fd).catch(() => undefined);
      }
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  const pickEstimate = (v: 'on' | 'close' | 'off' | ''): void => {
    setEstimating(false);
    setEstimate(v);
    if (result !== null) void save(result, v);
  };

  const replay = (): void => {
    const la = lastAudio.current;
    const e = engineRef.current;
    if (la === null || e === null || result === null) return;
    replayRef.current?.audio.pause();
    const a = new Audio(la.url);
    // The recording starts at recStart on the context clock; the take's clock at t0 + latency.
    const offset = la.recStart - e.t0 - e.lat;
    replayRef.current = { audio: a, offset, frames: result.frames };
    setReplaying(true);
    a.onended = () => {
      replayRef.current = null;
      setReplaying(false);
    };
    void a.play().catch(() => {
      replayRef.current = null;
      setReplaying(false);
    });
  };

  const doDispute = async (): Promise<void> => {
    if (dispute === null || saved === null) return;
    setDisputeBusy(true);
    try {
      const r = await api.dispute(saved.run.id, dispute.n.i);
      setDisputeDone(r.note);
      if (r.credited) {
        const fresh = await api.song(song.id);
        setSong((p) => (p === null ? p : { ...p, sections: fresh.song.sections, progress: fresh.song.progress }));
      }
    } catch (err) {
      setDisputeDone(errMessage(err));
    } finally {
      setDisputeBusy(false);
    }
  };

  /* ------------------------------------------------------------ controls */

  const stopIdle = (): void => {
    engineRef.current?.stop();
    replayRef.current?.audio.pause();
    replayRef.current = null;
    setReplaying(false);
  };

  const chooseRange = useCallback((a: number, b: number, lp: boolean) => {
    stopIdle();
    setRange({ from: a, to: b });
    setLoop(lp);
    setResult(null);
    setSaved(null);
    setTakes([]);
  }, []);

  const changeShift = (n: number): void => {
    const v = Math.max(-12, Math.min(12, n));
    stopIdle();
    setShiftState(v);
    setResult(null);
    if (exercise === null) void api.transpose(song.id, v).then((r) => setSong((p) => (p === null ? p : { ...p, sections: r.song.sections, key_shift: v }))).catch(() => undefined);
  };

  const changeMode = (m: Mode): void => {
    stopIdle();
    setMode(m);
    setResult(null);
    setSaved(null);
    setTakes([]);
  };

  const hurtNow = (): void => {
    const e = engineRef.current;
    e?.stop();
    audio.stopAll();
    mic.stop();
    void stopRecorder();
    void api.endSession(true).catch(() => undefined);
    setHurt(true);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (typing(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      const e = engineRef.current;
      if (e === null) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        toggle();
      } else if (ev.key === 'Escape') stopIdle();
      else if (ev.key === 'p' || ev.key === 'P') pauseOrResume();
      else if (ev.key === 'l' || ev.key === 'L') setLoop((x) => !x);
      else if (ev.key === '[') changeShift(shift - 1);
      else if (ev.key === ']') changeShift(shift + 1);
      else if (ev.key === '-') setTempo((t) => Math.max(50, t - 5));
      else if (ev.key === '=' || ev.key === '+') setTempo((t) => Math.min(120, t + 5));
      else if (ev.key === 'g' || ev.key === 'G') setGuide((g) => GUIDES[(GUIDES.findIndex((x) => x.value === g) + 1) % GUIDES.length]!.value);
      else if (ev.key === 'd' || ev.key === 'D') setDrone((d) => !d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------------------------------------ the plan */

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
    stopIdle();
    if (nextBlock !== null) openBlock(nextBlock);
    else navigate('today');
  };

  /* ------------------------------------------------- tell the coach where */

  useEffect(() => {
    const ex = exercise !== null;
    const t = window.setTimeout(() => void api.reportUi({ view: ex ? 'exercise' : 'practice', song: ex ? undefined : song.id, title: ex ? song.title : undefined, skill: built?.skill, from: range.from, to: range.to, mode, tempo, key: shift }).catch(() => undefined), 1200);
    const where = { from: range.from === first ? undefined : range.from, to: range.to === last ? undefined : range.to, mode, tempo: tempo === 100 ? undefined : tempo, key: shift === 0 ? undefined : shift, block: blockNo ?? undefined };
    if (ex) setQuery('practice', { gen: query.get('gen') ?? undefined, ex: query.get('ex') ?? undefined, back: exercise.back ?? undefined, skill: query.get('skill') ?? undefined, phase: query.get('phase') ?? undefined, ...where });
    else setQuery('practice', { song: song.id, ...where });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, range.from, range.to, mode, tempo, shift, first, last, blockNo, exercise]);

  const fromLesson = exercise?.back?.startsWith('learn') === true;
  const leave = (): void => {
    stopIdle();
    if (exercise?.back !== null && exercise?.back !== undefined && exercise.back !== '') window.location.hash = '#/' + exercise.back + (fromLesson && sungOnce.current ? '&done=1' : '');
    else if (exercise !== null) navigate('train');
    else navigate('library');
  };
  const another = (): void => {
    const sp = exercise?.spec;
    if (sp === null || sp === undefined) return;
    const seed = Math.floor(Math.random() * 1e6);
    const next: Spec = sp.k === 'sight' ? { ...sp, level: drill !== null && drill.level > 0 ? drill.level : sp.level, seed } : sp.k === 'vocalise' ? sp : { ...sp, seed };
    navigate('practice', { gen: specKey(next), back: exercise?.back ?? undefined, skill: query.get('skill') ?? undefined, block: blockNo ?? undefined });
  };

  /* -------------------------------------------------------------- render */

  const running = run === 'running' || run === 'countin';
  const sugg = result === null ? [] : suggest({ result, notes: engine?.notes ?? [], saved, comfHigh: voice.comf_high, onLoop: (a, b, t) => (chooseRange(a, b, true), setTempo(t), setMode((m) => (m === 'solo' ? 'sing' : m))), onKey: (d) => changeShift(shift + d), onTempo: (t) => (setTempo(t), setResult(null)), onRest: () => navigate('today'), health, exercise: exercise !== null });
  const fitText = (() => {
    const lo = song.low + shift;
    const hi = song.high + shift;
    const over = hi - voice.comf_high;
    const under = voice.comf_low - lo;
    return `${noteLabel(lo)}–${noteLabel(hi)}` + (!voice.tested ? '' : over > 0 ? ` · ${over} above your range` : under > 0 ? ` · ${under} below` : ' · fits');
  })();
  const meta = built !== null ? (built.ex === 'sight' ? `Sight-singing · level ${built.level}` : built.free ? 'Warm-up' : 'Vocalise') : [song.composer, song.key, song.meter].filter(Boolean).join(' · ');

  return (
    <div className="flex h-full min-h-0">
      <div ref={stageBox} className="flex min-w-0 flex-1 flex-col">
        {/* Header: the song, the plan block, the microphone, and the stop. */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--sc-hair)] bg-[var(--sc-page)] px-3">
          <MenuButton />
          <IconButton icon={ArrowLeft} label={fromLesson ? 'Back to the lesson' : exercise !== null ? 'Back' : 'Library'} onClick={leave} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[14px] font-semibold">{song.title}</div>
            <div className="sc-label truncate">{meta}</div>
          </div>
          {exercise === null && (
            <Button size="sm" variant="ghost" icon={PenLine} onClick={() => (stopIdle(), navigate('edit', { song: song.id, back: 'practice' }))} title="Edit the notes, words, chords and key">
              Edit
            </Button>
          )}
          {block !== null && (
            <span className="hidden items-center gap-2 rounded-full border border-[var(--sc-line)] bg-[var(--sc-raised)] py-1 pl-1.5 pr-1.5 sm:flex">
              <Ring value={block.minutes > 0 ? 1 - blockLeft / (block.minutes * 60000) : 0} size={22} stroke={2.5} />
              <span className="sc-mono sc-num text-[12px]">
                {(plan?.blocks.findIndex((b) => b.i === block.i) ?? 0) + 1}/{plan?.blocks.length ?? 0} · {blockLeft > 0 ? clock(blockLeft / 1000) : 'done'}
              </span>
              {blockLeft <= 0 && (
                <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={goNext} className="h-6 rounded-full">
                  {nextBlock !== null ? 'Next' : 'Finish'}
                </Button>
              )}
            </span>
          )}
          <MicPill state={micState} onStart={() => void mic.start(s.input_device).then((x) => setMicNote(x === 'on' ? '' : micProblem(x)))} />
          <button type="button" onClick={hurtNow} title="Stop everything now and rest" className="sc-focus inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2.5 text-[12px] font-medium text-[var(--sc-bad)] hover:bg-[var(--sc-bad-soft)]">
            <Hand size={14} aria-hidden />
            <span className="hidden sm:inline">Stop: it hurts</span>
          </button>
          {exercise === null && <IconButton icon={Sparkle} label={dock ? 'Hide the coach' : 'Show the coach'} active={dock} onClick={() => (setDock(!dock), localStorage.setItem('sc.dock', dock ? '0' : '1'))} className="hidden xl:inline-flex" />}
        </header>
        {/* The tool bar. */}
        <div className="sc-scroll flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--sc-line)] bg-[var(--sc-page)] px-3">
          <Segmented value={mode} onChange={changeMode} options={MODES.map((m) => ({ value: m.value, label: phone ? '' : m.label, icon: m.icon, title: m.title }))} label="Mode" size="sm" />
          <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
          {exercise === null && <KeyChip shift={shift} onShift={changeShift} text={fitText} best={song.fit?.best_shift ?? null} tested={voice.tested} />}
          <TempoChip tempo={tempo} onChange={(t) => (stopIdle(), setTempo(t))} />
          <IconButton icon={Repeat} label={loop ? 'Loop on (L)' : 'Loop off (L)'} active={loop} onClick={() => setLoop((l) => !l)} />
          <GuideChip guide={guide} onChange={setGuide} speakers={s.output === 'speakers'} />
          <IconButton icon={Waves} label={drone ? 'Drone on (D)' : 'Drone off (D)'} active={drone} onClick={() => setDrone((d) => !d)} />
          {backingUrl !== '' && backingMap !== null && split && (
            <PartChips parts={parts} onChange={setParts} ready={{ voice: voiceBuf !== null && backBuf !== null, music: musicBuf !== null && backBuf !== null }} playing={tempo === 100 && shift === 0 && mode !== 'solo'} />
          )}
          {backingUrl !== '' && backingMap !== null && !split && <TrackChip track={track} onChange={setTrack} ready={backBuf !== null} playing={tempo === 100 && shift === 0 && mode !== 'solo'} stereo={backingMap.channels >= 2} />}
          {backingUrl !== '' && backingMap !== null && mode !== 'solo' && (shift !== 0 || tempo !== 100) && (split ? parts.voice || parts.music : track !== 'off') && (
            <button
              type="button"
              onClick={() => {
                stopIdle();
                if (shift !== 0) changeShift(0);
                setTempo(100);
              }}
              title={`The recording plays only at its own key and full speed; ${shift !== 0 ? `in key ${shift > 0 ? '+' : ''}${shift}` : `at ${tempo}%`} the guide and the piano play instead. Click to go back to the recording.`}
              className="sc-focus inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-warn)] bg-[var(--sc-warn-soft)] px-2 text-[12px] text-[var(--sc-warn)] hover:brightness-95"
            >
              <AudioLines size={13} aria-hidden />
              <span>Back to the recording</span>
            </button>
          )}
          <IconButton icon={Music2} label={accomp ? 'Piano on' : 'Piano off'} active={accomp} onClick={() => setAccomp((a) => !a)} />
          <IconButton icon={Timer} label={countIn ? 'Count-in on' : 'Count-in off'} active={countIn} onClick={() => setCountIn((c) => !c)} />
          {mode === 'solo' && exercise === null && <IconButton icon={EyeOff} label={memory ? 'From memory: words and notes hidden' : 'From memory off'} active={memory} onClick={() => setMemory((m) => !m)} />}
          {song.verses > 1 && (
            <Segmented value={String(verse)} onChange={(v) => (stopIdle(), setVerse(Number(v)))} options={Array.from({ length: Math.min(4, song.verses) }, (_, i) => ({ value: String(i + 1), label: 'v' + (i + 1) }))} label="Verse" size="sm" />
          )}
          <span className="flex-1" />
          <span className="sc-label hidden shrink-0 md:inline" title="Live feedback: full while learning, faded when steady, after the take once mastered (Settings)">
            Feedback · {feedback}
          </span>
          <Segmented
            value={view}
            onChange={(v) => {
              setView(v);
              if (exercise === null) app.save({ view: v });
            }}
            options={[
              { value: 'lane', label: '', icon: AudioLines, title: 'Pitch lane' },
              { value: 'sheet', label: '', icon: FileMusic, title: 'Sheet music' },
            ]}
            label="View"
            size="sm"
          />
        </div>

        <BarStrip ref={stripRef} model={model} sections={song.sections} from={range.from} to={range.to} onRange={chooseRange} />

        {/* The stage. */}
        <div className="sc-grid relative min-h-[150px] flex-1 overflow-hidden bg-[var(--sc-page)]">
          {view === 'lane' ? <canvas ref={canvasRef} className="absolute inset-0 block" /> : <SheetView ref={sheetRef} model={model} shift={shift} clef={clef} verse={verse} engine={engine} marks={feedback === 'full' || run === 'done'} words={!(memoryOn && running)} />}

          {count !== null && run === 'countin' && mode !== 'echo' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span key={count.beat} className="sc-pop sc-mono text-[84px] font-light leading-none text-[var(--sc-ink)] opacity-75">
                {count.beat}
              </span>
            </div>
          )}

          {mode === 'echo' && running && (
            <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--sc-line)] bg-[var(--sc-raised)] px-3.5 py-1.5 shadow-[var(--sc-shadow)]">
              <span className={cn('size-2 rounded-full', echo.phase === 'yours' ? 'sc-breathe bg-[var(--sc-voice)]' : 'bg-[var(--sc-ink-2)]')} />
              <span className="text-[13px] font-semibold">{echo.phase === 'yours' ? 'Your turn' : echo.phase === 'hear' ? 'Listen' : 'Get ready'}</span>
              <span className="sc-mono sc-num text-[12px] text-[var(--sc-muted)]">
                phrase {echo.phrase + 1}/{Math.max(1, echo.of)}
              </span>
              <span className="flex gap-1">
                {echo.tries.slice(-3).map((t, i) => (
                  <span key={i} className={cn('size-1.5 rounded-full', t ? 'bg-[var(--sc-ink)]' : 'border border-[var(--sc-ink-2)]')} />
                ))}
              </span>
            </div>
          )}

          {micNote !== '' && (
            <div className="absolute left-1/2 top-1/2 z-10 w-[min(440px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] p-4 shadow-[var(--sc-shadow-lg)]">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <MicOff size={16} aria-hidden /> The microphone is not on
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-[var(--sc-ink-2)]">{micNote}</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" onClick={() => setMicNote('')}>
                  Close
                </Button>
                <Button size="sm" variant="primary" onClick={() => window.open(window.location.href, '_blank', 'noopener')}>
                  Open in its own tab
                </Button>
              </div>
            </div>
          )}

          {warmOffer && (
            <div className="sc-rise absolute left-1/2 top-1/2 z-10 w-[min(440px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] p-4 shadow-[var(--sc-shadow-lg)]">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <Wind size={16} aria-hidden /> Warm up first?
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-[var(--sc-ink-2)]">You have not warmed up today. Three minutes of straw or lip-trill sirens get the voice ready; 5 to 10 minutes is enough.</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    sessionStorage.setItem('sc.warm.' + st.today.day, '1');
                    setWarmOffer(false);
                    void begin();
                  }}
                >
                  Skip today
                </Button>
                <Button size="sm" variant="primary" icon={Wind} onClick={() => navigate('practice', { gen: specKey({ k: 'vocalise', ex: 'sovt.siren', vowel: 'brr' }), back: 'practice?song=' + song.id, phase: 'warmup' })}>
                  Warm up (3 min)
                </Button>
              </div>
            </div>
          )}

          {result !== null && !running && estimating && <EstimateCard onPick={pickEstimate} />}
          {result !== null && !running && !estimating && (
            <ResultCard
              result={result}
              notes={engine?.notes ?? []}
              saved={saved}
              drill={drill}
              estimate={estimate}
              suggestions={sugg}
              health={health}
              onAgain={() => void begin()}
              onReplay={replay}
              canReplay={lastAudio.current !== null && !replaying}
              onClose={() => setResult(null)}
              onDispute={(n, note) => (setDispute({ n, note }), setDisputeDone(''))}
              onAnother={exercise?.spec !== null && exercise?.spec !== undefined && exercise.spec.k !== 'vocalise' ? another : undefined}
              onNext={block !== null && nextBlock !== null ? goNext : fromLesson ? leave : undefined}
              nextLabel={fromLesson ? 'Back to the lesson' : 'Next block'}
            />
          )}
        </div>

        {/* The Voice Dial with the target and the voice's numbers. */}
        <div className="relative shrink-0 border-t border-[var(--sc-line)] bg-[var(--sc-panel)]">
          <VoiceDial ref={dialRef} height={phone ? 128 : 176} compact={phone} mode={built?.hold === true ? 'hold' : 'song'} />
        </div>

        {/* The transport. */}
        <div className="relative flex h-[54px] shrink-0 items-center gap-3 border-t border-[var(--sc-hair)] bg-[var(--sc-panel)] px-4">
          <button
            type="button"
            aria-label={running ? 'Stop' : 'Start'}
            title={running ? 'Stop (Space)' : 'Start (Space)'}
            onClick={toggle}
            className={cn('sc-focus flex h-[38px] shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold shadow-[var(--sc-shadow)] transition-[transform,background-color] duration-200 hover:scale-[1.03] active:scale-95', running ? 'bg-[var(--sc-raised)] text-[var(--sc-ink)] ring-1 ring-[var(--sc-line-2)]' : 'bg-[var(--sc-ink)] text-[var(--sc-page)]')}
          >
            {running ? <Square size={13} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
            {running ? 'Stop' : MODES.find((m) => m.value === mode)?.label}
          </button>
          {running && (
            <button
              type="button"
              aria-label={paused ? 'Resume' : 'Pause'}
              title={paused ? 'Carry on from here (P)' : 'Pause (P)'}
              onClick={pauseOrResume}
              className={cn('sc-focus flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-semibold ring-1 transition-[transform,background-color] duration-200 hover:scale-[1.03] active:scale-95', paused ? 'bg-[var(--sc-ink)] text-[var(--sc-page)] ring-[var(--sc-ink)]' : 'bg-[var(--sc-raised)] text-[var(--sc-ink)] ring-[var(--sc-line-2)]')}
            >
              {paused ? <Play size={14} fill="currentColor" aria-hidden /> : <Pause size={14} fill="currentColor" aria-hidden />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {paused && <span className="sc-label">Paused</span>}
          <span ref={hud.time} className="sc-mono sc-num text-[12px] text-[var(--sc-muted)]">
            0:00 / 0:00
          </span>
          {takes.length > 0 && (
            <span className="hidden items-center gap-1 sm:flex" title="Takes: filled = clean">
              {takes.map((p, i) => (
                <span key={i} title={`${Math.round(p.pitch * 100)}%`} className={cn('sc-pop size-2 rounded-[2px] border', p.clean ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)]' : 'border-[var(--sc-ink-2)] bg-transparent')} />
              ))}
            </span>
          )}
          <span className="flex-1" />
          {mode === 'echo' && running && (
            <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => engineRef.current?.skipPhrase()}>
              Next phrase
            </Button>
          )}
          <span className="sc-label hidden md:inline">
            Voice today <span className="sc-num text-[var(--sc-ink-2)]">{Math.round(st.today.voiced)}</span>/{st.today.cap} min
          </span>
        </div>
      </div>

      {exercise === null && dock && <CoachDock song={song} from={range.from} to={range.to} mode={mode} tempo={tempo} shift={shift} block={block?.why ?? ''} result={result} />}

      <CheckInDialog
        open={checkin}
        onClose={() => {
          setCheckin(false);
          sessionStorage.setItem('sc.checked.' + st.today.day, '1');
          if (pendingStart.current) {
            pendingStart.current = false;
            void begin();
          }
        }}
        onDone={(c, advice) => {
          setCheckin(false);
          sessionStorage.setItem('sc.checked.' + st.today.day, '1');
          app.reload();
          if (c.pain) {
            setHurt(true);
            pendingStart.current = false;
            return;
          }
          toast.info(advice);
          if (pendingStart.current) {
            pendingStart.current = false;
            void begin();
          }
        }}
      />
      <HurtDialog open={hurt} onClose={() => (setHurt(false), navigate('today'))} />
      <DisputeDialog open={dispute !== null} onClose={() => setDispute(null)} note={dispute?.note ?? null} result={dispute?.n ?? null} frames={result?.frames ?? []} onDispute={() => void doDispute()} busy={disputeBusy} done={disputeDone} />
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function MicPill({ state, onStart }: { state: MicStatus; onStart: () => void }): React.JSX.Element {
  const on = state === 'on';
  return (
    <button type="button" onClick={on ? undefined : onStart} title={on ? (mic.device || 'Microphone on') : 'Turn the microphone on'} className={cn('sc-focus inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px]', on ? 'border-[var(--sc-line)] text-[var(--sc-ink-2)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)] text-[var(--sc-ink)] hover:bg-[var(--sc-hover)]')}>
      {on ? <Mic size={13} aria-hidden /> : <MicOff size={13} aria-hidden />}
      <span className={cn('size-1.5 rounded-full', on ? 'sc-breathe bg-[var(--sc-voice)]' : 'bg-[var(--sc-faint)]')} />
      <span className="hidden max-w-[120px] truncate lg:inline">{on ? (mic.device || 'Mic on') : 'Mic off'}</span>
    </button>
  );
}

function KeyChip({ shift, onShift, text, best, tested }: { shift: number; onShift: (n: number) => void; text: string; best: number | null; tested: boolean }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title="Key: [ and ] move it a semitone" className="sc-focus inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2 text-[12px] hover:bg-[var(--sc-hover)]">
        <KeyRound size={13} aria-hidden className="text-[var(--sc-muted)]" />
        <span className="sc-mono sc-num">Key {shiftText(shift)}</span>
        <ChevronDown size={12} aria-hidden className="text-[var(--sc-muted)]" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={280} className="p-3">
        <div className="sc-label">Key</div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <IconButton icon={Minus} label="Lower" onClick={() => onShift(shift - 1)} disabled={shift <= -6} />
          <span className="sc-mono sc-num text-[22px] font-light">{shiftText(shift)}</span>
          <IconButton icon={Plus} label="Higher" onClick={() => onShift(shift + 1)} disabled={shift >= 6} />
        </div>
        <div className="mt-2 text-[12.5px] text-[var(--sc-ink-2)]">{text}</div>
        {tested && best !== null && best !== shift && (
          <Button size="sm" className="mt-2.5 w-full" onClick={() => (onShift(best), setOpen(false))}>
            Best key for your voice: {shiftText(best)}
          </Button>
        )}
        {!tested && <p className="mt-2 text-[11.5px] text-[var(--sc-muted)]">Find your range (Settings, or the first-run check) and the app will suggest the best key.</p>}
        <p className="mt-2 text-[11.5px] leading-4 text-[var(--sc-muted)]">Progress is kept per key: a new key starts its sections at learning again.</p>
      </Popover>
    </>
  );
}

function TempoChip({ tempo, onChange }: { tempo: number; onChange: (t: number) => void }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title="Tempo: - and = change it" className="sc-focus inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2 text-[12px] hover:bg-[var(--sc-hover)]">
        <span className="sc-mono sc-num">{tempo}%</span>
        <ChevronDown size={12} aria-hidden className="text-[var(--sc-muted)]" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={200} className="p-1">
        {[70, 80, 90, 100, 110].map((t) => (
          <MenuItem key={t} selected={t === tempo} onClick={() => (onChange(t), setOpen(false))} hint={t === 100 ? 'as written' : t < 100 ? 'slower' : 'faster'}>
            {t}%
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

type Track = 'with' | 'without' | 'off';

interface Parts {
  voice: boolean;
  music: boolean;
}

/** A song whose voice and music were separated: each on or off; both off, the piano accompanies. */
function PartChips({ parts, onChange, ready, playing }: { parts: Parts; onChange: (p: Parts) => void; ready: Parts; playing: boolean }): React.JSX.Element {
  const chip = (key: keyof Parts, Icon: LucideIcon, label: string, hint: string): React.JSX.Element => {
    const on = parts[key];
    const idle = on && (!ready[key] || !playing);
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange({ ...parts, [key]: !on })}
        title={!ready[key] && on ? `Loading the ${key}…` : !playing && on ? 'The recording plays at its own key and full speed; here the piano accompanies' : hint}
        className={cn('sc-focus inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--sc-radius-sm)] border px-2 text-[12px] hover:bg-[var(--sc-hover)]', on && !idle ? 'border-[var(--sc-ink-2)] bg-[var(--sc-active)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)]', (idle || !on) && 'text-[var(--sc-muted)]')}
      >
        {on && !ready[key] ? <Spinner size={12} /> : <Icon size={13} aria-hidden />}
        <span>{label}</span>
        <span className="sc-label">{on ? 'on' : 'off'}</span>
      </button>
    );
  };
  return (
    <>
      {chip('voice', MicVocal, 'Voice', parts.voice ? 'The singer from the recording: off to sing the part yourself' : 'The singer from the recording: on to sing along')}
      {chip('music', Guitar, 'Music', parts.music ? 'The band from the recording: off to sing without it (the piano accompanies when both are off)' : 'The band from the recording: on to sing with it')}
    </>
  );
}

const TRACKS: { value: Track; label: string; hint: string }[] = [
  { value: 'without', label: 'Without the voice', hint: 'The music, with the singer in the middle taken out' },
  { value: 'with', label: 'With the voice', hint: 'The recording as it is: sing along with the singer' },
  { value: 'off', label: 'Off', hint: 'The piano accompanies instead' },
];

/** The recording a song was made from: with or without its singer, or off. */
function TrackChip({ track, onChange, ready, playing, stereo }: { track: Track; onChange: (t: Track) => void; ready: boolean; playing: boolean; stereo: boolean }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const cur = TRACKS.find((t) => t.value === track) ?? TRACKS[0]!;
  const idle = track !== 'off' && (!ready || !playing);
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title={!ready ? 'Loading the recording…' : !playing && track !== 'off' ? 'The recording plays at its own key and full speed; here the piano accompanies' : 'The recording'} className={cn('sc-focus inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border px-2 text-[12px] hover:bg-[var(--sc-hover)]', track !== 'off' && !idle ? 'border-[var(--sc-ink-2)] bg-[var(--sc-active)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)]', idle && 'opacity-60')}>
        {ready || track === 'off' ? <AudioLines size={13} aria-hidden className="text-[var(--sc-muted)]" /> : <Spinner size={12} />}
        <span>{track === 'off' ? 'Recording off' : cur.label}</span>
        <ChevronDown size={12} aria-hidden className="text-[var(--sc-muted)]" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={280} className="p-1">
        {TRACKS.filter((t) => stereo || t.value !== 'without').map((t) => (
          <MenuItem key={t.value} selected={t.value === track} onClick={() => (onChange(t.value), setOpen(false))}>
            <span className="block">{t.label}</span>
            <span className="block text-[11.5px] text-[var(--sc-muted)]">{t.hint}</span>
          </MenuItem>
        ))}
        <p className="px-2 pb-1.5 pt-1 text-[11.5px] leading-4 text-[var(--sc-muted)]">The recording plays at its own key and full speed. In another key, at another speed, or in Solo, the piano accompanies.</p>
      </Popover>
    </>
  );
}

function GuideChip({ guide, onChange, speakers }: { guide: Guide; onChange: (g: Guide) => void; speakers: boolean }): React.JSX.Element {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const cur = GUIDES.find((g) => g.value === guide) ?? GUIDES[0]!;
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} title="Guide (G cycles)" className="sc-focus inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2 text-[12px] hover:bg-[var(--sc-hover)]">
        <Headphones size={13} aria-hidden className="text-[var(--sc-muted)]" />
        <span>{cur.label}</span>
        <ChevronDown size={12} aria-hidden className="text-[var(--sc-muted)]" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={260} className="p-1">
        {GUIDES.map((g) => (
          <MenuItem key={g.value} selected={g.value === guide} onClick={() => (onChange(g.value), setOpen(false))}>
            <span className="block">{g.label}</span>
            <span className="block text-[11.5px] text-[var(--sc-muted)]">{g.hint}</span>
          </MenuItem>
        ))}
        {speakers && <p className="px-2 pb-1.5 pt-1 text-[11.5px] leading-4 text-[var(--sc-muted)]">With speakers the guide leaks into the microphone; headphones work best, or use Echo and Solo.</p>}
      </Popover>
    </>
  );
}

/** The coach beside the stage: its focus note, why this block, the takes, and a question box. */
function CoachDock({ song, from, to, mode, tempo, shift, block, result }: { song: Song; from: number; to: number; mode: Mode; tempo: number; shift: number; block: string; result: PassResult | null }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const secs = song.sections.filter((x) => x.from >= from && x.to <= to);
  const send = (): void => {
    if (text.trim() === '') return;
    setBusy(true);
    const sm = result?.summary;
    api
      .send({ text: text.trim(), song: song.id, context: { view: 'practice', bars: `${from}-${to}`, mode, tempo, key: shift, last_take: sm ? { pitch: Math.round(sm.pitch * 100) / 100, in_tune: Math.round(sm.inTune * 100) / 100, bias_c: sm.bias, weakest: sm.weakest ? `${sm.weakest.from_bar}-${sm.weakest.to_bar}` : null } : null } })
      .then((r) => {
        setText('');
        if (r.asked) toast.success('Sent to your coach');
        else toast.info(`Saved. ${r.reason}`);
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l border-[var(--sc-line)] bg-[var(--sc-side)] xl:flex">
      <div className="flex h-12 items-center gap-2 border-b border-[var(--sc-hair)] px-4">
        <span className="flex size-6 items-center justify-center rounded-[6px] bg-[var(--sc-coach)] text-[var(--sc-coach-ink)]">
          <Sparkle size={13} strokeWidth={2} aria-hidden />
        </span>
        <span className="text-[13px] font-semibold">Coach</span>
      </div>
      <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <div className="sc-label mb-1.5">Focus</div>
          {song.note !== '' ? <p className="border-l-2 border-[var(--sc-coach)] pl-2.5 text-[13px] leading-5">{song.note}</p> : <p className="text-[12.5px] text-[var(--sc-muted)]">No note from the coach for this song yet. Ask below, or end a session for a review.</p>}
        </div>
        {block !== '' && (
          <div>
            <div className="sc-label mb-1">Why this block</div>
            <p className="text-[12.5px] text-[var(--sc-ink-2)]">{block}</p>
          </div>
        )}
        <div>
          <div className="sc-label mb-1.5">Sections</div>
          <div className="flex flex-col gap-1.5">
            {secs.slice(0, 6).map((x) => (
              <div key={x.i} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-8 font-medium">{x.name}</span>
                <span className="sc-mono sc-num text-[11px] text-[var(--sc-muted)]">
                  {x.from}–{x.to}
                </span>
                <span className="flex-1" />
                <StageDots stage={x.stage} />
              </div>
            ))}
          </div>
        </div>
        {result !== null && result.summary.expected > 0 && (
          <div>
            <div className="sc-label mb-1.5">Last take</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-[var(--sc-muted)]">Pitch</span>
              <span className="sc-mono sc-num text-right">{Math.round(result.summary.pitch * 100)}%</span>
              <span className="text-[var(--sc-muted)]">In tune</span>
              <span className="sc-mono sc-num text-right">{Math.round(result.summary.inTune * 100)}%</span>
              <span className="text-[var(--sc-muted)]">Lean</span>
              <span className="sc-mono sc-num text-right">{result.summary.bias === null ? '—' : (result.summary.bias > 0 ? '♯' : result.summary.bias < 0 ? '♭' : '') + Math.abs(result.summary.bias) + '¢'}</span>
              <span className="text-[var(--sc-muted)]">Scoops</span>
              <span className="sc-mono sc-num text-right">{result.summary.scoops}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-[var(--sc-hair)] p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          minRows={2}
          maxRows={6}
          placeholder={`Ask about bars ${from}–${to}`}
        />
        <Button size="sm" variant="coach" icon={Send} busy={busy} onClick={send} disabled={text.trim() === ''}>
          Ask the coach
        </Button>
      </div>
    </aside>
  );
}

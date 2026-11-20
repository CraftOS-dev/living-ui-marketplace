/**
 * The practice engine: sings, follows and judges one stretch of bars.
 *
 *   listen  the guide voice sings it (with the piano), the words light up
 *   echo    phrase by phrase: the app sings a phrase, then the singer sings
 *           it back on the same beat; a phrase repeats until two of its last
 *           three tries are clean, then the next one comes
 *   sing    in time after a count-in, with the guide voice (or piano, or only
 *           the starting note) and the accompaniment; every note is judged
 *   solo    the key chord and the first note, a count-in, then the singer
 *           alone: no guide melody; judged against the singer's own key
 *
 * Time: everything runs on the AudioContext clock the microphone shares.
 * Music is scheduled ahead; the screen follows the moment it is heard (the
 * output latency later); the voice is placed on the take's clock with the
 * measured round-trip latency taken off, so a note sung with the music lines
 * up with it.
 *
 * The engine knows nothing about React: the practice page calls frame() from
 * requestAnimationFrame, feeds voice frames with voice(), and listens to on().
 */
import type { BackingMap, Model, Strictness } from '../lib/types.ts';
import { audio } from './audio.ts';
import type { LineNote, Vowel } from './audio.ts';
import { chord as chordNotes, midiOf, parseChord } from './theory.ts';
import { BANDS, CLEAN, ST_FREE, applyOffset, judgeNote, summarize, voiceUse } from './judge.ts';
import type { NoteResult, TFrame, TakeSummary, Target } from './judge.ts';
import type { VoiceFrame } from './mic.ts';
import { midiToHz } from './pitch.ts';

export type SingMode = 'listen' | 'echo' | 'sing' | 'solo';
export type Guide = 'voice' | 'piano' | 'start' | 'off';

export interface EngineConfig {
  mode: SingMode;
  from: number;
  to: number;
  tempo: number;
  shift: number;
  loop: boolean;
  guide: Guide;
  vowel: Vowel;
  accomp: boolean;
  metronome: boolean;
  countIn: boolean;
  drone: boolean;
  strictness: Strictness;
  latencyMs: number;
  verse: number;
  /** Judge the written octave too (range work). */
  exact?: boolean;
  /**
   * The recording the song was made from: played in place of the piano (at its own key and speed).
   * `buffer` is what plays (the recording, or its voice or music alone); `singer` whether the
   * recording's singer is heard in it (then no guide voice doubles them); `original` the whole
   * recording, for Echo's phrase to hear.
   */
  backing?: { buffer: AudioBuffer; map: BackingMap; withVoice: boolean; singer: boolean; original: AudioBuffer } | null;
}

/** What plays along with a take, which can change while it runs. */
export type LiveSettings = Pick<EngineConfig, 'guide' | 'vowel' | 'accomp' | 'metronome' | 'countIn' | 'drone' | 'loop' | 'strictness' | 'backing'>;

export interface PassResult {
  mode: SingMode;
  from: number;
  to: number;
  tempo: number;
  shift: number;
  /** This pass's own time (its count-in included, pauses not): looped passes never repeat an earlier pass's time. */
  durationMs: number;
  complete: boolean;
  summary: TakeSummary;
  results: NoteResult[];
  offset: number;
  voicedMs: number;
  cycles: number;
  map: number[][];
  frames: TFrame[];
  pass: number;
}

export type EngineEvent =
  | { type: 'state' }
  | { type: 'note'; result: NoteResult }
  | { type: 'pass'; result: PassResult }
  | { type: 'phrase'; phrase: number; clean: boolean; tries: boolean[] }
  | { type: 'count'; beat: number; of: number };

type State = 'idle' | 'countin' | 'running' | 'done';
export type EchoPhase = 'hear' | 'yours' | 'between';

/** A melody note of the stretch, on the take's clock (seconds from its first beat). */
export interface StageNote extends Target {
  /** Song position in quarter notes. */
  q: number;
  dq: number;
  syl: string;
}

const AHEAD = 0.25;

export class Engine {
  readonly model: Model;
  cfg: EngineConfig;
  state: State = 'idle';
  /** All melody notes of the stretch (transposed). */
  notes: StageNote[] = [];
  /** Song position (quarter notes) at the moment heard now. */
  pos = 0;
  /** Seconds into the take as heard now. */
  heard = 0;
  q0 = 0;
  q1 = 0;
  secPerQ = 0.5;
  /** Live: the note being sung now and the next one. */
  current: StageNote | null = null;
  next: StageNote | null = null;
  /** Per note result of the take in progress (index into notes). */
  judged: (NoteResult | null)[] = [];
  /** The take's voice so far, on the take's clock. */
  frames: TFrame[] = [];
  pass = 0;
  lastResult: PassResult | null = null;
  // Echo
  phrases: { i: number; a: number; b: number }[] = [];
  echoIndex = 0;
  echoPhase: EchoPhase = 'between';
  echoTries: boolean[] = [];
  /** Seconds on the take clock where the current phrase's notes are placed. */
  echoOffset = 0;
  private listeners = new Set<(e: EngineEvent) => void>();
  /** Context time of the take's first beat (sound scheduled). */
  t0 = 0;
  private outLat = 0;
  /** Round-trip latency removed from the voice (s). */
  lat = 0;
  private spanS = 0;
  private finalized = -1;
  private countBeats = 0;
  private beatS = 0.5;
  private lastCount = -1;
  private echoEnd = 0;
  private echoAttempt: NoteResult[] = [];
  private echoAll = new Map<number, NoteResult>();
  /** Echo: the voice of the attempts already over (each attempt's frames are cleared for the next one), counted once each. */
  private echoUse = { voicedMs: 0, cycles: 0, cells: new Map<string, number>() };
  /** When the pass under way began (the take's start, or the end of the pass before it on a loop). */
  private startedAt = 0;

  constructor(model: Model, cfg: EngineConfig) {
    this.model = model;
    this.cfg = cfg;
    this.layout();
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  setConfig(c: Partial<EngineConfig>): void {
    this.stop();
    this.cfg = { ...this.cfg, ...c };
    this.layout();
    this.emit({ type: 'state' });
  }

  /** The melody of the chosen bars, transposed, on the take's clock. */
  private layout(): void {
    const m = this.model;
    const bars = m.bars;
    const first = bars.find((b) => b.n === this.cfg.from) ?? bars[0];
    const last = [...bars].reverse().find((b) => b.n === this.cfg.to) ?? bars[bars.length - 1];
    this.q0 = first?.t ?? 0;
    this.q1 = last === undefined ? m.total : last.t + last.len;
    this.secPerQ = 60 / Math.max(10, (m.tempo * this.cfg.tempo) / 100);
    const beat = m.beat || 1;
    this.beatS = beat * this.secPerQ;
    const lyr = m.lyrics?.[Math.min((m.lyrics?.length ?? 1) - 1, Math.max(0, this.cfg.verse - 1))] ?? [];
    this.notes = [];
    (m.melody ?? []).forEach((n, i) => {
      if (n[0] < this.q0 - 1e-6 || n[0] >= this.q1 - 1e-6) return;
      const bar = bars[n[3]];
      this.notes.push({
        i,
        q: n[0],
        dq: n[1],
        t: (n[0] - this.q0) * this.secPerQ,
        d: n[1] * this.secPerQ,
        midi: n[2] + this.cfg.shift,
        flags: n[4],
        bar: bar?.n ?? 0,
        phrase: n[5],
        syl: lyr[i] ?? '',
      });
    });
    this.spanS = (this.q1 - this.q0) * this.secPerQ;
    // Echo phrases: the melody's phrases inside the stretch.
    const ph = new Map<number, { i: number; a: number; b: number }>();
    for (const n of this.notes) {
      const p = ph.get(n.phrase) ?? { i: n.phrase, a: n.t, b: n.t + n.d };
      p.a = Math.min(p.a, n.t);
      p.b = Math.max(p.b, n.t + n.d);
      ph.set(n.phrase, p);
    }
    this.phrases = [...ph.values()].sort((a, b) => a.a - b.a);
    this.judged = this.notes.map(() => null);
    this.pos = this.q0;
  }

  get running(): boolean {
    return this.state === 'countin' || this.state === 'running';
  }

  /** Seconds of the stretch at this tempo. */
  get seconds(): number {
    return this.spanS;
  }

  start(): void {
    const ctx = audio.ensure();
    this.stop();
    this.outLat = audio.outputLatency();
    this.lat = this.cfg.latencyMs > 0 ? this.cfg.latencyMs / 1000 : this.outLat + 0.03;
    this.pass = 0;
    this.echoIndex = 0;
    this.echoTries = [];
    this.echoAll.clear();
    this.echoUse = { voicedMs: 0, cycles: 0, cells: new Map() };
    this.startedAt = performance.now();
    const meter = this.model.meter;
    const beatsPerBar = meter.q > 0 ? Math.max(1, Math.round(meter.q / (this.model.beat || 1))) : 4;
    this.countBeats = this.cfg.countIn || this.cfg.mode === 'solo' ? beatsPerBar : this.cfg.mode === 'listen' ? 0 : 1;
    const lead = 0.18 + this.countBeats * this.beatS + (this.cfg.mode === 'solo' ? this.beatS * beatsPerBar : 0);
    this.t0 = ctx.currentTime + lead;
    if (this.cfg.drone) audio.drone(this.tonic());
    this.cue(ctx.currentTime + 0.12);
    this.beginPass(this.t0);
    this.state = this.countBeats > 0 || this.cfg.mode === 'solo' ? 'countin' : 'running';
    this.emit({ type: 'state' });
  }

  /** The key's tonic near the melody (for the drone and the key chord). */
  private tonic(): number {
    const k = this.model.key;
    const pcs = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
    const majorPc = pcs[((k.fifths % 12) + 12) % 12] ?? 0;
    const pc = (k.mode === 'minor' ? majorPc + 9 : majorPc) % 12;
    const ref = this.notes.length > 0 ? Math.min(...this.notes.map((n) => n.midi)) : 60;
    let t = pc + this.cfg.shift;
    while (t + 12 <= ref) t += 12;
    while (t > ref) t -= 12;
    return t;
  }

  /** Before the first beat: the count-in clicks; in Solo the key chord and the starting note first. */
  private cue(at: number): void {
    const meter = this.model.meter;
    const beatsPerBar = meter.q > 0 ? Math.max(1, Math.round(meter.q / (this.model.beat || 1))) : 4;
    let t = at;
    if (this.cfg.mode === 'solo') {
      const tonic = this.tonic();
      const minor = this.model.key.mode === 'minor';
      const tri = [tonic, tonic + (minor ? 3 : 4), tonic + 7];
      for (const m of tri) audio.play(m + 12 * (tonic < 48 ? 1 : 0), 62, t, this.beatS * beatsPerBar * 0.9, 'cue');
      const firstNote = this.notes[0];
      if (firstNote !== undefined) audio.singLine([{ midi: firstNote.midi, t: t + this.beatS * beatsPerBar * 0.45, d: this.beatS * beatsPerBar * 0.5 }], { vowel: this.cfg.vowel }, 'cue');
      t += this.beatS * beatsPerBar;
    }
    for (let b = 0; b < this.countBeats; b++) audio.click(t + b * this.beatS, b === 0);
  }

  /** Schedule one pass of the stretch at `t0` (sing / solo / listen) or the first echo phrase. */
  private beginPass(t0: number): void {
    this.t0 = t0;
    this.frames = [];
    this.judged = this.notes.map(() => null);
    this.finalized = -1;
    this.lastCount = -1;
    if (this.cfg.mode === 'echo') {
      this.startPhrase(t0);
      return;
    }
    const on = this.parts();
    // The recording plays the take: Listen hears the original singer.
    if (on.rec) this.playRecording();
    if (on.guideVoice) this.singNotes(this.notes, t0);
    if (on.guidePiano) for (const n of this.notes) if (!(n.flags & 1)) audio.play(n.midi, 76, t0 + n.t, n.d * 0.95, 'guide');
    if (this.cfg.mode === 'sing' && this.cfg.guide === 'start') {
      const f = this.notes[0];
      if (f !== undefined) audio.singLine([{ midi: f.midi, t: t0 + f.t, d: Math.min(f.d, this.beatS * 1.5) }], { vowel: this.cfg.vowel }, 'cue');
    }
    if (on.piano) this.accompany(t0, 0, this.spanS);
    if (this.cfg.metronome || this.cfg.mode === 'solo') this.clicks(t0, 0, this.spanS, this.cfg.mode === 'solo' ? 0.6 : 1);
  }

  /** The recording plays: there is one, at its own key and full speed, and the take is not unaccompanied. */
  backingOn(): boolean {
    return this.cfg.backing != null && this.cfg.tempo === 100 && this.cfg.shift === 0 && this.cfg.mode !== 'solo';
  }

  /** What sounds in a pass under the settings now: the recording, the guide (voice or piano), the piano accompaniment. */
  private parts(): { rec: boolean; guideVoice: boolean; guidePiano: boolean; piano: boolean } {
    const rec = this.backingOn();
    // The recording's own singer is the guide while they are heard.
    const singer = rec && this.cfg.backing!.singer;
    const solo = this.cfg.mode === 'solo';
    return {
      rec,
      guideVoice: !solo && ((this.cfg.guide === 'voice' && !singer) || (this.cfg.mode === 'listen' && !rec)),
      guidePiano: !solo && this.cfg.guide === 'piano' && this.cfg.mode !== 'listen' && !singer,
      piano: this.cfg.accomp && !solo && !rec,
    };
  }

  /** The recording for this pass, from wherever the pass is now (its start when it has not begun). */
  private playRecording(): void {
    const b = this.cfg.backing!;
    audio.playBacking(b.buffer, this.t0, this.audioAt(this.q0), this.spanS, this.cfg.mode === 'listen' ? true : b.withVoice);
  }

  /**
   * What plays along changed during a take (the recording's voice or music,
   * the guide, the piano, the drone, the metronome, the loop, the count-in,
   * the strictness): it changes from this moment and the take carries on.
   * Nothing starts over.
   */
  setLive(next: Partial<LiveSettings>): void {
    const before = this.cfg;
    const was = this.parts();
    this.cfg = { ...this.cfg, ...next, backing: next.backing !== undefined ? next.backing : (this.cfg.backing ?? null) };
    if (!this.running) return;
    const now = this.parts();
    if (before.drone !== this.cfg.drone) audio.drone(this.cfg.drone ? this.tonic() : null);
    if (this.cfg.mode === 'echo') {
      if (before.backing !== this.cfg.backing || before.accomp !== this.cfg.accomp) this.swapYours();
      return;
    }
    // From the next moment of the pass (the whole pass during its count-in).
    const a = Math.max(0, audio.now() + 0.03 - this.t0);
    if (before.backing !== this.cfg.backing || was.rec !== now.rec) {
      audio.stopTags(['recording']);
      if (now.rec) this.playRecording();
    }
    if (was.guideVoice !== now.guideVoice || was.guidePiano !== now.guidePiano || (now.guideVoice && before.vowel !== this.cfg.vowel)) {
      audio.stopTags(['guide']);
      const rest = this.notes.filter((n) => n.t >= a);
      if (now.guideVoice) this.singNotes(rest, this.t0);
      if (now.guidePiano) for (const n of rest) if (!(n.flags & 1)) audio.play(n.midi, 76, this.t0 + n.t, n.d * 0.95, 'guide');
    }
    if (was.piano !== now.piano) {
      audio.stopTags(['piano']);
      if (now.piano) this.accompany(this.t0, a, this.spanS);
    }
    if (before.metronome !== this.cfg.metronome && this.cfg.mode !== 'solo') {
      audio.stopTags(['metro']);
      if (this.cfg.metronome) this.clicks(this.t0, a, this.spanS);
    }
  }

  /** Paused by the person (the audio clock stands still; the take is still under way). */
  paused = false;
  private pausedAt = 0;

  pause(): void {
    if (!this.running || this.paused) return;
    audio.pause();
    this.paused = true;
    this.pausedAt = performance.now();
    this.emit({ type: 'state' });
  }

  resume(): void {
    if (!this.paused) return;
    audio.resume();
    this.paused = false;
    // The pause is not part of the take's length.
    this.startedAt += performance.now() - this.pausedAt;
    this.emit({ type: 'state' });
  }

  /** Echo: the part to sing over in the phrase under way, with the recording as it is now. */
  private swapYours(): void {
    const p = this.echoPhrase;
    if (p === null) return;
    const now = audio.now();
    if (now >= this.yoursAt + p.len) return;
    audio.stopTags(['yours']);
    if (this.backingOn()) {
      const b = this.cfg.backing!;
      audio.playBacking(b.buffer, this.yoursAt, this.audioAt(this.q0 + p.a / this.secPerQ), p.len, b.withVoice, 'yours');
    } else if (this.cfg.accomp) this.accompany(this.yoursAt - p.a, p.a + Math.max(0, now + 0.03 - this.yoursAt), p.b, 0, 'yours');
  }

  /** Seconds into the recording where quarter note q of the song sounds (between the beats found). */
  private audioAt(q: number): number {
    const m = this.cfg.backing!.map;
    const beats = m.beats;
    const x = m.downbeat + (q - m.bar1_q) / (m.beat_q || 1);
    const n = beats.length;
    if (n < 2) return 0;
    const k = Math.floor(x);
    if (k < 0) return beats[0]! + x * (beats[1]! - beats[0]!);
    if (k >= n - 1) return beats[n - 1]! + (x - (n - 1)) * (beats[n - 1]! - beats[n - 2]!);
    return beats[k]! + (x - k) * (beats[k + 1]! - beats[k]!);
  }

  private singNotes(notes: StageNote[], t0: number, shift = 0): void {
    // One line per phrase: legato inside, a breath between.
    const groups = new Map<number, LineNote[]>();
    for (const n of notes) {
      if (n.flags & 1) continue;
      const g = groups.get(n.phrase) ?? [];
      g.push({ midi: n.midi, t: t0 + n.t + shift, d: n.d * 0.97, st: (n.flags & 8) !== 0 });
      groups.set(n.phrase, g);
    }
    for (const g of groups.values()) audio.singLine(g, { vowel: this.cfg.vowel });
  }

  /** The piano between a and b seconds of the take: a written piano part as written, else the chord symbols. */
  private accompany(t0: number, a: number, b: number, shift = 0, tag = 'piano'): void {
    const m = this.model;
    const chords = m.chords ?? [];
    const written = m.notes.some((n) => n[6] !== (m.melodyVoice ?? 0));
    if (chords.length > 0 && !written) {
      for (let i = 0; i < chords.length; i++) {
        const [q, sym] = chords[i]!;
        const qEnd = i + 1 < chords.length ? chords[i + 1]![0] : m.total;
        const s0 = (Math.max(q, this.q0) - this.q0) * this.secPerQ;
        const s1 = (Math.min(qEnd, this.q1) - this.q0) * this.secPerQ;
        if (s1 <= a || s0 >= b || s1 <= s0) continue;
        const pc = parseChord(sym);
        if (pc === null) continue;
        const notes = chordNotes(pc.root, pc.type).map((x) => midiOf(x));
        let root = (notes[0] ?? 60) + this.cfg.shift;
        while (root >= 50) root -= 12;
        while (root < 38) root += 12;
        const bass = pc.bass !== null ? ((midiOf(pc.bass) + this.cfg.shift) % 12) + 36 : root;
        const upper = notes.map((n) => {
          let x = n + this.cfg.shift;
          while (x < 55) x += 12;
          while (x > 67) x -= 12;
          return x;
        });
        const at = t0 + Math.max(s0, a) + shift;
        const len = Math.min(s1, b) - Math.max(s0, a);
        audio.play(bass, 64, at, len * 0.98, tag);
        // The chord on each beat in a soft, broken pattern.
        const beats = Math.max(1, Math.round(len / this.beatS));
        for (let k = 0; k < beats; k++) {
          const tk = at + k * this.beatS;
          const vel = k === 0 ? 50 : 40;
          for (const u of upper) audio.play(u, vel, tk + (k === 0 ? 0 : 0.01), this.beatS * 0.9, tag);
        }
      }
      return;
    }
    // A written accompaniment (or no chord symbols): the other voices play as written.
    const mv = m.melodyVoice ?? 0;
    for (const n of m.notes) {
      if (n[6] === mv) continue;
      if (n[0] < this.q0 - 1e-6 || n[0] >= this.q1 - 1e-6) continue;
      const s = (n[0] - this.q0) * this.secPerQ;
      if (s < a || s >= b) continue;
      audio.play(n[2] + this.cfg.shift, Math.min(70, n[5] || 64), t0 + s + shift, n[1] * this.secPerQ * 0.95, tag);
    }
  }

  private clicks(t0: number, a: number, b: number, level = 1): void {
    const meter = this.model.meter;
    const beatsPerBar = meter.q > 0 ? Math.max(1, Math.round(meter.q / (this.model.beat || 1))) : 4;
    const firstBar = this.model.bars.find((x) => x.n === this.cfg.from);
    const startQ = firstBar?.t ?? this.q0;
    for (let s = a; s < b - 1e-6; s += this.beatS) {
      const q = this.q0 + s / this.secPerQ;
      const beatInBar = Math.round((q - startQ) / (this.model.beat || 1));
      if (level >= 1 || beatInBar % beatsPerBar === 0) audio.click(t0 + s, beatInBar % beatsPerBar === 0, 'metro');
    }
  }

  /* ---------------------------------------------------------------- echo */

  private startPhrase(at: number): void {
    const p = this.phrases[this.echoIndex];
    if (p === undefined) return;
    const notes = this.notes.filter((n) => n.phrase === p.i);
    const len = p.b - p.a;
    // Hear: the guide sings the phrase from `at`; Yours: the same notes one bar later.
    const gap = Math.max(this.beatS * 2, 0.8);
    this.echoOffset = at - this.t0 - p.a;
    const rec = this.backingOn();
    const from = rec ? this.audioAt(this.q0 + p.a / this.secPerQ) : 0;
    // Hear: the original singer when there is a recording, else the guide voice.
    if (rec) audio.playBacking(this.cfg.backing!.original, at, from, len, true);
    else this.singNotes(notes, at - p.a);
    if (this.cfg.accomp && !rec) this.accompany(at - p.a, p.a, p.b);
    const yoursAt = at + len + gap;
    for (let b = 0; b < 2; b++) audio.click(yoursAt - gap + gap * 0.5 + b * (gap / 4), b === 0);
    if (rec) audio.playBacking(this.cfg.backing!.buffer, yoursAt, from, len, this.cfg.backing!.withVoice, 'yours');
    else if (this.cfg.accomp) this.accompany(yoursAt - p.a, p.a, p.b, 0, 'yours');
    this.echoPhrase = { a: p.a, b: p.b, len };
    this.clicks(yoursAt - p.a, p.a, p.b, 0.6);
    this.echoPhase = 'hear';
    this.echoEnd = yoursAt + len;
    this.echoAttempt = [];
    this.yoursAt = yoursAt;
    this.hearAt = at;
    for (const n of notes) this.judged[this.notes.indexOf(n)] = null;
  }

  private yoursAt = 0;
  private hearAt = 0;
  /** The phrase under way in Echo (seconds of the stretch) and its length. */
  private echoPhrase: { a: number; b: number; len: number } | null = null;

  /* ------------------------------------------------------------- the clock */

  stop(): void {
    if (this.paused) {
      this.paused = false;
      audio.resume();
    }
    if (this.state === 'idle' || this.state === 'done') {
      this.state = 'idle';
      return;
    }
    audio.stopAll(false);
    this.state = 'idle';
    this.emit({ type: 'state' });
  }

  /** The take's clock: seconds since the first beat, as heard now. */
  private heardNow(): number {
    return audio.now() - this.outLat - this.t0;
  }

  /** A voice frame from the microphone. */
  voice(f: VoiceFrame): void {
    if (!this.running) return;
    const s = f.t - this.lat - this.t0;
    if (this.cfg.mode === 'echo') {
      // Only the "yours" window counts; placed on the phrase's own clock.
      const ys = f.t - this.lat - this.yoursAt;
      const p = this.phrases[this.echoIndex];
      if (p === undefined || ys < -0.3 || ys > p.b - p.a + 0.3) return;
      this.frames.push({ s: p.a + ys, midi: f.voiced ? f.midi : NaN, db: f.db });
      return;
    }
    if (s < -0.4 || s > this.spanS + 0.4) return;
    this.frames.push({ s, midi: f.voiced ? f.midi : NaN, db: f.db });
  }

  /** Advance: call once per animation frame. */
  frame(): void {
    if (!this.running) return;
    const ctxNow = audio.now();
    if (this.cfg.mode === 'echo') {
      this.echoFrame(ctxNow);
      return;
    }
    const h = this.heardNow();
    this.heard = h;
    if (h < 0) {
      const beat = Math.floor(-h / this.beatS);
      if (beat !== this.lastCount && beat < this.countBeats) {
        this.lastCount = beat;
        this.emit({ type: 'count', beat: this.countBeats - beat, of: this.countBeats });
      }
    } else if (this.state === 'countin') {
      this.state = 'running';
      this.emit({ type: 'state' });
    }
    this.pos = this.q0 + Math.max(0, h) / this.secPerQ;
    this.track(h);
    // Judge each note once its window (and a little after) has passed on the singer's clock.
    const sung = ctxNow - this.lat - this.t0;
    this.judgeUpTo(sung);
    if (h >= this.spanS + 0.15 && sung >= this.spanS + 0.25) this.endPass(ctxNow);
  }

  private track(h: number): void {
    let cur: StageNote | null = null;
    let nxt: StageNote | null = null;
    for (const n of this.notes) {
      if (n.t <= h + 0.02 && h < n.t + n.d) cur = n;
      if (n.t > h + 0.02) {
        nxt = n;
        break;
      }
    }
    // Between notes, the coming note is the target.
    this.current = cur ?? (nxt !== null && nxt.t - h < 0.6 ? nxt : this.current !== null && h - (this.current.t + this.current.d) < 0.3 ? this.current : null);
    this.next = nxt;
  }

  private judgeUpTo(sung: number): void {
    const bands = BANDS[this.cfg.strictness];
    for (let i = this.finalized + 1; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (sung < n.t + n.d + 0.12) break;
      const r = judgeNote(this.frames, n, bands, this.cfg.exact === true);
      this.judged[i] = r;
      this.finalized = i;
      if (this.cfg.mode !== 'listen') this.emit({ type: 'note', result: r });
    }
  }

  private endPass(ctxNow: number): void {
    const result = this.makeResult(this.notes, true);
    this.lastResult = result;
    this.pass += 1;
    this.emit({ type: 'pass', result });
    if (this.cfg.loop && this.cfg.mode !== 'listen') {
      // The next pass's time starts now: each pass is saved on its own, so its length is its own.
      this.startedAt = performance.now();
      // The next pass after one bar's rest with a count-in.
      const meter = this.model.meter;
      const beatsPerBar = meter.q > 0 ? Math.max(1, Math.round(meter.q / (this.model.beat || 1))) : 4;
      const next = ctxNow + 0.1 + beatsPerBar * this.beatS;
      this.countBeats = beatsPerBar;
      this.cue(next - beatsPerBar * this.beatS + (this.cfg.mode === 'solo' ? -beatsPerBar * this.beatS : 0));
      this.beginPass(next);
      this.state = 'countin';
      this.emit({ type: 'state' });
      return;
    }
    this.state = 'done';
    if (this.cfg.drone) audio.drone(null);
    this.emit({ type: 'state' });
  }

  private makeResult(notes: StageNote[], complete: boolean): PassResult {
    const bands = BANDS[this.cfg.strictness];
    const results: NoteResult[] = notes.map((n) => {
      const idx = this.notes.indexOf(n);
      const r = this.cfg.mode === 'echo' ? this.echoAll.get(n.i) : this.judged[idx];
      return r ?? judgeNote(this.frames, n, bands, this.cfg.exact === true);
    });
    const offset = this.cfg.mode === 'solo' ? applyOffset(results, bands) : 0;
    const summary = summarize(results, bands, this.cfg.strictness);
    const use = this.voiceOfTake();
    return {
      mode: this.cfg.mode,
      from: this.cfg.from,
      to: this.cfg.to,
      tempo: this.cfg.tempo,
      shift: this.cfg.shift,
      durationMs: Math.round(performance.now() - this.startedAt),
      complete,
      summary,
      results,
      offset,
      voicedMs: use.voicedMs,
      cycles: use.cycles,
      map: use.map,
      frames: this.frames.slice(),
      pass: this.pass,
    };
  }

  /** The take's voiced time, cycles and voice map: its frames, and in Echo the attempts already over too. */
  private voiceOfTake(): { voicedMs: number; cycles: number; map: number[][] } {
    const use = voiceUse(this.frames, midiToHz);
    if (this.cfg.mode !== 'echo') return use;
    const cells = new Map(this.echoUse.cells);
    for (const [m = 0, b = 0, n = 0] of use.map) cells.set(m + ':' + b, (cells.get(m + ':' + b) ?? 0) + n);
    return {
      voicedMs: this.echoUse.voicedMs + use.voicedMs,
      cycles: this.echoUse.cycles + use.cycles,
      map: [...cells.entries()].map(([k, n]) => {
        const [m, b] = k.split(':');
        return [Number(m), Number(b), n];
      }),
    };
  }

  /** Echo: an attempt is over (judged or skipped): its voice joins the take's, once, and its frames are cleared for the next. */
  private closeAttempt(): void {
    const use = voiceUse(this.frames, midiToHz);
    this.echoUse.voicedMs += use.voicedMs;
    this.echoUse.cycles += use.cycles;
    for (const [m = 0, b = 0, n = 0] of use.map) this.echoUse.cells.set(m + ':' + b, (this.echoUse.cells.get(m + ':' + b) ?? 0) + n);
    this.frames = [];
  }

  private echoFrame(ctxNow: number): void {
    const p = this.phrases[this.echoIndex];
    if (p === undefined) return;
    const len = p.b - p.a;
    const hearH = ctxNow - this.outLat - this.hearAt;
    const yoursH = ctxNow - this.outLat - this.yoursAt;
    if (hearH < 0) {
      this.state = 'countin';
      this.echoPhase = 'between';
    } else if (this.state === 'countin') {
      this.state = 'running';
      this.emit({ type: 'state' });
    }
    if (hearH >= 0 && hearH < len + 0.05) {
      this.echoPhase = 'hear';
      this.heard = p.a + hearH;
    } else if (yoursH >= -0.05 && yoursH < len + 0.25) {
      this.echoPhase = 'yours';
      this.heard = p.a + Math.max(0, yoursH);
    } else this.echoPhase = 'between';
    this.pos = this.q0 + this.heard / this.secPerQ;
    this.track(this.heard);
    if (ctxNow - this.lat >= this.echoEnd + 0.25) {
      // Judge the attempt.
      const bands = BANDS[this.cfg.strictness];
      const ns = this.notes.filter((n) => n.phrase === p.i);
      const rs = ns.map((n) => judgeNote(this.frames, n, bands, false));
      ns.forEach((n, k) => {
        this.judged[this.notes.indexOf(n)] = rs[k]!;
        this.echoAll.set(n.i, rs[k]!);
        this.emit({ type: 'note', result: rs[k]! });
      });
      const scored = rs.filter((r) => r.status !== ST_FREE);
      const T = CLEAN[this.cfg.strictness];
      const ok = scored.length > 0 && scored.filter((r) => r.status === 1 || r.status === 2).length / scored.length >= T.pitch;
      this.echoTries.push(ok);
      const last3 = this.echoTries.slice(-3);
      const passed = last3.filter((x) => x).length >= 2;
      this.emit({ type: 'phrase', phrase: this.echoIndex, clean: ok, tries: this.echoTries.slice() });
      this.closeAttempt();
      const nextAt = ctxNow + 0.6;
      if (passed) {
        this.echoIndex += 1;
        this.echoTries = [];
        if (this.echoIndex >= this.phrases.length) {
          this.finishEcho();
          return;
        }
      }
      this.startPhrase(nextAt);
    }
  }

  /**
   * Echo: the last phrase is over, sung or skipped. The take ends once, as one
   * pass, like a take that is not looped: it is done before the result goes
   * out (so Loop never keeps the recorder going, Echo does not loop) and the
   * drone stops.
   */
  private finishEcho(): void {
    const result = this.makeResult(this.notes, true);
    this.lastResult = result;
    this.pass += 1;
    this.state = 'done';
    this.echoPhase = 'between';
    if (this.cfg.drone) audio.drone(null);
    this.emit({ type: 'pass', result });
    this.emit({ type: 'state' });
  }

  /** Move on to the next echo phrase without waiting (the person chooses to). */
  skipPhrase(): void {
    if (this.cfg.mode !== 'echo' || !this.running) return;
    audio.stopAll(true);
    this.echoIndex += 1;
    this.echoTries = [];
    this.closeAttempt();
    if (this.echoIndex >= this.phrases.length) {
      this.finishEcho();
      return;
    }
    this.startPhrase(audio.now() + 0.4);
  }

  /** Stop now and, for a sung take, give what was judged so far (incomplete). */
  finishEarly(): PassResult | null {
    if (!this.running) return null;
    const judgedNotes = this.notes.filter((_, i) => this.judged[i] !== null);
    const res = judgedNotes.length >= 3 && this.cfg.mode !== 'listen' ? this.makeResult(judgedNotes, false) : null;
    this.stop();
    return res;
  }
}

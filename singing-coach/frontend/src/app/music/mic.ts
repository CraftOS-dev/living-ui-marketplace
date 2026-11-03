/**
 * The microphone: one voice, as a stream of pitch frames on the audio clock.
 *
 * Capture asks the browser for the raw signal (echo cancellation, noise
 * suppression and automatic gain all off: speech filters damage a singing
 * voice). A 60 Hz high-pass takes out rumble and handling noise, and a
 * stereo microphone is mixed down to one channel (some put the voice on one
 * side only). The pitch comes from the MPM worklet (pitch.ts) about 94 times a
 * second; this module decides which frames are voiced (clarity and loudness
 * over the room's noise, with hysteresis so a note does not flicker), smooths
 * the pitch with a running median of five frames, and guards against octave
 * jumps (a jump of an octave must hold for four frames before it is
 * believed).
 *
 * Nothing touches the microphone until start() is called from a click (the
 * install check fails on console errors while loading, and browsers want a
 * gesture). Inside CraftBot's frame the microphone is allowed; elsewhere a
 * blocked permission is reported, never thrown.
 */
import { audio } from './audio.ts';
import { WORKLET_SOURCE, hzToMidi, mpm } from './pitch.ts';
import type { RawFrame } from './pitch.ts';

export type MicStatus = 'off' | 'starting' | 'on' | 'denied' | 'blocked' | 'missing' | 'unsupported' | 'insecure';

export interface VoiceFrame {
  /** Context time (s) of the frame. */
  t: number;
  hz: number;
  /** Smoothed pitch as a fractional MIDI note; NaN when not voiced. */
  midi: number;
  /** The pitch of this frame alone (fractional MIDI), NaN when none. */
  raw: number;
  clarity: number;
  db: number;
  voiced: boolean;
}

// A real voice through a laptop or USB microphone in a room reads 0.8-0.97;
// breathy or soft singing dips toward 0.7. Loudness keeps noise out.
const ON_CLARITY = 0.8;
const OFF_CLARITY = 0.62;
/** The loudness gate stays between these (dBFS), whatever the room measures. */
const GATE_MIN = -66;
const GATE_MAX = -46;

function frameAllows(feature: string): boolean {
  const d = document as Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };
  const pol = d.permissionsPolicy ?? d.featurePolicy;
  if (pol === undefined) return true;
  try {
    return pol.allowsFeature(feature);
  } catch {
    return true;
  }
}

export class Mic {
  status: MicStatus = 'off';
  /** 0..1 for a level meter. */
  level = 0;
  db = -120;
  /** The room's noise floor in dBFS (tracked slowly; seeded from Settings). */
  noise = -70;
  device = '';
  stream: MediaStream | null = null;
  last: VoiceFrame | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private hp: BiquadFilterNode | null = null;
  /** Recent loudness of unvoiced frames: the room's floor is a low percentile of it. */
  private quiet: number[] = [];
  private quietTick = 0;
  private analyser: AnalyserNode | null = null;
  private timer: number | null = null;
  private frameFns = new Set<(f: VoiceFrame) => void>();
  private statusFns = new Set<(s: MicStatus) => void>();
  private voiced = false;
  private onCount = 0;
  private offCount = 0;
  private hist: number[] = [];
  private pendingOct = 0;
  private pendingCount = 0;
  private lastVoiceAt = 0;
  private moduleReady = new WeakSet<BaseAudioContext>();

  onFrame(fn: (f: VoiceFrame) => void): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  onStatus(fn: (s: MicStatus) => void): () => void {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }

  private set(s: MicStatus): void {
    this.status = s;
    for (const fn of this.statusFns) fn(s);
  }

  /** Seconds since a voiced frame (Infinity before any). */
  quietFor(): number {
    return this.lastVoiceAt === 0 ? Infinity : (performance.now() - this.lastVoiceAt) / 1000;
  }

  async devices(): Promise<{ id: string; label: string }[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || 'Microphone ' + (i + 1) }));
    } catch {
      return [];
    }
  }

  /** Start listening (call from a click). Resolves with the status. */
  async start(deviceId?: string): Promise<MicStatus> {
    if (this.status === 'on' || this.status === 'starting') return this.status;
    if (!window.isSecureContext) {
      this.set('insecure');
      return this.status;
    }
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      this.set('unsupported');
      return this.status;
    }
    if (!frameAllows('microphone')) {
      this.set('blocked');
      return this.status;
    }
    this.set('starting');
    const ctx = audio.ensure();
    try {
      const audioC: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
      if (deviceId !== undefined && deviceId !== '') audioC.deviceId = { exact: deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioC });
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      this.set(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : name === 'SecurityError' ? 'blocked' : 'denied');
      return this.status;
    }
    const track = this.stream.getAudioTracks()[0];
    this.device = track?.label ?? '';
    this.src = ctx.createMediaStreamSource(this.stream);
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 60;
    this.hp.Q.value = 0.7;
    // One channel whatever the device sends: a stereo input is averaged, not cut to its left side.
    this.hp.channelCount = 1;
    this.hp.channelCountMode = 'explicit';
    this.hp.channelInterpretation = 'speakers';
    this.src.connect(this.hp);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    let worklet = false;
    if (ctx.audioWorklet !== undefined) {
      try {
        if (!this.moduleReady.has(ctx)) {
          const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          this.moduleReady.add(ctx);
        }
        this.node = new AudioWorkletNode(ctx, 'sc-pitch', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        this.node.port.onmessage = (ev: MessageEvent<RawFrame>) => this.take(ev.data);
        this.hp.connect(this.node).connect(this.sink);
        worklet = true;
      } catch {
        worklet = false;
      }
    }
    if (!worklet) this.startPolling(ctx, this.hp);
    this.voiced = false;
    this.hist = [];
    this.quiet = [];
    this.set('on');
    return this.status;
  }

  /** Without AudioWorklet: poll an analyser on the main thread (same method, same rate). */
  private startPolling(ctx: AudioContext, src: AudioNode): void {
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    src.connect(an);
    this.analyser = an;
    const buf = new Float32Array(2048);
    const small = new Float32Array(1024);
    this.timer = window.setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < 1024; i++) {
        const v = ((buf[2 * i] ?? 0) + (buf[2 * i + 1] ?? 0)) * 0.5;
        small[i] = v;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / 1024);
      const db = rms > 1e-7 ? 20 * Math.log10(rms) : -140;
      let hz = 0;
      let clarity = 0;
      if (db > -75) {
        const r = mpm(small, ctx.sampleRate / 2, 55);
        hz = r.hz;
        clarity = r.clarity;
      }
      this.take({ t: ctx.currentTime - 1024 / ctx.sampleRate, hz, clarity, db });
    }, 11);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    try {
      this.src?.disconnect();
      this.hp?.disconnect();
      this.node?.disconnect();
      this.analyser?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already gone */
    }
    if (this.node !== null) this.node.port.onmessage = null;
    this.node = null;
    this.src = null;
    this.hp = null;
    this.analyser = null;
    this.sink = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.level = 0;
    this.db = -120;
    this.voiced = false;
    this.last = null;
    if (this.status === 'on' || this.status === 'starting') this.set('off');
  }

  private take(r: RawFrame): void {
    this.db = r.db;
    this.level = Math.max(0, Math.min(1, (r.db + 62) / 52));
    const gate = Math.min(GATE_MAX, Math.max(GATE_MIN, this.noise + 8));
    const loudEnough = r.db >= gate;
    const inRange = r.hz >= 55 && r.hz <= 1400;
    const want = this.voiced ? r.clarity >= OFF_CLARITY && r.db >= gate - 6 && inRange : r.clarity >= ON_CLARITY && loudEnough && inRange;
    if (want) {
      this.offCount = 0;
      this.onCount += 1;
      if (!this.voiced && this.onCount >= 2) this.voiced = true;
    } else {
      this.onCount = 0;
      this.offCount += 1;
      if (this.voiced && this.offCount >= 3) {
        this.voiced = false;
        this.hist = [];
        this.pendingCount = 0;
      }
    }
    // The room's noise: the 20th percentile of the last ~4 s of unvoiced frames
    // (breaths, consonants, the guide leaking in never pull it up past the gate's ceiling).
    if (!this.voiced && r.db > -120) {
      this.quiet.push(r.db);
      if (this.quiet.length > 380) this.quiet.shift();
      if (++this.quietTick % 24 === 0 && this.quiet.length >= 30) {
        const sorted = this.quiet.slice().sort((a, b) => a - b);
        this.noise = Math.max(-95, Math.min(GATE_MAX - 8, sorted[Math.floor(sorted.length * 0.2)]!));
      }
    }
    let raw = inRange && r.clarity > 0.5 ? hzToMidi(r.hz) : NaN;
    let midi = NaN;
    if (this.voiced && Number.isFinite(raw)) {
      const prev = this.hist.length > 0 ? this.median() : NaN;
      if (Number.isFinite(prev)) {
        const jump = raw - prev;
        const oct = Math.round(jump / 12);
        if (oct !== 0 && Math.abs(jump - oct * 12) < 1.2) {
          // An octave jump: believe it only when it holds.
          if (this.pendingOct === oct) this.pendingCount += 1;
          else {
            this.pendingOct = oct;
            this.pendingCount = 1;
          }
          if (this.pendingCount < 4) raw = raw - oct * 12;
          else {
            this.hist = [];
            this.pendingCount = 0;
          }
        } else this.pendingCount = 0;
      }
      this.hist.push(raw);
      if (this.hist.length > 5) this.hist.shift();
      midi = this.median();
      this.lastVoiceAt = performance.now();
    }
    const f: VoiceFrame = { t: r.t, hz: r.hz, midi, raw, clarity: r.clarity, db: r.db, voiced: this.voiced && Number.isFinite(midi) };
    this.last = f;
    for (const fn of this.frameFns) fn(f);
  }

  private median(): number {
    const s = this.hist.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? NaN;
  }
}

export const mic = new Mic();

/** Plain words for a microphone that is not on. */
export function micProblem(s: MicStatus): string {
  if (s === 'denied') return 'The microphone was not allowed. Allow it in the browser (the icon in the address bar), then try again.';
  if (s === 'blocked') return 'This window may not use the microphone. Open the app in its own tab and allow it there.';
  if (s === 'missing') return 'No microphone was found. Plug one in or choose another in Settings.';
  if (s === 'unsupported') return 'This browser cannot listen to a microphone. Use a recent Chrome, Edge, Firefox or Safari.';
  if (s === 'insecure') return 'Singing needs this computer or a secure (https) link: the browser only allows the microphone there. Lessons and charts work everywhere.';
  return '';
}

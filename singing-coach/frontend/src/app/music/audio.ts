/**
 * Sound: everything synthesised in the browser (nothing to download or
 * license), on one AudioContext that the microphone shares, so what is heard
 * and what is sung share one clock.
 *
 *   guide voice   a formant synthesiser: a bright source through five
 *                 band-pass resonances per vowel and voice register (the
 *                 Csound formant table for bass, tenor, alto and soprano),
 *                 gentle vibrato (5.5 Hz, ±35 cents) that fades in, soft
 *                 attack and release; a phrase is one continuous line, so
 *                 legato notes glide into each other like a singer's
 *   piano         the accompaniment: periodic-wave partials, a detuned pair,
 *                 a hammer, a closing filter, a two-stage decay, a room
 *   drone         the tonic and fifth on soft detuned saws, low-passed
 *   click         the metronome
 *
 * Each has its own volume. Browsers start audio only after a click or a key
 * press in the page; `unlockOnGesture()` resumes the context on the first one.
 *
 * Scheduling is just in time: a sound more than LOOKAHEAD seconds away is
 * queued and its nodes are made shortly before it plays. Making a whole
 * song's nodes up front (two thousand of them for a long song) overloads the
 * audio thread: the clock then runs slower than real time, every sound
 * arrives late and the microphone loses samples.
 */

export type Vowel = 'oo' | 'ah' | 'ee' | 'eh' | 'oh';
type Reg = 'bass' | 'tenor' | 'alto' | 'soprano';

// [frequencies Hz, levels dB, bandwidths Hz] per register and vowel (Csound manual, "Formant values").
const FORMANTS: Record<Reg, Record<'a' | 'e' | 'i' | 'o' | 'u', [number[], number[], number[]]>> = {
  bass: {
    a: [[600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]],
    e: [[400, 1620, 2400, 2800, 3100], [0, -12, -9, -12, -18], [40, 80, 100, 120, 120]],
    i: [[250, 1750, 2600, 3050, 3340], [0, -30, -16, -22, -28], [60, 90, 100, 120, 120]],
    o: [[400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]],
    u: [[350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]],
  },
  tenor: {
    a: [[650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]],
    e: [[400, 1700, 2600, 3200, 3580], [0, -14, -12, -14, -20], [70, 80, 100, 120, 120]],
    i: [[290, 1870, 2800, 3250, 3540], [0, -15, -18, -20, -30], [40, 90, 100, 120, 120]],
    o: [[400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]],
    u: [[350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]],
  },
  alto: {
    a: [[800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]],
    e: [[400, 1600, 2700, 3300, 4950], [0, -24, -30, -35, -60], [60, 80, 120, 150, 200]],
    i: [[350, 1700, 2700, 3700, 4950], [0, -20, -30, -36, -60], [50, 100, 120, 150, 200]],
    o: [[450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]],
    u: [[325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]],
  },
  soprano: {
    a: [[800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]],
    e: [[350, 2000, 2800, 3600, 4950], [0, -20, -15, -40, -56], [60, 100, 120, 150, 200]],
    i: [[270, 2140, 2950, 3900, 4950], [0, -12, -26, -26, -44], [60, 90, 100, 120, 120]],
    o: [[450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]],
    u: [[325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]],
  },
};

const VOWEL_KEY: Record<Vowel, 'a' | 'e' | 'i' | 'o' | 'u'> = { oo: 'u', ah: 'a', ee: 'i', eh: 'e', oh: 'o' };

/** Seconds ahead that sounds get their nodes; the queue is topped up every PUMP_MS. */
const LOOKAHEAD = 1.5;
const PUMP_MS = 100;

function regOf(midi: number): Reg {
  return midi < 52 ? 'bass' : midi < 60 ? 'tenor' : midi < 67 ? 'alto' : 'soprano';
}

function hz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

interface Voice {
  midi: number;
  /** What it belongs to ('piano', 'guide'…), so it can be stopped alone. */
  tag: string;
  osc: OscillatorNode[];
  hammer: AudioBufferSourceNode | null;
  gain: GainNode;
  started: number;
  ended: boolean;
}

/** A note of a sung line: start and length in context seconds. */
export interface LineNote {
  midi: number;
  t: number;
  d: number;
  /** A staccato note (shorter, lighter). */
  st?: boolean | undefined;
}

interface LineOpts {
  vowel?: Vowel | undefined;
  vel?: number | undefined;
  vibrato?: boolean | undefined;
  formants?: { f1: number; f2: number } | undefined;
}

interface Line {
  tag: string;
  src: OscillatorNode;
  lfo: OscillatorNode;
  amp: GainNode;
  end: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pianoBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private droneBus: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private backingBus: GainNode | null = null;
  private backings: { src: AudioBufferSourceNode; gain: GainNode; tag: string }[] = [];
  private waves = new Map<number, PeriodicWave>();
  private glottal: PeriodicWave | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private lines: Line[] = [];
  private queue: { at: number; run: () => void; tag: string }[] = [];
  private pumpTimer: number | null = null;
  private live = new Map<number, Voice>();
  private droneNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  /** Paused by the person: a click or a key elsewhere does not wake the sound. */
  private held = false;
  private volume = 0.8;
  private guideVolume = 0.7;
  private accompVolume = 0.55;
  private clickVolume = 0.5;

  /** The context, created and resumed on demand (call from a user gesture). */
  ensure(): AudioContext {
    if (this.ctx === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const dry = ctx.createGain();
      dry.gain.value = 0.88;
      const verb = ctx.createConvolver();
      verb.buffer = this.room(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      master.connect(dry).connect(comp);
      master.connect(verb).connect(wet).connect(comp);
      const piano = ctx.createGain();
      piano.gain.value = this.accompVolume;
      piano.connect(master);
      const voice = ctx.createGain();
      voice.gain.value = this.guideVolume;
      voice.connect(master);
      const drone = ctx.createGain();
      drone.gain.value = this.accompVolume * 0.8;
      drone.connect(master);
      const click = ctx.createGain();
      click.gain.value = this.clickVolume;
      click.connect(comp);
      // The recording a song was made from: straight to the output (it has its own room).
      const backing = ctx.createGain();
      backing.gain.value = this.accompVolume * 1.3;
      backing.connect(comp);
      this.backingBus = backing;
      this.ctx = ctx;
      this.master = master;
      this.pianoBus = piano;
      this.voiceBus = voice;
      this.droneBus = drone;
      this.clickGain = click;
      this.noise = this.makeNoise(ctx);
    }
    if (this.ctx.state === 'suspended' && !this.held) void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Pause everything at once (the clock stops, so whatever is scheduled waits where it is; the microphone too). */
  pause(): void {
    if (this.ctx === null) return;
    this.held = true;
    void this.ctx.suspend().catch(() => undefined);
  }

  /** Carry on from where pause() stopped. */
  resume(): void {
    this.held = false;
    if (this.ctx !== null && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Start audio on the first gesture anywhere in the page. */
  unlockOnGesture(): () => void {
    const go = (): void => {
      this.ensure();
    };
    window.addEventListener('pointerdown', go, { capture: true });
    window.addEventListener('keydown', go, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', go, { capture: true });
      window.removeEventListener('keydown', go, { capture: true });
    };
  }

  now(): number {
    return this.ctx === null ? 0 : this.ctx.currentTime;
  }

  /** Run `make` now when `at` is near, else queue it until it is. */
  private defer(at: number, make: () => void, tag = ''): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (at <= ctx.currentTime + LOOKAHEAD) {
      make();
      return;
    }
    this.queue.push({ at, run: make, tag });
    if (this.pumpTimer === null) this.pumpTimer = window.setInterval(() => this.pump(), PUMP_MS);
  }

  private pump(): void {
    const ctx = this.ctx;
    if (ctx === null || this.queue.length === 0) {
      if (this.pumpTimer !== null) window.clearInterval(this.pumpTimer);
      this.pumpTimer = null;
      return;
    }
    const until = ctx.currentTime + LOOKAHEAD;
    const due = this.queue.filter((q) => q.at <= until).sort((a, b) => a.at - b.at);
    if (due.length === 0) return;
    this.queue = this.queue.filter((q) => q.at > until);
    for (const q of due) q.run();
  }

  /** How long after a scheduled time the sound reaches the ears, in seconds. */
  outputLatency(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (c === null) return 0;
    const out = typeof c.outputLatency === 'number' && Number.isFinite(c.outputLatency) ? c.outputLatency : 0;
    return Math.min(0.3, out + (c.baseLatency || 0));
  }

  private ramp(g: GainNode | null, v: number): void {
    if (g !== null && this.ctx !== null) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.ramp(this.master, this.volume);
  }

  setGuideVolume(v: number): void {
    this.guideVolume = Math.max(0, Math.min(1, v));
    this.ramp(this.voiceBus, this.guideVolume);
  }

  setAccompVolume(v: number): void {
    this.accompVolume = Math.max(0, Math.min(1, v));
    this.ramp(this.pianoBus, this.accompVolume);
    this.ramp(this.droneBus, this.accompVolume * 0.8);
    this.ramp(this.backingBus, this.accompVolume * 1.3);
  }

  /**
   * Play part of a recording on the audio clock: from `offset` seconds into
   * it, at context time `when`, for `dur` seconds. Without the voice, the
   * left channel minus the right takes out what sits in the middle (the
   * singer, in most stereo mixes) and the middle's low end is kept, so the
   * bass and the kick drum stay.
   */
  playBacking(buf: AudioBuffer, when: number, offset: number, dur: number, withVoice: boolean, tag = 'recording'): void {
    const ctx = this.ctx;
    const bus = this.backingBus;
    if (ctx === null || bus === null || dur <= 0) return;
    let at = Math.max(when, ctx.currentTime);
    let off = offset + (at - when);
    let len = dur - (at - when);
    if (off < 0) {
      // The recording starts later than the take: wait for it.
      at -= off;
      len += off;
      off = 0;
    }
    if (len <= 0.02 || off >= buf.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(1, at + 0.03);
    gain.gain.setValueAtTime(1, Math.max(at + 0.03, at + len - 0.06));
    gain.gain.linearRampToValueAtTime(0.0001, at + len);
    if (!withVoice && buf.numberOfChannels >= 2) {
      const split = ctx.createChannelSplitter(2);
      src.connect(split);
      const side = ctx.createGain();
      const inv = ctx.createGain();
      inv.gain.value = -1;
      split.connect(side, 0);
      split.connect(inv, 1).connect(side);
      const mid = ctx.createGain();
      mid.gain.value = 0.5;
      split.connect(mid, 0);
      split.connect(mid, 1);
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 170;
      low.Q.value = 0.7;
      mid.connect(low).connect(gain);
      side.connect(gain);
    } else src.connect(gain);
    gain.connect(bus);
    src.start(at, off, len + 0.05);
    const entry = { src, gain, tag };
    this.backings.push(entry);
    src.addEventListener('ended', () => {
      gain.disconnect();
      this.backings = this.backings.filter((x) => x !== entry);
    });
  }

  setClickVolume(v: number): void {
    this.clickVolume = Math.max(0, Math.min(1, v));
    this.ramp(this.clickGain, this.clickVolume);
  }

  private room(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2.4);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.8) * (t < 0.014 ? t / 0.014 : 1);
      }
    }
    return buf;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ------------------------------------------------------------ the guide voice */

  /** A glottal-like source: harmonics falling about 12 dB an octave. */
  private source(ctx: AudioContext): PeriodicWave {
    if (this.glottal !== null) return this.glottal;
    const n = 40;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = 1 / k ** 1.6;
    this.glottal = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    return this.glottal;
  }

  /**
   * Sing a line of notes on a vowel, legato: one continuous voice whose pitch
   * glides from note to note; a gap of 60 ms or more between notes is a new
   * attack. Returns when the line ends (context seconds).
   */
  singLine(notes: LineNote[], opts: LineOpts = {}, tag = 'guide'): number {
    const ctx = this.ctx;
    if (ctx === null || this.voiceBus === null || notes.length === 0) return 0;
    const sorted = notes.slice().sort((a, b) => a.t - b.t);
    const t0 = Math.max(ctx.currentTime + 0.005, sorted[0]!.t);
    let end = t0;
    for (const n of sorted) end = Math.max(end, Math.max(t0, n.t) + Math.max(0.06, n.st ? n.d * 0.45 : n.d));
    this.defer(t0, () => this.lineNow(sorted, opts, tag), tag);
    return end;
  }

  private lineNow(sorted: LineNote[], opts: LineOpts, tag: string): void {
    const ctx = this.ctx;
    const bus = this.voiceBus;
    if (ctx === null || bus === null || sorted.length === 0) return;
    const mids = sorted.map((n) => n.midi).sort((a, b) => a - b);
    const reg = regOf(mids[Math.floor(mids.length / 2)] ?? 60);
    const table = FORMANTS[reg][VOWEL_KEY[opts.vowel ?? 'oo']];
    const [, dbs, bws] = table;
    let fs = table[0];
    if (opts.formants !== undefined) {
      // Any vowel: its first two resonances (adult male values, raised for higher voices), the rest from the table.
      const k = reg === 'soprano' ? 1.18 : reg === 'alto' ? 1.12 : reg === 'tenor' ? 1.04 : 1;
      fs = [opts.formants.f1 * k, opts.formants.f2 * k, ...fs.slice(2)];
    }
    const first = sorted[0]!;
    const t0 = Math.max(ctx.currentTime + 0.005, first.t);
    const src = ctx.createOscillator();
    src.setPeriodicWave(this.source(ctx));
    src.frequency.setValueAtTime(hz(first.midi), t0);
    // Vibrato: an LFO into the frequency, depth set per note (in Hz) so it is ±35 cents everywhere.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t0);
    lfo.connect(depth).connect(src.frequency);
    const sum = ctx.createGain();
    sum.gain.value = 1;
    for (let i = 0; i < fs.length; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fs[i]!;
      bp.Q.value = fs[i]! / bws[i]!;
      const g = ctx.createGain();
      g.gain.value = 10 ** (dbs[i]! / 20) * (i === 0 ? 1.4 : 1.8);
      src.connect(bp).connect(g).connect(sum);
    }
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    sum.connect(tone).connect(amp).connect(bus);
    const peak = 0.55 * Math.max(0.2, Math.min(1, (opts.vel ?? 90) / 110));
    const vib = opts.vibrato !== false;
    let end = t0;
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i]!;
      const prev = i > 0 ? sorted[i - 1]! : null;
      const next = i + 1 < sorted.length ? sorted[i + 1]! : null;
      const t = Math.max(t0, n.t);
      const f = hz(n.midi);
      const len = Math.max(0.06, n.st ? n.d * 0.45 : n.d);
      const joined = prev !== null && !prev.st && t - (prev.t + prev.d) < 0.06;
      if (joined) {
        // Legato: glide to the new pitch, a small dip marks the new syllable.
        src.frequency.setTargetAtTime(f, t - 0.012, 0.018);
        amp.gain.setTargetAtTime(peak * 0.82, t - 0.01, 0.012);
        amp.gain.setTargetAtTime(peak, t + 0.03, 0.03);
      } else {
        src.frequency.setValueAtTime(f, t);
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(peak * (n.st ? 0.85 : 1), t + (n.st ? 0.02 : 0.045));
      }
      // Vibrato fades in on longer notes only.
      const vd = f * (2 ** (35 / 1200) - 1);
      depth.gain.setTargetAtTime(0, t, 0.02);
      if (vib && len > 0.35) depth.gain.setTargetAtTime(vd, t + 0.18, 0.12);
      const off = t + len;
      const nextJoined = next !== null && !n.st && next.t - off < 0.06;
      if (!nextJoined) {
        amp.gain.setTargetAtTime(0.0001, off - 0.02, n.st ? 0.025 : 0.06);
        depth.gain.setTargetAtTime(0, off, 0.05);
      }
      end = Math.max(end, off);
    }
    src.start(t0);
    lfo.start(t0);
    const stopAt = end + 0.6;
    src.stop(stopAt);
    lfo.stop(stopAt);
    const line: Line = { tag, src, lfo, amp, end: stopAt };
    this.lines.push(line);
    src.addEventListener('ended', () => {
      amp.disconnect();
      this.lines = this.lines.filter((x) => x !== line);
    });
  }

  /** One sung note (a reference pitch, a starting note). */
  singNote(midi: number, when: number, dur: number, vowel: Vowel = 'oo'): number {
    return this.singLine([{ midi, t: when, d: dur }], { vowel });
  }

  /* -------------------------------------------------------------------- drone */

  /** A soft drone on a tonic (and its fifth); null stops it. */
  drone(tonic: number | null): void {
    const ctx = this.ctx;
    const bus = this.droneBus;
    if (ctx === null || bus === null) return;
    const now = ctx.currentTime;
    if (this.droneNodes !== null) {
      const d = this.droneNodes;
      d.gain.gain.cancelScheduledValues(now);
      d.gain.gain.setTargetAtTime(0.0001, now, 0.12);
      for (const o of d.osc) o.stop(now + 0.8);
      this.droneNodes = null;
    }
    if (tonic === null) return;
    let root = tonic;
    while (root > 55) root -= 12;
    while (root < 40) root += 12;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    lp.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.setTargetAtTime(0.16, now, 0.35);
    lp.connect(gain).connect(bus);
    const osc: OscillatorNode[] = [];
    const parts: [number, number, number][] = [
      [root, -4, 0.5],
      [root, 5, 0.5],
      [root + 7, -2, 0.32],
      [root + 12, 3, 0.18],
    ];
    for (const [m, det, lvl] of parts) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(lp);
      o.start(now);
      osc.push(o);
    }
    this.droneNodes = { osc, gain };
  }

  /* -------------------------------------------------------------------- piano */

  /** A periodic wave per register: brighter partials up high, darker in the bass. */
  private wave(ctx: AudioContext, midi: number): PeriodicWave {
    const bucket = Math.max(2, Math.min(9, Math.floor(midi / 12)));
    const cached = this.waves.get(bucket);
    if (cached !== undefined) return cached;
    const f0 = 440 * 2 ** ((bucket * 12 + 6 - 69) / 12);
    const n = Math.max(4, Math.min(28, Math.floor(9000 / f0)));
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    const dark = bucket <= 3 ? 0.16 : bucket <= 5 ? 0.11 : 0.08;
    for (let k = 1; k <= n; k++) {
      let a = (1 / k ** 1.25) * Math.exp(-(k - 1) * dark);
      if (k === 2) a *= 1.35;
      if (k === 3) a *= 1.1;
      if (k % 8 === 0) a *= 0.25;
      imag[k] = a;
    }
    const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.waves.set(bucket, w);
    return w;
  }

  /** Start a piano note at `when` (audio time). */
  private start(midi: number, vel: number, when: number, tag = 'piano'): Voice | null {
    const ctx = this.ctx;
    const bus = this.pianoBus;
    if (ctx === null || bus === null) return null;
    const v = Math.max(0.05, Math.min(1, vel / 127));
    const f0 = hz(midi);
    const t = Math.max(when, ctx.currentTime);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    const open = Math.min(16000, f0 * (2.5 + 11 * v * v));
    const close = Math.min(12000, f0 * 1.6 + 300);
    // Coefficients per render quantum, not per sample: the sweep is slow, and per-sample filters are costly.
    filter.frequency.automationRate = 'k-rate';
    filter.frequency.setValueAtTime(open, t);
    filter.frequency.setTargetAtTime(close, t + 0.02, 0.35 + 0.6 * (1 - midi / 108));
    gain.connect(bus);
    filter.connect(gain);
    const wave = this.wave(ctx, midi);
    const oscs: OscillatorNode[] = [];
    const mix = [0.62, 0.38];
    const detune = [-2.5, 3.5];
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f0;
      o.detune.value = detune[i] ?? 0;
      const g = ctx.createGain();
      g.gain.value = mix[i] ?? 0.5;
      o.connect(g).connect(filter);
      o.start(t);
      oscs.push(o);
    }
    const peak = 0.34 * v ** 1.5 * (midi < 40 ? 0.85 : 1);
    const tail = Math.max(0.35, Math.min(3.6, 2.6 * 2 ** (-(midi - 48) / 22)));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.004);
    gain.gain.setTargetAtTime(peak * 0.42, t + 0.006, 0.09);
    gain.gain.setTargetAtTime(0.0001, t + 0.3, tail);
    let hammer: AudioBufferSourceNode | null = null;
    if (this.noise !== null) {
      const src = ctx.createBufferSource();
      hammer = src;
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(7000, f0 * 4);
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.05 * v, t + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(bp).connect(ng).connect(bus);
      src.start(t);
      src.stop(t + 0.06);
    }
    const voice: Voice = { midi, tag, osc: oscs, hammer, gain, started: t, ended: false };
    for (const o of oscs) o.stop(t + 0.3 + tail * 5);
    oscs[0]?.addEventListener('ended', () => {
      voice.ended = true;
      gain.disconnect();
    });
    this.voices.push(voice);
    this.voices = this.voices.filter((x) => !x.ended);
    // Too many ringing at once: damp the oldest that are already sounding (never one still to come).
    const sounding = this.voices.filter((x) => x.started <= ctx.currentTime);
    for (let i = 0; i < sounding.length - 48; i++) {
      const old = sounding[i]!;
      this.release(old, ctx.currentTime, 0.02);
      old.ended = true;
    }
    this.voices = this.voices.filter((x) => !x.ended);
    return voice;
  }

  private release(v: Voice, when: number, damp = 0.07): void {
    const ctx = this.ctx;
    if (ctx === null || v.ended) return;
    const t = Math.max(when, v.started + 0.02, ctx.currentTime);
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0.0001, t, damp);
      for (const o of v.osc) o.stop(t + damp * 8);
    } catch {
      /* already stopped */
    }
  }

  /** A scheduled piano note with its length (seconds); `tag` says what it belongs to. */
  play(midi: number, vel: number, when: number, dur: number, tag = 'piano'): void {
    this.defer(
      when,
      () => {
        const v = this.start(midi, vel, when, tag);
        if (v !== null) this.release(v, when + Math.max(0.08, dur), midi < 48 ? 0.12 : 0.08);
      },
      tag,
    );
  }

  /** A live piano note (a key on screen): sound now, until released. */
  noteOn(midi: number, vel: number): void {
    this.ensure();
    const prev = this.live.get(midi);
    if (prev !== undefined) this.release(prev, this.now(), 0.03);
    const v = this.start(midi, vel, this.now());
    if (v !== null) this.live.set(midi, v);
  }

  noteOff(midi: number): void {
    const v = this.live.get(midi);
    if (v === undefined) return;
    this.live.delete(midi);
    this.release(v, this.now());
  }

  /** A metronome tick: brighter on the first beat of the bar. */
  click(when: number, accent: boolean, tag = 'click'): void {
    this.defer(when, () => this.clickNow(when, accent, tag), tag);
  }

  private clickNow(when: number, accent: boolean, tag: string): void {
    const ctx = this.ctx;
    const out = this.clickGain;
    if (ctx === null || out === null) return;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.07);
    // A tick is short: only its gain needs remembering, so stopTags can mute one still to come.
    if (tag !== 'click') {
      const line: Line = { tag, src: o, lfo: o, amp: g, end: t + 0.07 };
      this.lines.push(line);
      o.addEventListener('ended', () => {
        this.lines = this.lines.filter((x) => x !== line);
      });
    }
  }

  /**
   * Silence what belongs to these tags only (the recording, the guide, the
   * piano…), queued or sounding, fading over 30 ms; the rest plays on.
   */
  stopTags(tags: string[]): void {
    const ctx = this.ctx;
    if (ctx === null || tags.length === 0) return;
    const now = ctx.currentTime;
    const hit = (t: string): boolean => tags.includes(t);
    this.queue = this.queue.filter((q) => !hit(q.tag));
    for (const b of this.backings.filter((x) => hit(x.tag))) {
      try {
        b.gain.gain.cancelScheduledValues(now);
        b.gain.gain.setTargetAtTime(0.0001, now, 0.03);
        b.src.stop(now + 0.2);
      } catch {
        /* already stopped */
      }
    }
    this.backings = this.backings.filter((x) => !hit(x.tag));
    for (const v of this.voices.filter((x) => hit(x.tag))) {
      if (v.started > now + 0.005) {
        try {
          for (const o of v.osc) o.stop(now);
          v.hammer?.stop(now);
        } catch {
          /* already stopped */
        }
      } else this.release(v, now, 0.03);
      v.ended = true;
    }
    this.voices = this.voices.filter((x) => !x.ended);
    for (const l of this.lines.filter((x) => hit(x.tag))) {
      try {
        l.amp.gain.cancelScheduledValues(now);
        l.amp.gain.setTargetAtTime(0.0001, now, 0.03);
        l.src.stop(now + 0.25);
        l.lfo.stop(now + 0.25);
      } catch {
        /* already stopped */
      }
    }
    this.lines = this.lines.filter((x) => !hit(x.tag));
  }

  /** Silence every scheduled and sounding note (the drone too unless kept). */
  stopAll(keepDrone = false): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const now = ctx.currentTime;
    this.queue = [];
    for (const b of this.backings) {
      try {
        b.gain.gain.cancelScheduledValues(now);
        b.gain.gain.setTargetAtTime(0.0001, now, 0.03);
        b.src.stop(now + 0.2);
      } catch {
        /* already stopped */
      }
    }
    this.backings = [];
    for (const v of this.voices) {
      if (v.started > now + 0.005) {
        try {
          for (const o of v.osc) o.stop(now);
          v.hammer?.stop(now);
        } catch {
          /* already stopped */
        }
        v.ended = true;
        continue;
      }
      this.release(v, now, 0.03);
    }
    this.voices = [];
    this.live.clear();
    for (const l of this.lines) {
      try {
        l.amp.gain.cancelScheduledValues(now);
        l.amp.gain.setTargetAtTime(0.0001, now, 0.03);
        l.src.stop(now + 0.25);
        l.lfo.stop(now + 0.25);
      } catch {
        /* already stopped */
      }
    }
    this.lines = [];
    if (!keepDrone) this.drone(null);
  }
}

export const audio = new AudioEngine();

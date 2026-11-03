/**
 * Sound: a piano voice synthesised in the browser (no samples to download),
 * a metronome click, and the audio clock the practice engine schedules on.
 *
 * The voice: a periodic wave with piano-like partials (falling with the
 * partial number, darker for low notes), a second detuned oscillator for
 * the beating of a real string pair, a short filtered noise "hammer", a
 * brightness filter that closes as the note decays, a two-stage decay that
 * lasts longer in the bass, and a gentle room.
 *
 * Browsers only start audio after a click or a key press in the page, so
 * `unlock()` runs on the first gesture (MIDI messages do not count).
 */

interface Voice {
  midi: number;
  osc: OscillatorNode[];
  hammer: AudioBufferSourceNode | null;
  gain: GainNode;
  started: number;
  ended: boolean;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private waves = new Map<number, PeriodicWave>();
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private live = new Map<number, Voice>();
  private volume = 0.8;
  private clickVolume = 0.6;

  /** The context, created and resumed on demand (call from a user gesture). */
  ensure(): AudioContext {
    if (this.ctx === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const dry = ctx.createGain();
      dry.gain.value = 0.9;
      const verb = ctx.createConvolver();
      verb.buffer = this.room(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      master.connect(dry).connect(comp);
      master.connect(verb).connect(wet).connect(comp);
      const click = ctx.createGain();
      click.gain.value = this.clickVolume;
      click.connect(comp);
      this.ctx = ctx;
      this.master = master;
      this.clickGain = click;
      this.noise = this.makeNoise(ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
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

  /** How long after a scheduled time the sound reaches the ears, in seconds. */
  outputLatency(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (c === null) return 0;
    const out = typeof c.outputLatency === 'number' && Number.isFinite(c.outputLatency) ? c.outputLatency : 0;
    return Math.min(0.25, out + (c.baseLatency || 0));
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master !== null && this.ctx !== null) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
  }

  setClickVolume(v: number): void {
    this.clickVolume = Math.max(0, Math.min(1, v));
    if (this.clickGain !== null && this.ctx !== null) this.clickGain.gain.setTargetAtTime(this.clickVolume, this.ctx.currentTime, 0.03);
  }

  private room(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2.2);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.1) * (t < 0.012 ? t / 0.012 : 1);
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
      // Partials fall off, the 2nd and 3rd stand out, and a hammer struck
      // about 1/8 along the string weakens the 8th.
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

  /** Start a note at `when` (audio time). Returns the voice so it can be stopped. */
  private start(midi: number, vel: number, when: number): Voice | null {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return null;
    const v = Math.max(0.05, Math.min(1, vel / 127));
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    const t = Math.max(when, ctx.currentTime);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    const open = Math.min(16000, f0 * (2.5 + 11 * v * v));
    const close = Math.min(12000, f0 * 1.6 + 300);
    filter.frequency.setValueAtTime(open, t);
    filter.frequency.setTargetAtTime(close, t + 0.02, 0.35 + 0.6 * (1 - midi / 108));
    gain.connect(master);
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

    // Two-stage decay: a quick drop after the strike, then a long tail
    // (seconds in the bass, under a second at the top).
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
      src.connect(bp).connect(ng).connect(master);
      src.start(t);
      src.stop(t + 0.06);
    }

    const voice: Voice = { midi, osc: oscs, hammer, gain, started: t, ended: false };
    // Long notes ring until they fade; stop the oscillators then.
    for (const o of oscs) o.stop(t + 0.3 + tail * 5);
    oscs[0]?.addEventListener('ended', () => {
      voice.ended = true;
      gain.disconnect();
    });
    this.voices.push(voice);
    if (this.voices.length > 72) {
      const old = this.voices.shift();
      if (old !== undefined) this.release(old, ctx.currentTime, 0.02);
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

  /** A scheduled note with its length (seconds). */
  play(midi: number, vel: number, when: number, dur: number): void {
    const v = this.start(midi, vel, when);
    if (v !== null) this.release(v, when + Math.max(0.08, dur), midi < 48 ? 0.12 : 0.08);
  }

  /** Live notes (computer keys, screen keys): sound now, until released. */
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
  click(when: number, accent: boolean): void {
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
  }

  /** Silence every scheduled and sounding note. */
  stopAll(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const now = ctx.currentTime;
    for (const v of this.voices) {
      if (v.started > now + 0.005) {
        // Not started yet: it never sounds.
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
  }
}

export const audio = new AudioEngine();

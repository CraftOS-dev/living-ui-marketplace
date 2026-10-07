/**
 * Live preview of every microphone, shown while the record dialog is open:
 * each input gets its own level so the person can SEE which one hears them
 * before anything is recorded. Devices are judged by their signal, never by
 * their names: an input that never rises above SIGNAL_FLOOR (a virtual
 * device such as a streaming app's microphone, a muted endpoint, an
 * unplugged jack) is marked as having no signal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FRAME_BLOCKED_MIC, RecorderError, SIGNAL_FLOOR, frameAllows, micError } from './useRecorder.ts';

export interface PreviewDevice {
  deviceId: string;
  label: string;
  /** The browser's default input (same physical device as its "default" entry). */
  isDefault: boolean;
  /** 0..1 display level of the last ~100 ms. */
  level: number;
  /** Loudest level seen since the preview opened (0..1). */
  peak: number;
  /** null until judged; true = nothing above SIGNAL_FLOOR for the whole window. */
  noSignal: boolean | null;
  error: string | null;
}

/** How long a device must stay below SIGNAL_FLOOR to count as no signal. */
const JUDGE_MS = 1500;

interface Probe {
  deviceId: string;
  stream: MediaStream;
  analyser: AnalyserNode;
  sawSignal: boolean;
  peak: number;
  level: number;
}

function toLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

export function useMicPreview(active: boolean): {
  phase: 'idle' | 'asking' | 'ready' | 'error';
  error: RecorderError | null;
  devices: PreviewDevice[];
} {
  const [phase, setPhase] = useState<'idle' | 'asking' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<RecorderError | null>(null);
  const [devices, setDevices] = useState<PreviewDevice[]>([]);
  const generation = useRef(0);

  const run = useCallback(async (gen: number): Promise<() => void> => {
    const probes: Probe[] = [];
    let ctx: AudioContext | null = null;
    let raf = 0;
    let tick = 0;
    const cleanup = (): void => {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      for (const p of probes) for (const t of p.stream.getTracks()) t.stop();
      if (ctx !== null) void ctx.close().catch(() => undefined);
    };
    const stale = (): boolean => gen !== generation.current;

    setPhase('asking');
    setError(null);
    if (!frameAllows('microphone')) {
      setError(new RecorderError('frame_blocked', FRAME_BLOCKED_MIC));
      setPhase('error');
      return cleanup;
    }
    // Device names are only visible after permission, so ask once first.
    try {
      const first = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of first.getTracks()) t.stop();
    } catch (err) {
      if (!stale()) {
        setError(micError(err));
        setPhase('error');
      }
      return cleanup;
    }
    if (stale()) return cleanup;

    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    // 'default' and 'communications' are the browser's aliases for a real device.
    const defaultGroup = all.find((d) => d.deviceId === 'default')?.groupId ?? '';
    const inputs = all.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.deviceId !== '');
    const base: PreviewDevice[] = inputs.map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      isDefault: defaultGroup !== '' && d.groupId === defaultGroup,
      level: 0,
      peak: 0,
      noSignal: null,
      error: null,
    }));
    if (!base.some((d) => d.isDefault) && base[0] !== undefined) base[0].isDefault = true;
    setDevices(base);
    setPhase('ready');

    ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    const opened = await Promise.all(
      inputs.map(async (d) => {
        try {
          // Raw signal (no noise suppression): the preview judges the device itself.
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: d.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          return { deviceId: d.deviceId, stream, error: null };
        } catch (err) {
          return { deviceId: d.deviceId, stream: null, error: micError(err).message };
        }
      }),
    );
    if (stale() || ctx === null) {
      for (const o of opened) if (o.stream !== null) for (const t of o.stream.getTracks()) t.stop();
      return cleanup;
    }
    for (const o of opened) {
      if (o.stream === null) continue;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(o.stream).connect(analyser);
      probes.push({ deviceId: o.deviceId, stream: o.stream, analyser, sawSignal: false, peak: 0, level: 0 });
    }
    const failed = new Map(opened.filter((o) => o.error !== null).map((o) => [o.deviceId, o.error]));
    const startedAt = performance.now();
    const buf = new Float32Array(2048);
    const sample = (): void => {
      for (const p of probes) {
        p.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (let k = 0; k < buf.length; k++) {
          const v = buf[k] ?? 0;
          sum += v * v;
          if (v > peak) peak = v;
          else if (-v > peak) peak = -v;
        }
        if (peak >= SIGNAL_FLOOR) p.sawSignal = true;
        p.level = toLevel(Math.sqrt(sum / buf.length));
        p.peak = Math.max(p.peak, p.level);
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    tick = window.setInterval(() => {
      const judged = performance.now() - startedAt >= JUDGE_MS;
      setDevices((list) =>
        list.map((d) => {
          const p = probes.find((x) => x.deviceId === d.deviceId);
          if (p === undefined) return { ...d, error: failed.get(d.deviceId) ?? d.error };
          return { ...d, level: p.level, peak: p.peak, noSignal: p.sawSignal ? false : judged ? true : null };
        }),
      );
    }, 100);
    return cleanup;
  }, []);

  useEffect(() => {
    if (!active) return;
    const gen = ++generation.current;
    let cleanup: (() => void) | null = null;
    let disposed = false;
    const start = (): void => {
      void run(gen).then((c) => {
        if (disposed || gen !== generation.current) c();
        else cleanup = c;
      });
    };
    start();
    // A device plugged in or removed: look again. (Opening devices can itself
    // fire devicechange in some browsers; ignore the first second of a run.)
    let runStarted = performance.now();
    const onChange = (): void => {
      if (performance.now() - runStarted < 1000) return;
      runStarted = performance.now();
      if (cleanup !== null) cleanup();
      cleanup = null;
      const next = ++generation.current;
      void run(next).then((c) => {
        if (disposed || next !== generation.current) c();
        else cleanup = c;
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      disposed = true;
      generation.current++;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
      if (cleanup !== null) cleanup();
      setPhase('idle');
    };
  }, [active, run]);

  return { phase, error, devices };
}

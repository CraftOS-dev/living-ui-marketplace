/**
 * Recording engine. Captures the microphone, a shared tab/screen's audio, or
 * both mixed, into an Opus WebM blob. It never substitutes anything for a
 * source it could not open: every failure is a RecorderError the UI explains.
 *
 * Live signal: an analyser on the exact stream being recorded drives the
 * level meter and two warnings, so a wrong source shows up within seconds
 * instead of after the meeting: NO SIGNAL (nothing above SIGNAL_FLOOR: a
 * virtual or muted device, or a silent shared tab) and QUIET (signal, but
 * nothing louder than room noise for a while).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chunker, tapStream, type Piece } from './liveCapture.ts';
import { addChunk, deleteTake, putTake, type Take } from './takes.ts';

export type RecSource = 'mic' | 'mic+tab' | 'tab';
export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused';

export interface RecOptions {
  source: RecSource;
  deviceId: string;
  language: string;
  category: string;
}

export interface RecResult {
  blob: Blob;
  take: Take;
  /** false when live transcription could not start (the file is transcribed after Stop instead). */
  live: boolean;
}

export type RecErrorKind = 'frame_blocked' | 'denied' | 'no_device' | 'busy' | 'cancelled' | 'no_tab_audio' | 'unsupported' | 'failed';

export class RecorderError extends Error {
  readonly kind: RecErrorKind;
  constructor(kind: RecErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Quieter than this (RMS) counts as "nothing heard" (about -40 dBFS). */
const LOUD_RMS = 0.01;
/**
 * Below this peak (-100 dBFS) there is no signal at all. One 16-bit step is
 * about -90 dBFS, so any working input's own noise is above it, while a dead
 * source is digital zero (plus the fading near-zero tail Chrome's echo
 * cancellation leaves after a sound, measured at 1e-9 and below).
 */
export const SIGNAL_FLOOR = 1e-5;
/** Waveform history: 96 samples of 120 ms (about 11.5 s). */
const BARS = 96;

interface Internals {
  recorder: MediaRecorder;
  streams: MediaStream[];
  ctx: AudioContext;
  analyser: AnalyserNode;
  take: Take;
  chunks: Blob[];
  seq: number;
  accumulatedMs: number;
  activeSince: number | null;
  lastLoudAt: number;
  lastSignalAt: number;
  raf: number;
  tick: number;
  barTick: number;
  levelNow: number;
  chunker: Chunker | null;
  untap: () => void;
}

interface PolicyDoc {
  permissionsPolicy?: { allowsFeature(feature: string): boolean };
  featurePolicy?: { allowsFeature(feature: string): boolean };
}

/** Is this frame allowed to use a feature at all? (Permissions Policy API.) */
export function frameAllows(feature: string): boolean {
  const doc = document as unknown as PolicyDoc;
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  return policy === undefined ? true : policy.allowsFeature(feature);
}

function errorName(err: unknown): string {
  return err instanceof DOMException ? err.name : '';
}

export const FRAME_BLOCKED_MIC =
  'This app is not allowed to use the microphone where it is open. Update and restart CraftBot (it must let apps ask for the microphone), or open the app in its own browser tab.';

/** What a failed microphone open means, in words a person can act on. */
export function micError(err: unknown): RecorderError {
  if (err instanceof RecorderError) return err;
  const name = errorName(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new RecorderError(
      'denied',
      'Microphone access is blocked. Click the microphone icon in the address bar, allow it for this site, then try again.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new RecorderError('no_device', 'That microphone is not connected. Plug it in or pick another one.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new RecorderError('busy', 'The microphone could not be opened. Another app may be using it exclusively; close it and try again.');
  }
  return new RecorderError('failed', `The microphone could not be opened (${name || String(err)}).`);
}

async function openMic(deviceId: string): Promise<MediaStream> {
  if (!frameAllows('microphone')) throw new RecorderError('frame_blocked', FRAME_BLOCKED_MIC);
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw micError(err);
  }
}

async function openTab(): Promise<MediaStream> {
  if (!frameAllows('display-capture')) {
    throw new RecorderError(
      'frame_blocked',
      'This app is not allowed to capture tab or screen audio where it is open. Update and restart CraftBot, or open the app in its own browser tab.',
    );
  }
  let display: MediaStream;
  try {
    // Chrome only offers tab/system audio together with a video track.
    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    if (errorName(err) === 'NotAllowedError') {
      throw new RecorderError('cancelled', 'Sharing was cancelled, so nothing is being recorded.');
    }
    throw new RecorderError('failed', `Tab or screen capture failed (${errorName(err) || String(err)}).`);
  }
  for (const t of display.getVideoTracks()) t.stop();
  if (display.getAudioTracks().length === 0) {
    for (const t of display.getTracks()) t.stop();
    throw new RecorderError(
      'no_tab_audio',
      'No audio was shared. Pick the meeting tab (or "Entire screen") and switch on "Share tab audio" / "Share system audio".',
    );
  }
  return new MediaStream(display.getAudioTracks());
}

function pickMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * onFinished receives every completed take, whether the user pressed Stop or
 * the source ended on its own (tab sharing stopped, mic unplugged). onPiece
 * receives each live-transcription piece (the last one is flushed before
 * onFinished runs).
 */
export function useRecorder(onFinished: (result: RecResult) => void, onPiece: (noteId: string, piece: Piece) => void) {
  const [phase, setPhase] = useState<RecPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [quietMs, setQuietMs] = useState(0);
  const [noSignalMs, setNoSignalMs] = useState(0);
  const [source, setSource] = useState<RecSource>('mic');
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [takeId, setTakeId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const ref = useRef<Internals | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onPieceRef = useRef(onPiece);
  onPieceRef.current = onPiece;

  const elapsedOf = (i: Internals): number =>
    i.accumulatedMs + (i.activeSince !== null ? performance.now() - i.activeSince : 0);

  const teardown = useCallback((i: Internals) => {
    i.untap();
    cancelAnimationFrame(i.raf);
    clearInterval(i.tick);
    clearInterval(i.barTick);
    for (const s of i.streams) for (const t of s.getTracks()) t.stop();
    void i.ctx.close().catch(() => undefined);
  }, []);

  const stop = useCallback((): void => {
    const i = ref.current;
    if (i === null || i.recorder.state === 'inactive') return;
    if (i.activeSince !== null) {
      i.accumulatedMs += performance.now() - i.activeSince;
      i.activeSince = null;
    }
    i.recorder.stop();
  }, []);

  /**
   * Open the sources, then `prepare()` creates the note this take belongs to
   * (only once the sources are open, so a refused permission leaves no empty
   * note behind), then recording and live transcription start.
   */
  const start = useCallback(
    async (opts: RecOptions, prepare: () => Promise<string>): Promise<void> => {
      if (ref.current !== null) return;
      if (!window.isSecureContext || navigator.mediaDevices === undefined || typeof MediaRecorder === 'undefined') {
        throw new RecorderError('unsupported', 'This browser cannot record audio here.');
      }
      setPhase('starting');
      setNotice(null);
      const streams: MediaStream[] = [];
      try {
        if (opts.source !== 'tab') streams.push(await openMic(opts.deviceId));
        if (opts.source !== 'mic') streams.push(await openTab());
      } catch (err) {
        for (const s of streams) for (const t of s.getTracks()) t.stop();
        setPhase('idle');
        throw err;
      }

      let forNote: string;
      try {
        forNote = await prepare();
      } catch (err) {
        for (const s of streams) for (const t of s.getTracks()) t.stop();
        setPhase('idle');
        throw err;
      }

      const ctx = new AudioContext();
      await ctx.resume().catch(() => undefined);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      let recordStream: MediaStream;
      if (streams.length === 1 && streams[0] !== undefined) {
        recordStream = streams[0];
        ctx.createMediaStreamSource(recordStream).connect(analyser);
      } else {
        const mix = ctx.createMediaStreamDestination();
        for (const s of streams) ctx.createMediaStreamSource(s).connect(mix);
        recordStream = mix.stream;
        ctx.createMediaStreamSource(recordStream).connect(analyser);
      }

      const mimeType = pickMime();
      const recorder = new MediaRecorder(recordStream, {
        ...(mimeType !== '' ? { mimeType } : {}),
        audioBitsPerSecond: 64000,
      });
      const micTrack = opts.source !== 'tab' ? streams[0]?.getAudioTracks()[0] : undefined;
      const label =
        opts.source === 'mic'
          ? (micTrack?.label ?? '') || 'Microphone'
          : opts.source === 'tab'
            ? 'Tab / screen audio'
            : `${(micTrack?.label ?? '') || 'Microphone'} + tab audio`;
      const take: Take = {
        id: newId(),
        noteId: forNote,
        startedAt: Date.now(),
        mimeType: recorder.mimeType || mimeType || 'audio/webm',
        elapsedMs: 0,
        language: opts.language,
        category: opts.category,
        sourceLabel: label,
      };

      const internals: Internals = {
        recorder,
        streams,
        ctx,
        analyser,
        take,
        chunks: [],
        seq: 0,
        accumulatedMs: 0,
        activeSince: performance.now(),
        lastLoudAt: performance.now(),
        lastSignalAt: performance.now(),
        raf: 0,
        tick: 0,
        barTick: 0,
        levelNow: 0,
        chunker: null,
        untap: () => undefined,
      };

      // Live transcription: pieces cut at pauses from the recorded stream.
      // Without it (no AudioWorklet) the file is transcribed after Stop.
      try {
        const chunker = new Chunker((piece) => onPieceRef.current(forNote, piece));
        internals.untap = await tapStream(recordStream, chunker, () => internals.activeSince !== null);
        internals.chunker = chunker;
      } catch (err) {
        console.warn('Live transcription unavailable; the recording is transcribed after Stop:', err);
      }

      recorder.ondataavailable = (e: BlobEvent): void => {
        if (e.data.size === 0) return;
        internals.chunks.push(e.data);
        void addChunk(take.id, internals.seq++, e.data);
        take.elapsedMs = elapsedOf(internals);
        void putTake(take);
      };
      recorder.onstop = (): void => {
        internals.chunker?.flush();
        teardown(internals);
        take.elapsedMs = internals.accumulatedMs;
        void putTake(take);
        const blob = new Blob(internals.chunks, { type: take.mimeType });
        ref.current = null;
        setPhase('idle');
        setTakeId(null);
        setNoteId(null);
        setLevel(0);
        setBars([]);
        setQuietMs(0);
        setNoSignalMs(0);
        onFinishedRef.current({ blob, take, live: internals.chunker !== null });
      };

      // A source that ends on its own (tab sharing stopped, mic unplugged):
      // keep what was recorded. With two sources the other one carries on.
      streams.forEach((s, idx) => {
        for (const t of s.getAudioTracks()) {
          t.onended = (): void => {
            const alive = internals.streams.some((x) => x.getAudioTracks().some((y) => y.readyState === 'live'));
            if (!alive) {
              setNotice('The audio source stopped, so the recording was saved.');
              stop();
            } else {
              const isMic = opts.source !== 'tab' && idx === 0;
              setNotice(isMic ? 'The microphone disconnected; still recording tab audio.' : 'Tab audio stopped; still recording your microphone.');
            }
          };
        }
      });

      const buf = new Float32Array(analyser.fftSize);
      const sample = (): void => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (let k = 0; k < buf.length; k++) {
          const v = buf[k] ?? 0;
          sum += v * v;
          if (v > peak) peak = v;
          else if (-v > peak) peak = -v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms >= LOUD_RMS || internals.activeSince === null) internals.lastLoudAt = now;
        if (peak >= SIGNAL_FLOOR || internals.activeSince === null) internals.lastSignalAt = now;
        const db = 20 * Math.log10(Math.max(rms, 1e-6));
        internals.levelNow = Math.min(1, Math.max(0, (db + 60) / 50));
        internals.raf = requestAnimationFrame(sample);
      };
      internals.raf = requestAnimationFrame(sample);
      internals.tick = window.setInterval(() => {
        setElapsedMs(elapsedOf(internals));
        setLevel(internals.levelNow);
        setQuietMs(performance.now() - internals.lastLoudAt);
        setNoSignalMs(performance.now() - internals.lastSignalAt);
      }, 200);
      internals.barTick = window.setInterval(() => {
        if (internals.activeSince === null) return;
        setBars((b) => [...b.slice(-(BARS - 1)), internals.levelNow]);
      }, 120);

      ref.current = internals;
      setTakeId(take.id);
      setNoteId(forNote);
      await putTake(take);
      recorder.start(1000);
      setSourceLabel(label);
      setSource(opts.source);
      setElapsedMs(0);
      setPhase('recording');
    },
    [stop, teardown],
  );

  const pause = useCallback((): void => {
    const i = ref.current;
    if (i === null || i.recorder.state !== 'recording') return;
    i.recorder.pause();
    if (i.activeSince !== null) i.accumulatedMs += performance.now() - i.activeSince;
    i.activeSince = null;
    setPhase('paused');
  }, []);

  const resume = useCallback((): void => {
    const i = ref.current;
    if (i === null || i.recorder.state !== 'paused') return;
    i.recorder.resume();
    i.activeSince = performance.now();
    i.lastLoudAt = performance.now();
    i.lastSignalAt = performance.now();
    setPhase('recording');
  }, []);

  /** Throw the take away (nothing is saved, the backup is removed). */
  const discard = useCallback((): void => {
    const i = ref.current;
    if (i === null) return;
    i.recorder.ondataavailable = null;
    i.recorder.onstop = null;
    if (i.recorder.state !== 'inactive') i.recorder.stop();
    teardown(i);
    void deleteTake(i.take.id);
    ref.current = null;
    setPhase('idle');
    setTakeId(null);
    setNoteId(null);
    setLevel(0);
    setBars([]);
    setQuietMs(0);
    setNoSignalMs(0);
    setNotice(null);
  }, [teardown]);

  // Leaving the page mid-recording asks first (the backup survives anyway).
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const guard = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [phase]);

  useEffect(
    () => () => {
      const i = ref.current;
      if (i !== null) teardown(i);
    },
    [teardown],
  );

  return { phase, elapsedMs, level, bars, quietMs, noSignalMs, notice, source, sourceLabel, takeId, noteId, start, stop, pause, resume, discard, clearNotice: () => setNotice(null) };
}

export type Recorder = ReturnType<typeof useRecorder>;

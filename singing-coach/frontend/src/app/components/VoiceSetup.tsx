/**
 * Setting up the voice: the microphone (with a live meter and the room's
 * noise), how the singer listens (wired headphones, Bluetooth, speakers),
 * the timing test (sing "ta" with eight clicks; the median offset is the
 * round-trip latency), and the range test (the lowest and highest notes held
 * for a second within ±50 cents, the hold voice range profiles use).
 * Used by the first-run dialog and by Settings.
 */
import { useEffect, useRef, useState } from 'react';
import { Bluetooth, Check, Headphones, Mic, MicOff, Speaker, Timer, TriangleAlert } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { Voice } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { noteLabel } from '../music/dial.ts';
import { mic, micProblem } from '../music/mic.ts';
import { heldPitch } from '../music/pitch.ts';
import type { MicStatus } from '../music/mic.ts';
import { VoiceDial } from './practice/VoiceDial.tsx';
import type { DialHandle } from './practice/VoiceDial.tsx';
import { Button, Segmented, errMessage } from './ui.tsx';

export function useMic(): { status: MicStatus; level: number; start: () => Promise<MicStatus> } {
  const app = useApp();
  const [status, setStatus] = useState<MicStatus>(mic.status);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const off = mic.onStatus(setStatus);
    let raf = 0;
    const tick = (): void => {
      setLevel(mic.level);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  return { status, level, start: () => mic.start(app.settings?.input_device ?? '') };
}

/** Allow the microphone, see it move, measure the room, say how you listen. */
export function MicStep(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const { status, level, start } = useMic();
  const [noise, setNoise] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const on = status === 'on';
  useEffect(() => {
    if (on) void mic.devices().then(setDevices);
  }, [on]);
  const measure = (): void => {
    setMeasuring(true);
    const dbs: number[] = [];
    const off = mic.onFrame((f) => {
      if (!f.voiced) dbs.push(f.db);
    });
    window.setTimeout(() => {
      off();
      setMeasuring(false);
      if (dbs.length > 20) {
        const sorted = dbs.slice().sort((a, b) => a - b);
        const n = Math.round(sorted[Math.floor(sorted.length * 0.6)]!);
        setNoise(n);
        mic.noise = n;
        app.save({ noise_db: n });
      }
    }, 3000);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] p-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--sc-voice-soft)] text-[var(--sc-voice)]' : 'bg-[var(--sc-sunk)] text-[var(--sc-muted)]')}>{on ? <Mic size={17} aria-hidden /> : <MicOff size={17} aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{on ? mic.device || 'Microphone on' : 'Microphone off'}</div>
          {on ? (
            <span className="sc-meter mt-1.5 block w-full max-w-[260px]">
              <span style={{ transform: `scaleX(${level.toFixed(3)})` }} />
            </span>
          ) : (
            <div className="text-[12px] text-[var(--sc-muted)]">{status === 'off' || status === 'starting' ? 'The app listens only while you sing, and nothing leaves this computer.' : micProblem(status)}</div>
          )}
        </div>
        {!on && (
          <Button variant="primary" icon={Mic} busy={status === 'starting'} onClick={() => void start()}>
            Allow microphone
          </Button>
        )}
      </div>
      {on && devices.length > 1 && (
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[var(--sc-ink-2)]">Microphone</span>
          <select
            className="h-8 max-w-[260px] rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2 text-[13px]"
            value={s?.input_device ?? ''}
            onChange={(e) => {
              app.save({ input_device: e.target.value });
              mic.stop();
              void mic.start(e.target.value);
            }}
          >
            <option value="">Default</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {on && (
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[var(--sc-ink-2)]">Room noise {noise !== null && <span className="sc-mono sc-num text-[var(--sc-muted)]">· {noise} dB{noise > -45 ? ' (noisy: a quieter room helps)' : ''}</span>}</span>
          <Button size="sm" busy={measuring} onClick={measure}>
            {measuring ? 'Stay quiet…' : noise === null ? 'Measure (3 s of quiet)' : 'Measure again'}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="sc-label">How you listen</span>
        <Segmented
          value={s?.output ?? 'wired'}
          onChange={(v) => app.save({ output: v })}
          options={[
            { value: 'wired', label: 'Wired headphones', icon: Headphones },
            { value: 'bluetooth', label: 'Bluetooth', icon: Bluetooth },
            { value: 'speakers', label: 'Speakers', icon: Speaker },
          ]}
          label="How you listen"
        />
        {s?.output === 'bluetooth' && (
          <p className="flex gap-1.5 text-[12px] leading-4 text-[var(--sc-ink-2)]">
            <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--sc-warn)]" />
            Bluetooth adds a delay (often 0.1-0.3 s). Run the timing test so the app can take it off, or use wired headphones.
          </p>
        )}
        {s?.output === 'speakers' && <p className="text-[12px] leading-4 text-[var(--sc-ink-2)]">With speakers the guide voice leaks into the microphone, so the app gives only the starting note while you sing. Echo and Solo work fully.</p>}
      </div>
    </div>
  );
}

/** Eight clicks: sing "ta" with each. The median delay is stored as the latency. */
export function TimingStep(): React.JSX.Element {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<number | null>(null);
  const [beat, setBeat] = useState(-1);
  const run = async (): Promise<void> => {
    if (mic.status !== 'on') {
      const st = await mic.start(app.settings?.input_device ?? '');
      if (st !== 'on') return setState('failed');
    }
    const ctx = audio.ensure();
    setState('running');
    const interval = 0.6;
    const t0 = ctx.currentTime + 0.8;
    const clicks = Array.from({ length: 8 }, (_, i) => t0 + i * interval);
    for (const c of clicks) audio.click(c, true);
    const onsets: number[] = [];
    let prevVoiced = false;
    let lastOnset = -1;
    const off = mic.onFrame((f) => {
      const loud = f.db > mic.noise + 18;
      if (loud && !prevVoiced && f.t - lastOnset > 0.25) {
        onsets.push(f.t);
        lastOnset = f.t;
      }
      prevVoiced = loud;
    });
    const timer = window.setInterval(() => setBeat(Math.floor((ctx.currentTime - t0) / interval)), 60);
    window.setTimeout(
      () => {
        off();
        window.clearInterval(timer);
        setBeat(-1);
        const deltas: number[] = [];
        for (const c of clicks) {
          const near = onsets.filter((o) => o - c > -0.15 && o - c < 0.45).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0];
          if (near !== undefined) deltas.push(near - c);
        }
        if (deltas.length < 5) return setState('failed');
        deltas.sort((a, b) => a - b);
        const ms = Math.round(deltas[Math.floor(deltas.length / 2)]! * 1000);
        setResult(ms);
        setState('done');
        app.save({ latency_ms: Math.max(0, ms) });
      },
      (0.8 + 8 * interval + 0.6) * 1000,
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-5 text-[var(--sc-ink-2)]">Eight clicks will play. Sing a short “ta” exactly with each one. The app measures how late your voice arrives through the speakers or headphones and the microphone, and takes it off when it judges timing.</p>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={cn('size-3 rounded-full border transition-colors', i <= beat ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)]' : 'border-[var(--sc-line-2)]')} />
        ))}
        <span className="flex-1" />
        <Button size="sm" icon={Timer} busy={state === 'running'} onClick={() => void run()}>
          {state === 'done' || state === 'failed' ? 'Again' : 'Start the clicks'}
        </Button>
      </div>
      {state === 'done' && result !== null && (
        <p className="flex items-center gap-1.5 text-[13px]">
          <Check size={14} aria-hidden className="text-[var(--sc-voice)]" /> Your timing offset is <span className="sc-mono sc-num font-semibold">{result} ms</span>
          {result > 150 && <span className="text-[var(--sc-muted)]"> · large: Bluetooth?</span>}
        </p>
      )}
      {state === 'failed' && <p className="text-[13px] text-[var(--sc-ink-2)]">Not enough “ta”s were heard. Sing a little louder, closer to the microphone, and try again.</p>}
    </div>
  );
}

/**
 * The range test: slide down and hold your lowest comfortable note, then
 * slide up and hold your highest (no straining). Each note counts once it is
 * held a second within ±50 cents.
 */
export function RangeTest({ kind, onSaved }: { kind: 'onboarding' | 'quick' | 'full'; onSaved?: ((v: Voice) => void) | undefined }): React.JSX.Element {
  const app = useApp();
  const dial = useRef<DialHandle | null>(null);
  const [phase, setPhase] = useState<'idle' | 'low' | 'high' | 'done'>('idle');
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const win = useRef<{ t: number; m: number }[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** The last note held in this phase (null at the start of each). */
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    const off = mic.onFrame((f) => {
      const t = performance.now();
      dial.current?.push({ at: t, voiced: f.voiced, midi: f.midi, db: f.db });
      if (phaseRef.current !== 'low' && phaseRef.current !== 'high') return;
      if (!f.voiced) {
        // A gap of more than 150 ms ends the hold; shorter dropouts are ignored.
        const lastAt = win.current[win.current.length - 1]?.t ?? 0;
        if (t - lastAt > 150) win.current = [];
        return;
      }
      win.current.push({ t, m: f.midi });
      while (win.current.length > 0 && t - win.current[0]!.t > 1000) win.current.shift();
      // Held for a second: most of the window voiced, and steady once vibrato is averaged out
      // (a natural vibrato swings ±50 cents and more; a short slip does not undo the hold).
      const med = win.current.length >= 45 && t - win.current[0]!.t >= 900 ? heldPitch(win.current.map((x) => x.m)) : null;
      if (med !== null) {
        const held = Math.round(med * 10) / 10;
        // A slide moves a step at a time: a held note more than 7 semitones past the last one is an
        // octave slip of the pitch tracker (a subharmonic or a harmonic), not the voice.
        const lastHeld = lastRef.current;
        if (lastHeld !== null && Math.abs(held - lastHeld) > 7) return;
        lastRef.current = held;
        setNow(held);
        if (phaseRef.current === 'low') setLow((x) => (x === null ? held : Math.min(x, held)));
        else setHigh((x) => (x === null ? held : Math.max(x, held)));
      }
    });
    let raf = 0;
    const tick = (t: number): void => {
      dial.current?.draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  const begin = async (p: 'low' | 'high'): Promise<void> => {
    if (mic.status !== 'on') {
      const st = await mic.start(app.settings?.input_device ?? '');
      if (st !== 'on') return setError(micProblem(st));
    }
    setError('');
    win.current = [];
    lastRef.current = null;
    setNow(null);
    setPhase(p);
  };

  const save = async (): Promise<void> => {
    if (low === null || high === null) return;
    setBusy(true);
    try {
      const r = await api.voiceTest({ low, high, kind });
      setPhase('done');
      app.reload();
      onSaved?.(r.voice);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-panel)]">
        <VoiceDial ref={dial} height={128} hideSides mode="free" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {(['low', 'high'] as const).map((p) => {
          const v = p === 'low' ? low : high;
          const active = phase === p;
          return (
            <div key={p} className={cn('flex flex-col gap-1.5 rounded-[var(--sc-radius)] border p-3', active ? 'border-[var(--sc-ink)]' : 'border-[var(--sc-line)]')}>
              <span className="sc-label">{p === 'low' ? 'Lowest held' : 'Highest held'}</span>
              <span className="sc-mono sc-num text-[24px] font-light leading-none">{v === null ? '—' : noteLabel(v)}</span>
              <span className="text-[11.5px] leading-4 text-[var(--sc-muted)]">{p === 'low' ? 'On “ah”, slide down from a comfortable note and hold the lowest that still sounds clear.' : 'Slide up as high as is easy, no straining, and hold it a second.'}</span>
              <Button size="sm" variant={active ? 'primary' : 'default'} onClick={() => (active ? setPhase('idle') : void begin(p))}>
                {active ? 'Done' : v === null ? 'Start' : 'Again'}
              </Button>
            </div>
          );
        })}
      </div>
      {(phase === 'low' || phase === 'high') && <p className="text-[12.5px] text-[var(--sc-ink-2)]">{now === null ? 'Sing and hold a note for a second…' : `Held ${noteLabel(now)}. Keep going ${phase === 'low' ? 'lower' : 'higher'} if it is easy, then press Done.`}</p>}
      {error !== '' && <p className="text-[12.5px] text-[var(--sc-bad)]">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--sc-muted)]">{low !== null && high !== null ? `${noteLabel(low)} to ${noteLabel(high)} · ${Math.round(high - low)} semitones` : 'Stop if anything strains or hurts.'}</span>
        <Button variant="primary" size="sm" disabled={low === null || high === null || high - low < 3} busy={busy} onClick={() => void save()}>
          {phase === 'done' ? 'Saved' : 'Save my range'}
        </Button>
      </div>
    </div>
  );
}

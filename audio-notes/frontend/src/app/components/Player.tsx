import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react';
import { clock } from '../format.ts';
import { SelectField } from './ui.tsx';

export interface PlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/**
 * Audio player. Length comes from the note (measured from the decoded audio
 * by the worker) whenever it is known; the element's own duration is used
 * only before that.
 */
export function Player({
  src,
  knownSeconds,
  onTime,
  ref,
}: {
  src: string;
  knownSeconds: number;
  onTime: (seconds: number) => void;
  ref?: React.Ref<PlayerHandle> | undefined;
}): React.JSX.Element {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [elementSeconds, setElementSeconds] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = knownSeconds > 0 ? knownSeconds : elementSeconds;

  useImperativeHandle(ref, () => ({
    seek: (seconds: number, play = true) => {
      const el = audio.current;
      if (el === null) return;
      el.currentTime = Math.max(0, seconds);
      if (play) void el.play().catch(() => undefined);
    },
  }));

  useEffect(() => {
    setFailed(false);
    setTime(0);
    setPlaying(false);
  }, [src]);

  useEffect(() => {
    if (audio.current !== null) audio.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    if (audio.current === null) return;
    audio.current.volume = volume;
    audio.current.muted = muted;
  }, [volume, muted]);

  const skip = (delta: number): void => {
    const el = audio.current;
    if (el !== null) el.currentTime = Math.min(Math.max(0, el.currentTime + delta), total || el.currentTime + delta);
  };

  return (
    <div className="flex h-14 items-center gap-2 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setElementSeconds(d);
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={failed}
        onClick={() => {
          const el = audio.current;
          if (el === null) return;
          if (el.paused) void el.play().catch(() => setFailed(true));
          else el.pause();
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <button
        type="button"
        aria-label="Back 15 seconds"
        title="Back 15 seconds"
        onClick={() => skip(-15)}
        className="inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
      >
        <RotateCcw size={15} />
      </button>
      <button
        type="button"
        aria-label="Forward 15 seconds"
        title="Forward 15 seconds"
        onClick={() => skip(15)}
        className="inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
      >
        <RotateCw size={15} />
      </button>
      <span className="ml-1 w-11 shrink-0 text-right text-xs tabular-nums text-[var(--agent-app-muted)]">{clock(time)}</span>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={Math.max(total, 1)}
        step={0.1}
        value={Math.min(time, Math.max(total, 1))}
        disabled={failed}
        onChange={(e) => {
          const el = audio.current;
          const t = Number(e.target.value);
          setTime(t);
          if (el !== null) el.currentTime = t;
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--agent-app-accent)]"
      />
      <span className="w-11 shrink-0 text-xs tabular-nums text-[var(--agent-app-muted)]">{total > 0 ? clock(total) : '--:--'}</span>
      <div className="group/vol flex shrink-0 items-center">
        <button
          type="button"
          aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          title={muted || volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (muted || volume === 0) {
              setMuted(false);
              if (volume === 0) setVolume(0.8);
            } else setMuted(true);
          }}
          className="inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
        >
          {muted || volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          aria-label="Volume"
          title="Volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            setMuted(v === 0);
          }}
          className="h-1 w-20 accent-[var(--agent-app-accent)]"
        />
      </div>
      <SelectField
        variant="chip"
        ariaLabel="Playback speed"
        value={String(speed)}
        onChange={(v) => setSpeed(Number(v))}
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
        className="shrink-0"
      />
      {failed && <span className="shrink-0 text-xs text-red-600 dark:text-red-400">Audio could not be played</span>}
    </div>
  );
}

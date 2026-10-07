import { ArrowRight, MicOff, Pause, Play, Square, Trash2 } from 'lucide-react';
import { Button, cn, useConfirm } from '../../kit/index.ts';
import { clock } from '../format.ts';
import type { Recorder } from '../recorder/useRecorder.ts';

/** How long nothing may be heard before the recorder says so. */
const QUIET_WARN_MS = 10000;
/** No signal this long means the source delivers nothing at all. */
const NO_SIGNAL_MS = 3000;

const NO_SIGNAL_TEXT = {
  mic: 'No sound at all is reaching the recorder from this microphone (it may be muted, unplugged or a virtual device). Stop, then pick a microphone whose bar moves when you speak.',
  'mic+tab': 'No sound at all from the microphone or the shared tab. Check the microphone is not muted and that "Share tab audio" was switched on.',
  tab: 'The shared tab or screen is silent, and your microphone is not being recorded in this mode. To record your voice, stop and choose Microphone.',
} as const;

function isActive(rec: Recorder): boolean {
  return rec.phase === 'recording' || rec.phase === 'paused';
}

function Waveform({ rec, className }: { rec: Recorder; className?: string | undefined }): React.JSX.Element {
  const paused = rec.phase === 'paused';
  return (
    // Newest on the right; when the space is narrow the oldest are clipped.
    <div className={cn('flex items-center justify-end gap-[3px] overflow-hidden', className)} aria-hidden>
      {rec.bars.map((v, i) => (
        <span
          key={i}
          className={cn('w-[3px] shrink-0 rounded-full', paused ? 'bg-[var(--agent-app-muted)]/40' : 'bg-red-500/80')}
          style={{ height: `${Math.max(8, Math.round(v * 100))}%` }}
        />
      ))}
    </div>
  );
}

function Warnings({ rec }: { rec: Recorder }): React.JSX.Element | null {
  const paused = rec.phase === 'paused';
  const noSignal = !paused && rec.noSignalMs >= NO_SIGNAL_MS;
  const quiet = !paused && !noSignal && rec.quietMs >= QUIET_WARN_MS;
  if (!noSignal && !quiet && rec.notice === null) return null;
  return (
    <div className="flex flex-col gap-2">
      {noSignal && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--agent-app-radius)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">
          <MicOff size={15} className="mt-0.5 shrink-0" />
          {NO_SIGNAL_TEXT[rec.source]}
        </p>
      )}
      {quiet && (
        <p role="status" className="flex items-start gap-2 rounded-[var(--agent-app-radius)] bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-300">
          <MicOff size={15} className="mt-0.5 shrink-0" />
          Nothing heard for {Math.floor(rec.quietMs / 1000)} s. If people are talking, check this microphone is not muted, or stop and pick another one.
        </p>
      )}
      {rec.notice !== null && <p role="status" className="rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] px-3 py-2 text-[13px]">{rec.notice}</p>}
    </div>
  );
}

function Controls({ rec, onDiscard, size }: { rec: Recorder; onDiscard: () => void; size: 'sm' | 'md' }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const paused = rec.phase === 'paused';
  return (
    <div className="flex items-center gap-2">
      {confirmEl}
      <Button size={size} variant="secondary" onClick={paused ? rec.resume : rec.pause}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size={size} onClick={rec.stop}>
        <Square size={12} fill="currentColor" />
        Stop and save
      </Button>
      <button
        type="button"
        aria-label="Discard recording"
        title="Discard recording"
        onClick={() => {
          void confirm('The recording and its note will be thrown away. This cannot be undone.', 'Discard this recording?').then((ok) => {
            if (ok) onDiscard();
          });
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-red-600',
          size === 'sm' ? 'size-8' : 'size-9',
        )}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** The recorder on the recording's own page. */
export function RecorderPanel({ rec, onDiscard }: { rec: Recorder; onDiscard: () => void }): React.JSX.Element | null {
  if (!isActive(rec)) return null;
  const paused = rec.phase === 'paused';
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-5" aria-label="Recorder">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={cn('size-3 rounded-full', paused ? 'bg-amber-500' : 'animate-pulse bg-red-500')} aria-hidden />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-[var(--agent-app-muted)]">{paused ? 'Paused' : 'Recording'}</span>
            <span className="text-[28px] font-semibold leading-8 tabular-nums tracking-tight">{clock(rec.elapsedMs / 1000)}</span>
          </div>
        </div>
        <Controls rec={rec} onDiscard={onDiscard} size="md" />
      </div>
      <Waveform rec={rec} className="h-12" />
      <p className="truncate text-[13px] text-[var(--agent-app-muted)]">
        {rec.source === 'tab' ? 'Tab or screen audio only (your microphone is not recorded)' : rec.sourceLabel}
      </p>
      <Warnings rec={rec} />
    </section>
  );
}

/** Slim bar pinned on top while you look at something other than the recording. */
export function RecorderBar({ rec, onOpen, onDiscard }: { rec: Recorder; onOpen: () => void; onDiscard: () => void }): React.JSX.Element | null {
  if (!isActive(rec)) return null;
  const paused = rec.phase === 'paused';
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 md:px-10">
        <button type="button" onClick={onOpen} className="flex items-center gap-2.5 rounded-[var(--agent-app-radius)] py-1 pr-2 text-left transition-colors hover:text-[var(--agent-app-accent)]">
          <span className={cn('size-2.5 rounded-full', paused ? 'bg-amber-500' : 'animate-pulse bg-red-500')} aria-hidden />
          <span className="text-sm font-semibold">{paused ? 'Paused' : 'Recording'}</span>
          <span className="text-sm font-semibold tabular-nums">{clock(rec.elapsedMs / 1000)}</span>
          <span className="inline-flex items-center gap-1 text-[13px] text-[var(--agent-app-muted)]">
            Open
            <ArrowRight size={13} />
          </span>
        </button>
        <Waveform rec={rec} className="h-6 min-w-16 flex-1" />
        <Controls rec={rec} onDiscard={onDiscard} size="sm" />
        {(rec.noSignalMs >= NO_SIGNAL_MS || rec.quietMs >= QUIET_WARN_MS || rec.notice !== null) && (
          <div className="w-full">
            <Warnings rec={rec} />
          </div>
        )}
      </div>
    </div>
  );
}

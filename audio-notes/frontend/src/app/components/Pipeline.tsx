import { AlertTriangle, AudioLines, Loader2, MicOff, Sparkles, VolumeX } from 'lucide-react';
import { Button, Progress, cn } from '../../kit/index.ts';
import { settingUp } from '../data.ts';
import { length } from '../format.ts';
import type { EngineStatus, Note } from '../types.ts';

function Box({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: 'neutral' | 'warn' | 'bad';
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border px-4 py-3.5',
        tone === 'neutral' && 'border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10',
        tone === 'bad' && 'border-red-500/30 bg-red-500/10',
      )}
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            'shrink-0',
            tone === 'neutral' && 'text-[var(--agent-app-accent)]',
            tone === 'warn' && 'text-amber-600 dark:text-amber-400',
            tone === 'bad' && 'text-red-600 dark:text-red-400',
          )}
        >
          {icon}
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold">{title}</p>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Where this note is in the pipeline (record -> transcribe -> notes), with
 * the one action that moves it on. Renders nothing once both steps are done.
 */
export function Pipeline({
  note,
  engine,
  onTranscribe,
  onGenerate,
  onCancel,
  onDelete,
}: {
  note: Note;
  engine: EngineStatus | null;
  onTranscribe: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onDelete: () => void;
}): React.JSX.Element | null {
  const t = note.transcript_status;
  const n = note.notes_status;
  const job = engine?.job !== null && engine?.job !== undefined && engine.job.note_id === note.id ? engine.job : null;
  // The speech engine is still being downloaded (first run): work waits for it.
  const waitingForEngine = engine !== null && !engine.installed && settingUp(engine);
  const setupPercent =
    engine !== null && engine.setup.total_bytes > 0 ? Math.floor((engine.setup.done_bytes / engine.setup.total_bytes) * 100) : 0;
  const cancel = (
    <Button size="sm" variant="ghost" onClick={onCancel}>
      Cancel
    </Button>
  );

  if (t === 'finishing') {
    return (
      <Box tone="neutral" icon={<Loader2 size={16} className="animate-spin" />} title="Finishing the transcript">
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          {waitingForEngine
            ? `Waiting for the speech engine download (${setupPercent}%); then the last few seconds are transcribed and CraftBot writes the notes.`
            : 'Transcribing the last few seconds; then CraftBot writes the notes.'}
        </p>
      </Box>
    );
  }

  if (t === 'queued' && waitingForEngine) {
    return (
      <Box tone="neutral" icon={<Loader2 size={16} className="animate-spin" />} title="Waiting for the speech engine" actions={cancel}>
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          It is being downloaded ({setupPercent}%). This recording is transcribed as soon as it is ready.
        </p>
      </Box>
    );
  }

  if (t === 'queued') {
    return (
      <Box tone="neutral" icon={<Loader2 size={16} className="animate-spin" />} title="Waiting to transcribe" actions={cancel}>
        {engine?.busy === true && job === null && (
          <p className="text-[13px] text-[var(--agent-app-muted)]">Another recording is being processed first. This one starts right after.</p>
        )}
      </Box>
    );
  }

  if (t === 'processing') {
    const percent = job?.percent ?? null;
    let detail = 'Starting the transcription engine...';
    let title = 'Transcribing on this PC';
    if (job?.stage === 'converting') {
      title = 'Preparing the audio';
      detail = 'Converting the recording for the speech engine...';
    } else if (job?.stage === 'transcribing') {
      if (percent !== null && percent > 2 && percent < 100) {
        const left = Math.round((job.elapsed_seconds * (100 - percent)) / percent);
        detail = `${percent}% done, about ${length(Math.max(left, 5))} left`;
      } else if (job.audio_seconds > 0) {
        detail = `Listening to ${length(job.audio_seconds)} of audio...`;
      }
    }
    return (
      <Box tone="neutral" icon={<AudioLines size={16} />} title={title} actions={cancel}>
        <Progress value={percent ?? 0} className={cn(percent === null && 'opacity-40')} />
        <p className="text-[13px] text-[var(--agent-app-muted)]">{detail} You can keep working; notes are written automatically when it finishes.</p>
      </Box>
    );
  }

  if (t === 'failed') {
    return (
      <Box
        tone="bad"
        icon={<AlertTriangle size={16} />}
        title="Transcription failed"
        actions={
          <Button size="sm" variant="secondary" onClick={onTranscribe}>
            Try again
          </Button>
        }
      >
        <p className="whitespace-pre-wrap text-[13px] text-red-700 dark:text-red-300">{note.transcript_error}</p>
      </Box>
    );
  }

  // Digital silence (the 16-bit floor): nothing ever reached the recorder.
  if (t === 'no_speech' && note.peak_db !== 0 && note.peak_db <= -90) {
    return (
      <Box
        tone="bad"
        icon={<MicOff size={16} />}
        title="This recording is completely silent"
        actions={
          <Button size="sm" variant="secondary" onClick={onDelete}>
            Delete it
          </Button>
        }
      >
        <p className="text-[13px] leading-relaxed text-red-700 dark:text-red-300">
          No sound reached the recorder at all, so there is nothing to transcribe. Either the microphone sent nothing (muted, unplugged or a virtual
          device), or only a silent tab was recorded ("Tab or screen audio only" does not record your microphone). When you record again, check that the
          bar of your microphone moves in the recording window before you start.
        </p>
      </Box>
    );
  }

  if (t === 'no_speech') {
    return (
      <Box
        tone="warn"
        icon={<VolumeX size={16} />}
        title="No speech found in this recording"
        actions={
          <Button size="sm" variant="secondary" onClick={onTranscribe}>
            Transcribe again
          </Button>
        }
      >
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          The speech engine heard nothing it could transcribe. If people were talking, the microphone was probably muted or not the one picking them up.
          Play the recording to check, or try again with the language set explicitly.
        </p>
      </Box>
    );
  }

  if (n === 'queued' || n === 'processing') {
    return (
      <Box tone="neutral" icon={<Sparkles size={16} className="animate-pulse" />} title="CraftBot is writing the notes" actions={cancel}>
        <p className="text-[13px] text-[var(--agent-app-muted)]">Summary, key points, decisions and action items appear here in a moment.</p>
      </Box>
    );
  }

  if (n === 'failed') {
    return (
      <Box
        tone="bad"
        icon={<AlertTriangle size={16} />}
        title="The notes could not be written"
        actions={
          <Button size="sm" variant="secondary" onClick={onGenerate}>
            Retry
          </Button>
        }
      >
        <p className="whitespace-pre-wrap text-[13px] text-red-700 dark:text-red-300">{note.notes_error}</p>
      </Box>
    );
  }

  if (t === '' && note.audio !== '') {
    if (engine !== null && !engine.installed && !waitingForEngine) {
      return (
        <Box tone="bad" icon={<AlertTriangle size={16} />} title="The speech engine is not installed">
          <p className="text-[13px] leading-relaxed text-red-700 dark:text-red-300">Download it from the banner above, then transcribe this note.</p>
        </Box>
      );
    }
    return (
      <Box
        tone="neutral"
        icon={<AudioLines size={16} />}
        title="Not transcribed yet"
        actions={
          <Button size="sm" onClick={onTranscribe}>
            Transcribe
          </Button>
        }
      />
    );
  }

  return null;
}

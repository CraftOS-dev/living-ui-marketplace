import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Progress, cn } from '../../kit/index.ts';
import { api } from '../api.ts';
import { megabytes } from '../format.ts';
import type { EngineStatus } from '../types.ts';

/**
 * The one-time speech engine download (pb_hooks/lib_setup.js), above every
 * page until the engine is in place: progress while it runs, the error and
 * Retry when it failed. Recordings and uploads made meanwhile wait for it.
 */
export function EngineSetup({ engine, onChange }: { engine: EngineStatus | null; onChange: () => void }): React.JSX.Element | null {
  const [starting, setStarting] = useState(false);
  if (engine === null || engine.setup.state === 'ready') return null;
  const s = engine.setup;

  const start = (): void => {
    setStarting(true);
    void api
      .installEngine()
      .catch(() => undefined)
      .finally(() => {
        setStarting(false);
        onChange();
      });
  };

  const bad = s.state === 'failed' || s.state === 'off';
  const percent = s.total_bytes > 0 ? Math.floor((s.done_bytes / s.total_bytes) * 100) : 0;
  let icon = <Loader2 size={16} className="animate-spin" />;
  let title = 'Getting the speech engine ready';
  let detail: React.ReactNode = `A one-time download of about ${megabytes(s.total_bytes)} starts in a moment.`;
  let action: React.ReactNode = null;

  if (s.state === 'downloading' || s.state === 'installing') {
    icon = <Download size={16} />;
    title = 'Downloading the speech engine';
    detail = `${s.state === 'installing' ? 'Installing' : 'Downloading'} ${s.step}: ${megabytes(s.done_bytes)} of ${megabytes(s.total_bytes)}.`;
  } else if (s.state === 'failed') {
    icon = <AlertTriangle size={16} />;
    title = 'The speech engine could not be downloaded';
    detail = s.error;
    action = (
      <Button size="sm" variant="secondary" loading={starting} onClick={start}>
        Retry
      </Button>
    );
  } else if (s.state === 'off') {
    icon = <AlertTriangle size={16} />;
    title = 'The speech engine is not installed';
    detail = `Audio is transcribed on this PC by a local engine. It is downloaded once (about ${megabytes(s.total_bytes)}).`;
    action = (
      <Button size="sm" loading={starting} onClick={start}>
        <Download size={14} />
        Download
      </Button>
    );
  }

  return (
    <div className="mx-auto mt-4 flex w-full max-w-4xl flex-col gap-2 px-4 md:px-8">
      <div
        role={bad ? 'alert' : 'status'}
        className={cn(
          'flex flex-col gap-2.5 rounded-xl border px-4 py-3',
          bad ? 'border-red-500/30 bg-red-500/10' : 'border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={cn('shrink-0', bad ? 'text-red-600 dark:text-red-400' : 'text-[var(--agent-app-accent)]')}>{icon}</span>
          <p className="min-w-0 flex-1 text-sm font-semibold">{title}</p>
          {(s.state === 'downloading' || s.state === 'installing') && (
            <span className="shrink-0 text-xs tabular-nums text-[var(--agent-app-muted)]">{percent}%</span>
          )}
          {action}
        </div>
        {(s.state === 'downloading' || s.state === 'installing') && <Progress value={percent} />}
        <p className={cn('whitespace-pre-wrap text-[13px] leading-relaxed', bad ? 'text-red-700 dark:text-red-300' : 'text-[var(--agent-app-muted)]')}>
          {detail}
          {!bad && ' Recordings and uploads made meanwhile are transcribed as soon as it is ready.'}
        </p>
      </div>
    </div>
  );
}

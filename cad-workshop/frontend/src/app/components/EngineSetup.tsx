/**
 * The geometry engine's one-off first-run setup (lib_setup.js), for the dark
 * engine panels on Home and in Settings: progress while it downloads, the
 * reason and Retry when it failed, Install when it waits to be started.
 */
import { useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { EngineSetup } from '../lib/types.ts';
import { Button, errMessage } from './ui.tsx';

const MB = 1000000;

function mb(n: number): string {
  return (n / MB).toFixed(n > 0 && n < 10 * MB ? 1 : 0) + ' MB';
}

/** True while the setup is on its way (it needs no one to start it). */
export function setupActive(setup: EngineSetup): boolean {
  return setup.state === 'pending' || setup.state === 'downloading' || setup.state === 'installing';
}

/** The engine badge while it is not installed yet. */
export function setupBadge(setup: EngineSetup): { label: string; bad: boolean } {
  if (setup.state === 'failed') return { label: 'Setup failed', bad: true };
  if (setup.state === 'off') return { label: 'Not installed', bad: true };
  return { label: 'Setting up', bad: false };
}

export function EngineSetupNote({ setup }: { setup: EngineSetup }): React.JSX.Element | null {
  const { reloadStatus } = useApp();
  const [busy, setBusy] = useState(false);
  if (setup.state === 'ready') return null;
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.runJob('engine_install');
      reloadStatus();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (setupActive(setup)) {
    const pct = setup.total_bytes > 0 ? Math.min(100, Math.round((setup.done_bytes / setup.total_bytes) * 100)) : 0;
    const doing = setup.state === 'pending' ? 'Starting the download' : (setup.state === 'installing' ? 'Unpacking ' : 'Downloading ') + setup.step;
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <span className="min-w-0 truncate">{doing}</span>
          <span className="num shrink-0 text-[var(--cw-on-dark-muted)]">
            {mb(setup.done_bytes)} of {mb(setup.total_bytes)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[var(--cw-r-sm)] bg-[var(--cw-dark-2)]" role="progressbar" aria-label="Engine setup" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-[var(--cw-accent)] transition-[width] duration-500" style={{ width: pct + '%' }} />
        </div>
        <p className="text-[12px] leading-4 text-[var(--cw-on-dark-muted)]">First run on this computer: Python and the OpenCascade kernel are downloaded once. Parts you start now build as soon as it is ready.</p>
      </div>
    );
  }
  const failed = setup.state === 'failed';
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      <p className="text-[12px] leading-4 text-[var(--cw-on-dark-muted)]">{failed ? setup.error : 'Python and the OpenCascade kernel (' + mb(setup.total_bytes) + ') are downloaded once on this computer.'}</p>
      <Button variant="accent" size="sm" icon={failed ? RotateCcw : Download} loading={busy} onClick={() => void start()}>
        {failed ? 'Retry the setup' : 'Install the engine'}
      </Button>
    </div>
  );
}

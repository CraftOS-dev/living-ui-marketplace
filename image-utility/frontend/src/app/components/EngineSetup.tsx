/**
 * The image engine's one-off setup (lib_setup.js): progress while it
 * downloads, the reason and Retry when it failed, and the optional
 * background-removal models, which download only when the person asks.
 */
import { useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { EngineSetup } from '../lib/types.ts';
import { Button, errMessage } from './ui.tsx';

export type Group = 'core' | 'bg' | 'bg_detailed';

function mb(n: number): string {
  return (n / 1e6).toFixed(n > 0 && n < 10e6 ? 1 : 0) + ' MB';
}

/** True while something downloads or unpacks (nobody needs to start it). */
export function setupActive(setup: EngineSetup, group: Group = 'core'): boolean {
  const p = setup.progress;
  if (group === 'core' && setup.state === 'pending') return true;
  return p !== null && p.group === group && (p.phase === 'downloading' || p.phase === 'installing');
}

/** The engine badge while it is not installed yet. */
export function setupBadge(setup: EngineSetup): { label: string; bad: boolean } {
  if (setup.state === 'failed') return { label: 'Setup failed', bad: true };
  if (setup.state === 'off') return { label: 'Not installed', bad: true };
  return { label: 'Setting up', bad: false };
}

function Progress({ setup, dark }: { setup: EngineSetup; dark: boolean }): React.JSX.Element | null {
  const p = setup.progress;
  if (p === null) return null;
  const pct = p.total_bytes > 0 ? Math.min(100, Math.round((p.done_bytes / p.total_bytes) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="min-w-0 truncate">{(p.phase === 'installing' ? 'Unpacking ' : 'Downloading ') + p.step}</span>
        <span className={cn('num shrink-0', dark ? 'text-[var(--iu-on-dark-muted)]' : 'text-[var(--iu-muted)]')}>
          {mb(p.done_bytes)} of {mb(p.total_bytes)}
        </span>
      </div>
      <div className={cn('h-1.5 overflow-hidden rounded-[var(--iu-r-sm)]', dark ? 'bg-[var(--iu-dark-2)]' : 'bg-[var(--iu-row)]')} role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full bg-[var(--iu-accent)] transition-[width] duration-500" style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}

/** For the dark engine panels (Home, Settings): the core engine's setup. */
export function EngineSetupNote({ setup }: { setup: EngineSetup }): React.JSX.Element | null {
  const { reloadStatus } = useApp();
  const [busy, setBusy] = useState(false);
  if (setup.state === 'ready') return null;
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.install('core');
      reloadStatus();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (setupActive(setup)) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {setup.progress !== null ? <Progress setup={setup} dark /> : <p className="text-[12px]">Starting the download</p>}
        <p className="text-[12px] leading-4 text-[var(--iu-on-dark-muted)]">First run on this computer: Python and the image libraries (about {mb(setup.groups.core.total_mb * 1e6)}) are downloaded once and checked. Images you import now are read as soon as it is ready.</p>
      </div>
    );
  }
  const failed = setup.state === 'failed';
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      <p className="text-[12px] leading-4 text-[var(--iu-on-dark-muted)]">{failed ? (setup.progress?.error ?? 'The download stopped.') : 'Python and the image libraries (' + mb(setup.groups.core.total_mb * 1e6) + ') are downloaded once on this computer.'}</p>
      <Button variant="accent" size="sm" icon={failed ? RotateCcw : Download} loading={busy} onClick={() => void start()}>
        {failed ? 'Retry the setup' : 'Install the engine'}
      </Button>
    </div>
  );
}

/** A background-removal model: installed, downloading (with progress) or an Install button. */
export function AddonRow({ group, setup, title, detail }: { group: 'bg' | 'bg_detailed'; setup: EngineSetup; title: string; detail: string }): React.JSX.Element {
  const { reloadStatus } = useApp();
  const [busy, setBusy] = useState(false);
  const g = setup.groups[group];
  const active = setupActive(setup, group);
  const failed = setup.progress !== null && setup.progress.group === group && setup.progress.phase === 'failed';
  const waiting = !g.installed && !active && setup.requested.includes(group) && !failed;
  const install = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.install(group);
      reloadStatus();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="text-[12px] leading-4 text-[var(--iu-muted)]">{detail}</p>
        </div>
        {g.installed ? (
          <span className="text-[12px] font-semibold text-[var(--iu-green-text)]">Installed</span>
        ) : active || waiting ? (
          <span className="text-[12px] font-semibold text-[var(--iu-muted)]">{waiting ? 'Queued' : 'Downloading'}</span>
        ) : (
          <Button size="sm" icon={failed ? RotateCcw : Download} loading={busy} onClick={() => void install()}>
            {failed ? 'Retry' : 'Install ' + mb(g.download_mb * 1e6)}
          </Button>
        )}
      </div>
      {active && <Progress setup={setup} dark={false} />}
      {failed && <p className="text-[12px] leading-4 text-[var(--iu-red-text)]">{setup.progress?.error}</p>}
    </div>
  );
}

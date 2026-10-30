/**
 * The open tool: a small dialog floating over the top left of the image, as
 * in desktop editors. Every change in it is saved as it is made, so there is
 * no Apply or Cancel: undo and redo sit in its bar, the cross (or Esc)
 * closes it. Under the fields, what to do next, the result's size, warnings
 * or why a value was refused.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Redo2, Undo2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { dims as fmtDims } from '../../lib/format.ts';
import type { Dims } from '../../lib/types.ts';
import { Spinner } from '../ui.tsx';
import type { ToolDef } from './tools.ts';

export interface ToolStatus {
  /** Saving or rendering. */
  busy: boolean;
  /** Why the last change was not saved (a refused value). */
  problem: string | null;
  warnings: string[];
  /** The whole image's size with the edit. */
  out: Dims | null;
  /** What to do while nothing is saved yet. */
  waiting: string | null;
}

function BarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-6 items-center justify-center rounded-[var(--iu-r-sm)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)] disabled:opacity-35 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

export function ToolDialog({ def, status, canUndo, canRedo, onUndo, onRedo, onClose, children }: { def: ToolDef; status: ToolStatus; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onClose: () => void; children: ReactNode }): React.JSX.Element {
  const Icon = def.icon;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const note = status.problem !== null || status.warnings.length > 0 || status.waiting !== null || status.out !== null;
  return (
    <section aria-label={def.label} className="iu-pop pointer-events-auto flex max-h-full w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] shadow-[var(--iu-shadow)]">
      <header className={cn('flex h-8 shrink-0 items-center gap-1 border-b pl-2 pr-1', status.problem !== null ? 'border-[var(--iu-red)] bg-[var(--iu-red)]/8' : 'border-[var(--iu-hair)]')}>
        <Icon size={14} aria-hidden className={status.problem !== null ? 'text-[var(--iu-red-text)]' : 'text-[var(--iu-ink-2)]'} />
        <h2 className={cn('min-w-0 flex-1 truncate pl-0.5 text-[13px] font-bold', status.problem !== null && 'text-[var(--iu-red-text)]')}>{def.label}</h2>
        {status.busy && <Spinner size={12} className="mr-0.5 text-[var(--iu-muted)]" />}
        <BarButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} aria-hidden />
        </BarButton>
        <BarButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={14} aria-hidden />
        </BarButton>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--iu-line)]" />
        <BarButton label="Close (Esc)" onClick={onClose}>
          <X size={14} aria-hidden />
        </BarButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">{children}</div>
      {note && (
        <div className="shrink-0 border-t border-[var(--iu-hair)] px-2.5 py-1.5 text-[12px] leading-4">
          {status.problem !== null ? (
            <p role="alert" className="text-[var(--iu-red-text)]">
              {status.problem}
            </p>
          ) : status.waiting !== null ? (
            <p className="text-[var(--iu-muted)]">{status.waiting}</p>
          ) : (
            <>
              {status.out !== null && <p className="num text-[var(--iu-ink-2)]">Result {fmtDims(status.out[0], status.out[1])}</p>}
              {status.warnings.map((w) => (
                <p key={w} className="text-[var(--iu-amber-text)]">
                  {w}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

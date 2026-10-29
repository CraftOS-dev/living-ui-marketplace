/**
 * The History tab: every change to this image, newest first, as batches
 * (an edit, an undo, a redo), who made it and when. Undo and Redo step
 * through them; Revert undoes one batch on its own (and can be undone too).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Redo2, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import type { HistoryBatch, ImageDetail, Json } from '../../lib/types.ts';
import { Button, Empty, Spinner, errMessage } from '../ui.tsx';

function describeChange(action: string, before: Json, after: Json): string {
  const pick = (v: Json): string => (v !== null && typeof v === 'object' && !Array.isArray(v) ? String((v as Record<string, Json>)['kind'] ?? '') : '');
  const kind = (pick(after) || pick(before)).replace('_', ' ');
  if (action === 'add') return 'Added ' + kind;
  if (action === 'remove') return 'Removed ' + kind;
  if (action === 'move') return 'Moved ' + kind;
  return 'Changed ' + kind;
}

function Row({ b, onRevert, busy }: { b: HistoryBatch; onRevert: () => void; busy: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = b.kind === 'undo' ? Undo2 : b.kind === 'redo' ? Redo2 : Pencil;
  const reverted = b.reverted_by !== '';
  return (
    <li className="group flex flex-col rounded-[var(--iu-r-sm)] px-1.5 py-1 hover:bg-[var(--iu-row)]">
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-0.5 shrink-0 text-[var(--iu-muted)]" aria-label="Details">
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        </button>
        <Icon size={13} aria-hidden className={cn('mt-0.5 shrink-0', reverted ? 'text-[var(--iu-muted)]' : 'text-[var(--iu-ink-2)]')} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[12px] font-semibold leading-4', reverted && 'text-[var(--iu-muted)] line-through')}>{b.note !== '' ? b.note : b.count + (b.count === 1 ? ' change' : ' changes')}</p>
          <p className="flex items-center gap-1 text-[12px] leading-4 text-[var(--iu-muted)]">
            {b.actor === 'agent' && <Sparkles size={11} aria-hidden className="text-[var(--iu-accent-text)]" />}
            {b.actor === 'agent' ? 'Your AI agent' : b.actor === 'system' ? 'The app' : 'You'} · {ago(b.created)}
            {reverted && ' · undone'}
          </p>
        </div>
        {!reverted && (
          <button type="button" disabled={busy} onClick={onRevert} title="Undo just this change" className="shrink-0 self-center rounded-[var(--iu-r-sm)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--iu-ink-2)] opacity-0 hover:bg-[var(--iu-row-hover)] hover:text-[var(--iu-ink)] group-hover:opacity-100 focus-visible:opacity-100">
            Revert
          </button>
        )}
      </div>
      {open && (
        <ul className="ml-[34px] mt-1 flex flex-col gap-0.5">
          {b.changes.map((c) => (
            <li key={c.id} className="text-[12px] leading-4 text-[var(--iu-ink-2)]">
              {describeChange(c.action, c.before, c.after)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function HistoryPanel({ d }: { d: ImageDetail }): React.JSX.Element {
  const list = useLive(() => api.history({ image: d.id, limit: 60 }), ['changes'], [d.id]);
  const [busy, setBusy] = useState(false);
  const act = (p: Promise<unknown>): void => {
    setBusy(true);
    p.catch((err: unknown) => toast.error(errMessage(err))).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--iu-hair)] px-3 py-2">
        <Button size="sm" icon={Undo2} disabled={!d.undo.can_undo || busy} onClick={() => act(api.undo(d.id))}>
          Undo
        </Button>
        <Button size="sm" icon={Redo2} disabled={!d.undo.can_redo || busy} onClick={() => act(api.redo(d.id))}>
          Redo
        </Button>
        <span className="flex-1" />
        {busy && <Spinner size={12} className="text-[var(--iu-muted)]" />}
      </div>
      {list.data === null ? (
        <div className="flex h-24 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={14} />
        </div>
      ) : list.data.batches.length === 0 ? (
        <Empty icon={RotateCcw} title="Nothing changed yet" compact>
          Every edit you or your AI agent make shows here, and can be undone.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-px p-1.5">
          {list.data.batches.map((b) => (
            <Row key={b.batch} b={b} busy={busy} onRevert={() => act(api.revert(b.batch))} />
          ))}
        </ul>
      )}
    </div>
  );
}

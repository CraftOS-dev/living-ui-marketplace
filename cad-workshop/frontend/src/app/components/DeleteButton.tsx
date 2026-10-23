/**
 * The one delete control for every kind of record: it asks records.delete
 * for a preview first (what goes with it, or what blocks it), then deletes.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import type { Json } from '../lib/types.ts';
import { Button, IconButton, Modal, errMessage } from './ui.tsx';

const NOUNS: Record<string, string> = {
  parts: 'part',
  features: 'feature',
  parameters: 'parameter',
  builds: 'build',
  exports: 'exported file',
  changes: 'batch of changes',
  checks: 'check',
  assets: 'file',
  briefs: 'request',
  compares: 'comparison',
  selections: 'selection',
};

const LABELS: Record<string, string> = {
  features: 'features',
  parameters: 'parameters',
  builds: 'builds',
  exports: 'exported files',
  changes: 'history entries',
  checks: 'checks',
  files_for_import: 'imported files',
  requests: 'requests to your AI agent',
  exports_keep_their_files: 'exports keep their files',
  checks_lose_their_link: 'checks lose their link',
};

export function DeleteButton({
  collection,
  id,
  name,
  onDeleted,
  variant = 'icon',
  size = 28,
  label,
  className,
}: {
  collection: string;
  id: string;
  name: string;
  onDeleted?: () => void;
  variant?: 'icon' | 'button' | 'menu';
  size?: number;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const [preview, setPreview] = useState<Record<string, Json> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = NOUNS[collection] ?? 'record';

  const ask = async (): Promise<void> => {
    setLoading(true);
    try {
      setPreview(await api.deletePreview(collection, id));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.delete(collection, id);
      setPreview(null);
      if (r['status'] === 'reverted' || r['status'] === 'failed') toast.error('Deleted, but the part did not build: see the feature tree');
      else toast.success('Deleted ' + name);
      onDeleted?.();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = preview !== null && Array.isArray(preview['blocked_by']) && (preview['blocked_by'] as Json[]).length > 0;
  const removes = preview !== null && preview['removes'] !== null && typeof preview['removes'] === 'object' ? (preview['removes'] as Record<string, Json>) : null;
  const note = preview !== null && typeof preview['note'] === 'string' ? (preview['note'] as string) : '';

  return (
    <>
      {variant === 'icon' && <IconButton icon={Trash2} label={label ?? 'Delete ' + name} variant="danger" size={size} onClick={() => void ask()} disabled={loading} className={className} />}
      {variant === 'button' && (
        <Button variant="danger" icon={Trash2} loading={loading} onClick={() => void ask()} className={className}>
          {label ?? 'Delete'}
        </Button>
      )}
      {variant === 'menu' && (
        <button type="button" onClick={() => void ask()} className={cn('flex h-7 w-full items-center gap-2 rounded-[var(--cw-r-sm)] px-2 text-left text-[13px] font-medium text-[var(--cw-red-text)] hover:bg-[var(--cw-red)]/10', className)}>
          <Trash2 size={14} aria-hidden />
          {label ?? 'Delete'}
        </button>
      )}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={blocked ? 'This ' + noun + ' is in use' : 'Delete ' + name + '?'}
        footer={
          blocked ? (
            <Button variant="primary" onClick={() => setPreview(null)}>
              OK
            </Button>
          ) : (
            <>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="primary" icon={Trash2} loading={busy} onClick={() => void confirm()}>
                Delete
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-2 text-[13px] text-[var(--cw-ink-2)]">
          {blocked && <p>{name} is used by {(preview?.['blocked_by'] as string[]).join(', ')}. Delete or change those first.</p>}
          {!blocked && removes !== null && (
            <ul className="flex flex-col overflow-hidden rounded-[var(--cw-r)] border border-[var(--cw-line)]">
              {Object.entries(removes)
                .filter(([, v]) => typeof v === 'number' && v > 0)
                .map(([k, v]) => (
                  <li key={k} className="flex h-7 items-center justify-between gap-3 border-b border-[var(--cw-hair)] bg-[var(--cw-card)] px-2.5 text-[12px] last:border-b-0">
                    <span>{LABELS[k] ?? k.replace(/_/g, ' ')}</span>
                    <span className="num font-semibold text-[var(--cw-ink)]">{String(v)}</span>
                  </li>
                ))}
            </ul>
          )}
          {note !== '' && <p className="text-[12px]">{note}</p>}
          {!blocked && removes === null && note === '' && <p>This cannot be undone.</p>}
        </div>
      </Modal>
    </>
  );
}

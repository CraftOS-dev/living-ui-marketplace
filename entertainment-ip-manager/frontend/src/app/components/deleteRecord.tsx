/**
 * Deleting any record, the same way everywhere: the server previews what
 * the delete takes along (cascades) and what only loses its link, the person
 * confirms, and records.delete does it (role-checked and audited on the server).
 *
 *   <DeleteButton collection="characters" id={c.id} onDeleted={() => navigate('characters')} />
 *   <DeleteButton collection="grants" id={g.id} iconOnly />
 *
 * or, for menus: const del = useDeleteRecord(); del.ask('products', id, onDone); {del.element}
 *
 * `note` adds advice only the caller knows ("mark the member as exited to keep
 * the history"); the preview still lists what goes and what loses its link.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button, Dialog, Textarea, cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import type { Can } from '../lib/context.tsx';
import { useApp } from '../lib/context.tsx';
import { bi, t } from '../lib/i18n.ts';
import type { Bi } from '../lib/shapes.ts';
import type { Col } from './DataTable.tsx';
import { Field, Notice } from './ui.tsx';

/** Collections whose delete needs an admin (the rest need a manager). Mirrors lib_records.DELETABLE. */
const ADMIN_ONLY = new Set(['deadlines', 'inbox_items', 'evidence', 'talent_identity', 'rules', 'users']);

export function canDelete(can: Can, collection: string): boolean {
  return ADMIN_ONLY.has(collection) ? can.admin : can.manage;
}

interface Impact {
  collection: string;
  id: string;
  label: string;
  kind: Bi;
  also_deletes: { collection: string; count: number; text: Bi }[];
  unlinks: { collection: string; count: number; text: Bi }[];
  deleted: boolean;
}

interface Pending {
  collection: string;
  id: string;
  onDeleted?: (() => void) | undefined;
  note?: string | undefined;
}

export function useDeleteRecord(): { ask: (collection: string, id: string, onDeleted?: () => void, note?: string) => void; element: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const ask = (collection: string, id: string, onDeleted?: () => void, note?: string): void => {
    setPending({ collection, id, onDeleted, note });
    setImpact(null);
    setError('');
    setReason('');
    op<Impact>('records/delete', { collection, id, preview: true })
      .then((r) => setImpact(r))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const close = (): void => {
    setPending(null);
    setImpact(null);
  };

  const confirm = async (): Promise<void> => {
    if (pending === null) return;
    setBusy(true);
    try {
      const r = await op<Impact>('records/delete', { collection: pending.collection, id: pending.id, reason: reason.trim() });
      toast.success(t('Deleted {what}', { what: r.label }));
      const done = pending.onDeleted;
      close();
      done?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const element =
    pending === null ? null : (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={impact !== null ? t('Delete {kind}?', { kind: bi(impact.kind) }) : t('Delete')}
        className="w-[min(94vw,32rem)]"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              {t('Cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirm()} loading={busy} disabled={impact === null}>
              <Trash2 size={14} aria-hidden /> {t('Delete')}
            </Button>
          </>
        }
      >
        {error !== '' ? (
          <Notice tone="bad">{error}</Notice>
        ) : impact === null ? (
          <p className="text-sm text-[var(--agent-app-muted)]">{t('Checking what this delete takes along...')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="break-words text-sm font-medium">{impact.label}</p>
            {pending.note !== undefined && pending.note !== '' && <Notice tone="warn">{pending.note}</Notice>}
            {impact.also_deletes.length > 0 && (
              <div>
                <p className="text-[13px] font-medium">{t('This also deletes:')}</p>
                <ul className="mt-1 list-disc pl-5 text-[13px]">
                  {impact.also_deletes.map((x) => (
                    <li key={x.collection}>{bi(x.text)}</li>
                  ))}
                </ul>
              </div>
            )}
            {impact.unlinks.length > 0 && (
              <div>
                <p className="text-[13px] font-medium">{t('These stay, without the link to it:')}</p>
                <ul className="mt-1 list-disc pl-5 text-[13px] text-[var(--agent-app-muted)]">
                  {impact.unlinks.map((x) => (
                    <li key={x.collection}>{bi(x.text)}</li>
                  ))}
                </ul>
              </div>
            )}
            {impact.collection === 'deadlines' && <Notice tone="warn">{t('Usually a deadline is closed with a reason so the history stays. Delete only an entry made by mistake.')}</Notice>}
            {impact.collection === 'events' && <Notice tone="warn">{t('Deadlines and dates this event set stay as they are. To correct them, record the right event or close those deadlines.')}</Notice>}
            <div className={cn('flex items-start gap-2 text-[13px] text-red-700 dark:text-red-400')}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>{t('This cannot be undone. The audit log keeps a copy of what was deleted.')}</span>
            </div>
            <Field label={t('Reason (optional)')}>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Dialog>
    );

  return { ask, element };
}

/** A delete button for one record; renders nothing for people who may not delete it. */
export function DeleteButton({
  collection,
  id,
  onDeleted,
  iconOnly = false,
  label,
  note,
  className,
}: {
  collection: string;
  id: string;
  onDeleted?: (() => void) | undefined;
  note?: string | undefined;
  iconOnly?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element | null {
  const { can } = useApp();
  const del = useDeleteRecord();
  if (!canDelete(can, collection)) return null;
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          className={cn('flex size-7 shrink-0 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600', className)}
          aria-label={label ?? t('Delete')}
          title={label ?? t('Delete')}
          onClick={() => del.ask(collection, id, onDeleted, note)}
        >
          <Trash2 size={14} />
        </button>
      ) : (
        <Button size="sm" variant="outline" className={cn('text-red-700 dark:text-red-400', className)} onClick={() => del.ask(collection, id, onDeleted, note)}>
          <Trash2 size={13} aria-hidden /> {label ?? t('Delete')}
        </Button>
      )}
      {del.element}
    </>
  );
}

/**
 * A trailing table column with the shared delete button (preview of what the
 * delete takes along, then records/delete). Empty when the person may not delete.
 */
export function deleteCol<T extends { id: string }>(collection: string, allowed: boolean, onDeleted?: ((r: T) => void) | undefined): Col<T>[] {
  if (!allowed) return [];
  return [
    {
      key: 'delete',
      label: t('Delete'),
      sortable: false,
      align: 'right',
      value: () => '',
      render: (r: T) => (
        <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DeleteButton collection={collection} id={r.id} iconOnly onDeleted={onDeleted !== undefined ? () => onDeleted(r) : undefined} />
        </span>
      ),
    },
  ];
}

/** The shared delete button for a dialog footer: sits on the left, closes the dialog once deleted. */
export function FooterDelete({ collection, id, onDeleted }: { collection: string; id: string; onDeleted: () => void }): React.JSX.Element {
  return (
    <div className="mr-auto">
      <DeleteButton collection={collection} id={id} onDeleted={onDeleted} />
    </div>
  );
}

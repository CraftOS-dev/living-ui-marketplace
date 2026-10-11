/**
 * The one delete control for every kind of record: it asks records.delete
 * for a preview first (what goes with it, or what blocks it, such as a
 * product with sales history that should be archived instead), then
 * deletes. Sales, payments, drawer sessions and the ledgers are permanent
 * and have no delete: they are corrected with returns, voids and
 * adjustments.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, isCancelled } from '../lib/api.ts';
import type { DeletePreview } from '../lib/types.ts';
import { Button, IconButton, Modal } from './ui.tsx';

const NOUNS: Record<string, string> = {
  products: 'product',
  variants: 'variant',
  categories: 'category',
  modifier_groups: 'option group',
  taxes: 'tax rate',
  registers: 'register',
  discounts: 'promotion',
  customers: 'customer',
  gift_cards: 'gift card',
  staff: 'team member',
  timeclock: 'time entry',
  requests: 'request',
  orders: 'open ticket',
};

/** What each `affects` key means, as a sentence part. */
const AFFECTS: Record<string, (n: number) => string> = {
  variants: (n) => n + (n === 1 ? ' variant is' : ' variants are') + ' deleted with it',
  discounts: (n) => n + (n === 1 ? ' promotion names' : ' promotions name') + ' it and will no longer apply to it',
  products_uncategorized: (n) => n + (n === 1 ? ' product moves' : ' products move') + ' to No category',
  products_losing_it: (n) => n + (n === 1 ? ' product loses' : ' products lose') + ' these options',
  products_to_default: (n) => n + (n === 1 ? ' product goes' : ' products go') + ' back to the default rate',
  uses: (n) => 'It was used ' + n + (n === 1 ? ' time' : ' times') + '; past sales keep their discount',
  sales_keep_without_name: (n) => n + (n === 1 ? ' sale keeps' : ' sales keep') + ' its amounts without the name',
  points_lost: (n) => n + ' loyalty points are lost',
  gift_cards_unlinked: (n) => n + (n === 1 ? ' gift card is' : ' gift cards are') + ' unlinked and keeps its balance',
  time_entries: (n) => n + (n === 1 ? ' time entry is' : ' time entries are') + ' deleted with them',
  lines: (n) => n + (n === 1 ? ' line is' : ' lines are') + ' cleared with it',
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
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = NOUNS[collection] ?? 'record';

  const ask = async (): Promise<void> => {
    setLoading(true);
    try {
      setPreview(await api.deletePreview(collection, id));
    } catch {
      // Shown by the transport.
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.delete(collection, id);
      setPreview(null);
      toast.success('Deleted ' + name);
      onDeleted?.();
    } catch (err) {
      if (isCancelled(err)) setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const blocked = preview !== null && preview.blocked !== '';
  const effects: string[] = [];
  if (preview !== null) {
    for (const [k, v] of Object.entries(preview.affects)) {
      if (typeof v === 'number' && v > 0 && AFFECTS[k] !== undefined) effects.push(AFFECTS[k](v));
      if (k === 'default_rate' && v === true) effects.push('It is the default rate');
    }
  }

  return (
    <>
      {variant === 'icon' && <IconButton icon={Trash2} label={label ?? 'Delete ' + name} variant="danger" size={size} onClick={() => void ask()} disabled={loading} className={className} />}
      {variant === 'button' && (
        <Button variant="danger" icon={Trash2} loading={loading} onClick={() => void ask()} className={className}>
          {label ?? 'Delete'}
        </Button>
      )}
      {variant === 'menu' && (
        <button type="button" onClick={() => void ask()} className={cn('flex h-7 w-full items-center gap-2 rounded-[var(--ps-r-sm)] px-2 text-left text-[13px] font-medium text-[var(--ps-red-text)] hover:bg-[var(--ps-red)]/10', className)}>
          <Trash2 size={14} aria-hidden />
          {label ?? 'Delete'}
        </button>
      )}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={blocked ? 'This ' + noun + ' cannot be deleted' : 'Delete ' + name + '?'}
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
        {blocked ? (
          <p className="text-[13px] text-[var(--ps-ink-2)]">{preview?.blocked}</p>
        ) : (
          <div className="text-[13px] text-[var(--ps-ink-2)]">
            <p>This cannot be undone.</p>
            {effects.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {effects.map((e) => (
                  <li key={e}>{e}.</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * The two decisions on a candidate, one click each, shown at once
 * (optimistic), with Undo in the toast (activity.undo of the change).
 */
import { op } from '../../lib/api.ts';
import { act, drop } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';

const READS = ['signals', 'theses', 'radars', 'intake_items', 'companies'];

function undoable(text: string, entry: string | undefined): void {
  if (entry === undefined || entry === '') return;
  toast.undo(text, () => void act([], () => op('activity.undo', { entry }), READS));
}

/** Add candidates to the Inbox (each becomes a sourced intake item). */
export async function addToInbox(ids: string[], extraDrops: string[] = []): Promise<boolean> {
  const out = await act(
    [...ids, ...extraDrops].map((id) => drop(id)),
    () => op<{ added: number; _activity?: string }>('signals.to-inbox', { signals: ids }),
    READS,
  );
  if (out === null) return false;
  undoable(out.added === 1 ? 'Added to Inbox' : `${out.added} added to Inbox`, out._activity);
  return true;
}

/** Dismiss candidates (an optional reason chip). */
export async function dismiss(ids: string[], reason?: string, extraDrops: string[] = []): Promise<boolean> {
  const out = await act(
    [...ids, ...extraDrops].map((id) => drop(id)),
    () => op<{ dismissed: number; _activity?: string }>('signals.dismiss', reason !== undefined ? { signals: ids, reason } : { signals: ids }),
    READS,
  );
  if (out === null) return false;
  undoable(out.dismissed === 1 ? 'Dismissed' : `${out.dismissed} dismissed`, out._activity);
  return true;
}

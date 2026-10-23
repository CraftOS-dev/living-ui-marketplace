/**
 * Apply what is left of a payment (or a credit) to open invoices or bills:
 * the open documents oldest first, prefilled with what is left, each
 * amount editable.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber } from '../../lib/format.ts';
import type { OpenDoc } from '../../lib/types/money.ts';
import { Modal, Notice, PillButton, cellInput } from '../ui.tsx';
import { toMinor } from './RecordPayment.tsx';

export function ApplyCredit({
  open,
  onClose,
  payment,
  available,
  currency,
  docs,
  docWord,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  payment: string;
  available: number;
  currency: string;
  docs: OpenDoc[];
  docWord: string;
  onDone: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<Record<string, { on: boolean; text: string }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let rest = available;
    const next: Record<string, { on: boolean; text: string }> = {};
    for (const d of docs) {
      const take = Math.min(rest, d.balance);
      next[d.id] = { on: take > 0, text: minorToText(take > 0 ? take : d.balance, currency) };
      rest -= Math.max(0, take);
    }
    setRows(next);
  }, [open, docs, available, currency]);

  const chosen = docs.filter((d) => rows[d.id]?.on === true);
  const total = chosen.reduce((s, d) => s + (toMinor(rows[d.id]?.text ?? '', currency) ?? 0), 0);
  const bad = chosen.some((d) => {
    const v = toMinor(rows[d.id]?.text ?? '', currency);
    return v === null || v <= 0 || v > d.balance;
  });
  const over = total > available;

  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('payments.apply', { payment, allocations: chosen.map((d) => ({ doc: d.number, amount: normalizeNumber(rows[d.id]?.text ?? '', decimalsOf(currency)) ?? '' })) });
      toast.success(`Applied ${money(total, currency)}`);
      onDone();
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Apply to ${docWord}s`}
      description={`${money(available, currency)} is not applied yet. Choose what it settles.`}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={chosen.length === 0 || bad || over} onClick={() => void apply()}>
            {total > 0 ? `Apply ${money(total, currency)}` : 'Apply'}
          </PillButton>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {docs.map((d) => {
          const r = rows[d.id];
          const on = r?.on === true;
          const v = on ? toMinor(r.text, currency) : null;
          const wrong = on && (v === null || v <= 0 || v > d.balance);
          return (
            <li key={d.id} className={cn('flex items-center gap-3 rounded-[18px] px-3 py-2.5', on ? 'bg-[var(--erp-accent-soft)]' : 'bg-[var(--erp-row)]')}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Apply to ${d.number}`}
                onClick={() => setRows({ ...rows, [d.id]: { on: !on, text: r?.text ?? minorToText(d.balance, currency) } })}
                className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)]')}
              >
                {on && <Check size={14} strokeWidth={3} />}
              </button>
              <span className="min-w-0 flex-1">
                <span className="num block truncate text-[14px] font-bold">{d.number}</span>
                <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                  {d.due_date !== '' ? `Due ${dayLabel(d.due_date)}` : dayLabel(d.date)} · {money(d.balance, currency)} open
                </span>
              </span>
              <input
                value={r?.text ?? ''}
                onChange={(e) => setRows({ ...rows, [d.id]: { on: true, text: e.target.value } })}
                inputMode="decimal"
                aria-label={`Amount for ${d.number}`}
                aria-invalid={wrong}
                className={cn(cellInput, 'num w-28 shrink-0 bg-[var(--erp-card)] text-right', wrong && 'ring-2 ring-[var(--erp-red)]')}
              />
            </li>
          );
        })}
      </ul>
      {over && (
        <div className="mt-3">
          <Notice tone="bad">That is {money(total - available, currency)} more than is left to apply.</Notice>
        </div>
      )}
    </Modal>
  );
}

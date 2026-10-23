/**
 * Cash in or out of the drawer outside a sale: paid in (a float top-up),
 * paid out (milk from the shop next door), or dropped to the safe. Each has
 * an amount and a reason, and counts in the expected cash at close. A
 * cashier needs a manager's approval (asked here, with their PIN).
 */
import { useCallback, useState } from 'react';
import { toast } from '../../kit/index.ts';
import { Cancelled, OpError, api, withApproval } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { money } from '../lib/format.ts';
import { Keypad, pressAmount } from './Keypad.tsx';
import type { KeypadKey } from './Keypad.tsx';
import { Button, Modal, Segmented, pillInput } from './ui.tsx';

type Kind = 'pay_in' | 'pay_out' | 'drop';

const QUICK: Record<Kind, string[]> = {
  pay_in: ['Float top-up', 'Change from the bank'],
  pay_out: ['Supplies', 'Delivery', 'Tip payout'],
  drop: ['Safe drop', 'Bank deposit'],
};

export function CashMoveDialog({ register, onClose }: { register: string; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [kind, setKind] = useState<Kind>('pay_out');
  const [amountMinor, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onKey = useCallback((k: KeypadKey): void => setAmount((v) => pressAmount(v, k)), []);
  const save = async (): Promise<void> => {
    if (amountMinor <= 0 || reason.trim() === '') return;
    setBusy(true);
    setError('');
    try {
      await withApproval((approvals) => api.cashMove({ register, kind, amount: (amountMinor / 10 ** exp).toFixed(exp), reason: reason.trim(), approval: approvals[0] ?? '' }), 'Cash in or out');
      toast.success(kind === 'pay_in' ? 'Paid in' : kind === 'pay_out' ? 'Paid out' : 'Dropped to the safe');
      onClose();
    } catch (err) {
      if (!(err instanceof Cancelled)) setError(err instanceof OpError ? err.message : 'Could not record it');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Cash in or out"
      wide
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={amountMinor <= 0 || reason.trim() === ''} loading={busy} onClick={() => void save()}>
            {kind === 'pay_in' ? 'Pay in' : kind === 'pay_out' ? 'Pay out' : 'Drop to the safe'} {money(amountMinor, currency, exp)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex flex-1 flex-col gap-3">
          <Segmented
            label="Kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'pay_in', label: 'Pay in' },
              { value: 'pay_out', label: 'Pay out' },
              { value: 'drop', label: 'Safe drop' },
            ]}
          />
          <div className="ps-on-dark flex items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-dark)] px-5 py-5 text-[var(--ps-on-dark)]">
            <span className="text-[12px] font-semibold text-[var(--ps-muted)]">Type or tap the keys</span>
            <span className="flex items-center gap-2">
              <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{money(amountMinor, currency, exp)}</span>
              <span aria-hidden className="ps-caret h-7 w-[3px] rounded-full bg-[var(--ps-accent)]" />
            </span>
          </div>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" className={pillInput} />
          <div className="flex flex-wrap gap-2">
            {QUICK[kind].map((q) => (
              <button key={q} type="button" onClick={() => setReason(q)} className="ps-press h-10 rounded-full bg-[var(--ps-card)] px-4 text-[13px] font-semibold hover:bg-[var(--ps-row)]">
                {q}
              </button>
            ))}
          </div>
          {error !== '' && (
            <p className="px-1 text-[12px] font-semibold text-[var(--ps-red-text)]" role="alert">
              {error}
            </p>
          )}
        </div>
        <Keypad onKey={onKey} extra="00" size="md" tone="card" className="sm:w-[260px]" onEnter={() => void save()} />
      </div>
    </Modal>
  );
}

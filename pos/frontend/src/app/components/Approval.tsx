/**
 * Manager approval, in place: when the person at the counter may not do
 * something on their own (a bigger discount, a refund, a price change, a
 * void, cash in or out), a manager picks their tile and types their PIN on
 * the same screen. One PIN approves everything the action needs; the
 * approval is single use and recorded with the manager's name.
 *
 * Any operation answering approval_required goes through here (lib/api.ts
 * withApproval), so the rule lives on the server and this is only the door.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { OpError, api, setApprovalHandler } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_LABEL } from '../lib/format.ts';
import type { Approvable, Staff } from '../lib/types.ts';
import { Keypad } from './Keypad.tsx';
import type { KeypadKey } from './Keypad.tsx';
import { Avatar, Button, Modal } from './ui.tsx';

export const APPROVAL_LABEL: Record<Approvable, string> = {
  discount_over: 'A discount over the cashier limit',
  price_override: 'A changed price',
  refund: 'A refund',
  refund_blind: 'A refund without a receipt',
  void_ticket: 'Voiding a ticket',
  cash_move: 'Cash in or out of the drawer',
};

interface Request {
  actions: Approvable[];
  why: string;
  resolve: (tokens: string[] | null) => void;
}

function ApprovalDialog({ req, onDone }: { req: Request; onDone: (tokens: string[] | null) => void }): React.JSX.Element {
  const { staff } = useApp();
  const approvers = staff.filter((s) => s.active && s.pin_set && req.actions.every((a) => s.permissions.includes(a)));
  const [who, setWho] = useState<Staff | null>(approvers.length === 1 ? (approvers[0] ?? null) : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string): Promise<void> => {
      if (who === null || value.length < 4 || busy) return;
      setBusy(true);
      setError('');
      try {
        const tokens: string[] = [];
        for (const action of req.actions) {
          const res = await api.approve(who.id, value, action, req.why.slice(0, 80));
          tokens.push(res.approval);
        }
        onDone(tokens);
      } catch (err) {
        setError(err instanceof OpError ? err.message : 'Could not approve');
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [who, busy, req, onDone],
  );

  const onKey = useCallback(
    (k: KeypadKey): void => {
      if (busy || who === null) return;
      setError('');
      if (k === 'back') setPin(pin.slice(0, -1));
      else if (k !== '.' && k !== '00' && pin.length < 6) {
        const next = pin + k;
        setPin(next);
        if (next.length === 6) void submit(next);
      }
    },
    [busy, who, pin, submit],
  );

  return (
    <Modal open onClose={() => onDone(null)} title="A manager needs to approve this" description={req.actions.map((a) => APPROVAL_LABEL[a]).join(', ')}>
      {approvers.length === 0 ? (
        <p className="rounded-[22px] bg-[var(--ps-card)] p-4 text-[14px] text-[var(--ps-ink-2)]">Nobody who can approve this has a PIN yet. The owner can add a manager in Settings, Staff.</p>
      ) : who === null ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {approvers.map((s) => (
            <button key={s.id} type="button" onClick={() => setWho(s)} className="ps-press flex flex-col items-center gap-2 rounded-[20px] bg-[var(--ps-card)] px-2 py-4 hover:bg-[var(--ps-row)]">
              <Avatar name={s.name} color={s.color} size={48} />
              <span className="max-w-full truncate text-[14px] font-bold">{s.name}</span>
              <span className="text-[12px] text-[var(--ps-muted)]">{ROLE_LABEL[s.role]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-auto flex max-w-[320px] flex-col gap-3">
          <button type="button" onClick={() => approvers.length > 1 && setWho(null)} className={cn('flex items-center gap-3 rounded-full bg-[var(--ps-card)] py-1.5 pl-1.5 pr-4 text-left', approvers.length > 1 && 'hover:bg-[var(--ps-row)]')}>
            <Avatar name={who.name} color={who.color} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">{who.name}</span>
              <span className="block text-[12px] text-[var(--ps-muted)]">Type your PIN</span>
            </span>
            <ShieldCheck size={18} className="text-[var(--ps-ink-2)]" aria-hidden />
          </button>
          <div className="flex h-6 items-center justify-center gap-3" aria-label={`${pin.length} digits typed`}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={cn('size-3.5 rounded-full', i < pin.length ? 'bg-[var(--ps-ink)]' : 'bg-[var(--ps-track)]')} />
            ))}
          </div>
          <p className={cn('min-h-4 text-center text-[12px] font-semibold', error !== '' ? 'text-[var(--ps-red-text)]' : 'text-transparent')} role="alert">
            {error || ' '}
          </p>
          <Keypad onKey={onKey} onEnter={() => void submit(pin)} size="md" tone="card" />
          <Button variant="primary" size="lg" icon={ShieldCheck} dot disabled={pin.length < 4 || busy} loading={busy} onClick={() => void submit(pin)} className="w-full">
            Approve
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function ApprovalProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [req, setReq] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  useEffect(() => {
    setApprovalHandler(
      (actions, why) =>
        new Promise<string[] | null>((resolve) => {
          const r = { actions: [...new Set(actions)], why, resolve };
          pending.current = r;
          setReq(r);
        }),
    );
    return () => setApprovalHandler(null);
  }, []);
  return (
    <>
      {children}
      {req !== null && (
        <ApprovalDialog
          key={req.actions.join(',')}
          req={req}
          onDone={(tokens) => {
            req.resolve(tokens);
            pending.current = null;
            setReq(null);
          }}
        />
      )}
    </>
  );
}

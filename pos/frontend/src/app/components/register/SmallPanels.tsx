/**
 * The register's smaller surfaces: a custom amount on the keypad (Square's
 * "Amount"), opening the register with a counted float, and the open
 * tickets (open, release or void each).
 */
import { useCallback, useEffect, useState } from 'react';
import { Ban, Clock, Lock, Plus, Sparkles, Undo2, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { Cancelled, OpError, api, withApproval } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { denominations } from '../../lib/denominations.ts';
import { ORDER_TYPE_LABEL, ago, money, plural } from '../../lib/format.ts';
import type { Ticket } from '../../lib/types.ts';
import { Keypad, pressAmount } from '../Keypad.tsx';
import type { KeypadKey } from '../Keypad.tsx';
import { Badge, Button, Card, Empty, IconBadge, Modal, Select, Spinner, TextField, inputCls, useConfirm } from '../ui.tsx';

/* ------------------------------------------------------------ custom amount */

export function CustomAmount({ onAdd, onClose }: { onAdd: (name: string, price: number, taxClass: string) => void; onClose: () => void }): React.JSX.Element {
  const { taxes, currency, exp } = useApp();
  const live = taxes.filter((t) => !t.archived);
  const [value, setValue] = useState(0);
  const [name, setName] = useState('');
  const [tax, setTax] = useState(live.find((t) => t.is_default)?.id ?? live[0]?.id ?? '');
  const onKey = useCallback((k: KeypadKey): void => setValue((v) => pressAmount(v, k)), []);
  const add = (): void => {
    if (value <= 0) return;
    onAdd(name.trim(), value, tax);
    setValue(0);
    setName('');
  };
  return (
    <Modal open onClose={onClose} title="Amount" description="An amount without a product">
      <div className="flex flex-col gap-3">
        <div className="ps-on-dark flex items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-dark)] px-5 py-5 text-[var(--ps-on-dark)]">
          <span className="text-[12px] font-semibold text-[var(--ps-muted)]">Type or tap the keys</span>
          <span className="flex items-center gap-2">
            <span className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.01em]', value === 0 && 'text-[var(--ps-muted)]')}>{money(value, currency, exp)}</span>
            <span aria-hidden className="ps-caret h-7 w-[3px] rounded-full bg-[var(--ps-accent)]" />
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="What for (optional)" aria-label="What the amount is for" className={cn(inputCls, 'bg-[var(--ps-card)]')} />
          <Select ariaLabel="Tax class" value={tax} onChange={setTax} options={live.map((t) => ({ value: t.id, label: t.name }))} tone="card" />
        </div>
        <Keypad onKey={onKey} extra="00" onEnter={add} size="md" tone="card" />
        <Button variant="primary" size="lg" icon={Plus} dot disabled={value <= 0} onClick={add} className="w-full">
          Add {money(value, currency, exp)}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ open register */

export function OpenRegister({ register, name, onOpened }: { register: string; name: string; onOpened: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const notes = denominations(currency, exp);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const total = notes.reduce((s, d) => s + d * (counts[String(d)] ?? 0), 0);
  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.openShift(register, counts);
      toast.success(`${name} is open`);
      onOpened();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
      <Card delay={1}>
        <div className="mb-5 flex items-center gap-3">
          <IconBadge icon={Lock} size={48} />
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold">{name} is closed</h2>
            <p className="text-[13px] text-[var(--ps-muted)]">Float in the drawer</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {notes.map((d) => (
            <label key={d} className="flex items-center justify-between gap-3 rounded-full bg-[var(--ps-row)] py-1 pl-5 pr-1">
              <span className="num text-[14px] font-semibold">{money(d, currency, exp)}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={counts[String(d)] ?? ''}
                placeholder="0"
                onChange={(e) => {
                  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setCounts({ ...counts, [String(d)]: n });
                }}
                className="num h-10 w-20 rounded-full bg-[var(--ps-card)] px-4 text-right text-[14px] font-semibold text-[var(--ps-ink)] outline-none ring-[var(--ps-ink)] focus-visible:ring-2"
              />
            </label>
          ))}
        </div>
      </Card>
      <Card tone="dark" delay={2} className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-bold">Float</span>
          <span className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.01em]', total === 0 && 'text-[var(--ps-muted)]')}>{money(total, currency, exp)}</span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void open()}
          className="ps-press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[var(--ps-accent-fill)] px-5 text-[15px] font-bold text-[var(--ps-on-accent)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Spinner size={16} /> : <Wallet size={18} aria-hidden />}
          Open {name}
        </button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ tickets */

const VOID_REASONS = ['Customer left', 'Entered by mistake', 'Duplicate ticket'];

/** Void a ticket with a reason; a cashier needs a manager's approval (asked here, with their PIN). */
function VoidTicket({ ticket, onVoided, onClose }: { ticket: Ticket; onVoided: () => void; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = ticket.name !== '' ? ticket.name : 'Ticket';
  const save = async (): Promise<void> => {
    if (reason.trim() === '' || busy) return;
    setBusy(true);
    setError('');
    try {
      await withApproval((approvals) => api.voidTicket(ticket.ref, reason.trim(), approvals[0] ?? ''), `Void ${label}`);
      toast.success(`Voided ${label}`);
      onVoided();
    } catch (err) {
      if (!(err instanceof Cancelled)) setError(err instanceof OpError ? err.message : 'Could not void it');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Void ${label}?`}
      description={`${money(ticket.total, currency, exp)} · ${plural(ticket.items, 'item')}. It is cancelled, and the reason goes in the audit trail.`}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={reason.trim() === ''} loading={busy} onClick={() => void save()}>
            Void ticket
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Reason" value={reason} onChange={setReason} autoFocus maxLength={200} placeholder="Why it is voided" onEnter={() => void save()} tone="card" />
        <div className="flex flex-wrap gap-2">
          {VOID_REASONS.map((q) => (
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
    </Modal>
  );
}

/**
 * The open tickets. Each opens on this register; one open on a register can
 * be released (back to waiting, as last saved), and any can be voided.
 * `onChanged` hears of a release or void, so the register can clear its sale
 * when the ticket was the one open here.
 */
export function TicketsDialog({ current, onOpen, onChanged, onClose }: { current: string; onOpen: (t: Ticket) => void; onChanged: (t: Ticket) => void; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [voiding, setVoiding] = useState<Ticket | null>(null);
  const [releasing, setReleasing] = useState('');
  const [round, setRound] = useState(0);
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => {
    let live = true;
    api
      .tickets('open')
      .then((r) => {
        if (live) setTickets(r.tickets);
      })
      .catch(() => {
        if (live) setTickets([]);
      });
    return () => {
      live = false;
    };
  }, [round]);
  const release = async (t: Ticket): Promise<void> => {
    const label = t.name !== '' ? t.name : 'this ticket';
    const ok = await confirm(
      t.ref === current
        ? 'It goes back to the open tickets as it was last saved. Changes made since you opened it are not kept.'
        : `It is open on ${t.register_code || 'another register'}. It goes back to the open tickets as it was last saved, so any register can open it.`,
      `Release ${label}?`,
      'Release',
    );
    if (!ok) return;
    setReleasing(t.id);
    try {
      await api.release(t.ref);
      toast.success(`Released ${label}`);
      onChanged(t);
      setRound((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof OpError ? err.message : 'Could not release it');
    } finally {
      setReleasing('');
    }
  };
  const now = Date.now();
  return (
    <Modal open onClose={onClose} title="Open tickets" description="Saved sales waiting to be paid" xl>
      {tickets === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-[22px] bg-[var(--ps-card)]">
          <Empty icon={Clock} title="No open tickets" compact>
            Save a sale to finish it later.
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((t) => {
            const mine = t.ref === current;
            return (
              <div key={t.id} className={cn('ps-on-card flex flex-col rounded-[22px] bg-[var(--ps-card)]', !mine && 'hover:bg-[var(--ps-row)]', mine && 'ring-2 ring-[var(--ps-ink)]')}>
                <button type="button" disabled={mine} onClick={() => onOpen(t)} className="ps-press flex flex-1 flex-col gap-2 rounded-[22px] p-4 pb-3 text-left disabled:cursor-default">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[15px] font-bold">{t.name || 'Ticket'}</span>
                    <span className="num text-[14px] font-bold">{money(t.total, currency, exp)}</span>
                  </span>
                  <span className="line-clamp-2 text-[13px] text-[var(--ps-ink-2)]">{t.lines.map((l) => `${l.qty} ${l.label}`).join(', ')}</span>
                  {t.source === 'agent' && (
                    <Badge tone="agent" className="self-start">
                      <Sparkles size={13} aria-hidden /> From your AI agent
                    </Badge>
                  )}
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--ps-muted)]">
                    {t.order_type !== '' && <span>{ORDER_TYPE_LABEL[t.order_type]}</span>}
                    <span>{ago(t.updated, now)} ago</span>
                    {t.staff_name !== '' && <span>· {t.staff_name}</span>}
                    {t.status === 'resumed' && <span className="font-semibold text-[var(--ps-amber-text)]">· {mine ? 'open here' : `open on ${t.register_code || 'a register'}`}</span>}
                  </span>
                  {t.note !== '' && <span className="truncate text-[12px] italic text-[var(--ps-ink-2)]">{t.note}</span>}
                </button>
                <span className="flex flex-wrap gap-2 px-4 pb-4">
                  {t.status === 'resumed' && (
                    <Button size="sm" icon={Undo2} loading={releasing === t.id} onClick={() => void release(t)}>
                      Release
                    </Button>
                  )}
                  <Button size="sm" variant="danger" icon={Ban} onClick={() => setVoiding(t)}>
                    Void
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {voiding !== null && (
        <VoidTicket
          ticket={voiding}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            onChanged(voiding);
            setVoiding(null);
            setRound((n) => n + 1);
          }}
        />
      )}
      {confirmEl}
    </Modal>
  );
}

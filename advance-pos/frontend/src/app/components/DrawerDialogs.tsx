/**
 * The cash drawer: opening it with a counted float, paying cash in or out,
 * opening it without a sale, and closing it with a count. Counting is by
 * note and coin (or a total), the way a drawer is actually counted; the
 * close shows what the drawer should hold against what was counted, and
 * the Z report can be printed. With the review turned on, your AI agent is
 * asked to look the session over when it closes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Printer, Vault } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { plain, toMinor } from '../lib/format.ts';
import type { Money } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { printHtml, zReportHtml } from '../lib/print.ts';
import type { Shift } from '../lib/types.ts';
import { MoneyField } from './common.tsx';
import { Button, Field, Modal, Segmented, Stat, inputCls } from './ui.tsx';

/** Counting the drawer: a stepper per note and coin, or one total. */
function Counter({ counts, setCounts, total, setTotal, mode, setMode }: { counts: Record<string, number>; setCounts: (c: Record<string, number>) => void; total: string; setTotal: (t: string) => void; mode: 'count' | 'total'; setMode: (m: 'count' | 'total') => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const denoms = [...(settings?.denominations ?? [])].sort((a, b) => b - a);
  const sum = denoms.reduce((a, d) => a + d * (counts[String(d)] ?? 0), 0);
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label="How to count"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'count', label: 'Count notes and coins' },
          { value: 'total', label: 'Enter the total' },
        ]}
        className="self-start"
      />
      {mode === 'count' ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {denoms.map((d) => {
              const n = counts[String(d)] ?? 0;
              return (
                <label key={d} className="flex items-center justify-between gap-2 rounded-[var(--ps-r)] bg-[var(--ps-row)] py-1 pl-2.5 pr-1">
                  <span className="num text-[13px] font-semibold">{money.fmt(d)}</span>
                  <input
                    aria-label={'How many ' + money.fmt(d)}
                    className={cn(inputCls, 'num h-8 w-16 text-right')}
                    inputMode="numeric"
                    value={n === 0 ? '' : String(n)}
                    placeholder="0"
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/\D/g, '') || '0');
                      setCounts({ ...counts, [String(d)]: Math.min(v, 100000) });
                    }}
                  />
                </label>
              );
            })}
          </div>
          <div className="flex items-baseline justify-between border-t border-[var(--ps-hair)] pt-2">
            <span className="text-[13px] font-semibold text-[var(--ps-ink-2)]">Counted</span>
            <span className="num text-[26px] font-bold">{money.fmt(sum)}</span>
          </div>
        </>
      ) : (
        <MoneyField value={total} onChange={setTotal} money={money} label="Cash in the drawer" className="w-48 [&_input]:h-10 [&_input]:text-[15px]" autoFocus />
      )}
    </div>
  );
}

function useCount(): { counts: Record<string, number>; setCounts: (c: Record<string, number>) => void; total: string; setTotal: (t: string) => void; mode: 'count' | 'total'; setMode: (m: 'count' | 'total') => void; value: number | null; reset: () => void } {
  const { money, settings } = useStore();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState('');
  const [mode, setMode] = useState<'count' | 'total'>('count');
  const denoms = settings?.denominations ?? [];
  const value = mode === 'count' ? denoms.reduce((a, d) => a + d * (counts[String(d)] ?? 0), 0) : total.trim() === '' ? null : toMinor(total, money.digits);
  return {
    counts,
    setCounts,
    total,
    setTotal,
    mode,
    setMode,
    value,
    reset: () => {
      setCounts({});
      setTotal('');
    },
  };
}

function cleanCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) if (v > 0) out[k] = v;
  return out;
}

export function OpenDrawerDialog({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened?: (s: Shift) => void }): React.JSX.Element {
  const { money } = useStore();
  const c = useCount();
  const [busy, setBusy] = useState(false);
  const cur = useLive(() => (open ? api.currentShift() : Promise.resolve(null)), ['shifts'], [open]);
  useEffect(() => {
    if (open) c.reset();
  }, [open]);
  const last = cur.data?.last_closed ?? null;
  const go = async (): Promise<void> => {
    if (c.value === null || c.value < 0) return;
    setBusy(true);
    try {
      const r = await api.openShift(c.mode === 'count' ? { counts: cleanCounts(c.counts) } : { float: plain(c.value, money.digits) });
      toast.success('Drawer open with ' + money.fmt(c.value));
      onOpened?.(r.shift);
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title={'Open the drawer' + (cur.data !== null && cur.data !== undefined ? ' on ' + cur.data.register.name : '')}
      description={last !== null ? 'Last closed with ' + money.fmt(last.counted) + ' in it' : 'Count the cash you start with (the float)'}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Vault} loading={busy} disabled={c.value === null || c.value < 0} onClick={() => void go()}>
            Open with {money.fmt(c.value ?? 0)}
          </Button>
        </>
      }
    >
      <Counter {...c} />
    </Modal>
  );
}

export function CashMoveDialog({ kind, onClose }: { kind: 'pay_in' | 'pay_out' | 'no_sale' | null; onClose: () => void }): React.JSX.Element {
  const { money } = useStore();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAmount('');
    setReason('');
  }, [kind]);
  const minor = toMinor(amount, money.digits);
  const ok = kind === 'no_sale' || (minor !== null && minor > 0 && reason.trim() !== '');
  const go = async (): Promise<void> => {
    if (kind === null || !ok) return;
    setBusy(true);
    try {
      await api.cash(kind, kind === 'no_sale' ? undefined : plain(minor ?? 0, money.digits), reason.trim() || undefined);
      toast.success(kind === 'no_sale' ? 'Drawer opened' : (kind === 'pay_in' ? 'Paid in ' : 'Paid out ') + money.fmt(minor ?? 0));
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  const title = kind === 'pay_in' ? 'Pay cash in' : kind === 'pay_out' ? 'Pay cash out' : 'Open the drawer';
  return (
    <Modal touch
      open={kind !== null}
      onClose={onClose}
      title={title}
      description={kind === 'no_sale' ? 'For change or a check, without a sale. It is recorded.' : kind === 'pay_out' ? 'Cash taken out for a purchase or a bank drop.' : 'Cash added, such as more change.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Vault} loading={busy} disabled={!ok} onClick={() => void go()}>
            {kind === 'no_sale' ? 'Open the drawer' : title}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {kind !== 'no_sale' && (
          <Field label="Amount">
            <MoneyField value={amount} onChange={setAmount} money={money} label="Amount" autoFocus className="w-40 [&_input]:h-9" />
          </Field>
        )}
        <Field label={kind === 'no_sale' ? 'Reason (optional)' : 'What it is for'}>
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus={kind === 'no_sale'} placeholder={kind === 'pay_out' ? 'Milk from the shop next door' : kind === 'pay_in' ? 'Change from the bank' : 'Change for a customer'} />
        </Field>
      </form>
    </Modal>
  );
}

export function CloseDrawerDialog({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed?: (s: Shift) => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const c = useCount();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);
  const cur = useLive(() => (open ? api.currentShift() : Promise.resolve(null)), ['shifts', 'payments', 'cash_moves'], [open]);
  useEffect(() => {
    if (open) {
      c.reset();
      setNote('');
      setClosed(null);
    }
  }, [open]);
  const shift = cur.data?.shift ?? null;
  const expected = shift?.report?.cash.expected ?? 0;
  const diff = c.value === null ? null : c.value - expected;

  const go = async (): Promise<void> => {
    if (c.value === null || c.value < 0) return;
    setBusy(true);
    try {
      const r = await api.closeShift(c.mode === 'count' ? { counts: cleanCounts(c.counts), note: note.trim() || undefined } : { counted: plain(c.value, money.digits), note: note.trim() || undefined });
      setClosed(r.shift);
      onClosed?.(r.shift);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  if (closed !== null) {
    return (
      <Modal touch
        open={open}
        onClose={onClose}
        title="Drawer closed"
        description={closed.register.name + ', session ' + closed.number}
        footer={
          <>
            <Button icon={Printer} onClick={() => void printHtml(zReportHtml(closed, money, settings?.business_name ?? ''))}>
              Print the report
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <ShiftSummary shift={closed} money={money} />
        {settings?.auto_shift_review === true && <p className="mt-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 text-[12px] text-[var(--ps-ink-2)]">Your AI agent was asked to review this session; its findings arrive in Requests.</p>}
      </Modal>
    );
  }

  return (
    <Modal touch
      open={open}
      onClose={onClose}
      title={'Close the drawer' + (cur.data ? ' on ' + cur.data.register.name : '')}
      description={shift === null ? 'The drawer is not open' : 'Count the cash in the drawer'}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Vault} loading={busy} disabled={shift === null || c.value === null || c.value < 0} onClick={() => void go()}>
            Close the drawer
          </Button>
        </>
      }
    >
      {shift !== null && (
        <div className="flex flex-col gap-4">
          <Counter {...c} />
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-2">
              <p className="text-[12px] text-[var(--ps-muted)]">Should be</p>
              <p className="num text-[15px] font-bold">{money.fmt(expected)}</p>
            </div>
            <div className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-2">
              <p className="text-[12px] text-[var(--ps-muted)]">Counted</p>
              <p className="num text-[15px] font-bold">{c.value === null ? 'Not yet' : money.fmt(c.value)}</p>
            </div>
            <div className={cn('rounded-[var(--ps-r-md)] px-3 py-2', diff === null || diff === 0 ? 'bg-[var(--ps-row)]' : diff < 0 ? 'bg-[var(--ps-red)]/12' : 'bg-[var(--ps-amber)]/20')}>
              <p className="text-[12px] text-[var(--ps-muted)]">{diff === null ? 'Difference' : diff === 0 ? 'Even' : diff < 0 ? 'Short' : 'Over'}</p>
              <p className={cn('num text-[15px] font-bold', diff !== null && diff < 0 && 'text-[var(--ps-red-text)]', diff !== null && diff > 0 && 'text-[var(--ps-amber-text)]')}>{diff === null ? 'Not yet' : money.fmt(Math.abs(diff))}</p>
            </div>
          </div>
          <Field label="Note (optional)">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Anything the next person or the owner should know" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** A drawer session's numbers: sales, cash in and out, expected and counted. */
export function ShiftSummary({ shift, money }: { shift: Shift; money: Money }): React.JSX.Element {
  const r = shift.report;
  const rows = useMemo(() => {
    if (r === undefined) return [];
    return [
      ['Opening float', r.cash.opening_float],
      ['Cash sales', r.cash.cash_sales],
      ['Cash refunds', -r.cash.cash_refunds],
      ['Paid in', r.cash.pay_ins],
      ['Paid out', -r.cash.pay_outs],
    ] as [string, number][];
  }, [r]);
  if (r === undefined) return <></>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section>
        <h3 className="mb-1 text-[12px] font-bold text-[var(--ps-ink-2)]">Cash</h3>
        {rows.map(([k, v]) => (
          <Stat key={k} label={k} value={money.fmt(v)} />
        ))}
        <div className="mt-1 border-t border-[var(--ps-hair)] pt-1">
          <Stat label="Should be in the drawer" value={money.fmt(r.cash.expected)} />
          {shift.status === 'closed' && <Stat label="Counted" value={money.fmt(shift.counted)} />}
          {shift.status === 'closed' && <Stat label={shift.difference === 0 ? 'Even' : shift.difference < 0 ? 'Short' : 'Over'} value={<span className={cn(shift.difference < 0 && 'text-[var(--ps-red-text)]', shift.difference > 0 && 'text-[var(--ps-amber-text)]')}>{money.fmt(Math.abs(shift.difference))}</span>} />}
          {r.cash.no_sales > 0 && <Stat label="Drawer opened without a sale" value={r.cash.no_sales + (r.cash.no_sales === 1 ? ' time' : ' times')} />}
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-[12px] font-bold text-[var(--ps-ink-2)]">Sales</h3>
        <Stat label="Sales" value={r.summary.sales} />
        <Stat label="Net sales" value={money.fmt(r.summary.net_sales)} />
        {r.summary.discounts !== 0 && <Stat label="Discounts" value={money.fmt(-r.summary.discounts)} />}
        {r.summary.returns !== 0 && <Stat label="Returns" value={money.fmt(-r.summary.returns)} />}
        <Stat label="Tax" value={money.fmt(r.summary.tax)} />
        {r.summary.tips !== 0 && <Stat label="Tips" value={money.fmt(r.summary.tips)} />}
        <div className="mt-1 border-t border-[var(--ps-hair)] pt-1">
          {r.payments.map((p) => (
            <Stat key={p.tender + p.label} label={p.label + ' (' + p.count + ')'} value={money.fmt(p.amount)} />
          ))}
        </div>
        {(r.voids.sales > 0 || r.voids.payments > 0 || r.voids.lines > 0) && (
          <div className="mt-1 border-t border-[var(--ps-hair)] pt-1">
            <Stat label="Cleared sales, voided payments, removed lines" value={r.voids.sales + ', ' + r.voids.payments + ', ' + r.voids.lines} />
          </div>
        )}
      </section>
    </div>
  );
}

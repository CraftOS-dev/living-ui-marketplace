/**
 * Leave pieces: balance rings per leave type, the request form (type tiles,
 * dates, half day, the working days it counts and the balance after), and
 * a request row with its state and actions (cancel, approve, reject).
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, Check, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { addDays, today } from '../../lib/dates.ts';
import { qty } from '../../lib/format.ts';
import type { Balance, Balances, Holidays, LeaveList, LeaveRequest, LeaveTypes } from '../../lib/types/people.ts';
import { ProgressRing } from '../controls.tsx';
import { DateField } from '../pickers.tsx';
import { Field, Modal, Notice, PillButton, StatusPill, Toggle, softArea } from '../ui.tsx';
import { LEAVE_STATE, PersonAvatar, countWorkingDays, daysText, leaveIcon, rangeLabel, weekday } from './common.tsx';

/* ------------------------------------------------------------ balances */

/** One leave type: a ring of what is left (or what was taken, for types without a limit). */
export function BalanceRing({ b, dark = false, onClick }: { b: Balance; dark?: boolean | undefined; onClick?: (() => void) | undefined }): React.JSX.Element {
  const Icon = leaveIcon(b.type.icon);
  const total = b.entitled + b.carried;
  const share = b.limited && total > 0 ? Math.max(0, b.remaining) / total : 0;
  const tone = b.limited && b.remaining <= 0 ? 'red' : b.limited && total > 0 && share < 0.25 ? 'amber' : 'accent';
  const body = (
    <>
      {b.limited ? (
        <ProgressRing value={share} size={64} dark={dark} tone={tone}>
          <span className="text-[15px] font-extrabold">{qty(b.remaining)}</span>
        </ProgressRing>
      ) : (
        <span className={cn('flex size-16 shrink-0 items-center justify-center rounded-full', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-card)]')}>
          <Icon size={22} strokeWidth={1.8} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5 text-[14px] font-bold">
          {b.limited && <Icon size={14} aria-hidden className="shrink-0" />}
          <span className="truncate">{b.type.name}</span>
        </span>
        <span className={cn('block text-[12px]', dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>
          {b.limited ? `${qty(b.remaining)} of ${qty(total)} days left` : b.taken > 0 ? `${daysText(b.taken)} taken` : 'No yearly limit'}
        </span>
        {b.pending > 0 && <span className={cn('block text-[12px] font-semibold', dark ? 'text-[var(--erp-on-dark)]' : 'text-[var(--erp-amber-text)]')}>{daysText(b.pending)} waiting</span>}
      </span>
    </>
  );
  const cls = cn('flex min-w-0 items-center gap-3 rounded-[20px] p-3', dark ? 'bg-[var(--erp-dark-2)]/60' : 'bg-[var(--erp-row)]');
  if (onClick === undefined) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(cls, 'transition-transform active:scale-[0.98]', !dark && 'hover:bg-[var(--erp-row-hover)]')}>
      {body}
    </button>
  );
}

/* -------------------------------------------------------------- request */

/** The first working day from `from` that is not a holiday and not already booked. */
function nextFreeDay(from: string, wd: number[], holidays: Set<string>, booked: { from: string; to: string }[]): string {
  let d = from;
  for (let i = 0; i < 60; i++) {
    if (wd.includes(weekday(d)) && !holidays.has(d) && !booked.some((b) => b.from <= d && b.to >= d)) return d;
    d = addDays(d, 1);
  }
  return from;
}

/**
 * Request leave for yourself: pick the type, the days, and see what it
 * counts before sending. Types that need no approval are recorded at once.
 */
export function LeaveRequestModal({ open, onClose, onDone, initialType }: { open: boolean; onClose: () => void; onDone?: ((r: LeaveRequest) => void) | undefined; initialType?: string | undefined }): React.JSX.Element {
  const [types, setTypes] = useState<LeaveTypes | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [hol, setHol] = useState<Record<number, Holidays>>({});
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setLoadError(null);
    setReason('');
    setHalf(false);
    const year = Number(today().slice(0, 4));
    Promise.all([
      op<LeaveTypes>('leave.types', {}, { quiet: true }),
      op<Balances>('leave.balances', {}, { quiet: true }),
      op<Holidays>('leave.holidays', { year }, { quiet: true }),
      op<LeaveList>('leave.list', { scope: 'mine', from: today(), limit: 100 }, { quiet: true }),
    ])
      .then(([t, b, h, mine]) => {
        if (!live) return;
        setTypes(t);
        setBalances(b);
        setHol({ [year]: h });
        const first = initialType !== undefined && t.types.some((x) => x.id === initialType) ? initialType : (t.types[0]?.id ?? '');
        setType(first);
        const booked = mine.requests.filter((r) => r.status === 'submitted' || r.status === 'approved');
        const d = nextFreeDay(addDays(today(), 1), h.working_days, new Set(h.holidays.map((x) => x.date)), booked);
        setFrom(d);
        setTo(d);
      })
      .catch((e: unknown) => {
        if (live) setLoadError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [open, initialType]);

  // Holidays of every year the dates touch.
  useEffect(() => {
    if (!open || from === '') return;
    const years = new Set([Number(from.slice(0, 4)), Number((to || from).slice(0, 4))]);
    for (const y of years) {
      if (hol[y] !== undefined) continue;
      op<Holidays>('leave.holidays', { year: y }, { quiet: true })
        .then((h) => setHol((prev) => ({ ...prev, [y]: h })))
        .catch(() => undefined);
    }
  }, [open, from, to, hol]);

  const wd = Object.values(hol)[0]?.working_days ?? [1, 2, 3, 4, 5];
  const holidayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of Object.values(hol)) for (const x of h.holidays) m.set(x.date, x.name);
    return m;
  }, [hol]);
  const single = from !== '' && from === to;
  const count = countWorkingDays(from, to === '' ? from : to, half && single, holidayMap, wd);
  const bal = balances?.types.find((b) => b.type.id === type);
  const meta = types?.types.find((t) => t.id === type);
  const after = bal !== undefined && bal.limited ? bal.remaining - count.days : null;
  const over = after !== null && after < 0;

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<LeaveRequest>('leave.request', { type, from, to: to === '' ? from : to, half_day: half && single, reason: reason.trim() === '' ? undefined : reason.trim() }, { quiet: true });
      toast.success(r.status === 'approved' ? 'Leave recorded' : 'Sent for approval');
      onDone?.(r);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request leave"
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={CalendarCheck} dot loading={busy} disabled={type === '' || from === '' || count.days === 0 || over} onClick={() => void send()}>
            {meta !== undefined && !meta.needs_approval ? 'Record leave' : 'Send request'}
          </PillButton>
        </>
      }
    >
      {loadError !== null ? (
        <Notice tone="bad" icon={AlertTriangle}>
          {loadError}
        </Notice>
      ) : types === null ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="erp-skeleton block h-16 rounded-[18px]" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div role="radiogroup" aria-label="Type of leave" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            {types.types.map((t) => {
              const b = balances?.types.find((x) => x.type.id === t.id);
              const Icon = leaveIcon(t.icon);
              const on = t.id === type;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setType(t.id)}
                  className={cn('flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)] hover:bg-[var(--erp-row)]')}
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-row)]')}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{t.name}</span>
                    <span className={cn('block truncate text-[12px]', on ? 'font-semibold' : 'text-[var(--erp-muted)]')}>
                      {b === undefined ? '' : b.limited ? `${qty(b.remaining)} days left` : 'No yearly limit'}
                      {!t.paid ? ' · unpaid' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <Field label="First day">
              <DateField
                value={from}
                onChange={(d) => {
                  setFrom(d);
                  if (to === '' || to < d) setTo(d);
                }}
                ariaLabel="First day"
              />
            </Field>
            <Field label="Last day">
              <DateField value={to} onChange={setTo} ariaLabel="Last day" min={from} align="right" />
            </Field>
          </div>

          {single && (
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-card)] px-4 py-3">
              <span className="text-[14px] font-semibold">Half a day</span>
              <Toggle checked={half} onChange={setHalf} label="Half a day" />
            </div>
          )}

          <div className={cn('flex flex-wrap items-center gap-4 rounded-[20px] px-4 py-3', over ? 'bg-[var(--erp-red)]/12' : 'bg-[var(--erp-accent-soft)]')}>
            <div className="min-w-0 flex-1">
              <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{count.days === 0.5 ? '0.5' : qty(count.days)}</p>
              <p className="text-[13px] font-semibold">{count.days === 1 ? 'working day' : 'working days'}</p>
              {from !== '' && <p className="text-[12px] text-[var(--erp-ink-2)]">{rangeLabel(from, to === '' ? from : to)}</p>}
            </div>
            {after !== null && (
              <div className="text-right">
                <p className={cn('num text-[15px] font-bold', over && 'text-[var(--erp-red-text)]')}>{qty(after)}</p>
                <p className="text-[12px] text-[var(--erp-ink-2)]">{over ? 'days short' : 'days left after this'}</p>
              </div>
            )}
          </div>
          {count.skipped.length > 0 && (
            <p className="-mt-3 px-1 text-[12px] text-[var(--erp-muted)]">Not counted: {count.skipped.map((s) => s.name).join(', ')} (public holiday)</p>
          )}
          {from !== '' && count.days === 0 && <Notice tone="warn">No working days in these dates, so there is nothing to request.</Notice>}
          {over && <Notice tone="bad">That is more than the {qty(bal?.remaining ?? 0)} days left of {bal?.type.name}.</Notice>}

          <Field label="Reason" optional>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" className={cn(softArea, 'min-h-[64px]')} />
          </Field>
          {meta !== undefined && !meta.needs_approval && <p className="-mt-3 px-1 text-[12px] text-[var(--erp-muted)]">{meta.name} needs no approval: it is recorded straight away.</p>}
          {error !== null && (
            <Notice tone="bad" icon={AlertTriangle}>
              {error}
            </Notice>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ list rows */

/** A leave request as a row: who, what, when, state, and the actions the caller has. */
export function LeaveRow({ r, showPerson, onChanged }: { r: LeaveRequest; showPerson: boolean; onChanged?: (() => void) | undefined }): React.JSX.Element {
  const [mode, setMode] = useState<'idle' | 'reject' | 'cancel'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const st = LEAVE_STATE[r.status];
  const Icon = leaveIcon(r.type?.icon);

  const run = async (what: 'approve' | 'reject' | 'cancel'): Promise<void> => {
    setBusy(what);
    try {
      if (what === 'cancel') await op('leave.cancel', { request: r.id, note: note.trim() === '' ? undefined : note.trim() });
      else await op('leave.decide', { request: r.id, approve: what === 'approve', note: note.trim() === '' ? undefined : note.trim() });
      toast.success(what === 'approve' ? 'Approved' : what === 'reject' ? 'Rejected' : 'Cancelled');
      setMode('idle');
      setNote('');
      onChanged?.();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-[20px] bg-[var(--erp-row)] p-3 @min-[640px]:p-4">
      <div className="flex items-start gap-3">
        {showPerson ? (
          <PersonAvatar name={r.employee.name} photo={r.employee.photo} size={40} tone="card" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
            <Icon size={17} aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-bold">{showPerson ? r.employee.name : (r.type?.name ?? 'Leave')}</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--erp-ink-2)]">
            {showPerson && <span className="font-semibold">{r.type?.name ?? 'Leave'} · </span>}
            {rangeLabel(r.from, r.to)} · <span className="num font-semibold">{r.half_day ? 'Half a day' : daysText(r.days)}</span>
          </p>
          {r.reason !== '' && <p className="mt-1 text-[13px] text-[var(--erp-muted)]">{r.reason}</p>}
          {r.decision_note !== '' && r.status !== 'submitted' && (
            <p className="mt-1 text-[12px] text-[var(--erp-muted)]">
              {r.decided_by !== '' ? `${r.decided_by}: ` : ''}
              {r.decision_note}
            </p>
          )}
        </div>
        {mode === 'idle' && (r.can.decide || r.can.cancel) && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {r.can.decide && (
              <>
                <PillButton size="sm" variant="light" icon={X} onClick={() => setMode('reject')} className="hidden @min-[480px]:inline-flex">
                  Reject
                </PillButton>
                <PillButton size="sm" icon={Check} loading={busy === 'approve'} onClick={() => void run('approve')}>
                  Approve
                </PillButton>
              </>
            )}
            {!r.can.decide && r.can.cancel && (
              <PillButton size="sm" variant="light" onClick={() => setMode('cancel')}>
                Cancel
              </PillButton>
            )}
          </div>
        )}
      </div>
      {mode === 'idle' && r.can.decide && (
        <div className="mt-2 flex justify-end @min-[480px]:hidden">
          <PillButton size="sm" variant="light" icon={X} onClick={() => setMode('reject')}>
            Reject
          </PillButton>
        </div>
      )}
      {mode !== 'idle' && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            aria-label="Note"
            placeholder={mode === 'reject' ? `Why not (${r.employee.name.split(' ')[0] ?? ''} reads this)` : 'Why (optional)'}
            className={cn(softArea, 'min-h-[56px] bg-[var(--erp-card)]')}
          />
          <div className="flex justify-end gap-2">
            <PillButton size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Keep it
            </PillButton>
            <PillButton size="sm" variant="danger" loading={busy !== null} onClick={() => void run(mode === 'reject' ? 'reject' : 'cancel')}>
              {mode === 'reject' ? 'Reject' : 'Cancel leave'}
            </PillButton>
          </div>
        </div>
      )}
    </li>
  );
}

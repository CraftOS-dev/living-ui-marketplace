/**
 * Leave: my balances and requests (Request leave opens the form, ?new=1
 * too), my team's requests to approve, a month calendar of who is away with
 * the holidays, and for HR the leave types, public holidays and balance
 * adjustments.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Inbox, Plus, Settings2, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { Chips, Tabs } from '../../components/controls.tsx';
import { LEAVE_ICONS, PersonAvatar, leaveIcon, rangeLabel, weekday } from '../../components/people/common.tsx';
import { BalanceRing, LeaveRequestModal, LeaveRow } from '../../components/people/Leave.tsx';
import { DateField, EmployeePicker, NumberInput } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { DataTable } from '../../components/table.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, LoadError, Modal, Notice, PageHeader, PillButton, PillSelect, Skeleton, StatusPill, ToggleRow, softInput, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addDays, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { plural, qty } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { Balances, CalendarEntry, Holidays, LeaveCalendar, LeaveIcon, LeaveList, LeaveStatus, LeaveType, LeaveTypes } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'mine' | 'team' | 'calendar' | 'settings';
const LEAVE_READS = ['leave_requests', 'leave_adjustments', 'leave_types', 'holidays'] as const;

/* ------------------------------------------------------------- my leave */

function MyLeave({ onRequest }: { onRequest: (type?: string) => void }): React.JSX.Element {
  const [status, setStatus] = useState<'all' | LeaveStatus>('all');
  const bal = useLive(() => op<Balances>('leave.balances', {}, { quiet: true }), [...LEAVE_READS], []);
  const list = useLive(() => op<LeaveList>('leave.list', { scope: 'mine', status: status === 'all' ? undefined : status, limit: 100 }, { quiet: true }), [...LEAVE_READS], [status]);
  const counts = list.data?.counts;
  const all = counts !== undefined ? counts.submitted + counts.approved + counts.rejected + counts.cancelled : undefined;
  return (
    <div className="flex flex-col gap-5">
      <Card tone="sand">
        <CardHeader title={`Your leave ${bal.data?.year ?? ''}`} subtitle="Days left this year" />
        {bal.error !== null && bal.data === null ? (
          <LoadError message={bal.error} onRetry={bal.reload} />
        ) : bal.data === null ? (
          <div className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-3">
            <Skeleton className="h-[88px]" />
            <Skeleton className="h-[88px]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-3">
            {bal.data.types.map((b) => (
              <BalanceRing key={b.type.id} b={b} onClick={() => onRequest(b.type.id)} />
            ))}
          </div>
        )}
      </Card>
      <Card delay={2}>
        <CardHeader title="Your requests" />
        {counts !== undefined && all !== undefined && all > 0 && (
          <Chips
            ariaLabel="Status"
            onCard
            className="mb-4"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: all },
              { value: 'submitted', label: 'Waiting', count: counts.submitted },
              { value: 'approved', label: 'Approved', count: counts.approved },
              { value: 'rejected', label: 'Rejected', count: counts.rejected },
              { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
            ]}
          />
        )}
        {list.error !== null && list.data === null ? (
          <LoadError message={list.error} onRetry={list.reload} />
        ) : list.data === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : list.data.requests.length === 0 ? (
          <Empty
            icon={CalendarDays}
            title={status === 'all' ? 'No leave requested yet' : 'None here'}
            action={
              status === 'all' ? (
                <PillButton icon={CalendarPlus} dot onClick={() => onRequest()}>
                  Request leave
                </PillButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.data.requests.map((r) => (
              <LeaveRow key={r.id} r={r} showPerson={false} onChanged={list.reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- team */

function TeamLeave({ scope }: { scope: 'team' | 'all' }): React.JSX.Element {
  const waiting = useLive(() => op<LeaveList>('leave.list', { scope, status: 'submitted', limit: 200 }, { quiet: true }), [...LEAVE_READS], [scope]);
  const recent = useLive(() => op<LeaveList>('leave.list', { scope, from: addDays(today(), -30), limit: 30 }, { quiet: true }), [...LEAVE_READS], [scope]);
  const decided = (recent.data?.requests ?? []).filter((r) => r.status !== 'submitted').slice(0, 12);
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card className="@min-[900px]:col-span-8">
        <CardHeader title="Waiting for a decision" subtitle={waiting.data !== null ? plural(waiting.data.total, 'request') : undefined} icon={Inbox} />
        {waiting.error !== null && waiting.data === null ? (
          <LoadError message={waiting.error} onRetry={waiting.reload} />
        ) : waiting.data === null ? (
          <Skeleton className="h-20" />
        ) : waiting.data.requests.length === 0 ? (
          <Empty icon={Inbox} title="Nothing waiting" compact>
            New requests from {scope === 'team' ? 'your team' : 'anyone'} show here.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {waiting.data.requests.map((r) => (
              <LeaveRow key={r.id} r={r} showPerson onChanged={waiting.reload} />
            ))}
          </ul>
        )}
      </Card>
      <Card className="@min-[900px]:col-span-4" delay={2}>
        <CardHeader title="Recently decided" />
        {recent.data === null ? (
          <Skeleton className="h-16" />
        ) : decided.length === 0 ? (
          <p className="text-[13px] text-[var(--erp-muted)]">Nothing in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
                <PersonAvatar name={r.employee.name} photo={r.employee.photo} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{r.employee.name}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                    {r.type?.name ?? 'Leave'} · {rangeLabel(r.from, r.to)}
                  </span>
                </span>
                <StatusPill size="sm" tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'neutral'}>
                  {r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Cancelled'}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- calendar */

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarTab({ month, setMonth }: { month: string; setMonth: (m: string) => void }): React.JSX.Element {
  const live = useLive(() => op<LeaveCalendar>('leave.calendar', { month }, { quiet: true }), [...LEAVE_READS], [month]);
  const t = today();
  const [picked, setPicked] = useState<string>(t.slice(0, 7) === month ? t : `${month}-01`);
  useEffect(() => setPicked(t.slice(0, 7) === month ? t : `${month}-01`), [month, t]);
  const c = live.data;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const count = new Date(y, m, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const lead = weekday(`${month}-01`) - 1;
  const wd = c?.working_days ?? [1, 2, 3, 4, 5];
  const hol = new Map((c?.holidays ?? []).map((h) => [h.date, h.name]));
  const awayOn = (d: string): CalendarEntry[] => (c?.entries ?? []).filter((e) => e.from <= d && e.to >= d && wd.includes(weekday(d)) && !hol.has(d));
  const pickedAway = awayOn(picked);

  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card className="@min-[900px]:col-span-8" padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 @min-[640px]:p-5">
          <div className="flex items-center gap-2">
            <CircleButton icon={ChevronLeft} label="Previous month" variant="row" size={36} onClick={() => setMonth(addMonthsLocal(month, -1))} />
            <h2 className="min-w-[9.5rem] text-center text-[15px] font-bold">{monthLabel(month)}</h2>
            <CircleButton icon={ChevronRight} label="Next month" variant="row" size={36} onClick={() => setMonth(addMonthsLocal(month, 1))} />
          </div>
          <div className="flex items-center gap-3 text-[12px] font-semibold text-[var(--erp-ink-2)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-full bg-[var(--erp-ink)]" /> Approved
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-full border-2 border-dashed border-[var(--erp-ink-2)]" /> Waiting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-full bg-[var(--erp-accent-soft)]" /> Holiday
            </span>
          </div>
        </div>
        {live.error !== null && c === null ? (
          <div className="p-5">
            <LoadError message={live.error} onRetry={live.reload} />
          </div>
        ) : (
          <div className="px-2 pb-3 @min-[640px]:px-4 @min-[640px]:pb-5">
            <div className="grid grid-cols-7 gap-1">
              {WEEK.map((w) => (
                <span key={w} className="py-1 text-center text-[12px] font-semibold text-[var(--erp-muted)]">
                  {w}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {days.map((d) => {
                const working = wd.includes(weekday(d));
                const h = hol.get(d);
                const away = awayOn(d);
                const on = d === picked;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPicked(d)}
                    aria-pressed={on}
                    aria-label={`${dayLabel(d)}: ${h !== undefined ? h : away.length > 0 ? plural(away.length, 'person', 'people') + ' away' : 'nobody away'}`}
                    className={cn(
                      'flex min-h-[56px] flex-col gap-1 rounded-[14px] p-1.5 text-left transition-colors @min-[640px]:min-h-[96px] @min-[640px]:p-2',
                      h !== undefined ? 'bg-[var(--erp-accent-soft)]' : working ? 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]' : 'bg-transparent hover:bg-[var(--erp-row)]',
                      on && 'ring-2 ring-[var(--erp-ink)]',
                    )}
                  >
                    <span className={cn('num flex size-6 items-center justify-center rounded-full text-[12px] font-bold', d === t ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : working ? '' : 'text-[var(--erp-muted)]')}>{Number(d.slice(8, 10))}</span>
                    {h !== undefined && <span className="hidden truncate text-[12px] font-semibold @min-[640px]:block">{h}</span>}
                    {away.length > 0 && (
                      <>
                        <span className="hidden flex-col gap-1 @min-[640px]:flex">
                          {away.slice(0, 2).map((e) => (
                            <span
                              key={e.id}
                              className={cn(
                                'truncate rounded-full px-2 py-0.5 text-[12px] font-semibold',
                                e.status === 'approved' ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'border border-dashed border-[var(--erp-ink-2)] text-[var(--erp-ink)]',
                              )}
                            >
                              {e.employee.name.split(' ')[0]}
                            </span>
                          ))}
                          {away.length > 2 && <span className="px-1 text-[12px] font-bold text-[var(--erp-ink-2)]">+{away.length - 2} more</span>}
                        </span>
                        <span className="flex items-center gap-0.5 @min-[640px]:hidden">
                          {away.slice(0, 3).map((e) => (
                            <span key={e.id} className={cn('size-2 rounded-full', e.status === 'approved' ? 'bg-[var(--erp-ink)]' : 'border-[1.5px] border-dashed border-[var(--erp-ink-2)]')} />
                          ))}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>
      <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
        <Card delay={2}>
          <CardHeader title={dayLabel(picked)} subtitle={hol.get(picked) ?? (pickedAway.length > 0 ? `${plural(pickedAway.length, 'person', 'people')} away` : 'Nobody away')} />
          {pickedAway.length > 0 && (
            <ul className="flex flex-col gap-2">
              {pickedAway.map((e) => {
                const Icon = leaveIcon(e.type?.icon);
                return (
                  <li key={e.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
                    <PersonAvatar name={e.employee.name} photo={e.employee.photo} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">{e.employee.name}</span>
                      <span className="flex items-center gap-1 truncate text-[12px] text-[var(--erp-muted)]">
                        <Icon size={12} aria-hidden /> {e.type?.name ?? 'Leave'} · {rangeLabel(e.from, e.to)}
                      </span>
                    </span>
                    {e.status === 'submitted' && (
                      <StatusPill tone="warn" size="sm">
                        Waiting
                      </StatusPill>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card delay={3}>
          <CardHeader title={`In ${monthLabel(month, true)}`} subtitle={c !== null ? plural(c.entries.length, 'booking') : undefined} />
          {c === null ? (
            <Skeleton className="h-16" />
          ) : c.entries.length === 0 && c.holidays.length === 0 ? (
            <p className="text-[13px] text-[var(--erp-muted)]">Everyone is in all month.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {c.holidays.map((h) => (
                <li key={h.id} className="flex items-center gap-3 rounded-[14px] bg-[var(--erp-accent-soft)] px-3 py-2 text-[13px]">
                  <CalendarDays size={14} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{h.name}</span>
                  <span className="shrink-0 text-[12px]">{dayLabel(h.date)}</span>
                </li>
              ))}
              {c.entries.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setPicked(e.from < `${month}-01` ? `${month}-01` : e.from)} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--erp-row)]">
                    <PersonAvatar name={e.employee.name} photo={e.employee.photo} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.employee.name}</span>
                    <span className="shrink-0 text-[12px] text-[var(--erp-muted)]">{rangeLabel(e.from, e.to)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function addMonthsLocal(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------- settings */

function TypeModal({ t, icons, onClose }: { t: LeaveType | null; icons: LeaveIcon[]; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(t?.name ?? '');
  const [days, setDays] = useState(t !== null ? String(t.days_per_year) : '');
  const [carry, setCarry] = useState(t !== null ? String(t.carry_over_max) : '');
  const [paid, setPaid] = useState(t?.paid ?? true);
  const [approval, setApproval] = useState(t?.needs_approval ?? true);
  const [icon, setIcon] = useState<LeaveIcon>(t?.icon ?? 'calendar-off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const p = { name: name.trim(), days_per_year: days === '' ? '0' : days, carry_over_max: carry === '' ? '0' : carry, paid, needs_approval: approval, icon };
    try {
      if (t === null) await op('leave.type-add', p, { quiet: true });
      else await op('leave.type-update', { type: t.id, ...p }, { quiet: true });
      toast.success('Saved');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const archive = async (): Promise<void> => {
    if (t === null) return;
    try {
      await op('leave.type-archive', { type: t.id, archived: !t.archived });
      toast.success(t.archived ? 'Restored' : 'Archived');
      onClose();
    } catch {
      /* shown */
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t === null ? 'New leave type' : `Edit ${t.name}`}
      footer={
        <>
          {t !== null && (
            <PillButton variant="ghost" onClick={() => void archive()} className="mr-auto">
              {t.archived ? 'Restore' : 'Archive'}
            </PillButton>
          )}
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus={t === null} className={softInput} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Days a year" hint="0 means no limit">
            <NumberInput value={days} onChange={setDays} ariaLabel="Days a year" decimals={1} />
          </Field>
          <Field label="Carry over at most" hint="Days into next year">
            <NumberInput value={carry} onChange={setCarry} ariaLabel="Carry over at most" decimals={1} />
          </Field>
        </div>
        <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-2">
          {icons.map((k) => {
            const I = LEAVE_ICONS[k];
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={icon === k}
                aria-label={k.replace(/-/g, ' ')}
                onClick={() => setIcon(k)}
                className={cn('flex size-11 items-center justify-center rounded-full transition-colors', icon === k ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
              >
                <I size={18} aria-hidden />
              </button>
            );
          })}
        </div>
        <ToggleRow title="Paid" text="Pay continues during this leave" checked={paid} onChange={setPaid} />
        <ToggleRow title="Needs approval" text="Off: recorded at once, no manager decision" checked={approval} onChange={setApproval} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}

function SettingsTab({ full }: { full: boolean }): React.JSX.Element {
  const types = useLive(() => op<LeaveTypes>('leave.types', { archived: true }, { quiet: true }), ['leave_types'], []);
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const hol = useLive(() => op<Holidays>('leave.holidays', { year }, { quiet: true }), ['holidays'], [year]);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [hBusy, setHBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  // Adjust a balance
  const [emp, setEmp] = useState<Option | null>(null);
  const [aType, setAType] = useState('');
  const [aDays, setADays] = useState('');
  const [aReason, setAReason] = useState('');
  const [aBusy, setABusy] = useState(false);
  const [aError, setAError] = useState<string | null>(null);
  const empBal = useLive(() => (emp !== null ? op<Balances>('leave.balances', { employee: emp.id, year }, { quiet: true }) : Promise.resolve(null)), [...LEAVE_READS], [emp?.id, year]);
  const activeTypes = (types.data?.types ?? []).filter((x) => !x.archived);

  const addHoliday = async (): Promise<void> => {
    if (hDate === '' || hName.trim() === '') return;
    setHBusy(true);
    try {
      await op('leave.holiday-add', { date: hDate, name: hName.trim() });
      setHDate('');
      setHName('');
      if (Number(hDate.slice(0, 4)) !== year) setYear(Number(hDate.slice(0, 4)));
    } catch {
      /* shown */
    } finally {
      setHBusy(false);
    }
  };
  const adjust = async (): Promise<void> => {
    if (emp === null) return;
    setABusy(true);
    setAError(null);
    try {
      await op('leave.adjust', { employee: emp.id, type: aType !== '' ? aType : (activeTypes[0]?.id ?? ''), year, days: aDays, reason: aReason.trim() === '' ? undefined : aReason.trim() }, { quiet: true });
      toast.success('Balance adjusted');
      setADays('');
      setAReason('');
    } catch (e) {
      setAError((e as Error).message);
    } finally {
      setABusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <div className="flex flex-col gap-5 @min-[900px]:col-span-7">
        <Card>
          <CardHeader
            title="Leave types"
            subtitle="Days a year are given in full from January, and prorated in the year someone starts"
            action={
              types.data?.can.edit === true ? (
                <PillButton size="sm" icon={Plus} onClick={() => setEditing('new')}>
                  New type
                </PillButton>
              ) : undefined
            }
          />
          <DataTable
            ariaLabel="Leave types"
            rows={types.data?.types ?? []}
            loading={types.data === null}
            rowKey={(x) => x.id}
            onOpen={types.data?.can.edit === true ? (x) => setEditing(x) : undefined}
            rowTone={(x) => (x.archived ? 'muted' : undefined)}
            columns={[
              {
                key: 'n',
                label: 'Type',
                width: 'minmax(0, 2fr)',
                render: (x) => {
                  const I = leaveIcon(x.icon);
                  return (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
                        <I size={14} aria-hidden />
                      </span>
                      <span className="truncate font-semibold">{x.name}</span>
                      {x.archived && <StatusPill tone="neutral" size="sm">Archived</StatusPill>}
                    </span>
                  );
                },
              },
              { key: 'd', label: 'Days a year', width: '110px', align: 'right', render: (x) => (x.days_per_year > 0 ? qty(x.days_per_year) : 'No limit') },
              { key: 'c', label: 'Carry over', width: '100px', align: 'right', hide: 'md', render: (x) => (x.carry_over_max > 0 ? qty(x.carry_over_max) : '') },
              { key: 'p', label: 'Paid', width: '70px', hide: 'sm', render: (x) => (x.paid ? 'Paid' : 'Unpaid') },
              { key: 'a', label: 'Approval', width: '100px', hide: 'md', render: (x) => (x.needs_approval ? 'Manager' : 'None') },
            ]}
            mobile={(x) => ({ title: x.name, sub: `${x.paid ? 'Paid' : 'Unpaid'} · ${x.needs_approval ? 'needs approval' : 'no approval'}`, right: x.days_per_year > 0 ? `${qty(x.days_per_year)} days` : 'No limit' })}
          />
        </Card>
        {full && (
        <Card delay={2}>
          <CardHeader
            title="Adjust a balance"
            subtitle="Carried-over days, corrections or extra days; a minus takes days away"
            icon={SlidersHorizontal}
          />
          <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
            <Field label="Person">
              <EmployeePicker value={emp} onChange={setEmp} />
            </Field>
            <PillSelect soft label="Leave type" value={aType !== '' ? aType : (activeTypes[0]?.id ?? '')} onChange={setAType} options={activeTypes.map((x) => ({ value: x.id, label: x.name }))} />
            <Field label={`Days in ${year}`}>
              <NumberInput value={aDays} onChange={setADays} ariaLabel="Days" decimals={1} allowNegative placeholder="e.g. 3 or -1.5" />
            </Field>
            <Field label="Why" optional>
              <input value={aReason} onChange={(e) => setAReason(e.target.value)} aria-label="Why" className={softInput} />
            </Field>
          </div>
          {aError !== null && (
            <div className="mt-3">
              <Notice tone="bad">{aError}</Notice>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <PillButton icon={SlidersHorizontal} loading={aBusy} disabled={emp === null || aDays === '' || Number(aDays) === 0} onClick={() => void adjust()}>
              Adjust
            </PillButton>
          </div>
          {empBal.data !== null && (
            <div className="mt-5 border-t border-[var(--erp-line)] pt-4">
              <p className="mb-2 text-[12px] font-bold text-[var(--erp-muted)]">
                {empBal.data.employee.name}, {empBal.data.year}
              </p>
              <div className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2">
                {empBal.data.types.map((b) => (
                  <BalanceRing key={b.type.id} b={b} />
                ))}
              </div>
              {(empBal.data.adjustments ?? []).length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-[13px]">
                  {(empBal.data.adjustments ?? []).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 px-1">
                      <span className="min-w-0 truncate">
                        {a.type?.name ?? 'Leave'}
                        {a.reason !== '' ? `: ${a.reason}` : ''} <span className="text-[var(--erp-muted)]">by {a.by}</span>
                      </span>
                      <span className="num shrink-0 font-bold">{a.days > 0 ? `+${qty(a.days)}` : qty(a.days)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
        )}
      </div>
      <Card className="@min-[900px]:col-span-5" delay={2}>
        <CardHeader
          title="Public holidays"
          subtitle="Not counted as leave days"
          action={
            <div className="flex items-center gap-1">
              <CircleButton icon={ChevronLeft} label="Previous year" variant="row" size={32} onClick={() => setYear((y) => y - 1)} />
              <span className="num min-w-[3rem] text-center text-[14px] font-bold">{year}</span>
              <CircleButton icon={ChevronRight} label="Next year" variant="row" size={32} onClick={() => setYear((y) => y + 1)} />
            </div>
          }
        />
        {hol.data?.can.edit === true && (
          <div className="mb-4 flex flex-col gap-2 rounded-[20px] bg-[var(--erp-row)] p-3">
            <DateField value={hDate} onChange={setHDate} ariaLabel="Holiday date" placeholder="Choose the day" className="[&>button]:bg-[var(--erp-card)]" />
            <div className="flex gap-2">
              <input
                value={hName}
                onChange={(e) => setHName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addHoliday();
                }}
                placeholder="Name, e.g. National Day"
                aria-label="Holiday name"
                className={cn(softInput, 'flex-1 bg-[var(--erp-card)]')}
              />
              <PillButton icon={Plus} loading={hBusy} disabled={hDate === '' || hName.trim() === ''} onClick={() => void addHoliday()}>
                Add
              </PillButton>
            </div>
          </div>
        )}
        {hol.data === null ? (
          <Skeleton className="h-16" />
        ) : hol.data.holidays.length === 0 ? (
          <Empty icon={CalendarDays} title={`No holidays in ${year}`} compact />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {hol.data.holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
                <span className="num flex size-10 shrink-0 flex-col items-center justify-center rounded-[12px] bg-[var(--erp-card)] leading-none">
                  <span className="text-[12px] font-semibold text-[var(--erp-muted)]">{monthShort(h.date)}</span>
                  <span className="text-[14px] font-extrabold">{Number(h.date.slice(8, 10))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{h.name}</span>
                  <span className="block text-[12px] text-[var(--erp-muted)]">
                    {WEEK[h.weekday - 1]}
                    {!h.working_day ? ', not a working day' : ''}
                  </span>
                </span>
                {hol.data?.can.edit === true && (
                  <CircleButton
                    icon={Trash2}
                    label={`Delete ${h.name}`}
                    variant="ghost"
                    size={32}
                    onClick={() => {
                      void (async () => {
                        if (!(await confirm(`${h.name} on ${dayLabel(h.date)} counts as a working day again.`, 'Delete this holiday?'))) return;
                        await op('leave.holiday-delete', { holiday: h.id }).catch(() => undefined);
                      })();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing !== null && types.data !== null && <TypeModal t={editing === 'new' ? null : editing} icons={types.data.icons} onClose={() => setEditing(null)} />}
      {confirmEl}
    </div>
  );
}

function monthShort(day: string): string {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/* ----------------------------------------------------------------- page */

export function LeavePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const self = me.employee !== null;
  const hrFull = can(me, 'people', 'full');
  const showTeam = me.manages > 0 || hrFull;
  const showSettings = can(me, 'people', 'edit');
  const tabs: { value: Tab; label: string; icon: typeof Users; count?: number | undefined }[] = [];
  const pending = useLive(() => (showTeam ? op<LeaveList>('leave.list', { scope: hrFull ? 'all' : 'team', status: 'submitted', limit: 1 }, { quiet: true }) : Promise.resolve(null)), [...LEAVE_READS], [showTeam, hrFull]);
  if (self) tabs.push({ value: 'mine', label: 'My leave', icon: CalendarDays });
  if (showTeam) tabs.push({ value: 'team', label: hrFull && me.manages === 0 ? 'Requests' : 'Team', icon: Users, count: pending.data?.counts.submitted });
  tabs.push({ value: 'calendar', label: 'Calendar', icon: CalendarDays });
  if (showSettings) tabs.push({ value: 'settings', label: 'Settings', icon: Settings2 });
  const asked = query.get('tab') as Tab | null;
  const tab: Tab = asked !== null && tabs.some((t) => t.value === asked) ? asked : (tabs[0]?.value ?? 'calendar');
  const month = query.get('month') ?? today().slice(0, 7);
  const [requesting, setRequesting] = useState<{ type?: string | undefined } | null>(self && query.get('new') !== null ? {} : null);

  useEffect(() => {
    if (self && query.get('new') !== null) setRequesting({});
  }, [query, self]);

  const go = (patch: Record<string, string | undefined>): void => replaceQuery('leave', { tab: tab === tabs[0]?.value ? undefined : tab, month: query.get('month') ?? undefined, ...patch });
  const closeRequest = (): void => {
    setRequesting(null);
    if (query.get('new') !== null) go({ new: undefined });
  };
  const subtitle = useMemo(() => (self ? undefined : 'Your account has no employee record, so it has no leave of its own'), [self]);

  return (
    <div>
      <PageHeader
        title="Leave"
        subtitle={subtitle}
        actions={
          self ? (
            <PillButton icon={CalendarPlus} dot onClick={() => setRequesting({})}>
              Request leave
            </PillButton>
          ) : undefined
        }
      />
      {tabs.length > 1 && <Tabs ariaLabel="Leave sections" value={tab} onChange={(t) => go({ tab: t === tabs[0]?.value ? undefined : t })} tabs={tabs} />}
      {tab === 'mine' && <MyLeave onRequest={(type) => setRequesting({ type })} />}
      {tab === 'team' && <TeamLeave scope={hrFull ? 'all' : 'team'} />}
      {tab === 'calendar' && <CalendarTab month={month} setMonth={(m) => go({ month: m })} />}
      {tab === 'settings' && <SettingsTab full={hrFull} />}
      {requesting !== null && <LeaveRequestModal open onClose={closeRequest} initialType={requesting.type} />}
    </div>
  );
}


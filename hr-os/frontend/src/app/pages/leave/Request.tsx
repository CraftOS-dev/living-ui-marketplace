/**
 * Request time off, in a sheet that opens on the calendar with the person's
 * usual type chosen (the type is a chip above the calendar: tap it for the
 * others, with what is available). Tap a day for one day, a later day to make
 * it a stretch, see the days it takes and the balance after, send: three taps
 * on a phone (Request, the day, Send). Half days and hours appear only for types that allow them; checks
 * (notice, locked days, balance, overlaps, a certificate) show before
 * sending, with who else in the team is away. Managers and HR may go past a
 * lock, notice or balance with a reason; HR may record leave as approved.
 *
 * Also here: cashing in leave and compensatory leave for a day worked.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Lock, Send, Users } from 'lucide-react';
import { Button, DayPicker, Dialog, Field, FileDrop, Input, Notice, PersonChip, Segmented, Sheet, SheetHeader, Textarea, toast } from '../../components/ui.tsx';
import { Switch } from '../../components/leave/Switch.tsx';
import { RangeCalendar } from '../../components/leave/RangeCalendar.tsx';
import type { DayMark } from '../../components/leave/RangeCalendar.tsx';
import { TypeMark, leaveIcon } from '../../components/leave/LeaveIcon.tsx';
import { errCode, errMessage, op, opForm } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { dayKey, fmtDay, fmtRange } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { amount, figure, READS, unitWord, whenText } from './data.ts';
import type { CalendarData, CheckResult, LeaveRequest, LeaveType } from './types.ts';

type Mode = 'days' | 'half' | 'hours';

export interface RequestTarget {
  employment: string;
  number: string;
  name: string;
  self: boolean;
}

function monthEnd(m: string): string {
  const d = new Date(m.slice(0, 4) + '-' + m.slice(5, 7) + '-01T12:00:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return dayKey(d);
}

/** The person's calendar for a month: days off, holidays, leave already booked, locked days. */
function useMarks(target: RequestTarget, month: string): { marks: Record<string, DayMark>; weekOff: number[] } {
  const from = month.slice(0, 8) + '01';
  const live = useOp<CalendarData>('leave.calendar', { from, to: monthEnd(from), q: target.number }, READS, { name: 'leave.calendar.picker' });
  return useMemo(() => {
    const d = live.data;
    const marks: Record<string, DayMark> = {};
    if (d === null) return { marks, weekOff: [0, 6] };
    const row = d.rows.find((r) => r.employment === target.employment);
    for (const h of row !== undefined ? (d.holidays[row.calendar] ?? []) : []) marks[h.day] = { ...marks[h.day], holiday: h.name, half: h.half };
    for (const b of d.bars.filter((x) => x.employment === target.employment)) {
      for (let day = b.start; day <= b.end; ) {
        marks[day] = { ...marks[day], booked: { color: b.color, label: `${b.type_name !== '' ? b.type_name : t('leave.away')} (${t(`leave.status.${b.status}`)})` } };
        const n = new Date(day + 'T12:00:00');
        n.setDate(n.getDate() + 1);
        day = dayKey(n);
      }
    }
    for (const bl of d.blocks) {
      for (let day = bl.from < from ? from : bl.from; day <= bl.to && day <= monthEnd(from); ) {
        marks[day] = { ...marks[day], locked: bl.reason };
        const n = new Date(day + 'T12:00:00');
        n.setDate(n.getDate() + 1);
        day = dayKey(n);
      }
    }
    return { marks, weekOff: row?.week_off ?? [0, 6] };
  }, [live.data, target.employment, from]);
}

/** The type a request opens with: the one asked for, the person's usual type, else the first paid type with days left. */
export function defaultType(types: LeaveType[], initialType?: string | undefined): string {
  if (initialType !== undefined && types.some((x) => x.code === initialType)) return initialType;
  const usual = types.find((x) => x.usual === true);
  if (usual !== undefined) return usual.code;
  return (types.find((x) => x.tracked === true && x.paid && (x.available ?? 0) > 0) ?? types.find((x) => x.paid) ?? types[0])?.code ?? '';
}

function availText(ty: LeaveType): string {
  return ty.tracked === true ? t('leave.available_n', { n: amount(ty.available ?? 0, ty.unit) }) : ty.paid ? t('leave.no_limit') : t('leave.unpaid');
}

/** The chosen type as a chip; open, the other types in hairline rows of one panel. */
function TypeChooser({ types, value, onChange }: { types: LeaveType[]; value: string; onChange: (code: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const cur = types.find((x) => x.code === value) ?? null;
  const Icon = leaveIcon(cur?.icon ?? '');
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('leave.form.type')}
        disabled={types.length < 2}
        onClick={() => setOpen((v) => !v)}
        className="hr-focus flex min-h-10 w-full items-center gap-2.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-3 py-1.5 text-left transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)] disabled:cursor-default disabled:hover:border-[var(--hr-line)] disabled:hover:bg-[var(--hr-raised)]"
      >
        <Icon size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--hr-ink-2)]" />
        <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium leading-5">{cur?.name ?? t('leave.form.what')}</span>
        {cur !== null && <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{availText(cur)}</span>}
        {types.length > 1 && <ChevronDown size={14} aria-hidden className={`shrink-0 text-[var(--hr-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <ul className="hr-panel hr-in overflow-hidden" role="listbox" aria-label={t('leave.form.type')}>
          {types.map((ty) => (
            <li key={ty.id} className="border-t border-[var(--hr-hair)] first:border-t-0">
              <button
                type="button"
                role="option"
                aria-selected={ty.code === value}
                onClick={() => {
                  onChange(ty.code);
                  setOpen(false);
                }}
                className="hr-focus flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--hr-hover)]"
              >
                <TypeMark icon={ty.icon} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium leading-5">{ty.name}</span>
                  <span className="hr-mono block text-[12px] text-[var(--hr-muted)]">{availText(ty)}</span>
                </span>
                {ty.code === value && <Check size={14} aria-hidden className="shrink-0 text-[var(--hr-ink)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequestSheet({ open, onClose, target, types, initialType, initialDay }: { open: boolean; onClose: () => void; target: RequestTarget; types: LeaveType[]; initialType?: string | undefined; initialDay?: string | undefined }): React.JSX.Element | null {
  const me = useMe();
  const today = me.today;
  const [typeCode, setTypeCode] = useState(() => defaultType(types, initialType));
  const [from, setFrom] = useState(initialDay ?? '');
  const [to, setTo] = useState(initialDay ?? '');
  const [month, setMonth] = useState((initialDay ?? today).slice(0, 8) + '01');
  const [mode, setMode] = useState<Mode>('days');
  const [half, setHalf] = useState<'am' | 'pm'>('am');
  const [startPm, setStartPm] = useState(false);
  const [endAm, setEndAm] = useState(false);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [record, setRecord] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checkErr, setCheckErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { marks, weekOff } = useMarks(target, month);
  const type = types.find((x) => x.code === typeCode) ?? null;
  const hr = can(me, 'leave', 'full') && !target.self;

  // Reset when the sheet opens or what it opens with changes (not on every new list of the same types).
  const typeKey = types.map((x) => x.code + (x.usual === true ? '*' : '')).join(',');
  useEffect(() => {
    if (!open) return;
    setTypeCode(defaultType(types, initialType));
    setFrom(initialDay ?? '');
    setTo(initialDay ?? '');
    setMonth((initialDay ?? today).slice(0, 8) + '01');
    setMode('days');
    setStartPm(false);
    setEndAm(false);
    setHours('');
    setReason('');
    setFile(null);
    setRecord(false);
    setCheck(null);
    setCheckErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialType, initialDay, today, typeKey]);

  const single = from !== '' && from === to;
  const effMode: Mode = type === null ? 'days' : mode === 'half' && (!type.allow_half || !single) ? 'days' : mode === 'hours' && (!type.allow_hours || !single) ? 'days' : mode;
  const hoursNum = Number(hours.replace(',', '.'));
  const params = useMemo(() => {
    if (type === null || from === '') return null;
    const p: Record<string, unknown> = { type: type.code, start: from, end: to };
    if (!target.self) p['employment'] = target.employment;
    if (effMode === 'half') p['start_half'] = half;
    if (effMode === 'hours') {
      if (!(hoursNum > 0)) return null;
      p['hours'] = hoursNum;
    }
    if (effMode === 'days' && !single) {
      if (startPm && type.allow_half) p['start_half'] = 'pm';
      if (endAm && type.allow_half) p['end_half'] = 'am';
    }
    return p;
  }, [type, from, to, effMode, half, hoursNum, startPm, endAm, single, target]);

  useEffect(() => {
    if (params === null) {
      setCheck(null);
      setCheckErr('');
      return;
    }
    let live = true;
    const h = setTimeout(() => {
      op<CheckResult>('leave.check', params, { quiet: true })
        .then((r) => live && (setCheck(r), setCheckErr('')))
        .catch((e: unknown) => live && (setCheck(null), setCheckErr(errMessage(e))));
    }, 180);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [params]);

  const blocks = check?.warnings.filter((w) => w.severity === 'block') ?? [];
  const stops = check?.warnings.filter((w) => w.severity === 'stop') ?? [];
  const override = blocks.length > 0 && check?.can_override === true;
  const needReason = override && reason.trim() === '';
  const canSend = check !== null && stops.length === 0 && (blocks.length === 0 || override) && !needReason && !busy;

  const send = async (): Promise<void> => {
    if (params === null || !canSend) return;
    setBusy(true);
    const p = { ...params, reason: reason.trim() === '' ? undefined : reason.trim(), override: override ? true : undefined, record: hr && record ? true : undefined };
    try {
      const r = file !== null ? await opForm<{ request: LeaveRequest }>('leave.request', p, { attachment: file }) : await op<{ request: LeaveRequest }>('leave.request', p);
      changed(...READS);
      onClose();
      const done = r.request.status === 'approved';
      toast.success(done ? t('leave.form.sent_approved', { what: whenText(r.request) }) : t('leave.form.sent', { what: whenText(r.request) }), { label: t('leave.form.see_it'), run: () => navigate(`/leave/requests/${r.request.id}`) });
    } catch (e) {
      if (errCode(e) === 'aborted') return;
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} label={t('leave.request')} width={520}>
      <SheetHeader title={t('leave.request')} meta={target.self ? t('leave.form.for_you') : t('leave.form.for', { name: target.name })} onClose={onClose} />
      <div className="hr-scroll flex-1 overflow-y-auto px-4 py-4">
        {types.length === 0 ? (
          <p className="text-[13px] text-[var(--hr-muted)]">{t('leave.form.no_types')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <TypeChooser types={types} value={typeCode} onChange={setTypeCode} />
            <RangeCalendar month={month} onMonth={setMonth} from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} weekOff={weekOff} marks={marks} today={today} />
            {from !== '' && <p className="hr-label -mt-2 text-center">{fmtRange(from, to)}</p>}
            {type !== null && from !== '' && (type.allow_half || type.allow_hours) && (
              <div className="flex flex-wrap items-center gap-2">
                {single ? (
                  <Segmented
                    value={effMode}
                    onChange={setMode}
                    label={t('leave.form.how_long')}
                    options={[{ value: 'days' as Mode, label: t('leave.form.full_day') }, ...(type.allow_half ? [{ value: 'half' as Mode, label: t('leave.form.half_day') }] : []), ...(type.allow_hours ? [{ value: 'hours' as Mode, label: t('leave.form.hours') }] : [])]}
                  />
                ) : (
                  type.allow_half && (
                    <>
                      <Switch checked={startPm} onChange={setStartPm} label={t('leave.form.start_pm')} />
                      <Switch checked={endAm} onChange={setEndAm} label={t('leave.form.end_am')} />
                    </>
                  )
                )}
                {effMode === 'half' && (
                  <Segmented value={half} onChange={setHalf} label={t('leave.form.which_half')} options={[{ value: 'am', label: t('leave.form.morning') }, { value: 'pm', label: t('leave.form.afternoon') }]} />
                )}
                {effMode === 'hours' && <Input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder={t('leave.form.hours_ph')} aria-label={t('leave.form.hours')} className="w-28" />}
              </div>
            )}
            {checkErr !== '' && <Notice tone="bad">{checkErr}</Notice>}
            {check !== null && type !== null && (
              <section className="hr-panel hr-in grid grid-cols-3 gap-2 px-3.5 py-3" aria-live="polite">
                <div className="min-w-0">
                  <div className="hr-label">{t('leave.form.takes')}</div>
                  <div className="hr-mono hr-num mt-1 text-[26px] font-light leading-none">{figure(check.amount)}</div>
                  <div className="hr-mono mt-1 text-[12px] text-[var(--hr-muted)]">{unitWord(check.unit, check.amount)}</div>
                </div>
                <div className="min-w-0">
                  <div className="hr-label">{t('leave.form.now')}</div>
                  <div className="hr-mono hr-num mt-1 text-[26px] font-light leading-none text-[var(--hr-ink-2)]">{check.before === null ? t('ui.none') : figure(check.before)}</div>
                  <div className="hr-mono mt-1 text-[12px] text-[var(--hr-muted)]">{check.before === null ? t('leave.no_limit') : t('leave.form.available')}</div>
                </div>
                <div className="min-w-0">
                  <div className="hr-label">{t('leave.form.after')}</div>
                  <div className={`hr-mono hr-num mt-1 text-[26px] font-light leading-none ${check.after !== null && check.after < 0 ? 'text-[var(--hr-bad)]' : ''}`}>{check.after === null ? t('ui.none') : figure(check.after)}</div>
                  <div className="hr-mono mt-1 text-[12px] text-[var(--hr-muted)]">{check.after === null ? '' : unitWord(check.unit, check.after)}</div>
                </div>
                {check.holidays.length > 0 && <p className="hr-wrap col-span-3 text-[12px] text-[var(--hr-muted)]">{t('leave.form.holidays_inside', { list: check.holidays.map((h) => `${fmtDay(h.day)} ${h.name}`).join(', ') })}</p>}
              </section>
            )}
            {check?.warnings.filter((w) => w.code !== 'clash').map((w) => (
              <Notice key={w.code + w.message} tone={w.severity === 'stop' ? 'bad' : w.severity === 'block' ? (override ? 'warn' : 'bad') : 'warn'}>
                {w.code === 'locked' && <Lock size={12} aria-hidden className="mr-1 inline" />}
                {w.message}
              </Notice>
            ))}
            {check !== null && check.clashes.length > 0 && (
              <section aria-label={t('leave.form.away')}>
                <div className="hr-label mb-1.5 flex items-center gap-1.5">
                  <Users size={12} aria-hidden />
                  {tn('leave.form.away_n', check.clashes.length)}
                </div>
                <ul className="flex flex-col gap-1">
                  {check.clashes.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-[13px]">
                      <PersonChip name={c.name} size={20} strong={false} />
                      <span className="hr-mono ml-auto shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtRange(c.start, c.end)}</span>
                      <span className="w-24 shrink-0 truncate text-right text-[12px] text-[var(--hr-muted)]">{c.away_only === true ? t('leave.away') : c.type_name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {check !== null && (
              <>
                <Field label={override ? t('leave.form.why_override') : t('leave.form.reason')} optional={!override}>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={override ? t('leave.form.why_override_ph') : t('leave.form.reason_ph')} aria-label={t('leave.form.reason')} />
                </Field>
                {check.needs_attachment && (
                  <Field label={t('leave.form.certificate')} optional>
                    {file !== null ? (
                      <div className="flex items-center gap-2 text-[13px]">
                        <Check size={14} aria-hidden className="text-[var(--hr-good)]" />
                        <span className="hr-wrap min-w-0 flex-1">{file.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                          {t('ui.remove')}
                        </Button>
                      </div>
                    ) : (
                      <FileDrop onFiles={(f) => setFile(f[0] ?? null)} accept="image/*,application/pdf" label={t('leave.form.add_certificate')} />
                    )}
                  </Field>
                )}
                {hr && <Switch checked={record} onChange={setRecord} label={t('leave.form.record')} />}
              </>
            )}
          </div>
        )}
      </div>
      {types.length > 0 && (
        <footer className="flex items-center gap-2 border-t border-[var(--hr-line)] px-4 py-3">
          <span className="hr-mono min-w-0 flex-1 truncate text-[12px] text-[var(--hr-muted)]">{check !== null ? `${amount(check.amount, check.unit)} · ${fmtRange(check.start, check.end)}` : ''}</span>
          <Button variant="primary" size="lg" icon={Send} busy={busy} disabled={!canSend} onClick={() => void send()}>
            {hr && record ? t('leave.form.record_it') : override ? t('leave.form.send_anyway') : t('leave.form.send')}
          </Button>
        </footer>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------ cash in leave */

export function EncashDialog({ open, onClose, target, types }: { open: boolean; onClose: () => void; target: RequestTarget; types: LeaveType[] }): React.JSX.Element | null {
  const list = types.filter((x) => x.encashable && x.tracked === true);
  const [code, setCode] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCode(list[0]?.code ?? '');
      setDays('');
      setReason('');
      setErr('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const ty = list.find((x) => x.code === code);
  const n = Number(days.replace(',', '.'));
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      await op('leave.encash-request', { employment: target.self ? undefined : target.employment, type: code, days: n, reason: reason.trim() === '' ? undefined : reason.trim() }, { quiet: true });
      changed(...READS);
      onClose();
      toast.success(t('leave.encash.sent', { n: amount(n, 'day') }));
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('leave.encash.title')}
      meta={target.self ? undefined : target.name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!(n > 0) || code === ''} onClick={() => void save()}>
            {t('leave.encash.send')}
          </Button>
        </>
      }
    >
      {list.length === 0 ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('leave.encash.none')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {list.length > 1 && <Segmented value={code} onChange={setCode} label={t('leave.type')} options={list.map((x) => ({ value: x.code, label: x.name }))} />}
          <Field label={t('leave.encash.days')} hint={ty !== undefined ? t('leave.available_n', { n: amount(ty.available ?? 0, ty.unit) }) : undefined}>
            <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" placeholder="2" aria-label={t('leave.encash.days')} autoFocus />
          </Field>
          <Field label={t('leave.form.reason')} optional>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} aria-label={t('leave.form.reason')} />
          </Field>
          <p className="text-[12px] text-[var(--hr-muted)]">{t('leave.encash.how')}</p>
          {err !== '' && <Notice tone="bad">{err}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------- compensatory leave */

export function CompOffDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: RequestTarget }): React.JSX.Element | null {
  const me = useMe();
  const [day, setDay] = useState('');
  const [days, setDays] = useState('1');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDay('');
      setDays('1');
      setHours('');
      setReason('');
      setErr('');
    }
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      await op('leave.comp-off-request', { employment: target.self ? undefined : target.employment, worked_day: day, days: Number(days), hours: hours.trim() === '' ? undefined : Number(hours.replace(',', '.')), reason: reason.trim() === '' ? undefined : reason.trim() }, { quiet: true });
      changed(...READS);
      onClose();
      toast.success(t('leave.comp.sent', { day: fmtDay(day) }));
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('leave.comp.title')}
      meta={target.self ? undefined : target.name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={day === ''} onClick={() => void save()}>
            {t('leave.comp.send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('leave.comp.day')}>
          <DayPicker value={day} onChange={setDay} max={me.today} label={t('leave.comp.day')} />
        </Field>
        <Field label={t('leave.comp.earned')}>
          <Segmented value={days} onChange={setDays} label={t('leave.comp.earned')} options={['0.5', '1', '1.5', '2'].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label={t('leave.comp.hours')} optional>
          <Input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="8" aria-label={t('leave.comp.hours')} className="w-28" />
        </Field>
        <Field label={t('leave.comp.what')} optional>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} aria-label={t('leave.comp.what')} />
        </Field>
        {err !== '' && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

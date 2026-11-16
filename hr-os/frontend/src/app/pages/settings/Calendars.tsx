/**
 * Holiday calendars as a year of twelve small months (a click on a day adds
 * or changes its holiday), and work schedules with a week editor.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Checkbox, Dialog, Empty, Field, IconButton, Input, LinkButton, Loading, Notice, Panel, Picker, RowCue, Segmented, Tag, Toggle, confirmAsk } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { dateOf, dayKey, fmtDay, monthName, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';

interface Calendar {
  id: string;
  code: string;
  name: string;
  country: string;
  region: string;
  entity: string;
  builtin: boolean;
  seeded_years: string[];
  archived: boolean;
  holidays_this_year?: number | undefined;
  used_by?: number | undefined;
}

interface Holiday {
  id: string;
  calendar: string;
  day: string;
  name: string;
  kind: 'public' | 'company' | 'optional' | 'observed';
  half: boolean;
  source: string;
}

const KIND_CLS: Record<Holiday['kind'], string> = {
  public: 'bg-[var(--hr-ink)] text-[var(--hr-on-ink)]',
  observed: 'bg-[var(--hr-ink-2)] text-[var(--hr-on-ink)]',
  company: 'bg-[var(--hr-rh)] text-[var(--hr-page)]',
  optional: 'ring-1 ring-inset ring-[var(--hr-ink-2)] text-[var(--hr-ink)]',
};

function Month({ year, month, holidays, onDay }: { year: number; month: number; holidays: Map<string, Holiday[]>; onDay: (day: string) => void }): React.JSX.Element {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const today = dayKey();
  const cells: (string | null)[] = [...Array.from({ length: offset }, () => null), ...Array.from({ length: days }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <div className="min-w-0">
      <div className="hr-label mb-1.5 px-0.5">{monthName(month)}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const hs = holidays.get(d) ?? [];
          const h = hs[0];
          const wd = dateOf(d).getDay();
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDay(d)}
              title={hs.length > 0 ? hs.map((x) => x.name).join(', ') : fmtDay(d, { weekday: true, year: 'always' })}
              aria-label={hs.length > 0 ? `${fmtDay(d, { year: 'always' })}: ${hs.map((x) => x.name).join(', ')}` : fmtDay(d, { year: 'always' })}
              className={cn(
                'hr-focus hr-mono hr-num flex aspect-square items-center justify-center rounded-[3px] text-[10.5px] transition-colors',
                h !== undefined ? KIND_CLS[h.kind] : wd === 0 || wd === 6 ? 'text-[var(--hr-faint)] hover:bg-[var(--hr-hover)]' : 'text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]',
                d === today && h === undefined && 'ring-1 ring-inset ring-[var(--hr-line-2)]',
                h?.half === true && 'opacity-80',
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HolidayDialog({ day, holiday, calendar, onClose }: { day: string; holiday: Holiday | null; calendar: string; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(holiday?.name ?? '');
  const [kind, setKind] = useState<Holiday['kind']>(holiday?.kind ?? 'company');
  const [half, setHalf] = useState(holiday?.half ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (holiday === null) await op('holidays.add', { calendar, day, name: name.trim(), kind, half }, { quiet: true });
      else await op('holidays.update', { holiday: holiday.id, name: name.trim(), kind, half }, { quiet: true });
      changed('holidays', 'holiday_calendars');
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (holiday === null) return;
    try {
      await op('holidays.delete', { holiday: holiday.id });
      changed('holidays', 'holiday_calendars');
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={holiday === null ? t('cal.add_holiday') : holiday.name}
      meta={fmtDay(day, { weekday: true, year: 'always' })}
      width={420}
      footer={
        <>
          {holiday !== null && (
            <Button variant="danger" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              {t('ui.remove')}
            </Button>
          )}
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('cal.holiday_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t('cal.holiday_name')} />
        </Field>
        <Field label={t('cal.kind')}>
          <Segmented value={kind} onChange={setKind} label={t('cal.kind')} size="sm" options={(['public', 'company', 'optional', 'observed'] as const).map((k) => ({ value: k, label: t(`cal.kind.${k}`) }))} />
        </Field>
        <Checkbox checked={half} onChange={setHalf} label={t('cal.half')} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

function AddCalendar({ open, onClose, calendars }: { open: boolean; onClose: (id?: string) => void; calendars: Calendar[] }): React.JSX.Element | null {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [copy, setCopy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCode('');
      setName('');
      setCopy('');
      setError(null);
    }
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ calendar: Calendar }>('calendars.add', { code: code.trim().toUpperCase(), name: name.trim(), copy_from: copy === '' ? undefined : copy }, { quiet: true });
      changed('holiday_calendars', 'holidays');
      onClose(r.calendar.id);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => onClose()}
      title={t('cal.add')}
      width={440}
      footer={
        <>
          <Button onClick={() => onClose()}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={code.trim() === '' || name.trim() === ''} onClick={() => void save()}>
            {t('ui.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('cal.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('cal.name_ph')} aria-label={t('cal.name')} />
        </Field>
        <Field label={t('org.f.code')} hint={t('cal.code_hint')}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="hr-mono" placeholder="SG-COMPANY" aria-label={t('org.f.code')} />
        </Field>
        <Field label={t('cal.copy_from')} optional>
          <Picker value={copy} onChange={setCopy} items={calendars.map((c) => ({ value: c.id, label: c.name, sub: c.code }))} label={t('cal.copy_from')} clearable />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function CalendarsSection({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const year = Number(query.get('year') ?? new Date().getFullYear());
  const list = useOp<{ calendars: Calendar[] }>('calendars.list', { year }, ['holiday_calendars', 'holidays'], { name: 'settings.calendars', keep: true });
  const chosen = query.get('calendar') ?? '';
  const cals = list.data?.calendars ?? null;
  const cal = cals?.find((c) => c.id === chosen) ?? cals?.[0] ?? null;
  const detail = useOp<{ calendar: Calendar; year: string; holidays: Holiday[] }>('calendars.get', { calendar: cal?.id ?? '', year }, ['holidays', 'holiday_calendars'], { name: 'settings.calendar', skip: cal === null, keep: true });
  const [pick, setPick] = useState<{ day: string; holiday: Holiday | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const edit = can(me, 'people', 'full') || can(me, 'time', 'full');
  const byDay = useMemo(() => {
    const m = new Map<string, Holiday[]>();
    for (const h of detail.data?.holidays ?? []) {
      const a = m.get(h.day) ?? [];
      a.push(h);
      m.set(h.day, a);
    }
    return m;
  }, [detail.data]);
  if (cals === null) return <Loading />;
  const seeded = cal !== null && cal.seeded_years.includes(String(year));
  const holidays = detail.data?.holidays ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Panel label={t('settings.calendars')} aside={edit ? <IconButton icon={Plus} label={t('cal.add')} size={26} onClick={() => setAdding(true)} /> : undefined} flush>
        {cals.length === 0 ? (
          <Empty icon={CalendarDays} title={t('cal.none')} className="py-6" />
        ) : (
          <ul className="flex flex-col px-1.5 pb-1.5">
            {cals.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={c.id === cal?.id} onClick={() => setQuery({ calendar: c.id })} className={cn('group hr-focus flex w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 py-1.5 text-left transition-colors', c.id === cal?.id ? 'bg-[var(--hr-active)]' : 'hover:bg-[var(--hr-hover)]')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    <span className="hr-mono block truncate text-[12px] text-[var(--hr-muted)]">{c.code}</span>
                  </span>
                  <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">{c.holidays_this_year ?? 0}</span>
                  <RowCue />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {cal !== null && (
        <Panel
          label={`${cal.name} · ${year}`}
          aside={
            <span className="flex items-center gap-1">
              {cal.country !== '' && !seeded && edit && (
                <Button size="sm" icon={Download} onClick={() => void op('calendars.seed', { calendar: cal.id, years: [String(year)] }).then(() => (changed('holidays', 'holiday_calendars'), toast.success(t('cal.seeded', { year })))).catch(() => undefined)}>
                  {t('cal.seed', { year })}
                </Button>
              )}
              <IconButton icon={ChevronLeft} label={t('cal.prev_year')} size={28} onClick={() => setQuery({ year: year - 1 })} />
              <span className="hr-mono hr-num w-10 text-center text-[12px]">{year}</span>
              <IconButton icon={ChevronRight} label={t('cal.next_year')} size={28} onClick={() => setQuery({ year: year + 1 })} />
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {(['public', 'company', 'optional', 'observed'] as const).map((k) => (
              <span key={k} className="hr-label flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-[2px]', KIND_CLS[k])} />
                {t(`cal.kind.${k}`)}
              </span>
            ))}
            <span className="flex-1" />
            <span className="hr-label">{tn('cal.n_holidays', holidays.length)}</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => (
              <Month key={i} year={year} month={i + 1} holidays={byDay} onDay={(d) => edit && setPick({ day: d, holiday: byDay.get(d)?.[0] ?? null })} />
            ))}
          </div>
          {holidays.length > 0 && (
            <ul className="mt-4 flex flex-col border-t border-[var(--hr-hair)] pt-3">
              {holidays.map((h) => (
                <li key={h.id} className={cn('grid items-center gap-2 py-1', edit ? 'grid-cols-[88px_minmax(0,1fr)_56px_auto]' : 'grid-cols-[88px_minmax(0,1fr)_56px]')}>
                  <span className="hr-mono hr-num text-[12px] text-[var(--hr-ink-2)]">{fmtDay(h.day)}</span>
                  <span className="hr-wrap min-w-0 text-[13px]">{h.name}</span>
                  <span>{h.half && <Tag>{t('cal.half_short')}</Tag>}</span>
                  {edit && <LinkButton onClick={() => setPick({ day: h.day, holiday: h })}>{t('ui.edit')}</LinkButton>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {pick !== null && cal !== null && <HolidayDialog day={pick.day} holiday={pick.holiday} calendar={cal.id} onClose={() => setPick(null)} />}
      <AddCalendar open={adding} onClose={(id) => (setAdding(false), id !== undefined && setQuery({ calendar: id }))} calendars={cals} />
    </div>
  );
}

/* -------------------------------------------------------------- schedules */

interface DayRule {
  dow: number;
  start: string;
  end: string;
  break_min: number;
}

interface Schedule {
  id: string;
  name: string;
  entity: string;
  week: DayRule[];
  hours_per_week: number;
  flexible: boolean;
  grace_min: number;
  night_from: string;
  night_to: string;
  archived: boolean;
}

function minutesOf(r: DayRule): number {
  const [a, b] = [r.start, r.end].map((x) => {
    const [h, m] = x.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  });
  let d = (b ?? 0) - (a ?? 0);
  if (d < 0) d += 1440;
  return Math.max(0, d - r.break_min);
}

const DOWS = [1, 2, 3, 4, 5, 6, 0];

function ScheduleDialog({ open, schedule, onClose }: { open: boolean; schedule: Schedule | null; onClose: () => void }): React.JSX.Element | null {
  const me = useMe();
  const [name, setName] = useState('');
  const [week, setWeek] = useState<Record<number, DayRule | null>>({});
  const [flexible, setFlexible] = useState(false);
  const [grace, setGrace] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? '');
    const w: Record<number, DayRule | null> = {};
    for (const d of DOWS) w[d] = schedule !== null ? (schedule.week.find((x) => x.dow === d) ?? null) : d >= 1 && d <= 5 ? { dow: d, start: '09:00', end: '18:00', break_min: 60 } : null;
    setWeek(w);
    setFlexible(schedule?.flexible ?? false);
    setGrace(String(schedule?.grace_min ?? 5));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id]);
  if (!open) return null;
  const rules = DOWS.map((d) => week[d]).filter((x): x is DayRule => x !== null && x !== undefined);
  const hours = rules.reduce((a, r) => a + minutesOf(r), 0) / 60;
  const okTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const ok = name.trim() !== '' && rules.every((r) => okTime(r.start) && okTime(r.end));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const params = { name: name.trim(), week: rules, flexible, grace_min: Number(grace) || 0 };
    try {
      if (schedule === null) await op('schedules.add', { ...params, entity: me.entities[0]?.id }, { quiet: true });
      else await op('schedules.update', { schedule: schedule.id, ...params }, { quiet: true });
      changed('work_schedules');
      toast.success(t('ui.saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (d: number, patch: Partial<DayRule>): void => setWeek((w) => ({ ...w, [d]: { ...(w[d] ?? { dow: d, start: '09:00', end: '18:00', break_min: 60 }), ...patch } }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={schedule === null ? t('sched.add') : schedule.name}
      meta={t('sched.hours', { n: hours.toFixed(hours % 1 === 0 ? 0 : 1) })}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('sched.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('sched.name_ph')} aria-label={t('sched.name')} />
        </Field>
        <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
          <div className="hr-label grid grid-cols-[88px_44px_1fr_1fr_76px] items-center gap-2 border-b border-[var(--hr-hair)] px-3 py-1.5">
            <span>{t('sched.day')}</span>
            <span />
            <span>{t('sched.start')}</span>
            <span>{t('sched.end')}</span>
            <span>{t('sched.break')}</span>
          </div>
          {DOWS.map((d) => {
            const r = week[d] ?? null;
            const label = weekday(`2026-11-${String(1 + d).padStart(2, '0')}`, 'long');
            return (
              <div key={d} className="grid grid-cols-[88px_44px_1fr_1fr_76px] items-center gap-2 border-b border-[var(--hr-hair)] px-3 py-1.5 last:border-b-0">
                <span className={cn('text-[13px]', r === null && 'text-[var(--hr-muted)]')}>{label}</span>
                <Toggle checked={r !== null} onChange={(v) => setWeek((w) => ({ ...w, [d]: v ? { dow: d, start: '09:00', end: '18:00', break_min: 60 } : null }))} label={label} />
                {r !== null ? (
                  <>
                    <Input value={r.start} onChange={(e) => set(d, { start: e.target.value })} className="hr-mono" aria-label={`${label} ${t('sched.start')}`} aria-invalid={!okTime(r.start)} />
                    <Input value={r.end} onChange={(e) => set(d, { end: e.target.value })} className="hr-mono" aria-label={`${label} ${t('sched.end')}`} aria-invalid={!okTime(r.end)} />
                    <Input value={String(r.break_min)} onChange={(e) => set(d, { break_min: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="hr-mono" inputMode="numeric" aria-label={`${label} ${t('sched.break')}`} />
                  </>
                ) : (
                  <span className="col-span-3 text-[12px] text-[var(--hr-muted)]">{t('sched.off')}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-3 py-2">
            <span className="text-[13px]">{t('sched.flexible')}</span>
            <Toggle checked={flexible} onChange={setFlexible} label={t('sched.flexible')} />
          </div>
          <Field label={t('sched.grace')} help={t('sched.grace_help')}>
            <Input value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ''))} className="hr-mono" inputMode="numeric" aria-label={t('sched.grace')} />
          </Field>
        </div>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function SchedulesSection(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ schedules: Schedule[] }>('schedules.list', {}, ['work_schedules'], { name: 'settings.schedules' });
  const [edit, setEdit] = useState<Schedule | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = can(me, 'people', 'full') || can(me, 'time', 'full');
  const list = live.data?.schedules ?? null;
  const remove = async (s: Schedule): Promise<void> => {
    const ok = await confirmAsk(t('org.delete_text', { name: s.name }), t('sched.delete'), t('ui.remove'));
    if (!ok) return;
    try {
      await op('schedules.delete', { schedule: s.id });
      changed('work_schedules');
    } catch {
      /* toast shown */
    }
  };
  return (
    <Panel label={t('settings.schedules')} aside={editable ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('sched.add')}</Button> : undefined} flush>
      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={Clock} title={t('sched.none')} action={editable ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('sched.add')}</Button> : undefined} />
      ) : (
        // The rows' text sits on the panel's 14px content edge (6 + 8) and the hours readout ends on it, under the
        // header's button; the hover-only remove sits before the readout so it never pushes it off the edge.
        <ul className="flex flex-col px-1.5 pb-1.5">
          {list.map((s) => (
            <li key={s.id} onClick={(e) => editable && (e.target as HTMLElement).closest('button') === null && setEdit(s)} className={cn('group flex items-center gap-2 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] pr-2 last:border-b-0', editable && 'cursor-pointer hover:bg-[var(--hr-hover)]')}>
              <button type="button" disabled={!editable} onClick={() => setEdit(s)} className="hr-focus hr-tap flex min-w-0 flex-1 items-center gap-3 rounded-[var(--hr-radius-sm)] px-2 py-2 text-left disabled:cursor-default">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{s.name}</span>
                  <span className="flex gap-1 pt-1">
                    {DOWS.map((d) => {
                      const r = s.week.find((x) => x.dow === d);
                      return (
                        <span key={d} title={r !== undefined ? `${r.start} to ${r.end}` : t('sched.off')} className={cn('hr-mono flex h-5 w-7 items-center justify-center rounded-[3px] text-[10.5px]', r !== undefined ? 'bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'bg-[var(--hr-sunk)] text-[var(--hr-faint)]')}>
                          {weekday(`2026-11-${String(1 + d).padStart(2, '0')}`, 'narrow')}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </button>
              {editable && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={28} onClick={() => void remove(s)} onRow className="hover-only opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />}
              {s.flexible && <Tag>{t('sched.flexible_short')}</Tag>}
              <span className="hr-num shrink-0 whitespace-nowrap text-right text-[12px] text-[var(--hr-ink-2)]">{t('sched.hours', { n: s.hours_per_week })}</span>
              {editable && <RowCue edit />}
            </li>
          ))}
        </ul>
      )}
      <ScheduleDialog open={adding} schedule={null} onClose={() => setAdding(false)} />
      <ScheduleDialog open={edit !== null} schedule={edit} onClose={() => setEdit(null)} />
    </Panel>
  );
}

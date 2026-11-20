/**
 * The employee's clock: one big button that says what happens next (Clock
 * in, Start break, End break, Clock out), today's shift, the hours so far,
 * today's punches as a quiet timeline and this week's shifts. The location
 * is read only at the moment of a punch, and only where the place has an
 * area to check; a punch outside it is flagged, never refused.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarClock, Coffee, Home, LogIn, LogOut, MapPin, Play, Timer, Wrench } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, LoadError, Loading, PageBody, PageHeader, Panel, RowCue, Segmented, Tag, toast } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps, PrimaryAction } from '../../lib/contract.ts';
import { fmtDay, ms, weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, changed, reshape, tempId, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { KioskPinRow } from './KioskPin.tsx';
import { FixDayDialog, OvertimeDialog, RemoteDialog } from './RequestDialogs.tsx';
import type { ClockStatus, MyDay, Punch, PunchKind } from './types.ts';
import { deviceKind, flagLabel, hm, locate, nowTime, punchLabel, READS, span } from './util.ts';

const ICON: Record<PunchKind, LucideIcon> = { in: LogIn, out: LogOut, break_start: Coffee, break_end: Play };

const AFTER: Record<PunchKind, ClockStatus['state']> = { in: 'in', break_end: 'in', break_start: 'break', out: 'out' };
const NEXT: Record<ClockStatus['state'], PunchKind[]> = { in: ['out', 'break_start'], break: ['break_end', 'out'], out: ['in'] };
/** The clock views that show the person's own state (they all take the optimistic punch). */
const CLOCK_VIEWS = ['time.clock.status', 'time.clock.status.page'];
let queue: Promise<unknown> = Promise.resolve();

/** "HH:MM" now in the person's zone (from the offset the clock status was answered with). */
function zoneTime(s: ClockStatus): string {
  const at = ms(s.now);
  const local = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));
  const d0 = new Date(at);
  let off = local - (d0.getUTCHours() * 60 + d0.getUTCMinutes());
  if (off > 840) off -= 1440;
  if (off < -720) off += 1440;
  const n = new Date(Date.now() + off * 60000);
  return String(n.getUTCHours()).padStart(2, '0') + ':' + String(n.getUTCMinutes()).padStart(2, '0');
}

/**
 * Punch now. The clock shows the new state at once (Clocked in since now);
 * the location snapshot (only where the place checks one) and the server
 * answer follow, then a toast offers Undo for a wrong tap. A second tap while
 * the first is still being saved (Clock in, then Clock out) waits its turn.
 */
export function punchNow(s: ClockStatus, kind: PunchKind): Promise<boolean> {
  const at = ms(s.now) > 0 && /^\d\d:\d\d$/.test(s.time) ? zoneTime(s) : nowTime();
  const state = AFTER[kind];
  const draft: Punch = { id: tempId(), employment: s.employment.id, at: new Date().toISOString(), day: s.today, time: at, kind, source: deviceKind(), location: '', flagged: false, flags: [], note: '', voided: false, void_reason: '', distance_m: 0 };
  const shown = (d: unknown): unknown => {
    const c = d as ClockStatus;
    if (c === null || typeof c !== 'object' || c.employment?.id !== s.employment.id) return d;
    return { ...c, state, since: draft.at, since_time: at, next: NEXT[state], punches: [...(c.punches ?? []), draft] };
  };
  const before = queue;
  // Shown at once; sent after any punch still being saved.
  const mine = act(
    CLOCK_VIEWS.map((v) => reshape(v, shown)),
    async () => {
      await before;
      const where = s.ask_location ? await locate() : null;
      return op<{ punch: Punch; repeated: boolean; status: ClockStatus }>('clock.punch', { kind, employment: s.employment.id, source: deviceKind(), lat: where?.lat, lng: where?.lng, accuracy_m: where?.accuracy_m });
    },
    READS.clock,
  );
  queue = mine.catch(() => null);
  return mine.then((r) => {
    if (r === null) return false;
    const msg = t('time.clock.done.' + kind, { time: r.punch.time });
    const undo = r.repeated ? undefined : { label: t('time.clock.undo'), run: () => void act([], () => op('clock.undo', { punch: r.punch.id }), READS.clock).then((x) => x !== null && toast.info(t('time.clock.undone'))) };
    if (r.punch.flagged) toast.info(msg + ' ' + t('time.clock.flagged_note'), undo);
    else toast.success(msg, undo);
    return true;
  });
}

/** The sidebar's strong action for employees: Clock in, End break or Clock out, right there. */
export function useClockAction(): PrimaryAction | null {
  const me = useMe();
  const live = useOp<ClockStatus>('clock.status', {}, READS.clock, { skip: me.employee === null, name: 'time.clock.status' });
  const s = live.data;
  if (me.employee === null || s === null) return me.employee === null ? null : { label: t('time.punch.in'), icon: LogIn, to: '/time/clock' };
  const kind = s.next[0] ?? 'in';
  // Answered at once: the card and the sidebar show the new state while the punch is saved.
  return { label: punchLabel(kind), icon: ICON[kind], run: () => void punchNow(s, kind).then(() => changed(...READS.clock)) };
}

function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
  return n;
}

export function ClockPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const [employment, setEmployment] = useState(query.get('employment') ?? '');
  const live = useOp<ClockStatus>('clock.status', { employment: employment === '' ? undefined : employment }, READS.clock, { skip: me.employee === null, name: 'time.clock.status.page' });
  const s = live.data;
  if (me.employee === null)
    return (
      <>
        <PageHeader title={t('time.clock.title')} />
        <PageBody>
          <Empty icon={Timer} title={t('time.clock.no_employee')}>
            {t('time.clock.no_employee_text')}
          </Empty>
        </PageBody>
      </>
    );
  if (s === null)
    return (
      <>
        <PageHeader title={t('time.clock.title')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const meta = [fmtDay(s.today, { weekday: true }), s.location?.name ?? '', s.plan.start !== '' ? span(s.plan.start, s.plan.end) : ''].filter((x) => x !== '').join(' · ');
  return (
    <>
      <PageHeader title={t('time.clock.title')} meta={meta}>
        {s.employments.length > 1 && (
          <Segmented value={s.employment.id} onChange={setEmployment} label={t('time.clock.employment')} size="sm" options={s.employments.map((e) => ({ value: e.id, label: e.entity_name }))} />
        )}
      </PageHeader>
      <PageBody className="max-w-[1040px]">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <ClockPanel s={s} className="lg:col-span-7" />
          <PunchesPanel s={s} className="lg:col-span-5" />
          <WeekPanel today={s.today} className="lg:col-span-7" />
          <FixPanel today={s.today} className="lg:col-span-5" />
        </div>
      </PageBody>
    </>
  );
}

function planText(s: ClockStatus): string {
  const p = s.plan;
  if (p.leave !== null && p.leave !== undefined) return t('time.clock.on_leave', { name: p.leave.name || p.leave.type }) + (p.leave.half !== '' ? ' ' + t('time.clock.half') : '');
  if (p.kind === 'holiday' && p.source !== 'shift') return t('time.clock.holiday', { name: p.holiday?.name ?? '' });
  if (p.kind === 'rest') return t('time.clock.day_off');
  if (p.source === 'shift') return t('time.clock.shift', { name: p.shift_name, span: span(p.start, p.end) });
  if (p.start !== '') return t('time.clock.hours', { span: span(p.start, p.end) });
  return t('time.clock.no_plan');
}

function ClockPanel({ s, className }: { s: ClockStatus; className?: string }): React.JSX.Element {
  useTick(30000);
  const main = s.next[0] ?? 'in';
  const other = s.next[1];
  // Hours so far keep counting while clocked in (the server value plus the time since it answered).
  const since = Date.parse(s.now);
  const running = s.state === 'in' ? Math.max(0, Math.round((Date.now() - since) / 60000)) : 0;
  const worked = s.worked_min + running;
  const go = (k: PunchKind): void => {
    void punchNow(s, k);
  };
  const tone = s.state === 'in' ? 'text-[var(--hr-good)]' : s.state === 'break' ? 'text-[var(--hr-warn)]' : 'text-[var(--hr-muted)]';
  const Icon = ICON[main];
  return (
    <Panel index="01" label={t('time.clock.today')} className={className} aside={s.ask_location ? <Tag tone="faint" title={t('time.clock.location_tip')}><MapPin size={10} className="mr-1" aria-hidden />{t('time.clock.location_tag')}</Tag> : undefined}>
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className={cn('hr-label', tone)}>
              {s.state === 'out' && s.since_time !== '' ? t('time.clock.state.done', { time: s.since_time }) : t('time.clock.state.' + s.state)}
              {s.since_time !== '' && s.state !== 'out' ? ' · ' + t('time.clock.since', { time: s.since_time }) : ''}
            </div>
            <div className="hr-mono hr-num mt-1 text-[26px] font-light leading-none">{hm(worked)}</div>
            <div className="mt-1 text-[13px] text-[var(--hr-muted)]">{planText(s)}</div>
          </div>
          {s.plan.expected_min > 0 && <Meter worked={worked} expected={s.plan.expected_min} />}
        </div>
        <button
          type="button"
          onClick={() => go(main)}
          className="hr-focus flex h-20 w-full items-center justify-center gap-3 rounded-[var(--hr-radius)] bg-[var(--hr-ink)] text-[15px] font-semibold text-[var(--hr-on-ink)] transition-[filter] hover:brightness-[1.3] disabled:opacity-60 dark:hover:brightness-[0.86]"
        >
          <Icon size={22} strokeWidth={1.9} aria-hidden />
          {punchLabel(main)}
        </button>
        {other !== undefined && (
          <Button size="lg" icon={ICON[other]} onClick={() => go(other)} className="w-full">
            {punchLabel(other)}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Worked against planned, as a thin bar with the planned mark. */
function Meter({ worked, expected }: { worked: number; expected: number }): React.JSX.Element {
  const max = Math.max(expected, worked) * 1.1;
  const w = Math.min(100, (worked / max) * 100);
  const e = (expected / max) * 100;
  return (
    <div className="w-40 shrink-0" aria-label={t('time.clock.of_planned', { worked: hm(worked), planned: hm(expected) })}>
      <div className="relative h-1.5 rounded-full bg-[var(--hr-sunk)]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--hr-rh)] transition-[width] duration-200" style={{ width: `${w}%` }} />
        <div className="absolute -top-1 h-3.5 w-px bg-[var(--hr-ink-2)]" style={{ left: `${e}%` }} />
      </div>
      <div className="hr-label mt-1.5 flex justify-between">
        <span>{t('time.clock.worked')}</span>
        <span className="hr-num">{hm(expected)}</span>
      </div>
    </div>
  );
}

function PunchesPanel({ s, className }: { s: ClockStatus; className?: string }): React.JSX.Element {
  const list = s.punches;
  return (
    <Panel index="02" label={t('time.clock.punches')} className={className}>
      {list.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--hr-muted)]">{t('time.clock.no_punches')}</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-[var(--hr-line)] py-1">
          {list.map((p) => {
            const Icon = ICON[p.kind];
            return (
              <li key={p.id} className={cn('relative flex items-start gap-3 py-1.5 pl-4', p.voided && 'opacity-50')}>
                <span aria-hidden className={cn('absolute -left-[4.5px] top-[11px] size-2 rounded-full border', p.kind === 'in' ? 'border-[var(--hr-good)] bg-[var(--hr-good)]' : p.kind === 'out' ? 'border-[var(--hr-ink-2)] bg-[var(--hr-panel)]' : 'border-[var(--hr-warn)] bg-[var(--hr-panel)]')} />
                <span className="hr-mono hr-num w-11 shrink-0 pt-px text-[13px]">{p.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <Icon size={13} aria-hidden className="text-[var(--hr-muted)]" />
                    <span className={cn(p.voided && 'line-through')}>{punchLabel(p.kind)}</span>
                  </span>
                  <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
                    {t('time.source.' + p.source)}
                    {p.note !== '' ? ' · ' + p.note : ''}
                    {p.voided ? ' · ' + t('time.clock.voided') : ''}
                  </span>
                </span>
                {p.flags.includes('outside_geofence') && <Tag tone="warn">{flagLabel('outside_geofence')}</Tag>}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function WeekPanel({ today, className }: { today: string; className?: string }): React.JSX.Element {
  const live = useOp<{ days: MyDay[] }>('shifts.mine', {}, READS.week, { name: 'time.clock.week' });
  const days = (live.data?.days ?? []).slice(0, 7);
  return (
    <Panel index="03" label={t('time.clock.week')} className={className} aside={<Button size="sm" variant="ghost" icon={CalendarClock} onClick={() => navigate('/time/schedule')}>{t('time.clock.full_schedule')}</Button>}>
      {live.data === null ? (
        <Loading />
      ) : (
        <ul className="grid grid-cols-7 gap-1.5">
          {days.map((d) => (
            <li key={d.day} className={cn('flex min-w-0 flex-col items-center gap-1 rounded-[var(--hr-radius-sm)] border px-1 py-2 text-center', d.day === today ? 'border-[var(--hr-ink-2)] bg-[var(--hr-raised)]' : 'border-[var(--hr-hair)] bg-[var(--hr-sunk)]')}>
              <span className="hr-label">{weekday(d.day)}</span>
              <span className="hr-mono hr-num text-[12px]">{d.day.slice(8)}</span>
              <span className={cn(d.leave === null && d.holiday === '' && d.source !== 'shift' && d.kind === 'work' ? 'hr-mono hr-num whitespace-nowrap text-[10.5px] leading-4' : 'hr-wrap text-[12px] leading-4', d.kind === 'work' || d.source === 'shift' ? 'text-[var(--hr-ink)]' : 'text-[var(--hr-muted)]')}>
                {d.leave !== null ? t('time.week.leave') : d.holiday !== '' ? (
                  <>
                    <span className="sm:hidden">{t('time.week.holiday_short')}</span>
                    <span className="hidden sm:inline">{t('time.week.holiday')}</span>
                  </>
                ) : d.source === 'shift' ? d.shift_code || d.shift_name : d.kind === 'work' ? d.start : t('time.week.off')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FixPanel({ today, className }: { today: string; className?: string }): React.JSX.Element {
  const [open, setOpen] = useState<'' | 'fix' | 'remote' | 'ot'>('');
  return (
    <Panel index="04" label={t('time.clock.something_off')} className={className}>
      <div className="flex flex-col gap-1.5 pt-1">
        <Row icon={Wrench} label={t('time.clock.fix_day')} onClick={() => setOpen('fix')} />
        <Row icon={Home} label={t('time.clock.work_home')} onClick={() => setOpen('remote')} />
        <Row icon={Timer} label={t('time.clock.ask_overtime')} onClick={() => setOpen('ot')} />
        <KioskPinRow />
      </div>
      <FixDayDialog open={open === 'fix'} onClose={() => setOpen('')} today={today} />
      <RemoteDialog open={open === 'remote'} onClose={() => setOpen('')} today={today} />
      <OvertimeDialog open={open === 'ot'} onClose={() => setOpen('')} today={today} />
    </Panel>
  );
}

function Row({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="group hr-focus flex h-10 w-full items-center gap-2.5 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] transition-colors hover:bg-[var(--hr-hover)]">
      <Icon size={15} aria-hidden className="text-[var(--hr-muted)]" />
      <span className="flex-1">{label}</span>
      <RowCue />
    </button>
  );
}

/**
 * The Time tab of an employee's profile: this month as a calendar (a day
 * opens its punches), the schedule for the next two weeks, and the last
 * week's punches.
 */
import { Loading, Panel, Tag } from '../../components/ui.tsx';
import type { ProfileTabProps } from '../../lib/contract.ts';
import { addDays, fmtDay, today as todayIn, weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { MonthCalendar } from './Attendance.tsx';
import type { MyDay, Punch } from './types.ts';
import { flagLabel, punchLabel, READS, span } from './util.ts';

export function TimeTab({ employment, entity }: ProfileTabProps): React.JSX.Element {
  const sched = useOp<{ days: MyDay[] }>('shifts.of', { employment }, READS.week, { name: 'time.tab.sched' });
  const punches = useOp<{ punches: Punch[] }>('checkins.list', { employment }, READS.clock, { name: 'time.tab.punches' });
  const today = todayIn({ entity });
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('time.tab.month')} className="lg:col-span-7">
        <MonthCalendar employment={employment} month="" />
      </Panel>
      <div className="flex flex-col gap-3 lg:col-span-5">
        <Panel index="02" label={t('time.tab.schedule')}>
          {sched.data === null ? (
            <Loading />
          ) : sched.data.days.length === 0 ? (
            <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('time.tab.no_schedule')}</p>
          ) : (
            <ul className="flex flex-col">
              {sched.data.days.slice(0, 14).map((d) => (
                <li key={d.day} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-1.5 text-[13px] last:border-b-0">
                  <span className="hr-label w-8">{weekday(d.day)}</span>
                  <span className="hr-mono hr-num w-14">{fmtDay(d.day)}</span>
                  <span className="min-w-0 flex-1">{d.leave !== null ? <span className="text-[var(--hr-lh)]">{d.leave.name || d.leave.type}</span> : d.holiday !== '' ? <span className="text-[var(--hr-muted)]">{d.holiday}</span> : d.kind === 'rest' && d.source !== 'shift' ? <span className="text-[var(--hr-muted)]">{t('time.week.off')}</span> : (d.source === 'shift' ? d.shift_name + ' ' : '') + span(d.start, d.end)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel index="03" label={t('time.tab.punches')}>
          {punches.data === null ? (
            <Loading />
          ) : punches.data.punches.length === 0 ? (
            <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('time.tab.no_punches', { from: fmtDay(addDays(today, -6)) })}</p>
          ) : (
            <ul className="flex flex-col">
              {[...punches.data.punches].reverse().slice(0, 20).map((p) => (
                <li key={p.id} className="grid grid-cols-[56px_44px_minmax(0,1fr)_80px_minmax(0,auto)] items-center gap-2 border-b border-[var(--hr-hair)] py-1.5 text-[13px] last:border-b-0">
                  <span className="hr-mono hr-num">{fmtDay(p.day)}</span>
                  <span className="hr-mono hr-num">{p.time}</span>
                  <span className={p.voided ? 'min-w-0 truncate line-through opacity-50' : 'min-w-0 truncate'}>{punchLabel(p.kind)}</span>
                  <span className="truncate text-[12px] text-[var(--hr-muted)]">{t('time.source.' + p.source)}</span>
                  <span>{p.flagged && <Tag tone="warn">{flagLabel('outside_geofence')}</Tag>}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}


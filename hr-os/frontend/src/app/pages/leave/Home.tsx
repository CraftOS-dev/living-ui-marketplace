/**
 * Leave home. HR (leave access) opens on what needs them: who is out today
 * and this week, requests waiting for a decision, balances that need
 * attention (the Japanese five-day rule, days about to expire, balances
 * below zero), and entities whose leave is not set up yet. Managers and
 * employees see their own leave there, managers with their team's week on top.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CalendarPlus, Check, Hourglass, Inbox, Sparkle, Users } from 'lucide-react';
import { Button, Empty, LoadError, Loading, Notice, PageBody, PageHeader, Panel, PersonChip, Picker, RowCue, Skeleton, StatTile, StatusDot, Tag, toast } from '../../components/ui.tsx';
import { TypeMark } from '../../components/leave/LeaveIcon.tsx';
import { op } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, fmtDay, fmtRange, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { usePickPerson } from './Balances.tsx';
import { amount, READS, STATUS_TONE, statusLabel, whenText } from './data.ts';
import { LeaveOverview, MyLeavePage } from './Mine.tsx';
import { RequestSheet } from './Request.tsx';
import type { RequestTarget } from './Request.tsx';
import type { Attention, Home, LeaveRequest, Mine } from './types.ts';

function OutRow({ r, today }: { r: LeaveRequest; today: string }): React.JSX.Element {
  const body = (
    <>
      {r.away_only === true ? <span aria-hidden className="size-[26px] shrink-0 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]" /> : <TypeMark icon={r.icon} size={26} />}
      <span className="min-w-0 flex-1">
        <span className="hr-wrap block text-[13px] font-medium leading-5">{r.name}</span>
        <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{r.away_only === true ? t('leave.away') : r.type_name} · {r.end > today ? t('leave.back_on', { day: fmtDay(addDays(r.end, 1)) }) : whenText(r)}</span>
      </span>
      {r.status !== 'approved' && <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
    </>
  );
  return (
    <li className="border-t border-[var(--hr-hair)] first:border-t-0">
      {r.away_only === true ? <div className="flex min-h-11 items-center gap-3 px-3.5 py-2">{body}</div> : <a href={`#/leave/requests/${r.id}`} className="hr-focus flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-[var(--hr-hover)]">{body}</a>}
    </li>
  );
}

/** Seven columns: how many are out each day of the coming week, with their names. */
function WeekStrip({ from, bars }: { from: string; bars: LeaveRequest[] }): React.JSX.Element {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const out = bars.filter((b) => b.start <= d && b.end >= d && (b.day_list === undefined || b.day_list.some((x) => x.day === d)));
        return (
          <div key={d} className="flex min-w-0 flex-col gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)] p-1.5">
            <span className="hr-label">{weekday(d, 'short')}</span>
            <span className="hr-mono hr-num text-[15px] leading-none">{out.length}</span>
            <span className="hr-wrap hidden text-[12px] leading-4 text-[var(--hr-muted)] md:block">
              {out.slice(0, 3).map((b) => b.name.split(' ')[0]).join(', ')}
              {out.length > 3 ? ` +${out.length - 3}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SetupNotice({ setup }: { setup: Home['setup'] }): React.JSX.Element | null {
  const [busy, setBusy] = useState('');
  if (setup.length === 0) return null;
  const run = async (entity: string, name: string): Promise<void> => {
    setBusy(entity);
    try {
      const r = await op<{ types_added: number; assigned: number }>('leave.seed-defaults', { entity });
      changed(...READS);
      toast.success(t('leave.setup.done', { name, n: r.types_added, people: r.assigned }));
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {setup.map((s) => (
        <Notice key={s.entity} tone="warn" action={<Button size="sm" variant="primary" busy={busy === s.entity} onClick={() => void run(s.entity, s.name)}>{t('leave.setup.action')}</Button>}>
          {t('leave.setup.text', { name: s.name, country: s.country })}
        </Notice>
      ))}
    </div>
  );
}

function AttentionPanel({ index }: { index: string }): React.JSX.Element {
  const { entity } = useUi();
  const live = useOp<Attention>('leave.attention', { entity: entity === '' ? undefined : entity }, READS, { name: 'leave.attention' });
  const a = live.data?.attention;
  const n = a === undefined ? 0 : a.obligation.length + a.expiring.length + a.negative.length;
  const SHOW = 100;
  const ob = a === undefined ? [] : a.obligation.slice(0, SHOW);
  const neg = a === undefined ? [] : a.negative.slice(0, SHOW - ob.length);
  const exp = a === undefined ? [] : a.expiring.slice(0, SHOW - ob.length - neg.length);
  return (
    <Panel index={index} label={t('leave.home.attention')} aside={n > 0 ? <Tag tone="warn">{n}</Tag> : undefined} flush>
      {live.error !== null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : a === undefined ? (
        <div className="flex flex-col gap-2 px-3.5 py-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : n === 0 ? (
        <div className="flex items-center gap-2 px-3.5 py-4 text-[13px] text-[var(--hr-muted)]">
          <Check size={14} aria-hidden className="text-[var(--hr-good)]" />
          {t('leave.home.all_clear')}
        </div>
      ) : (
        <ul className="hr-scroll max-h-[360px] overflow-y-auto">
          {ob.map((o) => (
            <li key={`o${o.employment}${o.base}`} className="border-t border-[var(--hr-hair)] first:border-t-0">
              <a href="#/leave/register" className="group hr-focus flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-[var(--hr-hover)]">
                <AlertTriangle size={15} aria-hidden className={o.status === 'missed' ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-warn)]'} />
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium leading-5">{o.name}</span>
                  <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{o.status === 'missed' ? t('leave.five.missed', { n: o.short, day: fmtDay(o.deadline, { year: 'always' }) }) : t('leave.five.short', { n: o.short, day: fmtDay(o.deadline, { year: 'always' }) })}</span>
                </span>
                <Tag tone={o.status === 'missed' ? 'bad' : 'warn'}>{t('leave.five.tag')}</Tag>
                <RowCue />
              </a>
            </li>
          ))}
          {neg.map((x) => (
            <li key={`n${x.employment}${x.type}`} className="border-t border-[var(--hr-hair)] first:border-t-0">
              <a href={`#/leave/balances?open=${x.employment}:${x.type}`} className="group hr-focus flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-[var(--hr-hover)]">
                <AlertTriangle size={15} aria-hidden className="text-[var(--hr-bad)]" />
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium leading-5">{x.name}</span>
                  <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{t('leave.home.negative', { n: amount(x.balance, x.unit), type: x.type_name })}</span>
                </span>
                <RowCue />
              </a>
            </li>
          ))}
          {exp.map((x) => (
            <li key={`x${x.employment}${x.type}${x.day}`} className="border-t border-[var(--hr-hair)] first:border-t-0">
              <a href={`#/leave/balances?open=${x.employment}:${x.type}`} className="group hr-focus flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-[var(--hr-hover)]">
                <Hourglass size={15} aria-hidden className="text-[var(--hr-warn)]" />
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium leading-5">{x.name}</span>
                  <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{t('leave.home.expiring', { n: amount(x.amount, x.unit), type: x.type_name, day: fmtDay(x.day) })}</span>
                </span>
                <RowCue />
              </a>
            </li>
          ))}
        </ul>
      )}
      {n > SHOW && (
        <a href="#/leave/balances" className="group hr-focus flex min-h-10 items-center border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px] text-[var(--hr-ink-2)] transition-colors hover:bg-[var(--hr-hover)]">
          {t('leave.home.more_n', { n: n - SHOW })}
          <RowCue />
        </a>
      )}
    </Panel>
  );
}

function RecordFor({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const { entity } = useUi();
  const people = usePickPerson(entity);
  const [emp, setEmp] = useState('');
  const pick = people.items.find((x) => x.value === emp);
  const mine = useOp<Mine>('leave.mine', { employment: emp }, READS, { skip: emp === '', name: 'leave.mine.for' });
  const target: RequestTarget | null = mine.data !== null && mine.data.employment !== null && emp !== '' ? { employment: mine.data.employment, number: mine.data.person.number, name: mine.data.person.name, self: false } : null;
  if (target !== null && mine.data !== null) return <RequestSheet open onClose={onClose} target={target} types={mine.data.types} />;
  return (
    <div className="hr-panel hr-in flex flex-wrap items-center gap-2 p-3">
      <span className="text-[13px] font-medium">{t('leave.home.for_whom')}</span>
      <Picker value={emp} onChange={(v) => setEmp(v)} items={people.items} label={t('leave.col.person')} placeholder={t('leave.home.pick_person')} className="w-full sm:w-[280px]" />
      {pick !== undefined && mine.loading && <span className="text-[12px] text-[var(--hr-muted)]">{t('ui.loading')}</span>}
      <Button variant="ghost" onClick={onClose}>
        {t('ui.cancel')}
      </Button>
    </div>
  );
}

function HrHome(): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const live = useOp<Home>('leave.home', { entity: entity === '' ? undefined : entity }, READS, { name: 'leave.home' });
  const [recording, setRecording] = useState(false);
  const d = live.data;
  const entName = me.entities.find((e) => e.id === entity)?.name ?? t('leave.all_entities');
  const weekBars = useMemo(() => (d === null ? [] : d.out_week.filter((b) => b.status !== 'pending')), [d]);
  return (
    <>
      <PageHeader title={t('leave.title')} meta={[entName, d !== null ? tn('leave.people_count', d.people) : ''].filter((x) => x !== '').join(' · ')}>
        <Button variant="ghost" icon={CalendarDays} onClick={() => navigate('/leave/calendar')}>
          {t('leave.calendar.title')}
        </Button>
        {me.employee !== null && (
          <Button variant="ghost" onClick={() => navigate('/leave/me')}>
            {t('leave.my')}
          </Button>
        )}
        {can(me, 'leave', 'edit') && (
          <Button variant="primary" icon={CalendarPlus} onClick={() => setRecording(true)}>
            {t('leave.home.record')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : d === null ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-3">
            <SetupNotice setup={d.setup} />
            {recording && <RecordFor onClose={() => setRecording(false)} />}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile index="01.1" label={t('leave.home.out_today')} value={d.out_today.length} />
              <StatTile index="01.2" label={t('leave.home.out_week')} value={new Set(weekBars.map((b) => b.employment)).size} onClick={() => navigate('/leave/calendar')} />
              <StatTile index="01.3" label={t('leave.home.waiting')} value={d.waiting_total + d.waiting_other.encash + d.waiting_other.comp_off} tone={d.waiting_total > 0 ? 'warn' : undefined} onClick={() => navigate('/leave/requests', { status: 'pending' })} />
              <StatTile index="01.4" label={t('leave.home.people')} value={d.people} onClick={() => navigate('/leave/balances')} />
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <Panel index="02" label={t('leave.home.today', { day: fmtDay(d.today, { weekday: true }) })} className="lg:col-span-5" flush>
                {d.out_today.length === 0 ? (
                  <div className="flex items-center gap-2 px-3.5 py-4 text-[13px] text-[var(--hr-muted)]">
                    <Users size={14} aria-hidden />
                    {t('leave.home.everyone_in')}
                  </div>
                ) : (
                  <ul className="hr-scroll max-h-[320px] overflow-y-auto">
                    {d.out_today.map((r) => (
                      <OutRow key={r.id} r={r} today={d.today} />
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel index="03" label={t('leave.home.week', { range: fmtRange(d.today, d.week_end) })} className="lg:col-span-7">
                <WeekStrip from={d.today} bars={weekBars} />
              </Panel>
              <Panel index="04" label={t('leave.home.decide')} className="lg:col-span-7" aside={d.waiting_total > 0 ? <a href="#/inbox" className="hr-label hr-focus hit rounded-[3px] hover:text-[var(--hr-ink)]">{t('leave.home.open_inbox')}</a> : undefined} flush>
                {d.waiting.length === 0 ? (
                  <div className="flex items-center gap-2 px-3.5 py-4 text-[13px] text-[var(--hr-muted)]">
                    <Check size={14} aria-hidden className="text-[var(--hr-good)]" />
                    {t('leave.home.nothing_waiting')}
                  </div>
                ) : (
                  <ul className="hr-scroll max-h-[360px] overflow-y-auto">
                    {d.waiting.map((r) => (
                      <li key={r.id} className="border-t border-[var(--hr-hair)] first:border-t-0">
                        <a href={`#/leave/requests/${r.id}`} className="group hr-focus flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-[var(--hr-hover)]">
                          <TypeMark icon={r.icon} size={26} />
                          <span className="min-w-0 flex-1">
                            <span className="hr-wrap block text-[13px] font-medium leading-5">{r.name}</span>
                            <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
                              {r.type_name} · {whenText(r)} · {amount(r.amount, r.unit)}
                            </span>
                          </span>
                          {r.actor === 'agent' && <Sparkle size={13} aria-label={t('ui.agent_short')} />}
                          <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />
                          <RowCue />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {d.waiting_other.encash + d.waiting_other.comp_off > 0 && (
                  <a href="#/inbox" className="group hr-focus flex min-h-10 items-center gap-2 border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px] text-[var(--hr-ink-2)] transition-colors hover:bg-[var(--hr-hover)]">
                    <Inbox size={13} aria-hidden />
                    {t('leave.home.other_waiting', { encash: d.waiting_other.encash, comp: d.waiting_other.comp_off })}
                    <RowCue />
                  </a>
                )}
              </Panel>
              <div className="lg:col-span-5">
                <AttentionPanel index="05" />
              </div>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** A manager's team this week, above their own leave. */
function TeamStrip(): React.JSX.Element | null {
  const live = useOp<Home>('leave.home', {}, READS, { name: 'leave.home.team' });
  const d = live.data;
  if (d === null || d.mode !== 'team') return null;
  const bars = d.out_week.filter((b) => b.status !== 'pending');
  return (
    <Panel index="01" label={t('leave.home.team_week')} aside={d.waiting_total > 0 ? <a href="#/inbox" className="hr-label hr-focus hit rounded-[3px] hover:text-[var(--hr-ink)]">{tn('leave.home.team_waiting', d.waiting_total)}</a> : undefined}>
      <WeekStrip from={d.today} bars={bars} />
      {d.out_today.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--hr-muted)]">
          <span className="hr-label">{t('leave.home.out_today')}</span>
          {d.out_today.map((r) => (
            <PersonChip key={r.id} name={r.name} size={18} strong={false} />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function LeaveHomePage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  if (can(me, 'leave', 'view')) return <HrHome />;
  if (isManager(me))
    return (
      <>
        <PageHeader title={t('leave.my')} meta={me.employee?.name ?? ''}>
          <Button variant="ghost" icon={CalendarDays} onClick={() => navigate('/leave/calendar')}>
            {t('leave.calendar.team')}
          </Button>
        </PageHeader>
        <PageBody>
          <div className="flex flex-col gap-3">
            <TeamStrip />
            {me.employee === null ? <Empty icon={CalendarDays} title={t('leave.no_employment')}>{t('leave.not_linked')}</Empty> : <LeaveOverview self first={2} />}
          </div>
        </PageBody>
      </>
    );
  return <MyLeavePage />;
}

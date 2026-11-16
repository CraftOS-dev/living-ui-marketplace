/**
 * One person's leave: a big readout per balance, "Request time off" as the
 * one action, what is coming up and waiting (withdraw or cancel in one
 * tap), the Japanese five-day rule when it applies, and the history. The
 * employee sees it at /leave; HR and managers see the same on the profile.
 */
import { useState } from 'react';
import { CalendarDays, CalendarPlus, Clock, HandCoins, MoreHorizontal, Undo2, X } from 'lucide-react';
import { Button, Empty, LoadError, Loading, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, Segmented, StatusDot, Tag, confirmAsk, toast } from '../../components/ui.tsx';
import { TypeMark } from '../../components/leave/LeaveIcon.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import { fmtDay, relDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { BalanceSheet, BalanceTiles } from './Balances.tsx';
import { amount, READS, STATUS_TONE, statusLabel, whenText } from './data.ts';
import { CompOffDialog, EncashDialog, RequestSheet } from './Request.tsx';
import type { RequestTarget } from './Request.tsx';
import type { LeaveRequest, Mine } from './types.ts';

export function useMine(employment: string | undefined): Live<Mine> {
  return useOp<Mine>('leave.mine', { employment }, READS, { name: 'leave.mine' });
}

function RequestRow({ r, today, canAct }: { r: LeaveRequest; today: string; canAct: boolean }): React.JSX.Element {
  const started = r.start <= today;
  const withdraw = (): void => {
    void act([patch(r.id, { status: 'withdrawn' })], () => op('leave.withdraw', { request: r.id }), READS).then((x) => x !== null && toast.success(t('leave.withdrawn')));
  };
  const cancel = async (from?: string): Promise<void> => {
    const ok = await confirmAsk(started ? t('leave.cancel_started_text') : t('leave.cancel_text', { when: whenText(r) }), from !== undefined ? t('leave.back_early') : t('leave.cancel'), t('leave.cancel_ok'));
    if (!ok) return;
    const res = await act([patch(r.id, { status: started ? 'cancelling' : 'cancelled' })], () => op<{ cancelled: boolean }>('leave.cancel', { request: r.id, from }), READS);
    if (res !== null) toast.success(res.cancelled ? t('leave.cancelled_done') : t('leave.cancel_sent'));
  };
  return (
    <li className="flex min-h-11 items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5 first:border-t-0">
      <TypeMark icon={r.icon} size={26} />
      <a href={`#/leave/requests/${r.id}`} className="hr-focus min-w-0 flex-1 rounded-[3px]">
        <span className="hr-wrap block text-[13px] font-medium leading-5">{whenText(r)}</span>
        <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
          {r.type_name} · {amount(r.amount, r.unit)}
          {r.start >= today ? ` · ${relDay(r.start, today)}` : ''}
        </span>
      </a>
      <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} className="hidden sm:inline-flex" />
      {canAct && r.status === 'pending' && <Button size="sm" variant="ghost" icon={X} onClick={withdraw}>{t('leave.withdraw')}</Button>}
      {canAct && r.status === 'approved' && r.end >= today && (
        <Menu icon={MoreHorizontal} label={t('leave.more')} width={220}>
          {(close) => (
            <>
              <MenuItem icon={X} onClick={() => { close(); void cancel(); }}>{t('leave.cancel')}</MenuItem>
              {started && r.end > today && <MenuItem icon={Undo2} onClick={() => { close(); void cancel(today); }}>{t('leave.back_early')}</MenuItem>}
            </>
          )}
        </Menu>
      )}
    </li>
  );
}

/** The person's leave, for themself (My leave) or on a profile tab. */
export function LeaveOverview({ employment, self, compact, first = 1 }: { employment?: string | undefined; self: boolean; compact?: boolean | undefined; first?: number | undefined }): React.JSX.Element {
  const me = useMe();
  const [pick, setPick] = useState(employment);
  const live = useMine(pick ?? employment);
  const [requesting, setRequesting] = useState<{ type?: string | undefined } | null>(null);
  const [encash, setEncash] = useState(false);
  const [comp, setComp] = useState(false);
  const [sheet, setSheet] = useState('');
  const d = live.data;
  if (live.error !== null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (d === null) return <Loading />;
  if (d.employment === null) return <Empty icon={CalendarDays} title={t('leave.no_employment')}>{d.reason}</Empty>;
  const canAct = d.access === 'self' || d.access === 'team' || d.access === 'edit' || d.access === 'full';
  const target: RequestTarget = { employment: d.employment, number: d.person.number, name: d.person.name, self };
  const requestable = d.types.filter((x) => !x.archived);
  const untracked = d.types.filter((x) => x.tracked !== true);
  const encashable = d.types.some((x) => x.encashable && x.tracked === true);
  const compType = d.types.find((x) => x.comp_off);
  const pendingOther = [...d.encash.filter((e) => e.status === 'pending'), ...d.comp_offs.filter((c) => c.status === 'pending')];
  const idx = (k: number): string => String(first + k).padStart(2, '0');
  return (
    <div className="flex flex-col gap-3">
      {d.employments.length > 1 && self && (
        <Segmented value={d.employment} onChange={setPick} label={t('leave.employment')} options={d.employments.map((e) => ({ value: e.id, label: e.entity_name }))} />
      )}
      {canAct && (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="lg" icon={CalendarPlus} onClick={() => setRequesting({})} className="min-w-0 flex-1 sm:flex-none">
            {self ? t('leave.request') : t('leave.request_for', { name: d.person.name })}
          </Button>
          {(encashable || compType !== undefined) && (
            <Menu icon={MoreHorizontal} label={t('leave.more')} width={240}>
              {(close) => (
                <>
                  {encashable && <MenuItem icon={HandCoins} onClick={() => { close(); setEncash(true); }}>{t('leave.encash.title')}</MenuItem>}
                  {compType !== undefined && <MenuItem icon={Clock} onClick={() => { close(); setComp(true); }}>{t('leave.comp.title')}</MenuItem>}
                </>
              )}
            </Menu>
          )}
        </div>
      )}
      {d.obligation.filter((o) => o.status !== 'done').map((o) => (
        <Notice key={o.base} tone={o.status === 'missed' || o.status === 'at_risk' ? 'warn' : 'neutral'}>
          {o.status === 'missed' ? t('leave.five.missed_self', { n: o.short, day: fmtDay(o.deadline, { year: 'always' }) }) : t('leave.five.self', { n: o.short, day: fmtDay(o.deadline, { year: 'always' }), taken: o.taken + o.planned })}
        </Notice>
      ))}
      <BalanceTiles index={idx(0)} balances={d.balances} onOpen={(b) => setSheet(b.type)} />
      {untracked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
          <span className="hr-label mr-1">{t('leave.also')}</span>
          {untracked.map((x) => (
            <button key={x.id} type="button" disabled={!canAct} onClick={() => setRequesting({ type: x.code })} className="hr-focus hit inline-flex h-7 items-center gap-1.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-2 text-[12px] text-[var(--hr-ink-2)] transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)] disabled:cursor-default">
              <TypeMark icon={x.icon} size={16} className="!border-0" />
              {x.name}
            </button>
          ))}
        </div>
      )}
      <div className={compact === true ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 gap-3 lg:grid-cols-2'}>
        <Panel index={idx(1)} label={t('leave.coming_up')} flush>
          {d.upcoming.length === 0 && pendingOther.length === 0 ? (
            <Empty icon={CalendarDays} title={t('leave.nothing_planned')} className="py-6" action={canAct ? <Button icon={CalendarPlus} onClick={() => setRequesting({})}>{t('leave.request')}</Button> : undefined} />
          ) : (
            <ul>
              {d.upcoming.map((r) => (
                <RequestRow key={r.id} r={r} today={d.today} canAct={canAct} />
              ))}
              {d.encash.filter((e) => e.status === 'pending').map((e) => (
                <li key={e.id} className="flex min-h-11 items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5 first:border-t-0">
                  <HandCoins size={16} aria-hidden className="text-[var(--hr-muted)]" />
                  <span className="min-w-0 flex-1 text-[13px]">{t('leave.encash.row', { n: amount(e.days, 'day'), type: e.type_name })}</span>
                  <StatusDot tone="warn" label={statusLabel('pending')} />
                </li>
              ))}
              {d.comp_offs.filter((c) => c.status === 'pending').map((c) => (
                <li key={c.id} className="flex min-h-11 items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5 first:border-t-0">
                  <Clock size={16} aria-hidden className="text-[var(--hr-muted)]" />
                  <span className="min-w-0 flex-1 text-[13px]">{t('leave.comp.row', { n: amount(c.days, 'day'), day: fmtDay(c.worked_day) })}</span>
                  <StatusDot tone="warn" label={statusLabel('pending')} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel index={idx(2)} label={t('leave.history')} flush>
          {d.history.length === 0 ? (
            <p className="px-3.5 py-4 text-[13px] text-[var(--hr-muted)]">{t('leave.no_history')}</p>
          ) : (
            <ul className="hr-scroll max-h-[420px] overflow-y-auto">
              {d.history.map((r) => (
                <RequestRow key={r.id} r={r} today={d.today} canAct={false} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {d.start_day > d.today && <Tag tone="rh">{t('leave.starts_on', { day: fmtDay(d.start_day, { year: 'always' }) })}</Tag>}
      {requesting !== null && <RequestSheet open onClose={() => setRequesting(null)} target={target} types={requestable} initialType={requesting.type} />}
      {encash && <EncashDialog open onClose={() => setEncash(false)} target={target} types={d.types} />}
      {comp && <CompOffDialog open onClose={() => setComp(false)} target={target} />}
      {sheet !== '' && <BalanceSheet employment={d.employment} type={sheet} onClose={() => setSheet('')} canAdjust={!self && (d.access === 'edit' || d.access === 'full') && me.actor === 'person'} />}
    </div>
  );
}

export function MyLeavePage(): React.JSX.Element {
  const me = useMe();
  const live = useMine(undefined);
  const d = live.data;
  const meta = d !== null && d.employment !== null ? [d.entity.name, d.person.name].join(' · ') : '';
  return (
    <>
      <PageHeader title={t('leave.my')} meta={meta}>
        <Button variant="ghost" icon={CalendarDays} onClick={() => navigate('/leave/calendar')}>
          {t('leave.calendar.title')}
        </Button>
      </PageHeader>
      <PageBody>{me.employee === null ? <Empty icon={CalendarDays} title={t('leave.no_employment')}>{t('leave.not_linked')}</Empty> : <LeaveOverview self />}</PageBody>
    </>
  );
}

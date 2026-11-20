/**
 * Time requests: the person's own (fix a day, work from home or on duty,
 * overtime, shift changes and swaps) with where each one stands and a way
 * to take back one not decided yet; managers and HR also see their team's.
 * Decisions happen in the Inbox.
 */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Home, Inbox, Repeat, Timer, Wrench, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, LoadError, Loading, PageBody, PageHeader, Panel, StatusDot, Tabs, toast } from '../../components/ui.tsx';
import type { Tone } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { OpName } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { FixDayDialog, OvertimeDialog, RemoteDialog, ShiftChangeDialog, SwapDialog } from './RequestDialogs.tsx';
import type { AttRequest, OtRequest, ShiftRequest } from './types.ts';
import { hm, READS, seesOthers } from './util.ts';

interface Item {
  id: string;
  what: string;
  sub: string;
  who: string;
  status: string;
  created: string;
  cancel: OpName | null;
}

const TONE: Record<string, Tone> = { pending: 'warn', awaiting_peer: 'warn', approved: 'good', rejected: 'bad', declined: 'bad', cancelled: 'faint' };

export function RequestsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const team = seesOthers(me);
  const view = (query.get('view') as 'mine' | 'team' | null) ?? (me.employee !== null ? 'mine' : 'team');
  const [dlg, setDlg] = useState<'' | 'fix' | 'remote' | 'ot' | 'shift' | 'swap'>('');
  const p = { view, status: 'all' };
  const ar = useOp<{ requests: AttRequest[] }>('attendance-requests.list', p, READS.requests, { name: 'time.req.att.' + view });
  const sr = useOp<{ requests: ShiftRequest[] }>('shift-requests.list', p, READS.requests, { name: 'time.req.shift.' + view });
  const orq = useOp<{ requests: OtRequest[] }>('overtime-requests.list', p, READS.requests, { name: 'time.req.ot.' + view });
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const r of ar.data?.requests ?? [])
      out.push({ id: r.id, what: r.kind_label, sub: (r.from_day === r.to_day ? fmtDay(r.from_day, { weekday: true }) : fmtRange(r.from_day, r.to_day)) + (r.in_time !== '' ? ' · ' + t('time.req.in') + ' ' + r.in_time : '') + (r.out_time !== '' ? ' · ' + t('time.req.out') + ' ' + r.out_time : '') + (r.reason !== '' ? ' · ' + r.reason : ''), who: r.name, status: r.status, created: r.created, cancel: r.status === 'pending' ? 'attendance-requests.cancel' : null });
    for (const r of sr.data?.requests ?? [])
      out.push({ id: r.id, what: r.kind === 'swap' ? t('time.req.swap_kind') : t('time.req.shift_kind'), sub: r.kind === 'swap' ? t('time.sched.swap_with', { name: r.swap_name, day: fmtDay(r.from_day) }) : t('time.sched.change_to', { name: r.shift_name || t('time.week.off'), days: fmtRange(r.from_day, r.to_day) }), who: r.name, status: r.status, created: r.created, cancel: r.status === 'pending' || r.status === 'awaiting_peer' ? 'shift-requests.cancel' : null });
    for (const r of orq.data?.requests ?? [])
      out.push({ id: r.id, what: t('time.req.overtime_kind'), sub: fmtDay(r.day, { weekday: true }) + ' · ' + hm(r.minutes) + (r.reason !== '' ? ' · ' + r.reason : ''), who: r.name, status: r.status, created: r.created, cancel: r.status === 'pending' ? 'overtime-requests.cancel' : null });
    return out.sort((a, b) => (a.created < b.created ? 1 : -1));
  }, [ar.data, sr.data, orq.data]);
  const loading = ar.data === null || sr.data === null || orq.data === null;
  const error = ar.error ?? sr.error ?? orq.error;
  const cancel = (it: Item): void => {
    if (it.cancel === null) return;
    const name = it.cancel;
    void act([patch(it.id, { status: 'cancelled' })], () => op(name, { request: it.id }), READS.requests).then((r) => r !== null && toast.success(t('time.req.cancelled')));
  };
  const entity = me.employee?.employments[0]?.entity ?? '';
  const open = items.filter((i) => i.status === 'pending' || i.status === 'awaiting_peer');
  const done = items.filter((i) => !(i.status === 'pending' || i.status === 'awaiting_peer'));
  return (
    <>
      <PageHeader title={t('time.req.title')}>
        {team && (
          <Button icon={Inbox} onClick={() => navigate('/inbox', { view: 'approvals' })}>
            {t('time.req.to_decide')}
          </Button>
        )}
      </PageHeader>
      <PageBody className="max-w-[920px]">
        {team && me.employee !== null && (
          <Tabs
            value={view}
            onChange={(v) => setQuery({ view: v === 'mine' ? undefined : v })}
            label={t('time.req.title')}
            tabs={[
              { value: 'mine', label: t('time.req.mine') },
              { value: 'team', label: t('time.req.team') },
            ]}
            className="mb-3"
          />
        )}
        {view === 'mine' && me.employee !== null && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Ask icon={Wrench} label={t('time.clock.fix_day')} onClick={() => setDlg('fix')} />
            <Ask icon={Home} label={t('time.clock.work_home')} onClick={() => setDlg('remote')} />
            <Ask icon={Timer} label={t('time.clock.ask_overtime')} onClick={() => setDlg('ot')} />
            <Ask icon={Repeat} label={t('time.sched.ask_change')} onClick={() => setDlg('shift')} />
            <Ask icon={ArrowLeftRight} label={t('time.sched.swap')} onClick={() => setDlg('swap')} />
          </div>
        )}
        {loading ? (
          error !== null ? (
            <LoadError message={error} />
          ) : (
            <Loading />
          )
        ) : items.length === 0 ? (
          <Empty icon={Inbox} title={view === 'mine' ? t('time.req.none_mine') : t('time.req.none_team')} />
        ) : (
          <div className="flex flex-col gap-3">
            {open.length > 0 && <List index="01" label={t('time.req.open')} items={open} team={view === 'team'} onCancel={view === 'mine' ? cancel : undefined} />}
            {done.length > 0 && <List index={open.length > 0 ? '02' : '01'} label={t('time.req.decided')} items={done} team={view === 'team'} />}
          </div>
        )}
      </PageBody>
      <FixDayDialog open={dlg === 'fix'} onClose={() => setDlg('')} today={me.today} />
      <RemoteDialog open={dlg === 'remote'} onClose={() => setDlg('')} today={me.today} />
      <OvertimeDialog open={dlg === 'ot'} onClose={() => setDlg('')} today={me.today} />
      <ShiftChangeDialog open={dlg === 'shift'} onClose={() => setDlg('')} today={me.today} entity={entity} />
      <SwapDialog open={dlg === 'swap'} onClose={() => setDlg('')} today={me.today} />
    </>
  );
}

function Ask({ icon: Icon, label, onClick }: { icon: typeof Wrench; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="hr-panel hr-focus flex h-16 flex-col items-start justify-between px-3 py-2 text-left transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]">
      <Icon size={15} aria-hidden className="text-[var(--hr-muted)]" />
      <span className="text-[13px] font-medium leading-4">{label}</span>
    </button>
  );
}

function List({ index, label, items, team, onCancel }: { index: string; label: string; items: Item[]; team: boolean; onCancel?: ((i: Item) => void) | undefined }): React.JSX.Element {
  return (
    <Panel index={index} label={label} flush>
      <ul>
        {items.map((it) => (
          <li key={it.id} className={cn('grid items-center gap-3 border-t border-[var(--hr-hair)] px-4 py-2.5', onCancel !== undefined ? 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_112px_112px]' : 'grid-cols-[minmax(0,1fr)_112px]')}>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">
                {it.what}
                {team && it.who !== '' ? <span className="font-normal text-[var(--hr-muted)]"> · {it.who}</span> : null}
              </div>
              <div className="hr-wrap text-[12px] text-[var(--hr-muted)]">{it.sub}</div>
            </div>
            <StatusDot tone={TONE[it.status] ?? 'faint'} label={t('time.req.status.' + it.status)} />
            {onCancel !== undefined && (
              <span className="col-span-full flex justify-end sm:col-span-1">
                {it.cancel !== null && (
                  <Button size="sm" variant="ghost" icon={X} onClick={() => onCancel(it)}>
                    {t('time.req.take_back')}
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

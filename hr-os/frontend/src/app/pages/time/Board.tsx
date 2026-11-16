/**
 * Attendance today (HR and managers): readouts of who is in, late, absent,
 * on leave or remote, the same by location or team, then everyone as dense
 * rows (late and absent first). A readout filters the rows; a row opens the
 * person's day to fix a punch in place.
 */
import { useMemo, useState } from 'react';
import { Clock, Flag, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, DayPicker, Empty, LoadError, Loading, PageBody, PageHeader, Panel, PersonChip, Segmented, StatTile, StatusDot, Tag } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { DaySheet } from './DaySheet.tsx';
import type { Board, BoardRow, Readouts } from './types.ts';
import { flagLabel, hm, READS, span, stateLabel, STATE_TONE } from './util.ts';

type Filter = '' | 'in' | 'late' | 'absent' | 'on_leave' | 'remote' | 'out';

function matches(r: BoardRow, f: Filter): boolean {
  if (f === '') return true;
  if (f === 'late') return r.state === 'late' || r.late_min > 0;
  if (f === 'remote') return r.state === 'remote' || r.state === 'on_duty';
  if (f === 'out') return r.state === 'out' || (r.state === 'untracked' && r.shift_over);
  if (f === 'in') return r.state === 'in' || r.state === 'break';
  return r.state === f;
}

export function BoardPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const day = query.get('day') ?? '';
  const filter = (query.get('state') as Filter | null) ?? '';
  const [group, setGroup] = useState<'location' | 'department'>('location');
  const [open, setOpen] = useState<BoardRow | null>(null);
  const live = useOp<Board>('attendance.board', { day: day === '' ? undefined : day, entity: entity === '' ? undefined : entity }, READS.board, { name: 'time.board' });
  const b = live.data;
  const rows = useMemo(() => (b?.people ?? []).filter((r) => matches(r, filter)), [b, filter]);
  const ent = me.entities.find((e) => e.id === entity);

  const columns: Column<BoardRow>[] = useMemo(
    () => [
      { key: 'name', label: t('time.col.person'), width: 'minmax(200px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <PersonChip name={r.name} sub={r.title} size={24} /> },
      { key: 'state', label: t('time.col.state'), width: '128px', sort: (r) => r.state, phone: 'end', render: (r) => <StatusDot tone={STATE_TONE[r.state]} label={(r.state === 'untracked' && r.shift_over ? t('time.state.over') : stateLabel(r.state)) + (r.state === 'late' && r.late_min > 0 ? ' ' + hm(r.late_min) : '')} /> },
      { key: 'shift', label: t('time.col.shift'), width: '140px', render: (r) => (r.holiday !== '' ? <span className="text-[var(--hr-muted)]">{r.holiday}</span> : r.leave !== null ? <span className="text-[var(--hr-lh)]">{r.leave.name || r.leave.type}</span> : r.shift !== null ? <span className="hr-mono hr-num text-[12px]">{span(r.shift.start, r.shift.end)}</span> : <span className="text-[var(--hr-muted)]">{t('time.week.off')}</span>) },
      { key: 'in', label: t('time.col.in'), width: '72px', mono: true, align: 'right', sort: (r) => r.first_in_time, render: (r) => r.first_in_time || '' },
      { key: 'out', label: t('time.col.out'), width: '72px', mono: true, align: 'right', sort: (r) => r.last_out_time, hideBelow: 'lg', render: (r) => r.last_out_time || '' },
      { key: 'late', label: t('time.col.late'), width: '72px', mono: true, align: 'right', sort: (r) => r.late_min, hideBelow: 'lg', render: (r) => (r.late_min > 0 && r.state !== 'late' ? <span className="text-[var(--hr-bad)]">{hm(r.late_min)}</span> : '') },
      { key: 'location', label: t('time.col.location'), width: 'minmax(110px,1fr)', sort: (r) => r.location_name, hideBelow: 'xl', render: (r) => r.location_name },
      { key: 'department', label: t('time.col.department'), width: 'minmax(110px,1fr)', sort: (r) => r.department_name, hideBelow: 'xl', render: (r) => r.department_name },
      { key: 'flags', label: '', width: '96px', phone: 'hide', render: (r) => (r.flagged ? <Tag tone="warn">{flagLabel('outside_geofence')}</Tag> : r.flags.some((f) => f.startsWith('missed')) ? <Tag tone="bad">{flagLabel('missed_out')}</Tag> : r.tracking === 'exception' && r.state === 'untracked' ? <Tag tone="faint">{t('time.board.no_clock')}</Tag> : null) },
    ],
    [],
  );

  const meta = [ent?.name ?? t('shell.all_entities_short'), b !== null ? tn('time.board.people', b.people.length) : '', b !== null ? fmtDay(b.day, { weekday: true }) : ''].filter((x) => x !== '').join(' · ');
  return (
    <>
      <PageHeader title={b !== null && !b.is_today ? t('time.board.title_day') : t('time.board.title')} meta={meta}>
        <DayPicker value={day === '' ? (b?.today ?? '') : day} onChange={(d) => setQuery({ day: d === b?.today ? undefined : d })} label={t('time.board.day')} className="hidden w-[150px] sm:block" />
        {me.employee !== null && (
          <Button icon={Clock} onClick={() => navigate('/time/clock')} aria-label={t('time.board.my_clock')} title={t('time.board.my_clock')}>
            <span className="hidden sm:inline">{t('time.board.my_clock')}</span>
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {b === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : b.people.length === 0 ? (
          <Empty icon={Users} title={t('time.board.empty')} action={can(me, 'people', 'full') ? <Button variant="primary" onClick={() => navigate('/people/new')}>{t('time.board.add_people')}</Button> : undefined}>
            {t('time.board.empty_text')}
          </Empty>
        ) : (
          <>
            <Readout r={b.readouts} filter={filter} live={b.is_today} />
            <div className="mt-3 flex flex-col gap-3">
              <Panel
                index="02"
                label={group === 'location' ? t('time.board.by_location') : t('time.board.by_team')}
                aside={
                  <Segmented
                    value={group}
                    onChange={setGroup}
                    label={t('time.board.group')}
                    size="sm"
                    options={[
                      { value: 'location', label: t('time.board.location') },
                      { value: 'department', label: t('time.board.team') },
                    ]}
                  />
                }
              >
                <Groups list={group === 'location' ? b.by_location : b.by_department} />
              </Panel>
              <div className="hr-panel hr-in min-w-0">
                <div className="flex h-9 items-center gap-2 border-b border-[var(--hr-line)] px-3.5">
                  <span className="hr-label !text-[var(--hr-faint)]">03</span>
                  <span className="hr-label flex-1">{filter === '' ? t('time.board.everyone') : t('time.board.only', { what: t('time.readout.' + filter) })}</span>
                  {filter !== '' && (
                    <Button size="sm" variant="ghost" onClick={() => setQuery({ state: undefined })}>
                      {t('ui.clear_filters')}
                    </Button>
                  )}
                </div>
                <DataTable label={t('time.board.everyone')} columns={columns} rows={rows} rowKey={(r) => r.employment} onRowClick={setOpen} empty={<Empty icon={Flag} title={t('time.board.none_in_filter')} />} />
              </div>
            </div>
          </>
        )}
      </PageBody>
      <DaySheet employment={open?.employment ?? ''} day={open !== null ? b?.day ?? '' : ''} onClose={() => setOpen(null)} />
    </>
  );
}

function Readout({ r, filter, live }: { r: Readouts; filter: Filter; live: boolean }): React.JSX.Element {
  const tiles: { key: Filter; value: number; tone: 'good' | 'bad' | 'lh' | 'rh' | 'neutral'; sub?: string | undefined }[] = [
    { key: 'in', value: r.in, tone: 'good', sub: r.break > 0 ? t('time.board.on_break', { n: r.break }) : r.untracked > 0 ? t('time.board.no_clock_n', { n: r.untracked }) : undefined },
    { key: 'late', value: r.late, tone: r.late > 0 ? 'bad' : 'neutral' },
    { key: 'absent', value: r.absent, tone: r.absent > 0 ? 'bad' : 'neutral', sub: live && r.expected > 0 ? t('time.board.expected', { n: r.expected }) : undefined },
    { key: 'on_leave', value: r.on_leave, tone: 'lh' },
    { key: 'remote', value: r.remote, tone: 'rh' },
    { key: 'out', value: r.out, tone: 'neutral', sub: r.over > 0 ? t('time.board.over_n', { n: r.over }) : r.off > 0 ? t('time.board.off_n', { n: r.off }) : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((x, i) => (
        <StatTile key={x.key} index={'0' + (i + 1)} label={t('time.readout.' + x.key)} value={x.value} sub={x.sub} tone={x.value > 0 ? x.tone : undefined} onClick={() => setQuery({ state: filter === x.key ? undefined : x.key })} className={cn(filter === x.key && '!border-[var(--hr-ink-2)]')} />
      ))}
    </div>
  );
}

function Groups({ list }: { list: Board['by_location'] }): React.JSX.Element {
  if (list.length === 0) return <p className="py-4 text-center text-[13px] text-[var(--hr-muted)]">{t('time.board.no_groups')}</p>;
  return (
    <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
      {list.map((g) => {
        const c = g.counts;
        const total = Math.max(1, g.people);
        const seg = (n: number, color: string): React.JSX.Element | null => (n > 0 ? <span className={color} style={{ width: `${(n / total) * 100}%` }} /> : null);
        return (
          <li key={g.id || 'none'} className="border-t border-[var(--hr-hair)] py-2">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="hr-wrap min-w-0 flex-1">{g.name || t('time.board.unassigned')}</span>
              <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">
                {c.in + c.untracked}/{g.people}
              </span>
            </div>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--hr-sunk)]" aria-hidden>
              {seg(c.in, 'bg-[var(--hr-good)]')}
              {seg(c.untracked, 'bg-[color-mix(in_srgb,var(--hr-good),transparent_60%)]')}
              {seg(c.late, 'bg-[var(--hr-bad)]')}
              {seg(c.absent, 'bg-[color-mix(in_srgb,var(--hr-bad),transparent_45%)]')}
              {seg(c.on_leave, 'bg-[var(--hr-lh)]')}
              {seg(c.remote, 'bg-[var(--hr-rh)]')}
            </div>
            <div className="hr-label mt-1 flex flex-wrap gap-x-3">
              {c.late > 0 && <span className="!text-[var(--hr-bad)]">{t('time.board.late_n', { n: c.late })}</span>}
              {c.absent > 0 && <span className="!text-[var(--hr-bad)]">{t('time.board.absent_n', { n: c.absent })}</span>}
              {c.on_leave > 0 && <span>{t('time.board.leave_n', { n: c.on_leave })}</span>}
              {c.remote > 0 && <span>{t('time.board.remote_n', { n: c.remote })}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}


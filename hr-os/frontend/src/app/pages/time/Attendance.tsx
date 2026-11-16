/**
 * Attendance by month. HR and managers get the grid: one row per person, a
 * code per day (P present, A absent, L leave, H holiday, O day off, R remote,
 * D on duty, HD half day), totals on the right, a day opens the person's
 * day; "Mark many" sets one status for several people at once. One person
 * (an employee, or ?employment=) gets a month calendar with the hours.
 */
import { useMemo, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, Download, ListChecks } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Checkbox, DateRange, Dialog, Empty, Field, IconButton, LoadError, Loading, PageBody, PageHeader, Panel, Segmented, Textarea, toast } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addMonths, dateOf, fmtDay, monthName, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { DaySheet } from './DaySheet.tsx';
import type { AttStatus, Month, MonthCell, MonthRow } from './types.ts';
import { editsTime, hm, hours, READS, seesOthers, statusLabel } from './util.ts';

const CODE_CLASS: Record<string, string> = {
  present: 'text-[var(--hr-ink)]',
  on_duty: 'text-[var(--hr-rh)]',
  remote: 'text-[var(--hr-rh)]',
  absent: 'bg-[var(--hr-bad-soft)] text-[var(--hr-bad)] font-semibold',
  half_day: 'bg-[var(--hr-warn-soft)] text-[var(--hr-warn)]',
  on_leave: 'bg-[var(--hr-lh-soft)] text-[var(--hr-lh)]',
  holiday: 'text-[var(--hr-muted)]',
  weekly_off: 'text-[var(--hr-faint)]',
};

function monthLabel(m: string): string {
  return monthName(Number(m.slice(5, 7)), 'long') + ' ' + m.slice(0, 4);
}

export function AttendancePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const employment = query.get('employment') ?? '';
  const single = employment !== '' || !seesOthers(me);
  return single ? <OnePerson employment={employment} month={query.get('month') ?? ''} /> : <MonthGrid month={query.get('month') ?? ''} />;
}

function MonthNav({ month }: { month: string }): React.JSX.Element {
  return (
    <span className="flex items-center">
      <IconButton icon={ChevronLeft} label={t('time.att.prev')} onClick={() => setQuery({ month: addMonths(month + '-01', -1).slice(0, 7) })} />
      <Button size="sm" variant="ghost" onClick={() => setQuery({ month: undefined })} className="hidden sm:inline-flex">
        {t('time.att.this_month')}
      </Button>
      <IconButton icon={ChevronRight} label={t('time.att.next')} onClick={() => setQuery({ month: addMonths(month + '-01', 1).slice(0, 7) })} />
    </span>
  );
}

function MonthGrid({ month }: { month: string }): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const live = useOp<Month>('attendance.month', { month: month === '' ? undefined : month, entity: entity === '' ? undefined : entity, limit: 300 }, READS.month, { name: 'time.month' });
  const m = live.data;
  const [open, setOpen] = useState<{ employment: string; day: string } | null>(null);
  const [bulk, setBulk] = useState(false);
  const exportCsv = async (): Promise<void> => {
    if (m === null) return;
    try {
      const r = await op<{ csv: string; filename: string }>('attendance.export', { from: m.from, to: m.to, entity: entity === '' ? undefined : entity });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  if (m === null)
    return (
      <>
        <PageHeader title={t('time.att.title')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const cols = `minmax(180px,1.4fr) repeat(${m.days.length}, minmax(${coarse ? 40 : 28}px,1fr)) 64px 52px 64px`;
  return (
    <>
      <PageHeader title={t('time.att.title')} meta={[monthLabel(m.month), tn('time.board.people', m.total)].join(' · ')}>
        <MonthNav month={m.month} />
        {can(me, 'time', 'view') && (
          <Button icon={Download} variant="ghost" onClick={() => void exportCsv()}>
            {t('ui.export')}
          </Button>
        )}
        {editsTime(me) && (
          <Button variant="primary" icon={ListChecks} onClick={() => setBulk(true)} disabled={m.people.length === 0}>
            {t('time.att.mark_many')}
          </Button>
        )}
      </PageHeader>
      <PageBody wide>
        {m.people.length === 0 ? (
          <Empty icon={CalendarCheck} title={t('time.att.empty')} action={can(me, 'people', 'full') ? <Button variant="primary" onClick={() => navigate('/people/new')}>{t('time.board.add_people')}</Button> : undefined}>
            {t('time.att.empty_text')}
          </Empty>
        ) : (
          <div className="hr-panel hr-in min-w-0 overflow-hidden">
            <div className="hr-scroll overflow-x-auto">
              <div className="min-w-[1100px]" role="grid" aria-label={t('time.att.title')}>
                <div className="sticky top-0 grid border-b border-[var(--hr-line)] bg-[var(--hr-panel)]" style={{ gridTemplateColumns: cols }} role="row">
                  <div className="hr-label sticky left-0 z-10 bg-[var(--hr-panel)] px-3 py-2">{t('time.col.person')}</div>
                  {m.days.map((d) => {
                    const wd = dateOf(d).getUTCDay();
                    return (
                      <div key={d} className={cn('flex flex-col items-center py-1', (wd === 0 || wd === 6) && 'bg-[var(--hr-sunk)]', d === me.today && 'bg-[var(--hr-active)]')}>
                        <span className="hr-label">{weekday(d, 'narrow')}</span>
                        <span className="hr-mono hr-num text-[10.5px]">{Number(d.slice(8))}</span>
                      </div>
                    );
                  })}
                  <div className="hr-label py-2 text-right">{t('time.att.worked')}</div>
                  <div className="hr-label py-2 text-right">{t('time.att.late')}</div>
                  <div className="hr-label px-2 py-2 text-right">{t('time.att.absent')}</div>
                </div>
                {m.people.map((p) => (
                  <PersonRow key={p.employment} p={p} days={m.days} cols={cols} today={me.today} onOpen={(day) => setOpen({ employment: p.employment, day })} />
                ))}
              </div>
            </div>
            <Legend />
          </div>
        )}
      </PageBody>
      <DaySheet employment={open?.employment ?? ''} day={open?.day ?? ''} onClose={() => setOpen(null)} />
      <BulkDialog open={bulk} onClose={() => setBulk(false)} rows={m.people} today={me.today} />
    </>
  );
}

function PersonRow({ p, days, cols, today, onOpen }: { p: MonthRow; days: string[]; cols: string; today: string; onOpen: (day: string) => void }): React.JSX.Element {
  return (
    <div className="grid border-b border-[var(--hr-hair)] last:border-b-0" style={{ gridTemplateColumns: cols }} role="row">
      <div className="sticky left-0 z-10 min-w-0 border-r border-[var(--hr-hair)] bg-[var(--hr-panel)] px-3 py-1.5" role="rowheader">
        <div className="hr-wrap truncate text-[13px] font-medium">{p.name}</div>
        <div className="truncate text-[12px] text-[var(--hr-muted)]">{p.title || p.department_name}</div>
      </div>
      {days.map((d) => (
        <DayCode key={d} c={p.cells[d]} future={d > today} onClick={() => onOpen(d)} day={d} label={p.name + ' ' + fmtDay(d, { weekday: true })} />
      ))}
      <span className="hr-mono hr-num self-center text-right text-[12px]">{hours(p.totals.worked_min)}</span>
      <span className={cn('hr-mono hr-num self-center text-right text-[12px]', p.totals.late > 0 && 'text-[var(--hr-bad)]')}>{p.totals.late || ''}</span>
      <span className={cn('hr-mono hr-num self-center px-2 text-right text-[12px]', p.totals.absent > 0 && 'text-[var(--hr-bad)]')}>{p.totals.absent || ''}</span>
    </div>
  );
}

function DayCode({ c, future, onClick, label, day }: { c: MonthCell | undefined; future: boolean; onClick: () => void; label: string; day: string }): React.JSX.Element {
  if (c === undefined || c.status === 'outside') return <span className="bg-[color-mix(in_srgb,var(--hr-sunk),var(--hr-ink)_4%)]" />;
  const code = c.status !== '' ? c.code : c.planned === 'leave' ? 'L' : c.planned === 'holiday' ? 'H' : c.planned === 'off' ? '' : future ? (c.shift_code ?? '') : '';
  const missing = (c.flags ?? []).some((f) => f.startsWith('missed'));
  return (
    <button
      type="button"
      onClick={onClick}
      data-day={day}
      aria-label={label + ': ' + (c.status !== '' ? statusLabel(c.status) : '')}
      title={c.status !== '' ? statusLabel(c.status) + (c.worked_min ? ' · ' + hm(c.worked_min) : '') + (c.late_min ? ' · ' + t('time.att.late_by', { m: hm(c.late_min) }) : '') : ''}
      className={cn(
        'hr-focus hr-mono relative m-[1px] flex h-8 items-center justify-center rounded-[3px] text-[10.5px] transition-colors hover:bg-[var(--hr-hover)] [@media(pointer:coarse)]:h-10',
        c.status !== '' ? CODE_CLASS[c.status] : future ? 'text-[var(--hr-faint)]' : 'text-[var(--hr-faint)]',
        c.status === '' && c.planned === 'leave' && 'text-[var(--hr-lh)]',
      )}
    >
      {code}
      {(c.late_min ?? 0) > 0 && <span aria-hidden className="absolute right-0.5 top-0.5 size-1 rounded-full bg-[var(--hr-bad)]" />}
      {missing && <span aria-hidden className="absolute bottom-0.5 left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full bg-[var(--hr-bad)]" />}
      {c.source === 'manual' && <span aria-hidden className="absolute left-0.5 top-0.5 size-1 rounded-full bg-[var(--hr-ink-2)]" />}
    </button>
  );
}

function Legend(): React.JSX.Element {
  const items: [string, string][] = [
    ['P', t('time.status.present')],
    ['A', t('time.status.absent')],
    ['HD', t('time.status.half_day')],
    ['L', t('time.status.on_leave')],
    ['H', t('time.status.holiday')],
    ['O', t('time.status.weekly_off')],
    ['R', t('time.status.remote')],
    ['D', t('time.status.on_duty')],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--hr-line)] px-3.5 py-2">
      {items.map(([c, l]) => (
        <span key={c} className="flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
          <span className="hr-mono text-[10.5px] text-[var(--hr-ink)]">{c}</span>
          {l}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--hr-bad)]" />
        {t('time.att.legend_late')}
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
        <span className="h-[2px] w-3 rounded-full bg-[var(--hr-bad)]" />
        {t('time.att.legend_missing')}
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--hr-ink-2)]" />
        {t('time.att.legend_manual')}
      </span>
    </div>
  );
}

const BULK: AttStatus[] = ['present', 'absent', 'remote', 'on_duty', 'holiday'];

function BulkDialog({ open, onClose, rows, today }: { open: boolean; onClose: () => void; rows: MonthRow[]; today: string }): React.JSX.Element | null {
  const [who, setWho] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<AttStatus>('present');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const all = who.size === rows.length && rows.length > 0;
  const ok = who.size > 0 && from !== '' && to >= from && note.trim() !== '';
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op<{ marked: number; skipped: unknown[] }>('attendance.mark-bulk', { employments: [...who], from, to, status, note: note.trim() }), READS.month);
    setBusy(false);
    if (r !== null) {
      toast.success(tn('time.att.marked', r.marked));
      onClose();
      setWho(new Set());
      setNote('');
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('time.att.mark_many')}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} busy={busy} onClick={() => void save()}>
            {t('time.att.mark_n', { n: who.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented value={status} onChange={setStatus} label={t('time.day.status')} options={BULK.map((s) => ({ value: s, label: statusLabel(s) }))} />
        <Field label={t('time.req.days')}>
          <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('time.req.days')} />
        </Field>
        <Field label={t('time.sched.pattern_who')}>
          <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
            <div className="border-b border-[var(--hr-line)] px-2.5 py-1.5">
              <Checkbox checked={all} indeterminate={who.size > 0 && !all} onChange={(v) => setWho(v ? new Set(rows.map((r) => r.employment)) : new Set())} label={t('time.att.everyone_n', { n: rows.length })} />
            </div>
            <ul className="hr-scroll max-h-52 overflow-y-auto">
              {rows.map((p) => (
                <li key={p.employment} className="border-b border-[var(--hr-hair)] px-2.5 py-1.5 last:border-b-0">
                  <Checkbox
                    checked={who.has(p.employment)}
                    onChange={(v) =>
                      setWho((s) => {
                        const n = new Set(s);
                        if (v) n.add(p.employment);
                        else n.delete(p.employment);
                        return n;
                      })
                    }
                    label={p.name}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Field>
        <Field label={t('time.day.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} placeholder={t('time.att.bulk_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ one person */

export function MonthCalendar({ employment, month: m0 }: { employment: string; month: string }): React.JSX.Element {
  const me = useMe();
  const [month, setMonth] = useState(m0);
  const live = useOp<Month>('attendance.month', { month: month === '' ? undefined : month, employment: employment === '' ? undefined : employment }, READS.month, { name: 'time.month.one' });
  const [open, setOpen] = useState('');
  const m = live.data;
  const row = m?.people[0] ?? null;
  const weeks = useMemo(() => {
    if (m === null) return [] as (string | null)[][];
    const first = dateOf(m.from).getUTCDay();
    const lead = (first + 6) % 7;
    const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...m.days];
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [m]);
  if (m === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const tot = row?.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{monthLabel(m.month)}</span>
        <span className="flex-1" />
        <IconButton icon={ChevronLeft} label={t('time.att.prev')} onClick={() => setMonth(addMonths(m.month + '-01', -1).slice(0, 7))} />
        <IconButton icon={ChevronRight} label={t('time.att.next')} onClick={() => setMonth(addMonths(m.month + '-01', 1).slice(0, 7))} />
      </div>
      {tot !== undefined && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label={t('time.att.worked')} value={hm(tot.worked_min)} />
          <Mini label={t('time.att.days_present')} value={String(tot.present + tot.remote)} />
          <Mini label={t('time.att.late')} value={String(tot.late)} tone={tot.late > 0 ? 'bad' : undefined} />
          <Mini label={t('time.att.absent')} value={String(tot.absent)} tone={tot.absent > 0 ? 'bad' : undefined} />
        </div>
      )}
      <div className="grid grid-cols-7 gap-1">
        {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => (
          <span key={d} className="hr-label text-center">
            {t('time.dow.' + d)}
          </span>
        ))}
        {weeks.flat().map((d, i) => {
          if (d === null) return <span key={'x' + i} />;
          const c = row?.cells[d];
          const has = c !== undefined && c.status !== '' && c.status !== 'outside';
          return (
            <button key={d} type="button" onClick={() => setOpen(d)} className={cn('hr-focus flex min-h-[54px] flex-col items-start rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] p-1.5 text-left transition-colors hover:bg-[var(--hr-hover)]', d === me.today ? 'border-[var(--hr-ink-2)] bg-[var(--hr-raised)]' : 'bg-[var(--hr-sunk)]')}>
              <span className="hr-mono hr-num text-[10.5px] text-[var(--hr-muted)]">{Number(d.slice(8))}</span>
              {has && c !== undefined && (
                <>
                  <span className={cn('hr-mono mt-auto rounded-[3px] px-1 text-[10.5px]', CODE_CLASS[c.status] ?? '')}>
                    <span className="hr-mono sm:hidden">{c.code}</span>
                    <span className="hidden sm:inline">{statusLabel(c.status)}</span>
                  </span>
                  {(c.worked_min ?? 0) > 0 && <span className="hr-mono hr-num text-[10.5px]">{hours(c.worked_min ?? 0)}<span className="hidden sm:inline">h</span></span>}
                </>
              )}
              {!has && c !== undefined && c.planned === 'leave' && <span className="mt-auto text-[12px] text-[var(--hr-lh)]">{t('time.week.leave')}</span>}
            </button>
          );
        })}
      </div>
      <DaySheet employment={row?.employment ?? ''} day={open} onClose={() => setOpen('')} />
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'bad' | undefined }): React.JSX.Element {
  return (
    <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)] px-2.5 py-2">
      <div className="hr-label">{label}</div>
      <div className={cn('hr-mono hr-num mt-0.5 text-[15px]', tone === 'bad' && 'text-[var(--hr-bad)]')}>{value}</div>
    </div>
  );
}

function OnePerson({ employment, month }: { employment: string; month: string }): React.JSX.Element {
  return (
    <>
      <PageHeader title={t('time.att.my_title')} />
      <PageBody className="max-w-[860px]">
        <Panel index="01" label={t('time.att.month')}>
          <MonthCalendar employment={employment} month={month} />
        </Panel>
      </PageBody>
    </>
  );
}

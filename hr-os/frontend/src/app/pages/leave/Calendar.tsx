/**
 * The wallchart: a month canvas on the measuring grid, people as rows, days
 * as columns. Leave bars take their type's colour (waiting requests are
 * hatched), each person's days off and holidays are shaded from their own
 * schedule and calendar, locked days carry a padlock band. Tap a bar to open
 * the request; tap an empty day on your row (or a report's, or anyone's for
 * HR) to request leave from that day. Managers see their team with the
 * type, colleagues see each other as away, HR filters by entity and department.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, IconButton, LoadError, Loading, PageBody, PageHeader, Picker, SearchInput, Tag } from '../../components/ui.tsx';
import { colorVar, TypeLabel } from '../../components/leave/LeaveIcon.tsx';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, addMonths, dateOf, dayKey, fmtDay, monthName, weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { READS, statusLabel, whenText } from './data.ts';
import { RequestSheet } from './Request.tsx';
import type { CalendarData, CalRow, LeaveRequest, Mine } from './types.ts';

const ROW = 40;

function monthEndOf(m: string): string {
  const d = dateOf(m);
  return dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Column width: at least 30px, stretched to fill the panel on wide screens. */
function useCol(el: HTMLDivElement | null, days: number): { col: number; nameW: number } {
  const [w, setW] = useState(() => window.innerWidth);
  const [box, setBox] = useState(0);
  useEffect(() => {
    const on = (): void => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => {
    if (el === null) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    setBox(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  const nameW = w < 768 ? 124 : 200;
  const fit = box > 0 && days > 0 ? Math.floor((box - nameW - 2) / days) : 0;
  return { col: Math.max(w < 768 ? 30 : 32, Math.min(56, fit)), nameW };
}

function Bar({ b, from, days, col, onOpen }: { b: LeaveRequest; from: string; days: number; col: number; onOpen: (b: LeaveRequest) => void }): React.JSX.Element | null {
  const s = b.start < from ? from : b.start;
  const lastDay = addDays(from, days - 1);
  const e = b.end > lastDay ? lastDay : b.end;
  const i0 = Math.round((dateOf(s).getTime() - dateOf(from).getTime()) / 86400000);
  const i1 = Math.round((dateOf(e).getTime() - dateOf(from).getTime()) / 86400000);
  if (i1 < 0 || i0 >= days) return null;
  const startHalf = b.start === s && b.start_half === 'pm';
  const endHalf = b.end === e && (b.end_half === 'am' || (b.start === b.end && b.start_half === 'am'));
  const left = (i0 + (startHalf ? 0.5 : 0)) * col + 2;
  const width = Math.max(10, (i1 - i0 + 1 - (startHalf ? 0.5 : 0) - (endHalf ? 0.5 : 0)) * col - 4);
  const away = b.away_only === true;
  const pending = b.status === 'pending';
  const label = `${b.name}: ${away ? t('leave.away') : b.type_name}, ${whenText(b)} (${statusLabel(b.status)})`;
  const style: React.CSSProperties = away
    ? { left, width, background: 'var(--hr-active)', borderLeft: '2px solid var(--hr-ink-2)' }
    : { left, width, background: pending ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${colorVar(b.color)}, transparent 72%) 0 5px, var(--hr-raised) 5px 9px)` : `color-mix(in srgb, ${colorVar(b.color)}, var(--hr-raised) 74%)`, borderLeft: `3px solid ${colorVar(b.color)}`, outline: pending || b.status === 'cancelling' ? `1px dashed ${colorVar(b.color)}` : undefined, outlineOffset: -1 };
  const inner = <span className="truncate px-1.5 text-[12px] font-medium leading-none" style={{ color: away ? 'var(--hr-ink-2)' : colorVar(b.color) }}>{width > 64 ? (away ? t('leave.away') : b.type_name) : ''}</span>;
  if (away) return <span title={label} aria-label={label} className="absolute top-[7px] flex h-[26px] items-center overflow-hidden rounded-[4px]" style={style}>{inner}</span>;
  return (
    <button type="button" title={label} aria-label={label} onClick={(ev) => { ev.stopPropagation(); onOpen(b); }} className="hr-focus hit absolute top-[7px] z-[2] flex h-[26px] items-center overflow-hidden rounded-[4px] transition-[filter] hover:brightness-95 dark:hover:brightness-125" style={style}>
      {inner}
    </button>
  );
}

export function CalendarPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const today = me.today;
  const month = (query.get('m') ?? today.slice(0, 7)) + '-01';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dept, setDept] = useState(query.get('department') ?? '');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const from = month;
  const to = monthEndOf(month);
  const live = useOp<CalendarData>('leave.calendar', { from, to, entity: entity === '' ? undefined : entity, department: dept === '' ? undefined : dept, q: debounced === '' ? undefined : debounced }, READS, { name: 'leave.calendar' });
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { name: 'leave.departments', skip: !can(me, 'leave', 'view') });
  const [req, setReq] = useState<{ row: CalRow; day: string } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const d = live.data;
  const days = useMemo(() => {
    const out: string[] = [];
    for (let x = from; x <= to; x = addDays(x, 1)) out.push(x);
    return out;
  }, [from, to]);
  const { col, nameW } = useCol(scrollEl, days.length);
  useEffect(() => {
    const el = scroller.current;
    if (el === null || today < from || today > to) return;
    const i = days.indexOf(today);
    el.scrollLeft = Math.max(0, i * col - 3 * col);
  }, [d, days, today, from, to, col]);
  const shift = (n: number): void => setQuery({ m: addMonths(month, n).slice(0, 7) });
  const m = dateOf(month);
  const canFor = (r: CalRow): boolean => r.self || (d !== null && d.mode === 'team') || can(me, 'leave', 'edit');
  const lockOf = (day: string): string => (d === null ? '' : d.blocks.filter((b) => b.from <= day && b.to >= day).map((b) => b.reason).join(', '));
  const meta = d !== null ? `${monthName(m.getMonth() + 1)} ${m.getFullYear()} · ${t(`leave.calendar.mode.${d.mode}`)}` : '';
  return (
    <>
      <PageHeader title={t('leave.calendar.title')} meta={meta} />
      <PageBody wide>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label={t('ui.prev_month')} onClick={() => shift(-1)} />
            <span className="hr-mono hr-num min-w-[92px] text-center text-[13px] font-medium">
              {monthName(m.getMonth() + 1, 'short')} {m.getFullYear()}
            </span>
            <IconButton icon={ChevronRight} label={t('ui.next_month')} onClick={() => shift(1)} />
            <Button size="sm" variant="ghost" onClick={() => setQuery({ m: undefined })}>
              {t('format.today')}
            </Button>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder={t('leave.search_people')} className="w-full sm:w-[220px]" />
          {can(me, 'leave', 'view') && <Picker value={dept} onChange={(v) => { setDept(v); setQuery({ department: v === '' ? undefined : v }); }} items={(depts.data?.departments ?? []).map((x) => ({ value: x.id, label: x.name }))} label={t('leave.col.department')} placeholder={t('leave.calendar.all_departments')} clearable className="w-full sm:w-[220px]" />}
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {(d?.legend ?? []).map((x) => (
              <TypeLabel key={x.code} name={x.name} icon={x.icon} color={x.color} keyed className="text-[12px] text-[var(--hr-ink-2)]" />
            ))}
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
              <span aria-hidden className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-[var(--hr-ink-2)]" style={{ background: 'repeating-linear-gradient(135deg, var(--hr-active) 0 4px, transparent 4px 7px)' }} />
              {t('leave.calendar.waiting')}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
              <span aria-hidden className="inline-block h-3 w-3 rounded-[3px]" style={{ background: 'color-mix(in srgb, var(--hr-line-2), transparent 35%)' }} />
              {t('leave.calendar.holiday')}
            </span>
          </div>
        </div>
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : d === null ? (
          <Loading />
        ) : d.rows.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={ChevronRight} title={t('leave.calendar.nobody')}>{t('leave.calendar.nobody_body')}</Empty>
          </div>
        ) : (
          <div
            ref={(el) => {
              scroller.current = el;
              setScrollEl(el);
            }}
            className="hr-panel hr-in hr-scroll relative overflow-x-auto"
            role="grid"
            aria-label={t('leave.calendar.title')}
          >
            <div style={{ width: nameW + days.length * col }} className="relative">
              <div className="sticky top-0 z-[4] flex border-b border-[var(--hr-line)] bg-[var(--hr-panel)]">
                <div className="sticky left-0 z-[5] flex shrink-0 items-end border-r border-[var(--hr-line)] bg-[var(--hr-panel)] px-3 pb-1.5" style={{ width: nameW }}>
                  <span className="hr-label">{t('leave.col.person')}</span>
                </div>
                {days.map((day) => {
                  const lock = lockOf(day);
                  const isToday = day === today;
                  return (
                    <div key={day} className={cn('relative flex shrink-0 flex-col items-center justify-end pb-1 pt-1.5', isToday && 'bg-[var(--hr-active)]')} style={{ width: col }} title={lock !== '' ? t('leave.form.locked_day', { reason: lock }) : fmtDay(day, { weekday: true })}>
                      {lock !== '' && <Lock size={9} aria-hidden className="absolute top-0.5 text-[var(--hr-muted)]" />}
                      <span className="hr-label leading-3">{weekday(day, 'narrow')}</span>
                      <span className={cn('hr-mono hr-num text-[12px] leading-4', isToday ? 'font-semibold text-[var(--hr-ink)]' : 'text-[var(--hr-ink-2)]')}>{Number(day.slice(8))}</span>
                    </div>
                  );
                })}
              </div>
              {d.rows.map((r) => {
                const hol: Record<string, string> = {};
                for (const h of d.holidays[r.calendar] ?? []) hol[h.day] = h.name + (h.half ? ` (${t('leave.calendar.half')})` : '');
                const bars = d.bars.filter((b) => b.employment === r.employment);
                const clickable = canFor(r);
                return (
                  <div key={r.employment} className="group relative flex border-b border-[var(--hr-hair)] last:border-b-0" style={{ height: ROW }}>
                    <div className={cn('sticky left-0 z-[3] flex shrink-0 flex-col justify-center border-r border-[var(--hr-line)] bg-[var(--hr-panel)] px-3', r.self && 'bg-[var(--hr-raised)]')} style={{ width: nameW }}>
                      <a href={`#/people/${r.number}?tab=leave`} className="hr-link hr-focus hit truncate rounded-[3px] text-[13px] font-medium leading-4">
                        {r.name}
                      </a>
                      <span className="truncate text-[12px] leading-4 text-[var(--hr-muted)]">{r.department_name !== '' ? r.department_name : r.title}</span>
                    </div>
                    <div className="hr-grid relative" style={{ width: days.length * col, backgroundSize: `${col}px ${ROW}px` }}>
                      {days.map((day, i) => {
                        const off = r.week_off.includes(dateOf(day).getDay());
                        const h = hol[day];
                        const outside = day < r.start_day || (r.end_day !== '' && day > r.end_day);
                        const shade = outside ? 'repeating-linear-gradient(135deg, var(--hr-line) 0 1px, transparent 1px 6px)' : h !== undefined ? 'color-mix(in srgb, var(--hr-line-2), transparent 35%)' : off ? 'color-mix(in srgb, var(--hr-line), transparent 62%)' : undefined;
                        const title = [fmtDay(day, { weekday: true }), h].filter((x) => x !== undefined).join(', ');
                        if (clickable && !outside && !off && h === undefined)
                          return <button key={day} type="button" aria-label={t('leave.calendar.request_on', { name: r.name, day: fmtDay(day) })} title={title} onClick={() => setReq({ row: r, day })} className="hr-focus absolute bottom-0 top-0 transition-colors hover:bg-[var(--hr-hover)]" style={{ left: i * col, width: col }} />;
                        return shade !== undefined ? <span key={day} aria-hidden title={title} className="absolute bottom-0 top-0" style={{ left: i * col, width: col, background: shade }} /> : null;
                      })}
                      {bars.map((b) => (
                        <Bar key={b.id} b={b} from={from} days={days.length} col={col} onOpen={(x) => navigate(`/leave/requests/${x.id}`)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {d !== null && d.blocks.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--hr-muted)]">
            <Lock size={12} aria-hidden />
            {d.blocks.map((b) => (
              <Tag key={b.id} tone="faint">
                {fmtDay(b.from)}
                {b.to !== b.from ? `-${fmtDay(b.to)}` : ''} {b.reason}
              </Tag>
            ))}
          </div>
        )}
      </PageBody>
      {req !== null && <RequestFromCalendar row={req.row} day={req.day} self={req.row.self} onClose={() => setReq(null)} />}
    </>
  );
}

function RequestFromCalendar({ row, day, self, onClose }: { row: CalRow; day: string; self: boolean; onClose: () => void }): React.JSX.Element | null {
  const live = useOp<Mine>('leave.mine', { employment: row.employment }, READS, { name: 'leave.mine.cal' });
  if (live.data === null || live.data.employment === null) return null;
  return <RequestSheet open onClose={onClose} target={{ employment: row.employment, number: row.number, name: row.name, self }} types={live.data.types} initialDay={day} />;
}

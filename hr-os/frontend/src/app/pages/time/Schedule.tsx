/**
 * The schedule. For HR and managers: the week grid by person on the
 * measuring-grid canvas. Drag a shift type from the palette onto a day (or
 * pick a type, then tap days), copy last week, lay a pattern over many
 * people, then publish: only the people whose shifts changed are told.
 * Drafts show dashed, approved leave and holidays show in the cell and a
 * shift on a leave day is marked. For employees: their next two weeks, with
 * a change or a swap one tap away, and swaps colleagues asked them for.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { AlertTriangle, ArrowLeftRight, CalendarClock, ChevronLeft, ChevronRight, Copy, Eraser, Layers, MoreHorizontal, Repeat, Send, Undo2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Checkbox, DateRange, Dialog, Empty, Field, IconButton, Input, LoadError, Loading, Menu, MenuItem, PageBody, PageHeader, Panel, Picker, Popover, StatusDot, Tag, confirmAsk, toast } from '../../components/ui.tsx';
import { DecisionButton, DecisionRow, decide } from '../../components/decision.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, fmtDay, fmtRange, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, reshape, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { ShiftChangeDialog, SwapDialog } from './RequestDialogs.tsx';
import type { MyDay, Pattern, ShiftRequest, ShiftType, Week, WeekCell, WeekPerson } from './types.ts';
import { editsTime, hm, READS, span } from './util.ts';

const COLOR: Record<ShiftType['color'], string> = {
  grey: 'border-[var(--hr-line-2)] bg-[var(--hr-raised)]',
  blue: 'border-[color-mix(in_srgb,var(--hr-rh),transparent_55%)] bg-[var(--hr-rh-soft)]',
  teal: 'border-[color-mix(in_srgb,var(--hr-lh),transparent_55%)] bg-[var(--hr-lh-soft)]',
  ink: 'border-[var(--hr-ink-2)] bg-[var(--hr-active)]',
};
const BAR: Record<ShiftType['color'], string> = { grey: 'bg-[var(--hr-line-2)]', blue: 'bg-[var(--hr-rh)]', teal: 'bg-[var(--hr-lh)]', ink: 'bg-[var(--hr-ink)]' };
const DRAG_TYPE = 'application/x-hr-shift-type';

export function SchedulePage(props: PageProps): React.JSX.Element {
  const me = useMe();
  return editsTime(me) ? <WeekGrid {...props} /> : <MySchedule {...props} />;
}

/* ------------------------------------------------------------ the grid */

function WeekGrid({ query }: PageProps): React.JSX.Element {
  const { entity } = useUi();
  const me = useMe();
  const today = me.today;
  const week = query.get('week') ?? '';
  const live = useOp<Week>('shifts.week', { week: week === '' ? undefined : week, entity: entity === '' ? undefined : entity }, READS.week, { name: 'time.week' });
  const w = live.data;
  const [armed, setArmed] = useState<string>('');
  const [pick, setPick] = useState<{ person: WeekPerson; day: string; el: HTMLElement } | null>(null);
  const [pattern, setPattern] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setArmed('');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const setCell = (person: WeekPerson, day: string, shiftType: string): void => {
    if (!person.editable) return;
    void act(
      [
        reshape('time.week', (data) => {
          const d = data as Week;
          return {
            ...d,
            unpublished: d.unpublished + 1,
            people: d.people.map((p) => {
              if (p.employment !== person.employment) return p;
              const c = p.cells[day];
              if (c === undefined) return p;
              const prev = c.assignment;
              const next: WeekCell = { ...c, assignment: shiftType === '' ? (prev !== null && prev.published_shift_type !== '' ? { ...prev, status: 'removed', changed: true } : null) : { id: prev?.id ?? 'tmp', employment: p.employment, day, shift_type: shiftType, location: '', status: prev !== null && prev.published_shift_type === shiftType ? 'published' : 'draft', published_shift_type: prev?.published_shift_type ?? '', changed: true } };
              return { ...p, cells: { ...p.cells, [day]: next } };
            }),
          };
        }),
      ],
      () => op('shifts.set', { cells: [{ employment: person.employment, day, shift_type: shiftType }] }),
      READS.week,
    );
  };

  const copyLast = async (): Promise<void> => {
    if (w === null) return;
    setBusy(true);
    const r = await act([], () => op<{ copied: number; skipped: number }>('shifts.copy-week', { from_week: addDays(w.from, -7), to_week: w.from, mode: 'fill', entity: entity === '' ? undefined : entity }), READS.week);
    setBusy(false);
    if (r !== null) toast.success(r.copied === 0 ? t('time.sched.copied_none') : tn('time.sched.copied', r.copied));
  };
  const publish = async (): Promise<void> => {
    if (w === null) return;
    setBusy(true);
    const r = await act([], () => op<{ published: number; removed: number; people: number; notified: number }>('shifts.publish', { week: w.from, entity: entity === '' ? undefined : entity }), READS.week);
    setBusy(false);
    if (r !== null) toast.success(t('time.sched.published', { n: r.published + r.removed, people: r.people }));
  };
  const discard = async (): Promise<void> => {
    if (w === null) return;
    const ok = await confirmAsk(t('time.sched.discard_text'), t('time.sched.discard'), t('time.sched.discard_ok'));
    if (!ok) return;
    await act([], () => op('shifts.discard', { week: w.from, entity: entity === '' ? undefined : entity }), READS.week);
  };

  if (w === null)
    return (
      <>
        <PageHeader title={t('time.sched.title')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const types = w.shift_types;
  const many = new Set(types.map((s) => s.entity)).size > 1;
  const codes: Record<string, string> = many ? Object.fromEntries(me.entities.map((e) => [e.id, e.code !== '' ? e.code : e.country])) : {};
  const go = (n: number): void => setQuery({ week: addDays(w.from, n * 7) });
  const meta = [fmtRange(w.from, w.to), w.unpublished > 0 ? tn('time.sched.unpublished', w.unpublished) : t('time.sched.all_published')].join(' · ');
  return (
    <>
      <PageHeader title={t('time.sched.title')} meta={meta}>
        <span className="flex items-center">
          <IconButton icon={ChevronLeft} label={t('time.sched.prev')} onClick={() => go(-1)} />
          <Button size="sm" variant="ghost" onClick={() => setQuery({ week: undefined })} className="hidden sm:inline-flex">
            {t('time.sched.this_week')}
          </Button>
          <IconButton icon={ChevronRight} label={t('time.sched.next')} onClick={() => go(1)} />
        </span>
        <Button icon={Copy} onClick={() => void copyLast()} disabled={busy || !w.can.edit} aria-label={t('time.sched.copy_last')} title={t('time.sched.copy_last')} className="hidden sm:inline-flex">
          <span className="hidden lg:inline">{t('time.sched.copy_last')}</span>
        </Button>
        <Button icon={Repeat} onClick={() => setPattern(true)} disabled={!w.can.edit} aria-label={t('time.sched.pattern')} title={t('time.sched.pattern')} className="hidden sm:inline-flex">
          <span className="hidden lg:inline">{t('time.sched.pattern')}</span>
        </Button>
        <Button variant="primary" icon={Send} onClick={() => void publish()} busy={busy} disabled={w.unpublished === 0 || !w.can.publish}>
          {w.unpublished > 0 ? t('time.sched.publish_n', { n: w.unpublished }) : t('time.sched.publish')}
        </Button>
        <Menu icon={MoreHorizontal} label={t('ui.more')}>
          {(close) => (
            <>
              <MenuItem
                icon={Copy}
                disabled={busy || !w.can.edit}
                onClick={() => {
                  close();
                  void copyLast();
                }}
              >
                {t('time.sched.copy_last')}
              </MenuItem>
              <MenuItem
                icon={Repeat}
                disabled={!w.can.edit}
                onClick={() => {
                  close();
                  setPattern(true);
                }}
              >
                {t('time.sched.pattern_title')}
              </MenuItem>
              <MenuItem
                icon={Undo2}
                disabled={w.unpublished === 0}
                onClick={() => {
                  close();
                  void discard();
                }}
              >
                {t('time.sched.discard')}
              </MenuItem>
            </>
          )}
        </Menu>
      </PageHeader>
      <PageBody wide>
        {w.people.length === 0 ? (
          <Empty icon={CalendarClock} title={t('time.sched.empty')} action={can(me, 'people', 'full') ? <Button variant="primary" onClick={() => navigate('/people/new')}>{t('time.board.add_people')}</Button> : undefined}>
            {t('time.sched.empty_text')}
          </Empty>
        ) : (
          <>
            <Palette types={types} armed={armed} onArm={(id) => setArmed((a) => (a === id ? '' : id))} codes={codes} />
            <div className="hr-panel hr-in mt-3 min-w-0 overflow-hidden">
              <div className="hr-scroll overflow-x-auto">
                <div className="hr-grid min-w-[820px]" role="grid" aria-label={t('time.sched.title')}>
                  <div className="grid border-b border-[var(--hr-line)] bg-[var(--hr-panel)]" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) repeat(7, minmax(96px,1fr))' }} role="row">
                    <div className="hr-label sticky left-0 z-10 bg-[var(--hr-panel)] px-3 py-2" role="columnheader">
                      {tn('time.board.people', w.people.length)}
                    </div>
                    {w.days.map((d) => {
                      const hols = w.people.map((p) => p.cells[d]?.holiday ?? '');
                      const hol = hols.length > 0 && hols.every((x) => x !== '' && x === hols[0]) ? (hols[0] ?? '') : '';
                      return (
                        <div key={d} role="columnheader" className={cn('border-l border-[var(--hr-hair)] px-2 py-1.5', d === today && 'bg-[var(--hr-active)]')}>
                          <div className="hr-label">{weekday(d)}</div>
                          <div className="flex items-baseline gap-1.5">
                            <span className="hr-mono hr-num text-[13px]">{Number(d.slice(8))}</span>
                            {hol !== '' && <span className="hr-wrap truncate text-[12px] text-[var(--hr-muted)]" title={hol}>{hol}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {w.people.map((p) => (
                    <div key={p.employment} role="row" className="grid border-b border-[var(--hr-hair)] last:border-b-0" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) repeat(7, minmax(96px,1fr))' }}>
                      <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-[var(--hr-hair)] bg-[var(--hr-panel)] px-3 py-1.5" role="rowheader">
                        <div className="min-w-0 flex-1">
                          <div className="hr-wrap truncate text-[13px] font-medium">{p.name}</div>
                          <div className="truncate text-[12px] text-[var(--hr-muted)]">{p.title}</div>
                        </div>
                        <span className={cn('hr-mono hr-num shrink-0 text-[12px]', p.issues.some((x) => x.day === '') ? 'text-[var(--hr-warn)]' : 'text-[var(--hr-muted)]')} title={p.issues.map((x) => x.message).join('\n')}>
                          {hm(p.minutes)}
                        </span>
                      </div>
                      {w.days.map((d) => (
                        <GridCell key={d} person={p} day={d} cell={p.cells[d]} types={w.types} armed={armed} onDropType={(sid) => setCell(p, d, sid)} onOpen={(el) => (armed !== '' ? setCell(p, d, armed === 'off' ? '' : armed) : setPick({ person: p, day: d, el }))} />
                      ))}
                    </div>
                  ))}
                  <div className="grid bg-[var(--hr-panel)]" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) repeat(7, minmax(96px,1fr))' }} role="row">
                    <div className="hr-label sticky left-0 z-10 bg-[var(--hr-panel)] px-3 py-2">{t('time.sched.totals')}</div>
                    {w.totals.map((x) => (
                      <div key={x.day} className="hr-mono hr-num border-l border-[var(--hr-hair)] px-2 py-2 text-[12px] text-[var(--hr-muted)]">
                        {x.shifts > 0 ? tn('time.sched.shifts', x.shifts) + ' · ' + hm(x.minutes) : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </PageBody>
      {pick !== null && (
        <Popover anchor={{ current: pick.el }} open onClose={() => setPick(null)} align="start" width={220}>
          <div className="flex flex-col p-1">
            {types
              .filter((s) => s.entity === pick.person.entity)
              .map((s) => (
                <MenuItem
                  key={s.id}
                  onClick={() => {
                    setCell(pick.person, pick.day, s.id);
                    setPick(null);
                  }}
                  hint={span(s.start, s.end)}
                  selected={pick.person.cells[pick.day]?.assignment?.shift_type === s.id}
                >
                  {s.name}
                </MenuItem>
              ))}
            <MenuItem
              icon={Eraser}
              onClick={() => {
                setCell(pick.person, pick.day, '');
                setPick(null);
              }}
            >
              {t('time.sched.no_shift')}
            </MenuItem>
          </div>
        </Popover>
      )}
      <PatternDialog open={pattern} onClose={() => setPattern(false)} week={w} />
    </>
  );
}

function Palette({ types, armed, onArm, codes }: { types: ShiftType[]; armed: string; onArm: (id: string) => void; codes: Record<string, string> }): React.JSX.Element {
  const start = (e: DragEvent<HTMLButtonElement>, id: string): void => {
    e.dataTransfer.setData(DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="hr-label mr-1">{t('time.sched.palette')}</span>
      {types.length === 0 && <span className="text-[12px] text-[var(--hr-muted)]">{t('time.sched.no_types')}</span>}
      {types.map((s) => (
        <button
          key={s.id}
          type="button"
          draggable
          onDragStart={(e) => start(e, s.id)}
          onClick={() => onArm(s.id)}
          aria-pressed={armed === s.id}
          title={t('time.sched.drag_tip')}
          className={cn('hr-focus flex h-8 cursor-grab items-center [@media(pointer:coarse)]:h-10 gap-2 rounded-[var(--hr-radius-sm)] border px-2.5 text-[13px] transition-colors hover:border-[var(--hr-ink-2)] active:cursor-grabbing', COLOR[s.color], armed === s.id && 'ring-2 ring-[var(--hr-ink)]')}
        >
          <span className={cn('h-3.5 w-1 rounded-full', BAR[s.color])} aria-hidden />
          {codes[s.entity] !== undefined && <span className="hr-label">{codes[s.entity]}</span>}
          <span className="font-medium">{s.code !== '' ? s.code : s.name}</span>
          <span className="hr-mono hr-num text-[10.5px] text-[var(--hr-muted)]">{span(s.start, s.end)}</span>
        </button>
      ))}
      <button
        type="button"
        draggable
        onDragStart={(e) => start(e, 'off')}
        onClick={() => onArm('off')}
        aria-pressed={armed === 'off'}
        className={cn('hr-focus flex h-8 cursor-grab items-center [@media(pointer:coarse)]:h-10 gap-1.5 rounded-[var(--hr-radius-sm)] border border-dashed border-[var(--hr-line-2)] px-2.5 text-[13px] text-[var(--hr-ink-2)] hover:border-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]', armed === 'off' && 'ring-2 ring-[var(--hr-ink)]')}
      >
        <Eraser size={13} aria-hidden />
        {t('time.sched.no_shift')}
      </button>
      {armed !== '' && <span className="hr-label ml-2">{t('time.sched.armed')}</span>}
    </div>
  );
}

function GridCell({ person, day, cell, types, armed, onDropType, onOpen }: { person: WeekPerson; day: string; cell: WeekCell | undefined; types: Record<string, ShiftType>; armed: string; onDropType: (sid: string) => void; onOpen: (el: HTMLElement) => void }): React.JSX.Element {
  const [over, setOver] = useState(false);
  if (cell === undefined || cell.outside === true) return <div className="border-l border-[var(--hr-hair)] bg-[color-mix(in_srgb,var(--hr-sunk),var(--hr-ink)_4%)]" role="gridcell" />;
  const a = cell.assignment;
  const st = a !== null && a.status !== 'removed' ? types[a.shift_type] : undefined;
  const removed = a !== null && a.status === 'removed';
  const draft = a !== null && a.status !== 'published';
  const drop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setOver(false);
    const sid = e.dataTransfer.getData(DRAG_TYPE);
    if (sid !== '') onDropType(sid === 'off' ? '' : sid);
  };
  return (
    <div
      role="gridcell"
      className={cn('min-h-[52px] border-l border-[var(--hr-hair)] p-1', over && 'bg-[var(--hr-hover)]')}
      onDragOver={(e) => {
        if (!person.editable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <button
        type="button"
        disabled={!person.editable}
        onClick={(e) => onOpen(e.currentTarget)}
        aria-label={person.name + ', ' + fmtDay(day, { weekday: true }) + ': ' + (st !== undefined ? st.name + ' ' + span(st.start, st.end) : t('time.sched.no_shift'))}
        className={cn(
          'hr-focus relative flex h-full min-h-[44px] w-full flex-col items-start justify-center gap-0.5 rounded-[var(--hr-radius-sm)] px-1.5 text-left transition-colors',
          person.editable && 'hover:bg-[var(--hr-hover)]',
          armed !== '' && person.editable && 'cursor-copy',
          st !== undefined && cn('border', COLOR[st.color]),
          draft && st !== undefined && 'border-dashed',
          cell.conflict !== '' && st !== undefined && '!border-[var(--hr-bad)]',
        )}
      >
        {st !== undefined ? (
          <>
            <span className="flex w-full items-center gap-1">
              <span className="truncate text-[12px] font-medium">{st.code !== '' ? st.code : st.name}</span>
              {draft && <span className="size-1.5 shrink-0 rounded-full bg-[var(--hr-warn)]" title={t('time.sched.draft')} />}
              {cell.conflict !== '' && <AlertTriangle size={11} className="ml-auto shrink-0 text-[var(--hr-bad)]" aria-label={cell.conflict} />}
            </span>
            <span className="hr-mono hr-num text-[10.5px] text-[var(--hr-muted)]">{span(st.start, st.end)}</span>
          </>
        ) : removed ? (
          <span className="text-[12px] text-[var(--hr-muted)] line-through">{types[a.published_shift_type]?.name ?? ''}</span>
        ) : cell.leave !== null ? (
          <span className="hr-wrap text-[12px] text-[var(--hr-lh)]">{cell.leave.name || cell.leave.type}</span>
        ) : cell.plan.kind === 'holiday' ? (
          <span className="text-[12px] text-[var(--hr-muted)]">{t('time.week.holiday')}</span>
        ) : cell.plan.source === 'schedule' ? (
          <span className="hr-mono hr-num text-[10.5px] text-[var(--hr-muted)]">{span(cell.plan.start, cell.plan.end)}</span>
        ) : (
          <span className="text-[12px] text-[var(--hr-faint)]">{t('time.week.off')}</span>
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------- pattern dialog */

function PatternDialog({ open, onClose, week }: { open: boolean; onClose: () => void; week: Week }): React.JSX.Element | null {
  const { entity } = useUi();
  const pats = useOp<{ patterns: Pattern[] }>('shift-patterns.list', { entity: entity === '' ? undefined : entity }, READS.rules, { skip: !open });
  const [pid, setPid] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const [who, setWho] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(week.from);
  const [to, setTo] = useState(addDays(week.from, 27));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFrom(week.from);
      setTo(addDays(week.from, 27));
      setWho(new Set());
      setPid('');
      setName('');
      setDays([]);
    }
  }, [open, week.from]);
  const people = week.people.filter((p) => p.editable);
  const ents = new Set(people.filter((p) => who.has(p.employment)).map((p) => p.entity));
  const entityOf = ents.size === 1 ? [...ents][0] ?? '' : entity;
  const types = week.shift_types.filter((s) => entityOf === '' || s.entity === entityOf);
  const chosen = pats.data?.patterns.find((x) => x.id === pid) ?? null;
  const seq = chosen !== null ? chosen.days : days;
  const ok = who.size > 0 && seq.length > 0 && from !== '' && to >= from && (chosen !== null || name.trim() !== '');
  const apply = async (): Promise<void> => {
    setBusy(true);
    let id = pid;
    if (id === '') {
      const r = await act([], () => op<{ pattern: Pattern }>('shift-patterns.save', { entity: entityOf, name: name.trim(), days: seq }), READS.rules);
      if (r === null) {
        setBusy(false);
        return;
      }
      id = r.pattern.id;
    }
    const r2 = await act([], () => op<{ cells: number; people: number }>('shifts.assign-pattern', { pattern: id, employments: [...who], from, to }), READS.week);
    setBusy(false);
    if (r2 !== null) {
      toast.success(t('time.sched.pattern_done', { n: r2.people }));
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('time.sched.pattern_title')}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Layers} disabled={!ok} busy={busy} onClick={() => void apply()}>
            {t('time.sched.pattern_apply', { n: who.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('time.sched.pattern_pick')}>
          <Picker value={pid} onChange={setPid} clearable items={(pats.data?.patterns ?? []).map((x) => ({ value: x.id, label: x.name, sub: tn('time.sched.cycle', x.cycle) }))} label={t('time.sched.pattern_pick')} placeholder={t('time.sched.pattern_new')} />
        </Field>
        {chosen === null && (
          <>
            <Field label={t('time.sched.pattern_name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('time.sched.pattern_name_ph')} />
            </Field>
            <Field label={t('time.sched.pattern_days')}>
              <div className="flex flex-wrap items-center gap-1.5">
                {types.map((s) => (
                  <Button key={s.id} size="sm" onClick={() => setDays((d) => [...d, s.id])}>
                    {s.code !== '' ? s.code : s.name}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setDays((d) => [...d, ''])}>
                  {t('time.week.off')}
                </Button>
              </div>
            </Field>
          </>
        )}
        {seq.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {seq.map((sid, i) => (
              <Tag key={i} tone={sid === '' ? 'faint' : 'neutral'}>
                {sid === '' ? t('time.week.off') : (week.types[sid]?.code ?? week.types[sid]?.name ?? '')}
              </Tag>
            ))}
            {chosen === null && (
              <Button size="sm" variant="ghost" onClick={() => setDays((d) => d.slice(0, -1))}>
                {t('time.sched.undo_day')}
              </Button>
            )}
          </div>
        )}
        <Field label={t('time.sched.pattern_when')}>
          <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('time.sched.pattern_when')} />
        </Field>
        <Field label={t('time.sched.pattern_who')}>
          <ul className="hr-scroll max-h-52 overflow-y-auto rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
            {people.map((p) => (
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
                  label={p.name + (p.title !== '' ? ' · ' + p.title : '')}
                />
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- my schedule */

function MySchedule({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const from = query.get('from') ?? '';
  const live = useOp<{ days: MyDay[]; requests: ShiftRequest[] }>('shifts.mine', { from: from === '' ? undefined : from }, READS.week.concat(READS.requests), { skip: me.employee === null, name: 'time.mine' });
  const [dlg, setDlg] = useState<'' | 'change' | 'swap'>('');
  const [day, setDay] = useState<string | undefined>(undefined);
  const d = live.data;
  const entity = me.employee?.employments[0]?.entity ?? '';
  const asking = useMemo(() => (d?.requests ?? []).filter((r) => r.kind === 'swap' && r.status === 'awaiting_peer' && r.employment !== (me.employee?.employments[0]?.id ?? '')), [d, me.employee]);
  // The ask shows its outcome and folds away, then the answer goes (components/decision.tsx).
  const answer = (id: string, a: 'accept' | 'decline'): void => decide(id, a === 'accept' ? 'accepted' : 'declined', () => act([], () => op('shift-requests.respond', { request: id, answer: a }), READS.requests));
  if (me.employee === null)
    return (
      <>
        <PageHeader title={t('time.sched.my_title')} />
        <PageBody>
          <Empty icon={CalendarClock} title={t('time.clock.no_employee')}>
            {t('time.clock.no_employee_text')}
          </Empty>
        </PageBody>
      </>
    );
  return (
    <>
      <PageHeader title={t('time.sched.my_title')} meta={d !== null && d.days.length > 0 ? fmtRange(d.days[0]?.day ?? '', d.days[d.days.length - 1]?.day ?? '') : ''}>
        <Button icon={ArrowLeftRight} onClick={() => (setDay(undefined), setDlg('swap'))}>
          {t('time.sched.swap')}
        </Button>
        <Button variant="primary" icon={Repeat} onClick={() => (setDay(undefined), setDlg('change'))}>
          {t('time.sched.ask_change')}
        </Button>
      </PageHeader>
      <PageBody className="max-w-[860px]">
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <div className="flex flex-col gap-3">
            {asking.map((r) => (
              <DecisionRow key={r.id} id={r.id} as="div" className="rounded-[var(--hr-radius)]">
                <Panel label={t('time.sched.swap_ask', { name: r.name })}>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="hr-wrap min-w-0 flex-1 text-[13px]">{t('time.sched.swap_ask_text', { day: fmtDay(r.swap_day, { weekday: true }), their: fmtDay(r.from_day, { weekday: true }) })}{r.reason !== '' ? ' · ' + r.reason : ''}</p>
                    <DecisionButton outcome="declined" onClick={() => answer(r.id, 'decline')}>{t('time.sched.decline')}</DecisionButton>
                    <DecisionButton outcome="accepted" variant="primary" onClick={() => answer(r.id, 'accept')}>
                      {t('time.sched.accept')}
                    </DecisionButton>
                  </div>
                </Panel>
              </DecisionRow>
            ))}
            <Panel index="01" label={t('time.sched.next_two_weeks')} flush>
              <ul>
                {d.days.map((x) => (
                  <li key={x.day} className="flex items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5">
                    <span className="w-24 shrink-0">
                      <span className="hr-label block">{weekday(x.day)}</span>
                      <span className="hr-mono hr-num text-[13px]">{fmtDay(x.day)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      {x.leave !== null ? (
                        <span className="text-[13px] text-[var(--hr-lh)]">{x.leave.name || x.leave.type}</span>
                      ) : x.holiday !== '' ? (
                        <span className="text-[13px] text-[var(--hr-muted)]">{x.holiday}</span>
                      ) : x.kind === 'rest' && x.source !== 'shift' ? (
                        <span className="text-[13px] text-[var(--hr-muted)]">{t('time.week.off')}</span>
                      ) : (
                        <span className="text-[13px]">
                          {x.source === 'shift' ? x.shift_name + ' ' : ''}
                          <span className="hr-mono hr-num">{span(x.start, x.end)}</span>
                        </span>
                      )}
                      {x.location_name !== '' && x.kind === 'work' && <span className="block text-[12px] text-[var(--hr-muted)]">{x.location_name}</span>}
                    </span>
                    {x.kind === 'work' && x.leave === null && (
                      <Menu icon={MoreHorizontal} label={t('ui.more')}>
                        {(close) => (
                          <>
                            <MenuItem icon={Repeat} onClick={() => (close(), setDay(x.day), setDlg('change'))}>
                              {t('time.sched.ask_change')}
                            </MenuItem>
                            <MenuItem icon={ArrowLeftRight} onClick={() => (close(), setDay(x.day), setDlg('swap'))}>
                              {t('time.sched.swap')}
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
            {(d.requests ?? []).filter((r) => !asking.includes(r)).length > 0 && (
              <Panel index="02" label={t('time.sched.my_requests')}>
                <ul className="flex flex-col gap-1.5">
                  {d.requests
                    .filter((r) => !asking.includes(r))
                    .map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-[13px]">
                        <StatusDot tone={r.status === 'pending' || r.status === 'awaiting_peer' ? 'warn' : 'faint'} label={t('time.req.status.' + r.status)} />
                        <span className="hr-wrap min-w-0 flex-1">{r.kind === 'swap' ? t('time.sched.swap_with', { name: r.swap_name, day: fmtDay(r.from_day) }) : t('time.sched.change_to', { name: r.shift_name || t('time.week.off'), days: fmtRange(r.from_day, r.to_day) })}</span>
                      </li>
                    ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </PageBody>
      <ShiftChangeDialog open={dlg === 'change'} onClose={() => setDlg('')} today={me.today} entity={entity} day={day} />
      <SwapDialog open={dlg === 'swap'} onClose={() => setDlg('')} today={me.today} day={day} />
    </>
  );
}


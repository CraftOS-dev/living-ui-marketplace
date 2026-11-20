/**
 * One person's day, docked on the right: the plan, what attendance says,
 * every punch (taken-out ones struck through), and the fixes a manager or HR
 * can make in place: add a punch, take one out, set the day by hand, or go
 * back to following the punches. The person themself can ask for a fix.
 */
import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Wrench, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, FactStrip, Field, Input, LinkButton, Loading, Notice, Section, Segmented, Sheet, SheetHeader, StatusDot, Tag, Textarea, confirmAsk } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { FixDayDialog } from './RequestDialogs.tsx';
import type { AttStatus, DayDetail, PunchKind } from './types.ts';
import { flagLabel, hm, punchLabel, READS, span, statusLabel, STATUS_TONE } from './util.ts';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MARKS: AttStatus[] = ['present', 'absent', 'half_day', 'remote', 'on_duty'];

export function DaySheet({ employment, day, onClose }: { employment: string; day: string; onClose: () => void }): React.JSX.Element | null {
  const open = employment !== '' && day !== '';
  const live = useOp<DayDetail>('attendance.get', { employment, day }, READS.month.concat(['attendance_requests']), { skip: !open });
  const d = live.data;
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    setAdding(false);
    setMarking(false);
  }, [employment, day]);
  if (!open) return null;
  const a = d?.attendance ?? null;
  return (
    <Sheet open={open} onClose={onClose} label={t('time.day.title')} width={460}>
      <SheetHeader title={d?.employee.name ?? t('ui.loading')} meta={fmtDay(day, { weekday: true }) + (d !== null && d.employee.number !== '' ? ' · ' + d.employee.number : '')} onClose={onClose} />
      {d === null ? (
        <Loading />
      ) : (
        <div className="hr-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {a !== null ? <StatusDot tone={STATUS_TONE[a.status]} label={statusLabel(a.status)} /> : <StatusDot tone="faint" label={t('time.day.no_record')} />}
            {a !== null && a.source !== 'auto' && <Tag>{t('time.source_att.' + a.source)}</Tag>}
            {a?.locked === true && <Tag tone="warn">{t('time.day.locked')}</Tag>}
            {(a?.flags ?? []).filter((f) => f !== 'marked' && f !== 'request' && f !== 'no_clock').map((f) => (
              <Tag key={f} tone={f.startsWith('missed') ? 'bad' : 'warn'}>{flagLabel(f)}</Tag>
            ))}
          </div>
          <div className="text-[13px] text-[var(--hr-ink-2)]">
            {d.leave !== null ? t('time.clock.on_leave', { name: d.leave.name || d.leave.type }) : d.plan.kind === 'holiday' && d.plan.source !== 'shift' ? t('time.clock.holiday', { name: d.plan.holiday?.name ?? '' }) : d.plan.kind === 'rest' ? t('time.clock.day_off') : d.plan.source === 'shift' ? t('time.clock.shift', { name: d.plan.shift_name, span: span(d.plan.start, d.plan.end) }) : d.plan.start !== '' ? t('time.clock.hours', { span: span(d.plan.start, d.plan.end) }) : t('time.clock.no_plan')}
          </div>
          {a !== null && (
            <FactStrip
              items={[
                { label: t('time.day.in'), value: a.first_in_time || '--', mono: true },
                { label: t('time.day.out'), value: a.last_out_time || '--', mono: true },
                { label: t('time.day.worked'), value: hm(a.worked_min), mono: true },
                { label: t('time.day.late'), value: a.late_min > 0 ? hm(a.late_min) : '--', mono: true },
                { label: t('time.day.overtime'), value: a.overtime_min > 0 ? hm(a.overtime_min) : '--', mono: true },
              ]}
            />
          )}
          {a !== null && a.note !== '' && <p className="hr-wrap text-[13px] text-[var(--hr-muted)]">{a.note}</p>}

          <Section title={t('time.day.punches')} aside={d.can.edit ? <LinkButton onClick={() => setAdding((x) => !x)}><Plus size={12} aria-hidden />{t('time.day.add_punch')}</LinkButton> : undefined}>
            {d.punches.length === 0 && !adding && <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('time.clock.no_punches')}</p>}
            <ul className="flex flex-col">
              {d.punches.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 border-b border-[var(--hr-hair)] py-1.5 last:border-b-0">
                  <span className={cn('hr-mono hr-num w-11 text-[13px]', p.voided && 'line-through opacity-50')}>{p.time}</span>
                  <span className={cn('min-w-0 flex-1 text-[13px]', p.voided && 'opacity-50')}>
                    {punchLabel(p.kind)}
                    <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
                      {t('time.source.' + p.source)}
                      {p.note !== '' ? ' · ' + p.note : ''}
                      {p.voided ? ' · ' + t('time.day.taken_out', { why: p.void_reason }) : ''}
                    </span>
                  </span>
                  {p.flagged && <Tag tone="warn">{flagLabel('outside_geofence')}</Tag>}
                  {d.can.edit && !p.voided && <VoidButton id={p.id} />}
                </li>
              ))}
            </ul>
            {adding && <AddPunch employment={d.employment} day={day} onDone={() => setAdding(false)} />}
          </Section>

          {d.can.edit && a?.locked !== true && (
            <Section title={t('time.day.set_day')} aside={a !== null && a.source === 'manual' ? <LinkButton onClick={() => void reset(d.employment, day)}><RotateCcw size={12} aria-hidden />{t('time.day.follow_punches')}</LinkButton> : !marking ? <LinkButton onClick={() => setMarking(true)}>{t('time.day.set')}</LinkButton> : undefined}>
              {marking ? <MarkForm employment={d.employment} day={day} onDone={() => setMarking(false)} /> : <p className="text-[13px] text-[var(--hr-muted)]">{a !== null && a.source === 'manual' ? t('time.day.is_manual') : t('time.day.follows')}</p>}
            </Section>
          )}

          {d.requests.length > 0 && (
            <Section title={t('time.day.requests')}>
              <ul className="flex flex-col gap-1.5">
                {d.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-[13px]">
                    <StatusDot tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : r.status === 'pending' ? 'warn' : 'faint'} label={r.kind_label} />
                    <span className="hr-wrap min-w-0 flex-1 text-[var(--hr-muted)]">{r.reason}</span>
                    <span className="hr-label">{t('time.req.status.' + r.status)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.can.request && !d.can.edit && (
            <Button icon={Wrench} onClick={() => setAsking(true)}>
              {t('time.clock.fix_day')}
            </Button>
          )}
          {a?.locked === true && <Notice tone="warn">{a.adjusted_after_lock && a.after_lock !== null ? t('time.day.after_lock', { now: hm(a.after_lock.worked_min), paid: hm(a.worked_min) }) : t('time.day.locked_note')}</Notice>}
          <FixDayDialog open={asking} onClose={() => setAsking(false)} today={day} day={day} />
        </div>
      )}
    </Sheet>
  );
}

async function reset(employment: string, day: string): Promise<void> {
  const ok = await confirmAsk(t('time.day.follow_text'), t('time.day.follow_punches'), t('time.day.follow_ok'), 'primary');
  if (!ok) return;
  await act([], () => op('attendance.reset', { employment, day }), READS.month);
}

function VoidButton({ id }: { id: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  if (!open)
    return (
      <button type="button" aria-label={t('time.day.take_out')} title={t('time.day.take_out')} onClick={() => setOpen(true)} className="hr-focus hit flex size-7 items-center justify-center rounded-[var(--hr-radius-sm)] text-[var(--hr-muted)] hover:bg-[var(--hr-bad-soft)] hover:text-[var(--hr-bad)]">
        <X size={14} aria-hidden />
      </button>
    );
  return (
    <span className="flex items-center gap-1.5">
      <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('time.day.why')} aria-label={t('time.day.why')} className="h-7 w-36 text-[12px]" autoFocus />
      <Button size="sm" variant="danger" disabled={why.trim() === ''} onClick={() => void act([patch(id, { voided: true })], () => op('checkins.void', { checkin: id, reason: why.trim() }), READS.month).then(() => setOpen(false))}>
        {t('time.day.take_out')}
      </Button>
    </span>
  );
}

function AddPunch({ employment, day, onDone }: { employment: string; day: string; onDone: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<PunchKind>('out');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = TIME.test(time) && note.trim() !== '';
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('checkins.add', { employment, day, time, kind, note: note.trim() }), READS.month);
    setBusy(false);
    if (r !== null) onDone();
  };
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] p-2.5">
      <Segmented
        value={kind}
        onChange={setKind}
        label={t('time.day.kind')}
        size="sm"
        options={(['in', 'break_start', 'break_end', 'out'] as PunchKind[]).map((k) => ({ value: k, label: punchLabel(k) }))}
      />
      <div className="flex gap-2">
        <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="18:00" aria-label={t('time.day.time')} inputMode="numeric" className="hr-mono w-24" aria-invalid={time !== '' && !TIME.test(time)} autoFocus />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('time.day.note_ph')} aria-label={t('time.day.note')} className="flex-1" />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('ui.cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={!ok} busy={busy} onClick={() => void save()}>
          {t('time.day.add_punch')}
        </Button>
      </div>
    </div>
  );
}

function MarkForm({ employment, day, onDone }: { employment: string; day: string; onDone: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<AttStatus>('present');
  const [inT, setIn] = useState('');
  const [outT, setOut] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const timesOk = (inT === '' && outT === '') || (TIME.test(inT) && TIME.test(outT));
  const ok = timesOk && note.trim() !== '';
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('attendance.mark', { employment, day, status, in_time: inT === '' ? undefined : inT, out_time: outT === '' ? undefined : outT, note: note.trim() }), READS.month);
    setBusy(false);
    if (r !== null) onDone();
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented value={status} onChange={setStatus} label={t('time.day.status')} size="sm" options={MARKS.map((s) => ({ value: s, label: statusLabel(s) }))} />
      {(status === 'present' || status === 'half_day') && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('time.req.in')} optional>
            <Input value={inT} onChange={(e) => setIn(e.target.value)} placeholder="09:00" className="hr-mono" inputMode="numeric" />
          </Field>
          <Field label={t('time.req.out')} optional>
            <Input value={outT} onChange={(e) => setOut(e.target.value)} placeholder="18:00" className="hr-mono" inputMode="numeric" />
          </Field>
        </div>
      )}
      <Field label={t('time.day.note')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} placeholder={t('time.day.mark_ph')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('ui.cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={!ok} busy={busy} onClick={() => void save()}>
          {t('time.day.save_day')}
        </Button>
      </div>
    </div>
  );
}

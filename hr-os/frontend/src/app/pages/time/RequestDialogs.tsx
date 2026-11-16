/**
 * The employee's requests as short one-column dialogs with good defaults:
 * fix a day (a missed punch or the whole day's hours), work from home or on
 * duty, overtime, a different shift, a swap with a colleague. Each opens an
 * approval for the manager; the toast says so and offers the requests page.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, DateRange, DayPicker, Dialog, Field, Input, Picker, Segmented, Textarea, Toggle, toast } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addDays, fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act } from '../../lib/live.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { ShiftType } from './types.ts';
import { READS } from './util.ts';

export type RequestKind = 'fix' | 'remote' | 'overtime' | 'shift' | 'swap';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function sent(what: string): void {
  toast.success(t('time.req.sent', { what }), { label: t('time.req.see'), run: () => navigate('/time/requests') });
}

function Footer({ onClose, onSend, busy, ok }: { onClose: () => void; onSend: () => void; busy: boolean; ok: boolean }): React.JSX.Element {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t('ui.cancel')}
      </Button>
      <Button variant="primary" onClick={onSend} busy={busy} disabled={!ok}>
        {t('time.req.send')}
      </Button>
    </>
  );
}

/** A missed punch or a whole day's hours. */
export function FixDayDialog({ open, onClose, today, day: day0, employment }: { open: boolean; onClose: () => void; today: string; day?: string | undefined; employment?: string | undefined }): React.JSX.Element | null {
  const [day, setDay] = useState(day0 ?? today);
  const [mode, setMode] = useState<'missed_punch' | 'correction'>('missed_punch');
  const [inT, setIn] = useState('');
  const [outT, setOut] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDay(day0 ?? today);
      setIn('');
      setOut('');
      setReason('');
    }
  }, [open, day0, today]);
  const timesOk = mode === 'correction' ? TIME.test(inT) && TIME.test(outT) : (inT === '' || TIME.test(inT)) && (outT === '' || TIME.test(outT)) && (inT !== '' || outT !== '');
  const ok = day !== '' && timesOk && reason.trim() !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('attendance-requests.add', { kind: mode, from_day: day, in_time: inT === '' ? undefined : inT, out_time: outT === '' ? undefined : outT, reason: reason.trim(), employment }), READS.requests);
    setBusy(false);
    if (r !== null) {
      sent(t('time.req.fix_what', { day: fmtDay(day, { weekday: true }) }));
      onClose();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('time.req.fix_title')} footer={<Footer onClose={onClose} onSend={() => void send()} busy={busy} ok={ok} />}>
      <div className="flex flex-col gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          label={t('time.req.fix_kind')}
          options={[
            { value: 'missed_punch', label: t('time.req.missed_punch') },
            { value: 'correction', label: t('time.req.correction') },
          ]}
        />
        <Field label={t('time.req.day')}>
          <DayPicker value={day} onChange={setDay} max={today} label={t('time.req.day')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('time.req.in')} optional={mode === 'missed_punch'}>
            <Input value={inT} onChange={(e) => setIn(e.target.value)} placeholder="09:00" inputMode="numeric" aria-invalid={inT !== '' && !TIME.test(inT)} className="hr-mono" />
          </Field>
          <Field label={t('time.req.out')} optional={mode === 'missed_punch'}>
            <Input value={outT} onChange={(e) => setOut(e.target.value)} placeholder="18:00" inputMode="numeric" aria-invalid={outT !== '' && !TIME.test(outT)} className="hr-mono" />
          </Field>
        </div>
        <Field label={t('time.req.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={t('time.req.reason_fix_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Work from home or on duty elsewhere, for one day or a few. */
export function RemoteDialog({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }): React.JSX.Element | null {
  const [kind, setKind] = useState<'remote' | 'on_duty'>('remote');
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 1));
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFrom(addDays(today, 1));
      setTo(addDays(today, 1));
      setReason('');
      setHalf(false);
    }
  }, [open, today]);
  const ok = from !== '' && to >= from && reason.trim() !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('attendance-requests.add', { kind, from_day: from, to_day: to, half_day: half, reason: reason.trim() }), READS.requests);
    setBusy(false);
    if (r !== null) {
      sent(kind === 'remote' ? t('time.req.remote_what') : t('time.req.on_duty_what'));
      onClose();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('time.req.remote_title')} footer={<Footer onClose={onClose} onSend={() => void send()} busy={busy} ok={ok} />}>
      <div className="flex flex-col gap-3">
        <Segmented
          value={kind}
          onChange={setKind}
          label={t('time.req.where')}
          options={[
            { value: 'remote', label: t('time.status.remote') },
            { value: 'on_duty', label: t('time.status.on_duty') },
          ]}
        />
        <Field label={t('time.req.days')}>
          <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('time.req.days')} />
        </Field>
        <Toggle checked={half} onChange={setHalf} label={t('time.req.half_day')} />
        <Field label={t('time.req.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={kind === 'remote' ? t('time.req.reason_remote_ph') : t('time.req.reason_duty_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Overtime on a day, before or just after. */
export function OvertimeDialog({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }): React.JSX.Element | null {
  const [day, setDay] = useState(today);
  const [hrs, setHrs] = useState('2');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDay(today);
      setHrs('2');
      setReason('');
    }
  }, [open, today]);
  const mins = Math.round(Number(hrs.replace(',', '.')) * 60);
  const ok = day !== '' && Number.isFinite(mins) && mins > 0 && mins <= 1440 && reason.trim() !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('overtime-requests.add', { day, minutes: mins, reason: reason.trim() }), READS.requests);
    setBusy(false);
    if (r !== null) {
      sent(t('time.req.overtime_what', { h: hrs }));
      onClose();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('time.req.overtime_title')} footer={<Footer onClose={onClose} onSend={() => void send()} busy={busy} ok={ok} />}>
      <div className="flex flex-col gap-3">
        <Field label={t('time.req.day')}>
          <DayPicker value={day} onChange={setDay} min={addDays(today, -7)} label={t('time.req.day')} />
        </Field>
        <Field label={t('time.req.hours')}>
          <Input value={hrs} onChange={(e) => setHrs(e.target.value)} inputMode="decimal" className="hr-mono w-28" aria-invalid={!(mins > 0)} />
        </Field>
        <Field label={t('time.req.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={t('time.req.reason_ot_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** A different shift on some days. */
export function ShiftChangeDialog({ open, onClose, today, entity, day: day0 }: { open: boolean; onClose: () => void; today: string; entity: string; day?: string | undefined }): React.JSX.Element | null {
  const types = useOp<{ shift_types: ShiftType[] }>('shift-types.list', { entity }, READS.rules, { skip: !open || entity === '' });
  const [from, setFrom] = useState(day0 ?? addDays(today, 1));
  const [to, setTo] = useState(day0 ?? addDays(today, 1));
  const [shift, setShift] = useState('');
  const [off, setOff] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFrom(day0 ?? addDays(today, 1));
      setTo(day0 ?? addDays(today, 1));
      setShift('');
      setOff(false);
      setReason('');
    }
  }, [open, today, day0]);
  const items = useMemo(() => (types.data?.shift_types ?? []).map((s) => ({ value: s.id, label: s.name, sub: s.start + ' to ' + s.end })), [types.data]);
  const ok = from !== '' && to >= from && (off || shift !== '') && reason.trim() !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('shift-requests.add', { kind: 'change', from_day: from, to_day: to, shift_type: off ? '' : shift, reason: reason.trim() }), READS.requests);
    setBusy(false);
    if (r !== null) {
      sent(t('time.req.shift_what'));
      onClose();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('time.req.shift_title')} footer={<Footer onClose={onClose} onSend={() => void send()} busy={busy} ok={ok} />}>
      <div className="flex flex-col gap-3">
        <Field label={t('time.req.days')}>
          <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('time.req.days')} />
        </Field>
        <Toggle checked={off} onChange={setOff} label={t('time.req.day_off')} />
        {!off && (
          <Field label={t('time.req.shift')}>
            <Picker value={shift} onChange={setShift} items={items} label={t('time.req.shift')} placeholder={t('time.req.pick_shift')} />
          </Field>
        )}
        <Field label={t('time.req.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={t('time.req.reason_shift_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

interface Colleague {
  employment: string;
  number: string;
  name: string;
  shift_name: string;
  start: string;
  end: string;
}

/** A swap with a colleague: they agree first, then the manager decides. */
export function SwapDialog({ open, onClose, today, day: day0 }: { open: boolean; onClose: () => void; today: string; day?: string | undefined }): React.JSX.Element | null {
  const [day, setDay] = useState(day0 ?? addDays(today, 1));
  const [theirDay, setTheirDay] = useState(day0 ?? addDays(today, 1));
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useOp<{ colleagues: Colleague[] }>('shifts.colleagues', { day: theirDay }, READS.week, { skip: !open });
  useEffect(() => {
    if (open) {
      setDay(day0 ?? addDays(today, 1));
      setTheirDay(day0 ?? addDays(today, 1));
      setWho('');
      setReason('');
    }
  }, [open, today, day0]);
  const items = useMemo(() => (list.data?.colleagues ?? []).map((c) => ({ value: c.employment, label: c.name, sub: c.shift_name !== '' ? c.shift_name + ' ' + c.start + ' to ' + c.end : t('time.no_shift'), person: true })), [list.data]);
  const ok = day !== '' && who !== '' && reason.trim() !== '';
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('shift-requests.add', { kind: 'swap', from_day: day, swap_with: who, swap_day: theirDay, reason: reason.trim() }), READS.requests);
    setBusy(false);
    if (r !== null) {
      sent(t('time.req.swap_what'));
      onClose();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('time.req.swap_title')} footer={<Footer onClose={onClose} onSend={() => void send()} busy={busy} ok={ok} />}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('time.req.my_day')}>
            <DayPicker value={day} onChange={(d) => (setDay(d), setTheirDay(d))} min={today} label={t('time.req.my_day')} />
          </Field>
          <Field label={t('time.req.their_day')}>
            <DayPicker value={theirDay} onChange={setTheirDay} min={today} label={t('time.req.their_day')} />
          </Field>
        </div>
        <Field label={t('time.req.with')}>
          <Picker value={who} onChange={setWho} items={items} label={t('time.req.with')} placeholder={t('time.req.pick_colleague')} />
        </Field>
        <Field label={t('time.req.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={t('time.req.reason_swap_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

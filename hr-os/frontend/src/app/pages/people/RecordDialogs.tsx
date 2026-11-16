/**
 * Update and Edit for the effective-dated records (job, pay), as Humaans
 * does it: "Update" adds a dated row (history kept, a reason chosen), "Edit"
 * corrects a row in place (audited with before and after). Future days
 * schedule the change. Plus the end-of-employment dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { Field, Input, MoneyInput, Notice, Picker, Segmented, Textarea, majorParam, Button, Dialog, DayPicker } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { dayKey, fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import { departmentOutline, pickItems, useDepartments, useOrgList } from './data.ts';
import type { DirectoryRow, Directory, EmploymentDetail, JobRecord, PayRecord } from './types.ts';
import { useOp } from '../../lib/live.ts';

const RECORD_READS = ['job_records', 'pay_records', 'tax_profiles', 'employments', 'employees'];

export type JobReason = 'promotion' | 'transfer' | 'change' | 'correction';
export type PayReason = 'hire' | 'raise' | 'promotion' | 'adjustment' | 'change' | 'correction';

/**
 * A refusal of a job or pay change in plain words: the server's codes and the
 * param it names (never its text with field names in it), else its message.
 */
function recordError(e: unknown, employment: EmploymentDetail, day: string): string {
  const err = e as { code?: string; data?: Record<string, unknown> };
  const f = { entity: employment.entity };
  if (err.code === 'invalid_param' && err.data?.['param'] === 'effective_from') {
    if (employment.end_day !== '' && day > employment.end_day) return t('record.err.after_end', { day: fmtDay(employment.end_day, { ...f, year: 'always' }) });
    return t('record.err.before_start', { day: fmtDay(employment.start_day, { ...f, year: 'always' }) });
  }
  if (err.code === 'invalid_param' && err.data?.['param'] === 'reason') return t('record.err.reason');
  if (err.code === 'exists') return t('record.err.exists', { day: fmtDay(String(err.data?.['effective_from'] ?? day), { ...f, year: 'always' }) });
  return errMessage(e);
}

/** The first day a change can take effect: today, or the first day when the employment has not started yet. */
function firstDay(employment: EmploymentDetail): string {
  const now = dayKey();
  return employment.start_day > now ? employment.start_day : now;
}

/** People as Picker items (managers), from the directory. */
export function usePeopleItems(entity: string): { value: string; label: string; sub: string; person: true }[] {
  const live = useOp<Directory>('people.directory', { status: 'current', limit: 500, entity: entity === '' ? undefined : entity }, ['employees', 'employments', 'job_records'], { name: 'people.pick' });
  return useMemo(() => (live.data?.people ?? []).map((p: DirectoryRow) => ({ value: p.employee, label: p.name, sub: [p.title, p.department_name].filter((x) => x !== '').join(' · '), person: true as const })), [live.data]);
}

export function JobDialog({ open, onClose, employment, record, mode }: { open: boolean; onClose: () => void; employment: EmploymentDetail; record: JobRecord | null; mode: 'update' | 'edit' }): React.JSX.Element | null {
  const base = record ?? employment.job;
  const [day, setDay] = useState(dayKey());
  const [reason, setReason] = useState<JobReason>('change');
  const [title, setTitle] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [manager, setManager] = useState('');
  const [location, setLocation] = useState('');
  const [grade, setGrade] = useState('');
  const [etype, setEtype] = useState('');
  const [fte, setFte] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const departments = useDepartments(employment.entity);
  const locations = useOrgList('locations', employment.entity).items;
  const titles = useOrgList('titles').items;
  const grades = useOrgList('grades', employment.entity).items;
  const types = useOrgList('employment-types').items;
  const people = usePeopleItems(employment.entity).filter((p) => p.value !== employment.employee);
  useEffect(() => {
    if (!open) return;
    setDay(mode === 'edit' && record !== null ? record.effective_from : firstDay(employment));
    setReason(mode === 'edit' && record !== null ? ((record.reason as JobReason) ?? 'change') : 'change');
    setTitle(base?.title ?? '');
    setJobTitle(base?.job_title ?? '');
    setDepartment(base?.department ?? '');
    setManager(base?.manager ?? '');
    setLocation(base?.location ?? '');
    setGrade(base?.grade ?? '');
    setEtype(base?.employment_type ?? '');
    setFte(String(base?.fte ?? 1));
    setNote(mode === 'edit' ? (record?.note ?? '') : '');
    setError(null);
    // Reset only when the dialog opens (a live reload must not wipe what is being typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, record?.id]);
  if (!open) return null;
  const fteN = Number(fte);
  const ok = !Number.isNaN(fteN) && fteN > 0 && fteN <= 1.5 && (mode === 'edit' || day !== '');
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const fields = { title, job_title: jobTitle, department, manager, location, grade, employment_type: etype, fte: fteN, note };
    try {
      if (mode === 'update') await op('job.update', { employment: employment.id, effective_from: day, reason, ...fields }, { quiet: true });
      else await op('job.edit', { record: record?.id ?? '', ...(record?.reason === 'hire' ? {} : { reason }), ...fields }, { quiet: true });
      changed(...RECORD_READS);
      toast.success(mode === 'update' ? (day > dayKey() ? t('record.scheduled', { day: fmtDay(day) }) : t('record.updated')) : t('record.corrected'));
      onClose();
    } catch (e) {
      setError(recordError(e, employment, day));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'update' ? t('record.update_job') : t('record.edit_job')}
      meta={mode === 'edit' && record !== null ? t('record.correcting', { day: fmtDay(record.effective_from, { year: 'always' }) }) : undefined}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {mode === 'update' ? (day > dayKey() ? t('record.schedule_btn') : t('record.save_change')) : t('record.save_correction')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mode === 'update' && (
          <>
            <Field label={t('record.from')} hint={day > dayKey() ? t('record.future_hint') : undefined}>
              <DayPicker value={day} onChange={setDay} min={employment.start_day} label={t('record.from')} />
            </Field>
            <Field label={t('record.reason')}>
              <Segmented value={reason} onChange={setReason} label={t('record.reason')} size="sm" options={(['promotion', 'transfer', 'change'] as const).map((r) => ({ value: r, label: t(`record.reason.${r}`) }))} />
            </Field>
          </>
        )}
        {mode === 'edit' && record?.reason !== 'hire' && (
          <Field label={t('record.reason')} className="sm:col-span-2">
            <Segmented value={reason} onChange={setReason} label={t('record.reason')} size="sm" options={(['promotion', 'transfer', 'change', 'correction'] as const).map((r) => ({ value: r, label: t(`record.reason.${r}`) }))} />
          </Field>
        )}
        <Field label={t('people.col.title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('people.col.title')} />
        </Field>
        <Field label={t('record.job_title')} optional help={t('record.job_title_help')}>
          <Picker value={jobTitle} onChange={(v, it) => (setJobTitle(v), it !== null && title === '' && setTitle(it.label))} items={pickItems(titles)} label={t('record.job_title')} clearable />
        </Field>
        <Field label={t('people.col.department')}>
          <Picker value={department} onChange={setDepartment} items={departmentOutline(departments ?? []).map(({ dept, depth }) => ({ value: dept.id, label: '  '.repeat(depth) + dept.name }))} label={t('people.col.department')} clearable />
        </Field>
        <Field label={t('people.col.manager')}>
          <Picker value={manager} onChange={setManager} items={people} label={t('people.col.manager')} clearable />
        </Field>
        <Field label={t('people.col.location')}>
          <Picker value={location} onChange={setLocation} items={pickItems(locations)} label={t('people.col.location')} clearable />
        </Field>
        <Field label={t('record.employment_type')}>
          <Picker value={etype} onChange={setEtype} items={pickItems(types)} label={t('record.employment_type')} />
        </Field>
        <Field label={t('record.grade')} optional>
          <Picker value={grade} onChange={setGrade} items={pickItems(grades, (g) => String(g['name'] ?? ''))} label={t('record.grade')} clearable />
        </Field>
        <Field label={t('record.fte')} help={t('record.fte_help')}>
          <Input value={fte} onChange={(e) => setFte(e.target.value)} inputMode="decimal" className="hr-mono" aria-label={t('record.fte')} aria-invalid={!(fteN > 0 && fteN <= 1.5)} />
        </Field>
        <Field label={t('record.note')} optional className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} aria-label={t('record.note')} />
        </Field>
      </div>
      {error !== null && (
        <Notice tone="bad" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

export function PayDialog({ open, onClose, employment, record, mode }: { open: boolean; onClose: () => void; employment: EmploymentDetail; record: PayRecord | null; mode: 'update' | 'edit' }): React.JSX.Element | null {
  const base = record ?? employment.pay;
  const cur = employment.currency;
  // No pay yet (a joiner): the first pay starts on the first day, as "Starting pay".
  const starting = employment.pay === null && record === null;
  const [day, setDay] = useState(starting ? employment.start_day : firstDay(employment));
  const [reason, setReason] = useState<PayReason>(starting ? 'hire' : 'raise');
  const [basis, setBasis] = useState<'salary' | 'hourly' | 'daily'>('salary');
  const [per, setPer] = useState<'year' | 'month' | 'week' | 'day' | 'hour'>('month');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setDay(mode === 'edit' && record !== null ? record.effective_from : starting ? employment.start_day : firstDay(employment));
    setReason(mode === 'edit' && record !== null ? ((record.reason as PayReason) ?? 'change') : starting ? 'hire' : 'raise');
    setBasis(base?.basis ?? 'salary');
    setPer(base?.per ?? 'month');
    setAmount(base?.amount_minor ?? null);
    setNote(mode === 'edit' ? (record?.note ?? '') : '');
    setError(null);
    // Reset only when the dialog opens (a live reload must not wipe what is being typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, record?.id]);
  if (!open) return null;
  const change = base !== null && amount !== null && base.amount_minor > 0 && basis === base.basis && per === base.per ? (amount - base.amount_minor) / base.amount_minor : null;
  const ok = amount !== null && amount > 0;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const fields = { basis, per: basis === 'hourly' ? 'hour' : basis === 'daily' ? 'day' : per, amount: majorParam(amount, cur), note };
    try {
      if (mode === 'update') await op('pay.update', { employment: employment.id, effective_from: day, reason, ...fields }, { quiet: true });
      else await op('pay.edit', { record: record?.id ?? '', ...(record?.reason === 'hire' ? {} : { reason }), ...fields }, { quiet: true });
      changed(...RECORD_READS);
      toast.success(mode === 'update' ? (day > dayKey() ? t('record.scheduled', { day: fmtDay(day) }) : t('record.updated')) : t('record.corrected'));
      onClose();
    } catch (e) {
      setError(recordError(e, employment, day));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'update' ? (starting ? t('record.starting_pay') : t('record.update_pay')) : t('record.edit_pay')}
      meta={mode === 'edit' && record !== null ? t('record.correcting', { day: fmtDay(record.effective_from, { year: 'always' }) }) : cur}
      width={500}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {mode === 'update' ? (day > dayKey() ? t('record.schedule_btn') : t('record.save_change')) : t('record.save_correction')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mode === 'update' && (
          <>
            <Field label={t('record.from')} hint={day > dayKey() ? t('record.future_hint') : undefined}>
              <DayPicker value={day} onChange={setDay} min={employment.start_day} label={t('record.from')} />
            </Field>
            <Field label={t('record.reason')}>
              <Segmented value={reason} onChange={setReason} label={t('record.reason')} size="sm" options={((starting ? ['hire', 'adjustment'] : ['raise', 'promotion', 'adjustment']) as PayReason[]).map((r) => ({ value: r, label: r === 'hire' ? t('record.reason.starting_pay') : t(`record.reason.${r}`) }))} />
            </Field>
          </>
        )}
        <Field label={t('record.basis')} className="sm:col-span-2">
          <Segmented
            value={basis}
            onChange={(v) => {
              setBasis(v);
              setPer(v === 'hourly' ? 'hour' : v === 'daily' ? 'day' : 'month');
            }}
            label={t('record.basis')}
            size="sm"
            options={(['salary', 'hourly', 'daily'] as const).map((b) => ({ value: b, label: t(`record.basis.${b}`) }))}
          />
        </Field>
        <Field label={t('record.amount')} hint={change !== null && change !== 0 ? t('record.change_pct', { pct: `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%` }) : undefined}>
          <MoneyInput value={amount} onChange={setAmount} currency={cur} label={t('record.amount')} autoFocus />
        </Field>
        {basis === 'salary' && (
          <Field label={t('record.per')}>
            <Segmented value={per} onChange={setPer} label={t('record.per')} size="sm" options={(['month', 'year'] as const).map((p) => ({ value: p, label: t(`record.per.${p}`) }))} />
          </Field>
        )}
        <Field label={t('record.note')} optional className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} aria-label={t('record.note')} />
        </Field>
      </div>
      {error !== null && (
        <Notice tone="bad" className="mt-3">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

export function EndDialog({ open, onClose, employment, name }: { open: boolean; onClose: () => void; employment: EmploymentDetail; name: string }): React.JSX.Element | null {
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDay(employment.end_day !== '' ? employment.end_day : '');
      setReason(employment.end_reason);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('employments.end', { employment: employment.id, end_day: day, reason }, { quiet: true });
      changed(...RECORD_READS);
      toast.success(t('record.end_saved', { name, day: fmtDay(day, { year: 'always' }) }));
      onClose();
    } catch (e) {
      setError(recordError(e, employment, day));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('record.end_title', { name })}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={day === ''} onClick={() => void save()}>
            {t('record.end_save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('record.last_day')}>
          <DayPicker value={day} onChange={setDay} min={employment.start_day} label={t('record.last_day')} />
        </Field>
        <Field label={t('record.end_reason')} optional>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('record.end_reason')} />
        </Field>
        <p className="text-[12px] leading-4 text-[var(--hr-muted)]">{t('record.end_note')}</p>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/**
 * The kernel's profile tabs: Overview, Job and pay, Personal, Bank and IDs,
 * Documents and Skills. Module tabs come from each module's index.tsx.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Check, Download, Eye, FileCheck2, FileText, Landmark, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Checkbox, DayPicker, Dialog, Empty, Fact, FactValue, Field, FileDrop, IconButton, Input, LinkButton, Loading, Money, Notice, Panel, PersonChip, Picker, Segmented, Select, StatusDot, Tag, Textarea, Timeline, confirmAsk } from '../../components/ui.tsx';
import type { TimelineItem } from '../../components/ui.tsx';
import { download, errMessage, op, opForm } from '../../lib/api.ts';
import { dayKey, fmtDay, humanize, relDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import { PROFILE_READS } from './Profile.tsx';
import { JobDialog, PayDialog } from './RecordDialogs.tsx';
import type { BankAccount, Dependant, DocumentRow, EmergencyContact, Employee, EmploymentDetail, IdentityDoc, JobRecord, PayRecord, Profile, ProfileFieldDef, Timeline as TL } from './types.ts';
import { TaxFields } from './Hire.tsx';

/** A value, or a muted "None" when it is empty. */
function dash(v: string | undefined | null): React.ReactNode {
  return v === undefined || v === null || v === '' ? <span className="text-[var(--hr-muted)]">{t('ui.none')}</span> : v;
}

/* --------------------------------------------------------------- overview */

export function OverviewTab({ p, employment, onJob }: { p: Profile; employment: EmploymentDetail; onJob: () => void }): React.JSX.Element {
  const j = employment.job;
  const facts = p.facts.flatMap((m) => m.facts ?? []);
  // Title, department, manager and location sit in the header card above; here the rest, and only what is set.
  const jobFacts: { label: string; value: React.ReactNode; mono?: boolean }[] = [];
  if (j !== null) {
    if (j.employment_type_name !== '') jobFacts.push({ label: t('record.employment_type'), value: j.employment_type_name });
    jobFacts.push({ label: t('record.fte'), value: String(j.fte), mono: true });
    if (j.grade_code !== '') jobFacts.push({ label: t('record.grade'), value: j.grade_code });
    if (j.schedule_name !== '') jobFacts.push({ label: t('record.schedule'), value: j.schedule_name });
    if (j.calendar_code !== '') jobFacts.push({ label: t('record.calendar'), value: j.calendar_code });
  }
  if (employment.probation_end !== '') jobFacts.push({ label: t('record.probation_end'), value: fmtDay(employment.probation_end, { year: 'always', entity: employment.entity }), mono: true });
  const missing = j === null ? 0 : [j.grade_code, j.schedule_name, j.calendar_code].filter((x) => x === '').length;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('profile.job')} className="lg:col-span-7" aside={p.can.job ? <LinkButton onClick={onJob}>{t('record.update')}</LinkButton> : undefined}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1 sm:grid-cols-3">
          {jobFacts.map((f) => (
            <Fact key={f.label} label={f.label} mono={f.mono}>
              {f.value}
            </Fact>
          ))}
        </div>
        {p.can.job && missing > 0 && (
          <p className="mt-3 text-[12px] text-[var(--hr-muted)]">
            {t('profile.job_more')}{' '}
            <LinkButton onClick={onJob}>{t('profile.job_more_add')}</LinkButton>
          </p>
        )}
      </Panel>
      <Panel index="02" label={t('profile.contact')} className="lg:col-span-5">
        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          {p.employee.work_email !== '' && (
            <Fact label={t('profile.work_email')}>
              <a className="hr-link hr-focus hit rounded-[3px]" href={`mailto:${p.employee.work_email}`}>
                {p.employee.work_email}
              </a>
            </Fact>
          )}
          {p.employee.phone !== '' && (
            <Fact label={t('profile.phone')} mono>
              {p.employee.phone}
            </Fact>
          )}
          <Fact label={t('profile.reports')} mono>
            {p.reports > 0 ? (
              <a className="hr-link hr-focus hit rounded-[3px]" href="#/people/org">
                {p.reports}
              </a>
            ) : (
              '0'
            )}
          </Fact>
        </div>
        {p.employee.work_email === '' && p.employee.phone === '' && <p className="mt-3 text-[12px] text-[var(--hr-muted)]">{t('profile.no_contact')}</p>}
      </Panel>
      <Panel index="03" label={t('profile.coming_up')} className="lg:col-span-7">
        {employment.upcoming.length === 0 && employment.end_day === '' && !(employment.probation_end > p.as_of) ? (
          <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.nothing_scheduled')}</p>
        ) : (
          <ul className="flex flex-col">
            {employment.probation_end > p.as_of && (
              <li className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                <CalendarClock size={14} aria-hidden className="text-[var(--hr-muted)]" />
                <span className="flex-1 text-[13px]">{t('profile.probation_ends')}</span>
                <span className="hr-mono text-[12px] text-[var(--hr-ink-2)]">{fmtDay(employment.probation_end, { entity: employment.entity })}</span>
                <span className="hr-label w-20 text-right">{relDay(employment.probation_end, p.as_of)}</span>
              </li>
            )}
            {employment.upcoming.map((u) => (
              <li key={u.id} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                <CalendarClock size={14} aria-hidden className="text-[var(--hr-rh)]" />
                <span className="flex-1 text-[13px]">{u.reason === 'hire' ? t('profile.first_day') : t(`profile.upcoming.${u.kind}`, { reason: t(`record.reason.${u.reason}`) })}</span>
                <span className="hr-mono text-[12px] text-[var(--hr-ink-2)]">{fmtDay(u.effective_from, { entity: employment.entity })}</span>
                <span className="hr-label w-20 text-right">{relDay(u.effective_from, p.as_of)}</span>
              </li>
            ))}
            {employment.end_day !== '' && (
              <li className="flex items-center gap-3 py-2">
                <CalendarClock size={14} aria-hidden className="text-[var(--hr-warn)]" />
                <span className="flex-1 text-[13px]">{t('profile.last_day')}</span>
                <span className="hr-mono text-[12px] text-[var(--hr-ink-2)]">{fmtDay(employment.end_day, { entity: employment.entity })}</span>
                <span className="hr-label w-20 text-right">{relDay(employment.end_day, p.as_of)}</span>
              </li>
            )}
          </ul>
        )}
      </Panel>
      <Panel index="04" label={t('profile.at_a_glance')} className="lg:col-span-5">
        {facts.length === 0 ? (
          <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.no_facts')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {facts.map((f, i) => (
              <Fact key={f.key !== '' ? f.key : i} label={f.label}>
                {f.link !== undefined && f.link !== '' ? (
                  <a href={f.link} className="hr-link hr-focus hit rounded-[3px]">
                    <FactValue fact={f} entity={employment.entity} />
                  </a>
                ) : (
                  <FactValue fact={f} entity={employment.entity} />
                )}
              </Fact>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ job and pay */

function jobLines(r: JobRecord, prev: JobRecord | undefined): TimelineItem['lines'] {
  const out: NonNullable<TimelineItem['lines']> = [];
  const add = (label: string, a: string, b: string | undefined): void => {
    if (prev === undefined) {
      if (a !== '') out.push({ label, after: a });
    } else if (a !== b) out.push({ label, before: b ?? '', after: a === '' ? t('ui.none') : a });
  };
  add(t('people.col.title'), r.title, prev?.title);
  add(t('people.col.department'), r.department_name, prev?.department_name);
  add(t('people.col.manager'), r.manager_name, prev?.manager_name);
  add(t('people.col.location'), r.location_name, prev?.location_name);
  add(t('record.employment_type'), r.employment_type_name, prev?.employment_type_name);
  add(t('record.grade'), r.grade_code, prev?.grade_code);
  add(t('record.fte'), String(r.fte), prev !== undefined ? String(prev.fte) : undefined);
  return out;
}

function payText(r: PayRecord): React.JSX.Element {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <Money minor={r.amount_minor} currency={r.currency} />
      <span className="text-[12px] text-[var(--hr-muted)]">{t(`record.per_short.${r.per}`)}</span>
    </span>
  );
}

function TaxDialog({ open, onClose, employment, fields, values }: { open: boolean; onClose: () => void; employment: EmploymentDetail; fields: ProfileFieldDef[]; values: Record<string, unknown> }): React.JSX.Element | null {
  const [v, setV] = useState<Record<string, unknown>>(values);
  const [day, setDay] = useState(dayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setV(values);
      setDay(dayKey());
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('tax.update', { employment: employment.id, effective_from: day, fields: v }, { quiet: true });
      changed(...PROFILE_READS);
      toast.success(t('profile.tax_saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('profile.tax_update')}
      meta={employment.country}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {day > dayKey() ? t('record.schedule_btn') : t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('record.from')} className="max-w-[240px]">
          <DayPicker value={day} onChange={setDay} min={employment.start_day} label={t('record.from')} />
        </Field>
        <TaxFields fields={fields} values={v} onChange={setV} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function JobPayTab({ p, employment }: { p: Profile; employment: EmploymentDetail }): React.JSX.Element {
  const live = useOp<TL>('people.timeline', { employment: employment.id }, PROFILE_READS, { name: 'people.timeline' });
  const [jobEdit, setJobEdit] = useState<JobRecord | null>(null);
  const [payEdit, setPayEdit] = useState<PayRecord | null>(null);
  const [jobNew, setJobNew] = useState(false);
  const [payNew, setPayNew] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const tl = live.data;
  if (tl === null) return <Loading />;
  const removeRecord = async (kind: 'job' | 'pay', id: string, day: string): Promise<void> => {
    const ok = await confirmAsk(t('record.remove_text', { day: fmtDay(day, { year: 'always' }) }), t('record.remove_title'), t('ui.remove'));
    if (!ok) return;
    try {
      await op(kind === 'job' ? 'job.delete' : 'pay.delete', { record: id });
      changed(...PROFILE_READS);
    } catch {
      /* toast shown */
    }
  };
  const jobs = [...tl.job].reverse();
  const jobItems: TimelineItem[] = jobs.map((r, i) => ({
    id: r.id,
    day: r.effective_from,
    state: r.state ?? 'past',
    title: t(`record.reason.${r.reason}`),
    lines: jobLines(r, jobs[i + 1]),
    meta: r.note !== '' ? r.note : undefined,
    actions: p.can.job ? (
      <span className="flex items-center gap-2">
        <LinkButton onClick={() => setJobEdit(r)}>{t('record.edit')}</LinkButton>
        {r.state === 'scheduled' && (
          <LinkButton tone="danger" onClick={() => void removeRecord('job', r.id, r.effective_from)}>
            {t('ui.remove')}
          </LinkButton>
        )}
      </span>
    ) : undefined,
  }));
  const pays = [...(tl.pay ?? [])].reverse();
  const payItems: TimelineItem[] = pays.map((r, i) => {
    const prev = pays[i + 1];
    return {
      id: r.id,
      day: r.effective_from,
      state: r.state ?? 'past',
      title: t(`record.reason.${r.reason}`),
      lines: [{ label: t('record.amount'), before: prev !== undefined ? payText(prev) : undefined, after: payText(r) }, ...(prev === undefined || prev.basis !== r.basis ? [{ label: t('record.basis'), after: t(`record.basis.${r.basis}`) }] : [])],
      meta: r.note !== '' ? r.note : undefined,
      actions: p.can.pay ? (
        <span className="flex items-center gap-2">
          <LinkButton onClick={() => setPayEdit(r)}>{t('record.edit')}</LinkButton>
          {r.state === 'scheduled' && (
            <LinkButton tone="danger" onClick={() => void removeRecord('pay', r.id, r.effective_from)}>
              {t('ui.remove')}
            </LinkButton>
          )}
        </span>
      ) : undefined,
    };
  });
  const tax = (tl.tax ?? []).find((x) => x.state === 'current') ?? (tl.tax ?? [])[0] ?? null;
  const taxFields = (employment.profile_fields ?? []).filter((f) => f.scope !== 'entity');
  const labelOf = (k: string): string => taxFields.find((f) => f.key === k)?.label ?? humanize(k);
  const shownValue = (k: string, v: unknown): string => {
    const f = taxFields.find((x) => x.key === k);
    if (typeof v === 'boolean') return v ? t('ui.yes') : t('ui.no');
    return f?.options?.find((o) => o.value === String(v))?.label ?? String(v);
  };
  const canTax = (p.can.pay || p.can.edit_self) && taxFields.length > 0;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel index="01" label={t('profile.job_history')} aside={p.can.job ? <Button size="sm" icon={Plus} onClick={() => setJobNew(true)}>{t('record.update')}</Button> : undefined}>
        <div className="pt-1">
          <Timeline items={jobItems} empty={<p className="text-[12px] text-[var(--hr-muted)]">{t('profile.no_records')}</p>} />
        </div>
      </Panel>
      <div className="flex min-w-0 flex-col gap-3">
        <Panel index="02" label={t('profile.pay_history')} aside={p.can.pay && !tl.pay_hidden ? <Button size="sm" icon={Plus} onClick={() => setPayNew(true)}>{t('record.update')}</Button> : undefined}>
          {tl.pay_hidden ? (
            <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.pay_hidden')}</p>
          ) : (
            <div className="pt-1">
              <Timeline items={payItems} empty={<Empty icon={Landmark} title={t('profile.no_pay')} className="py-4" action={p.can.pay ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setPayNew(true)}>{t('profile.set_pay')}</Button> : undefined} />} />
            </div>
          )}
        </Panel>
        {!tl.pay_hidden && (
          <Panel index="03" label={t('profile.tax_profile')} aside={canTax ? <Button size="sm" icon={Pencil} onClick={() => setTaxOpen(true)}>{t('record.update')}</Button> : undefined}>
            {tax === null ? (
              <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.no_tax')}</p>
            ) : (
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="hr-label mr-1">{t('profile.packs')}</span>
                  {tax.packs.length === 0 ? <span className="text-[12px] text-[var(--hr-muted)]">{t('ui.none')}</span> : tax.packs.map((k) => <Tag key={k}>{k}</Tag>)}
                </div>
                {Object.keys(tax.fields).length === 0 ? (
                  <p className="text-[12px] text-[var(--hr-muted)]">{t('profile.tax_defaults')}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {Object.entries(tax.fields).map(([k, v]) => (
                      <Fact key={k} label={labelOf(k)}>
                        {shownValue(k, v)}
                      </Fact>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
        )}
        <Panel index="04" label={t('profile.changes')}>
          {tl.changes.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.no_changes')}</p>
          ) : (
            <ul className="flex flex-col">
              {tl.changes.slice(0, 12).map((c) => (
                <li key={c.id} className="flex items-start gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                  <span className="hr-mono w-[86px] shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtDay(c.at)}</span>
                  <span className="hr-wrap min-w-0 flex-1 text-[13px]">{c.summary}</span>
                  <span className="shrink-0 text-[12px] text-[var(--hr-muted)]">{c.actor === 'agent' ? <Tag tone="agent">{t('ui.agent_short')}</Tag> : c.who}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <JobDialog open={jobNew} onClose={() => setJobNew(false)} employment={employment} record={null} mode="update" />
      <JobDialog open={jobEdit !== null} onClose={() => setJobEdit(null)} employment={employment} record={jobEdit} mode="edit" />
      <PayDialog open={payNew} onClose={() => setPayNew(false)} employment={employment} record={null} mode="update" />
      <PayDialog open={payEdit !== null} onClose={() => setPayEdit(null)} employment={employment} record={payEdit} mode="edit" />
      <TaxDialog open={taxOpen} onClose={() => setTaxOpen(false)} employment={employment} fields={taxFields} values={tax?.fields ?? {}} />
    </div>
  );
}

/* --------------------------------------------------------------- personal */

function PersonalDialog({ open, onClose, e, self, country }: { open: boolean; onClose: () => void; e: Employee; self: boolean; country: string }): React.JSX.Element | null {
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setF({
      legal_name: e.legal_name,
      preferred_name: e.preferred_name,
      family_name: e.family_name,
      given_name: e.given_name,
      name_order: e.name_order,
      birth_date: e.birth_date ?? '',
      gender: e.gender ?? '',
      nationality: e.nationality ?? '',
      work_email: e.work_email,
      personal_email: e.personal_email ?? '',
      phone: e.phone,
      kana_family: e.kana?.['family'] ?? '',
      kana_given: e.kana?.['given'] ?? '',
      line1: e.address?.['line1'] ?? '',
      line2: e.address?.['line2'] ?? '',
      city: e.address?.['city'] ?? '',
      region: e.address?.['region'] ?? '',
      postcode: e.address?.['postcode'] ?? '',
      country: e.address?.['country'] ?? country,
    });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const jp = country === 'JP' || (e.kana !== undefined && Object.keys(e.kana).length > 0);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const address = { line1: f['line1'] ?? '', line2: f['line2'] ?? '', city: f['city'] ?? '', region: f['region'] ?? '', postcode: f['postcode'] ?? '', country: (f['country'] ?? '').toUpperCase() };
    const params: Record<string, unknown> = self
      ? { employee: e.id, preferred_name: f['preferred_name'], phone: f['phone'], personal_email: f['personal_email'], gender: f['gender'], address, ...(jp ? { kana: { family: f['kana_family'], given: f['kana_given'] } } : {}) }
      : {
          employee: e.id,
          legal_name: f['legal_name'],
          preferred_name: f['preferred_name'],
          family_name: f['family_name'],
          given_name: f['given_name'],
          name_order: f['name_order'],
          birth_date: f['birth_date'],
          gender: f['gender'],
          nationality: (f['nationality'] ?? '').toUpperCase(),
          work_email: f['work_email'],
          personal_email: f['personal_email'],
          phone: f['phone'],
          address,
          ...(jp ? { kana: { family: f['kana_family'], given: f['kana_given'] } } : {}),
        };
    try {
      await op('people.update', params, { quiet: true });
      changed(...PROFILE_READS);
      toast.success(t('ui.saved'));
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const ro = self;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('profile.edit_personal')}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hire.legal_name')} className="sm:col-span-2">
          <Input value={f['legal_name'] ?? ''} onChange={set('legal_name')} disabled={ro} aria-label={t('hire.legal_name')} />
        </Field>
        <Field label={t('hire.family_name')}>
          <Input value={f['family_name'] ?? ''} onChange={set('family_name')} disabled={ro} aria-label={t('hire.family_name')} />
        </Field>
        <Field label={t('hire.given_name')}>
          <Input value={f['given_name'] ?? ''} onChange={set('given_name')} disabled={ro} aria-label={t('hire.given_name')} />
        </Field>
        {jp && (
          <>
            <Field label={t('hire.kana_family')}>
              <Input value={f['kana_family'] ?? ''} onChange={set('kana_family')} aria-label={t('hire.kana_family')} />
            </Field>
            <Field label={t('hire.kana_given')}>
              <Input value={f['kana_given'] ?? ''} onChange={set('kana_given')} aria-label={t('hire.kana_given')} />
            </Field>
          </>
        )}
        <Field label={t('hire.preferred_name')} optional>
          <Input value={f['preferred_name'] ?? ''} onChange={set('preferred_name')} aria-label={t('hire.preferred_name')} />
        </Field>
        <Field label={t('hire.name_order')}>
          <Select value={f['name_order'] ?? 'given_first'} onChange={set('name_order')} disabled={ro} aria-label={t('hire.name_order')}>
            <option value="given_first">{t('hire.order.given_first')}</option>
            <option value="family_first">{t('hire.order.family_first')}</option>
          </Select>
        </Field>
        <Field label={t('hire.birth_date')}>
          <DayPicker value={f['birth_date'] ?? ''} onChange={(v) => setF((x) => ({ ...x, birth_date: v }))} max={dayKey()} label={t('hire.birth_date')} disabled={ro} clearable />
        </Field>
        <Field label={t('hire.gender')} optional>
          <Input value={f['gender'] ?? ''} onChange={set('gender')} aria-label={t('hire.gender')} placeholder={t('hire.gender_ph')} />
        </Field>
        <Field label={t('hire.nationality')} optional>
          <Input value={f['nationality'] ?? ''} onChange={set('nationality')} maxLength={2} className="hr-mono uppercase" disabled={ro} aria-label={t('hire.nationality')} placeholder="SG" />
        </Field>
        <Field label={t('profile.work_email')}>
          <Input value={f['work_email'] ?? ''} onChange={set('work_email')} type="email" disabled={ro} aria-label={t('profile.work_email')} />
        </Field>
        <Field label={t('hire.personal_email')} optional>
          <Input value={f['personal_email'] ?? ''} onChange={set('personal_email')} type="email" aria-label={t('hire.personal_email')} />
        </Field>
        <Field label={t('profile.phone')}>
          <Input value={f['phone'] ?? ''} onChange={set('phone')} type="tel" aria-label={t('profile.phone')} />
        </Field>
        <Field label={t('profile.address')} className="sm:col-span-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={f['line1'] ?? ''} onChange={set('line1')} placeholder={t('profile.addr.line1')} aria-label={t('profile.addr.line1')} className="sm:col-span-2" />
            <Input value={f['line2'] ?? ''} onChange={set('line2')} placeholder={t('profile.addr.line2')} aria-label={t('profile.addr.line2')} className="sm:col-span-2" />
            <Input value={f['city'] ?? ''} onChange={set('city')} placeholder={t('profile.addr.city')} aria-label={t('profile.addr.city')} />
            <Input value={f['region'] ?? ''} onChange={set('region')} placeholder={t('profile.addr.region')} aria-label={t('profile.addr.region')} />
            <Input value={f['postcode'] ?? ''} onChange={set('postcode')} placeholder={t('profile.addr.postcode')} aria-label={t('profile.addr.postcode')} className="hr-mono" />
            <Input value={f['country'] ?? ''} onChange={set('country')} placeholder={t('profile.addr.country')} aria-label={t('profile.addr.country')} maxLength={2} className="hr-mono uppercase" />
          </div>
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

function ListEditor<T extends Record<string, unknown>>({ open, onClose, title, items, blank, fields, save }: { open: boolean; onClose: () => void; title: string; items: T[]; blank: T; fields: { key: keyof T & string; label: string; type?: 'text' | 'day' | 'bool' | undefined; wide?: boolean | undefined }[]; save: (list: T[]) => Promise<void> }): React.JSX.Element | null {
  const [list, setList] = useState<T[]>(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setList(items.length > 0 ? items : [{ ...blank }]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const upd = (i: number, k: string, v: unknown): void => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={640}
      footer={
        <>
          <Button variant="ghost" icon={Plus} onClick={() => setList((l) => [...l, { ...blank }])} className="mr-auto">
            {t('ui.add_row')}
          </Button>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              save(list.filter((x) => String(x['name'] ?? '').trim() !== ''))
                .then(onClose)
                .catch((e: unknown) => setError(errMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {list.map((row, i) => (
          <div key={i} className="relative grid grid-cols-1 gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-panel)] p-3 pr-10 sm:grid-cols-2">
            {fields.map((f) =>
              f.type === 'bool' ? (
                <Checkbox key={f.key} checked={row[f.key] === true} onChange={(v) => upd(i, f.key, v)} label={f.label} />
              ) : f.type === 'day' ? (
                <Field key={f.key} label={f.label}>
                  <DayPicker value={String(row[f.key] ?? '')} onChange={(v) => upd(i, f.key, v)} label={f.label} max={dayKey()} clearable />
                </Field>
              ) : (
                <Field key={f.key} label={f.label} className={f.wide === true ? 'sm:col-span-2' : ''}>
                  <Input value={String(row[f.key] ?? '')} onChange={(e) => upd(i, f.key, e.target.value)} aria-label={f.label} />
                </Field>
              ),
            )}
            <IconButton icon={X} label={t('ui.remove')} tone="danger" size={26} onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="absolute right-2 top-2" />
          </div>
        ))}
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function PersonalTab({ p, country }: { p: Profile; country: string }): React.JSX.Element {
  const e = p.employee;
  const [edit, setEdit] = useState(false);
  const [contacts, setContacts] = useState(false);
  const [deps, setDeps] = useState(false);
  const canEdit = p.can.edit || p.can.edit_self;
  const self = !p.can.edit && p.can.edit_self;
  const a = e.address ?? {};
  const addr = [a['line1'], a['line2'], [a['city'], a['region'], a['postcode']].filter((x) => x !== undefined && x !== '').join(' '), a['country']].filter((x) => x !== undefined && x !== '').join('\n');
  // An empty detail offers to add it (or says it was not given); never a row of "None".
  const unset: React.ReactNode = canEdit ? <LinkButton onClick={() => setEdit(true)}>{t('ui.add')}</LinkButton> : <span className="text-[var(--hr-muted)]">{t('profile.not_given')}</span>;
  const val = (v: string | undefined | null): React.ReactNode => (v === undefined || v === null || v === '' ? unset : v);
  const saveList = async (key: 'emergency' | 'dependants', list: unknown[]): Promise<void> => {
    await op('people.update', { employee: e.id, [key]: list }, { quiet: true });
    changed(...PROFILE_READS);
    toast.success(t('ui.saved'));
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel index="01" label={t('profile.names_details')} aside={canEdit ? <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>{t('ui.edit')}</Button> : undefined}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
          <Fact label={t('hire.legal_name')}>{e.legal_name}</Fact>
          <Fact label={t('hire.preferred_name')}>{val(e.preferred_name)}</Fact>
          <Fact label={t('hire.family_name')}>{val(e.family_name)}</Fact>
          <Fact label={t('hire.given_name')}>{val(e.given_name)}</Fact>
          {e.kana !== undefined && (e.kana['family'] !== undefined || e.kana['given'] !== undefined) && (
            <Fact label={t('hire.kana')}>{[e.kana['family'], e.kana['given']].filter((x) => x !== undefined && x !== '').join(' ')}</Fact>
          )}
          <Fact label={t('hire.name_order')}>{t(`hire.order.${e.name_order}`)}</Fact>
          <Fact label={t('hire.birth_date')} mono>
            {e.birth_date !== undefined && e.birth_date !== '' ? fmtDay(e.birth_date, { year: 'always' }) : unset}
          </Fact>
          <Fact label={t('hire.gender')}>{val(e.gender)}</Fact>
          <Fact label={t('hire.nationality')} mono>
            {val(e.nationality)}
          </Fact>
        </div>
      </Panel>
      <Panel index="02" label={t('profile.contact')} aside={canEdit ? <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>{t('ui.edit')}</Button> : undefined}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
          <Fact label={t('profile.work_email')}>{val(e.work_email)}</Fact>
          <Fact label={t('hire.personal_email')}>{val(e.personal_email)}</Fact>
          <Fact label={t('profile.phone')} mono>
            {val(e.phone)}
          </Fact>
          <Fact label={t('profile.address')}>
            {addr !== '' ? <span className="whitespace-pre-line">{addr}</span> : unset}
          </Fact>
        </div>
      </Panel>
      <Panel index="03" label={t('profile.emergency')} aside={canEdit ? <Button size="sm" icon={(e.emergency ?? []).length > 0 ? Pencil : Plus} onClick={() => setContacts(true)}>{(e.emergency ?? []).length > 0 ? t('ui.edit') : t('ui.add')}</Button> : undefined}>
        {(e.emergency ?? []).length === 0 ? (
          <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.no_emergency')}</p>
        ) : (
          <ul className="flex flex-col">
            {(e.emergency ?? []).map((c, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium">
                    {c.name} {c.primary && <Tag className="ml-1">{t('profile.primary')}</Tag>}
                  </span>
                  <span className="block text-[12px] text-[var(--hr-muted)]">{[c.relation, c.email].filter((x) => x !== '').join(' · ')}</span>
                </span>
                <span className="hr-mono shrink-0 text-[13px]">{c.phone}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel index="04" label={t('profile.dependants')} aside={canEdit ? <Button size="sm" icon={(e.dependants ?? []).length > 0 ? Pencil : Plus} onClick={() => setDeps(true)}>{(e.dependants ?? []).length > 0 ? t('ui.edit') : t('ui.add')}</Button> : undefined}>
        {(e.dependants ?? []).length === 0 ? (
          <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('profile.no_dependants')}</p>
        ) : (
          <ul className="flex flex-col">
            {(e.dependants ?? []).map((d, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium">{d.name}</span>
                  <span className="block text-[12px] text-[var(--hr-muted)]">{[d.relation, d.birth_date !== '' ? fmtDay(d.birth_date, { year: 'always' }) : ''].filter((x) => x !== '').join(' · ')}</span>
                </span>
                {d.tax_dependant && <Tag tone="rh">{t('profile.tax_dependant')}</Tag>}
                {d.disabled && <Tag>{t('profile.disabled')}</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <PersonalDialog open={edit} onClose={() => setEdit(false)} e={e} self={self} country={country} />
      <ListEditor<EmergencyContact & Record<string, unknown>>
        open={contacts}
        onClose={() => setContacts(false)}
        title={t('profile.emergency')}
        items={(e.emergency ?? []) as (EmergencyContact & Record<string, unknown>)[]}
        blank={{ name: '', relation: '', phone: '', email: '', address: '', primary: false }}
        fields={[
          { key: 'name', label: t('profile.ec.name') },
          { key: 'relation', label: t('profile.ec.relation') },
          { key: 'phone', label: t('profile.phone') },
          { key: 'email', label: t('profile.ec.email') },
          { key: 'address', label: t('profile.address'), wide: true },
          { key: 'primary', label: t('profile.primary'), type: 'bool' },
        ]}
        save={(list) => saveList('emergency', list)}
      />
      <ListEditor<Dependant & Record<string, unknown>>
        open={deps}
        onClose={() => setDeps(false)}
        title={t('profile.dependants')}
        items={(e.dependants ?? []) as (Dependant & Record<string, unknown>)[]}
        blank={{ name: '', relation: '', birth_date: '', tax_dependant: false, disabled: false, note: '' }}
        fields={[
          { key: 'name', label: t('profile.ec.name') },
          { key: 'relation', label: t('profile.ec.relation') },
          { key: 'birth_date', label: t('hire.birth_date'), type: 'day' },
          { key: 'note', label: t('record.note') },
          { key: 'tax_dependant', label: t('profile.tax_dependant'), type: 'bool' },
          { key: 'disabled', label: t('profile.disabled'), type: 'bool' },
        ]}
        save={(list) => saveList('dependants', list)}
      />
    </div>
  );
}

/* ---------------------------------------------------------- bank and IDs */

function useReveal(): [Record<string, { value: string; until: number }>, (collection: 'bank_accounts' | 'identity_docs', id: string, field?: string) => Promise<void>] {
  const [shown, setShown] = useState<Record<string, { value: string; until: number }>>({});
  useEffect(() => {
    const h = setInterval(() => setShown((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v.until > Date.now()))), 15000);
    return () => clearInterval(h);
  }, []);
  const reveal = async (collection: 'bank_accounts' | 'identity_docs', id: string, field = 'number'): Promise<void> => {
    try {
      const r = await op<{ value: string; minutes: number }>('seal.reveal', { collection, id, field }, { pin: { title: t('bank.reveal_title'), text: t('bank.reveal_text') } });
      setShown((s) => ({ ...s, [id + field]: { value: r.value, until: Date.now() + r.minutes * 60000 } }));
    } catch {
      /* toast shown */
    }
  };
  return [shown, reveal];
}

function BankDialog({ open, onClose, employee, country, currency }: { open: boolean; onClose: () => void; employee: string; country: string; currency: string }): React.JSX.Element | null {
  const [f, setF] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<'rest' | 'percent' | 'fixed'>('rest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF({ label: t('bank.default_label'), bank_name: '', bank_code: '', branch_code: '', account_type: '', holder: '', number: '', iban: '', swift: '', value: '' });
      setSplit('rest');
      setError(null);
    }
  }, [open]);
  if (!open) return null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ok = (f['number'] ?? '').trim() !== '' && (f['bank_name'] ?? '').trim() !== '';
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('bank.add', { employee, label: f['label'], bank_name: f['bank_name'], bank_code: f['bank_code'], branch_code: f['branch_code'], account_type: f['account_type'], holder: f['holder'], number: f['number'], iban: f['iban'] !== '' ? f['iban'] : undefined, swift: f['swift'], country, currency, split: split === 'rest' ? { kind: 'rest' } : { kind: split, value: Number(f['value'] ?? 0) } }, { quiet: true });
      changed(...PROFILE_READS);
      toast.success(t('bank.sent'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('bank.add')}
      meta={`${country} · ${currency}`}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('bank.send')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('bank.label')}>
          <Input value={f['label'] ?? ''} onChange={set('label')} aria-label={t('bank.label')} />
        </Field>
        <Field label={t('bank.bank_name')}>
          <Input value={f['bank_name'] ?? ''} onChange={set('bank_name')} autoFocus aria-label={t('bank.bank_name')} />
        </Field>
        <Field label={t('bank.bank_code')} optional help={t('bank.bank_code_help')}>
          <Input value={f['bank_code'] ?? ''} onChange={set('bank_code')} className="hr-mono" aria-label={t('bank.bank_code')} />
        </Field>
        <Field label={t('bank.branch_code')} optional>
          <Input value={f['branch_code'] ?? ''} onChange={set('branch_code')} className="hr-mono" aria-label={t('bank.branch_code')} />
        </Field>
        <Field label={t('bank.number')}>
          <Input value={f['number'] ?? ''} onChange={set('number')} className="hr-mono" autoComplete="off" aria-label={t('bank.number')} />
        </Field>
        <Field label={t('bank.holder')} optional hint={t('bank.holder_hint')}>
          <Input value={f['holder'] ?? ''} onChange={set('holder')} aria-label={t('bank.holder')} />
        </Field>
        <Field label={t('bank.account_type')} optional>
          <Input value={f['account_type'] ?? ''} onChange={set('account_type')} aria-label={t('bank.account_type')} placeholder={t('bank.account_type_ph')} />
        </Field>
        <Field label={t('bank.swift')} optional>
          <Input value={f['swift'] ?? ''} onChange={set('swift')} className="hr-mono uppercase" aria-label={t('bank.swift')} />
        </Field>
        <Field label={t('bank.iban')} optional className="sm:col-span-2">
          <Input value={f['iban'] ?? ''} onChange={set('iban')} className="hr-mono uppercase" aria-label={t('bank.iban')} />
        </Field>
        <Field label={t('bank.split')} className="sm:col-span-2" help={t('bank.split_help')}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={split} onChange={setSplit} label={t('bank.split')} size="sm" options={(['rest', 'percent', 'fixed'] as const).map((k) => ({ value: k, label: t(`bank.split.${k}`) }))} />
            {split !== 'rest' && <Input value={f['value'] ?? ''} onChange={set('value')} inputMode="decimal" className="hr-mono w-28" aria-label={t('bank.split_value')} placeholder={split === 'percent' ? '50' : '500.00'} />}
          </div>
        </Field>
      </div>
      <Notice className="mt-3">{t('bank.approval_note')}</Notice>
      {error !== null && (
        <Notice tone="bad" className="mt-2">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}

function IdDialog({ open, onClose, employee, country }: { open: boolean; onClose: () => void; employee: string; country: string }): React.JSX.Element | null {
  const types = useOp<{ identity_docs: IdentityDoc[]; types: { code: string; label: string; country?: string }[] }>('ids.list', { employee }, ['identity_docs'], { name: 'ids.types', skip: !open });
  const [type, setType] = useState('');
  const [number, setNumber] = useState('');
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setType('');
      setNumber('');
      setIssued('');
      setExpires('');
      setError(null);
    }
  }, [open]);
  if (!open) return null;
  const list = types.data?.types ?? [];
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('ids.add', { employee, type: type !== '' ? type : (list[0]?.code ?? 'passport'), country, number, issued: issued === '' ? undefined : issued, expires: expires === '' ? undefined : expires }, { quiet: true });
      changed(...PROFILE_READS);
      toast.success(t('ui.saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('ids.add')}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={number.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('ids.type')} className="sm:col-span-2">
          <Select value={type !== '' ? type : (list[0]?.code ?? '')} onChange={(e) => setType(e.target.value)} aria-label={t('ids.type')}>
            {list.map((x) => (
              <option key={x.code} value={x.code}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ids.number')} className="sm:col-span-2" hint={t('ids.sealed')}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} className="hr-mono" autoComplete="off" autoFocus aria-label={t('ids.number')} />
        </Field>
        <Field label={t('ids.issued')} optional>
          <DayPicker value={issued} onChange={setIssued} label={t('ids.issued')} clearable />
        </Field>
        <Field label={t('ids.expires')} optional>
          <DayPicker value={expires} onChange={setExpires} label={t('ids.expires')} clearable />
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

const BANK_TONE: Record<BankAccount['status'], 'good' | 'warn' | 'faint' | 'bad'> = { active: 'good', pending: 'warn', retired: 'faint', rejected: 'bad' };

export function BankTab({ p, country, currency }: { p: Profile; country: string; currency: string }): React.JSX.Element {
  const [shown, reveal] = useReveal();
  const [adding, setAdding] = useState(false);
  const [idAdding, setIdAdding] = useState(false);
  const accounts = p.bank_accounts ?? [];
  const ids = p.identity_docs ?? [];
  const retire = async (b: BankAccount): Promise<void> => {
    const ok = await confirmAsk(t('bank.retire_text', { bank: b.bank_name, number: b.number_masked }), t('bank.retire'), t('bank.retire'));
    if (!ok) return;
    try {
      await op('bank.retire', { bank_account: b.id });
      changed(...PROFILE_READS);
    } catch {
      /* toast shown */
    }
  };
  const removeId = async (d: IdentityDoc): Promise<void> => {
    const ok = await confirmAsk(t('ids.remove_text'), t('ids.remove'), t('ui.remove'));
    if (!ok) return;
    try {
      await op('ids.delete', { identity_doc: d.id });
      changed(...PROFILE_READS);
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel index="01" label={t('bank.title')} aside={p.can.bank ? <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>{t('bank.add')}</Button> : undefined}>
        {accounts.length === 0 ? (
          <Empty icon={Landmark} title={t('bank.none')} className="py-6" action={p.can.bank ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('bank.add')}</Button> : undefined} />
        ) : (
          <ul className="flex flex-col">
            {accounts.map((b) => {
              const r = shown[b.id + 'number'];
              return (
                <li key={b.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0', b.status === 'retired' && 'opacity-60')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="hr-wrap text-[13px] font-medium">{b.bank_name}</span>
                      <StatusDot tone={BANK_TONE[b.status]} label={t(`bank.status.${b.status}`)} />
                    </span>
                    <span className="block text-[12px] text-[var(--hr-muted)]">{[b.label, b.holder, b.split.kind === 'rest' ? t('bank.split.rest') : b.split.kind === 'percent' ? `${b.split.value ?? 0}%` : String(b.split.value ?? '')].filter((x) => x !== '').join(' · ')}</span>
                  </span>
                  <span className="hr-mono hr-num text-[13px]">{r !== undefined ? r.value : b.number_masked}</span>
                  {p.can.reveal && r === undefined && <IconButton icon={Eye} label={t('bank.reveal')} size={28} onClick={() => void reveal('bank_accounts', b.id)} />}
                  {p.can.bank && b.status === 'active' && <IconButton icon={Trash2} label={t('bank.retire')} tone="danger" size={28} onClick={() => void retire(b)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel index="02" label={t('ids.title')} aside={p.can.edit ? <Button size="sm" icon={Plus} onClick={() => setIdAdding(true)}>{t('ids.add')}</Button> : undefined}>
        {ids.length === 0 ? (
          <Empty icon={ShieldCheck} title={t('ids.none')} className="py-6" action={p.can.edit ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setIdAdding(true)}>{t('ids.add')}</Button> : undefined} />
        ) : (
          <ul className="flex flex-col">
            {ids.map((d) => {
              const r = shown[d.id + 'number'];
              const expired = d.expires !== '' && d.expires < dayKey();
              return (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_92px] items-center gap-x-3 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{humanize(d.type)}</span>
                    <span className={cn('block text-[12px]', expired ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-muted)]')}>{[d.country, d.expires !== '' ? t('ids.expires_on', { day: fmtDay(d.expires, { year: 'always' }) }) : ''].filter((x) => x !== '').join(' · ')}</span>
                  </span>
                  <span className="hr-mono hr-num min-w-0 truncate text-[13px]">{r !== undefined ? r.value : d.number_masked}</span>
                  <span className="flex items-center justify-end gap-0.5">
                    {p.can.reveal && r === undefined && <IconButton icon={Eye} label={t('bank.reveal')} size={28} onClick={() => void reveal('identity_docs', d.id)} />}
                    {d.has_file && <IconButton icon={Download} label={t('ui.download')} size={28} onClick={() => void download('ids.file', { identity_doc: d.id }, 'open').catch(() => undefined)} />}
                    {p.can.edit && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={28} onClick={() => void removeId(d)} />}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <BankDialog open={adding} onClose={() => setAdding(false)} employee={p.employee.id} country={country} currency={currency} />
      <IdDialog open={idAdding} onClose={() => setIdAdding(false)} employee={p.employee.id} country={country} />
    </div>
  );
}

/* -------------------------------------------------------------- documents */

const DOC_CATEGORIES = ['contract', 'policy', 'id', 'certificate', 'letter', 'payslip', 'tax', 'medical', 'other'];

function UploadDialog({ file, onClose, employee, self }: { file: File | null; onClose: () => void; employee: string; self: boolean }): React.JSX.Element | null {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [ack, setAck] = useState(false);
  const [visible, setVisible] = useState(true);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (file !== null) {
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setCategory('other');
      setAck(false);
      setVisible(true);
      setExpires('');
      setError(null);
    }
  }, [file]);
  if (file === null) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await opForm('documents.add', { employee, title, category, needs_ack: self ? undefined : ack, visible_to_employee: self ? undefined : visible, expires: expires === '' ? undefined : expires }, { file }, { quiet: true });
      changed(...PROFILE_READS);
      toast.success(t('docs.added'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('docs.upload')}
      meta={file.name}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={Upload} busy={busy} disabled={title.trim() === ''} onClick={() => void save()}>
            {t('docs.upload')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('docs.title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label={t('docs.title')} />
        </Field>
        <Field label={t('docs.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('docs.category')}>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`docs.cat.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('docs.expires')} optional>
          <DayPicker value={expires} onChange={setExpires} label={t('docs.expires')} clearable />
        </Field>
        {!self && (
          <>
            <Checkbox checked={visible} onChange={setVisible} label={t('docs.visible')} />
            <Checkbox checked={ack} onChange={setAck} label={t('docs.needs_ack')} />
          </>
        )}
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function DocumentsTab({ p, self }: { p: Profile; self: boolean }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const docs = p.documents ?? [];
  const canAdd = p.can.edit || self;
  const ack = async (d: DocumentRow): Promise<void> => {
    try {
      await op('documents.ack', { document: d.id });
      changed(...PROFILE_READS);
      toast.success(t('docs.acked'));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (d: DocumentRow): Promise<void> => {
    const ok = await confirmAsk(t('docs.remove_text', { title: d.title }), t('docs.remove'), t('ui.remove'));
    if (!ok) return;
    try {
      await op('documents.delete', { document: d.id });
      changed(...PROFILE_READS);
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('docs.title_list')} className="lg:col-span-8" flush>
        {docs.length === 0 ? (
          <Empty icon={FileText} title={t('docs.none')} className="py-8">
            {canAdd ? t('docs.none_text') : undefined}
          </Empty>
        ) : (
          <ul className="flex flex-col px-3.5 pb-2">
            {docs.map((d) => (
              <li key={d.id} className="grid grid-cols-[15px_minmax(0,1fr)_60px] items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0 sm:grid-cols-[15px_minmax(0,1fr)_56px_minmax(0,160px)_60px]">
                <FileText size={15} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                <span className="min-w-0">
                  <span className="hr-wrap block text-[13px] font-medium">{d.title}</span>
                  <span className="block text-[12px] text-[var(--hr-muted)]">{[t(`docs.cat.${DOC_CATEGORIES.includes(d.category) ? d.category : 'other'}`), fmtDay(d.created.slice(0, 10)), d.expires !== '' ? t('ids.expires_on', { day: fmtDay(d.expires) }) : ''].filter((x) => x !== '').join(' · ')}</span>
                </span>
                <span className="hidden sm:block">{d.source === 'agent' && <Tag tone="agent">{t('ui.agent_short')}</Tag>}</span>
                <span className="col-span-2 col-start-2 min-w-0 sm:col-span-1 sm:col-start-auto">{d.needs_ack && (d.acked_at !== '' ? <StatusDot tone="good" label={t('docs.acked_on', { day: fmtDay(d.acked_at) })} /> : self ? <Button size="sm" variant="primary" icon={FileCheck2} onClick={() => void ack(d)}>{t('docs.ack')}</Button> : <StatusDot tone="warn" label={t('docs.waiting_ack')} />)}</span>
                <span className="col-start-3 row-start-1 flex items-center justify-end gap-0.5 sm:col-start-auto sm:row-start-auto">
                  {d.has_file && <IconButton icon={Download} label={t('ui.download')} size={28} onClick={() => void download('documents.file', { document: d.id }, 'open').catch(() => undefined)} />}
                  {p.can.edit && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={28} onClick={() => void remove(d)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {canAdd && (
        <Panel index="02" label={t('docs.upload')} className="lg:col-span-4">
          <FileDrop onFiles={(f) => setFile(f[0] ?? null)} label={t('docs.choose')}>
            <Upload size={18} aria-hidden className="text-[var(--hr-muted)]" />
            <span className="text-[12px] text-[var(--hr-muted)]">{t('docs.drop')}</span>
          </FileDrop>
        </Panel>
      )}
      <UploadDialog file={file} onClose={() => setFile(null)} employee={p.employee.id} self={self} />
    </div>
  );
}

/* ----------------------------------------------------------------- skills */

function Level({ n }: { n: number }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-[3px]" title={t('skills.level_n', { n })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('size-1.5 rounded-full', i <= n ? 'bg-[var(--hr-ink)]' : 'bg-[var(--hr-line-2)]')} />
      ))}
    </span>
  );
}

export function SkillsTab({ p }: { p: Profile }): React.JSX.Element {
  const [skill, setSkill] = useState('');
  const [level, setLevel] = useState<'1' | '2' | '3' | '4' | '5'>('3');
  const [busy, setBusy] = useState(false);
  const skills = p.skills ?? [];
  const canEdit = p.can.edit || p.can.edit_self;
  const add = async (): Promise<void> => {
    if (skill.trim() === '') return;
    setBusy(true);
    try {
      await op('employee-skills.set', { employee: p.employee.id, skill: skill.trim(), level: Number(level) });
      changed(...PROFILE_READS);
      setSkill('');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('skills.title')} className="lg:col-span-8">
        {canEdit && (
          <form
            className="mb-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder={t('skills.add_ph')} aria-label={t('skills.add')} className="min-w-[180px] flex-1" />
            <Segmented value={level} onChange={setLevel} label={t('skills.level')} size="sm" options={(['1', '2', '3', '4', '5'] as const).map((l) => ({ value: l, label: l, title: t(`skills.lv.${l}`) }))} />
            <Button type="submit" icon={Plus} busy={busy} disabled={skill.trim() === ''}>
              {t('ui.add')}
            </Button>
          </form>
        )}
        {skills.length === 0 ? (
          <Empty icon={Sparkles} title={t('skills.none')} className="py-6" />
        ) : (
          <ul className="flex flex-col">
            {skills.map((s) => (
              <li key={s.id} className={cn('grid items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0', canEdit ? 'grid-cols-[minmax(0,1fr)_84px_42px_96px_26px]' : 'grid-cols-[minmax(0,1fr)_84px_42px_96px]')}>
                <span className="hr-wrap min-w-0 text-[13px]">{s.skill}</span>
                <span>
                  {s.verified_by !== '' && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-[var(--hr-good)]">
                      <Check size={12} aria-hidden /> {t('skills.verified')}
                    </span>
                  )}
                </span>
                <Level n={s.level} />
                <span className="hr-label text-right">{t(`skills.lv.${String(s.level)}`)}</span>
                {canEdit && <IconButton icon={X} label={t('ui.remove')} tone="danger" size={26} onClick={() => void op('employee-skills.remove', { skill: s.id }).then(() => changed(...PROFILE_READS)).catch(() => undefined)} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}


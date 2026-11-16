/**
 * Forms that make hiring records: a candidate (with the duplicate check by
 * email as you type, and the resume), a CSV import (checked first), a job
 * opening (from an approved requisition or direct), a requisition, and a
 * referral. One column on a phone; smart defaults from the entity.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, DayPicker, Dialog, Field, FileDrop, Input, MoneyInput, Notice, Picker, Segmented, Select, Textarea, majorParam } from '../ui.tsx';
import { errMessage, op, opForm } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { toast } from '../../lib/toast.ts';
import { pickItems, useOrgList } from '../../pages/people/data.ts';
import type { Opening, Requisition } from '../../pages/hiring/types.ts';
import { personItems, usePeople, ToggleRow } from './bits.tsx';

const SOURCES = ['sourced', 'applied', 'referral', 'agency', 'job_board', 'career_site', 'event', 'internal', 'other'] as const;
const REMOTE = ['onsite', 'hybrid', 'remote'] as const;

function useOpenings(skip: boolean): Opening[] {
  return useOp<{ openings: Opening[] }>('openings.list', { status: 'active', limit: 300 }, ['openings'], { name: 'hiring.openings.pick', skip }).data?.openings ?? [];
}

/* -------------------------------------------------------- candidate */

export function AddCandidateDialog({ open, onClose, opening, onAdded }: { open: boolean; onClose: () => void; opening?: string | undefined; onAdded?: ((opening: string) => void) | undefined }): React.JSX.Element | null {
  const openings = useOpenings(!open);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [source, setSource] = useState<string>('sourced');
  const [links, setLinks] = useState('');
  const [onto, setOnto] = useState(opening ?? '');
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setPhone('');
    setLocation('');
    setTitle('');
    setCompany('');
    setSource('sourced');
    setLinks('');
    setOnto(opening ?? '');
    setConsent(false);
    setNotes('');
    setFile(null);
    setDup(null);
    setError(null);
  }, [open, opening]);
  useEffect(() => {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setDup(null);
      return;
    }
    const h = setTimeout(() => {
      void op<{ exists: boolean; candidate: { id: string; name: string } | null }>('candidates.check', { email: e }, { quiet: true })
        .then((r) => setDup(r.exists && r.candidate !== null ? r.candidate : null))
        .catch(() => setDup(null));
    }, 300);
    return () => clearTimeout(h);
  }, [email]);
  if (!open) return null;
  const addExisting = async (): Promise<void> => {
    if (dup === null) return;
    if (onto === '') {
      navigate('/hiring/candidates/' + dup.id);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await op('applications.add', { candidate: dup.id, opening: onto }, { quiet: true });
      changed('applications', 'candidates');
      toast.success(t('hiring.added_to_opening', { name: dup.name }));
      onClose();
      onAdded?.(onto);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ candidate: { id: string; name: string } }>(
        'candidates.add',
        { name, email, phone, location, current_title: title, current_company: company, source, links: links.split(/\s+/).filter((x) => x !== ''), consent, notes, opening: onto === '' ? undefined : onto },
        { quiet: true },
      );
      if (file !== null) await opForm('candidates.resume-set', { candidate: r.candidate.id }, { resume: file });
      changed('candidates', 'applications', 'hiring_events');
      toast.success(t('hiring.candidate_added', { name: r.candidate.name }), { label: t('hiring.open_profile'), run: () => navigate('/hiring/candidates/' + r.candidate.id) });
      onClose();
      if (onto !== '') onAdded?.(onto);
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
      title={t('hiring.add_candidate')}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          {dup !== null ? (
            <Button variant="primary" busy={busy} onClick={() => void addExisting()}>
              {onto !== '' ? t('hiring.add_existing', { name: dup.name }) : t('hiring.open_existing', { name: dup.name })}
            </Button>
          ) : (
            <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
              {t('hiring.add_candidate')}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.name')} autoFocus />
        </Field>
        <Field label={t('hiring.email')} optional>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" aria-label={t('hiring.email')} />
        </Field>
        {dup !== null && (
          <Notice tone="warn" className="sm:col-span-2">
            {t('hiring.already_here', { name: dup.name })}
          </Notice>
        )}
        <Field label={t('hiring.phone')} optional>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t('hiring.phone')} />
        </Field>
        <Field label={t('hiring.location')} optional>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('hiring.location')} />
        </Field>
        <Field label={t('hiring.current_title')} optional>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('hiring.current_title')} />
        </Field>
        <Field label={t('hiring.current_company')} optional>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} aria-label={t('hiring.current_company')} />
        </Field>
        <Field label={t('hiring.source')}>
          <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t('hiring.source')}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`hiring.source.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hiring.opening')} optional>
          <Picker value={onto} onChange={(v) => setOnto(v)} items={openings.filter((o) => o.can.add).map((o) => ({ value: o.id, label: o.title, sub: [o.number, o.entity_name].join(' · ') }))} label={t('hiring.opening')} placeholder={t('hiring.no_opening')} clearable />
        </Field>
        <Field label={t('hiring.links')} optional hint={t('hiring.links_hint')} className="sm:col-span-2">
          <Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://" aria-label={t('hiring.links')} />
        </Field>
        <Field label={t('hiring.resume')} optional className="sm:col-span-2">
          <FileDrop onFiles={(f) => setFile(f[0] ?? null)} accept=".pdf,.doc,.docx,.txt,.rtf,.odt,image/*" label={file !== null ? t('hiring.replace_file') : t('hiring.choose_file')}>
            {file !== null && <span className="hr-wrap text-[13px]">{file.name}</span>}
          </FileDrop>
        </Field>
        <Field label={t('hiring.notes')} optional className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t('hiring.notes')} minRows={2} />
        </Field>
        <div className="sm:col-span-2">
          <ToggleRow checked={consent} onChange={setConsent} label={t('hiring.consent_label')} />
        </div>
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- import */

interface ImportAnswer {
  summary: { rows: number; added: number; added_to_opening: number; duplicates: number; invalid: number; ignored_columns: string[]; dry_run: boolean };
  report: { row: number; status: string; name?: string; message?: string }[];
}

export function ImportDialog({ open, onClose, opening, onAdded }: { open: boolean; onClose: () => void; opening?: string | undefined; onAdded?: ((opening: string) => void) | undefined }): React.JSX.Element | null {
  const openings = useOpenings(!open);
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [onto, setOnto] = useState(opening ?? '');
  const [check, setCheck] = useState<ImportAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCsv('');
    setFile('');
    setOnto(opening ?? '');
    setCheck(null);
  }, [open, opening]);
  useEffect(() => setCheck(null), [onto]);
  if (!open) return null;
  const run = async (dry: boolean): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<ImportAnswer>('candidates.import', { csv, opening: onto === '' ? undefined : onto, dry_run: dry });
      if (dry) setCheck(r);
      else {
        changed('candidates', 'applications', 'hiring_events');
        toast.success(tn('hiring.imported_n', r.summary.added + r.summary.added_to_opening));
        onClose();
        if (onto !== '') onAdded?.(onto);
      }
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const bad = check?.report.filter((r) => r.status === 'invalid') ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('hiring.import_title')}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          {check === null ? (
            <Button variant="primary" busy={busy} disabled={csv === ''} onClick={() => void run(true)}>
              {t('hiring.check_file')}
            </Button>
          ) : (
            <Button variant="primary" busy={busy} disabled={check.summary.added + check.summary.added_to_opening === 0} onClick={() => void run(false)}>
              {tn('hiring.import_n', check.summary.added + check.summary.added_to_opening)}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FileDrop
          onFiles={(f) => {
            const one = f[0];
            if (one === undefined) return;
            setFile(one.name);
            setCheck(null);
            void one.text().then(setCsv);
          }}
          accept=".csv,text/csv"
          label={file !== '' ? t('hiring.replace_file') : t('hiring.choose_csv')}
        >
          {file !== '' ? <span className="hr-wrap text-[13px]">{file}</span> : <span className="hr-mono text-[12px] text-[var(--hr-muted)]">name, email, phone, location, current_title, current_company, source, links, tags, consent, notes</span>}
        </FileDrop>
        <Field label={t('hiring.opening')} optional>
          <Picker value={onto} onChange={(v) => setOnto(v)} items={openings.filter((o) => o.can.add).map((o) => ({ value: o.id, label: o.title, sub: o.number }))} label={t('hiring.opening')} placeholder={t('hiring.no_opening')} clearable />
        </Field>
        {check !== null && (
          <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] p-3 text-[13px]">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>{tn('hiring.check_new', check.summary.added)}</span>
              {check.summary.added_to_opening > 0 && <span>{tn('hiring.check_existing', check.summary.added_to_opening)}</span>}
              <span className="text-[var(--hr-muted)]">{tn('hiring.check_dupes', check.summary.duplicates)}</span>
              {check.summary.invalid > 0 && <span className="text-[var(--hr-bad)]">{tn('hiring.check_invalid', check.summary.invalid)}</span>}
            </div>
            {bad.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-[var(--hr-muted)]">
                {bad.slice(0, 8).map((b) => (
                  <li key={b.row} className="hr-wrap">
                    <span className="hr-num whitespace-nowrap">{t('hiring.row_n', { n: b.row })}</span> {b.message}
                  </li>
                ))}
              </ul>
            )}
            {check.summary.ignored_columns.length > 0 && <p className="mt-2 text-[12px] text-[var(--hr-muted)]">{t('hiring.ignored_columns', { list: check.summary.ignored_columns.join(', ') })}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------- opening */

export function OpeningDialog({ open, onClose, requisition }: { open: boolean; onClose: () => void; requisition?: Requisition | null | undefined }): React.JSX.Element | null {
  const me = useMe();
  const { entity: chosen } = useUi();
  const people = usePeople(!open);
  const approved = useOp<{ requisitions: Requisition[] }>('requisitions.list', { status: 'approved', limit: 200 }, ['requisitions'], { name: 'hiring.reqs.approved', skip: !open }).data?.requisitions ?? [];
  const [from, setFrom] = useState(requisition?.id ?? '');
  const [copy, setCopy] = useState('');
  const earlier = useOp<{ openings: Opening[] }>('openings.list', { status: 'all', limit: 300 }, ['openings'], { name: 'hiring.openings.all', skip: !open }).data?.openings ?? [];
  const [entity, setEntity] = useState(chosen !== '' ? chosen : (me.entities[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [remote, setRemote] = useState<(typeof REMOTE)[number]>('onsite');
  const [etype, setEtype] = useState('');
  const [lo, setLo] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [per, setPer] = useState<'year' | 'month' | 'hour'>('year');
  const [positions, setPositions] = useState('1');
  const [manager, setManager] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const departments = useOrgList('departments', entity).items;
  const locations = useOrgList('locations', entity).items;
  const types = useOrgList('employment-types').items;
  const ent = me.entities.find((e) => e.id === entity);
  useEffect(() => {
    if (!open) return;
    setFrom(requisition?.id ?? '');
    setCopy('');
    setTitle('');
    setDepartment('');
    setLocation('');
    setRemote('onsite');
    setLo(null);
    setHi(null);
    setPositions('1');
    setManager('');
    setError(null);
  }, [open, requisition?.id]);
  useEffect(() => {
    if (ent !== undefined) setPer(['US', 'CA', 'GB', 'AU', 'NZ', 'IE'].includes(ent.country) ? 'year' : 'month');
  }, [ent?.country]); // eslint-disable-line react-hooks/exhaustive-deps
  const unused = useMemo(() => approved.filter((r) => r.openings.length === 0 || r.id === requisition?.id), [approved, requisition?.id]);
  if (!open) return null;
  const cur = ent?.currency ?? 'USD';
  const ok = from !== '' || copy !== '' || (entity !== '' && title.trim() !== '' && Number(positions) >= 1);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const params =
        from !== ''
          ? { requisition: from }
          : copy !== ''
            ? { copy_from: copy, title: title.trim() === '' ? undefined : title }
            : { entity, title, department, location, remote, employment_type: etype, salary_min: majorParam(lo, cur), salary_max: majorParam(hi, cur), pay_per: per, positions: Number(positions), hiring_manager: manager };
      const r = await op<{ opening: Opening }>('openings.add', params, { quiet: true });
      changed('openings', 'requisitions');
      toast.success(t('hiring.opening_drafted', { number: r.opening.number }));
      navigate('/hiring/openings/' + r.opening.id, { tab: 'post' });
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
      title={t('hiring.new_opening')}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('hiring.draft_opening')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {unused.length > 0 && (
          <Field label={t('hiring.from_requisition')} optional className="sm:col-span-2">
            <Picker value={from} onChange={(v) => setFrom(v)} items={unused.map((r) => ({ value: r.id, label: r.title, sub: [r.number, r.entity_name, r.department_name].filter((x) => x !== '').join(' · ') }))} label={t('hiring.from_requisition')} placeholder={t('hiring.direct_opening')} clearable />
          </Field>
        )}
        {from === '' && earlier.length > 0 && (
          <Field label={t('hiring.like_earlier')} optional className="sm:col-span-2">
            <Picker value={copy} onChange={(v) => setCopy(v)} items={earlier.map((o) => ({ value: o.id, label: o.title, sub: [o.number, o.entity_name].join(' · ') }))} label={t('hiring.like_earlier')} placeholder={t('hiring.start_blank')} clearable />
          </Field>
        )}
        {from === '' && copy !== '' && (
          <Field label={t('hiring.job_title')} optional className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={earlier.find((o) => o.id === copy)?.title ?? ''} aria-label={t('hiring.job_title')} />
          </Field>
        )}
        {from === '' && copy === '' && (
          <>
            <Field label={t('hiring.entity')}>
              <Picker value={entity} onChange={(v) => setEntity(v)} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: [e.country, e.currency].join(' · ') }))} label={t('hiring.entity')} />
            </Field>
            <Field label={t('hiring.job_title')}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('hiring.job_title')} />
            </Field>
            <Field label={t('hiring.department')} optional>
              <Picker value={department} onChange={(v) => setDepartment(v)} items={pickItems(departments)} label={t('hiring.department')} clearable />
            </Field>
            <Field label={t('hiring.location')} optional>
              <Picker value={location} onChange={(v) => setLocation(v)} items={pickItems(locations)} label={t('hiring.location')} clearable />
            </Field>
            <Field label={t('hiring.work_mode')}>
              <Segmented value={remote} onChange={setRemote} label={t('hiring.work_mode')} size="sm" options={REMOTE.map((r) => ({ value: r, label: t(`hiring.remote.${r}`) }))} />
            </Field>
            <Field label={t('hiring.employment_type')} optional>
              <Picker value={etype} onChange={(v) => setEtype(v)} items={pickItems(types)} label={t('hiring.employment_type')} clearable />
            </Field>
            <Field label={t('hiring.pay_range', { currency: cur })} optional className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <MoneyInput value={lo} onChange={setLo} currency={cur} label={t('hiring.pay_low')} className="w-[150px]" />
                <span className="text-[var(--hr-muted)]">{t('hiring.to')}</span>
                <MoneyInput value={hi} onChange={setHi} currency={cur} label={t('hiring.pay_high')} className="w-[150px]" />
                <Segmented value={per} onChange={setPer} label={t('hiring.per')} size="sm" options={(['year', 'month', 'hour'] as const).map((p) => ({ value: p, label: t(`hiring.per.${p}`) }))} />
              </div>
            </Field>
            <Field label={t('hiring.positions')}>
              <Input value={positions} onChange={(e) => setPositions(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label={t('hiring.positions')} />
            </Field>
            <Field label={t('hiring.hiring_manager')} optional>
              <Picker value={manager} onChange={(v) => setManager(v)} items={personItems(people)} label={t('hiring.hiring_manager')} clearable />
            </Field>
          </>
        )}
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------ requisition */

export function RequisitionDialog({ open, onClose, requisition }: { open: boolean; onClose: () => void; requisition?: Requisition | null | undefined }): React.JSX.Element | null {
  const me = useMe();
  const { entity: chosen } = useUi();
  const people = usePeople(!open);
  const r0 = requisition ?? null;
  const [entity, setEntity] = useState(r0?.entity ?? (chosen !== '' ? chosen : (me.entities[0]?.id ?? '')));
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [reason, setReason] = useState<'new_role' | 'replacement' | 'growth'>('new_role');
  const [location, setLocation] = useState('');
  const [remote, setRemote] = useState<(typeof REMOTE)[number]>('onsite');
  const [lo, setLo] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [per, setPer] = useState<'year' | 'month' | 'hour'>('year');
  const [budget, setBudget] = useState<number | null>(null);
  const [startDay, setStartDay] = useState('');
  const [manager, setManager] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'send'>('');
  const [error, setError] = useState<string | null>(null);
  const departments = useOrgList('departments', entity).items;
  const locations = useOrgList('locations', entity).items;
  const ent = me.entities.find((e) => e.id === entity);
  useEffect(() => {
    if (!open) return;
    setEntity(r0?.entity ?? (chosen !== '' ? chosen : (me.entities[0]?.id ?? '')));
    setTitle(r0?.title ?? '');
    setDepartment(r0?.department ?? '');
    setHeadcount(String(r0?.headcount ?? 1));
    setReason(r0?.reason ?? 'new_role');
    setLocation(r0?.location ?? '');
    setRemote((r0?.remote as (typeof REMOTE)[number] | undefined) || 'onsite');
    setLo(r0?.pay_min_minor ?? null);
    setHi(r0?.pay_max_minor ?? null);
    setPer((r0?.pay_per as 'year' | 'month' | 'hour' | undefined) || 'year');
    setBudget(r0?.budget_minor ?? null);
    setStartDay(r0?.target_start_day ?? '');
    setManager(r0?.hiring_manager ?? me.member.id);
    setWhy(r0?.justification ?? '');
    setError(null);
  }, [open, r0?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const cur = ent?.currency ?? 'USD';
  const ok = entity !== '' && title.trim() !== '' && Number(headcount) >= 1;
  const save = async (send: boolean): Promise<void> => {
    setBusy(send ? 'send' : 'save');
    setError(null);
    try {
      const r = await op<{ requisition: Requisition }>(
        'requisitions.save',
        { requisition: r0?.id, entity, title, department, headcount: Number(headcount), reason, location, remote, pay_min: majorParam(lo, cur), pay_max: majorParam(hi, cur), pay_per: per, budget: majorParam(budget, cur), target_start_day: startDay, hiring_manager: manager, justification: why },
        { quiet: true },
      );
      if (send) await op('requisitions.submit', { requisition: r.requisition.id }, { quiet: true });
      changed('requisitions', 'approvals');
      toast.success(send ? t('hiring.req_sent', { number: r.requisition.number }) : t('hiring.req_saved', { number: r.requisition.number }));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={r0 ? t('hiring.edit_requisition') : t('hiring.request_role')}
      meta={r0?.number}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button busy={busy === 'save'} disabled={!ok || busy !== ''} onClick={() => void save(false)}>
            {t('hiring.save_draft')}
          </Button>
          <Button variant="primary" busy={busy === 'send'} disabled={!ok || busy !== ''} onClick={() => void save(true)}>
            {t('hiring.send_for_approval')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.entity')}>
          <Picker value={entity} onChange={(v) => setEntity(v)} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.currency }))} label={t('hiring.entity')} />
        </Field>
        <Field label={t('hiring.role_title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('hiring.role_title')} />
        </Field>
        <Field label={t('hiring.department')} optional>
          <Picker value={department} onChange={(v) => setDepartment(v)} items={pickItems(departments)} label={t('hiring.department')} clearable />
        </Field>
        <Field label={t('hiring.headcount')}>
          <Input value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label={t('hiring.headcount')} />
        </Field>
        <Field label={t('hiring.why_needed')} className="sm:col-span-2">
          <Segmented value={reason} onChange={setReason} label={t('hiring.why_needed')} size="sm" options={(['new_role', 'growth', 'replacement'] as const).map((x) => ({ value: x, label: t(`hiring.req_reason.${x}`) }))} />
        </Field>
        <Field label={t('hiring.location')} optional>
          <Picker value={location} onChange={(v) => setLocation(v)} items={pickItems(locations)} label={t('hiring.location')} clearable />
        </Field>
        <Field label={t('hiring.work_mode')}>
          <Segmented value={remote} onChange={setRemote} label={t('hiring.work_mode')} size="sm" options={REMOTE.map((x) => ({ value: x, label: t(`hiring.remote.${x}`) }))} />
        </Field>
        <Field label={t('hiring.pay_range', { currency: cur })} optional className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <MoneyInput value={lo} onChange={setLo} currency={cur} label={t('hiring.pay_low')} className="w-[150px]" />
            <span className="text-[var(--hr-muted)]">{t('hiring.to')}</span>
            <MoneyInput value={hi} onChange={setHi} currency={cur} label={t('hiring.pay_high')} className="w-[150px]" />
            <Segmented value={per} onChange={setPer} label={t('hiring.per')} size="sm" options={(['year', 'month', 'hour'] as const).map((p) => ({ value: p, label: t(`hiring.per.${p}`) }))} />
          </div>
        </Field>
        <Field label={t('hiring.budget', { currency: cur })} optional>
          <MoneyInput value={budget} onChange={setBudget} currency={cur} label={t('hiring.budget_short')} />
        </Field>
        <Field label={t('hiring.target_start')} optional>
          <DayPicker value={startDay} onChange={setStartDay} label={t('hiring.target_start')} clearable />
        </Field>
        <Field label={t('hiring.hiring_manager')} optional className="sm:col-span-2">
          <Picker value={manager} onChange={(v) => setManager(v)} items={personItems(people)} label={t('hiring.hiring_manager')} clearable />
        </Field>
        <Field label={t('hiring.justification')} optional className="sm:col-span-2">
          <Textarea value={why} onChange={(e) => setWhy(e.target.value)} aria-label={t('hiring.justification')} minRows={3} />
        </Field>
        {error !== null && (
          <Notice tone="bad" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- referral */

export function ReferDialog({ open, onClose, role }: { open: boolean; onClose: () => void; role: { id: string; title: string } | null }): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setPhone('');
    setRelationship('');
    setNote('');
    setFile(null);
    setError(null);
  }, [open, role?.id]);
  if (!open || role === null) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const params = { opening: role.id, name, email, phone, relationship, note };
      if (file !== null) await opForm('referrals.add', params, { resume: file }, { quiet: true });
      else await op('referrals.add', params, { quiet: true });
      changed('referrals', 'candidates', 'applications');
      toast.success(t('hiring.referral_sent', { name }));
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
      title={t('hiring.refer_title')}
      meta={role.title}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            {t('hiring.send_referral')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('hiring.their_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.their_name')} autoFocus />
        </Field>
        <Field label={t('hiring.their_email')} optional>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" aria-label={t('hiring.their_email')} />
        </Field>
        <Field label={t('hiring.their_phone')} optional>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t('hiring.their_phone')} />
        </Field>
        <Field label={t('hiring.how_you_know')} optional>
          <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder={t('hiring.how_you_know_placeholder')} aria-label={t('hiring.how_you_know')} />
        </Field>
        <Field label={t('hiring.why_fit')} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hiring.why_fit')} minRows={3} />
        </Field>
        <Field label={t('hiring.resume')} optional>
          <FileDrop onFiles={(f) => setFile(f[0] ?? null)} accept=".pdf,.doc,.docx,.txt,.rtf,.odt" label={file !== null ? t('hiring.replace_file') : t('hiring.choose_file')}>
            {file !== null && <span className="hr-wrap text-[13px]">{file.name}</span>}
          </FileDrop>
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

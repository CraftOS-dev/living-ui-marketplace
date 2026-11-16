/**
 * Training: upcoming sessions (enrol in one tap), my trainings and
 * certificates, required trainings with what is done, expiring, due and
 * overdue, and for HR the programs and requirements. A session opens as its
 * own page: details, the people on it with attendance and results, your
 * feedback and your certificate.
 */
import { useEffect, useMemo, useState } from 'react';
import { Award, CalendarPlus, Download, ExternalLink, FileUp, GraduationCap, MapPin, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button, DataTable, DateRange, DayPicker, Dialog, Empty, Fact, Field, FileDrop, IconButton, Input, LinkButton, LoadError, Loading, Money, MoneyInput, Notice, PageBody, PageHeader, Panel, PersonChip, Picker, Segmented, StatTile, StatusDot, Tabs, Tag, Textarea, Toggle, confirmAsk, majorParam, toast } from '../../components/ui.tsx';
import type { Column, Tone } from '../../components/ui.tsx';
import { dueText, PersonPicker } from '../../components/performance/bits.tsx';
import type { Attendee, ComplianceRow, Program, Requirement, Session } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { download, op, opForm, saveText } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange, today } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

type Tab = 'upcoming' | 'mine' | 'required' | 'programs';
export const STATE_TONE: Record<ComplianceRow['state'], Tone> = { done: 'good', expiring: 'warn', due: 'neutral', overdue: 'bad' };
const ATT_TONE: Record<Attendee['status'], Tone> = { invited: 'faint', enrolled: 'rh', attended: 'lh', completed: 'good', no_show: 'bad', cancelled: 'faint' };

export function TrainingPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const edit = can(me, 'performance', 'edit');
  const wanted = query.get('tab') as Tab | null;
  const tabs: { value: Tab; label: string; count?: number | undefined }[] = [{ value: 'upcoming', label: t('perf.tr.upcoming') }];
  if (me.employee !== null) tabs.push({ value: 'mine', label: t('perf.tr.mine') });
  tabs.push({ value: 'required', label: t('perf.tr.required') });
  if (edit) tabs.push({ value: 'programs', label: t('perf.tr.programs') });
  const tab: Tab = wanted !== null && tabs.some((x) => x.value === wanted) ? wanted : 'upcoming';
  const [schedule, setSchedule] = useState(false);
  const [record, setRecord] = useState(false);
  return (
    <>
      <PageHeader title={t('perf.tr.title')}>
        {me.employee !== null && (
          <Button icon={Award} onClick={() => setRecord(true)}>
            {t('perf.tr.record')}
          </Button>
        )}
        {edit && (
          <Button variant="primary" icon={CalendarPlus} onClick={() => setSchedule(true)}>
            {t('perf.tr.schedule')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <Tabs value={tab} onChange={(v) => setQuery({ tab: v === 'upcoming' ? undefined : v })} tabs={tabs} label={t('perf.tr.title')} className="mb-3" />
        {tab === 'upcoming' && <SessionsTab view="upcoming" canEdit={edit} onSchedule={() => setSchedule(true)} />}
        {tab === 'mine' && <MineTab onRecord={() => setRecord(true)} />}
        {tab === 'required' && <RequiredTab canEdit={edit} manager={isManager(me)} />}
        {tab === 'programs' && <ProgramsTab />}
      </PageBody>
      <SessionDialog open={schedule} onClose={() => setSchedule(false)} />
      <RecordDialog open={record} onClose={() => setRecord(false)} />
    </>
  );
}

function SessionsTab({ view, canEdit, onSchedule }: { view: 'upcoming' | 'past'; canEdit: boolean; onSchedule: () => void }): React.JSX.Element {
  const [which, setWhich] = useState<'upcoming' | 'past'>(view);
  const live = useOp<{ trainings: Session[]; total: number }>('trainings.list', { view: which, limit: 200 }, READS.training, { name: `perf.tr.${which}` });
  const enrol = async (s: Session): Promise<void> => {
    try {
      await op('trainings.enrol', { training: s.id });
      changed(...READS.training);
      toast.success(t('perf.tr.enrolled', { title: s.title }));
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Segmented value={which} onChange={setWhich} label={t('perf.tr.when')} size="sm" options={[{ value: 'upcoming', label: t('perf.tr.upcoming') }, { value: 'past', label: t('perf.tr.past') }]} />
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : live.data.trainings.length === 0 ? (
        <Empty icon={GraduationCap} title={which === 'upcoming' ? t('perf.tr.none_upcoming') : t('perf.tr.none_past')} action={canEdit && which === 'upcoming' ? <Button icon={CalendarPlus} onClick={onSchedule}>{t('perf.tr.schedule_first')}</Button> : undefined}>
          {canEdit && which === 'upcoming' ? t('perf.tr.none_upcoming_hr') : undefined}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.data.trainings.map((s) => (
            <li key={s.id} className="hr-panel hr-in flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
              <div className="hr-mono hr-num w-[76px] shrink-0 leading-tight">
                <div className="text-[13px]">{fmtDay(s.start)}</div>
                <div className="text-[12px] text-[var(--hr-muted)]">{s.start_time !== '' ? `${s.start_time}${s.end_time !== '' ? `-${s.end_time}` : ''}` : s.end !== '' && s.end !== s.start ? fmtDay(s.end) : ''}</div>
              </div>
              <a href={`#/performance/training/${s.id}`} className="hr-focus hit min-w-0 flex-1 basis-[220px] rounded-[3px]">
                <span className="hr-link hr-wrap block text-[13px] font-medium">{s.title}</span>
                <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[t(`perf.tr.kind.${s.kind}`), s.provider, s.location].filter((x) => x !== '').join(' · ')}</span>
              </a>
              <span className="hr-mono hr-num text-[12px] text-[var(--hr-ink-2)]">{s.capacity > 0 ? t('perf.tr.seats', { taken: s.seats_taken, of: s.capacity }) : tn('perf.tr.people', s.seats_taken)}</span>
              {s.status !== 'open' && <Tag tone={s.status === 'cancelled' ? 'bad' : 'faint'}>{t(`perf.tr.status.${s.status}`)}</Tag>}
              {s.my !== null ? (
                <StatusDot tone={ATT_TONE[s.my.status as Attendee['status']] ?? 'neutral'} label={t(`perf.tr.att.${s.my.status}`)} />
              ) : s.status === 'open' && !s.full && which === 'upcoming' ? (
                <Button size="sm" icon={UserPlus} onClick={() => void enrol(s)}>
                  {t('perf.tr.enrol')}
                </Button>
              ) : s.full ? (
                <Tag tone="faint">{t('perf.tr.full')}</Tag>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MineTab({ onRecord }: { onRecord: () => void }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ trainings: { attendance: Attendee[]; due: ComplianceRow[] } }>('perf.profile', { employee: me.employee?.id ?? '' }, READS.training, { name: 'perf.tr.mine', skip: me.employee === null });
  const rows = live.data?.trainings.attendance ?? [];
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const due = live.data.trainings.due;
  return (
    <div className="flex flex-col gap-3">
      {due.length > 0 && (
        <Panel index="01" label={t('perf.tr.to_do')}>
          <ul className="flex flex-col">
            {due.map((d) => (
              <li key={d.requirement} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2 last:border-b-0 sm:grid-cols-[104px_minmax(0,1fr)_minmax(0,180px)]">
                <StatusDot tone={STATE_TONE[d.state]} label={t(`perf.training.state.${d.state}`)} />
                <span className="hr-wrap min-w-0 text-[13px] font-medium">{d.program_name}</span>
                <span className="col-start-2 min-w-0 sm:col-start-auto sm:text-right">{d.enrolled !== null ? <span className="text-[12px] text-[var(--hr-muted)]">{t('perf.home.enrolled_on', { day: fmtDay(d.enrolled.start) })}</span> : d.due !== '' && <span className={cn('hr-label', d.state === 'overdue' && '!text-[var(--hr-bad)]')}>{dueText(d.due, me.today)}</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel index={due.length > 0 ? '02' : '01'} label={t('perf.tr.history')} aside={<Button size="sm" variant="ghost" icon={Award} onClick={onRecord}>{t('perf.tr.record')}</Button>} flush>
        {rows.length === 0 ? (
          <Empty icon={GraduationCap} title={t('perf.tr.no_history')} action={<Button icon={Award} onClick={onRecord}>{t('perf.tr.record')}</Button>}>
            {t('perf.tr.no_history_text')}
          </Empty>
        ) : (
          <ul className="flex flex-col px-3.5 pb-2">
            {rows.map((a) => (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_104px_96px_minmax(0,auto)]">
                <span className="col-span-2 min-w-0 sm:col-span-1">
                  {a.session !== null && a.session !== undefined ? (
                    <a href={`#/performance/training/${a.session.id}`} className="hr-link hr-focus hit hr-wrap block min-h-6 rounded-[3px] text-[13px] font-medium">
                      {a.program_name}
                    </a>
                  ) : (
                    <span className="hr-wrap block text-[13px] font-medium">{a.program_name}</span>
                  )}
                  <span className="block text-[12px] text-[var(--hr-muted)]">{a.session !== null && a.session !== undefined ? fmtDay(a.session.start) : t('perf.tr.external')}{a.expires_on !== '' ? ` · ${t('perf.tr.valid_until', { day: fmtDay(a.expires_on) })}` : ''}</span>
                </span>
                <StatusDot tone={ATT_TONE[a.status]} label={t(`perf.tr.att.${a.status}`)} />
                <span className="hidden sm:block">{a.source === 'external' && !a.verified && <Tag tone="warn">{t('perf.tr.to_verify')}</Tag>}</span>
                <span className="flex justify-end">
                  <CertificateButton a={a} mine />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CertificateButton({ a, mine }: { a: Attendee; mine?: boolean | undefined }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (a.has_certificate)
    return (
      <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void download('training-attendees.file', { attendee: a.id }, 'open')}>
        {t('perf.tr.certificate')}
      </Button>
    );
  if (mine !== true || (a.status !== 'completed' && a.status !== 'attended')) return null;
  const upload = async (f: File): Promise<void> => {
    setBusy(true);
    try {
      await opForm('training-attendees.certificate', { attendee: a.id }, { file: f });
      changed(...READS.training);
      toast.success(t('perf.tr.cert_added'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={cn('hr-focus hit inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--hr-radius-sm)] px-2.5 text-[12px] font-medium text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]', busy && 'opacity-50')}>
      <FileUp size={13} aria-hidden />
      {t('perf.tr.add_certificate')}
      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] !== undefined && void upload(e.target.files[0])} />
    </label>
  );
}

function RequiredTab({ canEdit, manager }: { canEdit: boolean; manager: boolean }): React.JSX.Element {
  const me = useMe();
  const [state, setState] = useState<'open' | 'overdue' | ''>('open');
  const live = useOp<{ rows: ComplianceRow[]; total: number; counts: Record<ComplianceRow['state'], number> }>('trainings.compliance', { state: state === '' ? undefined : state, limit: 500 }, [...READS.training, 'job_records', 'employments'], { name: `perf.tr.compliance.${state}` });
  const reqs = useOp<{ requirements: Requirement[] }>('training-requirements.list', {}, READS.training, { name: 'perf.tr.reqs' });
  const [reqOpen, setReqOpen] = useState<Requirement | null | 'new'>(null);
  const cols: Column<ComplianceRow>[] = [
    { key: 'name', label: t('perf.cycle.person'), width: 'minmax(180px,1.6fr)', phone: 'title', sort: (r) => r.employee?.name ?? '', render: (r) => <PersonChip name={r.employee?.name ?? ''} sub={r.employee?.department_name} size={24} /> },
    { key: 'program', label: t('perf.tr.program'), width: 'minmax(160px,1.6fr)', sort: (r) => r.program_name, render: (r) => r.program_name },
    { key: 'state', label: t('perf.tr.state'), width: '120px', phone: 'end', sort: (r) => r.state, render: (r) => <StatusDot tone={STATE_TONE[r.state]} label={t(`perf.training.state.${r.state}`)} /> },
    { key: 'due', label: t('perf.tr.due'), width: '120px', mono: true, sort: (r) => r.due || '9999', render: (r) => (r.due !== '' ? <span className={cn(r.state === 'overdue' && 'text-[var(--hr-bad)]')}>{fmtDay(r.due)}</span> : '') },
    { key: 'done', label: t('perf.tr.completed'), width: '110px', mono: true, hideBelow: 'lg', phone: 'hide', render: (r) => fmtDay(r.completed_on) },
    { key: 'next', label: t('perf.tr.next_session'), width: '120px', hideBelow: 'xl', phone: 'hide', render: (r) => (r.enrolled !== null ? fmtDay(r.enrolled.start) : r.unverified ? <Tag tone="warn">{t('perf.tr.to_verify')}</Tag> : '') },
  ];
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('trainings.export', { state: state === '' ? undefined : state });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const c = live.data?.counts;
  return (
    <div className="flex flex-col gap-3">
      {c !== undefined && (canEdit || manager) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label={t('perf.training.state.overdue')} value={c.overdue} tone={c.overdue > 0 ? 'bad' : undefined} onClick={() => setState('overdue')} />
          <StatTile label={t('perf.training.state.due')} value={c.due} onClick={() => setState('open')} />
          <StatTile label={t('perf.training.state.expiring')} value={c.expiring} tone={c.expiring > 0 ? 'warn' : undefined} onClick={() => setState('open')} />
          <StatTile label={t('perf.training.state.done')} value={c.done} tone="good" onClick={() => setState('')} />
        </div>
      )}
      <div className="hr-panel hr-in min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
          <Segmented value={state} onChange={setState} label={t('perf.tr.state')} size="sm" options={[{ value: 'open', label: t('perf.tr.f.open') }, { value: 'overdue', label: t('perf.tr.f.overdue') }, { value: '', label: t('perf.tr.f.all') }]} />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv()}>
            {t('ui.export')}
          </Button>
        </div>
        {live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <DataTable label={t('perf.tr.required')} columns={cols} rows={live.data.rows} rowKey={(r) => `${r.requirement}:${r.employee?.id ?? ''}`} empty={<Empty icon={ShieldCheck} title={(reqs.data?.requirements.length ?? 0) === 0 ? t('perf.tr.no_requirements') : t('perf.tr.all_done')} action={canEdit && (reqs.data?.requirements.length ?? 0) === 0 ? <Button icon={Plus} onClick={() => setReqOpen('new')}>{t('perf.tr.add_requirement')}</Button> : undefined}>{(reqs.data?.requirements.length ?? 0) === 0 ? (canEdit ? t('perf.tr.no_requirements_hr') : undefined) : me.employee !== null ? t('perf.tr.all_done_text') : undefined}</Empty>} />
        )}
      </div>
      {canEdit && (
        <Panel index="01" label={t('perf.tr.requirements')} aside={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setReqOpen('new')}>{t('perf.tr.add_requirement')}</Button>}>
          {(reqs.data?.requirements ?? []).length === 0 ? (
            <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.tr.no_requirements_hr')}</p>
          ) : (
            <ul className="flex flex-col">
              {(reqs.data?.requirements ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 basis-[220px]">
                    <span className="hr-wrap block text-[13px] font-medium">{r.program_name}</span>
                    <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[r.department_name || r.entity_name || t('perf.tr.everyone'), r.job_title_name, r.due_day !== '' ? t('perf.tr.by_day', { day: fmtDay(r.due_day) }) : '', r.due_days > 0 ? t('perf.tr.within', { n: r.due_days }) : '', r.valid_months > 0 ? t('perf.tr.renew', { n: r.valid_months }) : ''].filter((x) => x !== '').join(' · ')}</span>
                  </span>
                  {r.counts !== undefined && (
                    <span className="hr-mono hr-num flex gap-2 text-[12px]">
                      <span className="text-[var(--hr-bad)]">{r.counts.overdue}</span>
                      <span className="text-[var(--hr-ink-2)]">{r.counts.due}</span>
                      <span className="text-[var(--hr-good)]">{r.counts.done}</span>
                    </span>
                  )}
                  <IconButton icon={Pencil} label={t('ui.edit')} size={26} onClick={() => setReqOpen(r)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <RequirementDialog value={reqOpen} onClose={() => setReqOpen(null)} />
    </div>
  );
}

function ProgramsTab(): React.JSX.Element {
  const live = useOp<{ programs: Program[] }>('training-programs.list', {}, READS.training, { name: 'perf.tr.programs' });
  const [edit, setEdit] = useState<Program | null | 'new'>(null);
  const cols: Column<Program>[] = useMemo(
    () => [
      { key: 'name', label: t('perf.tr.program'), width: 'minmax(200px,2fr)', phone: 'title', sort: (p) => p.name, render: (p) => <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-[12px] text-[var(--hr-muted)]">{[t(`perf.tr.kind.${p.kind}`), p.provider].filter((x) => x !== '').join(' · ')}</span></span> },
      { key: 'valid', label: t('perf.tr.valid'), width: '110px', hideBelow: 'lg', render: (p) => (p.valid_months > 0 ? tn('perf.tr.months', p.valid_months) : t('perf.tr.forever')) },
      { key: 'upcoming', label: t('perf.tr.upcoming'), width: '90px', mono: true, align: 'right', sort: (p) => p.upcoming, render: (p) => p.upcoming },
      { key: 'done', label: t('perf.tr.completions'), width: '100px', mono: true, align: 'right', sort: (p) => p.completions, phone: 'end', render: (p) => p.completions },
      { key: 'req', label: '', width: '90px', hideBelow: 'lg', phone: 'hide', render: (p) => (p.required > 0 ? <Tag>{t('perf.tr.is_required')}</Tag> : null) },
      { key: 'edit', label: '', width: '44px', phone: 'hide', render: (p) => <IconButton icon={Pencil} label={t('ui.edit')} size={26} onClick={() => setEdit(p)} /> },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        <Button icon={Plus} onClick={() => setEdit('new')}>
          {t('perf.tr.add_program')}
        </Button>
      </div>
      <div className="hr-panel hr-in min-w-0">
        {live.data === null ? <Loading /> : <DataTable label={t('perf.tr.programs')} columns={cols} rows={live.data.programs} rowKey={(p) => p.id} empty={<Empty icon={GraduationCap} title={t('perf.tr.no_programs')} action={<Button icon={Plus} onClick={() => setEdit('new')}>{t('perf.tr.add_program')}</Button>} />} />}
      </div>
      <ProgramDialog value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

export function SessionPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['id'] ?? '';
  const live = useOp<{ training: Session & { attendees: Attendee[]; attendees_hidden: number; feedback_summary: { count: number; avg_rating: number }; can: { edit: boolean; enrol_self: boolean; enrol_team: boolean } } }>('trainings.get', { training: id }, READS.training, { name: 'perf.tr.session' });
  const [editOpen, setEditOpen] = useState(false);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [marks, setMarks] = useState<Record<string, { status: string; score: string; result: string }>>({});
  const [busy, setBusy] = useState(false);
  const s = live.data?.training ?? null;
  useEffect(() => setMarks({}), [id]);
  if (s === null)
    return (
      <>
        <PageHeader title={t('perf.tr.title')} back="#/performance/training" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const saveMarks = async (): Promise<void> => {
    const rows = Object.entries(marks).map(([attendee, m]) => ({ attendee, status: m.status, ...(m.score !== '' ? { score: Number(m.score) } : {}), result: m.result }));
    if (rows.length === 0) return;
    setBusy(true);
    try {
      await op('trainings.attendance', { training: s.id, rows });
      changed(...READS.training);
      setMarks({});
      toast.success(tn('perf.tr.marked', rows.length));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const enrolMe = async (): Promise<void> => {
    try {
      await op('trainings.enrol', { training: s.id });
      changed(...READS.training);
      toast.success(t('perf.tr.enrolled', { title: s.title }));
    } catch {
      /* toast shown */
    }
  };
  const cancelMine = async (): Promise<void> => {
    if (s.my === null || !(await confirmAsk(t('perf.tr.cancel_text'), t('perf.tr.cancel_place'), t('perf.tr.cancel_place')))) return;
    try {
      await op('training-attendees.cancel', { attendee: s.my.attendee });
      changed(...READS.training);
    } catch {
      /* toast shown */
    }
  };
  const past = (s.end || s.start) <= me.today;
  const mineRow = s.attendees.find((a) => a.id === s.my?.attendee);
  return (
    <>
      <PageHeader title={s.title} meta={[t(`perf.tr.kind.${s.kind}`), fmtRange(s.start, s.end), t(`perf.tr.status.${s.status}`)].join(' · ')} back="#/performance/training">
        {s.can.edit && (
          <Button icon={Pencil} onClick={() => setEditOpen(true)}>
            {t('ui.edit')}
          </Button>
        )}
        {s.can.enrol_team && (
          <Button icon={UserPlus} onClick={() => setEnrolOpen(true)}>
            {t('perf.tr.enrol_people')}
          </Button>
        )}
        {s.can.enrol_self ? (
          <Button variant="primary" icon={UserPlus} onClick={() => void enrolMe()}>
            {t('perf.tr.enrol')}
          </Button>
        ) : s.my !== null && s.my.status === 'enrolled' && !past ? (
          <Button onClick={() => void cancelMine()}>{t('perf.tr.cancel_place')}</Button>
        ) : null}
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Panel index="01" label={t('perf.tr.details')} className="lg:col-span-5">
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Fact label={t('perf.tr.when')}>
                {fmtRange(s.start, s.end)}
                {s.start_time !== '' ? ` ${s.start_time}${s.end_time !== '' ? `-${s.end_time}` : ''}` : ''}
              </Fact>
              <Fact label={t('perf.tr.where')}>
                {s.location !== '' ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} aria-hidden />
                    {s.location}
                  </span>
                ) : (
                  t('ui.none')
                )}
              </Fact>
              <Fact label={t('perf.tr.seats_label')} mono>
                {s.capacity > 0 ? `${s.seats_taken}/${s.capacity}` : s.seats_taken}
              </Fact>
              <Fact label={t('perf.tr.cost')}>{s.cost_minor > 0 ? <Money minor={s.cost_minor} currency={s.currency} /> : t('ui.none')}</Fact>
              <Fact label={t('perf.tr.trainer')}>{s.trainer || t('ui.none')}</Fact>
              <Fact label={t('perf.tr.program')}>{s.program_name}</Fact>
            </div>
            {s.link !== '' && (
              <a href={s.link} target="_blank" rel="noreferrer noopener" className="hr-link hr-focus hit mt-3 inline-flex items-center gap-1 rounded-[3px] text-[12px] text-[var(--hr-ink-2)]">
                <ExternalLink size={12} aria-hidden /> {t('perf.tr.open_link')}
              </a>
            )}
            {s.description !== '' && <p className="hr-wrap mt-3 whitespace-pre-wrap text-[13px] leading-5 text-[var(--hr-ink-2)]">{s.description}</p>}
            {s.feedback_summary.count > 0 && <div className="mt-3 text-[12px] text-[var(--hr-muted)]">{t('perf.tr.feedback_avg', { avg: s.feedback_summary.avg_rating, n: s.feedback_summary.count })}</div>}
          </Panel>
          <Panel index="02" label={t('perf.tr.attendees')} className="lg:col-span-7" aside={s.can.edit && Object.keys(marks).length > 0 ? <Button size="sm" variant={s.can.enrol_self ? 'default' : 'primary'} busy={busy} onClick={() => void saveMarks()}>{tn('perf.tr.save_marks', Object.keys(marks).length)}</Button> : undefined}>
            {s.attendees.length === 0 ? (
              <p className="py-2 text-[12px] text-[var(--hr-muted)]">{s.attendees_hidden > 0 ? tn('perf.tr.others_on', s.attendees_hidden) : t('perf.tr.nobody_yet')}</p>
            ) : (
              <ul className="flex flex-col">
                {s.attendees.map((a) => {
                  const m = marks[a.id];
                  const status = m?.status ?? a.status;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                      <PersonChip name={a.employee?.name ?? ''} sub={a.employee?.title} size={24} className="min-w-0 flex-1 basis-[180px]" />
                      {s.can.edit ? (
                        <>
                          <Segmented
                            value={status}
                            onChange={(v) => setMarks((x) => ({ ...x, [a.id]: { status: v, score: x[a.id]?.score ?? (a.score > 0 ? String(a.score) : ''), result: x[a.id]?.result ?? a.result } }))}
                            label={t('perf.tr.attendance')}
                            size="sm"
                            options={(['enrolled', 'attended', 'completed', 'no_show'] as const).map((v) => ({ value: v, label: t(`perf.tr.att.${v}`) }))}
                          />
                          <Input value={m?.score ?? (a.score > 0 ? String(a.score) : '')} inputMode="decimal" onChange={(e) => setMarks((x) => ({ ...x, [a.id]: { status: x[a.id]?.status ?? a.status, score: e.target.value.replace(/[^0-9.]/g, ''), result: x[a.id]?.result ?? a.result } }))} className="w-[72px]" aria-label={t('perf.tr.score')} placeholder={t('perf.tr.score')} />
                        </>
                      ) : (
                        <StatusDot tone={ATT_TONE[a.status]} label={t(`perf.tr.att.${a.status}`)} />
                      )}
                      {a.result !== '' && <Tag tone={a.result === 'pass' ? 'good' : 'bad'}>{t(`perf.tr.result.${a.result}`)}</Tag>}
                      <CertificateButton a={a} mine={a.id === s.my?.attendee} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {mineRow !== undefined && (mineRow.status === 'attended' || mineRow.status === 'completed') && <MyFeedback session={s.id} a={mineRow} />}
        </div>
      </PageBody>
      <SessionDialog open={editOpen} onClose={() => setEditOpen(false)} session={s} />
      <EnrolDialog open={enrolOpen} onClose={() => setEnrolOpen(false)} training={s.id} />
    </>
  );
}

function MyFeedback({ session, a }: { session: string; a: Attendee }): React.JSX.Element {
  const [rating, setRating] = useState(String(a.rating > 0 ? a.rating : ''));
  const [text, setText] = useState(a.feedback);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('trainings.feedback', { training: session, rating: rating === '' ? undefined : Number(rating), feedback: text });
      changed(...READS.training);
      toast.success(t('perf.tr.feedback_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel index="03" label={t('perf.tr.your_feedback')} className="lg:col-span-12">
      <div className="flex max-w-[640px] flex-col gap-3 pt-1">
        <Segmented value={rating} onChange={setRating} label={t('perf.tr.rating')} options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: n }))} />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} maxLength={4000} placeholder={t('perf.tr.feedback_ph')} />
        <Button variant="primary" busy={busy} onClick={() => void save()} className="self-start">
          {t('perf.tr.send_feedback')}
        </Button>
      </div>
    </Panel>
  );
}

function SessionDialog({ open, onClose, session }: { open: boolean; onClose: () => void; session?: Session | undefined }): React.JSX.Element | null {
  const me = useMe();
  const programs = useOp<{ programs: Program[] }>('training-programs.list', {}, READS.training, { skip: !open, name: 'perf.tr.programs' });
  const [program, setProgram] = useState('');
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [capacity, setCapacity] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [trainer, setTrainer] = useState('');
  const [status, setStatus] = useState<Session['status']>('open');
  const [busy, setBusy] = useState(false);
  const currency = session?.currency || me.entities[0]?.currency || 'USD';
  useEffect(() => {
    if (!open) return;
    setProgram(session?.program ?? '');
    setNewName('');
    setTitle(session?.title ?? '');
    setFrom(session?.start ?? '');
    setTo(session?.end ?? '');
    setStartTime(session?.start_time ?? '');
    setEndTime(session?.end_time ?? '');
    setLocation(session?.location ?? '');
    setLink(session?.link ?? '');
    setCapacity(session !== undefined && session.capacity > 0 ? String(session.capacity) : '');
    setCost(session !== undefined && session.cost_minor > 0 ? session.cost_minor : null);
    setTrainer(session?.trainer ?? '');
    setStatus(session?.status ?? 'open');
  }, [open, session]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const params: Record<string, unknown> = { title: title.trim() === '' ? undefined : title.trim(), start: from === '' ? undefined : from, end: to, start_time: startTime, end_time: endTime, location, link, capacity: capacity === '' ? 0 : Number(capacity), trainer, status, currency, cost: majorParam(cost, currency) ?? '0' };
      if (program !== '') params['program'] = program;
      else params['program_name'] = newName.trim();
      const r = session !== undefined ? await op<{ training: Session }>('trainings.update', { training: session.id, ...params }) : await op<{ training: Session }>('trainings.add', params);
      changed(...READS.training);
      toast.success(session !== undefined ? t('perf.tr.saved') : t('perf.tr.scheduled'), session === undefined ? { label: t('perf.tr.open'), run: () => navigate(`/performance/training/${r.training.id}`) } : undefined);
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={session !== undefined ? t('perf.tr.edit_session') : t('perf.tr.schedule')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={program === '' && newName.trim() === ''} onClick={() => void save()}>
            {session !== undefined ? t('ui.save') : t('perf.tr.schedule')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('perf.tr.program')}>
          <Picker value={program} onChange={(v) => setProgram(v)} items={(programs.data?.programs ?? []).map((p) => ({ value: p.id, label: p.name, sub: t(`perf.tr.kind.${p.kind}`) }))} label={t('perf.tr.program')} placeholder={t('perf.tr.pick_program')} clearable />
        </Field>
        {program === '' && (
          <Field label={t('perf.tr.new_program')} hint={t('perf.tr.new_program_hint')}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={160} placeholder={t('perf.tr.new_program_ph')} />
          </Field>
        )}
        <Field label={t('perf.tr.session_title')} optional>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('perf.tr.when')}>
          <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('perf.tr.when')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('perf.tr.start_time')} optional>
            <Input value={startTime} onChange={(e) => setStartTime(e.target.value.slice(0, 5))} placeholder="09:00" />
          </Field>
          <Field label={t('perf.tr.end_time')} optional>
            <Input value={endTime} onChange={(e) => setEndTime(e.target.value.slice(0, 5))} placeholder="12:00" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('perf.tr.where')} optional>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('perf.tr.link')} optional>
            <Input value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('perf.tr.seats_label')} optional hint={t('perf.tr.seats_hint')}>
            <Input value={capacity} inputMode="numeric" onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Field label={t('perf.tr.cost')} optional>
            <MoneyInput value={cost} onChange={setCost} currency={currency} label={t('perf.tr.cost')} />
          </Field>
          <Field label={t('perf.tr.trainer')} optional>
            <Input value={trainer} onChange={(e) => setTrainer(e.target.value)} maxLength={160} />
          </Field>
        </div>
        <Field label={t('perf.tr.status_label')}>
          <Segmented value={status} onChange={setStatus} label={t('perf.tr.status_label')} size="sm" options={(['planned', 'open', 'done', 'cancelled'] as const).map((v) => ({ value: v, label: t(`perf.tr.status.${v}`) }))} />
        </Field>
      </div>
    </Dialog>
  );
}

function EnrolDialog({ open, onClose, training }: { open: boolean; onClose: () => void; training: string }): React.JSX.Element | null {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPeople([]);
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ enrolled: number }>('trainings.enrol', { training, employees: people.map((p) => p.id) });
      changed(...READS.training);
      toast.success(tn('perf.tr.enrolled_n', r.enrolled));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.tr.enrol_people')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={people.length === 0} onClick={() => void save()}>{tn('perf.tr.enrol_n', people.length)}</Button></>}>
      <div className="flex flex-col gap-3">
        <PersonPicker value="" onChange={(v, item) => v !== '' && item !== null && !people.some((p) => p.id === v) && setPeople((l) => [...l, { id: v, name: item.label }])} label={t('perf.tr.enrol_people')} placeholder={t('perf.tr.pick_person')} exclude={people.map((p) => p.id)} />
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <span key={p.id} className="inline-flex h-7 items-center gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-2 text-[12px]">
              {p.name}
              <IconButton icon={Trash2} size={24} label={t('ui.remove')} onClick={() => setPeople((l) => l.filter((x) => x.id !== p.id))} />
            </span>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function RecordDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const programs = useOp<{ programs: Program[] }>('training-programs.list', {}, READS.training, { skip: !open, name: 'perf.tr.programs' });
  const [program, setProgram] = useState('');
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setProgram('');
      setName('');
      setDay('');
      setFile(null);
    }
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await opForm('training-attendees.record', { ...(program !== '' ? { program } : { program_name: name.trim(), kind: 'certification' }), completed_on: day }, { file });
      changed(...READS.training);
      toast.success(t('perf.tr.recorded'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('perf.tr.record')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={program === '' && name.trim() === ''} onClick={() => void save()}>{t('perf.tr.record_save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('perf.tr.program')}>
          <Picker value={program} onChange={(v) => setProgram(v)} items={(programs.data?.programs ?? []).map((p) => ({ value: p.id, label: p.name }))} label={t('perf.tr.program')} placeholder={t('perf.tr.pick_or_new')} clearable />
        </Field>
        {program === '' && (
          <Field label={t('perf.tr.cert_name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder={t('perf.tr.cert_name_ph')} />
          </Field>
        )}
        <Field label={t('perf.tr.completed')}>
          <DayPicker value={day} onChange={setDay} label={t('perf.tr.completed')} max={today()} />
        </Field>
        <Field label={t('perf.tr.certificate')} optional>
          <FileDrop onFiles={(f) => setFile(f[0] ?? null)} accept="application/pdf,image/png,image/jpeg,image/webp" label={file !== null ? file.name : t('perf.tr.drop_certificate')} />
        </Field>
        <Notice>{t('perf.tr.record_note')}</Notice>
      </div>
    </Dialog>
  );
}

function ProgramDialog({ value, onClose }: { value: Program | null | 'new'; onClose: () => void }): React.JSX.Element | null {
  const p = value === 'new' || value === null ? null : value;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Program['kind']>('course');
  const [provider, setProvider] = useState('');
  const [hours, setHours] = useState('');
  const [months, setMonths] = useState('');
  const [link, setLink] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value === null) return;
    setName(p?.name ?? '');
    setKind(p?.kind ?? 'course');
    setProvider(p?.provider ?? '');
    setHours(p !== null && p.duration_hours > 0 ? String(p.duration_hours) : '');
    setMonths(p !== null && p.valid_months > 0 ? String(p.valid_months) : '');
    setLink(p?.link ?? '');
    setArchived(p?.archived ?? false);
  }, [value, p]);
  if (value === null) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const params = { name: name.trim(), kind, provider, duration_hours: hours === '' ? 0 : Number(hours), valid_months: months === '' ? 0 : Number(months), link };
      if (p === null) await op('training-programs.add', params);
      else await op('training-programs.update', { program: p.id, ...params, archived });
      changed(...READS.training);
      toast.success(t('perf.tr.program_saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={p === null ? t('perf.tr.add_program') : t('perf.tr.edit_program')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>{t('ui.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('perf.tr.program_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </Field>
        <Field label={t('perf.tr.kind_label')}>
          <Segmented value={kind} onChange={setKind} label={t('perf.tr.kind_label')} size="sm" options={(['course', 'workshop', 'certification'] as const).map((k) => ({ value: k, label: t(`perf.tr.kind.${k}`) }))} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('perf.tr.provider')} optional>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={160} />
          </Field>
          <Field label={t('perf.tr.hours')} optional>
            <Input value={hours} inputMode="decimal" onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          <Field label={t('perf.tr.valid_months')} optional help={t('perf.tr.valid_help')}>
            <Input value={months} inputMode="numeric" onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
        </div>
        <Field label={t('perf.tr.link')} optional>
          <Input value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://" />
        </Field>
        {p !== null && (
          <label className="flex items-center gap-2.5 text-[13px]">
            <Toggle checked={archived} onChange={setArchived} label={t('perf.tr.archived')} />
            {t('perf.tr.archived')}
          </label>
        )}
      </div>
    </Dialog>
  );
}

function RequirementDialog({ value, onClose }: { value: Requirement | null | 'new'; onClose: () => void }): React.JSX.Element | null {
  const me = useMe();
  const r = value === 'new' || value === null ? null : value;
  const programs = useOp<{ programs: Program[] }>('training-programs.list', {}, READS.training, { skip: value === null, name: 'perf.tr.programs' });
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { skip: value === null });
  const titles = useOp<{ titles: { id: string; name: string }[] }>('titles.list', {}, ['job_titles'], { skip: value === null });
  const [program, setProgram] = useState('');
  const [entity, setEntity] = useState('');
  const [dept, setDept] = useState('');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('30');
  const [byDay, setByDay] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value === null) return;
    setProgram(r?.program ?? '');
    setEntity(r?.entity ?? '');
    setDept(r?.department ?? '');
    setTitle(r?.job_title ?? '');
    setDays(r !== null ? (r.due_days > 0 ? String(r.due_days) : '') : '30');
    setByDay(r?.due_day ?? '');
  }, [value, r]);
  if (value === null) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const params = { program, entity, department: dept, job_title: title, due_days: days === '' ? 0 : Number(days), due_day: byDay };
      if (r === null) await op('training-requirements.add', params);
      else await op('training-requirements.update', { requirement: r.id, ...params });
      changed(...READS.training);
      toast.success(t('perf.tr.requirement_saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (r === null || !(await confirmAsk(t('perf.tr.remove_req_text'), t('perf.tr.remove_req')))) return;
    try {
      await op('training-requirements.delete', { requirement: r.id });
      changed(...READS.training);
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={r === null ? t('perf.tr.add_requirement') : t('perf.tr.edit_requirement')}
      footer={
        <>
          {r !== null && <LinkButton className="h-6" tone="danger" onClick={() => void remove()}>{t('perf.tr.remove_req')}</LinkButton>}
          <span className="flex-1" />
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={program === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('perf.tr.program')}>
          <Picker value={program} onChange={(v) => setProgram(v)} items={(programs.data?.programs ?? []).map((p) => ({ value: p.id, label: p.name }))} label={t('perf.tr.program')} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {me.entities.length > 1 && (
            <Field label={t('perf.wiz.entity')} optional>
              <Picker value={entity} onChange={(v) => setEntity(v)} items={me.entities.map((e) => ({ value: e.id, label: e.name }))} label={t('perf.wiz.entity')} placeholder={t('perf.tr.everyone')} clearable />
            </Field>
          )}
          <Field label={t('perf.cycle.department')} optional>
            <Picker value={dept} onChange={(v) => setDept(v)} items={(depts.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} label={t('perf.cycle.department')} placeholder={t('perf.tr.any')} clearable />
          </Field>
          <Field label={t('perf.tr.job_title')} optional>
            <Picker value={title} onChange={(v) => setTitle(v)} items={(titles.data?.titles ?? []).map((d) => ({ value: d.id, label: d.name }))} label={t('perf.tr.job_title')} placeholder={t('perf.tr.any')} clearable />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('perf.tr.within_days')} optional help={t('perf.tr.within_help')}>
            <Input value={days} inputMode="numeric" onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Field label={t('perf.tr.by_day_label')} optional>
            <DayPicker value={byDay} onChange={setByDay} label={t('perf.tr.by_day_label')} clearable />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

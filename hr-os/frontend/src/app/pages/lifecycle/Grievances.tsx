/**
 * Grievances: anyone raises a concern (confidential, optionally anonymous)
 * and follows its status; HR (people full) sees the cases, assigns an
 * investigator, shares a case with named members or your AI agent, writes
 * notes (internal or for the reporter) and closes it with a resolution.
 */
import { useEffect, useState } from 'react';
import { Lock, MessageSquarePlus, MoreHorizontal, ShieldAlert, Sparkle, Undo2, UserCheck, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Button, DataTable, DayPicker, Dialog, Empty, Field, FactStrip, Input, LoadError, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, Picker, Segmented, StatusDot, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { GRIEVANCE_READS, GRIEVANCE_TONE, LabeledToggle, SkeletonRows, useMemberItems, usePeopleItems } from '../../components/lifecycle/bits.tsx';
import type { Grievance } from '../../components/lifecycle/types.ts';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';

interface GType {
  id: string;
  code: string;
  name: string;
  description: string;
  confidential: boolean;
}

export function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const types = useOp<{ types: GType[] }>('grievance-types.list', {}, ['grievance_types'], { name: 'lifecycle.gtypes', skip: !open });
  const people = usePeopleItems();
  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [against, setAgainst] = useState('');
  const [when, setWhen] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setType('');
      setSubject('');
      setDescription('');
      setAgainst('');
      setWhen('');
      setAnonymous(false);
      setErr(null);
    }
  }, [open]);
  const submit = async (): Promise<void> => {
    if (subject.trim() === '') return setErr(t('lifecycle.subject_needed'));
    if (description.trim() === '') return setErr(t('lifecycle.what_happened_needed'));
    setBusy(true);
    setErr(null);
    try {
      const r = await op<{ grievance: Grievance }>('grievances.report', { type: type === '' ? undefined : type, subject, description, against: against === '' ? undefined : against, occurred_on: when === '' ? undefined : when, anonymous }, { quiet: true });
      changed(...GRIEVANCE_READS);
      onClose();
      toast.success(t('lifecycle.concern_sent'));
      navigate(`/lifecycle/grievances/${r.grievance.id}`);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.raise_concern')}
      meta={t('lifecycle.confidential_meta')}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Lock} busy={busy} onClick={() => void submit()}>
            {t('lifecycle.send_to_hr')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.concern_type')}>
          <Picker value={type} onChange={(v) => setType(v)} items={(types.data?.types ?? []).map((x) => ({ value: x.code, label: x.name, sub: x.description }))} label={t('lifecycle.f.concern_type')} placeholder={t('lifecycle.choose')} />
        </Field>
        <Field label={t('lifecycle.f.subject')}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={t('lifecycle.f.what_happened')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} minRows={4} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('lifecycle.f.person_concerned')} optional>
            <Picker value={against} onChange={(v) => setAgainst(v)} items={people} label={t('lifecycle.f.person_concerned')} placeholder={t('lifecycle.no_one')} clearable />
          </Field>
          <Field label={t('lifecycle.f.when')} optional>
            <DayPicker value={when} onChange={setWhen} label={t('lifecycle.f.when')} clearable />
          </Field>
        </div>
        <LabeledToggle checked={anonymous} onChange={setAnonymous} label={t('lifecycle.anonymous_label')} />
        {anonymous && <Notice>{t('lifecycle.anonymous_note')}</Notice>}
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function GrievancesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'people', 'full');
  const status = (['active', 'resolved', 'closed', 'all'] as const).find((s) => s === query.get('status')) ?? 'active';
  const [limit, setLimit] = useState(50);
  const [report, setReport] = useState(false);
  const live = useOp<{ grievances: Grievance[]; total: number; hr: boolean }>('grievances.list', { status, limit }, GRIEVANCE_READS, { name: 'lifecycle.grievances' });
  const d = live.data;
  const raiseBtn =
    me.employee !== null ? (
      <Button variant={hr ? 'default' : 'primary'} icon={ShieldAlert} onClick={() => setReport(true)}>
        {t('lifecycle.raise_concern')}
      </Button>
    ) : null;
  const columns: Column<Grievance>[] = [
    { key: 'subject', label: t('lifecycle.f.subject'), width: 'minmax(220px,2fr)', phone: 'title', render: (r) => <span className="hr-wrap font-medium">{r.subject}</span> },
    { key: 'number', label: t('lifecycle.number'), width: '80px', mono: true, hideBelow: 'lg', render: (r) => r.number },
    { key: 'type', label: t('lifecycle.f.concern_type'), width: '150px', hideBelow: 'lg', render: (r) => r.type_name },
    ...(hr ? [{ key: 'reporter', label: t('lifecycle.reported_by'), width: 'minmax(120px,1fr)', render: (r: Grievance) => (r.anonymous ? <span className="text-[var(--hr-muted)]">{t('lifecycle.anonymous')}</span> : (r.reporter_name ?? '')) } as Column<Grievance>] : []),
    ...(hr ? [{ key: 'assignee', label: t('lifecycle.investigator'), width: 'minmax(120px,1fr)', hideBelow: 'xl', render: (r: Grievance) => r.assignee_name ?? '' } as Column<Grievance>] : []),
    { key: 'created', label: t('lifecycle.reported_on'), width: '110px', mono: true, hideBelow: 'lg', render: (r) => fmtStampDay(r.created) },
    { key: 'status', label: t('lifecycle.status'), width: '130px', phone: 'end', render: (r) => <StatusDot tone={GRIEVANCE_TONE[r.status] ?? 'neutral'} label={t(`lifecycle.g_status.${r.status}`)} /> },
  ];
  return (
    <>
      <PageHeader title={hr ? t('lifecycle.grievances') : t('lifecycle.concerns')} meta={d !== null ? tn('lifecycle.meta_cases', d.total) : ''} back={can(me, 'people', 'view') ? '#/lifecycle' : undefined}>
        {raiseBtn !== null && <Acts>{raiseBtn}</Acts>}
      </PageHeader>
      <PageBody>
        {raiseBtn !== null && <PhoneActs>{raiseBtn}</PhoneActs>}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'active' ? undefined : v })}
              label={t('lifecycle.status')}
              size="sm"
              options={[
                { value: 'active', label: t('lifecycle.active') },
                { value: 'resolved', label: t('lifecycle.g_status.resolved') },
                { value: 'closed', label: t('lifecycle.g_status.closed') },
                { value: 'all', label: t('lifecycle.all') },
              ]}
            />
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
              <Lock size={12} aria-hidden />
              {hr ? t('lifecycle.confidential_hr') : t('lifecycle.confidential_you')}
            </span>
          </div>
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <SkeletonRows />
            )
          ) : (
            <DataTable
              label={t('lifecycle.grievances')}
              columns={columns}
              rows={d.grievances}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/lifecycle/grievances/${r.id}`}
              hasMore={d.total > d.grievances.length}
              onMore={() => setLimit((l) => l + 50)}
              loadingMore={live.loading}
              empty={<Empty icon={ShieldAlert} title={hr ? t('lifecycle.no_cases') : t('lifecycle.no_reports')} action={me.employee !== null && !hr ? <Button icon={ShieldAlert} onClick={() => setReport(true)}>{t('lifecycle.raise_concern')}</Button> : undefined} />}
            />
          )}
        </div>
      </PageBody>
      <ReportDialog open={report} onClose={() => setReport(false)} />
    </>
  );
}

function ShareDialog({ open, onClose, g }: { open: boolean; onClose: () => void; g: Grievance }): React.JSX.Element {
  const members = useMemberItems(open);
  const [ids, setIds] = useState<string[]>((g.shared_with ?? []).map((x) => x.id));
  const [agent, setAgent] = useState(g.agent_shared === true);
  const [assignee, setAssignee] = useState(g.assignee ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      if (assignee !== (g.assignee ?? '')) await op('grievances.assign', { grievance: g.id, member: assignee }, { quiet: true });
      await op('grievances.share', { grievance: g.id, members: ids, agent }, { quiet: true });
      changed(...GRIEVANCE_READS);
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.who_works_on')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.investigator')} hint={t('lifecycle.investigator_hint')}>
          <Picker value={assignee} onChange={(v) => setAssignee(v)} items={members} label={t('lifecycle.investigator')} placeholder={t('lifecycle.hr_itself')} clearable />
        </Field>
        <Field label={t('lifecycle.can_read')} optional>
          <div className="flex flex-col gap-1.5">
            {ids.map((id) => (
              <span key={id} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{members.find((m) => m.value === id)?.label ?? id}</span>
                <Button size="sm" variant="ghost" onClick={() => setIds((x) => x.filter((y) => y !== id))}>
                  {t('ui.remove')}
                </Button>
              </span>
            ))}
            <Picker value="" onChange={(v) => v !== '' && setIds((x) => (x.includes(v) ? x : [...x, v]))} items={members.filter((m) => !ids.includes(m.value))} label={t('lifecycle.add_reader')} placeholder={t('lifecycle.add_reader')} />
          </div>
        </Field>
        <LabeledToggle checked={agent} onChange={setAgent} label={t('lifecycle.share_with_agent')} />
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function StatusDialog({ open, onClose, g }: { open: boolean; onClose: () => void; g: Grievance }): React.JSX.Element {
  const [status, setStatus] = useState<'investigating' | 'resolved' | 'closed'>(g.status === 'open' ? 'investigating' : g.status === 'investigating' ? 'resolved' : 'closed');
  const [resolution, setResolution] = useState(g.resolution);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await op('grievances.status', { grievance: g.id, status, resolution }, { quiet: true });
      changed(...GRIEVANCE_READS);
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.change_status')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          label={t('lifecycle.status')}
          options={[
            { value: 'investigating', label: t('lifecycle.g_status.investigating') },
            { value: 'resolved', label: t('lifecycle.g_status.resolved') },
            { value: 'closed', label: t('lifecycle.g_status.closed') },
          ]}
        />
        {status !== 'investigating' && (
          <Field label={t('lifecycle.f.resolution')} hint={t('lifecycle.resolution_hint')}>
            <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} minRows={3} />
          </Field>
        )}
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function GrievancePage({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ grievance: Grievance }>('grievances.get', { grievance: params['id'] ?? '' }, GRIEVANCE_READS, { name: 'lifecycle.grievance' });
  const [dialog, setDialog] = useState<'share' | 'status' | null>(null);
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const g = live.data?.grievance ?? null;
  if (g === null) {
    return (
      <>
        <PageHeader title={t('lifecycle.concern')} back="#/lifecycle/grievances" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  }
  const reporter = g.see === 'reporter';
  const addNote = async (): Promise<void> => {
    if (text.trim() === '') return;
    setBusy(true);
    try {
      await op('grievances.note', { grievance: g.id, text, visible_to_reporter: reporter ? undefined : visible });
      setText('');
      changed(...GRIEVANCE_READS);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.withdraw_concern_text'), t('lifecycle.withdraw'), t('lifecycle.withdraw'), 'primary'))) return;
    try {
      await op('grievances.withdraw', { grievance: g.id });
      changed(...GRIEVANCE_READS);
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={g.subject} meta={[g.number, g.type_name, t(`lifecycle.g_status.${g.status}`)].filter((x) => x !== '').join(' · ')} back="#/lifecycle/grievances">
        {g.can?.status === true && (
          <Acts>
            <Button variant="primary" onClick={() => setDialog('status')}>
              {t('lifecycle.change_status')}
            </Button>
          </Acts>
        )}
        {(g.can?.manage === true || g.can?.withdraw === true) && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.case_menu')}>
            {(close) => (
              <>
                {g.can?.manage === true && (
                  <MenuItem icon={Users} onClick={() => (close(), setDialog('share'))}>
                    {t('lifecycle.who_works_on')}
                  </MenuItem>
                )}
                {g.can?.withdraw === true && (
                  <MenuItem icon={Undo2} onClick={() => (close(), void withdraw())}>
                    {t('lifecycle.withdraw')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        {g.can?.status === true && (
          <PhoneActs>
            <Button variant="primary" onClick={() => setDialog('status')}>
              {t('lifecycle.change_status')}
            </Button>
          </PhoneActs>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
            <Panel index="01" label={t('lifecycle.what_happened')}>
              <div className="hr-wrap whitespace-pre-wrap text-[14px] leading-[1.6]">{g.description}</div>
            </Panel>
            {(g.status === 'resolved' || g.status === 'closed') && g.resolution !== '' && (
              <Notice tone="good">
                <span className="hr-label mr-2">{t('lifecycle.f.resolution')}</span>
                {g.resolution}
              </Notice>
            )}
            <Panel index="02" label={t('lifecycle.notes')} flush>
              {(g.notes ?? []).length === 0 ? (
                <Empty icon={MessageSquarePlus} title={reporter ? t('lifecycle.no_updates') : t('lifecycle.no_notes')} className="py-6" />
              ) : (
                <ol className="flex flex-col px-3.5 pb-2">
                  {(g.notes ?? []).map((n) => (
                    <li key={n.id} className="border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        {n.as === 'agent' ? <AgentMark size={16} /> : null}
                        <span className="text-[13px] font-semibold">{n.by_name}</span>
                        <span className="hr-label">{ago(n.at)}</span>
                        {!reporter && <Tag tone={n.visible_to_reporter ? 'rh' : 'faint'}>{n.visible_to_reporter ? t('lifecycle.reporter_sees') : t('lifecycle.internal')}</Tag>}
                      </div>
                      <div className="hr-wrap whitespace-pre-wrap text-[13px] leading-5">{n.text}</div>
                    </li>
                  ))}
                </ol>
              )}
              {g.can?.note === true && (
                <div className="flex flex-col gap-2 border-t border-[var(--hr-line)] px-3.5 py-3">
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} placeholder={reporter ? t('lifecycle.add_info') : t('lifecycle.add_note')} aria-label={t('lifecycle.add_note')} />
                  <div className="flex flex-wrap items-center gap-3">
                    {!reporter && g.see !== 'agent' && <LabeledToggle checked={visible} onChange={setVisible} label={t('lifecycle.reporter_can_read')} />}
                    <span className="flex-1" />
                    <Button busy={busy} disabled={text.trim() === ''} onClick={() => void addNote()}>
                      {reporter ? t('lifecycle.send') : t('lifecycle.add_note_btn')}
                    </Button>
                  </div>
                </div>
              )}
            </Panel>
          </div>
          <Panel index="03" label={t('lifecycle.case')} className="self-start lg:col-span-4">
            <FactStrip
              className="!grid-cols-1 sm:!flex-col"
              items={[
                { label: t('lifecycle.status'), value: <StatusDot tone={GRIEVANCE_TONE[g.status] ?? 'neutral'} label={t(`lifecycle.g_status.${g.status}`)} /> },
                { label: t('lifecycle.reported_on'), value: fmtStampDay(g.created), mono: true },
                ...(g.occurred_on !== '' ? [{ label: t('lifecycle.f.when'), value: fmtDay(g.occurred_on), mono: true }] : []),
                ...(!reporter ? [{ label: t('lifecycle.reported_by'), value: g.anonymous ? t('lifecycle.anonymous') : (g.reporter_name ?? '') }] : []),
                ...(!reporter && (g.against_name ?? '') !== '' ? [{ label: t('lifecycle.f.person_concerned'), value: g.against_name ?? '' }] : []),
                ...(!reporter ? [{ label: t('lifecycle.investigator'), value: (g.assignee_name ?? '') !== '' ? (g.assignee_name ?? '') : t('lifecycle.hr_itself') }] : []),
              ]}
            />
            {!reporter && ((g.shared_with ?? []).length > 0 || g.agent_shared === true) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
                <UserCheck size={12} aria-hidden />
                {[...(g.shared_with ?? []).map((x) => x.name), ...(g.agent_shared === true ? [t('lifecycle.lane.agent')] : [])].join(', ')}
                {g.agent_shared === true && <Sparkle size={11} aria-hidden />}
              </div>
            )}
            <div className={cn('mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]')}>
              <Lock size={12} aria-hidden />
              {g.anonymous ? t('lifecycle.anonymous_case') : t('lifecycle.confidential_case')}
            </div>
          </Panel>
        </div>
      </PageBody>
      {dialog === 'share' && <ShareDialog open onClose={() => setDialog(null)} g={g} />}
      {dialog === 'status' && <StatusDialog open onClose={() => setDialog(null)} g={g} />}
    </>
  );
}

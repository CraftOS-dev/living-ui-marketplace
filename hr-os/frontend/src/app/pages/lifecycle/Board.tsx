/**
 * The checklist board of one person: one lane per assignee (HR, the
 * manager, IT, the person, named members, your AI agent), tasks by due
 * day with a one-tap check, an inline "+" on each lane, first-day details
 * the new hire sees, and your AI agent asked about its own tasks.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, MoreHorizontal, Pencil, Plus, Sparkle, Trash2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Button, DayPicker, Dialog, Empty, Field, FactStrip, IconButton, Input, LoadError, Menu, MenuItem, MenuSep, Notice, PageBody, PageHeader, Picker, Segmented, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { DueLabel, kindName, LANE_ICON, LANE_ORDER, laneName, ProgressBar, SkeletonRows, TASK_READS, TaskCheck, useMemberItems, usePeopleItems } from '../../components/lifecycle/bits.tsx';
import type { Checklist, Lane, Task, TaskKind } from '../../components/lifecycle/types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, today as officeToday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, changed, drop, patch, useOp } from '../../lib/live.ts';

interface LaneGroup {
  key: string;
  lane: Lane;
  label: string;
  tasks: Task[];
}

function lanesOf(tasks: Task[]): LaneGroup[] {
  const map = new Map<string, LaneGroup>();
  for (const x of tasks) {
    const key = x.assignee_kind === 'member' ? 'member:' + x.assignee_member : x.assignee_kind;
    let g = map.get(key);
    if (g === undefined) {
      g = { key, lane: x.assignee_kind, label: x.assignee_kind === 'member' ? x.assignee_label : laneName(x.assignee_kind), tasks: [] };
      map.set(key, g);
    }
    g.tasks.push(x);
  }
  const out = [...map.values()];
  out.sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || a.label.localeCompare(b.label));
  for (const g of out) g.tasks.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.due || '9999').localeCompare(b.due || '9999') || a.sort - b.sort);
  return out;
}

function TaskCard({ task, today, canEdit, onEdit }: { task: Task; today: string; canEdit: boolean; onEdit: (x: Task) => void }): React.JSX.Element {
  const closed = task.status !== 'open';
  const skip = async (): Promise<void> => {
    await act([patch(task.id, { status: 'skipped' })], () => op('tasks.skip', { task: task.id }), TASK_READS);
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.delete_task_text', { title: task.title }), t('lifecycle.delete_task')))) return;
    await act([drop(task.id)], () => op('tasks.delete', { task: task.id }), TASK_READS);
  };
  return (
    <li className={cn('group flex min-w-0 items-start gap-2.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-2.5 py-2', closed && 'bg-transparent')}>
      <span className="pt-px">
        <TaskCheck task={task} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('hr-wrap block text-[13px] font-medium leading-5', closed && 'text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]')}>{task.title}</span>
        {task.description !== '' && !closed && <span className="hr-wrap block text-[12px] leading-[18px] text-[var(--hr-muted)]">{task.description}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <DueLabel task={task} today={today} />
          {task.kind === 'document' && <Tag tone={task.document !== null ? 'good' : 'faint'}>{task.document !== null ? t('lifecycle.file_in') : t('lifecycle.needs_file')}</Tag>}
          {task.kind === 'signature' && <Tag tone="faint">{t('lifecycle.signature')}</Tag>}
        </span>
        {closed && task.note !== '' && <span className="hr-wrap mt-1.5 block whitespace-pre-wrap border-l-2 border-[var(--hr-line-2)] pl-2 text-[12px] leading-[18px] text-[var(--hr-ink-2)]">{task.note}</span>}
        {closed && task.done_by_name !== '' && <span className="mt-1 block text-[12px] text-[var(--hr-muted)]">{t('lifecycle.by', { who: task.done_by_name })}</span>}
      </span>
      {canEdit && (
        <Menu icon={MoreHorizontal} label={t('lifecycle.task_menu')} width={200}>
          {(close) => (
            <>
              <MenuItem icon={Pencil} onClick={() => (close(), onEdit(task))}>
                {t('ui.edit')}
              </MenuItem>
              {!closed && (
                <MenuItem icon={X} onClick={() => (close(), void skip())}>
                  {t('lifecycle.skip')}
                </MenuItem>
              )}
              <MenuSep />
              <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                {t('ui.remove')}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </li>
  );
}

type LaneChoice = 'hr' | 'manager' | 'it' | 'employee' | 'agent' | 'member';

function TaskDialog({ open, onClose, checklist, task, lane }: { open: boolean; onClose: () => void; checklist: Checklist; task: Task | null; lane: string }): React.JSX.Element {
  const me = useMe();
  const members = useMemberItems(open && can(me, 'admin', 'view'));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState<LaneChoice>('hr');
  const [member, setMember] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState('');
  const key = open ? (task?.id ?? 'new:' + lane) : '';
  if (key !== seen) {
    setSeen(key);
    if (open) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      setDue(task?.due ?? checklist.anchor_day);
      const l = (task !== null ? (task.assignee_kind === 'member' ? 'member:' + task.assignee_member : task.assignee_kind) : lane) || 'hr';
      setWho((l.startsWith('member:') ? 'member' : l) as LaneChoice);
      setMember(l.startsWith('member:') ? l.slice(7) : '');
      setKind(task?.kind ?? 'task');
      setErr(null);
    }
  }
  const submit = async (): Promise<void> => {
    if (title.trim() === '') return setErr(t('lifecycle.title_needed'));
    if (who === 'member' && member === '') return setErr(t('lifecycle.pick_member'));
    const assignee = who === 'member' ? 'member:' + member : who;
    setBusy(true);
    setErr(null);
    try {
      if (task === null) await op('tasks.add', { checklist: checklist.id, title, description, due: due === '' ? undefined : due, assignee, kind }, { quiet: true });
      else await op('tasks.update', { task: task.id, title, description, due, assignee, kind }, { quiet: true });
      changed(...TASK_READS);
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
      title={task === null ? t('lifecycle.add_task') : t('lifecycle.edit_task')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {task === null ? t('lifecycle.add_task') : t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.task_title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={t('lifecycle.f.details')} optional>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('lifecycle.f.who')}>
            <Picker value={who} onChange={(v) => setWho(v as LaneChoice)} items={(['hr', 'manager', 'it', 'employee', 'agent', 'member'] as LaneChoice[]).filter((l) => l !== 'member' || members.length > 0).map((l) => ({ value: l, label: laneName(l), icon: LANE_ICON[l] }))} label={t('lifecycle.f.who')} />
          </Field>
          <Field label={t('lifecycle.f.due')}>
            <DayPicker value={due} onChange={setDue} label={t('lifecycle.f.due')} clearable />
          </Field>
        </div>
        {who === 'member' && (
          <Field label={t('lifecycle.f.member')}>
            <Picker value={member} onChange={(v) => setMember(v)} items={members} label={t('lifecycle.f.member')} placeholder={t('lifecycle.pick_member')} />
          </Field>
        )}
        <Field label={t('lifecycle.f.task_kind')}>
          <Segmented
            value={kind}
            onChange={setKind}
            label={t('lifecycle.f.task_kind')}
            options={[
              { value: 'task', label: t('lifecycle.tk.task') },
              { value: 'document', label: t('lifecycle.tk.document') },
              { value: 'signature', label: t('lifecycle.tk.signature') },
            ]}
          />
        </Field>
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function FirstDayDialog({ open, onClose, checklist }: { open: boolean; onClose: () => void; checklist: Checklist }): React.JSX.Element {
  const people = usePeopleItems();
  const fd = checklist.first_day;
  const [time, setTime] = useState(fd.time ?? '');
  const [place, setPlace] = useState(fd.place ?? '');
  const [contact, setContact] = useState('');
  const [bring, setBring] = useState(fd.bring ?? '');
  const [note, setNote] = useState(fd.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const contactNumber = people.find((p) => p.label === fd.contact_name)?.value ?? '';
  const save = async (): Promise<void> => {
    if (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setErr(t('lifecycle.time_format'));
    setBusy(true);
    setErr(null);
    try {
      await op('checklists.first-day', { checklist: checklist.id, time, place, contact: contact !== '' ? contact : contactNumber, bring, note }, { quiet: true });
      changed('checklists');
      toast.success(t('lifecycle.first_day_saved'));
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
      title={t('lifecycle.first_day')}
      meta={fmtDay(checklist.anchor_day, { weekday: true })}
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
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
          <Field label={t('lifecycle.f.arrive')}>
            <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="09:00" className="hr-mono" inputMode="numeric" />
          </Field>
          <Field label={t('lifecycle.f.place')}>
            <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('lifecycle.place_example')} />
          </Field>
        </div>
        <Field label={t('lifecycle.f.contact')}>
          <Picker value={contact !== '' ? contact : contactNumber} onChange={(v) => setContact(v)} items={people} label={t('lifecycle.f.contact')} placeholder={t('lifecycle.manager_default')} clearable />
        </Field>
        <Field label={t('lifecycle.f.bring')} optional>
          <Input value={bring} onChange={(e) => setBring(e.target.value)} placeholder={t('lifecycle.bring_example')} />
        </Field>
        <Field label={t('lifecycle.f.welcome_note')} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} />
        </Field>
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function BoardPage({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ checklist: Checklist }>('checklists.get', { checklist: params['id'] ?? '' }, TASK_READS, { name: 'lifecycle.board' });
  const [edit, setEdit] = useState<{ task: Task | null; lane: string } | null>(null);
  const [firstDay, setFirstDay] = useState(false);
  const [asking, setAsking] = useState(false);
  const c = live.data?.checklist ?? null;
  const lanes = useMemo(() => lanesOf(c?.tasks ?? []), [c?.tasks]);
  if (c === null) {
    return (
      <>
        <PageHeader title={t('lifecycle.checklist')} back="#/lifecycle" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  }
  const canEdit = c.can?.edit === true && c.status !== 'cancelled';
  const today = officeToday({ entity: c.entity });
  const cancel = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.cancel_checklist_text', { name: c.name, who: c.employee_name }), t('lifecycle.cancel_checklist'), t('lifecycle.cancel_checklist')))) return;
    try {
      await op('checklists.cancel', { checklist: c.id });
      changed(...TASK_READS);
    } catch {
      /* toast shown */
    }
  };
  const askAgent = async (): Promise<void> => {
    setAsking(true);
    try {
      const r = await op<{ asked: boolean }>('checklists.ask-agent', { checklist: c.id });
      changed(...TASK_READS);
      toast.success(r.asked ? t('lifecycle.agent_asked') : t('agent.already_asked'));
    } catch {
      /* toast shown */
    } finally {
      setAsking(false);
    }
  };
  const anchorLabel = c.kind === 'offboarding' ? t('lifecycle.last_day') : c.kind === 'onboarding' ? t('lifecycle.first_day_label') : t('lifecycle.from_day');
  const fd = c.first_day;
  const actions =
    (canEdit && c.kind === 'onboarding') || c.can?.ask_agent === true ? (
      <>
        {canEdit && c.kind === 'onboarding' && (
          <Button icon={CalendarClock} onClick={() => setFirstDay(true)}>
            {t('lifecycle.first_day')}
          </Button>
        )}
        {c.can?.ask_agent === true && <AgentAskStatus ask={c.agent} reads={TASK_READS} />}
        {c.can?.ask_agent === true && (
          <Button variant="agent" icon={Sparkle} busy={asking} onClick={() => void askAgent()} disabled={c.agent?.open === true}>
            {c.agent?.open === true ? t('lifecycle.agent_on_it') : t('lifecycle.ask_agent')}
          </Button>
        )}
      </>
    ) : null;
  return (
    <>
      <PageHeader title={c.employee_name + ': ' + c.name} meta={[kindName(c.kind), anchorLabel + ' ' + fmtDay(c.anchor_day), c.status === 'open' ? t('lifecycle.pct_done', { n: c.progress.percent }) : t(`lifecycle.cl_status.${c.status}`)].join(' · ')} back="#/lifecycle">
        {actions !== null && <Acts>{actions}</Acts>}
        {canEdit && c.status === 'open' && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.checklist_menu')}>
            {(close) => (
              <MenuItem icon={X} danger onClick={() => (close(), void cancel())}>
                {t('lifecycle.cancel_checklist')}
              </MenuItem>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody wide>
        {actions !== null && <PhoneActs>{actions}</PhoneActs>}
        <div className="hr-panel hr-in mb-3 flex flex-wrap items-center gap-x-8 gap-y-3 px-3.5 py-3">
          <FactStrip
            items={[
              { label: t('lifecycle.person'), value: <a href={`#/people/${c.employee_number}`} className="hr-link">{c.employee_name}</a> },
              { label: t('lifecycle.role'), value: c.title !== '' ? c.title : '-' },
              { label: anchorLabel, value: fmtDay(c.anchor_day, { weekday: true }), mono: true },
              { label: t('lifecycle.entity'), value: c.entity_name },
              { label: t('lifecycle.started_by'), value: c.started_actor === 'agent' ? <span className="inline-flex items-center gap-1.5"><AgentMark size={16} />{c.started_by_name}</span> : c.started_by_name || t('lifecycle.automatic') },
            ]}
          />
          <span className="min-w-[200px] flex-1">
            <ProgressBar progress={c.progress} wide />
          </span>
        </div>
        {c.kind === 'onboarding' && (fd.time || fd.place) && (
          <Notice className="mb-3">
            {t('lifecycle.first_day_summary', { time: fd.time ?? '', place: fd.place ?? '', who: fd.contact_name ?? '' })}
          </Notice>
        )}
        {c.no_it_team === true && lanes.some((l) => l.lane === 'it') && c.see === 'all' && <Notice className="mb-3">{t('lifecycle.no_it_team')}</Notice>}
        {lanes.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={Plus} title={t('lifecycle.no_tasks_on_checklist')} action={canEdit ? <Button variant="primary" icon={Plus} onClick={() => setEdit({ task: null, lane: 'hr' })}>{t('lifecycle.add_task')}</Button> : undefined} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
            {lanes.map((g) => {
              const Icon = LANE_ICON[g.lane];
              const closed = g.tasks.filter((x) => x.status !== 'open').length;
              return (
                <section key={g.key} className="hr-in flex min-w-0 flex-col rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-sunk)]">
                  <header className="flex h-10 items-center gap-2 px-3">
                    {g.lane === 'agent' ? <AgentMark size={18} working={c.agent?.open === true ? 'waiting' : undefined} /> : <Icon size={14} aria-hidden className="text-[var(--hr-ink-2)]" />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{g.label}</span>
                    {g.lane === 'manager' && g.tasks[0] !== undefined && <span className="hidden truncate text-[12px] text-[var(--hr-muted)] sm:inline">{g.tasks[0].assignee_label}</span>}
                    <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">
                      {closed}/{g.tasks.length}
                    </span>
                    {canEdit && <IconButton icon={Plus} label={t('lifecycle.add_to_lane', { lane: g.label })} size={26} onClick={() => setEdit({ task: null, lane: g.key })} />}
                  </header>
                  <ul className="flex flex-col gap-1.5 px-2 pb-2">
                    {g.tasks.map((x) => (
                      <TaskCard key={x.id} task={x} today={today} canEdit={canEdit} onEdit={(task) => setEdit({ task, lane: g.key })} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
      {c !== null && <TaskDialog open={edit !== null} onClose={() => setEdit(null)} checklist={c} task={edit?.task ?? null} lane={edit?.lane ?? 'hr'} />}
      {c !== null && firstDay && <FirstDayDialog open onClose={() => setFirstDay(false)} checklist={c} />}
    </>
  );
}

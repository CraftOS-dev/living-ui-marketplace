/**
 * The performance dialogs used from several pages: add or edit a goal (with
 * key results and alignment), check in on a goal, give praise or feedback
 * (or answer a request), ask people for feedback.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, DayPicker, Dialog, Field, IconButton, Input, Picker, Segmented, Textarea, toast } from '../ui.tsx';
import type { PickItem } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { useMe, isManager, can } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { cn } from '../../../kit/index.ts';
import { PersonPicker, ProgressBar, valueIcon } from './bits.tsx';
import type { CompanyValue, FeedbackRow, Goal, GoalList, GoalStatus, KeyResult } from './types.ts';
import { READS } from './types.ts';

interface KrDraft {
  key: string;
  title: string;
  start: string;
  target: string;
  current: string;
  unit: string;
}

function krDraft(k?: KeyResult): KrDraft {
  return { key: k?.key ?? '', title: k?.title ?? '', start: k !== undefined ? String(k.start) : '0', target: k !== undefined ? String(k.target) : '100', current: k !== undefined ? String(k.current) : '', unit: k?.unit ?? '' };
}

type Owner = 'me' | 'person' | 'team' | 'company';

/** Add a goal (for me, a person, a team or the company) or change one. */
export function GoalDialog({ open, onClose, goal, employee, department, parent: parent0, onSaved }: { open: boolean; onClose: () => void; goal?: Goal | null | undefined; employee?: { id: string; name: string } | undefined; department?: string | undefined; parent?: string | undefined; onSaved?: ((g: Goal) => void) | undefined }): React.JSX.Element | null {
  const me = useMe();
  const hrEdit = can(me, 'performance', 'edit');
  const editing = goal !== undefined && goal !== null;
  const [owner, setOwner] = useState<Owner>('me');
  const [person, setPerson] = useState('');
  const [dept, setDept] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [weight, setWeight] = useState('');
  const [parent, setParent] = useState('');
  const [krs, setKrs] = useState<KrDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { skip: !open });
  const parents = useOp<GoalList>('goals.list', { scope: 'any', status: 'open', limit: 300 }, READS.goals, { skip: !open, name: 'perf.goal.parents' });

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editing) {
      setOwner(goal.scope === 'company' ? 'company' : goal.scope === 'team' ? 'team' : goal.employee?.id === me.employee?.id ? 'me' : 'person');
      setPerson(goal.employee?.id ?? '');
      setDept(goal.department?.id ?? '');
      setTitle(goal.title);
      setDescription(goal.description);
      setDue(goal.due);
      setWeight(goal.weight > 0 ? String(goal.weight) : '');
      setParent(goal.parent?.id ?? '');
      setKrs(goal.key_results.map((k) => krDraft(k)));
    } else {
      setOwner(employee !== undefined && employee.id !== me.employee?.id ? 'person' : department !== undefined ? 'team' : me.employee === null ? 'company' : 'me');
      setPerson(employee?.id ?? '');
      setDept(department ?? '');
      setTitle('');
      setDescription('');
      setDue('');
      setWeight('');
      setParent(parent0 ?? '');
      setKrs([]);
    }
  }, [open, editing, goal, employee, department, parent0, me.employee]);

  const parentItems: PickItem[] = useMemo(
    () =>
      (parents.data?.goals ?? [])
        .filter((g) => g.id !== goal?.id && g.scope !== 'personal')
        .map((g) => ({ value: g.id, label: g.title, sub: g.scope === 'company' ? t('perf.goal.scope.company') : g.department?.name ?? '' })),
    [parents.data, goal],
  );

  const owners: { value: Owner; label: string }[] = [];
  if (me.employee !== null) owners.push({ value: 'me', label: t('perf.goal.owner.me') });
  if (isManager(me) || hrEdit) owners.push({ value: 'person', label: t('perf.goal.owner.person') });
  if (isManager(me) || hrEdit) owners.push({ value: 'team', label: t('perf.goal.owner.team') });
  if (hrEdit) owners.push({ value: 'company', label: t('perf.goal.owner.company') });

  const save = async (): Promise<void> => {
    if (title.trim() === '') {
      setErr(t('perf.goal.need_title'));
      return;
    }
    const kr = krs.filter((k) => k.title.trim() !== '').map((k) => ({ ...(k.key !== '' ? { key: k.key } : {}), title: k.title.trim(), start: k.start === '' ? 0 : Number(k.start), target: k.target === '' ? 100 : Number(k.target), ...(k.current !== '' ? { current: Number(k.current) } : {}), unit: k.unit.trim() }));
    if (kr.some((k) => !Number.isFinite(k.start) || !Number.isFinite(k.target) || (k.current !== undefined && !Number.isFinite(k.current)))) {
      setErr(t('perf.goal.kr_numbers'));
      return;
    }
    const params: Record<string, unknown> = { title: title.trim(), description, due, weight: weight === '' ? 0 : Number(weight), key_results: kr, parent };
    setBusy(true);
    setErr(null);
    try {
      let out: { goal: Goal };
      if (editing) out = await op<{ goal: Goal }>('goals.update', { goal: goal.id, ...params }, { quiet: true });
      else {
        if (owner === 'person') params['employee'] = person;
        if (owner === 'team') params['department'] = dept;
        if (owner === 'company') params['company'] = true;
        if (owner === 'person' && person === '') throw new Error(t('perf.goal.need_person'));
        if (owner === 'team' && dept === '') throw new Error(t('perf.goal.need_team'));
        out = await op<{ goal: Goal }>('goals.create', params, { quiet: true });
      }
      changed(...READS.goals);
      toast.success(editing ? t('perf.goal.saved') : t('perf.goal.added'), { label: t('perf.goal.open'), run: () => (window.location.hash = `#/performance/goals/${out.goal.id}`) });
      onSaved?.(out.goal);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={editing ? t('perf.goal.edit') : t('perf.goal.add')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {editing ? t('ui.save') : t('perf.goal.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {!editing && owners.length > 1 && <Segmented value={owner} onChange={setOwner} options={owners} label={t('perf.goal.for')} size="sm" />}
        {!editing && owner === 'person' && (
          <Field label={t('perf.goal.person')}>
            <PersonPicker value={person} onChange={(v) => setPerson(v)} label={t('perf.goal.person')} placeholder={employee?.name} />
          </Field>
        )}
        {!editing && owner === 'team' && (
          <Field label={t('perf.goal.team')}>
            <Picker value={dept} onChange={(v) => setDept(v)} items={(depts.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} label={t('perf.goal.team')} />
          </Field>
        )}
        <Field label={t('perf.goal.title')} error={err}>
          <Input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={t('perf.goal.title_ph')} maxLength={200} />
        </Field>
        <Field label={t('perf.goal.description')} optional>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} maxLength={4000} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('perf.goal.due')} optional>
            <DayPicker value={due} onChange={setDue} label={t('perf.goal.due')} clearable />
          </Field>
          <Field label={t('perf.goal.weight')} optional help={t('perf.goal.weight_help')}>
            <Input value={weight} inputMode="numeric" onChange={(e) => setWeight(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="0" />
          </Field>
        </div>
        <Field label={t('perf.goal.aligns')} optional help={t('perf.goal.aligns_help')}>
          <Picker value={parent} onChange={(v) => setParent(v)} items={parentItems} label={t('perf.goal.aligns')} placeholder={t('perf.goal.aligns_none')} clearable />
        </Field>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] font-medium text-[var(--hr-ink-2)]">{t('perf.goal.krs')}</span>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setKrs((l) => [...l, krDraft()])} disabled={krs.length >= 10}>
              {t('perf.goal.add_kr')}
            </Button>
          </div>
          {krs.length === 0 ? (
            <button type="button" onClick={() => setKrs([krDraft()])} className="hr-focus rounded-[var(--hr-radius-sm)] border border-dashed border-[var(--hr-line-2)] px-3 py-2.5 text-left text-[12px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
              {t('perf.goal.kr_empty')}
            </button>
          ) : (
            krs.map((k, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-2">
                <Input value={k.title} onChange={(e) => setKrs((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={t('perf.goal.kr_title_ph')} aria-label={t('perf.goal.kr_title')} />
                <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => setKrs((l) => l.filter((_, j) => j !== i))} />
                <div className="col-span-2 grid grid-cols-4 gap-2">
                  {(['start', 'target', 'current', 'unit'] as const).map((f) => (
                    <label key={f} className="flex min-w-0 flex-col gap-1">
                      <span className="hr-label">{t(`perf.goal.kr_${f}`)}</span>
                      <Input value={k[f]} inputMode={f === 'unit' ? 'text' : 'decimal'} onChange={(e) => setKrs((l) => l.map((x, j) => (j === i ? { ...x, [f]: f === 'unit' ? e.target.value.slice(0, 12) : e.target.value.replace(/[^0-9.,-]/g, '').replace(',', '.') } : x)))} placeholder={f === 'current' ? k.start || '0' : ''} />
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Check in on a goal: the new values, the status and a short note. */
export function CheckinDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }): React.JSX.Element | null {
  const [values, setValues] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<GoalStatus>('on_track');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || goal === null) return;
    const v: Record<string, string> = {};
    for (const k of goal.key_results) v[k.key] = String(k.current);
    setValues(v);
    setProgress(goal.progress);
    setStatus(goal.status === 'dropped' ? 'on_track' : goal.status);
    setNote('');
  }, [open, goal]);
  if (!open || goal === null) return null;
  const preview = (k: KeyResult): number => {
    const cur = Number(values[k.key] ?? k.current);
    if (!Number.isFinite(cur)) return k.pct;
    if (k.target === k.start) return cur >= k.target ? 100 : 0;
    return Math.round(Math.max(0, Math.min(1, (cur - k.start) / (k.target - k.start))) * 100);
  };
  const save = async (): Promise<void> => {
    const kr: Record<string, number> = {};
    for (const k of goal.key_results) {
      const v = Number(values[k.key]);
      if (Number.isFinite(v) && v !== k.current) kr[k.key] = v;
    }
    setBusy(true);
    try {
      await op('goals.checkin', { goal: goal.id, note, status, ...(goal.key_results.length > 0 ? (Object.keys(kr).length > 0 ? { key_results: kr } : {}) : { progress }) });
      changed(...READS.goals);
      toast.success(t('perf.checkin.done'));
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
      width={520}
      title={t('perf.checkin.title')}
      meta={goal.title}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {t('perf.checkin.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {goal.key_results.length > 0 ? (
          <div className="flex flex-col gap-2">
            {goal.key_results.map((k) => (
              <div key={k.key} className="grid grid-cols-[1fr_110px] items-center gap-3">
                <div className="min-w-0">
                  <div className="hr-wrap text-[13px]">{k.title}</div>
                  <ProgressBar value={preview(k)} className="mt-1" label={k.title} />
                </div>
                <label className="flex flex-col gap-1">
                  <span className="hr-label truncate">
                    {t('perf.checkin.of', { target: k.target })} {k.unit}
                  </span>
                  <Input value={values[k.key] ?? ''} inputMode="decimal" onChange={(e) => setValues((v) => ({ ...v, [k.key]: e.target.value.replace(/[^0-9.,-]/g, '').replace(',', '.') }))} aria-label={k.title} />
                </label>
              </div>
            ))}
          </div>
        ) : (
          <Field label={t('perf.checkin.progress')}>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} aria-label={t('perf.checkin.progress')} className="flex-1 accent-[var(--hr-ink)]" />
              <span className="hr-mono hr-num w-10 text-right text-[13px]">{progress}%</span>
            </div>
          </Field>
        )}
        <Field label={t('perf.checkin.status')}>
          <Segmented
            value={status}
            onChange={setStatus}
            label={t('perf.checkin.status')}
            size="sm"
            options={(['on_track', 'at_risk', 'off_track', 'done'] as GoalStatus[]).map((s) => ({ value: s, label: t(`perf.goal.status.${s}`) }))}
          />
        </Field>
        <Field label={t('perf.checkin.note')} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} maxLength={2000} placeholder={t('perf.checkin.note_ph')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Give praise or feedback to someone, or answer a feedback request. */
export function FeedbackDialog({ open, onClose, to, request, kind: kind0 }: { open: boolean; onClose: () => void; to?: { id: string; name: string } | undefined; request?: FeedbackRow | null | undefined; kind?: 'praise' | 'feedback' | undefined }): React.JSX.Element | null {
  const settings = useOp<{ values: CompanyValue[]; praise_wall: boolean }>('perf.settings', {}, READS.feedback, { skip: !open, name: 'perf.settings' });
  const [kind, setKind] = useState<'praise' | 'feedback'>('praise');
  const [person, setPerson] = useState('');
  const [text, setText] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [vis, setVis] = useState<'public' | 'private' | 'manager'>('public');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wall = settings.data?.praise_wall ?? true;
  useEffect(() => {
    if (!open) return;
    setKind(request !== undefined && request !== null ? 'feedback' : (kind0 ?? 'praise'));
    setPerson(to?.id ?? '');
    setText('');
    setValues([]);
    setErr(null);
  }, [open, to, request, kind0]);
  useEffect(() => {
    setVis(kind === 'praise' ? (wall ? 'public' : 'private') : 'private');
  }, [kind, wall]);
  if (!open) return null;
  const answering = request !== undefined && request !== null;
  const save = async (): Promise<void> => {
    if (text.trim() === '') {
      setErr(t('perf.fb.need_text'));
      return;
    }
    if (!answering && person === '') {
      setErr(t('perf.fb.need_person'));
      return;
    }
    setBusy(true);
    try {
      await op('feedback.give', answering ? { request: request.id, text } : { to: person, kind, text, values: kind === 'praise' ? values : [], visibility: vis }, { quiet: true });
      changed(...READS.feedback);
      toast.success(answering ? t('perf.fb.answered') : kind === 'praise' ? t('perf.fb.praised') : t('perf.fb.sent'));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const vals = settings.data?.values ?? [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title={answering ? t('perf.fb.answer_title') : kind === 'praise' ? t('perf.fb.praise_title') : t('perf.fb.feedback_title')}
      meta={answering ? request.text : undefined}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {answering ? t('perf.fb.send_answer') : kind === 'praise' ? t('perf.fb.send_praise') : t('perf.fb.send_feedback')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {!answering && (
          <Segmented
            value={kind}
            onChange={setKind}
            label={t('perf.fb.kind')}
            size="sm"
            options={[
              { value: 'praise', label: t('perf.fb.praise') },
              { value: 'feedback', label: t('perf.fb.feedback') },
            ]}
          />
        )}
        {!answering && (
          <Field label={t('perf.fb.to')}>
            <PersonPicker value={person} onChange={(v) => setPerson(v)} label={t('perf.fb.to')} placeholder={to?.name} />
          </Field>
        )}
        <Field label={answering ? t('perf.fb.your_answer') : kind === 'praise' ? t('perf.fb.what_praise') : t('perf.fb.what_feedback')} error={err}>
          <Textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} minRows={3} maxLength={4000} />
        </Field>
        {!answering && kind === 'praise' && vals.length > 0 && (
          <Field label={t('perf.fb.values')} optional>
            <div className="flex flex-wrap gap-1.5">
              {vals.map((v) => {
                const Icon = valueIcon(v.icon);
                const on = values.includes(v.code);
                return (
                  <button
                    key={v.code}
                    type="button"
                    aria-pressed={on}
                    title={v.description}
                    onClick={() => setValues((l) => (on ? l.filter((x) => x !== v.code) : [...l, v.code]))}
                    className={cn('hr-focus hit inline-flex h-8 items-center gap-1.5 rounded-[var(--hr-radius-sm)] border px-2.5 text-[12px] transition-colors', on ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]')}
                  >
                    <Icon size={13} strokeWidth={1.9} aria-hidden />
                    {v.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        {!answering && (
          <Field label={t('perf.fb.who_sees')}>
            <Segmented
              value={vis}
              onChange={setVis}
              label={t('perf.fb.who_sees')}
              size="sm"
              options={
                kind === 'praise'
                  ? [...(wall ? [{ value: 'public' as const, label: t('perf.fb.vis.public') }] : []), { value: 'private' as const, label: t('perf.fb.vis.private_praise') }]
                  : [
                      { value: 'private' as const, label: t('perf.fb.vis.private') },
                      { value: 'manager' as const, label: t('perf.fb.vis.manager') },
                    ]
              }
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Ask people for feedback about yourself (or, as a manager, about a report). */
export function RequestDialog({ open, onClose, about }: { open: boolean; onClose: () => void; about?: { id: string; name: string } | undefined }): React.JSX.Element | null {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPeople([]);
    setPick('');
    setText('');
    setDue('');
  }, [open]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ requests: unknown[] }>('feedback.request', { from: people.map((p) => p.id), about: about?.id, text, due });
      changed(...READS.feedback);
      toast.success(t('perf.fb.asked', { n: r.requests.length }));
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
      width={520}
      title={about !== undefined ? t('perf.fb.ask_about', { name: about.name }) : t('perf.fb.ask_title')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={people.length === 0} onClick={() => void save()}>
            {t('perf.fb.ask_send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label={t('perf.fb.ask_who')}>
          <PersonPicker
            value={pick}
            onChange={(v, item) => {
              if (v !== '' && item !== null && !people.some((p) => p.id === v) && people.length < 10) setPeople((l) => [...l, { id: v, name: item.label }]);
              setPick('');
            }}
            label={t('perf.fb.ask_who')}
            placeholder={t('perf.fb.ask_pick')}
            exclude={people.map((p) => p.id).concat(about !== undefined ? [about.id] : [])}
          />
        </Field>
        {people.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <span key={p.id} className="inline-flex h-7 items-center gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-2 text-[12px]">
                {p.name}
                <IconButton icon={Trash2} size={24} label={t('ui.remove')} onClick={() => setPeople((l) => l.filter((x) => x.id !== p.id))} />
              </span>
            ))}
          </div>
        )}
        <Field label={t('perf.fb.ask_question')} optional>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} maxLength={1000} placeholder={t('perf.fb.ask_question_ph')} />
        </Field>
        <Field label={t('perf.fb.ask_due')} optional>
          <DayPicker value={due} onChange={setDue} label={t('perf.fb.ask_due')} clearable />
        </Field>
      </div>
    </Dialog>
  );
}

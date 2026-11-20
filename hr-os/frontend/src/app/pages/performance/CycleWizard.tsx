/**
 * New review cycle (and editing a draft): a short wizard. Kind, name,
 * entity and period; who takes part (everyone, departments, chosen people,
 * probations ending); the template; the phases with their days. Everything
 * starts from the kind's defaults, so most cycles are three clicks. The last
 * step launches it (saved first, then one confirm with how many it reaches);
 * "Save draft" keeps it for later. An active cycle's edit saves changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus, Rocket, Trash2 } from 'lucide-react';
import { Button, DateRange, DayPicker, Field, IconButton, Input, LoadError, Loading, PageBody, PageHeader, Panel, Picker, Segmented, Stepper, Tag, Toggle, confirmAsk, toast } from '../../components/ui.tsx';
import { PersonPicker, kindLabel } from '../../components/performance/bits.tsx';
import type { Cycle, CycleKind, PhaseKey, ReviewKind, Template } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

const KINDS: CycleKind[] = ['annual', 'half_year', 'quarterly', 'probation', 'project'];
const PHASES: PhaseKey[] = ['goals', 'self', 'peer', 'upward', 'manager', 'calibration', 'sharing'];
type Who = 'everyone' | 'departments' | 'people' | 'probation';
interface Defaults {
  defaults: { kind: CycleKind; name: string; period_start: string; period_end: string; phases: { key: PhaseKey; start: string; end: string }[]; template: string; template_name: string };
}

export function CycleWizard({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const editId = params['id'] ?? '';
  const existing = useOp<{ cycle: Cycle }>('cycles.get', { cycle: editId }, READS.reviews, { skip: editId === '' });
  const templates = useOp<{ templates: Template[] }>('review-templates.list', {}, READS.settings, { name: 'perf.templates' });
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments']);
  const [step, setStep] = useState('basics');
  const [kind, setKind] = useState<CycleKind>('annual');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [entity, setEntity] = useState(me.entities_scope.length > 0 ? (me.entities_scope[0] ?? '') : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [who, setWho] = useState<Who>('everyone');
  const [departments, setDepartments] = useState<string[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [startedBefore, setStartedBefore] = useState('');
  const [template, setTemplate] = useState('');
  const [phases, setPhases] = useState<Record<PhaseKey, { on: boolean; start: string; end: string }>>(() => Object.fromEntries(PHASES.map((k) => [k, { on: false, start: '', end: '' }])) as Record<PhaseKey, { on: boolean; start: string; end: string }>);
  const [busy, setBusy] = useState<'' | 'save' | 'launch'>('');
  const [loaded, setLoaded] = useState(editId === '');
  /** The cycle this wizard writes to: the one being edited, or the draft its first save created. */
  const [savedId, setSavedId] = useState(editId);

  const applyDefaults = async (k: CycleKind, ent: string, keepName: boolean): Promise<void> => {
    try {
      const d = await op<Defaults>('cycles.defaults', { kind: k, entity: ent === '' ? undefined : ent }, { quiet: true });
      if (!keepName) setName(d.defaults.name);
      setFrom(d.defaults.period_start);
      setTo(d.defaults.period_end);
      setTemplate(d.defaults.template);
      const next = Object.fromEntries(PHASES.map((p) => [p, { on: false, start: '', end: '' }])) as Record<PhaseKey, { on: boolean; start: string; end: string }>;
      for (const ph of d.defaults.phases) next[ph.key] = { on: true, start: ph.start, end: ph.end };
      setPhases(next);
      if (k === 'probation') setWho('probation');
      else setWho((w) => (w === 'probation' ? 'everyone' : w));
    } catch {
      /* defaults are a courtesy */
    }
  };

  useEffect(() => {
    if (editId === '') void applyDefaults('annual', entity, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = existing.data?.cycle;
    if (c === undefined || loaded) return;
    setKind(c.kind);
    setName(c.name);
    setNameTouched(true);
    setEntity(c.entity);
    setFrom(c.period_start);
    setTo(c.period_end);
    setTemplate(c.template);
    const r = c.participants_rule;
    if (r.probation_ending === true) setWho('probation');
    else if ((r.departments ?? []).length > 0) setWho('departments');
    else if ((r.employees ?? []).length > 0) setWho('people');
    setDepartments(r.departments ?? []);
    const ids = r.employees ?? [];
    setPeople(ids.map((id) => ({ id, name: '' })));
    void Promise.all(ids.slice(0, 200).map((id) => op<{ employee: { id: string; name: string } }>('people.get', { employee: id }, { quiet: true }).then((x) => x.employee).catch(() => ({ id, name: '' })))).then((list) => setPeople(ids.map((id) => ({ id, name: list.find((x) => x.id === id)?.name ?? '' }))));
    setStartedBefore(r.started_before ?? '');
    const next = Object.fromEntries(PHASES.map((p) => [p, { on: false, start: '', end: '' }])) as Record<PhaseKey, { on: boolean; start: string; end: string }>;
    for (const ph of c.phases) next[ph.key] = { on: true, start: ph.start, end: ph.end };
    setPhases(next);
    setLoaded(true);
  }, [existing.data, loaded]);

  const steps = [
    { key: 'basics', label: t('perf.wiz.basics') },
    { key: 'people', label: t('perf.wiz.people') },
    { key: 'template', label: t('perf.wiz.template') },
    { key: 'phases', label: t('perf.wiz.phases') },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  const reviewOn = phases.self.on || phases.manager.on;
  const tpl = templates.data?.templates.find((x) => x.id === template);
  /** The review kinds this template asks for whose phase is switched on: the people who will answer it. */
  const answeredBy = Array.from(new Set((tpl?.sections ?? []).flatMap((s) => s.kinds))).filter((k: ReviewKind) => phases[k].on);
  const deptName = useMemo(() => new Map((depts.data?.departments ?? []).map((d) => [d.id, d.name])), [depts.data]);

  const draft = editId === '' || existing.data?.cycle.status === 'draft';
  /** Save the cycle (create the draft once, update it after) and return its id; null when a review phase is missing. */
  const persist = async (): Promise<string | null> => {
    if (!reviewOn) {
      toast.error(t('perf.wiz.need_review_phase'));
      setStep('phases');
      return null;
    }
    const rule = {
      entities: [],
      departments: who === 'departments' ? departments : [],
      employees: who === 'people' ? people.map((p) => p.id) : [],
      exclude: [],
      started_before: startedBefore,
      probation_ending: who === 'probation',
    };
    const ph = PHASES.filter((k) => phases[k].on).map((k) => ({ key: k, start: phases[k].start, end: phases[k].end }));
    const params = { name: name.trim(), kind, entity, period_start: from, period_end: to, template, participants: rule, phases: ph };
    const r = savedId !== '' ? await op<{ cycle: Cycle }>('cycles.update', { cycle: savedId, ...params }) : await op<{ cycle: Cycle }>('cycles.create', params);
    setSavedId(r.cycle.id);
    changed(...READS.reviews);
    return r.cycle.id;
  };

  const save = async (): Promise<void> => {
    setBusy('save');
    try {
      const id = await persist();
      if (id === null) return;
      toast.success(draft ? t('perf.wiz.saved') : t('perf.wiz.changes_saved'));
      navigate(`/performance/cycles/${id}`);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };

  const launch = async (): Promise<void> => {
    let id: string | null = null;
    let total = 0;
    setBusy('launch');
    try {
      id = await persist();
      if (id !== null) total = (await op<{ total: number }>('cycles.preview', { cycle: id })).total;
    } catch {
      /* toast shown */
      id = null;
    } finally {
      setBusy('');
    }
    if (id === null) return;
    if (total === 0) {
      toast.error(t('perf.cycle.nobody'));
      setStep('people');
      return;
    }
    if (!(await confirmAsk(t('perf.cycle.launch_text', { n: total }), t('perf.cycle.launch'), t('perf.cycle.launch'), 'primary'))) return;
    setBusy('launch');
    try {
      await op('cycles.launch', { cycle: id });
      changed(...READS.reviews);
      toast.success(t('perf.cycle.launched'));
      navigate(`/performance/cycles/${id}`);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };

  if (!loaded || templates.data === null) return <>{existing.error !== null ? <LoadError message={existing.error} /> : <Loading />}</>;
  return (
    <>
      <PageHeader title={editId !== '' ? t('perf.wiz.edit_title') : t('perf.wiz.title')} meta={[kindLabelCycle(kind), fmtRange(from, to)].join(' · ')} back={editId !== '' ? `#/performance/cycles/${editId}` : '#/performance/cycles'} />
      <PageBody className="max-w-[760px]">
        <Stepper steps={steps} current={step} onStep={setStep} className="mb-4" />
        <Panel>
          <div className="flex flex-col gap-4 pt-3.5">
            {step === 'basics' && (
              <>
                <Field label={t('perf.wiz.kind')}>
                  <Segmented
                    value={kind}
                    onChange={(k) => {
                      setKind(k);
                      void applyDefaults(k, entity, nameTouched);
                    }}
                    label={t('perf.wiz.kind')}
                    options={KINDS.map((k) => ({ value: k, label: kindLabelCycle(k) }))}
                  />
                </Field>
                <Field label={t('perf.wiz.name')}>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameTouched(true);
                    }}
                    maxLength={160}
                  />
                </Field>
                {me.entities.length > 1 && (
                  <Field label={t('perf.wiz.entity')}>
                    <Picker
                      value={entity}
                      onChange={(v) => {
                        setEntity(v);
                        void applyDefaults(kind, v, nameTouched);
                      }}
                      items={[...(me.entities_scope.length === 0 ? [{ value: '', label: t('perf.cycle.all_entities') }] : []), ...me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country }))]}
                      label={t('perf.wiz.entity')}
                    />
                  </Field>
                )}
                <Field label={t('perf.wiz.period')} help={t('perf.wiz.period_help')}>
                  <DateRange from={from} to={to} onChange={(a, b) => (setFrom(a), setTo(b))} label={t('perf.wiz.period')} />
                </Field>
              </>
            )}
            {step === 'people' && (
              <>
                <Field label={t('perf.wiz.who')}>
                  <Segmented
                    value={who}
                    onChange={setWho}
                    label={t('perf.wiz.who')}
                    options={[
                      { value: 'everyone', label: t('perf.wiz.who.everyone') },
                      { value: 'departments', label: t('perf.wiz.who.departments') },
                      { value: 'people', label: t('perf.wiz.who.people') },
                      { value: 'probation', label: t('perf.wiz.who.probation') },
                    ]}
                  />
                </Field>
                {who === 'departments' && (
                  <Field label={t('perf.wiz.departments')}>
                    <Picker value="" onChange={(v) => v !== '' && !departments.includes(v) && setDepartments((l) => [...l, v])} items={(depts.data?.departments ?? []).filter((d) => !departments.includes(d.id)).map((d) => ({ value: d.id, label: d.name }))} label={t('perf.wiz.departments')} placeholder={t('perf.wiz.add_department')} />
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {departments.map((d) => (
                        <Chip key={d} label={deptName.get(d) ?? d} onRemove={() => setDepartments((l) => l.filter((x) => x !== d))} />
                      ))}
                    </div>
                  </Field>
                )}
                {who === 'people' && (
                  <Field label={t('perf.wiz.people_list')}>
                    <PersonPicker value="" onChange={(v, item) => v !== '' && item !== null && !people.some((p) => p.id === v) && setPeople((l) => [...l, { id: v, name: item.label }])} label={t('perf.wiz.people_list')} placeholder={t('perf.wiz.add_person')} exclude={people.map((p) => p.id)} />
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {people.map((p) => (
                        <Chip key={p.id} label={p.name} onRemove={() => setPeople((l) => l.filter((x) => x.id !== p.id))} />
                      ))}
                    </div>
                  </Field>
                )}
                {who === 'probation' && <p className="text-[12px] text-[var(--hr-ink-2)]">{t('perf.wiz.probation_text', { range: fmtRange(from, to) })}</p>}
                {who === 'everyone' && <p className="text-[12px] text-[var(--hr-ink-2)]">{t('perf.wiz.everyone_text')}</p>}
                <Field label={t('perf.wiz.started_before')} optional help={t('perf.wiz.started_before_help')}>
                  <DayPicker value={startedBefore} onChange={setStartedBefore} label={t('perf.wiz.started_before')} clearable />
                </Field>
              </>
            )}
            {step === 'template' && (
              <div role="radiogroup" aria-label={t('perf.wiz.template')} className="flex flex-col gap-2">
                {templates.data.templates.map((x) => {
                  const on = x.id === template;
                  return (
                    <button key={x.id} type="button" role="radio" aria-checked={on} onClick={() => setTemplate(x.id ?? '')} className={cn('hr-focus flex items-start gap-3 rounded-[var(--hr-radius-sm)] border p-3 text-left transition-colors', on ? 'border-[var(--hr-ink)] bg-[var(--hr-raised)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]')}>
                      <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line-2)]')}>{on && <Check size={10} strokeWidth={3} aria-hidden />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{x.name}</span>
                        {x.description !== undefined && x.description !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{x.description}</span>}
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {x.sections.map((s) => (
                            <Tag key={s.key} tone="faint">
                              {s.title}
                              {s.kind !== 'questions' && s.weight !== undefined && s.weight > 0 ? ` ${s.weight}%` : ''}
                            </Tag>
                          ))}
                          <Tag tone="faint">{t('perf.wiz.points', { n: x.scale.points })}</Tag>
                        </span>
                      </span>
                    </button>
                  );
                })}
                <a href="#/performance/settings" className="hr-link hr-focus hit mt-1 inline-flex h-6 items-center gap-1 self-start rounded-[3px] text-[12px] text-[var(--hr-ink-2)] hover:text-[var(--hr-ink)]">
                  <Plus size={12} aria-hidden />
                  {t('perf.wiz.edit_templates')}
                </a>
              </div>
            )}
            {step === 'phases' && (
              <div className="flex flex-col gap-1">
                {PHASES.map((k) => {
                  const ph = phases[k];
                  const fixed = editId !== '' && existing.data?.cycle.status !== 'draft';
                  return (
                    <div key={k} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0 sm:grid-cols-[180px_1fr]">
                      <label className="flex items-center gap-2.5">
                        <Toggle
                          checked={ph.on}
                          disabled={fixed}
                          onChange={(v) =>
                            setPhases((s) => {
                              const prev = Object.values(s).filter((x) => x.on).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
                              const start = ph.start !== '' ? ph.start : prev !== undefined ? prev.start : from;
                              const end = ph.end !== '' ? ph.end : prev !== undefined ? prev.end : to;
                              return { ...s, [k]: { on: v, start, end } };
                            })
                          }
                          label={t(`perf.phase.${k}`)}
                        />
                        <span className={cn('text-[13px]', ph.on ? 'font-medium' : 'text-[var(--hr-muted)]')}>{t(`perf.phase.${k}`)}</span>
                      </label>
                      {ph.on ? <DateRange from={ph.start} to={ph.end} onChange={(a, b) => setPhases((s) => ({ ...s, [k]: { on: true, start: a, end: b } }))} label={t(`perf.phase.${k}`)} /> : <span className="text-[12px] text-[var(--hr-faint)]">{t(`perf.wiz.phase_help.${k}`)}</span>}
                    </div>
                  );
                })}
                {answeredBy.length > 0 && <p className="pt-2 text-[12px] text-[var(--hr-muted)]">{t('perf.wiz.kinds_hint', { kinds: answeredBy.map((x) => kindLabel(x).toLowerCase()).join(', ') })}</p>}
              </div>
            )}
          </div>
        </Panel>
        <div className="mt-4 flex items-center gap-2">
          {idx > 0 && (
            <Button icon={ArrowLeft} onClick={() => setStep(steps[idx - 1]?.key ?? 'basics')}>
              {t('ui.back')}
            </Button>
          )}
          <span className="flex-1" />
          {draft && (
            <Button onClick={() => void save()} busy={busy === 'save'} disabled={busy === 'launch'} variant="ghost">
              {t('perf.wiz.save_now')}
            </Button>
          )}
          {idx < steps.length - 1 ? (
            <Button variant="primary" iconRight={ArrowRight} onClick={() => setStep(steps[idx + 1]?.key ?? 'phases')}>
              {t('ui.continue')}
            </Button>
          ) : draft ? (
            <Button variant="primary" icon={Rocket} busy={busy === 'launch'} disabled={busy === 'save'} onClick={() => void launch()}>
              {t('perf.cycle.launch')}
            </Button>
          ) : (
            <Button variant="primary" icon={Check} busy={busy === 'save'} onClick={() => void save()}>
              {t('perf.wiz.save_changes')}
            </Button>
          )}
        </div>
      </PageBody>
    </>
  );
}

function kindLabelCycle(k: CycleKind): string {
  return t(`perf.cycle.kind.${k}`);
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }): React.JSX.Element {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-2 text-[12px]">
      {label !== '' ? label : t('ui.loading')}
      <IconButton icon={Trash2} size={24} label={t('ui.remove')} onClick={onRemove} />
    </span>
  );
}

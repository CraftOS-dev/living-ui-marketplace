/**
 * Performance settings for HR: review templates (scale, sections with
 * weights, competencies with descriptions, questions, who answers what),
 * the company values people tag praise with, and the rules (praise wall,
 * when a goal needs an update, reminders, HR sign-off per entity).
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Empty, Field, IconButton, Input, LinkButton, LoadError, Loading, PageBody, PageHeader, Panel, Row, Segmented, Sheet, SheetHeader, Tabs, Tag, Textarea, Toggle, confirmAsk, toast } from '../../components/ui.tsx';
import { kindLabel, valueIcon } from '../../components/performance/bits.tsx';
import type { CompanyValue, ReviewKind, Section, Settings, Template } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

type Tab = 'templates' | 'values' | 'rules';
const KINDS: ReviewKind[] = ['self', 'manager', 'peer', 'upward'];

export function SettingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const full = can(me, 'performance', 'full');
  const tab = (['templates', 'values', 'rules'] as Tab[]).includes(query.get('tab') as Tab) ? (query.get('tab') as Tab) : 'templates';
  return (
    <>
      <PageHeader title={t('perf.set.title')} />
      <PageBody className="max-w-[980px]">
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'templates' ? undefined : v })}
          label={t('perf.set.title')}
          className="mb-3"
          tabs={[
            { value: 'templates', label: t('perf.set.templates') },
            { value: 'values', label: t('perf.set.values') },
            { value: 'rules', label: t('perf.set.rules') },
          ]}
        />
        {tab === 'templates' && <TemplatesTab full={full} />}
        {tab === 'values' && <ValuesTab full={full} />}
        {tab === 'rules' && <RulesTab full={full} />}
      </PageBody>
    </>
  );
}

function TemplatesTab({ full }: { full: boolean }): React.JSX.Element {
  const live = useOp<{ templates: Template[] }>('review-templates.list', { archived: true }, READS.settings, { name: 'perf.templates.all' });
  const [open, setOpen] = useState<Template | 'new' | null>(null);
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const copy = async (x: Template): Promise<void> => {
    try {
      await op('review-templates.create', { name: t('perf.set.copy_name', { name: x.name }), copy_of: x.id });
      changed(...READS.settings);
      toast.success(t('perf.set.copied'));
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {full && (
        <div className="flex">
          <Button icon={Plus} onClick={() => setOpen('new')}>
            {t('perf.set.new_template')}
          </Button>
        </div>
      )}
      {live.data.templates.length === 0 ? (
        <Empty icon={LayoutTemplate} title={t('perf.set.no_templates')} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {live.data.templates.map((x) => (
            <li key={x.id} className={cn('hr-panel hr-in flex flex-col gap-2 p-3.5', x.archived === true && 'opacity-60')}>
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => full && setOpen(x)} disabled={!full} className="hr-focus min-w-0 flex-1 rounded-[3px] text-left">
                  <span className={cn('block text-[14px] font-semibold', full && 'hr-link')}>{x.name}</span>
                  {x.description !== undefined && x.description !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{x.description}</span>}
                </button>
                {x.builtin === true && <Tag tone="faint">{t('perf.set.builtin')}</Tag>}
                {x.archived === true && <Tag tone="faint">{t('perf.set.archived')}</Tag>}
                {full && <IconButton icon={Copy} label={t('perf.set.copy')} size={26} onClick={() => void copy(x)} />}
              </div>
              <div className="flex flex-wrap gap-1">
                {x.sections.map((s) => (
                  <Tag key={s.key} tone="faint">
                    {s.title}
                    {s.kind !== 'questions' && (s.weight ?? 0) > 0 ? ` ${s.weight}%` : ''}
                  </Tag>
                ))}
              </div>
              <div className="text-[12px] text-[var(--hr-muted)]">
                {t('perf.wiz.points', { n: x.scale.points })} · {x.scale.labels.join(', ')}
              </div>
              {(x.used_by ?? 0) > 0 && <div className="hr-label">{tn('perf.set.used_by', x.used_by ?? 0)}</div>}
            </li>
          ))}
        </ul>
      )}
      <TemplateSheet value={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function blankSection(kind: Section['kind']): Section {
  if (kind === 'goals') return { key: '', kind, title: t('perf.set.sec.goals'), weight: 50, kinds: ['self', 'manager'], rate: true };
  if (kind === 'competencies') return { key: '', kind, title: t('perf.set.sec.competencies'), weight: 50, kinds: [...KINDS], items: [{ key: '', name: '', description: '' }] };
  return { key: '', kind, title: t('perf.set.sec.questions'), kinds: [...KINDS], items: [{ key: '', text: '', required: false }] };
}

function TemplateSheet({ value, onClose }: { value: Template | 'new' | null; onClose: () => void }): React.JSX.Element | null {
  const [tpl, setTpl] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value === null) {
      setTpl(null);
      return;
    }
    if (value === 'new') setTpl({ name: '', description: '', scale: { points: 5, labels: ['Below expectations', 'Partly meets', 'Meets expectations', 'Exceeds', 'Outstanding'] }, sections: [blankSection('goals'), blankSection('competencies'), blankSection('questions')], overall_kinds: ['self', 'manager'] });
    else setTpl(JSON.parse(JSON.stringify(value)) as Template);
  }, [value]);
  if (value === null || tpl === null) return null;
  const isNew = value === 'new';
  const setSec = (i: number, patch: Partial<Section>): void => setTpl({ ...tpl, sections: tpl.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setPoints = (n: number): void => {
    const labels = Array.from({ length: n }, (_, i) => tpl.scale.labels[i] ?? String(i + 1));
    setTpl({ ...tpl, scale: { points: n, labels } });
  };
  const move = (i: number, d: number): void => {
    const s = [...tpl.sections];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    const a = s[i];
    const b = s[j];
    if (a === undefined || b === undefined) return;
    s[i] = b;
    s[j] = a;
    setTpl({ ...tpl, sections: s });
  };
  const save = async (): Promise<void> => {
    const sections = tpl.sections.map((s) => ({
      ...(s.key !== '' ? { key: s.key } : {}),
      kind: s.kind,
      title: s.title,
      kinds: s.kinds,
      ...(s.kind !== 'questions' ? { weight: s.weight ?? 0 } : {}),
      ...(s.kind === 'goals' ? { rate: s.rate !== false } : {}),
      ...(s.kind === 'competencies' ? { items: (s.items ?? []).filter((it) => (it.name ?? '').trim() !== '').map((it) => ({ ...(it.key !== '' ? { key: it.key } : {}), name: it.name, description: it.description ?? '' })) } : {}),
      ...(s.kind === 'questions' ? { items: (s.items ?? []).filter((it) => (it.text ?? '').trim() !== '').map((it) => ({ ...(it.key !== '' ? { key: it.key } : {}), text: it.text, help: it.help ?? '', required: it.required === true })) } : {}),
    }));
    setBusy(true);
    try {
      const params = { name: tpl.name.trim(), description: tpl.description ?? '', scale: tpl.scale, sections, overall_kinds: tpl.overall_kinds };
      if (isNew) await op('review-templates.create', params);
      else await op('review-templates.update', { template: tpl.id, ...params, archived: tpl.archived === true });
      changed(...READS.settings);
      toast.success(t('perf.set.template_saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (isNew || !(await confirmAsk(t('perf.set.delete_text'), t('perf.set.delete')))) return;
    try {
      await op('review-templates.delete', { template: tpl.id });
      changed(...READS.settings);
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Sheet open onClose={onClose} label={t('perf.set.template')} width={640}>
      <SheetHeader title={isNew ? t('perf.set.new_template') : tpl.name} onClose={onClose} actions={<Button size="sm" variant="primary" busy={busy} disabled={tpl.name.trim() === ''} onClick={() => void save()}>{t('ui.save')}</Button>} />
      <div className="flex flex-col gap-4 px-4 py-4">
        {(tpl.used_by ?? 0) > 0 && <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.set.copy_note')}</p>}
        <Field label={t('perf.set.name')}>
          <Input value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} maxLength={120} />
        </Field>
        <Field label={t('perf.set.description')} optional>
          <Input value={tpl.description ?? ''} onChange={(e) => setTpl({ ...tpl, description: e.target.value })} maxLength={1000} />
        </Field>
        <Field label={t('perf.set.scale')}>
          <Segmented value={String(tpl.scale.points)} onChange={(v) => setPoints(Number(v))} label={t('perf.set.scale')} size="sm" options={['3', '4', '5', '6', '7'].map((n) => ({ value: n, label: t('perf.wiz.points', { n }) }))} />
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {tpl.scale.labels.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="hr-mono w-4 text-[12px] text-[var(--hr-muted)]">{i + 1}</span>
                <Input value={l} onChange={(e) => setTpl({ ...tpl, scale: { ...tpl.scale, labels: tpl.scale.labels.map((x, j) => (j === i ? e.target.value : x)) } })} maxLength={40} />
              </div>
            ))}
          </div>
        </Field>
        <Field label={t('perf.set.overall')} help={t('perf.set.overall_help')}>
          <div className="flex gap-4">
            {(['self', 'manager'] as ReviewKind[]).map((k) => (
              <Checkbox key={k} checked={tpl.overall_kinds.includes(k)} onChange={(v) => setTpl({ ...tpl, overall_kinds: v ? [...tpl.overall_kinds, k] : tpl.overall_kinds.filter((x) => x !== k) })} label={kindLabel(k)} />
            ))}
          </div>
        </Field>
        {tpl.sections.map((s, i) => (
          <section key={i} className="rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <Tag tone="faint">{t(`perf.set.sec.${s.kind}`)}</Tag>
              <Input value={s.title} onChange={(e) => setSec(i, { title: e.target.value })} maxLength={80} className="flex-1" aria-label={t('perf.set.section_title')} />
              <IconButton icon={ArrowUp} label={t('perf.set.up')} size={26} disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={ArrowDown} label={t('perf.set.down')} size={26} disabled={i === tpl.sections.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={26} onClick={() => setTpl({ ...tpl, sections: tpl.sections.filter((_, j) => j !== i) })} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-[12px] text-[var(--hr-muted)]">{t('perf.set.answered_by')}</span>
              {(s.kind === 'goals' ? (['self', 'manager'] as ReviewKind[]) : KINDS).map((k) => (
                <Checkbox key={k} checked={s.kinds.includes(k)} onChange={(v) => setSec(i, { kinds: v ? [...s.kinds, k] : s.kinds.filter((x) => x !== k) })} label={kindLabel(k)} />
              ))}
              {s.kind !== 'questions' && (
                <label className="flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
                  {t('perf.set.weight')}
                  <Input value={String(s.weight ?? 0)} inputMode="numeric" onChange={(e) => setSec(i, { weight: Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 3) || '0') })} className="w-[60px]" aria-label={t('perf.set.weight')} />%
                </label>
              )}
              {s.kind === 'goals' && <Checkbox checked={s.rate !== false} onChange={(v) => setSec(i, { rate: v })} label={t('perf.set.rate_goals')} />}
            </div>
            {s.kind !== 'goals' && (
              <div className="mt-2 flex flex-col gap-1.5">
                {(s.items ?? []).map((it, j) => (
                  <div key={j} className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                      <Input value={(s.kind === 'competencies' ? it.name : it.text) ?? ''} onChange={(e) => setSec(i, { items: (s.items ?? []).map((x, k) => (k === j ? { ...x, [s.kind === 'competencies' ? 'name' : 'text']: e.target.value } : x)) })} placeholder={s.kind === 'competencies' ? t('perf.set.comp_ph') : t('perf.set.q_ph')} maxLength={s.kind === 'competencies' ? 120 : 300} />
                      {s.kind === 'competencies' && <Textarea value={it.description ?? ''} onChange={(e) => setSec(i, { items: (s.items ?? []).map((x, k) => (k === j ? { ...x, description: e.target.value } : x)) })} minRows={1} maxLength={600} placeholder={t('perf.set.comp_desc_ph')} />}
                    </div>
                    {s.kind === 'questions' && <Checkbox checked={it.required === true} onChange={(v) => setSec(i, { items: (s.items ?? []).map((x, k) => (k === j ? { ...x, required: v } : x)) })} label={t('perf.set.required')} />}
                    <IconButton icon={Trash2} label={t('ui.remove')} size={26} onClick={() => setSec(i, { items: (s.items ?? []).filter((_, k) => k !== j) })} />
                  </div>
                ))}
                <LinkButton onClick={() => setSec(i, { items: [...(s.items ?? []), s.kind === 'competencies' ? { key: '', name: '', description: '' } : { key: '', text: '', required: false }] })} className="h-6 self-start">
                  <Plus size={12} aria-hidden /> {s.kind === 'competencies' ? t('perf.set.add_comp') : t('perf.set.add_q')}
                </LinkButton>
              </div>
            )}
          </section>
        ))}
        <div className="flex flex-wrap gap-2">
          {!tpl.sections.some((s) => s.kind === 'goals') && (
            <Button size="sm" icon={Plus} onClick={() => setTpl({ ...tpl, sections: [...tpl.sections, blankSection('goals')] })}>
              {t('perf.set.sec.goals')}
            </Button>
          )}
          <Button size="sm" icon={Plus} onClick={() => setTpl({ ...tpl, sections: [...tpl.sections, blankSection('competencies')] })}>
            {t('perf.set.sec.competencies')}
          </Button>
          <Button size="sm" icon={Plus} onClick={() => setTpl({ ...tpl, sections: [...tpl.sections, blankSection('questions')] })}>
            {t('perf.set.sec.questions')}
          </Button>
        </div>
        {!isNew && (
          <div className="flex items-center gap-3 border-t border-[var(--hr-hair)] pt-3">
            <label className="flex items-center gap-2.5 text-[13px]">
              <Toggle checked={tpl.archived === true} onChange={(v) => setTpl({ ...tpl, archived: v })} label={t('perf.set.archived')} />
              {t('perf.set.archive')}
            </label>
            <span className="flex-1" />
            {(tpl.used_by ?? 0) === 0 && (
              <LinkButton className="h-6" tone="danger" onClick={() => void remove()}>
                {t('perf.set.delete')}
              </LinkButton>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ValuesTab({ full }: { full: boolean }): React.JSX.Element {
  const live = useOp<Settings>('perf.settings', {}, READS.settings, { name: 'perf.settings.full' });
  const [values, setValues] = useState<CompanyValue[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (live.data !== null && values === null) setValues(live.data.values);
  }, [live.data, values]);
  if (live.data === null || values === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const icons = live.data.value_icons;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('perf.settings-update', { values: values.filter((v) => v.name.trim() !== '').map((v) => ({ ...(v.code !== '' ? { code: v.code } : {}), name: v.name.trim(), description: v.description, icon: v.icon })) });
      changed(...READS.settings);
      setValues(null);
      toast.success(t('perf.set.values_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel index="01" label={t('perf.set.values')} aside={full ? <Button size="sm" variant="primary" busy={busy} onClick={() => void save()}>{t('ui.save')}</Button> : undefined}>
      <div className="flex flex-col gap-2 pt-1">
        <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.set.values_text')}</p>
        {values.map((v, i) => {
          const Icon = valueIcon(v.icon);
          return (
            <div key={i} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-2 sm:grid-cols-[auto_200px_1fr_auto]">
              <IconPick value={v.icon} icons={icons} onChange={(icon) => setValues(values.map((x, j) => (j === i ? { ...x, icon } : x)))} disabled={!full} Icon={Icon} />
              <Input value={v.name} onChange={(e) => setValues(values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={40} disabled={!full} aria-label={t('perf.set.value_name')} placeholder={t('perf.set.value_name')} />
              <Input value={v.description} onChange={(e) => setValues(values.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} maxLength={200} disabled={!full} className="col-span-3 sm:col-span-1" aria-label={t('perf.set.value_desc')} placeholder={t('perf.set.value_desc')} />
              {full && <IconButton icon={Trash2} label={t('ui.remove')} size={30} onClick={() => setValues(values.filter((_, j) => j !== i))} className="col-start-3 row-start-1 sm:col-start-4" />}
            </div>
          );
        })}
        {full && values.length < 12 && (
          <LinkButton onClick={() => setValues([...values, { code: '', name: '', description: '', icon: icons[values.length % icons.length] ?? 'Star' }])} className="h-6 self-start">
            <Plus size={12} aria-hidden /> {t('perf.set.add_value')}
          </LinkButton>
        )}
      </div>
    </Panel>
  );
}

function IconPick({ value, icons, onChange, disabled, Icon }: { value: string; icons: string[]; onChange: (v: string) => void; disabled: boolean; Icon: ReturnType<typeof valueIcon> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton icon={Icon} label={t('perf.set.icon')} size={32} disabled={disabled} onClick={() => setOpen((v) => !v)} active={open} />
      {open && (
        <div className="hr-panel absolute left-0 top-9 z-10 grid w-[196px] grid-cols-5 gap-1 p-1.5 shadow-[var(--hr-shadow-lg)]">
          {icons.map((n) => {
            const I = valueIcon(n);
            return <IconButton key={n} icon={I} label={n} size={32} active={n === value} onClick={() => (onChange(n), setOpen(false))} />;
          })}
        </div>
      )}
    </div>
  );
}

function RulesTab({ full }: { full: boolean }): React.JSX.Element {
  const live = useOp<Settings>('perf.settings', {}, READS.settings, { name: 'perf.settings.full' });
  const s = live.data;
  if (s === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const set = async (params: Record<string, unknown>): Promise<void> => {
    try {
      await op('perf.settings-update', params);
      changed(...READS.settings);
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('perf.set.rules')}>
        <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
          <Row label={t('perf.set.praise_wall')} hint={t('perf.set.praise_wall_hint')}>
            <Toggle checked={s.praise_wall} onChange={(v) => void set({ praise_wall: v })} label={t('perf.set.praise_wall')} disabled={!full} />
          </Row>
          <Row label={t('perf.set.checkin_days')} hint={t('perf.set.checkin_days_hint')}>
            <Segmented value={String(s.checkin_days)} onChange={(v) => void set({ checkin_days: Number(v) })} label={t('perf.set.checkin_days')} size="sm" options={['7', '14', '30', '60'].map((n) => ({ value: n, label: tn('perf.set.days', Number(n)) }))} />
          </Row>
          <Row label={t('perf.set.reminder_days')} hint={t('perf.set.reminder_days_hint')}>
            <Segmented value={String(s.reminder_days)} onChange={(v) => void set({ reminder_days: Number(v) })} label={t('perf.set.reminder_days')} size="sm" options={['0', '1', '3', '7'].map((n) => ({ value: n, label: n === '0' ? t('perf.set.on_the_day') : tn('perf.set.days', Number(n)) }))} />
          </Row>
        </div>
      </Panel>
      <Panel index="02" label={t('perf.set.signoff')}>
        <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
          <p className="pb-2 text-[12px] text-[var(--hr-muted)]">{t('perf.set.signoff_text')}</p>
          {s.entities.map((e) => (
            <Row key={e.entity} label={e.name} hint={e.country}>
              <Toggle checked={e.signoff} onChange={(v) => void set({ entity: e.entity, signoff: v })} label={t('perf.set.signoff_for', { name: e.name })} disabled={!full} />
            </Row>
          ))}
        </div>
      </Panel>
    </div>
  );
}

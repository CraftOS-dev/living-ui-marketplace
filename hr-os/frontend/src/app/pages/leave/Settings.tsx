/**
 * Leave settings (full Leave access): the types per entity (icon, colour,
 * paid, unit, half days and hours, negative balance, certificate, notice,
 * longest stretch), the policies with one rule per type (dated versions:
 * changes apply from a day), locked days, the bulk tools of the leave
 * control panel (assign a policy, give days to many people) and the daily
 * run. Everything here is data: nothing about a country is fixed in a screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarPlus, Lock, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, DayPicker, Empty, Field, Input, LinkButton, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Picker, Row, Segmented, Select, Sheet, SheetHeader, Tabs, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Switch } from '../../components/leave/Switch.tsx';
import { LEAVE_ICONS, TypeLabel, colorVar, softVar } from '../../components/leave/LeaveIcon.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { READS } from './data.ts';
import type { Block, LeaveColor, LeaveType, Policy, Rule } from './types.ts';

type Tab = 'types' | 'policies' | 'locks' | 'bulk' | 'run';
const COLORS: LeaveColor[] = ['rh', 'lh', 'good', 'warn', 'bad', 'ink'];
const METHODS = ['fixed', 'monthly_accrual', 'per_hours_worked', 'tenure_table', 'statutory_jp', 'manual', 'none'];

function useEntityId(): string {
  const me = useMe();
  const { entity } = useUi();
  return entity !== '' ? entity : (me.entities[0]?.id ?? '');
}

/* ------------------------------------------------------------------ types */

function TypeSheet({ type, entity, onClose }: { type: LeaveType | null; entity: string; onClose: () => void }): React.JSX.Element {
  const [f, setF] = useState<Partial<LeaveType>>(() => type ?? { name: '', code: '', paid: true, unit: 'day', color: 'rh', icon: 'sun', allow_half: true, allow_hours: false, allow_negative: false, max_negative: 0, attachment_after_days: 0, min_notice_days: 0, max_consecutive_days: 0, counts_holidays: false, counts_weekends: false, encashable: false, payout_on_exit: false, comp_off: false, visibility: 'type', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<LeaveType>): void => setF((x) => ({ ...x, ...patch }));
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const p: Record<string, unknown> = { name: f.name, paid: f.paid, unit: f.unit, color: f.color, icon: f.icon, allow_half: f.allow_half, allow_hours: f.allow_hours, allow_negative: f.allow_negative, max_negative: f.max_negative, attachment_after_days: f.attachment_after_days, min_notice_days: f.min_notice_days, max_consecutive_days: f.max_consecutive_days, counts_holidays: f.counts_holidays, counts_weekends: f.counts_weekends, encashable: f.encashable, payout_on_exit: f.payout_on_exit, comp_off: f.comp_off, visibility: f.visibility, note: f.note };
      if (type !== null) p['type'] = type.id;
      else {
        p['entity'] = entity;
        p['code'] = f.code;
      }
      await op('leave.types-save', p, { quiet: true });
      changed(...READS);
      toast.success(t('leave.settings.saved', { name: f.name ?? '' }));
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const num = (k: keyof LeaveType, label: string, hint?: string): React.JSX.Element => (
    <Field label={label} hint={hint}>
      <Input value={String(f[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value.replace(',', '.')) || 0 } as Partial<LeaveType>)} inputMode="decimal" aria-label={label} className="w-24" />
    </Field>
  );
  return (
    <Sheet open onClose={onClose} label={t('leave.settings.type')} width={560}>
      <SheetHeader title={type !== null ? type.name : t('leave.settings.new_type')} meta={type !== null ? type.code : undefined} onClose={onClose} />
      <div className="hr-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        <Field label={t('leave.settings.name')}>
          <Input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} aria-label={t('leave.settings.name')} autoFocus={type === null} />
        </Field>
        {type === null && (
          <Field label={t('leave.settings.code')} hint={t('leave.settings.code_hint')}>
            <Input value={f.code ?? ''} onChange={(e) => set({ code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} aria-label={t('leave.settings.code')} className="hr-mono" />
          </Field>
        )}
        <Field label={t('leave.settings.icon')}>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('leave.settings.icon')}>
            {Object.entries(LEAVE_ICONS).map(([name, Icon]) => (
              <button key={name} type="button" role="radio" aria-checked={f.icon === name} aria-label={name} title={name} onClick={() => set({ icon: name })} className={cn('hr-focus flex size-10 items-center justify-center rounded-[var(--hr-radius-sm)] border transition-colors', f.icon === name ? 'border-[var(--hr-ink)] bg-[var(--hr-active)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:bg-[var(--hr-hover)]')}>
                <Icon size={16} strokeWidth={1.8} style={{ color: colorVar(f.color ?? 'ink') }} aria-hidden />
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('leave.settings.color')} hint={t('leave.settings.color_hint')}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('leave.settings.color')}>
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={t(`leave.color.${c}`)} title={t(`leave.color.${c}`)} onClick={() => set({ color: c })} className={cn('hr-focus flex h-10 items-center gap-1.5 rounded-[var(--hr-radius-sm)] border px-2.5 text-[12px] transition-colors', f.color === c ? 'border-[var(--hr-ink)]' : 'border-[var(--hr-line)] hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]')} style={{ background: f.color === c ? softVar(c) : undefined }}>
                <span aria-hidden className="size-3 rounded-full" style={{ background: colorVar(c) }} />
                {t(`leave.color.${c}`)}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('leave.settings.unit')}>
            <Segmented value={f.unit ?? 'day'} onChange={(v) => set({ unit: v })} label={t('leave.settings.unit')} options={[{ value: 'day', label: t('leave.unit.days_word') }, { value: 'hour', label: t('leave.unit.hours_word') }]} />
          </Field>
          <Field label={t('leave.settings.who_sees')}>
            <Segmented value={f.visibility ?? 'type'} onChange={(v) => set({ visibility: v })} label={t('leave.settings.who_sees')} options={[{ value: 'type', label: t('leave.settings.see_type') }, { value: 'away', label: t('leave.settings.see_away') }]} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Switch checked={f.paid === true} onChange={(v) => set({ paid: v })} label={t('leave.settings.paid')} />
          <Switch checked={f.allow_half === true} onChange={(v) => set({ allow_half: v })} label={t('leave.settings.half')} />
          <Switch checked={f.allow_hours === true} onChange={(v) => set({ allow_hours: v })} label={t('leave.settings.hours')} />
          <Switch checked={f.allow_negative === true} onChange={(v) => set({ allow_negative: v })} label={t('leave.settings.negative')} />
          <Switch checked={f.counts_weekends === true} onChange={(v) => set({ counts_weekends: v })} label={t('leave.settings.calendar_days')} />
          <Switch checked={f.counts_holidays === true} onChange={(v) => set({ counts_holidays: v })} label={t('leave.settings.count_holidays')} />
          <Switch checked={f.encashable === true} onChange={(v) => set({ encashable: v })} label={t('leave.settings.encashable')} />
          <Switch checked={f.payout_on_exit === true} onChange={(v) => set({ payout_on_exit: v })} label={t('leave.settings.payout_on_exit')} />
          <Switch checked={f.comp_off === true} onChange={(v) => set({ comp_off: v })} label={t('leave.settings.comp_off')} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {num('min_notice_days', t('leave.settings.notice'))}
          {num('max_consecutive_days', t('leave.settings.longest'), t('leave.settings.zero_none'))}
          {num('attachment_after_days', t('leave.settings.certificate'), t('leave.settings.zero_never'))}
          {f.allow_negative === true && num('max_negative', t('leave.settings.below_zero'), t('leave.settings.zero_none'))}
        </div>
        <Field label={t('leave.settings.note')} optional>
          <Textarea value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} minRows={2} aria-label={t('leave.settings.note')} />
        </Field>
        {err !== '' && <Notice tone="bad">{err}</Notice>}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-[var(--hr-line)] px-4 py-3">
        {type !== null ? (
          <LinkButton tone="danger" onClick={() => void (async () => {
            if (type.used !== undefined && type.used > 0) {
              await op('leave.types-save', { type: type.id, archived: !type.archived });
              changed(...READS);
              onClose();
              return;
            }
            if (!(await confirmAsk(t('leave.settings.delete_type_text', { name: type.name }), t('leave.settings.delete_type')))) return;
            await op('leave.types-delete', { type: type.id });
            changed(...READS);
            onClose();
          })()}>
            {type.used !== undefined && type.used > 0 ? (type.archived ? t('leave.settings.unarchive') : t('leave.settings.archive')) : t('ui.remove')}
          </LinkButton>
        ) : (
          <span />
        )}
        <Button variant="primary" busy={busy} disabled={(f.name ?? '').trim() === '' || (type === null && (f.code ?? '').length < 2)} onClick={() => void save()}>
          {t('ui.save')}
        </Button>
      </footer>
    </Sheet>
  );
}

function TypesTab({ entity }: { entity: string }): React.JSX.Element {
  const live = useOp<{ types: LeaveType[] }>('leave.types', { entity, archived: true }, READS, { name: 'leave.types.settings' });
  const [edit, setEdit] = useState<LeaveType | null | 'new'>(null);
  const columns: Column<LeaveType>[] = [
    { key: 'name', label: t('leave.settings.name'), width: 'minmax(200px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <TypeLabel name={r.name} icon={r.icon} className={r.archived ? 'opacity-55' : ''} /> },
    { key: 'paid', label: t('leave.settings.pay'), width: '90px', render: (r) => (r.paid ? t('leave.paid') : t('leave.unpaid')) },
    { key: 'unit', label: t('leave.settings.unit'), width: '120px', hideBelow: 'lg', render: (r) => (r.unit === 'hour' ? t('leave.unit.hours_word') : t('leave.unit.days_word')) },
    { key: 'flags', label: t('leave.settings.rules'), width: 'minmax(180px,2fr)', phone: 'sub', render: (r) => <span className="flex flex-wrap gap-1">{r.statutory && <Tag tone="faint">{t('leave.settings.statutory')}</Tag>}{r.allow_half && <Tag tone="faint">{t('leave.settings.tag.half')}</Tag>}{r.allow_hours && <Tag tone="faint">{t('leave.settings.tag.hours')}</Tag>}{r.encashable && <Tag tone="faint">{t('leave.settings.tag.cash')}</Tag>}{r.payout_on_exit && <Tag tone="faint">{t('leave.settings.tag.payout')}</Tag>}{r.comp_off && <Tag tone="faint">{t('leave.settings.tag.comp')}</Tag>}{r.attachment_after_days > 0 && <Tag tone="faint">{t('leave.settings.tag.certificate')}</Tag>}{r.archived && <Tag tone="warn">{t('leave.settings.archived')}</Tag>}</span> },
  ];
  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button icon={Plus} onClick={() => setEdit('new')}>
          {t('leave.settings.add_type')}
        </Button>
      </div>
      {live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : live.data === null ? <Loading /> : (
        <div className="hr-panel hr-in min-w-0">
          <DataTable label={t('leave.settings.types')} columns={columns} rows={live.data.types} rowKey={(r) => r.id} onRowClick={(r) => setEdit(r)} empty={<Empty icon={CalendarPlus} title={t('leave.settings.no_types')} action={<Button icon={Plus} onClick={() => setEdit('new')}>{t('leave.settings.add_type')}</Button>} />} />
        </div>
      )}
      {edit !== null && <TypeSheet type={edit === 'new' ? null : edit} entity={entity} onClose={() => setEdit(null)} />}
    </>
  );
}

/* --------------------------------------------------------------- policies */

function RuleEditor({ rule, type, types, onChange }: { rule: Rule; type: LeaveType | undefined; types: LeaveType[]; onChange: (r: Rule) => void }): React.JSX.Element {
  const set = (patch: Partial<Rule>): void => onChange({ ...rule, ...patch });
  const n = (v: string): number => Number(v.replace(',', '.')) || 0;
  const unit = type?.unit === 'hour' ? t('leave.unit.hours_word') : t('leave.unit.days_word');
  const periodic = rule.method === 'fixed' || rule.method === 'monthly_accrual' || rule.method === 'per_hours_worked' || rule.method === 'tenure_table';
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {type !== undefined ? <TypeLabel name={type.name} icon={type.icon} color={type.color} className="min-w-0 flex-1 text-[13px] font-medium" /> : <span className="flex-1 text-[13px]">{rule.type}</span>}
        <Select value={rule.method} onChange={(e) => set({ method: e.target.value })} aria-label={t('leave.policy.method')} className="w-auto">
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`leave.method.${m}`)}
            </option>
          ))}
        </Select>
      </div>
      {(rule.method === 'fixed' || rule.method === 'monthly_accrual') && (
        <Row label={t('leave.policy.amount', { unit })}>
          <Input value={String(rule.amount ?? '')} onChange={(e) => set({ amount: n(e.target.value) })} inputMode="decimal" aria-label={t('leave.policy.amount', { unit })} className="w-24" />
        </Row>
      )}
      {rule.method === 'per_hours_worked' && (
        <Row label={t('leave.policy.per_hours')}>
          <span className="flex items-center gap-1.5 text-[13px]">
            <Input value={String(rule.per_hours?.earn ?? 1)} onChange={(e) => set({ per_hours: { per: rule.per_hours?.per ?? 30, earn: n(e.target.value) } })} inputMode="decimal" aria-label={t('leave.policy.earn')} className="w-16" />
            {t('leave.policy.per')}
            <Input value={String(rule.per_hours?.per ?? 30)} onChange={(e) => set({ per_hours: { earn: rule.per_hours?.earn ?? 1, per: n(e.target.value) } })} inputMode="decimal" aria-label={t('leave.policy.per_hours')} className="w-16" />
            {t('leave.policy.hours_worked')}
          </span>
        </Row>
      )}
      {rule.method === 'tenure_table' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="hr-label flex-1">{t('leave.policy.tenure')}</span>
            <Segmented size="sm" value={rule.tenure_unit ?? 'years'} onChange={(v) => set({ tenure_unit: v })} label={t('leave.policy.tenure_unit')} options={[{ value: 'years', label: t('leave.policy.years') }, { value: 'months', label: t('leave.policy.months') }]} />
          </div>
          {(rule.tenure ?? []).map((row, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[13px]">
              <span className="w-12 text-[var(--hr-muted)]">{t('leave.policy.after')}</span>
              <Input value={String(row.after)} onChange={(e) => set({ tenure: (rule.tenure ?? []).map((x, j) => (j === i ? { ...x, after: n(e.target.value) } : x)) })} inputMode="decimal" aria-label={t('leave.policy.after')} className="w-16" />
              <span className="text-[var(--hr-muted)]">{rule.tenure_unit === 'months' ? t('leave.policy.months') : t('leave.policy.years')}</span>
              <Input value={String(row.amount)} onChange={(e) => set({ tenure: (rule.tenure ?? []).map((x, j) => (j === i ? { ...x, amount: n(e.target.value) } : x)) })} inputMode="decimal" aria-label={t('leave.policy.amount', { unit })} className="w-16" />
              <span className="flex-1 text-[var(--hr-muted)]">{unit}</span>
              <LinkButton tone="danger" onClick={() => set({ tenure: (rule.tenure ?? []).filter((_, j) => j !== i) })}>{t('ui.remove')}</LinkButton>
            </div>
          ))}
          <LinkButton onClick={() => set({ tenure: [...(rule.tenure ?? []), { after: (rule.tenure ?? []).length, amount: 0 }] })}>{t('leave.policy.add_step')}</LinkButton>
        </div>
      )}
      {rule.method === 'statutory_jp' && <p className="text-[12px] text-[var(--hr-muted)]">{t('leave.policy.jp_note')}</p>}
      {(periodic || rule.method === 'manual') && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {periodic && (
            <Row label={t('leave.policy.carry')} hint={t('leave.policy.carry_hint')}>
              <Input value={String(rule.carryover_max ?? 0)} onChange={(e) => set({ carryover_max: Number(e.target.value) })} inputMode="decimal" aria-label={t('leave.policy.carry')} className="w-20" />
            </Row>
          )}
          {periodic && (rule.carryover_max ?? 0) !== 0 && (
            <Row label={t('leave.policy.carry_expiry')} hint={t('leave.policy.zero_never')}>
              <Input value={String(rule.carryover_expiry_months ?? 0)} onChange={(e) => set({ carryover_expiry_months: n(e.target.value) })} inputMode="numeric" aria-label={t('leave.policy.carry_expiry')} className="w-20" />
            </Row>
          )}
          {(rule.method === 'manual' || rule.expiry === 'grant') && (
            <Row label={t('leave.policy.grant_expiry')} hint={t('leave.policy.zero_never')}>
              <Input value={String(rule.grant_expiry_months ?? 0)} onChange={(e) => set({ grant_expiry_months: n(e.target.value), expiry: 'grant' })} inputMode="numeric" aria-label={t('leave.policy.grant_expiry')} className="w-20" />
            </Row>
          )}
          {periodic && (
            <Row label={t('leave.policy.wait')}>
              <Input value={String(rule.eligible_after_months ?? 0)} onChange={(e) => set({ eligible_after_months: n(e.target.value) })} inputMode="numeric" aria-label={t('leave.policy.wait')} className="w-20" />
            </Row>
          )}
          {(rule.method === 'monthly_accrual' || rule.method === 'per_hours_worked') && (
            <Row label={t('leave.policy.cap')} hint={t('leave.policy.zero_none')}>
              <Input value={String(rule.max_balance ?? 0)} onChange={(e) => set({ max_balance: n(e.target.value) })} inputMode="decimal" aria-label={t('leave.policy.cap')} className="w-20" />
            </Row>
          )}
          {type?.encashable === true && (
            <Row label={t('leave.policy.encash_max')} hint={t('leave.policy.zero_none')}>
              <Input value={String(rule.encash_max ?? 0)} onChange={(e) => set({ encash_max: n(e.target.value) })} inputMode="decimal" aria-label={t('leave.policy.encash_max')} className="w-20" />
            </Row>
          )}
        </div>
      )}
      {(rule.method === 'fixed' || rule.method === 'tenure_table') && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Switch checked={rule.proration === 'join'} onChange={(v) => set({ proration: v ? 'join' : 'none' })} label={t('leave.policy.prorate')} />
          <Switch checked={rule.deduct_holidays === true} onChange={(v) => set({ deduct_holidays: v })} label={t('leave.policy.deduct_holidays')} />
          <Segmented size="sm" value={rule.rounding ?? 'half'} onChange={(v) => set({ rounding: v })} label={t('leave.policy.rounding')} options={[{ value: 'half', label: t('leave.policy.round_half') }, { value: 'whole', label: t('leave.policy.round_whole') }, { value: 'none', label: t('leave.policy.round_none') }]} />
          <Segmented size="sm" value={rule.scale ?? 'none'} onChange={(v) => set({ scale: v })} label={t('leave.policy.scale')} options={[{ value: 'none', label: t('leave.policy.scale_none') }, { value: 'fte', label: t('leave.policy.scale_fte') }, { value: 'days_per_week', label: t('leave.policy.scale_days') }]} />
        </div>
      )}
      {rule.method !== 'none' && types.length > 1 && (rule.includes ?? []).length > 0 && <p className="text-[12px] text-[var(--hr-muted)]">{t('leave.policy.includes', { list: (rule.includes ?? []).map((c) => types.find((x) => x.code === c)?.name ?? c).join(', ') })}</p>}
    </div>
  );
}

function PolicySheet({ policy, entity, types, onClose }: { policy: Policy | null; entity: string; types: LeaveType[]; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(policy?.name ?? '');
  const [ps, setPs] = useState(policy?.period_start ?? '01-01');
  const [rules, setRules] = useState<Rule[]>(() => {
    const base = policy?.rules ?? [];
    return types.filter((x) => !x.archived).map((x) => base.find((r) => r.type === x.code) ?? { type: x.code, method: 'none' });
  });
  const [from, setFrom] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      await op('leave.policy-save', { policy: policy?.id, name: name.trim(), entity: policy === null ? entity : undefined, period_start: ps, rules, effective_from: from === '' ? undefined : from, make_default: makeDefault ? true : undefined }, { quiet: true });
      changed(...READS);
      toast.success(t('leave.settings.saved', { name }));
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} label={t('leave.settings.policy')} width={640}>
      <SheetHeader title={policy?.name ?? t('leave.settings.new_policy')} meta={policy !== null ? t('leave.policy.meta', { n: policy.people, versions: policy.versions.length }) : undefined} onClose={onClose} />
      <div className="hr-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('leave.settings.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('leave.settings.name')} />
          </Field>
          <Field label={t('leave.policy.year_start')} hint={t('leave.policy.year_start_hint')}>
            <Input value={ps} onChange={(e) => setPs(e.target.value)} placeholder="01-01" aria-label={t('leave.policy.year_start')} className="hr-mono w-24" />
          </Field>
        </div>
        {policy !== null && policy.note !== '' && <Notice>{policy.note}</Notice>}
        {rules.map((r, i) => (
          <RuleEditor key={r.type} rule={r} type={types.find((x) => x.code === r.type)} types={types} onChange={(x) => setRules((list) => list.map((y, j) => (j === i ? x : y)))} />
        ))}
        {policy !== null && (
          <Field label={t('leave.policy.from')} hint={t('leave.policy.from_hint')}>
            <DayPicker value={from} onChange={setFrom} label={t('leave.policy.from')} clearable />
          </Field>
        )}
        {(policy === null || !policy.is_default) && <Switch checked={makeDefault} onChange={setMakeDefault} label={t('leave.policy.make_default')} />}
        {policy !== null && policy.versions.length > 1 && (
          <div className="text-[12px] text-[var(--hr-muted)]">
            {t('leave.policy.versions')}: {policy.versions.map((v) => (v.from === '' ? t('leave.policy.first') : fmtDay(v.from, { year: 'always' }))).join(', ')}
          </div>
        )}
        {err !== '' && <Notice tone="bad">{err}</Notice>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-[var(--hr-line)] px-4 py-3">
        <Button onClick={onClose}>{t('ui.cancel')}</Button>
        <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
          {t('ui.save')}
        </Button>
      </footer>
    </Sheet>
  );
}

function PoliciesTab({ entity }: { entity: string }): React.JSX.Element {
  const live = useOp<{ policies: Policy[] }>('leave.policies', { entity }, READS, { name: 'leave.policies.settings' });
  const types = useOp<{ types: LeaveType[] }>('leave.types', { entity }, READS, { name: 'leave.types.policy' });
  const [edit, setEdit] = useState<Policy | null | 'new'>(null);
  const columns: Column<Policy>[] = [
    { key: 'name', label: t('leave.settings.name'), width: 'minmax(220px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="flex items-center gap-2"><span className="hr-wrap font-medium">{r.name}</span>{r.is_default && <Tag tone="rh">{t('leave.policy.default')}</Tag>}</span> },
    { key: 'year', label: t('leave.policy.year_start'), width: '110px', mono: true, render: (r) => r.period_start },
    { key: 'types', label: t('leave.settings.types'), width: '90px', align: 'right', mono: true, render: (r) => r.rules.filter((x) => x.method !== 'none').length },
    { key: 'people', label: t('leave.home.people'), width: '90px', align: 'right', mono: true, phone: 'end', sort: (r) => r.people, render: (r) => r.people },
    { key: 'updated', label: t('leave.policy.changed'), width: '120px', hideBelow: 'lg', render: (r) => ago(r.updated) },
  ];
  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button icon={Plus} onClick={() => setEdit('new')}>
          {t('leave.settings.add_policy')}
        </Button>
      </div>
      {live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : live.data === null || types.data === null ? <Loading /> : (
        <div className="hr-panel hr-in min-w-0">
          <DataTable label={t('leave.settings.policies')} columns={columns} rows={live.data.policies} rowKey={(r) => r.id} onRowClick={(r) => setEdit(r)} empty={<Empty icon={CalendarClock} title={t('leave.settings.no_policies')} />} />
        </div>
      )}
      {edit !== null && types.data !== null && <PolicySheet policy={edit === 'new' ? null : edit} entity={entity} types={types.data.types} onClose={() => setEdit(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ locks */

function LocksTab({ entity }: { entity: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ blocks: Block[] }>('leave.blocks', {}, READS, { name: 'leave.blocks' });
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { name: 'leave.departments' });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('leave.block-save', { entity, department: dept === '' ? undefined : dept, from, to: to === '' ? from : to, reason: reason.trim() });
      changed(...READS);
      setFrom('');
      setTo('');
      setReason('');
      toast.success(t('leave.locks.added'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('leave.locks.add')} className="lg:col-span-5">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('leave.locks.from')}>
              <DayPicker value={from} onChange={setFrom} min={me.today} label={t('leave.locks.from')} />
            </Field>
            <Field label={t('leave.locks.to')}>
              <DayPicker value={to} onChange={setTo} min={from === '' ? me.today : from} label={t('leave.locks.to')} />
            </Field>
          </div>
          <Field label={t('leave.locks.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('leave.locks.reason_ph')} aria-label={t('leave.locks.reason')} />
          </Field>
          <Field label={t('leave.col.department')} optional>
            <Picker value={dept} onChange={(v) => setDept(v)} items={(depts.data?.departments ?? []).map((x) => ({ value: x.id, label: x.name }))} label={t('leave.col.department')} placeholder={t('leave.calendar.all_departments')} clearable />
          </Field>
          <Button variant="primary" icon={Lock} busy={busy} disabled={from === '' || reason.trim() === ''} onClick={() => void add()}>
            {t('leave.locks.lock')}
          </Button>
        </div>
      </Panel>
      <Panel index="02" label={t('leave.locks.title')} className="lg:col-span-7" flush>
        {live.data === null ? (
          <Loading />
        ) : live.data.blocks.length === 0 ? (
          <Empty icon={Lock} title={t('leave.locks.none')} />
        ) : (
          <ul>
            {live.data.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5 first:border-t-0">
                <Lock size={14} aria-hidden className="text-[var(--hr-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium">{b.reason}</span>
                  <span className="block text-[12px] text-[var(--hr-muted)]">
                    {fmtRange(b.from, b.to)} · {b.department_name !== '' ? b.department_name : b.entity_name !== '' ? b.entity_name : t('leave.all_entities')}
                  </span>
                </span>
                <LinkButton tone="danger" onClick={() => void (async () => {
                  if (!(await confirmAsk(t('leave.locks.remove_text', { reason: b.reason }), t('leave.locks.remove')))) return;
                  await op('leave.block-delete', { block: b.id });
                  changed(...READS);
                })()}>
                  <Trash2 size={13} aria-hidden />
                  {t('ui.remove')}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- bulk tools */

interface BulkPerson {
  employment: string;
  number: string;
  name: string;
  current_policy?: string;
  ok?: boolean;
  note?: string;
}

function BulkTab({ entity }: { entity: string }): React.JSX.Element {
  const me = useMe();
  const policies = useOp<{ policies: Policy[] }>('leave.policies', { entity }, READS, { name: 'leave.policies.bulk' });
  const types = useOp<{ types: LeaveType[] }>('leave.types', { entity }, READS, { name: 'leave.types.bulk' });
  const depts = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { name: 'leave.departments' });
  const [mode, setMode] = useState<'assign' | 'grant'>('assign');
  const [policy, setPolicy] = useState('');
  const [from, setFrom] = useState(me.today);
  const [dept, setDept] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [type, setType] = useState('');
  const [amt, setAmt] = useState('1');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPreview(null), [mode, policy, from, dept, onlyNew, type, amt, reason]);
  const params = (): Record<string, unknown> =>
    mode === 'assign'
      ? { policy, effective_from: from, entity, department: dept === '' ? undefined : dept, only_unassigned: onlyNew ? true : undefined }
      : { type, amount: Number(amt.replace(',', '.')), reason: reason.trim(), day: from, entity, department: dept === '' ? undefined : dept };
  const run = async (dry: boolean): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ people: BulkPerson[]; count: number }>(mode === 'assign' ? 'leave.assign-bulk' : 'leave.grant-bulk', { ...params(), dry_run: dry ? true : undefined });
      if (dry) setPreview(r.people);
      else {
        changed(...READS);
        setPreview(null);
        toast.success(mode === 'assign' ? t('leave.bulk.assigned', { n: r.count }) : t('leave.bulk.granted', { n: r.count }));
      }
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const ready = mode === 'assign' ? policy !== '' : type !== '' && Number(amt) !== 0 && reason.trim() !== '';
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('leave.bulk.title')} className="lg:col-span-5">
        <div className="flex flex-col gap-3">
          <Segmented value={mode} onChange={setMode} label={t('leave.bulk.title')} options={[{ value: 'assign', label: t('leave.bulk.assign') }, { value: 'grant', label: t('leave.bulk.grant') }]} />
          {mode === 'assign' ? (
            <Field label={t('leave.settings.policy')}>
              <Picker value={policy} onChange={(v) => setPolicy(v)} items={(policies.data?.policies ?? []).map((p) => ({ value: p.id, label: p.name }))} label={t('leave.settings.policy')} />
            </Field>
          ) : (
            <>
              <Field label={t('leave.type')}>
                <Picker value={type} onChange={(v) => setType(v)} items={(types.data?.types ?? []).filter((x) => x.tracked !== false).map((x) => ({ value: x.code, label: x.name }))} label={t('leave.type')} />
              </Field>
              <Field label={t('leave.bulk.amount')} hint={t('leave.adjust.amount_hint')}>
                <Input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" aria-label={t('leave.bulk.amount')} className="w-24" />
              </Field>
              <Field label={t('leave.adjust.reason')}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('leave.bulk.reason_ph')} aria-label={t('leave.adjust.reason')} />
              </Field>
            </>
          )}
          <Field label={mode === 'assign' ? t('leave.policy.from') : t('leave.adjust.day')}>
            <DayPicker value={from} onChange={setFrom} label={t('leave.policy.from')} />
          </Field>
          <Field label={t('leave.col.department')} optional>
            <Picker value={dept} onChange={(v) => setDept(v)} items={(depts.data?.departments ?? []).map((x) => ({ value: x.id, label: x.name }))} label={t('leave.col.department')} placeholder={t('leave.bulk.everyone')} clearable />
          </Field>
          {mode === 'assign' && <Switch checked={onlyNew} onChange={setOnlyNew} label={t('leave.bulk.only_new')} />}
          <div className="flex justify-end gap-2">
            <Button icon={Users} busy={busy && preview === null} disabled={!ready} onClick={() => void run(true)}>
              {t('leave.bulk.preview')}
            </Button>
          </div>
        </div>
      </Panel>
      <Panel index="02" label={preview === null ? t('leave.bulk.who') : t('leave.bulk.who_n', { n: preview.filter((p) => p.ok !== false).length })} className="lg:col-span-7" flush>
        {preview === null ? (
          <p className="px-3.5 py-4 text-[13px] text-[var(--hr-muted)]">{t('leave.bulk.preview_first')}</p>
        ) : (
          <>
            <ul className="hr-scroll max-h-[420px] overflow-y-auto">
              {preview.map((p) => (
                <li key={p.employment} className="flex items-center gap-2 border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px] first:border-t-0">
                  <span className="min-w-0 flex-1">{p.name}</span>
                  <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{p.number}</span>
                  <span className="w-44 truncate text-right text-[12px] text-[var(--hr-muted)]">{p.ok === false ? p.note : p.current_policy !== undefined ? p.current_policy : ''}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-[var(--hr-line)] px-3.5 py-2.5">
              <Button variant="primary" busy={busy} disabled={preview.length === 0} onClick={() => void run(false)}>
                {mode === 'assign' ? t('leave.bulk.assign_n', { n: preview.length }) : t('leave.bulk.grant_n', { n: preview.filter((p) => p.ok !== false).length })}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------- run */

function RunTab(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ runs: { id: string; entity: string; day: string; employments: number; rows: number; errors: number; ms: number; note: string; at: string }[] }>('leave.sync-log', {}, ['leave_sync'], { name: 'leave.sync-log' });
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('leave.sync', {});
      changed('leave_sync', ...READS);
      toast.success(t('leave.run.done'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const ent = (id: string): string => me.entities.find((e) => e.id === id)?.name ?? id;
  return (
    <Panel index="01" label={t('leave.run.title')} aside={<Button size="sm" icon={RefreshCw} busy={busy} onClick={() => void run()}>{t('leave.run.now')}</Button>} flush>
      <p className="px-3.5 pb-2 text-[13px] text-[var(--hr-muted)]">{t('leave.run.what')}</p>
      {live.data === null ? (
        <Loading />
      ) : live.data.runs.length === 0 ? (
        <p className="px-3.5 pb-4 text-[13px] text-[var(--hr-muted)]">{t('leave.run.none')}</p>
      ) : (
        <ul>
          {live.data.runs.map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px]">
              <span className="min-w-0 truncate">
                {ent(r.entity)} · {fmtDay(r.day)}
              </span>
              <span className="hr-num text-[12px] text-[var(--hr-muted)]">{t('leave.run.row', { people: r.employments, rows: r.rows })}</span>
              {r.errors > 0 ? <Tag tone="bad" title={r.note}>{t('leave.run.errors', { n: r.errors })}</Tag> : <Tag tone="good">{t('leave.run.ok')}</Tag>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function LeaveSettingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const entity = useEntityId();
  const tab = (query.get('tab') as Tab | null) ?? 'types';
  const entName = me.entities.find((e) => e.id === entity)?.name ?? '';
  const tabs = useMemo(
    () => [
      { value: 'types' as Tab, label: t('leave.settings.types') },
      { value: 'policies' as Tab, label: t('leave.settings.policies') },
      { value: 'locks' as Tab, label: t('leave.locks.title') },
      { value: 'bulk' as Tab, label: t('leave.bulk.title') },
      { value: 'run' as Tab, label: t('leave.run.title') },
    ],
    [],
  );
  return (
    <>
      <PageHeader title={t('leave.settings.title')} meta={entName} />
      <PageBody>
        {entity === '' ? (
          <Empty icon={CalendarClock} title={t('leave.settings.no_entity')} />
        ) : (
          <>
            <Tabs value={tab} onChange={(v) => setQuery({ tab: v === 'types' ? undefined : v })} tabs={tabs} label={t('leave.settings.title')} className="mb-3" />
            {tab === 'types' && <TypesTab entity={entity} />}
            {tab === 'policies' && <PoliciesTab entity={entity} />}
            {tab === 'locks' && <LocksTab entity={entity} />}
            {tab === 'bulk' && <BulkTab entity={entity} />}
            {tab === 'run' && <RunTab />}
          </>
        )}
      </PageBody>
    </>
  );
}

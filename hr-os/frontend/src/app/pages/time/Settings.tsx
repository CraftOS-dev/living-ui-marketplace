/**
 * Time settings (HR): overtime rules per entity (clocking, timesheets,
 * the rules with their multipliers and pay codes, overtime limits), shift
 * types, shift patterns, and kiosk tablets with personal kiosk PINs.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, KeyRound, MonitorSmartphone, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, Dialog, Empty, EntityPicker, Field, Hint, IconButton, Input, LinkButton, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Picker, Row, Segmented, Select, StatusDot, Tabs, Tag, Toggle, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { KioskPinDialog } from './KioskPin.tsx';
import type { KioskDevice, Pattern, Rule, RuleSet, ShiftType } from './types.ts';
import { hm, READS, span } from './util.ts';

type Tab = 'rules' | 'shifts' | 'kiosk';

export function SettingsPage({ query }: PageProps): React.JSX.Element {
  const tab = (query.get('tab') as Tab | null) ?? 'rules';
  return (
    <>
      <PageHeader title={t('time.set.title')} />
      <PageBody className="max-w-[1180px]">
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'rules' ? undefined : v })}
          label={t('time.set.title')}
          className="mb-3"
          tabs={[
            { value: 'rules', label: t('time.set.rules') },
            { value: 'shifts', label: t('time.set.shifts') },
            { value: 'kiosk', label: t('time.set.kiosk') },
          ]}
        />
        {tab === 'rules' ? <RulesTab /> : tab === 'shifts' ? <ShiftsTab /> : <KioskTab />}
      </PageBody>
    </>
  );
}

function useEntityPick(): [string, (v: string) => void, { id: string; name: string; country: string }[]] {
  const me = useMe();
  const { entity } = useUi();
  const [pick, setPick] = useState(entity !== '' ? entity : (me.entities[0]?.id ?? ''));
  useEffect(() => {
    if (entity !== '') setPick(entity);
  }, [entity]);
  return [pick, setPick, me.entities];
}

/* ---------------------------------------------------------------- rules */

const WHEN: Rule['when'][] = ['daily_over', 'weekly_over', 'monthly_over', 'seventh_day', 'rest_day', 'holiday', 'night'];
const CAPS = ['monthly_warn', 'monthly_limit', 'avg_limit', 'yearly_warn', 'yearly_limit'];

function RulesTab(): React.JSX.Element {
  const me = useMe();
  const [entity, setEntity, ents] = useEntityPick();
  const live = useOp<{ rule_sets: RuleSet[] }>('overtime-rules.list', { entity: entity === '' ? undefined : entity }, READS.rules, { skip: entity === '', name: 'time.rules' });
  const sets = live.data?.rule_sets ?? [];
  const [sel, setSel] = useState('');
  const current = sets.find((s) => s.id === sel) ?? sets.find((s) => s.active && (s.applies.employment_types ?? []).length === 0) ?? sets[0] ?? null;
  const full = can(me, 'time', 'full');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ents.length > 1 && <EntityPicker value={entity} onChange={(v) => (setEntity(v), setSel(''))} label={t('time.set.entity')} entities={ents} className="w-[260px]" />}
        {sets.length > 1 && <Picker value={current?.id ?? ''} onChange={setSel} items={sets.map((s) => ({ value: s.id, label: s.name, sub: (s.applies.employment_types ?? []).length > 0 ? (s.applies.employment_types ?? []).join(', ') : t('time.set.everyone_else') }))} label={t('time.set.rule_set')} className="w-[260px]" />}
      </div>
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <Loading />
        )
      ) : current === null ? (
        <Empty icon={RotateCcw} title={t('time.set.no_rules')} action={full ? <Button variant="primary" onClick={() => void act([], () => op('overtime-rules.reset', { entity }), READS.rules)}>{t('time.set.use_defaults')}</Button> : undefined} />
      ) : (
        <RuleEditor key={current.id + current.updated} rs={current} canEdit={full} />
      )}
    </div>
  );
}

interface RuleRow {
  when: Rule['when'];
  hours: string;
  multiplier: string;
  component: string;
  from: string;
  to: string;
  dow: string;
  note: string;
}

function toRow(r: Rule): RuleRow {
  return { when: r.when, hours: String(Math.round((r.threshold_min / 60) * 100) / 100), multiplier: String(r.multiplier), component: r.component, from: r.from ?? '22:00', to: r.to ?? '05:00', dow: (r.dow ?? []).join(','), note: r.note ?? '' };
}

function RuleEditor({ rs, canEdit }: { rs: RuleSet; canEdit: boolean }): React.JSX.Element {
  const [rows, setRows] = useState<RuleRow[]>(() => rs.rules.map(toRow));
  const [settings, setSettings] = useState(rs.settings);
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rs.caps).map(([k, v]) => [k, k === 'year_start' || k === 'months_over_warn' ? String(v) : String(Math.round((Number(v) / 60) * 10) / 10)])));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(rs.rules.map(toRow)) || JSON.stringify(settings) !== JSON.stringify(rs.settings) || JSON.stringify(caps) !== JSON.stringify(Object.fromEntries(Object.entries(rs.caps).map(([k, v]) => [k, k === 'year_start' || k === 'months_over_warn' ? String(v) : String(Math.round((Number(v) / 60) * 10) / 10)])));
  const set = (i: number, patch: Partial<RuleRow>): void => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async (): Promise<void> => {
    const rules = rows.map((r) => {
      const out: Record<string, unknown> = { when: r.when, threshold_min: Math.round(Number(r.hours.replace(',', '.')) * 60) || 0, multiplier: Number(r.multiplier.replace(',', '.')), component: r.component.trim().toUpperCase() };
      if (r.when === 'night') {
        out['from'] = r.from;
        out['to'] = r.to;
      }
      if (r.when === 'rest_day' && r.dow.trim() !== '') out['dow'] = r.dow.split(',').map((x) => Number(x.trim()));
      if (r.note.trim() !== '') out['note'] = r.note.trim();
      return out;
    });
    const capsOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(caps)) {
      if (v.trim() === '') continue;
      capsOut[k] = k === 'year_start' ? v.trim() : k === 'months_over_warn' ? Number(v) : Math.round(Number(v.replace(',', '.')) * 60);
    }
    setBusy(true);
    const r = await act([], () => op('overtime-rules.save', { rule_set: rs.id, rules, settings, caps: capsOut }), READS.rules);
    setBusy(false);
    if (r !== null) toast.success(t('time.set.saved'));
  };
  const reset = async (): Promise<void> => {
    const ok = await confirmAsk(t('time.set.reset_text', { country: rs.country }), t('time.set.reset'), t('time.set.reset_ok'), 'primary');
    if (ok) await act([], () => op('overtime-rules.reset', { entity: rs.entity }), READS.rules);
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={rs.name} className="lg:col-span-7" aside={canEdit ? <LinkButton onClick={() => void reset()}><RotateCcw size={12} aria-hidden />{t('time.set.reset')}</LinkButton> : undefined}>
        {rs.notes !== '' && (
          <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
            <span className="min-w-0 truncate">{rs.notes}</span>
            <Hint text={rs.notes} />
          </p>
        )}
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-raised)] p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Select value={r.when} onChange={(e) => set(i, { when: e.target.value as Rule['when'] })} disabled={!canEdit} aria-label={t('time.set.when')} className="w-[180px]">
                  {WHEN.map((w) => (
                    <option key={w} value={w}>
                      {t('time.when.' + w)}
                    </option>
                  ))}
                </Select>
                {r.when !== 'night' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                    {t('time.set.after')}
                    <Input value={r.hours} onChange={(e) => set(i, { hours: e.target.value })} disabled={!canEdit} aria-label={t('time.set.after_hours')} className="hr-mono w-16" inputMode="decimal" />
                    {t('time.set.h')}
                  </span>
                )}
                {r.when === 'night' && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                    <Input value={r.from} onChange={(e) => set(i, { from: e.target.value })} disabled={!canEdit} aria-label={t('time.set.from')} className="hr-mono w-16" />
                    {t('time.set.to')}
                    <Input value={r.to} onChange={(e) => set(i, { to: e.target.value })} disabled={!canEdit} aria-label={t('time.set.until')} className="hr-mono w-16" />
                  </span>
                )}
                <span className="flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                  x
                  <Input value={r.multiplier} onChange={(e) => set(i, { multiplier: e.target.value })} disabled={!canEdit} aria-label={t('time.set.multiplier')} className="hr-mono w-16" inputMode="decimal" />
                </span>
                <Input value={r.component} onChange={(e) => set(i, { component: e.target.value })} disabled={!canEdit} aria-label={t('time.set.component')} title={t('time.set.component_tip')} className="hr-mono w-24 uppercase" />
                {r.note !== '' && <Hint text={r.note} />}
                {canEdit && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} />}
              </div>
              {r.when === 'rest_day' && (
                <span className="flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                  {t('time.set.dow')}
                  <Input value={r.dow} onChange={(e) => set(i, { dow: e.target.value })} disabled={!canEdit} placeholder="0" aria-label={t('time.set.dow')} className="hr-mono w-24" />
                </span>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('time.set.no_rules_here')}</p>}
          {canEdit && (
            <LinkButton onClick={() => setRows([...rows, { when: 'daily_over', hours: '8', multiplier: '1.5', component: 'OT150', from: '22:00', to: '05:00', dow: '', note: '' }])}>
              <Plus size={12} aria-hidden />
              {t('time.set.add_rule')}
            </LinkButton>
          )}
        </div>
      </Panel>
      <div className="flex flex-col gap-3 lg:col-span-5">
        <Panel index="02" label={t('time.set.how')}>
          <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
            <Row label={t('time.set.tracking')} hint={settings.tracking === 'punch' ? t('time.set.tracking_punch') : t('time.set.tracking_exception')}>
              <Toggle checked={settings.tracking === 'punch'} onChange={(v) => setSettings({ ...settings, tracking: v ? 'punch' : 'exception' })} label={t('time.set.tracking')} disabled={!canEdit} />
            </Row>
            <Row label={t('time.set.timesheets')}>
              <Segmented value={settings.timesheets} onChange={(v) => setSettings({ ...settings, timesheets: v })} label={t('time.set.timesheets')} size="sm" options={(['optional', 'required', 'off'] as const).map((v) => ({ value: v, label: t('time.set.ts.' + v) }))} />
            </Row>
            <Row label={t('time.set.preapproval')} hint={t('time.set.preapproval_hint')}>
              <Toggle checked={settings.preapproval} onChange={(v) => setSettings({ ...settings, preapproval: v })} label={t('time.set.preapproval')} disabled={!canEdit} />
            </Row>
            <Row label={t('time.set.counts_leave')}>
              <Toggle checked={settings.counts_leave} onChange={(v) => setSettings({ ...settings, counts_leave: v })} label={t('time.set.counts_leave')} disabled={!canEdit} />
            </Row>
            <Row label={t('time.set.missing_punch')}>
              <Segmented value={settings.missing_punch} onChange={(v) => setSettings({ ...settings, missing_punch: v })} label={t('time.set.missing_punch')} size="sm" options={(['warning', 'blocker'] as const).map((v) => ({ value: v, label: t('time.set.sev.' + v) }))} />
            </Row>
            <Row label={t('time.set.cap_severity')}>
              <Segmented value={settings.cap_severity} onChange={(v) => setSettings({ ...settings, cap_severity: v })} label={t('time.set.cap_severity')} size="sm" options={(['warning', 'blocker'] as const).map((v) => ({ value: v, label: t('time.set.sev.' + v) }))} />
            </Row>
          </div>
        </Panel>
        <Panel index="03" label={t('time.set.caps')}>
          <div className="grid grid-cols-2 gap-2">
            {CAPS.map((k) => (
              <Field key={k} label={t('time.cap.' + k)} optional>
                <Input value={caps[k] ?? ''} onChange={(e) => setCaps({ ...caps, [k]: e.target.value })} disabled={!canEdit} placeholder={t('time.set.hours_ph')} className="hr-mono" inputMode="decimal" />
              </Field>
            ))}
            <Field label={t('time.cap.months_over_warn')} optional>
              <Input value={caps['months_over_warn'] ?? ''} onChange={(e) => setCaps({ ...caps, months_over_warn: e.target.value })} disabled={!canEdit} className="hr-mono" inputMode="numeric" />
            </Field>
            <Field label={t('time.cap.year_start')} optional>
              <Input value={caps['year_start'] ?? ''} onChange={(e) => setCaps({ ...caps, year_start: e.target.value })} disabled={!canEdit} placeholder="04-01" className="hr-mono" />
            </Field>
          </div>
        </Panel>
        {canEdit && (
          <div className="flex justify-end gap-2">
            <Button variant="primary" disabled={!dirty} busy={busy} onClick={() => void save()}>
              {t('time.set.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- shifts */

function ShiftsTab(): React.JSX.Element {
  const me = useMe();
  const [entity, setEntity, ents] = useEntityPick();
  const live = useOp<{ shift_types: ShiftType[] }>('shift-types.list', { entity: entity === '' ? undefined : entity, archived: true }, READS.rules, { skip: entity === '', name: 'time.types' });
  const pats = useOp<{ patterns: Pattern[] }>('shift-patterns.list', { entity: entity === '' ? undefined : entity }, READS.rules, { skip: entity === '' });
  const [edit, setEdit] = useState<ShiftType | 'new' | null>(null);
  const canEdit = can(me, 'time', 'edit');
  const columns: Column<ShiftType>[] = useMemo(
    () => [
      { key: 'name', label: t('time.set.shift_name'), width: 'minmax(160px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="flex items-center gap-2">{r.name}{r.code !== '' && <Tag>{r.code}</Tag>}{r.archived && <Tag tone="faint">{t('time.set.archived')}</Tag>}</span> },
      { key: 'hours', label: t('time.set.shift_hours'), width: '140px', mono: true, render: (r) => span(r.start, r.end) },
      { key: 'break', label: t('time.set.break'), width: '80px', mono: true, align: 'right', render: (r) => (r.break_min > 0 ? hm(r.break_min) : '') },
      { key: 'paid', label: t('time.set.paid_hours'), width: '90px', mono: true, align: 'right', phone: 'end', render: (r) => hm(r.minutes) },
      { key: 'grace', label: t('time.set.grace'), width: '90px', mono: true, align: 'right', hideBelow: 'lg', render: (r) => (r.grace_in_min > 0 ? hm(r.grace_in_min) : '') },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ents.length > 1 && <EntityPicker value={entity} onChange={setEntity} label={t('time.set.entity')} entities={ents} className="w-[260px]" />}
        <span className="flex-1" />
        {canEdit && (
          <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
            {t('time.set.add_shift')}
          </Button>
        )}
      </div>
      <div className="hr-panel hr-in min-w-0">
        {live.data === null ? <Loading /> : <DataTable label={t('time.set.shifts')} columns={columns} rows={live.data.shift_types} rowKey={(r) => r.id} onRowClick={canEdit ? (r) => setEdit(r) : undefined} empty={<Empty icon={Plus} title={t('time.set.no_shifts')} action={canEdit ? <Button variant="primary" onClick={() => setEdit('new')}>{t('time.set.add_shift')}</Button> : undefined} />} />}
      </div>
      <Panel index="02" label={t('time.set.patterns')}>
        {(pats.data?.patterns ?? []).length === 0 ? (
          <p className="py-2 text-[13px] text-[var(--hr-muted)]">{t('time.set.no_patterns')}</p>
        ) : (
          <ul className="flex flex-col">
            {(pats.data?.patterns ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                <span className="min-w-0 flex-1 text-[13px]">{p.name}</span>
                <span className="flex flex-wrap gap-1">
                  {p.days.map((sid, i) => (
                    <Tag key={i} tone={sid === '' ? 'faint' : 'neutral'}>
                      {sid === '' ? t('time.week.off') : (live.data?.shift_types.find((s) => s.id === sid)?.code ?? '?')}
                    </Tag>
                  ))}
                </span>
                {canEdit && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => void confirmAsk(t('time.set.pattern_delete_text', { name: p.name }), t('time.set.pattern_delete')).then((ok) => ok && act([], () => op('shift-patterns.delete', { pattern: p.id }), READS.rules))} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ShiftTypeDialog value={edit} entity={entity} onClose={() => setEdit(null)} />
    </div>
  );
}

function ShiftTypeDialog({ value, entity, onClose }: { value: ShiftType | 'new' | null; entity: string; onClose: () => void }): React.JSX.Element | null {
  const isNew = value === 'new';
  const v = value !== null && value !== 'new' ? value : null;
  const [f, setF] = useState({ name: '', code: '', start: '09:00', end: '18:00', break_min: '60', color: 'grey' as ShiftType['color'], grace_in_min: '5', archived: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (v !== null) setF({ name: v.name, code: v.code, start: v.start, end: v.end, break_min: String(v.break_min), color: v.color, grace_in_min: String(v.grace_in_min), archived: v.archived });
    else if (isNew) setF({ name: '', code: '', start: '09:00', end: '18:00', break_min: '60', color: 'grey', grace_in_min: '5', archived: false });
  }, [value, v, isNew]);
  if (value === null) return null;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ok = f.name.trim() !== '' && TIME.test(f.start) && TIME.test(f.end);
  const save = async (): Promise<void> => {
    setBusy(true);
    const params = { name: f.name.trim(), code: f.code.trim(), start: f.start, end: f.end, break_min: Number(f.break_min) || 0, color: f.color, grace_in_min: Number(f.grace_in_min) || 0 };
    const r = await act([], () => (isNew ? op('shift-types.add', { ...params, entity }) : op('shift-types.update', { ...params, shift_type: v?.id ?? '', archived: f.archived })), READS.rules.concat(READS.week));
    setBusy(false);
    if (r !== null) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t('time.set.add_shift') : f.name}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label={t('time.set.shift_name')}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('time.set.shift_name_ph')} autoFocus />
          </Field>
          <Field label={t('time.set.code')} optional>
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().slice(0, 4) })} placeholder="M" className="hr-mono" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('time.set.start')}>
            <Input value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className="hr-mono" aria-invalid={!TIME.test(f.start)} />
          </Field>
          <Field label={t('time.set.end')}>
            <Input value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className="hr-mono" aria-invalid={!TIME.test(f.end)} />
          </Field>
          <Field label={t('time.set.break_min')}>
            <Input value={f.break_min} onChange={(e) => setF({ ...f, break_min: e.target.value })} className="hr-mono" inputMode="numeric" />
          </Field>
        </div>
        <Field label={t('time.set.grace_in')}>
          <Input value={f.grace_in_min} onChange={(e) => setF({ ...f, grace_in_min: e.target.value })} className="hr-mono w-24" inputMode="numeric" />
        </Field>
        <Field label={t('time.set.color')}>
          <Segmented value={f.color} onChange={(c) => setF({ ...f, color: c })} label={t('time.set.color')} size="sm" options={(['grey', 'blue', 'teal', 'ink'] as const).map((c) => ({ value: c, label: t('time.color.' + c) }))} />
        </Field>
        {!isNew && <Toggle checked={f.archived} onChange={(a) => setF({ ...f, archived: a })} label={t('time.set.archive')} />}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- kiosk */

interface Loc {
  id: string;
  name: string;
  entity: string;
  /** Only for people who may start kiosks; others get has_kiosk_code. */
  kiosk_code?: string | undefined;
  has_kiosk_code: boolean;
  radius_m: number;
}

function KioskTab(): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const locs = useOp<{ locations: Loc[] }>('locations.list', { entity: entity === '' ? undefined : entity }, READS.rules, { name: 'time.kiosk.locations' });
  const devs = useOp<{ devices: KioskDevice[] }>('kiosk.devices', {}, READS.rules, { name: 'time.kiosk.devices' });
  const people = useOp<{ people: { employee: string; number: string; name: string }[] }>('people.directory', { limit: 500, entity: entity === '' ? undefined : entity }, ['employees', 'employments'], { name: 'time.kiosk.people' });
  const [who, setWho] = useState('');
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null);
  const canEdit = can(me, 'time', 'edit');
  const list = locs.data?.locations ?? [];
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('time.kiosk.locations')} className="lg:col-span-7" flush>
        {locs.data === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={MonitorSmartphone} title={t('time.kiosk.no_locations')} action={<Button onClick={() => navigate('/settings/locations')}>{t('time.kiosk.add_location')}</Button>} />
        ) : (
          <ul>
            {list.map((l) => {
              const mine = (devs.data?.devices ?? []).filter((d) => d.location === l.id && !d.revoked);
              return (
                <li key={l.id} className="border-t border-[var(--hr-hair)] px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{l.name}</span>
                      <span className="hr-label">{l.kiosk_code !== undefined && l.kiosk_code !== '' ? t('time.kiosk.code', { code: l.kiosk_code }) : l.has_kiosk_code ? t('time.kiosk.has_code') : t('time.kiosk.no_code')}</span>
                    </span>
                    {canEdit && (
                      <Button size="sm" icon={ExternalLink} onClick={() => navigate('/time/kiosk/' + (l.kiosk_code !== undefined && l.kiosk_code !== '' ? l.kiosk_code : l.id))}>
                        {t('time.kiosk.open_here')}
                      </Button>
                    )}
                  </div>
                  {mine.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {mine.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-[13px]">
                          <StatusDot tone="good" label={d.name} />
                          <span className="text-[var(--hr-muted)]">{d.last_seen !== '' ? t('time.kiosk.seen', { when: ago(d.last_seen) }) : t('time.kiosk.never')}</span>
                          <span className="flex-1" />
                          {canEdit && <LinkButton tone="danger" onClick={() => void act([], () => op('kiosk.stop', { device: d.id }), READS.rules)}>{t('time.kiosk.stop')}</LinkButton>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel index="02" label={t('time.kiosk.pins')} className="lg:col-span-5">
        <div className="flex flex-col gap-2">
          <Field label={t('time.kiosk.person')}>
            <Picker value={who} onChange={setWho} items={(people.data?.people ?? []).map((p) => ({ value: p.employee, label: p.name, sub: p.number, person: true }))} label={t('time.kiosk.person')} placeholder={t('time.kiosk.pick_person')} />
          </Field>
          <Button icon={KeyRound} disabled={who === '' || !canEdit} onClick={() => setPinFor({ id: who, name: (people.data?.people ?? []).find((p) => p.employee === who)?.name ?? '' })}>
            {t('time.kiosk.set_pin')}
          </Button>
          <Notice className={cn('mt-1')}>{t('time.kiosk.pin_note')}</Notice>
        </div>
      </Panel>
      <KioskPinDialog open={pinFor !== null} onClose={() => setPinFor(null)} employee={pinFor?.id} name={pinFor?.name} />
    </div>
  );
}

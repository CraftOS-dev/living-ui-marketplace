/**
 * Payroll set-up pages: pay schedules with their calendar (pay days moved
 * off weekends and holidays), components, pay items (one-off inputs with a
 * CSV dry run, recurring items, held pay, benefit plans) and the payroll
 * settings of an entity (with the employer fields its packs read).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, FileUp, Hand, Layers, Plus, Settings2, Upload } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, Hint, Input, PinBoxes, LoadError, Loading, Money, MoneyInput, Notice, PageBody, PageHeader, Panel, Picker, Row, Segmented, Select, Sheet, SheetHeader, StatusDot, Tabs, Tag, Textarea, Toggle, DayPicker, majorParam, toast } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { op } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { useUi } from '../../../lib/store.tsx';
import { changedFields, FieldForm, periodLabel, RunStatus } from '../../../components/payroll/bits.tsx';
import { usePeopleOptions } from './People.tsx';
import type { Component, FieldDef, NextPeriod, PayInput } from './types.ts';

/** The entity a set-up page works on: the shell's choice, or the first one. */
/** The entity of a set-up page: a picker in the header, on a phone at the top of the page instead (the header keeps its title). */
export function useEntity(query: URLSearchParams): { id: string; set: (id: string) => void; picker: React.ReactNode; phonePicker: React.ReactNode; currency: string; country: string } {
  const me = useMe();
  const { entity } = useUi();
  const id = query.get('entity') ?? (entity !== '' ? entity : me.entities[0]?.id ?? '');
  const ent = me.entities.find((e) => e.id === id);
  const pick = (cls: string): React.ReactNode => <Picker value={id} onChange={(v) => setQuery({ entity: v === '' ? undefined : v })} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country }))} label={t('payroll.entity')} className={cls} />;
  const many = me.entities.length > 1;
  const picker = many ? <span className="hidden sm:inline-flex">{pick('w-[220px]')}</span> : null;
  const phonePicker = many ? <div className="mb-3 sm:hidden">{pick('w-full')}</div> : null;
  return { id, set: (v) => setQuery({ entity: v }), picker, phonePicker, currency: ent?.currency ?? '', country: ent?.country ?? '' };
}

/* ------------------------------------------------------------ schedules */

interface Schedule {
  id: string;
  entity: string;
  entity_name: string;
  name: string;
  frequency: string;
  period_anchor: string;
  pay_day_rule: { kind?: string; day?: number; offset_days?: number; adjust?: string };
  cutoff_days: number;
  currency: string;
  active: boolean;
  reminder_days: number[];
  is_default: boolean;
  people: number;
  next: NextPeriod;
}

interface CalPeriod {
  period_start: string;
  period_end: string;
  pay_date: string;
  planned_pay_date: string;
  pay_date_moved: boolean;
  moved_because: string;
  cutoff_day: string;
  run: { id: string; number: string; status: string; net_minor: number } | null;
}

function ScheduleDialog({ open, onClose, entity, sched }: { open: boolean; onClose: () => void; entity: string; sched: Schedule | null }): React.JSX.Element {
  const [name, setName] = useState('');
  const [freq, setFreq] = useState('monthly');
  const [anchor, setAnchor] = useState('');
  const [rule, setRule] = useState<'period_end' | 'day_of_month'>('period_end');
  const [day, setDay] = useState('25');
  const [adjust, setAdjust] = useState('before');
  const [cutoff, setCutoff] = useState('5');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(sched?.name ?? t('payroll.sched.monthly'));
    setFreq(sched?.frequency ?? 'monthly');
    setAnchor(sched?.period_anchor ?? '');
    setRule(sched?.pay_day_rule.kind === 'day_of_month' ? 'day_of_month' : 'period_end');
    setDay(String(sched?.pay_day_rule.day ?? 25));
    setAdjust(sched?.pay_day_rule.adjust ?? 'before');
    setCutoff(String(sched?.cutoff_days ?? 5));
  }, [open, sched]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('pay-schedules.save', { schedule: sched?.id, entity: sched ? undefined : entity, name, frequency: freq, period_anchor: anchor === '' ? undefined : anchor, pay_day_rule: rule === 'day_of_month' ? { kind: 'day_of_month', day: Number(day), adjust } : { kind: 'period_end', offset_days: 0, adjust }, cutoff_days: Number(cutoff) });
      toast.success(t('ui.saved'));
      changed('pay_schedules');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={sched ? t('payroll.sched.edit') : t('payroll.act.add_schedule')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>{t('ui.save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('payroll.sched.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('payroll.sched.frequency')}>
          <Segmented value={freq} onChange={setFreq} label={t('payroll.sched.frequency')} size="sm" options={['monthly', 'semi_monthly', 'biweekly', 'weekly'].map((f) => ({ value: f, label: t('payroll.freq.' + f) }))} />
        </Field>
        <Field label={t('payroll.sched.anchor')} optional hint={t('payroll.sched.anchor_hint')}>
          <DayPicker value={anchor} onChange={setAnchor} label={t('payroll.sched.anchor')} clearable />
        </Field>
        <Field label={t('payroll.sched.pay_day')}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={rule} onChange={setRule} label={t('payroll.sched.pay_day')} size="sm" options={[{ value: 'period_end', label: t('payroll.sched.last_day') }, ...(freq === 'monthly' ? [{ value: 'day_of_month' as const, label: t('payroll.sched.day_of_month') }] : [])]} />
            {rule === 'day_of_month' && <Input className="hr-mono w-[70px]" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))} aria-label={t('payroll.sched.day_of_month')} />}
          </div>
        </Field>
        <Field label={t('payroll.sched.adjust')}>
          <Segmented value={adjust} onChange={setAdjust} label={t('payroll.sched.adjust')} size="sm" options={['before', 'after', 'none'].map((a) => ({ value: a, label: t('payroll.adjust.' + a) }))} />
        </Field>
        <Field label={t('payroll.sched.cutoff')}>
          <Input className="hr-mono w-[90px]" inputMode="numeric" value={cutoff} onChange={(e) => setCutoff(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
    </Dialog>
  );
}

export function SchedulesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ent = useEntity(query);
  const live = useOp<{ schedules: Schedule[] }>('pay-schedules.list', { entity: ent.id === '' ? undefined : ent.id }, ['pay_schedules', 'payruns'], { name: 'payroll.schedules' });
  const list = live.data?.schedules ?? null;
  const selId = query.get('schedule') ?? list?.[0]?.id ?? '';
  const sel = list?.find((s) => s.id === selId) ?? null;
  const [year, setYear] = useState(me.today.slice(0, 4));
  const cal = useOp<{ periods: CalPeriod[] }>('pay-schedules.calendar', { schedule: selId, year }, ['pay_schedules', 'payruns', 'holidays'], { skip: selId === '' });
  const [edit, setEdit] = useState<Schedule | null | 'new'>(null);
  const full = can(me, 'payroll', 'full');
  return (
    <>
      <PageHeader title={t('payroll.schedules')} meta={list ? tn('payroll.n_schedules', list.length) : ''}>
        {ent.picker}
        {full && <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>{t('payroll.act.add_schedule')}</Button>}
      </PageHeader>
      <PageBody>
        {ent.phonePicker}
        {list === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : list.length === 0 ? (
          <Empty icon={CalendarClock} title={t('payroll.empty.no_schedules')} action={full ? <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>{t('payroll.act.add_schedule')}</Button> : undefined} />
        ) : (
          // A narrow list of schedules (as on Templates), the year's calendar takes the rest; stacked on phones.
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2 self-start">
              {list.map((s) => (
                <button key={s.id} type="button" onClick={() => setQuery({ schedule: s.id })} className={'hr-panel cursor-pointer px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--hr-hover)] ' + (s.id === selId ? 'outline outline-1 outline-[var(--hr-ink)]' : '')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                    {s.is_default && <Tag>{t('payroll.default')}</Tag>}
                  </div>
                  <div className="hr-mono mt-0.5 text-[10.5px] text-[var(--hr-faint)]">{t('payroll.freq.' + s.frequency) + ' · ' + tn('payroll.n_people', s.people) + ' · ' + t('payroll.next_pay', { day: fmtDay(s.next.pay_date) })}</div>
                </button>
              ))}
            </div>
            {sel && (
              <Panel index="01" label={sel.name + ' · ' + year} aside={<span className="flex items-center gap-2"><Segmented value={year} onChange={setYear} label={t('payroll.year')} size="sm" options={[String(Number(me.today.slice(0, 4)) - 1), me.today.slice(0, 4), String(Number(me.today.slice(0, 4)) + 1)].map((y) => ({ value: y, label: y }))} />{full && <Button size="sm" variant="ghost" icon={Settings2} onClick={() => setEdit(sel)}>{t('ui.edit')}</Button>}</span>} flush>
                {cal.data === null ? (
                  <Loading />
                ) : (
                  <div className="divide-y divide-[var(--hr-hair)]">
                    {cal.data.periods.map((p) => (
                      <div key={p.period_start} className={'grid min-h-10 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_112px] items-center gap-3 px-4 py-2 text-[13px] ' + (p.period_end < me.today ? 'text-[var(--hr-muted)]' : '')}>
                        <span className="min-w-0 truncate">{periodLabel(p.period_start, p.period_end)}</span>
                        <span className="hr-mono" title={p.pay_date_moved ? t('payroll.moved_because', { why: p.moved_because, day: fmtDay(p.planned_pay_date) }) : undefined}>
                          {fmtDay(p.pay_date)}
                          {p.pay_date_moved && <span className="ml-1 text-[var(--hr-warn)]">*</span>}
                        </span>
                        <span className="hr-mono text-[var(--hr-faint)]">{t('payroll.cutoff_short', { day: fmtDay(p.cutoff_day) })}</span>
                        <span className="justify-self-end">{p.run ? <a href={'#/payroll/runs/' + p.run.id} className="cursor-pointer"><RunStatus status={p.run.status} /></a> : null}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </div>
        )}
      </PageBody>
      <ScheduleDialog open={edit !== null} onClose={() => setEdit(null)} entity={ent.id} sched={edit === 'new' ? null : edit} />
    </>
  );
}

/* ---------------------------------------------------------- components */

function ComponentSheet({ c, entity, onClose }: { c: Component | 'new' | null; entity: string; onClose: () => void }): React.JSX.Element {
  const [f, setF] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c === null) return;
    setF(c === 'new' ? { kind: 'earning', calc: 'input', role: 'other', tags: '' } : { ...c, tags: c.tags.join(', ') });
  }, [c]);
  if (c === null) return <></>;
  const set = (k: string, v: unknown): void => setF((x) => ({ ...x, [k]: v }));
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('components.save', {
        component: c === 'new' ? undefined : c.id,
        entity: c === 'new' ? entity : undefined,
        code: f['code'],
        name: f['name'],
        kind: f['kind'],
        stage: f['kind'] === 'deduction' ? f['stage'] ?? 'post' : undefined,
        calc: f['calc'],
        role: f['role'],
        multiplier: f['multiplier'] ?? undefined,
        tags: String(f['tags'] ?? '').split(',').map((x) => x.trim()).filter((x) => x !== ''),
        prorate: f['prorate'] === true,
        gl_account: f['gl_account'] ?? '',
        liability_account: f['liability_account'] ?? '',
        archived: f['archived'] === true,
      });
      toast.success(t('ui.saved'));
      changed('pay_components');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} label={t('payroll.components')} width={480}>
      <SheetHeader title={c === 'new' ? t('payroll.act.add_component') : c.name} meta={c === 'new' ? '' : c.code + (c.pack !== '' ? ' · ' + c.pack : '')} onClose={onClose} />
      <div className="hr-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field label={t('payroll.comp_f.code')}>
          <Input className="hr-mono" value={String(f['code'] ?? '')} onChange={(e) => set('code', e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('payroll.comp_f.name')}>
          <Input value={String(f['name'] ?? '')} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('payroll.col.kind')}>
          <Select value={String(f['kind'] ?? 'earning')} onChange={(e) => set('kind', e.target.value)}>
            {['earning', 'deduction', 'employer', 'reimbursement', 'info'].map((k) => <option key={k} value={k}>{t('payroll.ckind.' + k)}</option>)}
          </Select>
        </Field>
        {f['kind'] === 'deduction' && (
          <Field label={t('payroll.comp_f.stage')}>
            <Segmented value={String(f['stage'] ?? 'post')} onChange={(v) => set('stage', v)} label={t('payroll.comp_f.stage')} size="sm" options={['pre', 'statutory', 'post'].map((s) => ({ value: s, label: t('payroll.stage.' + s) }))} />
          </Field>
        )}
        <Field label={t('payroll.comp_f.role')} help={t('payroll.comp_f.role_help')}>
          <Select value={String(f['role'] ?? 'other')} onChange={(e) => set('role', e.target.value)}>
            {['basic', 'hourly', 'daily', 'overtime', 'unpaid', 'allowance', 'bonus', 'commission', 'reimbursement', 'advance', 'advance_payout', 'loan', 'arrears', 'encash', 'exit_leave', 'gratuity', 'notice', 'benefit', 'rounding', 'other'].map((k) => <option key={k} value={k}>{t('payroll.role.' + k)}</option>)}
          </Select>
        </Field>
        <Field label={t('payroll.comp_f.calc')}>
          <Select value={String(f['calc'] ?? 'input')} onChange={(e) => set('calc', e.target.value)}>
            {['fixed', 'percent', 'hours', 'days', 'input', 'pack'].map((k) => <option key={k} value={k}>{t('payroll.calc.' + k)}</option>)}
          </Select>
        </Field>
        {f['role'] === 'overtime' && (
          <Field label={t('payroll.comp_f.multiplier')}>
            <Input className="hr-mono w-[100px]" value={String(f['multiplier'] ?? '')} onChange={(e) => set('multiplier', e.target.value)} />
          </Field>
        )}
        <Field label={t('payroll.comp_f.tags')} help={t('payroll.comp_f.tags_help')}>
          <Input className="hr-mono" value={String(f['tags'] ?? '')} onChange={(e) => set('tags', e.target.value)} />
        </Field>
        <Row label={t('payroll.comp_f.prorate')} hint={t('payroll.comp_f.prorate_hint')}>
          <Toggle checked={f['prorate'] === true} onChange={(v) => set('prorate', v)} label={t('payroll.comp_f.prorate')} />
        </Row>
        <Field label={t('payroll.comp_f.gl')} optional>
          <Input className="hr-mono" value={String(f['gl_account'] ?? '')} onChange={(e) => set('gl_account', e.target.value)} />
        </Field>
        <Field label={t('payroll.comp_f.liability')} optional>
          <Input className="hr-mono" value={String(f['liability_account'] ?? '')} onChange={(e) => set('liability_account', e.target.value)} />
        </Field>
        {c !== 'new' && (
          <Row label={t('payroll.comp_f.archived')} hint={t('payroll.comp_f.archived_hint')}>
            <Toggle checked={f['archived'] === true} onChange={(v) => set('archived', v)} label={t('payroll.comp_f.archived')} />
          </Row>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--hr-line)] px-4 py-3">
        <Button onClick={onClose}>{t('ui.cancel')}</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>{t('ui.save')}</Button>
      </div>
    </Sheet>
  );
}

export function ComponentsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ent = useEntity(query);
  const live = useOp<{ components: Component[] }>('components.list', { entity: ent.id === '' ? undefined : ent.id, archived: true }, ['pay_components'], { name: 'payroll.components' });
  const [sel, setSel] = useState<Component | 'new' | null>(null);
  const [kind, setKind] = useState('all');
  const full = can(me, 'payroll', 'full');
  const rows = (live.data?.components ?? []).filter((c) => kind === 'all' || c.kind === kind);
  const cols: Column<Component>[] = [
    { key: 'name', label: t('payroll.col.component'), width: 'minmax(200px,2fr)', phone: 'title', sort: (r) => r.name, render: (r) => (<span className={'hr-wrap min-w-0 ' + (r.archived ? 'text-[var(--hr-faint)]' : '')}>{r.name} <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{r.code}</span></span>) },
    { key: 'kind', label: t('payroll.col.kind'), width: '150px', sort: (r) => r.kind, render: (r) => t('payroll.ckind.' + r.kind) + (r.stage !== '' ? ' · ' + t('payroll.stage.' + r.stage) : '') },
    { key: 'role', label: t('payroll.comp_f.role'), width: '130px', hideBelow: 'lg', sort: (r) => r.role, render: (r) => t('payroll.role.' + (r.role || 'other')) },
    { key: 'tags', label: t('payroll.comp_f.tags'), width: 'minmax(160px,1.4fr)', hideBelow: 'xl', render: (r) => (r.tags.length === 0 ? <span className="text-[12px] text-[var(--hr-faint)]">{t('payroll.tags_none')}</span> : <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">{tn('payroll.n_tags', r.tags.length)}<Hint text={t('payroll.tags_read', { tags: r.tags.join(', ') })} /></span>) },
    { key: 'source', label: t('payroll.comp_f.source'), width: '130px', hideBelow: 'lg', phone: 'end', render: (r) => (r.pack !== '' ? <Tag title={r.pack}>{t('payroll.src.from_pack')}</Tag> : <span className="text-[12px] text-[var(--hr-faint)]">{t('payroll.src.' + r.source)}</span>) },
  ];
  return (
    <>
      <PageHeader title={t('payroll.components')} meta={tn('payroll.n_components', rows.length)}>
        {ent.picker}
        {full && <Button variant="primary" icon={Plus} onClick={() => setSel('new')}>{t('payroll.act.add_component')}</Button>}
      </PageHeader>
      <PageBody>
        {ent.phonePicker}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2">
            <div className="hidden sm:block">
              <Segmented value={kind} onChange={setKind} size="sm" label={t('payroll.col.kind')} options={['all', 'earning', 'deduction', 'employer', 'reimbursement', 'info'].map((k) => ({ value: k, label: k === 'all' ? t('payroll.show_all') : t('payroll.ckind.' + k) }))} />
            </div>
            <Select className="sm:hidden" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('payroll.col.kind')}>
              {['all', 'earning', 'deduction', 'employer', 'reimbursement', 'info'].map((k) => (
                <option key={k} value={k}>{k === 'all' ? t('payroll.show_all') : t('payroll.ckind.' + k)}</option>
              ))}
            </Select>
          </div>
          {live.data === null ? <Loading /> : <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={full ? (r) => setSel(r) : undefined} label={t('payroll.components')} empty={<Empty icon={Layers} title={t('payroll.empty.no_components')} action={full ? <Button onClick={() => void op('components.seed', { entity: ent.id }).then(() => changed('pay_components'))}>{t('payroll.act.seed_components')}</Button> : undefined} />} />}
        </div>
      </PageBody>
      <ComponentSheet c={sel} entity={ent.id} onClose={() => setSel(null)} />
    </>
  );
}

/* ----------------------------------------------------------- pay items */

type ItemsTab = 'inputs' | 'recurring' | 'import' | 'holds' | 'benefits';

interface Recurring {
  id: string;
  employment: string;
  employee_name: string;
  employee_number: string;
  component_code: string;
  component_name: string;
  kind: string;
  amount_minor: number;
  percent: number;
  currency: string;
  from_day: string;
  to_day: string;
  note: string;
  state: string;
  used: boolean;
}
interface Hold {
  id: string;
  employee_name: string;
  payrun: string;
  payrun_number: string;
  amount_minor: number;
  currency: string;
  reason: string;
  status: string;
  released_payrun_number: string;
}
interface Plan {
  id: string;
  name: string;
  kind: string;
  employee_component_code: string;
  employer_component_code: string;
  amount_minor: number;
  employer_amount_minor: number;
  percent: number;
  employer_percent: number;
  currency: string;
  active: boolean;
  enrolled: number;
}

function AddInputDialog({ open, onClose, entity, currency }: { open: boolean; onClose: () => void; entity: string; currency: string }): React.JSX.Element {
  const people = usePeopleOptions(entity);
  const comps = useOp<{ components: Component[] }>('components.list', { entity: entity === '' ? undefined : entity }, ['pay_components'], { skip: !open });
  const [who, setWho] = useState('');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (recurring) await op('recurring.save', { employment: who, component: code, amount: majorParam(amount, currency), note });
      else await op('pay-inputs.add', { employment: who, component: code, amount: majorParam(amount, currency), note });
      toast.success(t('payroll.toast.input_added'));
      changed('pay_inputs', 'recurring_items');
      setAmount(null);
      setNote('');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const items = (comps.data?.components ?? []).filter((c) => !c.archived && c.calc !== 'pack').map((c) => ({ value: c.code, label: c.name, sub: c.code + ' · ' + t('payroll.ckind.' + c.kind) }));
  return (
    <Dialog open={open} onClose={onClose} title={t('payroll.act.add_input')} footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} disabled={who === '' || code === '' || amount === null} onClick={() => void save()}>{t('ui.add')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('payroll.col.person')}>
          <Picker value={who} onChange={setWho} items={people} label={t('payroll.col.person')} />
        </Field>
        <Field label={t('payroll.col.component')}>
          <Picker value={code} onChange={setCode} items={items} label={t('payroll.col.component')} />
        </Field>
        <Field label={t('payroll.amount')}>
          <MoneyInput value={amount} onChange={setAmount} currency={currency} label={t('payroll.amount')} />
        </Field>
        <Row label={t('payroll.items.every_period')} hint={t('payroll.items.every_period_hint')}>
          <Toggle checked={recurring} onChange={setRecurring} label={t('payroll.items.every_period')} />
        </Row>
        <Field label={t('payroll.note')} optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function ImportPanel(): React.JSX.Element {
  const [csv, setCsv] = useState('employee,component,amount,note\n');
  const [check, setCheck] = useState<{ rows: { row: number; employee: string; name: string; component: string; total_minor: number; currency: string }[]; problems: { row: number; message: string }[]; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (commit: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (commit) {
        const r = await op<{ added: number }>('pay-inputs.import', { csv });
        toast.success(tn('payroll.toast.imported', r.added));
        setCheck(null);
        changed('pay_inputs');
      } else setCheck(await op('pay-inputs.import-check', { csv }));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel index="01" label={t('payroll.import.csv')}>
        <Textarea value={csv} onChange={(e) => { setCsv(e.target.value); setCheck(null); }} minRows={8} className="hr-mono text-[12px]" />
        <div className="mt-2 flex justify-end gap-2">
          <Button icon={FileUp} busy={busy} onClick={() => void run(false)}>{t('payroll.act.check_csv')}</Button>
          <Button variant="primary" icon={Upload} busy={busy} disabled={check === null || !check.ok} onClick={() => void run(true)}>{t('payroll.act.import')}</Button>
        </div>
      </Panel>
      <Panel index="02" label={t('payroll.import.result')}>
        {check === null ? (
          <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.import.columns')}</div>
        ) : (
          <div className="flex flex-col gap-1 text-[13px]">
            {check.problems.map((p, i) => <Notice key={i} tone="bad">{t('payroll.import.row', { row: p.row }) + ': ' + p.message}</Notice>)}
            {check.rows.map((r) => (
              <div key={r.row} className="flex items-center gap-2">
                <StatusDot tone="good" />
                <span className="min-w-0 flex-1 truncate">{r.name} · <span className="hr-mono">{r.component}</span></span>
                <Money minor={r.total_minor} currency={r.currency} className="hr-mono" />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function ItemsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ent = useEntity(query);
  const tab = (query.get('tab') as ItemsTab | null) ?? 'inputs';
  const [st, setSt] = useState('open');
  const inputs = useOp<{ inputs: PayInput[]; total: number }>('pay-inputs.list', { status: st, limit: 500 }, ['pay_inputs'], { skip: tab !== 'inputs', name: 'payroll.inputs' });
  const rec = useOp<{ items: Recurring[] }>('recurring.list', {}, ['recurring_items'], { skip: tab !== 'recurring', name: 'payroll.recurring' });
  const holds = useOp<{ holds: Hold[] }>('holds.list', { status: 'all' }, ['salary_holds'], { skip: tab !== 'holds' });
  const plans = useOp<{ plans: Plan[] }>('benefits.plans', { entity: ent.id === '' ? undefined : ent.id }, ['benefit_plans', 'benefit_enrollments'], { skip: tab !== 'benefits' });
  const [add, setAdd] = useState(false);
  const edit = can(me, 'payroll', 'edit');
  const inCols: Column<PayInput>[] = [
    { key: 'who', label: t('payroll.col.person'), width: 'minmax(170px,1.6fr)', phone: 'title', sort: (r) => r.employee_name, render: (r) => (<span className="min-w-0 truncate">{r.employee_name} <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{r.employee_number}</span></span>) },
    { key: 'comp', label: t('payroll.col.component'), width: 'minmax(140px,1.3fr)', sort: (r) => r.component_name, render: (r) => r.component_name },
    { key: 'period', label: t('payroll.col.period'), width: 'minmax(150px,1.2fr)', hideBelow: 'lg', render: (r) => periodLabel(r.period_start, r.period_end) },
    { key: 'amount', label: t('payroll.amount'), width: '130px', align: 'right', mono: true, phone: 'end', sort: (r) => r.total_minor, render: (r) => <Money minor={r.total_minor} currency={r.currency} /> },
    { key: 'src', label: t('payroll.col.source'), width: '110px', hideBelow: 'xl', render: (r) => t('payroll.input_src.' + r.source) },
    { key: 'st', label: t('payroll.col.status'), width: '120px', render: (r) => (r.payrun_number !== '' ? <a className="cursor-pointer underline" href={'#/payroll/runs/' + r.payrun}>{r.payrun_number}</a> : <StatusDot tone={r.status === 'open' ? 'rh' : 'faint'} label={t('payroll.input_status.' + r.status)} />) },
  ];
  const recCols: Column<Recurring>[] = [
    { key: 'who', label: t('payroll.col.person'), width: 'minmax(170px,1.6fr)', phone: 'title', render: (r) => r.employee_name },
    { key: 'comp', label: t('payroll.col.component'), width: 'minmax(140px,1.3fr)', render: (r) => r.component_name },
    { key: 'amount', label: t('payroll.amount'), width: '130px', align: 'right', mono: true, phone: 'end', render: (r) => (r.percent !== 0 ? r.percent + '%' : <Money minor={r.amount_minor} currency={r.currency} />) },
    { key: 'days', label: t('payroll.col.days'), width: 'minmax(150px,1.2fr)', hideBelow: 'lg', render: (r) => fmtDay(r.from_day) + (r.to_day !== '' ? ' to ' + fmtDay(r.to_day) : '') },
    { key: 'state', label: t('payroll.col.status'), width: '110px', render: (r) => <StatusDot tone={r.state === 'current' ? 'good' : r.state === 'scheduled' ? 'rh' : 'faint'} label={t('payroll.state.' + r.state)} /> },
  ];
  return (
    <>
      <PageHeader title={t('payroll.items')}>
        {ent.picker}
        {edit && <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>{t('payroll.act.add_input')}</Button>}
      </PageHeader>
      <PageBody>
        {ent.phonePicker}
        <Tabs value={tab} onChange={(v) => setQuery({ tab: v === 'inputs' ? undefined : v })} label={t('payroll.items')} className="mb-3" tabs={[{ value: 'inputs', label: t('payroll.items.inputs') }, { value: 'recurring', label: t('payroll.items.recurring') }, { value: 'import', label: t('payroll.items.import') }, { value: 'holds', label: t('payroll.items.holds') }, { value: 'benefits', label: t('payroll.items.benefits') }]} />
        {tab === 'inputs' && (
          <div className="hr-panel hr-in min-w-0">
            <div className="flex items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2">
              <Segmented value={st} onChange={setSt} size="sm" label={t('payroll.col.status')} options={['open', 'used', 'void', 'all'].map((s) => ({ value: s, label: t('payroll.input_status.' + s) }))} />
            </div>
            {inputs.data === null ? <Loading /> : <DataTable columns={inCols} rows={inputs.data.inputs} rowKey={(r) => r.id} label={t('payroll.items.inputs')} empty={<Empty icon={Plus} title={t('payroll.empty.no_inputs')} action={edit ? <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>{t('payroll.act.add_input')}</Button> : undefined} />} />}
          </div>
        )}
        {tab === 'recurring' && <div className="hr-panel hr-in min-w-0">{rec.data === null ? <Loading /> : <DataTable columns={recCols} rows={rec.data.items} rowKey={(r) => r.id} label={t('payroll.items.recurring')} empty={<Empty icon={Plus} title={t('payroll.empty.no_recurring')} />} />}</div>}
        {tab === 'import' && <ImportPanel />}
        {tab === 'holds' && (
          <div className="hr-panel hr-in min-w-0">
            {holds.data === null ? <Loading /> : holds.data.holds.length === 0 ? <Empty icon={Hand} title={t('payroll.empty.no_holds')} /> : (
              <div className="divide-y divide-[var(--hr-hair)]">
                {holds.data.holds.map((h) => (
                  <div key={h.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_120px_180px_96px]">
                    <span className="min-w-0">
                      <span className="block truncate">{h.employee_name}</span>
                      <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{h.payrun_number + ' · ' + h.reason}</span>
                    </span>
                    <Money minor={h.amount_minor} currency={h.currency} className="hr-mono text-right" />
                    <StatusDot tone={h.status === 'held' ? 'warn' : 'faint'} label={t('payroll.hold_status.' + h.status) + (h.released_payrun_number !== '' ? ' · ' + h.released_payrun_number : '')} />
                    <span className="flex justify-end">{h.status === 'held' && can(me, 'payroll', 'full') && <ReleaseButton hold={h} />}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'benefits' && <BenefitsPanel plans={plans.data?.plans ?? null} entity={ent.id} currency={ent.currency} />}
      </PageBody>
      <AddInputDialog open={add} onClose={() => setAdd(false)} entity={ent.id} currency={ent.currency} />
    </>
  );
}

function ReleaseButton({ hold }: { hold: Hold }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState('');
  const [pin, setPin] = useState('');
  const runs = useOp<{ payruns: { id: string; number: string; label: string; status: string }[] }>('payruns.list', { status: 'open', limit: 50 }, ['payruns'], { skip: !open });
  const release = async (via: 'payrun' | 'outside'): Promise<void> => {
    try {
      await op('holds.release', { hold: hold.id, via, into: via === 'payrun' ? into : undefined, pin: pin });
      toast.success(t('payroll.toast.released'));
      changed('salary_holds');
      setOpen(false);
      setPin('');
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{t('payroll.act.release')}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('payroll.hold.release_title', { name: hold.employee_name })} footer={<><Button disabled={pin.length !== 6} onClick={() => void release('outside')}>{t('payroll.hold.paid_outside')}</Button><Button variant="primary" disabled={into === '' || pin.length !== 6} onClick={() => void release('payrun')}>{t('payroll.act.release')}</Button></>}>
        <Field label={t('payroll.hold.into')}>
          <Picker value={into} onChange={setInto} items={(runs.data?.payruns ?? []).map((r) => ({ value: r.id, label: r.label !== '' ? r.label : r.number, sub: r.number }))} label={t('payroll.hold.into')} />
        </Field>
        <Field label={t('payroll.pin_label')} className="mt-3">
          <PinBoxes value={pin} onChange={setPin} label={t('payroll.pin_label')} align="start" />
        </Field>
      </Dialog>
    </>
  );
}

function BenefitsPanel({ plans, entity, currency }: { plans: Plan[] | null; entity: string; currency: string }): React.JSX.Element {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('health');
  const [ee, setEe] = useState('');
  const [er, setEr] = useState('');
  const [eeAmt, setEeAmt] = useState<number | null>(null);
  const [erAmt, setErAmt] = useState<number | null>(null);
  const comps = useOp<{ components: Component[] }>('components.list', { entity: entity === '' ? undefined : entity }, ['pay_components'], { skip: !open });
  const save = async (): Promise<void> => {
    try {
      await op('benefits.plan-save', { entity, name, kind, employee_component: ee === '' ? undefined : ee, employer_component: er === '' ? undefined : er, amount: majorParam(eeAmt, currency), employer_amount: majorParam(erAmt, currency) });
      changed('benefit_plans');
      setOpen(false);
    } catch {
      /* toast shown */
    }
  };
  const ded = (comps.data?.components ?? []).filter((c) => c.kind === 'deduction').map((c) => ({ value: c.code, label: c.name, sub: c.code }));
  const emp = (comps.data?.components ?? []).filter((c) => c.kind === 'employer').map((c) => ({ value: c.code, label: c.name, sub: c.code }));
  return (
    <div className="hr-panel hr-in min-w-0">
      {can(me, 'payroll', 'full') && (
        <div className="flex justify-end border-b border-[var(--hr-line)] px-4 py-2">
          <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>{t('payroll.act.add_plan')}</Button>
        </div>
      )}
      {plans === null ? <Loading /> : plans.length === 0 ? <Empty icon={Layers} title={t('payroll.empty.no_plans')} /> : (
        <div className="divide-y divide-[var(--hr-hair)]">
          {plans.map((p) => (
            <div key={p.id} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_160px_120px_96px]">
              <span className="min-w-0 truncate">{p.name} <span className="text-[12px] text-[var(--hr-faint)]">{t('payroll.plan_kind.' + p.kind)}</span></span>
              <span className="hr-mono hidden truncate text-[10.5px] text-[var(--hr-muted)] sm:block">{[p.employee_component_code, p.employer_component_code].filter((x) => x !== '').join(' + ')}</span>
              <Money minor={p.amount_minor} currency={p.currency} className="hr-mono text-right" />
              <span className="hidden text-right text-[12px] text-[var(--hr-faint)] sm:block">{tn('payroll.n_enrolled', p.enrolled)}</span>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('payroll.act.add_plan')} footer={<><Button onClick={() => setOpen(false)}>{t('ui.cancel')}</Button><Button variant="primary" disabled={name.trim() === '' || (ee === '' && er === '')} onClick={() => void save()}>{t('ui.save')}</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label={t('payroll.plan.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('payroll.col.kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>{['health', 'dental', 'vision', 'life', 'retirement', 'transport', 'meal', 'wellness', 'other'].map((k) => <option key={k} value={k}>{t('payroll.plan_kind.' + k)}</option>)}</Select>
          </Field>
          <Field label={t('payroll.plan.employee_component')} optional><Picker value={ee} onChange={setEe} items={ded} label={t('payroll.plan.employee_component')} clearable /></Field>
          <Field label={t('payroll.plan.employee_amount')} optional><MoneyInput value={eeAmt} onChange={setEeAmt} currency={currency} label={t('payroll.plan.employee_amount')} /></Field>
          <Field label={t('payroll.plan.employer_component')} optional><Picker value={er} onChange={setEr} items={emp} label={t('payroll.plan.employer_component')} clearable /></Field>
          <Field label={t('payroll.plan.employer_amount')} optional><MoneyInput value={erAmt} onChange={setErAmt} currency={currency} label={t('payroll.plan.employer_amount')} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------ settings */

interface SettingsGet {
  settings: Record<string, unknown> & { entity_name: string; country: string; currency: string; entity_fields: Record<string, unknown>; approver_steps: { type: string; role?: string }[] };
  entity_fields: FieldDef[];
  missing_fields: string[];
  packs: string[];
}

export function SettingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ent = useEntity(query);
  const live = useOp<SettingsGet>('payroll.settings', { entity: ent.id }, ['payroll_settings', 'approval_flows'], { skip: ent.id === '' });
  const d = live.data;
  const [s, setS] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d === null) return;
    setS({ ...d.settings });
    setFields({ ...d.settings.entity_fields });
  }, [d]);
  const full = can(me, 'payroll', 'full');
  const approver = useMemo(() => {
    const steps = (s['approver_steps'] as { type: string; role?: string }[] | undefined) ?? [];
    return steps.length === 0 ? 'default' : steps[0]?.type === 'role' ? 'role:' + (steps[0].role ?? '') : steps[0]?.type ?? 'default';
  }, [s]);
  if (d === null)
    return (
      <>
        <PageHeader title={t('payroll.settings')}>{ent.picker}</PageHeader>
        <PageBody>
        {ent.phonePicker}{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const set = (k: string, v: unknown): void => setS((x) => ({ ...x, [k]: v }));
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const keys = ['proration', 'net_rounding', 'pay_method', 'variance_pct', 'require_approved_time', 'require_approved_leave', 'bank_lead_days', 'bank_changed_days', 'go_live_day', 'publish', 'publish_hour', 'payslip_show_ytd', 'email_payslips', 'warnings_need_ack'];
      const params: Record<string, unknown> = { entity: ent.id };
      for (const k of keys) if (JSON.stringify(s[k]) !== JSON.stringify((d.settings as Record<string, unknown>)[k])) params[k] = s[k];
      const fd = changedFields(d.settings.entity_fields, fields);
      if (Object.keys(fd).length > 0) params['entity_fields'] = fd;
      if (approver !== ((d.settings.approver_steps ?? []).length === 0 ? 'default' : '')) {
        /* approver chosen below */
      }
      await op('payroll.settings-save', params);
      toast.success(t('ui.saved'));
      changed('payroll_settings');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const setApprover = async (v: string): Promise<void> => {
    const steps = v === 'default' ? [] : v.indexOf('role:') === 0 ? [{ type: 'role', role: v.slice(5) }] : [{ type: v }];
    try {
      await op('payroll.settings-save', { entity: ent.id, approver_steps: steps });
      changed('payroll_settings', 'approval_flows');
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={t('payroll.settings')} meta={d.settings.entity_name + ' · ' + d.settings.country + ' · ' + d.settings.currency}>
        {ent.picker}
        {full && <Button variant="primary" busy={busy} onClick={() => void save()}>{t('ui.save')}</Button>}
      </PageHeader>
      <PageBody>
        {ent.phonePicker}
        <div className="hr-in grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel index="01" label={t('payroll.set.pay')}>
            <div className="flex flex-col gap-1">
              <Row label={t('payroll.set.proration')} hint={t('payroll.set.proration_hint')}>
                <span className="hidden sm:inline-flex">
                  <Segmented value={String(s['proration'] ?? 'working_days')} onChange={(v) => set('proration', v)} label={t('payroll.set.proration')} size="sm" options={['calendar_days', 'working_days', 'fixed_30'].map((x) => ({ value: x, label: t('payroll.proration.' + x) }))} />
                </span>
                <Select className="sm:hidden" value={String(s['proration'] ?? 'working_days')} onChange={(e) => set('proration', e.target.value)} aria-label={t('payroll.set.proration')}>
                  {['calendar_days', 'working_days', 'fixed_30'].map((x) => <option key={x} value={x}>{t('payroll.proration.' + x)}</option>)}
                </Select>
              </Row>
              <Row label={<span className="inline-flex items-center gap-1.5">{t('payroll.set.net_rounding')}<Hint text={t('payroll.gloss.net_pay')} /></span>}>
                <Select value={String(s['net_rounding'] ?? 'none')} onChange={(e) => set('net_rounding', e.target.value)}>{['none', '0.05', '0.1', '1', '5', '10', '100'].map((x) => <option key={x} value={x}>{x === 'none' ? t('payroll.set.no_rounding') : x}</option>)}</Select>
              </Row>
              <Row label={t('payroll.set.pay_method')}>
                <Segmented value={String(s['pay_method'] ?? 'bank')} onChange={(v) => set('pay_method', v)} label={t('payroll.set.pay_method')} size="sm" options={['bank', 'cash', 'cheque'].map((x) => ({ value: x, label: t('payroll.method.' + x) }))} />
              </Row>
              <Row
                label={t('payroll.set.go_live')}
                hint={
                  <>
                    {t('payroll.set.go_live_hint')}{' '}
                    <a href={'#/payroll/openings?entity=' + ent.id} className="hit cursor-pointer underline underline-offset-2 hover:text-[var(--hr-ink)]">
                      {s['no_earlier_pay'] === true ? t('payroll.set.go_live_none_paid') : t('payroll.set.go_live_open')}
                    </a>
                  </>
                }
              >
                <DayPicker value={String(s['go_live_day'] ?? '')} onChange={(v) => set('go_live_day', v)} label={t('payroll.set.go_live')} clearable />
              </Row>
            </div>
          </Panel>
          <Panel index="02" label={t('payroll.set.checks')}>
            <div className="flex flex-col gap-1">
              <Row label={t('payroll.set.approver')}>
                <Select value={approver} onChange={(e) => void setApprover(e.target.value)}>
                  {['default', 'role:finance', 'role:owner', 'role:payroll_admin', 'manager'].map((x) => <option key={x} value={x}>{t('payroll.approver.' + x.replace(':', '_'))}</option>)}
                </Select>
              </Row>
              <Row label={<span className="inline-flex items-center gap-1.5">{t('payroll.set.variance')}<Hint text={t('payroll.gloss.variance')} /></span>}>
                <Input className="hr-mono w-[80px]" value={String(s['variance_pct'] ?? 10)} onChange={(e) => set('variance_pct', Number(e.target.value) || 0)} />
              </Row>
              <Row label={t('payroll.set.ack')} hint={t('payroll.set.ack_hint')}>
                <Toggle checked={s['warnings_need_ack'] === true} onChange={(v) => set('warnings_need_ack', v)} label={t('payroll.set.ack')} />
              </Row>
              <Row label={t('payroll.set.req_time')} hint={t('payroll.set.req_time_hint')}>
                <Toggle checked={s['require_approved_time'] === true} onChange={(v) => set('require_approved_time', v)} label={t('payroll.set.req_time')} />
              </Row>
              <Row label={t('payroll.set.req_leave')} hint={t('payroll.set.req_leave_hint')}>
                <Toggle checked={s['require_approved_leave'] === true} onChange={(v) => set('require_approved_leave', v)} label={t('payroll.set.req_leave')} />
              </Row>
              <Row label={t('payroll.set.bank_changed')} hint={t('payroll.set.bank_changed_hint')}>
                <Input className="hr-mono w-[80px]" value={String(s['bank_changed_days'] ?? 14)} onChange={(e) => set('bank_changed_days', Number(e.target.value) || 0)} />
              </Row>
            </div>
          </Panel>
          <Panel index="03" label={t('payroll.set.payslips')}>
            <div className="flex flex-col gap-1">
              <Row label={t('payroll.set.publish')} hint={t('payroll.set.publish_hint')}>
                <Segmented value={String(s['publish'] ?? 'scheduled')} onChange={(v) => set('publish', v)} label={t('payroll.set.publish')} size="sm" options={['scheduled', 'immediate', 'manual'].map((x) => ({ value: x, label: t('payroll.publish.' + x) }))} />
              </Row>
              {s['publish'] === 'scheduled' && (
                <Row label={t('payroll.set.publish_hour')}>
                  <Input className="hr-mono w-[70px]" value={String(s['publish_hour'] ?? 7)} onChange={(e) => set('publish_hour', Number(e.target.value) || 0)} />
                </Row>
              )}
              <Row label={t('payroll.set.show_ytd')} hint={t('payroll.set.show_ytd_hint')}>
                <Toggle checked={s['payslip_show_ytd'] === true} onChange={(v) => set('payslip_show_ytd', v)} label={t('payroll.set.show_ytd')} />
              </Row>
              <Row label={t('payroll.set.email')} hint={t('payroll.set.email_hint')}>
                <Toggle checked={s['email_payslips'] === true} onChange={(v) => set('email_payslips', v)} label={t('payroll.set.email')} />
              </Row>
            </div>
          </Panel>
          <Panel index="04" label={t('payroll.set.employer_fields')}>
            {d.missing_fields.length > 0 && <Notice tone="warn" className="mb-3">{tn('payroll.set.missing', d.missing_fields.length)}</Notice>}
            {d.entity_fields.length === 0 ? <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.set.no_fields')}</div> : <FieldForm fields={d.entity_fields} values={fields} onChange={(k, v) => setFields((x) => ({ ...x, [k]: v }))} readOnly={!full} missing={d.missing_fields} />}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

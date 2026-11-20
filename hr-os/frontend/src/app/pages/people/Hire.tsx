/**
 * Hire: one page, four short sections (who, job, pay, tax), with smart
 * defaults from the entity's country (name order, currency, pay period,
 * probation, the packs' tax fields). The bar at the foot says what will
 * happen and does it; the next step is offered after.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, UserPlus } from 'lucide-react';
import { Button, DayPicker, EntityPicker, Field, Input, LoadError, Loading, MoneyInput, Notice, PageBody, PageHeader, Panel, Picker, Segmented, Select, Tag, Toggle, majorParam } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, refreshMe, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, addMonths, dayKey, fmtDay, isDay } from '../../lib/format.ts';
import { minorFromMajor } from '../../lib/money.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { toast } from '../../lib/toast.ts';
import { departmentOutline, pickItems, useDepartments, useOrgList } from './data.ts';
import { usePeopleItems } from './RecordDialogs.tsx';
import type { Employee } from './types.ts';

export interface ProfileField {
  pack?: string | undefined;
  key: string;
  label: string;
  type: 'enum' | 'number' | 'boolean' | 'text' | 'date' | 'money';
  options?: { value: string; label: string }[] | undefined;
  default?: unknown;
  required?: boolean | undefined;
  help?: string | undefined;
  form?: string | undefined;
  scope?: 'employee' | 'entity' | undefined;
}

export interface EntityView {
  id: string;
  name: string;
  country: string;
  country_name: string;
  region: string;
  currency: string;
  timezone: string;
  packs: string[];
  default_schedule: string;
  default_calendar: string;
  default_pay_schedule: string;
  people: number;
  profile_fields?: ProfileField[] | undefined;
}

interface CountryInfo {
  code: string;
  name_order: 'family_first' | 'given_first';
  week_start: number;
}

/** The tax profile form from the packs' declared fields. */
export function TaxFields({ fields, values, onChange }: { fields: ProfileField[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }): React.JSX.Element {
  const set = (k: string, v: unknown): void => onChange({ ...values, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.key] ?? f.default;
        const label = (
          <>
            {f.label}
            {f.form !== undefined && f.form !== '' && <Tag className="ml-1">{f.form}</Tag>}
          </>
        );
        if (f.type === 'boolean')
          return (
            <div key={f.key} className="flex items-center justify-between gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-3 py-2">
              <span className="text-[13px]">{label}</span>
              <Toggle checked={v === true} onChange={(b) => set(f.key, b)} label={f.label} />
            </div>
          );
        return (
          <Field key={f.key} label={label} help={f.help} optional={f.required !== true}>
            {f.type === 'enum' ? (
              <Select value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}>
                {f.required !== true && <option value="">{t('ui.none')}</option>}
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === 'date' ? (
              <DayPicker value={String(v ?? '')} onChange={(d) => set(f.key, d)} label={f.label} clearable />
            ) : (
              <Input value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : undefined} className={f.type === 'number' || f.type === 'money' ? 'hr-mono' : ''} aria-label={f.label} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

function nextMonday(): string {
  const d = new Date();
  const add = (8 - d.getDay()) % 7 || 7;
  return addDays(dayKey(), add);
}

/**
 * The query a link may fill the form with (hiring's accepted offer opens
 * `#/people/new?entity=&legal_name=&personal_email=&phone=&title=&job_title=
 * &department=&location=&employment_type=&start_day=&pay_basis=&pay_amount=
 * &pay_per=&currency=&employee=&from_application=`). `from_application` goes
 * to people.hire, which marks the application hired with this employment.
 */
function prefill(query: URLSearchParams): (key: string) => string {
  return (key) => (query.get(key) ?? '').trim();
}

const PERS = ['month', 'year', 'week'] as const;
type Per = (typeof PERS)[number];

export function HirePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity: chosen } = useUi();
  const q = prefill(query);
  const existing = q('employee');
  const fromApplication = q('from_application');
  // "Add myself as an employee" (an administrator without a record): the member's name and email, linked after the hire.
  const addSelf = q('self') === '1' && me.employee === null;
  const qEntity = me.entities.some((x) => x.id === q('entity')) ? q('entity') : '';
  const qBasis = (['salary', 'hourly', 'daily'] as const).find((b) => b === q('pay_basis'));
  const qPer = PERS.find((p) => p === q('pay_per'));
  const [entity, setEntity] = useState(qEntity !== '' ? qEntity : chosen !== '' ? chosen : (me.entities[0]?.id ?? ''));
  const ent = useOp<{ entity: EntityView }>('entities.get', { entity }, ['entities'], { name: 'hire.entity', skip: entity === '' });
  const e = ent.data?.entity ?? null;
  const country = useOp<{ country: CountryInfo }>('countries.get', { country: e?.country ?? '' }, [], { name: 'hire.country', skip: e === null });
  const person = useOp<{ employee: Employee }>('people.get', { employee: existing }, ['employees'], { name: 'hire.person', skip: existing === '' });
  const departments = useDepartments(entity);
  const locations = useOrgList('locations', entity).items;
  const types = useOrgList('employment-types').items;
  const titles = useOrgList('titles').items;
  const people = usePeopleItems(entity);

  const [legal, setLegal] = useState(q('legal_name') !== '' ? q('legal_name') : addSelf ? me.member.name : '');
  const [family, setFamily] = useState('');
  const [given, setGiven] = useState('');
  const [kanaF, setKanaF] = useState('');
  const [kanaG, setKanaG] = useState('');
  const [preferred, setPreferred] = useState('');
  const [workEmail, setWorkEmail] = useState(addSelf ? me.member.email : '');
  const [personalEmail, setPersonalEmail] = useState(q('personal_email'));
  const [phone, setPhone] = useState(q('phone'));
  const [birth, setBirth] = useState('');
  const [start, setStart] = useState(isDay(q('start_day')) ? q('start_day') : nextMonday());
  const [title, setTitle] = useState(q('title'));
  const [jobTitle, setJobTitle] = useState(q('job_title'));
  const [department, setDepartment] = useState(q('department'));
  const [manager, setManager] = useState('');
  const [location, setLocation] = useState(q('location'));
  const [etype, setEtype] = useState(q('employment_type'));
  const [probation, setProbation] = useState(true);
  const [probationEnd, setProbationEnd] = useState('');
  const [basis, setBasis] = useState<'salary' | 'hourly' | 'daily'>(qBasis ?? 'salary');
  const [per, setPer] = useState<Per>(qPer ?? 'month');
  const [amount, setAmount] = useState<number | null>(null);
  // The offered pay, once the entity (its currency) is known; only when the link's currency is the entity's.
  const payFilled = useRef(false);
  const [tax, setTax] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = country.data?.country.name_order ?? 'given_first';
  const jp = e?.country === 'JP';
  // Defaults that follow the entity: its first location, a full-time type, the usual pay period.
  useEffect(() => {
    if (locations !== null && location === '' && locations.length > 0) setLocation(locations[0]?.id ?? '');
  }, [locations, location]);
  useEffect(() => {
    if (types !== null && etype === '') setEtype(types.find((x) => x['code'] === 'full_time')?.id ?? types[0]?.id ?? '');
  }, [types, etype]);
  useEffect(() => {
    if (e !== null && qPer === undefined) setPer(['US', 'CA', 'GB', 'AU', 'NZ'].includes(e.country) ? 'year' : 'month');
  }, [e?.country]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (e === null || payFilled.current) return;
    payFilled.current = true;
    const cur = q('currency').toUpperCase();
    if (q('pay_amount') !== '' && (cur === '' || cur === e.currency)) setAmount(minorFromMajor(q('pay_amount'), e.currency));
  }, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (family !== '' || given !== '') setLegal(order === 'family_first' ? [family, given].filter(Boolean).join(' ') : [given, family].filter(Boolean).join(' '));
  }, [family, given, order]);
  const probationDay = probation ? (probationEnd !== '' ? probationEnd : start !== '' ? addMonths(start, 3) : '') : '';

  const fields = (e?.profile_fields ?? []).filter((f) => f.scope !== 'entity');
  const seesPay = can(me, 'payroll', 'edit');
  const name = existing !== '' ? (person.data?.employee.name ?? '') : preferred !== '' ? preferred : legal;
  const ok = entity !== '' && start !== '' && (existing !== '' || legal.trim() !== '') && !fields.some((f) => f.required === true && (tax[f.key] ?? f.default ?? '') === '');

  const hire = async (): Promise<void> => {
    if (e === null) return;
    setBusy(true);
    setError(null);
    const params: Record<string, unknown> = {
      entity,
      start_day: start,
      title: title.trim(),
      job_title: jobTitle,
      department,
      manager,
      location,
      employment_type: etype,
      probation_end: probationDay === '' ? undefined : probationDay,
    };
    if (fromApplication !== '') params['from_application'] = fromApplication;
    if (existing !== '') params['employee'] = existing;
    else
      Object.assign(params, {
        legal_name: legal.trim(),
        family_name: family.trim(),
        given_name: given.trim(),
        name_order: order,
        preferred_name: preferred.trim(),
        work_email: workEmail.trim(),
        personal_email: personalEmail.trim(),
        phone: phone.trim(),
        birth_date: birth === '' ? undefined : birth,
        nationality: e.country,
        kana: jp && (kanaF !== '' || kanaG !== '') ? { family: kanaF, given: kanaG } : undefined,
      });
    if (seesPay && amount !== null) Object.assign(params, { pay_basis: basis, pay_amount: majorParam(amount, e.currency), pay_per: basis === 'hourly' ? 'hour' : basis === 'daily' ? 'day' : per });
    if (fields.length > 0) params['tax_fields'] = tax;
    for (const k of Object.keys(params)) if (params[k] === '' || params[k] === undefined) delete params[k];
    try {
      const r = await op<{ employee: { id: string; number: string; name: string } }>('people.hire', params, { quiet: true });
      changed('employees', 'employments', 'job_records', 'pay_records');
      if (addSelf) {
        try {
          await op('members.update', { member: me.member.id, employee: r.employee.id }, { pin: { title: t('start.link_me') } });
          await refreshMe();
        } catch {
          /* hired; the link can be made from Settings, Members */
        }
      }
      toast.success(t('hire.done', { name: r.employee.name }));
      // The profile opens with the next steps (invite, onboarding, bank, pay).
      navigate(`/people/${r.employee.number}`, { hired: '1' });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (me.entities.length === 0)
    return (
      <>
        <PageHeader title={t('hire.title')} back="#/people" />
        <PageBody>
          <Notice tone="warn" action={<Button size="sm" onClick={() => navigate('/settings/entities')}>{t('hire.add_entity')}</Button>}>
            {t('hire.no_entity')}
          </Notice>
        </PageBody>
      </>
    );
  if (ent.error !== null) return <LoadError message={ent.error} onRetry={ent.reload} />;
  if (e === null) return <Loading className="min-h-[60vh]" />;

  // Panels are numbered 01, 02, 03 in reading order.
  let n = 0;
  const idx = (): string => String(++n).padStart(2, '0');
  return (
    <>
      <PageHeader title={existing !== '' ? t('hire.title_existing', { name }) : t('hire.title')} meta={`${e.name} · ${e.country} · ${e.currency}${fromApplication !== '' ? ' · ' + t('hire.from_offer') : ''}`} back="#/people" />
      <PageBody className="max-w-[640px]">
        <div className="flex flex-col gap-3">
          {me.entities.length > 1 && (
            <Panel index={idx()} label={t('hire.entity')}>
              <EntityPicker value={entity} onChange={setEntity} label={t('hire.entity')} />
            </Panel>
          )}
          {existing === '' && (
            <Panel index={idx()} label={t('hire.who')}>
              <div className="grid grid-cols-1 gap-3">
                {order === 'family_first' ? (
                  <>
                    <Field label={t('hire.family_name')}>
                      <Input value={family} onChange={(x) => setFamily(x.target.value)} autoFocus aria-label={t('hire.family_name')} />
                    </Field>
                    <Field label={t('hire.given_name')}>
                      <Input value={given} onChange={(x) => setGiven(x.target.value)} aria-label={t('hire.given_name')} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={t('hire.given_name')}>
                      <Input value={given} onChange={(x) => setGiven(x.target.value)} autoFocus aria-label={t('hire.given_name')} />
                    </Field>
                    <Field label={t('hire.family_name')}>
                      <Input value={family} onChange={(x) => setFamily(x.target.value)} aria-label={t('hire.family_name')} />
                    </Field>
                  </>
                )}
                {jp && (
                  <>
                    <Field label={t('hire.kana_family')} optional>
                      <Input value={kanaF} onChange={(x) => setKanaF(x.target.value)} aria-label={t('hire.kana_family')} />
                    </Field>
                    <Field label={t('hire.kana_given')} optional>
                      <Input value={kanaG} onChange={(x) => setKanaG(x.target.value)} aria-label={t('hire.kana_given')} />
                    </Field>
                  </>
                )}
                <Field label={t('hire.legal_name')} help={t('hire.legal_help')}>
                  <Input value={legal} onChange={(x) => setLegal(x.target.value)} aria-label={t('hire.legal_name')} />
                </Field>
                <Field label={t('hire.preferred_name')} optional>
                  <Input value={preferred} onChange={(x) => setPreferred(x.target.value)} aria-label={t('hire.preferred_name')} />
                </Field>
                <Field label={t('profile.work_email')} optional>
                  <Input value={workEmail} onChange={(x) => setWorkEmail(x.target.value)} type="email" aria-label={t('profile.work_email')} />
                </Field>
                <Field label={t('hire.personal_email')} optional>
                  <Input value={personalEmail} onChange={(x) => setPersonalEmail(x.target.value)} type="email" aria-label={t('hire.personal_email')} />
                </Field>
                <Field label={t('profile.phone')} optional>
                  <Input value={phone} onChange={(x) => setPhone(x.target.value)} type="tel" aria-label={t('profile.phone')} />
                </Field>
                <Field label={t('hire.birth_date')} optional>
                  <DayPicker value={birth} onChange={setBirth} max={dayKey()} label={t('hire.birth_date')} clearable />
                </Field>
              </div>
            </Panel>
          )}
          <Panel index={idx()} label={t('hire.job')}>
            <div className="grid grid-cols-1 gap-3">
              <Field label={t('hire.start_day')}>
                <DayPicker value={start} onChange={setStart} label={t('hire.start_day')} />
              </Field>
              <Field label={t('people.col.title')}>
                <Input value={title} onChange={(x) => setTitle(x.target.value)} aria-label={t('people.col.title')} placeholder={t('hire.title_ph')} />
              </Field>
              {(titles ?? []).length > 0 && (
                <Field label={t('record.job_title')} optional help={t('record.job_title_help')}>
                  <Picker value={jobTitle} onChange={(v, it) => (setJobTitle(v), it !== null && title === '' && setTitle(it.label))} items={pickItems(titles)} label={t('record.job_title')} clearable />
                </Field>
              )}
              <Field label={t('people.col.department')} optional>
                <Picker value={department} onChange={setDepartment} items={departmentOutline(departments ?? []).map(({ dept, depth }) => ({ value: dept.id, label: '  '.repeat(depth) + dept.name }))} label={t('people.col.department')} clearable />
              </Field>
              <Field label={t('people.col.manager')} optional>
                <Picker value={manager} onChange={setManager} items={people.filter((x) => x.value !== existing)} label={t('people.col.manager')} clearable />
              </Field>
              <Field label={t('people.col.location')} optional>
                <Picker value={location} onChange={setLocation} items={pickItems(locations)} label={t('people.col.location')} clearable />
              </Field>
              <Field label={t('record.employment_type')}>
                <Picker value={etype} onChange={setEtype} items={pickItems(types)} label={t('record.employment_type')} />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between text-[12px] font-medium text-[var(--hr-ink-2)]">
                  {t('hire.probation')}
                  <Toggle checked={probation} onChange={setProbation} label={t('hire.probation')} />
                </span>
                {probation && <DayPicker value={probationDay} onChange={setProbationEnd} min={start} label={t('record.probation_end')} />}
              </div>
            </div>
            {!seesPay && <Notice className="mt-3">{t('hire.payroll_sets_pay')}</Notice>}
          </Panel>
          {seesPay && (
            <Panel index={idx()} label={t('hire.pay')} aside={<span className="hr-label">{e.currency}</span>}>
              <div className="grid grid-cols-1 gap-3">
                <Field label={t('record.basis')}>
                  <Segmented value={basis} onChange={setBasis} label={t('record.basis')} size="sm" options={(['salary', 'hourly', 'daily'] as const).map((b) => ({ value: b, label: t(`record.basis.${b}`) }))} />
                </Field>
                <Field label={t('record.amount')} optional hint={t('hire.pay_later')}>
                  <MoneyInput value={amount} onChange={setAmount} currency={e.currency} label={t('record.amount')} />
                </Field>
                {basis === 'salary' && (
                  <Field label={t('record.per')}>
                    <Segmented value={per} onChange={setPer} label={t('record.per')} size="sm" options={PERS.filter((p) => p !== 'week' || per === 'week').map((p) => ({ value: p, label: t(`record.per.${p}`) }))} />
                  </Field>
                )}
              </div>
            </Panel>
          )}
          {seesPay && fields.length > 0 && (
            <Panel index={idx()} label={t('hire.tax')} aside={<span className="flex gap-1">{e.packs.map((p) => <Tag key={p}>{p}</Tag>)}</span>}>
              <TaxFields fields={fields} values={tax} onChange={setTax} />
            </Panel>
          )}
          {error !== null && <Notice tone="bad">{error}</Notice>}
          <div className="hr-panel sticky bottom-[72px] z-10 flex flex-wrap items-center gap-3 px-3.5 py-2.5 shadow-[var(--hr-shadow-lg)] md:bottom-3">
            <span className="hr-wrap min-w-0 flex-1 text-[13px] text-[var(--hr-ink-2)]">{name.trim() !== '' ? t('hire.summary', { name: name.trim(), entity: e.name, day: fmtDay(start, { year: 'always' }) }) : t('hire.summary_empty')}</span>
            <Button variant="primary" icon={existing !== '' ? Check : UserPlus} busy={busy} disabled={!ok} onClick={() => void hire()}>
              {existing !== '' ? t('hire.add_employment') : t('people.hire')}
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}

/**
 * Legal entities: each with its country, currency, time zone, fiscal year,
 * week, packs and defaults. Adding one shows what its country brings, as
 * setup did.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, Check, Plus } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Dialog, Empty, Fact, Field, Input, LoadError, Loading, Notice, Panel, Picker, Row, SearchInput, Segmented, Select, Tag, Toggle } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, refreshMe, useMe } from '../../lib/auth.tsx';
import { monthName, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { EntityView } from '../people/Hire.tsx';
import type { CountrySummary } from '../setup/index.tsx';

interface EntityFull extends EntityView {
  code: string;
  legal_name: string;
  fiscal_year_start: string;
  week_start: number;
  date_format: string;
  tax_ids: Record<string, string>;
  address: Record<string, string>;
  active: boolean;
}

function AddEntity({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const countries = useOp<{ countries: CountrySummary[] }>('countries.list', {}, [], { name: 'countries', skip: !open });
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setCountry('');
      setQ('');
      setError(null);
    }
  }, [open]);
  const list = countries.data?.countries ?? [];
  const shown = useMemo(() => list.filter((c) => q.trim() === '' || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.code === q.trim().toUpperCase()), [list, q]);
  const c = list.find((x) => x.code === country) ?? null;
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ entity: EntityFull }>('entities.add', { name: name.trim(), country }, { quiet: true });
      changed('entities', 'holiday_calendars', 'work_schedules', 'employment_types');
      await refreshMe();
      toast.success(t('entity.added', { name: r.entity.name }));
      onClose();
      navigate(`/settings/entities/${r.entity.id}`);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('entity.add')}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === '' || country === ''} onClick={() => void save()}>
            {t('entity.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('entity.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('entity.name_ph')} aria-label={t('entity.name')} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <SearchInput value={q} onChange={setQ} placeholder={t('setup.find_country')} />
            <div role="listbox" aria-label={t('setup.step_country')} className="hr-scroll h-[220px] overflow-y-auto rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-1">
              {countries.data === null ? (
                <Loading className="min-h-[200px]" />
              ) : (
                shown.map((x) => (
                  <button key={x.code} type="button" role="option" aria-selected={x.code === country} onClick={() => setCountry(x.code)} className={cn('hr-focus flex h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px]', x.code === country ? 'bg-[var(--hr-active)] font-medium' : 'hover:bg-[var(--hr-hover)]')}>
                    <span className="hr-mono w-6 text-[12px] text-[var(--hr-muted)]">{x.code}</span>
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{x.currency}</span>
                    {x.code === country && <Check size={13} aria-hidden />}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
            {c === null ? (
              <p className="text-[12px] text-[var(--hr-muted)]">{t('entity.pick_country')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Fact label={t('setup.currency')} mono>
                  {c.currency}
                </Fact>
                <Fact label={t('setup.timezone')}>{c.timezone.replace(/_/g, ' ')}</Fact>
                <Fact label={t('setup.holidays')}>{c.has_holidays ? c.holiday_years.join(', ') : t('setup.holidays_none')}</Fact>
                <Fact label={t('setup.date_format')} mono>
                  {c.date_format}
                </Fact>
                <div className="col-span-2">
                  <div className="hr-label mb-1">{t('setup.payroll_rules')}</div>
                  <div className="flex flex-wrap gap-1">{c.packs.length > 0 ? c.packs.map((p) => <Tag key={p}>{p}</Tag>) : <span className="text-[12px] text-[var(--hr-muted)]">{t('setup.packs_none')}</span>}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function EntitiesSection(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ entities: EntityFull[] }>('entities.list', { all: true }, ['entities', 'employments'], { name: 'settings.entities' });
  const [adding, setAdding] = useState(false);
  const edit = can(me, 'admin', 'full');
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const list = live.data.entities;
  return (
    <Panel label={t('settings.entities')} aside={edit ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('entity.add')}</Button> : undefined} flush>
      {list.length === 0 ? (
        <Empty icon={Building2} title={t('entity.none')} action={edit ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('entity.add')}</Button> : undefined} />
      ) : (
        <ul className="flex flex-col px-1.5 pb-1.5">
          {list.map((e) => (
            <li key={e.id}>
              <a href={`#/settings/entities/${e.id}`} className="hr-focus group flex items-center gap-3 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-2 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hr-hover)]">
                <span className="hr-mono flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--hr-line)] bg-[var(--hr-sunk)] text-[12px]">{e.country}</span>
                <span className="min-w-0 flex-1">
                  <span className="hr-wrap block text-[13px] font-medium">{e.name}</span>
                  <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[e.legal_name, e.country_name, e.currency, e.timezone].filter((x) => x !== '').join(' · ')}</span>
                </span>
                {!e.active && <Tag tone="faint">{t('entity.inactive')}</Tag>}
                <span className="hr-num shrink-0 whitespace-nowrap text-[12px] text-[var(--hr-muted)]">{tn('people.n_people', e.people)}</span>
                <ArrowRight size={14} aria-hidden className="text-[var(--hr-faint)] group-hover:text-[var(--hr-ink)]" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <AddEntity open={adding} onClose={() => setAdding(false)} />
    </Panel>
  );
}

function TextRow({ label, value, onSave, disabled, mono, width = 240, hint }: { label: string; value: string; onSave: (v: string) => void; disabled: boolean; mono?: boolean | undefined; width?: number | undefined; hint?: string | undefined }): React.JSX.Element {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Row label={label} hint={hint}>
      <Input value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={label} className={mono === true ? 'hr-mono' : ''} style={{ width }} />
    </Row>
  );
}

export function EntityDetail({ id }: { id: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ entity: EntityFull }>('entities.get', { entity: id }, ['entities'], { name: 'settings.entity' });
  const cals = useOp<{ calendars: { id: string; code: string; name: string }[] }>('calendars.list', {}, ['holiday_calendars'], { name: 'org.calendars' });
  const scheds = useOp<{ schedules: { id: string; name: string }[] }>('schedules.list', {}, ['work_schedules'], { name: 'settings.schedules' });
  const edit = can(me, 'admin', 'full');
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const e = live.data.entity;
  const save = (patch: Record<string, unknown>): void => {
    void op('entities.update', { entity: e.id, ...patch })
      .then(() => {
        changed('entities');
        void refreshMe();
        toast.success(t('ui.saved'));
      })
      .catch(() => undefined);
  };
  const [mm, dd] = (e.fiscal_year_start !== '' ? e.fiscal_year_start : '01-01').split('-');
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={e.name} aside={<Tag>{e.country}</Tag>} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        <TextRow label={t('entity.name')} value={e.name} onSave={(v) => v !== '' && save({ name: v })} disabled={!edit} />
        <TextRow label={t('entity.legal_name')} value={e.legal_name} onSave={(v) => save({ legal_name: v })} disabled={!edit} />
        <TextRow label={t('entity.code')} value={e.code} onSave={(v) => save({ code: v })} disabled={!edit} mono width={120} />
        <TextRow label={t('entity.currency')} value={e.currency} onSave={(v) => save({ currency: v.toUpperCase() })} disabled={!edit} mono width={90} hint={t('entity.currency_hint')} />
        <TextRow label={t('setup.timezone')} value={e.timezone} onSave={(v) => save({ timezone: v })} disabled={!edit} mono />
        <Row label={t('entity.fiscal_start')}>
          <Select value={mm ?? '01'} onChange={(x) => save({ fiscal_year_start: `${x.target.value}-${dd ?? '01'}` })} aria-label={t('entity.fiscal_start')} className="w-[150px]" disabled={!edit}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={String(i + 1).padStart(2, '0')}>
                {monthName(i + 1)}
              </option>
            ))}
          </Select>
        </Row>
        <Row label={t('entity.week_start')}>
          <Segmented value={String(e.week_start)} onChange={(v) => edit && save({ week_start: Number(v) })} label={t('entity.week_start')} size="sm" options={[0, 1, 6].map((d) => ({ value: String(d), label: weekday(`2026-11-${String(1 + d).padStart(2, '0')}`) }))} />
        </Row>
        <Row label={t('entity.active')}>
          <Toggle checked={e.active} onChange={(v) => save({ active: v })} label={t('entity.active')} disabled={!edit} />
        </Row>
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel index="02" label={t('entity.defaults')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
          <Row label={t('org.f.calendar')} hint={t('entity.calendar_hint')}>
            <Picker value={e.default_calendar} onChange={(v) => save({ default_calendar: v })} items={(cals.data?.calendars ?? []).map((c) => ({ value: c.id, label: c.name, sub: c.code }))} label={t('org.f.calendar')} className="w-[220px]" disabled={!edit} />
          </Row>
          <Row label={t('record.schedule')}>
            <Picker value={e.default_schedule} onChange={(v) => save({ default_schedule: v })} items={(scheds.data?.schedules ?? []).map((s) => ({ value: s.id, label: s.name }))} label={t('record.schedule')} className="w-[220px]" disabled={!edit} />
          </Row>
        </Panel>
        <Panel index="03" label={t('setup.payroll_rules')}>
          <div className="flex flex-wrap gap-1.5 pt-1">{e.packs.length > 0 ? e.packs.map((p) => <Tag key={p}>{p}</Tag>) : <span className="text-[12px] text-[var(--hr-muted)]">{t('setup.packs_none')}</span>}</div>
          <p className="mt-2 text-[12px] text-[var(--hr-muted)]">{t('entity.packs_where')}</p>
        </Panel>
        <Panel index="04" label={t('entity.tax_ids')}>
          {Object.keys(e.tax_ids).length === 0 ? (
            <p className="py-1 text-[12px] text-[var(--hr-muted)]">{t('ui.none')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {Object.entries(e.tax_ids).map(([k, v]) => (
                <Fact key={k} label={k} mono>
                  {v}
                </Fact>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Expenses settings of one legal entity: the policy (finance approves from
 * an amount, age and weekend flags, how claims and advances are paid and
 * settled), saved as it changes, and the categories with their limits,
 * receipt rules, mileage rate, pay component and GL account.
 */
import { useEffect, useState } from 'react';
import { Archive, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { Money, Button, DataTable, Empty, Field, Input, LinkButton, LoadError, Loading, MoneyInput, PageBody, PageHeader, Panel, Picker, Row, Segmented, Sheet, SheetHeader, Tag, Textarea, Toggle, confirmAsk, majorParam, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { rateText } from '../../components/expenses/AddExpense.tsx';
import { CATEGORY_ICONS, CategoryIcon, Switch, PhoneActions } from '../../components/expenses/parts.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, reshape, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import type { Category, CategoryList, Policy } from './types.ts';
import { READS } from './types.ts';

function savePolicy(entity: string, field: string, value: unknown, cur: Policy): void {
  void act([reshape('expense-categories.list', (d) => ({ ...(d as CategoryList), policy: { ...cur, [field === 'finance_over' ? 'finance_over_minor' : field]: value } }))], () => op('expenses.policy-save', { entity, [field]: field === 'finance_over' ? majorParam(value as number, cur.currency) : value }), READS);
}

function NumberField({ value, onCommit, label, suffix, disabled }: { value: number; onCommit: (v: number) => void; label: string; suffix: string; disabled: boolean }): React.JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <span className="flex items-center gap-2">
      <Input
        value={text}
        disabled={disabled}
        inputMode="numeric"
        aria-label={label}
        className="w-20 text-right"
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          const n = Number(text === '' ? '0' : text);
          if (n !== value) onCommit(n);
        }}
      />
      <span className="text-[12px] text-[var(--hr-muted)]">{suffix}</span>
    </span>
  );
}

function PolicyPanel({ p, canEdit }: { p: Policy; canEdit: boolean }): React.JSX.Element {
  const [finance, setFinance] = useState<number | null>(p.finance_over_minor);
  useEffect(() => setFinance(p.finance_over_minor), [p.finance_over_minor]);
  return (
    <Panel index="01" label={t('exp.settings.policy')}>
      <div className="flex flex-col">
        <Row label={t('exp.settings.finance_over')} hint={t('exp.settings.finance_over_hint')}>
          <span className="flex items-center gap-2" onBlur={() => finance !== p.finance_over_minor && canEdit && savePolicy(p.entity, 'finance_over', finance ?? 0, p)}>
            <MoneyInput value={finance} onChange={setFinance} currency={p.currency} label={t('exp.settings.finance_over')} className="w-40" />
          </span>
        </Row>
        <Row label={t('exp.settings.max_age')}>
          <NumberField value={p.max_age_days} disabled={!canEdit} label={t('exp.settings.max_age')} suffix={t('exp.settings.days')} onCommit={(v) => savePolicy(p.entity, 'max_age_days', v, p)} />
        </Row>
        <Row label={t('exp.settings.weekends')}>
          <Toggle checked={p.flag_weekends} disabled={!canEdit} onChange={(v) => savePolicy(p.entity, 'flag_weekends', v, p)} label={t('exp.settings.weekends')} />
        </Row>
        <Row label={t('exp.settings.pay_via')} hint={t('exp.settings.pay_via_hint')}>
          <Segmented value={p.pay_via} onChange={(v) => canEdit && savePolicy(p.entity, 'pay_via', v, p)} label={t('exp.settings.pay_via')} options={[{ value: 'payroll', label: t('exp.pay_via.payroll_short') }, { value: 'bank', label: t('exp.pay_via.bank_short') }]} />
        </Row>
        <Row label={t('exp.settings.advance_pay_via')}>
          <Segmented value={p.advance_pay_via} onChange={(v) => canEdit && savePolicy(p.entity, 'advance_pay_via', v, p)} label={t('exp.settings.advance_pay_via')} options={[{ value: 'bank', label: t('exp.pay_via.bank_short') }, { value: 'payroll', label: t('exp.pay_via.payroll_short') }]} />
        </Row>
        <Row label={t('exp.settings.recover_via')}>
          <Segmented value={p.advance_recover_via} onChange={(v) => canEdit && savePolicy(p.entity, 'advance_recover_via', v, p)} label={t('exp.settings.recover_via')} options={[{ value: 'claim', label: t('exp.adv.by_claims') }, { value: 'payroll', label: t('exp.adv.by_pay') }]} />
        </Row>
        <Row label={t('exp.settings.recover_after')}>
          <NumberField value={p.recover_after_days} disabled={!canEdit} label={t('exp.settings.recover_after')} suffix={t('exp.settings.days_after')} onCommit={(v) => savePolicy(p.entity, 'recover_after_days', v, p)} />
        </Row>
      </div>
    </Panel>
  );
}

interface Edit {
  id: string;
  name: string;
  code: string;
  description: string;
  icon: string;
  kind: 'standard' | 'mileage';
  limit: number | null;
  perDay: number | null;
  rule: 'always' | 'over' | 'never';
  over: number | null;
  rate: string;
  unit: 'km' | 'mile';
  taxable: boolean;
  component: string;
  gl: string;
  archived: boolean;
  used: number;
}

function toEdit(c: Category | null, currency: string): Edit {
  if (c === null) return { id: '', name: '', code: '', description: '', icon: 'Receipt', kind: 'standard', limit: null, perDay: null, rule: 'always', over: null, rate: '', unit: 'km', taxable: false, component: 'REIMB', gl: '', archived: false, used: 0 };
  return { id: c.id, name: c.name, code: c.code, description: c.description, icon: c.icon, kind: c.kind, limit: c.limit_minor > 0 ? c.limit_minor : null, perDay: c.per_day_limit_minor > 0 ? c.per_day_limit_minor : null, rule: c.receipt_rule, over: c.receipt_over_minor > 0 ? c.receipt_over_minor : null, rate: c.mileage_rate_minor > 0 ? rateText(c.mileage_rate_minor, currency) : '', unit: c.unit, taxable: c.taxable, component: c.component, gl: c.gl_account, archived: c.archived, used: c.used ?? 0 };
}

function CategorySheet({ cat, entity, currency, canEdit, onClose }: { cat: Category | null; entity: string; currency: string; canEdit: boolean; onClose: () => void }): React.JSX.Element {
  const [e, setE] = useState<Edit>(() => toEdit(cat, currency));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Edit>): void => setE((x) => ({ ...x, ...p }));
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('expense-categories.save', {
        category: e.id === '' ? undefined : e.id,
        entity: e.id === '' ? entity : undefined,
        name: e.name.trim(),
        description: e.description,
        icon: e.icon,
        kind: e.id === '' ? e.kind : undefined,
        limit: majorParam(e.limit ?? 0, currency),
        per_day_limit: majorParam(e.perDay ?? 0, currency),
        receipt_rule: e.kind === 'mileage' ? 'never' : e.rule,
        receipt_over: majorParam(e.over ?? 0, currency),
        mileage_rate: e.kind === 'mileage' ? (e.rate.trim() === '' ? '0' : e.rate.trim()) : undefined,
        unit: e.unit,
        taxable: e.taxable,
        component: e.component.trim() === '' ? 'REIMB' : e.component.trim(),
        gl_account: e.gl,
        archived: e.archived,
      });
      changed(...READS);
      toast.success(e.id === '' ? t('exp.settings.cat_added', { name: e.name }) : t('exp.settings.cat_saved', { name: e.name }));
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} label={t('exp.settings.category')} width={460}>
      <SheetHeader title={e.id === '' ? t('exp.settings.add_category') : e.name} meta={e.code} onClose={onClose} />
      <div className="flex flex-col gap-3 px-4 py-4">
        <Field label={t('exp.settings.name')}>
          <Input value={e.name} onChange={(x) => set({ name: x.target.value })} aria-label={t('exp.settings.name')} disabled={!canEdit} autoFocus={e.id === ''} />
        </Field>
        <Field label={t('exp.settings.icon')}>
          <div role="radiogroup" aria-label={t('exp.settings.icon')} className="flex flex-wrap gap-1">
            {CATEGORY_ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={e.icon === i} aria-label={i} title={i} disabled={!canEdit} onClick={() => set({ icon: i })} className={`hr-focus hit flex size-8 cursor-pointer items-center justify-center rounded-[var(--hr-radius-sm)] border ${e.icon === i ? 'border-[var(--hr-ink)] bg-[var(--hr-active)] text-[var(--hr-ink)]' : 'border-[var(--hr-line)] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)]'}`}>
                <CategoryIcon name={i} size={14} />
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('exp.settings.description')} optional>
          <Textarea value={e.description} onChange={(x) => set({ description: x.target.value })} minRows={2} aria-label={t('exp.settings.description')} disabled={!canEdit} />
        </Field>
        {e.id === '' && (
          <Field label={t('exp.settings.kind')}>
            <Segmented value={e.kind} onChange={(v) => set({ kind: v })} label={t('exp.settings.kind')} options={[{ value: 'standard', label: t('exp.settings.kind.standard') }, { value: 'mileage', label: t('exp.settings.kind.mileage') }]} />
          </Field>
        )}
        {e.kind === 'mileage' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('exp.settings.rate', { currency })}>
              <Input value={e.rate} onChange={(x) => set({ rate: x.target.value })} inputMode="decimal" aria-label={t('exp.settings.rate', { currency })} disabled={!canEdit} className="text-right" />
            </Field>
            <Field label={t('exp.settings.unit')}>
              <Segmented value={e.unit} onChange={(v) => set({ unit: v })} label={t('exp.settings.unit')} options={[{ value: 'km', label: t('exp.unit.km') }, { value: 'mile', label: t('exp.unit.mile') }]} />
            </Field>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('exp.settings.limit')} optional>
                <MoneyInput value={e.limit} onChange={(v) => set({ limit: v })} currency={currency} label={t('exp.settings.limit')} />
              </Field>
              <Field label={t('exp.settings.per_day')} optional>
                <MoneyInput value={e.perDay} onChange={(v) => set({ perDay: v })} currency={currency} label={t('exp.settings.per_day')} />
              </Field>
            </div>
            <Field label={t('exp.settings.receipt')}>
              <Segmented value={e.rule} onChange={(v) => set({ rule: v })} label={t('exp.settings.receipt')} size="sm" options={[{ value: 'always', label: t('exp.rule.always') }, { value: 'over', label: t('exp.rule.over') }, { value: 'never', label: t('exp.rule.never') }]} />
            </Field>
            {e.rule === 'over' && (
              <Field label={t('exp.settings.receipt_from')}>
                <MoneyInput value={e.over} onChange={(v) => set({ over: v })} currency={currency} label={t('exp.settings.receipt_from')} />
              </Field>
            )}
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('exp.settings.component')} help={t('exp.settings.component_help')}>
            <Input value={e.component} onChange={(x) => set({ component: x.target.value.toUpperCase() })} aria-label={t('exp.settings.component')} disabled={!canEdit} className="hr-mono" />
          </Field>
          <Field label={t('exp.settings.gl')} optional>
            <Input value={e.gl} onChange={(x) => set({ gl: x.target.value })} aria-label={t('exp.settings.gl')} disabled={!canEdit} />
          </Field>
        </div>
        <Switch checked={e.taxable} onChange={(v) => set({ taxable: v })} label={t('exp.settings.taxable')} disabled={!canEdit} />
        {e.id !== '' && <Switch checked={e.archived} onChange={(v) => set({ archived: v })} label={t('exp.settings.archived')} disabled={!canEdit} />}
        {canEdit && (
          <div className="flex items-center justify-between gap-2 border-t border-[var(--hr-hair)] pt-3">
            {e.id !== '' && e.used === 0 ? (
              <LinkButton
                tone="danger"
                onClick={() =>
                  void confirmAsk(t('exp.settings.delete_q', { name: e.name }), t('exp.settings.delete')).then((y) => {
                    if (y) void op('expense-categories.delete', { category: e.id }).then(() => (changed(...READS), onClose()));
                  })
                }
              >
                <Trash2 size={13} aria-hidden /> {t('exp.settings.delete')}
              </LinkButton>
            ) : (
              <span className="text-[12px] text-[var(--hr-muted)]">{e.used > 0 ? tn('exp.settings.used', e.used) : ''}</span>
            )}
            <Button variant="primary" icon={Save} busy={busy} disabled={e.name.trim() === ''} onClick={() => void save()}>
              {t('ui.save')}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function SettingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const ui = useUi();
  const entity = query.get('entity') ?? (ui.entity !== '' ? ui.entity : (me.entities[0]?.id ?? ''));
  const live = useOp<CategoryList>('expense-categories.list', { entity: entity === '' ? undefined : entity, archived: true }, READS, { name: 'expense-categories.list' });
  const [open, setOpen] = useState<Category | null | 'new'>(null);
  const d = live.data;
  const cols: Column<Category>[] = [
    {
      key: 'name',
      label: t('exp.settings.name'),
      width: 'minmax(150px,1.6fr)',
      phone: 'title',
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <CategoryIcon name={c.icon} size={14} className="shrink-0 text-[var(--hr-muted)]" />
          <span className={`truncate ${c.archived ? 'text-[var(--hr-muted)]' : ''}`}>{c.name}</span>
          {c.archived && <Tag tone="faint">{t('exp.settings.archived_tag')}</Tag>}
        </span>
      ),
    },
    { key: 'limit', label: t('exp.settings.col.limit'), width: '112px', align: 'right', mono: true, render: (c) => (c.kind === 'mileage' ? '' : c.limit_minor > 0 ? <Money minor={c.limit_minor} currency={d?.currency ?? ''} /> : <span className="text-[var(--hr-faint)]">{t('ui.none')}</span>) },
    { key: 'day', label: t('exp.settings.col.per_day'), width: '112px', align: 'right', mono: true, hideBelow: 'lg', render: (c) => (c.kind === 'mileage' ? '' : c.per_day_limit_minor > 0 ? <Money minor={c.per_day_limit_minor} currency={d?.currency ?? ''} /> : <span className="text-[var(--hr-faint)]">{t('ui.none')}</span>) },
    { key: 'receipt', label: t('exp.settings.receipt'), width: '140px', render: (c) => (c.kind === 'mileage' ? t('exp.settings.per_unit', { rate: `${d?.currency ?? ''} ${rateText(c.mileage_rate_minor, d?.currency ?? 'USD')}`, unit: t(`exp.unit.${c.unit}`) }) : c.receipt_rule === 'over' ? (
          <span className="flex items-center gap-1">
            {t('exp.rule.from')} <Money minor={c.receipt_over_minor} currency={d?.currency ?? ''} />
          </span>
        ) : (
          t(`exp.rule.${c.receipt_rule}`)
        )) },
    { key: 'used', label: t('exp.settings.used_col'), width: '70px', align: 'right', mono: true, phone: 'end', render: (c) => String(c.used ?? 0) },
  ];
  const entities = me.entities;
  const entityPick = (
    <>
          {entities.length > 1 && (
            <Picker value={entity} onChange={(v) => v !== '' && setQuery({ entity: v })} items={entities.map((e) => ({ value: e.id, label: e.name, sub: `${e.country} · ${e.currency}` }))} label={t('exp.settings.entity')} className="w-[220px]" />
          )}
    </>
  );
  return (
    <>
      <PageHeader title={t('exp.settings.title')} meta={d !== null ? `${d.entity_name} · ${d.currency}` : ''} back="#/expenses">
        <span className="hidden md:contents">{entityPick}</span>
      </PageHeader>
      <PageBody>
        <PhoneActions>{entityPick}</PhoneActions>
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <PolicyPanel p={d.policy} canEdit={d.can_edit} />
            </div>
            <Panel
              index="02"
              label={tn('exp.settings.categories', d.categories.length)}
              flush
              className="xl:col-span-7"
              aside={
                d.can_edit ? (
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Wand2}
                      onClick={() =>
                        void op<{ added: string[] }>('expense-categories.seed', { entity: d.entity }).then((r) => {
                          changed(...READS);
                          toast.success(r.added.length > 0 ? tn('exp.settings.seeded', r.added.length) : t('exp.settings.seeded_none'));
                        })
                      }
                    >
                      {t('exp.settings.seed')}
                    </Button>
                    <Button size="sm" icon={Plus} onClick={() => setOpen('new')}>
                      {t('exp.settings.add_category')}
                    </Button>
                  </span>
                ) : undefined
              }
            >
              <DataTable
                label={t('exp.settings.categories.other', { n: d.categories.length })}
                columns={cols}
                rows={d.categories}
                rowKey={(c) => c.id}
                onRowClick={(c) => setOpen(c)}
                rowClass={(c) => (c.archived ? 'opacity-70' : '')}
                empty={<Empty icon={Archive} title={t('exp.settings.no_categories')} action={d.can_edit ? <Button variant="primary" icon={Wand2} onClick={() => void op('expense-categories.seed', { entity: d.entity }).then(() => changed(...READS))}>{t('exp.settings.seed')}</Button> : undefined} />}
              />
            </Panel>
          </div>
        )}
      </PageBody>
      {open !== null && d !== null && <CategorySheet cat={open === 'new' ? null : open} entity={d.entity} currency={d.currency} canEdit={d.can_edit} onClose={() => setOpen(null)} />}
    </>
  );
}

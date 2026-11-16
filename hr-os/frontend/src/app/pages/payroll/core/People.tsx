/**
 * Payroll for a person: My pay (an employee's payslips, tax profile,
 * declarations and loans), the tax profile form (built from the packs'
 * field definitions), declarations (India first), loans, the profile Pay
 * tab (compensation timeline and recent payslips) and the back pay wizard.
 */
import { useEffect, useMemo, useState } from 'react';
import { Banknote, FileText, HandCoins, Landmark, Plus, Receipt, Send } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Field, FileDrop, Input, LoadError, Loading, Money, MoneyInput, Notice, PageBody, PageHeader, Panel, Picker, RowCue, Segmented, Select, StatusDot, Tabs, Tag, Timeline, majorParam, toast } from '../../../components/ui.tsx';
import type { Column, TimelineItem } from '../../../components/ui.tsx';
import { exponent } from '../../../lib/money.ts';
import { op, opForm } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps, ProfileTabProps } from '../../../lib/contract.ts';
import { fmtDay, fmtStampDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { changedFields, DECL_TONE, FieldForm, kindLabel, LOAN_TONE, MoneyText, periodLabel, plainError } from '../../../components/payroll/bits.tsx';
import type { Declaration, FieldDef, Loan } from './types.ts';

interface MyRow {
  id: string;
  kind: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  currency: string;
  gross_minor: number;
  deductions_minor: number;
  net_minor: number;
  viewed: boolean;
  entity_name: string;
}

type MyTab = 'payslips' | 'tax' | 'declarations' | 'loans';

/** The entity of the caller's employment (its country and currency). */
function useMyEntity(): { id: string; country: string; currency: string } | null {
  const me = useMe();
  const e = me.employee;
  if (e === null) return null;
  const m = e.employments.find((x) => x.status === 'active' || x.status === 'notice') ?? e.employments[0];
  const ent = m ? me.entities.find((x) => x.id === m.entity) : undefined;
  return ent ? { id: ent.id, country: ent.country, currency: ent.currency } : null;
}

/** The caller's primary employment id ('' when they have none). */
function useMyEmployment(): string {
  const me = useMe();
  const e = me.employee;
  if (e === null) return '';
  const active = e.employments.find((x) => x.status === 'active' || x.status === 'notice') ?? e.employments[0];
  return active ? active.id : '';
}

/** /payroll for employees: their payslips (latest first), tax profile, declarations and loans. */
export function MyPay({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const employment = useMyEmployment();
  const tab = (query.get('tab') as MyTab | null) ?? 'payslips';
  const [limit, setLimit] = useState(24);
  const live = useOp<{ payslips: MyRow[]; total: number }>('payslips.mine', { limit }, ['payslips'], { name: 'payroll.mine' });
  const rows = live.data?.payslips ?? null;
  const india = useMyEntity()?.country === 'IN';
  const cols: Column<MyRow>[] = [
    { key: 'period', label: t('payroll.col.period'), width: 'minmax(200px,2fr)', phone: 'title', render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {!r.viewed && <StatusDot tone="rh" />}
          <span className="truncate">{periodLabel(r.period_start, r.period_end)}</span>
          {r.kind !== 'regular' && <Tag>{kindLabel(r.kind)}</Tag>}
        </span>
      ) },
    { key: 'pay', label: t('payroll.pay_day'), width: '120px', mono: true, render: (r) => fmtDay(r.pay_date) },
    { key: 'gross', label: t('payroll.gross'), width: '130px', align: 'right', mono: true, hideBelow: 'lg', render: (r) => <Money minor={r.gross_minor} currency={r.currency} /> },
    { key: 'net', label: t('payroll.net_pay'), width: '140px', align: 'right', mono: true, phone: 'end', render: (r) => <Money minor={r.net_minor} currency={r.currency} /> },
  ];
  return (
    <>
      <PageHeader title={t('payroll.my_pay')} meta={me.employee ? me.employee.name + ' · ' + me.employee.number : ''} />
      <PageBody>
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'payslips' ? undefined : v })}
          label={t('payroll.my_pay')}
          className="mb-3"
          tabs={[
            { value: 'payslips', label: t('payroll.tab.payslips'), count: live.data?.total ?? 0 },
            { value: 'tax', label: t('payroll.tab.tax') },
            ...(india ? [{ value: 'declarations' as const, label: t('payroll.tab.declarations') }] : []),
            { value: 'loans', label: t('payroll.tab.loans') },
          ]}
        />
        {tab === 'payslips' &&
          (rows === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <div className="hr-panel hr-in min-w-0">
              <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} rowHref={(r) => '#/payroll/payslip/' + r.id} label={t('payroll.tab.payslips')} hasMore={(live.data?.total ?? 0) > rows.length} onMore={() => setLimit((l) => l + 24)} empty={<Empty icon={FileText} title={t('payroll.empty.no_payslips')}>{t('payroll.empty.no_payslips_sub')}</Empty>} />
            </div>
          ))}
        {tab === 'tax' && (employment === '' ? <Empty icon={Landmark} title={t('payroll.empty.no_employment')} /> : <TaxProfileForm employment={employment} />)}
        {tab === 'declarations' && (employment === '' ? <Empty icon={Receipt} title={t('payroll.empty.no_employment')} /> : <DeclarationsList employment={employment} />)}
        {tab === 'loans' && (employment === '' ? <Empty icon={HandCoins} title={t('payroll.empty.no_employment')} /> : <LoansList employment={employment} />)}
      </PageBody>
    </>
  );
}

/* ---------------------------------------------------------- tax profile */

interface TaxGet {
  employment: string;
  employee_name: string;
  entity: string;
  country: string;
  as_of: string;
  record: { id: string; effective_from: string; packs: string[]; fields: Record<string, unknown> } | null;
  packs: string[];
  fields: FieldDef[];
  values: Record<string, unknown>;
  missing: string[];
  history: { id: string; effective_from: string; state: string; fields: Record<string, unknown>; note: string }[];
  requests: Declaration[];
  can: { edit: boolean; submit: boolean; packs: boolean };
}

export function TaxProfileForm({ employment }: { employment: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<TaxGet>('taxprofile.get', { employment }, ['tax_profiles', 'tax_declarations', 'approvals'], { name: 'payroll.tax' });
  const d = live.data;
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [from, setFrom] = useState(me.today);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d !== null) setVals({ ...d.values });
  }, [d]);
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const diff = changedFields(d.values, vals);
  const pending = d.requests.filter((r) => r.status === 'submitted');
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ applied: boolean }>('taxprofile.submit', { employment, fields: diff, effective_from: from });
      toast.success(r.applied ? t('payroll.toast.tax_saved') : t('payroll.toast.tax_sent'));
      changed('tax_profiles', 'tax_declarations');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const history: TimelineItem[] = d.history
    .slice()
    .reverse()
    .map((h) => ({ id: h.id, day: h.effective_from, title: h.note !== '' ? h.note : t('payroll.tax.updated'), state: h.state === 'scheduled' ? 'scheduled' : h.state === 'past' ? 'past' : 'current', lines: [], meta: t('payroll.tax.from', { day: fmtDay(h.effective_from) }) }));
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel index="01" label={t('payroll.tax.form', { name: d.employee_name })}>
        {pending.length > 0 && <Notice tone="warn" className="mb-3">{t('payroll.tax.pending', { day: fmtStampDay(pending[0]?.created ?? '') })}</Notice>}
        {d.missing.length > 0 && <Notice tone="bad" className="mb-3">{tn('payroll.tax.missing', d.missing.length)}</Notice>}
        {d.fields.length === 0 ? (
          <Empty icon={Landmark} title={t('payroll.empty.no_fields')} />
        ) : (
          <FieldForm fields={d.fields} values={vals} onChange={(k, v) => setVals((x) => ({ ...x, [k]: v }))} readOnly={!d.can.submit} missing={d.missing} />
        )}
        {d.can.submit && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--hr-hair)] pt-3">
            <Field label={t('payroll.tax.effective_from')}>
              <DayPicker value={from} onChange={setFrom} label={t('payroll.tax.effective_from')} />
            </Field>
            <span className="flex-1" />
            <Button variant="primary" icon={d.can.edit ? undefined : Send} busy={busy} disabled={Object.keys(diff).length === 0} onClick={() => void save()}>
              {d.can.edit ? t('ui.save') : t('payroll.act.send_change')}
            </Button>
          </div>
        )}
      </Panel>
      <Panel index="02" label={t('payroll.tax.history')}>
        <Timeline items={history} empty={<span className="text-[12px] text-[var(--hr-muted)]">{t('payroll.tax.no_history')}</span>} />
      </Panel>
    </div>
  );
}

/** /payroll/tax/:employment: a person's tax profile (payroll or the person). */
export function TaxProfilePage({ params }: PageProps): React.JSX.Element {
  const employment = params.employment ?? '';
  return (
    <>
      <PageHeader title={t('payroll.tax.title')} back="#/payroll" />
      <PageBody>
        <TaxProfileForm employment={employment} />
      </PageBody>
    </>
  );
}

/* --------------------------------------------------------- declarations */

function DeclarationEditor({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const live = useOp<{ declaration: Declaration }>('declarations.get', { declaration: id }, ['tax_declarations'], { skip: id === '' });
  const d = live.data?.declaration ?? null;
  const [items, setItems] = useState<{ section: string; amount: number | null; description: string }[]>([]);
  const [regime, setRegime] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const cur = me.entities.find((e) => e.country === (d?.country ?? 'IN'))?.currency ?? 'INR';
  useEffect(() => {
    if (d === null) return;
    setItems(d.items.map((i) => ({ section: i.section, amount: i.amount_minor, description: i.description })));
    setRegime(d.regime);
  }, [d]);
  if (id === '') return <></>;
  const save = async (submit: boolean): Promise<void> => {
    setBusy(true);
    try {
      await op('declarations.save', { declaration: id, regime: regime === '' ? undefined : regime, items: items.filter((i) => i.amount !== null).map((i) => ({ section: i.section, amount: majorParam(i.amount, cur), description: i.description })) });
      if (submit) await op('declarations.submit', { declaration: id });
      toast.success(submit ? t('payroll.toast.decl_sent') : t('ui.saved'));
      changed('tax_declarations');
      if (submit) onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: File[], section: string): Promise<void> => {
    for (const f of files) await opForm('declarations.proof', { declaration: id, section, name: f.name }, { file: f }).catch(() => undefined);
    changed('tax_declarations');
  };
  const edit = d?.can?.edit === true;
  return (
    <Dialog
      open={id !== ''}
      onClose={onClose}
      width={640}
      title={d ? t('payroll.decl.title', { year: d.fiscal_year }) : t('payroll.tab.declarations')}
      footer={
        edit ? (
          <>
            <Button onClick={() => void save(false)} busy={busy}>
              {t('ui.save')}
            </Button>
            <Button variant="primary" icon={Send} busy={busy} onClick={() => void save(true)}>
              {t('payroll.act.submit_decl')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('ui.close')}</Button>
        )
      }
    >
      {d === null ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          {(d.regimes ?? []).length > 0 && (
            <Field label={t('payroll.decl.regime')}>
              <Segmented value={regime === '' ? 'new' : regime} onChange={(v) => edit && setRegime(v)} label={t('payroll.decl.regime')} options={(d.regimes ?? []).map((r) => ({ value: r.value, label: r.label }))} size="sm" />
            </Field>
          )}
          {d.status === 'rejected' && d.decided_note !== '' && <Notice tone="bad">{d.decided_note}</Notice>}
          {(d.sections ?? []).map((s) => {
            const it = items.find((i) => i.section === s.section);
            const proofs = d.proofs.filter((p) => p.section === s.section);
            return (
              <div key={s.section} className="grid min-w-0 grid-cols-1 gap-2 border-b border-[var(--hr-hair)] pb-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="min-w-0">
                  <div className="hr-wrap text-[13px]">{s.label}</div>
                  <div className="hr-mono text-[10.5px] text-[var(--hr-faint)]">
                    {s.section}
                    {s.cap !== null && (
                      <>
                        {' · '}
                        <MoneyText k="payroll.decl.cap" money={{ cap: Math.round(s.cap * 10 ** exponent(cur)) }} currency={cur} />
                      </>
                    )}
                    {proofs.length > 0 && ' · ' + tn('payroll.decl.proofs', proofs.length)}
                  </div>
                  {edit && <FileDrop onFiles={(f) => void upload(f, s.section)} accept="image/*,application/pdf" label={t('payroll.decl.add_proof')} className="mt-1" />}
                </div>
                <MoneyInput
                  value={it ? it.amount : null}
                  onChange={(v) =>
                    edit &&
                    setItems((xs) => {
                      const rest = xs.filter((x) => x.section !== s.section);
                      return v === null ? rest : rest.concat([{ section: s.section, amount: v, description: it ? it.description : '' }]);
                    })
                  }
                  currency={cur}
                  label={s.label}
                />
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

export function DeclarationsList({ employment }: { employment: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ declarations: Declaration[] }>('declarations.list', { employment: employment === '' ? undefined : employment }, ['tax_declarations', 'approvals'], { name: 'payroll.decls' });
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ declaration: Declaration }>('declarations.save', { employment });
      setOpenId(r.declaration.id);
      changed('tax_declarations');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const rows = live.data?.declarations ?? null;
  const cols: Column<Declaration>[] = [
    { key: 'year', label: t('payroll.decl.year'), width: '120px', phone: 'title', render: (r) => r.fiscal_year },
    { key: 'who', label: t('payroll.col.person'), width: 'minmax(160px,1.5fr)', hideBelow: 'lg', render: (r) => r.employee_name },
    { key: 'regime', label: t('payroll.decl.regime'), width: '110px', render: (r) => (r.regime !== '' ? r.regime : '') },
    { key: 'total', label: t('payroll.decl.total'), width: '140px', align: 'right', mono: true, render: (r) => <Money minor={r.total_minor} currency={me.entities.find((e) => e.country === r.country)?.currency ?? 'INR'} /> },
    { key: 'status', label: t('payroll.col.status'), width: '120px', phone: 'end', render: (r) => <StatusDot tone={DECL_TONE[r.status] ?? 'neutral'} label={t('payroll.decl_status.' + r.status)} /> },
  ];
  return (
    <div className="hr-panel hr-in min-w-0">
      {employment !== '' && (
        <div className="flex items-center justify-end gap-2 border-b border-[var(--hr-line)] px-4 py-2">
          <Button size="sm" variant="primary" icon={Plus} busy={busy} onClick={() => void start()}>
            {t('payroll.act.new_declaration')}
          </Button>
        </div>
      )}
      {rows === null ? <Loading /> : <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} label={t('payroll.tab.declarations')} empty={<Empty icon={Receipt} title={t('payroll.empty.no_declarations')} />} />}
      <DeclarationEditor id={openId} onClose={() => setOpenId('')} />
    </div>
  );
}

/** /payroll/declarations: every declaration in scope (payroll), or your own. */
export function DeclarationsPage(_p: PageProps): React.JSX.Element {
  const me = useMe();
  const mine = useMyEmployment();
  const payroll = can(me, 'payroll', 'view');
  return (
    <>
      <PageHeader title={t('payroll.tab.declarations')} />
      <PageBody>
        <DeclarationsList employment={payroll ? '' : mine} />
      </PageBody>
    </>
  );
}

/* ---------------------------------------------------------------- loans */

function LoanRequest({ employment, open, onClose }: { employment: string; open: boolean; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const mine = useMyEntity();
  const cur = mine !== null && me.employee?.employments.some((x) => x.id === employment) ? mine.currency : me.entities[0]?.currency ?? 'USD';
  const [amount, setAmount] = useState<number | null>(null);
  const [n, setN] = useState('12');
  const [kind, setKind] = useState('personal');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('loans.request', { employment, amount: majorParam(amount, cur), installments: Number(n), kind, reason });
      toast.success(t('payroll.toast.loan_sent'));
      changed('loans');
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const each = amount !== null && Number(n) > 0 ? Math.ceil(amount / Number(n)) : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('payroll.loan.request')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={Send} busy={busy} disabled={amount === null || !(Number(n) > 0)} onClick={() => void send()}>
            {t('payroll.act.send_request')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('payroll.loan.amount')}>
          <MoneyInput value={amount} onChange={setAmount} currency={cur} label={t('payroll.loan.amount')} autoFocus />
        </Field>
        <Field label={t('payroll.loan.installments')} hint={each !== null ? <MoneyText k="payroll.loan.each" money={{ amount: each }} currency={cur} /> : undefined}>
          <Input inputMode="numeric" className="hr-mono max-w-[120px]" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('payroll.loan.kind')}>
          <Picker value={kind} onChange={(v) => setKind(v === '' ? 'personal' : v)} items={['salary_advance', 'personal', 'housing', 'vehicle', 'education', 'medical', 'other'].map((k) => ({ value: k, label: t('payroll.loan_kind.' + k) }))} label={t('payroll.loan.kind')} />
        </Field>
        <Field label={t('payroll.loan.reason')} optional>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function LoansList({ employment }: { employment: string }): React.JSX.Element {
  const live = useOp<{ loans: Loan[] }>('loans.list', { employment: employment === '' ? undefined : employment }, ['loans', 'loan_repayments', 'approvals'], { name: 'payroll.loans' });
  const [ask, setAsk] = useState(false);
  const [openId, setOpenId] = useState('');
  const rows = live.data?.loans ?? null;
  const sel = rows?.find((l) => l.id === openId) ?? null;
  const cols: Column<Loan>[] = [
    { key: 'who', label: t('payroll.col.person'), width: 'minmax(160px,1.6fr)', phone: 'title', render: (r) => (<span className="min-w-0 truncate">{r.employee_name} <span className="text-[12px] text-[var(--hr-faint)]">{t('payroll.loan_kind.' + r.kind)}</span></span>) },
    { key: 'principal', label: t('payroll.loan.amount'), width: '130px', align: 'right', mono: true, hideBelow: 'lg', render: (r) => <Money minor={r.principal_minor} currency={r.currency} /> },
    { key: 'each', label: t('payroll.loan.installment'), width: '120px', align: 'right', mono: true, hideBelow: 'lg', render: (r) => <Money minor={r.installment_minor} currency={r.currency} /> },
    { key: 'balance', label: t('payroll.loan.balance'), width: '130px', align: 'right', mono: true, phone: 'end', render: (r) => <Money minor={r.balance_minor} currency={r.currency} /> },
    { key: 'status', label: t('payroll.col.status'), width: '120px', render: (r) => <StatusDot tone={LOAN_TONE[r.status] ?? 'neutral'} label={t('payroll.loan_status.' + r.status) + (r.paused ? ' · ' + t('payroll.paused') : '')} /> },
  ];
  return (
    <div className="hr-panel hr-in min-w-0">
      {employment !== '' && (
        <div className="flex items-center justify-end border-b border-[var(--hr-line)] px-4 py-2">
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setAsk(true)}>
            {t('payroll.loan.request')}
          </Button>
        </div>
      )}
      {rows === null ? <Loading /> : <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} label={t('payroll.tab.loans')} empty={<Empty icon={HandCoins} title={t('payroll.empty.no_loans')} />} />}
      <LoanRequest employment={employment} open={ask} onClose={() => setAsk(false)} />
      <Dialog open={sel !== null} onClose={() => setOpenId('')} title={sel ? sel.employee_name + ' · ' + t('payroll.loan_kind.' + sel.kind) : ''} width={520}>
        {sel && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-3 gap-2">
              <div><div className="hr-label">{t('payroll.loan.total')}</div><Money minor={sel.total_minor} currency={sel.currency} className="hr-mono" /></div>
              <div><div className="hr-label">{t('payroll.loan.repaid')}</div><Money minor={sel.repaid_minor} currency={sel.currency} className="hr-mono" /></div>
              <div><div className="hr-label">{t('payroll.loan.balance')}</div><Money minor={sel.balance_minor} currency={sel.currency} className="hr-mono" /></div>
            </div>
            {sel.schedule.length > 0 && (
              <div>
                <div className="hr-label mb-1">{t('payroll.loan.ahead')}</div>
                {sel.schedule.slice(0, 12).map((s) => (
                  <div key={s.period} className="hr-mono flex justify-between text-[12px]">
                    <span>{s.period}</span>
                    <Money minor={s.amount_minor} currency={sel.currency} />
                  </div>
                ))}
              </div>
            )}
            {sel.repayments.length > 0 && (
              <div>
                <div className="hr-label mb-1">{t('payroll.loan.repayments')}</div>
                {sel.repayments.map((r) => (
                  <div key={r.id} className="hr-mono flex justify-between text-[12px]">
                    <span>{fmtDay(r.day) + ' · ' + t('payroll.repay_kind.' + r.kind)}</span>
                    <Money minor={r.amount_minor} currency={sel.currency} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** /payroll/loans: every loan (payroll), or your own. */
export function LoansPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const mine = useMyEmployment();
  const payroll = can(me, 'payroll', 'view');
  return (
    <>
      <PageHeader title={t('payroll.tab.loans')} />
      <PageBody>
        <LoansList employment={payroll ? query.get('employment') ?? '' : mine} />
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------ profile Pay tab */

interface CompList {
  currency: string;
  today: string;
  start_day: string;
  records: { id: string; effective_from: string; basis: string; amount_minor: number; currency: string; per: string; reason: string; note: string; state: string }[];
  requests: { id: string; effective_from: string; amount_minor: number; currency: string; per: string; reason: string; status: string; backpay: string; requested_by_name: string }[];
  can_request: boolean;
}

function PayChangeDialog({ employment, currency, open, onClose, startDay, first }: { employment: string; currency: string; open: boolean; onClose: () => void; startDay: string; first: boolean }): React.JSX.Element {
  const me = useMe();
  const [amount, setAmount] = useState<number | null>(null);
  const [per, setPer] = useState('month');
  // A joiner's pay starts on the first day of work, never before it.
  const [day, setDay] = useState(startDay > me.today ? startDay : me.today);
  const [reason, setReason] = useState(first ? 'hire' : 'raise');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('comp.request', { employment, amount: majorParam(amount, currency), per, effective_from: day, reason }, { quiet: true });
      toast.success(t('payroll.toast.pay_change_sent'));
      changed('comp_changes', 'approvals');
      onClose();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('payroll.comp.request')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" icon={Send} busy={busy} disabled={amount === null} onClick={() => void send()}>
            {t('payroll.act.send_request')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('payroll.comp.amount')}>
          <div className="flex gap-2">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} label={t('payroll.comp.amount')} autoFocus />
            <Segmented value={per} onChange={setPer} label={t('payroll.comp.per')} size="sm" options={['year', 'month', 'hour'].map((x) => ({ value: x, label: t('payroll.per.' + x) }))} />
          </div>
        </Field>
        <Field label={t('payroll.comp.from')}>
          <DayPicker value={day} onChange={setDay} label={t('payroll.comp.from')} />
        </Field>
        <Field label={t('payroll.comp.reason')}>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('payroll.comp.reason')}>
            {(first ? ['hire', 'adjustment', 'correction'] : ['raise', 'promotion', 'adjustment', 'correction', 'hire']).map((x) => (
              <option key={x} value={x}>{t('payroll.comp_reason.' + x)}</option>
            ))}
          </Select>
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/** The Pay tab on a person's profile: compensation timeline and recent payslips. */
export function ProfilePayTab({ employment, currency, self }: ProfileTabProps): React.JSX.Element {
  const me = useMe();
  const sees = self || can(me, 'payroll', 'view') || me.company.managers_see_pay;
  const comp = useOp<CompList>('comp.list', { employment }, ['pay_records', 'comp_changes'], { skip: !sees });
  const slips = useOp<{ payslips: { id: string; kind: string; period_start: string; period_end: string; pay_date: string; currency: string; net_minor: number; status: string }[] }>('payslips.recent', { employment, limit: 6 }, ['payslips'], { skip: !sees });
  const [ask, setAsk] = useState(false);
  if (!sees || (comp.data === null && comp.code === 'not_permitted')) return <Empty icon={Banknote} title={t('ui.pay_hidden')} />;
  const c = comp.data;
  const items: TimelineItem[] = (c?.records ?? [])
    .slice()
    .reverse()
    .map((r) => ({ id: r.id, day: r.effective_from, title: (
        <>
          <Money minor={r.amount_minor} currency={r.currency || currency} /> {t('payroll.per_short.' + r.per)}
        </>
      ), state: r.state === 'scheduled' ? 'scheduled' : r.state === 'past' ? 'past' : 'current', lines: [], meta: t('payroll.comp_reason.' + r.reason) + (r.note !== '' ? ' · ' + r.note : '') }));
  const pending = (c?.requests ?? []).filter((r) => r.status === 'pending');
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel index="01" label={t('payroll.comp.title')} aside={c?.can_request && !self ? <Button size="sm" icon={Plus} onClick={() => setAsk(true)}>{t('payroll.comp.request')}</Button> : undefined}>
        {pending.map((r) => (
          <Notice key={r.id} tone="warn" className="mb-2">
            <MoneyText k="payroll.comp.pending" money={{ amount: r.amount_minor }} currency={r.currency} vars={{ day: fmtDay(r.effective_from, { year: 'always' }) }} />
          </Notice>
        ))}
        {c === null ? <Loading /> : <Timeline items={items} empty={<span className="text-[12px] text-[var(--hr-muted)]">{t('payroll.comp.none')}</span>} />}
      </Panel>
      <Panel index="02" label={t('payroll.recent_payslips')}>
        {slips.data === null ? (
          <Loading />
        ) : slips.data.payslips.length === 0 ? (
          <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.empty.no_payslips')}</div>
        ) : (
          <div className="divide-y divide-[var(--hr-hair)]">
            {slips.data.payslips.map((s) => (
              <a key={s.id} href={'#/payroll/payslip/' + s.id} className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_72px_120px_14px] items-center gap-3 py-2 transition-colors duration-150 hover:bg-[var(--hr-hover)]">
                <span className="min-w-0 truncate text-[13px]">{periodLabel(s.period_start, s.period_end)}{s.kind !== 'regular' ? ' · ' + kindLabel(s.kind) : ''}</span>
                <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{fmtDay(s.pay_date)}</span>
                <Money minor={s.net_minor} currency={s.currency} className="hr-mono hr-num text-right text-[13px]" />
                <RowCue />
              </a>
            ))}
          </div>
        )}
      </Panel>
      {c !== null && <PayChangeDialog key={c.start_day + (ask ? '1' : '0')} employment={employment} currency={c.currency || currency} open={ask} onClose={() => setAsk(false)} startDay={c.start_day} first={c.records.length === 0} />}
    </div>
  );
}

/* ------------------------------------------------------------ back pay */

interface BackPlan {
  employment: string;
  name: string;
  from_day: string;
  currency: string;
  periods: { payslip: string; payrun_number: string; period_start: string; period_end: string; was_minor: number; now_minor: number; diff_minor: number; net_diff_minor: number; packs: string[] }[];
  total_minor: number;
  net_effect_minor: number;
}

/** /payroll/backpay?employment=&from=: the back pay wizard for a back-dated pay change. */
export function BackpayPage({ query }: PageProps): React.JSX.Element {
  const employment = query.get('employment') ?? '';
  const from = query.get('from') ?? '';
  const live = useOp<BackPlan>('backpay.preview', { employment, from_day: from }, ['payslips', 'pay_records'], { skip: employment === '' || from === '' });
  const [target, setTarget] = useState<'next' | 'off_cycle'>('next');
  const [busy, setBusy] = useState(false);
  const d = live.data;
  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ added: number; payrun: string }>('backpay.apply', { employment, from_day: from, target });
      toast.success(tn('payroll.toast.backpay', r.added));
      changed('pay_inputs');
      navigate(r.payrun !== '' ? '/payroll/runs/' + r.payrun : '/payroll/items');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={t('payroll.backpay.title')} meta={d ? d.name + ' · ' + t('payroll.backpay.from', { day: fmtDay(d.from_day) }) : ''} back="#/payroll" />
      <PageBody>
        {employment === '' || from === '' ? (
          <Empty icon={Banknote} title={t('payroll.backpay.choose')} />
        ) : d === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : d.periods.length === 0 ? (
          <Empty icon={Banknote} title={t('payroll.backpay.nothing')} />
        ) : (
          <div className="hr-in flex flex-col gap-3">
            <Panel index="01" label={t('payroll.backpay.periods')} flush>
              <div className="divide-y divide-[var(--hr-hair)]">
                {d.periods.map((p) => (
                  <div key={p.payslip} className="grid min-h-10 grid-cols-[minmax(0,1fr)_repeat(3,minmax(90px,auto))] items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0 truncate">
                      {periodLabel(p.period_start, p.period_end)} <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{p.payrun_number}</span>
                    </span>
                    <Money minor={p.was_minor} currency={d.currency} className="hr-mono text-right" />
                    <Money minor={p.now_minor} currency={d.currency} className="hr-mono text-right" />
                    <Money minor={p.diff_minor} currency={d.currency} className="hr-mono text-right font-medium" />
                  </div>
                ))}
              </div>
            </Panel>
            <div className="hr-panel flex flex-wrap items-center gap-3 px-4 py-3">
              <div>
                <div className="hr-label">{t('payroll.backpay.total')}</div>
                <Money minor={d.total_minor} currency={d.currency} className="hr-mono hr-num text-[26px] font-light" />
              </div>
              <div className="text-[12px] text-[var(--hr-muted)]">
                <MoneyText k="payroll.backpay.net_effect" money={{ amount: d.net_effect_minor }} currency={d.currency} />
              </div>
              <span className="flex-1" />
              <Segmented value={target} onChange={setTarget} label={t('payroll.backpay.where')} size="sm" options={[{ value: 'next', label: t('payroll.backpay.next') }, { value: 'off_cycle', label: t('payroll.backpay.off_cycle') }]} />
              <Button variant="primary" busy={busy} onClick={() => void apply()}>
                {t('payroll.act.add_backpay')}
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** Picker items: the people of an entity (current employments). */
export function usePeopleOptions(entity: string): { value: string; label: string; sub: string }[] {
  const dir = useOp<{ people: { employment: string; name: string; number: string }[] }>('people.directory', { entity: entity === '' ? undefined : entity, status: 'current', limit: 500 }, ['employments', 'employees'], {});
  return useMemo(() => (dir.data?.people ?? []).map((r) => ({ value: r.employment, label: r.name, sub: r.number })), [dir.data]);
}

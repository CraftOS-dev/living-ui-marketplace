/**
 * The Fix of one pay run issue, where the issue is (QA2 N4): an editor for
 * exactly the value it needs when you may change it (a person's birth date or
 * details, a tax profile field, an employer field, a bank account, a pay
 * record, the year's earlier pay of a Malaysian payslip as an opening balance),
 * saved and that payslip calculated again; otherwise a button that
 * sends it to the people who can (an Inbox item) and says who. Issues with no
 * value to fill open the page that fixes them. Payroll fills the personal
 * fields packs need itself (birth date, nationality, gender: payroll.person-set,
 * `payroll_may_set` on the issue); other personal details go to HR. Used by
 * the Issues tab and the payslip drawer of an open run.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button, DayPicker, Field, Input, MoneyInput, Notice, Row, Segmented, Toggle, majorParam, toast } from '../ui.tsx';
import { addDays } from '../../lib/format.ts';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { FieldInput, issueFix, issueText, plainError } from './bits.tsx';
import type { FieldDef, Issue } from '../../pages/payroll/core/types.ts';

type Kind = 'person' | 'profile' | 'entity' | 'bank' | 'pay' | 'earlier' | 'link';

function kindOf(i: Issue): Kind {
  if (i.code === 'my_pcb_year_history_missing') return 'earlier';
  if (i.code === 'data_missing') return i.scope === 'employee' ? 'person' : i.scope === 'entity' ? 'entity' : 'profile';
  if ((i.code === 'profile_missing' || i.code === 'profile_invalid') && i.field) return 'profile';
  if ((i.code === 'entity_missing' || i.code === 'entity_invalid' || i.code === 'entity_field_missing') && i.field) return 'entity';
  if (i.code === 'bank_missing') return 'bank';
  if (i.code === 'no_active_pay') return 'pay';
  return 'link';
}

/** Calculate one person's payslip again after a fix (the run works in chunks). */
async function recalc(runId: string, employment: string): Promise<void> {
  let r = await op<{ done: boolean }>('payruns.calculate', { payrun: runId, employments: [employment] }, { quiet: true });
  for (let k = 0; k < 20 && !r.done; k++) r = await op<{ done: boolean }>('payruns.calculate', { payrun: runId, continue: true }, { quiet: true });
  changed('payruns', 'payslips');
}

export function IssueFix({ issue, runId, currency, periodStart }: { issue: Issue; runId: string; currency: string; periodStart: string }): React.JSX.Element | null {
  const me = useMe();
  const kind = kindOf(issue);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState('');
  const mayEdit =
    kind === 'person' ? can(me, 'people', 'edit') || (issue.payroll_may_set === true && can(me, 'payroll', 'edit')) : kind === 'entity' ? can(me, 'payroll', 'full') : kind === 'link' ? true : can(me, 'payroll', 'edit');
  if (issue.employment === undefined && kind !== 'entity' && kind !== 'link') return null;
  const ask = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ routed_to: string; already: boolean }>(
        'payruns.ask-fix',
        { payrun: runId, employment: issue.employment, code: issue.code, scope: issue.scope, field: issue.field, field_label: issue.field_label, message: issueText(issue) },
        { quiet: true },
      );
      const who = t('payroll.fix.to_' + r.routed_to, { name: issue.name ?? '' });
      setAsked(r.already ? t('payroll.fix.already', { who: who }) : t('payroll.fix.asked', { who: who }));
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  if (kind === 'link')
    return issue.fix ? (
      <Button size="sm" variant="ghost" className="max-sm:min-h-10" onClick={() => (window.location.hash = issue.fix?.link ?? '')}>
        {issueFix(issue)}
      </Button>
    ) : null;
  if (!mayEdit)
    return (
      <div className="flex min-w-0 flex-col items-end gap-1 max-sm:basis-full max-sm:items-start">
        {asked === '' ? (
          <Button size="sm" variant="ghost" icon={Send} busy={busy} className="max-sm:min-h-10" onClick={() => void ask()}>
            {t('payroll.fix.ask_' + (kind === 'person' ? 'hr' : kind === 'bank' ? 'person' : 'payroll'), { name: issue.name ?? '' })}
          </Button>
        ) : (
          <span className="hr-wrap text-right text-[12px] text-[var(--hr-muted)] max-sm:text-left">{asked}</span>
        )}
        {error !== null && <span className="hr-wrap text-right text-[12px] text-[var(--hr-bad)]">{error}</span>}
      </div>
    );
  return (
    <>
      <Button size="sm" variant="ghost" className="max-sm:min-h-10" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        {open ? t('ui.cancel') : issueFix(issue)}
      </Button>
      {open && (
        <div className="basis-full">
          <Editor
            issue={issue}
            kind={kind}
            currency={currency}
            periodStart={periodStart}
            busy={busy}
            error={error}
            onAsk={kind === 'bank' ? () => void ask() : undefined}
            asked={asked}
            onSave={async (save) => {
              setBusy(true);
              setError(null);
              try {
                const note = await save();
                if (issue.employment !== undefined) await recalc(runId, issue.employment);
                toast.success(note ?? t('payroll.fix.saved'));
                setOpen(false);
              } catch (e) {
                setError(plainError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
    </>
  );
}

function Editor({ issue, kind, currency, periodStart, busy, error, onSave, onAsk, asked }: { issue: Issue; kind: Kind; currency: string; periodStart: string; busy: boolean; error: string | null; onSave: (save: () => Promise<string | undefined>) => Promise<void>; onAsk?: (() => void) | undefined; asked: string }): React.JSX.Element {
  const me = useMe();
  const [earlierPay, setEarlierPay] = useState<number | null>(null);
  const [earlierPcb, setEarlierPcb] = useState<number | null>(null);
  const [earlierEpf, setEarlierEpf] = useState<number | null>(null);
  const [nothing, setNothing] = useState(false);
  const [value, setValue] = useState<unknown>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [per, setPer] = useState('month');
  const [from, setFrom] = useState(issue.from ?? '');
  const [bank, setBank] = useState({ bank_name: '', bank_code: '', number: '' });
  const defs = useOp<{ fields: FieldDef[] }>('payroll.fields', kind === 'entity' ? { entity: issue.entity, scope: 'entity' } : { employment: issue.employment, scope: 'employee' }, ['payroll_settings', 'rule_packs'], { skip: kind !== 'profile' && kind !== 'entity' });
  const def = (defs.data?.fields ?? []).find((f) => f.key === issue.field) ?? null;
  const field = issue.field ?? '';
  const raw = issue.field_label ?? def?.label ?? field.replace(/_/g, ' ');
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  let body: React.ReactNode = null;
  let save: (() => Promise<string | undefined>) | null = null;
  if (kind === 'person') {
    body =
      field === 'birth_date' ? (
        <DayPicker value={typeof value === 'string' ? value : ''} onChange={(d) => setValue(d)} label={label} />
      ) : field === 'nationality' ? (
        <Input className="hr-mono w-[72px] uppercase" maxLength={2} value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder="SG" aria-label={label} />
      ) : (
        <Input value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(e.target.value)} aria-label={label} />
      );
    if (typeof value === 'string' && value !== '')
      save = async () => {
        // HR edits any detail; payroll sets only the fields packs read (payroll.person-set, audited).
        if (can(me, 'people', 'edit')) await op('people.update', { employee: issue.number, [field]: value }, { quiet: true });
        else await op('payroll.person-set', { employee: issue.number, [field]: value }, { quiet: true });
        changed('employees');
        return undefined;
      };
  } else if (kind === 'profile' || kind === 'entity') {
    body = def === null ? <span className="text-[12px] text-[var(--hr-muted)]">{t('ui.loading')}</span> : <FieldInput f={def} v={value} onChange={setValue} />;
    if (def !== null && value !== null && value !== '')
      save =
        kind === 'profile'
          ? async () => {
              await op('taxprofile.submit', { employment: issue.employment, fields: { [field]: value } }, { quiet: true });
              changed('tax_profiles');
              return undefined;
            }
          : async () => {
              await op('payroll.settings-save', { entity: issue.entity, entity_fields: { [field]: value } }, { quiet: true });
              changed('payroll_settings');
              return undefined;
            };
  } else if (kind === 'bank') {
    body = (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} placeholder={t('payroll.fix.bank_name')} aria-label={t('payroll.fix.bank_name')} />
        <Input value={bank.bank_code} onChange={(e) => setBank({ ...bank, bank_code: e.target.value })} placeholder={t('payroll.fix.bank_code')} aria-label={t('payroll.fix.bank_code')} />
        <Input className="hr-mono" value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} placeholder={t('payroll.fix.account')} aria-label={t('payroll.fix.account')} />
      </div>
    );
    if (bank.number.trim() !== '' && bank.bank_name.trim() !== '')
      save = async () => {
        await op('bank.add', { employee: issue.number, bank_name: bank.bank_name.trim(), bank_code: bank.bank_code.trim(), number: bank.number.trim(), holder: issue.name ?? '' }, { quiet: true });
        changed('bank_accounts', 'approvals');
        return t('payroll.fix.bank_waits');
      };
  } else if (kind === 'earlier') {
    // The year's pay before this period, as an opening balance (ytd.set) the PCB pack reads, or the
    // tax profile's confirmation that nothing was paid (my_pcb_no_earlier_pay).
    body = (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={t('payroll.fix.earlier_pay')}>
            <MoneyInput value={earlierPay} onChange={setEarlierPay} currency={currency} label={t('payroll.fix.earlier_pay')} />
          </Field>
          <Field label={t('payroll.fix.earlier_pcb')}>
            <MoneyInput value={earlierPcb} onChange={setEarlierPcb} currency={currency} label={t('payroll.fix.earlier_pcb')} />
          </Field>
          <Field label={t('payroll.fix.earlier_epf')} optional>
            <MoneyInput value={earlierEpf} onChange={setEarlierEpf} currency={currency} label={t('payroll.fix.earlier_epf')} />
          </Field>
        </div>
        <Row label={t('payroll.fix.no_earlier_pay')} hint={t('payroll.fix.no_earlier_pay_hint')}>
          <Toggle checked={nothing} onChange={setNothing} label={t('payroll.fix.no_earlier_pay')} />
        </Row>
      </div>
    );
    if (nothing)
      save = async () => {
        await op('taxprofile.submit', { employment: issue.employment, fields: { my_pcb_no_earlier_pay: true } }, { quiet: true });
        changed('tax_profiles');
        return undefined;
      };
    else if (earlierPay !== null && earlierPcb !== null && periodStart !== '')
      save = async () => {
        const pay = Number(majorParam(earlierPay, currency));
        const pcb = Number(majorParam(earlierPcb, currency));
        const epf = earlierEpf === null ? 0 : Number(majorParam(earlierEpf, currency));
        const byTag: Record<string, number> = { my_pcb_normal: pay };
        const byCode: Record<string, number> = { MY_BASIC: pay, MY_PCB: pcb };
        if (epf > 0) {
          byTag['my_epf_employee'] = epf;
          byCode['MY_EPF_EE'] = epf;
        }
        await op('ytd.set', { employment: issue.employment, day: addDays(periodStart, -1), by_tag: JSON.stringify(byTag), by_code: JSON.stringify(byCode), source: 'migration', note: t('payroll.fix.earlier_note') }, { quiet: true });
        changed('ytd_openings');
        return undefined;
      };
  } else if (kind === 'pay') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <MoneyInput value={amount} onChange={setAmount} currency={currency} label={t('payroll.comp.amount')} />
        <Segmented value={per} onChange={setPer} label={t('payroll.comp.per')} size="sm" options={['month', 'year', 'hour'].map((x) => ({ value: x, label: t('payroll.per.' + x) }))} />
        <DayPicker value={from} onChange={setFrom} label={t('payroll.comp.from')} />
      </div>
    );
    if (amount !== null && from !== '')
      save = async () => {
        await op('pay.update', { employment: issue.employment, effective_from: from, reason: 'change', note: t('payroll.fix.starting_pay'), amount: majorParam(amount, currency), basis: per === 'hour' ? 'hourly' : 'salary', per }, { quiet: true });
        changed('pay_records');
        return undefined;
      };
  }
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] px-3 py-2">
      {kind === 'earlier' ? body : <Field label={kind === 'bank' ? t('payroll.fix.bank_title', { name: issue.name ?? '' }) : kind === 'pay' ? t('payroll.fix.pay_title') : label}>{body}</Field>}
      {kind === 'bank' && <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.fix.bank_note')}</div>}
      {error !== null && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onAsk !== undefined && (asked === '' ? <Button size="sm" variant="ghost" icon={Send} onClick={onAsk}>{t('payroll.fix.ask_person', { name: issue.name ?? '' })}</Button> : <span className="text-[12px] text-[var(--hr-muted)]">{asked}</span>)}
        <Button size="sm" busy={busy} disabled={save === null} onClick={() => (save !== null ? void onSave(save) : undefined)}>
          {t('payroll.fix.save')}
        </Button>
      </div>
    </div>
  );
}

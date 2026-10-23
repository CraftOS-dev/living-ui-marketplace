/**
 * Add or change an employee. Adding asks for the essentials (name, email,
 * job, department, manager, start, contract) with pay in its own section for
 * roles that may set it; changing shows every field, grouped. Only changed
 * fields are sent, so a role without pay rights never sends pay.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, UserPlus } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import type { Params } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { minorToText } from '../../lib/format.ts';
import type { DepartmentList, EmployeeDetail, Employment, PayFrequency } from '../../lib/types/people.ts';
import { DateField, EmployeePicker, MoneyInput } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, Notice, PillButton, PillSelect, softArea, softInput } from '../ui.tsx';
import { EMPLOYMENT_LABEL, FREQUENCY_LABEL } from './common.tsx';

interface Form {
  name: string;
  number: string;
  email: string;
  phone: string;
  job_title: string;
  department: string;
  manager: Option | null;
  start_date: string;
  end_date: string;
  status: string;
  employment: Employment;
  address: string;
  birthday: string;
  emergency_contact: string;
  notes: string;
  pay_basic: string;
  pay_frequency: PayFrequency;
  hourly_cost: string;
  bank_details: string;
  national_id: string;
  tax_number: string;
}

function fromEmployee(e: EmployeeDetail | null): Form {
  const cur = e?.currency ?? 'USD';
  return {
    name: e?.name ?? '',
    number: e?.number ?? '',
    email: e?.email ?? '',
    phone: e?.phone ?? '',
    job_title: e?.job_title ?? '',
    department: e?.department?.id ?? '',
    manager: e?.manager !== null && e?.manager !== undefined ? { id: e.manager.id, label: e.manager.name, value: e.manager.id } : null,
    start_date: e?.start_date ?? today(),
    end_date: e?.end_date ?? '',
    status: e?.status ?? 'active',
    employment: e?.employment ?? 'full_time',
    address: e?.address ?? '',
    birthday: e?.birthday ?? '',
    emergency_contact: e?.emergency_contact ?? '',
    notes: e?.notes ?? '',
    pay_basic: e?.pay_basic !== undefined && e.pay_basic !== 0 ? minorToText(e.pay_basic, cur) : '',
    pay_frequency: e?.pay_frequency ?? 'monthly',
    hourly_cost: e?.hourly_cost !== undefined && e.hourly_cost !== 0 ? minorToText(e.hourly_cost, cur) : '',
    bank_details: e?.bank_details ?? '',
    national_id: e?.national_id ?? '',
    tax_number: e?.tax_number ?? '',
  };
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="px-1 text-[12px] font-bold text-[var(--erp-muted)]">{title}</h3>
      <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">{children}</div>
    </section>
  );
}

export function EmployeeForm({
  open,
  onClose,
  employee,
  canPay,
  currency,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** The employee to change; null adds one. */
  employee: EmployeeDetail | null;
  canPay: boolean;
  currency: string;
  onSaved: (e: EmployeeDetail) => void;
}): React.JSX.Element {
  const [f, setF] = useState<Form>(() => fromEmployee(employee));
  const [depts, setDepts] = useState<DepartmentList | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const adding = employee === null;

  useEffect(() => {
    if (!open) return;
    setF(fromEmployee(employee));
    setError(null);
    setNameError(null);
    setMore(false);
    op<DepartmentList>('departments.list', {}, { quiet: true })
      .then(setDepts)
      .catch(() => setDepts(null));
  }, [open, employee]);

  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setF((x) => ({ ...x, [k]: v }));

  const save = async (): Promise<void> => {
    if (f.name.trim() === '') {
      setNameError('A name is needed');
      return;
    }
    setBusy(true);
    setError(null);
    const base = fromEmployee(employee);
    const p: Params = {};
    const textKeys: (keyof Form)[] = ['name', 'number', 'email', 'phone', 'job_title', 'department', 'start_date', 'end_date', 'status', 'employment', 'address', 'birthday', 'emergency_contact', 'notes'];
    const payKeys: (keyof Form)[] = ['pay_basic', 'pay_frequency', 'hourly_cost', 'bank_details', 'national_id', 'tax_number'];
    for (const k of [...textKeys, ...(canPay ? payKeys : [])]) {
      const v = f[k] as string;
      if (adding ? v !== '' : v !== (base[k] as string)) p[k] = k === 'pay_basic' || k === 'hourly_cost' ? (v === '' ? '0' : v) : v;
    }
    if (adding && p['start_date'] === undefined) p['start_date'] = today();
    const mgr = f.manager?.id ?? '';
    if (adding ? mgr !== '' : mgr !== (base.manager?.id ?? '')) p['manager'] = mgr;
    try {
      const r = adding ? await op<EmployeeDetail>('employees.add', p, { quiet: true }) : await op<EmployeeDetail>('employees.update', { employee: employee.id, ...p }, { quiet: true });
      toast.success(adding ? `${r.name} added` : 'Saved');
      onClose();
      onSaved(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deptOptions = [{ value: '', label: 'No department' }, ...(depts?.departments ?? []).map((d) => ({ value: d.id, label: d.parent !== null ? `${d.parent.name} / ${d.name}` : d.name }))];
  const managerPicker = <EmployeePicker value={f.manager} onChange={(o) => set('manager', o)} placeholder="Nobody (top of the chart)" clearable />;
  const payFields = (
    <>
      <Field label={`Basic pay (${currency})`} hint="Per pay period, before allowances and deductions">
        <MoneyInput value={f.pay_basic} onChange={(v) => set('pay_basic', v)} currency={currency} ariaLabel="Basic pay" />
      </Field>
      <PillSelect soft label="Paid" value={f.pay_frequency} onChange={(v) => set('pay_frequency', v as PayFrequency)} options={(Object.keys(FREQUENCY_LABEL) as PayFrequency[]).map((k) => ({ value: k, label: FREQUENCY_LABEL[k] }))} />
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={adding ? 'Add a person' : `Edit ${employee.name}`}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={UserPlus} dot={adding} loading={busy} onClick={() => void save()}>
            {adding ? 'Add person' : 'Save'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Section title="Person">
          <Field label="Full name" error={nameError} className="@min-[480px]:col-span-2">
            <input
              value={f.name}
              onChange={(e) => {
                set('name', e.target.value);
                setNameError(null);
              }}
              autoFocus={adding}
              aria-label="Full name"
              className={softInput}
            />
          </Field>
          <Field label="Work email" optional className={adding && !more ? '@min-[480px]:col-span-2' : undefined}>
            <input value={f.email} onChange={(e) => set('email', e.target.value)} type="email" inputMode="email" aria-label="Work email" className={softInput} />
          </Field>
          {(!adding || more) && (
            <Field label="Phone" optional>
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} type="tel" aria-label="Phone" className={softInput} />
            </Field>
          )}
          {!adding && (
            <>
              <Field label="Birthday" optional>
                <DateField value={f.birthday} onChange={(v) => set('birthday', v)} ariaLabel="Birthday" optional placeholder="Not set" />
              </Field>
              <Field label="Emergency contact" optional>
                <input value={f.emergency_contact} onChange={(e) => set('emergency_contact', e.target.value)} aria-label="Emergency contact" className={softInput} />
              </Field>
              <Field label="Home address" optional className="@min-[480px]:col-span-2">
                <textarea value={f.address} onChange={(e) => set('address', e.target.value)} aria-label="Home address" className={cn(softArea, 'min-h-[64px]')} />
              </Field>
            </>
          )}
        </Section>

        <Section title="Job">
          <Field label="Job title" optional>
            <input value={f.job_title} onChange={(e) => set('job_title', e.target.value)} aria-label="Job title" className={softInput} />
          </Field>
          <PillSelect soft label="Department" value={f.department} onChange={(v) => set('department', v)} options={deptOptions} />
          <Field label="Manager">{managerPicker}</Field>
          <PillSelect soft label="Contract" value={f.employment} onChange={(v) => set('employment', v as Employment)} options={(Object.keys(EMPLOYMENT_LABEL) as Employment[]).map((k) => ({ value: k, label: EMPLOYMENT_LABEL[k] }))} />
          <Field label="Start date">
            <DateField value={f.start_date} onChange={(v) => set('start_date', v)} ariaLabel="Start date" />
          </Field>
          {!adding && (
            <>
              <PillSelect
                soft
                label="Status"
                value={f.status}
                onChange={(v) => set('status', v)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'on_leave', label: 'On leave' },
                  { value: 'left', label: 'Left the company' },
                ]}
              />
              <Field label="End date" optional hint={f.status === 'left' && f.end_date === '' ? 'Today, when left empty' : undefined}>
                <DateField value={f.end_date} onChange={(v) => set('end_date', v)} ariaLabel="End date" optional placeholder="Not set" min={f.start_date} />
              </Field>
              <Field label="Employee number">
                <input value={f.number} onChange={(e) => set('number', e.target.value)} aria-label="Employee number" className={cn(softInput, 'num')} />
              </Field>
            </>
          )}
        </Section>

        {canPay && (
          <Section title="Pay">
            {payFields}
            {(!adding || more) && (
              <>
                <Field label={`Cost per hour (${currency})`} hint="For project costing">
                  <MoneyInput value={f.hourly_cost} onChange={(v) => set('hourly_cost', v)} currency={currency} ariaLabel="Cost per hour" />
                </Field>
                {!adding && (
                  <>
                    <Field label="Salary bank account" optional>
                      <input value={f.bank_details} onChange={(e) => set('bank_details', e.target.value)} aria-label="Salary bank account" className={softInput} />
                    </Field>
                    <Field label="National id" optional>
                      <input value={f.national_id} onChange={(e) => set('national_id', e.target.value)} aria-label="National id" className={softInput} />
                    </Field>
                    <Field label="Tax number" optional>
                      <input value={f.tax_number} onChange={(e) => set('tax_number', e.target.value)} aria-label="Tax number" className={softInput} />
                    </Field>
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {!adding && (
          <Field label="Notes" optional>
            <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Notes" className={softArea} />
          </Field>
        )}

        {adding && !more && (
          <button type="button" onClick={() => setMore(true)} className="inline-flex items-center gap-1.5 self-start px-1 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
            More options <ChevronDown size={14} aria-hidden />
          </button>
        )}
        {error !== null && (
          <Notice tone="bad" icon={AlertTriangle}>
            {error}
          </Notice>
        )}
      </div>
    </Modal>
  );
}

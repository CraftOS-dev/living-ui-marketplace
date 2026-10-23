/**
 * Company details (name, registered name, logo, address, contacts, tax
 * number) and how the company works (fiscal year, prices with tax, stock
 * below zero, quote validity, working days, words on documents).
 */
import { useEffect, useRef, useState } from 'react';
import { Building2, ImageUp, Trash2 } from 'lucide-react';
import { cn, getPbClient, toast } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { refreshMe } from '../../lib/session.ts';
import type { CompanySettings } from '../../lib/types/settings.ts';
import { NumberInput } from '../pickers.tsx';
import { Card, CardHeader, Field, Notice, PillButton, PillSelect, ToggleRow, softArea, softInput } from '../ui.tsx';
import { MONTHS, SaveBar } from './shared.tsx';

interface Form {
  company_name: string;
  legal_name: string;
  tax_id: string;
  registration_no: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  fiscal_start_month: number;
  prices_include_tax: boolean;
  allow_negative_stock: boolean;
  quote_validity_days: string;
  working_days: number[];
  invoice_footer: string;
  quote_terms: string;
}

function formOf(s: CompanySettings): Form {
  return {
    company_name: s.company_name,
    legal_name: s.legal_name,
    tax_id: s.tax_id,
    registration_no: s.registration_no,
    address: s.address,
    email: s.email,
    phone: s.phone,
    website: s.website,
    fiscal_start_month: s.fiscal_start_month || 1,
    prices_include_tax: s.prices_include_tax,
    allow_negative_stock: s.allow_negative_stock,
    quote_validity_days: String(s.quote_validity_days),
    working_days: [...s.working_days].sort(),
    invoice_footer: s.invoice_footer,
    quote_terms: s.quote_terms,
  };
}

/** The same check the server makes on an email address. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DAYS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

export function logoUrl(path: string, thumb = true): string {
  if (path === '') return '';
  return getPbClient().pb.buildURL(path) + (thumb ? '?thumb=200x200' : '');
}

export function CompanySection({ s, admin, onSaved }: { s: CompanySettings; admin: boolean; onSaved: (s: CompanySettings) => void }): React.JSX.Element {
  const [form, setForm] = useState<Form>(() => formOf(s));
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const base = formOf(s);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const key = JSON.stringify(base);

  // A teammate's change arrives live: take it unless this form has edits.
  useEffect(() => {
    if (!dirty) setForm(formOf(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const save = async (): Promise<void> => {
    if (form.company_name.trim() === '') {
      toast.error('The company needs a name.');
      return;
    }
    if (form.email.trim() !== '' && !EMAIL.test(form.email.trim())) return;
    const changed: Record<string, string | number | boolean | number[]> = {};
    for (const k of Object.keys(form) as (keyof Form)[]) {
      if (JSON.stringify(form[k]) === JSON.stringify(base[k])) continue;
      changed[k] = k === 'quote_validity_days' ? Number(form.quote_validity_days || '0') : form[k];
    }
    setSaving(true);
    try {
      const next = await op<CompanySettings>('settings.update', changed);
      onSaved(next);
      setForm(formOf(next));
      toast.success('Company details saved');
      void refreshMe();
    } catch {
      /* shown */
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File): Promise<void> => {
    setLogoBusy(true);
    try {
      const next = await opForm<CompanySettings>('settings.update', {}, { logo: file });
      onSaved(next);
      toast.success('Logo updated');
      void refreshMe();
    } catch {
      /* shown */
    } finally {
      setLogoBusy(false);
    }
  };
  const removeLogo = async (): Promise<void> => {
    setLogoBusy(true);
    try {
      const next = await op<CompanySettings>('settings.update', { remove_logo: true });
      onSaved(next);
      void refreshMe();
    } catch {
      /* shown */
    } finally {
      setLogoBusy(false);
    }
  };

  const ro = !admin;
  const badEmail = form.email.trim() !== '' && !EMAIL.test(form.email.trim());
  return (
    <div className="flex flex-col gap-5">
      {ro && <Notice tone="neutral">Only an administrator changes the company details.</Notice>}
      <Card delay={1}>
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-[22px] bg-[var(--erp-row)]">
            {s.logo !== '' ? <img src={logoUrl(s.logo)} alt="Company logo" className="size-full object-contain" /> : <Building2 size={28} strokeWidth={1.6} aria-hidden className="text-[var(--erp-muted)]" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">{s.company_name}</p>
            <p className="text-[13px] text-[var(--erp-muted)]">
              Base currency {s.base_currency}
              {s.country !== '' && s.country !== 'XX' ? ` · ${s.country}` : ''} · set when the company was created
            </p>
            {admin && (
              <div className="mt-3 flex flex-wrap gap-2">
                <PillButton size="sm" variant="soft" icon={ImageUp} loading={logoBusy} onClick={() => fileRef.current?.click()}>
                  {s.logo !== '' ? 'Change logo' : 'Upload logo'}
                </PillButton>
                {s.logo !== '' && (
                  <PillButton size="sm" variant="ghost" icon={Trash2} onClick={() => void removeLogo()}>
                    Remove
                  </PillButton>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f !== undefined) void upload(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <Field label="Company name">
            <input className={softInput} value={form.company_name} disabled={ro} onChange={(e) => set('company_name', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Registered name" optional>
            <input className={softInput} value={form.legal_name} disabled={ro} onChange={(e) => set('legal_name', e.target.value)} maxLength={160} />
          </Field>
          <Field label="Tax number" optional>
            <input className={softInput} value={form.tax_id} disabled={ro} onChange={(e) => set('tax_id', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Registration number" optional>
            <input className={softInput} value={form.registration_no} disabled={ro} onChange={(e) => set('registration_no', e.target.value)} maxLength={60} />
          </Field>
          <Field label="Email" optional error={badEmail ? 'Enter an email address like hello@example.com' : null}>
            <input className={softInput} type="email" value={form.email} disabled={ro} onChange={(e) => set('email', e.target.value)} maxLength={160} />
          </Field>
          <Field label="Phone" optional>
            <input className={softInput} value={form.phone} disabled={ro} onChange={(e) => set('phone', e.target.value)} maxLength={40} />
          </Field>
          <Field label="Website" optional>
            <input className={softInput} value={form.website} disabled={ro} onChange={(e) => set('website', e.target.value)} maxLength={160} placeholder="https://" />
          </Field>
          <Field label="Address" optional className="@min-[640px]:row-span-2">
            <textarea className={cn(softArea, 'min-h-[100px]')} value={form.address} disabled={ro} onChange={(e) => set('address', e.target.value)} maxLength={600} />
          </Field>
        </div>
      </Card>

      <Card delay={2}>
        <CardHeader title="How the company works" />
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <PillSelect label="Fiscal year starts in" soft value={String(form.fiscal_start_month)} disabled={ro} onChange={(v) => set('fiscal_start_month', Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          <Field label="Quotes are valid for" hint="Days after the quote date">
            <NumberInput value={form.quote_validity_days} onChange={(v) => set('quote_validity_days', v)} ariaLabel="Days a quote is valid" decimals={0} suffix="days" disabled={ro} />
          </Field>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">Working days</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
            {DAYS.map((d) => {
              const on = form.working_days.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  aria-pressed={on}
                  disabled={ro}
                  onClick={() => set('working_days', on ? form.working_days.filter((x) => x !== d.n) : [...form.working_days, d.n].sort())}
                  className={cn('h-10 min-w-14 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-60', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)] hover:bg-[var(--erp-row-hover)]')}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <span className="px-1 text-[12px] text-[var(--erp-muted)]">Used for leave and due dates</span>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 @min-[640px]:grid-cols-2">
          <ToggleRow title="Prices include tax" text="New documents start with tax-inclusive prices" checked={form.prices_include_tax} disabled={ro} onChange={(v) => set('prices_include_tax', v)} />
          <ToggleRow title="Allow stock below zero" text="Deliveries can go out before stock is received" checked={form.allow_negative_stock} disabled={ro} onChange={(v) => set('allow_negative_stock', v)} />
        </div>
      </Card>

      <Card delay={3}>
        <CardHeader title="Words on documents" subtitle="Printed on every invoice and quote" />
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <Field label="Invoice footer" optional hint="Bank details, a thank you, payment instructions">
            <textarea className={softArea} value={form.invoice_footer} disabled={ro} onChange={(e) => set('invoice_footer', e.target.value)} maxLength={2000} />
          </Field>
          <Field label="Quote terms" optional>
            <textarea className={softArea} value={form.quote_terms} disabled={ro} onChange={(e) => set('quote_terms', e.target.value)} maxLength={2000} />
          </Field>
        </div>
      </Card>

      <SaveBar dirty={dirty && admin} saving={saving} onSave={() => void save()} onDiscard={() => setForm(base)} />
    </div>
  );
}

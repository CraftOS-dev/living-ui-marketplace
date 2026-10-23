/**
 * Forms for the parties directory: a customer or supplier (the common
 * fields first, the rest one step away) and a contact person.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Save, UserPlus } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { minorToText } from '../../lib/format.ts';
import type { PartyContact, PartyDetail } from '../../lib/types/sales.ts';
import { MoneyInput, TaxPicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, PillButton, PillSelect, Toggle, errMessage, softArea, softInput } from '../ui.tsx';
import { useRefData } from './parts.tsx';

interface Form {
  name: string;
  code: string;
  is_customer: boolean;
  is_supplier: boolean;
  email: string;
  phone: string;
  website: string;
  tax_id: string;
  contact_name: string;
  billing_address: string;
  shipping_address: string;
  terms: string;
  currency: string;
  credit_limit: string;
  sale_tax: Option | null;
  purchase_tax: Option | null;
  notes: string;
  archived: boolean;
}

function formOf(p: PartyDetail | null, role: 'customer' | 'supplier', name: string): Form {
  if (p === null) {
    return { name, code: '', is_customer: role === 'customer', is_supplier: role === 'supplier', email: '', phone: '', website: '', tax_id: '', contact_name: '', billing_address: '', shipping_address: '', terms: '', currency: '', credit_limit: '', sale_tax: null, purchase_tax: null, notes: '', archived: false };
  }
  const tax = (t: PartyDetail['sale_tax']): Option | null => (t !== null ? { id: t.id, label: t.name, sub: t.code, value: t.code } : null);
  return {
    name: p.name,
    code: p.code,
    is_customer: p.is_customer,
    is_supplier: p.is_supplier,
    email: p.email,
    phone: p.phone,
    website: p.website,
    tax_id: p.tax_id,
    contact_name: p.contact_name,
    billing_address: p.billing_address,
    shipping_address: p.shipping_address,
    terms: p.terms?.id ?? '',
    currency: p.currency,
    credit_limit: p.credit_limit > 0 ? minorToText(p.credit_limit, p.base_currency) : '',
    sale_tax: tax(p.sale_tax),
    purchase_tax: tax(p.purchase_tax),
    notes: p.notes,
    archived: p.archived,
  };
}

/** Add a customer or supplier (party null), or change one. Calls onSaved with the saved party. */
export function PartyForm({ open, onClose, party, role, base, onSaved, startName = '' }: { open: boolean; onClose: () => void; party: PartyDetail | null; role: 'customer' | 'supplier'; base: string; onSaved: (p: PartyDetail) => void; startName?: string | undefined }): React.JSX.Element {
  const refs = useRefData();
  const [f, setF] = useState<Form>(() => formOf(party, role, startName));
  const [more, setMore] = useState(party !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setF(formOf(party, role, startName));
    setMore(party !== null);
    setError(null);
  }, [open, party, role, startName]);
  const set = (patch: Partial<Form>): void => setF((x) => ({ ...x, ...patch }));

  const save = async (): Promise<void> => {
    if (f.name.trim() === '') {
      setError('Give it a name');
      return;
    }
    if (!f.is_customer && !f.is_supplier) {
      setError('A party is a customer, a supplier, or both');
      return;
    }
    setBusy(true);
    setError(null);
    const params = {
      name: f.name.trim(),
      code: f.code.trim() !== '' ? f.code.trim() : undefined,
      is_customer: f.is_customer,
      is_supplier: f.is_supplier,
      email: f.email.trim(),
      phone: f.phone.trim(),
      website: f.website.trim(),
      tax_id: f.tax_id.trim(),
      contact_name: f.contact_name.trim(),
      billing_address: f.billing_address.trim(),
      shipping_address: f.shipping_address.trim(),
      terms: party !== null || f.terms !== '' ? f.terms : undefined,
      currency: f.currency,
      credit_limit: f.credit_limit.trim() === '' ? '0' : f.credit_limit.trim(),
      sale_tax: f.sale_tax?.value === 'none' ? '' : (f.sale_tax?.value ?? ''),
      purchase_tax: f.purchase_tax?.value === 'none' ? '' : (f.purchase_tax?.value ?? ''),
      notes: f.notes.trim(),
      archived: party !== null ? f.archived : undefined,
    };
    try {
      const r = party === null ? await op<PartyDetail>('parties.add', params, { quiet: true }) : await op<PartyDetail>('parties.update', { party: party.id, ...params }, { quiet: true });
      toast.success(party === null ? `Added ${r.name}` : 'Saved');
      onClose();
      onSaved(r);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const who = f.is_customer && !f.is_supplier ? 'customer' : !f.is_customer && f.is_supplier ? 'supplier' : 'party';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={party === null ? `New ${role}` : `${party.name}: details`}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={party === null ? UserPlus : Save} loading={busy} onClick={() => void save()}>
            {party === null ? `Add ${who}` : 'Save'}
          </PillButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} aria-label="Name" autoFocus className={softInput} />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Email" optional>
            <input value={f.email} onChange={(e) => set({ email: e.target.value })} type="email" inputMode="email" maxLength={160} aria-label="Email" className={softInput} />
          </Field>
          <Field label="Phone" optional>
            <input value={f.phone} onChange={(e) => set({ phone: e.target.value })} type="tel" maxLength={40} aria-label="Phone" className={softInput} />
          </Field>
          <Field label="Contact person" optional>
            <input value={f.contact_name} onChange={(e) => set({ contact_name: e.target.value })} maxLength={120} aria-label="Contact person" className={softInput} />
          </Field>
          <PillSelect
            soft
            label="Payment terms"
            value={f.terms}
            onChange={(v) => set({ terms: v })}
            options={[{ value: '', label: 'Company default' }, ...(refs?.terms ?? []).map((t) => ({ value: t.id, label: t.name }))]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-1 items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
            <span className="text-[14px] font-semibold">A customer</span>
            <Toggle checked={f.is_customer} onChange={(v) => set({ is_customer: v })} label="A customer" />
          </label>
          <label className="flex flex-1 items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
            <span className="text-[14px] font-semibold">A supplier</span>
            <Toggle checked={f.is_supplier} onChange={(v) => set({ is_supplier: v })} label="A supplier" />
          </label>
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex items-center gap-2 self-start px-1 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
          More details
          <span className="hidden font-medium text-[var(--erp-muted)] @min-[480px]:inline">addresses, tax, currency, credit limit</span>
          <ChevronDown size={14} aria-hidden className={cn('transition-transform', more && 'rotate-180')} />
        </button>
        {more && (
          <div className="erp-pop grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
            <Field label="Billing address" optional className="@min-[480px]:col-span-1">
              <textarea value={f.billing_address} onChange={(e) => set({ billing_address: e.target.value })} maxLength={600} rows={3} aria-label="Billing address" className={cn(softArea, 'min-h-[88px]')} />
            </Field>
            <Field label="Shipping address" optional hint="Empty: the billing address">
              <textarea value={f.shipping_address} onChange={(e) => set({ shipping_address: e.target.value })} maxLength={600} rows={3} aria-label="Shipping address" className={cn(softArea, 'min-h-[88px]')} />
            </Field>
            <Field label="Their tax number" optional>
              <input value={f.tax_id} onChange={(e) => set({ tax_id: e.target.value })} maxLength={60} aria-label="Their tax number" className={softInput} />
            </Field>
            <Field label="Website" optional>
              <input value={f.website} onChange={(e) => set({ website: e.target.value })} maxLength={160} aria-label="Website" className={softInput} />
            </Field>
            <PillSelect
              soft
              label="Currency"
              value={f.currency}
              onChange={(v) => set({ currency: v })}
              options={[{ value: '', label: `${base} (base)` }, ...(refs?.currencies ?? []).filter((c) => !c.base && (!c.archived || c.code === f.currency)).map((c) => ({ value: c.code, label: c.code }))]}
            />
            <Field label={`Credit limit in ${base}`} optional hint="Posting an invoice over it asks first">
              <MoneyInput value={f.credit_limit} onChange={(v) => set({ credit_limit: v })} currency={base} ariaLabel="Credit limit" placeholder="No limit" />
            </Field>
            {f.is_customer && (
              <Field label="Sales tax for them" optional hint="Empty: each item's, else the company's">
                <TaxPicker value={f.sale_tax} onChange={(o) => set({ sale_tax: o })} scope="sales" />
              </Field>
            )}
            {f.is_supplier && (
              <Field label="Purchase tax from them" optional hint="Empty: each item's, else the company's">
                <TaxPicker value={f.purchase_tax} onChange={(o) => set({ purchase_tax: o })} scope="purchase" />
              </Field>
            )}
            <Field label="Code" optional hint={party === null ? 'Given automatically when empty' : undefined}>
              <input value={f.code} onChange={(e) => set({ code: e.target.value })} maxLength={20} aria-label="Code" className={softInput} />
            </Field>
            <Field label="Notes" optional className="@min-[480px]:col-span-2">
              <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} rows={2} aria-label="Notes" className={cn(softArea, 'min-h-[64px]')} />
            </Field>
            {party !== null && (
              <label className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 @min-[480px]:col-span-2">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">Archived</span>
                  <span className="block text-[12px] text-[var(--erp-muted)]">Hidden from lists and pickers; the history stays</span>
                </span>
                <Toggle checked={f.archived} onChange={(v) => set({ archived: v })} label="Archived" />
              </label>
            )}
          </div>
        )}
        {error !== null && <p className="px-1 text-[13px] font-semibold text-[var(--erp-red-text)]">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Add or change a contact person of a party. */
export function ContactForm({ open, onClose, partyId, contact, onSaved }: { open: boolean; onClose: () => void; partyId: string; contact: PartyContact | null; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? '');
    setEmail(contact?.email ?? '');
    setPhone(contact?.phone ?? '');
    setTitle(contact?.title ?? '');
    setPrimary(contact?.primary ?? false);
    setError(null);
  }, [open, contact]);
  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      setError('Give the name');
      return;
    }
    setBusy(true);
    try {
      const params = { name: name.trim(), email: email.trim(), phone: phone.trim(), title: title.trim(), primary };
      if (contact === null) await op('contacts.add', { party: partyId, ...params }, { quiet: true });
      else await op('contacts.update', { contact: contact.id, ...params }, { quiet: true });
      toast.success(contact === null ? 'Contact added' : 'Saved');
      onSaved();
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact === null ? 'New contact' : contact.name}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Save} loading={busy} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" autoFocus className={softInput} />
        </Field>
        <Field label="Job title" optional>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Job title" className={softInput} />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Email" optional>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={160} aria-label="Email" className={softInput} />
          </Field>
          <Field label="Phone" optional>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" maxLength={40} aria-label="Phone" className={softInput} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
          <span className="text-[14px] font-semibold">The main contact</span>
          <Toggle checked={primary} onChange={setPrimary} label="The main contact" />
        </label>
        {error !== null && <p className="px-1 text-[13px] font-semibold text-[var(--erp-red-text)]">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

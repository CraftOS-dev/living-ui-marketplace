/**
 * Setup: the business, the chart of accounts, contacts, tax codes, rules,
 * recurring schedules, currencies, what the AI agent may do, imports and
 * export.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check as CheckIcon, Download, Pause, Play, Plus, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, downloadBlob, errMessage } from '../lib/api.ts';
import { ACCOUNT_TYPE_LABEL, SUBTYPE_LABEL, ago, day, money, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Account, Contact, Rule, Schedule, TaxCode } from '../lib/types.ts';
import { AccountPicker, Check, ContactPicker, DateInput, Heading, Money, MoneyInput, Tabs, TaxPicker, isCash } from '../components/controls.tsx';
import { Btn, Chip, Empty, Field, IconBtn, Modal, Select, Toggle, area, input, useConfirm } from '../components/ui.tsx';
import { StateChip } from './Docs.tsx';
import { natural } from './Ledger.tsx';

type Tab = 'business' | 'accounts' | 'contacts' | 'tax' | 'rules' | 'recurring' | 'currencies' | 'agent' | 'imports' | 'export';

const TABS: { value: Tab; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'tax', label: 'Tax codes' },
  { value: 'rules', label: 'Rules' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'currencies', label: 'Currencies' },
  { value: 'agent', label: 'AI agent' },
  { value: 'imports', label: 'Imports' },
  { value: 'export', label: 'Export' },
];

const SUBTYPES: Record<string, string[]> = {
  asset: ['bank', 'cash', 'current_asset', 'fixed_asset', 'contra_asset', 'investment', 'clearing', 'receivable'],
  liability: ['card', 'loan', 'current_liability', 'tax', 'clearing', 'payable'],
  equity: ['equity'],
  income: ['income', 'other_income'],
  expense: ['expense', 'cogs', 'other_expense'],
};

function run(p: Promise<unknown>, msg: string): void {
  p.then(() => toast.success(msg)).catch((err: unknown) => toast.error(errMessage(err)));
}

function Section({ title, sub, action, children }: { title: string; sub?: string | undefined; action?: ReactNode | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <div className="border-b border-[var(--lf-line)] px-4 py-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold">{title}</p>
          {sub !== undefined && <p className="mt-0.5 max-w-[640px] text-[12px] leading-[17px] text-[var(--lf-muted)]">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- business */

function BusinessTab(): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  const [f, setF] = useState(() => ({ ...s }));
  useEffect(() => setF({ ...s }), [s]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify({ ...f, ui: null, policy: null }) !== JSON.stringify({ ...s, ui: null, policy: null });
  const save = (): void =>
    run(
      api.updateSettings({
        business_name: f.business_name,
        entity: f.entity,
        fiscal_year_start: f.fiscal_year_start,
        rounding: f.rounding,
        region: f.region !== s.region ? f.region : undefined,
        invoice_prefix: f.invoice_prefix,
        invoice_next: f.invoice_next,
        credit_prefix: f.credit_prefix,
        credit_next: f.credit_next,
        payment_terms: f.payment_terms,
        business_address: f.business_address,
        business_email: f.business_email,
        business_tax_id: f.business_tax_id,
        invoice_footer: f.invoice_footer,
      }),
      'Settings saved',
    );
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (
    <div className="max-w-[860px]">
      <Section
        title="The books"
        action={
          <Btn variant="primary" disabled={!dirty} onClick={save}>
            Save
          </Btn>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-2">
            <input value={f.business_name} onChange={(e) => set('business_name', e.target.value)} className={input} />
          </Field>
          <Field label="For">
            <Select label="Entity" value={f.entity} onChange={(v) => set('entity', v as typeof f.entity)} options={[{ value: 'business', label: 'A business' }, { value: 'personal', label: 'A household' }, { value: 'both', label: 'Both' }]} />
          </Field>
          <Field label="Home currency" hint="Fixed once the books have entries">
            <input value={s.home_currency} disabled className={input} />
          </Field>
          <Field label="Fiscal year starts">
            <Select label="Fiscal year" value={String(f.fiscal_year_start)} onChange={(v) => set('fiscal_year_start', Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          </Field>
          <Field label="Sales tax / VAT" hint="Changing it adds that region's tax codes">
            <Select label="Region" value={f.region} onChange={(v) => set('region', v)} options={app.regions.map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
          <Field label="Tax rounding">
            <Select label="Rounding" value={f.rounding} onChange={(v) => set('rounding', v as 'line' | 'document')} options={[{ value: 'line', label: 'Per line' }, { value: 'document', label: 'Per document' }]} />
          </Field>
        </div>
      </Section>
      <Section title="Invoices" sub="What your invoices show, and how they are numbered.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="Invoice prefix">
            <input value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value)} className={input} />
          </Field>
          <Field label="Next number">
            <input value={String(f.invoice_next)} onChange={(e) => set('invoice_next', Number(e.target.value.replace(/\D/g, '')) || 1)} className={cn(input, 'num')} />
          </Field>
          <Field label="Credit note prefix">
            <input value={f.credit_prefix} onChange={(e) => set('credit_prefix', e.target.value)} className={input} />
          </Field>
          <Field label="Next number">
            <input value={String(f.credit_next)} onChange={(e) => set('credit_next', Number(e.target.value.replace(/\D/g, '')) || 1)} className={cn(input, 'num')} />
          </Field>
          <Field label="Days to pay">
            <input value={String(f.payment_terms)} onChange={(e) => set('payment_terms', Number(e.target.value.replace(/\D/g, '')) || 0)} className={cn(input, 'num')} />
          </Field>
          <Field label="Address" className="col-span-2">
            <textarea value={f.business_address} onChange={(e) => set('business_address', e.target.value)} rows={3} className={area} />
          </Field>
          <Field label="Email">
            <input value={f.business_email} onChange={(e) => set('business_email', e.target.value)} className={input} />
          </Field>
          <Field label="Tax or VAT number" className="col-span-2">
            <input value={f.business_tax_id} onChange={(e) => set('business_tax_id', e.target.value)} className={input} />
          </Field>
          <Field label="Footer (payment details)" className="col-span-2 sm:col-span-5">
            <textarea value={f.invoice_footer} onChange={(e) => set('invoice_footer', e.target.value)} rows={2} className={area} placeholder="Bank: Northwind Bank · Account 12345678 · Sort code 00-00-00" />
          </Field>
        </div>
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- accounts */

function AccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [f, setF] = useState({
    name: account?.name ?? '',
    code: account?.code ?? '',
    type: account?.type ?? 'expense',
    subtype: account?.subtype ?? 'expense',
    currency: account?.currency || app.home,
    description: account?.description ?? '',
    parent: account?.parent ?? '',
    bank_name: account?.bank_name ?? '',
    bank_number: account?.bank_number ?? '',
    opening_balance: '',
    opening_date: today(),
  });
  const set = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (account === null) {
        await api.createAccount({ ...f, opening_balance: f.opening_balance || undefined, parent: f.parent || undefined, code: f.code || undefined });
        toast.success('Account added');
      } else {
        const p: Record<string, unknown> = { name: f.name, code: f.code, description: f.description, parent: f.parent, bank_name: f.bank_name, bank_number: f.bank_number };
        if (f.type !== account.type) p['type'] = f.type;
        if (f.subtype !== account.subtype) p['subtype'] = f.subtype;
        if (f.currency !== (account.currency || app.home)) p['currency'] = f.currency;
        await api.updateAccount(account.id, p);
        toast.success('Account saved');
      }
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const cashy = f.subtype === 'bank' || f.subtype === 'cash' || f.subtype === 'card' || f.subtype === 'loan';
  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={account === null ? 'New account' : account.name}
      description={account?.system ? 'A system account: it can be renamed and described, not removed.' : undefined}
      footer={
        <>
          {account !== null && !account.system && (
            <Btn
              variant="danger"
              className="mr-auto"
              onClick={() => {
                const has = (account.balance ?? 0) !== 0;
                run(
                  has
                    ? Promise.reject(new Error('Move its balance to another account before archiving it'))
                    : api.archiveAccount(account.id, !account.archived).then(() => onClose()),
                  account.archived ? 'Restored' : 'Archived',
                );
              }}
            >
              {account.archived ? 'Restore' : 'Archive'}
            </Btn>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Name" className="col-span-2 sm:col-span-3">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={input} autoFocus />
        </Field>
        <Field label="Code">
          <input value={f.code} onChange={(e) => set('code', e.target.value)} className={cn(input, 'num')} placeholder="Next free" />
        </Field>
        <Field label="Type">
          <Select label="Type" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v as Account['type'], subtype: SUBTYPES[v]?.[0] ?? v }))} options={Object.keys(SUBTYPES).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] ?? t }))} />
        </Field>
        <Field label="Kind">
          <Select label="Kind" value={f.subtype} onChange={(v) => set('subtype', v)} options={(SUBTYPES[f.type] ?? []).map((s) => ({ value: s, label: SUBTYPE_LABEL[s] ?? s }))} />
        </Field>
        <Field label="Currency">
          <Select label="Currency" value={f.currency} onChange={(v) => set('currency', v)} options={app.currencies.map((c) => ({ value: c.code, label: c.code }))} />
        </Field>
        <Field label="Sub-account of">
          <AccountPicker label="Parent account" value={f.parent} onChange={(v) => set('parent', v)} filter={(a) => a.type === f.type && a.id !== account?.id} clearable placeholder="None" />
        </Field>
        <Field label="Use it for" hint="Your AI agent reads this before it picks an account" className="col-span-2 sm:col-span-4">
          <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} className={area} />
        </Field>
        {cashy && (
          <>
            <Field label="Bank">
              <input value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} className={input} />
            </Field>
            <Field label="Last 4 digits">
              <input value={f.bank_number} onChange={(e) => set('bank_number', e.target.value.slice(0, 4))} className={cn(input, 'num')} />
            </Field>
            {account === null && (
              <>
                <Field label={f.type === 'liability' ? 'Owed at start' : 'Opening balance'}>
                  <MoneyInput value={f.opening_balance} onChange={(v) => set('opening_balance', v)} />
                </Field>
                <Field label="On">
                  <DateInput value={f.opening_date} onChange={(v) => set('opening_date', v)} />
                </Field>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function OpeningDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const list = app.accounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && a.system !== 'ar' && a.system !== 'ap' && a.system !== 'tax');
  const [date, setDate] = useState(today());
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title="Opening balances"
      description="What each account held at the start of the day before your first entries. The other side goes to Opening balance equity. Customers and suppliers: enter their open invoices and bills instead."
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            loading={busy}
            onClick={() => {
              const items = Object.entries(v)
                .filter(([, x]) => x.trim() !== '')
                .map(([account, amount]) => ({ account, amount }));
              if (items.length === 0) return onClose();
              setBusy(true);
              api
                .opening(date, items)
                .then(() => {
                  toast.success('Opening balances recorded');
                  onClose();
                })
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            Record
          </Btn>
        </>
      }
    >
      <Field label="As of" className="mb-3 w-44">
        <DateInput value={date} onChange={setDate} />
      </Field>
      <div className="rounded-[6px] border border-[var(--lf-line)]">
        {list.map((a) => (
          <div key={a.id} className="flex h-9 items-center gap-3 border-b border-[var(--lf-hair)] px-3 last:border-b-0">
            <span className="num w-10 text-[11px] text-[var(--lf-muted)]">{a.code}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.name}</span>
            <span className="text-[11px] text-[var(--lf-muted)]">{a.type === 'liability' ? 'owed' : a.currency || app.home}</span>
            <MoneyInput value={v[a.id] ?? ''} onChange={(x) => setV((o) => ({ ...o, [a.id]: x }))} className="h-6 w-32" label={a.name} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AccountsTab(): React.JSX.Element {
  const app = useApp();
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Account | null | 'new'>(null);
  const [opening, setOpening] = useState(false);
  const [type, setType] = useState('');
  const list = app.allAccounts.filter((a) => (archived || !a.archived) && (type === '' || a.type === type)).sort((a, b) => (a.code < b.code ? -1 : 1));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-4">
        <Select small label="Type" value={type} onChange={setType} className="w-36" options={[{ value: '', label: 'All types' }, ...Object.keys(ACCOUNT_TYPE_LABEL).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] ?? t }))]} />
        <label className="flex items-center gap-2 text-[12px]">
          <Toggle checked={archived} onChange={setArchived} label="Show archived" /> Archived
        </label>
        <span className="flex-1" />
        <Btn size="sm" onClick={() => setOpening(true)}>
          Opening balances
        </Btn>
        <Btn size="sm" variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          Account
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="lf-table">
          <thead>
            <tr>
              <th className="w-[70px]">Code</th>
              <th>Name</th>
              <th className="hidden md:table-cell">Kind</th>
              <th className="hidden lg:table-cell">Use it for</th>
              <th className="r w-[130px]">Balance</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} data-click="true" onClick={() => setEdit(a)} className={a.archived ? 'opacity-50' : ''}>
                <td className="num text-[var(--lf-muted)]">{a.code}</td>
                <td className="max-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('truncate', a.parent !== '' && 'pl-3')}>{a.name}</span>
                    {a.system !== '' && <Chip>System</Chip>}
                    {a.currency !== '' && a.currency !== app.home && <Chip>{a.currency}</Chip>}
                  </div>
                </td>
                <td className="hidden text-[12px] text-[var(--lf-ink-2)] md:table-cell">{SUBTYPE_LABEL[a.subtype] ?? a.subtype}</td>
                <td className="hidden max-w-[360px] truncate text-[12px] text-[var(--lf-muted)] lg:table-cell">{a.description}</td>
                <td className="r num">{money(natural(a, a.balance), app.home, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit !== null && <AccountDialog account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {opening && <OpeningDialog onClose={() => setOpening(false)} />}
    </div>
  );
}

/* --------------------------------------------------------------- contacts */

function ContactPane({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.contact(id), ['contacts', 'documents', 'transactions'], [id]);
  const c = live.data?.contact ?? null;
  const [f, setF] = useState<Partial<Contact>>({});
  const [merge, setMerge] = useState('');
  const [confirmEl, confirm] = useConfirm();
  useEffect(() => {
    if (c !== null) setF({ name: c.name, kind: c.kind, email: c.email, phone: c.phone, address: c.address, tax_id: c.tax_id, terms: c.terms, currency: c.currency, default_account: c.default_account, default_tax: c.default_tax, notes: c.notes });
  }, [c]);
  if (c === null) return <div className="p-4 text-[12px] text-[var(--lf-muted)]">Loading</div>;
  const set = (k: keyof Contact, v: unknown): void => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      {confirmEl}
      <div className="flex items-center gap-2 border-b border-[var(--lf-line)] px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-[14px] font-bold">{c.name}</p>
        <Btn size="sm" variant="primary" onClick={() => run(api.updateContact(c.id, { ...f, aliases: undefined }), 'Saved')}>
          Save
        </Btn>
        <IconBtn icon={X} label="Close" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            <input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} className={input} />
          </Field>
          <Field label="Kind">
            <Select label="Kind" value={f.kind ?? 'other'} onChange={(v) => set('kind', v)} options={[{ value: 'customer', label: 'Customer' }, { value: 'vendor', label: 'Supplier' }, { value: 'both', label: 'Both' }, { value: 'other', label: 'Other' }]} />
          </Field>
          <Field label="Days to pay">
            <input value={String(f.terms ?? 0)} onChange={(e) => set('terms', Number(e.target.value.replace(/\D/g, '')) || 0)} className={cn(input, 'num')} />
          </Field>
          <Field label="Email">
            <input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} className={input} />
          </Field>
          <Field label="Phone">
            <input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={input} />
          </Field>
          <Field label="Address" className="col-span-2">
            <textarea value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} rows={2} className={area} />
          </Field>
          <Field label="Default account">
            <AccountPicker label="Default account" value={f.default_account ?? ''} onChange={(v) => set('default_account', v)} clearable placeholder="None" />
          </Field>
          <Field label="Default tax">
            <TaxPicker value={f.default_tax ?? ''} onChange={(v) => set('default_tax', v)} />
          </Field>
          <Field label="Tax number">
            <input value={f.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} className={input} />
          </Field>
          <Field label="Currency">
            <Select label="Currency" value={f.currency || ''} onChange={(v) => set('currency', v)} options={[{ value: '', label: 'Home (' + app.home + ')' }, ...app.currencies.map((x) => ({ value: x.code, label: x.code }))]} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} className={area} />
          </Field>
        </div>
        {c.aliases.length > 0 && <p className="mt-2 text-[12px] text-[var(--lf-muted)]">Also known as {c.aliases.join(', ')}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <p className="text-[11px] text-[var(--lf-muted)]">Spent, 12 months</p>
            <Money value={c.spent_12m} currency={app.home} bold />
          </div>
          <div>
            <p className="text-[11px] text-[var(--lf-muted)]">Earned, 12 months</p>
            <Money value={c.earned_12m} currency={app.home} bold />
          </div>
        </div>
        <div className="mt-4">
          <Heading>Documents</Heading>
          {c.documents.length === 0 && <p className="text-[12px] text-[var(--lf-muted)]">None</p>}
          {c.documents.slice(0, 12).map((d) => (
            <button key={d.id} type="button" onClick={() => go(d.kind === 'bill' || d.kind === 'vendor_credit' ? 'purchases' : 'sales', { doc: d.id })} className="flex h-8 w-full items-center gap-2 border-b border-[var(--lf-hair)] text-left text-[12.5px] hover:bg-[var(--lf-row)]">
              <span className="num w-[90px] shrink-0 font-semibold">{d.number || 'Draft'}</span>
              <span className="num text-[var(--lf-muted)]">{day(d.issue_date, true)}</span>
              <span className="flex-1" />
              <Money value={d.total} currency={d.currency} />
              <StateChip d={d} />
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Heading>Recent entries</Heading>
          {c.transactions.slice(0, 12).map((t) => (
            <button key={t.id} type="button" onClick={() => go('ledger', { txn: t.id })} className="flex h-8 w-full items-center gap-2 border-b border-[var(--lf-hair)] text-left text-[12.5px] hover:bg-[var(--lf-row)]">
              <span className="num w-[64px] shrink-0 text-[var(--lf-muted)]">{day(t.date, true)}</span>
              <span className="min-w-0 flex-1 truncate">{t.narration}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--lf-hair)] pt-3">
          <span className="text-[12px] text-[var(--lf-muted)]">Merge into</span>
          <ContactPicker value={merge} onChange={(v) => setMerge(v)} className="w-48" placeholder="Another contact" />
          <Btn
            size="sm"
            disabled={merge === '' || merge === c.id}
            onClick={() =>
              void confirm('Its entries and documents move to the other contact and its name becomes an alias.', 'Merge ' + c.name + '?', 'Merge').then((ok) => {
                if (ok)
                  api
                    .mergeContacts(c.id, merge)
                    .then((r) => {
                      toast.success('Merged (' + r.moved + ' records)');
                      setQuery({ contact: r.contact.id });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)));
              })
            }
          >
            Merge
          </Btn>
          <span className="flex-1" />
          <Btn size="sm" variant="ghost" onClick={() => run(api.archiveContact(c.id, !c.archived), c.archived ? 'Restored' : 'Archived')}>
            {c.archived ? 'Restore' : 'Archive'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ContactsTab({ sel }: { sel: string }): React.JSX.Element {
  const app = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const list = app.contacts.filter((c) => (kind === '' || c.kind === kind || c.kind === 'both') && (q === '' || (c.name + ' ' + c.email + ' ' + c.aliases.join(' ')).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex h-full min-h-0">
      <div className={cn('flex min-w-0 flex-1 flex-col', sel !== '' && 'hidden md:flex')}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" className={cn(input, 'h-7 w-48')} />
          <Select small label="Kind" value={kind} onChange={setKind} className="w-32" options={[{ value: '', label: 'Everyone' }, { value: 'customer', label: 'Customers' }, { value: 'vendor', label: 'Suppliers' }, { value: 'other', label: 'Other' }]} />
          <span className="flex-1" />
          <Btn size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Contact
          </Btn>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {list.length === 0 ? (
            <Empty icon={Plus} title="No contacts">
              Customers and suppliers are added as you book lines and write documents.
            </Empty>
          ) : (
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden md:table-cell">Email</th>
                  <th className="r w-[130px]">They owe</th>
                  <th className="r w-[130px]">You owe</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} data-click="true" data-sel={c.id === sel} onClick={() => setQuery({ contact: c.id })}>
                    <td className="max-w-0 truncate font-medium">{c.name}</td>
                    <td className="hidden max-w-[220px] truncate text-[var(--lf-ink-2)] md:table-cell">{c.email}</td>
                    <td className={cn('r num', (c.overdue ?? 0) > 0 && 'text-[var(--lf-neg-text)]')}>{(c.receivable ?? 0) !== 0 ? money(c.receivable ?? 0, app.home) : ''}</td>
                    <td className="r num">{(c.payable ?? 0) !== 0 ? money(c.payable ?? 0, app.home) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {sel !== '' && (
        <aside className="fixed inset-0 z-30 flex w-full flex-col bg-[var(--lf-card)] md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-[var(--lf-line)]">
          <ContactPane id={sel} onClose={() => setQuery({ contact: undefined })} />
        </aside>
      )}
      {adding && (
        <Modal
          open
          width="sm"
          title="New contact"
          onClose={() => setAdding(false)}
          footer={
            <>
              <Btn onClick={() => setAdding(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  void api
                    .createContact({ name })
                    .then((r) => {
                      setAdding(false);
                      setName('');
                      setQuery({ contact: r.contact.id });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Add
              </Btn>
            </>
          }
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Name" />
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- tax codes */

function TaxTab(): React.JSX.Element {
  const app = useApp();
  const [edit, setEdit] = useState<TaxCode | 'new' | null>(null);
  const [f, setF] = useState({ code: '', name: '', rate: '', scope: 'both', group: 'standard', description: '' });
  useEffect(() => {
    if (edit === null) return;
    if (edit === 'new') setF({ code: '', name: '', rate: '', scope: 'both', group: 'standard', description: '' });
    else setF({ code: edit.code, name: edit.name, rate: edit.rate, scope: edit.scope, group: edit.group, description: edit.description });
  }, [edit]);
  return (
    <div className="max-w-[900px]">
      <Section
        title="Tax codes"
        sub={'Region: ' + (app.settings?.region_name ?? '') + '. Each line of an entry, invoice or bill can carry a code; the tax summary adds them up. Reverse charge codes book both sides of the tax.'}
        action={
          <Btn size="sm" variant="primary" icon={Plus} onClick={() => setEdit('new')}>
            Tax code
          </Btn>
        }
      >
        {app.taxCodes.length === 0 ? (
          <p className="text-[12.5px] text-[var(--lf-muted)]">No tax codes. Pick a sales tax or VAT region under Business, or add codes here.</p>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="pl-0">Code</th>
                <th>Name</th>
                <th className="r">Rate</th>
                <th>Group</th>
                <th>Used on</th>
              </tr>
            </thead>
            <tbody>
              {app.taxCodes.map((t) => (
                <tr key={t.id} data-click="true" onClick={() => setEdit(t)}>
                  <td className="pl-0 font-semibold">{t.code}</td>
                  <td className="max-w-[300px] truncate">{t.name}</td>
                  <td className="r num">{t.rate}%</td>
                  <td className="text-[var(--lf-ink-2)]">{t.group}</td>
                  <td className="text-[var(--lf-ink-2)]">{t.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {edit !== null && (
        <Modal
          open
          title={edit === 'new' ? 'New tax code' : edit.code}
          onClose={() => setEdit(null)}
          footer={
            <>
              {edit !== 'new' && (
                <Btn variant="danger" className="mr-auto" onClick={() => (run(api.updateTax(edit.id, { archived: true }), 'Archived'), setEdit(null))}>
                  Archive
                </Btn>
              )}
              <Btn onClick={() => setEdit(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={() => (run(edit === 'new' ? api.createTax(f) : api.updateTax(edit.id, f), 'Saved'), setEdit(null))}>
                Save
              </Btn>
            </>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code">
              <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={input} />
            </Field>
            <Field label="Rate %">
              <input value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={cn(input, 'num')} />
            </Field>
            <Field label="Group">
              <Select label="Group" value={f.group} onChange={(v) => setF({ ...f, group: v })} options={['standard', 'reduced', 'zero', 'exempt', 'reverse', 'outside'].map((g) => ({ value: g, label: g }))} />
            </Field>
            <Field label="Name" className="col-span-2">
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
            </Field>
            <Field label="Used on">
              <Select label="Scope" value={f.scope} onChange={(v) => setF({ ...f, scope: v })} options={[{ value: 'both', label: 'Both' }, { value: 'sales', label: 'Sales' }, { value: 'purchases', label: 'Purchases' }]} />
            </Field>
            <Field label="When to use it" className="col-span-3">
              <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} className={area} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

const FIELD_LABEL: Record<string, string> = { payee: 'Payee', description: 'Description', amount: 'Amount', direction: 'Direction', account: 'Bank account' };
const OP_LABEL: Record<string, string> = { contains: 'contains', not_contains: 'does not contain', equals: 'is', starts_with: 'starts with', ends_with: 'ends with', regex: 'matches pattern', gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most', between: 'between' };

function ruleText(r: Rule, app: ReturnType<typeof useApp>): string {
  const conds = r.conditions.map((c) => FIELD_LABEL[c.field] + ' ' + OP_LABEL[c.op] + ' ' + (c.field === 'account' ? app.accountName(c.value) : c.field === 'direction' ? (c.value === 'in' ? 'money in' : 'money out') : '“' + c.value + '”') + (c.value2 ? ' and ' + c.value2 : ''));
  return conds.join(r.match === 'any' ? ' or ' : ' and ');
}

function actionText(r: Rule, app: ReturnType<typeof useApp>): string {
  const a = r.actions;
  const parts: string[] = [];
  if (a.splits) parts.push('split ' + a.splits.map((s) => s.percent + '% ' + app.accountName(s.account)).join(', '));
  else if (a.account) parts.push(app.accountName(a.account));
  if (a.tax_code) parts.push(app.taxName(a.tax_code));
  if (a.contact) parts.push('contact ' + a.contact);
  if (a.payee) parts.push('payee ' + a.payee);
  return parts.join(' · ');
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(rule?.name ?? '');
  const [match, setMatch] = useState<'all' | 'any'>(rule?.match ?? 'all');
  const [conds, setConds] = useState(rule?.conditions ?? [{ field: 'payee', op: 'contains', value: '' }]);
  const [account, setAccount] = useState(rule?.actions.account ?? '');
  const [tax, setTax] = useState(rule?.actions.tax_code ?? '');
  const [contact, setContact] = useState(rule?.actions.contact ?? '');
  const [auto, setAuto] = useState(rule?.auto_post ?? false);
  const [oneTime, setOneTime] = useState(rule?.one_time ?? false);
  const [test, setTest] = useState<{ count: number; open: number } | null>(null);
  const valid = conds.every((c) => c.value.trim() !== '') && account !== '';
  useEffect(() => {
    if (!conds.every((c) => c.value.trim() !== '')) return setTest(null);
    const t = setTimeout(() => {
      api
        .testRule(conds, match)
        .then((r) => setTest({ count: r.count, open: r.open }))
        .catch(() => setTest(null));
    }, 300);
    return () => clearTimeout(t);
  }, [conds, match]);
  const save = (): void => {
    const p = { name, match, conditions: conds, actions: { account, tax_code: tax || undefined, contact: contact || undefined }, auto_post: auto, one_time: oneTime };
    run((rule === null ? api.createRule(p) : api.updateRule(rule.id, p)).then(onClose), 'Rule saved');
  };
  return (
    <Modal
      open
      width="lg"
      title={rule === null ? 'New rule' : 'Edit rule'}
      description="Rules run in order on every imported line; the first that applies decides. Lines already in the inbox are rechecked when you save."
      onClose={onClose}
      footer={
        <>
          {test !== null && (
            <span className="mr-auto text-[12px] text-[var(--lf-muted)]">
              Applies to {test.count} line{test.count === 1 ? '' : 's'}, {test.open} waiting
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!valid} onClick={save}>
            Save
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="e.g. Software subscriptions" />
        </Field>
        <div className="flex items-center gap-2 text-[12.5px]">
          When
          <Select small label="Match" value={match} onChange={(v) => setMatch(v as 'all' | 'any')} className="w-24" options={[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} />
          of these hold:
        </div>
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select small label="Field" value={c.field} onChange={(v) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, field: v, op: v === 'amount' ? 'gt' : v === 'direction' || v === 'account' ? 'equals' : 'contains', value: v === 'direction' ? 'out' : '' } : x)))} className="w-32" options={Object.keys(FIELD_LABEL).map((f) => ({ value: f, label: FIELD_LABEL[f] ?? f }))} />
            {c.field === 'direction' ? (
              <Select small label="Direction" value={c.value} onChange={(v) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, value: v } : x)))} className="flex-1" options={[{ value: 'out', label: 'is money out' }, { value: 'in', label: 'is money in' }]} />
            ) : c.field === 'account' ? (
              <AccountPicker small value={c.value} onChange={(v) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, value: v } : x)))} filter={isCash} className="flex-1" />
            ) : (
              <>
                <Select small label="Operator" value={c.op} onChange={(v) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, op: v } : x)))} className="w-40" options={(c.field === 'amount' ? ['equals', 'gt', 'gte', 'lt', 'lte', 'between'] : ['contains', 'not_contains', 'equals', 'starts_with', 'ends_with', 'regex']).map((o) => ({ value: o, label: OP_LABEL[o] ?? o }))} />
                <input value={c.value} onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={cn(input, 'h-6 flex-1 text-[12px]')} placeholder={c.field === 'amount' ? '100.00' : 'text'} />
                {c.op === 'between' && <input value={c.value2 ?? ''} onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, value2: e.target.value } : x)))} className={cn(input, 'h-6 w-24 text-[12px]')} placeholder="and" />}
              </>
            )}
            <IconBtn icon={X} label="Remove condition" size={22} onClick={() => setConds((cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs))} />
          </div>
        ))}
        <div>
          <Btn size="xs" variant="ghost" icon={Plus} onClick={() => setConds((cs) => [...cs, { field: 'description', op: 'contains', value: '' }])}>
            Condition
          </Btn>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-[var(--lf-hair)] pt-3 sm:grid-cols-3">
          <Field label="Book to">
            <AccountPicker label="Book to" value={account} onChange={setAccount} filter={(a) => a.system !== 'ar' && a.system !== 'ap'} />
          </Field>
          <Field label="Tax">
            <TaxPicker value={tax} onChange={setTax} />
          </Field>
          <Field label="Contact">
            <input value={contact} onChange={(e) => setContact(e.target.value)} className={input} placeholder="Optional" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[12.5px]">
          <Toggle checked={auto} onChange={setAuto} label="Book automatically" /> Book matching lines automatically, without review
        </label>
        <label className="flex items-center gap-2 text-[12.5px]">
          <Toggle checked={oneTime} onChange={setOneTime} label="One time" /> Turn off after the first line it books
        </label>
      </div>
    </Modal>
  );
}

function RulesTab(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.rules(), ['rules'], []);
  const rules = live.data?.rules ?? [];
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const move = (i: number, dir: -1 | 1): void => {
    const order = rules.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    run(api.reorderRules(order), 'Reordered');
  };
  return (
    <div className="max-w-[980px]">
      {confirmEl}
      <Section
        title="Rules"
        sub="Book recurring bank lines the same way every time. The first rule that applies wins, so put precise rules first. Rules your AI agent proposes wait here until you turn them on."
        action={
          <Btn size="sm" variant="primary" icon={Plus} onClick={() => setEdit('new')}>
            Rule
          </Btn>
        }
      >
        {rules.length === 0 && <p className="text-[12.5px] text-[var(--lf-muted)]">No rules yet. Tick “Always book … like this” when you book a line, or add one here.</p>}
        <div className="flex flex-col">
          {rules.map((r, i) => (
            <div key={r.id} className={cn('group flex items-start gap-3 border-b border-[var(--lf-hair)] py-2', r.status === 'disabled' && 'opacity-55')}>
              <span className="num mt-0.5 w-5 shrink-0 text-right text-[11px] text-[var(--lf-muted)]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                  {r.name}
                  {r.status === 'proposed' && <Chip tone="accent">Proposed by AI</Chip>}
                  {r.auto_post && <Chip tone="ink">Automatic</Chip>}
                  {r.one_time && <Chip>One time</Chip>}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--lf-ink-2)]">
                  {ruleText(r, app)} → <b>{actionText(r, app)}</b>
                </p>
                <p className="mt-0.5 text-[11.5px] text-[var(--lf-muted)]">
                  {r.hits} line{r.hits === 1 ? '' : 's'}
                  {r.last_hit ? ', last ' + day(r.last_hit, true) : ''}
                  {r.note ? ' · ' + r.note : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.status === 'proposed' && (
                  <Btn size="xs" variant="primary" icon={CheckIcon} onClick={() => run(api.updateRule(r.id, { status: 'active' }), 'Rule turned on')}>
                    Turn on
                  </Btn>
                )}
                {r.status !== 'proposed' && <IconBtn icon={r.status === 'active' ? Pause : Play} label={r.status === 'active' ? 'Turn off' : 'Turn on'} size={24} onClick={() => run(api.updateRule(r.id, { status: r.status === 'active' ? 'disabled' : 'active' }), r.status === 'active' ? 'Turned off' : 'Turned on')} />}
                <IconBtn icon={ArrowUp} label="Move up" size={24} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconBtn icon={ArrowDown} label="Move down" size={24} disabled={i === rules.length - 1} onClick={() => move(i, 1)} />
                <Btn size="xs" variant="ghost" onClick={() => setEdit(r)}>
                  Edit
                </Btn>
                <IconBtn
                  icon={Trash2}
                  label="Delete"
                  size={24}
                  onClick={() =>
                    void confirm('Lines it booked stay booked.', 'Delete the rule “' + r.name + '”?').then((ok) => {
                      if (ok) run(api.deleteRule(r.id), 'Rule deleted');
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Section>
      {edit !== null && <RuleDialog rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/* -------------------------------------------------------------- recurring */

function ScheduleDialog({ from, onClose }: { from: { type: 'transaction' | 'document'; id: string } | null; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [tpl, setTpl] = useState<{ kind: Schedule['kind']; template: Record<string, unknown>; date: string } | null>(null);
  const [name, setName] = useState('');
  const [freq, setFreq] = useState('monthly');
  const [next, setNext] = useState(today());
  const [auto, setAuto] = useState(false);
  // From scratch: a simple expense.
  const [fromAcc, setFromAcc] = useState(app.accounts.find(isCash)?.id ?? '');
  const [cat, setCat] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (from === null) return;
    api
      .templateFrom(from.type, from.id)
      .then((r) => {
        setTpl(r);
        setName(String(r.template['narration'] ?? '') || (r.kind === 'transaction' ? 'Recurring entry' : 'Recurring ' + r.kind));
        const d = new Date(r.date + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + 1);
        setNext(d.toISOString().slice(0, 10));
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  }, [from]);
  const save = (): void => {
    const body =
      tpl !== null
        ? { name, kind: tpl.kind, template: tpl.template, frequency: freq, next_date: next, auto }
        : { name: name || 'Recurring expense', kind: 'transaction', template: { kind: 'expense', from: fromAcc, category: cat, amount, narration: name }, frequency: freq, next_date: next, auto };
    run(api.createSchedule(body).then(onClose), 'Schedule added');
  };
  return (
    <Modal
      open
      title="New schedule"
      description={tpl !== null ? 'Repeats ' + (tpl.kind === 'transaction' ? 'this entry' : 'this ' + tpl.kind) + '. Each one waits for you as a proposed entry or a draft unless automatic.' : 'A repeating expense, e.g. rent or a subscription paid by card.'}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={tpl === null && (cat === '' || amount === '')}>
            Save
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </Field>
        {tpl === null && (
          <>
            <Field label="Paid from">
              <AccountPicker label="Paid from" value={fromAcc} onChange={setFromAcc} filter={isCash} order={['asset', 'liability']} />
            </Field>
            <Field label="Category">
              <AccountPicker label="Category" value={cat} onChange={setCat} filter={(a) => a.type === 'expense'} />
            </Field>
            <Field label="Amount">
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <span />
          </>
        )}
        <Field label="Every">
          <Select label="Frequency" value={freq} onChange={setFreq} options={[{ value: 'weekly', label: 'Week' }, { value: 'monthly', label: 'Month' }, { value: 'quarterly', label: 'Quarter' }, { value: 'yearly', label: 'Year' }]} />
        </Field>
        <Field label="Next on">
          <DateInput value={next} onChange={setNext} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-[12.5px]">
          <Toggle checked={auto} onChange={setAuto} label="Automatic" /> Post or approve automatically
        </label>
      </div>
    </Modal>
  );
}

function RecurringTab({ from }: { from: { type: 'transaction' | 'document'; id: string } | null }): React.JSX.Element {
  const live = useLive(() => api.schedules(), ['recurring'], []);
  const list = live.data?.schedules ?? [];
  const [adding, setAdding] = useState<boolean>(from !== null);
  const [confirmEl, confirm] = useConfirm();
  return (
    <div className="max-w-[900px]">
      {confirmEl}
      <Section
        title="Recurring"
        sub="Rent, subscriptions, retainers: entries, invoices and bills that repeat. They are created on their date and wait for you unless set to automatic."
        action={
          <div className="flex gap-2">
            <Btn size="sm" icon={RefreshCw} onClick={() => run(api.runSchedules(), 'Checked the schedules')}>
              Run due now
            </Btn>
            <Btn size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Schedule
            </Btn>
          </div>
        }
      >
        {list.length === 0 && <p className="text-[12.5px] text-[var(--lf-muted)]">No schedules. Open an entry or a document and choose “Repeat on a schedule”.</p>}
        {list.length > 0 && (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="pl-0">Name</th>
                <th>What</th>
                <th>Every</th>
                <th>Next</th>
                <th className="r">Made</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-55'}>
                  <td className="max-w-[260px] truncate pl-0 font-medium">
                    {s.name}
                    {s.auto && <Chip className="ml-2">Automatic</Chip>}
                  </td>
                  <td className="text-[var(--lf-ink-2)]">{s.kind === 'transaction' ? 'Entry' : s.kind === 'invoice' ? 'Invoice' : 'Bill'}</td>
                  <td className="text-[var(--lf-ink-2)]">{(s.interval > 1 ? s.interval + ' ' : '') + s.frequency.replace('ly', s.interval > 1 ? 's' : '').replace('dai', 'day')}</td>
                  <td className="num">{s.active ? day(s.next_date, true) : 'Paused'}</td>
                  <td className="r num">{s.count}</td>
                  <td className="r">
                    <div className="flex justify-end gap-1">
                      <Btn size="xs" variant="ghost" onClick={() => run(api.runSchedules(s.id), 'Created the next one')}>
                        Run now
                      </Btn>
                      <IconBtn icon={s.active ? Pause : Play} label={s.active ? 'Pause' : 'Resume'} size={22} onClick={() => run(api.updateSchedule(s.id, { active: !s.active }), s.active ? 'Paused' : 'Resumed')} />
                      <IconBtn
                        icon={Trash2}
                        label="Delete"
                        size={22}
                        onClick={() =>
                          void confirm('What it created stays.', 'Delete “' + s.name + '”?').then((ok) => {
                            if (ok) run(api.deleteSchedule(s.id), 'Deleted');
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {adding && (
        <ScheduleDialog
          from={from}
          onClose={() => {
            setAdding(false);
            if (from !== null) setQuery({ from: undefined, id: undefined });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- currencies */

function CurrenciesTab(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.fx(), ['fx_rates', 'accounts'], []);
  const [cur, setCur] = useState('');
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('');
  const [rev, setRev] = useState(today());
  const [busy, setBusy] = useState(false);
  const inUse = live.data?.in_use ?? [];
  return (
    <div className="max-w-[900px]">
      <Section
        title="Exchange rates"
        sub={'Rates are ' + app.home + ' per 1 unit of the other currency. Entries use the latest rate on or before their date. Reference rates come from the European Central Bank.'}
        action={
          <Btn
            size="sm"
            icon={RefreshCw}
            loading={busy}
            onClick={() => {
              setBusy(true);
              api
                .fetchRates(30)
                .then((r) => toast.success('Stored ' + r.stored + ' rates' + (r.missing.length > 0 ? '; not published: ' + r.missing.join(', ') : '')))
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            Fetch 30 days
          </Btn>
        }
      >
        {inUse.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {inUse.map((c) => (
              <span key={c.currency} className="rounded-[5px] border border-[var(--lf-line)] px-2 py-1 text-[12px]">
                <b>{c.currency}</b> <span className="num text-[var(--lf-ink-2)]">{c.latest || 'no rate'}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Currency" className="w-28">
            <Select label="Currency" value={cur} onChange={setCur} options={[{ value: '', label: 'Choose' }, ...app.currencies.filter((c) => c.code !== app.home).map((c) => ({ value: c.code, label: c.code }))]} />
          </Field>
          <Field label="Date" className="w-40">
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label={'Rate (' + app.home + ' per 1)'} className="w-36">
            <input value={rate} onChange={(e) => setRate(e.target.value)} className={cn(input, 'num')} placeholder="1.0842" />
          </Field>
          <Btn disabled={cur === '' || rate === ''} onClick={() => run(api.setRate(cur, date, rate).then(() => setRate('')), 'Rate saved')}>
            Save rate
          </Btn>
        </div>
        <div className="mt-3 max-h-[300px] overflow-auto">
          <table className="lf-table">
            <thead>
              <tr>
                <th className="pl-0">Date</th>
                <th>Currency</th>
                <th className="r">Rate</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(live.data?.rates ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="num pl-0">{day(r.date)}</td>
                  <td className="font-semibold">{r.currency}</td>
                  <td className="r num">{r.rate}</td>
                  <td className="text-[var(--lf-ink-2)]">{r.source === 'ecb' ? 'ECB' : r.source}</td>
                  <td className="r">
                    <IconBtn icon={Trash2} label="Delete" size={22} onClick={() => run(api.deleteRate(r.id), 'Deleted')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Revalue foreign-currency accounts" sub="At period end, restate bank, card and cash accounts in other currencies at the rate on that date. The change is an unrealized exchange gain or loss.">
        <div className="flex items-end gap-2">
          <Field label="As of" className="w-40">
            <DateInput value={rev} onChange={setRev} />
          </Field>
          <Btn onClick={() => run(api.revalue(rev).then((r) => (r.transaction === null ? toast.success('Nothing to revalue') : undefined)), 'Revalued')}>Revalue</Btn>
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------- agent */

function AgentTab(): React.JSX.Element {
  const app = useApp();
  const s = app.settings!;
  const [pol, setPol] = useState(s.policy);
  useEffect(() => setPol(s.policy), [s.policy]);
  const dirty = JSON.stringify(pol) !== JSON.stringify(s.policy);
  const METHODS = [
    { v: 'match', l: 'Matches to entries already in the books' },
    { v: 'transfer', l: 'Transfers between your own accounts' },
    { v: 'document', l: 'Payments of open invoices and bills' },
    { v: 'memory', l: 'Payees booked the same way at least three times' },
  ];
  return (
    <div className="max-w-[820px]">
      <Section title="Categorizing bank lines" sub="Lines without a confident suggestion from your rules or history go to your AI agent, which proposes a category with its reason. You review its proposals in the Inbox.">
        <label className="flex items-center gap-2 text-[12.5px]">
          <Toggle checked={s.agent_categorize} onChange={(v) => run(api.updateSettings({ agent_categorize: v }), v ? 'Your AI agent categorizes new lines' : 'Your AI agent no longer gets new lines')} label="Send new lines to the AI agent" />
          Send imported lines to your AI agent
        </label>
      </Section>
      <Section
        title="What may post without review"
        sub="By default nothing your AI agent does reaches the books until you approve it."
        action={
          <Btn variant="primary" disabled={!dirty} onClick={() => run(api.updatePolicy(pol), 'Policy saved')}>
            Save
          </Btn>
        }
      >
        <label className="flex items-center gap-2 text-[12.5px]">
          <Toggle checked={pol.agent_auto_post} onChange={(v) => setPol({ ...pol, agent_auto_post: v })} label="Let the AI agent post" />
          Let your AI agent book lines it is highly confident about
        </label>
        {pol.agent_auto_post && (
          <div className="ml-10 mt-2 flex items-center gap-2 text-[12.5px]">
            up to
            <MoneyInput value={pol.ceiling} onChange={(v) => setPol({ ...pol, ceiling: v })} placeholder="any amount" className="w-32" />
            {app.home} per line
          </div>
        )}
        <p className="mb-1.5 mt-4 text-[12px] font-semibold text-[var(--lf-ink-2)]">Book these suggestions on import when they are high confidence:</p>
        {METHODS.map((m) => (
          <label key={m.v} className="flex h-7 items-center gap-2 text-[12.5px]">
            <Check checked={pol.auto_methods.includes(m.v)} onChange={(v) => setPol({ ...pol, auto_methods: v ? [...pol.auto_methods, m.v] : pol.auto_methods.filter((x) => x !== m.v) })} label={m.l} />
            {m.l}
          </label>
        ))}
      </Section>
      <Section title="House rules" sub="Standing instructions your AI agent follows when it categorizes, e.g. “Coffee under $10 is Meals”, “Anything from Amazon over $300 is Equipment”, “Ask me about cash withdrawals”.">
        <textarea value={pol.house_rules} onChange={(e) => setPol({ ...pol, house_rules: e.target.value })} rows={5} className={area} />
        <div className="mt-2 flex justify-end">
          <Btn variant="primary" disabled={!dirty} onClick={() => run(api.updatePolicy(pol), 'Saved')}>
            Save
          </Btn>
        </div>
      </Section>
      <Section title="Limits" sub="Your AI agent cannot change anything dated on or before its lock date, cannot sign off a month, finish a reconciliation, write off a debt, move lock dates or change this policy. Every change it makes is logged by run and can be reverted.">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <Sparkles size={13} className="text-[var(--lf-accent-text)]" />
          AI agent lock date: <b>{s.agent_lock_date ? day(s.agent_lock_date) : 'none'}</b>
          <Btn size="xs" variant="ghost" onClick={() => go('close')}>
            Change in Close
          </Btn>
          <Btn size="xs" variant="ghost" onClick={() => go('activity', { tab: 'runs' })}>
            See its runs
          </Btn>
        </div>
      </Section>
    </div>
  );
}

/* ----------------------------------------------------------------- imports */

function ImportsTab(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.imports(), ['statement_imports'], []);
  const profiles = useLive(() => api.profiles(), ['statement_imports'], []);
  const [confirmEl, confirm] = useConfirm();
  return (
    <div className="max-w-[980px]">
      {confirmEl}
      <Section title="Statement imports" sub="Undo an import to take its lines back out; entries it booked are voided (not possible once reconciled).">
        {(live.data?.imports ?? []).length === 0 ? (
          <p className="text-[12.5px] text-[var(--lf-muted)]">No imports yet.</p>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="pl-0">File</th>
                <th>Account</th>
                <th>Period</th>
                <th className="r">New</th>
                <th className="r">Duplicate</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(live.data?.imports ?? []).map((i) => (
                <tr key={i.id} className={i.status === 'undone' ? 'opacity-50' : ''}>
                  <td className="max-w-[220px] truncate pl-0 font-medium">
                    {i.file_name || 'Lines'} <span className="text-[11px] uppercase text-[var(--lf-muted)]">{i.format}</span>
                  </td>
                  <td className="max-w-[160px] truncate">{app.accountName(i.account)}</td>
                  <td className="num text-[var(--lf-ink-2)]">{i.period_from ? day(i.period_from, true) + ' – ' + day(i.period_to, true) : ''}</td>
                  <td className="r num">{i.new_count}</td>
                  <td className="r num">{i.dup_count}</td>
                  <td className="text-[var(--lf-ink-2)]">
                    {ago(i.created)}
                    {i.added_by === 'agent' && <Sparkles size={11} className="ml-1 inline text-[var(--lf-accent-text)]" />}
                  </td>
                  <td className="r">
                    {i.status === 'undone' ? (
                      <Chip>Undone</Chip>
                    ) : (
                      <Btn
                        size="xs"
                        variant="ghost"
                        icon={Undo2}
                        onClick={() =>
                          void confirm('Its ' + i.new_count + ' lines leave the inbox; entries booked from them are voided.', 'Undo this import?', 'Undo').then((ok) => {
                            if (ok) run(api.undoImport(i.id), 'Import undone');
                          })
                        }
                      >
                        Undo
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Saved CSV layouts" sub="Column layouts remembered per bank, so the next CSV from the same bank imports without questions.">
        {(profiles.data?.profiles ?? []).length === 0 && <p className="text-[12.5px] text-[var(--lf-muted)]">None yet.</p>}
        {(profiles.data?.profiles ?? []).map((p) => (
          <div key={p.id} className="flex h-8 items-center gap-2 border-b border-[var(--lf-hair)] text-[12.5px]">
            <span className="flex-1 font-medium">{p.name}</span>
            <span className="max-w-[360px] truncate text-[11.5px] text-[var(--lf-muted)]">{p.signature.split('|').join(', ')}</span>
            <IconBtn icon={Trash2} label="Forget" size={22} onClick={() => run(api.deleteProfile(p.id), 'Forgotten')} />
          </div>
        ))}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ export */

function ExportTab(): React.JSX.Element {
  const [format, setFormat] = useState('beancount');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="max-w-[760px]">
      <Section title="Export the books" sub="Plain text you own: Beancount (opens in Fava), an hledger journal, or CSV with every posting. Foreign amounts carry their home value.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Format" className="w-40">
            <Select label="Format" value={format} onChange={setFormat} options={[{ value: 'beancount', label: 'Beancount' }, { value: 'hledger', label: 'hledger journal' }, { value: 'csv', label: 'CSV postings' }]} />
          </Field>
          <Field label="From" className="w-40">
            <DateInput value={from} onChange={setFrom} />
          </Field>
          <Field label="To" className="w-40">
            <DateInput value={to} onChange={setTo} />
          </Field>
          <Btn
            variant="primary"
            icon={Download}
            loading={busy}
            onClick={() => {
              setBusy(true);
              api
                .exportBooks(format, from || undefined, to || undefined)
                .then((r) => downloadBlob(r.file_name, new Blob([r.content], { type: r.mime })))
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            Download
          </Btn>
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------- view */

export function SetupView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const tab = (TABS.some((t) => t.value === q['tab']) ? q['tab'] : 'business') as Tab;
  const from = useMemo(() => (q['from'] === 'transaction' || q['from'] === 'document') && q['id'] ? { type: q['from'] as 'transaction' | 'document', id: q['id'] } : null, [q]);
  useReportScreen('setup', null, { tab });
  const app = useApp();
  if (app.settings === null) return <span />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-10 shrink-0 border-b border-[var(--lf-line)] px-4">
        <Tabs value={tab} onChange={(v) => setQuery({ tab: v }, false)} tabs={TABS} className="h-full" />
      </div>
      <div className={cn('min-h-0 flex-1', tab === 'accounts' || tab === 'contacts' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {tab === 'business' && <BusinessTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'contacts' && <ContactsTab sel={q['contact'] ?? ''} />}
        {tab === 'tax' && <TaxTab />}
        {tab === 'rules' && <RulesTab />}
        {tab === 'recurring' && <RecurringTab from={from} />}
        {tab === 'currencies' && <CurrenciesTab />}
        {tab === 'agent' && <AgentTab />}
        {tab === 'imports' && <ImportsTab />}
        {tab === 'export' && <ExportTab />}
      </div>
    </div>
  );
}


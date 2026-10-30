/**
 * First run: what the books are for, the home currency, the sales tax / VAT
 * region and the fiscal year, then (optionally) opening balances. Creates a
 * chart of accounts to match; everything can change later in Setup.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Briefcase, Home, Layers } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { today } from '../lib/format.ts';
import { useApp } from '../lib/store.tsx';
import { Mark } from '../components/Shell.tsx';
import { DateInput, MoneyInput } from '../components/controls.tsx';
import { Btn, Field, Select, input } from '../components/ui.tsx';

/** Kept while the opening balances step shows (the books are already set up then). */
export const onboarding = { step2: false };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function Onboarding(): React.JSX.Element {
  const app = useApp();
  const [step, setStep] = useState<1 | 2>(onboarding.step2 ? 2 : 1);
  const [name, setName] = useState('');
  const [entity, setEntity] = useState<'business' | 'personal' | 'both'>('both');
  const [currency, setCurrency] = useState(app.settings?.home_currency ?? 'USD');
  const [region, setRegion] = useState('none');
  const [fy, setFy] = useState(1);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => {
    const d = today();
    return d.slice(0, 8) + '01';
  });
  const [opening, setOpening] = useState<Record<string, string>>({});

  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      onboarding.step2 = true;
      await api.applySetup({ business_name: name.trim(), entity, home_currency: currency, region, fiscal_year_start: fy });
      setStep(2);
      app.reloadAll();
    } catch (err) {
      onboarding.step2 = false;
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const balanceAccounts = useMemo(() => app.accounts.filter((a) => a.subtype === 'bank' || a.subtype === 'cash' || a.subtype === 'card' || a.subtype === 'loan'), [app.accounts]);

  const finish = async (): Promise<void> => {
    const items = Object.entries(opening)
      .filter(([, v]) => v.trim() !== '' && Number(v.replace(/,/g, '')) !== 0)
      .map(([account, amount]) => ({ account, amount }));
    setBusy(true);
    try {
      // The books open on the day before the first statement day.
      if (items.length > 0) {
        const d = new Date(date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        await api.opening(d.toISOString().slice(0, 10), items);
      }
      onboarding.step2 = false;
      window.location.hash = '#/home';
      app.reloadAll();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ENTITY = [
    { v: 'business' as const, icon: Briefcase, label: 'A business', sub: 'Invoices, bills, sales tax, profit and loss' },
    { v: 'personal' as const, icon: Home, label: 'A household', sub: 'Spending, budgets, net worth' },
    { v: 'both' as const, icon: Layers, label: 'Both', sub: 'A sole trader or freelancer with personal money too' },
  ];

  return (
    <div className="flex h-dvh items-start justify-center overflow-y-auto bg-[var(--lf-card)] px-4 py-10 text-[var(--lf-ink)] sm:items-center">
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-3">
          <Mark size={34} />
          <div>
            <h1 className="text-[18px] font-bold leading-6">Set up your books</h1>
            <p className="text-[12.5px] text-[var(--lf-muted)]">{step === 1 ? 'Four answers and Ledgerflow builds a chart of accounts to match. You can change all of it later.' : 'Optional: what your accounts held on the day the books start, so balances are right from day one.'}</p>
          </div>
        </div>
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Field label="What are these books for?">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ENTITY.map((e) => {
                  const Icon = e.icon;
                  return (
                    <button key={e.v} type="button" onClick={() => setEntity(e.v)} aria-pressed={entity === e.v} className={cn('flex flex-col gap-1 rounded-[6px] border p-3 text-left transition-colors', entity === e.v ? 'border-[var(--lf-ink)] bg-[var(--lf-row)]' : 'border-[var(--lf-line)] hover:bg-[var(--lf-row)]')}>
                      <Icon size={16} className="text-[var(--lf-ink-2)]" />
                      <span className="text-[13px] font-bold">{e.label}</span>
                      <span className="text-[11.5px] leading-4 text-[var(--lf-muted)]">{e.sub}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={entity === 'personal' ? 'Household name' : 'Business name'}>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder={entity === 'personal' ? 'The Lee household' : 'Northwind Studio'} autoFocus />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Home currency">
                <Select label="Home currency" value={currency} onChange={setCurrency} options={app.currencies.map((c) => ({ value: c.code, label: c.code + ' · ' + c.name }))} />
              </Field>
              <Field label="Sales tax or VAT">
                <Select label="Tax region" value={region} onChange={setRegion} options={app.regions.map((r) => ({ value: r.id, label: r.name }))} />
              </Field>
              <Field label="Fiscal year starts">
                <Select label="Fiscal year start" value={String(fy)} onChange={(v) => setFy(Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Btn variant="primary" size="md" loading={busy} onClick={() => void apply()}>
                Create my books <ArrowRight size={14} />
              </Btn>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <Field label="Books start on" hint="Usually the first day of the first bank statement you will import.">
              <DateInput value={date} onChange={setDate} className="w-44" />
            </Field>
            <div className="rounded-[6px] border border-[var(--lf-line)]">
              {balanceAccounts.map((a) => (
                <div key={a.id} className="flex h-10 items-center gap-3 border-b border-[var(--lf-hair)] px-3 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{a.name}</span>
                  <span className="text-[11.5px] text-[var(--lf-muted)]">{a.type === 'liability' ? 'owed' : 'balance'}</span>
                  <MoneyInput value={opening[a.id] ?? ''} onChange={(v) => setOpening((o) => ({ ...o, [a.id]: v }))} className="w-36" label={a.name} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <button type="button" className="text-[12.5px] font-semibold text-[var(--lf-muted)] hover:text-[var(--lf-ink)]" onClick={() => void finish()}>
                Skip for now
              </button>
              <Btn variant="primary" size="md" loading={busy} onClick={() => void finish()}>
                Open my books <ArrowRight size={14} />
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

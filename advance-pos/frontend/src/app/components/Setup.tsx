/**
 * First run: the store's name and currency, its sales tax, and the owner's
 * name and PIN. Everything else (products, staff, receipts, payments) is
 * set up later from the app, or by your AI agent.
 */
import { useMemo, useState } from 'react';
import { Check, ReceiptText, ShieldCheck, Sparkles, Store } from 'lucide-react';
import { api, errMessage } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { Mark } from './Shell.tsx';
import { Button, Field, Select, Toggle, inputCls, textareaCls } from './ui.tsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'HKD', 'TWD', 'KRW', 'SGD', 'MYR', 'IDR', 'THB', 'PHP', 'VND', 'INR', 'AED', 'SAR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'ZAR', 'BRL', 'MXN'];

function guessCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region ?? '';
    const byRegion: Record<string, string> = { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CN: 'CNY', HK: 'HKD', TW: 'TWD', KR: 'KRW', SG: 'SGD', MY: 'MYR', ID: 'IDR', TH: 'THB', PH: 'PHP', VN: 'VND', IN: 'INR', AE: 'AED', SA: 'SAR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', ZA: 'ZAR', BR: 'BRL', MX: 'MXN', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR' };
    return byRegion[region] ?? 'USD';
  } catch {
    return 'USD';
  }
}

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function Setup(): React.JSX.Element {
  const { setup, signIn, reload } = useSession();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState(guessCurrency);
  const [taxName, setTaxName] = useState('Sales tax');
  const [taxRate, setTaxRate] = useState('');
  const [inclusive, setInclusive] = useState(false);
  const [owner, setOwner] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = setup?.currencies_with_other_digits[currency] ?? 2;
  const sample = useMemo(() => money(currency, digits).fmt(digits === 0 ? 1250 : Math.round(12.5 * 10 ** digits)), [currency, digits]);
  const rate = taxRate.trim() === '' ? 0 : Number(taxRate.replace(',', '.'));
  const rateOk = taxRate.trim() === '' || (Number.isFinite(rate) && rate >= 0 && rate <= 100);
  const pinOk = /^\d{4,8}$/.test(pin);
  const ready = name.trim() !== '' && owner.trim() !== '' && pinOk && pin === pin2 && rateOk;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const u = await api.setup({
        business_name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        currency,
        prices_include_tax: inclusive,
        tax_name: taxName.trim() || 'Sales tax',
        tax_rate: rate,
        owner_name: owner.trim(),
        owner_pin: pin,
        register_name: 'Register 1',
      });
      signIn(u);
      reload();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ps-shell)] px-3 py-6 md:px-6">
      <div className="ps-rise grid w-full max-w-[960px] overflow-hidden rounded-[var(--ps-r-lg)] border border-[var(--ps-line)] bg-[var(--ps-card)] md:grid-cols-[320px_1fr]">
        <aside className="ps-on-dark flex flex-col gap-5 bg-[var(--ps-dark)] p-6 text-[var(--ps-on-dark)]">
          <Mark size={40} />
          <div>
            <h1 className="text-[15px] font-bold">Set up your store</h1>
            <p className="mt-1 text-[13px] text-[var(--ps-on-dark-muted)]">A few details and you can ring up your first sale. Products, staff and payment options come next.</p>
          </div>
          <ul className="flex flex-col gap-3 text-[13px]">
            {[
              { icon: Store, text: 'Sell from a touch screen, a keyboard or a barcode scanner' },
              { icon: ReceiptText, text: 'Receipts, returns, exchanges, split payments and tips' },
              { icon: ShieldCheck, text: 'Staff PINs with roles and manager approvals' },
              { icon: Sparkles, text: 'Your AI agent sends receipts, reviews the drawer and answers questions about the business' },
            ].map((x) => (
              <li key={x.text} className="flex gap-2.5">
                <x.icon size={16} className="mt-0.5 shrink-0 text-[var(--ps-accent)]" />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </aside>
        <form
          className="flex flex-col gap-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <section className="grid gap-3 sm:grid-cols-2">
            <h2 className="text-[13px] font-bold sm:col-span-2">The store</h2>
            <Field label="Business name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="Corner Cafe" />
            </Field>
            <Field label="Phone" hint="Printed on receipts">
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} inputMode="tel" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" hint="Printed on receipts">
                <textarea className={textareaCls} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={600} />
              </Field>
            </div>
          </section>

          <section className="grid gap-3 border-t border-[var(--ps-hair)] pt-4 sm:grid-cols-2">
            <h2 className="text-[13px] font-bold sm:col-span-2">Money and tax</h2>
            <Field label="Currency" hint={'Prices look like ' + sample}>
              <Select ariaLabel="Currency" value={currency} onChange={setCurrency} options={(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => ({ value: c, label: c + ' · ' + currencyName(c) }))} />
            </Field>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <Field label="Tax name">
                <input className={inputCls} value={taxName} onChange={(e) => setTaxName(e.target.value)} maxLength={60} />
              </Field>
              <Field label="Rate %" error={rateOk ? null : '0 to 100'}>
                <input className={inputCls + ' num text-right'} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" placeholder="0" />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 sm:col-span-2">
              <span>
                <span className="block text-[13px] font-semibold">Prices include tax</span>
                <span className="block text-[12px] text-[var(--ps-muted)]">On for VAT and GST stores where shelf prices are final; off when tax is added at the till.</span>
              </span>
              <Toggle checked={inclusive} onChange={setInclusive} label="Prices include tax" />
            </label>
          </section>

          <section className="grid gap-3 border-t border-[var(--ps-hair)] pt-4 sm:grid-cols-3">
            <h2 className="text-[13px] font-bold sm:col-span-3">You, the owner</h2>
            <Field label="Your name">
              <input className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} autoComplete="name" />
            </Field>
            <Field label="PIN" hint="4 to 8 digits; you sign in with it" error={pin !== '' && !pinOk ? '4 to 8 digits' : null}>
              <input className={inputCls + ' num tracking-[0.3em]'} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </Field>
            <Field label="PIN again" error={pin2 !== '' && pin2 !== pin ? 'Does not match' : null}>
              <input className={inputCls + ' num tracking-[0.3em]'} type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </Field>
          </section>

          {error !== null && <p className="rounded-[var(--ps-r)] bg-[var(--ps-red)]/10 px-3 py-2 text-[13px] font-medium text-[var(--ps-red-text)]">{error}</p>}
          <div className="flex items-center justify-end gap-3 border-t border-[var(--ps-hair)] pt-4">
            <span className="text-[12px] text-[var(--ps-muted)]">You can change all of this later in Settings.</span>
            <Button type="submit" variant="primary" size="lg" icon={Check} loading={busy} disabled={!ready}>
              Open the store
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

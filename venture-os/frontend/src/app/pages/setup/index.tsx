/**
 * First run, linear (SPEC 3): Firm, Fund, You, PIN. One screen each, at
 * most three fields, defaults filled (the browser's zone, the firm's
 * currency, this year, "Fund I"). The recovery code shows once with Copy.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button, ChipPicker, Field, Input, MoneyInput, Notice, PinBoxes, Picker, StepTrack } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { signedIn } from '../../lib/auth.ts';
import { majorParam } from '../../lib/format.ts';
import type { Me } from '../../lib/types.ts';
import { OnceCode, Welcome } from '../auth/index.tsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'INR'] as const;

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

type Step = 0 | 1 | 2 | 3;

export function SetupPage(): React.JSX.Element {
  const [step, setStep] = useState<Step>(0);
  const [firm, setFirm] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [other, setOther] = useState('');
  const [zone, setZone] = useState(browserZone);
  const [fund, setFund] = useState('Fund I');
  const [size, setSize] = useState<number | null>(null);
  const [vintage, setVintage] = useState(String(new Date().getFullYear()));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; me: Me; code: string } | null>(null);
  const zoneItems = useMemo(() => zones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);

  const cur = currency === 'other' ? other.trim().toUpperCase() : currency;
  const okFirm = firm.trim() !== '' && /^[A-Z]{3}$/.test(cur) && zone !== '';
  const okFund = fund.trim() !== '' && /^\d{4}$/.test(vintage);
  const okYou = name.trim() !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8;
  const weak = pin.length === 6 && pin.split('').every((d) => d === pin.charAt(0));
  const okPin = pin.length === 6 && !weak && pin2 === pin;

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me; recovery_code: string }>(
        'setup.complete',
        { firm_name: firm.trim(), base_currency: cur, zone, fund_name: fund.trim(), fund_size: majorParam(size, cur), fund_vintage: vintage, fund_currency: cur, owner_name: name.trim(), email: email.trim(), password, pin },
        { quiet: true },
      );
      setDone({ token: r.token, me: r.me, code: r.recovery_code });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = (ok: boolean, to: Step) => (e: React.FormEvent): void => {
    e.preventDefault();
    if (ok) setStep(to);
  };
  const back = step > 0 && done === null ? <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep((s) => (s - 1) as Step)} aria-label="Back" /> : <span />;

  return (
    <Welcome>
      <StepTrack labels={['Firm', 'Fund', 'You', 'PIN']} at={done !== null ? 4 : step} className="mb-7" />
      {done !== null ? (
        <div className="flex flex-col gap-4">
          <h1 className="text-[15px] font-semibold">Recovery code</h1>
          <OnceCode code={done.code} />
          <Notice tone="warn">Shown once. Keep it safe.</Notice>
          <Button variant="primary" size="lg" onClick={() => signedIn(done.token, done.me)}>
            Open Venture OS
          </Button>
        </div>
      ) : step === 0 ? (
        <form className="flex flex-col gap-4" onSubmit={next(okFirm, 1)}>
          <h1 className="text-[15px] font-semibold">Your firm</h1>
          <Field label="Name">
            <Input value={firm} autoFocus onChange={(e) => setFirm(e.target.value)} aria-label="Firm name" placeholder="Harbor Ventures" />
          </Field>
          <Field label="Currency">
            <ChipPicker label="Currency" options={[...CURRENCIES.map((c) => ({ value: c as string, label: c as string })), { value: 'other', label: 'Other' }]} value={currency} onChange={setCurrency} />
            {currency === 'other' && <Input className="vo-mono mt-1.5 w-24 uppercase" maxLength={3} value={other} onChange={(e) => setOther(e.target.value)} aria-label="Currency code" placeholder="CHF" autoFocus />}
          </Field>
          <Field label="Time zone">
            <Picker value={zone} onChange={(v) => setZone(v)} items={zoneItems} label="Time zone" />
          </Field>
          <div className="flex items-center justify-between pt-1">
            {back}
            <Button type="submit" variant="primary" iconRight={ArrowRight} disabled={!okFirm}>
              Continue
            </Button>
          </div>
        </form>
      ) : step === 1 ? (
        <form className="flex flex-col gap-4" onSubmit={next(okFund, 2)}>
          <h1 className="text-[15px] font-semibold">First fund</h1>
          <Field label="Name">
            <Input value={fund} autoFocus onChange={(e) => setFund(e.target.value)} aria-label="Fund name" />
          </Field>
          <Field label="Size" tip="Committed capital. Type 50m or 50,000,000.">
            <MoneyInput value={size} onChange={setSize} currency={cur} label="Fund size" placeholder="50m" />
          </Field>
          <Field label="Vintage">
            <Input className="vo-mono w-24" inputMode="numeric" maxLength={4} value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, ''))} aria-label="Vintage year" />
          </Field>
          <div className="flex items-center justify-between pt-1">
            {back}
            <Button type="submit" variant="primary" iconRight={ArrowRight} disabled={!okFund}>
              Continue
            </Button>
          </div>
        </form>
      ) : step === 2 ? (
        <form className="flex flex-col gap-4" onSubmit={next(okYou, 3)}>
          <h1 className="text-[15px] font-semibold">You</h1>
          <Field label="Name">
            <Input value={name} autoFocus autoComplete="name" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          </Field>
          <Field label="Password" tip="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          </Field>
          <div className="flex items-center justify-between pt-1">
            {back}
            <Button type="submit" variant="primary" iconRight={ArrowRight} disabled={!okYou}>
              Continue
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (okPin) void finish();
          }}
        >
          <h1 className="flex items-center gap-1.5 text-[15px] font-semibold">Approval PIN</h1>
          <Field label="PIN" tip="Six digits. Asked for votes, marks, notices and exports.">
            <PinBoxes value={pin} onChange={setPin} autoFocus label="PIN" align="start" invalid={weak} />
          </Field>
          <Field label="Again" error={weak ? 'Use different digits.' : pin2.length === 6 && pin2 !== pin ? 'The PINs differ.' : error}>
            <PinBoxes value={pin2} onChange={setPin2} label="PIN again" align="start" invalid={pin2.length === 6 && pin2 !== pin} />
          </Field>
          <div className="flex items-center justify-between pt-1">
            {back}
            <Button type="submit" variant="primary" busy={busy} disabled={!okPin}>
              Finish
            </Button>
          </div>
        </form>
      )}
    </Welcome>
  );
}

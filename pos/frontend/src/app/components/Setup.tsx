/**
 * First open: two numbered steps side by side and the register is ready.
 * 1) the business and its country (which sets the currency, the tax classes
 * and how prices and cash round), 2) the owner and their PIN. Everything can
 * be changed later in Settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { OpError, api } from '../lib/api.ts';
import { percent } from '../lib/format.ts';
import { session } from '../lib/session.ts';
import type { Region } from '../lib/types.ts';
import { Keypad } from './Keypad.tsx';
import type { KeypadKey } from './Keypad.tsx';
import { Mark } from './Shell.tsx';
import { Button, Field, Select, Stage, Step, TextField } from './ui.tsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'TWD', 'KRW', 'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'INR', 'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'TRY', 'ZAR', 'AED', 'SAR'];

function PinChooser({ onPin, busy, ready }: { onPin: (pin: string) => void; busy: boolean; ready: boolean }): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const confirm = useCallback(
    (value: string): void => {
      if (value.length < 4 || !ready) return;
      if (first === null) {
        setFirst(value);
        setPin('');
        return;
      }
      if (value !== first) {
        setFirst(null);
        setPin('');
        setError('The two PINs were different. Choose it again.');
        return;
      }
      onPin(value);
    },
    [first, onPin, ready],
  );
  const onKey = useCallback(
    (k: KeypadKey): void => {
      setError('');
      if (k === 'back') setPin(pin.slice(0, -1));
      else if (k !== '.' && k !== '00' && pin.length < 6) setPin(pin + k);
    },
    [pin],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-full bg-[var(--ps-row)] py-3 pl-5 pr-5">
        <span className="text-[13px] font-semibold text-[var(--ps-ink-2)]">{first === null ? 'Your PIN (4 to 6 digits)' : 'The same PIN again'}</span>
        <div className="flex gap-2" aria-label={`${pin.length} digits typed`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={cn('size-3.5 rounded-full', i < pin.length ? 'bg-[var(--ps-ink)]' : 'bg-[var(--ps-track)]')} />
          ))}
        </div>
      </div>
      <Keypad onKey={onKey} onEnter={() => confirm(pin)} size="md" />
      {error !== '' && (
        <p className="px-1 text-[12px] font-semibold text-[var(--ps-red-text)]" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" size="lg" icon={first === null ? ArrowRight : Check} dot loading={busy} disabled={pin.length < 4 || busy || !ready} onClick={() => confirm(pin)} className="w-full">
        {first === null ? 'Next' : 'Open the register'}
      </Button>
    </div>
  );
}

export function Setup(): React.JSX.Element {
  const [regions, setRegions] = useState<Region[]>([]);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [currency, setCurrency] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .regions()
      .then((r) => setRegions(r.regions))
      .catch(() => undefined);
  }, []);
  const preset = regions.find((r) => r.code === region);
  const finish = async (pin: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.setup({ business_name: name.trim(), region, currency: currency || (preset?.currency ?? ''), owner_name: owner.trim(), pin });
      const reg = res.session.staff;
      session.signIn(res.session);
      toast.success(`Welcome, ${reg.name}`);
    } catch (err) {
      if (!(err instanceof OpError)) toast.error('Could not set up the register');
    } finally {
      setBusy(false);
    }
  };
  const step1Done = name.trim() !== '' && region !== '';
  return (
    <Stage className="flex-col px-4 py-8 md:px-10 md:py-10">
      <header className="ps-rise mb-6 flex items-center gap-4">
        <Mark size={48} />
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Set up your register</h1>
          <p className="text-[13px] text-[var(--ps-muted)]">Two steps. Change anything later in Settings.</p>
        </div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Step n={1} state={step1Done ? 'done' : 'current'} title="Your business" hint="Required" delay={1}>
          <div className="flex flex-col gap-5">
            <TextField label="Business name (printed on receipts)" value={name} onChange={setName} placeholder="Corner Cafe" autoFocus maxLength={80} />
            <Field label="Where is it? (sets the currency and taxes)">
              <div role="radiogroup" aria-label="Country" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {regions.map((r) => {
                  const on = r.code === region;
                  const main = r.classes.find((c) => c.is_default === true) ?? r.classes[0];
                  return (
                    <button
                      key={r.code}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setRegion(r.code);
                        setCurrency(r.currency);
                      }}
                      className={cn('ps-press flex items-center gap-3 rounded-[18px] px-4 py-3 text-left', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold">{r.label}</span>
                        <span className={cn('block truncate text-[12px]', on ? 'text-[var(--ps-shell)]' : 'text-[var(--ps-muted)]')}>
                          {r.currency}
                          {main !== undefined && r.code !== 'OTHER' && r.code !== 'US' ? ` · ${main.name}` : ''}
                          {r.price_mode === 'inclusive' ? ' · prices include tax' : ' · tax added at checkout'}
                        </span>
                      </span>
                      {on && (
                        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ps-dot)] text-[var(--ps-on-dot)]">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Field>
            {preset !== undefined && (
              <div className="ps-on-sand ps-pop grid grid-cols-1 gap-4 rounded-[22px] bg-[var(--ps-sand)] p-4 sm:grid-cols-2">
                <Select label="Currency" value={currency} onChange={setCurrency} options={[...new Set([preset.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} tone="card" />
                <div className="flex flex-col gap-2">
                  <span className="px-1 text-[13px] font-semibold text-[var(--ps-ink-2)]">Taxes to start with</span>
                  <ul className="flex flex-col gap-1 px-1 text-[13px]">
                    {preset.classes.map((c) => (
                      <li key={c.name} className="flex justify-between gap-3">
                        <span className="font-semibold">{c.name}</span>
                        <span className="num text-[var(--ps-muted)]">{percent(c.rate_bp)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </Step>
        <Step n={2} state={step1Done ? 'current' : 'todo'} title="You and your PIN" hint="You are the owner" delay={2}>
          <div className="flex flex-col gap-5">
            <TextField label="Your name" value={owner} onChange={setOwner} placeholder="Aiko" maxLength={40} hint="You can add staff and change everything." />
            <PinChooser busy={busy} ready={step1Done && owner.trim() !== ''} onPin={(pin) => void finish(pin)} />
          </div>
        </Step>
      </div>
    </Stage>
  );
}

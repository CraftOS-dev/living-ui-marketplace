/**
 * The lock screen: the store, the time, and the PIN pad. A PIN signs that
 * person in at this device's register; with "Clock in or out" chosen the
 * same pad records their shift on the time clock instead, without signing
 * in. A store with several registers asks which one this device is.
 */
import { useEffect, useMemo, useState } from 'react';
import { Clock, LogIn, WifiOff } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { OpError, api } from '../lib/api.ts';
import { longDay, time } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { Mark } from './Shell.tsx';
import { PinPad } from './pads.tsx';
import { Button, Segmented, Select } from './ui.tsx';

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function LockScreen(): React.JSX.Element {
  const { setup, signIn, deviceRegister, setDeviceRegister } = useSession();
  const now = useNow();
  const [mode, setMode] = useState<'sign_in' | 'clock'>('sign_in');
  const registers = useMemo(() => setup?.registers ?? [], [setup]);
  const register = registers.find((r) => r.id === deviceRegister) ?? registers[0] ?? null;

  useEffect(() => {
    if (register !== null && register.id !== deviceRegister) setDeviceRegister(register.id);
  }, [register, deviceRegister, setDeviceRegister]);

  const submit = async (pin: string): Promise<string | null> => {
    if (mode === 'clock') {
      try {
        const r = await api.clock(pin, 'toggle');
        toast.success(r.staff.name + (r.action === 'in' ? ' clocked in at ' : ' clocked out at ') + time(new Date()));
        setMode('sign_in');
        return null;
      } catch (err) {
        return err instanceof OpError ? err.message : 'Could not reach the store server';
      }
    }
    if (register === null) return 'This store has no register turned on';
    try {
      signIn(await api.unlock(pin, register.id));
      return null;
    } catch (err) {
      return err instanceof OpError ? (err.status === 0 ? 'Could not reach the store server' : err.message) : 'Something went wrong';
    }
  };

  return (
    <div className="ps-touch flex min-h-screen flex-col items-center justify-center bg-[var(--ps-shell)] px-4 py-8">
      <div className="ps-rise flex w-full max-w-[340px] flex-col items-center">
        {setup?.logo ? <img src={setup.logo} alt="" className="mb-3 max-h-14 max-w-[180px] object-contain" /> : <Mark size={44} />}
        <h1 className="mt-3 text-center text-[15px] font-bold">{setup?.business_name || 'Advance POS'}</h1>
        <p className="num mt-4 text-[26px] font-bold leading-8 tracking-tight">{time(now)}</p>
        <p className="text-[12px] text-[var(--ps-muted)]">{longDay(now)}</p>

        <Segmented
          className="mt-5"
          label="What the PIN does"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sign_in', label: 'Sign in', icon: LogIn },
            { value: 'clock', label: 'Clock in or out', icon: Clock },
          ]}
        />
        <p className={cn('mb-3 mt-3 text-[13px] font-semibold', mode === 'clock' ? 'text-[var(--ps-accent-text)]' : 'text-[var(--ps-ink-2)]')}>{mode === 'clock' ? 'Enter your PIN to clock in or out' : 'Enter your PIN'}</p>
        <PinPad key={mode} onSubmit={submit} submitLabel={mode === 'clock' ? 'Clock in or out' : 'Sign in'} />

        {registers.length > 1 && (
          <div className="mt-5 w-full max-w-[280px]">
            <Select label="This device is" value={register?.id ?? ''} onChange={setDeviceRegister} options={registers.map((r) => ({ value: r.id, label: r.name }))} />
          </div>
        )}
        {registers.length === 1 && register !== null && <p className="mt-5 text-[12px] text-[var(--ps-muted)]">{register.name}</p>}
      </div>
    </div>
  );
}

/** Shown when the store server cannot be reached. */
export function Unreachable({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ps-shell)] px-4">
      <div className="ps-rise flex max-w-sm flex-col items-center text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-[var(--ps-r-md)] bg-[var(--ps-row)] text-[var(--ps-ink-2)]">
          <WifiOff size={18} />
        </span>
        <h1 className="text-[15px] font-bold">The store server is not answering</h1>
        <p className="mt-1 text-[13px] text-[var(--ps-muted)]">Sales are kept on the server, so nothing is lost. Check that the app is running, then try again.</p>
        <Button variant="primary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

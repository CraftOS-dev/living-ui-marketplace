/**
 * Who is at the register: staff tiles (initials on their color), then a PIN
 * pad. Someone without a PIN (new, or cleared by the owner) chooses one by
 * typing it twice. Locking returns here and keeps the cart.
 *
 * Also the first question a new device asks when the shop has more than one
 * register: which register is this?
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Lock, MonitorSmartphone } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { OpError, api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_LABEL } from '../lib/format.ts';
import { session } from '../lib/session.ts';
import type { Register, Staff } from '../lib/types.ts';
import { Keypad } from './Keypad.tsx';
import type { KeypadKey } from './Keypad.tsx';
import { Mark } from './Shell.tsx';
import { Avatar, Button, IconBadge, IconButton, Stage } from './ui.tsx';

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
    </span>
  );
}

function Dots({ length, filled, shake }: { length: number; filled: number; shake: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex h-6 items-center justify-center gap-3', shake && 'ps-shake')} aria-label={`${filled} of ${length} digits`}>
      {Array.from({ length }, (_, i) => (
        <span key={i} className={cn('size-3.5 rounded-full transition-colors', i < filled ? 'bg-[var(--ps-ink)]' : 'bg-[var(--ps-track)]')} />
      ))}
    </div>
  );
}

function PinEntry({ person, register, onBack }: { person: Staff; register: string; onBack: () => void }): React.JSX.Element {
  const choosing = !person.pin_set;
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = (message: string): void => {
    setError(message);
    setShake(true);
    setPin('');
    window.setTimeout(() => setShake(false), 340);
  };

  const submit = useCallback(
    async (value: string): Promise<void> => {
      if (value.length < 4) return;
      if (choosing && first === null) {
        setFirst(value);
        setPin('');
        setError('');
        return;
      }
      if (choosing && first !== value) {
        setFirst(null);
        fail('The two PINs were different. Start again.');
        return;
      }
      setBusy(true);
      try {
        const info = choosing ? await api.firstPin(person.id, value, register) : await api.login(person.id, value, register);
        session.signIn(info);
      } catch (err) {
        fail(err instanceof OpError ? err.message : 'Could not sign in');
      } finally {
        setBusy(false);
      }
    },
    [choosing, first, person.id, register],
  );

  const onKey = useCallback(
    (k: KeypadKey): void => {
      if (busy) return;
      setError('');
      if (k === 'back') {
        setPin(pin.slice(0, -1));
        return;
      }
      if (k === '.' || k === '00' || pin.length >= 6) return;
      const next = pin + k;
      setPin(next);
      // A PIN is 4 to 6 digits: Enter (or Sign in) sends a shorter one, the sixth digit sends at once.
      if (next.length === 6) void submit(next);
    },
    [busy, pin, submit],
  );

  return (
    <div className="ps-pop mx-auto flex w-full max-w-[340px] flex-col items-center gap-5">
      <div className="flex w-full items-center gap-3">
        <IconButton icon={ArrowLeft} label="Back to everyone" variant="light" size={44} onClick={onBack} />
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-[var(--ps-card)] py-1.5 pl-1.5 pr-5">
          <Avatar name={person.name} color={person.color} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-5">{person.name}</p>
            <p className="truncate text-[12px] text-[var(--ps-muted)]">{choosing ? (first === null ? 'Choose a PIN of 4 to 6 digits' : 'Type it again') : ROLE_LABEL[person.role]}</p>
          </div>
        </div>
      </div>
      <Dots length={Math.max(4, pin.length)} filled={pin.length} shake={shake} />
      <p className={cn('min-h-4 text-center text-[12px] font-semibold', error !== '' ? 'text-[var(--ps-red-text)]' : 'text-transparent')} role="alert">
        {error || ' '}
      </p>
      <Keypad onKey={onKey} onEnter={() => void submit(pin)} tone="card" className="w-full" />
      <Button variant="primary" size="lg" icon={ArrowRight} dot loading={busy} disabled={pin.length < 4 || busy} onClick={() => void submit(pin)} className="w-full">
        {choosing && first === null ? 'Next' : 'Sign in'}
      </Button>
    </div>
  );
}

export function RegisterPicker({ registers }: { registers: Register[] }): React.JSX.Element {
  return (
    <Stage className="flex-col items-center justify-center gap-6 px-4 py-10">
      <Mark size={48} />
      <div className="ps-rise text-center">
        <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Which register is this?</h1>
        <p className="mt-1 text-[13px] text-[var(--ps-muted)]">This device remembers it.</p>
      </div>
      <div className="ps-rise ps-d1 grid w-full max-w-[600px] grid-cols-1 gap-3 sm:grid-cols-2">
        {registers.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => session.setRegister(r.id)}
            className="ps-press flex items-center gap-3 rounded-[24px] bg-[var(--ps-card)] p-5 text-left hover:bg-[var(--ps-row)]"
          >
            <IconBadge icon={MonitorSmartphone} size={48} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">{r.name}</span>
              <span className="block text-[12px] text-[var(--ps-muted)]">
                {r.code}
                {r.shift !== null ? ' · open' : ' · closed'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Stage>
  );
}

export function LockScreen(): React.JSX.Element {
  const { staff, settings, registers } = useApp();
  const [picked, setPicked] = useState<Staff | null>(null);
  const reg = session.get().register;
  const register = registers.find((r) => r.id === reg);
  const people = staff.filter((s) => s.active);
  useEffect(() => {
    if (people.length === 1 && picked === null && people[0] !== undefined) setPicked(people[0]);
    // Only when the list first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);
  return (
    <Stage className="flex-col gap-5 p-4 md:flex-row md:p-6">
      <aside className="ps-rise ps-on-dark flex shrink-0 flex-col justify-between gap-4 rounded-[28px] bg-[var(--ps-dark)] p-6 text-[var(--ps-on-dark)] md:w-[320px] md:gap-6">
        <div className="flex items-center gap-3">
          <Mark size={44} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">{settings?.business_name || 'POS'}</p>
            <p className="truncate text-[13px] text-[var(--ps-muted)]">{register !== undefined ? `${register.name} · ${register.code}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="hidden flex-col md:flex">
            <Clock />
            <span className="mt-1 text-[13px] text-[var(--ps-muted)]">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
          <p className="flex items-center gap-2 self-start rounded-full bg-[var(--ps-dark-2)] py-1.5 pl-3 pr-4 text-[12px] font-semibold">
            <Lock size={13} aria-hidden className="text-[var(--ps-accent)]" /> Locked. The cart is kept.
          </p>
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-2 py-6">
        {picked !== null ? (
          <PinEntry key={picked.id} person={picked} register={reg} onBack={() => setPicked(null)} />
        ) : (
          <div className="ps-rise ps-d1 w-full max-w-[640px]">
            <h1 className="mb-5 text-center text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Who is at the register?</h1>
            <div className="flex flex-wrap justify-center gap-3">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked(p)}
                  className="ps-press flex w-[calc(50%-6px)] flex-col items-center gap-2 rounded-[24px] bg-[var(--ps-card)] px-3 py-5 hover:bg-[var(--ps-row)] sm:w-[196px]"
                >
                  <Avatar name={p.name} color={p.color} size={56} />
                  <span className="max-w-full truncate text-[14px] font-bold">{p.name}</span>
                  <span className="text-[12px] text-[var(--ps-muted)]">{p.locked ? 'Locked for a few minutes' : !p.pin_set ? 'Choose a PIN' : ROLE_LABEL[p.role]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </Stage>
  );
}

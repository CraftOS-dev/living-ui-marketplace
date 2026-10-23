/**
 * Touch keypads: the PIN pad (dots, never digits) and the amount pad
 * (typing 450 gives 4.50, the way card terminals take amounts). Both take
 * the keyboard too: digits, Backspace, Escape to clear and Enter to submit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Delete } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { plain } from '../lib/format.ts';
import { Spinner } from './ui.tsx';

function Key({ children, onPress, label, tone = 'plain', disabled = false, className }: { children: React.ReactNode; onPress: () => void; label?: string; tone?: 'plain' | 'muted' | 'go'; disabled?: boolean; className?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'num flex h-14 touch-manipulation select-none items-center justify-center rounded-[var(--ps-r-md)] text-[26px] font-semibold transition-colors active:scale-[0.98] disabled:opacity-40',
        tone === 'plain' && 'bg-[var(--ps-row)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]',
        tone === 'muted' && 'text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)]',
        tone === 'go' && 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)] hover:opacity-90',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Keyboard digits for a pad while it is on screen (not while typing in a field). */
function useKeys(onDigit: (d: string) => void, onBack: () => void, onClear: () => void, onEnter: () => void, enabled: boolean): void {
  const ref = useRef({ onDigit, onBack, onClear, onEnter });
  ref.current = { onDigit, onBack, onClear, onEnter };
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        ref.current.onDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        ref.current.onBack();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        ref.current.onClear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        ref.current.onEnter();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled]);
}

/**
 * PIN entry: up to 8 digits shown as dots. `onSubmit` answers an error
 * message to show (the pad shakes and clears) or null when it worked.
 */
export function PinPad({ onSubmit, busy = false, submitLabel = 'Enter', autoFocusKeys = true, error, className }: { onSubmit: (pin: string) => Promise<string | null>; busy?: boolean; submitLabel?: string; autoFocusKeys?: boolean; error?: string | null; className?: string }): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [working, setWorking] = useState(false);
  const shown = msg ?? (pin.length === 0 ? (error ?? null) : null);

  const submit = useCallback(async () => {
    if (pin.length < 4 || working || busy) return;
    setWorking(true);
    const err = await onSubmit(pin);
    setWorking(false);
    if (err !== null) {
      setMsg(err);
      setShake((n) => n + 1);
      setPin('');
    }
  }, [pin, working, busy, onSubmit]);

  const digit = (d: string): void => {
    setMsg(null);
    setPin((p) => (p.length >= 8 ? p : p + d));
  };
  const backspace = (): void => setPin((p) => p.slice(0, -1));
  const clear = (): void => setPin('');
  useKeys(digit, backspace, clear, () => void submit(), autoFocusKeys);

  return (
    <div className={cn('flex w-full max-w-[280px] flex-col items-center', className)}>
      <div key={shake} className={cn('flex h-8 items-center gap-3', shake > 0 && 'ps-shake')} aria-live="polite" aria-label={pin.length + ' digits entered'}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={cn('size-3 rounded-full border-2 transition-colors', i < pin.length ? 'border-[var(--ps-ink)] bg-[var(--ps-ink)]' : 'border-[var(--ps-line)]')} />
        ))}
      </div>
      <p role="alert" className="mb-3 mt-1 min-h-4 text-center text-[12px] font-semibold leading-4 text-[var(--ps-red-text)]">
        {shown ?? ''}
      </p>
      <div className="grid w-full grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onPress={() => digit(d)}>
            {d}
          </Key>
        ))}
        <Key tone="muted" label="Clear" onPress={clear} className="text-[13px]">
          Clear
        </Key>
        <Key onPress={() => digit('0')}>0</Key>
        {pin.length === 0 ? (
          <Key tone="muted" label="Delete digit" onPress={backspace}>
            <Delete size={20} />
          </Key>
        ) : (
          <Key tone="go" label={submitLabel} disabled={pin.length < 4 || working || busy} onPress={() => void submit()}>
            {working || busy ? <Spinner size={18} /> : <ArrowRight size={22} />}
          </Key>
        )}
      </div>
    </div>
  );
}

/**
 * An amount in minor units, typed from the right: 4, 45, 450 shows 0.04,
 * 0.45, 4.50. "00" adds two zeros. For a currency without decimals the
 * digits are whole units.
 */
export function AmountPad({ value, onChange, onEnter, keys = true, className }: { value: number; onChange: (minor: number) => void; onEnter?: () => void; keys?: boolean; className?: string }): React.JSX.Element {
  const max = 99999999999;
  const push = (d: string): void => {
    const next = Number(String(value) + d);
    if (next <= max) onChange(next);
  };
  const back = (): void => onChange(Math.floor(value / 10));
  useKeys(push, back, () => onChange(0), () => onEnter?.(), keys);
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Key key={d} onPress={() => push(d)}>
          {d}
        </Key>
      ))}
      <Key tone="muted" onPress={() => push('00')} label="Double zero">
        00
      </Key>
      <Key onPress={() => push('0')}>0</Key>
      <Key tone="muted" label="Delete digit" onPress={back}>
        <Delete size={20} />
      </Key>
    </div>
  );
}

/** The amount being typed on an AmountPad, big. */
export function AmountReadout({ minor, digits, symbol, className }: { minor: number; digits: number; symbol: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn('num flex items-baseline justify-center gap-1 text-[26px] font-bold leading-8', className)}>
      <span className="text-[15px] font-semibold text-[var(--ps-muted)]">{symbol}</span>
      {plain(minor, digits)}
    </div>
  );
}

/** A quantity stepper for touch: minus, the number, plus. */
export function Stepper({ value, onChange, min = 1, max = 99999, step = 1, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; label: string }): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-center rounded-[var(--ps-r)] border border-[var(--ps-line)] bg-[var(--ps-card)]">
      <button type="button" aria-label={'Less ' + label.toLowerCase()} disabled={value - step < min} onClick={() => onChange(Math.round((value - step) * 1000) / 1000)} className="flex h-full w-9 items-center justify-center text-[15px] font-semibold text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] disabled:opacity-40">
        &minus;
      </button>
      <span className="num w-10 text-center text-[15px] font-bold">{value}</span>
      <button type="button" aria-label={'More ' + label.toLowerCase()} disabled={value + step > max} onClick={() => onChange(Math.round((value + step) * 1000) / 1000)} className="flex h-full w-9 items-center justify-center text-[15px] font-semibold text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] disabled:opacity-40">
        +
      </button>
    </div>
  );
}

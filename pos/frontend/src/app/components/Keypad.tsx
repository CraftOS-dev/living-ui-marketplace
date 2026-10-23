/**
 * The counter's keypad: big round-cornered keys for wet, hurried fingers
 * (56 to 64px), with the physical keyboard working too (digits, ".",
 * Backspace, Enter). Used for PINs, cash, prices, quantities and counts.
 */
import { useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '../../kit/index.ts';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '00' | 'back';

/** Keypads listening to the keyboard, newest last: only the newest one (a PIN pad over the pay screen) gets keys. */
const stack: number[] = [];
let nextId = 1;

export function Keypad({
  onKey,
  extra = 'none',
  onEnter,
  keyboard = true,
  size = 'lg',
  tone = 'soft',
  className,
}: {
  onKey: (k: KeypadKey) => void;
  /** The bottom-left key: a decimal point, a double zero, or nothing. */
  extra?: '.' | '00' | 'none';
  onEnter?: () => void;
  /** Listen to the physical keyboard (only one keypad on screen should). */
  keyboard?: boolean;
  size?: 'md' | 'lg';
  /** `soft` keys sit on a white card, `card` keys on the shell. */
  tone?: 'soft' | 'card';
  className?: string;
}): React.JSX.Element {
  // Handlers in a ref: the keyboard listener registers once, so its place on the stack is fixed.
  const handlers = useRef({ onKey, onEnter, extra });
  handlers.current = { onKey, onEnter, extra };
  useEffect(() => {
    if (!keyboard) return;
    const id = nextId++;
    stack.push(id);
    const onDown = (e: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== id) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { onKey: key, onEnter: enter, extra: ex } = handlers.current;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        key(e.key as KeypadKey);
      } else if ((e.key === '.' || e.key === 'Decimal') && ex === '.') {
        e.preventDefault();
        key('.');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        key('back');
      } else if (e.key === 'Enter' && enter !== undefined) {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener('keydown', onDown);
    return () => {
      window.removeEventListener('keydown', onDown);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [keyboard]);
  const keys: (KeypadKey | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', extra === 'none' ? null : extra, '0', 'back'];
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k, i) =>
        k === null ? (
          <span key={i} aria-hidden />
        ) : (
          <button
            key={k}
            type="button"
            aria-label={k === 'back' ? 'Delete the last digit' : k}
            onClick={() => onKey(k)}
            className={cn(
              'ps-press num flex items-center justify-center rounded-[18px] font-bold text-[var(--ps-ink)]',
              tone === 'soft' ? 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]' : 'bg-[var(--ps-card)] hover:bg-[var(--ps-row)]',
              size === 'lg' ? 'h-16 text-[26px]' : 'h-14 text-[15px]',
            )}
          >
            {k === 'back' ? <Delete size={size === 'lg' ? 24 : 20} strokeWidth={2} aria-hidden /> : k}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Typing an amount on the keypad: digits fill from the right like a
 * calculator till ("1", "12", "1.25" for cents), so no one has to find a
 * decimal point. `exp` is the currency's decimals; returns minor units.
 */
export function pressAmount(current: number, key: KeypadKey, max = 99999999999): number {
  if (key === 'back') return Math.floor(current / 10);
  if (key === '.') return current;
  if (key === '00') {
    const next = current * 100;
    return next > max ? current : next;
  }
  const next = current * 10 + Number(key);
  return next > max ? current : next;
}

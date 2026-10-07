/**
 * The expense entry screen. The "+" (or a tapped expense) grows into a
 * full screen with a circular reveal from where it was pressed; closing
 * shrinks it back. Three numbered steps read left to right: the amount on
 * a keypad (the physical keyboard works too), a category, then details and
 * Save. Only the amount is required.
 *
 * useEntry().add(origin) / .edit(origin, expense) / .fromReceipt(origin, receipt)
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Camera, Check, Delete, ExternalLink, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, dayLabel, today } from '../lib/dates.ts';
import { CategoryBadge } from '../lib/icons.tsx';
import { CURRENCIES, NUMBER_LOCALE, decimalsOf, money, plainAmount, symbolOf } from '../lib/money.ts';
import type { Expense, Receipt } from '../lib/types.ts';
import { CircleButton, DayPicker, Field, PillButton, PillSelect, Popover, Toggle, errMessage, softInput, useConfirm } from './ui.tsx';

type Origin = { x: number; y: number };
type Mode = { kind: 'add' } | { kind: 'edit'; expense: Expense } | { kind: 'receipt'; receipt: Receipt };

interface EntryApi {
  add: (from: Element | null) => void;
  edit: (from: Element | null, expense: Expense) => void;
  fromReceipt: (from: Element | null, receipt: Receipt) => void;
}

const Ctx = createContext<EntryApi | null>(null);

export function useEntry(): EntryApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useEntry outside EntryProvider');
  return v;
}

function originOf(el: Element | null): Origin {
  if (el === null) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function EntryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<{ mode: Mode; origin: Origin; n: number } | null>(null);
  const [snack, setSnack] = useState<Expense | null>(null);
  const counter = useRef(0);
  const api_: EntryApi = {
    add: (from) => setState({ mode: { kind: 'add' }, origin: originOf(from), n: ++counter.current }),
    edit: (from, expense) => setState({ mode: { kind: 'edit', expense }, origin: originOf(from), n: ++counter.current }),
    fromReceipt: (from, receipt) => setState({ mode: { kind: 'receipt', receipt }, origin: originOf(from), n: ++counter.current }),
  };
  useEffect(() => {
    if (snack === null) return;
    const t = setTimeout(() => setSnack(null), 7000);
    return () => clearTimeout(t);
  }, [snack]);
  return (
    <Ctx.Provider value={api_}>
      {children}
      {state !== null && (
        <EntryScreen
          key={state.n}
          mode={state.mode}
          origin={state.origin}
          onClosed={(added) => {
            setState(null);
            if (added !== null) setSnack(added);
          }}
        />
      )}
      {snack !== null && <Snack expense={snack} onDone={() => setSnack(null)} />}
    </Ctx.Provider>
  );
}

function Snack({ expense, onDone }: { expense: Expense; onDone: () => void }): React.JSX.Element {
  const { currency } = useApp();
  const undo = async (): Promise<void> => {
    try {
      await api.remove(expense.id);
      toast.info('Removed');
    } catch {
      /* toasted */
    }
    onDone();
  };
  return (
    <div className="et-pop et-on-ink fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--et-ink)] py-2 pl-2 pr-2 text-[var(--et-shell)] shadow-2xl md:bottom-8">
      <span className="flex size-8 items-center justify-center rounded-full bg-[var(--et-accent)] text-[var(--et-on-accent)]">
        <Check size={16} strokeWidth={2.6} aria-hidden />
      </span>
      <span className="max-w-[60vw] truncate text-[13px] font-semibold">
        Added <span className="num">{money(expense.amount_minor, currency)}</span>
        {expense.category !== null ? ` to ${expense.category}` : ''}
      </span>
      <button type="button" onClick={() => void undo()} className="rounded-full px-3 py-1.5 text-[13px] font-bold text-[var(--et-accent)] hover:bg-[var(--et-shell)]/10">
        Undo
      </button>
      <button type="button" onClick={onDone} aria-label="Dismiss" className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--et-shell)]/10">
        <X size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

function reveal(el: HTMLElement, o: Origin, open: boolean): Animation | null {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    return el.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 160, fill: 'both' });
  }
  const r = Math.hypot(Math.max(o.x, window.innerWidth - o.x), Math.max(o.y, window.innerHeight - o.y)) + 24;
  const small = `circle(24px at ${o.x}px ${o.y}px)`;
  const big = `circle(${r}px at ${o.x}px ${o.y}px)`;
  return el.animate([{ clipPath: open ? small : big }, { clipPath: open ? big : small }], {
    duration: open ? 560 : 420,
    easing: open ? 'cubic-bezier(0.65, 0, 0.35, 1)' : 'cubic-bezier(0.55, 0, 0.75, 0.2)',
    fill: 'both',
  });
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

function EntryScreen({ mode, origin, onClosed }: { mode: Mode; origin: Origin; onClosed: (added: Expense | null) => void }): React.JSX.Element {
  const { currency, byUse } = useApp();
  const root = useRef<HTMLDivElement | null>(null);
  const closing = useRef(false);
  const editing = mode.kind === 'edit' ? mode.expense : null;
  const isForeignStart = editing !== null && editing.original_currency !== undefined;

  const [amount, setAmount] = useState(() => {
    if (editing === null) return '';
    if (isForeignStart) return editing.original_amount ?? '';
    return plainAmount(editing.amount_minor, currency);
  });
  const [cat, setCat] = useState(editing?.category_id ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [date, setDate] = useState(editing?.date ?? today());
  const [file, setFile] = useState<File | null>(null);
  const [foreign, setForeign] = useState(isForeignStart);
  const [fxCode, setFxCode] = useState(editing?.original_currency ?? (currency === 'EUR' ? 'USD' : 'EUR'));
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(mode.kind === 'receipt' ? mode.receipt.url : null);
  const [confirmEl, confirm] = useConfirm();
  const attachRef = useRef<HTMLInputElement | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const dayBtn = useRef<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState(false);

  const code = foreign ? fxCode : currency;
  const decimals = decimalsOf(code);

  useLayoutEffect(() => {
    if (root.current !== null) reveal(root.current, origin, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [origin]);

  useEffect(() => {
    if (editing !== null && editing.receipt_id !== null) {
      api
        .getExpense(editing.id)
        .then((e) => setReceiptUrl(e.receipt?.url ?? null))
        .catch(() => undefined);
    }
  }, [editing]);

  const close = useCallback(
    (added: Expense | null) => {
      if (closing.current) return;
      closing.current = true;
      const anim = root.current !== null ? reveal(root.current, origin, false) : null;
      if (anim === null) onClosed(added);
      else anim.onfinish = () => onClosed(added);
    },
    [origin, onClosed],
  );

  // Amount typing: digits, one decimal mark, the currency's decimals at most.
  const press = useCallback(
    (k: string) => {
      setError(null);
      setAmount((a) => {
        if (k === 'del') return a.slice(0, -1);
        if (k === 'clear') return '';
        if (k === '.') {
          if (decimals === 0 || a.includes('.')) return a;
          return a === '' ? '0.' : `${a}.`;
        }
        const [whole = '', frac] = a.split('.');
        if (frac !== undefined && frac.length >= decimals) return a;
        if (frac === undefined && whole.replace(/^0+/, '').length >= 9) return a;
        if (a === '0') return k;
        return a + k;
      });
    },
    [decimals],
  );

  const valid = amount !== '' && Number(amount) > 0;

  const save = useCallback(async () => {
    if (!valid) {
      setError('Enter how much you spent');
      return;
    }
    const value = amount.endsWith('.') ? amount.slice(0, -1) : amount;
    const input = { amount: value, date, note: note.trim(), category: cat, ...(foreign && fxCode !== currency ? { currency: fxCode } : {}) };
    setBusy(true);
    try {
      if (mode.kind === 'receipt') {
        await api.completeReceipt(mode.receipt.id, input);
        toast.success('Expense added from the receipt');
        close(null);
      } else if (mode.kind === 'edit') {
        await api.update(mode.expense.id, input);
        toast.success('Saved');
        close(null);
      } else {
        const r = file !== null ? await api.addWithReceipt(input, file) : await api.add(input);
        close(r.expense);
      }
    } catch {
      /* the shell toasted the reason */
    } finally {
      setBusy(false);
    }
  }, [valid, amount, date, note, cat, foreign, fxCode, currency, mode, file, close]);

  // Keyboard: digits and the decimal point go to the amount unless a text field has focus.
  // "," only separates thousands (shown automatically), so it types nothing; the
  // keypad's decimal key types the point even on layouts where it reads ",".
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Enter' && !(t?.tagName === 'BUTTON')) {
        e.preventDefault();
        void save();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.code === 'NumpadDecimal') press('.');
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Delete') press('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, save, close]);

  // Conversion preview for another currency.
  useEffect(() => {
    if (!foreign || fxCode === currency || !valid) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .fx(fxCode, amount.endsWith('.') ? amount.slice(0, -1) : amount, date)
        .then((r) => setPreview(`About ${symbolOf(currency)}${r.converted} at the ${r.rate_date} rate`))
        .catch((err: unknown) => setPreview(errMessage(err)));
    }, 300);
    return () => clearTimeout(t);
  }, [foreign, fxCode, amount, date, currency, valid]);

  const remove = async (): Promise<void> => {
    if (editing === null) return;
    if (!(await confirm('This expense is deleted, with its receipt if it has one.', 'Delete this expense?'))) return;
    try {
      await api.remove(editing.id);
      toast.success('Deleted');
      close(null);
    } catch {
      /* toasted */
    }
  };

  const scan = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    try {
      const r = await api.uploadReceipts(Array.from(files));
      toast.success(`${r.receipts.length === 1 ? 'Receipt' : `${r.receipts.length} receipts`} sent to your AI agent. Added once read.`);
      close(null);
    } catch {
      /* toasted */
    }
  };

  const t = today();
  const yesterday = addDays(t, -1);
  const otherDay = date !== t && date !== yesterday;
  const title = mode.kind === 'receipt' ? 'Enter the receipt' : editing !== null ? 'Edit expense' : 'New expense';
  const [whole = '', frac] = amount.split('.');
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString(NUMBER_LOCALE);
  // The step to do next is marked; finished steps show a check.
  const step = (n: 1 | 2 | 3): StepState => {
    if (n === 1) return valid ? 'done' : 'current';
    if (n === 2) return cat !== '' ? 'done' : valid ? 'current' : 'todo';
    return valid && cat !== '' ? 'current' : 'todo';
  };
  const chip = (on: boolean): string =>
    cn('inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors', on ? 'bg-[var(--et-ink)] text-[var(--et-shell)]' : 'bg-[var(--et-row)] hover:bg-[var(--et-row-hover)]');
  const receiptAsk = (className: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => scanRef.current?.click()}
      className={cn('et-on-sand items-center gap-3 rounded-full bg-[var(--et-sand)] py-1.5 pl-1.5 pr-5 text-left transition-transform active:scale-[0.98]', className)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--et-solid)] text-[var(--et-on-solid)]">
        <Camera size={16} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold">Have a receipt?</span>
        <span className="block text-[12px] text-[var(--et-muted)]">Let your AI agent read it</span>
      </span>
    </button>
  );

  return (
    <div ref={root} className="fixed inset-0 z-50 overflow-y-auto bg-[var(--et-shell)] text-[var(--et-ink)]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-10 pt-5 md:px-8 md:pt-8">
        <header className="et-rise et-d1 mx-auto mb-6 flex max-w-[560px] items-center gap-4 min-[1100px]:max-w-none">
          <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={() => close(null)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
            <p className="text-[13px] text-[var(--et-muted)]">Start with the amount. Everything else is optional.</p>
          </div>
          {mode.kind === 'add' && receiptAsk('hidden sm:inline-flex')}
          {editing !== null && (
            <PillButton variant="danger" icon={Trash2} onClick={() => void remove()} className="hidden sm:inline-flex">
              Delete
            </PillButton>
          )}
          <input ref={scanRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void scan(e.target.files)} />
        </header>

        <div className="mx-auto grid max-w-[560px] gap-4 min-[1100px]:max-w-none min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] min-[1100px]:gap-5">
          {/* 1. Amount: the display and the keypad */}
          <Step n={1} state={step(1)} title="Amount" hint="Required" delay={2}>
            <div className="et-on-dark rounded-[22px] bg-[var(--et-dark)] p-5 text-[var(--et-on-dark)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-[var(--et-on-dark-muted)]">{foreign ? `Paid in ${fxCode}` : 'Type or tap the keys'}</span>
                <span className="rounded-full bg-[var(--et-dark-2)] px-3 py-1 text-[12px] font-semibold">{code}</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2" aria-live="polite">
                <span className="text-[26px] font-bold text-[var(--et-on-dark-muted)]">{symbolOf(code)}</span>
                <span className={cn('num min-w-0 truncate text-[26px] font-extrabold tracking-[-0.01em]', amount === '' && 'text-[var(--et-on-dark-muted)]')}>
                  {shownWhole}
                  {frac !== undefined ? `.${frac}` : ''}
                </span>
                <span aria-hidden className="et-caret h-7 w-[3px] shrink-0 self-center rounded-full bg-[var(--et-accent)]" />
              </div>
              <p className={cn('mt-2 min-h-5 text-[12px]', error !== null ? 'font-semibold text-[var(--et-red-text)]' : 'text-[var(--et-on-dark-muted)]')}>
                {error ?? preview ?? (decimals === 0 ? `${code} has no decimals` : '')}
              </p>
            </div>
            <div className="mt-3 grid flex-1 grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  disabled={k === '.' && decimals === 0}
                  aria-label={k === 'del' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
                  className="num flex min-h-14 items-center justify-center rounded-[18px] bg-[var(--et-row)] text-[15px] font-bold transition-[background,transform] hover:bg-[var(--et-row-hover)] active:scale-95 disabled:opacity-30"
                >
                  {k === 'del' ? <Delete size={20} strokeWidth={2} /> : k}
                </button>
              ))}
            </div>
          </Step>

          {/* 2. Category */}
          <Step
            n={2}
            state={step(2)}
            title="Category"
            hint="Optional"
            delay={3}
            action={
              cat !== '' ? (
                <button type="button" onClick={() => setCat('')} className="text-[12px] font-semibold text-[var(--et-muted)] hover:text-[var(--et-ink)]">
                  Clear
                </button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-3 gap-2 sm:max-[1099px]:grid-cols-4">
              {byUse.map((c) => {
                const on = c.id === cat;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCat(on ? '' : c.id)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-[20px] px-2 py-3 transition-[background,transform] active:scale-[0.97]',
                      on ? 'et-on-ink bg-[var(--et-ink)] text-[var(--et-shell)]' : 'bg-[var(--et-row)] hover:bg-[var(--et-row-hover)]',
                    )}
                  >
                    <CategoryBadge icon={c.icon} size={40} tone={on ? 'none' : 'light'} className={on ? 'bg-[var(--et-accent)] text-[var(--et-on-accent)]' : ''} />
                    <span className="w-full truncate text-center text-[12px] font-semibold">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* 3. Details, then Save */}
          <Step n={3} state={step(3)} title="Details" hint="Optional" delay={4}>
            <div className="flex flex-1 flex-col gap-4">
              <Field label="What was it for?">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="For example: lunch with Sam" aria-label="What was it for" className={softInput} />
              </Field>
              <Field label="When">
                <div className="relative flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setDate(t)} className={chip(date === t)}>
                    Today
                  </button>
                  <button type="button" onClick={() => setDate(yesterday)} className={chip(date === yesterday)}>
                    Yesterday
                  </button>
                  <button ref={dayBtn} type="button" onClick={() => setPicking((o) => !o)} aria-expanded={picking} className={chip(otherDay)}>
                    <CalendarDays size={15} aria-hidden />
                    {otherDay ? dayLabel(date) : 'Other day'}
                  </button>
                  <Popover open={picking} onClose={() => setPicking(false)} keep={dayBtn} className="w-[min(296px,calc(100vw-48px))] p-3">
                    <DayPicker
                      value={date}
                      onPick={(d) => {
                        setDate(d);
                        setPicking(false);
                      }}
                    />
                  </Popover>
                </div>
              </Field>
              {(mode.kind === 'add' || receiptUrl !== null) && (
                <Field label="Receipt">
                  <div className="flex flex-wrap items-center gap-2">
                    {mode.kind === 'add' &&
                      (file !== null ? (
                        <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-full bg-[var(--et-row)] pl-4 pr-1 text-[13px] font-semibold">
                          <Paperclip size={14} aria-hidden />
                          <span className="truncate">{file.name}</span>
                          <button type="button" onClick={() => setFile(null)} aria-label="Remove receipt" className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--et-row-hover)]">
                            <X size={14} />
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => attachRef.current?.click()} className={chip(false)}>
                          <Paperclip size={14} aria-hidden /> Attach a photo or PDF
                        </button>
                      ))}
                    {receiptUrl !== null && (
                      <a href={receiptUrl} target="_blank" rel="noreferrer" className={chip(false)}>
                        <ExternalLink size={14} aria-hidden /> Open the receipt
                      </a>
                    )}
                    <input
                      ref={attachRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f !== undefined) setFile(f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </Field>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-[var(--et-row)] px-4 py-3">
                <span className="text-[13px] font-semibold">Paid in another currency</span>
                <div className="flex items-center gap-2">
                  {foreign && (
                    <PillSelect
                      ariaLabel="Currency paid in"
                      value={fxCode}
                      onChange={setFxCode}
                      className="w-28"
                      options={CURRENCIES.filter((c) => c !== currency).map((c) => ({ value: c, label: c }))}
                    />
                  )}
                  <Toggle checked={foreign} onChange={setForeign} label="Paid in another currency" />
                </div>
              </div>
              <div className="mt-auto flex gap-2 pt-2">
                {editing !== null && (
                  <PillButton variant="danger" icon={Trash2} onClick={() => void remove()} className="h-14 sm:hidden">
                    Delete
                  </PillButton>
                )}
                <PillButton variant="dark" icon={editing !== null ? Check : Plus} dot loading={busy} disabled={!valid} onClick={() => void save()} className="h-14 flex-1 text-[15px]">
                  {mode.kind === 'edit' ? 'Save changes' : 'Save expense'}
                </PillButton>
              </div>
            </div>
          </Step>

          {mode.kind === 'add' && receiptAsk('et-rise et-d5 flex w-full rounded-[24px] sm:hidden')}
        </div>
      </div>
      {confirmEl}
    </div>
  );
}

type StepState = 'todo' | 'current' | 'done';

/** One numbered step of the entry screen: the next step to do is ink, finished ones show a check. */
function Step({
  n,
  state,
  title,
  hint,
  action,
  delay,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  hint: string;
  action?: ReactNode;
  delay: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('et-rise flex flex-col rounded-[28px] bg-[var(--et-card)] p-5', `et-d${delay}`)} aria-label={`Step ${n}: ${title}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
            state === 'todo' && 'bg-[var(--et-row)] text-[var(--et-ink-2)]',
            state === 'current' && 'bg-[var(--et-ink)] text-[var(--et-shell)]',
            state === 'done' && 'bg-[var(--et-solid)] text-[var(--et-on-solid)]',
          )}
        >
          {state === 'done' ? <Check size={14} strokeWidth={3} aria-label="Done" /> : n}
        </span>
        <h2 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h2>
        {action ?? <span className="text-[12px] font-semibold text-[var(--et-muted)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

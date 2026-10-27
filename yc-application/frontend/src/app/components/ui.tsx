/**
 * The building blocks, in the Expenses tracker's shapes: rounded white
 * cards with a border (and one dark card), pill buttons with an orange dot,
 * round icon buttons and badges, status pills, segmented progress, a
 * switch, soft inputs, a tooltip and a confirm dialog. Colors come only from
 * the --yc-* tokens.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';

/* ------------------------------------------------------------- surfaces */

export type CardTone = 'white' | 'dark';

export function Card({ tone = 'white', className, children, id }: { tone?: CardTone; className?: string; children: ReactNode; id?: string }): React.JSX.Element {
  return (
    <section
      id={id}
      className={cn(
        'yc-rise rounded-[24px] p-5 md:p-6',
        tone === 'white' && 'border border-[var(--yc-border)] bg-[var(--yc-card)] text-[var(--yc-ink)]',
        tone === 'dark' && 'yc-on-dark border border-[var(--yc-dark-border)] bg-[var(--yc-dark)] text-[var(--yc-on-dark)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
        {subtitle !== undefined && <p className="mt-0.5 text-[13px] text-[var(--yc-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="yc-rise mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-[13px] text-[var(--yc-muted)]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------------------------------------- buttons */

export type PillVariant = 'dark' | 'light' | 'ghost' | 'accent' | 'row';

function pillClass(variant: PillVariant, dot: boolean, className?: string): string {
  return cn(
    'yc-pill inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:bg-[var(--yc-hover)] disabled:text-[var(--yc-muted)]',
    variant === 'dark' && 'bg-[var(--yc-ink)] text-[var(--yc-shell)] hover:bg-[var(--yc-ink-2)]',
    variant === 'light' && 'bg-[var(--yc-card)] text-[var(--yc-ink)] hover:bg-[var(--yc-hover)]',
    variant === 'row' && 'bg-[var(--yc-row)] text-[var(--yc-ink)] hover:bg-[var(--yc-hover)]',
    variant === 'ghost' && 'bg-transparent text-[var(--yc-ink-2)] hover:bg-[var(--yc-hover)] hover:text-[var(--yc-ink)]',
    variant === 'accent' && 'bg-[var(--yc-accent)] text-[var(--yc-on-accent)] hover:brightness-95',
    dot && 'pl-1.5',
    className,
  );
}

function PillInside({ icon: Icon, dot, loading, children }: { icon?: LucideIcon | undefined; dot: boolean; loading: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <>
      {loading ? (
        <span aria-hidden className="yc-spin size-4 rounded-full border-2 border-current border-t-transparent" />
      ) : dot && Icon !== undefined ? (
        <span className="flex size-8 items-center justify-center rounded-full bg-[var(--yc-accent)] text-[var(--yc-on-accent)]">
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </span>
      ) : Icon !== undefined ? (
        <Icon size={16} strokeWidth={2} aria-hidden />
      ) : null}
      {children}
    </>
  );
}

export function PillButton({
  variant = 'dark',
  icon,
  dot = false,
  loading = false,
  className,
  children,
  type,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PillVariant; icon?: LucideIcon; dot?: boolean; loading?: boolean }): React.JSX.Element {
  return (
    <button type={type ?? 'button'} disabled={disabled === true || loading} className={pillClass(variant, dot, className)} {...rest}>
      <PillInside icon={icon} dot={dot} loading={loading}>
        {children}
      </PillInside>
    </button>
  );
}

/** A pill that navigates (same look as PillButton). */
export function PillLink({ variant = 'dark', icon, dot = false, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: PillVariant; icon?: LucideIcon; dot?: boolean }): React.JSX.Element {
  return (
    <a className={pillClass(variant, dot, className)} {...rest}>
      <PillInside icon={icon} dot={dot} loading={false}>
        {children}
      </PillInside>
    </a>
  );
}

export function CircleButton({
  icon: Icon,
  label,
  variant = 'light',
  size = 40,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'light' | 'dark' | 'accent' | 'row'; size?: number }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      style={{ width: size, height: size }}
      className={cn(
        'hit inline-flex shrink-0 transition-colors active:scale-95 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:text-[var(--yc-muted)]',
        variant === 'light' && 'bg-[var(--yc-card)] text-[var(--yc-ink)] hover:bg-[var(--yc-hover)]',
        variant === 'row' && 'bg-[var(--yc-row)] text-[var(--yc-ink)] hover:bg-[var(--yc-hover)]',
        variant === 'dark' && 'bg-[var(--yc-ink)] text-[var(--yc-shell)] hover:bg-[var(--yc-ink-2)]',
        variant === 'accent' && 'bg-[var(--yc-accent)] text-[var(--yc-on-accent)]',
        className,
      )}
      {...rest}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** A round icon badge, as on the left of every row. */
export function IconBadge({ icon: Icon, tone = 'light', size = 40 }: { icon: LucideIcon; tone?: 'light' | 'solid' | 'accent' | 'good' | 'bad' | 'row'; size?: number }): React.JSX.Element {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        tone === 'light' && 'bg-[var(--yc-card)] text-[var(--yc-ink)]',
        tone === 'row' && 'bg-[var(--yc-row)] text-[var(--yc-ink)]',
        tone === 'solid' && 'bg-[var(--yc-solid)] text-[var(--yc-on-solid)]',
        tone === 'accent' && 'bg-[var(--yc-accent)] text-[var(--yc-on-accent)]',
        tone === 'good' && 'bg-[var(--yc-green)] text-white',
        tone === 'bad' && 'bg-[var(--yc-red)] text-white',
      )}
    >
      <Icon size={Math.round(size * 0.45)} strokeWidth={2} aria-hidden />
    </span>
  );
}

/* --------------------------------------------------------------- display */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark';

export function StatusPill({ tone, children, pulse = false }: { tone: Tone; children: ReactNode; pulse?: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold',
        tone === 'good' && 'bg-[var(--yc-green)]/15 text-[var(--yc-green-text)]',
        tone === 'warn' && 'bg-[var(--yc-accent)]/25 text-[var(--yc-ink)]',
        tone === 'bad' && 'bg-[var(--yc-red)]/15 text-[var(--yc-red-text)]',
        tone === 'info' && 'bg-[var(--yc-ink)] text-[var(--yc-shell)]',
        tone === 'neutral' && 'bg-[var(--yc-card)] text-[var(--yc-ink-2)] shadow-[inset_0_0_0_1px_var(--yc-line)]',
        tone === 'dark' && 'bg-[var(--yc-dark-2)] text-[var(--yc-on-dark)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          tone === 'good' && 'bg-[var(--yc-green)]',
          tone === 'warn' && 'bg-[var(--yc-accent)]',
          tone === 'bad' && 'bg-[var(--yc-red)]',
          tone === 'info' && 'bg-[var(--yc-accent)]',
          tone === 'neutral' && 'bg-[var(--yc-muted)]',
          tone === 'dark' && 'bg-[var(--yc-accent)]',
          pulse && 'yc-breathe',
        )}
      />
      {children}
    </span>
  );
}

/** Segmented progress: N small bars, the done share in ink (green when complete, orange for 'accent'); they fill left to right as the value rises. */
export function Segments({ value, max, count = 10, className, tone }: { value: number; max: number; count?: number; className?: string; tone?: 'accent' | 'good' }): React.JSX.Element {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(ratio * count);
  const color = tone === 'good' || (tone === undefined && ratio >= 1) ? 'bg-[var(--yc-green)]' : tone === 'accent' ? 'bg-[var(--yc-accent)]' : 'bg-[var(--yc-ink)]';
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-label={`${value} of ${max}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ transitionDelay: i * 15 + 'ms' }} className={cn('h-3 w-1.5 rounded-full transition-colors duration-300', i < filled ? color : 'bg-[var(--yc-line)]')} />
      ))}
    </span>
  );
}

/** On/off switch: ink track with a white knob when on. Changes at once; the server catches up. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void | Promise<void>; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  const [on, setOn] = useState(checked);
  useEffect(() => setOn(checked), [checked]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        const v = !on;
        setOn(v);
        void Promise.resolve(onChange(v)).catch(() => setOn(!v));
      }}
      className={cn('hit relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', on ? 'bg-[var(--yc-ink)]' : 'bg-[var(--yc-line)]')}
    >
      <span className={cn('inline-block size-5 rounded-full shadow-sm transition-transform duration-200 ease-out', on ? 'translate-x-6 bg-[var(--yc-card)]' : 'translate-x-1 bg-[var(--yc-card)]')} />
    </button>
  );
}

/**
 * Two choices in one pill (Yes / No): the ink thumb slides to the one picked
 * and sits on neither while nothing is picked.
 */
export function TwoWay({ value, labels, onPick, disabled, label, className }: { value: 0 | 1 | null; labels: [string, string]; onPick: (i: 0 | 1) => void; disabled?: boolean | undefined; label: string; className?: string }): React.JSX.Element {
  return (
    <span className={cn('relative inline-grid shrink-0 grid-cols-2 rounded-full bg-[var(--yc-card)] p-1', className)} role="radiogroup" aria-label={label}>
      <span
        aria-hidden
        className={cn('absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-full bg-[var(--yc-ink)] transition-transform duration-200 ease-out', value === null && 'invisible')}
        style={{ transform: value === 1 ? 'translateX(100%)' : 'none' }}
      />
      {labels.map((t, i) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === i}
          disabled={disabled}
          onClick={() => onPick(i as 0 | 1)}
          className={cn('relative h-8 rounded-full px-3 text-[13px] font-semibold transition-colors duration-200', value === i ? 'text-[var(--yc-shell)]' : 'text-[var(--yc-ink-2)] hover:text-[var(--yc-ink)]')}
        >
          {t}
        </button>
      ))}
    </span>
  );
}

/** A soft row with an icon badge, a title, a line under it and a switch. */
export function ToggleRow({ icon, title, sub, checked, onChange, disabled }: { icon: LucideIcon; title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void | Promise<void>; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-[var(--yc-row)] px-3 py-2.5">
      <IconBadge icon={icon} tone={checked ? 'solid' : 'light'} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold">{title}</span>
        {sub !== undefined && <span className="block text-[12px] text-[var(--yc-muted)]">{sub}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--yc-row)] text-[var(--yc-ink)]">
        <Icon size={22} strokeWidth={1.8} aria-hidden />
      </span>
      <p className="text-[15px] font-bold">{title}</p>
      {children !== undefined && <div className="mt-1 max-w-sm text-[13px] leading-5 text-[var(--yc-muted)]">{children}</div>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** What to put in first, shown on a step until it has something in it. */
export function StartCard({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <Card>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--yc-ink)] text-[var(--yc-shell)]">
          <Icon size={22} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-[22px]">{title}</p>
          {children !== undefined && <div className="mt-0.5 text-[13px] leading-5 text-[var(--yc-muted)]">{children}</div>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- inputs */

export const pillInput = 'h-11 w-full rounded-full bg-[var(--yc-card)] px-5 text-[14px] text-[var(--yc-ink)] outline-none ring-[var(--yc-ink)] transition-shadow focus-visible:ring-2';

export const softInput = 'h-11 w-full rounded-full bg-[var(--yc-row)] px-5 text-[14px] text-[var(--yc-ink)] outline-none ring-[var(--yc-ink)] transition-shadow focus-visible:ring-2';

export const softArea = 'block w-full resize-none rounded-[20px] bg-[var(--yc-row)] px-5 py-4 text-[15px] leading-[24px] text-[var(--yc-ink)] outline-none ring-[var(--yc-ink)] transition-shadow focus-visible:ring-2';

/** A soft text area that grows with its text. */
export function AutoText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; bad?: boolean }): React.JSX.Element {
  const { minRows = 3, className, bad, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, minRows * 24 + 32) + 'px';
  }, [minRows]);
  useLayoutEffect(fit, [fit, props.value]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  return <textarea ref={ref} rows={minRows} className={cn(softArea, bad === true && 'ring-2 ring-[var(--yc-red)]', className)} {...rest} />;
}

/* --------------------------------------------------------------- tooltip */

/** Help on hover or focus. */
export function Tip({ text, children, className }: { text: string; children: ReactNode; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  if (text === '') return className !== undefined ? <span className={className}>{children}</span> : <>{children}</>;
  const show = (): void => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 80;
    setPos({ x: Math.min(Math.max(8, r.left), window.innerWidth - 290), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  return (
    <span ref={ref} className={cn('inline-flex', className)} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos !== null &&
        createPortal(
          <span
            role="tooltip"
            className="yc-portal pointer-events-none fixed z-[70] max-w-[280px]"
            style={{ left: pos.x, top: pos.y, transform: pos.below ? 'none' : 'translateY(-100%)' }}
          >
            <span className="block rounded-[14px] bg-[var(--yc-ink)] px-3 py-2 text-[12px] font-medium leading-[18px] text-[var(--yc-shell)] shadow-[0_18px_40px_-18px_var(--yc-shadow)]" style={{ transformOrigin: pos.below ? 'top left' : 'bottom left' }}>
              {text}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/* ---------------------------------------------------------------- confirm */

interface Ask {
  title: string;
  body?: string | undefined;
  yes: string;
  no: string;
  resolve: (ok: boolean) => void;
}

let host: ((a: Ask | null) => void) | null = null;

/** Ask before something that cannot be undone. Resolves true on yes. */
export function confirmAsk(title: string, body: string | undefined, yes: string, no = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    if (host === null) {
      resolve(false);
      return;
    }
    host({ title, body, yes, no, resolve });
  });
}

export function ConfirmHost(): React.JSX.Element | null {
  const [ask, setAsk] = useState<Ask | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    host = setAsk;
    return () => {
      host = null;
    };
  }, []);
  useEffect(() => {
    if (ask === null) return;
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        ask.resolve(false);
        setAsk(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);
  if (ask === null) return null;
  const done = (ok: boolean): void => {
    ask.resolve(ok);
    setAsk(null);
  };
  return createPortal(
    <div className="yc-portal fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div role="dialog" aria-modal="true" aria-label={ask.title} className="yc-zoom w-[min(94vw,30rem)] rounded-[28px] border border-[var(--yc-border)] bg-[var(--yc-card)] p-6 text-[var(--yc-ink)] shadow-2xl">
        <p className="text-[15px] font-bold">{ask.title}</p>
        {ask.body !== undefined && <p className="mt-1 text-[13px] text-[var(--yc-muted)]">{ask.body}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <PillButton variant="row" onClick={() => done(false)}>
            {ask.no}
          </PillButton>
          <button ref={yesRef} type="button" className={pillClass('dark', false)} onClick={() => done(true)}>
            {ask.yes}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

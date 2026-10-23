/**
 * Before the app: first-run setup (the company and its owner), sign in,
 * and joining with an invite code. One calm screen each, in the app's
 * colors, with the company's name as soon as it is known.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, Briefcase, Check, Factory, KeyRound, LayoutGrid, Lock, Mail, Store } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { errMessage, op } from '../lib/api.ts';
import { signedIn } from '../lib/session.ts';
import type { Me } from '../lib/types.ts';
import { Mark } from '../components/Shell.tsx';
import { Field, Notice, PillButton, PillSelect, Skeleton, Toggle, softInput } from '../components/ui.tsx';

/* ---------------------------------------------------------------- frame */

function Stage({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[var(--erp-canvas)] p-0 md:p-4">
      <div className="mx-auto grid min-h-screen max-w-[1180px] grid-cols-1 overflow-hidden bg-[var(--erp-shell)] md:min-h-[calc(100vh-32px)] md:rounded-[36px] lg:grid-cols-[1fr_1.1fr]">
        <div className="erp-on-dark relative hidden flex-col justify-between bg-[var(--erp-dark)] p-10 text-[var(--erp-on-dark)] lg:flex">
          <div className="flex items-center gap-3">
            <Mark size={40} />
            <span className="text-[15px] font-bold">ERP</span>
          </div>
          {aside}
          <p className="text-[12px] text-[var(--erp-on-dark-muted)]">Sales, buying, stock, money, people and projects in one place, with your AI agent working alongside you.</p>
        </div>
        <div className="flex flex-col justify-center px-5 py-10 sm:px-10 md:px-14">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Mark size={36} />
            <span className="text-[15px] font-bold">ERP</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The dark side panel's picture: a stack of soft cards with figures. */
function Picture(): React.JSX.Element {
  const rows = [
    { label: 'Owed to you', value: '48,210.00', w: 78 },
    { label: 'Cash in the bank', value: '126,904.50', w: 92 },
    { label: 'Bills to pay', value: '17,380.00', w: 46 },
  ];
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="erp-rise rounded-[24px] bg-[var(--erp-dark-2)] p-6">
        <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">This month</p>
        <p className="num mt-1 text-[26px] font-extrabold tracking-[-0.02em]">+ 32,560.00</p>
        <div className="mt-5 flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={r.label}>
              <div className="flex justify-between text-[13px]">
                <span className="text-[var(--erp-on-dark-muted)]">{r.label}</span>
                <span className="num font-bold">{r.value}</span>
              </div>
              <span className="mt-1.5 block h-2 rounded-full bg-[var(--erp-dark)]">
                <span className={cn('erp-grow-x block h-2 rounded-full', i === 0 ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-on-dark)]')} style={{ width: `${r.w}%`, animationDelay: `${200 + i * 120}ms` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="erp-rise erp-d2 -mt-4 ml-10 mr-[-12px] rounded-[20px] bg-[var(--erp-card)] p-4 text-[var(--erp-ink)] shadow-[var(--erp-pop-shadow)]">
        <p className="flex items-center gap-2 text-[13px] font-bold">
          <span className="size-2 rounded-full bg-[var(--erp-accent)]" /> Your AI agent read 3 bills
        </p>
        <p className="mt-1 text-[12px] text-[var(--erp-muted)]">Ready for you to approve</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- setup */

interface Country {
  code: string;
  name: string;
  currency: string;
  fiscal_start_month: number;
  leave_days: number;
  taxes: { code: string; name: string; rate: string; scope: string }[];
}

interface Presets {
  countries: Country[];
  business_types: { key: string; modules: Record<string, boolean> }[];
}

const BUSINESS: { key: string; label: string; sub: string; icon: LucideIcon }[] = [
  { key: 'services', label: 'Services', sub: 'Projects, time and invoices', icon: Briefcase },
  { key: 'trading', label: 'Trading', sub: 'Buy, stock and sell goods', icon: Store },
  { key: 'manufacturing', label: 'Manufacturing', sub: 'Make goods from parts', icon: Factory },
  { key: 'other', label: 'Something else', sub: 'Everything switched on', icon: LayoutGrid },
];

const MODULE_LABEL: Record<string, string> = {
  sales: 'Sales',
  purchasing: 'Purchasing',
  inventory: 'Inventory',
  manufacturing: 'Manufacturing',
  accounting: 'Accounting',
  banking: 'Banking',
  people: 'People',
  payroll: 'Payroll',
  projects: 'Projects',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function guessCountry(list: Country[]): string {
  const lang = navigator.language ?? '';
  const region = lang.split('-')[1]?.toUpperCase() ?? '';
  return list.some((c) => c.code === region) ? region : (list[0]?.code ?? 'XX');
}

export function SetupScreen(): React.JSX.Element {
  const [presets, setPresets] = useState<Presets | null>(null);
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [business, setBusiness] = useState('services');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmployee, setIsEmployee] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    op<Presets>('setup.presets', {}, { quiet: true })
      .then((p) => {
        setPresets(p);
        setCountry(guessCountry(p.countries));
      })
      .catch((e: unknown) => setError(errMessage(e)));
  }, []);

  const c = useMemo(() => presets?.countries.find((x) => x.code === country) ?? null, [presets, country]);
  const mods = presets?.business_types.find((b) => b.key === business)?.modules ?? {};
  const okCompany = company.trim() !== '' && country !== '';
  const okYou = name.trim() !== '' && /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= 8;

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me }>(
        'setup.complete',
        { company_name: company.trim(), country, business_type: business, owner_name: name.trim(), owner_email: email.trim(), password, owner_is_employee: isEmployee },
        { quiet: true },
      );
      signedIn(r.token, r.me);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = ['Company', 'You', 'Ready'];
  return (
    <Stage aside={<Picture />}>
      <div className="mx-auto w-full max-w-md">
        <ol className="mb-8 flex items-center gap-2" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-[12px] font-bold',
                  i < step ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : i === step ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
                )}
              >
                {i < step ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('text-[13px] font-semibold', i === step ? 'text-[var(--erp-ink)]' : 'text-[var(--erp-muted)]')}>{s}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-[var(--erp-line)]" />}
            </li>
          ))}
        </ol>

        {presets === null && error === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-2/3" rounded="rounded-full" />
            <Skeleton className="h-11" rounded="rounded-full" />
            <Skeleton className="h-11" rounded="rounded-full" />
          </div>
        ) : step === 0 ? (
          <div className="erp-rise flex flex-col gap-5">
            <div>
              <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Set up your company</h1>
              <p className="mt-1 text-[13px] text-[var(--erp-muted)]">Takes a minute. Everything here can be changed later in Settings.</p>
            </div>
            <Field label="Company name">
              <input value={company} onChange={(e) => setCompany(e.target.value)} autoFocus placeholder="Acme Trading" className={softInput} aria-label="Company name" />
            </Field>
            <PillSelect label="Country" soft value={country} onChange={setCountry} options={(presets?.countries ?? []).map((x) => ({ value: x.code, label: `${x.name} (${x.currency})` }))} />
            <div className="flex flex-col gap-2">
              <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">What the business does</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What the business does">
                {BUSINESS.map((b) => {
                  const Icon = b.icon;
                  const on = business === b.key;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setBusiness(b.key)}
                      className={cn('flex flex-col items-start gap-2 rounded-[18px] p-3 text-left transition-colors', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                    >
                      <span className={cn('flex size-8 items-center justify-center rounded-full', on ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-card)]')}>
                        <Icon size={15} aria-hidden />
                      </span>
                      <span>
                        <span className="block text-[13px] font-bold">{b.label}</span>
                        <span className={cn('block text-[12px]', on ? 'opacity-80' : 'text-[var(--erp-muted)]')}>{b.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <PillButton icon={ArrowRight} dot disabled={!okCompany} onClick={() => setStep(1)} className="self-start">
              Continue
            </PillButton>
          </div>
        ) : step === 1 ? (
          <div className="erp-rise flex flex-col gap-5">
            <div>
              <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Your account</h1>
              <p className="mt-1 text-[13px] text-[var(--erp-muted)]">You are the owner of {company.trim() !== '' ? company.trim() : 'the company'}. You invite the team afterwards.</p>
            </div>
            <Field label="Your name">
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" className={softInput} aria-label="Your name" />
            </Field>
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={softInput} aria-label="Email" />
            </Field>
            <Field label="Password" hint="At least 8 characters" error={password !== '' && password.length < 8 ? 'At least 8 characters' : null}>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className={softInput} aria-label="Password" />
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
              <div>
                <p className="text-[14px] font-semibold">I work here too</p>
                <p className="text-[12px] text-[var(--erp-muted)]">Adds you to the team directory, for leave and expense claims</p>
              </div>
              <Toggle checked={isEmployee} onChange={setIsEmployee} label="I work here too" />
            </div>
            <div className="flex gap-2">
              <PillButton variant="soft" icon={ArrowLeft} onClick={() => setStep(0)}>
                Back
              </PillButton>
              <PillButton icon={ArrowRight} dot disabled={!okYou} onClick={() => setStep(2)}>
                Continue
              </PillButton>
            </div>
          </div>
        ) : (
          <div className="erp-rise flex flex-col gap-5">
            <div>
              <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">Ready to go</h1>
              <p className="mt-1 text-[13px] text-[var(--erp-muted)]">{company.trim()} will start with this:</p>
            </div>
            <ul className="flex flex-col gap-2">
              <li className="flex justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px]">
                <span className="text-[var(--erp-muted)]">Currency</span>
                <span className="font-bold">{c?.currency ?? ''}</span>
              </li>
              <li className="flex justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px]">
                <span className="text-[var(--erp-muted)]">Financial year starts</span>
                <span className="font-bold">{MONTHS[(c?.fiscal_start_month ?? 1) - 1]}</span>
              </li>
              <li className="flex justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px]">
                <span className="shrink-0 text-[var(--erp-muted)]">Taxes</span>
                <span className="text-right font-bold">{(c?.taxes ?? []).map((t) => t.name).join(', ') || 'None yet'}</span>
              </li>
              <li className="rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px]">
                <span className="text-[var(--erp-muted)]">Switched on</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(mods)
                    .filter(([, on]) => on)
                    .map(([k]) => (
                      <span key={k} className="rounded-full bg-[var(--erp-card)] px-2.5 py-1 text-[12px] font-semibold">
                        {MODULE_LABEL[k] ?? k}
                      </span>
                    ))}
                </span>
              </li>
            </ul>
            <p className="text-[12px] text-[var(--erp-muted)]">A chart of accounts, a bank and a cash account, a main warehouse and leave types are created for you.</p>
            {error !== null && <Notice tone="bad">{error}</Notice>}
            <div className="flex gap-2">
              <PillButton variant="soft" icon={ArrowLeft} onClick={() => setStep(1)}>
                Back
              </PillButton>
              <PillButton icon={Check} dot loading={busy} onClick={() => void finish()}>
                Set up the company
              </PillButton>
            </div>
          </div>
        )}
        {presets === null && error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Stage>
  );
}

/* --------------------------------------------------------------- sign in */

export function SignInScreen({ notice, company }: { notice: string; company: string }): React.JSX.Element {
  const [mode, setMode] = useState<'password' | 'invite'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'password'
          ? await op<{ token: string; me: Me }>('auth.login', { email: email.trim(), password }, { quiet: true })
          : await op<{ token: string; me: Me }>('auth.accept-invite', { email: email.trim(), code: code.trim(), password, name: name.trim() === '' ? undefined : name.trim() }, { quiet: true });
      signedIn(r.token, r.me);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = email.trim() !== '' && password !== '' && (mode === 'password' || (code.trim() !== '' && password.length >= 8));
  return (
    <Stage aside={<Picture />}>
      <form
        className="erp-rise mx-auto flex w-full max-w-md flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void submit();
        }}
      >
        <div>
          <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{mode === 'password' ? 'Welcome back' : 'Join the team'}</h1>
          <p className="mt-1 text-[13px] text-[var(--erp-muted)]">{mode === 'password' ? `Sign in to ${company !== '' ? company : 'your company'}.` : 'Use the code from your invite to set your password.'}</p>
        </div>
        {notice !== '' && <Notice tone="warn">{notice}</Notice>}
        <Field label="Email">
          <div className="relative">
            <Mail size={15} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" autoFocus className={cn(softInput, 'pl-11')} aria-label="Email" />
          </div>
        </Field>
        {mode === 'invite' && (
          <>
            <Field label="Invite code">
              <div className="relative">
                <KeyRound size={15} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" autoComplete="one-time-code" className={cn(softInput, 'num pl-11 tracking-[0.08em]')} aria-label="Invite code" />
              </div>
            </Field>
            <Field label="Your name" optional>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={softInput} aria-label="Your name" />
            </Field>
          </>
        )}
        <Field label={mode === 'password' ? 'Password' : 'Choose a password'} hint={mode === 'invite' ? 'At least 8 characters' : undefined}>
          <div className="relative">
            <Lock size={15} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === 'password' ? 'current-password' : 'new-password'} className={cn(softInput, 'pl-11')} aria-label="Password" />
          </div>
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <PillButton type="submit" icon={ArrowRight} dot loading={busy} disabled={!ready}>
            {mode === 'password' ? 'Sign in' : 'Join'}
          </PillButton>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'password' ? 'invite' : 'password');
              setError(null);
            }}
            className="text-[13px] font-semibold text-[var(--erp-ink-2)] underline-offset-4 hover:underline"
          >
            {mode === 'password' ? 'I have an invite code' : 'I already have a password'}
          </button>
        </div>
        {mode === 'password' && <p className="text-[12px] text-[var(--erp-muted)]">Forgot your password? An administrator can send you a new code from Settings, Team.</p>}
      </form>
    </Stage>
  );
}
